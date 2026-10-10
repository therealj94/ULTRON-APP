/**
 * Fase 2: cancelar un objetivo descarta los borradores (correo / WhatsApp) que esperaban el «sí» de sus tareas.
 *
 * Antes, POST /api/objetivos/:id/cancelar ponía sus tareas en `cancelled` directo en lo durable, pero el borrador seguía
 * esperando en la memoria del proceso (server/correo.ts) y en lo durable (server/borradores-durables.ts): un «sí» suelto
 * en el chat, después, lo mandaba igual. Lo que tiene que ser verdad ahora:
 *   · el borrador sale de la memoria (un «sí» en el chat no manda nada) y queda anotado como rechazado;
 *   · en lo durable queda la marca de descartado: ninguna réplica lo rehidrata, ni con su intento + huella exactos;
 *   · lo de otra tarea u otro objetivo no se toca.
 */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import type { AddressInfo } from 'node:net';

const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'objetivos-cancelar-'));
process.env.CORREO_CLAVE_CIFRADO ||= 'llave-de-prueba';
process.env.ULTRON_CORREO_DIR = DIR;
process.env.ULTRON_TAREA_CURSO_DIR = path.join(DIR, 'tarea-en-curso');
process.env.ULTRON_ABIERTOS_DIR = path.join(DIR, 'abiertos');
process.env.ULTRON_DURABLE_DIR = path.join(DIR, 'durable');
after(() => fs.rmSync(DIR, { recursive: true, force: true }));

const D = await import('../lib/durable');
const BD = await import('../server/borradores-durables');
const TR = await import('../server/trabajos');
const C = await import('../server/correo');
const O = await import('../server/objetivos');
const DT = await import('../server/decision-turno');
const { cambiarObjetivo, crearObjetivo } = await import('../lib/objetivos');
const { leerTarea } = await import('../lib/tareas-durables');
const { rechazadoEnPanel, _olvidarRechazos } = await import('../server/borradores-cola');
const { agregarCuenta, cuentasDe, quitarCuenta, _olvidarCuentas } = await import('../lib/correo/cuentas');
type Envio = import('../lib/correo/buzon').Envio;

const PROV = { nombre: 'Prueba', imap: { host: '127.0.0.1', puerto: 993, seguro: true }, smtp: { host: '127.0.0.1', puerto: 465, seguro: true }, auth: 'clave', usuario: 'correo', guardaEnviados: false } as any;

/** Lo que server.ts le da a las rutas: descartar = la marca durable + «no» desde el panel (memoria + rechazo anotado). */
async function descartarComoServidor(correo: string, canal: 'correo' | 'whatsapp', ambito: string, intento: string) {
  await BD.descartarBorradorDurable(canal, correo, intento);
  return DT.resolverBorradorDesdePanel(correo, canal, ambito, intento, 'no');
}

function arnes(llamadas: string[]) {
  const pasa = ((_q: express.Request, _s: express.Response, nx: express.NextFunction) => nx()) as express.RequestHandler;
  const app = express();
  app.use(express.json());
  O.montarRutasObjetivos(app, {
    exigir: [pasa],
    limitar: () => pasa,
    sesionDe: (req) => (req.headers['x-quien'] ? { correo: String(req.headers['x-quien']) } : null),
    borradores: {
      descartar: async (correo, canal, ambito, intento) => {
        llamadas.push(`${canal}:${ambito}:${intento}`);
        return descartarComoServidor(correo, canal, ambito, intento);
      },
    },
  });
  const srv = app.listen(0, '127.0.0.1');
  const listo = new Promise((r) => srv.once('listening', r));
  const pedir = async (ruta: string, quien: string, cuerpo?: unknown) => {
    await listo;
    const r = await fetch(`http://127.0.0.1:${(srv.address() as AddressInfo).port}${ruta}`, { method: cuerpo ? 'POST' : 'GET', headers: { 'content-type': 'application/json', 'x-quien': quien }, body: cuerpo ? JSON.stringify(cuerpo) : undefined });
    return { status: r.status, json: (await r.json()) as any };
  };
  return { pedir, cerrar: () => srv.close() };
}

