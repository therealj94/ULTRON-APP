/**
 * EL FRENO DE LA VOZ EN VIVO (revisión 9). En la conversación de voz de ElevenLabs cada pausa pide un turno especulativo;
 * si la persona sigue hablando, ese turno se descarta. «Mejor no», «nel» o «déjame pensar» parecen charla, pero el «no» y
 * el apartado de un borrador se aplicaban EN EL ACTO y no se reponían: con «…bueno, sí, mándalo» el borrador ya estaba
 * borrado (o apartado para el panel), su tarjeta cerrada y el aviso de lo vencido gastado.
 *
 * En la mesa del teléfono el turno espera el «sí» del teléfono antes de empezar (server.ts, hayDecisionEsperando). En la
 * voz no se puede (su confirmación llega DESPUÉS de la respuesta): ahí cada cambio se repone con `alDescartar`, lo que no
 * se puede deshacer espera a `hacer`, y el turno pide esperar la confirmación aunque no tenga acciones.
 *
 * Caminos REALES (server/decision-turno.ts, server/correo.ts, server/voz-agente.ts) con el buzón simulado. Cada prueba
 * falla con el código de antes. Datos sintéticos.
 */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import type { AddressInfo } from 'node:net';

const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'freno-voz-'));
process.env.CORREO_CLAVE_CIFRADO ||= 'llave-de-prueba';
Object.assign(process.env, {
  ULTRON_CORREO_DIR: DIR,
  ULTRON_TAREA_CURSO_DIR: path.join(DIR, 'tarea-en-curso'),
  ULTRON_ABIERTOS_DIR: path.join(DIR, 'abiertos'),
  ULTRON_DURABLE_DIR: path.join(DIR, 'durable'),
  ULTRON_VOCES_DIR: path.join(DIR, 'voces'),
  ULTRON_MEMORIA_BUCKET: '',
  ULTRON_SESION_SECRETO: 'secreto-de-prueba-largo-para-el-freno-de-la-voz',
  ULTRON_SESIONES_CERRADAS_ARCHIVO: path.join(DIR, 'cerradas.json'),
  AURA_SUSPENSIONES: 'ninguna',
});
after(() => fs.rmSync(DIR, { recursive: true, force: true }));

const D = await import('../lib/durable');
const C = await import('../server/correo');
const T = await import('../server/decision-turno');
const TR = await import('../server/trabajos');
const TD = await import('../lib/tareas-durables');
const DP = await import('../server/decision-en-pantalla');
const COLA = await import('../server/borradores-cola');
const { agregarCuenta, cuentasDe, quitarCuenta, _olvidarCuentas } = await import('../lib/correo/cuentas');
const { emitirSesion, secretoDerivado } = await import('../server/seguridad');
const VA = await import('../server/voz-agente');
type Envio = import('../lib/correo/buzon').Envio;
type TurnoVoz = import('../server/voz-agente').TurnoVoz;

const JOSE = 'jose-freno@example.test';
const AMB = 'voz';
const PROV = { nombre: 'Prueba', imap: { host: '127.0.0.1', puerto: 993, seguro: true }, smtp: { host: '127.0.0.1', puerto: 465, seguro: true }, auth: 'clave', usuario: 'correo', guardaEnviados: false } as any;
const dormir = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function conEntorno<R>(fn: (e: { mandados: Envio[] }) => Promise<R>): Promise<R> {
  const mandados: Envio[] = [];
  const buzon = {
    listar: async () => [],
    mandar: async (_q: string, _c: unknown, e: Envio) => (mandados.push(e), { messageId: e.messageId || '<x@example.test>', guardadoEnEnviados: false, aceptados: [...e.para], rechazados: [] }),
    buscarEnviado: async () => 'no-encontrado' as const,
  };
  D._usarAlmacenDurable(D.almacenEnMemoria());
  C._buzonDePrueba(buzon as any);
  C._olvidarCorreo();
  DP._olvidarEnPantalla();
  T._olvidarMencionados();
  COLA._olvidarVencidos();
  COLA._olvidarRechazos();
  _olvidarCuentas();
  for (const c of await cuentasDe(JOSE)) await quitarCuenta(JOSE, c.id);
  await agregarCuenta(JOSE, 'jose-freno@prueba.example.test', PROV, 'clave');
  try {
    return await fn({ mandados });
  } finally {
    for (const c of await cuentasDe(JOSE)) await quitarCuenta(JOSE, c.id);
    C._buzonDePrueba(null);
    C._olvidarCorreo();
    DP._olvidarEnPantalla();
    D._usarAlmacenDurable(null);
  }
}

