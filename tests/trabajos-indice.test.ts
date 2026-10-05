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
 * A7 (auditoría del 5-oct): «leí bien la página» no es «el inventario del dueño está reconciliado». Un índice legado al
 * que le falta una entrada (objeto intacto) nunca da 40 de 41 con `completo:true`: el inventario por dueño (enumeración
 * del almacén + comprobación del dueño dentro de cada objeto) la recupera, o la lista dice `reconciliado:false`.
 * Regresiones: 41 sanas, huérfano legado, índice ausente, fallo pasajero, varias páginas, reanudación, repetición,
 * creación concurrente, dueño incorrecto (404 y sin fugas), interruptor, reversión (precisa, sin reaparecer) y disco.
 *
 * S3 condicional sintético (tests/s3-condicional-falso.ts): nada sale de la máquina.
 */
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import type { AddressInfo } from 'node:net';
import { _usarAlmacenDurable, almacenDisco, almacenEnMemoria, huellaDueno, type AlmacenDurable } from '../lib/durable';
import {
  crearTarea,
  diagnosticarInventarioTareas,
  ESQUEMA_INVENTARIO,
  leerRespaldoIndiceTareas,
  listarTareas,
  listarTareasPagina,
  MAX_HISTORIAL_INDICE,
  _olvidarEsperasListado,
  asegurarEnIndice,
  reconciliarInventarioTareas,
  revertirReconciliacionTareas,
  reactivarReconciliacionTareas,
  cambiarTarea,
} from '../lib/tareas-durables';
import { montarRutasTrabajos } from '../server/trabajos';
import { conS3Falso, type S3Falso } from './s3-condicional-falso';

afterEach(() => {
  _usarAlmacenDurable(null);
  _olvidarEsperasListado();
});

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

/* ------------------------------------------------------------------ A7 (auditoría del 5-oct): inventario reconciliado */

const claveIndiceS3 = (quien: string) => `/ultron/durable/tareas/indice/${huellaDueno(quien)}/lista.json`;
const carpetaS3 = (quien: string) => `/ultron/durable/tareas/${huellaDueno(quien)}/`;
let serieLegado = 0;
function leerIndice(s3: S3Falso, quien: string): any {
  const v = s3.objetos.get(claveIndiceS3(quien));
  return v ? JSON.parse(v.cuerpo) : null;
}
function escribirIndice(s3: S3Falso, quien: string, ix: unknown) {
  s3.objetos.set(claveIndiceS3(quien), { cuerpo: JSON.stringify(ix), etag: `"legado${++serieLegado}"` });
}
/** Un índice v1 (de antes de P5/A7): solo `{id, t}`, sin `fin` ni marca de inventario, y sin las entradas de `quitar`. */
function indiceLegado(s3: S3Falso, quien: string, quitar: string[]) {
  const ix = leerIndice(s3, quien);
  escribirIndice(s3, quien, { v: 1, ids: ix.ids.filter((x: any) => !quitar.includes(x.id)).map((x: any) => ({ id: x.id, t: x.t })) });
}
/** Un objeto de tarea como los de antes de A7: sin la huella del dueño dentro. */
function objetoLegado(s3: S3Falso, quien: string, id: string) {
  const k = `${carpetaS3(quien)}${id}.json`;
  const v = s3.objetos.get(k)!;
  const { dueno: _fuera, ...resto } = JSON.parse(v.cuerpo);
  s3.objetos.set(k, { cuerpo: JSON.stringify(resto), etag: `"legado${++serieLegado}"` });
}
const objetosDe = (s3: S3Falso, quien: string) => [...s3.objetos.keys()].filter((k) => k.startsWith(carpetaS3(quien))).length;

async function crearVarias(h: ReturnType<typeof arnes>, quien: string, n: number, pre: string): Promise<string[]> {
  const ids: string[] = [];
  for (let i = 0; i < n; i++) {
    const r = await h.pedir('/api/trabajos', quien, { requestId: `${pre}-${String(i).padStart(4, '0')}`, titulo: `Tarea ${pre} ${i}` });
    assert.equal(r.status, 201, JSON.stringify(r.json));
    ids.push(r.json.tarea.id);
  }
  return ids;
}

async function conEntorno<T>(valor: string | undefined, f: () => Promise<T>): Promise<T> {
  const antes = process.env.AURA_RECONCILIAR_TAREAS;
  if (valor === undefined) delete process.env.AURA_RECONCILIAR_TAREAS;
  else process.env.AURA_RECONCILIAR_TAREAS = valor;
  try {
    return await f();
  } finally {
    if (antes === undefined) delete process.env.AURA_RECONCILIAR_TAREAS;
    else process.env.AURA_RECONCILIAR_TAREAS = antes;
  }
}

test('A7 (repro exacta): índice v1 sin la entrada de UNA de 41 tareas, objeto intacto → nunca «40 de 41 con completo:true»; el inventario la recupera sin conocer su id', async () => {
  await conS3Falso(async (s3) => {
    const h = arnes();
    const yo = 'legado-41@ejemplo.test';
    try {
      const ids = await crearVarias(h, yo, 41, 'leg41');
      const sana = await h.pedir('/api/trabajos', yo);
      assert.equal(sana.json.tareas.length, 41);
      assert.equal(sana.json.completo, true);
      const perdida = ids[17];
      indiceLegado(s3, yo, [perdida]);
      const lista = await h.pedir('/api/trabajos', yo);
      assert.equal(lista.status, 200);
      const n = lista.json.tareas.length;
      assert.ok(!(n === 40 && lista.json.completo === true), `garantía falsa: ${n} de 41 con completo:true`);
      // Con el inventario (por omisión: solo agrega), las 41, sin que nadie dé el id que faltaba.
      assert.equal(n, 41, `el inventario encontró la que faltaba (${lista.json.inventario?.estado})`);
      assert.ok(lista.json.tareas.some((t: any) => t.id === perdida));
      assert.equal(lista.json.completo, true);
      assert.equal(lista.json.reconciliado, true);
      assert.equal(lista.json.inventario.estado, 'reconciliado');
      assert.equal(lista.json.conteo.activas, 41);
      assert.equal(lista.json.aviso, undefined);
      // Lo agregado es reversible: su entrada va marcada y el índice v1 de antes quedó respaldado.
      const ix = leerIndice(s3, yo);
      assert.deepEqual(ix.ids.filter((x: any) => x.rec).map((x: any) => x.id), [perdida]);
      assert.equal(ix.inventario.v, ESQUEMA_INVENTARIO);
      assert.equal(ix.pase, undefined, 'recorrido terminado: sin avance colgando');
      const resp = await leerRespaldoIndiceTareas(yo);
      assert.ok(resp.ok && resp.valor, 'respaldo del índice de antes');
      if (resp.ok && resp.valor) {
        assert.equal(resp.valor.indice?.v, 1);
        assert.equal(resp.valor.indice?.ids.length, 40);
      }
      assert.equal(objetosDe(s3, yo), 41, 'no se borró ni se creó ningún objeto de tarea');
      // La protección por dueño sigue: otro dueño, 404; el dueño, 200.
      assert.equal((await h.pedir(`/api/trabajos/${perdida}`, 'otra-cuenta@ejemplo.test')).status, 404);
      assert.equal((await h.pedir(`/api/trabajos/${perdida}`, yo)).status, 200);
    } finally {
      h.cerrar();
    }
  });
});

test('A7: interruptor apagado o en diagnóstico → no se fabrica la garantía (completo:false, reconciliado:false, aviso, 200); diagnóstico no escribe nada', async () => {
  await conS3Falso(async (s3) => {
    const h = arnes();
    const yo = 'interruptor@ejemplo.test';
    try {
      const ids = await crearVarias(h, yo, 5, 'intr');
      await h.pedir('/api/trabajos', yo);
      indiceLegado(s3, yo, [ids[2]]);
      await conEntorno('off', async () => {
        const l = await h.pedir('/api/trabajos', yo);
        assert.equal(l.status, 200);
        assert.equal(l.json.tareas.length, 4, 'las válidas se muestran');
        assert.equal(l.json.completo, false);
        assert.equal(l.json.reconciliado, false);
        assert.equal(l.json.inventario.estado, 'apagado');
        assert.match(l.json.aviso, /puede faltar alguna/);
      });
      await conEntorno('diagnostico', async () => {
        const antes = s3.puts();
        const l = await h.pedir('/api/trabajos', yo);
        assert.equal(l.status, 200);
        assert.equal(l.json.tareas.length, 4);
        assert.equal(l.json.completo, false);
        assert.equal(l.json.inventario.estado, 'diagnostico');
        const d = await diagnosticarInventarioTareas(yo);
        assert.ok(d.ok);
        if (d.ok) {
          assert.deepEqual(
            d.propuesta.map((x) => x.id),
            [ids[2]],
            'la propuesta: solo la que falta'
          );
          assert.equal(d.enIndice, 4);
          assert.equal(d.reconciliado, false);
          assert.equal(d.agotado, true);
        }
        assert.equal(s3.puts(), antes, 'diagnóstico: ni índice, ni respaldo, ni avance');
        assert.equal(leerIndice(s3, yo).v, 1, 'el índice legado sigue tal cual');
      });
      const l = await h.pedir('/api/trabajos', yo);
      assert.equal(l.json.tareas.length, 5);
      assert.equal(l.json.completo, true);
    } finally {
      h.cerrar();
    }
  });
});

test('A7: objeto huérfano legado (sin huella dentro) se adopta solo con la reserva de su pedido; sin ella queda sin verificar y no se promete nada', async () => {
  await conS3Falso(async (s3) => {
    const h = arnes();
    const yo = 'huerfano@ejemplo.test';
    try {
      const ids = await crearVarias(h, yo, 4, 'huer');
      await h.pedir('/api/trabajos', yo);
      objetoLegado(s3, yo, ids[0]);
      objetoLegado(s3, yo, ids[1]);
      indiceLegado(s3, yo, [ids[0], ids[1]]);
      // ids[1]: además se perdió la reserva de su pedido → no hay segunda constancia de que sea suya.
      const pedido = [...s3.objetos.keys()].find((k) => k.includes(`/tareas/pedidos/${huellaDueno(yo)}/`) && JSON.parse(s3.objetos.get(k)!.cuerpo).id === ids[1])!;
      s3.objetos.delete(pedido);
      const l = await h.pedir('/api/trabajos', yo);
      assert.equal(l.status, 200);
      const vistos = l.json.tareas.map((t: any) => t.id);
      assert.ok(vistos.includes(ids[0]), 'el legado con su pedido se recupera');
      assert.ok(!vistos.includes(ids[1]), 'sin constancia de dueño no se adopta');
      assert.equal(l.json.completo, false);
      assert.equal(l.json.reconciliado, false);
      assert.equal(l.json.inventario.estado, 'sin-verificar');
      assert.ok(l.json.aviso);
      assert.equal(leerIndice(s3, yo).inventario, undefined, 'sin marca');
      // Repetir no relista en cada lectura (espera antes de reintentar) y sigue honesto.
      const listados = s3.listados();
      const otra = await h.pedir('/api/trabajos', yo);
      assert.equal(s3.listados(), listados);
      assert.equal(otra.json.completo, false);
    } finally {
      h.cerrar();
    }
  });
});

