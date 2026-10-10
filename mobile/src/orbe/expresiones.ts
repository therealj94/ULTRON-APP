/**
 * LAS EXPRESIONES DEL ORBE (José, 10-oct: «nos hace falta agregar más expresiones»).
 *
 * El orbe de partículas (src/14-orbe/orbe.html, en la mesa y en la burbuja del botón lateral) tenía seis estados
 * (reposo, escucha, piensa, busca, habla, listo) y casi todas las emociones del cerebro caían en «listo» o en nada. Aquí
 * vive su vocabulario de emociones: cada expresión tiene su temperatura de color (dominante A, acento B, núcleo C, en
 * lineal antes del tonemap, como la paleta del orbe), su movimiento (ruido, giro, respiración, golpe al empezar, tamaño)
 * y el brillo del núcleo (y su latido). El orbe la mezcla ENCIMA del estado con una transición suave y vuelve solo a lo
 * neutro al cabo de `ms` (`{tipo:'expresion', …}` por su puente).
 *
 * La emoción sale del turno: el servidor manda `emocion` (lib/emocion.ts); la mesa la convierte en cara (FaceState) y la
 * burbuja la tiene directa. Las dos llegan aquí.
 *
 * Sin React Native: se prueba en Node (tests/burbuja-v2.test.ts).
 */
import type { FaceState } from '../caraTipos';
import { normalizarEmocion, type Emocion } from '../lib/emocion';

export const EXPRESIONES = ['alegria', 'ternura', 'sorpresa', 'duda', 'preocupacion', 'entusiasmo', 'calma'] as const;
export type ExpresionOrbe = (typeof EXPRESIONES)[number];

type Rgb = readonly [number, number, number];

export type ParamsExpresion = {
  /** Color dominante de la cáscara, acento y núcleo (lineal, 0..~1.2). */
  A: Rgb;
  B: Rgb;
  C: Rgb;
  /** Multiplica el ruido orgánico (1 = el del estado). */
  ruido: number;
  /** Multiplica el brillo del núcleo y su halo. */
  brillo: number;
  /** Giro extra del orbe (rad/s; negativo, más lento). */
  giro: number;
  /** Respiración propia: [amplitud (fracción del radio), frecuencia en Hz]. */
  respiro: readonly [number, number];
  /** Latido del núcleo: [cuánto brilla de más, frecuencia en Hz]. */
  latido: readonly [number, number];
  /** Tamaño sostenido (+ crece, − se recoge). */
  radio: number;
  /** El golpe de tamaño al empezar (decae en ~0,3 s). */
  pulso: number;
  /** Cuánto toma prestado de otros estados: los anillos y remolinos de «piensa», la onda de «listo». */
  estados: { thinking?: number; searching?: number; done?: number };
  /** Cuánto dura antes de volver a lo neutro. */
  ms: number;
};

export const EXPRESION_PARAMS: Record<ExpresionOrbe, ParamsExpresion> = {
  // Dorado cálido, rebota un poco, la onda de «listo» y un golpecito al empezar.
  alegria: { A: [1.0, 0.8, 0.46], B: [1.0, 0.95, 0.78], C: [1.0, 0.9, 0.66], ruido: 1.1, brillo: 1.35, giro: 0.1, respiro: [0.022, 0.9], latido: [0, 0], radio: 0.02, pulso: 0.06, estados: { done: 0.6 }, ms: 4500 },
  // Rosa durazno, quieta y honda, con un latido lento en el núcleo (calidez, consuelo).
  ternura: { A: [1.0, 0.62, 0.58], B: [1.0, 0.86, 0.78], C: [1.0, 0.8, 0.7], ruido: 0.6, brillo: 1.3, giro: -0.03, respiro: [0.03, 0.22], latido: [0.22, 1.1], radio: 0, pulso: 0, estados: {}, ms: 5500 },
  // Blanco frío, destello: crece de golpe y gira rápido un momento.
  sorpresa: { A: [0.62, 0.88, 1.0], B: [1.0, 1.0, 1.0], C: [0.95, 0.98, 1.0], ruido: 1.4, brillo: 1.6, giro: 0.25, respiro: [0, 0], latido: [0, 0], radio: 0.05, pulso: 0.16, estados: { done: 0.45 }, ms: 2600 },
  // Violeta índigo, remolino y anillos de «piensa», un poco recogida.
  duda: { A: [0.56, 0.46, 1.0], B: [0.82, 0.62, 1.0], C: [0.84, 0.8, 1.0], ruido: 1.25, brillo: 1.0, giro: 0.18, respiro: [0.012, 0.35], latido: [0, 0], radio: -0.01, pulso: 0, estados: { thinking: 0.55 }, ms: 4000 },
  // Ámbar apagado, más tenue, se recoge y tiembla (respiración corta y rápida).
  preocupacion: { A: [0.72, 0.62, 0.46], B: [1.0, 0.7, 0.4], C: [0.92, 0.78, 0.58], ruido: 1.6, brillo: 0.75, giro: -0.03, respiro: [0.008, 0.7], latido: [0, 0], radio: -0.04, pulso: 0, estados: {}, ms: 4500 },
  // Naranja intenso, gira rápido, late fuerte y salta al empezar.
  entusiasmo: { A: [1.0, 0.58, 0.3], B: [1.0, 0.86, 0.4], C: [1.0, 0.84, 0.55], ruido: 1.5, brillo: 1.55, giro: 0.45, respiro: [0.02, 1.6], latido: [0.3, 2.0], radio: 0.03, pulso: 0.1, estados: { done: 0.4 }, ms: 4200 },
  // Azul verdoso hondo, casi quieta, respiración muy lenta.
  calma: { A: [0.3, 0.62, 0.95], B: [0.5, 0.9, 0.88], C: [0.72, 0.9, 1.0], ruido: 0.4, brillo: 0.85, giro: -0.04, respiro: [0.03, 0.12], latido: [0, 0], radio: 0, pulso: 0, estados: {}, ms: 6000 },
};

