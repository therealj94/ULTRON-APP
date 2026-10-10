/**
 * LAS HERRAMIENTAS DEL TURNO HABLADO, SEGÚN LO QUE PIDE (José, 6-oct, APK 5.6.0: la mesa hablada pasó de 1,46 s a
 * 4,96 s de mediana; cada turno, también «¿cómo te fue?», mandaba ~9,2 k fichas con las 25 herramientas, y la
 * cobertura en paralelo mandaba lo mismo otra vez al segundo modelo).
 *
 * El server.ts de verdad (con tsx, en una carpeta temporal, sin llaves) contra un Bedrock FALSO (HTTP/2 y event-stream,
 * AWS_ENDPOINT_URL_BEDROCK_RUNTIME), como tests/voz-presupuesto.test.ts. Se captura lo que el cerebro con manos le manda
 * en una muestra de frases habladas y se comprueba:
 *
 *  · que la charla, los saludos y las preguntas simples van con pocas herramientas y un pedido chico;
 *  · que cada frase que pide una acción lleva SU herramienta (WhatsApp, correo, recordatorio, llamada, computadora,
 *    documentos, la app…);
 *  · que WhatsApp no va si la frase no habla de mensajes (José, 7-oct 00:30: 3 de 6 turnos corrieron WhatsApp sin
 *    pedirlo), aunque lo último que dijo AU-RA hable de un WhatsApp pendiente;
 *  · que la cobertura en paralelo manda el MISMO pedido chico (no el completo);
 *  · que una promesa sin herramienta en un turno con pocas herramientas se vuelve a pedir con TODAS (nunca se pierde
 *    una herramienta que hacía falta).
 * Imprime una tabla con el tamaño de cada pedido (para el informe de antes y después).
 */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import http2 from 'node:http2';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';
import type { AddressInfo } from 'node:net';
import { EventStreamCodec } from '@smithy/core/event-streams';
import { fichasEstimadas } from '../lib/tiempos-turno';
import { nombresDelNucleo } from '../lib/herramientas-turno';

const RAIZ = process.cwd();
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aura-voz-herramientas-'));
const SECRETO = 'secreto-de-prueba-largo-para-el-servidor-entero-5-0';
process.env.ULTRON_SESION_SECRETO = SECRETO;
process.env.ULTRON_SESIONES_CERRADAS_ARCHIVO = path.join(tmp, 'cerradas-prueba.json');
process.env.ULTRON_MEMORIA_BUCKET = '';
const { emitirSesion } = await import('../server/seguridad');

/* ------------------------------------------------------------------ Bedrock falso (HTTP/2 + event-stream) */

const utf8 = { a: (b: Uint8Array) => Buffer.from(b).toString('utf8'), de: (s: string) => new Uint8Array(Buffer.from(s, 'utf8')) };
const codec = new EventStreamCodec(utf8.a, utf8.de);
const evento = (tipo: string, cuerpo: unknown) =>
  Buffer.from(
    codec.encode({
      headers: { ':message-type': { type: 'string', value: 'event' }, ':event-type': { type: 'string', value: tipo }, ':content-type': { type: 'string', value: 'application/json' } },
      body: utf8.de(JSON.stringify(cuerpo)),
    })
  );
