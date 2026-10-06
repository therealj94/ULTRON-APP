import { COMA_PRIMERA } from '../../lib/trozos';
import { avanzarEstado, estadoInicial, siguienteCorte } from '../../mobile/src/lib/cortesVoz';

/**
 * Cómo la mesa web parte en frases lo que llega del turno en stream, para ir diciéndolas sin esperar al
 * final. Una pieza sale cuando está cerrada:
 *   · termina en . ! ? … (aunque no venga el espacio de después: el servidor manda la frase terminada
 *     SIN ese espacio, lib/trozos.ts, y antes esperaba al trozo siguiente o al final del turno);
 *   · o es un corte largo por coma, punto y coma o dos puntos (el servidor ya lo decidió así para que la
 *     primera palabra no espere a que termine una frase larga).
 * Diagnóstico de voz, 1-oct, H3.
 */
/**
 * Lo mismo que el servidor (lib/trozos.ts, COMA_PRIMERA): la primera frase sale en su coma si lo de
 * antes de la coma tiene al menos esto. Antes la web pedía 40 y un tramo de 28-39 que el servidor ya
 * había soltado se quedaba esperando a la frase siguiente.
 */
export const MIN_CORTE_COMA = COMA_PRIMERA;

export function cortarFrases(pendiente: string, final = false): { listas: string[]; resto: string } {
  // El mismo contrato que el servidor y la app (mobile/src/lib/cortesVoz.ts): lo que el servidor soltó
  // hasta un corte se corta aquí en el mismo sitio, sin esperar al trozo siguiente. «Dr. Gómez» no se parte.
  const listas: string[] = [];
  let estado = estadoInicial();
  let desde = 0;
  for (let c = siguienteCorte(pendiente, 0, estado); c && c.fin > desde; c = siguienteCorte(pendiente, desde, estado)) {
    const p = pendiente.slice(desde, c.fin).trim();
    if (p) listas.push(p);
    estado = avanzarEstado(estado, c);
    desde = c.fin;
  }
  const resto = pendiente.slice(desde).trimStart();
  if (final) {
    if (resto.trim()) listas.push(resto.trim());
    return { listas, resto: '' };
  }
  return { listas, resto };
}
