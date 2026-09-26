/**
 * La cara de AU-RA (anillos): qué estados tiene, qué parámetros los forman y dónde cae cada pieza.
 *
 * Todo aquí es puro —números entran, números salen— para que se pueda probar en Node y para que
 * corra igual en el hilo de la interfaz (las funciones marcadas 'worklet' las usa CaraSkia dentro de
 * Reanimated). Nada de React, nada de Skia: el dibujo vive en pintar.ts.
 *
 * La idea (tablero «AU-RA · auditoría y diseño», 25-sep): los ojos no hacen gracias, dicen qué está
 * haciendo. Se expresan con tres cosas nada más: adónde mira la pupila, cuánto baja el párpado y el
 * anillo, que se vuelve barra de avance cuando trabaja. Las 22 caras del cuerpo viejo (FaceState)
 * caen en estos 10 estados.
 */
import type { FaceState } from '../caraTipos';
import type { Tarea } from '../lib/tareas';

export type EstadoCara =
  | 'espera'
  | 'escucha'
  | 'piensa'
  | 'lee'
  | 'trabaja'
  | 'habla'
  | 'listo'
  | 'necesita'
  | 'sinred'
  | 'duerme';

export const ESTADOS: readonly EstadoCara[] = ['espera', 'escucha', 'piensa', 'lee', 'trabaja', 'habla', 'listo', 'necesita', 'sinred', 'duerme'];

/** Lo que se anima entre estados. Todo número, para poder mezclar dos estados con una sola curva. */
export type Parametros = {
  /** Adónde mira, -1..1 (x derecha, y abajo), sin contar sacadas ni el dedo. */
  miradaX: number;
  miradaY: number;
  /** Escala de la pupila. */
  pupila: number;
  /** Párpado de arriba: fracción del ojo cubierta (0 abierto, 0,94 dormida). */
  tapa: number;
  /** Párpado de abajo que sube en curva: 0 nada, 1 ojos que sonríen. */
  sonrisa: number;
  /** Anillo lleno (1) o barra de avance (0..1). */
  progreso: number;
  /** 1 = avance sin total conocido: un arco que gira. */
  indeterminado: number;
  /** Color y brillo: 1 su color; 0 gris apagado (sin red). */
  luz: number;
  /** Cuánto late el halo (escuchando). */
  halo: number;
  /** Curva de la boca: -1 triste, 0 recta, 1 sonrisa. */
  boca: number;
  /** Cuánto manda la voz sobre la boca (1 al hablar). */
  habla: number;
  /** El punto ámbar de «te necesita». */
  punto: number;
  /** El recorrido de lado a lado al leer. */
  lectura: number;
};

const BASE: Parametros = {
  miradaX: 0,
  miradaY: 0,
  pupila: 1,
  tapa: 0,
  sonrisa: 0,
  progreso: 1,
  indeterminado: 0,
  luz: 1,
  halo: 0,
  boca: 0.35,
  habla: 0,
  punto: 0,
  lectura: 0,
};

export const OBJETIVOS: Record<EstadoCara, Parametros> = {
  espera: BASE,
  escucha: { ...BASE, pupila: 1.15, halo: 1, boca: 0.25 },
  piensa: { ...BASE, miradaX: 0.45, miradaY: -0.45, pupila: 0.9, tapa: 0.18, boca: 0.05 },
  lee: { ...BASE, miradaY: 0.1, pupila: 0.85, tapa: 0.28, boca: 0.1, lectura: 1 },
  trabaja: { ...BASE, pupila: 0.8, tapa: 0.12, progreso: 0, indeterminado: 1, boca: 0.1 },
  habla: { ...BASE, boca: 0.3, habla: 1 },
  listo: { ...BASE, pupila: 1.05, sonrisa: 1, boca: 1 },
  necesita: { ...BASE, punto: 1, boca: 0.2 },
  sinred: { ...BASE, pupila: 0.9, luz: 0.25, boca: 0 },
  duerme: { ...BASE, pupila: 0.8, tapa: 0.94, luz: 0.5, boca: 0.1 },
};

/** Texto corto para la línea de estado. En palabras de persona, nunca de sistema. */
export const ROTULO: Record<EstadoCara, string> = {
  espera: 'En espera',
  escucha: 'Te escucho',
  piensa: 'Pensando',
  lee: 'Leyendo',
  trabaja: 'Trabajando',
  habla: 'Hablando',
  listo: 'Listo',
  necesita: 'Te necesita',
  sinred: 'Sin conexión',
  duerme: 'Dormida',
};

