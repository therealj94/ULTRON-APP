/**
 * COM02 (auditoría del 3-oct): las cuentas de correo guardadas (lib/correo/cuentas.ts), con un S3 de mentira.
 *
 * Lo que tiene que ser verdad:
 *   · «no tiene cuentas» (S3 404) y «no pude leer» (S3 caído) son cosas distintas (`leerCuentasSeguro`);
 *   · guardar devuelve un recibo: durable solo si S3 confirmó la escritura;
 *   · si S3 no confirmó, NO se anuncia la cuenta: ni en memoria, ni en disco, ni tras reiniciar; y la
 *     configuración previa sigue intacta (se lanza CuentasNoGuardadas, que la ruta ya contesta con 503);
 *   · quitar con S3 sin confirmar tampoco se da por hecho;
 *   · con la lectura fallida, ninguna mutación pisa lo guardado (bloqueo de siempre).
 */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'correo-recibo-'));
process.env.ULTRON_CORREO_DIR = dir;
process.env.CORREO_CLAVE_CIFRADO ||= 'clave-de-prueba-para-cifrar-correos-0123456789';
after(() => fs.rmSync(dir, { recursive: true, force: true }));

const C = await import('../lib/correo/cuentas');
const { fuenteCorreo } = await import('../lib/triaje');

const PROV = { nombre: 'X', imap: { host: 'imap.x', puerto: 993, seguro: true }, smtp: { host: 'smtp.x', puerto: 465, seguro: true }, auth: 'clave', usuario: 'correo', guardaEnviados: false } as any;

/** Un S3 de mentira: guarda lo que se le sube; `lee`/`escribe` deciden si contesta bien. */
async function conS3(f: (s3: { objetos: Map<string, string>; lee: { ok: boolean }; escribe: { ok: boolean }; puts: () => number }) => Promise<void>) {
  const original = globalThis.fetch;
  const objetos = new Map<string, string>();
  const lee = { ok: true };
  const escribe = { ok: true };
  let puts = 0;
  globalThis.fetch = (async (url: any, init: any = {}) => {
    const u = new URL(String(url));
    if (!u.hostname.endsWith('.amazonaws.com')) return original(url, init);
    const clave = decodeURIComponent(u.pathname);
    if (init.method === 'PUT') {
      puts++;
      if (!escribe.ok) return new Response('fuera', { status: 503 });
      objetos.set(clave, Buffer.from(init.body).toString('utf8'));
      return new Response('', { status: 200 });
    }
    if (!lee.ok) return new Response('fuera', { status: 503 });
    const v = objetos.get(clave);
    return v === undefined ? new Response('no', { status: 404 }) : new Response(v, { status: 200 });
  }) as typeof fetch;
  const antes = { b: process.env.ULTRON_MEMORIA_BUCKET, a: process.env.AWS_ACCESS_KEY_ID, s: process.env.AWS_SECRET_ACCESS_KEY };
  Object.assign(process.env, { ULTRON_MEMORIA_BUCKET: 'cubo-prueba', AWS_ACCESS_KEY_ID: 'AKIAPRUEBA', AWS_SECRET_ACCESS_KEY: 'secreto-prueba' });
  try {
    await f({ objetos, lee, escribe, puts: () => puts });
  } finally {
    globalThis.fetch = original;
    Object.assign(process.env, { ULTRON_MEMORIA_BUCKET: antes.b || '', AWS_ACCESS_KEY_ID: antes.a || '', AWS_SECRET_ACCESS_KEY: antes.s || '' });
  }
}

/** «Reiniciar el servidor»: sin caché y sin el disco local (Render arranca con disco nuevo). */
function reiniciar() {
  C._olvidarCuentas();
  for (const f of fs.readdirSync(dir)) fs.rmSync(path.join(dir, f), { force: true });
}

test('leer: «no tiene cuentas» (404) no es lo mismo que «no pude leer» (S3 caído)', async () => {
  await conS3(async (s3) => {
    reiniciar();
    assert.deepEqual(await C.leerCuentasSeguro('nadie@x.hn'), { ok: true, cuentas: [] });
    reiniciar();
    s3.lee.ok = false;
    assert.deepEqual(await C.leerCuentasSeguro('nadie@x.hn'), { ok: false }, 'S3 caído no es lista vacía');
    // La función de siempre sigue sin lanzar (la usan rutas que no esperan un error), pero no cachea el fallo.
    assert.deepEqual(await C.cuentasDe('nadie@x.hn'), []);
    s3.lee.ok = true;
    assert.deepEqual(await C.leerCuentasSeguro('nadie@x.hn'), { ok: true, cuentas: [] }, 'al volver S3 se vuelve a preguntar');
  });
});

test('guardar: con S3 que confirma, recibo durable y la cuenta queda', async () => {
  await conS3(async () => {
    reiniciar();
    const r = await C.agregarCuentaConRecibo('ana@x.hn', 'ana@gmail.com', PROV, 'clave-1');
    assert.equal(r.durable, true);
    assert.equal(r.cuenta.correo, 'ana@gmail.com');
    assert.ok(!('durable' in r.cuenta), 'el recibo no se mete en la cuenta guardada');
    reiniciar();
    const l = await C.leerCuentasSeguro('ana@x.hn');
    assert.ok(l.ok && l.cuentas.length === 1 && l.cuentas[0].correo === 'ana@gmail.com', 'tras reiniciar sigue (salió de S3)');
  });
});

