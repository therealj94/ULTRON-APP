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
  Object.assign(TIEMPOS_SEGUIR, { sondeoMs: 60, silencioTrasTurnoMs: 0, narrarCadaMs: 0, trabajandoCadaMs: 10_000, fallosAntesDeAvisar: 3, sinRespuestaMs: 1500, reintentoMs: 50 });
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
        // Abre la vista con el plan de la misión (armado de la instrucción: el cerebro no mandó uno), sin decirlo: lo dice el turno.
        assert.deepEqual(vistos[0], {
          quien: 'jose@x.hn',
          aparato: 'tel-1',
          aviso: { tipo: 'computadora', fase: 'empieza', id: r.id!, plan: ['Entrar a bch.hn', 'Leer lo que muestra la página', 'Darte el resultado'] },
        });
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
  // Como un agente: el plan va en el pedido, lo sensible espera su sí y por voz se para, pausa o sigue.
  assert.match(ins, /PLAN: <paso 1> \| <paso 2> \| <paso 3>/);
  assert.match(ins, /de 3 a 6 pasos cortos separados por «\|»/);
  assert.match(ins, /tu computadora se detiene y pide su sí/);
  assert.match(ins, /Pagar o comprar: nunca/);
  assert.match(ins, /PEDIR_HERRAMIENTA: computadora parar/);
});

/* ------------------------------------------------------------------ como un agente (José, 2-oct: «copiemos cómo lo hacen Grok, el agente de ChatGPT») */

/**
 * Un nodo como el agente.py NUEVO (con `capacidades`): estados quietos (pausada, confirmar, control), el sí,
 * el control de la persona y la pantalla de ahora. `guion(t)` cambia la tarea en cada consulta; el resto de
 * rutas cambian la tarea como lo haría el nodo de verdad. `caido` hace que las consultas fallen.
 */
type TareaFalsa = { id: string; n: number; instruccion: string; consultas: number; estado: string; pasos: any[]; respuesta: string | null; error: string | null; pregunta: string | null; si?: boolean };
async function nodoAgente(o: { caps?: string[]; guion: (t: TareaFalsa) => void; altasQueFallan?: number; altaCodigo?: number }) {
  const tareas = new Map<string, TareaFalsa>();
  const pedidos: Array<{ ruta: string; cuerpo: any }> = [];
  const estado = { caido: false, perdida: false, altasQueFallan: o.altasQueFallan ?? 0 };
  const srv = http.createServer((req, res) => {
    let datos = '';
    req.on('data', (c) => (datos += c));
    req.on('end', () => {
      const json = (code: number, j: unknown) => (res.writeHead(code, { 'content-type': 'application/json' }), res.end(JSON.stringify(j)));
      const cuerpo = datos ? JSON.parse(datos) : null;
      pedidos.push({ ruta: `${req.method} ${req.url}`, cuerpo });
      if (req.url === '/salud') return json(200, { ok: true, motores: ['holo'], ocupada: false, ...(o.caps ? { capacidades: o.caps } : {}) });
      if (req.headers.authorization !== `Bearer ${CLAVE}`) return json(401, { detail: 'clave' });
      if (req.method === 'POST' && req.url === '/tareas') {
        if (estado.altasQueFallan > 0) {
          estado.altasQueFallan--;
          return json(o.altaCodigo ?? 503, { detail: 'ocupado arrancando' });
        }
        const id = `a${tareas.size + 1}`;
        tareas.set(id, { id, n: tareas.size + 1, instruccion: cuerpo.instruccion, consultas: 0, estado: 'trabajando', pasos: [], respuesta: null, error: null, pregunta: null });
        return json(200, { id, estado: 'en_cola' });
      }
      const m = req.url!.match(/^\/tareas\/(\w+)(?:\/(\w+))?/);
      const t = m && tareas.get(m[1]);
      if (estado.caido) return res.destroy();
      if (!t || estado.perdida) return json(404, { detail: 'no existe' });
      const accion = m![2];
      const viva = !['hecha', 'parada', 'sin_pasos', 'fallo'].includes(t.estado);
      if (req.method === 'GET' && !accion) {
        t.consultas++;
        o.guion(t);
        return json(200, { id: t.id, motor: 'holo', instruccion: t.instruccion, estado: t.estado, pasos: t.pasos, respuesta: t.respuesta, error: t.error, segundos: 20, pregunta: t.pregunta });
      }
      if (!o.caps && accion !== 'parar') return json(404, { detail: 'Not Found' });
      if (accion === 'parar') {
        t.estado = 'parada';
        return json(200, { id: t.id });
      }
      if (!viva) return json(409, { detail: 'la tarea ya terminó' });
      if (accion === 'pausar') t.estado = 'pausada';
      else if (accion === 'reanudar') t.estado = 'trabajando';
      else if (accion === 'control') t.estado = cuerpo?.tomar ? 'control' : 'trabajando';
      else if (accion === 'confirmar') {
        if (t.estado !== 'confirmar') return json(409, { detail: 'no está esperando ningún sí' });
        t.si = !!cuerpo.si;
        t.estado = 'trabajando';
        t.pregunta = null;
        t.pasos.push({ n: t.pasos.length + 1, t: 9, accion: 'confirmacion', args: { si: t.si } });
      } else if (accion === 'accion') {
        if (t.estado !== 'control') return json(409, { detail: 'primero toma el control' });
        t.pasos.push({ n: t.pasos.length + 1, t: 9, accion: 'persona', args: { tipo: cuerpo.tipo } });
      } else if (accion === 'pantalla') {
        res.writeHead(200, { 'content-type': 'image/jpeg' });
        return res.end(Buffer.from('JPEGDATA'));
      }
      return json(200, { id: t.id, estado: t.estado });
    });
  });
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
  return { url, pedidos, tareas, estado, cerrar: () => new Promise<void>((r) => (srv.closeAllConnections?.(), srv.close(() => r()))) };
}

