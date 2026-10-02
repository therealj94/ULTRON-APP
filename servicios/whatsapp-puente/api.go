package main

// LA API DEL PUENTE (solo la red privada de Render y con clave): lo que el servidor de AU-RA le pide.
//
//	GET  /salud                          sin clave: ¿vive?
//	GET  /estado                         vinculado, conectado, número; mientras vincula, el QR o el código
//	POST /vincular {telefono?}           con teléfono: un código de 8 letras (WhatsApp → Dispositivos
//	                                     vinculados → Vincular con número); sin teléfono: un QR
//	POST /desvincular                    cierra la sesión y borra todo lo guardado
//	GET  /chats?limite=&buscar=          los chats, el más reciente primero
//	GET  /mensajes?chat=&limite=&antes=  los de un chat, del más viejo al más nuevo
//	GET  /buscar?q=&limite=              en el texto de todos los chats
//	POST /enviar {chat, texto}           lo manda (el servidor solo lo llama con el «sí» de la persona)
//	POST /leido {chat}                   marca el chat como leído (también en su teléfono)
//	GET  /media?chat=&id=                la foto o el archivo de un mensaje (410 si ya no está en WhatsApp)
//	GET  /foto?chat=                     la foto de perfil del chat (JPEG chico; 404 si no tiene)
//	GET  /contactos?buscar=&limite=      la gente guardada en el teléfono (para empezar un chat)
//
// Los chats van con su id canónica: el número (…@s.whatsapp.net) siempre que se sepa, aunque WhatsApp los
// mande por LID (…@lid). Un LID viejo que ya se pasó al número sigue sirviendo en ?chat=.

import (
	"crypto/subtle"
	"encoding/base64"
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"strings"
	"time"
)

// Lo que hace la cuenta de WhatsApp (whatsmeow en wa.go; una falsa en las pruebas).
type Cuenta interface {
	Estado() EstadoCuenta
	VincularQR() (string, error)
	VincularCodigo(telefono string) (string, error)
	Desvincular() error
	Enviar(chat, texto string) (Mensaje, error)
	MarcarLeido(chat string) error
	Media(chat, id string) ([]byte, string, error)
	// La foto de perfil (ErrSinFoto si no tiene) y si ya se sabe sin preguntar (nil: no se sabe).
	Foto(chat string) ([]byte, error)
	FotoConocida(chat string) *bool
	// El nombre de un chat o de una persona con lo que ya se sabe (sin red); vacío si no se sabe.
	Nombre(jid string) string
	Contactos(buscar string, limite int) ([]Contacto, error)
}

type Contacto struct {
	JID    string `json:"jid"`
	Nombre string `json:"nombre"`
	Numero string `json:"numero"`
}

type EstadoCuenta struct {
	Vinculado  bool   `json:"vinculado"`
	Conectado  bool   `json:"conectado"`
	Numero     string `json:"numero,omitempty"`
	Nombre     string `json:"nombre,omitempty"`
	QR         string `json:"qr,omitempty"`
	Codigo     string `json:"codigo,omitempty"`
	Vinculando bool   `json:"vinculando"`
}

var ErrYaVinculado = errors.New("ya hay un WhatsApp vinculado: desvincúlalo primero")
var ErrSinVincular = errors.New("no hay un WhatsApp vinculado")

// Lo más grande que se baja de un mensaje (fotos, audios, videos cortos, documentos normales).
const MaxMedia = 16 << 20

var ErrMediaGrande = errors.New("ese archivo pesa más de 16 MB: ábrelo en tu teléfono")

// WhatsApp ya lo borró de su servidor y el teléfono no lo volvió a subir.
var ErrMediaVencida = errors.New("esa foto ya no está en WhatsApp; ábrela en tu teléfono")

type API struct {
	clave   string
	cuenta  Cuenta
	almacen *Almacen
}

