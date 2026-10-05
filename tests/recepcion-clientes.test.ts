/**
 * QUÉ BUILD CORRE CADA APARATO (evidencia de operación, 5-oct: «publicar la actualización no confirma que ya funcione
 * bien en tu teléfono»). lib/recepcion-clientes.ts, server/build-rutas.ts y los dos clientes que arman la cabecera:
 *  · la cabecera se valida campo por campo (formas, topes); sin plataforma o sin id de instalación, nada;
 *  · por cuenta, las últimas 10 instalaciones; el id crudo no se guarda (hash con la huella de la cuenta);
 *  · como mucho una escritura cada 10 min por instalación, salvo que cambie el build; un fallo deja reintentar;
 *  · GET /api/build: cada cuenta ve SOLO lo suyo; la clave de mesa sin sesión no ve a nadie; sin sesión, 401;
 *  · el SHA web se compara con el que sirve el servidor (sí/no); la OTA, «desconocido» (el servidor no la sabe);
 *  · sin cabecera (cliente viejo o apagado) no se anota nada;
 *  · el teléfono (mobile/src/lib/recepcionDescriptor.ts) y la web (src/10-infra/recepcion.ts) arman lo que el
 *    servidor entiende; la web renueva su id al cambiar la sesión y lleva el SHA de la página.
 */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import type { AddressInfo } from 'node:net';

process.env.ULTRON_SESION_SECRETO = 'secreto-de-prueba-largo-para-recepcion-clientes';
process.env.ULTRON_MESA_CLAVE = 'clave-de-mesa-de-prueba-recepcion';
const R = await import('../lib/recepcion-clientes');
const { almacenEnMemoria } = await import('../lib/durable');
const { montarRecepcion, montarRutaBuild } = await import('../server/build-rutas');
const { exigirMesa, sesionDe, emitirSesion } = await import('../server/seguridad');
const M = await import('../mobile/src/lib/recepcionDescriptor');
const W = await import('../src/10-infra/recepcion');

const UUID = '0b9f3c2e-1a2b-4c3d-8e9f-0123456789ab';
const RT = 'f3a1c09e5b7d2468ace013579bdf2468ace01357';
const cab = (extra = '', i = 'inst-aaaa-0001') => `v1;p=android;v=5.3.0;b=53;rt=${RT};u=${UUID};c=production;e=0;uc=2026-10-04T20:00:00.000Z;os=14;i=${i}${extra}`;

/* ------------------------------------------------------------------ la cabecera */

test('la cabecera completa se lee campo por campo', () => {
  const d = R.leerDescriptor(cab())!;
  assert.deepEqual(d, {
    instalacion: 'inst-aaaa-0001',
    plataforma: 'android',
    version: '5.3.0',
    build: '53',
    runtime: RT,
    updateId: UUID,
    canal: 'production',
    embebido: false,
    creada: '2026-10-04T20:00:00.000Z',
    webSha: null,
    os: '14',
  });
});

