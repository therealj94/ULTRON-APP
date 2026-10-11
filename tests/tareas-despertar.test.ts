/**
 * EX-02 (auditoría externa, P1): una tarea aceptada no puede perder su «despertar» (la entrada en la agenda del
 * planificador) en silencio, y repetir la creación tiene que repararlo.
 *
 * Lo que tiene que ser verdad:
 *   · si la agenda no se puede escribir al crear, la tarea queda creada CON la marca durable `despertar` y la respuesta
 *     lo dice (`despertar: 'pendiente'`); la vista también (`wakeUp`);
 *   · si el proceso muere entre escribir el objeto y la agenda, la marca ya estaba escrita con el objeto: el mismo
 *     requestId, la lista del dueño o `repararDespertares` la vuelven a agendar;
 *   · una agenda llena es un estado visible y recuperable (`bloqueada`, `wakeUp.status: 'blocked'`), no un silencio;
 *     al hacerse sitio, `repararDespertares()` (la lista global de despertares pendientes) la agenda;
 *   · repetir el mismo requestId sobre una tarea en cola y autorizada que no está en la agenda la agenda (idempotente);
 *   · autorizar (`ejecutar` false→true) deja la marca en la MISMA escritura: un fallo de la agenda no la pierde;
 *   · reparar no duplica: una sola entrada por tarea y el planificador la arranca una vez.
 */
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { leerAgenda, leerDespertaresPendientes, MAX_AGENDA, llaveAgenda } from '../lib/agenda';
import { almacenEnMemoria, claveDe, _usarAlmacenDurable, type AlmacenDurable, type Escrito } from '../lib/durable';
import { autorizarEjecucion, cambiarTarea, claveTarea, crearTarea, leerTarea, listarTareasPagina, repararDespertares, vistaTarea, _olvidarEsperasListado, type RegistroTarea } from '../lib/tareas-durables';
import { vueltaPlanificador, type DepsPlanificador } from '../server/planificador';

const T0 = Date.now();
let n = 0;
const correo = () => `despertar-${n++}@ejemplo.com`;
afterEach(() => {
  _usarAlmacenDurable(null);
  _olvidarEsperasListado();
});

const CLAVE_AGENDA = claveDe('planificador', 'aura-planificador', 'agenda');

const enCola = (requestId: string, ejecutar = true) => ({
  requestId,
  titulo: `Tarea ${requestId}`,
  objetivo: 'Investigar las tasas de los bancos',
  estado: 'queued' as const,
  entorno: { kind: 'chat' as const, id: 'api', displayName: 'AURA' },
  origen: { kind: 'api' as const },
  ejecutar,
});

/**
 * Un almacén en memoria con fallos a pedido: `agendaCaida` hace fallar (sin conflicto) cada escritura de la agenda;
 * `morirTrasTarea` hace que, tras escribir el objeto de una tarea, TODO lo que sigue lance (el proceso murió).
 */
function almacenConFallos() {
  const base = almacenEnMemoria();
  const f = { agendaCaida: false, morirTrasTarea: false, muerto: false };
  const esAgenda = (k: string) => k === CLAVE_AGENDA;
  const esTarea = (k: string) => /^tareas\/[0-9a-f]{40}\/tk_/.test(k);
  const caer = (): Escrito => ({ ok: false, conflicto: false, detalle: 'almacén caído (prueba)' });
  const a: AlmacenDurable & { objetos: Map<string, string> } = {
    ...base,
    objetos: base.objetos,
    async leer(clave: string) {
      if (f.muerto) throw new Error('proceso muerto (prueba)');
      return base.leer(clave);
    },
    async crear(clave: string, valor: unknown) {
      if (f.muerto) throw new Error('proceso muerto (prueba)');
      if (f.agendaCaida && esAgenda(clave)) return caer();
      const w = await base.crear(clave, valor);
      if (w.ok && f.morirTrasTarea && esTarea(clave)) f.muerto = true;
      return w;
    },
    async cas(clave: string, valor: unknown, etag: string) {
      if (f.muerto) throw new Error('proceso muerto (prueba)');
      if (f.agendaCaida && esAgenda(clave)) return caer();
      const w = await base.cas(clave, valor, etag);
      if (w.ok && f.morirTrasTarea && esTarea(clave)) f.muerto = true;
      return w;
    },
  };
  /** «Reinicia» el proceso: los mismos objetos, sin fallos. */
  const revivir = () => {
    f.agendaCaida = false;
    f.morirTrasTarea = false;
    f.muerto = false;
  };
  return { a, f, revivir };
}

