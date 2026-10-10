/**
 * Fase 2: el borrador que se aprueba es durable (server/borradores-durables.ts). Antes vivía solo en la memoria del
 * proceso: tras un reinicio (o desde otra réplica) la tarjeta fallaba con `propuesta-cambiada` aunque la persona
 * aprobara exactamente lo que vio.
 *
 * Lo que tiene que ser verdad:
 *   · tras «reiniciar» (la memoria vacía), aprobar desde el panel funciona si intento + huella coinciden: el borrador
 *     vuelve de lo durable y sale UNA vez;
 *   · con otra huella (otro contenido), no vuelve: 409 y no sale nada;
 *   · con el correo de verdad (server/correo.ts): el borrador guardado vuelve como apartado del panel, la huella se
 *     recalcula con su contenido, se manda una vez, y después de mandado ya no vuelve.
 */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import type { AddressInfo } from 'node:net';

const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'objetivos-borradores-'));
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
const { agregarCuenta, cuentasDe, quitarCuenta, _olvidarCuentas } = await import('../lib/correo/cuentas');
type Envio = import('../lib/correo/buzon').Envio;

/* ------------------------------------------------------------------ el panel tras un reinicio */

type B = { intento: string; huella: string; vence: number; texto: string };

/** Los borradores de una «réplica»: la memoria (que un reinicio vacía) y lo durable de verdad. */
function replica(enviados: { n: number; huellas: string[] }) {
  const memoria = new Map<string, B>();
  const pasa = ((_q: express.Request, _s: express.Response, nx: express.NextFunction) => nx()) as express.RequestHandler;
  const deps: import('../server/trabajos').DepsTrabajos = {
    exigirMesa: pasa,
    limitar: () => pasa,
    sesionDe: (req) => (req.headers['x-quien'] ? { correo: String(req.headers['x-quien']) } : null),
    borradores: {
      vigente: (_c, _canal, _ambito, intento) => {
        const b = intento ? memoria.get(intento) : [...memoria.values()][0];
        return b ? { intento: b.intento, huella: b.huella } : null;
      },
      enviar: async (_c, _canal, _ambito, intento, huella) => {
        const b = memoria.get(intento);
        if (!b || b.huella !== huella) return { estado: 'stale', resumen: 'ya no era ese' };
        enviados.n++;
        enviados.huellas.push(huella);
        memoria.delete(intento);
        return { estado: 'succeeded', resumen: 'CORREO ENVIADO a ana@ejemplo.com' };
      },
      descartar: async (_c, _canal, _ambito, intento) => void memoria.delete(intento),
      rehidratar: async (correo, canal, ambito, intento, huella) => {
        if (memoria.has(intento)) return true;
        const g = await BD.leerBorradorDurable<B>(canal, correo, ambito, intento, huella);
        if (!g || g.huella !== huella) return false;
        memoria.set(intento, g);
        return true;
      },
    },
  };
  const app = express();
  app.use(express.json());
  TR.montarRutasTrabajos(app, deps);
  const srv = app.listen(0, '127.0.0.1');
  const listo = new Promise((r) => srv.once('listening', r));
  const pedir = async (ruta: string, quien: string, cuerpo?: unknown) => {
    await listo;
    const r = await fetch(`http://127.0.0.1:${(srv.address() as AddressInfo).port}${ruta}`, { method: cuerpo ? 'POST' : 'GET', headers: { 'content-type': 'application/json', 'x-quien': quien }, body: cuerpo ? JSON.stringify(cuerpo) : undefined });
    return { status: r.status, json: (await r.json()) as any };
  };
  /** Arma un borrador: en la memoria y en lo durable (como server/correo.ts guardarBorrador). */
  const armar = (quien: string, ambito: string, b: B) => {
    memoria.set(b.intento, b);
    BD.guardarBorradorDurable('correo', quien, ambito, b);
  };
  return { memoria, pedir, armar, cerrar: () => srv.close() };
}