test('sanea: lo que no tiene su forma se descarta; sin plataforma o id válidos, nada', () => {
  assert.equal(R.leerDescriptor(undefined), null);
  assert.equal(R.leerDescriptor(''), null);
  assert.equal(R.leerDescriptor(42), null);
  assert.equal(R.leerDescriptor('p=android;i=inst-aaaa-0001'), null, 'sin versión de formato');
  assert.equal(R.leerDescriptor('v1;p=android'), null, 'sin id de instalación');
  assert.equal(R.leerDescriptor('v1;p=blackberry;i=inst-aaaa-0001'), null, 'plataforma desconocida');
  assert.equal(R.leerDescriptor('v1;p=android;i=corto'), null, 'id demasiado corto');
  assert.equal(R.leerDescriptor('v1;p=android;i=' + 'a'.repeat(65)), null, 'id demasiado largo');
  assert.equal(R.leerDescriptor('v1;p=web;i=inst-aaaa-0001;w=' + 'a'.repeat(R.TOPE_CABECERA)), null, 'cabecera demasiado larga');
  const sucio = R.leerDescriptor('v1;p=android;i=inst-aaaa-0001;v=5.3.0 <script>;b=53a;rt=../../etc;u=no-es-hex!;c=prod uction;e=2;uc=ayer;os=1234;w=xyz;modelo=Pixel 8;serie=ABC')!;
  assert.ok(sucio, 'el id y la plataforma bastan');
  for (const k of ['version', 'build', 'runtime', 'updateId', 'canal', 'embebido', 'creada', 'os', 'webSha'] as const) assert.equal(sucio[k], null, `${k} sucio se descarta`);
  assert.ok(!JSON.stringify(sucio).includes('Pixel') && !JSON.stringify(sucio).includes('ABC'), 'lo desconocido (modelo, serie) no entra');
  const repetida = R.leerDescriptor('v1;p=ios;i=inst-aaaa-0001;p=android;v=1.0.0;v=9.9.9')!;
  assert.equal(repetida.plataforma, 'ios', 'una clave repetida vale la primera vez');
  assert.equal(repetida.version, '1.0.0');
  assert.equal(R.leerDescriptor(['v1;p=web;i=inst-aaaa-0001'])?.plataforma, 'web', 'cabecera repetida: la primera');
  const futuro = R.leerDescriptor('v1;p=android;i=inst-aaaa-0001;uc=2099-01-01T00:00:00Z')!;
  assert.equal(futuro.creada, null, 'una fecha absurda no se guarda');
  assert.equal(R.leerDescriptor('v1;p=web;i=inst-aaaa-0001;w=ABCDEF1234567')!.webSha, 'abcdef1234567', 'hex en minúsculas');
});

test('la firma del build cambia con el build, no con la instalación', () => {
  const a = R.leerDescriptor(cab())!;
  const b = R.leerDescriptor(cab('', 'inst-bbbb-0002'))!;
  const c = R.leerDescriptor(cab().replace(UUID, '1b9f3c2e-1a2b-4c3d-8e9f-0123456789ab'))!;
  assert.equal(R.firmaBuild(a), R.firmaBuild(b));
  assert.notEqual(R.firmaBuild(a), R.firmaBuild(c));
});

/* ------------------------------------------------------------------ el registro por cuenta */

test('por cuenta: las últimas 10 instalaciones, la más reciente primero; `primero` se conserva; el id crudo no se guarda', () => {
  let reg: any = null;
  const t0 = Date.parse('2026-10-05T10:00:00Z');
  for (let n = 0; n < 13; n++) reg = R.anotarCliente(reg, 'jose@x.com', R.leerDescriptor(cab('', `inst-${String(n).padStart(4, '0')}-zz`))!, t0 + n * 1000);
  assert.equal(reg.clientes.length, R.MAX_INSTALACIONES);
  assert.equal(reg.clientes[0].visto, new Date(t0 + 12_000).toISOString());
  assert.ok(!JSON.stringify(reg).includes('inst-'), 'el id de la instalación no se guarda tal cual');
  assert.ok(reg.clientes.every((c: any) => /^[0-9a-f]{16}$/.test(c.instalacion)));
  // La más vieja que quedó (n=3) vuelve: sube arriba y conserva cuándo se vio la primera vez.
  const antes = reg.clientes.find((c: any) => c.instalacion === R.hashInstalacion('jose@x.com', 'inst-0003-zz'));
  assert.ok(antes);
  reg = R.anotarCliente(reg, 'jose@x.com', R.leerDescriptor(cab('', 'inst-0003-zz'))!, t0 + 60_000);
  assert.equal(reg.clientes.length, R.MAX_INSTALACIONES);
  assert.equal(reg.clientes[0].instalacion, antes.instalacion);
  assert.equal(reg.clientes[0].primero, antes.primero);
  // El mismo id en otra cuenta da otro hash: no se cruzan.
  assert.notEqual(R.hashInstalacion('jose@x.com', 'inst-0003-zz'), R.hashInstalacion('otra@x.com', 'inst-0003-zz'));
  // Lo roto del almacén no rompe.
  assert.deepEqual(R.registroValido({ clientes: [{ instalacion: 'x', plataforma: 'android', visto: 'nunca' }, null] }).clientes, []);
  assert.deepEqual(R.registroValido('basura').clientes, []);
});

