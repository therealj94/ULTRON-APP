/**
 * AUR08: la lógica del panel de tareas que comparten el teléfono y la web (mobile/src/lib/trabajos.ts; la web
 * la importa tal cual, como ya hace con mobile/src/lib/interrupcion). Funciones puras, sin red ni React:
 *   · el reductor reconcilia lo que llega del servidor: una versión vieja no pisa una nueva, un terminal no
 *     vuelve atrás y un fallo de red no borra lo que había (el backend es la fuente de verdad);
 *   · el indicador: «Trabajando · 2», «Necesito una decisión · 1», estable (no parpadea en cada sondeo), sin
 *     movimiento en terminales ni con «reducir movimiento»;
 *   · el progreso solo con denominador real; los estados distinguibles (una espera no es «trabajando»);
 *   · la tarjeta de decisión: nunca preselecciona ni arma de inmediato la opción con efecto, no la acepta con
 *     Enter recién aparecida ni mientras se escribe, y sin «Sí» genéricos cuando hay varias tareas;
 *   · el cliente HTTP manda decisionId + expectedVersion + opción exacta y devuelve el error recuperable.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ARMADO_MS,
  crearClienteTrabajos,
  estadoInicial,
  etiquetaBoton,
  etiquetaEstado,
  etiquetaTarea,
  esperaQueSigas,
  grupos,
  gira,
  giraTarea,
  ultimaSenal,
  indicadorEstable,
  MAX_PAGINAS_TRABAJOS,
  mensajeDeError,
  movimientoIndicador,
  opcionesTarjeta,
  puedeActivar,
  reducir,
  refsDeTurno,
  resumen,
  textoIndicador,
  textoProgreso,
  type TareaVista,
} from '../mobile/src/lib/trabajos';

const T0 = Date.parse('2026-10-03T15:00:00Z');

function tarea(o: Partial<TareaVista> & { id: string }): TareaVista {
  return {
    version: 1,
    state: 'running',
    terminal: false,
    source: 'durable',
    title: 'Comparar opciones',
    objective: 'Recomendación con fuentes',
    acceptance: [],
    environment: { kind: 'chat', id: 'telefono', displayName: 'Esta conversación' },
    progress: null,
    decision: null,
    result: null,
    updatedAt: new Date(T0).toISOString(),
    controls: { pause: true, resume: false, cancel: true },
    ...o,
  };
}

const decision = (o: Record<string, unknown> = {}) =>
  ({
    id: 'dc_1',
    kind: 'aprobar-accion',
    question: '¿Envío este correo a ana@ejemplo.com?',
    why: 'Sale a otra persona',
    proposal: { action: 'Enviar este correo', account: 'yo@ejemplo.com', recipient: 'ana@ejemplo.com', data: ['Asunto: «Fechas»'], scope: 'Solo este mensaje' },
    options: [
      { id: 'posponer', label: 'Posponer', effect: 'No envía nada.', risk: 'sin-efecto' },
      { id: 'rechazar', label: 'Rechazar', effect: 'No se envía.', risk: 'sin-efecto' },
      { id: 'aprobar', label: 'Aprobar: Enviar este correo', effect: 'Lo envía una vez.', risk: 'efecto' },
    ],
    createdAt: new Date(T0).toISOString(),
    expiresAt: new Date(T0 + 15 * 60_000).toISOString(),
    expired: false,
    postponed: false,
    ...o,
  }) as any;

/* ------------------------------------------------------------------ el reductor */

