/**
 * CONFIRMAR EL CORREO, ATADO A LA CLAVE QUE SE COMPROBÓ (auditoría externa SEC01, P1).
 *
 * Antes, POST /api/ultron/cuentas/confirmar comprobaba la clave y DESPUÉS gastaba el código, en dos pasos sueltos, y
 * gastar el código confirmaba «el correo», no la clave comprobada. Entre los dos pasos, /cuentas/crear podía cambiar
 * la clave de la cuenta todavía sin confirmar: quedaba confirmada una clave distinta de la que se comprobó.
 *
 * Lo que tiene que ser verdad:
 *   · si /crear cambia la clave pendiente entre la comprobación y la confirmación, NO se confirma ninguna de las dos
 *     claves y no hay sesión;
 *   · el código va atado a la revisión de la clave con que se emitió: /crear (re)escribe la clave → los códigos
 *     vivos dejan de servir y sale uno nuevo;
 *   · gastar el código y confirmar la cuenta es UNA escritura (una transacción con la fila de la cuenta tomada): dos
 *     confirmaciones a la vez con el mismo código → solo una; si algo falla en medio, el código no se quema;
 *   · código vencido o invalidado → sin sesión; el correo que no sale → sin sesión; ninguna transacción abierta
 *     mientras sale el correo.
 *
 * Casi todo contra Postgres de verdad (ELECTRUM_DB_URL de pruebas, como el CI); la de la ruta sola, en memoria.
 */
import './datos-prueba'; // la junta inventada de las pruebas (lo real vive en Render)
import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import type { AddressInfo } from 'node:net';

process.env.CUENTAS_DB_URL = process.env.CUENTAS_DB_URL || process.env.ELECTRUM_DB_URL || '';
process.env.ULTRON_SESION_SECRETO = process.env.ULTRON_SESION_SECRETO || 'secreto-de-sesion-para-pruebas-largo-1234';

const { montarRutasRegistro } = await import('../server/registro-cuentas');
const cuentas = await import('../server/cuentas');
const { exigirBaseDePrueba } = await import('../lib/base-de-pruebas');

const sinBase = !cuentas.cuentasDisponibles();
const conBase = { skip: sinBase ? 'sin base' : false };

const P1 = 'la primera frase larga';
const P2 = 'la segunda frase larga';
const pasa: express.RequestHandler = (_q, _s, n) => n();
const codigoDe = (texto: string) => /\b(\d{6})\b/.exec(texto)?.[1] || '';

/* ------------------------------------------------------------------ utilidades */

let poolPrueba: import('pg').Pool | null = null;
/** Conexión directa para preparar, mirar y trabar filas: pasa por la misma barrera que el módulo (trunca tablas). */
async function directa() {
  if (!poolPrueba) {
    exigirBaseDePrueba(cuentas.urlCuentas());
    poolPrueba = new (await import('pg')).Pool({ connectionString: cuentas.urlCuentas(), max: 4 });
  }
  return poolPrueba;
}

async function vaciar() {
  await cuentas.cuentaDe('nadie@nadie.co'); // asegura el esquema (y la columna nueva)
  await (await directa()).query('TRUNCATE cuentas.cuenta, cuentas.enlace');
}