test('A7: índice ausente → se reconstruye desde el inventario (activas y terminadas); con el listado caído, 200 vacío pero NO «completo»', async () => {
  await conS3Falso(async (s3) => {
    const h = arnes();
    const yo = 'sin-indice@ejemplo.test';
    try {
      const ids = await crearVarias(h, yo, 6, 'sinix');
      assert.equal((await h.pedir(`/api/trabajos/${ids[3]}/cancelar`, yo, {})).status, 200);
      s3.objetos.delete(claveIndiceS3(yo));
      s3.fallaListado.si = () => true;
      const caida = await h.pedir('/api/trabajos', yo);
      assert.equal(caida.status, 200, 'leer el índice (ausente) no falló: no es 503');
      assert.equal(caida.json.tareas.length, 0);
      assert.equal(caida.json.completo, false, 'vacío, pero no «eso es todo»');
      assert.equal(caida.json.reconciliado, false);
      assert.equal(caida.json.inventario.estado, 'error');
      assert.ok(caida.json.aviso);
      s3.fallaListado.si = null;
      // Revisión 13: el fallo se recuerda unos minutos (no se vuelve a listar en cada lectura); pasados, se completa.
      _olvidarEsperasListado();
      const l = await h.pedir('/api/trabajos', yo);
      assert.equal(l.status, 200);
      assert.deepEqual(new Set(l.json.tareas.map((t: any) => t.id)), new Set(ids));
      assert.equal(l.json.completo, true);
      assert.equal(l.json.conteo.activas, 5);
      assert.equal(l.json.conteo.terminadas, 1);
      const ix = leerIndice(s3, yo);
      assert.ok(ix.ids.find((x: any) => x.id === ids[3]).fin, 'la cancelada vuelve como historial');
      const resp = await leerRespaldoIndiceTareas(yo);
      assert.ok(resp.ok && resp.valor && resp.valor.indice === null, 'respaldo: no había índice');
    } finally {
      h.cerrar();
    }
  });
});

test('A7: fallo pasajero del almacén (listado o lectura de un huérfano) conserva la incertidumbre; al sanar, se completa', async () => {
  await conS3Falso(async (s3) => {
    const h = arnes();
    const yo = 'pasajero@ejemplo.test';
    try {
      const ids = await crearVarias(h, yo, 5, 'pasa');
      await h.pedir('/api/trabajos', yo);
      indiceLegado(s3, yo, [ids[4]]);
      s3.fallaListado.si = () => true;
      const a = await h.pedir('/api/trabajos', yo);
      assert.equal(a.status, 200);
      assert.equal(a.json.tareas.length, 4);
      assert.equal(a.json.completo, false);
      assert.equal(a.json.inventario.estado, 'error');
      s3.fallaListado.si = null;
      _olvidarEsperasListado(); // revisión 13: como si hubieran pasado los minutos de espera tras el listado fallido
      s3.fallaLectura.si = (clave) => clave.endsWith(`/${ids[4]}.json`);
      const b = await h.pedir('/api/trabajos', yo);
      assert.equal(b.json.tareas.length, 4);
      assert.equal(b.json.completo, false, 'un huérfano que no se pudo leer no se da por inexistente');
      assert.equal(leerIndice(s3, yo).inventario, undefined, 'sin marca tras un fallo intermedio');
      s3.fallaLectura.si = null;
      const c = await h.pedir('/api/trabajos', yo);
      assert.equal(c.json.tareas.length, 5);
      assert.equal(c.json.completo, true);
    } finally {
      h.cerrar();
    }
  });
});

test('A7: más de una página de inventario y reanudación tras interrupción: avance verificable en el índice, sin perder ni repetir', async () => {
  await conS3Falso(async (s3) => {
    const h = arnes();
    const yo = 'paginas@ejemplo.test';
    try {
      const ids = await crearVarias(h, yo, 30, 'pag');
      await h.pedir('/api/trabajos', yo);
      const quitadas = ids.filter((_, i) => i % 3 !== 0); // 20 de 30 fuera del índice
      indiceLegado(s3, yo, quitadas);
      const listadosAntes = s3.listados();
      const presupuesto = { porListado: 4, listados: 2, lecturas: 6 };
      const pasos: string[] = [];
      let ronda: string | null = null;
      let desdeAntes: string | null = null;
      for (let vuelta = 0; vuelta < 40; vuelta++) {
        // En la tercera vuelta, un huérfano que todavía no se revisó no se puede leer (interrupción a mitad).
        s3.fallaLectura.si = null;
        if (vuelta === 2) {
          const pendiente = quitadas.find((id) => !leerIndice(s3, yo).ids.some((x: any) => x.id === id))!;
          s3.fallaLectura.si = (clave) => clave.endsWith(`/${pendiente}.json`);
        }
        const r = await reconciliarInventarioTareas(yo, { presupuesto });
        pasos.push(r.estado);
        const ix = leerIndice(s3, yo);
        if (r.estado === 'reconciliado') break;
        assert.notEqual(r.estado, 'sin-verificar');
        if (ix.pase) {
          ronda ??= ix.pase.ronda;
          assert.equal(ix.pase.ronda, ronda, 'la misma ronda se reanuda');
          if (desdeAntes) assert.ok(ix.pase.desde >= desdeAntes, 'el avance no retrocede');
          desdeAntes = ix.pase.desde;
        }
        assert.equal(ix.inventario, undefined, 'sin marca a medias');
      }
      s3.fallaLectura.si = null;
      assert.equal(pasos.at(-1), 'reconciliado', pasos.join(','));
      assert.ok(pasos.length > 3, `varios pasos: ${pasos.join(',')}`);
      assert.equal(pasos[2], 'error', `la interrupción se nota: ${pasos.join(',')}`);
      const ix = leerIndice(s3, yo);
      assert.equal(ix.ids.length, 30);
      assert.equal(new Set(ix.ids.map((x: any) => x.id)).size, 30, 'sin repetidas');
      assert.equal(ix.ids.filter((x: any) => x.rec).length, 20);
      assert.equal(ix.inventario.revisadas, 30);
      assert.equal(ix.inventario.agregadas, 20);
      assert.ok(s3.listados() - listadosAntes > 7, 'el inventario se leyó en varias páginas de S3');
      // La lista por páginas (cursor) recorre las 30, completa en cada página.
      const vistos: string[] = [];
      let cursor: string | null = null;
      for (let v = 0; v < 10; v++) {
        const p: { status: number; json: any } = await h.pedir(`/api/trabajos?limite=7${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`, yo);
        assert.equal(p.status, 200);
        assert.equal(p.json.completo, true);
        vistos.push(...p.json.tareas.map((t: any) => t.id));
        cursor = p.json.siguiente;
        if (!cursor) break;
      }
      assert.equal(vistos.length, 30);
      assert.deepEqual(new Set(vistos), new Set(ids));
    } finally {
      h.cerrar();
    }
  });
});

test('A7: reconciliación repetida es idempotente (sin escrituras ni duplicados); si un servidor viejo borra la marca, se rehace igual', async () => {
  await conS3Falso(async (s3) => {
    const h = arnes();
    const yo = 'repetida@ejemplo.test';
    try {
      const ids = await crearVarias(h, yo, 8, 'rep');
      await h.pedir('/api/trabajos', yo);
      indiceLegado(s3, yo, [ids[1], ids[6]]);
      assert.equal((await reconciliarInventarioTareas(yo)).estado, 'reconciliado');
      const antes = s3.puts();
      const otra = await reconciliarInventarioTareas(yo);
      assert.deepEqual(otra, { estado: 'reconciliado', escribio: false, agregadas: 0 });
      const l = await h.pedir('/api/trabajos', yo);
      assert.equal(l.json.tareas.length, 8);
      assert.equal(s3.puts(), antes, 'repetir no escribe');
      // Un servidor de antes reescribe el índice como {v:2, ids} (sin la marca): se vuelve a reconciliar, sin duplicar.
      const ix = leerIndice(s3, yo);
      escribirIndice(s3, yo, { v: 2, ids: ix.ids });
      const r = await reconciliarInventarioTareas(yo);
      assert.equal(r.estado, 'reconciliado');
      assert.equal(r.agregadas, 0);
      const fin = leerIndice(s3, yo);
      assert.equal(fin.ids.length, 8);
      assert.equal(new Set(fin.ids.map((x: any) => x.id)).size, 8);
      const resp = await leerRespaldoIndiceTareas(yo);
      assert.ok(resp.ok && resp.valor && resp.valor.indice?.ids.length === 6, 'el respaldo es el del primer cambio (crear una vez)');
    } finally {
      h.cerrar();
    }
  });
});

test('A7: creación concurrente durante la reconciliación: la fusión CAS conserva la tarea nueva (nunca una foto que la borre)', async () => {
  await conS3Falso(async (s3) => {
    const h = arnes();
    const yo = 'concurrente@ejemplo.test';
    try {
      const ids = await crearVarias(h, yo, 10, 'conc');
      await h.pedir('/api/trabajos', yo);
      indiceLegado(s3, yo, [ids[0], ids[4], ids[9]]);
      let nueva: string | null = null;
      s3.alListar.f = async () => {
        if (nueva) return;
        nueva = 'pendiente';
        const c = await crearTarea(yo, { requestId: 'concurrente-nueva-0001', titulo: 'Nació durante el inventario', estado: 'queued', entorno: { kind: 'chat', id: 'api', displayName: 'AURA' }, origen: { kind: 'api' } });
        assert.ok(c.ok);
        if (c.ok) nueva = c.tarea.id;
      };
      // Dos lecturas a la vez (dos réplicas) mientras nace otra tarea.
      const [x, y] = await Promise.all([h.pedir('/api/trabajos', yo), h.pedir('/api/trabajos', yo)]);
      s3.alListar.f = null;
      assert.equal(x.status, 200);
      assert.equal(y.status, 200);
      const l = await h.pedir('/api/trabajos', yo);
      assert.equal(l.json.completo, true);
      const vistos = new Set(l.json.tareas.map((t: any) => t.id));
      assert.ok(nueva && vistos.has(nueva), 'la creada durante el inventario sigue en el índice');
      for (const id of ids) assert.ok(vistos.has(id), `falta ${id}`);
      assert.equal(l.json.tareas.length, 11);
      const ix = leerIndice(s3, yo);
      assert.equal(new Set(ix.ids.map((e: any) => e.id)).size, ix.ids.length, 'sin duplicados');
      assert.ok(!ix.ids.find((e: any) => e.id === nueva).rec, 'la nueva la anotó su creación, no el inventario');
    } finally {
      h.cerrar();
    }
  });
});

