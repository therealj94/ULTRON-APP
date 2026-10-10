/**
 * LA PUERTA DEL EFECTO (F01 del plan de cierre 5.7): cancelar revoca la autoridad pendiente, y NADA sale sin pasar por
 * aquí justo antes de despacharse.
 *
 * Por qué: cancelar un objetivo dejaba una lápida «lo mejor posible» (si no se escribía, igual decía «cancelado») y el
 * envío no la volvía a mirar: una réplica con el borrador en su memoria lo mandaba con un «sí» suelto. Ahora hay UN
 * registro durable por operación de efecto (`autoridad/efectos/<huella del dueño>/<operación>`), versionado
 * (`generacion` sube en cada cambio), y dos movimientos con compare-and-set SOBRE ESA MISMA CLAVE:
 *
 *   · `revocarAutoridad` (cancelar el objetivo o la tarea): `revocada`. Si ya estaba `reclamada`, NO se revoca: la acción
 *     ya fue aceptada y su recibo llegará (se dice «ya aceptada», no «cancelada»). Si el almacén no contesta: `incierto`
 *     (quien cancela lo dice así; nunca un «cancelado» definitivo).
 *   · `pasarPuerta` (el despachador común, lib/envios.ts `enviarUnaVez`, justo después de registrar la operación y ANTES
 *     de marcarla `dispatched`): valida, en este orden, el dueño autenticado (la operación es suya: la clave lleva su
 *     huella), el vencimiento de la propuesta, el acceso vigente del dueño (`fijarVerificadorAcceso`: padrón y llaves; una
 *     aprobación de antes de quitarle el acceso ya no autoriza), la autoridad del ejecutor (el lease y su token de fencing,
 *     por parámetro o por `conAutoridadDeEjecutor`), el vínculo (la tarea y el objetivo de esa propuesta no están
 *     cancelados), la lápida del borrador y, al final, RECLAMA la operación (`reclamada`, con la huella aprobada y el
 *     token). Si cualquier cosa no se puede comprobar, no sale (`almacen`) y se dice.
 *
 * EL PUNTO DE NO RETORNO es ese reclamo: la escritura condicional que pasa el registro a `reclamada`. Antes de él, un
 * cancelar gana y el efecto no se despacha (la operación queda `failed`, efecto ninguno). Después de él, el cancelar ve
 * `reclamada` y contesta «acción ya aceptada»: el proveedor puede estar recibiéndola y su recibo se conserva (si se pierde
 * la respuesta, la operación queda `dispatched`/`unknown` y se reconcilia; nunca se repite a ciegas). Como los dos
 * movimientos son CAS sobre la misma clave, el orden entre réplicas es total: no hay «los dos ganaron».
 *
 * La clave de la operación es estable entre reintentos del transporte y entre superficies (teléfono, web, Windows, el
 * chat): dueño (huella) + operación (`envio-<canal>-<intento>`, el intento es la propuesta), y la huella aprobada (que
 * incluye la cuenta remitente, el destino y el contenido) viaja como `argsHash`: otra cuenta u otro contenido es otra
 * aprobación.
 *
 * Nada aquí guarda textos, direcciones ni correos: ids, huellas, estados y tiempos.
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import { almacenDurable, claveDe, leaseVigente, leerDurable, modificarDurable, type AlmacenDurable, type Lease } from './durable';
import { leerObjetivo } from './objetivos';
import { leerTarea, tareaDePedido } from './tareas-durables';

export type EstadoAutoridad = 'revocada' | 'reclamada';
export type RegistroAutoridad = {
  v: 1;
  operacion: string;
  estado: EstadoAutoridad;
  /** Sube en cada cambio (la versión de la autoridad). */
  generacion: number;
  /** La huella aprobada con que se reclamó. */
  huella?: string;
  /** El token de fencing del ejecutor que la reclamó. */
  token?: number;
  motivo?: string;
  /** La revisión del objetivo cuando se revocó (para auditar el orden). */
  revision?: number;
  t: number;
  historia: { estado: EstadoAutoridad; t: number }[];
};

export const claveAutoridad = (dueno: string, operacion: string) => claveDe('autoridad/efectos', dueno, operacion);
/** La lápida de un borrador (la misma que server/borradores-durables.ts): rechazado, reemplazado o descartado. */
export const claveLapidaBorrador = (dueno: string, intento: string) => claveDe('borradores/descartados', dueno, intento);

/** Dónde está la frontera, dicho para quien lee la respuesta del cancelar o del envío. */
export const PUNTO_SIN_RETORNO =
  'La acción queda aceptada cuando el despachador la reclama (justo antes de hablar con el proveedor). Antes de eso, cancelar la impide; después, su resultado llega y se conserva.';

/* ------------------------------------------------------------------ revocar */

export type ResultadoRevocar = { resultado: 'revocada' | 'ya-revocada' | 'ya-aceptada'; generacion: number } | { resultado: 'incierto'; detalle: string };

