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

/**
 * LA PUERTA NO SE SALTA POR EL CORREO (revisión 9, GRAVE-1). Antes, si el pedido mencionaba leer el correo y había
 * alguna cuenta, iba directo al cerebro sin pasar por la tarjeta «Confirmar»; el taller del servidor ejecuta lo que
 * reconoce, así que «revisa mi correo y mándame un resumen por Telegram» salía sin confirmar. Sin cuentas, en vez de la
 * tarjeta salía el aviso «sin correo», y «Retomar» o «Pegar» lo mandaban también sin ella.
 */
const FRASES_QUE_SALEN = [
  'Revisa mi correo y mándame un resumen por Telegram',
  'Avísame urgente si hay correo nuevo de Ana',
  'Llámame si hay correos nuevos',
  'Lee mi correo y mandame lo importante por whatsapp',
];
for (const conCuentas of [true, false]) {
  test(
    `en el navegador: leer el correo + mandar/avisar/llamar → la tarjeta Confirmar primero y nada al cerebro (${conCuentas ? 'con' : 'sin'} cuentas de correo; revisión 9)`,
    { skip: saltoNavegador, timeout: 180000 },
    async (t) => {
      const { chromium } = await import('playwright');
      const s = servidorP4({ cuentas: conCuentas ? [{ id: 'c1', correo: 'casa@prueba.invalid' }] : [] });
      const url = await s.url;
      const b = await chromium.launch({ executablePath: CHROMIUM, args: ['--disable-3d-apis'] });
      t.after(async () => {
        await b.close();
        s.cerrar();
      });
      const p = await b.newPage({ viewport: { width: 1280, height: 800 } });
      p.setDefaultTimeout(10000);
      await p.goto(url + '/', { waitUntil: 'networkidle' });
      await p.waitForSelector('#ultron-arranque[aria-hidden="true"]', { timeout: 20000 });
      const escribir = async (texto: string) => {
        // En «trabajar» (donde vive la tarjeta) el campo es el de la superficie; si no, el de Escribir.
        let campo = p.locator('#aura-trabajo-campo');
        if (!(await campo.count())) {
          if (!(await p.locator('#dock-cmd-input').count())) {
            await p.getByRole('button', { name: 'Escribir', exact: true }).focus();
            await p.keyboard.press('Enter');
            await p.waitForSelector('#dock-cmd-input');
          }
          campo = p.locator('#dock-cmd-input');
        }
        await campo.fill(texto);
        await campo.press('Enter');
      };
      const tarjetas = p.locator('article', { hasText: 'Acción que sale del sistema' });
      const aviso = p.locator('[role="dialog"][aria-labelledby="aura-sin-correo-titulo"]');

      for (const [i, frase] of FRASES_QUE_SALEN.entries()) {
        await escribir(frase);
        await p.waitForFunction((n) => document.querySelectorAll('article').length > 0 && [...document.querySelectorAll('article')].filter((a) => a.textContent?.includes('Acción que sale del sistema')).length >= n, i + 1, { timeout: 10000 }).catch(() => {});
        // Lo que viniera por el camino del correo (contar cuentas, el turno) tiene tiempo de llegar.
        await p.waitForTimeout(700);
        assert.equal(s.turnos.length, 0, `«${frase}»: nada salió al cerebro antes de confirmar (salió: ${s.turnos.map((x) => x.message).join(' | ')})`);
        assert.equal(await aviso.count(), 0, `«${frase}»: no pasa por el aviso sin correo`);
        assert.equal(await tarjetas.count(), i + 1, `«${frase}»: aparece la tarjeta Confirmar`);
      }
      const ultima = tarjetas.last();
      assert.match(await ultima.innerText(), /WhatsApp/, 'la tarjeta dice por dónde sale');

      // Confirmar sí lo manda (una vez, el mismo pedido).
      await ultima.getByRole('button', { name: /Confirmar y enviar/ }).click();
      for (let k = 0; k < 50 && s.turnos.length < 1; k++) await p.waitForTimeout(200);
      assert.equal(s.turnos.length, 1, 'confirmado, sale');
      assert.equal(s.turnos[0].message, FRASES_QUE_SALEN[3]);

      // Control: leer el correo a secas sigue el camino del correo, sin tarjeta.
      await escribir('Revisa mi correo de hoy');
      if (conCuentas) {
        for (let k = 0; k < 50 && s.turnos.length < 2; k++) await p.waitForTimeout(200);
        assert.equal(s.turnos.length, 2, 'con cuentas, leer el correo va al cerebro');
        assert.equal(s.turnos[1].message, 'Revisa mi correo de hoy');
      } else {
        await aviso.waitFor({ timeout: 10000 });
        assert.equal(s.turnos.length, 1, 'sin cuentas, ofrece conectar (no manda nada)');
        await aviso.getByRole('button', { name: /Omitir/ }).click();
      }
      assert.ok(s.pedidas.some((x) => x.ruta === '/api/correo/cuentas'), 'el control sí preguntó por las cuentas');
      assert.equal(await tarjetas.count(), FRASES_QUE_SALEN.length, 'leer el correo a secas no propone ninguna tarjeta');
    }
  );
}

