/**
 * Oído: transcribe audio de verdad. Whisper en el servidor propio de AU-RA (Voicebox), Gemini de reserva.
 * En Dr Electrum va primero ElevenLabs Scribe v2, con el vocabulario minero como pista; Whisper y
 * Gemini quedan detrás. Si no hay clave o no se entiende, se dice. No se inventa lo hablado.
 */

import { clave } from './boveda';
import { presupuesto, type Presupuesto } from './presupuesto';
import { detectarIdioma, idiomaDeCodigo, type IdiomaTurno } from './idioma-detectar';

/** `idioma`: en qué idioma habló (es/en), cuando se pidió `language: 'auto'`. */
export type Oido = { texto: string; via: string; detalle: string; idioma?: IdiomaTurno };

/**
 * Lo que contesta un proveedor. `null`: no está configurado o se cayó, que pruebe el siguiente.
 * Un `texto` vacío es que contestó bien y no había voz: eso ES una respuesta. Antes se trataba
 * igual que un fallo y el mismo silencio se le mandaba a cada proveedor de la cadena — una factura
 * por proveedor por un bolsillo que rozó el micrófono.
 */
export type Escucha = { texto: string; via: string; /** Código tal como lo dio el proveedor, si lo dio. */ idioma?: string } | null;

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
                text:
                  language === 'auto'
                    ? 'Transcribe el audio en el idioma en que se habla (español o inglés), sin traducirlo. Devuelve SOLO el texto dicho, sin comillas ni explicación. Si no hay voz, responde VACIO.'
                    : `Transcribe el audio a ${language === 'es' ? 'español' : language}. Devuelve SOLO el texto dicho, sin comillas ni explicación. Si no hay voz, responde VACIO.`,
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
  // Sin idioma, Whisper lo detecta solo.
  if (language !== 'auto') form.append('language', language);
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
  return { texto: texto.slice(0, 4000), via: 'voicebox:whisper', idioma: typeof j.language === 'string' ? j.language : undefined };
}

/**
 * Las palabras que un transcriptor general escribe mal y que en Dr Electrum son el trabajo: siglas,
 * departamentos y el oficio. Scribe las usa de pista (`keyterms`) y ya no escribe «ingeo mín» o
 * «Olanchito» donde se dijo INHGEOMIN u Olancho.
 */
export const TERMINOS_ELECTRUM = [
  'Dr Electrum',
  'INHGEOMIN',
  'JICA',
  'Orden Global',
  'concesión',
  'concesiones',
  'catastro',
  'expediente',
  'traslape',
  'prospectividad',
  'geoquímica',
  'litológico',
  'geotectónico',
  'estructural',
  'pórfido',
  'epitermal',
  'veta',
  'ley de oro',
  'gramos por tonelada',
  'onzas',
  'hectáreas',
  'Olancho',
  'Francisco Morazán',
  'El Paraíso',
  'Choluteca',
  'Santa Bárbara',
  'Copán',
  'Minas de Oro',
  'Sentinel',
  'KML',
  'DXF',
  'UTM',
  'Decreto 109-2019',
];

/**
 * ElevenLabs Scribe v2. Más preciso que Whisper en español con nombres propios y siglas, y con
 * pistas de vocabulario. Pide su corte al presupuesto: 15 s o lo que quede.
 */
async function transcribirEleven(audio: Buffer, mime: string, language: string, reloj: Presupuesto): Promise<Escucha> {
  const key = clave('elevenlabs');
  if (!key) return null;
  const form = new FormData();
  form.append('file', new Blob([new Uint8Array(audio)], { type: mime }), `voz.${extensionDe(mime)}`);
  form.append('model_id', process.env.ELEVENLABS_STT_MODELO || 'scribe_v2');
  // Sin language_code, Scribe detecta el idioma y lo devuelve.
  if (language !== 'auto') form.append('language_code', language);
  form.append('tag_audio_events', 'false');
  // Una pista por campo: un arreglo JSON en un solo campo lo rechaza por «caracteres inválidos».
  for (const t of TERMINOS_ELECTRUM) form.append('keyterms', t);
  const r = await fetch('https://api.elevenlabs.io/v1/speech-to-text', { method: 'POST', headers: { 'xi-api-key': key }, body: form, signal: reloj.senal(15000) });
  if (!r.ok) {
    console.warn('[stt eleven]', r.status, (await r.text().catch(() => '')).slice(0, 160));
    return null;
  }
  const j: any = await r.json().catch(() => null);
  if (typeof j?.text !== 'string') {
    console.warn('[stt eleven] respuesta sin texto');
    return null;
  }
  const texto = j.text.trim();
  if (texto.length < 2 || STT_BASURA.test(texto)) return { texto: '', via: 'elevenlabs:scribe' };
  return { texto: texto.slice(0, 4000), via: 'elevenlabs:scribe', idioma: typeof j.language_code === 'string' ? j.language_code : undefined };
}