test('reductor: una versión vieja no pisa una nueva; un terminal no vuelve atrás; mismo id siempre', () => {
  let s = estadoInicial();
  s = reducir(s, { tipo: 'lista', tareas: [tarea({ id: 'a', version: 3, currentStep: 'paso 3' })], en: T0 });
  s = reducir(s, { tipo: 'una', tarea: tarea({ id: 'a', version: 2, currentStep: 'paso 2 (llegó tarde)' }), en: T0 + 1 });
  assert.equal(s.porId.a.currentStep, 'paso 3', 'una respuesta vieja que llega tarde no gana');
  s = reducir(s, { tipo: 'una', tarea: tarea({ id: 'a', version: 4, state: 'completed', terminal: true }), en: T0 + 2 });
  s = reducir(s, { tipo: 'lista', tareas: [tarea({ id: 'a', version: 5, state: 'running' })], en: T0 + 3 });
  assert.equal(s.porId.a.state, 'completed', 'un terminal no resucita aunque llegue con versión mayor');
  assert.deepEqual(Object.keys(s.porId), ['a'], 'no se fabrica otra tarea');
});

test('reductor: un fallo de red no borra lo que había; la lista completa sí quita lo que el servidor ya no da', () => {
  let s = reducir(estadoInicial(), { tipo: 'lista', tareas: [tarea({ id: 'a' }), tarea({ id: 'b' })], en: T0 });
  s = reducir(s, { tipo: 'error', en: T0 + 1, mensaje: 'sin red' });
  assert.equal(Object.keys(s.porId).length, 2);
  assert.equal(s.error, 'sin red');
  s = reducir(s, { tipo: 'lista', tareas: [tarea({ id: 'b', version: 2 })], en: T0 + 2 });
  assert.deepEqual(Object.keys(s.porId), ['b']);
  assert.equal(s.error, null);
  // Sin sesión: se vacía (no se ven tareas de la cuenta anterior).
  s = reducir(s, { tipo: 'sin-sesion' });
  assert.deepEqual(s.porId, {});
});

test('reductor (revisión 9): una lista PARCIAL no borra las que no se pudieron leer; quedan «sin confirmar» con su aviso', () => {
  let s = reducir(estadoInicial(), { tipo: 'lista', tareas: [tarea({ id: 'a' }), tarea({ id: 'b', currentStep: 'paso 2' })], en: T0 });
  assert.equal(s.aviso, null);
  const aviso = 'No pude leer una de tus tareas en este momento; no es que no exista.';
  s = reducir(s, { tipo: 'lista', tareas: [tarea({ id: 'a', version: 2 })], en: T0 + 1, completo: false, aviso });
  assert.deepEqual(Object.keys(s.porId).sort(), ['a', 'b'], 'la que no se pudo leer sigue a la vista');
  assert.equal(s.porId.b.sinConfirmar, true, 'marcada «sin confirmar»');
  assert.equal(s.porId.b.currentStep, 'paso 2', 'con lo último que se supo');
  assert.equal(s.porId.a.version, 2);
  assert.equal(s.porId.a.sinConfirmar, undefined, 'la que vino está confirmada');
  assert.equal(s.aviso, aviso, 'el aviso del servidor queda en el estado (los paneles lo pintan)');
  assert.equal(s.error, null);
  // Parcial sin aviso del servidor: igual se avisa.
  s = reducir(s, { tipo: 'lista', tareas: [tarea({ id: 'a', version: 2 })], en: T0 + 2, completo: false });
  assert.ok(s.aviso && /no pude/i.test(s.aviso));
  assert.equal(s.porId.b.sinConfirmar, true);
  // La tarea leída por su id la confirma.
  s = reducir(s, { tipo: 'una', tarea: tarea({ id: 'b', version: 1, currentStep: 'paso 2' }), en: T0 + 3 });
  assert.equal(s.porId.b.sinConfirmar, undefined);
  // Otra parcial y luego una COMPLETA sin «b»: ahí sí se quita, y el aviso se va.
  s = reducir(s, { tipo: 'lista', tareas: [tarea({ id: 'a', version: 2 })], en: T0 + 4, completo: false, aviso });
  assert.equal(s.porId.b.sinConfirmar, true);
  s = reducir(s, { tipo: 'lista', tareas: [tarea({ id: 'a', version: 3 })], en: T0 + 5, completo: true });
  assert.deepEqual(Object.keys(s.porId), ['a']);
  assert.equal(s.aviso, null);
});

