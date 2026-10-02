/**
 * La computadora de los agentes (server/computadora.ts) contra un nodo de mentira que habla como
 * scripts/nodo-computadora/agente.py: encargar, esperar, seguir después, avisar una vez, y el pedido
 * del cerebro (PEDIR_HERRAMIENTA: computadora …).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import type { RequestHandler } from 'express';
import {
  encargarTarea,
  motorDelPerfil,
  avisosPendientes,
  confirmarAvisos,
  pendientesDe,
  duenoDe,
  ultimaTareaDe,
  estadoComputadora,
  _olvidarEncargos,
  alAvisarApp,
  TIEMPOS_SEGUIR,
  MAX_CONTINUACIONES,
  misionDe,
  prepararMision,
  misionIncompleta,
  fraseDePaso,
  type AvisoApp,
} from '../server/computadora';
import { extraerPedidoHerramienta, instruccionHarness, resolverPedido } from '../lib/harness';
import { validarCambios } from '../lib/perfil-persona';
import { fichaManosPrompt, manosDe } from '../lib/manos-ficha';

const CLAVE = 'clave-de-prueba';

/** Un nodo que termina cada tarea tras `pasosHastaTerminar` consultas. */
async function nodoFalso(pasosHastaTerminar: number, sinClaude = false, demoraMs = 0) {
  const tareas = new Map<string, { consultas: number; instruccion: string; motor: string }>();
  const pedidos: Array<{ ruta: string; cuerpo: any; auth: string | undefined }> = [];
  const srv = http.createServer((req, res) => {
    let datos = '';
    req.on('data', (c) => (datos += c));
    req.on('end', async () => {
      if (demoraMs && req.method === 'GET') await new Promise((r) => setTimeout(r, demoraMs));
      const cuerpo = datos ? JSON.parse(datos) : null;
      pedidos.push({ ruta: `${req.method} ${req.url}`, cuerpo, auth: req.headers.authorization });
      const json = (code: number, j: unknown) => {
        res.writeHead(code, { 'content-type': 'application/json' });
        res.end(JSON.stringify(j));
      };
      if (req.url === '/salud') return json(200, { ok: true, motores: ['holo'], ocupada: false });
      if (req.headers.authorization !== `Bearer ${CLAVE}`) return json(401, { detail: 'clave' });
      if (req.method === 'POST' && req.url === '/tareas') {
        if (cuerpo.motor === 'claude' && sinClaude) return json(400, { detail: 'el motor Claude no está configurado (falta ANTHROPIC_API_KEY)' });
        const id = `t${tareas.size + 1}`;
        tareas.set(id, { consultas: 0, instruccion: cuerpo.instruccion, motor: cuerpo.motor });
        return json(200, { id, estado: 'en_cola' });
      }
      const m = req.url!.match(/^\/tareas\/(\w+)/);
      const t = m && tareas.get(m[1]);
      if (!t) return json(404, { detail: 'no existe' });
      t.consultas++;
      const hecha = t.consultas >= pasosHastaTerminar;
      return json(200, {
        id: m![1], motor: t.motor, instruccion: t.instruccion, estado: hecha ? 'hecha' : 'trabajando', segundos: 12,
        pasos: [{ n: 1, t: 2, accion: 'click', args: { x: 10, y: 20 } }, ...(hecha ? [{ n: 2, t: 9, accion: 'answer' }] : [])],
        respuesta: hecha ? 'Morazán nació el 3 de octubre de 1792.' : null, error: null,
      });
    });
  });
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
  return { url, pedidos, cerrar: () => new Promise<void>((r) => srv.close(() => r())) };
}

async function conNodo<T>(url: string | null, fn: () => Promise<T>): Promise<T> {
  const antes = { u: process.env.COMPUTADORA_URL, c: process.env.COMPUTADORA_CLAVE };
  if (url) {
    process.env.COMPUTADORA_URL = url;
    process.env.COMPUTADORA_CLAVE = CLAVE;
  } else {
    delete process.env.COMPUTADORA_URL;
    delete process.env.COMPUTADORA_CLAVE;
  }
  _olvidarEncargos();
  try {
    return await fn();
  } finally {
    for (const [k, v] of [['COMPUTADORA_URL', antes.u], ['COMPUTADORA_CLAVE', antes.c]] as const) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    _olvidarEncargos();
  }
}

