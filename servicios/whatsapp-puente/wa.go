package main

// LA CUENTA DE WHATSAPP (whatsmeow): vincula como «dispositivo vinculado» (igual que WhatsApp Web),
// guarda lo que llega y lo que se manda, y descarga las fotos a pedido (si ya vencieron en el servidor de
// WhatsApp, se las pide al teléfono otra vez). Lo lento (grupos, orden, fotos de perfil) va aparte, nunca
// dentro del manejador de eventos.

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"sort"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/skip2/go-qrcode"
	"go.mau.fi/whatsmeow"
	"go.mau.fi/whatsmeow/proto/waE2E"
	"go.mau.fi/whatsmeow/proto/waMmsRetry"
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
	buscando   sync.Map // grupos que se le están preguntando a WhatsApp ahora
	reintentos sync.Map // id de mensaje → chan *events.MediaRetry (el teléfono volvió a subir el archivo)
	orden      chan struct{}
	grupos     atomic.Bool // ya se trajeron los nombres de todos los grupos
	fotos      *CacheFotos
	web        *http.Client
}

func NuevaCuentaWA(ctx context.Context, rutaSesion, dirFotos string, alm *Almacen, log waLog.Logger) (*CuentaWA, error) {
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
	c := &CuentaWA{contenedor: cont, alm: alm, log: log, orden: make(chan struct{}, 1), web: &http.Client{Timeout: 15 * time.Second}}
	c.fotos = NuevaCacheFotos(dirFotos, c.traerFoto)
	c.usar(dev)
	go c.ordenador()
	if dev.ID != nil {
		// Ya estaba vinculado: se reconecta solo (whatsmeow reintenta si se cae la red).
		if err := c.cli.Connect(); err != nil {
			log.Warnf("no conecté al arrancar: %v", err)
		}
		// Lo guardado antes de esta versión (o antes de saber el número de un LID) se ordena ya.
		c.pedirOrden()
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
	// Sin red (o si WhatsApp no contestó al logout) las llaves del aparato siguen en sesion.db y al
	// reiniciar se volvería a conectar solo: se borran aquí. Si no se pueden borrar, no se dice que se
	// desvinculó (Codex en #123).
	if cli.Store.ID != nil {
		if err := cli.Store.Delete(ctx); err != nil {
			return fmt.Errorf("no pude borrar la sesión guardada: %w", err)
		}
	}
	c.mu.Lock()
	c.usar(c.contenedor.NewDevice())
	c.vinculando, c.qr, c.codigo = false, "", ""
	c.mu.Unlock()
	c.olvidar()
	return c.alm.Borrar()
}

// Lo que se recuerda en memoria y en el disco de la cuenta que se fue.
func (c *CuentaWA) olvidar() {
	c.fotos.Borrar()
	c.nombres.Clear()
	c.grupos.Store(false)
}

func (c *CuentaWA) cliente() *whatsmeow.Client {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.cli
}

func (c *CuentaWA) Enviar(chat, texto, id string) (Mensaje, error) {
	cli := c.cliente()
	if !cli.IsLoggedIn() {
		return Mensaje{}, ErrSinVincular
	}
	jid, err := types.ParseJID(chat)
	if err != nil {
		return Mensaje{}, fmt.Errorf("chat inválido: %w", err)
	}
	jid = jid.ToNonAD()
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	// Al número o al LID, da igual: whatsmeow busca el LID del número si hace falta.
	// Con el id que pide AU-RA (AUR13), el mensaje lleva ese id en WhatsApp: se puede reconciliar y no se duplica.
	var extra []whatsmeow.SendRequestExtra
	if id != "" {
		extra = append(extra, whatsmeow.SendRequestExtra{ID: types.MessageID(id)})
	}
	r, err := cli.SendMessage(ctx, jid, &waE2E.Message{Conversation: proto.String(texto)}, extra...)
	if err != nil {
		return Mensaje{}, fmt.Errorf("WhatsApp no lo mandó: %w", err)
	}
	canon := c.canonico(jid, types.EmptyJID)
	m := Mensaje{ID: r.ID, Chat: canon.String(), ChatWA: jid.String(), De: cli.Store.ID.ToNonAD().String(), Mio: true, Hora: r.Timestamp.UnixMilli(), Tipo: "texto", Texto: texto}
	_ = c.alm.GuardarChat(m.Chat, "", jid.Server == types.GroupServer, r.Timestamp)
	_, _ = c.alm.GuardarMensaje(m, nil, nil)
	_ = c.alm.FijarNoLeidos(m.Chat, 0)
	m.Chat = c.alm.resolver(m.Chat)
	return m, nil
}

func (c *CuentaWA) MarcarLeido(chat string) error {
	cli := c.cliente()
	_ = c.alm.FijarNoLeidos(chat, 0)
	if !cli.IsLoggedIn() {
		return nil
	}
	ms, err := c.alm.Mensajes(chat, 30, 0)
	if err != nil {
		return err
	}
	// Los recibos van por remitente (en un grupo, cada quien), con las ids con que WhatsApp los mandó.
	type clave struct{ chat, de string }
	porDe := map[clave][]types.MessageID{}
	for _, m := range ms {
		if !m.Mio {
			k := clave{primero(m.ChatWA, m.Chat), primero(m.DeWA, m.De)}
			porDe[k] = append(porDe[k], m.ID)
		}
	}
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	for k, ids := range porDe {
		jid, err := types.ParseJID(k.chat)
		if err != nil {
			continue
		}
		remitente, _ := types.ParseJID(k.de)
		if jid.Server != types.GroupServer {
			remitente = types.EmptyJID
		}
		if err := cli.MarkRead(ctx, ids, time.Now(), jid, remitente); err != nil {
			c.log.Warnf("marcar leído: %v", err)
		}
	}
	return nil
}

// Lo que trae el archivo de un mensaje, su tipo y cómo cambiarle la ruta.
func archivoDe(msg *waE2E.Message) (whatsmeow.DownloadableMessage, string) {
	switch {
	case msg.GetImageMessage() != nil:
		return msg.GetImageMessage(), primero(msg.GetImageMessage().GetMimetype(), "image/jpeg")
	case msg.GetVideoMessage() != nil:
		return msg.GetVideoMessage(), primero(msg.GetVideoMessage().GetMimetype(), "video/mp4")
	case msg.GetPtvMessage() != nil:
		return msg.GetPtvMessage(), primero(msg.GetPtvMessage().GetMimetype(), "video/mp4")
	case msg.GetAudioMessage() != nil:
		return msg.GetAudioMessage(), primero(msg.GetAudioMessage().GetMimetype(), "audio/ogg")
	case msg.GetDocumentMessage() != nil:
		return msg.GetDocumentMessage(), primero(msg.GetDocumentMessage().GetMimetype(), "application/octet-stream")
	case msg.GetStickerMessage() != nil:
		return msg.GetStickerMessage(), primero(msg.GetStickerMessage().GetMimetype(), "image/webp")
	}
	return nil, ""
}

func ponerRuta(d whatsmeow.DownloadableMessage, ruta string) {
	switch x := d.(type) {
	case *waE2E.ImageMessage:
		x.DirectPath = proto.String(ruta)
	case *waE2E.VideoMessage:
		x.DirectPath = proto.String(ruta)
	case *waE2E.AudioMessage:
		x.DirectPath = proto.String(ruta)
	case *waE2E.DocumentMessage:
		x.DirectPath = proto.String(ruta)
	case *waE2E.StickerMessage:
		x.DirectPath = proto.String(ruta)
	}
}

// ¿El archivo ya no está en el servidor de WhatsApp (los viejos se borran a las pocas semanas)?
func vencido(err error) bool {
	return errors.Is(err, whatsmeow.ErrMediaDownloadFailedWith403) || errors.Is(err, whatsmeow.ErrMediaDownloadFailedWith404) ||
		errors.Is(err, whatsmeow.ErrMediaDownloadFailedWith410) || errors.Is(err, whatsmeow.ErrNoURLPresent)
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
	interno := Desenvolver(&msg)
	d, tipo := archivoDe(interno)
	if d == nil {
		return nil, "", errors.New("ese mensaje no tiene archivo")
	}
	// Se baja entero a memoria (y el servidor lo vuelve a juntar): uno enorme no se baja (Codex en #123).
	if t, ok := d.(interface{ GetFileLength() uint64 }); ok && t.GetFileLength() > MaxMedia {
		return nil, "", ErrMediaGrande
	}
	cli := c.cliente()
	if !cli.IsLoggedIn() {
		return nil, "", ErrSinVincular
	}
	// Mensajes viejos traen la URL pero no la ruta: la ruta es la URL sin el servidor.
	if d.GetDirectPath() == "" {
		if u, ok := d.(interface{ GetURL() string }); ok {
			if pu, err := url.Parse(u.GetURL()); err == nil && strings.HasPrefix(pu.Path, "/") {
				ponerRuta(d, pu.RequestURI())
			}
		}
	}
	bajar := func() ([]byte, error) {
		ctx, cancel := context.WithTimeout(context.Background(), 25*time.Second)
		defer cancel()
		return cli.Download(ctx, d)
	}
	datos, err := bajar()
	if err == nil {
		return datos, tipo, nil
	}
	if !vencido(err) {
		return nil, "", fmt.Errorf("WhatsApp no lo dio: %w", err)
	}
	// Ya no está en el servidor: se le pide al teléfono que lo vuelva a subir (como hace WhatsApp Web).
	ruta, errR := c.pedirDeNuevo(cli, chat, id, d.GetMediaKey())
	if errR != nil {
		c.log.Infof("media %s vencida y el teléfono no la volvió a subir: %v", id, errR)
		return nil, "", ErrMediaVencida
	}
	ponerRuta(d, ruta)
	if b, err := proto.Marshal(&msg); err == nil {
		_ = c.alm.ActualizarCrudo(chat, id, b)
	}
	if datos, err = bajar(); err != nil {
		c.log.Infof("media %s: tampoco con la ruta nueva: %v", id, err)
		return nil, "", ErrMediaVencida
	}
	return datos, tipo, nil
}

// Pide al teléfono que vuelva a subir el archivo de un mensaje y espera la ruta nueva (events.MediaRetry).
func (c *CuentaWA) pedirDeNuevo(cli *whatsmeow.Client, chat, id string, llave []byte) (string, error) {
	if len(llave) == 0 {
		return "", errors.New("el mensaje no trae la llave del archivo")
	}
	o, err := c.alm.Origen(chat, id)
	if err != nil {
		return "", err
	}
	chatJID, err := types.ParseJID(primero(o.ChatWA, o.Chat))
	if err != nil {
		return "", err
	}
	deJID, _ := types.ParseJID(primero(o.DeWA, o.De))
	info := types.MessageInfo{ID: id, MessageSource: types.MessageSource{
		Chat: chatJID, Sender: deJID, IsFromMe: o.Mio, IsGroup: chatJID.Server == types.GroupServer,
	}}
	ch := make(chan *events.MediaRetry, 1)
	c.reintentos.Store(id, ch)
	defer c.reintentos.Delete(id)
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	err = cli.SendMediaRetryReceipt(ctx, &info, llave)
	cancel()
	if err != nil {
		return "", err
	}
	select {
	case ev := <-ch:
		n, err := whatsmeow.DecryptMediaRetryNotification(ev, llave)
		if err != nil {
			return "", err
		}
		if n.GetResult() != waMmsRetry.MediaRetryNotification_SUCCESS || n.GetDirectPath() == "" {
			return "", fmt.Errorf("el teléfono no lo volvió a subir (%v)", n.GetResult())
		}
		return n.GetDirectPath(), nil
	case <-time.After(20 * time.Second):
		return "", errors.New("el teléfono no contestó a tiempo")
	}
}

/* ---------------------------------------------------------------- fotos de perfil y contactos */

func (c *CuentaWA) Foto(chat string) ([]byte, error) {
	if !c.cliente().IsLoggedIn() {
		return nil, ErrSinVincular
	}
	return c.fotos.Foto(c.alm.resolver(chat))
}

func (c *CuentaWA) FotoConocida(chat string) *bool { return c.fotos.Conocida(chat) }

// Le pregunta a WhatsApp por la foto (por el número y, si no contesta por ahí, por el LID) y la baja.
func (c *CuentaWA) traerFoto(ctx context.Context, chat string) ([]byte, error) {
	cli := c.cliente()
	if !cli.IsLoggedIn() {
		return nil, ErrSinVincular
	}
	j, err := types.ParseJID(chat)
	if err != nil {
		return nil, ErrSinFoto
	}
	ids := []types.JID{j.ToNonAD()}
	if alt := c.otraID(j); !alt.IsEmpty() {
		ids = append(ids, alt)
	}
	var ultimo error = ErrSinFoto
	for _, id := range ids {
		c2, cancel := context.WithTimeout(ctx, 10*time.Second)
		info, err := cli.GetProfilePictureInfo(c2, id, &whatsmeow.GetProfilePictureParams{Preview: true})
		cancel()
		switch {
		case errors.Is(err, whatsmeow.ErrProfilePictureNotSet), errors.Is(err, whatsmeow.ErrProfilePictureUnauthorized):
			continue
		case err != nil:
			ultimo = err
			continue
		case info == nil || info.URL == "":
			continue
		}
		return c.bajarFoto(ctx, info.URL)
	}
	return nil, ultimo
}

func (c *CuentaWA) bajarFoto(ctx context.Context, u string) ([]byte, error) {
	req, err := http.NewRequestWithContext(ctx, "GET", u, nil)
	if err != nil {
		return nil, err
	}
	r, err := c.web.Do(req)
	if err != nil {
		return nil, err
	}
	defer r.Body.Close()
	if r.StatusCode == 404 || r.StatusCode == 410 {
		return nil, ErrSinFoto
	}
	if r.StatusCode != 200 {
		return nil, fmt.Errorf("la foto respondió HTTP %d", r.StatusCode)
	}
	b, err := io.ReadAll(io.LimitReader(r.Body, MaxFoto+1))
	if err != nil {
		return nil, err
	}
	if len(b) > MaxFoto {
		return nil, errors.New("la foto pesa demasiado")
	}
	return b, nil
}

// La gente guardada en el teléfono (para empezar un chat con alguien que todavía no tiene uno aquí).
func (c *CuentaWA) Contactos(buscar string, limite int) ([]Contacto, error) {
	cli := c.cliente()
	if !cli.IsLoggedIn() {
		return nil, ErrSinVincular
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	todos, err := cli.Store.Contacts.GetAllContacts(ctx)
	if err != nil {
		return nil, err
	}
	q := strings.ToLower(strings.TrimSpace(buscar))
	qNum := soloDigitos(q)
	vistos := map[string]bool{}
	out := []Contacto{}
	for jid, ci := range todos {
		nombre := primero(ci.FullName, ci.FirstName, ci.BusinessName)
		if nombre == "" || (jid.Server != types.DefaultUserServer && jid.Server != types.HiddenUserServer) {
			continue // solo los guardados (o negocios), como en «Nuevo chat» de WhatsApp
		}
		canon := c.canonico(jid, types.EmptyJID)
		k := canon.String()
		numero := numeroDe(k)
		if vistos[k] || (q != "" && !strings.Contains(strings.ToLower(nombre), q) && (len(qNum) < 3 || !strings.Contains(numero, qNum))) {
			continue
		}
		vistos[k] = true
		out = append(out, Contacto{JID: k, Nombre: nombre, Numero: numero})
	}
	sort.Slice(out, func(i, j int) bool { return strings.ToLower(out[i].Nombre) < strings.ToLower(out[j].Nombre) })
	if len(out) > limite {
		out = out[:limite]
	}
	return out, nil
}

/* ---------------------------------------------------------------- lo que llega de WhatsApp */

func (c *CuentaWA) evento(e any) {
	defer func() {
		// Un mensaje raro no tumba el puente.
		if r := recover(); r != nil {
			c.log.Errorf("evento %T: %v", e, r)
		}
	}()
	switch v := e.(type) {
	case *events.Message:
		c.guardar(v, true)
	case *events.HistorySync:
		c.historia(v)
		c.pedirOrden()
	case *events.Receipt:
		// La persona leyó el chat en su teléfono: aquí también queda leído.
		if v.IsFromMe && (v.Type == types.ReceiptTypeRead || v.Type == types.ReceiptTypeReadSelf) {
			_ = c.alm.FijarNoLeidos(c.canonico(v.Chat, types.EmptyJID).String(), 0)
		}
	case *events.MediaRetry:
		if ch, ok := c.reintentos.Load(string(v.MessageID)); ok {
			select {
			case ch.(chan *events.MediaRetry) <- v:
			default:
			}
		}
	case *events.Connected:
		go c.alConectar()
	case *events.AppStateSyncComplete:
		c.pedirOrden()
	case *events.Contact:
		// En la sincronización completa llegan miles: esos los junta ordenar() al final.
		if !v.FromFullSync {
			nombre := primero(v.Action.GetFullName(), v.Action.GetFirstName())
			if nombre == "" {
				nombre = c.nombreDe(v.JID, "")
			}
			_ = c.alm.FijarNombre(c.canonico(v.JID, types.EmptyJID).String(), nombre)
		}
	case *events.PushName:
		// Como se puso la persona: solo si no la tiene guardada con otro nombre.
		alt := types.EmptyJID
		if v.JIDAlt.Server == types.DefaultUserServer {
			alt = v.JIDAlt
		}
		jid := c.canonico(v.JID, alt)
		if n := c.nombreDe(jid, v.NewPushName); n != "" {
			_, _ = c.alm.MejorarNombre(jid.String(), n)
		}
	case *events.GroupInfo:
		if v.Name != nil && v.Name.Name != "" {
			c.nombres.Store(v.JID.String(), v.Name.Name)
			_ = c.alm.FijarNombre(v.JID.String(), v.Name.Name)
		}
	case *events.JoinedGroup:
		if v.Name != "" {
			c.nombres.Store(v.JID.String(), v.Name)
			_ = c.alm.GuardarChat(v.JID.String(), v.Name, true, time.Now())
		}
	case *events.LoggedOut:
		// Lo desvincularon desde el teléfono: no queda nada guardado de esa cuenta.
		c.log.Warnf("desvinculado desde el teléfono (%v)", v.Reason)
		c.olvidar()
		_ = c.alm.Borrar()
	}
}

func (c *CuentaWA) historia(h *events.HistorySync) {
	cli := c.cliente()
	for _, conv := range h.Data.GetConversations() {
		jid, err := types.ParseJID(conv.GetID())
		if err != nil || jid.Server == types.BroadcastServer || jid.Server == types.NewsletterServer {
			continue
		}
		jid = jid.ToNonAD()
		grupo := jid.Server == types.GroupServer
		// Un chat por LID se guarda con su número si la historia lo dice (o si ya se sabe).
		canon := jid
		if jid.Server == types.HiddenUserServer {
			if pn, err := types.ParseJID(conv.GetPnJID()); err == nil && pn.Server == types.DefaultUserServer {
				canon = pn.ToNonAD()
			} else {
				canon = c.canonico(jid, types.EmptyJID)
			}
		}
		nombre := conv.GetName()
		if nombre == "" {
			nombre = conv.GetDisplayName()
		}
		if grupo {
			if nombre != "" {
				c.nombres.Store(jid.String(), nombre)
			} else {
				nombre = c.nombreGrupo(jid, false)
			}
		} else if n := c.nombreDe(canon, ""); n != "" {
			nombre = n // como lo tiene guardado manda sobre el nombre que traiga la historia
		}
		hora := time.Unix(int64(conv.GetConversationTimestamp()), 0)
		_ = c.alm.GuardarChat(canon.String(), nombre, grupo, hora)
		for _, hm := range conv.GetMessages() {
			ev, err := cli.ParseWebMessage(jid, hm.GetMessage())
			if err != nil {
				continue
			}
			if canon != jid && !grupo {
				if ev.Info.IsFromMe {
					ev.Info.RecipientAlt = canon
				} else {
					ev.Info.SenderAlt = canon
				}
			}
			c.guardar(ev, false)
		}
		_ = c.alm.FijarNoLeidos(canon.String(), int(conv.GetUnreadCount()))
	}
}

func (c *CuentaWA) guardar(ev *events.Message, vivo bool) {
	info := ev.Info
	if info.Chat.Server == types.BroadcastServer || info.Chat.Server == types.NewsletterServer {
		return // estados y canales: no son chats
	}
	grupo := info.Chat.Server == types.GroupServer
	alt := types.EmptyJID
	if !grupo {
		if info.IsFromMe {
			alt = info.RecipientAlt
		} else {
			alt = info.SenderAlt
		}
	}
	chatJID := c.canonico(info.Chat, alt)
	chat, chatWA := chatJID.String(), info.Chat.ToNonAD().String()
	msg := Desenvolver(ev.Message)
	if pm := msg.GetProtocolMessage(); pm != nil {
		for _, ch := range []string{chat, chatWA} {
			switch pm.GetType() {
			case waE2E.ProtocolMessage_REVOKE:
				_ = c.alm.Eliminar(ch, pm.GetKey().GetID())
			case waE2E.ProtocolMessage_MESSAGE_EDIT:
				if t, _ := Contenido(pm.GetEditedMessage()); t.Texto != "" {
					_ = c.alm.Editar(ch, pm.GetKey().GetID(), t.Texto)
				}
			}
		}
		return
	}
	cont, crudo := Contenido(msg)
	if cont.Tipo == "" {
		return
	}
	deJID := c.canonico(info.Sender, info.SenderAlt)
	if info.IsFromMe {
		if id := c.cliente().Store.ID; id != nil {
			deJID = id.ToNonAD()
		}
	}
	nombreChat := ""
	if grupo {
		nombreChat = c.nombreGrupo(info.Chat, vivo)
	} else if !info.IsFromMe {
		nombreChat = c.nombreDe(chatJID, info.PushName)
	} else {
		nombreChat = c.nombreDe(chatJID, "")
	}
	m := Mensaje{
		ID: info.ID, Chat: chat, ChatWA: chatWA, De: deJID.String(), DeWA: info.Sender.ToNonAD().String(), Mio: info.IsFromMe, Hora: info.Timestamp.UnixMilli(),
		Tipo: cont.Tipo, Texto: cont.Texto, Duracion: cont.Duracion, Archivo: cont.Archivo,
	}
	if !info.IsFromMe {
		m.NombreDe = primero(c.nombreDe(deJID, info.PushName), numeroDe(m.De))
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

/* ---------------------------------------------------------------- ids y nombres */

// La id con que se guarda a alguien: su número si se sabe (por `alt`, que trae el mensaje, o por la
// tabla de LIDs de whatsmeow); si no, la que vino.
func (c *CuentaWA) canonico(jid, alt types.JID) types.JID {
	jid = jid.ToNonAD()
	if jid.Server != types.HiddenUserServer {
		return jid
	}
	if alt.Server == types.DefaultUserServer {
		return alt.ToNonAD()
	}
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	if pn, err := c.cliente().Store.LIDs.GetPNForLID(ctx, jid); err == nil && !pn.IsEmpty() {
		return pn.ToNonAD()
	}
	return jid
}

// La otra id de una persona: el LID de un número o el número de un LID (vacía si no se sabe).
func (c *CuentaWA) otraID(jid types.JID) types.JID {
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	lids := c.cliente().Store.LIDs
	var otra types.JID
	var err error
	switch jid.Server {
	case types.HiddenUserServer:
		otra, err = lids.GetPNForLID(ctx, jid.ToNonAD())
	case types.DefaultUserServer:
		otra, err = lids.GetLIDForPN(ctx, jid.ToNonAD())
	default:
		return types.EmptyJID
	}
	if err != nil {
		return types.EmptyJID
	}
	return otra.ToNonAD()
}

// El nombre de una persona: como la tiene en sus contactos (por su número o su LID); si no, el de su
// negocio; si no, como ella se puso. Vacío si no se sabe (el número lo pone quien lo muestra).
func (c *CuentaWA) nombreDe(jid types.JID, pushName string) string {
	cli := c.cliente()
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	buscar := []types.JID{jid.ToNonAD()}
	if alt := c.otraID(jid); !alt.IsEmpty() {
		buscar = append(buscar, alt)
	}
	var negocio, puesto string
	for _, j := range buscar {
		ci, err := cli.Store.Contacts.GetContact(ctx, j)
		if err != nil || !ci.Found {
			continue
		}
		if n := primero(ci.FullName, ci.FirstName); n != "" {
			return n
		}
		negocio, puesto = primero(negocio, ci.BusinessName), primero(puesto, ci.PushName)
	}
	return primero(negocio, pushName, puesto)
}

// El nombre de un chat sin preguntarle a WhatsApp: el de la persona o el del grupo (vacío si no se sabe).
func (c *CuentaWA) Nombre(chat string) string {
	j, err := types.ParseJID(chat)
	if err != nil {
		return ""
	}
	if j.Server == types.GroupServer {
		if n, ok := c.nombres.Load(j.String()); ok {
			return n.(string)
		}
		return ""
	}
	return c.nombreDe(c.canonico(j, types.EmptyJID), "")
}

// El nombre de un grupo si ya se sabe. Si no y `preguntar`, se le pregunta a WhatsApp aparte (sin
// detener lo que llega) y se guarda cuando conteste.
func (c *CuentaWA) nombreGrupo(jid types.JID, preguntar bool) string {
	if n, ok := c.nombres.Load(jid.String()); ok {
		return n.(string)
	}
	if preguntar {
		go c.buscarGrupo(jid)
	}
	return ""
}

func (c *CuentaWA) buscarGrupo(jid types.JID) {
	if _, ya := c.buscando.LoadOrStore(jid.String(), true); ya {
		return
	}
	defer c.buscando.Delete(jid.String())
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	gi, err := c.cliente().GetGroupInfo(ctx, jid)
	if err != nil || gi.Name == "" {
		return
	}
	c.nombres.Store(jid.String(), gi.Name)
	_ = c.alm.FijarNombre(jid.String(), gi.Name)
}

/* ---------------------------------------------------------------- poner orden (aparte, sin detener nada) */

// Al conectar: poner orden y, una vez, los nombres de todos sus grupos (la historia a veces no los trae).
func (c *CuentaWA) alConectar() {
	c.pedirOrden()
	if c.grupos.Load() {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	gs, err := c.cliente().GetJoinedGroups(ctx)
	if err != nil {
		c.log.Warnf("no traje los grupos: %v", err)
		return
	}
	for _, g := range gs {
		if g != nil && g.Name != "" {
			c.nombres.Store(g.JID.String(), g.Name)
			_ = c.alm.FijarNombre(g.JID.String(), g.Name)
		}
	}
	c.grupos.Store(true)
	c.log.Infof("%d grupos con nombre", len(gs))
}

func (c *CuentaWA) pedirOrden() {
	select {
	case c.orden <- struct{}{}:
	default: // ya hay uno pendiente
	}
}

func (c *CuentaWA) ordenador() {
	for range c.orden {
		time.Sleep(3 * time.Second) // la historia llega en tandas: se junta lo que llegue mientras
		select {
		case <-c.orden:
		default:
		}
		c.ordenar()
	}
}

// Pasa al número lo guardado por LID cuando ya se sabe cuál es, y busca nombre a los chats que no tienen.
// Se puede repetir sin daño.
func (c *CuentaWA) ordenar() {
	defer func() {
		if r := recover(); r != nil {
			c.log.Errorf("ordenar: %v", r)
		}
	}()
	cli := c.cliente()
	if cli.Store.ID == nil {
		return
	}
	fusionados, nombrados, preguntados := 0, 0, 0
	lids, _ := c.alm.IDsLID()
	for _, l := range lids {
		lid, err := types.ParseJID(l)
		if err != nil {
			continue
		}
		if pn := c.canonico(lid, types.EmptyJID); pn.Server == types.DefaultUserServer {
			if err := c.alm.Fusionar(l, pn.String()); err != nil {
				c.log.Warnf("fusionar %s: %v", l, err)
			} else {
				fusionados++
			}
		}
	}
	sin, _ := c.alm.ChatsSinNombre(2000)
	for _, ch := range sin {
		if ok, _ := c.alm.MejorarNombre(ch.JID, c.Nombre(ch.JID)); ok {
			nombrados++
		} else if ch.Grupo && preguntados < 10 {
			if j, err := types.ParseJID(ch.JID); err == nil {
				preguntados++
				c.buscarGrupo(j)
			}
		}
	}
	if fusionados+nombrados > 0 {
		c.log.Infof("orden: %d LID pasados a su número, %d chats con nombre nuevo", fusionados, nombrados)
	}
}

func primero(s ...string) string {
	for _, x := range s {
		if x != "" {
			return x
		}
	}
	return ""
}
