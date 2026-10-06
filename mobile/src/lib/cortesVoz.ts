/**
 * DÓNDE SE PUEDE CORTAR UNA RESPUESTA PARA IRLA DICIENDO MIENTRAS LLEGA. Un solo contrato para los tres que
 * cortan: el servidor (lib/trozos.ts, qué suelta del stream del modelo), la app (lib/tts.ts, StreamSpeaker y
 * splitSentences) y la mesa web (src/03-voz/frases.ts). Sin dependencias: Metro no sale de mobile/, así que
 * el servidor importa este archivo (como lib/cartera.ts importa cartera/logica.ts).
 *
 * Auditoría externa del 6-oct (VOZ-01/VOZ-05), lo que cada uno hacía distinto:
 *  · el servidor esperaba el espacio DESPUÉS del punto («Hola.» al final del trozo no salía hasta el
 *    trozo siguiente) y la app no cortaba una frase de menos de 6 letras («Sí.» atascaba todo lo de detrás);
 *  · «Dr. Gómez» se partía después de «Dr.»: cada pedazo se normaliza aparte (server/habla.ts) y la voz
 *    decía «Dr.» en vez de «Doctor Gómez»; lo mismo con «Sra.», «Lic.», «EE. UU.»;
 *  · la coma temprana valía solo para la primera cláusula que soltaba cada uno, así que lo que el servidor
 *    ya había soltado en dos comas la app lo retenía (doble segmentación = espera de más).
 *
 * El contrato: un corte es una POSICIÓN del texto que depende solo del texto hasta ahí (más, como mucho, el
 * siguiente carácter). Así, lo que el servidor suelta hasta un corte, la app lo vuelve a cortar en el mismo
 * sitio sin retener nada: nunca hay espera doble. Los cortes:
 *
 *  1. FIN DE FRASE: . ? ! … (y lo que cierre detrás: comillas, paréntesis) seguido de espacio o del final de
 *     lo llegado, o un salto de línea. El punto NO cierra:
 *       · en una cifra o una dirección (1.500, 3.5, 6.10.2026, aura.app, a.m. por dentro);
 *       · tras un título que siempre va seguido de algo (Dr., Sra., Lic., Ing., EE., una inicial «J.»);
 *       · tras una abreviatura que a veces cierra (etc., UU., a.m., una unidad, un mes) salvo que lo
 *         siguiente empiece en mayúscula; al final de lo llegado cierra (lo soltó el servidor viendo la
 *         mayúscula), salvo un mes («6 oct.» + año);
 *       · en una dirección web o un correo, salvo que siga mayúscula (al final de lo llegado, se espera);
 *       · tras una cifra al final de lo llegado («1.» puede ser «1.500»): se espera al carácter siguiente.
 *  2. CLÁUSULA SEGURA: , ; : seguidos de espacio (o del final de lo llegado) y no detrás de una cifra (3,5;
 *     10:30), a COMA_PRIMERA caracteres o más del corte anterior. En la primera frase de la respuesta vale
 *     cualquiera así (la voz empieza antes); en las siguientes, solo si la frase ya pasó CLAUSULA_LARGA
 *     (el tope de lo que se retiene esperando un punto).
 *  Nunca se corta dentro de una etiqueta [risa] ni de una a medio llegar («[ri»).
 */

/** Desde cuántos caracteres del corte anterior una coma suelta un tramo (servidor, app y web: el mismo). */
export const COMA_PRIMERA = 28;
/** Pasada la primera frase, una frase que se alarga más que esto se suelta también en su coma. */
export const CLAUSULA_LARGA = 90;

/** Lo que va de un corte a otro: dónde está (absoluto) y si fue un fin de frase o una cláusula. */
export type Corte = { fin: number; frase: boolean };
/** Por dónde va el texto: si todavía no cerró la primera frase y dónde empezó la frase actual. */
export type EstadoCorte = { primeraFrase: boolean; inicioFrase: number };

export function estadoInicial(): EstadoCorte {
  return { primeraFrase: true, inicioFrase: 0 };
}

