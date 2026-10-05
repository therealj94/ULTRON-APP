/**
 * LA ESCENA DE LOS EFECTOS: dónde va el sable, cómo se blande, por dónde vuelan los blasters y qué suena
 * cuándo. Todo en datos y funciones puras:
 *
 *  · los planes (`planEspada`, `planBlasters`, `planOnda`) se arman una vez en el hilo de JS, con el
 *    encuadre del video y el azar;
 *  · la geometría de cada cuadro (`estadoEspada`, `estadoRayo`, `sacudida`) es un worklet: corre en el
 *    hilo de la interfaz, dentro del dibujo (pintar.ts), con el tiempo de la secuencia;
 *  · los sonidos y la vibración van en `eventosDe`, que la vista programa con relojes.
 *
 * La posición del sable sale del cuadro del video: AGARRES dice dónde está la mano de cada uno en el clip
 * (0..1 sobre los 720×1280), y `encuadrar` (guion.ts, el mismo que usa CuerpoVideo) lo lleva a la caja
 * en pantalla. Así queda en la mano con el cuerpo entero (vertical), sale desde abajo en el retrato
 * (acostado y en la llamada) y sigue bien en cualquier tamaño.
 *
 * Sin React Native: lo prueban en Node (pruebas/efectos.prueba.mjs) y lo pinta scripts/qa/efectos-avatar.ts.
 */
import { VENTANAS, encuadrar, type Encuadre } from '../guion';
import type { Camara } from '../../../avatar3d/tipos';
import { duracionEfecto, type AvatarVideo, type Efecto } from './toques';

export type Pt = { x: number; y: number };

/**
 * Dónde agarra el sable, medido sobre la foto base (el primer y último cuadro de todos los clips) y sobre
 * `niega`, el golpe que acompaña al sable, que no mueve las manos:
 *  · `mano`: el centro del puño, 0..1 del cuadro (en el retrato la mano queda fuera, debajo del borde: el
 *    sable entra desde abajo);
 *  · `lado`: 1 la mano de la derecha de la pantalla, -1 la de la izquierda;
 *  · `angulo`: hacia dónde apunta en reposo (rad; 0 arriba, positivo hacia afuera del cuerpo);
 *  · `largo`: la hoja, en altos del cuadro.
 * Claudio lo saca con la mano derecha de la pantalla y ANT-ONIO con la izquierda. La llamada usa la cámara
 * de retrato pero en un círculo, donde las esquinas no se ven: el sable entra más cerca del centro.
 */
export type Agarre = {
  mano: Pt;
  lado: 1 | -1;
  angulo: number;
  largo: number;
  /**
   * Cuánto del tajo hacia el cuerpo se hace (1 entero). En el retrato la cara llena la caja: un tajo entero
   * cruzaba la hoja por encima del ojo; ahí se queda afuera, por el costado de la cara.
   */
  adentro?: number;
};
export type LugarEfectos = Camara | 'llamada';
export const AGARRES: Record<AvatarVideo, Record<LugarEfectos, Agarre>> = {
  claudio: {
    cuerpo: { mano: { x: 0.783, y: 0.712 }, lado: 1, angulo: 0.22, largo: 0.3 },
    retrato: { mano: { x: 0.86, y: 0.6 }, lado: 1, angulo: 0.06, largo: 0.34, adentro: 0.25 },
    llamada: { mano: { x: 0.7, y: 0.58 }, lado: 1, angulo: -0.42, largo: 0.3 },
  },
  antonio: {
    cuerpo: { mano: { x: 0.24, y: 0.874 }, lado: -1, angulo: 0.22, largo: 0.3 },
    retrato: { mano: { x: 0.15, y: 0.64 }, lado: -1, angulo: 0.06, largo: 0.36, adentro: 0.25 },
    llamada: { mano: { x: 0.3, y: 0.62 }, lado: -1, angulo: -0.42, largo: 0.32 },
  },
};
/**
 * El sable sin la mano, en la mesa vertical: entra desde abajo, por fuera del cuerpo, como en el retrato.
 * Es para cuando la mano no va a estar en su lugar (habla, piensa, teclea… o el comando de voz, que habla
 * enseguida): un sable en el aire, lejos de la mano que gesticula, se veía suelto. La empuñadura queda
 * bajo el borde (que se funde con el fondo) y la hoja sube casi derecha, apenas hacia el cuerpo.
 */
