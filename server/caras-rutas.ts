/**
 * LAS CARAS CONOCIDAS (el reconocimiento con permiso de la app; lo guarda lib/caras-miembro.ts).
 *
 *   GET    /api/caras        → { personas: [{ id, nombre, relacion, parentesco?, vectores, creado }] }
 *   POST   /api/caras        { nombre, relacion: 'yo'|'conocido', vectores: number[128][], consentimiento: { como, frase? }, parentesco? }
 *                             → { persona } (400 con la frase si falta el permiso o no es un vector)
 *   POST   /api/caras/:id/muestras { vectores: number[128][] (1-2) } → { ok, muestras } (aprender con el uso:
 *                             solo a alguien que ya está en el cajón de esta sesión; 404 si no)
 *   POST   /api/caras/:id/confirmar → { ok } (A-7: la dueña confirma EN SU PANTALLA el permiso de un posible menor;
 *                             el listado marca `porConfirmar: true` mientras falte)
 *   DELETE /api/caras/:id    → { ok, nombre } (404 si no estaba)
 *   DELETE /api/caras        → { ok, borradas }
 *
 * Todo con la sesión de la mesa: las caras son del CORREO de la sesión firmada, nunca del cuerpo. Los
 * vectores solo vuelven a su dueño (el teléfono compara ahí; nadie más los pide). Sin fotos: lo que
 * no sea un vector de 128 números se rechaza.
 */
import type express from 'express';
import { BorradoDegradado } from '../lib/biometria-durable';
import { pendienteDeConfirmar } from '../lib/biometria-consentimiento';
import { agregarCara, cargarCaras, CarasNoDisponibles, CarasNoGuardadas, confirmarConsentimientoCara, olvidarCara, olvidarTodasLasCaras, sumarMuestras, validarAlta, validarMuestras } from '../lib/caras-miembro';
import type { Sesion } from './seguridad';

type Deps = {
  exigirMesa: express.RequestHandler;
  limitar: (max: number, ventanaMs?: number, grupo?: string) => express.RequestHandler;
  sesionDe: (req: express.Request) => Sesion | null;
};

const sinSesion = (res: express.Response) => res.status(401).json({ error: 'Entra con tu sesión.', code: 'sesion_requerida', honesto: true });
const noGuardado = (res: express.Response) =>
  res.status(503).json({ error: 'No pude guardar el cambio de forma segura; intenta otra vez en un momento.', code: 'caras_no_guardadas', honesto: true });
const noDisponible = (res: express.Response) =>
  res.status(503).json({ error: 'Ahora mismo no pude leer las caras guardadas; intenta en un momento.', code: 'caras_no_disponibles', honesto: true });

/**
 * SEC-03: S3 ya no la tiene, pero la copia local vieja no se pudo reescribir ni quitar. No es «borrada del todo»: 202
 * con `completo: false` y el porqué. AURA no la usa (la caché y S3 están al día y la lectura aplica las lápidas).
 */
const borradoDegradado = (res: express.Response, extra: Record<string, unknown>) =>
  res.status(202).json({
    ok: true,
    completo: false,
    pendiente: 'copia_local',
    ...extra,
    aviso: 'La borré de la copia principal, pero una copia local vieja no se pudo quitar todavía. No la uso; vuelve a pedirlo en un momento para terminar.',
    honesto: true,
  });

export function montarRutasCaras(app: express.Express, d: Deps) {
  app.get('/api/caras', d.exigirMesa, d.limitar(30), async (req, res) => {
    const s = d.sesionDe(req);
    if (!s) return sinSesion(res);
    res.setHeader('Cache-Control', 'no-store');
    try {
      const { personas } = await cargarCaras(s.correo);
      return res.json({
        personas: personas.map((p) => ({ id: p.id, nombre: p.nombre, relacion: p.relacion, ...(p.parentesco ? { parentesco: p.parentesco } : {}), vectores: p.vectores, creado: p.creado, ...(pendienteDeConfirmar(p.consentimiento) ? { porConfirmar: true } : {}) })),
        honesto: true,
      });
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
      return res.json({ persona: { id: p.id, nombre: p.nombre, relacion: p.relacion, ...(p.parentesco ? { parentesco: p.parentesco } : {}), muestras: p.vectores.length, ...(pendienteDeConfirmar(p.consentimiento) ? { porConfirmar: true } : {}) }, honesto: true });
    } catch (e) {
      if (e instanceof CarasNoDisponibles) return noDisponible(res);
      if (e instanceof CarasNoGuardadas) return noGuardado(res);
      if (e instanceof RangeError) return res.status(409).json({ error: e.message, honesto: true });
      throw e;
    }
  });

  // Aprender con el uso: el id se busca SOLO en el cajón del correo de la sesión (el de otro da 404).
  app.post('/api/caras/:id/muestras', d.exigirMesa, d.limitar(30), async (req, res) => {
    const s = d.sesionDe(req);
    if (!s) return sinSesion(res);
    const v = validarMuestras(req.body || {});
    if (v.ok === false) return res.status(400).json({ error: v.error, honesto: true });
    try {
      const p = await sumarMuestras(s.correo, String(req.params.id || '').slice(0, 40), v.vectores);
      if (!p) return res.status(404).json({ error: 'No conozco esa cara.', honesto: true });
      return res.json({ ok: true, muestras: p.vectores.length, honesto: true });
    } catch (e) {
      if (e instanceof CarasNoDisponibles) return noDisponible(res);
      if (e instanceof CarasNoGuardadas) return noGuardado(res);
      throw e;
    }
  });

  // A-7: la re-confirmación de la dueña, tocando su pantalla (no por voz: el micrófono no sabe quién dijo «sí»).
  app.post('/api/caras/:id/confirmar', d.exigirMesa, d.limitar(30), async (req, res) => {
    const s = d.sesionDe(req);
    if (!s) return sinSesion(res);
    try {
      const p = await confirmarConsentimientoCara(s.correo, String(req.params.id || '').slice(0, 40));
      if (!p) return res.status(404).json({ error: 'No conozco esa cara.', honesto: true });
      return res.json({ ok: true, honesto: true });
    } catch (e) {
      if (e instanceof CarasNoDisponibles) return noDisponible(res);
      if (e instanceof CarasNoGuardadas) return noGuardado(res);
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
      if (e instanceof BorradoDegradado) return borradoDegradado(res, { nombre: (e.resultado as { nombre?: string })?.nombre });
      if (e instanceof CarasNoDisponibles) return noDisponible(res);
      if (e instanceof CarasNoGuardadas) return noGuardado(res);
      throw e;
    }
  });

  app.delete('/api/caras', d.exigirMesa, d.limitar(10), async (req, res) => {
    const s = d.sesionDe(req);
    if (!s) return sinSesion(res);
    try {
      const borradas = await olvidarTodasLasCaras(s.correo);
      return res.json({ ok: true, borradas, honesto: true });
    } catch (e) {
      if (e instanceof BorradoDegradado) return borradoDegradado(res, { borradas: e.resultado });
      if (e instanceof CarasNoGuardadas) return noGuardado(res);
      throw e;
    }
  });
}
