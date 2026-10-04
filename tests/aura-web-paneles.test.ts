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
  assert.equal((html.match(/role="tab"/g) || []).length, 4);
  assert.equal((html.match(/aria-selected="true"/g) || []).length, 1);
  assert.match(html, /role="tabpanel"/);
  for (const t of ['Preferencias', 'Voz', 'Privacidad y datos', 'Diagnóstico']) assert.ok(html.includes(t), t);
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
  { skip: !CHROMIUM ? 'sin Chromium de Playwright (AURA_CHROMIUM o /opt/pw-browsers)' : !hayDist ? 'sin dist/: correr la compilación antes' : false, timeout: 120000 },
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
  { skip: !CHROMIUM ? 'sin Chromium de Playwright (AURA_CHROMIUM o /opt/pw-browsers)' : !hayDist ? 'sin dist/: correr la compilación antes' : false, timeout: 120000 },
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
  { skip: !CHROMIUM ? 'sin Chromium de Playwright (AURA_CHROMIUM o /opt/pw-browsers)' : !hayDist ? 'sin dist/: correr la compilación antes' : false, timeout: 120000 },
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
