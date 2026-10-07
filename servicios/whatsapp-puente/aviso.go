package main

// EL AVISO AL SERVIDOR DE AU-RA (auditoría del 7-oct, A-6: «no hay aviso cuando un cliente escribe»). Cada mensaje
// NUEVO que llega en vivo (no la historia, no los propios, no estados ni canales) se le avisa al servidor de AU-RA con
// un POST a AURA_AVISO_URL, firmado con la clave del puente (PUENTE_CLAVE): el servidor decide si es importante (su
// lista VIP, palabras de urgencia, Laya) y si le manda un aviso al teléfono. El puente no decide nada ni guarda nada más.
//
//   - Sin AURA_AVISO_URL no se avisa nada (como antes).
//   - La firma: X-Puente-Firma: t=<unix>,v1=<hex de HMAC-SHA256(llave, "<t>.<cuerpo>")>, con llave = sha256 de
//     "aura-puente-aviso|" + PUENTE_CLAVE (nunca la clave tal cual por la red). El servidor rechaza una firma vieja
//     (más de 5 minutos) o repetida.
//   - Va aparte (una cola corta y un trabajador): el manejador de eventos de WhatsApp nunca espera a la red. Si la cola
//     se llena (el servidor caído y una ráfaga), lo que no cabe se suelta: perder un aviso es mejor que frenar WhatsApp.
//   - Solo lo de los últimos minutos (VentanaAviso): al reconectar, WhatsApp entrega lo atrasado y eso no es «nuevo».

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"sync/atomic"
	"time"

	waLog "go.mau.fi/whatsmeow/util/log"
)

// Lo que viaja al servidor de AU-RA por cada mensaje nuevo. `Cuenta` es la clave opaca de la cuenta en el puente
// («legado» o el HMAC que mandó el servidor): el servidor sabe de quién es; el puente no.
type AvisoMensaje struct {
	Cuenta     string `json:"cuenta"`
	ID         string `json:"id"`
	Chat       string `json:"chat"`
	De         string `json:"de"`
	NombreDe   string `json:"nombreDe,omitempty"`
	NombreChat string `json:"nombreChat,omitempty"`
	Grupo      bool   `json:"grupo"`
	Hora       int64  `json:"hora"`
	Tipo       string `json:"tipo"`
	Texto      string `json:"texto,omitempty"`
	Archivo    string `json:"archivo,omitempty"`
	Duracion   int    `json:"duracion,omitempty"`
}

// La cabecera con la firma del aviso.
const CabeceraFirma = "X-Puente-Firma"

// Lo más que se manda del texto de un mensaje (el servidor solo hace con esto una línea de resumen).
const MaxTextoAviso = 1000

// Un mensaje más viejo que esto no se avisa (lo atrasado que entrega WhatsApp al reconectar no es «nuevo»).
const VentanaAviso = 10 * time.Minute

// Cuántos avisos esperan a lo más (los que no caben se sueltan).
const ColaAviso = 256

// La llave con que se firma: derivada de la clave del puente (la clave no viaja ni se usa tal cual para otra cosa).
func llaveAviso(clave string) []byte {
	h := sha256.Sum256([]byte("aura-puente-aviso|" + clave))
	return h[:]
}

// La firma de un aviso: "t=<unix>,v1=<hex>".
func FirmaAviso(clave string, t int64, cuerpo []byte) string {
	m := hmac.New(sha256.New, llaveAviso(clave))
	fmt.Fprintf(m, "%d.", t)
	m.Write(cuerpo)
	return fmt.Sprintf("t=%d,v1=%s", t, hex.EncodeToString(m.Sum(nil)))
}

// ¿Este mensaje se avisa? Solo lo que llega en vivo, de otra persona, con contenido y de los últimos minutos.
func debeAvisar(m Mensaje, vivo bool, ahora time.Time) bool {
	if !vivo || m.Mio || m.Tipo == "" || m.ID == "" {
		return false
	}
	if m.Hora <= 0 {
		return false
	}
	edad := ahora.Sub(time.UnixMilli(m.Hora))
	return edad < VentanaAviso && edad > -VentanaAviso
}

