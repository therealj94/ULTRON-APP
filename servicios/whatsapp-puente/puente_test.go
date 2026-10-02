package main

import (
	"bytes"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"go.mau.fi/whatsmeow/proto/waE2E"
	"google.golang.org/protobuf/proto"
)

func almacenDePrueba(t *testing.T) *Almacen {
	t.Helper()
	a, err := AbrirAlmacen(filepath.Join(t.TempDir(), "m.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { a.Cerrar() })
	return a
}

func TestAlmacenChatsYMensajes(t *testing.T) {
	a := almacenDePrueba(t)
	t0 := time.Date(2026, 10, 2, 9, 0, 0, 0, time.UTC)
	must(t, a.GuardarChat("50499990000@s.whatsapp.net", "Beto", false, t0))
	must(t, a.GuardarChat("12036@g.us", "Familia", true, t0.Add(time.Minute)))
	// Un nombre vacío no borra el que había, y la hora solo avanza.
	must(t, a.GuardarChat("50499990000@s.whatsapp.net", "", false, t0.Add(-time.Hour)))
	nuevo, err := a.GuardarMensaje(Mensaje{ID: "A1", Chat: "50499990000@s.whatsapp.net", De: "50499990000@s.whatsapp.net", NombreDe: "Beto", Hora: t0.UnixMilli(), Tipo: "texto", Texto: "¿Llegas a la reunión de las tres?"}, nil, nil)
	if err != nil || !nuevo {
		t.Fatalf("nuevo=%v err=%v", nuevo, err)
	}
	// El mismo mensaje otra vez (la historia repite lo que llegó en vivo) no se duplica ni se pisa.
	nuevo, _ = a.GuardarMensaje(Mensaje{ID: "A1", Chat: "50499990000@s.whatsapp.net", Hora: t0.UnixMilli(), Tipo: "texto", Texto: "otro"}, nil, nil)
	if nuevo {
		t.Fatal("se duplicó")
	}
	_, _ = a.GuardarMensaje(Mensaje{ID: "G1", Chat: "12036@g.us", De: "50411112222@s.whatsapp.net", NombreDe: "Mamá", Hora: t0.Add(time.Minute).UnixMilli(), Tipo: "imagen", Texto: "mira"}, []byte{1, 2, 3}, []byte("crudo"))
	must(t, a.SumarNoLeido("12036@g.us"))
	must(t, a.SumarNoLeido("12036@g.us"))
	chats, err := a.Chats(10, "")
	must(t, err)
	if len(chats) != 2 || chats[0].Nombre != "Familia" || chats[1].Nombre != "Beto" {
		t.Fatalf("orden o nombres: %+v", chats)
	}
	if chats[0].Ultimo != "📷 Foto · mira" || chats[0].UltimoDe != "Mamá" || chats[0].NoLeidos != 2 || !chats[0].Grupo {
		t.Fatalf("vista previa del grupo: %+v", chats[0])
	}
	if chats[1].Ultimo != "¿Llegas a la reunión de las tres?" {
		t.Fatalf("vista previa: %+v", chats[1])
	}
	if c, _ := a.Chats(10, "bet"); len(c) != 1 || c[0].Nombre != "Beto" {
		t.Fatalf("buscar: %+v", c)
	}
	ms, err := a.Mensajes("12036@g.us", 10, 0)
	must(t, err)
	if len(ms) != 1 || ms[0].Miniatura != "AQID" || !ms[0].ConMedia {
		t.Fatalf("miniatura/media: %+v", ms)
	}
	// Editado y eliminado.
	must(t, a.Editar("50499990000@s.whatsapp.net", "A1", "¿Llegas a las cuatro?"))
	ms, _ = a.Mensajes("50499990000@s.whatsapp.net", 10, 0)
	if ms[0].Texto != "¿Llegas a las cuatro?" || !ms[0].Editado {
		t.Fatalf("editar: %+v", ms[0])
	}
	must(t, a.Eliminar("12036@g.us", "G1"))
	chats, _ = a.Chats(10, "")
	if chats[0].Ultimo != "🚫 Mensaje eliminado" {
		t.Fatalf("eliminar: %+v", chats[0])
	}
	if crudo, _, _ := a.Crudo("12036@g.us", "G1"); crudo != nil {
		t.Fatal("el archivo de un mensaje eliminado no se queda")
	}
	if r, _ := a.Buscar("cuatro", 5); len(r) != 1 || r[0].ID != "A1" {
		t.Fatalf("buscar en mensajes: %+v", r)
	}
	must(t, a.Borrar())
	if c, _ := a.Chats(10, ""); len(c) != 0 {
		t.Fatal("al desvincular no queda nada")
	}
}

func TestMensajesOrdenYPaginas(t *testing.T) {
	a := almacenDePrueba(t)
	for i := 1; i <= 5; i++ {
		_, _ = a.GuardarMensaje(Mensaje{ID: string(rune('a' + i)), Chat: "c", Hora: int64(i * 1000), Tipo: "texto", Texto: "m"}, nil, nil)
	}
	ms, _ := a.Mensajes("c", 3, 0)
	if len(ms) != 3 || ms[0].Hora != 3000 || ms[2].Hora != 5000 {
		t.Fatalf("los últimos 3, del más viejo al más nuevo: %+v", ms)
	}
	ms, _ = a.Mensajes("c", 3, 3000)
	if len(ms) != 2 || ms[1].Hora != 2000 {
		t.Fatalf("los anteriores: %+v", ms)
	}
}

func TestContenido(t *testing.T) {
	casos := []struct {
		m        *waE2E.Message
		tipo     string
		texto    string
		conCrudo bool
	}{
		{&waE2E.Message{Conversation: proto.String("hola")}, "texto", "hola", false},
		{&waE2E.Message{ExtendedTextMessage: &waE2E.ExtendedTextMessage{Text: proto.String("con enlace https://x.hn")}}, "texto", "con enlace https://x.hn", false},
		{&waE2E.Message{ImageMessage: &waE2E.ImageMessage{Caption: proto.String("la casa"), JPEGThumbnail: []byte{9}}}, "imagen", "la casa", true},
		{&waE2E.Message{AudioMessage: &waE2E.AudioMessage{Seconds: proto.Uint32(12), PTT: proto.Bool(true)}}, "audio", "", true},
		{&waE2E.Message{DocumentMessage: &waE2E.DocumentMessage{FileName: proto.String("contrato.pdf")}}, "documento", "", true},
		{&waE2E.Message{LocationMessage: &waE2E.LocationMessage{Name: proto.String("Parque Central")}}, "ubicacion", "Parque Central", false},
		{&waE2E.Message{ReactionMessage: &waE2E.ReactionMessage{Text: proto.String("👍")}}, "", "", false},
		{nil, "", "", false},
	}
	for i, c := range casos {
		got, crudo := Contenido(c.m)
		if got.Tipo != c.tipo || got.Texto != c.texto || (crudo != nil) != c.conCrudo {
			t.Fatalf("caso %d: %+v crudo=%v", i, got, crudo != nil)
		}
	}
	// El crudo se puede volver a leer para descargar la foto.
	_, crudo := Contenido(&waE2E.Message{ImageMessage: &waE2E.ImageMessage{Mimetype: proto.String("image/jpeg")}})
	var m waE2E.Message
	if proto.Unmarshal(crudo, &m) != nil || m.GetImageMessage().GetMimetype() != "image/jpeg" {
		t.Fatal("el crudo no se lee")
	}
	if got, _ := Contenido(&waE2E.Message{AudioMessage: &waE2E.AudioMessage{Seconds: proto.Uint32(12)}}); got.Duracion != 12 {
		t.Fatal("duración del audio")
	}
}

/* ----------------------------------------------------------------- la API, con una cuenta falsa */

type cuentaFalsa struct {
	estado   EstadoCuenta
	enviados []string
	leidos   []string
	errEnvio error
	alm      *Almacen
}

func (c *cuentaFalsa) Estado() EstadoCuenta            { return c.estado }
func (c *cuentaFalsa) VincularQR() (string, error)     { return "data:image/png;base64,QR", nil }
func (c *cuentaFalsa) Desvincular() error              { c.estado = EstadoCuenta{}; return c.alm.Borrar() }
func (c *cuentaFalsa) MarcarLeido(chat string) error   { c.leidos = append(c.leidos, chat); return nil }
func (c *cuentaFalsa) Media(chat, id string) ([]byte, string, error) {
	if id == "foto" {
		return []byte("JPG"), "image/jpeg", nil
	}
	return nil, "", errors.New("ese mensaje no tiene archivo")
}
func (c *cuentaFalsa) VincularCodigo(tel string) (string, error) {
	if c.estado.Vinculado {
		return "", ErrYaVinculado
	}
	return "ABCD-EFGH", nil
}
func (c *cuentaFalsa) Enviar(chat, texto string) (Mensaje, error) {
	if c.errEnvio != nil {
		return Mensaje{}, c.errEnvio
	}
	c.enviados = append(c.enviados, chat+"|"+texto)
	return Mensaje{ID: "E1", Chat: chat, Mio: true, Texto: texto, Tipo: "texto", Hora: ahoraMs()}, nil
}

const claveDePrueba = "clave-de-prueba-de-24-caracteres"

func pedir(t *testing.T, h http.Handler, metodo, ruta, clave string, cuerpo any) (int, map[string]any) {
	t.Helper()
	var b bytes.Buffer
	if cuerpo != nil {
		json.NewEncoder(&b).Encode(cuerpo)
	}
	r := httptest.NewRequest(metodo, ruta, &b)
	if clave != "" {
		r.Header.Set("Authorization", "Bearer "+clave)
	}
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	var j map[string]any
	_ = json.Unmarshal(w.Body.Bytes(), &j)
	return w.Code, j
}

func TestAPI(t *testing.T) {
	alm := almacenDePrueba(t)
	cuenta := &cuentaFalsa{alm: alm}
	h := (&API{clave: claveDePrueba, cuenta: cuenta, almacen: alm}).Rutas()

	if c, _ := pedir(t, h, "GET", "/salud", "", nil); c != 200 {
		t.Fatal("salud sin clave")
	}
	for _, clave := range []string{"", "mala", claveDePrueba + "x"} {
		if c, _ := pedir(t, h, "GET", "/chats", clave, nil); c != 401 {
			t.Fatalf("sin la clave correcta no entra (%q → %d)", clave, c)
		}
	}
	// Una API sin clave configurada no abre a nadie.
	h0 := (&API{clave: "", cuenta: cuenta, almacen: alm}).Rutas()
	if c, _ := pedir(t, h0, "GET", "/chats", "", nil); c != 401 {
		t.Fatal("sin clave configurada")
	}

	c, j := pedir(t, h, "POST", "/vincular", claveDePrueba, map[string]string{"telefono": "+504 9999-0000"})
	if c != 200 || j["codigo"] != "ABCD-EFGH" {
		t.Fatalf("código: %d %v", c, j)
	}
	if c, j := pedir(t, h, "POST", "/vincular", claveDePrueba, map[string]string{"telefono": "123"}); c != 400 || !strings.Contains(j["error"].(string), "código de país") {
		t.Fatalf("número corto: %d %v", c, j)
	}
	if c, j := pedir(t, h, "POST", "/vincular", claveDePrueba, nil); c != 200 || j["qr"] == "" {
		t.Fatalf("qr: %d %v", c, j)
	}
	cuenta.estado.Vinculado = true
	if c, _ := pedir(t, h, "POST", "/vincular", claveDePrueba, map[string]string{"telefono": "50499990000"}); c != 409 {
		t.Fatalf("ya vinculado: %d", c)
	}

	t0 := time.Now()
	_ = alm.GuardarChat("504@s.whatsapp.net", "Beto", false, t0)
	_, _ = alm.GuardarMensaje(Mensaje{ID: "m1", Chat: "504@s.whatsapp.net", De: "504@s.whatsapp.net", Hora: t0.UnixMilli(), Tipo: "texto", Texto: "hola José"}, nil, nil)
	c, j = pedir(t, h, "GET", "/chats", claveDePrueba, nil)
	if c != 200 || len(j["chats"].([]any)) != 1 {
		t.Fatalf("chats: %d %v", c, j)
	}
	c, j = pedir(t, h, "GET", "/mensajes?chat=504@s.whatsapp.net", claveDePrueba, nil)
	if c != 200 || len(j["mensajes"].([]any)) != 1 || j["chat"].(map[string]any)["nombre"] != "Beto" {
		t.Fatalf("mensajes: %d %v", c, j)
	}
	if c, _ := pedir(t, h, "GET", "/mensajes", claveDePrueba, nil); c != 400 {
		t.Fatal("mensajes sin chat")
	}
	if c, j := pedir(t, h, "GET", "/buscar?q=José", claveDePrueba, nil); c != 200 || len(j["mensajes"].([]any)) != 1 {
		t.Fatalf("buscar: %d %v", c, j)
	}
	if c, _ := pedir(t, h, "GET", "/buscar?q=a", claveDePrueba, nil); c != 400 {
		t.Fatal("buscar con una letra")
	}
	c, j = pedir(t, h, "POST", "/enviar", claveDePrueba, map[string]string{"chat": "504@s.whatsapp.net", "texto": "Sí llego"})
	if c != 200 || len(cuenta.enviados) != 1 || cuenta.enviados[0] != "504@s.whatsapp.net|Sí llego" {
		t.Fatalf("enviar: %d %v %v", c, j, cuenta.enviados)
	}
	if c, _ := pedir(t, h, "POST", "/enviar", claveDePrueba, map[string]string{"chat": "504@s.whatsapp.net", "texto": "  "}); c != 400 {
		t.Fatal("enviar vacío")
	}
	if c, _ := pedir(t, h, "POST", "/enviar", claveDePrueba, map[string]string{"chat": "x", "texto": strings.Repeat("a", 4001)}); c != 400 {
		t.Fatal("enviar muy largo")
	}
	cuenta.errEnvio = ErrSinVincular
	if c, _ := pedir(t, h, "POST", "/enviar", claveDePrueba, map[string]string{"chat": "x", "texto": "hola"}); c != 412 {
		t.Fatal("enviar sin vincular")
	}
	if c, _ := pedir(t, h, "POST", "/leido", claveDePrueba, map[string]string{"chat": "504@s.whatsapp.net"}); c != 200 || cuenta.leidos[0] != "504@s.whatsapp.net" {
		t.Fatal("leído")
	}
	r := httptest.NewRequest("GET", "/media?chat=c&id=foto", nil)
	r.Header.Set("Authorization", "Bearer "+claveDePrueba)
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	if w.Code != 200 || w.Header().Get("Content-Type") != "image/jpeg" || w.Body.String() != "JPG" {
		t.Fatalf("media: %d %s", w.Code, w.Header().Get("Content-Type"))
	}
	if c, _ := pedir(t, h, "POST", "/desvincular", claveDePrueba, nil); c != 200 {
		t.Fatal("desvincular")
	}
	if c, j := pedir(t, h, "GET", "/chats", claveDePrueba, nil); c != 200 || len(j["chats"].([]any)) != 0 {
		t.Fatal("al desvincular se borra todo")
	}
}

func must(t *testing.T, err error) {
	t.Helper()
	if err != nil {
		t.Fatal(err)
	}
}
