/**
 * EL RECIBO DEL APARATO (revisión del dueño, F02: «honestidad no confirma una acción local por su tipo»; José, 10-oct:
 * abrir Spotify). Lo que hace el teléfono —poner un recordatorio, abrir otra app, abrir el marcador, guardar un dato de su
 * perfil, mandar por el chat de AU-RA— solo cuenta como HECHO con el recibo del teléfono que lo hizo:
 *
 *  · cada acción que sale a un aparato queda anotada aquí con su id (`anotarAccionSalida`, desde empujarAccion): ese id
 *    viaja con la acción (SSE y `done` del turno) y es lo único que un recibo puede nombrar;
 *  · el teléfono contesta POST /api/app/recibo `{ id, ok, detalle? }` con SU sesión (server/app-rutas.ts). Se acepta solo
 *    si el id salió para esa cuenta (y ese aparato, si se sabe), no venció (`VIDA_RECIBO_MS`) y es de una acción local;
 *  · el primero manda: uno repetido no cambia nada (`repetido`), uno tarde no inventa nada (`vencido`), uno de un id que
 *    no conocemos —otro proceso, un reinicio— tampoco (`desconocido`): nunca se fabrica una confirmación;
 *  · con `ok`, el efecto real queda en el registro de la cuenta (lib/honestidad.ts anotarEfectoReal) y el turno siguiente
 *    puede decir «sí, quedó»; con un fallo, su motivo (y nada se da por hecho).
 *
 * En memoria (como el registro de efectos): un reinicio pierde lo anotado, y entonces un recibo tardío es `desconocido`.
 */
import type { CanalEfecto, ReciboEfecto } from './honestidad';

export const VIDA_RECIBO_MS = 15 * 60_000;
const MAX_POR_CUENTA = 100;

/** El canal del efecto de cada acción LOCAL (lo que el teléfono hace); las demás no tienen recibo de aparato. */
const CANAL_LOCAL: Record<string, CanalEfecto> = {
  recordatorio: 'recordatorio',
  cancelar_recordatorio: 'recordatorio',
  alarma: 'recordatorio',
  temporizador: 'recordatorio',
  navegar: 'app',
  // La pantalla para que ella confirme: el recibo dice que se abrió, nunca que quedó agendado o que salió.
  evento_calendario: 'revision',
  sms: 'revision',
  llamame: 'llamada',
  llamar: 'llamada',
  marcar: 'marcador',
  perfil: 'guardado',
  enviar: 'chat',
  abrir_app: 'app',
  abrir_enlace: 'app',
};
export const esAccionLocalConRecibo = (tipo: unknown) => typeof tipo === 'string' && tipo in CANAL_LOCAL;
export const canalDeAccionLocal = (tipo: string): CanalEfecto | undefined => CANAL_LOCAL[tipo];

type Salida = { id: string; tipo: string; destino?: string; aparato: string | null; t: number; recibo?: { ok: boolean; detalle?: string; t: number } };
const SALIDAS = new Map<string, Salida[]>();
const llave = (correo: string) => String(correo || '').trim().toLowerCase();

/** A quién o qué nombra una acción (para el recibo: «Spotify», el contacto). */
function destinoDe(a: Record<string, unknown>): string | undefined {
  const d = a.app ?? a.para ?? a.con ?? a.nombre;
  return typeof d === 'string' && d.trim() ? d.trim().slice(0, 120) : undefined;
}

/** Una acción local que salió a un aparato (empujarAccion). Las demás no se anotan. */
export function anotarAccionSalida(correo: string, evento: { id: string; accion: { tipo: string } & Record<string, unknown> }, aparato: string | null, ahora = Date.now()): void {
  const k = llave(correo);
  if (!k || !evento?.id || !esAccionLocalConRecibo(evento.accion?.tipo)) return;
  const xs = (SALIDAS.get(k) || []).filter((x) => ahora - x.t <= VIDA_RECIBO_MS && x.id !== evento.id);
  xs.push({ id: evento.id, tipo: evento.accion.tipo, destino: destinoDe(evento.accion), aparato, t: ahora });
  SALIDAS.set(k, xs.slice(-MAX_POR_CUENTA));
  if (SALIDAS.size > 5_000) SALIDAS.delete(SALIDAS.keys().next().value as string);
}

export type ResultadoRecibo =
  | { estado: 'aceptado'; ok: boolean; tipo: string; efecto: ReciboEfecto | null; detalle?: string }
  | { estado: 'repetido'; ok: boolean; tipo: string }
  | { estado: 'desconocido' | 'vencido' | 'otro-aparato' };

