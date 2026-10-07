package main

import (
	"bytes"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"go.mau.fi/whatsmeow"
	"go.mau.fi/whatsmeow/proto/waE2E"
	"go.mau.fi/whatsmeow/types"
	"go.mau.fi/whatsmeow/types/events"
	waLog "go.mau.fi/whatsmeow/util/log"
	"google.golang.org/protobuf/proto"
)

/* ------------------------------------------------------------------ una nota de voz Ogg/Opus de mentira */

// Una página Ogg con su cuerpo (sin CRC de verdad: el puente no lo mira).
func paginaOgg(granulo int64, cuerpo []byte) []byte {
	var b bytes.Buffer
	b.WriteString("OggS")
	b.WriteByte(0)
	b.WriteByte(0)
	g := make([]byte, 8)
	binary.LittleEndian.PutUint64(g, uint64(granulo))
	b.Write(g)
	b.Write(make([]byte, 12)) // serie, número de página, CRC
	var segs []byte
	for n := len(cuerpo); ; n -= 255 {
		if n >= 255 {
			segs = append(segs, 255)
			continue
		}
		segs = append(segs, byte(n))
		break
	}
	b.WriteByte(byte(len(segs)))
	b.Write(segs)
	b.Write(cuerpo)
	return b.Bytes()
}

// `segundos` de Opus a 48 kHz con un pre-skip de 312 (lo que ponen los codificadores).
func notaOgg(segundos float64) []byte {
	cab := append([]byte("OpusHead"), 1, 1, 0x38, 0x01, 0x80, 0xBB, 0, 0, 0, 0, 0)
	var b bytes.Buffer
	b.Write(paginaOgg(0, cab))
	b.Write(paginaOgg(0, append([]byte("OpusTags"), make([]byte, 8)...)))
	b.Write(paginaOgg(-1, make([]byte, 300))) // una página sin paquete que termine: sin posición
	b.Write(paginaOgg(312+int64(segundos*48000), make([]byte, 40)))
	return b.Bytes()
}

func TestDuracionOggOpus(t *testing.T) {
	if s, ok := duracionOggOpus(notaOgg(4.2)); !ok || s != 5 {
		t.Fatalf("4,2 s → 5 (hacia arriba): %d %v", s, ok)
	}
	if s, ok := duracionOggOpus(notaOgg(0)); !ok || s != 1 {
		t.Fatalf("una nota vacía dura 1 s: %d %v", s, ok)
	}
	for nombre, b := range map[string][]byte{
		"mp3":     append([]byte("ID3"), make([]byte, 100)...),
		"vacío":   nil,
		"cortado": notaOgg(3)[:60],
		"vorbis":  paginaOgg(100, append([]byte("\x01vorbis"), make([]byte, 30)...)),
	} {
		if _, ok := duracionOggOpus(b); ok {
			t.Fatalf("%s no es una nota de voz", nombre)
		}
	}
}

// Lo que devuelve una subida (sin WhatsApp): solo para armar el mensaje.
func subidaDePrueba() whatsmeow.UploadResponse {
	return whatsmeow.UploadResponse{URL: "https://mmg.whatsapp.net/x", DirectPath: "/x", FileLength: 10}
}

func TestValidarMediaSaliente(t *testing.T) {
	jpg := append([]byte{0xFF, 0xD8, 0xFF, 0xE0}, make([]byte, 20)...)
	png := append([]byte{0x89, 'P', 'N', 'G', 0x0D, 0x0A, 0x1A, 0x0A}, make([]byte, 20)...)
	m := MediaSaliente{Tipo: "imagen", Datos: png, Mime: "image/jpeg"}
	if err := validarMediaSaliente(&m); err != nil || m.Mime != "image/png" {
		t.Fatalf("el tipo sale de los bytes, no de lo que dicen: %v %q", err, m.Mime)
	}
	for nombre, x := range map[string]MediaSaliente{
		"foto que no es foto": {Tipo: "imagen", Datos: []byte("%PDF-1.4 hola")},
		"nota en mp3":         {Tipo: "nota", Datos: append([]byte("ID3"), make([]byte, 40)...)},
		"tipo raro":           {Tipo: "sticker", Datos: jpg},
		"vacío":               {Tipo: "documento"},
		"grande":              {Tipo: "documento", Datos: make([]byte, MaxMediaEnviar+1)},
	} {
		x := x
		if err := validarMediaSaliente(&x); err == nil {
			t.Fatalf("%s: tenía que fallar", nombre)
		}
	}
	n := MediaSaliente{Tipo: "nota", Datos: notaOgg(7)}
	if err := validarMediaSaliente(&n); err != nil || n.Segundos != 7 || n.Mime != "audio/ogg; codecs=opus" {
		t.Fatalf("nota: %v %+v", err, n.Segundos)
	}
	d := MediaSaliente{Tipo: "documento", Datos: []byte("%PDF-1.4"), Nombre: "../../etc/contrato\x00 final.pdf"}
	if err := validarMediaSaliente(&d); err != nil || d.Nombre != "contrato final.pdf" || d.Mime != "application/octet-stream" {
		t.Fatalf("documento: %v %q %q", err, d.Nombre, d.Mime)
	}
	// El mensaje de WhatsApp de una nota: micrófono (PTT) y su duración.
	msg := mensajeDeMedia(subidaDePrueba(), n)
	if !msg.GetAudioMessage().GetPTT() || msg.GetAudioMessage().GetSeconds() != 7 {
		t.Fatalf("la nota va como nota de voz: %+v", msg.GetAudioMessage())
	}
	if doc := mensajeDeMedia(subidaDePrueba(), d); doc.GetDocumentMessage().GetFileName() != "contrato final.pdf" {
		t.Fatalf("el documento lleva su nombre: %+v", doc.GetDocumentMessage())
	}
	if c, _ := Contenido(msg); c.Tipo != "audio" || c.Duracion != 7 {
		t.Fatalf("lo mandado se guarda como audio de 7 s: %+v", c)
	}
}

