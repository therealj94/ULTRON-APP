/**
 * EL GUION DEL VIDEO: qué clip de Claudio o ANT-ONIO se ve en cada momento.
 *
 * Son 17 clips de 5 s por avatar, generados a partir de una sola foto base (scripts y prompts en
 * docs/avatares-video.md). Todos empiezan y terminan en esa misma pose (en el medio cada uno hace lo
 * suyo): el cambio de un clip a otro se hace ahí, en el reposo, y eso lo resuelve transicion.ts. Esto
 * solo decide QUÉ clip toca. Hay dos clases:
 *
 *  · de FONDO, que se repiten mientras dura el estado: reposo, escucha, habla, piensa, teclea (su
 *    computadora trabaja), lee (un correo o un WhatsApp) y espera (un rato sin nada que hacer);
 *  · GOLPES, que se hacen una vez y vuelven al fondo: risa, saluda, señala, sorpresa, triste, celebra,
 *    asiente, niega, duda y despide.
 *
 * El estado llega en el idioma del contrato (avatar3d/contrato.ts, EstadoAvatar), el mismo que le
 * llega al cuerpo 3D: así el video es un cuerpo más, intercambiable. Lo que el 3D no tiene (la
 * computadora, la lectura, los golpes por lo que dijo o por lo que pasó) llega aparte, por las
 * pistas (pistas.ts).
 *
 * Puro y sin React Native: lo prueban en Node (pruebas/video.prueba.mjs).
 */
import { ESTADO_INICIAL, type Camara, type EstadoAvatar, type ExpresionAvatar, type GestoAvatar } from '../../avatar3d/tipos';

export const CLIPS_VIDEO = [
  'reposo',
  'escucha',
  'habla',
  'piensa',
  'teclea',
  'lee',
  'espera',
  'risa',
  'saluda',
  'senala',
  'sorpresa',
  'triste',
  'celebra',
  'asiente',
  'niega',
  'duda',
  'despide',
] as const;
export type ClipVideo = (typeof CLIPS_VIDEO)[number];

const DE_FONDO: readonly ClipVideo[] = ['reposo', 'escucha', 'habla', 'piensa', 'teclea', 'lee', 'espera'];
export const esDeFondo = (c: ClipVideo) => DE_FONDO.includes(c);

/** Lo que hace aparte de la conversación (pistas.ts): su computadora trabaja, está leyendo un mensaje. */
export type Actividad = { teclea: boolean; lee: boolean };
export const SIN_ACTIVIDAD: Actividad = { teclea: false, lee: false };

/**
 * El clip que se repite con este estado. Gana lo que más se nota: hablar; leer (el turno abrió un correo
 * o un WhatsApp: pasa mientras el cerebro piensa); pensar; teclear (su computadora trabaja, pero si le
 * preguntás algo, piensa primero); escuchar; y si no, el reposo. `hay` salta los clips que falten.
 */
export function fondoDe(e: EstadoAvatar, a: Actividad = SIN_ACTIVIDAD, hay: (c: ClipVideo) => boolean = () => true): ClipVideo {
  const orden: [boolean, ClipVideo][] = [
    [e.hablando, 'habla'],
    [a.lee, 'lee'],
    [e.pensando || e.expresion === 'piensa', 'piensa'],
    [a.teclea, 'teclea'],
    [e.escuchando, 'escucha'],
  ];
  for (const [si, c] of orden) if (si && hay(c)) return c;
  return 'reposo';
}

/** La cara que pide un golpe al aparecer (las demás se quedan en el fondo). */
const GOLPE_DE_EXPRESION: Partial<Record<ExpresionAvatar, ClipVideo>> = {
  encantada: 'risa',
  sorprendida: 'sorpresa',
  triste: 'triste',
  uy: 'triste',
};

/** El gesto de cuerpo pedido → su golpe (null: el video no tiene uno que le quede). */
const GOLPE_DE_GESTO: Record<GestoAvatar, ClipVideo | null> = {
  saludar: 'saluda',
  entrar: 'saluda',
  salir: 'saluda',
  senalar: 'senala',
  toque_cabeza: 'risa',
  toque_mejilla: 'risa',
  toque_panza: 'risa',
  gusto: 'risa',
  despertar: 'sorpresa',
  enojo: null,
};

/**
 * Lo que llega por las pistas (pistas.ts): la actividad y, si hay, un golpe pedido por lo que pasó (dijo
 * «listo», se despidió, colgó, su computadora terminó…). `n` cambia con cada pedido; `en` es cuándo se
 * pidió: uno viejo (de antes de que este cuerpo apareciera) no se hace.
 */
