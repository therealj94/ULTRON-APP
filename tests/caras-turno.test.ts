/**
 * La cámara honesta con las caras, del lado del servidor (José, 6-oct, en la mesa con su hija: «Me acompaña mi hija» →
 * «¿es Nora? ¿O es Ivón?» con la cara sin reconocer; «Reconoce a [ella]» → «no puedo identificar personas por su
 * cara»; «Mira, mira» → «¿Qué ves?»). Datos inventados: la dueña Marta, su hija Bea; en su memoria, Nora e Ivón.
 *
 *  · lib/caras-turno.ts: el hecho CARAS (la verdad de lo que puede: reconoce las caras guardadas, nombra solo lo que ESCENA
 *    confirma, nunca un nombre de la memoria para una cara sin reconocer, y a quien no conoce lo dice y ofrece aprenderlo);
 *    para un invitado, ni nombres ni aprender; «mira», «reconoce a…», «me acompaña…» cuentan como preguntar por lo visto.
 *    Revisión del 6-oct: CARAS solo en los turnos que preguntan por lo que se ve o por alguien (antes, en cada turno con
 *    una cara en la escena: el turno hablado pesado pasaba del tope), corto, y la oferta de aprender una vez por persona
 *    desconocida en la sesión del teléfono; «mira» de muletilla («mira, recuérdame…») no es preguntar por lo visto.
 *  · la vista para el cerebro (lib/vision-estructurada.ts) ya no le dice «No identifiques a nadie por su cara».
 *  · De punta a punta: el servidor de verdad (server.ts) con un nodo del 27B de mentira que guarda lo que le llega.
 */
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { SESION_OFERTA_MS, carasDeEscena, hechoCaras, olvidarOfertasCaras, preguntaPorVer } from '../lib/caras-turno';
import { parsearVista, vistaAHechos } from '../lib/vision-estructurada';
import { buildPersonality } from '../server/desk';

const ESCENA_HIJA = 'Reconozco a Marta (quien te habla); 1 persona(s) que no conozco';

test('CARAS: con alguien sin reconocer, la verdad y la oferta de aprender; nunca nombres de la memoria ni «no puedo»', () => {
  olvidarOfertasCaras();
  const h = hechoCaras({ escena: ESCENA_HIJA, mensaje: 'Me acompaña mi hija.', ambito: 'marta|tel-1', ahora: 1000 });
  assert.ok(h);
  assert.match(h!, /tu teléfono SÍ reconoce las caras que la dueña te presentó/);
  assert.match(h!, /nunca un nombre de MEMORIA \(ni como pregunta\)/);
  assert.match(h!, /«veo a alguien que todavía no conozco\. ¿Cómo se llama\? Si quieres, aprendo su cara y la recuerdo»/);
  assert.match(h!, /Nunca digas que no puedes reconocer caras/);
  // Con «sin identificar todavía» (recién llegada) y preguntando qué ve: tampoco se le da nombre.
  assert.match(hechoCaras({ escena: '1 persona(s) sin identificar todavía (trátala como desconocida)', mensaje: '¿qué ves?' })!, /no conoces/);
  // Todos reconocidos: sin oferta, pero la misma regla de nombres.
  const todos = hechoCaras({ escena: 'Reconozco a Marta (quien te habla), Bea (tu hija)', mensaje: '¿quién está conmigo?' })!;
  assert.match(todos, /nombra solo a quien ESCENA reconoce/);
  assert.doesNotMatch(todos, /aprendo su cara/);
  // Sin caras en la escena y sin preguntar por nadie: nada que agregar.
  assert.equal(hechoCaras({ escena: 'Una persona sonriendo; en la mesa: taza', mensaje: '¿qué tiempo hace?' }), null);
  // Pregunta por alguien sin caras en la escena: la verdad (reconocer caras apagado o nadie a la vista), sin adivinar.
  const sin = hechoCaras({ escena: '', mensaje: 'Reconoce a mi hija' })!;
  assert.match(sin, /no llegó quién es nadie por la cara/);
  assert.match(sin, /Reconocer caras/);
  assert.match(sin, /No digas que no puedes reconocer caras/);
  // Invitado: ni nombres ni aprender caras.
  const inv = hechoCaras({ escena: '1 persona(s) que no conozco', mensaje: 'me acompaña mi hija', invitado: true })!;
  assert.match(inv, /no digas el nombre de nadie por su cara ni ofrezcas aprender caras/);
  assert.doesNotMatch(inv, /aprendo su cara/);
  assert.deepEqual(carasDeEscena(ESCENA_HIJA), { reconocidas: true, sinNombre: true, desconocidas: 1 });
  assert.equal(carasDeEscena('Reconozco a Marta (quien te habla); 2 persona(s) que no conozco').desconocidas, 2);
});

