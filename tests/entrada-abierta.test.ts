/**
 * LA ENTRADA ABIERTA (José, 10-oct: «nadie normal puede entrar a AU-RA»), con el correo PROBADO antes de entrar
 * (revisión de seguridad del PR #176: registrar el correo de otra persona no puede dar una sesión a su nombre).
 *
 * Lo que tiene que ser verdad:
 *   · «Crear cuenta» abre la cuenta SIN confirmar y manda el código: NUNCA devuelve una sesión;
 *   · solo el código del buzón Y la clave de la cuenta abren la sesión de MIEMBRO (comunidad, nunca junta); el código
 *     malo → 401 y cuenta para el freno; un código sirve una vez;
 *   · la puerta (/api/ultron/entrar) a una cuenta propia sin confirmar contesta CORREO_SIN_CONFIRMAR, sin sesión, y
 *     manda el código;
 *   · sin correo configurado o si el envío falla: error claro, sin sesión, y la cuenta recién abierta se deshace;
 *   · un correo nuevo, con cuenta, del padrón o de la junta reciben LA MISMA respuesta (no se sabe cuál);
 *   · quien registró primero el correo de otro no se queda con la cuenta cuando el dueño la confirma;
 *   · en Dr Electrum estas rutas no existen y una cuenta de aquí no le abre nada;
 *   · el pase que Genesis valida SIN destino «aura» sigue sin dar identidad de Genesis (401 PASE_INVALIDO), y la misma
 *     persona entra por /api/veta/entrar con el token de la wallet, que el SERVIDOR comprueba;
 *   · cada intento deja UNA línea en el registro con el correo enmascarado (nunca entero, nunca el token).
 *   · Con base (ELECTRUM_DB_URL de pruebas): lo mismo contra Postgres de verdad.
 */
import './datos-prueba'; // la junta inventada de las pruebas (lo real vive en Render)
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import type { AddressInfo } from 'node:net';

process.env.CUENTAS_DB_URL = process.env.CUENTAS_DB_URL || process.env.ELECTRUM_DB_URL || '';
process.env.ULTRON_SESION_SECRETO = process.env.ULTRON_SESION_SECRETO || 'secreto-de-sesion-para-pruebas-largo-1234';

const { montarRutasRegistro, MENSAJE_ENVIADO, MENSAJE_SIN_ENVIO } = await import('../server/registro-cuentas');
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
const iguales = (a: string, b: string) => a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));

/** Un almacén en memoria con el contrato de server/cuentas.ts (crear, reabrir, clave, código). */
function almacenEnMemoria() {
  const filas = new Map<string, { nombre: string; clave: string; propia: boolean; confirmado: boolean }>();
  const codigos = new Map<string, { codigo: string; en: number; usado: boolean }>();
  return {
    filas,
    codigos,
    almacen: {
      disponible: () => true,
      crearCuenta: async (correo: string, nombre: string, clave: string) => {
        const f = filas.get(correo);
        if (!f) {
          filas.set(correo, { nombre, clave, propia: true, confirmado: false });
          return 'creada' as const;
        }
        if (f.propia && !f.confirmado) {
          f.clave = clave;
          f.nombre = nombre;
          return 'reabierta' as const;
        }
        return 'existe' as const;
      },
      borrarSinConfirmar: async (correo: string) => {
        const f = filas.get(correo);
        if (f?.propia && !f.confirmado) filas.delete(correo);
      },
      comprobarClave: async (correo: string, clave: string) => {
        const f = filas.get(correo);
        if (!f) return 'sin_clave' as const;
        const ok = iguales(f.clave, clave);
        if (f.propia && !f.confirmado) return ok ? ('sin_confirmar' as const) : ('sin_clave' as const);
        return ok ? ('ok' as const) : ('mal' as const);
      },
      crearCodigo: async (correo: string) => {
        const previo = codigos.get(correo);
        if (previo && !previo.usado && Date.now() - previo.en < 60_000) return null;
        const codigo = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
        codigos.set(correo, { codigo, en: Date.now(), usado: false });
        return codigo;
      },
      usarCodigo: async (correo: string, codigo: string) => {
        const c = codigos.get(correo);
        if (!c || c.usado || !iguales(c.codigo, codigo)) return false;
        c.usado = true;
        filas.get(correo)!.confirmado = true;
        return true;
      },
      nombreDe: async (correo: string) => filas.get(correo)?.nombre,
    },
  };
}