type Pedido = { modelo: string; body: any };
const pedidos: Pedido[] = [];
/** Qué contesta el modelo según lo último que dijo la persona. */
let contestar: (ultimo: string, modelo: string) => string = () => '[EMO: neutral] Claro, aquí estoy contigo.';
/** Cuánto tarda cada modelo en dar sus cabeceras (para provocar la cobertura en paralelo). */
let demora: (modelo: string) => number = () => 0;
const bedrock = http2.createServer((req, res) => {
  let c = '';
  req.on('data', (d) => (c += d));
  req.on('end', () => {
    const modelo = /\/model\/([^/]+)\/converse-stream/.exec(decodeURIComponent(req.url || ''))?.[1] || '?';
    const body = JSON.parse(c || '{}');
    pedidos.push({ modelo, body });
    const ultimo = String(body.messages?.at(-1)?.content?.[0]?.text || '');
    const responder = () => {
      if (res.destroyed || res.closed) return;
      res.writeHead(200, { 'content-type': 'application/vnd.amazon.eventstream' });
      res.write(evento('messageStart', { role: 'assistant' }));
      for (const t of contestar(ultimo, modelo).match(/.{1,12}/gs) || []) res.write(evento('contentBlockDelta', { contentBlockIndex: 0, delta: { text: t } }));
      res.write(evento('contentBlockStop', { contentBlockIndex: 0 }));
      res.write(evento('messageStop', { stopReason: 'end_turn' }));
      res.end(evento('metadata', { usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 }, metrics: { latencyMs: 1 } }));
    };
    const ms = demora(modelo);
    if (ms > 0) setTimeout(responder, ms);
    else responder();
  });
  req.on('error', () => undefined);
});
bedrock.on('sessionError', () => undefined);
// El nodo (el Qwen de la A10G): solo si Bedrock fallara.
let alNodo = 0;
const nodo = http.createServer((req, res) => {
  let c = '';
  req.on('data', (d) => (c += d));
  req.on('end', () => {
    if (req.url === '/api/precalentar') return res.writeHead(200, { 'content-type': 'application/json' }).end('{"ok":true}');
    if (!JSON.parse(c || '{}').stream) return res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ message: { content: '{}' } }));
    alNodo++;
    res.writeHead(200, { 'content-type': 'application/x-ndjson' });
    res.end(JSON.stringify({ message: { content: '[EMO: neutral] Hola.' }, done: true }) + '\n');
  });
});
const puente = http.createServer((req, res) => {
  req.resume();
  const cuenta = String(req.headers['x-cuenta'] || '');
  res.writeHead(200, { 'content-type': 'application/json', 'x-cuenta': cuenta }).end(JSON.stringify({ vinculado: true, conectado: true, chats: [] }));
});
const laya = http.createServer((req, res) => {
  req.resume();
  req.on('end', () => res.writeHead(503).end());
});
for (const s of [bedrock, nodo, puente, laya] as Array<http.Server | http2.Http2Server>) await new Promise<void>((r) => s.listen(0, '127.0.0.1', r));
const puerto = (s: http.Server | http2.Http2Server) => (s.address() as AddressInfo).port;

/* ------------------------------------------------------------------ el servidor */

const PORT = 8700 + Math.floor(Math.random() * 250);
const BASE = `http://127.0.0.1:${PORT}`;
const CORREO = 'jose.herramientas@ordenglobal.org';
let stdout = '';
let errores = '';
const proc: ChildProcess = spawn(process.execPath, ['--import', import.meta.resolve('tsx'), '--import', path.join(RAIZ, 'tests', 'red-lenta.ts'), path.join(RAIZ, 'server.ts')], {
  cwd: tmp,
  env: {
    PATH: process.env.PATH || '',
    HOME: tmp,
    NODE_ENV: 'production',
    PORT: String(PORT),
    PLATAFORMA: 'ultron',
    ULTRON_SESION_SECRETO: SECRETO,
    ULTRON_SESIONES_CERRADAS_ARCHIVO: path.join(tmp, 'cerradas.json'),
    ULTRON_PERFILES_DIR: path.join(tmp, 'perfiles'),
    ULTRON_NODO_URL: `http://127.0.0.1:${puerto(nodo)}`,
    ULTRON_NODO_SECRETO: 'prueba',
    ULTRON_LAYA_URL: `http://127.0.0.1:${puerto(laya)}`,
    ULTRON_LAYA_CLAVE: 'laya-falsa',
    MODELO_CHICO_MODO: 'apagado',
    TSX_TSCONFIG_PATH: path.join(RAIZ, 'tsconfig.json'),
    RED_LENTA_MS: '2500',
    CEREBRO_VOZ: 'nova',
    // La cobertura sale pronto (la prueba de la cobertura demora al primero): el resto contesta al instante.
    CEREBRO_VOZ_PRIMERA_MS: '300',
    CEREBRO_VOZ_CHARLA_PRIMERA_MS: '300',
    AWS_ACCESS_KEY_ID: 'AKIAPRUEBA',
    AWS_SECRET_ACCESS_KEY: 'prueba',
    AWS_REGION: 'us-west-2',
    AWS_ENDPOINT_URL_BEDROCK_RUNTIME: `http://127.0.0.1:${puerto(bedrock)}`,
    WHATSAPP_PUENTE_URL: `http://127.0.0.1:${puerto(puente)}`,
    WHATSAPP_PUENTE_CLAVE: 'clave-puente',
    WHATSAPP_DUENOS: CORREO,
    COMPUTADORA_URL: 'http://127.0.0.1:9',
    COMPUTADORA_CLAVE: 'x',
    ULTRON_PADRON: `jose | José | ${CORREO} | | ultron=lee`,
  },
  stdio: ['ignore', 'pipe', 'pipe'],
  detached: true,
});
proc.stdout?.on('data', (d) => (stdout = (stdout + d).slice(-200_000)));
proc.stderr?.on('data', (d) => (errores = (errores + d).slice(-4000)));
const canal = new AbortController();
after(() => {
  canal.abort();
  try {
    process.kill(-proc.pid!);
  } catch {
    /* ya se fue */
  }
  for (const s of [nodo, puente, laya]) {
    s.closeAllConnections?.();
    s.close();
  }
  bedrock.close();
  fs.rmSync(tmp, { recursive: true, force: true });
});
let listo = false;
for (let i = 0; i < 240 && !listo; i++) {
  try {
    listo = (await fetch(`${BASE}/api/health`)).ok;
  } catch {
    await new Promise((r) => setTimeout(r, 250));
  }
}