async function entradasDe(a: AlmacenDurable, id: string) {
  const ag = await leerAgenda(a);
  assert.ok(ag.ok, 'la agenda se lee');
  return ag.ok ? ag.entradas.filter((e) => e.tipo === 'tarea' && e.id === id) : [];
}

async function registro(a: AlmacenDurable, dueno: string, id: string): Promise<RegistroTarea> {
  const l = await leerTarea(dueno, id, a);
  assert.ok(l.ok && l.tarea, 'la tarea existe');
  return (l as { tarea: RegistroTarea }).tarea;
}

test('fallo selectivo de la agenda al crear: creada, marca durable y la respuesta dice «pendiente»', async () => {
  const { a, f } = almacenConFallos();
  const yo = correo();
  f.agendaCaida = true;
  const r = await crearTarea(yo, enCola('desp-fallo-1'), { almacen: a, ahora: T0 });
  assert.ok(r.ok && r.creada, 'la tarea se crea igual (no se pierde)');
  assert.equal(r.ok && r.despertar, 'pendiente', 'la respuesta dice que el despertar está pendiente');
  const id = r.ok ? r.tarea.id : '';
  assert.equal((await entradasDe(a, id)).length, 0, 'no está en la agenda');
  const reg = await registro(a, yo, id);
  assert.ok(reg.despertar, 'la marca durable queda en el objeto');
  assert.equal(reg.version, 1, 'la marca no sube la versión (el expectedVersion del cliente sigue valiendo)');
  const v = vistaTarea(reg, T0) as any;
  assert.equal(v.wakeUp?.status, 'pending', 'la vista lo enseña');
  // La lista global de despertares pendientes la tiene (otra clave: la agenda caída no la tumba).
  const p = await leerDespertaresPendientes(a);
  assert.ok(p.ok && p.entradas.some((e) => e.id === id), 'anotada para repararla');
});

test('se cae después de escribir el objeto y antes de la agenda: el mismo requestId la agenda', async () => {
  const { a, f, revivir } = almacenConFallos();
  const yo = correo();
  f.morirTrasTarea = true;
  await crearTarea(yo, enCola('desp-caida-1'), { almacen: a, ahora: T0 }).catch(() => null); // el proceso «murió» a mitad
  revivir();
  const [k] = [...a.objetos.keys()].filter((x) => /^tareas\/[0-9a-f]{40}\/tk_/.test(x));
  assert.ok(k, 'el objeto de la tarea quedó escrito');
  const id = k.split('/').pop()!.replace(/\.json$/, '');
  const antes = await registro(a, yo, id);
  assert.ok(antes.despertar, 'la intención de despertar se escribió CON el objeto');
  assert.equal((await entradasDe(a, id)).length, 0, 'nadie la agendó');
  const r = await crearTarea(yo, enCola('desp-caida-1'), { almacen: a, ahora: T0 + 10 });
  assert.ok(r.ok && !r.creada && r.tarea.id === id, 'es la misma tarea');
  assert.equal(r.ok && r.despertar, 'agendada');
  assert.equal((await entradasDe(a, id)).length, 1, 'repetir la creación la repara');
  assert.equal((await registro(a, yo, id)).despertar, undefined, 'la marca se borra al quedar agendada');
});

test('se cae antes de la agenda: la reparación por dueño (índice) y la lista también la encuentran', async () => {
  const { a, f, revivir } = almacenConFallos();
  const yo = correo();
  f.morirTrasTarea = true;
  await crearTarea(yo, enCola('desp-caida-2'), { almacen: a, ahora: T0 }).catch(() => null); // el proceso «murió» a mitad
  revivir();
  const id = [...a.objetos.keys()].find((x) => /^tareas\/[0-9a-f]{40}\/tk_/.test(x))!.split('/').pop()!.replace(/\.json$/, '');
  const rep = await repararDespertares({ dueno: yo, almacen: a, ahora: T0 + 5 });
  assert.ok(rep.ok);
  assert.equal(rep.reparadas, 1);
  assert.equal((await entradasDe(a, id)).length, 1);
  // Otra, reparada por la lista del dueño (la persona abre la app).
  f.morirTrasTarea = true;
  await crearTarea(yo, enCola('desp-caida-3'), { almacen: a, ahora: T0 }).catch(() => null); // el proceso «murió» a mitad
  revivir();
  const otra = [...a.objetos.keys()].filter((x) => /^tareas\/[0-9a-f]{40}\/tk_/.test(x)).map((x) => x.split('/').pop()!.replace(/\.json$/, '')).find((x) => x !== id)!;
  const p = await listarTareasPagina(yo, { ahora: T0 + 6 }, a);
  assert.ok(p.ok);
  assert.equal((await entradasDe(a, otra)).length, 1, 'la lista repara lo que ve con la marca');
});

