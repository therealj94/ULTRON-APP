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
 */
import { cerrarEntrada, leerAgenda, type EntradaAgenda } from '../lib/agenda';
import { almacenDurable, claveDe, conLease, ejecutarUnaVez, hashArgumentos, PROCESO_DURABLE, type AlmacenDurable, type Lease } from '../lib/durable';
import { esTerminalObjetivo, leerObjetivo } from '../lib/objetivos';
import { cambiarTarea, esTerminal, leerTarea, type RegistroTarea } from '../lib/tareas-durables';
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
};

export const INTERVALO_PLANIFICADOR_MS = 60_000;
export const LEASE_PLANIFICADOR_MS = 60_000;
/** Cuántas veces se reintenta arrancar una tarea cuyo ejecutor no estaba disponible antes de decirlo y dejarla esperando. */
export const MAX_INTENTOS_ARRANQUE = 5;
const REINTENTO_MS = 5 * 60_000;
const OBJETIVO_INCIERTO_MS = 5 * 60_000;

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
  if (reg.objetivoId) objetivos.set(`${e.dueno}\u0000${reg.objetivoId}`, { dueno: e.dueno, id: reg.objetivoId });
  const ahora = reloj();
  // Su objetivo manda: en pausa, espera; terminado, lo que seguía en cola ya no se arranca.
  if (reg.objetivoId) {
    const o = await leerObjetivo(e.dueno, reg.objetivoId, a).catch(() => ({ ok: false as const, detalle: '' }));
    if (o.ok === false) return null;
    if (o.objetivo && esTerminalObjetivo(o.objetivo.estado) && reg.estado === 'queued') {
      await cambiarTarea(e.dueno, reg.id, (t) => (t.estado !== 'queued' ? null : { estado: 'cancelled', pasoActual: null, resultado: { id: `${t.id}:resultado`, resumen: 'Su objetivo terminó antes de que empezara: no se hizo nada.', evidencias: [], parcial: [], pendiente: [], t: ahora } }), { almacen: a, ahora }).catch(() => null);
      return { quitar: true };
    }
    if (o.objetivo?.pausado && reg.estado === 'queued') return { cuando: ahora + REINTENTO_MS };
  }
  if (reg.estado === 'queued') return arrancar(e, reg, lease, d, a, ahora, r);
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

async function arrancar(e: EntradaAgenda, reg: RegistroTarea, lease: Lease, d: DepsPlanificador, a: AlmacenDurable, ahora: number, r: ResumenVuelta): Promise<Siguiente> {
  const intento = intentoDe(e);
  const requestId = `plan-${reg.id}-a${intento}`;
  const out = await ejecutarUnaVez<SalidaEjecutor>({ dueno: e.dueno, requestId, tipo: 'planificador.arranque', argsHash: hashArgumentos({ tarea: reg.id, intento }), lease, almacen: a }, async () => {
    const x = await d.ejecutar(e.dueno, reg, lease);
    return x === 'empezada' ? { estado: 'succeeded', resultado: x, recibo: { efecto: 'confirmed', proveedor: 'planificador', detalle: 'arrancada' } } : { estado: 'failed', resultado: x, recibo: { efecto: 'none', proveedor: 'planificador', detalle: x } };
  });
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
