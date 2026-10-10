/**
 * F01 (plan de cierre 5.7, P0): cancelar REVOCA la autoridad pendiente en la puerta del efecto.
 *
 * Antes: cancelar el objetivo ponía sus tareas en `cancelled` y dejaba una lápida «lo mejor posible» (si no se podía
 * escribir, igual contestaba «cancelado»); la réplica que tenía el borrador en su memoria lo mandaba igual con un «sí»
 * suelto (la caché respondía antes de mirar la lápida y el envío no la volvía a mirar).
 *
 * Lo que tiene que ser verdad ahora (lib/puerta-efecto.ts):
 *   1. réplica A prepara, B lo tiene en caché, A cancela, B aprueba y manda → no sale nada;
 *   2. si la revocación no se puede escribir, la respuesta dice «incierto» (nunca «cancelado» definitivo);
 *   3. con una barrera justo antes del proveedor (ya reclamado) y un cancelar desde otro aparato: el orden es el definido
 *      (lo reclamado sale y el cancelar dice «ya aceptada»; lo no reclamado no sale);
 *   4. un lease vencido que otro tomó: el ejecutor viejo no produce un efecto con su token;
 *   5. el proveedor aceptó y se perdió la respuesta, «reinicio»: se reconcilia sin duplicar ni decir de más;
 *   6. quitarle el acceso al dueño entre preparar y el efecto: la aprobación vieja ya no autoriza.
 * Sin esperas al azar: barreras controladas, reloj inyectado y un almacén compartido de prueba con fallos a pedido.
 */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import type { AddressInfo } from 'node:net';

const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'autoridad-efecto-'));
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
const { cambiarObjetivo, crearObjetivo, leerObjetivo } = await import('../lib/objetivos');
const { leerTarea, cambiarTarea } = await import('../lib/tareas-durables');
const { _olvidarRechazos } = await import('../server/borradores-cola');
const { agregarCuenta, cuentasDe, quitarCuenta, _olvidarCuentas } = await import('../lib/correo/cuentas');
type Envio = import('../lib/correo/buzon').Envio;
type AlmacenDurable = import('../lib/durable').AlmacenDurable;

const PROV = { nombre: 'Prueba', imap: { host: '127.0.0.1', puerto: 993, seguro: true }, smtp: { host: '127.0.0.1', puerto: 465, seguro: true }, auth: 'clave', usuario: 'correo', guardaEnviados: false } as any;

/* ------------------------------------------------------------------ el almacén compartido de prueba */

/**
 * Un almacén en memoria compartido por las «réplicas», con fallos a pedido (`fallar`: por operación y prefijo de clave)
 * y barreras (`detener`: la operación espera hasta `soltar`). Determinista: nada depende de cuánto tarda algo.
 */
function almacenControlado() {
  const base = D.almacenEnMemoria();
  const fallos: { op: string; prefijo: string }[] = [];
  const barreras: { op: string; prefijo: string; llego: () => void; soltar: Promise<void> }[] = [];
  const cae = (op: string, clave: string) => fallos.some((f) => (f.op === '*' || f.op === op) && clave.startsWith(f.prefijo));
  const espera = async (op: string, clave: string) => {
    const i = barreras.findIndex((b) => b.op === op && clave.startsWith(b.prefijo));
    if (i < 0) return;
    const [b] = barreras.splice(i, 1);
    b.llego();
    await b.soltar;
  };
  const a: AlmacenDurable = {
    tipo: 'memoria',
    multiReplica: true,
    async leer<T>(clave: string) {
      await espera('leer', clave);
      if (cae('leer', clave)) return { ok: false as const, detalle: 'fallo inyectado' };
      return base.leer<T>(clave);
    },
    async crear(clave: string, valor: unknown) {
      await espera('crear', clave);
      if (cae('escribir', clave)) return { ok: false as const, conflicto: false as const, detalle: 'fallo inyectado' };
      return base.crear(clave, valor);
    },
    async cas(clave: string, valor: unknown, etag: string) {
      await espera('cas', clave);
      if (cae('escribir', clave)) return { ok: false as const, conflicto: false as const, detalle: 'fallo inyectado' };
      return base.cas(clave, valor, etag);
    },
    listar: (p, o) => base.listar!(p, o),
  };
  return {
    a,
    base,
    fallar: (op: 'leer' | 'escribir' | '*', prefijo: string) => fallos.push({ op, prefijo }),
    sanar: () => fallos.splice(0),
    /** La próxima `op` sobre una clave con ese prefijo se detiene; devuelve cuándo llegó y cómo soltarla. */
    detener(op: 'leer' | 'crear' | 'cas', prefijo: string) {
      let llego!: () => void;
      let soltar!: () => void;
      const llegada = new Promise<void>((r) => (llego = r));
      const suelta = new Promise<void>((r) => (soltar = r));
      barreras.push({ op, prefijo, llego, soltar: suelta });
      return { llegada, soltar };
    },
  };
}