/** Espera hasta que alguna conexión de la base esté esperando un candado (la barrera determinista). */
async function hastaQueEspereCandado(topeMs = 5000) {
  const fin = Date.now() + topeMs;
  while (Date.now() < fin) {
    const { rows } = await (await directa()).query(`SELECT count(*)::int AS n FROM pg_stat_activity WHERE wait_event_type = 'Lock' AND datname = current_database()`);
    if (rows[0].n > 0) return;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error('nadie llegó a esperar el candado');
}

async function estadoCuenta(correo: string) {
  const c = await cuentas.cuentaDe(correo);
  return {
    confirmada: !!c?.correoConfirmado,
    p1: await cuentas.entrarConCuenta(correo, P1),
    p2: await cuentas.entrarConCuenta(correo, P2),
  };
}

type Enviado = { para: string; asunto: string; texto: string };

/** Las rutas de verdad con el almacén de verdad, cableado como server.ts. */
async function montar(o: { envioFalla?: boolean; antesDeEnviar?: () => Promise<void>; trasComprobar?: (correo: string) => Promise<void> } = {}) {
  const app = express();
  app.use(express.json());
  const buzon: Enviado[] = [];
  montarRutasRegistro(app, {
    plataforma: 'ultron',
    normalizarCorreo: (c) => String(c || '').trim().toLowerCase(),
    nombreYRol: (correo, nombre) => ({ nombre: nombre || correo.split('@')[0], rol: 'Miembro · Genesis ID' }),
    enviarCorreo: async (c) => {
      await o.antesDeEnviar?.();
      if (o.envioFalla) return { ok: false, detalle: 'SES 403: sin permiso' };
      buzon.push({ para: c.para, asunto: c.asunto, texto: c.texto });
      return { ok: true, detalle: 'enviado' };
    },
    correoListo: () => true,
    limitar: () => pasa,
    esJunta: () => false,
    almacen: {
      disponible: cuentas.cuentasDisponibles,
      crearCuenta: cuentas.crearCuentaPropia,
      borrarSinConfirmar: cuentas.borrarCuentaSinConfirmar,
      // La barrera: justo después de que la ruta comprobó la clave y antes de gastar el código.
      comprobarClave: async (correo, clave) => {
        const r = await cuentas.entrarConCuenta(correo, clave);
        await o.trasComprobar?.(correo);
        return r;
      },
      crearCodigo: (correo) => cuentas.crearCodigoCorreo(correo),
      usarCodigo: cuentas.usarCodigoCorreo,
      nombreDe: async (correo) => (await cuentas.cuentaDe(correo))?.nombre || undefined,
    },
  });
  const srv = app.listen(0);
  await new Promise((r) => srv.once('listening', r));
  const base = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
  const pedir = async (ruta: string, cuerpo: unknown) => {
    const r = await fetch(base + ruta, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(cuerpo) });
    return { status: r.status, json: (await r.json().catch(() => ({}))) as any };
  };
  return { pedir, buzon, cerrar: () => new Promise((r) => srv.close(r)) };
}

/* ------------------------------------------------------------------ la ruta, en memoria */

test('la ruta ata la confirmación a la clave que comprobó: se la pasa a usarCodigo', async () => {
  const llamadas: unknown[][] = [];
  const app = express();
  app.use(express.json());
  montarRutasRegistro(app, {
    plataforma: 'ultron',
    normalizarCorreo: (c) => String(c || '').trim().toLowerCase(),
    nombreYRol: (correo, nombre) => ({ nombre: nombre || correo, rol: 'Miembro' }),
    enviarCorreo: async () => ({ ok: true, detalle: 'enviado' }),
    correoListo: () => true,
    limitar: () => pasa,
    almacen: {
      disponible: () => true,
      crearCuenta: async () => 'creada' as const,
      borrarSinConfirmar: async () => {},
      comprobarClave: async () => 'sin_confirmar' as const,
      crearCodigo: async () => '123456',
      usarCodigo: async (...a: unknown[]) => {
        llamadas.push(a);
        return false; // la base dice que la clave comprobada ya no es la de la cuenta
      },
    },
  });
  const srv = app.listen(0);
  await new Promise((r) => srv.once('listening', r));
  try {
    const r = await fetch(`http://127.0.0.1:${(srv.address() as AddressInfo).port}/api/ultron/cuentas/confirmar`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ correo: 'ruta@correo.com', clave: P1, codigo: '123456' }),
    });
    const j: any = await r.json();
    assert.deepEqual([r.status, j.codigo, j.token], [401, 'CODIGO_INVALIDO', undefined]);
    assert.deepEqual(llamadas, [['ruta@correo.com', '123456', P1]], 'usarCodigo recibe la clave comprobada');
  } finally {
    await new Promise((r) => srv.close(r));
  }
});

/* ------------------------------------------------------------------ contra Postgres */

