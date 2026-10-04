/**
 * IOS02 (auditoría del 3-oct): la PWA de AU-RA con un service worker mínimo y seguro.
 *
 * Lo que tiene que ser verdad:
 *   · el build de AU-RA emite /sw.js con la lista exacta del shell (página, su JS y CSS, iconos) y una
 *     versión que cambia con el build; el de Dr Electrum NO emite service worker;
 *   · el service worker nunca toca /api, /sso, /.well-known, otros orígenes, ni lo que lleva la sesión,
 *     ni la sala (WebView) ni la página de Electrum; no guarda respuestas no-store/privadas;
 *   · la navegación va primero a la red (siempre lo nuevo) y sin red cae al shell guardado;
 *   · la versión nueva espera hasta que la persona dice «Recargar» (mensaje `activar`), y al activarse
 *     borra los cachés viejos de AU-RA;
 *   · GET /api/pwa es el interruptor (AURA_SW=0 lo apaga) y el manifest sirve para el icono del iPhone.
 */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import express from 'express';
import type { AddressInfo } from 'node:net';
import { armarSw, listaPrecache } from '../scripts/pwa/vite-sw';

const raiz = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const plantilla = fs.readFileSync(path.join(raiz, 'scripts/pwa/sw-plantilla.js'), 'utf8');

/** Un bundle de Rollup de mentira: la entrada de index.html con un import y su CSS. */
const bundle: any = {
  'assets/index-abc.js': { type: 'chunk', isEntry: true, fileName: 'assets/index-abc.js', facadeModuleId: '/repo/index.html', imports: ['assets/vendor-123.js'], viteMetadata: { importedCss: new Set(['assets/index-def.css']) } },
  'assets/vendor-123.js': { type: 'chunk', isEntry: false, fileName: 'assets/vendor-123.js', imports: [], viteMetadata: { importedCss: new Set() } },
  'assets/sala-999.js': { type: 'chunk', isEntry: true, fileName: 'assets/sala-999.js', facadeModuleId: '/repo/sala.html', imports: [], viteMetadata: { importedCss: new Set() } },
  'assets/lazy-777.js': { type: 'chunk', isEntry: false, fileName: 'assets/lazy-777.js', imports: [], viteMetadata: { importedCss: new Set() } },
};

test('el build: lista del shell exacta (sin la sala ni lo perezoso) y versión que cambia con el build', () => {
  const l = listaPrecache(bundle)!;
  assert.deepEqual(l.filter((x) => x.startsWith('/assets/')).sort(), ['/assets/index-abc.js', '/assets/index-def.css', '/assets/vendor-123.js']);
  for (const fijo of ['/', '/manifest.webmanifest', '/icon-192.png', '/icon.png', '/apple-touch-icon.png']) assert.ok(l.includes(fijo), fijo);
  const a = armarSw(plantilla, l);
  const b = armarSw(plantilla, [...l, '/assets/otro.js']);
  assert.notEqual(/const VERSION = "([0-9a-f]+)"/.exec(a)?.[1], /const VERSION = "([0-9a-f]+)"/.exec(b)?.[1]);
  assert.doesNotMatch(a, /__AURA_/, 'no queda ningún hueco de la plantilla');
  // Dr Electrum: sin index.html en el build, no hay service worker.
  assert.equal(listaPrecache({ 'assets/electrum-1.js': { type: 'chunk', isEntry: true, fileName: 'assets/electrum-1.js', facadeModuleId: '/repo/electrum.html', imports: [] } } as any), null);
});

