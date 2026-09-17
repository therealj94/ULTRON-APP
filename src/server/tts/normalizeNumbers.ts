/**
 * Normalizador de números / fechas / monedas → español hablado (LATAM).
 * Máx. 2 dígitos decimales. Se aplica ANTES de enviar a TTS.
 */

const UNIDADES = [
  'cero',
  'uno',
  'dos',
  'tres',
  'cuatro',
  'cinco',
  'seis',
  'siete',
  'ocho',
  'nueve',
  'diez',
  'once',
  'doce',
  'trece',
  'catorce',
  'quince',
  'dieciséis',
  'diecisiete',
  'dieciocho',
  'diecinueve',
];
const DECENAS = [
  '',
  '',
  'veinte',
  'treinta',
  'cuarenta',
  'cincuenta',
  'sesenta',
  'setenta',
  'ochenta',
  'noventa',
];
const CENTENAS = [
  '',
  'ciento',
  'doscientos',
  'trescientos',
  'cuatrocientos',
  'quinientos',
  'seiscientos',
  'setecientos',
  'ochocientos',
  'novecientos',
];
const MESES = [
  '',
  'enero',
  'febrero',
  'marzo',
  'abril',
  'mayo',
  'junio',
  'julio',
  'agosto',
  'septiembre',
  'octubre',
  'noviembre',
  'diciembre',
];

function bajoCien(n: number, femenino = false): string {
  if (n < 20) {
    if (n === 1 && femenino) return 'una';
    return UNIDADES[n];
  }
  if (n < 30) {
    if (n === 20) return 'veinte';
    const u = n - 20;
    if (u === 1 && femenino) return 'veintiuna';
    return `veinti${UNIDADES[u].replace('ú', 'u')}`;
  }
  const d = Math.floor(n / 10);
  const u = n % 10;
  if (u === 0) return DECENAS[d];
  const unit = u === 1 && femenino ? 'una' : UNIDADES[u];
  return `${DECENAS[d]} y ${unit}`;
}

function bajoMil(n: number, femenino = false): string {
  if (n < 100) return bajoCien(n, femenino);
  if (n === 100) return 'cien';
  const c = Math.floor(n / 100);
  const r = n % 100;
  const head = CENTENAS[c];
  if (r === 0) return head;
  return `${head} ${bajoCien(r, femenino)}`;
}

/** Entero ≥ 0 → palabras. */
export function integerToSpanish(n: number, femenino = false): string {
  if (!Number.isFinite(n) || n < 0) return String(n);
  n = Math.floor(n);
  if (n < 1000) return bajoMil(n, femenino);

  if (n < 1_000_000) {
    const miles = Math.floor(n / 1000);
    const r = n % 1000;
    const head = miles === 1 ? 'mil' : `${bajoMil(miles)} mil`;
    return r === 0 ? head : `${head} ${bajoMil(r, femenino)}`;
  }

  if (n < 1_000_000_000) {
    const millones = Math.floor(n / 1_000_000);
    const r = n % 1_000_000;
    const head =
      millones === 1 ? 'un millón' : `${bajoMil(millones)} millones`;
    return r === 0 ? head : `${head} ${integerToSpanish(r, femenino)}`;
  }

  // mil millones (LATAM; no "billón" US)
  const milMillones = Math.floor(n / 1_000_000_000);
  const r = n % 1_000_000_000;
  const head =
    milMillones === 1 ? 'mil millones' : `${bajoMil(milMillones)} mil millones`;
  return r === 0 ? head : `${head} ${integerToSpanish(r, femenino)}`;
}

