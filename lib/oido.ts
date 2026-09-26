/**
 * Oído: transcribe audio de verdad. Nodo local (ULTRON_STT_URL) si existe, luego ElevenLabs Scribe, Gemini de reserva.
 * Si no hay clave o no se entiende, se dice. No se inventa lo hablado.
 */

import { clave } from './boveda';
import { elevenTranscribe } from '../server/desk';
import { presupuesto, type Presupuesto } from './presupuesto';

export type Oido = { texto: string; via: string; detalle: string };

/**
 * Lo que contesta un proveedor. `null`: no está configurado o se cayó, que pruebe el siguiente.
 * Un `texto` vacío es que contestó bien y no había voz: eso ES una respuesta. Antes se trataba
 * igual que un fallo y el mismo silencio se le mandaba a Scribe v2, a Scribe v1 y a Gemini — tres
 * facturas por un bolsillo que rozó el micrófono.
 */
export type Escucha = { texto: string; via: string } | null;

export type ProveedorOido = {
  nombre: string;
  /** ¿Tiene lo que necesita para intentarlo? Sin esto no se cuenta como intento. */
  listo: () => boolean;
  oir: (audio: Buffer, mime: string, language: string, reloj: Presupuesto) => Promise<Escucha>;
};

/** Sin cliente esperando (Telegram): lo que sumaban los topes de siempre de cada proveedor. */
const PRESUPUESTO_SIN_APURO_MS = 72_000;

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

async function transcribirGemini(audio: Buffer, mime: string, language: string, reloj: Presupuesto): Promise<Escucha> {
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
      signal: reloj.senal(20000),
    }
  );
  // Una cuota agotada (429) o una llave vencida no son silencio: son un fallo, y se registran.
  if (!r.ok) {
    console.warn('[stt gemini]', model, r.status, (await r.text().catch(() => '')).slice(0, 160));
    return null;
  }
  const j: any = await r.json().catch(() => ({}));
  const texto = String(j?.candidates?.[0]?.content?.parts?.map((p: any) => p.text).join('') || '').trim();
  if (!texto || /^VACIO$/i.test(texto)) return { texto: '', via: `gemini:${model}` };
  return { texto: texto.slice(0, 4000), via: `gemini:${model}` };
}

/**
 * Oído local (nodo T4): servidor compatible con la API de OpenAI `/v1/audio/transcriptions`
 * (faster-whisper-server, speaches, whisper.cpp server). Sin costo por minuto, latencia baja.
 * Se usa primero si ULTRON_STT_URL está definido; si falla, Scribe.
 */
async function transcribirLocal(audio: Buffer, mime: string, language: string, reloj: Presupuesto): Promise<Escucha> {
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
  const r = await fetch(`${base}/v1/audio/transcriptions`, { method: 'POST', headers, body: form, signal: reloj.senal(12000) });
  if (!r.ok) {
    console.warn('[stt local]', r.status, (await r.text()).slice(0, 120));
    return null;
  }
  const j: any = await r.json().catch(() => ({}));
  const texto = String(j.text || '').trim();
  if (texto.length < 2) return { texto: '', via: 'stt-local' };
  return { texto: texto.slice(0, 4000), via: 'stt-local' };
}

function llaveEleven() {
  return clave('elevenlabs') || process.env.ELEVENLABS_API_KEY || '';
}

async function transcribirEleven(audio: Buffer, mime: string, language: string, reloj: Presupuesto): Promise<Escucha> {
  const out = await elevenTranscribe({ apiKey: llaveEleven(), audio, mime, language, presupuesto: reloj });
  if (out.model === 'error' || out.model === 'sin-clave') return null;
  return { texto: out.text.slice(0, 4000), via: `elevenlabs:${out.model}` };
}

/** El orden de siempre: el nodo propio (gratis), Scribe, y Gemini de reserva. */
export const PROVEEDORES_OIDO: ProveedorOido[] = [
  { nombre: 'stt-local', listo: () => !!process.env.ULTRON_STT_URL, oir: transcribirLocal },
  { nombre: 'elevenlabs', listo: () => !!llaveEleven(), oir: transcribirEleven },
  { nombre: 'gemini', listo: () => !!clave('gemini'), oir: transcribirGemini },
];

/**
 * Recorre los proveedores hasta que uno conteste — con texto o con silencio — o se acabe el tiempo.
 * `motivo` dice por qué terminó sin respuesta, para que quien llama elija la frase.
 */
export async function oirEnCadena(
  proveedores: ProveedorOido[],
  audio: Buffer,
  mime: string,
  language: string,
  reloj: Presupuesto
): Promise<{ escucha: Escucha; intentados: string[]; motivo: 'respondio' | 'tiempo' | 'fallo' | 'ninguno' }> {
  const intentados: string[] = [];
  for (const p of proveedores) {
    if (!p.listo()) continue;
    if (!reloj.alcanza()) {
      console.warn(`[oido] sin tiempo para ${p.nombre}: el cliente ya no espera (probados: ${intentados.join(', ') || 'ninguno'})`);
      return { escucha: null, intentados, motivo: 'tiempo' };
    }
    intentados.push(p.nombre);
    try {
      const escucha = await p.oir(audio, mime, language, reloj);
      if (escucha) return { escucha, intentados, motivo: 'respondio' };
    } catch (e: any) {
      console.warn(`[oido] ${p.nombre} falló:`, String(e?.message || e).slice(0, 120));
    }
  }
  if (!intentados.length) return { escucha: null, intentados, motivo: 'ninguno' };
  return { escucha: null, intentados, motivo: reloj.alcanza() ? 'fallo' : 'tiempo' };
}

export async function transcribirAudio(opts: {
  audio: Buffer;
  mime?: string;
  language?: string;
  /** Lo que el cliente está dispuesto a esperar. Sin él, los topes de siempre (Telegram no tiene apuro). */
  presupuesto?: Presupuesto;
  /** Pruebas: otra cadena de proveedores. */
  proveedores?: ProveedorOido[];
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
  const reloj = opts.presupuesto || presupuesto(PRESUPUESTO_SIN_APURO_MS);
  const { escucha, intentados, motivo } = await oirEnCadena(opts.proveedores || PROVEEDORES_OIDO, buf, mime, language, reloj);
  if (escucha?.texto) {
    return { texto: escucha.texto, via: escucha.via, detalle: `Oí ${escucha.texto.length} caracteres.` };
  }
  if (escucha) {
    return { texto: '', via: escucha.via, detalle: 'Oí el archivo pero no había voz. Escríbeme o vuelve a hablar.' };
  }
  if (motivo === 'tiempo') {
    return { texto: '', via: 'tiempo', detalle: 'Tardé demasiado en oírte. Vuelve a intentarlo o escríbeme.' };
  }
  if (motivo === 'ninguno') {
    // Los nombres de las variables van al registro, no a quien habla: a él no le sirven de nada.
    console.warn('[oido] sin proveedor de oído: falta ULTRON_STT_URL, ELEVENLABS_API_KEY o GEMINI_API_KEY');
    return { texto: '', via: 'ninguno', detalle: 'Ahora mismo no puedo oír audios. Escríbeme.' };
  }
  console.warn(`[oido] ningún proveedor contestó (probados: ${intentados.join(', ')})`);
  return { texto: '', via: 'error', detalle: 'No pude oír el audio ahora mismo. Escríbeme o vuelve a intentarlo.' };
}
