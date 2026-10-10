/**
 * EL PLANIFICADOR (Fase 2): lo que sigue trabajando aunque nadie tenga la app abierta. Al arrancar el servidor y cada 60 s
 * mira la agenda durable (lib/agenda.ts) y, por cada cosa que ya toca:
 *   · una tarea `queued` (POST /api/trabajos, o una tarea de un objetivo): la arranca con su ejecutor (server.ts: una
 *     tarea de la API se trabaja como investigación en segundo plano, server/investigar.ts);
 *   · una tarea con `proximaRevision` vencida: la pone al día con sus fuentes (server/trabajos.ts `revisarTarea`);
 *   · un objetivo `incierto`: lo vuelve a reconciliar con sus tareas (server/objetivos.ts).
 *
 * Reglas (las de lib/durable.ts):
 *  · UN lease por cosa (`trabajos/leases/…` para una tarea —el mismo que toma el envío aprobado—, `objetivos/leases/…`
 *    para un objetivo), con su token de fencing. Si otra réplica lo tiene, esta lo salta (lo hará la otra).
 *  · Arrancar una tarea es un EFECTO: pasa por `ejecutarUnaVez` con el lease (operación `plan-<tarea>-a<intento>`).
 *    Si el proceso muere a mitad del arranque, la operación queda `dispatched`: la próxima vuelta (este u otro proceso)
 *    NO la repite a ciegas; la tarea pasa a `reconciling` («no sé si llegó a empezar») y su objetivo a `incierto`. Un
 *    lease vencido que otro tomó con un token mayor no despacha nada (fencing).
 *  · Idempotente: correr dos vueltas seguidas, o dos réplicas a la vez, no arranca nada dos veces.
 *  · Un objetivo en pausa no arranca sus tareas (espera); uno terminado cancela las que seguían en cola.
 *  · Solo toca lo SUYO (`esDelPlanificador`: origen y entorno `api`). Una misión de la computadora que pasa por `queued`
 *    se quita de la agenda sin tocarla.
 *  · Arrancar cuesta (una investigación son búsquedas y el cerebro): solo con autorización explícita. La tarea tuvo que
 *    crearse (o autorizarse) con `ejecutar: true` y, si es de un objetivo, el objetivo tiene que tener el permiso
 *    `investigar`. Topes: el `topeCosto` del objetivo y `AURA_INVESTIGACIONES_DIA` por cuenta y día (10 por omisión).
 *    Como todavía no hay un costo real por investigación, cada arranque cuenta como UNA unidad de costo: un `topeCosto`
 *    de 3 son 3 investigaciones (0, ninguna; sin tope, solo el diario). El contador es durable y se reserva ANTES de
 *    arrancar (dos réplicas no se pasan del tope); si no arrancó se devuelve; si el proceso murió a medias queda gastado
 *    (de más, nunca de menos). Sin autorización la tarea sigue en cola con «Esperando que lo autorices».
 */
import { cerrarEntrada, leerAgenda, type EntradaAgenda } from '../lib/agenda';
import { almacenDurable, claveDe, conLease, ejecutarUnaVez, hashArgumentos, leerDurable, modificarDurable, PROCESO_DURABLE, type AlmacenDurable, type Lease } from '../lib/durable';
import { cambiarObjetivo, esTerminalObjetivo, leerObjetivo, type Objetivo } from '../lib/objetivos';
import { cambiarTarea, esDelPlanificador, esTerminal, leerTarea, type RegistroTarea } from '../lib/tareas-durables';
import { reconciliarObjetivoConTareas, type DepsObjetivos } from './objetivos';
import { claveLeaseTarea } from './trabajos';

/** Lo que devuelve un ejecutor al intentar arrancar una tarea en cola. Solo `empezada` cuenta como arrancada. */
export type SalidaEjecutor = 'empezada' | 'sin-ejecutor' | 'no-disponible' | 'ocupado' | 'error';