test('revisión 6-oct (GRAVE 1): CARAS solo cuando el turno pregunta por lo que se ve o por alguien, y corto (antes, en cada turno con una cara)', () => {
  olvidarOfertasCaras();
  const ESCENA_PESADA = 'Reconozco a Marta (quien te habla), Ana (tu esposa); 1 persona(s) que no conozco. Veo a tres personas, una muy cerca.';
  // Lo de la prueba del presupuesto de la voz: la pregunta no es de lo que se ve → sin CARAS (la ESCENA ya va aparte).
  for (const mensaje of ['Oye, ¿y qué opinas de cómo va la mina de Danlí esta semana? Analiza a fondo los riesgos.', 'hola', 'mira, recuérdame lo del banco', 'Cuéntame un chiste'])
    assert.equal(hechoCaras({ escena: ESCENA_PESADA, mensaje, ambito: 'marta|tel-1' }), null, mensaje);
  // Pregunta por lo que se ve, por alguien, o presenta a alguien: sí.
  for (const mensaje of ['¿Qué ves?', 'Mira, mira', '¿quién es ella?', 'Te presento a Bea', 'Me acompaña mi hija']) {
    olvidarOfertasCaras();
    const h = hechoCaras({ escena: ESCENA_PESADA, mensaje, ambito: 'marta|tel-1' });
    assert.ok(h, mensaje);
    // Recortado: con la oferta, menos de la mitad de lo de antes (450–600 car.).
    assert.ok(h!.length <= 400, `${mensaje}: ${h!.length} car.`);
  }
});

test('revisión 6-oct (GRAVE 1): la oferta de aprender, UNA vez por persona desconocida en la sesión del teléfono', () => {
  olvidarOfertasCaras();
  const amb = 'marta|tel-1';
  const pide = (escena: string, ahora: number, ambito = amb) => hechoCaras({ escena, mensaje: '¿quién está conmigo?', ambito, ahora })!;
  const UNA = 'Reconozco a Marta (quien te habla); 1 persona(s) que no conozco';
  const DOS = 'Reconozco a Marta (quien te habla); 2 persona(s) que no conozco';
  assert.match(pide(UNA, 1_000), /aprendo su cara y la recuerdo/, 'la primera vez, la oferta');
  const segunda = pide(UNA, 60_000);
  assert.doesNotMatch(segunda, /aprendo su cara/, 'la misma persona otra vez: no se repite');
  assert.match(segunda, /ya ofreciste aprender su cara: no lo repitas/);
  assert.match(segunda, /«alguien que todavía no conozco»/, 'pero sigue diciendo la verdad');
  assert.match(pide(DOS, 90_000), /aprendo su cara y la recuerdo/, 'llega otra persona desconocida: a ella sí');
  assert.doesNotMatch(pide(DOS, 120_000), /aprendo su cara/);
  assert.doesNotMatch(pide(UNA, 150_000), /aprendo su cara/, 'se fue una: no se le ofrece otra vez a la que queda');
  assert.match(pide(UNA, 150_000, 'marta|tel-2'), /aprendo su cara/, 'otro teléfono, otra sesión');
  assert.match(pide(UNA, 150_000 + SESION_OFERTA_MS + 1), /aprendo su cara/, 'sesión nueva (pasó el rato sin nadie desconocido)');
});

test('«mira» de verdad («mira», «mira, mira», «mira esto», «mírame»), no la muletilla; «¿me ves?», «reconoce a…», «me acompaña…» preguntan por lo que se ve', () => {
  for (const f of ['Mira, mira', '¡Mira!', 'mira', 'Mira esto', 'mira aquí', 'mira acá', '¿Me ves?', 'mírame', 'Reconoce a Bea', '¿quién es ella?', 'Me acompaña mi hija', '¿qué ves?'])
    assert.equal(preguntaPorVer(f), true, f);
  for (const f of ['¿cuánto está el oro?', 'admiro tu trabajo', 'mira, recuérdame lo del banco', 'Mira, te cuento lo de la junta', 'mira que se me olvidó'])
    assert.equal(preguntaPorVer(f), false, f);
});