test('resumen (revisión 10, MENOR-F): una tarea «sin confirmar» de una lista parcial no cuenta como «trabajando» ni hace girar el indicador', () => {
  // La lista completa: dos trabajando.
  let s = reducir(estadoInicial(), { tipo: 'lista', tareas: [tarea({ id: 'a' }), tarea({ id: 'b' })], en: T0 });
  assert.deepEqual(resumen(Object.values(s.porId), T0), { trabajando: 2, decisiones: 0 });
  // Parcial: «b» no vino. Queda a la vista, pero ya no es «Trabajando · 2».
  s = reducir(s, { tipo: 'lista', tareas: [tarea({ id: 'a', state: 'completed', terminal: true, version: 2 })], en: T0 + 1, completo: false });
  assert.equal(s.porId.b.sinConfirmar, true);
  const r = resumen(Object.values(s.porId), T0 + 1);
  assert.deepEqual(r, { trabajando: 0, decisiones: 0 }, 'la que no se pudo leer no se cuenta como trabajando');
  assert.equal(textoIndicador(r), null, 'sin nada confirmado activo, el indicador no dice «Trabajando»');
  assert.equal(movimientoIndicador(r, false), false, 'y no gira mientras la lista sigue parcial');
  // La siguiente lista la confirma: vuelve a contar.
  s = reducir(s, { tipo: 'lista', tareas: [tarea({ id: 'a', state: 'completed', terminal: true, version: 2 }), tarea({ id: 'b', version: 2 })], en: T0 + 2, completo: true });
  assert.deepEqual(resumen(Object.values(s.porId), T0 + 2), { trabajando: 1, decisiones: 0 });
});

test('cliente (revisión 9): `completo:false` y el aviso llegan; un servidor que pagina se sigue y lo que no se trae es PARCIAL', async () => {
  // Parcial del servidor.
  let c = crearClienteTrabajos(async () => ({ status: 200, json: { tareas: [tarea({ id: 'a' })], completo: false, aviso: 'No pude leer una de tus tareas.' } }));
  let r = await c.listar();
  assert.ok(r.ok && !r.completo && r.aviso === 'No pude leer una de tus tareas.');
  // Páginas: se siguen con el cursor (sin repetir ninguna) y la lista queda completa.
  const rutas: string[] = [];
  c = crearClienteTrabajos(async (ruta) => {
    rutas.push(ruta);
    const cur = new URL(ruta, 'http://x').searchParams.get('cursor');
    if (!cur) return { status: 200, json: { tareas: [tarea({ id: 'a' }), tarea({ id: 'b' })], completo: true, siguiente: 'c1' } };
    if (cur === 'c1') return { status: 200, json: { tareas: [tarea({ id: 'b' }), tarea({ id: 'c' })], completo: true, siguiente: null } };
    return { status: 500, json: {} };
  });
  r = await c.listar();
  assert.ok(r.ok);
  if (!r.ok) return;
  assert.deepEqual(r.tareas.map((t) => t.id), ['a', 'b', 'c']);
  assert.equal(r.completo, true);
  assert.equal(r.aviso, undefined);
  assert.ok(rutas[1].includes('cursor=c1') && rutas.every((x) => /estados=respondida/.test(x)), rutas.join(' '));
  // Una página que falla: lo traído vale, pero la lista es PARCIAL (no «eso es todo»).
  c = crearClienteTrabajos(async (ruta) =>
    new URL(ruta, 'http://x').searchParams.get('cursor') ? { status: 503, json: { error: 'caído' } } : { status: 200, json: { tareas: [tarea({ id: 'a' })], completo: true, siguiente: 'c1' } }
  );
  r = await c.listar();
  assert.ok(r.ok && !r.completo && !!r.aviso && r.tareas.length === 1);
  // Más páginas de las que se siguen en un sondeo: PARCIAL, con aviso.
  let n = 0;
  c = crearClienteTrabajos(async () => ({ status: 200, json: { tareas: [tarea({ id: `t${n++}` })], completo: true, siguiente: `c${n}` } }));
  r = await c.listar();
  assert.ok(r.ok && !r.completo && /más tareas/.test(r.aviso || ''));
  assert.equal(r.ok && r.tareas.length, MAX_PAGINAS_TRABAJOS);
});