export type DepsPlanificador = {
  /** Arranca una tarea `queued` (dentro del lease y de `ejecutarUnaVez`). */
  ejecutar: (dueno: string, reg: RegistroTarea, lease: Lease) => Promise<SalidaEjecutor>;
  /** Pone una tarea al día con sus fuentes (server/trabajos.ts `revisarTarea`). */
  revisar?: (dueno: string, reg: RegistroTarea) => Promise<RegistroTarea>;
  /** El aviso «necesito tu decisión» (lib/push.ts `pedirDecisionPorPush`). */
  avisarDecision?: DepsObjetivos['avisarDecision'];
  /** Quién es este proceso (cada réplica, cada arranque: otro). */
  titular?: string;
  almacen?: AlmacenDurable;
  ahora?: () => number;
  leaseMs?: number;
  /** Cuántas cosas trabaja una vuelta como mucho (el resto, en la siguiente). */
  maxPorVuelta?: number;
  /** Cuántas investigaciones arranca el planificador por cuenta y día (por omisión `AURA_INVESTIGACIONES_DIA` o 10). */
  topeDiario?: number;
};

export const INTERVALO_PLANIFICADOR_MS = 60_000;
export const LEASE_PLANIFICADOR_MS = 60_000;
/** Cuántas veces se reintenta arrancar una tarea cuyo ejecutor no estaba disponible antes de decirlo y dejarla esperando. */
export const MAX_INTENTOS_ARRANQUE = 5;
const REINTENTO_MS = 5 * 60_000;
const OBJETIVO_INCIERTO_MS = 5 * 60_000;
/** Lo que dice una tarea en cola que el planificador no arranca sin permiso. */
export const PASO_SIN_AUTORIZACION = 'Esperando que lo autorices';
export const TOPE_DIARIO_POR_OMISION = 10;
/** Honduras (UTC−6, sin horario de verano): el «día» del tope diario. */
const DESFASE_DIA_MS = -6 * 3600_000;

export function topeDiarioInvestigaciones(d: Pick<DepsPlanificador, 'topeDiario'> = {}): number {
  const n = d.topeDiario ?? Number(process.env.AURA_INVESTIGACIONES_DIA ?? TOPE_DIARIO_POR_OMISION);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : TOPE_DIARIO_POR_OMISION;
}
const diaDe = (t: number) => new Date(t + DESFASE_DIA_MS).toISOString().slice(0, 10);
/** El inicio del día siguiente (en ms de verdad): cuando se vuelve a intentar lo que topó con el tope diario. */
const mananaDe = (t: number) => Date.parse(`${diaDe(t)}T00:00:00Z`) - DESFASE_DIA_MS + 86_400_000;
const claveConsumoObjetivo = (dueno: string, objetivoId: string) => claveDe('planificador/consumo', dueno, objetivoId);
const claveConsumoDia = (dueno: string, dia: string) => claveDe('planificador/dia', dueno, dia);
type Consumo = { usadas: number };

/** Reserva una unidad si quedan (atómico, CAS). 'tope' si ya no quedan; 'almacen' si no se pudo escribir. */
async function reservarUnidad(clave: string, tope: number, a: AlmacenDurable): Promise<'ok' | 'tope' | 'almacen'> {
  let lleno = false;
  const r = await modificarDurable<Consumo>(
    clave,
    (c) => {
      const usadas = Math.max(0, Math.floor(Number(c?.usadas) || 0));
      lleno = usadas >= tope;
      return lleno ? undefined : { usadas: usadas + 1 };
    },
    a
  ).catch(() => ({ ok: false as const }));
  if (r.ok === false) return 'almacen';
  return lleno ? 'tope' : 'ok';
}
async function devolverUnidad(clave: string, a: AlmacenDurable): Promise<void> {
  await modificarDurable<Consumo>(clave, (c) => (c && c.usadas > 0 ? { usadas: c.usadas - 1 } : undefined), a).catch(() => null);
}

