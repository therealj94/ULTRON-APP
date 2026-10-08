/**
 * EL TURNO ESPECULATIVO, de punta a punta en el servidor de verdad (server.ts + server/turno-especulativo.ts) con un
 * Bedrock falso. Lo que importa: el texto puede adelantarse (el teléfono no lo suena hasta confirmar), pero NADA con
 * efecto ocurre antes del «sí» del teléfono: ni acciones al teléfono, ni herramientas, ni el `done` que las lleva; y un
 * pedido que no es charla no llega ni al modelo hasta confirmar. Si se corta sin confirmar, no ocurre nunca.
 */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { abrirTurno, esperarQue, levantarServidor, type RespuestaFalsa } from './servidor-falso';

let contestar: (ultimo: string) => RespuestaFalsa = () => ({ texto: '[EMO: neutral] Claro, aquí estoy contigo.' });
// Revisión 9: un miembro (fuera del padrón) con un cupo corto, para probar que lo descartado no gasta su cupo. Sin registro
// de cuentas, el despliegue declara que no hay suspensiones (la junta del padrón no cambia).
const TURNOS_MIEMBRO = 2;
const s = await levantarServidor({ correo: 'jose.especulativo@ordenglobal.org', env: { TURNOS_MIEMBRO_MIN: String(TURNOS_MIEMBRO), AURA_SUSPENSIONES: 'ninguna' }, contestar: (u) => contestar(u) });
after(() => s.cerrar());

const confirmar = (idTurno: string) => fetch(`${s.BASE}/api/turno/confirmar`, { method: 'POST', headers: s.h, body: JSON.stringify({ idTurno }) }).then((r) => r.json());
const id = (n: string) => `esp-${n}-${Date.now()}`;

test('el servidor levanta', () => {
  assert.ok(s.listo, `no levantó: ${s.errores()}`);
});

test('charla especulativa: el texto llega antes de confirmar; el `done` (y lo que hace) espera el «sí» del teléfono', { skip: !s.listo }, async () => {
  contestar = () => ({ texto: '[EMO: feliz] Me encanta la lluvia, la verdad. Huele a tierra mojada.' });
  const idTurno = id('charla');
  const t = abrirTurno(s.BASE, s.h, { message: '¿Qué opinas de la lluvia de esta semana?', hablado: true, idioma: 'es', avatar: 'aura', idTurno, especulativo: true });
  assert.ok(await esperarQue(() => t.hay('delta')), 'el texto se adelanta');
  await new Promise((r) => setTimeout(r, 300));
  assert.equal(t.hay('done'), false, 'sin confirmar, el turno no termina');
  const r = await confirmar(idTurno);
  assert.equal(r.estado, 'confirmado');
  assert.ok(await esperarQue(() => t.hay('done')), 'confirmado, termina');
  await t.fin;
});

test('charla especulativa cuyo modelo pide una herramienta: cortada sin confirmar, la acción no llega nunca al teléfono', { skip: !s.listo }, async () => {
  contestar = () => ({ texto: '[EMO: neutral] Va, te llamo.', herramienta: { nombre: 'llamarme', input: { en_segundos: 600 } } });
  const antes = s.acciones.length;
  const idTurno = id('corta');
  const t = abrirTurno(s.BASE, s.h, { message: '¿Qué opinas de la lluvia en la tarde?', hablado: true, idioma: 'es', avatar: 'aura', idTurno, especulativo: true });
  assert.ok(await esperarQue(() => s.pedidos.length > 0 && t.eventos.length > 0));
  await new Promise((r) => setTimeout(r, 400));
  t.cortar();
  await new Promise((r) => setTimeout(r, 600));
  assert.equal(s.acciones.length, antes, 'ninguna acción salió hacia el teléfono');
  assert.equal(t.hay('done'), false);
  assert.equal((await confirmar(idTurno)).estado, 'no-existe', 'cortado, ya no se puede confirmar');
});

test('la misma, confirmada: la acción sí llega (la retención no se come lo que se pidió de verdad)', { skip: !s.listo }, async () => {
  contestar = () => ({ texto: '[EMO: neutral] Va, te llamo.', herramienta: { nombre: 'llamarme', input: { en_segundos: 600 } } });
  const antes = s.acciones.length;
  const idTurno = id('confirma');
  const t = abrirTurno(s.BASE, s.h, { message: '¿Qué opinas de la lluvia en la noche?', hablado: true, idioma: 'es', avatar: 'aura', idTurno, especulativo: true });
  assert.ok(await esperarQue(() => t.eventos.length > 0));
  await new Promise((r) => setTimeout(r, 200));
  assert.equal(s.acciones.length, antes);
  await confirmar(idTurno);
  assert.ok(await esperarQue(() => t.hay('done')));
  const done = t.eventos.find((e) => e.ev === 'done')!.data;
  await esperarQue(() => s.acciones.length > antes, 2_000);
  assert.ok(s.acciones.length > antes || (done.acciones || []).length > 0, `la acción salió al confirmar: ${JSON.stringify(done).slice(0, 300)}`);
  await t.fin;
});

