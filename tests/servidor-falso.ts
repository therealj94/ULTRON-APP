/**
 * El server.ts de verdad (con tsx, en una carpeta temporal, sin llaves) contra un Bedrock FALSO que habla HTTP/2 y
 * event-stream como el de verdad (AWS_ENDPOINT_URL_BEDROCK_RUNTIME), un nodo, un puente de WhatsApp y Laya de mentira.
 * Lo usan las pruebas que necesitan el turno entero (tests/turno-especulativo-servidor.test.ts, tests/cerebro-charla.test.ts).
 * No es un archivo de pruebas (`*.test.ts`).
 */
import http from 'node:http';
import http2 from 'node:http2';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';
import type { AddressInfo } from 'node:net';
import { EventStreamCodec } from '@smithy/core/event-streams';

const utf8 = { a: (b: Uint8Array) => Buffer.from(b).toString('utf8'), de: (s: string) => new Uint8Array(Buffer.from(s, 'utf8')) };
const codec = new EventStreamCodec(utf8.a, utf8.de);
export const eventoBedrock = (tipo: string, cuerpo: unknown) =>
  Buffer.from(
    codec.encode({
      headers: { ':message-type': { type: 'string', value: 'event' }, ':event-type': { type: 'string', value: tipo }, ':content-type': { type: 'string', value: 'application/json' } },
      body: utf8.de(JSON.stringify(cuerpo)),
    })
  );

/** Lo que contesta el modelo falso: texto, o una herramienta (con texto antes, opcional). `demoraMs` antes del primer trozo. */
export type RespuestaFalsa = { texto?: string; herramienta?: { nombre: string; input: Record<string, unknown> }; demoraMs?: number };
export type PedidoBedrock = { modelo: string; body: any; en: number };

/**
 * `puente`: un puente de WhatsApp a medida (la ruta y el cuerpo; null = el de siempre). `nodo`: lo que contesta el Qwen del
 * nodo (el respaldo cuando Bedrock no contesta). `contestar` recibe también el pedido entero (lo que vio el modelo).
 * `fallaBedrock`: true = ese pedido contesta 500 (sin modelo de Bedrock: contesta el nodo).
 */