/** Las 22 caras del cuerpo viejo, en los 10 estados. Molesta, traviesa y cariño ya no existen. */
const DE_CARA: Record<FaceState, EstadoCara> = {
  IDLE: 'espera',
  LISTENING: 'escucha',
  THINKING: 'piensa',
  SPEAKING: 'habla',
  SING: 'habla',
  HAPPY: 'listo',
  LAUGH: 'listo',
  PROUD: 'listo',
  WINK: 'listo',
  CURIOUS: 'escucha',
  SURPRISED: 'escucha',
  STARTLE: 'escucha',
  CONCERNED: 'piensa',
  SAD: 'piensa',
  CONFUSED: 'piensa',
  TIRED: 'piensa',
  SCAN: 'lee',
  SLEEPING: 'duerme',
  YAWNING: 'duerme',
  PRAY: 'duerme',
  ANGRY: 'espera',
  MUSIC: 'espera',
};

const TAREA_LEE: readonly Tarea[] = ['buscar', 'leer', 'mirar'];

export type Contexto = {
  face: FaceState;
  /** El cerebro responde. Sin él, en reposo se ve apagada. */
  online?: boolean;
  /** Una tarea en curso (lo que antes hacía el cuerpo en la sala). */
  tarea?: Tarea | null;
  /** Hay algo que necesita tu firma o tu respuesta. */
  necesita?: boolean;
};

/**
 * El estado que se ve. Orden de prioridad: hablar gana siempre (se oye); luego la tarea en curso;
 * luego sin red; luego «te necesita». Dormida y listo pasan tal cual.
 */
export function estadoDe(c: Contexto): EstadoCara {
  const base = DE_CARA[c.face] ?? 'espera';
  if (base === 'habla' || base === 'duerme' || base === 'listo') return base;
  if (c.tarea && (base === 'espera' || base === 'piensa' || base === 'escucha')) {
    return TAREA_LEE.includes(c.tarea) ? 'lee' : 'trabaja';
  }
  if (c.online === false && (base === 'espera' || base === 'escucha')) return 'sinred';
  if (c.necesita && base === 'espera') return 'necesita';
  return base;
}

export function mezclar(a: Parametros, b: Parametros, t: number): Parametros {
  'worklet';
  const k = t < 0 ? 0 : t > 1 ? 1 : t;
  const m = (x: number, y: number) => x + (y - x) * k;
  return {
    miradaX: m(a.miradaX, b.miradaX),
    miradaY: m(a.miradaY, b.miradaY),
    pupila: m(a.pupila, b.pupila),
    tapa: m(a.tapa, b.tapa),
    sonrisa: m(a.sonrisa, b.sonrisa),
    progreso: m(a.progreso, b.progreso),
    indeterminado: m(a.indeterminado, b.indeterminado),
    luz: m(a.luz, b.luz),
    halo: m(a.halo, b.halo),
    boca: m(a.boca, b.boca),
    habla: m(a.habla, b.habla),
    punto: m(a.punto, b.punto),
    lectura: m(a.lectura, b.lectura),
  };
}

// ---------------------------------------------------------------------------------------------
// Temas: su cara es la única luz. Cian es AU-RA; ámbar es el de noche (y el de Dr Electrum).

export type Tema = { main: string; hi: string; deep: string; fondo: string; gris: string };

export const TEMAS = {
  cian: { main: '#5CE1F7', hi: '#D4FAFF', deep: '#1C9FBD', fondo: '#0B1B22', gris: '#3A4549' },
  hielo: { main: '#BFE9FF', hi: '#FFFFFF', deep: '#6FB6D9', fondo: '#0E171D', gris: '#3A4549' },
  ambar: { main: '#FFC27A', hi: '#FFF1DC', deep: '#D9893A', fondo: '#1B140C', gris: '#4A4239' },
} as const satisfies Record<string, Tema>;

export type NombreTema = keyof typeof TEMAS;

/** Un tema a partir de un acento cualquiera (Dr Electrum pasa el suyo). */
export function temaDeAcento(acento?: string | null): Tema {
  if (!acento) return TEMAS.cian;
  const hex = normalizarHex(acento);
  if (!hex) return TEMAS.cian;
  for (const t of Object.values(TEMAS)) if (t.main === hex) return t;
  return { main: hex, hi: mezclarHex(hex, '#FFFFFF', 0.75), deep: mezclarHex(hex, '#000000', 0.35), fondo: mezclarHex(hex, '#000000', 0.88), gris: '#3A4549' };
}

