/**
 * Pruebas en Node de la entrada con la cuenta de Veta Wallet (lib/entrarConClave.ts), con un fetch de
 * mentira: el camino bueno (login → pase → el canje de siempre), la clave mala (401), el freno (429),
 * sin Genesis ID, correo sin confirmar, en revisión, cuenta sin atar, la red caída y el tope de 15 s. Y lo
 * que más importa: la contraseña solo viaja a `/auth/login` del backend de la wallet —nunca al servidor
 * de AU-RA ni al canje— y no queda en lo que devuelve; tampoco se llama a `/auth/logout`.
 *
 *   cd mobile && npx tsx src/lib/pruebas/entrarConClave.prueba.mjs
 */
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  AUD_AURA,
  WALLET_API_POR_OMISION,
  baseWallet,
  correoValido,
  entrarConClave,
  errorDelPuente,
  pedirRecuperacion,
} from '../entrarConClave.ts';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const WALLET = 'https://wallet.prueba';
const AURA = 'https://aura-fp.onrender.com';
const CLAVE = 'Clave-Secreta-123';
const CORREO = 'ana@prueba.com';
const TOKEN_WALLET = 'jwt-de-la-wallet';
const PASE = 'PASE-DE-GENESIS';

const pruebas = [];
const prueba = (n, f) => pruebas.push([n, f]);

/** Un reto como el de genesis.ts: verificador al azar y su SHA-256 en base64url. */
function nuevoReto() {
  const verificador = crypto.randomBytes(32).toString('base64url');
  return { verificador, reto: crypto.createHash('sha256').update(verificador).digest('base64url') };
}

const respuesta = (status, cuerpo) => ({ ok: status >= 200 && status < 300, status, json: async () => cuerpo });

/**
 * Una wallet de mentira: `rutas[ruta]` es lo que contesta (una respuesta, o una función del pedido).
 * Anota cada pedido (URL, cabeceras y cuerpo) para mirar después qué salió y hacia dónde.
 */
function walletFalsa(rutas = {}) {
  const pedidos = [];
  const fetch = async (url, init) => {
    pedidos.push({ url, init, cuerpo: init?.body ? JSON.parse(init.body) : null });
    const ruta = url.startsWith(WALLET) ? url.slice(WALLET.length) : url;
    const r = rutas[ruta];
    if (!r) return respuesta(404, { error: 'no existe' });
    return typeof r === 'function' ? r(init, pedidos) : r;
  };
  return { fetch, pedidos };
}

const LOGIN_OK = respuesta(200, { token: TOKEN_WALLET, refreshToken: 'refresco', user: { email: CORREO, name: 'Ana', address: '0xabc' } });
const PASE_OK = respuesta(200, { token: PASE });

/** El canje de siempre (genesis.ts → POST /api/genesis/entrar) de mentira: anota con qué lo llamaron. */
function canjeFalso() {
  const llamadas = [];
  const canjear = async (...args) => {
    llamadas.push({ url: `${AURA}/api/genesis/entrar`, args, cuerpo: JSON.stringify({ pase: args[0], verificador: args[1] }) });
    return { ok: true, miembro: { nombre: 'Ana', correo: CORREO, rol: 'Miembro · Genesis ID', gid: 'GEN-1' }, chat: true, intento: 1 };
  };
  return { canjear, llamadas };
}

function deps(w, c, extra = {}) {
  let reto = null;
  return {
    fetch: w.fetch,
    walletApi: WALLET,
    nuevoReto: () => (reto = nuevoReto()),
    canjear: c.canjear,
    get reto() {
      return reto;
    },
    ...extra,
  };
}