func (a *API) Rutas() http.Handler {
	m := http.NewServeMux()
	m.HandleFunc("GET /salud", func(w http.ResponseWriter, r *http.Request) { escribir(w, 200, map[string]any{"ok": true}) })
	m.HandleFunc("GET /estado", a.con(func(w http.ResponseWriter, r *http.Request) { escribir(w, 200, a.cuenta.Estado()) }))
	m.HandleFunc("POST /vincular", a.con(a.vincular))
	m.HandleFunc("POST /desvincular", a.con(func(w http.ResponseWriter, r *http.Request) {
		if err := a.cuenta.Desvincular(); err != nil {
			fallo(w, 502, err)
			return
		}
		escribir(w, 200, map[string]any{"ok": true})
	}))
	m.HandleFunc("GET /chats", a.con(func(w http.ResponseWriter, r *http.Request) {
		chats, err := a.almacen.Chats(entre(r.URL.Query().Get("limite"), 60, 1, 300), r.URL.Query().Get("buscar"))
		if err != nil {
			fallo(w, 500, err)
			return
		}
		for i := range chats {
			a.completar(&chats[i])
		}
		escribir(w, 200, map[string]any{"chats": chats})
	}))
	m.HandleFunc("GET /mensajes", a.con(func(w http.ResponseWriter, r *http.Request) {
		q := r.URL.Query()
		chat := q.Get("chat")
		if chat == "" {
			fallo(w, 400, errors.New("falta el chat"))
			return
		}
		antes, _ := strconv.ParseInt(q.Get("antes"), 10, 64)
		ms, err := a.almacen.Mensajes(chat, entre(q.Get("limite"), 60, 1, 300), antes)
		if err != nil {
			fallo(w, 500, err)
			return
		}
		c, ok := a.almacen.Chat(chat)
		if ok {
			a.completar(&c)
		}
		// Quién mandó cada uno: si se guardó sin nombre (o con el número), se busca otra vez.
		nombres := map[string]string{}
		for i := range ms {
			m := &ms[i]
			if m.Mio || tieneNombre(m.NombreDe) {
				continue
			}
			n, visto := nombres[m.De]
			if !visto {
				n = a.cuenta.Nombre(m.De)
				nombres[m.De] = n
			}
			if tieneNombre(n) {
				m.NombreDe = n
			} else if m.NombreDe == "" {
				m.NombreDe = numeroDe(m.De)
			}
		}
		escribir(w, 200, map[string]any{"chat": c, "mensajes": ms})
	}))
	m.HandleFunc("GET /buscar", a.con(func(w http.ResponseWriter, r *http.Request) {
		t := strings.TrimSpace(r.URL.Query().Get("q"))
		if len([]rune(t)) < 2 {
			fallo(w, 400, errors.New("¿qué busco? (al menos dos letras)"))
			return
		}
		ms, err := a.almacen.Buscar(t, entre(r.URL.Query().Get("limite"), 20, 1, 100))
		if err != nil {
			fallo(w, 500, err)
			return
		}
		escribir(w, 200, map[string]any{"mensajes": ms})
	}))
	m.HandleFunc("POST /enviar", a.con(a.enviar))
	m.HandleFunc("POST /leido", a.con(func(w http.ResponseWriter, r *http.Request) {
		var c struct {
			Chat string `json:"chat"`
		}
		if json.NewDecoder(r.Body).Decode(&c) != nil || c.Chat == "" {
			fallo(w, 400, errors.New("falta el chat"))
			return
		}
		if err := a.cuenta.MarcarLeido(c.Chat); err != nil {
			fallo(w, 502, err)
			return
		}
		escribir(w, 200, map[string]any{"ok": true})
	}))
	m.HandleFunc("GET /media", a.con(func(w http.ResponseWriter, r *http.Request) {
		datos, tipo, err := a.cuenta.Media(r.URL.Query().Get("chat"), r.URL.Query().Get("id"))
		if errors.Is(err, ErrMediaGrande) {
			fallo(w, 413, err)
			return
		}
		if errors.Is(err, ErrMediaVencida) {
			fallo(w, 410, err)
			return
		}
		if errors.Is(err, ErrSinVincular) {
			fallo(w, 412, err)
			return
		}
		if err != nil {
			fallo(w, 404, err)
			return
		}
		w.Header().Set("Content-Type", tipo)
		w.Header().Set("Content-Length", strconv.Itoa(len(datos)))
		w.Header().Set("Cache-Control", "private, max-age=3600")
		w.Write(datos)
	}))
	m.HandleFunc("GET /foto", a.con(func(w http.ResponseWriter, r *http.Request) {
		chat := r.URL.Query().Get("chat")
		if chat == "" {
			fallo(w, 400, errors.New("falta el chat"))
			return
		}
		datos, err := a.cuenta.Foto(chat)
		switch {
		case errors.Is(err, ErrSinFoto):
			fallo(w, 404, err)
			return
		case err != nil:
			fallo(w, codigoDe(err), err)
			return
		}
		w.Header().Set("Content-Type", "image/jpeg")
		w.Header().Set("Content-Length", strconv.Itoa(len(datos)))
		w.Header().Set("Cache-Control", "private, max-age=3600")
		w.Write(datos)
	}))
	m.HandleFunc("GET /contactos", a.con(func(w http.ResponseWriter, r *http.Request) {
		cs, err := a.cuenta.Contactos(r.URL.Query().Get("buscar"), entre(r.URL.Query().Get("limite"), 100, 1, 500))
		if err != nil {
			fallo(w, codigoDe(err), err)
			return
		}
		escribir(w, 200, map[string]any{"contactos": cs})
	}))
	return m
}