test('A7: dueño incorrecto → 404, y ni la lista, ni el conteo, ni el log dejan ver títulos, ids ni cuántas tiene otro', async () => {
  await conS3Falso(async (s3) => {
    const h = arnes();
    const ana = 'ana-privada@ejemplo.test';
    const beto = 'beto@ejemplo.test';
    const log: string[] = [];
    const orig = { warn: console.warn, log: console.log, error: console.error };
    try {
      const ids = await crearVarias(h, ana, 3, 'ana');
      const titulo = 'Tarea ana 1';
      // Un objeto de Ana que acaba (por un error de almacenamiento) en la carpeta de Beto, con su huella dentro.
      const original = s3.objetos.get(`${carpetaS3(ana)}${ids[1]}.json`)!;
      s3.objetos.set(`${carpetaS3(beto)}${ids[1]}.json`, { cuerpo: original.cuerpo, etag: '"copia1"' });
      for (const k of ['warn', 'log', 'error'] as const) console[k] = (...a: unknown[]) => void log.push(a.map(String).join(' '));
      const b = await h.pedir('/api/trabajos', beto);
      assert.equal(b.status, 200);
      assert.deepEqual(b.json.tareas, []);
      assert.deepEqual(b.json.conteo, { activas: 0, terminadas: 0, indice: 0, noLeidas: 0, recortadas: 0 });
      assert.equal(b.json.completo, true, 'lo de otro dueño (con su huella) se descarta: el inventario de Beto está completo');
      assert.equal((await h.pedir(`/api/trabajos/${ids[1]}`, beto)).status, 404, 'ni aunque el objeto esté en su carpeta');
      assert.equal((await h.pedir(`/api/trabajos/${ids[0]}`, beto)).status, 404);
      assert.equal((await h.pedir(`/api/trabajos/${ids[1]}/cancelar`, beto, {})).status, 404);
      // Una copia legada (sin huella dentro, sin pedido de ese dueño): no se adopta; queda sin reconciliar, sin detalles.
      const cajon = 'cajon@ejemplo.test';
      const sinHuella = JSON.parse(original.cuerpo);
      delete sinHuella.dueno;
      s3.objetos.set(`${carpetaS3(cajon)}${ids[1]}.json`, { cuerpo: JSON.stringify(sinHuella), etag: '"copia2"' });
      const c = await h.pedir('/api/trabajos', cajon);
      assert.equal(c.status, 200);
      assert.deepEqual(c.json.tareas, []);
      assert.deepEqual(c.json.conteo, { activas: 0, terminadas: 0, indice: 0, noLeidas: 0, recortadas: 0 });
      assert.equal(c.json.completo, false);
      assert.equal(c.json.inventario.estado, 'sin-verificar');
      for (const r of [b, c]) {
        const texto = JSON.stringify(r.json);
        for (const x of [...ids, titulo, ana, huellaDueno(ana)]) assert.ok(!texto.includes(x), `la respuesta deja ver ${x}`);
      }
      const todo = log.join('\n');
      for (const x of [...ids, titulo, ana, huellaDueno(ana), huellaDueno(beto)]) assert.ok(!todo.includes(x), `el log deja ver ${x}`);
      Object.assign(console, orig);
      // Ana sigue viendo las suyas, completas.
      const a = await h.pedir('/api/trabajos', ana);
      assert.equal(a.json.tareas.length, 3);
      assert.equal(a.json.completo, true);
    } finally {
      Object.assign(console, orig);
      h.cerrar();
    }
  });
});

test('A7: reversión: quita solo lo que agregó el inventario, conserva el respaldo y los objetos; no se rehace sola (ni con el interruptor encendido) hasta que operación la reactiva', async () => {
  await conS3Falso(async (s3) => {
    const h = arnes();
    const yo = 'revertir@ejemplo.test';
    try {
      const ids = await crearVarias(h, yo, 5, 'rev');
      // La que se pierde ya terminó (historial): una activa sería trabajo vivo y la reversión no la quita (H4).
      assert.equal((await h.pedir(`/api/trabajos/${ids[3]}/cancelar`, yo, {})).status, 200);
      await h.pedir('/api/trabajos', yo);
      indiceLegado(s3, yo, [ids[3]]);
      assert.equal((await h.pedir('/api/trabajos', yo)).json.tareas.length, 5);
      await conEntorno('off', async () => {
        const r = await revertirReconciliacionTareas(yo);
        assert.ok(r.ok);
        if (r.ok) assert.deepEqual([r.quitadas, r.conservadas, r.pendientes], [1, 0, 0]);
        const ix = leerIndice(s3, yo);
        assert.equal(ix.inventario, undefined);
        assert.equal(ix.ids.length, 4);
        assert.ok(!ix.ids.some((x: any) => x.id === ids[3]));
        assert.equal(objetosDe(s3, yo), 5, 'ningún objeto borrado');
        const resp = await leerRespaldoIndiceTareas(yo);
        assert.ok(resp.ok && resp.valor && resp.valor.indice?.ids.length === 4);
        const l = await h.pedir('/api/trabajos', yo);
        assert.equal(l.json.tareas.length, 4);
        assert.equal(l.json.completo, false, 'revertido: vuelve a ser honesto, no completo');
        assert.equal((await revertirReconciliacionTareas(yo)).ok, true, 'revertir otra vez no rompe nada');
      });
      // Revisión externa (a46b496): antes, con el interruptor encendido, la siguiente lectura volvía a agregar lo revertido.
      const otra = await h.pedir('/api/trabajos', yo);
      assert.equal(otra.json.tareas.length, 4, 'revertida por decisión: la siguiente lectura no la vuelve a agregar');
      assert.equal(otra.json.completo, false);
      assert.equal(otra.json.inventario.estado, 'revertido');
      assert.equal(objetosDe(s3, yo), 5);
      const re = await reactivarReconciliacionTareas(yo);
      assert.ok(re.ok && re.reactivado);
      const tras = await h.pedir('/api/trabajos', yo);
      assert.equal(tras.json.tareas.length, 5, 'reactivada por operación, se reconcilia otra vez');
      assert.equal(tras.json.completo, true);
    } finally {
      h.cerrar();
    }
  });
});