test('la vista y la persona ya no le dicen al cerebro que no puede reconocer caras', () => {
  const h = vistaAHechos(parsearVista('{"escena":"dos personas en una mesa","personas":[{"que_hace":"sonríe"},{"que_hace":"mira"}]}'), 'escena');
  assert.doesNotMatch(h, /No identifiques a nadie por su cara/);
  assert.match(h, /no adivines nombres por ella; nombra solo a quien ESCENA dice que reconoces por su cara guardada/);
  const p = buildPersonality({ nombre: 'Marta' });
  assert.match(p, /Nombres solo los que ESCENA reconoce \(caras guardadas del teléfono\); nunca adivines uno/);
  // Corto: no más largo que el OJOS de antes (el system hablado tiene tope de fichas).
  const ojos = p.split('\n').find((l) => l.startsWith('OJOS:')) || '';
  assert.ok(ojos.length > 0 && ojos.length <= 256, `OJOS: ${ojos.length} car. (el de antes, 256)`);
  assert.doesNotMatch(p, /sin inventar quién es ni cómo se llama\. Si trae VISION/, 'lo de antes, sin decir que sí reconoce');
});

test('revisión 6-oct (MEDIO 4): ni el código ni las pruebas de las caras citan nombres reales de la familia (solo inventados)', () => {
  // Armados por partes para que esta misma prueba no los contenga.
  const reales = [['Anto', 'nella'].join(''), ['L', 'ía'].join('')];
  const raiz = path.resolve(import.meta.dirname, '..');
  const archivos = ['lib/caras-turno.ts', 'tests/caras-turno.test.ts', 'server/desk.ts', 'lib/vision-estructurada.ts', 'mobile/pruebas/caras/aprender.prueba.mjs', 'mobile/src/screens/DeskScreen.tsx'];
  for (const d of ['mobile/src/caras']) for (const f of fs.readdirSync(path.join(raiz, d))) if (/\.(ts|tsx)$/.test(f)) archivos.push(`${d}/${f}`);
  for (const f of archivos) {
    const texto = fs.readFileSync(path.join(raiz, f), 'utf8');
    for (const n of reales) assert.ok(!new RegExp(`(?<!\\p{L})${n}(?!\\p{L})`, 'u').test(texto), `${f} cita «${n}»`);
  }
});

/* ── de punta a punta: lo que le llega al modelo en el turno de la mesa ─────────────────────── */

const RAIZ = path.resolve(import.meta.dirname, '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'caras-turno-'));
const PORT = 7820 + Math.floor(Math.random() * 40);
const BASE = `http://127.0.0.1:${PORT}`;
const SECRETO = 'secreto-de-sesion-de-prueba-caras-0123456789abc';
process.env.ULTRON_SESION_SECRETO = SECRETO;
process.env.ULTRON_VOCES_DIR = path.join(tmp, 'voces');
process.env.ULTRON_MEMORIA_BUCKET = '';

const { emitirSesion } = await import('../server/seguridad');
const V = await import('../lib/voces-miembro');
const { MODELO_VOZ } = await import('../lib/voces-motor');
const DUENA = 'marta.camara@ejemplo.test';
const altaYo = V.validarAltaVoz({ nombre: '', relacion: 'yo', consentimiento: { como: 'dueño' } }, 'Marta');
assert.ok(altaYo.ok);
await V.agregarVoz(DUENA, altaYo as any, [Array.from({ length: MODELO_VOZ.dim }, (_, i) => (i === 1 ? 0.9 : 0.01))]);

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
    const contenido = 'Veo a alguien que todavía no conozco.';
    if (j.stream) {
      res.setHeader('Content-Type', 'application/x-ndjson');
      res.write(JSON.stringify({ message: { content: contenido }, done: false }) + '\n');
      return res.end(JSON.stringify({ message: { content: '' }, done: true }) + '\n');
    }
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ message: { content: contenido } }));
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
      ...(process.env.NODE_ENV ? { NODE_ENV: process.env.NODE_ENV } : {}),
      ULTRON_SESIONES_CERRADAS_ARCHIVO: path.join(tmp, 'cerradas.json'),
      ULTRON_PERFILES_DIR: path.join(tmp, 'perfiles'),
      ULTRON_VOCES_DIR: path.join(tmp, 'voces'),
      TSX_TSCONFIG_PATH: path.join(RAIZ, 'tsconfig.json'),
      ULTRON_SESION_SECRETO: SECRETO,
      AURA_SUSPENSIONES: 'ninguna',
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

