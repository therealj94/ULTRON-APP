package main

// MANDAR FOTOS, DOCUMENTOS, AUDIOS Y NOTAS DE VOZ (auditoría del 7-oct, M-12: «WhatsApp solo manda texto»). El
// servidor de AU-RA pide POST /enviar-media solo con el «sí» de la persona (igual que /enviar); aquí se comprueba que
// lo que llega es lo que dice ser, se sube cifrado a WhatsApp (whatsmeow Upload) y se manda como mensaje propio.
//
//   - imagen: JPEG, PNG o WebP (por sus bytes mágicos, no por el nombre).
//   - documento: cualquier archivo, con su nombre (WhatsApp lo muestra como documento).
//   - audio: un archivo de audio normal (mp3, m4a, ogg…).
//   - nota: una NOTA DE VOZ (el micrófono verde): tiene que ser Ogg con Opus dentro (lo que graban los teléfonos);
//     la duración se lee del propio Ogg. Sin eso no se manda como nota (WhatsApp la mostraría rota).
//
// Lo más grande: MaxMediaEnviar (16 MB, lo mismo que se baja).

import (
	"bytes"
	"context"
	"encoding/binary"
	"errors"
	"fmt"
	"math"
	"strings"
	"time"

	"go.mau.fi/whatsmeow"
	"go.mau.fi/whatsmeow/proto/waE2E"
	"go.mau.fi/whatsmeow/types"
	"google.golang.org/protobuf/proto"
)

const MaxMediaEnviar = 16 << 20

// Lo más largo que puede ser el cuerpo de /enviar-media: el archivo en base64 (4/3) y lo demás del JSON.
const MaxCuerpoMedia = MaxMediaEnviar/3*4 + 8<<10 + 64<<10

var ErrMediaInvalida = errors.New("ese archivo no es lo que dice ser")

// Lo que se manda: el tipo, los bytes y lo que acompaña.
type MediaSaliente struct {
	Tipo     string
	Datos    []byte
	Mime     string
	Nombre   string
	Pie      string
	Segundos int
}

var tiposMedia = map[string]bool{"imagen": true, "documento": true, "audio": true, "nota": true}

// Comprueba lo que se va a mandar y completa lo que se sabe de los bytes (el tipo de imagen, la duración de la nota).
func validarMediaSaliente(m *MediaSaliente) error {
	if !tiposMedia[m.Tipo] {
		return errors.New("el tipo es imagen, documento, audio o nota")
	}
	if len(m.Datos) == 0 {
		return errors.New("el archivo vino vacío")
	}
	if len(m.Datos) > MaxMediaEnviar {
		return ErrMediaGrande
	}
	if len([]rune(m.Pie)) > 1000 {
		return errors.New("el pie es muy largo (máximo 1000 letras)")
	}
	m.Nombre = nombreArchivoSeguro(m.Nombre)
	switch m.Tipo {
	case "imagen":
		tipo := tipoImagen(m.Datos)
		if tipo == "" {
			return fmt.Errorf("%w: no es una foto JPEG, PNG o WebP", ErrMediaInvalida)
		}
		m.Mime = tipo
	case "nota":
		seg, ok := duracionOggOpus(m.Datos)
		if !ok {
			return fmt.Errorf("%w: una nota de voz tiene que ser Ogg con Opus", ErrMediaInvalida)
		}
		m.Segundos = seg
		m.Mime = "audio/ogg; codecs=opus"
	case "audio":
		if !strings.HasPrefix(strings.ToLower(m.Mime), "audio/") {
			m.Mime = "audio/mpeg"
		}
	case "documento":
		if strings.TrimSpace(m.Mime) == "" || len(m.Mime) > 120 {
			m.Mime = "application/octet-stream"
		}
		if m.Nombre == "" {
			m.Nombre = "documento"
		}
	}
	return nil
}

