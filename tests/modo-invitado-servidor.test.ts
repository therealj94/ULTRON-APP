/**
 * Revisión del 6-oct (bloqueante 2, «ningún dato privado para invitados»), de punta a punta: el servidor de verdad
 * (server.ts) con un nodo del 27B de mentira que guarda TODO lo que le llega (system, hilo y mensaje). Se compara lo que
 * recibe el modelo en un turno de la dueña y en uno de un invitado (voz desconocida, voz conocida que no es la dueña y la
 * precaución `reciente`): el invitado no lleva su hilo, su memoria, lo que dijo antes, su nombre ni sus herramientas
 * privadas; la dueña, todo como siempre. Datos sintéticos.
 */
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';

const RAIZ = path.resolve(import.meta.dirname, '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'invitado-srv-'));
const PORT = 7760 + Math.floor(Math.random() * 40);
const BASE = `http://127.0.0.1:${PORT}`;
const SECRETO = 'secreto-de-sesion-de-prueba-invitado-0123456789';
process.env.ULTRON_SESION_SECRETO = SECRETO;
process.env.ULTRON_VOCES_DIR = path.join(tmp, 'voces');
process.env.ULTRON_MEMORIA_BUCKET = '';

const { emitirSesion } = await import('../server/seguridad');
const V = await import('../lib/voces-miembro');
const { MODELO_VOZ } = await import('../lib/voces-motor');

const DUENA = 'marta.duena@ejemplo.test';
const huella = (k: number) => Array.from({ length: MODELO_VOZ.dim }, (_, i) => (i === k ? 0.9 : 0.01));
const altaYo = V.validarAltaVoz({ nombre: '', relacion: 'yo', consentimiento: { como: 'dueño' } }, 'Marta');
const altaAna = V.validarAltaVoz({ nombre: 'Ana', relacion: 'conocido', consentimiento: { como: 'voz', frase: 'sí, recuérdame' } }, 'Marta');
assert.ok(altaYo.ok && altaAna.ok);
await V.agregarVoz(DUENA, altaYo as any, [huella(1)]);
const ANA = await V.agregarVoz(DUENA, altaAna as any, [huella(2)]);

/** El nodo del 27B, de mentira: guarda cada pedido entero y contesta como Ollama. */
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
      res.write(JSON.stringify({ message: { content: 'Va bien el proyecto.' }, done: false }) + '\n');
      return res.end(JSON.stringify({ message: { content: '' }, done: true }) + '\n');
    }
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ message: { content: 'Va bien el proyecto.' } }));
  });
});

let proc: ChildProcess;
let errores = '';

