/**
 * La conversación fluida (server/voz-agente.ts): ElevenLabs le pide cada turno a nuestro cerebro
 * en formato OpenAI y lo recibe en streaming. Aquí se prueba el pase, el formato y la ruta entera
 * contra un /api/turno/stream falso: el texto llega a trozos, sin marcas de expresión, y si la
 * persona interrumpe (se cierra la petición) el turno de adentro se aborta.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import type { AddressInfo } from 'node:net';
import { emitirPase, leerPase, montarVozAgente, trozoOpenAI, ultimoDeLaPersona, ETIQUETA_SECRETO_LLM } from '../server/voz-agente';
import { secretoDerivado } from '../server/seguridad';

const persona = { correo: 'j.ordonez@ordenglobal.org', nombre: 'José', rol: 'Junta' };

test('el pase: firmado, con avatar e idioma, vence a los 30 minutos y no se puede tocar', () => {
  const ahora = Date.now();
  const p = emitirPase(persona, 'claudio', 'en', ahora);
  const l = leerPase(p, ahora + 60_000);
  assert.equal(l?.correo, persona.correo);
  assert.equal(l?.avatar, 'claudio');
  assert.equal(l?.idioma, 'en');
  assert.equal(leerPase(p, ahora + 31 * 60_000), null, 'vencido');
  const [pre, cuerpo, firma] = p.split('.');
  const otro = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(cuerpo, 'base64url').toString()), correo: 'otro@x.org' })).toString('base64url');
  assert.equal(leerPase(`${pre}.${otro}.${firma}`, ahora), null, 'cuerpo cambiado');
  assert.equal(leerPase('u1.abc.def'), null, 'una sesión de la app no es un pase');
});

test('formato OpenAI: el último mensaje de la persona y los trozos del stream', () => {
  assert.equal(ultimoDeLaPersona([{ role: 'system', content: 'x' }, { role: 'user', content: ' hola ' }, { role: 'assistant', content: 'qué tal' }]), 'hola');
  assert.equal(ultimoDeLaPersona([{ role: 'user', content: [{ type: 'text', text: 'dos' }, { type: 'text', text: 'partes' }] }]), 'dos partes');
  assert.equal(ultimoDeLaPersona(null), '');
  const t = trozoOpenAI('id1', 'aura', 'Hola');
  assert.match(t, /^data: \{.*\}\n\n$/);
  const j = JSON.parse(t.slice(6));
  assert.equal(j.object, 'chat.completion.chunk');
  assert.equal(j.choices[0].delta.content, 'Hola');
  assert.equal(JSON.parse(trozoOpenAI('id1', 'aura', null, 'stop').slice(6)).choices[0].finish_reason, 'stop');
});

/** Un servidor con la ruta real y un cerebro falso que contesta a trozos. */
async function montar(cerebro: (req: express.Request, res: express.Response) => void) {
  const app = express();
  app.use(express.json());
  const vistos: any[] = [];
  app.post('/api/turno/stream', (req, res) => {
    vistos.push({ body: req.body, sesion: req.headers['x-ultron-sesion'] });
    cerebro(req, res);
  });
  const pasa: express.RequestHandler = (_q, _s, n) => n();
  const srv = app.listen(0);
  await new Promise((r) => srv.once('listening', r));
  const puerto = (srv.address() as AddressInfo).port;
  montarVozAgente(app, { exigirMesaODesk: pasa, limitar: () => pasa, sesionDe: () => null, puerto });
  return { puerto, vistos, cerrar: () => new Promise((r) => srv.close(r)) };
}

const sse = (res: express.Response) => {
  res.setHeader('Content-Type', 'text/event-stream');
  return (evento: string, datos: unknown) => res.write(`event: ${evento}\ndata: ${JSON.stringify(datos)}\n\n`);
};

test('la ruta del LLM: exige el secreto y el pase, y devuelve el turno del cerebro a trozos', async () => {
  const s = await montar((_req, res) => {
    const enviar = sse(res);
    enviar('tools', { tools: [] });
    enviar('delta', { text: 'Hola José. ', voz: '[risa] Hola José. ' });
    enviar('delta', { text: 'Todo bien.', voz: 'Todo bien.' });
    enviar('done', { reply: 'Hola José. Todo bien.' });
    res.end();
  });
  try {
    const url = `http://127.0.0.1:${s.puerto}/api/voz/llm/chat/completions`;
    const cuerpo = JSON.stringify({ model: 'aura', stream: true, messages: [{ role: 'user', content: '¿Cómo estás?' }] });
    const sin = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: cuerpo });
    assert.equal(sin.status, 401, 'sin secreto no');
    const malo = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${secretoDerivado(ETIQUETA_SECRETO_LLM)}` }, body: cuerpo });
    assert.equal(malo.status, 401, 'sin pase no');

    const r = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${secretoDerivado(ETIQUETA_SECRETO_LLM)}`, 'x-pase': emitirPase(persona, 'ojos', 'es') },
      body: cuerpo,
    });
    assert.equal(r.status, 200);
    const texto = await r.text();
    const trozos = texto
      .split('\n\n')
      .filter((l) => l.startsWith('data: {'))
      .map((l) => JSON.parse(l.slice(6)));
    assert.equal(trozos[0].choices[0].delta.role, 'assistant');
    const dicho = trozos.map((t) => t.choices[0].delta.content || '').join('');
    assert.equal(dicho, 'Hola José. Todo bien.', 'sin la marca [risa]');
    assert.equal(trozos.at(-1).choices[0].finish_reason, 'stop');
    assert.match(texto, /data: \[DONE\]\n\n$/);
    // El cerebro recibió la pregunta con el avatar, el idioma y una sesión de quien habla.
    assert.equal(s.vistos[0].body.message, '¿Cómo estás?');
    assert.equal(s.vistos[0].body.avatar, 'ojos');
    assert.equal(s.vistos[0].body.idioma, 'es');
    assert.match(String(s.vistos[0].sesion), /^u1\./);
  } finally {
    await s.cerrar();
  }
});

test('si la persona interrumpe (ElevenLabs cierra), el turno de adentro se corta', async () => {
  let cortado = false;
  const s = await montar((req, res) => {
    const enviar = sse(res);
    enviar('delta', { text: 'Empiezo a explicar…', voz: 'Empiezo a explicar…' });
    const t = setInterval(() => enviar('delta', { text: ' más', voz: ' más' }), 50);
    req.on('close', () => {
      cortado = true;
      clearInterval(t);
    });
  });
  try {
    const ctrl = new AbortController();
    const r = await fetch(`http://127.0.0.1:${s.puerto}/api/voz/llm`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${secretoDerivado(ETIQUETA_SECRETO_LLM)}`, 'x-pase': emitirPase(persona, 'aura', 'es') },
      body: JSON.stringify({ messages: [{ role: 'user', content: 'Explícame algo largo' }] }),
      signal: ctrl.signal,
    });
    const lector = r.body!.getReader();
    await lector.read();
    ctrl.abort();
    await new Promise((r2) => setTimeout(r2, 300));
    assert.ok(cortado, 'el cerebro dejó de trabajar');
  } finally {
    await s.cerrar();
  }
});