test('encargar y esperar: si termina a tiempo, el hecho trae la respuesta y no se repite después', async () => {
  const nodo = await nodoFalso(2);
  try {
    await conNodo(nodo.url, async () => {
      const r = await encargarTarea({ instruccion: 'Busca cuándo nació Morazán', quien: 'jose@x.hn', motor: 'holo', esperaMs: 10_000 });
      assert.match(r.hecho, /Hecha en 1 pasos/);
      assert.match(r.hecho, /3 de octubre de 1792/);
      assert.equal(nodo.pedidos[0].ruta, 'POST /tareas');
      assert.deepEqual({ instruccion: nodo.pedidos[0].cuerpo.instruccion, motor: nodo.pedidos[0].cuerpo.motor }, { instruccion: 'Busca cuándo nació Morazán', motor: 'holo' });
      assert.equal(nodo.pedidos[0].auth, `Bearer ${CLAVE}`);
      assert.equal(duenoDe(r.id!), 'jose@x.hn');
      assert.equal(ultimaTareaDe('jose@x.hn'), r.id);
      // Ya se dijo en este turno: el siguiente no la vuelve a contar, y el nodo supo el dueño (sin el correo).
      assert.equal(avisosPendientes('jose@x.hn'), null);
      assert.match(nodo.pedidos[0].cuerpo.dueno, /^[0-9a-f]{24}$/);
      assert.ok(!JSON.stringify(nodo.pedidos[0].cuerpo).includes('jose@x.hn'));
    });
  } finally {
    await nodo.cerrar();
  }
});

test('si no alcanza el turno: dice que sigue; al terminar se avisa hasta que el modelo lo diga, y una segunda tarea no tapa a la primera', async () => {
  const nodo = await nodoFalso(3);
  try {
    await conNodo(nodo.url, async () => {
      const r1 = await encargarTarea({ instruccion: 'Compara precios', quien: 'ana@x.hn', motor: 'claude', esperaMs: 100 });
      assert.match(r1.hecho, /sigue en tu computadora/);
      assert.match(r1.hecho, /No inventes el resultado/);
      const r2 = await encargarTarea({ instruccion: 'Busca horarios', quien: 'ana@x.hn', motor: 'holo', esperaMs: 100 });
      assert.deepEqual(pendientesDe('ana@x.hn').sort(), [r1.id, r2.id].sort(), 'las dos quedan pendientes');
      assert.equal(avisosPendientes('ana@x.hn'), null, 'todavía no terminaron');
      // El seguimiento consulta cada 5 s: se espera a que vea las dos terminadas.
      let aviso: ReturnType<typeof avisosPendientes> = null;
      for (let i = 0; i < 60 && (aviso?.ids.length ?? 0) < 2; i++) {
        await new Promise((res) => setTimeout(res, 500));
        aviso = avisosPendientes('ana@x.hn');
      }
      assert.equal(aviso?.ids.length, 2, 'se cuentan las dos');
      assert.match(aviso!.hecho, /«Compara precios»/);
      assert.match(aviso!.hecho, /«Busca horarios»/);
      // Un «hola» que contestó el banco no lo dijo: sigue pendiente.
      assert.equal(avisosPendientes('ana@x.hn')?.ids.length, 2);
      confirmarAvisos('ana@x.hn', aviso!.ids);
      assert.equal(avisosPendientes('ana@x.hn'), null, 'dicho una vez, no se repite');
      assert.deepEqual(pendientesDe('ana@x.hn'), []);
      assert.equal(avisosPendientes('otra@x.hn'), null, 'cada quien sus tareas');
    });
  } finally {
    await nodo.cerrar();
  }
});

test('el plazo de espera es de verdad aunque el nodo tarde en contestar', async () => {
  const nodo = await nodoFalso(99, false, 4000);
  try {
    await conNodo(nodo.url, async () => {
      const t0 = Date.now();
      const r = await encargarTarea({ instruccion: 'Algo lento', quien: 'a@x.hn', motor: 'holo', esperaMs: 1500 });
      const ms = Date.now() - t0;
      assert.match(r.hecho, /sigue en tu computadora/);
      assert.ok(ms < 2500, `no se pasa del plazo (${ms} ms con 1500 de plazo)`);
      const ctrl = new AbortController();
      setTimeout(() => ctrl.abort(), 300);
      const t1 = Date.now();
      await encargarTarea({ instruccion: 'Interrumpida', quien: 'a@x.hn', motor: 'holo', esperaMs: 20_000, senal: ctrl.signal });
      assert.ok(Date.now() - t1 < 1500, 'la interrupción corta la espera');
    });
  } finally {
    await nodo.cerrar();
  }
});