/** Cuántas unidades de costo (investigaciones que arrancó el planificador) lleva el objetivo. */
export async function consumoObjetivo(dueno: string, objetivoId: string, a: AlmacenDurable = almacenDurable()): Promise<number> {
  const r = await leerDurable<Consumo>(claveConsumoObjetivo(dueno, objetivoId), a).catch(() => null);
  return r && r.ok && r.valor ? Math.max(0, Math.floor(Number(r.valor.usadas) || 0)) : 0;
}

type Autorizacion = { ok: true } | { ok: false; paso: string };

/** ¿Puede arrancarla sola? Puro: lo que pidió la persona (`ejecutar`) y lo que permite su objetivo. */
export function autorizacionDeArranque(reg: Pick<RegistroTarea, 'ejecutar' | 'objetivoId'>, obj: Pick<Objetivo, 'permisos'> | null): Autorizacion {
  if (reg.ejecutar !== true) return { ok: false, paso: `${PASO_SIN_AUTORIZACION}: no la empiezo sola sin que me lo pidas.` };
  if (reg.objetivoId && !obj?.permisos?.includes('investigar')) return { ok: false, paso: `${PASO_SIN_AUTORIZACION}: su objetivo no me deja investigar sola.` };
  return { ok: true };
}

export type ResumenVuelta = { ok: boolean; vistas: number; arrancadas: number; revisadas: number; objetivos: number; ocupadas: number; inciertas: number; detalle?: string };

type Siguiente = { quitar: true } | { cuando: number; intentos?: number } | null;

const claveLeaseObjetivo = (dueno: string, id: string) => claveDe('objetivos/leases', dueno, id);

/** Una vuelta del planificador. Nunca lanza. */
export async function vueltaPlanificador(d: DepsPlanificador): Promise<ResumenVuelta> {
  const a = d.almacen || almacenDurable();
  const reloj = d.ahora || Date.now;
  const titular = d.titular || PROCESO_DURABLE;
  const r: ResumenVuelta = { ok: true, vistas: 0, arrancadas: 0, revisadas: 0, objetivos: 0, ocupadas: 0, inciertas: 0 };
  const ag = await leerAgenda(a);
  if (ag.ok === false) return { ...r, ok: false, detalle: ag.detalle };
  const t0 = reloj();
  const tocan = ag.entradas.filter((e) => e.cuando <= t0).slice(0, d.maxPorVuelta ?? 50);
  /** Los objetivos de las tareas que se tocaron: se reconcilian al final (fuera del lease de la tarea). */
  const objetivos = new Map<string, { dueno: string; id: string }>();
  for (const e of tocan) {
    r.vistas++;
    const clave = e.tipo === 'tarea' ? claveLeaseTarea(e.dueno, e.id) : claveLeaseObjetivo(e.dueno, e.id);
    const hecho = await conLease(clave, titular, d.leaseMs ?? LEASE_PLANIFICADOR_MS, (lease) => (e.tipo === 'tarea' ? trabajarTarea(e, lease, d, a, reloj, r, objetivos) : trabajarObjetivo(e, d, a, reloj, r)), { almacen: a, ahora: reloj }).catch(
      (err) => ({ ok: false as const, detalle: String(err?.message || err) })
    );
    if (hecho.ok === false) {
      // Otra réplica la tiene (o el almacén no contestó): la entrada se queda para la próxima vuelta.
      if ('ocupado' in hecho && hecho.ocupado) r.ocupadas++;
      continue;
    }
    const sig = hecho.valor;
    if (sig) await cerrarEntrada(e.k, e.t, sig, a);
  }
  // Lo que pasó con sus tareas (arrancó, quedó incierta) se refleja en su objetivo: `en-curso`, `incierto`…
  for (const o of objetivos.values()) {
    const l = await leerObjetivo(o.dueno, o.id, a).catch(() => null);
    if (l && l.ok && l.objetivo && !esTerminalObjetivo(l.objetivo.estado)) await reconciliarObjetivoConTareas(o.dueno, l.objetivo, { avisarDecision: d.avisarDecision, almacen: a, ahora: reloj() }).catch(() => null);
  }
  return r;
}

