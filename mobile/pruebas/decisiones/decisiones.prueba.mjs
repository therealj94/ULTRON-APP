/**
 * Pruebas en Node de la VENTANA DE DECISIÓN de la mesa (José, 5-oct: «que me salga el pop up y me pregunte, y sea tocar
 * Sí o No o Editar, y pueda decirlo hablado… que maneje las cosas en orden»), sin teléfono:
 *   · qué entra y en qué orden (lo que acaba de preguntar el turno primero; luego lo más viejo; «1 de 3»);
 *   · cuál se ve (no salta mientras sigue esperando; resuelta una, la siguiente) y cuándo se abre sola («Luego»);
 *   · los botones de verdad (borrador: Sí · No · Editar; lo que no se edita: Sí · No; vencida: Rehacer · Descartar;
 *     la tarea a medias: sus respuestas; la computadora: Sí · No) y que «Sí» nunca va armado de entrada;
 *   · cuándo dice la pregunta en voz alta (una vez; nunca en una conversación de voz ni lo que el turno ya leyó);
 *   · editar: el texto entero, que no quede vacío, que algo cambie y que no se guarde sobre otra decisión;
 *   · el cliente HTTP: editar y en-pantalla van atados a la decisión y la versión que se vieron.
 *
 *   cd mobile && npx tsx pruebas/decisiones/decisiones.prueba.mjs
 */
import assert from 'node:assert/strict';
import {
  LUEGO_MS,
  MAX_EDITAR,
  botonesVentana,
  colaVentana,
  cuerpoEdicion,
  datosVentana,
  debeHablar,
  edicionVigente,
  elegirActual,
  empezarEdicion,
  entraEnVentana,
  fraseVentana,
  hastaLuego,
  luegoEnServidor,
  nuevoPorVoz,
  pedidoRehacer,
  puedeGuardar,
  seAbreSola,
  tareaEnPantalla,
  textoPosicion,
  tieneLuego,
} from '../../src/lib/decisionesMesa.ts';
import { crearClienteTrabajos, pospuestas, puedeActivar, textoIndicador } from '../../src/lib/trabajos.ts';

let fallos = 0;
let pasan = 0;
function prueba(nombre, f) {
  try {
    f();
    pasan++;
    console.log(`  ok  ${nombre}`);
  } catch (e) {
    fallos++;
    console.log(`  MAL ${nombre}\n      ${String(e?.message || e).split('\n').join('\n      ')}`);
  }
}
async function pruebaAsync(nombre, f) {
  try {
    await f();
    pasan++;
    console.log(`  ok  ${nombre}`);
  } catch (e) {
    fallos++;
    console.log(`  MAL ${nombre}\n      ${String(e?.message || e).split('\n').join('\n      ')}`);
  }
}

const T0 = Date.parse('2026-10-05T15:00:00Z');
const iso = (t) => new Date(t).toISOString();

const opcionesBorrador = [
  { id: 'posponer', label: 'Posponer', effect: 'No envía nada.', risk: 'sin-efecto' },
  { id: 'editar', label: 'Editar', effect: 'No envía nada.', risk: 'sin-efecto' },
  { id: 'rechazar', label: 'Rechazar', effect: 'No se envía.', risk: 'sin-efecto' },
  { id: 'aprobar', label: 'Aprobar: Enviar este WhatsApp', effect: 'Lo envía una vez.', risk: 'efecto' },
];

