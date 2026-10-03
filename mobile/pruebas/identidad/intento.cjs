// Identidad · de quién es cada intento (auditoría AUTH01 y AUTH03).
//
//  AUTH01  Una petición de A que reintenta (429 → espera, 401 → renovar) mientras A sale y entra B no
//          vuelve a salir con el token de B: ni con B, ni con A otra vez (A→B→A es otra sesión). Antes el
//          reintento leía el token vigente y mandaba el cuerpo de A con las credenciales de B; y un 401 de
//          A que llegaba con B dentro renovaba con la clave de B. El doble toque en la misma sesión sigue
//          renovando una sola vez y los dos pasan. El turno en stream tampoco sale si cambió la persona.
//  AUTH03  Entrar con A y, sin esperar, con B: si A termina después, NO guarda su token. «Atrás» vence al
//          intento en curso; A→B→A deja el del último; un intento que ya escribió y queda viejo suelta lo
//          suyo. La vuelta tardía de Genesis ID no pisa un intento más nuevo (ni gasta el pase).
// Todo con red y almacén de mentira: nada sale del proceso.
const { ok, fin } = require('../chat/comun.cjs');

const espera = (ms) => new Promise((r) => setTimeout(r, ms));
const resp = (cuerpo, status = 200, cab = {}) => new Response(JSON.stringify(cuerpo), { status, headers: cab });