type Enviado = { para: string; asunto: string; texto: string };

async function montarRegistro(o: { plataforma?: 'ultron' | 'electrum'; correo?: boolean; envioFalla?: boolean; limitarReal?: boolean; junta?: string[] } = {}) {
  const app = express();
  app.use(express.json());
  const m = almacenEnMemoria();
  const buzon: Enviado[] = [];
  const registro = montarRutasRegistro(app, {
    plataforma: o.plataforma ?? 'ultron',
    normalizarCorreo: (c) => String(c || '').trim().toLowerCase(),
    nombreYRol: (correo, nombre) => ({ nombre: nombre || correo.split('@')[0], rol: 'Miembro · Genesis ID' }),
    almacen: m.almacen,
    enviarCorreo: async (c) => {
      if (o.envioFalla) return { ok: false, detalle: 'SES 403: sin permiso' };
      buzon.push({ para: c.para, asunto: c.asunto, texto: c.texto });
      return { ok: true, detalle: 'enviado' };
    },
    correoListo: () => o.correo !== false,
    limitar: o.limitarReal ? limitar : () => pasa,
    esJunta: (c) => (o.junta || []).includes(c),
  });
  return { ...(await levantar(app)), ...m, buzon, registro };
}

const codigoDe = (texto: string) => /\b(\d{6})\b/.exec(texto)?.[1] || '';
const CLAVE = 'una frase muy larga';

/* ------------------------------------------------------------------ crear cuenta */

test('crear cuenta NO devuelve sesión: la cuenta queda sin confirmar y el código va al correo', async () => {
  const s = await montarRegistro();
  try {
    const { r, salida } = await conConsola(() => s.pedir('/api/ultron/cuentas/crear', { nombre: '  Ana   López ', correo: 'Ana.Nueva@Correo.com', clave: CLAVE }));
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.equal(r.json.token, undefined, 'ninguna sesión antes de probar el buzón');
    assert.deepEqual(r.json, { ok: true, confirmacion: 'enviado', correo: 'ana.nueva@correo.com', message: MENSAJE_ENVIADO });
    assert.deepEqual(s.filas.get('ana.nueva@correo.com'), { nombre: 'Ana López', clave: CLAVE, propia: true, confirmado: false });
    assert.equal(s.buzon.length, 1);
    assert.equal(s.buzon[0].para, 'ana.nueva@correo.com');
    assert.equal(codigoDe(s.buzon[0].texto), s.codigos.get('ana.nueva@correo.com')?.codigo);
    const lineas = salida.filter((l) => l.startsWith('[entrada]'));
    assert.equal(lineas.length, 1, salida.join('\n'));
    assert.match(lineas[0], /^\[entrada\] ruta=\/api\/ultron\/cuentas\/crear status=200 resultado=OK detalle="cuenta creada; código enviado" ms=\d+ quien=a\*\*\*@correo\.com$/);
    assert.ok(!salida.join('\n').includes('ana.nueva@correo.com') && !salida.join('\n').includes(CLAVE), 'ni el correo entero ni la clave al registro');
  } finally {
    await s.cerrar();
  }
});

test('confirmar: código malo → 401 y cuenta para el freno; clave ajena → 401 sin gastar el código; el bueno → sesión de MIEMBRO, una vez', async () => {
  const s = await montarRegistro();
  try {
    await s.pedir('/api/ultron/cuentas/crear', { nombre: 'Beto', correo: 'beto@correo.com', clave: CLAVE });
    const bueno = codigoDe(s.buzon[0].texto);
    const malo = bueno === '000000' ? '111111' : '000000';
    const m = await s.pedir('/api/ultron/cuentas/confirmar', { correo: 'beto@correo.com', clave: CLAVE, codigo: malo });
    assert.deepEqual([m.status, m.json.codigo, m.json.token], [401, 'CODIGO_INVALIDO', undefined]);
    const ajena = await s.pedir('/api/ultron/cuentas/confirmar', { correo: 'beto@correo.com', clave: 'otra frase muy larga', codigo: bueno });
    assert.deepEqual([ajena.status, ajena.json.codigo], [401, 'CODIGO_INVALIDO']);
    assert.equal(s.codigos.get('beto@correo.com')?.usado, false, 'una clave mala no gasta el código');
    assert.equal((await s.pedir('/api/ultron/cuentas/confirmar', { correo: 'beto@correo.com', clave: CLAVE, codigo: '12' })).json.codigo, 'CODIGO_FORMATO');
    const ok = await s.pedir('/api/ultron/cuentas/confirmar', { correo: 'beto@correo.com', clave: CLAVE, codigo: `${bueno.slice(0, 3)} ${bueno.slice(3)}` });
    assert.equal(ok.status, 200, JSON.stringify(ok.json));
    assert.equal(ok.json.nivel, 'miembro');
    assert.deepEqual(ok.json.miembro, { nombre: 'Beto', correo: 'beto@correo.com', rol: 'Miembro · Genesis ID', gid: '' });
    const ses = sesionDe(reqCon(ok.json.token));
    assert.ok(ses, 'la sesión vale');
    assert.equal(ses!.comunidad, true, 'marca de comunidad firmada');
    assert.equal(sesionAbreAura(ses!.correo, !!ses!.comunidad), true);
    assert.equal(s.filas.get('beto@correo.com')?.confirmado, true);
    const otra = await s.pedir('/api/ultron/cuentas/confirmar', { correo: 'beto@correo.com', clave: CLAVE, codigo: bueno });
    assert.deepEqual([otra.status, otra.json.codigo, otra.json.token], [409, 'YA_CONFIRMADO', undefined], 'confirmada, se entra con la clave');
  } finally {
    await s.cerrar();
  }
});

