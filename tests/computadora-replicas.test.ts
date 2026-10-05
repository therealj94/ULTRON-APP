/**
 * P5 / A6 (auditoría externa del 4-oct): recuperar el id de una tarea de la computadora tiene que recuperar SU CONTROL.
 *
 * Réplicas en procesos SEPARADOS del sistema operativo (tests/fixtures/replica-computadora.ts) con las rutas reales,
 * sobre un S3 condicional y un nodo de computadora sintéticos que viven en este proceso (nada sale de la máquina):
 *   · A crea; B recupera el mismo id por su requestId y además PUEDE consultarla, tomar/devolver el control y pararla;
 *     una cuenta ajena sigue recibiendo 404; se mata A (SIGKILL) y C recupera la misma tarea, el mismo final y el mismo
 *     recibo de la parada. Un solo despacho al nodo en total.
 *   · El nodo termina mientras A está caído: C reconcilia el resultado (sin «completed» sin evidencia, sin quedarse
 *     reconciliando para siempre) y la tarea durable enlazada se cierra con lo que pasó.
 *   · Una parada cuyo ACK se pierde queda `unknown` hasta que el estado del nodo la reconcilia.
 */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';
import type { AddressInfo } from 'node:net';

const RAIZ = path.resolve(import.meta.dirname, '..');
const DUENO = 'replicas@ejemplo.test';
const AJENO = 'otra-cuenta@ejemplo.test';

/* ------------------------------------------------------------------ S3 y nodo sintéticos (en este proceso) */

type TareaNodo = { id: string; instruccion: string; estado: string; pasos: any[]; respuesta: string | null; error: string | null; segundos: number };
const objetos = new Map<string, { cuerpo: string; etag: string }>();
const tareasNodo = new Map<string, TareaNodo>();
let despachos = 0;
let serie = 0;
/** La parada llega al nodo y se aplica, pero la respuesta se pierde (se corta la conexión). */
let perderAckParar = false;
/** El nodo todavía no deja ver que paró (sigue diciendo «trabajando» al consultarla). */
let ocultarParada = false;

const fixture = http.createServer(async (req, res) => {
  let texto = '';
  for await (const c of req) texto += c;
  const json = (code: number, j: unknown, h: Record<string, string> = {}) => {
    res.writeHead(code, { 'content-type': 'application/json', ...h });
    res.end(typeof j === 'string' ? j : JSON.stringify(j));
  };
  const url = req.url || '';
  if (url.startsWith('/s3/')) {
    const clave = decodeURIComponent(url.slice(3).split('?')[0]);
    const actual = objetos.get(clave);
    if (req.method === 'GET') return actual ? json(200, actual.cuerpo, { etag: actual.etag }) : json(404, 'no');
    if (req.method === 'PUT') {
      if (req.headers['if-none-match'] === '*' && actual) return json(412, 'existe');
      if (req.headers['if-match'] && (!actual || actual.etag !== req.headers['if-match'])) return json(412, 'cambió');
      const etag = `"e${++serie}"`;
      objetos.set(clave, { cuerpo: texto, etag });
      return json(200, '', { etag });
    }
  }
  if (url === '/salud') return json(200, { ok: true, motores: ['holo'], ocupada: false, capacidades: ['pausar', 'confirmar', 'control', 'entrada', 'seguro'], validador: 12 });
  if (req.headers.authorization !== 'Bearer clave-sintetica') return json(401, { detail: 'clave' });
  if (url === '/tareas' && req.method === 'POST') {
    despachos++;
    const b = JSON.parse(texto);
    const id = `nodo_${tareasNodo.size + 1}`;
    tareasNodo.set(id, { id, instruccion: b.instruccion, estado: 'trabajando', pasos: [{ n: 1, t: 1, accion: 'escritorio_limpio' }], respuesta: null, error: null, segundos: 3 });
    return json(200, { id, estado: 'en_cola' });
  }
  const m = /^\/tareas\/([^/?]+)(?:\/([a-z]+))?/.exec(url);
  const t = m ? tareasNodo.get(m[1]) : undefined;
  if (!t) return json(404, { detail: 'no existe' });
  if (!m![2]) return json(200, ocultarParada && t.estado === 'parada' ? { ...t, estado: 'trabajando' } : t);
  if (m![2] === 'parar') {
    t.estado = 'parada';
    if (perderAckParar) return req.socket.destroy();
    return json(200, { ok: true, parada: { id: `parada_${t.id}`, fase: 'quiescent' } });
  }
  if (m![2] === 'control') {
    const b = JSON.parse(texto || '{}');
    t.estado = b.tomar ? 'control' : 'trabajando';
    return json(200, { ok: true, fase: 'quiescent', epoca: b.tomar ? 2 : 3 });
  }
  return json(404, { detail: 'ruta sintética no soportada' });
});
await new Promise<void>((r) => fixture.listen(0, '127.0.0.1', r));
const FIXTURE = `http://127.0.0.1:${(fixture.address() as AddressInfo).port}`;

