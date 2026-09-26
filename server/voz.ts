/**
 * VOZ — el único camino por el que AU-RA habla.
 *
 *   hablar()  → Voicebox (Kokoro, en el servidor propio de AU-RA) → null. Con [risa], [suspiro]…
 *               (lib/expresiones.ts) AU-RA pega la toma grabada entre los trozos hablados.
 *   cantar()  → clip grabado del repertorio; una letra libre se DICE (Kokoro no canta)
 *   expresar()→ deja el texto listo para la boca: sin etiquetas de audio, cifras en palabras
 *
 * Aquí no hay selector de motor: hay UNA voz por plataforma y una política. Si Voicebox no
 * contesta, se devuelve null y quien llama se queda en silencio con el texto a la vista: nunca una
 * voz robótica de respaldo, nunca fingiendo.
 */

import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { clave } from '../lib/boveda';
import { afinarParaBoca } from './habla';
import { normalizarEmocion, type Emocion } from '../lib/emocion';
import { CANCIONES, VOZ_OFICIAL } from '../lib/capacidades';
import { leerWav, wavAMp3, type Pcm } from '../lib/mp3';
import { trocearExpresiones } from '../lib/expresiones';
import { adaptarPcm, empalmar, escribirWav, tomaDeExpresion } from './empalme';
import type { Presupuesto } from '../lib/presupuesto';

export type Performance = 'speak' | 'sing';

/** AU-RA: el perfil «AU-RA · Kokoro Dora» de Voicebox (mujer, español). Se cambia con VOICEBOX_PERFIL_AURA. */
export const PERFIL_AURA = '0014442b-51e6-44f5-9a35-f0e1ed296da5';

/**
 * Dr Electrum: el perfil «Electrum · Kokoro Alex» (hombre, español).
 *
 * Dos cerebros con la misma voz son la misma cosa con dos nombres. La cara ya cambia de color según
 * la plataforma; la voz tiene que cambiar igual, o al segundo de audio se deshace la separación que
 * el resto del sistema sostiene. Por eso el respaldo NO es la voz de AU-RA: si
 * `VOICEBOX_PERFIL_ELECTRUM` se queda vacía por un descuido, es mejor que el Doctor siga sonando a
 * él que descubrir el error cuando ya está hablando con la voz de la otra plataforma delante de un
 * cliente.
 */
export const PERFIL_ELECTRUM = 'c4259ed3-f15c-4fe7-a20c-6c59c877cf5c';

export function vozDe(plataforma: 'ultron' | 'electrum'): string {
  if (plataforma === 'electrum') return String(process.env.VOICEBOX_PERFIL_ELECTRUM || '').trim() || PERFIL_ELECTRUM;
  return String(process.env.VOICEBOX_PERFIL_AURA || '').trim() || PERFIL_AURA;
}

/** Dónde está Voicebox y con qué llave. Se lee en cada llamada: la bóveda puede cambiarla en caliente. */
function configVoicebox() {
  return { url: clave('voicebox_url').replace(/\/+$/, ''), llave: clave('voicebox_clave') };
}

/** Sin URL o sin llave no hay voz: Voicebox contesta 403 a todo lo que llega sin `X-Voz-Clave`. */
export function vozConfigurada(): boolean {
  const { url, llave } = configVoicebox();
  return !!(url && llave);
}

const DIR_CANTO = path.join(process.cwd(), 'data', 'canto');

/* ---------------- Tope del canto generado ---------------- */

/**
 * Cuántas oraciones por tema y canciones de letra libre se guardan en disco.
 *
 * Cada texto distinto dejaba su audio en `data/canto` y nadie borraba nada: «ora por mi mamá», «ora
 * por mi mamá que está enferma», «ora por la reunión del martes»... un archivo por pedido, para
 * siempre, en un disco que en Render es pequeño. Se quedan los más recientes (leer uno cuenta
 * como usarlo) y se van los demás.
 */
export const MAX_CANTO_GENERADO = 80;