/** El orden: el Whisper propio (gratis), y Gemini de reserva. */
export const PROVEEDORES_OIDO: ProveedorOido[] = [
  { nombre: 'voicebox', listo: () => !!(clave('voicebox_url') && clave('voicebox_clave')), oir: transcribirVoicebox },
  { nombre: 'gemini', listo: () => !!clave('gemini'), oir: transcribirGemini },
];

/** Dr Electrum: Scribe primero; el Whisper propio y Gemini, de respaldo en ese orden. */
export const PROVEEDORES_OIDO_ELECTRUM: ProveedorOido[] = [
  { nombre: 'elevenlabs', listo: () => !!clave('elevenlabs'), oir: transcribirEleven },
  ...PROVEEDORES_OIDO,
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
  /** 'es', 'en'… o 'auto': que el transcriptor detecte si es español o inglés (y lo devuelva en `idioma`). */
  language?: string;
  /** Lo que el cliente está dispuesto a esperar. Sin él, los topes de siempre (Telegram no tiene apuro). */
  presupuesto?: Presupuesto;
  /** Pruebas: otra cadena de proveedores. */
  proveedores?: ProveedorOido[];
  /** Quién oye. Dr Electrum usa Scribe primero; AU-RA, el Whisper propio. */
  plataforma?: 'ultron' | 'electrum';
}): Promise<Oido> {
  const buf = opts.audio?.length ? opts.audio : Buffer.alloc(0);
  const mime = String(opts.mime || 'audio/ogg').split(';')[0].trim() || 'audio/ogg';
  const language = opts.language === 'auto' ? 'auto' : (opts.language || 'es').slice(0, 2);
  if (buf.length < 80) {
    return { texto: '', via: 'vacio', detalle: 'Audio vacío. No pude oír nada. Escríbeme.' };
  }
  if (buf.length > MAX_BYTES) {
    return { texto: '', via: 'grande', detalle: `Audio de ${buf.length} bytes. Máximo 8 MB. No lo oí.` };
  }
  const reloj = opts.presupuesto || presupuesto(PRESUPUESTO_SIN_APURO_MS);
  const proveedores = opts.proveedores || (opts.plataforma === 'electrum' ? PROVEEDORES_OIDO_ELECTRUM : PROVEEDORES_OIDO);
  let { escucha, intentados, motivo } = await oirEnCadena(proveedores, buf, mime, language, reloj);
  let idioma: IdiomaTurno | undefined;
  if (language === 'auto' && escucha?.texto) {
    const dicho = idiomaDeCodigo(escucha.idioma);
    // Detectó otra lengua (una frase corta en español a veces sale «portugués» o «italiano»): se vuelve
    // a oír en español, que es lo que se habla aquí, en vez de contestarle a una transcripción ajena.
    if (escucha.idioma && !dicho && reloj.alcanza()) {
      const otra = await oirEnCadena(proveedores, buf, mime, 'es', reloj);
      if (otra.escucha?.texto) ({ escucha, intentados, motivo } = otra);
      idioma = 'es';
    } else {
      idioma = dicho || detectarIdioma(escucha.texto) || 'es';
    }
  }
  if (escucha?.texto) {
    return { texto: escucha.texto, via: escucha.via, detalle: `Oí ${escucha.texto.length} caracteres.`, ...(idioma ? { idioma } : {}) };
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