prueba('camino bueno: login → pase con el reto → el canje de siempre con pase y verificador', async () => {
  const w = walletFalsa({ '/auth/login': LOGIN_OK, '/genesis/sso/token': PASE_OK });
  const c = canjeFalso();
  const d = deps(w, c);
  const r = await entrarConClave({ correo: `  ${CORREO} `, clave: CLAVE }, d);
  assert.equal(r.ok, true);
  assert.equal(r.miembro.nombre, 'Ana');
  assert.equal(w.pedidos.length, 2);
  // 1. login con el correo sin espacios
  assert.equal(w.pedidos[0].url, `${WALLET}/auth/login`);
  assert.equal(w.pedidos[0].init.method, 'POST');
  assert.deepEqual(w.pedidos[0].cuerpo, { email: CORREO, password: CLAVE });
  assert.equal(w.pedidos[0].init.headers.Authorization, undefined);
  // 2. pase con el Bearer de la wallet, para aura y pulse2chat, con la huella del verificador
  assert.equal(w.pedidos[1].url, `${WALLET}/genesis/sso/token`);
  assert.equal(w.pedidos[1].init.headers.Authorization, `Bearer ${TOKEN_WALLET}`);
  assert.deepEqual(w.pedidos[1].cuerpo, { aud: AUD_AURA, reto: d.reto.reto });
  assert.deepEqual(AUD_AURA, ['aura', 'pulse2chat']);
  assert.match(d.reto.reto, /^[A-Za-z0-9_-]{43}$/, 'el reto con la forma que exige la wallet');
  // 3. el canje de siempre, con el pase y el verificador que nunca salió del teléfono
  assert.equal(c.llamadas.length, 1);
  assert.deepEqual(c.llamadas[0].args, [PASE, d.reto.verificador]);
  assert.equal(crypto.createHash('sha256').update(c.llamadas[0].args[1]).digest('base64url'), w.pedidos[1].cuerpo.reto);
});

prueba('la contraseña solo va a /auth/login de la wallet; nunca a AU-RA, al canje ni al resultado', async () => {
  const w = walletFalsa({ '/auth/login': LOGIN_OK, '/genesis/sso/token': PASE_OK });
  const c = canjeFalso();
  const r = await entrarConClave({ correo: CORREO, clave: CLAVE }, deps(w, c));
  const conClave = w.pedidos.filter((p) => JSON.stringify(p).includes(CLAVE));
  assert.equal(conClave.length, 1, 'un solo pedido lleva la contraseña');
  assert.equal(conClave[0].url, `${WALLET}/auth/login`);
  assert.ok(w.pedidos.every((p) => p.url.startsWith(WALLET)), 'nada sale hacia otro sitio que la wallet');
  assert.ok(!w.pedidos.some((p) => p.url.includes('aura-fp') || p.url.includes('onrender')), 'ningún pedido a AU-RA lleva nada desde aquí');
  // Lo que va a AU-RA (el canje) no lleva ni la contraseña ni el token de la wallet.
  const aAura = JSON.stringify(c.llamadas);
  assert.ok(!aAura.includes(CLAVE), 'la contraseña no llega al servidor de AU-RA');
  assert.ok(!aAura.includes(TOKEN_WALLET), 'el token de la wallet tampoco');
  // Y no queda en lo que devuelve (ni el token).
  assert.ok(!JSON.stringify(r).includes(CLAVE));
  assert.ok(!JSON.stringify(r).includes(TOKEN_WALLET));
  // El token se suelta sin /auth/logout (cerraría todas las sesiones de la persona en la wallet).
  assert.ok(!w.pedidos.some((p) => /logout|cerrar-sesion/.test(p.url)));
});

