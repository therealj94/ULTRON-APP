/**
 * Oído: transcribe audio de verdad. Nodo local (ULTRON_STT_URL) si existe, luego ElevenLabs Scribe, Gemini de reserva.
 * Si no hay clave o no se entiende, se dice. No se inventa lo hablado.
 */

import { clave } from './boveda';
import { elevenTranscribe } from '../server/desk';

export type Oido = { texto: string; via: string; detalle: string };

const MAX_BYTES = 8 * 1024 * 1024;

export function esAudioNombre(nombre: string, mime: string) {
  const n = String(nombre || '').toLowerCase();
  const m = String(mime || '').toLowerCase();
  return /^audio\//.test(m) || /\.(ogg|oga|opus|mp3|m4a|wav|webm|aac)$/.test(n);
}

export function mimeDeAudio(nombre: string, mime: string, vozTelegram = false): string {
  const m = String(mime || '').toLowerCase().split(';')[0].trim();
  if (m.startsWith('audio/')) return m;
  const n = String(nombre || '').toLowerCase();
  if (/\.wav$/.test(n)) return 'audio/wav';
  if (/\.webm$/.test(n)) return 'audio/webm';
  if (/\.mp3$/.test(n)) return 'audio/mpeg';
  if (/\.m4a$/.test(n)) return 'audio/mp4';
  if (/\.(ogg|oga|opus)$/.test(n) || vozTelegram) return 'audio/ogg';
  return vozTelegram ? 'audio/ogg' : 'audio/mpeg';
}

async function transcribirGemini(audio: Buffer, mime: string, language: string): Promise<Oido | null> {
  const key = clave('gemini');
  if (!key) return null;
  const model = process.env.GEMINI_STT_MODEL || 'gemini-2.0-flash';
  const r = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(key)}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [
          {
            role: 'user',
            parts: [
              { inline_data: { mime_type: mime || 'audio/ogg', data: audio.toString('base64') } },
              {
                text: `Transcribe el audio a ${language === 'es' ? 'español' : language}. Devuelve SOLO el texto dicho, sin comillas ni explicación. Si no hay voz, responde VACIO.`,
              },
            ],
          },
        ],
      }),
      signal: AbortSignal.timeout(20000),
    }
  );
  const j: any = await r.json().catch(() => ({}));
  const texto = String(j?.candidates?.[0]?.content?.parts?.map((p: any) => p.text).join('') || '').trim();
  if (!texto || /^VACIO$/i.test(texto)) return null;
  return { texto: texto.slice(0, 4000), via: `gemini:${model}`, detalle: `Oí ${texto.length} caracteres.` };
}

/**
 * Oído local (nodo T4): servidor compatible con la API de OpenAI `/v1/audio/transcriptions`
 * (faster-whisper-server, speaches, whisper.cpp server). Sin costo por minuto, latencia baja.
 * Se usa primero si ULTRON_STT_URL está definido; si falla, Scribe.
 */
async function transcribirLocal(audio: Buffer, mime: string, language: string): Promise<Oido | null> {
  const base = (process.env.ULTRON_STT_URL || '').replace(/\/$/, '');
  if (!base) return null;
  const ext = /wav/.test(mime) ? 'wav' : /webm/.test(mime) ? 'webm' : /ogg/.test(mime) ? 'ogg' : /mp3|mpeg/.test(mime) ? 'mp3' : 'm4a';
  const form = new FormData();
  form.append('model', process.env.ULTRON_STT_MODELO || 'Systran/faster-whisper-large-v3');
  form.append('language', language);
  form.append('response_format', 'json');
  form.append('file', new Blob([new Uint8Array(audio)], { type: mime }), `voz.${ext}`);
  const headers: Record<string, string> = {};
  if (process.env.ULTRON_STT_CLAVE) headers.Authorization = `Bearer ${process.env.ULTRON_STT_CLAVE}`;
  try {
    const r = await fetch(`${base}/v1/audio/transcriptions`, { method: 'POST', headers, body: form, signal: AbortSignal.timeout(12000) });
    if (!r.ok) {
      console.warn('[stt local]', r.status, (await r.text()).slice(0, 120));
      return null;
    }
    const j: any = await r.json().catch(() => ({}));
    const texto = String(j.text || '').trim();
    if (texto.length < 2) return null;
    return { texto: texto.slice(0, 4000), via: 'stt-local', detalle: `Oí ${texto.length} caracteres.` };
  } catch (e: any) {
    console.warn('[stt local]', String(e?.message || e).slice(0, 120));
    return null;
  }
}

export async function transcribirAudio(opts: {
  audio: Buffer;
  mime?: string;
  language?: string;
}): Promise<Oido> {
  const buf = opts.audio?.length ? opts.audio : Buffer.alloc(0);
  const mime = String(opts.mime || 'audio/ogg').split(';')[0].trim() || 'audio/ogg';
  const language = (opts.language || 'es').slice(0, 2);
  if (buf.length < 80) {
    return { texto: '', via: 'vacio', detalle: 'Audio vacío. No pude oír nada. Escríbeme.' };
  }
  if (buf.length > MAX_BYTES) {
    return { texto: '', via: 'grande', detalle: `Audio de ${buf.length} bytes. Máximo 8 MB. No lo oí.` };
  }
  const local = await transcribirLocal(buf, mime, language);
  if (local) return local;
  const el = clave('elevenlabs') || process.env.ELEVENLABS_API_KEY || '';
  if (el) {
    const out = await elevenTranscribe({ apiKey: el, audio: buf, mime, language });
    if (out.text) {
      return { texto: out.text.slice(0, 4000), via: `elevenlabs:${out.model}`, detalle: `Oí ${out.text.length} caracteres.` };
    }
  }
  try {
    const gem = await transcribirGemini(buf, mime, language);
    if (gem) return gem;
  } catch (e: any) {
    return {
      texto: '',
      via: 'error',
      detalle: `Oído falló (${String(e?.message || e).slice(0, 120)}). Escríbeme.`,
    };
  }
  const falta = [];
  if (!el) falta.push('ELEVENLABS_API_KEY');
  if (!clave('gemini')) falta.push('GEMINI_API_KEY');
  return {
    texto: '',
    via: el ? 'error' : 'ninguno',
    detalle: el
      ? 'Oí el archivo pero no saqué texto. Escríbeme.'
      : `No pude oír el audio. Falta ${falta.join(' o ')}. Escríbeme.`,
  };
}