before(async () => {
  await new Promise<void>((r) => nodo.listen(0, '127.0.0.1', r));
  proc = spawn(process.execPath, ['--import', import.meta.resolve('tsx'), path.join(RAIZ, 'server.ts')], {
    cwd: tmp,
    env: {
      PATH: process.env.PATH || '',
      HOME: tmp,
      PORT: String(PORT),
      PLATAFORMA: 'ultron',
      CEREBRO_VOZ: 'qwen',
      ULTRON_SESIONES_CERRADAS_ARCHIVO: path.join(tmp, 'cerradas.json'),
      ULTRON_PERFILES_DIR: path.join(tmp, 'perfiles'),
      ULTRON_VOCES_DIR: path.join(tmp, 'voces'),
      TSX_TSCONFIG_PATH: path.join(RAIZ, 'tsconfig.json'),
      ULTRON_SESION_SECRETO: SECRETO,
      // SEC-04: despliegue de prueba SIN registro de cuentas, declarado (en producción sin declararlo, la comunidad no lee
      // datos privados: «no configurado» no es «no suspendido»; tests/sesion-suspension.test.ts).
      AURA_SUSPENSIONES: 'ninguna',
      ULTRON_NODO_URL: `http://127.0.0.1:${(nodo.address() as AddressInfo).port}`,
      ULTRON_NODO_SECRETO: 'prueba',
      // Que el servidor tenga correo y computadora para ofrecer (a la dueña sí; al invitado nunca).
      COMPUTADORA_URL: 'http://127.0.0.1:9',
      COMPUTADORA_CLAVE: 'clave-de-prueba',
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

const token = emitirSesion({ correo: DUENA, nombre: 'Marta', rol: 'Miembro' }, { comunidad: true }).token;
const SECRETOS = { hilo: 'SECRETO-HILO-banco-4471', memoria: 'SECRETO-MEMORIA-pastilla-8812', dijo: 'SECRETO-DIJO-planta-2290' };

/** Un turno de la app de Marta (JSON) y lo que le llegó al modelo con su marca. */
async function turno(marca: string, extra: Record<string, unknown> = {}, ruta = '/api/turno') {
  const r = await fetch(`${BASE}${ruta}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-ultron-sesion': token, 'x-aura-origen': 'app', 'x-aura-aparato': 'tel-marta-1' },
    body: JSON.stringify({
      message: `explícame cómo va el proyecto de la planta de beneficio este trimestre ${marca}`,
      usuario: 'Marta',
      historial: [
        { rol: 'user', texto: `léeme el correo del banco ${SECRETOS.hilo}` },
        { rol: 'ultron', texto: `Tu saldo es 12 000. ${SECRETOS.hilo}` },
      ],
      memoria: [`Marta toma la pastilla de la presión a las 8 ${SECRETOS.memoria}`],
      idTurno: `t-${marca}`,
      ...extra,
    }),
    signal: AbortSignal.timeout(60_000),
  });
  const texto = await r.text();
  assert.equal(r.status, 200, texto);
  const alModelo = alNodo.filter((c) => c.includes(marca)).join('\n');
  assert.ok(alModelo, `el turno ${marca} no llegó al modelo`);
  return { alModelo, respuesta: texto };
}

const PRIVADAS = /PEDIR_HERRAMIENTA: (correo|whatsapp|computadora|circulo|mision|tarea|triaje|cartera|investigar)\b/;

test('la dueña (sin señal de voz): su hilo, su memoria y lo que dijo antes llegan al modelo, con sus herramientas', async () => {
  const a = await turno(`DUENA-1 ${SECRETOS.dijo}`);
  assert.ok(a.alModelo.includes(SECRETOS.hilo), 'su hilo (el del teléfono)');
  assert.match(a.alModelo, /PEDIR_HERRAMIENTA: correo\b/, 'su correo');
  assert.match(a.alModelo, /PEDIR_HERRAMIENTA: circulo\b/, 'su círculo');
  // Lo que pidió recordar y lo que dijo antes quedan en SU memoria y llegan en el turno siguiente.
  await new Promise((r) => setTimeout(r, 400));
  const b = await turno('DUENA-2', { historial: [] });
  assert.ok(b.alModelo.includes(SECRETOS.memoria), 'su memoria');
  assert.ok(b.alModelo.includes(SECRETOS.dijo), 'lo que dijo antes (su hilo en el servidor)');
  assert.ok(b.alModelo.includes('Marta'), 'su nombre');
  assert.doesNotMatch(b.respuesta, /modo invitado/);
});

for (const [nombre, quienHabla] of [
  ['voz desconocida (con la de la dueña guardada)', { desconocida: true }],
  ['voz conocida que no es la dueña (Ana)', { id: ANA.id }],
  ['precaución `reciente` (un «sí» corto justo después de Ana)', { id: ANA.id, reciente: true }],
] as const) {
  test(`invitado — ${nombre}: nada privado de la dueña llega al modelo, ni sus herramientas; se le dice «modo invitado»`, async () => {
    const marca = `INVITADO-${nombre.length}`;
    const { alModelo, respuesta } = await turno(marca, { hablado: true, quienHabla });
    for (const [que, s] of Object.entries(SECRETOS)) assert.ok(!alModelo.includes(s), `el invitado no recibe ${que}`);
    assert.ok(!alModelo.includes('12 000'), 'nada del hilo de la dueña');
    assert.ok(!alModelo.includes(DUENA), 'ni su correo');
    assert.ok(!/\bMarta\b/.test(alModelo), 'ni su nombre');
    assert.doesNotMatch(alModelo, PRIVADAS, 'ninguna herramienta privada');
    assert.match(alModelo, /MODO INVITADO/);
    assert.match(JSON.parse(respuesta).reply, /^Te respondo en modo invitado\./);
    // Y su turno no queda en la memoria de la dueña.
    const despues = await turno(`DUENA-TRAS-${marca}`, { historial: [] });
    assert.ok(!despues.alModelo.includes(marca.replace('INVITADO', 'X')) && !despues.alModelo.includes(`trimestre ${marca}`), 'lo del invitado no entra en su hilo');
    assert.ok(despues.alModelo.includes(SECRETOS.memoria), 'la dueña sigue con lo suyo');
  });
}

test('invitado por el camino en vivo (SSE): tampoco llega nada privado, y lo primero que oye es «modo invitado»', async () => {
  const marca = 'INVITADO-SSE';
  const r = await fetch(`${BASE}/api/turno/stream`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-ultron-sesion': token, 'x-aura-origen': 'app', 'x-aura-aparato': 'tel-marta-1' },
    body: JSON.stringify({ message: `explícame cómo va el proyecto de la planta de beneficio este trimestre ${marca}`, usuario: 'Marta', historial: [{ rol: 'user', texto: SECRETOS.hilo }], memoria: [SECRETOS.memoria + ' algo más'], hablado: true, quienHabla: { desconocida: true }, idTurno: `t-${marca}` }),
    signal: AbortSignal.timeout(60_000),
  });
  const sse = await r.text();
  const alModelo = alNodo.filter((c) => c.includes(marca)).join('\n');
  assert.ok(alModelo, sse);
  for (const s of Object.values(SECRETOS)) assert.ok(!alModelo.includes(s));
  assert.doesNotMatch(alModelo, PRIVADAS);
  const primerDelta = /event: delta\ndata: (.*)/.exec(sse);
  assert.ok(primerDelta && JSON.parse(primerDelta[1]).text.startsWith('Te respondo en modo invitado.'), sse.slice(0, 400));
});
