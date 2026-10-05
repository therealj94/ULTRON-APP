package main

// Revisión de seguridad del 5-oct (WhatsApp para todos): el eco de la cuenta en cada respuesta, el vencimiento de las
// vinculaciones a medias, los lugares guardados para la junta y el registro de whatsmeow sin números.

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	waLog "go.mau.fi/whatsmeow/util/log"
)

// Un pedido con cabeceras de más; devuelve el código, las cabeceras de la respuesta y el JSON.
func pedirConCabeceras(t *testing.T, h http.Handler, cuenta, metodo, ruta string, extra map[string]string, cuerpo any) (int, http.Header, map[string]any) {
	t.Helper()
	var b bytes.Buffer
	if cuerpo != nil {
		json.NewEncoder(&b).Encode(cuerpo)
	}
	r := httptest.NewRequest(metodo, ruta, &b)
	r.Header.Set("Authorization", "Bearer "+claveDePrueba)
	if cuenta != "" {
		r.Header.Set(CabeceraCuenta, cuenta)
	}
	for k, v := range extra {
		r.Header.Set(k, v)
	}
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	var j map[string]any
	_ = json.Unmarshal(w.Body.Bytes(), &j)
	return w.Code, w.Header(), j
}

// MEDIO-1: cada respuesta de una cuenta dice de qué cuenta es (X-Cuenta-Eco). Un puente de antes no la pone y el
// servidor de AU-RA no deja pasar nada de una cuenta que no sea «legado» sin ella.
func TestEcoDeLaCuenta(t *testing.T) {
	_, f, h := registroDePrueba(t, t.TempDir(), 25)
	rutas := [][2]string{
		{"GET", "/estado"}, {"GET", "/chats"}, {"GET", "/mensajes?chat=c"}, {"GET", "/buscar?q=hola"},
		{"GET", "/media?chat=c&id=foto"}, {"GET", "/foto?chat=504@s.whatsapp.net"}, {"GET", "/contactos"},
		{"GET", "/mensaje?id=3EB0ABCDEF0123456789AB"}, {"POST", "/leido"},
	}
	// Antes de vincular (412 SIN_VINCULAR o el estado vacío): también con su eco.
	for _, ruta := range rutas {
		c, cab, _ := pedirConCabeceras(t, h, cuentaAna, ruta[0], ruta[1], nil, map[string]string{"chat": "c"})
		if got := cab.Get(CabeceraEco); got != cuentaAna {
			t.Fatalf("%v (%d) sin eco: %q", ruta, c, got)
		}
	}
	// Vincular y, ya vinculada, cada ruta con el eco de SU cuenta (nunca el de otra).
	c, cab, _ := pedirConCabeceras(t, h, cuentaAna, "POST", "/vincular", nil, map[string]string{"telefono": "50499990000"})
	if c != 200 || cab.Get(CabeceraEco) != cuentaAna {
		t.Fatalf("vincular: %d eco %q", c, cab.Get(CabeceraEco))
	}
	f.cuentas[cuentaAna].vincularDeVerdad(t)
	for _, ruta := range append(rutas, [2]string{"POST", "/enviar"}) {
		c, cab, _ := pedirConCabeceras(t, h, cuentaAna, ruta[0], ruta[1], nil, map[string]string{"chat": "504@s.whatsapp.net", "texto": "hola"})
		if got := cab.Get(CabeceraEco); got != cuentaAna {
			t.Fatalf("%v (%d) vinculada sin eco: %q", ruta, c, got)
		}
	}
	if c, cab, _ := pedirConCabeceras(t, h, ClaveLegado, "GET", "/estado", nil, nil); c != 200 || cab.Get(CabeceraEco) != ClaveLegado {
		t.Fatalf("legado también: %d %q", c, cab.Get(CabeceraEco))
	}
	// Sin cuenta válida no hay de quién hacer eco; /salud no es de nadie.
	if _, cab, _ := pedirConCabeceras(t, h, "../x", "GET", "/chats", nil, nil); cab.Get(CabeceraEco) != "" {
		t.Fatal("SIN_CUENTA sin eco")
	}
	if _, cab, _ := pedirConCabeceras(t, h, "", "GET", "/salud", nil, nil); cab.Get(CabeceraEco) != "" {
		t.Fatal("salud sin eco")
	}
}