const yo = emitirSesion({ correo: CORREO, nombre: 'José', rol: 'Junta' });
const h = { 'content-type': 'application/json', 'x-ultron-sesion': yo.token, 'x-aura-origen': 'app', 'x-aura-aparato': 'aparato-herramientas' };
if (listo) {
  void fetch(`${BASE}/api/app/acciones`, { headers: h, signal: canal.signal })
    .then(async (r) => {
      for await (const _ of r.body as any) void _;
    })
    .catch(() => undefined);
  const contactos = ['Ana', 'Beto', 'Mamá', 'Carlos Banco', 'Doctor Ríos', 'Luis', 'María', 'Pedro', 'Sofía', 'Tío Juan'].map((nombre, i) => ({ nombre, correo: `contacto${i}@ejemplo.org` }));
  await fetch(`${BASE}/api/app/contexto`, {
    method: 'POST',
    headers: h,
    body: JSON.stringify({ pantalla: 'mesa', contactos, manos: ['llamar', 'leer', 'buscar', 'idioma', 'perfil', 'recordatorio', 'recordatorio_llamada', 'llamame', 'cartera', 'pagar', 'controles', 'enviar_exacto'] }),
  });
  await new Promise((r) => setTimeout(r, 150));
}

async function turno(message: string, extra: Record<string, unknown> = {}, cabeceras: Record<string, string> = {}) {
  const antes = pedidos.length;
  const r = await fetch(`${BASE}/api/turno/stream`, { method: 'POST', headers: { ...h, ...cabeceras }, body: JSON.stringify({ message, hablado: true, idioma: 'es', avatar: 'aura', ...extra }) });
  const txt = await r.text();
  const bloque = txt.split('\n\n').find((b) => /^event: done/m.test(b));
  const done = bloque ? JSON.parse(/^data: (.*)$/m.exec(bloque)![1]) : null;
  const deltas = txt
    .split('\n\n')
    .filter((b) => /^event: (delta|replace)/m.test(b))
    .map((b) => ({ evento: /^event: (\w+)/m.exec(b)![1], voz: String(JSON.parse(/^data: (.*)$/m.exec(b)![1]).voz || '') }));
  await new Promise((r) => setTimeout(r, 100));
  // Solo los pedidos de ESTE turno (lo que AU-RA piensa en segundo plano también puede ir a Bedrock).
  const suyo = JSON.stringify(message).slice(1, -1);
  return { done, nuevos: pedidos.slice(antes).filter((p) => JSON.stringify(p.body.messages || []).includes(suyo)), deltas };
}

/** Lo que mide un pedido a Bedrock: el system y los mensajes, y las herramientas (en JSON, como viajan). */
function medir(p: Pedido) {
  const system = (p.body.system || []).map((s: any) => String(s.text || '')).join('\n');
  const mensajes = (p.body.messages || []).map((m: any) => (m.content || []).map((x: any) => String(x.text || '')).join('\n'));
  const herramientas = JSON.stringify(p.body.toolConfig?.tools || []);
  const texto = system.length + mensajes.reduce((n: number, s: string) => n + s.length, 0);
  const nombres: string[] = (p.body.toolConfig?.tools || []).map((t: any) => t.toolSpec?.name);
  return { system, texto, herramientasCar: herramientas.length, nombres, total: texto + herramientas.length, fichas: fichasEstimadas(texto + herramientas.length) };
}