export const AGARRES_BORDE: Record<AvatarVideo, Agarre> = {
  claudio: { mano: { x: 0.84, y: 1.03 }, lado: 1, angulo: -0.08, largo: 0.34 },
  antonio: { mano: { x: 0.17, y: 1.03 }, lado: -1, angulo: -0.08, largo: 0.34 },
};
/** Dónde va el sable: en la mano del video, o desde el borde (en el retrato y la llamada la mano ya queda bajo el borde). */
export type Anclaje = 'mano' | 'borde';
/** ¿El sable de este lugar depende de que la mano esté en su lugar? Solo en la mesa vertical (cuerpo entero). */
export const sableEnLaMano = (l: LugarEfectos) => l === 'cuerpo';

/** La cámara del video en cada lugar (la llamada es el retrato). */
export const camaraDe = (l: LugarEfectos): Camara => (l === 'llamada' ? 'retrato' : l);

/** Los colores: el sable de Claudio es verde como su corona; el de ANT-ONIO, azul como los ribetes de su chaqueta. Los blasters, rojos. */
export const COLORES: Record<AvatarVideo, { espada: string; nucleo: string; onda: string }> = {
  claudio: { espada: '#2BFF7A', nucleo: '#F2FFF6', onda: '#5CFFA0' },
  antonio: { espada: '#2FA8FF', nucleo: '#F0F8FF', onda: '#6CC4FF' },
};
export const COLOR_RAYO = { rayo: '#FF3B2F', nucleo: '#FFF1EC', chispa: '#FFB15C' };
export const COLOR_MOLESTO = '#FF6A3D';

/** El encuadre del video en una caja (el mismo de CuerpoVideo). */
export const encuadreDe = (avatar: AvatarVideo, camara: Camara, W: number, H: number): Encuadre => encuadrar(W, H, VENTANAS[avatar][camara]);

/** Un punto del cuadro del video (0..1) en la caja. */
export const aCaja = (p: Pt, e: Encuadre): Pt => ({ x: e.left + p.x * e.width, y: e.top + p.y * e.height });

/* ── el sable ────────────────────────────────────────────────────────────────────────────── */

export type PlanEspada = {
  efecto: 'espada';
  dur: number;
  sutil: boolean;
  reducido: boolean;
  /** El centro del puño, en la caja (px). */
  pivote: Pt;
  lado: 1 | -1;
  angulo: number;
  /** La hoja entera (px). */
  largo: number;
  /** El núcleo blanco de la hoja (px); el brillo es más ancho. */
  grosor: number;
  /** La empuñadura: largo y ancho (px). */
  mango: number;
  anchoMango: number;
  color: string;
  nucleo: string;
  /** Lo que se suma al ángulo, en pares [t, rad] (hacia afuera positivo). */
  claves: number[];
  encender: [number, number];
  apagar: [number, number];
  mangoEntra: [number, number];
  mangoSale: [number, number];
  alfa: number;
  /** Se apaga antes (la mano del video se iba: agenda.ts): desde este instante, en CORTE_MS. */
  corte?: number;
};

/** Lo que tarda en desvanecerse el sable cuando se corta antes (la mano se va). */
export const CORTE_MS = 180;

/** El baile del sable: se enciende, amaga hacia afuera, tajo grande cruzando, vuelve, y lo sostiene molesto. */
const CLAVES_COMPLETA = [0, 0, 900, 0, 1150, 0.65, 1500, -0.95, 1800, 0.35, 2050, 0.05, 3200, 0.05];
const CLAVES_SUTIL = [0, 0, 480, 0, 780, 0.5, 1080, -0.1, 1700, -0.1];

