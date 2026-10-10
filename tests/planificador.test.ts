/**
 * Fase 2: el planificador (server/planificador.ts) y el efecto aprobado con lease y fencing (server/trabajos.ts).
 *
 * Lo que tiene que ser verdad:
 *   · una tarea `queued` se arranca UNA vez: dos vueltas seguidas o dos réplicas a la vez no la arrancan dos veces;
 *   · si otro proceso tiene el lease de una tarea, esta vuelta la salta;
 *   · reinicio a mitad de un objetivo: lo que quedó a medio arrancar NO se repite a ciegas (queda `reconciling` y el
 *     objetivo `incierto`), lo que seguía en cola se arranca, y el proceso viejo que despierta con su token viejo no
 *     despacha nada (fencing);
 *   · la `proximaRevision` vencida se revisa una vez; un objetivo `incierto` se vuelve a reconciliar;
 *   · un objetivo en pausa no arranca sus tareas;
 *   · el envío aprobado de server/trabajos.ts pasa por el lease (su operación lleva el token) y un token viejo no despacha.
 */
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import type { AddressInfo } from 'node:net';
import { leerAgenda } from '../lib/agenda';
import { almacenEnMemoria, avanzarOperacion, ejecutarUnaVez, leerOperacion, registrarOperacion, tomarLease, _usarAlmacenDurable, type AlmacenDurable } from '../lib/durable';
import { cambiarObjetivo, crearObjetivo, leerObjetivo } from '../lib/objetivos';
import { cambiarTarea, crearTarea, leerTarea, type RegistroTarea } from '../lib/tareas-durables';
import { vueltaPlanificador, type DepsPlanificador, type SalidaEjecutor } from '../server/planificador';
import { abrirDecisionDeBorrador, claveLeaseTarea, montarRutasTrabajos, _efectoConLease, type DepsTrabajos } from '../server/trabajos';

// El reloj de verdad: el fencing (lib/durable.ts leaseVigente) mira Date.now(); las horas de prueba van de aquí en adelante.
const T0 = Date.now();
let n = 0;
const correo = () => `plan-${n++}@ejemplo.com`;
afterEach(() => _usarAlmacenDurable(null));

const enCola = (requestId: string, objetivoId?: string) => ({
  requestId,
  titulo: `Tarea ${requestId}`,
  objetivo: 'Investigar las tasas de los bancos',
  estado: 'queued' as const,
  entorno: { kind: 'chat' as const, id: 'api', displayName: 'AURA' },
  origen: { kind: 'api' as const },
  ...(objetivoId ? { objetivoId } : {}),
});

/** Un ejecutor de prueba: cuenta cuántas veces arrancó cada tarea y la deja «running» (como la investigación). */
function ejecutor(a: AlmacenDurable, salida: SalidaEjecutor = 'empezada') {
  const veces = new Map<string, number>();
  const f: DepsPlanificador['ejecutar'] = async (dueno, reg) => {
    veces.set(reg.id, (veces.get(reg.id) || 0) + 1);
    if (salida === 'empezada') await cambiarTarea(dueno, reg.id, (t) => (t.estado === 'queued' ? { estado: 'running', pasoActual: 'Trabajando' } : null), { almacen: a });
    return salida;
  };
  return { f, veces };
}

async function objetivoCon(a: AlmacenDurable, yo: string, ids: string[]) {
  const o = await crearObjetivo(yo, { requestId: `obj-${ids.join('-').slice(0, 40)}`, titulo: 'Propuesta para el banco', criterioCierre: ['Propuesta lista'] }, { almacen: a, ahora: T0 });
  assert.ok(o.ok);
  return o.ok ? o.objetivo.id : '';
}

test('una tarea en cola se arranca UNA vez: dos vueltas seguidas y dos réplicas a la vez', async () => {
  const a = almacenEnMemoria();
  const yo = correo();
  const t = await crearTarea(yo, enCola('cola-una-vez-1'), { almacen: a, ahora: T0 });
  assert.ok(t.ok);
  const ex = ejecutor(a);
  const base = { ejecutar: ex.f, almacen: a, ahora: () => T0 + 1000 };
  const [x, y] = await Promise.all([vueltaPlanificador({ ...base, titular: 'replica-A' }), vueltaPlanificador({ ...base, titular: 'replica-B' })]);
  assert.equal(x.arrancadas + y.arrancadas, 1, 'una sola réplica la arranca');
  const otra = await vueltaPlanificador({ ...base, titular: 'replica-A' });
  assert.equal(otra.arrancadas, 0);
  assert.equal(t.ok && ex.veces.get(t.tarea.id), 1, 'el ejecutor corrió una vez');
  const l = await leerTarea(yo, t.ok ? t.tarea.id : '', a);
  assert.equal(l.ok && l.tarea?.estado, 'running');
  const ag = await leerAgenda(a);
  assert.ok(ag.ok && ag.entradas.length === 0, 'arrancada: sale de la agenda');
});

