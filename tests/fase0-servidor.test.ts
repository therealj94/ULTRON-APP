/**
 * Fase 0 de seguridad, de punta a punta: el servidor de verdad (server.ts) arrancado SIN `NODE_ENV`,
 * como quedaría un despliegue al que se le olvidó la variable. Tiene que portarse como producción.
 *
 *  · 0.2: sin marca de desarrollo no hay Vite sirviendo el repo ni mesa abierta.
 *  · 0.3: un turno sin sesión no llega al nodo del 27B (401); con sesión de AU-RA, sí.
 *  · 0.6: una sesión de Dr Electrum (código temporal o persona solo de Electrum) no abre la mesa.
 */
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { emitirSesion, DOMINIO_CODIGO } from '../server/seguridad';

const RAIZ = path.resolve(import.meta.dirname, '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fase0-'));
const PORT = 7700 + Math.floor(Math.random() * 40);
const BASE = `http://127.0.0.1:${PORT}`;

const SECRETO = 'secreto-de-sesion-de-prueba-fase0-0123456789';
process.env.ULTRON_SESION_SECRETO = SECRETO;

/** El nodo del 27B, de mentira: anota cada mensaje que le llega y contesta como Ollama. */
const alNodo: string[] = [];
const nodo = http.createServer((req, res) => {
  let cuerpo = '';
  req.on('data', (c) => (cuerpo += c));
  req.on('end', () => {
    alNodo.push(cuerpo);
    let j: any = {};
    try {
      j = JSON.parse(cuerpo || '{}');
    } catch {
      /* no era JSON */
    }
    if (j.stream) {
      res.setHeader('Content-Type', 'application/x-ndjson');
      res.write(JSON.stringify({ message: { content: 'Va bien, sin novedades.' }, done: false }) + '\n');
      return res.end(JSON.stringify({ message: { content: '' }, done: true }) + '\n');
    }
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ message: { content: 'Va bien, sin novedades.' } }));
  });
});

const PADRON = ['aura | Persona Aura | aura.prueba@ordenglobal.org | | ultron=lee', 'solo-electrum | Ing. Electrum | ing.electrum@mina.hn | | electrum=escribe'].join('\n');
const sesion = (correo: string, nombre = 'Prueba') => emitirSesion({ correo, nombre, rol: 'Prueba' }).token;
/** Una pregunta de verdad (no un saludo): la contesta el 27B, no la charla rápida. */
const PREGUNTA = (marca: string) => `explícame cómo va el proyecto de la planta de beneficio este trimestre ${marca}`;
const llego = (marca: string) => alNodo.some((c) => c.includes(marca));

let proc: ChildProcess;
let errores = '';

before(async () => {
  await new Promise<void>((r) => nodo.listen(0, '127.0.0.1', r));
  proc = spawn(process.execPath, ['--import', import.meta.resolve('tsx'), path.join(RAIZ, 'server.ts')], {
    // En una carpeta aparte: lo que el servidor escriba en data/ (memorias, sesiones) no toca el repo.
    cwd: tmp,
    env: {
      // Solo lo que hace falta, y a propósito SIN NODE_ENV ni AURA_DEV.
      PATH: process.env.PATH || '',
      HOME: tmp,
      PORT: String(PORT),
      PLATAFORMA: 'ultron',
      ULTRON_SESIONES_CERRADAS_ARCHIVO: path.join(tmp, 'cerradas.json'),
      ULTRON_PERFILES_DIR: path.join(tmp, 'perfiles'),
      TSX_TSCONFIG_PATH: path.join(RAIZ, 'tsconfig.json'),
      ULTRON_SESION_SECRETO: SECRETO,
      ULTRON_PADRON: PADRON,
      ULTRON_NODO_URL: `http://127.0.0.1:${(nodo.address() as AddressInfo).port}`,
      ULTRON_NODO_SECRETO: 'prueba',
    },
    stdio: ['ignore', 'ignore', 'pipe'],
    detached: true,
  });
  proc.stderr?.on('data', (d) => (errores = (errores + d).slice(-4000)));
  let listo = false;
  for (let i = 0; i < 240 && !listo; i++) {
    try {
      listo = (await fetch(`${BASE}/api/health`)).ok;
    } catch {
      await new Promise((r) => setTimeout(r, 250));
    }
  }
  assert.ok(listo, `el servidor no levantó: ${errores}`);
});