function borrador({ id, creada = T0, canal = 'whatsapp', para = 'Ana (+50499991111)', texto = 'Llego a las 5.', asunto, estado = 'awaiting_approval', expired = false, postponed = false, postponedUntil, decisionId = `dc_${id}`, conTexto = true } = {}) {
  return {
    id,
    version: 2,
    state: estado,
    terminal: false,
    source: 'durable',
    title: `${canal === 'correo' ? 'Correo' : 'WhatsApp'} para ${para}`,
    objective: 'x',
    acceptance: [],
    environment: { kind: canal, id: 'tel', displayName: canal === 'correo' ? 'yo@ejemplo.com' : 'Tu WhatsApp' },
    progress: null,
    decisionId,
    currentStep: estado === 'blocked' ? 'La propuesta caducó sin enviarse.' : 'Esperando tu decisión',
    decision: {
      id: decisionId,
      kind: 'aprobar-accion',
      question: canal === 'correo' ? `¿Envío este correo a ${para}?` : `¿Envío este WhatsApp a ${para}?`,
      why: 'Sale a otra persona en tu nombre.',
      proposal: {
        action: canal === 'correo' ? 'Enviar este correo' : 'Enviar este WhatsApp',
        account: canal === 'correo' ? 'yo@ejemplo.com' : 'Tu WhatsApp',
        recipient: para,
        data: [asunto ? `Asunto: «${asunto}»` : '', `Texto: «${texto.slice(0, 400)}»`].filter(Boolean),
        scope: 'Solo este mensaje, una vez.',
        ...(conTexto ? { text: texto } : {}),
        ...(asunto ? { subject: asunto } : {}),
      },
      options: expired || estado === 'blocked' ? opcionesBorrador.filter((o) => o.id === 'editar' || o.id === 'rechazar') : opcionesBorrador,
      createdAt: iso(creada),
      expiresAt: iso(creada + 15 * 60_000),
      expired,
      postponed,
      ...(postponedUntil ? { postponedUntil } : {}),
    },
    result: null,
    createdAt: iso(creada),
    updatedAt: iso(creada),
    controls: { pause: false, resume: false, cancel: true },
  };
}

const taller = (id, creada = T0) => ({
  ...borrador({ id, creada }),
  environment: { kind: 'servidor', id: 'taller', displayName: 'Taller de la junta' },
  decision: {
    ...borrador({ id, creada }).decision,
    question: '¿Mandar aviso urgente a la junta?',
    proposal: { action: 'Aviso urgente', account: 'Canales de la junta', recipient: 'La junta', data: ['Contenido: «Reunión a las 4»'], scope: 'Solo esto' },
    options: [
      { id: 'posponer', label: 'Posponer', effect: 'No hace nada.', risk: 'sin-efecto' },
      { id: 'rechazar', label: 'Rechazar', effect: 'No se hace.', risk: 'sin-efecto' },
      { id: 'aprobar', label: 'Confirmar y enviar', effect: 'Lo envía.', risk: 'efecto' },
    ],
  },
});

const aMedias = (id, creada = T0) => ({
  ...borrador({ id, creada }),
  source: 'tarea-en-curso',
  environment: { kind: 'correo', id: 'tel', displayName: 'Tu correo' },
  decision: {
    ...borrador({ id, creada }).decision,
    kind: 'continuar-tarea',
    question: 'Pediste otra cosa a mitad de «revisar correos». ¿Qué hago con los correos?',
    proposal: { action: 'Decidir', data: [], scope: 'Solo esta tarea' },
    options: [
      { id: 'posponer', label: 'Dejarla para después', effect: 'Queda en pausa.', risk: 'sin-efecto' },
      { id: 'elegir:seguir', label: 'Terminarla primero', effect: 'Sigo con ella.', risk: 'sin-efecto' },
      { id: 'rechazar', label: 'Descartarla', effect: 'La cierro.', risk: 'sin-efecto' },
    ],
  },
});

const pc = { tareaId: 'tpc1', instruccion: 'Paga la luz en el banco', pregunta: '¿Confirmo el pago de L 1,250 (cuenta 0042)?', preguntaId: 'p1', propuesta: 'h1', desde: T0 + 5000 };

console.log('Ventana de decisión — qué entra y en qué orden');