/**
 * Solo se poda lo que genera este módulo: `<hash>.wav` y `oracion-<hash>.wav` (y los `.mp3` que
 * dejó la voz anterior, que ya no se sirven y se van con la poda). Cualquier otro archivo de la
 * carpeta —un clip del repertorio que alguien deje ahí a mano, un `.gitkeep`— no encaja en el
 * patrón y no se toca nunca.
 */
const CANTO_GENERADO = /^(oracion-)?[0-9a-f]{16}\.(wav|mp3)$/;

export function podarCanto(dir = DIR_CANTO, max = MAX_CANTO_GENERADO): string[] {
  let nombres: string[];
  try {
    nombres = fs.readdirSync(dir).filter((n) => CANTO_GENERADO.test(n));
  } catch {
    return [];
  }
  if (nombres.length <= max) return [];
  const conFecha = nombres
    .map((n) => {
      try {
        return { n, t: fs.statSync(path.join(dir, n)).mtimeMs };
      } catch {
        return { n, t: 0 };
      }
    })
    .sort((a, b) => b.t - a.t);
  const borrados: string[] = [];
  for (const { n } of conFecha.slice(max)) {
    try {
      fs.unlinkSync(path.join(dir, n));
      borrados.push(n);
    } catch {
      /* ya no estaba, o disco de solo lectura */
    }
  }
  return borrados;
}

/** Leer un clip guardado lo marca como usado, para que la poda se lleve primero lo que nadie pide. */
function leerCanto(ruta: string): Buffer | null {
  try {
    if (!fs.existsSync(ruta)) return null;
    const audio = fs.readFileSync(ruta);
    try {
      const ahora = new Date();
      fs.utimesSync(ruta, ahora, ahora);
    } catch {
      /* disco de solo lectura: se sirve igual */
    }
    return audio;
  } catch {
    return null;
  }
}

function guardarCanto(ruta: string, audio: Buffer) {
  try {
    fs.mkdirSync(path.dirname(ruta), { recursive: true });
    fs.writeFileSync(ruta, audio);
    podarCanto(path.dirname(ruta));
  } catch {
    /* disco de solo lectura: se sirve desde memoria */
  }
}
const DIR_PUBLIC = fs.existsSync(path.join(process.cwd(), 'dist', 'voz'))
  ? path.join(process.cwd(), 'dist', 'voz')
  : path.join(process.cwd(), 'public', 'voz');

/* ---------------- Texto para la boca ---------------- */

/** Etiquetas de audio de los guiones viejos: `[softly]`, `[singing, slow worship ballad]`, `[short pause]`. */
const ETIQUETA_AUDIO = /\[[^\]\n]{1,80}\]/g;

/**
 * Quita las etiquetas de audio. Eran instrucciones para la voz anterior; Kokoro no las entiende y las
 * LEE en voz alta («softly, hola»). Se llevan también el espacio que dejan delante de la puntuación.
 */