test('eligió Claude y el nodo no lo tiene: la hace la gratis y lo dice', async () => {
  const nodo = await nodoFalso(1, true);
  try {
    await conNodo(nodo.url, async () => {
      const r = await encargarTarea({ instruccion: 'Busca algo', quien: 'a@x.hn', motor: 'claude', esperaMs: 10_000 });
      assert.match(r.hecho, /Hecha/);
      assert.match(r.hecho, /La hizo el modelo gratis: Claude no está configurado/);
      assert.deepEqual(nodo.pedidos.filter((p) => p.ruta === 'POST /tareas').map((p) => p.cuerpo.motor), ['claude', 'holo']);
    });
  } finally {
    await nodo.cerrar();
  }
});

test('sin configurar, ni se intenta; con la clave mala, lo dice sin inventar', async () => {
  await conNodo(null, async () => {
    const r = await encargarTarea({ instruccion: 'x', quien: 'a', motor: 'holo', esperaMs: 1000 });
    assert.match(r.hecho, /no está configurada/);
    assert.equal((await estadoComputadora()).configurada, false);
  });
  const nodo = await nodoFalso(1);
  try {
    await conNodo(nodo.url, async () => {
      process.env.COMPUTADORA_CLAVE = 'otra';
      const r = await encargarTarea({ instruccion: 'x', quien: 'a', motor: 'holo', esperaMs: 1000 });
      assert.match(r.hecho, /no pude encargarla/);
      assert.equal(r.id, null);
    });
  } finally {
    await nodo.cerrar();
  }
});

test('el cerebro: pide «computadora <tarea>», y la instrucción solo se ofrece si hay computadora', async () => {
  const ped = extraerPedidoHerramienta('Claro.\nPEDIR_HERRAMIENTA: computadora entra a sar.gob.hn y busca el horario');
  assert.deepEqual(ped, { herramienta: 'computadora', arg: 'entra a sar.gob.hn y busca el horario' });
  assert.match(await resolverPedido(ped!, { web: async () => '', sistema: async () => '', leer: async () => '', ejecutor: async () => '', computadora: async (t) => `HECHO ${t}` }), /^HECHO entra a sar/);
  assert.match(await resolverPedido(ped!, { web: async () => '', sistema: async () => '', leer: async () => '', ejecutor: async () => '' }), /no está disponible/);
  assert.match(await resolverPedido({ herramienta: 'computadora', arg: ' ' }, { web: async () => '', sistema: async () => '', leer: async () => '', ejecutor: async () => '', computadora: async () => 'x' }), /no vino la tarea/);
  assert.match(instruccionHarness('miembro', true), /PEDIR_HERRAMIENTA: computadora/);
  assert.doesNotMatch(instruccionHarness('miembro', false), /computadora/);
  assert.match(instruccionHarness('junta', true), /Nunca la uses para pagar/);
});

test('Ajustes: gratis o pago, y la ficha de manos solo la ofrece si está configurada', async () => {
  assert.deepEqual(validarCambios({ motorComputadora: 'pago' }), { ok: true, cambios: { motorComputadora: 'pago' } });
  assert.equal(validarCambios({ motorComputadora: 'gpt' }).ok, false);
  assert.equal(motorDelPerfil('pago'), 'claude');
  assert.equal(motorDelPerfil('gratis'), 'holo');
  assert.equal(motorDelPerfil(undefined), 'holo', 'sin elegir: la gratis');
  await conNodo(null, async () => {
    assert.ok(!manosDe('app').some((m) => m.de === 'computadora'));
    assert.doesNotMatch(fichaManosPrompt('web'), /computadora en la nube para hacer/);
  });
  await conNodo('https://ejemplo.invalid', async () => {
    assert.ok(manosDe('app').some((m) => m.de === 'computadora'));
    assert.match(fichaManosPrompt('web'), /usar mi propia computadora en la nube/);
  });
});