/** La tabla del informe: una línea por frase. */
const tabla: string[] = [];
const anotar = (frase: string, m: ReturnType<typeof medir>) =>
  tabla.push(`${frase.padEnd(58).slice(0, 58)} | texto ${String(m.texto).padStart(6)} car. | herr. ${String(m.nombres.length).padStart(2)} (${String(m.herramientasCar).padStart(5)} car.) | total ${String(m.total).padStart(6)} car. ~${String(m.fichas).padStart(5)} fichas`);
after(() => {
  if (process.env.VER_STDOUT) console.log(stdout.split('\n').filter((l) => /\[cerebro manos\]|\[promesas\]|turno/.test(l)).join('\n'));
  if (tabla.length) console.log(`\n[herramientas voz] el pedido de cada frase hablada:\n${tabla.join('\n')}\n`);
});

/**
 * El presupuesto de la charla: herramientas y fichas del pedido entero. Auditoría del 10-oct: el núcleo
 * (lib/herramientas-turno.ts HERRAMIENTAS_NUCLEO, ~9 200 car., ~2,6 k fichas) va siempre; antes, solo buscar_web.
 */
const CHARLA_MAX_HERRAMIENTAS = nombresDelNucleo().length + 2;
const CHARLA_MAX_FICHAS = 6_500;

/* ------------------------------------------------------------------ las pruebas */

test('el servidor levanta', () => {
  assert.ok(listo, `no levantó: ${errores}`);
});

const CHARLA = [
  '¿Qué opinas de la música de los noventa?',
  'Estoy cansado, fue un día largo en la planta.',
  '¿Cuál es la capital de Francia?',
  'Qué bonito está el día, ¿verdad?',
  '¿Te acuerdas de lo que hablamos de la junta?',
];

test('la charla, los saludos y las preguntas simples van con pocas herramientas y un pedido chico', { skip: !listo }, async () => {
  let n = 0;
  const respuestas = ['Buena época, mucho rock en español.', 'Te entiendo; descansa un rato, te lo ganaste.', 'París.', 'Sí, está precioso.', 'Sí: quedaron en revisar el presupuesto.'];
  contestar = () => `[EMO: neutral] ${respuestas[n++ % respuestas.length]}`;
  for (const frase of CHARLA) {
    const { nuevos } = await turno(frase);
    assert.equal(nuevos.length, 1, `${frase}: una sola llamada al modelo`);
    const m = medir(nuevos[0]);
    anotar(frase, m);
    assert.ok(m.nombres.length <= CHARLA_MAX_HERRAMIENTAS, `${frase}: ${m.nombres.length} herramientas (${m.nombres.join(', ')})`);
    assert.ok(m.fichas <= CHARLA_MAX_FICHAS, `${frase}: ~${m.fichas} fichas > ${CHARLA_MAX_FICHAS}`);
    // WhatsApp, el correo y las llamadas van en el núcleo (10-oct); lo pesado que la charla no pide, no.
    for (const pesada of ['computadora', 'crear_documento', 'investigar', 'chat_aura', 'circulo']) assert.ok(!m.nombres.includes(pesada), `${frase}: lleva «${pesada}»`);
    // Lo que cuida a la persona va igual (las reglas de MANOS están en el system, no en las herramientas).
    assert.match(m.system, /Nunca digas que algo salió, se creó o se hizo si el resultado de la herramienta no lo dice/);
  }
  assert.equal(alNodo, 0, 'ningún turno cayó al nodo');
});

const ACCIONES: Array<[string, string[]]> = [
  ['Mándale un WhatsApp a Ana que llego tarde', ['whatsapp']],
  ['Revisa mi correo, a ver qué llegó', ['correo']],
  ['Recuérdame mañana a las 8 llamar al banco', ['recordatorio']],
  ['Llámame en diez minutos para lo del banco', ['llamarme']],
  ['Márcale a Beto por favor', ['llamar_contacto']],
  ['Usa tu computadora para entrar a Kayak y comparar vuelos a Miami', ['computadora']],
  ['Hazme un informe en Word sobre la mina de Danlí', ['crear_documento']],
  ['Investiga a fondo la empresa minera de Copán y me avisas', ['investigar']],
  ['Me gustaría que te vieras como Claudio', ['ajustar_app']],
  ['¿Cuánto tengo en mi wallet?', ['cartera_saldo']],
  ['¿Qué me dijo Marisol?', ['whatsapp']],
  // Sin el verbo de siempre: también llevan su herramienta.
  ['Oye, el jueves tengo cita con el dentista a las tres, que no se me pase', ['recordatorio']],
  ['Necesito hablar con Beto ahorita', ['llamar_contacto', 'whatsapp']],
  ['Contéstale a Ana que sí voy mañana', ['whatsapp', 'correo', 'chat_aura']],
];

