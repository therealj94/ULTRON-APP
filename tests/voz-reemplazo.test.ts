/**
 * EL `replace` DEL TURNO EN LA VOZ DE LA MESA (auditoría VOICE02, mobile/src/lib/reemplazoVoz.ts).
 *
 * El servidor corrige lo dicho a media respuesta (`replace`: el texto entero hasta ahí). La pantalla se
 * corrige sola; la voz no se puede desoír. Lo que se decide aquí: de lo corregido, qué falta decir.
 *   · si lo que ya sonó coincide, se sigue donde iba (nada se repite);
 *   · si lo que sonó era otra cosa, se dice desde la frase donde difiere, marcado como corrección;
 *   · nunca la respuesta entera otra vez si su comienzo ya sonó igual.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { faltaDecir } from '../mobile/src/lib/reemplazoVoz';

test('sin nada oído, se dice lo corregido entero (y no es una corrección audible)', () => {
  assert.deepEqual(faltaDecir('', 'El oro está a 3 412 dólares.'), { decir: 'El oro está a 3 412 dólares.', corrige: false });
});

test('lo oído coincide con el comienzo: solo lo que falta, sin repetir', () => {
  const r = faltaDecir('Déjame ver.', 'Déjame ver. El oro está a 3 412 dólares la onza.');
  assert.deepEqual(r, { decir: 'El oro está a 3 412 dólares la onza.', corrige: false });
});

test('la segunda frase que sonó era otra: desde esa frase, sin repetir la primera', () => {
  const r = faltaDecir('Déjame ver. El oro está a 3 400 dólares.', 'Déjame ver. El oro está a 3 412 dólares la onza.');
  assert.equal(r.corrige, true);
  assert.equal(r.decir, 'El oro está a 3 412 dólares la onza.');
});

test('la primera frase ya era otra: se dice lo corregido desde el principio', () => {
  const r = faltaDecir('Mandé el correo a Beto.', 'No pude mandar el correo a Beto.');
  assert.deepEqual(r, { decir: 'No pude mandar el correo a Beto.', corrige: true });
});

test('sonó una conclusión que la corrección quita: la última frase buena se vuelve a decir como corrección', () => {
  const r = faltaDecir('El oro sube. Ya lo compré.', 'El oro sube.');
  assert.equal(r.corrige, true);
  assert.equal(r.decir, 'El oro sube.');
});

test('los espacios no cuentan como diferencia', () => {
  assert.deepEqual(faltaDecir('Va,  la cierro.', 'Va, la cierro.\n Listo.'), { decir: 'Listo.', corrige: false });
});

test('lo corregido idéntico a lo oído: no queda nada por decir', () => {
  assert.deepEqual(faltaDecir('Listo, la cerré.', 'Listo, la cerré.'), { decir: '', corrige: false });
});
