/**
 * CÓMO ESTÁ AURA EN LA PANTALLA (la parte pura): la preferencia de la persona + dónde está + si hay
 * una llamada → el modo que de verdad se ve, y cómo se acomoda el panel al lado de los chats.
 *
 * La preferencia la pide José (y se guarda en el perfil, `Perfil.presencia`):
 *  · «paseo»    → la compañera chiquita de siempre, caminando por el borde;
 *  · «lado»     → mientras chatea, AURA acoplada al lado: franja arriba en vertical (no tapa la barra
 *                 de escribir ni los mensajes: los empuja), panel dividido en horizontal o tableta;
 *  · «completa» → a pantalla completa, de frente, como en la mesa.
 * Se cambia con los botones del panel y por voz («ponte a pantalla completa», «ponte al lado»,
 * «ponte chiquita»: la acción `presencia` del contrato).
 *
 * Sin React Native: se prueba en Node.
 */
import type { Pantalla } from '../nucleo/contrato';
import { MODOS_PRESENCIA, type ModoPresencia } from './tipos';

export const PRESENCIA_POR_OMISION: ModoPresencia = 'paseo';

export function normalizarPresencia(v: unknown): ModoPresencia | undefined {
  return MODOS_PRESENCIA.includes(v as ModoPresencia) ? (v as ModoPresencia) : undefined;
}

export type Lugar = {
  preferencia: ModoPresencia | undefined;
  /** La pantalla visible (null: fuera de la sesión, en la entrada o la primera vez). */
  pantalla: Pantalla | null;
  /** Hay una llamada (AURA se apaga del todo, como siempre). */
  enLlamada: boolean;
};

/** Lo que se ve de verdad: un modo de la preferencia, la mesa (su cuerpo grande) o nada. */
export type ModoVisible = ModoPresencia | 'mesa' | 'oculta';

/**
 * Lo que se ve de verdad:
 *  · fuera de la sesión o en una llamada → nada;
 *  · en la mesa → la mesa, y SOLO la mesa: su cuerpo grande es AURA de frente. Antes aquí volvía
 *    «paseo» y la compañera chiquita caminaba encima del cuerpo grande: dos Claudios a la vez (y dos
 *    escenas 3D gastando batería). La compañera se esconde y, al salir de la mesa, sale de ese cuerpo
 *    grande encogiéndose hasta su lugar (transicionMesa);
 *  · «lado» solo tiene sentido en los chats; en las demás pantallas camina como siempre.
 */
export function modoEfectivo(l: Lugar): ModoVisible {
  if (!l.pantalla || l.enLlamada) return 'oculta';
  const pref = l.preferencia || PRESENCIA_POR_OMISION;
  if (l.pantalla === 'mesa') return 'mesa';
  if (pref === 'lado') return l.pantalla === 'chats' ? 'lado' : 'paseo';
  return pref;
}

/** Los cuerpos de AURA que se pueden montar. */
export const CUERPOS = ['mesa', 'companera', 'lado', 'completa'] as const;
export type Cuerpo = (typeof CUERPOS)[number];

/** El ÚNICO cuerpo que se ve en cada modo (null: ninguno). Nunca dos. */
export function cuerpoVisible(m: ModoVisible): Cuerpo | null {
  switch (m) {
    case 'mesa':
      return 'mesa';
    case 'paseo':
      return 'companera';
    case 'lado':
      return 'lado';
    case 'completa':
      return 'completa';
    default:
      return null;
  }
}

/**
 * Qué animación toca al cambiar de modo:
 *  · de la mesa a la compañera → «encoger»: la compañera nace del tamaño y el lugar del cuerpo grande
 *    y se encoge hasta su sitio en el borde;
 *  · de la compañera a la mesa → «crecer»: crece hacia el cuerpo grande y se funde en él;
 *  · lo demás (el panel, la pantalla completa, la llamada) tiene sus propios fundidos.
 */
export function transicionMesa(antes: ModoVisible, ahora: ModoVisible): 'encoger' | 'crecer' | null {
  if (antes === 'mesa' && ahora === 'paseo') return 'encoger';
  if (antes === 'paseo' && ahora === 'mesa') return 'crecer';
  return null;
}

/** Un rectángulo en la ventana (px). */
export type Marco = { x: number; y: number; ancho: number; alto: number };

/**
 * Cuánto hay que mover y agrandar la caja de la compañera (lado `lado`, en `x, y`) para que su cuerpo
 * cubra el cuerpo grande de la mesa. El cuerpo es ~54 % de su caja; se agranda hasta ~80 % del lado
 * corto del marco (el cuerpo de la mesa no llena su marco entero).
 */
export function haciaMarco(caja: { x: number; y: number; lado: number }, m: Marco): { dx: number; dy: number; escala: number } {
  const dx = m.x + m.ancho / 2 - (caja.x + caja.lado / 2);
  const dy = m.y + m.alto / 2 - (caja.y + caja.lado / 2);
  const escala = Math.max(1, Math.min(12, (Math.min(m.ancho, m.alto) * 0.8) / (caja.lado * 0.54)));
  return { dx, dy, escala };
}

/** Cómo se acopla al lado de los chats. */
export type Disposicion = { tipo: 'franja'; alto: number } | { tipo: 'panel'; ancho: number };

/** Ancho desde el que el teléfono (o la tableta) tiene lugar para dividir la pantalla. */
export const ANCHO_PARA_PANEL = 640;

/**
 * En vertical, una franja arriba (debajo de la cabecera): los mensajes quedan debajo y la barra de
 * escribir, abajo, intacta. Acostado o en tableta, un panel a la derecha de un tercio (entre 260 y
 * 420 px) y el chat a la izquierda.
 */
export function disposicionDock(ancho: number, alto: number): Disposicion {
  if (ancho >= ANCHO_PARA_PANEL && ancho > alto * 0.9) {
    return { tipo: 'panel', ancho: Math.round(Math.max(260, Math.min(420, ancho * 0.34))) };
  }
  // Una franja más baja en teléfonos chicos: nunca más de un sexto de la pantalla.
  return { tipo: 'franja', alto: Math.round(Math.max(96, Math.min(132, alto * 0.16))) };
}

/** El modo al que lleva cada botón del panel (y el «atrás» del sistema a pantalla completa). */
export function siguienteModo(actual: ModoPresencia, boton: 'agrandar' | 'acoplar' | 'achicar' | 'atras'): ModoPresencia {
  switch (boton) {
    case 'agrandar':
      return 'completa';
    case 'acoplar':
      return 'lado';
    case 'achicar':
      return 'paseo';
    case 'atras':
      return actual === 'completa' ? 'lado' : 'paseo';
  }
}