test('barrera: /crear cambia la clave pendiente entre la comprobación y la confirmación → no se confirma ninguna, sin sesión', conBase, async () => {
  await vaciar();
  let barrera: ((correo: string) => Promise<void>) | undefined;
  const s = await montar({ trasComprobar: (c) => barrera?.(c) ?? Promise.resolve() });
  try {
    const correo = 'barrera@correo.com';
    assert.equal((await s.pedir('/api/ultron/cuentas/crear', { nombre: 'Ana', correo, clave: P1 })).status, 200);
    const c1 = codigoDe(s.buzon[0].texto);
    // Mientras la confirmación con P1 está entre «clave comprobada» y «código gastado», /crear pone P2.
    barrera = async () => {
      barrera = undefined;
      const r = await s.pedir('/api/ultron/cuentas/crear', { nombre: 'Otro', correo, clave: P2 });
      assert.equal(r.status, 200);
    };
    const r = await s.pedir('/api/ultron/cuentas/confirmar', { correo, clave: P1, codigo: c1 });
    assert.deepEqual([r.status, r.json.token], [401, undefined], JSON.stringify(r.json));
    assert.deepEqual(await estadoCuenta(correo), { confirmada: false, p1: 'sin_clave', p2: 'sin_confirmar' }, 'ni P1 ni P2 quedaron confirmadas');
    // El código de antes quedó invalidado; el de la clave nueva solo sirve con la clave nueva.
    const c2 = codigoDe(s.buzon[s.buzon.length - 1].texto);
    assert.notEqual(c2, c1);
    assert.equal((await s.pedir('/api/ultron/cuentas/confirmar', { correo, clave: P1, codigo: c2 })).status, 401);
    const ok = await s.pedir('/api/ultron/cuentas/confirmar', { correo, clave: P2, codigo: c2 });
    assert.equal(ok.status, 200, JSON.stringify(ok.json));
    assert.ok(ok.json.token);
    assert.deepEqual(await estadoCuenta(correo), { confirmada: true, p1: 'mal', p2: 'ok' });
  } finally {
    await s.cerrar();
  }
});

test('barrera dentro de usarCodigoCorreo: la clave cambia después del scrypt y antes de confirmar → no confirma ni gasta el código', conBase, async () => {
  await vaciar();
  const correo = 'candado@correo.com';
  await cuentas.crearCuentaPropia(correo, 'Bea', P1);
  const k = (await cuentas.crearCodigoCorreo(correo, 30, 0))!;
  // Una transacción ajena (como /crear o «olvidé mi contraseña») cambia la clave y tiene la fila tomada.
  const ajena = await (await directa()).connect();
  try {
    await ajena.query('BEGIN');
    await ajena.query('UPDATE cuentas.cuenta SET clave_hash = $2 WHERE correo = $1', [correo, await cuentas.cifrarClave(P2)]);
    const confirmando = cuentas.usarCodigoCorreo(correo, k, P1);
    await hastaQueEspereCandado(); // la confirmación ya comprobó P1 y espera la fila
    await ajena.query('COMMIT');
    assert.equal(await confirmando, false, 'la clave comprobada ya no es la de la cuenta');
  } finally {
    ajena.release();
  }
  assert.deepEqual(await estadoCuenta(correo), { confirmada: false, p1: 'sin_clave', p2: 'sin_confirmar' });
  const { rows } = await (await directa()).query(`SELECT count(*)::int AS n FROM cuentas.enlace WHERE correo = $1 AND usado IS NOT NULL`, [correo]);
  assert.equal(rows[0].n, 0, 'el código no se gastó');
});

test('la clave comprobada vieja con un código emitido para la clave nueva tampoco confirma', conBase, async () => {
  await vaciar();
  const correo = 'vieja@correo.com';
  await cuentas.crearCuentaPropia(correo, 'Caro', P1);
  assert.equal(await cuentas.entrarConCuenta(correo, P1), 'sin_confirmar');
  await cuentas.crearCuentaPropia(correo, 'Otro', P2);
  const k2 = (await cuentas.crearCodigoCorreo(correo, 30, 0))!;
  assert.equal(await cuentas.usarCodigoCorreo(correo, k2, P1), false);
  assert.deepEqual(await estadoCuenta(correo), { confirmada: false, p1: 'sin_clave', p2: 'sin_confirmar' });
  assert.equal(await cuentas.usarCodigoCorreo(correo, k2, P2), true);
});