/* ------------------------------------------------------------------ réplicas */

type Replica = { nombre: string; p: ChildProcess; url: string; log: () => string };
const vivas: Replica[] = [];

async function arrancar(nombre: string): Promise<Replica> {
  const p = spawn(process.execPath, ['--import', path.join(RAIZ, 'node_modules/tsx/dist/loader.mjs'), path.join(RAIZ, 'tests/fixtures/replica-computadora.ts')], {
    cwd: RAIZ,
    env: {
      PATH: process.env.PATH,
      NODE_ENV: 'test',
      CEREBRO_VOZ: 'qwen',
      FIXTURE_URL: FIXTURE,
      COMPUTADORA_URL: FIXTURE,
      COMPUTADORA_CLAVE: 'clave-sintetica',
      ULTRON_MEMORIA_BUCKET: 'aura-replicas-sintetico',
      AWS_ACCESS_KEY_ID: 'AKIASINTETICA',
      AWS_SECRET_ACCESS_KEY: 'no-es-un-secreto',
      AWS_REGION: 'us-east-1',
    },
  });
  let log = '';
  p.stdout!.on('data', (b) => (log += b));
  p.stderr!.on('data', (b) => (log += b));
  const url = await new Promise<string>((ok, mal) => {
    const tope = setTimeout(() => mal(new Error(`la réplica ${nombre} no arrancó: ${log}`)), 30_000);
    p.stdout!.on('data', () => {
      const m = /READY (\{[^\n]+\})/.exec(log);
      if (m) {
        clearTimeout(tope);
        ok(`http://127.0.0.1:${JSON.parse(m[1]).port}`);
      }
    });
    p.once('exit', (c) => {
      clearTimeout(tope);
      mal(new Error(`la réplica ${nombre} salió (${c}): ${log}`));
    });
  });
  const r = { nombre, p, url, log: () => log };
  vivas.push(r);
  return r;
}

async function matar(r: Replica) {
  if (r.p.exitCode !== null || r.p.signalCode !== null) return;
  const fin = new Promise((ok) => r.p.once('exit', ok));
  r.p.kill('SIGKILL');
  await fin;
}

after(async () => {
  for (const r of vivas) await matar(r);
  await new Promise((r) => fixture.close(r));
});

async function pedir(r: Replica, ruta: string, cuerpo?: unknown, quien = DUENO): Promise<{ code: number; j: any }> {
  const res = await fetch(r.url + ruta, { method: cuerpo ? 'POST' : 'GET', headers: { 'content-type': 'application/json', 'x-quien': quien, 'x-aura-estados': 'respondida' }, body: cuerpo ? JSON.stringify(cuerpo) : undefined });
  return { code: res.status, j: await res.json().catch(() => null) };
}

async function hasta<T>(f: () => Promise<T>, ok: (x: T) => boolean, ms = 12_000): Promise<T> {
  const fin = Date.now() + ms;
  let x = await f();
  while (!ok(x) && Date.now() < fin) {
    await new Promise((r) => setTimeout(r, 200));
    x = await f();
  }
  return x;
}

const reciboParar = (j: any) => (j?.mision?.controles || []).filter((c: any) => c.accion === 'parar').at(-1);

/* ------------------------------------------------------------------ las pruebas */

