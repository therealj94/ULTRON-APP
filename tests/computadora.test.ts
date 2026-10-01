/**
 * La computadora de los agentes (server/computadora.ts) contra un nodo de mentira que habla como
 * scripts/nodo-computadora/agente.py: encargar, esperar, seguir después, avisar una vez, y el pedido
 * del cerebro (PEDIR_HERRAMIENTA: computadora …).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { encargarTarea, motorDelPerfil, tareaTerminadaPara, duenoDe, ultimaTareaDe, estadoComputadora, _olvidarEncargos } from '../server/computadora';
import { extraerPedidoHerramienta, instruccionHarness, resolverPedido } from '../lib/harness';
import { validarCambios } from '../lib/perfil-persona';
import { fichaManosPrompt, manosDe } from '../lib/manos-ficha';

const CLAVE = 'clave-de-prueba';

/** Un nodo que termina cada tarea tras `pasosHastaTerminar` consultas. */
async function nodoFalso(pasosHastaTerminar: number, sinClaude = false) {
  const tareas = new Map<string, { consultas: number; instruccion: string; motor: string }>();
  const pedidos: Array<{ ruta: string; cuerpo: any; auth: string | undefined }> = [];
  const srv = http.createServer((req, res) => {
    let datos = '';
    req.on('data', (c) => (datos += c));
    req.on('end', () => {
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
      // Ya se dijo en este turno: el siguiente no la vuelve a contar.
      assert.equal(tareaTerminadaPara('jose@x.hn'), null);
    });
  } finally {
    await nodo.cerrar();
  }
});

test('si no alcanza el turno: dice que sigue, y al terminar se avisa UNA vez en el turno siguiente', async () => {
  const nodo = await nodoFalso(3);
  try {
    await conNodo(nodo.url, async () => {
      const r = await encargarTarea({ instruccion: 'Compara precios', quien: 'ana@x.hn', motor: 'claude', esperaMs: 100 });
      assert.match(r.hecho, /sigue en tu computadora/);
      assert.match(r.hecho, /No inventes el resultado/);
      assert.equal(tareaTerminadaPara('ana@x.hn'), null, 'todavía no terminó');
      // El seguimiento consulta cada 5 s: se espera a que la vea terminada.
      let aviso: string | null = null;
      for (let i = 0; i < 40 && !aviso; i++) {
        await new Promise((res) => setTimeout(res, 500));
        aviso = tareaTerminadaPara('ana@x.hn');
      }
      assert.ok(aviso, 'se avisó al terminar');
      assert.match(aviso!, /terminó la tarea que te encargaron antes, «Compara precios»/);
      assert.equal(tareaTerminadaPara('ana@x.hn'), null, 'una sola vez');
      assert.equal(tareaTerminadaPara('otra@x.hn'), null, 'cada quien sus tareas');
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
