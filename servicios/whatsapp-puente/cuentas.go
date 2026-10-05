package main

// LAS CUENTAS DEL PUENTE (José, 5-oct: «No aparece agregar whatsapp… ni les aparece whatsapp»): cada cuenta de
// AU-RA puede vincular SU WhatsApp. Una cuenta de WhatsApp (un cliente de whatsmeow) por cuenta de AU-RA, cada una
// en su carpeta y sin ver nada de las otras.
//
//   - La cuenta la dice el servidor de AU-RA en cada pedido con la cabecera X-Cuenta: una clave opaca (un HMAC que
//     el servidor saca de la sesión; nunca el correo). El puente no sabe de quién es: solo la usa de nombre de carpeta.
//   - Cada una vive en DATOS/cuentas/<clave>/: sesion.db (las llaves del aparato vinculado), mensajes.db (chats y
//     mensajes) y fotos/ (las fotos de perfil). La carpeta nace en el primer /vincular y se borra entera al desvincular.
//   - «legado» es la cuenta que había antes (la de José, en la raíz del disco): al arrancar se pasa a
//     cuentas/legado sin volver a vincular. El servidor manda «legado» para las cuentas de WHATSAPP_DUENOS.
//   - Se conectan a pedido: al arrancar solo se reconectan las que tienen sesión; una carpeta sin sesión (una
//     vinculación que quedó a medias) se borra.
//   - Tope: WHATSAPP_MAX_CUENTAS (25). Lleno, /vincular de una cuenta nueva contesta CUPO_LLENO.
//   - Los últimos WHATSAPP_RESERVA_JUNTA (2) lugares son solo para la junta y el padrón: el servidor de AU-RA lo dice
//     con X-Cuenta-Prioridad: junta (solo él llega al puente, con su clave). «legado» siempre tiene prioridad.
//   - Una vinculación que no termina (sin sesión) vence a los 3 minutos de abrirse y suelta su lugar, aunque siga
//     «vinculando» y aunque el cupo esté lleno (revisión del 5-oct, MEDIO-2: si no, unas pocas identidades de
//     usar y tirar llenaban el cupo). Se barre en cada /vincular y cada 30 s (main.go).

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"sync"
	"time"

	waLog "go.mau.fi/whatsmeow/util/log"
)

// La clave de una cuenta: «legado» o el HMAC en hexadecimal que manda el servidor. Nada más (ni «..», ni «/»):
// es el nombre de la carpeta.
var claveValida = regexp.MustCompile(`^(legado|[a-f0-9]{32,64})$`)

// La cuenta de quien vinculó antes de que el puente tuviera varias (la de José).
const ClaveLegado = "legado"

var ErrCupoLleno = errors.New("el puente de WhatsApp ya tiene todas las cuentas que caben; avísale al administrador de AU-RA")

// Cuánto puede durar una vinculación sin terminar (sin sesión guardada), contado desde que se abrió su cuenta. Lo que
// tarda WhatsApp en agotar los QR (~2 min y medio) más un margen; volver a pedir el código no lo estira.
const VenceVinculacion = 3 * time.Minute

// Lo que tiene una cuenta de AU-RA en el puente: su WhatsApp, su almacén y su carpeta.
type Espacio struct {
	clave   string
	dir     string
	cuenta  Cuenta
	almacen *Almacen
	// Cuándo se abrió (el primer /vincular, o al arrancar): una vinculación sin sesión vence contada desde aquí.
	creada time.Time
	// Los envíos con id van de uno en uno (AUR13): buscar si ya salió y mandarlo no se cruzan. Por cuenta.
	enviando sync.Mutex
}

// Abre el WhatsApp de una cuenta en su carpeta (whatsmeow en main.go; una falsa en las pruebas). Si ya estaba
// vinculada, se conecta sola.
type AbrirCuenta func(clave, dir string, alm *Almacen) (Cuenta, error)

type Registro struct {
	mu      sync.Mutex
	raiz    string // DATOS/cuentas
	max     int
	reserva int // los últimos lugares, solo para la junta y el padrón (Reservar)
	log     waLog.Logger
	ahora   func() time.Time
	abrir   AbrirCuenta
	cuentas map[string]*Espacio
}