test('grupos del panel: pendientes de decisión, activas (con las pausadas) y recientes', () => {
  const xs = [
    tarea({ id: 'r', state: 'running' }),
    tarea({ id: 'p', state: 'paused', controls: { pause: false, resume: true, cancel: true } }),
    tarea({ id: 'd', state: 'awaiting_approval', decision: decision() }),
    tarea({ id: 'b', state: 'blocked' }),
    tarea({ id: 'c', state: 'completed', terminal: true, updatedAt: new Date(T0 - 1000).toISOString() }),
    tarea({ id: 'x', state: 'cancelled', terminal: true, updatedAt: new Date(T0).toISOString() }),
  ];
  const g = grupos(xs, T0);
  assert.deepEqual(g.decisiones.map((t) => t.id), ['d', 'b']);
  assert.deepEqual(g.activas.map((t) => t.id).sort(), ['p', 'r']);
  assert.deepEqual(g.recientes.map((t) => t.id), ['x', 'c'], 'la más nueva primero');
});

test('la tarea en curso que espera que sigas: su propio grupo, «Espera que sigas», sin spinner ni «última señal» (José, 5-oct)', () => {
  // Lo que manda el servidor ahora para una tarea en curso activa (lib/tareas-durables.ts deTareaEnCurso).
  const espera = tarea({
    id: 'tc',
    source: 'tarea-en-curso',
    state: 'awaiting_approval',
    awaitingInput: true,
    title: 'revisar los 12 correos sin leer',
    environment: { kind: 'correo', id: 'mesa', displayName: 'Tu correo' },
    progress: { done: 1, total: 12, unit: 'pasos' },
    currentStep: 'Espera que sigas: dime «sigue» o «el siguiente». Lo que sigue: Beto — «Planos»',
    updatedAt: new Date(T0 - 120_000).toISOString(),
  });
  const vivo = tarea({ id: 'r', state: 'running', lastHeartbeatAt: new Date(T0 - 60_000).toISOString() });
  const g = grupos([espera, vivo], T0);
  assert.deepEqual(g.esperan.map((t) => t.id), ['tc'], 'va en «Esperan que sigas»');
  assert.deepEqual(g.activas.map((t) => t.id), ['r'], '«En marcha» es solo trabajo de verdad');
  assert.deepEqual(g.decisiones, [], 'no es una decisión');
  assert.equal(esperaQueSigas(espera), true);
  assert.equal(esperaQueSigas(vivo), false);
  assert.equal(etiquetaTarea(espera), 'Espera que sigas');
  assert.equal(etiquetaTarea(espera, 'en'), 'Waiting for you');
  assert.equal(etiquetaTarea(vivo), 'Trabajando', 'lo demás, la etiqueta de su estado');
  assert.equal(giraTarea(espera), false, 'sin spinner');
  assert.equal(giraTarea(vivo), true);
  assert.equal(ultimaSenal(espera, T0), '', 'sin «última señal»: nada trabaja por detrás');
  assert.equal(ultimaSenal(vivo, T0), 'hace 1 min');
  assert.deepEqual(resumen([espera], T0), { trabajando: 0, decisiones: 0 }, 'el indicador no dice «Trabajando»');
  // Sin la marca (otra réplica del servidor), la tarea en curso en espera sin decisión también es «espera que sigas».
  const { awaitingInput: _fuera, ...sinMarca } = espera;
  assert.equal(esperaQueSigas(sinMarca as TareaVista), true);
  // Un servidor de antes la mandaba en `running`: una tarea en curso nunca trabaja por detrás, tampoco es «Trabajando».
  const vieja = tarea({ ...sinMarca, id: 'tc-vieja', state: 'running', lastHeartbeatAt: new Date(T0 - 120_000).toISOString() } as TareaVista);
  assert.equal(esperaQueSigas(vieja), true);
  assert.equal(giraTarea(vieja), false);
  assert.equal(ultimaSenal(vieja, T0), '');
  assert.deepEqual(grupos([vieja], T0).esperan.map((t) => t.id), ['tc-vieja']);
  assert.deepEqual(resumen([vieja], T0), { trabajando: 0, decisiones: 0 });
  // Una durable `running` sigue siendo trabajo de verdad.
  assert.equal(esperaQueSigas(tarea({ id: 'd', state: 'running' })), false);
  // Una pausada no espera que sigas: está en pausa (Reanudar).
  assert.equal(esperaQueSigas(tarea({ id: 'p', source: 'tarea-en-curso', state: 'paused' })), false);
});

