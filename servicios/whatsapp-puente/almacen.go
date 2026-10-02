package main

// EL ALMACÉN: los chats y mensajes de la cuenta vinculada, en SQLite (en el disco del servicio; nunca
// sale de ahí salvo por la API con clave). La sesión de WhatsApp (las llaves del aparato vinculado) va
// en otra base, la de whatsmeow.

import (
	"database/sql"
	"strings"
	"time"
)

// Los chats se guardan con su id CANÓNICA: el número (…@s.whatsapp.net) siempre que se sepa. WhatsApp ahora
// manda a mucha gente por su LID (…@lid, un id que no dice el número); cuando aparece cuál número es, lo
// guardado con el LID se pasa al número (Fusionar) y el LID queda como alias para quien todavía lo pida.

type Almacen struct{ db *sql.DB }

type Chat struct {
	JID       string `json:"jid"`
	Nombre    string `json:"nombre"`
	Grupo     bool   `json:"grupo"`
	NoLeidos  int    `json:"noLeidos"`
	Hora      int64  `json:"hora"`
	Ultimo    string `json:"ultimo"`
	UltimoMio bool   `json:"ultimoMio"`
	UltimoDe  string `json:"ultimoDe,omitempty"`
	// "+50499990000" en un chat de uno a uno cuando se sabe el número; vacío en grupos o si no se sabe.
	Numero string `json:"numero"`
	// ¿Tiene foto de perfil? true/false si ya se sabe (está en el disco), null si no se ha preguntado.
	Foto *bool `json:"foto"`

	ultimoDeJID string // quién mandó el último (para buscarle nombre al mostrarlo)
}

type Mensaje struct {
	ID        string `json:"id"`
	Chat      string `json:"chat"`
	De        string `json:"de"`
	NombreDe  string `json:"nombreDe"`
	Mio       bool   `json:"mio"`
	Hora      int64  `json:"hora"`
	Tipo      string `json:"tipo"`
	Texto     string `json:"texto"`
	Miniatura string `json:"miniatura,omitempty"`
	Duracion  int    `json:"duracion,omitempty"`
	Archivo   string `json:"archivo,omitempty"`
	ConMedia  bool   `json:"conMedia,omitempty"`
	Eliminado bool   `json:"eliminado,omitempty"`
	Editado   bool   `json:"editado,omitempty"`
	// Cómo lo direccionó WhatsApp (el LID, si llegó así): para los recibos y para volver a pedir un archivo.
	ChatWA string `json:"-"`
	DeWA   string `json:"-"`
}

func AbrirAlmacen(ruta string) (*Almacen, error) {
	db, err := sql.Open("sqlite3", "file:"+ruta+"?_foreign_keys=on&_journal_mode=WAL&_busy_timeout=5000")
	if err != nil {
		return nil, err
	}
	_, err = db.Exec(`
		CREATE TABLE IF NOT EXISTS chats (
			jid TEXT PRIMARY KEY,
			nombre TEXT NOT NULL DEFAULT '',
			grupo INTEGER NOT NULL DEFAULT 0,
			no_leidos INTEGER NOT NULL DEFAULT 0,
			hora INTEGER NOT NULL DEFAULT 0
		);
		CREATE TABLE IF NOT EXISTS mensajes (
			id TEXT NOT NULL,
			chat TEXT NOT NULL,
			de TEXT NOT NULL DEFAULT '',
			nombre_de TEXT NOT NULL DEFAULT '',
			mio INTEGER NOT NULL DEFAULT 0,
			hora INTEGER NOT NULL,
			tipo TEXT NOT NULL DEFAULT 'texto',
			texto TEXT NOT NULL DEFAULT '',
			miniatura BLOB,
			duracion INTEGER NOT NULL DEFAULT 0,
			archivo TEXT NOT NULL DEFAULT '',
			crudo BLOB,
			eliminado INTEGER NOT NULL DEFAULT 0,
			editado INTEGER NOT NULL DEFAULT 0,
			PRIMARY KEY (id, chat)
		);
		CREATE INDEX IF NOT EXISTS mensajes_chat_hora ON mensajes(chat, hora DESC);
		CREATE TABLE IF NOT EXISTS alias (
			viejo TEXT PRIMARY KEY,
			nuevo TEXT NOT NULL
		);
	`)
	if err == nil {
		// Columnas que llegaron después (en una base vieja se agregan; si ya están, el error no importa).
		for _, col := range []string{"chat_wa", "de_wa"} {
			if _, e := db.Exec(`ALTER TABLE mensajes ADD COLUMN ` + col + ` TEXT NOT NULL DEFAULT ''`); e != nil && !strings.Contains(e.Error(), "duplicate column") {
				err = e
			}
		}
	}
	if err != nil {
		db.Close()
		return nil, err
	}
	return &Almacen{db: db}, nil
}

