package main

// LA API DEL PUENTE (solo la red privada de Render y con clave): lo que el servidor de AU-RA le pide.
//
// Cada pedido (salvo /salud) dice de qué cuenta de AU-RA es con la cabecera X-Cuenta (una clave opaca que saca el
// servidor de la sesión; cuentas.go). Todo lo que hace es sobre ESA cuenta: sin la cabecera, o con una que no está,
// nunca toca lo de otra. Solo /vincular crea una cuenta nueva (si cabe: si no, 507 con codigo CUPO_LLENO).
//
//	GET  /salud                          sin clave: ¿vive? (y cuántas cuentas hay, sin decir cuáles)
//	GET  /estado                         vinculado, conectado, número; mientras vincula, el QR o el código.
//	                                     `registrada`: false si esa cuenta nunca empezó a vincular
//	POST /vincular {telefono?}           con teléfono: un código de 8 letras (WhatsApp → Dispositivos
//	                                     vinculados → Vincular con número); sin teléfono: un QR
//	POST /desvincular                    cierra la sesión y borra la carpeta entera de esa cuenta
//	GET  /chats?limite=&buscar=          los chats, el más reciente primero
//	GET  /mensajes?chat=&limite=&antes=  los de un chat, del más viejo al más nuevo
//	GET  /buscar?q=&limite=              en el texto de todos los chats
//	POST /enviar {chat, texto}           lo manda (el servidor solo lo llama con el «sí» de la persona)
//	POST /enviar-media {chat, tipo, datos, mime?, nombre?, pie?, id?}
//	                                     una foto, un documento, un audio o una nota de voz (Ogg/Opus), en base64
//	                                     en `datos` (hasta 16 MB; medios.go). Igual que /enviar: solo con su «sí»
//	POST /leido {chat}                   marca el chat como leído (también en su teléfono)
//	GET  /media?chat=&id=                la foto o el archivo de un mensaje (410 si ya no está en WhatsApp)
//	GET  /foto?chat=                     la foto de perfil del chat (JPEG chico; 404 si no tiene)
//	GET  /contactos?buscar=&limite=      la gente guardada en el teléfono (para empezar un chat)
//
// Los chats van con su id canónica: el número (…@s.whatsapp.net) siempre que se sepa, aunque WhatsApp los
// mande por LID (…@lid). Un LID viejo que ya se pasó al número sigue sirviendo en ?chat=.
//
// Los errores van con `error` (para la persona) y, cuando sirve para decidir, `codigo`: SIN_CUENTA (falta la
// cabecera o no tiene la forma), SIN_VINCULAR (esa cuenta no tiene WhatsApp aquí), CUPO_LLENO.
//
// Toda respuesta de una cuenta (también sus errores) lleva X-Cuenta-Eco: <la clave de X-Cuenta> (revisión del 5-oct,
// MEDIO-1). Un puente de antes no la pone: el servidor de AU-RA no deja pasar nada de una cuenta que no sea «legado»
// sin ese eco (si el puente vuelve a una versión de una sola cuenta, nadie recibe el WhatsApp de otro).

import (
	"crypto/subtle"
	"encoding/base64"
	"encoding/json"
	"errors"
	"net/http"
	"regexp"
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
	// id: el id del mensaje que pide AU-RA (AUR13, derivado de su operación); vacío = uno nuevo de WhatsApp.
	Enviar(chat, texto, id string) (Mensaje, error)
	// Una foto, un documento, un audio o una nota de voz ya comprobados (medios.go), con el mismo `id` que Enviar.
	EnviarMedia(chat string, m MediaSaliente, id string) (Mensaje, error)
	MarcarLeido(chat string) error
	Media(chat, id string) ([]byte, string, error)
	// La foto de perfil (ErrSinFoto si no tiene) y si ya se sabe sin preguntar (nil: no se sabe).
	Foto(chat string) ([]byte, error)
	FotoConocida(chat string) *bool
	// El nombre de un chat o de una persona con lo que ya se sabe (sin red); vacío si no se sabe.
	Nombre(jid string) string
	Contactos(buscar string, limite int) ([]Contacto, error)
	// ¿Tiene una sesión guardada? (al arrancar solo esas se reconectan).
	TieneSesion() bool
	// La suelta sin desvincular (desconecta y cierra su base): antes de borrar la carpeta o al apagar.
	Cerrar()
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
	// La pone la API: false si esa cuenta de AU-RA nunca empezó a vincular aquí (no hay nada suyo).
	Registrada bool `json:"registrada"`
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
	cuentas *Registro
}

