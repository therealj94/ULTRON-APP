/**
 * Oído: transcribe audio de verdad. ElevenLabs Scribe v2 primero (AU-RA y Dr Electrum); el Whisper propio
 * (Voicebox, mientras exista) y Gemini de reserva.
 * En Dr Electrum va primero ElevenLabs Scribe v2, con el vocabulario minero como pista; Whisper y
 * Gemini quedan detrás. Si no hay clave o no se entiende, se dice. No se inventa lo hablado.
 */

import { clave } from './boveda';
import { presupuesto, MINIMO_UTIL_MS, type Presupuesto } from './presupuesto';
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
 * Lo que AU-RA tiene que oír bien (José, 1-oct: «el micrófono se confunde muchísimo»): los avatares, las
 * apps y las órdenes que más se piden a las manos de la PC y del teléfono. Menos de 100 pistas: con más,
 * ElevenLabs cobra un mínimo de 20 s por audio (documentación de speech-to-text).
 */
export const TERMINOS_AURA = [
  'AU-RA', 'Aura', 'Claudio', 'ANT-ONIO', 'Antonio', 'Guardián', 'Orden Global', 'PULSE2CHAT', 'Genesis ID', 'Veta Wallet',
  'Spotify', 'YouTube', 'Excel', 'Word', 'PowerPoint', 'Outlook', 'Chrome', 'Edge', 'WhatsApp', 'Teams', 'Zoom',
  'Bloc de notas', 'calculadora', 'captura de pantalla', 'volumen', 'siguiente canción', 'pausa', 'recuérdame',
  'videollamada', 'llámame', 'lempiras', 'Tegucigalpa', 'San Pedro Sula', 'Honduras',
];

/**
 * ElevenLabs Scribe v2 (documentación de speech-to-text: `model_id: scribe_v2`, `language_code`, `keyterms`,
 * `tag_audio_events`). Más preciso que Whisper en español con nombres propios y siglas, y con pistas de
 * vocabulario (medido el 1-oct: «Oye Aura, abre Excel y ponme The Verve en Spotify» exacto, 0,74 s).
 * Pide su corte al presupuesto: 15 s como mucho, pero dejando RESERVA_RESPALDO_MS para que, si se cuelga,
 * Whisper o Gemini todavía alcancen a oír antes de que el teléfono corte (/api/stt da 15 s en total).
 */
export const RESERVA_RESPALDO_MS = 5000;

export function topeScribe(reloj: Presupuesto): number {
  return Math.min(15000, Math.max(MINIMO_UTIL_MS, reloj.queda() - RESERVA_RESPALDO_MS));
}