// La id con la que está guardado un chat (o una persona): si era un LID que ya se pasó al número, el número.
func (a *Almacen) resolver(jid string) string {
	var nuevo string
	if jid != "" && a.db.QueryRow(`SELECT nuevo FROM alias WHERE viejo = ?`, jid).Scan(&nuevo) == nil && nuevo != "" {
		return nuevo
	}
	return jid
}

func (a *Almacen) Cerrar() error { return a.db.Close() }

// Chat nuevo o al día: el nombre solo se pisa si llega uno (no se borra con uno vacío) y la hora solo avanza.
func (a *Almacen) GuardarChat(jid, nombre string, grupo bool, hora time.Time) error {
	jid = a.resolver(jid)
	_, err := a.db.Exec(`INSERT INTO chats (jid, nombre, grupo, hora) VALUES (?, ?, ?, ?)
		ON CONFLICT(jid) DO UPDATE SET
			nombre = CASE WHEN excluded.nombre <> '' THEN excluded.nombre ELSE chats.nombre END,
			grupo = excluded.grupo,
			hora = MAX(chats.hora, excluded.hora)`, jid, nombre, b2i(grupo), hora.UnixMilli())
	return err
}

func (a *Almacen) FijarNoLeidos(jid string, n int) error {
	_, err := a.db.Exec(`UPDATE chats SET no_leidos = ? WHERE jid = ?`, n, a.resolver(jid))
	return err
}

func (a *Almacen) SumarNoLeido(jid string) error {
	_, err := a.db.Exec(`UPDATE chats SET no_leidos = no_leidos + 1 WHERE jid = ?`, a.resolver(jid))
	return err
}

// El nombre que puso la persona en sus contactos o el del grupo: manda sobre lo que hubiera.
func (a *Almacen) FijarNombre(jid, nombre string) error {
	if strings.TrimSpace(nombre) == "" {
		return nil
	}
	_, err := a.db.Exec(`UPDATE chats SET nombre = ? WHERE jid = ?`, nombre, a.resolver(jid))
	return err
}

// Un nombre que solo vale si el chat no tenía uno de verdad (vacío o un número): devuelve si lo cambió.
func (a *Almacen) MejorarNombre(jid, nombre string) (bool, error) {
	if strings.TrimSpace(nombre) == "" || esNumero(nombre) {
		return false, nil
	}
	jid = a.resolver(jid)
	var actual string
	if err := a.db.QueryRow(`SELECT nombre FROM chats WHERE jid = ?`, jid).Scan(&actual); err != nil {
		if err == sql.ErrNoRows {
			return false, nil
		}
		return false, err
	}
	if actual == nombre || (actual != "" && !esNumero(actual)) {
		return false, nil
	}
	_, err := a.db.Exec(`UPDATE chats SET nombre = ? WHERE jid = ?`, nombre, jid)
	return err == nil, err
}

// Los chats sin un nombre de verdad (vacío o solo el número), para volver a buscárselo.
func (a *Almacen) ChatsSinNombre(limite int) ([]Chat, error) {
	filas, err := a.db.Query(`SELECT jid, nombre, grupo FROM chats ORDER BY hora DESC LIMIT ?`, limite*4)
	if err != nil {
		return nil, err
	}
	defer filas.Close()
	out := []Chat{}
	for filas.Next() && len(out) < limite {
		var c Chat
		var grupo int
		if err := filas.Scan(&c.JID, &c.Nombre, &grupo); err != nil {
			return nil, err
		}
		c.Grupo = grupo == 1
		if !tieneNombre(c.Nombre) {
			out = append(out, c)
		}
	}
	return out, filas.Err()
}

