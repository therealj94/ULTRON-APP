/**
 * A NOMBRE DE QUIÉN SE CUENTA LA VOZ DE ELEVENLABS EN DR ELECTRUM (el tope diario de server/tope-voz.ts, el mismo
 * VOZ_MIEMBRO_MIN_DIA de los miembros de AU-RA).
 *
 *  · La junta y quien tiene cuenta en el padrón: sin tope (null), como la junta de AU-RA.
 *  · Quien entró con un código de prueba `DE-…` (server/cuentas.ts: su sesión es la de un correo inventado
 *    `codigo-N@temporal.drelectrum`, con persona `t-N` en el padrón): a nombre de ESA persona. Antes no se contaba (tenía
 *    persona) aunque el tope existe justamente para quien prueba.
 *  · Sin sesión (la llave de desarrollo, un cliente viejo): a nombre del visitante (`x-electrum-visita`, o la huella de
 *    IP y navegador) Y de su IP, las dos: el visitante lo elige el cliente, así que rotarlo no le da minutos nuevos (la
 *    IP sigue contada), y detrás del NAT de la operadora un visitante no se queda sin voz solo porque otro gastó la de
 *    la IP… salvo que la IP entera pase el tope, que es justo el abuso que se quiere frenar.
 *
 * Varias cuentas van juntas en una sola cadena (separadas por `|`) para que las rutas de voz las pasen como una: quedan
 * minutos solo si quedan en TODAS (`restanteVozElectrum`), y lo dicho se anota en todas (`anotarVozElectrum`).
 */
import { DOMINIO_CODIGO } from '../seguridad';

const SEP = '|';

export type QuienVoz = {
  /** La persona del padrón que identifica la sesión firmada, si hay. */
  persona?: { id?: string | null } | null;
  /** El correo de la sesión (los códigos `DE-` llevan el dominio inventado). */
  correo?: string | null;
  /** El visitante opaco (server/electrum/hilo.ts quienDelHilo con persona null). */
  visitante: string;
  /** La IP de la petición. */
  ip?: string | null;
};

export function cuentaVozDe(q: QuienVoz): string | null {
  const id = String(q.persona?.id || '').trim();
  const correo = String(q.correo || '').trim().toLowerCase();
  if (id) return correo.endsWith(DOMINIO_CODIGO) ? `electrum:persona:${id}` : null;
  const ip = String(q.ip || '').trim();
  return [`electrum:${q.visitante}`, ...(ip ? [`electrum:ip:${ip}`] : [])].join(SEP);
}

/** Lo que queda hoy: lo menos que le queda a cualquiera de sus cuentas. */
export function restanteVozElectrum(cuenta: string, restante: (quien: string) => number): number {
  return Math.min(...String(cuenta).split(SEP).filter(Boolean).map((c) => restante(c)));
}

/** Lo dicho se anota en todas sus cuentas. */
export function anotarVozElectrum(cuenta: string, ms: number, anotar: (quien: string, ms: number) => void): void {
  for (const c of String(cuenta).split(SEP).filter(Boolean)) anotar(c, ms);
}
