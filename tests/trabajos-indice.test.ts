/**
 * P5 / A7 (auditoría externa del 4-oct): un fallo del índice o de la lectura de una tarea NO puede esconder trabajo que
 * existe, y un tope no puede esconder una tarea activa.
 *
 *   · índice que no se puede escribir al crear: o la creación lo dice (no 201 «creada» que luego no aparece) o la tarea
 *     se puede descubrir en la lista;
 *   · un objeto de tarea que no se puede leer: la lista nunca es «0 tareas» como éxito completo (degradación honesta:
 *     `completo:false` y un aviso, o 503);
 *   · 41 tareas activas: todas se pueden descubrir (la lista de siempre y por páginas con cursor), con un conteo honesto;
 *   · con el almacén sano, la lista dice `completo:true` y los controles (pausar, cancelar) siguen funcionando;
 *   · un cliente viejo (sin parámetros) recibe la misma forma de siempre.
 *
 * S3 condicional sintético (tests/s3-condicional-falso.ts): nada sale de la máquina.
 */
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import type { AddressInfo } from 'node:net';
import { _usarAlmacenDurable } from '../lib/durable';
import { montarRutasTrabajos } from '../server/trabajos';
import { conS3Falso } from './s3-condicional-falso';

afterEach(() => _usarAlmacenDurable(null));

function arnes() {
  const app = express();
  app.use(express.json());
  const pasa = (_q: any, _s: any, next: any) => next();
  montarRutasTrabajos(app, { exigirMesa: pasa, limitar: () => pasa, sesionDe: (req) => (req.headers['x-quien'] ? { correo: String(req.headers['x-quien']) } : null) });
  const srv = app.listen(0, '127.0.0.1');
  const listo = new Promise((r) => srv.once('listening', r));
  const pedir = async (ruta: string, quien: string, cuerpo?: unknown) => {
    await listo;
    const r = await fetch(`http://127.0.0.1:${(srv.address() as AddressInfo).port}${ruta}`, {
      method: cuerpo ? 'POST' : 'GET',
      headers: { 'content-type': 'application/json', 'x-quien': quien, 'x-aura-estados': 'respondida' },
      body: cuerpo ? JSON.stringify(cuerpo) : undefined,
    });
    return { status: r.status, json: (await r.json()) as any };
  };
  return { pedir, cerrar: () => srv.close() };
}

const esIndice = (clave: string) => clave.includes('/tareas/indice/');

/** «0 tareas» (o una lista sin la tarea) presentada como éxito completo. */
function exitoCompletoSin(r: { status: number; json: any }, id: string): boolean {
  return r.status === 200 && r.json?.completo !== false && !(r.json?.tareas || []).some((t: any) => t.id === id);
}

test('el índice no se puede escribir al crear: nunca «creada» y luego invisible como lista completa', async () => {
  await conS3Falso(async (s3) => {
    const h = arnes();
    const yo = 'indice-escritura@ejemplo.test';
    try {
      s3.fallaEscritura.si = esIndice;
      const crear = await h.pedir('/api/trabajos', yo, { requestId: 'indice-falla-0001', titulo: 'No me pierdas' });
      s3.fallaEscritura.si = null;
      const lista = await h.pedir('/api/trabajos', yo);
      if (crear.status === 200 || crear.status === 201) {
        // Si se dijo «creada», tiene que poder descubrirse (o la lista tiene que admitir que está incompleta).
        assert.ok(!exitoCompletoSin(lista, crear.json.tarea.id), `creada (${crear.status}) pero la lista dice éxito completo sin ella: ${JSON.stringify(lista.json)}`);
      } else {
        assert.equal(crear.status, 503, 'si no se pudo anotar, lo dice con un error de almacén');
        assert.equal(crear.json.code, 'almacen_no_disponible');
      }
      // El reintento del mismo pedido, con el almacén sano, deja la tarea creada Y visible.
      const otra = await h.pedir('/api/trabajos', yo, { requestId: 'indice-falla-0001', titulo: 'No me pierdas' });
      assert.ok(otra.status === 200 || otra.status === 201, JSON.stringify(otra.json));
      const despues = await h.pedir('/api/trabajos', yo);
      assert.equal(despues.status, 200);
      assert.equal(despues.json.completo, true);
      assert.ok(despues.json.tareas.some((t: any) => t.id === otra.json.tarea.id), 'el reintento la deja en la lista');
      assert.equal(despues.json.tareas.filter((t: any) => t.id === otra.json.tarea.id).length, 1, 'una sola vez');
    } finally {
      h.cerrar();
    }
  });
});

test('un objeto de tarea que no se puede leer: la lista no es «0 tareas» como éxito; la lectura directa dice 503', async () => {
  await conS3Falso(async (s3) => {
    const h = arnes();
    const yo = 'objeto-lectura@ejemplo.test';
    try {
      const crear = await h.pedir('/api/trabajos', yo, { requestId: 'objeto-falla-0001', titulo: 'Se vuelve ilegible' });
      assert.equal(crear.status, 201);
      const id = crear.json.tarea.id;
      s3.fallaLectura.si = (clave) => clave.endsWith(`/${id}.json`);
      const lista = await h.pedir('/api/trabajos', yo);
      assert.ok(!exitoCompletoSin(lista, id), `la lista escondió la tarea como éxito completo: ${lista.status} ${JSON.stringify(lista.json)}`);
      if (lista.status === 200) {
        assert.equal(lista.json.completo, false);
        assert.ok(lista.json.aviso, 'dice qué faltó');
        assert.ok(lista.json.conteo.noLeidas >= 1);
      } else assert.equal(lista.status, 503);
      assert.equal((await h.pedir(`/api/trabajos/${id}`, yo)).status, 503);
      // Con otra tarea legible, la lista la muestra y avisa de la que no pudo leer.
      s3.fallaLectura.si = null;
      const legible = await h.pedir('/api/trabajos', yo, { requestId: 'objeto-falla-0002', titulo: 'Esta sí se lee' });
      s3.fallaLectura.si = (clave) => clave.endsWith(`/${id}.json`);
      const parcial = await h.pedir('/api/trabajos', yo);
      assert.equal(parcial.status, 200);
      assert.equal(parcial.json.completo, false);
      assert.ok(parcial.json.tareas.some((t: any) => t.id === legible.json.tarea.id));
      s3.fallaLectura.si = null;
      const sana = await h.pedir('/api/trabajos', yo);
      assert.equal(sana.json.completo, true);
      assert.equal(sana.json.tareas.length, 2);
    } finally {
      h.cerrar();
    }
  });
});

