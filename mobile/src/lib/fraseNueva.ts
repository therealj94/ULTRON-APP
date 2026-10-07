/**
 * LA FRASE NUEVA MANDA (José, 7-oct, mesa de AU-RA: «está loco repitiendo las cosas… contesta a lo de antes»).
 *
 * Antes, si la persona hablaba mientras AU-RA todavía pensaba la respuesta, su frase nueva esperaba en `pending` y la
 * respuesta a la frase VIEJA sonaba igual (y sus acciones salían) antes de atender la nueva: una respuesta tardía a algo
 * que ya no es lo que la persona está diciendo. Ahora:
 *  · pensando (el turno del cerebro sigue en camino y su respuesta todavía no suena): ese turno se CORTA (no suena, no se
 *    hacen sus acciones; el servidor tampoco las empuja: llegó otra frase) y la frase nueva va sola en el turno siguiente.
 *    La de antes ya está en el hilo como dicha: el servidor la marca como «de antes, sin respuesta» (contexto, no pedido);
 *  · hablando (la respuesta ya suena): como siempre. La interrupción la decide el oído (`interrumpir`); si no corta, las
 *    frases se juntan en orden y van después (Codex, 3-oct: «se juntan, no se pisan»).
 * Pura y sin React Native (la prueba en Node: mobile/pruebas/mesa/mesa.prueba.mjs).
 */

export type FraseDuranteTurno = {
  /** Cortar el turno en camino (su respuesta no suena ni hace nada). */
  cortar: boolean;
  /** Lo que queda esperando para el turno siguiente. */
  pendiente: string;
};

export function fraseDuranteTurno(o: {
  /** La frase nueva (ya sin espacios de más). */
  cmd: string;
  /** Lo que ya esperaba (frases que llegaron mientras sonaba la respuesta), o null. */
  pendiente: string | null;
  /** Hay un turno del cerebro en camino (su stream sigue abierto). */
  pensando: boolean;
  /** La respuesta de ese turno ya suena. */
  hablando: boolean;
}): FraseDuranteTurno {
  const cmd = String(o.cmd || '').trim();
  const antes = String(o.pendiente || '').trim();
  const juntas = antes ? `${antes} ${cmd}`.trim() : cmd;
  if (o.pensando && !o.hablando) return { cortar: true, pendiente: juntas };
  return { cortar: false, pendiente: juntas };
}