test(
  'en el navegador: «Retomar» tras conectar un correo y «Pegar el contenido» también pasan por la tarjeta (revisión 9)',
  { skip: saltoNavegador, timeout: 180000 },
  async (t) => {
    const { chromium } = await import('playwright');
    const s = servidorP4({ cuentas: [], conectarOk: true });
    const url = await s.url;
    const b = await chromium.launch({ executablePath: CHROMIUM, args: ['--disable-3d-apis'] });
    t.after(async () => {
      await b.close();
      s.cerrar();
    });
    const p = await b.newPage({ viewport: { width: 1280, height: 800 } });
    p.setDefaultTimeout(10000);
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
    const tarjetas = p.locator('article', { hasText: 'Acción que sale del sistema' });

    // a) Lo pegado trae «llámame»: el pedido compuesto sale del sistema → tarjeta, no turno.
    await escribir('Léeme mi correo');
    await aviso.waitFor({ timeout: 10000 });
    await aviso.getByRole('button', { name: /Pegar el contenido/ }).click();
    await aviso.getByLabel(/Contenido del correo/).fill('Llámame urgente cuando leas esto.');
    await aviso.getByRole('button', { name: /Seguir con lo pegado/ }).click();
    await tarjetas.first().waitFor({ timeout: 10000 });
    await p.waitForTimeout(700);
    assert.equal(s.turnos.length, 0, 'lo pegado que pide avisar no sale sin confirmar');

    // b) «Retomar» tras conectar: el mismo pedido, por la puerta. Uno que sale del sistema ya no llega al aviso (la
    //    tarjeta va antes, arriba); aquí, uno que no sale: va al cerebro, sin tarjeta.
    await p.keyboard.press('Escape').catch(() => {});
    const campo = (await p.locator('#aura-trabajo-campo').count()) ? p.locator('#aura-trabajo-campo') : p.locator('#dock-cmd-input');
    await campo.fill('Revisa mi correo de hoy');
    await campo.press('Enter');
    await aviso.waitFor({ timeout: 10000 });
    await aviso.getByRole('button', { name: /Conectar un correo/ }).click();
    const panel = p.locator('#aura-panel-aura');
    await panel.getByRole('heading', { name: 'Tus correos' }).waitFor({ timeout: 10000 });
    await panel.getByLabel('Tu dirección de correo').fill('nuevo@prueba.invalid');
    await panel.getByRole('button', { name: 'Continuar' }).click();
    await panel.getByLabel(/Clave/).fill('clave-sintetica');
    await panel.getByRole('button', { name: 'Conectar', exact: true }).click();
    await panel.getByRole('button', { name: /Retomar/ }).click();
    for (let k = 0; k < 50 && s.turnos.length < 1; k++) await p.waitForTimeout(200);
    assert.equal(s.turnos.length, 1, 'retomado, sale');
    assert.equal(s.turnos[0].message, 'Revisa mi correo de hoy');
    assert.equal(await tarjetas.count(), 1, 'sin tarjeta nueva para leer a secas');
  }
);