test('la app: le encarga algo a su computadora, ve los pasos en palabras y solo la captura de ahora; nadie más la ve (José, 2-oct)', async () => {
  const express = (await import('express')).default;
  const { montarRutasComputadora, pasoEnPalabras } = await import('../server/computadora');
  // Nodo con capturas: cada paso trae su miniatura (como agente.py con ?miniaturas=1).
  const vistos: string[] = [];
  const nodo = http.createServer((req, res) => {
    let datos = '';
    req.on('data', (c) => (datos += c));
    req.on('end', () => {
      vistos.push(`${req.method} ${req.url}`);
      const json = (code: number, j: unknown) => (res.writeHead(code, { 'content-type': 'application/json' }), res.end(JSON.stringify(j)));
      if (req.url === '/salud') return json(200, { ok: true, motores: ['holo'], ocupada: true });
      if (req.headers.authorization !== `Bearer ${CLAVE}`) return json(401, { detail: 'clave' });
      if (req.method === 'POST' && req.url === '/tareas') return json(200, { id: 'tx1', estado: 'en_cola', eco: JSON.parse(datos) });
      const con = /miniaturas=1/.test(req.url || '');
      const pasos = [
        { n: 1, t: 1, accion: 'escritorio_limpio' },
        { n: 2, t: 4, accion: 'open_url', args: { url: 'es.wikipedia.org' }, ...(con ? { miniatura: 'AAA' } : {}) },
        { n: 3, t: 9, accion: 'type', args: { text: 'Francisco Morazán', press_enter: true }, ...(con ? { miniatura: 'BBB' } : {}) },
      ];
      return json(200, { id: 'tx1', motor: 'holo', instruccion: 'Busca a Morazán', estado: 'trabajando', pasos, respuesta: null, error: null, segundos: 9 });
    });
  });
  await new Promise<void>((r) => nodo.listen(0, '127.0.0.1', r));
  const urlNodo = `http://127.0.0.1:${(nodo.address() as AddressInfo).port}`;
  await conNodo(urlNodo, async () => {
    const app = express();
    app.use(express.json());
    const pasa: RequestHandler = (_q, _r, n) => n();
    montarRutasComputadora(app, { exigirMesa: pasa, limitar: () => pasa, sesionDe: (req) => (req.headers['x-quien'] ? { correo: String(req.headers['x-quien']) } : null), motorDe: async () => 'pago' });
    const srv = app.listen(0, '127.0.0.1');
    await new Promise((r) => srv.once('listening', r));
    const base = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
    const como = (quien: string | null, ruta: string, init: RequestInit = {}) =>
      fetch(`${base}${ruta}`, { ...init, headers: { 'content-type': 'application/json', ...(quien ? { 'x-quien': quien } : {}) } }).then(async (r) => ({ code: r.status, j: await r.json() }));
    try {
      assert.equal((await como(null, '/api/computadora/tareas', { method: 'POST', body: '{"instruccion":"hola mundo"}' })).code, 401);
      assert.equal((await como('jose@x.hn', '/api/computadora/tareas', { method: 'POST', body: '{"instruccion":"a"}' })).code, 400);
      const r = await como('jose@x.hn', '/api/computadora/tareas', { method: 'POST', body: JSON.stringify({ instruccion: 'Entra a es.wikipedia.org y dime cuándo nació Morazán' }) });
      assert.equal(r.code, 200);
      assert.equal(r.j.id, 'tx1');
      // El motor sale de Ajustes («pago» → claude) y el nodo recibe la huella, no el correo.
      const alta = vistos.find((v) => v === 'POST /tareas');
      assert.ok(alta);
      const t = await como('jose@x.hn', '/api/computadora/tareas/tx1');
      assert.equal(t.code, 200);
      assert.deepEqual(t.j.tarea.pasos.map((p: any) => p.texto), ['Abrió un escritorio limpio', 'Abrió es.wikipedia.org', 'Escribió «Francisco Morazán» y dio Enter']);
      assert.deepEqual(t.j.tarea.pasos.map((p: any) => p.miniatura ?? null), [null, null, 'BBB'], 'solo la captura de lo que ve ahora');
      const p2 = await como('jose@x.hn', '/api/computadora/tareas/tx1?paso=2');
      assert.deepEqual(p2.j.tarea.pasos.map((p: any) => p.miniatura ?? null), [null, 'AAA', null], 'o la del paso que tocó');
      assert.equal((await como('otra@x.hn', '/api/computadora/tareas/tx1')).code, 404, 'otra persona no la ve');
      const e = await como('jose@x.hn', '/api/computadora');
      assert.equal(e.j.ultima, 'tx1');
      assert.equal(e.j.actual.estado, 'trabajando');
      assert.equal(e.j.actual.ultimo, 'Escribió «Francisco Morazán» y dio Enter');
      assert.equal((await como('otra@x.hn', '/api/computadora')).j.actual, null);
      assert.equal(pasoEnPalabras({ accion: 'click', args: { element: 'Buscar' } }), 'Tocó «Buscar»');
      assert.equal(pasoEnPalabras({ accion: 'scroll', args: { direction: 'down' } }, 'en'), 'Scrolled down');
    } finally {
      await new Promise<void>((r) => srv.close(() => r()));
    }
  });
  await new Promise<void>((r) => nodo.close(() => r()));
  // Sin computadora configurada: lo dice claro (503), sin el texto interno del harness.
  await conNodo(null, async () => {
    const app = express();
    app.use(express.json());
    const pasa: RequestHandler = (_q, _r, n) => n();
    montarRutasComputadora(app, { exigirMesa: pasa, limitar: () => pasa, sesionDe: () => ({ correo: 'jose@x.hn' }) });
    const srv = app.listen(0, '127.0.0.1');
    await new Promise((r) => srv.once('listening', r));
    try {
      const r = await fetch(`http://127.0.0.1:${(srv.address() as AddressInfo).port}/api/computadora/tareas`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"instruccion":"abre google"}' });
      const j = await r.json();
      assert.equal(r.status, 503);
      assert.match(j.error, /no está configurada/);
      assert.doesNotMatch(j.error, /HARNESS|dilo con naturalidad/);
    } finally {
      await new Promise<void>((r) => srv.close(() => r()));
    }
  });
});

