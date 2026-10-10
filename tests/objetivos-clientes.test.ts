/**
 * Fase 2, los clientes de los objetivos (teléfono y web) y el turno de AU-RA:
 *   · el aviso «decision» del servidor → los botones del teléfono (≤3, uno por opción), lo que manda cada botón (la
 *     opción con `revisionVista` del aviso; la tarea con su versión) y la privacidad en la pantalla bloqueada;
 *   · un 409 (cambió mientras tanto): el aviso pasa a «Cambió mientras tanto: ábrelo para ver la versión nueva» y el
 *     cliente muestra el objetivo de ahora, sin reintentar; con las rutas de verdad, dos aparatos sobre la misma revisión;
 *   · «qué cambió desde la última vez» con la última revisión vista por aparato (solo sube; los cambios desde ahí);
 *   · el bloque del turno: ≤400 caracteres, solo AU-RA, sin terminales, con la decisión que espera.
 * Todo puro (mobile/src/lib/objetivos.ts, mobile/src/push/logica.ts, lib/objetivos-turno.ts), salvo las rutas.
 */
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import type { AddressInfo } from 'node:net';
import { almacenEnMemoria, _usarAlmacenDurable } from '../lib/durable';
import { cambiarObjetivo, cambiosDesde, crearObjetivo, pedirDecision, vistaObjetivo, type Objetivo } from '../lib/objetivos';
import { bloqueObjetivosTurno, MAX_BLOQUE_OBJETIVOS, type ObjetivoParaTurno } from '../lib/objetivos-turno';
import { datosParaFcm, datosPushDecision, seudonimoDe } from '../lib/push';
import { bloqueObjetivosDelTurno, montarRutasObjetivos, olvidarObjetivosDelTurno, _olvidarObjetivosDelTurno, type DepsObjetivos } from '../server/objetivos';
import * as L from '../mobile/src/push/logica';
import {
  anotarVista,
  controlesObjetivo,
  crearClienteObjetivos,
  criteriosVista,
  evidenciasParaCerrar,
  hayNovedad,
  interpretarRespuesta,
  lineaQueCambio,
  MAX_VISTOS_OBJETIVOS,
  objetivoReciente,
  ultimaVista,
  type VistaObjetivo,
} from '../mobile/src/lib/objetivos';

afterEach(() => _usarAlmacenDurable(null));

const K = {
  TriggerType: { TIMESTAMP: 0 },
  AlarmType: { SET_AND_ALLOW_WHILE_IDLE: 2, SET_EXACT_AND_ALLOW_WHILE_IDLE: 3 },
  AuthorizationStatus: { DENIED: 0, AUTHORIZED: 1 },
  AndroidImportance: { HIGH: 4 },
  AndroidCategory: { CALL: 'call' },
  AndroidVisibility: { PUBLIC: 1, PRIVATE: 0 },
  EventType: { DISMISSED: 0, PRESS: 1, ACTION_PRESS: 2, DELIVERED: 3 },
  AndroidStyle: { BIGTEXT: 1 },
};
const CORREO = 'ana.objetivos@ejemplo.com';
const YO = seudonimoDe(CORREO);
const T0 = Date.parse('2026-10-10T15:00:00Z');
let n = 0;
const correo = () => `cli-${n++}@ejemplo.com`;

/** Lo que manda el servidor (lib/push.ts) tal como llega al teléfono por FCM. */
function llega(p: Parameters<typeof datosPushDecision>[0]) {
  return L.leerDatos(datosParaFcm(CORREO, datosPushDecision(p), T0));
}
const DEC = {
  objetivoId: 'ob_abcdef123456',
  decisionId: 'dob_xyz123',
  revision: 4,
  pregunta: '¿Cuándo mando la propuesta al banco?',
  opciones: [
    { id: 'hoy', etiqueta: 'Hoy mismo, con lo que tengamos listo' },
    { id: 'martes', etiqueta: 'El martes' },
    { id: 'nunca', etiqueta: 'No la mandes' },
    { id: 'cuarta', etiqueta: 'Sobra' },
  ],
};

/* ------------------------------------------------------------------ el aviso → los botones */

