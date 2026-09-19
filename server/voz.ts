/**
 * VOZ — el único camino por el que ULTRON habla.
 *
 *   hablar()  → ElevenLabs v3 (diálogo expresivo, voz oficial) → nodo TTS local → null
 *   cantar()  → clip grabado del repertorio, o ElevenLabs v3 en modo canto (caché en disco)
 *   expresar()→ traduce la emoción del turno a etiquetas de audio que v3 entiende
 *
 * Aquí no hay selector de motor: hay UNA voz y una política. Si ElevenLabs cae,
 * el nodo local responde con la misma frase; si no hay nada, se devuelve null y
 * el cliente usa la voz del navegador (nunca en silencio, nunca fingiendo).
 */

import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { clave } from '../lib/boveda';
import { afinarParaBoca } from './habla';
import { normalizarEmocion, type Emocion } from '../lib/emocion';
import { CANCIONES, VOZ_OFICIAL } from '../lib/capacidades';

export type Performance = 'speak' | 'sing';

export const VOZ_ID = process.env.ELEVENLABS_VOZ || 'hHjbwzYZW17oh0p05AKv'; // Gabriela · español latino

const TTS_LOCAL_URL = (process.env.ULTRON_TTS_URL || process.env.CHATTERBOX_URL || '').replace(/\/$/, '');
const TTS_LOCAL_CLAVE = process.env.ULTRON_TTS_CLAVE || '';

const DIR_CANTO = path.join(process.cwd(), 'data', 'canto');
const DIR_PUBLIC = fs.existsSync(path.join(process.cwd(), 'dist', 'voz'))
  ? path.join(process.cwd(), 'dist', 'voz')
  : path.join(process.cwd(), 'public', 'voz');

/* ---------------- Expresividad ---------------- */

const TAG_EMOCION: Record<Emocion, string> = {
  neutral: '',
  feliz: '[warmly]',
  risa: '[laughs]',
  sorpresa: '[surprised]',
  curioso: '[curious]',
  pensando: '[thoughtful]',
  preocupado: '[concerned]',
  triste: '[sad]',
  molesto: '[annoyed]',
  cansado: '[tired] [sighs]',
  carino: '[softly] [warmly]',
  orgullo: '[proud]',
  travieso: '[mischievously]',
  canto: '[singing]',
};

/**
 * Texto listo para v3: limpia markdown y cifras, y añade las etiquetas de audio.
 * Risas escritas («je je», «jaja») se vuelven risa real. «mmm» se vuelve pausa de pensar.
 * Si el texto ya trae etiquetas (clips guionados), se respeta.
 */
export function expresar(texto: string, emocion: Emocion = 'neutral', performance: Performance = 'speak'): string {
  const base = afinarParaBoca(texto);
  if (!base) return '';
  if (/\[[a-z ]+\]/i.test(texto)) return String(texto).trim();
  let t = base
    .replace(/\b(je\s?){2,}\b\.?/gi, '[laughs] ')
    .replace(/\bje\b\.?/gi, '[chuckles] ')
    .replace(/\b(mmm+|hmm+)\b/gi, '[thoughtful] mmm...')
    .replace(/\bd[eé]jame ver\b/gi, 'déjame ver...')
    .replace(/\bun segundo\b/gi, 'un segundo...')
    .replace(/\s{2,}/g, ' ')
    .trim();
  if (performance === 'sing') return `[singing] ${t}`;
  const tag = TAG_EMOCION[normalizarEmocion(emocion)] || '';
  // Respiración humana: una pausa breve entre frases largas.
  t = t.replace(/([.!?])\s+(?=[A-ZÁÉÍÓÚÑ¿¡])/g, '$1 ');
  return tag ? `${tag} ${t}` : t;
}

/* ---------------- Caché LRU en memoria ---------------- */

type AudioHit = { audio: Buffer; contentType: string; motor: string; at: number };
const cache = new Map<string, AudioHit>();
const CACHE_MAX = 60;
const CACHE_BYTES = 32 * 1024 * 1024;
let cacheBytes = 0;

function cacheGet(key: string): AudioHit | null {
  const hit = cache.get(key);
  if (!hit) return null;
  cache.delete(key);
  cache.set(key, hit);
  return hit;
}

function cacheSet(key: string, hit: Omit<AudioHit, 'at'>) {
  const prev = cache.get(key);
  if (prev) cacheBytes -= prev.audio.length;
  cache.set(key, { ...hit, at: Date.now() });
  cacheBytes += hit.audio.length;
  while (cache.size > CACHE_MAX || cacheBytes > CACHE_BYTES) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    const gone = cache.get(oldest);
    cache.delete(oldest);
    if (gone) cacheBytes -= gone.audio.length;
  }
}

/* ---------------- ElevenLabs v3 ---------------- */