prueba('entra lo que espera su decisión con una decisión de verdad; no lo pospuesto, ni lo terminado, ni lo de la computadora sin pregunta', () => {
  assert.equal(entraEnVentana(borrador({ id: 'a' }), T0), true);
  assert.equal(entraEnVentana(borrador({ id: 'b', postponed: true, postponedUntil: iso(T0 + 60_000) }), T0), false, 'pospuesta: vuelve sola a su hora');
  assert.equal(entraEnVentana(borrador({ id: 'b', postponed: true, postponedUntil: iso(T0 + 60_000) }), T0 + 61_000), true, 'cumplida la hora, vuelve');
  assert.equal(entraEnVentana(borrador({ id: 'b', postponed: true }), T0, { todas: true }), true, 'abierta desde el indicador, también lo pospuesto');
  assert.equal(entraEnVentana({ ...borrador({ id: 'c' }), terminal: true, state: 'completed' }, T0), false);
  assert.equal(entraEnVentana({ ...borrador({ id: 'd' }), decision: null, decisionId: undefined, state: 'blocked' }, T0), false, 'bloqueada sin decisión: al panel');
  assert.equal(entraEnVentana(borrador({ id: 'e', estado: 'blocked', expired: true }), T0), true, 'vencida: se pregunta si se rehace');
  assert.equal(entraEnVentana({ ...borrador({ id: 'f' }), sinConfirmar: true }, T0), false, 'sin confirmar: no se pregunta lo que no se pudo leer');
});

prueba('en orden: lo más viejo primero; lo que acaba de preguntar el turno, antes que todo; «1 de 3»', () => {
  const tareas = [borrador({ id: 'nueva', creada: T0 + 3000 }), borrador({ id: 'vieja', creada: T0 }), borrador({ id: 'media', creada: T0 + 1000 })];
  assert.deepEqual(colaVentana({ tareas, ahora: T0 + 4000 }).map((x) => x.id), ['vieja', 'media', 'nueva']);
  assert.deepEqual(colaVentana({ tareas, ahora: T0 + 4000, primero: ['nueva'] }).map((x) => x.id), ['nueva', 'vieja', 'media']);
  assert.equal(textoPosicion(0, 3), '1 de 3');
  assert.equal(textoPosicion(0, 1), '', 'una sola: sin contador');
  assert.equal(textoPosicion(1, 2, 'en'), '2 of 2');
});

prueba('la pregunta de su computadora entra en la fila con las demás', () => {
  const cola = colaVentana({ tareas: [borrador({ id: 'a', creada: T0 })], pc, ahora: T0 + 6000 });
  assert.deepEqual(cola.map((x) => x.tipo), ['tarea', 'computadora']);
});

prueba('lo dejado para luego en el teléfono no entra hasta su hora', () => {
  const t = borrador({ id: 'a' });
  const cola = colaVentana({ tareas: [t], ahora: T0, luego: { 'a:dc_a': T0 + LUEGO_MS } });
  assert.equal(cola.length, 0);
  assert.equal(colaVentana({ tareas: [t], ahora: T0 + LUEGO_MS + 1, luego: { 'a:dc_a': T0 + LUEGO_MS } }).length, 1);
  assert.equal(colaVentana({ tareas: [t], ahora: T0, luego: { 'a:dc_a': T0 + LUEGO_MS }, todas: true }).length, 1, 'desde el indicador, sí');
});

prueba('cuál se ve: no salta mientras siga esperando (una versión nueva de la misma tarea, en su lugar); resuelta, la siguiente', () => {
  const a = borrador({ id: 'a', creada: T0 });
  const b = borrador({ id: 'b', creada: T0 + 1000 });
  let cola = colaVentana({ tareas: [a, b], ahora: T0 + 2000 });
  assert.equal(elegirActual(cola, {}).id, 'a');
  // Se estaba viendo b (la abrió el turno): una tarea más vieja no la tapa.
  assert.equal(elegirActual(cola, { actual: 'b' }).id, 'b');
  // b cambió de decisión (editó el texto): sigue siendo b.
  cola = colaVentana({ tareas: [a, { ...b, decisionId: 'dc_b2', decision: { ...b.decision, id: 'dc_b2' } }], ahora: T0 + 3000 });
  assert.equal(elegirActual(cola, { actual: 'b' }).clave, 'b:dc_b2');
  // b se resolvió: aparece la siguiente.
  cola = colaVentana({ tareas: [a], ahora: T0 + 4000 });
  assert.equal(elegirActual(cola, { actual: 'b' }).id, 'a');
  // Lo que acaba de preguntar el turno toma el lugar.
  cola = colaVentana({ tareas: [a, b], ahora: T0 + 5000 });
  assert.equal(elegirActual(cola, { actual: 'a', nuevo: 'b' }).id, 'b');
  assert.equal(elegirActual([], { actual: 'a' }), null, 'nada que decidir: no hay ventana');
});