test('A7: el disco también inventaría (readdir) por dueño; un almacén sin enumeración se queda honesto («sin-fuente»)', async () => {
  const fs = await import('node:fs');
  const os = await import('node:os');
  const path = await import('node:path');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aura-a7-'));
  try {
    const disco = almacenDisco(dir);
    const yo = 'disco@ejemplo.test';
    const ids: string[] = [];
    for (let i = 0; i < 4; i++) {
      const c = await crearTarea(yo, { requestId: `disco-${i}`, titulo: `En disco ${i}`, estado: 'queued', entorno: { kind: 'chat', id: 'api', displayName: 'AURA' }, origen: { kind: 'api' } }, { almacen: disco });
      assert.ok(c.ok);
      if (c.ok) ids.push(c.tarea.id);
    }
    await crearTarea('otra@ejemplo.test', { requestId: 'disco-otra', titulo: 'De otra', entorno: { kind: 'chat', id: 'api', displayName: 'AURA' }, origen: { kind: 'api' } }, { almacen: disco });
    const archivo = path.join(dir, 'tareas', 'indice', huellaDueno(yo), 'lista.json');
    const ix = JSON.parse(fs.readFileSync(archivo, 'utf8'));
    fs.writeFileSync(archivo, JSON.stringify({ v: 1, ids: ix.ids.filter((x: any) => x.id !== ids[2]).map((x: any) => ({ id: x.id, t: x.t })) }));
    // Un temporal a medias en la carpeta no es un objeto.
    fs.writeFileSync(path.join(dir, 'tareas', huellaDueno(yo), `${ids[0]}.json.123.abc.tmp`), '{');
    const p = await listarTareasPagina(yo, {}, disco);
    assert.ok(p.ok);
    if (p.ok) {
      assert.deepEqual(new Set(p.tareas.map((t) => t.id)), new Set(ids));
      assert.equal(p.completo, true);
      assert.equal(p.reconciliado, true);
    }
    // Sin enumeración (un almacén que solo lee, crea y hace CAS): nunca «completo».
    const sinListar: AlmacenDurable = { tipo: disco.tipo, multiReplica: false, leer: disco.leer, crear: disco.crear, cas: disco.cas };
    fs.writeFileSync(archivo, JSON.stringify({ v: 1, ids: ix.ids.map((x: any) => ({ id: x.id, t: x.t })) }));
    const q = await listarTareasPagina(yo, {}, sinListar);
    assert.ok(q.ok);
    if (q.ok) {
      assert.equal(q.paginaLeida, true);
      assert.equal(q.reconciliado, false);
      assert.equal(q.inventario, 'sin-fuente');
      assert.equal(q.completo, false);
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

/* ------------------------------------------------------------------ revisión 13 */

const NUEVA = { entorno: { kind: 'chat' as const, id: 'api', displayName: 'AURA' }, origen: { kind: 'api' as const } };
const MIN = 60_000;

/** Un almacén en memoria cuyo listado se puede negar (como S3 sin `s3:ListBucket`) y que cuenta los LIST. */
function memoriaContada() {
  const m = almacenEnMemoria();
  const c = { listados: 0, niega: false };
  const listar = m.listar!.bind(m);
  const a: AlmacenDurable & { objetos: Map<string, string> } = Object.assign(m, {
    listar: async (prefijo: string, o?: { desde?: string | null; max?: number }) => {
      c.listados++;
      return c.niega ? { ok: false as const, detalle: 'S3 403: AccessDenied' } : listar(prefijo, o);
    },
  });
  return { a, c };
}

test('revisión 13 (A7): listado denegado → 21 lecturas de la lista (páginas y la del borrador del chat) hacen UN LIST; se reintenta entre 5 y 15 min, y mientras tanto es honesta', async () => {
  const { a, c } = memoriaContada();
  const yo = 'denegado@ejemplo.test';
  const T = 1_800_000_000_000;
  const cr = await crearTarea(yo, { requestId: 'r13-den', titulo: 'Una', ...NUEVA }, { almacen: a, ahora: T });
  assert.ok(cr.ok);
  c.niega = true;
  for (let i = 0; i < 20; i++) {
    const p = await listarTareasPagina(yo, i % 2 ? { limite: 5, ahora: T + i * 3000 } : { ahora: T + i * 3000 }, a);
    assert.ok(p.ok);
    if (p.ok) {
      assert.equal(p.completo, false);
      assert.equal(p.reconciliado, false);
      assert.equal(p.inventario, 'error');
      assert.equal(p.tareas.length, 1, 'lo que hay se ve igual');
    }
  }
  // La ruta del borrador del chat (abrirDecisionDeBorrador) lee con listarTareas: tampoco lista otra vez.
  _usarAlmacenDurable(a);
  const l = await listarTareas(yo, a);
  assert.ok(l.ok && !l.completo && !l.reconciliado);
  assert.equal(c.listados, 1, `21 lecturas → ${c.listados} LIST (antes, 21)`);
  // Antes de 5 min, nada; a los 15 min, se reintenta (una vez) y, si sigue negado, espera otra vez.
  await listarTareasPagina(yo, { ahora: T + 5 * MIN - 1 }, a);
  assert.equal(c.listados, 1);
  await listarTareasPagina(yo, { ahora: T + 15 * MIN + 1 }, a);
  assert.equal(c.listados, 2, 'pasada la espera, se vuelve a intentar');
  await listarTareasPagina(yo, { ahora: T + 15 * MIN + 3000 }, a);
  assert.equal(c.listados, 2);
  // Otro dueño no hereda la espera de este.
  await crearTarea('otro-den@ejemplo.test', { requestId: 'r13-den-2', titulo: 'Otra', ...NUEVA }, { almacen: a, ahora: T });
  await listarTareasPagina('otro-den@ejemplo.test', { ahora: T + 15 * MIN + 3000 }, a);
  assert.equal(c.listados, 3);
  // Al sanar (pasada la espera) se reconcilia; desde ahí, ni un LIST más por mucho que se consulte.
  c.niega = false;
  const sana = await listarTareasPagina(yo, { ahora: T + 31 * MIN }, a);
  assert.ok(sana.ok && sana.completo && sana.reconciliado);
  const tras = c.listados;
  for (let i = 0; i < 20; i++) await listarTareasPagina(yo, { ahora: T + 32 * MIN + i * 3000 }, a);
  assert.equal(c.listados, tras, 'un dueño reconciliado no se vuelve a listar en cada lectura');
  // La operación puede forzar el paso aunque haya espera.
  c.niega = true;
  await crearTarea('forzar@ejemplo.test', { requestId: 'r13-f', titulo: 'F', ...NUEVA }, { almacen: a, ahora: T });
  await reconciliarInventarioTareas('forzar@ejemplo.test', { ahora: T }, a);
  const n = c.listados;
  assert.equal((await reconciliarInventarioTareas('forzar@ejemplo.test', { ahora: T + 1000 }, a)).estado, 'error');
  assert.equal(c.listados, n);
  await reconciliarInventarioTareas('forzar@ejemplo.test', { ahora: T + 2000, forzar: true }, a);
  assert.equal(c.listados, n + 1);
});

/** Crea `n` tareas y las deja TERMINADAS (objeto intacto), como tras días de uso. */
async function terminadas(a: AlmacenDurable & { objetos: Map<string, string> }, yo: string, n: number, T: number): Promise<string[]> {
  const ids: string[] = [];
  for (let i = 0; i < n; i++) {
    const r = await crearTarea(yo, { requestId: `r13-${i}`, titulo: `t${i}`, ...NUEVA }, { almacen: a, ahora: T + i });
    assert.ok(r.ok);
    if (r.ok) ids.push(r.tarea.id);
  }
  const carpeta = `tareas/${huellaDueno(yo)}/`;
  for (const [k, v] of [...a.objetos]) {
    if (!k.startsWith(carpeta)) continue;
    const reg = JSON.parse(v);
    reg.estado = 'completed';
    reg.actualizada = T + 10_000 + Number(String(reg.requestId).slice(4));
    a.objetos.set(k, JSON.stringify(reg));
  }
  return ids;
}

test('revisión 13 (A7): 205 terminadas → el índice guarda 200 y `conteo.recortadas` dice las 5 que el tope dejó fuera (también tras rehacer el índice); con alguna, la ruta lo avisa aunque esté completa', async () => {
  const T = Date.now() - 3_600_000;
  // 1) Índice perdido: el inventario lo rehace con las 205 y el tope deja 200.
  {
    const a = almacenEnMemoria();
    const yo = 'legado-cap@ejemplo.test';
    await terminadas(a, yo, MAX_HISTORIAL_INDICE + 5, T);
    a.objetos.delete(`tareas/indice/${huellaDueno(yo)}/lista`);
    let p: Awaited<ReturnType<typeof listarTareasPagina>> | null = null;
    for (let i = 0; i < 5; i++) p = await listarTareasPagina(yo, { presupuesto: { porListado: 1000, listados: 3, lecturas: 1000 } }, a);
    assert.ok(p && p.ok);
    if (p && p.ok) {
      assert.equal(p.tareas.length, MAX_HISTORIAL_INDICE);
      assert.equal(p.completo, true);
      assert.equal(p.conteo.indice, MAX_HISTORIAL_INDICE);
      assert.equal(p.conteo.recortadas, 5, JSON.stringify(p.conteo));
    }
  }
  // 2) Índice intacto: al saberse terminadas, el recorte se cuenta en la MISMA respuesta; leer por su id una recortada
  //    (vuelve al índice y el tope saca otra) no la cuenta dos veces.
  {
    const a = almacenEnMemoria();
    const yo = 'intacto-cap@ejemplo.test';
    const ids = await terminadas(a, yo, MAX_HISTORIAL_INDICE + 3, T);
    const p = await listarTareasPagina(yo, {}, a);
    assert.ok(p.ok);
    if (p.ok) assert.equal(p.conteo.recortadas, 3, JSON.stringify(p.conteo));
    const q = await listarTareasPagina(yo, {}, a);
    assert.ok(q.ok);
    if (q.ok) {
      assert.equal(q.conteo.indice, MAX_HISTORIAL_INDICE);
      assert.equal(q.conteo.recortadas, 3);
      assert.equal(q.completo, true);
    }
    const vieja = JSON.parse(a.objetos.get(`tareas/${huellaDueno(yo)}/${ids[0]}`)!);
    await asegurarEnIndice(yo, vieja, a);
    const r = await listarTareasPagina(yo, {}, a);
    assert.ok(r.ok);
    if (r.ok) assert.equal(r.conteo.recortadas, 3, 'la que volvió y la que salió no suman');
    // Un dueño sin recortes: 0, no ausente.
    await crearTarea('pocas@ejemplo.test', { requestId: 'r13-p', titulo: 'p', ...NUEVA }, { almacen: a });
    const s = await listarTareasPagina('pocas@ejemplo.test', {}, a);
    assert.ok(s.ok);
    if (s.ok) assert.equal(s.conteo.recortadas, 0);
  }
  // 3) La ruta: `completo: true` con `conteo.recortadas` y un aviso que lo dice; sin recortes, ni aviso.
  {
    const a = almacenEnMemoria();
    _usarAlmacenDurable(a);
    const yo = 'ruta-cap@ejemplo.test';
    await terminadas(a, yo, MAX_HISTORIAL_INDICE + 2, Date.now() - 60_000);
    const h = arnes();
    try {
      await h.pedir('/api/trabajos', yo);
      const r = await h.pedir('/api/trabajos', yo);
      assert.equal(r.status, 200);
      assert.equal(r.json.completo, true);
      assert.equal(r.json.conteo.recortadas, 2);
      assert.match(r.json.aviso, /200 tareas terminadas más recientes: 2 terminadas más antiguas ya no salen/);
      await crearTarea('ruta-pocas@ejemplo.test', { requestId: 'r13-rp', titulo: 'p', ...NUEVA }, { almacen: a });
      const s = await h.pedir('/api/trabajos', 'ruta-pocas@ejemplo.test');
      assert.equal(s.json.completo, true);
      assert.equal(s.json.conteo.recortadas, 0);
      assert.equal(s.json.aviso, undefined);
    } finally {
      h.cerrar();
    }
  }
});

/* ------------------------------------------------------------------ revisión externa sobre a46b496: reversión precisa */

/*
 * «Al revertir la recuperación de tareas, el historial puede quedar incompleto o reaparecer una tarea recuperada.»
 * Regla: la reversión quita del índice SOLO las entradas que agregó el inventario y que no tuvieron actividad después
 * (el objeto no cambió desde que se recuperó); una recuperada que cambió (avanzó, terminó, la cancelaron) ya es historial
 * propio y se queda. Devuelve lo que el recorte del inventario sacó del índice de antes, deja la marca «revertido» en el
 * índice (vale para todas las réplicas) y la reconciliación no vuelve a agregar nada hasta que operación la reactiva.
 */
const HORA = 3_600_000;
const claveIndiceMem = (quien: string) => `tareas/indice/${huellaDueno(quien)}/lista`;
const indiceMem = (a: { objetos: Map<string, string> }, quien: string) => JSON.parse(a.objetos.get(claveIndiceMem(quien)) ?? 'null');
const objetosMem = (a: { objetos: Map<string, string> }, quien: string) => [...a.objetos.keys()].filter((k) => k.startsWith(`tareas/${huellaDueno(quien)}/`)).length;
/** Otra réplica: el mismo almacén, pero otro objeto (otra memoria de proceso: esperas, cachés). */
const otraReplica = (a: AlmacenDurable): AlmacenDurable => ({ ...a });

/**
 * `n` tareas; el índice queda como uno legado (v1) sin las de `perdidas`, y la lista lo reconcilia en T + 1 h. Las perdidas
 * ya TERMINARON antes de recuperarse (historial: lo que la reversión puede quitar), salvo las de `activas`, que siguen
 * activas (trabajo vivo: la reversión no las vuelve a esconder, H4).
 */
async function reconciliadaConPerdidas(a: AlmacenDurable & { objetos: Map<string, string> }, yo: string, n: number, perdidas: number[], T: number, o: { activas?: number[] } = {}): Promise<string[]> {
  const ids: string[] = [];
  for (let i = 0; i < n; i++) {
    const r = await crearTarea(yo, { requestId: `rv-${i}`, titulo: `Tarea ${i}`, ...NUEVA }, { almacen: a, ahora: T + i });
    assert.ok(r.ok);
    if (r.ok) ids.push(r.tarea.id);
  }
  for (const i of perdidas) {
    if (o.activas?.includes(i)) continue;
    const k = `tareas/${huellaDueno(yo)}/${ids[i]}`;
    a.objetos.set(k, JSON.stringify({ ...JSON.parse(a.objetos.get(k)!), estado: 'completed', actualizada: T + n + i }));
  }
  const fuera = new Set(perdidas.map((i) => ids[i]));
  const ix = indiceMem(a, yo);
  a.objetos.set(claveIndiceMem(yo), JSON.stringify({ v: 1, ids: ix.ids.filter((x: any) => !fuera.has(x.id)).map((x: any) => ({ id: x.id, t: x.t })) }));
  const p = await listarTareasPagina(yo, { ahora: T + HORA }, a);
  assert.ok(p.ok && p.reconciliado && p.tareas.length === n, 'el inventario recupera las perdidas');
  return ids;
}

async function conVariable<T>(nombre: string, valor: string | undefined, f: () => Promise<T>): Promise<T> {
  const antes = process.env[nombre];
  if (valor === undefined) delete process.env[nombre];
  else process.env[nombre] = valor;
  try {
    return await f();
  } finally {
    if (antes === undefined) delete process.env[nombre];
    else process.env[nombre] = antes;
  }
}

test('reversión precisa: la recuperada con actividad después se conserva y la que no, sale; lo creado después se queda; el historial queda completo', async () => {
  const a = almacenEnMemoria();
  const yo = 'rv-actividad@ejemplo.test';
  const T = Date.now() - 10 * HORA;
  const ids = await reconciliadaConPerdidas(a, yo, 6, [1, 2, 3], T, { activas: [1, 2] });
  // ids[1]: la cancelan después de recuperada (terminó: es historial). ids[2]: avanza. ids[3]: ya terminada, nadie la toca.
  const c = await cambiarTarea(yo, ids[1], () => ({ estado: 'cancelled' }), { almacen: a, ahora: T + 2 * HORA });
  assert.ok(c.ok && c.cambiado);
  const p = await cambiarTarea(yo, ids[2], () => ({ pasoActual: 'Sigo con esto' }), { almacen: a, ahora: T + 2 * HORA });
  assert.ok(p.ok && p.cambiado);
  const nueva = await crearTarea(yo, { requestId: 'rv-nueva', titulo: 'Creada después', ...NUEVA }, { almacen: a, ahora: T + 3 * HORA });
  assert.ok(nueva.ok);
  const objetos = objetosMem(a, yo);
  const r = await revertirReconciliacionTareas(yo, a, { ahora: T + 4 * HORA });
  assert.ok(r.ok);
  if (r.ok) assert.deepEqual([r.quitadas, r.conservadas, r.pendientes], [1, 2, 0]);
  const ix = indiceMem(a, yo);
  const en = new Set(ix.ids.map((x: any) => x.id));
  const quedan = [ids[0], ids[1], ids[2], ids[4], ids[5], nueva.ok ? nueva.tarea.id : ''];
  for (const id of quedan) assert.ok(en.has(id), `la reversión perdió ${id}: ${JSON.stringify(ix.ids)}`);
  assert.ok(!en.has(ids[3]), 'la recuperada sin actividad sale');
  assert.equal(ix.ids.filter((x: any) => x.rec).length, 0, 'las conservadas ya no llevan la marca del inventario');
  assert.equal(ix.inventario, undefined);
  assert.equal(objetosMem(a, yo), objetos, 'ningún objeto borrado ni creado');
  const l = await listarTareasPagina(yo, { ahora: T + 5 * HORA }, a);
  assert.ok(l.ok);
  if (l.ok) {
    assert.deepEqual(new Set(l.tareas.map((t) => t.id)), new Set(quedan), 'el historial (la cancelada incluida) sigue en la lista');
    assert.equal(l.conteo.indice, 6);
    assert.equal(l.conteo.terminadas, 1);
    assert.equal(l.completo, false);
    assert.equal(l.reconciliado, false);
    assert.equal(l.inventario, 'revertido');
  }
});

test('tras revertir, ninguna lectura vuelve a agregar lo revertido (misma réplica, otra réplica sin memoria, la ruta) aunque el interruptor siga en «agregar»', async () => {
  const a = almacenEnMemoria();
  _usarAlmacenDurable(a);
  const yo = 'rv-reaparece@ejemplo.test';
  const T = Date.now() - 10 * HORA;
  const ids = await reconciliadaConPerdidas(a, yo, 4, [2], T);
  const r = await revertirReconciliacionTareas(yo, a, { ahora: T + 2 * HORA });
  assert.ok(r.ok && r.quitadas === 1);
  for (const alm of [a, otraReplica(a)]) {
    _olvidarEsperasListado();
    const l = await listarTareasPagina(yo, { ahora: T + 3 * HORA }, alm);
    assert.ok(l.ok);
    if (l.ok) {
      assert.ok(!l.tareas.some((t) => t.id === ids[2]), 'la revertida reapareció');
      assert.equal(l.tareas.length, 3);
      assert.equal(l.completo, false);
      assert.equal(l.reconciliado, false);
      assert.equal(l.inventario, 'revertido');
    }
    assert.equal((await reconciliarInventarioTareas(yo, { ahora: T + 3 * HORA, forzar: true }, alm)).estado, 'revertido', 'ni forzando el paso');
  }
  const ix = indiceMem(a, yo);
  assert.ok(!ix.ids.some((x: any) => x.id === ids[2]));
  assert.ok(ix.revertido, 'la marca vive en el índice (la ven todas las réplicas)');
  const h = arnes();
  try {
    const l = await h.pedir('/api/trabajos', yo);
    assert.equal(l.status, 200);
    assert.equal(l.json.completo, false);
    assert.equal(l.json.reconciliado, false);
    assert.equal(l.json.inventario.estado, 'revertido');
    assert.match(l.json.aviso, /se revirtió por decisión/);
    assert.ok(!l.json.tareas.some((t: any) => t.id === ids[2]));
  } finally {
    h.cerrar();
  }
});

test('una réplica que estaba recorriendo el inventario cuando operación revirtió no agrega nada al escribir', async () => {
  const a = almacenEnMemoria();
  const yo = 'rv-carrera@ejemplo.test';
  const T = Date.now() - 10 * HORA;
  const ids: string[] = [];
  for (let i = 0; i < 3; i++) {
    const c = await crearTarea(yo, { requestId: `rv-c-${i}`, titulo: `c${i}`, ...NUEVA }, { almacen: a, ahora: T + i });
    assert.ok(c.ok);
    if (c.ok) ids.push(c.tarea.id);
  }
  const ix = indiceMem(a, yo);
  a.objetos.set(claveIndiceMem(yo), JSON.stringify({ v: 1, ids: ix.ids.filter((x: any) => x.id !== ids[1]).map((x: any) => ({ id: x.id, t: x.t })) }));
  let revertida = false;
  const b: AlmacenDurable = {
    ...a,
    listar: async (prefijo, o) => {
      const l = await a.listar!(prefijo, o);
      // Entre el listado de esta réplica y su escritura, operación revierte (en otra réplica).
      if (!revertida) {
        revertida = true;
        const r = await revertirReconciliacionTareas(yo, a, { ahora: T + HORA });
        assert.ok(r.ok);
      }
      return l;
    },
  };
  const r = await reconciliarInventarioTareas(yo, { ahora: T + HORA }, b);
  assert.equal(r.estado, 'revertido');
  assert.equal(r.agregadas, 0);
  const despues = indiceMem(a, yo);
  assert.ok(!despues.ids.some((x: any) => x.id === ids[1]), 'la escritura de la réplica atrasada no la agregó');
  assert.ok(despues.revertido);
});

test('reversión concurrente con la creación de una tarea: la nueva se queda (fusión CAS sobre el índice actual, nunca una foto vieja)', async () => {
  const a = almacenEnMemoria();
  const yo = 'rv-concurrente@ejemplo.test';
  const T = Date.now() - 10 * HORA;
  const ids = await reconciliadaConPerdidas(a, yo, 4, [1], T);
  let nueva = '';
  const b: AlmacenDurable = {
    ...a,
    cas: async (clave, valor, etag) => {
      if (!nueva && clave === claveIndiceMem(yo)) {
        const c = await crearTarea(yo, { requestId: 'rv-concurrente-nueva', titulo: 'Entre medias', ...NUEVA }, { almacen: a, ahora: T + 2 * HORA });
        assert.ok(c.ok);
        if (c.ok) nueva = c.tarea.id;
      }
      return a.cas(clave, valor, etag);
    },
  };
  const r = await revertirReconciliacionTareas(yo, b, { ahora: T + 2 * HORA });
  assert.ok(r.ok && r.quitadas === 1);
  const en = new Set(indiceMem(a, yo).ids.map((x: any) => x.id));
  assert.ok(nueva && en.has(nueva), 'la tarea creada durante la reversión sigue en el índice');
  assert.ok(!en.has(ids[1]));
  assert.equal(en.size, 4);
});

test('revertir es idempotente y reanudable: una lectura fallida deja esa entrada (y la reversión pendiente); repetir la termina; repetir otra vez no escribe', async () => {
  const a = almacenEnMemoria();
  const yo = 'rv-idempotente@ejemplo.test';
  const T = Date.now() - 10 * HORA;
  const ids = await reconciliadaConPerdidas(a, yo, 5, [1, 2], T);
  const b: AlmacenDurable = { ...a, leer: async (clave) => (clave.endsWith(`/${ids[2]}`) ? { ok: false as const, detalle: 'S3 500' } : a.leer(clave)) };
  const r1 = await revertirReconciliacionTareas(yo, b, { ahora: T + 2 * HORA });
  assert.ok(r1.ok);
  if (r1.ok) assert.deepEqual([r1.quitadas, r1.pendientes], [1, 1], 'la que no se pudo leer no se quita a ciegas');
  let ix = indiceMem(a, yo);
  assert.ok(ix.ids.some((x: any) => x.id === ids[2] && x.rec), 'sigue, con su marca, para la próxima vuelta');
  assert.ok(!ix.ids.some((x: any) => x.id === ids[1]));
  assert.ok(ix.revertido);
  const l = await listarTareasPagina(yo, { ahora: T + 3 * HORA }, a);
  assert.ok(l.ok && l.inventario === 'revertido' && !l.tareas.some((t) => t.id === ids[1]), 'a medias tampoco se rehace');
  const r2 = await revertirReconciliacionTareas(yo, a, { ahora: T + 4 * HORA });
  assert.ok(r2.ok);
  if (r2.ok) assert.deepEqual([r2.quitadas, r2.pendientes], [1, 0]);
  ix = indiceMem(a, yo);
  assert.ok(!ix.ids.some((x: any) => x.rec));
  assert.equal(ix.ids.length, 3);
  const foto = a.objetos.get(claveIndiceMem(yo));
  const r3 = await revertirReconciliacionTareas(yo, a, { ahora: T + 5 * HORA });
  assert.ok(r3.ok);
  if (r3.ok) assert.deepEqual([r3.quitadas, r3.conservadas, r3.restauradas, r3.pendientes, r3.ya], [0, 0, 0, 0, true]);
  assert.equal(a.objetos.get(claveIndiceMem(yo)), foto, 'revertir otra vez no reescribe el índice');
  assert.equal(objetosMem(a, yo), 5);
});

test('revertir después de que el tope del historial recortara: vuelven las del índice de antes y las cuentas (índice, terminadas, recortadas) quedan coherentes', async () => {
  const a = almacenEnMemoria();
  const yo = 'rv-recorte@ejemplo.test';
  const T = Date.now() - 100 * HORA;
  const ids = await terminadas(a, yo, MAX_HISTORIAL_INDICE + 5, T);
  // Un índice de antes con las 200 terminadas más viejas (con su fin), al que le faltan las 5 más nuevas.
  a.objetos.set(claveIndiceMem(yo), JSON.stringify({ v: 2, ids: ids.slice(0, MAX_HISTORIAL_INDICE).map((id, i) => ({ id, t: T + i, fin: T + 10_000 + i })) }));
  const p = await listarTareasPagina(yo, { ahora: T + HORA }, a);
  assert.ok(p.ok && p.reconciliado);
  if (p.ok) {
    // El inventario agregó las 5 nuevas y el tope sacó las 5 más viejas del índice de antes.
    assert.equal(p.conteo.indice, MAX_HISTORIAL_INDICE);
    assert.equal(p.conteo.recortadas, 5);
    assert.ok(ids.slice(-5).every((id) => p.tareas.some((t) => t.id === id)));
  }
  const r = await revertirReconciliacionTareas(yo, a, { ahora: T + 2 * HORA });
  assert.ok(r.ok);
  if (r.ok) assert.deepEqual([r.quitadas, r.restauradas, r.pendientes], [5, 5, 0]);
  const q = await listarTareasPagina(yo, { ahora: T + 3 * HORA }, a);
  assert.ok(q.ok);
  if (q.ok) {
    assert.deepEqual(new Set(q.tareas.map((t) => t.id)), new Set(ids.slice(0, MAX_HISTORIAL_INDICE)), 'el historial de antes, entero');
    assert.equal(q.conteo.indice, MAX_HISTORIAL_INDICE);
    assert.equal(q.conteo.terminadas, MAX_HISTORIAL_INDICE);
    assert.equal(q.conteo.recortadas, 0, 'lo que contó el inventario se va con él');
    assert.equal(q.inventario, 'revertido');
  }
  assert.equal(objetosMem(a, yo), MAX_HISTORIAL_INDICE + 5);
});

test('reactivar: dueño a dueño (reactivarReconciliacionTareas) o para todos subiendo AURA_RECONCILIAR_TAREAS_GENERACION, la reconciliación vuelve a funcionar', async () => {
  const a = almacenEnMemoria();
  const yo = 'rv-reactivar@ejemplo.test';
  const T = Date.now() - 10 * HORA;
  const ids = await reconciliadaConPerdidas(a, yo, 4, [1], T);
  assert.ok((await revertirReconciliacionTareas(yo, a, { ahora: T + 2 * HORA })).ok);
  let l = await listarTareasPagina(yo, { ahora: T + 3 * HORA }, a);
  assert.ok(l.ok && l.inventario === 'revertido' && l.tareas.length === 3);
  const re = await reactivarReconciliacionTareas(yo, a);
  assert.ok(re.ok && re.reactivado);
  assert.equal(indiceMem(a, yo).revertido, undefined);
  l = await listarTareasPagina(yo, { ahora: T + 4 * HORA }, a);
  assert.ok(l.ok && l.reconciliado && l.completo && l.tareas.some((t) => t.id === ids[1]), 'reactivada, la recupera otra vez');
  assert.ok(indiceMem(a, yo).ids.some((x: any) => x.id === ids[1] && x.rec), 'y otra vez es reversible');
  // Otra reversión; esta vez se reactiva para todos con la generación (sin tocar dueño a dueño).
  const r2 = await revertirReconciliacionTareas(yo, a, { ahora: T + 5 * HORA });
  assert.ok(r2.ok && r2.quitadas === 1);
  l = await listarTareasPagina(yo, { ahora: T + 6 * HORA }, a);
  assert.ok(l.ok && l.inventario === 'revertido');
  await conVariable('AURA_RECONCILIAR_TAREAS_GENERACION', '2', async () => {
    const m = await listarTareasPagina(yo, { ahora: T + 7 * HORA }, otraReplica(a));
    assert.ok(m.ok && m.reconciliado && m.tareas.some((t) => t.id === ids[1]), 'una generación nueva reconcilia otra vez');
    // Y lo que se revierta en esa generación queda revertido hasta la siguiente.
    assert.ok((await revertirReconciliacionTareas(yo, a, { ahora: T + 8 * HORA })).ok);
    const n = await listarTareasPagina(yo, { ahora: T + 9 * HORA }, a);
    assert.ok(n.ok && n.inventario === 'revertido' && !n.tareas.some((t) => t.id === ids[1]));
    assert.equal(indiceMem(a, yo).revertido.gen, 2);
  });
  assert.equal((await reactivarReconciliacionTareas(yo, a)).ok, true);
  assert.equal(objetosMem(a, yo), 4);
});

test('revertir a un dueño no toca el índice ni las tareas de otro', async () => {
  const a = almacenEnMemoria();
  const T = Date.now() - 10 * HORA;
  const ana = 'rv-ana@ejemplo.test';
  const beto = 'rv-beto@ejemplo.test';
  const deAna = await reconciliadaConPerdidas(a, ana, 3, [1], T);
  await reconciliadaConPerdidas(a, beto, 3, [0], T);
  const foto = a.objetos.get(claveIndiceMem(ana));
  const r = await revertirReconciliacionTareas(beto, a, { ahora: T + 2 * HORA });
  assert.ok(r.ok && r.quitadas === 1);
  assert.equal(a.objetos.get(claveIndiceMem(ana)), foto, 'el índice de Ana, intacto');
  const l = await listarTareasPagina(ana, { ahora: T + 3 * HORA }, a);
  assert.ok(l.ok && l.reconciliado && l.completo);
  if (l.ok) assert.deepEqual(new Set(l.tareas.map((t) => t.id)), new Set(deAna));
  assert.equal(objetosMem(a, ana), 3);
  assert.equal(objetosMem(a, beto), 3);
});

/* ------------------------------------------------------------------ revisión externa (5-oct): H3 y H4 */

const PRESUPUESTO_ANCHO = { porListado: 1000, listados: 3, lecturas: 1000 };

/**
 * 215 terminadas; un índice de antes con las 200 más viejas menos las 10 primeras (ya recortadas: `recortadas: 10`) y sin
 * las 5 más nuevas. La lista lo reconcilia: agrega las 5 nuevas y el tope saca 5 viejas → 15 recortadas.
 */
async function conRecortadasDeAntes(a: AlmacenDurable & { objetos: Map<string, string> }, yo: string, T: number): Promise<string[]> {
  const ids = await terminadas(a, yo, MAX_HISTORIAL_INDICE + 15, T);
  a.objetos.set(claveIndiceMem(yo), JSON.stringify({ v: 2, recortadas: 10, ids: ids.slice(10, MAX_HISTORIAL_INDICE + 10).map((id, i) => ({ id, t: T + 10 + i, fin: T + 10_010 + i })) }));
  return ids;
}

test('H3: revertir no descuenta dos veces lo que vuelve: recortadas 10 de antes y 5 perdidas → 15 al reconciliar, 10 (no 5) al revertir; con varios ciclos reactivar/revertir sigue en 10', async () => {
  const a = almacenEnMemoria();
  const yo = 'h3-recortadas@ejemplo.test';
  const T = Date.now() - 100 * HORA;
  const ids = await conRecortadasDeAntes(a, yo, T);
  let t = T + HORA;
  for (let ciclo = 1; ciclo <= 3; ciclo++) {
    const p = await listarTareasPagina(yo, { ahora: t, presupuesto: PRESUPUESTO_ANCHO }, a);
    assert.ok(p.ok && p.reconciliado, `ciclo ${ciclo}: reconcilia`);
    if (p.ok) assert.equal(p.conteo.recortadas, 15, `ciclo ${ciclo}: al reconciliar`);
    const r = await revertirReconciliacionTareas(yo, a, { ahora: (t += HORA) });
    assert.ok(r.ok);
    if (r.ok) assert.deepEqual([r.quitadas, r.restauradas, r.pendientes], [5, 5, 0], `ciclo ${ciclo}`);
    const q = await listarTareasPagina(yo, { ahora: (t += HORA) }, a);
    assert.ok(q.ok);
    if (q.ok) {
      assert.equal(q.conteo.recortadas, 10, `ciclo ${ciclo}: tras revertir, las 10 de antes (ni 5 ni menos)`);
      assert.deepEqual(new Set(q.tareas.map((x) => x.id)), new Set(ids.slice(10, MAX_HISTORIAL_INDICE + 10)), `ciclo ${ciclo}: el historial de antes, entero`);
      assert.equal(q.inventario, 'revertido');
    }
    const re = await reactivarReconciliacionTareas(yo, a);
    assert.ok(re.ok && re.reactivado);
    t += HORA;
  }
});

test('H4: revertir no vuelve a esconder una recuperada que sigue ACTIVA (trabajo vivo), aunque nadie la tocara; la terminada sin actividad sí sale', async () => {
  const a = almacenEnMemoria();
  const yo = 'h4-activa@ejemplo.test';
  const T = Date.now() - 10 * HORA;
  const ids = await reconciliadaConPerdidas(a, yo, 4, [1, 2], T, { activas: [1] });
  const r = await revertirReconciliacionTareas(yo, a, { ahora: T + 2 * HORA });
  assert.ok(r.ok);
  if (r.ok) assert.deepEqual([r.quitadas, r.conservadas, r.pendientes], [1, 1, 0]);
  const ix = indiceMem(a, yo);
  const activa = ix.ids.find((x: any) => x.id === ids[1]);
  assert.ok(activa, 'la activa sigue en el índice');
  assert.equal(activa.rec, undefined, 'como propia, sin la marca del inventario');
  assert.ok(!ix.ids.some((x: any) => x.id === ids[2]), 'la terminada sin actividad sale');
  const l = await listarTareasPagina(yo, { ahora: T + 3 * HORA }, a);
  assert.ok(l.ok && l.tareas.some((x) => x.id === ids[1]) && l.inventario === 'revertido');
  if (l.ok) assert.equal(l.conteo.activas, 3, 'las tres activas (la recuperada incluida) se ven');
});

test('H4: revertir a un dueño sin índice (un correo mal escrito) no escribe nada ni lo bloquea; lo dice (`sinIndice`)', async () => {
  const a = almacenEnMemoria();
  const yo = 'h4-sin-indice@ejemplo.test';
  const antes = [...a.objetos.keys()];
  const r = await revertirReconciliacionTareas(yo, a, { ahora: Date.now() });
  assert.ok(r.ok);
  if (r.ok) assert.deepEqual([r.quitadas, r.conservadas, r.restauradas, r.pendientes, r.ya, r.sinIndice], [0, 0, 0, 0, true, true]);
  assert.deepEqual([...a.objetos.keys()], antes, 'ni índice ni marca');
  assert.equal(indiceMem(a, yo), null);
  // Ese dueño sigue pudiendo reconciliarse (no quedó «revertido»).
  const c = await crearTarea(yo, { requestId: 'h4-si-1', titulo: 'Una', ...NUEVA }, { almacen: a });
  assert.ok(c.ok);
  const l = await listarTareasPagina(yo, {}, a);
  assert.ok(l.ok && l.inventario !== 'revertido' && l.reconciliado, JSON.stringify(l.ok && l.inventario));
});

test('R16-2: revertir a un dueño CON índice al que el inventario nunca agregó nada no escribe nada ni lo deja «revertido» (`nadaQueRevertir`): reconciliado o sin reconciliar, sigue igual', async () => {
  const a = almacenEnMemoria();
  _usarAlmacenDurable(a);
  // Reconciliado sin agregar nada (las 3 ya estaban en el índice): la marca dice `agregadas: 0` y no hay respaldo.
  const yo = 'r16-2-tres@ejemplo.test';
  for (let i = 0; i < 3; i++) assert.ok((await crearTarea(yo, { requestId: `r16-2-${i}`, titulo: `T${i}`, ...NUEVA }, { almacen: a })).ok);
  const l0 = await listarTareasPagina(yo, {}, a);
  assert.ok(l0.ok && l0.reconciliado, JSON.stringify(l0.ok && l0.inventario));
  const antes = new Map(a.objetos);
  const r = await revertirReconciliacionTareas(yo, a, { ahora: Date.now() });
  assert.ok(r.ok);
  if (r.ok) assert.deepEqual([r.quitadas, r.conservadas, r.restauradas, r.pendientes, r.ya, r.nadaQueRevertir, r.sinIndice], [0, 0, 0, 0, true, true, undefined]);
  assert.deepEqual(new Map(a.objetos), antes, 'no se escribió nada');
  assert.equal(indiceMem(a, yo).revertido, undefined, 'sin la marca `revertido`');
  const l1 = await listarTareasPagina(yo, {}, a);
  assert.ok(l1.ok && l1.reconciliado && l1.inventario === 'reconciliado' && l1.tareas.length === 3, JSON.stringify(l1.ok && l1.inventario));
  // Sin reconciliar todavía (índice sin la marca `inventario`): sí se escribe `revertido`, el bloqueo previo (ninguna
  // réplica le agregará nada; ver «una réplica que estaba recorriendo el inventario cuando operación revirtió…»).
  const otro = 'r16-2-sin-marca@ejemplo.test';
  const b = almacenEnMemoria();
  assert.ok((await crearTarea(otro, { requestId: 'r16-2-b', titulo: 'B', ...NUEVA }, { almacen: b })).ok);
  assert.equal(indiceMem(b, otro).inventario, undefined);
  const rb = await revertirReconciliacionTareas(otro, b, { ahora: Date.now() });
  assert.ok(rb.ok && !rb.nadaQueRevertir && !rb.ya);
  assert.ok(indiceMem(b, otro).revertido);
});

test('H4: sin el respaldo del índice de antes, lo que el recorte sacó no puede volver y se sigue contando en `recortadas` (con su aviso); no se pierde en silencio', async () => {
  const a = almacenEnMemoria();
  _usarAlmacenDurable(a);
  const yo = 'h4-sin-respaldo@ejemplo.test';
  const T = Date.now() - 100 * HORA;
  const ids = await terminadas(a, yo, MAX_HISTORIAL_INDICE + 5, T);
  a.objetos.set(claveIndiceMem(yo), JSON.stringify({ v: 2, ids: ids.slice(0, MAX_HISTORIAL_INDICE).map((id, i) => ({ id, t: T + i, fin: T + 10_000 + i })) }));
  const p = await listarTareasPagina(yo, { ahora: T + HORA }, a);
  assert.ok(p.ok && p.reconciliado && p.conteo.recortadas === 5);
  const respaldos = [...a.objetos.keys()].filter((k) => k.includes('antes-de-inventario') && k.includes(huellaDueno(yo)));
  assert.equal(respaldos.length, 1, JSON.stringify(respaldos));
  a.objetos.delete(respaldos[0]);
  const avisos: string[] = [];
  const orig = console.warn;
  console.warn = (...x: unknown[]) => void avisos.push(x.map(String).join(' '));
  let r: Awaited<ReturnType<typeof revertirReconciliacionTareas>>;
  try {
    r = await revertirReconciliacionTareas(yo, a, { ahora: T + 2 * HORA });
  } finally {
    console.warn = orig;
  }
  assert.ok(r.ok);
  if (r.ok) assert.deepEqual([r.quitadas, r.restauradas, r.pendientes], [5, 0, 0]);
  const q = await listarTareasPagina(yo, { ahora: T + 3 * HORA }, a);
  assert.ok(q.ok);
  if (q.ok) {
    assert.equal(q.conteo.indice, MAX_HISTORIAL_INDICE - 5);
    assert.equal(q.conteo.recortadas, 5, 'las 5 que el recorte sacó y no pudieron volver siguen contadas');
  }
  if (r.ok) assert.equal(r.sinRespaldo, true);
  assert.ok(avisos.some((x) => /respaldo/.test(x)), JSON.stringify(avisos));
  const h = arnes();
  try {
    const l = await h.pedir('/api/trabajos', yo);
    assert.equal(l.status, 200);
    assert.equal(l.json.completo, false);
    assert.match(l.json.aviso, /se revirtió por decisión/);
    assert.match(l.json.aviso, /5 terminadas más antiguas ya no salen/);
  } finally {
    h.cerrar();
  }
});

/* ------------------------------------------------------------------ revisión externa sobre 8b9e9ca: generaciones y restauración */

/** 201 terminadas; el índice de antes tiene las 200 más viejas (el tope lleno) y le falta la más nueva. */
async function topeLlenoConUnaPerdida(a: AlmacenDurable & { objetos: Map<string, string> }, yo: string, T: number): Promise<string[]> {
  const ids = await terminadas(a, yo, MAX_HISTORIAL_INDICE + 1, T);
  a.objetos.set(claveIndiceMem(yo), JSON.stringify({ v: 2, ids: ids.slice(0, MAX_HISTORIAL_INDICE).map((id, i) => ({ id, t: T + i, fin: T + 10_000 + i })) }));
  return ids;
}

test('8b9e9ca-1: una reconciliación pausada en el LIST que sobrevive a otra + revertir + reactivar no escribe con la generación vieja; revertir otra vez deja las 200 originales', async () => {
  const a = almacenEnMemoria();
  const yo = 'gen-vieja@ejemplo.test';
  const T = Date.now() - 100 * HORA;
  const ids = await topeLlenoConUnaPerdida(a, yo, T);
  const originales = new Set(ids.slice(0, MAX_HISTORIAL_INDICE));
  // La réplica vieja: su primer LIST se queda colgado hasta que se suelte.
  let soltar!: () => void;
  let entro!: () => void;
  const enLista = new Promise<void>((r) => (entro = r));
  const suelta = new Promise<void>((r) => (soltar = r));
  let pausada = false;
  const vieja: AlmacenDurable = {
    ...a,
    listar: async (prefijo, o) => {
      if (!pausada) {
        pausada = true;
        entro();
        await suelta;
      }
      return a.listar!(prefijo, o);
    },
  };
  const r1 = reconciliarInventarioTareas(yo, { ahora: T + HORA, presupuesto: PRESUPUESTO_ANCHO }, vieja);
  await enLista;
  // Mientras tanto, en otra réplica: reconcilia (agrega la nueva, el tope saca la más vieja), revierte y reactiva.
  const r2 = await reconciliarInventarioTareas(yo, { ahora: T + HORA + 1, presupuesto: PRESUPUESTO_ANCHO }, otraReplica(a));
  assert.equal(r2.estado, 'reconciliado');
  assert.equal(r2.agregadas, 1);
  const rv = await revertirReconciliacionTareas(yo, a, { ahora: T + 2 * HORA });
  assert.ok(rv.ok);
  if (rv.ok) assert.deepEqual([rv.quitadas, rv.restauradas, rv.pendientes], [1, 1, 0]);
  assert.deepEqual(new Set(indiceMem(a, yo).ids.map((x: any) => x.id)), originales);
  assert.ok((await reactivarReconciliacionTareas(yo, a)).ok);
  const antes = a.objetos.get(claveIndiceMem(yo));
  // Se suelta la vieja: su foto del índice es de la generación anterior; no puede escribir.
  soltar();
  const v = await r1;
  assert.equal(v.agregadas, 0, JSON.stringify(v));
  assert.equal(v.escribio, false);
  assert.notEqual(v.estado, 'reconciliado');
  assert.equal(a.objetos.get(claveIndiceMem(yo)), antes, 'la generación vieja no tocó el índice');
  // La generación vigente reconcilia con SU respaldo y revertir restaura las 200 originales enteras.
  const r3 = await reconciliarInventarioTareas(yo, { ahora: T + 3 * HORA, presupuesto: PRESUPUESTO_ANCHO }, a);
  assert.equal(r3.estado, 'reconciliado');
  assert.equal(r3.agregadas, 1);
  const rv2 = await revertirReconciliacionTareas(yo, a, { ahora: T + 4 * HORA });
  assert.ok(rv2.ok);
  if (rv2.ok) assert.deepEqual([rv2.quitadas, rv2.restauradas, rv2.pendientes, rv2.sinRespaldo], [1, 1, 0, undefined]);
  const fin = indiceMem(a, yo).ids.map((x: any) => x.id);
  assert.equal(fin.filter((id: string) => originales.has(id)).length, MAX_HISTORIAL_INDICE, 'las 200 entradas originales, no 199');
  assert.deepEqual(new Set(fin), originales);
  assert.equal(objetosMem(a, yo), MAX_HISTORIAL_INDICE + 1, 'ningún objeto se borró');
});

test('8b9e9ca-1b: aunque la vieja escriba antes de reactivar (revertido) o tras una reversión sin reactivar, nunca agrega; la vigente usa el respaldo de su ciclo', async () => {
  const a = almacenEnMemoria();
  const yo = 'gen-vieja-b@ejemplo.test';
  const T = Date.now() - 100 * HORA;
  const ids = await topeLlenoConUnaPerdida(a, yo, T);
  const originales = new Set(ids.slice(0, MAX_HISTORIAL_INDICE));
  // Dos ciclos completos de reconciliar → revertir → reactivar; una vieja de cada ciclo se suelta al final.
  const viejas: Promise<Awaited<ReturnType<typeof reconciliarInventarioTareas>>>[] = [];
  const sueltas: (() => void)[] = [];
  for (let ciclo = 0; ciclo < 2; ciclo++) {
    let entro!: () => void;
    const enLista = new Promise<void>((r) => (entro = r));
    const suelta = new Promise<void>((r) => sueltas.push(r));
    let pausada = false;
    const b: AlmacenDurable = { ...a, listar: async (p, o) => (pausada ? a.listar!(p, o) : ((pausada = true), entro(), await suelta, a.listar!(p, o))) };
    viejas.push(reconciliarInventarioTareas(yo, { ahora: T + (10 * ciclo + 1) * HORA, presupuesto: PRESUPUESTO_ANCHO }, b));
    await enLista;
    const r = await reconciliarInventarioTareas(yo, { ahora: T + (10 * ciclo + 2) * HORA, presupuesto: PRESUPUESTO_ANCHO }, a);
    assert.equal(r.estado, 'reconciliado', `ciclo ${ciclo}`);
    const rv = await revertirReconciliacionTareas(yo, a, { ahora: T + (10 * ciclo + 3) * HORA });
    assert.ok(rv.ok && rv.restauradas === 1, `ciclo ${ciclo}: ${JSON.stringify(rv)}`);
    if (ciclo === 0) assert.ok((await reactivarReconciliacionTareas(yo, a)).ok);
  }
  // Sigue revertido (ciclo 1 sin reactivar): se sueltan las dos viejas.
  sueltas.forEach((s) => s());
  for (const v of await Promise.all(viejas)) assert.equal(v.agregadas, 0, JSON.stringify(v));
  assert.deepEqual(new Set(indiceMem(a, yo).ids.map((x: any) => x.id)), originales);
  assert.ok(indiceMem(a, yo).revertido);
});

test('8b9e9ca-2: si falla una lectura al restaurar, la reversión no dice `pendientes: 0` ni `ya: true` mientras falte restaurar; repetir la termina sin perder activas ni modificadas', async () => {
  const a = almacenEnMemoria();
  const yo = 'rest-fallo@ejemplo.test';
  const T = Date.now() - 100 * HORA;
  const ids = await terminadas(a, yo, MAX_HISTORIAL_INDICE + 5, T);
  a.objetos.set(claveIndiceMem(yo), JSON.stringify({ v: 2, ids: ids.slice(0, MAX_HISTORIAL_INDICE).map((id, i) => ({ id, t: T + i, fin: T + 10_000 + i })) }));
  const p = await listarTareasPagina(yo, { ahora: T + HORA, presupuesto: PRESUPUESTO_ANCHO }, a);
  assert.ok(p.ok && p.reconciliado && p.conteo.recortadas === 5);
  // Una nueva activa y una recuperada que después cambió: ninguna de las dos se puede perder en todo esto.
  const nueva = await crearTarea(yo, { requestId: 'rest-nueva', titulo: 'Viva', ...NUEVA }, { almacen: a, ahora: T + 2 * HORA });
  assert.ok(nueva.ok);
  const cambiada = ids[MAX_HISTORIAL_INDICE + 4];
  const kc = `tareas/${huellaDueno(yo)}/${cambiada}`;
  a.objetos.set(kc, JSON.stringify({ ...JSON.parse(a.objetos.get(kc)!), actualizada: T + 2 * HORA }));
  // La lectura de una de las 5 que el recorte sacó (ids[0]) falla mientras se restaura.
  const enferma: AlmacenDurable = { ...a, leer: async (clave) => (clave.endsWith(`/${ids[0]}`) ? { ok: false as const, detalle: 'S3 500' } : a.leer(clave)) };
  const r1 = await revertirReconciliacionTareas(yo, enferma, { ahora: T + 3 * HORA });
  assert.ok(r1.ok);
  if (r1.ok) {
    assert.ok(r1.pendientes >= 1, `pendientes ${r1.pendientes} con la restauración incompleta`);
    assert.equal(r1.ya, false);
    assert.equal(r1.restaurado, false);
    assert.equal(r1.restauradas, 4);
  }
  // Repetir con el almacén todavía enfermo: nada que escribir, pero tampoco «ya está».
  const r2 = await revertirReconciliacionTareas(yo, enferma, { ahora: T + 4 * HORA });
  assert.ok(r2.ok);
  if (r2.ok) {
    assert.ok(r2.pendientes >= 1, `pendientes ${r2.pendientes}`);
    assert.equal(r2.ya, false, 'restaurado:false nunca es «ya»');
    assert.equal(r2.restaurado, false);
  }
  assert.equal(indiceMem(a, yo).revertido.restaurado, false);
  // La lista lo dice: no es completo y avisa que la reversión quedó a medias.
  const l = await listarTareasPagina(yo, { ahora: T + 4 * HORA }, a);
  assert.ok(l.ok && !l.completo && l.inventario === 'revertido');
  // Al sanar, repetir la termina.
  const r3 = await revertirReconciliacionTareas(yo, a, { ahora: T + 5 * HORA });
  assert.ok(r3.ok);
  // (ids[0] es la terminada más vieja: con la recuperada que cambió ocupando un lugar, el tope la vuelve a dejar fuera y se
  // cuenta en `recortadas`; lo que importa es que la restauración terminó y ya no queda nada pendiente.)
  if (r3.ok) assert.deepEqual([r3.restaurado, r3.pendientes, r3.ya], [true, 0, false]);
  const r4 = await revertirReconciliacionTareas(yo, a, { ahora: T + 6 * HORA });
  assert.ok(r4.ok);
  if (r4.ok) assert.deepEqual([r4.restaurado, r4.pendientes, r4.ya], [true, 0, true]);
  const en = new Set(indiceMem(a, yo).ids.map((x: any) => x.id));
  assert.ok(ids.slice(1, MAX_HISTORIAL_INDICE).every((id) => en.has(id)), 'las originales que caben, todas');
  assert.ok(nueva.ok && en.has(nueva.tarea.id), 'la activa creada después sigue');
  assert.ok(en.has(cambiada), 'la recuperada que cambió después sigue (historial propio)');
  // Las 200 originales están todas (el tope saca de las más viejas lo que sobre, y eso se cuenta).
  const q = await listarTareasPagina(yo, { ahora: T + 7 * HORA }, a);
  assert.ok(q.ok);
  if (q.ok) {
    // 199 originales + la cambiada + la nueva en el índice; ids[0] contada como recortada (no perdida en silencio).
    assert.equal(q.conteo.indice, MAX_HISTORIAL_INDICE + 1, JSON.stringify(q.conteo));
    assert.equal(q.conteo.recortadas, 1, JSON.stringify(q.conteo));
  }
});

test('8b9e9ca-2b: si no se puede leer el RESPALDO al revertir, la reversión queda pendiente (no `pendientes: 0`), y al sanar restaura', async () => {
  const a = almacenEnMemoria();
  const yo = 'rest-respaldo@ejemplo.test';
  const T = Date.now() - 100 * HORA;
  const ids = await terminadas(a, yo, MAX_HISTORIAL_INDICE + 5, T);
  a.objetos.set(claveIndiceMem(yo), JSON.stringify({ v: 2, ids: ids.slice(0, MAX_HISTORIAL_INDICE).map((id, i) => ({ id, t: T + i, fin: T + 10_000 + i })) }));
  const p = await listarTareasPagina(yo, { ahora: T + HORA, presupuesto: PRESUPUESTO_ANCHO }, a);
  assert.ok(p.ok && p.reconciliado);
  const enferma: AlmacenDurable = { ...a, leer: async (clave) => (clave.includes('antes-de-inventario') ? { ok: false as const, detalle: 'S3 503' } : a.leer(clave)) };
  for (let i = 0; i < 2; i++) {
    const r = await revertirReconciliacionTareas(yo, enferma, { ahora: T + (2 + i) * HORA });
    assert.ok(r.ok);
    if (r.ok) {
      assert.ok(r.pendientes >= 1, `vuelta ${i}: pendientes ${r.pendientes}`);
      assert.equal(r.ya, false, `vuelta ${i}`);
      assert.equal(r.restaurado, false, `vuelta ${i}`);
    }
  }
  const r = await revertirReconciliacionTareas(yo, a, { ahora: T + 5 * HORA });
  assert.ok(r.ok);
  if (r.ok) assert.deepEqual([r.restaurado, r.restauradas, r.pendientes], [true, 5, 0]);
  assert.deepEqual(new Set(indiceMem(a, yo).ids.map((x: any) => x.id)), new Set(ids.slice(0, MAX_HISTORIAL_INDICE)));
});

test('8b9e9ca-2c: una tarea del índice de antes dañada (nunca se lee) deja la reversión pendiente; operación la cierra a propósito con `aceptarIlegibles` y queda contada', async () => {
  const a = almacenEnMemoria();
  const yo = 'rest-danada@ejemplo.test';
  const T = Date.now() - 100 * HORA;
  const ids = await terminadas(a, yo, MAX_HISTORIAL_INDICE + 5, T);
  a.objetos.set(claveIndiceMem(yo), JSON.stringify({ v: 2, ids: ids.slice(0, MAX_HISTORIAL_INDICE).map((id, i) => ({ id, t: T + i, fin: T + 10_000 + i })) }));
  const p = await listarTareasPagina(yo, { ahora: T + HORA, presupuesto: PRESUPUESTO_ANCHO }, a);
  assert.ok(p.ok && p.reconciliado);
  a.objetos.set(`tareas/${huellaDueno(yo)}/${ids[0]}`, '{dañado');
  for (let i = 0; i < 3; i++) {
    const r = await revertirReconciliacionTareas(yo, a, { ahora: T + (2 + i) * HORA });
    assert.ok(r.ok && r.pendientes >= 1 && !r.ya && !r.restaurado, `vuelta ${i}: ${JSON.stringify(r)}`);
  }
  const c = await revertirReconciliacionTareas(yo, a, { ahora: T + 6 * HORA, aceptarIlegibles: true });
  assert.ok(c.ok);
  if (c.ok) assert.deepEqual([c.restaurado, c.pendientes, c.ilegibles], [true, 0, 1]);
  const q = await listarTareasPagina(yo, { ahora: T + 7 * HORA }, a);
  assert.ok(q.ok);
  if (q.ok) {
    assert.equal(q.conteo.recortadas, 1, 'la dañada sigue contada, no se pierde en silencio');
    assert.equal(q.conteo.indice, MAX_HISTORIAL_INDICE - 1);
  }
  const d = await revertirReconciliacionTareas(yo, a, { ahora: T + 8 * HORA });
  assert.ok(d.ok && d.ya && d.pendientes === 0);
});
