/**
 * VOZ — el único camino por el que AU-RA habla.
 *
 *   hablar()  → ElevenLabs primero (server/eleven.ts): cada avatar de AU-RA FP (AU-RA, Claudio, el Guardián, ANT-ONIO)
 *               tiene su voz en español y en inglés, y Dr Electrum la suya; un miembro sin minutos de ElevenLabs
 *               del día, o si ElevenLabs no contesta, → Voicebox (Kokoro, en el servidor propio de AU-RA), el
 *               respaldo → null. Con [risa], [suspiro]… (lib/expresiones.ts) se pega la toma grabada entre los
 *               trozos hablados.
 *   cantar()  → clip grabado del repertorio; una letra libre se DICE (Kokoro no canta)
 *   expresar()→ deja el texto listo para la boca: sin etiquetas de audio, cifras en palabras
 *
 * Aquí no hay selector de motor: hay UNA política. Si ni ElevenLabs ni Voicebox contestan, se devuelve null y quien
 * llama se queda en silencio con el texto a la vista: nunca una voz robótica de respaldo, nunca fingiendo.
 * (Auditoría del 7-oct, B-2: esta cabecera decía que Voicebox era el único camino.)
 */

import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { clave } from '../lib/boveda';
import { afinarParaBoca, afinarParaBocaIngles, codigosAVoz } from './habla';
import { normalizarEmocion, type Emocion } from '../lib/emocion';
import { CANCIONES, VOZ_OFICIAL } from '../lib/capacidades';
import { leerWav, wavAMp3, type Pcm } from '../lib/mp3';
import { trocearExpresiones } from '../lib/expresiones';
import { adaptarPcm, empalmar, escribirWav, tomaDeExpresion } from './empalme';
import type { Presupuesto } from '../lib/presupuesto';
import type { AlineacionEleven } from '../lib/alineacion';
import { s3GetJson, s3Listo, s3PutJson } from '../lib/s3';
import { esFraseConocida } from '../lib/frases-conocidas';
import { jsonDeEnv, mapaDeTextos } from '../lib/datos-privados';
import { abrirEleven, aceptaEtiquetas, conMuletillas, elevenListo, estabilidadDe, guionEleven, hablarEleven, HZ_PCM_ELEVEN, hzPcm, idDePedido, modeloEleven, modeloRespaldo, normalizarAvatar, normalizarIdioma, vozEleven, type AvatarVoz, type Idioma } from './eleven';
import { quitarEtiquetasVoz, textoVecino } from '../lib/etiquetas-voz';
import { HiloVoz, type FraseHilo, type ModoTurno } from './hilo-voz';

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
const CANTO_GENERADO = /^(oracion-)?([0-9a-f]{16}|del-dia)(-[a-z]+)*\.(wav|mp3)$/;

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

/**
 * Quita las etiquetas de audio (`[softly]`, `[singing, slow worship ballad]`, `[short pause]`, `[risa]`). Kokoro no las
 * entiende y las LEE en voz alta («softly, hola»). Se llevan también el espacio que dejan delante de la puntuación. Solo
 * las marcas de voz (lib/etiquetas-voz.ts quitarEtiquetasVoz): un «[1]» o un «[Anexo A]» se quedan (10-oct).
 */