prueba('en una conversación de voz, lo que AU-RA acaba de preguntar (apareció después de lo que se ve) toma el lugar, una vez', () => {
  const a = borrador({ id: 'a', creada: T0 });
  const b = borrador({ id: 'b', creada: T0 + 1000 });
  const c = borrador({ id: 'c', creada: T0 + 60_000 });
  const visto = { id: 'a', t: T0 + 30_000 };
  const cola = colaVentana({ tareas: [a, b, c], ahora: T0 + 61_000 });
  assert.equal(nuevoPorVoz(cola, { conversando: true, visto, tomados: new Set() })?.id, 'c', 'c llegó después de empezar a ver a: es lo que se acaba de preguntar');
  assert.equal(nuevoPorVoz(cola, { conversando: false, visto, tomados: new Set() }), undefined, 'fuera de la voz, el orden de siempre');
  assert.equal(nuevoPorVoz(cola, { conversando: true, visto, tomados: new Set(['voz:c:dc_c']) }), undefined, 'una vez');
  const sinNuevo = colaVentana({ tareas: [a, b], ahora: T0 + 61_000 });
  assert.equal(nuevoPorVoz(sinNuevo, { conversando: true, visto, tomados: new Set() }), undefined, 'b ya estaba antes: no salta');
});

prueba('no se le echa encima: cerrada con «Luego», solo se abre para algo NUEVO o lo que acaba de preguntar el turno', () => {
  const [item] = colaVentana({ tareas: [borrador({ id: 'a', creada: T0 })], ahora: T0 + 1000 });
  const cerrada = { en: T0 + 1000, hasta: T0 + 1000 + LUEGO_MS };
  assert.equal(seAbreSola(item, { ahora: T0 + 2000, cerrada }), false);
  assert.equal(seAbreSola(item, { ahora: T0 + 2000, cerrada, delTurno: true }), true);
  assert.equal(seAbreSola(item, { ahora: T0 + 2000, cerrada, forzada: true }), true, 'tocó el indicador');
  assert.equal(seAbreSola(item, { ahora: cerrada.hasta + 1, cerrada }), true, 'pasado el rato, vuelve');
  const [nuevo] = colaVentana({ tareas: [borrador({ id: 'b', creada: T0 + 5000 })], ahora: T0 + 6000 });
  assert.equal(seAbreSola(nuevo, { ahora: T0 + 6000, cerrada }), true, 'una pregunta nueva sí aparece');
  assert.equal(seAbreSola(null, { ahora: T0 }), false);
});

console.log('Ventana de decisión — lo que se ve y los botones');

prueba('un WhatsApp: a quién (nombre y número, como lo da el servidor), el texto exacto y Sí · No · Editar', () => {
  const [item] = colaVentana({ tareas: [borrador({ id: 'a', texto: 'Llego a las 5.\nTraigo el pastel.' })], ahora: T0 });
  const d = datosVentana(item);
  assert.equal(d.etiqueta, 'WhatsApp');
  assert.equal(d.para, 'Ana (+50499991111)');
  assert.equal(d.texto, 'Llego a las 5.\nTraigo el pastel.', 'el texto entero, tal cual');
  assert.equal(d.editable, true);
  const b = botonesVentana(item);
  assert.deepEqual(b.map((x) => [x.tipo, x.etiqueta]), [['si', 'Sí'], ['no', 'No'], ['editar', 'Editar']]);
  assert.equal(b[0].opcion, 'aprobar');
  assert.equal(b[0].conEfecto, true);
  assert.equal(b[1].opcion, 'rechazar');
  assert.equal(tieneLuego(item), true);
  assert.equal(luegoEnServidor(item), true, '«Luego» pospone en el servidor (vuelve sola)');
});

