/**
 * EL PULSO DEL HILO DE JS: un reloj cada `PULSO_MS` y cuánto llega TARDE. Si el hilo está ocupado (la cámara, un
 * re-dibujo grande, armar un mensaje enorme), el reloj se atrasa: ese atraso es lo que se trabó. Lo usan la traza del
 * turno (lib/trazaTurno.ts: lo más que se trabó mientras se contestaba) y el resumen de la cámara cada minuto
 * (lib/estadisticaCamara.ts). La cuenta es pura (se prueba en Node); `arrancarPulso` le pone el reloj de verdad.
 */

export const PULSO_MS = 200;
/** Lo que se recuerda (para la ventana de un turno largo y el minuto de la cámara). */
const GUARDA_MS = 120_000;

export class PulsoJs {
  private antes = 0;
  private marcas: { t: number; atraso: number }[] = [];
  constructor(private pasoMs = PULSO_MS) {}

  /** Un tic del reloj en `ahora`. */
  tic(ahora: number) {
    if (this.antes) {
      const atraso = Math.max(0, ahora - this.antes - this.pasoMs);
      this.marcas.push({ t: ahora, atraso });
      const corte = ahora - GUARDA_MS;
      if (this.marcas.length > 50 && this.marcas[0].t < corte) this.marcas = this.marcas.filter((m) => m.t >= corte);
    }
    this.antes = ahora;
  }

  /** Lo más que se trabó entre `t0` y `t1`. */
  maxEntre(t0: number, t1: number): number {
    let max = 0;
    for (const m of this.marcas) if (m.t >= t0 && m.t <= t1 && m.atraso > max) max = m.atraso;
    return max;
  }

  /** Media y máximo del atraso desde `desde`. */
  resumen(desde: number): { media: number; max: number; n: number } {
    let suma = 0;
    let max = 0;
    let n = 0;
    for (const m of this.marcas) {
      if (m.t < desde) continue;
      suma += m.atraso;
      n += 1;
      if (m.atraso > max) max = m.atraso;
    }
    return { media: n ? Math.round(suma / n) : 0, max, n };
  }

  /** Se paró el reloj (la mesa tapada, la app detrás): el próximo tic no cuenta la pausa como atraso. */
  pausar() {
    this.antes = 0;
  }
}

/** El pulso de la app (uno solo). */
export const pulsoJs = new PulsoJs();
let usuarios = 0;
let reloj: ReturnType<typeof setInterval> | null = null;

/** Enciende el reloj mientras alguien lo quiera (la mesa a la vista). Devuelve cómo soltarlo. */
export function arrancarPulso(): () => void {
  usuarios += 1;
  if (!reloj) reloj = setInterval(() => pulsoJs.tic(Date.now()), PULSO_MS);
  let suelto = false;
  return () => {
    if (suelto) return;
    suelto = true;
    usuarios = Math.max(0, usuarios - 1);
    if (!usuarios && reloj) {
      clearInterval(reloj);
      reloj = null;
      pulsoJs.pausar();
    }
  };
}