test('el contador de intentos: probar códigos al azar se frena (por correo); con el freno puesto ni el bueno pasa', async () => {
  const s = await montarRegistro();
  try {
    await s.pedir('/api/ultron/cuentas/crear', { nombre: 'Caro', correo: 'caro.freno@correo.com', clave: CLAVE });
    const bueno = codigoDe(s.buzon[0].texto);
    const estados: number[] = [];
    for (let i = 0; i < 7; i++) {
      const intento = String((Number(bueno) + 1 + i) % 1_000_000).padStart(6, '0');
      estados.push((await s.pedir('/api/ultron/cuentas/confirmar', { correo: 'caro.freno@correo.com', clave: CLAVE, codigo: intento })).status);
    }
    assert.deepEqual(estados.slice(0, 5), [401, 401, 401, 401, 401]);
    assert.ok(estados.slice(5).every((e) => e === 429), `el freno salta: ${estados.join(',')}`);
    const r = await s.pedir('/api/ultron/cuentas/confirmar', { correo: 'caro.freno@correo.com', clave: CLAVE, codigo: bueno });
    assert.deepEqual([r.status, r.json.token], [429, undefined]);
    assert.equal(s.codigos.get('caro.freno@correo.com')?.usado, false);
  } finally {
    await s.cerrar();
  }
});

test('reenviar: con la clave; enseguida, «espera»; sin la clave, nada; confirmada, YA_CONFIRMADO', async () => {
  const s = await montarRegistro();
  try {
    await s.pedir('/api/ultron/cuentas/crear', { nombre: 'Dora', correo: 'dora.reenvio@correo.com', clave: CLAVE });
    const espera = await s.pedir('/api/ultron/cuentas/reenviar', { correo: 'dora.reenvio@correo.com', clave: CLAVE });
    assert.deepEqual([espera.status, espera.json.codigo], [429, 'ESPERA']);
    const sinClave = await s.pedir('/api/ultron/cuentas/reenviar', { correo: 'dora.reenvio@correo.com', clave: 'no es la clave de dora' });
    assert.deepEqual([sinClave.status, sinClave.json.codigo], [401, 'NO_ENTRA']);
    s.codigos.get('dora.reenvio@correo.com')!.en = 0; // pasó el minuto
    const otro = await s.pedir('/api/ultron/cuentas/reenviar', { correo: 'dora.reenvio@correo.com', clave: CLAVE });
    assert.equal(otro.status, 200);
    assert.equal(s.buzon.length, 2);
    const nuevo = codigoDe(s.buzon[1].texto);
    assert.equal((await s.pedir('/api/ultron/cuentas/confirmar', { correo: 'dora.reenvio@correo.com', clave: CLAVE, codigo: nuevo })).status, 200);
    assert.equal((await s.pedir('/api/ultron/cuentas/reenviar', { correo: 'dora.reenvio@correo.com', clave: CLAVE })).json.codigo, 'YA_CONFIRMADO');
  } finally {
    await s.cerrar();
  }
});