/** Una barrera en el proveedor: el envío llega, se detiene y sigue cuando la prueba lo suelta. */
function barrera() {
  let llego!: () => void;
  let soltar!: () => void;
  const llegada = new Promise<void>((r) => (llego = r));
  const suelta = new Promise<void>((r) => (soltar = r));
  return { llegada, soltar, pasar: async () => (llego(), await suelta) };
}

/* ------------------------------------------------------------------ el arnés */

function buzonDePrueba(mandados: Envio[], o: { antes?: () => Promise<void>; enviados?: () => 'encontrado' | 'no-encontrado'; perderRespuesta?: boolean } = {}) {
  return {
    mandar: async (_q: string, _c: unknown, e: Envio) => {
      if (o.antes) await o.antes();
      mandados.push(e);
      if (o.perderRespuesta) throw Object.assign(new Error('se cortó la conexión en DATA'), { command: 'DATA' });
      return { messageId: e.messageId || '<x@prueba.hn>', guardadoEnEnviados: true, aceptados: [...e.para], rechazados: [] };
    },
    buscarEnviado: async () => (o.enviados ? o.enviados() : ('no-encontrado' as const)),
  };
}

/** Las rutas de objetivos de una réplica. Sin `borradores`: esta réplica no tiene en memoria lo que armó la otra. */
function rutas(alm: AlmacenDurable, borradores?: import('../server/objetivos').DepsObjetivos['borradores']) {
  const pasa = ((_q: express.Request, _s: express.Response, nx: express.NextFunction) => nx()) as express.RequestHandler;
  const app = express();
  app.use(express.json());
  O.montarRutasObjetivos(app, { exigir: [pasa], limitar: () => pasa, sesionDe: (req) => (req.headers['x-quien'] ? { correo: String(req.headers['x-quien']) } : null), almacen: alm, ...(borradores ? { borradores } : {}) });
  const srv = app.listen(0, '127.0.0.1');
  const listo = new Promise((r) => srv.once('listening', r));
  const pedir = async (ruta: string, quien: string, cuerpo?: unknown) => {
    await listo;
    const r = await fetch(`http://127.0.0.1:${(srv.address() as AddressInfo).port}${ruta}`, { method: cuerpo ? 'POST' : 'GET', headers: { 'content-type': 'application/json', 'x-quien': quien }, body: cuerpo ? JSON.stringify(cuerpo) : undefined });
    return { status: r.status, json: (await r.json()) as any };
  };
  return { pedir, cerrar: () => srv.close() };
}

/** Un objetivo con una tarea que espera el «sí» de un borrador de correo (armado en ESTA réplica: su memoria lo tiene). */
async function preparar(quien: string, ambito: string, requestId: string) {
  await C.correrCorreo(quien, `escribir banco@example.test | Propuesta ${requestId} | Les mando la propuesta final.`, ambito);
  const b = C.borradorDe(quien, ambito)!;
  assert.ok(b, 'el borrador espera su «sí»');
  await BD._esperarBorradoresDurables();
  const ref = await TR.abrirDecisionDeBorrador(quien, ambito, { canal: 'correo', intento: b.intento, para: b.para, desde: b.desde, asunto: b.asunto, texto: b.texto, vence: b.vence, huella: b.huella });
  assert.ok(ref, 'la tarea de la propuesta');
  const c = await crearObjetivo(quien, { requestId, titulo: 'Propuesta para el banco', criterioCierre: ['Enviada'] });
  assert.ok(c.ok);
  const id = c.ok ? c.objetivo.id : '';
  const con = await cambiarObjetivo(quien, id, () => ({ tarea: ref!.id, evento: 'Sumé la tarea de enviarla' }));
  assert.ok(con.ok);
  return { b, tareaId: ref!.id, objetivoId: id };
}

