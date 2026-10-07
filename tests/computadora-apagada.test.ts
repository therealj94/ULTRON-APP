/**
 * Su computadora apagada para ahorrar (o caída) — auditoría del 7-oct (José: «no me ha convencido»; la instancia con GPU
 * cuesta por hora). Antes, encargar a un nodo que no contesta esperaba dos plazos de 15 s y el reintento antes de decir un
 * «no pude» genérico: la voz se quedaba medio minuto callada. Ahora:
 *  · ni conectar (ECONNREFUSED) y ni su salud contesta: se dice al momento que no contesta, sin encargar nada;
 *  · si hace poco no contestaba, la siguiente mira su salud con un plazo corto (3 s) antes de lanzar y no manda el pedido;
 *  · si volvió, se encarga como siempre;
 *  · la app recibe 503 con `code: 'apagada'` y el texto para la persona (sin las órdenes para el modelo).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import type { RequestHandler } from 'express';
import { encargarTarea, nodoSinContacto, _olvidarEncargos, HECHO_APAGADA, SONDA_MS } from '../server/computadora';

const CLAVE = 'clave-de-prueba';

/** Un puerto donde no escucha nadie (ECONNREFUSED al momento), como el nodo con el servicio caído. */
async function puertoCerrado(): Promise<string> {
  const s = http.createServer();
  await new Promise<void>((r) => s.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${(s.address() as AddressInfo).port}`;
  await new Promise<void>((r) => s.close(() => r()));
  return url;
}

/** Un nodo que acepta la conexión y nunca contesta (como la IP de una instancia apagada: el pedido se queda colgado). */
async function nodoMudo() {
  const vistos: string[] = [];
  const colgados = new Set<http.ServerResponse>();
  const srv = http.createServer((req, res) => {
    vistos.push(`${req.method} ${req.url}`);
    colgados.add(res);
  });
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
  return {
    url: `http://127.0.0.1:${(srv.address() as AddressInfo).port}`,
    vistos,
    cerrar: () => {
      for (const r of colgados) r.destroy();
      srv.closeAllConnections?.();
      return new Promise<void>((r) => srv.close(() => r()));
    },
  };
}

/** Un nodo sano: contesta su salud y crea la tarea. */
async function nodoSano() {
  const vistos: string[] = [];
  const srv = http.createServer((req, res) => {
    vistos.push(`${req.method} ${req.url}`);
    const json = (code: number, j: unknown) => (res.writeHead(code, { 'content-type': 'application/json' }), res.end(JSON.stringify(j)));
    req.resume();
    req.on('end', () => {
      if (req.url === '/salud') return json(200, { ok: true, motores: ['holo'], ocupada: false });
      if (req.method === 'POST' && req.url === '/tareas') return json(200, { id: 'tz1', estado: 'en_cola' });
      return json(200, { id: 'tz1', motor: 'holo', instruccion: 'x', estado: 'trabajando', pasos: [], respuesta: null, error: null, segundos: 1 });
    });
  });
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
  return { url: `http://127.0.0.1:${(srv.address() as AddressInfo).port}`, vistos, cerrar: () => new Promise<void>((r) => srv.close(() => r())) };
}