/** Las rutas de la app sobre un express de prueba (cada quien por `x-quien`). */
async function conRutas<T>(fn: (como: (quien: string | null, ruta: string, init?: RequestInit) => Promise<{ code: number; j: any }>) => Promise<T>): Promise<T> {
  const express = (await import('express')).default;
  const { montarRutasComputadora } = await import('../server/computadora');
  const app = express();
  app.use(express.json());
  const pasa: RequestHandler = (_q, _r, n) => n();
  montarRutasComputadora(app, { exigirMesa: pasa, limitar: () => pasa, sesionDe: (req) => (req.headers['x-quien'] ? { correo: String(req.headers['x-quien']) } : null) });
  const srv = app.listen(0, '127.0.0.1');
  await new Promise((r) => srv.once('listening', r));
  const base = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
  const como = (quien: string | null, ruta: string, init: RequestInit = {}) =>
    fetch(`${base}${ruta}`, { ...init, headers: { 'content-type': 'application/json', ...(quien ? { 'x-quien': quien } : {}) } }).then(async (r) => ({ code: r.status, j: await r.json() }));
  try {
    return await fn(como);
  } finally {
    await new Promise<void>((r) => srv.close(() => r()));
  }
}

const CAPS = ['pausar', 'confirmar', 'control'];

test('el plan: lo escribe el cerebro («… PLAN: a | b | c») o se arma de la instrucción; se marca con lo que hace', async () => {
  const { separarPlan, planDeMision, avanzarPlan, estadoDelPlan, tipoDePlan } = await import('../server/computadora');
  assert.deepEqual(separarPlan('Entra a bch.hn y dime el dólar PLAN: Entrar a bch.hn | Buscar el tipo de cambio | Darte compra y venta'), {
    mision: 'Entra a bch.hn y dime el dólar',
    plan: ['Entrar a bch.hn', 'Buscar el tipo de cambio', 'Darte compra y venta'],
  });
  assert.deepEqual(separarPlan('Busca vuelos. PLAN: 1) Abrir Google; 2) Buscar vuelos; 3) Darte el resultado').plan, ['Abrir Google', 'Buscar vuelos', 'Darte el resultado']);
  assert.deepEqual(separarPlan('Entra a bch.hn y dime el plan de ahorro'), { mision: 'Entra a bch.hn y dime el plan de ahorro', plan: null }, '«plan» en minúscula es parte de la misión');
  assert.equal(separarPlan('Entra a x.hn PLAN: solo uno').plan, null, 'un paso no es plan');
  assert.deepEqual(planDeMision('Entra a es.wikipedia.org, busca Francisco Morazán y dime en qué fecha nació'), ['Entrar a es.wikipedia.org', 'Buscar lo que pediste', 'Leer lo que muestra la página', 'Darte el resultado']);
  assert.deepEqual(planDeMision('Entra a sar.gob.hn, llena el formulario de contacto y envíalo'), ['Entrar a sar.gob.hn', 'Llenar el formulario', 'Pedirte el sí antes de lo delicado', 'Darte el resultado']);
  assert.deepEqual(planDeMision('Search Google for the weather in Tegucigalpa', 'en'), ['Open Google', 'Search for what you asked', 'Read what the page shows', 'Give you the result']);
  for (const p of [planDeMision('x'), planDeMision('Compara precios de laptops en amazon.com y walmart.com, busca la más barata, llena el carrito y envía el pedido')]) assert.ok(p.length >= 3 && p.length <= 6, p.join(' | '));
  assert.deepEqual(['Entrar a bch.hn', 'Buscar el tipo de cambio', 'Leer la tabla', 'Pedirte el sí antes de lo delicado', 'Darte el resultado', 'Comparar precios'].map(tipoDePlan), ['abrir', 'buscar', 'leer', 'confirmar', 'resultado', 'leer']);
  const plan = ['Entrar a es.wikipedia.org', 'Buscar Morazán', 'Leer su fecha de nacimiento', 'Darte el resultado'];
  const pasos = (...a: string[]) => a.map((accion) => ({ accion }));
  assert.equal(avanzarPlan(plan, pasos('escritorio_limpio', 'open_url')), 0, 'abrió: va en el primero');
  assert.equal(avanzarPlan(plan, pasos('open_url', 'click', 'type')), 1, 'escribió en el buscador: el segundo');
  assert.equal(avanzarPlan(plan, pasos('open_url', 'type', 'scroll', 'scroll')), 2, 'leyendo: el tercero');
  assert.equal(avanzarPlan(plan, pasos('open_url', 'type', 'scroll', 'scroll', 'scroll', 'click', 'scroll')), 2, 'sin la respuesta no llega al último');
  assert.equal(avanzarPlan(plan, pasos('open_url', 'answer')), 3);
  assert.equal(avanzarPlan(plan, pasos('open_url'), 2), 2, 'nunca retrocede');
  assert.deepEqual(estadoDelPlan({ plan, indice: 1 }, 'trabajando').map((p) => p.estado), ['hecho', 'actual', 'pendiente', 'pendiente']);
  assert.deepEqual(estadoDelPlan({ plan, indice: 1 }, 'confirmar').map((p) => p.estado), ['hecho', 'espera', 'pendiente', 'pendiente'], 'quieta: en espera');
  const fin = (ok: boolean) => ({ estado: ok ? 'hecha' : 'sin_pasos', ok, texto: '', respuesta: null, error: null, enlaces: [], datos: [], captura: null, segundos: 1, pasos: 1 }) as any;
  assert.deepEqual(estadoDelPlan({ plan, indice: 2, final: fin(true) }).map((p) => p.estado), ['hecho', 'hecho', 'hecho', 'hecho']);
  assert.deepEqual(estadoDelPlan({ plan, indice: 2, final: fin(false) }).map((p) => p.estado), ['hecho', 'hecho', 'fallo', 'pendiente']);
});

