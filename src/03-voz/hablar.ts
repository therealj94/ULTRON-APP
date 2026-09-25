/**
 * HABLAR — la única puerta por la que la web hace sonar a AU-RA.
 *
 *   1. Clip grabado del banco (0 ms, sin red) si la frase es un clip.
 *   2. POST /api/tts con la emoción del turno (ElevenLabs v3 en el servidor).
 *   3. Voz del navegador como último recurso, avisando en consola.
 *
 * Devuelve promesas que resuelven al TERMINAR de sonar, para que la cara sepa cuándo volver a reposo.
 */

import { playFile, playWavBlob, stopVoice, newTtsAbort } from './player';
import { clipDeTexto, clipPorId, type Clip } from './banco';
import { headersMesa } from '../10-infra/sesionCliente';
import type { Emocion } from '../../lib/emocion';

export type Motor = 'clip' | 'servidor' | 'navegador' | 'silencio';

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

function hablarNavegador(texto: string): Dicho {
  let resInicio!: () => void;
  let resFin!: () => void;
  const inicio = new Promise<void>((r) => (resInicio = r));
  const fin = new Promise<void>((r) => (resFin = r));
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
    resInicio();
    resFin();
    return { motor: 'silencio', inicio, fin };
  }
  window.speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(texto);
  u.lang = 'es-MX';
  u.rate = 0.98;
  u.pitch = 1.0;
  const voces = window.speechSynthesis.getVoices();
  const es = voces.find((v) => v.lang.startsWith('es') && /Google|Natural|Microsoft|Paulina|Monica|Sabina/i.test(v.name)) || voces.find((v) => v.lang.startsWith('es'));
  if (es) u.voice = es;
  u.onstart = () => resInicio();
  u.onend = () => resFin();
  u.onerror = () => {
    resInicio();
    resFin();
  };
  console.warn('[voz] servidor sin voz; usando la del navegador');
  window.speechSynthesis.speak(u);
  return { motor: 'navegador', inicio, fin };
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
        const nav = hablarNavegador(t);
        nav.inicio.then(resInicio);
        nav.fin.then(resFin);
      }, () => resInicio());
    })
    .catch((err: any) => {
      if (err?.name === 'AbortError') {
        resInicio();
        resFin();
        return;
      }
      const nav = hablarNavegador(t);
      salida.motor = nav.motor;
      nav.inicio.then(resInicio);
      nav.fin.then(resFin);
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
  if (typeof window !== 'undefined' && 'speechSynthesis' in window) window.speechSynthesis.cancel();
}
