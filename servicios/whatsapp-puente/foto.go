package main

// LAS FOTOS DE PERFIL: la miniatura (la «preview» de WhatsApp, ~96 px) de cada chat, guardada en el disco
// (DATOS/fotos) un día; que alguien NO tiene foto se recuerda seis horas. La lista de la app pide muchas a
// la vez: a WhatsApp se le preguntan pocas al mismo tiempo, y dos pedidos de la misma foto esperan uno.

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"os"
	"path/filepath"
	"sync"
	"time"
)

var ErrSinFoto = errors.New("no tiene foto de perfil")

// Lo más grande que se acepta como foto de perfil (las de vista previa pesan unos pocos KB).
const MaxFoto = 2 << 20

type CacheFotos struct {
	dir    string
	vive   time.Duration // cuánto dura una foto en el disco
	viveNo time.Duration // cuánto se recuerda que no tiene
	espera time.Duration // cuánto se espera turno antes de rendirse
	turnos chan struct{}
	// Trae la foto de WhatsApp (ErrSinFoto si no tiene o la escondió).
	traer func(ctx context.Context, chat string) ([]byte, error)

	mu      sync.Mutex
	enVuelo map[string]*pedidoFoto
}

type pedidoFoto struct {
	listo chan struct{}
	datos []byte
	err   error
}

func NuevaCacheFotos(dir string, traer func(ctx context.Context, chat string) ([]byte, error)) *CacheFotos {
	_ = os.MkdirAll(dir, 0o700)
	return &CacheFotos{
		dir: dir, vive: 24 * time.Hour, viveNo: 6 * time.Hour, espera: 20 * time.Second,
		turnos: make(chan struct{}, 4), traer: traer, enVuelo: map[string]*pedidoFoto{},
	}
}

func (f *CacheFotos) rutas(chat string) (foto, sin string) {
	h := sha256.Sum256([]byte(chat))
	base := filepath.Join(f.dir, hex.EncodeToString(h[:16]))
	return base + ".jpg", base + ".sin"
}

// ¿Ya se sabe si tiene foto? true/false si está fresco en el disco; nil si habría que preguntar.
func (f *CacheFotos) Conocida(chat string) *bool {
	foto, sin := f.rutas(chat)
	if fresco(foto, f.vive) {
		v := true
		return &v
	}
	if fresco(sin, f.viveNo) {
		v := false
		return &v
	}
	return nil
}

func (f *CacheFotos) Foto(chat string) ([]byte, error) {
	foto, sin := f.rutas(chat)
	if fresco(foto, f.vive) {
		if b, err := os.ReadFile(foto); err == nil && len(b) > 0 {
			return b, nil
		}
	}
	if fresco(sin, f.viveNo) {
		return nil, ErrSinFoto
	}
	// Si ya hay alguien trayendo esta misma foto, se espera su resultado.
	f.mu.Lock()
	if p, ok := f.enVuelo[chat]; ok {
		f.mu.Unlock()
		<-p.listo
		return p.datos, p.err
	}
	p := &pedidoFoto{listo: make(chan struct{})}
	f.enVuelo[chat] = p
	f.mu.Unlock()
	defer func() {
		f.mu.Lock()
		delete(f.enVuelo, chat)
		f.mu.Unlock()
		close(p.listo)
	}()
	p.datos, p.err = f.preguntar(chat, foto, sin)
	return p.datos, p.err
}

func (f *CacheFotos) preguntar(chat, foto, sin string) ([]byte, error) {
	select {
	case f.turnos <- struct{}{}:
		defer func() { <-f.turnos }()
	case <-time.After(f.espera):
		return f.vieja(foto, errors.New("hay muchas fotos en camino; prueba en un momento"))
	}
	ctx, cancel := context.WithTimeout(context.Background(), 25*time.Second)
	defer cancel()
	b, err := f.traer(ctx, chat)
	switch {
	case errors.Is(err, ErrSinFoto):
		_ = os.Remove(foto)
		_ = os.WriteFile(sin, nil, 0o600)
		return nil, ErrSinFoto
	case err != nil:
		// Sin red o WhatsApp no contestó: mejor la de ayer que nada.
		return f.vieja(foto, err)
	case len(b) == 0 || len(b) > MaxFoto:
		return nil, ErrSinFoto
	}
	_ = os.Remove(sin)
	tmp := foto + ".tmp"
	if os.WriteFile(tmp, b, 0o600) == nil {
		_ = os.Rename(tmp, foto)
	}
	return b, nil
}

// Al desvincular: ni las fotos de sus contactos se quedan.
func (f *CacheFotos) Borrar() {
	_ = os.RemoveAll(f.dir)
	_ = os.MkdirAll(f.dir, 0o700)
}

func (f *CacheFotos) vieja(foto string, err error) ([]byte, error) {
	if b, e := os.ReadFile(foto); e == nil && len(b) > 0 {
		return b, nil
	}
	return nil, err
}

func fresco(ruta string, vive time.Duration) bool {
	st, err := os.Stat(ruta)
	return err == nil && time.Since(st.ModTime()) < vive
}
