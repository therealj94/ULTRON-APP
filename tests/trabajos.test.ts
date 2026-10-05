/**
 * AUR08: la tarea durable (lib/tareas-durables.ts) y sus rutas y ganchos del chat (server/trabajos.ts).
 *
 * Lo que tiene que ser verdad (secciones 6, 8 y 17 del documento maestro):
 *   · crear es UNA vez por dueño + requestId, también entre dos «réplicas» sobre el mismo S3 condicional;
 *   · cada mutación de la persona lleva expectedVersion; conflicto → snapshot actual, sin escribir;
 *   · los terminales son monotónicos y `completed` exige evidencia de cada criterio obligatorio;
 *   · el cursor de eventos devuelve lo nuevo, y si quedó atrás pide resync con el snapshot;
 *   · las rutas sirven SOLO a la persona de la sesión (el cuerpo y la consulta no mandan);
 *   · una decisión vieja, de otra versión, caducada o con una opción no ofrecida NO ejecuta; aprobar
 *     ejecuta una sola vez aunque llegue dos veces (doble toque, reintento tras perder la respuesta);
 *   · pausar y cancelar son idempotentes; cancelar no borra lo ocurrido;
 *   · el chat crea la tarea ANTES de encargar a la computadora y la respuesta la enlaza; el «sí» del chat
 *     cierra la decisión del borrador; la tarea en curso y la computadora se adaptan sin lista paralela.
 */
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import type { AddressInfo } from 'node:net';
import { almacenEnMemoria, almacenS3, _usarAlmacenDurable, type AlmacenDurable } from '../lib/durable';
import {
  aplicarCambio,
  cambiarTarea,
  crearTarea,
  deTareaEnCurso,
  eventosDesde,
  leerTarea,
  registroNuevo,
  resumenTareas,
  transicionValida,
  validarDecision,
  vistaTarea,
  type MisionComputadoraMin,
  type TareaEnCursoMin,
} from '../lib/tareas-durables';
import {
  abrirDecisionDeBorrador,
  abrirEncargoComputadora,
  cerrarDecisionPorChat,
  cerrarEncargoComputadora,
  clasificarEnvio,
  enTurnoConTrabajos,
  montarRutasTrabajos,
  nuevoContextoTrabajos,
  type DepsTrabajos,
  type SalidaEnvio,
} from '../server/trabajos';
import { conS3Falso } from './s3-condicional-falso';
import { BLOQUEADA_VISIBLE_MS } from '../server/trabajos';
import { _olvidarEnPantalla, enPantallaDe, olvidarEnPantallaDeConversacion } from '../server/decision-en-pantalla';

const T0 = Date.parse('2026-10-03T15:00:00Z');
let n = 0;
const correo = () => `trab-${n++}@ejemplo.com`;

afterEach(() => _usarAlmacenDurable(null));

const nueva = (requestId: string, extra: Record<string, unknown> = {}) => ({
  requestId,
  titulo: 'Comparar tres opciones',
  objetivo: 'Recomendación con fuentes',
  entorno: { kind: 'chat' as const, id: 'telefono', displayName: 'Esta conversación' },
  origen: { kind: 'api' as const },
  criterios: [{ id: 'fuentes', texto: 'Cada opción con su fuente', obligatorio: true }],
  estado: 'running' as const,
  ...extra,
});

/* ------------------------------------------------------------------ la entidad */

test('crear es una vez por dueño + requestId; otro dueño con el mismo requestId es otra tarea', async () => {
  const a = almacenEnMemoria();
  const yo = correo();
  const r1 = await crearTarea(yo, nueva('pedido-1'), { almacen: a, ahora: T0 });
  const r2 = await crearTarea(yo, nueva('pedido-1', { titulo: 'Otro título' }), { almacen: a, ahora: T0 + 5 });
  assert.ok(r1.ok && r2.ok);
  if (!r1.ok || !r2.ok) return;
  assert.equal(r1.creada, true);
  assert.equal(r2.creada, false, 'el reintento no crea otra');
  assert.equal(r2.tarea.id, r1.tarea.id, 'reabrir recupera el mismo id');
  assert.equal(r2.tarea.titulo, 'Comparar tres opciones', 'el reintento ve el original');
  const otro = await crearTarea(correo(), nueva('pedido-1'), { almacen: a, ahora: T0 });
  assert.ok(otro.ok && otro.tarea.id !== r1.tarea.id);
  // Ningún correo en las claves.
  for (const k of a.objetos.keys()) assert.ok(!k.includes('@'), k);
});

test('dos «réplicas» sobre el mismo S3 condicional crean UNA tarea para el mismo pedido', async () => {
  await conS3Falso(async () => {
    const yo = correo();
    const [x, y] = await Promise.all([crearTarea(yo, nueva('pedido-replicas'), { almacen: almacenS3() }), crearTarea(yo, nueva('pedido-replicas'), { almacen: almacenS3() })]);
    assert.ok(x.ok && y.ok);
    if (!x.ok || !y.ok) return;
    assert.equal(x.tarea.id, y.tarea.id);
    assert.equal([x.creada, y.creada].filter(Boolean).length, 1);
  });
});

test('S3 caído al crear: ok:false (no se inventa una tarea local)', async () => {
  await conS3Falso(async (s3) => {
    s3.escribe.ok = false;
    const r = await crearTarea(correo(), nueva('pedido-caido'), { almacen: almacenS3() });
    assert.equal(r.ok, false);
  });
});

test('expectedVersion: conflicto devuelve el snapshot actual y no escribe', async () => {
  const a = almacenEnMemoria();
  const yo = correo();
  const c = await crearTarea(yo, nueva('v-1'), { almacen: a, ahora: T0 });
  assert.ok(c.ok);
  if (!c.ok) return;
  const ok = await cambiarTarea(yo, c.tarea.id, () => ({ pasoActual: 'Leyendo la primera fuente' }), { almacen: a, expectedVersion: 1, ahora: T0 + 1 });
  assert.ok(ok.ok && ok.tarea.version === 2);
  const viejo = await cambiarTarea(yo, c.tarea.id, () => ({ estado: 'paused' }), { almacen: a, expectedVersion: 1, ahora: T0 + 2 });
  assert.equal(viejo.ok, false);
  if (viejo.ok) return;
  assert.equal(viejo.motivo, 'version');
  assert.equal(viejo.tarea?.version, 2, 'vuelve lo que hay');
  const l = await leerTarea(yo, c.tarea.id, a);
  assert.ok(l.ok && l.tarea?.estado === 'running', 'no se pausó a ciegas');
});

test('terminales monotónicos; completed exige evidencia de cada criterio obligatorio', () => {
  const r = registroNuevo('tk_prueba1', nueva('m-1'), T0);
  assert.equal(transicionValida('completed', 'paused'), false);
  assert.equal(transicionValida('cancelled', 'running'), false);
  assert.equal(transicionValida('running', 'created'), false);
  const sin = aplicarCambio(r, { estado: 'completed' }, T0 + 1);
  assert.deepEqual(sin, { ok: false, motivo: 'sin-evidencia' }, 'la frase del modelo no completa nada');
  const con = aplicarCambio(r, { estado: 'completed', criterios: [{ ...r.criterios[0], estado: 'verified', evidencias: ['e1'] }] }, T0 + 1);
  assert.ok(con.ok && con.reg.estado === 'completed');
  if (!con.ok) return;
  assert.deepEqual(aplicarCambio(con.reg, { estado: 'paused' }, T0 + 2), { ok: false, motivo: 'terminal' }, 'un evento viejo no lo pausa');
  const cancelada = aplicarCambio(r, { estado: 'cancelled' }, T0 + 1);
  assert.ok(cancelada.ok);
  if (!cancelada.ok) return;
  assert.deepEqual(aplicarCambio(cancelada.reg, { estado: 'running', pasoActual: 'captura nueva' }, T0 + 3), { ok: false, motivo: 'terminal' }, 'una captura nueva no resucita una cancelada');
  const igual = aplicarCambio(cancelada.reg, { estado: 'cancelled' }, T0 + 4);
  assert.ok(igual.ok && !igual.cambiado, 'repetir el terminal es idempotente');
});

test('el latido no sube la versión; cada cambio guarda estado y evento en la misma escritura', () => {
  const r = registroNuevo('tk_prueba2', nueva('m-2'), T0);
  const l = aplicarCambio(r, { soloLatido: true }, T0 + 50);
  assert.ok(l.ok && l.reg.version === 1 && l.reg.latido === T0 + 50);
  const c = aplicarCambio(r, { estado: 'waiting_resource', pasoActual: 'Esperando la página' }, T0 + 60);
  assert.ok(c.ok);
  if (!c.ok) return;
  assert.equal(c.reg.version, 2);
  assert.deepEqual(
    c.reg.eventos.map((e) => [e.sequence, e.type, e.version]),
    [
      [1, 'task.created', 1],
      [2, 'task.state_changed', 2],
      [3, 'task.progressed', 2],
    ]
  );
});