async function conCorreo(quien: string, alm: AlmacenDurable, buzon: ReturnType<typeof buzonDePrueba>, f: () => Promise<void>) {
  D._usarAlmacenDurable(alm);
  C._buzonDePrueba(buzon as any);
  C._olvidarCorreo();
  _olvidarCuentas();
  _olvidarRechazos();
  for (const c of await cuentasDe(quien)) await quitarCuenta(quien, c.id);
  await agregarCuenta(quien, 'propuestas@prueba.hn', PROV, 'clave');
  try {
    await f();
  } finally {
    D._usarAlmacenDurable(null);
    C._buzonDePrueba(null);
    C._olvidarCorreo();
    _olvidarRechazos();
    for (const c of await cuentasDe(quien)) await quitarCuenta(quien, c.id);
  }
}

/* ------------------------------------------------------------------ 1. réplica con caché */

test('F01-1: A prepara, B lo tiene en caché, A cancela; B aprueba y manda → no sale nada', async () => {
  const quien = 'f01-replica@x.hn';
  const s = almacenControlado();
  const mandados: Envio[] = [];
  await conCorreo(quien, s.a, buzonDePrueba(mandados), async () => {
    // B (este módulo) armó el borrador y lo tiene en su memoria.
    const { b, tareaId, objetivoId } = await preparar(quien, 'tel', 'f01-replica-1');
    // A (otra réplica, sin la memoria de B) cancela el objetivo.
    const A = rutas(s.a);
    try {
      const can = await A.pedir(`/api/objetivos/${objetivoId}/cancelar`, quien, {});
      assert.equal(can.status, 200, JSON.stringify(can.json));
      assert.equal(can.json.objetivo.estado, 'cancelado');
      assert.equal(can.json.cancelacion?.estado, 'pendientes-cancelados', JSON.stringify(can.json.cancelacion));
    } finally {
      A.cerrar();
    }
    // B sigue teniendo el borrador en caché: un «sí» suelto en el chat, y el envío directo con la copia aprobada.
    assert.ok(C.borradorDe(quien, 'tel'), 'B lo tenía en su memoria (la caché de la réplica)');
    await C.resolverBorrador(quien, 'tel', 'sí');
    const directo = await C.enviarBorradorAprobado(quien, b);
    assert.equal(mandados.length, 0, 'ni el «sí» ni la copia aprobada de B despachan: la autoridad estaba revocada');
    assert.notEqual(directo.estado, 'succeeded');
    // La tarea quedó cancelada antes de hacer nada con efecto.
    const t = await leerTarea(quien, tareaId);
    assert.equal(t.ok && t.tarea?.estado, 'cancelled');
    // Y la caché de B ya no rehidrata lo revocado.
    assert.equal(await C.rehidratarBorradorCorreo(quien, 'tel', b.intento, b.huella), false);
  });
});

/* ------------------------------------------------------------------ 2. la revocación no se pudo escribir */

test('F01-2: si la revocación (lápida) no se puede escribir, la respuesta dice «incierto», no «cancelado» definitivo', async () => {
  const quien = 'f01-falla@x.hn';
  const s = almacenControlado();
  const mandados: Envio[] = [];
  await conCorreo(quien, s.a, buzonDePrueba(mandados), async () => {
    const { tareaId, objetivoId } = await preparar(quien, 'tel', 'f01-falla-01');
    s.fallar('escribir', 'autoridad/');
    s.fallar('escribir', 'borradores/descartados/');
    const A = rutas(s.a);
    try {
      const can = await A.pedir(`/api/objetivos/${objetivoId}/cancelar`, quien, {});
      assert.equal(can.status, 200, JSON.stringify(can.json));
      assert.equal(can.json.cancelacion?.estado, 'resultado-incierto', `la falla se dice: ${JSON.stringify(can.json.cancelacion)}`);
      assert.equal(can.json.cancelacion.reintentable, true);
      const t = await leerTarea(quien, tareaId);
      assert.ok(t.ok && t.tarea && !/antes de hacer nada con efecto/.test(t.tarea.resultado?.resumen || ''), 'la tarea no recibe el recibo definitivo de «cancelada»');
      // Mientras tanto nada sale: el objetivo cancelado (durable) también bloquea en la puerta.
      await C.resolverBorrador(quien, 'tel', 'sí');
      assert.equal(mandados.length, 0);
      // El almacén vuelve: cancelar otra vez (un reintento del transporte) termina lo pendiente.
      s.sanar();
      const otra = await A.pedir(`/api/objetivos/${objetivoId}/cancelar`, quien, {});
      assert.equal(otra.json.cancelacion?.estado, 'pendientes-cancelados', JSON.stringify(otra.json.cancelacion));
      const t2 = await leerTarea(quien, tareaId);
      assert.equal(t2.ok && t2.tarea?.estado, 'cancelled');
    } finally {
      A.cerrar();
    }
  });
});

