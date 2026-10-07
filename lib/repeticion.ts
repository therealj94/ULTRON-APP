/**
 * QUE NO SE REPITA (José, 7-oct, 00:32–00:33 UTC, mesa de AU-RA: «está loco repitiendo las cosas»). A las 00:32:42 dijo un
 * párrafo («Je, sí, me cambié de ropa… ¿Qué tenemos pendiente? Ah, sí: te quedó pendiente…») y a las 00:33:14, a «Me
 * cambió a Claudio.», EXACTAMENTE el mismo párrafo otra vez. El modelo copió su respuesta anterior y nada lo paraba.
 *
 * REVISIÓN INDEPENDIENTE (7-oct, G1): la primera versión medía por trigramas sueltos (60 % de una frase) y borraba
 * respuestas CORREGIDAS o ACTUALIZADAS: el borrador «… la reunión de mañana» contra «… de hoy», «agrégale perdón», el oro
 * a 2.460 contra 2.450, la cita del martes contra la del lunes; y en su lugar decía «Eso ya te lo dije» (falso). Ahora el
 * principio es: ante la duda, la guarda NO actúa; nunca dice algo falso.
 *  · solo quita frases IDÉNTICAS o casi idénticas (UMBRAL_FRASE de trigramas en las dos direcciones) a una frase que ya
 *    dijo, y con los MISMOS datos (`datosDe`: números en cifras o en palabras, días, fechas y horas, nombres propios, lo
 *    citado entre comillas y la negación). Una frase con un dato distinto dice algo nuevo: se queda;
 *  · si la respuesta y una anterior parecida tienen datos distintos en las dos direcciones (cambió uno por otro), es una
 *    corrección o una actualización, no una repetición: no se toca nada;
 *  · un borrador o una acción para la app (citas «…» con «¿Lo envío?», ACCION_APP; y quien llama pasa `conBorrador` con
 *    el estado del turno) nunca se toca: lo que se va a mandar tiene que oírse entero;
 *  · si sin lo repetido no queda nada (`vacia`), quien llama deja la respuesta tal cual o, en la voz, pide UNA segunda
 *    vuelta breve a lo nuevo; nunca la reemplaza por «ya te lo dije»;
 *  · `vaRepitiendo`: para el stream de la voz, solo si la respuesta ENTERA va camino de ser repetición se retiene lo que
 *    falta (una frase repetida suelta no frena el resto);
 *  · lo que se compara son sus últimas respuestas del hilo que va al modelo (`previasDe`): lo que el modelo tiene a la
 *    vista y puede copiar;
 *  · si la persona PIDE que repita («¿me lo repites?», «¿cómo?», «¿perdón?», «no te oí») o vuelve a preguntar lo mismo,
 *    no se toca nada (`pideRepetir`, `mismaPreguntaQue`): ahí la misma respuesta es la correcta.
 */

export const MIN_PALABRAS = 5;
/** De una frase: qué tan igual tiene que ser a una frase ya dicha (trigramas comunes sobre los de la más larga). */
export const UMBRAL_FRASE = 0.9;
/** De la respuesta: qué parte de sus frases medibles ya dichas la hace «repetición». */
export const UMBRAL_RESPUESTA = 0.5;
/** Y al menos tantas palabras repetidas: una frase corta que se parece («Claro, te cuento del proyecto.») no es repetirse. */
export const MIN_PALABRAS_REPETIDAS = 10;
/** Cuántas respuestas anteriores se miran. */
export const RESPUESTAS_MIRADAS = 3;
/** Desde qué parecido una respuesta anterior habla de lo mismo y se comparan sus datos (¿corrección?). */
const PARECIDO_TEMA = 0.3;