// Un reloj de prueba para el registro.
type relojFalso struct {
	mu sync.Mutex
	t  time.Time
}

func (r *relojFalso) ahora() time.Time { r.mu.Lock(); defer r.mu.Unlock(); return r.t }
func (r *relojFalso) pasar(d time.Duration) {
	r.mu.Lock()
	r.t = r.t.Add(d)
	r.mu.Unlock()
}

// MEDIO-2: una vinculación que nunca terminó (sin sesión) vence a los ~3 minutos y suelta su lugar, aunque siga
// «vinculando» y aunque el cupo esté lleno: con el barrido de cada /vincular y con el periódico.
func TestVinculacionAMediasVence(t *testing.T) {
	reg, f, h := registroDePrueba(t, t.TempDir(), 2)
	reloj := &relojFalso{t: time.Unix(1_800_000_000, 0)}
	reg.ahora = reloj.ahora
	// Ana y Bruno piden el código y lo dejan ahí: siguen «vinculando», sin sesión.
	for _, k := range []string{cuentaAna, cuentaBruno} {
		if c, _ := pedirComo(t, h, k, "POST", "/vincular", claveDePrueba, map[string]string{"telefono": "50499990000"}); c != 200 {
			t.Fatalf("vincular %s: %d", k[:4], c)
		}
		if !f.cuentas[k].Estado().Vinculando {
			t.Fatal("la falsa queda vinculando")
		}
	}
	// Lleno: antes de que venzan, Carla no entra (están en curso).
	reloj.pasar(2 * time.Minute)
	if c, j := pedirComo(t, h, cuentaCarla, "POST", "/vincular", claveDePrueba, map[string]string{"telefono": "50499990000"}); c != 507 || j["codigo"] != "CUPO_LLENO" {
		t.Fatalf("antes de vencer: %d %v", c, j)
	}
	// Bruno sí terminó (escribió el código en su teléfono): una cuenta con sesión nunca vence.
	f.cuentas[cuentaBruno].vincularDeVerdad(t)
	// Pasados los 3 minutos, el /vincular de Carla barre la de Ana (lleno y todo) y entra.
	reloj.pasar(VenceVinculacion)
	if c, j := pedirComo(t, h, cuentaCarla, "POST", "/vincular", claveDePrueba, map[string]string{"telefono": "50499990000"}); c != 200 {
		t.Fatalf("con el lugar de una vinculación vencida: %d %v", c, j)
	}
	if got := reg.claves(); len(got) != 2 || got[0] != cuentaBruno || got[1] != cuentaCarla {
		t.Fatalf("registro: %v", got)
	}
	if _, err := os.Stat(filepath.Join(reg.raiz, cuentaAna)); !os.IsNotExist(err) || !f.cuentas[cuentaAna].cerrada {
		t.Fatalf("la vencida se cierra y se borra: %v", err)
	}
	// El barrido periódico suelta a Carla cuando vence, sin que nadie pida nada; a Bruno (vinculado) no lo toca.
	reloj.pasar(VenceVinculacion - time.Second)
	if n := reg.Barrer(); n != 0 {
		t.Fatalf("todavía no vence: %d", n)
	}
	reloj.pasar(2 * time.Second)
	if n := reg.Barrer(); n != 1 {
		t.Fatalf("barrido periódico: %d", n)
	}
	if got := reg.claves(); len(got) != 1 || got[0] != cuentaBruno {
		t.Fatalf("después del barrido: %v", got)
	}
	// Volver a pedir el código para la misma cuenta no estira el plazo: vence contado desde que se abrió.
	if c, _ := pedirComo(t, h, cuentaAna, "POST", "/vincular", claveDePrueba, map[string]string{"telefono": "50499990000"}); c != 200 {
		t.Fatal("Ana otra vez")
	}
	reloj.pasar(2 * time.Minute)
	if c, _ := pedirComo(t, h, cuentaAna, "POST", "/vincular", claveDePrueba, map[string]string{"telefono": "50499990000"}); c != 200 {
		t.Fatal("Ana pide otro código")
	}
	reloj.pasar(time.Minute + time.Second)
	if n := reg.Barrer(); n != 1 {
		t.Fatalf("el plazo no se estira: %d", n)
	}
}