export async function levantarServidor(o: {
  correo: string;
  env?: Record<string, string>;
  contestar: (ultimo: string, modelo: string, body: any) => RespuestaFalsa & { fallaBedrock?: boolean };
  puente?: (u: URL, cuerpo: string) => { status: number; json: unknown } | null;
  nodo?: (cuerpo: any) => string;
}) {
  const RAIZ = process.cwd();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aura-servidor-falso-'));
  const SECRETO = 'secreto-de-prueba-largo-para-el-servidor-entero-5-0';
  process.env.ULTRON_SESION_SECRETO = SECRETO;
  process.env.ULTRON_SESIONES_CERRADAS_ARCHIVO = path.join(tmp, 'cerradas-prueba.json');
  process.env.ULTRON_MEMORIA_BUCKET = '';
  const { emitirSesion } = await import('../server/seguridad');
  const pedidos: PedidoBedrock[] = [];
  const bedrock = http2.createServer((req, res) => {
    let c = '';
    req.on('data', (d) => (c += d));
    req.on('end', async () => {
      const modelo = /\/model\/([^/]+)\/converse-stream/.exec(decodeURIComponent(req.url || ''))?.[1] || '?';
      const body = JSON.parse(c || '{}');
      pedidos.push({ modelo, body, en: Date.now() });
      const ultimo = String(body.messages?.at(-1)?.content?.[0]?.text || '');
      const r = o.contestar(ultimo, modelo, body);
      if (r.fallaBedrock) {
        res.writeHead(500, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({ message: 'falla de prueba' }));
      }
      res.writeHead(200, { 'content-type': 'application/vnd.amazon.eventstream' });
      if (r.demoraMs) await new Promise((ok) => setTimeout(ok, r.demoraMs));
      if (res.closed || res.destroyed) return;
      res.write(eventoBedrock('messageStart', { role: 'assistant' }));
      let i = 0;
      if (r.texto) {
        for (const t of r.texto.match(/.{1,12}/gs) || []) res.write(eventoBedrock('contentBlockDelta', { contentBlockIndex: 0, delta: { text: t } }));
        res.write(eventoBedrock('contentBlockStop', { contentBlockIndex: 0 }));
        i++;
      }
      if (r.herramienta) {
        res.write(eventoBedrock('contentBlockStart', { contentBlockIndex: i, start: { toolUse: { toolUseId: 'tu1', name: r.herramienta.nombre } } }));
        res.write(eventoBedrock('contentBlockDelta', { contentBlockIndex: i, delta: { toolUse: { input: JSON.stringify(r.herramienta.input) } } }));
        res.write(eventoBedrock('contentBlockStop', { contentBlockIndex: i }));
      }
      res.write(eventoBedrock('messageStop', { stopReason: r.herramienta ? 'tool_use' : 'end_turn' }));
      res.end(eventoBedrock('metadata', { usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 }, metrics: { latencyMs: 1 } }));
    });
  });
  let alNodo = 0;
  const nodo = http.createServer((req, res) => {
    let c = '';
    req.on('data', (d) => (c += d));
    req.on('end', () => {
      if (req.url === '/api/precalentar') return res.writeHead(200, { 'content-type': 'application/json' }).end('{"ok":true}');
      if (!JSON.parse(c || '{}').stream) return res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ message: { content: '{}' } }));
      alNodo++;
      res.writeHead(200, { 'content-type': 'application/x-ndjson' });
      const dicho = o.nodo ? o.nodo(JSON.parse(c || '{}')) : '[EMO: neutral] Hola desde el nodo.';
      res.end(JSON.stringify({ message: { content: dicho }, done: true }) + '\n');
    });
  });
  const puente = http.createServer((req, res) => {
    let c = '';
    req.on('data', (d) => (c += d));
    req.on('end', () => {
      const propio = o.puente?.(new URL(req.url || '/', 'http://puente'), c);
      if (propio) return res.writeHead(propio.status, { 'content-type': 'application/json', 'x-cuenta': String(req.headers['x-cuenta'] || '') }).end(JSON.stringify(propio.json));
      res.writeHead(200, { 'content-type': 'application/json', 'x-cuenta': String(req.headers['x-cuenta'] || '') }).end(JSON.stringify({ vinculado: true, conectado: true, chats: [] }));
    });
  });
  const laya = http.createServer((req, res) => {
    req.resume();
    req.on('end', () => res.writeHead(503).end());
  });
  for (const s of [bedrock, nodo, puente, laya] as Array<http.Server | http2.Http2Server>) await new Promise<void>((r) => s.listen(0, '127.0.0.1', r));
  const puerto = (s: http.Server | http2.Http2Server) => (s.address() as AddressInfo).port;
  const PORT = 8100 + Math.floor(Math.random() * 280);
  const BASE = `http://127.0.0.1:${PORT}`;
  let stdout = '';
  let errores = '';
  const proc: ChildProcess = spawn(process.execPath, ['--import', import.meta.resolve('tsx'), '--import', path.join(RAIZ, 'tests', 'red-lenta.ts'), path.join(RAIZ, 'server.ts')], {
    cwd: tmp,
    env: {
      PATH: process.env.PATH || '',
      HOME: tmp,
      // Con NODE_ENV=test en las pruebas, el servidor también (lib/entorno.ts); sin él, como en producción.
      NODE_ENV: process.env.NODE_ENV === 'test' ? 'test' : 'production',
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
      AWS_ACCESS_KEY_ID: 'AKIAPRUEBA',
      AWS_SECRET_ACCESS_KEY: 'prueba',
      AWS_REGION: 'us-west-2',
      AWS_ENDPOINT_URL_BEDROCK_RUNTIME: `http://127.0.0.1:${puerto(bedrock)}`,
      WHATSAPP_PUENTE_URL: `http://127.0.0.1:${puerto(puente)}`,
      WHATSAPP_PUENTE_CLAVE: 'clave-puente',
      WHATSAPP_DUENOS: o.correo,
      COMPUTADORA_URL: 'http://127.0.0.1:9',
      COMPUTADORA_CLAVE: 'x',
      ULTRON_PADRON: `jose | José | ${o.correo} | | ultron=lee`,
      ...(o.env || {}),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true,
  });
  proc.stdout?.on('data', (d) => (stdout = (stdout + d).slice(-200_000)));
  proc.stderr?.on('data', (d) => (errores = (errores + d).slice(-4000)));
  const canal = new AbortController();
  let listo = false;
  for (let i = 0; i < 240 && !listo; i++) {
    try {
      listo = (await fetch(`${BASE}/api/health`)).ok;
    } catch {
      await new Promise((r) => setTimeout(r, 250));
    }
  }
  const yo = emitirSesion({ correo: o.correo, nombre: 'José', rol: 'Junta' });
  const h = { 'content-type': 'application/json', 'x-ultron-sesion': yo.token, 'x-aura-origen': 'app', 'x-aura-aparato': 'aparato-prueba' };
  /** Lo que llega por el canal de acciones del teléfono (cada bloque SSE con datos). */
  const acciones: string[] = [];
  if (listo) {
    void fetch(`${BASE}/api/app/acciones`, { headers: h, signal: canal.signal })
      .then(async (r) => {
        let buf = '';
        for await (const t of r.body as any) {
          buf += Buffer.from(t).toString('utf8');
          const bloques = buf.split('\n\n');
          buf = bloques.pop() || '';
          for (const b of bloques) if (/^data: /m.test(b)) acciones.push(b);
        }
      })
      .catch(() => undefined);
    const contactos = ['Ana', 'Beto', 'Mamá'].map((nombre, i) => ({ nombre, correo: `contacto${i}@ejemplo.org` }));
    await fetch(`${BASE}/api/app/contexto`, {
      method: 'POST',
      headers: h,
      body: JSON.stringify({ pantalla: 'mesa', contactos, manos: ['llamar', 'leer', 'buscar', 'idioma', 'perfil', 'recordatorio', 'recordatorio_llamada', 'llamame', 'controles'] }),
    });
    await new Promise((r) => setTimeout(r, 150));
  }
  const cerrar = () => {
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
  };
  return { BASE, h, listo, pedidos, acciones, cerrar, stdout: () => stdout, errores: () => errores, alNodo: () => alNodo };
}