/** Corre el sw.js armado en un `self` de mentira (caches, clients, fetch) y devuelve sus manejadores. */
function cargarSw(redFalla = { valor: false }) {
  const oyentes: Record<string, (e: any) => void> = {};
  const cajas = new Map<string, Map<string, Response>>();
  const pedidasRed: string[] = [];
  let saltoEspera = 0;
  let reclamados = 0;
  const caches = {
    open: async (n: string) => {
      if (!cajas.has(n)) cajas.set(n, new Map());
      const c = cajas.get(n)!;
      return {
        addAll: async (urls: string[]) => {
          for (const u of urls) c.set(u, new Response(`precache ${u}`, { status: 200 }));
        },
        put: async (req: any, r: Response) => void c.set(new URL(typeof req === 'string' ? req : req.url, 'https://aura.test').pathname, r),
        match: async (req: any) => c.get(new URL(typeof req === 'string' ? req : req.url, 'https://aura.test').pathname),
        keys: async () => [...c.keys()].map((p) => new Request(`https://aura.test${p}`)),
        delete: async (req: any) => c.delete(new URL(typeof req === 'string' ? req : req.url, 'https://aura.test').pathname),
      };
    },
    match: async (req: any) => {
      const p = new URL(typeof req === 'string' ? req : req.url, 'https://aura.test').pathname;
      for (const c of cajas.values()) if (c.has(p)) return c.get(p)!.clone();
      return undefined;
    },
    keys: async () => [...cajas.keys()],
    delete: async (n: string) => cajas.delete(n),
  };
  const self: any = {
    location: { origin: 'https://aura.test' },
    addEventListener: (t: string, f: any) => (oyentes[t] = f),
    skipWaiting: () => void saltoEspera++,
    clients: { claim: async () => void reclamados++ },
  };
  const sandbox: any = {
    self,
    caches,
    URL,
    Response,
    Request,
    fetch: async (req: any) => {
      const u = typeof req === 'string' ? req : req.url;
      pedidasRed.push(u);
      if (redFalla.valor) throw new TypeError('Failed to fetch');
      return new Response(`red ${u}`, { status: 200, headers: { 'Cache-Control': 'public, max-age=60' } });
    },
    console,
  };
  vm.runInNewContext(armarSw(plantilla, listaPrecache(bundle)!), sandbox);
  const responder = async (url: string, o: { modo?: string; metodo?: string; cabeceras?: Record<string, string> } = {}) => {
    let respuesta: Promise<Response> | null = null;
    const req = new Request(url, { method: o.metodo || 'GET', headers: o.cabeceras });
    Object.defineProperty(req, 'mode', { value: o.modo || 'cors' });
    oyentes.fetch({ request: req, respondWith: (p: Promise<Response>) => (respuesta = p) });
    return respuesta ? await respuesta : null;
  };
  const esperar = async (tipo: string, extra: any = {}) => {
    let p: Promise<unknown> = Promise.resolve();
    oyentes[tipo]({ waitUntil: (x: Promise<unknown>) => (p = x), ...extra });
    await p;
  };
  return { self, oyentes, cajas, responder, esperar, pedidasRed, saltos: () => saltoEspera, reclamados: () => reclamados };
}

test('el service worker no toca /api, /sso, la sesión, otros orígenes, la sala ni Electrum', async () => {
  const sw = cargarSw();
  await sw.esperar('install');
  for (const u of ['https://aura.test/api/turno', 'https://aura.test/sso?pase=x&estado=y', 'https://aura.test/.well-known/assetlinks.json', 'https://otro.test/assets/index-abc.js', 'https://aura.test/sala.html', 'https://aura.test/electrum.html', 'https://aura.test/sw.js']) {
    assert.equal(await sw.responder(u), null, u);
  }
  assert.equal(await sw.responder('https://aura.test/', { modo: 'navigate', metodo: 'POST' }), null, 'solo GET');
  assert.equal(await sw.responder('https://aura.test/assets/index-abc.js', { cabeceras: { 'x-ultron-sesion': 't' } }), null, 'lo que lleva la sesión, nunca');
  assert.equal(await sw.responder('https://aura.test/sso', { modo: 'navigate' }), null, 'la vuelta de la wallet va a la red, siempre');
});

test('navegación: primero la red; sin red, el shell guardado. Assets del build: del caché', async () => {
  const red = { valor: false };
  const sw = cargarSw(red);
  await sw.esperar('install');
  assert.equal(await (await sw.responder('https://aura.test/', { modo: 'navigate' }))!.text(), 'red https://aura.test/');
  red.valor = true;
  assert.equal(await (await sw.responder('https://aura.test/', { modo: 'navigate' }))!.text(), 'precache /', 'sin red, el shell');
  assert.equal(await (await sw.responder('https://aura.test/?entrar=genesis', { modo: 'navigate' }))!.text(), 'precache /');
  assert.equal(await (await sw.responder('https://aura.test/assets/index-abc.js'))!.text(), 'precache /assets/index-abc.js');
});

