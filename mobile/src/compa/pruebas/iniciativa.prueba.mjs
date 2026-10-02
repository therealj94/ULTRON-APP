/**
 * Pruebas en Node de lo que AURA propone sola y de lo que lleva de la persona (sin teléfono):
 *   la propuesta empujada o leída del servidor (validar y normalizar), la cola que no duplica ni repite
 *   lo contestado, qué se manda con cada botón, el sondeo, el puente de acciones que la deja pasar, y las
 *   cuentas de las hojas de misiones, lo que sabe de ti y tu círculo (compa/cerebro.ts).
 *
 *   cd mobile && npx tsx src/compa/pruebas/iniciativa.prueba.mjs
 */
import assert from 'node:assert/strict';
import {
  CADUCA_MS,
  ColaPropuestas,
  SONDEO_INICIATIVA_MS,
  cuerpoRespuesta,
  esAccionIniciativa,
  etiquetaClase,
  pedidoAMandar,
  propuestaDeAccion,
  propuestaDeServidor,
  textoBoton,
  tocaSondear,
} from '../iniciativa.ts';
import {
  PANTALLAS_CEREBRO,
  abiertosDe,
  avanceMision,
  borradorDe,
  circuloDe,
  conPasoHecho,
  conocerDe,
  cuerpoCerrarMision,
  cuerpoNuevaMision,
  cuerpoPasoHecho,
  cuerpoPermiso,
  cuerpoPersona,
  esPantallaCerebro,
  etiquetaAbierto,
  fechaMision,
  misionesDe,
  nombreRelacion,
  numeroLegible,
  ordenarAbiertos,
  origenDato,
  sinDato,
  venceEnPalabras,
} from '../cerebro.ts';
import { esAccionApp, accionesDelTurno } from '../acciones.ts';

let fallos = 0;
let n = 0;
const pruebas = [];
const prueba = (nombre, f) => pruebas.push([nombre, f]);

const AHORA = Date.parse('2026-10-02T15:00:00-06:00');
const accion = (o = {}) => ({ tipo: 'iniciativa', id: 'p_1a2b3c4d5e6f', texto: '¿Te busco las tres mejores opciones de seguro para el carro?', pedido: 'Sí, búscame las tres mejores opciones de seguro para el carro.', clase: 'ayuda', prioridad: 1, creada: AHORA - 60_000, ...o });

/* ── la propuesta: validar y normalizar ──────────────────────────────────────────────────────── */

prueba('acción iniciativa: la bien formada pasa; lo malo se descarta', () => {
  assert.equal(esAccionIniciativa(accion()), true);
  assert.equal(esAccionIniciativa(accion({ misionId: 'm_abc123def456' })), true);
  assert.equal(esAccionIniciativa(accion({ id: 'x_1' })), false, 'id con otra forma');
  assert.equal(esAccionIniciativa(accion({ id: 'p_ZZZ' })), false, 'id que no es hex');
  assert.equal(esAccionIniciativa(accion({ texto: '   ' })), false, 'texto vacío');
  assert.equal(esAccionIniciativa(accion({ pedido: '' })), false, 'sin pedido');
  assert.equal(esAccionIniciativa(accion({ texto: 'x'.repeat(401) })), false, 'texto larguísimo');
  assert.equal(esAccionIniciativa(accion({ prioridad: 'alta' })), false);
  assert.equal(esAccionIniciativa({ ...accion(), tipo: 'computadora' }), false);
  assert.equal(esAccionIniciativa(null), false);
});

prueba('acción iniciativa: el puente de acciones la deja pasar (antes la tiraba como «una acción que no conozco»)', () => {
  assert.equal(esAccionApp(accion()), true);
  assert.equal(esAccionApp(accion({ id: 'nada' })), false);
  // También en el done del turno.
  const l = accionesDelTurno({ acciones: [{ id: 'a-ini-1', accion: accion({ id: 'p_aaaaaa111111' }) }] }, AHORA);
  assert.equal(l.length, 1);
  assert.equal(l[0].tipo, 'iniciativa');
});

prueba('abrir: misiones, conocer y círculo son pantallas que «abrir» entiende', () => {
  for (const p of PANTALLAS_CEREBRO) {
    assert.equal(esPantallaCerebro(p), true);
    assert.equal(esAccionApp({ tipo: 'abrir', pantalla: p }), true, p);
  }
  assert.equal(esPantallaCerebro('cocina'), false);
  assert.equal(esAccionApp({ tipo: 'abrir', pantalla: 'cocina' }), false);
});