func TestAPIEnviarMedia(t *testing.T) {
	alm := almacenDePrueba(t)
	cuenta := &cuentaFalsa{alm: alm, estado: EstadoCuenta{Vinculado: true}}
	h, _ := apiCon(t, claveDePrueba, cuenta, alm)
	pdf := []byte("%PDF-1.4 contrato")
	if c, _ := pedir(t, h, "POST", "/enviar-media", "", map[string]any{"chat": "504@s.whatsapp.net", "tipo": "documento", "datos": pdf}); c != 401 {
		t.Fatalf("sin clave: %d", c)
	}
	if c, j := pedir(t, h, "POST", "/enviar-media", claveDePrueba, map[string]any{"chat": "504@s.whatsapp.net", "tipo": "nota", "datos": []byte("no es ogg")}); c != 400 || len(cuenta.medios) != 0 {
		t.Fatalf("una nota que no es Ogg/Opus no sale: %d %v", c, j)
	}
	c, j := pedir(t, h, "POST", "/enviar-media", claveDePrueba, map[string]any{"chat": "504@s.whatsapp.net", "tipo": "documento", "datos": pdf, "nombre": "contrato.pdf", "mime": "application/pdf", "id": "3EB0AAAABBBBCCCCDDDD"})
	if c != 200 || len(cuenta.medios) != 1 || cuenta.medios[0].Nombre != "contrato.pdf" || !bytes.Equal(cuenta.medios[0].Datos, pdf) {
		t.Fatalf("documento: %d %v %+v", c, j, cuenta.medios)
	}
	// El mismo id otra vez (un reintento después de un corte): no sale dos veces.
	c, j = pedir(t, h, "POST", "/enviar-media", claveDePrueba, map[string]any{"chat": "504@s.whatsapp.net", "tipo": "documento", "datos": pdf, "id": "3EB0AAAABBBBCCCCDDDD"})
	if c != 200 || j["repetido"] != true || len(cuenta.medios) != 1 {
		t.Fatalf("repetido: %d %v", c, j)
	}
	c, _ = pedir(t, h, "POST", "/enviar-media", claveDePrueba, map[string]any{"chat": "504@s.whatsapp.net", "tipo": "nota", "datos": notaOgg(3), "id": "3EB0AAAABBBBCCCCEEEE"})
	if c != 200 || len(cuenta.medios) != 2 || cuenta.medios[1].Segundos != 3 {
		t.Fatalf("nota: %d %+v", c, cuenta.medios)
	}
	// Más grande que el tope: 413 sin llegar a WhatsApp.
	r := httptest.NewRequest("POST", "/enviar-media", strings.NewReader(fmt.Sprintf(`{"chat":"504@s.whatsapp.net","tipo":"documento","datos":"%s"}`, strings.Repeat("A", MaxCuerpoMedia))))
	r.Header.Set("Authorization", "Bearer "+claveDePrueba)
	r.Header.Set(CabeceraCuenta, ClaveLegado)
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	if w.Code != 413 || len(cuenta.medios) != 2 {
		t.Fatalf("enorme: %d", w.Code)
	}
	// Las demás rutas siguen con su tope corto (64 KB).
	if c, _ := pedir(t, h, "POST", "/enviar", claveDePrueba, map[string]any{"chat": "504@s.whatsapp.net", "texto": strings.Repeat("a", 70<<10)}); c != 400 {
		t.Fatalf("/enviar con 70 KB: %d", c)
	}
}

/* ------------------------------------------------------------------ el aviso al servidor */

