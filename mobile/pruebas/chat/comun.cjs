// Lo que comparten las pruebas del chat: levantar el relevo REAL (servidor.py) con un Genesis de
// mentira, cargar el código del teléfono empaquetado y contar aciertos y fallos.
const { spawn } = require('child_process');
const http = require('http');
const net = require('net');
const fs = require('fs');
const os = require('os');
const path = require('path');

const RELEVO_PY = process.env.RELEVO_PY || '/home/user/express-js-on-vercel/infra/mensajes/servidor.py';
let fallos = 0;
const hijos = [];
process.on('exit', () => hijos.forEach((h) => { try { h.kill(); } catch {} }));

function ok(que, cumple, extra = '') {
  console.log(`${cumple ? '  ok  ' : ' FALLA'}  ${que}${extra ? '  · ' + extra : ''}`);
  if (!cumple) fallos++;
}
function fin() {
  console.log(fallos ? `\n${fallos} fallo(s)` : '\ntodo bien');
  process.exit(fallos ? 1 : 0);
}
const espera = (ms) => new Promise((r) => setTimeout(r, ms));
const libre = () => new Promise((r) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); }); });

/** Genesis de mentira: un pase `PASE:<correo>` vale para ese correo (con destino pulse2chat). */
async function genesisFalso() {
  const puerto = await libre();
  const srv = http.createServer((q, s) => {
    let b = '';
    q.on('data', (d) => (b += d));
    q.on('end', () => {
      let j = {};
      try { j = JSON.parse(b || '{}'); } catch {}
      const t = String(j.token || '');
      const vale = t.startsWith('PASE:');
      const out = vale ? { valido: true, aud: ['aura', 'pulse2chat'], correo: t.slice(5), gid: 'GEN-AAAA-BBBB-C' } : { valido: false };
      s.writeHead(vale ? 200 : 401, { 'Content-Type': 'application/json' });
      s.end(JSON.stringify(out));
    });
  });
  await new Promise((r) => srv.listen(puerto, '127.0.0.1', r));
  srv.unref();
  return `http://127.0.0.1:${puerto}`;
}

/** El relevo de verdad, en un puerto libre y con datos en una carpeta temporal. */
async function arrancarRelevo() {
  if (!fs.existsSync(RELEVO_PY)) {
    console.log(`  --    no está el relevo en ${RELEVO_PY} (RELEVO_PY=…): prueba saltada`);
    process.exit(0);
  }
  const GEN = await genesisFalso();
  const puerto = await libre();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'relevo-chat-'));
  const h = spawn('python3', [RELEVO_PY], {
    env: {
      ...process.env,
      MENSAJES_DATOS: tmp + '/datos.json',
      MENSAJES_ARCHIVOS: tmp + '/archivos',
      MENSAJES_PUERTO: String(puerto),
      MENSAJES_GENESIS_URL: GEN,
      MENSAJES_GENESIS_CLAVE: 'clave-de-prueba',
      MENSAJES_WALLET_URL: 'http://127.0.0.1:9',
      MENSAJES_VAPID_PEM: tmp + '/no-hay.pem',
    },
    stdio: ['ignore', 'ignore', process.env.VER_RELEVO ? 'inherit' : 'ignore'],
  });
  hijos.push(h);
  const API = `http://127.0.0.1:${puerto}`;
  for (let i = 0; i < 60; i++) {
    try { await fetch(API + '/salud'); break; } catch {}
    await espera(150);
  }
  process.env.MENSAJES_API = API;
  const post = (r, b) => fetch(API + r, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) })
    .then(async (x) => ({ st: x.status, ...(await x.json().catch(() => ({}))) }));
  let n = 0;
  /** Una cuenta nueva en el relevo (sin pasar por el teléfono). */
  const cuenta = async (nombre = 'Alguien') => {
    const correo = `p${Date.now().toString(36)}${++n}@prueba.test`;
    const r = await post('/alta', { correo, nombre });
    return { correo, llave: r.llave };
  };
  /** Que a y b sean amigos. */
  const amigos = async (a, b) => {
    await post('/amistad/pedir', { ...a, para: b.correo });
    await post('/amistad/responder', { ...b, de: a.correo, aceptar: true });
  };
  return { API, post, cuenta, amigos };
}

/** El código del teléfono (construido con construir.cjs). `MOVIL=` apunta a otro empaquetado. */
function movil() {
  return require(path.resolve(process.env.MOVIL || path.join(__dirname, 'out/movil.cjs')));
}

/** Pone a este «teléfono» dentro de una cuenta del relevo. */
async function entrarComo(M, c) {
  await M.RELEVO.salir();
  globalThis.__ss.m.set('aura.p2c.cuenta', JSON.stringify(c));
  return M.RELEVO.recuperar();
}

module.exports = { ok, fin, espera, arrancarRelevo, movil, entrarComo };