test('aviso «decision»: un botón por opción (≤3, cortos), tocarlo abre el objetivo y es privado en la pantalla bloqueada', () => {
  const p = llega(DEC);
  assert.ok(p, 'el teléfono lee el aviso del servidor');
  assert.equal(p!.tipo, 'decision');
  assert.equal(p!.para, YO);
  assert.equal(p!.revision, 4);
  assert.deepEqual(p!.opciones.map((o) => o.id), ['hoy', 'martes', 'nunca'], '≤3 (la cuarta no llega)');
  assert.ok(p!.opciones.every((o) => o.etiqueta.length <= L.MAX_ETIQUETA_AVISO));
  const plan = L.planear(p!, { dueno: YO, ahora: T0, k: K });
  assert.equal(plan.que, 'mostrar');
  const aviso = (plan as any).aviso;
  assert.equal(aviso.title, 'Necesito tu decisión');
  assert.equal(aviso.body, DEC.pregunta);
  const acciones = aviso.android.actions as { title: string; pressAction: { id: string; launchActivity?: string } }[];
  assert.deepEqual(
    acciones.map((a) => a.pressAction.id),
    ['aura-push-decidir:hoy', 'aura-push-decidir:martes', 'aura-push-decidir:nunca']
  );
  assert.ok(acciones.every((a) => !a.pressAction.launchActivity), 'los botones contestan sin abrir la app');
  assert.equal(aviso.android.pressAction.launchActivity, 'default', 'tocar el aviso abre la app (el objetivo)');
  // La privacidad de siempre (avisos privados): bloqueado, ni la pregunta ni los botones.
  assert.equal(aviso.android.visibility, K.AndroidVisibility.PRIVATE);
  assert.deepEqual(L.privacidadDecision(K), { visibility: 0, botonesEnBloqueo: false, preguntaEnBloqueo: false });
  assert.deepEqual(L.privacidadDecision(K, true), { visibility: 1, botonesEnBloqueo: true, preguntaEnBloqueo: true });
  assert.equal((L.avisoDecision(p!, K, true) as any).android.visibility, K.AndroidVisibility.PUBLIC);
  // De otra persona en este teléfono: no se enseña.
  assert.deepEqual(L.planear(p!, { dueno: seudonimoDe('otra@ejemplo.com'), ahora: T0, k: K }), { que: 'ignorar', porque: 'ajeno' });
});

test('aviso «decision» roto o sin a qué contestar no se enseña', () => {
  const base = datosParaFcm(CORREO, datosPushDecision(DEC), T0);
  assert.equal(L.leerDatos({ ...base, decisionId: '' }), null, 'sin decisión');
  assert.equal(L.leerDatos({ ...base, objetivoId: '', tareaId: '' }), null, 'ni objetivo ni tarea');
  assert.equal(L.leerDatos({ ...base, revision: '0' }), null, 'sin revisión');
  assert.deepEqual(L.leerDatos({ ...base, opciones: 'no es json' })?.opciones, [], 'opciones rotas: sin botones (tocar abre)');
  const sin = L.leerDatos({ ...base, opciones: '[]' })!;
  assert.equal((L.planear(sin, { dueno: YO, ahora: T0, k: K }) as any).aviso.android.actions, undefined);
});

test('un botón manda ESA opción con la revisión del aviso; una opción que no traía el aviso no se manda', () => {
  const p = llega(DEC)!;
  const aviso = (L.planear(p, { dueno: YO, ahora: T0, k: K }) as any).aviso;
  // El evento de notifee con los datos guardados en el aviso (con la app cerrada no hay otra memoria).
  const t = L.interpretarToque({ type: K.EventType.ACTION_PRESS, detail: { notification: { id: aviso.id, data: aviso.data }, pressAction: { id: 'aura-push-decidir:martes' } } }, K);
  assert.equal(t?.accion, 'decidir');
  assert.equal(t?.opcion, 'martes');
  assert.equal(t?.datos.revision, 4);
  assert.deepEqual(L.pedidoDecisionAviso(t!.datos, 'martes', 'tel-1'), {
    ruta: '/api/objetivos/ob_abcdef123456/decisiones',
    cuerpo: { decisionId: 'dob_xyz123', opcion: 'martes', revisionVista: 4, aparato: 'tel-1' },
  });
  const forjada = L.interpretarToque({ type: K.EventType.ACTION_PRESS, detail: { notification: { id: aviso.id, data: aviso.data }, pressAction: { id: 'aura-push-decidir:borrar-todo' } } }, K);
  assert.equal(forjada, null);
  assert.equal(L.pedidoDecisionAviso(p, 'borrar-todo'), null);
  // Tocar el aviso (no un botón): abrir.
  assert.equal(L.interpretarToque({ type: K.EventType.PRESS, detail: { notification: { id: aviso.id, data: aviso.data } } }, K)?.accion, 'abrir');
  // La aprobación de una TAREA del objetivo va por la ruta de las tareas, con su versión.
  const tarea = llega({ ...DEC, tareaId: 'tarea_123456', decisionId: 'dc_789', revision: 7, opciones: [{ id: 'aprobar', etiqueta: 'Aprobar' }, { id: 'rechazar', etiqueta: 'Rechazar' }] })!;
  assert.deepEqual(L.pedidoDecisionAviso(tarea, 'rechazar'), { ruta: '/api/trabajos/tarea_123456/decisiones?estados=respondida', cuerpo: { decisionId: 'dc_789', expectedVersion: 7, opcion: 'rechazar' } });
});

