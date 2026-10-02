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

  console.log('\nCaso c · sin la app Orden Global: SIN_WALLET, sin saltar a ningún lado\n');
  rn.openURL = async () => {
    throw new Error('no app');
  };
  let webAbierta = 0;
  globalThis.__wb = async () => {
    webAbierta++;
    return { type: 'dismiss' };
  };
  r = await GENESIS.entrarConGenesis();
  ok('sin la app → SIN_WALLET con mensaje', r.ok === false && r.codigo === 'SIN_WALLET' && /Orden Global/.test(r.mensaje), JSON.stringify(r));
  ok('no se abre la web sola (la persona elige: instalar, web o correo)', webAbierta === 0);
  ok('el pedido se borra: sin app no lo guarda nadie', pendiente() === null);
  ok('no quedan oyentes', oyentes() === 0, String(oyentes()));
  // «Usar Veta Wallet en la web»: directo a la web, sin volver a probar la app.
  let probóApp = false;
  rn.openURL = async () => {
    probóApp = true;
    throw new Error('no app');
  };
  globalThis.__wb = async (url) => ({ type: 'success', url: `${WEB}?pase=PASE&estado=${new URLSearchParams(url.split('?')[1]).get('estado')}` });
  r = await GENESIS.entrarConGenesis({ web: true });
  ok('{ web: true } entra por la web sin tocar la app', r.ok === true && !probóApp, JSON.stringify(r));

  console.log('\nCaso b · la wallet guarda el pedido mientras se saca el Genesis ID y vuelve TARDE\n');
  ok('el pedido vive media hora, como en la wallet (AURA_VIVE_MS)', GENESIS.VIDA_PEDIDO_MS === 30 * 60_000, String(GENESIS.VIDA_PEDIDO_MS));
  // La persona va a la wallet, no tiene Genesis ID, empieza a sacarlo y vuelve a AU-RA a mano (sin pase).
  rn.openURL = async () => {};
  globalThis.__wb = async () => ({ type: 'dismiss' });
  const pb = GENESIS.entrarConGenesis();
  await espera(30);
  const estB = pendiente().estado;
  rn.app.forEach((f) => f('background'));
  rn.app.forEach((f) => f('active'));
  r = await pb;
  ok('volvió sin pase → SIN_VUELTA', r.codigo === 'SIN_VUELTA', JSON.stringify(r));
  ok('…pero el pedido QUEDA: la app Orden Global se abrió y puede tenerlo guardado', pendiente()?.estado === estB);
  ok('no quedan esperas abiertas', oyentes() === 0, String(oyentes()));
  // Ya con su Genesis ID, la wallet vuelve con el pase de ESTE pedido; AU-RA está abierta en «Entrar».
  const tardias = [];
  const soltar = GENESIS.escucharVueltaTardia((x) => tardias.push(x));
  rn.url.forEach((f) => f({ url: `${WEB}?pase=AJENO&estado=otro-estado-cualquiera` }));
  await espera(30);
  ok('una vuelta tardía con otro estado no hace nada', tardias.length === 0 && pendiente()?.estado === estB);
  rn.url.forEach((f) => f({ url: `${WEB}?pase=PASE&estado=${estB}` }));
  await espera(50);
  ok('la vuelta tardía con el estado del pedido entra sola', tardias.length === 1 && tardias[0].ok === true && tardias[0].miembro?.gid === 'GEN-AAAA-BBBB-C', JSON.stringify(tardias));
  ok('…y gasta el pedido (no se canjea dos veces)', pendiente() === null);
  rn.url.forEach((f) => f({ url: `ultronfp://sso?pase=PASE&estado=${estB}` }));
  await espera(30);
  ok('la misma vuelta repetida (https + ultronfp) no entra otra vez', tardias.length === 1);
  // Con una espera abierta, la vuelta es de la espera: la tardía no la toca (no hay doble canje).
  const pd = GENESIS.entrarConGenesis();
  await espera(30);
  const estD = pendiente().estado;
  rn.url.forEach((f) => f({ url: `${WEB}?pase=PASE&estado=${estD}` }));
  r = await pd;
  await espera(30);
  ok('a tiempo entra por la espera, y la tardía no canjea encima', r.ok === true && tardias.length === 1, JSON.stringify(tardias));
  // La wallet devuelve el error del alta (en revisión): llega como cualquier vuelta.
  const pg = GENESIS.entrarConGenesis();
  await espera(30);
  const estG = pendiente().estado;
  rn.app.forEach((f) => f('background'));
  rn.app.forEach((f) => f('active'));
  await pg;
  rn.url.forEach((f) => f({ url: `${WEB}?error=gid-pendiente&estado=${estG}` }));
  await espera(50);
  ok('si el Genesis ID quedó en revisión, la vuelta tardía trae GID_PENDIENTE', tardias.length === 2 && tardias[1].codigo === 'GID_PENDIENTE', JSON.stringify(tardias[1]));
  soltar();
  ok('al soltar la escucha no queda oyente', oyentes() === 0, String(oyentes()));
  console.log('\nWeb de la wallet · la pestaña segura con redirect https\n');
  rn.openURL = async () => {
    throw new Error('no app');
  };
  let abierta = null;
  globalThis.__wb = async (url, redirect) => {
    abierta = { url, redirect };
    return { type: 'success', url: `${WEB}?pase=PASE&estado=${new URLSearchParams(url.split('?')[1]).get('estado')}` };
  };
  r = await GENESIS.entrarConGenesis({ web: true });
  ok('openAuthSessionAsync recibe como redirect la URL https', abierta?.redirect === WEB, JSON.stringify(abierta));
  ok('la web también lleva vuelta=https', new URLSearchParams(abierta.url.split('?')[1]).get('vuelta') === WEB, abierta.url);
  ok('la vuelta https de la pestaña entra', r.ok === true, JSON.stringify(r));
  ok('no quedan oyentes', oyentes() === 0, String(oyentes()));

  // El dominio sin verificar: la vuelta https se abre DENTRO de la pestaña, la página /sso devuelve con
  // intent:// → llega ultronfp://…, que la pestaña (que espera la https) no reconoce. Entra igual.
  let cerrarPestana = null;
  globalThis.__wb = () => new Promise((listo) => (cerrarPestana = () => listo({ type: 'dismiss' })));
  const pw = GENESIS.entrarConGenesis({ web: true });
  await espera(30);
  rn.url.forEach((f) => f({ url: `ultronfp://sso?pase=PASE&estado=${pendiente().estado}` }));
  r = await pw;
  ok('con la pestaña abierta, la vuelta ultronfp:// de la página /sso entra', r.ok === true, JSON.stringify(r));
  cerrarPestana();
  await espera(10);
  ok('no quedan oyentes tras la vuelta por intent', oyentes() === 0, String(oyentes()));

  // La pestaña se cierra y el enlace llega detrás del cierre (dentro de la gracia): entra igual.
  globalThis.__wb = async () => ({ type: 'dismiss' });
  const pt = GENESIS.entrarConGenesis({ web: true });
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
  r = await GENESIS.entrarConGenesis({ web: true });
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
  ss.m.set('aura.genesis.pendiente', JSON.stringify({ verificador, estado: 'EST-FRIO', en: Date.now() - 25 * 60_000 }));
  rn.inicial = `${WEB}?pase=PASE&estado=EST-FRIO`;
  r = await GENESIS.retomarSiVolvio();
  ok('el arranque en frío retoma la vuelta https, aun con un pedido de 25 min (sacó el Genesis ID en la wallet)', r && r.ok === true, JSON.stringify(r));
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