test('dos confirmaciones a la vez con el mismo código: solo una (función y ruta)', conBase, async () => {
  await vaciar();
  await cuentas.crearCuentaPropia('doble@correo.com', 'Dani', P1);
  const k = (await cuentas.crearCodigoCorreo('doble@correo.com', 30, 0))!;
  const r = await Promise.all([cuentas.usarCodigoCorreo('doble@correo.com', k, P1), cuentas.usarCodigoCorreo('doble@correo.com', k, P1)]);
  assert.deepEqual(r.sort(), [false, true]);

  const s = await montar();
  try {
    const correo = 'doble.ruta@correo.com';
    await s.pedir('/api/ultron/cuentas/crear', { nombre: 'Eli', correo, clave: P1 });
    const c = codigoDe(s.buzon[0].texto);
    const dos = await Promise.all([1, 2].map(() => s.pedir('/api/ultron/cuentas/confirmar', { correo, clave: P1, codigo: c })));
    assert.equal(dos.filter((x) => x.status === 200).length, 1, JSON.stringify(dos));
    assert.equal(dos.filter((x) => x.json.token).length, 1, 'una sola sesión');
  } finally {
    await s.cerrar();
  }
});

test('código vencido, reemplazado o invalidado por /crear → sin sesión ni confirmación', conBase, async () => {
  await vaciar();
  const s = await montar();
  try {
    const correo = 'vencido@correo.com';
    await s.pedir('/api/ultron/cuentas/crear', { nombre: 'Fede', correo, clave: P1 });
    const c1 = codigoDe(s.buzon[0].texto);
    await (await directa()).query(`UPDATE cuentas.enlace SET vence = now() - interval '1 minute' WHERE correo = $1`, [correo]);
    const v = await s.pedir('/api/ultron/cuentas/confirmar', { correo, clave: P1, codigo: c1 });
    assert.deepEqual([v.status, v.json.token], [401, undefined]);
    assert.equal((await estadoCuenta(correo)).confirmada, false);

    // Un código nuevo deja sin valor al anterior.
    const k1 = (await cuentas.crearCodigoCorreo(correo, 30, 0))!;
    const k2 = (await cuentas.crearCodigoCorreo(correo, 30, 0))!;
    if (k1 !== k2) assert.equal((await s.pedir('/api/ultron/cuentas/confirmar', { correo, clave: P1, codigo: k1 })).status, 401);

    // Registrarse otra vez (aun con la misma clave) reescribe la credencial: el código vivo deja de servir y sale otro.
    const antes = s.buzon.length;
    assert.equal((await s.pedir('/api/ultron/cuentas/crear', { nombre: 'Fede', correo, clave: P1 })).status, 200);
    assert.equal(s.buzon.length, antes + 1, 'salió un código nuevo enseguida');
    const c3 = codigoDe(s.buzon[s.buzon.length - 1].texto);
    if (c3 !== k2) {
      const r = await s.pedir('/api/ultron/cuentas/confirmar', { correo, clave: P1, codigo: k2 });
      assert.deepEqual([r.status, r.json.token], [401, undefined], 'el código de la credencial anterior ya no vale');
    }
    assert.equal((await estadoCuenta(correo)).confirmada, false);
    assert.equal((await s.pedir('/api/ultron/cuentas/confirmar', { correo, clave: P1, codigo: c3 })).status, 200);
  } finally {
    await s.cerrar();
  }
});