test('cada frase que pide una acción lleva SU herramienta', { skip: !listo }, async () => {
  contestar = () => '[EMO: neutral] Va.';
  let medidas = 0;
  for (const [frase, necesita] of ACCIONES) {
    const { nuevos } = await turno(frase);
    if (!nuevos.length) continue; // la resolvió el camino rápido de la app o el taller (sin modelo): no hay pedido que medir
    medidas++;
    const m = medir(nuevos[0]);
    anotar(frase, m);
    for (const n of necesita) assert.ok(m.nombres.includes(n), `${frase}: falta «${n}» (lleva ${m.nombres.join(', ')})`);
  }
  assert.ok(medidas >= 8, `solo ${medidas} frases llegaron al modelo`);
});

test('José, 7-oct 00:30: WhatsApp no va si la frase no habla de mensajes, aunque AU-RA acabe de nombrar un WhatsApp pendiente', { skip: !listo }, async () => {
  contestar = (ultimo) => (/pendiente/i.test(ultimo) ? '[EMO: neutral] Te quedó pendiente enviarle un WhatsApp a Marisol sobre la reunión.' : '[EMO: neutral] Va, te cuento.');
  await turno('¿Qué tengo pendiente de ayer?');
  const { nuevos } = await turno('Bueno, y cuéntame algo bonito para relajarme');
  assert.ok(nuevos.length >= 1);
  anotar('(tras «pendiente un WhatsApp») cuéntame algo bonito', medir(nuevos[0]));
  // WhatsApp va en el núcleo (auditoría del 10-oct), pero la INTENCIÓN del turno no es de mensajes: el grupo no se arrastra
  // (y si el modelo lo usara, el filtro de «fuera de tema» no lo corre).
  const ofrecidas = stdout.split('\n').filter((l) => /herramientas ofrecidas/.test(l)).at(-1) || '';
  assert.match(ofrecidas, /intención (?!.*(whatsapp|mensajes))/, ofrecidas);
  for (const m of nuevos.map(medir)) assert.ok(!m.nombres.includes('chat_aura') && !m.nombres.includes('leer_mensajes'), `lleva el grupo de mensajes: ${m.nombres.join(', ')}`);
  // Un «sí» a una propuesta de mensaje de AU-RA sí lo lleva (la decisión pendiente es de un mensaje).
  contestar = (ultimo) => (/Marisol/i.test(ultimo) ? '[EMO: neutral] ¿Le escribo a Marisol que la reunión pasa a las 3?' : '[EMO: neutral] Va.');
  await turno('Hay que avisarle a Marisol lo de la reunión');
  const si = await turno('Sí, dale');
  if (si.nuevos.length) {
    const ms = medir(si.nuevos[0]);
    anotar('«Sí, dale» a «¿Le escribo a Marisol…?»', ms);
    assert.ok(ms.nombres.includes('whatsapp'), `el «sí» a un mensaje lleva whatsapp: ${ms.nombres.join(', ')}`);
  }
});

test('la cobertura en paralelo manda el MISMO pedido chico al segundo modelo', { skip: !listo }, async () => {
  const primero = new Set<string>();
  // El primero de cada turno tarda: sale la cobertura, que contesta al instante.
  demora = (modelo) => {
    if (primero.size === 0) {
      primero.add(modelo);
      return 1_200;
    }
    return 0;
  };
  contestar = () => '[EMO: neutral] Sí, fue una semana tranquila.';
  try {
    // Desde otro teléfono de la cuenta: nada de lo que espera su «sí» en el de las otras pruebas.
    const { nuevos } = await turno('¿Y tú cómo pasaste la semana?', {}, { 'x-aura-aparato': 'aparato-cobertura' });
    assert.ok(nuevos.length >= 2, `salió la cobertura (${nuevos.length} pedidos)`);
    const [a, b] = nuevos.map(medir);
    assert.notEqual(nuevos[0].modelo, nuevos[1].modelo, 'otro modelo');
    assert.deepEqual(b.nombres, a.nombres, 'las mismas herramientas');
    assert.equal(b.total, a.total, 'el mismo tamaño');
    assert.ok(a.nombres.length <= CHARLA_MAX_HERRAMIENTAS, `la cobertura de la charla también es chica: ${a.nombres.join(', ')}`);
  } finally {
    demora = () => 0;
  }
});

