/**
 * F04 (plan de cierre 5.7, P1): los avisos «necesito tu decisión» tienen bandeja de salida durable.
 *
 * Antes: el aviso salía solo si el objetivo cambiaba en esa misma llamada; si el primer envío fallaba nadie lo volvía a
 * intentar (el planificador no barría decisiones pendientes) y la decisión esperaba sin que nadie la viera.
 *
 * Lo que tiene que ser verdad (lib/avisos-decision.ts + server/planificador.ts):
 *   · el primer transporte falla, el servidor «reinicia», la decisión sigue igual → el planificador lo reintenta solo;
 *   · si se resolvió antes del reintento → no sale;
 *   · dos trabajadores a la vez → una sola entrega;
 *   · un token inválido se diagnostica aparte y no se reintenta; un fallo pasajero eterno se corta (reintentos acotados);
 *   · el hueco entre el cambio y el aviso (el proceso muere en medio) se repara sin que nadie abra la app.
 * Reloj inyectado y azar fijo: nada depende de cuánto tarda algo.
 */
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { almacenEnMemoria, _usarAlmacenDurable } from '../lib/durable';
import { crearObjetivo, decidirObjetivo, pedirDecision } from '../lib/objetivos';
import { pedirDecisionObjetivo } from '../server/objetivos';
import { vueltaPlanificador } from '../server/planificador';
import { entregarAviso, encolarAvisoDecision, idAviso, leerAvisoDecision, MAX_INTENTOS_AVISO } from '../lib/avisos-decision';
import type { PushDecision } from '../lib/push';

afterEach(() => _usarAlmacenDurable(null));

let n = 0;
const correo = () => `aviso-${n++}@ejemplo.com`;
const T0 = 1_800_000_000_000;
const MIN = 60_000;
const pregunta = { pregunta: '¿Cuándo mando la propuesta?', opciones: [{ id: 'hoy', etiqueta: 'Hoy', consecuencia: 'Sale hoy.' }, { id: 'martes', etiqueta: 'El martes', consecuencia: 'Espero los anexos.' }] };
const FALLA_PASAJERA = { enviados: 0, aceptados: 0, entrega: 'fallido', fallidos: 1, quitados: 0, configurado: true, detalle: 'HTTP 503' };
const TOKEN_MUERTO = { enviados: 0, aceptados: 0, entrega: 'fallido', fallidos: 1, quitados: 1, configurado: true, detalle: 'UNREGISTERED' };
const ACEPTADO = { enviados: 1, aceptados: 1, entrega: 'aceptado', fallidos: 0, quitados: 0, configurado: true };

async function objetivoConDecision(yo: string, a: ReturnType<typeof almacenEnMemoria>, transporte: (c: string, p: PushDecision) => Promise<unknown>) {
  const c = await crearObjetivo(yo, { requestId: `aviso-${yo.replace(/\W/g, '')}`, titulo: 'Propuesta para el banco', criterioCierre: ['Enviada'] }, { almacen: a, ahora: T0 });
  assert.ok(c.ok);
  const id = c.ok ? c.objetivo.id : '';
  const p = await pedirDecisionObjetivo(yo, id, pregunta, { almacen: a, ahora: T0, avisarDecision: transporte });
  assert.ok(p.ok);
  return { id, decisionId: p.ok ? p.decisionId : '', revision: p.ok ? p.objetivo.decisiones.at(-1)!.version : 0 };
}

const vuelta = (a: ReturnType<typeof almacenEnMemoria>, t: number, transporte: (c: string, p: PushDecision) => Promise<unknown>, titular = 'replica-1') =>
  vueltaPlanificador({ ejecutar: async () => 'sin-ejecutor', avisarDecision: transporte, almacen: a, ahora: () => t, azar: () => 0.5, titular });

test('F04-1: el primer envío falla, el servidor «reinicia» y la decisión sigue igual → el planificador lo reintenta solo', async () => {
  const a = almacenEnMemoria();
  _usarAlmacenDurable(a);
  const yo = correo();
  const intentos: PushDecision[] = [];
  const { id, decisionId } = await objetivoConDecision(yo, a, async (_c, p) => (intentos.push(p), FALLA_PASAJERA));
  assert.equal(intentos.length, 1, 'el primer intento salió en línea');
  // «Reinicio»: nada en la memoria del proceso importa; solo lo durable. Nadie abre la app.
  const entregados: PushDecision[] = [];
  const ok = async (_c: string, p: PushDecision) => (entregados.push(p), ACEPTADO);
  await vuelta(a, T0 + 10 * MIN, ok);
  assert.equal(entregados.length, 1, 'el planificador lo reintentó sin que nadie abriera la app');
  assert.equal(entregados[0].objetivoId, id);
  assert.equal(entregados[0].decisionId, decisionId);
  const av = await leerAvisoDecision(yo, idAviso(entregados[0]), a);
  assert.ok(av && av !== 'incierto');
  if (typeof av === 'object' && av) {
    assert.equal(av.estado, 'aceptado');
    assert.equal(av.etapa, 'transporte-aceptado', 'el recibo dice hasta dónde llegó');
    assert.equal(av.intentos, 2);
  }
  // Otra vuelta no lo repite.
  await vuelta(a, T0 + 60 * MIN, ok);
  assert.equal(entregados.length, 1);
});

