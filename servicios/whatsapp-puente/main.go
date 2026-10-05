// EL PUENTE DE WHATSAPP DE AU-RA: el WhatsApp personal de cada cuenta de AU-RA como «dispositivo vinculado», para
// que la app y AURA para Windows lo vean y contesten (José, 2-oct; para todas las cuentas desde el 5-oct: una
// cuenta de WhatsApp por cuenta de AU-RA, cada una en su carpeta; cuentas.go). Corre como servicio PRIVADO de Render
// (sin dirección pública: solo el servidor de AU-RA lo alcanza por la red interna) y además pide clave.
//
// Variables: PUENTE_CLAVE (obligatoria), DATOS (carpeta del disco, /data), PORT (8080),
// WHATSAPP_MAX_CUENTAS (cuántas cuentas caben; 25).
//
// Hecho con whatsmeow (la librería de WhatsApp Web multi-dispositivo; la misma que usa
// lharries/whatsapp-mcp). No es una API oficial de Meta: José lo eligió sabiendo el riesgo.
package main

import (
	"context"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"strconv"
	"syscall"
	"time"

	_ "github.com/mattn/go-sqlite3"
	waLog "go.mau.fi/whatsmeow/util/log"
)

func main() {
	log := waLog.Stdout("puente", envO("NIVEL_LOG", "INFO"), false)
	clave := os.Getenv("PUENTE_CLAVE")
	if len(clave) < 24 {
		log.Errorf("falta PUENTE_CLAVE (24 caracteres o más)")
		os.Exit(1)
	}
	datos := envO("DATOS", "/data")
	if err := os.MkdirAll(datos, 0o700); err != nil {
		log.Errorf("no pude crear %s: %v", datos, err)
		os.Exit(1)
	}
	ctx := context.Background()
	max, err := strconv.Atoi(envO("WHATSAPP_MAX_CUENTAS", "25"))
	if err != nil || max < 1 {
		max = 25
	}
	cuentas, err := NuevoRegistro(datos, max, log, func(clave, dir string, alm *Almacen) (Cuenta, error) {
		return NuevaCuentaWA(ctx, filepath.Join(dir, "sesion.db"), filepath.Join(dir, "fotos"), alm, log.Sub(nombreLog(clave)))
	})
	if err != nil {
		log.Errorf("cuentas: %v", err)
		os.Exit(1)
	}
	// Solo las que ya estaban vinculadas se reconectan (cada una aparte); las demás nacen en su primer /vincular.
	cuentas.Cargar()
	api := &API{clave: clave, cuentas: cuentas}
	srv := &http.Server{Addr: ":" + envO("PORT", "8080"), Handler: api.Rutas(), ReadHeaderTimeout: 10 * time.Second}
	go func() {
		log.Infof("escuchando en %s", srv.Addr)
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Errorf("http: %v", err)
			os.Exit(1)
		}
	}()
	fin := make(chan os.Signal, 1)
	signal.Notify(fin, os.Interrupt, syscall.SIGTERM)
	<-fin
	c, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	_ = srv.Shutdown(c)
	cuentas.CerrarTodo()
}

func envO(k, def string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return def
}
