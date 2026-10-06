/**
 * LO QUE LA VENTANA DE DECISIÓN MUESTRA, PARA EL «SÍ» HABLADO (revisión del 6-oct, bloqueante 1: «Ningún envío si la
 * aprobación no coincide exactamente con lo mostrado»).
 *
 * Mientras la ventana de decisión de la mesa está a la vista y NO se está editando (mobile/src/trabajos/useVentanaDecision.ts),
 * aquí queda qué decisión muestra: su tarea, su decisión y la HUELLA del borrador (`decision.fingerprint`, la manda el
 * servidor). Un turno HABLADO lleva ese campo aparte (`decisionVista`, lib/api.ts turnoBody) y el servidor manda solo si
 * el borrador que espera tiene exactamente esa huella (server/decision-hablada.ts). SEC-01: lo ESCRITO con la ventana a la
 * vista también lo lleva (el servidor lo ata igual); sin ventana, lo escrito se ata a lo último presentado en el chat.
 * Si la renovación del registro contesta `registrada: false`, la ventana perdió su autoridad: el campo se suelta
 * (`trasAvisoPantalla`) y un «sí» ya no dice «esto es lo que veo» hasta que se vuelva a registrar.
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

/**
 * El campo para el cuerpo de un turno, HABLADO o ESCRITO (SEC-01: lo tecleado mientras la ventana se ve también se ata a lo
 * que muestra); el explícito gana al de la ventana. `_hablado` queda por compatibilidad de quien llama.
 */
export function campoParaTurno(_hablado: boolean | undefined, explicito?: CampoDecisionVista | null): CampoDecisionVista | null {
  return explicito === undefined ? actual : explicito;
}

/**
 * Lo que contestó el servidor a un aviso de la ventana (en-pantalla). `registrada: false` (la renovación no encontró el
 * registro: venció, se perdió o una pregunta más nueva lo reemplazó) es PÉRDIDA de autoridad, no éxito: se suelta el campo
 * de ESA decisión. true si se soltó.
 */
export function trasAvisoPantalla(c: CampoDecisionVista | null, r: { ok: boolean; registrada?: boolean }): boolean {
  if (!c || !r.ok || r.registrada !== false) return false;
  if (actual && actual.tareaId === c.tareaId && actual.decisionId === c.decisionId) {
    actual = null;
    return true;
  }
  return false;
}
