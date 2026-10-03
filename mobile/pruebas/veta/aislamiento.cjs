// Veta Wallet y la cartera · de quién es cada respuesta (AUR01, documento maestro del 3-oct).
//
// Un teléfono compartido: A entra a AURA y a su Veta Wallet, empieza algo (renovar la sesión, recargar,
// preguntar en qué va la recarga, leer su perfil), sale, entra B… y la respuesta de A llega después.
// Antes: el refresh de A volvía a poner el token (y el refreshToken) en el llavero GLOBAL y la tarjeta de A
// aparecía con B dentro; la recarga y su consulta tardías llegaban como éxito; la cartera del perfil de A
// quedaba como la de B (y se subía a SU perfil); y las llaves `aura.veta.*` no eran de nadie: las heredaba
// quien abriera la pantalla. Todo sintético: servidor de mentira, cuentas de mentira, sin dinero.
const { ok, fin } = require('../chat/comun.cjs');
const { sesion, desbloqueo, recarga, conexion, cuenta } = require('./out/veta.cjs');
const ss = globalThis.__ss;
const la = globalThis.__la || (globalThis.__la = { hw: true, enrolado: true, tipos: [1] });
const rel = globalThis.__relevo || (globalThis.__relevo = { yo: null, ficha: async () => null });

const A = 'ana@aura.test';
const B = 'beto@aura.test';
const sA = cuenta.seudonimoDe(A);
const espera = (ms) => new Promise((r) => setTimeout(r, ms));
const b64u = (o) => Buffer.from(JSON.stringify(o)).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
const jwt = (exp, extra = {}) => `h.${b64u({ exp, ...extra })}.f`;
globalThis.atob = (s) => Buffer.from(s, 'base64').toString('binary');
const ahoraS = () => Math.floor(Date.now() / 1000);
const esVencida = (e) => !!e && e.tipo === 'vencida';
const retenida = () => {
  let soltar;
  const p = new Promise((r) => (soltar = r));
  return { p, soltar };
};

/* ── el servidor de Veta Wallet, de mentira (respeta el AbortController, como fetch) ───────── */
const llamadas = [];
let rutas = {};
globalThis.fetch = (url, init = {}) => {
  const ruta = String(url).replace(sesion.VETA_API, '');
  const l = { ruta, auth: (init.headers || {}).Authorization || null, cuerpo: init.body ? JSON.parse(init.body) : undefined, signal: init.signal };
  llamadas.push(l);
  return new Promise((listo, mal) => {
    const abortar = () => mal(Object.assign(new Error('aborted'), { name: 'AbortError' }));
    if (init.signal && init.signal.aborted) return abortar();
    if (init.signal) init.signal.addEventListener('abort', abortar);
    const r = typeof rutas[ruta] === 'function' ? rutas[ruta](l.cuerpo, init) : rutas[ruta];
    Promise.resolve(r).then((x) => {
      const [status, json] = x || [404, { message: 'no route' }];
      listo({ ok: status >= 200 && status < 300, status, json: async () => json });
    });
  });
};

/* ── el servidor de AURA, de mentira: anota DE QUIÉN era la sesión al salir cada petición ──── */
const enviadosAura = [];
let rutasAura = {};
globalThis.__api = (ruta, init) => {
  const metodo = init.method || 'GET';
  enviadosAura.push({ ruta, metodo, quien: cuenta.correoCuenta(), cuerpo: String(init.body || '') });
  const r = rutasAura[`${metodo} ${ruta}`];
  return Promise.resolve(typeof r === 'function' ? r() : r || {});
};

const entra = (c) => cuenta.fijarCuenta(c);
const sale = () => cuenta.fijarCuenta(null);
const valores = () => [...ss.m.values()].map(String);
const nuevo = async () => {
  sale();
  ss.pausa = null;
  rutas = {};
  rutasAura = {};
  rel.yo = null;
  await espera(5);
  ss.m.clear();
  ss.opciones.clear();
  llamadas.length = 0;
  enviadosAura.length = 0;
};
/** A dentro de AURA y de su Veta Wallet (JWT vencido o vivo, con refresco). */
let tokA = '';
const aConVeta = async (vivo, rt = 'rt-A') => {
  entra(A);
  tokA = jwt(vivo ? ahoraS() + 2400 : ahoraS() - 5, { quien: 'A' });
  rutas['/auth/login'] = [200, { token: tokA, refreshToken: rt }];
  await sesion.entrar('ana@veta.test', 'clave-A');
  llamadas.length = 0;
};