test('cursor de eventos: lo nuevo desde el cursor; un cursor viejo o del futuro pide resync', () => {
  let r = registroNuevo('tk_prueba3', nueva('m-3'), T0);
  for (let i = 0; i < 70; i++) {
    const c = aplicarCambio(r, { pasoActual: `paso ${i}` }, T0 + i + 1);
    assert.ok(c.ok);
    if (c.ok) r = c.reg;
  }
  const ultimo = r.secuencia;
  const d = eventosDesde(r, ultimo - 2);
  assert.equal(d.resync, false);
  assert.deepEqual(d.eventos.map((e) => e.sequence), [ultimo - 1, ultimo]);
  assert.equal(eventosDesde(r, 1).resync, true, 'los eventos de antes ya se recortaron: snapshot');
  assert.equal(eventosDesde(r, ultimo + 5).resync, true);
  assert.equal(eventosDesde(r, ultimo).eventos.length, 0, 'nada nuevo, sin resync');
});

test('validarDecision: vieja, otra versión, opción no ofrecida y caducada no ejecutan; repetida no repite', () => {
  const dec = {
    id: 'dc_1',
    tipo: 'aprobar-accion' as const,
    pregunta: '¿Envío?',
    porque: 'Sale a otra persona',
    propuesta: { accion: 'Enviar correo', destinatario: 'ana@ejemplo.com', datos: [], alcance: 'Solo este correo' },
    opciones: [
      { id: 'rechazar' as const, etiqueta: 'Rechazar', efecto: 'Nada sale', riesgo: 'sin-efecto' as const },
      { id: 'aprobar' as const, etiqueta: 'Aprobar', efecto: 'Envía', riesgo: 'efecto' as const },
    ],
    creada: T0,
    caduca: T0 + 60_000,
    planVersion: 1,
  };
  const r = registroNuevo('tk_prueba4', nueva('m-4', { estado: 'awaiting_approval', decision: dec }), T0);
  assert.equal(validarDecision(r, { decisionId: 'dc_0', expectedVersion: 1, opcion: 'aprobar' }, T0).ok, false);
  assert.equal((validarDecision(r, { decisionId: 'dc_1', expectedVersion: 7, opcion: 'aprobar' }, T0) as any).codigo, 'version');
  assert.equal((validarDecision(r, { decisionId: 'dc_1', expectedVersion: 1, opcion: 'sí' }, T0) as any).codigo, 'opcion', 'sin «Sí» genérico');
  assert.equal((validarDecision(r, { decisionId: 'dc_1', expectedVersion: 1, opcion: 'aprobar' }, T0 + 61_000) as any).codigo, 'caducada');
  assert.equal(validarDecision(r, { decisionId: 'dc_1', expectedVersion: 1, opcion: 'rechazar' }, T0 + 61_000).ok, true, 'rechazar una caducada sí');
  const ok = validarDecision(r, { decisionId: 'dc_1', expectedVersion: 1, opcion: 'aprobar' }, T0);
  assert.ok(ok.ok && 'opcion' in ok && ok.opcion.id === 'aprobar');
  const resuelto = aplicarCambio(r, { resolver: { id: 'dc_1', opcion: 'aprobar', t: T0 }, decision: null, estado: 'running' }, T0);
  assert.ok(resuelto.ok);
  if (!resuelto.ok) return;
  const rep = validarDecision(resuelto.reg, { decisionId: 'dc_1', expectedVersion: 1, opcion: 'aprobar' }, T0 + 5);
  assert.ok(rep.ok && 'repetida' in rep, 'la misma decisión otra vez: repetida, sin efecto nuevo');
  assert.equal((validarDecision(resuelto.reg, { decisionId: 'dc_1', expectedVersion: 2, opcion: 'rechazar' }, T0 + 5) as any).codigo, 'ya-decidida');
});

test('resumen del indicador: trabajando, decisiones; pausada, pospuesta y terminal no cuentan; bloqueada pide decisión', () => {
  const base = { terminal: false, decision: null };
  const dec = (o: Record<string, unknown> = {}) => ({ id: 'd', kind: 'aprobar-accion', question: '', why: '', proposal: { action: '', data: [], scope: '' }, options: [], createdAt: '', expired: false, postponed: false, ...o }) as any;
  const r = resumenTareas([
    { ...base, state: 'running' },
    { ...base, state: 'reconciling' },
    { ...base, state: 'paused' },
    { ...base, state: 'awaiting_approval', decision: dec() },
    { ...base, state: 'awaiting_approval', decision: dec({ postponed: true }) },
    { ...base, state: 'blocked' },
    { terminal: true, state: 'completed', decision: null },
  ]);
  assert.deepEqual(r, { trabajando: 2, decisiones: 2 });
});

test('adaptador de la tarea en curso: mismo id, progreso con denominador real y decisión con tres respuestas', () => {
  const t: TareaEnCursoMin = {
    id: 'tc_abc',
    ambito: 'telefono',
    tipo: 'correo',
    titulo: 'revisar los 5 correos sin leer',
    pasos: [
      { etiqueta: 'Ana', estado: 'hecho' },
      { etiqueta: 'Beto', estado: 'hecho' },
      { etiqueta: 'Caro', estado: 'saltado' },
      { etiqueta: 'Dani', estado: 'pendiente' },
      { etiqueta: 'Eva', estado: 'pendiente' },
    ],
    actual: 2,
    estado: 'preguntando',
    creado: T0,
    actualizado: T0 + 10,
    pedidoNuevo: 'busca vuelos',
  };
  const s = deTareaEnCurso(t);
  assert.equal(s.id, 'tc_abc');
  assert.equal(s.version, T0 + 10);
  assert.deepEqual(s.progress, { done: 3, total: 5, unit: 'pasos' });
  assert.equal(s.state, 'awaiting_approval');
  assert.deepEqual(s.decision?.options.map((o) => o.id), ['posponer', 'elegir:seguir', 'rechazar']);
  assert.match(s.currentStep || '', /Dani/);
  assert.equal(deTareaEnCurso({ ...t, estado: 'pausada' }).state, 'paused');
  // Todos los pasos marcados no es evidencia: nunca «verified» sin evidencias (bloqueo 3, revisión del 4-oct).
  const todos = deTareaEnCurso({ ...t, pasos: t.pasos.map((p) => ({ ...p, estado: 'hecho' as const })) });
  assert.ok(todos.acceptance.every((c) => c.status !== 'verified' || c.evidenceIds.length > 0));
});

test('la tarea en curso ACTIVA espera a la persona: no es trabajo de fondo («Trabajando» con spinner era mentira; José, 5-oct)', () => {
  // Lo que vio José: «EN MARCHA · revisar los 12 correos sin leer · Trabajando · última señal hace 2 min» y nada pasaba.
  // La tarea en curso avanza solo cuando la persona habla: es una espera suya, no algo que AURA hace por detrás.
  const t: TareaEnCursoMin = {
    id: 'tc_12',
    ambito: 'mesa',
    tipo: 'correo',
    titulo: 'revisar los 12 correos sin leer',
    pasos: [{ etiqueta: 'Ana — «Reunión»', estado: 'hecho' }, { etiqueta: 'Beto — «Planos»', estado: 'pendiente' }, { etiqueta: 'Caro — «Fotos»', estado: 'pendiente' }],
    actual: 0,
    estado: 'activa',
    creado: T0,
    actualizado: T0 + 10,
  };
  const s = deTareaEnCurso(t);
  assert.notEqual(s.state, 'running', 'no «Trabajando»');
  assert.equal(s.state, 'awaiting_approval', 'un estado de espera que ya existe (no se inventa otro)');
  assert.equal(s.awaitingInput, true, 'espera que la persona siga, no una decisión');
  assert.equal(s.decision, null, 'sin tarjeta de decisión');
  assert.equal(s.lastHeartbeatAt, undefined, 'sin «última señal»: no hay nada trabajando por detrás');
  assert.match(s.currentStep || '', /^Espera que sigas: dime «sigue» o «el siguiente»/);
  assert.match(s.currentStep || '', /Beto — «Planos»/, 'dice cuál toca');
  assert.deepEqual(s.controls, { pause: true, resume: false, cancel: true }, 'Pausar y Cancelar siguen');
  assert.deepEqual(resumenTareas([s], T0), { trabajando: 0, decisiones: 0 }, 'el indicador no dice «Trabajando · 1»');
  // En pausa: sigue en pausa (Reanudar), y tampoco es una espera de la persona.
  const p = deTareaEnCurso({ ...t, estado: 'pausada' });
  assert.equal(p.state, 'paused');
  assert.equal(p.awaitingInput, undefined);
  assert.deepEqual(p.controls, { pause: false, resume: true, cancel: true });
  // Preguntando: la decisión de siempre (no cambia).
  const q = deTareaEnCurso({ ...t, estado: 'preguntando', pedidoNuevo: 'busca vuelos' });
  assert.equal(q.state, 'awaiting_approval');
  assert.ok(q.decision);
  assert.equal(q.awaitingInput, undefined);
});

