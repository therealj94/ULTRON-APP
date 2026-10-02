package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"database/sql"

	"go.mau.fi/whatsmeow/proto/waAdv"
	"go.mau.fi/whatsmeow/proto/waCommon"
	"go.mau.fi/whatsmeow/proto/waE2E"
	"go.mau.fi/whatsmeow/store/sqlstore"
	"go.mau.fi/whatsmeow/types"
	"go.mau.fi/whatsmeow/types/events"
	waLog "go.mau.fi/whatsmeow/util/log"
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
	// La foto de un álbum viene envuelta (associatedChild): se ve y se guarda el mensaje de adentro.
	album := &waE2E.Message{AssociatedChildMessage: &waE2E.FutureProofMessage{Message: &waE2E.Message{
		ImageMessage: &waE2E.ImageMessage{Caption: proto.String("playa"), Mimetype: proto.String("image/jpeg")}}}}
	got, crudo := Contenido(album)
	if got.Tipo != "imagen" || got.Texto != "playa" || proto.Unmarshal(crudo, &m) != nil || m.GetImageMessage() == nil {
		t.Fatalf("álbum: %+v", got)
	}
	// La nota de video (redonda) se guarda como un video que se puede bajar.
	got, crudo = Contenido(&waE2E.Message{PtvMessage: &waE2E.VideoMessage{Seconds: proto.Uint32(7)}})
	m.Reset()
	if got.Tipo != "video" || got.Duracion != 7 || proto.Unmarshal(crudo, &m) != nil || m.GetVideoMessage() == nil {
		t.Fatalf("nota de video: %+v", got)
	}
}

/* ------------------------------------------------- LID → número: un chat por persona, sin perder nada */

