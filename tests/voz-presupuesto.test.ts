/**
 * EL PRESUPUESTO DEL TURNO HABLADO (José, 6-oct: «primera ficha» 905 → 2023 ms de mediana de un día a otro).
 *
 * El server.ts de verdad (con tsx, en una carpeta temporal, sin llaves) contra un Bedrock FALSO que habla HTTP/2 y
 * event-stream como el de verdad (AWS_ENDPOINT_URL_BEDROCK_RUNTIME): se captura exactamente lo que el cerebro con manos
 * le manda (system, mensajes y herramientas) en un turno hablado pesado y realista, y se comprueba:
 *
 *  · que cabe en el presupuesto (lib/prompt-voz.ts) y que lo que cuida a la persona sigue ahí (el «sí» antes de mandar,
 *    nunca decir que salió sin el resultado, quién habla por la voz, la escena, el borrador de WhatsApp);
 *  · que lo que casi nunca hace falta solo va cuando se pide (el menú de la app, la ficha de lo que ofrece, el COT);
 *  · que la línea `[mesa] turno` dice el tamaño del prompt y qué modelo contestó;
 *  · que «te pongo la cámara trasera» (lo hace el teléfono) no lanza una segunda vuelta al modelo y «te llamo en 30
 *    segundos» sin herramienta sí.
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
import { PRESUPUESTO_VOZ_FICHAS, PRESUPUESTO_VOZ_TEXTO_FICHAS, pideCapacidades, pideGuiaDeApp, reglasAppDelTurno } from '../lib/prompt-voz';

const RAIZ = process.cwd();
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aura-voz-presupuesto-'));
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
let contestar: (ultimo: string) => string = () => '[EMO: neutral] Claro, aquí estoy contigo.';
const bedrock = http2.createServer((req, res) => {
  let c = '';
  req.on('data', (d) => (c += d));
  req.on('end', () => {
    const modelo = /\/model\/([^/]+)\/converse-stream/.exec(decodeURIComponent(req.url || ''))?.[1] || '?';
    const body = JSON.parse(c || '{}');
    pedidos.push({ modelo, body });
    const ultimo = String(body.messages?.at(-1)?.content?.[0]?.text || '');
    res.writeHead(200, { 'content-type': 'application/vnd.amazon.eventstream' });
    res.write(evento('messageStart', { role: 'assistant' }));
    for (const t of contestar(ultimo).match(/.{1,12}/gs) || []) res.write(evento('contentBlockDelta', { contentBlockIndex: 0, delta: { text: t } }));
    res.write(evento('contentBlockStop', { contentBlockIndex: 0 }));
    res.write(evento('messageStop', { stopReason: 'end_turn' }));
    res.end(evento('metadata', { usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 }, metrics: { latencyMs: 1 } }));
  });
});
// El nodo (el Qwen de la A10G): solo si Bedrock fallara. Aquí no debería contestar ningún turno.
let alNodo = 0;
const nodo = http.createServer((req, res) => {
  let c = '';
  req.on('data', (d) => (c += d));
  req.on('end', () => {
    if (req.url === '/api/precalentar') return res.writeHead(200, { 'content-type': 'application/json' }).end('{"ok":true}');
    // Lo que AU-RA piensa en segundo plano (resúmenes, lo que quedó a medias) no es un turno: sin stream.
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

const PORT = 8400 + Math.floor(Math.random() * 300);
const BASE = `http://127.0.0.1:${PORT}`;
const CORREO = 'jose.presupuesto@ordenglobal.org';
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
    // El cerebro con manos contra el Bedrock falso (credenciales de mentira: nada sale de la máquina).
    CEREBRO_VOZ: 'nova',
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
const h = { 'content-type': 'application/json', 'x-ultron-sesion': yo.token, 'x-aura-origen': 'app', 'x-aura-aparato': 'aparato-presupuesto' };
if (listo) {
  // El teléfono, como el de José: el canal de acciones abierto, sus contactos y todas sus manos.
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

async function turno(message: string, extra: Record<string, unknown> = {}) {
  const antes = pedidos.length;
  const r = await fetch(`${BASE}/api/turno/stream`, { method: 'POST', headers: h, body: JSON.stringify({ message, hablado: true, idioma: 'es', avatar: 'aura', ...extra }) });
  const txt = await r.text();
  const bloque = txt.split('\n\n').find((b) => /^event: done/m.test(b));
  const done = bloque ? JSON.parse(/^data: (.*)$/m.exec(bloque)![1]) : null;
  // La línea del turno sale justo después del `done`.
  await new Promise((r) => setTimeout(r, 100));
  return { done, nuevos: pedidos.slice(antes) };
}

/** Lo que mide un pedido a Bedrock: el system y los mensajes, y las herramientas (en JSON, como viajan). */
function medir(p: Pedido) {
  const system = (p.body.system || []).map((s: any) => String(s.text || '')).join('\n');
  const mensajes = (p.body.messages || []).map((m: any) => (m.content || []).map((x: any) => String(x.text || '')).join('\n'));
  const herramientas = JSON.stringify(p.body.toolConfig?.tools || []);
  const texto = system.length + mensajes.reduce((n: number, s: string) => n + s.length, 0);
  return { system, texto, herramientas, nombres: (p.body.toolConfig?.tools || []).map((t: any) => t.toolSpec?.name), total: texto + herramientas.length };
}

