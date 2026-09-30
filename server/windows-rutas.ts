/**
 * AURA PARA WINDOWS (el .exe de windows/): lo que el escritorio necesita del servidor además de lo de
 * siempre. Cerebro, voz y oído son los MISMOS de la app (/api/turno/stream, /api/tts, /api/stt): aquí
 * solo va lo propio de Windows.
 *
 *   POST /api/windows/intencion  { texto }  → { etiqueta, p, seguro, umbral, ms, motivo }
 *        Qué mano de Windows pidió la persona, según Laya «windows» en el nodo T4
 *        (scripts/nodo-t4/laya/modelos/windows). Si Laya no está, tarda o falla: etiqueta null y el
 *        .exe sigue con su Laya ligera y sus reglas, o se lo pasa al cerebro.
 *   GET  /api/windows/salud                 → { laya: { configurado, ... } }
 *   GET  /api/windows/conexiones            → { spotify, google, microsoft } (Client ID de cada servicio)
 *        Los Client ID con los que el .exe abre el inicio de sesión (OAuth con PKCE, en el navegador de
 *        la persona) de Spotify, Google (Gmail, Calendar, YouTube) y Microsoft (Outlook). Se ponen UNA
 *        vez en Render: SPOTIFY_CLIENT_ID, GOOGLE_DESKTOP_CLIENT_ID + GOOGLE_DESKTOP_CLIENT_SECRET (el
 *        de una app «de escritorio», que Google mismo dice que no es secreto) y MICROSOFT_CLIENT_ID. Los
 *        tokens de cada persona NUNCA pasan por aquí: se quedan cifrados en su PC.
 *
 * Con sesión de la mesa (o la clave de mesa): la GPU del nodo no se regala a cualquiera que dé con la
 * URL. El cupo va ANTES de la sesión: los intentos sin sesión también gastan cupo. El texto no se guarda ni se escribe en el log.
 */
import type express from 'express';
import { consultarModelo, estadoLaya } from '../lib/laya';

type Deps = {
  exigirMesa: express.RequestHandler;
  limitar: (max: number, ventanaMs?: number, grupo?: string) => express.RequestHandler;
  consultar?: typeof consultarModelo;
  entorno?: Record<string, string | undefined>;
};

const limpio = (v: string | undefined) => {
  const t = String(v ?? '').trim();
  return /^[A-Za-z0-9._\-]{8,200}$/.test(t) ? t : null;
};

/** Solo lo que está puesto y bien formado; lo que falta sale null (el .exe dice qué falta). */
export function clientesOauth(env: Record<string, string | undefined>) {
  const google = limpio(env.GOOGLE_DESKTOP_CLIENT_ID);
  return {
    spotify: limpio(env.SPOTIFY_CLIENT_ID) ? { clientId: limpio(env.SPOTIFY_CLIENT_ID) } : null,
    google: google ? { clientId: google, clientSecret: limpio(env.GOOGLE_DESKTOP_CLIENT_SECRET) } : null,
    microsoft: limpio(env.MICROSOFT_CLIENT_ID) ? { clientId: limpio(env.MICROSOFT_CLIENT_ID) } : null,
  };
}

/** Por debajo de esto el .exe no ejecuta nada por Laya del nodo: se lo pasa al cerebro. */
export const UMBRAL_WINDOWS = 0.6;

export function montarRutasWindows(app: express.Express, d: Deps) {
  const consultar = d.consultar ?? consultarModelo;
  app.post('/api/windows/intencion', d.limitar(120), d.exigirMesa, async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const texto = typeof req.body?.texto === 'string' ? req.body.texto.trim() : '';
    if (!texto || texto.length > 4000) return res.status(400).json({ error: 'texto vacío o demasiado largo', honesto: true });
    const { resultado, motivo, ms } = await consultar('windows', texto, { esperaMs: 900 });
    const etiqueta = resultado?.grupos?.win ?? null;
    const p = etiqueta ? Number(resultado!.p[etiqueta] ?? 0) : 0;
    const umbral = Math.max(UMBRAL_WINDOWS, Number(resultado?.umbrales?.[etiqueta ?? ''] ?? 0));
    return res.json({ etiqueta, p, seguro: !!etiqueta && etiqueta !== 'win_ninguna' && p >= umbral, umbral, ms, motivo, honesto: true });
  });
  app.get('/api/windows/conexiones', d.limitar(30), d.exigirMesa, (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json({ ...clientesOauth(d.entorno ?? process.env), honesto: true });
  });
  app.get('/api/windows/salud', d.limitar(30), (_req, res) => {
    res.json({ laya: estadoLaya(), honesto: true });
  });
}
