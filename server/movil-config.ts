/**
 * INTERRUPTORES REMOTOS DE LA APP (sin secretos): GET /api/movil/config (sesión de mesa).
 *
 * Dos, para lo nativo nuevo de la app. Si en algún teléfono da problemas, se apaga para todos sin sacar otra APK:
 *
 *  · La cámara en vivo (mobile/modules/aura-camara, components/CamaraVivo.tsx):
 *   AURA_CAMARA_RAPIDA=0            → la app vuelve a la cámara de fotos (CamaraVision) al momento.
 *   AURA_CAMARA_RAPIDA_LADO=720     → el lado corto del análisis (480 por omisión; 240..1080).
 *   AURA_CAMARA_RAPIDA_HZ / _FPS    → eventos por segundo a JS / cuadros analizados por segundo (1..30).
 *  · La voz en streaming (mobile/modules/aura-voz, /api/tts/pcm; docs/adr/ADR-voz-en-streaming.md):
 *   AURA_VOZ_STREAM=0               → cada frase vuelve a bajarse entera y a sonar con expo-av (lo de antes).
 *
 * El teléfono guarda lo último que leyó (lib/guardiaCamara.ts, lib/guardiaVoz.ts): sin red, vale lo guardado. Un
 * servidor viejo sin esta ruta (404) deja las dos encendidas, que es lo de fábrica.
 */
import type express from 'express';

export type ConfigMovil = { camaraRapida: { activa: boolean; ladoCorto?: number; hz?: number; fps?: number }; vozStream: { activa: boolean } };

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
