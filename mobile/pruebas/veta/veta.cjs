// La tarjeta de Veta Wallet dentro de AURA, contra un servidor de mentira con las respuestas del real
// (veta-wallet-backend-/routes/cards.js y controller/cardController.js).
const assert = require('assert/strict');
const { sesion, desbloqueo, cuenta } = require('./out/veta.cjs');
const ss = globalThis.__ss;
// El mismo llavero de mentira, para darle a lib/credsSeguras.ts (comparte el estado con el del paquete).
const SS = require('./shims/expo-secure-store.js');
const la = globalThis.__la;
// La sesión de Veta es de quien está dentro de AURA (AUR01): sus llaves llevan su seudónimo.
cuenta.fijarCuenta('ana@aura.test');
const llave = (base) => sesion.llaveDe(base, cuenta.seudonimoActual());

const b64u = (o) => Buffer.from(JSON.stringify(o)).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
const jwt = (exp, extra = {}) => `h.${b64u({ exp, ...extra })}.f`;
globalThis.atob = (s) => Buffer.from(s, 'base64').toString('binary');
const ahoraS = () => Math.floor(Date.now() / 1000);

let llamadas = [];
let respuestas = {};
globalThis.fetch = async (url, init = {}) => {
  const ruta = url.replace(sesion.VETA_API, '');
  const cuerpo = init.body ? JSON.parse(init.body) : undefined;
  llamadas.push({ ruta, metodo: init.method || 'GET', auth: init.headers?.Authorization || null, cuerpo });
  const r = typeof respuestas[ruta] === 'function' ? respuestas[ruta](cuerpo, init) : respuestas[ruta];
  const [status, json] = r || [404, { message: 'no route' }];
  return { ok: status >= 200 && status < 300, status, json: async () => json };
};

const pruebas = [];
const prueba = (n, f) => pruebas.push([n, f]);

prueba('entrar: guarda JWT y refresco en el llavero (NO la contraseña) y reintenta en minúsculas', async () => {
  respuestas = { '/auth/login': (c) => (c.email === 'ana@x.com' ? [200, { token: jwt(ahoraS() + 2400, { address: '0xabc' }), refreshToken: 'rt-1' }] : [401, { message: 'Wrong password' }]) };
  const r = await sesion.entrar('Ana@X.com', 'secreta');
  assert.equal(r.correo, 'Ana@X.com');
  assert.equal(r.direccion, '0xabc');
  assert.deepEqual(llamadas.map((l) => l.cuerpo.email), ['Ana@X.com', 'ana@x.com']);
  assert.ok(ss.m.get(llave('aura.veta.token')) && ss.m.get(llave('aura.veta.refresco')) === 'rt-1');
  assert.ok(![...ss.m.values()].includes('secreta'), 'la contraseña no queda en el llavero sin biometría');
  assert.equal(sesion.conectada(), true);
});

prueba('la tarjeta: GET /cards/my-card con el JWT; datos (PAN/CVV) con contraseña y sin reintento', async () => {
  llamadas = [];
  respuestas = {
    '/cards/my-card': [200, { last4: '4242', status: 'ACTIVE', cardHolderName: 'Ana Pérez', availableOrigen: 12.5, dailyLimit: 30 }],
    '/cards/pan': (c) => (c.password === 'bien' ? [200, { pan: '4111111111114242', cvv: '123', expiry: '09/29' }] : [401, { message: 'Incorrect password' }]),
  };
  const c = await sesion.tarjeta.mia();
  assert.equal(c.last4, '4242');
  assert.match(llamadas[0].auth, /^Bearer h\./);
  await assert.rejects(sesion.tarjeta.datos('mal'), (e) => e.tipo === 'clave');
  assert.equal(llamadas.filter((l) => l.ruta === '/cards/pan').length, 1, 'una contraseña mala no se reintenta (no cierra la sesión)');
  assert.equal(sesion.conectada(), true);
  const d = await sesion.tarjeta.datos('bien');
  assert.equal(sesion.formatearPan(d.pan), '4111  1111  1111  4242');
});

