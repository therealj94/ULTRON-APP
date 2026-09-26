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
export function cifrasAVoz(text: string): string {
  let t = text;
  for (const [re, por] of UNIDADES_HABLADAS) t = t.replace(re, por);
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

/** `max`: una respuesta se corta a 1200 caracteres; un guion largo (la oración) pide más. */
export function afinarParaBoca(text: string, max = 1200): string {
  return cifrasAVoz(
    String(text || '')
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
      .replace(/\bjaja+\b/gi, 'je je')
      .replace(/\blol\b/gi, 'je')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, max)
  );
}
