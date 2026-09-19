import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  capasHilo,
  esContinuacion,
  esPreguntaExterna,
  extraerUrls,
  fusionarHilo,
  pedidoRed,
  resolverReferencia,
  urlsParaLeer,
} from '../lib/conversacion';

describe('Hilo y búsqueda sin que se lo pidan', () => {
  it('saca URLs y README crudo de GitHub', () => {
    const t =
      'El README indica que emula un asistente. https://github.com/concept-bytes/jarvis usa Whisper y GPT-3.5. ¿Quieres que descargue el código?';
    assert.ok(extraerUrls(t).some((u) => /github\.com\/concept-bytes\/jarvis/i.test(u)));
    const leer = urlsParaLeer('https://github.com/concept-bytes/jarvis');
    assert.ok(leer.some((u) => /raw\.githubusercontent\.com\/concept-bytes\/jarvis\/main\/README/i.test(u)));
  });

  it('«sí hacerlo y revisa profundo esto» sigue el README anterior', () => {
    const hilo = [
      {
        rol: 'ultron',
        texto:
          'El README indica que emula un asistente conversacional. Usa Whisper V3, GPT-3.5 Turbo y TTS de OpenAI. Es un proyecto de código abierto con 260 estrellas. https://github.com/concept-bytes/jarvis ¿Quieres que descargue el código para analizar la lógica interna?',
      },
    ];
    const msg = 'Si hacerlo y revisa profundo esto';
    assert.equal(esContinuacion(msg), true);
    const red = pedidoRed(msg, hilo);
    assert.ok(red);
    assert.match(String(red.leer), /github\.com\/concept-bytes\/jarvis/i);
    const resuelto = resolverReferencia(msg, hilo);
    assert.match(resuelto, /github\.com\/concept-bytes\/jarvis/i);
    assert.match(resuelto, /No pidas el enlace/);
  });

  it('pregunta externa busca sola; saludo y «recuerda que» no', () => {
    assert.equal(esPreguntaExterna('hola'), false);
    assert.ok(pedidoRed('recuerda que tomo té verde') == null);
    const red = pedidoRed('qué es el proyecto Jarvis de Concept-Bytes');
    assert.ok(red);
    assert.match(red.query, /Jarvis/i);
    assert.ok(pedidoRed('busca noticias de cobre')?.query);
  });

  it('fusiona hilo durable y no duplica el mensaje actual', () => {
    const durable = [
      { rol: 'user', texto: 'hablame del readme' },
      { rol: 'ultron', texto: 'Es un Jarvis de OpenAI.' },
      { rol: 'user', texto: 'revisa profundo esto' },
    ];
    const msgs = fusionarHilo({ durable, mensaje: 'revisa profundo esto' });
    assert.equal(msgs.at(-1)?.role, 'assistant');
    assert.match(msgs.at(-1)?.content || '', /Jarvis/);
    assert.equal(msgs.some((m) => m.content === 'revisa profundo esto'), false);
  });

  it('separa hilo corto y mediano', () => {
    const corta = Array.from({ length: 12 }, (_, i) => ({
      rol: i % 2 === 0 ? 'user' : 'ultron',
      texto: i < 4 ? `viejo ${i}` : `nuevo ${i}`,
    }));
    const c = capasHilo(corta);
    assert.match(c.corto, /nuevo 11/);
    assert.match(c.mediano, /viejo 0/);
    assert.equal(c.corto.includes('viejo 0'), false);
  });
});