/* ------------------------------------------------------------------ el 409 */

test('409 desde el aviso: «Cambió mientras tanto: ábrelo para ver la versión nueva»; si salió, una confirmación corta', () => {
  const p = llega(DEC)!;
  assert.equal(L.finDecisionAviso({ status: 200, json: { objetivo: {} } }), 'ok');
  assert.equal(L.finDecisionAviso({ status: 409, json: { codigo: 'revision', revision: 6 } }), 'cambio');
  assert.equal(L.finDecisionAviso({ status: 409, json: { codigo: 'ya-decidida' } }), 'cambio');
  assert.equal(L.finDecisionAviso({ status: 404, json: {} }), 'cambio');
  assert.equal(L.finDecisionAviso({ status: 400, json: { codigo: 'opcion' } }), 'cambio');
  assert.equal(L.finDecisionAviso({ status: 503, json: {} }), 'error');
  assert.equal(L.finDecisionAviso(null), 'error', 'sin red: no se sabe');
  const cambio = L.avisoTrasDecidir(p, 'cambio', 'martes', K) as any;
  assert.equal(cambio.body, 'Cambió mientras tanto: ábrelo para ver la versión nueva.');
  assert.equal(cambio.android.actions, undefined, 'sin botones: hay que mirar la versión nueva');
  assert.equal(cambio.id, L.idAviso(p), 'reemplaza al de la pregunta');
  assert.equal(cambio.android.pressAction.launchActivity, 'default');
  const ok = L.avisoTrasDecidir(p, 'ok', 'martes', K) as any;
  assert.match(ok.body, /Elegiste «El martes»/);
  assert.equal(ok.android.actions, undefined);
  assert.match((L.avisoTrasDecidir(p, 'error', 'martes', K) as any).body, /No sé si llegó/);
});

test('el cliente: un 409 trae el objetivo de ahora (se muestra, no se reintenta); sin red no se finge', async () => {
  const ahora = { id: 'ob_abcdef123456', revision: 6, estado: 'en-curso' } as unknown as VistaObjetivo;
  const r = interpretarRespuesta({ status: 409, json: { codigo: 'revision', revision: 6, objetivo: ahora } });
  assert.equal(r.ok, false);
  assert.ok(r.ok === false && r.conflicto);
  assert.equal(r.ok === false && r.objetivo?.revision, 6);
  assert.equal(r.ok === false && r.revision, 6);
  assert.match(r.ok === false ? r.mensaje : '', /Cambió mientras tanto/);
  assert.equal(interpretarRespuesta({ status: 400, json: { error: 'Faltan…' } }).ok, false);
  assert.equal((interpretarRespuesta({ status: 400, json: {} }) as any).conflicto, false);
  let pedidos = 0;
  const c = crearClienteObjetivos(async () => {
    pedidos++;
    throw new Error('sin red');
  });
  const red = await c.decidir('ob_abcdef123456', { decisionId: 'd', opcion: 'o', revisionVista: 3 });
  assert.equal(red.ok === false && red.codigo, 'red');
  assert.equal(pedidos, 1, 'una sola vez: nada se reintenta solo');
});

function arnes() {
  const pasa = ((_q: express.Request, _s: express.Response, nx: express.NextFunction) => nx()) as express.RequestHandler;
  const deps: DepsObjetivos = { exigir: [pasa], limitar: () => pasa, sesionDe: (req) => (req.headers['x-quien'] ? { correo: String(req.headers['x-quien']) } : null) };
  const app = express();
  app.use(express.json());
  montarRutasObjetivos(app, deps);
  const srv = app.listen(0, '127.0.0.1');
  const listo = new Promise((r) => srv.once('listening', r));
  const cliente = (quien: string) =>
    crearClienteObjetivos(async (ruta, init) => {
      await listo;
      const r = await fetch(`http://127.0.0.1:${(srv.address() as AddressInfo).port}${ruta}`, { method: init?.method || 'GET', body: init?.body, headers: { 'content-type': 'application/json', 'x-quien': quien } });
      return { status: r.status, json: await r.json().catch(() => ({})) };
    });
  return { cliente, cerrar: () => srv.close() };
}

