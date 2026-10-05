/**
 * LO QUE CONTESTA EL VÍNCULO DEL MOTOR NUEVO (prototipo de Speech Engine, docs/voz/SPEECH-ENGINE.md), leído
 * con honestidad (revisión 14). Solo pasa con el motor encendido para la cuenta: el teléfono ata la
 * conversación de ElevenLabs a su pase (POST /api/voz/motor/vincular) por si ElevenLabs no reenvía `X-Pase`.
 *
 *  · 200 con `ok`: atada.
 *  · Un error del servidor de verdad trae `honesto: true` y su `codigo` (la llamada ya se cerró, ya es de otra
 *    cuenta, no hay llamada esperando, el motor no está…): la llamada no va a poder hablar como esta cuenta y
 *    el servidor ya la cuelga; el teléfono la termina bien y dice por qué, en vez de quedarse esperando.
 *  · Todo lo demás (un 404 sin cuerpo de un proxy, un 5xx, un 429, sin red, un cuerpo que no es el nuestro) NO
 *    dice nada de la llamada: es pasajero. Se reintenta un par de veces dentro del plazo del vínculo; si no, se
 *    deja estar (si la llamada se queda sin pase, el servidor la cierra y el SDK avisa la desconexión).
 *
 * Sin React ni red adentro (la petición se recibe): la web tiene la misma regla (src/03-voz/vinculoMotor.ts).
 */

export type VinculoMotor = { que: 'ok' } | { que: 'fin'; codigo: string; motivo: string } | { que: 'transitorio'; detalle: string };

/** Los códigos con los que el servidor dice que esta llamada no se va a atar (server/voz-motor.ts). */
export const CODIGOS_FIN_VINCULO = ['llamada-cerrada', 'ocupada', 'sin-llamada', 'motor-apagado', 'motor-no-activo', 'pase-ajeno', 'conversacion-invalida', 'sin-sesion'];

/** Lo que contestó el servidor (o no): `status` 0 sin respuesta. */
export function leerVinculo(status: number, cuerpo: unknown): VinculoMotor {
  const j: any = cuerpo && typeof cuerpo === 'object' ? cuerpo : null;
  if (status >= 200 && status < 300 && j?.ok === true) return { que: 'ok' };
  const codigo = typeof j?.codigo === 'string' ? j.codigo : '';
  if (status >= 400 && status < 500 && j?.honesto === true && CODIGOS_FIN_VINCULO.includes(codigo)) return { que: 'fin', codigo, motivo: String(j.error || codigo).slice(0, 160) };
  return { que: 'transitorio', detalle: status ? `HTTP ${status}${codigo ? ` (${codigo})` : ' sin respuesta del servidor de voz'}` : 'sin red' };
}

/** Intentos dentro del plazo del vínculo del servidor (VINCULAR_MS = 6 s): 3 con 1 s entre uno y otro. */
export const INTENTOS_VINCULO = 3;
export const ESPERA_VINCULO_MS = 1_000;

/**
 * Pide el vínculo; si la respuesta es pasajera, lo vuelve a pedir (unas pocas veces). Devuelve lo último que
 * se supo: `ok`, `fin` (con el porqué honesto del servidor) o `transitorio` (no se supo; decide el servidor).
 */
export async function vincularConReintentos(
  pedir: () => Promise<{ status: number; json: unknown }>,
  o: { intentos?: number; esperaMs?: number; dormir?: (ms: number) => Promise<void>; sigue?: () => boolean } = {}
): Promise<VinculoMotor> {
  const intentos = Math.max(1, o.intentos ?? INTENTOS_VINCULO);
  const dormir = o.dormir ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  let ultimo: VinculoMotor = { que: 'transitorio', detalle: 'sin intentar' };
  for (let i = 0; i < intentos; i++) {
    if (i > 0) await dormir(o.esperaMs ?? ESPERA_VINCULO_MS);
    if (o.sigue && !o.sigue()) return ultimo;
    let r: { status: number; json: unknown };
    try {
      r = await pedir();
    } catch {
      r = { status: 0, json: null };
    }
    ultimo = leerVinculo(r.status, r.json);
    if (ultimo.que !== 'transitorio') return ultimo;
  }
  return ultimo;
}
