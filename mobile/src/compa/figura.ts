/**
 * LA FIGURA DE LA COMPAÑERA: qué forma toma su carita en cada expresión y cómo se mezclan.
 *
 * Es la versión mini de los avatares: un cuerpecito redondo de vidrio oscuro con los dos anillos de
 * ojos del avatar elegido (cian el Guardián, dorados con su aura AU-RA) y una boquita que sigue a la
 * voz. Cada expresión del ánimo (animo.ts) es un juego de números —párpado, ojos felices, ceño,
 * boca, rubor…— y el cambio de una a otra es una sola mezcla, igual que la cara de anillos
 * (cara/estados.ts).
 *
 * Puro y con 'worklet' donde lo usa el dibujo: corre en el hilo de la interfaz y en Node (pruebas).
 */
import { mezclarHex } from '../cara/estados';
import type { AvatarId } from '../avatares/catalogo';
import type { Expresion } from './animo';

export type Figura = {
  /** Párpado de arriba: 0 abierto, 1 cerrado. */
  tapa: number;
  /** Ojos felices (el párpado de abajo sube en arco: «^ ^»). */
  sonrisa: number;
  /** Cejas de enojo (bajan hacia el centro). */
  ceno: number;
  /** Cejas de pena (suben hacia el centro). */
  pena: number;
  /** Ojos apretados «> <» (el «¡uy!»). */
  apretar: number;
  pupila: number;
  /** Adónde mira por la expresión (-1..1). */
  miradaX: number;
  miradaY: number;
  /** Curva de la boca: -1 triste, 0 recta, 1 sonrisa. */
  boca: number;
  /** Boca abierta sin voz (sorpresa, risa). */
  abierta: number;
  /** Ancho de la boca (1 normal). */
  ancho: number;
  rubor: number;
  /** Cuerpo estirado (+) o aplastado (-). */
  estirar: number;
  /** El anillo que late escuchando. */
  halo: number;
  zzz: number;
  /** Los tres puntitos pensando. */
  puntos: number;
};

const BASE: Figura = {
  tapa: 0,
  sonrisa: 0,
  ceno: 0,
  pena: 0,
  apretar: 0,
  pupila: 1,
  miradaX: 0,
  miradaY: 0,
  boca: 0.45,
  abierta: 0,
  ancho: 1,
  rubor: 0,
  estirar: 0,
  halo: 0,
  zzz: 0,
  puntos: 0,
};

export const FIGURAS: Record<Expresion, Figura> = {
  tranquila: BASE,
  contenta: { ...BASE, sonrisa: 0.85, boca: 1, rubor: 0.55, ancho: 1.1, estirar: 0.02 },
  encantada: { ...BASE, sonrisa: 1, boca: 1, abierta: 0.55, rubor: 1, ancho: 1.25, estirar: 0.04 },
  enojada: { ...BASE, ceno: 1, tapa: 0.28, pupila: 0.8, boca: -0.7, ancho: 0.8, estirar: -0.04 },
  dormida: { ...BASE, tapa: 1, pupila: 0.8, boca: 0.15, ancho: 0.7, estirar: -0.05, zzz: 1 },
  escucha: { ...BASE, pupila: 1.18, boca: 0.3, halo: 1, miradaY: -0.1 },
  piensa: { ...BASE, miradaX: 0.55, miradaY: -0.6, tapa: 0.18, pupila: 0.9, boca: 0.05, ancho: 0.7, puntos: 1 },
  sorprendida: { ...BASE, pupila: 0.7, boca: 0, abierta: 0.6, ancho: 0.55, estirar: 0.06 },
  triste: { ...BASE, pena: 1, tapa: 0.22, miradaY: 0.35, boca: -0.8, ancho: 0.8, estirar: -0.03 },
  uy: { ...BASE, apretar: 1, boca: -0.2, abierta: 0.25, ancho: 0.75, rubor: 0.6, estirar: -0.06 },
  levantada: { ...BASE, pupila: 1.25, boca: 0.2, abierta: 0.45, ancho: 0.7, estirar: 0.1, rubor: 0.3 },
  timida: { ...BASE, sonrisa: 0.5, boca: 0.7, ancho: 0.8, rubor: 1, miradaX: -0.35, miradaY: 0.4, tapa: 0.15, estirar: -0.02 },
};

export function mezclarFigura(a: Figura, b: Figura, t: number): Figura {
  'worklet';
  const k = t < 0 ? 0 : t > 1 ? 1 : t;
  const m = (x: number, y: number) => x + (y - x) * k;
  return {
    tapa: m(a.tapa, b.tapa),
    sonrisa: m(a.sonrisa, b.sonrisa),
    ceno: m(a.ceno, b.ceno),
    pena: m(a.pena, b.pena),
    apretar: m(a.apretar, b.apretar),
    pupila: m(a.pupila, b.pupila),
    miradaX: m(a.miradaX, b.miradaX),
    miradaY: m(a.miradaY, b.miradaY),
    boca: m(a.boca, b.boca),
    abierta: m(a.abierta, b.abierta),
    ancho: m(a.ancho, b.ancho),
    rubor: m(a.rubor, b.rubor),
    estirar: m(a.estirar, b.estirar),
    halo: m(a.halo, b.halo),
    zzz: m(a.zzz, b.zzz),
    puntos: m(a.puntos, b.puntos),
  };
}