test('aprobar después de «reiniciar»: el borrador vuelve de lo durable con intento + huella y sale una vez', async () => {
  D._usarAlmacenDurable(D.almacenEnMemoria());
  try {
    const yo = 'tras-reinicio@ejemplo.com';
    const enviados = { n: 0, huellas: [] as string[] };
    const r1 = replica(enviados);
    const b: B = { intento: 'int-dur-1', huella: 'h-int-dur-1', vence: Date.now() + 15 * 60_000, texto: 'Hola Ana, ¿martes o jueves?' };
    r1.armar(yo, 'telefono', b);
    await BD._esperarBorradoresDurables();
    const ref = await TR.abrirDecisionDeBorrador(yo, 'telefono', { canal: 'correo', intento: b.intento, para: ['ana@ejemplo.com'], desde: 'yo@ejemplo.com', asunto: 'Fechas', texto: b.texto, vence: b.vence, huella: b.huella });
    assert.ok(ref);
    const t = (await r1.pedir(`/api/trabajos/${ref!.id}`, yo)).json.tarea;
    r1.cerrar();
    // «Reinicio» (u otra réplica): la memoria del proceso está vacía.
    const r2 = replica(enviados);
    try {
      assert.equal(r2.memoria.size, 0);
      // La lista no la da por perdida (antes: «bloqueada: el servidor se reinició»).
      const vista = (await r2.pedir(`/api/trabajos/${t.id}`, yo)).json.tarea;
      assert.equal(vista.state, 'awaiting_approval', 'sigue esperando: el borrador volvió de lo durable');
      const ok = await r2.pedir(`/api/trabajos/${t.id}/decisiones`, yo, { decisionId: t.decisionId, expectedVersion: vista.version, opcion: 'aprobar' });
      assert.equal(ok.status, 200, JSON.stringify(ok.json));
      assert.equal(ok.json.tarea.state, 'completed');
      assert.equal(enviados.n, 1);
      assert.deepEqual(enviados.huellas, ['h-int-dur-1'], 'sale exactamente lo aprobado');
      // El mismo «sí» otra vez (otro aparato): no sale de nuevo.
      const otra = await r2.pedir(`/api/trabajos/${t.id}/decisiones`, yo, { decisionId: t.decisionId, expectedVersion: vista.version, opcion: 'aprobar' });
      assert.equal(otra.json.repetida, true);
      assert.equal(enviados.n, 1);
    } finally {
      r2.cerrar();
    }
  } finally {
    D._usarAlmacenDurable(null);
  }
});

test('después de «reiniciar», un durable con OTRA huella no vuelve: 409 propuesta-cambiada y no sale nada', async () => {
  D._usarAlmacenDurable(D.almacenEnMemoria());
  try {
    const yo = 'otra-huella@ejemplo.com';
    const enviados = { n: 0, huellas: [] as string[] };
    const r1 = replica(enviados);
    // Lo guardado es otro contenido (otra huella) que el que mostró la tarjeta.
    r1.armar(yo, 'telefono', { intento: 'int-dur-2', huella: 'h-otro-contenido', vence: Date.now() + 15 * 60_000, texto: 'Otro texto' });
    await BD._esperarBorradoresDurables();
    try {
      const ref = await TR.abrirDecisionDeBorrador(yo, 'telefono', { canal: 'correo', intento: 'int-dur-2', para: ['ana@ejemplo.com'], desde: 'yo@ejemplo.com', asunto: 'Fechas', texto: 'Hola Ana', vence: Date.now() + 15 * 60_000, huella: 'h-int-dur-2' });
      // Lo que vio la tarjeta (sin pasar por la lista, que ya la marcaría bloqueada).
      const { leerTarea } = await import('../lib/tareas-durables');
      const l = await leerTarea(yo, ref!.id);
      assert.ok(l.ok && l.tarea?.decision);
      r1.memoria.clear();
      const r = await r1.pedir(`/api/trabajos/${ref!.id}/decisiones`, yo, { decisionId: l.ok ? l.tarea!.decision!.id : '', expectedVersion: l.ok ? l.tarea!.version : 0, opcion: 'aprobar' });
      assert.equal(r.status, 409);
      assert.equal(r.json.codigo, 'propuesta-cambiada');
      assert.equal(enviados.n, 0, 'no salió nada');
    } finally {
      r1.cerrar();
    }
  } finally {
    D._usarAlmacenDurable(null);
  }
});