export function planEspada(avatar: AvatarVideo, lugar: LugarEfectos, W: number, H: number, sutil: boolean, reducido: boolean, anclaje: Anclaje = 'mano'): PlanEspada {
  const e = encuadreDe(avatar, camaraDe(lugar), W, H);
  const a = anclaje === 'borde' && sableEnLaMano(lugar) ? AGARRES_BORDE[avatar] : AGARRES[avatar][lugar];
  const Hv = e.height;
  const c = COLORES[avatar];
  const base = {
    efecto: 'espada' as const,
    dur: duracionEfecto('espada', sutil, reducido),
    sutil,
    reducido,
    pivote: aCaja(a.mano, e),
    lado: a.lado,
    angulo: a.angulo,
    largo: a.largo * Hv * (sutil ? 0.8 : 1),
    grosor: Math.max(1.8, 0.0085 * Hv),
    mango: 0.085 * Hv,
    anchoMango: Math.max(3, 0.02 * Hv),
    color: c.espada,
    nucleo: c.nucleo,
  };
  // El tajo hacia el cuerpo, recortado donde la cara llena la caja (retrato).
  const k = a.adentro ?? 1;
  const tajo = (claves: number[]) => (k === 1 ? claves : claves.map((v, i) => (i % 2 && v < 0 ? v * k : v)));
  if (reducido)
    return { ...base, claves: [0, 0, 2000, 0], encender: [0, 300], apagar: [1600, 1950], mangoEntra: [0, 300], mangoSale: [1600, 1950], alfa: sutil ? 0.75 : 1 };
  if (sutil) return { ...base, claves: tajo(CLAVES_SUTIL), encender: [90, 330], apagar: [1150, 1380], mangoEntra: [0, 90], mangoSale: [1380, 1600], alfa: 0.82 };
  return { ...base, claves: tajo(CLAVES_COMPLETA), encender: [140, 440], apagar: [2550, 2850], mangoEntra: [0, 140], mangoSale: [2850, 3150], alfa: 1 };
}

export function suave(p: number): number {
  'worklet';
  const q = p < 0 ? 0 : p > 1 ? 1 : p;
  return q < 0.5 ? 4 * q * q * q : 1 - Math.pow(-2 * q + 2, 3) / 2;
}
export function salida(p: number): number {
  'worklet';
  const q = p < 0 ? 0 : p > 1 ? 1 : p;
  return 1 - (1 - q) * (1 - q) * (1 - q);
}
/** 0 antes de la ventana, 1 después, y en medio de 0 a 1. */
export function tramo(t: number, v: [number, number]): number {
  'worklet';
  if (t <= v[0]) return 0;
  if (t >= v[1]) return 1;
  return (t - v[0]) / (v[1] - v[0]);
}

/** El ángulo en pantalla (rad, 0 arriba, positivo a la derecha) en el instante t. */
export function anguloEspada(p: PlanEspada, t: number): number {
  'worklet';
  const k = p.claves;
  let extra = k[k.length - 1];
  for (let i = 0; i + 2 < k.length; i += 2) {
    if (t <= k[i + 2]) {
      extra = k[i + 1] + (k[i + 3] - k[i + 1]) * suave((t - k[i]) / Math.max(1, k[i + 2] - k[i]));
      break;
    }
  }
  // Un temblor de pulso (no con «reducir movimiento»): un sable de verdad nunca está quieto.
  const pulso = p.reducido ? 0 : (0.03 * Math.sin(t * 0.0105) + 0.018 * Math.sin(t * 0.029 + 1.3)) * (p.sutil ? 0.6 : 1);
  return p.lado * (p.angulo + extra + pulso);
}

export type EstadoEspada = {
  visible: boolean;
  /** La empuñadura (0..1). */
  alfaMango: number;
  /** La hoja: cuánto salió (0..1) y su opacidad. */
  hoja: number;
  alfaHoja: number;
  ang: number;
  /** El parpadeo del plasma (cerca de 1). */
  brillo: number;
  /** El destello al encenderse (0..1). */
  destello: number;
  /** Los ángulos de hace un momento (para la estela) y cuánto se nota (0..1, por la velocidad). */
  estela: number[];
  fuerzaEstela: number;
};