/** Un recibo del aparato (ver arriba). Idempotente: el primero manda. */
export function recibirRecibo(correo: string, r: { id: unknown; ok: unknown; detalle?: unknown }, aparato: string | null, ahora = Date.now()): ResultadoRecibo {
  const id = typeof r?.id === 'string' ? r.id.trim() : '';
  const x = id ? (SALIDAS.get(llave(correo)) || []).find((s) => s.id === id) : undefined;
  if (!x) return { estado: 'desconocido' };
  if (x.aparato && aparato && x.aparato !== aparato) return { estado: 'otro-aparato' };
  if (x.recibo) return { estado: 'repetido', ok: x.recibo.ok, tipo: x.tipo };
  if (ahora - x.t > VIDA_RECIBO_MS) return { estado: 'vencido' };
  const ok = r.ok === true;
  const detalle =
    typeof r.detalle === 'string'
      ? r.detalle
          .replace(/[\u0000-\u001f\u007f]+/g, ' ')
          .trim()
          .slice(0, 200) || undefined
      : undefined;
  x.recibo = { ok, ...(detalle ? { detalle } : {}), t: ahora };
  const canal = CANAL_LOCAL[x.tipo];
  const efecto: ReciboEfecto | null = ok && canal ? { canal, estado: 'confirmado', ...(x.destino ? { destino: x.destino } : {}), t: ahora } : null;
  avisarEspera(correo, id);
  return { estado: 'aceptado', ok, tipo: x.tipo, efecto, ...(detalle ? { detalle } : {}) };
}

/** Lo que se sabe de una acción que salió (para pruebas y registros). */
export function salidaDe(correo: string, id: string): Readonly<Salida> | undefined {
  return (SALIDAS.get(llave(correo)) || []).find((s) => s.id === id);
}

/** Pruebas: como un reinicio del proceso. */
export function _olvidarSalidas() {
  SALIDAS.clear();
  ESPERAS.clear();
}

/* ------------------------------------------------------------------ esperar el recibo un momento */

/**
 * Cuánto espera el turno el recibo del aparato antes de cerrar (auditoría del 10-oct): con el teléfono escuchando por el
 * canal, abrir una app o poner una alarma tarda unos cientos de milisegundos. Si llega, la respuesta puede decir que quedó;
 * si no, se dice que salió al teléfono («te confirmo») y el recibo, cuando llegue, queda en el registro.
 */
export const ESPERA_RECIBO_MS = 1_500;
const ESPERAS = new Map<string, Set<() => void>>();
const llaveEspera = (correo: string, id: string) => `${llave(correo)}|${id}`;

function avisarEspera(correo: string, id: string) {
  const k = llaveEspera(correo, id);
  const xs = ESPERAS.get(k);
  if (!xs) return;
  ESPERAS.delete(k);
  for (const f of xs) f();
}

/** Lo que se sabe de los recibos de unas acciones tras esperar: los efectos confirmados, las que fallaron y las que no contestaron. */
export type EsperaRecibos = { recibos: ReciboEfecto[]; fallidas: Map<string, string | undefined>; sinRecibo: string[] };

/** Espera (a lo más `ms`) el recibo de cada id; nunca inventa uno. */
export async function esperarRecibos(correo: string, ids: readonly string[], ms = ESPERA_RECIBO_MS): Promise<EsperaRecibos> {
  const propios = ids.filter((id) => !!salidaDe(correo, id));
  const falta = () => propios.filter((id) => !salidaDe(correo, id)?.recibo);
  if (falta().length && ms > 0) {
    await new Promise<void>((listo) => {
      let fin = false;
      let reloj: ReturnType<typeof setTimeout> | undefined;
      const revisar = () => {
        if (!falta().length) terminar();
      };
      const terminar = () => {
        if (fin) return;
        fin = true;
        clearTimeout(reloj);
        for (const id of propios) ESPERAS.get(llaveEspera(correo, id))?.delete(revisar);
        listo();
      };
      reloj = setTimeout(terminar, ms);
      for (const id of falta()) {
        const k = llaveEspera(correo, id);
        if (!ESPERAS.has(k)) ESPERAS.set(k, new Set());
        ESPERAS.get(k)!.add(revisar);
      }
    });
  }
  const out: EsperaRecibos = { recibos: [], fallidas: new Map(), sinRecibo: [] };
  for (const id of propios) {
    const x = salidaDe(correo, id)!;
    if (!x.recibo) out.sinRecibo.push(id);
    else if (!x.recibo.ok) out.fallidas.set(id, x.recibo.detalle);
    else {
      const canal = CANAL_LOCAL[x.tipo];
      if (canal) out.recibos.push({ canal, estado: 'confirmado', ...(x.destino ? { destino: x.destino } : {}), t: x.recibo.t });
    }
  }
  return out;
}
