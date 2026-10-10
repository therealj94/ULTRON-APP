/**
 * LA ENTRADA ABIERTA (José, 10-oct: «nadie normal puede entrar a AU-RA»).
 *
 * Lo que tiene que ser verdad:
 *   · «Crear cuenta» abre la cuenta Y la sesión de MIEMBRO en el acto (comunidad: abre la mesa como miembro,
 *     nunca junta), y manda el código de 6 cifras para confirmar el correo; sin correo configurado, entra igual;
 *   · un correo con cuenta, del padrón o de la junta contesta lo MISMO (no se sabe cuál de los tres);
 *   · contraseña débil, correo malo → 400 con su campo; el código malo no confirma; el freno de códigos y el de
 *     cuentas por conexión funcionan; en Dr Electrum estas rutas no existen y una cuenta de aquí no le abre nada;
 *   · el pase que Genesis valida pero SIN destino «aura» sigue sin dar identidad de Genesis (401 PASE_INVALIDO),
 *     y la misma persona entra igual por /api/veta/entrar con el token de la wallet, que el SERVIDOR comprueba;
 *   · cada intento deja UNA línea en el registro con la ruta, el resultado, el motivo y el tiempo, y el correo
 *     enmascarado (nunca entero, nunca el token).
 *   · Con base (ELECTRUM_DB_URL de pruebas): la cuenta propia de verdad en Postgres — entra con su clave, la mala
 *     no, el duplicado no se toca, el código se gasta una vez, y Genesis o el enlace del correo le quitan la
 *     clave a quien se adelantó a registrar el correo de otro.
 */
import './datos-prueba'; // la junta inventada de las pruebas (lo real vive en Render)
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import type { AddressInfo } from 'node:net';

process.env.CUENTAS_DB_URL = process.env.CUENTAS_DB_URL || process.env.ELECTRUM_DB_URL || '';
process.env.ULTRON_SESION_SECRETO = process.env.ULTRON_SESION_SECRETO || 'secreto-de-sesion-para-pruebas-largo-1234';

const { montarRutasRegistro, MENSAJE_NO_DISPONIBLE } = await import('../server/registro-cuentas');
const { enmascararCorreo, lineaEntrada, resultadoDe } = await import('../server/registro-entrada');
const { montarRutasGenesis, verificarPase } = await import('../server/genesis');
const { montarRutasVeta, _reiniciarVeta } = await import('../server/veta-entrar');
const { esDeComunidad, sesionAbreAura, sesionDe, limitar } = await import('../server/seguridad');
const cuentas = await import('../server/cuentas');
const { exigirBaseDePrueba } = await import('../lib/base-de-pruebas');

/* ------------------------------------------------------------------ utilidades */

/** Corre `f` capturando lo que sale por consola. */
async function conConsola<T>(f: () => Promise<T>): Promise<{ r: T; salida: string[] }> {
  const salida: string[] = [];
  const orig = { log: console.log, warn: console.warn, error: console.error };
  for (const k of Object.keys(orig) as (keyof typeof orig)[]) (console as any)[k] = (...a: unknown[]) => salida.push(a.map(String).join(' '));
  try {
    const r = await f();
    // La línea se escribe al terminar la respuesta: un respiro para que el «finish» llegue.
    await new Promise((ok) => setTimeout(ok, 20));
    return { r, salida };
  } finally {
    Object.assign(console, orig);
  }
}

async function levantar(app: express.Express) {
  const srv = app.listen(0);
  await new Promise((r) => srv.once('listening', r));
  const base = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
  const pedir = async (ruta: string, cuerpo?: unknown, token?: string) => {
    const r = await fetch(base + ruta, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(token ? { 'x-ultron-sesion': token } : {}) },
      body: JSON.stringify(cuerpo ?? {}),
    });
    return { status: r.status, json: (await r.json().catch(() => ({}))) as any };
  };
  return { pedir, cerrar: () => new Promise((r) => srv.close(r)) };
}