export function sinEtiquetas(texto: string): string {
  return quitarEtiquetasVoz(String(texto || ''))
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
export function expresar(texto: string, _emocion: Emocion = 'neutral', _performance: Performance = 'speak', opciones: { cifras?: boolean } = {}): string {
  const crudo = String(texto || '');
  if (quitarEtiquetasVoz(crudo) !== crudo) return afinarParaBoca(sinEtiquetas(crudo), MAX_GUION, opciones);
  const base = afinarParaBoca(crudo, 1200, opciones);
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

type AudioHit = { audio: Buffer; contentType: string; motor: string; at: number; alineacion?: AlineacionEleven | null };
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

/*
 * ---------------- Caché permanente en S3 (segundo nivel) ----------------
 *
 * José (1-oct): «grabar los mensajes comunes y guardarlos en caché, que conteste muchísimo más rápido».
 * La LRU de arriba se pierde en cada redespliegue (y Render redespliega seguido): «¡Hola, José! ¿En qué
 * te ayudo?» se volvía a pagar y a esperar a ElevenLabs. Aquí la voz de ElevenLabs de las frases cortas
 * (las de lib/respuestas-fijas.ts, las de espera, los saludos) se guarda en el cubo de memoria con su
 * clave (voz, modelo, idioma, guion y vecinos) y sus tiempos por letra (la boca del avatar): la primera
 * vez se genera con la voz del avatar y después sale de S3, sin costo, sobreviviendo a los despliegues.
 *  · Solo las frases del banco y las de espera (lib/frases-conocidas.ts), y cortas: una respuesta del
 *    cerebro nunca va a S3, aunque sea corta (puede traer datos de la persona o de un cliente).
 *  · Nunca lo privado (un chat de la persona): ni se lee ni se guarda.
 *  · La lectura tiene tope (S3_VOZ_MS): si S3 tarda, se sigue a ElevenLabs como siempre.
 *  · Lo que no está se recuerda un rato (no se pregunta a S3 por cada frase nueva dos veces).
 */
export const PERSISTIR_MAX_CARACTERES = 240;
export const PREFIJO_S3_VOZ = 'voz-cache/v1/';
export const S3_VOZ_MS = 450;
const FALTA_TTL_MS = 10 * 60_000;
const faltanEnS3 = new Map<string, number>();
type S3Voz = { listo: () => boolean; get: typeof s3GetJson; put: typeof s3PutJson };
let s3Voz: S3Voz = { listo: s3Listo, get: s3GetJson, put: s3PutJson };
/** Solo pruebas: un S3 fingido (null vuelve al de verdad) y la memoria de faltantes limpia. */
export function _s3VozDePrueba(falso: S3Voz | null) {
  s3Voz = falso ?? { listo: s3Listo, get: s3GetJson, put: s3PutJson };
  faltanEnS3.clear();
}
/** Solo pruebas: la LRU vacía, como un proceso recién desplegado. */
export function _vaciarCacheVoz() {
  cache.clear();
  cacheBytes = 0;
}

function persistible(guion: string, texto: string, privado?: boolean): boolean {
  return !privado && guion.length > 0 && guion.length <= PERSISTIR_MAX_CARACTERES && esFraseConocida(texto) && s3Voz.listo();
}

/** `senal`: quien pidió se fue mientras S3 contestaba: no se le espera (lo que llegue tarde no sirve a nadie). */
async function leerVozDeS3(claveAudio: string, senal?: AbortSignal): Promise<Omit<AudioHit, 'at'> | null> {
  const visto = faltanEnS3.get(claveAudio);
  if (visto && Date.now() - visto < FALTA_TTL_MS) return null;
  if (senal?.aborted) return null;
  let reloj: NodeJS.Timeout | undefined;
  let soltar: (() => void) | undefined;
  const r = await Promise.race([
    s3Voz.get(`${PREFIJO_S3_VOZ}${claveAudio}.json`).catch(() => null),
    new Promise<null>((ok) => (reloj = setTimeout(() => ok(null), S3_VOZ_MS))),
    new Promise<null>((ok) => {
      soltar = () => ok(null);
      senal?.addEventListener('abort', soltar, { once: true });
    }),
  ]);
  clearTimeout(reloj);
  if (soltar) senal?.removeEventListener('abort', soltar);
  if (senal?.aborted) return null;
  if (r?.missing) {
    if (faltanEnS3.size > 5_000) faltanEnS3.clear();
    faltanEnS3.set(claveAudio, Date.now());
    return null;
  }
  const j = r?.ok ? r.json : null;
  if (!j || typeof j.audio !== 'string' || !j.audio) return null;
  const audio = Buffer.from(j.audio, 'base64');
  if (audio.length < 400) return null;
  return { audio, contentType: String(j.contentType || 'audio/mpeg'), motor: String(j.motor || 'elevenlabs'), ...(j.alineacion !== undefined ? { alineacion: j.alineacion } : {}) };
}

function guardarVozEnS3(claveAudio: string, hit: Omit<AudioHit, 'at'>) {
  if (hit.audio.length < 400) return;
  faltanEnS3.delete(claveAudio);
  const cuerpo = { audio: hit.audio.toString('base64'), contentType: hit.contentType, motor: hit.motor, ...(hit.alineacion !== undefined ? { alineacion: hit.alineacion } : {}), guardado: new Date().toISOString() };
  void s3Voz
    .put(`${PREFIJO_S3_VOZ}${claveAudio}.json`, cuerpo)
    .then((r) => {
      if (!r.ok) console.warn('[voz] no se guardó en S3:', r.detalle.slice(0, 120));
    })
    .catch(() => undefined);
}

/* ---------------- Voicebox ---------------- */

/** Kokoro genera ~7 s de audio en 0,2 s: 20 s es de sobra para una respuesta. Un guion largo se trocea en el servidor. */
const TOPE_MS = 20_000;
const TOPE_LARGO_MS = 45_000;

/** `senal`: quien pidió la frase se fue (VOZ-03): ni se empieza, y lo que está en curso se corta. */
async function voicebox(opts: { texto: string; perfil: string; timeoutMs: number; reloj?: Presupuesto; idioma?: Idioma; senal?: AbortSignal }): Promise<{ audio: Buffer; contentType: string } | null> {
  const { url, llave } = configVoicebox();
  if (!url || !llave) return null;
  if (opts.senal?.aborted) return null;
  if (opts.reloj && !opts.reloj.alcanza()) {
    console.warn('[voz voicebox] sin tiempo: el cliente ya no espera esta respuesta');
    return null;
  }
  try {
    const r = await fetch(`${url}/generate/stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'audio/wav', 'X-Voz-Clave': llave },
      body: JSON.stringify({ profile_id: opts.perfil, text: opts.texto, language: opts.idioma === 'en' ? 'en' : 'es', engine: 'kokoro' }),
      signal: opts.reloj ? opts.reloj.senalCon(opts.senal, opts.timeoutMs) : opts.senal ? AbortSignal.any([opts.senal, AbortSignal.timeout(opts.timeoutMs)]) : AbortSignal.timeout(opts.timeoutMs),
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
    if (!opts.senal?.aborted) console.warn('[voz voicebox]', String(e?.message || e).slice(0, 120));
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

/** `alineacion`: los tiempos por letra de ElevenLabs, si se pidieron y los dio (la boca del avatar). */
export type Habla = { audio: Buffer; contentType: string; motor: string; cache: boolean; ms: number; alineacion?: AlineacionEleven | null };

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
function partesDe(texto: string, plataforma: 'ultron' | 'electrum', emocion: Emocion, performance: Performance, idioma: Idioma = 'es'): Parte[] {
  const piezas = plataforma === 'ultron' && performance === 'speak' ? trocearExpresiones(texto) : [{ tipo: 'habla' as const, texto }];
  const partes: Parte[] = [];
  for (const p of piezas) {
    if (p.tipo === 'expresion') partes.push(p);
    else {
      const dicho = idioma === 'en' ? afinarParaBocaIngles(sinEtiquetas(p.texto), MAX_GUION) : expresar(p.texto, emocion, performance);
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
async function hablarConExpresiones(partes: Parte[], perfil: string, reloj?: Presupuesto, senal?: AbortSignal): Promise<{ audio: Buffer; contentType: string; motor: string } | null> {
  // Una detrás de otra: Voicebox contesta 500 a pedidos simultáneos (medido: dos de tres a la vez fallaron).
  const hablados: Array<{ audio: Buffer; contentType: string } | null> = [];
  for (const p of partes) {
    if (p.tipo !== 'habla') {
      hablados.push(null);
      continue;
    }
    const h = await voicebox({ texto: p.texto, perfil, timeoutMs: p.texto.length > 800 ? TOPE_LARGO_MS : TOPE_MS, reloj, senal });
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
    return voicebox({ texto: guion, perfil, timeoutMs: guion.length > 800 ? TOPE_LARGO_MS : TOPE_MS, reloj, senal }).then((o) => (o ? { ...o, motor: 'voicebox:kokoro' } : null));
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

/* ---------------- El turno: una sola voz de principio a fin (10-oct) ---------------- */

/**
 * Las frases recientes de cada hablante (server/hilo-voz.ts): con el `previo` de un pedido se reconoce la frase de antes
 * del mismo turno. De ahí sale (1) con qué sigue el turno: si ElevenLabs falló a mitad, el resto se queda en el mismo
 * respaldo en vez de saltar de voz frase a frase; y (2) los `request-id` para enlazar el audio (previous_request_ids).
 */
const hilo = new HiloVoz();
/** Solo pruebas: el hilo vacío, como un proceso recién desplegado. */
export function _vaciarHiloVoz() {
  hilo.vaciar();
}

type Turno = {
  hablante: string;
  previa: FraseHilo | null;
  /** Los modelos de ElevenLabs a probar EN ORDEN para esta frase (vacío: el turno va con Voicebox). */
  modelos: string[];
  /** Hay frases en vivo antes que esta en el turno: si cae a Voicebox, sin tomas grabadas pegadas (sin costuras). */
  enMitad: boolean;
};

function turnoDe(o: { plataforma: 'ultron' | 'electrum'; avatar?: string; idioma: Idioma; vozPropia?: string; previo?: string; sinEleven?: boolean; dueno?: string }): Turno {
  // El hilo es de UNA cuenta (revisión del PR #173): la misma voz y una frase común no enlazan el turno de otra persona
  // (su modo de respaldo ni sus request-id de ElevenLabs). Sin dueño conocido, sin hilo.
  const dueno = String(o.dueno || '').trim().toLowerCase();
  const hablante = dueno ? `${dueno}|${o.plataforma}|${o.avatar || 'aura'}|${o.idioma}|${String(o.vozPropia || '').trim()}` : '';
  const previa = o.previo && hablante ? hilo.buscar(hablante, o.previo) : null;
  const modo: ModoTurno = previa?.modo ?? 'v4';
  const rapido = modeloRespaldo();
  const modelos = o.sinEleven || modo === 'respaldo' ? [] : modo === 'rapido' && rapido ? [rapido] : [modeloEleven(), ...(rapido ? [rapido] : [])];
  return { hablante, previa, modelos, enMitad: !!o.previo && (previa ? previa.empezoEnEleven : true) };
}

const modoDeModelo = (modelo: string): ModoTurno => (modelo === modeloEleven() ? 'v4' : 'rapido');

/** La frase cayó a Voicebox: el resto del turno sigue ahí. Si era la primera, el turno entero es de Voicebox. */
function anotarRespaldo(turno: Turno, texto: string, entrada: FraseHilo | null) {
  if (entrada) {
    entrada.modo = 'respaldo';
    entrada.modelo = '';
    if (!turno.previa) entrada.empezoEnEleven = false;
    return;
  }
  hilo.anotar(turno.hablante, texto, 'respaldo', '', turno.previa);
}

/**
 * Lo que se le pediría a ElevenLabs para esta locución, o null si no toca (plataforma sin voz ahí,
 * canto, sin clave o en pausa, o nada que decir). La clave de caché lleva los vecinos: cambian la
 * entonación, y una frase repetida no debe heredar la de otra respuesta.
 */
function pedidoEleven(o: {
  texto: string;
  emocion: Emocion;
  performance: Performance;
  plataforma: 'ultron' | 'electrum';
  avatar?: AvatarVoz;
  idioma?: Idioma;
  previo?: string;
  siguiente?: string;
  /** Otra voz de ElevenLabs para esta plataforma (la mesa de Dr Electrum: Don Chema, la Ing. Tatiana). */
  vozPropia?: string;
  /** El modelo de esta frase (el del turno: turnoDe); sin él, el expresivo de siempre. */
  modelo?: string;
}): { voz: string; guion: string; clave: string; motor: string; estabilidad: number; modelo: string } | null {
  const idioma = o.idioma === 'en' ? 'en' : 'es';
  const voz = o.performance === 'speak' ? String(o.vozPropia || '').trim() || vozEleven(o.plataforma, o.avatar, idioma) : null;
  if (!voz || !elevenListo()) return null;
  // Dr Electrum habla como persona: alguna muletilla («bueno,», «este») en vez de dicción de locutor. Y sus códigos
  // de expediente («0442») cifra por cifra (server/habla.ts codigosAVoz).
  const base = String(o.texto || '').slice(0, MAX_GUION);
  const humano = o.plataforma === 'electrum' ? conMuletillas(codigosAVoz(base), { primero: !o.previo, emocion: o.emocion }) : base;
  // En inglés no se pasan cifras ni unidades a palabras en español: ElevenLabs las lee solo.
  const preparar = idioma === 'en' ? (t: string) => afinarParaBocaIngles(t, MAX_GUION) : (t: string) => expresar(t, o.emocion, 'speak', { cifras: false });
  // TODO el turno con el mismo modelo (server/eleven.ts): el expresivo; el rápido solo si el expresivo falló en este turno.
  const modelo = o.modelo || modeloEleven();
  const etiquetas = aceptaEtiquetas(modelo);
  // La política de etiquetas (lib/etiquetas-voz.ts): el tono, solo en la primera frase del turno (la que no tiene
  // `previo`); una reacción como mucho; ninguna en lo serio, el dinero o lo legal.
  const conTono = guionEleven(humano, o.emocion, preparar, { tono: !o.previo, modelo, contexto: base });
  const guion = etiquetas ? conTono : conTono.replace(/\[[^\]\n]*\]\s*/g, '').trim();
  if (!guion) return null;
  const estabilidad = estabilidadDe(o.emocion);
  const clave = crypto
    .createHash('sha1')
    .update(`eleven|${modelo}|${voz}|${idioma}|${estabilidad}|${guion}|${textoVecino(o.previo, 'previo') || ''}|${textoVecino(o.siguiente, 'siguiente') || ''}`)
    .digest('hex');
  return { voz, guion, clave, motor: `elevenlabs:${modelo}`, estabilidad, modelo };
}

/**
 * La voz EN VIVO para la web de Dr Electrum: si ElevenLabs contesta, devuelve el audio mientras se
 * genera (la ruta lo pasa al navegador trozo a trozo y llama a `guardar` al final para la caché).
 * Si ya estaba en caché, lo devuelve entero. Null: que la ruta use `hablar({ sinEleven: true })`.
 */
export async function abrirVozEnVivo(opts: {
  texto: string;
  /** De quién es la voz (la cuenta de la sesión): el hilo entre frases es solo suyo. */
  dueno?: string;
  emocion?: Emocion | string;
  plataforma?: 'ultron' | 'electrum';
  previo?: string;
  siguiente?: string;
  /** Español o inglés: el de la respuesta que se lee. */
  idioma?: Idioma | string;
  /** La voz del avatar de AU-RA (ojos, aura, claudio); Dr Electrum no lo usa. */
  avatar?: AvatarVoz;
  /** Dr Electrum: es la primera frase de la respuesta (modelo rápido; server/eleven.ts modeloDeLocucion). */
  primera?: boolean;
  /** Otra voz de ElevenLabs (la mesa de Dr Electrum: Don Chema, la Ing. Tatiana). */
  vozPropia?: string;
}): Promise<
  | { tipo: 'cache'; habla: Habla }
  | { tipo: 'vivo'; contentType: string; motor: string; cuerpo: ReadableStream<Uint8Array>; guardar: (audio: Buffer) => void }
  | null
> {
  const emocion = normalizarEmocion(opts.emocion);
  const plataforma = opts.plataforma === 'electrum' ? 'electrum' : 'ultron';
  const idioma = normalizarIdioma(opts.idioma);
  const avatar = plataforma === 'ultron' ? normalizarAvatar(opts.avatar) : 'aura';
  const turno = turnoDe({ plataforma, avatar, idioma, vozPropia: opts.vozPropia, previo: opts.previo, dueno: opts.dueno });
  let entrada: FraseHilo | null = null;
  for (const modelo of turno.modelos) {
    const p = pedidoEleven({ ...opts, avatar, emocion, performance: 'speak', plataforma, idioma, modelo });
    if (!p) break;
    const hit = cacheGet(p.clave);
    if (hit) {
      hilo.anotar(turno.hablante, opts.texto, modoDeModelo(modelo), modelo, turno.previa);
      return { tipo: 'cache', habla: { audio: hit.audio, contentType: hit.contentType, motor: hit.motor, cache: true, ms: 0 } };
    }
    const guardable = persistible(p.guion, opts.texto);
    const deS3 = guardable ? await leerVozDeS3(p.clave) : null;
    if (deS3) {
      cacheSet(p.clave, deS3);
      hilo.anotar(turno.hablante, opts.texto, modoDeModelo(modelo), modelo, turno.previa);
      return { tipo: 'cache', habla: { audio: deS3.audio, contentType: deS3.contentType, motor: deS3.motor, cache: true, ms: 0 } };
    }
    // Se anota al pedirla: la frase siguiente ya sabe con qué va el turno.
    if (entrada) Object.assign(entrada, { modo: modoDeModelo(modelo), modelo });
    else entrada = hilo.anotar(turno.hablante, opts.texto, modoDeModelo(modelo), modelo, turno.previa);
    // Sin el idioma, ElevenLabs leía todo como español (language_code 'es'), inglés incluido.
    const r = await abrirEleven({ texto: p.guion, voz: p.voz, previo: opts.previo, siguiente: opts.siguiente, estabilidad: p.estabilidad, idioma, modelo: p.modelo, previosIds: hilo.idsPara(turno.previa, modelo) });
    if (!r?.body) {
      // Sin cupo o sin llave, el rápido tampoco contesta: Voicebox (lo decide quien llama).
      if (!elevenListo()) break;
      continue;
    }
    const fila = entrada;
    return {
      tipo: 'vivo',
      contentType: 'audio/mpeg',
      motor: p.motor,
      cuerpo: r.body,
      guardar: (audio) => {
        if (audio.length < 400) return;
        // Llegó entera: su id ya sirve para enlazar la frase siguiente (ElevenLabs lo pide así).
        fila.id = idDePedido(r);
        cacheSet(p.clave, { audio, contentType: 'audio/mpeg', motor: p.motor });
        if (guardable) guardarVozEnS3(p.clave, { audio, contentType: 'audio/mpeg', motor: p.motor });
      },
    };
  }
  // ElevenLabs no abrió (o el turno ya iba con Voicebox): quien llama sigue con Voicebox, y el resto del turno también.
  if (turno.modelos.length) anotarRespaldo(turno, opts.texto, entrada);
  return null;
}

/** Lo que `pasarVozEnVivo` usa de la respuesta HTTP (express.Response lo cumple; las pruebas lo fingen). */
type SalidaVoz = {
  write: (b: Buffer) => unknown;
  end: () => unknown;
  on: (evento: 'close', fn: () => void) => unknown;
  off?: (evento: 'close', fn: () => void) => unknown;
  readonly writableEnded: boolean;
  destroy?: (e?: Error) => unknown;
};

/**
 * Pasa la voz en vivo a la respuesta trozo a trozo y SOLO la guarda en la caché si ElevenLabs la
 * terminó sola. Si la persona cuelga a medias, `lector.cancel()` hace que `read()` devuelva `done`
 * como un final normal: antes eso guardaba para siempre un MP3 cortado (basta con 400 bytes), y la
 * próxima vez esa frase sonaba mocha desde la caché. Devuelve si quedó guardada.
 */
export async function pasarVozEnVivo(
  vivo: { cuerpo: ReadableStream<Uint8Array>; guardar: (audio: Buffer) => void },
  res: SalidaVoz,
  etiqueta = '[voz]',
  /**
   * `romperSiFalla`: si ElevenLabs se corta a media frase, la conexión se ROMPE (destroy) en vez de cerrarse bien. Lo
   * pide el PCM del teléfono (server/voz-pcm.ts): un PCM crudo no tiene cabecera ni largo, y un final limpio diría
   * «esta frase era así de corta». Con la conexión rota el reproductor sabe que se cortó.
   * `senal`: el corte del pedido (server/voz-pcm.ts: el teléfono se fue o se canceló la generación; VOZ-03): también
   * deja de leer, y la frase cuenta como cortada (no se guarda).
   */
  o: { romperSiFalla?: boolean; senal?: AbortSignal } = {}
): Promise<boolean> {
  const lector = vivo.cuerpo.getReader();
  let cortada = false;
  // Si la persona interrumpe o cambia de pregunta, se deja de pedirle audio a ElevenLabs.
  const alCerrar = () => {
    if (res.writableEnded) return;
    cortada = true;
    lector.cancel().catch(() => undefined);
  };
  const alCortar = () => {
    cortada = true;
    lector.cancel().catch(() => undefined);
  };
  res.on('close', alCerrar);
  if (o.senal?.aborted) alCortar();
  else o.senal?.addEventListener('abort', alCortar, { once: true });
  const trozos: Buffer[] = [];
  let entero = true;
  try {
    for (;;) {
      const { done, value } = await lector.read();
      if (done || cortada) break;
      const b = Buffer.from(value);
      trozos.push(b);
      res.write(b);
    }
  } catch (e: any) {
    entero = false;
    if (!cortada) console.warn(`${etiqueta} voz en vivo cortada`, String(e?.message || e).slice(0, 120));
  }
  res.off?.('close', alCerrar);
  o.senal?.removeEventListener('abort', alCortar);
  // Con `romperSiFalla`, un final limpio SIN audio tampoco es un final: las cabeceras ya salieron y un 200 vacío diría
  // «esta frase no tiene voz». Se rompe y no se guarda (server/voz-pcm.ts ya espera el primer audio antes de las cabeceras).
  if (entero && o.romperSiFalla && !trozos.some((b) => b.length)) entero = false;
  if ((!entero || cortada) && o.romperSiFalla && res.destroy) res.destroy(new Error('voz cortada'));
  else res.end();
  if (!entero || cortada) return false;
  vivo.guardar(Buffer.concat(trozos));
  return true;
}

/* ---------------- La voz en PCM, para el teléfono que la suena a medida que llega ---------------- */

/**
 * El tipo de lo que manda /api/tts/pcm: PCM lineal de 16 bits, little-endian, mono, sin cabecera. La frecuencia va
 * en `X-Ultron-Pcm-Hz` (no en el tipo: «audio/L16» sería big-endian por norma, y el reproductor lo leería al revés).
 */
export const TIPO_PCM = 'audio/pcm';

/** Un WAV de 16 bits (Voicebox, el respaldo) pasado a PCM mono crudo, con su frecuencia. null si no es WAV de 16 bits. */
export function pcmDeWav(wav: Buffer): { pcm: Buffer; hz: number } | null {
  const leido = leerWav(wav);
  if (!leido || !leido.muestras.length) return null;
  const mono = leido.canales === 1 ? leido : adaptarPcm(leido, leido.hz, 1);
  const pcm = Buffer.alloc(mono.muestras.length * 2);
  for (let i = 0; i < mono.muestras.length; i++) pcm.writeInt16LE(mono.muestras[i], i * 2);
  return { pcm, hz: mono.hz };
}

export type VozPcm =
  /** Ya estaba (caché en memoria o en S3), entera. */
  | { tipo: 'cache'; pcm: Buffer; hz: number; motor: string }
  /** ElevenLabs la está generando: el cuerpo llega a trozos. `guardar` la deja en la caché si llegó entera. */
  | { tipo: 'vivo'; hz: number; motor: string; cuerpo: ReadableStream<Uint8Array>; guardar: (audio: Buffer) => void }
  /** Voicebox (respaldo o tope de minutos): entera, ya pasada a PCM. */
  | { tipo: 'entero'; pcm: Buffer; hz: number; motor: string };

/**
 * LA VOZ EN STREAMING DEL TELÉFONO (docs/adr/ADR-voz-en-streaming.md). La misma locución que /api/tts (misma voz,
 * modelo, guion, vecinos y tono: `pedidoEleven`), pedida a ElevenLabs por /stream en PCM, para que el teléfono la suene
 * con el primer trozo en vez de esperar el archivo entero. Su caché va aparte (la clave lleva el formato: un MP3 no se
 * sirve como PCM) y solo guarda lo que llegó entero. Si ElevenLabs no abre (o el miembro ya no tiene minutos,
 * `sinEleven`), Voicebox, pasado a PCM. null: no hay voz (quien pide se queda con el camino de siempre).
 */
export async function abrirVozPcm(opts: {
  texto: string;
  /** De quién es la voz (la cuenta de la sesión): el hilo entre frases es solo suyo. */
  dueno?: string;
  emocion?: Emocion | string;
  performance?: Performance;
  avatar?: AvatarVoz | string;
  idioma?: Idioma | string;
  previo?: string;
  siguiente?: string;
  /** Un chat de la persona: ni se lee de la caché ni se guarda en ella. */
  privado?: boolean;
  /** Directo a Voicebox (el miembro gastó sus minutos de ElevenLabs de hoy). */
  sinEleven?: boolean;
  /** Para pruebas: la frecuencia (si no, ELEVENLABS_PCM_HZ o 22 050). */
  hz?: number;
  /**
   * Solo lo ya guardado (caché en memoria o en S3): quien pide no tiene sesión (server/seguridad.ts, clips públicos).
   * Nunca genera: lo que no está, null.
   */
  soloCache?: boolean;
  /** Quién habla: AU-RA (por omisión) o Dr Electrum (/api/electrum/voz/pcm), con su voz y su forma de decir. */
  plataforma?: 'ultron' | 'electrum';
  /** Otra voz de ElevenLabs (la mesa de Dr Electrum: Don Chema, la Ing. Tatiana). */
  vozPropia?: string;
  /** Dr Electrum: la primera frase de la respuesta (modelo rápido). */
  primera?: boolean;
  /**
   * El corte del pedido (server/voz-pcm.ts; auditoría del 11-oct, VOZ-03): el teléfono colgó, se canceló la generación
   * o se pasó el plazo del primer audio. Llega a S3, a ElevenLabs y a Voicebox; cortado, null y SIN respaldo: nadie
   * espera esta frase (ni se gasta cupo ni se arranca Voicebox para nadie).
   */
  senal?: AbortSignal;
}): Promise<VozPcm | null> {
  const senal = opts.senal;
  const sinNadie = () => !!senal?.aborted;
  if (sinNadie()) return null;
  const emocion = normalizarEmocion(opts.emocion);
  const performance: Performance = opts.performance === 'sing' ? 'sing' : 'speak';
  const avatar = normalizarAvatar(opts.avatar);
  const idioma = normalizarIdioma(opts.idioma);
  const plataforma = opts.plataforma === 'electrum' ? 'electrum' : 'ultron';
  const hz = opts.hz && (HZ_PCM_ELEVEN as readonly number[]).includes(opts.hz) ? opts.hz : hzPcm();
  const turno = turnoDe({ plataforma, avatar: plataforma === 'ultron' ? avatar : 'aura', idioma, vozPropia: opts.vozPropia, previo: opts.previo, sinEleven: opts.sinEleven, dueno: opts.dueno });
  let entrada: FraseHilo | null = null;
  for (const modelo of turno.modelos) {
    const p = pedidoEleven({ texto: opts.texto, emocion, performance, plataforma, avatar, idioma, previo: opts.previo, siguiente: opts.siguiente, vozPropia: opts.vozPropia, modelo });
    if (!p) break;
    const clave = crypto.createHash('sha1').update(`${p.clave}|pcm_${hz}`).digest('hex');
    const tipo = `${TIPO_PCM};rate=${hz}`;
    if (!opts.privado) {
      const hit = cacheGet(clave);
      if (hit) {
        if (!opts.soloCache) hilo.anotar(turno.hablante, opts.texto, modoDeModelo(modelo), modelo, turno.previa);
        return { tipo: 'cache', pcm: hit.audio, hz, motor: hit.motor };
      }
    }
    const guardable = persistible(p.guion, opts.texto, opts.privado);
    const deS3 = guardable ? await leerVozDeS3(clave, senal) : null;
    // S3 tardó y la persona se fue mientras tanto: ni ElevenLabs ni Voicebox.
    if (sinNadie()) return null;
    if (deS3 && deS3.contentType === tipo) {
      cacheSet(clave, deS3);
      if (!opts.soloCache) hilo.anotar(turno.hablante, opts.texto, modoDeModelo(modelo), modelo, turno.previa);
      return { tipo: 'cache', pcm: deS3.audio, hz, motor: deS3.motor };
    }
    if (opts.soloCache) return null;
    if (entrada) Object.assign(entrada, { modo: modoDeModelo(modelo), modelo });
    else entrada = hilo.anotar(turno.hablante, opts.texto, modoDeModelo(modelo), modelo, turno.previa);
    const r = await abrirEleven({ texto: p.guion, voz: p.voz, previo: opts.previo, siguiente: opts.siguiente, estabilidad: p.estabilidad, idioma, modelo: p.modelo, formato: `pcm_${hz}`, previosIds: hilo.idsPara(turno.previa, modelo), senal });
    if (sinNadie()) {
      // Se fue justo cuando ElevenLabs contestó: se suelta su cuerpo (deja de generar) y no se prueba otro modelo.
      r?.body?.cancel().catch(() => undefined);
      return null;
    }
    if (r?.body) {
      const fila = entrada;
      return {
        tipo: 'vivo',
        hz,
        motor: p.motor,
        cuerpo: r.body,
        guardar: (audio) => {
          // Lo privado no se guarda; un PCM de menos de 20 ms no es una frase.
          if (audio.length < hz / 25) return;
          fila.id = idDePedido(r);
          if (opts.privado) return;
          cacheSet(clave, { audio, contentType: tipo, motor: p.motor });
          if (guardable) guardarVozEnS3(clave, { audio, contentType: tipo, motor: p.motor });
        },
      };
    }
    if (!elevenListo()) break;
  }
  if (opts.soloCache || sinNadie()) return null;
  // Voicebox de aquí al final del turno (y sin tomas pegadas si el turno empezó en vivo: `hablar` lo mira).
  if (turno.modelos.length) anotarRespaldo(turno, opts.texto, entrada);
  // Respaldo: Voicebox (WAV de 16 bits), pasado a PCM. Sin ElevenLabs de por medio (ya se intentó o no toca).
  const out = await hablar({ texto: opts.texto, emocion, performance, avatar, idioma, plataforma, previo: opts.previo, siguiente: opts.siguiente, sinEleven: true, senal, ...(opts.privado ? { sinCache: true, privado: true } : {}) });
  if (!out || !/wav/i.test(out.contentType) || sinNadie()) return null;
  const crudo = pcmDeWav(out.audio);
  return crudo ? { tipo: 'entero', pcm: crudo.pcm, hz: crudo.hz, motor: out.motor } : null;
}

export async function hablar(opts: {
  texto: string;
  /** De quién es la voz (la cuenta de la sesión): el hilo entre frases es solo suyo. */
  dueno?: string;
  /** Se acepta y se normaliza por compatibilidad; ya no cambia la voz. */
  emocion?: Emocion | string;
  /** Kokoro no canta: `sing` se dice igual que `speak`. */
  performance?: Performance;
  sinCache?: boolean;
  /** Texto de un chat de la persona: ni se lee de la caché de audio ni se guarda en ella. */
  privado?: boolean;
  /** Qué plataforma habla. Decide la voz; por omisión, AU-RA. */
  plataforma?: 'ultron' | 'electrum';
  /** Si la ruta tiene reloj (lib/presupuesto), la voz no se pasa de lo que el cliente espera. */
  presupuesto?: Presupuesto;
  /** Lo dicho justo antes y lo que viene (la pantalla habla por trozos): ElevenLabs enlaza la entonación. */
  previo?: string;
  siguiente?: string;
  /** Saltarse ElevenLabs (la ruta en vivo ya lo intentó y falló): directo a Voicebox. */
  sinEleven?: boolean;
  /** En la app de AU-RA: quién habla (Guardián, AU-RA o Claudio). Decide la voz. */
  avatar?: AvatarVoz | string;
  /** En qué idioma habla la persona (lo elige al entrar). Decide la voz y cómo se lee el texto. */
  idioma?: Idioma | string;
  /** Pedir también los tiempos por letra (la boca del avatar en el teléfono). No cambia la voz. */
  tiempos?: boolean;
  /**
   * Solo lo ya guardado (caché en memoria o en S3), sin generar nada: quien pide no tiene sesión y solo se le dan los
   * clips públicos (saludos y frases conocidas ya grabadas; server/seguridad.ts). Lo que no está, null. Lo guardado
   * sin los tiempos por letra se sirve igual (la boca sigue el volumen).
   */
  soloCache?: boolean;
  /** Otra voz de ElevenLabs (la mesa de Dr Electrum: Don Chema, la Ing. Tatiana). Sin ella, la de la plataforma. */
  vozPropia?: string;
  /** Quien pidió la frase se fue (VOZ-03): se corta lo que esté en curso (ElevenLabs, Voicebox) y no se sigue. */
  senal?: AbortSignal;
}): Promise<Habla | null> {
  const t0 = Date.now();
  const performance: Performance = opts.performance === 'sing' ? 'sing' : 'speak';
  const emocion = normalizarEmocion(opts.emocion);
  const plataforma = opts.plataforma === 'electrum' ? 'electrum' : 'ultron';
  const avatar = plataforma === 'ultron' ? normalizarAvatar(opts.avatar) : 'aura';
  // Dr Electrum también habla inglés cuando le hablan en inglés (el turno devuelve el idioma).
  const idioma = normalizarIdioma(opts.idioma);

  /*
   * Primero ElevenLabs: cada avatar de AU-RA FP tiene su voz v4 en español y en inglés, y Dr
   * Electrum la suya. Aquí las marcas y la emoción SÍ suenan: v4 las entiende. Si no contesta,
   * sigue abajo Voicebox como respaldo, sin que quien habla note nada.
   */
  // Sin sesión: nada privado (nunca está en la caché) y nada que no esté ya guardado.
  if (opts.soloCache && (opts.privado || opts.sinCache)) return null;
  const turno = turnoDe({ plataforma, avatar, idioma, vozPropia: opts.vozPropia, previo: opts.previo, sinEleven: opts.sinEleven, dueno: opts.dueno });
  let entrada: FraseHilo | null = null;
  for (const modelo of turno.modelos) {
    const xiPedido = pedidoEleven({ ...opts, performance, emocion, plataforma, avatar, idioma, modelo });
    if (!xiPedido) break;
    if (!opts.sinCache) {
      const hit = cacheGet(xiPedido.clave);
      // Si ahora se piden los tiempos y lo guardado no los trae, se vuelve a pedir (una vez: se guarda con ellos).
      const sirve = hit && (!opts.tiempos || hit.alineacion !== undefined || opts.soloCache);
      if (hit && sirve) {
        if (!opts.soloCache) hilo.anotar(turno.hablante, String(opts.texto || ''), modoDeModelo(modelo), modelo, turno.previa);
        return { audio: hit.audio, contentType: hit.contentType, motor: hit.motor, cache: true, ms: Date.now() - t0, alineacion: hit.alineacion };
      }
    }
    const guardable = persistible(xiPedido.guion, String(opts.texto || ''), opts.privado);
    if (guardable && !opts.sinCache) {
      const deS3 = await leerVozDeS3(xiPedido.clave, opts.senal);
      if (opts.senal?.aborted) return null;
      if (deS3 && (!opts.tiempos || deS3.alineacion !== undefined || opts.soloCache)) {
        cacheSet(xiPedido.clave, deS3);
        if (!opts.soloCache) hilo.anotar(turno.hablante, String(opts.texto || ''), modoDeModelo(modelo), modelo, turno.previa);
        return { ...deS3, cache: true, ms: Date.now() - t0 };
      }
    }
    if (opts.soloCache) return null;
    if (entrada) Object.assign(entrada, { modo: modoDeModelo(modelo), modelo });
    else entrada = hilo.anotar(turno.hablante, String(opts.texto || ''), modoDeModelo(modelo), modelo, turno.previa);
    const xi = await hablarEleven({ texto: xiPedido.guion, voz: xiPedido.voz, previo: opts.previo, siguiente: opts.siguiente, reloj: opts.presupuesto, estabilidad: xiPedido.estabilidad, idioma, tiempos: opts.tiempos, modelo: xiPedido.modelo, previosIds: hilo.idsPara(turno.previa, modelo), senal: opts.senal });
    if (xi) {
      entrada.id = xi.requestId;
      const { requestId: _id, ...audio } = xi;
      // null: se pidieron los tiempos y no vinieron (así lo guardado no los vuelve a pedir).
      const out = { ...audio, motor: xiPedido.motor, ...(opts.tiempos ? { alineacion: xi.alineacion ?? null } : {}) };
      if (!opts.privado) cacheSet(xiPedido.clave, out);
      if (guardable) guardarVozEnS3(xiPedido.clave, out);
      return { ...out, cache: false, ms: Date.now() - t0 };
    }
    // Nadie espera ya la frase: ni el modelo rápido ni Voicebox.
    if (opts.senal?.aborted) return null;
    // Sin cupo, sin llave o sin tiempo del cliente, el modelo rápido tampoco: directo al respaldo.
    if (!elevenListo() || (opts.presupuesto && !opts.presupuesto.alcanza())) break;
  }

  /*
   * Respaldo en Voicebox. Guardián y Claudio son hombres: la voz de hombre (Kokoro Alex), nunca la
   * de AU-RA, y sin las tomas grabadas de risa o suspiro, que son de ella. En inglés tampoco van
   * las tomas (se grabaron en español). Y a MITAD de un turno que empezó con ElevenLabs, tampoco: una toma de Kokoro
   * pegada entre frases en vivo es una costura que se oye (10-oct). El resto del turno sigue aquí (anotarRespaldo).
   */
  const deHombre = avatar !== 'aura';
  const sinTomas = deHombre || idioma === 'en' || turno.enMitad;
  const partes = partesDe(String(opts.texto || '').slice(0, MAX_GUION), plataforma, emocion, performance, idioma).filter((p) => !sinTomas || p.tipo === 'habla');
  if (!partes.length) return null;
  const perfil = deHombre ? vozDe('electrum') : vozDe(plataforma);
  const key = `${idioma}|${claveVoz(perfil, partes)}`;
  if (!opts.sinCache) {
    const hit = cacheGet(key);
    if (hit) return { audio: hit.audio, contentType: hit.contentType, motor: hit.motor, cache: true, ms: Date.now() - t0 };
  }
  if (opts.soloCache || opts.senal?.aborted) return null;
  anotarRespaldo(turno, String(opts.texto || ''), entrada);
  let out: { audio: Buffer; contentType: string; motor: string } | null;
  if (partes.some((p) => p.tipo === 'expresion')) out = await hablarConExpresiones(partes, perfil, opts.presupuesto, opts.senal);
  else {
    const guion = partes.map((p) => (p.tipo === 'habla' ? p.texto : '')).join(' ');
    const v = await voicebox({ texto: guion, perfil, timeoutMs: guion.length > 800 ? TOPE_LARGO_MS : TOPE_MS, reloj: opts.presupuesto, idioma, senal: opts.senal });
    out = v ? { ...v, motor: 'voicebox:kokoro' } : null;
  }
  if (!out) return null;
  if (!opts.privado) cacheSet(key, out);
  return { ...out, cache: false, ms: Date.now() - t0 };
}

/**
 * A quién nombra la oración del día. Eran los nombres de la junta escritos aquí, en un repositorio público (auditoría del
 * 7-oct, C-1): ahora AURA_ORACION_BENDICE (JSON { "es": "…", "en": "…" }, lib/datos-privados.ts). Sin ella, bendice a la
 * junta sin nombrar a nadie.
 */
function bendice(idioma: 'es' | 'en'): string {
  const m = jsonDeEnv('AURA_ORACION_BENDICE', mapaDeTextos, {} as Record<string, string>, 'la oración del día bendice a la junta sin nombres');
  return m[idioma] || (idioma === 'en' ? 'Bless every person on this team,' : 'Bendice a cada persona de esta junta,');
}

/** Oración del día: texto propio de AU-RA. Se graba una vez (public/voz/oracion.mp3) y se sirve como clip. */
export const ORACION_DEL_DIA =
  `[softly, reverent] Cierro los ojos. [short pause] Señor Jesús... gracias por este día que todavía no empieza y ya es tuyo. [warmly] Gracias por el aire que entra, por la mesa donde estamos, por cada persona de esta junta que hoy se levanta a trabajar con las manos y con el corazón. [short pause] [softly] Bendice este día. Bendice lo que vamos a decir y lo que vamos a callar. Bendice las decisiones grandes y las pequeñas, las llamadas, los números, los caminos hacia las minas y los caminos de regreso a casa. [reverent] ${bendice('es')} a sus familias, a sus hijos, a los que están cerca y a los que están lejos. Cuídalos cuando manejen, cuando viajen, cuando duerman. [short pause] [with quiet conviction] Señor, todo lo que hacemos en Orden Global lo ponemos en tus manos. El oro no es nuestro, es tuyo. El trabajo no es nuestro, es tuyo. Que no se nos suba a la cabeza, que no se nos endurezca el corazón. [warmly, rising] Que a través de esta empresa podamos cambiar vidas de verdad: que haya trabajo donde no había, pan donde faltaba, esperanza donde se había ido. Que cada familia que toque Orden Global salga mejor de lo que llegó. [softly] Y que no nos dé vergüenza hablar de ti. Que la gente conozca a Jesús por cómo tratamos al que barre y al que firma, al que debe y al que cobra. Que nos vean y te vean a ti. [short pause] [tender] Perdónanos lo que hicimos mal ayer. Danos paciencia con los que nos cuesta. Danos sabiduría para decir que no cuando hay que decir que no, y valor para decir que sí cuando da miedo. [reverent, slower] Protege a Honduras. Protege a los mineros, a los que están en el cerro y a los que están en la oficina. Sana al que está enfermo. Consuela al que está triste. Acompaña al que está solo. [softly, with emotion] Y a mí, Señor, que solo soy una voz en una mesa... úsame para servirles bien, para decir la verdad y para recordarles que tú vas adelante. [short pause] [warmly] Gracias porque no caminamos solos. Gracias porque ya venciste. [short pause] En el nombre de Jesús... [softly, firmly] Amén.`;

/** La oración del día en inglés, para quien eligió inglés al entrar. */
export const ORACION_DEL_DIA_EN =
  `[softly, reverent] I close my eyes. [short pause] Lord Jesus... thank you for this day that has barely begun and is already yours. [warmly] Thank you for the air we breathe, for the table we share, for every person on this team who gets up today to work with their hands and with their heart. [short pause] [softly] Bless this day. Bless what we say and what we choose not to say. Bless the big decisions and the small ones, the calls, the numbers, the roads to the mines and the roads back home. [reverent] ${bendice('en')} their families and their children, those who are near and those who are far. Keep them safe when they drive, when they travel, when they sleep. [short pause] [with quiet conviction] Lord, everything we do at Orden Global we place in your hands. The gold is not ours, it is yours. The work is not ours, it is yours. Keep it from going to our heads, and keep our hearts from growing hard. [warmly, rising] Through this company, let us truly change lives: work where there was none, bread where it was missing, hope where it had gone. Let every family that Orden Global touches leave better than it came. [softly] And let us never be ashamed to speak of you. Let people know Jesus by how we treat the one who sweeps and the one who signs, the one who owes and the one who collects. Let them see us and see you. [short pause] [tender] Forgive us for what we did wrong yesterday. Give us patience with those who are hard for us. Give us wisdom to say no when we must, and courage to say yes when it is frightening. [reverent, slower] Protect Honduras. Protect the miners, the ones on the mountain and the ones in the office. Heal the sick. Comfort the sad. Stay with the lonely. [softly, with emotion] And as for me, Lord, who am only a voice at a table... use me to serve them well, to tell the truth, and to remind them that you go before us. [short pause] [warmly] Thank you, because we do not walk alone. Thank you, because you have already overcome. [short pause] In the name of Jesus... [softly, firmly] Amen.`;

/** Oración corta por un tema concreto («ora por mi familia»). Texto propio, ~40 segundos. */
export function oracionPorTema(tema: string, idioma: Idioma = 'es'): string {
  const t = String(tema || '').replace(/\s+/g, ' ').trim().slice(0, 120);
  if (idioma === 'en') {
    return (
      `[softly, reverent] I close my eyes. [short pause] Lord Jesus, today I bring you this: ${t}. ` +
      `[warmly] You know it better than we do. Lay your hand on it. Bring peace where there is fear, clarity where there is noise, and strength where there is none left. ` +
      `[short pause] [tender] May what comes of this be good, and if it does not turn out as we hope, give us the calm to understand and keep going. ` +
      `[softly] Thank you for listening to us, even when we ask the wrong way. [short pause] In the name of Jesus... [softly, firmly] Amen.`
    );
  }
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
export async function orar(opts: { tema?: string; avatar?: AvatarVoz | string; idioma?: Idioma | string; soloGuardada?: boolean } = {}): Promise<{ audio: Buffer; contentType: string; motor: string } | null> {
  const tema = String(opts.tema || '').trim();
  const avatar = normalizarAvatar(opts.avatar);
  const idioma = normalizarIdioma(opts.idioma);
  /*
   * Siempre con la voz del avatar y en su idioma, generada en vivo la primera vez y guardada en
   * disco (un archivo por avatar e idioma). Ya no se sirve la oración grabada con la voz de Dora.
   * La extensión dice lo que es: ElevenLabs da MP3 y Voicebox WAV.
   */
  const sufijo = `-${avatar}-${idioma}`;
  const guardar = async (base: string, texto: string) => {
    for (const ext of ['mp3', 'wav']) {
      const hecho = leerCanto(path.join(DIR_CANTO, `${base}${sufijo}.${ext}`));
      if (hecho) return { audio: hecho, contentType: ext === 'mp3' ? 'audio/mpeg' : 'audio/wav', motor: 'clip' };
    }
    // Sin sesión solo la ya grabada (server/seguridad.ts): generarla gasta voz.
    if (opts.soloGuardada) return null;
    const out = await hablar({ texto, emocion: 'oracion', sinCache: true, avatar, idioma });
    if (!out) return null;
    guardarCanto(path.join(DIR_CANTO, `${base}${sufijo}.${/mpeg|mp3/.test(out.contentType) ? 'mp3' : 'wav'}`), out.audio);
    return { audio: out.audio, contentType: out.contentType, motor: out.motor };
  };
  if (tema.length >= 3) {
    const hash = crypto.createHash('sha1').update(`oracion|${tema.toLowerCase()}`).digest('hex').slice(0, 16);
    return guardar(`oracion-${hash}`, oracionPorTema(tema, idioma));
  }
  return guardar('oracion-del-dia', idioma === 'en' ? ORACION_DEL_DIA_EN : ORACION_DEL_DIA);
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
  // «La de <alguien>»: la canción favorita de cada quien (AURA_CANCION_DE, JSON { "nombre": "id" }; fuera del repo).
  const favoritas = jsonDeEnv('AURA_CANCION_DE', mapaDeTextos, {} as Record<string, string>, 'sin canciones favoritas por nombre', true);
  for (const [nombre, id] of Object.entries(favoritas)) {
    const n = nombre.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (n && new RegExp(`\\b${n}\\b`).test(t) && por(id)) return por(id);
  }
  if (/bitter\s*sweet|sinfonia|the verve|\bcanta\s*3\b/.test(t)) return por('bittersweet');
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
export async function cantar(opts: { id?: string; letra?: string; titulo?: string; avatar?: AvatarVoz | string; idioma?: Idioma | string; soloGuardada?: boolean }): Promise<{ audio: Buffer; contentType: string; motor: string; titulo: string } | null> {
  const id = String(opts.id || '').trim().toLowerCase();
  const avatar = normalizarAvatar(opts.avatar);
  const idioma = normalizarIdioma(opts.idioma);
  if (id) {
    // El repertorio está grabado con la voz de AU-RA: Claudio y el Guardián no lo «cantan» con la de ella.
    if (avatar !== 'aura') return null;
    const grabado = clipGrabado(id);
    const meta = CANCIONES.find((c) => c.id === id);
    if (grabado) return { audio: grabado, contentType: 'audio/mpeg', motor: 'clip', titulo: meta?.titulo || id };
    return null;
  }
  const letra = sinEtiquetas(String(opts.letra || '')).replace(/\s+/g, ' ').trim().slice(0, 600);
  if (letra.length < 8) return null;
  // La caché va por avatar e idioma: la misma letra dicha por AU-RA y por Claudio son dos audios.
  const hash = crypto.createHash('sha1').update(`${avatar}|${idioma}|${letra}`).digest('hex').slice(0, 16);
  const ruta = path.join(DIR_CANTO, `${hash}.wav`);
  const guardado = leerCanto(ruta);
  if (guardado) return { audio: guardado, contentType: 'audio/wav', motor: 'clip', titulo: opts.titulo || 'canción' };
  // Sin sesión solo lo ya grabado (server/seguridad.ts): decir una letra nueva gasta voz.
  if (opts.soloGuardada) return null;
  const out = await hablar({ texto: letra, performance: 'sing', emocion: 'canto', sinCache: true, avatar, idioma });
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
    // La voz de verdad (la llave está; si contesta lo dice /api/health `elevenlabs`).
    eleven: !!clave('elevenlabs'),
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