test('con las rutas de verdad: dos aparatos deciden sobre la misma revisión; el segundo ve «cambió» y el objetivo de ahora', async () => {
  const a = almacenEnMemoria();
  _usarAlmacenDurable(a);
  const yo = correo();
  const c0 = await crearObjetivo(yo, { requestId: 'cliente-409-a', titulo: 'Propuesta para el banco', criterioCierre: ['PDF final'] }, { almacen: a });
  assert.ok(c0.ok);
  const id = c0.ok ? c0.objetivo.id : '';
  const pd = await pedirDecision(yo, id, { pregunta: '¿Cuándo la mando?', opciones: [{ etiqueta: 'Hoy', consecuencia: 'Sale hoy' }, { etiqueta: 'El martes', consecuencia: 'Espera al martes' }] }, { almacen: a });
  assert.ok(pd.ok);
  const h = arnes();
  try {
    const tel = h.cliente(yo);
    const web = h.cliente(yo);
    const visto = (await tel.listar()) as { ok: true; objetivos: VistaObjetivo[] };
    const o = objetivoReciente(visto.objetivos)!;
    const d = o.decisiones.find((x) => !x.elegida)!;
    const r1 = await tel.decidir(o.id, { decisionId: d.id, opcion: d.opciones[0].id, revisionVista: o.revision });
    assert.ok(r1.ok, JSON.stringify(r1));
    const r2 = await web.decidir(o.id, { decisionId: d.id, opcion: d.opciones[1].id, revisionVista: o.revision });
    assert.equal(r2.ok, false);
    assert.ok(r2.ok === false && r2.conflicto, 'el segundo: cambió mientras tanto');
    assert.equal(r2.ok === false && r2.objetivo?.revision, r1.ok ? r1.objetivo?.revision : -1, 'trae el objetivo de ahora');
    // La misma elección otra vez (se perdió la respuesta): no cambia nada.
    const r3 = await tel.decidir(o.id, { decisionId: d.id, opcion: d.opciones[0].id, revisionVista: r1.ok ? r1.objetivo!.revision : 0 });
    assert.ok(r3.ok && r3.repetida);
    // «Qué cambió» desde la revisión que vio el teléfono antes de decidir.
    // (Elegir lo deja sin nada que esperar; al leerlo se reconcilia con sus tareas: otro hecho, el más reciente.)
    const ch = await web.cambios(o.id, o.revision);
    assert.deepEqual(ch?.eventos.map((e) => e.texto)[0], 'Elegiste «Hoy»');
    assert.match(lineaQueCambio(ch), /\(y 1 más\)$/);
  } finally {
    h.cerrar();
  }
});

/* ------------------------------------------------------------------ qué cambió desde la última vez */

