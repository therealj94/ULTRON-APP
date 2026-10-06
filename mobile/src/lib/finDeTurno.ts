/**
 * ¿TERMINÓ DE HABLAR O SOLO HIZO UNA PAUSA? (José, 6-oct: «que sea tan rápido contestar una conversación que nadie note
 * que es una IA»). El oído cerraba la frase por silencio: 0,48 s tras la última palabra (0,34 con punto, 1 s si quedaba
 * en «y», «de»…), con lo que Scribe Turbo iba entendiendo EN VIVO, que llega atrasado (sus parciales salen cada ~1 s).
 * En el teléfono de José eso dejaba la frase lista a los ~600–750 ms de callar.
 *
 * Ahora (como el turn detector de LiveKit o el smart-turn de Pipecat, pero con reglas: el teléfono no carga modelos): a
 * los SONDEO_MS de silencio el oído le pide a Turbo el texto EXACTO de lo dicho (un commit; vuelve en ~50 ms) y esta
 * función decide con ese texto:
 *
 *   completo     la idea está cerrada («¿qué hora es?», «cuéntame algo del oro», «gracias», «sí»): se cierra ya.
 *   dudoso       puede seguir («hoy fui al centro»): se espera el silencio de siempre, pero el turno puede EMPEZAR ya
 *                en el servidor como especulativo (lib/turnoEspeculativo.ts) y solo se confirma si no siguió hablando.
 *   incompleto   quedó colgando («y luego…», «es que», «mándale un mensaje a», «eh…»): se espera más, como una
 *                persona que deja terminar.
 *
 * Español de Honduras e inglés. Puro (se prueba en Node: tests/fin-de-turno-movil.test.ts).
 */

export type FinDeTurno = 'completo' | 'dudoso' | 'incompleto';

/** A los cuántos ms de silencio se le pide a Turbo el texto exacto (el sondeo). */
export const SONDEO_MS = 250;
/** Silencio total con el que se cierra cada clase (desde la última voz). */
export const CIERRE_MS: Record<FinDeTurno, number> = { completo: 300, dudoso: 480, incompleto: 1100 };

const plano = (s: string) =>
  String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/ñ/g, 'n');

/** Palabras con las que una idea no termina (conjunciones, preposiciones, artículos, posesivos). */
const COLGANTES = new Set(
  (
    'y e o u ni de del a al en con por para sin sobre entre hacia hasta desde segun que el la los las lo un una unos unas mi mis tu tus su sus ' +
    'nuestro nuestra pero porque pues como cuando si donde mientras aunque entonces sea este esta ese esa estos esas le les me te se nos cual cuyo muy mas tan ' +
    'and or but the a an to of for with in on at my your his her their our its if when because so that this these those than as from into about like by is are was were'
  ).split(/\s+/)
);

/** Las que cuelgan siempre, también en una pregunta: conjunciones, preposiciones y artículos. */
const FUERTES = new Set(
  'y e o u ni de del a al en con por para sin sobre entre hacia hasta desde que el la los las un una unos unas pero porque and or but the an to of for with in on at from into'.split(' ')
);

/** Muletillas: si la frase termina en una de estas, todavía está pensando qué decir (aunque Turbo le ponga «?»). */
const MULETILLAS_FINALES = [
  'eh', 'em', 'ehm', 'mmm', 'mm', 'esteee', 'o sea', 'osea', 'es que', 'y luego', 'y despues', 'a ver', 'digamos', 'como que',
  'pues nada y', 'verdad que', 'lo que pasa es que', 'la cosa es que', 'fijate que', 'mira que',
  'um', 'uh', 'uhm', 'erm', 'you know', 'i mean', 'and then', 'the thing is',
];
/** Las que también son palabras de verdad («¿cómo se llama este?», «ese tipo»): cuelgan solo si no es pregunta. */
const MULETILLAS_DUDOSAS = ['este', 'tipo', 'like', 'so', 'well'];

/** Lo que abre una idea y casi nunca va solo: «es que», «fíjate que», «mira», «oye» sin nada detrás. */
const ARRANQUES_SOLOS = /^(es que|fijate( que)?|mira( que)?|oye|oiga|bueno|pues|entonces|y|o sea|la verdad( es que)?|lo que pasa( es que)?|so|well|okay so|the thing is|i was thinking)$/;

/** Una sola palabra o dos que son una respuesta entera. */
const RESPUESTAS_CORTAS = new Set(
  (
    'si no sip nop nel simon dale va vaya ok okay okey listo claro exacto perfecto correcto gracias muchas gracias hola buenas buenos dias buenas noches buenas tardes ' +
    'adios chao bye para callate silencio basta ya alto espera espere hecho bien genial excelente obvio seguro nunca jamas tal vez quizas ' +
    'yes yeah yep nope sure thanks thank you hello hi hey goodbye stop wait done great cool fine right exactly maybe'
  )
    .split(/\s+/)
);
const RESPUESTAS_DOS = /^(si (claro|gracias|dale|porfa|por favor|senor|senora|exacto|perfecto)|no (gracias|todavia|importa|se|creo)|claro que (si|no)|esta bien|por favor|muchas gracias|de nada|ya esta|me parece|thank you|no thanks|of course|sounds good|all right|got it)$/;