/** Revoca la autoridad de una operación que todavía no se reclamó. Nunca lanza. */
export async function revocarAutoridad(dueno: string, operacion: string, o: { motivo: string; revision?: number; almacen?: AlmacenDurable; ahora?: number }): Promise<ResultadoRevocar> {
  const t = o.ahora ?? Date.now();
  let resultado: 'revocada' | 'ya-revocada' | 'ya-aceptada' = 'revocada';
  let generacion = 0;
  const r = await modificarDurable<RegistroAutoridad>(
    claveAutoridad(dueno, operacion),
    (rec) => {
      resultado = 'revocada';
      generacion = rec?.generacion ?? 0;
      if (rec?.estado === 'reclamada') return void (resultado = 'ya-aceptada');
      if (rec?.estado === 'revocada') return void (resultado = 'ya-revocada');
      generacion += 1;
      return { v: 1, operacion, estado: 'revocada', generacion, motivo: o.motivo.slice(0, 60), ...(o.revision !== undefined ? { revision: o.revision } : {}), t, historia: [...(rec?.historia || []), { estado: 'revocada' as const, t }].slice(-10) };
    },
    o.almacen || almacenDurable()
  ).catch((e) => ({ ok: false as const, conflicto: false, detalle: String(e?.message || e) }));
  if (r.ok === false) return { resultado: 'incierto', detalle: r.detalle.slice(0, 160) };
  return { resultado, generacion };
}

/** Cómo está la autoridad de una operación (sin cambiarla). `incierto` si no se pudo leer. */
export async function leerAutoridad(dueno: string, operacion: string, a: AlmacenDurable = almacenDurable()): Promise<RegistroAutoridad | null | 'incierto'> {
  const l = await leerDurable<RegistroAutoridad>(claveAutoridad(dueno, operacion), a).catch(() => null);
  if (!l || l.ok === false) return 'incierto';
  return l.valor;
}

/**
 * ¿La propuesta de ese borrador perdió su autoridad? (la autoridad revocada o su lápida). Para que una caché de réplica
 * no responda «sigue esperando» sin volver a mirar lo durable. `incierto` si no se pudo leer.
 */
export async function borradorRevocado(dueno: string, canal: 'correo' | 'whatsapp', intento: string, a: AlmacenDurable = almacenDurable()): Promise<boolean | 'incierto'> {
  const rec = await leerAutoridad(dueno, `envio-${canal}-${intento}`, a);
  if (rec === 'incierto') return 'incierto';
  if (rec?.estado === 'revocada') return true;
  const lap = await leerDurable(claveLapidaBorrador(dueno, intento), a).catch(() => null);
  if (!lap || lap.ok === false) return 'incierto';
  return !!lap.valor;
}

/* ------------------------------------------------------------------ quién ejecuta y con qué acceso */

type ContextoEjecutor = { lease?: Lease; ahora?: () => number };
const ejecutor = new AsyncLocalStorage<ContextoEjecutor>();

/**
 * Corre `f` con la autoridad de un ejecutor (su lease, con el token de fencing): todo efecto que salga dentro pasa la
 * puerta con ESE lease. Si el lease venció o lo tomó otro (token mayor), el efecto no se despacha.
 */
export function conAutoridadDeEjecutor<T>(c: ContextoEjecutor, f: () => T): T {
  return ejecutor.run(c, f);
}

export type VerificadorAcceso = (p: { dueno: string; preparado?: number }) => boolean | 'incierto' | Promise<boolean | 'incierto'>;
let verificadorAcceso: VerificadorAcceso | null = null;

/**
 * El acceso vigente del dueño (server.ts lo fija: sigue en el padrón de AU-RA y no se le cerraron las sesiones/llaves
 * después de preparar la propuesta). Sin verificador (pruebas, desarrollo) no se mira. `null` lo quita.
 */
export function fijarVerificadorAcceso(f: VerificadorAcceso | null): void {
  verificadorAcceso = f;
}

/* ------------------------------------------------------------------ la puerta */

export type MotivoPuerta = 'revocada' | 'vencida' | 'acceso' | 'lease' | 'aprobacion' | 'almacen';
export type ResultadoPuerta = { ok: true; generacion: number; repetida: boolean } | { ok: false; motivo: MotivoPuerta; detalle: string };

export type PedidoPuerta = {
  dueno: string;
  operacion: string;
  /** La huella de lo aprobado (cuenta, destino, contenido). */
  huella: string;
  /** Hasta cuándo vale la propuesta (ms). */
  vence?: number;
  /** Cuándo se preparó (para «se le quitó el acceso después de prepararla»). */
  preparado?: number;
  lease?: Lease;
  almacen?: AlmacenDurable;
  ahora?: number;
};

const RE_OP_BORRADOR = /^envio-(correo|whatsapp)-(.+)$/;

/**
 * El vínculo de una propuesta de borrador: la tarea que la ofreció (si hay) y su objetivo. Cancelados → `revocada`. No
 * se pudo leer → `almacen`. Sin tarea (un borrador del chat suelto): nada que mirar.
 */