test('A crea; B consulta, toma el control y para; muere A y C recupera la misma tarea, final y recibo; un solo despacho', { timeout: 120_000 }, async () => {
  const A = await arrancar('A');
  const B = await arrancar('B');
  const cuerpo = { instruccion: 'Revisa la página sintética local y dime su título', requestId: 'replicas-caso-0001' };
  const crear = await pedir(A, '/api/computadora/tareas', cuerpo);
  assert.equal(crear.code, 200, JSON.stringify(crear.j));
  const id = crear.j.id;
  assert.equal((await pedir(A, `/api/computadora/tareas/${id}`)).code, 200);

  // B: el mismo requestId da el mismo id SIN volver a despachar, y con su misión (no `mision: null`).
  const repetido = await pedir(B, '/api/computadora/tareas', cuerpo);
  assert.equal(repetido.code, 200);
  assert.equal(repetido.j.id, id);
  assert.equal(repetido.j.repetido, true);
  assert.equal(repetido.j.mision?.id, id, 'el replay en otra réplica trae la misión, no null');
  assert.equal(despachos, 1);

  // B la consulta y la controla: el propietario no pierde el acceso al cambiar de réplica.
  const leerB = await pedir(B, `/api/computadora/tareas/${id}`);
  assert.equal(leerB.code, 200, `B no pudo consultarla: ${JSON.stringify(leerB.j)}`);
  assert.equal(leerB.j.tarea.id, id);
  // Una cuenta ajena sigue sin verla ni tocarla, en cualquier réplica.
  assert.equal((await pedir(B, `/api/computadora/tareas/${id}`, undefined, AJENO)).code, 404);
  assert.equal((await pedir(B, `/api/computadora/tareas/${id}/parar`, {}, AJENO)).code, 404);
  assert.equal((await pedir(A, `/api/computadora/tareas/${id}/parar`, {}, AJENO)).code, 404);
  assert.equal(tareasNodo.get(id)!.estado, 'trabajando', 'la cuenta ajena no paró nada');

  const tomar = await pedir(B, `/api/computadora/tareas/${id}/control`, { tomar: true });
  assert.equal(tomar.code, 200, JSON.stringify(tomar.j));
  assert.equal(tareasNodo.get(id)!.estado, 'control');
  assert.equal((await pedir(B, `/api/computadora/tareas/${id}/control`, { tomar: false })).code, 200);
  const parar = await pedir(B, `/api/computadora/tareas/${id}/parar`, {});
  assert.equal(parar.code, 200, JSON.stringify(parar.j));
  assert.equal(parar.j.fase, 'quiescent');
  assert.equal(tareasNodo.get(id)!.estado, 'parada');
  const enB = await pedir(B, `/api/computadora/tareas/${id}`);
  const recibo = reciboParar(enB.j);
  assert.ok(recibo, `B guarda el recibo de la parada: ${JSON.stringify(enB.j?.mision)}`);
  assert.equal(recibo.estado, 'succeeded');

  // Muere A sin avisar. C (proceso nuevo) recupera la misma tarea, su final y el mismo recibo.
  await matar(A);
  const C = await arrancar('C');
  const enC = await hasta(
    () => pedir(C, `/api/computadora/tareas/${id}`),
    (x) => x.j?.mision?.final?.estado === 'parada'
  );
  assert.equal(enC.code, 200, JSON.stringify(enC.j));
  assert.equal(enC.j.tarea.id, id);
  assert.equal(enC.j.mision.id, id);
  assert.equal(enC.j.mision.final?.estado, 'parada', 'C reconcilia el final con el nodo');
  assert.equal(enC.j.mision.final?.ok, false, 'parada no es éxito');
  assert.deepEqual(reciboParar(enC.j), recibo, 'el mismo recibo de la parada');
  const replayC = await pedir(C, '/api/computadora/tareas', cuerpo);
  assert.equal(replayC.j.id, id);
  assert.equal(replayC.j.mision?.final?.estado, 'parada');
  // B ve lo mismo que C (lo durable manda; su memoria es caché).
  const otraVezB = await hasta(
    () => pedir(B, `/api/computadora/tareas/${id}`),
    (x) => x.j?.mision?.final?.estado === 'parada'
  );
  assert.equal(otraVezB.j.mision.final?.estado, 'parada');
  assert.deepEqual(reciboParar(otraVezB.j), recibo);
  // El historial de C la muestra; el de la cuenta ajena no.
  assert.ok((await pedir(C, '/api/computadora')).j.historial.some((h: any) => h.id === id));
  assert.equal((await pedir(C, '/api/computadora', undefined, AJENO)).j.historial.length, 0);
  assert.equal((await pedir(C, `/api/computadora/tareas/${id}`, undefined, AJENO)).code, 404);
  assert.equal(despachos, 1, 'un solo despacho al nodo en total');
  await Promise.all([matar(B), matar(C)]);
});