/* ------------------------------------------------------------------ en vivo y hasta el final (José, 2-oct: «abrió la página y se quedó ahí») */

/**
 * Un nodo con guion: cada tarea se contesta con lo que diga `guion(instruccion, consultas, n)` (`n`: la
 * tarea número n, desde 1). Así se arma una tarea que no alcanza los pasos, otra que termina tarde, etc.
 */
async function nodoConGuion(guion: (instruccion: string, consultas: number, n: number) => { estado: string; pasos?: any[]; respuesta?: string | null; error?: string | null }) {
  const tareas = new Map<string, { consultas: number; instruccion: string; n: number }>();
  const altas: any[] = [];
  const srv = http.createServer((req, res) => {
    let datos = '';
    req.on('data', (c) => (datos += c));
    req.on('end', () => {
      const json = (code: number, j: unknown) => (res.writeHead(code, { 'content-type': 'application/json' }), res.end(JSON.stringify(j)));
      if (req.url === '/salud') return json(200, { ok: true, motores: ['holo'], ocupada: false });
      if (req.headers.authorization !== `Bearer ${CLAVE}`) return json(401, { detail: 'clave' });
      if (req.method === 'POST' && req.url === '/tareas') {
        const cuerpo = JSON.parse(datos);
        altas.push(cuerpo);
        const id = `g${tareas.size + 1}`;
        tareas.set(id, { consultas: 0, instruccion: cuerpo.instruccion, n: tareas.size + 1 });
        return json(200, { id, estado: 'en_cola' });
      }
      const m = req.url!.match(/^\/tareas\/(\w+)/);
      const t = m && tareas.get(m[1]);
      if (!t) return json(404, { detail: 'no existe' });
      t.consultas++;
      const g = guion(t.instruccion, t.consultas, t.n);
      return json(200, { id: m![1], motor: 'holo', instruccion: t.instruccion, segundos: 30, pasos: [], respuesta: null, error: null, ...g });
    });
  });
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
  return { url, altas, cerrar: () => new Promise<void>((r) => srv.close(() => r())) };
}

type AvisoVisto = { quien: string; aparato: string | null; aviso: AvisoApp };