func TestFusionarLIDConNumero(t *testing.T) {
	a := almacenDePrueba(t)
	const lid, pn, grupo = "123456789@lid", "50499990000@s.whatsapp.net", "12036@g.us"
	t0 := time.Date(2026, 10, 2, 9, 0, 0, 0, time.UTC)
	// De la historia: el chat por número, con nombre y un mensaje.
	must(t, a.GuardarChat(pn, "Beto", false, t0))
	_, _ = a.GuardarMensaje(Mensaje{ID: "H1", Chat: pn, De: pn, Hora: t0.UnixMilli(), Tipo: "imagen"}, nil, nil)
	must(t, a.FijarNoLeidos(pn, 1))
	// En vivo: el mismo Beto por LID (sin nombre), con el mismo H1 (pero este sí trae el archivo), uno
	// nuevo y uno que borró.
	must(t, a.GuardarChat(lid, "", false, t0.Add(time.Hour)))
	_, _ = a.GuardarMensaje(Mensaje{ID: "H1", Chat: lid, De: lid, Hora: t0.UnixMilli(), Tipo: "imagen"}, []byte{7}, []byte("crudo"))
	_, _ = a.GuardarMensaje(Mensaje{ID: "L1", Chat: lid, De: lid, Hora: t0.Add(time.Hour).UnixMilli(), Tipo: "texto", Texto: "¿y?"}, nil, nil)
	_, _ = a.GuardarMensaje(Mensaje{ID: "L2", Chat: lid, De: lid, Hora: t0.Add(30 * time.Minute).UnixMilli(), Tipo: "texto", Texto: "ups"}, nil, nil)
	must(t, a.Eliminar(lid, "L2"))
	must(t, a.SumarNoLeido(lid))
	must(t, a.SumarNoLeido(lid))
	// Y en un grupo escribió por LID.
	must(t, a.GuardarChat(grupo, "Familia", true, t0))
	_, _ = a.GuardarMensaje(Mensaje{ID: "G1", Chat: grupo, De: lid, Hora: t0.UnixMilli(), Tipo: "texto", Texto: "hola"}, nil, nil)

	ids, err := a.IDsLID()
	must(t, err)
	if len(ids) != 1 || ids[0] != lid {
		t.Fatalf("ids LID: %v", ids)
	}
	must(t, a.Fusionar(lid, pn))
	must(t, a.Fusionar(lid, pn)) // otra vez: no cambia nada

	chats, _ := a.Chats(10, "")
	if len(chats) != 2 {
		t.Fatalf("un chat por persona: %+v", chats)
	}
	beto := chats[0]
	if beto.JID != pn || beto.Nombre != "Beto" || beto.NoLeidos != 3 || beto.Hora != t0.Add(time.Hour).UnixMilli() || beto.Numero != "+50499990000" {
		t.Fatalf("chat fusionado: %+v", beto)
	}
	if beto.Ultimo != "¿y?" {
		t.Fatalf("último: %+v", beto)
	}
	ms, _ := a.Mensajes(pn, 10, 0)
	if len(ms) != 3 {
		t.Fatalf("sin repetidos ni perdidos: %+v", ms)
	}
	porID := map[string]Mensaje{}
	for _, m := range ms {
		porID[m.ID] = m
	}
	if !porID["H1"].ConMedia || porID["H1"].Miniatura == "" {
		t.Fatalf("el repetido se queda con el archivo: %+v", porID["H1"])
	}
	if !porID["L2"].Eliminado || porID["L1"].ChatWA != lid || porID["L1"].De != pn || porID["L1"].DeWA != lid {
		t.Fatalf("mudados: %+v", porID)
	}
	// El LID viejo sigue sirviendo (la app pudo haberlo guardado) y lo que llegue por él va al número.
	if ms2, _ := a.Mensajes(lid, 10, 0); len(ms2) != 3 {
		t.Fatalf("el alias no resuelve: %d", len(ms2))
	}
	if c, ok := a.Chat(lid); !ok || c.JID != pn {
		t.Fatalf("chat por alias: %+v", c)
	}
	nuevo, _ := a.GuardarMensaje(Mensaje{ID: "L3", Chat: lid, De: lid, Hora: t0.Add(2 * time.Hour).UnixMilli(), Tipo: "texto", Texto: "ya"}, nil, nil)
	must(t, a.GuardarChat(lid, "", false, t0.Add(2*time.Hour)))
	if ms, _ := a.Mensajes(pn, 10, 0); !nuevo || len(ms) != 4 || ms[3].ChatWA != lid {
		t.Fatalf("lo nuevo por LID: %+v", ms)
	}
	if c, _ := a.Chats(10, ""); len(c) != 2 {
		t.Fatalf("no reaparece el chat del LID: %+v", c)
	}
	gs, _ := a.Mensajes(grupo, 10, 0)
	if gs[0].De != pn || gs[0].DeWA != lid {
		t.Fatalf("remitente del grupo: %+v", gs[0])
	}
	if ids, _ := a.IDsLID(); len(ids) != 0 {
		t.Fatalf("quedaron LIDs: %v", ids)
	}
	// Buscar por número, con espacios y guiones.
	if c, _ := a.Chats(10, "+504 9999-0000"); len(c) != 1 || c[0].JID != pn {
		t.Fatalf("buscar por número: %+v", c)
	}
}

func TestFusionarSoloElLID(t *testing.T) {
	// Si solo existía el chat del LID (nunca hubo uno por número), se muda entero con su nombre.
	a := almacenDePrueba(t)
	t0 := time.Now()
	must(t, a.GuardarChat("9@lid", "Ana", false, t0))
	_, _ = a.GuardarMensaje(Mensaje{ID: "x", Chat: "9@lid", De: "9@lid", Hora: t0.UnixMilli(), Tipo: "texto", Texto: "hola"}, nil, nil)
	must(t, a.Fusionar("9@lid", "5049@s.whatsapp.net"))
	c, _ := a.Chats(10, "")
	if len(c) != 1 || c[0].JID != "5049@s.whatsapp.net" || c[0].Nombre != "Ana" || c[0].Ultimo != "hola" {
		t.Fatalf("%+v", c)
	}
	// Un número guardado como nombre se cambia por un nombre de verdad, pero un nombre no se pisa.
	must(t, a.GuardarChat("504777@s.whatsapp.net", "+504777", false, t0))
	if ok, _ := a.MejorarNombre("504777@s.whatsapp.net", "Luis"); !ok {
		t.Fatal("el número debía cambiarse por el nombre")
	}
	if ok, _ := a.MejorarNombre("504777@s.whatsapp.net", "Luisito"); ok {
		t.Fatal("un nombre no se pisa con MejorarNombre")
	}
	must(t, a.FijarNombre("504777@s.whatsapp.net", "Luis Pérez"))
	if c, _ := a.Chat("504777@s.whatsapp.net"); c.Nombre != "Luis Pérez" {
		t.Fatalf("el de contactos manda: %+v", c)
	}
	must(t, a.GuardarChat("504888@s.whatsapp.net", "", false, t0))
	sin, _ := a.ChatsSinNombre(10)
	if len(sin) != 1 || sin[0].JID != "504888@s.whatsapp.net" {
		t.Fatalf("sin nombre: %+v", sin)
	}
}

