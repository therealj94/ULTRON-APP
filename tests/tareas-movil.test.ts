/**
 * El reparto herramienta → gesto del teléfono (mobile/src/lib/tareas.ts, una copia porque Metro no sale
 * de mobile/) tiene que coincidir con el de la web (src/11-sala/tareas.ts): la cara de anillos del
 * teléfono hace el mismo gesto que la sala de la web para cada herramienta.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { tareaDeHerramientas as web } from '../src/11-sala/tareas';
import { tareaDeHerramientas as movil } from '../mobile/src/lib/tareas';

test('el teléfono y la web sacan el mismo gesto de cada herramienta', () => {
  const casos: string[][] = [
    [], ['web'], ['pagina'], ['oro'], ['plata', 'hnl'], ['metales'], ['fx'], ['pdf-leer'], ['pdf'], ['rag'],
    ['tareas'], ['memoria'], ['recordar'], ['vision'], ['escena'], ['foto'], ['enviar'], ['telegram'], ['whatsapp'],
    ['correo'], ['urgente'], ['llamada'], ['web', 'oro', 'telegram'], ['oro', 'web'], ['cerebro-genesis', 'cot'], [' WEB '],
  ];
  for (const c of casos) assert.equal(movil(c), web(c), c.join(','));
  assert.equal(movil(null), null);
});
