/**
 * LA LLAMADA DEL AVATAR Y EL SEGUNDO PLANO: cuándo irse detrás cuelga de verdad (José, 10-oct, APK 5.7.0 en el S26:
 * desde la burbuja del botón lateral le pidió que lo llamara; AURA llamó, «y al contestar salió colgada la llamada»).
 *
 * Las migas de ese rato: `burbuja: cerrada (fuera) · segundo plano · primer plano · voz: volvió del segundo plano a
 * tiempo · segundo plano breve (11158 ms)` y, enseguida, `llamada del avatar: cuelga (segundo_plano)`. Dos cosas:
 *
 *  · NUESTRAS PROPIAS VENTANAS mueven el AppState de la app: la burbuja (BurbujaActivity, translúcida, el mismo motor de
 *    JS) al abrirse pausa a MainActivity y al cerrarse la vuelve a poner delante; el aviso a pantalla completa de una
 *    llamada que suena, y contestarlo, también. Cada una es un «segundo plano» de unos cientos de milisegundos (o más,
 *    si la burbuja tarda en arrancar) que la app NO pidió: no puede colgar la llamada.
 *  · DETRÁS, ANDROID CONGELA LOS RELOJES DE JS (los timers de React Native se pausan con la actividad). Un «si sigue
 *    detrás en 3 s, cuelga» no corre a los 3 s: corre AL VOLVER, todo de golpe, a veces antes de que llegue el «active».
 *    La «segundo plano breve (11158 ms)» y los «JS bloqueado 67288 ms» (lib/pulsoJs.ts) son ese reloj congelado. Así
 *    la llamada se colgaba justo cuando la persona volvía a la app (al contestar).
 *
 * Lo que decide `GuardiaFondoLlamada` (pura: el reloj y el AppState se inyectan; pruebas en Node):
 *  · solo `background` es irse (`inactive`, en iOS, no);
 *  · la gracia: GRACIA_FONDO_MS (3 s) si la llamada suena o conecta; GRACIA_EN_LLAMADA_MS (30 s) si la persona ya la
 *    contestó (una llamada de verdad no se corta por mirar otra cosa un momento);
 *  · las transiciones propias (`propia`: la burbuja se abrió o se cerró, contestar desde el aviso, abrir la app para
 *    que suene la llamada) dan una ventana VENTANA_PROPIA_MS en la que nada cuelga; con la burbuja abierta la gracia
 *    sube a GRACIA_BURBUJA_MS (la burbuja delante es nuestra);
 *  · un reloj que llega mucho más tarde de lo pedido estuvo congelado: la app está volviendo. No cuelga en ese tic:
 *    espera RECHEQUEO_MS a ver si llega el «active» y solo cuelga si sigue detrás de verdad;
 *  · al volver, la llamada sigue (contestó, volvió a tiempo, o el reloj estuvo congelado). Solo si estuvo detrás más de
 *    FONDO_LARGO_MS sin ser cosa nuestra se cuelga entonces: esa llamada ya no le servía a nadie.
 */

export const GRACIA_FONDO_MS = 3_000;
export const GRACIA_EN_LLAMADA_MS = 30_000;
export const GRACIA_BURBUJA_MS = 20_000;
export const VENTANA_PROPIA_MS = 6_000;
/** Un reloj que llega esto (o más) tarde estuvo congelado: la app estaba detrás y está volviendo. */
export const ATRASO_CONGELADO_MS = 1_500;
export const RECHEQUEO_MS = 700;
export const FONDO_LARGO_MS = 2 * 60_000;

type Reloj = unknown;

export type DepsFondoLlamada = {
  /** ¿Hay llamada que cuidar? (suena, conecta o se habla). Sin ella no se cuelga nada. */
  hayLlamada: () => boolean;
  /** ¿La persona ya la contestó (en llamada o silenciada)? Entonces la gracia es la larga. */
  contestada: () => boolean;
  /** El AppState de ahora ('active', 'background', 'inactive'). */
  estadoApp: () => string;
  /** ¿La burbuja del asistente está abierta? (burbuja/logica.ts `burbujaAbierta`). */
  burbuja?: () => boolean;
  /** Colgar (el ciclo decide qué: COLGADA con «segundo_plano», o perdida si sonaba). `detalle` va a la miga. */
  colgar: (detalle: string) => void;
  miga?: (t: string) => void;
  ahora?: () => number;
  setTimeout?: (f: () => void, ms: number) => Reloj;
  clearTimeout?: (h: Reloj) => void;
};

export class GuardiaFondoLlamada {
  /** Desde cuándo está detrás (0: delante). */
  private desde = 0;
  private reloj: Reloj | null = null;
  /** Cuándo debía correr el reloj pendiente (para saber si llegó tarde). */
  private debia = 0;
  private rechequeo = false;
  /** Hasta cuándo un «segundo plano» es cosa nuestra. */
  private propiaHasta = 0;
  /** Lo de este rato detrás fue (en algún momento) cosa nuestra: al volver no se cuelga por largo. */
  private fuePropia = false;
  private readonly ahora: () => number;
  private readonly poner: (f: () => void, ms: number) => Reloj;
  private readonly quitar: (h: Reloj) => void;