// Prepara el registro: crea DATOS/cuentas y pasa ahí la cuenta de antes (legado). No abre ninguna (eso es Cargar).
func NuevoRegistro(datos string, max int, log waLog.Logger, abrir AbrirCuenta) (*Registro, error) {
	if max < 1 {
		max = 1
	}
	raiz := filepath.Join(datos, "cuentas")
	if err := os.MkdirAll(raiz, 0o700); err != nil {
		return nil, err
	}
	if err := migrarLegado(datos, raiz, log); err != nil {
		return nil, err
	}
	return &Registro{raiz: raiz, max: max, log: log, abrir: abrir, ahora: time.Now, cuentas: map[string]*Espacio{}}, nil
}

// Guarda los últimos `n` lugares del cupo para la junta y el padrón (WHATSAPP_RESERVA_JUNTA). Nunca el cupo entero:
// queda al menos un lugar para cualquiera.
func (r *Registro) Reservar(n int) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if n > r.max-1 {
		n = r.max - 1
	}
	if n < 0 {
		n = 0
	}
	r.reserva = n
}

// Lo de la cuenta de antes, en la raíz del disco. Se mueve (mismo disco: rename, sin copiar) a cuentas/legado.
var archivosLegado = []string{
	"sesion.db", "sesion.db-wal", "sesion.db-shm", "sesion.db-journal",
	"mensajes.db", "mensajes.db-wal", "mensajes.db-shm", "mensajes.db-journal",
	"fotos",
}

// Pasa la cuenta de antes a cuentas/legado, archivo por archivo. Si se corta a la mitad, al volver a arrancar
// termina (lo que ya se movió no está en la raíz). Nunca pisa nada: si ya hay un archivo con ese nombre en
// legado, no arranca (mejor un error a la vista que perder la sesión de José).
func migrarLegado(datos, raiz string, log waLog.Logger) error {
	destino := filepath.Join(raiz, ClaveLegado)
	var mover []string
	for _, n := range archivosLegado {
		if _, err := os.Lstat(filepath.Join(datos, n)); err == nil {
			mover = append(mover, n)
		}
	}
	if len(mover) == 0 {
		return nil
	}
	if err := os.MkdirAll(destino, 0o700); err != nil {
		return err
	}
	for _, n := range mover {
		if _, err := os.Lstat(filepath.Join(destino, n)); err == nil {
			return fmt.Errorf("no migré la cuenta de antes: ya hay %s en %s (no piso nada; revísalo a mano)", n, destino)
		}
	}
	for _, n := range mover {
		if err := os.Rename(filepath.Join(datos, n), filepath.Join(destino, n)); err != nil {
			return fmt.Errorf("no pude pasar %s a la cuenta legado: %w", n, err)
		}
	}
	log.Infof("la cuenta de antes pasó a cuentas/%s (%d archivos), sin volver a vincular", ClaveLegado, len(mover))
	return nil
}