const token = emitirSesion({ correo: DUENA, nombre: 'Marta', rol: 'Miembro' }, { comunidad: true }).token;

async function turno(marca: string, extra: Record<string, unknown>) {
  const r = await fetch(`${BASE}/api/turno`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-ultron-sesion': token, 'x-aura-origen': 'app', 'x-aura-aparato': 'tel-marta-cam' },
    body: JSON.stringify({ usuario: 'Marta', historial: [], memoria: ['Marta: mis hijas se llaman Nora e Ivón'], idTurno: `t-${marca}`, ...extra, message: `${extra.message} ${marca}` }),
    signal: AbortSignal.timeout(60_000),
  });
  const texto = await r.text();
  assert.equal(r.status, 200, texto);
  const alModelo = alNodo.filter((c) => c.includes(marca)).join('\n');
  assert.ok(alModelo, `el turno ${marca} no llegó al modelo`);
  return alModelo;
}

test('turno de la dueña con una cara sin reconocer («Me acompaña mi hija»): al modelo le llega CARAS (no adivinar, ofrecer aprender)', async () => {
  const m = await turno('CARA-DESCONOCIDA', { message: 'Me acompaña mi hija.', escena: ESCENA_HIJA });
  assert.match(m, /ESCENA \(tu cámara, ahora mismo\): Reconozco a Marta \(quien te habla\); 1 persona\(s\) que no conozco/);
  assert.match(m, /CARAS: tu teléfono SÍ reconoce las caras que la dueña te presentó/);
  assert.match(m, /nunca un nombre de MEMORIA/);
  assert.match(m, /aprendo su cara y la recuerdo/);
  // «Me acompaña…» pregunta por lo que se ve: la escena no va con «úsalo solo si viene al caso».
  assert.doesNotMatch(m, /1 persona\(s\) que no conozco \(úsalo solo si viene al caso/);
});

test('revisión 6-oct: turno de la dueña que NO pregunta por lo que se ve, con la misma escena: sin CARAS (la ESCENA sí, «solo si viene al caso»)', async () => {
  const m = await turno('SIN-PREGUNTA', { message: 'Cuéntame algo bonito para empezar el día', escena: ESCENA_HIJA });
  assert.match(m, /ESCENA \(tu cámara, ahora mismo\): Reconozco a Marta \(quien te habla\); 1 persona\(s\) que no conozco \(úsalo solo si viene al caso/);
  assert.doesNotMatch(m, /CARAS: /);
  assert.doesNotMatch(m, /aprendo su cara/);
});

test('turno de «¿qué ves?» con la vista del teléfono: ni la vista ni el pedido le dicen que no puede reconocer caras', async () => {
  const visto = vistaAHechos(parsearVista('{"escena":"dos personas en una mesa","personas":[{"que_hace":"sonríe"},{"que_hace":"mira"}]}'), 'escena');
  // (La marca del turno va pegada al final: «Mira, mira» deja de ser la frase entera; «Mira esto» sigue siendo mirar.)
  const m = await turno('QUE-VES', { message: 'Mira esto', escena: ESCENA_HIJA, visto, vistoEdadMs: 800, foco: 'escena' });
  assert.match(m, /VISION \(la cámara del teléfono, ahora mismo\): Escena: dos personas en una mesa/);
  assert.doesNotMatch(m, /No identifiques a nadie por su cara/);
  assert.match(m, /CARAS: /);
});

test('invitado (voz sin confirmar) con la misma escena: sin nombres de las caras y sin ofrecer aprender', async () => {
  const m = await turno('CARA-INVITADO', { message: 'Me acompaña mi hija.', escena: ESCENA_HIJA, hablado: true, quienHabla: { incierta: true } });
  assert.doesNotMatch(m, /Reconozco a Marta/);
  assert.match(m, /CARAS: no digas el nombre de nadie por su cara ni ofrezcas aprender caras/);
  assert.doesNotMatch(m, /aprendo su cara y la recuerdo/);
});