prueba('«Sí» (con efecto) nunca va armado de entrada ni con Enter', () => {
  const si = { conEfecto: true };
  assert.equal(puedeActivar(si, { aparecio: T0, ahora: T0 + 200, via: 'toque' }), false);
  assert.equal(puedeActivar(si, { aparecio: T0, ahora: T0 + 2000, via: 'enter' }), false);
  assert.equal(puedeActivar(si, { aparecio: T0, ahora: T0 + 2000, via: 'toque' }), true);
  assert.equal(puedeActivar({ conEfecto: false }, { aparecio: T0, ahora: T0, via: 'toque' }), true, '«No» siempre');
});

prueba('un correo: asunto y texto; sin el texto entero del servidor, se ve el de la tarjeta pero no se edita aquí', () => {
  const [item] = colaVentana({ tareas: [borrador({ id: 'c', canal: 'correo', para: 'ana@ejemplo.com', asunto: 'Fechas', texto: 'Hola Ana' })], ahora: T0 });
  const d = datosVentana(item);
  assert.equal(d.etiqueta, 'Correo');
  assert.equal(d.asunto, 'Fechas');
  assert.equal(d.desde, 'yo@ejemplo.com');
  const [viejo] = colaVentana({ tareas: [borrador({ id: 'v', texto: 'Hola', conTexto: false })], ahora: T0 });
  assert.equal(datosVentana(viejo).texto, 'Hola', 'servidor de antes: el texto de la tarjeta');
  assert.equal(datosVentana(viejo).editable, false, 'pero no se edita (podría estar recortado)');
  assert.ok(!botonesVentana(viejo).some((b) => b.tipo === 'editar'));
  const largo = 'x'.repeat(MAX_EDITAR + 10);
  const [l] = colaVentana({ tareas: [borrador({ id: 'l', texto: largo })], ahora: T0 });
  assert.equal(datosVentana(l).editable, false, 'demasiado largo para editarlo aquí');
});

prueba('lo que no se edita (el taller): solo Sí · No; la computadora: Sí · No; la tarea a medias: sus tres respuestas', () => {
  const [t] = colaVentana({ tareas: [taller('t')], ahora: T0 });
  assert.deepEqual(botonesVentana(t).map((x) => x.tipo), ['si', 'no']);
  assert.equal(datosVentana(t).texto, 'Reunión a las 4', 'el contenido exacto');
  const [p] = colaVentana({ tareas: [], pc, ahora: T0 + 6000 });
  assert.deepEqual(botonesVentana(p).map((x) => x.tipo), ['si', 'no']);
  assert.equal(botonesVentana(p)[0].conEfecto, true);
  assert.equal(datosVentana(p).editable, false);
  const [m] = colaVentana({ tareas: [aMedias('m')], ahora: T0 });
  assert.deepEqual(botonesVentana(m).map((x) => x.etiqueta), ['Dejarla para después', 'Terminarla primero', 'Descartarla']);
  assert.equal(tieneLuego(m), false, 'ya trae su «para después»');
});

prueba('vencida: «venció sin enviarse. ¿Lo rehago?» con Rehacer · Descartar (nada con efecto)', () => {
  const [v] = colaVentana({ tareas: [borrador({ id: 'v', estado: 'blocked', expired: true })], ahora: T0 });
  const d = datosVentana(v);
  assert.match(d.pregunta, /El WhatsApp para Ana venció sin enviarse\. ¿Lo rehago\?/);
  assert.equal(d.vencida, true);
  assert.deepEqual(botonesVentana(v).map((x) => [x.tipo, x.etiqueta]), [['rehacer', 'Rehacer'], ['no', 'Descartar']]);
  assert.ok(botonesVentana(v).every((b) => !b.conEfecto));
  assert.equal(luegoEnServidor(v), false, 'una vencida no se pospone en el servidor (solo en el teléfono)');
  assert.match(pedidoRehacer(v), /^Rehaz el WhatsApp para Ana \(\+50499991111\): «Llego a las 5\.»$/);
});

console.log('Ventana de decisión — la voz');

