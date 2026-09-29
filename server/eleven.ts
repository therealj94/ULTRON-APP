/**
 * ELEVENLABS — la voz principal de Dr Electrum, con Voicebox detrás.
 *
 *   hablarEleven()  → Eleven v4 Turbo (≈0,3 s al primer audio por /stream, medio carácter de
 *                     crédito por carácter). Si falla, se cae la clave o se acaba el cupo, devuelve
 *                     null y `hablar()` sigue con Voicebox como siempre: nunca se queda mudo por esto.
 *   guionEleven()   → el texto tal como lo dice un geólogo con años: cifras en palabras, unidades
 *                     dichas, las marcas de expresión en español pasadas a las etiquetas que v4
 *                     entiende ([laughs], [sighs]…) y, delante, el tono de la emoción del turno.
 *
 * Las etiquetas van SOLO al audio. El texto que se ve en pantalla no las lleva: se derivan de la
 * emoción que ya trae el turno y de las marcas que el cerebro escribe entre corchetes.
 *
 * Voz: «Jorge», hombre mayor, español mexicano neutro, grave y un poco ronco, de narración
 * educativa. Se cambia sin tocar código con ELEVENLABS_VOZ_ELECTRUM (y ELEVENLABS_MODELO para el
 * modelo). AU-RA no usa ElevenLabs salvo que alguien ponga ELEVENLABS_VOZ_AURA.
 */

import { clave } from '../lib/boveda';
import type { Emocion } from '../lib/emocion';
import type { Presupuesto } from '../lib/presupuesto';

/** Jorge — Neutral Latin American Spanish (biblioteca de ElevenLabs): maduro, grave, creíble. */
export const VOZ_ELECTRUM_ELEVEN = 'Rt1JHkPO27QCUX6Nd5bV';
export const MODELO_ELEVEN = 'eleven_v4_turbo';

/** 96 kb/s: la voz grave conserva el cuerpo y un trozo de 7 s pesa ~85 KB en el teléfono. */
const FORMATO = 'mp3_44100_96';
const API = 'https://api.elevenlabs.io/v1';

export function modeloEleven(): string {
  return String(process.env.ELEVENLABS_MODELO || '').trim() || MODELO_ELEVEN;
}

/** La voz de ElevenLabs de cada plataforma, o null si esa plataforma no la usa. */
export function vozEleven(plataforma: 'ultron' | 'electrum'): string | null {
  if (plataforma === 'electrum') return String(process.env.ELEVENLABS_VOZ_ELECTRUM || '').trim() || VOZ_ELECTRUM_ELEVEN;
  return String(process.env.ELEVENLABS_VOZ_AURA || '').trim() || null;
}

/* ---------------- Freno ---------------- */

/**
 * Si ElevenLabs dice que la clave no vale (401), que no hay cupo (402, `quota_exceeded`) o que
 * frenemos (429), se deja de intentar un rato: cada intento fallido son 300 ms más antes de que
 * Voicebox hable, y eso sí se nota.
 */
let pausaHasta = 0;
let ultimoFallo = '';

export function elevenListo(ahora = Date.now()): boolean {
  return !!clave('elevenlabs') && ahora >= pausaHasta;
}

export function estadoEleven(): { configurado: boolean; pausado: boolean; ultimoFallo: string } {
  return { configurado: !!clave('elevenlabs'), pausado: Date.now() < pausaHasta, ultimoFallo };
}

/** Solo para pruebas. */
export function _reiniciarFrenoEleven() {
  pausaHasta = 0;
  ultimoFallo = '';
}

export function pausaPorFallo(status: number, cuerpo: string): number {
  if (status === 401 || status === 402 || /quota_exceeded|insufficient|payment/i.test(cuerpo)) return 10 * 60_000;
  if (status === 429) return 30_000;
  return 0;
}

/* ---------------- El guion ---------------- */

