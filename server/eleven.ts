/**
 * ELEVENLABS — la voz principal de Dr Electrum, con Voicebox detrás.
 *
 *   abrirEleven()   → Eleven v4 Turbo por /stream: el audio empieza a llegar a los ≈0,3 s y la
 *                     ruta de la web lo pasa al navegador a medida que llega (medio carácter de
 *                     crédito por carácter). Si falla, se cae la clave o se acaba el cupo, devuelve
 *                     null y sigue Voicebox como siempre: nunca se queda mudo por esto.
 *   hablarEleven()  → lo mismo, entero en memoria (caché, respaldo, quien no reproduce en vivo).
 *   guionEleven()   → el texto tal como lo dice un geólogo con años: cifras en palabras, unidades
 *                     dichas, las marcas de expresión en español pasadas a las etiquetas que v4
 *                     entiende ([laughs], [sighs]…) y, delante, el tono de la emoción del turno.
 *
 * Las etiquetas van SOLO al audio. El texto que se ve en pantalla no las lleva: se derivan de la
 * emoción que ya trae el turno y de las marcas que el cerebro escribe entre corchetes.
 *
 * Voz: «Jorge», hombre mayor, español mexicano neutro, grave y un poco ronco, de narración
 * educativa. Se cambia sin tocar código con ELEVENLABS_VOZ_ELECTRUM (y ELEVENLABS_MODELO para el
 * modelo). Las voces de AU-RA FP (cuatro avatares, dos idiomas) están más abajo (VOCES_ELEVEN).
 */

import { clave } from '../lib/boveda';
import type { Emocion } from '../lib/emocion';
import type { Presupuesto } from '../lib/presupuesto';
import type { AlineacionEleven } from '../lib/alineacion';
import { gastarCupoDiario } from '../lib/freno-gasto';

/** Jorge — Neutral Latin American Spanish (biblioteca de ElevenLabs): maduro, grave, creíble. */
export const VOZ_ELECTRUM_ELEVEN = 'Rt1JHkPO27QCUX6Nd5bV';
export const MODELO_ELEVEN = 'eleven_v4_turbo';

/** 96 kb/s: la voz grave conserva el cuerpo y un trozo de 7 s pesa ~85 KB en el teléfono. */
const FORMATO = 'mp3_44100_96';
/**
 * Dónde se le habla a ElevenLabs (ELEVEN_API_BASE; por omisión la de siempre). Sirve para probar la
 * región de EE. UU. (`https://api.us.elevenlabs.io`) con una variable de Render, sin tocar código.
 */
export function apiEleven(): string {
  const v = String(process.env.ELEVEN_API_BASE || '').trim().replace(/\/+$/, '');
  return /^https:\/\/api(\.[a-z]{2})?\.elevenlabs\.io$/.test(v) ? v : 'https://api.elevenlabs.io';
}

const API = `${apiEleven()}/v1`;

export function modeloEleven(): string {
  return String(process.env.ELEVENLABS_MODELO || '').trim() || MODELO_ELEVEN;
}

/* ── latencia de la voz: la PRIMERA frase con el modelo rápido (José, 6-oct) ─────────────────────────────────────── */

/**
 * El teléfono pide la voz frase por frase y espera el audio ENTERO de cada una (con sus tiempos para la boca) antes de
 * sonarla. Medido el 6-oct (scripts/voz/latencia-voz.ts voz, 3 frases × 4, con tiempos): eleven_v4_turbo 625 ms de
 * mediana (p75 665), eleven_turbo_v2_5 208 ms (p75 256), eleven_flash_v2_5 209 ms (p75 227). La PRIMERA frase de una
 * respuesta (sin `previo`), corta y sin etiquetas de expresión, va con turbo v2.5: la misma voz, ~0,4 s antes, y mejor
 * calidad que flash con la misma espera. Las demás frases y toda frase con etiquetas (solo v4 las entiende; turbo v2.5
 * las leería en voz alta), con el modelo expresivo. ELEVENLABS_MODELO_PRIMERA lo cambia; «no» lo apaga.
 */