test('agenda llena: estado visible «bloqueada» y recuperable cuando se hace sitio', async () => {
  const { a } = almacenConFallos();
  const yo = correo();
  // La agenda llena (de otros).
  const llenas = Array.from({ length: MAX_AGENDA }, (_, i) => ({ k: llaveAgenda('tarea', 'otro@ejemplo.com', `tk_relleno${i}`), tipo: 'tarea', dueno: 'otro@ejemplo.com', id: `tk_relleno${i}`, cuando: T0 + 86_400_000, t: 1 }));
  a.objetos.set(CLAVE_AGENDA, JSON.stringify({ v: 1, entradas: llenas }));
  const r = await crearTarea(yo, enCola('desp-llena-1'), { almacen: a, ahora: T0 });
  assert.ok(r.ok && r.creada);
  assert.equal(r.ok && r.despertar, 'bloqueada', 'la agenda llena no es un éxito silencioso');
  const id = r.ok ? r.tarea.id : '';
  const v = vistaTarea(await registro(a, yo, id), T0) as any;
  assert.equal(v.wakeUp?.status, 'blocked');
  assert.equal(v.wakeUp?.reason, 'agenda-llena');
  // Reparar con la agenda todavía llena: sigue pendiente (no se pierde la marca ni la anotación).
  const r1 = await repararDespertares({ almacen: a, ahora: T0 + 1 });
  assert.equal(r1.reparadas, 0);
  assert.ok(r1.llena, 'dice que la agenda está llena');
  assert.ok((await registro(a, yo, id)).despertar);
  // Se hace sitio: la reparación global la agenda y la saca de pendientes.
  a.objetos.set(CLAVE_AGENDA, JSON.stringify({ v: 1, entradas: llenas.slice(1) }));
  const r2 = await repararDespertares({ almacen: a, ahora: T0 + 2 });
  assert.equal(r2.reparadas, 1);
  assert.equal((await entradasDe(a, id)).length, 1);
  assert.equal((await registro(a, yo, id)).despertar, undefined);
  const p = await leerDespertaresPendientes(a);
  assert.ok(p.ok && !p.entradas.some((e) => e.id === id), 'fuera de pendientes');
});

test('repetir el mismo requestId repara una tarea en cola y autorizada que no estaba en la agenda', async () => {
  const { a, f } = almacenConFallos();
  const yo = correo();
  f.agendaCaida = true;
  const r = await crearTarea(yo, enCola('desp-repite-1'), { almacen: a, ahora: T0 });
  assert.ok(r.ok);
  const id = r.ok ? r.tarea.id : '';
  // Una tarea de antes de esta revisión: en cola, autorizada, sin marca y sin agenda.
  const k = claveTarea(yo, id);
  const reg = JSON.parse(a.objetos.get(k)!);
  delete reg.despertar;
  a.objetos.set(k, JSON.stringify(reg));
  f.agendaCaida = false;
  const r2 = await crearTarea(yo, enCola('desp-repite-1'), { almacen: a, ahora: T0 + 1 });
  assert.ok(r2.ok && !r2.creada);
  assert.equal(r2.ok && r2.despertar, 'agendada');
  assert.equal((await entradasDe(a, id)).length, 1);
  // Otra repetición: idempotente (sigue una sola entrada).
  await crearTarea(yo, enCola('desp-repite-1'), { almacen: a, ahora: T0 + 2 });
  assert.equal((await entradasDe(a, id)).length, 1);
});

test('autorizar (ejecutar false→true) con la agenda caída deja la marca en la misma escritura; luego se repara', async () => {
  const { a, f } = almacenConFallos();
  const yo = correo();
  const r = await crearTarea(yo, enCola('desp-autoriza-1', false), { almacen: a, ahora: T0 });
  assert.ok(r.ok);
  const id = r.ok ? r.tarea.id : '';
  // El planificador la miró sin permiso y la sacó de la agenda (como hace `arrancar`).
  a.objetos.set(CLAVE_AGENDA, JSON.stringify({ v: 1, entradas: [] }));
  f.agendaCaida = true;
  const au = await autorizarEjecucion(yo, id, { almacen: a, ahora: T0 + 1 });
  assert.ok(au.ok && au.cambiado);
  const reg = await registro(a, yo, id);
  assert.equal(reg.ejecutar, true);
  assert.ok(reg.despertar, 'autorizada y sin agenda: queda la marca');
  f.agendaCaida = false;
  const rep = await repararDespertares({ almacen: a, ahora: T0 + 2 });
  assert.equal(rep.reparadas, 1);
  assert.equal((await entradasDe(a, id)).length, 1, 'autorizada: a la agenda');
});

