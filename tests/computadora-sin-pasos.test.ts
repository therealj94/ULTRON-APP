/**
 * Prueba real E1 en el nodo (5-oct): «crea tres documentos» se quedó sin pasos y la frase final no decía cuáles
 * faltaban. Con la revisión del nodo al acabarse los pasos (agente.py `cerrar_sin_terminar`), el final dice qué ya quedó
 * y qué falta; sin revisión (nodo viejo o no pudo mirar), no se adivina nada.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { fraseDeFinal, type Tarea } from '../server/computadora';

const INSTR = 'Crea tres documentos: informe.docx, presupuesto.xlsx y carta.pdf';
const base = (archivos: Tarea['archivos']): Tarea => ({
  id: 't1',
  motor: 'holo',
  instruccion: INSTR,
  estado: 'sin_pasos',
  pasos: [{ accion: 'click', args: { element: 'Guardar' } } as any],
  respuesta: null,
  error: 'Se acabaron los 40 pasos sin terminar.',
  segundos: 372,
  archivos,
});

test('sin pasos con la revisión del nodo: dice qué quedó y qué falta, y sigue ofreciendo seguir (nunca «listo»)', () => {
  const f = fraseDeFinal(INSTR, base([
    { ruta: '/home/computeruse/Documents/presupuesto.xlsx', existe: true, bytes: 4096, sha256: 'a'.repeat(64), reciente: true, mencionado: true, tipo: 'xlsx', integro: true, integro_v: 12 } as any,
    { ruta: 'informe.docx', existe: false, bytes: 0, sha256: null, mencionado: true } as any,
    { ruta: 'carta.pdf', existe: false, bytes: 0, sha256: null, mencionado: true } as any,
  ]));
  assert.match(f, /No alcancé a terminar/);
  assert.match(f, /Ya quedó: presupuesto\.xlsx/);
  assert.match(f, /Falta: [^.]*informe\.docx/);
  assert.match(f, /Falta: .*carta\.pdf/);
  assert.match(f, /¿Sigo\?/);
  assert.doesNotMatch(f, /Listo/);
});

test('sin pasos sin revisión (nodo viejo, o no pudo mirar): la frase de siempre, sin inventar archivos', () => {
  for (const archivos of [undefined, null]) {
    const f = fraseDeFinal(INSTR, base(archivos));
    assert.match(f, /No alcancé a terminar/);
    assert.doesNotMatch(f, /Ya quedó|Falta:/);
  }
});