  constructor(private d: DepsFondoLlamada) {
    this.ahora = d.ahora ?? Date.now;
    this.poner = d.setTimeout ?? ((f, ms) => setTimeout(f, ms));
    this.quitar = d.clearTimeout ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>));
  }

  /** ¿Está detrás ahora (para la guardia)? */
  get detras(): boolean {
    return this.desde > 0;
  }

  /**
   * Una transición NUESTRA (la burbuja se abrió o se cerró, se contestó desde el aviso, abrimos la app para que suene):
   * el segundo plano de los próximos `ms` no cuelga nada.
   */
  propia(motivo: string, ms = VENTANA_PROPIA_MS) {
    const hasta = this.ahora() + ms;
    if (hasta > this.propiaHasta) this.propiaHasta = hasta;
    if (this.desde) this.fuePropia = true;
    this.d.miga?.(`voz: transición propia (${motivo}): el segundo plano no cuelga la llamada`);
  }

  /** Lo que dice AppState. Solo `background` es irse; `active` es volver. */
  estado(st: string) {
    if (st === 'active') return this.volver();
    if (st !== 'background' || this.desde) return;
    this.desde = this.ahora();
    this.fuePropia = this.esPropiaAhora() || !!this.d.burbuja?.();
    this.programar(this.gracia());
  }

  /** Se desmonta: nada pendiente. */
  soltar() {
    this.cancelar();
  }

  /** ¿Dentro de la ventana de una transición nuestra? (la burbuja abierta no cuenta aquí: alarga la gracia, no la anula). */
  private esPropiaAhora(): boolean {
    return this.ahora() < this.propiaHasta;
  }

  private gracia(): number {
    const base = this.d.contestada() ? GRACIA_EN_LLAMADA_MS : GRACIA_FONDO_MS;
    return this.d.burbuja?.() ? Math.max(base, GRACIA_BURBUJA_MS) : base;
  }

  private cancelar() {
    if (this.reloj !== null) this.quitar(this.reloj);
    this.reloj = null;
    this.rechequeo = false;
  }

  private programar(ms: number, rechequeo = false) {
    if (this.reloj !== null) this.quitar(this.reloj);
    const espera = Math.max(50, Math.round(ms));
    this.debia = this.ahora() + espera;
    this.rechequeo = rechequeo;
    this.reloj = this.poner(() => this.revisar(), espera);
  }

  private volver() {
    const desde = this.desde;
    this.cancelar();
    this.desde = 0;
    if (!desde) return;
    const ms = Math.max(0, this.ahora() - desde);
    const propia = this.fuePropia || this.esPropiaAhora() || !!this.d.burbuja?.();
    this.fuePropia = false;
    if (!this.d.hayLlamada()) return;
    if (ms >= FONDO_LARGO_MS && !propia) {
      this.d.miga?.(`voz: volvió tras ${Math.round(ms / 1000)} s en segundo plano; la llamada del avatar ya no servía`);
      this.d.colgar(`segundo plano largo (${ms} ms)`);
      return;
    }
    this.d.miga?.(`voz: volvió del segundo plano a tiempo (${ms} ms${propia ? ', transición propia' : ''}); la llamada sigue`);
  }

  private revisar() {
    this.reloj = null;
    if (!this.desde) return;
    if (this.d.estadoApp() === 'active') return this.volver();
    // Sin llamada no hay nada que colgar (la medida del rato detrás sigue, por si suena una).
    if (!this.d.hayLlamada()) return;
    const ahora = this.ahora();
    const atraso = ahora - this.debia;
    // El reloj estuvo congelado (Android pausa los timers con la app detrás): la app está volviendo. Se espera el «active».
    if (!this.rechequeo && atraso >= ATRASO_CONGELADO_MS) {
      this.d.miga?.(`voz: el reloj del segundo plano llegó ${atraso} ms tarde (estuvo congelado); espero a ver si vuelve`);
      return this.programar(RECHEQUEO_MS, true);
    }
    if (this.esPropiaAhora()) {
      this.fuePropia = true;
      return this.programar(this.propiaHasta - ahora);
    }
    // La gracia cuenta desde que se fue o, si después hubo una transición nuestra, desde que terminó su ventana.
    const falta = this.gracia() - (ahora - Math.max(this.desde, this.propiaHasta));
    // Contestó mientras tanto (la gracia creció): se espera lo que falte.
    if (falta > 0) return this.programar(falta);
    this.d.colgar(`segundo plano (${ahora - this.desde} ms)`);
  }
}

/** Lo que tarda la app en venir delante cuando la burbuja pidió la llamada (arrancar MainActivity, cerrar la burbuja). */
export const VENTANA_TRAER_MS = 10_000;

/**
 * «Llámame» que llega por el canal de acciones (el servidor lo resolvió), según dónde está la persona:
 *  · con la app delante: la conversación se abre al instante (José 1-oct: «al instante»);
 *  · con la BURBUJA abierta (lo pidió desde el botón lateral): la llamada SUENA en la app y la app viene delante; al
 *    contestar empieza una sesión nueva. Antes se abría la sesión detrás de la burbuja, sin que se viera, y el segundo
 *    plano de la burbuja al cerrarse la colgaba;
 *  · con la app detrás sin burbuja: suena (si la persona vuelve a tiempo, contesta; si no, queda perdida).
 */
export function comoAtenderLlamame(o: { estadoApp: string; burbuja: boolean }): 'al-instante' | 'sonar-y-traer' | 'sonar' {
  if (o.burbuja) return 'sonar-y-traer';
  return o.estadoApp === 'active' ? 'al-instante' : 'sonar';
}
