/**
 * UN SOLO ORBE VIVO (José, 11-oct: «cuando se hace pequeño aura en chat se vea igual cuando es avatar»).
 *
 * La AU-RA chiquita (el acople al lado de los chats, la pantalla completa y la que camina) ahora es el MISMO orbe de
 * partículas de la mesa (src/14-orbe/orbe.html), como ya lo era la burbuja del botón lateral: mismos colores, mismas
 * expresiones, mismo movimiento. Antes era la foto del orbe (OrbeMini) porque la regla es que nunca haya dos escenas WebGL
 * vivas a la vez, y el orbe grande de la mesa sigue montado debajo de los chats.
 *
 * Cómo se cumple la regla ahora:
 *  · la mesa PAUSA su orbe mientras no se ve (components/OrbeAura.tsx `activo` → `{tipo:'pausa'}`: el bucle se corta del
 *    todo, la GPU queda libre) y suelta el turno;
 *  · el turno del orbe vivo es uno solo (`orbeVivo`): la mesa lo toma a la fuerza al volver a verse (el chico, que lo
 *    escucha, vuelve a su foto en ese mismo instante) y un orbe chico solo lo toma si está libre;
 *  · sin turno, o si su WebView no arranca, la AU-RA chiquita es la foto de siempre (con el velo de la emoción): nunca
 *    un círculo vacío. Si se cae dos veces en la sesión, ya no se reintenta (`chicoPuedeIntentar`).
 *
 * La burbuja del botón lateral queda fuera del turno, pero no porque la app detrás deje de dibujar: BurbujaActivity es
 * translúcida y la de la app sigue «activa» para React. Por eso, mientras la burbuja está abierta (burbuja/logica.ts
 * `burbujaAbierta`), la mesa se pausa (screens/DeskScreen.tsx) y la AU-RA chiquita no pide el turno
 * (avatar3d/OrbeAuraChica.tsx): el único orbe vivo es el de la burbuja.
 *
 * Puro (sin React Native): tests/burbuja-v2.test.ts («la AU-RA chiquita es el mismo orbe»).
 */
import { canal } from '../compa/canales';
import { CASCARA_SOBRE_DISCO, LIENZO_SOBRE_DISCO } from '../burbuja/medidas';
import type { EstadoAvatar } from './tipos';

/** El turno de la mesa (los orbes chicos usan un id propio). */
export const DUENO_MESA = 'mesa';

/** Quién dibuja el orbe de partículas EN VIVO ahora mismo (null: nadie). */
export const orbeVivo = canal<string | null>(null);

/** ¿Puede `id` tomar el turno? Solo si está libre o ya es suyo (la mesa pasa `forzar`). */
export function puedeTomar(dueno: string | null, id: string, forzar = false): boolean {
  return forzar || dueno === null || dueno === id;
}

/** Toma el turno si puede; devuelve si quedó suyo. Atómico: el canal avisa a los demás antes de volver. */
export function tomarOrbeVivo(id: string, o: { forzar?: boolean } = {}): boolean {
  const d = orbeVivo.ultimo();
  if (!puedeTomar(d, id, !!o.forzar)) return false;
  if (d !== id) orbeVivo.emitir(id);
  return true;
}

/** Suelta el turno (solo si era suyo: la mesa que se pausa no le quita el turno a un chico que ya lo tiene). */
export function soltarOrbeVivo(id: string): void {
  if (orbeVivo.ultimo() === id) orbeVivo.emitir(null);
}

/* ── si la WebView no da en este teléfono ───────────────────────────────────────────────────── */

/** Caídas del orbe chico en esta sesión: a la segunda, queda la foto (sin reintentar en cada chat). */
export const CAIDAS_MAX_CHICO = 2;
let caidasChico = 0;
export function anotarCaidaChico(): void {
  caidasChico++;
}
export function chicoPuedeIntentar(): boolean {
  return caidasChico < CAIDAS_MAX_CHICO;
}
/** Solo para las pruebas. */
export function _reiniciarCaidasChico(): void {
  caidasChico = 0;
}

/* ── el estado del alma → el estado del orbe ────────────────────────────────────────────────── */

/** Los estados del orbe en encuadre «centro» (los mismos de la burbuja: burbuja/OrbeBurbuja.tsx). */
export type EstadoOrbeChico = 'reposo' | 'escucha' | 'piensa' | 'habla' | 'apagado';

/**
 * Lo mismo que hace la mesa con su orbe: habla mientras suena su voz (y forma su latido con ella), piensa esperando al
 * cerebro, escucha con la conversación abierta (o con la cara de escuchar, la «oreja» del teléfono), y en silencio se
 * duerme. Silenciada, hablando o pensando mandan sobre la cara de escuchar.
 */
export function estadoOrbeChico(
  e: (Pick<EstadoAvatar, 'hablando' | 'pensando' | 'escuchando' | 'silenciado'> & Partial<Pick<EstadoAvatar, 'expresion'>>) | undefined
): EstadoOrbeChico {
  if (!e) return 'reposo';
  if (e.silenciado) return 'apagado';
  if (e.hablando) return 'habla';
  if (e.pensando) return 'piensa';
  if (e.escuchando || e.expresion === 'escucha') return 'escucha';
  return 'reposo';
}

/* ── el encuadre ────────────────────────────────────────────────────────────────────────────── */

/** Sin sitio para el halo (el acople recorta su cuadro): el lienzo es el cuadro y el disco algo menor. */
export const LIENZO_AJUSTADO = 1.18;

export type GeometriaOrbeChico = {
  /** Diámetro del disco (y de la foto del primer cuadro). */
  disco: number;
  /** Lado del lienzo de la WebView (disco + halo). */
  lienzo: number;
  /** Fracciones del lienzo para orbe.html `centro`. */
  radioOrbe: number;
  radioDisco: number;
};

/**
 * `lado`: el cuadro que le dan. Con `halo` (la que camina: nada la recorta), el disco es el cuadro y el lienzo sale por
 * fuera, como en la burbuja; sin halo (el acople, la pantalla completa), todo cabe en el cuadro.
 */
export function geometriaOrbeChico(lado: number, halo = false): GeometriaOrbeChico {
  const l = Math.max(24, Math.round(lado));
  const sobre = halo ? LIENZO_SOBRE_DISCO : LIENZO_AJUSTADO;
  const disco = halo ? l : Math.round(l / sobre);
  const lienzo = halo ? Math.round(l * sobre) : l;
  return { disco, lienzo, radioDisco: 0.5 / sobre, radioOrbe: (0.5 * CASCARA_SOBRE_DISCO) / sobre };
}
