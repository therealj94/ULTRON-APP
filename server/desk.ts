/**
 * Módulo de escritorio nativo (app Android) — voz, oído y personalidad.
 * Solo hechos verificables: nada de doctrinas inventadas.
 */
import { afinarParaBoca } from './habla';

/** UNA sola voz. Chatterbox local = principal. ElevenLabs Rachel = misma persona si el nodo cae. */
export const ULTRON_VOICE = {
  id: 'ultron',
  nombre: 'ULTRON',
  elevenLabsVoiceId: process.env.ELEVENLABS_VOZ || 'hHjbwzYZW17oh0p05AKv', // Gabriela · español México
  chatterboxVoice: process.env.CHATTERBOX_VOICE || 'luna',
};

export function elevenVoiceIdFor(_voice?: string) {
  return ULTRON_VOICE.elevenLabsVoiceId;
}

export async function chatterboxSpeak(opts: {
  baseUrl: string;
  text: string;
  clave?: string;
  timeoutMs?: number;
}): Promise<{ audio: Buffer; contentType: string } | null> {
  const base = opts.baseUrl.replace(/\/$/, '');
  const headers: Record<string, string> = { 'Content-Type': 'application/json', Accept: 'audio/wav,audio/mpeg,*/*' };
  if (opts.clave) headers['x-ultron-tts-clave'] = opts.clave;
  const bodies = [
    { path: '/decir', body: { texto: opts.text, voz: 'calida', idioma: 'es', correo: 'servicio@ordenglobal.org', llave: opts.clave || '' } },
    { path: '/tts', body: { texto: opts.text, voz: 'calida', idioma: 'es', correo: 'servicio@ordenglobal.org', llave: opts.clave || '' } },
  ];
  for (const a of bodies) {
    try {
      const r = await fetch(`${base}${a.path}`, {
        method: 'POST',
        headers,
        body: JSON.stringify(a.body),
        signal: AbortSignal.timeout(opts.timeoutMs || 35000),
      });
      if (!r.ok) continue;
      const buf = Buffer.from(await r.arrayBuffer());
      if (buf.length < 200) continue;
      return { audio: buf, contentType: r.headers.get('content-type') || 'audio/wav' };
    } catch {
      /* siguiente forma de API */
    }
  }
  return null;
}

export const MAIL_ALIASES: Record<string, string> = {
  'mjoseenamorado1994@gmail.com': 'j.ordonez@ordenglobal.org',
  'medardo@ordenglobal.org': 'm.ordonez@ordenglobal.org',
};

export const JUNTA: Record<string, { nombre: string; rol: string }> = {
  'j.ordonez@ordenglobal.org': { nombre: 'José', rol: 'Junta Directiva · Orden Global' },
  'm.ordonez@ordenglobal.org': { nombre: 'Medardo', rol: 'Junta Directiva · Orden Global' },
};

export function normalizarCorreo(correo: unknown): string {
  const raw = String(correo || '').trim().toLowerCase();
  return MAIL_ALIASES[raw] || raw;
}

/** Hechos de Orden Global que constan en los sistemas (repo, servicios, nodos). Sin ficción. */
export const ORDEN_GLOBAL_HECHOS = [
  'Orden Global es la organización de José Ordóñez y Medardo Ordóñez (Junta Directiva); dominio ordenglobal.org; base en Honduras.',
  'GENESIS CORE es el núcleo de Orden Global: el conjunto de nodos y servicios que sostienen sus sistemas (cerebro Qwen, ojo de visión, voz, memoria). ULTRON es la voz y la cara de Genesis Core.',
  'ULTRON FP (Face Presence) es el asistente de escritorio: app nativa Android con cara animada, escucha continua, cámara activa y voz neural. Cerebro Qwen 3.8 27B en nodo AWS (ultron.ordenglobal.link); ojo Playwright/visión en otro nodo; voz ElevenLabs (rápida) o Qwen3-TTS en T4 (local).',
  'Sistemas de Orden Global en operación: ULTRON FP (asistente), Genesis ID (verificación de identidad), Veta Wallet (billetera), tesorería en Polygon (USDT).',
  'Herramientas reales de ULTRON: precio spot de oro y plata (XAU/XAG), tipo de cambio USD/HNL, lectura de páginas web con Playwright, búsqueda en internet (DuckDuckGo) cuando se lo piden, visión por cámara, memoria de corto plazo (últimos turnos) y de largo plazo (hechos guardados).',
  'Principio de la junta: honestidad radical — ULTRON no inventa cifras, recuerdos ni documentos; si no lo vio, lo dice. Sin doctrinas de ficción.',
];