test('la misión con plan del cerebro: el nodo recibe solo la misión, la app ve el plan marcarse, y el final queda en una tarjeta con datos, enlaces y captura; con historial', async () => {
  const { datosDe, enlacesDe, historialDe, fraseDePlan } = await import('../server/computadora');
  const nodo = await nodoAgente({
    caps: CAPS,
    guion: (t) => {
      if (t.consultas === 1) t.pasos = [{ n: 1, t: 1, accion: 'open_url', args: { url: 'bch.hn' }, miniatura: 'M1' }];
      if (t.consultas === 3) t.pasos.push({ n: 2, t: 4, accion: 'type', args: { text: 'tipo de cambio', press_enter: true }, miniatura: 'M2' });
      if (t.consultas >= 6) {
        t.pasos.push({ n: 3, t: 9, accion: 'answer', args: {}, miniatura: 'FINAL' });
        t.estado = 'hecha';
        t.respuesta = 'Compra: 24.70\nVenta: 24.95\nFuente: https://www.bch.hn/tipo-de-cambio.';
      }
    },
  });
  try {
    await conNodo(nodo.url, () =>
      conAvisos(async (vistos) =>
        conRutas(async (como) => {
          const r = await encargarTarea({
            instruccion: 'Entra a bch.hn, busca el tipo de cambio y dime compra y venta PLAN: Entrar a bch.hn | Buscar el tipo de cambio | Darte compra y venta',
            quien: 'jose@x.hn',
            motor: 'holo',
            esperaMs: 0,
            aparato: 'tel-1',
          });
          assert.equal(nodo.pedidos.find((p) => p.ruta === 'POST /tareas')!.cuerpo.instruccion, 'Entra a bch.hn, busca el tipo de cambio y dime compra y venta', 'al nodo no le va el plan');
          assert.doesNotMatch(r.hecho, /Tu plan/, 'el plan lo escribió el cerebro: ya lo dijo');
          assert.deepEqual(vistos[0].aviso.plan, ['Entrar a bch.hn', 'Buscar el tipo de cambio', 'Darte compra y venta']);
          // La app: el plan va marcándose (el primer paso actual, luego hecho), con el tiempo transcurrido.
          const v1 = await como('jose@x.hn', `/api/computadora/tareas/${r.id}`);
          assert.equal(v1.code, 200);
          assert.deepEqual(v1.j.mision.plan.map((p: any) => p.estado), ['actual', 'pendiente', 'pendiente']);
          assert.equal(typeof v1.j.mision.transcurrido, 'number');
          await hasta(() => (nodo.tareas.get(r.id!)?.consultas ?? 0) >= 3);
          const v2 = await como('jose@x.hn', `/api/computadora/tareas/${r.id}`);
          assert.deepEqual(v2.j.mision.plan.map((p: any) => p.estado), ['hecho', 'actual', 'pendiente']);
          await hasta(() => vistos.some((v) => v.aviso.fase === 'termina'));
          const fin = (await como('jose@x.hn', `/api/computadora/tareas/${r.id}`)).j.mision;
          assert.deepEqual(fin.plan.map((p: any) => p.estado), ['hecho', 'hecho', 'hecho']);
          assert.equal(fin.final.ok, true);
          assert.equal(fin.final.captura, 'FINAL', 'la captura final');
          assert.deepEqual(fin.final.datos, [
            { clave: 'Compra', valor: '24.70' },
            { clave: 'Venta', valor: '24.95' },
          ]);
          assert.deepEqual(fin.final.enlaces, ['https://www.bch.hn/tipo-de-cambio', 'https://bch.hn']);
          assert.match(fin.final.texto, /^Listo, ya terminé en mi computadora\. Compra: 24\.70/);
          // El historial: la misión, la más nueva primero; y el nodo puede olvidarla: la tarjeta sigue.
          const h = (await como('jose@x.hn', '/api/computadora')).j.historial;
          assert.equal(h.length, 1);
          assert.deepEqual({ id: h[0].id, ok: h[0].ok, estado: h[0].estado }, { id: r.id, ok: true, estado: 'hecha' });
          assert.deepEqual(historialDe('otra@x.hn'), []);
          nodo.estado.perdida = true;
          const olvidada = await como('jose@x.hn', `/api/computadora/tareas/${r.id}`);
          assert.equal(olvidada.code, 200);
          assert.equal(olvidada.j.tarea.respuesta, nodo.tareas.get(r.id!)!.respuesta);
          assert.equal((await como('jose@x.hn', `/api/computadora/misiones/${r.id}`)).j.mision.final.ok, true);
          assert.equal((await como('otra@x.hn', `/api/computadora/misiones/${r.id}`)).code, 404, 'cada quien sus misiones');
        })
      )
    );
  } finally {
    await nodo.cerrar();
  }
  assert.deepEqual(datosDe('No encontré vuelos directos. El más barato: 300 dólares.'), [{ clave: 'El más barato', valor: '300 dólares' }]);
  assert.deepEqual(enlacesDe({ respuesta: 'Ver https://a.hn/x, y https://a.hn/x.', pasos: [{ n: 1, t: 1, accion: 'open_url', args: { url: 'https://a.hn/x/' } }] }), ['https://a.hn/x']);
  assert.equal(fraseDePlan(['Entrar a bch.hn', 'Leer lo que muestra la página', 'Darte el resultado']), 'Va. Mi plan: entrar a bch.hn, leer lo que muestra la página y darte el resultado.');
});

