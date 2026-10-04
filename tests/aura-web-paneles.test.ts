/**
 * PANELES CERRADOS FUERA DEL ÁRBOL, FOCO AL ABRIR Y AL CERRAR (auditoría A15 y A16).
 *
 * Antes, Ajustes y Escribir se escondían con transform y `pointer-events-none`: con los paneles
 * cerrados, Tab visitaba sus controles y el lector de pantalla recitaba el catálogo entero. Y al
 * pulsar «Escribir» el foco se quedaba en el botón: había que ir a buscar el campo.
 *
 * Tres niveles:
 *   1. Render en el servidor: un panel cerrado no produce ni un nodo; uno abierto es un diálogo con
 *      nombre (role, aria-modal, aria-labelledby que apunta a un título que existe).
 *   2. La lógica de foco (07-pantallas/foco.ts), sin navegador.
 *   3. El navegador de verdad, contra `dist/` (se salta si no hay Chromium de Playwright o no se
 *      compiló): Tab no entra en paneles cerrados, el árbol accesible no los nombra, abrir Escribir
 *      enfoca el campo, Escape cierra y el foco vuelve al botón que lo abrió.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { DockDrawer } from '../src/07-pantallas/DockDrawer';
import { SettingsSheet } from '../src/07-pantallas/SettingsSheet';
import { MenuMas } from '../src/07-pantallas/MenuMas';
import { AccesoModal } from '../src/07-pantallas/AccesoModal';
import { UltronVaultModal } from '../src/07-pantallas/UltronVaultModal';
import { PhotoCaptureModal } from '../src/07-pantallas/PhotoCaptureModal';
import { saltoDeTab, recordarDisparador } from '../src/07-pantallas/foco';

const nada = () => {};
const ajustes = (isOpen: boolean) =>
  React.createElement(SettingsSheet, {
    isOpen,
    currentMode: 'GUARDIAN',
    currentFace: 'IDLE',
    soundFxEnabled: true,
    speakerEnabled: true,
    funMode: false,
    usuario: { name: '', authenticated: false },
    tema: 'sistema',
    onTema: nada,
    estadoCerebro: 'Lista',
    estadoArranque: 'cerebro en línea',
    hayConversacion: false,
    onClose: nada,
    onSelectMode: nada,
    onSelectFace: nada,
    onToggleSoundFx: nada,
    onToggleSpeaker: nada,
    onToggleFunMode: nada,
    onOpenAcceso: nada,
    onOpenVault: nada,
    onOpenPhotos: nada,
    onProbarVoz: nada,
    onEjemplo: nada,
    onOlvidar: nada,
    onVaciarConversacion: nada,
  } as any);
const escribir = (isOpen: boolean) => React.createElement(DockDrawer, { isOpen, soundFxEnabled: false, onClose: nada, onSubmitCommand: nada } as any);
const mas = (abierto: boolean) =>
  React.createElement(MenuMas, {
    abierto,
    onCerrar: nada,
    speakerEnabled: true,
    visionEnabled: false,
    isSleeping: false,
    isKioskFrame: false,
    isFullscreen: false,
    onToggleSpeaker: nada,
    onToggleVision: nada,
    onOpenCamera: nada,
    onToggleSleep: nada,
    onToggleKioskFrame: nada,
    onToggleFullscreen: nada,
  } as any);

test('cerrados, los paneles no dejan ni un nodo (ni Tab ni el lector los encuentran)', () => {
  const cerrados: Array<[string, React.ReactElement]> = [
    ['Ajustes', ajustes(false)],
    ['Escribir', escribir(false)],
    ['Más', mas(false)],
    ['Entrar', React.createElement(AccesoModal, { isOpen: false, usuario: { name: '', role: '', authenticated: false }, soundFxEnabled: false, onClose: nada, onAuthSuccess: nada, onLogout: nada } as any)],
    ['Bóveda', React.createElement(UltronVaultModal, { isOpen: false, onClose: nada, onSpeak: nada } as any)],
    ['Fotos', React.createElement(PhotoCaptureModal, { isOpen: false, onClose: nada, photos: [], onDeletePhoto: nada, onTriggerNewPhoto: nada } as any)],
  ];
  for (const [nombre, el] of cerrados) assert.equal(renderToStaticMarkup(el), '', `${nombre} cerrado no debe renderizar nada`);
});

function esDialogoConNombre(html: string, nombre: string) {
  assert.match(html, /role="dialog"/, `${nombre}: role="dialog"`);
  assert.match(html, /aria-modal="true"/, `${nombre}: aria-modal`);
  const id = html.match(/aria-labelledby="([^"]+)"/)?.[1];
  assert.ok(id, `${nombre}: aria-labelledby`);
  assert.match(html, new RegExp(`id="${id}"`), `${nombre}: el título ${id} existe`);
}

test('abiertos, son diálogos con nombre', () => {
  esDialogoConNombre(renderToStaticMarkup(ajustes(true)), 'Ajustes');
  esDialogoConNombre(renderToStaticMarkup(escribir(true)), 'Escribir');
  esDialogoConNombre(renderToStaticMarkup(mas(true)), 'Más');
});

test('Escribir abierto tiene su campo con etiqueta', () => {
  const html = renderToStaticMarkup(escribir(true));
  assert.match(html, /<label[^>]*for="dock-cmd-input"/);
  assert.match(html, /id="dock-cmd-input"/);
});

test('las pestañas de Ajustes son pestañas (no botones con aria-pressed)', () => {
  const html = renderToStaticMarkup(ajustes(true));
  assert.match(html, /role="tablist"/);
  assert.equal((html.match(/role="tab"/g) || []).length, 5);
  assert.equal((html.match(/aria-selected="true"/g) || []).length, 1);
  assert.match(html, /role="tabpanel"/);
  for (const t of ['Preferencias', 'Voz', 'Tu AURA', 'Privacidad y datos', 'Diagnóstico']) assert.ok(html.includes(t), t);
});

test('P4/U1: «Más» lleva a tus correos, a «Lo que sé de ti» y a tus avisos (entradas reales, no solo memoria local)', () => {
  const html = renderToStaticMarkup(React.createElement(MenuMas, { ...(mas(true).props as object), onAbrirTuAura: nada } as any));
  for (const t of ['Tus correos', 'Lo que sé de ti', 'Tus avisos']) assert.ok(html.includes(t), `Más: ${t}`);
});

test('Tab en el borde del diálogo da la vuelta; en medio deja hacer al navegador', () => {
  const l = ['a', 'b', 'c'];
  assert.equal(saltoDeTab(l, 'c', false), 'a');
  assert.equal(saltoDeTab(l, 'a', true), 'c');
  assert.equal(saltoDeTab(l, 'b', false), null);
  assert.equal(saltoDeTab(l, null, false), 'a', 'foco fuera: entra por el primero');
  assert.equal(saltoDeTab([], 'x', false), null);
});

test('al cerrar, el foco vuelve a quien abrió (si sigue en la página)', () => {
  let enfocado = '';
  const boton = { focus: () => (enfocado = 'escribir') };
  recordarDisparador(boton).devolver(() => true);
  assert.equal(enfocado, 'escribir');
  enfocado = '';
  recordarDisparador(boton).devolver(() => false);
  assert.equal(enfocado, '', 'un botón que ya no existe no se enfoca');
  recordarDisparador(null).devolver();
});

/* ------------------------------------------------- en el navegador, contra dist/ */

