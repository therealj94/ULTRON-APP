/** Texto que SÍ se dice. Nada en pantalla que la boca no pronuncie. */

const UNIDADES = ['cero', 'uno', 'dos', 'tres', 'cuatro', 'cinco', 'seis', 'siete', 'ocho', 'nueve'];
const DIEZ = ['diez', 'once', 'doce', 'trece', 'catorce', 'quince', 'dieciséis', 'diecisiete', 'dieciocho', 'diecinueve'];
const DECENAS = ['', '', 'veinte', 'treinta', 'cuarenta', 'cincuenta', 'sesenta', 'setenta', 'ochenta', 'noventa'];

/** «uno» delante de «mil» o de «millones» se apocopa: «veintiún mil», «treinta y un mil», «un millón». */
function apocope(s: string): string {
  return s.replace(/veintiuno$/, 'veintiún').replace(/\buno$/, 'un');
}

export function numeroEnPalabras(n: number): string {
  if (!Number.isFinite(n)) return String(n);
  if (n < 0) return `menos ${numeroEnPalabras(-n)}`;
  if (n < 10) return UNIDADES[n];
  if (n < 20) return DIEZ[n - 10];
  if (n < 30) return n === 20 ? 'veinte' : n === 21 ? 'veintiuno' : `veinti${UNIDADES[n - 20]}`;
  if (n < 100) {
    const d = Math.floor(n / 10);
    const u = n % 10;
    return u ? `${DECENAS[d]} y ${UNIDADES[u]}` : DECENAS[d];
  }
  if (n < 200) return n === 100 ? 'cien' : `ciento ${numeroEnPalabras(n - 100)}`;
  if (n < 1000) {
    const c = Math.floor(n / 100);
    const r = n % 100;
    const cien = ['', '', 'doscientos', 'trescientos', 'cuatrocientos', 'quinientos', 'seiscientos', 'setecientos', 'ochocientos', 'novecientos'][c];
    return r ? `${cien} ${numeroEnPalabras(r)}` : cien;
  }
  if (n < 1000000) {
    const mil = Math.floor(n / 1000);
    const r = n % 1000;
    const cabeza = mil === 1 ? 'mil' : `${apocope(numeroEnPalabras(mil))} mil`;
    return r ? `${cabeza} ${numeroEnPalabras(r)}` : cabeza;
  }
  if (n < 1e12) {
    const millones = Math.floor(n / 1e6);
    const r = n % 1e6;
    const cabeza = millones === 1 ? 'un millón' : `${apocope(numeroEnPalabras(millones))} millones`;
    return r ? `${cabeza} ${numeroEnPalabras(r)}` : cabeza;
  }
  return String(n);
}

/**
 * Unidades que la boca tiene que decir enteras. Kokoro lee «ha» como el verbo, «g/t» como «ge barra
 * te» y «km» letra por letra. Solo detrás de una cifra, que es donde son unidades y no palabras.
 */
const UNIDADES_HABLADAS: Array<[RegExp, string]> = [
  // Los precios primero: «USD/oz» leído por partes sonaba «u ese de barra onzas».
  [/(\d)\s*(?:USD|US\$)\s*\/\s*oz(?![\p{L}\d])/giu, '$1 dólares la onza'],
  [/(\d)\s*(?:USD|US\$)\s*\/\s*t(?![\p{L}\d])/giu, '$1 dólares por tonelada'],
  [/(\d)\s*(?:USD|US\$)(?![\p{L}\d])/giu, '$1 dólares'],
  [/(\d)\s*g\/t\b/gi, '$1 gramos por tonelada'],
  [/(\d)\s*(?:km²|km2)(?![\p{L}\d])/giu, '$1 kilómetros cuadrados'],
  [/(\d)\s*km(?![\p{L}\d])/giu, '$1 kilómetros'],
  [/(\d)\s*ha(?![\p{L}\d])/giu, '$1 hectáreas'],
  [/(\d)\s*oz(?![\p{L}\d])/giu, '$1 onzas'],
  [/(\d)\s*kg(?![\p{L}\d])/giu, '$1 kilogramos'],
  [/(\d)\s*t(?![\p{L}\d/])/gu, '$1 toneladas'],
  [/(\d)\s*m(?![\p{L}\d²])/gu, '$1 metros'],
  [/(\d)\s*%/g, '$1 por ciento'],
];