export type PistasVideo = Actividad & { golpe: { clip: ClipVideo; n: number; en: number } | null };
/** Un golpe pedido por las pistas vale esto: más tarde ya no viene al caso. */
export const GOLPE_VIGENTE_MS = 1500;

/** Lo que tiene que sonar en la pantalla. `n` cambia en cada clip nuevo (aunque se repita el mismo). */
export type Reproduccion = { clip: ClipVideo; bucle: boolean; n: number };

/** El mismo golpe no se repite antes de esto (una risa por chiste, no tres). */
export const ENFRIAR_GOLPE_MS = 8000;
/**
 * Si empieza a hablar con un golpe en pantalla, se le deja terminar el gesto hasta esto; luego pide «habla».
 * Es lo de siempre para un cuerpo que CORTA el golpe ahí (el recorrido de Windows).
 */
export const GOLPE_ANTES_DE_HABLAR_MS = 1800;
/**
 * Lo mismo en el teléfono, que ya no corta el gesto por la mitad (la pose saltaba): la mezcla
 * (transicion.ts) lo termina más rápido hasta el reposo y recién ahí habla. Por eso se pide antes: con
 * 1 s el golpe se ve entero y la boca arranca ~2,4 s después de la frase (con 1,8 s serían ~3 s). Si el
 * golpe todavía no había llegado a verse (el clip de antes no había vuelto al reposo), se salta.
 */
export const GOLPE_ANTES_DE_HABLAR_SIN_CORTE_MS = 1000;
/**
 * Un fondo nuevo tiene que durar esto antes de cambiar de clip. La voz suelta «hablando» entre frase y
 * frase (y la mesa pasa por escucha → piensa en un instante): sin esta espera, cada pausa era un fundido
 * habla → reposo → habla, y eso es lo que se veía como un parpadeo (José, 2-oct: «Claudio parpadea
 * bien raro»). Empezar a hablar no espera: la boca tiene que moverse con la primera sílaba.
 */
export const SOLTAR_HABLA_MS = 750;
export const ASENTAR_FONDO_MS = 300;
/** Tanto rato en reposo (despierto, sin nada que hacer) y se pone a esperar: mira alrededor, suspira. */
export const ESPERA_TRAS_MS = 45_000;
/** Lo que dura la espera (dos vueltas del clip) antes de volver al reposo; a los 45 s, otra vez. */
export const ESPERA_DURA_MS = 10_000;

type Opciones = {
  /** Los clips que hay para este avatar (si falta uno de fondo, se ve el reposo). */
  hay: readonly ClipVideo[];
  /** «Reducir movimiento»: solo los de fondo, sin golpes. */
  reducido?: boolean;
  ahora?: () => number;
  /** Cuánto va un golpe antes de pedir «habla» (GOLPE_ANTES_DE_HABLAR_MS; el teléfono, que no corta el gesto: GOLPE_ANTES_DE_HABLAR_SIN_CORTE_MS). */
  golpeAntesDeHablarMs?: number;
};

/**
 * Decide el clip. La vista le cuenta lo que pasa (el estado nuevo, que un golpe terminó) y, si hay
 * que cambiar de clip, le devuelve la reproducción nueva; null es «sigue con lo que tienes».
 */
export class DirectorVideo {
  private readonly hay: ReadonlySet<ClipVideo>;
  private readonly reducido: boolean;
  private readonly golpeAntesDeHablar: number;
  private readonly ahora: () => number;
  private actual: Reproduccion;
  private desde = 0;
  private estadoVisto: EstadoAvatar | null = null;
  private ultimoGolpe = new Map<ClipVideo, number>();
  /** El fondo que pidió el estado y todavía no se puso (esperando que se asiente), y desde cuándo. */
  private fondoPedido: ClipVideo | null = null;
  private pedidoDesde = 0;
  private actividad: Actividad = SIN_ACTIVIDAD;
  /** El último golpe de las pistas que ya se vio (hecho o no). */
  private golpePista = -1;

  constructor(o: Opciones) {
    this.hay = new Set(o.hay);
    this.reducido = !!o.reducido;
    this.golpeAntesDeHablar = o.golpeAntesDeHablarMs ?? GOLPE_ANTES_DE_HABLAR_MS;
    this.ahora = o.ahora || Date.now;
    this.actual = { clip: 'reposo', bucle: true, n: 0 };
    this.desde = this.ahora();
  }

  get reproduccion(): Reproduccion {
    return this.actual;
  }