test('desde la app: encargar dice el plan en voz al empezar; sin plan del cerebro, el turno lo dice', async () => {
  const nodo = await nodoAgente({ caps: CAPS, guion: () => undefined });
  try {
    await conNodo(nodo.url, () =>
      conAvisos(async (vistos) => {
        const r = await conRutas((como) => como('jose@x.hn', '/api/computadora/tareas', { method: 'POST', body: JSON.stringify({ instruccion: 'Entra a bch.hn y dime el precio del dólar' }) }));
        assert.equal(r.code, 200);
        assert.deepEqual(r.j.mision.plan.map((p: any) => p.texto), ['Entrar a bch.hn', 'Leer lo que muestra la página', 'Darte el resultado']);
        assert.equal(vistos[0].aviso.texto, 'Va. Mi plan: entrar a bch.hn, leer lo que muestra la página y darte el resultado.');
        const t = await encargarTarea({ instruccion: 'Busca en Google el clima de mañana', quien: 'ana@x.hn', motor: 'holo', esperaMs: 0 });
        assert.match(t.hecho, /Tu plan: Abrir Google → Buscar lo que pediste → Leer lo que muestra la página → Darte el resultado; díselo en una frase corta\./);
        assert.equal(vistos.at(-1)!.aviso.texto, undefined, 'en el turno el plan lo dice el cerebro');
      })
    );
  } finally {
    await nodo.cerrar();
  }
});

test('confirmación: antes de algo sensible pausa y pregunta en la app y en voz; el «sí» de la conversación la reanuda (y un «no» no lo hace)', async () => {
  const { resolverPreguntaComputadora, respuestaSiNo } = await import('../server/computadora');
  const nodo = await nodoAgente({
    caps: CAPS,
    guion: (t) => {
      if (t.consultas === 2 && t.si === undefined) {
        t.estado = 'confirmar';
        t.pregunta = 'Voy a tocar «Enviar formulario». ¿Lo hago?';
        t.pasos = [{ n: 1, t: 3, accion: 'pedir_confirmacion', args: { pregunta: t.pregunta } }];
      }
      if (t.si !== undefined && t.consultas > 4) {
        t.estado = 'hecha';
        t.respuesta = t.si ? 'Envié el formulario.' : 'No lo envié porque dijiste que no.';
      }
    },
  });
  try {
    await conNodo(nodo.url, () =>
      conAvisos(async (vistos) => {
        await encargarTarea({ instruccion: 'Entra a sar.gob.hn, llena el formulario de contacto y envíalo', quien: 'jose@x.hn', motor: 'holo', esperaMs: 0, aparato: 'tel-1' });
        await hasta(() => vistos.some((v) => v.aviso.fase === 'confirmar'));
        const p = vistos.find((v) => v.aviso.fase === 'confirmar')!;
        assert.equal(p.aviso.pregunta, 'Voy a tocar «Enviar formulario». ¿Lo hago?', 'los botones de la app');
        assert.equal(p.aviso.texto, 'Antes de seguir necesito tu sí. Voy a tocar «Enviar formulario». ¿Lo hago? Dime sí o no.', 'y AURA lo dice');
        await new Promise((r) => setTimeout(r, 300));
        assert.equal(vistos.filter((v) => v.aviso.fase === 'confirmar').length, 1, 'se pregunta una vez, no en cada consulta');
        assert.ok(!vistos.some((v) => v.aviso.fase === 'paso' && v.aviso.texto === 'Sigo trabajando en mi computadora.'), 'esperando no se narra');
        // Otra cosa no es respuesta: la pregunta sigue esperando.
        assert.equal(await resolverPreguntaComputadora('jose@x.hn', '¿y cuánto falta?'), null);
        assert.equal(await resolverPreguntaComputadora('otra@x.hn', 'sí'), null, 'el sí de otra persona no vale');
        const h = await resolverPreguntaComputadora('jose@x.hn', '¡Sí, dale!');
        assert.match(h!, /^COMPUTADORA: dijo que sí a «Voy a tocar «Enviar formulario»/);
        assert.deepEqual(nodo.pedidos.find((x) => /\/confirmar$/.test(x.ruta))!.cuerpo, { si: true });
        assert.equal(await resolverPreguntaComputadora('jose@x.hn', 'sí'), null, 'ya contestada: un segundo «sí» no hace nada');
        await hasta(() => vistos.some((v) => v.aviso.fase === 'termina'));
        assert.match(vistos.find((v) => v.aviso.fase === 'termina')!.aviso.texto!, /Envié el formulario/);
        assert.ok(vistos.some((v) => v.aviso.fase === 'reanuda'), 'el teléfono sabe que siguió (quita los botones y vuelve el tecleo)');
      })
    );
    // En la voz (turno especulativo) la respuesta espera a que el turno se confirme.
    await conNodo(nodo.url, () =>
      conAvisos(async (vistos) => {
        await encargarTarea({ instruccion: 'Entra a x.hn y publica el comentario', quien: 'ana@x.hn', motor: 'holo', esperaMs: 0 });
        await hasta(() => vistos.some((v) => v.aviso.fase === 'confirmar'));
        let hacer: (() => void) | null = null;
        const h = await resolverPreguntaComputadora('ana@x.hn', 'no', { hacer: (f) => (hacer = f), alDescartar: () => undefined });
        assert.match(h!, /dijo que no/);
        const antes = nodo.pedidos.filter((x) => /\/confirmar$/.test(x.ruta)).length;
        hacer!();
        await hasta(() => nodo.pedidos.filter((x) => /\/confirmar$/.test(x.ruta)).length > antes);
        assert.deepEqual(nodo.pedidos.filter((x) => /\/confirmar$/.test(x.ruta)).at(-1)!.cuerpo, { si: false });
      })
    );
  } finally {
    await nodo.cerrar();
  }
  assert.deepEqual(['sí', 'Sí, hazlo', 'dale', 'ok', 'yes go ahead', 'no', 'mejor no', 'no lo hagas', 'sí pero cámbiale el asunto', '¿qué preguntó?'].map(respuestaSiNo), ['si', 'si', 'si', 'si', 'si', 'no', 'no', 'no', null, null]);
});

