/**
 * El turno de la mesa que falla deja rastro en el log, sin contenido (server/registro-turno.ts), y los
 * reintentos de UNA frase no gastan el cupo del miembro tres veces (server/seguridad.ts, cupoPorFrase).
 *
 * José, 5-oct: «No alcanzo al cerebro remoto ahora» y en Render nada que dijera por qué.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { anotarEventoTurno, lineaTurno, medirTurno, TURNO_LENTO_MS } from '../server/registro-turno';
import * as seguridad from '../server/seguridad';

const TEXTO_DE_LA_PERSONA = 'mi cuenta del banco termina en 4455 y quiero saber el saldo';

/** Una petición y una respuesta de Express de mentira (lo que usa el medidor). */
function falsos(body: Record<string, unknown> = {}, headers: Record<string, string> = {}) {
  const req = { body, headers, ip: '7.7.7.7', path: '/api/turno', socket: { remoteAddress: '7.7.7.7' } } as any;
  const res = Object.assign(new EventEmitter(), {
    statusCode: 200,
    locals: {} as Record<string, any>,
    writableEnded: false,
    status(c: number) {
      res.statusCode = c;
      return res;
    },
    json(_b: unknown) {
      res.writableEnded = true;
      res.emit('finish');
      res.emit('close');
      return res;
    },
    setHeader() {},
  }) as any;
  return { req, res };
}

test('lineaTurno: nada si fue bien y a tiempo; una línea si falló o tardó', () => {
  assert.equal(lineaTurno({ ruta: 'json', status: 200, ms: 900, via: 'qwen' }), null);
  const lento = lineaTurno({ ruta: 'stream', status: 200, ms: TURNO_LENTO_MS + 1, via: 'qwen', estado: 'completo' });
  assert.match(lento!, /^\[turno\] LENTO ruta=stream status=200 .*via=qwen/);
  const falla = lineaTurno({ ruta: 'json', status: 502, ms: 1834, error: 'el nodo no contestó:\n timeout "x"', idTurno: 'm1abc-4f2a9b8c7d', origen: 'app', hablado: true });
  assert.match(falla!, /^\[turno\] FALLA ruta=json status=502 codigo=- ms=1834 via=- estado=- id=c-4f2a9b8c7d origen=app hablado=1 error="el nodo no contestó: timeout x"$/);
  assert.match(lineaTurno({ ruta: 'stream', status: 200, ms: 10, cortado: true })!, /FALLA .*cortado=1/);
  assert.match(lineaTurno({ ruta: 'stream', status: 200, ms: 10, estado: 'error', via: 'qwen' })!, /FALLA .*estado=error/);
  // Un id raro (o inventado por el cliente) no entra al log.
  assert.match(lineaTurno({ ruta: 'json', status: 500, ms: 1, idTurno: 'a b<script>' })!, / id=- /);
});

test('medidor en /api/turno: el 502 del cerebro, el 429 del cupo y el 409 «en curso» dejan su línea; un turno bien, nada', () => {
  const lineas: string[] = [];
  const mw = medirTurno('json', (l) => lineas.push(l));
  const correr = (status: number, cuerpo: Record<string, unknown>) => {
    const { req, res } = falsos({ message: TEXTO_DE_LA_PERSONA, idTurno: 'mf2k9-abcdef1234', hablado: true }, { 'x-aura-origen': 'app' });
    mw(req, res, () => {});
    res.status(status).json(cuerpo);
  };
  correr(200, { reply: 'Tu saldo es…', via: 'qwen', estado: 'completo' });
  assert.deepEqual(lineas, [], 'un turno sano no ensucia el log');
  correr(502, { error: 'el nodo no contestó', emocion: 'preocupado' });
  correr(429, { error: 'Vas muy rápido. Dame un minuto y seguimos.', code: 'demasiados_turnos' });
  correr(409, { error: 'Sigo con eso…', codigo: 'en-curso', enCurso: true });
  assert.equal(lineas.length, 3);
  assert.match(lineas[0], /FALLA ruta=json status=502 .*id=9-abcdef1234 origen=app hablado=1 error="el nodo no contestó"/);
  assert.match(lineas[1], /status=429 codigo=demasiados_turnos/);
  assert.match(lineas[2], /status=409 codigo=en-curso/);
  for (const l of lineas) assert.ok(!l.includes('4455') && !l.includes('banco') && !l.includes('saldo'), `sin el texto de la persona ni la respuesta: ${l}`);
});