prueba('propuesta: de la acción (clase) y del GET (tipo) sale lo mismo', () => {
  const a = propuestaDeAccion(accion({ clase: 'mision', misionId: 'm_1' }));
  const g = propuestaDeServidor({ propuesta: { id: 'p_1a2b3c4d5e6f', texto: accion().texto, tipo: 'mision', pedido: accion().pedido, prioridad: 1, creada: AHORA - 60_000, misionId: 'm_1' }, motivo: 'nueva', iniciativa: 'media' });
  assert.deepEqual(a, g);
  assert.equal(a.clase, 'mision');
  assert.equal(a.misionId, 'm_1');
  assert.equal(propuestaDeServidor({ propuesta: null, motivo: 'horas_quietas' }), null);
  assert.equal(propuestaDeServidor({ propuesta: { id: 'p_1a2b3c4d5e6f', texto: 'hola' } }), null, 'sin pedido no es propuesta');
  assert.equal(propuestaDeServidor(null), null);
  // Espacios de más se limpian; sin clase, «ayuda».
  const b = propuestaDeAccion({ ...accion(), texto: '  ¿Te   ayudo  ?  ', clase: undefined });
  assert.equal(b.texto, '¿Te ayudo ?');
  assert.equal(b.clase, 'ayuda');
});

/* ── la cola: sin duplicados ni repetidas ────────────────────────────────────────────────────── */

prueba('cola: la misma propuesta por los dos caminos (empujada y GET) sale UNA vez', () => {
  const c = new ColaPropuestas(() => AHORA);
  let avisos = 0;
  c.suscribir(() => avisos++);
  assert.equal(c.ofrecer(propuestaDeAccion(accion())), 'nueva');
  const primera = c.ahora();
  assert.equal(c.ofrecer(propuestaDeServidor({ propuesta: { ...accion(), tipo: 'ayuda' } })), 'repetida');
  assert.equal(c.ahora(), primera, 'la misma referencia: la tarjeta no se vuelve a animar');
  assert.equal(avisos, 1);
});

prueba('cola: lo contestado no vuelve aunque el servidor lo empuje otra vez o el GET llegue tarde', () => {
  const c = new ColaPropuestas(() => AHORA);
  c.ofrecer(propuestaDeAccion(accion()));
  const p = c.responder('p_1a2b3c4d5e6f');
  assert.equal(p?.id, 'p_1a2b3c4d5e6f');
  assert.equal(c.ahora(), null);
  assert.equal(c.ofrecer(propuestaDeAccion(accion())), 'contestada');
  assert.equal(c.ahora(), null);
  // Un segundo toque (doble tap) no hace nada.
  assert.equal(c.responder('p_1a2b3c4d5e6f'), null);
  // Descartada sin contestar: tampoco vuelve.
  c.ofrecer(propuestaDeAccion(accion({ id: 'p_bbbbbb222222' })));
  c.descartar('p_bbbbbb222222');
  assert.equal(c.ahora(), null);
  assert.equal(c.ofrecer(propuestaDeAccion(accion({ id: 'p_bbbbbb222222' }))), 'contestada');
});

prueba('cola: una más nueva reemplaza a la de antes; una más vieja no; una caducada no sale', () => {
  let t = AHORA;
  const c = new ColaPropuestas(() => t);
  c.ofrecer(propuestaDeAccion(accion({ id: 'p_aaaaaa111111', creada: AHORA - 1000 })));
  assert.equal(c.ofrecer(propuestaDeAccion(accion({ id: 'p_cccccc333333', creada: AHORA - 5000 }))), 'vieja');
  assert.equal(c.ahora().id, 'p_aaaaaa111111');
  assert.equal(c.ofrecer(propuestaDeAccion(accion({ id: 'p_dddddd444444', creada: AHORA }))), 'nueva');
  assert.equal(c.ahora().id, 'p_dddddd444444');
  assert.equal(c.ofrecer(propuestaDeAccion(accion({ id: 'p_eeeeee555555', creada: AHORA - CADUCA_MS - 1 }))), 'caducada');
  // La app quedó abierta 9 h: la de la vista caduca y se quita.
  t = AHORA + CADUCA_MS + 1;
  assert.equal(c.limpiarCaducada(), true);
  assert.equal(c.ahora(), null);
});