func TestNombreNuncaVacio(t *testing.T) {
	casos := []struct {
		c    Chat
		want string
	}{
		{Chat{Nombre: "Beto"}, "Beto"},
		{Chat{Numero: "+50499990000"}, "+50499990000"},
		{Chat{Grupo: true}, "Grupo"},
		{Chat{}, "Contacto"},
		{Chat{Nombre: "  ", Numero: "+1"}, "+1"},
	}
	for _, k := range casos {
		if got := nombreVisible(k.c); got != k.want {
			t.Fatalf("%+v → %q", k.c, got)
		}
	}
	for jid, want := range map[string]string{"50499990000@s.whatsapp.net": "+50499990000", "50499990000:12@s.whatsapp.net": "+50499990000", "123@lid": "", "12036@g.us": "", "raro": ""} {
		if numeroDe(jid) != want {
			t.Fatalf("numeroDe(%s) = %q", jid, numeroDe(jid))
		}
	}
	if !esNumero("+504 9999-0000") || esNumero("Beto 2") || esNumero("") {
		t.Fatal("esNumero")
	}
}

func TestCacheFotos(t *testing.T) {
	dir := t.TempDir()
	var llamadas atomic.Int32
	falla := false
	f := NuevaCacheFotos(dir, func(ctx context.Context, chat string) ([]byte, error) {
		llamadas.Add(1)
		time.Sleep(20 * time.Millisecond)
		switch {
		case falla:
			return nil, errors.New("sin red")
		case chat == "sinfoto":
			return nil, ErrSinFoto
		}
		return []byte("JPG:" + chat), nil
	})
	if f.Conocida("a") != nil {
		t.Fatal("antes de preguntar no se sabe")
	}
	// Muchos pedidos a la vez de la misma foto: a WhatsApp se le pregunta una vez.
	var wg sync.WaitGroup
	for i := 0; i < 10; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if b, err := f.Foto("a"); err != nil || string(b) != "JPG:a" {
				t.Errorf("foto: %q %v", b, err)
			}
		}()
	}
	wg.Wait()
	if n := llamadas.Load(); n != 1 {
		t.Fatalf("preguntó %d veces", n)
	}
	if k := f.Conocida("a"); k == nil || !*k {
		t.Fatal("ya se sabe que tiene")
	}
	if _, err := f.Foto("sinfoto"); !errors.Is(err, ErrSinFoto) {
		t.Fatalf("sin foto: %v", err)
	}
	if _, err := f.Foto("sinfoto"); !errors.Is(err, ErrSinFoto) || llamadas.Load() != 2 {
		t.Fatalf("«no tiene» se recuerda: %d", llamadas.Load())
	}
	if k := f.Conocida("sinfoto"); k == nil || *k {
		t.Fatal("ya se sabe que no tiene")
	}
	// Vencida y sin red: mejor la vieja que nada; sin vieja, el error.
	foto, _ := f.rutas("a")
	viejo := time.Now().Add(-25 * time.Hour)
	must(t, os.Chtimes(foto, viejo, viejo))
	falla = true
	if b, err := f.Foto("a"); err != nil || string(b) != "JPG:a" {
		t.Fatalf("la vieja: %q %v", b, err)
	}
	if _, err := f.Foto("b"); err == nil || errors.Is(err, ErrSinFoto) {
		t.Fatalf("sin red no es «no tiene foto»: %v", err)
	}
	f.Borrar()
	if f.Conocida("a") != nil {
		t.Fatal("al desvincular no quedan fotos")
	}
}

/* ----------------------------------------------------------------- la API, con una cuenta falsa */

type cuentaFalsa struct {
	estado   EstadoCuenta
	enviados []string
	leidos   []string
	errEnvio error
	alm      *Almacen
	nombres  map[string]string
}

