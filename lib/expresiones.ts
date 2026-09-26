/**
 * EXPRESIONES DE VOZ — risas, suspiros, «mmm» grabados con el timbre de Dora, dentro de lo que AU-RA dice.
 *
 * El 27B las escribe en medio del texto, entre corchetes: «Ay, no me digas [risa] eso sí que no me
 * lo esperaba». La voz (server/voz.ts) parte el texto en esas marcas, dice los trozos con Voicebox y
 * pega entre ellos el sonido grabado; la pantalla no las enseña nunca (`quitarExpresiones`).
 *
 * Son de AU-RA y de nadie más: están grabadas con la voz de Dora. En Dr Electrum se quitan sin
 * sonar —un doctor que se ríe con la voz de otra plataforma deshace la separación de las dos—.
 *
 * Los archivos salieron del estudio (scripts/estudio, manifiesto con métricas): cada etiqueta usa
 * sus variantes verificadas; las de verificación débil solo si son la única toma de esa expresión.
 * WAV 24 kHz mono en server/expresiones/<id>.wav (para empalmar) y MP3 en
 * public/voz/expresiones/<id>.mp3 (reacciones al tacto en la web y el teléfono).
 *
 * Módulo sin dependencias de Node: lo usan el servidor y la web. El teléfono lleva una copia
 * (mobile/src/lib/expresiones.ts) y una prueba vigila que digan lo mismo.
 */

/** Etiqueta (como la escribe el cerebro) → tomas grabadas. Una por turno, al azar. */
export const EXPRESIONES: Record<string, readonly string[]> = {
  risa: ['risa-corta-1'],
  risita: ['risa-tierna-1'],
  'risa nerviosa': ['risa-nerviosa-1'],
  je: ['je-picara-1'],
  suspiro: ['suspiro-cansado-1', 'suspiro-cansado-2'],
  'suspiro aliviado': ['suspiro-aliviado-1', 'suspiro-aliviado-2'],
  'suspiro soñador': ['suspiro-sonador-1', 'suspiro-sonador-2'],
  sorpresa: ['sorpresa-oh-1', 'sorpresa-oh-2'],
  asombro: ['asombro-gasp-1', 'asombro-gasp-2'],
  mmm: ['mmm-pensando-1', 'mmm-pensando-2'],
  'mmm rico': ['mmm-rico-1', 'mmm-rico-2'],
  hmm: ['hmm-dudando-1'],
  bostezo: ['bostezo-1', 'bostezo-2'],
  ajá: ['aja-1'],
  eso: ['eso-1', 'eso-2'],
  auch: ['ay-dolor-1'],
  shh: ['shh-1', 'shh-2'],
  ups: ['ups-1', 'ups-2'],
  beso: ['beso-mua-1'],
  ooh: ['ooh-admiracion-1', 'ooh-admiracion-2'],
  aww: ['aww-ternura-1'],
  respiro: ['respiro-antes-de-hablar-1', 'respiro-antes-de-hablar-2'],
  bufido: ['bufido-fastidio-1'],
};

/** Otras formas de escribir la misma: el modelo no siempre copia la lista letra por letra. */
const ALIAS: Record<string, string> = {
  'risa tierna': 'risita',
  'suspiro cansado': 'suspiro',
  aja: 'ajá',
  ay: 'auch',
};

/** Cuántas suenan como mucho en un mismo texto. Las que sobran se quitan sin sonar. */
export const MAX_EXPRESIONES = 3;

/** Minúsculas, sin tildes ni espacios de sobra: «[Suspiro  Soñador]» y «[suspiro sonador]» son la misma. */
export function normalizarEtiqueta(s: string): string {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

const CANONICA = new Map<string, string>();
for (const e of Object.keys(EXPRESIONES)) CANONICA.set(normalizarEtiqueta(e), e);
for (const [a, e] of Object.entries(ALIAS)) CANONICA.set(normalizarEtiqueta(a), e);

/** La etiqueta tal como está en EXPRESIONES, o null si no es una expresión grabada. */
export function expresionDe(etiqueta: string): string | null {
  return CANONICA.get(normalizarEtiqueta(etiqueta)) || null;
}

/** Cualquier corchete corto en una línea: expresiones, etiquetas viejas de audio, `[1]`… */
const CORCHETE = /\[([^\]\n]{1,40})\]/g;

export type Pieza = { tipo: 'habla'; texto: string } | { tipo: 'expresion'; etiqueta: string };

