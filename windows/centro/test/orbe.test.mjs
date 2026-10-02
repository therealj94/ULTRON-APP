/**
 * LA CARA DE AU-RA EN WINDOWS: el orbe de partículas (src/14-orbe/orbe.html, aprobado por José).
 *
 * La fuente de verdad es una sola: el Centro la copia al armarse (build.mjs → avatar/orbe.html) y el notch la publica
 * desde el .csproj (OrbeAssets/orbe.html). Aquí: que la copia armada sea idéntica, que el notch la enlace, que el
 * Centro la pida sin voz propia y con los efectos de Ajustes, y que la página siga hablando el idioma que usan los dos
 * (las pruebas de C# miran lo mismo desde el lado del notch).
 */
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { armar, CENTRO, RAIZ } from './ayudas.mjs';

const FUENTE = join(RAIZ, 'src', '14-orbe', 'orbe.html');
const ARMADO = join(CENTRO, '..', 'src', 'Aura.Windows', 'CentroAssets', 'avatar', 'orbe.html');
let A; // avatar3d.ts
let html;

before(async () => {
  A = await armar(join(CENTRO, 'src', 'avatar3d.ts'));
  html = readFileSync(FUENTE, 'utf8');
});

test('el Centro arma su copia del orbe desde la fuente de verdad, idéntica', (t) => {
  const build = readFileSync(join(CENTRO, 'build.mjs'), 'utf8');
  assert.match(build, /join\(aqui, '\.\.', '\.\.', 'src', '14-orbe', 'orbe\.html'\)/, 'build.mjs copia src/14-orbe/orbe.html');
  assert.match(build, /cpSync\(orbe, join\(salida, 'avatar', 'orbe\.html'\)\)/);
  assert.match(build, /throw new Error\('Falta el orbe de AU-RA/, 'sin el orbe, el Centro no se arma (nunca a medias)');
  // AU-RA ya no viaja como modelo 3D.
  assert.doesNotMatch(build, /\['aura', 'claudio', 'antonio'\]/);
  if (!existsSync(ARMADO)) { t.skip('el Centro no está armado (node build.mjs)'); return; }
  assert.ok(readFileSync(ARMADO).equals(readFileSync(FUENTE)), 'CentroAssets/avatar/orbe.html es byte a byte src/14-orbe/orbe.html');
});

test('el notch publica la misma fuente (enlace en el .csproj, sin copia que se desfase)', () => {
  const csproj = readFileSync(join(CENTRO, '..', 'src', 'Aura.Windows', 'Aura.Windows.csproj'), 'utf8');
  assert.ok(csproj.includes('Include="../../../src/14-orbe/orbe.html" Link="OrbeAssets/orbe.html"'));
  assert.ok(!existsSync(join(CENTRO, '..', 'src', 'Aura.Windows', 'OrbeAssets', 'orbe.html')), 'ninguna copia suelta en windows/');
});

test('el Centro pide el orbe sin panel de prueba, sin voz propia y con los efectos de Ajustes', () => {
  assert.equal(A.urlOrbe(true), 'avatar/orbe.html?clean&tts=0&silent');
  assert.equal(A.urlOrbe(false), 'avatar/orbe.html?clean&tts=0&silent&sfx=0');
});

test('la página sigue hablando el idioma del Centro y del notch', () => {
  for (const pieza of [
    // opciones por la dirección (Centro) y antes de cargar (notch)
    "params.has('clean') || !!OPC.clean", "params.get('tts') !== '0'", "params.get('sfx') !== '0'", 'OPC.sfx !== false', 'OPC.tts !== false',
    "!params.has('silent')",
    // lo que se le manda
    "case 'estado': setState(d.face", "case 'boca': setLevel(", "case 'decir': say(d.texto", 'tts: d.tts === true', "case 'callar': silence()", "case 'sonido': SFX.activar(",
    "addEventListener('message', e => handle(e.data))", 'window.__aura = handle',
    // lo que contesta: al marco de arriba (Centro) y a WebView2 (notch)
    "window.parent.postMessage(m, '*')", 'window.chrome.webview.postMessage(m)', "notify({tipo:'listo'})", "type:'aura-fallo'", "type:'aura-end'",
    // el marco «cara» del notch depende de cómo encuadra
    '<div id="stage">', 'cam.orbYFrac = portrait ? 0.36 : 0.385',
  ]) assert.ok(html.includes(pieza), `la página tiene «${pieza}»`);
  assert.doesNotMatch(html, /(src|href)="https?:/, 'sin nada de afuera: ni la WebView del notch ni la CSP del Centro lo dejarían cargar');
});
