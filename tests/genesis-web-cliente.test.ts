/**
 * IOS01 (auditoría del 3-oct): el lado web de «Entrar con Genesis ID» (src/10-infra/genesisWeb.ts), con un
 * servidor de mentira que lleva el mismo depósito que el de verdad (server/sso-web.ts).
 *
 * Lo que tiene que ser verdad:
 *   · el reto es la huella SHA-256 (base64url) del verificador, igual que en el teléfono;
 *   · la wallet recibe reto, estado y la vuelta https exacta; el verificador nunca sale del navegador
 *     salvo para recoger (y ni el verificador ni ningún token van en una URL);
 *   · mientras la wallet no vuelve: pendiente; al volver: la sesión, una vez; un error de la wallet se
 *     explica y se olvida el pedido; un pedido vencido no se intenta.
 */
import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { _olvidarIntentosWeb, depositarVuelta, recogerVuelta, registrarIntentoWeb } from '../server/sso-web';

const m = new Map<string, string>();
Object.assign(globalThis, { localStorage: { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) } });
const G = await import('../src/10-infra/genesisWeb');

/** El servidor de mentira: las tres rutas, con el depósito de verdad. Anota cada URL pedida. */
const urls: string[] = [];
const cuerpos: any[] = [];
const servidor = (async (url: any, init: any = {}) => {
  urls.push(String(url));
  const b = init.body ? JSON.parse(init.body) : {};
  cuerpos.push(b);
  const json = (status: number, cuerpo: unknown) => new Response(JSON.stringify(cuerpo), { status, headers: { 'Content-Type': 'application/json' } });
  if (url === '/api/genesis/config') return json(200, { disponible: true, walletWeb: 'https://app.vetawallet.com/#sso-aura' });
  if (url === '/api/genesis/web/intento') return registrarIntentoWeb(b.estado, b.reto) ? json(200, { ok: true }) : json(400, { ok: false });
  if (url === '/api/genesis/web/recoger') {
    const r = recogerVuelta(b.estado, b.verificador);
    if (r.estado === 'pendiente') return json(202, { estado: 'pendiente' });
    if (r.estado === 'desconocido') return json(410, { codigo: 'VENCIDO', error: 'venció' });
    if (r.estado === 'reto') return json(403, { codigo: 'RETO', error: 'otro' });
    if (r.estado === 'error') return json(400, { estado: 'error', codigo: r.error });
    return json(200, { ok: true, token: 'sesion-de-' + r.pase, miembro: { nombre: 'Ana', correo: 'ana@x.hn' } });
  }
  return json(404, {});
}) as typeof fetch;

beforeEach(() => {
  m.clear();
  urls.length = 0;
  cuerpos.length = 0;
  _olvidarIntentosWeb();
});

test('pedido: el reto es la huella del verificador (como el teléfono) y todo va en base64url', async () => {
  const p = await G.nuevoPedido();
  assert.match(p.verificador, /^[A-Za-z0-9_-]{43}$/);
  assert.match(p.estado, /^[A-Za-z0-9_-]{24}$/);
  assert.equal(p.reto, createHash('sha256').update(p.verificador).digest('base64url'));
  assert.equal(G.urlWallet('https://w.test/#sso-aura', 'R', 'E'), `https://w.test/#sso-aura?reto=R&estado=E&vuelta=${encodeURIComponent('https://aura-fp.onrender.com/sso')}`);
});

test('de punta a punta: iniciar → (wallet) → pendiente → vuelta depositada → sesión, una sola vez', async () => {
  const i = await G.iniciarEntradaGenesis(servidor);
  assert.ok(i.ok);
  const ir = new URL((i as any).ir.replace('#sso-aura?', '?'));
  const estado = ir.searchParams.get('estado')!;
  assert.equal(ir.searchParams.get('vuelta'), 'https://aura-fp.onrender.com/sso');
  const verificador = JSON.parse(m.get('aura.genesis.web')!).verificador;
  assert.ok(!(i as any).ir.includes(verificador), 'el verificador no viaja a la wallet');
  assert.equal(G.hayEntradaPendiente(), true);

  assert.deepEqual(await G.retomarEntradaGenesis(servidor), { tipo: 'pendiente' });
  depositarVuelta({ estado, pase: 'PASE1' });
  const r = await G.retomarEntradaGenesis(servidor);
  assert.deepEqual(r, { tipo: 'listo', token: 'sesion-de-PASE1', miembro: { nombre: 'Ana', correo: 'ana@x.hn' } });
  assert.equal(G.hayEntradaPendiente(), false, 'el pedido se olvida al terminar');
  assert.deepEqual(await G.retomarEntradaGenesis(servidor), { tipo: 'nada' });
  assert.ok(urls.every((u) => !u.includes(verificador) && !u.includes('sesion-de-')), 'ni verificador ni token en una URL');
});

test('la wallet canceló: se explica y se olvida el pedido', async () => {
  const i = await G.iniciarEntradaGenesis(servidor);
  const estado = new URL((i as any).ir.replace('#sso-aura?', '?')).searchParams.get('estado')!;
  depositarVuelta({ estado, error: 'cancelado' });
  const r = await G.retomarEntradaGenesis(servidor);
  assert.equal(r.tipo, 'error');
  assert.match((r as any).mensaje, /Cancelaste/);
  assert.equal(G.hayEntradaPendiente(), false);
});

test('un pedido vencido no se intenta; sin red, sigue pendiente', async () => {
  m.set('aura.genesis.web', JSON.stringify({ verificador: 'v'.repeat(43), estado: 'e'.repeat(24), en: Date.now() - G.VIDA_PEDIDO_MS - 1 }));
  assert.deepEqual(await G.retomarEntradaGenesis(servidor), { tipo: 'nada' });
  assert.equal(urls.length, 0);
  m.set('aura.genesis.web', JSON.stringify({ verificador: 'v'.repeat(43), estado: 'e'.repeat(24), en: Date.now() }));
  const sinRed = (async () => {
    throw new TypeError('Failed to fetch');
  }) as unknown as typeof fetch;
  assert.deepEqual(await G.retomarEntradaGenesis(sinRed), { tipo: 'pendiente' });
  assert.equal(G.hayEntradaPendiente(), true);
});