/** Interrogativos de arranque: una pregunta que ya tiene verbo detrás está entera. */
const PREGUNTA = /^(y )?(que|como|cuando|donde|adonde|quien|quienes|cual|cuales|cuanto|cuanta|cuantos|cuantas|por que|para que|sabes|me puedes|puedes|podrias|tienes|hay|es cierto|crees|te parece|what|how|when|where|who|why|which|can you|could you|do you|did you|are you|is it|is there|have you|will you|would you)\b/;

/** Órdenes de la mesa (imperativos y «-me/-le»): con algo detrás, la idea está entera. */
const ORDEN = /^(oye |porfa |por favor )?(dime|cuentame|explicame|dame|ponme|pon|abre|cierra|apaga|enciende|prende|busca|buscame|llama|llamame|marca|marcame|manda|mandale|envia|enviale|escribe|escribele|recuerdame|recuerda|anota|apunta|lee|leeme|muestrame|ensename|mira|para|deten|sigue|repite|traduce|calcula|canta|cantame|toca|reproduce|baja|sube|activa|desactiva|tell|give|show|open|close|call|send|play|stop|read|find|search|remind|turn|set|explain)\b/;

function sinPuntuacion(t: string): string {
  return plano(t)
    .replace(/[¿¡"“”«»()\[\]]/g, ' ')
    .replace(/[.,;:!?…-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * La clase de fin de turno de lo que dijo (el texto exacto de Turbo tras el sondeo, con su puntuación). Sin texto,
 * `incompleto` (no hay nada que contestar todavía).
 */
export function finDeTurno(texto: string): FinDeTurno {
  const crudo = String(texto || '').trim();
  if (!crudo) return 'incompleto';
  // Lo que la puntuación de Turbo dice al final: «…» o una coma/guion es que se quedó a medias.
  if (/(\.\.\.|…|,|;|:|-|–|—)\s*$/.test(crudo)) return 'incompleto';
  const t = sinPuntuacion(crudo);
  if (!t) return 'incompleto';
  const palabras = t.split(' ');
  const ultima = palabras[palabras.length - 1];
  const termina = (m: string) => t === m || t.endsWith(` ${m}`);
  // Muletilla al final: está pensando.
  if (MULETILLAS_FINALES.some(termina)) return 'incompleto';
  // «¿y tú?», «¿y él?» no cuelgan (con tilde son pronombres, no «tu casa» ni «el carro»). Lo que cuelga es la palabra
  // misma («para», «de», «y»).
  const ultimaConTilde = crudo.toLowerCase().replace(/[¿¡"“”«»()[\].,;:!?…-]+/g, ' ').trim().split(/\s+/).pop() || '';
  const cuelga = COLGANTES.has(ultima) && !/^(tú|él|mí|sí|qué|cuál|cómo|dónde|cuándo|quién|más)$/.test(ultimaConTilde);
  // Turbo le puso signo de pregunta (lo pone por la entonación y la forma): la pregunta está hecha, salvo que termine
  // en conjunción, preposición o artículo («¿vamos a?»). «¿Cómo se llama este?» sí está entera.
  if (/\?\s*$/.test(crudo)) return cuelga && FUERTES.has(ultima) ? 'incompleto' : 'completo';
  if (cuelga) return 'incompleto';
  if (MULETILLAS_DUDOSAS.some(termina)) return 'incompleto';
  if (ARRANQUES_SOLOS.test(t)) return 'incompleto';
  // Una palabra cortada («revi-») ya cayó arriba por el guion.
  if (palabras.length <= 2 && (RESPUESTAS_CORTAS.has(t) || RESPUESTAS_DOS.test(t))) return 'completo';
  if (/^¿/.test(crudo) && palabras.length >= 2) return 'completo';
  if (PREGUNTA.test(t) && palabras.length >= 3) return 'completo';
  if (ORDEN.test(t) && palabras.length >= 2) return 'completo';
  // Lo demás («hoy fui al centro», «Mamá», «llámame») puede seguir o no: se espera lo de siempre.
  return 'dudoso';
}

/** Silencio total (ms desde la última voz) con el que se cierra una frase de esta clase. */
export function cierreDe(clase: FinDeTurno): number {
  return CIERRE_MS[clase];
}

/** ¿Vale empezar el turno especulativo con esta clase? (incompleto, nunca: casi seguro que sigue hablando). */
export function sePuedeEspecular(clase: FinDeTurno): boolean {
  return clase !== 'incompleto';
}
