/**
 * Hechos vigentes con fecha y fuente (server/electrum/instituciones.ts): «¿quién es el director de
 * INHGEOMIN?» se contesta con el nombre, la fecha del dato y dónde se leyó; nunca de memoria.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { bloqueInstituciones, HECHOS, hechosDeLaPregunta } from '../server/electrum/instituciones';

test('el director de INHGEOMIN sale primero, con fecha y fuente', () => {
  const hs = hechosDeLaPregunta('¿Quién es el director del Instituto Hondureño de Geología y Minas hoy?');
  assert.match(hs[0].texto, /Óscar Felipe García López/);
  const b = bloqueInstituciones('quien es el director de inhgeomin')!;
  assert.match(b, /Óscar Felipe García López/);
  assert.match(b, /dato del 21 de junio de 2026/);
  assert.match(b, /laprensa\.hn/);
});

test('SERNA/MiAmbiente e ICF: sus titulares', () => {
  assert.match(hechosDeLaPregunta('¿Quién es el ministro de MiAmbiente?')[0].texto, /Juan Carlos Ramos/);
  assert.match(hechosDeLaPregunta('quién dirige el ICF')[0].texto, /José Armando Ramírez Mejía/);
});

test('la ley: el fallo de 2026 y los plazos con su advertencia', () => {
  const b = bloqueInstituciones('¿Qué artículos de la Ley General de Minería declaró inconstitucionales la Sala?')!;
  assert.match(b, /22, 39, 43, 47, 48, 67 y 68/);
  const p = hechosDeLaPregunta('¿cuántos años dura el plazo de exploración?').map((h) => h.texto).join('\n');
  assert.match(p, /anulados parcialmente en 2026/);
});

test('lo que no se pudo confirmar se marca', () => {
  const b = bloqueInstituciones('¿quién es el subdirector de INHGEOMIN?')!;
  assert.match(b, /SIN CONFIRMAR/);
});

test('una pregunta que no toca instituciones no trae nada', () => {
  assert.equal(bloqueInstituciones('¿Cuántas hectáreas tiene Clavo Rico?'), null);
  assert.equal(bloqueInstituciones('muéstrame solo las de oro'), null);
});

test('cada hecho tiene fecha ISO, fuente y enlace https', () => {
  for (const h of HECHOS) {
    assert.match(h.fecha, /^\d{4}-\d{2}-\d{2}$/, h.texto.slice(0, 40));
    assert.ok(h.fuente.length > 2);
    assert.match(h.url, /^https:\/\//);
  }
});
