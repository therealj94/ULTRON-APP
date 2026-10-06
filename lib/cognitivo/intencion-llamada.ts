/**
 * ¿«Que me llames» de verdad? (LANG-03) — la condición estricta que tiene que cumplir un atajo (reglas,
 * Laya ligera o el Laya del nodo) para que el avatar LLAME a la persona sin pasar por el cerebro.
 *
 * El clasificador lineal ve «llames» y «me» y contesta `app_llamame` con 0,90 aunque la frase sea
 * «no me llames»; «call me Alex» es un apodo, no una llamada. Laya acelera la intención; no la decide
 * sola: si la frase no es inequívocamente «llámame (ya)», el atajo NO hace nada y contesta el cerebro
 * (el camino seguro: nadie recibe una llamada que no pidió).
 *
 * Qué bloquea (cada una devuelve su motivo, para la traza y las pruebas):
 *  · `negacion`   — «no me llames», «ya no me llames», «never call me», «don't call me», «deja de
 *                   llamarme». Un «no,» SEPARADO por coma es una corrección («no, llama a Beto») y no
 *                   niega la cláusula que sigue; sin coma («no llama a Beto») es ambiguo y también bloquea.
 *  · `cita`       — comillas en la frase («"llámame" dijo ella»): se está citando, no pidiendo.
 *  · `referido`   — discurso referido: «dijo que me llames», «me pidió que te llame», «she said call me».
 *  · `apodo`      — después del verbo viene una palabra que no es cortesía ni «ya/ahorita»: «llámame
 *                   José», «call me Alex», «call me later/maybe/crazy». Un nombre o un «después» no es
 *                   «llámame ahora».
 *  · `contexto`   — hay algo esperando su «sí» (un borrador, una propuesta) o ya hay una llamada viva: un
 *                   «llámame» suelto en ese momento se lo deja al turno completo.
 *  · `sin_pedido` — no hay ninguna expresión de «llámame» (p. ej. «¿puedes llamar?», «llama a Beto»).
 */

/** Sin tildes, minúsculas, «don't» → «dont». Las comas y puntos quedan: separan cláusulas. */
function plegarConSignos(texto: string): string {
  return String(texto ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\p{Cf}/gu, '')
    .toLowerCase()
    .replace(/(\w)['’](\w)/g, '$1$2');
}

/** Lo que tiene forma de pedir que la llamen a ELLA (el avatar llama a su teléfono). */
const PEDIDO =
  /\b(llamame|llamarme|me llames|me llamas|me llamarias|me llamaras|marcame|marcarme|me marques|timbrame|me timbres|hazme una llamada(?:dita)?|haceme una llamada(?:dita)?|hazme una llamadita|dame una llamada|echame una llamada|dame un timbrazo|hablame por telefono|llamame por telefono|ponte en llamada conmigo|hablemos por (?:llamada|telefono)|call me|call my (?:phone|cell)|give me a (?:call|ring)|ring me|phone me|lets (?:talk on|have) a call)\b/;

/** Negación pegada a la cláusula del verbo (en la misma cláusula, antes del pedido). */
const NEGACION = /\b(no|nunca|jamas|ni|tampoco|not|dont|never|stop|quit|deja de|dejes de|no quiero que|ya no)\b/;

/** Verbos de decir en tercera persona / pasado: lo que dijo otro no es una orden para AURA. */
const REFERIDO = /\b(dijo|dijeron|dice|dicen|decia|decian|pidio|pidieron|pide|piden|conto|escribio|mando a decir|said|says|told|asked|wrote|tells)\b/;

/** Comillas de cualquier tipo, y el apóstrofo que abre o cierra una cita ('llámame'). */
const CITA = /["“”«»„‟]|(^|\s)['‘’]\S|\S['‘’](\s|$)/;

/** Lo que puede venir DESPUÉS del pedido sin cambiarle el sentido («llámame ya», «call me now please»). */
const COLA_PERMITIDA = new Set(
  'ahorita ahora ya un rato ratito porfa porfis por favor please now right real quick when you can for me me ok okay tu vos pues dale gracias al celular telefono cel quiero que platicar hablar contigo para me aburro rapido rapidito'.split(
    ' '
  )
);

export type MotivoNoLlamar = 'negacion' | 'cita' | 'referido' | 'apodo' | 'contexto' | 'sin_pedido';

export type ContextoLlamada = {
  /** Algo espera su «sí» (un borrador de AU-RA, una propuesta de llamar/recordar, lo escrito en el chat). */
  pendiente?: boolean;
  /** Ya hay una llamada en curso. */
  enLlamada?: boolean;
};

/**
 * null: la frase es inequívocamente «llámame (ahora)» y se puede hacer por atajo. Si no, el motivo por
 * el que NO (y el atajo devuelve null: contesta el cerebro).
 */
export function motivoParaNoLlamar(texto: string, ctx: ContextoLlamada = {}): MotivoNoLlamar | null {
  const crudo = String(texto ?? '');
  if (CITA.test(crudo)) return 'cita';
  const t = plegarConSignos(crudo);
  // Cláusulas: lo que separa una coma, punto, punto y coma o signo. «no, llama a Beto» son dos.
  const clausulas = t
    .split(/[,.;:!?¡¿…]+/)
    .map((c) => c.replace(/[^a-z0-9ñ ]+/g, ' ').replace(/\s+/g, ' ').trim())
    .filter(Boolean);
  const todo = clausulas.join(' ');
  if (REFERIDO.test(todo)) return 'referido';
  const i = clausulas.findIndex((c) => PEDIDO.test(c));
  if (i < 0) return 'sin_pedido';
  const c = clausulas[i];
  const m = PEDIDO.exec(c)!;
  const antes = c.slice(0, m.index);
  if (NEGACION.test(antes)) return 'negacion';
  // Una negación después («llámame no», «call me not») o en una cláusula posterior («llámame, no, mejor no»).
  if (/\b(no|not|never|nunca|mejor no)\b/.test(c.slice(m.index + m[0].length)) || clausulas.slice(i + 1).some((x) => /^(no|nah|mejor no|never mind|olvidalo|no mejor no)\b/.test(x))) return 'negacion';
  // Lo que sigue al pedido en su cláusula: solo cortesía o «ya/ahorita». Un nombre («José», «Alex») o un
  // tiempo («later», «mañana») no es «llámame ahora».
  const cola = c.slice(m.index + m[0].length).trim();
  if (cola && cola.split(' ').some((w) => !COLA_PERMITIDA.has(w))) return 'apodo';
  if (ctx.pendiente || ctx.enLlamada) return 'contexto';
  return null;
}

/** La forma corta: ¿se puede llamar por atajo? */
export function pideQueLaLlamen(texto: string, ctx: ContextoLlamada = {}): boolean {
  return motivoParaNoLlamar(texto, ctx) === null;
}

/** ¿Se está citando o contando lo que dijo otro? Entonces tampoco es un apodo («"llámame" dijo ella»). */
export function esCitaOReferido(texto: string): boolean {
  const crudo = String(texto ?? '');
  if (CITA.test(crudo)) return true;
  return REFERIDO.test(plegarConSignos(crudo).replace(/[^a-z0-9ñ ]+/g, ' '));
}