/* ------------------------------------------------------------------ 3. el orden entre cancelar y reclamar */

test('F01-3a: barrera ya reclamado, justo antes del proveedor; cancelar desde otro aparato → «ya aceptada», sale una vez y su recibo se conserva', async () => {
  const quien = 'f01-orden-a@x.hn';
  const s = almacenControlado();
  const mandados: Envio[] = [];
  const ba = barrera();
  await conCorreo(quien, s.a, buzonDePrueba(mandados, { antes: ba.pasar }), async () => {
    const { b, tareaId, objetivoId } = await preparar(quien, 'tel', 'f01-orden-a1');
    const envio = C.enviarBorradorAprobado(quien, b);
    await ba.llegada; // reclamado y despachado: pasó el punto de no retorno
    const A = rutas(s.a);
    try {
      const can = await A.pedir(`/api/objetivos/${objetivoId}/cancelar`, quien, {});
      assert.equal(can.json.objetivo.estado, 'cancelado');
      assert.equal(can.json.cancelacion.estado, 'accion-ya-aceptada', JSON.stringify(can.json.cancelacion));
      assert.ok(can.json.cancelacion.puntoSinRetorno);
      assert.deepEqual(can.json.objetivo.enVueloAlCancelar, [tareaId]);
      ba.soltar();
      const r = await envio;
      assert.equal(r.estado, 'succeeded');
      assert.equal(mandados.length, 1, 'lo ya aceptado sale una vez');
      const t = await leerTarea(quien, tareaId);
      assert.notEqual(t.ok && t.tarea?.estado, 'cancelled', 'no se finge que se paró');
    } finally {
      A.cerrar();
    }
  });
});

test('F01-3b: barrera ANTES del reclamo; cancelar gana → la puerta ve la revocación y no despacha', async () => {
  const quien = 'f01-orden-b@x.hn';
  const s = almacenControlado();
  const mandados: Envio[] = [];
  await conCorreo(quien, s.a, buzonDePrueba(mandados), async () => {
    const { b, tareaId, objetivoId } = await preparar(quien, 'tel', 'f01-orden-b1');
    const alto = s.detener('leer', 'autoridad/efectos/');
    const envio = C.enviarBorradorAprobado(quien, b);
    await alto.llegada; // registrado, a punto de reclamar
    const A = rutas(s.a);
    try {
      const can = await A.pedir(`/api/objetivos/${objetivoId}/cancelar`, quien, {});
      assert.equal(can.json.cancelacion.estado, 'pendientes-cancelados', JSON.stringify(can.json.cancelacion));
      alto.soltar();
      const r = await envio;
      assert.notEqual(r.estado, 'succeeded');
      assert.equal(r.recibo?.codigo, 'cancelado');
      assert.equal(mandados.length, 0);
      const t = await leerTarea(quien, tareaId);
      assert.equal(t.ok && t.tarea?.estado, 'cancelled');
    } finally {
      A.cerrar();
    }
  });
});

test('F01-3c: el reclamo y la revocación chocan en la misma clave: el CAS ordena (la revocación escrita primero gana)', async () => {
  const quien = 'f01-orden-c@x.hn';
  const s = almacenControlado();
  const mandados: Envio[] = [];
  await conCorreo(quien, s.a, buzonDePrueba(mandados), async () => {
    const { b, objetivoId } = await preparar(quien, 'tel', 'f01-orden-c1');
    const alto = s.detener('crear', 'autoridad/efectos/');
    const envio = C.enviarBorradorAprobado(quien, b);
    await alto.llegada; // la puerta leyó «libre» y va a escribir su reclamo
    const A = rutas(s.a);
    try {
      const can = await A.pedir(`/api/objetivos/${objetivoId}/cancelar`, quien, {});
      assert.equal(can.json.cancelacion.estado, 'pendientes-cancelados');
      alto.soltar(); // el reclamo encuentra la clave ya escrita: conflicto, relee y ve «revocada»
      const r = await envio;
      assert.notEqual(r.estado, 'succeeded');
      assert.equal(mandados.length, 0);
    } finally {
      A.cerrar();
    }
  });
});