// MEDIO-2: WHATSAPP_RESERVA_JUNTA guarda los últimos lugares para la junta y el padrón (X-Cuenta-Prioridad: junta,
// que solo pone el servidor de AU-RA). Las demás cuentas ven el cupo lleno antes.
func TestReservaParaLaJunta(t *testing.T) {
	reg, f, h := registroDePrueba(t, t.TempDir(), 4)
	reg.Reservar(2)
	general := func(i int) string { return strings.Repeat(fmt.Sprintf("%x", 0xa+i), 40) }
	for i := 0; i < 2; i++ {
		if c, _, _ := pedirConCabeceras(t, h, general(i), "POST", "/vincular", nil, map[string]string{"telefono": "50499990000"}); c != 200 {
			t.Fatalf("general %d: %d", i, c)
		}
		f.cuentas[general(i)].vincularDeVerdad(t)
	}
	// Quedan dos lugares, los dos guardados: una cuenta sin prioridad no entra (y no se le crea carpeta).
	c, _, j := pedirConCabeceras(t, h, general(2), "POST", "/vincular", nil, map[string]string{"telefono": "50499990000"})
	if c != 507 || j["codigo"] != "CUPO_LLENO" {
		t.Fatalf("sin prioridad, con solo lugares guardados: %d %v", c, j)
	}
	if _, err := os.Stat(filepath.Join(reg.raiz, general(2))); !os.IsNotExist(err) {
		t.Fatal("sin carpeta")
	}
	// Otro valor en la cabecera no da prioridad.
	if c, _, _ := pedirConCabeceras(t, h, general(2), "POST", "/vincular", map[string]string{CabeceraPrioridad: "JUNTA!"}, map[string]string{"telefono": "50499990000"}); c != 507 {
		t.Fatalf("prioridad mal escrita: %d", c)
	}
	// La junta sí (el servidor pone la cabecera) y «legado» (los dueños) también.
	if c, _, _ := pedirConCabeceras(t, h, general(3), "POST", "/vincular", map[string]string{CabeceraPrioridad: "junta"}, map[string]string{"telefono": "50499990000"}); c != 200 {
		t.Fatalf("junta: %d", c)
	}
	if c, _, _ := pedirConCabeceras(t, h, ClaveLegado, "POST", "/vincular", nil, map[string]string{"telefono": "50499990000"}); c != 200 {
		t.Fatalf("legado: %d", c)
	}
	// Ya lleno de verdad: ni la junta.
	if c, _, j := pedirConCabeceras(t, h, general(4), "POST", "/vincular", map[string]string{CabeceraPrioridad: "junta"}, map[string]string{"telefono": "50499990000"}); c != 507 {
		t.Fatalf("lleno para todos: %d %v", c, j)
	}
	// La reserva nunca se come el cupo entero (al menos un lugar para cualquiera) ni es negativa.
	reg.Reservar(99)
	if reg.reserva != reg.max-1 {
		t.Fatalf("reserva acotada: %d", reg.reserva)
	}
	reg.Reservar(-3)
	if reg.reserva != 0 {
		t.Fatalf("reserva negativa: %d", reg.reserva)
	}
}