(async () => {
  const M = require(process.env.IDENTIDAD || './out/identidad.cjs');
  const { API, CUENTA, INTENTO, GENESIS } = M;
  const mesa = globalThis.__mesa;
  const rn = globalThis.__rn;
  const ss = globalThis.__ss;
  // El código de antes no tiene coordinador: las mismas pruebas corren y fallan donde deben.
  const empezar = () => INTENTO?.empezarIntento?.();
  const esVencida = (e) => !!INTENTO?.esVencida?.(e);

  /** Lo que llegó al servidor: ruta, token y cuerpo (el cuerpo solo para buscar marcas sintéticas). */
  const enviados = [];
  const anotar = (url, init = {}) => {
    const u = new URL(String(url));
    enviados.push({ ruta: u.pathname, token: String((init.headers || {})['x-ultron-sesion'] || ''), cuerpo: String(init.body || '') });
    return u.pathname;
  };
  const conMarca = (marca) => enviados.filter((p) => p.cuerpo.includes(marca));
  const cruzados = (marca, token) => conMarca(marca).filter((p) => p.token.startsWith(token));
  const dentro = (correo, token) => {
    CUENTA.fijarCuenta(correo);
    mesa.token = token;
    mesa.sesion = correo ? { correo } : null;
    mesa.creds = correo ? { correo, clave: `clave-de-${correo[0]}` } : null;
  };
  const cuerpo = (marca) => ({ method: 'POST', body: JSON.stringify({ hecho: marca }) });

  console.log('AUTH01 · el reintento es de quien lo empezó\n');

  /* ── 429: A espera el Retry-After; mientras, sale y entra B ───────────────────────────── */
  CUENTA.fijarCuenta(null, { nueva: true });
  dentro('a@prueba.local', 'tok-A');
  enviados.length = 0;
  globalThis.fetch = async (url, init) => {
    anotar(url, init);
    return resp({ error: 'despacio' }, 429, { 'retry-after': '0.1' });
  };
  const p429 = API.api('/api/memoria', cuerpo('dato-de-A'), 5000).then(
    () => 'entró',
    (e) => e
  );
  await espera(30);
  dentro(null, '');
  dentro('b@prueba.local', 'tok-B');
  const r429 = await p429;
  ok('429: el cuerpo de A no vuelve a salir con el token de B', cruzados('dato-de-A', 'tok-B').length === 0, JSON.stringify(enviados.map((p) => p.token)));
  ok('…ni sale otra vez con ninguna sesión (una sola vez al servidor)', conMarca('dato-de-A').length === 1, String(conMarca('dato-de-A').length));
  ok('…y quien la pidió recibe «sesión vencida», no un éxito', esVencida(r429), String(r429?.message || r429));

  /* ── 401 que llega cuando ya está B: no se renueva con la clave de B ──────────────────── */
  CUENTA.fijarCuenta(null, { nueva: true });
  dentro('a@prueba.local', 'tok-A-vencido');
  enviados.length = 0;
  let soltarA = null;
  globalThis.fetch = (url, init) => {
    const ruta = anotar(url, init);
    if (ruta === '/api/ultron/entrar') return Promise.resolve(resp({ token: 'tok-B-nuevo' }));
    if (String(init?.body || '').includes('dato-401') && !soltarA) return new Promise((r) => (soltarA = () => r(resp({ error: 'sesión requerida' }, 401))));
    return Promise.resolve(resp({ error: 'sesión requerida' }, 401));
  };
  const p401 = API.api('/api/memoria', cuerpo('dato-401'), 5000).catch((e) => e);
  await espera(20);
  dentro(null, '');
  dentro('b@prueba.local', 'tok-B-vencido');
  soltarA?.();
  await p401;
  await espera(20);
  ok('401 de A con B dentro: no se renueva con la clave de B', !enviados.some((p) => p.ruta === '/api/ultron/entrar'), JSON.stringify(enviados.map((p) => p.ruta)));
  ok('…el cuerpo de A no sale con ningún token de B', cruzados('dato-401', 'tok-B').length === 0);
  ok('…y el token de B queda como estaba', mesa.token === 'tok-B-vencido', mesa.token);

  /* ── A→B→A: la sesión vieja de A tampoco reintenta con el token nuevo de A ────────────── */
  CUENTA.fijarCuenta(null, { nueva: true });
  dentro('a@prueba.local', 'tok-A1');
  enviados.length = 0;
  globalThis.fetch = async (url, init) => {
    anotar(url, init);
    return resp({ error: 'despacio' }, 429, { 'retry-after': '0.1' });
  };
  const pABA = API.api('/api/memoria', cuerpo('dato-A1'), 5000).catch((e) => e);
  await espera(30);
  dentro(null, '');
  dentro('b@prueba.local', 'tok-B');
  dentro(null, '');
  dentro('a@prueba.local', 'tok-A2');
  await pABA;
  ok('A→B→A: el cuerpo de la sesión vieja de A sale una sola vez', conMarca('dato-A1').length === 1, JSON.stringify(conMarca('dato-A1').map((p) => p.token)));

  /* ── doble toque en la misma sesión: una renovación, los dos pasan ────────────────────── */
  CUENTA.fijarCuenta(null, { nueva: true });
  dentro('a@prueba.local', 'tok-A-vencido');
  enviados.length = 0;
  let renovaciones = 0;
  globalThis.fetch = async (url, init) => {
    const ruta = anotar(url, init);
    if (ruta === '/api/ultron/entrar') {
      renovaciones++;
      await espera(40);
      return resp({ token: 'tok-A-nuevo' });
    }
    return (init?.headers || {})['x-ultron-sesion'] === 'tok-A-nuevo' ? resp({ ok: true }) : resp({ error: 'sesión requerida' }, 401);
  };
  const dos = await Promise.all([API.api('/api/memoria', cuerpo('toque-1'), 5000), API.api('/api/memoria', cuerpo('toque-2'), 5000)].map((p) => p.then(() => 'ok', (e) => e)));
  ok('doble toque: una sola renovación y los dos pasan', renovaciones === 1 && dos.every((x) => x === 'ok'), `${renovaciones} · ${dos.map(String)}`);
  ok('…cada cuerpo salió con un token de A', conMarca('toque-').every((p) => p.token.startsWith('tok-A')));

  /* ── doble toque y la persona cambia durante la renovación ────────────────────────────── */
  CUENTA.fijarCuenta(null, { nueva: true });
  dentro('a@prueba.local', 'tok-A-vencido');
  enviados.length = 0;
  let soltarRenovar = null;
  globalThis.fetch = (url, init) => {
    const ruta = anotar(url, init);
    if (ruta === '/api/ultron/entrar') return new Promise((r) => (soltarRenovar = () => r(resp({ token: 'tok-A-nuevo' }))));
    return Promise.resolve((init?.headers || {})['x-ultron-sesion'] === 'tok-B' ? resp({ ok: true }) : resp({ error: 'sesión requerida' }, 401));
  };
  const tres = Promise.all([API.api('/api/memoria', cuerpo('toque-3'), 5000), API.api('/api/memoria', cuerpo('toque-4'), 5000)].map((p) => p.catch((e) => e)));
  await espera(20);
  dentro(null, '');
  dentro('b@prueba.local', 'tok-B');
  soltarRenovar?.();
  await tres;
  ok('doble toque con cambio de persona en medio: cero cuerpos de A con el token de B', cruzados('toque-', 'tok-B').length === 0, JSON.stringify(enviados.map((p) => p.token)));
  ok('…y el token de B no se toca', mesa.token === 'tok-B', mesa.token);

  /* ── el turno en stream: si cambió la persona antes de mandarlo, no sale ──────────────── */
  const xhrs = [];
  globalThis.XMLHttpRequest = class {
    constructor() {
      this.cab = {};
      this.readyState = 0;
      this.status = 0;
      this.responseText = '';
      xhrs.push(this);
    }
    open(_m, u) {
      this.u = u;
    }
    setRequestHeader(k, v) {
      this.cab[k] = v;
    }
    send(p) {
      this.payload = String(p || '');
    }
    abort() {}
  };
  globalThis.fetch = async () => resp({});
  CUENTA.fijarCuenta(null, { nueva: true });
  dentro('a@prueba.local', 'tok-A');
  const st = API.turnoStream({ message: 'frase-de-A', mode: 'conversar', userName: 'Ana', historial: [] }, { onDelta() {} });
  dentro(null, '');
  dentro('b@prueba.local', 'tok-B');
  const rSt = await Promise.race([st.promise.catch((e) => e), espera(300).then(() => 'colgado')]);
  st.abort();
  ok('turno en stream: el cuerpo de A no sale cuando ya está otra persona', !xhrs.some((x) => String(x.payload || '').includes('frase-de-A')), JSON.stringify(xhrs.map((x) => x.cab['x-ultron-sesion'] || '')));
  ok('…y el turno termina como sesión vencida', esVencida(rSt), String(rSt?.message || rSt));

  console.log('\nAUTH03 · solo el último intento de entrar guarda\n');

  /** Un /api/ultron/entrar que contesta cuando la prueba quiere, por correo. */
  const pendientes = {};
  const servidorDeEntrada = (extra) => (url, init) => {
    const ruta = anotar(url, init);
    if (ruta === '/api/ultron/entrar') {
      const { correo } = JSON.parse(String(init.body || '{}'));
      return new Promise((r) => (pendientes[correo] = (tok) => r(resp({ token: tok, miembro: { nombre: correo[0].toUpperCase(), correo, rol: 'Junta' } }))));
    }
    return Promise.resolve(extra ? extra(ruta, init) : resp({}));
  };
  const nadie = () => {
    CUENTA.fijarCuenta(null, { nueva: true });
    dentro(null, '');
    enviados.length = 0;
  };

  /* ── A pendiente, B entra antes: A no pisa ────────────────────────────────────────────── */
  nadie();
  globalThis.fetch = servidorDeEntrada();
  const iA = empezar();
  const pA = API.loginClave('a@prueba.local', 'clave-a', iA).then((d) => d, (e) => e);
  const iB = empezar();
  const pB = API.loginClave('b@prueba.local', 'clave-b', iB).then((d) => d, (e) => e);
  await espera(10);
  pendientes['b@prueba.local']('tok-B');
  await pB;
  pendientes['a@prueba.local']('tok-A');
  const rA = await pA;
  ok('el login de A que termina después del de B NO guarda su token', mesa.token === 'tok-B', mesa.token);
  ok('…y A se entera de que su intento venció (no «entró»)', esVencida(rA), String(rA?.message || JSON.stringify(rA)));

  /* ── «Atrás» durante el intento ───────────────────────────────────────────────────────── */
  nadie();
  const iAtras = empezar();
  const pAtras = API.loginClave('a@prueba.local', 'clave-a', iAtras).catch((e) => e);
  await espera(10);
  INTENTO?.cancelarIntento?.(iAtras);
  pendientes['a@prueba.local']('tok-A');
  await pAtras;
  ok('«atrás» vence al intento: su respuesta tardía no guarda token', mesa.token === '', mesa.token);

  /* ── A→B→A: gana el último ────────────────────────────────────────────────────────────── */
  nadie();
  const iA1 = empezar();
  const pA1 = API.loginClave('a@prueba.local', 'clave-a', iA1).catch((e) => e);
  await espera(5);
  const pendA1 = pendientes['a@prueba.local'];
  const iB2 = empezar();
  const pB2 = API.loginClave('b@prueba.local', 'clave-b', iB2).catch((e) => e);
  await espera(5);
  const iA2 = empezar();
  const pA2 = API.loginClave('a@prueba.local', 'clave-a', iA2).catch((e) => e);
  await espera(5);
  pendientes['b@prueba.local']('tok-B');
  await pB2;
  pendientes['a@prueba.local']('tok-A2');
  await pA2;
  pendA1('tok-A1');
  await pA1;
  ok('A→B→A: queda el token del último intento', mesa.token === 'tok-A2', mesa.token);

  /* ── un intento que ya guardó su token y queda viejo lo suelta ────────────────────────── */
  nadie();
  if (INTENTO?.confirmarIntento) {
    const iV = empezar();
    const pV = API.loginClave('a@prueba.local', 'clave-a', iV);
    await espera(5);
    pendientes['a@prueba.local']('tok-A');
    await pV;
    ok('el intento vigente guarda su token', mesa.token === 'tok-A', mesa.token);
    const iN = empezar();
    const siguio = await INTENTO.confirmarIntento(iV, async () => true);
    ok('su paso siguiente ya no se confirma (empezó otro)', siguio === false);
    ok('…y el token que alcanzó a guardar se suelta', mesa.token === '', mesa.token);
    const pN = API.loginClave('b@prueba.local', 'clave-b', iN);
    await espera(5);
    pendientes['b@prueba.local']('tok-B');
    await pN;
    await INTENTO.confirmarIntento(iV, async () => true);
    ok('lo que escribió el intento nuevo no lo suelta el viejo', mesa.token === 'tok-B', mesa.token);
  } else ok('hay coordinador de intentos (lib/intentoEntrada.ts)', false);

  /* ── la vuelta tardía de Genesis no pisa a un intento más nuevo ───────────────────────── */
  nadie();
  globalThis.fetch = servidorDeEntrada((ruta) =>
    ruta === '/api/genesis/entrar' ? resp({ token: 'tok-G', miembro: { nombre: 'Gina', correo: 'g@prueba.local', rol: 'x', gid: 'GEN-AAAA-BBBB-C' } }) : resp({})
  );
  rn.openURL = async () => {};
  globalThis.__wb = async () => ({ type: 'dismiss' });
  const pG = GENESIS.entrarConGenesis();
  await espera(30);
  const estado = JSON.parse(ss.m.get('aura.genesis.pendiente') || 'null')?.estado;
  rn.app.forEach((f) => f('background'));
  rn.app.forEach((f) => f('active'));
  const rG = await pG;
  ok('(la wallet se abrió y volvió sin pase: el pedido queda guardado)', rG.codigo === 'SIN_VUELTA' && !!estado, JSON.stringify(rG));
  const tardias = [];
  const soltar = GENESIS.escucharVueltaTardia((x) => tardias.push(x));
  // La persona se fue a «Otras formas de entrar» y entra con su clave: ese intento es el nuevo.
  const iClave = empezar();
  const pClave = API.loginClave('b@prueba.local', 'clave-b', iClave).catch((e) => e);
  rn.url.forEach((f) => f({ url: `https://aura-fp.onrender.com/sso?pase=PASE&estado=${estado}` }));
  await espera(60);
  ok('la vuelta tardía de Genesis no guarda su token sobre el intento nuevo', mesa.token !== 'tok-G', mesa.token);
  ok('…ni avisa a la pantalla de una entrada', !tardias.some((t) => t.ok), JSON.stringify(tardias));
  ok('…ni gasta el pase en el servidor', !enviados.some((p) => p.ruta === '/api/genesis/entrar'));
  pendientes['b@prueba.local']('tok-B');
  await pClave;
  ok('y el intento con clave entra con su token', mesa.token === 'tok-B', mesa.token);
  soltar();

  // La misma vuelta tardía SIN otro intento en medio sigue entrando (la wallet guardó el pedido).
  nadie();
  const pG2 = GENESIS.entrarConGenesis();
  await espera(30);
  const estado2 = JSON.parse(ss.m.get('aura.genesis.pendiente') || 'null')?.estado;
  rn.app.forEach((f) => f('background'));
  rn.app.forEach((f) => f('active'));
  await pG2;
  const tardias2 = [];
  const soltar2 = GENESIS.escucharVueltaTardia((x) => tardias2.push(x));
  rn.url.forEach((f) => f({ url: `https://aura-fp.onrender.com/sso?pase=PASE&estado=${estado2}` }));
  await espera(60);
  ok('sin otro intento en medio, la vuelta tardía entra y guarda su token', tardias2.length === 1 && tardias2[0].ok === true && mesa.token === 'tok-G', `${mesa.token} · ${JSON.stringify(tardias2)}`);
  soltar2();

  fin();
})().catch((e) => {
  console.error('ERR', e);
  process.exit(1);
});
