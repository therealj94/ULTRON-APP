/**
 * HABLAR — la única puerta por la que la web hace sonar a AU-RA.
 *
 *   1. Clip grabado del banco (0 ms, sin red) si la frase es un clip.
 *   2. POST /api/tts con la emoción del turno y las frases vecinas (ElevenLabs o Voicebox en el servidor).
 *   3. Si el servidor no da voz, silencio: el texto ya está en la burbuja. Nunca la voz robótica
 *      del navegador, que no es AU-RA.
 *
 * Devuelve promesas que resuelven al TERMINAR de sonar (o de inmediato si no sonó nada), para que
 * la cara sepa cuándo volver a reposo y la cola de frases no se quede esperando.
 */

import { playFile, playMp3EnVivo, playWavBlob, soportaAudioEnVivo, stopVoice, newTtsAbort } from './player';
import { cancionDeTexto, clipDeTexto, clipPorId, type Clip } from './banco';
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
      // Un clip nuevo que este despliegue no trae: suena el de siempre en su lugar.
      const respaldo = clip.respaldo ? clipPorId(clip.respaldo) : null;
      if (respaldo) {
        const otro = reproducirClip(respaldo);
        void otro.inicio.then(resInicio);
        void otro.fin.then(resFin);
        return;
      }
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
/**
 * Lo dicho justo antes y lo que viene en el mismo turno: la cola habla frase a frase y, sin esto,
 * ElevenLabs entonaba cada una como si empezara a hablar. El servidor los pasa como previous_text /
 * next_text (como la voz de Dr Electrum). Un clip del banco no es texto que enlazar.
 */
export type Vecinos = { previo?: string; siguiente?: string };

function vecinos(o: Vecinos): Vecinos {
  const v = (t?: string) => {
    const x = String(t || '').trim();
    return x && !clipDeTexto(x) ? x : undefined;
  };
  return { previo: v(o.previo), siguiente: v(o.siguiente) };
}

export function hablar(texto: string, opts: { emocion?: Emocion | string; performance?: 'speak' | 'sing'; soloClip?: boolean } & Vecinos = {}): Dicho {
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
  const emocion = opts.emocion || 'neutral';
  const performance = opts.performance || 'speak';
  const contexto = vecinos(opts);

  // Si la cola ya la había pedido (precargar), se usa ese audio: llega listo mientras sonaba la anterior.
  const clave = claveAudio(t, emocion, performance);
  const ya = precargas.get(clave);
  if (ya) precargas.delete(clave);

  // Sin precarga (la primera frase del turno): en vivo, suena con el primer pedazo que llega.
  if (!ya && performance === 'speak' && soportaAudioEnVivo()) {
    fetch('/api/tts/stream', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headersMesa() },
      body: JSON.stringify({ text: t, emocion, performance, ...contexto }),
      signal: ac.signal,
    })
      .then(async (r) => {
        const ctype = r.headers.get('content-type') || '';
        if (!r.ok || !ctype.includes('audio')) throw new Error(`tts ${r.status}`);
        const terminar = () => {
          resInicio();
          resFin();
        };
        if (r.headers.get('x-ultron-vivo') === '1' && r.body && ctype.includes('mpeg')) {
          playMp3EnVivo(r.body.getReader(), () => resFin(), () => {
            if (!ac.signal.aborted) console.warn('[voz] la voz en vivo no se pudo tocar; queda el texto');
            terminar();
          }, () => resInicio());
          return;
        }
        // De la caché o de Voicebox: entero, como siempre.
        const blob = await r.blob();
        if (ac.signal.aborted) throw new DOMException('abort', 'AbortError');
        await playWavBlob(blob, () => resFin(), terminar, () => resInicio());
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
  const audio = ya ? ya.blob.then((b) => b || pedirAudio(t, emocion, performance, contexto, ac.signal)) : pedirAudio(t, emocion, performance, contexto, ac.signal);
  // Callar también corta lo que se estaba precargando para esta frase.
  ac.signal.addEventListener('abort', () => ya?.ac.abort(), { once: true });

  audio
    .then(async (blob) => {
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
  // Del repertorio grabado aquí, sin ir al servidor: por id o por el pedido («cantame la de cuna»).
  const clip = opts.id ? clipPorId(opts.id) : opts.pedido ? cancionDeTexto(opts.pedido) : null;
  if (clip) return reproducirClip(clip);
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
  for (const p of precargas.values()) p.ac.abort();
  precargas.clear();
}

/* ── la frase siguiente, pedida mientras suena la actual ─────────────────────────────────────────── */

/**
 * Antes, la cola pedía cada frase solo al terminar la anterior: entre frase y frase se oía el silencio de
 * sintetizar y descargar (diagnóstico de voz, 1-oct, H4). Ahora la siguiente se pide mientras suena la
 * actual. Como mucho MAX_PRECARGAS adelantadas, para no gastar voz en frases que una interrupción tira.
 */
const MAX_PRECARGAS = 2;
const precargas = new Map<string, { blob: Promise<Blob | null>; ac: AbortController }>();

function claveAudio(t: string, emocion: string, performance: string) {
  return `${performance}|${emocion}|${t}`;
}

async function pedirAudio(t: string, emocion: string, performance: string, contexto: Vecinos, signal: AbortSignal): Promise<Blob> {
  const r = await fetch('/api/tts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headersMesa() },
    body: JSON.stringify({ text: t, emocion, performance, ...contexto }),
    signal,
  });
  const ctype = r.headers.get('content-type') || '';
  if (!r.ok || !ctype.includes('audio')) throw new Error(`tts ${r.status}`);
  return r.blob();
}

/** Pide ya el audio de una frase que va a sonar después (los clips del banco no hacen falta). */
export function precargar(texto: string, opts: { emocion?: Emocion | string; performance?: 'speak' | 'sing' } & Vecinos = {}) {
  const t = String(texto || '').trim();
  if (!t || !activo || clipDeTexto(t)) return;
  const clave = claveAudio(t, opts.emocion || 'neutral', opts.performance || 'speak');
  if (precargas.has(clave) || precargas.size >= MAX_PRECARGAS) return;
  const ac = new AbortController();
  precargas.set(clave, { ac, blob: pedirAudio(t, opts.emocion || 'neutral', opts.performance || 'speak', vecinos(opts), ac.signal).catch(() => null) });
}