prueba('el módulo no guarda la contraseña: nada de estado de módulo ni almacenamiento', async () => {
  const fuente = fs.readFileSync(path.join(AQUI, '../entrarConClave.ts'), 'utf8');
  const codigo = fuente.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  assert.ok(!/^(let|var)\s/m.test(codigo), 'sin variables de módulo que cambien');
  assert.ok(!/SecureStore|AsyncStorage|localStorage|console\.|miga\(/.test(codigo), 'ni cajones ni registros');
  // Dos entradas seguidas: la segunda con otra clave no ve nada de la primera.
  const w = walletFalsa({ '/auth/login': respuesta(401, { message: 'wrong email or password' }) });
  await entrarConClave({ correo: CORREO, clave: CLAVE }, deps(w, canjeFalso()));
  await entrarConClave({ correo: CORREO, clave: 'otra-clave-1' }, deps(w, canjeFalso()));
  assert.equal(JSON.parse(w.pedidos[1].init.body).password, 'otra-clave-1');
});

prueba('401: «Correo o contraseña incorrectos», sin pedir pase ni canjear', async () => {
  const w = walletFalsa({ '/auth/login': respuesta(401, { message: 'wrong email or password' }), '/genesis/sso/token': PASE_OK });
  const c = canjeFalso();
  const r = await entrarConClave({ correo: CORREO, clave: CLAVE }, deps(w, c));
  assert.deepEqual([r.ok, r.codigo], [false, 'CLAVE_MALA']);
  assert.match(r.mensaje, /Correo o contraseña incorrectos/);
  assert.equal(w.pedidos.length, 1);
  assert.equal(c.llamadas.length, 0);
  assert.ok(!JSON.stringify(r).includes(CLAVE));
});

prueba('400 (contraseña corta para la wallet) es lo mismo que una clave mala', async () => {
  const w = walletFalsa({ '/auth/login': respuesta(400, { message: '"password" length must be at least 8 characters long' }) });
  const r = await entrarConClave({ correo: CORREO, clave: 'corta' }, deps(w, canjeFalso()));
  assert.equal(r.codigo, 'CLAVE_MALA');
});

prueba('429 en el login: «Demasiados intentos; espera 15 minutos»', async () => {
  const w = walletFalsa({ '/auth/login': respuesta(429, { message: 'Too many login attempts, please wait 15 minutes' }) });
  const c = canjeFalso();
  const r = await entrarConClave({ correo: CORREO, clave: CLAVE }, deps(w, c));
  assert.deepEqual([r.ok, r.codigo], [false, 'LIMITE']);
  assert.match(r.mensaje, /Demasiados intentos; espera 15 minutos/);
  assert.equal(c.llamadas.length, 0);
});

prueba('sin el camino sin Genesis: GID_SIN_IDENTIDAD → SIN_GID (la pantalla abre «Crea tu Genesis ID»)', async () => {
  const w = walletFalsa({ '/auth/login': LOGIN_OK, '/genesis/sso/token': respuesta(403, { error: 'Todavía no hay una identidad verificada', codigo: 'GID_SIN_IDENTIDAD' }) });
  const c = canjeFalso();
  const r = await entrarConClave({ correo: CORREO, clave: CLAVE }, deps(w, c));
  assert.deepEqual([r.ok, r.codigo], [false, 'SIN_GID']);
  assert.equal(c.llamadas.length, 0);
});

prueba('sin el camino sin Genesis: CORREO_NO_VERIFICADO → «Confirma tu correo en Veta Wallet»', async () => {
  const w = walletFalsa({ '/auth/login': LOGIN_OK, '/genesis/sso/token': respuesta(403, { error: 'Esta cuenta todavía no ha comprobado…', codigo: 'CORREO_NO_VERIFICADO' }) });
  const r = await entrarConClave({ correo: CORREO, clave: CLAVE }, deps(w, canjeFalso()));
  assert.deepEqual([r.ok, r.codigo], [false, 'CORREO_SIN_CONFIRMAR']);
  assert.match(r.mensaje, /Confirma tu correo en Veta Wallet/);
});

prueba('sin el camino sin Genesis: GID_PENDIENTE → la tarjeta «en verificación» de siempre', async () => {
  const w = walletFalsa({ '/auth/login': LOGIN_OK, '/genesis/sso/token': respuesta(403, { error: 'Tu Genesis ID todavía no está verificado.', codigo: 'GID_PENDIENTE' }) });
  const r = await entrarConClave({ correo: CORREO, clave: CLAVE }, deps(w, canjeFalso()));
  assert.equal(r.codigo, 'GID_PENDIENTE');
});

prueba('CUENTA_NO_VINCULADA: se ata (/genesis/vincular) y se pide el pase UNA vez más, como la web', async () => {
  let veces = 0;
  const w = walletFalsa({
    '/auth/login': LOGIN_OK,
    '/genesis/vincular': respuesta(200, { ok: true }),
    '/genesis/sso/token': () => (++veces === 1 ? respuesta(403, { codigo: 'CUENTA_NO_VINCULADA', error: 'no está atada' }) : PASE_OK),
  });
  const c = canjeFalso();
  const r = await entrarConClave({ correo: CORREO, clave: CLAVE }, deps(w, c));
  assert.equal(r.ok, true);
  assert.deepEqual(w.pedidos.map((p) => p.url.slice(WALLET.length)), ['/auth/login', '/genesis/sso/token', '/genesis/vincular', '/genesis/sso/token']);
  assert.equal(w.pedidos[2].init.headers.Authorization, `Bearer ${TOKEN_WALLET}`);
  // Si sigue sin atar: NO_VINCULADA (la tarjeta de siempre), sin bucles.
  const w2 = walletFalsa({ '/auth/login': LOGIN_OK, '/genesis/vincular': respuesta(200, {}), '/genesis/sso/token': respuesta(403, { codigo: 'CUENTA_NO_VINCULADA' }) });
  const r2 = await entrarConClave({ correo: CORREO, clave: CLAVE }, deps(w2, canjeFalso()));
  assert.equal(r2.codigo, 'NO_VINCULADA');
  assert.equal(w2.pedidos.length, 4);
});

prueba('GENESIS_RED / 5xx → RED; un código desconocido muestra el texto de la wallet', async () => {
  const w = walletFalsa({ '/auth/login': LOGIN_OK, '/genesis/sso/token': respuesta(503, { codigo: 'GENESIS_RED', error: 'Genesis ID no contestó.' }) });
  assert.equal((await entrarConClave({ correo: CORREO, clave: CLAVE }, deps(w, canjeFalso()))).codigo, 'RED');
  const w2 = walletFalsa({ '/auth/login': LOGIN_OK, '/genesis/sso/token': respuesta(403, { codigo: 'GID_AJENO', error: 'Esta cuenta está atada a otra identidad de Genesis ID' }) });
  const r2 = await entrarConClave({ correo: CORREO, clave: CLAVE }, deps(w2, canjeFalso()));
  assert.deepEqual([r2.codigo, r2.mensaje], ['GID_AJENO', 'Esta cuenta está atada a otra identidad de Genesis ID']);
  const w3 = walletFalsa({ '/auth/login': LOGIN_OK, '/genesis/sso/token': respuesta(403, { codigo: 'GID_NO_DISPONIBLE', error: 'Tu Genesis ID no puede usarse para entrar en otras aplicaciones.' }) });
  assert.equal((await entrarConClave({ correo: CORREO, clave: CLAVE }, deps(w3, canjeFalso()))).codigo, 'GID_NO_DISPONIBLE');
});

prueba('la misma tabla de códigos que la web de la wallet (codigoAura)', () => {
  assert.equal(errorDelPuente('CORREO_NO_VERIFICADO', 403), 'correo-sin-confirmar');
  assert.equal(errorDelPuente('GID_SIN_IDENTIDAD', 403), 'sin-gid');
  assert.equal(errorDelPuente('GID_PENDIENTE', 403), 'gid-pendiente');
  assert.equal(errorDelPuente('CUENTA_NO_VINCULADA', 403), 'no-vinculada');
  assert.equal(errorDelPuente('LIMITE', 429), 'limite');
  assert.equal(errorDelPuente('GENESIS_RED', 503), 'red');
  assert.equal(errorDelPuente(undefined, 429), 'limite');
  assert.equal(errorDelPuente(undefined, 502), 'red');
  assert.equal(errorDelPuente(undefined, 403), 'fallo');
});

prueba('la red caída: RED_WALLET, sin canje', async () => {
  const c = canjeFalso();
  const r = await entrarConClave({ correo: CORREO, clave: CLAVE }, { ...deps(walletFalsa(), c), fetch: async () => { throw new TypeError('Network request failed'); } });
  assert.deepEqual([r.ok, r.codigo], [false, 'RED_WALLET']);
  assert.match(r.mensaje, /No pude comunicarme con Veta Wallet/);
  assert.equal(c.llamadas.length, 0);
});

prueba('tope: si la wallet no contesta, corta (y aborta el pedido) — 15 s por omisión', async () => {
  let abortado = false;
  const colgado = (_url, init) =>
    new Promise((_, no) => {
      init.signal?.addEventListener('abort', () => {
        abortado = true;
        no(Object.assign(new Error('aborted'), { name: 'AbortError' }));
      });
    });
  const c = canjeFalso();
  const t0 = Date.now();
  const r = await entrarConClave({ correo: CORREO, clave: CLAVE }, { ...deps(walletFalsa(), c), fetch: colgado, topeMs: 60 });
  assert.deepEqual([r.ok, r.codigo], [false, 'RED_WALLET']);
  assert.match(r.mensaje, /tardó demasiado/);
  assert.ok(abortado, 'el pedido se aborta');
  assert.ok(Date.now() - t0 < 2000);
  // Un fetch que ni siquiera sabe de señales también se deja de esperar.
  const sordo = () => new Promise(() => {});
  const r2 = await entrarConClave({ correo: CORREO, clave: CLAVE }, { ...deps(walletFalsa(), c), fetch: sordo, topeMs: 40 });
  assert.equal(r2.codigo, 'RED_WALLET');
  assert.equal(c.llamadas.length, 0);
  // El de verdad: 15 s.
  const fuente = fs.readFileSync(path.join(AQUI, '../entrarConClave.ts'), 'utf8');
  assert.match(fuente, /TOPE_WALLET_MS = 15_000/);
});

prueba('el pase llega pero sin token: FALLO, sin canje; login sin token: FALLO', async () => {
  const c = canjeFalso();
  const w = walletFalsa({ '/auth/login': LOGIN_OK, '/genesis/sso/token': respuesta(200, {}) });
  assert.equal((await entrarConClave({ correo: CORREO, clave: CLAVE }, deps(w, c))).codigo, 'FALLO');
  const w2 = walletFalsa({ '/auth/login': respuesta(200, { user: {} }) });
  assert.equal((await entrarConClave({ correo: CORREO, clave: CLAVE }, deps(w2, c))).codigo, 'FALLO');
  assert.equal(w2.pedidos.length, 1);
  assert.equal(c.llamadas.length, 0);
});

prueba('sin correo válido o sin clave: no sale nada', async () => {
  const w = walletFalsa({ '/auth/login': LOGIN_OK });
  assert.equal((await entrarConClave({ correo: 'ana', clave: CLAVE }, deps(w, canjeFalso()))).codigo, 'CORREO_INVALIDO');
  assert.equal((await entrarConClave({ correo: CORREO, clave: '' }, deps(w, canjeFalso()))).codigo, 'SIN_CLAVE');
  assert.equal(w.pedidos.length, 0);
  assert.ok(correoValido('a.b+c@d.co'));
  assert.ok(!correoValido('a@b'));
});

prueba('la base de la wallet: sin barra final; vacía → la de producción', () => {
  assert.equal(baseWallet('https://x.test///'), 'https://x.test');
  assert.equal(baseWallet(''), WALLET_API_POR_OMISION);
  assert.equal(baseWallet(undefined), 'https://vetawallet-1a2e38ac52b1.herokuapp.com');
});

prueba('«¿Olvidaste tu contraseña?»: el mismo pedido que la web, solo con el correo', async () => {
  const w = walletFalsa({ '/auth/recuperarPassword': respuesta(200, { message: 'Si el correo corresponde…' }) });
  assert.equal(await pedirRecuperacion(` ${CORREO} `, { fetch: w.fetch, walletApi: WALLET }), true);
  assert.deepEqual(w.pedidos[0].cuerpo, { email: CORREO });
  assert.equal(w.pedidos[0].url, `${WALLET}/auth/recuperarPassword`);
  assert.equal(await pedirRecuperacion('no-es-correo', { fetch: w.fetch, walletApi: WALLET }), false);
  assert.equal(w.pedidos.length, 1);
  assert.equal(await pedirRecuperacion(CORREO, { fetch: async () => { throw new Error('red'); }, walletApi: WALLET }), false);
});

/* ── SOLO CON VETA WALLET, SIN GENESIS ID (caso f) ─────────────────────────────────────────────────── */

/** `POST /api/veta/entrar` de mentira: anota qué le llegó a AU-RA. */
function sinGenesisFalso(respuestaAura = { ok: true, miembro: { nombre: 'Ana', correo: 'veta:0xabc', rol: 'Miembro · Veta Wallet', gid: '' }, chat: false, intento: 1 }) {
  const llamadas = [];
  const entrarSinGenesis = async (...args) => {
    llamadas.push({ url: `${AURA}/api/veta/entrar`, args, cuerpo: JSON.stringify({ token: args[0] }) });
    return respuestaAura;
  };
  return { entrarSinGenesis, llamadas };
}

for (const [codigo, status] of [['GID_SIN_IDENTIDAD', 403], ['CORREO_NO_VERIFICADO', 403], ['GID_PENDIENTE', 403], ['GENESIS_RED', 503]]) {
  prueba(`sin pase por ${codigo}: el token de la wallet (y solo él) va UNA vez a AU-RA, nunca la contraseña`, async () => {
    const w = walletFalsa({ '/auth/login': LOGIN_OK, '/genesis/sso/token': respuesta(status, { codigo, error: 'x' }) });
    const c = canjeFalso();
    const s = sinGenesisFalso();
    const r = await entrarConClave({ correo: CORREO, clave: CLAVE }, { ...deps(w, c), entrarSinGenesis: s.entrarSinGenesis });
    assert.equal(r.ok, true);
    assert.equal(r.miembro.correo, 'veta:0xabc');
    assert.equal(s.llamadas.length, 1);
    assert.deepEqual(s.llamadas[0].args, [TOKEN_WALLET], 'solo el token de acceso de la wallet');
    assert.equal(c.llamadas.length, 0, 'no hay pase que canjear');
    const aAura = JSON.stringify([s.llamadas, c.llamadas]);
    assert.ok(!aAura.includes(CLAVE), 'la contraseña no llega a AU-RA');
    assert.ok(!w.pedidos.some((p) => /logout|cerrar-sesion/.test(p.url)));
    assert.ok(!JSON.stringify(r).includes(CLAVE) && !JSON.stringify(r).includes(TOKEN_WALLET));
  });
}

prueba('sin pase porque la ruta no está (404) o la red se cayó al pedirlo: también entra sin Genesis', async () => {
  const s = sinGenesisFalso();
  const w = walletFalsa({ '/auth/login': LOGIN_OK });
  assert.equal((await entrarConClave({ correo: CORREO, clave: CLAVE }, { ...deps(w, canjeFalso()), entrarSinGenesis: s.entrarSinGenesis })).ok, true);
  let n = 0;
  const caeAlSegundo = async (url, init) => (++n === 1 ? LOGIN_OK : Promise.reject(new TypeError('Network request failed')));
  assert.equal((await entrarConClave({ correo: CORREO, clave: CLAVE }, { ...deps(walletFalsa(), canjeFalso()), fetch: caeAlSegundo, entrarSinGenesis: s.entrarSinGenesis })).ok, true);
  assert.equal(s.llamadas.length, 2);
});

prueba('clave mala (401), freno (429), red caída en el login: NO se intenta entrar sin Genesis', async () => {
  for (const login of [respuesta(401, { message: 'wrong email or password' }), respuesta(429, {}), respuesta(400, {})]) {
    const s = sinGenesisFalso();
    const w = walletFalsa({ '/auth/login': login });
    const r = await entrarConClave({ correo: CORREO, clave: CLAVE }, { ...deps(w, canjeFalso()), entrarSinGenesis: s.entrarSinGenesis });
    assert.equal(r.ok, false);
    assert.equal(s.llamadas.length, 0, `con ${login.status} no hay token que mandar`);
  }
  const s = sinGenesisFalso();
  const r = await entrarConClave({ correo: CORREO, clave: CLAVE }, { ...deps(walletFalsa(), canjeFalso()), fetch: async () => { throw new TypeError('Network request failed'); }, entrarSinGenesis: s.entrarSinGenesis });
  assert.equal(r.codigo, 'RED_WALLET');
  assert.equal(s.llamadas.length, 0);
});

prueba('identidad rechazada/bloqueada, de otra persona o el freno de Genesis: NO se entra sin Genesis', async () => {
  for (const codigo of ['GID_NO_DISPONIBLE', 'GID_AJENO', 'CUENTA_NO_ATADA', 'LIMITE']) {
    const s = sinGenesisFalso();
    const w = walletFalsa({ '/auth/login': LOGIN_OK, '/genesis/sso/token': respuesta(codigo === 'LIMITE' ? 429 : 403, { codigo }) });
    const r = await entrarConClave({ correo: CORREO, clave: CLAVE }, { ...deps(w, canjeFalso()), entrarSinGenesis: s.entrarSinGenesis });
    assert.equal(r.ok, false, codigo);
    assert.equal(s.llamadas.length, 0, codigo);
  }
});

prueba('con pase, el camino de Genesis de siempre (conserva el padrón); sin Genesis ni se toca', async () => {
  const s = sinGenesisFalso();
  const c = canjeFalso();
  const w = walletFalsa({ '/auth/login': LOGIN_OK, '/genesis/sso/token': PASE_OK });
  const r = await entrarConClave({ correo: CORREO, clave: CLAVE }, { ...deps(w, c), entrarSinGenesis: s.entrarSinGenesis });
  assert.equal(r.ok, true);
  assert.equal(c.llamadas.length, 1);
  assert.equal(s.llamadas.length, 0);
});

prueba('AU-RA con el camino cerrado (VETA_CERRADO): se dice lo de Genesis, como antes (SIN_GID)', async () => {
  const s = sinGenesisFalso({ ok: false, codigo: 'VETA_CERRADO', mensaje: 'cerrado' });
  const w = walletFalsa({ '/auth/login': LOGIN_OK, '/genesis/sso/token': respuesta(403, { codigo: 'GID_SIN_IDENTIDAD' }) });
  const r = await entrarConClave({ correo: CORREO, clave: CLAVE }, { ...deps(w, canjeFalso()), entrarSinGenesis: s.entrarSinGenesis });
  assert.deepEqual([r.ok, r.codigo], [false, 'SIN_GID']);
  // Otro error de AU-RA (suspendida, wallet caída…) se dice tal cual.
  const s2 = sinGenesisFalso({ ok: false, codigo: 'SUSPENDIDA', mensaje: 'Esta cuenta está suspendida.' });
  const r2 = await entrarConClave({ correo: CORREO, clave: CLAVE }, { ...deps(w, canjeFalso()), entrarSinGenesis: s2.entrarSinGenesis });
  assert.equal(r2.codigo, 'SUSPENDIDA');
});

/* ── 10-oct: «pase no válido» al instante con correo y contraseña de la wallet ─────────────────────────── */

/** Un canje que AU-RA rechaza con `codigo` (lo que devuelve genesis.ts `canjearPase` al fallar). */
function canjeQueFalla(codigo) {
  const llamadas = [];
  const canjear = async (...args) => {
    llamadas.push(args);
    return { ok: false, codigo, mensaje: `AU-RA dice ${codigo}` };
  };
  return { canjear, llamadas };
}

for (const codigo of ['PASE_INVALIDO', 'GID_PENDIENTE', 'MAL_CONFIGURADO', 'SIN_GENESIS', 'GENESIS_CAIDO']) {
  prueba(`la wallet dio el pase pero AU-RA lo rechaza (${codigo}): entra igual con la cuenta de la wallet, el token UNA vez`, async () => {
    const s = sinGenesisFalso();
    const c = canjeQueFalla(codigo);
    const w = walletFalsa({ '/auth/login': LOGIN_OK, '/genesis/sso/token': PASE_OK });
    const r = await entrarConClave({ correo: CORREO, clave: CLAVE }, { ...deps(w, c), entrarSinGenesis: s.entrarSinGenesis });
    assert.equal(r.ok, true, 'entra como miembro de la wallet');
    assert.equal(r.miembro.correo, 'veta:0xabc', 'la identidad es la de la wallet, nunca la de Genesis');
    assert.equal(c.llamadas.length, 1, 'el canje de Genesis se intentó primero');
    assert.equal(s.llamadas.length, 1, 'el token va una sola vez');
    assert.deepEqual(s.llamadas[0].args, [TOKEN_WALLET]);
    assert.ok(!JSON.stringify(s.llamadas).includes(CLAVE), 'la contraseña no va a AU-RA');
  });
}

prueba('AU-RA rechaza el canje por la PERSONA (bloqueada, suspendida, padrón, sin comprobar, freno, sin conexión): NO hay otra puerta', async () => {
  for (const codigo of ['BLOQUEADA', 'SUSPENDIDA', 'PENDIENTE', 'CUENTA_SIN_COMPROBAR', 'LIMITE', 'SIN_CONEXION', 'VENCIDO', 'FALLO']) {
    const s = sinGenesisFalso();
    const w = walletFalsa({ '/auth/login': LOGIN_OK, '/genesis/sso/token': PASE_OK });
    const r = await entrarConClave({ correo: CORREO, clave: CLAVE }, { ...deps(w, canjeQueFalla(codigo)), entrarSinGenesis: s.entrarSinGenesis });
    assert.deepEqual([r.ok, r.codigo], [false, codigo]);
    assert.equal(s.llamadas.length, 0, codigo);
  }
});

prueba('pase rechazado y AU-RA con el camino de la wallet cerrado (VETA_CERRADO): se dice lo del canje', async () => {
  const s = sinGenesisFalso({ ok: false, codigo: 'VETA_CERRADO', mensaje: 'cerrado' });
  const w = walletFalsa({ '/auth/login': LOGIN_OK, '/genesis/sso/token': PASE_OK });
  const r = await entrarConClave({ correo: CORREO, clave: CLAVE }, { ...deps(w, canjeQueFalla('PASE_INVALIDO')), entrarSinGenesis: s.entrarSinGenesis });
  assert.deepEqual([r.ok, r.codigo], [false, 'PASE_INVALIDO']);
});

prueba('backend de la wallet de antes: 403/400 SIN código al pedir el pase → entra igual sin Genesis; 401 no', async () => {
  for (const [status, cuerpo] of [[403, { error: 'Todavía no hay una identidad verificada' }], [400, { error: 'Hacen falta un GID válido y la cuenta' }]]) {
    const s = sinGenesisFalso();
    const w = walletFalsa({ '/auth/login': LOGIN_OK, '/genesis/sso/token': respuesta(status, cuerpo) });
    const r = await entrarConClave({ correo: CORREO, clave: CLAVE }, { ...deps(w, canjeFalso()), entrarSinGenesis: s.entrarSinGenesis });
    assert.equal(r.ok, true, `${status}`);
    assert.equal(s.llamadas.length, 1);
  }
  const s = sinGenesisFalso();
  const w = walletFalsa({ '/auth/login': LOGIN_OK, '/genesis/sso/token': respuesta(401, { message: 'invalid token' }) });
  const r = await entrarConClave({ correo: CORREO, clave: CLAVE }, { ...deps(w, canjeFalso()), entrarSinGenesis: s.entrarSinGenesis });
  assert.equal(r.ok, false);
  assert.equal(s.llamadas.length, 0);
});

let ok = 0;
for (const [n, f] of pruebas) {
  try {
    await f();
    ok++;
    console.log(`ok - ${n}`);
  } catch (e) {
    console.log(`FALLA - ${n}\n  ${e.message}`);
  }
}
console.log(`\n${ok}/${pruebas.length} pruebas de la entrada con la cuenta de Veta Wallet`);
if (ok !== pruebas.length) process.exit(1);
