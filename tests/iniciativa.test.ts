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
