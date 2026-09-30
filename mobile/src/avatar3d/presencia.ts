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

/**
 * Lo que se ve de verdad:
 *  · fuera de la sesión o en una llamada → nada;
 *  · en la mesa → la compañera de siempre (la mesa ya es AURA de frente, a pantalla completa);
 *  · «lado» solo tiene sentido en los chats; en las demás pantallas camina como siempre.
 */
export function modoEfectivo(l: Lugar): ModoPresencia | 'oculta' {
  if (!l.pantalla || l.enLlamada) return 'oculta';
  const pref = l.preferencia || PRESENCIA_POR_OMISION;
  if (l.pantalla === 'mesa') return 'paseo';
  if (pref === 'lado') return l.pantalla === 'chats' ? 'lado' : 'paseo';
  return pref;
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