test('si otro proceso tiene el lease de la tarea, esta vuelta la salta (y la deja en la agenda)', async () => {
  const a = almacenEnMemoria();
  const yo = correo();
  const t = await crearTarea(yo, enCola('cola-ocupada-1'), { almacen: a, ahora: T0 });
  assert.ok(t.ok);
  if (!t.ok) return;
  const otro = await tomarLease(claveLeaseTarea(yo, t.tarea.id), 'otro-proceso', 60_000, { almacen: a, ahora: () => T0 });
  assert.ok(otro.ok);
  const ex = ejecutor(a);
  const r = await vueltaPlanificador({ ejecutar: ex.f, almacen: a, ahora: () => T0 + 1000, titular: 'yo' });
  assert.equal(r.ocupadas, 1);
  assert.equal(r.arrancadas, 0);
  assert.equal(ex.veces.size, 0);
  const ag = await leerAgenda(a);
  assert.ok(ag.ok && ag.entradas.length === 1, 'sigue agendada');
});

test('reinicio a mitad de un objetivo: lo a medio arrancar no se repite, lo que seguía en cola se arranca, el token viejo no despacha', async () => {
  const a = almacenEnMemoria();
  const yo = correo();
  const objetivoId = await objetivoCon(a, yo, ['reinicio']);
  const t1 = await crearTarea(yo, enCola('reinicio-t1-0001', objetivoId), { almacen: a, ahora: T0 });
  const t2 = await crearTarea(yo, enCola('reinicio-t2-0001', objetivoId), { almacen: a, ahora: T0 });
  assert.ok(t1.ok && t2.ok);
  if (!t1.ok || !t2.ok) return;
  for (const t of [t1.tarea, t2.tarea]) await cambiarObjetivo(yo, objetivoId, () => ({ tarea: t.id, evento: `Sumé «${t.titulo}»` }), { almacen: a });
  // El proceso A toma el lease de t1, deja la operación de arranque «dispatched» (persistir antes de actuar)… y muere.
  const reloj = { t: T0 + 1000 };
  const lA = await tomarLease(claveLeaseTarea(yo, t1.tarea.id), 'proceso-A', 60_000, { almacen: a, ahora: () => reloj.t });
  assert.ok(lA.ok);
  if (!lA.ok) return;
  const requestId = `plan-${t1.tarea.id}-a0`;
  const { hashArgumentos } = await import('../lib/durable');
  assert.ok((await registrarOperacion({ dueno: yo, requestId, tipo: 'planificador.arranque', argsHash: hashArgumentos({ tarea: t1.tarea.id, intento: 0 }), fencing: lA.lease.token, almacen: a })).ok);
  // (avanzarOperacion mira el lease con el reloj real: aquí el de A sigue vigente en su tiempo.)
  assert.ok((await avanzarOperacion({ dueno: yo, requestId, a: 'dispatched', almacen: a })).ok);
  // Arranca el proceso B (reinicio). Mientras el lease de A no venza, t1 se salta; t2 se arranca.
  const ex = ejecutor(a);
  const deps: DepsPlanificador = { ejecutar: ex.f, almacen: a, ahora: () => reloj.t, titular: 'proceso-B' };
  const r1 = await vueltaPlanificador(deps);
  assert.equal(r1.ocupadas, 1, 't1: el lease de A sigue vigente');
  assert.equal(r1.arrancadas, 1, 't2: se arranca');
  assert.equal(ex.veces.get(t2.tarea.id), 1);
  // Pasa el tiempo: el lease de A vence. B toma t1 con un token mayor; su arranque ya estaba registrado a medias → no se repite.
  reloj.t += 2 * 60_000;
  const r2 = await vueltaPlanificador(deps);
  assert.equal(r2.inciertas, 1);
  assert.equal(ex.veces.get(t1.tarea.id), undefined, 't1 NO se arrancó otra vez a ciegas');
  const l1 = await leerTarea(yo, t1.tarea.id, a);
  assert.equal(l1.ok && l1.tarea?.estado, 'reconciling');
  assert.match(String(l1.ok && l1.tarea?.pasoActual), /no sé si llegó a arrancar/i);
  const o = await leerObjetivo(yo, objetivoId, a);
  assert.equal(o.ok && o.objetivo?.estado, 'incierto', 'el objetivo dice que hay algo incierto');
  // El proceso A despierta con su token viejo e intenta otro efecto: el fencing lo rechaza (no despacha nada).
  const lB = await tomarLease(claveLeaseTarea(yo, t1.tarea.id), 'proceso-B', 60_000, { almacen: a });
  assert.ok(lB.ok && lB.lease.token > lA.lease.token);
  let efectos = 0;
  const viejo = await ejecutarUnaVez({ dueno: yo, requestId: `plan-${t1.tarea.id}-tarde`, tipo: 'planificador.arranque', lease: lA.lease, almacen: a }, async () => {
    efectos++;
    return { estado: 'succeeded' };
  });
  assert.equal(viejo.corrio, false);
  assert.equal(viejo.corrio === false && viejo.motivo, 'fencing');
  assert.equal(efectos, 0, 'el token viejo no despacha');
  // Otra vuelta: nada nuevo (idempotente).
  reloj.t += 61_000;
  const r3 = await vueltaPlanificador({ ...deps, titular: 'proceso-C' });
  assert.equal(r3.arrancadas, 0);
  assert.equal(ex.veces.get(t2.tarea.id), 1);
});