prueba('cola: otra persona en el teléfono empieza de cero; la misma no', () => {
  const c = new ColaPropuestas(() => AHORA);
  c.paraPersona('Jose@Ejemplo.com');
  c.ofrecer(propuestaDeAccion(accion()));
  c.ultimoSondeo = AHORA;
  c.paraPersona('jose@ejemplo.com');
  assert.ok(c.ahora(), 'la misma persona (otro formato del correo): sigue');
  c.paraPersona('ana@ejemplo.com');
  assert.equal(c.ahora(), null);
  assert.equal(c.ultimoSondeo, 0);
  assert.equal(c.yaContestada('p_1a2b3c4d5e6f'), false);
});

/* ── los botones y el sondeo ─────────────────────────────────────────────────────────────────── */

prueba('botones: cada uno se manda tal cual al servidor', () => {
  assert.deepEqual(cuerpoRespuesta('p_1a2b3c4d5e6f', 'si'), { id: 'p_1a2b3c4d5e6f', respuesta: 'si' });
  assert.deepEqual(cuerpoRespuesta('p_1a2b3c4d5e6f', 'luego'), { id: 'p_1a2b3c4d5e6f', respuesta: 'luego' });
  assert.deepEqual(cuerpoRespuesta('p_1a2b3c4d5e6f', 'no'), { id: 'p_1a2b3c4d5e6f', respuesta: 'no' });
  assert.equal(textoBoton('si'), 'Sí, hazlo');
  assert.equal(textoBoton('luego'), 'Luego');
  assert.equal(textoBoton('no'), 'No');
  assert.equal(textoBoton('si', 'en'), 'Yes, do it');
});

prueba('botones: solo «Sí» manda un turno; con 404 no; sin red sí (la persona dijo que sí)', () => {
  const p = { pedido: 'Sí, búscame las opciones.' };
  assert.equal(pedidoAMandar('si', p, { ok: true, pedido: 'Sí, búscame las tres mejores.' }), 'Sí, búscame las tres mejores.', 'el del servidor manda');
  assert.equal(pedidoAMandar('si', p, { ok: true, pedido: null }), 'Sí, búscame las opciones.', 'sin el del servidor, el de la propuesta');
  assert.equal(pedidoAMandar('si', p, { ok: false, status: 404 }), null, 'ya no estaba pendiente');
  assert.equal(pedidoAMandar('si', p, { ok: false, status: 503 }), 'Sí, búscame las opciones.');
  assert.equal(pedidoAMandar('si', p, { ok: false }), 'Sí, búscame las opciones.', 'sin red');
  for (const r of ['luego', 'no']) {
    assert.equal(pedidoAMandar(r, p, { ok: true, pedido: null }), null, r);
    assert.equal(pedidoAMandar(r, p, { ok: false }), null, r);
  }
});

prueba('sondeo: la primera vez sí; antes de 20 min no; después sí', () => {
  assert.equal(SONDEO_INICIATIVA_MS, 20 * 60_000);
  assert.equal(tocaSondear(0, AHORA), true);
  assert.equal(tocaSondear(AHORA, AHORA + 19 * 60_000), false);
  assert.equal(tocaSondear(AHORA, AHORA + 20 * 60_000), true);
});

prueba('etiqueta de la tarjeta por clase', () => {
  assert.equal(etiquetaClase('mision'), 'Para tu misión');
  assert.equal(etiquetaClase('conocer'), 'Para conocerte');
  assert.equal(etiquetaClase('lo-que-sea'), 'Una idea');
  assert.equal(etiquetaClase('dia', 'en'), 'Your day');
});

/* ── misiones ────────────────────────────────────────────────────────────────────────────────── */

const MISION = { id: 'm_abc', numero: 1, titulo: 'Vender el carro', objetivo: 'Juntar para la camioneta', pasos: [{ texto: 'Tomar fotos', hecho: true, t: 1 }, { texto: 'Poner precio', hecho: false, t: 0 }, { texto: 'Publicarlo', hecho: false, t: 0 }], proximoPaso: 'Poner precio', estado: 'activa', notas: [], creada: 0, actualizada: 0 };