test('cancelar el objetivo descarta el borrador de su tarea: un «sí» en el chat ya no lo manda y ninguna réplica lo rehidrata', async () => {
  const mandados: Envio[] = [];
  const buzon = {
    mandar: async (_q: string, _c: unknown, e: Envio) => {
      mandados.push(e);
      return { messageId: e.messageId || '<x@prueba.hn>', guardadoEnEnviados: false, aceptados: [...e.para], rechazados: [] };
    },
    buscarEnviado: async () => 'no-encontrado' as const,
  };
  const quien = 'cancelar-objetivo@x.hn';
  const a = D.almacenEnMemoria();
  D._usarAlmacenDurable(a);
  C._buzonDePrueba(buzon as any);
  C._olvidarCorreo();
  _olvidarCuentas();
  _olvidarRechazos();
  for (const c of await cuentasDe(quien)) await quitarCuenta(quien, c.id);
  await agregarCuenta(quien, 'cancelar@prueba.hn', PROV, 'clave');
  const llamadas: string[] = [];
  const h = arnes(llamadas);
  try {
    // El borrador que espera su «sí» en el chat (memoria + durable) y la tarea que lo propone, del objetivo.
    await C.correrCorreo(quien, 'escribir banco@example.test | Propuesta | Les mando la propuesta final.', 'tel');
    const b = C.borradorDe(quien, 'tel')!;
    assert.ok(b, 'el borrador espera su «sí»');
    await BD._esperarBorradoresDurables();
    assert.ok(await BD.leerBorradorDurable('correo', quien, 'tel', b.intento, b.huella), 'y está en lo durable');
    const ref = await TR.abrirDecisionDeBorrador(quien, 'tel', { canal: 'correo', intento: b.intento, para: b.para, desde: b.desde, asunto: b.asunto, texto: b.texto, vence: b.vence, huella: b.huella });
    assert.ok(ref);
    const c = await crearObjetivo(quien, { requestId: 'cancelar-con-borrador', titulo: 'Propuesta para el banco', criterioCierre: ['Enviada'] });
    assert.ok(c.ok);
    const id = c.ok ? c.objetivo.id : '';
    const conTarea = await cambiarObjetivo(quien, id, () => ({ tarea: ref!.id, evento: 'Sumé la tarea de enviarla' }));
    assert.ok(conTarea.ok);
    // Otro objetivo con otra tarea que también espera: no se toca.
    await C.correrCorreo(quien, 'escribir otra@example.test | Otra cosa | Hola.', 'web');
    const otro = C.borradorDe(quien, 'web')!;
    assert.ok(otro);

    const can = await h.pedir(`/api/objetivos/${id}/cancelar`, quien, {});
    assert.equal(can.status, 200, JSON.stringify(can.json));
    assert.equal(can.json.objetivo.estado, 'cancelado');
    const lt = await leerTarea(quien, ref!.id);
    assert.equal(lt.ok && lt.tarea?.estado, 'cancelled');
    assert.deepEqual(llamadas, [`correo:tel:${b.intento}`], 'se descartó el de su tarea, y solo ese');

    // En la memoria: ya no espera, y un «sí» suelto en el chat no manda nada.
    assert.equal(C.borradorDe(quien, 'tel'), null);
    assert.equal(C.borradorCorreoPorIntento(quien, 'tel', b.intento), null);
    assert.equal(await C.resolverBorrador(quien, 'tel', 'sí'), null);
    assert.equal(mandados.length, 0, 'no salió nada');
    assert.ok(rechazadoEnPanel(b.intento), 'anotado como rechazado: un turno de voz descartado no lo repone');

    // En lo durable: la marca de descartado; ni con su intento y huella exactos vuelve (otra réplica, tras un reinicio).
    assert.equal(await BD.leerBorradorDurable('correo', quien, 'tel', b.intento, b.huella), null);
    C._olvidarCorreo();
    _olvidarRechazos();
    assert.equal(await C.rehidratarBorradorCorreo(quien, 'tel', b.intento, b.huella), false);
    assert.equal(mandados.length, 0);

    // Lo del otro objetivo sigue esperando en lo durable.
    assert.ok(await BD.leerBorradorDurable('correo', quien, 'web', otro.intento, otro.huella), 'lo ajeno no se descarta');
    // Cancelar otra vez no hace nada nuevo.
    const otraVez = await h.pedir(`/api/objetivos/${id}/cancelar`, quien, {});
    assert.equal(otraVez.json.sinCambio, true);
    assert.equal(llamadas.length, 1);
  } finally {
    h.cerrar();
    D._usarAlmacenDurable(null);
    C._buzonDePrueba(null);
    C._olvidarCorreo();
    _olvidarRechazos();
    for (const c of await cuentasDe(quien)) await quitarCuenta(quien, c.id);
  }
});

test('descartarBorradorDurable: una marca por dueño + intento; sin ella el borrador sí vuelve', async () => {
  const a = D.almacenEnMemoria();
  D._usarAlmacenDurable(a);
  try {
    const b = { intento: 'int-desc-1', huella: 'h-desc-1', vence: Date.now() + 60_000, texto: 'Hola' };
    BD.guardarBorradorDurable('whatsapp', 'ana@x.hn', 'tel', b);
    await BD._esperarBorradoresDurables();
    assert.ok(await BD.leerBorradorDurable('whatsapp', 'ana@x.hn', 'tel', b.intento, b.huella));
    // La marca de OTRA persona con el mismo intento no lo toca.
    assert.equal(await BD.descartarBorradorDurable('whatsapp', 'beto@x.hn', b.intento), true);
    assert.ok(await BD.leerBorradorDurable('whatsapp', 'ana@x.hn', 'tel', b.intento, b.huella));
    assert.equal(await BD.descartarBorradorDurable('whatsapp', 'ana@x.hn', b.intento), true);
    assert.equal(await BD.descartarBorradorDurable('whatsapp', 'ana@x.hn', b.intento), true, 'idempotente');
    assert.equal(await BD.leerBorradorDurable('whatsapp', 'ana@x.hn', 'tel', b.intento, b.huella), null);
    // Sin almacén que conteste no se puede saber si se descartó: no vuelve (fallo cerrado).
    const caido = { ...a, leer: (async () => ({ ok: false, detalle: 'caído' })) as unknown as typeof a.leer };
    assert.equal(await BD.leerBorradorDurable('whatsapp', 'ana@x.hn', 'tel', b.intento, b.huella, { almacen: caido }), null);
    assert.equal(await BD.descartarBorradorDurable('whatsapp', '', b.intento), false);
    // La función de las rutas: sin vínculo, nada.
    assert.equal(await O.descartarBorradoresDeTarea('ana@x.hn', null), false);
  } finally {
    D._usarAlmacenDurable(null);
  }
});