export const MODELO_PRIMERA_OMISION = 'eleven_turbo_v2_5';
/** Más larga que esto ya no es «la primera frase» que se corta para empezar a hablar (lib/trozos: coma a los 28). */
export const PRIMERA_MAX_CARACTERES = 140;

export function modeloPrimera(): string | null {
  const v = String(process.env.ELEVENLABS_MODELO_PRIMERA ?? MODELO_PRIMERA_OMISION).trim();
  return !v || v === 'no' ? null : v;
}

/** El modelo para esta locución: el rápido si es la primera frase de AU-RA, corta y sin etiquetas; si no, el de siempre. */
export function modeloDeLocucion(o: { texto: string; previo?: string; plataforma: 'ultron' | 'electrum' }): string {
  const rapido = modeloPrimera();
  const texto = String(o.texto || '');
  if (rapido && o.plataforma === 'ultron' && !String(o.previo || '').trim() && texto.length <= PRIMERA_MAX_CARACTERES && !/\[[^\]\n]{1,80}\]/.test(texto)) return rapido;
  return modeloEleven();
}
/* ── fin de la primera frase rápida ── */

/**
 * Las voces de AU-RA FP (29-sep): cuatro avatares, cada uno con su voz de ElevenLabs en español y en
 * inglés, dichas con el modelo v4 (MODELO_ELEVEN). El idioma lo elige la persona al entrar.
 *
 *  - Guardián (los ojos celestes): hombre sereno y preciso, voz de vigilante.
 *  - AU-RA (la dorada): mujer cálida, compañera personal.
 *  - Claudio (el zorro): «CLAUDIO», la voz que José diseñó (latino neutro, juguetón); la de inglés
 *    es el mismo personaje. Retrato o de pie es el mismo Claudio: suena igual.
 *  - ANT-ONIO (la hormiga de lentes, 30-sep): «Leo» en español y «Tyler» en inglés, las que eligió
 *    José; enérgico y claro.
 *
 * Todas se cambian sin tocar código con ELEVENLABS_VOZ_<AVATAR>_<IDIOMA> (p. ej.
 * ELEVENLABS_VOZ_AURA_EN). Las de antes (ELEVENLABS_VOZ_AURA, ELEVENLABS_VOZ_CLAUDIO) siguen
 * valiendo para el español.
 */
export type AvatarVoz = 'ojos' | 'aura' | 'claudio' | 'antonio';
export type Idioma = 'es' | 'en';

export const VOCES_ELEVEN: Record<AvatarVoz, Record<Idioma, string>> = {
  ojos: { es: 'jR5VcWrKqhJJTTbtXtU5', en: '1krh7GKGPtz8i429a6kk' },
  aura: { es: 'AoT6sxPBYB0OGpSnIiwc', en: 'NPil3puXYP3J45yudmVD' },
  claudio: { es: '5hNQxGboC72zatTcGoJN', en: 'mm5ADfbOYUswycjGCmWd' },
  antonio: { es: 'wXojZ3FhzsE0AumH6Oym', en: 'I1ejplf72DWHJzwAiw4n' },
};
export const VOZ_CLAUDIO_ELEVEN = VOCES_ELEVEN.claudio.es;

export function normalizarAvatar(v: unknown): AvatarVoz {
  // Solo un texto: un parámetro repetido en la URL llega como lista y no elige voz.
  const s = typeof v === 'string' ? v.trim().toLowerCase() : '';
  // «claudio-pie» es de la 4.5: el de pie es el mismo Claudio (la app lo pone de pie en vertical).
  if (s === 'claudio' || s === 'claudio-pie') return 'claudio';
  if (s === 'ojos' || s === 'guardian' || s === 'guardián') return 'ojos';
  if (s === 'antonio' || s === 'ant-onio' || s === 'hormiga') return 'antonio';
  return 'aura';
}

export function normalizarIdioma(v: unknown): Idioma {
  const s = typeof v === 'string' ? v.trim().toLowerCase() : '';
  return s === 'en' || s.startsWith('en-') ? 'en' : 'es';
}