test('correo nuevo, con cuenta, del padrón o de la junta: LA MISMA respuesta; al que ya tenía cuenta le llega un aviso, no un código', async () => {
  const s = await montarRegistro({ junta: ['solo.junta@ordenglobal.org'] });
  try {
    await s.pedir('/api/ultron/cuentas/crear', { nombre: 'Elsa', correo: 'elsa@correo.com', clave: CLAVE });
    const k = codigoDe(s.buzon[0].texto);
    await s.pedir('/api/ultron/cuentas/confirmar', { correo: 'elsa@correo.com', clave: CLAVE, codigo: k });
    s.buzon.length = 0;
    const respuestas = new Set<string>();
    for (const correo of ['nadie.aun@correo.com', 'elsa@correo.com', 'j.herrera@ordenglobal.org', 'solo.junta@ordenglobal.org']) {
      const r = await s.pedir('/api/ultron/cuentas/crear', { nombre: 'Alguien', correo, clave: 'otra frase cualquiera' });
      assert.equal(r.status, 200, correo);
      assert.equal(r.json.token, undefined);
      const { correo: _c, ...resto } = r.json;
      respuestas.add(JSON.stringify(resto));
    }
    assert.equal(respuestas.size, 1, 'las cuatro respuestas son la misma');
    assert.equal(s.filas.get('elsa@correo.com')?.clave, CLAVE, 'la cuenta confirmada no se tocó');
    assert.ok(!s.filas.has('j.herrera@ordenglobal.org') && !s.filas.has('solo.junta@ordenglobal.org'), 'del padrón y la junta no se crea nada');
    assert.match(s.buzon.find((b) => b.para === 'elsa@correo.com')?.asunto || '', /ya tienes una cuenta/);
    assert.ok(!s.buzon.some((b) => b.para === 'j.herrera@ordenglobal.org'), 'al padrón no se le escribe');
  } finally {
    await s.cerrar();
  }
});

test('quien registra primero el correo de otro no se queda con la cuenta: el dueño la reabre con SU clave y confirma; la del intruso no confirma', async () => {
  const s = await montarRegistro();
  try {
    await s.pedir('/api/ultron/cuentas/crear', { nombre: 'Intruso', correo: 'fabi@correo.com', clave: 'clave del intruso 1' });
    s.codigos.get('fabi@correo.com')!.en = 0;
    await s.pedir('/api/ultron/cuentas/crear', { nombre: 'Fabi', correo: 'fabi@correo.com', clave: CLAVE });
    assert.equal(s.filas.get('fabi@correo.com')?.clave, CLAVE, 'reabierta con la clave del dueño');
    const codigo = codigoDe(s.buzon[s.buzon.length - 1].texto);
    const intruso = await s.pedir('/api/ultron/cuentas/confirmar', { correo: 'fabi@correo.com', clave: 'clave del intruso 1', codigo });
    assert.equal(intruso.status, 401, 'aun con el código, la clave del intruso no confirma');
    const duena = await s.pedir('/api/ultron/cuentas/confirmar', { correo: 'fabi@correo.com', clave: CLAVE, codigo });
    assert.equal(duena.status, 200);
  } finally {
    await s.cerrar();
  }
});