async function elevenDialogo(opts: {
  apiKey: string;
  text: string;
  sing: boolean;
  timeoutMs: number;
}): Promise<{ audio: Buffer; motor: string } | null> {
  for (const model of ['eleven_v3_conversational', 'eleven_v3'] as const) {
    try {
      const r = await fetch('https://api.elevenlabs.io/v1/text-to-dialogue?output_format=mp3_44100_128', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'xi-api-key': opts.apiKey, Accept: 'audio/mpeg' },
        body: JSON.stringify({
          model_id: model,
          // En canto NO se fija idioma: con language_code v3 lee la letra en vez de cantarla.
          language_code: opts.sing ? undefined : 'es',
          inputs: [{ text: opts.text, voice_id: VOZ_ID }],
        }),
        signal: AbortSignal.timeout(opts.timeoutMs),
      });
      if (r.ok) return { audio: Buffer.from(await r.arrayBuffer()), motor: model };
      console.warn('[voz eleven dialogue]', model, r.status, (await r.text()).slice(0, 160));
    } catch (e: any) {
      console.warn('[voz eleven dialogue]', model, String(e?.message || e).slice(0, 120));
    }
  }
  return null;
}

async function elevenClasico(opts: { apiKey: string; text: string; timeoutMs: number }): Promise<{ audio: Buffer; motor: string } | null> {
  try {
    const r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${VOZ_ID}?output_format=mp3_44100_128`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'xi-api-key': opts.apiKey, Accept: 'audio/mpeg' },
      body: JSON.stringify({
        text: opts.text.replace(/\[[a-z ]+\]\s*/gi, ''),
        model_id: 'eleven_multilingual_v2',
        language_code: 'es',
        voice_settings: { stability: 0.3, similarity_boost: 0.8, style: 0.45, use_speaker_boost: true },
      }),
      signal: AbortSignal.timeout(opts.timeoutMs),
    });
    if (r.ok) return { audio: Buffer.from(await r.arrayBuffer()), motor: 'eleven_multilingual_v2' };
    console.warn('[voz eleven tts]', r.status, (await r.text()).slice(0, 160));
  } catch (e: any) {
    console.warn('[voz eleven tts]', String(e?.message || e).slice(0, 120));
  }
  return null;
}

/* ---------------- Nodo TTS local (respaldo) ---------------- */

async function nodoLocal(text: string, timeoutMs = 25000): Promise<{ audio: Buffer; contentType: string; motor: string } | null> {
  if (!TTS_LOCAL_URL) return null;
  const headers: Record<string, string> = { 'Content-Type': 'application/json', Accept: 'audio/wav,audio/mpeg,*/*' };
  if (TTS_LOCAL_CLAVE) headers['x-ultron-tts-clave'] = TTS_LOCAL_CLAVE;
  const limpio = text.replace(/\[[a-z ]+\]\s*/gi, '');
  for (const ruta of ['/decir', '/tts', '/synthesize']) {
    try {
      const r = await fetch(`${TTS_LOCAL_URL}${ruta}`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ texto: limpio, text: limpio, voz: 'calida', idioma: 'es', llave: TTS_LOCAL_CLAVE }),
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!r.ok) continue;
      const buf = Buffer.from(await r.arrayBuffer());
      if (buf.length < 200) continue;
      return { audio: buf, contentType: r.headers.get('content-type') || 'audio/wav', motor: 'tts-local' };
    } catch {
      /* siguiente ruta */
    }
  }
  return null;
}

/* ---------------- API pública ---------------- */

export type Habla = { audio: Buffer; contentType: string; motor: string; cache: boolean; ms: number };

export async function hablar(opts: {
  texto: string;
  emocion?: Emocion | string;
  performance?: Performance;
  sinCache?: boolean;
}): Promise<Habla | null> {
  const t0 = Date.now();
  const performance: Performance = opts.performance === 'sing' ? 'sing' : 'speak';
  const emocion = normalizarEmocion(opts.emocion);
  const guion = expresar(String(opts.texto || '').slice(0, 2400), emocion, performance);
  if (!guion) return null;
  const key = crypto.createHash('sha1').update(`${performance}|${emocion}|${guion}`).digest('hex');
  if (!opts.sinCache) {
    const hit = cacheGet(key);
    if (hit) return { audio: hit.audio, contentType: hit.contentType, motor: hit.motor, cache: true, ms: Date.now() - t0 };
  }
  const apiKey = clave('elevenlabs');
  if (apiKey) {
    const sing = performance === 'sing';
    const out =
      (await elevenDialogo({ apiKey, text: guion, sing, timeoutMs: sing ? 40000 : 18000 })) ||
      (sing ? null : await elevenClasico({ apiKey, text: guion, timeoutMs: 14000 }));
    if (out) {
      cacheSet(key, { audio: out.audio, contentType: 'audio/mpeg', motor: out.motor });
      return { audio: out.audio, contentType: 'audio/mpeg', motor: out.motor, cache: false, ms: Date.now() - t0 };
    }
  }
  const local = await nodoLocal(guion);
  if (local) {
    cacheSet(key, local);
    return { ...local, cache: false, ms: Date.now() - t0 };
  }
  return null;
}

/** Letras cortas que ULTRON canta con su voz. Fragmentos, no la canción entera. */
const LETRAS: Record<string, { titulo: string; letra: string }> = {
  jesus: {
    titulo: 'Quiero conocer a Jesús',
    letra:
      '[softly] Esta es de Generación doce. Ahí voy. [singing] Quiero conocer a Jesús... quiero conocer a Jesús... más que a nadie en este mundo, quiero conocerte a ti. [singing] Quiero conocer a Jesús... [warmly] Esa me llega, de verdad.',
  },
};

export type Cancion = (typeof CANCIONES)[number];

export function repertorio() {
  return CANCIONES.map((c) => ({ ...c }));
}

export function cancionPorPedido(texto: string): Cancion | null {
  const t = String(texto || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
  if (/jesus|generacion 12|generacion doce|conocer a jesus/.test(t)) return CANCIONES[0];
  if (/bohemian|rhapsody|queen|\bcanta\s*1\b/.test(t)) return CANCIONES[1];
  if (/musica ligera|soda|cerati|\bcanta\s*2\b/.test(t)) return CANCIONES[2];
  if (/bitter\s*sweet|sinfonia|the verve|medardo|\bcanta\s*3\b/.test(t)) return CANCIONES[3];
  if (/runaway|kanye|toast|\bcanta\s*4\b/.test(t)) return CANCIONES[4];
  if (/bruno|die with a smile|si el mundo|\bcanta\s*5\b/.test(t)) return CANCIONES[5];
  return null;
}

function clipGrabado(id: string): Buffer | null {
  const ruta = path.join(DIR_PUBLIC, `${id}.mp3`);
  try {
    if (fs.existsSync(ruta)) return fs.readFileSync(ruta);
  } catch {
    /* */
  }
  return null;
}

/**
 * Canta. `id` del repertorio → clip grabado si existe, si no lo genera y lo guarda.
 * `letra` libre → genera (máx 600 caracteres) con caché en disco por hash.
 */
export async function cantar(opts: { id?: string; letra?: string; titulo?: string }): Promise<{ audio: Buffer; contentType: string; motor: string; titulo: string } | null> {
  const id = String(opts.id || '').trim().toLowerCase();
  if (id) {
    const grabado = clipGrabado(id);
    const meta = CANCIONES.find((c) => c.id === id);
    if (grabado) return { audio: grabado, contentType: 'audio/mpeg', motor: 'clip', titulo: meta?.titulo || id };
    const letra = LETRAS[id];
    if (!letra) return null;
    const out = await hablar({ texto: letra.letra, performance: 'sing', emocion: 'canto' });
    if (!out) return null;
    try {
      fs.mkdirSync(DIR_PUBLIC, { recursive: true });
      fs.writeFileSync(path.join(DIR_PUBLIC, `${id}.mp3`), out.audio);
    } catch {
      /* disco de solo lectura: se sirve desde memoria */
    }
    return { audio: out.audio, contentType: out.contentType, motor: out.motor, titulo: letra.titulo };
  }
  const letra = String(opts.letra || '').replace(/\s+/g, ' ').trim().slice(0, 600);
  if (letra.length < 8) return null;
  const hash = crypto.createHash('sha1').update(letra).digest('hex').slice(0, 16);
  const ruta = path.join(DIR_CANTO, `${hash}.mp3`);
  try {
    if (fs.existsSync(ruta)) return { audio: fs.readFileSync(ruta), contentType: 'audio/mpeg', motor: 'clip', titulo: opts.titulo || 'canción' };
  } catch {
    /* */
  }
  const out = await hablar({ texto: `[singing] ${letra}`, performance: 'sing', emocion: 'canto', sinCache: true });
  if (!out) return null;
  try {
    fs.mkdirSync(DIR_CANTO, { recursive: true });
    fs.writeFileSync(ruta, out.audio);
  } catch {
    /* */
  }
  return { audio: out.audio, contentType: out.contentType, motor: out.motor, titulo: opts.titulo || 'canción' };
}

export function estadoVoz() {
  return {
    oficial: VOZ_OFICIAL,
    elevenlabs: !!clave('elevenlabs'),
    ttsLocal: TTS_LOCAL_URL || null,
    voiceId: VOZ_ID,
  };
}

/** Nota de voz para Telegram u otros canales. Misma voz, misma política. */
export async function notaDeVozBuffer(texto: string, emocion: Emocion = 'neutral'): Promise<Buffer | undefined> {
  const dicho = String(texto || '').replace(/\s+/g, ' ').trim().slice(0, 420);
  if (dicho.length < 8) return undefined;
  const out = await hablar({ texto: dicho, emocion });
  return out && out.audio.length > 80 ? out.audio : undefined;
}