test('escrito, todas las herramientas como siempre (solo la voz elige)', { skip: !listo }, async () => {
  contestar = () => '[EMO: neutral] Claro, te cuento lo de la semana.';
  const { nuevos } = await turno('¿Qué tal estuvo tu semana, en resumen?', { hablado: false });
  assert.ok(nuevos.length >= 1);
  const m = medir(nuevos[0]);
  anotar('(escrito) ¿Qué tal estuvo tu semana, en resumen?', m);
  for (const n of ['whatsapp', 'correo', 'llamar_contacto', 'recordatorio', 'computadora', 'crear_documento']) assert.ok(m.nombres.includes(n), `escrito sin «${n}»`);
});

test('una promesa sin herramienta en un turno de pocas herramientas se vuelve a pedir con TODAS, y no suena antes', { skip: !listo }, async () => {
  // La frase no parece pedir nada, pero el modelo promete llamar: la re-pregunta lleva todas las herramientas.
  contestar = (ultimo) => (/NOTA DEL SISTEMA/.test(ultimo) ? 'NADA' : '[EMO: feliz] ¡Va, te llamo en un minuto!');
  const { nuevos, done, deltas } = await turno('Oye, qué tranquila está la tarde hoy');
  assert.equal(nuevos.length, 2, 'la promesa se le vuelve a pedir');
  const [a, b] = nuevos.map(medir);
  assert.ok(a.nombres.length <= CHARLA_MAX_HERRAMIENTAS, `primera vuelta chica: ${a.nombres.join(', ')}`);
  assert.ok(b.nombres.includes('llamarme'), `la re-pregunta lleva todas las herramientas: ${b.nombres.join(', ')}`);
  // La promesa nunca sonó (se retuvo) y lo que queda es honrado.
  assert.ok(!deltas.some((d) => d.evento === 'delta' && /te llamo/i.test(d.voz)), `sonó la promesa: ${JSON.stringify(deltas)}`);
  assert.doesNotMatch(String(done?.voz || ''), /te llamo en un minuto/i, String(done?.voz));
  assert.match(String(done?.reply || ''), /todavía no lo hice/i, String(done?.reply));
});

test('/api/ultron/salud: rápido y, sin sesión, sin la dirección del remoto ni lo que cuenta de sí (auditoría B1)', { skip: !listo }, async () => {
  for (let i = 0; i < 3; i++) {
    const t0 = Date.now();
    const r = await fetch(`${BASE}/api/ultron/salud`);
    const ms = Date.now() - t0;
    const txt = await r.text();
    assert.ok(ms < 2_000, `tardó ${ms} ms`);
    assert.ok(r.status === 200 || r.status === 502, String(r.status));
    assert.doesNotMatch(txt, /remoteUrl|ordenglobal\.link|https?:\/\//, txt);
  }
  // Con sesión de mesa, el detalle sí.
  const con = await (await fetch(`${BASE}/api/ultron/salud`, { headers: h })).json();
  assert.ok(typeof con.remoteUrl === 'string' && con.remoteUrl.startsWith('http'), JSON.stringify(con));
});

test('/api/capacidades: el cerebro de Bedrock y las manos que faltaban; sin sesión, sin la dirección de Voicebox', { skip: !listo }, async () => {
  const j = await (await fetch(`${BASE}/api/capacidades`)).json();
  const chat = j.capacidades.find((c: any) => c.id === 'chat');
  assert.match(chat.detalle, /GLM-5 \(Z\.ai\) en Amazon Bedrock/);
  for (const id of ['whatsapp', 'correo', 'computadora', 'recordatorios']) assert.ok(j.capacidades.some((c: any) => c.id === id), id);
  assert.equal(j.voz.servidor, null);
  assert.doesNotMatch(j.capacidades.find((c: any) => c.id === 'oido').detalle, /interrumpirla hablando/);
});
