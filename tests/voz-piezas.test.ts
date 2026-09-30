/**
 * Las piezas sueltas de la auditoría de la conversación fluida:
 *
 *  · el taller desde la voz es SOLO CONSULTA: aunque hable José (que tiene mando), nada de
 *    redespliegue, mantenimiento, urgente, llamada ni envíos; lo de consultar sí;
 *  · el modelo chico suelta la llamada cuando la persona interrumpe, y ese corte no cuenta como fallo;
 *  · el cupo por clave (la voz lo cuenta por persona) y la sesión viva por huella;
 *  · el script de los agentes no imprime cuerpos de error (no se corre: se importa);
 *  · el streaming suelta la primera frase larga en una coma.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'voz-piezas-'));
process.env.ULTRON_SESIONES_CERRADAS_ARCHIVO = path.join(dir, 'cerradas.json');
process.env.ULTRON_SESION_SECRETO = 'secreto-de-prueba-largo-para-las-piezas-de-voz';
process.env.ULTRON_MEMORIA_BUCKET = '';
// Nada de esto puede salir de la máquina aunque una prueba fallara.
for (const k of ['RENDER_DEPLOY_HOOK', 'RENDER_DEPLOY_HOOK_URL', 'RENDER_API_KEY', 'TELEGRAM_BOT_TOKEN', 'TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'RESEND_API_KEY', 'SMTP_URL']) delete process.env[k];

const { despacharTaller } = await import('../lib/taller');
const { preguntarModeloChico } = await import('../lib/cognitivo/modelos');
const { disponible, resetInterruptoresTest } = await import('../lib/cognitivo/interruptor');
const { gastarCupo, sesionSigueViva, huellaSesion, emitirSesion, borrarSesion, fijarClaveCambiadaEn } = await import('../server/seguridad');
const { errorSeguro } = await import('../scripts/elevenlabs-agentes');
const { puntoDeCorte } = await import('../lib/trozos');

test('taller desde la voz: solo consulta, aunque quien hable tenga mando', async () => {
  for (const pedido of ['redeploy', 'mantenimiento', 'envía por telegram el resumen', 'llámame y dime hola', 'mándame audio del sistema', 'mándame un pdf por whatsapp']) {
    const r = await despacharTaller(pedido, { quien: 'jose', prueba: 'sesion', canal: 'mesa', soloConsulta: true });
    assert.match(r.decir || '', /no lo hago desde la conversación de voz/i, pedido);
    assert.ok(r.hechos.some((h) => /ACCESO \(conversación de voz\): solo consulta/.test(h)), pedido);
  }
  // Consultar sí.
  const estado = await despacharTaller('cómo está el sistema', { quien: 'jose', prueba: 'sesion', canal: 'mesa', soloConsulta: true });
  assert.doesNotMatch(estado.decir || '', /no lo hago desde la conversación de voz/i);
});

test('el modelo chico: si la persona interrumpe, suelta ya y no abre el interruptor', async () => {
  resetInterruptoresTest();
  const lento = http.createServer((_req, res) => {
    const t = setTimeout(() => res.writeHead(200, { 'content-type': 'application/json' }).end('{"choices":[{"message":{"content":"tarde"}}]}'), 3000);
    res.on('close', () => clearTimeout(t));
  });
  await new Promise<void>((r) => lento.listen(0, '127.0.0.1', r));
  const antes = { url: process.env.MODELO_CHICO_URL, ms: process.env.MODELO_CHICO_TIMEOUT_MS };
  process.env.MODELO_CHICO_URL = `http://127.0.0.1:${(lento.address() as AddressInfo).port}`;
  try {
    const corte = new AbortController();
    setTimeout(() => corte.abort(), 80);
    const t0 = Date.now();
    assert.equal(await preguntarModeloChico([{ role: 'user', content: 'hola' }], corte.signal), null);
    assert.ok(Date.now() - t0 < 1500, `soltó a tiempo (${Date.now() - t0} ms)`);
    assert.equal(disponible('modelo_chico'), true, 'un corte de la persona no es un fallo del modelo');
  } finally {
    if (antes.url === undefined) delete process.env.MODELO_CHICO_URL;
    else process.env.MODELO_CHICO_URL = antes.url;
    lento.closeAllConnections?.();
    lento.close();
    resetInterruptoresTest();
  }
});

test('gastarCupo: por clave, con ventana', () => {
  const t = 1_000_000;
  for (let i = 0; i < 3; i++) assert.equal(gastarCupo('voz-turnos:a@x.com', 3, 60_000, t + i), true);
  assert.equal(gastarCupo('voz-turnos:a@x.com', 3, 60_000, t + 10), false, 'se acabó');
  assert.equal(gastarCupo('voz-turnos:b@x.com', 3, 60_000, t + 10), true, 'otra persona, otro cupo');
  assert.equal(gastarCupo('voz-turnos:a@x.com', 3, 60_000, t + 60_001), true, 'pasó la ventana');
});

test('sesionSigueViva: por la huella, sin el token; cerrada, vencida o anterior a la clave nueva, no', async () => {
  const s = emitirSesion({ correo: 'viva@x.com', nombre: 'Viva', rol: 'Junta' });
  const o = { huella: huellaSesion(s.token), correo: s.correo, at: s.at, exp: s.exp };
  assert.equal(sesionSigueViva(o), true);
  assert.equal(sesionSigueViva(o, (s.exp || 0) + 1), false, 'vencida');
  fijarClaveCambiadaEn((c) => (c === 'viva@x.com' ? s.at + 1 : null));
  assert.equal(sesionSigueViva(o), false, 'la clave cambió después');
  fijarClaveCambiadaEn(() => null);
  await borrarSesion(s.token);
  assert.equal(sesionSigueViva(o), false, 'cerrada');
  assert.notEqual(huellaSesion(s.token), s.token);
});

test('el script de los agentes: un error dice método, ruta, estado y código, nunca el cuerpo', () => {
  const cuerpo = { detail: { status: 'invalid_secret', message: 'el valor sk_live_123 no sirve' }, conversation_config: { api_key: 'sk_live_123' } };
  const e = errorSeguro('PATCH', '/convai/secrets/abc?x=sk_live_123', 422, cuerpo);
  assert.equal(e.message, 'PATCH /convai/secrets/abc → 422 (invalid_secret)');
  assert.equal(e.status, 422);
  assert.doesNotMatch(JSON.stringify({ ...e, m: e.message }), /sk_live/);
  assert.ok(!('cuerpo' in e), 'el objeto del error no carga el cuerpo (Node lo imprimiría)');
  assert.equal(errorSeguro('GET', '/convai/agents', 500, '<html>fallo interno con datos</html>').message, 'GET /convai/agents → 500');
  assert.equal(errorSeguro('POST', '/x', 400, { detail: [{ type: 'missing', msg: 'secreto: abc' }] }).message, 'POST /x → 400 (missing)');
  assert.equal(errorSeguro('POST', '/x', 400, { detail: { status: 'un texto largo con espacios y el secreto abc' } }).message, 'POST /x → 400', 'un «código» que no es código no se imprime');
});

test('puntoDeCorte: frases cerradas; la primera frase larga se suelta en una coma', () => {
  assert.equal(puntoDeCorte('Hola. Qué', 0), 4, 'el índice del signo; se suelta hasta él inclusive');
  assert.equal(puntoDeCorte('Hola', 0), -1);
  const larga = 'Mira, lo que pasa con el precio del oro esta semana es bastante interesante, porque';
  assert.equal(puntoDeCorte(larga, 0), larga.lastIndexOf(', '), 'más de 60 caracteres: en la coma');
  assert.equal(puntoDeCorte('Mira, lo que pasa', 0), -1, 'coma temprana: todavía no');
  assert.equal(puntoDeCorte(larga + ' sube, y baja', larga.lastIndexOf(', ') + 1), -1, 'después de la primera, solo frases');
  assert.equal(puntoDeCorte(larga + ' sube. Y', larga.lastIndexOf(', ') + 1), (larga + ' sube. Y').lastIndexOf('. '));
});
