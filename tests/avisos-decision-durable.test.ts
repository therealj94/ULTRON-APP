/**
 * EX-01 (auditoría externa, P1): una decisión pendiente se podía quedar sin aviso autónomo.
 *
 * Antes: si fallaba SOLO la escritura del aviso (crear en la bandeja de salida) o su entrada en la agenda, la
 * reconciliación se lo tragaba (`encolarAvisoDecision` decía ok aunque `agendar` diera false; `avisarDecisionesPendientes`
 * contaba referencias, no avisos guardados) y el planificador QUITABA el objetivo de la agenda porque ya no estaba
 * `incierto`. Sin otro GET de la persona, nadie volvía a intentar ese aviso.
 *
 * Lo que tiene que ser verdad ahora:
 *   · falla crear el aviso → el objetivo sigue agendado y la próxima vuelta lo crea y lo manda (un solo transporte);
 *   · falla agendar el aviso → `encolarAvisoDecision` lo dice (ok: false, pendiente) y la próxima vuelta lo repone;
 *   · el proceso muere entre crear el aviso y agendarlo → la próxima vuelta lo agenda y lo manda;
 *   · nada de esto pide un GET de la persona; dos réplicas (o dos vueltas) no lo duplican.
 * Almacén en memoria con fallas inyectadas, reloj inyectado.
 */
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { almacenEnMemoria, _usarAlmacenDurable, type AlmacenDurable, type Escrito } from '../lib/durable';
import { crearObjetivo, leerObjetivo, pedirDecision } from '../lib/objetivos';
import { leerAgenda } from '../lib/agenda';
import { avisarDecisionesPendientes, pedirDecisionObjetivo } from '../server/objetivos';
import { vueltaPlanificador } from '../server/planificador';
import { encolarAvisoDecision, idAviso, leerAvisoDecision } from '../lib/avisos-decision';
import type { PushDecision } from '../lib/push';

afterEach(() => _usarAlmacenDurable(null));

let n = 0;
const correo = () => `aviso-dur-${n++}@ejemplo.com`;
const T0 = 1_800_000_000_000;
const MIN = 60_000;
const pregunta = { pregunta: '¿Firmo con el proveedor A o el B?', opciones: [{ id: 'a', etiqueta: 'Proveedor A', consecuencia: 'Más barato.' }, { id: 'b', etiqueta: 'Proveedor B', consecuencia: 'Más rápido.' }] };
const FALLA_PASAJERA = { enviados: 0, aceptados: 0, entrega: 'fallido', fallidos: 1, quitados: 0, configurado: true, detalle: 'HTTP 503' };
const ACEPTADO = { enviados: 1, aceptados: 1, entrega: 'aceptado', fallidos: 0, quitados: 0, configurado: true };
const FALLO: Escrito = { ok: false, conflicto: false, detalle: 'S3 503 (inyectado)' };

type Agenda = { entradas?: { k: string; tipo: string }[] } | null;
/** ¿La agenda nueva trae una entrada `aviso` que la de antes no tenía? (eso es «agendar el aviso»). */
const traeAvisoNuevo = (antes: Agenda, despues: Agenda) => (despues?.entradas || []).some((e) => e.tipo === 'aviso' && !(antes?.entradas || []).some((x) => x.k === e.k));

/** Un almacén en memoria donde fallan, las veces que se diga, el PUT del aviso o el de su entrada en la agenda. */
function almacenConFallas() {
  const base = almacenEnMemoria();
  const fallas = { crearAviso: 0, agendarAviso: 0 };
  const a: AlmacenDurable = {
    tipo: 'memoria',
    multiReplica: false,
    leer: (k) => base.leer(k),
    async crear(k, v) {
      if (k.startsWith('avisos/decision/') && fallas.crearAviso > 0) return fallas.crearAviso--, FALLO;
      if (k.startsWith('planificador/') && fallas.agendarAviso > 0 && traeAvisoNuevo(null, v as Agenda)) return fallas.agendarAviso--, FALLO;
      return base.crear(k, v);
    },
    async cas(k, v, etag) {
      if (k.startsWith('planificador/') && fallas.agendarAviso > 0) {
        const l = await base.leer<Agenda>(k);
        if (l.ok && traeAvisoNuevo(l.valor, v as Agenda)) return fallas.agendarAviso--, FALLO;
      }
      return base.cas(k, v, etag);
    },
    listar: (p, o) => base.listar!(p, o),
  };
  return { a, fallas };
}