test('la proximaRevision vencida se revisa una vez; un objetivo incierto se vuelve a reconciliar; en pausa no arranca', async () => {
  const a = almacenEnMemoria();
  const yo = correo();
  // proximaRevision
  const t = await crearTarea(yo, { ...enCola('revision-prox-01'), estado: 'running', proximaRevision: T0 + 10_000 }, { almacen: a, ahora: T0 });
  assert.ok(t.ok);
  if (!t.ok) return;
  const revisadas: string[] = [];
  const ex = ejecutor(a);
  const deps = (ahora: number): DepsPlanificador => ({ ejecutar: ex.f, revisar: async (_d, reg: RegistroTarea) => (revisadas.push(reg.id), reg), almacen: a, ahora: () => ahora, titular: 'p' });
  assert.equal((await vueltaPlanificador(deps(T0 + 5_000))).revisadas, 0, 'todavía no toca');
  assert.equal((await vueltaPlanificador(deps(T0 + 20_000))).revisadas, 1);
  assert.equal((await vueltaPlanificador(deps(T0 + 30_000))).revisadas, 0, 'una sola vez');
  assert.deepEqual(revisadas, [t.tarea.id]);
  const l = await leerTarea(yo, t.tarea.id, a);
  assert.equal(l.ok && l.tarea?.proximaRevision, undefined, 'la marca cumplida se quita');
  // objetivo incierto
  const objetivoId = await objetivoCon(a, yo, ['incierto']);
  const t2 = await crearTarea(yo, { ...enCola('incierto-t-0001', objetivoId), estado: 'reconciling' }, { almacen: a, ahora: T0 });
  assert.ok(t2.ok);
  if (!t2.ok) return;
  await cambiarObjetivo(yo, objetivoId, () => ({ tarea: t2.tarea.id, estado: 'incierto', evento: 'No sé cómo terminó' }), { almacen: a });
  const agenda = await leerAgenda(a);
  assert.ok(agenda.ok && agenda.entradas.some((e) => e.tipo === 'objetivo' && e.id === objetivoId), 'incierto → a la agenda');
  const sigue = await vueltaPlanificador(deps(T0 + 40_000));
  assert.equal(sigue.objetivos, 1);
  assert.equal(((await leerObjetivo(yo, objetivoId, a)) as any).objetivo.estado, 'incierto', 'la tarea sigue reconciliando: sigue incierto');
  await cambiarTarea(yo, t2.tarea.id, () => ({ estado: 'failed', pasoActual: null }), { almacen: a });
  await vueltaPlanificador(deps(T0 + 40_000 + 6 * 60_000));
  const o = await leerObjetivo(yo, objetivoId, a);
  assert.equal(o.ok && o.objetivo?.estado, 'abierto');
  assert.match(String(o.ok && o.objetivo?.eventos.at(-1)?.texto), /revisé lo que estaba incierto/);
  // en pausa
  const pausado = await objetivoCon(a, yo, ['pausa']);
  await cambiarObjetivo(yo, pausado, () => ({ pausado: true, evento: 'Pausaste' }), { almacen: a });
  const t3 = await crearTarea(yo, enCola('pausa-t-000001', pausado), { almacen: a, ahora: T0 });
  assert.ok(t3.ok);
  if (!t3.ok) return;
  await vueltaPlanificador(deps(T0 + 50_000_000));
  assert.equal(ex.veces.get(t3.tarea.id), undefined, 'en pausa no arranca');
  await cambiarObjetivo(yo, pausado, () => ({ pausado: false, evento: 'Lo reanudaste' }), { almacen: a });
  await vueltaPlanificador(deps(T0 + 50_000_000 + 6 * 60_000));
  assert.equal(ex.veces.get(t3.tarea.id), 1, 'reanudado: arranca');
});

