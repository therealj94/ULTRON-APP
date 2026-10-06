/**
 * EL RELLENO DEL TURNO («déjame ver…») QUE NO DEMORA LA RESPUESTA (José, 6-oct: «contestó con voz» de ~2,6 s a ~6 s).
 *
 * El relleno sale si el cerebro tarda más de ESPERA_FRASE_MS (2,5 s; compa/frasesEstado.ts) y la respuesta NO corta la
 * frase que suena (StreamSpeaker espera a la locución en curso). Pero el relleno se pide al servidor como cualquier voz
 * (0,4-1 s: casi nunca está en la caché, hay 15-25 frases por estado y avatar), y mientras se bajaba ya contaba como
 * «sonando»: si la respuesta llegaba a los 2,7 s, igual esperaba a que el relleno se bajara, sonara entero (1-2 s) y recién
 * ahí se preparaba la suya. Con el servidor sobre los 2,5 s (6-oct: mediana 3,2 s), eso pasaba en más de la mitad de los
 * turnos: ~1 s más de mediana solo por el relleno (simulación en el informe del 6-oct).
 *
 * Ahora: el primer texto de la respuesta CORTA el relleno que todavía no empezó a sonar (`corte`; tts.ts `speak` con
 * `hastaQue`); el que ya suena termina su frase (no se corta a media palabra), y la respuesta se prepara mientras tanto.
 *
 * Puro: el reloj y la voz se inyectan (tests/latencia-movil.test.ts).
 */

/**
 * EL ACUSE ANTES DEL SEGUNDO (José, 6-oct: «que sea tan rápido contestar una conversación que nadie note que es una IA»).
 * La charla contesta en ~1–1,5 s (la ruta de charla del servidor, lib/cerebro-rapido.ts) y no necesita relleno antes de
 * ESPERA_FRASE_MS. Lo que SIEMPRE tarda (buscar en internet, leer una página o un documento, revisar: herramientas de
 * varios segundos) se acusa a los ACUSE_TAREA_MS, como una persona que dice «a ver…» mientras busca. Aquí solo el CUÁNDO;
 * las palabras son del banco de frases (compa/frasesEstado.ts) y de quien narra el trabajo.
 */
export const ACUSE_TAREA_MS = 800;
export function esperaDeRelleno(estado: string, base: number): number {
  return /^(buscando|leyendo|revisando)$/.test(estado) ? Math.min(base, ACUSE_TAREA_MS) : base;
}

/** Lo que devuelve `carreraConCorte` si llegó primero el corte. */
export const CORTADO: unique symbol = Symbol('cortado');

/** El audio (o lo que sea) si llega antes que el corte; `CORTADO` si el corte llegó primero. Sin corte, el audio. */
export function carreraConCorte<T>(p: Promise<T>, corte: Promise<unknown> | undefined): Promise<T | typeof CORTADO> {
  if (!corte) return p;
  return Promise.race([p, corte.then((): typeof CORTADO => CORTADO)]);
}

type Reloj = { setTimeout: (f: () => void, ms: number) => ReturnType<typeof setTimeout>; clearTimeout: (t: ReturnType<typeof setTimeout>) => void };

export class RellenoTurno {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private soltar: (() => void) | null = null;
  private readonly corte: Promise<void>;
  /** Se llegó a pedir el relleno (para la traza del turno). */
  pedido = false;

  constructor(private o: { esperaMs: number; decir: (corte: Promise<void>) => void } & Partial<Reloj>) {
    this.corte = new Promise<void>((r) => (this.soltar = r));
  }

  private get reloj(): Reloj {
    return { setTimeout: this.o.setTimeout || ((f, ms) => setTimeout(f, ms)), clearTimeout: this.o.clearTimeout || ((t) => clearTimeout(t)) };
  }

  /** Arranca la espera (`inmediato`: con imagen, que siempre tarda, sale ya; `esperaMs`: otra que la de siempre). */
  programar(inmediato: boolean, esperaMs = this.o.esperaMs) {
    if (!this.soltar) return;
    if (inmediato) return this.pedir();
    this.timer = this.reloj.setTimeout(() => {
      this.timer = null;
      this.pedir();
    }, esperaMs);
  }

  private pedir() {
    if (!this.soltar || this.pedido) return;
    this.pedido = true;
    this.o.decir(this.corte);
  }

  /** Llegó el primer texto de la respuesta: no se pide, y el que todavía no suena se tira. */
  respuesta() {
    if (this.timer) this.reloj.clearTimeout(this.timer);
    this.timer = null;
    const s = this.soltar;
    this.soltar = null;
    s?.();
  }

  /** El turno terminó (bien, mal o cortado): lo mismo. */
  terminar() {
    this.respuesta();
  }
}