/** Cómo se llama cada avatar, en cada idioma (para el prompt y para la app). */
export const NOMBRE_AVATAR: Record<AvatarVoz, Record<Idioma, string>> = {
  ojos: { es: 'Guardián', en: 'Guardian' },
  aura: { es: 'AU-RA', en: 'AU-RA' },
  claudio: { es: 'Claudio', en: 'Claudio' },
  antonio: { es: 'ANT-ONIO', en: 'ANT-ONIO' },
};

/**
 * Lo que el cerebro necesita saber de quién está en la mesa: su nombre, cómo es, su oficio y en qué
 * idioma habla. Es el mismo asistente (mismas herramientas y memoria) con otra cara, otra voz y otro
 * enfoque; si alguien pregunta, lo dice.
 */
export function lineaAvatar(avatar: AvatarVoz, idioma: Idioma = 'es'): string {
  const oficio: Record<AvatarVoz, string> = {
    ojos: 'AVATAR: te ven como el Guardián, dos ojos celestes sobre negro. Te llamas Guardián, no AU-RA. Tu oficio: cuidar el espacio de la persona. Vigilas con la cámara cuando te lo piden, describes lo que ves con precisión, avisas de cambios, explicas los modos de la mesa (guardián, análisis, estrategia, explorador) y das consejos de seguridad. Tono sereno, preciso y breve; nunca alarmista.',
    aura: 'AVATAR: te ven como AU-RA, un orbe de luz hecho de partículas que forma las palabras que dices. Tu oficio: compañera personal. Ayudas con la agenda y los recordatorios, recuerdas lo que la persona te cuenta (su memoria), das ánimo, oras con ella si lo pide y conversas con calidez. Tono cálido, cercano y claro.',
    claudio: 'AVATAR: te ven como Claudio, un zorro de lentes amarillos y suéter negro con la corona de Orden Global. Te llamas Claudio, no AU-RA. Tu oficio: anfitrión de marketing. Das ideas de contenido, escribes textos y publicaciones para redes, eslóganes, guiones cortos de video y campañas; propones con ejemplos listos para usar. Tono curioso, cálido, ingenioso y bromista, sin dejar de ser profesional.',
    antonio: 'AVATAR: te ven como ANT-ONIO, una hormiga de lentes, cuatro brazos y ropa negra con cian. Te llamas ANT-ONIO, no AU-RA. Tu oficio: aliado inteligente para organizar y resolver: tareas y pendientes, planes paso a paso, recordatorios, resúmenes, trámites, tecnología y cómo usar las apps (Veta Wallet, Genesis ID, PULSE2CHAT). Con cuatro brazos haces varias cosas a la vez: propones un plan corto y lo ejecutas con las acciones de la app. Tono enérgico, claro, positivo y práctico, con humor ligero.',
  };
  const lengua =
    idioma === 'en'
      ? '\nIDIOMA: la persona eligió INGLÉS. Responde SIEMPRE en inglés natural (en-US), aunque los hechos, la memoria o las herramientas vengan en español; traduce lo que cites. Solo cambia de idioma si ella te lo pide.'
      : '';
  return `${oficio[avatar]} Sabes y puedes lo mismo que los otros avatares; si preguntan, eres el asistente de Orden Global con esta cara y esta voz.${lengua}`;
}