/** El intento de arranque que va (vive en la propia entrada de la agenda: un reinicio no lo pierde). */
const intentoDe = (e: EntradaAgenda) => Math.max(0, Math.floor(Number(e.intentos) || 0));

async function trabajarTarea(e: EntradaAgenda, lease: Lease, d: DepsPlanificador, a: AlmacenDurable, reloj: () => number, r: ResumenVuelta, objetivos: Map<string, { dueno: string; id: string }>): Promise<Siguiente> {
  const l = await leerTarea(e.dueno, e.id, a);
  if (l.ok === false) return null;
  const reg = l.tarea;
  if (!reg || esTerminal(reg.estado)) return { quitar: true };
  // No es suya (una misión de la computadora que pasó por `queued`, una tarea del chat): fuera de la agenda, sin tocarla.
  if (!esDelPlanificador(reg)) return { quitar: true };
  if (reg.objetivoId) objetivos.set(`${e.dueno}\u0000${reg.objetivoId}`, { dueno: e.dueno, id: reg.objetivoId });
  const ahora = reloj();
  // Su objetivo manda: en pausa, espera; terminado, lo que seguía en cola ya no se arranca.
  let objetivo: Objetivo | null = null;
  if (reg.objetivoId) {
    const o = await leerObjetivo(e.dueno, reg.objetivoId, a).catch(() => ({ ok: false as const, detalle: '' }));
    if (o.ok === false) return null;
    objetivo = o.objetivo;
    if (o.objetivo && esTerminalObjetivo(o.objetivo.estado) && reg.estado === 'queued') {
      await cambiarTarea(e.dueno, reg.id, (t) => (t.estado !== 'queued' ? null : { estado: 'cancelled', pasoActual: null, resultado: { id: `${t.id}:resultado`, resumen: 'Su objetivo terminó antes de que empezara: no se hizo nada.', evidencias: [], parcial: [], pendiente: [], t: ahora } }), { almacen: a, ahora }).catch(() => null);
      return { quitar: true };
    }
    if (o.objetivo?.pausado && reg.estado === 'queued') return { cuando: ahora + REINTENTO_MS };
  }
  if (reg.estado === 'queued') return arrancar(e, reg, objetivo, lease, d, a, ahora, r);
  if (reg.proximaRevision && reg.proximaRevision <= ahora) {
    r.revisadas++;
    const vista = d.revisar ? await d.revisar(e.dueno, reg).catch(() => reg) : reg;
    if (esTerminal(vista.estado)) return { quitar: true };
    // Revisada: se quita la marca que ya se cumplió (si la revisión puso otra, la agenda la vuelve a tomar).
    await cambiarTarea(e.dueno, reg.id, (t) => (t.proximaRevision && t.proximaRevision <= ahora ? { proximaRevision: null } : null), { almacen: a, ahora }).catch(() => null);
    return { quitar: true };
  }
  if (reg.proximaRevision && reg.proximaRevision > ahora) return { cuando: reg.proximaRevision };
  return { quitar: true };
}

/** Sin permiso (o sin tope que alcance): la tarea sigue en cola y dice por qué; su objetivo, que espera tu autorización. */
async function esperarAutorizacion(e: EntradaAgenda, reg: RegistroTarea, objetivo: Objetivo | null, paso: string, a: AlmacenDurable, ahora: number): Promise<void> {
  await cambiarTarea(e.dueno, reg.id, (t) => (t.estado !== 'queued' || t.pasoActual === paso ? null : { pasoActual: paso }), { almacen: a, ahora }).catch(() => null);
  if (objetivo && !esTerminalObjetivo(objetivo.estado))
    await cambiarObjetivo(e.dueno, objetivo.id, (o) => (o.siguientePaso === PASO_SIN_AUTORIZACION ? null : { siguientePaso: PASO_SIN_AUTORIZACION, evento: `«${reg.titulo.slice(0, 60)}» espera que la autorices` }), { almacen: a, ahora }).catch(() => null);
}