/**
 * Las cifras, en palabras. En esta plataforma el punto es de MILES y la coma de decimales, como lo
 * escribe todo el sistema («250.000 toneladas», «3,4 g/t»).
 *
 * Antes cualquier punto se leía como decimal: «250.000 toneladas» sonaba «doscientos cincuenta
 * punto cero cero cero», y «331.497,51 ha», «trescientos treinta y uno punto cuatro nueve siete,
 * cincuenta y uno». Mil veces menos en voz alta que en la pantalla, con la voz de un perito. Ahora:
 *
 *   · «250.000» y «1.200.000» (grupos de tres tras el punto) → miles y millones.
 *   · «3,4» → decimal. «3.4» o «3.4567» (punto sin grupos de tres) → también decimal.
 *   · «0442» (un código con cero delante, como un expediente) → cifra por cifra.
 */
/** Solo las unidades («3,4 g/t» → «3,4 gramos por tonelada»); los números quedan como están. */
export function unidadesAVoz(text: string): string {
  let t = text;
  for (const [re, por] of UNIDADES_HABLADAS) t = t.replace(re, por);
  return t;
}

export function cifrasAVoz(text: string): string {
  const t = unidadesAVoz(text);
  return t.replace(/\d{1,3}(?:\.\d{3})+(?!\d)(?:,\d+)?|\d+,\d+|\d+\.\d+|\d+/g, (raw) => {
    const decimales = (entero: string, d: string) =>
      `${numeroEnPalabras(Number(entero))} punto ${d.split('').map((c) => numeroEnPalabras(Number(c))).join(' ')}`;
    if (/^\d{1,3}(?:\.\d{3})+/.test(raw)) {
      const [miles, d] = raw.split(',');
      const n = Number(miles.replace(/\./g, ''));
      if (!Number.isFinite(n) || n >= 1e12) return raw;
      return d ? decimales(String(n), d) : numeroEnPalabras(n);
    }
    if (raw.includes(',') || raw.includes('.')) {
      const [e, d] = raw.split(/[.,]/);
      if (Number(e) >= 1e12) return raw;
      return decimales(e, d);
    }
    if (raw.length > 1 && raw.startsWith('0')) return raw.split('').map((c) => numeroEnPalabras(Number(c))).join(' ');
    const n = Number(raw);
    if (n >= 1e12) return raw;
    return numeroEnPalabras(n);
  });
}

/**
 * LOS CÓDIGOS, CIFRA POR CIFRA, TAMBIÉN CON ELEVENLABS. Con `cifras: false` (la voz de ElevenLabs lee los números por su
 * cuenta) un expediente «0442» o «PL-0087-2019» sonaba «cuatrocientos cuarenta y dos»: el cero de delante dice que es un
 * código, no una cantidad. Solo eso: un grupo de 3 o más cifras que empieza en cero, suelto (no dentro de 3,05 ni de
 * 1.050), pasa a sus cifras separadas. Lo usa la voz de Dr Electrum (server/voz.ts).
 */
export function codigosAVoz(text: string): string {
  return String(text || '').replace(/(?<![\d.,])0\d{2,}(?![\d]|[.,]\d)/g, (c) => c.split('').join(' '));
}

/* ---------------- Cómo se dice en Honduras (10-oct) ---------------- */

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

/** Un número delante de un sustantivo masculino: «veintiún lempiras», «un lempira», «treinta y un». */
function cuantos(n: number): string {
  return apocope(numeroEnPalabras(n));
}

/**
 * Una cantidad de dinero como la escribe Honduras: «1,500», «1,500.50» (coma de miles, punto de centavos), pero también
 * la del resto del sistema («1.500», «1.500,50») y la cifra sola. null si no es una cantidad.
 */
function cantidadDinero(raw: string): { enteros: number; centavos: number } | null {
  const r = raw.trim();
  let m: RegExpExecArray | null;
  const centavosDe = (c?: string) => (c ? Number(c.padEnd(2, '0').slice(0, 2)) : 0);
  if ((m = /^(\d{1,3}(?:,\d{3})+)(?:\.(\d{1,2}))?$/.exec(r))) return { enteros: Number(m[1].replace(/,/g, '')), centavos: centavosDe(m[2]) };
  if ((m = /^(\d{1,3}(?:\.\d{3})+)(?:,(\d{1,2}))?$/.exec(r))) return { enteros: Number(m[1].replace(/\./g, '')), centavos: centavosDe(m[2]) };
  if ((m = /^(\d+)(?:[.,](\d{1,2}))?$/.exec(r))) return { enteros: Number(m[1]), centavos: centavosDe(m[2]) };
  return null;
}

