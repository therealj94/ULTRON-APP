/**
 * La iniciativa de AURA (lib/iniciativa.ts, server/iniciativa.ts y SERVIR_CON_INICIATIVA en server/desk.ts):
 * horas quietas y ritmo por ajuste (con reloj inyectado), backoff tras un «no», propuestas del modelo
 * validadas y sin repetir, respaldo fijo con el modelo caído, nada se escribe si S3 no se pudo leer, las
 * rutas solo sirven a la persona de la sesión, y la personalidad trae el bloque (y su versión corta).
 */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
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
  // Las del modelo también: fuente «modelo» y caducan al día.
  const m = await ini.pensarPropuestas({ correo: c }, { ahora: TARDE, modelo: async () => buenas });
  assert.ok(m.propuestas.every((x) => x.evidencia && x.evidencia.fuente.tipo === 'modelo' && x.evidencia.caduca === TARDE + ini.CADUCA_COLA_MS));
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
  assert.deepEqual(ini.revalidarPropuesta(p, { misiones: null }, t + H), { vigente: false, motivo: 'fuente_desconectada' }, 'no se pudo leer: no se inventa que sigue igual');
  const pc = { ...p, misionId: undefined, tipo: 'ayuda' as const, evidencia: { ...p.evidencia, fuente: { tipo: 'correo' as const, visto: t } } };
  assert.deepEqual(ini.revalidarPropuesta(pc, { correoSinLeer: 2 }, t + H), { vigente: true });
  assert.deepEqual(ini.revalidarPropuesta(pc, { correoSinLeer: 0 }, t + H), { vigente: false, motivo: 'resuelta' });
  assert.deepEqual(ini.revalidarPropuesta(pc, { correoSinLeer: null }, t + H), { vigente: false, motivo: 'fuente_desconectada' });
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
