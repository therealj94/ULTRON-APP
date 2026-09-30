/**
 * LAS CARAS CONOCIDAS (el reconocimiento con permiso de la app; lo guarda lib/caras-miembro.ts).
 *
 *   GET    /api/caras        → { personas: [{ id, nombre, relacion, vectores, creado }] }
 *   POST   /api/caras        { nombre, relacion: 'yo'|'conocido', vectores: number[128][], consentimiento: { como, frase? } }
 *                             → { persona } (400 con la frase si falta el permiso o no es un vector)
 *   DELETE /api/caras/:id    → { ok, nombre } (404 si no estaba)
 *   DELETE /api/caras        → { ok, borradas }
 *
 * Todo con la sesión de la mesa: las caras son del CORREO de la sesión firmada, nunca del cuerpo. Los
 * vectores solo vuelven a su dueño (el teléfono compara ahí; nadie más los pide). Sin fotos: lo que
 * no sea un vector de 128 números se rechaza.
 */
import type express from 'express';
import { agregarCara, cargarCaras, CarasNoDisponibles, olvidarCara, olvidarTodasLasCaras, validarAlta } from '../lib/caras-miembro';
import type { Sesion } from './seguridad';

type Deps = {
  exigirMesa: express.RequestHandler;
  limitar: (max: number, ventanaMs?: number, grupo?: string) => express.RequestHandler;
  sesionDe: (req: express.Request) => Sesion | null;
};

const sinSesion = (res: express.Response) => res.status(401).json({ error: 'Entra con tu sesión.', code: 'sesion_requerida', honesto: true });
const noDisponible = (res: express.Response) =>
  res.status(503).json({ error: 'Ahora mismo no pude leer las caras guardadas; intenta en un momento.', code: 'caras_no_disponibles', honesto: true });

export function montarRutasCaras(app: express.Express, d: Deps) {
  app.get('/api/caras', d.exigirMesa, d.limitar(30), async (req, res) => {
    const s = d.sesionDe(req);
    if (!s) return sinSesion(res);
    res.setHeader('Cache-Control', 'no-store');
    try {
      const { personas } = await cargarCaras(s.correo);
      return res.json({ personas: personas.map((p) => ({ id: p.id, nombre: p.nombre, relacion: p.relacion, vectores: p.vectores, creado: p.creado })), honesto: true });
    } catch (e) {
      if (e instanceof CarasNoDisponibles) return noDisponible(res);
      throw e;
    }
  });

  app.post('/api/caras', d.exigirMesa, d.limitar(20), async (req, res) => {
    const s = d.sesionDe(req);
    if (!s) return sinSesion(res);
    const v = validarAlta(req.body || {}, s.nombre);
    if (v.ok === false) return res.status(400).json({ error: v.error, honesto: true });
    try {
      const p = await agregarCara(s.correo, v);
      return res.json({ persona: { id: p.id, nombre: p.nombre, relacion: p.relacion, muestras: p.vectores.length }, honesto: true });
    } catch (e) {
      if (e instanceof CarasNoDisponibles) return noDisponible(res);
      if (e instanceof RangeError) return res.status(409).json({ error: e.message, honesto: true });
      throw e;
    }
  });

  app.delete('/api/caras/:id', d.exigirMesa, d.limitar(30), async (req, res) => {
    const s = d.sesionDe(req);
    if (!s) return sinSesion(res);
    try {
      const p = await olvidarCara(s.correo, String(req.params.id || '').slice(0, 40));
      if (!p) return res.status(404).json({ error: 'No conozco esa cara.', honesto: true });
      return res.json({ ok: true, nombre: p.nombre, honesto: true });
    } catch (e) {
      if (e instanceof CarasNoDisponibles) return noDisponible(res);
      throw e;
    }
  });

  app.delete('/api/caras', d.exigirMesa, d.limitar(10), async (req, res) => {
    const s = d.sesionDe(req);
    if (!s) return sinSesion(res);
    const borradas = await olvidarTodasLasCaras(s.correo);
    return res.json({ ok: true, borradas, honesto: true });
  });
}