// AURA_DIST permite correrla contra otra compilación (p. ej. la de antes, para ver que falla).
const DIST = process.env.AURA_DIST || path.join(process.cwd(), 'dist');
const CHROMIUM = [process.env.AURA_CHROMIUM, '/opt/pw-browsers/chromium'].find((x) => x && fs.existsSync(x));
const hayDist = fs.existsSync(path.join(DIST, 'index.html'));
/**
 * En CI el navegador es OBLIGATORIO (punto 4 de la revisión del 4-oct): con AURA_EXIGIR_NAVEGADOR=1 estas pruebas
 * no se saltan nunca; sin Chromium o sin dist/ fallan, y el control bloquea la aprobación en vez de quedar omitido.
 */
const EXIGIR_NAVEGADOR = process.env.AURA_EXIGIR_NAVEGADOR === '1';
const sinNavegador = !CHROMIUM ? 'sin Chromium de Playwright (AURA_CHROMIUM o /opt/pw-browsers)' : !hayDist ? 'sin dist/: correr la compilación antes' : '';
const saltoNavegador: string | false = EXIGIR_NAVEGADOR ? false : sinNavegador || false;

test('el navegador real está disponible cuando se exige (CI)', { skip: EXIGIR_NAVEGADOR ? false : 'solo con AURA_EXIGIR_NAVEGADOR=1' }, () => {
  assert.equal(sinNavegador, '', `la regresión de navegador no puede omitirse: ${sinNavegador}`);
});

function servir(o: { conSesion?: boolean } = { conSesion: true }): Promise<{ url: string; cerrar: () => void }> {
  const tipos: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json', '.mp3': 'audio/mpeg', '.webmanifest': 'application/manifest+json', '.wasm': 'application/wasm' };
  const srv = http.createServer((req, res) => {
    const u = new URL(req.url || '/', 'http://x');
    const json = (o: unknown) => (res.writeHead(200, { 'Content-Type': 'application/json' }), res.end(JSON.stringify(o)));
    if (u.pathname === '/api/health') return json({ qwen: { vivo: false } });
    if (u.pathname === '/api/nodo/listo') return json({ listo: false });
    // La mesa solo se abre con sesión (sin ella, la puerta: José, 4-oct).
    if (u.pathname === '/api/ultron/sesion') return json(o.conSesion ? { authenticated: true, user: { nombre: 'Prueba', rol: 'Junta', correo: 'prueba@ejemplo.com' } } : { authenticated: false });
    if (u.pathname === '/api/capacidades') return json({ capacidades: [] });
    if (u.pathname.startsWith('/api/')) return (res.writeHead(404, { 'Content-Type': 'application/json' }), res.end('{}'));
    let f = path.join(DIST, decodeURIComponent(u.pathname));
    if (!f.startsWith(DIST) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) f = path.join(DIST, 'index.html');
    res.writeHead(200, { 'Content-Type': tipos[path.extname(f)] || 'application/octet-stream' });
    fs.createReadStream(f).pipe(res);
  });
  return new Promise((r) => srv.listen(0, '127.0.0.1', () => r({ url: `http://127.0.0.1:${(srv.address() as any).port}`, cerrar: () => srv.close() })));
}