// Un registro que guarda lo que se escribe.
type logGuardado struct {
	mu     sync.Mutex
	lineas []string
}

func (l *logGuardado) poner(nivel, msg string, args ...any) {
	l.mu.Lock()
	defer l.mu.Unlock()
	l.lineas = append(l.lineas, nivel+" "+fmt.Sprintf(msg, args...))
}
func (l *logGuardado) Warnf(m string, a ...any)  { l.poner("WARN", m, a...) }
func (l *logGuardado) Errorf(m string, a ...any) { l.poner("ERROR", m, a...) }
func (l *logGuardado) Infof(m string, a ...any)  { l.poner("INFO", m, a...) }
func (l *logGuardado) Debugf(m string, a ...any) { l.poner("DEBUG", m, a...) }
func (l *logGuardado) Sub(string) waLog.Logger   { return l }

// MENOR: whatsmeow escribe en INFO el número vinculado y JIDs («Successfully paired 504…»): su registro va en WARN.
func TestRegistroDeWhatsmeowSoloAvisos(t *testing.T) {
	base := &logGuardado{}
	l := soloAvisos(base)
	l.Infof("Successfully paired %s", "50499990000@s.whatsapp.net")
	l.Debugf("debug %s", "x")
	l.Sub("otro").Infof("tampoco")
	l.Warnf("aviso")
	l.Sub("otro").Errorf("error")
	if strings.Join(base.lineas, "|") != "WARN aviso|ERROR error" {
		t.Fatalf("solo avisos y errores: %v", base.lineas)
	}
	// El cliente de whatsmeow de cada cuenta usa ese registro.
	c, _ := cuentaDePrueba(t)
	base.lineas = nil
	c.log = base
	c.usar(c.cli.Store)
	c.cli.Log.Infof("Successfully paired %s", "50488887777@s.whatsapp.net")
	c.cli.Log.Warnf("se cayó")
	if len(base.lineas) != 1 || !strings.HasPrefix(base.lineas[0], "WARN") {
		t.Fatalf("el cliente no escribe INFO: %v", base.lineas)
	}
}

// MENOR: sin PUENTE_CLAVE (o con una corta) el puente no arranca: con varias cuentas, nunca «abierto por omisión».
func TestSinClaveNoArranca(t *testing.T) {
	entorno := func(m map[string]string) func(string) string { return func(k string) string { return m[k] } }
	for _, clave := range []string{"", "corta", strings.Repeat("x", MinClavePuente-1)} {
		if _, err := configDelEntorno(entorno(map[string]string{"PUENTE_CLAVE": clave, "WHATSAPP_MAX_CUENTAS": "25"})); err == nil {
			t.Fatalf("arrancó con PUENTE_CLAVE de %d caracteres", len(clave))
		}
	}
	c, err := configDelEntorno(entorno(map[string]string{"PUENTE_CLAVE": claveDePrueba}))
	if err != nil {
		t.Fatalf("con clave: %v", err)
	}
	if c.max != 25 || c.reserva != 2 || c.datos != "/data" || c.puerto != "8080" || c.nivel != "INFO" {
		t.Fatalf("por omisión: %+v", c)
	}
	c, err = configDelEntorno(entorno(map[string]string{"PUENTE_CLAVE": claveDePrueba, "WHATSAPP_MAX_CUENTAS": "0", "WHATSAPP_RESERVA_JUNTA": "-1"}))
	if err != nil || c.max != 25 || c.reserva != 2 {
		t.Fatalf("valores inválidos vuelven a los de siempre: %+v %v", c, err)
	}
	c, _ = configDelEntorno(entorno(map[string]string{"PUENTE_CLAVE": claveDePrueba, "WHATSAPP_MAX_CUENTAS": "10", "WHATSAPP_RESERVA_JUNTA": "3"}))
	if c.max != 10 || c.reserva != 3 {
		t.Fatalf("los fijados: %+v", c)
	}
}
