/**
 * CÓDIGO QR, SIN LIBRERÍAS: para «Recibir» en Veta Wallet (José, 3-oct: «una billetera completa»). Una
 * librería nueva cambiaría la huella de la APK y obligaría a instalar otra; esto es TypeScript puro y viaja
 * por OTA. Sigue la norma ISO/IEC 18004 (como la implementación de referencia de Nayuki):
 *
 *   · modo byte (UTF-8), corrección de errores M (aguanta ~15 % del código tapado o sucio);
 *   · versiones 1 a 10 (hasta 213 bytes: una dirección 0x… cabe en la 3);
 *   · las 8 máscaras, y se queda con la de menor penalización (la más fácil de leer para una cámara).
 *
 * Devuelve la matriz: true = módulo oscuro, [fila][columna]. Sin margen (lo pone quien dibuja: 4 módulos).
 * Probado en Node y leído de vuelta con el lector de QR de OpenCV (tests/cartera-qr.test.ts).
 */

/** Por versión (1..10) con corrección M: [códigos de corrección por bloque, bloques y datos de cada grupo]. */
const BLOQUES_M: readonly (readonly [number, number, number, number, number])[] = [
  [10, 1, 16, 0, 0],
  [16, 1, 28, 0, 0],
  [26, 1, 44, 0, 0],
  [18, 2, 32, 0, 0],
  [24, 2, 43, 0, 0],
  [16, 4, 27, 0, 0],
  [18, 4, 31, 0, 0],
  [22, 2, 38, 2, 39],
  [22, 3, 36, 2, 37],
  [26, 4, 43, 1, 44],
];

/** Centros de los patrones de alineación por versión (la 1 no tiene). */
const ALINEACION: readonly (readonly number[])[] = [[], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34], [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50]];

export const VERSION_MAXIMA = 10;

/** Cuántos bytes caben en cada versión (modo byte, corrección M). */
export function capacidad(version: number): number {
  const [, b1, d1, b2, d2] = BLOQUES_M[version - 1];
  const datos = b1 * d1 + b2 * d2;
  const cuenta = version < 10 ? 8 : 16;
  return Math.floor((datos * 8 - 4 - cuenta) / 8);
}

function utf8(texto: string): number[] {
  const s = unescape(encodeURIComponent(texto));
  const r: number[] = [];
  for (let i = 0; i < s.length; i++) r.push(s.charCodeAt(i));
  return r;
}

/* ── Reed-Solomon en GF(256), polinomio 0x11D ─────────────────────────────────────────────── */

function mul(x: number, y: number): number {
  let z = 0;
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d);
    z ^= ((y >>> i) & 1) * x;
  }
  return z & 0xff;
}

function divisor(grado: number): number[] {
  const r = new Array<number>(grado).fill(0);
  r[grado - 1] = 1;
  let raiz = 1;
  for (let i = 0; i < grado; i++) {
    for (let j = 0; j < r.length; j++) {
      r[j] = mul(r[j], raiz);
      if (j + 1 < r.length) r[j] ^= r[j + 1];
    }
    raiz = mul(raiz, 0x02);
  }
  return r;
}

function resto(datos: number[], div: number[]): number[] {
  const r = new Array<number>(div.length).fill(0);
  for (const b of datos) {
    const f = b ^ (r.shift() as number);
    r.push(0);
    for (let i = 0; i < div.length; i++) r[i] ^= mul(div[i], f);
  }
  return r;
}

/* ── la matriz ────────────────────────────────────────────────────────────────────────────── */

const bit = (x: number, i: number) => ((x >>> i) & 1) !== 0;

