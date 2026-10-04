/**
 * PRUEBA DE PUNTA A PUNTA CON EL CEREBRO DE VERDAD (no un falso): levanta el servidor entero, un teléfono
 * emulado (su canal de acciones y su contexto con contactos y manos) y le habla por el camino real de la app
 * (/api/turno/stream, hablado) con los pedidos de José, la llamada del 3-oct incluida. El cerebro es Bedrock
 * con las credenciales de AWS de quien lo corre; el Qwen del nodo es un falso que solo cuenta si lo usaron
 * (si el cerebro con manos falla, se nota).
 *
 *   npx tsx scripts/voz/probar-manos-vivo.ts
 *
 * Dice, por pedido: la primera frase (ms), lo que dijo, por qué cerebro fue y qué le llegó al teléfono.
 */
import fs from 'node:fs';
import os from 'node:os';
import http from 'node:http';
import path from 'node:path';
import { spawn } from 'node:child_process';
import type { AddressInfo } from 'node:net';

const RAIZ = process.cwd();
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aura-manos-vivo-'));
const SECRETO = 'secreto-de-prueba-largo-para-el-servidor-entero-manos';
process.env.ULTRON_SESION_SECRETO = SECRETO;
process.env.ULTRON_SESIONES_CERRADAS_ARCHIVO = path.join(tmp, 'cerradas-prueba.json');
process.env.ULTRON_MEMORIA_BUCKET = '';
const { emitirSesion } = await import('../../server/seguridad');

let alNodo = 0;
const nodo = http.createServer((req, res) => {
  let c = '';
  req.on('data', (d) => (c += d));
  req.on('end', () => {
    if (req.url === '/api/precalentar') return res.writeHead(200, { 'content-type': 'application/json' }).end('{"ok":true}');
    alNodo++;
    res.writeHead(200, { 'content-type': 'application/x-ndjson' });
    res.end(JSON.stringify({ message: { content: '[EMO: neutral] (respuesta del Qwen falso)' }, done: true }) + '\n');
  });
});
await new Promise<void>((r) => nodo.listen(0, '127.0.0.1', r));