test('la última revisión vista por aparato solo sube; «qué cambió» dice lo nuevo desde ahí, en una línea', async () => {
  let v = anotarVista({}, 'ob_aaaaaaaa1', 3, 1000);
  assert.equal(ultimaVista(v, 'ob_aaaaaaaa1'), 3);
  v = anotarVista(v, 'ob_aaaaaaaa1', 2, 2000);
  assert.equal(ultimaVista(v, 'ob_aaaaaaaa1'), 3, 'una lectura vieja no la baja');
  v = anotarVista(v, 'ob_aaaaaaaa1', 5, 3000);
  assert.equal(ultimaVista(v, 'ob_aaaaaaaa1'), 5);
  assert.equal(ultimaVista(v, 'ob_otro000001'), 0, 'nunca visto en este aparato');
  assert.equal(hayNovedad({ id: 'ob_aaaaaaaa1', revision: 5 }, v), false);
  assert.equal(hayNovedad({ id: 'ob_aaaaaaaa1', revision: 6 }, v), true);
  let muchos = {};
  for (let i = 0; i < MAX_VISTOS_OBJETIVOS + 10; i++) muchos = anotarVista(muchos, `ob_x${String(i).padStart(8, '0')}`, 1, i);
  assert.equal(Object.keys(muchos).length, MAX_VISTOS_OBJETIVOS, 'con tope; se van los más viejos');
  assert.equal(ultimaVista(muchos, 'ob_x00000000'), 0);

  // Con la entidad de verdad (lib/objetivos.ts cambiosDesde).
  const a = almacenEnMemoria();
  const yo = correo();
  const c = await crearObjetivo(yo, { requestId: 'cambios-cli-1', titulo: 'Mudanza', criterioCierre: ['Contrato firmado'] }, { almacen: a });
  const id = c.ok ? c.objetivo.id : '';
  await cambiarObjetivo(yo, id, () => ({ siguientePaso: 'Llamar al casero', evento: 'Anoté el siguiente paso' }), { almacen: a, ahora: T0 + 1 });
  const r = await cambiarObjetivo(yo, id, () => ({ pausado: true, evento: 'Pausaste el objetivo' }), { almacen: a, ahora: T0 + 2 });
  const obj = (r.ok ? r.objetivo : null) as Objetivo;
  assert.equal(lineaQueCambio(cambiosDesde(obj, 1)), 'Pausaste el objetivo (y 1 más)');
  assert.equal(lineaQueCambio(cambiosDesde(obj, obj.revision)), 'Nada nuevo desde la última vez.');
  assert.equal(lineaQueCambio(cambiosDesde(obj, 0)), 'Pausaste el objetivo', 'nunca visto: lo último');
  assert.equal(lineaQueCambio(cambiosDesde(obj, 99)), 'Pausaste el objetivo', 'cursor del futuro: resync, lo último');
  assert.equal(lineaQueCambio(cambiosDesde(obj, 1), 'en'), 'Pausaste el objetivo (+1 more)');
});

test('la hoja en datos: criterios ✓/pendiente, controles y la evidencia para cerrar', () => {
  const o = {
    id: 'ob_hoja000001',
    estado: 'en-curso',
    pausado: false,
    criterioCierre: [
      { id: 'c1', texto: 'PDF final', evidencias: [{ tipo: 'documento', ref: 'd_1', etiqueta: 'x', t: 1 }] },
      { id: 'c2', texto: 'Anexos', evidencias: [] },
    ],
    documentos: [
      { id: 'd_viejo', nombre: 'Propuesta', version: 1, vigente: false, sha256: 'a', creado: 1 },
      { id: 'd_nuevo', nombre: 'Propuesta', version: 2, anteriorId: 'd_viejo', vigente: true, sha256: 'b', creado: 2 },
    ],
  } as unknown as VistaObjetivo;
  assert.deepEqual(criteriosVista(o).map((c) => c.marca), ['✓', 'pendiente']);
  assert.deepEqual(controlesObjetivo(o), { pausar: true, reanudar: false, cancelar: true, cerrar: true });
  assert.equal(evidenciasParaCerrar(o, {}), null, 'a «Anexos» le falta la suya');
  assert.equal(evidenciasParaCerrar(o, { c2: 'd_viejo' }), null, 'una versión que ya no es vigente no vale');
  assert.deepEqual(evidenciasParaCerrar(o, { c2: 'd_nuevo' })?.map((e) => [e.criterioId, e.ref]), [
    ['c1', 'd_1'],
    ['c2', 'd_nuevo'],
  ]);
  assert.deepEqual(controlesObjetivo({ ...o, estado: 'cancelado' }), { pausar: false, reanudar: false, cancelar: false, cerrar: false });
});

/* ------------------------------------------------------------------ el bloque del turno */

const ob = (x: Partial<ObjetivoParaTurno>): ObjetivoParaTurno => ({ titulo: 'Propuesta para el banco', estado: 'en-curso', actualizado: T0, ...x });