test('confirmación en el turno: si pregunta mientras el turno espera, lo dice el turno y la app pone los botones; también por la app', async () => {
  const nodo = await nodoAgente({
    caps: CAPS,
    guion: (t) => {
      if (t.si === undefined) {
        t.estado = 'confirmar';
        t.pregunta = '¿Inicio sesión con la cuenta de prueba?';
      } else if (t.consultas > 3) {
        t.estado = 'hecha';
        t.respuesta = 'Listo.';
      }
    },
  });
  try {
    await conNodo(nodo.url, () =>
      conAvisos(async (vistos) =>
        conRutas(async (como) => {
          const r = await encargarTarea({ instruccion: 'Entra a x.hn e inicia sesión', quien: 'jose@x.hn', motor: 'holo', esperaMs: 10_000 });
          assert.match(r.hecho, /se detuvo a pedir permiso antes de algo sensible: «¿Inicio sesión con la cuenta de prueba\?»/);
          assert.match(r.hecho, /Pregúntale con esas palabras si lo haces \(sí o no\)/);
          const p = vistos.find((v) => v.aviso.fase === 'confirmar')!;
          assert.equal(p.aviso.texto, undefined, 'la dice el turno');
          assert.equal(p.aviso.pregunta, '¿Inicio sesión con la cuenta de prueba?');
          const v = await como('jose@x.hn', `/api/computadora/tareas/${r.id}`);
          assert.equal(v.j.mision.pregunta, '¿Inicio sesión con la cuenta de prueba?');
          assert.equal(v.j.mision.plan.find((x: any) => x.estado === 'espera')?.texto, 'Entrar a x.hn', 'el paso de ahora queda en espera');
          assert.equal((await como('jose@x.hn', `/api/computadora/tareas/${r.id}/confirmar`, { method: 'POST', body: '{}' })).code, 400, 'sí o no, nada más');
          assert.equal((await como('otra@x.hn', `/api/computadora/tareas/${r.id}/confirmar`, { method: 'POST', body: '{"si":true}' })).code, 404);
          const c = await como('jose@x.hn', `/api/computadora/tareas/${r.id}/confirmar`, { method: 'POST', body: '{"si":true}' });
          assert.equal(c.code, 200);
          assert.equal(c.j.si, true);
          assert.equal((await como('jose@x.hn', `/api/computadora/tareas/${r.id}/confirmar`, { method: 'POST', body: '{"si":true}' })).code, 409, 'ya no espera');
          await hasta(() => vistos.some((x) => x.aviso.fase === 'termina'));
        })
      )
    );
  } finally {
    await nodo.cerrar();
  }
});