// El aviso de un mensaje (con el texto acotado).
func avisoDe(cuenta string, m Mensaje, grupo bool, nombreChat string) AvisoMensaje {
	texto := m.Texto
	if r := []rune(texto); len(r) > MaxTextoAviso {
		texto = string(r[:MaxTextoAviso])
	}
	return AvisoMensaje{
		Cuenta: cuenta, ID: m.ID, Chat: m.Chat, De: m.De, NombreDe: m.NombreDe, NombreChat: nombreChat, Grupo: grupo,
		Hora: m.Hora, Tipo: m.Tipo, Texto: texto, Archivo: m.Archivo, Duracion: m.Duracion,
	}
}

// ¿Es una dirección a la que se puede avisar? https a cualquier lado; http solo dentro de la red privada de Render o a
// la propia máquina (el texto de los mensajes no cruza internet sin cifrar).
func urlAvisoValida(s string) bool {
	u, err := url.Parse(strings.TrimSpace(s))
	if err != nil || u.Host == "" {
		return false
	}
	if u.Scheme == "https" {
		return true
	}
	if u.Scheme != "http" {
		return false
	}
	h := u.Hostname()
	return h == "localhost" || h == "127.0.0.1" || h == "::1" || !strings.Contains(h, ".")
}

type Avisador struct {
	url     string
	clave   string
	web     *http.Client
	cola    chan AvisoMensaje
	log     waLog.Logger
	ahora   func() time.Time
	soltado atomic.Int64
}

// El avisador del puente, o nil si no hay a quién avisar (sin AURA_AVISO_URL o con una dirección que no vale).
func NuevoAvisador(direccion, clave string, log waLog.Logger) *Avisador {
	if strings.TrimSpace(direccion) == "" {
		return nil
	}
	if !urlAvisoValida(direccion) {
		log.Warnf("AURA_AVISO_URL no vale (https, o http dentro de la red privada): no se avisa nada")
		return nil
	}
	a := &Avisador{url: strings.TrimSpace(direccion), clave: clave, web: &http.Client{Timeout: 10 * time.Second}, cola: make(chan AvisoMensaje, ColaAviso), log: log, ahora: time.Now}
	go a.trabajar()
	return a
}

// Pone el aviso en la cola sin esperar. Si está llena, lo suelta (y lo cuenta).
func (a *Avisador) Avisar(m AvisoMensaje) {
	if a == nil {
		return
	}
	select {
	case a.cola <- m:
	default:
		if n := a.soltado.Add(1); n%50 == 1 {
			a.log.Warnf("la cola de avisos está llena: %d avisos soltados", n)
		}
	}
}

func (a *Avisador) trabajar() {
	for m := range a.cola {
		// Dos intentos (un tropiezo de red); después se suelta.
		for intento := 0; intento < 2; intento++ {
			err := a.mandar(m)
			if err == nil {
				break
			}
			if intento == 1 {
				a.log.Warnf("no pude avisar un mensaje nuevo al servidor: %v", err)
			} else {
				time.Sleep(2 * time.Second)
			}
		}
	}
}

func (a *Avisador) mandar(m AvisoMensaje) error {
	cuerpo, err := json.Marshal(m)
	if err != nil {
		return err
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, "POST", a.url, bytes.NewReader(cuerpo))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set(CabeceraFirma, FirmaAviso(a.clave, a.ahora().Unix(), cuerpo))
	r, err := a.web.Do(req)
	if err != nil {
		return err
	}
	r.Body.Close()
	// 4xx: el servidor lo leyó y no lo quiere (otra firma, una cuenta que ya no está): reintentar no sirve.
	if r.StatusCode >= 500 {
		return fmt.Errorf("el servidor contestó HTTP %d", r.StatusCode)
	}
	return nil
}