test('formulario malo: cada cosa con su código y su campo; nada se crea', async () => {
  const s = await montarRegistro();
  try {
    const casos: [Record<string, string>, string][] = [
      [{ nombre: 'E', correo: 'e@correo.com', clave: CLAVE }, 'NOMBRE'],
      [{ nombre: 'Eva', correo: 'eva@correo', clave: CLAVE }, 'CORREO'],
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

test('sin correo configurado: 503 SIN_ENVIO, sin sesión y sin cuenta; el motivo queda en el registro', async () => {
  const s = await montarRegistro({ correo: false });
  try {
    const { r, salida } = await conConsola(() => s.pedir('/api/ultron/cuentas/crear', { nombre: 'Gus', correo: 'gus@correo.com', clave: CLAVE }));
    assert.deepEqual([r.status, r.json.codigo, r.json.token], [503, 'SIN_ENVIO', undefined]);
    assert.equal(r.json.error, MENSAJE_SIN_ENVIO);
    assert.match(r.json.error, /Veta Wallet u Orden Global/);
    assert.equal(s.filas.size, 0);
    assert.ok(salida.some((l) => /\[entrada\] ruta=\/api\/ultron\/cuentas\/crear status=503 resultado=SIN_ENVIO/.test(l)));
  } finally {
    await s.cerrar();
  }
});

test('el envío falla (SES): 502 CODIGO_NO_ENVIADO, sin sesión, y la cuenta recién abierta se deshace (se puede reintentar)', async () => {
  const s = await montarRegistro({ envioFalla: true });
  try {
    const { r, salida } = await conConsola(() => s.pedir('/api/ultron/cuentas/crear', { nombre: 'Hilda', correo: 'hilda@correo.com', clave: CLAVE }));
    assert.deepEqual([r.status, r.json.codigo, r.json.token], [502, 'CODIGO_NO_ENVIADO', undefined]);
    assert.equal(s.filas.has('hilda@correo.com'), false, 'se deshizo');
    assert.ok(salida.some((l) => l.includes('no salió el correo con el código')), 'el fallo de SES queda en el registro');
  } finally {
    await s.cerrar();
  }
});

test('mandarCodigo (lo que usa la puerta con una cuenta sin confirmar): sin correo no inventa nada', async () => {
  const s = await montarRegistro({ correo: false });
  try {
    const { r } = await conConsola(() => s.registro.mandarCodigo('ivan@correo.com', 'Iván'));
    assert.equal(r, 'sin_correo');
    assert.equal(s.buzon.length, 0);
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

test('Dr Electrum: «crear», «confirmar» y «reenviar» no existen allí y una sesión de comunidad no se le emite a nadie', async () => {
  const s = await montarRegistro({ plataforma: 'electrum' });
  try {
    for (const ruta of ['crear', 'confirmar', 'reenviar']) {
      const r = await s.pedir(`/api/ultron/cuentas/${ruta}`, { nombre: 'Hugo', correo: 'hugo@correo.com', clave: CLAVE, codigo: '123456' });
      assert.deepEqual([r.status, r.json.codigo, r.json.token], [404, 'SOLO_AURA', undefined], ruta);
    }
    assert.equal(s.filas.size, 0);
    assert.equal(esDeComunidad('hugo@correo.com', 'electrum'), false);
    assert.equal(esDeComunidad('hugo@correo.com', 'ultron'), true);
  } finally {
    await s.cerrar();
  }
});

test('la puerta (server.ts): sin confirmar → CORREO_SIN_CONFIRMAR sin sesión y con el código; en Dr Electrum, SIN_ACCESO', () => {
  const src = fs.readFileSync(path.join(process.cwd(), 'server.ts'), 'utf8');
  const i = src.indexOf("app.post(['/api/electrum/entrar', '/api/ultron/entrar']");
  const ruta = src.slice(i, src.indexOf('function nombreYRolDe', i));
  const sinConfirmar = ruta.slice(ruta.indexOf("if (propia === 'sin_confirmar')"), ruta.indexOf("if (propia === 'ok')"));
  assert.ok(sinConfirmar.length > 50, 'hay una rama para la cuenta sin confirmar');
  assert.doesNotMatch(sinConfirmar, /emitirSesion/, 'la rama sin confirmar NO emite sesión');
  assert.match(sinConfirmar, /codigo: 'CORREO_SIN_CONFIRMAR'/);
  assert.match(sinConfirmar, /registroCuentas\.mandarCodigo\(/, 'y manda el código');
  assert.match(sinConfirmar, /if \(ES_ELECTRUM \|\| !esDeComunidad\(correo, PLATAFORMA\)\) return res\.status\(403\)/);
  assert.match(ruta, /if \(propia === 'mal'\) \{\s*anotarFalloEntrada\(correo, ipEntrada\);\s*return res\.status\(401\)/, 'contraseña mala: 401 y cuenta para el freno');
  assert.match(ruta, /if \(!puedeEntrar\(identificar\(\{ correo \}\), PLATAFORMA\) && !esDeComunidad\(correo, PLATAFORMA\)\) \{\s*return res\.status\(403\)/, 'Dr Electrum: fuera del padrón no entra');
  assert.match(src, /montarVigilancia\(app, \['\/api\/electrum\/entrar', '\/api\/ultron\/entrar'\]\)/, 'la puerta deja su línea en el registro');
  assert.match(src, /esJunta: \(correo\) => nivelDeCorreo\(correo, PLATAFORMA\) !== 'miembro'/, 'la junta (AURA_JUNTA o padrón) no se registra');
  assert.match(src, /comprobarClave: entrarConCuenta/, 'confirmar usa la misma comprobación de clave que la puerta');
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

test('Postgres: sin confirmar NO entra con su clave (sin_confirmar); la mala no tapa al remoto; el código la confirma una vez', { skip: sinBase ? 'sin base' : false }, async () => {
  await vaciarCuentas();
  assert.equal(await cuentas.crearCuentaPropia('ines@correo.com', 'Inés', 'frase larga de ines'), 'creada');
  assert.equal(await cuentas.entrarConCuenta('ines@correo.com', 'frase larga de ines'), 'sin_confirmar', 'la clave buena no basta sin el código');
  assert.equal(await cuentas.entrarConCuenta('ines@correo.com', 'otra frase cualquiera'), 'sin_clave', 'una clave sin probar no tapa la del cerebro remoto');
  const c = await cuentas.cuentaDe('ines@correo.com');
  assert.deepEqual([c?.propia, c?.correoConfirmado, c?.tieneClave, Object.keys(c?.acceso || {}).length], [true, false, true, 0]);
  assert.equal(await cuentas.puedeRecuperar('ines@correo.com'), true, '«olvidé mi contraseña» también para estas cuentas');
  const k = await cuentas.crearCodigoCorreo('ines@correo.com');
  assert.match(String(k), /^\d{6}$/);
  assert.equal(await cuentas.crearCodigoCorreo('ines@correo.com'), null, 'reenviar enseguida no manda otro');
  assert.equal(await cuentas.usarCodigoCorreo('otra@correo.com', k!), false, 'el código es de ese correo');
  assert.equal(await cuentas.usarEnlace(k!), null, 'un código no sirve como enlace');
  assert.equal(await cuentas.usarCodigoCorreo('ines@correo.com', k!), true);
  assert.equal(await cuentas.usarCodigoCorreo('ines@correo.com', k!), false, 'una vez');
  assert.equal(await cuentas.entrarConCuenta('ines@correo.com', 'frase larga de ines'), 'ok', 'confirmada, entra con su clave');
  assert.equal(await cuentas.entrarConCuenta('ines@correo.com', 'otra frase cualquiera'), 'mal');
  // Confirmada, registrarse otra vez no la toca.
  assert.equal(await cuentas.crearCuentaPropia('ines@correo.com', 'Otra', 'otra frase cualquiera'), 'existe');
  assert.equal(await cuentas.entrarConCuenta('ines@correo.com', 'frase larga de ines'), 'ok');
  await cuentas.recargarCuentas();
  assert.equal(esDeComunidad('ines@correo.com', 'ultron'), true, 'sigue siendo miembro');
});

test('Postgres: reabrir sin confirmar pone la clave nueva; deshacer solo borra las sin confirmar; Genesis reclama', { skip: sinBase ? 'sin base' : false }, async () => {
  await vaciarCuentas();
  await cuentas.crearCuentaPropia('juan@correo.com', 'Intruso', 'clave del intruso 1');
  assert.equal(await cuentas.crearCuentaPropia('juan@correo.com', 'Juan', 'clave de juan 1234'), 'reabierta');
  assert.equal(await cuentas.entrarConCuenta('juan@correo.com', 'clave de juan 1234'), 'sin_confirmar');
  assert.equal(await cuentas.entrarConCuenta('juan@correo.com', 'clave del intruso 1'), 'sin_clave', 'la del intruso ya no es la de la cuenta');
  assert.equal(await cuentas.reclamarCuentaSinConfirmar('juan@correo.com'), true);
  assert.equal(await cuentas.entrarConCuenta('juan@correo.com', 'clave de juan 1234'), 'sin_clave', 'Genesis probó al dueño: ninguna clave puesta sin probar sigue');
  assert.equal(await cuentas.borrarCuentaSinConfirmar('juan@correo.com'), false, 'confirmada (por Genesis): no se borra');
  await cuentas.crearCuentaPropia('karla@correo.com', 'Karla', 'clave de karla 123');
  assert.equal(await cuentas.borrarCuentaSinConfirmar('karla@correo.com'), true);
  assert.equal(await cuentas.cuentaDe('karla@correo.com'), null);
  await cuentas.asegurarCuentaMiembro('lia@correo.com', 'Lía', 'GEN-LIA1-LIA2-L');
  assert.equal(await cuentas.crearCuentaPropia('lia@correo.com', 'Otra', 'otra frase cualquiera'), 'existe', 'un miembro de Genesis no se reabre');
  assert.equal(await cuentas.borrarCuentaSinConfirmar('lia@correo.com'), false);
  await cuentas._cerrarCuentas();
});
