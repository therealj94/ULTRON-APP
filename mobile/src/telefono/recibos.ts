/**
 * EL RECIBO DEL TELÉFONO (revisión del dueño, F02; auditoría del 10-oct: el `hecho` de cada acción se quedaba en el
 * teléfono y el servidor daba por hecho lo que salía por su TIPO).
 *
 * Cada acción que llega del servidor trae su id (por el canal de acciones o en el `done` del turno). Lo que hace el
 * teléfono con ella —poner un recordatorio, abrir una app, abrir el marcador, guardar un dato, mandar por el chat— vuelve
 * al servidor con ESE id: POST /api/app/recibo `{ id, ok, detalle? }` (server/app-rutas.ts, lib/recibos-aparato.ts). Sin
 * ese recibo, AU-RA no dice «listo»; con un fallo, dice por qué.
 *
 *  · `anotarIdAccion`: el id de cada acción nueva, por su firma (compa/acciones.ts accionNueva lo llama);
 *  · `mandarRecibo`: el recibo de una acción LOCAL (las demás no tienen), una sola vez por id; si no se sabe su id (una
 *    acción sin id, de un servidor viejo) no se manda nada: el servidor no puede atarla y no se inventa;
 *  · el envío de verdad lo pone la app (`fijarEnvioRecibos`, con api()): aquí no hay red, para que las pruebas lo corran.
 *
 * Puro (sin React Native).
 */

/** Las acciones que hace el teléfono (las mismas de lib/recibos-aparato.ts CANAL_LOCAL en el servidor). */
export const ACCIONES_LOCALES = [
  'recordatorio',
  'cancelar_recordatorio',
  'llamame',
  'llamar',
  'marcar',
  'perfil',
  'enviar',
  'abrir_app',
  'abrir_enlace',
  'navegar',
  'alarma',
  'temporizador',
  'sms',
  'evento_calendario',
] as const;
export const esLocal = (tipo: unknown) => (ACCIONES_LOCALES as readonly unknown[]).includes(tipo);

export type Recibo = { id: string; ok: boolean; detalle?: string };
type Envio = (r: Recibo) => Promise<unknown>;

const VIDA_MS = 15 * 60_000;
const ids: Array<{ firma: string; id: string; en: number }> = [];
const mandados = new Set<string>();
let enviar: Envio | null = null;

/** La acción en texto estable (claves en orden), como compa/acciones.ts firmaAccion. */
export function firma(a: unknown): string {
  if (!a || typeof a !== 'object') return '';
  const o = a as Record<string, unknown>;
  return JSON.stringify(Object.keys(o).sort().map((k) => [k, typeof o[k] === 'string' ? String(o[k]).trim() : o[k]]));
}

/** El id de una acción que llegó (para su recibo). */
export function anotarIdAccion(accion: unknown, id: string, ahora = Date.now()): void {
  const f = firma(accion);
  if (!f || !id) return;
  while (ids.length && ahora - ids[0].en > VIDA_MS) ids.shift();
  ids.push({ firma: f, id, en: ahora });
  if (ids.length > 300) ids.shift();
}

/** El id de la última vez que llegó esta acción (o null). */
export function idDeAccion(accion: unknown, ahora = Date.now()): string | null {
  const f = firma(accion);
  for (let i = ids.length - 1; i >= 0; i--) if (ids[i].firma === f && ahora - ids[i].en <= VIDA_MS) return ids[i].id;
  return null;
}

/** Cómo sale el recibo (la app pone api(); las pruebas, uno de mentira). */
export function fijarEnvioRecibos(f: Envio | null): void {
  enviar = f;
}

/**
 * El recibo de una acción local, una vez por id. `id` explícito (la burbuja lo tiene del `done`); si no, el que se anotó
 * al llegar. Devuelve si salió (false: no es local, no hay id, ya se mandó o no hay con qué mandarlo).
 */
export async function mandarRecibo(accion: { tipo: string }, ok: boolean, detalle?: string, id?: string | null): Promise<boolean> {
  if (!esLocal(accion?.tipo)) return false;
  const cual = id || idDeAccion(accion);
  if (!cual || mandados.has(cual) || !enviar) return false;
  mandados.add(cual);
  if (mandados.size > 500) mandados.delete(mandados.values().next().value as string);
  const d = typeof detalle === 'string' && detalle.trim() ? detalle.trim().slice(0, 200) : undefined;
  try {
    await enviar({ id: cual, ok, ...(d ? { detalle: d } : {}) });
    return true;
  } catch {
    // Sin red: el servidor no lo sabrá (y no dirá que quedó). Se puede volver a intentar con el mismo id.
    mandados.delete(cual);
    return false;
  }
}

/** Pruebas. */
export function _olvidarRecibos() {
  ids.length = 0;
  mandados.clear();
  enviar = null;
}
