// Entrar con la cuenta de Veta Wallet (correo y contraseña) por el código REAL de src/lib/genesis.ts:
// el teléfono hace login en la wallet, pide el pase y sigue por el MISMO canje que la vuelta de la
// wallet (POST /api/genesis/entrar {pase, verificador}, token guardado). La contraseña solo viaja a la
// wallet: nunca al servidor de AU-RA. Sin relevo: el chat falla rápido y AU-RA entra igual.
const crypto = require('crypto');
const { ok, fin, movil } = require('./comun.cjs');
const { GENESIS } = movil();
const ss = globalThis.__ss;

const CLAVE = 'Clave-Secreta-123';
const PASE = 'PASE-GENESIS';
const WALLET = 'https://vetawallet-1a2e38ac52b1.herokuapp.com';
const fetchReal = globalThis.fetch;

/** Lo que pide el teléfono a la wallet (con un fetch de mentira) y lo que le llega a AU-RA (api). */
function preparar(sso = { status: 200, cuerpo: { token: PASE } }) {
  const wallet = [];
  const aura = [];
  globalThis.fetch = async (url, init = {}) => {
    if (!String(url).startsWith(WALLET)) return fetchReal(url, init);
    wallet.push({ url: String(url), init, cuerpo: JSON.parse(init.body || '{}') });
    const r = String(url).endsWith('/auth/login') ? { status: 200, cuerpo: { token: 'jwt-wallet', refreshToken: 'r', user: { email: 'ana@prueba.com' } } } : sso;
    return { ok: r.status < 300, status: r.status, json: async () => r.cuerpo };
  };
  globalThis.__api = async (ruta, init) => {
    aura.push({ ruta, init: JSON.stringify(init || {}) });
    if (ruta === '/api/genesis/entrar') return { token: 'token-aura', miembro: { nombre: 'Ana', correo: 'ana@prueba.com', rol: 'Miembro · Genesis ID', gid: 'GEN-1' } };
    if (ruta === '/api/veta/entrar') {
      // AU-RA con el camino sin Genesis cerrado (AURA_VETA_ABIERTO=0) contesta 403 VETA_CERRADO.
      if (globalThis.__vetaCerrado) throw Object.assign(new Error('cerrado'), { status: 403, data: { ok: false, codigo: 'VETA_CERRADO', error: 'cerrado' } });
      return { token: 'token-aura-veta', miembro: { nombre: 'Ana', correo: 'veta:0xabcdef0123456789abcdef0123456789abcdef01', rol: 'Miembro · Veta Wallet', gid: '' } };
    }
    return {};
  };
  return { wallet, aura };
}