test('detener, pausar y tomar el control: con el nodo nuevo se hace y se avisa; con el viejo solo Detener y se dice por qué', async () => {
  const nodo = await nodoAgente({ caps: CAPS, guion: (t) => void (t.pasos = [{ n: 1, t: 1, accion: 'open_url', args: { url: 'x.hn' } }]) });
  try {
    await conNodo(nodo.url, () =>
      conAvisos(async (vistos) =>
        conRutas(async (como) => {
          const r = await encargarTarea({ instruccion: 'Entra a x.hn y lee las noticias', quien: 'jose@x.hn', motor: 'holo', esperaMs: 0 });
          const ruta = (a: string) => `/api/computadora/tareas/${r.id}/${a}`;
          assert.equal((await como('jose@x.hn', '/api/computadora')).j.capacidades.join(','), 'pausar,confirmar,control');
          assert.equal((await como('jose@x.hn', ruta('pausar'), { method: 'POST', body: '{}' })).code, 200);
          await hasta(() => vistos.some((v) => v.aviso.fase === 'pausa'));
          assert.deepEqual(
            { estado: vistos.find((v) => v.aviso.fase === 'pausa')!.aviso.estado, texto: vistos.find((v) => v.aviso.fase === 'pausa')!.aviso.texto },
            { estado: 'pausada', texto: 'Listo, pausé mi computadora. Me dices cuándo sigo.' }
          );
          assert.equal((await como('jose@x.hn', ruta('control'), { method: 'POST', body: '{"tomar":true}' })).code, 200);
          await hasta(() => vistos.some((v) => v.aviso.estado === 'control'));
          assert.match(vistos.find((v) => v.aviso.estado === 'control')!.aviso.texto!, /la computadora es tuya/);
          // Con el control: tocar (en [0, 1000]), escribir, una tecla; lo raro no pasa. Y la pantalla de ahora.
          assert.equal((await como('jose@x.hn', ruta('accion'), { method: 'POST', body: '{"tipo":"click","x":500,"y":300}' })).code, 200);
          assert.equal((await como('jose@x.hn', ruta('accion'), { method: 'POST', body: '{"tipo":"click","x":5000,"y":300}' })).code, 400);
          assert.equal((await como('jose@x.hn', ruta('accion'), { method: 'POST', body: '{"tipo":"borrar_disco"}' })).code, 400);
          assert.equal((await como('otra@x.hn', ruta('accion'), { method: 'POST', body: '{"tipo":"click","x":1,"y":1}' })).code, 404);
          const pant = await como('jose@x.hn', ruta('pantalla'));
          assert.equal(Buffer.from(pant.j.imagen, 'base64').toString(), 'JPEGDATA');
          assert.equal((await como('jose@x.hn', ruta('control'), { method: 'POST', body: '{"tomar":false}' })).code, 200);
          await hasta(() => vistos.some((v) => v.aviso.fase === 'reanuda'));
          assert.equal(vistos.find((v) => v.aviso.fase === 'reanuda')!.aviso.texto, 'Gracias, sigo desde donde la dejaste.');
          // Detener: el nodo la para; la tarjeta queda (sin decir nada: lo pidió la persona) y el plan marca dónde quedó.
          assert.equal((await como('jose@x.hn', ruta('parar'), { method: 'POST', body: '{}' })).code, 200);
          await hasta(() => vistos.some((v) => v.aviso.fase === 'termina'));
          const fin = vistos.find((v) => v.aviso.fase === 'termina')!.aviso;
          assert.deepEqual({ ok: fin.ok, texto: fin.texto }, { ok: false, texto: undefined });
          const m = (await como('jose@x.hn', `/api/computadora/misiones/${r.id}`)).j.mision;
          assert.equal(m.final.estado, 'parada');
          assert.deepEqual(m.plan.map((p: any) => p.estado), ['fallo', 'pendiente', 'pendiente']);
          assert.equal((await como('jose@x.hn', ruta('pausar'), { method: 'POST', body: '{}' })).code, 409, 'una terminada no se pausa');
        })
      )
    );
  } finally {
    await nodo.cerrar();
  }
  // El agente.py de antes (sin capacidades): pausar y el control no existen; se dice claro, y Detener sí.
  const viejo = await nodoAgente({ guion: () => undefined });
  try {
    await conNodo(viejo.url, () =>
      conAvisos(async () =>
        conRutas(async (como) => {
          const r = await encargarTarea({ instruccion: 'Entra a x.hn y lee', quien: 'jose@x.hn', motor: 'holo', esperaMs: 0 });
          const p = await como('jose@x.hn', `/api/computadora/tareas/${r.id}/pausar`, { method: 'POST', body: '{}' });
          assert.equal(p.code, 501);
          assert.match(p.j.error, /todavía no sabe pausar: falta actualizar su servicio.*Puedo detenerla/);
          assert.equal((await como('jose@x.hn', `/api/computadora/tareas/${r.id}/control`, { method: 'POST', body: '{"tomar":true}' })).code, 501);
          assert.deepEqual((await como('jose@x.hn', '/api/computadora')).j.capacidades, []);
          assert.equal((await como('jose@x.hn', `/api/computadora/tareas/${r.id}/parar`, { method: 'POST', body: '{}' })).code, 200);
          const { comandoComputadora } = await import('../server/computadora');
          assert.match((await comandoComputadora('jose@x.hn', 'pausar'))!, /todavía no sabe pausar/);
        })
      )
    );
  } finally {
    await viejo.cerrar();
  }
});