test('guardar: si S3 no confirma la escritura, NO se anuncia la cuenta y la configuración previa sigue', async () => {
  await conS3(async (s3) => {
    reiniciar();
    await C.agregarCuenta('beto@x.hn', 'beto@gmail.com', PROV, 'clave-vieja');
    s3.escribe.ok = false;
    await assert.rejects(
      () => C.agregarCuentaConRecibo('beto@x.hn', 'beto@outlook.com', PROV, 'clave-nueva'),
      (e: unknown) => e instanceof C.CuentasNoGuardadas && e instanceof C.CuentasNoDisponibles,
      'la ruta lo contesta con 503 (noGuardado) sin cambiar server/correo.ts'
    );
    const ahora = await C.leerCuentasSeguro('beto@x.hn');
    assert.ok(ahora.ok);
    assert.deepEqual(ahora.cuentas.map((c) => c.correo), ['beto@gmail.com'], 'en memoria no quedó la que no se guardó');
    // Reinicio con el disco de este mismo proceso: tampoco aparece desde ahí.
    C._olvidarCuentas();
    assert.deepEqual((await C.cuentasDe('beto@x.hn')).map((c) => c.correo), ['beto@gmail.com'], 'ni en disco');
    // Reinicio de verdad (disco nuevo): lo de S3, que es lo de antes.
    reiniciar();
    assert.deepEqual((await C.cuentasDe('beto@x.hn')).map((c) => c.correo), ['beto@gmail.com'], 'tras reiniciar, la configuración previa');
    // La cuenta vieja se puede seguir abriendo (su secreto no se tocó).
    assert.equal(C.descifrar((await C.cuentasDe('beto@x.hn'))[0].secreto), 'clave-vieja');
    // agregarCuenta (la de siempre, la que usa la ruta) también lanza en vez de dar por guardado.
    await assert.rejects(() => C.agregarCuenta('beto@x.hn', 'beto@yahoo.com', PROV, 'x'), (e: unknown) => e instanceof C.CuentasNoDisponibles);
  });
});

test('quitar: si S3 no confirma, la cuenta sigue ahí (no se dice «quitada»)', async () => {
  await conS3(async (s3) => {
    reiniciar();
    const c = await C.agregarCuenta('cata@x.hn', 'cata@gmail.com', PROV, 'k');
    s3.escribe.ok = false;
    await assert.rejects(() => C.quitarCuenta('cata@x.hn', c.id), (e: unknown) => e instanceof C.CuentasNoGuardadas);
    assert.equal((await C.cuentasDe('cata@x.hn')).length, 1);
    s3.escribe.ok = true;
    assert.equal(await C.quitarCuenta('cata@x.hn', c.id), true);
    reiniciar();
    assert.equal((await C.cuentasDe('cata@x.hn')).length, 0);
  });
});

test('lectura fallida: ninguna mutación escribe encima (bloqueo de siempre)', async () => {
  await conS3(async (s3) => {
    reiniciar();
    await C.agregarCuenta('dani@x.hn', 'dani@gmail.com', PROV, 'k');
    reiniciar();
    s3.lee.ok = false;
    const antes = s3.puts();
    await assert.rejects(() => C.agregarCuentaConRecibo('dani@x.hn', 'otra@gmail.com', PROV, 'k'), (e: unknown) => e instanceof C.CuentasNoDisponibles && !(e instanceof C.CuentasNoGuardadas));
    assert.equal(s3.puts(), antes, 'no se subió nada encima de lo que no se pudo leer');
  });
});

test('sin S3: se guarda en disco y el recibo dice durable solo si el disco está declarado persistente', async () => {
  reiniciar();
  const r = await C.agregarCuentaConRecibo('eva@x.hn', 'eva@gmail.com', PROV, 'k');
  assert.equal(r.durable, false);
  process.env.PERFIL_DISCO_DURABLE = '1';
  try {
    assert.equal((await C.agregarCuentaConRecibo('eva@x.hn', 'eva@gmail.com', PROV, 'k')).durable, true);
  } finally {
    delete process.env.PERFIL_DISCO_DURABLE;
  }
});

test('triaje: si no se pudieron leer sus cuentas no dice «no tiene ningún correo conectado»', async () => {
  await conS3(async (s3) => {
    reiniciar();
    s3.lee.ok = false;
    await assert.rejects(() => fuenteCorreo('fede@x.hn'), (e: any) => !/no tiene ningún correo/.test(String(e?.message)) && /no pude leer/i.test(String(e?.message)));
  });
});

test('la ruta GET /api/correo/cuentas contesta 503 si no pudo leer (no una lista vacía)', async () => {
  const express = (await import('express')).default;
  const { montarRutasCorreo } = await import('../server/correo');
  const app = express();
  app.use(express.json());
  const pasa = (_q: any, _r: any, n: any) => n();
  montarRutasCorreo(app, { exigirMesa: pasa, limitar: () => pasa, sesionDe: () => ({ correo: 'ruta@x.hn' }) } as any);
  const srv = app.listen(0);
  const base = `http://127.0.0.1:${(srv.address() as any).port}`;
  try {
    await conS3(async (s3) => {
      reiniciar();
      s3.lee.ok = false;
      const r = await fetch(`${base}/api/correo/cuentas`);
      assert.equal(r.status, 503, 'S3 caído no es «no tienes cuentas»');
      assert.equal((await r.json()).code, 'cuentas_no_disponibles');
      s3.lee.ok = true;
      reiniciar();
      const ok = await fetch(`${base}/api/correo/cuentas`);
      assert.equal(ok.status, 200);
      assert.deepEqual((await ok.json()).cuentas, [], 'sin cuentas de verdad: lista vacía');
    });
  } finally {
    srv.close();
  }
});
