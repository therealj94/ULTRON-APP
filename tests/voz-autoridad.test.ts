/**
 * REVISIÓN 9 (MENOR 4): EL PASE DE VOZ Y LA AUTORIDAD VIGENTE (SEC-04). El pase de 20 minutos solo miraba la suspensión
 * YA sabida (sesionSigueViva → suspensionSabida). Con la autoridad «desconocida» (el registro de cuentas falló o tardó)
 * el resto de /api falla cerrado (exigirAutoridadVigente: 503) salvo la identidad configurada en el despliegue; la voz
 * seguía pensando con el cerebro y la memoria de esa cuenta. Ahora falla cerrado igual: una frase honesta, sin cerebro.
 * Cada prueba de «desconocida» falla con el código de antes. Datos sintéticos.
 */
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import type { AddressInfo } from 'node:net';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'voz-autoridad-'));
process.env.ULTRON_SESIONES_CERRADAS_ARCHIVO = path.join(dir, 'cerradas.json');
process.env.ULTRON_SESION_SECRETO = 'secreto-de-prueba-largo-para-la-autoridad-de-la-voz';
process.env.ULTRON_MEMORIA_BUCKET = '';
process.env.ULTRON_PADRON = 'junta | Junta Prueba | junta.voz@ordenglobal.org | | ultron=mando';

const VA = await import('../server/voz-agente');
const { emitirSesion, secretoDerivado } = await import('../server/seguridad');
const { _autoridadDePrueba } = await import('../server/autoridad-cuenta');
type TurnoVoz = import('../server/voz-agente').TurnoVoz;

const BEARER = `Bearer ${secretoDerivado(VA.ETIQUETA_SECRETO_LLM)}`;
afterEach(() => _autoridadDePrueba(null));

async function montar() {
  const vistos: TurnoVoz[] = [];
  const app = express();
  app.use(express.json());
  const pasa: express.RequestHandler = (_q, _s, next) => next();
  VA.montarVozAgente(app, {
    exigirMesaODesk: pasa,
    limitar: () => pasa,
    sesionDe: () => null,
    puenteMs: 0,
    etiquetas: false,
    confirmarAccionMs: 0,
    turno: async (t) => {
      vistos.push(t);
      t.enviar('delta', { text: 'Hola, aquí tu cuenta.', voz: 'Hola, aquí tu cuenta.' });
      t.enviar('done', { reply: 'Hola, aquí tu cuenta.' });
    },
  });
  const srv = app.listen(0);
  await new Promise((r) => srv.once('listening', r));
  const base = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
  const hablar = async (correo: string) => {
    const s = emitirSesion({ correo, nombre: 'Persona', rol: 'Junta' });
    const p = VA.emitirPase(s, 'aura', 'es');
    VA.abrirConversacion(s.correo, p.cid);
    const r = await fetch(`${base}/api/voz/llm/chat/completions`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: BEARER, 'x-pase': p.pase }, body: JSON.stringify({ model: 'aura', stream: true, messages: [{ role: 'user', content: '¿Qué tengo pendiente?' }] }) });
    const texto = await r.text();
    const dicho = texto
      .split('\n\n')
      .filter((l) => l.startsWith('data: {'))
      .map((l) => JSON.parse(l.slice(6)).choices[0].delta.content || '')
      .join('');
    return { status: r.status, dicho };
  };
  return { vistos, hablar, cerrar: () => new Promise((r) => srv.close(r)) };
}

test('autoridad desconocida (el registro de cuentas falla): la voz NO piensa con la cuenta; dice con honestidad que no puede', async () => {
  _autoridadDePrueba({ registro: true, consulta: async () => Promise.reject(new Error('registro caído')) });
  const m = await montar();
  try {
    const r = await m.hablar('miembro.voz@ordenglobal.org');
    assert.equal(r.status, 200, 'no un 401: ElevenLabs colgaría y el freno por IP castigaría a todos');
    assert.match(r.dicho, /no puedo comprobar que tu cuenta sigue activa/);
    assert.equal(m.vistos.length, 0, 'el cerebro (memoria, herramientas, la cuenta) no se tocó');
  } finally {
    await m.cerrar();
  }
});

test('autoridad desconocida por tardanza del registro (más del tope): también falla cerrado', async () => {
  _autoridadDePrueba({ registro: true, consulta: () => new Promise((r) => setTimeout(() => r(false), 500)), topeMs: 50 });
  const m = await montar();
  try {
    const r = await m.hablar('miembro.lento@ordenglobal.org');
    assert.match(r.dicho, /no puedo comprobar/);
    assert.equal(m.vistos.length, 0);
  } finally {
    await m.cerrar();
  }
});

test('autoridad desconocida, pero es la identidad configurada en el despliegue (el padrón del entorno): sigue', async () => {
  _autoridadDePrueba({ registro: true, consulta: async () => Promise.reject(new Error('registro caído')) });
  const m = await montar();
  try {
    const r = await m.hablar('junta.voz@ordenglobal.org');
    assert.equal(r.dicho, 'Hola, aquí tu cuenta.');
    assert.equal(m.vistos.length, 1);
  } finally {
    await m.cerrar();
  }
});

test('el registro dice «activa»: sigue; dice «suspendida»: el pase deja de valer (401), sin cerebro', async () => {
  let suspendida = false;
  _autoridadDePrueba({ registro: true, consulta: async () => suspendida });
  const m = await montar();
  try {
    assert.equal((await m.hablar('miembro.activa@ordenglobal.org')).dicho, 'Hola, aquí tu cuenta.');
    suspendida = true;
    const r = await m.hablar('miembro.suspendida@ordenglobal.org');
    assert.equal(r.status, 401);
    assert.equal(m.vistos.length, 1, 'solo el turno de la cuenta activa llegó al cerebro');
  } finally {
    await m.cerrar();
  }
});