// Habla la dueña (con otra voz, el turno va en modo invitado: server/modo-invitado.ts, su propia prueba abajo).
const ESCENA_PESADA =
  'Reconozco a José (quien te habla), Ana (tu esposa); 1 persona(s) que no conozco. Veo a tres personas, una muy cerca, una sonriendo, la más cercana mira la pantalla.';
const ESCENA_OTRA_VOZ = `Por la voz, habla Ana (tu esposa), no José. ${ESCENA_PESADA}`;

/* ------------------------------------------------------------------ las pruebas */

test('el servidor levanta', () => {
  assert.ok(listo, `no levantó: ${errores}`);
});

test('reglas de la voz: el menú y la ficha de lo que ofrece solo cuando se piden; escrito, todo como siempre', () => {
  assert.ok(pideGuiaDeApp('¿Dónde conecto mi correo?'));
  assert.ok(pideGuiaDeApp('¿cómo activo la cámara siempre?'));
  assert.ok(!pideGuiaDeApp('¿Qué opinas de la mina de Danlí?'));
  assert.ok(pideCapacidades('¿Qué puedes hacer por mí?'));
  assert.ok(!pideCapacidades('Cuéntame algo del oro'));
  const piezas = { manosAqui: 'TUS MANOS AQUÍ: …', menuAqui: 'MENÚ DE LA APP: …', reglasManos: 'MANOS: tienes herramientas.' };
  assert.equal(reglasAppDelTurno({ ...piezas, voz: true, mensaje: 'Cuéntame algo del oro' }), 'MANOS: tienes herramientas.');
  assert.equal(reglasAppDelTurno({ ...piezas, voz: true, mensaje: 'y luego qué', anterior: '¿dónde está lo de Veta Wallet?' }), 'MENÚ DE LA APP: …\nMANOS: tienes herramientas.');
  assert.equal(reglasAppDelTurno({ ...piezas, voz: false, mensaje: 'Cuéntame algo del oro' }), 'TUS MANOS AQUÍ: …\nMENÚ DE LA APP: …\nMANOS: tienes herramientas.');
});