const reqCon = (token: string) => ({ headers: { 'x-ultron-sesion': token } }) as any;
const pasa: express.RequestHandler = (_q, _s, n) => n();

/** Un almacén en memoria con el contrato de server/cuentas.ts (crear, código, confirmar). */
function almacenEnMemoria() {
  const filas = new Map<string, { nombre: string; clave: string; confirmado: boolean }>();
  const codigos = new Map<string, { codigo: string; en: number; usado: boolean }>();
  return {
    filas,
    codigos,
    almacen: {
      disponible: () => true,
      crearCuenta: async (correo: string, nombre: string, clave: string) => {
        if (filas.has(correo)) return 'existe' as const;
        filas.set(correo, { nombre, clave, confirmado: false });
        return 'creada' as const;
      },
      crearCodigo: async (correo: string) => {
        const previo = codigos.get(correo);
        if (previo && !previo.usado && Date.now() - previo.en < 60_000) return null;
        const codigo = String(Math.floor(Math.random() * 1_000_000)).padStart(6, '0');
        codigos.set(correo, { codigo, en: Date.now(), usado: false });
        return codigo;
      },
      usarCodigo: async (correo: string, codigo: string) => {
        const c = codigos.get(correo);
        if (!c || c.usado || c.codigo !== codigo) return false;
        c.usado = true;
        filas.get(correo)!.confirmado = true;
        return true;
      },
      correoConfirmado: async (correo: string) => !!filas.get(correo)?.confirmado,
    },
  };
}

type Enviado = { para: string; asunto: string; texto: string };

async function montarRegistro(o: { plataforma?: 'ultron' | 'electrum'; correo?: boolean; limitarReal?: boolean; junta?: string[] } = {}) {
  const app = express();
  app.use(express.json());
  const m = almacenEnMemoria();
  const buzon: Enviado[] = [];
  montarRutasRegistro(app, {
    plataforma: o.plataforma ?? 'ultron',
    normalizarCorreo: (c) => String(c || '').trim().toLowerCase(),
    nombreYRol: (correo, nombre) => ({ nombre: nombre || correo, rol: 'Miembro · Genesis ID' }),
    almacen: m.almacen,
    enviarCorreo: async (c) => {
      buzon.push({ para: c.para, asunto: c.asunto, texto: c.texto });
      return { ok: true, detalle: 'enviado' };
    },
    correoListo: () => o.correo !== false,
    limitar: o.limitarReal ? limitar : () => pasa,
    esJunta: (c) => (o.junta || []).includes(c),
  });
  return { ...(await levantar(app)), ...m, buzon };
}

const codigoDe = (texto: string) => /\b(\d{6})\b/.exec(texto)?.[1] || '';

/* ------------------------------------------------------------------ crear cuenta */

