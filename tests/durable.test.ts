/**
 * AUR06: lo durable (lib/durable.ts) con un S3 de mentira que cumple If-None-Match / If-Match, y con el disco.
 *
 * Lo que tiene que ser verdad:
 *   · «crear una vez» es atómico: dos réplicas que crean la misma clave a la vez → una crea, la otra ve el original;
 *   · el CAS no pisa lo que otro escribió (412 → se relee y se reaplica);
 *   · «no pude leer» (S3 caído) no es «no existe»;
 *   · las claves son por dueño: el mismo requestId de dos personas son dos cosas, y el correo no aparece en la clave;
 *   · el lease tiene vencimiento y su token solo sube; solo el token vigente despacha (fencing);
 *   · el registro de operaciones persiste antes de actuar, no repite, y un efecto que lanza queda `unknown`;
 *   · los terminales no cambian.
 */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  almacenDisco,
  almacenEnMemoria,
  almacenS3,
  almacenDurable,
  avanzarOperacion,
  claveDe,
  compararYGuardar,
  crearUnaVez,
  ejecutarUnaVez,
  hashArgumentos,
  leaseVigente,
  leerDurable,
  leerOperacion,
  modificarDurable,
  registrarOperacion,
  renovarLease,
  reservarPedido,
  soltarLease,
  tomarLease,
  type AlmacenDurable,
} from '../lib/durable';
import { conS3Falso } from './s3-condicional-falso';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'durable-'));
after(() => fs.rmSync(dir, { recursive: true, force: true }));

/** Las mismas pruebas para S3 (falso, con condiciones) y para el disco. */
const almacenes: [string, (f: (a: AlmacenDurable) => Promise<void>) => Promise<void>][] = [
  ['s3', (f) => conS3Falso(() => f(almacenS3()))],
  ['disco', (f) => f(almacenDisco(fs.mkdtempSync(path.join(dir, 'd-'))))],
];