function parseGroupedNumber(raw: string): number | null {
  // 1.234.567 or 1,234,567 or 15,000
  const s = raw.trim();
  if (/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(s)) {
    // EU/LATAM grouping with dot thousands, comma decimal
    const [intPart, dec] = s.split(',');
    const n = Number(intPart.replace(/\./g, '') + (dec != null ? `.${dec.slice(0, 2)}` : ''));
    return Number.isFinite(n) ? n : null;
  }
  if (/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(s)) {
    const [intPart, dec] = s.split('.');
    const n = Number(intPart.replace(/,/g, '') + (dec != null ? `.${dec.slice(0, 2)}` : ''));
    return Number.isFinite(n) ? n : null;
  }
  if (/^\d+[.,]\d+$/.test(s)) {
    const n = Number(s.replace(',', '.'));
    return Number.isFinite(n) ? n : null;
  }
  if (/^\d+$/.test(s)) return Number(s);
  return null;
}

function decimalToSpanish(n: number): string {
  const sign = n < 0 ? 'menos ' : '';
  n = Math.abs(n);
  const intPart = Math.floor(n);
  let frac = Math.round((n - intPart) * 100);
  if (frac === 100) {
    return sign + integerToSpanish(intPart + 1);
  }
  if (frac === 0) return sign + integerToSpanish(intPart);
  // trim trailing zero → one digit if xx0
  const digits =
    frac % 10 === 0
      ? integerToSpanish(Math.floor(frac / 10))
      : integerToSpanish(frac);
  return `${sign}${integerToSpanish(intPart)} punto ${digits}`;
}

function dateToSpanish(d: number, m: number, y: number): string | null {
  if (m < 1 || m > 12 || d < 1 || d > 31 || y < 1000) return null;
  return `${integerToSpanish(d)} de ${MESES[m]} de ${integerToSpanish(y)}`;
}

/**
 * Reemplaza números, %, fechas y monedas en el texto por forma hablada.
 */
export function normalizeNumbersForSpeech(text: string): string {
  if (!text) return text;
  let out = text;

  // Fechas dd/mm/yyyy o dd-mm-yyyy
  out = out.replace(/\b(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})\b/g, (_, d, m, y) => {
    return dateToSpanish(Number(d), Number(m), Number(y)) || _;
  });

  // Monedas $1,500.50 o $1500.50 o USD 1500
  out = out.replace(
    /(?:USD\s*)?\$\s*(\d{1,3}(?:,\d{3})*(?:\.\d+)?|\d+(?:\.\d+)?)/gi,
    (_, num) => {
      const n = parseGroupedNumber(String(num).includes(',') ? String(num) : String(num));
      if (n == null) return _;
      const intPart = Math.floor(Math.abs(n));
      const cents = Math.round((Math.abs(n) - intPart) * 100);
      let s = `${integerToSpanish(intPart)} dólares`;
      if (cents > 0) s += ` con ${integerToSpanish(cents)} centavos`;
      return s;
    }
  );

  // Porcentajes 25% o 25.5%
  out = out.replace(/(\d{1,3}(?:[.,]\d+)?)\s*%/g, (_, num) => {
    const n = Number(String(num).replace(',', '.'));
    if (!Number.isFinite(n)) return _;
    const spoken =
      Number.isInteger(n) || Math.abs(n - Math.round(n)) < 1e-9
        ? integerToSpanish(Math.round(n))
        : decimalToSpanish(n);
    return `${spoken} por ciento`;
  });

  // Números con separadores de miles / decimales
  out = out.replace(
    /\b\d{1,3}(?:[.,]\d{3})+(?:[.,]\d+)?\b|\b\d+[.,]\d+\b|\b\d{4,}\b/g,
    (raw) => {
      // avoid years already spoken in dates — years 19xx/20xx alone: read as number ok
      const n = parseGroupedNumber(raw);
      if (n == null) return raw;
      if (String(raw).includes('.') || String(raw).includes(',')) {
        // if only thousand grouping (no decimal part with ≤2 digits ambiguity)
        if (/^\d{1,3}([.,]\d{3})+$/.test(raw)) return integerToSpanish(n);
        return decimalToSpanish(n);
      }
      return integerToSpanish(n);
    }
  );

  return out;
}
