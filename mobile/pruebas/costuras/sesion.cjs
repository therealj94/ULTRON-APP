// Costura · la sesión guardada en un teléfono compartido. La clave que quedó guardada es de OTRA
// persona (entró con clave y salió); ahora está dentro alguien que entró con Genesis y su token venció.
// Antes api() renovaba con la clave ajena y seguía en la cuenta del otro. Ahora: renovar solo con la
// clave de quien está dentro, y la intro (comprobarSesion) lleva a la entrada si la sesión cayó.
const { ok, fin } = require('../chat/comun.cjs');

(async () => {
  const M = require(process.env.COSTURAS || './out/costuras.cjs');
  const { API } = M;
  console.log('costura · la sesión guardada\n');
  const mesa = globalThis.__mesa;

  // Servidor de mentira: /api/ultron/entrar da un token para quien mande su clave; /api/ultron/sesion
  // reconoce solo los tokens vivos; lo demás exige un token vivo.
  const vivos = new Map([['tok-beto', 'beto@prueba.local']]);
  const entradas = [];
  globalThis.fetch = async (url, init = {}) => {
    const u = new URL(String(url));
    const tok = (init.headers || {})['x-ultron-sesion'];
    const json = (c, s = 200) => new Response(JSON.stringify(c), { status: s, headers: { 'Content-Type': 'application/json' } });
    if (u.pathname === '/api/ultron/entrar') {
      const b = JSON.parse(init.body || '{}');
      entradas.push(b.correo);
      const t = 'tok-' + b.correo.split('@')[0] + '-' + entradas.length;
      vivos.set(t, b.correo);
      return json({ token: t });
    }
    if (u.pathname === '/api/ultron/sesion') {
      const c = vivos.get(tok);
      return json(c ? { authenticated: true, user: { correo: c } } : { authenticated: false, user: null });
    }
    if (u.pathname.startsWith('/api/')) return vivos.has(tok) ? json({ ok: true, de: vivos.get(tok) }) : json({ error: 'sesión requerida' }, 401);
    return json({}, 404);
  };

  // José entró con Genesis (sin clave); su token venció. La clave guardada es la de Beto.
  mesa.sesion = { correo: 'jose@prueba.local', name: 'José' };
  mesa.token = 'tok-jose-vencido';
  mesa.creds = { correo: 'beto@prueba.local', clave: 'la-de-beto' };

  let error = null;
  try {
    await API.api('/api/memoria', undefined, 5000);
  } catch (e) {
    error = e;
  }
  ok('con la clave ajena NO se renueva: nadie entra por Beto', entradas.length === 0, JSON.stringify(entradas));
  ok('la petición falla como sesión caída (401), no en la cuenta del otro', error?.status === 401, String(error?.status));
  ok('el token vencido no se cambió por uno de Beto', mesa.token === 'tok-jose-vencido');

  const e1 = await API.comprobarSesion('jose@prueba.local', 3000);
  ok('la intro ve la sesión caída y manda a entrar', e1 === 'caida', e1);

  // Con la clave de la MISMA persona sí se renueva (el camino de siempre de quien entra con clave).
  mesa.creds = { correo: 'JOSE@prueba.local', clave: 'la-de-jose' };
  const e2 = await API.comprobarSesion('jose@prueba.local', 3000);
  ok('con su propia clave se renueva sola y sigue dentro', e2 === 'viva' && entradas.join() === 'JOSE@prueba.local', `${e2} · ${entradas}`);
  const r = await API.api('/api/memoria', undefined, 5000);
  ok('y las peticiones van con su cuenta', r.de === 'JOSE@prueba.local', JSON.stringify(r));

  // Un token vivo pero de otra cuenta (restaurar el teléfono, cuentas cruzadas) tampoco vale.
  mesa.token = 'tok-beto';
  mesa.creds = null;
  const e3 = await API.comprobarSesion('jose@prueba.local', 3000);
  ok('un token de otra cuenta cuenta como caída', e3 === 'caida', e3);

  // Sin red: no se echa a nadie (la mesa tiene modo local).
  globalThis.fetch = async () => {
    throw new TypeError('Network request failed');
  };
  mesa.token = 'tok-jose-lo-que-sea';
  const e4 = await API.comprobarSesion('jose@prueba.local', 3000);
  ok('sin red: se entra igual', e4 === 'sin_red', e4);

  fin();
})();