test('41 tareas activas: todas se descubren (lista de siempre y por páginas con cursor) y el conteo es honesto', async () => {
  await conS3Falso(async () => {
    const h = arnes();
    const yo = 'capacidad@ejemplo.test';
    try {
      const ids: string[] = [];
      for (let i = 0; i < 41; i++) {
        const r = await h.pedir('/api/trabajos', yo, { requestId: `activa-cap-${String(i).padStart(4, '0')}`, titulo: `Tarea sin terminar ${i}` });
        assert.equal(r.status, 201);
        ids.push(r.json.tarea.id);
      }
      const primera = (await h.pedir(`/api/trabajos/${ids[0]}`, yo)).json.tarea;
      assert.equal(primera.state, 'queued');
      // Cliente de siempre (sin parámetros): ninguna activa queda fuera.
      const todas = await h.pedir('/api/trabajos', yo);
      assert.equal(todas.status, 200);
      const vistos = new Set(todas.json.tareas.map((t: any) => t.id));
      assert.ok(vistos.has(ids[0]), 'la primera (todavía queued) sale en la lista');
      assert.equal(ids.filter((x) => vistos.has(x)).length, 41);
      assert.equal(todas.json.completo, true);
      assert.equal(todas.json.conteo.activas, 41, 'conteo honesto de activas');
      // Por páginas: el cursor recorre todas sin repetir ni perder.
      const porPaginas: string[] = [];
      let cursor: string | null = null;
      for (let vuelta = 0; vuelta < 10; vuelta++) {
        const p: { status: number; json: any } = await h.pedir(`/api/trabajos?limite=15${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`, yo);
        assert.equal(p.status, 200);
        assert.ok(p.json.tareas.length <= 15);
        porPaginas.push(...p.json.tareas.map((t: any) => t.id));
        cursor = p.json.siguiente;
        if (!cursor) break;
      }
      assert.equal(cursor, null, 'la última página no da cursor');
      assert.equal(new Set(porPaginas).size, porPaginas.length, 'sin repetidas');
      assert.deepEqual(new Set(porPaginas), new Set(ids), 'todas por páginas');
      // Las activas no se pierden aunque haya historial: se cancela una y las 40 restantes siguen.
      const c = await h.pedir(`/api/trabajos/${ids[5]}/cancelar`, yo, {});
      assert.equal(c.status, 200);
      assert.equal(c.json.tarea.state, 'cancelled');
      const tras = await h.pedir('/api/trabajos', yo);
      assert.equal(tras.json.conteo.activas, 40);
      assert.ok(tras.json.tareas.some((t: any) => t.id === ids[0]));
    } finally {
      h.cerrar();
    }
  });
});

test('almacén sano: lista completa, forma de siempre para el cliente viejo, y pausar/reanudar/cancelar funcionan', async () => {
  await conS3Falso(async () => {
    const h = arnes();
    const yo = 'sano@ejemplo.test';
    try {
      const crear = await h.pedir('/api/trabajos', yo, { requestId: 'sano-control-0001', titulo: 'Controles sanos' });
      assert.equal(crear.status, 201);
      const id = crear.json.tarea.id;
      const lista = await h.pedir('/api/trabajos', yo);
      assert.equal(lista.status, 200);
      assert.ok(Array.isArray(lista.json.tareas));
      assert.deepEqual(lista.json.resumen, { trabajando: 1, decisiones: 0 });
      assert.equal(lista.json.completo, true);
      assert.equal(lista.json.siguiente, null);
      assert.equal(lista.json.aviso, undefined);
      const p = await h.pedir(`/api/trabajos/${id}/pausar`, yo, {});
      assert.equal(p.status, 200);
      assert.equal(p.json.tarea.state, 'paused');
      const r = await h.pedir(`/api/trabajos/${id}/reanudar`, yo, {});
      assert.equal(r.json.tarea.state, 'queued');
      const c = await h.pedir(`/api/trabajos/${id}/cancelar`, yo, {});
      assert.equal(c.json.tarea.state, 'cancelled');
      const fin = await h.pedir('/api/trabajos', yo);
      assert.equal(fin.json.completo, true);
      assert.ok(fin.json.tareas.some((t: any) => t.id === id && t.state === 'cancelled'), 'la recién terminada sale en recientes');
      assert.equal(fin.json.conteo.activas, 0);
      // Otra cuenta no ve nada de esto.
      const ajena = await h.pedir('/api/trabajos', 'ajena@ejemplo.test');
      assert.equal(ajena.json.tareas.length, 0);
      assert.equal(ajena.json.completo, true);
      assert.equal((await h.pedir(`/api/trabajos/${id}`, 'ajena@ejemplo.test')).status, 404);
    } finally {
      h.cerrar();
    }
  });
});