test('por voz: «para / pausa / sigue tu computadora» van a su tarea de ahora; lo demás es una misión nueva', async () => {
  const { comandoComputadora } = await import('../server/computadora');
  const nodo = await nodoAgente({ caps: CAPS, guion: () => undefined });
  try {
    await conNodo(nodo.url, () =>
      conAvisos(async () => {
        assert.match((await comandoComputadora('jose@x.hn', 'parar'))!, /no hay ninguna tarea suya/);
        assert.equal(await comandoComputadora('jose@x.hn', 'Entra a bch.hn y dime el dólar'), null, 'una misión: no es un comando');
        const r = await encargarTarea({ instruccion: 'Entra a x.hn y lee', quien: 'jose@x.hn', motor: 'holo', esperaMs: 0 });
        assert.match((await comandoComputadora('jose@x.hn', 'pausa'))!, /la pausé/);
        assert.equal(nodo.tareas.get(r.id!)!.estado, 'pausada');
        assert.match((await comandoComputadora('jose@x.hn', 'sigue'))!, /siguió donde estaba/);
        assert.equal(nodo.tareas.get(r.id!)!.estado, 'trabajando');
        assert.match((await comandoComputadora('jose@x.hn', 'Detente.'))!, /^HARNESS computadora: paré «Entra a x\.hn y lee»/);
        assert.equal(nodo.tareas.get(r.id!)!.estado, 'parada');
      })
    );
  } finally {
    await nodo.cerrar();
  }
});