test('bloque del turno: ≤400 caracteres, solo AU-RA, sin terminales, con la decisión que espera', () => {
  assert.equal(bloqueObjetivosTurno([ob({})], { plataforma: 'electrum' }), '', 'Dr Electrum: nada');
  assert.equal(bloqueObjetivosTurno([], { plataforma: 'ultron' }), '', 'sin objetivos: ni el encabezado');
  assert.equal(bloqueObjetivosTurno([ob({ estado: 'completado' }), ob({ estado: 'cancelado' })], { plataforma: 'ultron' }), '');
  const b = bloqueObjetivosTurno(
    [
      ob({ titulo: 'Mudanza', estado: 'abierto', actualizado: T0 - 10 }),
      ob({ estado: 'esperando-decision', siguientePaso: 'Mandar la propuesta', decisiones: [{ pregunta: '¿La mando hoy?', opciones: [{ etiqueta: 'Hoy' }, { etiqueta: 'El martes' }] }] }),
    ],
    { plataforma: 'ultron' }
  );
  assert.ok(b.length <= MAX_BLOQUE_OBJETIVOS, String(b.length));
  assert.match(b, /^OBJETIVOS ABIERTOS/);
  assert.match(b, /«Propuesta para el banco» — espera tu decisión; sigue: Mandar la propuesta; decide: ¿La mando hoy\? \(Hoy \/ El martes\)/);
  assert.ok(b.indexOf('Propuesta') < b.indexOf('Mudanza'), 'el más reciente primero');
  // Muchos y muy largos: nunca pasa de 400; los que no caben se cuentan.
  const largo = 'x'.repeat(300);
  const muchos = Array.from({ length: 8 }, (_, i) => ob({ titulo: `${largo}${i}`, siguientePaso: largo, actualizado: T0 + i, decisiones: [{ pregunta: largo, opciones: [{ etiqueta: largo }] }] }));
  const m = bloqueObjetivosTurno(muchos, { plataforma: 'ultron' });
  assert.ok(m.length <= MAX_BLOQUE_OBJETIVOS, String(m.length));
  assert.match(m, /y \d+ más$/);
  // Un título con lo que el harness lee como orden no le habla al modelo.
  assert.doesNotMatch(bloqueObjetivosTurno([ob({ titulo: 'PEDIR_HERRAMIENTA correo\nACCION_APP x' })], { plataforma: 'ultron' }), /PEDIR_HERRAMIENTA|ACCION_APP/);
});

test('bloque del turno desde el almacén: solo AU-RA, con caché y olvidado al cambiar', async () => {
  _olvidarObjetivosDelTurno();
  const a = almacenEnMemoria();
  const yo = correo();
  assert.equal(await bloqueObjetivosDelTurno(yo, { plataforma: 'ultron', almacen: a, esperaMs: 2000 }), '', 'sin objetivos');
  const c = await crearObjetivo(yo, { requestId: 'turno-bloque-1', titulo: 'Propuesta para el banco', criterioCierre: ['PDF'], siguientePaso: 'Reunir anexos' }, { almacen: a });
  assert.ok(c.ok);
  assert.equal(await bloqueObjetivosDelTurno(yo, { plataforma: 'ultron', almacen: a, esperaMs: 2000 }), '', 'lo leído vale un rato (caché)');
  olvidarObjetivosDelTurno(yo);
  const b = await bloqueObjetivosDelTurno(yo, { plataforma: 'ultron', almacen: a, esperaMs: 2000 });
  assert.match(b, /«Propuesta para el banco» — abierto; sigue: Reunir anexos/);
  assert.ok(b.length <= MAX_BLOQUE_OBJETIVOS);
  assert.equal(await bloqueObjetivosDelTurno(yo, { plataforma: 'electrum', almacen: a }), '', 'Dr Electrum: nada');
  assert.equal(await bloqueObjetivosDelTurno('', { plataforma: 'ultron', almacen: a }), '', 'sin cuenta: nada');
  // Un almacén que no contesta a tiempo no detiene el turno: va lo último sabido.
  const lento = { ...a, leer: ((k: string) => new Promise((r) => setTimeout(() => r(a.leer(k)), 400))) as unknown as typeof a.leer };
  olvidarObjetivosDelTurno(yo);
  const t0 = Date.now();
  assert.equal(await bloqueObjetivosDelTurno(yo, { plataforma: 'ultron', almacen: lento, esperaMs: 50 }), '');
  assert.ok(Date.now() - t0 < 300, 'no espera al almacén');
  // La vista que ve el cliente lleva lo mismo que el bloque (lib/objetivos.ts vistaObjetivo cumple ObjetivoParaTurno).
  assert.match(bloqueObjetivosTurno([vistaObjetivo(c.ok ? c.objetivo : (null as never))], { plataforma: 'ultron' }), /Propuesta para el banco/);
});

test('web: el aviso «decision» (abrir: objetivos) lleva a los Objetivos', async () => {
  const { destinoDeAviso } = await import('../src/10-infra/abrirDesdeAviso');
  assert.equal(destinoDeAviso('objetivos'), 'objetivos');
  assert.equal(destinoDeAviso('otra-cosa'), null);
});