/** Espía del canal de acciones del teléfono, con tiempos cortos; `llega` dice a cuántos teléfonos llegó. */
async function conAvisos<T>(fn: (vistos: AvisoVisto[]) => Promise<T>, llega: (a: AvisoApp) => number = () => 1): Promise<T> {
  const vistos: AvisoVisto[] = [];
  const antes = { ...TIEMPOS_SEGUIR };
  Object.assign(TIEMPOS_SEGUIR, { sondeoMs: 60, silencioTrasTurnoMs: 0, narrarCadaMs: 0, trabajandoCadaMs: 10_000 });
  alAvisarApp((quien, aviso, aparato) => {
    vistos.push({ quien, aparato, aviso });
    return llega(aviso);
  });
  try {
    return await fn(vistos);
  } finally {
    alAvisarApp(null);
    Object.assign(TIEMPOS_SEGUIR, antes);
  }
}

async function hasta(cond: () => boolean, ms = 8000) {
  const fin = Date.now() + ms;
  while (!cond() && Date.now() < fin) await new Promise((r) => setTimeout(r, 30));
  assert.ok(cond(), 'no pasó a tiempo');
}

test('al empezar, el teléfono del turno abre la vista en vivo; si terminó en el turno, solo se entera (lo dice el turno)', async () => {
  const nodo = await nodoConGuion((_i, c) => (c >= 2 ? { estado: 'hecha', pasos: [{ n: 1, t: 2, accion: 'open_url', args: { url: 'https://www.bch.hn/x' } }], respuesta: 'Compra 24.70' } : { estado: 'trabajando' }));
  try {
    await conNodo(nodo.url, () =>
      conAvisos(async (vistos) => {
        const r = await encargarTarea({ instruccion: 'Entra a bch.hn y dime el dólar', quien: 'jose@x.hn', motor: 'holo', esperaMs: 10_000, aparato: 'tel-1' });
        assert.match(r.hecho, /Compra 24\.70/);
        assert.deepEqual(vistos[0], { quien: 'jose@x.hn', aparato: 'tel-1', aviso: { tipo: 'computadora', fase: 'empieza', id: r.id! } });
        const fin = vistos.find((v) => v.aviso.fase === 'termina');
        assert.ok(fin, 'el teléfono se entera de que terminó');
        assert.equal(fin!.aviso.texto, undefined, 'sin texto: ya lo dice el turno');
        assert.equal(avisosPendientes('jose@x.hn'), null);
      })
    );
  } finally {
    await nodo.cerrar();
  }
});

test('el turno dejó de esperar: se cuentan los avances y el resultado va al teléfono YA (no en el turno siguiente)', async () => {
  const pasos = [
    { n: 1, t: 1, accion: 'escritorio_limpio' },
    { n: 2, t: 3, accion: 'open_url', args: { url: 'https://es.wikipedia.org/wiki/Morazán' } },
    { n: 3, t: 8, accion: 'scroll', args: { direction: 'down' } },
  ];
  const nodo = await nodoConGuion((_i, c) => (c >= 8 ? { estado: 'hecha', pasos: [...pasos, { n: 4, t: 12, accion: 'answer' }], respuesta: 'Nació el 3 de octubre de 1792.' } : { estado: 'trabajando', pasos: pasos.slice(0, Math.min(3, c)) }));
  try {
    await conNodo(nodo.url, () =>
      conAvisos(async (vistos) => {
        const r = await encargarTarea({ instruccion: 'Busca cuándo nació Morazán', quien: 'jose@x.hn', motor: 'holo', esperaMs: 50, aparato: 'tel-1' });
        assert.match(r.hecho, /sigue en tu computadora/);
        assert.match(r.hecho, /mira la pantalla/, 'le dice que mire: se abrió sola');
        await hasta(() => vistos.some((v) => v.aviso.fase === 'termina'));
        const frases = vistos.filter((v) => v.aviso.fase === 'paso').map((v) => v.aviso.texto);
        assert.ok(frases.includes('Ya entré a es.wikipedia.org.'), `cuenta los avances: ${frases.join(' | ')}`);
        assert.ok(frases.includes('Estoy leyendo la página.'), `cuenta los avances: ${frases.join(' | ')}`);
        assert.equal(new Set(frases).size, frases.length, 'sin repetir la misma frase');
        const fin = vistos.find((v) => v.aviso.fase === 'termina')!;
        assert.equal(fin.aparato, 'tel-1');
        assert.equal(fin.aviso.ok, true);
        assert.match(fin.aviso.texto!, /^Listo, ya terminé en mi computadora\. Nació el 3 de octubre de 1792\./);
        assert.equal(avisosPendientes('jose@x.hn'), null, 'le llegó al teléfono: no se repite en el turno siguiente');
      })
    );
  } finally {
    await nodo.cerrar();
  }
});