/* ------------------------------------------------------------------ el indicador */

test('indicador: decisión antes que trabajo; nada activo → no se muestra', () => {
  assert.equal(textoIndicador({ trabajando: 2, decisiones: 0 }), 'Trabajando · 2');
  assert.equal(textoIndicador({ trabajando: 2, decisiones: 1 }), 'Necesito una decisión · 1');
  assert.equal(textoIndicador({ trabajando: 0, decisiones: 3 }, 'en'), 'I need a decision · 3');
  assert.equal(textoIndicador({ trabajando: 0, decisiones: 0 }), null);
  const xs = [tarea({ id: 'a' }), tarea({ id: 'b', state: 'waiting_resource' }), tarea({ id: 'c', state: 'awaiting_approval', decision: decision({ postponed: true }) }), tarea({ id: 'd', state: 'failed', terminal: true })];
  assert.deepEqual(resumen(xs, T0), { trabajando: 2, decisiones: 0 });
});

test('indicador estable: no cambia en cada sondeo (mínimo entre cambios), pero sube una decisión al momento', () => {
  let e = indicadorEstable(null, 'Trabajando · 1', T0);
  assert.equal(e.texto, 'Trabajando · 1');
  e = indicadorEstable(e, 'Trabajando · 2', T0 + 300);
  assert.equal(e.texto, 'Trabajando · 1', 'muy pronto: no parpadea');
  e = indicadorEstable(e, 'Trabajando · 2', T0 + 3000);
  assert.equal(e.texto, 'Trabajando · 2');
  e = indicadorEstable(e, 'Necesito una decisión · 1', T0 + 3100);
  assert.equal(e.texto, 'Necesito una decisión · 1', 'una decisión nueva no espera');
  e = indicadorEstable(e, null, T0 + 3200);
  assert.equal(e.texto, 'Necesito una decisión · 1', 'desaparecer también espera su mínimo');
  e = indicadorEstable(e, null, T0 + 9000);
  assert.equal(e.texto, null);
});

test('movimiento: solo trabajando y sin «reducir movimiento»; nunca en terminales ni esperando decisión', () => {
  assert.equal(movimientoIndicador({ trabajando: 1, decisiones: 0 }, false), true);
  assert.equal(movimientoIndicador({ trabajando: 1, decisiones: 0 }, true), false, 'reducir movimiento: estático');
  assert.equal(movimientoIndicador({ trabajando: 1, decisiones: 1 }, false), false, 'esperando decisión: quieto');
  assert.equal(movimientoIndicador({ trabajando: 0, decisiones: 0 }, false), false);
  for (const s of ['completed', 'partial', 'failed', 'cancelled', 'paused', 'blocked', 'awaiting_approval', 'waiting_resource', 'reconciling'] as const) assert.equal(gira(s), false, s);
  for (const s of ['running', 'verifying', 'queued'] as const) assert.equal(gira(s), true, s);
});

