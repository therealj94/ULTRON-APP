/**
 * Análisis PURO de un cuadro pequeño (RGBA) para el tracker óptico de respaldo (`02-cara/faceTracker.ts`).
 * Sin DOM: recibe los bytes de `getImageData` y devuelve estadísticas; así se prueba con un cuadro
 * uniforme y se garantiza que una sala vacía (gris, estática) NUNCA cuenta como «alguien».
 *
 * Regla de presencia: hace falta ENERGÍA real, no solo píxeles claros:
 *  - textura: desvío estándar de luminancia ≥ `UMBRALES_OPTICO.texturaMin` (una pared lisa o la tapa
 *    puesta dan ≈ 0);
 *  - movimiento sostenido: al menos `movimientosMin` cuadros con ≥ `pixelesMovidosMin` muestras que
 *    cambiaron más de `diffPixel` en los últimos `ventanaMovimientoMs` (un solo cuadro con ruido no basta;
 *    un póster nunca se mueve).
 */

export interface EstadisticasCuadro {
  /** Peso total (luminancia + movimiento, ponderado hacia el centro): base del centroide. */
  totalWeight: number;
  sumX: number;
  sumY: number;
  /** Movimiento en la franja lateral alta (mano que saluda). */
  upperMotion: number;
  /** Desvío estándar de la luminancia (0 = cuadro uniforme). */
  desvioLum: number;
  /** Muestras cuya diferencia con el cuadro anterior superó `diffPixel` (0 si no hay cuadro anterior). */
  pixelesMovidos: number;
  /** Muestras analizadas. */
  muestras: number;
  /** true si se comparó contra un cuadro anterior del mismo tamaño. */
  conPrevio: boolean;
}

export const UMBRALES_OPTICO = {
  texturaMin: 14,
  diffPixel: 25,
  pixelesMovidosMin: 3,
  movimientosMin: 3,
  ventanaMovimientoMs: 3000,
  pesoMin: 450,
} as const;

/**
 * Recorre el cuadro (muestreo cada 2 px, margen de 4) y acumula estadísticas. `prev` puede ser null.
 */
export function analizarCuadro(data: ArrayLike<number>, prev: ArrayLike<number> | null, W: number, H: number, u = UMBRALES_OPTICO): EstadisticasCuadro {
  let totalWeight = 0;
  let sumX = 0;
  let sumY = 0;
  let upperMotion = 0;
  let sumLum = 0;
  let sumLum2 = 0;
  let pixelesMovidos = 0;
  let muestras = 0;
  const conPrevio = !!prev && prev.length === data.length;

  for (let y = 4; y < H - 4; y += 2) {
    for (let x = 4; x < W - 4; x += 2) {
      const idx = (y * W + x) * 4;
      const r = data[idx];
      const g = data[idx + 1];
      const b = data[idx + 2];
      const lum = 0.299 * r + 0.587 * g + 0.114 * b;
      sumLum += lum;
      sumLum2 += lum * lum;
      muestras++;
      let weight = lum > 65 && lum < 240 ? lum * 0.45 : 10;

      if (conPrevio) {
        const diff = Math.abs(r - prev![idx]) + Math.abs(g - prev![idx + 1]) + Math.abs(b - prev![idx + 2]);
        if (diff > u.diffPixel) {
          weight += diff * 1.8;
          pixelesMovidos++;
        }
        // movimiento en la franja lateral alta (mano que saluda)
        if (y < H * 0.5 && (x < W * 0.35 || x > W * 0.65)) upperMotion += diff;
      }

      const dx = (x - W / 2) / (W / 2);
      const dy = (y - H / 2) / (H / 2);
      const centerFactor = Math.max(0.2, 1 - (dx * dx + dy * dy) * 0.35);
      const finalWeight = weight * centerFactor;
      totalWeight += finalWeight;
      sumX += x * finalWeight;
      sumY += y * finalWeight;
    }
  }

  const media = muestras ? sumLum / muestras : 0;
  const varianza = muestras ? Math.max(0, sumLum2 / muestras - media * media) : 0;
  return { totalWeight, sumX, sumY, upperMotion, desvioLum: Math.sqrt(varianza), pixelesMovidos, muestras, conPrevio };
}

/**
 * Memoria de movimiento: guarda los `ts` de los cuadros con movimiento y dice si hay actividad sostenida.
 * Determinista (solo depende de los `ts` que recibe), para poder probarla sin reloj real.
 */
export class MemoriaMovimiento {
  private ts: number[] = [];
  constructor(private readonly u = UMBRALES_OPTICO) {}

  reiniciar() {
    this.ts = [];
  }

  /** Registra el cuadro `ts` con `pixelesMovidos` y devuelve si hay movimiento sostenido en la ventana. */
  registrar(ts: number, pixelesMovidos: number): boolean {
    if (pixelesMovidos >= this.u.pixelesMovidosMin) this.ts.push(ts);
    const limite = ts - this.u.ventanaMovimientoMs;
    while (this.ts.length && this.ts[0] < limite) this.ts.shift();
    return this.ts.length >= this.u.movimientosMin;
  }

  get activo(): boolean {
    return this.ts.length >= this.u.movimientosMin;
  }
}

/** ¿El cuadro tiene textura y peso suficientes como para ubicar algo en él? (sin movimiento no basta) */
export function tieneEnergia(e: EstadisticasCuadro, movimientoSostenido: boolean, u = UMBRALES_OPTICO): boolean {
  return e.totalWeight > u.pesoMin && e.desvioLum >= u.texturaMin && movimientoSostenido;
}