const correoParaAna = () => C.correrCorreo(JOSE, 'escribir ana@example.test | Informe | Va el informe.', AMB);
/** Una retención como la de la voz, que cuenta: lo retenido, lo que se repone y si pidió esperar la confirmación. */
function retencion() {
  const r = {
    hacer: [] as Array<() => void>,
    descartes: [] as Array<() => void>,
    pidio: 0,
    confirmar: () => r.hacer.splice(0).forEach((f) => f()),
    descartar: () => r.descartes.splice(0).forEach((f) => f()),
    retener: { hacer: (f: () => void) => void r.hacer.push(f), alDescartar: (f: () => void) => void r.descartes.push(f), recordar: () => undefined, esperarConfirmacion: () => void r.pidio++ },
  };
  return r;
}
const turno = (mensaje: string, o: Record<string, unknown> = {}) => T.resolverDecisionesDelTurno({ dueno: JOSE, ambito: AMB, mensaje, whatsapp: false, registrarEfecto: async () => true, ...o } as any);

/* ------------------------------------------------------------------ las decisiones, con su retención */

for (const frase of ['Mejor no.', 'Nel.']) {
  test(`«${frase}» de un turno de voz que se descarta repone el borrador (mismo intento); confirmado, queda descartado`, async () => {
    await conEntorno(async ({ mandados }) => {
      await correoParaAna();
      const b = C.borradorDe(JOSE, AMB)!;
      const r1 = retencion();
      await turno(frase, { retener: r1.retener });
      assert.equal(C.borradorDe(JOSE, AMB), null, 'en el acto el resto del turno lo ve descartado (como confirmado)');
      assert.ok(r1.pidio > 0, 'el turno pide esperar su confirmación aunque no tenga acciones');
      r1.descartar(); // la frase seguía: «…bueno, sí, mándalo»
      assert.equal(C.borradorDe(JOSE, AMB)?.intento, b.intento, 'repuesto: sigue esperando su respuesta en el chat');
      assert.equal(C.borradorDe(JOSE, AMB)?.soloPanel, undefined);
      // El mismo «no», confirmado esta vez, sí lo descarta (y no sale nada).
      const r2 = retencion();
      await turno(frase, { retener: r2.retener });
      r2.confirmar();
      assert.equal(C.borradorDe(JOSE, AMB), null);
      assert.equal(mandados.length, 0);
    });
  });
}

test('«Mmm, déjame pensar.» de un turno descartado no aparta el borrador para el panel (vuelve al chat)', async () => {
  await conEntorno(async () => {
    await correoParaAna();
    const r = retencion();
    await turno('Mmm, déjame pensar.', { retener: r.retener });
    assert.equal(C.borradorDe(JOSE, AMB)?.soloPanel, true, 'en el acto, apartado (siguió con otra cosa)');
    assert.ok(r.pidio > 0);
    r.descartar();
    assert.notEqual(C.borradorDe(JOSE, AMB)?.soloPanel, true, 'descartado el turno, el chat lo sigue resolviendo');
  });
});

test('el «no» de la voz cierra su tarjeta del panel solo al confirmarse; descartado, la tarjeta sigue abierta', async () => {
  await conEntorno(async () => {
    await correoParaAna();
    const b = C.borradorDe(JOSE, AMB)!;
    const ref = await TR.abrirDecisionDeBorrador(JOSE, AMB, { canal: 'correo', intento: b.intento, para: b.para.join(', '), texto: b.texto, vence: b.vence, huella: b.huella });
    assert.ok(ref);
    const r = retencion();
    await turno('nel', { retener: r.retener });
    r.descartar();
    await dormir(150);
    const l = await TD.leerTarea(JOSE, ref!.id);
    assert.ok(l.ok && l.tarea && l.tarea.estado !== 'cancelled', `la tarjeta no se cerró por un turno descartado (${l.ok && l.tarea?.estado})`);
    assert.ok(r.hacer.length >= 1, 'el cierre quedó retenido para la confirmación (que no llegó)');
  });
});

test('si mientras tanto la persona lo RECHAZÓ en su panel, el turno descartado no lo repone (lo borrado no reaparece)', async () => {
  await conEntorno(async () => {
    await correoParaAna();
    const b = C.borradorDe(JOSE, AMB)!;
    const r = retencion();
    await turno('mejor no', { retener: r.retener });
    const panel = await T.resolverBorradorDesdePanel(JOSE, 'correo', AMB, b.intento, 'no');
    assert.notEqual(panel.estado, 'succeeded');
    r.descartar();
    assert.equal(C.borradorDe(JOSE, AMB), null, 'rechazado en el panel: no vuelve');
  });
});

