/**
 * El cuerpo de AU-RA: qué gesto sale de cada herramienta y qué pose de cada estado.
 * Sin WebGL: es la parte pura del motor (src/11-sala/tareas.ts).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { animoDe, HABLA, poseDe, tareaDeHerramientas } from '../src/11-sala/tareas';
import { EMOCIONES } from '../lib/emocion';

test('cada herramienta del turno tiene su gesto', () => {
  assert.equal(tareaDeHerramientas(['cerebro-genesis', 'web']), 'buscar');
  assert.equal(tareaDeHerramientas(['pagina']), 'buscar');
  assert.equal(tareaDeHerramientas(['oro']), 'oro');
  assert.equal(tareaDeHerramientas(['plata', 'hnl']), 'oro');
  assert.equal(tareaDeHerramientas(['pdf-leer']), 'leer');
  assert.equal(tareaDeHerramientas(['tareas']), 'anotar');
  assert.equal(tareaDeHerramientas(['vision']), 'mirar');
  assert.equal(tareaDeHerramientas(['pdf', 'enviar', 'telegram']), 'enviar');
});

test('enviar gana a todo: es lo que la persona pidió y lo último que pasa', () => {
  assert.equal(tareaDeHerramientas(['web', 'oro', 'telegram']), 'enviar');
  assert.equal(tareaDeHerramientas(['oro', 'web']), 'buscar');
});

test('lo que no es una herramienta visible no mueve el cuerpo', () => {
  assert.equal(tareaDeHerramientas([]), null);
  assert.equal(tareaDeHerramientas(null), null);
  assert.equal(tareaDeHerramientas(['cerebro-genesis', 'cot', 'escena-no']), null);
});

test('el estado del turno manda sobre la emoción', () => {
  assert.equal(animoDe('SLEEPING', 'feliz'), 'dormido');
  assert.equal(animoDe('LISTENING', 'triste'), 'escuchando');
  assert.equal(animoDe('THINKING', 'feliz'), 'pensando');
  assert.equal(animoDe('SPEAKING', 'orgullo'), 'orgullo');
  assert.equal(animoDe('IDLE', 'neutral'), 'neutral');
  assert.equal(animoDe('CONCERNED', 'alarma'), 'alarma');
});

test('las diecinueve emociones del contrato tienen pose, y ninguna rompe la cara', () => {
  for (const e of EMOCIONES) {
    const p = poseDe(animoDe('SPEAKING', e), 1.23);
    for (const [k, v] of Object.entries(p)) if (typeof v === 'number') assert.ok(Number.isFinite(v), `${e}.${k}`);
    assert.ok(p.ojoY > 0 && p.ojoY <= 1.01, `${e}: ojos`);
    assert.ok(p.anilloOp > 0, `${e}: el anillo nunca se apaga del todo`);
  }
});

test('dormida cierra los ojos y suelta zetas; cantando saca notas', () => {
  const d = poseDe('dormido', 0);
  assert.ok(d.ojoY < 0.2);
  assert.equal(d.zetas, true);
  assert.equal(poseDe('canto', 0).notas, true);
  assert.equal(poseDe('pensando', 0).puntos, true);
});

test('habla cuando la mesa está diciendo algo, cantando u orando', () => {
  for (const f of ['SPEAKING', 'SING', 'LAUGH', 'PRAY'] as const) assert.ok(HABLA.has(f));
  for (const f of ['IDLE', 'THINKING', 'LISTENING', 'SLEEPING'] as const) assert.ok(!HABLA.has(f));
});

test('los estilos: sin elegir nada sale el aspecto de siempre, y lo desconocido no rompe', async () => {
  const { estiloDe, COLORES, CUERPOS, PALETAS, FORMAS } = await import('../src/11-sala/estilos');
  assert.deepEqual(estiloDe(undefined), { paleta: 'miel', forma: 'frijol' });
  assert.deepEqual(estiloDe({ paleta: 'neon' as any, forma: 'orbe' }), { paleta: 'miel', forma: 'orbe' });
  for (const p of PALETAS) for (const v of Object.values(COLORES[p])) if (typeof v === 'string' && v.startsWith('#')) assert.match(v, /^#[0-9A-F]{6}$/i, p);
  for (const f of FORMAS) assert.ok(CUERPOS[f].R > 0 && CUERPOS[f].ALTO > 1, f);
  assert.equal(CUERPOS.frijol.R, 0.56);
  assert.equal(CUERPOS.frijol.ALTO, 1.25);
});