/* ------------------------------------------------------------------ 4. lease vencido */

test('F01-4: el lease venció y otro ejecutor lo tomó; el viejo no produce un efecto con su token', async () => {
  const quien = 'f01-lease@x.hn';
  const s = almacenControlado();
  const mandados: Envio[] = [];
  const { conAutoridadDeEjecutor } = await import('../lib/puerta-efecto');
  await conCorreo(quien, s.a, buzonDePrueba(mandados), async () => {
    const { b, tareaId } = await preparar(quien, 'tel', 'f01-lease-01');
    let T = 1_000;
    const reloj = () => T;
    const clave = TR.claveLeaseTarea(quien, tareaId);
    const viejo = await D.tomarLease(clave, 'ejecutor-viejo', 1_000, { almacen: s.a, ahora: reloj });
    assert.ok(viejo.ok);
    T = 5_000; // venció
    const nuevo = await D.tomarLease(clave, 'ejecutor-nuevo', 60_000, { almacen: s.a, ahora: reloj });
    assert.ok(nuevo.ok && viejo.ok && nuevo.lease.token > viejo.lease.token);
    if (!viejo.ok || !nuevo.ok) return;
    const r = await conAutoridadDeEjecutor({ lease: viejo.lease, ahora: reloj }, () => C.enviarBorradorAprobado(quien, b));
    assert.notEqual(r.estado, 'succeeded');
    assert.equal(mandados.length, 0, 'el token viejo no despacha');
    // El vigente sí (otra propuesta: la vieja quedó cerrada como «no se despachó»).
    await C.correrCorreo(quien, 'escribir otra@example.test | Otra | Hola.', 'web');
    const b2 = C.borradorDe(quien, 'web')!;
    const r2 = await conAutoridadDeEjecutor({ lease: nuevo.lease, ahora: reloj }, () => C.enviarBorradorAprobado(quien, b2));
    assert.equal(r2.estado, 'succeeded');
    assert.equal(mandados.length, 1);
  });
});

/* ------------------------------------------------------------------ 5. aceptado y respuesta perdida */

test('F01-5: el proveedor aceptó, la respuesta se perdió y el proceso «murió» antes de cerrar: tras reiniciar se reconcilia sin duplicar', async () => {
  const quien = 'f01-perdida@x.hn';
  const s = almacenControlado();
  const mandados: Envio[] = [];
  let visible: 'encontrado' | 'no-encontrado' = 'no-encontrado';
  // Antes de hablar con el proveedor el almacén deja de aceptar escrituras de operaciones: el cierre no queda (el «crash»).
  const buzon = buzonDePrueba(mandados, { antes: async () => void s.fallar('escribir', 'operaciones/'), perderRespuesta: true, enviados: () => visible });
  await conCorreo(quien, s.a, buzon, async () => {
    const { b, objetivoId } = await preparar(quien, 'tel', 'f01-perdida1');
    const r1 = await C.enviarBorradorAprobado(quien, b);
    assert.equal(r1.estado, 'unknown', 'no se sabe: no se dice enviado ni fallido');
    assert.equal(mandados.length, 1);
    const op = await D.leerOperacion(quien, `envio-correo-${b.intento}`, s.a);
    assert.ok(op.ok && op.valor && op.valor.estado === 'dispatched', 'quedó despachada sin cierre');
    // «Reinicio»: memoria vacía, almacén sano. Todavía no aparece en Enviados: sigue incierto y NO se repite.
    s.sanar();
    C._olvidarCorreo();
    const r2 = await C.enviarBorradorAprobado(quien, b);
    assert.equal(r2.estado, 'unknown');
    assert.equal(mandados.length, 1, 'no se duplica');
    // Pedir lo mismo otra vez (otra propuesta, mismo contenido) exige decisión antes de repetir.
    await C.correrCorreo(quien, `escribir banco@example.test | Propuesta f01-perdida1 | Les mando la propuesta final.`, 'tel2');
    const igual = C.borradorDe(quien, 'tel2')!;
    const r3 = await C.enviarBorradorAprobado(quien, { ...igual, repeticionAceptada: undefined });
    assert.equal(r3.recibo?.codigo, 'confirmar-repeticion');
    assert.equal(mandados.length, 1);
    // Aparece en Enviados: se reconcilia como enviado, sin mandarlo de nuevo.
    visible = 'encontrado';
    const r4 = await C.enviarBorradorAprobado(quien, b);
    assert.equal(r4.estado, 'succeeded');
    assert.equal(mandados.length, 1);
    // Cancelar ahora no lo da por cancelado: ya estaba aceptado.
    const A = rutas(s.a);
    try {
      const can = await A.pedir(`/api/objetivos/${objetivoId}/cancelar`, quien, {});
      assert.equal(can.json.cancelacion.estado, 'accion-ya-aceptada', JSON.stringify(can.json.cancelacion));
    } finally {
      A.cerrar();
    }
  });
});

