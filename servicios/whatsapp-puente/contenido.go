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

// Lo que whatsmeow no desenvuelve: las fotos de un álbum (associatedChild), las menciones al grupo y los
// sobres que pudieran quedar (efímero, ver una vez, documento con pie…). Sin esto, la foto de un álbum ni
// aparecía.
func Desenvolver(m *waE2E.Message) *waE2E.Message {
	for i := 0; m != nil && i < 8; i++ {
		var dentro *waE2E.FutureProofMessage
		for _, f := range []*waE2E.FutureProofMessage{
			m.GetAssociatedChildMessage(), m.GetGroupMentionedMessage(), m.GetEphemeralMessage(), m.GetViewOnceMessage(),
			m.GetViewOnceMessageV2(), m.GetViewOnceMessageV2Extension(), m.GetDocumentWithCaptionMessage(), m.GetEditedMessage(),
			m.GetBotInvokeMessage(), m.GetLottieStickerMessage(), m.GetSpoilerMessage(), m.GetBotForwardedMessage(),
		} {
			if f.GetMessage() != nil {
				dentro = f
				break
			}
		}
		if dentro == nil {
			if d := m.GetDeviceSentMessage().GetMessage(); d != nil {
				m = d
				continue
			}
			return m
		}
		m = dentro.GetMessage()
	}
	return m
}

// Devuelve el contenido y, para fotos, videos, audios, documentos y stickers, el mensaje crudo (ya
// desenvuelto: lo que se guarda es el mensaje que trae el archivo).
func Contenido(m *waE2E.Message) (ContenidoMsg, []byte) {
	m = Desenvolver(m)
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
	case m.GetPtvMessage() != nil:
		// Video redondo («nota de video»): se guarda como un video normal para poder bajarlo.
		x := m.GetPtvMessage()
		b, _ := proto.Marshal(&waE2E.Message{VideoMessage: x})
		return ContenidoMsg{Tipo: "video", Texto: x.GetCaption(), Miniatura: x.GetJPEGThumbnail(), Duracion: int(x.GetSeconds())}, b
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