test('autorizar y morir antes de la agenda: la marca ya está en la tarea y el dueño la repara', async () => {
  const { a, f, revivir } = almacenConFallos();
  const yo = correo();
  const r = await crearTarea(yo, enCola('desp-autoriza-2', false), { almacen: a, ahora: T0 });
  assert.ok(r.ok);
  const id = r.ok ? r.tarea.id : '';
  a.objetos.set(CLAVE_AGENDA, JSON.stringify({ v: 1, entradas: [] }));
  f.morirTrasTarea = true;
  await autorizarEjecucion(yo, id, { almacen: a, ahora: T0 + 1 }).catch(() => null); // el proceso «murió» a mitad
  revivir();
  assert.ok((await registro(a, yo, id)).despertar, 'la intención viajó con el cambio');
  const rep = await repararDespertares({ dueno: yo, almacen: a, ahora: T0 + 2 });
  assert.equal(rep.reparadas, 1);
  assert.equal((await entradasDe(a, id)).length, 1);
});

test('reparar no duplica: una entrada por tarea y el planificador la arranca una vez', async () => {
  const { a, f } = almacenConFallos();
  const yo = correo();
  f.agendaCaida = true;
  const r = await crearTarea(yo, enCola('desp-dup-1'), { almacen: a, ahora: T0 });
  assert.ok(r.ok);
  const id = r.ok ? r.tarea.id : '';
  f.agendaCaida = false;
  // Todas las vías de reparación a la vez y dos veces seguidas.
  await Promise.all([repararDespertares({ almacen: a, ahora: T0 + 1 }), repararDespertares({ dueno: yo, almacen: a, ahora: T0 + 1 }), crearTarea(yo, enCola('desp-dup-1'), { almacen: a, ahora: T0 + 1 })]);
  await repararDespertares({ almacen: a, ahora: T0 + 2 });
  await repararDespertares({ dueno: yo, almacen: a, ahora: T0 + 2 });
  assert.equal((await entradasDe(a, id)).length, 1, 'una sola entrada (llave por tarea)');
  let veces = 0;
  const ejecutar: DepsPlanificador['ejecutar'] = async (dueno, reg) => {
    veces++;
    await cambiarTarea(dueno, reg.id, (t) => (t.estado === 'queued' ? { estado: 'running', pasoActual: 'Trabajando' } : null), { almacen: a });
    return 'empezada';
  };
  const base = { ejecutar, almacen: a, ahora: () => T0 + 60_000 };
  await vueltaPlanificador({ ...base, titular: 'replica-A' });
  // Reparar DESPUÉS de arrancada: ya no es elegible (no está en cola): no vuelve a la agenda.
  const rep = await repararDespertares({ dueno: yo, almacen: a, ahora: T0 + 61_000 });
  assert.equal(rep.reparadas, 0);
  await crearTarea(yo, enCola('desp-dup-1'), { almacen: a, ahora: T0 + 61_000 });
  await vueltaPlanificador({ ...base, titular: 'replica-B' });
  assert.equal(veces, 1, 'el ejecutor corrió una sola vez');
  assert.equal((await entradasDe(a, id)).length, 0);
});

test('con todo sano: agendada a la primera y sin marca', async () => {
  const { a } = almacenConFallos();
  const yo = correo();
  const r = await crearTarea(yo, enCola('desp-sano-1'), { almacen: a, ahora: T0 });
  assert.ok(r.ok && r.creada);
  assert.equal(r.ok && r.despertar, 'agendada');
  const id = r.ok ? r.tarea.id : '';
  assert.equal(r.ok && r.tarea.despertar, undefined);
  assert.equal((await registro(a, yo, id)).despertar, undefined);
  assert.equal((vistaTarea(await registro(a, yo, id), T0) as any).wakeUp, undefined);
  assert.equal((await entradasDe(a, id)).length, 1);
  // Una que no es del planificador (chat): no aplica.
  const c = await crearTarea(yo, { ...enCola('desp-sano-2'), entorno: { kind: 'chat' as const, id: 'conv', displayName: 'Chat' }, origen: { kind: 'chat' as const } }, { almacen: a, ahora: T0 });
  assert.equal(c.ok && c.despertar, 'no-aplica');
});
