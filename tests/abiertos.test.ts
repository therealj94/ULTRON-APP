/**
 * Lo que quedó a medias (lib/abiertos.ts):
 *
 *  · reglas: promesas de AU-RA, lo que la persona dijo que haría, lo que AU-RA no pudo, borradores;
 *  · se juntan las repetidas; lo cerrado no se reabre; lo viejo no importante caduca;
 *  · «QUEDÓ A MEDIAS» cabe en su tope y dice cuándo («ayer»);
 *  · con el modelo (falso): agrega y cierra por id; sin modelo, reglas;
 *  · S3 caído: no se sube nada encima.
 */
import test, { after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'abiertos-'));
Object.assign(process.env, { ULTRON_ABIERTOS_DIR: path.join(dir, 'ab'), ULTRON_MEMORIA_BUCKET: '' });
after(() => fs.rmSync(dir, { recursive: true, force: true }));

const A = await import('../lib/abiertos');
const { _usarModeloPrueba, CajonNoDisponible } = await import('../lib/cerebro-comun');
const DIA = 86_400_000;

beforeEach(() => {
  A._olvidarCacheAbiertos();
  _usarModeloPrueba(null);
});
after(() => _usarModeloPrueba(undefined));

test('reglas: lo que AU-RA prometió, lo que él hará, lo que no se pudo y el borrador sin mandar', () => {
  const p = A.detectarPendientes([
    { rol: 'user', texto: '¿Cuánto está el saco de cemento en Danlí?' },
    { rol: 'ultron', texto: 'Ahorita no tengo el dato. Te lo busco mañana y te digo.' },
    { rol: 'user', texto: 'Mañana tengo que llamar al notario sin falta.' },
    { rol: 'user', texto: 'Ábreme el enlace del contrato de la concesión' },
    { rol: 'ultron', texto: 'No pude abrir el enlace: la página no contestó.' },
    { rol: 'ultron', texto: 'BORRADOR DE WHATSAPP (NO enviado) para Beto: llego a las 5. ¿Lo mando?' },
    { rol: 'user', texto: 'gracias' },
    { rol: 'user', texto: 'Mi contraseña es perro123, tengo que cambiarla mañana' },
  ]);
  const tipos = p.map((x) => x.tipo);
  assert.ok(p.some((x) => x.tipo === 'promesa_aura' && /Te lo busco mañana/.test(x.texto) && x.cuando === 'manana'));
  const notario = p.find((x) => x.tipo === 'promesa_persona');
  assert.ok(notario && /notario/.test(notario.texto) && notario.importante, 'sin falta = importante');
  assert.ok(p.some((x) => x.tipo === 'pregunta' && /Quedó sin resolver: Ábreme el enlace/.test(x.texto)));
  assert.ok(tipos.includes('borrador'));
  assert.ok(!p.some((x) => /perro123/.test(x.texto)), 'nada con secretos');
});

