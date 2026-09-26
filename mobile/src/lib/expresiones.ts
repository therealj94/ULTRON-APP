/**
 * Expresiones de voz de AU-RA — copia cliente del contrato del servidor (lib/expresiones.ts).
 *
 * El cerebro escribe [risa], [suspiro], [mmm]… en medio de la respuesta. El servidor manda cada trozo
 * dos veces: `text` para leer (sin ellas) y `voz` para decir (con ellas). El teléfono habla `voz`
 * —GET /api/tts las deja sonar con la toma grabada— y en pantalla y en el hilo nunca las enseña.
 *
 * Solo la lista de etiquetas vive aquí (el audio lo pega el servidor). tests/expresiones.test.ts
 * comprueba que esta copia y la del servidor digan lo mismo.
 */

/** Etiquetas grabadas, normalizadas (sin tildes, minúsculas), con sus otras formas de escribirlas. */
const ETIQUETAS: Record<string, string> = {
  risa: 'risa',
  risita: 'risita',
  'risa tierna': 'risita',
  'risa nerviosa': 'risa nerviosa',
  je: 'je',
  suspiro: 'suspiro',
  'suspiro cansado': 'suspiro',
  'suspiro aliviado': 'suspiro aliviado',
  'suspiro sonador': 'suspiro soñador',
  sorpresa: 'sorpresa',
  asombro: 'asombro',
  mmm: 'mmm',
  'mmm rico': 'mmm rico',
  hmm: 'hmm',
  bostezo: 'bostezo',
  aja: 'ajá',
  eso: 'eso',
  auch: 'auch',
  ay: 'auch',
  shh: 'shh',
  ups: 'ups',
  beso: 'beso',
  ooh: 'ooh',
  aww: 'aww',
  respiro: 'respiro',
  bufido: 'bufido',
};

export function normalizarEtiqueta(s: string): string {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** La etiqueta canónica («suspiro soñador»), o null si no es una expresión grabada. */
export function expresionDe(etiqueta: string): string | null {
  return ETIQUETAS[normalizarEtiqueta(etiqueta)] || null;
}

const PARECE_ETIQUETA = /^[a-záéíóúüñ][a-záéíóúüñ ,'-]{0,38}$/;

/**
 * Para LEER: sin expresiones ni etiquetas de audio. No toca `[1]` ni enlaces `[texto](url)`. No
 * recorta los bordes (se usa también con trozos del stream que se pegan).
 */
export function quitarExpresiones(texto: string): string {
  let quito = false;
  const sin = String(texto || '').replace(/[ \t]*\[([^\]\n]{1,40})\]/g, (todo: string, dentro: string, donde: number, entero: string) => {
    if (expresionDe(dentro)) {
      quito = true;
      return '';
    }
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

/**
 * Para DECIR: deja las expresiones conocidas, escritas como las entiende el servidor, y quita los
 * demás corchetes (una etiqueta de audio vieja se leería en voz alta).
 */
export function soloExpresiones(texto: string): string {
  return String(texto || '').replace(/\[([^\]]+)\]/g, (_todo, dentro: string) => {
    const e = expresionDe(dentro);
    return e ? `[${e}]` : '';
  });
}