// Las ids LID (…@lid) que todavía hay guardadas: como chat o como quien mandó un mensaje en un grupo.
func (a *Almacen) IDsLID() ([]string, error) {
	filas, err := a.db.Query(`SELECT jid FROM chats WHERE jid LIKE '%@lid' UNION SELECT DISTINCT de FROM mensajes WHERE de LIKE '%@lid'`)
	if err != nil {
		return nil, err
	}
	defer filas.Close()
	out := []string{}
	for filas.Next() {
		var j string
		if err := filas.Scan(&j); err != nil {
			return nil, err
		}
		out = append(out, j)
	}
	return out, filas.Err()
}

// Pasa todo lo guardado con `viejo` (un LID) a `nuevo` (su número): el chat (no leídos sumados, la hora
// más nueva, el mejor nombre), sus mensajes (uno repetido en los dos queda una vez, sin perder el archivo,
// la edición ni el borrado) y los mensajes que mandó en grupos. Se puede repetir sin daño.
func (a *Almacen) Fusionar(viejo, nuevo string) error {
	if viejo == "" || nuevo == "" || viejo == nuevo {
		return nil
	}
	tx, err := a.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	pasos := []string{
		// Repetidos: al que se queda le pasa lo que solo traía el del LID.
		`UPDATE mensajes SET crudo = (SELECT o.crudo FROM mensajes o WHERE o.chat = ?1 AND o.id = mensajes.id)
			WHERE chat = ?2 AND crudo IS NULL AND eliminado = 0 AND id IN (SELECT id FROM mensajes WHERE chat = ?1 AND crudo IS NOT NULL AND eliminado = 0)`,
		`UPDATE mensajes SET miniatura = (SELECT o.miniatura FROM mensajes o WHERE o.chat = ?1 AND o.id = mensajes.id)
			WHERE chat = ?2 AND miniatura IS NULL AND eliminado = 0 AND id IN (SELECT id FROM mensajes WHERE chat = ?1 AND miniatura IS NOT NULL AND eliminado = 0)`,
		`UPDATE mensajes SET texto = (SELECT o.texto FROM mensajes o WHERE o.chat = ?1 AND o.id = mensajes.id), editado = 1
			WHERE chat = ?2 AND editado = 0 AND id IN (SELECT id FROM mensajes WHERE chat = ?1 AND editado = 1 AND eliminado = 0)`,
		`UPDATE mensajes SET texto = '', eliminado = 1, miniatura = NULL, crudo = NULL
			WHERE chat = ?2 AND eliminado = 0 AND id IN (SELECT id FROM mensajes WHERE chat = ?1 AND eliminado = 1)`,
		// Los demás se mudan; los repetidos que quedaron atrás se borran.
		`UPDATE OR IGNORE mensajes SET chat = ?2, chat_wa = CASE WHEN chat_wa = '' THEN ?1 ELSE chat_wa END WHERE chat = ?1`,
		`DELETE FROM mensajes WHERE chat = ?1`,
		`UPDATE mensajes SET de = ?2, de_wa = CASE WHEN de_wa = '' THEN ?1 ELSE de_wa END WHERE de = ?1`,
		`INSERT INTO alias (viejo, nuevo) VALUES (?1, ?2) ON CONFLICT(viejo) DO UPDATE SET nuevo = excluded.nuevo`,
		`UPDATE alias SET nuevo = ?2 WHERE nuevo = ?1`,
	}
	for _, q := range pasos {
		if _, err := tx.Exec(q, viejo, nuevo); err != nil {
			return err
		}
	}
	var v, n struct {
		nombre         string
		grupo, noLeido int
		hora           int64
	}
	errV := tx.QueryRow(`SELECT nombre, grupo, no_leidos, hora FROM chats WHERE jid = ?`, viejo).Scan(&v.nombre, &v.grupo, &v.noLeido, &v.hora)
	if errV == nil {
		errN := tx.QueryRow(`SELECT nombre, grupo, no_leidos, hora FROM chats WHERE jid = ?`, nuevo).Scan(&n.nombre, &n.grupo, &n.noLeido, &n.hora)
		if errN != nil && errN != sql.ErrNoRows {
			return errN
		}
		nombre := n.nombre
		if !tieneNombre(nombre) && (tieneNombre(v.nombre) || nombre == "") {
			nombre = v.nombre
		}
		_, err = tx.Exec(`INSERT INTO chats (jid, nombre, grupo, no_leidos, hora) VALUES (?, ?, ?, ?, ?)
			ON CONFLICT(jid) DO UPDATE SET nombre = excluded.nombre, no_leidos = excluded.no_leidos, hora = excluded.hora`,
			nuevo, nombre, v.grupo, v.noLeido+n.noLeido, max(v.hora, n.hora))
		if err != nil {
			return err
		}
		if _, err := tx.Exec(`DELETE FROM chats WHERE jid = ?`, viejo); err != nil {
			return err
		}
	} else if errV != sql.ErrNoRows {
		return errV
	}
	return tx.Commit()
}

