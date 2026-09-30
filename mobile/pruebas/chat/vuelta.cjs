// La vuelta de la wallet por https (App Link) y por ultronfp:// (compatibilidad), y los códigos de
// error del contrato con la wallet. Sin relevo: solo la lógica de src/lib/genesis.ts.
const { ok, fin, espera, movil } = require('./comun.cjs');
const { GENESIS } = movil();
const rn = globalThis.__rn;
const ss = globalThis.__ss;
// Oyentes de AppState del propio módulo (chats.ts escucha desde que se carga): no son de la entrada.
const BASE_APP = rn.app.length;
const oyentes = () => rn.url.length + rn.app.length - BASE_APP;

const WEB = 'https://aura-fp.onrender.com/sso';
const pendiente = () => JSON.parse(ss.m.get('aura.genesis.pendiente') || 'null');
const entra = { token: 't', miembro: { nombre: 'Ana', correo: 'a@b.c', rol: 'x', gid: 'GEN-AAAA-BBBB-C' } };
globalThis.__api = async (ruta) => (ruta === '/api/genesis/entrar' ? entra : {});

/** Una entrada por la app Orden Global que vuelve con `vuelta(estado)`; devuelve el resultado y lo pedido. */
async function porLaApp(vuelta) {
  let pedido = null;
  rn.openURL = async (u) => {
    pedido = u;
  };
  const p = GENESIS.entrarConGenesis();
  await espera(30);
  const est = pendiente()?.estado;
  rn.url.forEach((f) => f({ url: vuelta(est) }));
  return { r: await p, pedido };
}