/**
 * Parte el texto en lo que se dice y lo que suena grabado, en orden. Lo que no es una expresión
 * conocida (`[softly]`, `[1]`) se queda dentro del trozo hablado: ahí `expresar()` lo quita.
 * Pasado el tope de MAX_EXPRESIONES, las siguientes se quitan sin sonar.
 */
export function trocearExpresiones(texto: string): Pieza[] {
  const t = String(texto || '');
  const piezas: Pieza[] = [];
  let habla = '';
  let desde = 0;
  let cuantas = 0;
  CORCHETE.lastIndex = 0;
  for (let m = CORCHETE.exec(t); m; m = CORCHETE.exec(t)) {
    const etiqueta = expresionDe(m[1]);
    if (!etiqueta) continue;
    habla += t.slice(desde, m.index);
    desde = m.index + m[0].length;
    if (cuantas >= MAX_EXPRESIONES) continue;
    if (habla.trim()) piezas.push({ tipo: 'habla', texto: limpio(habla) });
    habla = '';
    piezas.push({ tipo: 'expresion', etiqueta });
    cuantas++;
  }
  habla += t.slice(desde);
  if (habla.trim()) piezas.push({ tipo: 'habla', texto: limpio(habla) });
  return piezas;
}

/** Un trozo hablado sin los espacios dobles que deja una marca quitada. */
const limpio = (s: string) => s.replace(/[ \t]{2,}/g, ' ').trim();

export function tieneExpresiones(texto: string): boolean {
  return trocearExpresiones(texto).some((p) => p.tipo === 'expresion');
}

/** Una etiqueta de audio escrita a mano (`[risas]`, `[softly, warm]`): minúsculas y nada más. */
const PARECE_ETIQUETA = /^[a-záéíóúüñ][a-záéíóúüñ ,'-]{0,38}$/;

/**
 * El texto para LEER: sin expresiones ni etiquetas de audio. Es lo que va a la burbuja, al hilo, a
 * Telegram y a la memoria. No toca `[1]`, `[Anexo A]` ni los enlaces `[texto](url)`.
 *
 * No recorta los bordes a propósito: se aplica también a los trozos del stream, que se pegan uno
 * detrás del otro, y el espacio entre dos trozos es parte del texto. Quien tenga el texto entero
 * hace `.trim()`.
 */
export function quitarExpresiones(texto: string): string {
  let quito = false;
  const sin = String(texto || '').replace(/[ \t]*\[([^\]\n]{1,40})\]/g, (todo: string, dentro: string, donde: number, entero: string) => {
    if (expresionDe(dentro)) {
      quito = true;
      return '';
    }
    // `[texto](url)` es un enlace, no una etiqueta.
    if (entero[donde + todo.length] === '(' || !PARECE_ETIQUETA.test(dentro.trim())) return todo;
    quito = true;
    return '';
  });
  if (!quito) return sin;
  return sin
    .replace(/([¿¡])[ \t]+/g, '$1')
    .replace(/[ \t]+([,.;:!?…])/g, '$1')
    .replace(/[ \t]{2,}/g, ' ');
}

/** Las etiquetas que se le enseñan al cerebro, en el orden de la lista. */
export const ETIQUETAS_EXPRESION = Object.keys(EXPRESIONES);

/**
 * La instrucción del prompt de AU-RA (server/desk.ts). Solo de AU-RA: al prompt de Dr Electrum no
 * se le nombran, porque en su voz no suenan.
 */
export function instruccionExpresiones(): string {
  const lista = ETIQUETAS_EXPRESION.map((e) => (e === 'hmm' ? '[hmm] (suena «mmm, no sé»)' : `[${e}]`)).join(', ');
  return [
    `EXPRESIONES DE VOZ: tu voz tiene sonidos grabados que se oyen donde los escribas, entre corchetes: ${lista}.`,
    'Úsalos poco: uno, como mucho dos por respuesta, y solo donde una persona de verdad se reiría, suspiraría o se sorprendería («Ay, no me digas [risa] esa no me la sabía»).',
    'Nunca en respuestas serias, de dinero, precios, contratos o temas legales, ni cuando alguien está pasándola mal. Solo esos: no inventes otros.',
    'Si abriste con [EMO:risa], no empieces con [risa]: la risa ya suena sola. No se ven en pantalla; solo se oyen.',
  ].join(' ');
}
