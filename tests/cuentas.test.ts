/**
 * Cuentas propias: olvidé mi contraseña, cambiarla, pedir acceso y que José lo apruebe.
 *
 * Contra Postgres de verdad (ELECTRUM_DB_URL; vacía el esquema `cuentas`) y con las rutas montadas en
 * un Express real. El correo NO sale: se intercepta la llamada a SES y se lee lo que se habría
 * mandado, que es justo lo que importa (a quién, y a qué dirección apunta el enlace).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import type { AddressInfo } from 'node:net';

process.env.CUENTAS_DB_URL = process.env.CUENTAS_DB_URL || process.env.ELECTRUM_DB_URL || '';
process.env.AWS_ACCESS_KEY_ID = 'AKIAPRUEBA000000000';
process.env.AWS_SECRET_ACCESS_KEY = 'secreto-de-prueba';
process.env.ULTRON_SESION_SECRETO = process.env.ULTRON_SESION_SECRETO || 'secreto-de-sesion-para-pruebas-largo-1234';
delete process.env.CUENTAS_APROBADOR;
delete process.env.CUENTAS_ORIGEN;
delete process.env.PUBLIC_BASE;

const { montarRutasCuentas, origenPublico } = await import('../server/cuentas-rutas');
const cuentas = await import('../server/cuentas');
const { emitirSesion, sesionDe } = await import('../server/seguridad');
const { identificar, nivelDe, reiniciarPadron } = await import('../lib/acceso');
const { peticionSes, correoValido } = await import('../lib/correo-ses');
const { rutaPermitida } = await import('../lib/plataforma');

type Enviado = { para: string; asunto: string; texto: string; html?: string };
const buzon: Enviado[] = [];
const fetchReal = globalThis.fetch;
globalThis.fetch = (async (url: any, init?: any) => {
  const u = String(url);
  if (u.startsWith('https://email.')) {
    const b = JSON.parse(init.body);
    assert.match(init.headers.authorization, /^AWS4-HMAC-SHA256 Credential=AKIAPRUEBA000000000\/\d{8}\/us-east-1\/ses\/aws4_request, SignedHeaders=content-type;host;x-amz-date, Signature=[0-9a-f]{64}$/);
    buzon.push({ para: b.Destination.ToAddresses[0], asunto: b.Content.Simple.Subject.Data, texto: b.Content.Simple.Body.Text.Data, html: b.Content.Simple.Body.Html?.Data });
    return new Response(JSON.stringify({ MessageId: `m-${buzon.length}` }), { status: 200 });
  }
  return fetchReal(url, init);
}) as typeof fetch;

const sinBase = !cuentas.cuentasDisponibles();

async function levantar(plataforma: 'electrum' | 'ultron') {
  const app = express();
  app.use(express.json());
  montarRutasCuentas(app, {
    plataforma,
    // Como MAIL_ALIASES: un correo personal que es el mismo que uno de la casa.
    normalizarCorreo: (c) => {
      const x = String(c || '').trim().toLowerCase();
      return x === 'ana.personal@gmail.com' ? 'ana@mina.hn' : x;
    },
    nombreYRol: (correo, n) => ({ nombre: n || correo.split('@')[0], rol: 'Prueba' }),
    // El cerebro remoto de mentira: la clave de siempre de José es «remota-de-siempre».
    claveRemotaAbre: async (correo, clave) => correo === 'j.ordonez@ordenglobal.org' && clave === 'remota-de-siempre',
  });
  const srv = app.listen(0);
  await new Promise((r) => srv.once('listening', r));
  const base = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
  const pedir = async (ruta: string, cuerpo?: unknown, token?: string, host?: string) => {
    const r = await fetch(base + ruta, {
      method: cuerpo === undefined ? 'GET' : 'POST',
      headers: { 'content-type': 'application/json', ...(token ? { 'x-ultron-sesion': token } : {}), ...(host ? { host } : {}) },
      body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
    });
    return { status: r.status, json: (await r.json().catch(() => ({}))) as any };
  };
  return { srv, pedir };
}

const tokenDelEnlace = (texto: string, param: string) => new RegExp(`[?&]${param}=([A-Za-z0-9_-]+)`).exec(texto)?.[1] || '';
const reqCon = (token: string) => ({ headers: { 'x-ultron-sesion': token } }) as any;

test('SES: la petición va firmada con SigV4 al servicio ses y lleva texto y HTML', () => {
  const p = peticionSes({ para: 'a@b.org', asunto: 'Hola', texto: 'uno', html: '<p>uno</p>' }, new Date('2026-09-27T12:00:00Z'));
  assert.equal(p.url, 'https://email.us-east-1.amazonaws.com/v2/email/outbound-emails');
  assert.equal(p.headers['x-amz-date'], '20260927T120000Z');
  assert.match(p.headers.authorization, /Credential=AKIAPRUEBA000000000\/20260927\/us-east-1\/ses\/aws4_request/);
  const b = JSON.parse(p.cuerpo);
  assert.equal(b.FromEmailAddress, 'Orden Global <no-responder@ordenglobal.org>');
  assert.equal(b.Content.Simple.Body.Html.Data, '<p>uno</p>');
  assert.ok(correoValido('j.ordonez@ordenglobal.org'));
  assert.ok(!correoValido('sin arroba'));
  assert.ok(!correoValido('a@b'));
});

test('las rutas de cuentas existen también en Dr Electrum', () => {
  for (const r of ['/api/ultron/clave/olvide', '/api/ultron/clave/restablecer', '/api/ultron/clave/cambiar', '/api/ultron/cuentas/solicitar', '/api/ultron/cuentas/solicitudes/3'])
    assert.ok(rutaPermitida(r), r);
});

test('claves: scrypt, nunca en claro, y reglas mínimas', async () => {
  const h = await cuentas.cifrarClave('una clave larga 2026');
  assert.match(h, /^scrypt\$16384\$8\$1\$/);
  assert.ok(!h.includes('una clave larga'));
  assert.ok(await cuentas.claveCoincide('una clave larga 2026', h));
  assert.ok(!(await cuentas.claveCoincide('otra clave larga 2026', h)));
  assert.ok(cuentas.problemaDeClave('corta'));
  assert.ok(cuentas.problemaDeClave('1234567890'));
  assert.ok(cuentas.problemaDeClave('aaaaaaaaaaaa'));
  assert.ok(cuentas.problemaDeClave('xx-jordonez-2026', 'jordonez@ordenglobal.org'));
  assert.equal(cuentas.problemaDeClave('Montaña verde 2026', 'j.ordonez@ordenglobal.org'), null);
});

test('olvidé mi contraseña → enlace por correo → clave nueva; las sesiones viejas se cierran', { skip: sinBase ? 'sin base' : false }, async () => {
  await cuentas.recargarCuentas();
  const { srv, pedir } = await levantar('electrum');
  try {
    // Limpio lo de pruebas anteriores.
    const pg = new (await import('pg')).Pool({ connectionString: cuentas.urlCuentas() });
    await pg.query('TRUNCATE cuentas.cuenta, cuentas.enlace, cuentas.solicitud RESTART IDENTITY');
    await pg.end();
    await cuentas.recargarCuentas();
    buzon.length = 0;

    // Un correo que no está en el padrón: la misma respuesta, y no sale nada.
    const nadie = await pedir('/api/ultron/clave/olvide', { correo: 'nadie@ejemplo.com' });
    assert.equal(nadie.status, 200);
    assert.equal(buzon.length, 0);
    // Parecido a José pero de otro dominio: tampoco.
    await pedir('/api/ultron/clave/olvide', { correo: 'j.ordonez@gmail.com' });
    assert.equal(buzon.length, 0);

    const vieja = emitirSesion({ correo: 'j.ordonez@ordenglobal.org', nombre: 'José', rol: 'Junta' });
    assert.ok(sesionDe(reqCon(vieja.token)));

    // José, con una cabecera Host tramposa: el enlace apunta igual a la dirección pública.
    const r = await pedir('/api/ultron/clave/olvide', { correo: 'j.ordonez@ordenglobal.org' }, undefined, 'sitio-malo.com');
    assert.equal(r.status, 200);
    assert.equal(r.json.message, nadie.json.message);
    assert.equal(buzon.length, 1);
    assert.equal(buzon[0].para, 'j.ordonez@ordenglobal.org');
    assert.ok(buzon[0].texto.includes(`${origenPublico('electrum')}/?restablecer=`), buzon[0].texto);
    assert.ok(!buzon[0].texto.includes('sitio-malo'));
    const token = tokenDelEnlace(buzon[0].texto, 'restablecer');
    assert.ok(token.length >= 40);

    // Pedirlo de nuevo enseguida no manda otro (no sirve para inundar un buzón).
    await pedir('/api/ultron/clave/olvide', { correo: 'j.ordonez@ordenglobal.org' });
    assert.equal(buzon.length, 1);

    assert.equal((await pedir(`/api/ultron/clave/enlace?token=${token}`)).json.tipo, 'restablecer');
    // Una clave débil no gasta el enlace.
    const debil = await pedir('/api/ultron/clave/restablecer', { token, clave: 'corta' });
    assert.equal(debil.status, 400);
    const bien = await pedir('/api/ultron/clave/restablecer', { token, clave: 'Montaña verde 2026' });
    assert.equal(bien.status, 200, JSON.stringify(bien.json));
    assert.ok(bien.json.token);
    // El enlace ya no sirve.
    assert.equal((await pedir('/api/ultron/clave/restablecer', { token, clave: 'Otra montaña 2027' })).status, 410);

    assert.equal(await cuentas.entrarConCuenta('j.ordonez@ordenglobal.org', 'Montaña verde 2026'), 'ok');
    assert.equal(await cuentas.entrarConCuenta('j.ordonez@ordenglobal.org', 'remota-de-siempre'), 'mal');
    // La sesión abierta antes del cambio ya no vale; la nueva sí.
    assert.equal(sesionDe(reqCon(vieja.token)), null);
    assert.ok(sesionDe(reqCon(bien.json.token)));
    // Y se le avisó del cambio.
    assert.ok(buzon.some((m) => /tu contraseña cambió/.test(m.asunto)));
  } finally {
    srv.close();
  }
});

test('cambiar la contraseña sabiendo la actual (también la del cerebro remoto)', { skip: sinBase ? 'sin base' : false }, async () => {
  const { srv, pedir } = await levantar('ultron');
  try {
    const pg = new (await import('pg')).Pool({ connectionString: cuentas.urlCuentas() });
    await pg.query('TRUNCATE cuentas.cuenta, cuentas.enlace, cuentas.solicitud RESTART IDENTITY');
    await pg.end();
    await cuentas.recargarCuentas();
    const s = emitirSesion({ correo: 'j.ordonez@ordenglobal.org', nombre: 'José', rol: 'Junta' });
    assert.equal((await pedir('/api/ultron/clave/cambiar', { actual: 'x', nueva: 'Nueva clave 2026!' })).status, 401, 'sin sesión');
    const mal = await pedir('/api/ultron/clave/cambiar', { actual: 'no-es', nueva: 'Nueva clave 2026!' }, s.token);
    assert.equal(mal.status, 401);
    const ok = await pedir('/api/ultron/clave/cambiar', { actual: 'remota-de-siempre', nueva: 'Nueva clave 2026!' }, s.token);
    assert.equal(ok.status, 200, JSON.stringify(ok.json));
    assert.equal(sesionDe(reqCon(s.token)), null, 'la sesión vieja se cierra');
    assert.ok(sesionDe(reqCon(ok.json.token)), 'la que hizo el cambio sigue, renovada');
    // Ahora manda la clave propia: la actual es la nueva.
    const otra = await pedir('/api/ultron/clave/cambiar', { actual: 'Nueva clave 2026!', nueva: 'Tercera clave 2026' }, ok.json.token);
    assert.equal(otra.status, 200, JSON.stringify(otra.json));
  } finally {
    srv.close();
  }
});

test('dos pedidos de enlace a la vez dejan un solo enlace vivo', { skip: sinBase ? 'sin base' : false }, async () => {
  const pg = new (await import('pg')).Pool({ connectionString: cuentas.urlCuentas() });
  try {
    await pg.query(`DELETE FROM cuentas.enlace WHERE correo = 'carrera@ordenglobal.org'`);
    const tokens = await Promise.all(Array.from({ length: 6 }, () => cuentas.crearEnlace('carrera@ordenglobal.org', 'restablecer', 30, 0)));
    assert.equal(tokens.filter(Boolean).length, 6);
    const { rows } = await pg.query(`SELECT count(*)::int AS n FROM cuentas.enlace WHERE correo = 'carrera@ordenglobal.org' AND usado IS NULL`);
    assert.equal(rows[0].n, 1);
    // Con la espera de reenvío, a la vez: sale uno solo.
    await pg.query(`DELETE FROM cuentas.enlace WHERE correo = 'carrera@ordenglobal.org'`);
    const conEspera = await Promise.all(Array.from({ length: 6 }, () => cuentas.crearEnlace('carrera@ordenglobal.org', 'restablecer', 30)));
    assert.equal(conEspera.filter(Boolean).length, 1);
  } finally {
    await pg.end();
  }
});

test('pedir acceso → José aprueba con nivel → la persona crea su clave y entra al padrón', { skip: sinBase ? 'sin base' : false }, async () => {
  const { srv, pedir } = await levantar('electrum');
  try {
    const pg = new (await import('pg')).Pool({ connectionString: cuentas.urlCuentas() });
    await pg.query('TRUNCATE cuentas.cuenta, cuentas.enlace, cuentas.solicitud RESTART IDENTITY');
    await pg.end();
    await cuentas.recargarCuentas();
    reiniciarPadron();
    buzon.length = 0;

    assert.equal((await pedir('/api/ultron/cuentas/solicitar', { nombre: 'Ana', correo: 'ana@mina.hn', motivo: 'x' })).status, 400, 'motivo corto');
    // Con su alias personal: se guarda bajo el correo con el que después va a entrar.
    const r = await pedir('/api/ultron/cuentas/solicitar', { nombre: 'Ana Pérez', correo: 'Ana.Personal@gmail.com', motivo: 'Ingeniera de campo de la concesión' });
    assert.equal(r.status, 200);
    const alAprobador = buzon.find((m) => m.para === 'j.ordonez@ordenglobal.org');
    assert.ok(alAprobador, 'el aviso le llega a José');
    assert.ok(alAprobador!.texto.includes('Ana Pérez') && alAprobador!.texto.includes(`${origenPublico('electrum')}/?solicitudes=1`));
    assert.ok(buzon.some((m) => m.para === 'ana@mina.hn' && /recibimos/.test(m.asunto)));
    // La misma solicitud otra vez no duplica ni vuelve a avisar.
    const antes = buzon.length;
    await pedir('/api/ultron/cuentas/solicitar', { nombre: 'Ana Pérez', correo: 'ana@mina.hn', motivo: 'Ingeniera de campo de la concesión' });
    assert.equal(buzon.length, antes);
    // Alguien que se hace pasar por José desde otro dominio.
    await pedir('/api/ultron/cuentas/solicitar', { nombre: 'José Falso', correo: 'j.ordonez@gmail.com', motivo: 'Quiero entrar a todo' });

    // Solo el aprobador ve y decide.
    const medardo = emitirSesion({ correo: 'm.ordonez@ordenglobal.org', nombre: 'Medardo', rol: 'Junta' });
    assert.equal((await pedir('/api/ultron/cuentas/solicitudes', undefined, medardo.token)).status, 403);
    assert.equal((await pedir('/api/ultron/cuentas/solicitudes')).status, 401);
    const jose = emitirSesion({ correo: 'j.ordonez@ordenglobal.org', nombre: 'José', rol: 'Junta' });
    const lista = await pedir('/api/ultron/cuentas/solicitudes', undefined, jose.token);
    assert.equal(lista.status, 200);
    assert.equal(lista.json.pendientes, 2);
    const ana = lista.json.solicitudes.find((s: any) => s.correo === 'ana@mina.hn');
    const falso = lista.json.solicitudes.find((s: any) => s.correo === 'j.ordonez@gmail.com');

    assert.equal((await pedir(`/api/ultron/cuentas/solicitudes/${ana.id}`, { decision: 'aprobar' }, jose.token)).status, 400, 'sin nivel');
    buzon.length = 0;
    const ap = await pedir(`/api/ultron/cuentas/solicitudes/${ana.id}`, { decision: 'aprobar', nivel: 'escribe' }, jose.token);
    assert.equal(ap.status, 200, JSON.stringify(ap.json));
    assert.equal((await pedir(`/api/ultron/cuentas/solicitudes/${ana.id}`, { decision: 'rechazar' }, jose.token)).status, 409, 'ya decidida');
    const correoAna = buzon.find((m) => m.para === 'ana@mina.hn');
    assert.ok(correoAna && /Trabajo/.test(correoAna.texto));
    const activar = tokenDelEnlace(correoAna!.texto, 'activar');
    assert.ok(activar);

    // Ya está en el padrón con el nivel elegido, solo en Dr Electrum.
    const quien = identificar({ correo: 'ana@mina.hn' });
    assert.equal(nivelDe(quien, 'electrum'), 'escribe');
    assert.equal(nivelDe(quien, 'ultron'), null);
    // Hasta crear su clave no entra; con el enlace, sí.
    assert.equal(await cuentas.entrarConCuenta('ana@mina.hn', 'lo que sea largo'), 'sin_clave');
    assert.equal((await pedir('/api/ultron/clave/restablecer', { token: activar, clave: 'Mi clave de campo 1' })).status, 200);
    assert.equal(await cuentas.entrarConCuenta('ana@mina.hn', 'Mi clave de campo 1'), 'ok');

    // Ana es solo de Dr Electrum: un enlace de clave usado en AU-RA guarda la clave pero NO abre sesión.
    const aura = await levantar('ultron');
    try {
      const t = await cuentas.crearEnlace('ana@mina.hn', 'restablecer', 30, 0);
      const r2 = await aura.pedir('/api/ultron/clave/restablecer', { token: t, clave: 'Otra clave de campo 2' });
      assert.equal(r2.status, 200);
      assert.equal(r2.json.token, null);
    } finally {
      aura.srv.close();
    }

    // Aunque José aprobara por error al falso, NO pasa por José: otro dominio no es la misma persona.
    await pedir(`/api/ultron/cuentas/solicitudes/${falso.id}`, { decision: 'aprobar', nivel: 'lee' }, jose.token);
    const f = identificar({ correo: 'j.ordonez@gmail.com' });
    assert.notEqual(f?.persona.id, 'jose');
    assert.equal(nivelDe(f, 'electrum'), 'lee');
  } finally {
    srv.close();
    await cuentas._cerrarCuentas();
  }
});

test('códigos temporales: únicos, 1/5/24 h, abren Dr Electrum y al vencer o revocarse sacan a quien los usa', { skip: sinBase ? 'sin base' : false }, async () => {
  const { srv, pedir } = await levantar('electrum');
  const aura = await levantar('ultron');
  try {
    const pg = new (await import('pg')).Pool({ connectionString: cuentas.urlCuentas() });
    await pg.query('TRUNCATE cuentas.codigo RESTART IDENTITY');
    reiniciarPadron();
    const jose = emitirSesion({ correo: 'j.ordonez@ordenglobal.org', nombre: 'José', rol: 'Junta' });
    const medardo = emitirSesion({ correo: 'm.ordonez@ordenglobal.org', nombre: 'Medardo', rol: 'Junta' });

    assert.equal(cuentas.normalizarCodigo('de 7kq4 m9xp-2hrt'), 'DE-7KQ4-M9XP-2HRT');
    assert.equal(cuentas.normalizarCodigo('DE-7KQ4-M9XP-2HR0'), null, 'el 0 no está en el alfabeto');
    assert.equal((await pedir('/api/ultron/codigos', { horas: 1 }, medardo.token)).status, 403, 'solo el aprobador');
    assert.equal((await pedir('/api/ultron/codigos', { horas: 2 }, jose.token)).status, 400, 'solo 1, 5 o 24');
    assert.equal((await aura.pedir('/api/ultron/codigos', { horas: 1 }, jose.token)).status, 404, 'en AU-RA no hay códigos');
    // Sin el nombre de la persona no se crea: es con el que Dr Electrum la saluda.
    const sinNombre = await pedir('/api/ultron/codigos', { horas: 1, para: '   ' }, jose.token);
    assert.equal(sinNombre.status, 400);
    assert.match(sinNombre.json.error, /nombre de la persona/);

    // Nunca el mismo: 30 seguidos, todos distintos.
    const hechos = new Set<string>();
    for (let i = 0; i < 30; i++) hechos.add((await cuentas.crearCodigo({ horas: 1, plataforma: 'electrum', nivel: 'lee', para: '', por: 'prueba' })).codigo);
    assert.equal(hechos.size, 30);

    const c = await pedir('/api/ultron/codigos', { horas: 5, para: 'Ing. Prueba', nivel: 'mando' }, jose.token);
    assert.equal(c.status, 200, JSON.stringify(c.json));
    assert.match(c.json.codigo, /^DE-[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    assert.equal(c.json.nivel, 'lee', 'mando no se da por código: queda en consulta');
    const horas = (new Date(c.json.vence).getTime() - Date.now()) / 3600_000;
    assert.ok(horas > 4.9 && horas <= 5, `vence en ${horas} h`);
    // En la base no está el código: solo su huella y los últimos 4.
    const { rows } = await pg.query(`SELECT * FROM cuentas.codigo WHERE id = $1`, [c.json.id]);
    assert.ok(!JSON.stringify(rows[0]).includes(c.json.codigo));
    assert.equal(rows[0].pista, c.json.codigo.slice(-4));

    // Entrar: sesión que vence con el código, y acceso de consulta a Dr Electrum.
    assert.equal((await pedir('/api/ultron/entrar-codigo', { codigo: 'DE-AAAA-BBBB-CCCC' })).status, 401);
    const e = await pedir('/api/ultron/entrar-codigo', { codigo: c.json.codigo.toLowerCase().replace(/-/g, ' ') });
    assert.equal(e.status, 200, JSON.stringify(e.json));
    const s = sesionDe(reqCon(e.json.token));
    assert.ok(s);
    assert.equal(s!.nombre, 'Ing. Prueba', 'la sesión lleva el nombre que se puso al crear el código');
    assert.ok(Math.abs((s!.exp || 0) - new Date(c.json.vence).getTime()) < 2000, 'la sesión vence con el código');
    assert.equal(nivelDe(identificar({ correo: s!.correo }), 'electrum'), 'lee');
    assert.equal(nivelDe(identificar({ correo: s!.correo }), 'ultron'), null);

    // Revocar: fuera al instante, y el código ya no abre.
    assert.equal((await pedir(`/api/ultron/codigos/${c.json.id}/revocar`, {}, jose.token)).status, 200);
    assert.equal(sesionDe(reqCon(e.json.token)), null, 'la sesión abierta con el código quedó cortada');
    assert.equal(nivelDe(identificar({ correo: s!.correo }), 'electrum'), null, 'y salió del padrón');
    assert.equal((await pedir('/api/ultron/entrar-codigo', { codigo: c.json.codigo })).status, 401);

    // Vencer: igual que revocar, aunque nadie toque nada.
    const v = await pedir('/api/ultron/codigos', { horas: 1, para: 'Keidy' }, jose.token);
    const ev = await pedir('/api/ultron/entrar-codigo', { codigo: v.json.codigo });
    assert.ok(sesionDe(reqCon(ev.json.token)));
    await pg.query(`UPDATE cuentas.codigo SET vence = now() - interval '1 second' WHERE id = $1`, [v.json.id]);
    await cuentas.recargarCuentas();
    assert.equal(sesionDe(reqCon(ev.json.token)), null, 'vencido: fuera');
    assert.equal((await pedir('/api/ultron/entrar-codigo', { codigo: v.json.codigo })).status, 401);

    // Y la sesión vence sola a su hora aunque no se recargue nada.
    const corta = emitirSesion({ correo: 'x@temporal.drelectrum', nombre: 'X', rol: 'r' }, { vence: Date.now() + 150 });
    assert.ok(sesionDe(reqCon(corta.token)));
    await new Promise((r) => setTimeout(r, 250));
    assert.equal(sesionDe(reqCon(corta.token)), null);

    const lista = await pedir('/api/ultron/codigos', undefined, jose.token);
    assert.ok(lista.json.codigos.some((k: any) => k.id === c.json.id && k.estado === 'revocado'));
    assert.ok(lista.json.codigos.every((k: any) => !('codigo' in k) && !('huella' in k)), 'la lista no trae códigos ni huellas');
    await pg.end();
  } finally {
    srv.close();
    aura.srv.close();
  }
});