function lempirasEnPalabras(raw: string): string | null {
  const c = cantidadDinero(raw);
  if (!c || !Number.isFinite(c.enteros) || c.enteros >= 1e12) return null;
  const enteros = c.enteros === 1 ? 'un lempira' : `${cuantos(c.enteros)} ${c.enteros >= 1e6 && c.enteros % 1e6 === 0 ? 'de lempiras' : 'lempiras'}`;
  return c.centavos ? `${enteros} con ${cuantos(c.centavos)} ${c.centavos === 1 ? 'centavo' : 'centavos'}` : enteros;
}

/** Dos cifras como se dicen en un teléfono: «98» → «noventa y ocho», «05» → «cero cinco», «00» → «cero cero». */
function parDeCifras(par: string): string {
  if (par.length === 1) return numeroEnPalabras(Number(par));
  return par[0] === '0' ? `cero ${numeroEnPalabras(Number(par[1]))}` : numeroEnPalabras(Number(par));
}

function telefonoEnPalabras(codigo: boolean, ocho: string): string {
  const pares = ocho.match(/\d{2}/g) || [];
  return `${codigo ? 'más quinientos cuatro, ' : ''}${pares.map(parDeCifras).join(', ')}`;
}

/** La hora dicha: «3:00 p. m.» → «tres de la tarde», «8:30 a. m.» → «ocho y media de la mañana», «12:00 p. m.» → «doce del mediodía». */
function horaEnPalabras(h: number, min: number, sufijo: 'am' | 'pm' | null): string | null {
  if (!Number.isInteger(h) || !Number.isInteger(min) || min > 59) return null;
  let h24: number;
  if (sufijo) {
    if (h < 1 || h > 12) return null;
    h24 = sufijo === 'am' ? (h === 12 ? 0 : h) : h === 12 ? 12 : h + 12;
  } else {
    if (h > 23) return null;
    h24 = h;
  }
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  const hora = h12 === 1 ? 'una' : numeroEnPalabras(h12);
  const minutos = min === 0 ? '' : min === 15 ? ' y cuarto' : min === 30 ? ' y media' : ` y ${numeroEnPalabras(min)}`;
  // Sin «a. m.»/«p. m.» y con una hora de 1 a 12, no se adivina la parte del día.
  if (!sufijo && h24 >= 1 && h24 <= 12) return `${hora}${minutos}`;
  const parte = h24 === 0 ? 'de la noche' : h24 < 5 ? 'de la madrugada' : h24 < 12 ? 'de la mañana' : h24 === 12 ? 'del mediodía' : h24 < 19 ? 'de la tarde' : 'de la noche';
  return `${hora}${minutos} ${parte}`;
}

/** Siglas que se deletrean, con el nombre de cada letra en español. */
const SIGLAS_DELETREADAS: Record<string, string> = {
  ENEE: 'e ene e e',
  RTN: 'erre te ene',
  IHSS: 'i hache ese ese',
  SAR: 'ese a erre',
};

/** Nombres propios que la voz deletreaba o leía mal. */
const NOMBRES_HABLADOS: Array<[RegExp, string]> = [
  [/\bAU-?RA\b/g, 'Aura'],
  [/\bANT-ONIO\b/g, 'Antonio'],
  [/\bPULSE\s?2\s?CHAT\b/gi, 'Pulse tu chat'],
  [/\bGenesis\s+ID\b/gi, 'Génesis ai di'],
  [/\bSPS\b/g, 'San Pedro Sula'],
];

/**
 * Lo que nunca se toca: un enlace, un correo o un código con letras y cifras mezcladas («PL-0087-2019», «A1B2C3»). El
 * dinero escrito pegado («L1,500») no es un código.
 */
