/**
 * Fase 2: el libro de compromisos (lib/compromisos.ts, lib/promesas.ts `frasesDeCompromiso`, GET /api/compromisos).
 *
 * Lo que tiene que ser verdad:
 *   · «te aviso», «lo dejo listo», «mañana lo reviso», «voy a investigar» son compromisos; una pregunta, una oferta
 *     condicional, una negación o una respuesta normal no;
 *   · «mañana» / «en 2 horas» / «esta tarde» dan su vencimiento (hora de Honduras);
 *   · se anotan por dueño, una vez (el mismo turno procesado dos veces no duplica), y la ruta lista solo los míos;
 *   · solo registro: no hay avisos ni acciones.
 */
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import type { AddressInfo } from 'node:net';
import { almacenEnMemoria, _usarAlmacenDurable } from '../lib/durable';
import { detectarCompromisos, listarCompromisos, registrarCompromisos, venceDe } from '../lib/compromisos';
import { frasesDeCompromiso } from '../lib/promesas';
import { montarRutasObjetivos } from '../server/objetivos';

afterEach(() => _usarAlmacenDurable(null));
// 10 de octubre de 2026, 9:00 de Honduras (15:00 UTC), un sábado.
const T0 = Date.parse('2026-10-10T15:00:00Z');

test('qué es un compromiso y qué no', () => {
  for (const f of ['Te aviso cuando termine.', 'Lo dejo listo para mañana.', 'Mañana lo reviso.', 'Voy a investigar las tasas de los bancos.', 'Yo me encargo.', 'Te lo mando en 2 horas.', 'Te lo tengo listo esta tarde.', "I'll take care of it."]) {
    assert.equal(frasesDeCompromiso(f).length, 1, f);
  }
  for (const f of [
    '¿Quieres que te avise cuando termine?',
    'Si quieres, te aviso cuando salga el resultado.',
    'No te aviso porque no puedo.',
    'Todavía no lo empecé.',
    'El oro está a cuatro mil dólares la onza.',
    'Copán fue una gran ciudad maya.',
    '¿Lo dejo listo para mañana?',
  ]) {
    assert.deepEqual(frasesDeCompromiso(f), [], f);
  }
  // Las líneas de máquina no cuentan; un texto con varias frases da cada compromiso.
  const t = 'Listo, ya revisé tu agenda. Mañana lo reviso con calma. Te aviso cuando termine.\nACCION_APP: {"tipo":"recordatorio"}';
  assert.deepEqual(frasesDeCompromiso(t), ['Mañana lo reviso con calma.', 'Te aviso cuando termine.']);
});

test('el vencimiento sale de la frase (hora de Honduras)', () => {
  assert.equal(venceDe('Mañana lo reviso', T0), Date.parse('2026-10-11T15:00:00Z'), 'mañana a las 9 de Honduras');
  assert.equal(venceDe('Te lo mando en 2 horas', T0), T0 + 2 * 3600_000);
  assert.equal(venceDe('Te lo tengo esta tarde', T0), Date.parse('2026-10-10T23:00:00Z'));
  assert.equal(venceDe('Lo veo el lunes', T0), Date.parse('2026-10-12T15:00:00Z'));
  assert.equal(venceDe('Te aviso cuando termine', T0), undefined);
  const d = detectarCompromisos('Lo dejo listo para mañana.', T0);
  assert.equal(d.length, 1);
  assert.equal(d[0].vence, Date.parse('2026-10-11T15:00:00Z'));
});

test('se anotan por dueño, una vez; la ruta lista solo los míos (y no avisa nada)', async () => {
  const a = almacenEnMemoria();
  _usarAlmacenDurable(a);
  const yo = 'compromisos@ejemplo.com';
  const otro = 'otro-compromisos@ejemplo.com';
  const r1 = await registrarCompromisos(yo, 'Va. Mañana lo reviso y te aviso cuando termine.', { ahora: T0, idTurno: 'turno-abc-123' });
  assert.equal(r1.length, 1, 'una frase con dos promesas es un compromiso');
  assert.equal(r1[0].estado, 'abierto');
  assert.equal(r1[0].vence, Date.parse('2026-10-11T15:00:00Z'));
  // El mismo turno otra vez (la voz y el JSON, un reintento): no duplica.
  const r2 = await registrarCompromisos(yo, 'Va. Mañana lo reviso y te aviso cuando termine.', { ahora: T0 + 5_000, idTurno: 'turno-abc-123' });
  assert.equal(r2[0].id, r1[0].id);
  await registrarCompromisos(yo, 'El dólar está a 24.7 lempiras.', { ahora: T0 });
  await registrarCompromisos(yo, 'Lo dejo listo esta tarde.', { ahora: T0 + 60_000, objetivoId: 'ob_abcdef1234' });
  await registrarCompromisos(otro, 'Te aviso cuando termine.', { ahora: T0 });
  const l = await listarCompromisos(yo, a);
  assert.ok(l.ok);
  if (l.ok) {
    assert.equal(l.compromisos.length, 2);
    assert.equal(l.compromisos[0].objetivoId, 'ob_abcdef1234');
  }
  const pasa = ((_q: express.Request, _s: express.Response, nx: express.NextFunction) => nx()) as express.RequestHandler;
  const app = express();
  app.use(express.json());
  montarRutasObjetivos(app, { exigir: [pasa], limitar: () => pasa, sesionDe: (req) => (req.headers['x-quien'] ? { correo: String(req.headers['x-quien']) } : null) });
  const srv = app.listen(0, '127.0.0.1');
  await new Promise((r) => srv.once('listening', r));
  try {
    const pedir = async (quien: string | null) => {
      const r = await fetch(`http://127.0.0.1:${(srv.address() as AddressInfo).port}/api/compromisos`, { headers: quien ? { 'x-quien': quien } : {} });
      return { status: r.status, json: (await r.json()) as any };
    };
    assert.equal((await pedir(null)).status, 401);
    const mios = await pedir(yo);
    assert.equal(mios.status, 200);
    assert.equal(mios.json.compromisos.length, 2);
    assert.ok(mios.json.compromisos.every((c: any) => c.estado === 'abierto' && c.dueno === undefined), 'sin la huella del dueño');
    assert.deepEqual(mios.json.compromisos.map((c: any) => c.texto).sort(), ['Lo dejo listo esta tarde.', 'Mañana lo reviso y te aviso cuando termine.'].sort());
    assert.equal((await pedir(otro)).json.compromisos.length, 1);
  } finally {
    srv.close();
  }
});
