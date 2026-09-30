/**
 * El TLS de las bases se verifica (lib/ssl-base.ts; auditoría A30).
 *
 * Se prueba la configuración EFECTIVA del driver (pg/lib/connection-parameters, lo que de verdad usa
 * pg), no solo el objeto declarado: antes el código declaraba `rejectUnauthorized: false` y pg la
 * pisaba con lo que leía de la URL. Y se prueba contra un servidor TLS de mentira que un certificado
 * que no es de la CA de confianza se rechaza.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import tls from 'node:tls';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { configTls } from '../lib/ssl-base';

const require = createRequire(import.meta.url);
const ConnectionParameters = require('pg/lib/connection-parameters.js');
/** Lo que pg usará de verdad con esta configuración. */
const efectivo = (c: object) => new ConnectionParameters(c).ssl;

test('sslmode=require: verificado, y es lo que usa el driver (no lo pisa la URL)', () => {
  const c = configTls('postgres://u:p@base.ejemplo:5432/db?sslmode=require');
  assert.equal(c.connectionString.includes('sslmode'), false, 'pg no vuelve a leer sslmode de la URL');
  assert.equal(c.ssl?.rejectUnauthorized, true);
  const e = efectivo(c);
  assert.ok(e && e.rejectUnauthorized !== false, JSON.stringify(e));
});

test('sin sslmode (o disable): sin TLS, como antes; la URL no se toca', () => {
  const url = 'postgres://electrum:clave@127.0.0.1:5432/electrum_pruebas';
  assert.deepEqual(configTls(url), { connectionString: url, ssl: undefined });
  assert.equal(efectivo(configTls(url)), false);
  assert.equal(configTls(`${url}?sslmode=disable`).ssl, undefined);
});

test('CA propia por BASE_SSL_CA (PEM) o sslrootcert: verificado contra ESA CA', () => {
  const pem = '-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----\n';
  const c = configTls('postgres://u:p@h/db?sslmode=verify-full', { BASE_SSL_CA: pem } as NodeJS.ProcessEnv);
  assert.equal(c.ssl?.ca, pem);
  assert.equal(c.ssl?.rejectUnauthorized, true);
  const archivo = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ca-')), 'ca.pem');
  fs.writeFileSync(archivo, pem);
  const d = configTls(`postgres://u:p@h/db?sslmode=require&sslrootcert=${encodeURIComponent(archivo)}`, {} as NodeJS.ProcessEnv);
  assert.equal(d.ssl?.ca, pem);
  assert.equal(d.connectionString.includes('sslrootcert'), false);
});

test('no-verify solo si la URL lo pide a propósito (desarrollo)', () => {
  assert.equal(configTls('postgres://u:p@h/db?sslmode=no-verify', {} as NodeJS.ProcessEnv).ssl?.rejectUnauthorized, false);
});

test('un servidor con certificado que no es de la CA de confianza se rechaza', async (t) => {
  let hayOpenssl = true;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tls-'));
  try {
    execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', path.join(dir, 'k.pem'), '-out', path.join(dir, 'c.pem'), '-days', '1', '-subj', '/CN=impostor.local'], { stdio: 'ignore' });
  } catch {
    hayOpenssl = false;
  }
  if (!hayOpenssl) return t.skip('sin openssl para fabricar el certificado');
  const srv = tls.createServer({ key: fs.readFileSync(path.join(dir, 'k.pem')), cert: fs.readFileSync(path.join(dir, 'c.pem')) }, (s) => s.end());
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
  const port = (srv.address() as any).port;
  const { ssl } = configTls(`postgres://u:p@127.0.0.1:${port}/db?sslmode=require`);
  const intento = await new Promise<string>((r) => {
    const s = tls.connect({ host: '127.0.0.1', port, servername: 'localhost', ...(ssl as tls.ConnectionOptions) }, () => r('aceptado'));
    s.on('error', (e: any) => r(String(e?.code || e?.message)));
  });
  assert.notEqual(intento, 'aceptado', 'con verificación, el impostor no pasa');
  // La configuración de antes (rejectUnauthorized: false) lo habría aceptado.
  const antes = await new Promise<string>((r) => {
    const s = tls.connect({ host: '127.0.0.1', port, rejectUnauthorized: false }, () => {
      s.end();
      r('aceptado');
    });
    s.on('error', (e: any) => r(String(e?.code || e?.message)));
  });
  srv.close();
  assert.equal(antes, 'aceptado');
});