test('crear cuenta → sesión de MIEMBRO en el acto (comunidad, abre la mesa como miembro) y el código al correo', async () => {
  const s = await montarRegistro();
  try {
    const { r, salida } = await conConsola(() => s.pedir('/api/ultron/cuentas/crear', { nombre: '  Ana   López ', correo: 'Ana.Nueva@Correo.com', clave: 'una frase larga' }));
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.equal(r.json.ok, true);
    assert.equal(r.json.nivel, 'miembro');
    assert.equal(r.json.confirmacion, 'enviado');
    assert.equal(r.json.correoConfirmado, false);
    assert.deepEqual(r.json.miembro, { nombre: 'Ana López', correo: 'ana.nueva@correo.com', rol: 'Miembro · Genesis ID', gid: '' });
    // La sesión es de verdad: firmada, de comunidad, abre AU-RA como miembro.
    const ses = sesionDe(reqCon(r.json.token));
    assert.ok(ses, 'la sesión vale');
    assert.equal(ses!.correo, 'ana.nueva@correo.com');
    assert.equal(ses!.comunidad, true, 'marca de comunidad firmada');
    assert.equal(sesionAbreAura(ses!.correo, !!ses!.comunidad), true);
    // La contraseña se guardó para la cuenta (en la base de verdad, cifrada con scrypt) y el correo salió con el código.
    assert.equal(s.filas.get('ana.nueva@correo.com')?.clave, 'una frase larga');
    assert.equal(s.buzon.length, 1);
    assert.equal(s.buzon[0].para, 'ana.nueva@correo.com');
    assert.match(codigoDe(s.buzon[0].texto), /^\d{6}$/);
    assert.equal(codigoDe(s.buzon[0].texto), s.codigos.get('ana.nueva@correo.com')?.codigo);
    // UNA línea en el registro, con el correo enmascarado y sin la contraseña.
    const lineas = salida.filter((l) => l.startsWith('[entrada]'));
    assert.equal(lineas.length, 1, salida.join('\n'));
    assert.match(lineas[0], /^\[entrada\] ruta=\/api\/ultron\/cuentas\/crear status=200 resultado=OK detalle="cuenta nueva; código enviado" ms=\d+ quien=a\*\*\*@correo\.com$/);
    assert.ok(!salida.join('\n').includes('ana.nueva@correo.com'), 'el correo entero no sale al registro');
    assert.ok(!salida.join('\n').includes('una frase larga'), 'la contraseña tampoco');
  } finally {
    await s.cerrar();
  }
});

test('confirmar el correo: código malo no; el bueno sí, una vez; sin sesión, 401; reenviar con espera', async () => {
  const s = await montarRegistro();
  try {
    const r = await s.pedir('/api/ultron/cuentas/crear', { nombre: 'Beto', correo: 'beto@correo.com', clave: 'otra frase larga' });
    const token = r.json.token;
    const bueno = codigoDe(s.buzon[0].texto);
    const malo = bueno === '000000' ? '111111' : '000000';
    assert.equal((await s.pedir('/api/ultron/cuentas/confirmar', { codigo: bueno })).status, 401, 'sin sesión no se confirma nada');
    const m = await s.pedir('/api/ultron/cuentas/confirmar', { codigo: malo }, token);
    assert.deepEqual([m.status, m.json.codigo], [400, 'CODIGO_INVALIDO']);
    assert.equal((await s.pedir('/api/ultron/cuentas/confirmar', { codigo: '12' }, token)).json.codigo, 'CODIGO_FORMATO');
    // Reenviar enseguida: «espera»; el código de antes sigue valiendo.
    const re = await s.pedir('/api/ultron/cuentas/reenviar', {}, token);
    assert.deepEqual([re.status, re.json.codigo], [429, 'ESPERA']);
    const ok = await s.pedir('/api/ultron/cuentas/confirmar', { codigo: `${bueno.slice(0, 3)} ${bueno.slice(3)}` }, token);
    assert.equal(ok.status, 200, JSON.stringify(ok.json));
    assert.equal(ok.json.correoConfirmado, true);
    assert.equal(s.filas.get('beto@correo.com')?.confirmado, true);
    assert.equal((await s.pedir('/api/ultron/cuentas/confirmar', { codigo: bueno }, token)).json.codigo, 'CODIGO_INVALIDO', 'un código sirve una vez');
    // Ya confirmado, reenviar no manda nada.
    const ya = await s.pedir('/api/ultron/cuentas/reenviar', {}, token);
    assert.deepEqual([ya.status, ya.json.correoConfirmado], [200, true]);
    assert.equal(s.buzon.length, 1);
  } finally {
    await s.cerrar();
  }
});