test('el freno: una vez cada 10 min por instalación, salvo que cambie el build; con tope de entradas', () => {
  const f = new R.FrenoRecepcion(R.ESPACIO_ESCRITURA_MS, 3);
  const t = 1_000_000;
  assert.equal(f.toca('k1', 'A', t), true);
  assert.equal(f.toca('k1', 'A', t + 60_000), false, 'mismo build, al minuto: no');
  assert.equal(f.toca('k1', 'B', t + 61_000), true, 'build nuevo (una OTA aplicada): sí, en el acto');
  assert.equal(f.toca('k1', 'B', t + 61_000 + R.ESPACIO_ESCRITURA_MS - 1), false);
  assert.equal(f.toca('k1', 'B', t + 61_000 + R.ESPACIO_ESCRITURA_MS), true, 'a los 10 min: sí');
  f.toca('k2', 'A', t);
  f.toca('k3', 'A', t);
  f.toca('k4', 'A', t);
  assert.equal(f.tamano, 3, 'con tope');
});

test('registrar: va a la cuenta de la sesión, frenado; sin cabecera o sin cuenta, nada; un fallo deja reintentar', async () => {
  const a = almacenEnMemoria();
  const freno = new R.FrenoRecepcion();
  const t = Date.parse('2026-10-05T10:00:00Z');
  assert.equal(await R.registrarCliente('jose@x.com', undefined, { almacen: a, freno, ahora: t }), 'sin-cabecera');
  assert.equal(await R.registrarCliente('jose@x.com', 'v1;p=android', { almacen: a, freno, ahora: t }), 'invalida');
  assert.equal(await R.registrarCliente(null, cab(), { almacen: a, freno, ahora: t }), 'sin-cuenta');
  assert.equal(a.objetos.size, 0, 'nada guardado');
  assert.equal(await R.registrarCliente('Jose@X.com', cab(), { almacen: a, freno, ahora: t }), 'guardada');
  assert.equal(await R.registrarCliente('jose@x.com', cab(), { almacen: a, freno, ahora: t + 1000 }), 'frenada');
  const nueva = cab().replace(UUID, '1b9f3c2e-1a2b-4c3d-8e9f-0123456789ab');
  assert.equal(await R.registrarCliente('jose@x.com', nueva, { almacen: a, freno, ahora: t + 2000 }), 'guardada', 'la OTA nueva se anota en el acto');
  const l = await R.clientesDe('jose@x.com', a);
  assert.ok(l.ok);
  assert.equal(l.ok && l.clientes.length, 1, 'la misma instalación, actualizada');
  assert.equal(l.ok && l.clientes[0].updateId, '1b9f3c2e-1a2b-4c3d-8e9f-0123456789ab');
  const otra = await R.clientesDe('otra@x.com', a);
  assert.ok(otra.ok && otra.clientes.length === 0, 'otra cuenta no ve lo de José');
  assert.ok(![...a.objetos.keys()].some((k) => k.includes('jose')), 'la clave lleva la huella, no el correo');

  // El almacén falla: «fallo», y la siguiente petición lo vuelve a intentar (no queda frenada).
  const roto = { tipo: 's3' as const, multiReplica: true, leer: async () => ({ ok: false as const, detalle: 'S3 503 https://bucket.interno' }), crear: async () => ({ ok: false as const, conflicto: false as const, detalle: 'x' }), cas: async () => ({ ok: false as const, conflicto: false as const, detalle: 'x' }) };
  const f2 = new R.FrenoRecepcion();
  assert.equal(await R.registrarCliente('jose@x.com', cab(), { almacen: roto, freno: f2, ahora: t }), 'fallo');
  assert.equal(await R.registrarCliente('jose@x.com', cab(), { almacen: a, freno: f2, ahora: t + 1000 }), 'guardada', 'tras el fallo no quedó frenada');
  const leido = await R.clientesDe('jose@x.com', roto);
  assert.equal(leido.ok, false);
  assert.ok(!leido.ok && !leido.detalle.includes('bucket.interno'), 'el detalle no filtra direcciones');
});