for (const [nombre, con] of almacenes) {
  test(`${nombre}: crear una vez es atómico entre dos «réplicas» que llegan a la vez`, async () => {
    await con(async (a) => {
      const clave = claveDe('pruebas', 'majo@orden.org', 'pedido-0001');
      const [x, y] = await Promise.all([crearUnaVez(clave, { de: 'A' }, a), crearUnaVez(clave, { de: 'B' }, a)]);
      assert.ok(x.ok && y.ok);
      if (!x.ok || !y.ok) return;
      assert.equal([x.creado, y.creado].filter(Boolean).length, 1, 'solo una crea');
      assert.equal(x.valor.de, y.valor.de, 'las dos ven el mismo original');
      const tercero = await crearUnaVez(clave, { de: 'C' }, a);
      assert.ok(tercero.ok && !tercero.creado && tercero.valor.de === x.valor.de, 'un reintento después ve el original');
    });
  });

  test(`${nombre}: el CAS no pisa una escritura ajena; modificar relee y reaplica`, async () => {
    await con(async (a) => {
      const clave = claveDe('pruebas', 'majo@orden.org', 'contador');
      const c = await crearUnaVez(clave, { n: 0 }, a);
      assert.ok(c.ok);
      if (!c.ok) return;
      const w1 = await compararYGuardar(clave, { n: 1 }, c.etag, a);
      assert.ok(w1.ok, 'con el ETag vigente escribe');
      const w2 = await compararYGuardar(clave, { n: 99 }, c.etag, a);
      assert.ok(w2.ok === false && w2.conflicto, 'con un ETag viejo no escribe');
      // Dos modificaciones a la vez: ninguna se pierde.
      await Promise.all([modificarDurable<{ n: number }>(clave, (v) => ({ n: v!.n + 1 }), a), modificarDurable<{ n: number }>(clave, (v) => ({ n: v!.n + 10 }), a)]);
      const l = await leerDurable<{ n: number }>(clave, a);
      assert.ok(l.ok && l.valor?.n === 12, `quedó ${l.ok && l.valor?.n}`);
    });
  });

  test(`${nombre}: lease con vencimiento y token que solo sube; solo el vigente pasa el fencing`, async () => {
    await con(async (a) => {
      let reloj = 1_000_000;
      const ahora = () => reloj;
      const clave = claveDe('leases', 'majo@orden.org', 'tarea-1');
      const A = await tomarLease(clave, 'proceso-A', 1000, { almacen: a, ahora });
      assert.ok(A.ok);
      if (!A.ok) return;
      assert.equal(A.lease.token, 1);
      const B = await tomarLease(clave, 'proceso-B', 1000, { almacen: a, ahora });
      assert.ok(!B.ok && 'ocupado' in B, 'mientras A lo tiene, B no');
      assert.equal(await leaseVigente(A.lease, ahora), true);
      // A se muere (no renueva): vence y B lo toma con un token mayor.
      reloj += 1500;
      const B2 = await tomarLease(clave, 'proceso-B', 1000, { almacen: a, ahora });
      assert.ok(B2.ok);
      if (!B2.ok) return;
      assert.equal(B2.lease.token, 2, 'el token sube');
      assert.equal(await leaseVigente(A.lease, ahora), false, 'A despierta tarde: su token ya no vale');
      const ren = await renovarLease(A.lease, 1000, ahora);
      assert.ok(ren.ok === false && ren.perdido, 'A no puede renovar lo que ya no es suyo');
      assert.ok(await soltarLease(B2.lease));
      const C = await tomarLease(clave, 'proceso-C', 1000, { almacen: a, ahora });
      assert.ok(C.ok && C.lease.token === 3, 'soltar conserva el token: el siguiente recibe uno mayor');
    });
  });

  test(`${nombre}: el registro de operaciones persiste antes de actuar y no repite`, async () => {
    await con(async (a) => {
      let efectos = 0;
      const pedido = { dueno: 'majo@orden.org', requestId: 'envio-0001', tipo: 'correo.enviar', argsHash: hashArgumentos({ para: ['ana@x.hn'], asunto: 'hola' }), almacen: a };
      const vistoAlDespachar: string[] = [];
      const r1 = await ejecutarUnaVez(pedido, async () => {
        efectos++;
        const op = await leerOperacion(pedido.dueno, pedido.requestId, a);
        vistoAlDespachar.push(op.ok && op.valor ? op.valor.estado : 'nada');
        return { estado: 'succeeded', recibo: { efecto: 'confirmed', proveedor: 'smtp', referencia: '<id-1@x>' } };
      });
      assert.ok(r1.corrio);
      assert.deepEqual(vistoAlDespachar, ['dispatched'], 'antes del efecto ya estaba guardado como despachado');
      assert.equal(r1.op.estado, 'succeeded');
      assert.equal(r1.op.recibo?.referencia, '<id-1@x>');
      // El reintento (respuesta perdida, otra réplica): no corre, devuelve el estado con su recibo.
      const r2 = await ejecutarUnaVez(pedido, async () => {
        efectos++;
        return { estado: 'succeeded' };
      });
      assert.ok(!r2.corrio && r2.op?.estado === 'succeeded');
      assert.equal(efectos, 1, 'un solo efecto');
      // El mismo requestId con OTRO contenido no hereda nada.
      const otro = await registrarOperacion({ ...pedido, argsHash: hashArgumentos({ para: ['bruno@x.hn'] }) });
      assert.ok(otro.ok === false && otro.motivo === 'otro-pedido');
    });
  });

  test(`${nombre}: un efecto que lanza queda unknown (no failed, no succeeded) y no se repite; unknown se reconcilia`, async () => {
    await con(async (a) => {
      const pedido = { dueno: 'majo@orden.org', requestId: 'envio-0002', tipo: 'whatsapp.enviar', almacen: a };
      const r = await ejecutarUnaVez(pedido, async () => {
        throw new Error('el puente se cortó a media escritura');
      });
      assert.ok(r.corrio && r.op.estado === 'unknown' && r.op.recibo?.efecto === 'possible');
      const otra = await ejecutarUnaVez(pedido, async () => ({ estado: 'succeeded' }));
      assert.ok(!otra.corrio, 'un unknown no se reenvía a ciegas');
      // Reconciliar: se miró el proveedor y sí salió.
      const rec = await avanzarOperacion({ dueno: pedido.dueno, requestId: pedido.requestId, a: 'succeeded', recibo: { efecto: 'confirmed', proveedor: 'whatsapp', referencia: 'msg-9' }, almacen: a });
      assert.ok(rec.ok && rec.op.estado === 'succeeded');
      // Terminal: ya no cambia.
      const atras = await avanzarOperacion({ dueno: pedido.dueno, requestId: pedido.requestId, a: 'failed', almacen: a });
      assert.ok(atras.ok === false && atras.motivo === 'transicion');
      const igual = await avanzarOperacion({ dueno: pedido.dueno, requestId: pedido.requestId, a: 'succeeded', almacen: a });
      assert.ok(igual.ok, 'repetir el mismo estado es idempotente');
    });
  });

  test(`${nombre}: sin lease vigente no se despacha (fencing) y no hay efecto`, async () => {
    await con(async (a) => {
      let reloj = 5_000_000;
      const ahora = () => reloj;
      const clave = claveDe('leases', 'majo@orden.org', 'tarea-2');
      const A = await tomarLease(clave, 'proceso-A', 1000, { almacen: a, ahora });
      assert.ok(A.ok);
      if (!A.ok) return;
      // Otro proceso lo toma (A venció de verdad en el reloj del sistema: vence en el pasado).
      reloj += 5000;
      const B = await tomarLease(clave, 'proceso-B', 60_000, { almacen: a, ahora: () => Date.now() + 10_000_000 });
      assert.ok(B.ok);
      let efectos = 0;
      const r = await ejecutarUnaVez({ dueno: 'majo@orden.org', requestId: 'clic-1', tipo: 'computadora.accion', lease: A.lease, almacen: a }, async () => {
        efectos++;
        return { estado: 'succeeded' };
      });
      assert.ok(r.corrio === false && r.motivo === 'fencing');
      assert.equal(efectos, 0);
      const op = await leerOperacion('majo@orden.org', 'clic-1', a);
      assert.ok(op.ok && op.valor?.estado === 'failed' && op.valor.recibo?.efecto === 'none', 'queda failed sin efecto (no pendiente)');
    });
  });

  test(`${nombre}: dedupe pedido → id: la misma petición da la misma tarea; otra persona con el mismo id, otra`, async () => {
    await con(async (a) => {
      const r1 = await reservarPedido({ espacio: 'computadora/pedidos', dueno: 'majo@orden.org', requestId: 'req-1', propuesto: 'tarea-A', almacen: a });
      const r2 = await reservarPedido({ espacio: 'computadora/pedidos', dueno: 'MAJO@orden.org', requestId: 'req-1', propuesto: 'tarea-B', almacen: a });
      const r3 = await reservarPedido({ espacio: 'computadora/pedidos', dueno: 'beto@orden.org', requestId: 'req-1', propuesto: 'tarea-C', almacen: a });
      assert.ok(r1.ok && r2.ok && r3.ok);
      if (!r1.ok || !r2.ok || !r3.ok) return;
      assert.deepEqual([r1.id, r1.nuevo], ['tarea-A', true]);
      assert.deepEqual([r2.id, r2.nuevo], ['tarea-A', false], 'el reintento recibe la misma tarea');
      assert.deepEqual([r3.id, r3.nuevo], ['tarea-C', true], 'otra persona con el mismo id no comparte nada');
    });
  });
}