export function sinEtiquetas(texto: string): string {
  return String(texto || '')
    .replace(ETIQUETA_AUDIO, ' ')
    .replace(/\s+([,.;:!?…])/g, '$1')
    .replace(/([¿¡])\s+/g, '$1')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/** Un guion con etiquetas (oración, clips) es largo a propósito: no se recorta a lo de una respuesta. */
const MAX_GUION = 4000;

/**
 * Texto listo para decir: limpia markdown y cifras, quita etiquetas de audio y deja las muletillas
 * con su pausa («mmm...», «déjame ver...»).
 *
 * La emoción y el canto ya no cambian el audio —Kokoro tiene un solo registro por perfil y no
 * canta—, pero se siguen aceptando para no romper a quien llama: la cara y el cerebro las usan.
 */
export function expresar(texto: string, _emocion: Emocion = 'neutral', _performance: Performance = 'speak'): string {
  const crudo = String(texto || '');
  ETIQUETA_AUDIO.lastIndex = 0;
  if (ETIQUETA_AUDIO.test(crudo)) return afinarParaBoca(sinEtiquetas(crudo), MAX_GUION);
  const base = afinarParaBoca(crudo);
  if (!base) return '';
  /*
   * Las sustituciones se comen la puntuación que traen pegada. Sin eso salía «mmm....» y
   * «déjame ver....», porque el reemplazo añade sus tres puntos y el punto original se quedaba.
   */
  return (
    base
      .replace(/\b(mmm+|hmm+)\b\s*[.,;!]*/gi, 'mmm...')
      // Se conserva la mayúscula original: «Un segundo» al empezar una frase se volvía «un segundo».
      .replace(/\bd([eé])jame ver\b\s*[.,;!]*/gi, (m) => `${m.trimEnd().replace(/[.,;!]+$/, '')}...`)
      .replace(/\bun segundo\b\s*[.,;!]*/gi, (m) => `${m.trimEnd().replace(/[.,;!]+$/, '')}...`)
      .replace(/\s{2,}/g, ' ')
      .trim()
  );
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

/* ---------------- Voicebox ---------------- */

/** Kokoro genera ~7 s de audio en 0,2 s: 20 s es de sobra para una respuesta. Un guion largo se trocea en el servidor. */
const TOPE_MS = 20_000;
const TOPE_LARGO_MS = 45_000;

async function voicebox(opts: { texto: string; perfil: string; timeoutMs: number; reloj?: Presupuesto }): Promise<{ audio: Buffer; contentType: string } | null> {
  const { url, llave } = configVoicebox();
  if (!url || !llave) return null;
  if (opts.reloj && !opts.reloj.alcanza()) {
    console.warn('[voz voicebox] sin tiempo: el cliente ya no espera esta respuesta');
    return null;
  }
  try {
    const r = await fetch(`${url}/generate/stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'audio/wav', 'X-Voz-Clave': llave },
      body: JSON.stringify({ profile_id: opts.perfil, text: opts.texto, language: 'es', engine: 'kokoro' }),
      signal: opts.reloj ? opts.reloj.senal(opts.timeoutMs) : AbortSignal.timeout(opts.timeoutMs),
    });
    if (!r.ok) {
      console.warn('[voz voicebox]', r.status, (await r.text().catch(() => '')).slice(0, 160));
      return null;
    }
    const audio = Buffer.from(await r.arrayBuffer());
    if (audio.length < 200) {
      console.warn('[voz voicebox] audio vacío:', audio.length, 'bytes');
      return null;
    }
    const tipo = String(r.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
    // Un 200 con JSON o HTML (un proxy delante que contesta por su cuenta) no es audio: sonaría a ruido.
    if (tipo && !/^audio\//.test(tipo) && tipo !== 'application/octet-stream') {
      console.warn('[voz voicebox] no devolvió audio:', tipo);
      return null;
    }
    return { audio, contentType: !tipo || /wav|octet/.test(tipo) ? 'audio/wav' : tipo };
  } catch (e: any) {
    console.warn('[voz voicebox]', String(e?.message || e).slice(0, 120));
    return null;
  }
}

/** ¿Contesta Voicebox? Para la salud del sistema. Un 403 no cuenta como vivo: sin llave buena no hay voz. */
export async function saludVoz(timeoutMs = 4000): Promise<{ ok: boolean; status: number; detalle: string }> {
  const { url, llave } = configVoicebox();
  if (!url) return { ok: false, status: 0, detalle: 'VOICEBOX_URL vacío' };
  try {
    const r = await fetch(`${url}/health`, { headers: llave ? { 'X-Voz-Clave': llave } : {}, signal: AbortSignal.timeout(timeoutMs) });
    await r.arrayBuffer().catch(() => null);
    if (r.ok) return { ok: true, status: r.status, detalle: 'Voicebox responde' };
    return { ok: false, status: r.status, detalle: r.status === 403 ? 'Voicebox rechaza la llave (VOICEBOX_CLAVE)' : `Voicebox ${r.status}` };
  } catch (e: any) {
    return { ok: false, status: 0, detalle: String(e?.message || e).slice(0, 160) };
  }
}

/* ---------------- API pública ---------------- */

export type Habla = { audio: Buffer; contentType: string; motor: string; cache: boolean; ms: number };

/** Lo que se va a decir, ya partido: trozos para Voicebox y expresiones grabadas, en orden. */
type Parte = { tipo: 'habla'; texto: string } | { tipo: 'expresion'; etiqueta: string };

/**
 * La clave de caché de una locución. Lleva la voz (si no, el primero que hable deja su timbre
 * guardado y el otro cerebro contesta con la voz ajena) y las expresiones en su sitio: «hola [risa]»
 * y «hola» no son el mismo audio. La emoción no: el mismo texto suena igual con cualquiera.
 */
export function claveVoz(perfil: string, partes: Parte[]): string {
  const guion = partes.map((p) => (p.tipo === 'habla' ? p.texto : `[${p.etiqueta}]`)).join('|');
  return crypto.createHash('sha1').update(`${perfil}|${guion}`).digest('hex');
}

/**
 * Las partes de una locución. Las expresiones solo son de AU-RA: están grabadas con la voz de Dora.
 * En Dr Electrum el texto va entero y `expresar()` quita las marcas sin que suenen.
 */
function partesDe(texto: string, plataforma: 'ultron' | 'electrum', emocion: Emocion, performance: Performance): Parte[] {
  const piezas = plataforma === 'ultron' && performance === 'speak' ? trocearExpresiones(texto) : [{ tipo: 'habla' as const, texto }];
  const partes: Parte[] = [];
  for (const p of piezas) {
    if (p.tipo === 'expresion') partes.push(p);
    else {
      const dicho = expresar(p.texto, emocion, performance);
      // Un trozo sin letras («¡» delante de una sorpresa) no se le pide a Voicebox: devolvería nada y callaría todo.
      if (/[\p{L}\p{N}]/u.test(dicho)) partes.push({ tipo: 'habla', texto: dicho });
    }
  }
  return partes;
}

/**
 * Habla con expresiones: cada trozo hablado es una llamada a Voicebox (en orden) y entre ellas va
 * la toma grabada. Si falta un trozo hablado, callar (null), como siempre: una frase
 * con palabras de menos no se dice. Si una expresión no se puede leer o convertir, se salta. Si
 * Voicebox devolviera algo que no es PCM de 16 bits no hay cómo empalmar: se dice el texto de una
 * vez, sin expresiones.
 */
async function hablarConExpresiones(partes: Parte[], perfil: string, reloj?: Presupuesto): Promise<{ audio: Buffer; contentType: string; motor: string } | null> {
  // Una detrás de otra: Voicebox contesta 500 a pedidos simultáneos (medido: dos de tres a la vez fallaron).
  const hablados: Array<{ audio: Buffer; contentType: string } | null> = [];
  for (const p of partes) {
    if (p.tipo !== 'habla') {
      hablados.push(null);
      continue;
    }
    const h = await voicebox({ texto: p.texto, perfil, timeoutMs: p.texto.length > 800 ? TOPE_LARGO_MS : TOPE_MS, reloj });
    if (!h) return null;
    hablados.push(h);
  }
  const pcms = hablados.map((h) => (h ? leerWav(h.audio) : null));
  if (partes.some((p, i) => p.tipo === 'habla' && !pcms[i])) {
    console.warn('[voz expresiones] Voicebox no dio PCM de 16 bits: digo el texto sin expresiones');
    const guion = partes
      .filter((p): p is Extract<Parte, { tipo: 'habla' }> => p.tipo === 'habla')
      .map((p) => p.texto)
      .join(' ');
    return voicebox({ texto: guion, perfil, timeoutMs: guion.length > 800 ? TOPE_LARGO_MS : TOPE_MS, reloj }).then((o) => (o ? { ...o, motor: 'voicebox:kokoro' } : null));
  }
  // El formato manda la voz: el de su primer trozo (o 24 kHz mono, el de las grabaciones, si solo hay expresiones).
  const base = pcms.find(Boolean) || { hz: 24000, canales: 1 };
  const piezas: Pcm[] = [];
  partes.forEach((p, i) => {
    if (p.tipo === 'habla') {
      const pcm = pcms[i]!;
      piezas.push(pcm.hz === base.hz && pcm.canales === base.canales ? pcm : adaptarPcm(pcm, base.hz, base.canales));
      return;
    }
    const t = tomaDeExpresion(p.etiqueta);
    if (!t) return;
    try {
      piezas.push(t.pcm.hz === base.hz && t.pcm.canales === base.canales ? t.pcm : adaptarPcm(t.pcm, base.hz, base.canales));
    } catch (e: any) {
      console.warn('[voz expresiones] salto', t.toma, String(e?.message || e).slice(0, 80));
    }
  });
  if (!piezas.length) return null;
  return { audio: escribirWav(empalmar(piezas)), contentType: 'audio/wav', motor: 'voicebox:kokoro+expresiones' };
}

export async function hablar(opts: {
  texto: string;
  /** Se acepta y se normaliza por compatibilidad; ya no cambia la voz. */
  emocion?: Emocion | string;
  /** Kokoro no canta: `sing` se dice igual que `speak`. */
  performance?: Performance;
  sinCache?: boolean;
  /** Qué plataforma habla. Decide la voz; por omisión, AU-RA. */
  plataforma?: 'ultron' | 'electrum';
  /** Si la ruta tiene reloj (lib/presupuesto), la voz no se pasa de lo que el cliente espera. */
  presupuesto?: Presupuesto;
}): Promise<Habla | null> {
  const t0 = Date.now();
  const performance: Performance = opts.performance === 'sing' ? 'sing' : 'speak';
  const emocion = normalizarEmocion(opts.emocion);
  const plataforma = opts.plataforma === 'electrum' ? 'electrum' : 'ultron';
  const partes = partesDe(String(opts.texto || '').slice(0, MAX_GUION), plataforma, emocion, performance);
  if (!partes.length) return null;
  const perfil = vozDe(plataforma);
  const key = claveVoz(perfil, partes);
  if (!opts.sinCache) {
    const hit = cacheGet(key);
    if (hit) return { audio: hit.audio, contentType: hit.contentType, motor: hit.motor, cache: true, ms: Date.now() - t0 };
  }
  let out: { audio: Buffer; contentType: string; motor: string } | null;
  if (partes.some((p) => p.tipo === 'expresion')) out = await hablarConExpresiones(partes, perfil, opts.presupuesto);
  else {
    const guion = partes.map((p) => (p.tipo === 'habla' ? p.texto : '')).join(' ');
    const v = await voicebox({ texto: guion, perfil, timeoutMs: guion.length > 800 ? TOPE_LARGO_MS : TOPE_MS, reloj: opts.presupuesto });
    out = v ? { ...v, motor: 'voicebox:kokoro' } : null;
  }
  if (!out) return null;
  cacheSet(key, out);
  return { ...out, cache: false, ms: Date.now() - t0 };
}

/** Oración del día: texto propio de AU-RA. Se graba una vez (public/voz/oracion.mp3) y se sirve como clip. */
export const ORACION_DEL_DIA =
  '[softly, reverent] Cierro los ojos. [short pause] Señor Jesús... gracias por este día que todavía no empieza y ya es tuyo. [warmly] Gracias por el aire que entra, por la mesa donde estamos, por cada persona de esta junta que hoy se levanta a trabajar con las manos y con el corazón. [short pause] [softly] Bendice este día. Bendice lo que vamos a decir y lo que vamos a callar. Bendice las decisiones grandes y las pequeñas, las llamadas, los números, los caminos hacia las minas y los caminos de regreso a casa. [reverent] Bendice a José. Bendice a Medardo. Bendice a Melany, a Leonardo, a Mayra, a Carlos, a sus familias, a sus hijos, a los que están cerca y a los que están lejos. Cuídalos cuando manejen, cuando viajen, cuando duerman. [short pause] [with quiet conviction] Señor, todo lo que hacemos en Orden Global lo ponemos en tus manos. El oro no es nuestro, es tuyo. El trabajo no es nuestro, es tuyo. Que no se nos suba a la cabeza, que no se nos endurezca el corazón. [warmly, rising] Que a través de esta empresa podamos cambiar vidas de verdad: que haya trabajo donde no había, pan donde faltaba, esperanza donde se había ido. Que cada familia que toque Orden Global salga mejor de lo que llegó. [softly] Y que no nos dé vergüenza hablar de ti. Que la gente conozca a Jesús por cómo tratamos al que barre y al que firma, al que debe y al que cobra. Que nos vean y te vean a ti. [short pause] [tender] Perdónanos lo que hicimos mal ayer. Danos paciencia con los que nos cuesta. Danos sabiduría para decir que no cuando hay que decir que no, y valor para decir que sí cuando da miedo. [reverent, slower] Protege a Honduras. Protege a los mineros, a los que están en el cerro y a los que están en la oficina. Sana al que está enfermo. Consuela al que está triste. Acompaña al que está solo. [softly, with emotion] Y a mí, Señor, que solo soy una voz en una mesa... úsame para servirles bien, para decir la verdad y para recordarles que tú vas adelante. [short pause] [warmly] Gracias porque no caminamos solos. Gracias porque ya venciste. [short pause] En el nombre de Jesús... [softly, firmly] Amén.';

/** Oración corta por un tema concreto («ora por mi familia»). Texto propio, ~40 segundos. */
export function oracionPorTema(tema: string): string {
  const t = String(tema || '').replace(/\s+/g, ' ').trim().slice(0, 120);
  return (
    `[softly, reverent] Cierro los ojos. [short pause] Señor Jesús, hoy te traigo esto: ${t}. ` +
    `[warmly] Tú lo conoces mejor que nosotros. Ponle tu mano encima. Da paz donde hay miedo, claridad donde hay ruido y fuerza donde ya no queda. ` +
    `[short pause] [tender] Que lo que salga de aquí sea bueno, y que si no sale como esperamos, nos des la calma para entenderlo y seguir. ` +
    `[softly] Gracias porque nos escuchás, aun cuando pedimos torcido. [short pause] En el nombre de Jesús... [softly, firmly] Amén.`
  );
}

/**
 * Ora. Sin tema: la oración del día (clip grabado; si falta, se genera una vez y se guarda).
 * Con tema: oración corta generada con la voz oficial, con caché en disco por hash.
 *
 * Lo generado es WAV y se guarda como `.wav`: guardarlo como `.mp3` hacía que se sirviera luego con
 * `audio/mpeg` y un teléfono que se fía del tipo no lo abre.
 */
export async function orar(opts: { tema?: string } = {}): Promise<{ audio: Buffer; contentType: string; motor: string } | null> {
  const tema = String(opts.tema || '').trim();
  if (tema.length >= 3) {
    const hash = crypto.createHash('sha1').update(`oracion|${tema.toLowerCase()}`).digest('hex').slice(0, 16);
    const ruta = path.join(DIR_CANTO, `oracion-${hash}.wav`);
    const guardado = leerCanto(ruta);
    if (guardado) return { audio: guardado, contentType: 'audio/wav', motor: 'clip' };
    const out = await hablar({ texto: oracionPorTema(tema), emocion: 'oracion', sinCache: true });
    if (!out) return null;
    guardarCanto(ruta, out.audio);
    return { audio: out.audio, contentType: out.contentType, motor: out.motor };
  }
  const grabado = clipGrabado('oracion');
  if (grabado) return { audio: grabado, contentType: 'audio/mpeg', motor: 'clip' };
  const ruta = path.join(DIR_CANTO, 'oracion-del-dia.wav');
  const guardado = leerCanto(ruta);
  if (guardado) return { audio: guardado, contentType: 'audio/wav', motor: 'clip' };
  const out = await hablar({ texto: ORACION_DEL_DIA, emocion: 'oracion', sinCache: true });
  if (!out) return null;
  guardarCanto(ruta, out.audio);
  return { audio: out.audio, contentType: out.contentType, motor: out.motor };
}

export type Cancion = (typeof CANCIONES)[number];

export function repertorio() {
  return CANCIONES.map((c) => ({ ...c }));
}

export function cancionPorPedido(texto: string): Cancion | null {
  const t = String(texto || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
  const por = (id: string) => CANCIONES.find((c) => c.id === id) || null;
  if (/jesus|generacion 12|generacion doce|conocer a jesus/.test(t)) return por('jesus');
  if (/way ?maker|sinach|en ingles|in english/.test(t)) return por('waymaker');
  if (/bienvenid/.test(t)) return por('bienvenida');
  if (/cumple|feliz dia|felicidades/.test(t)) return por('felizdia');
  if (/bendicion|bendeci|bendice/.test(t)) return por('bendicion');
  if (/\bcuna\b|arrull|\bnana\b|para dormir|buenas noches/.test(t)) return por('cuna');
  if (/bohemian|rhapsody|queen|\bcanta\s*1\b/.test(t)) return por('bohemian');
  if (/musica ligera|soda|cerati|\bcanta\s*2\b/.test(t)) return por('ligera');
  if (/bitter\s*sweet|sinfonia|the verve|medardo|\bcanta\s*3\b/.test(t)) return por('bittersweet');
  if (/runaway|kanye|toast|\bcanta\s*4\b/.test(t)) return por('runaway');
  if (/bruno|die with a smile|si el mundo|\bcanta\s*5\b/.test(t)) return por('bruno');
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
 * Canta. `id` del repertorio → el clip grabado. Sin la grabación no hay canción: Kokoro no canta, y
 * leer la letra de un tema del repertorio no es cantarlo.
 * `letra` libre → Kokoro no canta, así que la DICE con la voz oficial (máx 600 caracteres), con
 * caché en disco por hash.
 */
export async function cantar(opts: { id?: string; letra?: string; titulo?: string }): Promise<{ audio: Buffer; contentType: string; motor: string; titulo: string } | null> {
  const id = String(opts.id || '').trim().toLowerCase();
  if (id) {
    const grabado = clipGrabado(id);
    const meta = CANCIONES.find((c) => c.id === id);
    if (grabado) return { audio: grabado, contentType: 'audio/mpeg', motor: 'clip', titulo: meta?.titulo || id };
    return null;
  }
  const letra = sinEtiquetas(String(opts.letra || '')).replace(/\s+/g, ' ').trim().slice(0, 600);
  if (letra.length < 8) return null;
  const hash = crypto.createHash('sha1').update(letra).digest('hex').slice(0, 16);
  const ruta = path.join(DIR_CANTO, `${hash}.wav`);
  const guardado = leerCanto(ruta);
  if (guardado) return { audio: guardado, contentType: 'audio/wav', motor: 'clip', titulo: opts.titulo || 'canción' };
  const out = await hablar({ texto: letra, performance: 'sing', emocion: 'canto', sinCache: true });
  if (!out) return null;
  guardarCanto(ruta, out.audio);
  return { audio: out.audio, contentType: out.contentType, motor: out.motor, titulo: opts.titulo || 'canción' };
}

export function estadoVoz() {
  const { url } = configVoicebox();
  let servidor: string | null = null;
  try {
    servidor = url ? new URL(url).host : null;
  } catch {
    servidor = null;
  }
  return {
    oficial: VOZ_OFICIAL,
    voicebox: vozConfigurada(),
    servidor,
    perfil: vozDe('ultron'),
    perfilElectrum: vozDe('electrum'),
  };
}

/**
 * Nota de voz para Telegram u otros canales. Misma voz, misma política, en MP3: `sendVoice` no
 * acepta WAV (lo manda como archivo suelto), y Render no tiene ffmpeg para hacer OGG/Opus.
 */
export async function notaDeVozBuffer(texto: string, emocion: Emocion = 'neutral'): Promise<Buffer | undefined> {
  // El corte a 420 puede partir una expresión («[ris»): lo que quedó sin cerrar no se lee.
  const dicho = String(texto || '').replace(/\s+/g, ' ').trim().slice(0, 420).replace(/\[[^\]]*$/, '').trim();
  if (dicho.length < 8) return undefined;
  const out = await hablar({ texto: dicho, emocion });
  if (!out || out.audio.length <= 80) return undefined;
  if (!/wav/.test(out.contentType)) return out.audio;
  const mp3 = await wavAMp3(out.audio).catch((e: any) => {
    console.warn('[voz] no pude pasar la nota a MP3:', String(e?.message || e).slice(0, 120));
    return null;
  });
  return mp3 || undefined;
}
