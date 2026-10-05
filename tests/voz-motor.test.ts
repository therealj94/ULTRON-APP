/**
 * EL PROTOTIPO DE SPEECH ENGINE (server/voz-motor.ts, docs/voz/SPEECH-ENGINE.md), contra un ElevenLabs
 * FALSO: un cliente WebSocket de verdad (undici) que habla el protocolo documentado (`init`,
 * `user_transcript` con `event_id`, `ping`, `close` → `agent_response`, `pong`), y la ruta del LLM propio
 * de siempre con un cerebro falso EN PROCESO. Se prueba:
 *
 *  · turno → cerebro → respuesta a trozos con su `event_id` y el `is_final` vacío al final;
 *  · un turno nuevo mientras el anterior sale corta el cerebro de ese y no lo repite (interrupción nativa);
 *  · «ajá» no interrumpe: el cerebro sigue y lo que falta sale con el id nuevo, sin repetir lo oído;
 *  · cerebro lento → la frase de espera de siempre; cerebro que falla → una frase, nunca silencio; el
 *    respaldo se anota;
 *  · sin JWT válido o sin la llave del motor, no hay conexión;
 *  · con el interruptor apagado (cuenta, servidor o avatar sin recurso) el camino de siempre no cambia;
 *  · lo de «No usarlo» no viaja: el cerebro recibe solo la última frase, igual que por el agente;
 *  · una acción del cerebro sigue esperando su confirmación (y una frase a medias no la hace);
 *  · el vínculo por el teléfono si ElevenLabs no reenvía el pase, ping/pong, cierre y la comparación.
 */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import express from 'express';
import type { AddressInfo } from 'node:net';
import { WebSocket } from 'undici';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'voz-motor-'));
process.env.ULTRON_SESIONES_CERRADAS_ARCHIVO = path.join(dir, 'cerradas.json');
process.env.ULTRON_SESION_SECRETO = 'secreto-de-prueba-largo-para-las-sesiones-1234';
process.env.ULTRON_MEMORIA_BUCKET = '';
const LLAVE = 'sk_prueba_del_motor_0123456789';
process.env.ELEVENLABS_API_KEY = LLAVE;
process.env.AURA_MOTOR_VOZ = 'speech-engine';
process.env.ELEVENLABS_SPEECH_ENGINE_AURA_ES = 'seng_pruebaMotor01';
delete process.env.ELEVENLABS_SPEECH_ENGINE_CLAUDIO_ES;
after(() => fs.rmSync(dir, { recursive: true, force: true }));

const VA = await import('../server/voz-agente');
const M = await import('../server/voz-motor');
const MED = await import('../server/voz-medidas');
const { secretoDerivado, emitirSesion, sesionDe } = await import('../server/seguridad');
const { _reiniciarInterruptores, fijarInterruptores } = await import('../lib/interruptores');
type TurnoVoz = import('../server/voz-agente').TurnoVoz;

_reiniciarInterruptores({ listo: () => false });
MED._reiniciarMedidas();

/* ------------------------------------------------------------------ ayudas */

const conMotor: string[] = [];
let n = 0;
/** Una persona nueva (los cupos no se mezclan); con `motor`, su cuenta queda en el interruptor. */
async function persona(motor = true) {
  n++;
  const s = emitirSesion({ correo: `motor${n}@ordenglobal.org`, nombre: 'José', rol: 'Junta' });
  if (motor) {
    conMotor.push(s.correo);
    await fijarInterruptores({ motorVozCuentas: conMotor });
  }
  return s;
}

const b64u = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
/** Un JWT como el de ElevenLabs (HS256, secreto = SHA-256 de la llave). */
function jwt(o: { iss?: string; sub?: string; exp?: number; iat?: number; alg?: string; llave?: string } = {}) {
  const s = Math.floor(Date.now() / 1000);
  const cab = b64u({ alg: o.alg ?? 'HS256', typ: 'JWT' });
  const carga = b64u({ iss: o.iss ?? M.EMISOR_JWT, sub: o.sub ?? M.SUJETO_JWT, exp: o.exp ?? s + 60, iat: o.iat ?? s });
  const secreto = crypto.createHash('sha256').update(o.llave ?? LLAVE).digest();
  const firma = crypto.createHmac('sha256', secreto).update(`${cab}.${carga}`).digest('base64url');
  return `${cab}.${carga}.${firma}`;
}
const LLAVE_MOTOR = () => secretoDerivado(M.ETIQUETA_SECRETO_MOTOR);