const ENLACE = /(?:https?:\/\/|www\.)[^\s<>"')\]]+|[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g;
const PROTEGIDO = /(?:https?:\/\/|www\.)[^\s<>"')\]]+|[\w.+-]+@[\w-]+(?:\.[\w-]+)+|\b(?=[A-Za-z0-9-]*[A-Za-z])(?=[A-Za-z0-9-]*\d)[A-Za-z0-9]+(?:-[A-Za-z0-9]+)+\b|\b(?!L\d)(?=[A-Za-z]*\d)(?=\d*[A-Za-z])[A-Za-z\d]{3,}\b/g;

/** Aplica `fn` solo a lo que no está protegido (por omisión: enlaces, correos y códigos). */
function fueraDeCodigos(texto: string, fn: (t: string) => string, protegido = PROTEGIDO): string {
  let out = '';
  let desde = 0;
  protegido.lastIndex = 0;
  for (let m = protegido.exec(texto); m; m = protegido.exec(texto)) {
    out += fn(texto.slice(desde, m.index)) + m[0];
    desde = m.index + m[0].length;
  }
  return out + fn(texto.slice(desde));
}

/**
 * LO HONDUREÑO, COMO SE DICE (10-oct). Puro, sin red: lo usa todo lo que habla en español (afinarParaBoca: la mesa, el
 * teléfono, Windows, Dr Electrum y la llamada pasan por ahí):
 *
 *   · fechas día/mes: «05/10» → «5 de octubre»; «05/10/2026» → «5 de octubre de 2026»;
 *   · lempiras: «L. 1,500», «L1,500.50», «Lps. 300», «HNL 1,500», «1,500 HNL» → «mil quinientos lempiras (con
 *     cincuenta centavos)»;
 *   · teléfonos: «+504 9876-5432» o «9876-5432» → de dos en dos («más quinientos cuatro, noventa y ocho, setenta y seis…»);
 *   · la hora: «3:00 p. m.» → «tres de la tarde»; «a las 15:30» → «a las tres y media de la tarde»;
 *   · nombres: AU-RA → Aura, ANT-ONIO → Antonio, PULSE2CHAT → «Pulse tu chat», Genesis ID, SPS → San Pedro Sula;
 *   · siglas deletreadas: ENEE, RTN, IHSS, SAR.
 *
 * Nunca toca las cifras de un enlace, un correo o un código («PL-0087-2019»).
 */
export function hondurenoAVoz(texto: string): string {
  // Los nombres primero (fuera de enlaces y correos): «PULSE2CHAT» tiene letras y cifras, pero no es un código.
  const conNombres = fueraDeCodigos(String(texto || ''), (t) => NOMBRES_HABLADOS.reduce((s, [re, por]) => s.replace(re, por), t), ENLACE);
  return fueraDeCodigos(conNombres, (t) => {
    let s = t;
    s = s.replace(/\b(ENEE|RTN|IHSS|SAR)\b/g, (m) => SIGLAS_DELETREADAS[m]);
    // Dinero: antes que la hora y las fechas («L. 1,500.50» lleva punto y coma).
    s = s.replace(/(?<![\p{L}\d])(?:L|Lps|HNL)\.?\s?(\d(?:[\d.,]*\d)?)(?![\d\p{L}])/gu, (m, n: string) => lempirasEnPalabras(n) ?? m);
    s = s.replace(/(?<![\p{L}\d.,])(\d(?:[\d.,]*\d)?)\s?(?:HNL|lempiras?)(?![\p{L}])/gu, (m, n: string) => lempirasEnPalabras(n) ?? m);
    // Teléfonos de Honduras: ocho cifras (4-4) con +504, o con su guion («9876-5432»). «2020-2024» son años, no un teléfono.
    s = s.replace(/(?<![\d+.,])(\+504[\s-]?)?([2-9]\d{3})([\s-]?)(\d{4})(?![\d.,]\d|\d)/g, (m, cod: string | undefined, a: string, sep: string, b: string) => {
      if (!cod && sep !== '-') return m;
      if (!cod && /^(19|20)\d\d$/.test(a) && /^(19|20)\d\d$/.test(b)) return m;
      return telefonoEnPalabras(!!cod, a + b);
    });
    // La hora con a. m./p. m. (o la de 24 h tras «las»/«la»: «Juan 3:16» no es una hora).
    s = s.replace(/\b(\d{1,2})(?::(\d{2}))?\s?([ap])\.?\s?m(\.?)(?![\p{L}])/giu, (m, h: string, mm: string | undefined, ap: string, punto: string, donde: number, entero: string) => {
      const dicha = horaEnPalabras(Number(h), Number(mm || 0), ap.toLowerCase() === 'a' ? 'am' : 'pm');
      if (!dicha) return m;
      // El punto de «p. m.» al final de la frase también la cierra: se queda («…a las tres de la tarde. Luego…»).
      const resto = entero.slice(donde + m.length);
      return punto && (!resto.trim() || /^\s+\p{Lu}/u.test(resto)) ? `${dicha}.` : dicha;
    });
    s = s.replace(/\b(las?|a las?|desde las?|hasta las?)\s(\d{1,2}):(\d{2})(?![\d:])/gi, (m, ante: string, h: string, mm: string) => {
      const dicha = horaEnPalabras(Number(h), Number(mm), null);
      return dicha ? `${ante} ${dicha}` : m;
    });
    // Fechas día/mes(/año), como se escriben en Honduras. Una fracción («3/4 de taza», «1/2») no es fecha: solo con año,
    // con las dos cifras («05/10») o detrás de «el», «del», «al», «día», «fecha».
    s = s.replace(/(?<![\d/.,])(\d{1,2})\/(\d{1,2})(?:\/(\d{4}|\d{2}))?(?![\d/])/g, (m, d: string, mes: string, anio: string | undefined, donde: number, entero: string) => {
      const dia = Number(d);
      const nm = Number(mes);
      if (dia < 1 || dia > 31 || nm < 1 || nm > 12) return m;
      const contexto = /\b(el|del|al|d[ií]a|fecha|hoy|vence|hasta|desde)\s+$/i.test(entero.slice(Math.max(0, donde - 12), donde));
      if (!anio && !(d.length === 2 && mes.length === 2) && !contexto) return m;
      const a = anio ? (anio.length === 2 ? `20${anio}` : anio) : '';
      return `${dia} de ${MESES[nm - 1]}${a ? ` de ${a}` : ''}`;
    });
    return s;
  });
}

export const RELLENOS = [
  'Mmm.',
  'Déjame ver.',
  'Déjame revisar.',
  'Un segundo.',
  'A ver.',
  'Ok, reviso.',
];

export function rellenoAzar(): string {
  return RELLENOS[Math.floor(Math.random() * RELLENOS.length)];
}

/**
 * `max`: una respuesta se corta a 1200 caracteres; un guion largo (la oración) pide más.
 * `cifras: false` deja los números en dígitos: ElevenLabs los lee mejor por su cuenta (concuerda
 * el género, «mil doscientas hectáreas», y dice las fechas como fechas). Kokoro no: a él sí se le dan en palabras.
 */
/**
 * Lo mismo para una respuesta en inglés: fuera markdown y emojis, «AU-RA» se dice «Aura», pero sin
 * pasar cifras ni unidades a palabras en español (ElevenLabs los lee bien en inglés por su cuenta).
 */
export function afinarParaBocaIngles(text: string, max = 1200): string {
  return String(text || '')
    .replace(/\*+/g, '')
    .replace(/#+\s?/g, '')
    .replace(/`+/g, '')
    .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, '')
    .replace(/\s*—\s*/g, ', ')
    .replace(/\bAU-?RA\b/g, 'Aura')
    .replace(/\bANT-ONIO\b/g, 'Antonio')
    .replace(/\bSPS\b/g, 'San Pedro Sula')
    .replace(/\b(ja){2,}\b/gi, 'ha ha')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

export function afinarParaBoca(text: string, max = 1200, opciones: { cifras?: boolean } = {}): string {
  return (opciones.cifras === false ? unidadesAVoz : cifrasAVoz)(
    hondurenoAVoz(String(text || ''))
      .replace(/\*+/g, '')
      .replace(/#+\s?/g, '')
      .replace(/`+/g, '')
      .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, '')
      // Coma y no punto. Un punto exige entonación de cierre y mayúscula detrás, y esto dejaba
      // «Vamos por partes. primero el derecho minero»: la voz lee ahí un fin de frase que la
      // gramática no tiene, y suena a alguien que se corta a media idea. La coma da la misma pausa.
      .replace(/\s*—\s*/g, ', ')
      .replace(/:\s+/g, ', ')
      // «AU-RA» se escribe con guion y mayúsculas, y la voz lo deletrea («a, u, erre, a»). Se dice «Aura».
      .replace(/\bAU-?RA\b/g, 'Aura')
      // «Dr Electrum» se leía «de erre Electrum».
      .replace(/\bDr\.?\s+(?=\p{Lu})/gu, 'Doctor ')
      .replace(/\bDra\.?\s+(?=\p{Lu})/gu, 'Doctora ')
      .replace(/\bjaja+\b/gi, 'je je')
      .replace(/\blol\b/gi, 'je')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, max)
  );
}
