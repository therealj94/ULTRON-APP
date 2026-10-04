/**
 * PERMISOS EXACTOS, NOVENA RONDA (ajuste): en la VOZ, las acciones de la app que cumplen lo que esperaba (el mensaje de
 * AU-RA, la llamada o el recordatorio propuestos) salen cuando se confirma el turno. Antes de emitirlas se vuelve a
 * mirar que lo que espera la app sea EXACTAMENTE lo decidido (su versión: destino, contenido y cuándo se anotó); si
 * cambió o ya no está, no sale nada y el turno siguiente dice que cambió. Y una sola vez por decisión: confirmar dos
 * veces (o la voz y otro camino) no la emite dos veces.
 *
 * Las acciones se cuentan como las emitiría el servidor (alConfirmarAccionesApp decide cuáles salen). Datos sintéticos.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

const APP = await import('../lib/acciones-app');
const ANA = 'ana@example.test';
const CTX: any = { pantalla: 'chats', contactos: [{ correo: ANA, nombre: 'Ana' }, { correo: 'bruno@example.test', nombre: 'Bruno' }], manos: ['enviar_exacto', 'llamar', 'recordatorio'] };

/** Lo que el turno decidió emitir (con su id), y lo que vio de la app al decidir. */
function turnoQueDecide(amb: string, mensaje: string) {
  const pendiente = APP.pendienteAnterior(amb);
  const propuesta = APP.propuestaAnterior(amb);
  const vista = APP.appEsperandoDe(amb, CTX);
  const acciones = APP.prepararAcciones([{ tipo: 'enviar' }, { tipo: 'llamar', con: 'Ana', video: false }] as any, { mensaje, contexto: CTX, pendiente, propuesta });
  const eventos = acciones.map((accion) => ({ id: APP.nuevoIdAccion(), accion }));
  return { vista, eventos, propuesta };
}

/** Lo que sale al confirmar el turno (cada llamada es una confirmación). */
const alConfirmar = (amb: string, d: ReturnType<typeof turnoQueDecide>) =>
  (APP as any).alConfirmarAccionesApp(amb, { vista: d.vista, contexto: CTX, propuesta: d.propuesta }, d.eventos) as Array<{ id: string; accion: any }>;

test('ronda 9 (app, voz): lo que esperaba la app cambia entre decidir y confirmar el turno → no se emite nada; el turno siguiente lo dice', () => {
  APP._reiniciarAccionesApp();
  const amb = APP.ambitoApp('jose@example.test', 'tel');
  APP.abrirTurnoApp(amb);
  APP.anotarPendiente(amb, { para: ANA, texto: 'Llego a las 3' });
  APP.abrirTurnoApp(amb);
  const d = turnoQueDecide(amb, 'sí');
  assert.deepEqual(d.eventos.map((e) => e.accion), [{ tipo: 'enviar', para: ANA, texto: 'Llego a las 3' }], 'el turno decidió mandar el de Ana');
  // Antes de confirmar el turno de voz, otro camino cambia lo que espera (otro texto para Ana).
  APP.anotarPendiente(amb, { para: ANA, texto: 'Ya no voy' });
  assert.deepEqual(alConfirmar(amb, d), [], 'no se emite el mensaje de antes');
  assert.match((APP as any).avisosAppDe(amb).join('\n'), /cambió/i, 'el turno siguiente dice que cambió');
  // Si ya no está, tampoco.
  APP._reiniciarAccionesApp();
  APP.abrirTurnoApp(amb);
  APP.anotarPendiente(amb, { para: ANA, texto: 'Llego a las 3' });
  APP.abrirTurnoApp(amb);
  const d2 = turnoQueDecide(amb, 'sí');
  APP.soltarPendiente(amb);
  assert.deepEqual(alConfirmar(amb, d2), []);
});

test('ronda 9 (app, voz): confirmar dos veces la misma decisión emite una sola vez (mensaje y llamada propuesta)', () => {
  APP._reiniciarAccionesApp();
  const amb = APP.ambitoApp('jose@example.test', 'tel');
  APP.abrirTurnoApp(amb);
  APP.anotarPendiente(amb, { para: ANA, texto: 'Llego a las 3' });
  APP.abrirTurnoApp(amb);
  const d = turnoQueDecide(amb, 'sí');
  assert.equal(alConfirmar(amb, d).length, 1, 'la primera confirmación lo emite');
  assert.equal(alConfirmar(amb, d).length, 0, 'la segunda, no');
  // Otra decisión sobre lo mismo (la voz y otro camino con un id distinto): tampoco sale dos veces.
  const otra = { ...d, eventos: d.eventos.map((e) => ({ id: APP.nuevoIdAccion(), accion: e.accion })) };
  assert.equal(alConfirmar(amb, otra).length, 0);
  // La llamada propuesta.
  APP._reiniciarAccionesApp();
  APP.abrirTurnoApp(amb);
  APP.anotarPropuesta(amb, { tipo: 'llamar', con: ANA, nombre: 'Ana', video: false });
  APP.abrirTurnoApp(amb);
  const l = turnoQueDecide(amb, 'sí');
  assert.deepEqual(l.eventos.map((e) => e.accion.tipo), ['llamar']);
  assert.equal(alConfirmar(amb, l).length, 1);
  assert.equal(alConfirmar(amb, l).length, 0);
});

test('ronda 9 (app): lo que no cumple nada de lo que espera (abrir una pantalla) sale igual; un mensaje nuevo al mismo destino con el mismo texto, anotado otra vez, sí sale', () => {
  APP._reiniciarAccionesApp();
  const amb = APP.ambitoApp('jose@example.test', 'tel');
  APP.abrirTurnoApp(amb);
  const abrir = [{ id: APP.nuevoIdAccion(), accion: { tipo: 'abrir', pantalla: 'ajustes' } as any }];
  assert.equal((APP as any).alConfirmarAccionesApp(amb, { vista: APP.appEsperandoDe(amb, CTX), contexto: CTX, propuesta: null }, abrir).length, 1);
  // El mismo texto a Ana, pero redactado de nuevo más tarde (otra versión): es otra decisión.
  APP.anotarPendiente(amb, { para: ANA, texto: 'Llego a las 3' }, Date.now() - 5000);
  APP.abrirTurnoApp(amb);
  const d = turnoQueDecide(amb, 'sí');
  assert.equal(alConfirmar(amb, d).length, 1);
  APP.anotarPendiente(amb, { para: ANA, texto: 'Llego a las 3' });
  APP.abrirTurnoApp(amb);
  const d2 = turnoQueDecide(amb, 'sí');
  assert.equal(alConfirmar(amb, d2).length, 1, 'otra versión (otro momento): sale');
});