test('falla entre gastar el código y confirmar → el código no se quema y la cuenta no queda a medias; se puede reintentar', conBase, async () => {
  await vaciar();
  const db = await directa();
  // Un disparador de prueba hace fallar la escritura que confirma la cuenta mientras exista la marca.
  await db.query(`CREATE TABLE IF NOT EXISTS public.prueba_falla_confirmar (x int)`);
  await db.query(`CREATE OR REPLACE FUNCTION public.prueba_falla_confirmar() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF EXISTS (SELECT 1 FROM public.prueba_falla_confirmar) THEN RAISE EXCEPTION 'falla inyectada al confirmar'; END IF;
      RETURN NEW;
    END $$`);
  await db.query(`DROP TRIGGER IF EXISTS prueba_falla_confirmar ON cuentas.cuenta`);
  await db.query(`CREATE TRIGGER prueba_falla_confirmar BEFORE UPDATE ON cuentas.cuenta FOR EACH ROW
    WHEN (OLD.correo_confirmado IS NULL AND NEW.correo_confirmado IS NOT NULL) EXECUTE FUNCTION public.prueba_falla_confirmar()`);
  try {
    const correo = 'falla@correo.com';
    await cuentas.crearCuentaPropia(correo, 'Gabi', P1);
    const k = (await cuentas.crearCodigoCorreo(correo, 30, 0))!;
    await db.query(`INSERT INTO public.prueba_falla_confirmar VALUES (1)`);
    await assert.rejects(() => cuentas.usarCodigoCorreo(correo, k, P1), /falla inyectada/);
    assert.equal((await estadoCuenta(correo)).confirmada, false, 'sin confirmar');
    const { rows } = await db.query(`SELECT count(*)::int AS n FROM cuentas.enlace WHERE correo = $1 AND usado IS NULL`, [correo]);
    assert.equal(rows[0].n, 1, 'el código sigue vivo');
    await db.query(`DELETE FROM public.prueba_falla_confirmar`);
    assert.equal(await cuentas.usarCodigoCorreo(correo, k, P1), true, 'reintentar con el mismo código funciona');
    assert.deepEqual(await estadoCuenta(correo), { confirmada: true, p1: 'ok', p2: 'mal' });
  } finally {
    await db.query(`DROP TRIGGER IF EXISTS prueba_falla_confirmar ON cuentas.cuenta`);
    await db.query(`DROP FUNCTION IF EXISTS public.prueba_falla_confirmar()`);
    await db.query(`DROP TABLE IF EXISTS public.prueba_falla_confirmar`);
  }
});

test('el correo no sale → sin sesión (crear, reabrir y reenviar); ninguna transacción abierta mientras se envía', conBase, async () => {
  await vaciar();
  const enTransaccion: number[] = [];
  const s = await montar({
    envioFalla: true,
    antesDeEnviar: async () => {
      const { rows } = await (await directa()).query(
        `SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname = current_database() AND state LIKE 'idle in transaction%'`
      );
      enTransaccion.push(rows[0].n);
    },
  });
  try {
    const correo = 'sinenvio@correo.com';
    const r = await s.pedir('/api/ultron/cuentas/crear', { nombre: 'Hugo', correo, clave: P1 });
    assert.deepEqual([r.status, r.json.codigo, r.json.token], [502, 'CODIGO_NO_ENVIADO', undefined]);
    assert.equal(await cuentas.cuentaDe(correo), null, 'la cuenta recién abierta se deshizo');

    // Reabrir una pendiente con el correo caído: sin sesión y el código de antes ya no sirve con la clave nueva.
    await cuentas.crearCuentaPropia(correo, 'Hugo', P1);
    const viejo = (await cuentas.crearCodigoCorreo(correo, 30, 0))!;
    const re = await s.pedir('/api/ultron/cuentas/crear', { nombre: 'Hugo', correo, clave: P2 });
    assert.deepEqual([re.status, re.json.token], [502, undefined]);
    const conViejo = await s.pedir('/api/ultron/cuentas/confirmar', { correo, clave: P2, codigo: viejo });
    assert.deepEqual([conViejo.status, conViejo.json.token], [401, undefined]);

    await (await directa()).query(`UPDATE cuentas.enlace SET creado = now() - interval '5 minutes' WHERE correo = $1`, [correo]);
    const rv = await s.pedir('/api/ultron/cuentas/reenviar', { correo, clave: P2 });
    assert.deepEqual([rv.status, rv.json.codigo, rv.json.token], [502, 'CODIGO_NO_ENVIADO', undefined]);
    assert.equal((await estadoCuenta(correo)).confirmada, false);
    assert.ok(enTransaccion.length >= 3, 'se intentó enviar');
    assert.ok(enTransaccion.every((n) => n === 0), `ninguna transacción abierta durante el envío: ${enTransaccion.join(',')}`);
  } finally {
    await s.cerrar();
  }
});

test('cierre', conBase, async () => {
  await poolPrueba?.end();
  await cuentas._cerrarCuentas();
});
