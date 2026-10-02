/**
 * El menú de la app (lib/menu-app.ts): la fuente única de dónde está cada cosa en el teléfono. Que cubra
 * todo lo que existe hoy, que cada lugar diga de dónde sale (y esos archivos existan), que las pantallas
 * que «abre» sean las que la acción sabe abrir, y que en la voz vaya corto (cada ficha es tiempo antes de
 * hablar). Y que el turno de la app la lleve (server.ts).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fichaMenuPrompt, lugarDe, MENU_APP, pasosDe } from '../lib/menu-app';
import { validarAccion } from '../lib/acciones-app';

const RAIZ = path.resolve(import.meta.dirname, '..');

test('cubre todo lo que hay hoy en la app (José: «tiene que conocer todo el menú»)', () => {
  const ids = MENU_APP.map((l) => l.id);
  for (const id of ['mesa', 'mas', 'llamar', 'chats', 'whatsapp', 'correos', 'computadora', 'misiones', 'conocer', 'circulo', 'propuestas', 'avisos', 'recordatorios', 'camara', 'ajustes', 'permisos', 'genesis', 'recorrido'])
    assert.ok(ids.includes(id), `falta «${id}»`);
  assert.equal(new Set(ids).size, ids.length, 'sin repetidos');
  for (const l of MENU_APP) {
    for (const k of ['nombre', 'donde', 'que', 'corto'] as const) assert.ok(l[k].es.trim() && l[k].en.trim(), `${l.id}.${k} en los dos idiomas`);
    for (const p of l.pasos || []) assert.ok(p.es && p.en, `${l.id}: un paso sin idioma`);
  }
});

test('cada lugar dice de dónde sale y esos archivos existen (nada inventado)', () => {
  for (const l of MENU_APP) {
    assert.ok(l.fuente.length, `${l.id} sin fuente`);
    for (const f of l.fuente) assert.ok(fs.existsSync(path.join(RAIZ, f)), `${l.id}: «${f}» no existe`);
  }
});

test('lo que «abre» es una pantalla que la acción abrir de verdad abre', () => {
  const conAbrir = MENU_APP.filter((l) => l.abrir);
  assert.ok(conAbrir.length >= 9);
  for (const l of conAbrir) assert.deepEqual(validarAccion({ tipo: 'abrir', pantalla: l.abrir }), { tipo: 'abrir', pantalla: l.abrir }, l.id);
  // Lo que se pide en la tarea: WhatsApp, correo, ajustes, sus misiones, lo que sabe y su círculo se abren.
  for (const id of ['whatsapp', 'correos', 'ajustes', 'misiones', 'conocer', 'circulo', 'computadora', 'chats']) assert.ok(lugarDe(id)?.abrir, `${id} sin abrir`);
});

test('el paso a paso de conectar WhatsApp y el correo, con los nombres de la pantalla', () => {
  const wa = pasosDe(lugarDe('whatsapp')!, 'es');
  assert.match(wa, /^1\) .*Con un código/);
  assert.match(wa, /Dispositivos vinculados/);
  assert.match(wa, /Vincular con el número de teléfono/);
  const co = pasosDe(lugarDe('correos')!, 'es');
  assert.match(co, /contraseña de aplicación/);
  assert.match(co, /microsoft\.com\/devicelogin/);
  assert.match(lugarDe('correos')!.donde.es, /pestaña Correos.*Tus correos/);
  assert.match(lugarDe('avisos')!.donde.es, /Permisos del teléfono → Avisos/);
  assert.match(lugarDe('propuestas')!.que.es, /Sí, hazlo.*Luego.*No/);
  assert.match(lugarDe('camara')!.donde.es, /Comenta lo que ve/);
  assert.equal(pasosDe(lugarDe('mesa')!), '', 'sin pasos, nada');
});

test('el prompt: completo en texto, corto en la voz; «abrir» solo con el teléfono conectado', () => {
  const largo = fichaMenuPrompt('es', { conAbrir: true });
  const corto = fichaMenuPrompt('es', { compacto: true, conAbrir: true });
  assert.match(largo, /^MENÚ DE LA APP/);
  for (const l of MENU_APP) assert.ok(largo.includes(l.nombre.es), `el largo nombra «${l.nombre.es}»`);
  assert.match(largo, /\[abrir: whatsapp\]/);
  assert.match(largo, /ACCION_APP abrir/);
  assert.doesNotMatch(fichaMenuPrompt('es'), /ACCION_APP|\[abrir:/, 'sin teléfono no promete abrir nada');
  assert.ok(largo.length < 6500, `el largo cabe (${largo.length} caracteres)`);
  // ~300 fichas: cada una es tiempo antes de que la llamada conteste.
  assert.ok(corto.length < 1300, `el de la voz es corto (${corto.length} caracteres)`);
  assert.ok(corto.length < largo.length / 3, 'la voz lleva menos de un tercio');
  assert.match(corto, /WhatsApp: pestaña WhatsApp → «Con un código»/);
  assert.match(corto, /contraseña de aplicación/);
  const en = fichaMenuPrompt('en', { compacto: true });
  assert.match(en, /^APP MENU: /);
  assert.doesNotMatch(en, /ACCION_APP/);
  // Sin saltos ni caracteres de control dentro de una línea del corto (va de un tirón en el system).
  assert.equal(corto.split('\n').length, 1);
});

test('el turno de la app la lleva en lo fijo (reglasApp), corta si es voz', () => {
  const src = fs.readFileSync(path.join(RAIZ, 'server.ts'), 'utf8');
  assert.match(src, /fichaMenuPrompt\(idiomaManos, \{ compacto, conAbrir: conApp \}\)/);
  assert.match(src, /const reglasApp = \[manosAqui, menuAqui,/);
});