(async () => {
  console.log('leerVuelta · las dos formas\n');
  const L = GENESIS.leerVuelta;
  ok('https …/sso?… sí', L(`${WEB}?pase=a&estado=b`)?.pase === 'a' && L(`${WEB}?pase=a&estado=b`)?.estado === 'b');
  ok('https …/sso/?… sí', L(`${WEB}/?pase=a&estado=b`)?.pase === 'a');
  ok('https …/sso#… sí (sin datos)', JSON.stringify(L(`${WEB}#x`)) === '{}');
  ok('https con error y estado', JSON.stringify(L(`${WEB}?error=gid-pendiente&estado=b`)) === '{"error":"gid-pendiente","estado":"b"}');
  ok('ultronfp://sso?… sigue valiendo', L('ultronfp://sso?pase=a&estado=b')?.pase === 'a');
  ok('mayúsculas en esquema y dominio', L('HTTPS://AURA-FP.ONRENDER.COM/sso?pase=a&estado=b')?.pase === 'a');
  for (const u of [
    'https://aura-fp.onrender.com/ssoXYZ?pase=a&estado=b',
    'https://aura-fp.onrender.com.malo.test/sso?pase=a&estado=b',
    'https://aura-fp.onrender.com/sso@malo.test?pase=a&estado=b',
    'http://aura-fp.onrender.com/sso?pase=a&estado=b',
    'https://malo.test/sso?pase=a&estado=b',
    'https://aura-fp.onrender.com/otra?pase=a&estado=b',
    'https://malo.test/?r=https://aura-fp.onrender.com/sso&pase=a&estado=b',
  ]) {
    ok(`no es vuelta: ${u}`, L(u) === null, JSON.stringify(L(u)));
  }
  let lanzo = false;
  try {
    L(`${WEB}?pase=%E0%A4%A&estado=x`);
  } catch {
    lanzo = true;
  }
  ok('https con un % roto no lanza, y el valor roto se descarta', !lanzo && L(`${WEB}?pase=%E0%A4%A&estado=x`)?.estado === 'x' && !L(`${WEB}?pase=%E0%A4%A&estado=x`)?.pase);

  console.log('\nApp Orden Global · pide la vuelta https y acepta las dos\n');
  let { r, pedido } = await porLaApp((est) => `${WEB}?pase=PASE&estado=${est}`);
  const q = new URLSearchParams(String(pedido).split('?')[1] || '');
  ok('el pedido va a vetawallet://sso con destino=aura', String(pedido).startsWith('vetawallet://sso?') && q.get('destino') === 'aura', pedido);
  ok('lleva vuelta=https://aura-fp.onrender.com/sso (codificada)', q.get('vuelta') === WEB && String(pedido).includes('vuelta=https%3A%2F%2Faura-fp.onrender.com%2Fsso'), pedido);
  ok('lleva reto y estado', /^[A-Za-z0-9_-]{43}$/.test(q.get('reto') || '') && (q.get('estado') || '').length >= 8);
  ok('la vuelta https entra', r.ok === true, JSON.stringify(r));
  ({ r } = await porLaApp((est) => `ultronfp://sso?pase=PASE&estado=${est}`));
  ok('la vuelta ultronfp:// (APK/wallet vieja o la página /sso) también entra', r.ok === true, JSON.stringify(r));

  // Una vuelta https con OTRO estado no termina la espera; la buena de después, sí.
  rn.openURL = async () => {};
  const p = GENESIS.entrarConGenesis();
  await espera(30);
  const est = pendiente().estado;
  rn.url.forEach((f) => f({ url: `${WEB}?pase=AJENO&estado=otro-estado-cualquiera` }));
  ok('una vuelta https con otro estado no se lleva la espera', rn.url.length === 1);
  rn.url.forEach((f) => f({ url: `${WEB}?pase=PASE&estado=${est}` }));
  ok('…y la buena de después entra', (await p).ok === true);

  console.log('\nWeb de la wallet · la pestaña segura con redirect https\n');
  rn.openURL = async () => {
    throw new Error('no app');
  };
  let abierta = null;
  globalThis.__wb = async (url, redirect) => {
    abierta = { url, redirect };
    return { type: 'success', url: `${WEB}?pase=PASE&estado=${new URLSearchParams(url.split('?')[1]).get('estado')}` };
  };
  r = await GENESIS.entrarConGenesis();
  ok('openAuthSessionAsync recibe como redirect la URL https', abierta?.redirect === WEB, JSON.stringify(abierta));
  ok('la web también lleva vuelta=https', new URLSearchParams(abierta.url.split('?')[1]).get('vuelta') === WEB, abierta.url);
  ok('la vuelta https de la pestaña entra', r.ok === true, JSON.stringify(r));
  ok('no quedan oyentes', oyentes() === 0, String(oyentes()));

  // El dominio sin verificar: la vuelta https se abre DENTRO de la pestaña, la página /sso devuelve con
  // intent:// → llega ultronfp://…, que la pestaña (que espera la https) no reconoce. Entra igual.
  let cerrarPestana = null;
  globalThis.__wb = () => new Promise((listo) => (cerrarPestana = () => listo({ type: 'dismiss' })));
  const pw = GENESIS.entrarConGenesis();
  await espera(30);
  rn.url.forEach((f) => f({ url: `ultronfp://sso?pase=PASE&estado=${pendiente().estado}` }));
  r = await pw;
  ok('con la pestaña abierta, la vuelta ultronfp:// de la página /sso entra', r.ok === true, JSON.stringify(r));
  cerrarPestana();
  await espera(10);
  ok('no quedan oyentes tras la vuelta por intent', oyentes() === 0, String(oyentes()));

  // La pestaña se cierra y el enlace llega detrás del cierre (dentro de la gracia): entra igual.
  globalThis.__wb = async () => ({ type: 'dismiss' });
  const pt = GENESIS.entrarConGenesis();
  await espera(200);
  rn.url.forEach((f) => f({ url: `${WEB}?pase=PASE&estado=${pendiente().estado}` }));
  r = await pt;
  ok('un enlace que llega justo después de cerrar la pestaña no se pierde', r.ok === true, JSON.stringify(r));

  console.log('\niOS · sin App Link: la vuelta de siempre\n');
  rn.os = 'ios';
  globalThis.__wb = async (url, redirect) => {
    abierta = { url, redirect };
    return { type: 'success', url: `ultronfp://sso?pase=PASE&estado=${new URLSearchParams(url.split('?')[1]).get('estado')}` };
  };
  r = await GENESIS.entrarConGenesis();
  ok('en iOS el redirect es ultronfp://sso y no se manda vuelta', abierta.redirect === 'ultronfp://sso' && !abierta.url.includes('vuelta='), JSON.stringify(abierta));
  ok('…y entra', r.ok === true);
  rn.os = undefined;

  console.log('\nCódigos de error del contrato con la wallet\n');
  const esperados = {
    cancelado: 'CANCELADO',
    'sin-gid': 'SIN_GID',
    'gid-pendiente': 'GID_PENDIENTE',
    'no-vinculada': 'NO_VINCULADA',
    'correo-sin-confirmar': 'CORREO_SIN_CONFIRMAR',
    limite: 'LIMITE',
    red: 'RED',
    fallo: 'FALLO',
    'algo-nuevo': 'FALLO',
  };
  for (const [error, codigo] of Object.entries(esperados)) {
    ({ r } = await porLaApp((est) => `${WEB}?error=${error}&estado=${est}`));
    ok(`error=${error} → ${codigo}, con mensaje`, r.ok === false && r.codigo === codigo && r.mensaje.length > 10, JSON.stringify(r));
  }
  ok('gid-pendiente dice que entra con el mismo botón (no que cree otro)', /en verificación; cuando lo aprueben, entrás con este mismo botón/.test(GENESIS.errorDeWallet('gid-pendiente').mensaje));
  // Un error con otro estado no es de este pedido: no corta la espera (nadie ajeno cancela la entrada).
  rn.openURL = async () => {};
  const pe = GENESIS.entrarConGenesis();
  await espera(30);
  rn.url.forEach((f) => f({ url: `${WEB}?error=cancelado&estado=otro-estado-cualquiera` }));
  ok('un error con estado ajeno no se toma como respuesta', rn.url.length === 1);
  rn.url.forEach((f) => f({ url: `${WEB}?pase=PASE&estado=${pendiente().estado}` }));
  ok('…y la vuelta propia de después entra', (await pe).ok === true);

  console.log('\nLo que contesta el servidor de AU-RA\n');
  const falla = (e) => async (ruta) => {
    if (ruta !== '/api/genesis/entrar') return {};
    throw e;
  };
  globalThis.__api = falla(Object.assign(new Error('HTTP 429'), { status: 429, data: {} }));
  ({ r } = await porLaApp((est) => `${WEB}?pase=PASE&estado=${est}`));
  ok('429 → LIMITE', r.codigo === 'LIMITE', JSON.stringify(r));
  globalThis.__api = falla(Object.assign(new Error('x'), { status: 401, data: { codigo: 'SIN_VERIFICAR', error: 'Tu identidad todavía no está verificada en Genesis ID.' } }));
  ({ r } = await porLaApp((est) => `${WEB}?pase=PASE&estado=${est}`));
  ok('SIN_VERIFICAR → GID_PENDIENTE (la misma tarjeta)', r.codigo === 'GID_PENDIENTE', JSON.stringify(r));
  globalThis.__api = falla(new TypeError('Network request failed'));
  ({ r } = await porLaApp((est) => `${WEB}?pase=PASE&estado=${est}`));
  ok('sin respuesta del servidor → SIN_CONEXION', r.codigo === 'SIN_CONEXION', JSON.stringify(r));
  globalThis.__api = falla(Object.assign(new Error('x'), { status: 403, data: { codigo: 'PENDIENTE', gid: 'GEN-AAAA-BBBB-C', error: 'Tu acceso quedó pedido.' } }));
  ({ r } = await porLaApp((est) => `${WEB}?pase=PASE&estado=${est}`));
  ok('PENDIENTE del padrón pasa tal cual, con su gid', r.codigo === 'PENDIENTE' && r.gid === 'GEN-AAAA-BBBB-C', JSON.stringify(r));
  globalThis.__api = async (ruta) => (ruta === '/api/genesis/entrar' ? entra : {});

  console.log('\nArranque en frío y chat\n');
  const { verificador } = GENESIS.nuevoReto();
  ss.m.set('aura.genesis.pendiente', JSON.stringify({ verificador, estado: 'EST-FRIO', en: Date.now() }));
  rn.inicial = `${WEB}?pase=PASE&estado=EST-FRIO`;
  r = await GENESIS.retomarSiVolvio();
  ok('el arranque en frío retoma la vuelta https', r && r.ok === true, JSON.stringify(r));
  rn.inicial = null;

  rn.openURL = async () => {};
  const pc = GENESIS.conectarChat();
  await espera(30);
  rn.url.forEach((f) => f({ url: `${WEB}?error=no-vinculada&estado=${pendiente().estado}` }));
  const c = await pc;
  ok('conectar el chat con no-vinculada explica cómo vincular', c.ok === false && /vincul/i.test(c.mensaje || ''), JSON.stringify(c));
  fin();
})().catch((e) => {
  console.error('ERR', e);
  process.exit(1);
});
