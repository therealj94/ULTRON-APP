/**
 * El formato XML de llamadas de Qwen 3.5+ (lib/agente/protocolo.ts): el modelo del nodo (Qwen3.8)
 * a veces vuelve a su formato de entrenamiento aunque se le pida Hermes, y esa llamada no puede
 * perderse como «JSON que no se puede leer».
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { deHermes, leerLlamadas, limpiarTexto, llamadaXml, pedidosRechazados } from '../lib/agente/protocolo';
import type { Herramienta } from '../lib/agente/tipos';

const H = (nombre: string) => ({ nombre, descripcion: '', esquema: { type: 'object', properties: {} } }) as unknown as Herramienta;

test('lee <function=…><parameter=…> dentro de <tool_call>', () => {
  const t = 'Déjeme ver.\n<tool_call>\n<function=catastro_buscar>\n<parameter=texto>\nClavo Rico\n</parameter>\n<parameter=limite>5</parameter>\n</function>\n</tool_call>';
  assert.deepEqual(deHermes(t), [{ nombre: 'catastro_buscar', argumentos: { texto: 'Clavo Rico', limite: 5 }, via: 'hermes' }]);
  assert.deepEqual(pedidosRechazados({}, t, [H('catastro_buscar')]), []);
  assert.equal(limpiarTexto(t), 'Déjeme ver.');
});

test('varias llamadas, valores JSON y la variante suelta sin <tool_call>', () => {
  const dos = '<tool_call><function=a><parameter=x>true</parameter></function></tool_call><tool_call><function=b><parameter=lista>[1,2]</parameter></function></tool_call>';
  assert.deepEqual(
    leerLlamadas({}, dos, [H('a'), H('b')]).map((l) => [l.nombre, l.argumentos]),
    [['a', { x: true }], ['b', { lista: [1, 2] }]]
  );
  const suelta = '<function=gis_medir><parameter=concesion_id>1397</parameter></function>';
  assert.deepEqual(deHermes(suelta)[0], { nombre: 'gis_medir', argumentos: { concesion_id: 1397 }, via: 'hermes' });
  assert.equal(limpiarTexto(suelta), '');
});

test('parámetro sin cerrar y el JSON de siempre siguen funcionando', () => {
  assert.deepEqual(llamadaXml('<function=x><parameter=a>uno<parameter=b>dos</function>'), { nombre: 'x', argumentos: { a: 'uno', b: 'dos' } });
  assert.deepEqual(deHermes('<tool_call>{"name":"x","arguments":{"a":1}}</tool_call>'), [{ nombre: 'x', argumentos: { a: 1 }, via: 'hermes' }]);
  assert.equal(llamadaXml('{"name":"x"}'), null);
});

test('una herramienta inventada en XML se rechaza con su motivo', () => {
  assert.deepEqual(pedidosRechazados({}, '<tool_call><function=volar_a_marte></function></tool_call>', [H('a')]), ['«volar_a_marte» no es una de tus herramientas']);
});