/** Nombre para leer (lector de pantalla, migas): la emoción no se transmite solo con color ni movimiento. */
export function nombreExpresion(e: ExpresionOrbe, en = false): string {
  const es: Record<ExpresionOrbe, [string, string]> = {
    alegria: ['contenta', 'happy'],
    ternura: ['con cariño', 'warm'],
    sorpresa: ['sorprendida', 'surprised'],
    duda: ['pensativa', 'pondering'],
    preocupacion: ['preocupada', 'concerned'],
    entusiasmo: ['entusiasmada', 'excited'],
    calma: ['tranquila', 'calm'],
  };
  return es[e][en ? 1 : 0];
}

/** La emoción del turno (la del servidor, o cualquier alias) → expresión del orbe. `neutral` → ninguna. */
export function expresionDeEmocion(raw: Emocion | string | null | undefined): ExpresionOrbe | null {
  if (!raw) return null;
  const e = normalizarEmocion(raw);
  switch (e) {
    case 'feliz':
    case 'risa':
    case 'travieso':
      return 'alegria';
    case 'carino':
    case 'triste':
      return 'ternura';
    case 'sorpresa':
      return 'sorpresa';
    case 'curioso':
    case 'pensando':
      return 'duda';
    case 'preocupado':
    case 'molesto':
      return 'preocupacion';
    case 'orgullo':
    case 'canto':
      return 'entusiasmo';
    case 'cansado':
    case 'oracion':
      return 'calma';
    default:
      return null;
  }
}

/** La cara que pidió la mesa → expresión. Las caras que ya son estados del orbe (escucha, piensa, habla…) → ninguna. */
export function expresionDeCara(face: FaceState | null | undefined): ExpresionOrbe | null {
  switch (face) {
    case 'HAPPY':
    case 'LAUGH':
    case 'WINK':
      return 'alegria';
    case 'SAD':
      return 'ternura';
    case 'SURPRISED':
    case 'STARTLE':
      return 'sorpresa';
    case 'CURIOUS':
    case 'CONFUSED':
      return 'duda';
    case 'CONCERNED':
    case 'ANGRY':
      return 'preocupacion';
    case 'PROUD':
    case 'SING':
    case 'MUSIC':
      return 'entusiasmo';
    case 'TIRED':
    case 'YAWNING':
    case 'SLEEPING':
    case 'PRAY':
      return 'calma';
    default:
      return null;
  }
}

export type MensajeExpresion = { tipo: 'expresion'; nombre: ExpresionOrbe | 'neutral'; fuerza?: number } & Partial<ParamsExpresion>;

/**
 * El mensaje para el puente del orbe. `fuerza` (0..1) la suaviza; con «reducir movimiento» se quitan el golpe, el giro y
 * casi toda la respiración (queda el color y el brillo, que no se mueven).
 */
export function mensajeExpresion(e: ExpresionOrbe | null, o: { fuerza?: number; quieto?: boolean } = {}): MensajeExpresion {
  if (!e) return { tipo: 'expresion', nombre: 'neutral' };
  const p = EXPRESION_PARAMS[e];
  const quieto = !!o.quieto;
  return {
    tipo: 'expresion',
    nombre: e,
    fuerza: Math.max(0, Math.min(1, o.fuerza ?? 1)),
    ...p,
    giro: quieto ? 0 : p.giro,
    pulso: quieto ? 0 : p.pulso,
    respiro: quieto ? [p.respiro[0] * 0.3, p.respiro[1]] : p.respiro,
  };
}

/** Temperatura de color (+ cálida, − fría): rojo menos azul del dominante y del núcleo. */
export function temperatura(e: ExpresionOrbe): number {
  const p = EXPRESION_PARAMS[e];
  return p.A[0] + p.C[0] - (p.A[2] + p.C[2]);
}

/**
 * El tinte para el orbe sin WebGL (avatar3d/OrbeMini: la foto del orbe): el núcleo de la expresión, como rgba para un
 * velo encima. `null` → sin tinte.
 */
export function tinteExpresion(e: ExpresionOrbe | null, opacidad = 0.32): string | null {
  if (!e) return null;
  const c = EXPRESION_PARAMS[e].A;
  const a = (v: number) => Math.round(Math.max(0, Math.min(1, v)) * 255);
  return `rgba(${a(c[0])},${a(c[1])},${a(c[2])},${opacidad})`;
}
