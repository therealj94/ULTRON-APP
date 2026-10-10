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
  /** La app está detrás (o lo estuvo y todavía no llegó el «active»): el reloj no cuenta. */
  private detras = false;
  constructor(private pasoMs = PULSO_MS) {}

  /**
   * Lo que dice AppState. José, 10-oct (APK 5.7.0): «JS bloqueado 67288 ms (sin cámara)» y «75379 ms» eran el tiempo
   * con la app DETRÁS: Android congela los relojes de JS con la actividad pausada y, al volver, el primer tic llegaba con
   * todo ese rato de «atraso». Detrás no se mide nada; al volver se empieza de cero (el primer tic no cuenta).
   */
  estadoApp(st: string) {
    this.detras = st !== 'active';
    this.antes = 0;
  }

  /** Un tic del reloj en `ahora`. Devuelve cuánto llegó tarde (0 en el primero, y 0 con la app detrás). */
  tic(ahora: number): number {
    if (this.detras) {
      this.antes = 0;
      return 0;
    }
    let atraso = 0;
    if (this.antes) {
      atraso = Math.max(0, ahora - this.antes - this.pasoMs);
      this.marcas.push({ t: ahora, atraso });
      const corte = ahora - GUARDA_MS;
      if (this.marcas.length > 50 && this.marcas[0].t < corte) this.marcas = this.marcas.filter((m) => m.t >= corte);
    }
    this.antes = ahora;
    return atraso;
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

/**
 * ¿Este atraso es un BLOQUEO que hay que contar ya? (José, 6-oct: «se traba… y al tocar la pantalla se cierra»): con el
 * hilo de JS trabado ≥ `umbralMs` la app no contesta toques; con ≥ `graveMs` Android puede mostrar «no responde». Uno
 * por `separacionMs` (salvo que sea peor que el último contado), para no llenar las migas con cada tic tardío.
 */
export class DetectorBloqueo {
  private ultimo = 0;
  private ultimoMs = 0;
  constructor(private o = { umbralMs: 1500, graveMs: 5000, separacionMs: 10_000 }) {}

  revisar(atraso: number, ahora: number): { ms: number; grave: boolean } | null {
    if (!(atraso >= this.o.umbralMs)) return null;
    if (ahora - this.ultimo < this.o.separacionMs && atraso <= this.ultimoMs) return null;
    this.ultimo = ahora;
    this.ultimoMs = atraso;
    return { ms: Math.round(atraso), grave: atraso >= this.o.graveMs };
  }
}

/** El pulso de la app (uno solo). */
export const pulsoJs = new PulsoJs();
const detector = new DetectorBloqueo();
let avisoBloqueo: ((b: { ms: number; grave: boolean }) => void) | null = null;
let usuarios = 0;
let reloj: ReturnType<typeof setInterval> | null = null;

/** Quién se entera de un bloqueo del hilo de JS (la mesa: una miga, y con uno grave el reporte enseguida). */
export function ponerAvisoBloqueo(f: ((b: { ms: number; grave: boolean }) => void) | null) {
  avisoBloqueo = f;
}

let oyenteApp: { remove(): void } | null = null;

/**
 * El AppState de React Native, solo en el teléfono (en Node no hay: el pulso se prueba con `estadoApp` a mano). Se escucha
 * mientras el reloj corre; detrás, `PulsoJs.tic` no cuenta (lib/pulsoJs.ts `estadoApp`).
 */
function seguirApp() {
  if (oyenteApp) return;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    // Sin el tipo de react-native a propósito: este archivo también lo compila la raíz (pruebas en Node).
    const { AppState } = require('react-native') as { AppState: { currentState: string; addEventListener: (e: 'change', f: (st: string) => void) => { remove(): void } } };
    pulsoJs.estadoApp(AppState.currentState === 'background' ? 'background' : 'active');
    oyenteApp = AppState.addEventListener('change', (st: string) => pulsoJs.estadoApp(st === 'background' ? 'background' : 'active'));
  } catch {
    oyenteApp = null;
  }
}

/** Enciende el reloj mientras alguien lo quiera (la mesa a la vista). Devuelve cómo soltarlo. */
export function arrancarPulso(): () => void {
  usuarios += 1;
  seguirApp();
  if (!reloj)
    reloj = setInterval(() => {
      const ahora = Date.now();
      const atraso = pulsoJs.tic(ahora);
      const b = detector.revisar(atraso, ahora);
      if (b && avisoBloqueo) {
        try {
          avisoBloqueo(b);
        } catch {
          /* el aviso nunca rompe el pulso */
        }
      }
    }, PULSO_MS);
  let suelto = false;
  return () => {
    if (suelto) return;
    suelto = true;
    usuarios = Math.max(0, usuarios - 1);
    if (!usuarios && reloj) {
      clearInterval(reloj);
      reloj = null;
      pulsoJs.pausar();
      oyenteApp?.remove();
      oyenteApp = null;
    }
  };
}