  private poner(clip: ClipVideo, bucle: boolean): Reproduccion {
    this.fondoPedido = null;
    this.actual = { clip, bucle, n: this.actual.n + 1 };
    this.desde = this.ahora();
    if (!bucle) this.ultimoGolpe.set(clip, this.desde);
    return this.actual;
  }

  private fondo(e: EstadoAvatar | null): ClipVideo {
    return fondoDe(e || ESTADO_INICIAL, this.actividad, (c) => this.hay.has(c));
  }

  /** ¿Es el fondo que ya está? La espera cuenta como reposo (salvo dormido: dormido no espera nada). */
  private yaEsta(fondo: ClipVideo): boolean {
    return fondo === this.actual.clip || (fondo === 'reposo' && this.actual.clip === 'espera' && !this.estadoVisto?.silenciado);
  }

  private golpeDisponible(c: ClipVideo | null | undefined): c is ClipVideo {
    if (!c || this.reducido || !this.hay.has(c)) return false;
    const antes = this.ultimoGolpe.get(c);
    return antes === undefined || this.ahora() - antes >= ENFRIAR_GOLPE_MS;
  }

  /** Un golpe pedido desde fuera (al aparecer en la pantalla, saluda). */
  golpe(c: ClipVideo): Reproduccion | null {
    if (esDeFondo(c) || !this.golpeDisponible(c)) return null;
    return this.poner(c, false);
  }

  /** Llegó un estado. */
  estado(e: EstadoAvatar): Reproduccion | null {
    const antes = this.estadoVisto;
    this.estadoVisto = e;
    const gestoNuevo = e.gesto && e.gesto.n !== (antes?.gesto?.n ?? -1) ? GOLPE_DE_GESTO[e.gesto.nombre] : null;
    const caraNueva = e.expresion !== antes?.expresion ? GOLPE_DE_EXPRESION[e.expresion] : null;
    return this.decidir(gestoNuevo || caraNueva);
  }

  /** Llegaron pistas (pistas.ts): cambió la actividad o piden un golpe. */
  pistas(p: PistasVideo): Reproduccion | null {
    this.actividad = { teclea: !!p.teclea, lee: !!p.lee };
    const g = p.golpe;
    const nuevo = g && g.n !== this.golpePista && this.ahora() - g.en <= GOLPE_VIGENTE_MS ? g.clip : null;
    if (g) this.golpePista = g.n;
    return this.decidir(nuevo && !esDeFondo(nuevo) ? nuevo : null);
  }

  /** Con lo que se sabe ahora (y quizá un golpe pedido): qué clip toca. */
  private decidir(golpe: ClipVideo | null | undefined): Reproduccion | null {
    if (this.golpeDisponible(golpe) && !(golpe === this.actual.clip && !this.actual.bucle)) return this.poner(golpe, false);

    const fondo = this.fondo(this.estadoVisto);
    if (!this.actual.bucle) {
      // Un golpe en pantalla: termina su gesto, salvo que empiece a hablar y ya haya durado lo suyo.
      if (fondo === 'habla' && this.ahora() - this.desde >= this.golpeAntesDeHablar) return this.poner('habla', true);
      return null;
    }
    return this.pedirFondo(fondo);
  }

  /** Cuánto tiene que durar este cambio de fondo antes de hacerse. */
  private esperaPara(fondo: ClipVideo): number {
    if (fondo === 'habla') return 0;
    return this.actual.clip === 'habla' ? SOLTAR_HABLA_MS : ASENTAR_FONDO_MS;
  }

  /** El estado pide este fondo: se pone si ya se asentó; si no, queda pedido (la vista pone un reloj). */
  private pedirFondo(fondo: ClipVideo): Reproduccion | null {
    if (this.yaEsta(fondo)) {
      // Volvió antes de que se cumpliera la espera (una pausa entre frases): nada que cambiar.
      this.fondoPedido = null;
      return null;
    }
    if (this.fondoPedido !== fondo) {
      this.fondoPedido = fondo;
      this.pedidoDesde = this.ahora();
    }
    return this.ahora() - this.pedidoDesde >= this.esperaPara(fondo) ? this.poner(fondo, true) : null;
  }

  /** Si hay un fondo pedido que se está asentando: cuánto falta (ms). La vista pone un reloj y llama a `revisar()`. */
  msParaFondo(): number | null {
    if (!this.actual.bucle || !this.fondoPedido) return null;
    return Math.max(0, this.esperaPara(this.fondoPedido) - (this.ahora() - this.pedidoDesde));
  }

