/**
 * F05 (plan de cierre 5.7, P1): los objetivos convergen y las vistas solo avanzan. Más el subconjunto T15 de aislamiento.
 *
 * Antes: GET /api/objetivos devolvía el agregado guardado tal cual (el detalle y los cambios sí reconciliaban con sus
 * tareas): una tarea que terminó en otro aparato dejaba la lista atrás. En el cliente, la lista reemplazaba todo de un
 * golpe (una respuesta vieja pisaba una decisión ya confirmada) y no había generación de sesión.
 *
 * Lo que tiene que ser verdad:
 *   · servidor: la lista es la proyección reconciliada (converge tras un evento perdido); cancelar y LUEGO un recibo real:
 *     los dos hechos se ven y lo cancelado no se reactiva;
 *   · cliente (lib pura, la del teléfono y la web): un GET N que llega tarde no tapa la N+1 confirmada; salir y entrar con
 *     otra cuenta con pedidos en vuelo no deja nada de la anterior; una lista parcial no borra;
 *   · T15: una cuenta de AU-RA no lee el objetivo, el borrador ni el documento de otra aunque sepa el id; una sesión solo de
 *     Dr Electrum no entra a los objetivos; una sesión solo de AU-RA no entra a lo de Dr Electrum.
 */
import test, { after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import type { AddressInfo } from 'node:net';
import { almacenEnMemoria, _usarAlmacenDurable } from '../lib/durable';
import { cambiarObjetivo, crearObjetivo, leerObjetivo, pedirDecision } from '../lib/objetivos';
import { cambiarTarea, crearTarea, leerTarea } from '../lib/tareas-durables';
import { montarRutasObjetivos } from '../server/objetivos';
import { crearAlmacenObjetivos, fusionarListaObjetivos, type VistaObjetivo } from '../mobile/src/lib/objetivos';

afterEach(() => _usarAlmacenDurable(null));

function rutas(quien?: (req: express.Request) => { correo?: string } | null, exigir?: express.RequestHandler[]) {
  const pasa = ((_q: express.Request, _s: express.Response, nx: express.NextFunction) => nx()) as express.RequestHandler;
  const app = express();
  app.use(express.json());
  montarRutasObjetivos(app, { exigir: exigir || [pasa], limitar: () => pasa, sesionDe: quien || ((req) => (req.headers['x-quien'] ? { correo: String(req.headers['x-quien']) } : null)) });
  const srv = app.listen(0, '127.0.0.1');
  const listo = new Promise((r) => srv.once('listening', r));
  const pedir = async (ruta: string, cab: Record<string, string>, cuerpo?: unknown) => {
    await listo;
    const r = await fetch(`http://127.0.0.1:${(srv.address() as AddressInfo).port}${ruta}`, { method: cuerpo ? 'POST' : 'GET', headers: { 'content-type': 'application/json', ...cab }, body: cuerpo ? JSON.stringify(cuerpo) : undefined });
    return { status: r.status, json: (await r.json().catch(() => ({}))) as any };
  };
  return { pedir, cerrar: () => srv.close() };
}

const tareaApi = (titulo: string, requestId: string) => ({ requestId, titulo, objetivo: titulo, estado: 'queued' as const, entorno: { kind: 'chat' as const, id: 'api', displayName: 'AURA' }, origen: { kind: 'api' as const } });

/* ------------------------------------------------------------------ servidor */

test('F05-1: una tarea terminó en otro aparato y el evento se perdió: la LISTA converge (no solo el detalle)', async () => {
  const a = almacenEnMemoria();
  _usarAlmacenDurable(a);
  const yo = 'conv-lista@ejemplo.com';
  const c = await crearObjetivo(yo, { requestId: 'conv-lista-01', titulo: 'Informe trimestral', criterioCierre: ['Listo'] });
  assert.ok(c.ok);
  const id = c.ok ? c.objetivo.id : '';
  const t = await crearTarea(yo, tareaApi('Juntar las cifras', 'conv-lista-t1'));
  assert.ok(t.ok);
  const tid = t.ok ? t.tarea.id : '';
  await cambiarObjetivo(yo, id, () => ({ tarea: tid, estado: 'en-curso', evento: 'Sumé la tarea' }));
  await cambiarTarea(yo, tid, () => ({ estado: 'running' }));
  // Otro aparato la terminó; nadie reconcilió el objetivo (el «evento» se perdió).
  const fin = await cambiarTarea(yo, tid, () => ({ estado: 'partial', resultado: { id: `${tid}:r`, resumen: 'Cifras juntas, falta una.', evidencias: [], parcial: [], pendiente: [], t: Date.now() } }));
  assert.ok(fin.ok, JSON.stringify(fin));
  const guardado = await leerObjetivo(yo, id);
  assert.equal(guardado.ok && guardado.objetivo?.estado, 'en-curso', 'el agregado guardado quedó atrás');
  const h = rutas();
  try {
    const l = await h.pedir('/api/objetivos', { 'x-quien': yo });
    assert.equal(l.status, 200);
    const o = l.json.objetivos.find((x: VistaObjetivo) => x.id === id);
    assert.equal(o.estado, 'abierto', 'la lista es la proyección reconciliada con sus tareas');
    assert.ok(l.json.proyeccion?.reconciliada);
    const d = await h.pedir(`/api/objetivos/${id}`, { 'x-quien': yo });
    assert.equal(d.json.objetivo.revision, o.revision, 'lista y detalle dicen lo mismo');
    // Repetir no duplica ni retrocede.
    const otra = await h.pedir('/api/objetivos', { 'x-quien': yo });
    assert.equal(otra.json.objetivos.find((x: VistaObjetivo) => x.id === id).revision, o.revision);
  } finally {
    h.cerrar();
  }
});

test('F05-2: cancelar y DESPUÉS llega el recibo real de lo ya aceptado: se ven los dos hechos y lo cancelado no se reactiva', async () => {
  const a = almacenEnMemoria();
  _usarAlmacenDurable(a);
  const yo = 'conv-recibo@ejemplo.com';
  const c = await crearObjetivo(yo, { requestId: 'conv-recibo-01', titulo: 'Investigación de mercado', criterioCierre: ['Informe'] });
  const id = c.ok ? c.objetivo.id : '';
  const t1 = await crearTarea(yo, tareaApi('Buscar precios', 'conv-recibo-t1'));
  const t2 = await crearTarea(yo, tareaApi('Comparar', 'conv-recibo-t2'));
  const [id1, id2] = [t1.ok ? t1.tarea.id : '', t2.ok ? t2.tarea.id : ''];
  await cambiarObjetivo(yo, id, () => ({ tarea: id1, estado: 'en-curso', evento: 'T1' }));
  await cambiarObjetivo(yo, id, () => ({ tarea: id2, evento: 'T2' }));
  await cambiarTarea(yo, id1, () => ({ estado: 'running' })); // ya en marcha (aceptada)
  const h = rutas();
  try {
    const can = await h.pedir(`/api/objetivos/${id}/cancelar`, { 'x-quien': yo }, {});
    assert.equal(can.json.objetivo.estado, 'cancelado');
    assert.equal(can.json.cancelacion.estado, 'accion-ya-aceptada');
    assert.deepEqual(can.json.objetivo.enVueloAlCancelar, [id1]);
    const l2 = await leerTarea(yo, id2);
    assert.equal(l2.ok && l2.tarea?.estado, 'cancelled');
    // Llega el resultado real de T1.
    const r = await cambiarTarea(yo, id1, () => ({ estado: 'partial', resultado: { id: `${id1}:r`, resumen: 'Precios de 3 proveedores.', evidencias: [], parcial: [], pendiente: [], t: Date.now() } }));
    assert.ok(r.ok);
    const l = await h.pedir('/api/objetivos', { 'x-quien': yo });
    const o = l.json.objetivos.find((x: VistaObjetivo) => x.id === id);
    assert.equal(o.estado, 'cancelado', 'sigue cancelado');
    assert.deepEqual(o.hechosTardios.map((x: any) => [x.tareaId, x.estado]), [[id1, 'partial']], 'el recibo quedó visible');
    assert.deepEqual(o.enVueloAlCancelar, []);
    assert.ok(o.eventos.some((e: any) => /Cancelaste/.test(e.texto)) && o.eventos.some((e: any) => /después de cancelar/.test(e.texto)), 'los dos hechos en la historia');
    const l2b = await leerTarea(yo, id2);
    assert.equal(l2b.ok && l2b.tarea?.estado, 'cancelled', 'lo cancelado no se reactiva');
    // Repetir (eventos repetidos) no duplica.
    const otra = await h.pedir(`/api/objetivos/${id}`, { 'x-quien': yo });
    assert.equal(otra.json.objetivo.hechosTardios.length, 1);
    assert.equal(otra.json.objetivo.revision, o.revision);
  } finally {
    h.cerrar();
  }
});

/* ------------------------------------------------------------------ cliente (lib pura) */

const vista = (id: string, revision: number, extra: Partial<VistaObjetivo> = {}): VistaObjetivo =>
  ({ id, plataforma: 'ultron', proyecto: '', titulo: id, meta: '', criterioCierre: [], documentos: [], decisiones: [], restricciones: [], permisos: [], topeCosto: null, siguientePaso: '', estado: 'abierto', pausado: false, revision, eventos: [], tareas: [], creado: 1, actualizado: revision, terminal: false, decisionesPendientes: 0, ...extra }) as VistaObjetivo;

/** Un cliente cuyo `listar` y `cambios` se contestan a mano (barreras): el orden lo decide la prueba. */
function clienteControlado() {
  const listas: { resolver: (r: any) => void }[] = [];
  const cambios: { resolver: (r: any) => void }[] = [];
  return {
    listas,
    cambios,
    cliente: {
      listar: () => new Promise<any>((r) => listas.push({ resolver: r })),
      cambios: () => new Promise<any>((r) => cambios.push({ resolver: r })),
    },
  };
}
const tick = () => new Promise((r) => setImmediate(r));

test('F05-3: un GET con la revisión N que llega DESPUÉS de la decisión confirmada N+1: la vista se queda con N+1', async () => {
  const k = clienteControlado();
  const al = crearAlmacenObjetivos(k.cliente as any);
  al.sesion('ana@ejemplo.com');
  const p = al.refrescar(); // sale el GET (todavía ve N)
  await tick();
  al.aplicar(vista('ob_1', 6, { estado: 'en-curso' })); // la decisión confirmada: N+1
  k.listas[0].resolver({ ok: true, objetivos: [vista('ob_1', 5, { estado: 'esperando-decision' })], completo: true });
  await tick();
  k.cambios[0]?.resolver(null);
  await p;
  assert.equal(al.foto().objetivos[0].revision, 6);
  assert.equal(al.foto().objetivos[0].estado, 'en-curso', 'la respuesta vieja no hace retroceder la vista');
});

test('F05-4: salir y entrar con OTRA cuenta con pedidos en vuelo: nada de la sesión anterior (ni datos ni efectos)', async () => {
  const k = clienteControlado();
  const al = crearAlmacenObjetivos(k.cliente as any);
  al.sesion('ana@ejemplo.com');
  const genAna = al.generacion();
  const pA = al.refrescar();
  await tick();
  // Sale Ana, entra Beto (mientras el GET de Ana sigue en vuelo).
  al.olvidar();
  al.sesion('beto@ejemplo.com');
  k.listas[0].resolver({ ok: true, objetivos: [vista('ob_ana', 3)], completo: true });
  await pA;
  assert.deepEqual(al.foto().objetivos, [], 'la lista de Ana no entra en la sesión de Beto');
  assert.equal(k.cambios.length, 0, 'ni dispara lo que seguía (los cambios de Ana)');
  // La respuesta de una acción de Ana que llega tarde, tampoco.
  al.aplicar(vista('ob_ana', 4), genAna);
  assert.deepEqual(al.foto().objetivos, []);
  // Lo de Beto sí.
  const pB = al.refrescar();
  await tick();
  k.listas[1].resolver({ ok: true, objetivos: [vista('ob_beto', 1)], completo: true });
  await tick();
  k.cambios[0]?.resolver(null);
  await pB;
  assert.deepEqual(al.foto().objetivos.map((x) => x.id), ['ob_beto']);
  assert.equal(al.foto().cuenta, 'beto@ejemplo.com');
});

test('F05-5: una lista parcial no borra; una completa sí quita lo que ya no está; un 404 del detalle lo quita', () => {
  const xs = [vista('ob_a', 3), vista('ob_b', 2)];
  assert.deepEqual(fusionarListaObjetivos(xs, [vista('ob_a', 4)], { completo: false }).map((x) => [x.id, x.revision]), [['ob_a', 4], ['ob_b', 2]]);
  assert.deepEqual(fusionarListaObjetivos(xs, [vista('ob_a', 2)], { completo: true }).map((x) => [x.id, x.revision]), [['ob_a', 3]]);
  const k = clienteControlado();
  const al = crearAlmacenObjetivos(k.cliente as any);
  al.sesion('c@ejemplo.com');
  al.aplicar(vista('ob_z', 1));
  al.quitar('ob_z');
  assert.deepEqual(al.foto().objetivos, []);
});

/* ------------------------------------------------------------------ T15: aislamiento */

test('T15: otra cuenta de AU-RA no lee el objetivo, el borrador ni el documento aunque sepa el id', async () => {
  const a = almacenEnMemoria();
  _usarAlmacenDurable(a);
  const ana = 'ana-t15@ejemplo.com';
  const beto = 'beto-t15@ejemplo.com';
  const c = await crearObjetivo(ana, { requestId: 't15-objetivo', titulo: 'Contrato privado', criterioCierre: ['Firmado'] });
  const id = c.ok ? c.objetivo.id : '';
  const p = await pedirDecision(ana, id, { pregunta: '¿Firmo?', opciones: [{ id: 'si', etiqueta: 'Sí', consecuencia: 'Firmo.' }] });
  const rev = p.ok ? p.objetivo.revision : 0;
  const dec = p.ok ? p.objetivo.decisiones[0].id : '';
  const h = rutas();
  try {
    const B = { 'x-quien': beto };
    for (const r of [`/api/objetivos/${id}`, `/api/objetivos/${id}/cambios?desde=0`]) assert.equal((await h.pedir(r, B)).status, 404, r);
    assert.equal((await h.pedir(`/api/objetivos/${id}/decisiones`, B, { decisionId: dec, opcion: 'si', revisionVista: rev })).status, 404);
    assert.equal((await h.pedir(`/api/objetivos/${id}/cancelar`, B, {})).status, 404);
    assert.equal((await h.pedir(`/api/objetivos/${id}/tareas`, B, { requestId: 't15-tarea-01', titulo: 'Colarme' })).status, 404);
    assert.equal((await h.pedir(`/api/objetivos/${id}/documentos`, B, { archivoId: 'd_0123456789abcdef01234567' })).status, 404);
    const lb = await h.pedir('/api/objetivos', B);
    assert.ok(!lb.json.objetivos.some((x: VistaObjetivo) => x.id === id), 'ni en su lista');
    const sigue = await leerObjetivo(ana, id);
    assert.equal(sigue.ok && sigue.objetivo?.estado, 'esperando-decision', 'nada de Beto tocó lo de Ana');
  } finally {
    h.cerrar();
  }
  // El borrador de Ana: Beto no lo lee ni lo manda aunque sepa intento y huella.
  const BD = await import('../server/borradores-durables');
  BD.guardarBorradorDurable('correo', ana, 'tel', { intento: 'int-t15', huella: 'h-t15', vence: Date.now() + 60_000, texto: 'x' } as any, a);
  await BD._esperarBorradoresDurables();
  assert.ok(await BD.leerBorradorDurable('correo', ana, 'tel', 'int-t15', 'h-t15', { almacen: a }));
  assert.equal(await BD.leerBorradorDurable('correo', beto, 'tel', 'int-t15', 'h-t15', { almacen: a }), null);
  const { pasarPuerta } = await import('../lib/puerta-efecto');
  // La operación de Ana, pedida por Beto, es OTRA operación (su clave lleva la huella de Beto): no reclama la de Ana.
  const pb = await pasarPuerta({ dueno: beto, operacion: 'envio-correo-int-t15', huella: 'h-t15', almacen: a });
  const { leerAutoridad } = await import('../lib/puerta-efecto');
  assert.equal(await leerAutoridad(ana, 'envio-correo-int-t15', a), null, 'lo de Ana sigue sin reclamar');
  void pb;
});

const ENTORNO_PREVIO = { ULTRON_PADRON: process.env.ULTRON_PADRON, ULTRON_MESA_CLAVE: process.env.ULTRON_MESA_CLAVE, ELECTRUM_CLAVE: process.env.ELECTRUM_CLAVE, ULTRON_SESION_SECRETO: process.env.ULTRON_SESION_SECRETO, AURA_SUSPENSIONES: process.env.AURA_SUSPENSIONES };
after(() => {
  for (const [k, v] of Object.entries(ENTORNO_PREVIO)) if (v === undefined) delete process.env[k];
  else process.env[k] = v;
});

test('T15: una sesión solo de Dr Electrum no entra a los objetivos; una solo de AU-RA no entra a lo de Dr Electrum', async () => {
  process.env.ULTRON_PADRON = ['aura-t15 | Persona Aura | aura.t15@ordenglobal.org | | ultron=escribe', 'electrum-t15 | Ing. Electrum | ing.t15@mina.hn | | electrum=escribe'].join('\n');
  // Con llaves puestas, el «modo desarrollo» ya no abre las plataformas: decide el padrón.
  process.env.ULTRON_MESA_CLAVE = 'llave-mesa-t15-que-nadie-manda';
  process.env.ELECTRUM_CLAVE = 'llave-electrum-t15-que-nadie-manda';
  process.env.ULTRON_SESION_SECRETO = 'secreto-de-sesion-de-prueba-t15-largo';
  process.env.AURA_SUSPENSIONES = 'ninguna';
  const S = await import('../server/seguridad');
  const { reiniciarPadron } = await import('../lib/acceso');
  reiniciarPadron();
  const a = almacenEnMemoria();
  _usarAlmacenDurable(a);
  const aura = 'aura.t15@ordenglobal.org';
  const c = await crearObjetivo(aura, { requestId: 't15-plataforma', titulo: 'Plan de AU-RA', criterioCierre: ['Hecho'] });
  const id = c.ok ? c.objetivo.id : '';
  const tokAura = S.emitirSesion({ correo: aura, nombre: 'Aura', rol: 'Prueba' }).token;
  const tokElec = S.emitirSesion({ correo: 'ing.t15@mina.hn', nombre: 'Ing', rol: 'Prueba' }).token;
  const h = rutas((req) => S.sesionDe(req), [S.exigirPlataforma('ultron')]);
  // Una ruta de Dr Electrum cualquiera, con su puerta de plataforma: el id de un objetivo de AU-RA no abre nada.
  const app = express();
  app.get('/api/electrum/ficha/:id', S.exigirPlataforma('electrum'), (_q, r) => r.json({ ok: true }));
  const srv = app.listen(0, '127.0.0.1');
  await new Promise((r) => srv.once('listening', r));
  try {
    const conAura = await h.pedir(`/api/objetivos/${id}`, { authorization: `Bearer ${tokAura}` });
    assert.equal(conAura.status, 200, 'la cuenta de AU-RA lee lo suyo');
    const conElec = await h.pedir(`/api/objetivos/${id}`, { authorization: `Bearer ${tokElec}` });
    assert.equal(conElec.status, 401, 'una sesión solo de Dr Electrum no entra aunque sepa el id');
    const r = await fetch(`http://127.0.0.1:${(srv.address() as AddressInfo).port}/api/electrum/ficha/${id}`, { headers: { authorization: `Bearer ${tokAura}` } });
    assert.equal(r.status, 401, 'la ruta de Dr Electrum rechaza a la cuenta de AU-RA y su objetivo');
    // Y un objetivo «de Dr Electrum» no se crea.
    const e = await crearObjetivo(aura, { requestId: 't15-electrum', titulo: 'Concesión', plataforma: 'electrum', criterioCierre: ['x'] });
    assert.equal(e.ok, false);
  } finally {
    h.cerrar();
    srv.close();
    reiniciarPadron();
  }
});