const vuelta = (a: AlmacenDurable, t: number, transporte: (c: string, p: PushDecision) => Promise<unknown>, titular = 'replica-1') =>
  vueltaPlanificador({ ejecutar: async () => 'sin-ejecutor', avisarDecision: transporte, almacen: a, ahora: () => t, azar: () => 0.5, titular });

async function entradas(a: AlmacenDurable, tipo: 'objetivo' | 'aviso') {
  const ag = await leerAgenda(a);
  assert.ok(ag.ok);
  return ag.ok ? ag.entradas.filter((e) => e.tipo === tipo) : [];
}

async function nuevoObjetivo(yo: string, a: AlmacenDurable) {
  const c = await crearObjetivo(yo, { requestId: `dur-${yo.replace(/\W/g, '')}`, titulo: 'Contrato de suministro', criterioCierre: ['Firmado'] }, { almacen: a, ahora: T0 });
  assert.ok(c.ok);
  return c.ok ? c.objetivo.id : '';
}

test('EX-01-1: falla CREAR el aviso (en línea y en la primera vuelta) → el objetivo sigue agendado y la siguiente vuelta lo manda una vez', async () => {
  const { a, fallas } = almacenConFallas();
  _usarAlmacenDurable(a);
  const yo = correo();
  const id = await nuevoObjetivo(yo, a);
  const enviados: PushDecision[] = [];
  const ok = async (_c: string, p: PushDecision) => (enviados.push(p), ACEPTADO);
  fallas.crearAviso = 2;
  const p = await pedirDecisionObjetivo(yo, id, pregunta, { almacen: a, ahora: T0, avisarDecision: ok });
  assert.ok(p.ok, 'la decisión quedó escrita');
  assert.equal(enviados.length, 0, 'el aviso no llegó a la bandeja de salida');
  await vuelta(a, T0 + MIN, ok);
  assert.equal(fallas.crearAviso, 0, 'la primera vuelta también falló al crear el aviso');
  assert.equal(enviados.length, 0);
  assert.equal((await entradas(a, 'objetivo')).filter((e) => e.id === id).length, 1, 'el objetivo NO sale de la agenda mientras su aviso no esté guardado');
  // Nadie abre la app: solo vueltas del planificador.
  await vuelta(a, T0 + 3 * MIN, ok);
  assert.equal(enviados.length, 1, 'la siguiente vuelta lo creó y lo mandó');
  assert.equal(enviados[0].objetivoId, id);
  for (let i = 1; i <= 4; i++) await vuelta(a, T0 + (3 + i * 10) * MIN, ok);
  assert.equal(enviados.length, 1, 'un solo transporte');
  assert.equal((await entradas(a, 'objetivo')).filter((e) => e.id === id).length, 0, 'con el aviso entregado, el objetivo ya no ocupa la agenda');
});

test('EX-01-2: el resultado por referencia dice qué quedó guardado (crear falla → sin-registrar, incompleto)', async () => {
  const { a, fallas } = almacenConFallas();
  const yo = correo();
  const id = await nuevoObjetivo(yo, a);
  const p = await pedirDecision(yo, id, pregunta, { almacen: a, ahora: T0 });
  assert.ok(p.ok);
  const obj = p.ok ? p.objetivo : null!;
  fallas.crearAviso = 1;
  const r1 = await avisarDecisionesPendientes(yo, obj, [], undefined, { almacen: a, ahora: T0 });
  assert.equal(r1.completo, false);
  assert.equal(r1.resultados.length, 1);
  assert.equal(r1.resultados[0].estado, 'sin-registrar');
  const r2 = await avisarDecisionesPendientes(yo, obj, [], undefined, { almacen: a, ahora: T0 });
  assert.equal(r2.completo, true);
  assert.equal(r2.resultados[0].estado, 'agendado');
});