test('comparar: web contra el SHA servido (sí/no); teléfono «desconocido» sin la OTA publicada; Windows «desconocido»', () => {
  const t = '2026-10-05T10:00:00.000Z';
  const base = { instalacion: 'a'.repeat(16), primero: t, visto: t, version: null, build: null, runtime: RT, updateId: UUID, canal: 'production', embebido: false, creada: null, webSha: null, os: null };
  const SHA = '0123456789abcdef0123456789abcdef01234567';
  assert.deepEqual(R.compararCliente({ ...base, plataforma: 'web', webSha: '0123456' }, { webSha: SHA }), { esperado: SHA, recibido: 'sí' }, 'corto y completo son el mismo');
  assert.deepEqual(R.compararCliente({ ...base, plataforma: 'web', webSha: 'fedcba9876543' }, { webSha: SHA }), { esperado: SHA, recibido: 'no' });
  assert.deepEqual(R.compararCliente({ ...base, plataforma: 'web', webSha: null }, { webSha: SHA }), { esperado: SHA, recibido: 'desconocido' });
  assert.deepEqual(R.compararCliente({ ...base, plataforma: 'web', webSha: '0123456' }, { webSha: 'desconocido' }), { esperado: 'desconocido', recibido: 'desconocido' });
  assert.deepEqual(R.compararCliente({ ...base, plataforma: 'android' }, { webSha: SHA }), { esperado: 'desconocido', recibido: 'desconocido' }, 'el servidor no sabe la OTA publicada: no inventa');
  assert.deepEqual(R.compararCliente({ ...base, plataforma: 'android' }, { webSha: SHA, ota: { [RT]: UUID } }), { esperado: UUID, recibido: 'sí' });
  assert.deepEqual(R.compararCliente({ ...base, plataforma: 'android' }, { webSha: SHA, ota: { [RT]: '1b9f3c2e-1a2b-4c3d-8e9f-0123456789ab' } }).recibido, 'no');
  assert.deepEqual(R.compararCliente({ ...base, plataforma: 'windows' }, { webSha: SHA }), { esperado: 'desconocido', recibido: 'desconocido' });
  const v = R.vistaClientes([{ ...base, plataforma: 'android' }], { webSha: SHA })[0];
  assert.equal(v.instalacion, 'aaaaaa', 'solo 6 del hash, para distinguir aparatos');
});

/* ------------------------------------------------------------------ los clientes arman lo que el servidor entiende */

test('teléfono: el descriptor sale de expo-updates/expo-constants/Platform y el servidor lo entiende', () => {
  const datos = M.datosDeExpo({
    updates: { isEnabled: true, updateId: UUID, runtimeVersion: RT, channel: 'production', isEmbeddedLaunch: false, createdAt: new Date('2026-10-04T20:00:00Z') },
    constants: { expoConfig: { version: '5.3.0', android: { versionCode: 53 } } },
    platform: { OS: 'android', Version: 34, constants: { Release: '14', Model: 'Pixel 8', Serial: 'ABC123', Fingerprint: 'google/huella' } as object },
  })!;
  const h = M.descriptorCliente(datos, 'inst-aaaa-0001');
  assert.equal(h, cab(), 'la misma cabecera que espera el servidor');
  assert.ok(!/Pixel|ABC123|huella/.test(h), 'nada del aparato');
  assert.deepEqual(R.leerDescriptor(h)?.os, '14', 'la versión mayor de Android, no el nivel de API');
  // El JS de fábrica (sin OTA): e=1.
  const fabrica = M.datosDeExpo({ updates: { isEnabled: true, updateId: UUID, runtimeVersion: RT, channel: 'production', isEmbeddedLaunch: true, createdAt: null }, constants: null, platform: { OS: 'android', constants: { Release: '13' } } })!;
  assert.equal(R.leerDescriptor(M.descriptorCliente(fabrica, 'inst-aaaa-0001'))?.embebido, true);
  // Sin expo-updates (desarrollo): solo versión y sistema; iOS «17.4» → 17.
  const ios = M.datosDeExpo({ updates: { isEnabled: false }, constants: { expoConfig: { version: '5.3.0', ios: { buildNumber: '7' } } }, platform: { OS: 'ios', Version: '17.4' } })!;
  const dios = R.leerDescriptor(M.descriptorCliente(ios, 'inst-aaaa-0001'))!;
  assert.deepEqual([dios.plataforma, dios.version, dios.build, dios.updateId, dios.embebido, dios.os], ['ios', '5.3.0', '7', null, null, '17']);
  assert.equal(M.datosDeExpo({ platform: { OS: 'web' } }), null, 'la web no usa este armador');
  assert.equal(M.descriptorCliente(datos, 'x'), '', 'sin id válido no se manda nada');
  const sucio = M.descriptorCliente({ ...datos, version: '5.3; i=otra', canal: 'prod;p=web' }, 'inst-aaaa-0001');
  assert.ok(!sucio.includes('otra') && !sucio.includes('p=web'), 'un valor con separadores no se cuela');
});