const plano = (s: string) =>
  String(s || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\[[^\]]{0,40}\]/g, ' ')
    .toLowerCase()
    .replace(/[^a-z0-9ñ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const palabras = (s: string) => plano(s).split(' ').filter(Boolean).length;

/** Las frases de un texto con su puntuación (unidas con '' devuelven el texto). «2.460» no se parte en el punto. */
export function frasesDe(texto: string): string[] {
  return String(texto || '').match(/(?:[^.!?…\n]|(?<=\d)\.(?=\d))+(?:[.!?…]+|\n+|$)\s*/g)?.filter((f) => f.length) || [];
}

function trigramas(ps: string[]): Set<string> {
  const out = new Set<string>();
  for (let i = 0; i + 2 < ps.length; i++) out.add(`${ps[i]} ${ps[i + 1]} ${ps[i + 2]}`);
  return out;
}

/* ------------------------------------------------------------------ los datos que no pueden cambiar */

const RE_NUMERO =
  /^(uno|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|once|doce|trece|catorce|quince|dieci\w+|veinte|veinti\w+|treinta|cuarenta|cincuenta|sesenta|setenta|ochenta|noventa|cien|ciento|\w+cient[oa]s|quinient[oa]s|mil|millon|millones|medio|media|cuarto|primer[oa]?|segund[oa]|tercer[oa]?|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|twenty|thirty|forty|fifty|hundred|thousand|million|half)$/;
const RE_TIEMPO =
  /^(hoy|manana|ayer|anoche|anteayer|pasado|proxim[oa]|siguiente|tarde|noche|mediodia|medianoche|madrugada|lunes|martes|miercoles|jueves|viernes|sabado|domingo|enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre|semana|mes|today|tomorrow|yesterday|tonight|morning|afternoon|evening|monday|tuesday|wednesday|thursday|friday|saturday|sunday|january|february|march|april|june|july|august|september|october|november|december|week|month)$/;
/** La negación cambia lo que dice («sí tengo acceso» / «no tengo acceso»). */
const RE_POLARIDAD = /^(no|nunca|jamas|tampoco|todavia|not|never)$/;
const RE_CITA = /[«“"]([^«»“”"]{1,500})[»”"]/g;

/**
 * Lo que distingue una frase de su corrección: números (cifras o palabras; «2.460» = «2460»), días, fechas y horas,
 * nombres propios (con mayúscula y no al principio de la frase), lo citado entre comillas y la negación.
 */
export function datosDe(texto: string): Set<string> {
  const out = new Set<string>();
  const t = String(texto || '');
  for (const m of t.matchAll(RE_CITA)) out.add(`cita:${plano(m[1])}`);
  for (const m of t.matchAll(/\d+(?:[.,:]\d+)*/g)) out.add(`n:${m[0].replace(/[.,](?=\d{3}\b)/g, '').replace(',', '.')}`);
  for (const w of plano(t).split(' ')) {
    if (RE_NUMERO.test(w)) out.add(`n:${w}`);
    else if (RE_TIEMPO.test(w)) out.add(`t:${w}`);
    else if (RE_POLARIDAD.test(w)) out.add(`neg:${w}`);
  }
  // Los nombres propios, frase por frase y sin lo citado (adentro de una cita, la primera palabra va con mayúscula).
  for (const f of frasesDe(t.replace(RE_CITA, ' '))) {
    for (const w of f.trim().split(/\s+/).slice(1)) {
      const limpio = w.replace(/^[¿¡("'«“]+/, '');
      if (/^[A-ZÁÉÍÓÚÑ]/.test(limpio) || /[a-z][A-Z]/.test(limpio)) {
        const p = plano(limpio);
        if (p.length >= 2) out.add(`np:${p}`);
      }
    }
  }
  return out;
}

const contiene = (a: Set<string>, b: Set<string>) => [...b].every((x) => a.has(x));
const iguales = (a: Set<string>, b: Set<string>) => a.size === b.size && contiene(a, b);

/* ------------------------------------------------------------------ las respuestas anteriores */

type FrasePrevia = { tri: Set<string>; datos: Set<string> };
type Previa = { plano: string; tri: Set<string>; datos: Set<string>; frases: FrasePrevia[] };
const preparar = (previas: readonly string[]): Previa[] =>
  previas
    .filter((p) => plano(p))
    .map((p) => {
      const pl = plano(p);
      return {
        plano: ` ${pl} `,
        tri: trigramas(pl.split(' ')),
        datos: datosDe(p),
        frases: frasesDe(p).map((f) => ({ tri: trigramas(plano(f).split(' ').filter(Boolean)), datos: datosDe(f) })),
      };
    });

/**
 * ¿Esta frase ya la dijo, igual y con los mismos datos? Entera dentro de una respuesta anterior (sin un dato que esa no
 * tenga), o casi idéntica (UMBRAL_FRASE en las dos direcciones) a una frase anterior con exactamente sus datos.
 */
function yaDicha(frase: string, pv: Previa[]): boolean {
  const p = plano(frase);
  if (!p) return false;
  const d = datosDe(frase);
  const tri = trigramas(p.split(' '));
  for (const v of pv) {
    if (v.plano.includes(` ${p} `) && contiene(v.datos, d)) return true;
    if (!tri.size) continue;
    for (const g of v.frases) {
      if (!g.tri.size) continue;
      let n = 0;
      for (const t of tri) if (g.tri.has(t)) n++;
      if (n / Math.max(tri.size, g.tri.size) >= UMBRAL_FRASE && iguales(d, g.datos)) return true;
    }
  }
  return false;
}

/** Las frases medibles de `texto` (MIN_PALABRAS o más) que ya dijo, iguales y con los mismos datos, en `previas`. */
export function frasesRepetidas(texto: string, previas: readonly string[]): string[] {
  const pv = preparar(previas.slice(-RESPUESTAS_MIRADAS));
  if (!pv.length) return [];
  return frasesDe(texto).filter((f) => palabras(f) >= MIN_PALABRAS && yaDicha(f, pv));
}

/** ¿Este trozo trae alguna frase ya dicha tal cual? (suelta; para el stream vale `vaRepitiendo`, que mira la respuesta). */
export function trozoRepite(trozo: string, previas: readonly string[]): boolean {
  return frasesRepetidas(trozo, previas).length > 0;
}

/**
 * «¿Me lo repites?», «¿cómo?», «¿perdón?», «repíteme eso», «vuelve a decirlo», «no te oí», «otra vez», «léemelo»,
 * «¿cuáles eran?», "say that again": pedir que repita no es repetirse. Ante la duda, sí (y la guarda no actúa).
 */
export function pideRepetir(mensaje: string): boolean {
  const q = plano(mensaje);
  if (/^(y |eh |ah |oye )?(como|que|perdon|mande|disculpa|sorry|pardon|what|huh|eh)( (dijiste|me dijiste|era|eran|perdon|que|como))?$/.test(q)) return true;
  return /\b(repit\w*|repet\w*|otra vez|de nuevo|una vez mas|vuelve(me|lo|melo)? a (decir|leer|contar|explicar)\w*|que (me )?dijiste|como dijiste|(cual|cuales|que|como|cuanto|cuantos|cuando|donde|quien) (era|eran|fue|dijiste)|no te (oi|escuche|entendi|entiendo|capte)|no (oi|escuche|entendi|entiendo|capte)|no se (oyo|escucho)|leemelo|leelo|leeme|mande|perdon que|say (that|it) again|repeat|what did you say|come again|one more time|didn t (hear|catch))\b/.test(q);
}

/** Un borrador o una acción para la app: lo que se va a mandar o hacer tiene que oírse entero (la guarda no lo toca). */
export function pareceBorrador(texto: string): boolean {
  const t = String(texto || '');
  return (
    /\bACCI[OÓ]N_APP\b|PEDIR_HERRAMIENTA/i.test(t) ||
    /¿\s*(?:se |te )?(?:lo|la|le|los|las) (?:env[ií]o|mando|mandamos|agendo|anoto|guardo|publico|llamo|marco)\b/i.test(t) ||
    /\b(?:le escribo|le mando|le respondo|le contesto|borrador|redact\w+|shall i send|should i send|draft)\b/i.test(t) ||
    (/[«“"][^«»“”"]{3,}[»”"]/.test(t) && /\?\s*$/.test(t.trim()))
  );
}

export type GuardaRepeticion = {
  texto: string;
  /** Repetía en gran parte una de las últimas respuestas (y se le quitó lo repetido). */
  repite: boolean;
  quitadas: string[];
  /** Sin lo repetido no queda nada útil: quien llama la deja tal cual o (en la voz) pide una segunda vuelta breve. */
  vacia: boolean;
};

/**
 * ¿Lo que queda dice algo? Una pregunta, o al menos una frase de 5 palabras: «Claro que sí, José.» solo es el saludo de
 * una respuesta que se quitó entera (revisión de 23b2f5f), y sonar solo eso la pierde.
 */
function util(texto: string): boolean {
  const t = String(texto).trim();
  return /\?\s*$/.test(t) || frasesDe(t).some((f) => palabras(f) >= 5);
}

export type OpcionesGuarda = {
  /** Lo que dijo la persona en este turno (si pide que repita, no se toca). */
  mensaje?: string;
  /** El turno tiene un borrador, una acción para la app o algo esperando su «sí»: no se toca. */
  conBorrador?: boolean;
  /** Es un principio de la respuesta (el stream): lo que todavía no llegó no cuenta como dato que falta. */
  parcial?: boolean;
};

/**
 * La guarda: si `texto` repite en gran parte alguna de las últimas respuestas (`previas`, de la más vieja a la más
 * nueva), sin las frases repetidas tal cual. Una corrección, un dato nuevo en lugar de otro, un borrador o una
 * repetición menor (una frase de varias) no se tocan.
 */
export function guardaRepeticion(texto: string, previas: readonly string[], o: OpcionesGuarda = {}): GuardaRepeticion {
  const nada: GuardaRepeticion = { texto, repite: false, quitadas: [], vacia: false };
  if (!String(texto || '').trim() || o.conBorrador || pareceBorrador(texto) || (o.mensaje && pideRepetir(o.mensaje))) return nada;
  const ultimas = previas.filter((p) => String(p || '').trim()).slice(-RESPUESTAS_MIRADAS);
  if (!ultimas.length) return nada;
  const pv = preparar(ultimas);
  // ¿Corrige o actualiza una anterior sobre lo mismo? (un dato en lugar de otro: hoy → mañana, 2.450 → 2.460, «…» → «…,
  // perdón», lunes → martes). Entonces no es repetición: no se toca nada.
  const dNuevo = datosDe(texto);
  const triNuevo = trigramas(plano(texto).split(' ').filter(Boolean));
  for (const v of pv) {
    if (!triNuevo.size) break;
    let n = 0;
    for (const t of triNuevo) if (v.tri.has(t)) n++;
    if (n / triNuevo.size < PARECIDO_TEMA) continue;
    const agrega = [...dNuevo].some((x) => !v.datos.has(x));
    const quita = !o.parcial && [...v.datos].some((x) => !dNuevo.has(x));
    if (agrega && quita) return nada;
  }
  const todas = frasesDe(texto);
  const medibles = todas.filter((f) => palabras(f) >= MIN_PALABRAS);
  const rep = medibles.filter((f) => yaDicha(f, pv));
  if (!medibles.length || rep.length / medibles.length < UMBRAL_RESPUESTA) return nada;
  if (rep.reduce((n, f) => n + palabras(f), 0) < MIN_PALABRAS_REPETIDAS) return nada;
  const quitar = new Set(rep);
  // Repite: también se van las frases cortas que estaban tal cual y sin otro dato («¿Qué tenemos pendiente?», «Ah, sí:»).
  for (const f of todas) {
    const p = plano(f);
    if (p && p.split(' ').length >= 2 && pv.some((v) => v.plano.includes(` ${p} `) && contiene(v.datos, datosDe(f)))) quitar.add(f);
  }
  // Sin juntar espacios: lo que ya sonó en el stream es un principio exacto de este texto.
  const queda = todas
    .filter((f) => !quitar.has(f))
    .join('')
    .trim();
  return { texto: util(queda) ? queda : '', repite: true, quitadas: [...quitar].map((f) => f.trim()), vacia: !util(queda) };
}

/** Para el stream de la voz: ¿lo que va de la respuesta ya va camino de ser repetición? (entonces lo que falta espera). */
export function vaRepitiendo(prefijo: string, previas: readonly string[], o: Omit<OpcionesGuarda, 'parcial'> = {}): boolean {
  return guardaRepeticion(prefijo, previas, { ...o, parcial: true }).repite;
}

/** La nota para la segunda vuelta (una sola, en la voz) cuando lo que contestó era repetir tal cual lo de antes. */
export function notaNoRepetir(idioma: 'es' | 'en' = 'es'): string {
  return idioma === 'en'
    ? 'You just repeated, word for word, something you had already said. Answer what the person says now, briefly and in other words. Never say that you already said it.'
    : 'Acabas de repetir tal cual algo que ya habías dicho. Contesta lo que la persona dice ahora, breve y con otras palabras. Nunca digas que ya lo habías dicho.';
}

/** «Ya te lo dije», "I already told you": lo que una segunda vuelta no puede decir (puede ser falso y suena a regaño). */
export function diceQueYaLoDijo(texto: string): boolean {
  return /\b(ya te lo (dije|habia dicho|comente|conte)|como (ya )?te (dije|decia|comente)|eso ya te lo|already (told|said)|as i (said|mentioned))\b/.test(plano(texto));
}

/* ------------------------------------------------------------------ con qué se compara */

type Msg = { role: string; content: string };

/** Sus últimas respuestas en el hilo que va al modelo (de la más vieja a la más nueva). */
export function previasDe(hilo: readonly Msg[]): string[] {
  return hilo
    .filter((m) => m.role === 'assistant' && String(m.content || '').trim())
    .map((m) => m.content)
    .slice(-RESPUESTAS_MIRADAS);
}

/** ¿Vuelve a preguntar lo mismo que en uno de sus últimos mensajes? (entonces repetir la respuesta está bien). */
export function mismaPreguntaQue(mensaje: string, hilo: readonly Msg[]): boolean {
  const a = new Set(plano(mensaje).split(' ').filter((w) => w.length >= 3));
  if (!a.size) return false;
  return hilo
    .filter((m) => m.role === 'user')
    .slice(-RESPUESTAS_MIRADAS)
    .some((m) => {
      const b = new Set(plano(m.content).split(' ').filter((w) => w.length >= 3));
      if (!b.size) return false;
      let comun = 0;
      for (const w of a) if (b.has(w)) comun++;
      return comun / (a.size + b.size - comun) >= 0.7;
    });
}