/**
 * Las marcas de expresión que escribe el cerebro (las mismas de AU-RA, lib/expresiones.ts), en la
 * etiqueta de v4 que suena a eso. Las que en boca de un doctor de minas no suman se quitan.
 */
const EXPRESION_A_V4: Record<string, string> = {
  risa: 'laughs',
  risita: 'chuckles',
  'risa tierna': 'chuckles',
  'risa nerviosa': 'nervous laugh',
  je: 'chuckles',
  suspiro: 'sighs',
  'suspiro cansado': 'sighs',
  'suspiro aliviado': 'relieved sigh',
  'suspiro sonador': 'wistful sigh',
  sorpresa: 'surprised',
  asombro: 'gasps',
  mmm: 'thoughtful',
  hmm: 'hesitant',
  bostezo: 'yawns',
  shh: 'whispers',
  susurro: 'whispers',
  ooh: 'impressed',
  aww: 'tender',
  respiro: 'inhales',
  bufido: 'scoffs',
  carraspeo: 'clears throat',
  aja: '',
  eso: '',
  auch: '',
  ups: '',
  beso: '',
  'mmm rico': '',
};

/**
 * El tono de cada emoción, en el registro de alguien maduro: cálido sin euforia, firme sin gritar,
 * preocupado sin dramatizar. `neutral` no lleva nada: la voz ya es serena, y una etiqueta en cada
 * frase la vuelve actuada.
 */
export const TONO_V4: Partial<Record<Emocion, string>> = {
  feliz: 'warmly',
  risa: 'amused',
  sorpresa: 'pleasantly surprised',
  curioso: 'curious',
  pensando: 'thoughtful',
  preocupado: 'concerned',
  triste: 'softly, sad',
  molesto: 'annoyed, restrained',
  cansado: 'tired',
  carino: 'warmly, tender',
  orgullo: 'proud',
  travieso: 'playful',
  oracion: 'softly, reverent',
  escepticismo: 'skeptical',
  alarma: 'serious, urgent',
  firme: 'firm, measured',
  seco: 'matter-of-fact',
};

const sinTildes = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();

/**
 * Una etiqueta ya en inglés (las de los guiones de la oración: «softly, reverent», «with quiet
 * conviction») pasa si TODAS sus palabras son de este vocabulario. Mirar solo si «parece ASCII»
 * dejaba pasar «[carcajada estruendosa]», y v4 la leía en voz alta.
 */
const VOCABULARIO_INGLES = new Set(
  (
    'a an and with without very slightly more less quiet quietly soft softly warm warmly tender reverent firm firmly ' +
    'calm calmly measured slow slower fast faster rising falling low lower high deep thoughtful curious excited ' +
    'happy sad serious urgent concerned worried relieved proud playful amused surprised pleasantly skeptical annoyed ' +
    'restrained tired gentle gently emotion emotional conviction confident sincere hopeful nostalgic wistful ' +
    'laughs laughing chuckles chuckle giggles sighs sigh sighing whispers whispering whisper gasps gasp inhales ' +
    'exhales breath breathes clears throat pause short long hesitant hesitates impressed scoffs yawns nervous ' +
    'laugh matter of fact flat dry casual friendly authoritative dramatic cheerful solemn intimate'
  ).split(' ')
);
function esEtiquetaIngles(k: string): boolean {
  const palabras = k.split(/[\s,'-]+/).filter(Boolean);
  return palabras.length > 0 && palabras.length <= 8 && palabras.every((w) => VOCABULARIO_INGLES.has(w));
}

/** Cuántas etiquetas como mucho por trozo: más de eso suena a actor sobreactuando. */
const MAX_ETIQUETAS = 4;

/**
 * El texto que se manda a v4. `preparar` es lo mismo que Voicebox usa para la boca (markdown fuera,
 * cifras y unidades en palabras, «mmm...»): se inyecta para no duplicar esas reglas aquí.
 */
export function guionEleven(texto: string, emocion: Emocion, preparar: (t: string) => string): string {
  const crudo = String(texto || '');
  const partes = crudo.split(/\[([^\]\n]{1,80})\]/);
  const salida: string[] = [];
  let etiquetas = 0;
  for (let i = 0; i < partes.length; i++) {
    const p = partes[i];
    if (i % 2 === 0) {
      const dicho = preparar(p);
      if (dicho) salida.push(dicho);
      continue;
    }
    const k = sinTildes(p);
    let v4: string | undefined = k in EXPRESION_A_V4 ? EXPRESION_A_V4[k] : undefined;
    if (v4 === undefined) {
      if (/^(short |long )?pause$|^pausa( corta| larga)?$/.test(k)) {
        salida.push('...');
        continue;
      }
      v4 = esEtiquetaIngles(k) ? k : '';
    }
    if (!v4 || etiquetas >= MAX_ETIQUETAS) continue;
    etiquetas++;
    salida.push(`[${v4}]`);
  }
  let guion = salida
    .join(' ')
    .replace(/\s+([,.;:!?…])/g, '$1')
    .replace(/\s{2,}/g, ' ')
    .trim();
  if (!/[\p{L}\p{N}]/u.test(guion.replace(/\[[^\]]*\]/g, ''))) return '';
  const tono = TONO_V4[emocion];
  if (tono && !guion.startsWith('[')) guion = `[${tono}] ${guion}`;
  return guion;
}

