/**
 * La iniciativa de AURA (lib/iniciativa.ts, server/iniciativa.ts y SERVIR_CON_INICIATIVA en server/desk.ts):
 * horas quietas y ritmo por ajuste (con reloj inyectado), backoff tras un «no», propuestas del modelo
 * validadas y sin repetir, respaldo fijo con el modelo caído, nada se escribe si S3 no se pudo leer, las
 * rutas solo sirven a la persona de la sesión, y la personalidad trae el bloque (y su versión corta).
 */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import type { AddressInfo } from 'node:net';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'iniciativa-'));
process.env.ULTRON_INICIATIVA_DIR = path.join(dir, 'iniciativa');
process.env.ULTRON_MISIONES_DIR = path.join(dir, 'misiones');
process.env.ULTRON_PERFILES_DIR = path.join(dir, 'perfiles');
process.env.ULTRON_MEMORIA_MIEMBROS_DIR = path.join(dir, 'memoria-miembros');
process.env.ULTRON_AVISOS_DIR = path.join(dir, 'avisos');
process.env.ULTRON_MEMORIA_BUCKET = '';
after(() => fs.rmSync(dir, { recursive: true, force: true }));

const ini = await import('../lib/iniciativa');
const { crearMision, AlmacenNoDisponible } = await import('../lib/misiones');
const { validarCambios, iniciativaDe, guardarPerfil, perfilInicial } = await import('../lib/perfil-persona');
const { montarRutasIniciativa, arrancarIniciativa, bloqueIniciativaTurno, duenoMisiones, accionIniciativa } = await import('../server/iniciativa');
const { buildPersonality, SERVIR_CON_INICIATIVA, SERVIR_CON_INICIATIVA_CORTO } = await import('../server/desk');

const H = 3_600_000;
const DIA = 86_400_000;
/** 07:30 en Honduras (UTC-6). */
const MANANA = Date.parse('2026-10-02T13:30:00Z');
/** 14:00 en Honduras. */
const TARDE = Date.parse('2026-10-02T20:00:00Z');
let n = 0;
const correo = () => `ini-${Date.now()}-${n++}@ejemplo.com`;

async function conS3Caido(f: (puts: () => number) => Promise<void>) {
  const original = globalThis.fetch;
  let puts = 0;
  globalThis.fetch = (async (url: any, init: any = {}) => {
    const u = new URL(String(url));
    if (!u.hostname.endsWith('.amazonaws.com')) return original(url, init);
    if (init.method === 'PUT') puts++;
    return new Response('fuera', { status: 503 });
  }) as typeof fetch;
  const antes = { b: process.env.ULTRON_MEMORIA_BUCKET, a: process.env.AWS_ACCESS_KEY_ID, s: process.env.AWS_SECRET_ACCESS_KEY };
  Object.assign(process.env, { ULTRON_MEMORIA_BUCKET: 'cubo-prueba', AWS_ACCESS_KEY_ID: 'AKIAPRUEBA', AWS_SECRET_ACCESS_KEY: 'secreto-prueba' });
  try {
    await f(() => puts);
  } finally {
    globalThis.fetch = original;
    Object.assign(process.env, { ULTRON_MEMORIA_BUCKET: antes.b || '', AWS_ACCESS_KEY_ID: antes.a || '', AWS_SECRET_ACCESS_KEY: antes.s || '' });
  }
}

const buenas = JSON.stringify([
  { texto: 'Vi que querías cotizar paneles solares. ¿Quieres que busque tres opciones y te las tenga en cinco minutos?', tipo: 'ayuda', pedido: 'Sí, búscame las tres mejores opciones de paneles solares en Honduras.', prioridad: 1 },
  { texto: '¿Cómo te fue con la reunión del banco? Si quieres te preparo un resumen.', tipo: 'seguimiento', pedido: 'Te cuento cómo me fue con la reunión del banco.', prioridad: 2 },
  { texto: 'Me encantaría saber qué música te gusta. ¿Me cuentas?', tipo: 'conocer', pedido: 'Te cuento qué música me gusta.', prioridad: 3 },
]);

/* ------------------------------------------------------------------ reloj y ritmo */

test('horas quietas: de 21:00 a 07:00 en Honduras no se propone nada', () => {
  assert.equal(ini.enHorasQuietas(Date.parse('2026-10-03T04:00:00Z')), true, '22:00');
  assert.equal(ini.enHorasQuietas(Date.parse('2026-10-02T12:59:00Z')), true, '06:59');
  assert.equal(ini.enHorasQuietas(Date.parse('2026-10-02T13:00:00Z')), false, '07:00');
  assert.equal(ini.enHorasQuietas(Date.parse('2026-10-03T02:59:00Z')), false, '20:59');
  assert.deepEqual(ini.horaHonduras(TARDE), { hora: 14, minuto: 0, dia: '2026-10-02' });
});

test('ritmo por ajuste: alta cada 2 h, media 3 al día cada 4 h, baja 1 al día, apagada nada; el «no» duplica el intervalo', () => {
  const dia = ini.horaHonduras(MANANA).dia;
  const e = { ultima: MANANA, backoff: 1, dia, hoy: 1 };
  assert.equal(ini.tocaProponer({ ultima: 0, backoff: 1, dia: '', hoy: 0 }, 'media', MANANA).toca, true, 'la primera vez toca');
  assert.equal(ini.tocaProponer(e, 'media', MANANA + 3 * H).motivo, 'muy_pronto');
  assert.equal(ini.tocaProponer(e, 'media', MANANA + 4 * H).toca, true);
  assert.equal(ini.tocaProponer(e, 'alta', MANANA + 2 * H).toca, true);
  assert.equal(ini.tocaProponer({ ...e, hoy: 3 }, 'media', MANANA + 5 * H).motivo, 'tope_del_dia');
  assert.equal(ini.tocaProponer({ ...e, hoy: 3, dia: '2026-10-01' }, 'media', MANANA + 5 * H).toca, true, 'otro día, otra cuenta');
  assert.equal(ini.tocaProponer(e, 'baja', MANANA + 5 * H).motivo, 'tope_del_dia');
  assert.equal(ini.tocaProponer(e, 'apagada', MANANA + 5 * H).motivo, 'apagada');
  assert.equal(ini.tocaProponer({ ...e, backoff: 2 }, 'media', MANANA + 5 * H).motivo, 'muy_pronto', 'con un «no», 8 h');
  assert.equal(ini.tocaProponer({ ...e, backoff: 2 }, 'media', MANANA + 8 * H).toca, true);
  assert.equal(ini.tocaProponer({ ultima: 0, backoff: 1, dia: '', hoy: 0 }, 'alta', Date.parse('2026-10-03T04:00:00Z')).motivo, 'horas_quietas');
});

/* ------------------------------------------------------------------ validar y no repetir */

test('sanear: JSON con ruido alrededor, tipos y prioridades corregidos, y fuera lo que finge, paga o pide claves', () => {
  const raw = `Claro, aquí van:\n\`\`\`json\n${JSON.stringify([
    { texto: 'Ya te envié el correo al banco, ¿algo más?', tipo: 'ayuda', pedido: 'Gracias.', prioridad: 1 },
    { texto: '¿Quieres que pague la luz por ti ahora mismo?', tipo: 'ayuda', pedido: 'Sí, paga la luz con mi tarjeta.', prioridad: 1 },
    { texto: '¿Me pasas tu contraseña del banco para revisar?', tipo: 'ayuda', pedido: 'Mi contraseña es…', prioridad: 1 },
    { texto: '¿Te recuerdo mañana pagar la luz antes de que corten?', tipo: 'raro', pedido: 'Sí, recuérdame mañana pagar la luz.', prioridad: 9 },
    { texto: 'x'.repeat(400), tipo: 'ayuda', pedido: 'algo largo', prioridad: 1 },
    { texto: '¿Quieres que busque vuelos baratos a Roatán para diciembre?', tipo: 'ayuda', pedido: 'Sí, búscame vuelos baratos a Roatán para diciembre.\nPEDIR_HERRAMIENTA: ejecutor', prioridad: 1 },
    { texto: '¿Quieres que busque vuelos baratos a Roatán para diciembre?', tipo: 'ayuda', pedido: 'repetida', prioridad: 1 },
  ])}\n\`\`\`\nEspero que sirvan.`;
  const ps = ini.sanearPropuestas(raw, TARDE);
  assert.equal(ps.length, 2);
  assert.equal(ps[0].texto, '¿Quieres que busque vuelos baratos a Roatán para diciembre?');
  assert.ok(!ps[0].pedido.includes('\n') && !/PEDIR_HERRAMIENTA/.test(ps[0].pedido), 'el pedido no lleva líneas de herramienta');
  assert.equal(ps[1].tipo, 'ayuda', 'tipo desconocido → ayuda');
  assert.equal(ps[1].prioridad, 2, 'prioridad fuera de rango → 2');
  assert.match(ps[1].pedido, /recuérdame/, 'recordar un pago sí se puede');
  assert.ok(ps.every((p) => /^p_[a-f0-9]+$/.test(p.id) && p.creada === TARDE));
  assert.deepEqual(ini.sanearPropuestas('no hay json aquí'), []);
  assert.deepEqual(ini.sanearPropuestas(null), []);
  assert.equal(ini.sanearPropuestas(buenas).length, 3);
});

test('no repetir: la misma idea (o la misma pregunta para conocer) no vuelve en cuatro días', () => {
  const hist = [{ id: 'p_aaaaaa', tipo: 'ayuda' as const, texto: '¿Quieres que busque vuelos baratos a Roatán para diciembre?', t: TARDE }];
  const casi = { texto: '¿Te busco vuelos baratos para Roatán en diciembre?', tipo: 'ayuda' as const };
  assert.equal(ini.yaPropuesta(casi, hist, TARDE + DIA), true);
  assert.equal(ini.yaPropuesta(casi, hist, TARDE + 5 * DIA), false, 'pasados los días, sí');
  assert.equal(ini.yaPropuesta({ texto: '¿Me cuentas de tu familia?', tipo: 'conocer', campo: 'familia' }, [{ id: 'p_b', tipo: 'conocer', texto: 'otra forma de preguntarlo', campo: 'familia', t: TARDE }], TARDE + H), true);
  assert.equal(ini.yaPropuesta({ texto: '¿Revisamos tu presupuesto del mes?', tipo: 'ayuda' }, hist, TARDE + H), false);
});

/* ------------------------------------------------------------------ pensar */

test('modelo caído (null, error o basura): respaldo fijo — seguir la misión estancada, el plan de la mañana, conocer', async () => {
  const c = correo();
  await crearMision(c, { titulo: 'Vender el carro', pasos: ['Tomar fotos', 'Publicar'] }, MANANA - 5 * DIA);
  const { leerMisiones } = await import('../lib/misiones');
  const r = await leerMisiones(c);
  assert.ok(r.ok);
  const misiones = r.ok ? r.misiones : [];
  for (const modelo of [null, async () => null, async () => { throw new Error('caído'); }, async () => 'no sé']) {
    const p = await ini.pensarPropuestas({ correo: c, nombre: 'José' }, { ahora: MANANA, misiones, perfil: perfilInicial({ apodo: 'Chepe' }), modelo: modelo as any });
    assert.equal(p.origen, 'respaldo');
    assert.ok(p.propuestas.length >= 1 && p.propuestas.length <= 3);
    const tipos = p.propuestas.map((x) => x.tipo);
    assert.equal(tipos[0], 'seguimiento');
    assert.match(p.propuestas[0].texto, /Vender el carro/);
    assert.match(p.propuestas[0].pedido, /Tomar fotos/);
    assert.ok(tipos.includes('dia'), 'de mañana, el plan del día');
    assert.ok(tipos.includes('conocer'));
  }
  // De tarde, sin misiones y con correo sin leer: nada de «plan del día».
  const tarde = await ini.pensarPropuestas({ correo: c }, { ahora: TARDE, misiones: [], perfil: null, correoSinLeer: 4, modelo: null });
  assert.ok(!tarde.propuestas.some((x) => x.tipo === 'dia'));
  assert.ok(tarde.propuestas.some((x) => /4 correos sin leer/.test(x.texto)));
});

