package main

// EL ALMACÉN: los chats y mensajes de la cuenta vinculada, en SQLite (en el disco del servicio; nunca
// sale de ahí salvo por la API con clave). La sesión de WhatsApp (las llaves del aparato vinculado) va
// en otra base, la de whatsmeow.

import (
	"database/sql"
	"strings"
	"time"
)

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
}

type Mensaje struct {
	ID         string `json:"id"`
	Chat       string `json:"chat"`
	De         string `json:"de"`
	NombreDe   string `json:"nombreDe"`
	Mio        bool   `json:"mio"`
	Hora       int64  `json:"hora"`
	Tipo       string `json:"tipo"`
	Texto      string `json:"texto"`
	Miniatura  string `json:"miniatura,omitempty"`
	Duracion   int    `json:"duracion,omitempty"`
	Archivo    string `json:"archivo,omitempty"`
	ConMedia   bool   `json:"conMedia,omitempty"`
	Eliminado  bool   `json:"eliminado,omitempty"`
	Editado    bool   `json:"editado,omitempty"`
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
	`)
	if err != nil {
		db.Close()
		return nil, err
	}
	return &Almacen{db: db}, nil
}

func (a *Almacen) Cerrar() error { return a.db.Close() }

// Chat nuevo o al día: el nombre solo se pisa si llega uno (no se borra con uno vacío) y la hora solo avanza.
func (a *Almacen) GuardarChat(jid, nombre string, grupo bool, hora time.Time) error {
	_, err := a.db.Exec(`INSERT INTO chats (jid, nombre, grupo, hora) VALUES (?, ?, ?, ?)
		ON CONFLICT(jid) DO UPDATE SET
			nombre = CASE WHEN excluded.nombre <> '' THEN excluded.nombre ELSE chats.nombre END,
			grupo = excluded.grupo,
			hora = MAX(chats.hora, excluded.hora)`, jid, nombre, b2i(grupo), hora.UnixMilli())
	return err
}

func (a *Almacen) FijarNoLeidos(jid string, n int) error {
	_, err := a.db.Exec(`UPDATE chats SET no_leidos = ? WHERE jid = ?`, n, jid)
	return err
}

func (a *Almacen) SumarNoLeido(jid string) error {
	_, err := a.db.Exec(`UPDATE chats SET no_leidos = no_leidos + 1 WHERE jid = ?`, jid)
	return err
}

// Un mensaje (si ya estaba, se queda el primero: la historia no pisa lo que llegó en vivo). Devuelve si era nuevo.
func (a *Almacen) GuardarMensaje(m Mensaje, miniatura, crudo []byte) (bool, error) {
	r, err := a.db.Exec(`INSERT OR IGNORE INTO mensajes (id, chat, de, nombre_de, mio, hora, tipo, texto, miniatura, duracion, archivo, crudo)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		m.ID, m.Chat, m.De, m.NombreDe, b2i(m.Mio), m.Hora, m.Tipo, m.Texto, nilSiVacio(miniatura), m.Duracion, m.Archivo, nilSiVacio(crudo))
	if err != nil {
		return false, err
	}
	n, _ := r.RowsAffected()
	return n > 0, nil
}

func (a *Almacen) Editar(chat, id, texto string) error {
	_, err := a.db.Exec(`UPDATE mensajes SET texto = ?, editado = 1 WHERE chat = ? AND id = ?`, texto, chat, id)
	return err
}

func (a *Almacen) Eliminar(chat, id string) error {
	_, err := a.db.Exec(`UPDATE mensajes SET texto = '', eliminado = 1, miniatura = NULL, crudo = NULL WHERE chat = ? AND id = ?`, chat, id)
	return err
}

// Los chats, el más reciente primero, con su último mensaje. `buscar` filtra por nombre o número.
func (a *Almacen) Chats(limite int, buscar string) ([]Chat, error) {
	q := `SELECT c.jid, c.nombre, c.grupo, c.no_leidos, c.hora,
			COALESCE(m.texto, ''), COALESCE(m.tipo, ''), COALESCE(m.mio, 0), COALESCE(m.nombre_de, ''), COALESCE(m.eliminado, 0)
		FROM chats c
		LEFT JOIN mensajes m ON m.rowid = (SELECT rowid FROM mensajes WHERE chat = c.jid ORDER BY hora DESC LIMIT 1)
		WHERE c.hora > 0`
	args := []any{}
	if b := strings.TrimSpace(buscar); b != "" {
		q += ` AND (c.nombre LIKE ? OR c.jid LIKE ?)`
		args = append(args, "%"+b+"%", "%"+b+"%")
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
		if err := filas.Scan(&c.JID, &c.Nombre, &grupo, &c.NoLeidos, &c.Hora, &texto, &tipo, &mio, &nombreDe, &elim); err != nil {
			return nil, err
		}
		c.Grupo, c.UltimoMio = grupo == 1, mio == 1
		if c.Grupo && !c.UltimoMio {
			c.UltimoDe = nombreDe
		}
		c.Ultimo = vistaPrevia(tipo, texto, elim == 1)
		out = append(out, c)
	}
	return out, filas.Err()
}

func (a *Almacen) Chat(jid string) (Chat, bool) {
	var c Chat
	var grupo int
	err := a.db.QueryRow(`SELECT jid, nombre, grupo, no_leidos, hora FROM chats WHERE jid = ?`, jid).Scan(&c.JID, &c.Nombre, &grupo, &c.NoLeidos, &c.Hora)
	c.Grupo = grupo == 1
	return c, err == nil
}

// Los mensajes de un chat, del más viejo al más nuevo (los últimos `limite`, o los anteriores a `antes`).
func (a *Almacen) Mensajes(chat string, limite int, antes int64) ([]Mensaje, error) {
	q := `SELECT id, chat, de, nombre_de, mio, hora, tipo, texto, miniatura, duracion, archivo, crudo IS NOT NULL, eliminado, editado
		FROM mensajes WHERE chat = ?`
	args := []any{chat}
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
	return a.leer(`SELECT id, chat, de, nombre_de, mio, hora, tipo, texto, NULL, duracion, archivo, crudo IS NOT NULL, eliminado, editado
		FROM mensajes WHERE texto LIKE ? AND eliminado = 0 ORDER BY hora DESC LIMIT ?`, "%"+texto+"%", limite)
}

func (a *Almacen) Crudo(chat, id string) ([]byte, string, error) {
	var crudo []byte
	var tipo string
	err := a.db.QueryRow(`SELECT crudo, tipo FROM mensajes WHERE chat = ? AND id = ?`, chat, id).Scan(&crudo, &tipo)
	return crudo, tipo, err
}

// Al desvincular: no queda nada de la cuenta.
func (a *Almacen) Borrar() error {
	_, err := a.db.Exec(`DELETE FROM mensajes; DELETE FROM chats;`)
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
		if err := filas.Scan(&m.ID, &m.Chat, &m.De, &m.NombreDe, &mio, &m.Hora, &m.Tipo, &m.Texto, &mini, &m.Duracion, &m.Archivo, &conMedia, &elim, &edit); err != nil {
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