async function arrancar(e: EntradaAgenda, reg: RegistroTarea, objetivo: Objetivo | null, lease: Lease, d: DepsPlanificador, a: AlmacenDurable, ahora: number, r: ResumenVuelta): Promise<Siguiente> {
  const permiso = autorizacionDeArranque(reg, objetivo);
  if (permiso.ok === false) {
    // Sigue en cola; vuelve a la agenda cuando la autoricen (`ejecutar` encendido: lib/tareas-durables.ts agendarSiToca).
    await esperarAutorizacion(e, reg, objetivo, permiso.paso, a, ahora);
    return { quitar: true };
  }
  // Los topes (cada arranque = una unidad de costo): se reservan ANTES; si no arranca, se devuelven.
  const reservas: string[] = [];
  const devolver = async () => {
    for (const k of reservas.splice(0)) await devolverUnidad(k, a);
  };
  if (objetivo && typeof objetivo.topeCosto === 'number') {
    const k = claveConsumoObjetivo(e.dueno, objetivo.id);
    const x = await reservarUnidad(k, Math.floor(objetivo.topeCosto), a);
    if (x === 'almacen') return null;
    if (x === 'tope') {
      await esperarAutorizacion(e, reg, objetivo, `${PASO_SIN_AUTORIZACION}: su objetivo llegó a su tope de costo.`, a, ahora);
      return { quitar: true };
    }
    reservas.push(k);
  }
  {
    const k = claveConsumoDia(e.dueno, diaDe(ahora));
    const x = await reservarUnidad(k, topeDiarioInvestigaciones(d), a);
    if (x !== 'ok') await devolver();
    if (x === 'almacen') return null;
    if (x === 'tope') {
      await cambiarTarea(e.dueno, reg.id, (t) => (t.estado !== 'queued' ? null : { pasoActual: 'Llegué al tope de investigaciones de hoy: la empiezo mañana.' }), { almacen: a, ahora }).catch(() => null);
      return { cuando: mananaDe(ahora) };
    }
    reservas.push(k);
  }
  const intento = intentoDe(e);
  const requestId = `plan-${reg.id}-a${intento}`;
  const out = await ejecutarUnaVez<SalidaEjecutor>({ dueno: e.dueno, requestId, tipo: 'planificador.arranque', argsHash: hashArgumentos({ tarea: reg.id, intento }), lease, almacen: a }, async () => {
    const x = await d.ejecutar(e.dueno, reg, lease);
    return x === 'empezada' ? { estado: 'succeeded', resultado: x, recibo: { efecto: 'confirmed', proveedor: 'planificador', detalle: 'arrancada' } } : { estado: 'failed', resultado: x, recibo: { efecto: 'none', proveedor: 'planificador', detalle: x } };
  }).catch(async (err) => {
    await devolver();
    throw err;
  });
  // Solo lo que arrancó de verdad queda gastado (si ESTE proceso muere a medias, su reserva queda: de más, nunca de menos).
  if (!(out.corrio && out.resultado === 'empezada')) await devolver();
  if (out.corrio) {
    const x = out.resultado;
    if (x === 'empezada') {
      r.arrancadas++;
      return { quitar: true };
    }
    if (x === 'sin-ejecutor' || intento + 1 >= MAX_INTENTOS_ARRANQUE) {
      await cambiarTarea(
        e.dueno,
        reg.id,
        (t) => (t.estado !== 'queued' ? null : { estado: 'waiting_resource', pasoActual: x === 'sin-ejecutor' ? 'Todavía no tengo cómo trabajar esta tarea sola: dime en el chat cómo seguimos.' : 'No pude arrancarla después de varios intentos; espera a que lo revises.' }),
        { almacen: a, ahora }
      ).catch(() => null);
      return { quitar: true };
    }
    // No disponible por ahora (sin investigación configurada, demasiadas a la vez): otro intento más tarde.
    return reprogramarIntento(e, ahora + REINTENTO_MS);
  }
  // No corrió.
  const motivo = 'motivo' in out ? out.motivo : '';
  if (motivo === 'fencing') return null; // perdió el lease en medio: lo retoma quien lo tenga ahora
  if (motivo === 'ya-registrada' && out.op) {
    if (out.op.estado === 'failed') return reprogramarIntento(e, ahora);
    if (out.op.estado === 'succeeded') return { quitar: true };
    // `requested`, `dispatched` o `unknown`: otro proceso empezó a arrancarla y murió a medias. No se repite a ciegas.
    r.inciertas++;
    await cambiarTarea(
      e.dueno,
      reg.id,
      (t) => (t.estado !== 'queued' ? null : { estado: 'reconciling', pasoActual: 'Se interrumpió justo al empezar: no sé si llegó a arrancar. No lo repito a ciegas; revísalo o pídemelo otra vez.', eventos: [{ type: 'operation.receipt', payload: { operationId: requestId, state: out.op!.estado, effect: 'possible' } }] }),
      { almacen: a, ahora }
    ).catch(() => null);
    return { quitar: true };
  }
  return null;
}

