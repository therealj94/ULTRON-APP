/**
 * CON EL INTERRUPTOR APAGADO NADA CAMBIA (prototipo de Speech Engine, docs/voz/SPEECH-ENGINE.md).
 *
 * El camino de siempre (agente de ElevenLabs → /api/voz/llm) se fija aquí BYTE A BYTE: lo que pide
 * /api/voz/agente a ElevenLabs, lo que contesta al teléfono y el stream SSE de un turno (solo el id
 * aleatorio y la hora se normalizan). Esta prueba pasa igual en main ANTES del prototipo y después: con
 * el motor apagado (por cuenta o del todo) y con las dependencias nuevas puestas (la medida del turno,
 * `motorDe` que dice «no»), la petición y la respuesta son las mismas.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import type { AddressInfo } from 'node:net';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'voz-motor-apagado-'));
process.env.ULTRON_SESIONES_CERRADAS_ARCHIVO = path.join(dir, 'cerradas.json');
process.env.ULTRON_SESION_SECRETO = 'secreto-de-prueba-largo-para-las-sesiones-1234';
process.env.ULTRON_MEMORIA_BUCKET = '';
// Revisión 9 (MENOR 4): cada turno de la voz mira la autoridad vigente de la cuenta (SEC-04). Sin registro de cuentas,
// el despliegue declara que no hay suspensiones (como AURA_SUSPENSIONES=ninguna en desarrollo).
process.env.AURA_SUSPENSIONES = 'ninguna';
process.env.ELEVENLABS_API_KEY = 'llave-falsa-de-prueba';
// Los agentes de ElevenLabs llegan por entorno (el repo es público): ids inventados.
process.env.ELEVENLABS_AGENTE_AURA_ES = 'agent_inventado_aura_es';
process.env.ELEVENLABS_AGENTE_CLAUDIO_ES = 'agent_inventado_claudio_es';
delete process.env.AURA_MOTOR_VOZ;

const { montarVozAgente, ETIQUETA_SECRETO_LLM, leerPase } = await import('../server/voz-agente');
const { secretoDerivado, emitirSesion, sesionDe } = await import('../server/seguridad');
type TurnoVoz = import('../server/voz-agente').TurnoVoz;

let n = 0;
const persona = () => {
  n++;
  return emitirSesion({ correo: `apagado${n}@ordenglobal.org`, nombre: 'José', rol: 'Junta' });
};

/** El cerebro de siempre, falso y determinista. */
async function cerebro(t: TurnoVoz) {
  t.enviar('tools', { tools: [] });
  t.enviar('emocion', { emocion: 'neutral' });
  t.enviar('delta', { text: 'Hola José. ', voz: 'Hola José. ' });
  t.enviar('delta', { text: 'Todo en orden.', voz: 'Todo en orden.' });
  t.enviar('done', { reply: 'Hola José. Todo en orden.', via: 'prueba' });
}

async function montar(extra: Record<string, unknown>) {
  const pedidas: { url: string; headers: any }[] = [];
  const elevenFalso: typeof fetch = (async (url: any, init: any) => {
    pedidas.push({ url: String(url), headers: init?.headers });
    return new Response(JSON.stringify({ token: 'tok-el' }), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as any;
  const app = express();
  app.use(express.json());
  const pasa: express.RequestHandler = (_q, _s, next) => next();
  montarVozAgente(app, { exigirMesaODesk: pasa, limitar: () => pasa, sesionDe, turno: cerebro, fetch: elevenFalso, puenteMs: 0, etiquetas: false, confirmarAccionMs: 0, ...extra } as any);
  const srv = app.listen(0);
  await new Promise((r) => srv.once('listening', r));
  const base = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
  return { base, pedidas, cerrar: () => new Promise((r) => srv.close(r)) };
}

/** El SSE con el id aleatorio y la hora normalizados; lo demás, tal cual. */
const normalizar = (sse: string) => sse.replace(/"id":"chatcmpl-[0-9a-f]+"/g, '"id":"X"').replace(/"created":\d+/g, '"created":0');

const TROZO = (delta: string, fin: string | null) => `data: {"id":"X","object":"chat.completion.chunk","created":0,"model":"aura","choices":[{"index":0,"delta":${delta},"finish_reason":${fin}}]}\n\n`;
const SSE_ESPERADO =
  TROZO('{"role":"assistant"}', 'null') + TROZO('{"content":"Hola José. "}', 'null') + TROZO('{"content":"Todo en orden."}', 'null') + TROZO('{}', '"stop"') + 'data: [DONE]\n\n';

async function recorrido(extra: Record<string, unknown>) {
  const s = await montar(extra);
  try {
    const yo = persona();
    const r = await fetch(`${s.base}/api/voz/agente`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-ultron-sesion': yo.token }, body: JSON.stringify({ avatar: 'aura', idioma: 'es' }) });
    const j: any = await r.json();
    const t = await fetch(`${s.base}/api/voz/llm/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${secretoDerivado(ETIQUETA_SECRETO_LLM)}`, 'x-pase': j.pase },
      body: JSON.stringify({ model: 'aura', stream: true, messages: [{ role: 'user', content: '¿Cómo vamos?' }] }),
    });
    return { status: r.status, claves: Object.keys(j), j, pedidas: s.pedidas, sse: normalizar(await t.text()), tipo: t.headers.get('content-type'), pase: leerPase(j.pase) };
  } finally {
    await s.cerrar();
  }
}

test('apagado: /api/voz/agente pide el token del agente de siempre y contesta lo mismo de siempre', async () => {
  const r = await recorrido({});
  assert.equal(r.status, 200);
  assert.deepEqual(r.claves, ['token', 'agente', 'avatar', 'idioma', 'pase', 'cid', 'vence', 'restanteMs', 'honesto'], 'sin campos nuevos (ni motor ni primer mensaje)');
  assert.equal(r.j.token, 'tok-el');
  assert.equal(r.j.agente, 'agent_inventado_aura_es', 'el agente de AU-RA en español, como siempre');
  assert.equal(r.pedidas.length, 1);
  assert.equal(r.pedidas[0].url, 'https://api.elevenlabs.io/v1/convai/conversation/token?agent_id=agent_inventado_aura_es');
  assert.deepEqual(Object.keys(r.pedidas[0].headers), ['xi-api-key']);
  assert.equal(r.pase?.avatar, 'aura');
});

test('apagado: el turno de /api/voz/llm sale byte a byte igual', async () => {
  const r = await recorrido({});
  assert.equal(r.tipo, 'text/event-stream; charset=utf-8');
  assert.equal(r.sse, SSE_ESPERADO);
});

test('apagado con las piezas nuevas puestas (motor que dice «no», medida del turno): la misma petición y la misma respuesta', async () => {
  const medidas: unknown[] = [];
  const base = await recorrido({});
  const con = await recorrido({ motorDe: () => null, alTurno: (_req: unknown, m: unknown) => medidas.push(m) });
  assert.deepEqual(con.claves, base.claves);
  assert.equal(con.pedidas[0].url, base.pedidas[0].url);
  assert.deepEqual(con.pedidas[0].headers, base.pedidas[0].headers);
  assert.equal(con.sse, base.sse);
  assert.equal(con.sse, SSE_ESPERADO);
  assert.equal(con.j.agente, base.j.agente);
});
