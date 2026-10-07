// Identidad · la clave de la 5.6.0 pasa detrás de la huella SIN dejar a nadie fuera (revisión previa a fusionar #157,
// bloqueante 1) y la huella no se pide a lo loco (no bloqueante 1).
//
// Con el código REAL: lib/api.ts (la renovación), lib/credsSeguras.ts (la entrada guardada, por el shim de storage con
// `__mesa.llavero`) y lib/permisoHuella.ts (cuándo se puede preguntar). El llavero y la huella del sistema, de mentira:
// el llavero anota con qué opciones se guardó cada llave y cuántas veces el sistema sacó un diálogo.
//
//  L1  Clave en claro de la 5.6.0 + la OTA: abrir la app NO la borra; la renovación sigue funcionando SIN diálogo
//      (también de fondo y con la app detrás), igual que antes de la OTA.
//  L2  La primera entrada con la huella: LocalAuthentication confirma, la clave va con requireAuthentication, se anota
//      conHuella y su PBKDF2 (entrar sin red), y SOLO ENTONCES desaparece la clave en claro. Desde ahí, la renovación
//      sale por la huella.
//  L3  Clave de la 5.6.0 sin huella activada: todo como estaba (renueva sola; volver a entrar sin huella la conserva).
//  L4  En ningún orden de fallos (huella cancelada, sin bloqueo de pantalla, el llavero que falla a medias) se termina
//      sin clave y sin token cuando antes había una.
//  P1  La huella solo se pide delante y para algo de la persona; lo de fondo falla callado; tras cancelar, 10 minutos
//      sin preguntar; un solo diálogo para varios 401 juntos; «Toca para desbloquear» la pide aunque esté en pausa.
//  P2  La intro: con la clave detrás de la huella y el token vencido, «bloqueada» (no pregunta; queda el aviso).
const { ok, fin } = require('../chat/comun.cjs');

