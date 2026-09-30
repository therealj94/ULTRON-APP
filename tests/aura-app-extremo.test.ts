/**
 * AU-RA 5.0 DE PUNTA A PUNTA: el server.ts de verdad (con tsx, en una carpeta temporal, sin .env ni
 * llaves) contra un nodo falso (el 27B), un modelo chico falso y un Laya falso. Nada sale de la máquina.
 *
 *  · el perfil llega al prompt en CADA turno, por texto y por voz, con los tres avatares (apodo,
 *    cumpleaños —y felicitar ese día—, dónde vive);
 *  · la voz corre sin mando: «redespliega» se contesta con la negativa, sin tocar nada;
 *  · las acciones: el camino rápido («vete atrás», y Laya «comando») no despierta al 27B y la acción
 *    llega al canal SSE del teléfono; «escríbele a Beto…» sale del cerebro como ACCION_APP, nunca se
 *    lee, va en `acciones` del `done` con el correo de Beto, y el «sí» la envía con «¡Listo, enviado!»;
 *  · la interrupción: si ElevenLabs corta a mitad, el turno siguiente empieza con un perdón y el
 *    cerebro sabe que lo interrumpieron (no vuelve a pedir perdón);
 *  · la latencia hasta la primera palabra, con cifras (se imprimen en la salida de la prueba).
 */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';
import type { AddressInfo } from 'node:net';

const RAIZ = process.cwd();
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aura-extremo-'));
const SECRETO = 'secreto-de-prueba-largo-para-el-servidor-entero-5-0';
process.env.ULTRON_SESION_SECRETO = SECRETO;
process.env.ULTRON_SESIONES_CERRADAS_ARCHIVO = path.join(tmp, 'cerradas-prueba.json');
process.env.ULTRON_MEMORIA_BUCKET = '';
const { emitirSesion, secretoDerivado } = await import('../server/seguridad');
const { emitirPase, ETIQUETA_SECRETO_LLM } = await import('../server/voz-agente');
const { hoyMMDD } = await import('../lib/perfil-persona');

/* ------------------------------------------------------------------ los falsos */

type Pedido = { system: string; ultimo: string; stream: boolean };
const alNodo: Pedido[] = [];
/** Qué contesta el 27B según lo que dijo la persona (el texto después de «Junta: »). */
let contestar: (dicho: string) => string = () => '[EMO: neutral] Claro. Te cuento lo que sé.';
let primerTokenMs = 0;
/** Cada cuánto escribe el nodo un trozo de seis letras (un 27B en una T4 anda por ahí). */
let pasoMs = 4;
const nodo = http.createServer((req, res) => {
  let c = '';
  req.on('data', (d) => (c += d));
  req.on('end', async () => {
    const j = JSON.parse(c || '{}');
    const msgs = j.messages || [];
    const ultimo = String(msgs.at(-1)?.content || '');
    const dicho = ultimo.split('\n\nJunta: ').pop() || '';
    alNodo.push({ system: String(msgs[0]?.content || ''), ultimo, stream: !!j.stream });
    const respuesta = contestar(dicho);
    if (!j.stream) return res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ message: { content: respuesta } }));
    res.writeHead(200, { 'content-type': 'application/x-ndjson' });
    await new Promise((r) => setTimeout(r, primerTokenMs));
    for (const t of respuesta.match(/.{1,6}/gs) || []) {
      if (res.destroyed) return;
      res.write(JSON.stringify({ message: { content: t }, done: false }) + '\n');
      await new Promise((r) => setTimeout(r, pasoMs));
    }
    res.end(JSON.stringify({ message: { content: '' }, done: true }) + '\n');
  });
});
const alChico: string[] = [];
const chico = http.createServer((req, res) => {
  let c = '';
  req.on('data', (d) => (c += d));
  req.on('end', () => {
    const j = JSON.parse(c || '{}');
    alChico.push(String(j.messages?.[0]?.content || ''));
    res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ choices: [{ message: { content: '[EMO: feliz] ¡Muy bien! ¿Y tú?' } }] }));
  });
});
const alLaya: string[] = [];
const laya = http.createServer((req, res) => {
  let c = '';
  req.on('data', (d) => (c += d));
  req.on('end', () => {
    const j = JSON.parse(c || '{}');
    alLaya.push(`${req.url} ${j.texto}`);
    const accion = /no me hables tanto/.test(j.texto) ? 'callar' : 'ninguna';
    res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ p: { [accion]: 0.92, ninguna: accion === 'ninguna' ? 0.92 : 0.03 }, etiquetas: [], grupos: { accion } }));
  });
});
for (const s of [nodo, chico, laya]) await new Promise<void>((r) => s.listen(0, '127.0.0.1', r));
const puerto = (s: http.Server) => (s.address() as AddressInfo).port;