test('una respuesta privada o no-store no se guarda', async () => {
  const sw = cargarSw();
  const s = vm.runInNewContext(`${armarSw(plantilla, ['/'])}; ({ cacheable })`, { self: { addEventListener() {}, location: { origin: 'https://aura.test' } }, URL, Response });
  assert.equal(s.cacheable(new Response('x', { status: 200, headers: { 'Cache-Control': 'no-store' } })), false);
  assert.equal(s.cacheable(new Response('x', { status: 200, headers: { 'Cache-Control': 'private, max-age=60' } })), false);
  assert.equal(s.cacheable(new Response('x', { status: 500 })), false);
  void sw;
});

test('actualización controlada: espera al «activar» de la persona; al activarse borra los cachés viejos de AU-RA', async () => {
  const sw = cargarSw();
  await sw.esperar('install');
  assert.equal(sw.saltos(), 0, 'no salta la espera por su cuenta');
  sw.cajas.set('aura-shell-viejo', new Map());
  sw.cajas.set('otra-cosa', new Map());
  sw.oyentes.message({ data: { tipo: 'activar' } });
  assert.equal(sw.saltos(), 1);
  await sw.esperar('activate');
  assert.ok(!sw.cajas.has('aura-shell-viejo'), 'el caché viejo de AU-RA se fue');
  assert.ok(sw.cajas.has('otra-cosa'), 'lo que no es de AU-RA no se toca');
  assert.equal(sw.reclamados(), 1);
});

test('GET /api/pwa: el interruptor del service worker (AURA_SW=0 lo apaga)', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pwa-'));
  process.env.ULTRON_SESION_SECRETO ||= 'secreto-de-prueba-largo-para-las-sesiones-pwa';
  after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const { montarRutasApp } = await import('../server/app-rutas');
  const { sesionDe, tokenDe, exigirMesa } = await import('../server/seguridad');
  const app = express();
  const pasa = () => ((_q: express.Request, _s: express.Response, n: express.NextFunction) => n()) as express.RequestHandler;
  montarRutasApp(app, { exigirMesa, limitar: pasa, sesionDe, tokenDe, perfilPlataforma: () => ({}) });
  const srv = app.listen(0, '127.0.0.1');
  await new Promise((r) => srv.once('listening', r));
  const base = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
  try {
    delete process.env.AURA_SW;
    const r = await fetch(`${base}/api/pwa`);
    assert.equal(r.headers.get('cache-control'), 'no-store');
    assert.equal(((await r.json()) as any).sw, true);
    process.env.AURA_SW = '0';
    assert.equal(((await (await fetch(`${base}/api/pwa`)).json()) as any).sw, false);
  } finally {
    delete process.env.AURA_SW;
    await new Promise((r) => srv.close(r));
  }
});

test('manifest e index para el icono del iPhone: standalone, id estable, iconos «any» y «maskable» separados', () => {
  const m = JSON.parse(fs.readFileSync(path.join(raiz, 'public/manifest.webmanifest'), 'utf8'));
  assert.equal(m.display, 'standalone');
  assert.equal(m.id, '/');
  assert.equal(m.start_url, '/');
  assert.ok(m.icons.every((i: any) => i.purpose === 'any' || i.purpose === 'maskable'), 'un propósito por icono');
  assert.ok(m.icons.some((i: any) => i.purpose === 'maskable'));
  const html = fs.readFileSync(path.join(raiz, 'index.html'), 'utf8');
  assert.match(html, /<link rel="apple-touch-icon" href="\/apple-touch-icon.png"/);
  assert.match(html, /<meta name="apple-mobile-web-app-title" content="AU-RA"/);
  assert.doesNotMatch(fs.readFileSync(path.join(raiz, 'electrum.html'), 'utf8'), /sw\.js|serviceWorker/, 'Electrum no registra el service worker de AU-RA');
});

/*
 * AUR14 · purga por logout: al salir de la cuenta el worker borra todo caché que pudiera tener algo de ella
 * (el seudónimo de los avisos, cualquier caché de AU-RA que no sea el shell de ESTA versión, y del shell lo
 * que no sea el shell); la clave del shell es por versión. Lo que no es de AU-RA no se toca.
 */