test('el nodo termina mientras A está caído: C reconcilia el resultado y la tarea enlazada se cierra sin «completed» sin evidencia', { timeout: 120_000 }, async () => {
  const A = await arrancar('A2');
  const cuerpo = { instruccion: 'Abre la página sintética local y dime qué título tiene', requestId: 'replicas-caso-0002' };
  const crear = await pedir(A, '/api/computadora/tareas', cuerpo);
  assert.equal(crear.code, 200);
  const id = crear.j.id;
  const enlazada = await pedir(A, '/prueba/enlazar', { requestId: 'replicas-enlace-0002', id, instruccion: cuerpo.instruccion });
  assert.equal(enlazada.code, 200, JSON.stringify(enlazada.j));
  const tk = enlazada.j.tarea.id;
  const antes = despachos;
  await matar(A);
  // Mientras no hay ninguna réplica viva, el nodo termina.
  Object.assign(tareasNodo.get(id)!, {
    estado: 'hecha',
    respuesta: 'El título de la página es «Inicio sintético».',
    pasos: [
      { n: 1, t: 1, accion: 'escritorio_limpio' },
      { n: 2, t: 2, accion: 'open_url', args: { url: 'http://pagina.sintetica.local/' }, hecho: true },
      { n: 3, t: 3, accion: 'answer' },
    ],
  });
  const C = await arrancar('C2');
  const enC = await hasta(
    () => pedir(C, `/api/computadora/tareas/${id}`),
    (x) => !!x.j?.mision?.final
  );
  assert.equal(enC.code, 200, JSON.stringify(enC.j));
  const final = enC.j.mision.final;
  assert.ok(final, 'C cierra la misión con lo que dice el nodo');
  assert.equal(final.estado, 'hecha');
  assert.match(String(final.respuesta), /Inicio sintético/);
  assert.equal(final.ok, final.comprobado, 'nunca ok sin comprobar');
  // La tarea durable enlazada: terminal, con el resultado, y NO completed sin evidencia ni reconciliando para siempre.
  const t = await hasta(
    () => pedir(C, `/api/trabajos/${tk}`),
    (x) => !!x.j?.tarea?.terminal
  );
  assert.equal(t.code, 200);
  assert.equal(t.j.tarea.terminal, true, `la tarea enlazada se cierra (estado ${t.j.tarea.state})`);
  assert.notEqual(t.j.tarea.state, 'reconciling');
  if (t.j.tarea.state === 'completed') assert.ok(t.j.tarea.acceptance.every((c: any) => !c.required || (c.status === 'verified' && c.evidenceIds.length)), 'completed solo con evidencia');
  assert.match(String(t.j.tarea.result?.summary || ''), /Inicio sintético/);
  assert.equal(despachos, antes, 'recuperar no vuelve a despachar');
  await matar(C);
});

test('una parada con el ACK perdido queda «unknown» hasta que el estado del nodo la reconcilia', { timeout: 120_000 }, async () => {
  const A = await arrancar('A3');
  const B = await arrancar('B3');
  const crear = await pedir(A, '/api/computadora/tareas', { instruccion: 'Revisa otra página sintética local y dime qué hay', requestId: 'replicas-caso-0003' });
  assert.equal(crear.code, 200);
  const id = crear.j.id;
  perderAckParar = true;
  ocultarParada = true;
  try {
    const parar = await pedir(B, `/api/computadora/tareas/${id}/parar`, {});
    assert.notEqual(parar.code, 200, 'sin ACK no se dice «paré»');
    assert.notEqual(parar.code, 404, 'el dueño no pierde el acceso en B');
    assert.equal(parar.j?.recibo?.estado, 'unknown', JSON.stringify(parar.j));
    const leida = await pedir(B, `/api/computadora/tareas/${id}`);
    assert.equal(leida.code, 200);
    assert.equal(reciboParar(leida.j)?.estado, 'unknown', 'mientras el nodo no lo confirma, sigue incierta');
    // A (otra réplica) ve el mismo recibo incierto.
    const enA = await hasta(
      () => pedir(A, `/api/computadora/tareas/${id}`),
      (x) => reciboParar(x.j)?.estado === 'unknown'
    );
    assert.equal(reciboParar(enA.j)?.estado, 'unknown');
  } finally {
    perderAckParar = false;
    ocultarParada = false;
  }
  // El nodo ya dice «parada»: el recibo se reconcilia (no se repite la orden a ciegas).
  const reconciliada = await hasta(
    () => pedir(B, `/api/computadora/tareas/${id}`),
    (x) => reciboParar(x.j)?.estado === 'succeeded'
  );
  const r = reciboParar(reconciliada.j);
  assert.equal(r?.estado, 'succeeded');
  assert.equal(r?.reconciliado, true);
  await Promise.all([matar(A), matar(B)]);
});