const PASOS_ESTELA = 8;
const DT_ESTELA = 16;

export function estadoEspada(p: PlanEspada, t: number): EstadoEspada {
  'worklet';
  const entra = tramo(t, p.mangoEntra);
  const sale = tramo(t, p.mangoSale);
  // Cortado antes de tiempo: todo se desvanece rápido, sin saltar a otra pose.
  const corte = p.corte === undefined ? 1 : 1 - tramo(t, [p.corte, p.corte + CORTE_MS]);
  const alfaMango = entra * (1 - sale) * p.alfa * corte;
  const enc = tramo(t, p.encender);
  const apa = tramo(t, p.apagar);
  // Con «reducir movimiento» la hoja no crece: aparece y se va con un fundido.
  const hoja = p.reducido ? (enc > 0 && apa < 1 ? 1 : 0) : salida(enc) * (1 - suave(apa));
  const alfaHoja = (p.reducido ? enc * (1 - apa) * p.alfa : p.alfa) * corte;
  const ang = anguloEspada(p, t);
  const estela: number[] = [];
  let fuerzaEstela = 0;
  if (!p.reducido && hoja > 0.6) {
    for (let k = 1; k <= PASOS_ESTELA; k++) estela.push(anguloEspada(p, Math.max(0, t - k * DT_ESTELA)));
    const vel = Math.abs(ang - estela[2]) / (3 * DT_ESTELA);
    fuerzaEstela = Math.min(1, vel / 0.0045);
  }
  const brillo = p.reducido ? 1 : 0.94 + 0.04 * Math.sin(t * 0.13) + 0.025 * Math.sin(t * 0.377);
  const destello = p.reducido || enc <= 0 || enc >= 1 ? 0 : Math.sin(Math.PI * enc);
  return { visible: t >= 0 && t <= p.dur && (alfaMango > 0.001 || (hoja > 0.001 && alfaHoja > 0.001)), alfaMango, hoja, alfaHoja, ang, brillo, destello, estela, fuerzaEstela };
}

/** Dónde empieza la hoja (la boca de la empuñadura) y dónde termina, con el ángulo `ang` y `hoja` (0..1). */
export function puntasEspada(p: PlanEspada, ang: number, hoja: number) {
  'worklet';
  const dx = Math.sin(ang);
  const dy = -Math.cos(ang);
  const bx = p.pivote.x + dx * p.mango * 0.55;
  const by = p.pivote.y + dy * p.mango * 0.55;
  return { bx, by, px: bx + dx * p.largo * hoja, py: by + dy * p.largo * hoja, dx, dy };
}

/* ── los blasters ────────────────────────────────────────────────────────────────────────── */

export type Rayo = {
  /** Sale (fogonazo en el borde) y llega (impacto en el otro borde). */
  t0: number;
  t1: number;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  /** Las chispas del impacto: [ángulo, velocidad px/ms, largo px] por chispa. */
  chispas: number[];
};

export type PlanBlasters = {
  efecto: 'blasters';
  dur: number;
  sutil: boolean;
  reducido: boolean;
  rayos: Rayo[];
  /** El trazo visible de cada disparo y su núcleo (px). */
  largo: number;
  grosor: number;
  /** Lo que se sacude la pantalla con cada impacto (px; 0 sin sacudida). */
  sacudir: number;
  /** El tamaño de fogonazos e impactos (px). */
  destello: number;
  alfa: number;
};

const lim = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));