prueba('misiones: la lista del GET se sanea; el avance se cuenta', () => {
  const l = misionesDe({ misiones: [MISION, { id: 'roto' }, null, { ...MISION, id: 'm_2', pasos: 'nada' }] });
  assert.equal(l.length, 2);
  assert.deepEqual(l[1].pasos, []);
  assert.deepEqual(misionesDe({}), []);
  const a = avanceMision(MISION);
  assert.equal(a.texto, '1 de 3 pasos');
  assert.equal(Math.round(a.fraccion * 100), 33);
  assert.equal(avanceMision({ pasos: [] }).texto, 'Sin pasos todavía');
});

prueba('misiones: marcar un paso manda su número (1…) y lo hecho no se vuelve a mandar', () => {
  assert.deepEqual(cuerpoPasoHecho(MISION, 1), { accion: 'avanzar', id: 'm_abc', pasoHecho: 2 });
  assert.equal(cuerpoPasoHecho(MISION, 0), null, 'ya estaba hecho');
  assert.equal(cuerpoPasoHecho(MISION, 9), null);
  const m = conPasoHecho(MISION, 1, 5);
  assert.equal(m.pasos[1].hecho, true);
  assert.equal(m.proximoPaso, 'Publicarlo');
  assert.equal(MISION.pasos[1].hecho, false, 'no toca la original');
});

prueba('misiones: cerrar como cumplida o descartarla', () => {
  assert.deepEqual(cuerpoCerrarMision('m_abc', 'hecha'), { accion: 'cerrar', id: 'm_abc' });
  assert.deepEqual(cuerpoCerrarMision('m_abc', 'descartada'), { accion: 'cerrar', id: 'm_abc', estado: 'descartada' });
});

prueba('misiones: crear a mano (título, objetivo, pasos por renglón, fecha)', () => {
  const r = cuerpoNuevaMision({ titulo: '  Vender   el carro ', objetivo: 'Para la camioneta', pasos: '1. Tomar fotos\n- Poner precio\n\n Publicarlo ; Mostrarlo', vence: '14/10' }, AHORA);
  assert.equal(r.ok, true);
  assert.deepEqual(r.cuerpo, {
    accion: 'crear',
    titulo: 'Vender el carro',
    objetivo: 'Para la camioneta',
    pasos: ['Tomar fotos', 'Poner precio', 'Publicarlo', 'Mostrarlo'],
    vence: Date.parse('2026-10-14T12:00:00-06:00'),
  });
  // Y se lee de vuelta como ese día (no el anterior).
  assert.equal(venceEnPalabras(r.cuerpo.vence, AHORA).texto, 'vence el 14 oct');
  const sinNada = cuerpoNuevaMision({ titulo: 'Leer', objetivo: '', pasos: '', vence: '' }, AHORA);
  assert.deepEqual(sinNada.cuerpo, { accion: 'crear', titulo: 'Leer' });
  assert.equal(cuerpoNuevaMision({ titulo: 'ab', objetivo: '', pasos: '', vence: '' }, AHORA).ok, false);
  const malaFecha = cuerpoNuevaMision({ titulo: 'Vender', objetivo: '', pasos: '', vence: '31/02' }, AHORA);
  assert.equal(malaFecha.ok, false);
  assert.match(malaFecha.error, /fecha/);
});

prueba('misiones: las fechas que se escriben', () => {
  assert.equal(fechaMision('', AHORA), '');
  assert.equal(fechaMision('2026-12-01', AHORA), '2026-12-01');
  assert.equal(fechaMision('1/12/2026', AHORA), '2026-12-01');
  assert.equal(fechaMision('14-10', AHORA), '2026-10-14');
  assert.equal(fechaMision('01/09', AHORA), '2027-09-01', 'ya pasó este año: el que viene');
  assert.equal(fechaMision('2/10', AHORA), '2026-10-02', 'hoy todavía cuenta');
  assert.equal(fechaMision('mañana', AHORA), null);
  assert.equal(fechaMision('2026-02-30', AHORA), null);
});