prueba('dice la pregunta corta (sin el número entre paréntesis), una sola vez y solo cuando toca', () => {
  const [item] = colaVentana({ tareas: [borrador({ id: 'a' })], ahora: T0 });
  assert.equal(fraseVentana(item), '¿Envío este WhatsApp a Ana?');
  const base = { clave: item.clave, dichas: new Set(), conversando: false, hablando: false, visible: true, delTurno: false };
  assert.equal(debeHablar(base), true);
  assert.equal(debeHablar({ ...base, dichas: new Set([item.clave]) }), false, 'una vez');
  assert.equal(debeHablar({ ...base, conversando: true }), false, 'en una conversación de voz pregunta el agente');
  assert.equal(debeHablar({ ...base, hablando: true }), false, 'no se encima a lo que ya dice');
  assert.equal(debeHablar({ ...base, delTurno: true }), false, 'lo que el turno acaba de leer no se repite');
  assert.equal(debeHablar({ ...base, visible: false }), false);
  const [p] = colaVentana({ tareas: [], pc, ahora: T0 + 6000 });
  assert.match(fraseVentana(p), /^Tu computadora pregunta: ¿Confirmo el pago de L 1,250\?$/);
});

console.log('Ventana de decisión — editar');

prueba('editar: el texto entero; no se guarda vacío ni sin cambios; el correo lleva su asunto; no se guarda sobre otra decisión', () => {
  const [item] = colaVentana({ tareas: [borrador({ id: 'a', texto: 'Llego a las 5.' })], ahora: T0 });
  const e = empezarEdicion(item);
  assert.equal(e.texto, 'Llego a las 5.');
  assert.equal(puedeGuardar(e), false, 'sin cambios: no hay nada que guardar');
  assert.equal(puedeGuardar({ ...e, texto: '   ' }), false, 'vacío no');
  assert.equal(puedeGuardar({ ...e, texto: 'x'.repeat(MAX_EDITAR + 1) }), false, 'larguísimo no');
  const cambiado = { ...e, texto: '  Llego a las 6.  ' };
  assert.equal(puedeGuardar(cambiado), true);
  assert.deepEqual(cuerpoEdicion(cambiado), { texto: 'Llego a las 6.' });
  assert.equal(edicionVigente(cambiado, item), true);
  const [otra] = colaVentana({ tareas: [{ ...borrador({ id: 'a' }), decisionId: 'dc_a2', decision: { ...borrador({ id: 'a' }).decision, id: 'dc_a2' } }], ahora: T0 });
  assert.equal(edicionVigente(cambiado, otra), false, 'la decisión cambió mientras escribía: no se guarda a ciegas');
  const [c] = colaVentana({ tareas: [borrador({ id: 'c', canal: 'correo', para: 'ana@ejemplo.com', asunto: 'Fechas', texto: 'Hola' })], ahora: T0 });
  const ec = empezarEdicion(c);
  assert.equal(ec.asunto, 'Fechas');
  assert.equal(puedeGuardar({ ...ec, asunto: 'Fechas nuevas' }), true, 'cambiar solo el asunto también cuenta');
  assert.deepEqual(cuerpoEdicion({ ...ec, asunto: 'Fechas nuevas' }), { texto: 'Hola', asunto: 'Fechas nuevas' });
  const [t] = colaVentana({ tareas: [taller('t')], ahora: T0 });
  assert.equal(empezarEdicion(t), null, 'lo que no se edita, no se edita');
});

prueba('revisión (MENOR a): mientras edita, el servidor no tiene nada «a la vista» (un «sí» dicho no manda el texto viejo)', () => {
  const [item] = colaVentana({ tareas: [borrador({ id: 'a' })], ahora: T0 });
  assert.equal(tareaEnPantalla(item, null)?.id, 'a', 'viéndola: se registra');
  const e = empezarEdicion(item);
  assert.equal(tareaEnPantalla(item, e), null, 'editando: se suelta');
  assert.equal(tareaEnPantalla(item, { ...e, clave: 'otra:dc' })?.id, 'a', 'una edición de otra decisión no cuenta');
  const [p] = colaVentana({ tareas: [], pc, ahora: T0 + 6000 });
  assert.equal(tareaEnPantalla(p, null), null, 'la pregunta de su computadora no va por aquí');
});