export function buildPersonality(opts: { nombre?: string; hora?: Date; canal?: 'mesa' | 'telegram' }) {
  const nombre = opts.nombre || 'José';
  const h = (opts.hora || new Date()).getHours();
  const momento = h < 6 ? 'madrugada' : h < 12 ? 'mañana' : h < 19 ? 'tarde' : 'noche';
  const canal = opts.canal === 'telegram' ? 'Telegram (texto, junta)' : 'escritorio';
  return [
    `Eres ULTRON, asistente de escritorio de Orden Global. Hablas con ${nombre}, Junta Directiva, por ${canal}. Es de ${momento}.`,
    'IQ EMOCIONAL: clasifica en silencio CALMA|BURLA|CANSADO|ENOJADO|TRISTE|ESTRÉS|EUFORIA|ORDEN. No lo anuncies. Cansado=una sola cosa, lento. Estrés=pasos. Enojo=bajo, no copies el grito. Burla=una pausa y un dardo. Triste=una línea humana. Euforia=rápido, una risa corta escrita como “je”. “Para” = silencio.',
    opts.canal === 'telegram'
      ? 'PERSONALIDAD: leal, vivo, no robot. En Telegram puedes extenderte un poco para trabajo (web, código, sistema). Sin emojis ni asteriscos de adorno.'
      : 'PERSONALIDAD: leal, vivo, no robot. Máximo 2 frases salvo detalle. Sin emojis ni asteriscos. Suenas a alguien al lado, no a call center.',
    'HABLA: español de Centroamérica. Frases cortas. Números SIEMPRE en palabras (cinco mil, no 5000). Si pensás: “mmm”, “déjame ver”, “un segundo”. Risa = “je” o “je je”, nunca jaja escrito. Tonos: explorador=curioso; oro=cálido; minería=seco; analítico=preciso; estratégico=bajo; creativo=juguetón; guardian=firme.',
    'HONESTIDAD: no inventes precios, recuerdos ni documentos. Si no está en HECHOS, dilo.',
    'TALLER: estado del sistema, mantenimiento, pendientes, PDF, código/ejecutor, y envío por Telegram/WhatsApp/correo/llamada. Si HECHOS dice que falta clave, no finjas el envío. Telegram inbound es privado: solo el chat de la junta.',
    'Cantar: clips grabados. 1 Bohemian, 2 Música ligera, 3 Medardo Bittersweet, 4 José Runaway. No inventes letra.',
    'MEMORIA: LARGO PLAZO = lo que la junta pidió guardar. ULTIMOS TURNOS = hilo de ahora. No saludes otra vez.',
    'Si HECHOS trae BÚSQUEDA WEB, cita la fuente. Preguntas de Orden Global = solo lo que consta abajo.',
    `ORDEN GLOBAL (lo que consta):\n- ${ORDEN_GLOBAL_HECHOS.join('\n- ')}`,
  ].join('\n');
}

/* ---------------- Caché LRU de audio ---------------- */

type AudioHit = { audio: Buffer; contentType: string; at: number };
const audioCache = new Map<string, AudioHit>();
const AUDIO_CACHE_MAX = 40;
const AUDIO_CACHE_BYTES = 24 * 1024 * 1024;
let audioCacheBytes = 0;

export function getCachedAudio(key: string): AudioHit | null {
  const hit = audioCache.get(key);
  if (!hit) return null;
  audioCache.delete(key);
  audioCache.set(key, hit);
  return hit;
}

export function setCachedAudio(key: string, audio: Buffer, contentType: string) {
  const prev = audioCache.get(key);
  if (prev) audioCacheBytes -= prev.audio.length;
  audioCache.set(key, { audio, contentType, at: Date.now() });
  audioCacheBytes += audio.length;
  while (audioCache.size > AUDIO_CACHE_MAX || audioCacheBytes > AUDIO_CACHE_BYTES) {
    const oldest = audioCache.keys().next().value;
    if (oldest === undefined) break;
    const gone = audioCache.get(oldest);
    audioCache.delete(oldest);
    if (gone) audioCacheBytes -= gone.audio.length;
  }
}

/* ---------------- ElevenLabs TTS ---------------- */

export function limpiarParaVoz(text: string) {
  return afinarParaBoca(text);
}