test('web: lleva el SHA de la página; sin sesión, nada; el id se renueva al cambiar la sesión', () => {
  const m = new Map<string, string>();
  const almacen = { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) };
  const SHA = '0123456789abcdef0123456789abcdef01234567';
  const doc = { querySelector: (s: string) => (s === 'meta[name="aura-build"]' ? { getAttribute: () => SHA } : null) };
  assert.deepEqual(W.cabeceraCliente('', { almacen, doc }), {}, 'sin sesión no se manda');
  const h1 = W.cabeceraCliente('tok', { almacen, doc })[W.CABECERA_CLIENTE];
  const d1 = R.leerDescriptor(h1)!;
  assert.equal(d1.plataforma, 'web');
  assert.equal(d1.webSha, SHA, 'el descriptor web lleva el SHA del build');
  assert.equal(R.leerDescriptor(W.cabeceraCliente('tok', { almacen, doc })[W.CABECERA_CLIENTE])!.instalacion, d1.instalacion, 'estable mientras dura la sesión');
  W.renovarInstalacionWeb(almacen);
  assert.notEqual(R.leerDescriptor(W.cabeceraCliente('tok2', { almacen, doc })[W.CABECERA_CLIENTE])!.instalacion, d1.instalacion, 'otra sesión, otro id');
  // En desarrollo no hay meta: va sin `w` (y el servidor lo enseña como «desconocido»).
  const sinMeta = R.leerDescriptor(W.cabeceraCliente('tok', { almacen, doc: { querySelector: () => null } })[W.CABECERA_CLIENTE])!;
  assert.equal(sinMeta.webSha, null);
  assert.equal(W.shaDeLaPagina({ querySelector: () => ({ getAttribute: () => 'desconocido' }) }), null);
  assert.deepEqual(W.cabeceraCliente('tok', { almacen: null, doc }), {}, 'sin almacenamiento, nada');
});

/* ------------------------------------------------------------------ la ruta */

const almacen = almacenEnMemoria();
const SHA_SERVIDO = 'abcdef0123456789abcdef0123456789abcdef01';
const app = express();
const pasa = () => ((_q: express.Request, _s: express.Response, n: express.NextFunction) => n()) as express.RequestHandler;
const cuentaDe = (req: express.Request) => sesionDe(req)?.correo?.toLowerCase() || null;
montarRecepcion(app, { cuentaDe, almacen });
montarRutaBuild(app, {
  exigirMesa,
  limitar: pasa,
  cuentaDe,
  almacen,
  manifiesto: async () => ({ commit: 'c0ffee0', web: { sha: SHA_SERVIDO, hora: '2026-10-05T09:00:00.000Z' } }) as any,
  almacenSalud: async () => ({ ok: true, tipo: 'memoria', multiReplica: false, lectura: true, escritura: true, ms: 1, comprobado: '2026-10-05T09:00:00.000Z' }),
});
app.get('/api/eco', (_req, res) => res.json({ ok: true }));
const srv = app.listen(0, '127.0.0.1');
await new Promise((r) => srv.once('listening', r));
const base = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
after(() => srv.close());

const jose = emitirSesion({ correo: 'jose@x.com', nombre: 'José', rol: 'Junta' }, { comunidad: true }).token;
const otra = emitirSesion({ correo: 'otra@x.com', nombre: 'Otra', rol: 'Junta' }, { comunidad: true }).token;
const esperarEscritura = async (correo: string, n: number) => {
  for (let i = 0; i < 50; i++) {
    const l = await R.clientesDe(correo, almacen);
    if (l.ok && l.clientes.length >= n) return;
    await new Promise((r) => setTimeout(r, 10));
  }
};