test('se juntan las repetidas, lo cerrado no se reabre y lo viejo no importante caduca', async () => {
  const ahora = Date.now();
  await A.incorporarAbiertos('jose@x.com', [{ texto: 'Buscar el precio del cemento en Danlí', tipo: 'promesa_aura' }], { ahora: ahora - 2 * DIA });
  await A.incorporarAbiertos('jose@x.com', [{ texto: 'buscar precio del cemento en Danlí', tipo: 'promesa_aura' }], { ahora: ahora - DIA });
  let xs = await A.abiertosDe('jose@x.com', ahora);
  assert.equal(xs.length, 1);
  assert.equal(xs[0].veces, 2);
  const r = await A.cerrar('jose@x.com', xs[0].id);
  assert.equal(r.abierto?.estado, 'hecho');
  await A.incorporarAbiertos('jose@x.com', [{ texto: 'Buscar el precio del cemento en Danlí', tipo: 'promesa_aura' }]);
  assert.equal((await A.abiertosDe('jose@x.com')).length, 0, 'lo hecho no vuelve a abrirse');
  assert.equal((await A.cerradosDe('jose@x.com'))[0].motivo, 'marcado como hecho');
  // Caduca: 8 días sin retomarse, salvo lo importante.
  await A.incorporarAbiertos('jose@x.com', [{ texto: 'Revisar la factura de la ferretería', tipo: 'tarea' }, { texto: 'Renovar la concesión del cerro antes del 30', tipo: 'promesa_persona', importante: true }], { ahora: ahora - 8 * DIA });
  xs = await A.abiertosDe('jose@x.com', ahora);
  assert.deepEqual(
    xs.map((x) => x.texto),
    ['Renovar la concesión del cerro antes del 30']
  );
  // Otra persona no ve nada de esto, ni puede cerrarlo.
  assert.equal((await A.abiertosDe('otra@x.com')).length, 0);
  assert.equal((await A.cerrar('otra@x.com', xs[0].id)).abierto, null);
  await assert.rejects(A.agregarAbierto('jose@x.com', 'Cambiar la clave: gato12345'), /secreto/);
});

test('QUEDÓ A MEDIAS cabe en su tope (voz 350, texto 900), dice cuándo y pone lo importante primero', async () => {
  const ahora = Date.now();
  const nuevos = Array.from({ length: 10 }, (_, i) => ({ texto: `Pendiente número ${i} con un texto bastante largo para ver que el bloque no se pasa del tope ${'w'.repeat(i * 3)} ${['alfa', 'beta', 'gama', 'delta', 'epsilon', 'zeta', 'eta', 'theta', 'iota', 'kappa'][i]}`, tipo: 'promesa_persona' as const }));
  await A.incorporarAbiertos('ana@x.com', nuevos, { ahora: ahora - DIA });
  await A.incorporarAbiertos('ana@x.com', [{ texto: 'Mandarle el contrato firmado a Beto', tipo: 'promesa_aura', importante: true, cuando: 'mañana' }], { ahora: ahora - DIA });
  const voz = A.bloqueAbiertos('ana@x.com', true, ahora);
  const texto = A.bloqueAbiertos('ana@x.com', false, ahora);
  assert.ok(voz.length <= A.TOPE_ABIERTOS.compacto, `voz ${voz.length}`);
  assert.ok(texto.length <= A.TOPE_ABIERTOS.normal, `texto ${texto.length}`);
  assert.match(texto, /^QUEDÓ A MEDIAS/);
  assert.match(texto, /Ayer quedamos en/);
  assert.match(texto.split('\n')[1], /\[importante\] Mandarle el contrato firmado a Beto \(ayer, lo prometiste tú, «mañana»\)/);
  assert.equal(A.bloqueAbiertos('nadie@x.com', false), '');
});