async function transcribirEleven(audio: Buffer, mime: string, language: string, reloj: Presupuesto, terminos: readonly string[] = TERMINOS_ELECTRUM): Promise<Escucha> {
  const key = clave('elevenlabs');
  if (!key) return null;
  const form = new FormData();
  form.append('file', new Blob([new Uint8Array(audio)], { type: mime }), `voz.${extensionDe(mime)}`);
  form.append('model_id', process.env.ELEVENLABS_STT_MODELO || 'scribe_v2');
  // Sin language_code, Scribe detecta el idioma y lo devuelve.
  if (language !== 'auto') form.append('language_code', language);
  form.append('tag_audio_events', 'false');
  // Una pista por campo: un arreglo JSON en un solo campo lo rechaza por «caracteres inválidos».
  for (const t of terminos) form.append('keyterms', t);
  const r = await fetch('https://api.elevenlabs.io/v1/speech-to-text', { method: 'POST', headers: { 'xi-api-key': key }, body: form, signal: reloj.senal(topeScribe(reloj)) });
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

/**
 * El WAV que llega (AURA para Windows manda WAV 16 kHz mono de 16 bits): si es PCM que el tiempo real de
 * Scribe acepta, dónde empiezan las muestras y a qué frecuencia. `null` para cualquier otra cosa (m4a del
 * teléfono, ogg de Telegram, WAV en otro formato): eso sigue por Scribe v2 por lotes.
 */
const FRECUENCIAS_TURBO = new Set([8000, 16000, 22050, 24000, 44100, 48000]);
export function pcmDeWav(audio: Buffer): { pcm: Buffer; frecuencia: number } | null {
  if (audio.length < 44 || audio.toString('ascii', 0, 4) !== 'RIFF' || audio.toString('ascii', 8, 12) !== 'WAVE') return null;
  let formato: { tipo: number; canales: number; frecuencia: number; bits: number } | null = null;
  for (let i = 12; i + 8 <= audio.length; ) {
    const id = audio.toString('ascii', i, i + 4);
    const largo = audio.readUInt32LE(i + 4);
    const cuerpo = i + 8;
    if (id === 'fmt ' && cuerpo + 16 <= audio.length) {
      formato = { tipo: audio.readUInt16LE(cuerpo), canales: audio.readUInt16LE(cuerpo + 2), frecuencia: audio.readUInt32LE(cuerpo + 4), bits: audio.readUInt16LE(cuerpo + 14) };
    } else if (id === 'data') {
      if (!formato || formato.tipo !== 1 || formato.canales !== 1 || formato.bits !== 16 || !FRECUENCIAS_TURBO.has(formato.frecuencia)) return null;
      // Hay grabadoras que dejan el largo en 0 o en 0xFFFFFFFF mientras graban: se toma lo que haya.
      const fin = largo && cuerpo + largo <= audio.length ? cuerpo + largo : audio.length;
      const pcm = audio.subarray(cuerpo, fin - ((fin - cuerpo) % 2));
      return pcm.length ? { pcm, frecuencia: formato.frecuencia } : null;
    }
    i = cuerpo + largo + (largo % 2);
  }
  return null;
}

/**
 * Frases de dinero: con estas no se actúa sobre lo que oyó Turbo (José, 2-oct: «Turbo + confirmar dinero»).
 * En la prueba del 2-oct Turbo escribió «100 dólares» cuando se dijo «cien lempiras»: un monto o una moneda
 * mal oídos son un pago equivocado, así que se vuelven a oír con Scribe v2, que acertó 17 de 18.
 */
export const FRASE_DE_DINERO =
  /\b(pag[aáoeu]\w*|envi[aáeé]\w*|env[ií]\w*|m[aá]nd\w*|transfi?er\w*|deposit\w*|cobr\w*|presta\w*|origen|auka|agka|veta|wallet|cartera|billetera|saldo|d[oó]lar\w*|lempira\w*|usd|pesos?|plata|dinero|monto|precio|cuesta|cu[aá]nto|pay\w*|send\w*|transfer\w*|dollars?|money|balance|price|cost|how much)\b|\$|\d/i;
export function esFraseDeDinero(texto: string): boolean {
  return FRASE_DE_DINERO.test(texto);
}

/**
 * Scribe v2 Realtime Turbo (José, 2-oct: «cambia a Scribe v2 Realtime Turbo… en todos menos Dr Electrum»):
 * el WAV ya grabado se manda de golpe por el WebSocket de tiempo real y se cierra con un commit manual.
 * Medido el 2-oct con 18 frases: ~0,2 s contra ~0,6 s de Scribe v2 por lotes, pero 11 de 18 exactas contra
 * 17 (sobre todo números: «cien» → «100»). Por eso lo de dinero se confirma con Scribe v2 antes de actuar.
 * Devuelve `null` si el audio no es WAV PCM o si Turbo falla: la cadena sigue con Scribe v2 por lotes.
 */
export const MODELO_TURBO = 'scribe_v2_realtime_turbo';

function oirTurbo(pcm: Buffer, frecuencia: number, language: string, terminos: readonly string[], tope: number, key: string): Promise<{ texto: string; idioma?: string } | null> {
  const q = new URLSearchParams({ model_id: process.env.ELEVENLABS_STT_TURBO || MODELO_TURBO, audio_format: `pcm_${frecuencia}`, commit_strategy: 'manual' });
  if (language !== 'auto') q.set('language_code', language);
  for (const t of terminos) q.append('keyterms', t);
  return new Promise((resolver) => {
    let hecho = false;
    // El WebSocket de Node 22 acepta cabeceras como segundo argumento (no está en los tipos del DOM).
    const ws = new (WebSocket as any)(`wss://api.elevenlabs.io/v1/speech-to-text/realtime?${q}`, { headers: { 'xi-api-key': key } }) as WebSocket;
    const terminar = (r: { texto: string; idioma?: string } | null, aviso?: string) => {
      if (hecho) return;
      hecho = true;
      clearTimeout(reloj);
      if (aviso) console.warn('[stt turbo]', aviso.slice(0, 160));
      try {
        ws.close();
      } catch {}
      resolver(r);
    };
    const reloj = setTimeout(() => terminar(null, `sin transcripción en ${tope} ms`), tope);
    ws.onerror = () => terminar(null, 'error del WebSocket');
    ws.onclose = (e) => terminar(null, `cerrado antes de transcribir (${e.code})`);
    ws.onmessage = (e) => {
      let j: any;
      try {
        j = JSON.parse(String(e.data));
      } catch {
        return;
      }
      if (j.message_type === 'session_started') {
        // Trozos de 0,1 s, todos seguidos: el audio ya está grabado, no hay que esperar al ritmo real.
        const trozo = Math.max(2, Math.round(frecuencia / 10) * 2);
        for (let i = 0; i < pcm.length; i += trozo) {
          const ultimo = i + trozo >= pcm.length;
          ws.send(JSON.stringify({ message_type: 'input_audio_chunk', audio_base_64: pcm.subarray(i, i + trozo).toString('base64'), commit: ultimo, sample_rate: frecuencia }));
        }
      } else if (j.message_type === 'committed_transcript' || j.message_type === 'committed_transcript_with_timestamps') {
        // A veces envuelve la frase entre comillas («"Remind me…".»): se quitan.
        const texto = String(j.text || '').trim().replace(/^["“«]\s*(.*?)\s*["”»]\.?$/s, '$1').trim();
        terminar({ texto, idioma: typeof j.language_code === 'string' ? j.language_code : undefined });
      } else if (/error|exceeded|limited/i.test(String(j.message_type))) {
        terminar(null, `${j.message_type} ${j.error || j.message || ''}`);
      }
    };
  });
}

async function transcribirTurbo(audio: Buffer, mime: string, language: string, reloj: Presupuesto, terminos: readonly string[] = TERMINOS_AURA): Promise<Escucha> {
  const key = clave('elevenlabs');
  if (!key || !/^audio\/(x-)?wav$|^audio\/wave$/.test(mime) || typeof WebSocket !== 'function') return null;
  const wav = pcmDeWav(audio);
  if (!wav) return null;
  // Turbo es el rápido: si no contesta en la mitad del tiempo que queda, Scribe v2 por lotes todavía alcanza.
  const turbo = await oirTurbo(wav.pcm, wav.frecuencia, language, terminos, Math.min(8000, Math.max(MINIMO_UTIL_MS, Math.floor(topeScribe(reloj) / 2))), key);
  if (!turbo) return null;
  if (turbo.texto.length < 2 || STT_BASURA.test(turbo.texto)) return { texto: '', via: 'elevenlabs:scribe-turbo' };
  if (esFraseDeDinero(turbo.texto) && reloj.alcanza()) {
    const confirmada = await transcribirEleven(audio, mime, language, reloj, terminos).catch(() => null);
    if (confirmada?.texto) return { ...confirmada, via: 'elevenlabs:scribe-turbo+confirmado' };
    console.warn('[stt turbo] frase de dinero sin confirmar con Scribe v2: se usa la de Turbo');
  }
  return { texto: turbo.texto.slice(0, 4000), via: 'elevenlabs:scribe-turbo', idioma: turbo.idioma };
}

/** Los respaldos: el Whisper propio (si sigue configurado) y Gemini. */
const RESPALDOS_OIDO: ProveedorOido[] = [
  { nombre: 'voicebox', listo: () => !!(clave('voicebox_url') && clave('voicebox_clave')), oir: transcribirVoicebox },
  { nombre: 'gemini', listo: () => !!clave('gemini'), oir: transcribirGemini },
];

/**
 * AU-RA y sus avatares (teléfono, web, Windows frase por frase, Telegram): Scribe primero, con las pistas de
 * AU-RA (José, 1-oct: «cámbialo a Scribe primero… en todos los avatares»). Antes era Whisper primero.
 * Desde el 2-oct, lo que llega en WAV (Windows) pasa antes por Scribe v2 Realtime Turbo; el resto (m4a del
 * teléfono, ogg de Telegram) no lo puede mandar al tiempo real sin convertirlo y sigue por Scribe v2.
 */
export const PROVEEDORES_OIDO: ProveedorOido[] = [
  { nombre: 'elevenlabs-turbo', listo: () => !!clave('elevenlabs'), oir: (a, m, l, r) => transcribirTurbo(a, m, l, r, TERMINOS_AURA) },
  { nombre: 'elevenlabs', listo: () => !!clave('elevenlabs'), oir: (a, m, l, r) => transcribirEleven(a, m, l, r, TERMINOS_AURA) },
  ...RESPALDOS_OIDO,
];

/** Dr Electrum: Scribe primero con las pistas del oficio; los mismos respaldos. Sin Turbo (José, 2-oct:
 * «en todos menos Dr Electrum hasta que yo te diga»). */
export const PROVEEDORES_OIDO_ELECTRUM: ProveedorOido[] = [
  { nombre: 'elevenlabs', listo: () => !!clave('elevenlabs'), oir: (a, m, l, r) => transcribirEleven(a, m, l, r, TERMINOS_ELECTRUM) },
  ...RESPALDOS_OIDO,
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
  /** Quién oye: cambia las pistas de vocabulario de Scribe (las de AU-RA o las del oficio de Dr Electrum). */
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
    console.warn('[oido] sin proveedor de oído: falta ELEVENLABS_API_KEY (o VOICEBOX_URL + VOICEBOX_CLAVE, o GEMINI_API_KEY)');
    return { texto: '', via: 'ninguno', detalle: 'Ahora mismo no puedo oír audios. Escríbeme.' };
  }
  console.warn(`[oido] ningún proveedor contestó (probados: ${intentados.join(', ')})`);
  return { texto: '', via: 'error', detalle: 'No pude oír el audio ahora mismo. Escríbeme o vuelve a intentarlo.' };
}