/* ---------------- La llamada ---------------- */

export async function hablarEleven(opts: {
  texto: string;
  voz: string;
  /** Lo dicho justo antes y lo que viene: v4 enlaza la entonación entre trozos. */
  previo?: string;
  siguiente?: string;
  reloj?: Presupuesto;
  timeoutMs?: number;
}): Promise<{ audio: Buffer; contentType: string } | null> {
  const key = clave('elevenlabs');
  if (!key || !elevenListo()) return null;
  if (opts.reloj && !opts.reloj.alcanza()) return null;
  const timeoutMs = opts.timeoutMs ?? (opts.texto.length > 600 ? 30_000 : 15_000);
  const cuerpo: Record<string, unknown> = {
    text: opts.texto,
    model_id: modeloEleven(),
    language_code: 'es',
    // Estabilidad media: deja que la emoción se note sin que cada frase suene a otra persona.
    voice_settings: { stability: 0.5, similarity_boost: 0.8 },
  };
  if (opts.previo) cuerpo.previous_text = opts.previo.slice(-300);
  if (opts.siguiente) cuerpo.next_text = opts.siguiente.slice(0, 300);
  try {
    const r = await fetch(`${API}/text-to-speech/${encodeURIComponent(opts.voz)}/stream?output_format=${FORMATO}`, {
      method: 'POST',
      headers: { 'xi-api-key': key, 'Content-Type': 'application/json', Accept: 'audio/mpeg' },
      body: JSON.stringify(cuerpo),
      signal: opts.reloj ? opts.reloj.senal(timeoutMs) : AbortSignal.timeout(timeoutMs),
    });
    if (!r.ok) {
      const txt = (await r.text().catch(() => '')).slice(0, 240);
      const pausa = pausaPorFallo(r.status, txt);
      if (pausa) pausaHasta = Date.now() + pausa;
      ultimoFallo = `${r.status} ${txt.slice(0, 120)}`;
      console.warn('[voz eleven]', r.status, txt.slice(0, 160), pausa ? `(pausa ${Math.round(pausa / 1000)} s)` : '');
      return null;
    }
    const audio = Buffer.from(await r.arrayBuffer());
    if (audio.length < 400) {
      ultimoFallo = `audio vacío (${audio.length} bytes)`;
      console.warn('[voz eleven] audio vacío:', audio.length, 'bytes');
      return null;
    }
    return { audio, contentType: 'audio/mpeg' };
  } catch (e: any) {
    ultimoFallo = String(e?.message || e).slice(0, 120);
    console.warn('[voz eleven]', ultimoFallo);
    return null;
  }
}