(async () => {
  console.log('entrar con la cuenta de Veta Wallet\n');
  ok('la base de la wallet por omisión es la de producción', GENESIS.WALLET_API === WALLET, GENESIS.WALLET_API);

  const { wallet, aura } = preparar();
  const r = await GENESIS.entrarConVetaWallet(' ana@prueba.com ', CLAVE);
  ok('entra', r.ok === true && r.miembro.nombre === 'Ana', JSON.stringify(r));
  ok('login y pase, en ese orden, contra la wallet', wallet.map((p) => p.url.slice(WALLET.length)).join(',') === '/auth/login,/genesis/sso/token');
  ok('el pase se pide con el Bearer de la wallet, para aura y pulse2chat', wallet[1].init.headers.Authorization === 'Bearer jwt-wallet' && wallet[1].cuerpo.aud.join() === 'aura,pulse2chat');
  const canje = aura.find((a) => a.ruta === '/api/genesis/entrar');
  const cuerpoCanje = canje && JSON.parse(JSON.parse(canje.init).body);
  ok('sigue por el canje de siempre: POST /api/genesis/entrar con pase y verificador', !!canje && cuerpoCanje.pase === PASE && !!cuerpoCanje.verificador);
  ok(
    'el verificador del canje es el del reto que se mandó a la wallet',
    crypto.createHash('sha256').update(cuerpoCanje.verificador).digest('base64url') === wallet[1].cuerpo.reto
  );
  ok('la contraseña NO llega al servidor de AU-RA', !JSON.stringify(aura).includes(CLAVE));
  ok('el token de la wallet tampoco', !JSON.stringify(aura).includes('jwt-wallet'));
  ok('la contraseña solo va en el login de la wallet', wallet.filter((p) => JSON.stringify(p).includes(CLAVE)).map((p) => p.url).join() === `${WALLET}/auth/login`);
  ok('sin /auth/logout (cerraría todas las sesiones de la wallet)', !wallet.some((p) => /logout|cerrar-sesion/.test(p.url)));
  const guardado = [...ss.m.entries()].map(([k, v]) => `${k}=${v}`).join('\n');
  ok('la contraseña no queda en SecureStore', !guardado.includes(CLAVE));
  ok('ni el token de la wallet', !guardado.includes('jwt-wallet'));
  ok('el resultado no la lleva', !JSON.stringify(r).includes(CLAVE));

  console.log('\nsin Genesis ID: solo con Veta Wallet (el token, una vez, a /api/veta/entrar)\n');
  for (const codigo of ['GID_SIN_IDENTIDAD', 'CORREO_NO_VERIFICADO', 'GID_PENDIENTE']) {
    const p = preparar({ status: 403, cuerpo: { codigo, error: 'x' } });
    const rv = await GENESIS.entrarConVetaWallet('ana@prueba.com', CLAVE);
    const veta = p.aura.filter((a) => a.ruta === '/api/veta/entrar');
    const cuerpoVeta = veta[0] && JSON.parse(JSON.parse(veta[0].init).body);
    ok(`${codigo} → entra como miembro sin Genesis`, rv.ok === true && rv.miembro.rol === 'Miembro · Veta Wallet' && rv.chat === false, JSON.stringify(rv));
    ok(`${codigo} → a AU-RA va el token de la wallet, una vez, y nada más`, veta.length === 1 && JSON.stringify(cuerpoVeta) === JSON.stringify({ token: 'jwt-wallet' }));
    ok(`${codigo} → la contraseña NO llega a AU-RA`, !JSON.stringify(p.aura).includes(CLAVE));
    ok(`${codigo} → sin pase no hay canje de Genesis`, !p.aura.some((a) => a.ruta === '/api/genesis/entrar'));
  }
  const guardadoVeta = [...ss.m.entries()].map(([k, v]) => `${k}=${v}`).join('\n');
  ok('el token de la wallet no queda guardado en el teléfono', !guardadoVeta.includes('jwt-wallet') && !guardadoVeta.includes(CLAVE));

  console.log('\nclave mala: ni pase ni AU-RA\n');
  const pm = preparar();
  globalThis.fetch = async (url, init = {}) => {
    pm.wallet.push({ url: String(url), init });
    return { ok: false, status: 401, json: async () => ({ message: 'wrong email or password' }) };
  };
  const rm = await GENESIS.entrarConVetaWallet('ana@prueba.com', 'otra-clave-mala');
  ok('401 → «Correo o contraseña incorrectos»', !rm.ok && rm.codigo === 'CLAVE_MALA');
  ok('…y no se le manda nada a AU-RA (ni a /api/veta/entrar)', pm.aura.length === 0);

  console.log('\ncon el camino sin Genesis cerrado, los tratos de siempre\n');
  globalThis.__vetaCerrado = true;
  preparar({ status: 403, cuerpo: { codigo: 'GID_SIN_IDENTIDAD', error: 'Todavía no hay una identidad verificada' } });
  const r2 = await GENESIS.entrarConVetaWallet('ana@prueba.com', CLAVE);
  ok('GID_SIN_IDENTIDAD + VETA_CERRADO → SIN_GID («Crea tu Genesis ID»)', !r2.ok && r2.codigo === 'SIN_GID', JSON.stringify(r2));
  preparar({ status: 403, cuerpo: { codigo: 'GID_PENDIENTE' } });
  const r3 = await GENESIS.entrarConVetaWallet('ana@prueba.com', CLAVE);
  ok('GID_PENDIENTE + VETA_CERRADO → la tarjeta «en verificación»', !r3.ok && r3.codigo === 'GID_PENDIENTE');
  globalThis.__vetaCerrado = false;

  globalThis.fetch = fetchReal;
  fin();
})();
