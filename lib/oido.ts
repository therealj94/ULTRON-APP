/**
 * Oído: transcribe audio de verdad. Whisper en el servidor propio de AU-RA (Voicebox), Gemini de reserva.
 * Si no hay clave o no se entiende, se dice. No se inventa lo hablado.
 */

import { clave } from './boveda';
import { presupuesto, type Presupuesto } from './presupuesto';

export type Oido = { texto: string; via: string; detalle: string };

/**
 * Lo que contesta un proveedor. `null`: no está configurado o se cayó, que pruebe el siguiente.
 * Un `texto` vacío es que contestó bien y no había voz: eso ES una respuesta. Antes se trataba
 * igual que un fallo y el mismo silencio se le mandaba a cada proveedor de la cadena — una factura
 * por proveedor por un bolsillo que rozó el micrófono.
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
 * Lo que Whisper «oye» en el silencio: créditos de subtítulos con los que se entrenó, o una
 * etiqueta entre corchetes. No es voz de nadie, y contestarle sería inventar lo hablado.
 */
const STT_BASURA = /^(subt[ií]tulos.*|gracias por ver.*|suscr[ií]bete.*|\.+|…|music|\[.*\]|\(.*\))$/i;

function extensionDe(mime: string) {
  return /wav/.test(mime) ? 'wav' : /webm/.test(mime) ? 'webm' : /ogg/.test(mime) ? 'ogg' : /mp3|mpeg/.test(mime) ? 'mp3' : 'm4a';
}

/**
 * Whisper (modelo `turbo`) en Voicebox, el mismo servidor que da la voz. Sin costo por minuto:
 * unos 0,8 s para 7 s de audio. Pide su corte al presupuesto de la petición: 12 s o lo que quede.
 */
async function transcribirVoicebox(audio: Buffer, mime: string, language: string, reloj: Presupuesto): Promise<Escucha> {
  const base = clave('voicebox_url').replace(/\/+$/, '');
  const llave = clave('voicebox_clave');
  if (!base || !llave) return null;
  const form = new FormData();
  form.append('file', new Blob([new Uint8Array(audio)], { type: mime }), `voz.${extensionDe(mime)}`);
  form.append('language', language);
  form.append('model', 'turbo');
  const r = await fetch(`${base}/transcribe`, { method: 'POST', headers: { 'X-Voz-Clave': llave }, body: form, signal: reloj.senal(12000) });
  if (!r.ok) {
    console.warn('[stt voicebox]', r.status, (await r.text().catch(() => '')).slice(0, 160));
    return null;
  }
  const j: any = await r.json().catch(() => null);
  // Un 200 sin `text` no es silencio: es una respuesta rota, y el siguiente proveedor merece su turno.
  if (typeof j?.text !== 'string') {
    console.warn('[stt voicebox] respuesta sin texto');
    return null;
  }
  const texto = j.text.trim();
  if (texto.length < 2 || STT_BASURA.test(texto)) return { texto: '', via: 'voicebox:whisper' };
  return { texto: texto.slice(0, 4000), via: 'voicebox:whisper' };
}

/** El orden: el Whisper propio (gratis), y Gemini de reserva. */
export const PROVEEDORES_OIDO: ProveedorOido[] = [
  { nombre: 'voicebox', listo: () => !!(clave('voicebox_url') && clave('voicebox_clave')), oir: transcribirVoicebox },
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
    console.warn('[oido] sin proveedor de oído: falta VOICEBOX_URL + VOICEBOX_CLAVE o GEMINI_API_KEY');
    return { texto: '', via: 'ninguno', detalle: 'Ahora mismo no puedo oír audios. Escríbeme.' };
  }
  console.warn(`[oido] ningún proveedor contestó (probados: ${intentados.join(', ')})`);
  return { texto: '', via: 'error', detalle: 'No pude oír el audio ahora mismo. Escríbeme o vuelve a intentarlo.' };
}
