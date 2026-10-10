/**
 * El hilo dentro del tope (auditoría del 10-oct): lib/tope-pedido.ts acorta los mensajes largos (principio y final con
 * «…») antes de quitar uno entero, nunca quita los últimos 4 ni quita uno entero para ahorrar poco si recortar alcanza
 * («hilo -4» para ahorrar 390 y 104 caracteres); y en la voz (lib/conversacion.ts fusionarHilo) los 2 últimos de AU-RA y
 * de la persona llegan hasta 1 200 caracteres, los demás a 600.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { acotarPedido, AHORRO_MINIMO_DESCARTE, HILO_INTOCABLE, recortarMedio, TOPE_PEDIDO_VOZ_CAR } from '../lib/tope-pedido';
import { fusionarHilo } from '../lib/conversacion';
import { VOZ_CARACTERES_HILO, VOZ_CARACTERES_RECIENTES } from '../server/prompt-turno';

type M = { role: string; content: string };
const hiloDe = (n: number, largo: number): M[] =>
  Array.from({ length: n }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: `${i}:INICIO ${'x'.repeat(Math.max(0, largo - 20))} FINAL${i}` }));
const total = (h: M[]) => h.reduce((n, m) => n + m.content.length, 0);

test('recortarMedio deja el principio y el final con «…» en medio', () => {
  const t = `ABC ${'x'.repeat(1000)} XYZ`;
  const r = recortarMedio(t, 300);
  assert.ok(r.length <= 300, String(r.length));
  assert.ok(r.startsWith('ABC') && r.endsWith('XYZ') && r.includes('…'));
  assert.equal(recortarMedio('corto', 300), 'corto');
});

test('falta poco: se acorta, no se quita ningún mensaje entero (10-oct: «hilo -4» para 390 car.)', () => {
  const hilo = hiloDe(12, 600);
  const system = 'S'.repeat(TOPE_PEDIDO_VOZ_CAR - total(hilo) - 4 + 390);
  const a = acotarPedido({ system, hechos: [], hilo, mensaje: 'hola' }, { voz: true });
  assert.ok(a.despues <= TOPE_PEDIDO_VOZ_CAR, `${a.despues}`);
  assert.equal(a.hilo.length, hilo.length, 'ningún mensaje se quita');
  assert.ok(!a.recortes.some((r) => r.startsWith('hilo -')), a.recortes.join(','));
  assert.ok(a.recortes.some((r) => r.startsWith('hilo ✂')), a.recortes.join(','));
  // Lo acortado guarda principio y final; los últimos 4, enteros.
  const acortado = a.hilo.find((m, i) => m.content !== hilo[i].content)!;
  assert.match(acortado.content, /^\d+:INICIO x*…x* ?FINAL\d+$/);
  for (let i = hilo.length - HILO_INTOCABLE; i < hilo.length; i++) assert.equal(a.hilo[i].content, hilo[i].content, `el ${i} queda entero`);
});

test('poco que ahorrar y mensajes viejos ya cortos: se recorta el HECHO o los últimos, no se quita un mensaje', () => {
  const hilo: M[] = [...hiloDe(6, 200), ...hiloDe(4, 1_200).map((m, i) => ({ ...m, content: `R${i}${m.content}` }))];
  const hecho = `LARGO ${'h'.repeat(3_000)}`;
  const base = 'S'.length + total(hilo) + hecho.length + 1 + 'hola'.length;
  const tope = base - 104;
  const a = acotarPedido({ system: 'S', hechos: [hecho], hilo, mensaje: 'hola' }, { tope });
  assert.ok(a.despues <= tope);
  assert.equal(a.hilo.length, hilo.length, 'para 104 car. no se quita nada entero');
  assert.ok(104 < AHORRO_MINIMO_DESCARTE);
});

test('falta mucho: se quita lo viejo entero, pero nunca los últimos 4 (y el hilo empieza por la persona)', () => {
  const hilo = hiloDe(16, 1_700);
  const a = acotarPedido({ system: 'S'.repeat(9_000), hechos: [], hilo, mensaje: 'hola' }, { voz: true });
  assert.ok(a.despues <= TOPE_PEDIDO_VOZ_CAR, `${a.despues}`);
  assert.ok(a.recortes.some((r) => r.startsWith('hilo -')), a.recortes.join(','));
  assert.ok(a.hilo.length >= HILO_INTOCABLE);
  assert.equal(a.hilo[0].role, 'user');
  // Los últimos 4 siguen ahí (quizá acortados, con su principio y su final).
  for (let k = 1; k <= HILO_INTOCABLE; k++) {
    const orig = hilo[hilo.length - k];
    const queda = a.hilo[a.hilo.length - k];
    assert.ok(queda.content.startsWith(orig.content.slice(0, 8)) && queda.content.endsWith(orig.content.slice(-7)), `último ${k}`);
  }
});

test('ni con un system enorme se quitan los últimos 4: se acortan, después el mensaje', () => {
  const hilo = hiloDe(8, 1_700);
  const a = acotarPedido({ system: 'S'.repeat(15_000), hechos: ['corto'], hilo, mensaje: 'hola' }, { voz: true });
  assert.equal(a.hilo.length, HILO_INTOCABLE);
  assert.ok(a.hilo.every((m) => m.content.length >= 300));
});

test('un pedido que cabe no se toca', () => {
  const a = acotarPedido({ system: 'S', hechos: ['h'], hilo: hiloDe(4, 100), mensaje: 'hola' }, { voz: true });
  assert.deepEqual(a.recortes, []);
});

/* ------------------------------------------------------------------ la ventana de la voz */

