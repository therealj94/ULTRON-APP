/**
 * AUR10 · controles de voz separados y sin ambigüedad (documento maestro, sección 12).
 *
 * Lo que tiene que ser verdad:
 *   · cada control tiene UN efecto (la tabla de la sección 12 como datos): detener el audio no cancela la
 *     tarea ni cuelga; colgar no cancela la tarea; cancelar la tarea no cuelga ni silencia el micrófono;
 *   · por voz: «para de hablar» / «cállate» = detener audio; «cancela la tarea» = cancelar tarea;
 *     «cuelga» = colgar; «silencia el micrófono» = silenciar micrófono;
 *   · «para», «basta», «detente» a secas con audio Y tarea vivos: se pregunta, no se adivina; con un solo
 *     alcance posible, ese; un «para» a secas nunca cuelga;
 *   · la respuesta a la pregunta («la tarea», «tu voz», «las dos», «nada») resuelve sin volver a preguntar;
 *   · ejecutar un control solo toca los puertos de su efecto (dobles que cuentan cada llamada);
 *   · la copia del teléfono (mobile/src/lib/controlesVoz.ts) dice exactamente lo mismo que lib/.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CONTROLES,
  EFECTOS,
  ejecutarControl,
  interpretarControl,
  preguntaAclaracion,
  respuestaAclaracion,
  type ControlVoz,
  type EstadoControles,
  type PuertosControl,
} from '../lib/controles-voz';
import * as MOVIL from '../mobile/src/lib/controlesVoz';

const control = (texto: string, estado: EstadoControles = {}) => {
  const r = interpretarControl(texto, estado);
  return r?.tipo === 'control' ? r.control : r?.tipo === 'aclarar' ? `aclarar:${r.opciones.join('+')}` : null;
};

test('la tabla: cada control con su efecto y ninguno pisa otro ciclo de vida', () => {
  assert.deepEqual([...CONTROLES].sort(), ['activar_mic', 'cancelar_tarea', 'colgar', 'detener_audio', 'interrumpir', 'pausar_tarea', 'reanudar_tarea', 'silenciar_mic', 'tomar_control'].sort());
  assert.deepEqual(EFECTOS.detener_audio, { audio: 'parar' });
  assert.deepEqual(EFECTOS.silenciar_mic, { mic: 'silenciar' });
  assert.deepEqual(EFECTOS.colgar, { llamada: 'colgar' });
  assert.deepEqual(EFECTOS.cancelar_tarea, { tarea: 'cancelar' });
  assert.deepEqual(EFECTOS.pausar_tarea, { tarea: 'pausar' });
  assert.deepEqual(EFECTOS.tomar_control, { tarea: 'tomar' });
  // Interrumpir corta la salida y el turno; no toca la tarea ni la llamada.
  assert.deepEqual(EFECTOS.interrumpir, { audio: 'parar', turno: 'cortar' });
  for (const c of CONTROLES) {
    const e = EFECTOS[c];
    if (c !== 'colgar') assert.equal(e.llamada, undefined, `${c} no cuelga`);
    if (!c.endsWith('_tarea') && c !== 'tomar_control') assert.equal(e.tarea, undefined, `${c} no toca la tarea`);
    if (c.endsWith('_tarea') || c === 'tomar_control') assert.deepEqual(Object.keys(e), ['tarea'], `${c} solo toca la tarea`);
  }
});

test('por voz: cada frase explícita va a su control, haya lo que haya vivo', () => {
  const todo: EstadoControles = { audio: true, tarea: true, llamada: true, turno: true };
  const casos: Array<[string, ControlVoz]> = [
    ['para de hablar', 'detener_audio'],
    ['Cállate', 'detener_audio'],
    ['AURA, cállate ya', 'detener_audio'],
    ['deja de hablar por favor', 'detener_audio'],
    ['silencio', 'detener_audio'],
    ['shh', 'detener_audio'],
    ['stop talking', 'detener_audio'],
    ['detén el audio', 'detener_audio'],
    ['cancela la tarea', 'cancelar_tarea'],
    ['Cancela la tarea, por favor', 'cancelar_tarea'],
    ['detén la tarea', 'cancelar_tarea'],
    ['para la computadora', 'cancelar_tarea'],
    ['cancel the task', 'cancelar_tarea'],
    ['pausa la tarea', 'pausar_tarea'],
    ['pon la tarea en pausa', 'pausar_tarea'],
    ['sigue con la tarea', 'reanudar_tarea'],
    ['reanuda la tarea', 'reanudar_tarea'],
    ['tomo el control', 'tomar_control'],
    ['dame el control', 'tomar_control'],
    ['cuelga', 'colgar'],
    ['cuelga la llamada', 'colgar'],
    ['termina la llamada', 'colgar'],
    ['hang up', 'colgar'],
    ['silencia el micrófono', 'silenciar_mic'],
    ['apaga el micrófono', 'silenciar_mic'],
    ['deja de escuchar', 'silenciar_mic'],
    ['mute', 'silenciar_mic'],
    ['ya puedes hablar', 'activar_mic'],
    ['activa el micrófono', 'activar_mic'],
    ['olvídalo', 'interrumpir'],
    ['never mind', 'interrumpir'],
  ];
  for (const [frase, esperado] of casos) {
    assert.equal(control(frase, todo), esperado, frase);
    assert.equal(control(frase), esperado, `${frase} (sin estado)`);
  }
});

test('«para», «basta», «detente» a secas: con audio y tarea se pregunta; con un solo alcance, ese', () => {
  for (const f of ['para', 'Basta', 'detente', 'alto', 'stop', 'para ya']) {
    assert.equal(control(f, { audio: true, tarea: true }), 'aclarar:detener_audio+cancelar_tarea', f);
    assert.equal(control(f, { audio: true }), 'detener_audio', `${f} solo con audio`);
    assert.equal(control(f, { tarea: true }), 'cancelar_tarea', `${f} solo con tarea`);
    // Nada vivo: callar es inofensivo (lo de siempre) y nunca cuelga.
    assert.equal(control(f), 'detener_audio', `${f} sin nada`);
    assert.equal(control(f, { llamada: true }), 'detener_audio', `${f} en llamada: no cuelga`);
    assert.equal(control(f, { llamada: true, audio: true }), 'detener_audio', `${f} en llamada con audio: no cuelga`);
  }
  // Pensando (sin audio todavía): corta la respuesta en curso.
  assert.equal(control('para', { turno: true }), 'interrumpir');
  assert.equal(control('para', { turno: true, tarea: true }), 'aclarar:interrumpir+cancelar_tarea');
  // «pausa» a secas con tarea y audio: pregunta qué se pausa; sin tarea, solo calla.
  assert.equal(control('pausa', { audio: true, tarea: true }), 'aclarar:detener_audio+pausar_tarea');
  assert.equal(control('pausa', { tarea: true }), 'pausar_tarea');
  // «cancela» a secas sin nada vivo no es un control (lo decide el resto: un borrador, el cerebro).
  assert.equal(control('cancela'), null);
  assert.equal(control('cancela', { tarea: true }), 'cancelar_tarea');
  assert.equal(control('cancela', { tarea: true, audio: true }), 'aclarar:detener_audio+cancelar_tarea');
});

test('lo que no es un control no se toma por uno', () => {
  for (const f of ['para mañana necesito el informe', '¿qué es una tarea?', 'la llamada de ayer estuvo bien', 'cuelga el cuadro en la sala', 'para qué sirve esto', 'ya', 'hola', '', 'cancela la suscripción de Netflix']) {
    assert.equal(interpretarControl(f, { audio: true, tarea: true, llamada: true }), null, f);
  }
});

test('la pregunta y su respuesta: «la tarea», «tu voz», «las dos», «nada»', () => {
  const op: ControlVoz[] = ['detener_audio', 'cancelar_tarea'];
  assert.match(preguntaAclaracion(op, 'es'), /voz.*tarea|tarea.*voz/i);
  assert.match(preguntaAclaracion(op, 'en'), /voice.*task|task.*voice/i);
  assert.match(preguntaAclaracion(['detener_audio', 'pausar_tarea'], 'es'), /paus/i);
  assert.deepEqual(respuestaAclaracion('la tarea', op), ['cancelar_tarea']);
  assert.deepEqual(respuestaAclaracion('tu voz', op), ['detener_audio']);
  assert.deepEqual(respuestaAclaracion('de hablar', op), ['detener_audio']);
  assert.deepEqual(respuestaAclaracion('las dos', op), ['detener_audio', 'cancelar_tarea']);
  assert.deepEqual(respuestaAclaracion('both', op), ['detener_audio', 'cancelar_tarea']);
  assert.equal(respuestaAclaracion('nada', op), 'ninguno');
  assert.equal(respuestaAclaracion('no, sigue', op), 'ninguno');
  // Un control explícito se respeta tal cual (aunque no estuviera entre las opciones).
  assert.deepEqual(respuestaAclaracion('cuelga', op), ['colgar']);
  assert.deepEqual(respuestaAclaracion('la tarea', ['detener_audio', 'pausar_tarea']), ['pausar_tarea']);
  // Otra cosa no es respuesta: sigue su camino.
  assert.equal(respuestaAclaracion('qué hora es', op), null);
});

/** Puertos de mentira que anotan cada llamada. */
function puertos(o: { tareaFalla?: boolean } = {}) {
  const llamadas: string[] = [];
  const p: PuertosControl = {
    pararAudio: () => void llamadas.push('audio'),
    cortarTurno: () => void llamadas.push('turno'),
    microfono: (silenciar) => (llamadas.push(silenciar ? 'mic-off' : 'mic-on'), { ok: true }),
    colgar: () => (llamadas.push('colgar'), { ok: true }),
    tarea: async (que) => (llamadas.push(`tarea-${que}`), o.tareaFalla ? { ok: false, detalle: 'No hay ninguna tarea en marcha.' } : { ok: true }),
  };
  return { p, llamadas };
}

