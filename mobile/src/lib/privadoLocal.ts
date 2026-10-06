/**
 * LO QUE EL TELÉFONO RESUELVE SOLO TAMBIÉN PASA POR «¿QUIÉN HABLA?» (revisión 7, G1: «ningún dato privado para
 * invitados»).
 *
 * Antes, las frases que la mesa atiende sin ir al servidor se saltaban el modo invitado: «¿qué sabes de mí?» leía en voz
 * alta la memoria guardada de la dueña y «recuerda que…» escribía en ella, dijera quien lo dijera. Lo mismo «aprende mi
 * voz» (¡una visita podía quedar guardada como la dueña!), «conóceme», «olvida a Ana», «¿a quién conoces?» o «cierra
 * sesión». Ahora esas frases toman la MISMA decisión que el servidor (mobile/src/voces/voces.ts quienHablaDelTurno y
 * server/modo-invitado.ts): con la voz de la dueña guardada, solo si su voz se confirmó en esa frase o por continuidad.
 * Si no: se niega con una frase corta (lo que escribe) o va al servidor, que contesta en modo invitado (lo que lee).
 * Lo escrito en la pantalla (sin frase oída) y un teléfono sin la voz de la dueña guardada siguen como siempre: la
 * sesión es la dueña. El «sí» de la persona que presentan (el consentimiento) no pasa por aquí: lo dice otra persona.
 */
import { pedidoDeCaras } from '../caras/caras';
import { fraseVozNoConfirmada, pedidoDeVoces, privadoPermitido, type QuienHablaTurno } from '../voces/voces';

/** Las intenciones locales (src/lib/intenciones.ts) que leen o escriben lo privado de la dueña. */
const INTENCIONES_PRIVADAS = new Set(['recordar', 'olvidar', 'que_recuerdas', 'conocer', 'logout']);

export function intencionPrivada(tipo: string): boolean {
  return INTENCIONES_PRIVADAS.has(tipo);
}

/**
 * ¿La frase es un pedido de voces o caras que guarda, borra o enseña lo guardado? («aprende mi voz», «olvida la voz de
 * Ana», «¿qué voces conoces?», «conóceme», «te presento a…», «olvida a Ana», «¿a quién conoces?», «¿quién soy?»). Solo
 * «¿quién habla?» de las voces no: contesta quién dijo esa frase.
 */
export function pedidoLocalPrivado(cmd: string): boolean {
  const v = pedidoDeVoces(cmd);
  if (v && v.tipo !== 'quien') return true;
  return !!pedidoDeCaras(cmd);
}

export type DecisionLocal = { permitido: true } | { permitido: false; quienHabla: QuienHablaTurno };

/**
 * La decisión para una frase local privada. `paraTurno`: el de las voces (useVoces), que ya sabe si la dueña tiene su voz
 * guardada y la continuidad; `oidaEn` 0 = escrito (la sesión manda). Si la consulta falla, no se sabe: no.
 */
export async function decidirPrivadoLocal(o: {
  oidaEn: number;
  paraTurno?: ((oidaEn: number, x?: { caraDuenaEn?: number }) => Promise<{ quienHabla?: QuienHablaTurno }>) | null;
  caraDuenaEn?: number;
}): Promise<DecisionLocal> {
  if (!(o.oidaEn > 0) || !o.paraTurno) return { permitido: true };
  let q: QuienHablaTurno | undefined;
  try {
    q = (await o.paraTurno(o.oidaEn, { caraDuenaEn: o.caraDuenaEn || 0 }))?.quienHabla;
  } catch {
    q = { incierta: true };
  }
  return privadoPermitido(q) ? { permitido: true } : { permitido: false, quienHabla: q! };
}

/** Lo que se dice al negar algo local privado: sin nombres ni nada guardado. */
export function fraseNegarLocal(q: QuienHablaTurno, en = false): string {
  if ('incierta' in q) return fraseVozNoConfirmada(en);
  return en ? "That belongs to the owner of this account, so I can't do it for you." : 'Eso es de la persona dueña de esta cuenta; no lo puedo hacer por ti.';
}
