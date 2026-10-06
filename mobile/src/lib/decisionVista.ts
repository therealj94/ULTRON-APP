/**
 * LO QUE LA VENTANA DE DECISIÓN MUESTRA, PARA EL «SÍ» HABLADO (revisión del 6-oct, bloqueante 1: «Ningún envío si la
 * aprobación no coincide exactamente con lo mostrado»).
 *
 * Mientras la ventana de decisión de la mesa está a la vista y NO se está editando (mobile/src/trabajos/useVentanaDecision.ts),
 * aquí queda qué decisión muestra: su tarea, su decisión y la HUELLA del borrador (`decision.fingerprint`, la manda el
 * servidor). Un turno HABLADO lleva ese campo aparte (`decisionVista`, lib/api.ts turnoBody) y el servidor manda solo si
 * el borrador que espera tiene exactamente esa huella (server/decision-hablada.ts). Lo escrito no lo lleva.
 *
 * Sin React ni nada nativo (las pruebas en Node lo usan tal cual).
 */
import type { TareaVista } from './trabajos';

export type CampoDecisionVista = { tareaId: string; decisionId: string; huella: string };

/** El campo de una tarea a la vista, o null si no muestra un borrador con huella (una app o un servidor de antes). */
export function campoDecisionVista(t: Pick<TareaVista, 'id' | 'decisionId' | 'decision'> | null | undefined): CampoDecisionVista | null {
  const huella = t?.decision?.fingerprint;
  const decisionId = t?.decisionId || t?.decision?.id || '';
  if (!t?.id || !decisionId || typeof huella !== 'string' || !huella) return null;
  return { tareaId: t.id, decisionId, huella };
}

let actual: CampoDecisionVista | null = null;

/** La ventana dice qué muestra (null: cerrada, otra cosa encima o editando). */
export function fijarDecisionVista(c: CampoDecisionVista | null) {
  actual = c;
}

/** Lo que muestra ahora la ventana (o null). */
export function decisionVistaActual(): CampoDecisionVista | null {
  return actual;
}

/** El campo para el cuerpo de un turno: solo si fue HABLADO; el explícito gana al de la ventana. */
export function campoParaTurno(hablado: boolean | undefined, explicito?: CampoDecisionVista | null): CampoDecisionVista | null {
  if (!hablado) return null;
  return explicito === undefined ? actual : explicito;
}