test('un turno hablado pesado y realista cabe en el presupuesto y conserva lo que cuida a la persona', { skip: !listo }, async () => {
  // Unos turnos antes, como en una charla de verdad (el hilo de la voz va en los mensajes).
  // Cada respuesta distinta, como en una charla de verdad: la misma respuesta larga a otra pregunta es repetirse, y la
  // guarda (lib/repeticion.ts, José 7-oct) pediría una segunda vuelta al modelo.
  let vuelta = 0;
  const respuestas = [
    'Todo tranquilo por acá, José. La junta sigue pendiente de los permisos y de la siguiente revisión del proyecto.',
    'Ayer la junta revisó el presupuesto del trimestre y quedó en volver a verlo con los números del banco.',
    'Lo del banco todavía no quedó: falta la firma del gerente y una copia del contrato de la concesión.',
    'Del oro dijimos que convenía esperar a que el precio se estabilizara antes de vender el lote de octubre.',
    'La gente de Choluteca mandó saludos; están listos para la capacitación cuando llegue el equipo nuevo.',
    'Danlí va con riesgo moderado esta semana: lluvias en el acceso, el permiso ambiental y el costo del diésel.',
  ];
  contestar = () => `[EMO: neutral] ${respuestas[vuelta++ % respuestas.length]}`;
  for (const m of ['Buenas, ¿cómo va todo por allá?', 'Cuéntame de la junta de ayer', '¿Y lo del banco quedó?', 'Recuérdame qué dijimos del oro', 'Bueno, ¿y la gente de Choluteca?']) await turno(m);
  const { done, nuevos } = await turno('Oye, ¿y qué opinas de cómo va la mina de Danlí esta semana? Analiza a fondo los riesgos.', { escena: ESCENA_PESADA });
  assert.equal(done?.modelo, 'zai.glm-5', JSON.stringify(done));
  assert.equal(nuevos.length, 1, 'una sola llamada al modelo');
  const m = medir(nuevos[0]);
  const fichas = { texto: fichasEstimadas(m.texto), total: fichasEstimadas(m.total), herramientas: fichasEstimadas(m.herramientas.length) };
  console.log(`[presupuesto voz] system+mensajes ${m.texto} car. (~${fichas.texto} fichas) · herramientas ${m.nombres.length}: ${m.herramientas.length} car. (~${fichas.herramientas}) · total ~${fichas.total} fichas`);
  assert.ok(fichas.texto <= PRESUPUESTO_VOZ_TEXTO_FICHAS, `system y mensajes: ~${fichas.texto} fichas > ${PRESUPUESTO_VOZ_TEXTO_FICHAS}`);
  assert.ok(fichas.total <= PRESUPUESTO_VOZ_FICHAS, `todo: ~${fichas.total} fichas > ${PRESUPUESTO_VOZ_FICHAS}`);
  // Lo que cuida a la persona, siempre: el «sí» antes de mandar, nunca decir que salió sin el resultado.
  assert.match(m.system, /primero queda listo y le preguntas; cuando diga que sí/);
  assert.match(m.system, /Nunca digas que algo salió, se creó o se hizo si el resultado de la herramienta no lo dice/);
  assert.match(m.system, /ESCENA \(tu cámara, ahora mismo\): Reconozco a José/);
  // Auditoría del 7-oct (C1): hablando, las herramientas van según lo que pide la frase (lib/herramientas-turno.ts). «Analiza
  // a fondo los riesgos» lleva buscar e investigar; del 10-oct, también el núcleo (WhatsApp, correo, llamadas…), pero no el
  // resto de las manos de mensajes (antes iban las 25 siempre).
  assert.ok(m.nombres.includes('buscar_web') && m.nombres.includes('investigar'), m.nombres.join(', '));
  assert.ok(!m.nombres.includes('chat_aura') && !m.nombres.includes('leer_mensajes') && !m.nombres.includes('circulo'), m.nombres.join(', '));
  // El mismo turno pesado pidiendo mensajes, correo y a un contacto: esas manos van, con su «sí» antes de mandar, y cabe.
  contestar = () => '[EMO: neutral] Va, déjame ver.';
  const accion = await turno('Contéstale a Ana que sí voy mañana, revisa si Beto me escribió al correo y después márcale', { escena: ESCENA_PESADA });
  assert.equal(accion.nuevos.length >= 1, true, 'llegó al modelo');
  const ma = medir(accion.nuevos[0]);
  const fichasAccion = fichasEstimadas(ma.total);
  console.log(`[presupuesto voz] con acción: herramientas ${ma.nombres.length}: ${ma.herramientas.length} car. · total ~${fichasAccion} fichas`);
  assert.match(ma.herramientas, /solo dejan? un BORRADOR: léeselo(, di qué sale)? y pregunta si lo mandas/);
  assert.ok(ma.nombres.includes('whatsapp') && ma.nombres.includes('llamar_contacto') && ma.nombres.includes('correo'), `las manos de lo que pidió: ${ma.nombres.join(', ')}`);
  assert.ok(fichasAccion <= PRESUPUESTO_VOZ_FICHAS, `con acción: ~${fichasAccion} fichas > ${PRESUPUESTO_VOZ_FICHAS}`);
  contestar = () => `[EMO: neutral] ${respuestas[vuelta++ % respuestas.length]}`;
  // Lo que casi nunca hace falta, fuera del camino caliente.
  assert.doesNotMatch(m.system, /MENÚ DE LA APP/);
  assert.doesNotMatch(m.system, /TUS MANOS AQUÍ/);
  assert.doesNotMatch(m.system, /CHAIN OF THOUGHT/);
  // La línea del turno: el tamaño del prompt y quién contestó.
  const linea = stdout.split('\n').filter((l) => /\[mesa\] turno .* \(hablado\)/.test(l)).at(-1) || '';
  assert.match(linea, / · prompt \d+ car\. ~\d+ fichas \(\d+ herr\. \d+ car\.\) · por bedrock zai\.glm-5 · total \d+ ms$/, linea);
  assert.equal(alNodo, 0, 'ningún turno cayó al nodo');
});