test('ejecutar: cada control toca SOLO sus puertos (colgar no cancela la tarea; cancelar no cuelga)', async () => {
  const esperado: Record<ControlVoz, string[]> = {
    detener_audio: ['audio'],
    interrumpir: ['audio', 'turno'],
    silenciar_mic: ['mic-off'],
    activar_mic: ['mic-on'],
    colgar: ['colgar'],
    cancelar_tarea: ['tarea-cancelar'],
    pausar_tarea: ['tarea-pausar'],
    reanudar_tarea: ['tarea-reanudar'],
    tomar_control: ['tarea-tomar'],
  };
  for (const c of CONTROLES) {
    const { p, llamadas } = puertos();
    const r = await ejecutarControl(c, p);
    assert.equal(r.ok, true, c);
    assert.deepEqual(llamadas, esperado[c], c);
  }
});

test('ejecutar: lo que no se puede se dice (sin puerto o el puerto falló), nunca «listo» de más', async () => {
  const sinTarea = await ejecutarControl('cancelar_tarea', { pararAudio: () => undefined });
  assert.equal(sinTarea.ok, false);
  assert.ok(sinTarea.detalle);
  const { p } = puertos({ tareaFalla: true });
  const r = await ejecutarControl('cancelar_tarea', p);
  assert.deepEqual([r.ok, r.detalle], [false, 'No hay ninguna tarea en marcha.']);
  const explota = await ejecutarControl('colgar', { colgar: () => { throw new Error('se cayó'); } });
  assert.equal(explota.ok, false);
});