test('sin ejecutor para esa tarea: se dice y queda esperando (no se reintenta para siempre)', async () => {
  const a = almacenEnMemoria();
  const yo = correo();
  const t = await crearTarea(yo, enCola('sin-ejecutor-01'), { almacen: a, ahora: T0 });
  assert.ok(t.ok);
  if (!t.ok) return;
  const ex = ejecutor(a, 'sin-ejecutor');
  await vueltaPlanificador({ ejecutar: ex.f, almacen: a, ahora: () => T0 + 1000, titular: 'p' });
  const l = await leerTarea(yo, t.tarea.id, a);
  assert.equal(l.ok && l.tarea?.estado, 'waiting_resource');
  // No disponible: se reintenta con otro intento (otra operación), hasta el tope.
  const t2 = await crearTarea(yo, enCola('no-disponible-1'), { almacen: a, ahora: T0 });
  assert.ok(t2.ok);
  if (!t2.ok) return;
  const nd = ejecutor(a, 'no-disponible');
  let ahora = T0 + 1000;
  for (let i = 0; i < 8; i++) {
    await vueltaPlanificador({ ejecutar: nd.f, almacen: a, ahora: () => ahora, titular: 'p' });
    ahora += 6 * 60_000;
  }
  assert.equal(nd.veces.get(t2.tarea.id), 5, 'cinco intentos y se deja esperando');
  const l2 = await leerTarea(yo, t2.tarea.id, a);
  assert.equal(l2.ok && l2.tarea?.estado, 'waiting_resource');
});

/* ------------------------------------------------------------------ el envío aprobado con lease */

function arnesTrabajos(enviados: { n: number }) {
  const pasa = ((_q: express.Request, _s: express.Response, nx: express.NextFunction) => nx()) as express.RequestHandler;
  const deps: DepsTrabajos = {
    exigirMesa: pasa,
    limitar: () => pasa,
    sesionDe: (req) => (req.headers['x-quien'] ? { correo: String(req.headers['x-quien']) } : null),
    borradores: {
      vigente: (_c, _canal, _ambito, intento) => ({ intento: intento || 'int-1', huella: `h-${intento || 'int-1'}` }),
      enviar: async () => {
        enviados.n++;
        return { estado: 'succeeded', resumen: 'CORREO ENVIADO a ana@ejemplo.com' };
      },
      descartar: async () => undefined,
    },
  };
  const app = express();
  app.use(express.json());
  montarRutasTrabajos(app, deps);
  const srv = app.listen(0, '127.0.0.1');
  const listo = new Promise((r) => srv.once('listening', r));
  const pedir = async (ruta: string, quien: string, cuerpo?: unknown) => {
    await listo;
    const r = await fetch(`http://127.0.0.1:${(srv.address() as AddressInfo).port}${ruta}`, { method: cuerpo ? 'POST' : 'GET', headers: { 'content-type': 'application/json', 'x-quien': quien }, body: cuerpo ? JSON.stringify(cuerpo) : undefined });
    return { status: r.status, json: (await r.json()) as any };
  };
  return { pedir, cerrar: () => srv.close() };
}

const borrador = (intento: string) => ({ canal: 'correo' as const, intento, para: ['ana@ejemplo.com'], desde: 'yo@ejemplo.com', asunto: 'Fechas', texto: 'Hola Ana', vence: Date.now() + 15 * 60_000, huella: `h-${intento}` });

