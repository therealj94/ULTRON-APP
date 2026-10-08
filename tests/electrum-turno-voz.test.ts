/**
 * EL TURNO DE DR ELECTRUM CON LO QUE TRAJO AU-RA (server/electrum/turno.ts), contra un nodo de mentira:
 *  · el texto sale mientras llega (`alTexto`, `alFinDeRonda`), y en la mesa no;
 *  · `interrumpido` llega al modelo como el hecho de lib/interrumpida.ts;
 *  · la guarda de honestidad cambia lo que afirma sin recibo, y la traza lo dice;
 *  · el turno deja su línea de tiempos (lib/tiempos-turno.ts);
 *  · UNA PREGUNTA, UN TURNO: las claves de Electrum van en su espacio y un reintento recibe la misma respuesta.
 */
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { claveTurno, reclamarTurno } from '../server/turno-unico';
import { claveTurnoElectrum, electrumDeGuardado, guardadoDeElectrum, MAX_UI_GUARDADA } from '../server/electrum/turno-idempotente';

// Lo durable de los turnos va a una carpeta de prueba (sin S3 configurado, el disco local).
const dirDurable = fs.mkdtempSync(path.join(os.tmpdir(), 'electrum-turno-'));
process.env.ULTRON_DURABLE_DIR = dirDurable;
process.env.ULTRON_MEMORIA_BUCKET = '';
// El nodo de mentira es el cerebro de este archivo (sin Bedrock).
process.env.ELECTRUM_CEREBRO = 'qwen';

let respuesta = '';
const pedidos: any[] = [];
const srv = http.createServer((req, res) => {
  let cuerpo = '';
  req.on('data', (c) => (cuerpo += c));
  req.on('end', () => {
    try {
      pedidos.push(JSON.parse(cuerpo));
    } catch {
      pedidos.push(null);
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ message: { role: 'assistant', content: respuesta } }));
  });
});
before(async () => {
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
  process.env.ULTRON_NODO_URL = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
  process.env.ULTRON_NODO_SECRETO = 'prueba';
});
after(() => {
  srv.close();
  fs.rmSync(dirDurable, { recursive: true, force: true });
});

const ctx = { quien: null, nivel: 'lee' as const, plataforma: 'electrum' as const, canal: 'mesa' as const, mensaje: 'hola' };

test('el texto sale mientras llega, y la guarda de honestidad corrige lo que afirma sin recibo', async () => {
  const { turnoElectrum } = await import('../server/electrum/turno');
  respuesta = 'Listo, te generé el informe en PDF. La concesión Clavo Rico tiene 120 ha.';
  const trozos: string[] = [];
  let rondas = 0;
  const logs: string[] = [];
  const log = console.log;
  console.log = (...a: unknown[]) => logs.push(a.join(' '));
  let r;
  try {
    r = await turnoElectrum('¿Cuántas hectáreas tiene Clavo Rico?', ctx, { alTexto: (t) => trozos.push(t), alFinDeRonda: () => rondas++ });
  } finally {
    console.log = log;
  }
  assert.equal(trozos.join(''), respuesta, 'lo que dijo el modelo, tal cual, mientras llegaba');
  assert.ok(rondas >= 1);
  assert.equal(r.texto, 'Todavía no generé ese informe; si lo querés, pedímelo y lo armo. La concesión Clavo Rico tiene 120 ha.');
  assert.ok(r.traza.some((t) => t.herramienta === 'honestidad' && !t.ok));
  assert.ok(
    logs.some((l) => /^\[electrum\] turno \w+: preparado \d+ ms · primera ficha \d+ ms · primer texto \d+ ms · modelo \d+ ms/.test(l)),
    `una línea de tiempos: ${logs.join(' | ')}`
  );
});

