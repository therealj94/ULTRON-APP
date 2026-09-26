/**
 * HABLAR — la única puerta por la que la web hace sonar a AU-RA.
 *
 *   1. Clip grabado del banco (0 ms, sin red) si la frase es un clip.
 *   2. POST /api/tts con la emoción del turno (Voicebox en el servidor, devuelve WAV).
 *   3. Si el servidor no da voz, silencio: el texto ya está en la burbuja. Nunca la voz robótica
 *      del navegador, que no es AU-RA.
 *
 * Devuelve promesas que resuelven al TERMINAR de sonar (o de inmediato si no sonó nada), para que
 * la cara sepa cuándo volver a reposo y la cola de frases no se quede esperando.
 */

import { playFile, playWavBlob, stopVoice, newTtsAbort } from './player';
import { clipDeTexto, clipPorId, type Clip } from './banco';
import { headersMesa } from '../10-infra/sesionCliente';
import type { Emocion } from '../../lib/emocion';

export type Motor = 'clip' | 'servidor' | 'silencio';

export type Dicho = {
  motor: Motor;
  clip?: Clip;
  /** Se resuelve cuando termina el audio (o de inmediato si no hubo). */
  fin: Promise<void>;
  /** Se resuelve cuando arranca el audio. */
  inicio: Promise<void>;
};

let activo = true;
export function setVozActiva(v: boolean) {
  activo = v;
  if (!v) stopVoice();
}
export function vozActiva() {
  return activo;
}

function reproducirClip(clip: Clip): Dicho {
  let resInicio!: () => void;
  let resFin!: () => void;
  const inicio = new Promise<void>((r) => (resInicio = r));
  const fin = new Promise<void>((r) => (resFin = r));
  playFile(
    clip.file,
    () => resFin(),
    () => {
      resInicio();
      resFin();
    },
    () => resInicio()
  );
  return { motor: 'clip', clip, inicio, fin };
}

/**
 * Di algo. `emocion` viaja al servidor para colorear la voz.
 * Si `soloClip` es true y no hay clip, no hace nada (para reacciones táctiles baratas).
 */
export function hablar(texto: string, opts: { emocion?: Emocion | string; performance?: 'speak' | 'sing'; soloClip?: boolean } = {}): Dicho {
  const t = String(texto || '').trim();
  const nada: Dicho = { motor: 'silencio', inicio: Promise.resolve(), fin: Promise.resolve() };
  if (!t || !activo) return nada;
  const clip = clipDeTexto(t);
  if (clip) return reproducirClip(clip);
  if (opts.soloClip) return nada;

  let resInicio!: () => void;
  let resFin!: () => void;
  const inicio = new Promise<void>((r) => (resInicio = r));
  const fin = new Promise<void>((r) => (resFin = r));
  const ac = newTtsAbort();
  const salida: Dicho = { motor: 'servidor', inicio, fin };

  fetch('/api/tts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headersMesa() },
    body: JSON.stringify({ text: t, emocion: opts.emocion || 'neutral', performance: opts.performance || 'speak' }),
    signal: ac.signal,
  })
    .then(async (r) => {
      const ctype = r.headers.get('content-type') || '';
      if (!r.ok || !ctype.includes('audio')) throw new Error(`tts ${r.status}`);
      const blob = await r.blob();
      if (ac.signal.aborted) throw new DOMException('abort', 'AbortError');
      await playWavBlob(blob, () => resFin(), () => {
        // No se pudo reproducir (o la cortaron): termina sin sonar, para que nada quede esperando.
        if (!ac.signal.aborted) console.warn('[voz] el audio del servidor no se pudo reproducir; queda el texto');
        resInicio();
        resFin();
      }, () => resInicio());
    })
    .catch((err: any) => {
      if (err?.name !== 'AbortError') {
        console.warn('[voz] servidor sin voz; queda el texto', String(err?.message || err));
        salida.motor = 'silencio';
      }
      resInicio();
      resFin();
    });
  return salida;
}

/** Canta del repertorio o una letra libre. Resuelve al terminar. */
export function cantar(opts: { id?: string; pedido?: string; letra?: string; titulo?: string }): Dicho {
  const nada: Dicho = { motor: 'silencio', inicio: Promise.resolve(), fin: Promise.resolve() };
  if (!activo) return nada;
  if (opts.id) {
    const clip = clipPorId(opts.id);
    if (clip) return reproducirClip(clip);
  }
  let resInicio!: () => void;
  let resFin!: () => void;
  const inicio = new Promise<void>((r) => (resInicio = r));
  const fin = new Promise<void>((r) => (resFin = r));
  const ac = newTtsAbort();
  fetch('/api/cantar', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headersMesa() },
    body: JSON.stringify(opts),
    signal: ac.signal,
  })
    .then(async (r) => {
      if (!r.ok || !(r.headers.get('content-type') || '').includes('audio')) throw new Error(`cantar ${r.status}`);
      const blob = await r.blob();
      await playWavBlob(blob, () => resFin(), () => {
        resInicio();
        resFin();
      }, () => resInicio());
    })
    .catch(() => {
      resInicio();
      resFin();
    });
  return { motor: 'servidor', inicio, fin };
}

export function callar() {
  stopVoice();
}