/** Las variables del nodo para una prueba (sin olvidar lo que se supo del nodo entre un paso y otro de la misma prueba). */
function apuntarA(url: string) {
  process.env.COMPUTADORA_URL = url;
  process.env.COMPUTADORA_CLAVE = CLAVE;
}
async function conVariables<T>(fn: () => Promise<T>): Promise<T> {
  const antes = { u: process.env.COMPUTADORA_URL, c: process.env.COMPUTADORA_CLAVE };
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

test('apagada: ni conectar ni su salud → lo dice al momento, sin encargar nada ni inventar', async () => {
  await conVariables(async () => {
    apuntarA(await puertoCerrado());
    const t0 = Date.now();
    const r = await encargarTarea({ instruccion: 'Entra a x.hn y dime el horario', quien: 'jose@x.hn', motor: 'holo', esperaMs: 20_000 });
    const ms = Date.now() - t0;
    assert.equal(r.id, null);
    assert.equal(r.hecho, HECHO_APAGADA);
    assert.equal(r.apagada, true);
    assert.equal(r.incierto, false, 'ECONNREFUSED: el pedido no llegó');
    assert.match(r.hecho, /no contesta ahora/);
    assert.match(r.hecho, /No inventes el resultado/);
    assert.doesNotMatch(r.hecho, /la estoy usando|mira la pantalla/);
    assert.ok(ms < 2000, `sin esperar dos plazos (${ms} ms)`);
    assert.equal(nodoSinContacto(), true);
  });
});

test('hace poco no contestaba: la siguiente mira su salud con plazo corto y NO manda el pedido a un nodo mudo', async () => {
  const mudo = await nodoMudo();
  try {
    await conVariables(async () => {
      apuntarA(await puertoCerrado());
      await encargarTarea({ instruccion: 'primera', quien: 'jose@x.hn', motor: 'holo', esperaMs: 0 });
      assert.equal(nodoSinContacto(), true);
      // La misma computadora, ahora con la conexión colgada (la IP de una instancia apagada).
      apuntarA(mudo.url);
      const t0 = Date.now();
      const r = await encargarTarea({ instruccion: 'Entra a x.hn y lee', quien: 'jose@x.hn', motor: 'holo', esperaMs: 20_000 });
      const ms = Date.now() - t0;
      assert.equal(r.id, null);
      assert.equal(r.hecho, HECHO_APAGADA);
      assert.ok(ms < SONDA_MS + 1500, `solo el plazo corto de la salud (${ms} ms), no 15 s + 15 s`);
      assert.deepEqual(mudo.vistos, ['GET /salud'], 'no se mandó ningún pedido de tarea');
    });
  } finally {
    await mudo.cerrar();
  }
});

test('volvió: con su salud contestando se encarga como siempre y deja de estar «sin contacto»', async () => {
  const sano = await nodoSano();
  try {
    await conVariables(async () => {
      apuntarA(await puertoCerrado());
      await encargarTarea({ instruccion: 'primera', quien: 'jose@x.hn', motor: 'holo', esperaMs: 0 });
      apuntarA(sano.url);
      const r = await encargarTarea({ instruccion: 'Entra a x.hn y lee', quien: 'jose@x.hn', motor: 'holo', esperaMs: 0 });
      assert.equal(r.id, 'tz1');
      assert.equal(r.apagada, undefined);
      assert.deepEqual(sano.vistos.slice(0, 2), ['GET /salud', 'POST /tareas']);
      assert.equal(nodoSinContacto(), false);
    });
  } finally {
    await sano.cerrar();
  }
});

test('la app: 503 con code «apagada» y el texto para la persona, sin las órdenes para el modelo', async () => {
  const express = (await import('express')).default;
  const { montarRutasComputadora } = await import('../server/computadora');
  await conVariables(async () => {
    apuntarA(await puertoCerrado());
    const app = express();
    app.use(express.json());
    const pasa: RequestHandler = (_q, _r, n) => n();
    montarRutasComputadora(app, { exigirMesa: pasa, limitar: () => pasa, sesionDe: () => ({ correo: 'jose@x.hn' }), motorDe: async () => 'gratis' });
    const srv = app.listen(0, '127.0.0.1');
    await new Promise((r) => srv.once('listening', r));
    try {
      const base = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
      const r = await fetch(`${base}/api/computadora/tareas`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ instruccion: 'Entra a x.hn y dime el horario' }) });
      const j: any = await r.json();
      assert.equal(r.status, 503);
      assert.equal(j.code, 'apagada');
      assert.equal(j.error, 'Tu computadora no contesta ahora (puede estar apagada para ahorrar o caída).');
      // El estado general también lo dice (ok: false), para que la hoja quite el campo de encargar.
      const e: any = await (await fetch(`${base}/api/computadora`)).json();
      assert.equal(e.configurada, true);
      assert.equal(e.ok, false);
    } finally {
      await new Promise<void>((r) => srv.close(() => r()));
    }
  });
});