test(
  'en el navegador: paneles cerrados, foco de Escribir y de Ajustes',
  { skip: saltoNavegador, timeout: 120000 },
  async (t) => {
    const { chromium } = await import('playwright');
    const srv = await servir();
    const b = await chromium.launch({ executablePath: CHROMIUM, args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
    t.after(async () => {
      await b.close();
      srv.cerrar();
    });
    const p = await b.newPage({ viewport: { width: 1280, height: 800 } });
    await p.goto(srv.url + '/', { waitUntil: 'networkidle' });
    // Fuera el arranque (≥ 1,9 s) y el saludo.
    await p.waitForSelector('#ultron-arranque[aria-hidden="true"]', { timeout: 20000 });
    await p.waitForTimeout(400);

    await t.test('cerrados, Ajustes y Escribir no están en el DOM ni en el árbol accesible', async () => {
      assert.equal(await p.locator('[role="dialog"]').count(), 0);
      const arbol = await p.locator('body').ariaSnapshot();
      assert.doesNotMatch(arbol, /dialog/i);
      // Ni el campo de Escribir ni el título ni los controles de Ajustes (antes estaban todos).
      assert.doesNotMatch(arbol, /textbox "Escribirle/i);
      assert.doesNotMatch(arbol, /heading "Ajustes/);
      assert.doesNotMatch(arbol, /Cerrar ajustes/);
    });

    await t.test('Tab recorre solo controles visibles y nunca uno de un panel cerrado', async () => {
      await p.locator('body').click({ position: { x: 5, y: 400 } }).catch(() => {});
      const vistos: string[] = [];
      for (let i = 0; i < 25; i++) {
        await p.keyboard.press('Tab');
        const info = await p.evaluate(() => {
          const el = document.activeElement as HTMLElement | null;
          if (!el || el === document.body) return null;
          const r = el.getBoundingClientRect();
          const visible = r.width > 0 && r.height > 0 && r.bottom > 0 && r.right > 0 && r.top < innerHeight && r.left < innerWidth && getComputedStyle(el).visibility !== 'hidden';
          return { nombre: el.getAttribute('aria-label') || el.textContent?.trim().slice(0, 30) || el.tagName, visible, enDialogo: !!el.closest('[role="dialog"]') };
        });
        if (!info) continue;
        assert.ok(info.visible, `Tab llegó a algo invisible: ${info.nombre}`);
        assert.ok(!info.enDialogo, `Tab entró en un diálogo cerrado: ${info.nombre}`);
        vistos.push(info.nombre);
      }
      assert.ok(vistos.includes('Escribir'), `Escribir se alcanza con Tab (vistos: ${vistos.join(', ')})`);
    });

    await t.test('abrir Escribir enfoca el campo; Tab no sale; Escape cierra y el foco vuelve al botón', async () => {
      const boton = p.getByRole('button', { name: 'Escribir', exact: true });
      await boton.focus();
      await p.keyboard.press('Enter');
      await p.waitForSelector('[role="dialog"]');
      await p.waitForFunction(() => document.activeElement?.id === 'dock-cmd-input', null, { timeout: 3000 });
      assert.equal(await p.evaluate(() => document.getElementById('aura-contenido')?.hasAttribute('inert')), true, 'el fondo queda inert');
      for (let i = 0; i < 8; i++) {
        await p.keyboard.press('Tab');
        assert.equal(await p.evaluate(() => !!document.activeElement?.closest('[role="dialog"]')), true, 'Tab se queda en el diálogo');
      }
      await p.keyboard.press('Escape');
      await p.waitForFunction(() => !document.querySelector('[role="dialog"]'));
      await p.waitForFunction(() => document.activeElement?.textContent?.trim() === 'Escribir', null, { timeout: 3000 });
      assert.equal(await p.evaluate(() => document.getElementById('aura-contenido')?.hasAttribute('inert')), false);
    });

    await t.test('Ajustes con el ratón: Escape cierra y el foco vuelve a Ajustes', async () => {
      await p.getByRole('button', { name: 'Ajustes', exact: true }).click();
      await p.waitForSelector('[role="dialog"][aria-labelledby="aura-ajustes-titulo"]');
      await p.keyboard.press('Escape');
      await p.waitForFunction(() => !document.querySelector('[role="dialog"]'));
      await p.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === 'Ajustes', null, { timeout: 3000 });
    });

    await t.test('las pestañas de Ajustes se recorren con las flechas', async () => {
      await p.getByRole('button', { name: 'Ajustes', exact: true }).click();
      await p.getByRole('tab', { name: 'Preferencias' }).focus();
      await p.keyboard.press('ArrowRight');
      assert.equal(await p.evaluate(() => document.activeElement?.textContent?.trim()), 'Voz');
      assert.equal(await p.getByRole('tab', { name: 'Voz' }).getAttribute('aria-selected'), 'true');
      await p.keyboard.press('Escape');
    });
  }
);

test(
  'en el navegador, sin sesión: solo la puerta de entrar (sin mesa, sin micrófono, no se cierra)',
  { skip: saltoNavegador, timeout: 120000 },
  async (t) => {
    const { chromium } = await import('playwright');
    const srv = await servir({ conSesion: false });
    const b = await chromium.launch({ executablePath: CHROMIUM, args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
    t.after(async () => {
      await b.close();
      srv.cerrar();
    });
    const p = await b.newPage({ viewport: { width: 390, height: 844 } });
    await p.goto(srv.url + '/', { waitUntil: 'networkidle' });
    await p.waitForSelector('#aura-acceso-titulo', { timeout: 20000 });
    assert.equal((await p.locator('#aura-acceso-titulo').textContent())?.trim(), 'Entrar a AU-RA');
    assert.equal(await p.locator('button[aria-label="Cerrar"]').count(), 0, 'la puerta no tiene «Cerrar»');
    assert.equal(await p.locator('.aura-mic').count(), 0, 'sin micrófono');
    assert.equal(await p.getByRole('button', { name: 'Escribir', exact: true }).count(), 0, 'sin la mesa detrás');
    await p.keyboard.press('Escape');
    await p.waitForTimeout(300);
    assert.equal(await p.locator('#aura-acceso-titulo').count(), 1, 'Escape no la cierra');
  }
);

test(
  'en el navegador: vence la sesión de A y entra B → nada del historial de A viaja ni se ve (bloqueo 4, revisión del 4-oct)',
  { skip: saltoNavegador, timeout: 120000 },
  async (t) => {
    const { chromium } = await import('playwright');
    const cuerpos: any[] = [];
    let turnos = 0;
    let sesionB = false;
    const tipos: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.wasm': 'application/wasm' };
    const srv = http.createServer((req, res) => {
      const u = new URL(req.url || '/', 'http://x');
      const json = (o: unknown, s = 200) => (res.writeHead(s, { 'Content-Type': 'application/json' }), res.end(JSON.stringify(o)));
      const leer = () => new Promise<string>((r) => { let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => r(b)); });
      if (u.pathname === '/api/health') return json({ qwen: { vivo: true } });
      if (u.pathname === '/api/nodo/listo') return json({ listo: true });
      if (u.pathname === '/api/genesis/config') return json({ disponible: false });
      if (u.pathname === '/api/ultron/sesion') return json(sesionB ? { authenticated: true, user: { nombre: 'Bea', rol: 'Junta', correo: 'bea@ejemplo.com' } } : { authenticated: true, user: { nombre: 'Ana', rol: 'Junta', correo: 'ana@ejemplo.com' } });
      if (u.pathname === '/api/ultron/entrar') {
        sesionB = true;
        return json({ ok: true, token: 'token-de-bea', miembro: { nombre: 'Bea', rol: 'Junta', correo: 'bea@ejemplo.com' } });
      }
      if (u.pathname === '/api/turno/stream') {
        return void leer().then((b) => {
          turnos++;
          cuerpos.push(JSON.parse(b || '{}'));
          // El segundo turno de Ana encuentra la sesión vencida.
          if (turnos === 2) return json({ error: 'sesión requerida' }, 401);
          const reply = turnos === 1 ? 'Anotado, Ana: tu clave secreta es PIÑA-7781.' : 'Hola, Bea.';
          res.writeHead(200, { 'Content-Type': 'text/event-stream' });
          res.end(`event: done\ndata: ${JSON.stringify({ reply, voz: reply, emocion: 'neutral' })}\n\n`);
        });
      }
      if (u.pathname.startsWith('/api/')) return json({}, 404);
      let f = path.join(DIST, decodeURIComponent(u.pathname));
      if (!f.startsWith(DIST) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) f = path.join(DIST, 'index.html');
      res.writeHead(200, { 'Content-Type': tipos[path.extname(f)] || 'application/octet-stream' });
      fs.createReadStream(f).pipe(res);
    });
    const url = await new Promise<string>((r) => srv.listen(0, '127.0.0.1', () => r(`http://127.0.0.1:${(srv.address() as any).port}`)));
    const b = await chromium.launch({ executablePath: CHROMIUM, args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
    t.after(async () => {
      await b.close();
      srv.close();
    });
    const p = await b.newPage({ viewport: { width: 1280, height: 800 } });
    await p.goto(url + '/', { waitUntil: 'networkidle' });
    await p.waitForSelector('#ultron-arranque[aria-hidden="true"]', { timeout: 20000 });
    const escribir = async (texto: string) => {
      if (!(await p.locator('#dock-cmd-input').count())) {
        await p.getByRole('button', { name: 'Escribir', exact: true }).focus();
        await p.keyboard.press('Enter');
        await p.waitForSelector('#dock-cmd-input');
      }
      await p.locator('#dock-cmd-input').fill(texto);
      await p.locator('#dock-cmd-input').press('Enter');
    };
    await escribir('Mi clave secreta es PIÑA-7781, recuérdala');
    await p.waitForFunction(() => document.body.innerText.includes('PIÑA-7781'), null, { timeout: 15000 });
    await p.keyboard.press('Escape').catch(() => {});
    // El segundo turno de Ana: la sesión venció → la puerta.
    await escribir('¿Cuál era mi clave?');
    await p.waitForSelector('#aura-acceso-titulo', { timeout: 15000 });
    // Entra Bea.
    await p.locator('input[type="email"]').fill('bea@ejemplo.com');
    await p.locator('input[type="password"]').fill('clave-de-bea');
    await p.locator('form button[type="submit"]').click();
    await p.waitForSelector('#ultron-app-root[data-modo]', { timeout: 15000 });
    assert.doesNotMatch(await p.locator('body').innerText(), /PIÑA-7781/, 'en pantalla no queda nada de Ana');
    await escribir('Hola');
    await p.waitForFunction(() => document.body.innerText.includes('Hola, Bea'), null, { timeout: 15000 });
    const deBea = cuerpos[cuerpos.length - 1];
    assert.ok(Array.isArray(deBea.historial), 'el turno lleva su historial');
    assert.doesNotMatch(JSON.stringify(deBea), /PIÑA-7781|clave secreta/, 'el historial que viaja al cerebro no trae nada de Ana');
  }
);

test(
  'en el navegador: la respuesta tardía de A llega cuando ya entró B → no se ve, no se dice, no viaja desde B (punto 3, revisión del 4-oct)',
  { skip: saltoNavegador, timeout: 120000 },
  async (t) => {
    const { chromium } = await import('playwright');
    const cuerpos: any[] = [];
    let quien: 'ana' | 'bea' | null = 'ana';
    let soltarTardia: (() => void) | null = null;
    const tardiaLista = new Promise<void>((r) => (soltarTardia = r));
    let pidioAna: (() => void) | null = null;
    const anaPidio = new Promise<void>((r) => (pidioAna = r));
    const tipos: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.wasm': 'application/wasm' };
    const srv = http.createServer((req, res) => {
      const u = new URL(req.url || '/', 'http://x');
      const json = (o: unknown, s = 200) => (res.writeHead(s, { 'Content-Type': 'application/json' }), res.end(JSON.stringify(o)));
      const leer = () => new Promise<string>((r) => { let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => r(b)); });
      if (u.pathname === '/api/health') return json({ qwen: { vivo: true } });
      if (u.pathname === '/api/nodo/listo') return json({ listo: true });
      if (u.pathname === '/api/genesis/config') return json({ disponible: false });
      if (u.pathname === '/api/ultron/sesion')
        return json(quien === 'ana' ? { authenticated: true, user: { nombre: 'Ana', rol: 'Junta', correo: 'ana@ejemplo.com' } } : quien === 'bea' ? { authenticated: true, user: { nombre: 'Bea', rol: 'Junta', correo: 'bea@ejemplo.com' } } : { authenticated: false });
      if (u.pathname === '/api/ultron/salir') {
        quien = null;
        return json({ ok: true });
      }
      if (u.pathname === '/api/ultron/entrar') {
        quien = 'bea';
        return json({ ok: true, token: 'token-de-bea', miembro: { nombre: 'Bea', rol: 'Junta', correo: 'bea@ejemplo.com' } });
      }
      if (u.pathname === '/api/turno/stream') {
        return void leer().then(async (b) => {
          const cuerpo = JSON.parse(b || '{}');
          cuerpos.push(cuerpo);
          res.writeHead(200, { 'Content-Type': 'text/event-stream' });
          const enviar = (ev: string, d: unknown) => {
            try {
              res.write(`event: ${ev}\ndata: ${JSON.stringify(d)}\n\n`);
            } catch {
              /* el cliente ya cortó */
            }
          };
          if (cuerpos.length === 1) {
            // El turno de Ana: el servidor tarda; su respuesta llega cuando Bea ya entró.
            enviar('emocion', { emocion: 'neutral' });
            pidioAna!();
            await tardiaLista;
            const r = 'Ana, tu código secreto es PIÑA-7781.';
            enviar('delta', { text: r });
            enviar('done', { reply: r, voz: r, emocion: 'neutral', trazaId: 'traza-de-ana' });
            try {
              res.end();
            } catch {
              /* */
            }
            return;
          }
          const r = 'Hola, Bea.';
          enviar('done', { reply: r, voz: r, emocion: 'neutral' });
          res.end();
        });
      }
      if (u.pathname.startsWith('/api/')) return json({}, 404);
      let f = path.join(DIST, decodeURIComponent(u.pathname));
      if (!f.startsWith(DIST) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) f = path.join(DIST, 'index.html');
      res.writeHead(200, { 'Content-Type': tipos[path.extname(f)] || 'application/octet-stream' });
      fs.createReadStream(f).pipe(res);
    });
    const url = await new Promise<string>((r) => srv.listen(0, '127.0.0.1', () => r(`http://127.0.0.1:${(srv.address() as any).port}`)));
    const b = await chromium.launch({ executablePath: CHROMIUM, args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
    t.after(async () => {
      soltarTardia!();
      await b.close();
      srv.close();
    });
    const p = await b.newPage({ viewport: { width: 1280, height: 800 } });
    // Lo que AU-RA manda a la voz (servidor /api/tts o voz del navegador): nada de Ana puede sonar para Bea.
    const dicho: string[] = [];
    await p.exposeFunction('__dicho', (s: string) => dicho.push(s));
    await p.addInitScript(() => {
      const hablar = window.speechSynthesis?.speak?.bind(window.speechSynthesis);
      if (hablar) window.speechSynthesis.speak = (u: SpeechSynthesisUtterance) => ((window as any).__dicho(u.text), hablar(u));
    });
    await p.route('**/api/tts**', async (r) => {
      dicho.push(r.request().postData() || '');
      await r.fulfill({ status: 404, body: '' });
    });
    await p.goto(url + '/', { waitUntil: 'networkidle' });
    await p.waitForSelector('#ultron-arranque[aria-hidden="true"]', { timeout: 20000 });
    const escribir = async (texto: string) => {
      if (!(await p.locator('#dock-cmd-input').count())) {
        await p.getByRole('button', { name: 'Escribir', exact: true }).focus();
        await p.keyboard.press('Enter');
        await p.waitForSelector('#dock-cmd-input');
      }
      await p.locator('#dock-cmd-input').fill(texto);
      await p.locator('#dock-cmd-input').press('Enter');
    };
    // 1) Ana pide algo; el servidor se queda pensando.
    await escribir('Dime el código secreto de Ana');
    await anaPidio;
    await p.keyboard.press('Escape').catch(() => {});
    // 2) Ana cierra sesión mientras su turno sigue en vuelo.
    await p.getByRole('button', { name: 'Sesión de Ana' }).click();
    await p.getByRole('button', { name: /Cerrar sesión/ }).click();
    await p.waitForSelector('#aura-acceso-titulo', { timeout: 15000 });
    // 3) Entra Bea.
    await p.getByRole('button', { name: /Soy de la junta/ }).click().catch(() => {});
    await p.locator('input[type="email"]').fill('bea@ejemplo.com');
    await p.locator('input[type="password"]').fill('clave-de-bea');
    await p.locator('form button[type="submit"]').click();
    await p.waitForSelector('#ultron-app-root[data-modo]', { timeout: 15000 });
    // 4) Ahora llega la respuesta tardía de Ana.
    soltarTardia!();
    await p.waitForTimeout(2500);
    const pantalla = await p.locator('body').innerText();
    assert.doesNotMatch(pantalla, /PIÑA-7781/, 'la respuesta tardía de Ana no aparece para Bea');
    assert.doesNotMatch(pantalla, /código secreto de Ana/, 'tampoco lo que pidió Ana');
    // 5) Bea escribe: nada de Ana viaja con su turno.
    await escribir('Hola');
    await p.waitForFunction(() => document.body.innerText.includes('Hola, Bea'), null, { timeout: 15000 });
    const deBea = cuerpos[cuerpos.length - 1];
    assert.equal(cuerpos.length, 2, 'solo dos turnos: el de Ana y el de Bea');
    assert.doesNotMatch(JSON.stringify(deBea), /PIÑA-7781|código secreto|traza-de-ana/, 'el turno de Bea no lleva nada de Ana');
    assert.doesNotMatch(await p.locator('body').innerText(), /PIÑA-7781/, 'ni después del turno de Bea');
    assert.ok(!dicho.some((s) => /PIÑA|7781/.test(s)), `nada de Ana se mandó a la voz (${dicho.length} envíos a voz)`);
  }
);

test(
  'en el navegador: A pulsa «Pausar», sale y entra B; la respuesta tardía de A no mete su tarea en el panel de B (revisión independiente del 4-oct)',
  { skip: saltoNavegador, timeout: 120000 },
  async (t) => {
    const { chromium } = await import('playwright');
    let quien: 'ana' | 'bea' | null = 'ana';
    let soltar: (() => void) | null = null;
    let pidioPausa: (() => void) | null = null;
    const pausaPedida = new Promise<void>((r) => (pidioPausa = r));
    const ahoraIso = new Date().toISOString();
    const tareaDeAna = (estado: 'running' | 'paused') => ({
      id: 'tarea-ana-1',
      version: estado === 'running' ? 1 : 2,
      state: estado,
      terminal: false,
      source: 'tarea-en-curso',
      title: 'Informe privado SECRETO-ANA',
      objective: 'Informe privado SECRETO-ANA',
      acceptance: [],
      environment: { kind: 'chat', id: 'mesa', displayName: 'Esta conversación' },
      progress: { done: 1, total: 3, unit: 'pasos' },
      planVersion: 1,
      lastEventSequence: 0,
      lastHeartbeatAt: ahoraIso,
      decision: null,
      result: null,
      stopCondition: 'Se terminan los pasos.',
      createdAt: ahoraIso,
      updatedAt: ahoraIso,
      origin: { kind: 'tarea-en-curso', conversacion: 'mesa' },
      controls: { pause: estado === 'running', resume: estado === 'paused', cancel: true },
    });
    const tipos: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.wasm': 'application/wasm' };
    const srv = http.createServer((req, res) => {
      const u = new URL(req.url || '/', 'http://x');
      const json = (o: unknown, s = 200) => (res.writeHead(s, { 'Content-Type': 'application/json' }), res.end(JSON.stringify(o)));
      if (u.pathname === '/api/health') return json({ qwen: { vivo: true } });
      if (u.pathname === '/api/nodo/listo') return json({ listo: true });
      if (u.pathname === '/api/genesis/config') return json({ disponible: false });
      if (u.pathname === '/api/ultron/sesion')
        return json(quien === 'ana' ? { authenticated: true, user: { nombre: 'Ana', rol: 'Junta', correo: 'ana@ejemplo.com' } } : quien === 'bea' ? { authenticated: true, user: { nombre: 'Bea', rol: 'Junta', correo: 'bea@ejemplo.com' } } : { authenticated: false });
      if (u.pathname === '/api/ultron/salir') {
        quien = null;
        return json({ ok: true });
      }
      if (u.pathname === '/api/ultron/entrar') {
        quien = 'bea';
        return json({ ok: true, token: 'token-de-bea', miembro: { nombre: 'Bea', rol: 'Junta', correo: 'bea@ejemplo.com' } });
      }
      // Las tareas son de quien tiene la sesión: Ana tiene una; Bea, ninguna.
      if (u.pathname === '/api/trabajos') return quien ? json({ tareas: quien === 'ana' ? [tareaDeAna('running')] : [] }) : json({ error: 'sesión requerida' }, 401);
      if (u.pathname === '/api/trabajos/tarea-ana-1/pausar') {
        pidioPausa!();
        // El servidor tarda: la respuesta llega cuando Bea ya está dentro.
        return void new Promise<void>((r) => (soltar = r)).then(() => json({ ok: true, tarea: { ...tareaDeAna('running'), version: 2 } }));
      }
      if (u.pathname.startsWith('/api/')) return json({}, 404);
      let f = path.join(DIST, decodeURIComponent(u.pathname));
      if (!f.startsWith(DIST) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) f = path.join(DIST, 'index.html');
      res.writeHead(200, { 'Content-Type': tipos[path.extname(f)] || 'application/octet-stream' });
      fs.createReadStream(f).pipe(res);
    });
    const url = await new Promise<string>((r) => srv.listen(0, '127.0.0.1', () => r(`http://127.0.0.1:${(srv.address() as any).port}`)));
    const b = await chromium.launch({ executablePath: CHROMIUM, args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
    t.after(async () => {
      soltar?.();
      await b.close();
      srv.close();
    });
    const p = await b.newPage({ viewport: { width: 1280, height: 800 } });
    await p.goto(url + '/', { waitUntil: 'networkidle' });
    await p.waitForSelector('#ultron-arranque[aria-hidden="true"]', { timeout: 20000 });
    // 1) Ana abre su panel y pulsa «Pausar»; el servidor se queda pensando.
    await p.getByRole('button', { name: /Abrir el panel de tareas/ }).click({ timeout: 20000 });
    await p.getByRole('button', { name: 'Pausar', exact: true }).click();
    await pausaPedida;
    await p.keyboard.press('Escape').catch(() => {});
    // 2) Ana sale; entra Bea.
    await p.getByRole('button', { name: 'Sesión de Ana' }).click();
    await p.getByRole('button', { name: /Cerrar sesión/ }).click();
    await p.waitForSelector('#aura-acceso-titulo', { timeout: 15000 });
    await p.getByRole('button', { name: /Soy de la junta/ }).click().catch(() => {});
    await p.locator('input[type="email"]').fill('bea@ejemplo.com');
    await p.locator('input[type="password"]').fill('clave-de-bea');
    await p.locator('form button[type="submit"]').click();
    await p.waitForSelector('#ultron-app-root[data-modo]', { timeout: 15000 });
    await p.waitForTimeout(800);
    // 3) Llega la respuesta tardía de Ana (con su tarea).
    soltar!();
    // El indicador cambia como mucho cada 2,5 s (MINIMO_INDICADOR_MS): se espera a que pueda aparecer.
    await p.waitForTimeout(3500);
    assert.doesNotMatch(await p.locator('body').innerText(), /SECRETO-ANA/, 'el título de la tarea de Ana no aparece para Bea');
    assert.equal(await p.getByRole('button', { name: /Abrir el panel de tareas/ }).count(), 0, 'Bea no tiene tareas: no aparece el indicador con la de Ana');
  }
);

test(
  'en el navegador: una tarea «respondida» se pinta «Respondida · sin comprobar», nunca como completada (ronda 8)',
  { skip: saltoNavegador, timeout: 120000 },
  async (t) => {
    const { chromium } = await import('playwright');
    const ahoraIso = new Date().toISOString();
    const pedidas: string[] = [];
    const tarea = (id: string, state: string, title: string, extra: Record<string, unknown> = {}) => ({
      id,
      version: 1,
      state,
      terminal: state !== 'running',
      source: 'durable',
      title,
      objective: title,
      acceptance: [{ id: 'resultado', text: 'Tu computadora termina y lo entregado se comprueba', required: true, status: state === 'completed' ? 'verified' : state === 'running' ? 'pending' : 'unknown', evidenceIds: [] }],
      environment: { kind: 'computadora', id: 'mis_1', displayName: 'Tu computadora' },
      progress: null,
      decision: null,
      result: null,
      createdAt: ahoraIso,
      updatedAt: ahoraIso,
      controls: { pause: state === 'running', resume: false, cancel: state === 'running' },
      ...extra,
    });
    const resultado = (summary: string) => ({ id: 'r', summary, evidence: [], partial: [], pending: [], at: ahoraIso });
    const tipos: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.wasm': 'application/wasm' };
    const srv = http.createServer((req, res) => {
      const u = new URL(req.url || '/', 'http://x');
      const json = (o: unknown, s = 200) => (res.writeHead(s, { 'Content-Type': 'application/json' }), res.end(JSON.stringify(o)));
      if (u.pathname === '/api/health') return json({ qwen: { vivo: true } });
      if (u.pathname === '/api/nodo/listo') return json({ listo: true });
      if (u.pathname === '/api/genesis/config') return json({ disponible: false });
      if (u.pathname === '/api/ultron/sesion') return json({ authenticated: true, user: { nombre: 'Ana', rol: 'Junta', correo: 'ana@ejemplo.com' } });
      if (u.pathname === '/api/trabajos') {
        pedidas.push(u.search);
        // Como el servidor de verdad: sin `estados=respondida` (una app de antes), la respondida va como «partial».
        const nueva = u.searchParams.get('estados') === 'respondida';
        return json({
          tareas: [
            tarea('tarea-viva-1', 'running', 'Busca vuelos a Madrid', { currentStep: 'Buscando vuelos' }),
            tarea('tarea-resp-1', nueva ? 'respondida' : 'partial', 'Precio del oro de hoy', {
              ...(nueva ? {} : { estadoReal: 'respondida' }),
              result: resultado('Te respondí con lo que encontré. Si además pediste que hiciera algo, eso NO está comprobado: revisa antes de darlo por hecho. El oro cerró en 2,410 dólares.'),
            }),
            tarea('tarea-ok-1', 'completed', 'Crea informe.docx', { result: resultado('Lo comprobé: informe.docx (2048 bytes).') }),
          ],
        });
      }
      if (u.pathname.startsWith('/api/')) return json({}, 404);
      let f = path.join(DIST, decodeURIComponent(u.pathname));
      if (!f.startsWith(DIST) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) f = path.join(DIST, 'index.html');
      res.writeHead(200, { 'Content-Type': tipos[path.extname(f)] || 'application/octet-stream' });
      fs.createReadStream(f).pipe(res);
    });
    const url = await new Promise<string>((r) => srv.listen(0, '127.0.0.1', () => r(`http://127.0.0.1:${(srv.address() as any).port}`)));
    const b = await chromium.launch({ executablePath: CHROMIUM, args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
    t.after(async () => {
      await b.close();
      srv.close();
    });
    const p = await b.newPage({ viewport: { width: 1280, height: 800 } });
    await p.goto(url + '/', { waitUntil: 'networkidle' });
    await p.waitForSelector('#ultron-arranque[aria-hidden="true"]', { timeout: 20000 });
    await p.getByRole('button', { name: /Abrir el panel de tareas/ }).click({ timeout: 20000 });
    const resp = p.locator('#tarea-tarea-resp-1');
    await resp.waitFor({ timeout: 10000 });
    const texto = await resp.innerText();
    assert.match(texto, /Respondida · sin comprobar/);
    assert.doesNotMatch(texto, /Completada/);
    assert.match(texto, /NO está comprobado/);
    // El color de «completada» (verde) es solo de la completada de verdad.
    const claseResp = await resp.locator('article span.font-semibold').first().getAttribute('class');
    const claseOk = await p.locator('#tarea-tarea-ok-1 article span.font-semibold').first().getAttribute('class');
    assert.doesNotMatch(claseResp || '', /aura-ok-texto/);
    assert.match(claseOk || '', /aura-ok-texto/);
    assert.match(await p.locator('#tarea-tarea-ok-1').innerText(), /Completada/);
    // Va entre las recientes (terminada), no «En marcha».
    const recientes = await p.getByRole('region', { name: 'Recientes' }).innerText();
    assert.match(recientes, /Precio del oro de hoy/);
    assert.ok(pedidas.length > 0 && pedidas.every((q) => /estados=respondida/.test(q)), `la web pide los estados nuevos: ${pedidas.join(' ')}`);
  }
);

/* ------------------------------------------------- P4 / U1: correo, memoria del servidor e iniciativa en la web */

type Pedida = { metodo: string; ruta: string; cuerpo: any };
/**
 * Un servidor de prueba con sesión y las APIs de verdad que usa la web (las mismas que la app Expo): cuentas de
 * correo, la bandeja por cuenta, «lo que sé de ti» y las preferencias de avisos. Todo sintético, sin red de afuera.
 */
function servidorP4(o: { cuentas: Array<{ id: string; correo: string }>; caida?: string; conectarOk?: boolean }) {
  const pedidas: Pedida[] = [];
  const turnos: any[] = [];
  const cuentas = [...o.cuentas];
  let dato: any = { id: 'dato-1', categoria: 'rutinas', dato: 'Vive en Puerto Sintético', clave: 'vive', confianza: 1, fuente: 'manual', desde: Date.parse('2026-10-01T12:00:00Z'), visto: 0, veces: 1, origen: 'primeravez', alcance: 'general' };
  let prefs: any = { zona: 'America/Tegucigalpa', quietas: { desde: '21:00', hasta: '07:00' }, canales: ['app'], maxDia: 1, cadaDias: 1, urgentes: [], llamadaUrgente: false, clasesApagadas: [], temasSilenciados: [], luego: '2h', apagado: false };
  const tipos: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.wasm': 'application/wasm' };
  const srv = http.createServer((req, res) => {
    const u = new URL(req.url || '/', 'http://x');
    const json = (x: unknown, s = 200) => (res.writeHead(s, { 'Content-Type': 'application/json' }), res.end(JSON.stringify(x)));
    const leer = () =>
      new Promise<any>((r) => {
        let b = '';
        req.on('data', (c) => (b += c));
        req.on('end', () => {
          try {
            r(JSON.parse(b || '{}'));
          } catch {
            r({});
          }
        });
      });
    const metodo = req.method || 'GET';
    if (u.pathname === '/api/health') return json({ qwen: { vivo: true } });
    if (u.pathname === '/api/nodo/listo') return json({ listo: true });
    if (u.pathname === '/api/genesis/config') return json({ disponible: false });
    if (u.pathname === '/api/capacidades') return json({ capacidades: [] });
    if (u.pathname === '/api/ultron/sesion') return json({ authenticated: true, user: { nombre: 'Ana', rol: 'Junta', correo: 'ana@ejemplo.com' } });
    if (/^\/api\/(correo|cerebro|avisos|perfil)/.test(u.pathname) || u.pathname === '/api/turno/stream') {
      return void leer().then((cuerpo) => {
        pedidas.push({ metodo, ruta: u.pathname + u.search, cuerpo });
        if (u.pathname === '/api/correo/cuentas' && metodo === 'GET') return json({ cuentas: cuentas.map((c) => ({ ...c, proveedor: { nombre: 'Sintético', auth: 'clave' } })), microsoft: false, honesto: true });
        if (u.pathname === '/api/correo/detectar') return json({ proveedor: { nombre: 'Sintético', auth: 'clave', ayuda: 'Usa una contraseña de aplicación.', fuente: 'conocido', imap: { host: 'imap.prueba.invalid' }, smtp: { host: 'smtp.prueba.invalid' } }, honesto: true });
        if (u.pathname === '/api/correo/cuentas' && metodo === 'POST') {
          if (!o.conectarOk) return json({ error: 'imap.prueba.invalid no aceptó la clave.', honesto: true }, 400);
          const c = { id: `c${cuentas.length + 1}`, correo: String(cuerpo.correo || '') };
          cuentas.push(c);
          return json({ cuenta: { ...c, proveedor: { nombre: 'Sintético', auth: 'clave' } }, honesto: true });
        }
        if (u.pathname === '/api/correo/bandeja') {
          const c = cuentas.find((x) => x.id === u.searchParams.get('cuenta'));
          if (!c) return json({ error: 'Esa cuenta ya no está conectada.' }, 404);
          if (c.id === o.caida) return json({ mensajes: [], cuentas, errores: [{ cuentaId: c.id, cuenta: c.correo, error: 'imap.prueba.invalid no aceptó la clave.', tipo: 'auth', siguiente: 'reconectar', mensaje: `${c.correo} no aceptó la autorización (la clave cambió o caducó).` }], cobertura: [], honesto: true });
          return json({ mensajes: [], cuentas, errores: [], cobertura: [{ cuentaId: c.id, cuenta: c.correo, total: 12, revisados: 1 }], honesto: true });
        }
        if (u.pathname === '/api/cerebro/conocer' && metodo === 'GET') return json({ categorias: dato ? [{ id: 'rutinas', nombre: 'Rutinas', datos: [dato] }] : [], total: dato ? 1 : 0, faltan: [], honesto: true });
        if (u.pathname === '/api/cerebro/abiertos') return json({ abiertos: [], cerrados: [], honesto: true });
        if (u.pathname === '/api/cerebro/conocer/dato-1' && metodo === 'PATCH') {
          dato = { ...dato, ...(cuerpo.dato ? { dato: cuerpo.dato, corregido: Date.now() } : {}), ...(cuerpo.alcance ? { alcance: cuerpo.alcance } : {}) };
          return json({ dato, durable: true, honesto: true });
        }
        if (u.pathname === '/api/cerebro/conocer/olvidar') {
          dato = null;
          return json({ ok: true, borrados: 1, durable: true, honesto: true });
        }
        if (u.pathname === '/api/perfil' && metodo === 'PUT') return json({ perfil: {}, durable: true, honesto: true });
        if (u.pathname === '/api/avisos/preferencias' && metodo === 'GET') return json({ preferencias: prefs, honesto: true });
        if (u.pathname === '/api/avisos/preferencias' && metodo === 'POST') {
          prefs = { ...prefs, ...cuerpo };
          return json({ preferencias: prefs, cancelados: 0, retiradas: 0, honesto: true });
        }
        if (u.pathname === '/api/turno/stream') {
          turnos.push(cuerpo);
          const r = 'Listo, lo leí.';
          res.writeHead(200, { 'Content-Type': 'text/event-stream' });
          return res.end(`event: done\ndata: ${JSON.stringify({ reply: r, voz: r, emocion: 'neutral' })}\n\n`);
        }
        return json({}, 404);
      });
    }
    if (u.pathname.startsWith('/api/')) return json({}, 404);
    let f = path.join(DIST, decodeURIComponent(u.pathname));
    if (!f.startsWith(DIST) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) f = path.join(DIST, 'index.html');
    res.writeHead(200, { 'Content-Type': tipos[path.extname(f)] || 'application/octet-stream' });
    fs.createReadStream(f).pipe(res);
  });
  const url = new Promise<string>((r) => srv.listen(0, '127.0.0.1', () => r(`http://127.0.0.1:${(srv.address() as any).port}`)));
  return { url, pedidas, turnos, cerrar: () => srv.close() };
}

test(
  'en el navegador: Ajustes → Tu AURA: tus correos (con un proveedor caído), «Lo que sé de ti» y tus avisos; navegar y volver (P4/U1)',
  { skip: saltoNavegador, timeout: 120000 },
  async (t) => {
    const { chromium } = await import('playwright');
    const s = servidorP4({ cuentas: [{ id: 'c1', correo: 'casa@prueba.invalid' }, { id: 'c2', correo: 'trabajo@prueba.invalid' }], caida: 'c2' });
    const url = await s.url;
    // Sin WebGL (la sala 3D no hace falta para los paneles): menos carga y sin esperas atascadas en la GPU por software.
    const b = await chromium.launch({ executablePath: CHROMIUM, args: ['--disable-3d-apis'] });
    t.after(async () => {
      await b.close();
      s.cerrar();
    });
    const p = await b.newPage({ viewport: { width: 1280, height: 800 } });
    // Cada espera falla pronto y dice dónde (en vez de agotar el tiempo de toda la prueba).
    p.setDefaultTimeout(10000);
    await p.goto(url + '/', { waitUntil: 'networkidle' });
    await p.waitForSelector('#ultron-arranque[aria-hidden="true"]', { timeout: 20000 });

    // 1) Ajustes → Tu AURA: las tres entradas.
    await p.getByRole('button', { name: 'Ajustes', exact: true }).click();
    await p.getByRole('tab', { name: 'Tu AURA' }).click();
    const panel = p.locator('#aura-panel-aura');
    for (const n of ['Tus correos', 'Lo que sé de ti', 'Tus avisos']) await panel.getByRole('button', { name: new RegExp(n) }).waitFor({ timeout: 10000 });

    // 2) Tus correos: las dos cuentas; la caída dice qué pasó y qué hacer con ESA cuenta.
    await panel.getByRole('button', { name: /Tus correos/ }).click();
    await panel.getByRole('heading', { name: 'Tus correos' }).waitFor();
    const caida = panel.locator('[data-cuenta="c2"]');
    const sana = panel.locator('[data-cuenta="c1"]');
    await sana.getByText('casa@prueba.invalid', { exact: true }).waitFor();
    await caida.getByText('trabajo@prueba.invalid', { exact: true }).waitFor();
    await caida.getByText(/no aceptó la autorización/).waitFor({ timeout: 10000 });
    await caida.getByRole('button', { name: /Reconectar trabajo@prueba\.invalid/ }).waitFor();
    await sana.getByText(/Responde/).waitFor({ timeout: 10000 });
    assert.equal(await sana.getByText(/no aceptó/).count(), 0, 'la cuenta sana no hereda el error de la otra');
    // Reconectar ESA cuenta: el formulario viene con su dirección.
    await caida.getByRole('button', { name: /Reconectar trabajo@prueba\.invalid/ }).click();
    assert.equal(await panel.getByLabel('Tu dirección de correo').inputValue(), 'trabajo@prueba.invalid');
    // Volver.
    await panel.getByRole('button', { name: /Volver/ }).click();
    await panel.getByRole('button', { name: /Lo que sé de ti/ }).waitFor();

    // 3) Lo que sé de ti (memoria del SERVIDOR): ver, «No usarlo», corregir y olvidar.
    await panel.getByRole('button', { name: /Lo que sé de ti/ }).click();
    await panel.getByRole('heading', { name: 'Lo que sé de ti' }).waitFor();
    await panel.getByText('Vive en Puerto Sintético').waitFor({ timeout: 10000 });
    await panel.getByRole('button', { name: 'No usarlo' }).click();
    await panel.getByText(/No lo uso hasta que me lo pidas/).waitFor();
    assert.ok(s.pedidas.some((x) => x.metodo === 'PATCH' && x.ruta === '/api/cerebro/conocer/dato-1' && x.cuerpo.alcance === 'limitado'), 'No usarlo va al servidor');
    await panel.getByRole('button', { name: 'Usarlo' }).waitFor();
    await panel.getByRole('button', { name: 'Corregir' }).click();
    await panel.getByLabel('Corregido').fill('Vive en Villa Sintética');
    await panel.getByRole('button', { name: 'Guardar' }).click();
    await panel.getByText('Vive en Villa Sintética').waitFor();
    assert.ok(s.pedidas.some((x) => x.metodo === 'PATCH' && x.cuerpo.dato === 'Vive en Villa Sintética'));
    await panel.getByRole('button', { name: /Olvidar: Vive en Villa Sintética/ }).click();
    await panel.getByRole('button', { name: 'Olvidarlo' }).click();
    await p.waitForFunction(() => !document.body.innerText.includes('Vive en Villa Sintética'), null, { timeout: 10000 });
    const olvido = s.pedidas.find((x) => x.ruta === '/api/cerebro/conocer/olvidar');
    assert.deepEqual(olvido?.cuerpo, { ids: ['dato-1'], claves: [{ categoria: 'rutinas', clave: 'vive' }] }, 'olvida en el servidor, por id y por clave común');
    assert.ok(s.pedidas.some((x) => x.metodo === 'PUT' && x.ruta === '/api/perfil' && x.cuerpo?.encuesta?.vive === ''), 'y la respuesta del perfil que lo repetía');
    // No se reemplaza por «borrar memoria local».
    assert.equal(await panel.getByRole('button', { name: /memoria local/ }).count(), 0);
    await panel.getByRole('button', { name: /Volver/ }).click();

    // 4) Tus avisos: leer y cambiar en el servidor.
    await panel.getByRole('button', { name: /Tus avisos/ }).click();
    await panel.getByRole('heading', { name: 'Tus avisos' }).waitFor();
    const avisarme = panel.getByRole('switch', { name: /Avisarme/ });
    await avisarme.waitFor({ timeout: 10000 });
    assert.equal(await avisarme.getAttribute('aria-checked'), 'true');
    await avisarme.click();
    await p.waitForFunction(() => document.querySelector('#aura-panel-aura [role="switch"]')?.getAttribute('aria-checked') === 'false', null, { timeout: 10000 });
    assert.ok(s.pedidas.some((x) => x.metodo === 'POST' && x.ruta === '/api/avisos/preferencias' && x.cuerpo.apagado === true));
    await panel.getByRole('button', { name: /Volver/ }).click();
    await panel.getByRole('button', { name: /Tus correos/ }).waitFor();
    await p.keyboard.press('Escape');
    await p.waitForFunction(() => !document.querySelector('[role="dialog"]'));

    // 5) Desde «Más»: abre Ajustes directo en «Tus correos».
    // Como «Escribir» en las otras pruebas: el dock se anima, así que se enfoca y se pulsa Enter.
    await p.locator('button[aria-label="Más opciones"]:visible').first().focus();
    await p.keyboard.press('Enter');
    await p.getByRole('button', { name: /Tus correos/ }).click();
    await p.locator('#aura-panel-aura').getByRole('heading', { name: 'Tus correos' }).waitFor({ timeout: 10000 });
    await p.keyboard.press('Escape');
  }
);

test(
  'en el navegador: pedir leer el correo sin cuenta → conectar, pegar u omitir, y retomar el MISMO pedido (P4)',
  { skip: saltoNavegador, timeout: 120000 },
  async (t) => {
    const { chromium } = await import('playwright');
    const s = servidorP4({ cuentas: [], conectarOk: true });
    const url = await s.url;
    // Sin WebGL (la sala 3D no hace falta para los paneles): menos carga y sin esperas atascadas en la GPU por software.
    const b = await chromium.launch({ executablePath: CHROMIUM, args: ['--disable-3d-apis'] });
    t.after(async () => {
      await b.close();
      s.cerrar();
    });
    const p = await b.newPage({ viewport: { width: 1280, height: 800 } });
    await p.goto(url + '/', { waitUntil: 'networkidle' });
    await p.waitForSelector('#ultron-arranque[aria-hidden="true"]', { timeout: 20000 });
    const escribir = async (texto: string) => {
      if (!(await p.locator('#dock-cmd-input').count())) {
        await p.getByRole('button', { name: 'Escribir', exact: true }).focus();
        await p.keyboard.press('Enter');
        await p.waitForSelector('#dock-cmd-input');
      }
      await p.locator('#dock-cmd-input').fill(texto);
      await p.locator('#dock-cmd-input').press('Enter');
    };
    const aviso = p.locator('[role="dialog"][aria-labelledby="aura-sin-correo-titulo"]');
    const esperarTurnos = async (n: number) => {
      for (let i = 0; i < 75 && s.turnos.length < n; i++) await p.waitForTimeout(200);
    };

    // a) Omitir: no se manda nada al cerebro y no queda colgado.
    await escribir('Léeme mi correo');
    await aviso.waitFor({ timeout: 10000 });
    for (const n of [/Conectar un correo/, /Pegar el contenido/, /Omitir/]) await aviso.getByRole('button', { name: n }).waitFor();
    await aviso.getByRole('button', { name: /Omitir/ }).click();
    await p.waitForFunction(() => !document.querySelector('[aria-labelledby="aura-sin-correo-titulo"]'));
    await p.waitForTimeout(500);
    assert.equal(s.turnos.length, 0, 'omitir no manda el pedido sin correo');

    // b) Pegar el contenido: sigue el MISMO pedido, con lo pegado.
    await escribir('Léeme mi correo');
    await aviso.waitFor({ timeout: 10000 });
    await aviso.getByRole('button', { name: /Pegar el contenido/ }).click();
    await aviso.getByLabel(/Contenido del correo/).fill('De: Ana Sintética. Asunto: planos. Nos vemos el lunes.');
    await aviso.getByRole('button', { name: /Seguir con lo pegado/ }).click();
    await esperarTurnos(1);
    assert.equal(s.turnos.length, 1);
    assert.match(s.turnos[0].message, /^Léeme mi correo/);
    assert.match(s.turnos[0].message, /Nos vemos el lunes/);

    // c) Conectar: lleva a Ajustes → Tus correos (que SÍ existe), conecta y retoma el mismo pedido.
    await escribir('Revisa mi correo de hoy');
    await aviso.waitFor({ timeout: 10000 });
    await aviso.getByRole('button', { name: /Conectar un correo/ }).click();
    const panel = p.locator('#aura-panel-aura');
    await panel.getByRole('heading', { name: 'Tus correos' }).waitFor({ timeout: 10000 });
    await panel.getByLabel('Tu dirección de correo').fill('nuevo@prueba.invalid');
    await panel.getByRole('button', { name: 'Continuar' }).click();
    await panel.getByLabel(/Clave/).fill('clave-sintetica');
    await panel.getByRole('button', { name: 'Conectar', exact: true }).click();
    await panel.getByText('nuevo@prueba.invalid', { exact: true }).waitFor({ timeout: 10000 });
    const retomar = panel.getByRole('button', { name: /Retomar/ });
    await retomar.waitFor();
    await retomar.click();
    await p.waitForFunction(() => !document.querySelector('[role="dialog"]'), null, { timeout: 10000 });
    await esperarTurnos(2);
    assert.equal(s.turnos.length, 2, 'retomó el pedido');
    assert.equal(s.turnos[1].message, 'Revisa mi correo de hoy', 'el MISMO pedido, tal cual');
  }
);