test('probar códigos al azar se frena (por correo), aunque se tenga la sesión', async () => {
  const s = await montarRegistro();
  try {
    const r = await s.pedir('/api/ultron/cuentas/crear', { nombre: 'Caro', correo: 'caro.freno@correo.com', clave: 'frase larga de caro' });
    const bueno = codigoDe(s.buzon[0].texto);
    const estados: number[] = [];
    for (let i = 0; i < 7; i++) {
      const intento = String((Number(bueno) + 1 + i) % 1_000_000).padStart(6, '0');
      estados.push((await s.pedir('/api/ultron/cuentas/confirmar', { codigo: intento }, r.json.token)).status);
    }
    assert.ok(estados.includes(429), `el freno salta: ${estados.join(',')}`);
    // Con el freno puesto, ni el bueno pasa hasta que se enfríe.
    assert.equal((await s.pedir('/api/ultron/cuentas/confirmar', { codigo: bueno }, r.json.token)).status, 429);
  } finally {
    await s.cerrar();
  }
});

test('correo con cuenta, del padrón o de la junta: la MISMA respuesta (409), sin decir cuál; nada se crea', async () => {
  const s = await montarRegistro({ junta: ['solo.junta@ordenglobal.org'] });
  try {
    const primero = await s.pedir('/api/ultron/cuentas/crear', { nombre: 'Dani', correo: 'dani@correo.com', clave: 'una frase muy larga' });
    assert.equal(primero.status, 200);
    const respuestas = [];
    for (const correo of ['dani@correo.com', 'j.herrera@ordenglobal.org', 'solo.junta@ordenglobal.org']) {
      const r = await s.pedir('/api/ultron/cuentas/crear', { nombre: 'Alguien', correo, clave: 'frase larga de otro' });
      assert.equal(r.status, 409, correo);
      assert.equal(r.json.token, undefined, `${correo}: sin sesión`);
      respuestas.push(JSON.stringify(r.json));
    }
    assert.equal(new Set(respuestas).size, 1, 'las tres respuestas son idénticas');
    assert.equal(JSON.parse(respuestas[0]).error, MENSAJE_NO_DISPONIBLE);
    assert.equal(s.filas.get('dani@correo.com')?.clave, 'una frase muy larga', 'la cuenta que existía no se tocó');
    assert.ok(!s.filas.has('j.herrera@ordenglobal.org'));
  } finally {
    await s.cerrar();
  }
});

test('formulario malo: cada cosa con su código y su campo; nada se crea', async () => {
  const s = await montarRegistro();
  try {
    const casos: [Record<string, string>, string][] = [
      [{ nombre: 'E', correo: 'e@correo.com', clave: 'frase larga de e' }, 'NOMBRE'],
      [{ nombre: 'Eva', correo: 'eva@correo', clave: 'frase larga de eva' }, 'CORREO'],
      [{ nombre: 'Eva', correo: 'eva@correo.com', clave: 'corta' }, 'CLAVE_DEBIL'],
      [{ nombre: 'Eva', correo: 'eva@correo.com', clave: '12345678901' }, 'CLAVE_DEBIL'],
      [{ nombre: 'Eva', correo: 'evangelina@correo.com', clave: 'xxevangelinaxx' }, 'CLAVE_DEBIL'],
    ];
    for (const [cuerpo, codigo] of casos) {
      const r = await s.pedir('/api/ultron/cuentas/crear', cuerpo);
      assert.deepEqual([r.status, r.json.codigo], [400, codigo], JSON.stringify(cuerpo));
    }
    assert.equal(s.filas.size, 0);
  } finally {
    await s.cerrar();
  }
});

test('sin correo configurado: se entra igual, la cuenta queda sin confirmar y no se pide código', async () => {
  const s = await montarRegistro({ correo: false });
  try {
    const r = await s.pedir('/api/ultron/cuentas/crear', { nombre: 'Fede', correo: 'fede@correo.com', clave: 'otra frase muy larga' });
    assert.equal(r.status, 200);
    assert.equal(r.json.confirmacion, 'sin_correo');
    assert.ok(sesionDe(reqCon(r.json.token)), 'la sesión vale');
    assert.equal(s.buzon.length, 0);
    assert.equal(s.filas.get('fede@correo.com')?.confirmado, false);
  } finally {
    await s.cerrar();
  }
});

