// EL PUENTE DE WHATSAPP DE AU-RA: el WhatsApp personal de José como «dispositivo vinculado», para que la
// app y AURA para Windows lo vean y contesten (José, 2-oct). Corre como servicio PRIVADO de Render (sin
// dirección pública: solo el servidor de AU-RA lo alcanza por la red interna) y además pide clave.
//
// Variables: PUENTE_CLAVE (obligatoria), DATOS (carpeta del disco, /data), PORT (8080).
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
	alm, err := AbrirAlmacen(filepath.Join(datos, "mensajes.db"))
	if err != nil {
		log.Errorf("almacén: %v", err)
		os.Exit(1)
	}
	defer alm.Cerrar()
	ctx := context.Background()
	cuenta, err := NuevaCuentaWA(ctx, filepath.Join(datos, "sesion.db"), alm, log)
	if err != nil {
		log.Errorf("whatsapp: %v", err)
		os.Exit(1)
	}
	api := &API{clave: clave, cuenta: cuenta, almacen: alm}
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
	cuenta.cli.Disconnect()
}

func envO(k, def string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return def
}