/** Siguiente intento: la entrada guarda cuántos van (otro requestId: el fallido no se repite, se intenta de nuevo). */
function reprogramarIntento(e: EntradaAgenda, cuando: number): Siguiente {
  return { cuando, intentos: intentoDe(e) + 1 };
}

async function trabajarObjetivo(e: EntradaAgenda, d: DepsPlanificador, a: AlmacenDurable, reloj: () => number, r: ResumenVuelta): Promise<Siguiente> {
  const l = await leerObjetivo(e.dueno, e.id, a);
  if (l.ok === false) return null;
  const obj = l.objetivo;
  if (!obj || esTerminalObjetivo(obj.estado) || obj.estado !== 'incierto') return { quitar: true };
  r.objetivos++;
  const final = await reconciliarObjetivoConTareas(e.dueno, obj, { revisarTarea: d.revisar, avisarDecision: d.avisarDecision, almacen: a, ahora: reloj() });
  return final.estado === 'incierto' ? { cuando: reloj() + OBJETIVO_INCIERTO_MS } : { quitar: true };
}

/* ------------------------------------------------------------------ el reloj */

let reloj: ReturnType<typeof setInterval> | null = null;
let corriendo = false;

/** Arranca el planificador: una vuelta ahora y otra cada `intervaloMs` (sin solaparse). Devuelve cómo pararlo. */
export function iniciarPlanificador(d: DepsPlanificador, intervaloMs = INTERVALO_PLANIFICADOR_MS): () => void {
  const vuelta = async () => {
    if (corriendo) return;
    corriendo = true;
    try {
      const r = await vueltaPlanificador(d);
      if (!r.ok) console.warn('[planificador] no pude leer la agenda:', String(r.detalle || '').slice(0, 120));
      else if (r.arrancadas || r.revisadas || r.objetivos || r.inciertas) console.log('[planificador]', { arrancadas: r.arrancadas, revisadas: r.revisadas, objetivos: r.objetivos, inciertas: r.inciertas, ocupadas: r.ocupadas });
    } catch (e: any) {
      console.warn('[planificador] vuelta fallida:', String(e?.message || e).slice(0, 160));
    } finally {
      corriendo = false;
    }
  };
  if (reloj) clearInterval(reloj);
  void vuelta();
  reloj = setInterval(() => void vuelta(), intervaloMs);
  reloj.unref?.();
  return () => {
    if (reloj) clearInterval(reloj);
    reloj = null;
  };
}
