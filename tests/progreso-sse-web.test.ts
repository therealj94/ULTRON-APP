/**
 * El `event: progreso` en el cliente de la web (src/04-cerebro/turno.ts pedirTurnoStream): avisa a `onProgreso` con el
 * evento VALIDADO (lo raro no entra), y el turno da exactamente lo mismo que sin él (texto, emoción, done). Un cliente
 * sin `onProgreso` (o una web vieja) lo ignora. Con un fetch de mentira: nada sale de la máquina.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

const fakeStorage = (() => {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, String(v)), removeItem: (k: string) => void m.delete(k), clear: () => m.clear(), key: () => null, length: 0 };
})();
(globalThis as any).localStorage = fakeStorage;
(globalThis as any).sessionStorage = fakeStorage;
(globalThis as any).window = globalThis;

const ev = (e: string, d: unknown) => `event: ${e}\ndata: ${JSON.stringify(d)}\n\n`;
let respuesta = '';
globalThis.fetch = (async () => {
  const cuerpo = respuesta;
  // En trozos partidos en cualquier lado, como llega por la red.
  const trozos = cuerpo.match(/[\s\S]{1,17}/g) || [];
  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      for (const t of trozos) c.enqueue(new TextEncoder().encode(t));
      c.close();
    },
  });
  return new Response(stream, { status: 200, headers: { 'content-type': 'text/event-stream; charset=utf-8' } });
}) as any;

const { pedirTurnoStream } = await import('../src/04-cerebro/turno');

const BASE = [
  ev('tools', { tools: ['harness'] }),
  ev('emocion', { emocion: 'neutral' }),
  ev('delta', { text: 'Hay dos de Ana: ', voz: 'Hay dos de Ana: ' }),
  ev('delta', { text: 'la factura y un saludo.', voz: 'la factura y un saludo.' }),
  ev('done', { reply: 'Hay dos de Ana: la factura y un saludo.', emocion: 'neutral', via: 'prueba' }),
];
const CON_PROGRESO = [
  BASE[0],
  BASE[1],
  ev('progreso', { fase: 'empece', herramienta: 'correo', detalle_seguro: 'Ana', ronda: 1 }),
  ev('progreso', { fase: 'ejecutando', herramienta: 'correo' }),
  ev('progreso', { fase: 'encontre', herramienta: 'correo', detalle_seguro: 'ana@x.hn', n: 2 }),
  ev('progreso', { fase: 'listo', herramienta: 'correo' }),
  ...BASE.slice(2),
];

test('web: `progreso` llega validado a onProgreso y el turno queda igual que sin él', async () => {
  respuesta = BASE.join('');
  const sin = await pedirTurnoStream({ message: 'busca lo de Ana en mi correo' });
  respuesta = CON_PROGRESO.join('');
  const vistos: unknown[] = [];
  const deltas: string[] = [];
  const con = await pedirTurnoStream({ message: 'busca lo de Ana en mi correo' }, { onProgreso: (e) => vistos.push(e), onDelta: (t) => deltas.push(t) });
  assert.deepEqual(con, sin);
  assert.deepEqual(deltas, ['Hay dos de Ana: ', 'la factura y un saludo.']);
  assert.deepEqual(vistos, [
    { fase: 'empece', herramienta: 'correo', detalle_seguro: 'Ana', ronda: 1 },
    { fase: 'encontre', herramienta: 'correo', n: 2 },
    { fase: 'listo', herramienta: 'correo' },
  ]);
  // Sin quien escuche el progreso, tampoco cambia nada.
  respuesta = CON_PROGRESO.join('');
  assert.deepEqual(await pedirTurnoStream({ message: 'x' }), sin);
});