test('sin nada esperando decisión, el turno no pide esperar la confirmación (la charla no se frena)', async () => {
  await conEntorno(async () => {
    const r = retencion();
    await turno('¿qué hora es?', { retener: r.retener });
    assert.equal(r.pidio, 0);
  });
});

/* ------------------------------------------------------------------ MENOR 8: el aviso de lo vencido */

test('MENOR 8: el aviso de un borrador vencido dicho en un turno de voz descartado no se gasta; confirmado, sí (una vez)', async () => {
  await conEntorno(async () => {
    await correoParaAna();
    C.borradorDe(JOSE, AMB)!.vence = Date.now() - 1;
    const r1 = retencion();
    const a = await turno('hola, ¿cómo vas?', { retener: r1.retener });
    assert.match(a.hechos.join('\n'), /QUEDÓ ATRÁS/);
    assert.ok(r1.pidio > 0, 'con un aviso pendiente, el turno espera su confirmación');
    r1.descartar(); // nadie lo oyó
    const r2 = retencion();
    const b = await turno('hola, ¿cómo vas?', { retener: r2.retener });
    assert.match(b.hechos.join('\n'), /QUEDÓ ATRÁS/, 'el turno descartado no lo dejó por dicho');
    r2.confirmar();
    const c = await turno('¿y ahora?', { retener: retencion().retener });
    assert.doesNotMatch(c.hechos.join('\n'), /QUEDÓ ATRÁS/, 'confirmado, se dijo una vez');
  });
});

/* ------------------------------------------------------------------ la ruta de la voz (server/voz-agente.ts) */

const BEARER = `Bearer ${secretoDerivado(VA.ETIQUETA_SECRETO_LLM)}`;
/** La ruta real del LLM propio; el cerebro resuelve las decisiones con la retención del turno, como prepararTurno. */
async function montarVoz(o: { confirmarAccionMs: number; graciaReintentoMs: number }) {
  const vistos: Array<{ mensaje: string; borrador: boolean; soloPanel: boolean }> = [];
  const app = express();
  app.use(express.json());
  const pasa: express.RequestHandler = (_q, _s, next) => next();
  VA.montarVozAgente(app, {
    exigirMesaODesk: pasa,
    limitar: () => pasa,
    sesionDe: () => null,
    puenteMs: 0,
    etiquetas: false,
    confirmarAccionMs: o.confirmarAccionMs,
    graciaReintentoMs: o.graciaReintentoMs,
    turno: async (t: TurnoVoz) => {
      const b = C.borradorDe(JOSE, AMB);
      vistos.push({ mensaje: t.body.message, borrador: !!b, soloPanel: b?.soloPanel === true });
      await turno(t.body.message, { retener: t.retener, hablado: true });
      t.enviar('delta', { text: 'Va.', voz: 'Va.' });
      t.enviar('done', { reply: 'Va.' });
    },
  });
  const srv = app.listen(0);
  await new Promise((r) => srv.once('listening', r));
  const base = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
  const s = emitirSesion({ correo: JOSE, nombre: 'José', rol: 'Junta' });
  const p = VA.emitirPase(s, 'aura', 'es');
  VA.abrirConversacion(s.correo, p.cid);
  const llm = (frase: string, signal?: AbortSignal) =>
    fetch(`${base}/api/voz/llm/chat/completions`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: BEARER, 'x-pase': p.pase }, body: JSON.stringify({ model: 'aura', stream: true, messages: [{ role: 'user', content: frase }] }), signal });
  return { vistos, llm, cerrar: () => new Promise((r) => srv.close(r)) };
}

test('ruta de la voz: «déjame pensar» que termina rápido NO se confirma solo; la frase que sigue lo descarta y encuentra el borrador en el chat', async () => {
  await conEntorno(async () => {
    await correoParaAna();
    const v = await montarVoz({ confirmarAccionMs: 600, graciaReintentoMs: 2_000 });
    try {
      const r1 = v.llm('Mmm, déjame pensar.').then((r) => r.text());
      await dormir(150); // la respuesta ya terminó; ElevenLabs la sigue escuchando
      // Antes, sin acciones, el turno se daba por confirmado al terminar y el borrador quedaba apartado.
      const r2 = await (await v.llm('Mmm, déjame pensar, bueno, cuéntame el clima.')).text();
      assert.match(r2, /Va\./);
      await r1;
      assert.equal(v.vistos.length, 2);
      assert.deepEqual(v.vistos[1], { mensaje: 'Mmm, déjame pensar, bueno, cuéntame el clima.', borrador: true, soloPanel: false }, 'el turno descartado lo devolvió al chat antes del siguiente');
    } finally {
      await v.cerrar();
    }
  });
});

