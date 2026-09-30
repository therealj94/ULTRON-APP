// Identidad · el token en un teléfono compartido (auditoría A03, A19).
//
//  R1  El logout de A tarda; mientras, entra B y guarda su token; el logout de A termina: antes dejaba
//      el almacén en null (B quedaba fuera). Ahora: el token de B sigue, y al servidor solo se le pidió
//      cerrar el de A, sin renovar nada.
//  A19 Una renovación que nunca contesta no retiene la petición más allá de su tope; y una renovación
//      que vuelve cuando ya está otra persona no guarda ese token.
const { ok, fin } = require('../chat/comun.cjs');

const espera = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const M = require(process.env.IDENTIDAD || './out/identidad.cjs');
  const { API, CUENTA } = M;
  const mesa = globalThis.__mesa;
  console.log('identidad · el token de la sesión\n');

  /* ── R1: logout tardío ─────────────────────────────────────────────────────────────── */
  mesa.token = 'tok-A';
  mesa.sesion = { correo: 'a@prueba.local' };
  mesa.creds = { correo: 'a@prueba.local', clave: 'la-de-a' };
  const pedidos = [];
  let soltarSalir = null;
  globalThis.fetch = (url, init = {}) => {
    const u = new URL(String(url));
    pedidos.push({ ruta: u.pathname, token: (init.headers || {})['x-ultron-sesion'] });
    if (u.pathname === '/api/ultron/salir') return new Promise((r) => (soltarSalir = () => r(new Response('{"ok":true}', { status: 401 }))));
    return Promise.resolve(new Response('{"token":"tok-renovado"}', { status: 200 }));
  };
  const salida = API.logoutRemote();
  await espera(10);
  ok('al empezar, el token de A ya no está en el teléfono', mesa.token === '', JSON.stringify(mesa.token));
  // Entra B mientras el servidor no contesta.
  mesa.token = 'tok-B';
  mesa.sesion = { correo: 'b@prueba.local' };
  soltarSalir?.();
  await salida;
  ok('R1: el logout tardío de A NO borra el token de B', mesa.token === 'tok-B', JSON.stringify(mesa.token));
  ok('al servidor se le pidió cerrar SOLO el token de A', pedidos.filter((p) => p.ruta === '/api/ultron/salir').every((p) => p.token === 'tok-A'));
  ok('un 401 al cerrar no dispara la renovación del token que se cierra', !pedidos.some((p) => p.ruta === '/api/ultron/entrar'), JSON.stringify(pedidos));

  // Sin red: el token igual se suelta del teléfono (y no se toca otro).
  mesa.token = 'tok-C';
  globalThis.fetch = async () => {
    throw new TypeError('Network request failed');
  };
  await API.logoutRemote();
  ok('sin red: el token de quien salió se suelta igual', mesa.token === '');

  /* ── A19: la persona cambia mientras renueva ───────────────────────────────────────── */
  CUENTA?.fijarCuenta('a@prueba.local', { nueva: true });
  mesa.token = 'tok-A-vencido';
  mesa.sesion = { correo: 'a@prueba.local' };
  mesa.creds = { correo: 'a@prueba.local', clave: 'la-de-a' };
  let soltarRenovar = null;
  globalThis.fetch = (url) => {
    const u = new URL(String(url));
    if (u.pathname === '/api/ultron/entrar') return new Promise((r) => (soltarRenovar = () => r(new Response('{"token":"tok-A-nuevo"}', { status: 200 }))));
    return Promise.resolve(new Response('{"error":"sesión requerida"}', { status: 401 }));
  };
  const pedido = Promise.race([API.api('/api/perfil', undefined, 8000), espera(3000)]).catch((e) => e);
  await espera(20);
  // A sale y entra B antes de que vuelva la renovación.
  CUENTA?.fijarCuenta('b@prueba.local');
  mesa.sesion = { correo: 'b@prueba.local' };
  mesa.token = 'tok-B';
  soltarRenovar?.();
  await pedido;
  ok('A19: la renovación de A que vuelve tarde NO guarda su token encima del de B', mesa.token === 'tok-B', mesa.token);

  /* ── A19: renovación sin fin ───────────────────────────────────────────────────────── */
  CUENTA?.fijarCuenta('a@prueba.local');
  mesa.token = 'tok-A-vencido';
  mesa.sesion = { correo: 'a@prueba.local' };
  mesa.creds = { correo: 'a@prueba.local', clave: 'la-de-a' };
  let renovaciones = 0;
  globalThis.fetch = (url, init = {}) => {
    const u = new URL(String(url));
    if (u.pathname === '/api/ultron/entrar') {
      renovaciones++;
      // Nunca contesta (hasta que la aborten).
      return new Promise((_r, no) => init.signal?.addEventListener('abort', () => no(new Error('abortado'))));
    }
    return Promise.resolve(new Response('{"error":"sesión requerida"}', { status: 401 }));
  };
  const t0 = Date.now();
  let err = null;
  try {
    // Con guarda propia: el código de antes se quedaba colgado para siempre aquí.
    const colgado = new Promise((_r, no) => setTimeout(() => no(Object.assign(new Error('colgado'), { status: 'colgado' })), 5000));
    await Promise.race([API.api('/api/memoria', undefined, 1200), colgado]);
  } catch (e) {
    err = e;
  }
  const tardo = Date.now() - t0;
  ok('A19: una renovación que no contesta no retiene la petición más allá de su tope', tardo < 2500, `${tardo} ms`);
  ok('…y la petición falla como sesión caída', err?.status === 401, String(err?.status));
  ok('se intentó renovar una vez', renovaciones === 1, String(renovaciones));

  fin();
})();