test('el envío aprobado pasa por el lease de su tarea: la operación lleva el token; con el lease en manos de otro, no se envía', async () => {
  const a = almacenEnMemoria();
  _usarAlmacenDurable(a);
  const yo = correo();
  const enviados = { n: 0 };
  const h = arnesTrabajos(enviados);
  try {
    const ref = await abrirDecisionDeBorrador(yo, 'telefono', borrador('int-lease-1'));
    const t = (await h.pedir(`/api/trabajos/${ref!.id}`, yo)).json.tarea;
    const r = await h.pedir(`/api/trabajos/${t.id}/decisiones`, yo, { decisionId: t.decisionId, expectedVersion: t.version, opcion: 'aprobar' });
    assert.equal(r.status, 200);
    assert.equal(r.json.tarea.state, 'completed');
    assert.equal(enviados.n, 1);
    const op = await leerOperacion(yo, r.json.operacion, a);
    assert.ok(op.ok && op.valor);
    assert.equal(op.valor!.estado, 'succeeded');
    assert.equal(op.valor!.fencing, 1, 'despachada con el token de fencing del lease');
    // Otra tarea cuyo lease tiene otro proceso (vigente): aprobar no envía; queda para reconciliar.
    const ref2 = await abrirDecisionDeBorrador(yo, 'telefono', borrador('int-lease-2'));
    const t2 = (await h.pedir(`/api/trabajos/${ref2!.id}`, yo)).json.tarea;
    const ajeno = await tomarLease(claveLeaseTarea(yo, t2.id), 'otro-proceso', 60_000, { almacen: a });
    assert.ok(ajeno.ok);
    const r2 = await h.pedir(`/api/trabajos/${t2.id}/decisiones`, yo, { decisionId: t2.decisionId, expectedVersion: t2.version, opcion: 'aprobar' });
    assert.equal(r2.status, 200);
    assert.equal(enviados.n, 1, 'no se envió');
    assert.equal(r2.json.tarea.state, 'reconciling');
  } finally {
    h.cerrar();
  }
});

test('el gate del efecto rechaza un token de fencing viejo (envío aprobado de server/trabajos.ts)', async () => {
  const a = almacenEnMemoria();
  _usarAlmacenDurable(a);
  const yo = correo();
  const tareaId = 'tk_fencing0001';
  // El proceso viejo tomó el lease hace rato (ya venció); uno nuevo lo tomó con un token mayor.
  const viejo = await tomarLease(claveLeaseTarea(yo, tareaId), 'proceso-viejo', 1000, { almacen: a, ahora: () => Date.now() - 10_000 });
  assert.ok(viejo.ok);
  const nuevo = await tomarLease(claveLeaseTarea(yo, tareaId), 'proceso-nuevo', 60_000, { almacen: a });
  assert.ok(nuevo.ok && viejo.ok && nuevo.lease.token > viejo.lease.token);
  let efectos = 0;
  // El viejo, con su lease (token viejo), intenta el efecto: no se despacha.
  const r = await ejecutarUnaVez({ dueno: yo, requestId: `tarea-${tareaId}-dc_1`, tipo: 'correo.enviar', argsHash: 'h', lease: viejo.ok ? viejo.lease : undefined, almacen: a }, async () => {
    efectos++;
    return { estado: 'succeeded' };
  });
  assert.equal(r.corrio, false);
  assert.equal(r.corrio === false && r.motivo, 'fencing');
  assert.equal(efectos, 0);
  const op = await leerOperacion(yo, `tarea-${tareaId}-dc_1`, a);
  assert.equal(op.ok && op.valor?.estado, 'failed', 'queda sin efecto (failed), no «pendiente»');
  // Y por el camino del envío aprobado: con el lease en manos del nuevo, el viejo no envía.
  let enviados = 0;
  const s = await _efectoConLease(yo, tareaId, { requestId: `tarea-${tareaId}-dc_2`, tipo: 'correo.enviar', argsHash: 'h' }, async () => {
    enviados++;
    return { estado: 'succeeded', resumen: 'CORREO ENVIADO' };
  }, 'proceso-viejo');
  assert.equal(enviados, 0);
  assert.equal(s.estado, 'unknown');
  // El titular vigente sí.
  const ok = await _efectoConLease(yo, tareaId, { requestId: `tarea-${tareaId}-dc_3`, tipo: 'correo.enviar', argsHash: 'h' }, async () => {
    enviados++;
    return { estado: 'succeeded', resumen: 'CORREO ENVIADO' };
  }, 'proceso-nuevo');
  assert.equal(ok.estado, 'succeeded');
  assert.equal(enviados, 1);
});
