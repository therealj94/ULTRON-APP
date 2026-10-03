/**
 * PRIV01 (auditoría del 3-oct): borrar algo que la persona contó, en el teléfono (mobile/src/lib/supresion.ts).
 *
 * Lo que tiene que ser verdad:
 *   · la respuesta del perfil y su copia en «lo que sé de ti» comparten UNA clave (categoría + clave), y
 *     de un dato con esa clave se sabe a qué respuesta del perfil corresponde (los dos borrados cubren
 *     las mismas copias);
 *   · nada se confirma sin recibo durable de CADA copia: `durable: false`, sin `durable`, un error de red
 *     o un servidor viejo sin la ruta dejan la supresión en «error», nunca en «confirmado».
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { campoDeDato, claveComunDeCampo, plegarClave, reciboDurable, suprimirCopias } from '../mobile/src/lib/supresion';
import { datoConocerDe, PREGUNTAS } from '../mobile/src/primeravez/flujo';

test('clave común: cada respuesta del perfil tiene la suya, y es la misma que lleva su copia en «lo que sé de ti»', () => {
  for (const q of PREGUNTAS) {
    const k = claveComunDeCampo(q.campo);
    assert.ok(k, `${q.campo} sin clave común`);
    const d = datoConocerDe(q.campo, 'algo de prueba')!;
    assert.deepEqual({ categoria: d.categoria, clave: d.clave }, k, `${q.campo}: la copia que manda la primera vez lleva otra clave`);
    assert.equal(campoDeDato(k!), q.campo, `${q.campo}: de su clave no se vuelve a la respuesta`);
  }
  assert.deepEqual(claveComunDeCampo('vive'), { categoria: 'rutinas', clave: 'vive' });
  assert.equal(claveComunDeCampo('otros'), null, '«Algo más» no tiene copia con clave');
});

test('clave común: un dato que AURA aprendió conversando con la misma clave también es esa respuesta', () => {
  // El servidor guarda la clave plegada (minúsculas, sin acentos); la app la compara igual.
  assert.equal(campoDeDato({ categoria: 'rutinas', clave: 'vive' }), 'vive');
  assert.equal(campoDeDato({ categoria: 'gustos', clave: 'Comida Favorita' }), 'comida');
  assert.equal(campoDeDato({ categoria: 'trabajo', clave: 'oficio' }), 'trabajo');
  assert.equal(campoDeDato({ categoria: 'familia', clave: 'esposa' }), null, 'la esposa no es la respuesta «Tu familia»');
  assert.equal(campoDeDato({ categoria: 'gustos', clave: 'vive' }), null, 'misma clave en otra categoría: no');
  assert.equal(campoDeDato({ categoria: 'rutinas' }), null, 'sin clave: no');
  assert.equal(plegarClave('  Música  Favorita '), 'musica favorita');
});

test('recibo: solo `durable: true` es recibo; false, ausente, null o basura no', () => {
  assert.equal(reciboDurable({ ok: true, durable: true }), true);
  assert.equal(reciboDurable({ ok: true, durable: false }), false);
  assert.equal(reciboDurable({ ok: true }), false, 'un servidor que no dice nada no confirma');
  assert.equal(reciboDurable({ durable: 'true' }), false);
  assert.equal(reciboDurable(null), false);
  assert.equal(reciboDurable(undefined), false);
});

test('suprimir: confirmado solo si TODAS las copias dieron recibo durable; nunca lanza', async () => {
  const llamadas: string[] = [];
  const copia = (nombre: string, r: () => Promise<boolean>) => ({ nombre, borrar: () => (llamadas.push(nombre), r()) });
  const todo = await suprimirCopias([copia('perfil', async () => true), copia('conocer', async () => true)]);
  assert.deepEqual(todo, { estado: 'confirmado', sinRecibo: [] });
  assert.deepEqual(llamadas, ['perfil', 'conocer'], 'se intentan todas');

  const medio = await suprimirCopias([copia('perfil', async () => true), copia('conocer', async () => false)]);
  assert.deepEqual(medio, { estado: 'error', sinRecibo: ['conocer'] }, 'durable:false en una copia → error, no confirmado');

  const red = await suprimirCopias([
    copia('perfil', async () => {
      throw new Error('sin red');
    }),
    copia('conocer', async () => true),
  ]);
  assert.deepEqual(red, { estado: 'error', sinRecibo: ['perfil'] }, 'red caída → error, y la otra copia igual se intentó');

  const nada = await suprimirCopias([]);
  assert.equal(nada.estado, 'error', 'sin copias no hay nada que confirmar');
});
