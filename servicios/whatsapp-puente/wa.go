package main

// LA CUENTA DE WHATSAPP (whatsmeow): vincula como «dispositivo vinculado» (igual que WhatsApp Web),
// guarda lo que llega y lo que se manda, y descarga las fotos a pedido.

import (
	"context"
	"errors"
	"fmt"
	"sync"
	"time"

	"github.com/skip2/go-qrcode"
	"go.mau.fi/whatsmeow"
	"go.mau.fi/whatsmeow/proto/waE2E"
	"go.mau.fi/whatsmeow/store"
	"go.mau.fi/whatsmeow/store/sqlstore"
	"go.mau.fi/whatsmeow/types"
	"go.mau.fi/whatsmeow/types/events"
	waLog "go.mau.fi/whatsmeow/util/log"
	"google.golang.org/protobuf/proto"
)

type CuentaWA struct {
	mu         sync.Mutex
	contenedor *sqlstore.Container
	cli        *whatsmeow.Client
	alm        *Almacen
	log        waLog.Logger
	qr         string
	codigo     string
	vinculando bool
	primerQR   chan struct{}
	nombres    sync.Map // jid de grupo → nombre (para no preguntarle a WhatsApp cada vez)
}

func NuevaCuentaWA(ctx context.Context, rutaSesion string, alm *Almacen, log waLog.Logger) (*CuentaWA, error) {
	// Así se ve en «Dispositivos vinculados» del teléfono.
	store.SetOSInfo("AU-RA", [3]uint32{1, 0, 0})
	cont, err := sqlstore.New(ctx, "sqlite3", "file:"+rutaSesion+"?_foreign_keys=on&_busy_timeout=5000", log.Sub("sesion"))
	if err != nil {
		return nil, err
	}
	dev, err := cont.GetFirstDevice(ctx)
	if err != nil {
		return nil, err
	}
	c := &CuentaWA{contenedor: cont, alm: alm, log: log}
	c.usar(dev)
	if dev.ID != nil {
		// Ya estaba vinculado: se reconecta solo (whatsmeow reintenta si se cae la red).
		if err := c.cli.Connect(); err != nil {
			log.Warnf("no conecté al arrancar: %v", err)
		}
	}
	return c, nil
}

func (c *CuentaWA) usar(dev *store.Device) {
	c.cli = whatsmeow.NewClient(dev, c.log.Sub("cliente"))
	c.cli.EnableAutoReconnect = true
	c.cli.AddEventHandler(c.evento)
}

func (c *CuentaWA) Estado() EstadoCuenta {
	c.mu.Lock()
	defer c.mu.Unlock()
	e := EstadoCuenta{Vinculado: c.cli.IsLoggedIn(), Conectado: c.cli.IsConnected(), Vinculando: c.vinculando, QR: c.qr, Codigo: c.codigo}
	if id := c.cli.Store.ID; id != nil && e.Vinculado {
		e.Numero = "+" + id.User
		e.Nombre = c.cli.Store.PushName
	}
	return e
}

