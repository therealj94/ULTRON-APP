/**
 * `web_leer` no puede usarse para entrar a la red interna: ni con IPv6 que esconden una IPv4, ni
 * con un DNS que cambia de respuesta entre la comprobación y la conexión.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import dns from 'node:dns';
import { ipPrivada, pedirPublico } from '../lib/red-publica';
import { urlPublica } from '../server/seguridad';

test('las direcciones internas, en todas sus formas', () => {
  for (const ip of ['127.0.0.1', '10.1.2.3', '172.20.0.1', '192.168.1.1', '169.254.169.254', '0.0.0.0', '100.64.0.1', '::1', '::', '::ffff:127.0.0.1', '::ffff:7f00:1', '::ffff:a9fe:a9fe', '::7f00:1', 'fd00::1', 'fe80::1', '64:ff9b::7f00:1', 'no-es-ip']) {
    assert.equal(ipPrivada(ip), true, ip);
  }
  for (const ip of ['8.8.8.8', '1.1.1.1', '2606:4700::1111', '::ffff:808:808', '64:ff9b::808:808']) assert.equal(ipPrivada(ip), false, ip);
});

test('urlPublica ya no deja pasar la IPv6 mapeada en hexadecimal', async () => {
  // `new URL` reescribe [::ffff:127.0.0.1] como [::ffff:7f00:1]: la forma que antes se escapaba.
  for (const u of ['http://[::ffff:127.0.0.1]:8790/', 'http://[::ffff:7f00:1]/', 'http://[::ffff:a9fe:a9fe]/latest/meta-data']) {
    assert.equal((await urlPublica(u)).ok, false, u);
  }
});

test('se conecta a la IP que se comprobó: un DNS que contesta privada se corta al conectar', async () => {
  const original = dns.lookup;
  (dns as any).lookup = (host: string, opts: any, cb: any) => {
    if (host === 'rebote.prueba') return cb(null, [{ address: '127.0.0.1', family: 4 }]);
    return (original as any)(host, opts, cb);
  };
  try {
    await assert.rejects(pedirPublico('http://rebote.prueba/', { ms: 2000 }), /red privada/);
    await assert.rejects(pedirPublico('http://127.0.0.1:9/', { ms: 2000 }), /privado/);
    await assert.rejects(pedirPublico('http://[::ffff:7f00:1]/', { ms: 2000 }), /privado/);
    await assert.rejects(pedirPublico('file:///etc/passwd'), /http/);
  } finally {
    (dns as any).lookup = original;
  }
});