func (c *cuentaFalsa) Nombre(jid string) string { return c.nombres[jid] }
func (c *cuentaFalsa) FotoConocida(chat string) *bool {
	if chat == "504@s.whatsapp.net" {
		v := true
		return &v
	}
	return nil
}
func (c *cuentaFalsa) Foto(chat string) ([]byte, error) {
	switch chat {
	case "504@s.whatsapp.net":
		return []byte("FOTO"), nil
	case "apagado@s.whatsapp.net":
		return nil, ErrSinVincular
	}
	return nil, ErrSinFoto
}
func (c *cuentaFalsa) Contactos(buscar string, limite int) ([]Contacto, error) {
	todos := []Contacto{{JID: "50411112222@s.whatsapp.net", Nombre: "Mamá", Numero: "+50411112222"}, {JID: "504@s.whatsapp.net", Nombre: "Beto", Numero: "+504"}}
	out := []Contacto{}
	for _, k := range todos {
		if strings.Contains(strings.ToLower(k.Nombre), strings.ToLower(buscar)) && len(out) < limite {
			out = append(out, k)
		}
	}
	return out, nil
}

func (c *cuentaFalsa) Estado() EstadoCuenta          { return c.estado }
func (c *cuentaFalsa) VincularQR() (string, error)   { return "data:image/png;base64,QR", nil }
func (c *cuentaFalsa) Desvincular() error            { c.estado = EstadoCuenta{}; return c.alm.Borrar() }
func (c *cuentaFalsa) MarcarLeido(chat string) error { c.leidos = append(c.leidos, chat); return nil }
func (c *cuentaFalsa) Media(chat, id string) ([]byte, string, error) {
	if id == "foto" {
		return []byte("JPG"), "image/jpeg", nil
	}
	if id == "video-enorme" {
		return nil, "", ErrMediaGrande
	}
	if id == "vieja" {
		return nil, "", ErrMediaVencida
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
	if w.Header().Get("Content-Length") != "3" {
		t.Fatalf("media sin Content-Length: %q", w.Header().Get("Content-Length"))
	}
	if c, _ := pedir(t, h, "GET", "/media?chat=c&id=video-enorme", claveDePrueba, nil); c != 413 {
		t.Fatalf("un archivo enorme no se baja: %d", c)
	}
	if c, j := pedir(t, h, "GET", "/media?chat=c&id=vieja", claveDePrueba, nil); c != 410 || !strings.Contains(j["error"].(string), "ábrela en tu teléfono") {
		t.Fatalf("una foto vencida lo dice claro: %d %v", c, j)
	}
	if c, _ := pedir(t, h, "POST", "/desvincular", claveDePrueba, nil); c != 200 {
		t.Fatal("desvincular")
	}
	if c, j := pedir(t, h, "GET", "/chats", claveDePrueba, nil); c != 200 || len(j["chats"].([]any)) != 0 {
		t.Fatal("al desvincular se borra todo")
	}
}

func TestAPIChatsNombresYFotos(t *testing.T) {
	alm := almacenDePrueba(t)
	cuenta := &cuentaFalsa{alm: alm, nombres: map[string]string{"50422223333@s.whatsapp.net": "Lucía", "50411112222@s.whatsapp.net": "Mamá"}}
	h := (&API{clave: claveDePrueba, cuenta: cuenta, almacen: alm}).Rutas()
	t0 := time.Now()
	for i, c := range []struct {
		jid, nombre string
		grupo       bool
	}{
		{"504@s.whatsapp.net", "Beto", false},
		{"50422223333@s.whatsapp.net", "+50422223333", false}, // se guardó el número: ahora ya se sabe el nombre
		{"50455556666@s.whatsapp.net", "", false},             // nadie sabe quién es: su número
		{"777@lid", "", false},                                // ni el número: «Contacto»
		{"12036@g.us", "", true},                              // grupo sin nombre todavía: «Grupo»
	} {
		must(t, alm.GuardarChat(c.jid, c.nombre, c.grupo, t0.Add(-time.Duration(i)*time.Minute)))
	}
	_, _ = alm.GuardarMensaje(Mensaje{ID: "g1", Chat: "12036@g.us", De: "50411112222@s.whatsapp.net", NombreDe: "+50411112222", Hora: t0.UnixMilli(), Tipo: "texto", Texto: "hola"}, nil, nil)
	_, _ = alm.GuardarMensaje(Mensaje{ID: "g2", Chat: "12036@g.us", De: "50499998888@s.whatsapp.net", Hora: t0.UnixMilli() - 1, Tipo: "texto", Texto: "qué tal"}, nil, nil)
	c, j := pedir(t, h, "GET", "/chats", claveDePrueba, nil)
	if c != 200 {
		t.Fatalf("chats: %d", c)
	}
	chats := j["chats"].([]any)
	if len(chats) != 5 {
		t.Fatalf("ningún chat se cae por no tener nombre: %v", chats)
	}
	por := map[string]map[string]any{}
	for _, x := range chats {
		m := x.(map[string]any)
		por[m["jid"].(string)] = m
		if m["nombre"] == "" {
			t.Fatalf("nombre vacío: %v", m)
		}
	}
	for jid, want := range map[string][2]string{
		"504@s.whatsapp.net":         {"Beto", "+504"},
		"50422223333@s.whatsapp.net": {"Lucía", "+50422223333"},
		"50455556666@s.whatsapp.net": {"+50455556666", "+50455556666"},
		"777@lid":                    {"Contacto", ""},
		"12036@g.us":                 {"Grupo", ""},
	} {
		if por[jid]["nombre"] != want[0] || por[jid]["numero"] != want[1] {
			t.Fatalf("%s: %v", jid, por[jid])
		}
	}
	if por["12036@g.us"]["ultimoDe"] != "Mamá" {
		t.Fatalf("quién mandó lo último en el grupo: %v", por["12036@g.us"])
	}
	if por["504@s.whatsapp.net"]["foto"] != true || por["777@lid"]["foto"] != nil {
		t.Fatalf("pista de foto: %v %v", por["504@s.whatsapp.net"]["foto"], por["777@lid"]["foto"])
	}
	// El nombre que apareció se guardó (para buscarlo, y para la próxima).
	if ch, _ := alm.Chat("50422223333@s.whatsapp.net"); ch.Nombre != "Lucía" {
		t.Fatalf("no se guardó: %+v", ch)
	}
	c, j = pedir(t, h, "GET", "/mensajes?chat=12036@g.us", claveDePrueba, nil)
	ms := j["mensajes"].([]any)
	if c != 200 || ms[0].(map[string]any)["nombreDe"] != "+50499998888" || ms[1].(map[string]any)["nombreDe"] != "Mamá" || j["chat"].(map[string]any)["nombre"] != "Grupo" {
		t.Fatalf("mensajes: %d %v", c, j)
	}

	// La foto de perfil: JPEG con su tamaño, 404 si no tiene, 412 sin vincular, 400 sin chat, y con clave.
	r := httptest.NewRequest("GET", "/foto?chat=504@s.whatsapp.net", nil)
	r.Header.Set("Authorization", "Bearer "+claveDePrueba)
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	if w.Code != 200 || w.Header().Get("Content-Type") != "image/jpeg" || w.Header().Get("Content-Length") != "4" || w.Body.String() != "FOTO" {
		t.Fatalf("foto: %d %v %q", w.Code, w.Header(), w.Body.String())
	}
	if c, _ := pedir(t, h, "GET", "/foto?chat=777@lid", claveDePrueba, nil); c != 404 {
		t.Fatalf("sin foto: %d", c)
	}
	if c, _ := pedir(t, h, "GET", "/foto?chat=apagado@s.whatsapp.net", claveDePrueba, nil); c != 412 {
		t.Fatalf("sin vincular: %d", c)
	}
	if c, _ := pedir(t, h, "GET", "/foto", claveDePrueba, nil); c != 400 {
		t.Fatalf("sin chat: %d", c)
	}
	if c, _ := pedir(t, h, "GET", "/foto?chat=504@s.whatsapp.net", "", nil); c != 401 {
		t.Fatalf("sin clave: %d", c)
	}
	c, j = pedir(t, h, "GET", "/contactos?buscar=mam", claveDePrueba, nil)
	if cs := j["contactos"].([]any); c != 200 || len(cs) != 1 || cs[0].(map[string]any)["numero"] != "+50411112222" {
		t.Fatalf("contactos: %d %v", c, j)
	}
}

// Una base de antes (sin chat_wa/de_wa ni alias) se abre y se pone al día sola.
func TestAlmacenViejoSeActualiza(t *testing.T) {
	ruta := filepath.Join(t.TempDir(), "viejo.db")
	db, err := sql.Open("sqlite3", "file:"+ruta)
	must(t, err)
	_, err = db.Exec(`CREATE TABLE mensajes (id TEXT NOT NULL, chat TEXT NOT NULL, de TEXT NOT NULL DEFAULT '', nombre_de TEXT NOT NULL DEFAULT '',
		mio INTEGER NOT NULL DEFAULT 0, hora INTEGER NOT NULL, tipo TEXT NOT NULL DEFAULT 'texto', texto TEXT NOT NULL DEFAULT '', miniatura BLOB,
		duracion INTEGER NOT NULL DEFAULT 0, archivo TEXT NOT NULL DEFAULT '', crudo BLOB, eliminado INTEGER NOT NULL DEFAULT 0,
		editado INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (id, chat));
		INSERT INTO mensajes (id, chat, hora, texto) VALUES ('v1', 'c', 1, 'de antes');`)
	must(t, err)
	db.Close()
	for i := 0; i < 2; i++ { // y abrirla otra vez no falla
		a, err := AbrirAlmacen(ruta)
		must(t, err)
		ms, err := a.Mensajes("c", 10, 0)
		if err != nil || len(ms) != 1 || ms[0].Texto != "de antes" {
			t.Fatalf("%v %+v", err, ms)
		}
		a.Cerrar()
	}
}

/* ------------------------------------- la cuenta, con el almacén real de whatsmeow (sin red) */

func cuentaDePrueba(t *testing.T) (*CuentaWA, *Almacen) {
	t.Helper()
	ctx := context.Background()
	alm := almacenDePrueba(t)
	cont, err := sqlstore.New(ctx, "sqlite3", "file:"+filepath.Join(t.TempDir(), "s.db")+"?_foreign_keys=on", waLog.Noop)
	must(t, err)
	dev := cont.NewDevice()
	dev.ID = &types.JID{User: "50488887777", Server: types.DefaultUserServer}
	dev.Account = &waAdv.ADVSignedDeviceIdentity{Details: []byte{0}, AccountSignature: make([]byte, 64), AccountSignatureKey: make([]byte, 32), DeviceSignature: make([]byte, 64)}
	must(t, cont.PutDevice(ctx, dev))
	c := &CuentaWA{contenedor: cont, alm: alm, log: waLog.Noop, orden: make(chan struct{}, 1), web: http.DefaultClient}
	c.fotos = NuevaCacheFotos(t.TempDir(), func(context.Context, string) ([]byte, error) { return nil, ErrSinFoto })
	c.usar(dev)
	return c, alm
}

func TestCuentaLIDNombresYOrden(t *testing.T) {
	c, alm := cuentaDePrueba(t)
	ctx := context.Background()
	st := c.cli.Store
	lid := types.JID{User: "111", Server: types.HiddenUserServer}
	pn := types.JID{User: "50499990000", Server: types.DefaultUserServer}
	lid2 := types.JID{User: "222", Server: types.HiddenUserServer}
	pn2 := types.JID{User: "50433334444", Server: types.DefaultUserServer}
	grupo := types.JID{User: "12036", Server: types.GroupServer}
	t0 := time.Now().Add(-time.Hour)

	// Antes de saber su número: llega por LID y se guarda así (sin nombre que inventar).
	c.guardar(&events.Message{Info: types.MessageInfo{ID: "L1", Timestamp: t0, MessageSource: types.MessageSource{Chat: lid, Sender: lid}},
		Message: &waE2E.Message{Conversation: proto.String("¿me oyes?")}}, true)
	// La historia ya tenía el chat por número, sin nombre.
	must(t, alm.GuardarChat(pn.String(), "", false, t0.Add(-time.Hour)))
	if ch, _ := alm.Chats(10, ""); len(ch) != 2 {
		t.Fatalf("antes del orden: %+v", ch)
	}

	// Aparecen su número (tabla de LIDs) y su nombre en contactos; de otro, solo como se puso (por su LID).
	must(t, st.LIDs.PutLIDMapping(ctx, lid, pn))
	must(t, st.Contacts.PutContactName(ctx, pn, "Beto", "Beto Pérez"))
	must(t, st.LIDs.PutLIDMapping(ctx, lid2, pn2))
	_, _, err := st.Contacts.PutPushName(ctx, lid2, "Ani")
	must(t, err)
	if c.canonico(lid, types.EmptyJID) != pn || c.canonico(grupo, types.EmptyJID) != grupo {
		t.Fatal("canónico")
	}
	if n := c.nombreDe(lid, ""); n != "Beto Pérez" {
		t.Fatalf("nombre por el LID: %q", n)
	}
	if n := c.nombreDe(pn2, ""); n != "Ani" {
		t.Fatalf("como se puso, guardado por LID: %q", n)
	}
	if n := c.nombreDe(types.JID{User: "50400000000", Server: types.DefaultUserServer}, ""); n != "" {
		t.Fatalf("un desconocido no tiene nombre inventado: %q", n)
	}

	c.ordenar()
	ch, _ := alm.Chats(10, "")
	if len(ch) != 1 || ch[0].JID != pn.String() || ch[0].Nombre != "Beto Pérez" || ch[0].NoLeidos != 1 || ch[0].Ultimo != "¿me oyes?" {
		t.Fatalf("después del orden: %+v", ch)
	}

	// Lo que llega ahora por LID (con el número al lado) va directo al chat del número.
	c.guardar(&events.Message{Info: types.MessageInfo{ID: "L2", Timestamp: t0.Add(time.Minute), PushName: "Betito",
		MessageSource: types.MessageSource{Chat: lid, Sender: lid, SenderAlt: pn}},
		Message: &waE2E.Message{ImageMessage: &waE2E.ImageMessage{Mimetype: proto.String("image/jpeg"), JPEGThumbnail: []byte{1}}}}, true)
	// Y en un grupo, escribe Ani por LID.
	c.nombres.Store(grupo.String(), "Familia")
	c.guardar(&events.Message{Info: types.MessageInfo{ID: "G1", Timestamp: t0, MessageSource: types.MessageSource{Chat: grupo, Sender: lid2, IsGroup: true}},
		Message: &waE2E.Message{Conversation: proto.String("hola a todos")}}, true)
	ms, _ := alm.Mensajes(pn.String(), 10, 0)
	if len(ms) != 2 || ms[1].ID != "L2" || ms[1].NombreDe != "Beto Pérez" || !ms[1].ConMedia || ms[1].ChatWA != lid.String() {
		t.Fatalf("en vivo por LID: %+v", ms)
	}
	gs, _ := alm.Mensajes(grupo.String(), 10, 0)
	if len(gs) != 1 || gs[0].De != pn2.String() || gs[0].NombreDe != "Ani" || gs[0].DeWA != lid2.String() {
		t.Fatalf("grupo: %+v", gs)
	}
	if c.Nombre(grupo.String()) != "Familia" || c.Nombre(lid.String()) != "Beto Pérez" {
		t.Fatal("Nombre()")
	}
	// El borrado que llega por LID encuentra el mensaje guardado con el número.
	c.guardar(&events.Message{Info: types.MessageInfo{ID: "R1", Timestamp: t0, MessageSource: types.MessageSource{Chat: lid, Sender: lid}},
		Message: &waE2E.Message{ProtocolMessage: &waE2E.ProtocolMessage{Type: waE2E.ProtocolMessage_REVOKE.Enum(), Key: &waCommon.MessageKey{ID: proto.String("L1")}}}}, true)
	if ms, _ := alm.Mensajes(pn.String(), 10, 0); !ms[0].Eliminado {
		t.Fatalf("borrado por LID: %+v", ms[0])
	}
	// Sin vincular, la foto no se pide y el leído queda aquí.
	if _, err := c.Foto(pn.String()); !errors.Is(err, ErrSinVincular) {
		t.Fatalf("foto sin vincular: %v", err)
	}
	must(t, c.MarcarLeido(lid.String()))
	if ch, _ := alm.Chat(pn.String()); ch.NoLeidos != 0 {
		t.Fatalf("leído por el LID viejo: %+v", ch)
	}
}

func must(t *testing.T, err error) {
	t.Helper()
	if err != nil {
		t.Fatal(err)
	}
}