test('un pedido que no es charla («llámame en diez minutos») no llega ni al modelo antes de confirmar; cortado, nunca', { skip: !s.listo }, async () => {
  contestar = () => ({ texto: '[EMO: neutral] Va.', herramienta: { nombre: 'llamarme', input: { en_segundos: 600 } } });
  const antes = s.pedidos.length;
  const accionesAntes = s.acciones.length;
  const t = abrirTurno(s.BASE, s.h, { message: 'Llámame en diez minutos.', hablado: true, idioma: 'es', avatar: 'aura', idTurno: id('orden'), especulativo: true });
  await new Promise((r) => setTimeout(r, 500));
  assert.equal(s.pedidos.length, antes, 'ni siquiera se le preguntó al modelo');
  assert.equal(t.hay('delta'), false);
  t.cortar();
  await new Promise((r) => setTimeout(r, 400));
  assert.equal(s.pedidos.length, antes);
  assert.equal(s.acciones.length, accionesAntes);
});

/*
 * Revisión 8 (MEDIO-1): «mejor no», «nel», «déjame pensar» parecen charla, pero con algo esperando su decisión el «no» y
 * el apartado se aplicaban antes del «sí» del teléfono (y con «…bueno, sí, mándalo» el borrador ya estaba borrado).
 * Ahora, con algo pendiente, ni la charla empieza sin confirmar; descartado, no llega nunca al modelo ni a las decisiones.
 */
/** El contexto del teléfono como lo deja servidor-falso.ts (tres contactos y sus manos), más lo que se pase. */
const CONTACTOS = ['Ana', 'Beto', 'Mamá'].map((nombre, i) => ({ nombre, correo: `contacto${i}@ejemplo.org` }));
const MANOS = ['llamar', 'leer', 'buscar', 'idioma', 'perfil', 'recordatorio', 'recordatorio_llamada', 'llamame', 'controles'];
const contexto = (cuerpo: Record<string, unknown>) => fetch(`${s.BASE}/api/app/contexto`, { method: 'POST', headers: s.h, body: JSON.stringify({ pantalla: 'chats', contactos: CONTACTOS, manos: MANOS, ...cuerpo }) });
for (const frase of ['Mejor no.', 'Nel.', 'Mmm, déjame pensar.']) {
  test(`con algo esperando su decisión, «${frase}» especulativo espera el «sí» del teléfono; descartado, no toca nada`, { skip: !s.listo }, async () => {
    contestar = () => ({ texto: '[EMO: neutral] Va, como quieras.' });
    await contexto({ chatAbierto: { nombre: 'Ana', correo: 'contacto0@ejemplo.org' }, borrador: 'Te veo a las cinco en el parque.' });
    try {
      const antes = s.pedidos.length;
      const t = abrirTurno(s.BASE, s.h, { message: frase, hablado: true, idioma: 'es', avatar: 'aura', idTurno: id('pendiente'), especulativo: true });
      await new Promise((r) => setTimeout(r, 500));
      assert.equal(s.pedidos.length, antes, 'sin confirmar no se le preguntó al modelo');
      assert.equal(t.hay('delta'), false, 'ni una palabra antes de confirmar');
      t.cortar();
      await new Promise((r) => setTimeout(r, 300));
      assert.equal(s.pedidos.length, antes, 'descartado, nunca');
    } finally {
      await contexto({ pantalla: 'mesa' });
    }
  });
}

test('con algo esperando, el mismo «mejor no» confirmado sí corre (la espera no se come la respuesta)', { skip: !s.listo }, async () => {
  contestar = () => ({ texto: '[EMO: neutral] Va, como quieras.' });
  await contexto({ chatAbierto: { nombre: 'Ana', correo: 'contacto0@ejemplo.org' }, borrador: 'Te veo a las cinco en el parque.' });
  try {
    const idTurno = id('pendiente-ok');
    const t = abrirTurno(s.BASE, s.h, { message: 'Mejor no.', hablado: true, idioma: 'es', avatar: 'aura', idTurno, especulativo: true });
    await new Promise((r) => setTimeout(r, 300));
    assert.equal(t.hay('delta'), false);
    assert.equal((await confirmar(idTurno)).estado, 'confirmado');
    assert.ok(await esperarQue(() => t.hay('done')), 'confirmado, termina');
    await t.fin;
  } finally {
    await contexto({ pantalla: 'mesa' });
  }
});

