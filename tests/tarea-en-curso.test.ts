/**
 * La tarea en curso (lib/tarea-en-curso.ts). José (2-oct): «no empezar a hacer otra cosa sin terminar una, o
 * que pregunte si ya no quiere hacerlo o para después».
 *
 *  · progreso, siguiente y bloque del turno (normal y de voz); al hacer el último paso, se cierra y lo dice;
 *  · pide otra cosa a mitad → AU-RA pregunta; el turno siguiente: pausar (queda en lo que quedó a medias),
 *    terminar primero (lo otro queda para después) o descartar; si no contesta y sigue con otra cosa, pausa;
 *  · lo que sigue la tarea («léeme el 3», «gracias», el «sí» a un borrador) no pregunta nada;
 *  · retomar, la herramienta `tarea`, el disco (redespliegue), la pausa sola y el turno de voz descartado.
 */
import test, { after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tarea-curso-'));
Object.assign(process.env, { ULTRON_TAREA_CURSO_DIR: path.join(dir, 'tc'), ULTRON_ABIERTOS_DIR: path.join(dir, 'ab'), ULTRON_MEMORIA_BUCKET: '' });
after(() => fs.rmSync(dir, { recursive: true, force: true }));

const T = await import('../lib/tarea-en-curso');
const A = await import('../lib/abiertos');
const { extraerPedidoHerramienta, instruccionHarness, resolverPedido } = await import('../lib/harness');

const QUIEN = 'lola@x.hn';
/** Alguien sin nada guardado de antes (lo de las otras pruebas queda en el disco). */
const VALE = 'vale@x.hn';
const AMB = 'tel-1';
const CORREOS = ['Ana Paz — «Factura de septiembre»', 'Banco Atlántida — «Estado de cuenta»', 'Beto Ruiz — «Reunión del lunes»', 'Notaría López — «Escritura»'];

const correos = (quien = QUIEN, ambito = AMB) => T.iniciarTarea(quien, ambito, { tipo: 'correo', titulo: 'revisar los 4 correos sin leer', pasos: CORREOS })!;

/** Espera a que algo que corre en segundo plano (anotar en lo que quedó a medias) termine. */
async function hasta(cond: () => boolean | Promise<boolean>, ms = 2000) {
  const fin = Date.now() + ms;
  while (Date.now() < fin) {
    if (await cond()) return true;
    await new Promise((r) => setTimeout(r, 15));
  }
  return false;
}

beforeEach(() => {
  T._olvidarTareas();
});

test('progreso: va paso a paso, el bloque dice cuál sigue y al hacer el último la cierra y lo dice', () => {
  const t = correos();
  assert.equal(T.progreso(t), 'no has empezado (4 en total)');
  let b = T.bloqueTarea(QUIEN, AMB);
  assert.match(b, /^TAREA EN CURSO \(no la dejes a medias\): «revisar los 4 correos sin leer» — no has empezado/);
  assert.match(b, /Siguiente: 1\. Ana Paz — «Factura de septiembre»/);
  assert.match(b, /No empieces otra cosa sin cerrarla/);
  const a1 = T.marcarPaso(QUIEN, AMB, 'correo', 0);
  assert.equal(a1.terminada, false);
  assert.match(a1.texto, /vas en el 1 de 4 \(1 hecho\).*ofrece el siguiente: 2\. Banco Atlántida/);
  T.marcarPaso(QUIEN, AMB, 'correo', 2);
  b = T.bloqueTarea(QUIEN, AMB);
  assert.match(b, /vas en el 3 de 4 \(2 hechos\)/);
  assert.match(b, /Siguiente: 4\. Notaría López/);
  assert.match(b, /Faltan: 2, 4\./, 'el que se saltó no se olvida');
  const voz = T.bloqueTarea(QUIEN, AMB, true);
  assert.ok(voz.length <= T.TOPE_TAREA.compacto, `en la voz es una línea corta (${voz.length})`);
  assert.match(voz, /^TAREA EN CURSO: «revisar los 4 correos sin leer», vas en el 3 de 4/);
  assert.equal(T.marcarPaso(QUIEN, AMB, 'whatsapp', 1).tarea, null, 'otro tipo no la toca');
  T.marcarPaso(QUIEN, AMB, 'correo', 3);
  const fin = T.marcarPaso(QUIEN, AMB, 'correo', 1, 'saltado');
  assert.equal(fin.terminada, true);
  assert.match(fin.texto, /^TAREA TERMINADA: «revisar los 4 correos sin leer» \(3 de 4 hechos, 1 saltados\)\. Díselo en una frase/);
  assert.equal(T.tareaDe(QUIEN, AMB), null, 'cerrada');
  assert.equal(T.bloqueTarea(QUIEN, AMB), '');
  assert.equal(T.tareaDe(QUIEN, 'web'), null, 'era de la conversación del teléfono');
});

test('lo que sigue la tarea no pregunta nada; otra cosa a mitad sí, en una frase', async () => {
  correos();
  T.marcarPaso(QUIEN, AMB, 'correo', 0);
  for (const m of ['léeme el 3', 'el siguiente', 'gracias', 'sí', 'ok', '¿y qué dice el del banco?', 'contéstale que sí', 'el de Beto', 'léeme el de Ana y luego el de Beto', 'ya está, el siguiente']) {
    assert.equal(await T.resolverTareaEnCurso(QUIEN, AMB, m), null, m);
    assert.equal(T.tareaDe(QUIEN, AMB)?.estado, 'activa', m);
  }
  assert.equal(await T.resolverTareaEnCurso(QUIEN, AMB, '¿cuánto está el oro hoy?', { borradorResuelto: true }), null, 'el «sí»/«no» a un borrador es parte de la tarea');
  const h = (await T.resolverTareaEnCurso(QUIEN, AMB, '¿Cuánto está el oro hoy en dólares?'))!;
  assert.match(h, /^TAREA A MEDIAS: estás en «revisar los 4 correos sin leer» \(vas en el 1 de 4/);
  assert.match(h, /pidió otra cosa: «¿Cuánto está el oro hoy en dólares\?»/);
  assert.match(h, /NO la empieces todavía/);
  assert.match(h, /«¿Dejamos los correos para después, los termino primero, o los descarto\?»/);
  assert.equal(T.tareaDe(QUIEN, AMB)?.estado, 'preguntando');
});

test('«para después»: queda en pausa y en lo que quedó a medias; AU-RA atiende lo que había pedido; luego se retoma', async () => {
  correos();
  T.marcarPaso(QUIEN, AMB, 'correo', 0);
  T.marcarPaso(QUIEN, AMB, 'correo', 1);
  await T.resolverTareaEnCurso(QUIEN, AMB, 'Recuérdame llamar al notario a las cinco de la tarde');
  const h = (await T.resolverTareaEnCurso(QUIEN, AMB, 'déjalos para después'))!;
  assert.match(h, /^TAREA EN PAUSA: decidió dejar «revisar los 4 correos sin leer» para después \(se quedó en 2 de 4/);
  assert.match(h, /Ahora atiende lo que había pedido: «Recuérdame llamar al notario a las cinco de la tarde»/);
  assert.equal(T.tareaDe(QUIEN, AMB)?.estado, 'pausada');
  assert.ok(await hasta(async () => (await A.abiertosDe(QUIEN)).some((a) => /^Revisar los 4 correos sin leer: quedó en 2 de 4$/.test(a.texto) && a.tipo === 'tarea')), 'quedó a medias');
  assert.ok(await hasta(() => !!T.tareaDe(QUIEN, AMB)?.abiertoId));
  assert.match(T.bloqueTarea(QUIEN, AMB), /^TAREA EN PAUSA \(la dejó para después\).*tarea retomar/);
  assert.equal(await T.resolverTareaEnCurso(QUIEN, AMB, '¿y el clima mañana?'), null, 'en pausa no vuelve a preguntar');
  const r = (await T.resolverTareaEnCurso(QUIEN, AMB, 'sigamos con los correos'))!;
  assert.match(r, /^TAREA RETOMADA: «revisar los 4 correos sin leer» — vas en el 2 de 4 \(2 hechos\)\. Sigue con el 3: Beto Ruiz/);
  assert.equal(T.tareaDe(QUIEN, AMB)?.estado, 'activa');
  assert.ok(await hasta(async () => !(await A.abiertosDe(QUIEN)).some((a) => /Revisar los 4 correos/.test(a.texto))), 'y ya no está a medias');
});

test('«termínalos primero»: sigue, y lo otro queda para cuando termine (se lo recuerda al cerrar)', async () => {
  correos();
  await T.resolverTareaEnCurso(QUIEN, AMB, 'Busca vuelos a Miami para el viernes');
  const h = (await T.resolverTareaEnCurso(QUIEN, AMB, 'no, termínalos primero'))!;
  assert.match(h, /^TAREA: decidió terminar primero .* Sigue ya con el 1: Ana Paz/);
  assert.match(h, /Lo que pidió \(«Busca vuelos a Miami para el viernes»\) queda para cuando terminen/);
  assert.equal(T.tareaDe(QUIEN, AMB)?.estado, 'activa');
  assert.match(T.bloqueTarea(QUIEN, AMB), /Al terminarla, atiende lo que pidió y quedó para después: «Busca vuelos a Miami/);
  for (const i of [0, 1, 2]) T.marcarPaso(QUIEN, AMB, 'correo', i);
  const fin = T.marcarPaso(QUIEN, AMB, 'correo', 3);
  assert.match(fin.texto, /^TAREA TERMINADA.*Ahora atiende lo que pidió antes y quedó para después: «Busca vuelos a Miami para el viernes»/);
});

test('«descártalos»: se cierra sin quedar a medias; y si no contesta y sigue con otra cosa, se pausa', async () => {
  correos();
  await T.resolverTareaEnCurso(QUIEN, AMB, 'Ponme música de Marco Antonio Solís');
  const h = (await T.resolverTareaEnCurso(QUIEN, AMB, 'descártalos'))!;
  assert.match(h, /^TAREA DESCARTADA: «revisar los 4 correos sin leer» \(se quedó en 0 de 4\)\. No la retomes\. Ahora atiende lo que había pedido: «Ponme música/);
  assert.equal(T.tareaDe(QUIEN, AMB), null);
  // Sin contestar la pregunta, otra cosa: se pausa (nada se pierde).
  correos('memo@x.hn');
  await T.resolverTareaEnCurso('memo@x.hn', AMB, '¿Quién ganó el partido de anoche?');
  const p = (await T.resolverTareaEnCurso('memo@x.hn', AMB, 'Y dime también cuánto está el dólar'))!;
  assert.match(p, /^TAREA EN PAUSA: no dijo qué hacer con «revisar los 4 correos sin leer» y siguió con otra cosa: los dejé para después/);
  assert.match(p, /«los correos quedan para después»/);
  // «Sí» a «¿los dejamos para después…?» es la primera opción.
  correos('nora@x.hn');
  await T.resolverTareaEnCurso('nora@x.hn', AMB, 'Cuéntame un chiste de programadores');
  assert.match((await T.resolverTareaEnCurso('nora@x.hn', AMB, 'sí'))!, /^TAREA EN PAUSA: decidió dejar/);
  // Volver a la tarea en vez de contestar: sigue, sin más.
  correos('olga@x.hn');
  await T.resolverTareaEnCurso('olga@x.hn', AMB, 'Cuéntame un chiste de programadores');
  assert.equal(await T.resolverTareaEnCurso('olga@x.hn', AMB, 'mejor léeme el del banco'), null);
  assert.equal(T.tareaDe('olga@x.hn', AMB)?.estado, 'activa');
});

test('a mitad, una decisión clara y corta actúa sin preguntar: «déjalo para luego», «ya está, los demás no»', async () => {
  correos();
  assert.match((await T.resolverTareaEnCurso(QUIEN, AMB, 'déjalo para luego'))!, /^TAREA EN PAUSA: dejó «revisar los 4 correos sin leer» para después/);
  correos('pepe@x.hn');
  T.marcarPaso('pepe@x.hn', AMB, 'correo', 0);
  assert.match((await T.resolverTareaEnCurso('pepe@x.hn', AMB, 'ya está, los demás no'))!, /^TAREA TERMINADA: .*\(1 de 4 hechos, 3 sin ver porque la dio por terminada\)/);
});

test('la voz: si el turno especulativo se descarta, la tarea vuelve a como estaba (y nada se anota hasta confirmarlo)', async () => {
  correos();
  const hacer: Array<() => void> = [];
  const descartar: Array<() => void> = [];
  const retener = { hacer: (f: () => void) => hacer.push(f), alDescartar: (f: () => void) => descartar.push(f) };
  assert.match((await T.resolverTareaEnCurso(QUIEN, AMB, 'Pon una alarma a las tres de la', { retener }))!, /TAREA A MEDIAS/);
  assert.equal(T.tareaDe(QUIEN, AMB)?.estado, 'preguntando');
  descartar.forEach((f) => f());
  assert.equal(T.tareaDe(QUIEN, AMB)?.estado, 'activa', 'la frase a medias no cuenta');
  // Una pausa en un turno de voz: el estado cambia ya, pero lo de «lo que quedó a medias» espera la confirmación.
  descartar.length = 0;
  assert.match((await T.resolverTareaEnCurso(QUIEN, AMB, 'déjalo para luego', { retener }))!, /TAREA EN PAUSA/);
  assert.equal(hacer.length, 1, 'anotarla espera a que la voz confirme');
  descartar.forEach((f) => f());
  assert.equal(T.tareaDe(QUIEN, AMB)?.estado, 'activa');
});

test('la herramienta «tarea»: empezar, hecho, saltar, pausar, retomar y terminar; va en el harness con sesión', async () => {
  assert.match(await T.correrTarea('', AMB, 'ver'), /solo con sesión/);
  assert.match(await T.correrTarea(VALE, AMB, 'hecho'), /no hay ninguna tarea en curso/);
  assert.match(await T.correrTarea(VALE, AMB, 'empezar Preparar el viaje | reservar hotel'), /al menos dos pasos/);
  const e = await T.correrTarea(VALE, AMB, 'empezar preparar el viaje a Copán | reservar hotel | comprar boletos de bus; avisar a Beto');
  assert.match(e, /^TAREA EMPEZADA: «preparar el viaje a Copán», 3 pasos: 1\. reservar hotel · 2\. comprar boletos de bus · 3\. avisar a Beto/);
  assert.match(await T.correrTarea(VALE, AMB, 'hecho'), /vas en el 1 de 3 \(1 hecho\).*2\. comprar boletos/);
  const pregunta = (await T.resolverTareaEnCurso(VALE, AMB, '¿Qué temperatura hace en Roatán?'))!;
  assert.match(pregunta, /«¿Dejamos lo de «preparar el viaje a Copán» para después, lo termino primero, o lo descarto\?»/);
  assert.match(await T.correrTarea(VALE, AMB, 'pausar'), /^TAREA EN PAUSA: «preparar el viaje a Copán» \(1 de 3\)/);
  assert.match(await T.correrTarea(VALE, AMB, 'retomar'), /^TAREA RETOMADA: .* Sigue con el 2: comprar boletos de bus/);
  assert.match(await T.correrTarea(VALE, AMB, 'saltar 2'), /vas en el 2 de 3 \(2 hechos\)/);
  assert.match(await T.correrTarea(VALE, AMB, 'terminar'), /^TAREA TERMINADA: «preparar el viaje a Copán» \(1 de 3 hechos, 1 saltados, 1 sin ver/);
  // El harness: el pedido se reconoce y va a su runner; la instrucción solo con sesión.
  const ped = extraerPedidoHerramienta('Listo.\nPEDIR_HERRAMIENTA: tarea pausar');
  assert.deepEqual(ped, { herramienta: 'tarea', arg: 'pausar' });
  const base = { web: async () => '', sistema: async () => '', leer: async () => '', ejecutor: async () => '' };
  assert.equal(await resolverPedido(ped!, { ...base, tarea: async (a) => `HECHO ${a}` }), 'HECHO pausar');
  assert.match(await resolverPedido(ped!, base), /no está disponible/);
  assert.match(instruccionHarness('miembro', false, false, true), /PEDIR_HERRAMIENTA: tarea empezar/);
  assert.doesNotMatch(instruccionHarness('miembro', false, false, false), /PEDIR_HERRAMIENTA: tarea/);
});

test('se guarda en disco (un redespliegue no la borra); la activa sin tocar se pausa sola', async () => {
  correos('rita@x.hn', 'voz');
  T.marcarPaso('rita@x.hn', 'voz', 'correo', 0);
  assert.ok(await hasta(() => fs.existsSync(path.join(dir, 'tc')) && fs.readdirSync(path.join(dir, 'tc')).some((f) => f.endsWith('.json'))));
  await new Promise((r) => setTimeout(r, 50));
  T._olvidarTareas(true);
  assert.equal(T.tareaDe('rita@x.hn', 'voz'), null, 'sin cargar todavía (el turno no espera)');
  await T.precargarTareas('rita@x.hn');
  const t = T.tareaDe('rita@x.hn', 'voz');
  assert.equal(t?.titulo, 'revisar los 4 correos sin leer');
  assert.equal(T.pasosHechos(t!), 1);
  // Tres horas sin tocarla: se pausa sola y queda en lo que quedó a medias.
  T.iniciarTarea('susy@x.hn', AMB, { tipo: 'correo', titulo: 'revisar los 2 correos sin leer', pasos: ['A — «x»', 'B — «y»'], ahora: Date.now() - T.TAREA_VIVE_MS - 60_000 });
  assert.equal(T.tareaDe('susy@x.hn', AMB)?.estado, 'pausada');
  assert.ok(await hasta(async () => (await A.abiertosDe('susy@x.hn')).some((a) => /Revisar los 2 correos sin leer/.test(a.texto))));
  // Empezar otra de otro tipo no pierde la que iba: queda a medias.
  correos('tito@x.hn');
  T.iniciarTarea('tito@x.hn', AMB, { tipo: 'whatsapp', titulo: 'revisar los 2 chats con mensajes sin leer', pasos: ['Beto', 'Familia (grupo)'] });
  assert.equal(T.tareaDe('tito@x.hn', AMB)?.tipo, 'whatsapp');
  assert.ok(await hasta(async () => (await A.abiertosDe('tito@x.hn')).some((a) => /Revisar los 4 correos sin leer: quedó en 0 de 4/.test(a.texto))));
});

test('decisiones y clasificación: lo que cuenta como cada cosa', () => {
  assert.equal(T.decisionDe('para después'), 'pausar');
  assert.equal(T.decisionDe('luego'), null, '«luego» suelto, solo si AU-RA acaba de preguntar');
  assert.equal(T.decisionDe('luego', true), 'pausar');
  assert.equal(T.decisionDe('Termínalos primero'), 'seguir');
  assert.equal(T.decisionDe('olvídalo'), 'descartar');
  assert.equal(T.decisionDe('ya no importan'), 'descartar');
  assert.equal(T.decisionDe('eso es todo'), 'cerrar');
  assert.equal(T.decisionDe('dale', true), 'pausar');
  assert.equal(T.decisionDe('no', true), 'seguir');
  assert.equal(T.decisionDe('¿qué hora es?'), null);
  const t = correos();
  assert.equal(T.clasificarMensaje(t, 'gracias'), 'neutral');
  assert.equal(T.clasificarMensaje(t, 'el 2'), 'sigue');
  assert.equal(T.clasificarMensaje(t, 'qué dice Beto'), 'sigue');
  assert.equal(T.clasificarMensaje(t, 'y lo de la notaría'), 'sigue');
  assert.equal(T.clasificarMensaje(t, 'pon una alarma para mañana a las seis'), 'otra');
});