function normalizarHex(c: string): string | null {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(c.trim());
  if (!m) return null;
  const h = m[1].length === 3 ? m[1].split('').map((x) => x + x).join('') : m[1];
  return '#' + h.toUpperCase();
}

/** Mezcla dos colores #RRGGBB (t=0 → a, t=1 → b). */
export function mezclarHex(a: string, b: string, t: number): string {
  'worklet';
  const k = t < 0 ? 0 : t > 1 ? 1 : t;
  const pa = parseInt(a.slice(1), 16);
  const pb = parseInt(b.slice(1), 16);
  const c = (sh: number) => {
    const x = (pa >> sh) & 255;
    const y = (pb >> sh) & 255;
    return Math.round(x + (y - x) * k);
  };
  const n = (c(16) << 16) | (c(8) << 8) | c(0);
  return '#' + n.toString(16).padStart(6, '0').toUpperCase();
}

// ---------------------------------------------------------------------------------------------
// Dónde cae cada cosa.

export type Disposicion = {
  W: number;
  H: number;
  /** Diámetro de un ojo. */
  d: number;
  /** Centro de la cara (entre los ojos). */
  cx: number;
  cy: number;
  /** Centros de los ojos. */
  exL: number;
  exR: number;
  ey: number;
  /** Grosor del anillo. */
  anillo: number;
  bocaY: number;
  bocaW: number;
};

/** Medidas del tablero: anillo 0,09 D · pupila 0,27 D · entre ojos 0,52 D · boca 0,42 D, 0,34 D abajo. */
export function disposicion(W: number, H: number, tam?: number): Disposicion {
  'worklet';
  const d = tam ?? Math.max(24, Math.min(H * 0.46, W * 0.26));
  const sep = d * 0.52;
  const cx = W / 2;
  const cy = H * 0.44;
  return {
    W,
    H,
    d,
    cx,
    cy,
    exL: cx - (d + sep) / 2,
    exR: cx + (d + sep) / 2,
    ey: cy,
    anillo: d * 0.09,
    bocaY: cy + d / 2 + d * 0.3,
    bocaW: d * 0.42,
  };
}

/** Lo que mueve la cara momento a momento, además del estado. */
export type Vivo = {
  /** Escala vertical del parpadeo (1 abierto, ~0,08 cerrado). */
  parpadeo: number;
  /** Sacadas: saltitos de la mirada, -1..1 (pequeños). */
  sacadaX: number;
  sacadaY: number;
  /** Fase de la lectura, -1..1. */
  fase: number;
  /** Latido del halo, 0..1. */
  latido: number;
  /** Giro del arco indeterminado, grados. */
  giro: number;
  /** Respiración, 0..1. */
  respira: number;
  /** Inclinación del teléfono, -1..1 (profundidad). */
  inclinX: number;
  inclinY: number;
  /** Nivel de su voz, 0..1. */
  voz: number;
  /** Mirada que viene de fuera (cámara o dedo), -1..1, y cuánto manda (0..1). */
  fueraX: number;
  fueraY: number;
  fuera: number;
};

export const VIVO_QUIETO: Vivo = {
  parpadeo: 1,
  sacadaX: 0,
  sacadaY: 0,
  fase: 0,
  latido: 0,
  giro: 0,
  respira: 0,
  inclinX: 0,
  inclinY: 0,
  voz: 0,
  fueraX: 0,
  fueraY: 0,
  fuera: 0,
};

export type Ojo = {
  x: number;
  y: number;
  /** Pupila: centro y radio. */
  px: number;
  py: number;
  pr: number;
  /** Desplazamiento del resplandor y del anillo por la inclinación (capas a distinta profundidad). */
  bx: number;
  by: number;
  ax: number;
  ay: number;
  /** Centro y radio del párpado de arriba (se recorta lo que cae dentro). */
  tapaY: number;
  tapaR: number;
  /** Centro y radio del párpado de abajo (sonrisa). */
  sonrisaY: number;
  sonrisaR: number;
};