/* ------------------------------------------------------------------ con el correo de verdad */

const PROV = { nombre: 'Prueba', imap: { host: '127.0.0.1', puerto: 993, seguro: true }, smtp: { host: '127.0.0.1', puerto: 465, seguro: true }, auth: 'clave', usuario: 'correo', guardaEnviados: false } as any;

test('server/correo.ts: el borrador guardado vuelve tras «reiniciar» (huella recalculada), se manda una vez y ya no vuelve', async () => {
  const mandados: Envio[] = [];
  const buzon = {
    mandar: async (_q: string, _c: unknown, e: Envio) => {
      mandados.push(e);
      return { messageId: e.messageId || '<x@prueba.hn>', guardadoEnEnviados: false, aceptados: [...e.para], rechazados: [] };
    },
    buscarEnviado: async () => 'no-encontrado' as const,
  };
  const quien = 'reinicio@x.hn';
  D._usarAlmacenDurable(D.almacenEnMemoria());
  C._buzonDePrueba(buzon as any);
  C._olvidarCorreo();
  _olvidarCuentas();
  for (const c of await cuentasDe(quien)) await quitarCuenta(quien, c.id);
  await agregarCuenta(quien, 'reinicio@prueba.hn', PROV, 'clave');
  try {
    await C.correrCorreo(quien, 'escribir ana@example.test | Contrato | Ana, te mando el contrato firmado.', 'tel');
    const b = C.borradorDe(quien, 'tel')!;
    assert.ok(b);
    await BD._esperarBorradoresDurables();
    // «Reinicio»: la memoria del proceso se vacía.
    C._olvidarCorreo();
    assert.equal(C.borradorCorreoPorIntento(quien, 'tel', b.intento), null);
    // Otra huella, otro ámbito u otra persona: no vuelve.
    assert.equal(await C.rehidratarBorradorCorreo(quien, 'tel', b.intento, 'huella-que-no-es'), false);
    assert.equal(await C.rehidratarBorradorCorreo(quien, 'web', b.intento, b.huella), false);
    assert.equal(await C.rehidratarBorradorCorreo('otra@x.hn', 'tel', b.intento, b.huella), false);
    // La de la tarjeta: vuelve como apartado del panel (el chat no lo resuelve con un «sí» suelto).
    assert.equal(await C.rehidratarBorradorCorreo(quien, 'tel', b.intento, b.huella), true);
    const vuelto = C.borradorCorreoPorIntento(quien, 'tel', b.intento);
    assert.ok(vuelto);
    assert.equal(vuelto!.huella, b.huella);
    assert.equal(C.borradorDe(quien, 'tel'), null, 'no ocupa el lugar del chat');
    const r = await C.resolverApartadoCorreo(quien, 'tel', b.intento, 'sí', b.huella);
    assert.equal(r?.estado, 'succeeded');
    assert.equal(mandados.length, 1);
    // Ya salió: aunque se «reinicie» otra vez, no vuelve a esperar un «sí».
    C._olvidarCorreo();
    assert.equal(await C.rehidratarBorradorCorreo(quien, 'tel', b.intento, b.huella), false);
    assert.equal(mandados.length, 1);
  } finally {
    D._usarAlmacenDurable(null);
    C._buzonDePrueba(null);
    C._olvidarCorreo();
    for (const c of await cuentasDe(quien)) await quitarCuenta(quien, c.id);
  }
});