(async () => {
  const M = require('./paquete.cjs')();
  const { API, CUENTA, HUELLA, CREDS } = M;
  if (!HUELLA || !CREDS) {
    ok('el paquete trae lib/permisoHuella y lib/credsSeguras', false);
    return fin();
  }
  const mesa = globalThis.__mesa;
  const K = CREDS.LLAVES_CREDS;
  const CORREO = 'jose@prueba.local';
  const BUENA = 'clave-buena';
  console.log('identidad · la huella y la clave de antes\n');

  /** El llavero de mentira (expo-secure-store + LocalAuthentication). */
  function nuevoLlavero() {
    const ll = {
      m: new Map(),
      opciones: new Map(),
      dialogos: [],
      cancelar: false,
      cancelarGuardar: false,
      sinBloqueo: false,
      fallaEscribir: null,
      confirma: true,
      soloEsteTelefono: 'WHEN_UNLOCKED_THIS_DEVICE_ONLY',
      async get(k, o) {
        if (o && o.requireAuthentication) {
          ll.dialogos.push({ que: 'leer', motivo: o.authenticationPrompt });
          if (ll.cancelar) throw new Error('User canceled the authentication');
        }
        return ll.m.has(k) ? ll.m.get(k) : null;
      },
      async set(k, v, o) {
        if (o && o.requireAuthentication) {
          ll.dialogos.push({ que: 'guardar', motivo: o.authenticationPrompt });
          if (ll.cancelar || ll.sinBloqueo || ll.cancelarGuardar) throw new Error('no se pudo guardar con huella');
        }
        if (ll.fallaEscribir && ll.fallaEscribir(k)) throw new Error('el llavero falló');
        ll.m.set(k, String(v));
        ll.opciones.set(k, o || {});
      },
      async del(k) {
        ll.m.delete(k);
        ll.opciones.delete(k);
      },
      async autenticar(motivo) {
        ll.dialogos.push({ que: 'confirmar', motivo });
        return ll.confirma && !ll.cancelar;
      },
    };
    return ll;
  }
  const legado = (ll, clave = BUENA) => ll.m.set(K.creds, JSON.stringify({ correo: CORREO, clave, name: 'José' }));
  const crudo = (ll) => JSON.parse(ll.m.get(K.creds) || 'null');
  /** ¿La clave sigue recuperable? (en claro de antes, o detrás de la huella con la marca puesta) */
  const claveRecuperable = (ll) => {
    const c = crudo(ll);
    return !!c && ((typeof c.clave === 'string' && !!c.clave) || (c.conHuella === true && ll.m.has(K.clave)));
  };

  // El servidor de mentira: /entrar da token nuevo con la clave buena; lo demás, 401 con el token vencido.
  let entradas = 0;
  let tokens = 0;
  globalThis.fetch = async (url, init = {}) => {
    const u = new URL(String(url));
    if (u.pathname === '/api/ultron/entrar') {
      entradas++;
      const b = JSON.parse(init.body || '{}');
      return b.clave === BUENA ? new Response(JSON.stringify({ token: `tok-nuevo-${++tokens}` }), { status: 200 }) : new Response('{"error":"clave"}', { status: 401 });
    }
    const t = (init.headers || {})['x-ultron-sesion'];
    const vivo = typeof t === 'string' && t.startsWith('tok-nuevo');
    if (u.pathname === '/api/ultron/sesion') {
      return vivo ? new Response(JSON.stringify({ authenticated: true, user: { correo: CORREO } }), { status: 200 }) : new Response('{"authenticated":false}', { status: 401 });
    }
    return vivo ? new Response('{"ok":true}', { status: 200 }) : new Response('{"error":"sesión requerida","code":"sesion_requerida"}', { status: 401 });
  };

  /** Todo como al abrir la app después de la OTA, con José dentro y el token vencido (pasaron 14 días). */
  function abrir(ll) {
    mesa.creds = null;
    mesa.llavero = ll;
    mesa.sesion = { correo: CORREO, name: 'José' };
    mesa.token = 'tok-vencido';
    CUENTA.fijarCuenta(CORREO, { nueva: true });
    HUELLA._reiniciarPermisoHuella();
    HUELLA._fijarPrimerPlano(() => true);
  }
  const pedir = (ruta) => API.api(ruta, ruta.includes('turno') ? { method: 'POST', body: '{}' } : undefined, 8000).then(() => 'ok', (e) => e?.status || 'error');

  /* ── L1: la clave de la 5.6.0 sigue renovando sin diálogo ─────────────────────────────────────── */
  {
    const ll = nuevoLlavero();
    legado(ll);
    abrir(ll);
    const leida = await CREDS.crearCreds(ll).leer(); // lo que hace la app al abrir (Intro, LoginScreen)
    ok('L1: abrir la app NO borra la clave en claro de la 5.6.0', crudo(ll).clave === BUENA, JSON.stringify(crudo(ll)));
    ok('L1: se lee como `legado` (sin la clave a la vista)', leida.legado === true && leida.clave === undefined && !leida.conHuella, JSON.stringify(leida));
    // De fondo y con la app detrás: igual renueva (como antes de la OTA), sin diálogo.
    HUELLA._fijarPrimerPlano(() => false);
    const r = await pedir('/api/perfil');
    ok('L1: con el token vencido, una petición de fondo renueva y sale bien', r === 'ok', String(r));
    ok('L1: …sin ningún diálogo de huella', ll.dialogos.length === 0, JSON.stringify(ll.dialogos));
    ok('L1: …y el token nuevo quedó guardado', mesa.token.startsWith('tok-nuevo'), mesa.token);
    // La voz (lib/tts.ts → renovarTokenVoz): igual.
    mesa.token = 'tok-vencido';
    ok('L1: la voz renueva sola (AU-RA no se calla)', (await API.renovarTokenVoz(false)) === true && mesa.token.startsWith('tok-nuevo'));
    // La intro: comprobarSesion con el token vencido.
    mesa.token = 'tok-vencido';
    HUELLA._fijarPrimerPlano(() => true);
    ok('L1: la intro la ve «viva» (se renovó sin preguntar)', (await API.comprobarSesion(CORREO)) === 'viva');
    ok('L1: sigue sin diálogos y la clave sigue ahí (todavía no hubo huella)', ll.dialogos.length === 0 && crudo(ll).clave === BUENA);
    ok('L1: nada quedó pendiente de desbloquear', HUELLA.desbloqueoPendiente() === false);
  }

  /* ── L2: la primera huella migra; desde ahí la renovación va por la huella ────────────────────── */
  {
    const ll = nuevoLlavero();
    legado(ll);
    abrir(ll);
    const c = CREDS.crearCreds(ll);
    const abierta = await c.desbloquear('Desbloquear AU-RA');
    ok('L2: la entrada rápida suelta la clave', abierta?.clave === BUENA && abierta.migrada === true, JSON.stringify(abierta));
    ok('L2: primero confirmó LocalAuthentication con «Desbloquear AU-RA»', ll.dialogos[0]?.que === 'confirmar' && ll.dialogos[0].motivo === 'Desbloquear AU-RA', JSON.stringify(ll.dialogos));
    ok('L2: la clave quedó en su llave con requireAuthentication (solo este teléfono)', ll.m.get(K.clave) === BUENA && ll.opciones.get(K.clave).requireAuthentication === true && ll.opciones.get(K.clave).keychainAccessible === 'WHEN_UNLOCKED_THIS_DEVICE_ONLY');
    const v = crudo(ll);
    ok('L2: la clave en claro desapareció de lo visible', !('clave' in v) && !JSON.stringify(v).includes(BUENA), JSON.stringify(v));
    ok('L2: conHuella anotado, con la huella PBKDF2 de la clave', v.conHuella === true && /^p1\$[^$]+\$[0-9a-f]{64}$/.test(v.claveHuella || ''), JSON.stringify(v));
    ok('L2: sin red, la clave se comprueba con el PBKDF2 (buena sí, otra no)', (await c.comprobarSinRed(CORREO, BUENA)) && !(await c.comprobarSinRed(CORREO, 'otra')) && CREDS.claveCoincide(v, BUENA));
    const leida = await c.leer();
    ok('L2: ya no es `legado`', !leida.legado && leida.conHuella === true);

    // Renovar después de migrar: de fondo NO pregunta, falla callado y deja el aviso.
    const antes = ll.dialogos.length;
    mesa.token = 'tok-vencido';
    const fondo = await pedir('/api/perfil');
    ok('P1: de fondo, con la clave detrás de la huella: falla callado (401), sin diálogo', fondo === 401 && ll.dialogos.length === antes, `${fondo} · ${ll.dialogos.length - antes} diálogos`);
    ok('P1: …y queda «Toca para desbloquear»', HUELLA.desbloqueoPendiente() === true);
    // Un turno (la persona espera): pregunta una vez y renueva.
    const turno = await pedir('/api/turno');
    ok('L2: un turno renueva por la huella', turno === 'ok' && mesa.token.startsWith('tok-nuevo'), String(turno));
    const nuevos = ll.dialogos.slice(antes);
    ok('L2: …con UN diálogo que lee la clave de la huella, «Desbloquear AU-RA»', nuevos.length === 1 && nuevos[0].que === 'leer' && nuevos[0].motivo === 'Desbloquear AU-RA', JSON.stringify(nuevos));
    ok('L2: el aviso se fue', HUELLA.desbloqueoPendiente() === false);
  }

  /* ── P1: cuándo se pide la huella ─────────────────────────────────────────────────────────────── */
  {
    const ll = nuevoLlavero();
    abrir(ll);
    const c = CREDS.crearCreds(ll);
    await c.guardar({ correo: CORREO, clave: BUENA, name: 'José', conHuella: true });
    ll.dialogos.length = 0;

    // Varios 401 a la vez (turno + voz + oído): UN diálogo.
    mesa.token = 'tok-vencido';
    const rs = await Promise.all([pedir('/api/turno'), pedir('/api/turno'), API.renovarTokenVoz(true), pedir('/api/stt')]);
    ok('P1: cuatro 401 juntos de la persona comparten UN diálogo', ll.dialogos.filter((d) => d.que === 'leer').length === 1, JSON.stringify(ll.dialogos));
    ok('P1: …y todos siguieron', rs[0] === 'ok' && rs[1] === 'ok' && rs[2] === true && rs[3] === 'ok', JSON.stringify(rs));

    // App detrás: aunque sea un turno, no pregunta.
    mesa.token = 'tok-vencido';
    ll.dialogos.length = 0;
    HUELLA._fijarPrimerPlano(() => false);
    const detras = await pedir('/api/turno');
    ok('P1: con la app detrás, ni un turno saca el diálogo', detras === 401 && ll.dialogos.length === 0, `${detras} · ${ll.dialogos.length}`);
    HUELLA._fijarPrimerPlano(() => true);

    // Lo que se adelanta (el permiso del oído para después, las muletillas) no pregunta.
    ok('P1: el permiso anticipado del oído no pregunta', (await API.pedirPermisoTurbo({ anticipado: true })) === null && ll.dialogos.length === 0, String(ll.dialogos.length));
    ok('P1: la voz de una precarga (muletillas) no pregunta', (await API.renovarTokenVoz(false)) === false && ll.dialogos.length === 0);

    // Cancelar: 10 minutos sin preguntar solo.
    ll.cancelar = true;
    const cancelado = await pedir('/api/turno');
    ok('P1: la persona cancela: el turno falla y queda el aviso', cancelado === 401 && HUELLA.desbloqueoPendiente() === true, String(cancelado));
    ok('P1: …fue UN diálogo', ll.dialogos.length === 1, String(ll.dialogos.length));
    ll.cancelar = false;
    await pedir('/api/turno');
    await pedir('/api/stt');
    ok('P1: en la pausa de 10 minutos, más turnos NO vuelven a preguntar', ll.dialogos.length === 1, String(ll.dialogos.length));
    const real = Date.now;
    try {
      const t0 = real();
      Date.now = () => t0 + 9 * 60_000;
      await pedir('/api/turno');
      ok('P1: a los 9 minutos, todavía no', ll.dialogos.length === 1, String(ll.dialogos.length));
      Date.now = () => t0 + HUELLA.PAUSA_TRAS_CANCELAR_MS + 1_000;
      const otra = await pedir('/api/turno');
      ok('P1: pasados los 10 minutos, el siguiente turno sí pregunta (y renueva)', ll.dialogos.length === 2 && otra === 'ok', `${ll.dialogos.length} · ${otra}`);
    } finally {
      Date.now = real;
    }

    // «Toca para desbloquear» pregunta aunque esté en pausa.
    mesa.token = 'tok-vencido';
    ll.cancelar = true;
    await pedir('/api/turno');
    ll.cancelar = false;
    const n = ll.dialogos.length;
    await pedir('/api/turno');
    ok('P1: tras otro cancelar, en pausa', ll.dialogos.length === n);
    ok('P1: «Toca para desbloquear» pregunta ya y renueva', (await API.desbloquearSesion()) === true && ll.dialogos.length === n + 1 && mesa.token.startsWith('tok-nuevo'));
    ok('P1: …y el aviso se fue', HUELLA.desbloqueoPendiente() === false);

    // P2: la intro no pregunta (tiene un tope de 4 s): «bloqueada», con el aviso puesto.
    mesa.token = 'tok-vencido';
    HUELLA._reiniciarPermisoHuella();
    const m0 = ll.dialogos.length;
    const estado = await API.comprobarSesion(CORREO);
    ok('P2: la intro, con la clave detrás de la huella y el token vencido: «bloqueada», sin diálogo', estado === 'bloqueada' && ll.dialogos.length === m0, `${estado} · ${ll.dialogos.length - m0}`);
    ok('P2: …y «Toca para desbloquear» queda puesto', HUELLA.desbloqueoPendiente() === true);
    // Una de fondo en vuelo no deja sin diálogo a la de la persona que llega detrás.
    HUELLA._reiniciarPermisoHuella();
    const [a, b] = await Promise.all([pedir('/api/perfil'), pedir('/api/turno')]);
    ok('P1: una renovación de fondo en vuelo no le quita el diálogo al turno que llega detrás', b === 'ok' && ll.dialogos.length === m0 + 1, `${a} ${b} · ${ll.dialogos.length - m0}`);
  }

  /* ── L3: clave de la 5.6.0 sin huella activada ────────────────────────────────────────────────── */
  {
    const ll = nuevoLlavero();
    legado(ll);
    abrir(ll);
    const c = CREDS.crearCreds(ll);
    await c.leer();
    ok('L3: abrir no la toca', crudo(ll).clave === BUENA);
    ok('L3: renueva sola, sin diálogo', (await pedir('/api/turno')) === 'ok' && ll.dialogos.length === 0);
    await c.guardar({ correo: CORREO.toUpperCase(), name: 'José Nuevo' });
    ok('L3: reescribir el nombre (sin clave) conserva la clave de antes', crudo(ll).clave === BUENA && crudo(ll).name === 'José Nuevo', JSON.stringify(crudo(ll)));
    ok('L3: volver a entrar con clave y SIN huella: se queda como estaba (renueva sola)', (await c.guardar({ correo: CORREO, clave: BUENA, name: 'José', conHuella: false })) === false && crudo(ll).clave === BUENA && !ll.m.has(K.clave));
    const confirmar = await c.desbloquear('Confirma que eres tú', { migrar: false });
    ok('L3: «Entrar solo al escritorio» confirma que es el dueño pero NO migra', confirmar?.clave === BUENA && confirmar.migrada === false && crudo(ll).clave === BUENA && !ll.m.has(K.clave));
    ok('L3: sin red, la clave de antes se compara tal cual', (await c.comprobarSinRed(CORREO, BUENA)) && !(await c.comprobarSinRed(CORREO, 'otra')));
    mesa.token = 'tok-vencido';
    HUELLA._fijarPrimerPlano(() => false);
    ok('L3: y sigue renovando de fondo', (await pedir('/api/perfil')) === 'ok' && ll.dialogos.filter((d) => d.que !== 'confirmar').length === 0);
    // Cerrar sesión de verdad (guardar(null)) sí la borra: lo eligió la persona.
    await c.guardar(null);
    ok('L3: salir y no recordar borra todo (lo pidió la persona)', !ll.m.has(K.creds) && !ll.m.has(K.clave));
  }

  /* ── L4: nunca sin clave y sin token cuando antes había una ───────────────────────────────────── */
  {
    const casos = [
      ['canceló la huella al confirmar', (ll) => (ll.confirma = false)],
      ['canceló al guardar con huella', (ll) => (ll.cancelarGuardar = true)],
      ['el teléfono no tiene bloqueo seguro', (ll) => (ll.sinBloqueo = true)],
      ['el llavero falla al reescribir lo visible', (ll) => (ll.fallaEscribir = (k) => k === K.creds)],
      ['el llavero falla al guardar la clave', (ll) => (ll.fallaEscribir = (k) => k === K.clave)],
      ['todo bien', () => {}],
    ];
    for (const [nombre, preparar] of casos) {
      const ll = nuevoLlavero();
      legado(ll);
      abrir(ll);
      const c = CREDS.crearCreds(ll);
      preparar(ll);
      await c.leer();
      const r = await c.desbloquear('Desbloquear AU-RA').catch(() => null);
      ok(`L4 (${nombre}): la clave sigue recuperable`, claveRecuperable(ll), JSON.stringify(crudo(ll)));
      ll.confirma = true;
      ll.sinBloqueo = false;
      ll.cancelarGuardar = false;
      ll.fallaEscribir = null;
      // Delante y en un turno: si quedó migrada, la huella la suelta; si no, la de antes sigue sola.
      const t = await pedir('/api/turno');
      ok(`L4 (${nombre}): y el turno renueva`, t === 'ok' && mesa.token.startsWith('tok-nuevo'), `${t} · ${r ? `migrada=${r.migrada}` : 'sin desbloquear'}`);
    }
    // Volver a entrar con huella sobre la clave de antes, y el sistema no deja guardarla: no se queda sin nada.
    const ll = nuevoLlavero();
    legado(ll);
    abrir(ll);
    ll.sinBloqueo = true;
    const quedo = await CREDS.crearCreds(ll).guardar({ correo: CORREO, clave: BUENA, name: 'José', conHuella: true });
    ok('L4: entrar con clave pidiendo huella sin poder guardarla: la clave de antes se conserva', quedo === false && claveRecuperable(ll), JSON.stringify(crudo(ll)));
  }

  ok('las renovaciones fueron al servidor de verdad (POST /api/ultron/entrar)', entradas > 0, String(entradas));
  fin();
})();
