/**
 * LA POLÍTICA DE ETIQUETAS DE VOZ, UNA PARA TODAS LAS SUPERFICIES (lib/etiquetas-voz.ts, 10-oct): un tono al comienzo
 * del turno y una reacción como mucho; ninguna en lo serio, el dinero o lo legal; sin tonos compuestos. Y la forma de
 * quitar las marcas (pantalla, respaldo, vecinos) sin tocar un [1] ni un enlace. La mesa (guionEleven), el pulidor del
 * turno hablado (PulidorVoz) y la llamada (EtiquetasTurno) dicen lo mismo.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  EtiquetasTurno,
  TONO_EMOCION,
  TOPE_VECINO,
  esMarcaDeVoz,
  esReaccion,
  politicaEtiquetas,
  quitarEtiquetasVoz,
  simplificarEtiqueta,
  temaSensible,
  textoVecino,
} from '../lib/etiquetas-voz';
import { ETIQUETAS_VERIFICADAS } from '../mobile/src/compa/etiquetasVoz';
import { TONO_V4, guionEleven } from '../server/eleven';
import { PulidorVoz, pulirParaVoz } from '../lib/habla-natural';
import { quitarExpresiones } from '../lib/expresiones';

const id = (t: string) => t;

test('el tono de cada emoción: uno, sencillo y verificado; nada en neutral ni en lo serio', () => {
  assert.deepEqual(TONO_EMOCION, { feliz: 'warmly', risa: 'chuckles', sorpresa: 'surprised', curioso: 'curious', pensando: 'thoughtful', carino: 'tender', travieso: 'playfully', oracion: 'softly' });
  assert.equal(TONO_V4, TONO_EMOCION, 'la llamada (voz-agente) y la mesa leen el mismo mapa');
  const verificadas = new Set<string>(ETIQUETAS_VERIFICADAS);
  for (const t of Object.values(TONO_EMOCION)) {
    assert.ok(verificadas.has(String(t)), `[${t}] verificada`);
    assert.doesNotMatch(String(t), /,/, 'sin tonos compuestos');
  }
  for (const e of ['neutral', 'triste', 'preocupado', 'alarma', 'firme', 'seco']) assert.equal(politicaEtiquetas(e).tono, null, e);
  for (const e of ['triste', 'preocupado', 'alarma', 'firme', 'seco']) assert.deepEqual(politicaEtiquetas(e), { tono: null, maxTonos: 0, maxReacciones: 0 }, e);
  assert.deepEqual(politicaEtiquetas('oracion'), { tono: 'softly', maxTonos: 1, maxReacciones: 0 }, 'la oración: su tono, sin reacciones');
  assert.deepEqual(politicaEtiquetas('feliz', 'Te pago mañana los 300 lempiras'), { tono: null, maxTonos: 0, maxReacciones: 0 }, 'dinero');
  assert.deepEqual(politicaEtiquetas('feliz', 'Mi abogado revisó el contrato'), { tono: null, maxTonos: 0, maxReacciones: 0 }, 'legal');
  assert.ok(temaSensible('Son L. 1,500') && temaSensible('cuesta $20') && !temaSensible('Qué bueno verte, José'));
});

test('un tono solo al comienzo y una reacción en todo el turno; sin compuestos', () => {
  const t = new EtiquetasTurno('feliz');
  assert.equal(t.marca('con ternura', true), 'tender', 'el tono que el cerebro puso delante');
  assert.equal(t.tono(), null, 'y el de la emoción ya no va encima');
  assert.equal(t.marca('risa', false), 'laughs');
  assert.equal(t.marca('suspiro', false), null, 'una reacción por turno');
  assert.equal(t.marca('emocionado', false), null, 'un tono a mitad no');
  const u = new EtiquetasTurno('feliz');
  assert.equal(u.marca('risa', true), 'laughs');
  assert.equal(u.tono(), null, 'si abre con una reacción, no se le pone el tono delante');
  const v = new EtiquetasTurno('feliz');
  assert.equal(v.tono(), 'warmly');
  assert.equal(v.tono(), null, 'una vez');
  assert.equal(new EtiquetasTurno('oracion').marca('softly, reverent', true), 'softly');
  assert.equal(simplificarEtiqueta('warmly, tender'), 'warmly');
  assert.equal(new EtiquetasTurno('feliz', { primerSegmento: false }).tono(), null, 'en la segunda frase no hay tono');
  assert.equal(new EtiquetasTurno('triste').marca('risa', true), null);
  assert.ok(esReaccion('laughs') && esReaccion('sighs') && !esReaccion('warmly') && !esReaccion('whispers'));
});

test('la mesa (guionEleven) aplica la misma política', () => {
  assert.equal(guionEleven('Ay, no [risa] qué pena.', 'feliz', id), '[warmly] Ay, no [laughs] qué pena.');
  assert.equal(guionEleven('Ay [risa] no [suspiro] puede ser.', 'feliz', id), '[warmly] Ay [laughs] no puede ser.', 'una reacción');
  assert.equal(guionEleven('[risa] ¡Qué bueno!', 'risa', id), '[laughs] ¡Qué bueno!', 'abre con su reacción: sin tono encima (nada de [chuckles] [laughs])');
  assert.equal(guionEleven('[softly, reverent] Amén.', 'oracion', id), '[softly] Amén.');
  assert.equal(guionEleven('Bendice [warmly] este día [risa].', 'oracion', id), '[softly] Bendice este día.', 'en la oración, solo su tono');
  assert.equal(guionEleven('Lo siento [suspiro].', 'triste', id), 'Lo siento.');
  assert.equal(guionEleven('[con ternura] Va.', 'neutral', id, { tono: false }), 'Va.', 'un tono que no es del comienzo del turno no va');
  assert.equal(guionEleven('Mira [risa] eso.', 'feliz', id, { tono: false }), 'Mira [laughs] eso.');
  assert.equal(guionEleven('Ay [risa] qué bueno.', 'feliz', id, { modelo: 'eleven_flash_v2_5' }), 'Ay qué bueno.', 'un modelo sin etiquetas: ninguna');
});

test('el pulidor del turno hablado: la misma política (tono al comienzo, una reacción, nada en lo serio)', () => {
  const p = new PulidorVoz({ mensaje: 'Cuéntame algo bonito' });
  p.ponerEmocion('feliz');
  assert.equal(p.trozo('[con ternura] Claro que sí [risa], mira.'), '[con ternura] Claro que sí [risa], mira.');
  assert.equal(p.trozo(' Y otra [suspiro] cosa [emocionado].'), ' Y otra cosa.');
  assert.equal(pulirParaVoz('Ya te pagué los 300 lempiras [risa].', { mensaje: '¿Me pagaste?' }), 'Ya te pagué los 300 lempiras.', 'dinero, sin risas');
  assert.equal(pulirParaVoz('Mira el punto [1] del informe [risa].', {}), 'Mira el punto [1] del informe [risa].');
  assert.equal(pulirParaVoz('[risa] Hola.', { maxEtiquetas: 0 }), 'Hola.', 'maxEtiquetas 0: ninguna (Dr Electrum)');
});

test('quitar las marcas: solo las de voz; un [1], un [Anexo A] o un enlace se quedan', () => {
  assert.equal(quitarEtiquetasVoz('Ay [risa], mira el punto [1] y el [Anexo A].'), 'Ay, mira el punto [1] y el [Anexo A].');
  assert.equal(quitarEtiquetasVoz('[EMO:feliz] Hola [warmly] José [softly, reverent].').trim(), 'Hola José.');
  assert.equal(quitarEtiquetasVoz('Lee [la guía](https://x.hn) ya.'), 'Lee [la guía](https://x.hn) ya.');
  assert.equal(quitarEtiquetasVoz('¡ [sorpresa] Uy!'), '¡Uy!');
  assert.ok(esMarcaDeVoz('Risa') && esMarcaDeVoz('short pause') && !esMarcaDeVoz('12') && !esMarcaDeVoz('José'));
  // Con las marcas de siempre, lo mismo que lib/expresiones.ts (lo que va a la pantalla).
  for (const t of ['Qué bueno [risa] verte.', '[con picardía] Ya lo tengo.', 'Hola [softly] amigo.']) assert.equal(quitarEtiquetasVoz(t), quitarExpresiones(t));
});

test('los vecinos para ElevenLabs: sin marcas, en una línea, 100 caracteres y palabras enteras', () => {
  assert.equal(TOPE_VECINO, 100);
  assert.equal(textoVecino('[risa] Hola,\n José.', 'previo'), 'Hola, José.');
  assert.equal(textoVecino('[risa]', 'siguiente'), undefined);
  const largo = Array.from({ length: 40 }, (_, i) => `palabra${i}`).join(' ');
  const previo = textoVecino(largo, 'previo')!;
  const siguiente = textoVecino(largo, 'siguiente')!;
  assert.ok(previo.length <= 100 && siguiente.length <= 100);
  assert.match(previo, /^palabra\d+ .* palabra39$/, 'el final, empezando en una palabra entera');
  assert.match(siguiente, /^palabra0 .* palabra\d+$/, 'el comienzo, terminando en una palabra entera');
  assert.ok(largo.endsWith(previo) && largo.startsWith(siguiente));
});