test('F04-2: si la decisión se resolvió antes del reintento, el aviso se invalida y no sale', async () => {
  const a = almacenEnMemoria();
  _usarAlmacenDurable(a);
  const yo = correo();
  const { id, decisionId, revision } = await objetivoConDecision(yo, a, async () => FALLA_PASAJERA);
  const d = await decidirObjetivo(yo, id, { decisionId, opcion: 'hoy', revisionVista: revision }, { almacen: a, ahora: T0 + MIN });
  assert.ok(d.ok);
  const entregados: PushDecision[] = [];
  await vuelta(a, T0 + 10 * MIN, async (_c, p) => (entregados.push(p), ACEPTADO));
  assert.equal(entregados.length, 0, 'lo resuelto no se avisa');
  const av = await leerAvisoDecision(yo, idAviso({ decisionId, revision }), a);
  assert.ok(av && av !== 'incierto' && av.estado === 'invalidado' && av.etapa === 'invalidado');
});

test('F04-3: dos trabajadores a la vez → una sola entrega (reclamo con CAS)', async () => {
  const a = almacenEnMemoria();
  const yo = correo();
  const { id, decisionId, revision } = await objetivoConDecision(yo, a, async () => FALLA_PASAJERA);
  let llego!: () => void;
  let soltar!: () => void;
  const llegada = new Promise<void>((r) => (llego = r));
  const suelta = new Promise<void>((r) => (soltar = r));
  let llamadas = 0;
  const lento = async () => {
    llamadas++;
    llego();
    await suelta;
    return ACEPTADO;
  };
  const avisoId = idAviso({ decisionId, revision });
  const t = T0 + 10 * MIN;
  const uno = entregarAviso(yo, avisoId, { transporte: lento, almacen: a, ahora: t, titular: 'replica-1' });
  await llegada;
  const dos = await entregarAviso(yo, avisoId, { transporte: lento, almacen: a, ahora: t, titular: 'replica-2' });
  assert.equal(dos.estado, 'ocupado', 'el segundo encuentra el reclamo vigente');
  // Y dos vueltas del planificador mientras tanto: tampoco.
  await vuelta(a, t, lento, 'replica-3');
  soltar();
  assert.equal((await uno).estado, 'aceptado');
  assert.equal(llamadas, 1, 'una sola operación de entrega');
  void id;
});

test('F04-4: un token inválido se diagnostica aparte y no se reintenta; un fallo pasajero eterno se corta', async () => {
  const a = almacenEnMemoria();
  _usarAlmacenDurable(a);
  const yo = correo();
  let muertos = 0;
  const { decisionId, revision } = await objetivoConDecision(yo, a, async () => (muertos++, TOKEN_MUERTO));
  assert.equal(muertos, 1);
  const av = await leerAvisoDecision(yo, idAviso({ decisionId, revision }), a);
  assert.ok(av && av !== 'incierto' && av.estado === 'token-invalido' && av.etapa === 'diagnostico', JSON.stringify(av));
  for (let i = 1; i <= 5; i++) await vuelta(a, T0 + i * 120 * MIN, async () => (muertos++, TOKEN_MUERTO));
  assert.equal(muertos, 1, 'lo permanente no se reintenta');

  // Pasajero para siempre: a lo más MAX_INTENTOS_AVISO intentos, y queda `agotado`.
  const otro = correo();
  let pasajeros = 0;
  const falla = async () => (pasajeros++, FALLA_PASAJERA);
  const x = await objetivoConDecision(otro, a, falla);
  for (let i = 1; i <= MAX_INTENTOS_AVISO + 4; i++) await vuelta(a, T0 + i * 3 * 60 * MIN, falla); // cada vuelta, pasada la espera más larga
  assert.equal(pasajeros, MAX_INTENTOS_AVISO, 'reintentos acotados');
  const ag = await leerAvisoDecision(otro, idAviso(x), a);
  assert.ok(ag && ag !== 'incierto' && ag.estado === 'agotado');
});

test('F04-5: el proceso muere entre la decisión y su aviso: la agenda lo repara sin abrir la app; encolar dos veces no duplica', async () => {
  const a = almacenEnMemoria();
  _usarAlmacenDurable(a);
  const yo = correo();
  const c = await crearObjetivo(yo, { requestId: 'aviso-hueco-01', titulo: 'Contrato', criterioCierre: ['Firmado'] }, { almacen: a, ahora: T0 });
  assert.ok(c.ok);
  const id = c.ok ? c.objetivo.id : '';
  // Solo el cambio (lo que escribe la decisión); el aviso nunca se llamó: el proceso «murió» ahí.
  const p = await pedirDecision(yo, id, pregunta, { almacen: a, ahora: T0 });
  assert.ok(p.ok);
  const entregados: PushDecision[] = [];
  const ok = async (_c: string, x: PushDecision) => (entregados.push(x), ACEPTADO);
  await vuelta(a, T0 + MIN, ok);
  assert.equal(entregados.length, 1, 'la vuelta encontró la decisión sin aviso y lo mandó');
  const ref = { objetivoId: id, decisionId: entregados[0].decisionId, revision: entregados[0].revision };
  const otra = await encolarAvisoDecision(yo, ref, { almacen: a, ahora: T0 + 2 * MIN });
  assert.ok(otra.ok && !otra.nuevo && otra.aviso.estado === 'aceptado', 'encolar otra vez devuelve el mismo');
  await vuelta(a, T0 + 30 * MIN, ok);
  assert.equal(entregados.length, 1);
});