test('s3: «no pude leer» no es «no existe», y crear con S3 caído no se da por hecho', async () => {
  await conS3Falso(async (s3) => {
    const a = almacenS3();
    const clave = claveDe('pruebas', 'majo@orden.org', 'caido');
    s3.lee.ok = false;
    const l = await leerDurable(clave, a);
    assert.equal(l.ok, false);
    s3.escribe.ok = false;
    const c = await crearUnaVez(clave, { x: 1 }, a);
    assert.equal(c.ok, false);
  });
});

test('s3: las escrituras van con If-None-Match / If-Match y bajo ultron/durable/, sin el correo en la clave', async () => {
  await conS3Falso(async (s3) => {
    const a = almacenS3();
    const clave = claveDe('turnos', 'Majo@Orden.org', 'frase-0001');
    await crearUnaVez(clave, { x: 1 }, a);
    await crearUnaVez(clave, { x: 2 }, a);
    assert.equal(s3.rechazos412(), 1, 'el segundo crear se rechazó con 412');
    const claves = [...s3.objetos.keys()];
    assert.equal(claves.length, 1);
    assert.match(claves[0], /^\/ultron\/durable\/turnos\/[0-9a-f]{40}\/frase-0001\.json$/);
    assert.ok(!claves[0].includes('majo') && !claves[0].includes('@'));
  });
});

test('claves por dueño: limpias, sin texto suelto, y el mismo id de dos personas son dos claves', () => {
  assert.notEqual(claveDe('turnos', 'a@x.org', 'frase-0001'), claveDe('turnos', 'b@x.org', 'frase-0001'));
  assert.equal(claveDe('turnos', 'A@x.org', 'frase-0001'), claveDe('turnos', 'a@x.org', 'frase-0001'));
  assert.match(claveDe('turnos', 'a@x.org', 'manda esto a ../../etc'), /\/h_[0-9a-f]{40}$/, 'un id raro va hasheado');
  assert.notEqual(claveDe('ops', 'a@x.org', 'tarea-1:paso-2'), claveDe('ops', 'a@x.org', 'tarea-1.paso-2'), 'sin traducir caracteres: no chocan');
  assert.throws(() => claveDe('../fuera', 'a@x.org', 'x'));
  assert.throws(() => claveDe('turnos', '', 'x'), /dueño/);
});

