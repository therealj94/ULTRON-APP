/**
 * Dr Electrum contesta en español salvo que le hablen en inglés: el detector, la decisión del turno
 * y el oído en modo automático.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectarIdioma, idiomaDeCodigo, idiomaDelTurno } from '../lib/idioma-detectar';
import { transcribirAudio, type ProveedorOido } from '../lib/oido';
import { FRASES_GENERALES, FRASES_GENERALES_EN, fraseDeEspera, fraseDeTrabajo } from '../src-electrum/panel/trabajando';

test('idioma: reconoce inglés claro', () => {
  for (const t of ['Show me the concessions in Olancho', 'What is the gold price today?', 'hi', 'Who owns concession El Corpus?', 'where is Minas de Oro', 'Gold concessions near Santa Rosa de Copán']) {
    assert.equal(detectarIdioma(t), 'en', t);
  }
});

test('idioma: reconoce español, también con nombres propios', () => {
  for (const t of ['Muéstrame las concesiones en Olancho', '¿cuántas concesiones hay?', 'dame el mapa geológico', 'Qué hay en Minas de Oro', 'Concesiones de Olancho', 'gracias']) {
    assert.equal(detectarIdioma(t), 'es', t);
  }
});

test('idioma: una sigla o un nombre solo no dicen nada', () => {
  for (const t of ['Olancho', 'INHGEOMIN', 'ok', '', '12345']) assert.equal(detectarIdioma(t), null, t);
});

test('idioma del turno: el texto manda; sin señal, la pista; sin pista, español', () => {
  assert.equal(idiomaDelTurno('Show me gold concessions', 'es'), 'en');
  assert.equal(idiomaDelTurno('Muéstrame el oro', 'en'), 'es');
  assert.equal(idiomaDelTurno('Olancho', 'en'), 'en');
  assert.equal(idiomaDelTurno('Olancho', null, 'en'), 'en');
  assert.equal(idiomaDelTurno('Olancho'), 'es');
  assert.equal(idiomaDelTurno('Olancho', 'fr'), 'es');
});

test('idioma: códigos de los transcriptores', () => {
  assert.equal(idiomaDeCodigo('eng'), 'en');
  assert.equal(idiomaDeCodigo('en-US'), 'en');
  assert.equal(idiomaDeCodigo('spa'), 'es');
  assert.equal(idiomaDeCodigo('es'), 'es');
  assert.equal(idiomaDeCodigo('por'), null);
  assert.equal(idiomaDeCodigo(undefined), null);
});

const AUDIO = Buffer.alloc(2000, 1);

function proveedor(respuestas: Record<string, { texto: string; idioma?: string }>, pedidos: string[] = []): ProveedorOido {
  return {
    nombre: 'falso',
    listo: () => true,
    oir: async (_a, _m, language) => {
      pedidos.push(language);
      const r = respuestas[language];
      return r ? { texto: r.texto, via: 'falso', idioma: r.idioma } : null;
    },
  };
}

test('oído automático: usa el idioma que dice el transcriptor', async () => {
  const pedidos: string[] = [];
  const o = await transcribirAudio({ audio: AUDIO, language: 'auto', proveedores: [proveedor({ auto: { texto: 'show me the map', idioma: 'eng' } }, pedidos)] });
  assert.equal(o.texto, 'show me the map');
  assert.equal(o.idioma, 'en');
  assert.deepEqual(pedidos, ['auto']);
});

test('oído automático: si el transcriptor no lo dice, lo lee del texto; si no se sabe, español', async () => {
  const en = await transcribirAudio({ audio: AUDIO, language: 'auto', proveedores: [proveedor({ auto: { texto: 'what is the gold price' } })] });
  assert.equal(en.idioma, 'en');
  const nada = await transcribirAudio({ audio: AUDIO, language: 'auto', proveedores: [proveedor({ auto: { texto: 'Olancho' } })] });
  assert.equal(nada.idioma, 'es');
});

test('oído automático: si detecta otra lengua, vuelve a oír en español', async () => {
  const pedidos: string[] = [];
  const o = await transcribirAudio({
    audio: AUDIO,
    language: 'auto',
    proveedores: [proveedor({ auto: { texto: 'mostra o mapa', idioma: 'por' }, es: { texto: 'muestra el mapa' } }, pedidos)],
  });
  assert.equal(o.texto, 'muestra el mapa');
  assert.equal(o.idioma, 'es');
  assert.deepEqual(pedidos, ['auto', 'es']);
});

test('oído con idioma fijo: no devuelve idioma ni cambia nada', async () => {
  const o = await transcribirAudio({ audio: AUDIO, language: 'es', proveedores: [proveedor({ es: { texto: 'hola' } })] });
  assert.equal(o.texto, 'hola');
  assert.equal(o.idioma, undefined);
});

test('muletillas: en inglés si la pregunta es en inglés, y cada una se reconoce en su idioma', () => {
  assert.ok(FRASES_GENERALES_EN.includes(fraseDeTrabajo('show me the map', () => 0.1, 'en')));
  assert.ok(FRASES_GENERALES_EN.every((f) => detectarIdioma(f) === 'en'));
  assert.ok(FRASES_GENERALES.every((f) => detectarIdioma(f) === 'es'));
  assert.equal(detectarIdioma(fraseDeEspera('catastro_buscar', 0, 'en')), 'en');
  assert.equal(fraseDeEspera('catastro_buscar', 0), 'Ya la encontré en el catastro, ahora lo reviso…');
});
