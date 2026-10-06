/**
 * INTERRUPTORES REMOTOS DE LA APP (sin secretos): GET /api/movil/config (sesión de mesa).
 *
 * La cámara en vivo del teléfono (mobile/modules/aura-camara, components/CamaraVivo.tsx). Si en algún teléfono da
 * problemas, se apaga para todos sin sacar otra APK:
 *
 *   AURA_CAMARA_RAPIDA=0            → la app vuelve a la cámara de fotos (CamaraVision) al momento.
 *   AURA_CAMARA_RAPIDA_LADO=720     → el lado corto del análisis (480 por omisión; 240..1080).
 *   AURA_CAMARA_RAPIDA_HZ / _FPS    → eventos por segundo a JS / cuadros analizados por segundo (1..30).
 *
 * Las muletillas de la mesa de voz («mjm», «ajá» mientras la persona habla largo; mobile/src/lib/asentir.ts y
 * docs/adr/ADR-muletillas.md). Encendidas por omisión donde el teléfono puede (Android con cancelación de eco):
 *
 *   AURA_ASENTIR=0                  → no suena ninguna y el micrófono de escucha vuelve a la fuente de dictado sin el
 *                                     cancelador de eco (lo de antes). El teléfono lo lee al entrar a la mesa y cada
 *                                     10 min (mobile/src/lib/muletillasAjuste.ts).
 *
 * El teléfono guarda lo último que leyó (lib/guardiaCamara.ts, lib/muletillasAjuste.ts): sin red, vale lo guardado.
 * Un servidor viejo sin esta ruta (404) deja lo de fábrica.
 */
import type express from 'express';

export type ConfigMovil = {
  camaraRapida: { activa: boolean; ladoCorto?: number; hz?: number; fps?: number };
  asentir: { activo: boolean };
};

function entero(v: string | undefined, min: number, max: number): number | undefined {
  if (v === undefined || v.trim() === '') return undefined;
  const n = Number(v);
  return Number.isInteger(n) && n >= min && n <= max ? n : undefined;
}

const APAGADO = /^(0|no|false|off|apagada|apagado)$/i;

export function configMovil(env: NodeJS.ProcessEnv = process.env): ConfigMovil {
  const apagada = APAGADO.test(String(env.AURA_CAMARA_RAPIDA ?? '').trim());
  const ladoCorto = entero(env.AURA_CAMARA_RAPIDA_LADO, 240, 1080);
  const hz = entero(env.AURA_CAMARA_RAPIDA_HZ, 1, 30);
  const fps = entero(env.AURA_CAMARA_RAPIDA_FPS, 1, 30);
  return {
    camaraRapida: {
      activa: !apagada,
      ...(ladoCorto ? { ladoCorto } : {}),
      ...(hz ? { hz } : {}),
      ...(fps ? { fps } : {}),
    },
    asentir: { activo: !APAGADO.test(String(env.AURA_ASENTIR ?? '').trim()) },
  };
}

export function montarConfigMovil(
  app: express.Express,
  d: { exigirMesa: express.RequestHandler; limitar: (max: number, ventanaMs?: number, grupo?: string) => express.RequestHandler; env?: NodeJS.ProcessEnv }
) {
  app.get('/api/movil/config', d.exigirMesa, d.limitar(30), (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json({ ...configMovil(d.env ?? process.env), honesto: true });
  });
}