test('una tarea enlazada cuya misión ya no existe en ningún lado no se queda «reconciling» para siempre ni sale «completed»', async () => {
  const td: any = await import('../lib/tareas-durables');
  const t0 = Date.parse('2026-10-04T12:00:00Z');
  const reg = td.registroNuevo(
    'tk_sinmision',
    { requestId: 'sin-mision-0001', titulo: 'Encargo viejo', estado: 'running', entorno: { kind: 'computadora', id: 'nodo_x', displayName: 'Tu computadora' }, origen: { kind: 'chat' }, enlace: { tipo: 'computadora', id: 'nodo_x' }, criterios: [{ id: 'resultado', texto: 'El resultado', obligatorio: true }] },
    t0
  );
  // Al poco: todavía no se sabe; pasados 90 s, reconciliando (no «completed», no «failed» a ciegas).
  assert.equal(td.reconciliarConComputadora(reg, null, t0 + 30_000), null);
  const c1 = td.reconciliarConComputadora(reg, null, t0 + 120_000);
  assert.equal(c1?.estado, 'reconciling');
  const enReconciliar = td.aplicarCambio(reg, c1, t0 + 120_000);
  assert.ok(enReconciliar.ok);
  // Mucho después y sin misión: se cierra con la verdad (no se sabe si hubo efecto), con su recibo «unknown».
  assert.ok(Number.isFinite(td.RECONCILIAR_MAX_MS), 'hay un tope para reconciliar');
  const tarde = t0 + 120_000 + td.RECONCILIAR_MAX_MS + 1000;
  const c2 = td.reconciliarConComputadora(enReconciliar.reg, null, tarde);
  assert.ok(c2, 'no se queda reconciliando para siempre');
  assert.ok(td.esTerminal(c2.estado));
  assert.notEqual(c2.estado, 'completed');
  const recibo = (c2.eventos || []).find((e: any) => e.type === 'operation.receipt');
  assert.equal(recibo?.payload.state, 'unknown');
  assert.equal(recibo?.payload.effect, 'possible');
  assert.match(String(c2.resultado?.resumen), /no pude confirmar/i);
  assert.ok(td.aplicarCambio(enReconciliar.reg, c2, tarde).ok);
});

