/**
 * Prometer sin hacer (lib/promesas.ts), con las frases REALES de la conversación de voz de José del 4-oct
 * (00:55 UTC) y negativos de respuestas normales: el clasificador es conservador y la guarda del final del
 * turno solo corrige lo que ninguna herramienta del turno respalda.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { clasificarFrase, clasificarPromesas, frases, lineaDeResultado, noUsaResultados, quitarVolcados, resumenDeResultados, trozoPromete, vigilarPromesas, type PasoVigilado } from '../lib/promesas';

const WEB = `HARNESS web "hitos importantes historia Honduras":
1. Genomas de huesos antiguos revelan el origen de los mayas de Copán — Un estudio de ADN antiguo de Copán muestra que la ciudad recibió gente de varias regiones. [https://ejemplo.test/copan]
2. Independencia de Centroamérica, 1821 — Honduras se independizó de España el 15 de septiembre de 1821. [https://ejemplo.test/1821]
3. Historia de Honduras — Wikipedia — Resumen de la historia del país desde la época maya hasta hoy. [https://ejemplo.test/historia]
PRIMERA FUENTE (https://ejemplo.test/copan): Copán fue una de las grandes ciudades mayas.`;
const buscó: PasoVigilado[] = [
  { herramienta: 'web', estado: 'succeeded', resumen: WEB },
  { herramienta: 'web', estado: 'succeeded', resumen: WEB.replace('hitos importantes', 'mayas') },
];

test('frases: unidas devuelven el texto exacto; «¿» abre otra frase; un punto entre cifras no corta', () => {
  const t = 'Ya está encendida. ¿Qué necesitás que haga? El oro está a 4.163 dólares.\nOtra línea';
  assert.equal(frases(t).join(''), t);
  assert.deepEqual(
    frases(t).map((f) => f.trim()).filter(Boolean),
    ['Ya está encendida.', '¿Qué necesitás que haga?', 'El oro está a 4.163 dólares.', 'Otra línea']
  );
});

test('las frases reales de José que prometían sin hacer se detectan', () => {
  const casos: [string, string][] = [
    ['Ya está encendida.', 'computadora'],
    ['Voy a buscar los hitos clave de Honduras desde Copán hasta hoy.', 'trabajo'],
    ['Va, te aviso por PULSE2CHAT cuando termine.', 'pulse'],
    ['Va, te aviso por PULSE2CHAT cuando termine.', 'aviso'],
    ['Ya lo busco.', 'trabajo'],
    ['Te aviso cuando termine.', 'aviso'],
    ['Ahí voy.', 'trabajo'],
    ['Empiezo ya con eso.', 'trabajo'],
    ['Lo estoy haciendo.', 'trabajo'],
    ['Déjame investigar eso un momento.', 'trabajo'],
    ['Estoy buscando la información.', 'trabajo'],
    ['Ya la encendí.', 'computadora'],
    ['Te lo mando por PULSE2CHAT.', 'pulse'],
    ["I'll look into it and let you know.", 'trabajo'],
  ];
  for (const [f, tipo] of casos) assert.ok(clasificarFrase(f).includes(tipo as any), `${f} → ${clasificarFrase(f)}`);
  // La oferta de buscar (en pregunta) es oferta, no promesa.
  assert.deepEqual(clasificarFrase('¿Querés que busque los hitos más importantes de Honduras?'), ['oferta']);
  assert.deepEqual(clasificarFrase('Puedo traerte datos concretos.'), ['oferta']);
  assert.equal(clasificarPromesas('¿Querés que busque algo específico de los mayas en Honduras, como Copán?').promete, false);
});

test('una respuesta normal no se toma por promesa (sin falsos positivos)', () => {
  for (const t of [
    '[EMO: neutral] La inflación es cuando suben los precios.',
    'El oro está a cuatro mil dólares la onza.',
    'Copán fue una gran ciudad maya en el occidente de Honduras.',
    'Una sopa te caería bien. ¿Te busco recetas?',
    'Si quieres, te aviso cuando salga el resultado.',
    'Todavía no lo empecé. ¿Lo investigo ahora?',
    'No voy a buscar eso.',
    'Te aviso que mañana es feriado.',
    'Empiezo por lo más importante: Honduras se independizó en 1821.',
    'Te traigo buenas noticias: tu pedido llegó.',
    'Déjame ver… creo que fue en 1821.',
    'Te leo el primero: Ana dice que llega tarde.',
    'Busqué y encontré que Copán fue fundada hacia el año 426.',
    '¿Quieres que te llame mañana?',
  ])
    assert.equal(clasificarPromesas(t).promete, false, `${t} → ${clasificarPromesas(t).tipos}`);
  assert.equal(trozoPromete('Copán fue una ciudad maya. '), false);
  assert.equal(trozoPromete('Va, te aviso por PULSE2CHAT cuando termine. '), true);
});

test('el volcado HARNESS nunca queda en lo que se dice; el resumen de una búsqueda se dice como persona', () => {
  const crudo = `Va, te aviso cuando termine.\n\n${WEB}`;
  assert.equal(quitarVolcados(crudo), 'Va, te aviso cuando termine.');
  const r = resumenDeResultados([WEB]);
  assert.match(r, /^Esto encontré\./);
  assert.match(r, /1821/);
  assert.ok(!/HARNESS|https?:|PRIMERA FUENTE/.test(r), r);
  const l = lineaDeResultado('web', { texto: WEB, estado: 'succeeded' });
  assert.ok(!/HARNESS/.test(l));
  assert.match(l, /Copán/);
  // Una herramienta que no trajo nada útil: una línea honrada, nunca su volcado.
  assert.equal(lineaDeResultado('web', { texto: 'HARNESS web "x": sin resultados.', estado: 'failed' }), 'Lo busqué, pero no alcancé a sacar nada útil para contarte.');
  assert.ok(!/HARNESS/.test(lineaDeResultado('tarea', { texto: 'HARNESS tarea: listo', estado: 'succeeded' })));
});

test('guarda: «Ya está encendida» sin su computadora en el turno no se entrega', () => {
  const v = vigilarPromesas('Ya está encendida. ¿Qué necesitás que haga? Puedo buscar en páginas, llenar formularios…', { pasos: [] });
  assert.equal(v.cambiada, true);
  assert.ok(!/encendida/.test(v.texto), v.texto);
  assert.match(v.texto, /^Todavía no he hecho nada en mi computadora\./);
  // Con su computadora en el turno, se respeta.
  const ok = vigilarPromesas('Ya está encendida. Mira la pantalla.', { pasos: [{ herramienta: 'computadora', estado: 'unknown' }] });
  assert.equal(ok.cambiada, false);
});

test('guarda: buscó y contestó con una pregunta o una promesa → un resumen hecho con los resultados', () => {
  for (const reply of [
    '¿Querés que busque los hitos más importantes de Honduras, desde los mayas hasta hoy? Puedo traerte datos concretos.',
    'Voy a buscar los hitos clave de Honduras desde Copán hasta hoy.',
  ]) {
    const v = vigilarPromesas(reply, { pasos: buscó });
    assert.equal(v.cambiada, true, reply);
    assert.match(v.texto, /^Esto encontré\./, v.texto);
    assert.match(v.texto, /1821/);
    assert.ok(!/voy a buscar|quer[eé]s que busque/i.test(v.texto), v.texto);
  }
  // Si contestó con los datos y al final ofrece buscar más, se deja (la oferta va con resultados ya dichos).
  const bien = 'Honduras se independizó en 1821 y Copán fue una gran ciudad maya. Además, el país tuvo reformas liberales en 1876. ¿Quieres que busque más?';
  const v2 = vigilarPromesas(bien, { pasos: buscó });
  assert.match(v2.texto, /1821/);
  assert.ok(!/HARNESS/.test(v2.texto));
});

test('guarda: «te aviso por PULSE2CHAT» + volcado (el turno de las 00:57:47) → sin volcado ni PULSE2CHAT, con los resultados', () => {
  const v = vigilarPromesas(`Va, te aviso por PULSE2CHAT cuando termine.  ${WEB}`, { pasos: buscó });
  assert.ok(!/HARNESS|PRIMERA FUENTE/.test(v.texto), v.texto);
  assert.match(v.texto, /Esto encontré/);
  assert.match(v.texto, /Todavía no puedo escribirte por PULSE2CHAT/);
  assert.ok(!/te aviso por PULSE2CHAT/.test(v.texto));
});

test('guarda: con una investigación de verdad empezada, «te aviso» vale; PULSE2CHAT se corrige a notificación y Tareas', () => {
  const pasos = [{ herramienta: 'investigar', estado: 'succeeded' }];
  const v = vigilarPromesas('Listo, ya empecé a investigarlo. Te aviso cuando termine.', { pasos });
  assert.equal(v.cambiada, false);
  const p = vigilarPromesas('Ya empecé. Te lo mando por PULSE2CHAT cuando termine.', { pasos });
  assert.match(p.texto, /notificación al teléfono y el resultado queda en Tareas/);
  assert.ok(!/te lo mando por PULSE2CHAT/i.test(p.texto));
});

test('guarda: «voy a buscar» sin herramienta → honesto; con una acción de la app («te aviso» de un recordatorio) se respeta', () => {
  const v = vigilarPromesas('[EMO: neutral] Va, voy a investigar eso y te aviso.', { pasos: [] });
  assert.equal(v.texto, '[EMO: neutral] Todavía no lo empecé. ¿Lo investigo ahora y te aviso con una notificación cuando termine?');
  const r = vigilarPromesas('Va, te aviso a las cinco.\nACCION_APP: {"tipo":"recordatorio"}', { pasos: [], acciones: 1 });
  assert.equal(r.cambiada, false);
  // Las líneas de la máquina se conservan aunque se corrija el texto.
  const m = vigilarPromesas('Ya está encendida.\nACCION_APP: {"tipo":"abrir","pantalla":"computadora"}', { pasos: [], acciones: 0 });
  assert.match(m.texto, /ACCION_APP: \{"tipo":"abrir"/);
  // Con una respuesta de verdad, lo que contestó va primero y lo que falta, después.
  const c = vigilarPromesas('El oro está a 4 163 dólares la onza hoy. Te aviso si cambia.', { pasos: buscó });
  assert.equal(c.texto, 'El oro está a 4 163 dólares la onza hoy. Todavía no dejé nada puesto para avisarte.');
  // Una respuesta normal pasa intacta.
  const n = vigilarPromesas('Copán fue una gran ciudad maya.', { pasos: [] });
  assert.deepEqual(n, { texto: 'Copán fue una gran ciudad maya.', cambiada: false, motivos: [] });
});

test('noUsaResultados: la vuelta que tras buscar solo pregunta o promete; la que contesta, no', () => {
  assert.equal(noUsaResultados('¿Querés que busque los hitos más importantes de Honduras? Puedo traerte datos concretos.'), true);
  assert.equal(noUsaResultados('Voy a buscar los hitos clave de Honduras desde Copán hasta hoy.'), true);
  assert.equal(noUsaResultados('Honduras se independizó en 1821; Copán fue una gran ciudad maya del período clásico.'), false);
});

test('guarda: una acción ajena en el mismo turno (Ajustes, un borrador) no respalda «voy a investigar y te aviso» (Codex, PR 142)', () => {
  const mixto = vigilarPromesas('Listo, abrí Ajustes. Voy a investigar eso y te aviso.', { pasos: [{ herramienta: 'correo', estado: 'succeeded' }], acciones: 1 });
  assert.equal(mixto.cambiada, true, 'la promesa de investigar sale aunque hubo otra acción');
  assert.doesNotMatch(mixto.texto, /Voy a investigar/);
  assert.match(mixto.texto, /abrí Ajustes/, 'lo demás queda');
  const conInvestigar = vigilarPromesas('Voy a investigar eso y te aviso.', { pasos: [{ herramienta: 'investigar', estado: 'succeeded' }] });
  assert.equal(conInvestigar.cambiada, false, 'con la investigación empezada, vale');
  const recordatorio = vigilarPromesas('Te aviso a las cinco.', { pasos: [], acciones: 1 });
  assert.equal(recordatorio.cambiada, false, '«te aviso» de un recordatorio (acción de la app) vale');
});

test('revisión del 5-oct (GRAVE-2): lo dicho en pasado sobre otro turno no es promesa (ni la guarda ni la corrección local lo tocan)', async () => {
  const { corregirPromesaSinHerramienta, prometeSinHacer } = await import('../lib/cerebro-manos');
  for (const t of ['Sí, ya te lo mandé hace rato.', 'Ese correo se lo mandé ayer a las cinco.', 'Lo puse esta mañana, ya está.']) {
    assert.equal(clasificarPromesas(t).promete, false, `guarda: ${t}`);
    assert.equal(vigilarPromesas(t, { pasos: [] }).cambiada, false, `guarda: ${t}`);
    assert.equal(prometeSinHacer(t), false, `promesa nueva: ${t}`);
    assert.equal(corregirPromesaSinHerramienta(t).cambiada, false, `corrección local: ${t}`);
  }
  // «Listo, ya te lo mandé» sin nada que lo ponga antes sigue siendo dar por hecho algo de este turno.
  assert.equal(prometeSinHacer('Listo, ya te lo mandé.'), true);
});

test('revisión independiente del 5-oct (GRAVE-A): «para mañana en la mañana», «para el lunes», «más temprano, a las 5» no son de antes', async () => {
  const { corregirPromesaSinHerramienta, prometeSinHacer } = await import('../lib/cerebro-manos');
  // Promesas falsas que con 3e163da se corregían y con ee5cfb0 pasaban como «cosas de otro turno».
  for (const t of ['Listo, te puse el recordatorio para mañana en la mañana.', 'Ya te agendé la cita para el lunes.', 'Te puse la alarma más temprano, a las 5.']) {
    assert.equal(prometeSinHacer(t), true, `promesa nueva: ${t}`);
    assert.equal(corregirPromesaSinHerramienta(t).cambiada, true, `corrección local: ${t}`);
  }
  // Lo de otro turno sigue sin ser promesa.
  assert.equal(prometeSinHacer('Sí, ya te lo mandé hace rato.'), false);
  assert.equal(corregirPromesaSinHerramienta('Sí, ya te lo mandé hace rato.').cambiada, false);
});