const turnos = (n: number, largo: number) =>
  Array.from({ length: n }, (_, i) => ({ rol: i % 2 ? 'assistant' : 'user', texto: `${i}:${String.fromCharCode(65 + (i % 26)).repeat(largo)}` }));

test('voz: los 2 últimos de AU-RA y de la persona hasta 1 200; los de antes, 600', () => {
  assert.equal(VOZ_CARACTERES_HILO, 600);
  assert.equal(VOZ_CARACTERES_RECIENTES, 1_200);
  const durable = turnos(10, 2_000) as any;
  const h = fusionarHilo({ durable, mensaje: 'y entonces qué', maxCaracteres: VOZ_CARACTERES_HILO, maxCaracteresRecientes: VOZ_CARACTERES_RECIENTES });
  assert.equal(h.length, 10);
  const largos = h.map((m) => m.content.length);
  assert.deepEqual(largos.slice(0, 6), [600, 600, 600, 600, 600, 600]);
  assert.deepEqual(largos.slice(6), [1_200, 1_200, 1_200, 1_200]);
});

test('voz: el mensaje de ahora que ya está en el hilo no gasta un lugar de los recientes', () => {
  const durable = [...turnos(6, 2_000), { rol: 'user', texto: 'mándalo' }] as any;
  const h = fusionarHilo({ durable, mensaje: 'mándalo', maxCaracteres: 600, maxCaracteresRecientes: 1_200 });
  assert.equal(h.length, 6);
  assert.deepEqual(h.map((m) => m.content.length), [600, 600, 1_200, 1_200, 1_200, 1_200]);
});

test('sin maxCaracteresRecientes, igual que siempre (escrito: 1 800 todos)', () => {
  const durable = turnos(6, 2_500) as any;
  assert.ok(fusionarHilo({ durable, mensaje: 'hola', maxCaracteres: 1_800 }).every((m) => m.content.length === 1_800));
  assert.ok(fusionarHilo({ durable, mensaje: 'hola', maxCaracteres: 600 }).every((m) => m.content.length === 600));
});

test('server.ts arma el hilo de la voz con los dos topes', () => {
  const s = readFileSync(new URL('../server.ts', import.meta.url), 'utf8');
  assert.match(s, /maxCaracteres: compacto \? VOZ_CARACTERES_HILO : TEXTO_CARACTERES_HILO/);
  assert.match(s, /maxCaracteresRecientes: compacto \? VOZ_CARACTERES_RECIENTES : undefined/);
});