prueba('sesión vencida: se renueva con el refresco ANTES de pedir; si el refresco ya no sirve, se cierra', async () => {
  respuestas = { '/auth/login': [200, { token: jwt(ahoraS() - 5), refreshToken: 'rt-2' }] };
  await sesion.entrar('ana@x.com', 'secreta'); // JWT ya vencido, con refresco
  respuestas['/auth/refresh'] = (c) => (c.refreshToken === 'rt-2' ? [200, { token: jwt(ahoraS() + 2400), refreshToken: 'rt-3' }] : [401, { message: 'invalid token' }]);
  respuestas['/cards/my-card'] = [200, { last4: '1111' }];
  llamadas = [];
  await sesion.tarjeta.mia();
  assert.deepEqual(llamadas.map((l) => l.ruta), ['/auth/refresh', '/cards/my-card']);
  assert.equal(ss.m.get(llave('aura.veta.refresco')), 'rt-3');
  // Ahora el refresco deja de servir y el JWT vence.
  respuestas['/auth/login'] = [200, { token: jwt(ahoraS() - 5), refreshToken: 'rt-viejo' }];
  await sesion.entrar('ana@x.com', 'secreta');
  respuestas['/auth/refresh'] = [400, { message: 'refreshToken inválido' }];
  await assert.rejects(sesion.tarjeta.mia(), (e) => e.tipo === 'sesion');
  assert.equal(sesion.conectada(), false, 'sin refresco válido, la sesión se cierra');
});

prueba('sin tarjeta (404) es un estado normal; congelar manda {frozen}; recargar manda monto y contraseña', async () => {
  respuestas = { '/auth/login': [200, { token: jwt(ahoraS() + 2400), refreshToken: 'r' }] };
  await sesion.entrar('ana@x.com', 's');
  respuestas['/cards/my-card'] = [404, { message: 'No active card found' }];
  await assert.rejects(sesion.tarjeta.mia(), (e) => sesion.sinTarjeta(e));
  llamadas = [];
  respuestas['/cards/freeze'] = (c) => [200, { status: c.frozen ? 'FROZEN' : 'ACTIVE' }];
  assert.equal((await sesion.tarjeta.congelar(true)).status, 'FROZEN');
  assert.deepEqual(llamadas[0].cuerpo, { frozen: true });
  respuestas['/cards/fund'] = (c) => [200, { status: 'pending', eco: c }];
  const r = await sesion.tarjeta.recargar('10.5', 'clave');
  assert.equal(r.status, 'pending');
  assert.deepEqual(r.eco, { amount: '10.5', password: 'clave' });
  assert.equal(sesion.estaCongelada('frozen'), true);
});

prueba('huella: la contraseña se guarda SOLO con requireAuthentication; cancelar la huella devuelve null', async () => {
  la.hw = true; la.enrolado = true; la.tipos = [2];
  const cap = await desbloqueo.capacidadBiometrica();
  assert.deepEqual(cap, { disponible: true, tipo: 'face' });
  assert.equal(await desbloqueo.activarDesbloqueo('mi-clave', sesion.vinculoVeta()), true);
  const op = ss.opciones.get(llave('aura.veta.clave-biometrica'));
  assert.equal(op.requireAuthentication, true);
  assert.equal(op.keychainAccessible, 'WHEN_UNLOCKED_THIS_DEVICE_ONLY');
  assert.equal(await desbloqueo.desbloqueoActivo(), true);
  assert.equal(await desbloqueo.desbloquearClave(sesion.vinculoVeta()), 'mi-clave');
  ss.cancelarBio = true;
  assert.equal(await desbloqueo.desbloquearClave(sesion.vinculoVeta()), null, 'cancelada: se cae a la contraseña escrita');
  ss.cancelarBio = false;
  await desbloqueo.desactivarDesbloqueo();
  assert.equal(await desbloqueo.desbloqueoActivo(), false);
  assert.equal(ss.m.has(llave('aura.veta.clave-biometrica')), false);
  la.enrolado = false;
  assert.equal((await desbloqueo.capacidadBiometrica()).disponible, false, 'sin huella registrada no se ofrece');
});