test('robustez: encargar se reintenta si el nodo no contesta (un 4xx no); si deja de contestar se dice y se cierra honesto; a medias se ofrece seguir y el «sí» sigue', async () => {
  const { resolverPreguntaComputadora } = await import('../server/computadora');
  // Arrancando (503 una vez): el segundo intento entra.
  const lento = await nodoAgente({ caps: CAPS, guion: () => undefined, altasQueFallan: 1 });
  try {
    await conNodo(lento.url, () =>
      conAvisos(async () => {
        const r = await encargarTarea({ instruccion: 'Entra a x.hn y lee', quien: 'jose@x.hn', motor: 'holo', esperaMs: 0 });
        assert.ok(r.id, 'el segundo intento entró');
        assert.equal(lento.pedidos.filter((p) => p.ruta === 'POST /tareas').length, 2);
      })
    );
  } finally {
    await lento.cerrar();
  }
  const caido = await nodoAgente({ caps: CAPS, guion: () => undefined, altasQueFallan: 5 });
  try {
    await conNodo(caido.url, () =>
      conAvisos(async () => {
        const r = await encargarTarea({ instruccion: 'Entra a x.hn y lee', quien: 'jose@x.hn', motor: 'holo', esperaMs: 0 });
        assert.equal(r.id, null);
        assert.match(r.hecho, /no pude encargarla \(no contestó tras dos intentos/);
        assert.match(r.hecho, /Dilo con honestidad y ofrece intentarlo en un momento/);
      })
    );
  } finally {
    await caido.cerrar();
  }
  const noQuiere = await nodoAgente({ caps: CAPS, guion: () => undefined, altasQueFallan: 5, altaCodigo: 400 });
  try {
    await conNodo(noQuiere.url, () =>
      conAvisos(async () => {
        await encargarTarea({ instruccion: 'Entra a x.hn y lee', quien: 'jose@x.hn', motor: 'holo', esperaMs: 0 });
        assert.equal(noQuiere.pedidos.filter((p) => p.ruta === 'POST /tareas').length, 1, 'un 400 no se reintenta');
      })
    );
  } finally {
    await noQuiere.cerrar();
  }
  // Deja de contestar a media tarea: «sigo intentando» una vez y, al tope, un final honesto con «¿sigo?».
  const muere = await nodoAgente({ caps: CAPS, guion: (t) => void (t.pasos = [{ n: 1, t: 1, accion: 'open_url', args: { url: 'x.hn' } }]) });
  try {
    await conNodo(muere.url, () =>
      conAvisos(async (vistos) =>
        conRutas(async (como) => {
          const r = await encargarTarea({ instruccion: 'Entra a x.hn y lee las noticias', quien: 'jose@x.hn', motor: 'holo', esperaMs: 0, aparato: 'tel-1' });
          await hasta(() => (muere.tareas.get(r.id!)?.consultas ?? 0) >= 2);
          muere.estado.caido = true;
          await hasta(() => vistos.some((v) => v.aviso.texto === 'Mi computadora no me contesta; sigo intentando.'));
          await hasta(() => vistos.some((v) => v.aviso.fase === 'termina'), 6000);
          const fin = vistos.find((v) => v.aviso.fase === 'termina')!.aviso;
          assert.equal(fin.ok, false);
          assert.match(fin.texto!, /^Mi computadora falló: dejó de contestarme a mitad de la tarea; no sé si alcanzó a terminar\.$/);
          assert.equal(vistos.filter((v) => v.aviso.texto === 'Mi computadora no me contesta; sigo intentando.').length, 1, 'se dice una vez');
          const m = (await como('jose@x.hn', `/api/computadora/misiones/${r.id}`)).j.mision;
          assert.equal(m.puedeSeguir, true);
          // Vuelve el nodo y la persona dice «sí, sigue»: otra tarea desde donde quedó.
          muere.estado.caido = false;
          const h = await resolverPreguntaComputadora('jose@x.hn', 'sí, sigue');
          assert.match(h!, /dijo que sí; tu computadora sigue con «Entra a x\.hn y lee las noticias» desde donde quedó/);
          const altas = muere.pedidos.filter((p) => p.ruta === 'POST /tareas');
          assert.equal(altas.length, 2);
          assert.match(altas[1].cuerpo.instruccion, /^Sigue con esta misión desde donde está la pantalla ahora/);
          assert.ok(vistos.some((v) => v.aviso.fase === 'sigue'));
          assert.equal((await como('jose@x.hn', '/api/computadora')).j.historial.length, 1, 'la misma misión, no otra');
        })
      )
    );
  } finally {
    await muere.cerrar();
  }
  // El nodo se reinició y ya no tiene la tarea (404): se cierra enseguida, sin esperar el tope.
  const reinicia = await nodoAgente({ caps: CAPS, guion: () => undefined });
  try {
    await conNodo(reinicia.url, () =>
      conAvisos(async (vistos) => {
        await encargarTarea({ instruccion: 'Entra a x.hn y lee', quien: 'jose@x.hn', motor: 'holo', esperaMs: 0 });
        reinicia.estado.perdida = true;
        await hasta(() => vistos.some((v) => v.aviso.fase === 'termina'), 1200);
        assert.match(vistos.find((v) => v.aviso.fase === 'termina')!.aviso.texto!, /se reinició y perdió la tarea/);
      })
    );
  } finally {
    await reinicia.cerrar();
  }
});

test('a medias por tiempo: tras las continuaciones se ofrece seguir, el botón «Seguir» de la app la sigue, y «no» la deja', async () => {
  const { resolverPreguntaComputadora } = await import('../server/computadora');
  const nodo = await nodoAgente({ caps: CAPS, guion: (t) => void ((t.estado = 'sin_pasos'), (t.error = 'Se acabaron los 25 pasos sin terminar.')) });
  try {
    await conNodo(nodo.url, () =>
      conAvisos(async (vistos) =>
        conRutas(async (como) => {
          const r = await encargarTarea({ instruccion: 'Compara vuelos a Miami', quien: 'jose@x.hn', motor: 'holo', esperaMs: 0 });
          await hasta(() => vistos.some((v) => v.aviso.fase === 'termina'));
          assert.match(vistos.find((v) => v.aviso.fase === 'termina')!.aviso.texto!, /¿Sigo\?$/);
          // La lectura del propio teléfono no cuenta; hablar de otra cosa sí: el «¿sigo?» deja de valer para un «sí» suelto.
          assert.equal(await resolverPreguntaComputadora('jose@x.hn', '[[lectura:abcdEFGH1234]] No alcancé a terminar'), null);
          assert.equal(await resolverPreguntaComputadora('jose@x.hn', '¿qué hora es?'), null);
          assert.equal(await resolverPreguntaComputadora('jose@x.hn', 'sí'), null, 'ese «sí» era para otra cosa');
          assert.equal(nodo.pedidos.filter((p) => p.ruta === 'POST /tareas').length, 4, 'no se siguió sola');
          // El botón «Seguir» de la tarjeta sí vale (lo tocó la persona).
          assert.equal((await como('jose@x.hn', `/api/computadora/misiones/${r.id}`)).j.mision.puedeSeguir, true);
          assert.equal((await como('otra@x.hn', `/api/computadora/misiones/${r.id}/seguir`, { method: 'POST', body: '{}' })).code, 404);
          const s = await como('jose@x.hn', `/api/computadora/misiones/${r.id}/seguir`, { method: 'POST', body: '{}' });
          assert.equal(s.code, 200);
          assert.equal(vistos.find((v) => v.aviso.fase === 'sigue' && v.aviso.texto === 'Va, sigo desde donde me quedé.')?.aviso.id, s.j.id);
          await hasta(() => vistos.filter((v) => v.aviso.fase === 'termina').length >= 2);
          assert.equal(await resolverPreguntaComputadora('jose@x.hn', 'no'), 'COMPUTADORA: no quiere que sigas con «Compara vuelos a Miami». Dile que está bien, que ahí queda.');
          assert.equal(await resolverPreguntaComputadora('jose@x.hn', 'sí'), null, 'ya no se ofrece');
        })
      )
    );
  } finally {
    await nodo.cerrar();
  }
});

test('sí/no a su computadora: una negación en cualquier parte no es un sí; lo que se contradice vuelve a preguntar (auditoría, 3-oct)', async () => {
  const { respuestaSiNo } = await import('../server/computadora');
  for (const t of ['claro que no', 'sí, no lo hagas', 'dale, no', 'ok pero no']) assert.equal(respuestaSiNo(t), null, t);
  assert.equal(respuestaSiNo('no, sí mándalo'), null, 'se contradice: se pregunta otra vez');
  assert.equal(respuestaSiNo('va a llover'), null, '«va» al principio de otra frase no es un sí');
  for (const t of ['sí', 'dale', 'va', 'ok', 'claro', 'adelante']) assert.equal(respuestaSiNo(t), 'si', t);
  for (const t of ['no', 'mejor no', 'no lo hagas', 'cancela']) assert.equal(respuestaSiNo(t), 'no', t);
});
