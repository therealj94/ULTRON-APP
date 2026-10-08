/**
 * EL TELÉFONO CON LA INICIATIVA DEL DÍA (tanda F2, todo JS: va por OTA):
 *
 *  · Ajustes → Iniciativa lee lo que dice el servidor (mobile/src/compa/iniciativaDia.ts): lo que vino mal no es «apagada»;
 *    el pie dice qué hace hoy; la hora que ya pasó avisa «desde mañana»;
 *  · el resumen y los empujones llegan como un `mensaje` que abre la mesa, y al tocarlo AURA lo lee (push/logica.ts).
 */
import test from 'node:test';
import assert from 'node:assert/strict';

// El código de la app se carga sin que tsc de la raíz lo siga (tiene su propio tsconfig).
const cargar = (r: string): Promise<any> => import(r);
const I = await cargar('../mobile/src/compa/iniciativaDia');
const Push = await cargar('../mobile/src/push/logica');

const servidor = (o: Record<string, unknown> = {}, p: Record<string, unknown> = {}) => ({
  preferencias: { activa: true, resumen: true, horaResumen: '07:30', empujones: true, llamarResumen: false, llamarVip: false, quietas: { desde: '22:00', hasta: '07:00' }, zona: 'America/Tegucigalpa', ...p },
  dueno: true,
  hoyNo: false,
  empujonesHoy: 1,
  topes: { empujonesDia: 3, espacioMin: 45 },
  honesto: true,
  ...o,
});

test('lo que manda el servidor: se lee entero; lo que vino mal es null (no «apagada»)', () => {
  const v = I.vistaDeServidor(servidor());
  assert.equal(v.preferencias.horaResumen, '07:30');
  assert.equal(v.preferencias.activa, true);
  assert.deepEqual(v.topes, { empujonesDia: 3, espacioMin: 45 });
  assert.equal(I.vistaDeServidor(null), null);
  assert.equal(I.vistaDeServidor({ preferencias: { horaResumen: '7:30' } }), null);
  assert.equal(I.vistaDeServidor(servidor({}, { quietas: null })), null);
});

test('el pie dice qué hace hoy, en los dos idiomas; la hora de hoy que ya pasó avisa «desde mañana»', () => {
  assert.equal(I.resumenEstado(I.vistaDeServidor(servidor())), 'Encendida: resumen a las 7:30 · hasta 3 avisos al día (1 hoy).');
  assert.equal(I.resumenEstado(I.vistaDeServidor(servidor({ hoyNo: true }))), 'En pausa por hoy. Mañana vuelve.');
  assert.match(I.resumenEstado(I.vistaDeServidor(servidor({}, { activa: false })), 'en'), /^Off/);
  assert.equal(I.avisoDesdeManana(I.vistaDeServidor(servidor())), '');
  assert.equal(I.avisoDesdeManana(I.vistaDeServidor(servidor({ desdeManana: true }, { horaResumen: '07:00' }))), 'La hora de hoy ya pasó: empieza mañana a las 7:00.');
  assert.deepEqual(I.horasResumenCon('07:30'), ['06:30', '07:00', '07:30', '08:00', '08:30']);
  assert.deepEqual(I.horasResumenCon('09:15'), ['06:30', '07:00', '07:30', '08:00', '08:30', '09:15'], 'la hora dicha por voz también se ve');
  assert.equal(I.idQuietasDia({ desde: '22:00', hasta: '07:00' }), '22-07');
  assert.equal(I.idQuietasDia({ desde: '20:00', hasta: '06:00' }), 'otro');
});

test('el resumen llega como un `mensaje` que abre la mesa; al tocarlo, AURA lo lee', () => {
  const dueno = 'u0123456789abcdef';
  const datos = Push.leerDatos({ aura: 'push', tipo: 'mensaje', id: 'dia-abc', titulo: 'Tu día', texto: 'Buenos días. En tu agenda de hoy: 9:00 Reunión con Ana.', abrir: 'mesa', para: dueno, enviado: String(Date.now()) });
  assert.ok(datos);
  const k = { AndroidImportance: { HIGH: 4, DEFAULT: 3 }, AndroidVisibility: { PRIVATE: 0, PUBLIC: 1 }, AndroidCategory: { CALL: 'call' }, EventType: { DISMISSED: 0, PRESS: 1, ACTION_PRESS: 2, DELIVERED: 3 } };
  const plan = Push.planear(datos, { dueno, ahora: Date.now(), k });
  assert.equal(plan.que, 'mostrar');
  assert.equal(plan.aviso.title, 'Tu día');
  assert.equal(Push.textoAlAbrir(datos), 'Tu día. Buenos días. En tu agenda de hoy: 9:00 Reunión con Ana.');
  // Revisión de la tanda F: el aviso (pantalla bloqueada) trae solo cuántos y quién; lo detallado viene en `decir` y es
  // lo que AURA dice al tocarlo. `decir` va en los datos del aviso, nunca en lo que se ve.
  const bloqueado = Push.leerDatos({ aura: 'push', tipo: 'mensaje', id: 'dia-def', titulo: 'Tu día', texto: 'Hoy: 1 evento en tu agenda y 2 pendientes. Tócalo y te lo cuento.', decir: 'Buenos días. En tu agenda de hoy: 9:00 Reunión con Ana. Quedó a medias: revisar el contrato.', abrir: 'mesa', para: dueno, enviado: String(Date.now()) });
  const plan2 = Push.planear(bloqueado, { dueno, ahora: Date.now(), k });
  assert.equal(plan2.aviso.body, 'Hoy: 1 evento en tu agenda y 2 pendientes. Tócalo y te lo cuento.');
  assert.doesNotMatch(JSON.stringify([plan2.aviso.title, plan2.aviso.body]), /Reunión|contrato/);
  assert.equal(plan2.aviso.data.decir, 'Buenos días. En tu agenda de hoy: 9:00 Reunión con Ana. Quedó a medias: revisar el contrato.');
  assert.equal(Push.textoAlAbrir(bloqueado), 'Buenos días. En tu agenda de hoy: 9:00 Reunión con Ana. Quedó a medias: revisar el contrato.');
  // Un empujón: el título es AURA y AURA dice la propuesta tal cual.
  const emp = Push.leerDatos({ aura: 'push', tipo: 'mensaje', id: 'emp-abc', titulo: 'AURA', texto: 'En 12 minutos empieza «Junta». ¿Quieres que te deje el enlace a mano?', abrir: 'mesa', para: dueno, enviado: String(Date.now()) });
  assert.equal(Push.textoAlAbrir(emp), 'En 12 minutos empieza «Junta». ¿Quieres que te deje el enlace a mano?');
});