type Cerebro = (t: TurnoVoz) => Promise<void>;
async function montar(cerebro: Cerebro, o: { puenteMs?: number; confirmarAccionMs?: number; graciaReintentoMs?: number; vincularMs?: number; turnoMs?: number } = {}) {
  const vistos: TurnoVoz[] = [];
  const pedidas: string[] = [];
  const elevenFalso: typeof fetch = (async (url: any) => {
    pedidas.push(String(url));
    return new Response(JSON.stringify({ token: 'tok-falso' }), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as any;
  const app = express();
  app.use(express.json({ limit: '1mb' }));
  const srv = http.createServer(app);
  const pasa: express.RequestHandler = (_q, _s, next) => next();
  const { llm } = VA.montarVozAgente(app, {
    exigirMesaODesk: pasa,
    limitar: () => pasa,
    sesionDe,
    turno: async (t) => {
      vistos.push(t);
      await cerebro(t);
    },
    fetch: elevenFalso,
    puenteMs: o.puenteMs ?? 0,
    etiquetas: false,
    confirmarAccionMs: o.confirmarAccionMs ?? 0,
    graciaReintentoMs: o.graciaReintentoMs ?? 300,
    turnoMs: o.turnoMs,
    nivelDe: () => 'junta',
    motorDe: M.motorDe,
    alTurno: MED.anotarDesdeRuta,
  });
  const mando: express.RequestHandler = (req, res, next) => (req.headers['x-mando'] === 'si' ? next() : res.status(403).json({ error: 'requiere mando' }));
  const motor = M.montarMotorVoz(app, srv, { llm, exigirMesaODesk: pasa, exigirMando: mando, limitar: () => pasa, sesionDe, vincularMs: o.vincularMs ?? 400 });
  srv.listen(0);
  await new Promise((r) => srv.once('listening', r));
  const puerto = (srv.address() as AddressInfo).port;
  return {
    base: `http://127.0.0.1:${puerto}`,
    ws: `ws://127.0.0.1:${puerto}${M.RUTA_MOTOR}`,
    vistos,
    pedidas,
    cerrar: () =>
      new Promise((r) => {
        motor.cerrar();
        srv.closeAllConnections?.();
        srv.close(r);
      }),
  };
}

/** Abre la conversación como el teléfono (POST /api/voz/agente) y devuelve lo que contestó el servidor. */
async function abrir(base: string, token: string, avatar = 'aura', idioma = 'es') {
  const r = await fetch(`${base}/api/voz/agente`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-ultron-sesion': token }, body: JSON.stringify({ avatar, idioma }) });
  return { status: r.status, j: (await r.json()) as any };
}

/** El ElevenLabs falso: un cliente WebSocket que habla el protocolo de Speech Engine. */
class ElevenFalso {
  recibidos: any[] = [];
  cerradoCon: number | null = null;
  private avisar: (() => void)[] = [];
  constructor(readonly ws: WebSocket) {
    ws.addEventListener('message', (e: any) => {
      this.recibidos.push(JSON.parse(String(e.data)));
      for (const f of this.avisar.splice(0)) f();
    });
    ws.addEventListener('close', (e: any) => {
      this.cerradoCon = e.code;
      for (const f of this.avisar.splice(0)) f();
    });
  }
  enviar(o: unknown) {
    this.ws.send(JSON.stringify(o));
  }
  async esperar<T>(f: () => T | undefined | false, ms = 3_000): Promise<T> {
    const hasta = Date.now() + ms;
    for (;;) {
      const v = f();
      if (v) return v;
      if (Date.now() > hasta) throw new Error(`no llegó a tiempo; recibido: ${JSON.stringify(this.recibidos).slice(0, 600)}`);
      await new Promise<void>((r) => {
        this.avisar.push(r);
        setTimeout(r, 25);
      });
    }
  }
  /** Los trozos de un `event_id` hasta su `is_final`: el texto entero. */
  async respuesta(eventId: number, ms = 3_000): Promise<string> {
    await this.esperar(() => this.recibidos.find((m) => m.type === 'agent_response' && m.event_id === eventId && m.is_final), ms);
    return this.trozos(eventId).join('');
  }
  trozos(eventId: number): string[] {
    return this.recibidos.filter((m) => m.type === 'agent_response' && m.event_id === eventId && !m.is_final).map((m) => m.content);
  }
  async cerrado(ms = 3_000) {
    return this.esperar(() => (this.cerradoCon !== null ? { codigo: this.cerradoCon } : undefined), ms);
  }
  cerrar() {
    try {
      this.ws.close();
    } catch {
      /* ya */
    }
  }
}

/** Conecta como ElevenLabs. 'rechazada' si el servidor no acepta el WebSocket. */
async function conectar(url: string, cabeceras: Record<string, string>): Promise<ElevenFalso | 'rechazada'> {
  const ws = new WebSocket(url, { headers: cabeceras } as any);
  return new Promise((listo) => {
    let abierta = false;
    ws.addEventListener('open', () => {
      abierta = true;
      listo(new ElevenFalso(ws));
    });
    const no = () => !abierta && listo('rechazada');
    ws.addEventListener('error', no);
    ws.addEventListener('close', no);
  });
}
const cabecerasBuenas = (pase?: string) => ({ [M.CABECERA_JWT]: jwt(), [M.CABECERA_LLAVE]: LLAVE_MOTOR(), ...(pase ? { 'x-pase': pase } : {}) });
async function llamada(s: { ws: string }, pase: string): Promise<ElevenFalso> {
  const c = await conectar(s.ws, cabecerasBuenas(pase));
  assert.notEqual(c, 'rechazada', 'con las dos llaves y el pase, conecta');
  const el = c as ElevenFalso;
  el.enviar({ type: 'init', conversation_id: `conv_${crypto.randomBytes(6).toString('hex')}` });
  return el;
}
const transcripcion = (eventId: number, historial: [string, string][]) => ({ type: 'user_transcript', event_id: eventId, user_transcript: historial.map(([role, content]) => ({ role, content })) });
const dormir = (ms: number) => new Promise((r) => setTimeout(r, ms));
const ultimas = (motor: 'agente' | 'speech-engine') => MED._medidas().filter((m) => m.motor === motor);

/* ------------------------------------------------------------------ la autenticidad */

test('el JWT de ElevenLabs: HS256 con el SHA-256 de la llave, emisor y sujeto fijos, 60 s de holgura', () => {
  const ahora = Date.now();
  const s = Math.floor(ahora / 1000);
  assert.deepEqual(M.verificarJwtMotor(jwt(), LLAVE, ahora), { ok: true });
  assert.deepEqual(M.verificarJwtMotor(`Bearer ${jwt()}`, LLAVE, ahora), { ok: true }, 'con «Bearer» delante también');
  assert.deepEqual(M.verificarJwtMotor(jwt(), `${LLAVE}_residency_eu`, ahora), { ok: true }, 'la llave de residencia firma sin su sufijo');
  assert.deepEqual(M.verificarJwtMotor(jwt({ exp: s - 30 }), LLAVE, ahora), { ok: true }, 'dentro de la holgura');
  const malos: [string, string][] = [
    ['', 'sin JWT'],
    ['a.b', 'sin JWT'],
    [jwt({ llave: 'otra-llave' }), 'firma que no coincide'],
    [jwt({ iss: 'https://otro' }), 'emisor equivocado'],
    [jwt({ sub: 'otro' }), 'sujeto equivocado'],
    [jwt({ exp: s - 120 }), 'vencido'],
    [jwt({ iat: s + 300, exp: s + 400 }), 'emitido en el futuro'],
    [jwt({ alg: 'none' }), 'algoritmo no aceptado'],
  ];
  for (const [t, motivo] of malos) assert.deepEqual(M.verificarJwtMotor(t, LLAVE, ahora), { ok: false, motivo }, motivo);
  // Cambiar la carga invalida la firma.
  const [c, , f] = jwt().split('.');
  assert.equal(M.verificarJwtMotor(`${c}.${b64u({ iss: M.EMISOR_JWT, sub: M.SUJETO_JWT, exp: s + 9999, iat: s })}.${f}`, LLAVE, ahora).ok, false);
  assert.equal(M.verificarJwtMotor(jwt(), '', ahora).ok, false, 'sin llave en el servidor no pasa nadie');
});

test('sin JWT válido o sin la llave del motor, el WebSocket no se abre (y el cerebro no se toca)', async () => {
  const s = await montar(async () => assert.fail('el cerebro no se toca'));
  try {
    const yo = await persona();
    const { j } = await abrir(s.base, yo.token);
    const casos: Record<string, string>[] = [
      {},
      { 'x-pase': j.pase },
      { [M.CABECERA_JWT]: jwt(), 'x-pase': j.pase },
      { [M.CABECERA_LLAVE]: LLAVE_MOTOR(), 'x-pase': j.pase },
      { [M.CABECERA_JWT]: jwt({ llave: 'otra' }), [M.CABECERA_LLAVE]: LLAVE_MOTOR(), 'x-pase': j.pase },
      { [M.CABECERA_JWT]: jwt({ exp: Math.floor(Date.now() / 1000) - 600 }), [M.CABECERA_LLAVE]: LLAVE_MOTOR(), 'x-pase': j.pase },
      { [M.CABECERA_JWT]: jwt(), [M.CABECERA_LLAVE]: 'llave-equivocada', 'x-pase': j.pase },
    ];
    for (const c of casos) assert.equal(await conectar(s.ws, c), 'rechazada', JSON.stringify(Object.keys(c)));
    const ok = await conectar(s.ws, cabecerasBuenas(j.pase));
    assert.notEqual(ok, 'rechazada');
    (ok as ElevenFalso).cerrar();
    // Otra ruta no es el motor.
    assert.equal(await conectar(s.ws.replace(M.RUTA_MOTOR, '/api/otra'), cabecerasBuenas(j.pase)), 'rechazada');
  } finally {
    await s.cerrar();
  }
});

/* ------------------------------------------------------------------ el turno */

test('/api/voz/agente con el motor: token del recurso de Speech Engine, la primera frase y el mismo pase', async () => {
  const s = await montar(async () => {});
  try {
    const yo = await persona();
    const { status, j } = await abrir(s.base, yo.token);
    assert.equal(status, 200);
    assert.equal(s.pedidas.at(-1), 'https://api.elevenlabs.io/v1/convai/conversation/token?agent_id=seng_pruebaMotor01');
    assert.equal(j.agente, 'seng_pruebaMotor01');
    assert.equal(j.motor, 'speech-engine');
    assert.equal(j.primerMensaje, 'Aquí estoy. Te escucho.');
    assert.equal(VA.leerPase(j.pase)?.correo, yo.correo);
  } finally {
    await s.cerrar();
  }
});

test('turno → el mismo cerebro → respuesta a trozos con su event_id y un is_final vacío; el cerebro recibe lo mismo que por el agente', async () => {
  const s = await montar(async (t) => {
    t.enviar('tools', { tools: [] });
    t.enviar('delta', { text: 'Hola José. ', voz: 'Hola José. ' });
    t.enviar('delta', { text: 'Todo en orden.', voz: 'Todo en orden.' });
    t.enviar('done', { reply: 'Hola José. Todo en orden.', via: 'prueba' });
  });
  try {
    const yo = await persona();
    const { j } = await abrir(s.base, yo.token);
    const el = await llamada(s, j.pase);
    el.enviar(transcripcion(1, [['user', '¿Cómo vamos?']]));
    assert.equal(await el.respuesta(1), 'Hola José. Todo en orden.');
    assert.deepEqual(el.trozos(1), ['Hola José. ', 'Todo en orden.']);
    const fin = el.recibidos.filter((m) => m.event_id === 1 && m.is_final);
    assert.deepEqual(fin, [{ type: 'agent_response', content: '', event_id: 1, is_final: true }], 'un solo final, vacío');
    // La misma frase por el camino de siempre (la ruta HTTP) le llega al cerebro IGUAL.
    const r = await fetch(`${s.base}/api/voz/llm`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${secretoDerivado(VA.ETIQUETA_SECRETO_LLM)}`, 'x-pase': j.pase },
      body: JSON.stringify({ model: 'aura', messages: [{ role: 'user', content: '¿Cómo vamos?' }] }),
    });
    await r.text();
    assert.equal(s.vistos.length, 2);
    assert.deepEqual(s.vistos[0].body, s.vistos[1].body, 'el mismo cuerpo del turno');
    assert.deepEqual(s.vistos[0].persona, s.vistos[1].persona, 'la misma persona y el mismo nivel');
    assert.equal((s.vistos[0].persona as any).token, undefined, 'ninguna sesión viaja');
    assert.equal((s.vistos[0].body as any).sesion, undefined, 'sin mando');
    // Las dos medidas, una por camino, con los mismos campos.
    const se = ultimas('speech-engine').at(-1)!;
    const ag = ultimas('agente').at(-1)!;
    assert.deepEqual(Object.keys(se).sort(), Object.keys(ag).sort());
    assert.equal(typeof se.primerTextoMs, 'number');
    assert.equal(se.interrupcion, null);
    assert.equal(JSON.stringify(se).includes('Hola'), false, 'la medida no lleva contenido');
    el.cerrar();
  } finally {
    await s.cerrar();
  }
});

test('interrupción: un event_id nuevo mientras sale el anterior corta su cerebro, no lo repite y se anota como nativa', async () => {
  let cortado = false;
  const s = await montar(async (t) => {
    if (t.body.message.startsWith('cuéntame')) {
      t.enviar('delta', { text: 'Uno. ', voz: 'Uno. ' });
      await new Promise<void>((r) => t.senal.addEventListener('abort', () => r(), { once: true }));
      cortado = true;
      return;
    }
    t.enviar('delta', { text: 'Vale, dime.', voz: 'Vale, dime.' });
    t.enviar('done', { reply: 'Vale, dime.' });
  });
  try {
    const yo = await persona();
    const { j } = await abrir(s.base, yo.token);
    const el = await llamada(s, j.pase);
    el.enviar(transcripcion(1, [['user', 'cuéntame la historia larga']]));
    await el.esperar(() => el.trozos(1).length > 0);
    const antes = el.recibidos.length;
    el.enviar(transcripcion(2, [['user', 'cuéntame la historia larga'], ['agent', 'Uno.'], ['user', 'espera, otra cosa']]));
    assert.equal(await el.respuesta(2), 'Vale, dime.');
    await el.esperar(() => cortado);
    assert.ok(cortado, 'el cerebro del turno cortado recibió la señal');
    assert.ok(!el.recibidos.slice(antes).some((m) => m.event_id === 1), 'nada más del turno viejo después del nuevo');
    assert.ok(!el.trozos(2).join('').includes('Uno'), 'no repite lo del turno cortado');
    assert.equal(s.vistos.length, 2);
    assert.equal(ultimas('speech-engine').at(-1)?.interrupcion, 'nativa');
    el.cerrar();
  } finally {
    await s.cerrar();
  }
});

test('el camino de siempre anota su interrupción como inferida (la misma medida, para comparar)', async () => {
  const s = await montar(async (t) => {
    if (t.body.message === 'primera') {
      t.enviar('delta', { text: 'Empiezo a contarte algo bastante largo. ', voz: 'Empiezo a contarte algo bastante largo. ' });
      await new Promise<void>((r) => t.senal.addEventListener('abort', () => r(), { once: true }));
      return;
    }
    t.enviar('delta', { text: 'Dime.', voz: 'Dime.' });
    t.enviar('done', { reply: 'Dime.' });
  });
  try {
    const yo = await persona(false);
    const { j } = await abrir(s.base, yo.token);
    assert.equal(j.motor, undefined);
    const pedir = (msgs: unknown[], signal?: AbortSignal) =>
      fetch(`${s.base}/api/voz/llm`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${secretoDerivado(VA.ETIQUETA_SECRETO_LLM)}`, 'x-pase': j.pase }, body: JSON.stringify({ messages: msgs }), signal });
    const ctrl = new AbortController();
    const r1 = await pedir([{ role: 'user', content: 'primera' }], ctrl.signal);
    const lector = r1.body!.getReader();
    await lector.read();
    await lector.read();
    ctrl.abort();
    await dormir(50);
    await (await pedir([{ role: 'user', content: 'primera' }, { role: 'assistant', content: 'Empiezo a contarte...' }, { role: 'user', content: 'para' }])).text();
    assert.equal(ultimas('agente').at(-1)?.interrupcion, 'inferida');
  } finally {
    await s.cerrar();
  }
});

test('«ajá» mientras habla no interrumpe: el cerebro sigue y lo que falta sale con el id nuevo, sin repetir lo oído', async () => {
  let cortado = false;
  const s = await montar(async (t) => {
    t.senal.addEventListener('abort', () => (cortado = true), { once: true });
    t.enviar('delta', { text: 'Primero esto. ', voz: 'Primero esto. ' });
    await dormir(250);
    t.enviar('delta', { text: 'Y luego aquello.', voz: 'Y luego aquello.' });
    t.enviar('done', { reply: 'Primero esto. Y luego aquello.' });
  });
  try {
    const yo = await persona();
    const { j } = await abrir(s.base, yo.token);
    const el = await llamada(s, j.pase);
    el.enviar(transcripcion(1, [['user', '¿qué hago?']]));
    await el.esperar(() => el.trozos(1).length > 0);
    el.enviar(transcripcion(2, [['user', '¿qué hago?'], ['agent', 'Primero esto.'], ['user', 'Ajá.']]));
    assert.equal(await el.respuesta(2), 'Y luego aquello.', 'sigue con el id nuevo, sin repetir «Primero esto.»');
    assert.equal(cortado, false, 'el cerebro no se cortó');
    assert.equal(s.vistos.length, 1, 'el «ajá» no llegó al cerebro como turno');
    const se = ultimas('speech-engine');
    assert.ok(se.some((m) => m.asentimiento), 'se anota como asentimiento');
    assert.ok(!se.slice(-2).some((m) => m.interrupcion), 'y no como interrupción');
    el.cerrar();
  } finally {
    await s.cerrar();
  }
});

test('asentir: qué cuenta y desde dónde se sigue (sin repetir lo que ya oyó)', () => {
  for (const t of ['ajá', 'Ajá.', 'mjm', 'sí, sí', 'ok', 'Uh-huh', 'got it', 'ah ok', 'vale vale']) assert.equal(M.esAsentimiento(t), true, t);
  for (const t of ['', 'sí, llama a Beto', 'espera', 'no', 'ok pero cambia la hora', 'ajá ajá ajá ajá ajá']) assert.equal(M.esAsentimiento(t), false, t);
  assert.equal(M.restoTrasOido('Primero esto. Y luego aquello.', 'Primero esto.'), 'Y luego aquello.');
  assert.equal(M.restoTrasOido('Primero esto. Y luego aquello.', 'Primero es...'), 'esto. Y luego aquello.', 'cortada a mitad de palabra: esa palabra entera');
  assert.equal(M.restoTrasOido('[warmly] Primero esto. Y luego aquello.', 'Primero esto.'), 'Y luego aquello.', 'las etiquetas de voz no cuentan');
  assert.equal(M.restoTrasOido('Primero esto.', ''), 'Primero esto.');
  assert.equal(M.restoTrasOido('Primero esto.', 'Otra cosa distinta'), '', 'si no se sabe dónde quedó, no se repite nada');
});

test('las listas del motor son las de los agentes (asentir y la primera frase): no se separan', async () => {
  const A = await import('../scripts/elevenlabs-agentes');
  assert.deepEqual(M.ASENTIR_MOTOR, A.ASENTIR);
  assert.deepEqual(M.PRIMERA_MOTOR, A.PRIMERA);
});

test('el mismo event_id otra vez no es otro turno (ni se piensa dos veces)', async () => {
  const s = await montar(async (t) => {
    await dormir(80);
    t.enviar('delta', { text: 'Una vez.', voz: 'Una vez.' });
    t.enviar('done', { reply: 'Una vez.' });
  });
  try {
    const yo = await persona();
    const { j } = await abrir(s.base, yo.token);
    const el = await llamada(s, j.pase);
    el.enviar(transcripcion(7, [['user', 'hola']]));
    el.enviar(transcripcion(7, [['user', 'hola']]));
    assert.equal(await el.respuesta(7), 'Una vez.');
    await dormir(100);
    assert.equal(s.vistos.length, 1);
    assert.ok(ultimas('speech-engine').some((m) => m.repetido));
    el.cerrar();
  } finally {
    await s.cerrar();
  }
});

/* ------------------------------------------------------------------ lento, fallos y respaldo */

test('cerebro lento: suena la frase de espera de siempre antes que la respuesta', async () => {
  const s = await montar(
    async (t) => {
      await dormir(400);
      t.enviar('delta', { text: 'Listo, ya está.', voz: 'Listo, ya está.' });
      t.enviar('done', { reply: 'Listo, ya está.' });
    },
    { puenteMs: 60 }
  );
  try {
    const yo = await persona();
    const { j } = await abrir(s.base, yo.token);
    const el = await llamada(s, j.pase);
    el.enviar(transcripcion(1, [['user', 'busca el precio del oro']]));
    const todo = await el.respuesta(1);
    const trozos = el.trozos(1);
    assert.ok(trozos.length >= 2);
    assert.ok(trozos[0].trim() && !trozos[0].includes('Listo'), `primero la espera: «${trozos[0]}»`);
    assert.ok(todo.endsWith('Listo, ya está.'));
    assert.equal(ultimas('speech-engine').at(-1)?.puente, true);
    el.cerrar();
  } finally {
    await s.cerrar();
  }
});

test('cerebro que falla: una frase de persona, nunca silencio; el respaldo del cerebro se anota', async () => {
  const s = await montar(async (t) => {
    if (t.body.message === 'falla') throw new Error('el nodo no contestó');
    t.enviar('delta', { text: 'Te contesto con el otro.', voz: 'Te contesto con el otro.' });
    t.enviar('done', { reply: 'Te contesto con el otro.', via: 'tools-fallback' });
  });
  try {
    const yo = await persona();
    const { j } = await abrir(s.base, yo.token);
    const el = await llamada(s, j.pase);
    el.enviar(transcripcion(1, [['user', 'falla']]));
    assert.equal(await el.respuesta(1), VA.PHRASES.corte.es);
    assert.equal(ultimas('speech-engine').at(-1)?.error, true);
    el.enviar(transcripcion(2, [['user', 'falla'], ['agent', VA.PHRASES.corte.es], ['user', 'otra vez']]));
    assert.equal(await el.respuesta(2), 'Te contesto con el otro.');
    assert.equal(ultimas('speech-engine').at(-1)?.respaldo, true);
    el.cerrar();
  } finally {
    await s.cerrar();
  }
});

test('la ruta que se rompe o frena: una frase y la llamada sigue; sin permiso, la llamada se cierra', async () => {
  const pase = 'pase-de-prueba';
  const casos: [express.RequestHandler, string | null][] = [
    [async () => Promise.reject(new Error('rota')), VA.PHRASES.corte.es],
    [(_q, r) => void r.status(429).json({ error: { message: 'freno' } }), VA.PHRASES.rapido.es],
    [(_q, r) => void r.status(500).json({ error: { message: 'x' } }), VA.PHRASES.corte.es],
    [(_q, r) => void r.status(401).json({ error: { message: 'pase vencido' } }), null],
  ];
  for (const [llm, frase] of casos) {
    const enviados: any[] = [];
    let cerrada: number | null = null;
    const se = new M.SesionMotor({ llm, enviar: (m) => enviados.push(m), cerrar: (c) => (cerrada = c), ip: 'x', paseCabecera: pase, esperarPase: async () => null, permitido: () => true });
    await se.recibir({ type: 'init', conversation_id: 'conv_1' });
    await se.recibir(transcripcion(1, [['user', 'hola']]));
    await dormir(10);
    if (frase) {
      assert.deepEqual(
        enviados.filter((m) => m.type === 'agent_response'),
        [
          { type: 'agent_response', content: frase, event_id: 1, is_final: false },
          { type: 'agent_response', content: '', event_id: 1, is_final: true },
        ]
      );
      assert.equal(cerrada, null);
    } else {
      assert.equal(cerrada, 1008, 'sin permiso se cuelga, como hoy');
      assert.equal(enviados.length, 0);
    }
  }
});

/* ------------------------------------------------------------------ apagado */

test('apagado por cuenta: /api/voz/agente da el agente de siempre y una llamada del motor con ese pase se cierra sin pensar', async () => {
  const s = await montar(async () => assert.fail('no se piensa'));
  try {
    const yo = await persona(false);
    const { j } = await abrir(s.base, yo.token);
    assert.equal(j.agente, 'agent_6801m3qbvv83fzgvg42eev85m8m5');
    assert.equal(s.pedidas.at(-1), 'https://api.elevenlabs.io/v1/convai/conversation/token?agent_id=agent_6801m3qbvv83fzgvg42eev85m8m5');
    assert.equal('motor' in j, false);
    assert.equal('primerMensaje' in j, false);
    const el = await llamada(s, j.pase);
    el.enviar(transcripcion(1, [['user', 'hola']]));
    assert.equal((await el.cerrado()).codigo, 1008);
    assert.equal(s.vistos.length, 0);
  } finally {
    await s.cerrar();
  }
});

test('apagado por avatar sin recurso: el agente de siempre aunque la cuenta tenga el motor', async () => {
  const s = await montar(async () => {});
  try {
    const yo = await persona();
    const { j } = await abrir(s.base, yo.token, 'claudio', 'es');
    assert.equal(j.agente, 'agent_3501m3qbvyc5e9b946hm5byv3c7g');
    assert.equal('motor' in j, false);
  } finally {
    await s.cerrar();
  }
});

test('apagado en el servidor (sin AURA_MOTOR_VOZ): ni WebSocket, ni vínculo, ni motor para nadie', async () => {
  const antes = process.env.AURA_MOTOR_VOZ;
  delete process.env.AURA_MOTOR_VOZ;
  const s = await montar(async () => {});
  try {
    const yo = await persona();
    const { j } = await abrir(s.base, yo.token);
    assert.equal(j.agente, 'agent_6801m3qbvv83fzgvg42eev85m8m5', 'la cuenta está en la lista, pero el servidor lo tiene apagado');
    assert.equal('motor' in j, false);
    assert.equal(await conectar(s.ws, cabecerasBuenas(j.pase)), 'rechazada');
    const v = await fetch(`${s.base}${M.RUTA_MOTOR}/vincular`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-ultron-sesion': yo.token }, body: JSON.stringify({ pase: j.pase, conversacion: 'conv_123456' }) });
    assert.equal(v.status, 404);
    assert.equal(M.motorDe(yo.correo, 'aura', 'es'), null);
  } finally {
    process.env.AURA_MOTOR_VOZ = antes;
    await s.cerrar();
  }
});

/* ------------------------------------------------------------------ lo que no puede cambiar */

test('«No usarlo»: el historial de ElevenLabs no llega al cerebro, solo la última frase (igual que por el agente)', async () => {
  const s = await montar(async (t) => {
    t.enviar('delta', { text: 'Soleado.', voz: 'Soleado.' });
    t.enviar('done', { reply: 'Soleado.' });
  });
  try {
    const yo = await persona();
    const { j } = await abrir(s.base, yo.token);
    const el = await llamada(s, j.pase);
    el.enviar(
      transcripcion(1, [
        ['user', 'mi diagnóstico es diabetes, no lo uses'],
        ['agent', 'Entendido, tu diagnóstico de diabetes no lo uso.'],
        ['user', '¿qué tal el clima?'],
      ])
    );
    await el.respuesta(1);
    assert.equal(s.vistos[0].body.message, '¿qué tal el clima?');
    assert.equal(JSON.stringify(s.vistos[0]).includes('diabetes'), false, 'lo dicho antes no viaja al cerebro: su contexto lo arma él, con la vista autorizada');
    el.cerrar();
  } finally {
    await s.cerrar();
  }
  // Un solo camino al cerebro: el motor no lee memoria ni perfil, y server.ts le da la MISMA ruta del LLM propio.
  const fuente = fs.readFileSync(new URL('../server/voz-motor.ts', import.meta.url), 'utf8');
  for (const m of ['memoria', 'conocer-persona', 'perfil-persona', 'contexto-turno', 'prompt-turno', 'episodios']) assert.ok(!fuente.includes(`/${m}'`), `voz-motor no importa ${m}`);
  const servidor = fs.readFileSync(new URL('../server.ts', import.meta.url), 'utf8');
  assert.match(servidor, /const \{ llm: rutaLlmVoz \} = montarVozAgente\(/);
  assert.match(servidor, /montarMotorVoz\(app, httpServer, \{ llm: rutaLlmVoz,/);
  assert.match(servidor, /soloConsulta: true, senal: t\.senal/, 'el turno de voz sigue siendo solo consulta (sin mando, sin ejecutar lo sensible)');
});

test('una acción del cerebro espera su confirmación: con la frase entera se hace una vez; si llega otra frase antes, no se hace', async () => {
  const hechas: string[] = [];
  const s = await montar(
    async (t) => {
      t.retener.hacer(() => hechas.push(t.body.message));
      t.enviar('delta', { text: 'Va.', voz: 'Va.' });
      t.enviar('done', { reply: 'Va.', acciones: [{ accion: { tipo: 'recordatorio' } }] });
    },
    { confirmarAccionMs: 250 }
  );
  try {
    const yo = await persona();
    const { j } = await abrir(s.base, yo.token);
    const el = await llamada(s, j.pase);
    // La frase a medias del turno especulativo: llega la entera antes de que se confirme.
    el.enviar(transcripcion(1, [['user', 'pon una alarma en tres']]));
    await el.esperar(() => el.trozos(1).length > 0);
    el.enviar(transcripcion(2, [['user', 'pon una alarma en treinta minutos']]));
    await el.respuesta(2, 3_000);
    await dormir(600);
    assert.deepEqual(hechas, ['pon una alarma en treinta minutos'], 'solo la frase entera, una vez');
    assert.equal(el.recibidos.some((m) => m.event_id === 1 && m.is_final), false, 'la a medias no se cerró como dicha');
    el.cerrar();
  } finally {
    await s.cerrar();
  }
});

/* ------------------------------------------------------------------ el vínculo, ping y cierre */

test('sin X-Pase de ElevenLabs: el teléfono ata su conversación (con su sesión y su pase) y la llamada sigue', async () => {
  const s = await montar(async (t) => {
    t.enviar('delta', { text: 'Te oigo.', voz: 'Te oigo.' });
    t.enviar('done', { reply: 'Te oigo.' });
  });
  try {
    const yo = await persona();
    const otro = await persona();
    const { j } = await abrir(s.base, yo.token);
    const c = (await conectar(s.ws, cabecerasBuenas())) as ElevenFalso;
    c.enviar({ type: 'init', conversation_id: 'conv_vinculo_1' });
    c.enviar(transcripcion(1, [['user', '¿me oyes?']]));
    const vincular = (token: string, pase: string) =>
      fetch(`${s.base}${M.RUTA_MOTOR}/vincular`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-ultron-sesion': token }, body: JSON.stringify({ pase, conversacion: 'conv_vinculo_1' }) });
    assert.equal((await vincular(otro.token, j.pase)).status, 403, 'el pase de otra persona no');
    assert.equal((await vincular(yo.token, j.pase)).status, 200);
    assert.equal(await c.respuesta(1), 'Te oigo.');
    c.cerrar();
    // Sin vínculo a tiempo: se cuelga sin pensar.
    const d = (await conectar(s.ws, cabecerasBuenas())) as ElevenFalso;
    d.enviar({ type: 'init', conversation_id: 'conv_sin_vinculo' });
    d.enviar(transcripcion(1, [['user', 'hola']]));
    assert.equal((await d.cerrado(3_000)).codigo, 1008);
    assert.equal(s.vistos.length, 1);
  } finally {
    await s.cerrar();
  }
});

test('ping → pong; `close` de ElevenLabs corta el turno en curso y cierra; un historial grande (>64 KB) llega entero', async () => {
  let cortado = false;
  let largo = 0;
  const s = await montar(async (t) => {
    if (t.body.message === 'largo') {
      t.enviar('delta', { text: 'Recibido.', voz: 'Recibido.' });
      t.enviar('done', { reply: 'Recibido.' });
      return;
    }
    t.enviar('delta', { text: 'Pienso…', voz: 'Pienso…' });
    await new Promise<void>((r) => t.senal.addEventListener('abort', () => r(), { once: true }));
    cortado = true;
  });
  try {
    const yo = await persona();
    const { j } = await abrir(s.base, yo.token);
    const el = await llamada(s, j.pase);
    el.enviar({ type: 'ping' });
    await el.esperar(() => el.recibidos.find((m) => m.type === 'pong'));
    const relleno = 'x'.repeat(1_000);
    const historial: [string, string][] = [];
    for (let i = 0; i < 80; i++) historial.push(['user', relleno], ['agent', relleno]);
    historial.push(['user', 'largo']);
    largo = JSON.stringify(transcripcion(1, historial)).length;
    el.enviar(transcripcion(1, historial));
    assert.equal(await el.respuesta(1), 'Recibido.');
    assert.ok(largo > 65_536);
    el.enviar(transcripcion(2, [['user', 'piensa algo']]));
    await el.esperar(() => el.trozos(2).length > 0);
    el.enviar({ type: 'close' });
    await el.cerrado();
    await el.esperar(() => cortado);
    assert.ok(cortado, 'colgar corta el cerebro');
  } finally {
    await s.cerrar();
  }
});

/* ------------------------------------------------------------------ la comparación */

test('la comparación: solo el dueño; los dos caminos con los mismos campos; la regla de decisión', async () => {
  const s = await montar(async () => {});
  try {
    assert.equal((await fetch(`${s.base}/api/voz/comparacion`)).status, 403);
    const r = await fetch(`${s.base}/api/voz/comparacion`, { headers: { 'x-mando': 'si' } });
    assert.equal(r.status, 200);
    const j: any = await r.json();
    assert.ok(j.total.agente.turnos >= 1 && j.total['speech-engine'].turnos >= 1, `hay medidas de los dos caminos: ${JSON.stringify(j.total).slice(0, 400)}`);
    assert.equal(j.minimoPorCamino, 20);
    const red = await fetch(`${s.base}/api/voz/comparacion/red`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-mando': 'si' }, body: JSON.stringify({ red: 'WiFi casa!' }) });
    assert.equal(((await red.json()) as any).red, 'wificasa');
    MED.fijarRedVoz('');
  } finally {
    await s.cerrar();
  }
  const m = (motor: 'agente' | 'speech-engine', primer: number, extra: Partial<import('../server/voz-medidas').MedidaTurnoVoz> = {}) => ({
    motor, t: 0, conv: 'c', primerTextoMs: primer, cerebroMs: primer, totalMs: primer, puente: false, interrupcion: null, repetido: false, asentimiento: false, respaldo: false, error: false, tarde: false, cortado: false, red: '', ...extra,
  });
  const lista = (motor: 'agente' | 'speech-engine', base: number, k = 20, extra = {}) => Array.from({ length: k }, (_, i) => m(motor, base + i * 10, i < 3 ? { interrupcion: motor === 'agente' ? 'inferida' : 'nativa', ...extra } : extra));
  const v = (a: any[], b: any[]) => MED.veredicto(MED.resumir(a), MED.resumir(b));
  assert.equal(v(lista('agente', 800), lista('speech-engine', 600)).adoptar, true, 'mejor en p50 y p95, mismas interrupciones, sin regresiones');
  assert.equal(v(lista('agente', 800, 19), lista('speech-engine', 600)).suficientes, false, 'menos de 20 turnos: no se decide');
  assert.equal(v(lista('agente', 800), [...lista('speech-engine', 600, 18), m('speech-engine', 5_000), m('speech-engine', 5_000)]).primerTextoP95Mejor, false, 'p95 peor: no');
  const conError = lista('speech-engine', 600);
  conError[10] = { ...conError[10], error: true };
  assert.deepEqual(v(lista('agente', 800), conError).regresiones, ['errores'], 'más errores: no');
  const sinInterr = lista('speech-engine', 600).map((x) => ({ ...x, interrupcion: null }));
  assert.equal(v(lista('agente', 800), sinInterr).interrupcionesIgualOMas, false, 'detecta menos interrupciones: no');
  assert.equal(MED.percentil([5, 1, 3, 2, 4], 50), 3);
  assert.equal(MED.percentil([], 95), null);
});

test('lo que mide ElevenLabs (scripts/voz-comparar-eleven.ts): percentiles por métrica e interrupciones, sin leer lo dicho', async () => {
  const { resumirConversaciones } = await import('../scripts/voz-comparar-eleven');
  const conv = (ttfb: number[], interrumpidos: number[]) => ({
    transcript: [
      { role: 'user', message: 'mi secreto', ignored_as_backchannel: false },
      ...ttfb.map((x, i) => ({ role: 'agent', message: 'algo privado', interrupted: interrumpidos.includes(i), conversation_turn_metrics: { metrics: { convai_llm_service_ttfb: { elapsed_time: x } } } })),
      { role: 'user', message: 'ajá', ignored_as_backchannel: true },
    ],
  });
  const r = resumirConversaciones([conv([0.5, 0.7, 0.9], [1]), conv([0.6], [])]);
  assert.equal(r.conversaciones, 2);
  assert.equal(r.turnosAgente, 4);
  assert.equal(r.interrumpidos, 1);
  assert.equal(r.ignoradosComoAsentir, 2);
  assert.deepEqual(r.metricas.convai_llm_service_ttfb, { n: 4, p50: 0.6, p95: 0.9 });
  assert.equal(JSON.stringify(r).includes('secreto') || JSON.stringify(r).includes('privado'), false, 'nada de lo dicho');
});

test('la configuración del recurso de prueba (scripts/elevenlabs-motor.ts): copia voz y modelos del agente, las dos llaves y lo de los agentes', async () => {
  const S = await import('../scripts/elevenlabs-motor');
  const A = await import('../scripts/elevenlabs-agentes');
  const agente = { conversation_config: { tts: { model_id: 'modelo-del-agente', voice_id: 'voz-del-agente' }, turn: { turn_model: 'turno-del-agente', turn_eagerness: 'eager', speculative_turn: true } } };
  const c = S.cuerpoMotor({ avatar: 'aura', idioma: 'es', base: 'https://aura-fp.onrender.com', secretId: 'sec_1', agente });
  assert.equal(c.speech_engine.ws_url, 'wss://aura-fp.onrender.com/api/voz/motor');
  assert.deepEqual(c.speech_engine.request_headers, { 'X-Aura-Motor': { secret_id: 'sec_1' }, 'X-Pase': { variable_name: 'pase' } });
  assert.deepEqual(c.tts, { model_id: 'modelo-del-agente', voice_id: 'voz-del-agente' }, 'la misma voz y el mismo modelo que el agente');
  assert.equal(c.turn.turn_model, 'turno-del-agente');
  assert.deepEqual(c.turn.interruption_ignore_terms, A.ASENTIR.es);
  assert.equal(c.cascade_timeout_seconds, 12);
  assert.deepEqual(c.overrides, { first_message: true });
  assert.throws(() => S.urlMotor('http://inseguro.example'), /https/);
  const fuente = fs.readFileSync(new URL('../scripts/elevenlabs-motor.ts', import.meta.url), 'utf8') + fs.readFileSync(new URL('../server/voz-motor.ts', import.meta.url), 'utf8');
  assert.equal(/eleven_(flash|turbo|multilingual|v\d)/.test(fuente), false, 'ningún modelo escrito en el código del motor');
});
