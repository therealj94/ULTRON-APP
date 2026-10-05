// Identidad · qué build corre el teléfono, para el servidor (evidencia de operación, 5-oct; lib/recepcion.ts).
//
//  RC1  Cada petición de api() lleva `x-aura-cliente` con el build (plataforma, versión, runtime, OTA) y el id de la
//       instalación; sin datos del build (o si fallan) no va, y la petición sale igual.
//  RC2  El id es de la cuenta que está dentro: estable mientras sigue, OTRO al cambiar de cuenta, ninguno sin nadie
//       dentro, y al salir se borra del teléfono (la misma cuenta, al volver, estrena id).
//  RC3  Sobrevive a un arranque en frío (SecureStore) para la misma cuenta.
//  RC4  Nada del aparato en la cabecera: ni modelo, ni serie; un valor con separadores no se cuela.
const { ok, fin } = require('../chat/comun.cjs');

(async () => {
  const M = require(process.env.IDENTIDAD || './out/identidad.cjs');
  const { API, CUENTA, RECEPCION } = M;
  console.log('identidad · el build del teléfono para el servidor\n');
  if (!RECEPCION || !RECEPCION.fijarDatosBuild) {
    ok('RC1: hay lib/recepcion con fijarDatosBuild', false);
    return fin();
  }
  const mesa = globalThis.__mesa || (globalThis.__mesa = { token: '', creds: null, sesion: null });
  const ss = globalThis.__ss || (globalThis.__ss = { m: new Map(), fallarLectura: 0, fallarEscritura: 0 });
  const UUID = '0b9f3c2e-1a2b-4c3d-8e9f-0123456789ab';
  const datos = { plataforma: 'android', version: '5.3.0', build: 53, runtime: 'f3a1c09e5b7d', updateId: UUID, canal: 'production', embebido: false, creada: new Date('2026-10-04T20:00:00Z'), os: '14' };
  const enviadas = [];
  globalThis.fetch = async (_url, init = {}) => {
    enviadas.push(init.headers || {});
    return new Response('{"ok":true}', { status: 200 });
  };
  const pedir = async () => {
    enviadas.length = 0;
    await API.api('/api/perfil').catch(() => null);
    return enviadas[0] || {};
  };
  const idDe = (h) => /;i=([^;]+)$/.exec(h['x-aura-cliente'] || '')?.[1] || '';

  RECEPCION._reiniciarRecepcion();
  mesa.token = 'tok-A';
  mesa.sesion = { correo: 'a@prueba.local' };
  CUENTA.fijarCuenta('a@prueba.local', { nueva: true });

  /* ── RC1 ───────────────────────────────────────────────────────────────────────────── */
  let h = await pedir();
  ok('RC1: sin datos del build no va la cabecera (y la petición sale igual)', !('x-aura-cliente' in h) && h['x-ultron-sesion'] === 'tok-A', JSON.stringify(h));
  RECEPCION.fijarDatosBuild(() => datos);
  h = await pedir();
  const c = h['x-aura-cliente'] || '';
  ok('RC1: con datos, va el build', c.startsWith('v1;p=android;v=5.3.0;b=53;rt=f3a1c09e5b7d;u=' + UUID + ';c=production;e=0;uc=2026-10-04T20:00:00.000Z;os=14;i='), c);
  ok('RC1: junto con la sesión de siempre', h['x-ultron-sesion'] === 'tok-A');
  const idA = idDe(h);
  ok('RC2: con un id de instalación', /^[A-Za-z0-9-]{8,64}$/.test(idA), idA);
  ok('RC2: estable mientras sigue la misma cuenta', idDe(await pedir()) === idA);
  RECEPCION.fijarDatosBuild(() => {
    throw new Error('expo-updates roto');
  });
  h = await pedir();
  ok('RC1: si los datos fallan, sin cabecera y la petición sale', !('x-aura-cliente' in h) && h['x-ultron-sesion'] === 'tok-A');

  /* ── RC4 ───────────────────────────────────────────────────────────────────────────── */
  RECEPCION.fijarDatosBuild(() => ({ ...datos, version: '5.3.0;modelo=Pixel', canal: 'prod uction' }));
  h = await pedir();
  ok('RC4: un valor con separadores o espacios no se cuela', !/Pixel|modelo|uction/.test(h['x-aura-cliente'] || ''), h['x-aura-cliente']);
  RECEPCION.fijarDatosBuild(() => datos);

  /* ── RC2: cambiar de cuenta, salir, volver ─────────────────────────────────────────── */
  mesa.token = 'tok-B';
  mesa.sesion = { correo: 'b@prueba.local' };
  CUENTA.fijarCuenta('b@prueba.local');
  const idB = idDe(await pedir());
  ok('RC2: otra cuenta, otro id', !!idB && idB !== idA, `${idA} / ${idB}`);
  CUENTA.fijarCuenta(null);
  mesa.token = 'tok-suelto';
  h = await pedir();
  ok('RC2: sin nadie dentro no va la cabecera', !('x-aura-cliente' in h), JSON.stringify(h));
  await new Promise((r) => setTimeout(r, 5));
  ok('RC2: al salir, el id se borra del teléfono', !ss.m.has('aura.recepcion.v1'), JSON.stringify([...ss.m.keys()]));
  mesa.token = 'tok-A2';
  mesa.sesion = { correo: 'a@prueba.local' };
  CUENTA.fijarCuenta('a@prueba.local');
  const idA2 = idDe(await pedir());
  ok('RC2: la misma cuenta, tras salir, estrena id', !!idA2 && idA2 !== idA && idA2 !== idB, `${idA} / ${idA2}`);

  /* ── RC3: arranque en frío ─────────────────────────────────────────────────────────── */
  RECEPCION._reiniciarRecepcion();
  RECEPCION.fijarDatosBuild(() => datos);
  ok('RC3: tras un arranque en frío, la misma cuenta conserva su id', idDe(await pedir()) === idA2);
  ok('RC3: lo guardado no lleva el correo', !String(ss.m.get('aura.recepcion.v1') || '').includes('prueba.local'), ss.m.get('aura.recepcion.v1'));

  RECEPCION._reiniciarRecepcion();
  fin();
})();
