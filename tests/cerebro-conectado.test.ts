/**
 * El cerebro continuo y la iniciativa, conectados al turno (server.ts, server/prompt-turno.ts, lib/harness.ts):
 * - Con sesión, AU-RA ve sus herramientas de misiones y círculo; el triaje solo con su WhatsApp.
 * - Los pedidos `mision`, `circulo` y `triaje` llegan a su runner (y sin runner se dice que no está).
 * - Lo que sabe de la persona va en lo fijo pero no en la firma; lo que quedó a medias, en el mensaje del turno.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { extraerPedidoHerramienta, instruccionHarness, resolverPedido } from '../lib/harness';
import { INSTRUCCION_CIRCULO } from '../lib/circulo';
import { INSTRUCCION_TRIAJE } from '../lib/triaje';
import { piezasDelTurno } from '../server/prompt-turno';

test('harness: misiones y círculo solo con sesión; el triaje además con su WhatsApp', () => {
  const sin = instruccionHarness('miembro', false, false, false);
  assert.ok(!/PEDIR_HERRAMIENTA: mision/.test(sin) && !/PEDIR_HERRAMIENTA: circulo/.test(sin));
  const con = instruccionHarness('miembro', false, false, true);
  assert.match(con, /PEDIR_HERRAMIENTA: mision listar/);
  assert.match(con, /PEDIR_HERRAMIENTA: circulo recordar/);
  assert.ok(!/PEDIR_HERRAMIENTA: triaje/.test(con), 'sin WhatsApp no se ofrece el triaje');
  assert.match(instruccionHarness('junta', false, true, true), /PEDIR_HERRAMIENTA: triaje revisar/);
  // Los módulos siguen exportando su instrucción (vive en lib/harness.ts para no cargar el puente).
  assert.match(INSTRUCCION_CIRCULO, /circulo listar/);
  assert.match(INSTRUCCION_TRIAJE, /triaje revisar/);
});

test('harness: mision, circulo y triaje se reconocen y van a su runner', async () => {
  const base = { web: async () => '', sistema: async () => '', leer: async () => '', ejecutor: async () => '' };
  const vistos: string[] = [];
  const runners = {
    ...base,
    mision: async (a: string) => (vistos.push(`mision:${a}`), 'MISIÓN CREADA'),
    circulo: async (a: string) => (vistos.push(`circulo:${a}`), 'BORRADOR'),
    triaje: async (a: string) => (vistos.push(`triaje:${a}`), 'TRIAJE'),
  };
  const ped = (t: string) => extraerPedidoHerramienta(t)!;
  assert.equal(await resolverPedido(ped('Va.\nPEDIR_HERRAMIENTA: mision crear Vender el carro | precio justo | fotos; anuncio'), runners), 'MISIÓN CREADA');
  await resolverPedido(ped('PEDIR_HERRAMIENTA: circulo'), runners);
  await resolverPedido(ped('PEDIR_HERRAMIENTA: triaje'), runners);
  assert.deepEqual(vistos, ['mision:crear Vender el carro | precio justo | fotos; anuncio', 'circulo:listar', 'triaje:revisar']);
  assert.match(await resolverPedido(ped('PEDIR_HERRAMIENTA: triaje whatsapp'), base), /no está disponible/);
});

test('prompt: lo que sabe de la persona va en lo fijo (no en la firma) y lo que quedó a medias en el turno', () => {
  const p = piezasDelTurno({
    nivel: 'miembro',
    canal: 'mesa',
    modo: 'GUARDIAN',
    mando: false,
    quien: null,
    quienMem: null,
    hechos: [],
    conocer: 'LO QUE SÉ DE TI:\n- Familia: su esposa se llama Ana',
    bloqueCerebro: 'QUEDÓ A MEDIAS:\n- Mandarle la cotización a Beto',
  });
  assert.match(p.fijo, /su esposa se llama Ana/);
  assert.ok(!p.firma.includes('su esposa se llama Ana'), 'aprender un dato no rehace el system a media conversación');
  assert.match(p.contexto, /Mandarle la cotización a Beto/);
  assert.ok(!p.fijo.includes('Mandarle la cotización'), 'lo que cambia con la consulta no va en el system');
});