/* ------------------------------------------------------------------ el servidor */

const PORT = 7960 + Math.floor(Math.random() * 30);
const BASE = `http://127.0.0.1:${PORT}`;
const proc: ChildProcess = spawn(process.execPath, ['--import', import.meta.resolve('tsx'), path.join(RAIZ, 'server.ts')], {
  cwd: tmp,
  env: {
    // Solo lo que hace falta: nada de las llaves del entorno de quien corre las pruebas.
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
    MODELO_CHICO_URL: `http://127.0.0.1:${puerto(chico)}`,
    MODELO_CHICO_MODO: 'activo',
    MODELO_CHICO_NOMBRE: 'chico-falso',
    ULTRON_LAYA_URL: `http://127.0.0.1:${puerto(laya)}`,
    ULTRON_LAYA_CLAVE: 'laya-falsa',
    TSX_TSCONFIG_PATH: path.join(RAIZ, 'tsconfig.json'),
  },
  stdio: ['ignore', 'ignore', 'pipe'],
  detached: true,
});
let errores = '';
proc.stderr?.on('data', (d) => (errores = (errores + d).slice(-4000)));
after(() => {
  try {
    process.kill(-proc.pid!);
  } catch {
    /* ya se fue */
  }
  for (const s of [nodo, chico, laya]) {
    s.closeAllConnections?.();
    s.close();
  }
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

/* ------------------------------------------------------------------ ayudas */

const yo = emitirSesion({ correo: 'majo.prueba@ordenglobal.org', nombre: 'María José', rol: 'Junta' });
const h = (token = yo.token) => ({ 'content-type': 'application/json', 'x-ultron-sesion': token });
const turno = async (message: string, extra: Record<string, unknown> = {}) => (await fetch(`${BASE}/api/turno`, { method: 'POST', headers: h(), body: JSON.stringify({ message, ...extra }) })).json() as Promise<any>;
async function turnoStream(message: string) {
  const r = await fetch(`${BASE}/api/turno/stream`, { method: 'POST', headers: h(), body: JSON.stringify({ message }) });
  return (await r.text())
    .split('\n\n')
    .map((b) => ({ ev: /^event: (\w+)/m.exec(b)?.[1], data: /^data: (.*)$/m.exec(b)?.[1] }))
    .filter((e) => e.ev && e.data)
    .map((e) => ({ ev: e.ev!, data: JSON.parse(e.data!) }));
}
const BEARER = `Bearer ${secretoDerivado(ETIQUETA_SECRETO_LLM)}`;
/** Un turno de voz como lo pide ElevenLabs. Devuelve lo dicho, y cuánto tardó la primera palabra. */
async function voz(pase: string, messages: unknown[], o: { cortarTras?: number } = {}) {
  const t0 = performance.now();
  const ctrl = new AbortController();
  const r = await fetch(`${BASE}/api/voz/llm/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: BEARER, 'x-pase': pase },
    body: JSON.stringify({ model: 'aura', stream: true, messages }),
    signal: ctrl.signal,
  });
  let dicho = '';
  let primera = -1;
  let buf = '';
  const dec = new TextDecoder();
  try {
    for await (const trozo of r.body as any) {
      buf += dec.decode(trozo, { stream: true });
      let i: number;
      while ((i = buf.indexOf('\n\n')) >= 0) {
        const l = buf.slice(0, i);
        buf = buf.slice(i + 2);
        if (!l.startsWith('data: {')) continue;
        const c = JSON.parse(l.slice(6)).choices[0].delta.content;
        if (c) {
          if (primera < 0) primera = performance.now() - t0;
          dicho += c;
          if (o.cortarTras && dicho.length >= o.cortarTras) ctrl.abort();
        }
      }
    }
  } catch {
    /* cortado a propósito */
  }
  return { status: r.status, dicho, primeraMs: primera, totalMs: performance.now() - t0 };
}
function paseDe(s = yo, avatar: 'ojos' | 'aura' | 'claudio' = 'aura', idioma: 'es' | 'en' = 'es') {
  return emitirPase(s, avatar, idioma).pase;
}
/** El canal de acciones de un teléfono. */
async function canal(token = yo.token) {
  const ctrl = new AbortController();
  const r = await fetch(`${BASE}/api/app/acciones`, { headers: h(token), signal: ctrl.signal });
  let texto = '';
  const leyendo = (async () => {
    try {
      for await (const t of r.body as any) texto += new TextDecoder().decode(t);
    } catch {
      /* cerrado */
    }
  })();
  await new Promise((r) => setTimeout(r, 100));
  return {
    acciones: () => [...texto.matchAll(/^data: (\{.*\})$/gm)].map((m) => JSON.parse(m[1]).accion),
    cerrar: async () => {
      ctrl.abort();
      await leyendo;
    },
  };
}
const espera = async (cond: () => boolean, ms = 3000) => {
  const t0 = Date.now();
  while (!cond() && Date.now() - t0 < ms) await new Promise((r) => setTimeout(r, 15));
  return cond();
};
const mediana = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];

/* ------------------------------------------------------------------ las pruebas */

test('el servidor levanta', () => {
  assert.ok(listo, `no levantó: ${errores}`);
});

test('el perfil llega al prompt en cada turno: texto y voz, con los tres avatares', { skip: !listo }, async () => {
  const hoy = hoyMMDD();
  const put = await fetch(`${BASE}/api/perfil`, { method: 'PUT', headers: h(), body: JSON.stringify({ apodo: 'Majo', cumple: hoy, encuesta: { vive: 'Comayagua', familia: 'dos gatos' } }) });
  assert.equal(put.status, 200);
  alNodo.length = 0;
  contestar = () => '[EMO: neutral] Claro, te cuento del proyecto.';
  const t = await turno('explícame cómo va el proyecto de la planta de beneficio este trimestre');
  assert.equal(t.reply, 'Claro, te cuento del proyecto.');
  const sys = alNodo.at(-1)!.system;
  assert.match(sys, /Le dices «Majo»/);
  assert.match(sys, /HOY ES SU CUMPLEAÑOS/);
  assert.match(sys, /Vive en: Comayagua/);
  for (const avatar of ['ojos', 'aura', 'claudio'] as const) {
    alNodo.length = 0;
    const v = await voz(paseDe(yo, avatar), [{ role: 'user', content: 'explícame cómo va el proyecto de la planta de beneficio este trimestre' }]);
    assert.equal(v.status, 200);
    assert.equal(v.dicho, 'Claro, te cuento del proyecto.', avatar);
    assert.match(alNodo.at(-1)!.system, /Le dices «Majo»/, `perfil en la voz de ${avatar}`);
    assert.match(alNodo.at(-1)!.system, /Su familia: dos gatos/);
  }
  // El modelo chico también le dice por su apodo, y habla como el avatar.
  alChico.length = 0;
  const hola = await voz(paseDe(yo, 'claudio'), [{ role: 'user', content: 'hola' }]);
  assert.equal(hola.dicho, '¡Muy bien! ¿Y tú?');
  assert.match(alChico.at(-1)!, /Te habla Majo/);
  assert.match(alChico.at(-1)!, /Claudio/);
});

test('la voz corre sin mando: «redespliega» se contesta con la negativa y no despierta al 27B', { skip: !listo }, async () => {
  alNodo.length = 0;
  const v = await voz(paseDe(), [{ role: 'user', content: 'redespliega la mesa' }]);
  assert.equal(v.status, 200);
  assert.match(v.dicho, /no lo hago desde la conversación de voz/i);
  assert.equal(alNodo.length, 0);
  const mala = await voz('pase-falso', [{ role: 'user', content: 'hola' }]);
  assert.equal(mala.status, 401);
});

test('acciones: el camino rápido va al canal del teléfono sin el 27B; «escríbele a Beto» sale del cerebro y el «sí» lo envía', { skip: !listo }, async () => {
  const tel = await canal();
  try {
    const ctx = await fetch(`${BASE}/api/app/contexto`, {
      method: 'POST',
      headers: h(),
      body: JSON.stringify({ pantalla: 'chats', contactos: [{ correo: 'beto@x.com', nombre: 'Beto Pérez' }, { correo: 'mama@x.com', nombre: 'Mamá' }] }),
    });
    assert.equal(ctx.status, 200);

    alNodo.length = 0;
    const atras = await turno('vete atrás');
    assert.deepEqual(atras.acciones, [{ tipo: 'atras' }]);
    assert.equal(atras.via, 'app-reglas');
    assert.equal(alNodo.length, 0, 'sin el modelo grande');
    assert.ok(await espera(() => tel.acciones().some((a) => a.tipo === 'atras')));

    // Lo que las reglas no conocen y Laya «comando» decide claro.
    const calla = await turno('ya no me hables tanto');
    assert.deepEqual(calla.acciones, [{ tipo: 'silencio', valor: true }]);
    assert.equal(calla.via, 'app-laya');
    assert.ok(alLaya.some((l) => l.startsWith('/v1/comando ')));

    // Por voz también (el mismo turno): la voz dice «Va.» y la acción llega al teléfono.
    const tema = await voz(paseDe(), [{ role: 'user', content: 'ponlo oscuro' }]);
    assert.equal(tema.dicho, 'Listo, en oscuro.');
    assert.ok(await espera(() => tel.acciones().some((a) => a.tipo === 'tema' && a.valor === 'oscuro')));

    // Redactar lo decide el cerebro; la línea ACCION_APP no se lee ni se dice.
    contestar = () => '[EMO: neutral] Le escribo a Beto: “Llego tarde”. ¿Lo envío?\nACCION_APP: {"tipo":"redactar","para":"Beto","texto":"Llego tarde"}';
    const ev = await turnoStream('escríbele a Beto que llego tarde');
    const texto = ev.filter((e) => e.ev === 'delta').map((e) => e.data.text).join('');
    assert.ok(!/ACCION_APP/.test(texto), texto);
    const done = ev.find((e) => e.ev === 'done')!.data;
    assert.equal(done.reply, 'Le escribo a Beto: “Llego tarde”. ¿Lo envío?');
    assert.deepEqual(done.acciones, [{ tipo: 'redactar', para: 'beto@x.com', texto: 'Llego tarde' }]);
    assert.match(alNodo.at(-1)!.system, /CONTACTOS \(.*\): Beto Pérez, Mamá\./, 'el cerebro recibe el contexto del teléfono');
    assert.ok(await espera(() => tel.acciones().some((a) => a.tipo === 'redactar')));

    // Un «enviar» que el cerebro escriba sin que la persona lo confirme no sale.
    contestar = () => 'Listo.\nACCION_APP: {"tipo":"enviar","para":"Beto"}';
    const sinSi = await turno('cámbialo mejor, que llego a las ocho de la noche');
    assert.deepEqual(sinSi.acciones, []);

    // El «sí» manda el borrador pendiente, sin el 27B, y se dice «¡Listo, enviado!».
    contestar = () => '[EMO: neutral] Le escribo a Beto: “Llego tarde”. ¿Lo envío?\nACCION_APP: {"tipo":"redactar","para":"Beto","texto":"Llego tarde"}';
    await turno('escríbele a Beto que llego tarde');
    alNodo.length = 0;
    const si = await turno('sí');
    assert.equal(si.reply, '¡Listo, enviado!');
    assert.deepEqual(si.acciones, [{ tipo: 'enviar', para: 'beto@x.com' }]);
    assert.equal(alNodo.length, 0);
    assert.ok(await espera(() => tel.acciones().some((a) => a.tipo === 'enviar')));
  } finally {
    await tel.cerrar();
  }
});

test('interrupción: ElevenLabs corta a mitad y la respuesta siguiente empieza con un perdón', { skip: !listo }, async () => {
  const larga = 'El oro está a tres mil cuatrocientos dólares la onza. Subió un poco esta semana. La plata también subió. Y el cobre se quedó igual que la semana pasada.';
  contestar = (d) => (/plata/.test(d) ? 'La plata está a cuarenta dólares.' : larga);
  const pase = paseDe();
  const hist = [{ role: 'user', content: '¿cómo va el oro hoy en los mercados internacionales?' }];
  const primera = await voz(pase, hist, { cortarTras: 20 });
  assert.ok(primera.dicho.length >= 20 && primera.dicho.length < larga.length);
  await new Promise((r) => setTimeout(r, 150));
  alNodo.length = 0;
  const segunda = await voz(pase, [...hist, { role: 'assistant', content: primera.dicho + '...' }, { role: 'user', content: 'espera, ¿y la plata cuánto está?' }]);
  assert.match(segunda.dicho, /^(¡Ah, perdón!|¡Uy, perdón!|Perdón\.) La plata está a cuarenta dólares\.$/);
  assert.match(alNodo.at(-1)!.ultimo, /TE INTERRUMPIÓ/, 'el cerebro sabe que lo cortaron y no vuelve a pedir perdón');

  // Sin corte de la conexión: ElevenLabs manda la respuesta recortada a lo que alcanzó a decir.
  const pase2 = paseDe();
  contestar = (d) => (/plata/.test(d) ? 'La plata está a cuarenta dólares.' : larga);
  const entera = await voz(pase2, hist);
  assert.equal(entera.dicho, larga);
  const tercera = await voz(pase2, [...hist, { role: 'assistant', content: 'El oro está a tres mil cuatrocientos...' }, { role: 'user', content: '¿y la plata?' }]);
  assert.match(tercera.dicho, /perdón/i);
  // Y si la dijo entera, nada de perdón.
  const cuarta = await voz(pase2, [...hist, { role: 'assistant', content: 'La plata está a cuarenta dólares.' }, { role: 'user', content: '¿y la plata?' }]);
  assert.doesNotMatch(cuarta.dicho, /perdón/i);
});

test('latencia hasta la primera palabra (voz), con cifras', { skip: !listo }, async () => {
  const N = 7;
  const medir = async (nombre: string, fn: () => Promise<{ primeraMs: number; totalMs: number }>) => {
    const p: number[] = [];
    const t: number[] = [];
    for (let i = 0; i < N; i++) {
      const r = await fn();
      p.push(r.primeraMs);
      t.push(r.totalMs);
    }
    const fila = { caso: nombre, primeraMs: Math.round(mediana(p)), totalMs: Math.round(mediana(t)) };
    console.log(`[latencia] ${fila.caso}: primera palabra ${fila.primeraMs} ms · respuesta entera ${fila.totalMs} ms (mediana de ${N})`);
    return fila;
  };
  primerTokenMs = 250;
  pasoMs = 15;
  contestar = () => 'Mira, lo que pasa con la planta de beneficio este trimestre es que avanzó bastante, sobre todo en la parte eléctrica. Te cuento el detalle cuando quieras.';
  const charla = await medir('charla «hola» (modelo chico)', () => voz(paseDe(), [{ role: 'user', content: 'hola' }]));
  const orden = await medir('orden de app «vete atrás» (camino rápido)', async () => {
    const tel = await canal();
    try {
      return await voz(paseDe(), [{ role: 'user', content: 'vete atrás' }]);
    } finally {
      await tel.cerrar();
    }
  });
  const pregunta = await medir('pregunta al 27B (primer token del nodo a 250 ms, un trozo cada 15 ms)', () => voz(paseDe(), [{ role: 'user', content: 'explícame cómo va el proyecto de la planta de beneficio este trimestre' }]));
  primerTokenMs = 0;
  pasoMs = 4;
  // Holgado a propósito (máquinas de CI lentas): lo que se mira es el orden de magnitud.
  assert.ok(charla.primeraMs < 1500);
  assert.ok(orden.primeraMs < 1500);
  assert.ok(pregunta.primeraMs < 250 + 1500);
  // La primera frase larga sale en la coma, antes de que el 27B termine de escribir.
  assert.ok(pregunta.primeraMs < pregunta.totalMs - 100, 'la voz empieza antes de que termine la respuesta');
});
