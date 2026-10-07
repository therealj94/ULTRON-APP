// EL PUENTE DE WHATSAPP DE AU-RA: el WhatsApp personal de cada cuenta de AU-RA como «dispositivo vinculado», para
// que la app y AURA para Windows lo vean y contesten (José, 2-oct; para todas las cuentas desde el 5-oct: una
// cuenta de WhatsApp por cuenta de AU-RA, cada una en su carpeta; cuentas.go). Corre como servicio PRIVADO de Render
// (sin dirección pública: solo el servidor de AU-RA lo alcanza por la red interna) y además pide clave.
//
// Variables: PUENTE_CLAVE (obligatoria), DATOS (carpeta del disco, /data), PORT (8080), AURA_AVISO_URL (opcional: a
// dónde se avisa cada mensaje nuevo, firmado con PUENTE_CLAVE; aviso.go),
// WHATSAPP_MAX_CUENTAS (cuántas cuentas caben; 25), WHATSAPP_RESERVA_JUNTA (de esas, cuántas solo para la junta y el
// padrón; 2), NIVEL_LOG (INFO; el de whatsmeow va siempre en WARN: en INFO escribe números y JIDs).
//
// Hecho con whatsmeow (la librería de WhatsApp Web multi-dispositivo; la misma que usa
// lharries/whatsapp-mcp). No es una API oficial de Meta: José lo eligió sabiendo el riesgo.
package main

import (
	"context"
	"fmt"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
	"time"

	_ "github.com/mattn/go-sqlite3"
	waLog "go.mau.fi/whatsmeow/util/log"
)

// Lo que el puente lee del entorno al arrancar.
type Config struct {
	clave   string
	aviso   string
	datos   string
	puerto  string
	max     int
	reserva int
	nivel   string
}

// MinClavePuente: lo mínimo de PUENTE_CLAVE. Con varias cuentas, la clave es lo único (además de la red privada) que
// separa el WhatsApp de cada persona de quien llegue al puente: sin ella, o corta, el puente NO arranca (revisión del
// 5-oct; nunca «abierto por omisión»).
const MinClavePuente = 24

// Lee y valida la configuración (sin tocar el disco). Error: el puente no debe arrancar.
func configDelEntorno(env func(string) string) (Config, error) {
	o := func(k, def string) string {
		if v := strings.TrimSpace(env(k)); v != "" {
			return v
		}
		return def
	}
	c := Config{clave: env("PUENTE_CLAVE"), aviso: o("AURA_AVISO_URL", ""), datos: o("DATOS", "/data"), puerto: o("PORT", "8080"), nivel: o("NIVEL_LOG", "INFO")}
	if len(c.clave) < MinClavePuente {
		return c, fmt.Errorf("falta PUENTE_CLAVE (%d caracteres o más): sin ella no se arranca con varias cuentas", MinClavePuente)
	}
	max, err := strconv.Atoi(o("WHATSAPP_MAX_CUENTAS", "25"))
	if err != nil || max < 1 {
		max = 25
	}
	c.max = max
	reserva, err := strconv.Atoi(o("WHATSAPP_RESERVA_JUNTA", "2"))
	if err != nil || reserva < 0 {
		reserva = 2
	}
	c.reserva = reserva
	return c, nil
}

func main() {
	conf, err := configDelEntorno(os.Getenv)
	log := waLog.Stdout("puente", conf.nivel, false)
	if err != nil {
		log.Errorf("%v", err)
		os.Exit(1)
	}
	clave, datos, max := conf.clave, conf.datos, conf.max
	if err := os.MkdirAll(datos, 0o700); err != nil {
		log.Errorf("no pude crear %s: %v", datos, err)
		os.Exit(1)
	}
	ctx := context.Background()
	// Sin AURA_AVISO_URL, nil: no se avisa nada (como antes).
	avisador := NuevoAvisador(conf.aviso, clave, log.Sub("aviso"))
	if avisador != nil {
		log.Infof("los mensajes nuevos se avisan al servidor de AU-RA")
	}
	cuentas, err := NuevoRegistro(datos, max, log, func(claveCuenta, dir string, alm *Almacen) (Cuenta, error) {
		var alLlegar func(Mensaje, bool, string)
		if avisador != nil {
			alLlegar = func(m Mensaje, grupo bool, nombreChat string) {
				avisador.Avisar(avisoDe(claveCuenta, m, grupo, nombreChat))
			}
		}
		return NuevaCuentaWA(ctx, filepath.Join(dir, "sesion.db"), filepath.Join(dir, "fotos"), alm, log.Sub(nombreLog(claveCuenta)), alLlegar)
	})
	if err != nil {
		log.Errorf("cuentas: %v", err)
		os.Exit(1)
	}
	cuentas.Reservar(conf.reserva)
	// Solo las que ya estaban vinculadas se reconectan (cada una aparte); las demás nacen en su primer /vincular.
	cuentas.Cargar()
	// Las vinculaciones que no terminan sueltan su lugar aunque nadie vuelva a pedir /vincular.
	go func() {
		for range time.Tick(30 * time.Second) {
			cuentas.Barrer()
		}
	}()
	api := &API{clave: clave, cuentas: cuentas}
	srv := &http.Server{Addr: ":" + conf.puerto, Handler: api.Rutas(), ReadHeaderTimeout: 10 * time.Second}
	go func() {
		log.Infof("escuchando en %s", srv.Addr)
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Errorf("http: %v", err)
			os.Exit(1)
		}
	}()
	fin := make(chan os.Signal, 1)
	signal.Notify(fin, os.Interrupt, syscall.SIGTERM)
	<-fin
	c, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	_ = srv.Shutdown(c)
	cuentas.CerrarTodo()
}
