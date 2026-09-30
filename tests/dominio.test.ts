/**
 * Dominio principal: el enlace de Render lleva a las personas a electrum.ordenglobal.link, pero la
 * API, el MCP y su OAuth siguen contestando donde llegan.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { redirigirADominio } from '../server/dominio';

function probar(pedido: { host: string; path: string; method?: string; accept?: string }) {
  let destino: { codigo: number; url: string } | null = null;
  let siguio = false;
  const req: any = {
    hostname: pedido.host,
    path: pedido.path.split('?')[0],
    originalUrl: pedido.path,
    method: pedido.method || 'GET',
    headers: { accept: pedido.accept ?? 'text/html,application/xhtml+xml' },
  };
  const res: any = { redirect: (codigo: number, url: string) => (destino = { codigo, url }) };
  redirigirADominio(req, res, () => (siguio = true));
  return { destino, siguio };
}

test('dominio principal: la página por Render pasa al dominio de Orden Global', () => {
  process.env.DOMINIO_PRINCIPAL = 'electrum.ordenglobal.link';
  assert.deepEqual(probar({ host: 'ultron-looi-desk.onrender.com', path: '/?x=1' }).destino, {
    codigo: 301,
    url: 'https://electrum.ordenglobal.link/?x=1',
  });
  assert.equal(probar({ host: 'electrum.ordenglobal.link', path: '/' }).siguio, true);
});

test('dominio principal: API, MCP, OAuth y peticiones sin HTML no se redirigen', () => {
  process.env.DOMINIO_PRINCIPAL = 'electrum.ordenglobal.link';
  const host = 'ultron-looi-desk.onrender.com';
  for (const path of ['/api/electrum/tablero', '/mcp', '/oauth/authorize', '/.well-known/oauth-authorization-server']) {
    assert.equal(probar({ host, path }).siguio, true, path);
  }
  assert.equal(probar({ host, path: '/', method: 'POST' }).siguio, true);
  assert.equal(probar({ host, path: '/', accept: 'application/json' }).siguio, true);
});

test('dominio principal: sin la variable no se toca nada', () => {
  delete process.env.DOMINIO_PRINCIPAL;
  assert.equal(probar({ host: 'ultron-looi-desk.onrender.com', path: '/' }).siguio, true);
});
