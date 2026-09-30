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
};

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
  app.get('/api/windows/salud', d.limitar(30), (_req, res) => {
    res.json({ laya: estadoLaya(), honesto: true });
  });
}