test('ruta: el teléfono y la web de José se anotan en SU cuenta; /api/build se los enseña solo a él', async () => {
  // Sin cabecera (un cliente viejo): la petición sigue igual y no se anota nada.
  assert.equal((await fetch(`${base}/api/eco`, { headers: { 'x-ultron-sesion': jose } })).status, 200);
  // Con cabecera y sin sesión: tampoco (no hay de quién).
  assert.equal((await fetch(`${base}/api/eco`, { headers: { 'x-aura-cliente': cab() } })).status, 200);
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(almacen.objetos.size, 0, 'sin cabecera o sin sesión no se guarda nada');

  // El teléfono de José (una OTA) y su web con el SHA que se sirve.
  assert.equal((await fetch(`${base}/api/eco`, { headers: { 'x-ultron-sesion': jose, 'x-aura-cliente': cab() } })).status, 200);
  await esperarEscritura('jose@x.com', 1);
  await fetch(`${base}/api/eco`, { headers: { 'x-ultron-sesion': jose, 'x-aura-cliente': `v1;p=web;w=${SHA_SERVIDO};i=web-inst-0001` } });
  await esperarEscritura('jose@x.com', 2);
  // Un cabecera rota no rompe la petición.
  assert.equal((await fetch(`${base}/api/eco`, { headers: { 'x-ultron-sesion': jose, 'x-aura-cliente': 'v1;p=android;i=<script>' } })).status, 200);

  const r = await fetch(`${base}/api/build`, { headers: { 'x-ultron-sesion': jose } });
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('cache-control'), 'no-store');
  const j: any = await r.json();
  assert.equal(j.commit, 'c0ffee0', 'el manifiesto de siempre sigue');
  assert.equal(j.recepcion.cuenta, true);
  assert.equal(j.recepcion.almacen, 'ok');
  assert.equal(j.recepcion.esperado.web, SHA_SERVIDO);
  assert.equal(j.recepcion.esperado.ota, 'desconocido', 'la OTA publicada no la sabe el servidor: lo dice');
  assert.equal(j.clientes.length, 2);
  const tel = j.clientes.find((c: any) => c.plataforma === 'android');
  const web = j.clientes.find((c: any) => c.plataforma === 'web');
  assert.deepEqual(
    { plataforma: tel.plataforma, version: tel.version, runtime: tel.runtime, updateId: tel.updateId, canal: tel.canal, embebido: tel.embebido, esperado: tel.esperado, recibido: tel.recibido },
    { plataforma: 'android', version: '5.3.0', runtime: RT, updateId: UUID, canal: 'production', embebido: false, esperado: 'desconocido', recibido: 'desconocido' }
  );
  assert.ok(Date.parse(tel.visto) > 0);
  assert.equal(web.webSha, SHA_SERVIDO);
  assert.equal(web.recibido, 'sí');
  assert.ok(!JSON.stringify(j).includes('inst-aaaa-0001') && !JSON.stringify(j).includes('web-inst-0001'), 'el id de la instalación no sale');

  // Otra cuenta: ve lo suyo (nada), nunca lo de José.
  const o: any = await (await fetch(`${base}/api/build`, { headers: { 'x-ultron-sesion': otra } })).json();
  assert.equal(o.recepcion.cuenta, true);
  assert.deepEqual(o.clientes, []);
  // Ella abre una web vieja: la ve como «no recibido», en SU cuenta.
  await fetch(`${base}/api/eco`, { headers: { 'x-ultron-sesion': otra, 'x-aura-cliente': 'v1;p=web;w=1111111;i=web-inst-0001' } });
  await esperarEscritura('otra@x.com', 1);
  const o2: any = await (await fetch(`${base}/api/build`, { headers: { 'x-ultron-sesion': otra } })).json();
  assert.equal(o2.clientes.length, 1);
  assert.equal(o2.clientes[0].recibido, 'no');
  const j2: any = await (await fetch(`${base}/api/build`, { headers: { 'x-ultron-sesion': jose } })).json();
  assert.equal(j2.clientes.length, 2, 'lo de la otra cuenta no entra en la de José (aunque el id de instalación coincida)');

  // La clave de mesa sin sesión no es una cuenta: el manifiesto sí, los aparatos de nadie.
  const m: any = await (await fetch(`${base}/api/build`, { headers: { 'x-ultron-mesa': process.env.ULTRON_MESA_CLAVE! } })).json();
  assert.equal(m.recepcion.cuenta, false);
  assert.deepEqual(m.clientes, []);
  // Sin sesión ni clave: 401, como antes.
  assert.equal((await fetch(`${base}/api/build`)).status, 401);
});