prueba('misiones: para cuándo, en palabras (por día de Honduras)', () => {
  const dia = 86_400_000;
  assert.equal(venceEnPalabras(undefined, AHORA), null);
  assert.deepEqual(venceEnPalabras(AHORA + 2 * 3_600_000, AHORA), { texto: 'vence hoy', tarde: false, pronto: true });
  assert.equal(venceEnPalabras(AHORA + dia, AHORA).texto, 'vence mañana');
  assert.equal(venceEnPalabras(AHORA + 3 * dia, AHORA).texto, 'vence en 3 días');
  assert.equal(venceEnPalabras(AHORA - dia, AHORA).texto, 'venció ayer');
  const tarde = venceEnPalabras(AHORA - 3 * dia, AHORA);
  assert.equal(tarde.texto, 'se pasó hace 3 días');
  assert.equal(tarde.tarde, true);
  assert.equal(venceEnPalabras(Date.parse('2026-10-20T12:00:00-06:00'), AHORA).texto, 'vence el 20 oct');
  assert.equal(venceEnPalabras(Date.parse('2026-10-20T12:00:00-06:00'), AHORA, 'en').texto, 'due Oct 20');
  // La que AURA guardó como «2026-10-20» (medianoche UTC = 19 oct a las 6 p. m. aquí) es del 20.
  assert.equal(venceEnPalabras(Date.parse('2026-10-20'), AHORA).texto, 'vence el 20 oct');
  assert.equal(venceEnPalabras(Date.parse('2026-10-03'), AHORA).texto, 'vence mañana');
});

prueba('contrato con el servidor: lo que manda la app lo acepta lib/misiones.ts y lib/perfil-persona.ts', async () => {
  // Con import dinámico: el typecheck de la app no debe seguir hasta el código del servidor (como compa.prueba.mjs).
  const { validarNuevaMision } = await import(new URL('../../../../lib/misiones.ts', import.meta.url).href);
  const { validarCambios } = await import(new URL('../../../../lib/perfil-persona.ts', import.meta.url).href);
  const r = cuerpoNuevaMision({ titulo: 'Vender el carro', objetivo: 'Para la camioneta', pasos: 'Tomar fotos\nPoner precio', vence: '2026-10-14' }, AHORA);
  const v = validarNuevaMision(r.cuerpo);
  assert.equal(v.ok, true);
  assert.deepEqual(v.datos.pasos, ['Tomar fotos', 'Poner precio']);
  assert.equal(v.datos.vence, Date.parse('2026-10-14T12:00:00-06:00'));
  for (const nivel of ['alta', 'media', 'baja', 'apagada']) assert.equal(validarCambios({ iniciativa: nivel }).ok, true, nivel);
  assert.equal(validarCambios({ iniciativa: 'muchísima' }).ok, false);
});

/* ── lo que sabe de ti y lo que quedó a medias ───────────────────────────────────────────────── */

const CONOCER = {
  categorias: [
    { id: 'familia', nombre: 'Familia', datos: [{ id: 'd1', categoria: 'familia', dato: 'Su esposa se llama Ana', confianza: 0.9, fuente: 'modelo', desde: 0, visto: 0, veces: 1 }] },
    { id: 'trabajo', nombre: 'Trabajo y empresas', datos: [{ id: 'd2', categoria: 'trabajo', dato: 'Trabaja en minería', confianza: 0.5, fuente: 'reglas', desde: 0, visto: 0, veces: 1 }, { roto: true }] },
    { id: 'salud', nombre: 'Salud', datos: [] },
  ],
  total: 2,
  faltan: [{ clave: 'cumpleanos', pregunta: '¿Cuándo es tu cumpleaños?' }, { clave: 'x' }],
};

prueba('conocer: se sanea, borrar quita el dato y baja el total', () => {
  const c = conocerDe(CONOCER);
  assert.equal(c.categorias.length, 3);
  assert.equal(c.categorias[1].datos.length, 1, 'el dato roto se salta');
  assert.equal(c.faltan.length, 1);
  const s = sinDato(c, 'd1');
  assert.equal(s.categorias[0].datos.length, 0);
  assert.equal(s.total, 1);
  assert.equal(sinDato(c, 'no-existe').total, 2);
  assert.deepEqual(conocerDe(null), { categorias: [], total: 0, faltan: [] });
  assert.equal(origenDato({ confianza: 0.9, fuente: 'modelo' }), 'Me lo dijiste');
  assert.equal(origenDato({ confianza: 0.4, fuente: 'reglas' }), 'Lo deduje');
  assert.equal(origenDato({ confianza: 0.4, fuente: 'manual' }), 'Lo agregaste tú');
});