test('con modelo: usa lo suyo validado, con el contexto compacto, y si solo trae repetidas cae al respaldo', async () => {
  let visto = '';
  const modelo = async (_s: string, u: string) => {
    visto = u;
    return buenas;
  };
  const p = await ini.pensarPropuestas({ correo: correo(), nombre: 'José', nivel: 'junta' }, { ahora: TARDE, perfil: perfilInicial({ apodo: 'Chepe' }), correoSinLeer: 2, whatsappSinLeer: 1, hilo: [{ rol: 'user', texto: 'tengo que cotizar paneles solares' }], modelo });
  assert.equal(p.origen, 'modelo');
  assert.equal(p.propuestas.length, 3);
  assert.match(visto, /AHORA: 14:00 en Honduras, de tarde/);
  assert.match(visto, /PERSONA: Chepe \(junta directiva/);
  assert.match(visto, /AÚN NO SABES DE SU VIDA: dónde vive/);
  assert.match(visto, /2 correos sin leer; 1 chats de WhatsApp/);
  assert.match(visto, /cotizar paneles solares/);
  assert.ok(visto.length < 1500, `contexto compacto (${visto.length})`);
  const historial = p.propuestas.map((x) => ({ id: x.id, tipo: x.tipo, texto: x.texto, t: TARDE }));
  const otra = await ini.pensarPropuestas({ correo: correo() }, { ahora: TARDE + H, historial, modelo });
  assert.equal(otra.origen, 'respaldo', 'todo lo del modelo ya se había propuesto');
  assert.ok(otra.propuestas.every((x) => !historial.some((h) => h.texto === x.texto)));
});

/* ------------------------------------------------------------------ el estado y el ritmo guardados */

test('siguiente y responder: una pendiente a la vez, la cola sin volver al modelo, «no» frena, «sí» devuelve el pedido', async () => {
  const c = correo();
  let llamadas = 0;
  const modelo = async () => {
    llamadas++;
    return buenas;
  };
  const persona = { correo: c, nombre: 'José' };
  const r1 = await ini.siguientePropuesta(persona, { ahora: MANANA, modelo });
  assert.equal(r1.nueva, true);
  assert.equal(r1.origen, 'modelo');
  assert.equal(r1.propuesta?.prioridad, 1);
  const r2 = await ini.siguientePropuesta(persona, { ahora: MANANA + 10 * 60_000, modelo });
  assert.equal(r2.nueva, false);
  assert.equal(r2.propuesta?.id, r1.propuesta?.id, 'la misma pendiente, sin contar otra');
  assert.equal(llamadas, 1);

  assert.deepEqual(await ini.responderPropuesta(c, 'p_000000', 'si', MANANA + H), { ok: false, pedido: null, backoff: 1 }, 'otra id no vale');
  const no = await ini.responderPropuesta(c, r1.propuesta!.id, 'no', MANANA + H);
  assert.deepEqual(no, { ok: true, pedido: null, backoff: 2 });
  assert.equal((await ini.siguientePropuesta(persona, { ahora: MANANA + 5 * H, modelo })).motivo, 'muy_pronto', 'con el «no», 8 h');
  const r3 = await ini.siguientePropuesta(persona, { ahora: MANANA + 8 * H, modelo });
  assert.equal(r3.nueva, true);
  assert.equal(r3.origen, 'cola', 'la segunda sale de la cola');
  assert.equal(llamadas, 1);
  const si = await ini.responderPropuesta(c, r3.propuesta!.id, 'si', MANANA + 8 * H + 60_000);
  assert.equal(si.ok, true);
  assert.equal(si.pedido, r3.propuesta!.pedido);
  assert.equal(si.backoff, 1, 'el «sí» devuelve el ritmo');

  // A las 21:00 ya no.
  assert.equal((await ini.siguientePropuesta(persona, { ahora: Date.parse('2026-10-03T03:30:00Z'), modelo })).motivo, 'horas_quietas');
  assert.equal((await ini.siguientePropuesta(persona, { ahora: TARDE + DIA, modelo, nivelIniciativa: 'apagada' })).motivo, 'apagada');

  // Lo guardado sobrevive a la caché.
  ini._olvidarCacheIniciativa();
  const est = await ini.leerEstadoIniciativa(c);
  assert.ok(est.ok);
  if (est.ok) {
    assert.equal(est.estado.historial.length, 2);
    assert.deepEqual(est.estado.historial.map((h) => h.respuesta), ['no', 'si']);
  }
});

test('una pendiente sin contestar caduca a las 8 h y no cuenta como «no»', async () => {
  const c = correo();
  const r1 = await ini.siguientePropuesta({ correo: c }, { ahora: MANANA, modelo: null, nivelIniciativa: 'alta' });
  assert.ok(r1.propuesta);
  const r2 = await ini.siguientePropuesta({ correo: c }, { ahora: MANANA + 9 * H, modelo: null, nivelIniciativa: 'alta' });
  assert.equal(r2.nueva, true);
  assert.notEqual(r2.propuesta?.id, r1.propuesta?.id);
  const est = await ini.leerEstadoIniciativa(c);
  assert.ok(est.ok && est.estado.historial[0].respuesta === 'caducada' && est.estado.backoff === 1);
});

test('«deja de proponer»: se reconoce y frena al máximo', async () => {
  for (const t of ['deja de proponer cosas', 'Ya no me propongas nada', 'no me sugieras más', 'para de sugerir']) assert.ok(ini.pideDejarDeProponer(t), t);
  for (const t of ['propón algo', 'deja de hablar de eso']) assert.ok(!ini.pideDejarDeProponer(t), t);
  const c = correo();
  await ini.siguientePropuesta({ correo: c }, { ahora: MANANA, modelo: null });
  await ini.frenarIniciativa(c, MANANA + H);
  const est = await ini.leerEstadoIniciativa(c);
  assert.ok(est.ok && est.estado.backoff === ini.BACKOFF_MAX && est.estado.pendiente === null);
});

test('S3 caído al leer el estado: no se propone ni se responde, y no se sube nada encima', async () => {
  await conS3Caido(async (puts) => {
    const c = correo();
    await assert.rejects(() => ini.siguientePropuesta({ correo: c }, { ahora: TARDE, modelo: null }), (e: unknown) => e instanceof AlmacenNoDisponible);
    await assert.rejects(() => ini.responderPropuesta(c, 'p_aaaaaa', 'no', TARDE), (e: unknown) => e instanceof AlmacenNoDisponible);
    assert.equal(puts(), 0);
  });
});

/* ------------------------------------------------------------------ rutas y reloj */

test('rutas: la persona sale de la sesión, nunca de la consulta; propuestas y misiones de cada quien', async () => {
  const a = correo();
  const b = correo();
  const app = express();
  app.use(express.json());
  const pasa = ((_q: express.Request, _s: express.Response, nx: express.NextFunction) => nx()) as express.RequestHandler;
  montarRutasIniciativa(app, {
    exigirMesa: pasa,
    limitar: () => pasa,
    sesionDe: (req) => (req.headers['x-quien'] ? { correo: String(req.headers['x-quien']), nombre: 'Prueba' } : null),
    modelo: null,
    reloj: () => TARDE,
  });
  const srv = app.listen(0, '127.0.0.1');
  await new Promise((r) => srv.once('listening', r));
  const base = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
  try {
    const pedir = (ruta: string, quien: string | null, cuerpo?: unknown) =>
      fetch(`${base}${ruta}`, { method: cuerpo ? 'POST' : 'GET', headers: { 'content-type': 'application/json', ...(quien ? { 'x-quien': quien } : {}) }, body: cuerpo ? JSON.stringify(cuerpo) : undefined });

    assert.equal((await pedir('/api/iniciativa', null)).status, 401);
    assert.equal((await pedir('/api/misiones', null)).status, 401);

    const ga = await (await pedir(`/api/iniciativa?correo=${encodeURIComponent(b)}`, a)).json();
    assert.equal(ga.honesto, true);
    assert.equal(ga.iniciativa, 'media');
    assert.ok(ga.propuesta?.id && ga.propuesta.texto && ga.propuesta.pedido);
    // La de A no se puede contestar desde la sesión de B.
    assert.equal((await pedir('/api/iniciativa/responder', b, { id: ga.propuesta.id, respuesta: 'si' })).status, 404);
    assert.equal((await pedir('/api/iniciativa/responder', a, { id: ga.propuesta.id, respuesta: 'quizá' })).status, 400);
    const si = await (await pedir('/api/iniciativa/responder', a, { id: ga.propuesta.id, respuesta: 'sí' })).json();
    assert.equal(si.ok, true);
    assert.equal(si.pedido, ga.propuesta.pedido);
    const otra = await (await pedir('/api/iniciativa', a)).json();
    assert.equal(otra.propuesta, null);
    assert.equal(otra.motivo, 'muy_pronto');

    const creada = await (await pedir('/api/misiones', a, { accion: 'crear', titulo: 'Abrir la pulpería', objetivo: 'Abrir en enero', pasos: ['Permiso municipal', 'Proveedores'] })).json();
    assert.equal(creada.mision.numero, 1);
    assert.equal((await pedir('/api/misiones', a, { accion: 'crear', titulo: '' })).status, 400);
    assert.deepEqual((await (await pedir('/api/misiones', b)).json()).misiones, [], 'B no ve las de A');
    assert.equal((await pedir('/api/misiones', b, { accion: 'avanzar', id: creada.mision.id, nota: 'hola' })).status, 404, 'ni las toca');
    const av = await (await pedir('/api/misiones', a, { accion: 'avanzar', id: creada.mision.id, pasoHecho: 1 })).json();
    assert.equal(av.mision.proximoPaso, 'Proveedores');
    const lista = await (await pedir('/api/misiones', a)).json();
    assert.equal(lista.misiones.length, 1);
    assert.equal(lista.misiones[0].numero, 1);
    await pedir('/api/misiones', a, { accion: 'cerrar', id: creada.mision.id });
    assert.equal((await (await pedir('/api/misiones', a)).json()).misiones.length, 0);
    assert.equal((await (await pedir('/api/misiones?todas=1', a)).json()).misiones[0].estado, 'hecha');
    assert.equal((await pedir('/api/misiones', a, { accion: 'volar', id: 'x' })).status, 400);
  } finally {
    srv.close();
  }
});

test('rutas: con la iniciativa apagada en su perfil, nada', async () => {
  const a = correo();
  await guardarPerfil(a, { ...perfilInicial({ apodo: 'Tranquilo' }), iniciativa: 'apagada' });
  const app = express();
  app.use(express.json());
  const pasa = ((_q: express.Request, _s: express.Response, nx: express.NextFunction) => nx()) as express.RequestHandler;
  montarRutasIniciativa(app, { exigirMesa: pasa, limitar: () => pasa, sesionDe: () => ({ correo: a }), modelo: null, reloj: () => TARDE });
  const srv = app.listen(0, '127.0.0.1');
  await new Promise((r) => srv.once('listening', r));
  try {
    const j = await (await fetch(`http://127.0.0.1:${(srv.address() as AddressInfo).port}/api/iniciativa`)).json();
    assert.deepEqual({ propuesta: j.propuesta, motivo: j.motivo, iniciativa: j.iniciativa }, { propuesta: null, motivo: 'apagada', iniciativa: 'apagada' });
  } finally {
    srv.close();
  }
});

test('el reloj: entrega solo lo nuevo a alProponer, nada en horas quietas, y no arranca solo', async () => {
  const a = correo();
  const b = correo();
  let ahora = TARDE;
  const entregas: [string, string][] = [];
  const r = arrancarIniciativa({ personas: () => [{ correo: a }, { correo: b }, { correo: a }, { correo: 'sin-arroba' }], alProponer: (c, p) => entregas.push([c, p.id]), modelo: null, reloj: () => ahora, cadaMs: 10 * 60_000 });
  try {
    assert.equal(await r.vuelta(), 2);
    assert.deepEqual(entregas.map((e) => e[0]).sort(), [a, b].sort());
    assert.equal(await r.vuelta(), 0, 'lo pendiente no se vuelve a empujar');
    const est = await ini.leerEstadoIniciativa(a);
    assert.ok(est.ok && est.estado.pendiente);
    if (est.ok && est.estado.pendiente) {
      const acc = accionIniciativa(est.estado.pendiente);
      assert.equal(acc.tipo, 'iniciativa', 'el tipo de la acción no lo pisa el de la propuesta');
      assert.equal(acc.clase, est.estado.pendiente.tipo);
      assert.equal(acc.id, entregas.find((e) => e[0] === a)?.[1]);
    }
    ahora = Date.parse('2026-10-03T04:00:00Z');
    assert.equal(await r.vuelta(), 0, 'de noche, nada');
  } finally {
    r.parar();
  }
});

test('lo del turno: sus misiones y lo que aún no sabe; el dueño de Telegram sin correo no tiene misiones', async () => {
  const a = correo();
  await crearMision(a, { titulo: 'Correr diez kilómetros', pasos: ['Comprar tenis'] });
  const bloque = await bloqueIniciativaTurno(a, perfilInicial({ apodo: 'X' }));
  assert.match(bloque, /MISIONES DE LA PERSONA/);
  assert.match(bloque, /Correr diez kilómetros/);
  assert.match(bloque, /AÚN NO SABES DE SU VIDA: dónde vive/);
  assert.equal(duenoMisiones('Persona-Que-No-Existe'), '');
  assert.equal(duenoMisiones('  A@B.HN '), 'a@b.hn');
  assert.equal(await bloqueIniciativaTurno(''), '');
});

/* ------------------------------------------------------------------ el ajuste y la personalidad */

test('el ajuste del perfil: alta, media, baja o apagada; sin elegir, media', () => {
  assert.ok(validarCambios({ iniciativa: 'alta' }).ok);
  assert.equal(validarCambios({ iniciativa: 'muchísima' }).ok, false);
  assert.equal(iniciativaDe(null), 'media');
  assert.equal(iniciativaDe({ iniciativa: 'baja' }), 'baja');
});

test('la personalidad sirve con iniciativa, con frenos; la voz lleva la versión corta, dentro del presupuesto', () => {
  const largo = buildPersonality({ nombre: 'José', canal: 'mesa', modo: 'GUARDIAN', mando: true });
  assert.ok(largo.includes(SERVIR_CON_INICIATIVA));
  for (const re of [/UNA propuesta concreta/, /«¿Quieres que lo busque/, /MISIONES/, /una pregunta personal por conversación/, /triste, con prisa o en riesgo/, /«deja de proponer»/, /nunca digas que ya hiciste algo que no consta/, /su «sí» explícito/]) assert.match(largo, re);
  assert.match(largo, /TU ROL: sirves a la junta/);
  const corto = buildPersonality({ nombre: 'José', canal: 'mesa', modo: 'GUARDIAN', mando: true, compacto: true });
  assert.ok(corto.includes(SERVIR_CON_INICIATIVA_CORTO) && !corto.includes(SERVIR_CON_INICIATIVA));
  assert.ok(SERVIR_CON_INICIATIVA_CORTO.length <= 450, `corto: ${SERVIR_CON_INICIATIVA_CORTO.length}`);
  assert.ok(SERVIR_CON_INICIATIVA.length <= 1100, `largo: ${SERVIR_CON_INICIATIVA.length}`);
  assert.ok(corto.length < largo.length);
  const miembro = buildPersonality({ nombre: 'Ana', canal: 'mesa', modo: 'GUARDIAN', mando: false, nivel: 'miembro' });
  assert.match(miembro, /SERVIR CON INICIATIVA/);
  assert.match(miembro, /TU ROL: su asistente personal, que se involucra/);
  assert.ok(!miembro.includes('TU ROL: sirves a la junta'));
});

test('«luego» pospone de verdad: ese rato nada, y después vuelve LA MISMA idea primero (auditoría, 3-oct)', async () => {
  const c = correo();
  const modelo = async () => buenas;
  const persona = { correo: c, nombre: 'José' };
  const r1 = await ini.siguientePropuesta(persona, { ahora: MANANA, modelo });
  assert.ok(r1.propuesta);
  const luego = await ini.responderPropuesta(c, r1.propuesta!.id, 'luego', MANANA + 60_000);
  assert.equal(luego.ok, true);
  assert.equal((await ini.siguientePropuesta(persona, { ahora: MANANA + H, modelo })).motivo, 'luego', 'una hora después, todavía no');
  // Pasado el «luego» (y el ritmo normal entre propuestas), vuelve.
  const otra = await ini.siguientePropuesta(persona, { ahora: MANANA + 5 * H, modelo });
  assert.equal(otra.propuesta?.texto, r1.propuesta!.texto, 'la pospuesta vuelve, no se pierde como repetida');
});

test('«desactiva las propuestas» las apaga; «deja de proponer» solo frena', () => {
  for (const t of ['Desactiva las propuestas', 'apaga tus sugerencias', 'ya no quiero propuestas', 'quítame las recomendaciones']) assert.equal(ini.pideApagarIniciativa(t), true, t);
  for (const t of ['deja de proponer por hoy', 'apaga la luz', 'quiero propuestas de negocio']) assert.equal(ini.pideApagarIniciativa(t), false, t);
});

/* ------------------------------------------------------------------ AUR12: evidencia, revalidación, zona y avisos */

const { cerrarMision, leerMisiones: leerMs } = await import('../lib/misiones');
const av = await import('../lib/avisos');

async function misionesDe(c: string) {
  const r = await leerMs(c);
  return r.ok ? r.misiones : [];
}

test('cada propuesta guarda su evidencia: por qué ahora, fuente vigente, siguiente paso seguro, permiso y caducidad', async () => {
  const c = correo();
  await crearMision(c, { titulo: 'Vender el carro', pasos: ['Tomar fotos'], vence: MANANA + 12 * H }, MANANA - DIA);
  const misiones = await misionesDe(c);
  const p = await ini.pensarPropuestas({ correo: c }, { ahora: MANANA, misiones, correoSinLeer: 3, modelo: null });
  const seg = p.propuestas.find((x) => x.tipo === 'seguimiento')!;
  assert.ok(seg.evidencia, 'trae evidencia');
  assert.equal(seg.evidencia!.fuente.tipo, 'mision');
  assert.equal(seg.evidencia!.fuente.id, misiones[0].id);
  assert.equal(seg.evidencia!.fuente.version, misiones[0].actualizada, 'la versión de la fuente que se vio');
  assert.equal(seg.evidencia!.fuente.motivo, 'por_vencer');
  assert.equal(seg.evidencia!.urgente, true, 'vence pronto: candidata a urgente (solo si la clase está elegida)');
  assert.match(seg.evidencia!.porQue, /vence/);
  assert.ok(seg.evidencia!.paso.length > 5);
  assert.equal(seg.evidencia!.permiso, 'ninguno');
  assert.ok(seg.evidencia!.caduca > MANANA && seg.evidencia!.caduca <= MANANA + DIA);
  const correoP = p.propuestas.find((x) => /correos sin leer/.test(x.texto));
  assert.equal(correoP?.evidencia?.fuente.tipo, 'correo');
  assert.equal(correoP?.evidencia?.permiso, 'leer_correo');
  // Las del modelo también, pero «modelo» no es una fuente (P1/A2): ideas sin hecho → «ninguna», caducan al día.
  const m = await ini.pensarPropuestas({ correo: c }, { ahora: TARDE, modelo: async () => buenas });
  assert.ok(m.propuestas.every((x) => x.evidencia && x.evidencia.fuente.tipo === 'ninguna' && x.evidencia.caduca === TARDE + ini.CADUCA_COLA_MS));
});

test('la iniciativa prepara, no envía: una propuesta cuyo pedido manda algo a un tercero se descarta', () => {
  const raw = JSON.stringify([
    { texto: '¿Quieres que le mande el correo a Pedro con la cotización?', tipo: 'ayuda', pedido: 'Sí, mándale el correo a Pedro con la cotización.', prioridad: 1 },
    { texto: '¿Te preparo un borrador para Pedro con la cotización?', tipo: 'ayuda', pedido: 'Sí, prepárame un borrador para Pedro con la cotización.', prioridad: 2 },
    { texto: '¿Publico tu anuncio del carro en Facebook?', tipo: 'ayuda', pedido: 'Sí, publica mi anuncio del carro en Facebook.', prioridad: 2 },
  ]);
  const ps = ini.sanearPropuestas(raw, TARDE);
  assert.deepEqual(ps.map((p) => p.texto), ['¿Te preparo un borrador para Pedro con la cotización?']);
  assert.equal(ps[0].evidencia?.permiso, 'confirmar_envio', 'el envío del borrador, si llega, pide su confirmación aparte');
});

test('revalidar: caducada, misión cerrada o avanzada, fuente que no se pudo leer, correo ya leído, dato ya conocido', () => {
  const t = TARDE;
  const mision = { id: 'm_aaaaaa', titulo: 'Vender el carro', objetivo: 'x', pasos: [], proximoPaso: '', estado: 'activa' as const, notas: [], creada: t - 9 * DIA, actualizada: t - 5 * DIA };
  const p = {
    id: 'p_abcdef',
    texto: '¿Cómo vas con «Vender el carro»?',
    tipo: 'seguimiento' as const,
    pedido: 'Sí, ayúdame.',
    prioridad: 1,
    creada: t,
    misionId: 'm_aaaaaa',
    evidencia: { porQue: 'sin avance', fuente: { tipo: 'mision' as const, id: 'm_aaaaaa', version: t - 5 * DIA, motivo: 'estancada', visto: t }, paso: 'preparar', permiso: 'ninguno' as const, caduca: t + DIA },
  };
  assert.deepEqual(ini.revalidarPropuesta(p, { misiones: [mision] }, t + H), { vigente: true });
  assert.deepEqual(ini.revalidarPropuesta(p, { misiones: [mision] }, t + DIA), { vigente: false, motivo: 'caducada' });
  assert.deepEqual(ini.revalidarPropuesta(p, { misiones: [{ ...mision, estado: 'hecha' }] }, t + H), { vigente: false, motivo: 'resuelta' });
  assert.deepEqual(ini.revalidarPropuesta(p, { misiones: [] }, t + H), { vigente: false, motivo: 'resuelta' }, 'ya no existe');
  assert.deepEqual(ini.revalidarPropuesta(p, { misiones: [{ ...mision, actualizada: t + 30 * 60_000 }] }, t + H), { vigente: false, motivo: 'resuelta' }, 'avanzó: ya no está estancada');
  assert.deepEqual(ini.revalidarPropuesta(p, { misiones: null }, t + H), { vigente: false, motivo: 'fuente_no_disponible' }, 'no se pudo leer: no se inventa que sigue igual');
  const pc = { ...p, misionId: undefined, tipo: 'ayuda' as const, evidencia: { ...p.evidencia, fuente: { tipo: 'correo' as const, visto: t } } };
  // A2 (5-oct): sin el número anclado no se sabe qué cuenta el texto: aunque haya correo, tal cual no vale (se regenera o no sale).
  assert.deepEqual(ini.revalidarPropuesta(pc, { correoSinLeer: 2 }, t + H), { vigente: false, motivo: 'sin_anclaje' });
  assert.deepEqual(ini.revalidarPropuesta({ ...pc, evidencia: { ...pc.evidencia, fuente: { ...pc.evidencia.fuente, valor: 2 } } }, { correoSinLeer: 2 }, t + H), { vigente: true });
  assert.deepEqual(ini.revalidarPropuesta(pc, { correoSinLeer: 0 }, t + H), { vigente: false, motivo: 'resuelta' });
  assert.deepEqual(ini.revalidarPropuesta(pc, { correoSinLeer: null }, t + H), { vigente: false, motivo: 'fuente_no_disponible' }, 'conectada pero no se pudo leer (P1/A2: distinto de desconectada)');
  const pk = { ...p, misionId: undefined, tipo: 'conocer' as const, campo: 'musica', evidencia: { ...p.evidencia, fuente: { tipo: 'perfil' as const, id: 'musica', visto: t } } };
  assert.deepEqual(ini.revalidarPropuesta(pk, { perfil: perfilInicial({ apodo: 'X' }) }, t + H), { vigente: true });
  assert.deepEqual(ini.revalidarPropuesta(pk, { perfil: { ...perfilInicial({ apodo: 'X' }), encuesta: { musica: 'boleros' } } as any }, t + H), { vigente: false, motivo: 'resuelta' });
  // Una propuesta guardada antes de la evidencia (estado viejo): caduca al día de creada.
  const vieja = { id: 'p_fedcba', texto: 'Idea vieja', tipo: 'ayuda' as const, pedido: 'Sí.', prioridad: 2, creada: t };
  assert.deepEqual(ini.revalidarPropuesta(vieja, {}, t + H), { vigente: true });
  assert.deepEqual(ini.revalidarPropuesta(vieja, {}, t + DIA + 1), { vigente: false, motivo: 'caducada' });
});

test('REPRO: lo pospuesto con «luego» NO vuelve si mientras tanto la misión se cerró', async () => {
  const c = correo();
  await crearMision(c, { titulo: 'Vender el carro', pasos: ['Tomar fotos'] }, MANANA - 5 * DIA);
  const persona = { correo: c };
  const r1 = await ini.siguientePropuesta(persona, { ahora: MANANA, misiones: await misionesDe(c), modelo: null });
  assert.equal(r1.propuesta?.tipo, 'seguimiento');
  await ini.responderPropuesta(c, r1.propuesta!.id, 'luego', MANANA + 60_000);
  const ms = await misionesDe(c);
  await cerrarMision(c, ms[0].id, 'hecha', MANANA + H);
  const r2 = await ini.siguientePropuesta(persona, { ahora: MANANA + 5 * H, misiones: await misionesDe(c), modelo: null });
  assert.notEqual(r2.propuesta?.misionId, ms[0].id, 'el asunto resuelto no se propone');
  assert.ok(!/Vender el carro/.test(r2.propuesta?.texto || ''));
});

test('REPRO: la cola no entrega «tienes N correos sin leer» cuando ya los leyó', async () => {
  const c = correo();
  const persona = { correo: c };
  // Una misión estancada sale primero; la del correo queda en la cola.
  await crearMision(c, { titulo: 'Vender el carro', pasos: ['Tomar fotos'] }, TARDE - 5 * DIA);
  const r1 = await ini.siguientePropuesta(persona, { ahora: TARDE, misiones: await misionesDe(c), correoSinLeer: 4, modelo: null, nivelIniciativa: 'alta' });
  assert.equal(r1.propuesta?.tipo, 'seguimiento');
  const est = await ini.leerEstadoIniciativa(c);
  assert.ok(est.ok && est.estado.cola[0] && /correos sin leer/.test(est.estado.cola[0].texto), 'la idea del correo espera en la cola');
  await ini.responderPropuesta(c, r1.propuesta!.id, 'si', TARDE + 60_000);
  // Dos horas después (ritmo alta), ya los leyó: 0 sin leer.
  const r2 = await ini.siguientePropuesta(persona, { ahora: TARDE + 2 * H + 60_000, misiones: await misionesDe(c), correoSinLeer: 0, modelo: null, nivelIniciativa: 'alta' });
  assert.ok(!/correos sin leer/.test(r2.propuesta?.texto || ''), String(r2.propuesta?.texto));
});

test('«luego» con fecha explícita: esa idea no vuelve antes, las demás sí; una fecha pasada no vale', async () => {
  const c = correo();
  const persona = { correo: c };
  const modelo = async () => buenas;
  const r1 = await ini.siguientePropuesta(persona, { ahora: MANANA, modelo, nivelIniciativa: 'alta' });
  const hasta = MANANA + 3 * DIA;
  const l = await ini.responderPropuesta(c, r1.propuesta!.id, 'luego', MANANA + 60_000, { hasta });
  assert.equal(l.ok, true);
  assert.equal(l.hasta, hasta);
  const r2 = await ini.siguientePropuesta(persona, { ahora: MANANA + 3 * H, modelo, nivelIniciativa: 'alta' });
  assert.ok(r2.propuesta && r2.propuesta.id !== r1.propuesta!.id, 'otra idea sí puede salir');
  await ini.responderPropuesta(c, r2.propuesta!.id, 'si', MANANA + 3 * H + 60_000);
  const r3 = await ini.siguientePropuesta(persona, { ahora: hasta + 60_000, modelo, nivelIniciativa: 'alta' });
  assert.equal(r3.propuesta?.texto, r1.propuesta!.texto, 'pasada la fecha, vuelve (revalidada)');
  const c2 = correo();
  const r4 = await ini.siguientePropuesta({ correo: c2 }, { ahora: TARDE, modelo: null });
  await assert.rejects(() => ini.responderPropuesta(c2, r4.propuesta!.id, 'luego', TARDE, { hasta: TARDE - H }), /fecha/);
});

test('horas quietas y días en la zona de la persona (America/New_York con horario de verano)', () => {
  const julio = Date.parse('2026-07-15T11:30:00Z'); // 07:30 EDT · 05:30 Honduras
  assert.equal(ini.enHorasQuietas(julio), true, 'Honduras por omisión');
  assert.equal(ini.enHorasQuietas(julio, { zona: 'America/New_York' }), false);
  assert.equal(ini.enHorasQuietas(Date.parse('2026-12-15T11:30:00Z'), { zona: 'America/New_York' }), true, '06:30 EST');
  const e = { ultima: 0, backoff: 1, dia: '', hoy: 0 };
  assert.equal(ini.tocaProponer(e, 'media', julio, { zona: 'America/New_York' }).toca, true);
  assert.equal(ini.tocaProponer(e, 'media', julio).motivo, 'horas_quietas');
  // El tope del día cuenta el día de SU zona.
  const t = Date.parse('2026-07-15T13:00:00Z'); // 09:00 EDT del 15
  assert.equal(ini.tocaProponer({ ultima: t - 21 * H, backoff: 1, dia: '2026-07-14', hoy: 1 }, 'baja', t, { zona: 'America/New_York' }).toca, true);
  assert.equal(ini.tocaProponer({ ultima: t - 21 * H, backoff: 1, dia: '2026-07-15', hoy: 1 }, 'baja', t, { zona: 'America/New_York' }).motivo, 'tope_del_dia');
});

test('fuente desconectada: se avisa UNA vez del bloqueo y no se finge seguir revisándola', async () => {
  const c = correo();
  const persona = { correo: c };
  const r1 = await ini.siguientePropuesta(persona, { ahora: TARDE, desconectadas: ['correo'], correoSinLeer: null, modelo: null, nivelIniciativa: 'alta' });
  assert.equal(r1.propuesta?.evidencia?.fuente.tipo, 'bloqueo');
  assert.match(r1.propuesta!.texto, /correo/);
  assert.ok(!/sin leer/.test(r1.propuesta!.texto), 'no inventa cuántos hay');
  await ini.responderPropuesta(c, r1.propuesta!.id, 'no', TARDE + 60_000);
  for (const h of [20, 44, 68]) {
    const r = await ini.siguientePropuesta(persona, { ahora: TARDE + h * H, desconectadas: ['correo'], correoSinLeer: null, modelo: null, nivelIniciativa: 'alta' });
    assert.notEqual(r.propuesta?.evidencia?.fuente.tipo, 'bloqueo', `a las ${h} h no se repite`);
    if (r.propuesta) await ini.responderPropuesta(c, r.propuesta.id, 'si', TARDE + h * H + 60_000);
  }
  // Reconectado y vuelto a caer: es otro bloqueo, se avisa otra vez.
  const rec = await ini.siguientePropuesta(persona, { ahora: TARDE + 92 * H, correoSinLeer: 0, modelo: null, nivelIniciativa: 'alta' });
  if (rec.propuesta) await ini.responderPropuesta(c, rec.propuesta.id, 'si', TARDE + 92 * H + 60_000);
  const otra = await ini.siguientePropuesta(persona, { ahora: TARDE + 116 * H, desconectadas: ['correo'], correoSinLeer: null, modelo: null, nivelIniciativa: 'alta' });
  assert.equal(otra.propuesta?.evidencia?.fuente.tipo, 'bloqueo');
});

test('el reloj usa la zona de CADA persona: en Nueva York ya es de día aunque en Honduras sean horas quietas', async () => {
  const ny = correo();
  const hn = correo();
  await av.cambiarPreferencias(ny, { zona: 'America/New_York' }, Date.parse('2026-07-14T15:00:00Z'));
  const entregas: string[] = [];
  const r = arrancarIniciativa({ personas: () => [{ correo: ny }, { correo: hn }], alProponer: (c) => (entregas.push(c), 1), modelo: null, reloj: () => Date.parse('2026-07-15T11:30:00Z'), cadaMs: 10 * 60_000, sello: av.selloLocal({ dir: null }) });
  try {
    assert.equal(await r.vuelta(), 1);
    assert.deepEqual(entregas, [ny]);
  } finally {
    r.parar();
  }
});

test('dos relojes (dos réplicas) a la vez sobre el mismo almacén: UNA entrega por propuesta', async () => {
  const a = correo();
  const sellos = path.join(dir, 'sellos-reloj');
  const entregas: string[] = [];
  const mk = () =>
    arrancarIniciativa({ personas: () => [{ correo: a }], entregadores: { app: (_c, aviso) => (entregas.push(aviso.propuesta.id), 1) }, modelo: null, reloj: () => TARDE, cadaMs: 10 * 60_000, sello: av.selloLocal({ dir: sellos }) });
  const r1 = mk();
  const r2 = mk();
  try {
    await Promise.all([r1.vuelta(), r2.vuelta(), r1.vuelta()]);
    assert.equal(entregas.length, 1, JSON.stringify(entregas));
  } finally {
    r1.parar();
    r2.parar();
  }
});

test('el reloj: una propuesta entregada en la app e ignorada no se persigue por push', async () => {
  const a = correo();
  let ahora = TARDE;
  const log: string[] = [];
  const app = { vale: 1 };
  const r = arrancarIniciativa({
    personas: () => [{ correo: a }],
    entregadores: { app: (_c, x) => (log.push(`app:${x.propuesta.id}`), app.vale), push: (_c, x) => (log.push(`push:${x.propuesta.id}`), 1) },
    modelo: null,
    reloj: () => ahora,
    cadaMs: 10 * 60_000,
    sello: av.selloLocal({ dir: null }),
  });
  try {
    await r.vuelta();
    assert.equal(log.length, 1);
    assert.match(log[0], /^app:/);
    const primera = log[0].slice(4);
    // La app deja de escuchar; el reloj vuelve a pasar varias veces el mismo día.
    app.vale = 0;
    for (const m of [30, 60, 90]) {
      ahora = TARDE + m * 60_000;
      await r.vuelta();
    }
    assert.ok(!log.includes(`push:${primera}`), 'ignorar no autoriza otro canal');
  } finally {
    r.parar();
  }
});

test('rutas de avisos: preferencias de la sesión, cambios validados, posponer con fecha y «no sobre esta clase»', async () => {
  const a = correo();
  const app = express();
  app.use(express.json());
  const pasa = ((_q: express.Request, _s: express.Response, nx: express.NextFunction) => nx()) as express.RequestHandler;
  montarRutasIniciativa(app, { exigirMesa: pasa, limitar: () => pasa, sesionDe: (req) => (req.headers['x-quien'] ? { correo: String(req.headers['x-quien']) } : null), modelo: null, reloj: () => TARDE });
  const srv = app.listen(0, '127.0.0.1');
  await new Promise((r) => srv.once('listening', r));
  const base = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
  const pedir = (ruta: string, quien: string | null, cuerpo?: unknown) =>
    fetch(`${base}${ruta}`, { method: cuerpo ? 'POST' : 'GET', headers: { 'content-type': 'application/json', ...(quien ? { 'x-quien': quien } : {}) }, body: cuerpo ? JSON.stringify(cuerpo) : undefined });
  try {
    assert.equal((await pedir('/api/avisos/preferencias', null)).status, 401);
    const g = await (await pedir('/api/avisos/preferencias', a)).json();
    assert.equal(g.preferencias.maxDia, 1);
    assert.equal(g.preferencias.zona, 'America/Tegucigalpa');
    assert.equal((await pedir('/api/avisos/preferencias', a, { zona: 'Marte/Base' })).status, 400);
    const c = await (await pedir('/api/avisos/preferencias', a, { zona: 'America/New_York', canales: ['app'], menosAvisos: true })).json();
    assert.equal(c.preferencias.zona, 'America/New_York');
    assert.deepEqual(c.preferencias.canales, ['app']);
    assert.ok(c.preferencias.cadaDias > 1, '«menos avisos»');
    const pos = await (await pedir('/api/avisos/posponer', a, { fecha: '2026-10-10', hora: '09:00' })).json();
    assert.equal(pos.pospuestoHasta, Date.parse('2026-10-10T13:00:00Z'), '09:00 EDT de su zona');
    assert.equal((await pedir('/api/avisos/posponer', a, { fecha: '2020-01-01' })).status, 400, 'una fecha pasada no vale');
    // «No sobre esta clase» desde la tarjeta de la propuesta.
    await pedir('/api/avisos/preferencias', a, { pospuestoHasta: null, zona: 'America/Tegucigalpa' });
    const p = await (await pedir('/api/iniciativa', a)).json();
    assert.ok(p.propuesta?.id);
    assert.ok(p.propuesta.porQue && p.propuesta.paso && p.propuesta.caduca, 'la app puede «ver la propuesta» con su evidencia');
    const no = await (await pedir('/api/iniciativa/responder', a, { id: p.propuesta.id, respuesta: 'no', silenciar: 'clase' })).json();
    assert.equal(no.ok, true);
    const g2 = await (await pedir('/api/avisos/preferencias', a)).json();
    assert.ok(g2.preferencias.clasesApagadas.includes(p.propuesta.tipo));
  } finally {
    srv.close();
  }
});

/* ------------------------------------------------------------------ P1 / A2: avisos con evidencia de servidor */

const SI = await import('../server/iniciativa');
/** Lo que dijo el modelo en la auditoría: afirma un hecho del buzón («tres correos sin leer»). */
const MODELO_CORREO = async () =>
  JSON.stringify([{ tipo: 'ayuda', texto: 'Tienes tres correos sin leer. ¿Te resumo lo importante?', pedido: 'Revisa mi correo y resume lo importante', prioridad: 1, porque: 'Hay tres correos sin leer', fuente: 'correo' }]);
const CORREO_3 = { observaciones: { correo: { estado: 'vigente', valor: 3 } }, correoSinLeer: 3 } as const;

test('A2 REPRO: lo que afirma el modelo no es evidencia; resuelto, desconectado o sin observación ya no vale', async () => {
  const c = correo();
  const first = await ini.siguientePropuesta({ correo: c }, { ahora: TARDE, zona: 'UTC', correoSinLeer: 3, modelo: MODELO_CORREO });
  assert.equal(first.origen, 'modelo');
  assert.ok(first.propuesta);
  const f = first.propuesta!.evidencia!.fuente;
  assert.notEqual(f.tipo, 'modelo', '«modelo» no es una fuente');
  assert.equal(f.tipo, 'correo', 'apunta al candidato del servidor que sostiene lo que dice');
  assert.equal(f.version, 3, 'con la versión que se vio');
  assert.ok(f.visto === TARDE && first.propuesta!.evidencia!.caduca > TARDE, 'fecha y caducidad');
  const despues = await ini.siguientePropuesta({ correo: c }, { ahora: TARDE + 60_000, zona: 'UTC', correoSinLeer: 0, modelo: null });
  assert.notEqual(despues.propuesta?.id, first.propuesta!.id, 'el correo pasó de 3 a 0: no se vuelve a mostrar');
  const p = first.propuesta!;
  for (const [f2, motivo] of [
    [{ correoSinLeer: null, desconectadas: ['correo'] }, 'fuente_desconectada'],
    [{ observaciones: { correo: { estado: 'disconnected' } } }, 'fuente_desconectada'],
    [{ observaciones: { correo: { estado: 'not_configured' } } }, 'fuente_no_configurada'],
    [{ observaciones: { correo: { estado: 'unavailable' } } }, 'fuente_no_disponible'],
    [{ correoSinLeer: null }, 'fuente_no_disponible'],
    [{ observaciones: { correo: { estado: 'empty' } } }, 'resuelta'],
    [{ correoSinLeer: 0 }, 'resuelta'],
    [{}, 'sin_observacion'],
  ] as const) {
    assert.deepEqual(ini.revalidarPropuesta(p, f2 as any, TARDE + 2 * 60_000), { vigente: false, motivo }, JSON.stringify(f2));
  }
  assert.deepEqual(ini.revalidarPropuesta(p, { observaciones: { correo: { estado: 'vigente', valor: 3 } } } as any, TARDE + 2 * 60_000), { vigente: true }, 'control: siguen los mismos tres sin leer');
  // A2 (5-oct): antes este control aceptaba «tres» con 2 sin leer; una observación positiva no basta, tiene que concordar.
  assert.deepEqual(ini.revalidarPropuesta(p, { observaciones: { correo: { estado: 'vigente', valor: 2 } } } as any, TARDE + 2 * 60_000), { vigente: false, motivo: 'hecho_cambiado' });
  // Una misión que no se pudo observar (no se leyó) tampoco se da por vigente.
  const seg = ini.propuestasDeRespaldo({ correo: c }, { ahora: TARDE, misiones: [{ id: 'm_aaaaaa', titulo: 'Vender el carro', objetivo: 'x', pasos: [], proximoPaso: '', estado: 'activa', notas: [], creada: TARDE - 9 * DIA, actualizada: TARDE - 5 * DIA }], modelo: null }).find((x) => x.tipo === 'seguimiento')!;
  assert.deepEqual(ini.revalidarPropuesta(seg, {}, TARDE + H), { vigente: false, motivo: 'sin_observacion' });
});

test('A2 sanear: la propuesta del modelo apunta a un candidato del servidor; sin candidato, lo que afirma un hecho se descarta y la idea pura queda sin fuente de hecho', () => {
  const cand = ini.candidatosDe({ ahora: TARDE, correoSinLeer: 3, misiones: [{ id: 'm_bbbbbb', titulo: 'Abrir la pulpería', objetivo: 'x', pasos: [], proximoPaso: '', estado: 'activa', notas: [], creada: TARDE - 9 * DIA, actualizada: TARDE - 5 * DIA }] }, TARDE);
  assert.ok(cand.has('correo') && cand.has('mision:m_bbbbbb'));
  const raw = JSON.stringify([
    { tipo: 'ayuda', texto: 'Tienes tres correos sin leer. ¿Te resumo lo importante?', pedido: 'Revisa mi correo y resume lo importante', prioridad: 1 },
    { tipo: 'seguimiento', texto: '¿Cómo vas con «Abrir la pulpería»? ¿Avanzamos hoy?', pedido: 'Sí, ayúdame con «Abrir la pulpería».', prioridad: 2, fuente: 'mision:m_bbbbbb' },
    { tipo: 'ayuda', texto: 'Tienes 2 chats de WhatsApp sin leer. ¿Te cuento quién escribió?', pedido: 'Sí, revisa mi WhatsApp.', prioridad: 2 },
    { tipo: 'ayuda', texto: '¿Quieres que te busque vuelos baratos a Roatán?', pedido: 'Sí, búscame vuelos baratos a Roatán.', prioridad: 3, fuente: 'mision:m_inventada' },
  ]);
  const ps = ini.sanearPropuestas(raw, TARDE, cand);
  const por = (re: RegExp) => ps.find((x) => re.test(x.texto));
  assert.equal(por(/correos sin leer/)?.evidencia?.fuente.tipo, 'correo', 'inferida del pedido: leer el correo');
  assert.equal(por(/pulpería/)?.evidencia?.fuente.tipo, 'mision');
  assert.equal(por(/pulpería/)?.evidencia?.fuente.id, 'm_bbbbbb');
  assert.equal(por(/pulpería/)?.misionId, 'm_bbbbbb');
  assert.equal(por(/WhatsApp/), undefined, 'afirma un hecho de una fuente que el servidor no vio: fuera');
  assert.equal(por(/Roatán/)?.evidencia?.fuente.tipo, 'ninguna', 'una idea sin hecho, con referencia inventada: queda sin fuente de hecho');
  assert.ok(ps.every((x) => x.evidencia?.fuente.tipo !== 'modelo'));
  // Sin candidatos (el modelo dice «tres correos» pero el servidor no lo vio): fuera.
  assert.equal(ini.sanearPropuestas(raw, TARDE).some((x) => /correos sin leer/.test(x.texto)), false);
});

/** Un reloj de verdad (coordinador + revalidación + outbox), con el modelo que afirma correo y contadores que cambian al despachar. */
async function despacharCorreo(alDespachar: () => unknown) {
  const c = correo();
  const entregas: import('../lib/iniciativa').Propuesta[] = [];
  let llamadas = 0;
  const contadores = async () => {
    llamadas++;
    return llamadas === 1 ? CORREO_3 : (alDespachar() as any);
  };
  const r = SI.arrancarIniciativa({ personas: () => [{ correo: c }], entregadores: { app: (_c, a) => (entregas.push(a.propuesta), 1) }, contadores: contadores as any, modelo: MODELO_CORREO, reloj: () => TARDE, cadaMs: 10 * 60_000, sello: av.selloLocal({ dir: null }) });
  try {
    await r.vuelta();
  } finally {
    r.parar();
  }
  const est = await av.leerAvisos(c);
  return { entregas, llamadas, outbox: est.ok ? est.estado.outbox : [] };
}

test('A2 coordinador → revalidación → outbox: si el correo se resuelve, se desconecta, queda desconocido o falla antes del despacho, CERO entregas; vigente, UNA', async () => {
  const casos: Array<[string, () => unknown, string]> = [
    ['resuelto (3→0)', () => ({ observaciones: { correo: { estado: 'empty' } }, correoSinLeer: 0 }), 'resuelta'],
    ['desconectado', () => ({ observaciones: { correo: { estado: 'disconnected' } }, correoSinLeer: null, desconectadas: ['correo'] }), 'fuente_desconectada'],
    ['contador ausente', () => ({}), 'sin_observacion'],
    ['no configurado', () => ({ observaciones: { correo: { estado: 'not_configured' } } }), 'fuente_no_configurada'],
    ['proveedor caído', () => ({ observaciones: { correo: { estado: 'unavailable' } }, correoSinLeer: null }), 'fuente_no_disponible'],
    [
      'el contador lanza',
      () => {
        throw new Error('IMAP sintético caído');
      },
      'fuente_no_disponible',
    ],
  ];
  for (const [nombre, alDespachar, motivo] of casos) {
    const r = await despacharCorreo(alDespachar);
    assert.equal(r.llamadas, 2, `${nombre}: se observó al pensar y otra vez justo antes de entregar`);
    assert.equal(r.entregas.length, 0, `${nombre}: ninguna entrega`);
    assert.equal(r.outbox[0]?.estado, 'omitido', nombre);
    assert.equal(r.outbox[0]?.motivo, motivo, nombre);
  }
  const vigente = await despacharCorreo(() => CORREO_3);
  assert.equal(vigente.entregas.length, 1, 'control: sigue vigente, una entrega');
  assert.equal(vigente.entregas[0].evidencia?.fuente.tipo, 'correo');
  assert.equal(vigente.outbox[0]?.estado, 'entregado');
});

test('A2 coordinador → outbox con una misión: la propuesta del modelo sustentada en la misión no sale si la misión se cierra antes del despacho; si sigue abierta, sale una vez', async () => {
  const caso = async (cerrar: boolean) => {
    const c = correo();
    await crearMision(c, { titulo: 'Vender el carro', pasos: ['Tomar fotos'] }, TARDE - 5 * DIA);
    const [m] = await misionesDe(c);
    const modelo = async () => JSON.stringify([{ tipo: 'seguimiento', texto: '¿Cómo vas con «Vender el carro»? ¿Lo avanzamos hoy?', pedido: 'Sí, ayúdame con el siguiente paso de «Vender el carro».', prioridad: 1, fuente: `mision:${m.id}` }]);
    // Pospuso los avisos dos horas: la propuesta se encola y espera.
    await av.cambiarPreferencias(c, { pospuestoHasta: TARDE + 2 * H }, TARDE - 60_000);
    let ahora = TARDE;
    const entregas: string[] = [];
    const r = SI.arrancarIniciativa({ personas: () => [{ correo: c }], entregadores: { app: (_c, a) => (entregas.push(a.propuesta.texto), 1) }, modelo, reloj: () => ahora, cadaMs: 10 * 60_000, sello: av.selloLocal({ dir: null }) });
    try {
      await r.vuelta();
      assert.equal(entregas.length, 0, 'pospuesto: espera');
      const est = await ini.leerEstadoIniciativa(c);
      assert.ok(est.ok && est.estado.pendiente?.evidencia?.fuente.tipo === 'mision' && est.estado.pendiente.evidencia.fuente.id === m.id, 'apunta a la misión del servidor');
      if (cerrar) await cerrarMision(c, m.id, 'hecha', TARDE + H);
      ahora = TARDE + 3 * H;
      await r.vuelta();
    } finally {
      r.parar();
    }
    return entregas;
  };
  assert.equal((await caso(true)).length, 0, 'misión cerrada antes del despacho: cero entregas');
  assert.equal((await caso(false)).length, 1, 'control: sigue abierta, una entrega');
});

test('A2 composición: las rutas y el reloj reciben EL MISMO adaptador de contadores; un error no se vuelve contador 0', async () => {
  const a = correo();
  const llamadas: string[] = [];
  let falla = false;
  const adaptador = async (c: string) => {
    llamadas.push(c);
    if (falla) throw new Error('proveedor sintético caído');
    return CORREO_3;
  };
  const comp = SI.componerIniciativa({ contadores: adaptador as any });
  assert.equal(comp.contadores, adaptador);
  const app = express();
  app.use(express.json());
  const pasa = ((_q: express.Request, _s: express.Response, nx: express.NextFunction) => nx()) as express.RequestHandler;
  comp.montarRutas(app, { exigirMesa: pasa, limitar: () => pasa, sesionDe: () => ({ correo: a }), modelo: MODELO_CORREO, reloj: () => TARDE });
  const srv = app.listen(0, '127.0.0.1');
  await new Promise((r) => srv.once('listening', r));
  try {
    const g = await (await fetch(`http://127.0.0.1:${(srv.address() as AddressInfo).port}/api/iniciativa`)).json();
    assert.match(g.propuesta?.texto || '', /correos sin leer/, 'la ruta vio el correo por el adaptador');
    assert.deepEqual(llamadas, [a], 'la ruta llamó al adaptador con la persona de la sesión');
  } finally {
    srv.close();
  }
  // Revalidar con el contador fallando: no es «0 sin leer» (resuelta) ni vigencia.
  const est = await ini.leerEstadoIniciativa(a);
  assert.ok(est.ok && est.estado.pendiente);
  falla = true;
  if (est.ok && est.estado.pendiente) {
    assert.deepEqual(await SI.revalidarAhora(a, est.estado.pendiente, { contadores: adaptador as any }, TARDE + 30_000), { vigente: false, motivo: 'fuente_no_disponible' });
  }
  // El reloj, con el mismo adaptador (sin pasarle otro).
  const entregas: string[] = [];
  const reloj = comp.arrancar({ personas: () => [{ correo: a }], entregadores: { app: (_c, x) => (entregas.push(x.propuesta.id), 1) }, modelo: MODELO_CORREO, reloj: () => TARDE + 60_000, cadaMs: 10 * 60_000, sello: av.selloLocal({ dir: null }) });
  try {
    llamadas.length = 0;
    await reloj.vuelta();
  } finally {
    reloj.parar();
  }
  assert.ok(llamadas.length >= 1 && llamadas.every((c) => c === a), 'el reloj usó el mismo adaptador, solo para su dueño');
  assert.equal(entregas.length, 0, 'con el contador fallando, el aviso del correo no sale');
  const despues = await ini.leerEstadoIniciativa(a);
  assert.ok(despues.ok && despues.estado.pendiente === null, 'la pendiente sin fuente observable se retira en vez de mostrarse');
});

test('A2 el adaptador de contadores separa vigente, empty, unavailable, disconnected y not_configured; nunca cuenta un error como 0 ni mira otra cuenta', async () => {
  const { crearContadores } = await import('../server/fuentes-iniciativa');
  const pedidosWA: string[] = [];
  const cuentas: Record<string, { ok: true; cuentas: { id: string; correo: string }[] } | { ok: false }> = {
    'tres@x.hn': { ok: true, cuentas: [{ id: 'c1', correo: 'tres@x.hn' }, { id: 'c2', correo: 'otra@x.hn' }] },
    'cero@x.hn': { ok: true, cuentas: [{ id: 'c3', correo: 'cero@x.hn' }] },
    'nada@x.hn': { ok: true, cuentas: [] },
    'caida@x.hn': { ok: false },
    'clave@x.hn': { ok: true, cuentas: [{ id: 'c4', correo: 'clave@x.hn' }] },
    'mitad@x.hn': { ok: true, cuentas: [{ id: 'c5', correo: 'mitad@x.hn' }, { id: 'c6', correo: 'lenta@x.hn' }] },
  };
  const noLeidos: Record<string, () => Promise<number>> = {
    c1: async () => 2,
    c2: async () => 1,
    c3: async () => 0,
    c4: async () => {
      throw Object.assign(new Error('Synthetic AUTHENTICATIONFAILED'), { authenticationFailed: true });
    },
    c5: async () => 4,
    c6: async () => {
      throw Object.assign(new Error('Synthetic timeout'), { code: 'ETIMEDOUT' });
    },
  };
  const contar = crearContadores({
    correo: { cuentas: async (c) => cuentas[c] ?? { ok: true, cuentas: [] }, noLeidos: (dueno, cuenta) => (assert.ok(cuentas[dueno].ok && (cuentas[dueno] as any).cuentas.some((x: any) => x.id === cuenta.id), 'solo cuentas de su dueño'), noLeidos[cuenta.id]()) },
    whatsapp: { permitido: (c) => c === 'tres@x.hn', disponible: () => true, estado: async () => ({ vinculado: true, conectado: true }), chats: async () => (pedidosWA.push('chats'), [{ noLeidos: 2 }, { noLeidos: 0 }, { noLeidos: 1 }]) },
    reloj: () => TARDE,
  });
  const obs = async (c: string) => (await contar(c)).observaciones!;
  assert.deepEqual((await obs('tres@x.hn')).correo, { estado: 'vigente', valor: 3, version: 3, visto: TARDE });
  assert.deepEqual((await obs('tres@x.hn')).whatsapp, { estado: 'vigente', valor: 2, version: 2, visto: TARDE });
  assert.equal((await obs('cero@x.hn')).correo?.estado, 'empty');
  assert.equal((await obs('nada@x.hn')).correo?.estado, 'not_configured');
  assert.equal((await obs('caida@x.hn')).correo?.estado, 'unavailable', 'no poder leer las cuentas no es «no tiene correo»');
  assert.equal((await obs('clave@x.hn')).correo?.estado, 'disconnected', 'la clave ya no entra: desconectada');
  assert.equal((await obs('mitad@x.hn')).correo?.estado, 'unavailable', 'una cuenta caída: cobertura parcial, no se afirma un número');
  assert.ok(!('valor' in ((await obs('mitad@x.hn')).correo || {})), 'nada de contar solo la mitad');
  const antes = pedidosWA.length;
  assert.equal((await obs('cero@x.hn')).whatsapp?.estado, 'not_configured', 'el WhatsApp de otra cuenta no se mira');
  assert.equal(pedidosWA.length, antes, 'ni se le piden los chats');
  // Lo heredado que lee el resto del código sale de la observación, nunca un 0 inventado.
  const caida = await contar('caida@x.hn');
  assert.equal(caida.correoSinLeer, null);
  const clave = await contar('clave@x.hn');
  assert.deepEqual(clave.desconectadas, ['correo']);
  // WhatsApp desvinculado o el puente que falla.
  const wa = (estado: () => Promise<any>, chats: () => Promise<any>) => crearContadores({ whatsapp: { permitido: () => true, disponible: () => true, estado, chats }, reloj: () => TARDE });
  assert.equal((await wa(async () => ({ vinculado: false, conectado: false }), async () => [])('j@x.hn')).observaciones?.whatsapp?.estado, 'disconnected');
  assert.equal((await wa(async () => { throw new Error('puente'); }, async () => [])('j@x.hn')).observaciones?.whatsapp?.estado, 'unavailable');
  assert.equal((await wa(async () => ({ vinculado: true, conectado: true }), async () => { throw new Error('puente'); })('j@x.hn')).observaciones?.whatsapp?.estado, 'unavailable');
  assert.equal((await wa(async () => ({ vinculado: true, conectado: true }), async () => [{ noLeidos: 0 }])('j@x.hn')).observaciones?.whatsapp?.estado, 'empty');
});

test('A2 server.ts compone UN adaptador productivo y lo da a las rutas y al reloj (no los monta por separado)', () => {
  const src = fs.readFileSync(path.resolve(import.meta.dirname, '../server.ts'), 'utf8');
  assert.match(src, /componerIniciativa\(\{\s*contadores:\s*contadoresProductivos\(\)/, 'un solo adaptador productivo');
  assert.match(src, /iniciativa\.montarRutas\(app,/);
  assert.match(src, /iniciativa\.arrancar\(\{/);
  assert.doesNotMatch(src, /\bmontarRutasIniciativa\(app/, 'las rutas no se montan sin el adaptador');
  assert.doesNotMatch(src, /\barrancarIniciativa\(\{/, 'el reloj no arranca sin el adaptador');
});

/* ------------------------------------------------------------------ A2 (5-oct): el hecho contado se revalida antes de mostrar o enviar */

/** Lo que ve el adaptador: N sin leer (vigente) o nada (empty). La versión de la fuente es la del contador. */
const obsCorreo = (n: number) => (n > 0 ? { observaciones: { correo: { estado: 'vigente' as const, valor: n, version: n } }, correoSinLeer: n } : { observaciones: { correo: { estado: 'empty' as const } }, correoSinLeer: 0 });
const RE_TRES = /\btres\b|\b3\b/;

/** La ruta de verdad (componerIniciativa → GET /api/iniciativa) con un adaptador y un reloj que la prueba mueve. */
async function rutaIniciativa(o: { contadores: () => unknown; reloj: () => number; modelo?: import('../lib/iniciativa').ModeloCorto | null; quien: string }) {
  const comp = SI.componerIniciativa({ contadores: (async () => o.contadores()) as any });
  const app = express();
  app.use(express.json());
  const pasa = ((_q: express.Request, _s: express.Response, nx: express.NextFunction) => nx()) as express.RequestHandler;
  comp.montarRutas(app, { exigirMesa: pasa, limitar: () => pasa, sesionDe: () => ({ correo: o.quien }), modelo: o.modelo === undefined ? MODELO_CORREO : o.modelo, reloj: o.reloj });
  const srv = app.listen(0, '127.0.0.1');
  await new Promise((r) => srv.once('listening', r));
  const base = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
  return {
    get: async () => (await fetch(`${base}/api/iniciativa`)).json() as Promise<any>,
    cerrar: () => srv.close(),
  };
}

async function estadoDe(c: string) {
  const est = await ini.leerEstadoIniciativa(c);
  assert.ok(est.ok);
  return (est as { ok: true; estado: import('../lib/iniciativa').EstadoIniciativa }).estado;
}

test('A2 REPRO 3→1 en GET /api/iniciativa: a los 60 s con contador 1, la misma propuesta (mismo id) vuelve con texto, porQue y evidencia del 1, sin contar como alerta nueva', async () => {
  const a = correo();
  let ahora = TARDE;
  let actual: unknown = obsCorreo(3);
  const r = await rutaIniciativa({ contadores: () => actual, reloj: () => ahora, quien: a });
  try {
    const g1 = await r.get();
    assert.match(g1.propuesta?.texto || '', /tres correos sin leer/, 'el modelo dijo «tres» con el contador en 3');
    const id = g1.propuesta.id;
    ahora = TARDE + 60_000;
    actual = obsCorreo(1);
    const g2 = await r.get();
    assert.equal(g2.honesto, true);
    assert.equal(g2.propuesta?.id, id, 'la misma propuesta: no es otra idea ni otro aviso');
    assert.doesNotMatch(g2.propuesta.texto, RE_TRES, `no vuelve con el «tres» viejo: ${g2.propuesta.texto}`);
    assert.match(g2.propuesta.texto, /\b1 correo sin leer\b/, 'texto regenerado desde la observación vigente');
    assert.doesNotMatch(g2.propuesta.porQue, RE_TRES, `porQue: ${g2.propuesta.porQue}`);
    assert.match(g2.propuesta.porQue, /\b1 correo sin leer\b/);
    assert.equal(g2.motivo, 'actualizada', 'se dice que se actualizó, no que sigue igual');
    assert.equal(g2.propuesta.rev, 2);
    const est = await estadoDe(a);
    assert.equal(est.pendiente?.id, id);
    assert.equal(est.pendiente?.texto, g2.propuesta.texto, 'lo guardado es lo que se mostró');
    assert.equal(est.pendiente?.evidencia?.fuente.valor, 1, 'evidencia anclada al 1');
    assert.equal(est.pendiente?.evidencia?.fuente.version, 1);
    assert.equal(est.pendiente?.evidencia?.porQue, g2.propuesta.porQue);
    assert.equal(est.pendiente?.evidencia?.caduca, g1.propuesta.caduca, 'regenerar no alarga la caducidad');
    // Regenerar no es una alerta nueva: ni cuenta en el ritmo del día ni crea otra fila de aviso.
    assert.equal(est.hoy, 1);
    assert.equal(est.ultima, TARDE);
    const avs = await av.leerAvisos(a);
    assert.ok(avs.ok);
    if (avs.ok) assert.equal(avs.estado.outbox.filter((x) => x.propuestaId === id).length, 1, 'una sola fila (la vista en la app)');
  } finally {
    r.cerrar();
  }
});

test('A2 REPRO 3→1 en el despacho: el reloj observa 3 al pensar y 1 al despachar; entrega UNA vez y la versión del 1 (texto, porQue y evidencia)', async () => {
  const r = await despacharCorreo(() => obsCorreo(1));
  assert.equal(r.llamadas, 2);
  assert.equal(r.entregas.length, 1, 'una sola entrega');
  const p = r.entregas[0];
  assert.doesNotMatch(p.texto, RE_TRES, `no se entrega el «tres» viejo: ${p.texto}`);
  assert.match(p.texto, /\b1 correo sin leer\b/);
  assert.doesNotMatch(p.evidencia?.porQue || '', RE_TRES);
  assert.match(p.evidencia?.porQue || '', /\b1 correo sin leer\b/);
  assert.equal(p.evidencia?.fuente.valor, 1);
  assert.equal(p.evidencia?.fuente.version, 1);
  assert.equal(r.outbox.length, 1, 'ninguna fila nueva por regenerar');
  assert.equal(r.outbox[0].estado, 'entregado');
});

/** El reloj con dos observaciones (al pensar y al despachar) y el modelo dado; devuelve lo entregado y lo guardado. */
async function despacharCon(primera: unknown, segunda: unknown, modelo: import('../lib/iniciativa').ModeloCorto | null) {
  const c = correo();
  const entregas: import('../lib/iniciativa').Propuesta[] = [];
  let llamadas = 0;
  const contadores = async () => (++llamadas === 1 ? primera : segunda);
  const r = SI.arrancarIniciativa({ personas: () => [{ correo: c }], entregadores: { app: (_c, a) => (entregas.push(a.propuesta), 1) }, contadores: contadores as any, modelo, reloj: () => TARDE, cadaMs: 10 * 60_000, sello: av.selloLocal({ dir: null }) });
  try {
    await r.vuelta();
  } finally {
    r.parar();
  }
  const avs = await av.leerAvisos(c);
  return { c, entregas, outbox: avs.ok ? avs.estado.outbox : [], estado: await estadoDe(c) };
}

test('A2 1→3 y valor estable, en el despacho y en GET: 1→3 se regenera con el 3; estable conserva el texto y la evidencia tal cual', async () => {
  // Despacho 1→3 (respaldo, sin modelo).
  const sube = await despacharCon(obsCorreo(1), obsCorreo(3), null);
  assert.equal(sube.entregas.length, 1);
  assert.match(sube.entregas[0].texto, /\b3 correos sin leer\b/);
  assert.match(sube.entregas[0].evidencia!.porQue, /\b3 correos sin leer\b/);
  assert.equal(sube.entregas[0].evidencia!.fuente.valor, 3);
  assert.equal(sube.estado.pendiente?.texto, sube.entregas[0].texto, 'lo entregado es lo guardado');
  // Despacho estable 3→3: el texto del modelo sale tal cual (nada que regenerar), una vez.
  const igual = await despacharCon(obsCorreo(3), obsCorreo(3), MODELO_CORREO);
  assert.equal(igual.entregas.length, 1);
  assert.equal(igual.entregas[0].texto, 'Tienes tres correos sin leer. ¿Te resumo lo importante?');
  assert.equal(igual.entregas[0].evidencia!.fuente.valor, 3);
  assert.equal(igual.entregas[0].rev, undefined, 'sin regenerar');
  // GET 1→3 y 3→3.
  const a = correo();
  let ahora = TARDE;
  let actual: unknown = obsCorreo(1);
  const r = await rutaIniciativa({ contadores: () => actual, reloj: () => ahora, quien: a, modelo: null });
  try {
    const g1 = await r.get();
    assert.match(g1.propuesta?.texto || '', /^Tienes 1 correos? sin leer/);
    ahora += 60_000;
    actual = obsCorreo(3);
    const g2 = await r.get();
    assert.equal(g2.propuesta?.id, g1.propuesta.id);
    assert.match(g2.propuesta.texto, /\b3 correos sin leer\b/);
    assert.match(g2.propuesta.porQue, /\b3 correos sin leer\b/);
    assert.equal((await estadoDe(a)).pendiente?.evidencia?.fuente.valor, 3);
    ahora += 60_000;
    const g3 = await r.get();
    assert.deepEqual(
      { id: g3.propuesta?.id, texto: g3.propuesta?.texto, porQue: g3.propuesta?.porQue, rev: g3.propuesta?.rev, motivo: g3.motivo },
      { id: g2.propuesta.id, texto: g2.propuesta.texto, porQue: g2.propuesta.porQue, rev: g2.propuesta.rev, motivo: 'pendiente' },
      'estable: la misma, sin tocar'
    );
  } finally {
    r.cerrar();
  }
});

test('A2 GET con el adaptador real: 3→0, desconexión, cobertura parcial, proveedor caído, adaptador que lanza y contador ausente nunca devuelven el «tres» como vigente', async () => {
  const { crearContadores } = await import('../server/fuentes-iniciativa');
  type Tabla = Record<string, () => Promise<number>>;
  const auth = async (): Promise<number> => {
    throw Object.assign(new Error('Synthetic AUTHENTICATIONFAILED'), { authenticationFailed: true });
  };
  const lenta = async (): Promise<number> => {
    throw Object.assign(new Error('Synthetic timeout'), { code: 'ETIMEDOUT' });
  };
  const casos: Array<[string, { cuentas?: { ok: false }; tabla?: Tabla; lanza?: boolean; ausente?: boolean }]> = [
    ['3→0', { tabla: { c1: async () => 0, c2: async () => 0 } }],
    ['desconectado', { tabla: { c1: auth, c2: auth } }],
    ['cobertura parcial', { tabla: { c1: async () => 1, c2: lenta } }],
    ['proveedor caído', { cuentas: { ok: false } }],
    ['el adaptador lanza', { lanza: true }],
    ['contador ausente', { ausente: true }],
  ];
  for (const [nombre, caso] of casos) {
    const a = correo();
    let ahora = TARDE;
    let tabla: Tabla = { c1: async () => 2, c2: async () => 1 };
    let cuentas: { ok: true; cuentas: { id: string; correo: string }[] } | { ok: false } = { ok: true, cuentas: [{ id: 'c1', correo: a }, { id: 'c2', correo: `otra-${a}` }] };
    let fase = 0;
    const contar = crearContadores({ correo: { cuentas: async () => cuentas, noLeidos: (_d, cu) => tabla[cu.id]() }, reloj: () => ahora });
    const r = await rutaIniciativa({
      contadores: () => {
        if (fase && caso.lanza) throw new Error('proveedor sintético caído');
        if (fase && caso.ausente) return {};
        return contar(a);
      },
      reloj: () => ahora,
      quien: a,
    });
    try {
      const g1 = await r.get();
      assert.match(g1.propuesta?.texto || '', /tres correos sin leer/, `${nombre}: arranca con 3 (2 + 1 de sus dos cuentas)`);
      fase = 1;
      if (caso.tabla) tabla = caso.tabla;
      if (caso.cuentas) cuentas = caso.cuentas;
      ahora += 60_000;
      const g2 = await r.get();
      assert.notEqual(g2.propuesta?.id, g1.propuesta.id, `${nombre}: la propuesta del «tres» no vuelve`);
      assert.doesNotMatch(g2.propuesta?.texto || '', /correos? sin leer/, `${nombre}: ningún conteo sin observación vigente`);
      const h = (await estadoDe(a)).historial.find((x) => x.id === g1.propuesta.id);
      assert.equal(h?.respuesta, 'resuelta', `${nombre}: se retira`);
    } finally {
      r.cerrar();
    }
  }
});

test('A2 caducidad: con el hecho cambiado y la evidencia vencida no se regenera ni se entrega; regenerar nunca alarga el plazo', async () => {
  const c = correo();
  const s = await ini.siguientePropuesta({ correo: c }, { ahora: TARDE, ...obsCorreo(3), modelo: MODELO_CORREO });
  const p = s.propuesta!;
  const caduca = p.evidencia!.caduca;
  const f1 = obsCorreo(1);
  const antes = ini.revalidarORegenerar(p, f1, caduca - 1);
  assert.ok(antes.vigente && antes.regenerada);
  if (antes.vigente) assert.equal(antes.propuesta.evidencia!.caduca, caduca, 'la misma caducidad');
  assert.deepEqual(ini.revalidarORegenerar(p, f1, caduca), { vigente: false, motivo: 'caducada' });
  assert.deepEqual(ini.revalidarORegenerar(p, obsCorreo(3), caduca), { vigente: false, motivo: 'caducada' });
  // Por el despacho: encolada, y la outbox corre después de caducar con el contador en 1.
  await av.encolarAviso(c, p, TARDE);
  const log: string[] = [];
  const res = await av.procesarOutbox(c, { revalidar: (q) => SI.revalidarAhora(c, q, { contadores: async () => f1 as any }, caduca + 1), entregadores: { app: (_c, x) => (log.push(x.propuesta.texto), 1) }, sello: av.selloLocal({ dir: null }), ahora: caduca + 1 });
  assert.equal(log.length, 0);
  assert.equal(res[0]?.motivo, 'caducada');
});

/** Escribe en disco el estado guardado de la iniciativa (como lo dejó una versión anterior) y olvida la caché. */
function guardarEstadoViejo(c: string, estado: unknown) {
  const huella = crypto.createHash('sha256').update(`iniciativa:${c.trim().toLowerCase()}`).digest('hex').slice(0, 40);
  fs.mkdirSync(process.env.ULTRON_INICIATIVA_DIR!, { recursive: true });
  fs.writeFileSync(path.join(process.env.ULTRON_INICIATIVA_DIR!, `${huella}.json`), JSON.stringify(estado));
  ini._olvidarCacheIniciativa();
}

test('A2 propuesta guardada SIN anclaje (estado anterior: sin el valor contado): no se muestra ni se entrega tal cual; se vuelve a observar y se regenera, o no sale', async () => {
  const viejaDe = (id: string, fuente: Record<string, unknown>) => ({
    id,
    texto: 'Tienes tres correos sin leer. ¿Te resumo lo importante?',
    tipo: 'ayuda',
    pedido: 'Revisa mi correo y resume lo importante',
    prioridad: 1,
    creada: TARDE - 60_000,
    entregada: TARDE - 60_000,
    evidencia: { porQue: 'Hay tres correos sin leer', fuente: { tipo: 'correo', ...fuente, visto: TARDE - 60_000 }, paso: 'Leer', permiso: 'leer_correo', caduca: TARDE + 7 * H },
  });
  const estadoCon = (p: any) => ({ version: 1, pendiente: p, cola: [], historial: [{ id: p.id, tipo: 'ayuda', texto: p.texto, t: TARDE - 60_000 }], ultima: TARDE - 60_000, backoff: 1, dia: '2026-10-02', hoy: 1 });
  // Lo puro: sin valor anclado no es vigente, aunque el buzón tenga correo.
  for (const fuente of [{ consulta: 'sin_leer', version: 3 }, {}]) {
    const p = viejaDe('p_0a0a0a0a0a0a', fuente) as import('../lib/iniciativa').Propuesta;
    assert.deepEqual(ini.revalidarPropuesta(p, obsCorreo(3), TARDE), { vigente: false, motivo: 'sin_anclaje' }, JSON.stringify(fuente));
  }
  // GET: la vieja se vuelve a observar (3) y sale regenerada desde la observación, con el mismo id.
  const a = correo();
  guardarEstadoViejo(a, estadoCon(viejaDe('p_1b1b1b1b1b1b', { consulta: 'sin_leer', version: 3 })));
  let actual: unknown = obsCorreo(3);
  const r = await rutaIniciativa({ contadores: () => actual, reloj: () => TARDE, quien: a });
  try {
    const g = await r.get();
    assert.equal(g.propuesta?.id, 'p_1b1b1b1b1b1b');
    assert.equal(g.propuesta.texto, 'Tienes 3 correos sin leer. ¿Te resumo lo importante?', 'plantilla determinista desde la observación');
    assert.equal(g.propuesta.porQue, 'Hay 3 correos sin leer.');
    assert.equal((await estadoDe(a)).pendiente?.evidencia?.fuente.valor, 3);
  } finally {
    r.cerrar();
  }
  // GET con la fuente caída: la vieja no se devuelve.
  const b = correo();
  guardarEstadoViejo(b, estadoCon(viejaDe('p_2c2c2c2c2c2c', {})));
  actual = { observaciones: { correo: { estado: 'unavailable' } }, correoSinLeer: null };
  const r2 = await rutaIniciativa({ contadores: () => actual, reloj: () => TARDE, quien: b });
  try {
    const g = await r2.get();
    assert.notEqual(g.propuesta?.id, 'p_2c2c2c2c2c2c');
  } finally {
    r2.cerrar();
  }
  // Despacho: una fila vieja en la outbox con la copia sin anclaje sale regenerada (una vez) o no sale.
  for (const [obs, n, motivo] of [
    [obsCorreo(1), 1, 'entregado'],
    [{ observaciones: { correo: { estado: 'unavailable' } } }, 0, 'fuente_no_disponible'],
  ] as const) {
    const c = correo();
    const vieja = viejaDe('p_3d3d3d3d3d3d', { consulta: 'sin_leer', version: 3 });
    guardarEstadoViejo(c, estadoCon(vieja));
    await av.encolarAviso(c, vieja as any, TARDE - 60_000);
    const log: import('../lib/iniciativa').Propuesta[] = [];
    const res = await av.procesarOutbox(c, { revalidar: (q) => SI.revalidarAhora(c, q, { contadores: async () => obs as any }, TARDE), entregadores: { app: (_c, x) => (log.push(x.propuesta), 1) }, sello: av.selloLocal({ dir: null }), ahora: TARDE });
    assert.equal(log.length, n, motivo);
    assert.equal(res[0]?.motivo, motivo);
    if (n) {
      assert.equal(log[0].id, 'p_3d3d3d3d3d3d');
      assert.equal(log[0].texto, 'Tienes 1 correo sin leer. ¿Te resumo lo importante?');
      assert.equal(log[0].evidencia?.fuente.valor, 1);
    }
    // Con la revalidación pura (sin poder regenerar), la vieja no sale.
    assert.equal(ini.revalidarPropuesta(vieja as any, obs as any, TARDE).vigente, false);
  }
});

test('A2 dos consumidores a la vez (dos relojes, otra réplica): una sola entrega y una sola versión, la del contador vigente', async () => {
  const a = correo();
  const sellos = path.join(dir, 'sellos-a2-concurrente');
  const entregas: import('../lib/iniciativa').Propuesta[] = [];
  let llamadas = 0;
  // La primera observación ve 3; todas las siguientes (la otra réplica y los despachos) ven 1.
  const contadores = async () => (++llamadas === 1 ? obsCorreo(3) : obsCorreo(1));
  const mk = () =>
    SI.arrancarIniciativa({
      personas: () => [{ correo: a }],
      entregadores: { app: (_c, x) => (entregas.push(x.propuesta), 1), push: (_c, x) => (entregas.push(x.propuesta), 1) },
      contadores: contadores as any,
      modelo: MODELO_CORREO,
      reloj: () => TARDE,
      cadaMs: 10 * 60_000,
      sello: av.selloLocal({ dir: sellos }),
    });
  const r1 = mk();
  const r2 = mk();
  try {
    await Promise.all([r1.vuelta(), r2.vuelta()]);
    // Otra réplica sin la caché de esta (solo el disco compartido y el sello) también pasa.
    ini._olvidarCacheIniciativa();
    av._olvidarCacheAvisos();
    await r1.vuelta();
  } finally {
    r1.parar();
    r2.parar();
  }
  assert.equal(entregas.length, 1, JSON.stringify(entregas.map((p) => p.texto)));
  assert.match(entregas[0].texto, /\b1 correo sin leer\b/);
  assert.equal(entregas[0].evidencia?.fuente.valor, 1);
  const est = await estadoDe(a);
  assert.equal(est.pendiente?.id, entregas[0].id);
  assert.equal(est.pendiente?.texto, entregas[0].texto);
  assert.equal(est.hoy, 1, 'una sola alerta en el día');
});

test('A2 carrera revalidación ↔ actualización ↔ despacho: si la app la muestra (regenerada) mientras el despacho revalida, el push no sale; si contesta antes, tampoco', async () => {
  const a = correo();
  let ahora = TARDE;
  let actual: unknown = obsCorreo(3);
  const r = await rutaIniciativa({ contadores: () => actual, reloj: () => ahora, quien: a });
  try {
    // El reloj piensa con 3 y encola; antes de que despache, el contador baja a 1.
    const s = await SI.proponerPara({ correo: a }, { contadores: (async () => actual) as any, modelo: MODELO_CORREO, reloj: () => ahora });
    assert.ok(s.nueva && s.propuesta);
    await av.encolarAviso(a, s.propuesta!, ahora);
    actual = obsCorreo(1);
    ahora += 60_000;
    const push: import('../lib/iniciativa').Propuesta[] = [];
    let vista: any = null;
    const res = await av.procesarOutbox(a, {
      revalidar: async (q) => {
        const rv = await SI.revalidarAhora(a, q, { contadores: (async () => actual) as any }, ahora);
        // En medio, la persona abre la app: GET la ve (regenerada) y cuenta como entregada.
        vista = await r.get();
        return rv;
      },
      entregadores: { push: (_c, x) => (push.push(x.propuesta), 1) },
      sello: av.selloLocal({ dir: null }),
      ahora,
    });
    assert.equal(push.length, 0, 'ya la vio en la app: el push no repite el aviso');
    assert.equal(res[0]?.motivo, 'duplicado');
    assert.equal(vista.propuesta?.id, s.propuesta!.id);
    assert.match(vista.propuesta.texto, /\b1 correo sin leer\b/);
  } finally {
    r.cerrar();
  }
  // Contestó «no» antes del despacho: no sale nada.
  const b = correo();
  const s2 = await ini.siguientePropuesta({ correo: b }, { ahora: TARDE, ...obsCorreo(3), modelo: MODELO_CORREO });
  await av.encolarAviso(b, s2.propuesta!, TARDE);
  await ini.responderPropuesta(b, s2.propuesta!.id, 'no', TARDE + 30_000);
  const log: string[] = [];
  const res2 = await av.procesarOutbox(b, { revalidar: (q) => SI.revalidarAhora(b, q, { contadores: async () => obsCorreo(1) as any }, TARDE + 60_000), entregadores: { app: (_c, x) => (log.push(x.propuesta.id), 1) }, sello: av.selloLocal({ dir: null }), ahora: TARDE + 60_000 });
  assert.equal(log.length, 0);
  assert.equal(res2[0]?.motivo, 'resuelta');
});

test('A2 contrato del contador (puro): valor y versión; 3→1 y 1→3 cambian el hecho; estable vale; otra versión con el mismo valor se re-ancla; vigente sin número no se da por buena', () => {
  const p = ini.propuestasDeRespaldo({ correo: 'x@ejemplo.com' }, { ahora: TARDE, ...obsCorreo(3), modelo: null }).find((x) => x.evidencia?.fuente.tipo === 'correo')!;
  assert.equal(p.texto, 'Tienes 3 correos sin leer. ¿Te resumo lo importante?');
  assert.deepEqual({ valor: p.evidencia!.fuente.valor, version: p.evidencia!.fuente.version }, { valor: 3, version: 3 });
  assert.deepEqual(ini.revalidarPropuesta(p, obsCorreo(3), TARDE + H), { vigente: true });
  assert.deepEqual(ini.revalidarPropuesta(p, obsCorreo(1), TARDE + H), { vigente: false, motivo: 'hecho_cambiado' });
  assert.deepEqual(ini.revalidarPropuesta(p, obsCorreo(5), TARDE + H), { vigente: false, motivo: 'hecho_cambiado' });
  assert.deepEqual(ini.revalidarPropuesta(p, { observaciones: { correo: { estado: 'vigente', valor: 3, version: 9 } } }, TARDE + H), { vigente: false, motivo: 'hecho_cambiado' }, 'la fuente dice que es otra versión');
  assert.deepEqual(ini.revalidarPropuesta(p, { observaciones: { correo: { estado: 'vigente' } } }, TARDE + H), { vigente: false, motivo: 'fuente_no_disponible' }, 'vigente sin número: no se puede comprobar lo contado');
  const r = ini.revalidarORegenerar(p, obsCorreo(1), TARDE + H);
  assert.ok(r.vigente && r.regenerada);
  if (r.vigente) {
    assert.equal(r.propuesta.id, p.id);
    assert.equal(r.propuesta.rev, 2);
    assert.equal(r.propuesta.texto, 'Tienes 1 correo sin leer. ¿Te resumo lo importante?');
    assert.equal(r.propuesta.evidencia!.porQue, 'Hay 1 correo sin leer.');
    assert.deepEqual({ valor: r.propuesta.evidencia!.fuente.valor, version: r.propuesta.evidencia!.fuente.version, visto: r.propuesta.evidencia!.fuente.visto }, { valor: 1, version: 1, visto: TARDE + H });
    assert.equal(r.propuesta.evidencia!.caduca, p.evidencia!.caduca);
    assert.equal(r.propuesta.entregada, p.entregada);
    assert.deepEqual(ini.revalidarORegenerar(r.propuesta, obsCorreo(1), TARDE + 2 * H), { vigente: true, propuesta: r.propuesta, regenerada: false }, 'regenerada y estable: la misma');
  }
  const v9 = ini.revalidarORegenerar(p, { observaciones: { correo: { estado: 'vigente', valor: 3, version: 9 } } }, TARDE + H);
  assert.ok(v9.vigente && v9.regenerada && v9.propuesta.evidencia!.fuente.version === 9 && v9.propuesta.texto === p.texto);
  // WhatsApp, igual.
  const w = ini.propuestasDeRespaldo({ correo: 'x@ejemplo.com' }, { ahora: TARDE, whatsappSinLeer: 2, modelo: null }).find((x) => x.evidencia?.fuente.tipo === 'whatsapp')!;
  const w1 = ini.revalidarORegenerar(w, { whatsappSinLeer: 1 }, TARDE + H);
  assert.ok(w1.vigente && w1.regenerada && w1.propuesta.texto === 'Tienes 1 chat de WhatsApp sin leer. ¿Te cuento quién escribió?');
  // 3→0, desconectada, sin observar: nada que regenerar.
  assert.deepEqual(ini.revalidarORegenerar(p, obsCorreo(0), TARDE + H), { vigente: false, motivo: 'resuelta' });
  assert.deepEqual(ini.revalidarORegenerar(p, { desconectadas: ['correo'], correoSinLeer: null }, TARDE + H), { vigente: false, motivo: 'fuente_desconectada' });
  assert.deepEqual(ini.revalidarORegenerar(p, {}, TARDE + H), { vigente: false, motivo: 'sin_observacion' });
});