test('sin `especulativo`, el turno de siempre no espera a nadie', { skip: !s.listo }, async () => {
  contestar = () => ({ texto: '[EMO: feliz] Claro que sí.' });
  const t = abrirTurno(s.BASE, s.h, { message: '¿Te gusta la música?', hablado: true, idioma: 'es', avatar: 'aura', idTurno: id('normal') });
  assert.ok(await esperarQue(() => t.hay('done')));
  await t.fin;
});

/* La ruta de charla (lib/cerebro-rapido.ts planDeModelos): la charla hablada va primero al cerebro rápido. */
test('revisión de la tanda F (B2): «no me molestes hoy» especulado y cortado NO pausa el día; la frase final confirmada sí', { skip: !s.listo }, async () => {
  const hoyNo = async () => ((await (await fetch(`${s.BASE}/api/iniciativa/dia`, { headers: s.h })).json()) as any).hoyNo;
  assert.equal(await hoyNo(), false);
  // La frase a medias: el oído la especula y la persona sigue hablando («…con eso, dime la hora»): se corta.
  const t1 = abrirTurno(s.BASE, s.h, { message: 'No me molestes hoy', hablado: true, idioma: 'es', avatar: 'aura', idTurno: id('hoyno-corta'), especulativo: true });
  await new Promise((r) => setTimeout(r, 500));
  assert.equal(t1.hay('done'), false, 'sin confirmar, no contesta ni termina');
  t1.cortar();
  await new Promise((r) => setTimeout(r, 400));
  assert.equal(await hoyNo(), false, 'cortada, el día NO quedó en pausa');
  // La frase final, confirmada: sí.
  const idTurno = id('hoyno-confirma');
  const t2 = abrirTurno(s.BASE, s.h, { message: 'No me molestes hoy', hablado: true, idioma: 'es', avatar: 'aura', idTurno, especulativo: true });
  await new Promise((r) => setTimeout(r, 300));
  assert.equal(await hoyNo(), false, 'antes del «sí» del teléfono, nada escrito');
  assert.equal((await confirmar(idTurno)).estado, 'confirmado');
  assert.ok(await esperarQue(() => t2.hay('done')), 'confirmada, contesta');
  const done = t2.eventos.find((e) => e.ev === 'done')!.data;
  assert.equal(done.reply, 'Listo, hoy no te busco. Solo te aviso si algo urgente de tus contactos importantes.');
  await t2.fin;
  let pausado = false;
  for (let i = 0; i < 30 && !pausado; i++) {
    pausado = (await hoyNo()) === true;
    if (!pausado) await new Promise((r) => setTimeout(r, 100));
  }
  assert.ok(pausado, 'confirmada, el día queda en pausa');
  // Que no estorbe a las demás pruebas.
  await fetch(`${s.BASE}/api/iniciativa/dia/hoy-no`, { method: 'POST', headers: s.h, body: JSON.stringify({ quitar: true }) });
});

test('la charla hablada va primero a Kimi; una orden, lo que pide ir a fondo o lo escrito, a GLM-5 (el de las manos)', { skip: !s.listo }, async () => {
  contestar = () => ({ texto: '[EMO: neutral] Claro.' });
  const modeloDe = async (message: string, extra: Record<string, unknown> = {}) => {
    const antes = s.pedidos.length;
    const t = abrirTurno(s.BASE, s.h, { message, idioma: 'es', avatar: 'aura', idTurno: id('ruta'), ...extra });
    await esperarQue(() => t.hay('done'));
    await t.fin;
    return s.pedidos.slice(antes)[0]?.modelo;
  };
  assert.equal(await modeloDe('¿Tú qué harías un domingo libre?', { hablado: true }), 'moonshotai.kimi-k2.5');
  assert.equal(await modeloDe('Llámame en diez minutos.', { hablado: true }), 'zai.glm-5');
  assert.equal(await modeloDe('Explícame paso a paso cómo se forma el oro.', { hablado: true }), 'zai.glm-5');
  assert.equal(await modeloDe('¿Tú qué harías un sábado libre?'), 'zai.glm-5', 'escrito: como siempre');
  const linea = s.stdout().split('\n').filter((l) => /\[mesa\] turno .* \(hablado\)/.test(l) && /\(charla\)/.test(l)).at(-1) || '';
  assert.match(linea, / · por bedrock moonshotai\.kimi-k2\.5 \(charla\) · total \d+ ms$/, 'la línea del turno lo dice');
});

