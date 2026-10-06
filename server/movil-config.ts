/**
 * INTERRUPTORES REMOTOS DE LA APP (sin secretos): GET /api/movil/config (sesión de mesa).
 *
 * Tres, para lo nativo nuevo de la app y las muletillas. Si en algún teléfono da problemas, se apaga para todos sin
 * sacar otra APK:
 *
 *  · La cámara en vivo (mobile/modules/aura-camara, components/CamaraVivo.tsx):
 *   AURA_CAMARA_RAPIDA=0            → la app vuelve a la cámara de fotos (CamaraVision) al momento.
 *   AURA_CAMARA_RAPIDA_LADO=720     → el lado corto del análisis (480 por omisión; 240..1080).
 *   AURA_CAMARA_RAPIDA_HZ / _FPS    → eventos por segundo a JS / cuadros analizados por segundo (1..30).
 *  · La voz en streaming (mobile/modules/aura-voz, /api/tts/pcm; docs/adr/ADR-voz-en-streaming.md):
 *   AURA_VOZ_STREAM=0               → cada frase vuelve a bajarse entera y a sonar con expo-av (lo de antes).
 *
 *  · Las muletillas de la mesa de voz («mjm», «ajá» mientras la persona habla largo; mobile/src/lib/asentir.ts y
 *    docs/adr/ADR-muletillas.md). Encendidas por omisión donde el teléfono puede (Android con cancelación de eco):
 *   AURA_ASENTIR=0                  → no suena ninguna y el micrófono de escucha vuelve a la fuente de dictado sin el
 *                                     cancelador de eco (lo de antes). El teléfono lo lee al entrar a la mesa y cada
 *                                     10 min (mobile/src/lib/muletillasAjuste.ts).
 *
 * El teléfono guarda lo último que leyó (lib/guardiaCamara.ts, lib/guardiaVoz.ts, lib/muletillasAjuste.ts): sin red,
 * vale lo guardado. Un servidor viejo sin esta ruta (404) deja lo de fábrica.
 */
import type express from 'express';

export type ConfigMovil = {
  camaraRapida: { activa: boolean; ladoCorto?: number; hz?: number; fps?: number };
  vozStream: { activa: boolean };
  asentir: { activo: boolean };
};

function entero(v: string | undefined, min: number, max: number): number | undefined {
  if (v === undefined || v.trim() === '') return undefined;
  const n = Number(v);
  return Number.isInteger(n) && n >= min && n <= max ? n : undefined;
}

/** «0», «no», «false», «off», «apagada»: apagado. Cualquier otra cosa (o nada): encendido. */
const apagado = (v: string | undefined) => /^(0|no|false|off|apagada|apagado)$/i.test(String(v ?? '').trim());

export function configMovil(env: NodeJS.ProcessEnv = process.env): ConfigMovil {
  const apagada = apagado(env.AURA_CAMARA_RAPIDA);
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
    vozStream: { activa: !apagado(env.AURA_VOZ_STREAM) },
    asentir: { activo: !apagado(env.AURA_ASENTIR) },
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
