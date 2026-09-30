/**
 * Dónde puede estar la compañera: su carril al pie de la pantalla, los bordes a los que se pega al
 * soltarla y cómo se aparta del teclado y de la barra de escribir.
 *
 * Puro, en px de pantalla (la esquina de arriba a la izquierda de su caja), para probarlo en Node.
 */

export type Borde = 'abajo' | 'arriba' | 'izquierda' | 'derecha';

export type Marco = {
  ancho: number;
  alto: number;
  /** Lado de su caja (la compañera es un cuadrado). */
  lado: number;
  /** Separación mínima de los bordes. */
  margen: number;
  /** Lo que ocupa abajo lo que no se debe tapar: la barra de escribir, los botones de la mesa, el teclado. */
  suelo: number;
  /** Lo de arriba que no se tapa (barra de estado, encabezados). */
  techo: number;
};

export type Posicion = { borde: Borde; x: number; y: number };

const lim = (v: number, a: number, b: number) => (b < a ? a : v < a ? a : v > b ? b : v);

/** La altura (y) de su carril de paseo: encima del suelo. */
export function yCarril(m: Marco): number {
  return Math.max(m.techo + m.margen, m.alto - m.suelo - m.lado - m.margen);
}

export function xMin(m: Marco): number {
  return m.margen;
}

export function xMax(m: Marco): number {
  return Math.max(m.margen, m.ancho - m.lado - m.margen);
}

export function yMin(m: Marco): number {
  return m.techo + m.margen;
}

/** El resto de la pantalla por donde se la puede arrastrar (no se sale ni se mete bajo el teclado). */
export function limitar(m: Marco, x: number, y: number): { x: number; y: number } {
  return { x: lim(x, xMin(m), xMax(m)), y: lim(y, yMin(m), yCarril(m)) };
}

/**
 * Al soltarla: se proyecta un poco el lanzamiento (0,18 s de su velocidad) y se pega al borde más
 * cercano de ese punto. Queda sobre el borde, dentro de lo permitido.
 */
export function pegarABorde(m: Marco, x: number, y: number, vx = 0, vy = 0): Posicion {
  const p = limitar(m, x + vx * 0.18, y + vy * 0.18);
  const dIzq = p.x - xMin(m);
  const dDer = xMax(m) - p.x;
  const dArr = p.y - yMin(m);
  const dAba = yCarril(m) - p.y;
  const menor = Math.min(dIzq, dDer, dArr, dAba);
  if (menor === dAba) return { borde: 'abajo', x: p.x, y: yCarril(m) };
  if (menor === dIzq) return { borde: 'izquierda', x: xMin(m), y: p.y };
  if (menor === dDer) return { borde: 'derecha', x: xMax(m), y: p.y };
  return { borde: 'arriba', x: p.x, y: yMin(m) };
}

/**
 * El marco cambió (salió el teclado, giró el teléfono, cambió de pantalla): la misma posición,
 * corregida. Abajo sigue en su carril (sube sobre el teclado); en los lados baja o sube lo justo.
 */
export function reubicar(m: Marco, p: Posicion): Posicion {
  switch (p.borde) {
    case 'abajo':
      return { borde: 'abajo', x: lim(p.x, xMin(m), xMax(m)), y: yCarril(m) };
    case 'arriba':
      return { borde: 'arriba', x: lim(p.x, xMin(m), xMax(m)), y: yMin(m) };
    case 'izquierda':
      return { borde: 'izquierda', x: xMin(m), y: lim(p.y, yMin(m), yCarril(m)) };
    case 'derecha':
      return { borde: 'derecha', x: xMax(m), y: lim(p.y, yMin(m), yCarril(m)) };
  }
}

/** A dónde pasea ahora: otro punto del carril, a buena distancia del de ahora. */
export function destinoPaseo(m: Marco, x: number, azar: () => number = Math.random): number {
  const a = xMin(m);
  const b = xMax(m);
  const ancho = b - a;
  if (ancho < 40) return x;
  const minimo = Math.min(ancho * 0.5, Math.max(60, ancho * 0.25));
  for (let i = 0; i < 6; i++) {
    const d = a + azar() * ancho;
    if (Math.abs(d - x) >= minimo) return d;
  }
  // Sin suerte: al lado con más espacio.
  return x - a > b - x ? a + ancho * 0.1 : b - ancho * 0.1;
}

/** Cuánto tarda en llegar a pasitos (px/s tranquilos). */
export function msPaseo(desde: number, hasta: number, velocidad = 44): number {
  return Math.round((Math.abs(hasta - desde) / velocidad) * 1000);
}

/** Dónde cae su globito: encima si hay sitio; si está arriba, debajo. Devuelve la esquina del globo. */
export function lugarGlobo(m: Marco, p: { x: number; y: number }, anchoGlobo: number, altoGlobo: number): { x: number; y: number; abajo: boolean } {
  const cx = p.x + m.lado / 2;
  const x = lim(cx - anchoGlobo / 2, m.margen, m.ancho - anchoGlobo - m.margen);
  const arriba = p.y - altoGlobo - 6;
  if (arriba >= m.techo + 4) return { x, y: arriba, abajo: false };
  return { x, y: p.y + m.lado + 6, abajo: true };
}