func TestFirmaYFiltroDelAviso(t *testing.T) {
	cuerpo := []byte(`{"id":"X"}`)
	f := FirmaAviso("clave-larga-de-veinticuatro-o-mas", 1700000000, cuerpo)
	llave := sha256.Sum256([]byte("aura-puente-aviso|clave-larga-de-veinticuatro-o-mas"))
	m := hmac.New(sha256.New, llave[:])
	m.Write([]byte("1700000000."))
	m.Write(cuerpo)
	if f != "t=1700000000,v1="+hex.EncodeToString(m.Sum(nil)) {
		t.Fatalf("firma: %s", f)
	}
	// El mismo vector que comprueba el servidor (tests/alertas-mensajes.test.ts): las dos puntas firman igual.
	if f != "t=1700000000,v1=85a5d30a85ccaf5031d012e17d682881fe84c5f44cf41018915511f66d08a2dc" {
		t.Fatalf("la firma no es la que espera el servidor: %s", f)
	}
	ahora := time.Now()
	nuevo := Mensaje{ID: "A", Tipo: "texto", Hora: ahora.Add(-time.Minute).UnixMilli()}
	if !debeAvisar(nuevo, true, ahora) {
		t.Fatal("uno nuevo de otra persona se avisa")
	}
	mio := nuevo
	mio.Mio = true
	viejo := nuevo
	viejo.Hora = ahora.Add(-2 * time.Hour).UnixMilli()
	if debeAvisar(nuevo, false, ahora) || debeAvisar(mio, true, ahora) || debeAvisar(viejo, true, ahora) {
		t.Fatal("ni la historia, ni lo propio, ni lo atrasado")
	}
	largo := avisoDe("legado", Mensaje{ID: "A", Texto: strings.Repeat("ñ", 3000)}, false, "Ana")
	if len([]rune(largo.Texto)) != MaxTextoAviso || largo.Cuenta != "legado" || largo.NombreChat != "Ana" {
		t.Fatalf("aviso: %d %+v", len([]rune(largo.Texto)), largo.Cuenta)
	}
	for u, ok := range map[string]bool{"https://aura.onrender.com/api/whatsapp/aviso": true, "http://aura-servidor:10000/api/whatsapp/aviso": true, "http://127.0.0.1:9/x": true, "http://aura.example.com/x": false, "ftp://x/y": false, "": false} {
		if urlAvisoValida(u) != ok {
			t.Fatalf("url %q", u)
		}
	}
	if NuevoAvisador("", "x", waLog.Noop) != nil || NuevoAvisador("http://ejemplo.com/x", "x", waLog.Noop) != nil {
		t.Fatal("sin dirección (o con una que no vale), no hay avisador")
	}
}

func TestAvisadorMandaFirmado(t *testing.T) {
	const clave = "clave-larga-de-veinticuatro-o-mas"
	var mu sync.Mutex
	var llegados []AvisoMensaje
	listo := make(chan struct{}, 4)
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		cuerpo, _ := io.ReadAll(r.Body)
		var t0 int64
		fmt.Sscanf(r.Header.Get(CabeceraFirma), "t=%d,", &t0)
		if r.Header.Get(CabeceraFirma) != FirmaAviso(clave, t0, cuerpo) {
			w.WriteHeader(401)
			return
		}
		var a AvisoMensaje
		_ = json.Unmarshal(cuerpo, &a)
		mu.Lock()
		llegados = append(llegados, a)
		mu.Unlock()
		listo <- struct{}{}
	}))
	defer srv.Close()
	av := NuevoAvisador(srv.URL, clave, waLog.Noop)
	if av == nil {
		t.Fatal("con dirección, hay avisador")
	}

	// Una cuenta de verdad (sin red): solo lo nuevo de otra persona, en vivo, llega al servidor.
	c, _ := cuentaDePrueba(t)
	c.alLlegar = func(m Mensaje, grupo bool, nombre string) { av.Avisar(avisoDe("legado", m, grupo, nombre)) }
	ana := types.JID{User: "50499990000", Server: types.DefaultUserServer}
	ahora := time.Now()
	c.guardar(&events.Message{Info: types.MessageInfo{ID: "N1", Timestamp: ahora, PushName: "Ana", MessageSource: types.MessageSource{Chat: ana, Sender: ana}},
		Message: &waE2E.Message{Conversation: proto.String("¿Me mandas la cotización hoy?")}}, true)
	c.guardar(&events.Message{Info: types.MessageInfo{ID: "N2", Timestamp: ahora, MessageSource: types.MessageSource{Chat: ana, Sender: ana}},
		Message: &waE2E.Message{Conversation: proto.String("de la historia")}}, false)
	c.guardar(&events.Message{Info: types.MessageInfo{ID: "N3", Timestamp: ahora, MessageSource: types.MessageSource{Chat: ana, Sender: ana, IsFromMe: true}},
		Message: &waE2E.Message{Conversation: proto.String("mío")}}, true)
	// El mismo otra vez (WhatsApp lo reentrega): ya estaba guardado, no se vuelve a avisar.
	c.guardar(&events.Message{Info: types.MessageInfo{ID: "N1", Timestamp: ahora, MessageSource: types.MessageSource{Chat: ana, Sender: ana}},
		Message: &waE2E.Message{Conversation: proto.String("¿Me mandas la cotización hoy?")}}, true)
	select {
	case <-listo:
	case <-time.After(5 * time.Second):
		t.Fatal("el aviso no llegó")
	}
	time.Sleep(300 * time.Millisecond)
	mu.Lock()
	defer mu.Unlock()
	if len(llegados) != 1 || llegados[0].ID != "N1" || llegados[0].Chat != ana.String() || llegados[0].Texto != "¿Me mandas la cotización hoy?" || llegados[0].Cuenta != "legado" || llegados[0].NombreDe == "" {
		t.Fatalf("llegaron: %+v", llegados)
	}
}