console.log('Indicador y cliente');

prueba('«Luego» no la esconde para siempre: el indicador dice «Para después · 1» mientras quede algo pospuesto', () => {
  const xs = [borrador({ id: 'a', postponed: true })];
  const n = pospuestas(xs, T0);
  assert.equal(n, 1);
  assert.equal(textoIndicador({ trabajando: 0, decisiones: 0, esperan: 0, pospuestas: n }), 'Para después · 1');
  assert.equal(textoIndicador({ trabajando: 0, decisiones: 1, pospuestas: n }), 'Necesito una decisión · 1', 'lo que espera ahora va primero');
  assert.equal(textoIndicador({ trabajando: 0, decisiones: 0 }), null);
  assert.equal(Date.parse(hastaLuego(T0)), T0 + LUEGO_MS);
});

await pruebaAsync('cliente: editar y en-pantalla van atados a la decisión y la versión vistas; un 409 trae la tarea de ahora', async () => {
  const pedidos = [];
  const cliente = crearClienteTrabajos(async (ruta, init) => {
    pedidos.push({ ruta, cuerpo: init?.body ? JSON.parse(init.body) : null });
    if (ruta.includes('/editar')) return { status: 409, json: { codigo: 'decision-vieja', tarea: { id: 'a', version: 3 } } };
    return { status: 200, json: { registrada: true } };
  });
  const t = borrador({ id: 'a' });
  const r = await cliente.editar(t, { texto: 'Llego a las 6.' });
  assert.equal(r.ok, false);
  assert.equal(r.codigo, 'decision-vieja');
  assert.equal(r.tarea.version, 3, 'vuelve la de ahora para mostrarla');
  assert.match(r.mensaje, /No ejecuté nada/);
  assert.deepEqual(pedidos[0].cuerpo, { decisionId: 'dc_a', expectedVersion: 2, texto: 'Llego a las 6.' });
  assert.match(pedidos[0].ruta, /^\/api\/trabajos\/a\/editar\?estados=respondida$/);
  await cliente.enPantalla(t, true);
  await cliente.enPantalla(t, false);
  const { seq: s1, ...c1 } = pedidos[1].cuerpo;
  const { seq: s2, ...c2 } = pedidos[2].cuerpo;
  assert.deepEqual(c1, { decisionId: 'dc_a', visible: true });
  assert.deepEqual(c2, { decisionId: 'dc_a', visible: false }, 'soltar dice CUÁL decisión (no suelta la versión nueva)');
  assert.ok(Number.isFinite(s1) && Number.isFinite(s2), 'cada aviso lleva su número de orden');
});

await pruebaAsync('cliente (revisión 7.5, MENOR 2): oculta → visible seguidas llevan números crecientes (el servidor ignora la vieja si llega después)', async () => {
  const cuerpos = [];
  const cliente = crearClienteTrabajos(async (_ruta, init) => {
    cuerpos.push(JSON.parse(init.body));
    return { status: 200, json: { registrada: true } };
  });
  const t = borrador({ id: 'a' });
  // Sin esperar: como el efecto de la ventana al cancelar la edición (dos peticiones a la vez, el mismo milisegundo).
  await Promise.all([cliente.enPantalla(t, false), cliente.enPantalla(t, true), cliente.enPantalla(t, true, { renovar: true })]);
  const seqs = cuerpos.map((c) => c.seq);
  assert.ok(seqs[0] < seqs[1] && seqs[1] < seqs[2], `crecientes: ${seqs.join(', ')}`);
  // Basados en el reloj: tras recargar la app (un cliente nuevo) siguen creciendo.
  const otro = crearClienteTrabajos(async (_ruta, init) => (cuerpos.push(JSON.parse(init.body)), { status: 200, json: {} }));
  await otro.enPantalla(t, true);
  assert.ok(cuerpos[3].seq >= Date.now() - 1000, 'un cliente nuevo no empieza de cero');
});

console.log(`\n${pasan} pasan, ${fallos} fallan`);
if (fallos) process.exit(1);