/** Un stream de turno que se lee mientras llega: los eventos en orden, con su momento. */
export function abrirTurno(BASE: string, h: Record<string, string>, cuerpo: Record<string, unknown>) {
  const corte = new AbortController();
  const eventos: { ev: string; data: any; en: number }[] = [];
  const t0 = Date.now();
  const fin = fetch(`${BASE}/api/turno/stream`, { method: 'POST', headers: h, body: JSON.stringify(cuerpo), signal: corte.signal })
    .then(async (r) => {
      let buf = '';
      for await (const t of r.body as any) {
        buf += Buffer.from(t).toString('utf8');
        const bloques = buf.split('\n\n');
        buf = bloques.pop() || '';
        for (const b of bloques) {
          const ev = /^event: (\w+)/m.exec(b)?.[1];
          const d = /^data: (.*)$/m.exec(b)?.[1];
          if (ev && d) eventos.push({ ev, data: JSON.parse(d), en: Date.now() - t0 });
        }
      }
    })
    .catch(() => undefined);
  return { eventos, fin, cortar: () => corte.abort(), hay: (ev: string) => eventos.some((e) => e.ev === ev) };
}

export async function esperarQue(cond: () => boolean, ms = 4_000) {
  const t0 = Date.now();
  while (!cond() && Date.now() - t0 < ms) await new Promise((r) => setTimeout(r, 20));
  return cond();
}