// La cabecera con la cuenta de AU-RA de cada pedido.
const CabeceraCuenta = "X-Cuenta"

// La respuesta dice de qué cuenta es (el servidor de AU-RA la exige a toda cuenta que no sea «legado»).
const CabeceraEco = "X-Cuenta-Eco"

// La pone SOLO el servidor de AU-RA en /vincular cuando la cuenta es de la junta o del padrón («junta»): puede usar los
// lugares guardados (WHATSAPP_RESERVA_JUNTA). Nadie más llega al puente (red privada y clave).
const CabeceraPrioridad = "X-Cuenta-Prioridad"

// El id que AU-RA le pone a un mensaje (AUR13): como los de WhatsApp Web, 3EB0 + hexadecimal en mayúsculas.
var idDeAura = regexp.MustCompile(`^3EB0[0-9A-F]{16,40}$`)

func (a *API) Rutas() http.Handler {
	m := http.NewServeMux()
	m.HandleFunc("GET /salud", func(w http.ResponseWriter, r *http.Request) {
		usadas, max := a.cuentas.Cupo()
		escribir(w, 200, map[string]any{"ok": true, "cuentas": usadas, "maxCuentas": max})
	})
	// Una cuenta que no está (nunca vinculó, o ya se desvinculó): «sin vincular», sin crear nada.
	m.HandleFunc("GET /estado", a.conClave(func(w http.ResponseWriter, r *http.Request, clave string) {
		e, ok := a.cuentas.Obtener(clave)
		if !ok {
			escribir(w, 200, EstadoCuenta{})
			return
		}
		est := e.cuenta.Estado()
		est.Registrada = true
		escribir(w, 200, est)
	}))
	m.HandleFunc("POST /vincular", a.conClave(a.vincular))
	// Cierra la sesión en WhatsApp y borra la carpeta entera de esa cuenta. Una que no está: ya no hay nada.
	m.HandleFunc("POST /desvincular", a.conClave(func(w http.ResponseWriter, r *http.Request, clave string) {
		e, ok := a.cuentas.Obtener(clave)
		if !ok {
			escribir(w, 200, map[string]any{"ok": true})
			return
		}
		if err := e.cuenta.Desvincular(); err != nil {
			fallo(w, 502, err)
			return
		}
		if err := a.cuentas.Quitar(clave); err != nil {
			fallo(w, 500, err)
			return
		}
		escribir(w, 200, map[string]any{"ok": true})
	}))
	m.HandleFunc("GET /chats", a.deCuenta(func(w http.ResponseWriter, r *http.Request, e *Espacio) {
		chats, err := e.almacen.Chats(entre(r.URL.Query().Get("limite"), 60, 1, 300), r.URL.Query().Get("buscar"))
		if err != nil {
			fallo(w, 500, err)
			return
		}
		for i := range chats {
			completar(e, &chats[i])
		}
		escribir(w, 200, map[string]any{"chats": chats})
	}))
	m.HandleFunc("GET /mensajes", a.deCuenta(func(w http.ResponseWriter, r *http.Request, e *Espacio) {
		q := r.URL.Query()
		chat := q.Get("chat")
		if chat == "" {
			fallo(w, 400, errors.New("falta el chat"))
			return
		}
		antes, _ := strconv.ParseInt(q.Get("antes"), 10, 64)
		ms, err := e.almacen.Mensajes(chat, entre(q.Get("limite"), 60, 1, 300), antes)
		if err != nil {
			fallo(w, 500, err)
			return
		}
		c, ok := e.almacen.Chat(chat)
		if ok {
			completar(e, &c)
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
				n = e.cuenta.Nombre(m.De)
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
	m.HandleFunc("GET /buscar", a.deCuenta(func(w http.ResponseWriter, r *http.Request, e *Espacio) {
		t := strings.TrimSpace(r.URL.Query().Get("q"))
		if len([]rune(t)) < 2 {
			fallo(w, 400, errors.New("¿qué busco? (al menos dos letras)"))
			return
		}
		ms, err := e.almacen.Buscar(t, entre(r.URL.Query().Get("limite"), 20, 1, 100))
		if err != nil {
			fallo(w, 500, err)
			return
		}
		escribir(w, 200, map[string]any{"mensajes": ms})
	}))
	m.HandleFunc("POST /enviar", a.deCuenta(enviar))
	m.HandleFunc("POST /enviar-media", a.deCuentaTope(MaxCuerpoMedia, enviarMedia))
	// AUR13: un mensaje propio por su id (para que AU-RA reconcilie un envío del que no supo el final).
	m.HandleFunc("GET /mensaje", a.deCuenta(func(w http.ResponseWriter, r *http.Request, e *Espacio) {
		id := r.URL.Query().Get("id")
		if id == "" || len(id) > 128 {
			fallo(w, 400, errors.New("falta el id"))
			return
		}
		msg, err := e.almacen.MioPorID(id)
		if err != nil {
			fallo(w, 404, errors.New("no hay un mensaje tuyo con ese id"))
			return
		}
		escribir(w, 200, map[string]any{"mensaje": msg})
	}))
	m.HandleFunc("POST /leido", a.deCuenta(func(w http.ResponseWriter, r *http.Request, e *Espacio) {
		var c struct {
			Chat string `json:"chat"`
		}
		if json.NewDecoder(r.Body).Decode(&c) != nil || c.Chat == "" {
			fallo(w, 400, errors.New("falta el chat"))
			return
		}
		if err := e.cuenta.MarcarLeido(c.Chat); err != nil {
			fallo(w, 502, err)
			return
		}
		escribir(w, 200, map[string]any{"ok": true})
	}))
	m.HandleFunc("GET /media", a.deCuenta(func(w http.ResponseWriter, r *http.Request, e *Espacio) {
		datos, tipo, err := e.cuenta.Media(r.URL.Query().Get("chat"), r.URL.Query().Get("id"))
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
	m.HandleFunc("GET /foto", a.deCuenta(func(w http.ResponseWriter, r *http.Request, e *Espacio) {
		chat := r.URL.Query().Get("chat")
		if chat == "" {
			fallo(w, 400, errors.New("falta el chat"))
			return
		}
		datos, err := e.cuenta.Foto(chat)
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
	m.HandleFunc("GET /contactos", a.deCuenta(func(w http.ResponseWriter, r *http.Request, e *Espacio) {
		cs, err := e.cuenta.Contactos(r.URL.Query().Get("buscar"), entre(r.URL.Query().Get("limite"), 100, 1, 500))
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
func completar(e *Espacio, c *Chat) {
	if !tieneNombre(c.Nombre) {
		if n := e.cuenta.Nombre(c.JID); tieneNombre(n) {
			c.Nombre = n
			_, _ = e.almacen.MejorarNombre(c.JID, n)
		}
	}
	c.Nombre = nombreVisible(*c)
	if c.Grupo && !c.UltimoMio && c.ultimoDeJID != "" && !tieneNombre(c.UltimoDe) {
		if n := e.cuenta.Nombre(c.ultimoDeJID); tieneNombre(n) {
			c.UltimoDe = n
		} else if c.UltimoDe == "" {
			c.UltimoDe = numeroDe(c.ultimoDeJID)
		}
	}
	c.Foto = e.cuenta.FotoConocida(c.JID)
}

// POST /vincular: la única ruta que crea la cuenta (su carpeta) si no existía. Un número mal escrito no crea nada.
func (a *API) vincular(w http.ResponseWriter, r *http.Request, clave string) {
	var c struct {
		Telefono string `json:"telefono"`
	}
	_ = json.NewDecoder(r.Body).Decode(&c)
	tel := ""
	if c.Telefono != "" {
		tel = soloDigitos(c.Telefono)
		if len(tel) < 8 || len(tel) > 15 {
			fallo(w, 400, errors.New("escribe tu número con el código de país, por ejemplo 504 9999 9999"))
			return
		}
	}
	e, err := a.cuentas.ObtenerOCrear(clave, r.Header.Get(CabeceraPrioridad) == "junta")
	if err != nil {
		fallo(w, codigoDe(err), err)
		return
	}
	// Si no arrancó (WhatsApp no contestó) y no quedó nada en curso, la cuenta recién abierta no ocupa cupo.
	soltarSiFallo := func() {
		if !e.cuenta.TieneSesion() && !e.cuenta.Estado().Vinculando {
			_ = a.cuentas.Quitar(clave)
		}
	}
	if tel != "" {
		codigo, err := e.cuenta.VincularCodigo(tel)
		if err != nil {
			soltarSiFallo()
			fallo(w, codigoDe(err), err)
			return
		}
		escribir(w, 200, map[string]any{"codigo": codigo})
		return
	}
	qr, err := e.cuenta.VincularQR()
	if err != nil {
		soltarSiFallo()
		fallo(w, codigoDe(err), err)
		return
	}
	escribir(w, 200, map[string]any{"qr": qr})
}

// POST /enviar {chat, texto, id?}. Con `id` (AUR13: el que AU-RA deriva de su operación), el mismo mensaje no sale
// dos veces: si ya hay uno propio con ese id, se devuelve ese con "repetido": true y no se manda otra vez.
func enviar(w http.ResponseWriter, r *http.Request, e *Espacio) {
	var c struct {
		Chat  string `json:"chat"`
		Texto string `json:"texto"`
		ID    string `json:"id"`
	}
	if json.NewDecoder(r.Body).Decode(&c) != nil || c.Chat == "" || strings.TrimSpace(c.Texto) == "" {
		fallo(w, 400, errors.New("falta el chat o el texto"))
		return
	}
	if len([]rune(c.Texto)) > 4000 {
		fallo(w, 400, errors.New("el mensaje es muy largo (máximo 4000 letras)"))
		return
	}
	if c.ID != "" {
		if !idDeAura.MatchString(c.ID) {
			fallo(w, 400, errors.New("ese id de mensaje no tiene la forma esperada"))
			return
		}
		e.enviando.Lock()
		defer e.enviando.Unlock()
		if m, err := e.almacen.MioPorID(c.ID); err == nil {
			escribir(w, 200, map[string]any{"mensaje": m, "repetido": true})
			return
		}
	}
	m, err := e.cuenta.Enviar(c.Chat, c.Texto, c.ID)
	if err != nil {
		fallo(w, codigoDe(err), err)
		return
	}
	escribir(w, 200, map[string]any{"mensaje": m})
}

// POST /enviar-media {chat, tipo, datos (base64), mime?, nombre?, pie?, id?}: como /enviar, con un archivo. El archivo
// se comprueba antes de subirlo (medios.go): una «nota» que no es Ogg/Opus o una «imagen» que no es una foto no salen.
// Con `id`, el mismo mensaje no sale dos veces (AUR13).
func enviarMedia(w http.ResponseWriter, r *http.Request, e *Espacio) {
	var c struct {
		Chat   string `json:"chat"`
		Tipo   string `json:"tipo"`
		Datos  []byte `json:"datos"`
		Mime   string `json:"mime"`
		Nombre string `json:"nombre"`
		Pie    string `json:"pie"`
		ID     string `json:"id"`
	}
	if err := json.NewDecoder(r.Body).Decode(&c); err != nil {
		var grande *http.MaxBytesError
		if errors.As(err, &grande) {
			fallo(w, 413, ErrMediaGrande)
			return
		}
		fallo(w, 400, errors.New("no entendí el archivo (se manda en base64 en «datos»)"))
		return
	}
	if c.Chat == "" {
		fallo(w, 400, errors.New("falta el chat"))
		return
	}
	m := MediaSaliente{Tipo: c.Tipo, Datos: c.Datos, Mime: c.Mime, Nombre: c.Nombre, Pie: c.Pie}
	if err := validarMediaSaliente(&m); err != nil {
		code := 400
		if errors.Is(err, ErrMediaGrande) {
			code = 413
		}
		fallo(w, code, err)
		return
	}
	if c.ID != "" {
		if !idDeAura.MatchString(c.ID) {
			fallo(w, 400, errors.New("ese id de mensaje no tiene la forma esperada"))
			return
		}
		e.enviando.Lock()
		defer e.enviando.Unlock()
		if msg, err := e.almacen.MioPorID(c.ID); err == nil {
			escribir(w, 200, map[string]any{"mensaje": msg, "repetido": true})
			return
		}
	}
	msg, err := e.cuenta.EnviarMedia(c.Chat, m, c.ID)
	if err != nil {
		fallo(w, codigoDe(err), err)
		return
	}
	escribir(w, 200, map[string]any{"mensaje": msg})
}

// Lo más que se lee del cuerpo de un pedido (salvo /enviar-media, que lleva el archivo).
const MaxCuerpo = 64 << 10

// Toda ruta salvo /salud pide la clave (comparada en tiempo constante).
func (a *API) con(f http.HandlerFunc) http.HandlerFunc { return a.conTope(MaxCuerpo, f) }

func (a *API) conTope(tope int64, f http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		dada := strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")
		if a.clave == "" || subtle.ConstantTimeCompare([]byte(dada), []byte(a.clave)) != 1 {
			fallo(w, 401, errors.New("clave"))
			return
		}
		r.Body = http.MaxBytesReader(w, r.Body, tope)
		f(w, r)
	}
}

// Con la clave del puente y la cuenta de AU-RA (X-Cuenta) bien formada. Sin ella no se toca ninguna cuenta. Toda
// respuesta de aquí en adelante lleva el eco de la cuenta (X-Cuenta-Eco).
func (a *API) conClave(f func(w http.ResponseWriter, r *http.Request, clave string)) http.HandlerFunc {
	return a.conClaveTope(MaxCuerpo, f)
}

func (a *API) conClaveTope(tope int64, f func(w http.ResponseWriter, r *http.Request, clave string)) http.HandlerFunc {
	return a.conTope(tope, func(w http.ResponseWriter, r *http.Request) {
		clave := strings.TrimSpace(r.Header.Get(CabeceraCuenta))
		if !claveValida.MatchString(clave) {
			escribir(w, 400, map[string]any{"error": "falta la cuenta de AU-RA (o no tiene la forma esperada)", "codigo": "SIN_CUENTA"})
			return
		}
		w.Header().Set(CabeceraEco, clave)
		f(w, r, clave)
	})
}

// Con una cuenta que ya existe en el puente. Si no está: 412 SIN_VINCULAR, sin crear nada ni mirar otra.
func (a *API) deCuenta(f func(w http.ResponseWriter, r *http.Request, e *Espacio)) http.HandlerFunc {
	return a.deCuentaTope(MaxCuerpo, f)
}

func (a *API) deCuentaTope(tope int64, f func(w http.ResponseWriter, r *http.Request, e *Espacio)) http.HandlerFunc {
	return a.conClaveTope(tope, func(w http.ResponseWriter, r *http.Request, clave string) {
		e, ok := a.cuentas.Obtener(clave)
		if !ok {
			fallo(w, 412, ErrSinVincular)
			return
		}
		f(w, r, e)
	})
}

func codigoDe(err error) int {
	switch {
	case errors.Is(err, ErrMediaGrande):
		return 413
	case errors.Is(err, ErrMediaInvalida):
		return 400
	case errors.Is(err, ErrYaVinculado):
		return 409
	case errors.Is(err, ErrSinVincular):
		return 412
	case errors.Is(err, ErrCupoLleno):
		return 507
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
	j := map[string]any{"error": err.Error()}
	switch {
	case errors.Is(err, ErrCupoLleno):
		j["codigo"] = "CUPO_LLENO"
	case errors.Is(err, ErrSinVincular):
		j["codigo"] = "SIN_VINCULAR"
	}
	escribir(w, code, j)
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
