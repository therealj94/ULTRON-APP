/**
 * QUE NO SE REPITA (José, 7-oct, 00:32–00:33 UTC, mesa de AU-RA: «está loco repitiendo las cosas»). A las 00:32:42 dijo un
 * párrafo («Je, sí, me cambié de ropa… ¿Qué tenemos pendiente? Ah, sí: te quedó pendiente…») y a las 00:33:14, a «Me
 * cambió a Claudio.», EXACTAMENTE el mismo párrafo otra vez. El modelo copió su respuesta anterior y nada lo paraba.
 *
 * Aquí, sin red y determinista:
 *  · `frasesRepetidas`: qué frases de una respuesta ya están (casi iguales) en alguna de las últimas respuestas de AU-RA.
 *    Una frase cuenta si tiene al menos MIN_PALABRAS palabras y su texto plano ya está en una respuesta anterior, o si
 *    UMBRAL_FRASE de sus trigramas de palabras ya están en una sola respuesta anterior. Las cortas («Va.», «Claro.») no;
 *  · `guardaRepeticion`: si la respuesta repite EN GRAN PARTE una de las últimas (al menos UMBRAL_RESPUESTA de sus frases
 *    medibles, o de sus trigramas), se le quitan las frases repetidas; si no queda nada útil, `vacia` y quien llama la
 *    regenera una vez o contesta breve a lo nuevo;
 *  · `trozoRepite`: para el stream de la voz, si un trozo a punto de sonar ya se dijo (se retiene hasta el final, donde
 *    decide la guarda: así lo repetido nunca suena);
 *  · lo que se compara son sus últimas respuestas del hilo que va al modelo (`previasDe`): lo que el modelo tiene a la
 *    vista y puede copiar;
 *  · si la persona PIDE que repita («¿qué dijiste?», «repítelo», «no te oí») o vuelve a preguntar lo mismo, no se toca
 *    nada (`pideRepetir`, `mismaPreguntaQue`): ahí la misma respuesta es la correcta.
 */

export const MIN_PALABRAS = 5;
/** De una frase: qué parte de sus trigramas tiene que estar ya en una respuesta anterior para contar como repetida. */
export const UMBRAL_FRASE = 0.6;
/** De la respuesta: qué parte (de sus frases medibles o de sus trigramas) repetida la hace «repetición». */
export const UMBRAL_RESPUESTA = 0.5;
/** Y al menos tantas palabras repetidas: una frase corta que se parece («Claro, te cuento del proyecto.») no es repetirse. */
export const MIN_PALABRAS_REPETIDAS = 10;
/** Cuántas respuestas anteriores se miran. */
export const RESPUESTAS_MIRADAS = 3;