export type Geometria = {
  L: Disposicion;
  izq: Ojo;
  der: Ojo;
  /** Escala de la respiración alrededor del centro de la cara. */
  escala: number;
  parpadeo: number;
  /** Anillo: arco desde arriba, en grados (360 = lleno). */
  arcoInicio: number;
  arcoBarrido: number;
  pistaAlfa: number;
  /** Cuánto bajan los párpados (0 = no hace falta capa para borrarlos). */
  tapa: number;
  sonrisa: number;
  luz: number;
  halo: number;
  punto: number;
  boca: number;
  bocaAbierta: number;
};

function lim(v: number): number {
  'worklet';
  return v < -1 ? -1 : v > 1 ? 1 : v;
}

/** Profundidad de cada capa al inclinar (el tablero de movimiento): pupila 1, anillo 0,45, resplandor 0,15. */
const PARALAJE_PX = 0.04;

export function geometria(p: Parametros, v: Vivo, L: Disposicion): Geometria {
  'worklet';
  const d = L.d;
  const inner = d - 2 * L.anillo;
  const rx = inner * 0.22;
  const ry = inner * 0.18;
  // La mirada: la del estado, con la lectura y las sacadas encima; lo de fuera (cámara, dedo) manda
  // en la medida en que se le dé paso.
  const propiaX = lim(p.miradaX + p.lectura * v.fase * 0.62 + v.sacadaX);
  const propiaY = lim(p.miradaY + v.sacadaY);
  const gx = lim(propiaX + (v.fueraX - propiaX) * v.fuera);
  const gy = lim(propiaY + (v.fueraY - propiaY) * v.fuera);
  const tx = v.inclinX * d * PARALAJE_PX;
  const ty = v.inclinY * d * PARALAJE_PX;
  const pr = d * 0.135 * p.pupila;
  const R = d * 0.8;
  const tapaY = -d / 2 + d * p.tapa - R - (p.tapa <= 0.001 ? 2 : 0);
  const Rs = d * 0.7;
  const sonrisaY = d * 0.7 + (1 - p.sonrisa) * (d / 2 + 2);
  const ojo = (x: number): Ojo => ({
    x,
    y: L.ey,
    px: x + gx * rx + tx,
    py: L.ey + gy * ry + ty,
    pr,
    bx: tx * 0.15,
    by: ty * 0.15,
    ax: tx * 0.45,
    ay: ty * 0.45,
    tapaY: L.ey + tapaY,
    tapaR: R,
    sonrisaY: L.ey + sonrisaY,
    sonrisaR: Rs,
  });
  const barrido = p.indeterminado > 0.5 ? 100 : Math.max(0, Math.min(360, p.progreso * 360));
  return {
    L,
    izq: ojo(L.exL),
    der: ojo(L.exR),
    escala: 1 + v.respira * 0.014,
    parpadeo: v.parpadeo,
    arcoInicio: -90 + (p.indeterminado > 0.5 ? v.giro : 0),
    arcoBarrido: barrido,
    pistaAlfa: barrido >= 359.5 ? 0 : 0.16,
    tapa: p.tapa,
    sonrisa: p.sonrisa,
    luz: p.luz,
    halo: p.halo * (0.35 + 0.65 * v.latido),
    punto: p.punto,
    boca: p.boca,
    bocaAbierta: p.habla * v.voz,
  };
}

export type Zona = 'eyeL' | 'eyeR' | 'forehead' | 'mouth' | 'chin' | 'cheek' | 'face';

/** Qué parte de la cara tocó el dedo (mismas zonas que la cara vieja, para no cambiar las reacciones). */
export function zonaDe(x: number, y: number, L: Disposicion): Zona {
  const r = (L.d / 2) * 1.1;
  if ((x - L.exL) ** 2 + (y - L.ey) ** 2 <= r * r) return 'eyeL';
  if ((x - L.exR) ** 2 + (y - L.ey) ** 2 <= r * r) return 'eyeR';
  const dentroX = Math.abs(x - L.cx) <= L.exR - L.cx + r;
  if (dentroX && y < L.ey - r) return 'forehead';
  if (Math.abs(x - L.cx) <= L.bocaW && Math.abs(y - L.bocaY) <= L.d * 0.18) return 'mouth';
  if (Math.abs(x - L.cx) <= L.bocaW && y > L.bocaY + L.d * 0.18) return 'chin';
  if (dentroX && y > L.ey - r && y < L.bocaY + L.d * 0.2) return 'cheek';
  return 'face';
}