prueba('C-3: ver la tarjeta o recargar pide la huella o el bloqueo del teléfono; sin bloqueo de pantalla, no', async () => {
  la.nivel = 3; la.confirma = true; la.pedidas = [];
  assert.deepEqual(await desbloqueo.confirmarConTelefono('Ver el número de tu tarjeta'), { ok: true });
  assert.equal(la.pedidas.length, 1);
  assert.equal(la.pedidas[0].promptMessage, 'Ver el número de tu tarjeta');
  assert.equal(la.pedidas[0].disableDeviceFallback, false, 'vale el PIN o patrón del teléfono si no hay huella');
  la.confirma = false;
  assert.deepEqual(await desbloqueo.confirmarConTelefono('x'), { ok: false, motivo: 'cancelado' });
  la.nivel = 0; la.confirma = true;
  assert.deepEqual(await desbloqueo.confirmarConTelefono('x'), { ok: false, motivo: 'sin-bloqueo' }, 'sin bloqueo de pantalla no hay con qué confirmar');
  la.nivel = 3;
  const t = leerSrc('cartera/veta/SeccionTarjeta.tsx');
  assert.match(t, /<PedirClave[\s\S]{0,900}confirmarTelefono\n/, 'la ficha de la tarjeta (número, PIN, recarga) siempre la pide');
  const p = leerSrc('cartera/veta/PedirClave.tsx');
  const i = p.indexOf('const r = await onAutorizar(c);');
  assert.ok(i > 0);
  assert.match(p.slice(Math.max(0, i - 900), i), /if \(confirmarTelefono && !deBio\) \{\s*const t = await confirmarConTelefono\(titulo\);\s*if \(!t\.ok\) \{[\s\S]*?return;/, 'la contraseña escrita no basta: antes de mandarla, la huella o el bloqueo');
});

prueba('C-3: la sesión de Veta dura como mucho 7 días en el teléfono (el refreshToken de 30 días es del backend)', async () => {
  const DIA = 24 * 3600_000;
  assert.equal(sesion.SESION_MAX_MS, 7 * DIA);
  assert.deepEqual(sesion.sesionCaducada(null, 1000), { caducada: false, fijarDesde: 1000 }, 'una sesión de antes no se corta de golpe');
  assert.deepEqual(sesion.sesionCaducada(1000, 1000 + 6 * DIA), { caducada: false });
  assert.deepEqual(sesion.sesionCaducada(1000, 1000 + 8 * DIA), { caducada: true });
  // Entrar anota desde cuándo; pasado el tope, el refresco ya no se usa: se pide entrar otra vez.
  respuestas = { '/auth/login': [200, { token: jwt(ahoraS() - 5), refreshToken: 'rt-tope' }] };
  await sesion.entrar('ana@x.com', 'secreta');
  const desde = Number(ss.m.get(llave('aura.veta.desde')));
  assert.ok(Math.abs(desde - Date.now()) < 5000, 'entrar anota cuándo');
  const real = Date.now;
  try {
    Date.now = () => real() + 8 * DIA;
    llamadas = [];
    respuestas['/auth/refresh'] = [200, { token: jwt(Math.floor(Date.now() / 1000) + 2400), refreshToken: 'rt-nuevo' }];
    await assert.rejects(sesion.tarjeta.mia(), (e) => e.tipo === 'sesion');
    assert.equal(llamadas.filter((l) => l.ruta === '/auth/refresh').length, 0, 'pasado el tope no se renueva');
    assert.equal(sesion.conectada(), false);
    assert.equal(ss.m.has(llave('aura.veta.refresco')), false, 'el refreshToken se borra del teléfono');
  } finally {
    Date.now = real;
  }
});

prueba('M-9: la clave de AU-RA solo se guarda detrás de la huella (requireAuthentication); nunca a la vista', async () => {
  const { creds: C } = require('./out/veta.cjs');
  const ll = { get: (k, o) => SS.getItemAsync(k, o), set: (k, v, o) => SS.setItemAsync(k, v, o), del: (k) => SS.deleteItemAsync(k), soloEsteTelefono: 'WHEN_UNLOCKED_THIS_DEVICE_ONLY' };
  const c = C.crearCreds(ll);
  const { creds: K, clave: KC } = C.LLAVES_CREDS;
  // Con huella: la clave va a su llave con requireAuthentication; lo visible no la lleva.
  assert.equal(await c.guardar({ correo: 'jose@og.test', clave: 'secreta-1', name: 'José', conHuella: true }), true);
  assert.equal(ss.opciones.get(KC).requireAuthentication, true);
  assert.equal(ss.opciones.get(KC).keychainAccessible, 'WHEN_UNLOCKED_THIS_DEVICE_ONLY');
  assert.ok(!ss.m.get(K).includes('secreta-1'), 'la clave no queda a la vista');
  const leida = await c.leer();
  assert.deepEqual({ ...leida, claveHuella: undefined }, { correo: 'jose@og.test', name: 'José', conHuella: true, claveHuella: undefined });
  assert.equal(leida.clave, undefined);
  assert.equal(await c.claveConHuella('Desbloquear'), 'secreta-1');
  assert.equal(ss.opciones.get(KC).requireAuthentication, true);
  ss.cancelarBio = true;
  assert.equal(await c.claveConHuella('Desbloquear'), null, 'sin la huella, no sale');
  ss.cancelarBio = false;
  // Sin red: se comprueba con PBKDF2, sin la clave.
  assert.equal(C.claveCoincide(leida, 'secreta-1'), true);
  assert.equal(C.claveCoincide(leida, 'otra'), false);
  assert.match(leida.claveHuella, /^p1\$[^$]+\$[0-9a-f]{64}$/);
  // Sin huella: la clave NO se guarda.
  assert.equal(await c.guardar({ correo: 'jose@og.test', clave: 'secreta-2', name: 'José', conHuella: false }), false);
  assert.equal(ss.m.has(KC), false);
  assert.ok(![...ss.m.values()].includes('secreta-2'));
  // Si el sistema no deja guardarla (canceló la huella, sin bloqueo de pantalla), tampoco: y se dice.
  const real = SS.setItemAsync;
  SS.setItemAsync = async (k, v, o) => { if (o && o.requireAuthentication) throw new Error('cancelado'); return real(k, v, o); };
  try {
    assert.equal(await c.guardar({ correo: 'jose@og.test', clave: 'secreta-3', conHuella: true }), false);
    assert.equal((await c.leer()).conHuella, undefined);
  } finally {
    SS.setItemAsync = real;
  }
  // Cerrar: todo fuera.
  await c.guardar(null);
  assert.equal(ss.m.has(K) || ss.m.has(KC), false);
});

prueba('M-9 migración: la clave en claro de una versión anterior se borra al leer; correo y nombre siguen (nadie queda fuera)', async () => {
  const { creds: C } = require('./out/veta.cjs');
  const c = C.crearCreds({ get: (k, o) => SS.getItemAsync(k, o), set: (k, v, o) => SS.setItemAsync(k, v, o), del: (k) => SS.deleteItemAsync(k) });
  ss.m.set(C.LLAVES_CREDS.creds, JSON.stringify({ correo: 'jose@og.test', clave: 'en-claro', name: 'José' }));
  const r = await c.leer();
  assert.deepEqual(r, { correo: 'jose@og.test', name: 'José' });
  assert.ok(!ss.m.get(C.LLAVES_CREDS.creds).includes('en-claro'), 'se reescribió sin la clave');
  assert.equal(await c.claveConHuella('x'), null, 'no hay clave detrás de la huella: la próxima vez se escribe (y queda guardada de verdad)');
  const api = leerSrc('lib/api.ts');
  assert.match(api, /if \(!creds\?\.correo \|\| !creds\.conHuella\) return false;/, 'renovar solo con la clave detrás de la huella');
  assert.match(api, /const clave = await leerClaveConHuella\(/);
  assert.doesNotMatch(api, /creds\.clave/, 'la renovación ya no usa una clave a la vista');
  const login = leerSrc('screens/LoginScreen.tsx');
  assert.match(login, /const guardada = await leerClaveConHuella\(tr\('Desbloquear AU-RA FP'/, 'la huella de la entrada ES la llave');
  assert.doesNotMatch(login, /creds\??\.clave\b/, 'la entrada no lee una clave a la vista');
  assert.match(login, /claveCoincide\(creds, clave\)/, 'sin red, se compara la huella de la clave');
  assert.match(leerSrc('app/pantallas/Intro.tsx'), /void loadCreds\(\)\.catch\(\(\) => null\);/, 'la migración corre al abrir la app');
});

prueba('cerrar sesión borra JWT, refresco y correo', async () => {
  await sesion.salir();
  for (const k of ['aura.veta.token', 'aura.veta.refresco', 'aura.veta.correo']) assert.equal(ss.m.has(llave(k)), false, k);
  assert.equal(sesion.conectada(), false);
});

// Auditoría del 3-oct (VETA01, VETA02, WAL01): las guardas están en el código de la pantalla y del hook.
const fs = require('fs');
const path = require('path');
const leerSrc = (r) => fs.readFileSync(path.join(__dirname, '../../src', r), 'utf8');

prueba('VETA01: número/CVV/PIN que llegan tarde (pestaña oculta, app al fondo, sesión cerrada, cancelado) no se muestran', () => {
  const t = leerSrc('cartera/veta/SeccionTarjeta.tsx');
  assert.match(t, /const vale = \(\) => g === gen\.current && activaRef\.current && deSesion\(gs, v\);/, 'cada operación sensible guarda su generación (y la de la sesión de Veta y de AURA)');
  for (const que of ['api.datos(clave)', 'api.pin(clave)', 'api.crearPin(pinNuevo, clave)']) {
    const i = t.indexOf(que);
    assert.ok(i > 0, que);
    assert.match(t.slice(i, i + 160), /if \(!vale\(\)\)/, `después de ${que} se comprueba la generación antes de mostrar`);
  }
  assert.match(t, /st === 'background'\) taparTodo\(\)/, 'al fondo se tapa (no en inactive: Face ID)');
  assert.doesNotMatch(t, /st !== 'active'\) taparTodo/, 'inactive (diálogo de Face ID) no corta la autorización');
  assert.match(t, /if \(!activa\) taparTodo\(\)/, 'ocultar la pestaña tapa');
  assert.match(t, /genSesion\.current\+\+;\s*taparTodo\(\);/, 'cerrar sesión tapa y cambia de generación');
  assert.match(t, /onCancelar=\{\(\) => \{\s*gen\.current\+\+;/, 'cancelar la ficha invalida lo que esté en vuelo');
  assert.match(t, /if \(!deSesion\(gs, v\) \|\| !conectada\(\)\) return;/, 'una tarjeta que llega tras cerrar sesión no se pinta');
});

prueba('AUR01 (pantalla): recarga, su seguimiento, congelar y la huella son de la sesión que los empezó', () => {
  const t = leerSrc('cartera/veta/SeccionTarjeta.tsx');
  assert.match(t, /const deSesion = useCallback\(\(gs: number, v: [^)]+\) => gs === genSesion\.current && vinculoVigente\(v\), \[\]\);/, 'la pantalla y el vínculo de Veta, juntos');
  const i = t.indexOf('api.recargar(monto, clave)');
  assert.match(t.slice(i, i + 220), /if \(!deSesion\(gs, v\)\) return \{ ok: true \};\s*setRecarga\(r\);/, 'el POST de recarga tardío no se pinta ni se sigue');
  assert.match(t, /catch \(e\) \{\s*\/\/[^\n]*\n\s*if \(esVencidaVeta\(e\) \|\| !deSesion\(gs, v\)\) return \{ ok: true \};/, 'el error de otra sesión no avisa ni reconcilia');
  assert.match(t, /return seguirRecarga\(\{[\s\S]{0,120}vale: \(\) => deSesion\(gs, v\) && activaRef\.current,/, 'el seguimiento se para al salir de la pestaña, de Veta o de AURA');
  assert.doesNotMatch(t, /setInterval\(async/, 'no queda el sondeo sin guarda');
  assert.match(t, /const \{ vinculo \} = await entrar\(correo, c\);[\s\S]{0,80}activarDesbloqueo\(c, vinculo\)/, 'la huella se guarda con el vínculo de la sesión que entró');
  assert.match(leerSrc('cartera/veta/PedirClave.tsx'), /activarDesbloqueo\(c, v\)/, 'la ficha guarda la huella con el vínculo de cuando empezó');
});

prueba('VETA02: un 409 o una recarga sin respuesta clara se reconcilian con el estado real; nunca se repiten', () => {
  const t = leerSrc('cartera/veta/SeccionTarjeta.tsx');
  assert.match(t, /que === 'recargar'\) void reconciliarRecarga\('ya-habia'\)/, '409: se mira la recarga que ya había');
  assert.match(t, /que === 'recargar' && e instanceof ErrorVeta && \(e\.tipo === 'tiempo' \|\| e\.tipo === 'red' \|\| e\.tipo === 'servidor'\)\) \{[\s\S]{0,160}reconciliarRecarga\('incierta'\)/, 'tiempo/red: se reconcilia');
  const r = t.slice(t.indexOf('const reconciliarRecarga'), t.indexOf('const autorizar'));
  assert.match(r, /api\.estadoRecarga\(\)/);
  assert.match(r, /setRecarga\(r\);\s*desdeRecarga\.current = Date\.now\(\);/, 'el seguimiento arranca de verdad');
  assert.doesNotMatch(r, /api\.recargar\(/, 'no se vuelve a mandar');
  assert.match(r, /const gs = genSesion\.current;\s*\/\/[^\n]*\n\s*setRecargando\(false\);\s*setMonto\(''\);/, 'el formulario se cierra ya: un segundo «Recargar» no cobra dos veces');
  assert.doesNotMatch(r, /Recarga acreditada/, '«funded» puede ser una recarga de antes: no se canta victoria');
});

prueba('WAL01: saldos e historial de otra dirección (o llegados tras desconectar) se descartan', () => {
  const t = leerSrc('cartera/useMiCartera.ts');
  assert.match(t, /const sirve = \(\) => vivo\.current && e === epoca\.current && vigente\.current\?\.toLowerCase\(\) === d\.toLowerCase\(\);/);
  assert.match(t, /if \(!sirve\(\) \|\| c\.direccion\.toLowerCase\(\) !== d\.toLowerCase\(\)\) return;/, 'saldos solo de la dirección vigente');
  assert.match(t, /\.then\(\(h\) => \{\s*if \(!sirve\(\)\) return;/, 'historial solo de la generación vigente');
  assert.match(t, /quitar: async \(\) => \{\s*fijarDireccion\(null\);/, 'desconectar invalida antes de esperar');
  assert.match(t, /if \(!vivo\.current \|\| e !== epoca\.current\) return;/, 'una conexión vieja no pisa a la nueva');
});

prueba('WAL02: al cerrar sesión el vigía del pago se suelta (la conducta la prueba tests/cartera.test.ts)', () => {
  assert.match(leerSrc('cartera/estado.ts'), /RELEVO\.alSalir\(\(\) => vigia\.soltar\(\)\);/);
  const v = leerSrc('cartera/vigia.ts');
  assert.match(v, /soltar\(\) \{\s*this\.generacion\+\+;/, 'soltar invalida lo que está en vuelo');
  assert.match(v, /if \(this\.mirando === vuelta\) this\.mirando = 0;/, 'una vuelta vieja no apaga la bandera de la nueva');
});

(async () => {
  let fallos = 0;
  for (const [n, f] of pruebas) {
    try { await f(); console.log('ok -', n); } catch (e) { fallos++; console.log('MAL -', n, '\n  ', e && e.message); }
  }
  console.log(`\n${pruebas.length - fallos}/${pruebas.length} pruebas de la tarjeta de Veta Wallet`);
  process.exit(fallos ? 1 : 0);
})();