  /**
   * Si está hablando con un golpe en pantalla que todavía no cumplió su tiempo mínimo: cuánto falta
   * (ms) para pasar a «habla». La vista pone un reloj y llama a `revisar()`; sin él, el avatar seguía
   * con el golpe (sin mover la boca) hasta que el clip terminaba, casi 5 s después.
   */
  msParaHablar(): number | null {
    if (this.actual.bucle || !this.estadoVisto || this.fondo(this.estadoVisto) !== 'habla') return null;
    return Math.max(0, this.golpeAntesDeHablar - (this.ahora() - this.desde));
  }

  /**
   * En reposo (despierto, nada pedido): cuánto falta para ponerse a esperar; esperando, cuánto falta para
   * volver al reposo. null: no toca (hay algo que hacer, está dormido o no tiene el clip).
   */
  msParaEspera(): number | null {
    if (!this.actual.bucle || this.fondoPedido || !this.hay.has('espera')) return null;
    if (this.fondo(this.estadoVisto) !== 'reposo' || this.estadoVisto?.silenciado) return null;
    const pasado = this.ahora() - this.desde;
    if (this.actual.clip === 'reposo') return Math.max(0, ESPERA_TRAS_MS - pasado);
    if (this.actual.clip === 'espera') return Math.max(0, ESPERA_DURA_MS - pasado);
    return null;
  }

  /** El próximo reloj que la vista tiene que poner (y al cumplirse, llamar a `revisar()`); null: ninguno. */
  msParaRevisar(): number | null {
    const relojes = [this.msParaHablar(), this.msParaFondo(), this.msParaEspera()].filter((m): m is number => m !== null);
    return relojes.length ? Math.min(...relojes) : null;
  }

  /** Vuelve a mirar el último estado (se cumplió el reloj de `msParaRevisar`). */
  revisar(): Reproduccion | null {
    const falta = this.msParaHablar();
    if (falta === 0) return this.poner('habla', true);
    const fondo = this.fondoPedido;
    if (fondo && this.msParaFondo() === 0) return this.poner(fondo, true);
    if (this.msParaEspera() === 0) return this.poner(this.actual.clip === 'reposo' ? 'espera' : 'reposo', true);
    return null;
  }

  /** El golpe `n` terminó (o está por terminar): vuelve al fondo que toca ahora. */
  termino(n: number): Reproduccion | null {
    if (n !== this.actual.n || this.actual.bucle) return null;
    return this.poner(this.fondo(this.estadoVisto), true);
  }
}

/* ── el encuadre ─────────────────────────────────────────────────────────────────────────── */

/** Los clips son verticales 9:16. */
export const ASPECTO_VIDEO = 9 / 16;

/**
 * Qué franja del cuadro (0 arriba, 1 abajo) tiene que verse con cada cámara: el retrato es la cabeza
 * y el pecho; el cuerpo, todo. Medido sobre la foto base de cada uno (la cabeza de Claudio va de 0,09
 * a 0,38; la de ANT-ONIO, con las antenas, de 0,11 a 0,43).
 */
export const VENTANAS: Record<'claudio' | 'antonio', Record<Camara, { y0: number; y1: number }>> = {
  claudio: { retrato: { y0: 0.02, y1: 0.54 }, cuerpo: { y0: 0.02, y1: 1 } },
  antonio: { retrato: { y0: 0.04, y1: 0.58 }, cuerpo: { y0: 0.04, y1: 1 } },
};

export type Encuadre = { left: number; top: number; width: number; height: number };

/**
 * Dónde y de qué tamaño va el video dentro de una caja de W×H: la franja llena el alto de la caja,
 * centrada, sin deformar. En una caja angosta el video desborda a los lados (se recorta); en una ancha
 * (el teléfono acostado) quedan márgenes a los lados, que la vista funde con el fondo del avatar.
 * Arriba y abajo nunca quedan huecos.
 */
export function encuadrar(W: number, H: number, v: { y0: number; y1: number }, aspecto = ASPECTO_VIDEO): Encuadre {
  const alto = H / Math.max(0.05, Math.min(1, v.y1 - v.y0));
  const ancho = alto * aspecto;
  const centro = (v.y0 + v.y1) / 2;
  const top = Math.min(0, Math.max(H - alto, H / 2 - centro * alto));
  return { left: (W - ancho) / 2, top, width: ancho, height: alto };
}

/** La zona tocada, con el dedo en (x, y) de la caja: la cabeza o el cuerpo. */
export function zonaVideo(y: number, e: Encuadre, avatar: 'claudio' | 'antonio'): 'cabeza' | 'panza' {
  const enCuadro = (y - e.top) / e.height;
  return enCuadro < (avatar === 'claudio' ? 0.38 : 0.43) ? 'cabeza' : 'panza';
}