// Arranca la vinculación (o devuelve la que ya corre): conecta y espera el primer QR.
func (c *CuentaWA) iniciar() error {
	c.mu.Lock()
	if c.cli.IsLoggedIn() {
		c.mu.Unlock()
		return ErrYaVinculado
	}
	if c.vinculando && c.qr != "" {
		c.mu.Unlock()
		return nil
	}
	if c.cli.Store.ID != nil {
		// Quedó un aparato a medias (lo desvincularon desde el teléfono): uno nuevo.
		c.cli.Disconnect()
		c.usar(c.contenedor.NewDevice())
	}
	c.vinculando, c.qr, c.codigo = true, "", ""
	c.primerQR = make(chan struct{})
	listo := c.primerQR
	cli := c.cli
	c.mu.Unlock()

	ch, err := cli.GetQRChannel(context.Background())
	if err != nil {
		c.terminarVinculo()
		return err
	}
	if err := cli.Connect(); err != nil {
		c.terminarVinculo()
		return err
	}
	go func() {
		primero := true
		for item := range ch {
			switch item.Event {
			case whatsmeow.QRChannelEventCode:
				png, err := qrcode.Encode(item.Code, qrcode.Medium, 512)
				c.mu.Lock()
				if err == nil {
					c.qr = "data:image/png;base64," + base64Std(png)
				}
				c.mu.Unlock()
				if primero {
					primero = false
					close(listo)
				}
			case whatsmeow.QRChannelSuccess.Event:
				c.log.Infof("vinculado")
				c.terminarVinculo()
			default:
				c.log.Warnf("vinculación terminó: %s %v", item.Event, item.Error)
				c.terminarVinculo()
			}
		}
		if primero {
			close(listo)
		}
	}()
	select {
	case <-listo:
	case <-time.After(20 * time.Second):
		return errors.New("WhatsApp no contestó a tiempo; prueba otra vez")
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.qr == "" && !c.cli.IsLoggedIn() {
		return errors.New("WhatsApp no dio el código; prueba otra vez")
	}
	return nil
}

func (c *CuentaWA) terminarVinculo() {
	c.mu.Lock()
	c.vinculando, c.qr, c.codigo = false, "", ""
	c.mu.Unlock()
}

func (c *CuentaWA) VincularQR() (string, error) {
	if err := c.iniciar(); err != nil {
		return "", err
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.qr, nil
}

func (c *CuentaWA) VincularCodigo(telefono string) (string, error) {
	if err := c.iniciar(); err != nil {
		return "", err
	}
	c.mu.Lock()
	cli := c.cli
	c.mu.Unlock()
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	codigo, err := cli.PairPhone(ctx, telefono, true, whatsmeow.PairClientChrome, "Chrome (Linux)")
	if err != nil {
		return "", fmt.Errorf("WhatsApp no aceptó ese número: %w", err)
	}
	c.mu.Lock()
	c.codigo = codigo
	c.mu.Unlock()
	return codigo, nil
}

func (c *CuentaWA) Desvincular() error {
	c.mu.Lock()
	cli := c.cli
	c.mu.Unlock()
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	if cli.IsLoggedIn() {
		if err := cli.Logout(ctx); err != nil {
			c.log.Warnf("logout: %v", err)
		}
	}
	cli.Disconnect()
	c.mu.Lock()
	c.usar(c.contenedor.NewDevice())
	c.vinculando, c.qr, c.codigo = false, "", ""
	c.mu.Unlock()
	return c.alm.Borrar()
}

func (c *CuentaWA) Enviar(chat, texto string) (Mensaje, error) {
	c.mu.Lock()
	cli := c.cli
	c.mu.Unlock()
	if !cli.IsLoggedIn() {
		return Mensaje{}, ErrSinVincular
	}
	jid, err := types.ParseJID(chat)
	if err != nil {
		return Mensaje{}, fmt.Errorf("chat inválido: %w", err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	r, err := cli.SendMessage(ctx, jid, &waE2E.Message{Conversation: proto.String(texto)})
	if err != nil {
		return Mensaje{}, fmt.Errorf("WhatsApp no lo mandó: %w", err)
	}
	m := Mensaje{ID: r.ID, Chat: jid.String(), De: cli.Store.ID.ToNonAD().String(), Mio: true, Hora: r.Timestamp.UnixMilli(), Tipo: "texto", Texto: texto}
	_ = c.alm.GuardarChat(m.Chat, "", jid.Server == types.GroupServer, r.Timestamp)
	_, _ = c.alm.GuardarMensaje(m, nil, nil)
	_ = c.alm.FijarNoLeidos(m.Chat, 0)
	return m, nil
}

func (c *CuentaWA) MarcarLeido(chat string) error {
	c.mu.Lock()
	cli := c.cli
	c.mu.Unlock()
	_ = c.alm.FijarNoLeidos(chat, 0)
	if !cli.IsLoggedIn() {
		return nil
	}
	jid, err := types.ParseJID(chat)
	if err != nil {
		return err
	}
	ms, err := c.alm.Mensajes(chat, 30, 0)
	if err != nil {
		return err
	}
	// Los recibos van por remitente (en un grupo, cada quien).
	porDe := map[string][]types.MessageID{}
	for _, m := range ms {
		if !m.Mio {
			porDe[m.De] = append(porDe[m.De], m.ID)
		}
	}
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	for de, ids := range porDe {
		remitente, _ := types.ParseJID(de)
		if jid.Server != types.GroupServer {
			remitente = types.EmptyJID
		}
		if err := cli.MarkRead(ctx, ids, time.Now(), jid, remitente); err != nil {
			c.log.Warnf("marcar leído: %v", err)
		}
	}
	return nil
}

func (c *CuentaWA) Media(chat, id string) ([]byte, string, error) {
	crudo, _, err := c.alm.Crudo(chat, id)
	if err != nil || len(crudo) == 0 {
		return nil, "", errors.New("ese mensaje no tiene archivo")
	}
	var msg waE2E.Message
	if err := proto.Unmarshal(crudo, &msg); err != nil {
		return nil, "", err
	}
	var d whatsmeow.DownloadableMessage
	tipo := "application/octet-stream"
	switch {
	case msg.GetImageMessage() != nil:
		d, tipo = msg.GetImageMessage(), msg.GetImageMessage().GetMimetype()
	case msg.GetVideoMessage() != nil:
		d, tipo = msg.GetVideoMessage(), msg.GetVideoMessage().GetMimetype()
	case msg.GetAudioMessage() != nil:
		d, tipo = msg.GetAudioMessage(), msg.GetAudioMessage().GetMimetype()
	case msg.GetDocumentMessage() != nil:
		d, tipo = msg.GetDocumentMessage(), msg.GetDocumentMessage().GetMimetype()
	case msg.GetStickerMessage() != nil:
		d, tipo = msg.GetStickerMessage(), msg.GetStickerMessage().GetMimetype()
	default:
		return nil, "", errors.New("ese mensaje no tiene archivo")
	}
	c.mu.Lock()
	cli := c.cli
	c.mu.Unlock()
	ctx, cancel := context.WithTimeout(context.Background(), 45*time.Second)
	defer cancel()
	datos, err := cli.Download(ctx, d)
	if err != nil {
		return nil, "", fmt.Errorf("WhatsApp no lo dio (puede haber vencido): %w", err)
	}
	return datos, tipo, nil
}

/* ---------------------------------------------------------------- lo que llega de WhatsApp */

func (c *CuentaWA) evento(e any) {
	switch v := e.(type) {
	case *events.Message:
		c.guardar(v, true)
	case *events.HistorySync:
		c.historia(v)
	case *events.Receipt:
		// La persona leyó el chat en su teléfono: aquí también queda leído.
		if v.IsFromMe && (v.Type == types.ReceiptTypeRead || v.Type == types.ReceiptTypeReadSelf) {
			_ = c.alm.FijarNoLeidos(v.Chat.ToNonAD().String(), 0)
		}
	case *events.LoggedOut:
		// Lo desvincularon desde el teléfono: no queda nada guardado de esa cuenta.
		c.log.Warnf("desvinculado desde el teléfono (%v)", v.Reason)
		_ = c.alm.Borrar()
	}
}

func (c *CuentaWA) historia(h *events.HistorySync) {
	for _, conv := range h.Data.GetConversations() {
		jid, err := types.ParseJID(conv.GetID())
		if err != nil || jid.Server == types.BroadcastServer || jid.Server == types.NewsletterServer {
			continue
		}
		grupo := jid.Server == types.GroupServer
		nombre := conv.GetName()
		if nombre == "" {
			nombre = conv.GetDisplayName()
		}
		if nombre == "" && !grupo {
			nombre = c.nombreDe(jid, "")
		}
		if grupo && nombre != "" {
			c.nombres.Store(jid.String(), nombre)
		}
		hora := time.Unix(int64(conv.GetConversationTimestamp()), 0)
		_ = c.alm.GuardarChat(jid.ToNonAD().String(), nombre, grupo, hora)
		for _, hm := range conv.GetMessages() {
			ev, err := c.cli.ParseWebMessage(jid, hm.GetMessage())
			if err != nil {
				continue
			}
			c.guardar(ev, false)
		}
		_ = c.alm.FijarNoLeidos(jid.ToNonAD().String(), int(conv.GetUnreadCount()))
	}
}

func (c *CuentaWA) guardar(ev *events.Message, vivo bool) {
	info := ev.Info
	if info.Chat.Server == types.BroadcastServer || info.Chat.Server == types.NewsletterServer {
		return // estados y canales: no son chats
	}
	chat := info.Chat.ToNonAD().String()
	msg := ev.Message
	if pm := msg.GetProtocolMessage(); pm != nil {
		switch pm.GetType() {
		case waE2E.ProtocolMessage_REVOKE:
			_ = c.alm.Eliminar(chat, pm.GetKey().GetID())
		case waE2E.ProtocolMessage_MESSAGE_EDIT:
			if t, _ := Contenido(pm.GetEditedMessage()); t.Texto != "" {
				_ = c.alm.Editar(chat, pm.GetKey().GetID(), t.Texto)
			}
		}
		return
	}
	cont, crudo := Contenido(msg)
	if cont.Tipo == "" {
		return
	}
	grupo := info.Chat.Server == types.GroupServer
	nombreChat := ""
	if grupo {
		nombreChat = c.nombreGrupo(info.Chat, vivo)
	} else if !info.IsFromMe {
		nombreChat = c.nombreDe(info.Chat, info.PushName)
	} else {
		nombreChat = c.nombreDe(info.Chat, "")
	}
	m := Mensaje{
		ID: info.ID, Chat: chat, De: info.Sender.ToNonAD().String(), Mio: info.IsFromMe, Hora: info.Timestamp.UnixMilli(),
		Tipo: cont.Tipo, Texto: cont.Texto, Duracion: cont.Duracion, Archivo: cont.Archivo,
	}
	if !info.IsFromMe {
		m.NombreDe = c.nombreDe(info.Sender, info.PushName)
	}
	_ = c.alm.GuardarChat(chat, nombreChat, grupo, info.Timestamp)
	nuevo, err := c.alm.GuardarMensaje(m, cont.Miniatura, crudo)
	if err != nil {
		c.log.Warnf("no guardé %s: %v", info.ID, err)
		return
	}
	if vivo && nuevo {
		if info.IsFromMe {
			_ = c.alm.FijarNoLeidos(chat, 0)
		} else {
			_ = c.alm.SumarNoLeido(chat)
		}
	}
}

// El nombre de una persona: como la tiene en sus contactos; si no, como ella se puso; si no, su número.
func (c *CuentaWA) nombreDe(jid types.JID, pushName string) string {
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	buscar := []types.JID{jid.ToNonAD()}
	if jid.Server == types.HiddenUserServer {
		if pn, err := c.cli.Store.LIDs.GetPNForLID(ctx, jid.ToNonAD()); err == nil && !pn.IsEmpty() {
			buscar = append(buscar, pn)
		}
	}
	for _, j := range buscar {
		if ci, err := c.cli.Store.Contacts.GetContact(ctx, j); err == nil && ci.Found {
			for _, n := range []string{ci.FullName, ci.FirstName, ci.BusinessName, ci.PushName} {
				if n != "" {
					return n
				}
			}
		}
	}
	if pushName != "" {
		return pushName
	}
	for _, j := range buscar {
		if j.Server == types.DefaultUserServer {
			return "+" + j.User
		}
	}
	return ""
}

func (c *CuentaWA) nombreGrupo(jid types.JID, preguntar bool) string {
	if n, ok := c.nombres.Load(jid.String()); ok {
		return n.(string)
	}
	if !preguntar {
		return ""
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	gi, err := c.cli.GetGroupInfo(ctx, jid)
	if err != nil || gi.Name == "" {
		return ""
	}
	c.nombres.Store(jid.String(), gi.Name)
	return gi.Name
}