export function planBlasters(W: number, H: number, sutil: boolean, reducido: boolean, rng: () => number = Math.random): PlanBlasters {
  const lado = Math.min(W, H);
  const n = reducido || sutil ? 3 : 8;
  const escala = sutil ? 0.7 : 1;
  const rayos: Rayo[] = [];
  let derecha = rng() < 0.5;
  for (let i = 0; i < n; i++) {
    let t0: number;
    let t1: number;
    if (reducido) {
      t0 = 100 + i * 500;
      t1 = t0 + 800;
    } else if (sutil) {
      t0 = 150 + i * 300;
      t1 = t0 + 340;
    } else {
      t0 = 110 + i * 235 + (rng() - 0.5) * 60;
      t1 = t0 + 290 + rng() * 60;
    }
    const y0 = H * (0.12 + 0.78 * rng());
    const y1 = lim(y0 + H * (rng() - 0.5) * 0.35, H * 0.06, H * 0.95);
    const x0 = derecha ? 0 : W;
    const x1 = derecha ? W : 0;
    // Las chispas saltan de vuelta hacia adentro de la pantalla.
    const normal = derecha ? Math.PI : 0;
    const chispas: number[] = [];
    const nCh = sutil ? 4 : 7;
    for (let k = 0; k < nCh; k++) chispas.push(normal + (rng() - 0.5) * 2.3, (0.16 + 0.26 * rng()) * (lado / 400) * escala, (6 + 7 * rng()) * (lado / 400) * escala);
    rayos.push({ t0, t1, x0, y0, x1, y1, chispas });
    derecha = !derecha;
  }
  return {
    efecto: 'blasters',
    dur: duracionEfecto('blasters', sutil, reducido),
    sutil,
    reducido,
    rayos,
    largo: lim(W * 0.2, 36, 140) * escala,
    grosor: lim(lado * 0.009, 1.5, 4) * escala,
    sacudir: sutil || reducido ? 0 : lim(lado * 0.007, 1.5, 3.5),
    destello: lim(lado * 0.045, 9, 26) * escala,
    alfa: sutil ? 0.85 : 1,
  };
}

/** Lo que dura el impacto de un disparo (chispas y destello). */
export const IMPACTO_MS = 320;
/** Con «reducir movimiento», cada disparo es un trazo quieto que aparece y se va. */
const QUIETO_ENTRA = 250;
const QUIETO_SALE = 400;

export type EstadoRayo = {
  /** El disparo en vuelo: la cabeza, la cola y su opacidad (0 si no vuela). */
  vuelo: number;
  hx: number;
  hy: number;
  cx: number;
  cy: number;
  /** El fogonazo de salida (0..1). */
  fogonazo: number;
  /** El impacto: cuánto lleva (0..1; -1 si no hay). */
  impacto: number;
};

export function estadoRayo(p: PlanBlasters, r: Rayo, t: number): EstadoRayo {
  'worklet';
  const dxT = r.x1 - r.x0;
  const dyT = r.y1 - r.y0;
  const dist = Math.max(1, Math.sqrt(dxT * dxT + dyT * dyT));
  const ux = dxT / dist;
  const uy = dyT / dist;
  if (p.reducido) {
    // Quieto: un trazo fijo a media pantalla que aparece y se va despacio; un brillo suave en el borde.
    const dura = r.t1 - r.t0;
    const s = t - r.t0;
    const a = s < 0 || s > dura ? 0 : s < QUIETO_ENTRA ? s / QUIETO_ENTRA : s > dura - QUIETO_SALE ? (dura - s) / QUIETO_SALE : 1;
    const mx = r.x0 + dxT * 0.55;
    const my = r.y0 + dyT * 0.55;
    return { vuelo: a, hx: mx + ux * p.largo * 0.5, hy: my + uy * p.largo * 0.5, cx: mx - ux * p.largo * 0.5, cy: my - uy * p.largo * 0.5, fogonazo: 0, impacto: a > 0 ? 0.5 : -1 };
  }
  const q = (t - r.t0) / (r.t1 - r.t0);
  const fogonazo = t >= r.t0 && t < r.t0 + 110 ? 1 - (t - r.t0) / 110 : 0;
  const impacto = t >= r.t1 && t < r.t1 + IMPACTO_MS ? (t - r.t1) / IMPACTO_MS : -1;
  if (q < 0 || q > 1) return { vuelo: 0, hx: 0, hy: 0, cx: 0, cy: 0, fogonazo, impacto };
  const hx = r.x0 + dxT * q;
  const hy = r.y0 + dyT * q;
  // La cola no sale de detrás del borde de donde disparan.
  const cola = Math.min(p.largo, dist * q);
  return { vuelo: 1, hx, hy, cx: hx - ux * cola, cy: hy - uy * cola, fogonazo, impacto };
}