test('revisión 9: una tarea enlazada a una misión más vieja que las HISTORIAL_MAX recientes se reconcilia con su estado real, no «no sé cómo terminó»', async () => {
  const dur: any = await import('../lib/durable');
  const pc: any = await import('../server/computadora');
  const tr: any = await import('../server/trabajos');
  const td: any = await import('../lib/tareas-durables');
  const express = (await import('express')).default;
  dur._usarAlmacenDurable(dur.almacenEnMemoria());
  const yo = 'misiones-viejas@ejemplo.test';
  const t0 = Date.now() - 3 * 3600_000;
  const n = pc.HISTORIAL_MAX + 2;
  const historial: { id: string; t: number }[] = [];
  // 12 misiones durables, todas terminadas. La 1.ª (la más vieja) la PARÓ la persona; las demás solo respondieron.
  for (let i = 1; i <= n; i++) {
    const id = `nodo_viejo_${i}`;
    const inicio = t0 + i * 60_000;
    const parada = i === 1;
    const registro = {
      v: 1,
      id,
      instruccion: `Revisa la página sintética ${i}`,
      plan: ['Abrir la página', 'Leerla'],
      planDelCerebro: false,
      inicio,
      tareas: [id],
      indice: 1,
      recibos: {},
      fin: inicio + 30_000,
      final: {
        estado: parada ? 'parada' : 'hecha',
        ok: false,
        respuesta: parada ? null : `La página ${i} dice «Hola».`,
        error: parada ? 'La paraste tú.' : null,
        captura: null,
        segundos: 30,
        pasos: 2,
        visitados: [],
        archivos: null,
        comprobado: false,
        respondida: !parada,
        sinComprobar: null,
        entregables: null,
      },
      pregunta: null,
      rondas: 0,
      pasosPrevios: 0,
      idioma: 'es',
      motor: 'holo',
      aparato: null,
      ambito: null,
      maxPasos: 30,
      estadoNodo: parada ? 'parada' : 'hecha',
      controles: [],
      version: 1,
      actualizada: inicio + 30_000,
    };
    assert.ok((await dur.crearUnaVez(dur.claveDe('computadora/misiones', yo, id), registro)).ok);
    historial.push({ id, t: inicio });
  }
  assert.ok((await dur.crearUnaVez(dur.claveDe('computadora/historial', yo, 'lista'), { v: 1, ids: historial })).ok);
  // La tarea durable enlazada a la 1.ª misión, que quedó «reconciling» hace mucho (más que RECONCILIAR_MAX_MS).
  const crear = await td.crearTarea(yo, {
    requestId: 'mision-vieja-0001',
    titulo: 'Revisa la página sintética 1',
    estado: 'running',
    entorno: { kind: 'computadora', id: 'nodo_viejo_1', displayName: 'Tu computadora' },
    origen: { kind: 'chat' },
    criterios: [{ id: 'resultado', texto: 'El resultado', obligatorio: true }],
    enlace: { tipo: 'computadora', id: 'nodo_viejo_1' },
  });
  assert.ok(crear.ok, JSON.stringify(crear));
  const tk = crear.tarea.id;
  const c = await td.cambiarTarea(yo, tk, () => ({ estado: 'reconciling', pasoActual: 'No puedo confirmar cómo terminó en tu computadora; reviso antes de repetir nada.' }));
  assert.ok(c.ok, JSON.stringify(c));
  const tarde = Date.now() + td.RECONCILIAR_MAX_MS + 60_000;

  const app = express();
  app.use(express.json());
  const pasa = (_q: any, _s: any, next: any) => next();
  const adaptador = pc.adaptadorTrabajos();
  tr.montarRutasTrabajos(app, {
    exigirMesa: pasa,
    limitar: () => pasa,
    sesionDe: (req: any) => (req.headers['x-quien'] ? { correo: String(req.headers['x-quien']) } : null),
    computadora: adaptador,
    reloj: () => tarde,
  });
  const srv = app.listen(0, '127.0.0.1');
  await new Promise((r) => srv.once('listening', r));
  try {
    const leer = async (ruta: string) => {
      const r = await fetch(`http://127.0.0.1:${(srv.address() as AddressInfo).port}${ruta}`, { headers: { 'x-quien': yo, 'x-aura-estados': 'respondida' } });
      return { status: r.status, j: (await r.json()) as any };
    };
    // Lo que el panel tiene en memoria: solo las HISTORIAL_MAX recientes; la 1.ª no está.
    assert.equal(await adaptador.preparar(yo), true);
    const recientes = adaptador.misiones(yo).map((m: any) => m.id);
    assert.equal(recientes.length, pc.HISTORIAL_MAX);
    assert.ok(!recientes.includes('nodo_viejo_1'), 'la misión enlazada ya no está entre las recientes');
    const r = await leer(`/api/trabajos/${tk}`);
    assert.equal(r.status, 200, JSON.stringify(r.j));
    const t = r.j.tarea;
    assert.equal(t.state, 'cancelled', `se reconcilia con el estado real de su misión (la paró la persona), no «no sé»: ${t.state} · ${t.result?.summary}`);
    assert.doesNotMatch(String(t.result?.summary || ''), /no pude confirmar/i);
    // Leerla fue solo para leer: no desplazó a las recientes de la memoria.
    assert.deepEqual(adaptador.misiones(yo).map((m: any) => m.id), recientes);
    // Otra cuenta no encuentra esa misión por su id.
    assert.equal(await adaptador.buscar('otra-cuenta@ejemplo.test', 'nodo_viejo_1'), null);
    assert.equal((await adaptador.buscar(yo, 'nodo_viejo_1'))?.estado, 'parada');
  } finally {
    srv.close();
    dur._usarAlmacenDurable(null);
  }
});