test('la tarea en curso que espera a la persona: Pausar y Cancelar siguen llegando a la tarea en curso', async () => {
  _usarAlmacenDurable(almacenEnMemoria());
  const yo = correo();
  const tc: TareaEnCursoMin = {
    id: 'tc_espera',
    ambito: 'mesa',
    tipo: 'correo',
    titulo: 'revisar los 3 correos sin leer',
    pasos: [{ etiqueta: 'Ana', estado: 'pendiente' }, { etiqueta: 'Beto', estado: 'pendiente' }, { etiqueta: 'Caro', estado: 'pendiente' }],
    actual: 0,
    estado: 'activa',
    creado: T0,
    actualizado: T0 + 5,
  };
  const h = arnes({ tc: [tc] });
  try {
    const l = (await h.pedir('/api/trabajos', yo)).json;
    assert.equal(l.tareas[0].state, 'awaiting_approval');
    assert.equal(l.tareas[0].awaitingInput, true);
    assert.deepEqual(l.resumen, { trabajando: 0, decisiones: 0 });
    const p = await h.pedir('/api/trabajos/tc_espera/pausar', yo, {});
    assert.equal(p.status, 200);
    assert.equal(p.json.tarea.state, 'paused');
    const c = await h.pedir('/api/trabajos/tc_espera/cancelar', yo, {});
    assert.equal(c.status, 200);
    assert.deepEqual(h.ll.accionesTc, ['tc_espera:pausar', 'tc_espera:descartar']);
  } finally {
    h.cerrar();
  }
});

/* ------------------------------------------------------------------ rutas */

type Llamadas = { enviar: number; descartar: number; accionesTc: string[]; pausarPc: string[]; pararPc: string[]; huellas: string[] };