test('con otra voz (Ana), el turno pesado va sin las manos privadas de la dueña (modo invitado)', { skip: !listo }, async () => {
  contestar = () => '[EMO: neutral] Te respondo en modo invitado.';
  const { nuevos } = await turno('Léeme los últimos mensajes de WhatsApp de José.', { escena: ESCENA_OTRA_VOZ });
  if (!nuevos.length) return; // el turno pudo resolverse sin modelo; lo que importa es que nada privado salga
  const m = medir(nuevos[0]);
  for (const privada of ['whatsapp', 'correo', 'llamar_contacto']) assert.ok(!m.nombres.includes(privada), `invitado con «${privada}»`);
});

test('cuando pregunta cómo o dónde, el menú de la app va; cuando pregunta qué puede hacer, la ficha; escrito, siempre', { skip: !listo }, async () => {
  contestar = () => '[EMO: neutral] Te digo.';
  const guia = medir((await turno('¿Dónde conecto mi correo en la app?')).nuevos[0]);
  assert.match(guia.system, /MENÚ DE LA APP/);
  const puede = medir((await turno('¿Puedes ayudarme con mi agenda de la semana?')).nuevos[0]);
  assert.match(puede.system, /TUS MANOS AQUÍ/);
  const escrito = medir((await turno('Cuéntame algo del oro', { hablado: false })).nuevos[0]);
  assert.match(escrito.system, /MENÚ DE LA APP/);
  assert.match(escrito.system, /TUS MANOS AQUÍ/);
});

test('«te pongo la cámara trasera» (lo hace el teléfono) no lanza la segunda vuelta; «te llamo en 30 segundos» sin herramienta sí', { skip: !listo }, async () => {
  contestar = () => '[EMO: neutral] Listo, te pongo la cámara trasera.';
  const cam = await turno('pon la cámara de atrás porfa');
  assert.equal(cam.nuevos.length, 1, 'sin re-pregunta');
  assert.match(String(cam.done?.reply || ''), /lo hace tu teléfono cuando se lo dices tal cual/);
  contestar = (ultimo) => (/NOTA DEL SISTEMA/.test(ultimo) ? 'NADA' : '[EMO: feliz] ¡Va, te llamo en 30 segundos!');
  const llamar = await turno('llámame en 30 segundos');
  assert.equal(llamar.nuevos.length, 2, 'la promesa de verdad se le vuelve a pedir');
  const linea = stdout.split('\n').filter((l) => /\[mesa\] turno/.test(l)).at(-1) || '';
  assert.match(linea, /re-pregunta \d+ ms/);
});