/** La sacudida de la pantalla en t (cada impacto la empuja y se apaga sola). Cero con el sable, sutil o quieto. */
export function sacudida(p: PlanEspada | PlanBlasters | null, t: number): { x: number; y: number; k: number } {
  'worklet';
  if (!p || p.efecto !== 'blasters' || p.sacudir <= 0 || t < 0) return { x: 0, y: 0, k: 1 };
  let x = 0;
  let y = 0;
  let env = 0;
  for (let i = 0; i < p.rayos.length; i++) {
    const s = t - p.rayos[i].t1;
    if (s < 0 || s > 300) continue;
    const e = Math.exp(-s / 80);
    const dir = p.rayos[i].x1 > p.rayos[i].x0 ? 1 : -1;
    x += dir * p.sacudir * e * Math.sin(s * 0.09);
    y += p.sacudir * 0.6 * e * Math.cos(s * 0.11);
    env = Math.max(env, e);
  }
  return { x, y, k: 1 + 0.008 * env };
}

/* ── la onda de un toque ─────────────────────────────────────────────────────────────────── */

export type Onda = { x: number; y: number; r: number; color: string; sutil: boolean; reducido: boolean; molesto: boolean };
export const ONDA_MS = 520;

export function planOnda(avatar: AvatarVideo, W: number, H: number, x: number, y: number, o: { sutil: boolean; reducido: boolean; molesto?: boolean }): Onda {
  const lado = Math.min(W, H);
  return { x, y, r: lado * (o.sutil ? 0.07 : 0.11), color: o.molesto ? COLOR_MOLESTO : COLORES[avatar].onda, sutil: o.sutil, reducido: o.reducido, molesto: !!o.molesto };
}

/* ── lo que suena y vibra ────────────────────────────────────────────────────────────────── */

export type Sonido = 'saber' | 'blaster' | 'whoosh';
export type Vibra = 'ligera' | 'media';
export type Evento = { t: number; sfx?: Sonido; vibra?: Vibra };

/**
 * Los sonidos y la vibración de una secuencia, en orden. `sonido` false (sutil, en la llamada, o lo pidió
 * la mesa, que ya puso el suyo): solo la vibración. Sutil vibra una sola vez, suave.
 */
export function eventosDe(p: PlanEspada | PlanBlasters, sonido: boolean): Evento[] {
  const ev: Evento[] = [];
  if (p.efecto === 'espada') {
    if (p.sutil) return [{ t: p.encender[0], vibra: 'ligera' }];
    ev.push({ t: p.encender[0], sfx: 'saber', vibra: 'media' });
    if (!p.reducido) {
      // Cada tajo grande, un zumbido de aire.
      for (let i = 0; i + 2 < p.claves.length; i += 2) if (Math.abs(p.claves[i + 3] - p.claves[i + 1]) >= 0.5) ev.push({ t: p.claves[i], sfx: 'whoosh', vibra: 'ligera' });
      ev.push({ t: p.apagar[0], sfx: 'whoosh' });
    }
  } else {
    if (p.sutil) return [{ t: p.rayos[0]?.t0 ?? 0, vibra: 'ligera' }];
    for (const r of p.rayos) ev.push({ t: Math.max(0, r.t0), sfx: 'blaster', vibra: 'ligera' });
  }
  return ev.map((e) => (sonido ? e : { t: e.t, vibra: e.vibra })).filter((e) => e.sfx || e.vibra).sort((a, b) => a.t - b.t);
}
