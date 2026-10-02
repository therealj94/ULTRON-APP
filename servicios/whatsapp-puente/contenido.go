package main

// QUÉ DICE UN MENSAJE: su tipo, su texto (o el pie de foto), su miniatura y, si trae archivo, el
// mensaje crudo para descargarlo después. Sin WhatsApp de por medio: lo prueba contenido_test.go.

import (
	"go.mau.fi/whatsmeow/proto/waE2E"
	"google.golang.org/protobuf/proto"
)

type ContenidoMsg struct {
	Tipo      string
	Texto     string
	Miniatura []byte
	Duracion  int
	Archivo   string
}

// Devuelve el contenido y, para fotos, videos, audios, documentos y stickers, el mensaje crudo.
func Contenido(m *waE2E.Message) (ContenidoMsg, []byte) {
	if m == nil {
		return ContenidoMsg{}, nil
	}
	crudo := func() []byte {
		b, _ := proto.Marshal(m)
		return b
	}
	switch {
	case m.GetConversation() != "":
		return ContenidoMsg{Tipo: "texto", Texto: m.GetConversation()}, nil
	case m.GetExtendedTextMessage() != nil:
		return ContenidoMsg{Tipo: "texto", Texto: m.GetExtendedTextMessage().GetText()}, nil
	case m.GetImageMessage() != nil:
		x := m.GetImageMessage()
		return ContenidoMsg{Tipo: "imagen", Texto: x.GetCaption(), Miniatura: x.GetJPEGThumbnail()}, crudo()
	case m.GetVideoMessage() != nil:
		x := m.GetVideoMessage()
		return ContenidoMsg{Tipo: "video", Texto: x.GetCaption(), Miniatura: x.GetJPEGThumbnail(), Duracion: int(x.GetSeconds())}, crudo()
	case m.GetAudioMessage() != nil:
		x := m.GetAudioMessage()
		return ContenidoMsg{Tipo: "audio", Duracion: int(x.GetSeconds())}, crudo()
	case m.GetDocumentMessage() != nil:
		x := m.GetDocumentMessage()
		return ContenidoMsg{Tipo: "documento", Texto: x.GetCaption(), Archivo: x.GetFileName(), Miniatura: x.GetJPEGThumbnail()}, crudo()
	case m.GetStickerMessage() != nil:
		return ContenidoMsg{Tipo: "sticker"}, crudo()
	case m.GetLocationMessage() != nil:
		x := m.GetLocationMessage()
		t := x.GetName()
		if t == "" {
			t = x.GetAddress()
		}
		return ContenidoMsg{Tipo: "ubicacion", Texto: t}, nil
	case m.GetLiveLocationMessage() != nil:
		return ContenidoMsg{Tipo: "ubicacion", Texto: "en vivo"}, nil
	case m.GetContactMessage() != nil:
		return ContenidoMsg{Tipo: "contacto", Texto: m.GetContactMessage().GetDisplayName()}, nil
	case m.GetPollCreationMessage() != nil:
		return ContenidoMsg{Tipo: "encuesta", Texto: m.GetPollCreationMessage().GetName()}, nil
	case m.GetPollCreationMessageV3() != nil:
		return ContenidoMsg{Tipo: "encuesta", Texto: m.GetPollCreationMessageV3().GetName()}, nil
	}
	return ContenidoMsg{}, nil
}
