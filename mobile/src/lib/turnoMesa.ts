/**
 * EL TURNO DE LA MESA, CON SU PROPIA FICHA (auditoría del 7-oct, A-2).
 *
 * Antes la mesa (screens/DeskScreen.tsx) cortaba con UN solo booleano compartido, `turnoCancelado`, que cada turno nuevo
 * ponía en `false` por convención, más `abortTurno` y `efectoTurno` compartidos. Lo tardío del turno N (el relleno, el
 * narrador del trabajo, un `onAudioStart`) que llegara después de que empezara el N+1 leía la bandera del N+1 y podía
 * hablar; un «callar» dicho mientras el turno buscaba quién habla (hasta 350 ms) se borraba al arrancar; y el turno con
 * foto (el camino JSON) nunca registraba cómo cortarse: una frase nueva no lo cortaba y la persona esperaba hasta 35 s.
 *
 * Ahora cada turno tiene su FICHA (`FichaTurno`): su id, si se cortó (y por qué), si en él empezó una herramienta con
 * efectos y lo que corta lo que está en camino (el stream, o la espera del JSON / de la cámara con `hasta`). Toda
 * pregunta del turno va contra SU ficha, capturada en sus cierres: cortar el N nunca toca al N+1, y lo del N que llegue
 * tarde ve `vigente === false` (ya no es el turno de la mesa) y se calla.
 *
 * `TurnoMesa` es el dueño: `empezar()` da la ficha nueva (y deja de ser vigente la anterior), `cancelar()` corta la del
 * momento, `pensando()` y `efecto()` son lo que lib/fraseNueva.ts necesita para decidir si una frase nueva corta (las reglas
 * G2 siguen allá: el relleno no corta; con una herramienta con efectos en curso, nunca).
 *
 * Puro y sin React Native: la prueba en Node es tests/turno-mesa-movil.test.ts.
 */

/** Por qué se cortó un turno (para la miga; nunca lo que dijo la persona). */
export type MotivoCorte = 'callar' | 'frase_nueva' | 'oido' | 'barge_in' | 'llamada' | 'mesa_se_va';

/** Lo que devuelve `hasta` si el turno se cortó antes de que la promesa terminara. */
export const CORTADO: unique symbol = Symbol('turno cortado');
export type Cortado = typeof CORTADO;

export class FichaTurno {
  private _cancelado = false;
  private _motivo: MotivoCorte | null = null;
  private _efecto = false;
  private corte: (() => void) | null = null;
  readonly id: number;
  private readonly dueno: TurnoMesa;

  constructor(id: number, dueno: TurnoMesa) {
    this.id = id;
    this.dueno = dueno;
  }

  /** Se cortó (por la persona, el oído, una llamada o porque la mesa se fue). Para siempre: una ficha no se «descorta». */
  get cancelado(): boolean {
    return this._cancelado;
  }
  get motivo(): MotivoCorte | null {
    return this._motivo;
  }
  /** En este turno empezó una herramienta que puede dejar algo afuera (un envío, un borrador): ya no se corta por una frase. */
  get efecto(): boolean {
    return this._efecto;
  }
  /** Hay algo en camino que se puede cortar (el stream o una espera con `hasta`). */
  get enCamino(): boolean {
    return !!this.corte;
  }
  /** ¿Puede este turno todavía decir o hacer algo? No se cortó y sigue siendo el turno de la mesa. */
  get vigente(): boolean {
    return !this._cancelado && this.dueno.actual === this;
  }

  marcarEfecto(): void {
    this._efecto = true;
  }

  /**
   * Lo que corta lo que está en camino (p. ej. el `abort` del stream); null cuando esa parte terminó. Si la ficha ya se
   * cortó, se corta enseguida (un stream que arranca tarde no queda vivo).
   */
  ponerCorte(fn: (() => void) | null): void {
    if (fn && this._cancelado) {
      llamar(fn);
      return;
    }
    this.corte = fn;
  }

  /** Corta este turno (una sola vez): marca, y corta lo que esté en camino. true si lo cortó ahora. */
  cancelar(motivo: MotivoCorte): boolean {
    if (this._cancelado) return false;
    this._cancelado = true;
    this._motivo = motivo;
    const c = this.corte;
    this.corte = null;
    if (c) llamar(c);
    return true;
  }

  /**
   * Espera `p` mientras el turno siga: si se corta antes, resuelve CORTADO al instante (lo que `p` traiga después se
   * ignora). Mientras espera, el turno cuenta como «en camino» (una frase nueva lo puede cortar, como al stream). Si ya
   * estaba cortado, CORTADO sin esperar.
   */
  hasta<T>(p: Promise<T>): Promise<T | Cortado> {
    if (this._cancelado) {
      p.catch(() => undefined);
      return Promise.resolve(CORTADO);
    }
    return new Promise<T | Cortado>((resolver, rechazar) => {
      let listo = false;
      const soltar = () => {
        if (listo) return;
        listo = true;
        resolver(CORTADO);
      };
      this.corte = soltar;
      p.then(
        (v) => {
          if (this.corte === soltar) this.corte = null;
          if (listo) return;
          listo = true;
          resolver(v);
        },
        (e) => {
          if (this.corte === soltar) this.corte = null;
          if (listo) return;
          listo = true;
          rechazar(e);
        }
      );
    });
  }
}

function llamar(fn: () => void) {
  try {
    fn();
  } catch {
    /* cortar nunca debe tumbar a quien corta */
  }
}

export class TurnoMesa {
  private n = 0;
  /** La ficha del turno de la mesa ahora (null entre turnos). */
  actual: FichaTurno | null = null;

  /** Un turno nuevo: su ficha. La anterior deja de ser vigente (no se corta: lo suyo ya no habla). */
  empezar(): FichaTurno {
    const f = new FichaTurno(++this.n, this);
    this.actual = f;
    return f;
  }

  /** El turno terminó: si su ficha sigue siendo la de la mesa, la mesa queda sin turno. */
  terminar(f: FichaTurno | null | undefined): void {
    if (f && this.actual === f) this.actual = null;
  }

  /** Corta el turno del momento (si hay). true si cortó algo. */
  cancelar(motivo: MotivoCorte): boolean {
    return this.actual ? this.actual.cancelar(motivo) : false;
  }

  /** Hay un turno con algo en camino (stream o espera) que todavía no se cortó: lo que fraseNueva llama «pensando». */
  pensando(): boolean {
    const f = this.actual;
    return !!f && !f.cancelado && f.enCamino;
  }

  /** En el turno del momento empezó una herramienta con efectos. */
  efecto(): boolean {
    return !!this.actual?.efecto;
  }
}