test('la copia del teléfono dice exactamente lo mismo que lib/', async () => {
  const fs = await import('node:fs');
  const cuerpo = (p: string) => {
    const s = fs.readFileSync(new URL(p, import.meta.url), 'utf8');
    return s.slice(s.indexOf(' */\n') + 4);
  };
  assert.equal(cuerpo('../mobile/src/lib/controlesVoz.ts'), cuerpo('../lib/controles-voz.ts'), 'la copia del teléfono es la misma (salvo su cabecera)');
  assert.deepEqual([...MOVIL.CONTROLES], [...CONTROLES]);
  assert.deepEqual(MOVIL.EFECTOS, EFECTOS);
  const estados: EstadoControles[] = [{}, { audio: true }, { tarea: true }, { audio: true, tarea: true }, { turno: true }, { turno: true, tarea: true }, { llamada: true }, { llamada: true, audio: true, tarea: true }];
  const frases = ['para', 'basta', 'detente', 'alto', 'stop', 'para ya', 'pausa', 'cancela', 'cállate', 'para de hablar', 'silencio', 'cuelga', 'hang up', 'cancela la tarea', 'pausa la tarea', 'sigue con la tarea', 'tomo el control', 'silencia el micrófono', 'mute', 'ya puedes hablar', 'olvídalo', 'para mañana necesito', 'ya', 'hola', 'cancela la suscripción'];
  for (const e of estados) for (const f of frases) assert.deepEqual(MOVIL.interpretarControl(f, e, 'es'), interpretarControl(f, e, 'es'), `${f} ${JSON.stringify(e)}`);
  for (const r of ['la tarea', 'tu voz', 'las dos', 'nada', 'cuelga', 'qué hora es']) assert.deepEqual(MOVIL.respuestaAclaracion(r, ['detener_audio', 'cancelar_tarea']), respuestaAclaracion(r, ['detener_audio', 'cancelar_tarea']), r);
});
