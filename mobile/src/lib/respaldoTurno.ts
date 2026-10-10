/**
 * EL RESPALDO DEL STREAM SIN DUPLICAR EL TURNO (revisión del dueño, F02: «el respaldo stream→JSON conserva la identidad»).
 *
 * Si el stream de un turno se cae, el turno pudo haber corrido en el servidor y hecho cosas (una herramienta, una acción).
 * Antes el respaldo volvía a mandar el pedido (con el mismo idTurno, que el servidor deduplica, pero a ciegas). Ahora,
 * primero se PREGUNTA por ese idTurno (POST /api/turno/repetir, que nunca corre un turno: lib/api.ts
 * consultarTurnoGuardado) y:
 *  · si el servidor lo tiene (respondido, en curso o reconciliando) → se pide SOLO repetir: una sola operación lógica,
 *    con sus recibos de verdad;
 *  · si dice que no le llegó (`no_existe`) → recién entonces se manda el pedido;
 *  · sin saber (sin red, un servidor de antes) → se manda con el MISMO idTurno: el servidor nunca corre dos con ese id
 *    (server/turno-unico.ts).
 * Puro: lo usa la burbuja (burbuja/turnoBurbuja.ts) y lo prueba tests/telefono-acciones.test.ts.
 */
import { trasSoloRepetir } from './primerResultado';

export type PlanRespaldo = 'repetir' | 'pedir';

export function planRespaldo(consulta: { status: number; json?: unknown } | null | undefined): PlanRespaldo {
  return trasSoloRepetir(consulta).accion === 'repetir' ? 'repetir' : 'pedir';
}