function enmascarar(m: number, x: number, y: number): boolean {
  switch (m) {
    case 0: return (x + y) % 2 === 0;
    case 1: return y % 2 === 0;
    case 2: return x % 3 === 0;
    case 3: return (x + y) % 3 === 0;
    case 4: return (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0;
    case 5: return ((x * y) % 2) + ((x * y) % 3) === 0;
    case 6: return (((x * y) % 2) + ((x * y) % 3)) % 2 === 0;
    default: return (((x + y) % 2) + ((x * y) % 3)) % 2 === 0;
  }
}

class Matriz {
  readonly n: number;
  readonly m: boolean[][];
  readonly fija: boolean[][];
  constructor(readonly version: number) {
    this.n = version * 4 + 17;
    this.m = Array.from({ length: this.n }, () => new Array<boolean>(this.n).fill(false));
    this.fija = Array.from({ length: this.n }, () => new Array<boolean>(this.n).fill(false));
  }
  /** x = columna, y = fila. */
  poner(x: number, y: number, v: boolean) {
    this.m[y][x] = v;
    this.fija[y][x] = true;
  }

  patrones() {
    const n = this.n;
    for (let i = 0; i < n; i++) {
      this.poner(6, i, i % 2 === 0);
      this.poner(i, 6, i % 2 === 0);
    }
    const buscador = (cx: number, cy: number) => {
      for (let dy = -4; dy <= 4; dy++)
        for (let dx = -4; dx <= 4; dx++) {
          const x = cx + dx;
          const y = cy + dy;
          if (x < 0 || y < 0 || x >= n || y >= n) continue;
          const d = Math.max(Math.abs(dx), Math.abs(dy));
          this.poner(x, y, d !== 2 && d !== 4);
        }
    };
    buscador(3, 3);
    buscador(n - 4, 3);
    buscador(3, n - 4);
    const al = ALINEACION[this.version - 1];
    const k = al.length;
    for (let i = 0; i < k; i++)
      for (let j = 0; j < k; j++) {
        if ((i === 0 && j === 0) || (i === 0 && j === k - 1) || (i === k - 1 && j === 0)) continue;
        for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) this.poner(al[i] + dx, al[j] + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
      }
    this.formato(0); // reserva el lugar (se reescribe con la máscara elegida)
    this.versionInfo();
  }

  formato(mascara: number) {
    // Corrección M = 00 en los dos bits del nivel.
    const datos = (0 << 3) | mascara;
    let r = datos;
    for (let i = 0; i < 10; i++) r = (r << 1) ^ ((r >>> 9) * 0x537);
    const bits = ((datos << 10) | r) ^ 0x5412;
    const n = this.n;
    for (let i = 0; i <= 5; i++) this.poner(8, i, bit(bits, i));
    this.poner(8, 7, bit(bits, 6));
    this.poner(8, 8, bit(bits, 7));
    this.poner(7, 8, bit(bits, 8));
    for (let i = 9; i < 15; i++) this.poner(14 - i, 8, bit(bits, i));
    for (let i = 0; i < 8; i++) this.poner(n - 1 - i, 8, bit(bits, i));
    for (let i = 8; i < 15; i++) this.poner(8, n - 15 + i, bit(bits, i));
    this.poner(8, n - 8, true);
  }

  versionInfo() {
    if (this.version < 7) return;
    let r = this.version;
    for (let i = 0; i < 12; i++) r = (r << 1) ^ ((r >>> 11) * 0x1f25);
    const bits = (this.version << 12) | r;
    for (let i = 0; i < 18; i++) {
      const v = bit(bits, i);
      const a = this.n - 11 + (i % 3);
      const b = Math.floor(i / 3);
      this.poner(a, b, v);
      this.poner(b, a, v);
    }
  }

  datos(cw: number[]) {
    const n = this.n;
    let i = 0;
    for (let der = n - 1; der >= 1; der -= 2) {
      if (der === 6) der = 5;
      for (let v = 0; v < n; v++)
        for (let j = 0; j < 2; j++) {
          const x = der - j;
          const arriba = ((der + 1) & 2) === 0;
          const y = arriba ? n - 1 - v : v;
          if (!this.fija[y][x] && i < cw.length * 8) {
            this.m[y][x] = bit(cw[i >>> 3], 7 - (i & 7));
            i++;
          }
        }
    }
  }

  aplicar(mascara: number) {
    for (let y = 0; y < this.n; y++) for (let x = 0; x < this.n; x++) if (!this.fija[y][x] && enmascarar(mascara, x, y)) this.m[y][x] = !this.m[y][x];
  }

  /** Penalización de la norma (reglas 1, 2, 3 y 4): menos es más fácil de leer. */
  penalizacion(): number {
    const n = this.n;
    const m = this.m;
    let p = 0;
    const tramos = (linea: (i: number) => boolean) => {
      let c = 1;
      for (let i = 1; i <= n; i++) {
        if (i < n && linea(i) === linea(i - 1)) c++;
        else {
          if (c >= 5) p += 3 + (c - 5);
          c = 1;
        }
      }
    };
    for (let y = 0; y < n; y++) tramos((x) => m[y][x]);
    for (let x = 0; x < n; x++) tramos((y) => m[y][x]);
    for (let y = 0; y < n - 1; y++) for (let x = 0; x < n - 1; x++) if (m[y][x] === m[y][x + 1] && m[y][x] === m[y + 1][x] && m[y][x] === m[y + 1][x + 1]) p += 3;
    // Regla 3: 1:1:3:1:1 con 4 claros a un lado (parece un buscador).
    const patronA = [true, false, true, true, true, false, true, false, false, false, false];
    const patronB = [false, false, false, false, true, false, true, true, true, false, true];
    const coincide = (f: (k: number) => boolean, pat: boolean[]) => pat.every((v, k) => f(k) === v);
    for (let y = 0; y < n; y++)
      for (let x = 0; x + 11 <= n; x++) {
        if (coincide((k) => m[y][x + k], patronA) || coincide((k) => m[y][x + k], patronB)) p += 40;
        if (coincide((k) => m[x + k][y], patronA) || coincide((k) => m[x + k][y], patronB)) p += 40;
      }
    let oscuros = 0;
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (m[y][x]) oscuros++;
    const k = Math.ceil(Math.abs(oscuros * 20 - n * n * 10) / (n * n)) - 1;
    p += Math.max(0, k) * 10;
    return p;
  }
}

function codigos(bytes: number[], version: number): number[] {
  const [ec, b1, d1, b2, d2] = BLOQUES_M[version - 1];
  const totalDatos = b1 * d1 + b2 * d2;
  const bits: number[] = [];
  const meter = (v: number, largo: number) => {
    for (let i = largo - 1; i >= 0; i--) bits.push((v >>> i) & 1);
  };
  meter(0b0100, 4);
  meter(bytes.length, version < 10 ? 8 : 16);
  for (const b of bytes) meter(b, 8);
  const tope = totalDatos * 8;
  meter(0, Math.min(4, tope - bits.length));
  while (bits.length % 8) bits.push(0);
  const datos: number[] = [];
  for (let i = 0; i < bits.length; i += 8) datos.push(bits.slice(i, i + 8).reduce((a, b) => (a << 1) | b, 0));
  for (let relleno = 0xec; datos.length < totalDatos; relleno ^= 0xec ^ 0x11) datos.push(relleno);

  // Bloques, su corrección y el entrelazado.
  const div = divisor(ec);
  const bloques: { d: number[]; e: number[] }[] = [];
  let k = 0;
  for (let i = 0; i < b1 + b2; i++) {
    const largo = i < b1 ? d1 : d2;
    const d = datos.slice(k, k + largo);
    k += largo;
    bloques.push({ d, e: resto(d, div) });
  }
  const r: number[] = [];
  const maxD = Math.max(d1, d2);
  for (let i = 0; i < maxD; i++) for (const b of bloques) if (i < b.d.length) r.push(b.d[i]);
  for (let i = 0; i < ec; i++) for (const b of bloques) r.push(b.e[i]);
  return r;
}

/** El QR de un texto: la matriz de módulos (true = oscuro), o null si no cabe en la versión 10. */
export function codigoQR(texto: string): boolean[][] | null {
  const bytes = utf8(texto);
  let version = 1;
  while (version <= VERSION_MAXIMA && capacidad(version) < bytes.length) version++;
  if (version > VERSION_MAXIMA) return null;
  const cw = codigos(bytes, version);
  let mejor: boolean[][] | null = null;
  let menor = Infinity;
  for (let mascara = 0; mascara < 8; mascara++) {
    const q = new Matriz(version);
    q.patrones();
    q.datos(cw);
    q.aplicar(mascara);
    q.formato(mascara);
    const p = q.penalizacion();
    if (p < menor) {
      menor = p;
      mejor = q.m.map((fila) => fila.slice());
    }
  }
  return mejor;
}