/*
 * Revisión 9 (MENOR 2): la carrera del «sí». El confirmar llega por otra conexión y le puede ganar al stream que todavía no
 * registró su turno: antes contestaba `no-existe`, el teléfono cortaba y la frase se perdía.
 */
test('el confirmar que llega antes que el stream se guarda: el turno se abre ya confirmado y termina sin otro «sí»', { skip: !s.listo }, async () => {
  contestar = () => ({ texto: '[EMO: neutral] Claro, aquí estoy.' });
  const idTurno = id('carrera');
  const c = await confirmar(idTurno);
  assert.equal(c.estado, 'confirmado', 'el teléfono no corta: se confirma al abrirse');
  assert.equal(c.anticipada, true);
  const t = abrirTurno(s.BASE, s.h, { message: '¿Cómo va tu día?', hablado: true, idioma: 'es', avatar: 'aura', idTurno, especulativo: true });
  assert.ok(await esperarQue(() => t.hay('done'), 5_000), 'termina sin esperar otra confirmación (antes: se descartaba a los 8 s)');
  await t.fin;
});

/* Revisión 9 (MENOR 3): cada intento especulativo descartado gastaba un lugar del cupo del miembro (y lo dejaba sin turnos). */
test('los intentos especulativos descartados de un miembro no gastan su cupo de turnos', { skip: !s.listo }, async () => {
  contestar = () => ({ texto: '[EMO: neutral] Va.', demoraMs: 300 });
  const { emitirSesion } = await import('../server/seguridad');
  const yo = emitirSesion({ correo: 'miembro.especulativo@ejemplo.org', nombre: 'Marta', rol: 'Miembro' }, { comunidad: true });
  const h = { ...s.h, 'x-ultron-sesion': yo.token, 'x-aura-aparato': 'aparato-miembro' };
  // Más pausas que el cupo: cada una empieza un turno especulativo y la persona sigue hablando (se corta).
  for (let i = 0; i < TURNOS_MIEMBRO + 2; i++) {
    const t = abrirTurno(s.BASE, h, { message: `Oye, cuéntame algo ${i}`, hablado: true, idioma: 'es', avatar: 'aura', idTurno: id(`cupo-${i}`), especulativo: true });
    await new Promise((r) => setTimeout(r, 150));
    t.cortar();
    await t.fin;
    await new Promise((r) => setTimeout(r, 100));
  }
  // La frase entera sí es un turno: tiene su lugar (antes: 429 «Vas muy rápido»).
  const r = await fetch(`${s.BASE}/api/turno/stream`, { method: 'POST', headers: h, body: JSON.stringify({ message: 'Oye, cuéntame algo bonito.', hablado: true, idioma: 'es', avatar: 'aura', idTurno: id('cupo-final') }) });
  assert.equal(r.status, 200, `la frase entera no se quedó sin cupo: ${r.status}`);
  await r.text();
});

/*
 * Revisión independiente (MENOR 5): un miembro que nunca confirma igual recibía el texto por `delta` y se le devolvía el
 * lugar: respuestas gratis, hasta 4× el cupo. Un turno descartado que ya le dio texto al teléfono sí cuenta.
 */
test('un especulativo descartado que ya le mandó texto por `delta` sí gasta su lugar del cupo', { skip: !s.listo }, async () => {
  contestar = () => ({ texto: '[EMO: neutral] Claro, te cuento.' });
  const { emitirSesion } = await import('../server/seguridad');
  const yo = emitirSesion({ correo: 'miembro.delta@ejemplo.org', nombre: 'Rita', rol: 'Miembro' }, { comunidad: true });
  const h = { ...s.h, 'x-ultron-sesion': yo.token, 'x-aura-aparato': 'aparato-miembro-delta' };
  for (let i = 0; i < TURNOS_MIEMBRO; i++) {
    const t = abrirTurno(s.BASE, h, { message: `Oye, cuéntame algo ${i}`, hablado: true, idioma: 'es', avatar: 'aura', idTurno: id(`delta-${i}`), especulativo: true });
    assert.ok(await esperarQue(() => t.hay('delta')), 'el texto llegó antes de confirmar');
    t.cortar();
    await t.fin;
    await new Promise((r) => setTimeout(r, 100));
  }
  const r = await fetch(`${s.BASE}/api/turno/stream`, { method: 'POST', headers: h, body: JSON.stringify({ message: 'Oye, cuéntame otra cosa.', hablado: true, idioma: 'es', avatar: 'aura', idTurno: id('delta-final') }) });
  const cuerpo = await r.text();
  assert.equal(r.status, 429, `los turnos que ya dieron texto contaron: ${r.status} ${cuerpo.slice(0, 120)}`);
  assert.match(cuerpo, /demasiados_turnos/);
});

