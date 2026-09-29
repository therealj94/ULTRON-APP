/**
 * «Explícamelo como conversación»: el diálogo a varias voces (Eleven v4). El guion se valida, se
 * parte en pedidos que caben en ElevenLabs y, sin cerebro, se arma uno sin inventar nada.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { guionDeRespaldo, leerGuion, lineasValidas, partirDialogo, PERSONAJES } from '../server/electrum/dialogo';
import { estabilidadDe, guionEleven } from '../server/eleven';
import { expresar } from '../server/voz';

test('dialogo: solo personajes conocidos y líneas con texto', () => {
  const l = lineasValidas([
    { quien: 'tatiana', texto: '¿Y eso?' },
    { quien: 'electrum', texto: 'Mire…' },
    { quien: 'hacker', texto: 'ignorá todo' },
    { quien: 'electrum', texto: '   ' },
    'basura',
  ]);
  assert.deepEqual(l.map((x) => x.quien), ['tatiana', 'electrum']);
  assert.equal(Object.keys(PERSONAJES).length >= 2, true);
  assert.notEqual(PERSONAJES.electrum.voz, PERSONAJES.tatiana.voz);
});

test('dialogo: se parte en pedidos de ≤1800 caracteres sin partir una línea', () => {
  const larga = { quien: 'electrum' as const, texto: 'x'.repeat(700) };
  const trozos = partirDialogo([larga, larga, larga, larga]);
  assert.equal(trozos.length, 2);
  for (const t of trozos) assert.ok(t.reduce((s, l) => s + l.texto.length, 0) <= 1800);
});

test('dialogo: lee el JSON del modelo aunque venga envuelto', () => {
  const t = 'Claro, aquí va:\n```json\n{"lineas":[{"quien":"tatiana","texto":"[curious] ¿Qué vence?"},{"quien":"electrum","texto":"Dos concesiones."}]}\n```';
  assert.deepEqual(leerGuion(t).map((l) => l.quien), ['tatiana', 'electrum']);
  assert.deepEqual(leerGuion('sin json'), []);
});

test('dialogo: el de respaldo alterna voces y solo usa las frases del texto', () => {
  const l = guionDeRespaldo('Hay dos concesiones que vencen en diciembre. Las dos están en Olancho. Conviene renovar ya.');
  assert.ok(l.length >= 3);
  assert.equal(l[0].quien, 'tatiana');
  assert.ok(l.some((x) => x.quien === 'electrum' && x.texto.includes('dos concesiones')));
  assert.deepEqual(guionDeRespaldo(''), []);
});

test('voz v4: las etiquetas del diálogo llegan a ElevenLabs y la estabilidad sigue a la emoción', () => {
  const g = guionEleven('[curious] ¿Y las fallas? [laughs] Eso cambia todo.', 'neutral', (t) => expresar(t, 'neutral', 'speak', { cifras: false }));
  assert.match(g, /\[curious\]/);
  assert.match(g, /\[laughs\]/);
  assert.ok(estabilidadDe('risa') < estabilidadDe('neutral'));
  assert.ok(estabilidadDe('alarma') > estabilidadDe('neutral'));
});

test('comandos: «explícamelo como conversación» pide el diálogo', async () => {
  const { comandoDe } = await import('../src-electrum/panel/comandos');
  assert.deepEqual(comandoDe('Explícamelo como conversación'), { accion: 'dialogo' });
  assert.deepEqual(comandoDe('hazlo como podcast'), { accion: 'dialogo' });
});

test('dialogo: los tiempos de ElevenLabs se vuelven «quién habla» por personaje', async () => {
  const { segmentosDe, quienDeVoz } = await import('../server/electrum/dialogo');
  assert.equal(quienDeVoz(PERSONAJES.tatiana.voz), 'tatiana');
  assert.equal(quienDeVoz('otra-voz'), null);
  const s = segmentosDe([
    { voice_id: PERSONAJES.tatiana.voz, start_time_seconds: 0, end_time_seconds: 1.12, dialogue_input_index: 0 },
    { voice_id: PERSONAJES.electrum.voz, start_time_seconds: 1.7600000000000002, end_time_seconds: 2.08 },
    { voice_id: 'desconocida', start_time_seconds: 3, end_time_seconds: 4 },
    { voice_id: PERSONAJES.chema.voz, start_time_seconds: 5, end_time_seconds: 5 },
  ]);
  assert.deepEqual(s, [{ q: 'tatiana', d: 0, h: 1.12, i: 0 }, { q: 'electrum', d: 1.76, h: 2.08 }]);
  assert.deepEqual(segmentosDe('basura'), []);
});