test('escritorio web: si la cuenta cambia mientras se busca la tarea, el visor de la anterior no se abre (revisión 9)', async () => {
  // El estado del visor por VisorEscritorio (el mismo módulo que lo abre; importado por otro camino, tsx podría cargar
  // otra copia del estado de mobile/).
  const V = await import('../src/13-trabajo/VisorEscritorio');
  const { abrirEscritorio } = V;
  const fetchAntes = globalThis.fetch;
  const respuesta = () => new Response(JSON.stringify({ mision: { tareaId: 'tarea-de-ana' } }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  try {
    V.olvidarVisor();
    let soltar: () => void = () => {};
    globalThis.fetch = (() => new Promise<Response>((r) => (soltar = () => r(respuesta())))) as typeof fetch;
    const abriendo = abrirEscritorio('mis_ana');
    await new Promise((r) => setTimeout(r, 10));
    // Lo que hace App.tsx cuando cambia la cuenta (salió A, entró B).
    V.olvidarVisor();
    soltar();
    await abriendo;
    assert.deepEqual(V.visorAhora(), { abierto: false, tareaId: null }, 'la búsqueda de A no abre su visor con B dentro');
    // Control: sin cambio de cuenta, abre.
    globalThis.fetch = (async () => respuesta()) as typeof fetch;
    assert.equal(await abrirEscritorio('mis_ana'), null);
    assert.deepEqual(V.visorAhora(), { abierto: true, tareaId: 'tarea-de-ana' });
  } finally {
    globalThis.fetch = fetchAntes;
    V.olvidarVisor();
  }
});

/* ------------------------------------------------- el escritorio de su computadora en la web (U1, auditoría del 4-oct) */

test('escritorio web: teclas físicas de la lista blanca, la rueda en pasos y qué tarea de la computadora se abre', async () => {
  const { teclaDeEvento, pasosRueda, tareaDelEscritorio } = await import('../src/13-trabajo/escritorio');
  assert.deepEqual(teclaDeEvento({ key: 'Enter' }), { tecla: 'enter', mods: [] });
  assert.deepEqual(teclaDeEvento({ key: 'Tab', shiftKey: true }), { tecla: 'tab', mods: ['shift'] });
  assert.deepEqual(teclaDeEvento({ key: 'c', ctrlKey: true }), { tecla: 'c', mods: ['ctrl'] });
  assert.equal(teclaDeEvento({ key: 'q', ctrlKey: true }), null, 'Ctrl+Q no está en la lista');
  assert.equal(teclaDeEvento({ key: 'a' }), null, 'el texto no va tecla por tecla: sale compuesto por el campo');
  assert.equal(teclaDeEvento({ key: 'Enter', isComposing: true }), null, 'durante la composición del IME, el Enter es del IME');
  assert.equal(teclaDeEvento({ key: 'l', metaKey: true }), null);
  assert.equal(pasosRueda(100), 1);
  assert.equal(pasosRueda(-320), -3);
  assert.equal(pasosRueda(3, 1), 1, 'en líneas');
  assert.equal(pasosRueda(99999), 10);
  assert.equal(pasosRueda(0), 0);
  const pedidas: string[] = [];
  const pedir = (async (ruta: string) => {
    pedidas.push(ruta);
    if (ruta === '/api/computadora/misiones/mis_9') return { mision: { tareaId: 'tarea-9b' } };
    if (ruta.startsWith('/api/computadora/misiones/')) throw Object.assign(new Error('no'), { status: 404 });
    if (ruta === '/api/computadora') return { actual: { id: 'tarea-actual' } };
    throw new Error('ruta inesperada');
  }) as any;
  assert.equal(await tareaDelEscritorio('mis_9', pedir), 'tarea-9b', 'una misión da su tarea de ahora');
  assert.equal(await tareaDelEscritorio('tarea-7', pedir), 'tarea-7', 'si no es una misión, es la tarea');
  assert.equal(await tareaDelEscritorio('pendiente', pedir), 'tarea-actual', 'sin id todavía: la actual');
  await assert.rejects(tareaDelEscritorio('tarea-7', (async () => Promise.reject(Object.assign(new Error('sin red'), { status: undefined }))) as any));
});

test(
  'en el navegador: abrir el escritorio desde la tarea, tomar el control, escribir «café ☕» + Enter (llega una vez y en orden), ratón, rueda, devolver el control y volver al chat sin cancelar',
  { skip: saltoNavegador, timeout: 120000 },
  async (t) => {
    const { chromium } = await import('playwright');
    const ahoraIso = new Date().toISOString();
    const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
    // El nodo simulado: estado del control, época, frames y lo que de verdad aplicó.
    const nodo = { estado: 'trabajando' as string, epoca: 3, seq: 40, entradas: [] as any[], control: [] as any[], parar: 0 };
    const tipos: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.wasm': 'application/wasm' };
    const srv = http.createServer((req, res) => {
      const u = new URL(req.url || '/', 'http://x');
      const json = (o: unknown, s = 200) => (res.writeHead(s, { 'Content-Type': 'application/json' }), res.end(JSON.stringify(o)));
      const leer = () => new Promise<any>((r) => { let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => r(JSON.parse(b || '{}'))); });
      if (u.pathname === '/api/health') return json({ qwen: { vivo: true } });
      if (u.pathname === '/api/nodo/listo') return json({ listo: true });
      if (u.pathname === '/api/genesis/config') return json({ disponible: false });
      if (u.pathname === '/api/ultron/sesion') return json({ authenticated: true, user: { nombre: 'Ana', rol: 'Junta', correo: 'ana@ejemplo.com' } });
      if (u.pathname === '/api/trabajos')
        return json({
          tareas: [
            {
              id: 'tarea-pc-1',
              version: 1,
              state: 'running',
              terminal: false,
              source: 'computadora',
              title: 'Rellena el formulario sintético',
              objective: 'Rellena el formulario sintético',
              acceptance: [],
              environment: { kind: 'computadora', id: 'tarea-pc-1', displayName: 'Tu computadora' },
              progress: null,
              decision: null,
              result: null,
              createdAt: ahoraIso,
              updatedAt: ahoraIso,
              controls: { pause: false, resume: false, cancel: false, open: 'computadora' },
            },
          ],
        });
      if (u.pathname.startsWith('/api/computadora/misiones/')) return json({ error: 'no' }, 404);
      if (u.pathname === '/api/computadora')
        return json({ configurada: true, ok: true, motores: [], ocupada: true, ultima: null, actual: { id: 'tarea-pc-1', estado: nodo.estado, pasos: 1, instruccion: 'Rellena el formulario sintético', ultimo: null }, capacidades: ['pausar', 'confirmar', 'control', 'entrada', 'seguro'] });
      if (u.pathname === '/api/computadora/tareas/tarea-pc-1')
        return json({ tarea: { id: 'tarea-pc-1', instruccion: 'Rellena el formulario sintético', estado: nodo.estado, pasos: [], respuesta: null, error: null, segundos: 5, epoca: nodo.epoca, seguro: false } });
      if (u.pathname === '/api/computadora/tareas/tarea-pc-1/pantalla')
        // La imagen llega con retraso (500 ms): el Enter tiene que esperarla, no rechazarse ni perderse.
        return void setTimeout(() => json({ imagen: PNG, frame: { seq: ++nodo.seq, ts: Date.now(), ancho: 1280, alto: 800, viewportRevision: 0, epoca: nodo.epoca, privado: false, edadMs: 0 } }), 500);
      if (u.pathname === '/api/computadora/tareas/tarea-pc-1/control')
        return void leer().then((b) => {
          nodo.control.push(b);
          if (b.tomar) {
            nodo.estado = 'control';
            nodo.epoca += 1;
            return json({ ok: true, epoca: nodo.epoca, fase: null, honesto: true });
          }
          nodo.estado = 'trabajando';
          return json({ ok: true, honesto: true });
        });
      if (u.pathname === '/api/computadora/tareas/tarea-pc-1/entrada')
        return void leer().then((b) => {
          if (nodo.estado !== 'control' || b.controlEpoch !== nodo.epoca) return json({ error: 'Otro dispositivo tiene el control ahora.', code: 'cliente' }, 409);
          nodo.entradas.push(b);
          return json({ ok: true, ack: { secuencia: b.inputSequence, estado: 'aplicada', ts: Date.now(), frame_seq: nodo.seq, epoca: nodo.epoca }, honesto: true });
        });
      if (u.pathname === '/api/computadora/tareas/tarea-pc-1/parar') {
        nodo.parar++;
        return json({ ok: true });
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
    const modo = () => p.locator('#aura-escritorio [data-modo]').getAttribute('data-modo');
    const teclado = () => nodo.entradas.filter((e) => e.type !== 'release_all');

    // 1) Desde la tarea de su computadora, «Abrir el escritorio».
    await p.getByRole('button', { name: /Abrir el panel de tareas/ }).click({ timeout: 20000 });
    await p.getByRole('button', { name: /Abrir el escritorio/ }).click();
    await p.waitForSelector('#aura-escritorio[role="dialog"][aria-modal="true"]', { timeout: 10000 });
    await p.waitForFunction(() => document.querySelector('#aura-escritorio [data-modo]')?.getAttribute('data-modo') === 'aura', null, { timeout: 10000 });
    assert.equal(await p.evaluate(() => document.fullscreenElement), null, 'no es el fullscreen de toda la app');
    assert.equal(await p.locator('#aura-escritorio iframe').count(), 0, 'ni un iframe');
    assert.equal(await p.evaluate(() => document.getElementById('aura-contenido')?.hasAttribute('inert')), true, 'lo de detrás queda inert');
    await p.waitForSelector('#aura-escritorio [data-escritorio] img', { timeout: 10000 });

    // 2) Tomar el control.
    await p.getByRole('button', { name: 'Tomar el control', exact: true }).click();
    await p.waitForFunction(() => document.querySelector('#aura-escritorio [data-modo]')?.getAttribute('data-modo') === 'tu', null, { timeout: 10000 });
    assert.equal(nodo.control.at(-1).tomar, true);
    assert.match(String(nodo.control.at(-1).clientId), /^visor-/);

    // 3) Escribir con el campo (IME: sale el texto compuesto) y Enter: llega el texto y DESPUÉS el Enter, una vez cada uno.
    const campo = p.locator('#aura-escritorio-campo');
    await campo.waitFor({ timeout: 10000 });
    await campo.fill('café ☕');
    await campo.press('Enter');
    await p.waitForFunction(() => (document.getElementById('aura-escritorio-campo') as HTMLInputElement | null)?.value === '', null, { timeout: 10000 });
    assert.deepEqual(
      teclado().map((e) => [e.type, e.payload]),
      [
        ['text_commit', { texto: 'café ☕' }],
        ['key', { tecla: 'enter', mods: [] }],
      ],
      'texto y Enter, en orden, una sola vez'
    );
    assert.ok(teclado().every((e) => e.controlEpoch === nodo.epoca && e.remoteSessionId === 'tarea-pc-1'));
    const seqs = nodo.entradas.map((e) => e.inputSequence);
    assert.deepEqual(seqs, [...new Set(seqs)].sort((a, b) => a - b), 'secuencias crecientes y sin repetir');

    // 4) Ratón: un clic sobre el escritorio llega como clic en un píxel lógico (1280×800); la rueda baja la página.
    const caja = (await p.locator('#aura-escritorio [data-escritorio]').boundingBox())!;
    // El clic es riesgoso: sobre una imagen que no es de después del Enter el visor lo rechaza («Espera la imagen de
    // ahora») en vez de mandarlo. Como una persona, se vuelve a tocar cuando llega la imagen (con la máquina cargada
    // puede tardar más de una vuelta).
    for (let intento = 0; intento < 6 && !nodo.entradas.some((e) => e.type === 'pointer'); intento++) {
      await p.waitForTimeout(900);
      await p.mouse.click(caja.x + caja.width / 2, caja.y + caja.height / 2);
      await new Promise<void>((r) => {
        const fin = Date.now() + 1500;
        const mirar = () => (nodo.entradas.some((e) => e.type === 'pointer') || Date.now() > fin ? r() : setTimeout(mirar, 50));
        mirar();
      });
    }
    assert.equal(nodo.entradas.filter((e) => e.type === 'pointer').length, 1, 'un solo clic llegó (los rechazados no salen)');
    const clic = nodo.entradas.find((e) => e.type === 'pointer');
    assert.ok(clic, 'el clic llegó al nodo');
    assert.equal(clic.payload.accion, 'click');
    assert.ok(clic.payload.x >= 0 && clic.payload.x < 1280 && clic.payload.y >= 0 && clic.payload.y < 800, `en píxeles lógicos: ${clic.payload.x},${clic.payload.y}`);
    await p.mouse.wheel(0, 300);
    await new Promise<void>((r) => {
      const fin = Date.now() + 5000;
      const mirar = () => (nodo.entradas.some((e) => e.type === 'scroll') || Date.now() > fin ? r() : setTimeout(mirar, 50));
      mirar();
    });
    const rueda = nodo.entradas.find((e) => e.type === 'scroll');
    assert.ok(rueda, 'la rueda llegó como scroll');
    assert.equal(rueda.payload.dy, 3);
    // Con el escritorio enfocado, una tecla especial del teclado físico va a la computadora (Tab no sale del visor).
    await p.locator('#aura-escritorio [data-escritorio]').focus();
    await p.keyboard.press('Tab');
    await new Promise<void>((r) => {
      const fin = Date.now() + 5000;
      const mirar = () => (nodo.entradas.some((e) => e.type === 'key' && e.payload.tecla === 'tab') || Date.now() > fin ? r() : setTimeout(mirar, 50));
      mirar();
    });
    assert.ok(nodo.entradas.some((e) => e.type === 'key' && e.payload.tecla === 'tab'), 'Tab llegó al nodo');
    assert.equal(teclado().filter((e) => e.type === 'key' && e.payload.tecla === 'enter').length, 1, 'el Enter sigue siendo uno');

    // 5) Devolver el control: se suelta todo allá y AURA vuelve a controlar.
    await p.getByRole('button', { name: 'Devolver el control a AURA' }).click();
    await p.waitForFunction(() => document.querySelector('#aura-escritorio [data-modo]')?.getAttribute('data-modo') === 'aura', null, { timeout: 10000 });
    assert.equal(nodo.control.at(-1).tomar, false);
    assert.ok(nodo.entradas.some((e) => e.type === 'release_all'), 'release_all antes de devolver');

    // 6) Volver al chat: el visor se va, la tarea sigue (nada de parar) y la mesa vuelve a ser usable.
    await p.getByRole('button', { name: /Volver al chat/ }).first().click();
    await p.waitForFunction(() => !document.getElementById('aura-escritorio'), null, { timeout: 5000 });
    assert.equal(nodo.parar, 0, 'cerrar la vista no cancela la tarea');
    assert.equal(await p.evaluate(() => document.getElementById('aura-contenido')?.hasAttribute('inert')), false);
    // (como las demás pruebas: con el teclado; un aviso flotante de la mesa puede tapar el botón al ratón)
    await p.getByRole('button', { name: 'Escribir', exact: true }).focus();
    await p.keyboard.press('Enter');
    await p.waitForSelector('#dock-cmd-input', { timeout: 5000 });
  }
);