(async () => {
  console.log('Veta · refresh, recarga y su consulta tardíos (A → salir → B)\n');

  /* ── refresh atrasado ─────────────────────────────────────────────────────────────────── */
  await nuevo();
  await aConVeta(false);
  const hR = retenida();
  rutas['/auth/refresh'] = () => hR.p;
  rutas['/cards/my-card'] = [200, { last4: 'AAAA', cardHolderName: 'Ana' }];
  const pR = sesion.tarjeta.mia().then((c) => c, (e) => e);
  await espera(5);
  const refrescoA = llamadas.find((l) => l.ruta === '/auth/refresh');
  sale();
  entra(B);
  hR.soltar([200, { token: jwt(ahoraS() + 2400, { quien: 'A' }), refreshToken: 'rt-A2' }]);
  const rR = await pR;
  await espera(5);
  ok('refresh atrasado: el token renovado de A no queda en memoria con B dentro', sesion.conectada() === false);
  ok('…ni en el llavero (de nadie)', !valores().includes('rt-A2'), JSON.stringify([...ss.m.keys()]));
  ok('…la tarjeta de A no se pide con el token renovado', !llamadas.some((l) => l.ruta === '/cards/my-card'));
  ok('…quien la pidió recibe «vencida», no la tarjeta', esVencida(rR), String(rR && (rR.tipo || rR.last4)));
  ok('…y el refresh en vuelo se abortó al cambiar de cuenta', !!refrescoA && refrescoA.signal && refrescoA.signal.aborted === true);

  /* ── desconectar Veta durante el refresh ──────────────────────────────────────────────── */
  await nuevo();
  await aConVeta(false);
  const hD = retenida();
  rutas['/auth/refresh'] = () => hD.p;
  rutas['/cards/my-card'] = [200, { last4: 'AAAA' }];
  const pD = sesion.tarjeta.mia().then((c) => c, (e) => e);
  await espera(5);
  await sesion.salir();
  hD.soltar([200, { token: jwt(ahoraS() + 2400), refreshToken: 'rt-D2' }]);
  const rD = await pD;
  await espera(5);
  ok('desconectar Veta con un refresh en vuelo: no se restaura la sesión', sesion.conectada() === false);
  ok('…ni el refreshToken vuelve al llavero', !valores().includes('rt-D2'));
  ok('…ni se pide la tarjeta', !llamadas.some((l) => l.ruta === '/cards/my-card'));
  ok('…y la operación termina «vencida»', esVencida(rD), String(rD && (rD.tipo || rD.last4)));

  /* ── POST de recarga atrasado ─────────────────────────────────────────────────────────── */
  await nuevo();
  await aConVeta(true);
  const hF = retenida();
  rutas['/cards/fund'] = () => hF.p;
  const pF = sesion.tarjeta.recargar('10', 'clave-A').then((r) => r, (e) => e);
  await espera(5);
  sale();
  entra(B);
  hF.soltar([200, { status: 'pending' }]);
  const rF = await pF;
  ok('POST de recarga atrasado: con B dentro no llega como «pendiente» (no se sigue ni se pinta)', esVencida(rF), JSON.stringify(rF && (rF.status || rF.tipo)));
  const posts = llamadas.filter((l) => l.ruta === '/cards/fund');
  ok('…el POST salió una sola vez, con el token de A', posts.length === 1 && posts[0].auth === `Bearer ${tokA}`, JSON.stringify(posts.map((l) => l.auth)));

  /* ── consulta de la recarga (polling) atrasada ────────────────────────────────────────── */
  await nuevo();
  await aConVeta(true);
  const hS = retenida();
  rutas['/cards/fund/status'] = () => hS.p;
  const pS = sesion.tarjeta.estadoRecarga().then((r) => r, (e) => e);
  await espera(5);
  sale();
  entra(B);
  hS.soltar([200, { status: 'funded' }]);
  const rS = await pS;
  ok('consulta de recarga atrasada: con B dentro no entrega el estado de A', esVencida(rS), JSON.stringify(rS && (rS.status || rS.tipo)));

  /* ── el seguimiento de la pantalla (cartera/veta/recarga.ts) ──────────────────────────── */
  if (!recarga || !sesion.vinculoVeta) {
    ok('hay un seguimiento de recarga ligado a la sesión de Veta (cartera/veta/recarga.ts)', false);
  } else {
    await nuevo();
    await aConVeta(true);
    const v = sesion.vinculoVeta();
    const estados = [];
    let consultas = 0;
    const hP = retenida();
    rutas['/cards/fund/status'] = () => {
      consultas++;
      return hP.p;
    };
    const parar = recarga.seguirRecarga({ consultar: () => sesion.tarjeta.estadoRecarga(), vale: () => sesion.vinculoVigente(v), desde: Date.now(), cadaMs: 10, topeMs: 60_000, alEstado: (r) => estados.push(r), alTope: () => estados.push('tope') });
    await espera(25);
    sale();
    entra(B);
    hP.soltar([200, { status: 'funded' }]);
    await espera(60);
    ok('seguimiento: la consulta atrasada de A no publica nada con B dentro', estados.length === 0, JSON.stringify(estados));
    ok('…y no vuelve a preguntar', consultas === 1, String(consultas));
    parar();

    // Salir de la pestaña (parar) con una consulta en vuelo: lo que llegue no se publica.
    sale();
    entra(A);
    const v2 = sesion.vinculoVeta();
    const e2 = [];
    const hP2 = retenida();
    rutas['/cards/fund/status'] = () => hP2.p;
    const parar2 = recarga.seguirRecarga({ consultar: () => sesion.tarjeta.estadoRecarga(), vale: () => sesion.vinculoVigente(v2), desde: Date.now(), cadaMs: 10, topeMs: 60_000, alEstado: (r) => e2.push(r), alTope: () => e2.push('tope') });
    await espera(25);
    parar2();
    hP2.soltar([200, { status: 'funded' }]);
    await espera(30);
    ok('parar con una consulta en vuelo: lo que llega después no se publica', e2.length === 0, JSON.stringify(e2));

    // La lectura normal sigue: publica cada estado y se detiene al acreditarse.
    let n = 0;
    rutas['/cards/fund/status'] = () => [200, { status: ++n < 2 ? 'debited' : 'funded' }];
    const v3 = sesion.vinculoVeta();
    const e3 = [];
    const parar3 = recarga.seguirRecarga({ consultar: () => sesion.tarjeta.estadoRecarga(), vale: () => sesion.vinculoVigente(v3), desde: Date.now(), cadaMs: 10, topeMs: 60_000, alEstado: (r) => e3.push(r.status), alTope: () => e3.push('tope') });
    await espera(80);
    parar3();
    ok('lectura normal: publica «debited» y «funded» y deja de preguntar', e3.join() === 'debited,funded' && n === 2, `${e3.join()} · ${n}`);
  }

  console.log('\nVeta · las credenciales son de su dueño en AURA\n');

  /* ── credencial vieja sin dueño ───────────────────────────────────────────────────────── */
  await nuevo();
  ss.m.set('aura.veta.token', jwt(ahoraS() + 2400));
  ss.m.set('aura.veta.refresco', 'rt-sin-dueno');
  ss.m.set('aura.veta.correo', 'alguien@veta.test');
  ss.m.set('aura.veta.clave-biometrica', 'pw-sin-dueno');
  ss.m.set('aura.veta.clave-biometrica-on', '1');
  entra(B);
  await sesion.cargarSesion();
  ok('credencial vieja sin dueño: no se asigna a quien está dentro', !sesion.conectada() && !sesion.correoConectado());
  ok('…se descarta del llavero (hay que entrar otra vez a Veta)', !['aura.veta.token', 'aura.veta.refresco', 'aura.veta.correo', 'aura.veta.clave-biometrica', 'aura.veta.clave-biometrica-on'].some((k) => ss.m.has(k)), JSON.stringify([...ss.m.keys()]));
  ok('…y la huella vieja tampoco se ofrece', !(await desbloqueo.desbloqueoActivo()));

  /* ── cada dueño, su llave ─────────────────────────────────────────────────────────────── */
  await nuevo();
  await aConVeta(true, 'rt-de-A');
  ok('las llaves de Veta llevan el seudónimo de la cuenta de AURA (no el correo)', ss.m.get(`aura.veta.refresco.${sA}`) === 'rt-de-A' && ![...ss.m.keys()].some((k) => k.includes('@')), JSON.stringify([...ss.m.keys()]));
  sale();
  entra(B);
  await sesion.cargarSesion();
  ok('B no ve la sesión de Veta de A', !sesion.conectada() && !sesion.correoConectado());
  llamadas.length = 0;
  await sesion.tarjeta.mia().catch(() => null);
  ok('…y una petición de B no sale con el token de A', !llamadas.some((l) => l.auth), JSON.stringify(llamadas.map((l) => l.ruta)));
  sale();
  entra(A);
  await sesion.cargarSesion();
  ok('A vuelve y encuentra su sesión de Veta', sesion.conectada() && sesion.correoConectado() === 'ana@veta.test');

  /* ── el llavero lento: lo leído para A no queda con B ─────────────────────────────────── */
  await nuevo();
  await aConVeta(true);
  sale();
  let soltarLectura = null;
  ss.pausa = (op, k) => (op === 'leer' && k.startsWith('aura.veta.token') ? new Promise((r) => (soltarLectura = r)) : undefined);
  entra(A);
  const pC = sesion.cargarSesion();
  await espera(5);
  sale();
  entra(B);
  ss.pausa = null;
  if (soltarLectura) soltarLectura();
  await pC;
  ok('llavero lento: la sesión de Veta leída para A no queda en memoria con B dentro', !sesion.conectada());

  /* ── entrar a Veta atrasado ───────────────────────────────────────────────────────────── */
  await nuevo();
  entra(A);
  const hE = retenida();
  rutas['/auth/login'] = () => hE.p;
  const pE = sesion.entrar('ana@veta.test', 'clave-A').then((r) => r, (e) => e);
  await espera(5);
  sale();
  entra(B);
  hE.soltar([200, { token: jwt(ahoraS() + 2400), refreshToken: 'rt-tarde' }]);
  const rE = await pE;
  ok('entrar atrasado: la sesión de Veta de A no queda con B dentro', !sesion.conectada());
  ok('…ni en el llavero', !valores().includes('rt-tarde'));
  ok('…y quien entraba recibe «vencida»', esVencida(rE), JSON.stringify(rE && (rE.tipo || rE.correo)));

  /* ── la huella, por dueño ─────────────────────────────────────────────────────────────── */
  await nuevo();
  la.hw = true;
  la.enrolado = true;
  la.tipos = [1];
  entra(A);
  if (!sesion.vinculoVeta) ok('hay vínculo de Veta (dueño, generación y cuenta) para la huella', false);
  else {
    const vA = sesion.vinculoVeta();
    const activo = await desbloqueo.activarDesbloqueo('pw-A', vA);
    ok('activar con el vínculo vigente guarda la clave detrás de la huella, en la llave de A', activo && (ss.opciones.get(`aura.veta.clave-biometrica.${sA}`) || {}).requireAuthentication === true);
    sale();
    entra(B);
    ok('B no tiene activa la huella de A', !(await desbloqueo.desbloqueoActivo()));
    ok('…ni puede sacar la clave de A', (await desbloqueo.desbloquearClave(sesion.vinculoVeta(), 'x')) === null);
    ok('activar con un vínculo viejo (A ya salió) no guarda nada', !(await desbloqueo.activarDesbloqueo('pw-A2', vA)) && !valores().includes('pw-A2'));
    sale();
    entra(A);
    const vA2 = sesion.vinculoVeta();
    let soltarBio = null;
    ss.pausa = (op, k) => (op === 'leer' && k.startsWith('aura.veta.clave-biometrica.') ? new Promise((r) => (soltarBio = r)) : undefined);
    const pB = desbloqueo.desbloquearClave(vA2, 'x');
    await espera(5);
    sale();
    entra(B);
    ss.pausa = null;
    if (soltarBio) soltarBio();
    ok('la huella que se libera tarde (ya está B) no entrega la clave de A', (await pB) === null);
  }

  console.log('\nCartera · el perfil y la ficha de A no se aplican con B dentro\n');

  const DIR_A = '0x' + 'a1'.repeat(20);
  /* ── perfil atrasado ──────────────────────────────────────────────────────────────────── */
  await nuevo();
  entra(A);
  const hPf = retenida();
  rutasAura['GET /api/perfil'] = () => hPf.p;
  const pPf = conexion.miCartera({ revisar: true }).then((r) => r, (e) => e);
  await espera(5);
  sale();
  entra(B);
  hPf.soltar({ perfil: { cartera: DIR_A } });
  const rPf = await pPf;
  await espera(5);
  ok('perfil atrasado: la cartera de A no se devuelve con B dentro', !rPf || rPf.direccion !== DIR_A, JSON.stringify(rPf));
  ok('…ni queda como la conocida de B', conexion.carteraConocida() === null);
  ok('…ni se guarda en el teléfono a nombre de B', !String(ss.m.get('aura.cartera.direccion') || '').includes(B));
  ok('…ni se sube al perfil de B', !enviadosAura.some((l) => l.metodo === 'PUT' && l.quien === B));

  /* ── ficha del chat atrasada ──────────────────────────────────────────────────────────── */
  await nuevo();
  entra(A);
  const hFi = retenida();
  rel.yo = { correo: 'ana@chat.test' };
  rel.ficha = () => hFi.p;
  const pFi = conexion.miCartera({ revisar: true }).then((r) => r, (e) => e);
  await espera(5);
  sale();
  entra(B);
  const DIR_CHAT_A = '0x' + 'b2'.repeat(20);
  hFi.soltar({ addr: DIR_CHAT_A });
  const rFi = await pFi;
  await espera(5);
  ok('ficha atrasada: la dirección del chat de A no se devuelve con B dentro', !rFi || rFi.direccion !== DIR_CHAT_A, JSON.stringify(rFi));
  ok('…ni se sube al perfil de B', !enviadosAura.some((l) => l.metodo === 'PUT' && l.quien === B), JSON.stringify(enviadosAura));
  ok('…ni queda como la conocida de B', conexion.carteraConocida() === null);

  /* ── desconectar la cartera mientras cambia la cuenta ─────────────────────────────────── */
  await nuevo();
  entra(A);
  await conexion.conectarAMano(DIR_A);
  await espera(5);
  enviadosAura.length = 0;
  let soltarBorrado = null;
  ss.pausa = (op, k) => (op === 'borrar' && k === 'aura.cartera.direccion' ? new Promise((r) => (soltarBorrado = r)) : undefined);
  const pQ = conexion.desconectar();
  await espera(5);
  sale();
  entra(B);
  ss.pausa = null;
  if (soltarBorrado) soltarBorrado();
  await pQ;
  ok('desconectar la cartera de A no borra la del perfil de B', !enviadosAura.some((l) => l.metodo === 'PUT' && l.quien === B), JSON.stringify(enviadosAura));

  /* ── la lectura normal sigue ──────────────────────────────────────────────────────────── */
  await nuevo();
  entra(A);
  rutasAura['GET /api/perfil'] = { perfil: { cartera: DIR_A } };
  const rN = await conexion.miCartera({ revisar: true });
  await espera(5);
  ok('sin cambio de cuenta: la cartera del perfil de A se encuentra y queda como suya', rN && rN.direccion === DIR_A && (conexion.carteraConocida() || {}).direccion === DIR_A);

  fin();
})().catch((e) => {
  console.error('ERR', e);
  process.exit(1);
});
