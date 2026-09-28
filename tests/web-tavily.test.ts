/**
 * Tavily sin clave y con clave: qué cabecera manda, que se aparta diez minutos si le ponen límite,
 * y que Extract solo recibe dominios públicos.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { buscarWeb, extraerConTavily, leerPagina, markdownATexto, reiniciarTavily } from '../src/06-manos/web';

type Pedido = { url: string; init: any };
function simular(responder: (p: Pedido) => Response | Promise<Response>) {
  const pedidos: Pedido[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (url: any, init: any) => {
    const p = { url: String(url), init };
    pedidos.push(p);
    return responder(p);
  }) as typeof fetch;
  return { pedidos, restaurar: () => (globalThis.fetch = original) };
}
const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } });
const deTavily = (ps: Pedido[]) => ps.filter((p) => p.url.startsWith('https://api.tavily.com'));

test('sin clave: modo sin llave; con clave: Bearer', async (t) => {
  const antes = process.env.TAVILY_API_KEY;
  t.after(() => (antes === undefined ? delete process.env.TAVILY_API_KEY : (process.env.TAVILY_API_KEY = antes)));
  reiniciarTavily();
  const s = simular((p) =>
    p.url.startsWith('https://api.tavily.com/search')
      ? json({ results: [{ title: 'Depósitos epitermales de baja sulfuración', url: 'https://ejemplo.org/epitermal', content: 'epitermal baja sulfuración oro plata' }] })
      : new Response('', { status: 503 })
  );
  try {
    delete process.env.TAVILY_API_KEY;
    const hits = await buscarWeb('epitermal baja sulfuración', 3);
    const sin = deTavily(s.pedidos)[0];
    assert.equal(sin.init.headers['X-Tavily-Access-Mode'], 'keyless');
    assert.equal(sin.init.headers.Authorization, undefined);
    assert.ok(hits.some((h) => h.url === 'https://ejemplo.org/epitermal'), JSON.stringify(hits));

    s.pedidos.length = 0;
    process.env.TAVILY_API_KEY = 'tvly-prueba';
    await buscarWeb('epitermal baja sulfuración', 3);
    const con = deTavily(s.pedidos)[0];
    assert.equal(con.init.headers.Authorization, 'Bearer tvly-prueba');
    assert.equal(con.init.headers['X-Tavily-Access-Mode'], undefined);
  } finally {
    s.restaurar();
  }
});

test('límite (429): Tavily descansa y los demás siguen', async () => {
  delete process.env.TAVILY_API_KEY;
  reiniciarTavily();
  const s = simular((p) => (p.url.startsWith('https://api.tavily.com') ? json({ detail: 'rate limit' }, 429) : new Response('', { status: 503 })));
  try {
    await buscarWeb('precio del oro', 3);
    assert.equal(deTavily(s.pedidos).length, 1);
    await buscarWeb('precio del oro', 3);
    assert.equal(deTavily(s.pedidos).length, 1, 'no se vuelve a pedir durante la pausa');
  } finally {
    s.restaurar();
    reiniciarTavily();
  }
});

test('Extract: solo dominios públicos, y el markdown sale como texto', async () => {
  delete process.env.TAVILY_API_KEY;
  reiniciarTavily();
  const s = simular(() => json({ results: [{ url: 'x', raw_content: '# Título\n| a | b |\n| --- | --- |\n[SciELO](https://scielo.org) texto **útil** ![img](a.png)' }] }));
  try {
    for (const u of ['http://127.0.0.1/x', 'http://10.0.0.5/', 'http://localhost:7811/', 'http://servidor.internal/x', 'file:///etc/passwd', 'http://[::1]/']) {
      assert.equal(await extraerConTavily(u, 500), '', u);
    }
    assert.equal(s.pedidos.length, 0, 'nada privado sale a Tavily');
    const t = await extraerConTavily('https://www.scielo.org.ar/articulo', 500);
    assert.equal(t, 'Título a b SciELO texto útil');
    assert.equal(s.pedidos.length, 1);
  } finally {
    s.restaurar();
  }
  assert.equal(markdownATexto('[a](b) y [c](d)'), 'a y c');
  assert.equal(markdownATexto('SciELO --- --- vol.28 | :---: |'), 'SciELO vol.28');
});

test('leerPagina: lo que la red pública rechaza no se reintenta con Tavily', async () => {
  reiniciarTavily();
  const s = simular(() => json({ results: [{ raw_content: 'no debería leerse' }] }));
  try {
    assert.equal(await leerPagina('http://localhost:7811/api/secreto', 500), '');
    assert.equal(await leerPagina('http://169.254.169.254/latest/meta-data/', 500), '');
    assert.equal(deTavily(s.pedidos).length, 0);
  } finally {
    s.restaurar();
  }
});
