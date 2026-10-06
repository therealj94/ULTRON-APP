/**
 * LA APP DELANTE, CON GRACIA PARA LOS PARPADEOS (José, 6-oct, APK 5.5.0: «a veces el micrófono falla»).
 *
 * Las migas de ese día, al entrar a la mesa: `+2.6s segundo plano · oído de la mesa: lo suelta (nadie) · +2.7s primer
 * plano · lo toma (mesa)` y otra vez a los 11,2 s (justo cuando la mesa bloquea y suelta la orientación: al arrancar y
 * al terminar el saludo; en ese Samsung la actividad se pausa ~0,1 s). Cada parpadeo cerraba y volvía a abrir el
 * micrófono y el reconocedor: un arranque de más que, si cae mientras otro abre, deja el oído a medias.
 *
 * Ahora la mesa se da por «detrás» solo si sigue en segundo plano pasada GRACIA_FONDO_MS; si vuelve antes, no pasó nada
 * para el oído (queda una miga). Volver delante es inmediato. Sin React Native (pruebas en Node).
 */

export const GRACIA_FONDO_MS = 900;

type Reloj = unknown;

export type DepsGraciaFondo = {
  /** La app quedó detrás (false) o volvió delante (true), ya pasada la gracia. */
  alCambiar: (delante: boolean) => void;
  miga?: (t: string) => void;
  graciaMs?: number;
  ahora?: () => number;
  setTimeout?: (f: () => void, ms: number) => Reloj;
  clearTimeout?: (h: Reloj) => void;
};

export class GraciaFondo {
  private delante: boolean;
  private pendiente: Reloj | null = null;
  private desde = 0;
  private readonly ahora: () => number;
  private readonly poner: (f: () => void, ms: number) => Reloj;
  private readonly quitar: (h: Reloj) => void;

  constructor(
    private d: DepsGraciaFondo,
    inicial = true
  ) {
    this.delante = inicial;
    this.ahora = d.ahora ?? Date.now;
    this.poner = d.setTimeout ?? ((f, ms) => setTimeout(f, ms));
    this.quitar = d.clearTimeout ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>));
  }

  /** ¿Delante, para la mesa? (un parpadeo dentro de la gracia no cuenta). */
  get esDelante() {
    return this.delante;
  }

  /** Lo que dice AppState ('active', 'background', 'inactive'): solo 'background' es irse. */
  estado(st: string) {
    if (st !== 'background') {
      if (this.pendiente !== null) {
        this.quitar(this.pendiente);
        this.pendiente = null;
        this.d.miga?.(`segundo plano breve (${Math.max(0, this.ahora() - this.desde)} ms): la mesa sigue oyendo`);
        return;
      }
      if (!this.delante) {
        this.delante = true;
        this.d.alCambiar(true);
      }
      return;
    }
    if (!this.delante || this.pendiente !== null) return;
    this.desde = this.ahora();
    this.pendiente = this.poner(() => {
      this.pendiente = null;
      this.delante = false;
      this.d.alCambiar(false);
    }, this.d.graciaMs ?? GRACIA_FONDO_MS);
  }

  /** Se desmonta: lo pendiente no llega. */
  soltar() {
    if (this.pendiente !== null) this.quitar(this.pendiente);
    this.pendiente = null;
  }
}
