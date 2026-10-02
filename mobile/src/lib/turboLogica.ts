/**
 * Lo que decide el oído Turbo sin tocar el micrófono ni la red (se prueba en Node): cuándo hay voz,
 * cuándo terminó la frase, qué frases se confirman con Scribe v2 y cómo se arma el WAV de una frase.
 * El motor que lo usa es speechTurbo.ts.
 */

/** Umbral de voz: 12 dB sobre el ruido de fondo, nunca más permisivo que -52 dBFS ni más estricto que -28. */
export function umbralVoz(ruido: number): number {
  return Math.min(-28, Math.max(-52, ruido + 12));
}

/** Nivel 0..1 para la cara (el anillo late con la voz de la persona). */
export function nivelDeDb(db: number, ruido: number): number {
  return Math.max(0, Math.min(1, (db - (umbralVoz(ruido) - 10)) / 40));
}

/** El ruido de fondo se sigue solo cuando no hay voz (media móvil lenta). */
export function seguirRuido(ruido: number, db: number): number {
  return ruido * 0.92 + Math.max(-90, db) * 0.08;
}

/** Palabras con las que una frase no termina: si lo último que oyó es una de estas, espera más. */
const SIGUE = new Set(
  (
    'y e o u ni de del a al en con por para sin sobre entre hacia hasta desde que qué el la los las lo un una unos unas mi mis tu tus su sus ' +
    'pero porque como cuando si donde mientras aunque pues entonces o sea este esta ese esa le les me te se nos ' +
    'and or but the a an to of for with in on at my your his her their our if when because so that this'
  ).split(/\s+/)
);

export const SILENCIO_BASE_MS = 480;
export const SILENCIO_CORTO_MS = 340;
export const SILENCIO_SIN_TEXTO_MS = 650;
export const SILENCIO_LARGO_MS = 1000;

/**
 * Cuánto silencio cierra la frase, según lo último que Turbo ya entendió (los parciales llegan mientras
 * se habla). Con punto o signo de pregunta al final, corto; si se quedó en «y», «de», «para»… o en una
 * palabra cortada, se espera a que siga; sin texto todavía, un poco más que lo normal.
 */
export function silencioParaCerrar(parcial: string): number {
  const t = parcial.trim();
  if (!t) return SILENCIO_SIN_TEXTO_MS;
  if (/[-–,:;]$/.test(t)) return SILENCIO_LARGO_MS;
  if (/[.?!¿¡…]$/.test(t)) return SILENCIO_CORTO_MS;
  const ultima = t.toLowerCase().split(/\s+/).pop()!.replace(/[^a-záéíóúüñ]/g, '');
  if (SIGUE.has(ultima)) return SILENCIO_LARGO_MS;
  return SILENCIO_BASE_MS;
}

/**
 * Frases de dinero: se vuelven a oír con Scribe v2 antes de actuar (José, 2-oct: «Turbo + confirmar
 * dinero»). La misma expresión que lib/oido.ts del servidor (una prueba lo comprueba).
 */
export const FRASE_DE_DINERO =
  /\b(pag[aáoeu]\w*|envi[aáeé]\w*|env[ií]\w*|m[aá]nd\w*|transfi?er\w*|deposit\w*|cobr\w*|presta\w*|origen|auka|agka|veta|wallet|cartera|billetera|saldo|d[oó]lar\w*|lempira\w*|usd|pesos?|plata|dinero|monto|precio|cuesta|cu[aá]nto|pay\w*|send\w*|transfer\w*|dollars?|money|balance|price|cost|how much)\b|\$|\d/i;

export function esFraseDeDinero(texto: string): boolean {
  return FRASE_DE_DINERO.test(texto);
}

/** Lo que Turbo a veces devuelve sin voz de verdad. */
const BASURA = /^(subt[ií]tulos.*|gracias por ver.*|suscr[ií]bete.*|\.+|…|music|\[.*\]|\(.*\))$/i;

/** Texto final limpio: sin comillas que lo envuelvan; vacío si no hay nada que hacer con él. */
export function limpiarFinal(texto: string): string {
  const t = String(texto || '')
    .trim()
    .replace(/^["“«]\s*([\s\S]*?)\s*["”»]\.?$/, '$1')
    .trim();
  return t.length < 2 || BASURA.test(t) ? '' : t;
}

// ── base64 a mano (sin Buffer en el teléfono) ───────────────────────────────────────────────────────
const ABC = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const INV = new Int16Array(128).fill(-1);
for (let i = 0; i < ABC.length; i++) INV[ABC.charCodeAt(i)] = i;

export function deBase64(b64: string): Uint8Array {
  const limpio = b64.replace(/[^A-Za-z0-9+/]/g, '');
  const n = Math.floor((limpio.length * 3) / 4);
  const out = new Uint8Array(n);
  let o = 0;
  for (let i = 0; i < limpio.length; i += 4) {
    const a = INV[limpio.charCodeAt(i)];
    const b = INV[limpio.charCodeAt(i + 1)];
    const c = i + 2 < limpio.length ? INV[limpio.charCodeAt(i + 2)] : -1;
    const d = i + 3 < limpio.length ? INV[limpio.charCodeAt(i + 3)] : -1;
    out[o++] = (a << 2) | (b >> 4);
    if (c >= 0 && o < n) out[o++] = ((b & 15) << 4) | (c >> 2);
    if (d >= 0 && o < n) out[o++] = ((c & 3) << 6) | d;
  }
  return out.subarray(0, o);
}

export function aBase64(bytes: Uint8Array): string {
  let s = '';
  let i = 0;
  for (; i + 2 < bytes.length; i += 3) {
    const v = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
    s += ABC[v >> 18] + ABC[(v >> 12) & 63] + ABC[(v >> 6) & 63] + ABC[v & 63];
  }
  if (i < bytes.length) {
    const v = (bytes[i] << 16) | ((bytes[i + 1] ?? 0) << 8);
    s += ABC[v >> 18] + ABC[(v >> 12) & 63] + (i + 1 < bytes.length ? ABC[(v >> 6) & 63] : '=') + '=';
  }
  return s;
}

/** Los trozos PCM (base64) de una frase, en un WAV 16 bits mono, en base64: para /api/stt. */
export function wavDeTrozos(trozos: string[], frecuencia = 16000): string {
  const partes = trozos.map(deBase64);
  const largo = partes.reduce((s, p) => s + p.length, 0);
  const wav = new Uint8Array(44 + largo);
  const v = new DataView(wav.buffer);
  const ascii = (o: number, s: string) => [...s].forEach((c, i) => (wav[o + i] = c.charCodeAt(0)));
  ascii(0, 'RIFF');
  v.setUint32(4, 36 + largo, true);
  ascii(8, 'WAVE');
  ascii(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, frecuencia, true);
  v.setUint32(28, frecuencia * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  ascii(36, 'data');
  v.setUint32(40, largo, true);
  let o = 44;
  for (const p of partes) {
    wav.set(p, o);
    o += p.length;
  }
  return aBase64(wav);
}

/** 10 ms de silencio: el trozo que lleva el «commit» cuando la frase ya se mandó entera. */
export const SILENCIO_COMMIT_B64 = aBase64(new Uint8Array(320));