test('EX-01-3: falla AGENDAR el aviso → encolar lo dice (pendiente) y la siguiente vuelta lo repone y lo manda una vez', async () => {
  const { a, fallas } = almacenConFallas();
  _usarAlmacenDurable(a);
  const yo = correo();
  const id = await nuevoObjetivo(yo, a);
  const enviados: PushDecision[] = [];
  fallas.agendarAviso = 2;
  // En línea: el aviso se crea, su agenda falla y el primer transporte falla de paso (queda pendiente, sin agenda).
  const p = await pedirDecisionObjetivo(yo, id, pregunta, { almacen: a, ahora: T0, avisarDecision: async () => FALLA_PASAJERA });
  assert.ok(p.ok);
  const ref = { objetivoId: id, decisionId: p.ok ? p.decisionId : '', revision: p.ok ? p.objetivo.decisiones.at(-1)!.version : 0 };
  assert.equal(fallas.agendarAviso, 1);
  // Encolar directo con la agenda caída: no miente.
  const e = await encolarAvisoDecision(yo, ref, { almacen: a, ahora: T0 });
  assert.equal(e.ok, false, 'sin agenda no es ok');
  assert.ok(e.ok === false && e.pendiente === true && e.aviso?.id === idAviso(ref), JSON.stringify(e));
  assert.equal(fallas.agendarAviso, 0);
  fallas.agendarAviso = 1;
  // Primera vuelta: la agenda del aviso vuelve a fallar y el transporte también.
  await vuelta(a, T0 + MIN, async () => FALLA_PASAJERA);
  assert.equal(fallas.agendarAviso, 0);
  assert.equal((await entradas(a, 'aviso')).length, 0, 'el aviso sigue sin entrada propia');
  assert.equal((await entradas(a, 'objetivo')).filter((x) => x.id === id).length, 1, 'el objetivo se queda agendado para reintentarlo');
  // Segunda vuelta, sin GET de nadie: se repone la agenda del aviso y sale.
  await vuelta(a, T0 + 10 * MIN, async (_c, x) => (enviados.push(x), ACEPTADO));
  assert.equal(enviados.length, 1);
  for (let i = 1; i <= 4; i++) await vuelta(a, T0 + (10 + i * 10) * MIN, async (_c, x) => (enviados.push(x), ACEPTADO));
  assert.equal(enviados.length, 1, 'un solo transporte');
  const av = await leerAvisoDecision(yo, idAviso(ref), a);
  assert.ok(av && av !== 'incierto' && av.estado === 'aceptado');
});

test('EX-01-4: el proceso muere entre crear el aviso y agendarlo → la siguiente vuelta lo agenda y lo manda una vez', async () => {
  const { a, fallas } = almacenConFallas();
  _usarAlmacenDurable(a);
  const yo = correo();
  const id = await nuevoObjetivo(yo, a);
  const p = await pedirDecision(yo, id, pregunta, { almacen: a, ahora: T0 }); // la transición agenda el objetivo
  assert.ok(p.ok);
  const ref = { objetivoId: id, decisionId: p.ok ? p.objetivo.decisiones.at(-1)!.id : '', revision: p.ok ? p.objetivo.decisiones.at(-1)!.version : 0 };
  // El registro del aviso quedó escrito; la agenda no (el proceso «murió» ahí): mismo estado durable.
  fallas.agendarAviso = 1;
  const e = await encolarAvisoDecision(yo, ref, { almacen: a, ahora: T0 });
  assert.equal(e.ok, false);
  assert.equal((await entradas(a, 'aviso')).length, 0);
  const enviados: PushDecision[] = [];
  const ok = async (_c: string, x: PushDecision) => (enviados.push(x), ACEPTADO);
  await vuelta(a, T0 + MIN, ok);
  assert.equal(enviados.length, 1);
  for (let i = 1; i <= 3; i++) await vuelta(a, T0 + (1 + i * 10) * MIN, ok);
  assert.equal(enviados.length, 1);
});

test('EX-01-5: dos réplicas a la vez (y vueltas seguidas) después del fallo → un solo transporte', async () => {
  const { a, fallas } = almacenConFallas();
  _usarAlmacenDurable(a);
  const yo = correo();
  const id = await nuevoObjetivo(yo, a);
  let llamadas = 0;
  const ok = async () => (llamadas++, ACEPTADO);
  fallas.crearAviso = 2;
  const p = await pedirDecisionObjetivo(yo, id, pregunta, { almacen: a, ahora: T0, avisarDecision: ok });
  assert.ok(p.ok);
  await Promise.all([vuelta(a, T0 + MIN, ok, 'replica-1'), vuelta(a, T0 + MIN, ok, 'replica-2')]);
  assert.equal(fallas.crearAviso, 0);
  assert.equal(llamadas, 0);
  for (let i = 0; i < 3; i++) await Promise.all([vuelta(a, T0 + (3 + i * 10) * MIN, ok, 'replica-1'), vuelta(a, T0 + (3 + i * 10) * MIN, ok, 'replica-2')]);
  assert.equal(llamadas, 1, 'una sola entrega entre las dos réplicas');
  const l = await leerObjetivo(yo, id, a);
  assert.ok(l.ok && l.objetivo?.estado === 'esperando-decision', 'la decisión sigue esperando a la persona');
});