test('estados distinguibles y progreso solo con denominador real', () => {
  const etiquetas = new Set(['awaiting_approval', 'waiting_resource', 'running', 'paused', 'verifying', 'completed', 'partial', 'failed', 'cancelled', 'reconciling', 'blocked'].map((s) => etiquetaEstado(s as any)));
  assert.equal(etiquetas.size, 11, 'cada estado tiene su palabra');
  assert.notEqual(etiquetaEstado('waiting_resource'), etiquetaEstado('running'), 'una espera no se esconde en «trabajando»');
  assert.equal(textoProgreso({ done: 3, total: 5, unit: 'páginas comprobadas' }), '3 de 5 páginas comprobadas');
  assert.equal(textoProgreso(null), null);
  assert.equal(textoProgreso({ done: 1, total: 0, unit: 'pasos' }), null, 'sin denominador no hay progreso');
  assert.ok(!/%/.test(textoProgreso({ done: 1, total: 3, unit: 'pasos' }) || ''));
});

/* ------------------------------------------------------------------ la tarjeta de decisión */

test('tarjeta: ninguna opción preseleccionada; la de efecto nunca es la principal ni va primera', () => {
  const ops = opcionesTarjeta(decision());
  assert.equal(ops.some((o) => o.preseleccionada), false);
  assert.notEqual(ops[0].id, 'aprobar');
  const aprobar = ops.find((o) => o.id === 'aprobar')!;
  assert.equal(aprobar.principal, false, 'no es el botón por omisión');
  assert.equal(aprobar.conEfecto, true);
  // Aunque el servidor la mandara primero, la tarjeta la pone al final.
  const desordenada = opcionesTarjeta(decision({ options: [...decision().options].reverse() }));
  assert.equal(desordenada.at(-1)!.id, 'aprobar');
});

test('tarjeta recién aparecida: la opción con efecto no se activa al momento, ni con Enter, ni mientras escribe', () => {
  const op = { id: 'aprobar', conEfecto: true } as const;
  const sinEfecto = { id: 'posponer', conEfecto: false } as const;
  assert.equal(puedeActivar(op, { aparecio: T0, ahora: T0 + 100, via: 'toque' }), false, 'recién aparecida');
  assert.equal(puedeActivar(op, { aparecio: T0, ahora: T0 + ARMADO_MS + 1, via: 'toque' }), true);
  assert.equal(puedeActivar(op, { aparecio: T0, ahora: T0 + 60_000, via: 'enter' }), false, 'Enter nunca aprueba');
  assert.equal(puedeActivar(op, { aparecio: T0, ahora: T0 + 60_000, via: 'toque', escribioHace: 200 }), false, 'estaba escribiendo otra cosa');
  assert.equal(puedeActivar(sinEfecto, { aparecio: T0, ahora: T0 + 10, via: 'toque' }), true, 'posponer no tiene riesgo');
});

test('sin «Sí» genérico con varias tareas: el botón nombra la tarea', () => {
  const t = tarea({ id: 'a', title: 'Correo para Ana' });
  assert.equal(etiquetaBoton({ id: 'aprobar', label: 'Sí' }, t, true), 'Sí: Correo para Ana');
  assert.equal(etiquetaBoton({ id: 'aprobar', label: 'Aprobar' }, t, true), 'Aprobar: Correo para Ana');
  assert.equal(etiquetaBoton({ id: 'aprobar', label: 'Aprobar: Enviar este correo' }, t, true), 'Aprobar: Enviar este correo');
  assert.equal(etiquetaBoton({ id: 'aprobar', label: 'Sí' }, t, false), 'Sí');
});

test('errores recuperables: cada código 409 dice qué pasó y que no se ejecutó', () => {
  for (const c of ['decision-vieja', 'version', 'caducada', 'propuesta-cambiada', 'ya-decidida']) {
    const m = mensajeDeError(c);
    assert.ok(m.length > 10, c);
  }
  assert.match(mensajeDeError('caducada'), /no/i);
});

/* ------------------------------------------------------------------ el cliente y la respuesta del chat */