test('interrumpido: el modelo recibe dónde quedó, y que acuse corto', async () => {
  const { turnoElectrum } = await import('../server/electrum/turno');
  respuesta = 'Va. Del traslape: no hay ninguno.';
  pedidos.length = 0;
  await turnoElectrum('¿Y el traslape?', ctx, { interrumpido: 'La concesión Clavo Rico tiene' });
  const usuario = pedidos[0].messages.filter((m: any) => m.role === 'user').pop().content;
  assert.match(usuario, /TE INTERRUMPIÓ/);
  assert.match(usuario, /«La concesión Clavo Rico tiene»/);
  assert.match(usuario, /¿Y el traslape\?$/, 'la pregunta sigue al final');
  pedidos.length = 0;
  await turnoElectrum('¿Y el traslape?', ctx, {});
  assert.doesNotMatch(pedidos[0].messages.filter((m: any) => m.role === 'user').pop().content, /INTERRUMPIÓ/);
});

test('la mesa (varias voces) no sale por frases', async () => {
  const { turnoElectrum } = await import('../server/electrum/turno');
  respuesta = 'Dr Electrum: Es oro libre.\nDon Chema: Gravimetría y mesas.';
  const trozos: string[] = [];
  const r = await turnoElectrum('¿Qué planta le pongo a Clavo Rico?', ctx, { mesa: true, alTexto: (t) => trozos.push(t) });
  assert.deepEqual(trozos, []);
  assert.ok(r.voces?.length, 'la mesa reparte el texto entre sus personajes');
});

test('las claves de Electrum van en su espacio', () => {
  assert.equal(claveTurnoElectrum('ana', 'abc12345'), 'electrum:ana|abc12345');
  assert.notEqual(claveTurnoElectrum('ana', 'abc12345'), claveTurno('ana', 'abc12345'), 'no choca con la de AU-RA');
  assert.equal(claveTurnoElectrum('ana', 'corto'), null, 'un id inválido: sin clave (se corre como siempre)');
  assert.equal(claveTurnoElectrum('', 'abc12345'), null);
  assert.notEqual(claveTurnoElectrum('visita:1', 'abc12345'), claveTurnoElectrum('visita:2', 'abc12345'));
});

test('lo guardado devuelve la misma respuesta; un mapa que pesa demasiado no se guarda', () => {
  const r = { texto: 'Hola.', voz: 'Hola.', emocion: 'neutral', panel: 'Geólogo', traza: [{ herramienta: 'catastro_buscar', ok: true, resumen: 'x', ms: 3 }], ui: [{ accion: 'volar' }], fin: 'contestó', trazaId: 't1', idioma: 'es' };
  const g = guardadoDeElectrum(r);
  assert.equal(g.reply, 'Hola.');
  assert.deepEqual(g.herramientas, ['catastro_buscar']);
  assert.deepEqual(electrumDeGuardado(g), r);
  const grande = guardadoDeElectrum({ ...r, ui: [{ geojson: 'x'.repeat(MAX_UI_GUARDADA + 10) }] });
  assert.equal(electrumDeGuardado(grande).ui, undefined);
  assert.equal(electrumDeGuardado(grande).texto, 'Hola.');
});

test('un reintento con el mismo idTurno espera al turno en curso y recibe su respuesta', async () => {
  const clave = claveTurnoElectrum('visita:prueba', 'turno-electrum-1')!;
  const primero = await reclamarTurno(clave);
  assert.ok('terminar' in primero);
  const reintento = reclamarTurno(clave, 5_000);
  const salida = { texto: 'Clavo Rico tiene 120 ha.', emocion: 'neutral', panel: '', traza: [], ui: [], fin: 'contestó' };
  setTimeout(() => void (primero as any).terminar(guardadoDeElectrum(salida)), 50);
  const r = await reintento;
  assert.ok('previo' in r, 'no corre otro');
  assert.equal(electrumDeGuardado((r as any).previo).texto, 'Clavo Rico tiene 120 ha.');
  // AU-RA con la misma persona y el mismo id: otro turno.
  const aura = await reclamarTurno(claveTurno('visita:prueba', 'turno-electrum-1'));
  assert.ok('terminar' in aura);
  await (aura as any).terminar(null);
});
