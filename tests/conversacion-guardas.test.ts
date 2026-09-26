import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pedidoRed, esSobreUltron, esTemaOG } from '../lib/conversacion';

test('saludos y preguntas sobre AU-RA no van a internet', () => {
  for (const f of ['hola AU-RA, ¿cómo amaneciste?', '¿cómo estás hoy?', '¿qué sentís cuando cantás?', '¿quién sos vos?', '¿te gusta el oro?']) {
    assert.equal(pedidoRed(f), null, f);
    assert.equal(esSobreUltron(f), true, f);
  }
});

test('temas de Orden Global se contestan con el cerebro, no con búsqueda automática', () => {
  for (const f of ['contame un dato que te sorprenda de la cadena 5550', '¿qué es ORIGEN?', '¿quién es Medardo?', '¿qué opinás de Próspera?']) {
    assert.equal(esTemaOG(f), true, f);
    assert.equal(pedidoRed(f), null, f);
  }
});

test('preguntas externas y búsquedas explícitas sí van a internet', () => {
  assert.ok(pedidoRed('¿quién es el presidente de Honduras?'));
  assert.ok(pedidoRed('busca noticias de la cadena 5550'));
  assert.ok(pedidoRed('¿qué es Hyperledger Fabric y cómo funciona?'));
});