/** Lo que se mueve solo, cuadro a cuadro (valores de Reanimated). */
export type VivoCompa = {
  /** 1 abierto … 0,08 cerrado. */
  parpadeo: number;
  /** 0..1, ida y vuelta. */
  respira: number;
  /** Fase del paso, 0..1 en bucle. */
  paso: number;
  /** 0 quieta … 1 caminando. */
  caminando: number;
  /** Hacia dónde va: -1 izquierda, 1 derecha. */
  dir: number;
  /** Volumen de su voz (la boca). */
  voz: number;
  /** Volumen de la voz de la persona (el anillo que late). */
  oido: number;
  /** Mirada que manda el dedo (-1..1) y cuánto manda. */
  dedoX: number;
  dedoY: number;
  dedo: number;
  /** 0..1 en bucle: los zzz y los puntitos. */
  fase: number;
  /** La palomita ✔: 0 nada, 0..1 se dibuja, 1..2 se desvanece. */
  palomita: number;
  /** La forma de la boca que dice la voz (senalVoz): 1 redonda (o, u) … 0; 1 ancha (e, i, s) … 0. */
  redonda: number;
  ancha: number;
  /** 0..1: el latido del aura dorada. */
  latido: number;
};

export const VIVO_QUIETO: VivoCompa = {
  parpadeo: 1,
  respira: 0.5,
  paso: 0,
  caminando: 0,
  dir: 1,
  voz: 0,
  oido: 0,
  dedoX: 0,
  dedoY: 0,
  dedo: 0,
  fase: 0,
  palomita: 0,
  latido: 0.5,
  redonda: 0,
  ancha: 0,
};

/** Los colores de la compañera, sacados del avatar. */
export type EstiloCompa = {
  main: string;
  hi: string;
  deep: string;
  /** El vidrio del cuerpo, arriba (con luz) y abajo. */
  cuerpoLuz: string;
  cuerpo: string;
  /** El aura dorada de AU-RA alrededor. */
  aura: boolean;
  rubor: string;
  /** Claudio y ANT-ONIO: su retrato va encima (en un círculo) y no se dibujan ojos ni boca. */
  retrato: boolean;
};

const ACENTOS: Record<AvatarId, string> = { ojos: '#5CE1FF', aura: '#D6B56C', claudio: '#FF9A4D', antonio: '#45C9DE' };

export function estiloDe(id: AvatarId): EstiloCompa {
  const main = ACENTOS[id] || ACENTOS.aura;
  const cuerpo = id === 'ojos' ? '#061318' : id === 'aura' ? '#1B1C1F' : id === 'antonio' ? '#171B1E' : '#1F1B18';
  return {
    main,
    hi: mezclarHex(main, '#FFFFFF', id === 'aura' ? 0.62 : 0.72),
    deep: mezclarHex(main, '#000000', 0.4),
    cuerpoLuz: mezclarHex(cuerpo, main, id === 'ojos' ? 0.2 : 0.16),
    cuerpo,
    aura: id === 'aura',
    rubor: id === 'ojos' ? '#FF7FA8' : '#FF8A7A',
    retrato: id === 'claudio' || id === 'antonio',
  };
}

/** Dónde cae cada pieza dentro de su lienzo cuadrado de lado `S`. */
export type Medidas = { S: number; cx: number; cy: number; R: number };

export function medidas(S: number): Medidas {
  'worklet';
  return { S, cx: S / 2, cy: S * 0.5, R: S * 0.27 };
}

/**
 * Cuánto se eleva al caminar (px, positivo = arriba) y cuánto se inclina (grados): un rebote por
 * paso, con el cuerpo un poquito echado hacia donde va.
 */
export function rebotePaso(v: VivoCompa, R: number): { alto: number; giro: number } {
  'worklet';
  const s = Math.sin(v.paso * Math.PI * 2);
  return { alto: Math.abs(s) * R * 0.14 * v.caminando, giro: (s * 5 + v.dir * 3) * v.caminando };
}

/** Qué foto del retrato (Claudio o ANT-ONIO) va con cada expresión (las mismas de la mesa). */
export function fotoClaudio(e: Expresion): 'base' | 'risa' | 'sorpresa' | 'pensando' | 'sueno' | 'aparta' {
  switch (e) {
    case 'contenta':
    case 'encantada':
    case 'levantada':
    case 'timida':
      return 'risa';
    case 'sorprendida':
    case 'uy':
      return 'sorpresa';
    case 'piensa':
      return 'pensando';
    case 'dormida':
      return 'sueno';
    case 'triste':
    case 'enojada':
      return 'aparta';
    default:
      return 'base';
  }
}