// Antes de mostrar un chat: si no tiene nombre de verdad se busca otra vez (y se guarda si apareció);
// nunca sale sin nombre. También el de quien mandó lo último en un grupo, y si ya se sabe si tiene foto.
func (a *API) completar(c *Chat) {
	if !tieneNombre(c.Nombre) {
		if n := a.cuenta.Nombre(c.JID); tieneNombre(n) {
			c.Nombre = n
			_, _ = a.almacen.MejorarNombre(c.JID, n)
		}
	}
	c.Nombre = nombreVisible(*c)
	if c.Grupo && !c.UltimoMio && c.ultimoDeJID != "" && !tieneNombre(c.UltimoDe) {
		if n := a.cuenta.Nombre(c.ultimoDeJID); tieneNombre(n) {
			c.UltimoDe = n
		} else if c.UltimoDe == "" {
			c.UltimoDe = numeroDe(c.ultimoDeJID)
		}
	}
	c.Foto = a.cuenta.FotoConocida(c.JID)
}

func (a *API) vincular(w http.ResponseWriter, r *http.Request) {
	var c struct {
		Telefono string `json:"telefono"`
	}
	_ = json.NewDecoder(r.Body).Decode(&c)
	if c.Telefono != "" {
		tel := soloDigitos(c.Telefono)
		if len(tel) < 8 || len(tel) > 15 {
			fallo(w, 400, errors.New("escribe tu número con el código de país, por ejemplo 504 9999 9999"))
			return
		}
		codigo, err := a.cuenta.VincularCodigo(tel)
		if err != nil {
			fallo(w, codigoDe(err), err)
			return
		}
		escribir(w, 200, map[string]any{"codigo": codigo})
		return
	}
	qr, err := a.cuenta.VincularQR()
	if err != nil {
		fallo(w, codigoDe(err), err)
		return
	}
	escribir(w, 200, map[string]any{"qr": qr})
}

func (a *API) enviar(w http.ResponseWriter, r *http.Request) {
	var c struct {
		Chat  string `json:"chat"`
		Texto string `json:"texto"`
	}
	if json.NewDecoder(r.Body).Decode(&c) != nil || c.Chat == "" || strings.TrimSpace(c.Texto) == "" {
		fallo(w, 400, errors.New("falta el chat o el texto"))
		return
	}
	if len([]rune(c.Texto)) > 4000 {
		fallo(w, 400, errors.New("el mensaje es muy largo (máximo 4000 letras)"))
		return
	}
	m, err := a.cuenta.Enviar(c.Chat, c.Texto)
	if err != nil {
		fallo(w, codigoDe(err), err)
		return
	}
	escribir(w, 200, map[string]any{"mensaje": m})
}

// Toda ruta salvo /salud pide la clave (comparada en tiempo constante).
func (a *API) con(f http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		dada := strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")
		if a.clave == "" || subtle.ConstantTimeCompare([]byte(dada), []byte(a.clave)) != 1 {
			fallo(w, 401, errors.New("clave"))
			return
		}
		r.Body = http.MaxBytesReader(w, r.Body, 64<<10)
		f(w, r)
	}
}

func codigoDe(err error) int {
	switch {
	case errors.Is(err, ErrYaVinculado):
		return 409
	case errors.Is(err, ErrSinVincular):
		return 412
	default:
		return 502
	}
}

func escribir(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(code)
	json.NewEncoder(w).Encode(v)
}

func fallo(w http.ResponseWriter, code int, err error) {
	escribir(w, code, map[string]any{"error": err.Error()})
}

func entre(s string, def, min, max int) int {
	n, err := strconv.Atoi(s)
	if err != nil {
		return def
	}
	if n < min {
		return min
	}
	if n > max {
		return max
	}
	return n
}

func soloDigitos(s string) string {
	var b strings.Builder
	for _, r := range s {
		if r >= '0' && r <= '9' {
			b.WriteRune(r)
		}
	}
	return b.String()
}

func base64Std(b []byte) string { return base64.StdEncoding.EncodeToString(b) }

func ahoraMs() int64 { return time.Now().UnixMilli() }