async function vinculoVigente(dueno: string, operacion: string, a: AlmacenDurable): Promise<null | { motivo: 'revocada' | 'almacen'; detalle: string }> {
  const m = RE_OP_BORRADOR.exec(operacion);
  if (!m) return null;
  const intento = m[2];
  // Lo que se manda desde la app con su propia confirmación (`envio-whatsapp-app-…`) no es una propuesta con tarea.
  if (intento.startsWith('app-')) return null;
  const lap = await leerDurable(claveLapidaBorrador(dueno, intento), a).catch(() => null);
  if (!lap || lap.ok === false) return { motivo: 'almacen', detalle: 'no pude comprobar si la propuesta se descartó' };
  if (lap.valor) return { motivo: 'revocada', detalle: 'la propuesta se descartó (rechazada, reemplazada o cancelada)' };
  let tareaId: string | null;
  try {
    tareaId = await tareaDePedido(dueno, `borrador-${intento}`, a);
  } catch {
    return { motivo: 'almacen', detalle: 'no pude comprobar la tarea de la propuesta' };
  }
  if (!tareaId) return null;
  const t = await leerTarea(dueno, tareaId, a).catch(() => ({ ok: false as const, detalle: '' }));
  if (t.ok === false) return { motivo: 'almacen', detalle: 'no pude leer la tarea de la propuesta' };
  if (!t.tarea) return null;
  if (t.tarea.estado === 'cancelled') return { motivo: 'revocada', detalle: 'su tarea se canceló' };
  if (!t.tarea.objetivoId) return null;
  const ob = await leerObjetivo(dueno, t.tarea.objetivoId, a).catch(() => ({ ok: false as const, detalle: '' }));
  if (ob.ok === false) return { motivo: 'almacen', detalle: 'no pude leer el objetivo de la propuesta' };
  if (ob.objetivo?.estado === 'cancelado') return { motivo: 'revocada', detalle: 'su objetivo se canceló' };
  return null;
}

/**
 * La puerta común, inmediatamente antes de despachar (ver el encabezado). `ok: true` = la operación quedó RECLAMADA
 * (pasó el punto de no retorno). Nunca lanza.
 */
export async function pasarPuerta(o: PedidoPuerta): Promise<ResultadoPuerta> {
  const a = o.almacen || almacenDurable();
  const ctx = ejecutor.getStore();
  const reloj = o.ahora !== undefined ? () => o.ahora! : ctx?.ahora || Date.now;
  const t = reloj();
  const dueno = String(o.dueno || '').trim().toLowerCase();
  if (!dueno || !o.operacion) return { ok: false, motivo: 'acceso', detalle: 'sin dueño autenticado no hay efecto' };
  if (!o.huella) return { ok: false, motivo: 'aprobacion', detalle: 'sin huella de lo aprobado' };
  if (o.vence !== undefined && !(t <= o.vence)) return { ok: false, motivo: 'vencida', detalle: 'la propuesta venció antes de salir' };
  if (verificadorAcceso) {
    let v: boolean | 'incierto';
    try {
      v = await verificadorAcceso({ dueno, preparado: o.preparado });
    } catch {
      v = 'incierto';
    }
    if (v === 'incierto') return { ok: false, motivo: 'almacen', detalle: 'no pude comprobar que la cuenta siga teniendo acceso' };
    if (!v) return { ok: false, motivo: 'acceso', detalle: 'la cuenta ya no tiene acceso (o se le cerraron las sesiones) desde que se preparó' };
  }
  const lease = o.lease ?? ctx?.lease;
  if (lease && !(await leaseVigente(lease, reloj).catch(() => false))) return { ok: false, motivo: 'lease', detalle: 'el ejecutor ya no tiene el lease (venció o lo tomó otro)' };
  const v = await vinculoVigente(dueno, o.operacion, a);
  if (v) return { ok: false, ...v };

  // El reclamo: el punto de no retorno.
  let motivo: MotivoPuerta | null = null;
  let detalle = '';
  let generacion = 0;
  let repetida = false;
  const r = await modificarDurable<RegistroAutoridad>(
    claveAutoridad(dueno, o.operacion),
    (rec) => {
      motivo = null;
      repetida = false;
      generacion = rec?.generacion ?? 0;
      if (rec?.estado === 'revocada') return void ((motivo = 'revocada'), (detalle = 'se canceló antes de salir'));
      if (rec?.estado === 'reclamada') {
        if (rec.huella !== o.huella) return void ((motivo = 'aprobacion'), (detalle = 'esa operación se reclamó con otra aprobación'));
        if (lease && rec.token !== undefined && lease.token < rec.token) return void ((motivo = 'lease'), (detalle = 'otro ejecutor la reclamó con un token mayor'));
        repetida = true;
        return undefined;
      }
      generacion += 1;
      return { v: 1, operacion: o.operacion, estado: 'reclamada', generacion, huella: o.huella, ...(lease ? { token: lease.token } : {}), t, historia: [...(rec?.historia || []), { estado: 'reclamada' as const, t }].slice(-10) };
    },
    a
  ).catch((e) => ({ ok: false as const, conflicto: false, detalle: String(e?.message || e) }));
  if (r.ok === false) return { ok: false, motivo: 'almacen', detalle: `no pude reclamar la operación: ${r.detalle.slice(0, 120)}` };
  if (motivo) return { ok: false, motivo, detalle };
  return { ok: true, generacion, repetida };
}