function arnes(o: { salida?: SalidaEnvio; tc?: TareaEnCursoMin[]; misiones?: MisionComputadoraMin[]; vigente?: (canal: string, ambito: string, intento?: string) => string | null; huellaVigente?: () => string | undefined; ahora?: () => number; pausarPc?: () => Promise<unknown>; pararPc?: () => Promise<unknown>; reanudarPc?: () => Promise<unknown>; editar?: NonNullable<DepsTrabajos['borradores']>['editar'] } = {}) {
  const ll: Llamadas = { enviar: 0, descartar: 0, accionesTc: [], pausarPc: [], pararPc: [], huellas: [] };
  const pasa = ((_q: express.Request, _s: express.Response, nx: express.NextFunction) => nx()) as express.RequestHandler;
  const deps: DepsTrabajos = {
    exigirMesa: pasa,
    limitar: () => pasa,
    sesionDe: (req) => (req.headers['x-quien'] ? { correo: String(req.headers['x-quien']) } : null),
    reloj: o.ahora,
    tareaEnCurso: {
      listar: () => o.tc || [],
      accion: (_c, id, accion, version) => {
        const t = (o.tc || []).find((x) => x.id === id);
        if (!t) return { ok: false, motivo: 'no-existe' };
        if (version !== undefined && version !== t.actualizado) return { ok: false, motivo: 'version', tarea: t };
        ll.accionesTc.push(`${id}:${accion}`);
        return { ok: true, tarea: { ...t, estado: accion === 'pausar' ? 'pausada' : 'activa', actualizado: t.actualizado + 1 } };
      },
    },
    computadora: {
      misiones: () => o.misiones || [],
      pausar: async (_c, id) => {
        ll.pausarPc.push(id);
        return o.pausarPc ? o.pausarPc() : undefined;
      },
      parar: async (_c, id) => {
        ll.pararPc.push(id);
        return o.pararPc ? o.pararPc() : undefined;
      },
      reanudar: async () => (o.reanudarPc ? o.reanudarPc() : undefined),
    },
    borradores: {
      vigente: (_c, canal, ambito, intento) => {
        const i = o.vigente ? o.vigente(canal, ambito, intento) : 'int-1';
        // Como los borradores de verdad, el que espera dice su huella (la del fixture: `h-<intento>`). Sin huella, el
        // panel no aprueba nada (permisos exactos, 4-oct).
        const huella = o.huellaVigente ? o.huellaVigente() : i ? `h-${i}` : undefined;
        return i ? { intento: i, ...(huella !== undefined ? { huella } : {}) } : null;
      },
      enviar: async (_c, _canal, _ambito, _intento, huella) => {
        ll.enviar++;
        ll.huellas.push(huella);
        await new Promise((r) => setTimeout(r, 15));
        return o.salida || { estado: 'succeeded', resumen: 'CORREO ENVIADO desde yo@ejemplo.com a ana@ejemplo.com — «Fechas».' };
      },
      descartar: async () => void ll.descartar++,
      ...(o.editar ? { editar: o.editar } : {}),
    },
  };
  const app = express();
  app.use(express.json());
  montarRutasTrabajos(app, deps);
  const srv = app.listen(0, '127.0.0.1');
  const listo = new Promise((r) => srv.once('listening', r));
  const base = () => `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
  const pedir = async (ruta: string, quien: string | null, cuerpo?: unknown) => {
    await listo;
    const r = await fetch(`${base()}${ruta}`, { method: cuerpo ? 'POST' : 'GET', headers: { 'content-type': 'application/json', ...(quien ? { 'x-quien': quien } : {}) }, body: cuerpo ? JSON.stringify(cuerpo) : undefined });
    return { status: r.status, json: (await r.json()) as any };
  };
  return { ll, pedir, cerrar: () => srv.close() };
}

const borrador = (intento = 'int-1', vence = Date.now() + 15 * 60_000) => ({ canal: 'correo' as const, intento, para: ['ana@ejemplo.com'], desde: 'yo@ejemplo.com', asunto: 'Fechas de la reunión', texto: 'Hola Ana, ¿martes o jueves?', vence, huella: `h-${intento}` });

test('rutas: sin sesión 401; la persona sale de la sesión; otro no ve ni toca mis tareas', async () => {
  _usarAlmacenDurable(almacenEnMemoria());
  const yo = correo();
  const otro = correo();
  const h = arnes();
  try {
    const ref = await abrirDecisionDeBorrador(yo, 'telefono', borrador());
    assert.ok(ref);
    assert.equal((await h.pedir('/api/trabajos', null)).status, 401);
    assert.equal((await h.pedir('/api/trabajos', 'junta-sin-correo')).status, 403, 'sesión sin correo: 403 (la app no reintenta renovar)');
    const mias = await h.pedir(`/api/trabajos?correo=${encodeURIComponent(otro)}`, yo);
    assert.equal(mias.status, 200);
    assert.equal(mias.json.tareas.length, 1, 'la consulta no cambia de quién son');
    assert.deepEqual(mias.json.resumen, { trabajando: 0, decisiones: 1 });
    assert.equal((await h.pedir('/api/trabajos', otro)).json.tareas.length, 0);
    assert.equal((await h.pedir(`/api/trabajos/${ref!.id}`, otro)).status, 404);
    const t = (await h.pedir(`/api/trabajos/${ref!.id}`, yo)).json.tarea;
    assert.equal((await h.pedir(`/api/trabajos/${ref!.id}/decisiones`, otro, { decisionId: t.decisionId, expectedVersion: t.version, opcion: 'aprobar', correo: yo })).status, 404, 'el correo del cuerpo no es autoridad');
    assert.equal((await h.pedir(`/api/trabajos/${ref!.id}/cancelar`, otro, {})).status, 404);
    assert.equal(h.ll.enviar, 0);
  } finally {
    h.cerrar();
  }
});

test('la tarjeta de decisión dice qué, a quién, con qué datos, alcance, caducidad y efecto; aprobar no va primero', async () => {
  _usarAlmacenDurable(almacenEnMemoria());
  const yo = correo();
  const h = arnes();
  try {
    const ref = await abrirDecisionDeBorrador(yo, 'telefono', borrador());
    const t = (await h.pedir(`/api/trabajos/${ref!.id}`, yo)).json.tarea;
    assert.equal(t.state, 'awaiting_approval');
    assert.equal(t.decision.proposal.recipient, 'ana@ejemplo.com');
    assert.equal(t.decision.proposal.account, 'yo@ejemplo.com');
    assert.ok(t.decision.proposal.data.some((d: string) => d.includes('Fechas de la reunión')));
    assert.ok(t.decision.proposal.scope);
    assert.ok(t.decision.expiresAt);
    assert.ok(t.decision.options.every((o: any) => o.effect && o.label));
    assert.notEqual(t.decision.options[0].id, 'aprobar', 'la opción de riesgo no va primera');
    assert.ok(!t.decision.options.some((o: any) => /^s[ií]$/i.test(o.label)), 'sin «Sí» genérico');
    assert.equal(t.decision.vinculo, undefined, 'el vínculo interno no sale');
    // Idempotente por intento: el mismo borrador no abre otra tarea.
    const otra = await abrirDecisionDeBorrador(yo, 'telefono', borrador());
    assert.equal(otra!.id, ref!.id);
  } finally {
    h.cerrar();
  }
});

test('decidir: vieja/otra versión no ejecutan; aprobar ejecuta UNA vez aunque llegue dos veces a la vez', async () => {
  _usarAlmacenDurable(almacenEnMemoria());
  const yo = correo();
  const h = arnes();
  try {
    const ref = await abrirDecisionDeBorrador(yo, 'telefono', borrador());
    const t = (await h.pedir(`/api/trabajos/${ref!.id}`, yo)).json.tarea;
    const vieja = await h.pedir(`/api/trabajos/${t.id}/decisiones`, yo, { decisionId: 'dc_viejo', expectedVersion: t.version, opcion: 'aprobar' });
    assert.equal(vieja.status, 409);
    assert.equal(vieja.json.codigo, 'decision-vieja');
    assert.equal(vieja.json.tarea.id, t.id, 'vuelve el snapshot actual');
    const otraVersion = await h.pedir(`/api/trabajos/${t.id}/decisiones`, yo, { decisionId: t.decisionId, expectedVersion: t.version - 1, opcion: 'aprobar' });
    assert.equal(otraVersion.status, 409);
    assert.equal((await h.pedir(`/api/trabajos/${t.id}/decisiones`, yo, { decisionId: t.decisionId, expectedVersion: t.version, opcion: 'si' })).status, 400);
    assert.equal(h.ll.enviar, 0, 'nada se envió');
    const cuerpo = { decisionId: t.decisionId, expectedVersion: t.version, opcion: 'aprobar' };
    const [x, y] = await Promise.all([h.pedir(`/api/trabajos/${t.id}/decisiones`, yo, cuerpo), h.pedir(`/api/trabajos/${t.id}/decisiones`, yo, cuerpo)]);
    assert.deepEqual([x.status, y.status].sort(), [200, 200]);
    assert.equal(h.ll.enviar, 1, 'un único efecto autorizado');
    const fin = (await h.pedir(`/api/trabajos/${t.id}`, yo)).json.tarea;
    assert.equal(fin.state, 'completed');
    assert.equal(fin.terminal, true);
    assert.ok(fin.result.evidence.length >= 1, 'el resultado trae su evidencia');
    assert.equal(fin.acceptance[0].status, 'verified');
    // Se perdió la respuesta y la app reintenta: misma respuesta, sin otro envío.
    const rep = await h.pedir(`/api/trabajos/${t.id}/decisiones`, yo, cuerpo);
    assert.equal(rep.status, 200);
    assert.equal(rep.json.repetida, true);
    assert.equal(h.ll.enviar, 1);
  } finally {
    h.cerrar();
  }
});

test('decidir: el borrador cambió (otro intento) → error recuperable, sin envío; caducada → 409 y bloqueada', async () => {
  _usarAlmacenDurable(almacenEnMemoria());
  const yo = correo();
  let vigente: string | null = 'int-1';
  const h = arnes({ vigente: () => vigente });
  try {
    const ref = await abrirDecisionDeBorrador(yo, 'telefono', borrador('int-1'));
    let t = (await h.pedir(`/api/trabajos/${ref!.id}`, yo)).json.tarea;
    vigente = 'int-2';
    const cambio = await h.pedir(`/api/trabajos/${t.id}/decisiones`, yo, { decisionId: t.decisionId, expectedVersion: t.version, opcion: 'aprobar' });
    assert.equal(cambio.status, 409);
    assert.equal(cambio.json.codigo, 'propuesta-cambiada');
    assert.equal(h.ll.enviar, 0, 'una aprobación de otra propuesta no ejecuta la nueva');

    const ref2 = await abrirDecisionDeBorrador(yo, 'web', borrador('int-9', Date.now() - 1000));
    vigente = 'int-9';
    t = (await h.pedir(`/api/trabajos/${ref2!.id}`, yo)).json.tarea;
    assert.equal(t.state, 'blocked', 'caducada: bloqueada, sin spinner');
    assert.equal(t.decision.expired, true);
    assert.ok(!t.decision.options.some((o: any) => o.id === 'aprobar'), 'ya no se puede aprobar');
    const tarde = await h.pedir(`/api/trabajos/${t.id}/decisiones`, yo, { decisionId: t.decisionId, expectedVersion: t.version, opcion: 'aprobar' });
    assert.equal(tarde.status, 409);
    assert.equal(h.ll.enviar, 0);
  } finally {
    h.cerrar();
  }
});

test('decidir (revisión 4-oct): aprobar va atado a la huella del borrador que mostró la tarjeta; mismo intento con otro destino → 409, sin envío', async () => {
  _usarAlmacenDurable(almacenEnMemoria());
  const yo = correo();
  let huella: string | undefined = 'huella-ana';
  let intento = 'int-1';
  const h = arnes({ vigente: () => intento, huellaVigente: () => huella });
  try {
    const ref = await abrirDecisionDeBorrador(yo, 'telefono', { ...borrador('int-1'), huella: 'huella-ana' });
    const t = (await h.pedir(`/api/trabajos/${ref!.id}`, yo)).json.tarea;
    // El mismo intento, pero lo que espera ahora va a Bruno (otra huella): la aprobación de Ana no lo manda.
    huella = 'huella-bruno';
    const r = await h.pedir(`/api/trabajos/${t.id}/decisiones`, yo, { decisionId: t.decisionId, expectedVersion: t.version, opcion: 'aprobar' });
    assert.equal(r.status, 409);
    assert.equal(r.json.codigo, 'propuesta-cambiada');
    assert.equal(h.ll.enviar, 0, 'aprobé para Ana: nada sale para Bruno');
    assert.equal((await h.pedir(`/api/trabajos/${t.id}`, yo)).json.tarea.state, 'blocked', 'la tarjeta de Ana ya no se puede aprobar');
    // Lo legítimo: el borrador que espera es el de la tarjeta; al enviar se pasa la huella que se aprobó.
    huella = 'huella-ana2';
    intento = 'int-2';
    const ref2 = await abrirDecisionDeBorrador(yo, 'web', { ...borrador('int-2'), huella: 'huella-ana2' });
    const t2 = (await h.pedir(`/api/trabajos/${ref2!.id}`, yo)).json.tarea;
    const ok = await h.pedir(`/api/trabajos/${t2.id}/decisiones`, yo, { decisionId: t2.decisionId, expectedVersion: t2.version, opcion: 'aprobar' });
    assert.equal(ok.status, 200);
    assert.deepEqual(h.ll.huellas, ['huella-ana2'], 'enviar recibe la huella aprobada (server.ts la compara con la del borrador)');
  } finally {
    h.cerrar();
  }
});

test('decidir (revisión 4-oct, ya seguro: evidencia): aprobar la versión 1 del plan (Ana) no ejecuta la versión 2 (Bruno) de la misma tarea', async () => {
  _usarAlmacenDurable(almacenEnMemoria());
  const yo = correo();
  let intento = 'int-ana';
  const h = arnes({ vigente: () => intento });
  try {
    const a = await abrirDecisionDeBorrador(yo, 'telefono', { ...borrador('int-ana'), huella: 'h-ana' });
    const v1 = (await h.pedir(`/api/trabajos/${a!.id}`, yo)).json.tarea;
    assert.equal(v1.decision.proposal.recipient, 'ana@ejemplo.com');
    const ed = await h.pedir(`/api/trabajos/${v1.id}/decisiones`, yo, { decisionId: v1.decisionId, expectedVersion: v1.version, opcion: 'editar' });
    assert.equal(ed.status, 200);
    // La propuesta nueva (versión 2 del plan) va a Bruno, en la MISMA tarea.
    intento = 'int-bruno';
    await abrirDecisionDeBorrador(yo, 'telefono', { ...borrador('int-bruno'), para: ['bruno@ejemplo.com'], huella: 'h-bruno' });
    const v2 = (await h.pedir(`/api/trabajos/${a!.id}`, yo)).json.tarea;
    assert.equal(v2.planVersion, 2);
    assert.equal(v2.decision.proposal.recipient, 'bruno@ejemplo.com');
    // Un «Aprobar» con lo que vio de la versión 1 (otra decisión, otra versión): no ejecuta la de Bruno.
    for (const viejo of [
      { decisionId: v1.decisionId, expectedVersion: v1.version },
      { decisionId: v1.decisionId, expectedVersion: v2.version },
      { decisionId: v2.decisionId, expectedVersion: v1.version },
    ]) {
      const r = await h.pedir(`/api/trabajos/${v2.id}/decisiones`, yo, { ...viejo, opcion: 'aprobar' });
      assert.equal(r.status, 409, JSON.stringify(viejo));
    }
    assert.equal(h.ll.enviar, 0, 'aprobé el plan de Ana: nada sale para Bruno');
  } finally {
    h.cerrar();
  }
});

test('decidir: proveedor incierto → reconciling «No he podido confirmar el envío», conserva la operación', async () => {
  _usarAlmacenDurable(almacenEnMemoria());
  const yo = correo();
  const h = arnes({ salida: { estado: 'unknown', resumen: 'El servidor de correo no contestó.' } });
  try {
    const ref = await abrirDecisionDeBorrador(yo, 'telefono', borrador());
    const t = (await h.pedir(`/api/trabajos/${ref!.id}`, yo)).json.tarea;
    const r = await h.pedir(`/api/trabajos/${t.id}/decisiones`, yo, { decisionId: t.decisionId, expectedVersion: t.version, opcion: 'aprobar' });
    assert.equal(r.status, 200);
    assert.equal(r.json.tarea.state, 'reconciling');
    assert.match(r.json.tarea.currentStep, /No he podido confirmar el envío/);
    assert.ok(r.json.operacion, 'el operationId vuelve para reconciliar');
  } finally {
    h.cerrar();
  }
});

test('rechazar, editar y posponer no envían; rechazar cierra con constancia; editar invalida el vínculo', async () => {
  _usarAlmacenDurable(almacenEnMemoria());
  const yo = correo();
  const h = arnes();
  try {
    const a = await abrirDecisionDeBorrador(yo, 'telefono', borrador('int-1'));
    let t = (await h.pedir(`/api/trabajos/${a!.id}`, yo)).json.tarea;
    const pos = await h.pedir(`/api/trabajos/${t.id}/decisiones`, yo, { decisionId: t.decisionId, expectedVersion: t.version, opcion: 'posponer' });
    assert.equal(pos.status, 200);
    assert.equal(pos.json.tarea.state, 'awaiting_approval');
    assert.equal(pos.json.tarea.decision.postponed, true, 'conserva la espera; no aprueba');
    t = pos.json.tarea;
    const ed = await h.pedir(`/api/trabajos/${t.id}/decisiones`, yo, { decisionId: t.decisionId, expectedVersion: t.version, opcion: 'editar' });
    assert.equal(ed.status, 200);
    assert.equal(ed.json.tarea.state, 'waiting_resource');
    assert.equal(ed.json.tarea.decision, null);
    assert.ok(ed.json.sugerencia, 'la app propone el texto para el chat');
    assert.equal(h.ll.descartar, 1, 'el borrador viejo se descarta: un «sí» en el chat ya no lo manda');
    // La nueva propuesta (otro intento) vuelve a la MISMA tarea con otro plan.
    const b = await abrirDecisionDeBorrador(yo, 'telefono', borrador('int-2'));
    assert.equal(b!.id, a!.id);
    t = (await h.pedir(`/api/trabajos/${a!.id}`, yo)).json.tarea;
    assert.equal(t.planVersion, 2);
    assert.notEqual(t.decisionId, ed.json.tarea.decisionId);
    const re = await h.pedir(`/api/trabajos/${t.id}/decisiones`, yo, { decisionId: t.decisionId, expectedVersion: t.version, opcion: 'rechazar' });
    assert.equal(re.json.tarea.state, 'cancelled');
    assert.match(re.json.tarea.result.summary, /No se envió/);
    assert.equal(h.ll.enviar, 0);
  } finally {
    h.cerrar();
  }
});

test('pausar y cancelar son idempotentes; cancelar una terminada no cambia nada', async () => {
  _usarAlmacenDurable(almacenEnMemoria());
  const yo = correo();
  const h = arnes();
  try {
    const c = await crearTarea(yo, nueva('p-1'));
    assert.ok(c.ok);
    if (!c.ok) return;
    const id = c.tarea.id;
    const p1 = await h.pedir(`/api/trabajos/${id}/pausar`, yo, {});
    const p2 = await h.pedir(`/api/trabajos/${id}/pausar`, yo, {});
    assert.equal(p1.json.tarea.state, 'paused');
    assert.equal(p2.json.tarea.state, 'paused');
    assert.equal(p2.json.tarea.version, p1.json.tarea.version, 'la segunda no cambia nada');
    const re = await h.pedir(`/api/trabajos/${id}/reanudar`, yo, {});
    assert.equal(re.json.tarea.state, 'running', 'vuelve a donde estaba');
    const x1 = await h.pedir(`/api/trabajos/${id}/cancelar`, yo, {});
    const x2 = await h.pedir(`/api/trabajos/${id}/cancelar`, yo, {});
    assert.equal(x1.json.tarea.state, 'cancelled');
    assert.equal(x2.status, 200);
    assert.equal(x2.json.tarea.version, x1.json.tarea.version);
    assert.equal((await h.pedir(`/api/trabajos/${id}/pausar`, yo, {})).json.tarea.state, 'cancelled', 'pausar una cancelada no la resucita');
    // Eventos con cursor: desde 0, todos; desde el último, ninguno.
    const ev = (await h.pedir(`/api/trabajos/${id}/eventos?desde=0`, yo)).json;
    assert.ok(ev.eventos.length >= 4);
    const ev2 = (await h.pedir(`/api/trabajos/${id}/eventos?desde=${ev.cursor}`, yo)).json;
    assert.equal(ev2.eventos.length, 0);
    assert.equal(ev2.resync, false);
  } finally {
    h.cerrar();
  }
});

test('crear por la API: idempotente por requestId de la sesión; reabrir recupera el mismo id', async () => {
  _usarAlmacenDurable(almacenEnMemoria());
  const yo = correo();
  const h = arnes();
  try {
    const cuerpo = { requestId: 'req-api-00001', titulo: 'Comparar tres opciones', objetivo: 'Con fuentes' };
    const a = await h.pedir('/api/trabajos', yo, cuerpo);
    const b = await h.pedir('/api/trabajos', yo, cuerpo);
    assert.equal(a.status, 201);
    assert.equal(b.status, 200);
    assert.equal(a.json.tarea.id, b.json.tarea.id);
    assert.equal((await h.pedir('/api/trabajos', yo, { titulo: 'sin id' })).status, 400);
  } finally {
    h.cerrar();
  }
});

test('la tarea en curso: sale en la lista con su id; su decisión exige la opción exacta y su versión', async () => {
  _usarAlmacenDurable(almacenEnMemoria());
  const yo = correo();
  const tc: TareaEnCursoMin = {
    id: 'tc_123',
    ambito: 'telefono',
    tipo: 'correo',
    titulo: 'revisar 3 correos',
    pasos: [
      { etiqueta: 'Ana', estado: 'hecho' },
      { etiqueta: 'Beto', estado: 'pendiente' },
      { etiqueta: 'Caro', estado: 'pendiente' },
    ],
    actual: 0,
    estado: 'preguntando',
    creado: T0,
    actualizado: T0 + 5,
  };
  const h = arnes({ tc: [tc] });
  try {
    const l = (await h.pedir('/api/trabajos', yo)).json;
    assert.equal(l.tareas[0].id, 'tc_123');
    assert.equal(l.resumen.decisiones, 1);
    const t = (await h.pedir('/api/trabajos/tc_123', yo)).json.tarea;
    assert.equal((await h.pedir('/api/trabajos/tc_123/decisiones', yo, { decisionId: t.decisionId, expectedVersion: t.version - 1, opcion: 'posponer' })).status, 409);
    assert.equal((await h.pedir('/api/trabajos/tc_123/decisiones', yo, { decisionId: t.decisionId, expectedVersion: t.version, opcion: 'aprobar' })).status, 400, 'no se ofreció «aprobar»');
    const ok = await h.pedir('/api/trabajos/tc_123/decisiones', yo, { decisionId: t.decisionId, expectedVersion: t.version, opcion: 'elegir:seguir' });
    assert.equal(ok.status, 200);
    assert.deepEqual(h.ll.accionesTc, ['tc_123:seguir']);
  } finally {
    h.cerrar();
  }
});

/* ------------------------------------------------------------------ el chat */

test('el chat crea la tarea ANTES de encargar a la computadora, la enlaza en la respuesta y se reconcilia con la misión', async () => {
  _usarAlmacenDurable(almacenEnMemoria());
  const yo = correo();
  const ctx = nuevoContextoTrabajos('turno-abc-123');
  let ref: Awaited<ReturnType<typeof abrirEncargoComputadora>> = null;
  await enTurnoConTrabajos(ctx, async () => {
    ref = await abrirEncargoComputadora(yo, 'telefono', 'Abre tres tiendas y compara el precio del panel solar');
    // Antes de encargar ya existe, en marcha.
    assert.ok(ref);
    assert.equal(ref!.state, 'running');
    await cerrarEncargoComputadora(yo, ref, { misionId: 'mis_1', estado: 'unknown' });
  });
  assert.deepEqual(ctx.refs.map((r) => r.id), [ref!.id], 'la respuesta del turno la enlaza');
  // El mismo turno (reintento) no crea otra.
  const ctx2 = nuevoContextoTrabajos('turno-abc-123');
  const otra = await enTurnoConTrabajos(ctx2, () => abrirEncargoComputadora(yo, 'telefono', 'Abre tres tiendas y compara el precio del panel solar'));
  assert.equal(otra!.id, ref!.id);

  const mision: MisionComputadoraMin = {
    id: 'mis_1',
    tareaId: 'mis_1',
    instruccion: 'Abre tres tiendas…',
    estado: 'trabajando',
    ok: null,
    inicio: T0,
    segundos: 30,
    resultado: null,
    plan: [
      { texto: 'Abrir tienda 1', estado: 'hecho' },
      { texto: 'Abrir tienda 2', estado: 'actual' },
      { texto: 'Abrir tienda 3', estado: 'pendiente' },
    ],
  };
  const h = arnes({ misiones: [mision] });
  try {
    let l = (await h.pedir('/api/trabajos', yo)).json;
    assert.equal(l.tareas.length, 1, 'la misión enlazada no sale aparte');
    assert.equal(l.tareas[0].id, ref!.id);
    assert.deepEqual(l.tareas[0].progress, { done: 1, total: 3, unit: 'pasos del plan' });
    assert.equal(l.tareas[0].currentStep, 'Abrir tienda 2');
    assert.equal(l.tareas[0].controls.open, 'computadora');
    // Pausar la durable pausa la computadora; cancelar la para.
    await h.pedir(`/api/trabajos/${ref!.id}/cancelar`, yo, {});
    assert.deepEqual(h.ll.pararPc, ['mis_1']);
  } finally {
    h.cerrar();
  }
  // Otra tarea: la misión terminó con evidencia → completed; sin evidencia → partial.
  const r2 = await abrirEncargoComputadora(yo, 'web', 'Busca el horario del banco');
  await cerrarEncargoComputadora(yo, r2, { misionId: 'mis_2', estado: 'succeeded' });
  const r3 = await abrirEncargoComputadora(yo, 'web', 'Busca el clima');
  await cerrarEncargoComputadora(yo, r3, { misionId: 'mis_3', estado: 'succeeded' });
  const r4 = await abrirEncargoComputadora(yo, 'web', 'Busca la tasa del día');
  await cerrarEncargoComputadora(yo, r4, { misionId: 'mis_4', estado: 'succeeded' });
  const r5 = await abrirEncargoComputadora(yo, 'web', 'Crea el documento informe.odt y guárdalo');
  await cerrarEncargoComputadora(yo, r5, { misionId: 'mis_5', estado: 'succeeded' });
  // Las misiones dicen lo mismo que se encargó: solo una CONSULTA se completa con el dato (ronda 5, cerrado por defecto).
  const h2 = arnes({
    misiones: [
      { id: 'mis_2', tareaId: 'mis_2', instruccion: 'Busca el horario del banco', estado: 'hecha', ok: true, inicio: T0, segundos: 40, resultado: 'Abre de 9 a 4', enlaces: ['https://banco.ejemplo/horario'] },
      { id: 'mis_3', tareaId: 'mis_3', instruccion: 'Busca el clima', estado: 'hecha', ok: true, inicio: T0, segundos: 40, resultado: 'Soleado, 28 grados', enlaces: [] },
      { id: 'mis_4', tareaId: 'mis_4', instruccion: 'Busca la tasa del día', estado: 'hecha', ok: true, inicio: T0, segundos: 40, resultado: null, enlaces: [] },
      // «Listo, lo guardé» sin que el nodo lo comprobara (revisión externa, 4-oct).
      { id: 'mis_5', tareaId: 'mis_5', instruccion: 'Crea el documento informe.odt y guárdalo', estado: 'hecha', ok: true, inicio: T0, segundos: 40, resultado: 'Listo, guardé informe.odt.', enlaces: [] },
      { id: 'mis_suelta', tareaId: 'mis_suelta', instruccion: 'otra cosa', estado: 'trabajando', ok: null, inicio: T0, segundos: 5, resultado: null },
    ],
  });
  try {
    // Ronda 7: una app que conoce el estado nuevo lo pide; la consulta respondida queda «respondida», no completed.
    const l = (await h2.pedir('/api/trabajos?estados=respondida', yo)).json.tareas as any[];
    const t2 = l.find((x) => x.id === r2!.id);
    const t3 = l.find((x) => x.id === r3!.id);
    assert.equal(t2.state, 'respondida');
    assert.equal(t2.terminal, true);
    assert.ok(t2.result.evidence.some((e: any) => e.ref === 'https://banco.ejemplo/horario'));
    assert.match(t2.result.summary, /Te respondí con lo que encontré\. Si además pediste que hiciera algo, eso NO está comprobado/);
    assert.doesNotMatch(t2.result.summary, /no hice/);
    assert.equal(t3.state, 'respondida', 'la respuesta con el dato que se pidió se responde (no un «listo»), sin comprobar');
    assert.notEqual(t3.acceptance[0].status, 'verified');
    // Una app de ANTES (sin `estados`): la misma tarea llega como «partial» terminal con el estado de verdad aparte;
    // nunca «completed», nunca un estado que no conoce ni algo que sigue trabajando.
    const viejo = (await h2.pedir('/api/trabajos', yo)).json.tareas as any[];
    const v2 = viejo.find((x) => x.id === r2!.id);
    assert.deepEqual({ state: v2.state, estadoReal: v2.estadoReal, terminal: v2.terminal }, { state: 'partial', estadoReal: 'respondida', terminal: true });
    assert.ok(!viejo.some((x) => x.state === 'respondida'));
    const una = (await h2.pedir(`/api/trabajos/${r3!.id}`, yo)).json.tarea;
    assert.deepEqual({ state: una.state, estadoReal: una.estadoReal }, { state: 'partial', estadoReal: 'respondida' });
    const t4 = l.find((x) => x.id === r4!.id);
    assert.equal(t4.state, 'partial', '«hecha» sin nada que lo acredite no es completed');
    assert.ok(t4.result.partial.length > 0);
    const t5 = l.find((x) => x.id === r5!.id);
    assert.equal(t5.state, 'partial', '«Listo, lo guardé» sin comprobar no es completed');
    assert.notEqual(t5.acceptance[0].status, 'verified');
    assert.match(t5.result.partial.join(' '), /no pude comprobar/i);
    assert.ok(l.some((x) => x.id === 'mis_suelta' && x.source === 'computadora'), 'la misión que no nació del chat se adapta, no se duplica');
  } finally {
    h2.cerrar();
  }
});

test('pausar con su computadora: si el nodo no puede, no se finge la pausa; si la barrera tarda, queda «pausing»', async () => {
  _usarAlmacenDurable(almacenEnMemoria());
  const yo = correo();
  const r1 = await abrirEncargoComputadora(yo, 'web', 'Revisa los precios de tres tiendas');
  await cerrarEncargoComputadora(yo, r1, { misionId: 'mis_p1', estado: 'unknown' });
  const r2 = await abrirEncargoComputadora(yo, 'web', 'Revisa el horario de tres bancos');
  await cerrarEncargoComputadora(yo, r2, { misionId: 'mis_p2', estado: 'unknown' });
  const mision = (id: string): MisionComputadoraMin => ({ id, tareaId: id, instruccion: 'x', estado: 'trabajando', ok: null, inicio: T0, segundos: 5, resultado: null });
  const no = arnes({ misiones: [mision('mis_p1'), mision('mis_p2')], pausarPc: () => Promise.reject(new Error('sin capacidad')) });
  try {
    const r = await no.pedir(`/api/trabajos/${r1!.id}/pausar`, yo, {});
    assert.equal(r.status, 409);
    assert.equal(r.json.tarea.state, 'running', 'sigue trabajando: no se dice «en pausa»');
  } finally {
    no.cerrar();
  }
  const tarda = arnes({ misiones: [mision('mis_p1'), mision('mis_p2')], pausarPc: async () => ({ fase: 'draining' }) });
  try {
    const r = await tarda.pedir(`/api/trabajos/${r2!.id}/pausar`, yo, {});
    assert.equal(r.status, 200);
    assert.equal(r.json.ack, 'recibido');
    assert.equal(r.json.tarea.state, 'pausing');
    // Mientras el nodo vacía la barrera (sigue «trabajando»), no vuelve a «running» al reconciliar.
    assert.equal((await tarda.pedir(`/api/trabajos/${r2!.id}`, yo)).json.tarea.state, 'pausing');
  } finally {
    tarda.cerrar();
  }
  const quieta = arnes({ misiones: [mision('mis_p1'), { ...mision('mis_p2'), estado: 'pausada' }] });
  try {
    assert.equal((await quieta.pedir(`/api/trabajos/${r2!.id}`, yo)).json.tarea.state, 'paused', 'el nodo confirmó: en pausa');
  } finally {
    quieta.cerrar();
  }
});

test('el «sí» o el «no» del chat cierran la decisión del borrador (sin doble efecto)', async () => {
  _usarAlmacenDurable(almacenEnMemoria());
  const yo = correo();
  const a = await abrirDecisionDeBorrador(yo, 'telefono', borrador('int-si'));
  await cerrarDecisionPorChat(yo, 'int-si', 'si', 'CORREO ENVIADO desde yo@ejemplo.com a ana@ejemplo.com — «Fechas».');
  const b = await abrirDecisionDeBorrador(yo, 'telefono', borrador('int-no'));
  await cerrarDecisionPorChat(yo, 'int-no', 'no', 'CORREO: no se mandó; el borrador quedó descartado.');
  // AUR08: siguió con otra cosa: el borrador espera al panel hasta que venza, así que la decisión sigue abierta.
  const c = await abrirDecisionDeBorrador(yo, 'telefono', borrador('int-otro'));
  await cerrarDecisionPorChat(yo, 'int-otro', null, 'CORREO: había un borrador… NO se mandó. Queda en su panel de tareas…');
  // El borrador apartado sigue vigente (server/correo.ts lo guarda con `soloPanel` hasta que vence).
  const h = arnes({ vigente: () => 'int-otro' });
  try {
    const ta = (await h.pedir(`/api/trabajos/${a!.id}`, yo)).json.tarea;
    const tb = (await h.pedir(`/api/trabajos/${b!.id}`, yo)).json.tarea;
    const tc = (await h.pedir(`/api/trabajos/${c!.id}`, yo)).json.tarea;
    assert.equal(ta.state, 'completed');
    assert.equal(tb.state, 'cancelled');
    assert.equal(tc.state, 'awaiting_approval', 'otra cosa en el chat no cierra la decisión del panel');
    // Ya decidida en el chat: el panel no la ejecuta otra vez.
    assert.equal((await h.pedir(`/api/trabajos/${a!.id}/decisiones`, yo, { decisionId: 'x', expectedVersion: ta.version, opcion: 'aprobar' })).status, 409);
    assert.equal(h.ll.enviar, 0);
  } finally {
    h.cerrar();
  }
});

test('cancelar y reanudar con su computadora: no se finge lo que el nodo no confirmó', async () => {
  _usarAlmacenDurable(almacenEnMemoria());
  const yo = correo();
  const mision = (id: string): MisionComputadoraMin => ({ id, tareaId: id, instruccion: 'x', estado: 'trabajando', ok: null, inicio: T0, segundos: 5, resultado: null });
  const r1 = await abrirEncargoComputadora(yo, 'web', 'Llena el formulario del banco');
  await cerrarEncargoComputadora(yo, r1, { misionId: 'mis_c1', estado: 'unknown' });
  // El nodo no pudo parar: sigue trabajando y se dice.
  const no = arnes({ misiones: [mision('mis_c1')], pararPc: () => Promise.reject(new Error('nodo caído')) });
  try {
    const r = await no.pedir(`/api/trabajos/${r1!.id}/cancelar`, yo, {});
    assert.equal(r.status, 409);
    assert.equal(r.json.codigo, 'no-cancelable');
    assert.equal(r.json.tarea.state, 'running', 'no se dice «cancelada» si no paró');
  } finally {
    no.cerrar();
  }
  // Una acción ya despachada sigue corriendo: «cancelling» hasta que la misión termine.
  const tarda = arnes({ misiones: [mision('mis_c1')], pararPc: async () => ({ fase: 'draining' }) });
  try {
    const r = await tarda.pedir(`/api/trabajos/${r1!.id}/cancelar`, yo, {});
    assert.equal(r.status, 200);
    assert.equal(r.json.ack, 'recibido');
    assert.equal(r.json.tarea.state, 'cancelling');
    assert.equal(r.json.tarea.terminal, false, 'todavía no promete que no pasa nada más');
    assert.equal((await tarda.pedir(`/api/trabajos/${r1!.id}`, yo)).json.tarea.state, 'cancelling', 'la misión sigue: no vuelve a «running»');
  } finally {
    tarda.cerrar();
  }
  const parada = arnes({ misiones: [{ ...mision('mis_c1'), estado: 'parada', ok: false }] });
  try {
    assert.equal((await parada.pedir(`/api/trabajos/${r1!.id}`, yo)).json.tarea.state, 'cancelled', 'el nodo confirmó la parada');
  } finally {
    parada.cerrar();
  }
  // Reanudar: si el nodo no la reanuda, sigue en pausa.
  const r2 = await abrirEncargoComputadora(yo, 'web', 'Ordena las fotos del viaje');
  await cerrarEncargoComputadora(yo, r2, { misionId: 'mis_c2', estado: 'unknown' });
  const pausa = arnes({ misiones: [mision('mis_c2')], pausarPc: async () => ({ fase: 'quiescent' }) });
  try {
    assert.equal((await pausa.pedir(`/api/trabajos/${r2!.id}/pausar`, yo, {})).json.tarea.state, 'paused');
  } finally {
    pausa.cerrar();
  }
  const noReanuda = arnes({ misiones: [{ ...mision('mis_c2'), estado: 'pausada' }], reanudarPc: () => Promise.reject(new Error('nodo caído')) });
  try {
    const r = await noReanuda.pedir(`/api/trabajos/${r2!.id}/reanudar`, yo, {});
    assert.equal(r.status, 409);
    assert.equal(r.json.codigo, 'no-reanudable');
    assert.equal(r.json.tarea.state, 'paused', 'no se dice «reanudada»');
  } finally {
    noReanuda.cerrar();
  }
});

test('clasificarEnvio: solo los prefijos fijos del servidor son éxito o fallo; lo demás es incierto', () => {
  assert.equal(clasificarEnvio('CORREO ENVIADO desde a a b — «x».'), 'succeeded');
  assert.equal(clasificarEnvio('WHATSAPP ENVIADO a Ana: «hola».'), 'succeeded');
  assert.equal(clasificarEnvio('CORREO: NO se mandó: venció.'), 'failed');
  assert.equal(clasificarEnvio('CORREO: no lo mandé: esa cuenta ya no está conectada.'), 'failed');
  assert.equal(clasificarEnvio('WHATSAPP: NO se pudo mandar (timeout).'), 'failed');
  assert.equal(clasificarEnvio('CORREO: dijo que sí; se manda a ana en cuanto termine este turno.'), 'unknown');
  assert.equal(clasificarEnvio(''), 'unknown');
});

test('el borrador desapareció (reinicio del servidor) → bloqueada con explicación, nunca «trabajando» para siempre', async () => {
  _usarAlmacenDurable(almacenEnMemoria());
  const yo = correo();
  const h = arnes({ vigente: () => null });
  try {
    const a = await abrirDecisionDeBorrador(yo, 'telefono', borrador('int-perdido'));
    const t = (await h.pedir(`/api/trabajos/${a!.id}`, yo)).json.tarea;
    assert.equal(t.state, 'blocked');
    assert.match(t.currentStep, /No se envió nada/);
    assert.deepEqual((await h.pedir('/api/trabajos', yo)).json.resumen, { trabajando: 0, decisiones: 1 });
  } finally {
    h.cerrar();
  }
});

/* ------------------------------------------------------------------ la ventana de decisión (José, 5-oct) */

test('ventana de decisión: el reconciliar pregunta por SU intento (un apartado que otro desplazó sigue esperando, no «ya no está»)', async () => {
  _usarAlmacenDurable(almacenEnMemoria());
  const yo = correo();
  const pedidos: Array<string | undefined> = [];
  // El lugar principal tiene a Bruno (int-bruno); Ana (int-ana) espera entre los apartados: por su intento, sigue.
  const h = arnes({ vigente: (_c, _a, intento) => (pedidos.push(intento), intento === 'int-ana' || intento === 'int-bruno' ? intento : 'int-bruno') });
  try {
    const a = await abrirDecisionDeBorrador(yo, 'telefono', borrador('int-ana'));
    const t = (await h.pedir(`/api/trabajos/${a!.id}`, yo)).json.tarea;
    assert.equal(t.state, 'awaiting_approval', 'sigue esperando su decisión');
    assert.ok(pedidos.includes('int-ana'), 'preguntó por su intento');
    const ok = await h.pedir(`/api/trabajos/${t.id}/decisiones`, yo, { decisionId: t.decisionId, expectedVersion: t.version, opcion: 'aprobar' });
    assert.equal(ok.status, 200);
    assert.deepEqual(h.ll.huellas, ['h-int-ana'], 'manda el de Ana con SU huella');
  } finally {
    h.cerrar();
  }
});

test('ventana de decisión: «cámbialo a…» (otra versión para la MISMA persona) vuelve a la misma tarjeta con otra decisión; la vieja no aprueba la nueva', async () => {
  _usarAlmacenDurable(almacenEnMemoria());
  const yo = correo();
  let vigente = 'int-v1';
  const h = arnes({ vigente: () => vigente });
  try {
    const a = await abrirDecisionDeBorrador(yo, 'telefono', borrador('int-v1'));
    const v1 = (await h.pedir(`/api/trabajos/${a!.id}`, yo)).json.tarea;
    vigente = 'int-v2';
    const b = await abrirDecisionDeBorrador(yo, 'telefono', { ...borrador('int-v2'), texto: 'Hola Ana, mejor el viernes.' });
    assert.equal(b!.id, a!.id, 'la misma tarjeta (no quedan dos)');
    const v2 = (await h.pedir(`/api/trabajos/${a!.id}`, yo)).json.tarea;
    assert.equal(v2.planVersion, 2);
    assert.notEqual(v2.decisionId, v1.decisionId);
    assert.ok(v2.decision.proposal.data.some((x: string) => x.includes('viernes')), 'muestra el texto nuevo');
    const viejo = await h.pedir(`/api/trabajos/${a!.id}/decisiones`, yo, { decisionId: v1.decisionId, expectedVersion: v1.version, opcion: 'aprobar' });
    assert.equal(viejo.status, 409);
    assert.equal(h.ll.enviar, 0);
    // A OTRA persona, en cambio, es otra tarjeta.
    const c = await abrirDecisionDeBorrador(yo, 'telefono', { ...borrador('int-otra'), para: ['bruno@ejemplo.com'] });
    assert.notEqual(c!.id, a!.id);
  } finally {
    h.cerrar();
  }
});

test('ventana de decisión: una propuesta bloqueada (venció) se ve un rato y luego se cierra sola «no salió nada» (no pide decisión para siempre)', async () => {
  _usarAlmacenDurable(almacenEnMemoria());
  const yo = correo();
  let ahora = Date.now();
  const h = arnes({ vigente: () => 'int-vence', ahora: () => ahora });
  try {
    const a = await abrirDecisionDeBorrador(yo, 'telefono', borrador('int-vence', ahora + 60_000));
    ahora += 2 * 60_000;
    const t = (await h.pedir(`/api/trabajos/${a!.id}`, yo)).json.tarea;
    assert.equal(t.state, 'blocked', 'venció: se ve bloqueada (la ventana pregunta si se rehace)');
    ahora += BLOQUEADA_VISIBLE_MS + 1000;
    const fin = (await h.pedir(`/api/trabajos/${a!.id}`, yo)).json.tarea;
    assert.equal(fin.state, 'cancelled');
    assert.equal(fin.terminal, true);
    assert.match(fin.result.summary, /no salió nada/);
    assert.deepEqual((await h.pedir('/api/trabajos', yo)).json.resumen, { trabajando: 0, decisiones: 0 }, 'el indicador ya no pide una decisión');
    assert.equal(h.ll.enviar, 0);
  } finally {
    h.cerrar();
  }
});

test('editar desde la tarjeta: el texto nuevo queda como decisión NUEVA en la misma tarea (otra huella); nada sale; la vieja no aprueba', async () => {
  _usarAlmacenDurable(almacenEnMemoria());
  const yo = correo();
  let vigente = 'int-1';
  const editados: Array<{ intento: string; huella: string; texto: string }> = [];
  const h = arnes({
    vigente: () => vigente,
    editar: (_c, canal, _amb, intento, huella, cambios) => {
      if (huella !== `h-${intento}`) return { ok: false, codigo: 'huella', mensaje: 'Lo que espera ya no es lo que estabas viendo.' };
      if (!cambios.texto.trim()) return { ok: false, codigo: 'vacio', mensaje: 'Vacío.' };
      editados.push({ intento, huella, texto: cambios.texto });
      vigente = 'int-2';
      return { ok: true, borrador: { ...borrador('int-2'), canal, texto: cambios.texto, huella: 'h-int-2' } };
    },
  });
  try {
    const a = await abrirDecisionDeBorrador(yo, 'telefono', borrador('int-1'));
    const t = (await h.pedir(`/api/trabajos/${a!.id}`, yo)).json.tarea;
    assert.equal((await h.pedir(`/api/trabajos/${t.id}/editar`, yo, { decisionId: t.decisionId, expectedVersion: t.version, texto: '   ' })).status, 400, 'vacío: 400, nada cambia');
    assert.equal((await h.pedir(`/api/trabajos/${t.id}/editar`, yo, { decisionId: 'dc_viejo', expectedVersion: t.version, texto: 'x' })).json.codigo, 'decision-vieja');
    assert.equal((await h.pedir(`/api/trabajos/${t.id}/editar`, correo(), { decisionId: t.decisionId, expectedVersion: t.version, texto: 'x' })).status, 404, 'otro no edita lo mío');
    const r = await h.pedir(`/api/trabajos/${t.id}/editar`, yo, { decisionId: t.decisionId, expectedVersion: t.version, texto: 'Hola Ana, ¿mejor el viernes?' });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.deepEqual(editados, [{ intento: 'int-1', huella: 'h-int-1', texto: 'Hola Ana, ¿mejor el viernes?' }], 'edita SOLO el que mostró la tarjeta');
    const t2 = r.json.tarea;
    assert.equal(t2.state, 'awaiting_approval');
    assert.notEqual(t2.decisionId, t.decisionId, 'otra decisión: hay que volver a decir que sí');
    assert.ok(t2.decision.proposal.data.some((x: string) => x.includes('viernes')), 'la tarjeta vuelve a mostrar el texto final');
    assert.equal(t2.decision.proposal.text, 'Hola Ana, ¿mejor el viernes?', 'el texto entero, para la ventana y para volver a editar');
    assert.equal(t.decision.proposal.subject, 'Fechas de la reunión');
    assert.equal(h.ll.enviar, 0, 'editar no envía nada');
    const viejo = await h.pedir(`/api/trabajos/${t.id}/decisiones`, yo, { decisionId: t.decisionId, expectedVersion: t.version, opcion: 'aprobar' });
    assert.equal(viejo.status, 409);
    const ok = await h.pedir(`/api/trabajos/${t.id}/decisiones`, yo, { decisionId: t2.decisionId, expectedVersion: t2.version, opcion: 'aprobar' });
    assert.equal(ok.status, 200);
    assert.deepEqual(h.ll.huellas, ['h-int-2'], 'sale la versión editada (su huella)');
  } finally {
    h.cerrar();
  }
});

test('editar desde la tarjeta: lo que no es un borrador (la tarea en curso, el taller) no se edita: 409 no-editable', async () => {
  _usarAlmacenDurable(almacenEnMemoria());
  const yo = correo();
  const tc: TareaEnCursoMin = { id: 'tc_ed', ambito: 'tel', tipo: 'correo', titulo: 'revisar correos', pasos: [{ etiqueta: 'a', estado: 'pendiente' }], actual: 0, estado: 'preguntando', creado: T0, actualizado: T0 + 1 };
  const h = arnes({ tc: [tc] });
  try {
    const t = (await h.pedir('/api/trabajos/tc_ed', yo)).json.tarea;
    const r = await h.pedir('/api/trabajos/tc_ed/editar', yo, { decisionId: t.decisionId, expectedVersion: t.version, texto: 'x' });
    assert.equal(r.status, 409);
    assert.equal(r.json.codigo, 'no-editable');
  } finally {
    h.cerrar();
  }
});

test('en pantalla: la ventana registra SU decisión (borrador), una vieja es 409 con la de ahora, y soltarla la quita', async () => {
  _usarAlmacenDurable(almacenEnMemoria());
  _olvidarEnPantalla();
  const yo = correo();
  const h = arnes();
  try {
    const a = await abrirDecisionDeBorrador(yo, 'telefono', borrador('int-1'));
    const t = (await h.pedir(`/api/trabajos/${a!.id}`, yo)).json.tarea;
    const vieja = await h.pedir(`/api/trabajos/${t.id}/en-pantalla`, yo, { decisionId: 'dc_viejo', visible: true });
    assert.equal(vieja.status, 409);
    assert.equal(vieja.json.codigo, 'decision-vieja');
    assert.equal(vieja.json.tarea.decisionId, t.decisionId, 'vuelve la de ahora para mostrarla');
    assert.equal(enPantallaDe(yo, 'telefono'), null);
    const ok = await h.pedir(`/api/trabajos/${t.id}/en-pantalla`, yo, { decisionId: t.decisionId, visible: true });
    assert.equal(ok.json.registrada, true);
    const e = enPantallaDe(yo, 'telefono');
    assert.equal(e?.intento, 'int-1');
    assert.equal(e?.huella, 'h-int-1');
    assert.equal(enPantallaDe(yo, 'web'), null, 'solo en la conversación del borrador');
    assert.equal(enPantallaDe(correo(), 'telefono'), null, 'de nadie más');
    assert.equal((await h.pedir(`/api/trabajos/${t.id}/en-pantalla`, correo(), { decisionId: t.decisionId, visible: true })).status, 404, 'otro no registra lo mío');
    // Renovar mantiene la MISMA (no la vuelve «más nueva»); si AU-RA preguntó otra cosa después, renovar no la revive.
    const desde = enPantallaDe(yo, 'telefono')!.t;
    assert.equal((await h.pedir(`/api/trabajos/${t.id}/en-pantalla`, yo, { decisionId: t.decisionId, visible: true, renovar: true })).json.registrada, true);
    assert.equal(enPantallaDe(yo, 'telefono')!.t, desde);
    olvidarEnPantallaDeConversacion(yo, 'telefono');
    assert.equal((await h.pedir(`/api/trabajos/${t.id}/en-pantalla`, yo, { decisionId: t.decisionId, visible: true, renovar: true })).json.registrada, false);
    assert.equal(enPantallaDe(yo, 'telefono'), null);
    await h.pedir(`/api/trabajos/${t.id}/en-pantalla`, yo, { decisionId: t.decisionId, visible: true });
    await h.pedir(`/api/trabajos/${t.id}/en-pantalla`, yo, { visible: false });
    assert.equal(enPantallaDe(yo, 'telefono'), null);
    // Decidida (rechazada) deja de estar a la vista.
    await h.pedir(`/api/trabajos/${t.id}/en-pantalla`, yo, { decisionId: t.decisionId, visible: true });
    await h.pedir(`/api/trabajos/${t.id}/decisiones`, yo, { decisionId: t.decisionId, expectedVersion: t.version, opcion: 'rechazar' });
    assert.equal(enPantallaDe(yo, 'telefono'), null);
    assert.equal(h.ll.enviar, 0);
  } finally {
    h.cerrar();
  }
});

test('vistaTarea no expone el vínculo ni el dueño', () => {
  const r = registroNuevo('tk_prueba5', nueva('m-5'), T0);
  const v = vistaTarea(r, T0) as any;
  assert.equal(v.requestId, undefined);
  assert.equal(v.dueno, undefined);
  assert.equal(v.state, 'running');
  assert.equal(v.controls.pause, true);
});

// Que el tipo AlmacenDurable se use (lo importan quienes escriben otras pruebas con este archivo de guía).
export type _A = AlmacenDurable;