// El nombre del archivo como se muestra: sin rutas ni caracteres de control, hasta 120 letras.
func nombreArchivoSeguro(s string) string {
	s = strings.TrimSpace(s)
	if i := strings.LastIndexAny(s, `/\`); i >= 0 {
		s = s[i+1:]
	}
	var b strings.Builder
	for _, r := range s {
		if r >= 32 && r != 127 {
			b.WriteRune(r)
		}
	}
	out := []rune(strings.TrimSpace(b.String()))
	if len(out) > 120 {
		out = out[:120]
	}
	return string(out)
}

// El tipo de una imagen por sus bytes mágicos ("" si no es una de las que WhatsApp muestra como foto).
func tipoImagen(b []byte) string {
	switch {
	case len(b) > 3 && b[0] == 0xFF && b[1] == 0xD8 && b[2] == 0xFF:
		return "image/jpeg"
	case len(b) > 8 && bytes.Equal(b[:8], []byte{0x89, 'P', 'N', 'G', 0x0D, 0x0A, 0x1A, 0x0A}):
		return "image/png"
	case len(b) > 12 && string(b[:4]) == "RIFF" && string(b[8:12]) == "WEBP":
		return "image/webp"
	}
	return ""
}

// La duración (en segundos, hacia arriba) de un Ogg con Opus, leída de sus páginas: la posición de la última (en
// muestras de 48 kHz) menos el «pre-skip» de la cabecera OpusHead. false si no es Ogg con Opus o está cortado.
func duracionOggOpus(b []byte) (int, bool) {
	var granulo int64 = -1
	preskip := -1
	for o := 0; o < len(b); {
		if o+27 > len(b) || string(b[o:o+4]) != "OggS" {
			return 0, false
		}
		nseg := int(b[o+26])
		if o+27+nseg > len(b) {
			return 0, false
		}
		largo := 0
		for _, s := range b[o+27 : o+27+nseg] {
			largo += int(s)
		}
		cuerpo := o + 27 + nseg
		if cuerpo+largo > len(b) {
			return 0, false
		}
		if preskip < 0 {
			// La primera página trae la cabecera de Opus.
			if largo < 19 || string(b[cuerpo:cuerpo+8]) != "OpusHead" {
				return 0, false
			}
			preskip = int(binary.LittleEndian.Uint16(b[cuerpo+10 : cuerpo+12]))
		}
		if g := int64(binary.LittleEndian.Uint64(b[o+6 : o+14])); g >= 0 {
			granulo = g
		}
		o = cuerpo + largo
	}
	if preskip < 0 || granulo < 0 {
		return 0, false
	}
	muestras := granulo - int64(preskip)
	if muestras <= 0 {
		return 1, true
	}
	return int(math.Ceil(float64(muestras) / 48000)), true
}

func tipoMediaWA(tipo string) whatsmeow.MediaType {
	switch tipo {
	case "imagen":
		return whatsmeow.MediaImage
	case "documento":
		return whatsmeow.MediaDocument
	default:
		return whatsmeow.MediaAudio
	}
}

// El mensaje de WhatsApp con lo que devolvió la subida.
func mensajeDeMedia(up whatsmeow.UploadResponse, m MediaSaliente) *waE2E.Message {
	largo := proto.Uint64(up.FileLength)
	switch m.Tipo {
	case "imagen":
		return &waE2E.Message{ImageMessage: &waE2E.ImageMessage{
			URL: proto.String(up.URL), DirectPath: proto.String(up.DirectPath), MediaKey: up.MediaKey, FileEncSHA256: up.FileEncSHA256,
			FileSHA256: up.FileSHA256, FileLength: largo, Mimetype: proto.String(m.Mime), Caption: cadenaONil(m.Pie),
		}}
	case "documento":
		return &waE2E.Message{DocumentMessage: &waE2E.DocumentMessage{
			URL: proto.String(up.URL), DirectPath: proto.String(up.DirectPath), MediaKey: up.MediaKey, FileEncSHA256: up.FileEncSHA256,
			FileSHA256: up.FileSHA256, FileLength: largo, Mimetype: proto.String(m.Mime), FileName: proto.String(m.Nombre),
			Title: proto.String(m.Nombre), Caption: cadenaONil(m.Pie),
		}}
	default:
		a := &waE2E.AudioMessage{
			URL: proto.String(up.URL), DirectPath: proto.String(up.DirectPath), MediaKey: up.MediaKey, FileEncSHA256: up.FileEncSHA256,
			FileSHA256: up.FileSHA256, FileLength: largo, Mimetype: proto.String(m.Mime),
		}
		if m.Tipo == "nota" {
			a.PTT = proto.Bool(true)
			a.Seconds = proto.Uint32(uint32(m.Segundos))
		}
		return &waE2E.Message{AudioMessage: a}
	}
}

func cadenaONil(s string) *string {
	if strings.TrimSpace(s) == "" {
		return nil
	}
	return proto.String(s)
}

// Sube el archivo cifrado a WhatsApp y lo manda. `id`: el que pide AU-RA (AUR13), como en Enviar.
func (c *CuentaWA) EnviarMedia(chat string, m MediaSaliente, id string) (Mensaje, error) {
	cli := c.cliente()
	if !cli.IsLoggedIn() {
		return Mensaje{}, ErrSinVincular
	}
	jid, err := types.ParseJID(chat)
	if err != nil {
		return Mensaje{}, fmt.Errorf("chat inválido: %w", err)
	}
	jid = jid.ToNonAD()
	ctx, cancel := context.WithTimeout(context.Background(), 90*time.Second)
	defer cancel()
	up, err := cli.Upload(ctx, m.Datos, tipoMediaWA(m.Tipo))
	if err != nil {
		return Mensaje{}, fmt.Errorf("WhatsApp no aceptó el archivo: %w", err)
	}
	msg := mensajeDeMedia(up, m)
	var extra []whatsmeow.SendRequestExtra
	if id != "" {
		extra = append(extra, whatsmeow.SendRequestExtra{ID: types.MessageID(id)})
	}
	r, err := cli.SendMessage(ctx, jid, msg, extra...)
	if err != nil {
		return Mensaje{}, fmt.Errorf("WhatsApp no lo mandó: %w", err)
	}
	cont, crudo := Contenido(msg)
	canon := c.canonico(jid, types.EmptyJID)
	out := Mensaje{
		ID: r.ID, Chat: canon.String(), ChatWA: jid.String(), De: cli.Store.ID.ToNonAD().String(), Mio: true, Hora: r.Timestamp.UnixMilli(),
		Tipo: cont.Tipo, Texto: cont.Texto, Duracion: cont.Duracion, Archivo: cont.Archivo,
	}
	_ = c.alm.GuardarChat(out.Chat, "", jid.Server == types.GroupServer, r.Timestamp)
	_, _ = c.alm.GuardarMensaje(out, nil, crudo)
	_ = c.alm.FijarNoLeidos(out.Chat, 0)
	out.Chat = c.alm.resolver(out.Chat)
	out.ConMedia = len(crudo) > 0
	return out, nil
}
