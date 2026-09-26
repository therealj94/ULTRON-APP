/** Texto que SÍ se dice. Nada en pantalla que la boca no pronuncie. */

const UNIDADES = ['cero', 'uno', 'dos', 'tres', 'cuatro', 'cinco', 'seis', 'siete', 'ocho', 'nueve'];
const DIEZ = ['diez', 'once', 'doce', 'trece', 'catorce', 'quince', 'dieciséis', 'diecisiete', 'dieciocho', 'diecinueve'];
const DECENAS = ['', '', 'veinte', 'treinta', 'cuarenta', 'cincuenta', 'sesenta', 'setenta', 'ochenta', 'noventa'];

export function numeroEnPalabras(n: number): string {
  if (!Number.isFinite(n)) return String(n);
  if (n < 0) return `menos ${numeroEnPalabras(-n)}`;
  if (n < 10) return UNIDADES[n];
  if (n < 20) return DIEZ[n - 10];
  if (n < 30) return n === 20 ? 'veinte' : `veinti${UNIDADES[n - 20].replace('uno', 'ún')}`;
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
    const cabeza = mil === 1 ? 'mil' : `${numeroEnPalabras(mil)} mil`;
    return r ? `${cabeza} ${numeroEnPalabras(r)}` : cabeza;
  }
  return String(n);
}

export function cifrasAVoz(text: string): string {
  return text.replace(/\d{1,6}(?:[.,]\d+)?/g, (raw) => {
    const norm = raw.replace(',', '.');
    const n = Number(norm);
    if (!Number.isFinite(n)) return raw;
    if (n >= 1000000) return raw;
    if (raw.includes('.') || raw.includes(',')) {
      const [e, d] = norm.split('.');
      return `${numeroEnPalabras(Number(e))} punto ${d.split('').map((c) => numeroEnPalabras(Number(c))).join(' ')}`;
    }
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