test('cliente: decide con decisionId + expectedVersion + opción exacta; un 409 vuelve con el snapshot actual', async () => {
  const llamadas: { ruta: string; cuerpo?: any }[] = [];
  const pedir = async (ruta: string, init?: { method?: string; body?: string }) => {
    llamadas.push({ ruta, cuerpo: init?.body ? JSON.parse(init.body) : undefined });
    if (ruta.split('?')[0].endsWith('/decisiones')) return { status: 409, json: { codigo: 'version', error: 'cambió', tarea: tarea({ id: 'a', version: 9 }) } };
    return { status: 200, json: { tareas: [tarea({ id: 'a' })], resumen: { trabajando: 1, decisiones: 0 } } };
  };
  const c = crearClienteTrabajos(pedir);
  const l = await c.listar();
  assert.equal(l.ok && l.tareas.length, 1);
  const t = tarea({ id: 'a', version: 4, decision: decision(), decisionId: 'dc_1' });
  const r = await c.decidir(t, 'aprobar');
  // Ronda 7: el cliente dice que conoce el estado «respondida» en cada petición.
  assert.deepEqual(llamadas.at(-1), { ruta: '/api/trabajos/a/decisiones?estados=respondida', cuerpo: { decisionId: 'dc_1', expectedVersion: 4, opcion: 'aprobar' } });
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.equal(r.codigo, 'version');
  assert.equal(r.tarea?.version, 9);
  await c.cancelar('a');
  assert.equal(llamadas.at(-1)!.ruta, '/api/trabajos/a/cancelar?estados=respondida');
});

test('cliente: 401 y 403 (sesión sin correo) son «sin dueño»: se vacía, no es un error de red', async () => {
  for (const status of [401, 403]) {
    const c = crearClienteTrabajos(async () => ({ status, json: { code: status === 403 ? 'sin_correo' : 'sesion_requerida' } }));
    const r = await c.listar();
    assert.equal(r.ok, false);
    if (r.ok) return;
    assert.equal(r.sinSesion, true, String(status));
  }
});

test('refsDeTurno: la respuesta del chat enlaza sus tareas; un servidor viejo no manda nada y no rompe', () => {
  assert.deepEqual(refsDeTurno({ reply: 'hola' }), []);
  assert.deepEqual(refsDeTurno({ tareas: 'basura' }), []);
  const r = refsDeTurno({ tareas: [{ id: 'tk_1', title: 'Correo para Ana', state: 'awaiting_approval', version: 1, updatedAt: '2026-10-03T15:00:00Z' }, { id: '' }] });
  assert.deepEqual(r.map((x) => x.id), ['tk_1']);
});

test('cliente (revisión 13): `conteo.recortadas` con su aviso en una lista COMPLETA no la vuelve parcial ni marca nada «sin confirmar»', async () => {
  const c = crearClienteTrabajos(async () => ({
    status: 200,
    json: { tareas: [tarea({ id: 'a' })], completo: true, conteo: { activas: 1, terminadas: 200, indice: 201, noLeidas: 0, recortadas: 5 }, aviso: 'Tu lista guarda solo tus 200 tareas terminadas más recientes: 5 terminadas más antiguas ya no salen aquí.' },
  }));
  const r = await c.listar();
  assert.ok(r.ok);
  if (!r.ok) return;
  assert.equal(r.completo, true, 'las recortadas no hacen la lista incompleta');
  // El reductor: completa manda (quita lo que ya no viene, sin «sin confirmar») y no muestra el aviso como fallo.
  let s = reducir(estadoInicial(), { tipo: 'lista', tareas: [tarea({ id: 'a' }), tarea({ id: 'vieja' })], en: T0 });
  s = reducir(s, { tipo: 'lista', tareas: r.tareas, en: T0 + 1, completo: r.completo, aviso: r.aviso });
  assert.deepEqual(s.orden, ['a']);
  assert.equal(s.porId.a.sinConfirmar, undefined);
  assert.equal(s.aviso, null);
});