test('si el resultado no le llegó a ningún teléfono, queda para el turno siguiente como antes', async () => {
  const nodo = await nodoConGuion((_i, c) => (c >= 3 ? { estado: 'hecha', respuesta: 'Listo.' } : { estado: 'trabajando' }));
  try {
    await conNodo(nodo.url, () =>
      conAvisos(
        async (vistos) => {
          await encargarTarea({ instruccion: 'Busca algo', quien: 'ana@x.hn', motor: 'holo', esperaMs: 50, aparato: 'tel-9' });
          await hasta(() => vistos.some((v) => v.aviso.fase === 'termina' && v.aparato === null));
          assert.ok(vistos.some((v) => v.aviso.fase === 'termina' && v.aparato === 'tel-9'), 'primero al teléfono del turno, luego a cualquiera');
          assert.match(avisosPendientes('ana@x.hn')!.hecho, /«Busca algo»: Hecha/);
        },
        () => 0
      )
    );
  } finally {
    await nodo.cerrar();
  }
});

test('la misión sigue sola si una tarea no alcanza (hasta 3 más), desde donde quedó; nunca por una clave o un pago', async () => {
  // La primera se queda sin pasos; la segunda termina: el final es el de la misión.
  const nodo = await nodoConGuion((_i, c, n) =>
    n === 1 ? (c >= 2 ? { estado: 'sin_pasos', pasos: [{ n: 1, t: 2, accion: 'open_url', args: { url: 'https://sar.gob.hn' } }], error: 'Se acabaron los 25 pasos sin terminar.' } : { estado: 'trabajando' }) : c >= 2 ? { estado: 'hecha', respuesta: 'El horario es de 8 a 4.' } : { estado: 'trabajando' }
  );
  try {
    await conNodo(nodo.url, () =>
      conAvisos(async (vistos) => {
        const r = await encargarTarea({ instruccion: 'Entra a sar.gob.hn y dime el horario', quien: 'jose@x.hn', motor: 'holo', esperaMs: 50, aparato: 'tel-1' });
        await hasta(() => vistos.some((v) => v.aviso.fase === 'termina'));
        assert.equal(nodo.altas.length, 2);
        assert.match(nodo.altas[1].instruccion, /^Sigue con esta misión desde donde está la pantalla ahora, sin empezar de cero: «Entra a sar\.gob\.hn y dime el horario»\. Lo último que hiciste: Abrió https:\/\/sar\.gob\.hn\./);
        const sigue = vistos.find((v) => v.aviso.fase === 'sigue')!;
        assert.equal(sigue.aviso.texto, 'Me falta un poco; sigo con la misión.');
        assert.notEqual(sigue.aviso.id, r.id);
        const fin = vistos.find((v) => v.aviso.fase === 'termina')!;
        assert.equal(fin.aviso.id, sigue.aviso.id);
        assert.match(fin.aviso.texto!, /El horario es de 8 a 4/);
        assert.equal(ultimaTareaDe('jose@x.hn'), sigue.aviso.id, 'la app sigue la tarea nueva');
        assert.equal(duenoDe(sigue.aviso.id), 'jose@x.hn');
        assert.equal(misionDe(sigue.aviso.id), 'Entra a sar.gob.hn y dime el horario', 'la misión, como se pidió');
      })
    );
  } finally {
    await nodo.cerrar();
  }
  // Nunca termina: 1 + 3 tareas y se le dice dónde quedó.
  const terca = await nodoConGuion(() => ({ estado: 'sin_pasos', pasos: [{ n: 1, t: 2, accion: 'scroll', args: { direction: 'down' } }], error: 'Se acabaron los 25 pasos sin terminar.' }));
  try {
    await conNodo(terca.url, () =>
      conAvisos(async (vistos) => {
        await encargarTarea({ instruccion: 'Compara vuelos a Miami', quien: 'jose@x.hn', motor: 'holo', esperaMs: 0 });
        await hasta(() => vistos.some((v) => v.aviso.fase === 'termina'));
        assert.equal(terca.altas.length, 1 + MAX_CONTINUACIONES);
        assert.equal(MAX_CONTINUACIONES, 3);
        assert.match(vistos.find((v) => v.aviso.fase === 'termina')!.aviso.texto!, /^No alcancé a terminar «Compara vuelos a Miami» en mi computadora\. Me quedé en: bajó en la página\. ¿Sigo\?$/);
      })
    );
  } finally {
    await terca.cerrar();
  }
  // Lo paró una contraseña: no insiste, lo dice.
  const clave = await nodoConGuion(() => ({ estado: 'hecha', respuesta: 'No pude terminar: la página pide iniciar sesión con contraseña.' }));
  try {
    await conNodo(clave.url, () =>
      conAvisos(async (vistos) => {
        await encargarTarea({ instruccion: 'Revisa mi cuenta del banco', quien: 'jose@x.hn', motor: 'holo', esperaMs: 0 });
        await hasta(() => vistos.some((v) => v.aviso.fase === 'termina'));
        assert.equal(clave.altas.length, 1, 'no se insiste');
      })
    );
  } finally {
    await clave.cerrar();
  }
});