test('purga por logout: el worker borra lo de la cuenta y deja solo el shell público de esta versión', async () => {
  const sw = cargarSw();
  await sw.esperar('install');
  const shell = [...sw.cajas.keys()].find((n) => n.startsWith('aura-shell-'))!;
  assert.match(shell, /^aura-shell-[0-9a-f]{16}$/, 'la clave del shell es por versión (la huella del build)');
  sw.cajas.get(shell)!.set('/assets/lazy-777.js', new Response('perezoso'));
  sw.cajas.set('aura-cuenta', new Map([['/__aura_para', new Response('u0123456789abcdef')]]));
  sw.cajas.set('aura-shell-viejo', new Map([['/', new Response('viejo')]]));
  sw.cajas.set('otra-cosa', new Map([['/x', new Response('x')]]));
  const respuestas: any[] = [];
  await sw.esperar('message', { data: { tipo: 'purgar' }, ports: [{ postMessage: (m: any) => respuestas.push(m) }] });
  assert.ok(!sw.cajas.has('aura-cuenta'), 'el seudónimo de la cuenta se fue');
  assert.ok(!sw.cajas.has('aura-shell-viejo'), 'un shell de otra versión se fue');
  assert.ok(sw.cajas.has('otra-cosa'), 'lo que no es de AU-RA no se toca');
  assert.deepEqual([...sw.cajas.get(shell)!.keys()].sort(), [...listaPrecache(bundle)!].sort(), 'del shell queda exactamente el precache');
  assert.deepEqual(JSON.parse(JSON.stringify(respuestas)), [{ purgado: true }], 'avisa a la página que terminó');
  assert.equal(sw.saltos(), 0, 'purgar no activa una versión que espera');
});

test('aviso tocado: con una ventana abierta le dice a qué pantalla ir (sin navegarla); sin ventana, abre /?abrir=', async () => {
  const sw = cargarSw();
  const mensajes: unknown[] = [];
  let enfocada = 0;
  const abiertas: string[] = [];
  sw.self.clients.matchAll = async () => [{ url: 'https://aura.test/', focus: async () => void enfocada++, postMessage: (m: unknown) => void mensajes.push(m), navigate: () => assert.fail('no se navega: cortaría la llamada') }];
  sw.self.clients.openWindow = async (u: string) => void abiertas.push(u);
  await sw.esperar('notificationclick', { notification: { close() {}, data: { abrir: 'computadora' } } });
  // El mensaje nace en el contexto del worker (vm): se compara por su forma.
  assert.deepEqual(JSON.parse(JSON.stringify(mensajes)), [{ tipo: 'aura-abrir', abrir: 'computadora' }]);
  assert.equal(enfocada, 1);
  assert.deepEqual(abiertas, []);
  sw.self.clients.matchAll = async () => [];
  await sw.esperar('notificationclick', { notification: { close() {}, data: { abrir: 'computadora' } } });
  assert.deepEqual(abiertas, ['/?abrir=computadora']);
});

test('el cliente: ?abrir= al abrir (y se quita de la barra) y el mensaje del worker llevan a su pantalla', async () => {
  const { destinoDeAviso, escucharAvisosTocados } = await import('../src/10-infra/abrirDesdeAviso');
  assert.equal(destinoDeAviso('computadora'), 'trabajar');
  assert.equal(destinoDeAviso('mesa'), 'conversar');
  assert.equal(destinoDeAviso('tareas'), 'tareas', '«Terminé de investigar»: abre el panel de Tareas');
  assert.equal(destinoDeAviso('chats'), null, 'lo que la web no muestra deja la mesa como está');
  const oyentes: Array<(e: any) => void> = [];
  let barra = '';
  const w: any = {
    location: { href: 'https://aura.test/?abrir=computadora' },
    history: { state: null, replaceState: (_s: unknown, _t: string, u: string) => void (barra = u) },
    navigator: { serviceWorker: { addEventListener: (_t: string, f: any) => oyentes.push(f), removeEventListener: () => oyentes.pop() } },
  };
  const idas: string[] = [];
  const dejar = escucharAvisosTocados((d) => idas.push(d), w);
  assert.deepEqual(idas, ['trabajar']);
  assert.equal(barra, '/');
  oyentes[0]({ data: { tipo: 'aura-abrir', abrir: 'mesa' } });
  oyentes[0]({ data: { tipo: 'otro', abrir: 'computadora' } });
  assert.deepEqual(idas, ['trabajar', 'conversar']);
  dejar();
  assert.equal(oyentes.length, 0);
});
