/**
 * Las llamadas a herramientas como las escribe un modelo: con la cuenta en vez del número,
 * comentarios, comas de más o comillas simples. Visto en producción: «¿qué concesiones vencen este
 * año?» terminaba preguntando «cuántos días» porque `"dias": 365 - 270` no era JSON.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { deHermes, jsonTolerante, pedidosRechazados } from '../lib/agente/protocolo';
import { diasHastaFinDe } from '../server/electrum/manos';

test('repara los errores típicos y nada más', () => {
  assert.deepEqual(jsonTolerante('{"dias": 365 - 270}'), { dias: 95 });
  assert.deepEqual(jsonTolerante('{"a": 2 + 3 * 4, "b": 10 / 4}'), { a: 14, b: 2.5 });
  assert.deepEqual(jsonTolerante("{name: 'x', arguments: {dias: 95, // hasta fin de año\n}}"), { name: 'x', arguments: { dias: 95 } });
  assert.deepEqual(jsonTolerante('```json\n{"a":1,}\n```'), { a: 1 });
  assert.deepEqual(jsonTolerante('{"a":{"b":1}'), { a: { b: 1 } });
  assert.deepEqual(jsonTolerante('{"url":"http://a.b/c"}'), { url: 'http://a.b/c' });
  assert.throws(() => jsonTolerante('esto no es json'));
  // No evalúa nada que no sea aritmética de números.
  assert.throws(() => jsonTolerante('{"a": process.exit(1)}'));
});

test('la llamada rota de producción ahora se lee y no se rechaza', () => {
  const texto = '<tool_call>{"name": "catastro_vencimientos", "arguments": {"dias": 365 - 270}}</tool_call>';
  assert.deepEqual(deHermes(texto), [{ nombre: 'catastro_vencimientos', argumentos: { dias: 95 }, via: 'hermes' }]);
  const h = [{ nombre: 'catastro_vencimientos' }] as any;
  assert.deepEqual(pedidosRechazados(null, texto, h), []);
});

test('«este año» es hasta el 31 de diciembre en Honduras', () => {
  assert.equal(diasHastaFinDe('este_anio', new Date('2026-09-27T12:00:00-06:00')), 95);
  assert.equal(diasHastaFinDe('proximo_anio', new Date('2026-09-27T12:00:00-06:00')), 460);
  // 31 de diciembre a las 23:00 en Honduras ya es 1 de enero en UTC: sigue siendo «hoy».
  assert.equal(diasHastaFinDe('este_anio', new Date('2027-01-01T05:00:00Z')), 0);
});