export async function elevenSpeak(opts: {
  apiKey: string;
  text: string;
  performance: 'speak' | 'sing';
  timeoutMs?: number;
  voiceId?: string;
}): Promise<{ audio: Buffer; model: string } | null> {
  if (!opts.apiKey) return null;
  const voiceId = opts.voiceId || ULTRON_VOICE.elevenLabsVoiceId;
  const sing = opts.performance === 'sing';
  const spoken = /\[/.test(opts.text) ? opts.text : sing ? `[singing] ${opts.text}` : opts.text;
  for (const model of ['eleven_v3_conversational', 'eleven_v3'] as const) {
    try {
      const r = await fetch(`https://api.elevenlabs.io/v1/text-to-dialogue?output_format=mp3_44100_128`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'xi-api-key': opts.apiKey, Accept: 'audio/mpeg' },
        body: JSON.stringify({
          model_id: model,
          language_code: sing ? undefined : 'es',
          inputs: [{ text: spoken, voice_id: voiceId }],
        }),
        signal: AbortSignal.timeout(opts.timeoutMs || (sing ? 28000 : 18000)),
      });
      if (r.ok) return { audio: Buffer.from(await r.arrayBuffer()), model };
      console.warn('[tts eleven dialogue]', model, r.status, (await r.text()).slice(0, 180));
    } catch (e: any) {
      console.warn('[tts eleven dialogue]', model, String(e?.message || e).slice(0, 120));
    }
  }
  const attempts: Array<{ model: string; settings: Record<string, unknown>; timeout: number }> = [
    { model: 'eleven_v3', settings: { stability: 0.32, similarity_boost: 0.8 }, timeout: sing ? 24000 : 16000 },
    {
      model: 'eleven_multilingual_v2',
      settings: { stability: 0.26, similarity_boost: 0.8, style: 0.52, speed: 0.98, use_speaker_boost: true },
      timeout: 16000,
    },
  ];
  for (const a of attempts) {
    try {
      const r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=mp3_44100_128`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'xi-api-key': opts.apiKey, Accept: 'audio/mpeg' },
        body: JSON.stringify({
          text: opts.text,
          model_id: a.model,
          language_code: 'es',
          apply_text_normalization: 'on',
          voice_settings: a.settings,
        }),
        signal: AbortSignal.timeout(a.timeout),
      });
      if (r.ok) return { audio: Buffer.from(await r.arrayBuffer()), model: a.model };
      console.warn('[tts eleven]', a.model, r.status, (await r.text()).slice(0, 160));
    } catch (e: any) {
      console.warn('[tts eleven]', a.model, String(e?.message || e).slice(0, 120));
    }
  }
  return null;
}

/* ---------------- ElevenLabs STT (Scribe) ---------------- */

const STT_BASURA = /^(subt[ií]tulos.*|gracias por ver.*|suscr[ií]bete.*|\.+|…|music|\[.*\]|\(.*\))$/i;

export async function elevenTranscribe(opts: {
  apiKey: string;
  audio: Buffer;
  mime: string;
  language?: string;
}): Promise<{ text: string; model: string }> {
  if (!opts.apiKey) return { text: '', model: 'sin-clave' };
  const ext = /wav/.test(opts.mime) ? 'wav' : /webm/.test(opts.mime) ? 'webm' : /ogg/.test(opts.mime) ? 'ogg' : 'm4a';
  for (const model of ['scribe_v2', 'scribe_v1']) {
    try {
      const form = new FormData();
      form.append('model_id', model);
      form.append('language_code', (opts.language || 'es').slice(0, 2));
      form.append('tag_audio_events', 'false');
      form.append('file', new Blob([new Uint8Array(opts.audio)], { type: opts.mime }), `voz.${ext}`);
      const r = await fetch('https://api.elevenlabs.io/v1/speech-to-text', {
        method: 'POST',
        headers: { 'xi-api-key': opts.apiKey },
        body: form,
        signal: AbortSignal.timeout(14000),
      });
      if (r.ok) {
        const j: any = await r.json().catch(() => ({}));
        let text = String(j.text || j.transcript || '').trim();
        if (text.length < 2 || STT_BASURA.test(text)) text = '';
        return { text, model };
      }
      const err = await r.text();
      console.warn('[stt eleven]', model, r.status, err.slice(0, 160));
      // 4xx por modelo desconocido → probar el siguiente; otros errores → cortar
      if (r.status !== 400 && r.status !== 404 && r.status !== 422) break;
    } catch (e: any) {
      console.warn('[stt eleven]', model, String(e?.message || e).slice(0, 120));
    }
  }
  return { text: '', model: 'error' };
}

export function decodeDataUrl(input: string, fallbackMime: string) {
  const m = String(input || '').match(/^data:([^;]+);base64,(.*)$/);
  return { mime: m ? m[1] : fallbackMime, buffer: Buffer.from(m ? m[2] : input, 'base64') };
}

export { buscarWeb, leerPagina, consultaWeb } from '../src/06-manos/web';
export type { WebHit } from '../src/06-manos/web';

/* ---------------- Investigación web: vive en src/06-manos/web.ts ---------------- */