test('medidor en el stream: el `error` del turno, el `done` incompleto y la conexión cortada; el `done` completo, nada', () => {
  const lineas: string[] = [];
  const mw = medirTurno('stream', (l) => lineas.push(l));
  const correr = (eventos: [string, unknown][], fin: 'finish' | 'close') => {
    const { req, res } = falsos({ message: TEXTO_DE_LA_PERSONA, idTurno: 'mstream-0001' });
    mw(req, res, () => {});
    for (const [ev, d] of eventos) anotarEventoTurno(res.locals.notasTurno, ev, d);
    if (fin === 'finish') res.emit('finish');
    res.emit('close');
  };
  correr([['emocion', { emocion: 'neutral' }], ['delta', { text: 'Tu saldo' }], ['done', { reply: 'Tu saldo…', via: 'qwen', estado: 'completo' }]], 'finish');
  assert.deepEqual(lineas, []);
  correr([['error', { error: 'No pude pensar eso ahora.', codigo: 'caido' }]], 'finish');
  correr([['done', { reply: 'Tu sal', via: 'qwen', estado: 'error', parcial: true }]], 'finish');
  correr([['delta', { text: 'Tu saldo' }]], 'close');
  assert.equal(lineas.length, 3);
  assert.match(lineas[0], /FALLA ruta=stream status=200 codigo=caido .*error="No pude pensar eso ahora."/);
  assert.match(lineas[1], /FALLA .*via=qwen estado=error/);
  assert.match(lineas[2], /FALLA .*cortado=1/);
  for (const l of lineas) assert.ok(!l.includes('saldo') && !l.includes('4455'), l);
});

test('cupo del miembro por FRASE: el stream y sus dos reintentos por JSON (mismo idTurno) gastan uno solo', () => {
  const { cupoPorFrase } = seguridad as any;
  assert.equal(typeof cupoPorFrase, 'function', 'server/seguridad.ts exporta cupoPorFrase');
  const mw = cupoPorFrase(() => 'turno-miembro:ana@ejemplo.com', 2);
  const pedir = (idTurno?: string) => {
    const { req, res } = falsos(idTurno ? { idTurno } : {});
    let paso = false;
    mw(req, res, () => (paso = true));
    return paso ? 200 : res.statusCode;
  };
  // Antes: stream → JSON → JSON con el mismo idTurno eran 3 turnos del cupo; con cupo 2, el 2.º reintento
  // recibía 429 «demasiados_turnos» y la mesa decía «No alcanzo al cerebro remoto».
  assert.deepEqual([pedir('frase-uno-0001'), pedir('frase-uno-0001'), pedir('frase-uno-0001')], [200, 200, 200]);
  assert.equal(pedir('frase-dos-0002'), 200, 'otra frase sí gasta');
  assert.equal(pedir('frase-tres-0003'), 429, 'el cupo sigue valiendo para frases nuevas');
  // Un id no regala turnos sin fin: pasados los reintentos de una frase, vuelve a gastar.
  const otro = cupoPorFrase(() => 'turno-miembro:beto@ejemplo.com', 2);
  const r: number[] = [];
  for (let i = 0; i < 7; i++) {
    const { req, res } = falsos({ idTurno: 'mismo-id-00001' });
    let paso = false;
    otro(req, res, () => (paso = true));
    r.push(paso ? 200 : res.statusCode);
  }
  assert.deepEqual(r, [200, 200, 200, 200, 200, 200, 429], 'cada tres pedidos con el mismo id gastan uno: el id no regala turnos sin fin');
  // Sin idTurno (cliente viejo) o sin persona a quien cobrar: como siempre.
  const viejo = cupoPorFrase(() => 'turno-miembro:caro@ejemplo.com', 1);
  const sinId = () => {
    const { req, res } = falsos({});
    let paso = false;
    viejo(req, res, () => (paso = true));
    return paso ? 200 : res.statusCode;
  };
  assert.deepEqual([sinId(), sinId()], [200, 429]);
  const junta = cupoPorFrase(() => null, 1);
  const { req, res } = falsos({});
  let paso = 0;
  for (let i = 0; i < 3; i++) junta(req, res, () => paso++);
  assert.equal(paso, 3, 'la junta (sin clave) no tiene cupo por persona');
});