test('ruta de la voz: «mejor no» cuya respuesta ElevenLabs cierra sin reintentar (la persona siguió) no descarta el borrador', async () => {
  await conEntorno(async ({ mandados }) => {
    await correoParaAna();
    const b = C.borradorDe(JOSE, AMB)!;
    const v = await montarVoz({ confirmarAccionMs: 800, graciaReintentoMs: 150 });
    try {
      const c = new AbortController();
      const r = v.llm('Mejor no.', c.signal).then((x) => x.text()).catch(() => '');
      await dormir(150);
      c.abort();
      await r;
      await dormir(400); // pasa la gracia del reintento: el turno se descarta
      assert.equal(C.borradorDe(JOSE, AMB)?.intento, b.intento, 'el «no» de la frase a medias no lo borró');
      assert.equal(mandados.length, 0);
    } finally {
      await v.cerrar();
    }
  });
});

test('ruta de la voz: el mismo «mejor no» que ElevenLabs sigue escuchando se confirma y lo descarta', async () => {
  await conEntorno(async () => {
    await correoParaAna();
    const v = await montarVoz({ confirmarAccionMs: 200, graciaReintentoMs: 1_000 });
    try {
      assert.match(await (await v.llm('Mejor no.')).text(), /Va\./);
      assert.equal(C.borradorDe(JOSE, AMB), null, 'confirmado: queda descartado');
    } finally {
      await v.cerrar();
    }
  });
});

/* ------------------------------------------------------------------ MENOR 5: lo presentado, cuando se entregó */

const PD = await import('../server/presentacion-decision');

test('MENOR 5: un borrador armado en un turno que se corta antes de entregar su respuesta NO queda presentado: el «sí» escrito no lo manda', async () => {
  await conEntorno(async ({ mandados }) => {
    PD._olvidarPresentaciones();
    const turnoCortado = PD.presentacionesDelTurno();
    await turnoCortado.correr(() => correoParaAna()); // el turno armó el borrador... y se cortó (sin `done`)
    turnoCortado.descartar();
    const r = await turno('sí');
    assert.equal(mandados.length, 0, 'lo que nunca se le entregó no se aprueba con un «sí» escrito');
    assert.match(r.hechos.join('\n'), /NO se mandó nada/);
    assert.match(r.hechos.join('\n'), /Va el informe/, 'se le presenta ESA versión y se le pregunta');
  });
});

test('MENOR 5: el mismo turno, con su respuesta entregada, sí deja el borrador presentado (el «sí» escrito lo manda una vez)', async () => {
  await conEntorno(async ({ mandados }) => {
    PD._olvidarPresentaciones();
    const t = PD.presentacionesDelTurno();
    await t.correr(() => correoParaAna());
    assert.equal(PD.ultimaPresentacion(JOSE, AMB), null, 'armado, todavía no presentado');
    t.entregar(); // el `done` salió
    assert.equal(PD.ultimaPresentacion(JOSE, AMB)?.via, 'chat');
    await turno('sí');
    assert.equal(mandados.length, 1);
  });
});

test('MENOR 5: en la voz, lo presentado cuenta cuando el turno se confirma (entregaDelTurno va a retener.hacer en server.ts)', async () => {
  await conEntorno(async () => {
    PD._olvidarPresentaciones();
    const t = PD.presentacionesDelTurno();
    const r = retencion();
    await t.correr(async () => {
      await correoParaAna();
      r.retener.hacer(PD.entregaDelTurno()); // lo que hace terminar() al mandar el `done` con retener
    });
    assert.equal(PD.ultimaPresentacion(JOSE, AMB), null, 'sin confirmar, nada presentado');
    r.confirmar();
    assert.equal(PD.ultimaPresentacion(JOSE, AMB)?.via, 'chat');
  });
  // El cableado en el servidor: el stream y la voz entregan con el `done` (no con la persona ida) y el JSON tras responder.
  const src = fs.readFileSync(path.join(process.cwd(), 'server.ts'), 'utf8');
  assert.match(src, /return presentacionesDelTurno\(\)\.correr\(\(\) => enTurno\(reg,/);
  assert.match(src, /send\('done', datos\);[\s\S]{0,400}if \(!senal\?\.aborted\) \{\s*const entregar = entregaDelTurno\(\);\s*if \(opciones\.retener\) opciones\.retener\.hacer\(entregar\);\s*else entregar\(\);/);
  assert.match(src, /res\.json\(jsonDelTurno\(g, \{ foto: out\.foto \}\)\);\s*\/\/[^\n]*\n\s*if \(!res\.destroyed\) presentaciones\.entregar\(\);/);
});