prueba('quedó a medias: solo lo abierto; lo importante y lo reciente primero', () => {
  const l = abiertosDe({
    abiertos: [
      { id: 'a1', texto: 'Mandar la cotización', tipo: 'promesa_persona', estado: 'abierto', importante: false, creado: 1, actualizado: 5 },
      { id: 'a2', texto: 'Buscar el vuelo', tipo: 'promesa_aura', estado: 'abierto', importante: true, creado: 1, actualizado: 2 },
      { id: 'a3', texto: 'Ya hecho', tipo: 'tarea', estado: 'hecho', importante: true, creado: 1, actualizado: 9 },
      { id: 'a4', texto: 'Llamar al banco', tipo: 'tarea', estado: 'abierto', importante: false, creado: 1, actualizado: 7 },
    ],
  });
  assert.deepEqual(ordenarAbiertos(l).map((a) => a.id), ['a2', 'a4', 'a1']);
  assert.equal(etiquetaAbierto('promesa_aura'), 'Te lo prometí');
  assert.equal(etiquetaAbierto('promesa_persona'), 'Dijiste que lo harías');
  assert.equal(etiquetaAbierto('borrador'), 'Borrador sin mandar');
});

/* ── tu círculo ──────────────────────────────────────────────────────────────────────────────── */

prueba('círculo: se sanea (el permiso que no se entiende es «preguntar»)', () => {
  const r = circuloDe({
    personas: [
      { id: 'cp_1', nombre: 'Ana', relacion: 'esposa', canales: { whatsapp: '+50499990000' }, permisos: { recordatorios: 'permitido' } },
      { id: 'cp_2', nombre: 'Beto', relacion: 'hijo', permisos: { recordatorios: 'siempre' } },
      { nombre: 'sin id' },
    ],
    puede: { whatsapp: true, llamada: 'solo_dueno', pulse2chat: 'app' },
  });
  assert.equal(r.personas.length, 2);
  assert.equal(r.personas[0].permisos.recordatorios, 'permitido');
  assert.equal(r.personas[1].permisos.recordatorios, 'preguntar');
  assert.deepEqual(r.personas[1].canales, {});
  assert.equal(r.puede.whatsapp, true);
  assert.equal(nombreRelacion('madre'), 'Mamá');
  assert.equal(nombreRelacion('desconocida'), 'Otra persona');
  assert.equal(numeroLegible('+50499990000'), '+504 9999-0000');
  assert.equal(numeroLegible('+15551234567'), '+15551234567');
});

prueba('círculo: agregar, cambiar y el permiso de recordatorios van por separado', () => {
  assert.deepEqual(cuerpoPersona({ nombre: ' Ana  María ', relacion: 'esposa', whatsapp: '9999-0000' }), { ok: true, cuerpo: { nombre: 'Ana María', relacion: 'esposa', canales: { whatsapp: '9999-0000' } } });
  assert.deepEqual(cuerpoPersona({ nombre: 'Beto', relacion: 'hijo', whatsapp: '' }, 'cp_2').cuerpo, { nombre: 'Beto', relacion: 'hijo', id: 'cp_2' });
  assert.equal(cuerpoPersona({ nombre: '  ', relacion: 'otro', whatsapp: '' }).ok, false);
  assert.equal(cuerpoPersona({ nombre: 'Ana', relacion: 'esposa', whatsapp: '12345' }).ok, false, 'muy corto para un número');
  assert.ok(!('permisos' in cuerpoPersona({ nombre: 'Ana', relacion: 'esposa', whatsapp: '' }, 'cp_1').cuerpo), 'editar no toca los permisos');
  assert.deepEqual(cuerpoPermiso('cp_1', true), { id: 'cp_1', permisos: { recordatorios: 'permitido' } });
  assert.deepEqual(cuerpoPermiso('cp_1', false), { id: 'cp_1', permisos: { recordatorios: 'preguntar' } });
  assert.deepEqual(borradorDe(null), { nombre: '', relacion: 'otro', whatsapp: '' });
  assert.equal(borradorDe({ nombre: 'Ana', relacion: 'esposa', canales: { telefono: '+50488880000' } }).whatsapp, '+50488880000');
});

for (const [nombre, f] of pruebas) {
  n += 1;
  try {
    await f();
    console.log(`ok    ${nombre}`);
  } catch (e) {
    fallos += 1;
    console.log(`FALLA ${nombre}\n      ${e?.message || e}`);
  }
}
console.log(`\n${n - fallos}/${n} pruebas bien`);
process.exit(fallos ? 1 : 0);
