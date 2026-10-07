/**
 * LAS RUTAS DE SUS RECORDATORIOS (lib/recordatorios-servidor.ts; auditoría del 7-oct, A-3).
 *
 *   GET    /api/recordatorios                 → { recordatorios, borrados }      (los suyos, con la próxima vez)
 *   POST   /api/recordatorios                 {texto, cuando, repetir?, llamada?, id?, local?} → { recordatorio, nuevo }
 *   PATCH  /api/recordatorios/:id             {texto?, cuando?, repetir?, llamada?}             → { recordatorio }
 *   DELETE /api/recordatorios/:id                                                               → { borrado }
 *   POST   /api/recordatorios/:id/hecho                                                         → { recordatorio }
 *
 * La persona sale SIEMPRE de la sesión firmada (sesionDe), nunca del cuerpo ni de la ruta: nadie lista, cambia ni borra
 * los recordatorios de otra cuenta (un id ajeno es «no está»). `cuando`: epoch ms o «AAAA-MM-DDTHH:MM» en hora de
 * Honduras. `repetir`: «diario», «laborables», {tipo:'semanal', dia:'lunes'} o {tipo:'mensual', dia:15}. `durable` dice
 * si llegó a S3: sin eso, se dice (honesto), no se da por guardado para siempre.
 */
import type express from 'express';
import { exigirMesa as exigirMesaSeguridad, limitar as limitarSeguridad, sesionDe as sesionDeSeguridad } from './seguridad';
import {
  borrarRecordatorioServidor,
  crearRecordatorioServidor,
  editarRecordatorioServidor,
  ErrorRecordatorio,
  listarRecordatoriosServidor,
  marcarHechoServidor,
  RecordatoriosNoDisponibles,
} from '../lib/recordatorios-servidor';

export type DepsRecordatorios = {
  exigirMesa: express.RequestHandler;
  limitar: (max: number, ventanaMs?: number, grupo?: string) => express.RequestHandler;
  sesionDe: (req: express.Request) => { correo: string } | null;
  ahora?: () => number;
};

const sinSesion = (res: express.Response) => res.status(401).json({ error: 'Entra con tu sesión.', code: 'sesion_requerida', honesto: true });

function fallo(res: express.Response, e: unknown) {
  if (e instanceof RecordatoriosNoDisponibles) return res.status(503).json({ error: 'Ahora mismo no pude leer tus recordatorios; no cambié nada. Prueba en un momento.', code: 'recordatorios_no_disponibles', honesto: true });
  if (e instanceof ErrorRecordatorio) return res.status(e.codigo === 'no_esta' ? 404 : e.codigo === 'lleno' ? 409 : 400).json({ error: e.message, code: e.codigo, honesto: true });
  console.warn('[recordatorios] ruta', String((e as Error)?.message || e).slice(0, 120));
  return res.status(500).json({ error: 'No pude con tus recordatorios ahora.', honesto: true });
}

export function montarRutasRecordatorios(app: express.Express, deps: Partial<DepsRecordatorios> = {}) {
  const d: DepsRecordatorios = {
    exigirMesa: deps.exigirMesa || exigirMesaSeguridad,
    limitar: deps.limitar || limitarSeguridad,
    sesionDe: deps.sesionDe || sesionDeSeguridad,
    ahora: deps.ahora || Date.now,
  };
  const correoDe = (req: express.Request) => String(d.sesionDe(req)?.correo || '').trim().toLowerCase();
  const ahora = () => d.ahora!();

  app.get('/api/recordatorios', d.exigirMesa, d.limitar(60, 60_000, 'recordatorios'), async (req, res) => {
    const correo = correoDe(req);
    if (!correo) return sinSesion(res);
    try {
      res.setHeader('Cache-Control', 'no-store');
      const r = await listarRecordatoriosServidor(correo, ahora());
      return res.json({ ...r, ahora: ahora(), honesto: true });
    } catch (e) {
      return fallo(res, e);
    }
  });

  app.post('/api/recordatorios', d.exigirMesa, d.limitar(30, 60_000, 'recordatorios-cambiar'), async (req, res) => {
    const correo = correoDe(req);
    if (!correo) return sinSesion(res);
    const b = (req.body || {}) as Record<string, unknown>;
    try {
      const r = await crearRecordatorioServidor(correo, { texto: b.texto, cuando: b.cuando, repetir: b.repetir, llamada: b.llamada, id: b.id, local: b.local }, ahora());
      return res.status(r.nuevo ? 201 : 200).json({ ...r, honesto: true });
    } catch (e) {
      return fallo(res, e);
    }
  });

  app.patch('/api/recordatorios/:id', d.exigirMesa, d.limitar(30, 60_000, 'recordatorios-cambiar'), async (req, res) => {
    const correo = correoDe(req);
    if (!correo) return sinSesion(res);
    const b = (req.body || {}) as Record<string, unknown>;
    const cambios = Object.fromEntries(['texto', 'cuando', 'repetir', 'llamada'].filter((k) => b[k] !== undefined).map((k) => [k, b[k]]));
    try {
      const r = await editarRecordatorioServidor(correo, String(req.params.id || ''), cambios, ahora());
      return res.json({ ...r, honesto: true });
    } catch (e) {
      return fallo(res, e);
    }
  });

  app.delete('/api/recordatorios/:id', d.exigirMesa, d.limitar(30, 60_000, 'recordatorios-cambiar'), async (req, res) => {
    const correo = correoDe(req);
    if (!correo) return sinSesion(res);
    try {
      const r = await borrarRecordatorioServidor(correo, String(req.params.id || ''), ahora());
      if (!r.borrado) return res.status(404).json({ error: 'No encuentro ese recordatorio.', code: 'no_esta', honesto: true });
      return res.json({ ok: true, ...r, honesto: true });
    } catch (e) {
      return fallo(res, e);
    }
  });

  app.post('/api/recordatorios/:id/hecho', d.exigirMesa, d.limitar(30, 60_000, 'recordatorios-cambiar'), async (req, res) => {
    const correo = correoDe(req);
    if (!correo) return sinSesion(res);
    try {
      const r = await marcarHechoServidor(correo, String(req.params.id || ''), ahora());
      return res.json({ ok: true, ...r, honesto: true });
    } catch (e) {
      return fallo(res, e);
    }
  });
}
