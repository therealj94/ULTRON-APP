import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bloqueMesa, duenioDe, esMesa, llamados, partirLargo, quienesDe, textoDeVoces, vocesDe, vocesDelTurno } from '../server/electrum/personajes';
import { convocar, decidirPanel, ESPECIALISTAS } from '../server/electrum/especialistas';

test('cada especialidad tiene dueño en la mesa', () => {
  assert.equal(duenioDe('geologo'), 'electrum');
  assert.equal(duenioDe('economista'), 'electrum');
  assert.equal(duenioDe('metalurgista'), 'chema');
  assert.equal(duenioDe('minas'), 'chema');
  assert.equal(duenioDe('civil'), 'tatiana');
  assert.equal(duenioDe('legal'), 'electrum');
  assert.equal(duenioDe('ambiental'), 'tatiana');
  for (const e of ESPECIALISTAS) assert.ok(duenioDe(e.id));
});

test('llamarlos por su nombre los trae a contestar', () => {
  assert.deepEqual(llamados('Don Chema, ¿qué planta ocupo para oro en sulfuros?'), ['metalurgista']);
  assert.deepEqual(llamados('Tatiana, ¿cómo construyo eso?'), ['civil']);
  assert.deepEqual(llamados('¿cuántas concesiones hay en Olancho?'), []);
  assert.equal(convocar('Don Chema, ¿y eso cuánto cuesta?')[0].id, 'metalurgista');
  assert.equal(convocar('Ingeniera Tatiana, ¿qué necesito?')[0].id, 'civil');
});

test('«mesa técnica» junta a los tres', async () => {
  assert.ok(esMesa('Que lo analice la mesa técnica'));
  assert.ok(esMesa('¿qué opinan entre los tres?'));
  assert.ok(!esMesa('dame los tres primeros expedientes'));
  const { panel, fuente } = await decidirPanel('Mesa técnica: ¿conviene una planta en esta concesión?');
  assert.equal(fuente, 'mesa');
  assert.deepEqual(quienesDe(panel), ['electrum', 'chema', 'tatiana']);
});

test('el bloque de la mesa solo va cuando habla alguien más que el doctor', () => {
  assert.equal(bloqueMesa(['electrum'], false), null);
  const b = bloqueMesa(['chema', 'tatiana'], false)!;
  assert.match(b, /Don Chema/);
  assert.match(b, /Ing\. Tatiana/);
  assert.match(b, /\*\*Don Chema:\*\*/);
  assert.doesNotMatch(b, /CIERRA Dr Electrum/);
  assert.match(bloqueMesa(['electrum'], true)!, /CIERRA Dr Electrum/);
});

test('de la respuesta a las voces de cada uno', () => {
  const r = '**Don Chema:** [warmly] Para oro en sulfuros, flotación y luego CIL.\n\n**Ing. Tatiana:** Eso pide una presa de relaves y licencia ambiental.\n**Dr Electrum**: [thoughtful] Primero confirmemos la ley con sondajes.';
  const v = vocesDe(r);
  assert.deepEqual(v.map((x) => x.quien), ['chema', 'tatiana', 'electrum']);
  assert.equal(v[0].texto, '[warmly] Para oro en sulfuros, flotación y luego CIL.');
  assert.equal(textoDeVoces(v), 'Don Chema: Para oro en sulfuros, flotación y luego CIL.\n\nIng. Tatiana: Eso pide una presa de relaves y licencia ambiental.\n\nDr Electrum: Primero confirmemos la ley con sondajes.');
  assert.deepEqual(vocesDe('Sin etiquetas, habla el doctor.'), []);
  // Solo el doctor con etiqueta: se dice con su voz de siempre.
  assert.deepEqual(vocesDelTurno('**Dr Electrum:** Hola.', ['electrum']), []);
  // Contestó Don Chema sin presentarse: es suyo igual.
  assert.deepEqual(vocesDelTurno('Molienda y flotación.', ['chema']), [{ quien: 'chema', texto: 'Molienda y flotación.' }]);
});

test('una intervención larga se parte por frases sin pasar el tope', () => {
  const largo = Array.from({ length: 30 }, (_, i) => `Frase número ${i} de la planta de proceso.`).join(' ');
  const partes = partirLargo(largo, 200);
  assert.ok(partes.length > 3);
  for (const p of partes) assert.ok(p.length <= 200, p);
  assert.equal(partes.join(' '), largo);
});