test('con el modelo (falso): agrega lo nuevo y cierra por id; con basura o sin modelo, reglas', async () => {
  await A.incorporarAbiertos('luis@x.com', [{ texto: 'Revisar el contrato con el notario', tipo: 'promesa_persona' }]);
  const [ya] = await A.abiertosDe('luis@x.com');
  let pedido = '';
  _usarModeloPrueba(async (_s, user) => {
    pedido = user;
    return JSON.stringify({ abiertos: [{ texto: 'Conseguir el teléfono del topógrafo', tipo: 'promesa_aura', importante: false }, { texto: 'x' }], hechos: [ya.id, 'id-inventado'] });
  });
  const r = await A.extraerAbiertos('luis@x.com', [{ rol: 'user', texto: 'Ya revisé el contrato con el notario. ¿Me consigues el teléfono del topógrafo?' }, { rol: 'ultron', texto: 'Claro, te lo consigo.' }]);
  assert.equal(r.via, 'modelo');
  assert.match(pedido, new RegExp(`${ya.id}: Revisar el contrato`), 'el modelo ve los pendientes con su id');
  assert.deepEqual(r.hechos, [ya.id], 'un id inventado no cierra nada');
  assert.equal(r.abiertos.length, 1, 'lo demasiado corto no entra');
  await A.incorporarAbiertos('luis@x.com', r.abiertos, { fuente: 'modelo', hechos: r.hechos });
  const xs = await A.abiertosDe('luis@x.com');
  assert.deepEqual(
    xs.map((x) => x.texto),
    ['Conseguir el teléfono del topógrafo']
  );
  _usarModeloPrueba(async () => 'lo siento, no puedo');
  const r2 = await A.extraerAbiertos('luis@x.com', [{ rol: 'ultron', texto: 'Te aviso cuando tenga el precio.' }]);
  assert.equal(r2.via, 'reglas');
  assert.equal(r2.abiertos[0].tipo, 'promesa_aura');
  _usarModeloPrueba(null);
  assert.equal((await A.extraerAbiertos('luis@x.com', [{ rol: 'ultron', texto: 'Te aviso cuando tenga el precio.' }])).via, 'reglas', 'modelo caído: reglas');
});

test('S3 caído tras un redespliegue: no se lee como «no tiene nada» ni se sube nada encima', async () => {
  const cubo = new Map<string, string>();
  let caido = false;
  let puts = 0;
  const original = globalThis.fetch;
  globalThis.fetch = (async (url: any, init: any = {}) => {
    const u = new URL(String(url));
    if (!u.hostname.endsWith('.amazonaws.com')) return original(url, init);
    if (caido) return new Response('fuera', { status: 500 });
    const k = decodeURIComponent(u.pathname);
    if (init.method === 'PUT') {
      puts++;
      cubo.set(k, Buffer.from(init.body).toString('utf8'));
      return new Response('', { status: 200 });
    }
    return cubo.has(k) ? new Response(cubo.get(k), { status: 200 }) : new Response('NoSuchKey', { status: 404 });
  }) as typeof fetch;
  Object.assign(process.env, { ULTRON_MEMORIA_BUCKET: 'cubo-prueba', AWS_ACCESS_KEY_ID: 'AKIAPRUEBA', AWS_SECRET_ACCESS_KEY: 'secreto-prueba' });
  try {
    const a = await A.agregarAbierto('beto@x.com', 'Pagar la luz del local', { importante: true });
    assert.ok([...cubo.keys()].some((k) => /^\/ultron\/abiertos\/[0-9a-f]{40}\.json$/.test(k)));
    const guardado = JSON.stringify([...cubo.entries()]);
    A._olvidarCacheAbiertos();
    fs.rmSync(dir, { recursive: true, force: true });
    caido = true;
    const antes = puts;
    await assert.rejects(A.abiertosDe('beto@x.com'), CajonNoDisponible);
    await assert.rejects(A.agregarAbierto('beto@x.com', 'Otra cosa por hacer'), CajonNoDisponible);
    await assert.rejects(A.cerrar('beto@x.com', a.id), CajonNoDisponible);
    assert.deepEqual(await A.incorporarAbiertos('beto@x.com', [{ texto: 'Algo nuevo que hacer mañana', tipo: 'tarea' }]), { agregados: 0, cerrados: 0, guardado: false });
    assert.equal(A.bloqueAbiertos('beto@x.com', false), '');
    assert.equal(puts, antes, 'nada se subió');
    assert.equal(JSON.stringify([...cubo.entries()]), guardado);
    caido = false;
    const xs = await A.abiertosDe('beto@x.com');
    assert.deepEqual(
      xs.map((x) => x.texto),
      ['Pagar la luz del local']
    );
  } finally {
    globalThis.fetch = original;
    Object.assign(process.env, { ULTRON_MEMORIA_BUCKET: '', AWS_ACCESS_KEY_ID: '', AWS_SECRET_ACCESS_KEY: '' });
  }
});