const plano = (s: string) =>
  String(s || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\[[^\]]{0,40}\]/g, ' ')
    .toLowerCase()
    .replace(/[^a-z0-9ñ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/** Las frases de un texto con su puntuación (unidas con '' devuelven el texto). */
export function frasesDe(texto: string): string[] {
  return String(texto || '').match(/[^.!?…\n]+(?:[.!?…]+|\n+|$)\s*/g)?.filter((f) => f.length) || [];
}

function trigramas(palabras: string[]): Set<string> {
  const out = new Set<string>();
  for (let i = 0; i + 2 < palabras.length; i++) out.add(`${palabras[i]} ${palabras[i + 1]} ${palabras[i + 2]}`);
  return out;
}

type Previa = { plano: string; tri: Set<string> };
const preparar = (previas: readonly string[]): Previa[] =>
  previas
    .map((p) => plano(p))
    .filter(Boolean)
    .map((p) => ({ plano: ` ${p} `, tri: trigramas(p.split(' ')) }));

/** Qué tanto de esta frase ya se dijo (0..1) en la respuesta anterior que más se le parece; 1 si está entera. */
function parecido(frase: string, previas: Previa[]): number {
  const p = plano(frase);
  const ws = p ? p.split(' ') : [];
  if (ws.length < MIN_PALABRAS) return 0;
  const tri = trigramas(ws);
  let max = 0;
  for (const v of previas) {
    if (v.plano.includes(` ${p} `)) return 1;
    if (!tri.size) continue;
    let n = 0;
    for (const t of tri) if (v.tri.has(t)) n++;
    max = Math.max(max, n / tri.size);
  }
  return max;
}

/** ¿Esta frase ya se dijo en alguna de las respuestas anteriores? */
const repetida = (frase: string, previas: Previa[]) => parecido(frase, previas) >= UMBRAL_FRASE;

/** Las frases de `texto` que ya dijo en `previas` (las medibles: con MIN_PALABRAS o más). */
export function frasesRepetidas(texto: string, previas: readonly string[]): string[] {
  const pv = preparar(previas.slice(-RESPUESTAS_MIRADAS));
  if (!pv.length) return [];
  return frasesDe(texto).filter((f) => repetida(f, pv));
}

/** ¿El trozo que está por sonar repite algo ya dicho? (para retenerlo en el stream hasta la guarda del final). */
export function trozoRepite(trozo: string, previas: readonly string[]): boolean {
  return frasesRepetidas(trozo, previas).length > 0;
}

/** «¿Qué dijiste?», «repítelo», «otra vez», «no te oí», «say that again»: pedir que repita no es repetirse. */
export function pideRepetir(mensaje: string): boolean {
  const q = plano(mensaje);
  return /\b(repite|repitelo|repitemelo|repetir|repetirlo|repetimelo|otra vez|de nuevo|que dijiste|que me dijiste|como dijiste|no te (oi|escuche|entendi)|no (oi|escuche|entendi)|mande|perdon que|say (that|it) again|repeat|what did you say|come again|one more time)\b/.test(q);
}

export type GuardaRepeticion = {
  texto: string;
  /** Repetía en gran parte una de las últimas respuestas (y se le quitó lo repetido). */
  repite: boolean;
  quitadas: string[];
  /** Sin lo repetido no queda nada útil: quien llama la regenera una vez o contesta breve. */
  vacia: boolean;
};

/** ¿Lo que queda dice algo? (una frase medible, o una pregunta). */
function util(texto: string): boolean {
  const p = plano(texto);
  return p.split(' ').filter(Boolean).length >= 3 || /\?\s*$/.test(String(texto).trim());
}

/**
 * La guarda: si `texto` repite en gran parte alguna de las últimas respuestas (`previas`, de la más vieja a la más nueva),
 * sin las frases repetidas. Con una repetición menor (una frase de varias) no se toca: no es repetirse.
 */
export function guardaRepeticion(texto: string, previas: readonly string[], o: { mensaje?: string } = {}): GuardaRepeticion {
  const nada: GuardaRepeticion = { texto, repite: false, quitadas: [], vacia: false };
  if (!String(texto || '').trim() || (o.mensaje && pideRepetir(o.mensaje))) return nada;
  const ultimas = previas.filter((p) => String(p || '').trim()).slice(-RESPUESTAS_MIRADAS);
  if (!ultimas.length) return nada;
  const pv = preparar(ultimas);
  const todas = frasesDe(texto);
  const medibles = todas.filter((f) => plano(f).split(' ').filter(Boolean).length >= MIN_PALABRAS);
  const rep = medibles.filter((f) => repetida(f, pv));
  // También por trigramas de la respuesta entera contra cada anterior (una repetición con la puntuación cambiada).
  const tri = trigramas(plano(texto).split(' ').filter(Boolean));
  const porTrigramas = tri.size >= 3 && pv.some((v) => [...tri].filter((t) => v.tri.has(t)).length / tri.size >= UMBRAL_RESPUESTA);
  const porFrases = medibles.length > 0 && rep.length / medibles.length >= UMBRAL_RESPUESTA;
  if (!porFrases && !porTrigramas) return nada;
  // Se quita lo repetido (si solo se ve por trigramas, cada frase medible con buena parte ya dicha).
  const quitar = new Set(rep.length ? rep : medibles.filter((f) => parecido(f, pv) >= 0.3));
  const palabrasRepetidas = [...quitar].reduce((n, f) => n + plano(f).split(' ').filter(Boolean).length, 0);
  if (palabrasRepetidas < MIN_PALABRAS_REPETIDAS) return nada;
  // Repite: también se van las frases cortas que estaban tal cual («¿Qué tenemos pendiente?», «Ah, sí:»).
  for (const f of todas) {
    const p = plano(f);
    if (p && p.split(' ').length >= 2 && pv.some((v) => v.plano.includes(` ${p} `))) quitar.add(f);
  }
  // Sin juntar espacios: lo que ya sonó en el stream es un principio exacto de este texto.
  const queda = todas
    .filter((f) => !quitar.has(f))
    .join('')
    .trim();
  return { texto: util(queda) ? queda : '', repite: true, quitadas: [...quitar].map((f) => f.trim()), vacia: !util(queda) };
}

/** La nota para la segunda vuelta (una sola) cuando lo que contestó era repetir lo de antes. */
export function notaNoRepetir(idioma: 'es' | 'en' = 'es'): string {
  return idioma === 'en'
    ? 'You just repeated what you had already said. Do not repeat it. Answer ONLY what the person says now, briefly and with something new. If there is nothing new, say it in one short sentence.'
    : 'Acabas de repetir lo que ya habías dicho. No lo repitas. Contesta SOLO lo que la persona dice ahora, breve y con algo nuevo. Si no hay nada nuevo, dilo en una frase corta.';
}

/** Lo que se dice si, sin lo repetido, no queda nada y la segunda vuelta tampoco sirve: breve, a lo nuevo. */
export function respuestaBreveSinRepetir(idioma: 'es' | 'en' = 'es'): string {
  return idioma === 'en' ? "I already told you that a moment ago. What do you need now?" : 'Eso ya te lo dije hace un momento. ¿Qué necesitas ahora?';
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