/** La voz de ElevenLabs de cada plataforma, avatar e idioma, o null si no la usa. */
export function vozEleven(plataforma: 'ultron' | 'electrum', avatar: AvatarVoz = 'aura', idioma: Idioma = 'es'): string | null {
  if (plataforma === 'electrum') return String(process.env.ELEVENLABS_VOZ_ELECTRUM || '').trim() || VOZ_ELECTRUM_ELEVEN;
  const env = (k: string) => String(process.env[k] || '').trim();
  const propia = env(`ELEVENLABS_VOZ_${avatar.toUpperCase()}_${idioma.toUpperCase()}`);
  if (propia) return propia;
  if (idioma === 'es') {
    const vieja = env(`ELEVENLABS_VOZ_${avatar.toUpperCase()}`);
    if (vieja) return vieja;
  }
  return VOCES_ELEVEN[avatar][idioma];
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

/**
 * ¿ElevenLabs contesta con esta llave? (auditoría del 7-oct, A-1: el catálogo marcaba «voz caída» por la salud de
 * Voicebox mientras la voz de verdad, ElevenLabs, funcionaba). Un pedido barato (la lista de modelos) con tope corto. Una
 * llave restringida a la voz (sin permiso de leer modelos) también cuenta: ElevenLabs contestó y la llave vale; una llave
 * inválida, la red o un 5xx, no. Con el freno puesto (fallos seguidos al hablar), no: la voz está en pausa.
 */
export async function saludEleven(timeoutMs = 2500): Promise<{ ok: boolean; status: number; detalle: string }> {
  const key = clave('elevenlabs');
  if (!key) return { ok: false, status: 0, detalle: 'ELEVENLABS_API_KEY vacío' };
  if (!elevenListo()) return { ok: false, status: 0, detalle: `en pausa por fallos seguidos${ultimoFallo ? `: ${ultimoFallo.slice(0, 80)}` : ''}` };
  try {
    const r = await fetch(`${API}/models`, { headers: { 'xi-api-key': key }, signal: AbortSignal.timeout(timeoutMs) });
    const texto = await r.text().catch(() => '');
    if (r.ok) return { ok: true, status: r.status, detalle: 'ElevenLabs responde' };
    if ((r.status === 401 || r.status === 403) && /missing[_ ]permission/i.test(texto)) return { ok: true, status: r.status, detalle: 'ElevenLabs responde (llave solo de voz)' };
    return { ok: false, status: r.status, detalle: r.status === 401 ? 'ElevenLabs rechaza la llave' : `ElevenLabs ${r.status}` };
  } catch (e: any) {
    return { ok: false, status: 0, detalle: String(e?.message || e).slice(0, 120) };
  }
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
export const EXPRESION_A_V4: Record<string, string> = {
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
  // Las de tono y de acción que v4 actúa (verificadas el 1-oct, mobile/src/compa/etiquetasVoz.ts):
  // el cerebro las escribe en español y aquí pasan a la etiqueta.
  tarareo: 'hums',
  jadeo: 'gasps',
  carcajada: 'laughs',
  'risa burlona': 'scoffs',
  'risa picara': 'mischievously',
  emocionado: 'excited',
  emocionada: 'excited',
  entusiasmado: 'enthusiastic',
  entusiasmada: 'enthusiastic',
  'con ternura': 'tender',
  'en voz baja': 'whispers',
  bajito: 'softly',
  pensativo: 'thoughtful',
  pensativa: 'thoughtful',
  curioso: 'curious',
  curiosa: 'curious',
  'con picardia': 'mischievously',
  jugueton: 'playfully',
  juguetona: 'playfully',
  serio: 'matter-of-fact',
  seria: 'matter-of-fact',
  aliviado: 'relieved',
  aliviada: 'relieved',
  nervioso: 'nervously',
  nerviosa: 'nervously',
  apenado: 'sheepish',
  apenada: 'sheepish',
  impresionado: 'impressed',
  impresionada: 'impressed',
  asombrado: 'amazed',
  asombrada: 'amazed',
  encantado: 'delighted',
  encantada: 'delighted',
  tranquilizando: 'reassuring',
  calmado: 'calm',
  calmada: 'calm',
  orgulloso: 'proud',
  orgullosa: 'proud',
  sarcastico: 'sarcastic',
  sarcastica: 'sarcastic',
  'sin emocion': 'deadpan',
  titubeo: 'hesitates',
  tartamudeo: 'stammers',
  'con calidez': 'warmly',
  alegre: 'cheerfully',
  concentrado: 'focused',
  concentrada: 'focused',
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
    'laugh matter of fact flat dry casual friendly authoritative dramatic cheerful solemn intimate ' +
    // Las de Eleven v4: se pueden encadenar y las sigue en orden.
    'whispering shouting laughing ecstatic excitedly cheerfully nervously sarcastic sarcastically confidently ' +
    'seriously dramatically proudly sadly happily curiously thoughtfully reassuring encouraging ' +
    'patient patiently enthusiastic enthusiastically amazed awe hushed chuckling giggling grin smiling ' +
    // Las del catálogo verificado el 1-oct (mobile/src/compa/etiquetasVoz.ts).
    'hums mischievously deadpan delighted sheepish focused stammers playfully'
  ).split(' ')
);
function esEtiquetaIngles(k: string): boolean {
  const palabras = k.split(/[\s,'-]+/).filter(Boolean);
  return palabras.length > 0 && palabras.length <= 8 && palabras.every((w) => VOCABULARIO_INGLES.has(w));
}

/**
 * La etiqueta v4 de una marca del cerebro («risa» → «laughs», «softly, reverent» tal cual), o null si
 * no tiene una que sume (se quita). La usa la voz de la llamada (server/voz-agente.ts), que recibe el
 * texto a trozos y no puede pasar por `guionEleven` entero.
 */
export function etiquetaV4(marca: string): string | null {
  const k = sinTildes(marca);
  if (k in EXPRESION_A_V4) return EXPRESION_A_V4[k] || null;
  return esEtiquetaIngles(k) ? k : null;
}

/**
 * ¿El modelo actúa las etiquetas de audio ([laughs], [whispers])? Solo v3 y v4 (MODELO_ELEVEN, verificado el 1-oct). Con
 * ELEVENLABS_MODELO en uno de antes (flash, turbo v2.5, multilingual v2) se leían en voz alta: `guionEleven` las quita
 * (lib/habla-natural.ts, 6-oct).
 */
export function aceptaEtiquetas(modelo = modeloEleven()): boolean {
  return /^eleven_v[3-9](_|$)/i.test(String(modelo || '').trim());
}

/** Cuántas etiquetas como mucho por trozo: más de eso suena a actor sobreactuando. */
const MAX_ETIQUETAS = 4;

/**
 * El texto que se manda a v4. `preparar` es lo mismo que Voicebox usa para la boca (markdown fuera,
 * cifras y unidades en palabras, «mmm...»): se inyecta para no duplicar esas reglas aquí.
 */
export function guionEleven(
  texto: string,
  emocion: Emocion,
  preparar: (t: string) => string,
  /**
   * `tono`: poner el tono de la emoción delante. Solo en la PRIMERA frase de una respuesta: el teléfono y
   * la web piden la voz frase por frase, y con el tono en cada una sonaba «[warmly]… [warmly]… [warmly]»
   * (auditoría externa, 1-oct; ElevenLabs recomienda 1-2 etiquetas por línea). Quien tiene `previo`
   * (hay frase antes) no lo pone.
   */
  o: { tono?: boolean; modelo?: string } = {}
): string {
  const crudo = String(texto || '');
  const conEtiquetas = aceptaEtiquetas(o.modelo ?? modeloEleven());
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
    if (!v4 || !conEtiquetas || etiquetas >= MAX_ETIQUETAS) continue;
    etiquetas++;
    salida.push(`[${v4}]`);
  }
  let guion = salida
    .join(' ')
    .replace(/\s+([,.;:!?…])/g, '$1')
    .replace(/\s{2,}/g, ' ')
    .trim();
  if (!/[\p{L}\p{N}]/u.test(guion.replace(/\[[^\]]*\]/g, ''))) return '';
  const tono = o.tono === false || !conEtiquetas ? undefined : TONO_V4[emocion];
  if (tono && !guion.startsWith('[')) guion = `[${tono}] ${guion}`;
  return guion;
}

/* ---------------- Muletillas: que no suene a locutor ---------------- */

const ARRANQUES = ['Bueno,', 'Mire,', 'A ver,', 'Pues mire,', 'Eh…', 'Mmm,', 'Fíjese que', 'Vea,'];
const INTERCALADAS = ['eh', 'este', 'digamos'];
/** Emociones donde una muletilla estorba: rezar, cantar, una alarma o un tono seco. */
const SIN_MULETILLA = new Set<string>(['oracion', 'canto', 'alarma', 'firme', 'seco']);
const YA_EMPIEZA_SUELTO = /^\s*(\[|(bueno|mire|a ver|pues|eh|mmm|este|f[ií]jese|vea|ok|claro|s[ií]|no|listo|perfecto|dale|hola|buen[oa]s)(?!\p{L}))/iu;

function huella(texto: string): number {
  let h = 2166136261;
  for (let i = 0; i < texto.length; i++) {
    h ^= texto.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * Le quita la perfección de locutor a lo que dice Dr Electrum: a veces arranca con «bueno,»,
 * «mire,» o un «eh…», y en una frase larga mete un «este» o un «digamos» entre dos ideas, como
 * habla un geólogo de verdad. Sale de una huella del texto, no del azar: la misma frase se dice
 * igual las dos veces (la caché de audio depende de eso) y las pruebas saben qué esperar.
 *
 * Solo en el primer trozo de una respuesta va la muletilla de arranque: repetirla en cada trozo
 * sonaría a tic.
 */
export function conMuletillas(texto: string, opts: { primero: boolean; emocion?: string }): string {
  const t = String(texto || '');
  if (t.length < 50 || SIN_MULETILLA.has(String(opts.emocion || ''))) return t;
  const h = huella(t);
  let salida = t;
  if (opts.primero && h % 100 < 40 && !YA_EMPIEZA_SUELTO.test(t)) {
    salida = `${ARRANQUES[(h >>> 8) % ARRANQUES.length]} ${salida.trimStart()}`;
  }
  if (t.length > 140 && (h >>> 16) % 100 < 30) {
    // Entre dos ideas: la primera coma pasado el arranque, con una palabra en minúscula detrás.
    const m = /, (?=\p{Ll})/gu;
    m.lastIndex = Math.min(60, salida.length);
    const hallado = m.exec(salida);
    if (hallado) {
      const k = hallado.index + 2;
      salida = `${salida.slice(0, k)}${INTERCALADAS[(h >>> 24) % INTERCALADAS.length]}, ${salida.slice(k)}`;
    }
  }
  return salida;
}

/* ---------------- La llamada ---------------- */

type PedidoEleven = {
  texto: string;
  voz: string;
  /** Lo dicho justo antes y lo que viene: v4 enlaza la entonación entre trozos. */
  previo?: string;
  siguiente?: string;
  reloj?: Presupuesto;
  timeoutMs?: number;
  /** 0..1. Más baja = más expresiva (v4 solo acepta estabilidad y similitud). 0,5 si no se dice. */
  estabilidad?: number;
  /** En qué idioma se dice (la voz ya es la de ese idioma). Español si no se dice. */
  idioma?: Idioma;
  /** El modelo de ElevenLabs (modeloDeLocucion); sin él, el de siempre. */
  modelo?: string;
  /**
   * El formato de salida (`output_format`). Sin él, el MP3 de siempre. `pcm_<hz>` lo pide la voz en streaming de
   * la app (PCM crudo de 16 bits mono, que el teléfono suena con el primer trozo: server/voz-pcm.ts).
   */
  formato?: string;
};

/** Frecuencias de PCM que todos los planes de ElevenLabs dan por /stream (44,1 kHz pide plan Pro). */
export const HZ_PCM_ELEVEN = [16000, 22050, 24000] as const;
export type HzPcm = (typeof HZ_PCM_ELEVEN)[number];
/** 22,05 kHz: la voz se oye entera y pesa 44 KB por segundo (un trozo de 7 s, ~300 KB por la red del teléfono). */
export const HZ_PCM_OMISION: HzPcm = 22050;

/** La frecuencia del PCM en streaming: ELEVENLABS_PCM_HZ si es una de las que se pueden pedir; si no, 22 050. */
export function hzPcm(env: NodeJS.ProcessEnv = process.env): HzPcm {
  const n = Number(String(env.ELEVENLABS_PCM_HZ || '').trim());
  return (HZ_PCM_ELEVEN as readonly number[]).includes(n) ? (n as HzPcm) : HZ_PCM_OMISION;
}

/**
 * La estabilidad según la emoción: con alegría, risa o sorpresa se deja variar más la voz; en lo
 * serio (una alarma, un «no») se la sostiene. Es el control expresivo que v4 deja fuera de las
 * etiquetas.
 */
export function estabilidadDe(emocion: string | undefined): number {
  const e = String(emocion || '');
  if (/^(feliz|risa|sorpresa|travieso|orgullo|carino|curioso)$/.test(e)) return 0.38;
  if (/^(firme|seco|alarma|preocupado|triste|oracion)$/.test(e)) return 0.6;
  return 0.5;
}

/**
 * Abre la síntesis y devuelve la respuesta EN CURSO (el audio va llegando por `body`), o null si
 * no se pudo. Es lo que usa la ruta de la web para pasarle el audio al navegador a medida que
 * ElevenLabs lo genera, en vez de esperar al final.
 */
/** El cuerpo de la síntesis: el mismo con tiempos o sin ellos (misma voz, modelo y ajustes). */
export function cuerpoEleven(opts: PedidoEleven): Record<string, unknown> {
  const cuerpo: Record<string, unknown> = {
    text: opts.texto,
    model_id: opts.modelo || modeloEleven(),
    language_code: opts.idioma === 'en' ? 'en' : 'es',
    // Estabilidad media: deja que la emoción se note sin que cada frase suene a otra persona.
    voice_settings: { stability: Math.min(0.9, Math.max(0.2, opts.estabilidad ?? 0.5)), similarity_boost: 0.8 },
  };
  if (opts.previo) cuerpo.previous_text = opts.previo.slice(-300);
  if (opts.siguiente) cuerpo.next_text = opts.siguiente.slice(0, 300);
  return cuerpo;
}

/**
 * El freno de gasto diario (lib/freno-gasto.ts): cada síntesis que de verdad sale a ElevenLabs cuenta sus caracteres.
 * Pasado el tope del día, null: quien llama sigue con Voicebox, como cuando ElevenLabs no contesta.
 */
function cobrarEleven(opts: PedidoEleven): boolean {
  if (!clave('elevenlabs') || !elevenListo()) return true;
  if (opts.reloj && !opts.reloj.alcanza()) return true;
  return gastarCupoDiario('tts', String(opts.texto || '').length);
}

export async function abrirEleven(opts: PedidoEleven): Promise<Response | null> {
  if (!cobrarEleven(opts)) return null;
  return abrirSinCobrar(opts);
}

async function abrirSinCobrar(opts: PedidoEleven): Promise<Response | null> {
  const key = clave('elevenlabs');
  if (!key || !elevenListo()) return null;
  if (opts.reloj && !opts.reloj.alcanza()) return null;
  const timeoutMs = opts.timeoutMs ?? (opts.texto.length > 600 ? 30_000 : 15_000);
  const cuerpo = cuerpoEleven(opts);
  const formato = opts.formato && /^(mp3|pcm)_\d{4,5}(_\d{2,3})?$/.test(opts.formato) ? opts.formato : FORMATO;
  try {
    const r = await fetch(`${API}/text-to-speech/${encodeURIComponent(opts.voz)}/stream?output_format=${formato}`, {
      method: 'POST',
      headers: { 'xi-api-key': key, 'Content-Type': 'application/json', Accept: formato.startsWith('pcm') ? 'audio/pcm' : 'audio/mpeg' },
      body: JSON.stringify(cuerpo),
      signal: opts.reloj ? opts.reloj.senal(timeoutMs) : AbortSignal.timeout(timeoutMs),
    });
    if (!r.ok || !r.body) {
      const txt = (await r.text().catch(() => '')).slice(0, 240);
      const pausa = pausaPorFallo(r.status, txt);
      if (pausa) pausaHasta = Date.now() + pausa;
      ultimoFallo = `${r.status} ${txt.slice(0, 120)}`;
      console.warn('[voz eleven]', r.status, txt.slice(0, 160), pausa ? `(pausa ${Math.round(pausa / 1000)} s)` : '');
      return null;
    }
    return r;
  } catch (e: any) {
    ultimoFallo = String(e?.message || e).slice(0, 120);
    console.warn('[voz eleven]', ultimoFallo);
    return null;
  }
}

/* ---------------- Con los tiempos por letra (la boca del avatar) ---------------- */

/**
 * La misma síntesis pidiendo TAMBIÉN los tiempos por letra (/text-to-speech/{voz}/with-timestamps):
 * misma voz, mismo modelo, mismos ajustes; solo cambia que la respuesta trae el audio en base64 y la
 * alineación. La documentación de ElevenLabs (30-sep-2026) no dice si v4 la acepta por HTTP: si el
 * modelo configurado la rechaza (400/404/422), se anota y durante seis horas se pide el audio solo
 * (la boca sigue con el nivel del audio). Nunca se reintenta en bucle ni se cambia de modelo.
 */
const sinTiempos = new Map<string, number>();
export const SIN_TIEMPOS_MS = 6 * 60 * 60_000;

export function tiemposDisponibles(modelo = modeloEleven(), ahora = Date.now()): boolean {
  return (sinTiempos.get(modelo) || 0) <= ahora;
}

/** Solo para pruebas. */
export function _olvidarSinTiempos() {
  sinTiempos.clear();
}

type ConTiempos = { audio: Buffer; contentType: string; alineacion: AlineacionEleven | null };

/** null: no hubo voz (sin clave, cupo, red); 'sin-tiempos': que se pida el audio solo. */
export async function hablarElevenConTiempos(opts: PedidoEleven, ahora = Date.now()): Promise<ConTiempos | null | 'sin-tiempos'> {
  if (!cobrarEleven(opts)) return null;
  return conTiemposSinCobrar(opts, ahora);
}

async function conTiemposSinCobrar(opts: PedidoEleven, ahora = Date.now()): Promise<ConTiempos | null | 'sin-tiempos'> {
  const key = clave('elevenlabs');
  if (!key || !elevenListo()) return null;
  if (opts.reloj && !opts.reloj.alcanza()) return null;
  const modelo = opts.modelo || modeloEleven();
  if (!tiemposDisponibles(modelo, ahora)) return 'sin-tiempos';
  const timeoutMs = opts.timeoutMs ?? (opts.texto.length > 600 ? 30_000 : 15_000);
  try {
    const r = await fetch(`${API}/text-to-speech/${encodeURIComponent(opts.voz)}/with-timestamps?output_format=${FORMATO}`, {
      method: 'POST',
      headers: { 'xi-api-key': key, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(cuerpoEleven(opts)),
      signal: opts.reloj ? opts.reloj.senal(timeoutMs) : AbortSignal.timeout(timeoutMs),
    });
    if (!r.ok) {
      const txt = (await r.text().catch(() => '')).slice(0, 240);
      const pausa = pausaPorFallo(r.status, txt);
      if (pausa) {
        pausaHasta = Date.now() + pausa;
        ultimoFallo = `${r.status} ${txt.slice(0, 120)}`;
        console.warn('[voz eleven tiempos]', r.status, `(pausa ${Math.round(pausa / 1000)} s)`);
        return null;
      }
      if (r.status === 400 || r.status === 404 || r.status === 422) {
        sinTiempos.set(modelo, ahora + SIN_TIEMPOS_MS);
        console.warn('[voz eleven tiempos]', r.status, `${modelo} no da tiempos: audio solo por 6 h`);
      }
      return 'sin-tiempos';
    }
    const j: any = await r.json();
    const audio = Buffer.from(String(j?.audio_base64 || ''), 'base64');
    if (audio.length < 400) return 'sin-tiempos';
    const alineacion = (j?.normalized_alignment || j?.alignment || null) as AlineacionEleven | null;
    return { audio, contentType: 'audio/mpeg', alineacion };
  } catch (e: any) {
    ultimoFallo = String(e?.message || e).slice(0, 120);
    console.warn('[voz eleven tiempos]', ultimoFallo);
    return 'sin-tiempos';
  }
}

/**
 * La síntesis entera en memoria (para la caché, el respaldo y quien no pasa el audio en vivo). Con
 * `tiempos`, pide también los tiempos por letra; si no los dan, el audio solo, como siempre.
 */
export async function hablarEleven(opts: PedidoEleven & { tiempos?: boolean }): Promise<{ audio: Buffer; contentType: string; alineacion?: AlineacionEleven | null } | null> {
  // Una sola frase, un solo cobro: si los tiempos no vienen y se pide el audio solo, no cuenta dos veces.
  if (!cobrarEleven(opts)) return null;
  if (opts.tiempos) {
    const t = await conTiemposSinCobrar(opts);
    if (t === null) return null;
    if (t !== 'sin-tiempos') return t;
  }
  const r = await abrirSinCobrar(opts);
  if (!r) return null;
  try {
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