test('cuentas nuevas por conexión: el tope de verdad (seguridad.limitar) corta la séptima', async () => {
  const s = await montarRegistro({ limitarReal: true });
  try {
    const estados: number[] = [];
    for (let i = 0; i < 7; i++) estados.push((await s.pedir('/api/ultron/cuentas/crear', { nombre: 'Gabi', correo: `gabi${i}@correo.com`, clave: 'frase larga de gabi' })).status);
    assert.deepEqual(estados, [200, 200, 200, 200, 200, 200, 429]);
  } finally {
    await s.cerrar();
  }
});

test('Dr Electrum: «crear cuenta» no existe allí y una sesión de comunidad no se le emite a nadie', async () => {
  const s = await montarRegistro({ plataforma: 'electrum' });
  try {
    const r = await s.pedir('/api/ultron/cuentas/crear', { nombre: 'Hugo', correo: 'hugo@correo.com', clave: 'frase larga de hugo' });
    assert.deepEqual([r.status, r.json.codigo], [404, 'SOLO_AURA']);
    assert.equal(r.json.token, undefined);
    assert.equal(s.filas.size, 0);
    // La puerta de Dr Electrum mira el padrón: alguien fuera de él nunca es «de la comunidad» allí.
    assert.equal(esDeComunidad('hugo@correo.com', 'electrum'), false);
    assert.equal(esDeComunidad('hugo@correo.com', 'ultron'), true);
  } finally {
    await s.cerrar();
  }
});