/* ------------------------------------------------------------------ 6. acceso revocado */

test('F01-6: quitarle el acceso al dueño entre preparar y el efecto: la aprobación vieja ya no autoriza', async () => {
  const quien = 'f01-acceso@x.hn';
  const s = almacenControlado();
  const mandados: Envio[] = [];
  const P = await import('../lib/puerta-efecto');
  const sinAcceso = new Set<string>();
  let incierto = false;
  P.fijarVerificadorAcceso(({ dueno }) => (incierto ? 'incierto' : !sinAcceso.has(dueno)));
  try {
    await conCorreo(quien, s.a, buzonDePrueba(mandados), async () => {
      const { b } = await preparar(quien, 'tel', 'f01-acceso-1');
      incierto = true;
      const r0 = await C.enviarBorradorAprobado(quien, b);
      assert.notEqual(r0.estado, 'succeeded', 'sin poder comprobar el acceso no sale');
      assert.equal(mandados.length, 0);
      incierto = false;
      await C.correrCorreo(quien, 'escribir ana@example.test | Hola | Te escribo.', 'web');
      const b2 = C.borradorDe(quien, 'web')!;
      sinAcceso.add(quien);
      const r = await C.enviarBorradorAprobado(quien, b2);
      assert.notEqual(r.estado, 'succeeded');
      assert.equal(r.recibo?.codigo, 'aprobacion');
      assert.equal(mandados.length, 0, 'la aprobación de antes ya no autoriza');
    });
  } finally {
    P.fijarVerificadorAcceso(null);
  }
});

/* ------------------------------------------------------------------ superficies: borrador de la cuenta, presentación exacta */

test('F01 superficies: el borrador durable es de la cuenta; otra superficie lo aprueba solo si se le presentó la huella exacta', async () => {
  const quien = 'f01-superficie@x.hn';
  const s = almacenControlado();
  const mandados: Envio[] = [];
  await conCorreo(quien, s.a, buzonDePrueba(mandados), async () => {
    await C.correrCorreo(quien, 'escribir banco@example.test | Propuesta | Va la propuesta.', `${quien}#tel-1`);
    const b = C.borradorDe(quien, `${quien}#tel-1`)!;
    await BD._esperarBorradoresDurables();
    C._olvidarCorreo(); // otra réplica / reinicio
    assert.equal(await C.rehidratarBorradorCorreo(quien, `${quien}#web`, b.intento, b.huella), false, 'la web no la vio: no la aprueba');
    assert.equal(await BD.anotarPresentacionBorrador('correo', quien, { intento: b.intento, huella: 'otra-huella', origen: `${quien}#tel-1` }, `${quien}#web`), true);
    assert.equal(await C.rehidratarBorradorCorreo(quien, `${quien}#web`, b.intento, b.huella), false, 'presentar OTRA huella no vale');
    assert.equal(await BD.anotarPresentacionBorrador('correo', quien, { intento: b.intento, huella: b.huella, origen: `${quien}#tel-1` }, `${quien}#web`), true);
    const u = await BD.ultimoPresentadoEn(quien, `${quien}#web`);
    assert.equal(u?.intento, b.intento);
    assert.equal(await C.rehidratarBorradorCorreo(quien, `${quien}#web`, b.intento, b.huella), true, 'presentada exacta en la web: la aprueba desde ahí');
    // La misma operación (cuenta + propuesta), venga de donde venga: sale una vez.
    const r1 = await C.enviarBorradorAprobado(quien, b);
    const r2 = await C.enviarBorradorAprobado(quien, b);
    assert.equal(r1.estado, 'succeeded');
    assert.equal(r2.estado, 'succeeded');
    assert.equal(mandados.length, 1);
    // Otra cuenta con el mismo intento no ve nada.
    assert.equal(await BD.leerBorradorDurable('correo', 'otra@x.hn', `${quien}#tel-1`, b.intento, b.huella), null);
  });
});