// Al arrancar: reconecta las cuentas que tienen sesión. Lo que quedó a medias (nunca se vinculó, o la
// desvincularon desde el teléfono) se borra: no ocupa cupo ni guarda nada de nadie.
func (r *Registro) Cargar() {
	entradas, err := os.ReadDir(r.raiz)
	if err != nil {
		r.log.Warnf("no pude leer %s: %v", r.raiz, err)
		return
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	for _, en := range entradas {
		clave := en.Name()
		if !en.IsDir() || !claveValida.MatchString(clave) {
			continue
		}
		if _, ya := r.cuentas[clave]; ya {
			continue
		}
		e, err := r.abrirEspacio(clave)
		if err != nil {
			r.log.Warnf("cuenta %s: no abrió: %v", nombreLog(clave), err)
			continue
		}
		if !e.cuenta.TieneSesion() {
			r.log.Infof("cuenta %s: sin sesión (vinculación a medias): se borra", nombreLog(clave))
			r.soltar(e)
			continue
		}
		r.cuentas[clave] = e
	}
	if len(r.cuentas) > r.max {
		r.log.Warnf("hay %d cuentas vinculadas y el tope es %d: siguen todas, pero no entra ninguna nueva", len(r.cuentas), r.max)
	}
	r.log.Infof("%d cuentas de WhatsApp (tope %d)", len(r.cuentas), r.max)
}

// La de esa clave, si existe. Nunca crea nada (todo pedido que no es /vincular).
func (r *Registro) Obtener(clave string) (*Espacio, bool) {
	r.mu.Lock()
	defer r.mu.Unlock()
	e, ok := r.cuentas[clave]
	return e, ok
}

// La de esa clave; si no existe, la crea (solo /vincular), si cabe. `prioridad`: es de la junta o del padrón (puede
// usar los lugares guardados); «legado» siempre. Antes, barre las vinculaciones vencidas (también la suya: así una
// cuenta que se quedó a medias vuelve a empezar con su plazo entero).
func (r *Registro) ObtenerOCrear(clave string, prioridad bool) (*Espacio, error) {
	if !claveValida.MatchString(clave) {
		return nil, errors.New("clave de cuenta inválida")
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	r.barrerVencidas()
	if e, ok := r.cuentas[clave]; ok {
		return e, nil
	}
	tope := r.max
	if !prioridad && clave != ClaveLegado {
		tope = r.max - r.reserva
	}
	if len(r.cuentas) >= tope {
		r.liberarAMedias()
	}
	if len(r.cuentas) >= tope {
		return nil, ErrCupoLleno
	}
	e, err := r.abrirEspacio(clave)
	if err != nil {
		return nil, err
	}
	r.cuentas[clave] = e
	return e, nil
}

// El barrido periódico (main.go): suelta las vinculaciones vencidas. Devuelve cuántas.
func (r *Registro) Barrer() int {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.barrerVencidas()
}

// Las que llevan más de VenceVinculacion sin sesión (nunca terminaron de vincular, o las desvincularon desde el
// teléfono) se sueltan y se borran, aunque sigan «vinculando». Una con sesión nunca. Con r.mu tomado.
func (r *Registro) barrerVencidas() int {
	ahora := r.ahora()
	n := 0
	for k, e := range r.cuentas {
		if !e.cuenta.TieneSesion() && ahora.Sub(e.creada) >= VenceVinculacion {
			r.log.Infof("cuenta %s: la vinculación venció sin terminar: se borra", nombreLog(k))
			delete(r.cuentas, k)
			_ = r.soltar(e)
			n++
		}
	}
	return n
}

// Con el cupo lleno, antes de decir que no: las que empezaron a vincular y no terminaron (sin sesión y sin
// vinculación en curso) se sueltan y se borran.
func (r *Registro) liberarAMedias() {
	for k, e := range r.cuentas {
		if !e.cuenta.TieneSesion() && !e.cuenta.Estado().Vinculando {
			r.log.Infof("cuenta %s: vinculación abandonada: se borra para hacer lugar", nombreLog(k))
			delete(r.cuentas, k)
			r.soltar(e)
		}
	}
}

// Desvincular: la cuenta sale del registro, se cierra y su carpeta se borra entera.
func (r *Registro) Quitar(clave string) error {
	r.mu.Lock()
	e, ok := r.cuentas[clave]
	delete(r.cuentas, clave)
	r.mu.Unlock()
	if !ok {
		return nil
	}
	return r.soltar(e)
}

// Apagar el puente: se sueltan todas sin borrar nada.
func (r *Registro) CerrarTodo() {
	r.mu.Lock()
	defer r.mu.Unlock()
	for k, e := range r.cuentas {
		e.cuenta.Cerrar()
		_ = e.almacen.Cerrar()
		delete(r.cuentas, k)
	}
}

// Cuántas hay y el tope (para /salud; sin claves).
func (r *Registro) Cupo() (usadas, max int) {
	r.mu.Lock()
	defer r.mu.Unlock()
	return len(r.cuentas), r.max
}

// Las claves cargadas, en orden (pruebas y registro).
func (r *Registro) claves() []string {
	r.mu.Lock()
	defer r.mu.Unlock()
	out := make([]string, 0, len(r.cuentas))
	for k := range r.cuentas {
		out = append(out, k)
	}
	sort.Strings(out)
	return out
}

func (r *Registro) abrirEspacio(clave string) (*Espacio, error) {
	dir := filepath.Join(r.raiz, clave)
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return nil, err
	}
	alm, err := AbrirAlmacen(filepath.Join(dir, "mensajes.db"))
	if err != nil {
		return nil, err
	}
	c, err := r.abrir(clave, dir, alm)
	if err != nil {
		alm.Cerrar()
		return nil, err
	}
	return &Espacio{clave: clave, dir: dir, cuenta: c, almacen: alm, creada: r.ahora()}, nil
}

// Cierra la cuenta y borra su carpeta (la sesión, los chats y las fotos).
func (r *Registro) soltar(e *Espacio) error {
	e.cuenta.Cerrar()
	_ = e.almacen.Cerrar()
	if err := os.RemoveAll(e.dir); err != nil {
		return fmt.Errorf("no pude borrar lo guardado de esa cuenta: %w", err)
	}
	return nil
}

// Cómo sale una cuenta en el registro: los primeros 8 de la clave (nunca entera).
func nombreLog(clave string) string {
	if len(clave) > 8 {
		return clave[:8]
	}
	return clave
}
