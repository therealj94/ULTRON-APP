/**
 * LO QUE HAY ENCENDIDO EN EL ÍNDICE DE CAPAS, para Dr Electrum.
 *
 * El panel (IndiceCapas.tsx) lo escribe cada vez que cambia y el chat (panel/Panel.tsx) lo manda con
 * cada pregunta: si la persona apaga una capa con la casilla, Electrum lo sabe en la pregunta
 * siguiente (correcciones v1.0, 4.1). Fuera de React a propósito: el chat no cuelga del mapa.
 */
import type { EstadoMapa } from './catalogo';

let actual: EstadoMapa | null = null;

export function fijarEstadoMapa(e: EstadoMapa) {
  actual = e;
}

/** Null si el índice de capas todavía no arrancó (la pregunta va sin estado). */
export function estadoMapa(): EstadoMapa | null {
  return actual;
}