test('la puerta (server.ts): una cuenta propia solo entra a la plataforma que le toca; en Dr Electrum, SIN_ACCESO', () => {
  const src = fs.readFileSync(path.join(process.cwd(), 'server.ts'), 'utf8');
  const i = src.indexOf("app.post(['/api/electrum/entrar', '/api/ultron/entrar']");
  const ruta = src.slice(i, src.indexOf('function nombreYRolDe', i));
  assert.match(ruta, /if \(propia === 'mal'\) \{\s*anotarFalloEntrada\(correo, ipEntrada\);\s*return res\.status\(401\)/, 'contraseña mala: 401 y cuenta para el freno');
  assert.match(ruta, /if \(!puedeEntrar\(identificar\(\{ correo \}\), PLATAFORMA\) && !esDeComunidad\(correo, PLATAFORMA\)\) \{\s*return res\.status\(403\)/, 'Dr Electrum: fuera del padrón no entra');
  assert.match(ruta, /emitirSesion\(\{ correo, nombre, rol \}, \{ comunidad: esDeComunidad\(correo, PLATAFORMA\) \}\)/, 'en AU-RA, la sesión de comunidad');
  assert.match(src, /montarVigilancia\(app, \['\/api\/electrum\/entrar', '\/api\/ultron\/entrar'\]\)/, 'y la puerta deja su línea en el registro');
  assert.match(src, /esJunta: \(correo\) => nivelDeCorreo\(correo, PLATAFORMA\) !== 'miembro'/, 'la junta (AURA_JUNTA o padrón) no se registra');
});

/* ------------------------------------------------------------------ el registro */

test('el registro: correo enmascarado, identidad de la wallet como huella, nada de comillas ni saltos', () => {
  assert.equal(enmascararCorreo('Jose.Herrera@OrdenGlobal.org'), 'j***@ordenglobal.org');
  assert.match(enmascararCorreo('veta:0xabcdef0123456789abcdef0123456789abcdef01'), /^veta:#[0-9a-f]{10}$/);
  assert.equal(enmascararCorreo(''), '-');
  assert.match(enmascararCorreo('sin-arroba'), /^#[0-9a-f]{10}$/);
  const l = lineaEntrada({ ruta: '/api/genesis/entrar', status: 401, resultado: 'PASE_INVALIDO', detalle: 'sin "destino"\naura', ms: 12.4, quien: 'a***@x.com' });
  assert.equal(l, '[entrada] ruta=/api/genesis/entrar status=401 resultado=PASE_INVALIDO detalle="sin destino aura" ms=12 quien=a***@x.com');
  assert.equal(resultadoDe(200, { ok: true }), 'OK');
  assert.equal(resultadoDe(429, { error: 'demasiadas peticiones' }), 'LIMITE');
  assert.equal(resultadoDe(401, { error: 'Correo o clave incorrectos.', codigo: 'NO_ENTRA' }), 'NO_ENTRA');
  assert.equal(resultadoDe(502, {}), 'HTTP_502');
});

/* ------------------------------------------------------------------ el pase sin destino y la wallet */

const VERIF = 'v'.repeat(43);
const DIRECCION = '0xAbCdEf0123456789abcdef0123456789ABCDEF01';
const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
const TOKEN_WALLET = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ userId: 'u1', address: DIRECCION, verify: true, exp: Math.floor(Date.now() / 1000) + 2400 })}.firma-de-la-wallet-1234`;

test('pase que Genesis valida SIN destino «aura»: 401 PASE_INVALIDO sin identidad de Genesis (el motivo queda en el registro); con el token de la wallet entra como miembro', async () => {
  process.env.GENESIS_API_KEY_AURA = 'clave-aura';
  process.env.AURA_WALLET_API = 'https://wallet.prueba';
  delete process.env.AURA_VETA_ABIERTO;
  _reiniciarVeta();
  const pedidos: string[] = [];
  // Genesis de antes del destino (o un backend de la wallet que no le pasa `aud` ni `reto`): el pase vale, pero no es para AU-RA.
  const fetchFalso = (async (url: any, init: any) => {
    const u = String(url);
    pedidos.push(u);
    if (u.endsWith('/api/v1/sso/verificar')) {
      return new Response(JSON.stringify({ valido: true, gid: 'GEN-ANA1-ANA2-A', emitidoPor: 'veta', correo: 'ana@prueba.local', perfil: { verificada: true, nombre: 'ANA' } }), { status: 200 });
    }
    if (u === 'https://wallet.prueba/users/userDate') {
      // La wallet solo reconoce el token que ella firmó.
      if (init?.headers?.Authorization !== `Bearer ${TOKEN_WALLET}`) return new Response(JSON.stringify({ message: 'invalid token' }), { status: 401 });
      return new Response(JSON.stringify({ email: 'ana@prueba.local', name: 'Ana López' }), { status: 200 });
    }
    return new Response('{}', { status: 404 });
  }) as typeof fetch;
  const app = express();
  app.use(express.json());
  const sesiones: any[] = [];
  const emitir = (u: { correo: string; nombre: string; rol: string }, o?: { comunidad?: boolean }) => {
    sesiones.push({ ...u, comunidad: !!o?.comunidad });
    return { token: `ses-${sesiones.length}` };
  };
  montarRutasGenesis(app, {
    limitar: () => pasa,
    normalizarCorreo: (c) => String(c || '').trim().toLowerCase(),
    tieneAcceso: () => false,
    nombreYRol: (correo, nombre) => ({ nombre: nombre || correo, rol: 'Miembro · Genesis ID' }),
    emitirSesion: emitir,
    pedirAcceso: async () => true,
    fetch: fetchFalso,
  });
  montarRutasVeta(app, { limitar: () => pasa, cupo: () => true, emitirSesion: emitir, fetch: fetchFalso });
  const s = await levantar(app);
  try {
    const { r: g, salida } = await conConsola(() => s.pedir('/api/genesis/entrar', { pase: 'PASE-SIN-DESTINO', verificador: VERIF }));
    assert.deepEqual([g.status, g.json.codigo], [401, 'PASE_INVALIDO']);
    assert.equal(sesiones.length, 0, 'un pase sin destino «aura» nunca da una identidad de Genesis');
    const linea = salida.find((l) => l.startsWith('[entrada] ruta=/api/genesis/entrar'));
    assert.ok(linea, salida.join('\n'));
    assert.match(linea!, /status=401 resultado=PASE_INVALIDO detalle="sin destino aura" ms=\d+/);
    assert.ok(!salida.join('\n').includes('PASE-SIN-DESTINO'), 'el pase no sale al registro');

    // El respaldo de la app (mobile/src/lib/entrarConClave.ts, 4c): el token de la wallet, una vez.
    const { r: v, salida: s2 } = await conConsola(() => s.pedir('/api/veta/entrar', { token: TOKEN_WALLET }));
    assert.equal(v.status, 200, JSON.stringify(v.json));
    assert.equal(v.json.miembro.correo, 'veta:0xabcdef0123456789abcdef0123456789abcdef01', 'la identidad es la de la wallet');
    assert.deepEqual(sesiones[0], { correo: 'veta:0xabcdef0123456789abcdef0123456789abcdef01', nombre: 'Ana', rol: 'Miembro · Veta Wallet', comunidad: true });
    assert.ok(pedidos.includes('https://wallet.prueba/users/userDate'), 'el SERVIDOR le preguntó a la wallet');
    const lv = s2.find((l) => l.startsWith('[entrada] ruta=/api/veta/entrar'));
    assert.match(lv || '', /status=200 resultado=OK ms=\d+ quien=veta:#[0-9a-f]{10}$/);
    assert.ok(!s2.join('\n').includes(TOKEN_WALLET) && !s2.join('\n').includes('firma-de-la-wallet'), 'el token no sale al registro');

    // Un token que la wallet NO confirma no entra, aunque traiga la misma dirección: no se confía en el teléfono.
    const malo = await s.pedir('/api/veta/entrar', { token: TOKEN_WALLET.replace('1234', '9999') });
    assert.deepEqual([malo.status, malo.json.codigo], [401, 'TOKEN_INVALIDO']);
    assert.equal(sesiones.length, 1);
  } finally {
    await s.cerrar();
  }
});

test('verificarPase: bloqueada → BLOQUEADA (403, la app no busca otra puerta); sin verificar → SIN_VERIFICAR; clave de AU-RA rechazada → MAL_CONFIGURADO', async () => {
  process.env.GENESIS_API_KEY_AURA = 'clave-aura';
  const con = (status: number, body: unknown) => (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;
  assert.deepEqual(await verificarPase('p', VERIF, con(403, { valido: false, error: 'El acceso de esta identidad está bloqueado', codigo: 'IDENTIDAD_BLOQUEADA' })), { estado: 403, codigo: 'BLOQUEADA', detalle: 'IDENTIDAD_BLOQUEADA' });
  assert.equal(((await verificarPase('p', VERIF, con(403, { valido: false, error: 'La identidad ya no está verificada' }))) as any).codigo, 'SIN_VERIFICAR');
  const mal = (await verificarPase('p', VERIF, con(401, { error: 'Clave de API inválida o revocada' }))) as any;
  assert.deepEqual([mal.estado, mal.codigo], [503, 'MAL_CONFIGURADO']);
  const usado = (await verificarPase('p', VERIF, con(401, { valido: false, error: 'Este pase ya se usó', codigo: 'USADO' }))) as any;
  assert.deepEqual([usado.codigo, usado.detalle], ['PASE_INVALIDO', 'USADO']);
  const sinDestino = (await verificarPase('p', VERIF, con(200, { valido: true, gid: 'GEN-ANA1-ANA2-A', correo: 'a@b.co', perfil: { verificada: true } }))) as any;
  assert.deepEqual([sinDestino.codigo, sinDestino.detalle], ['PASE_INVALIDO', 'sin destino aura']);
});

/* ------------------------------------------------------------------ con Postgres de verdad */

const sinBase = !cuentas.cuentasDisponibles();

async function vaciarCuentas() {
  exigirBaseDePrueba(cuentas.urlCuentas());
  const pool = new (await import('pg')).Pool({ connectionString: cuentas.urlCuentas() });
  try {
    await cuentas.cuentaDe('nadie@nadie.co'); // asegura el esquema
    await pool.query('TRUNCATE cuentas.cuenta, cuentas.enlace');
  } finally {
    await pool.end();
  }
}

test('cuenta propia en Postgres: entra con su clave, la mala no, el duplicado no se toca, el código una vez', { skip: sinBase ? 'sin base' : false }, async () => {
  await vaciarCuentas();
  assert.equal(await cuentas.crearCuentaPropia('ines@correo.com', 'Inés', 'frase larga de ines'), 'creada');
  assert.equal(await cuentas.crearCuentaPropia('ines@correo.com', 'Otra', 'otra frase cualquiera'), 'existe');
  assert.equal(await cuentas.entrarConCuenta('ines@correo.com', 'frase larga de ines'), 'ok', 'el duplicado no le cambió la clave');
  assert.equal(await cuentas.entrarConCuenta('ines@correo.com', 'otra frase cualquiera'), 'mal');
  const c = await cuentas.cuentaDe('ines@correo.com');
  assert.deepEqual([c?.propia, c?.correoConfirmado, c?.tieneClave, Object.keys(c?.acceso || {}).length], [true, false, true, 0], 'propia, sin confirmar, sin acceso en el padrón');
  assert.equal(await cuentas.puedeRecuperar('ines@correo.com'), true, '«olvidé mi contraseña» también para estas cuentas');
  const k = await cuentas.crearCodigoCorreo('ines@correo.com');
  assert.match(String(k), /^\d{6}$/);
  assert.equal(await cuentas.crearCodigoCorreo('ines@correo.com'), null, 'reenviar enseguida no manda otro');
  assert.equal(await cuentas.usarCodigoCorreo('otra@correo.com', k!), false, 'el código es de ese correo');
  assert.equal(await cuentas.usarEnlace(k!), null, 'un código no sirve como enlace');
  assert.equal(await cuentas.usarCodigoCorreo('ines@correo.com', k!), true);
  assert.equal(await cuentas.usarCodigoCorreo('ines@correo.com', k!), false, 'una vez');
  assert.equal((await cuentas.cuentaDe('ines@correo.com'))?.correoConfirmado, true);
  // Recargar el padrón no la sube: sigue siendo miembro.
  await cuentas.recargarCuentas();
  assert.equal(esDeComunidad('ines@correo.com', 'ultron'), true);
});

test('Genesis prueba al dueño del correo: la cuenta SIN confirmar pierde la clave que le puso otro; la confirmada no', { skip: sinBase ? 'sin base' : false }, async () => {
  await vaciarCuentas();
  await cuentas.crearCuentaPropia('juan@correo.com', 'Intruso', 'clave del intruso 1');
  assert.equal(await cuentas.reclamarCuentaSinConfirmar('juan@correo.com'), true);
  assert.equal(await cuentas.entrarConCuenta('juan@correo.com', 'clave del intruso 1'), 'sin_clave', 'la clave del intruso ya no abre');
  assert.equal((await cuentas.cuentaDe('juan@correo.com'))?.correoConfirmado, true);
  assert.equal(await cuentas.reclamarCuentaSinConfirmar('juan@correo.com'), false, 'no hay nada más que cortar');
  await cuentas.crearCuentaPropia('karla@correo.com', 'Karla', 'clave de karla 123');
  await cuentas.confirmarCorreoCuenta('karla@correo.com');
  assert.equal(await cuentas.reclamarCuentaSinConfirmar('karla@correo.com'), false);
  assert.equal(await cuentas.entrarConCuenta('karla@correo.com', 'clave de karla 123'), 'ok', 'la confirmada no se toca');
  await cuentas._cerrarCuentas();
});