test('sin S3 configurado, el almacén por omisión es el disco (no multi-réplica; en pruebas, memoria); con S3, S3', async () => {
  const antes = process.env.ULTRON_MEMORIA_BUCKET;
  const contexto = process.env.NODE_TEST_CONTEXT;
  process.env.ULTRON_MEMORIA_BUCKET = '';
  // Bajo el corredor de pruebas va a memoria (una corrida no hereda lo de la anterior)…
  assert.equal(almacenDurable().tipo, 'memoria');
  // …y fuera de él (el servidor de verdad), al disco.
  delete process.env.NODE_TEST_CONTEXT;
  try {
    assert.equal(almacenDurable().tipo, 'disco');
    assert.equal(almacenDurable().multiReplica, false);
  } finally {
    if (contexto !== undefined) process.env.NODE_TEST_CONTEXT = contexto;
    process.env.ULTRON_MEMORIA_BUCKET = antes || '';
  }
  await conS3Falso(async () => {
    assert.equal(almacenDurable().tipo, 's3');
    assert.equal(almacenDurable().multiReplica, true);
  });
});

test('memoria: el doble determinista cumple lo mismo (para quien use el módulo en sus pruebas)', async () => {
  const a = almacenEnMemoria();
  const clave = claveDe('pruebas', 'majo@orden.org', 'm-1');
  const [x, y] = await Promise.all([crearUnaVez(clave, 1, a), crearUnaVez(clave, 2, a)]);
  assert.ok(x.ok && y.ok && [x.creado, y.creado].filter(Boolean).length === 1);
});

/* ------------------------------------------------------------------ A7: enumeración por prefijo */

const conMemoria = async (f: (a: AlmacenDurable) => Promise<void>) => f(almacenEnMemoria());
const prefijoDe = (dueno: string) => claveDe('pruebas', dueno, 'x').split('/').slice(0, 2).join('/');
for (const [nombre, con] of [...almacenes, ['memoria', conMemoria] as [string, typeof conMemoria]]) {
  test(`${nombre}: listar enumera UN nivel bajo el prefijo de un dueño, en orden, reanudable con «desde» y por tramos`, async () => {
    await con(async (a) => {
      assert.equal(typeof a.listar, 'function');
      const ana = prefijoDe('ana@orden.org');
      for (const id of ['c-3', 'a-1', 'b-2']) assert.ok((await crearUnaVez(claveDe('pruebas', 'ana@orden.org', id), { id }, a)).ok);
      assert.ok((await crearUnaVez(claveDe('pruebas', 'beto@orden.org', 'z-9'), { id: 'z-9' }, a)).ok);
      assert.ok((await crearUnaVez(`${ana}/hondo/d-4`, { id: 'd-4' }, a)).ok);
      const todo = await a.listar!(ana);
      assert.ok(todo.ok);
      if (!todo.ok) return;
      assert.deepEqual(
        todo.claves,
        ['a-1', 'b-2', 'c-3'].map((x) => `${ana}/${x}`),
        'solo las de ese dueño y ese nivel, en orden'
      );
      assert.equal(todo.truncado, false);
      const tramo1 = await a.listar!(ana, { max: 2 });
      assert.ok(tramo1.ok && tramo1.truncado && tramo1.claves.length === 2);
      const tramo2 = await a.listar!(ana, { desde: tramo1.ok ? tramo1.claves[1] : null, max: 2 });
      assert.ok(tramo2.ok && !tramo2.truncado);
      if (tramo2.ok) assert.deepEqual(tramo2.claves, [`${ana}/c-3`]);
      const vacio = await a.listar!(prefijoDe('nadie@orden.org'));
      assert.ok(vacio.ok && vacio.claves.length === 0, 'un prefijo sin nada es una lista vacía, no un error');
    });
  });
}

test('s3: listar va con ListObjectsV2 (prefijo + delimitador) bajo ultron/durable/; S3 caído al listar es ok:false, nunca «vacío»', async () => {
  await conS3Falso(async (s3) => {
    const a = almacenS3();
    assert.ok((await crearUnaVez(claveDe('pruebas', 'ana@orden.org', 'a-1'), { id: 1 }, a)).ok);
    const pre = prefijoDe('ana@orden.org');
    let prefijoVisto = '';
    s3.alListar.f = (p) => void (prefijoVisto = p);
    assert.ok((await a.listar!(pre)).ok);
    assert.equal(prefijoVisto, `ultron/durable/${pre}/`);
    s3.fallaListado.si = () => true;
    const caido = await a.listar!(pre);
    assert.equal(caido.ok, false);
  });
});