after(() => {
  try {
    process.kill(-proc.pid!);
  } catch {
    /* ya se fue */
  }
  nodo.closeAllConnections?.();
  nodo.close();
  fs.rmSync(tmp, { recursive: true, force: true });
});

const turno = (ruta: string, cuerpo: Record<string, unknown>, cabeceras: Record<string, string> = {}) =>
  fetch(`${BASE}${ruta}`, { method: 'POST', headers: { 'content-type': 'application/json', ...cabeceras }, body: JSON.stringify(cuerpo), signal: AbortSignal.timeout(60_000) });

test('0.2 sin NODE_ENV: Vite no sirve el árbol del repo', async () => {
  // /@vite/client lo sirve Vite en modo middleware sea cual sea su raíz: es la seña de que está montado.
  for (const ruta of ['/@vite/client', '/@vite/env', '/lib/entorno.ts']) {
    const r = await fetch(`${BASE}${ruta}`);
    const cuerpo = await r.text();
    assert.ok(!/modoDesarrollo|import\.meta\.hot|createHotContext|exigirMesa/.test(cuerpo), `${ruta} salió como código (${r.status})`);
  }
});

test('0.2 sin NODE_ENV: la mesa y lo de la junta piden sesión', async () => {
  for (const ruta of ['/api/memoria', '/api/sistema', '/api/taller', '/api/vault/status']) {
    const r = await fetch(`${BASE}${ruta}`);
    assert.equal(r.status, 401, `${ruta} abrió sin sesión`);
  }
  const salud = (await (await fetch(`${BASE}/api/health`)).json()) as any;
  assert.equal(salud.cerebro, undefined, 'sin sesión, la salud no enseña los nodos');
  assert.equal(salud.qwen?.url, undefined);
});

test('0.3 un turno sin sesión no llega al 27B: 401 y el nodo no se entera', async () => {
  for (const ruta of ['/api/turno', '/api/turno/stream']) {
    const marca = `ANONIMO-${ruta.length}`;
    const r = await turno(ruta, { message: PREGUNTA(marca), usuario: 'José' });
    assert.equal(r.status, 401, `${ruta} corrió sin sesión`);
    const j = (await r.json()) as any;
    assert.equal(j.code, 'sesion_requerida', 'el teléfono renueva su token con este código');
    assert.equal(llego(marca), false, `${ruta}: el nodo recibió un turno anónimo`);
  }
  // Abrir una conversación de ElevenLabs (piensa con el 27B) tampoco, aunque la ruta sea «de voz».
  assert.equal((await turno('/api/voz/agente', { avatar: 'aura' })).status, 401);
  // Un token inventado no es sesión.
  assert.equal((await turno('/api/turno', { message: PREGUNTA('FALSO') }, { 'x-ultron-sesion': 'u1.falso.falso' })).status, 401);
  assert.equal(llego('FALSO'), false);
});

test('0.3 con sesión de AU-RA el turno sí llega (junta del padrón y miembro de la comunidad)', async () => {
  for (const [quien, correo] of [['junta', 'aura.prueba@ordenglobal.org'], ['miembro', 'ana.comunidad@gmail.com']]) {
    const marca = `CONSESION-${quien}`;
    const r = await turno('/api/turno', { message: PREGUNTA(marca) }, { 'x-ultron-sesion': sesion(correo) });
    assert.equal(r.status, 200, `${quien}: ${await r.clone().text()}`);
    assert.ok(llego(marca), `${quien}: el turno no llegó al nodo`);
  }
});

test('0.6 una sesión de Dr Electrum no abre la mesa de AU-RA', async () => {
  const deElectrum = { 'código temporal': sesion(`codigo-7${DOMINIO_CODIGO}`, 'Keidy'), 'persona solo de Electrum': sesion('ing.electrum@mina.hn', 'Ing. Electrum') };
  for (const [quien, token] of Object.entries(deElectrum)) {
    const h = { 'x-ultron-sesion': token };
    const marca = `ELECTRUM-${quien.length}`;
    const r = await turno('/api/turno', { message: PREGUNTA(marca) }, h);
    assert.equal(r.status, 401, `${quien}: corrió un turno en AU-RA`);
    assert.equal(llego(marca), false);
    assert.equal((await fetch(`${BASE}/api/memoria`, { headers: h })).status, 401, `${quien}: leyó la memoria de la mesa`);
    assert.equal((await turno('/api/voz/agente', { avatar: 'aura' }, h)).status, 401, `${quien}: abrió una conversación de voz`);
  }
});
