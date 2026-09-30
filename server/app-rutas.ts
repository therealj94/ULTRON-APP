/**
 * LAS RUTAS DE LA APP 5.0 (contrato: mobile/src/nucleo/contrato.ts).
 *
 *   GET  /api/perfil            → { perfil: Perfil | null } (+ lo público de la plataforma, que la web
 *                                  ya leía de esta misma ruta: acento, nombre, modos)
 *   PUT  /api/perfil  Partial<Perfil>  → { perfil }
 *   GET  /api/app/acciones      text/event-stream: cada evento `data: {"id","accion"}`
 *   POST /api/app/contexto      { pantalla, chatAbierto?, contactos, borrador? }
 *
 * Todo con la sesión de la mesa: el perfil, el canal y el contexto son de un CORREO, y el correo sale
 * de la sesión firmada, nunca del cuerpo.
 */
import type express from 'express';
import { actualizarPerfil, leerPerfil, validarCambios } from '../lib/perfil-persona';
import { guardarContexto, oyentesDe, suscribir, validarContexto } from '../lib/acciones-app';
import type { Sesion } from './seguridad';

/** Teléfonos (o pestañas) escuchando a la vez por cuenta. Más que esto es un error o un abuso. */
export const MAX_CANALES_POR_CUENTA = 8;
/** Cada cuánto se manda un latido por el canal (los proxies cortan un stream mudo al minuto). */
export const LATIDO_MS = 20_000;

type Deps = {
  exigirMesa: express.RequestHandler;
  limitar: (max: number, ventanaMs?: number, grupo?: string) => express.RequestHandler;
  sesionDe: (req: express.Request) => Sesion | null;
  tokenDe: (req: express.Request) => string;
  /** Lo público de la plataforma (id, acento, modos…): lo que ya devolvía GET /api/perfil. */
  perfilPlataforma: () => Record<string, unknown>;
  latidoMs?: number;
};

const sinSesion = (res: express.Response) => res.status(401).json({ error: 'Entra con tu sesión.', code: 'sesion_requerida', honesto: true });

export function montarRutasApp(app: express.Express, d: Deps) {
  /*
   * GET /api/perfil era (y sigue siendo, para la web) la ficha pública de la plataforma. Ahora además
   * trae el perfil de la persona si viene con sesión. Un token que no vale es un 401 —el teléfono
   * tiene que saber que debe entrar otra vez—; sin token, la ficha pública con `perfil: null`.
   */
  app.get('/api/perfil', d.limitar(60), async (req, res) => {
    const s = d.sesionDe(req);
    if (!s && d.tokenDe(req)) return sinSesion(res);
    const perfil = s ? await leerPerfil(s.correo) : null;
    res.setHeader('Cache-Control', 'no-store');
    return res.json({ ...d.perfilPlataforma(), perfil, honesto: true });
  });

  app.put('/api/perfil', d.exigirMesa, d.limitar(30), async (req, res) => {
    const s = d.sesionDe(req);
    if (!s) return sinSesion(res);
    const v = validarCambios(req.body);
    if (v.ok === false) return res.status(400).json({ error: v.error, honesto: true });
    const { perfil, durable } = await actualizarPerfil(s.correo, v.cambios, { apodo: s.nombre.split(' ')[0] });
    return res.json({ perfil, durable, honesto: true });
  });

  /**
   * El canal de acciones: la app lo deja abierto y AURA le manda por aquí lo que tiene que hacer. Un
   * canal por teléfono, todos los de una cuenta reciben lo mismo. Latido cada 20 s como comentario SSE
   * (`: latido`), que ningún lector confunde con una acción.
   */
  app.get('/api/app/acciones', d.exigirMesa, d.limitar(30, 60_000, 'app-acciones'), (req, res) => {
    const s = d.sesionDe(req);
    if (!s) return sinSesion(res);
    if (oyentesDe(s.correo) >= MAX_CANALES_POR_CUENTA) {
      return res.status(429).json({ error: 'Hay demasiados teléfonos escuchando con esta cuenta.', honesto: true });
    }
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    req.socket.setNoDelay?.(true);
    req.socket.setTimeout?.(0);
    res.flushHeaders?.();
    const escribir = (t: string) => {
      if (!res.writableEnded && !res.destroyed) res.write(t);
    };
    // Si se corta, el teléfono vuelve a los 3 s (EventSource lo hace solo con `retry`).
    escribir('retry: 3000\n: canal abierto\n\n');
    const soltar = suscribir(s.correo, (e) => {
      if (res.writableEnded || res.destroyed) throw new Error('canal cerrado');
      escribir(`id: ${e.id}\ndata: ${JSON.stringify(e)}\n\n`);
    });
    const latido = setInterval(() => escribir(': latido\n\n'), d.latidoMs ?? LATIDO_MS);
    const cerrar = () => {
      clearInterval(latido);
      soltar();
    };
    res.on('close', cerrar);
    res.on('error', cerrar);
  });

  /** Dónde está la persona y a quién puede escribirle. Se guarda unos minutos, solo en memoria. */
  app.post('/api/app/contexto', d.exigirMesa, d.limitar(120, 60_000, 'app-contexto'), (req, res) => {
    const s = d.sesionDe(req);
    if (!s) return sinSesion(res);
    const v = validarContexto(req.body);
    if (v.ok === false) return res.status(400).json({ error: v.error, honesto: true });
    guardarContexto(s.correo, v.contexto);
    return res.json({ ok: true, contactos: v.contexto.contactos.length, honesto: true });
  });
}