test('la misión: «abre X» a secas pide además contar qué hay; qué cuenta como a medias; las frases de avance', () => {
  assert.equal(prepararMision('abre bch.hn'), 'abre bch.hn, y cuando cargue dime en dos o tres frases qué hay en la página (lo principal que se ve).');
  assert.equal(prepararMision('Entra a la página de la SAR.'), 'Entra a la página de la SAR, y cuando cargue dime en dos o tres frases qué hay en la página (lo principal que se ve).');
  assert.match(prepararMision('open nytimes.com', 'en'), /tell me in two or three sentences what the page shows/);
  assert.equal(prepararMision('Entra a bch.hn y dime el precio del dólar'), 'Entra a bch.hn y dime el precio del dólar', 'una misión completa no se toca');
  assert.equal(misionIncompleta({ estado: 'sin_pasos', respuesta: null, error: 'Se acabaron los 25 pasos sin terminar.' }), true);
  assert.equal(misionIncompleta({ estado: 'hecha', respuesta: "I couldn't finish the comparison", error: null }), true);
  assert.equal(misionIncompleta({ estado: 'hecha', respuesta: '', error: null }), true, 'sin respuesta');
  assert.equal(misionIncompleta({ estado: 'hecha', respuesta: 'No encontré vuelos directos; el más barato cuesta 300 dólares.', error: null }), false, '«no encontré» es un resultado');
  assert.equal(misionIncompleta({ estado: 'hecha', respuesta: 'No pude terminar: hay un captcha.', error: null }), false, 'un captcha no se insiste');
  assert.equal(misionIncompleta({ estado: 'parada', respuesta: null, error: null }), false, 'la paró la persona');
  assert.equal(misionIncompleta({ estado: 'fallo', respuesta: null, error: 'vLLM' }), false);
  assert.equal(fraseDePaso({ accion: 'open_url', args: { url: 'https://www.bch.hn/tipo-de-cambio' } }), 'Ya entré a bch.hn.');
  assert.equal(fraseDePaso({ accion: 'type', args: { text: 'Morazán', press_enter: true } }), 'Estoy escribiendo «Morazán».');
  assert.deepEqual([0, 1, 2].map((i) => fraseDePaso({ accion: 'scroll' }, 'es', i)), ['Estoy leyendo la página.', 'Sigo leyendo…', 'Analizando los resultados…']);
  assert.equal(fraseDePaso({ accion: 'nada' }, 'en'), "I'm looking at what's on the screen.");
});

test('el cerebro: la instrucción pide la misión completa, que mire la pantalla y nunca decir que no puede', () => {
  const ins = instruccionHarness('junta', true);
  assert.match(ins, /Escribe la misión COMPLETA en UNA tarea/);
  assert.match(ins, /Nunca solo «abre X»/);
  assert.match(ins, /Ya la estoy usando, mira la pantalla/);
  assert.match(ins, /Nunca digas que no puedes usar una computadora/);
  assert.match(ins, /Nunca la uses para pagar, comprar ni poner contraseñas/);
});