const PORT = 7990 + Math.floor(Math.random() * 9);
const BASE = `http://127.0.0.1:${PORT}`;
const env: Record<string, string> = {
  PATH: process.env.PATH || '',
  HOME: process.env.HOME || tmp,
  NODE_ENV: 'production',
  PORT: String(PORT),
  PLATAFORMA: 'ultron',
  ULTRON_SESION_SECRETO: SECRETO,
  ULTRON_SESIONES_CERRADAS_ARCHIVO: path.join(tmp, 'cerradas.json'),
  ULTRON_PERFILES_DIR: path.join(tmp, 'perfiles'),
  ULTRON_NODO_URL: `http://127.0.0.1:${(nodo.address() as AddressInfo).port}`,
  ULTRON_NODO_SECRETO: 'prueba',
  CEREBRO_VOZ: 'nova',
  TSX_TSCONFIG_PATH: path.join(RAIZ, 'tsconfig.json'),
  ULTRON_PADRON: 'jose | José | jose.prueba@ordenglobal.org | | ultron=lee',
};
for (const k of Object.keys(process.env)) if (/^(AWS_|HTTPS?_PROXY|NO_PROXY|NODE_EXTRA_CA_CERTS|SSL_CERT_FILE)/i.test(k)) env[k] = String(process.env[k]);
const proc = spawn(process.execPath, ['--import', import.meta.resolve('tsx'), path.join(RAIZ, 'server.ts')], { cwd: tmp, env, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
let log = '';
proc.stdout?.on('data', (d) => (log += d));
proc.stderr?.on('data', (d) => (log += d));
const cerrar = () => {
  try {
    process.kill(-proc.pid!);
  } catch {
    /* */
  }
  nodo.close();
};
let listo = false;
for (let i = 0; i < 240 && !listo; i++) {
  try {
    listo = (await fetch(`${BASE}/api/health`)).ok;
  } catch {
    await new Promise((r) => setTimeout(r, 250));
  }
}
if (!listo) {
  console.log('no levantó:', log.slice(-2000));
  cerrar();
  process.exit(1);
}

const yo = emitirSesion({ correo: 'jose.prueba@ordenglobal.org', nombre: 'José', rol: 'Junta' });
const h = { 'content-type': 'application/json', 'x-ultron-sesion': yo.token };
const APARATO = 'telefono-prueba-1';

// El teléfono: su canal de acciones abierto y su contexto (contactos y manos de la app 5.x).
const ctrl = new AbortController();
const canal = await fetch(`${BASE}/api/app/acciones`, { headers: { ...h, 'x-aura-aparato': APARATO }, signal: ctrl.signal });
let delCanal = '';
void (async () => {
  try {
    for await (const t of canal.body as any) delCanal += new TextDecoder().decode(t);
  } catch {
    /* cerrado */
  }
})();
await fetch(`${BASE}/api/app/contexto`, {
  method: 'POST',
  headers: { ...h, 'x-aura-aparato': APARATO },
  body: JSON.stringify({
    pantalla: 'mesa',
    contactos: [
      { correo: 'beto@x.com', nombre: 'Beto' },
      { correo: 'mama@x.com', nombre: 'Mamá' },
      { correo: 'ana@x.com', nombre: 'Ana López' },
    ],
    manos: ['llamar', 'leer', 'buscar', 'idioma', 'perfil', 'recordatorio', 'recordatorio_llamada', 'llamame'],
  }),
});

const accionesDelCanal = () =>
  delCanal
    .split('\n\n')
    .filter((b) => !/^event: (?!accion$)/m.test(b))
    .map((b) => /^data: (\{.*\})$/m.exec(b)?.[1])
    .filter((d): d is string => !!d)
    .map((d) => JSON.parse(d).accion);

async function turno(message: string) {
  const antes = accionesDelCanal().length;
  const nodoAntes = alNodo;
  const t0 = Date.now();
  const r = await fetch(`${BASE}/api/turno/stream`, {
    method: 'POST',
    headers: { ...h, 'x-aura-origen': 'app', 'x-aura-aparato': APARATO },
    body: JSON.stringify({ message, hablado: true, idioma: 'es', avatar: 'aura' }),
  });
  let primera = 0;
  let dicho = '';
  let via = '';
  for (const b of (await r.text()).split('\n\n')) {
    const ev = /^event: (\w+)/m.exec(b)?.[1];
    const d = /^data: (.*)$/m.exec(b)?.[1];
    if (!ev || !d) continue;
    const j = JSON.parse(d);
    if ((ev === 'delta' || ev === 'replace') && j.text) {
      if (!primera) primera = Date.now() - t0;
      dicho = ev === 'replace' ? j.text : dicho + j.text;
    }
    if (ev === 'done') {
      via = j.via;
      if (!dicho && j.reply) dicho = j.reply;
    }
    if (ev === 'error') dicho += ` [error ${j.error}]`;
  }
  await new Promise((r) => setTimeout(r, 300));
  const nuevas = accionesDelCanal().slice(antes);
  console.log(`• ${message}\n   1ª frase ${primera} ms · total ${Date.now() - t0} ms · ${via}${alNodo > nodoAntes ? ' · (usó el Qwen del nodo)' : ''}\n   dice: «${dicho.trim().slice(0, 200)}»${nuevas.length ? `\n   al teléfono: ${nuevas.map((a) => JSON.stringify(a)).join(' · ')}` : ''}`);
}

const PEDIDOS = (process.argv.slice(2).length ? process.argv.slice(2) : [
  '¿Cómo vas?',
  'Bien, ¿me puedes hacer otra llamada en unos 30 segundos? ¿Me vas a llamar en 30 segundos?',
  'Llámame en diez minutos para lo del banco.',
  'Llama a Beto.',
  'Okey.',
  'Recuérdame mañana a las cinco de la tarde llamar a la ferretería.',
  'Escríbele a Ana que llego tarde a la reunión.',
  'Abre ajustes.',
  'Explícame en una frase qué es la inflación.',
  '¿Qué me recomiendas cenar hoy?',
]);
try {
  for (const p of PEDIDOS) await turno(p);
} finally {
  const lineas = log.split('\n').filter((l) => /cerebro (rápido|manos)|\[voz\] turno|turno en vivo/.test(l));
  if (lineas.length) console.log('\nlogs del servidor:\n' + lineas.slice(-20).join('\n'));
  ctrl.abort();
  cerrar();
  fs.rmSync(tmp, { recursive: true, force: true });
  process.exit(0);
}