// Un mensaje (si ya estaba, se queda el primero: la historia no pisa lo que llegó en vivo). Devuelve si era nuevo.
func (a *Almacen) GuardarMensaje(m Mensaje, miniatura, crudo []byte) (bool, error) {
	if c := a.resolver(m.Chat); c != m.Chat {
		if m.ChatWA == "" {
			m.ChatWA = m.Chat
		}
		m.Chat = c
	}
	if d := a.resolver(m.De); d != m.De {
		if m.DeWA == "" {
			m.DeWA = m.De
		}
		m.De = d
	}
	if m.ChatWA == m.Chat {
		m.ChatWA = ""
	}
	if m.DeWA == m.De {
		m.DeWA = ""
	}
	r, err := a.db.Exec(`INSERT OR IGNORE INTO mensajes (id, chat, de, nombre_de, mio, hora, tipo, texto, miniatura, duracion, archivo, crudo, chat_wa, de_wa)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		m.ID, m.Chat, m.De, m.NombreDe, b2i(m.Mio), m.Hora, m.Tipo, m.Texto, nilSiVacio(miniatura), m.Duracion, m.Archivo, nilSiVacio(crudo), m.ChatWA, m.DeWA)
	if err != nil {
		return false, err
	}
	n, _ := r.RowsAffected()
	return n > 0, nil
}

func (a *Almacen) Editar(chat, id, texto string) error {
	_, err := a.db.Exec(`UPDATE mensajes SET texto = ?, editado = 1 WHERE chat = ? AND id = ?`, texto, a.resolver(chat), id)
	return err
}

func (a *Almacen) Eliminar(chat, id string) error {
	_, err := a.db.Exec(`UPDATE mensajes SET texto = '', eliminado = 1, miniatura = NULL, crudo = NULL WHERE chat = ? AND id = ?`, a.resolver(chat), id)
	return err
}

// Los chats, el más reciente primero, con su último mensaje. `buscar` filtra por nombre o número.
func (a *Almacen) Chats(limite int, buscar string) ([]Chat, error) {
	q := `SELECT c.jid, c.nombre, c.grupo, c.no_leidos, c.hora,
			COALESCE(m.texto, ''), COALESCE(m.tipo, ''), COALESCE(m.mio, 0), COALESCE(m.nombre_de, ''), COALESCE(m.eliminado, 0), COALESCE(m.de, '')
		FROM chats c
		LEFT JOIN mensajes m ON m.rowid = (SELECT rowid FROM mensajes WHERE chat = c.jid ORDER BY hora DESC LIMIT 1)
		WHERE c.hora > 0`
	args := []any{}
	if b := strings.TrimSpace(buscar); b != "" {
		// «+504 9999-0000» también encuentra el chat por su número.
		num := soloDigitos(b)
		if len(num) < 3 {
			num = b
		}
		q += ` AND (c.nombre LIKE ? OR c.jid LIKE ?)`
		args = append(args, "%"+b+"%", "%"+num+"%")
	}
	q += ` ORDER BY c.hora DESC LIMIT ?`
	args = append(args, limite)
	filas, err := a.db.Query(q, args...)
	if err != nil {
		return nil, err
	}
	defer filas.Close()
	out := []Chat{}
	for filas.Next() {
		var c Chat
		var grupo, mio, elim int
		var texto, tipo, nombreDe string
		if err := filas.Scan(&c.JID, &c.Nombre, &grupo, &c.NoLeidos, &c.Hora, &texto, &tipo, &mio, &nombreDe, &elim, &c.ultimoDeJID); err != nil {
			return nil, err
		}
		c.Grupo, c.UltimoMio = grupo == 1, mio == 1
		if c.Grupo && !c.UltimoMio {
			c.UltimoDe = nombreDe
		}
		c.Ultimo = vistaPrevia(tipo, texto, elim == 1)
		c.Numero = numeroDe(c.JID)
		out = append(out, c)
	}
	return out, filas.Err()
}

func (a *Almacen) Chat(jid string) (Chat, bool) {
	var c Chat
	var grupo int
	err := a.db.QueryRow(`SELECT jid, nombre, grupo, no_leidos, hora FROM chats WHERE jid = ?`, a.resolver(jid)).Scan(&c.JID, &c.Nombre, &grupo, &c.NoLeidos, &c.Hora)
	c.Grupo = grupo == 1
	c.Numero = numeroDe(c.JID)
	return c, err == nil
}

// Los mensajes de un chat, del más viejo al más nuevo (los últimos `limite`, o los anteriores a `antes`).
func (a *Almacen) Mensajes(chat string, limite int, antes int64) ([]Mensaje, error) {
	q := `SELECT id, chat, de, nombre_de, mio, hora, tipo, texto, miniatura, duracion, archivo, crudo IS NOT NULL, eliminado, editado, chat_wa, de_wa
		FROM mensajes WHERE chat = ?`
	args := []any{a.resolver(chat)}
	if antes > 0 {
		q += ` AND hora < ?`
		args = append(args, antes)
	}
	q += ` ORDER BY hora DESC LIMIT ?`
	args = append(args, limite)
	out, err := a.leer(q, args...)
	if err != nil {
		return nil, err
	}
	for i, j := 0, len(out)-1; i < j; i, j = i+1, j-1 {
		out[i], out[j] = out[j], out[i]
	}
	return out, nil
}

// Busca en el texto de todos los chats (para «¿qué me dijo Beto del jueves?»), lo más nuevo primero.
func (a *Almacen) Buscar(texto string, limite int) ([]Mensaje, error) {
	return a.leer(`SELECT id, chat, de, nombre_de, mio, hora, tipo, texto, NULL, duracion, archivo, crudo IS NOT NULL, eliminado, editado, chat_wa, de_wa
		FROM mensajes WHERE texto LIKE ? AND eliminado = 0 ORDER BY hora DESC LIMIT ?`, "%"+texto+"%", limite)
}

func (a *Almacen) Crudo(chat, id string) ([]byte, string, error) {
	var crudo []byte
	var tipo string
	err := a.db.QueryRow(`SELECT crudo, tipo FROM mensajes WHERE chat = ? AND id = ?`, a.resolver(chat), id).Scan(&crudo, &tipo)
	return crudo, tipo, err
}

// De dónde vino un mensaje (para pedirle a WhatsApp que vuelva a subir su archivo).
func (a *Almacen) Origen(chat, id string) (Mensaje, error) {
	ms, err := a.leer(`SELECT id, chat, de, nombre_de, mio, hora, tipo, texto, NULL, duracion, archivo, crudo IS NOT NULL, eliminado, editado, chat_wa, de_wa
		FROM mensajes WHERE chat = ? AND id = ?`, a.resolver(chat), id)
	if err != nil {
		return Mensaje{}, err
	}
	if len(ms) == 0 {
		return Mensaje{}, sql.ErrNoRows
	}
	return ms[0], nil
}

// El mensaje crudo con la ruta nueva que dio WhatsApp al volver a subir el archivo.
func (a *Almacen) ActualizarCrudo(chat, id string, crudo []byte) error {
	_, err := a.db.Exec(`UPDATE mensajes SET crudo = ? WHERE chat = ? AND id = ? AND eliminado = 0`, nilSiVacio(crudo), a.resolver(chat), id)
	return err
}

// Al desvincular: no queda nada de la cuenta.
func (a *Almacen) Borrar() error {
	_, err := a.db.Exec(`DELETE FROM mensajes; DELETE FROM chats; DELETE FROM alias;`)
	return err
}

func (a *Almacen) leer(q string, args ...any) ([]Mensaje, error) {
	filas, err := a.db.Query(q, args...)
	if err != nil {
		return nil, err
	}
	defer filas.Close()
	out := []Mensaje{}
	for filas.Next() {
		var m Mensaje
		var mio, conMedia, elim, edit int
		var mini []byte
		if err := filas.Scan(&m.ID, &m.Chat, &m.De, &m.NombreDe, &mio, &m.Hora, &m.Tipo, &m.Texto, &mini, &m.Duracion, &m.Archivo, &conMedia, &elim, &edit, &m.ChatWA, &m.DeWA); err != nil {
			return nil, err
		}
		m.Mio, m.ConMedia, m.Eliminado, m.Editado = mio == 1, conMedia == 1, elim == 1, edit == 1
		if len(mini) > 0 {
			m.Miniatura = base64Std(mini)
		}
		out = append(out, m)
	}
	return out, filas.Err()
}

// Lo que se lee en la lista de chats debajo del nombre.
func vistaPrevia(tipo, texto string, eliminado bool) string {
	if eliminado {
		return "🚫 Mensaje eliminado"
	}
	etiqueta := map[string]string{"imagen": "📷 Foto", "video": "🎥 Video", "audio": "🎤 Nota de voz", "documento": "📄 Documento", "sticker": "Sticker", "ubicacion": "📍 Ubicación", "contacto": "👤 Contacto", "encuesta": "📊 Encuesta"}[tipo]
	switch {
	case etiqueta != "" && texto != "":
		return etiqueta + " · " + texto
	case etiqueta != "":
		return etiqueta
	default:
		return texto
	}
}

// "+50499990000" para un chat de uno a uno con número; vacío para grupos, LIDs y lo demás.
func numeroDe(jid string) string {
	usuario, servidor, ok := strings.Cut(jid, "@")
	if !ok || servidor != "s.whatsapp.net" {
		return ""
	}
	usuario, _, _ = strings.Cut(usuario, ":") // sin el número de aparato
	if usuario == "" || soloDigitos(usuario) != usuario {
		return ""
	}
	return "+" + usuario
}

// ¿Es solo un número («+504 9999-0000»)? Eso no es un nombre: se puede mejorar.
func esNumero(s string) bool {
	s = strings.TrimSpace(s)
	digitos := 0
	for _, r := range s {
		switch {
		case r >= '0' && r <= '9':
			digitos++
		case strings.ContainsRune("+ -().", r):
		default:
			return false
		}
	}
	return digitos > 0
}

func tieneNombre(s string) bool { return strings.TrimSpace(s) != "" && !esNumero(s) }

// El nombre que se muestra: nunca vacío. El guardado; si no hay, el número; si no, «Grupo» o «Contacto».
func nombreVisible(c Chat) string {
	switch {
	case strings.TrimSpace(c.Nombre) != "":
		return c.Nombre
	case c.Numero != "":
		return c.Numero
	case c.Grupo:
		return "Grupo"
	default:
		return "Contacto"
	}
}

func b2i(b bool) int {
	if b {
		return 1
	}
	return 0
}

func nilSiVacio(b []byte) any {
	if len(b) == 0 {
		return nil
	}
	return b
}