/** Títulos y abreviaturas que siempre van seguidos de algo: su punto nunca cierra frase. */
const SIEMPRE_SIGUE = new Set([
  'dr', 'dra', 'dres', 'sr', 'sra', 'sres', 'srs', 'srta', 'srtas', 'lic', 'licda', 'licdo', 'ing', 'arq', 'prof', 'profa',
  'mtro', 'mtra', 'gral', 'cnel', 'tte', 'sgto', 'cap', 'mons', 'pbro', 'fr', 'sto', 'sta', 'mr', 'mrs', 'ms', 'st',
  'av', 'avda', 'blvd', 'núm', 'num', 'nro', 'nº', 'pág', 'págs', 'pag', 'tel', 'ext', 'dpto', 'depto', 'vol', 'art',
  'arts', 'fig', 'ej', 'apdo', 'col', 'ee', 'esq', 'carr',
]);
/** Abreviaturas que también pueden cerrar la frase: cierran solo si lo siguiente empieza en mayúscula. */
const PUEDE_CERRAR = new Set([
  'etc', 'uu', 'ud', 'uds', 'vd', 'vds', 'cía', 'jr', 'aprox', 'máx', 'mín', 'vs', 'inc', 'ltd', 'co', 'corp', 'hnos',
  'ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'sept', 'set', 'oct', 'nov', 'dic',
  'km', 'kg', 'cm', 'mm', 'mg', 'ml', 'gr', 'lb', 'lbs', 'oz', 'hrs', 'hr', 'min', 'seg', 'mts', 'kms',
]);
const MESES = new Set(['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'sept', 'set', 'oct', 'nov', 'dic']);
const CIERRES = `"'»”’)]`;
const FUERTES = '?!…';

const ESPACIOS = new Set([' ', '\n', '\t', '\r', '\f', '\v', '\u00a0', '\u2009', '\u202f', '\u3000']);
const esEspacio = (c: string | undefined) => c !== undefined && ESPACIOS.has(c);
/** Lo único que puede cortar: lo demás se salta sin mirar más (el servidor corta en cada trozo del modelo). */
const SIGNOS = new Set(['[', ']', '\n', '.', '?', '!', '…', ',', ';', ':']);
const esDigito = (c: string | undefined) => c !== undefined && c >= '0' && c <= '9';
/** Lo que puede abrir una frase nueva después de un punto ambiguo: mayúscula, ¿ ¡, comillas o una etiqueta. */
const abreFrase = (c: string | undefined) => c !== undefined && /[\p{Lu}¿¡«"“(\[]/u.test(c);

/** La palabra pegada que termina en `i` (exclusivo), sin lo que la abre («¿», «(», comillas). */
function palabraAntes(t: string, i: number): string {
  let j = i;
  while (j > 0 && !esEspacio(t[j - 1])) j--;
  return t.slice(j, i).replace(/^[(\[«"“'‘¿¡]+/, '');
}

/** Salta lo que cierra detrás de un signo (comillas, paréntesis). */
function trasCierres(t: string, k: number): number {
  while (k < t.length && CIERRES.includes(t[k])) k++;
  return k;
}

/** El primer carácter que no es espacio desde `k` (undefined si no llegó todavía). */
function siguienteVisible(t: string, k: number): string | undefined {
  while (k < t.length && esEspacio(t[k])) k++;
  return k < t.length ? t[k] : undefined;
}

/** ¿El punto en `i` (no parte de unos puntos suspensivos) cierra frase? `k`: lo que sigue tras los cierres. */
function puntoCierra(t: string, i: number, k: number): boolean {
  const alFinal = k >= t.length;
  // Pegado a algo (1.500, aura.app, a.m. por dentro): no es fin de frase.
  if (!alFinal && !esEspacio(t[k])) return false;
  const palabra = palabraAntes(t, i);
  const p = palabra.toLowerCase();
  // Una cifra: «3. Luego» cierra; «3.» al final de lo llegado puede ser «3.500», se espera un carácter.
  if (esDigito(palabra[palabra.length - 1])) return !alFinal;
  // Una inicial («J. K. Rowling», «Plan B.») o un título: nunca cierra.
  if (/^\p{L}$/u.test(palabra) || SIEMPRE_SIGUE.has(p)) return false;
  // Una dirección o un correo (aura.app/x, ana@x.com): cierra solo si sigue mayúscula; al final, se espera.
  if (/[/@:]/.test(palabra)) return !alFinal && abreFrase(siguienteVisible(t, k));
  // Abreviatura que puede cerrar (etc., UU., a.m., una unidad): cierra si sigue mayúscula. Al final de lo
  // llegado cierra también (el servidor la soltó viendo la mayúscula de detrás, y la app no la ve: si se
  // esperara, cada trozo así esperaría al siguiente); partir ahí antes de una minúscula solo pone una pausa.
  // Un mes («6 oct.») sí espera: lo siguiente suele ser el año.
  if (PUEDE_CERRAR.has(p) || (palabra.includes('.') && /^[\p{L}.]+$/u.test(palabra))) return alFinal ? !MESES.has(p) : abreFrase(siguienteVisible(t, k));
  return true;
}

/**
 * El primer corte después de `desde`, o null si con lo llegado todavía no se puede cortar. `estado` es el de
 * la posición `desde` (estadoInicial() al empezar el texto); quien corta lo pasa por avanzarEstado.
 * `comas: false`: solo fines de frase (para partir un texto ya entero, splitSentences).
 */
export function siguienteCorte(t: string, desde: number, estado: EstadoCorte, o: { comas?: boolean } = {}): Corte | null {
  const comas = o.comas !== false;
  let profundidad = 0;
  for (let i = Math.max(0, desde); i < t.length; i++) {
    const c = t[i];
    if (!SIGNOS.has(c)) continue;
    if (c === '[') {
      profundidad++;
      continue;
    }
    if (c === ']') {
      if (profundidad > 0) profundidad--;
      continue;
    }
    if (profundidad > 0) continue;
    if (c === '\n') return { fin: i + 1, frase: true };
    // Fin fuerte (? ! … y unos puntos suspensivos): con lo que lo acompañe (¡¿Qué?!, «…»).
    if (FUERTES.includes(c) || (c === '.' && t[i + 1] === '.')) {
      let j = i;
      while (j + 1 < t.length && (FUERTES.includes(t[j + 1]) || t[j + 1] === '.')) j++;
      const k = trasCierres(t, j + 1);
      if (k >= t.length || esEspacio(t[k]) || /[¿¡\p{Lu}]/u.test(t[k])) return { fin: k, frase: true };
      i = j;
      continue;
    }
    if (c === '.') {
      const k = trasCierres(t, i + 1);
      if (puntoCierra(t, i, k)) return { fin: k, frase: true };
      continue;
    }
    if (comas && (c === ',' || c === ';' || c === ':')) {
      const antes = t[i - 1];
      if (antes === undefined || esEspacio(antes) || esDigito(antes)) continue;
      const k = trasCierres(t, i + 1);
      const alFinal = k >= t.length;
      if (!alFinal && !esEspacio(t[k])) continue;
      // «https:» al final de lo llegado es una dirección a medias, no una pausa.
      if (c === ':' && alFinal && /^(https?|ftp|mailto|www)$/i.test(palabraAntes(t, i))) continue;
      if (i - desde < COMA_PRIMERA) continue;
      if (!estado.primeraFrase && i - estado.inicioFrase < CLAUSULA_LARGA) continue;
      return { fin: k, frase: false };
    }
  }
  return null;
}

/** El estado después de un corte. */
export function avanzarEstado(estado: EstadoCorte, corte: Corte): EstadoCorte {
  return corte.frase ? { primeraFrase: false, inicioFrase: corte.fin } : estado;
}

/** Todos los cortes de un texto desde el principio (en orden), con lo llegado hasta ahora. */
export function cortesDe(t: string, o: { comas?: boolean } = {}): Corte[] {
  const out: Corte[] = [];
  let estado = estadoInicial();
  let desde = 0;
  // Cada vuelta avanza al menos un carácter: como mucho t.length vueltas.
  for (let vueltas = 0; vueltas <= t.length; vueltas++) {
    const c = siguienteCorte(t, desde, estado, o);
    if (!c || c.fin <= desde) break;
    out.push(c);
    estado = avanzarEstado(estado, c);
    desde = c.fin;
  }
  return out;
}

/** ¿Tiene algo que decir (una letra o una cifra)? Un pedazo de solo signos no se pide a la voz. */
export function tienePalabras(s: string): boolean {
  return /[\p{L}\p{N}]/u.test(s.replace(/\[[^\]]*\]/g, ''));
}

/** Cuántas letras tiene, sin etiquetas: «Sí.» tiene 2. */
export function letras(s: string): number {
  return (s.replace(/\[[^\]]*\]/g, '').match(/[\p{L}\p{N}]/gu) || []).length;
}
