/**
 * EL GUION DEL VIDEO: qué clip de Claudio o ANT-ONIO se ve en cada momento.
 *
 * Son 9 clips de 5 s por avatar, generados a partir de una sola foto base (scripts y prompts en
 * docs/avatares-video.md). Todos empiezan y terminan en esa misma pose, así que cualquier clip
 * engancha con cualquier otro sin salto. Hay dos clases:
 *
 *  · de FONDO, que se repiten mientras dura el estado: reposo, escucha, habla, piensa;
 *  · GOLPES, que se hacen una vez y vuelven al fondo: risa, saluda, señala, sorpresa, triste.
 *
 * El estado llega en el idioma del contrato (avatar3d/contrato.ts, EstadoAvatar), el mismo que le
 * llega al cuerpo 3D: así el video es un cuerpo más, intercambiable.
 *
 * Puro y sin React Native: lo prueban en Node (pruebas/video.prueba.mjs).
 */
import type { Camara, EstadoAvatar, ExpresionAvatar, GestoAvatar } from '../../avatar3d/tipos';

export const CLIPS_VIDEO = ['reposo', 'escucha', 'habla', 'piensa', 'risa', 'saluda', 'senala', 'sorpresa', 'triste'] as const;
export type ClipVideo = (typeof CLIPS_VIDEO)[number];

const DE_FONDO: readonly ClipVideo[] = ['reposo', 'escucha', 'habla', 'piensa'];
export const esDeFondo = (c: ClipVideo) => DE_FONDO.includes(c);

/** El clip que se repite con este estado. */
export function fondoDe(e: EstadoAvatar): ClipVideo {
  if (e.hablando) return 'habla';
  if (e.pensando || e.expresion === 'piensa') return 'piensa';
  if (e.escuchando) return 'escucha';
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

/** Lo que tiene que sonar en la pantalla. `n` cambia en cada clip nuevo (aunque se repita el mismo). */
export type Reproduccion = { clip: ClipVideo; bucle: boolean; n: number };

/** El mismo golpe no se repite antes de esto (una risa por chiste, no tres). */
export const ENFRIAR_GOLPE_MS = 8000;
/** Si empieza a hablar con un golpe en pantalla, se le deja terminar el gesto hasta esto; luego habla. */
export const GOLPE_ANTES_DE_HABLAR_MS = 1800;

type Opciones = {
  /** Los clips que hay para este avatar (si falta uno de fondo, se ve el reposo). */
  hay: readonly ClipVideo[];
  /** «Reducir movimiento»: solo los de fondo, sin golpes. */
  reducido?: boolean;
  ahora?: () => number;
};

/**
 * Decide el clip. La vista le cuenta lo que pasa (el estado nuevo, que un golpe terminó) y, si hay
 * que cambiar de clip, le devuelve la reproducción nueva; null es «sigue con lo que tienes».
 */
export class DirectorVideo {
  private readonly hay: ReadonlySet<ClipVideo>;
  private readonly reducido: boolean;
  private readonly ahora: () => number;
  private actual: Reproduccion;
  private desde = 0;
  private estadoVisto: EstadoAvatar | null = null;
  private ultimoGolpe = new Map<ClipVideo, number>();

  constructor(o: Opciones) {
    this.hay = new Set(o.hay);
    this.reducido = !!o.reducido;
    this.ahora = o.ahora || Date.now;
    this.actual = { clip: 'reposo', bucle: true, n: 0 };
    this.desde = this.ahora();
  }

  get reproduccion(): Reproduccion {
    return this.actual;
  }

  private poner(clip: ClipVideo, bucle: boolean): Reproduccion {
    this.actual = { clip, bucle, n: this.actual.n + 1 };
    this.desde = this.ahora();
    if (!bucle) this.ultimoGolpe.set(clip, this.desde);
    return this.actual;
  }

  private fondo(e: EstadoAvatar | null): ClipVideo {
    const c = e ? fondoDe(e) : 'reposo';
    return this.hay.has(c) ? c : 'reposo';
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
    const golpe = gestoNuevo || caraNueva;
    if (this.golpeDisponible(golpe) && !(golpe === this.actual.clip && !this.actual.bucle)) return this.poner(golpe, false);

    const fondo = this.fondo(e);
    if (!this.actual.bucle) {
      // Un golpe en pantalla: termina su gesto, salvo que empiece a hablar y ya haya durado lo suyo.
      if (fondo === 'habla' && this.ahora() - this.desde >= GOLPE_ANTES_DE_HABLAR_MS) return this.poner('habla', true);
      return null;
    }
    return fondo === this.actual.clip ? null : this.poner(fondo, true);
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
