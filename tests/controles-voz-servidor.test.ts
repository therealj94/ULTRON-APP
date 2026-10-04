/**
 * AUR10 · los controles separados en el camino rápido del servidor (lib/acciones-app.ts).
 *
 * El teléfono que declara la mano `controles` recibe acciones con UN efecto: `detener_audio` («cállate»,
 * «para de hablar»), `colgar` («cuelga»), `tarea` («cancela la tarea», «pausa la tarea», «tomo el
 * control») y `silencio` solo para el micrófono («silencia el micrófono», «ya puedes hablar»). Un APK
 * viejo (sin la mano) sigue recibiendo lo de siempre: «cállate» → silencio.
 *
 * La palabra suelta con audio y tarea vivos («para») no hace nada: pregunta y la pregunta espera la
 * respuesta del turno SIGUIENTE (como el «sí» de una propuesta): «la tarea», «tu voz», «las dos», «nada».
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  _reiniciarAccionesApp,
  abrirTurnoApp,
  aclaracionAnterior,
  anotarAclaracion,
  dichoDeAcciones,
  ordenDeEtiqueta,
  ordenPorReglas,
  soltarAclaracion,
  validarAccion,
  validarContexto,
  type ContextoApp,
} from '../lib/acciones-app';
import { manoDe } from '../lib/manos-app';

const conControles: ContextoApp = { pantalla: 'mesa', contactos: [], manos: ['controles'] };
const viejo: ContextoApp = { pantalla: 'mesa', contactos: [] };

test('el contrato: los controles solo salen de lo que dijo la persona (el modelo no cuelga ni cancela) y piden su mano', () => {
  // validarAccion es lo que filtra lo que escribe el modelo: no los conoce (como la computadora o la iniciativa).
  assert.equal(validarAccion({ tipo: 'detener_audio' }), null);
  assert.equal(validarAccion({ tipo: 'colgar' }), null);
  assert.equal(validarAccion({ tipo: 'tarea', que: 'cancelar' }), null);
  assert.equal(manoDe({ tipo: 'colgar' }), 'controles');
  assert.equal(manoDe({ tipo: 'detener_audio' }), 'controles');
  assert.equal(manoDe({ tipo: 'tarea' }), 'controles');
  const v = validarContexto({ pantalla: 'mesa', contactos: [], manos: ['controles', 'llamame'] });
  assert.ok(v.ok && v.contexto.manos?.includes('controles'));
});

test('con la mano `controles`: cada frase, su control (detener audio no es silenciar el micrófono)', () => {
  const o = (t: string) => ordenPorReglas(t, { contexto: conControles })?.accion ?? null;
  assert.deepEqual(o('cállate'), { tipo: 'detener_audio' });
  assert.deepEqual(o('para de hablar'), { tipo: 'detener_audio' });
  assert.deepEqual(o('shhh'), { tipo: 'detener_audio' });
  assert.deepEqual(o('silencia el micrófono'), { tipo: 'silencio', valor: true });
  assert.deepEqual(o('deja de escuchar'), { tipo: 'silencio', valor: true });
  assert.deepEqual(o('ya puedes hablar'), { tipo: 'silencio', valor: false });
  assert.deepEqual(o('cuelga'), { tipo: 'colgar' });
  assert.deepEqual(o('termina la llamada'), { tipo: 'colgar' });
  assert.deepEqual(o('cancela la tarea'), { tipo: 'tarea', que: 'cancelar' });
  assert.deepEqual(o('pausa la tarea'), { tipo: 'tarea', que: 'pausar' });
  assert.deepEqual(o('sigue con la tarea'), { tipo: 'tarea', que: 'reanudar' });
  assert.deepEqual(o('tomo el control'), { tipo: 'tarea', que: 'tomar' });
  assert.equal(ordenPorReglas('cuelga', { contexto: conControles })?.decir, 'Cuelgo.');
  assert.equal(dichoDeAcciones([{ tipo: 'tarea', que: 'cancelar' }]), 'Cancelo la tarea.');
});

test('sin la mano (un APK viejo): lo de siempre, y nada que no sepa hacer', () => {
  const o = (t: string) => ordenPorReglas(t, { contexto: viejo })?.accion ?? null;
  assert.deepEqual(o('cállate'), { tipo: 'silencio', valor: true });
  assert.deepEqual(o('ya puedes hablar'), { tipo: 'silencio', valor: false });
  assert.equal(o('cuelga'), null, 'no sabe colgar por voz: lo contesta el cerebro');
  assert.equal(o('cancela la tarea'), null, 'la tarea sigue por el cerebro (su herramienta de la computadora)');
  assert.deepEqual(ordenPorReglas('cállate')?.accion, { tipo: 'silencio', valor: true }, 'sin contexto, como antes');
});

test('«para» a secas con audio y tarea: pregunta (no adivina) y la respuesta del turno siguiente decide', () => {
  const estado = { audio: true, tarea: true };
  const r = ordenPorReglas('para', { contexto: conControles, estadoControles: estado });
  assert.equal(r?.accion, null);
  assert.deepEqual(r?.aclaracion, ['detener_audio', 'cancelar_tarea']);
  assert.match(r!.decir, /voz.*tarea/);
  // Un solo alcance: sin preguntar.
  assert.deepEqual(ordenPorReglas('para', { contexto: conControles, estadoControles: { audio: true } })?.accion, { tipo: 'detener_audio' });
  assert.deepEqual(ordenPorReglas('basta', { contexto: conControles, estadoControles: { tarea: true } })?.accion, { tipo: 'tarea', que: 'cancelar' });
  // La respuesta.
  const op = ['detener_audio', 'cancelar_tarea'] as const;
  const t = ordenPorReglas('la tarea', { contexto: conControles, aclaracion: [...op] });
  assert.deepEqual([t?.accion, t?.soltarAclaracion], [{ tipo: 'tarea', que: 'cancelar' }, true]);
  const v = ordenPorReglas('tu voz', { contexto: conControles, aclaracion: [...op] });
  assert.deepEqual(v?.accion, { tipo: 'detener_audio' });
  const d = ordenPorReglas('las dos', { contexto: conControles, aclaracion: [...op] });
  assert.deepEqual([d?.accion, d?.mas], [{ tipo: 'detener_audio' }, [{ tipo: 'tarea', que: 'cancelar' }]]);
  const n = ordenPorReglas('nada', { contexto: conControles, aclaracion: [...op] });
  assert.deepEqual([n?.accion, n?.soltarAclaracion, n?.soloDecir], [null, true, true]);
  // Otra frase cualquiera no es respuesta: sigue su camino (y el turno siguiente soltará la pregunta).
  assert.deepEqual(ordenPorReglas('abre ajustes', { contexto: conControles, aclaracion: [...op] })?.accion, { tipo: 'abrir', pantalla: 'ajustes' });
});

test('la pregunta espera SOLO el turno siguiente (como el «sí» de una propuesta)', () => {
  _reiniciarAccionesApp();
  const amb = 'jose@x.com#tel1';
  abrirTurnoApp(amb);
  anotarAclaracion(amb, ['detener_audio', 'cancelar_tarea']);
  assert.equal(aclaracionAnterior(amb), null, 'en el mismo turno todavía no la oyó');
  abrirTurnoApp(amb);
  assert.deepEqual(aclaracionAnterior(amb), ['detener_audio', 'cancelar_tarea']);
  abrirTurnoApp(amb);
  assert.equal(aclaracionAnterior(amb), null, 'otro turno la soltó');
  anotarAclaracion(amb, ['detener_audio', 'pausar_tarea']);
  abrirTurnoApp(amb);
  soltarAclaracion(amb);
  assert.equal(aclaracionAnterior(amb), null);
});

test('Laya «callar» con la mano: detener audio; si la frase es del micrófono, silenciar el micrófono', () => {
  assert.deepEqual(ordenDeEtiqueta('app_callar', 'ya no me hables tanto', 'laya', { contexto: conControles })?.accion, { tipo: 'detener_audio' });
  assert.deepEqual(ordenDeEtiqueta('app_callar', 'deja de escucharme', 'laya', { contexto: conControles })?.accion, { tipo: 'silencio', valor: true });
  assert.deepEqual(ordenDeEtiqueta('app_callar', 'ya no me hables tanto', 'laya', { contexto: viejo })?.accion, { tipo: 'silencio', valor: true });
});
