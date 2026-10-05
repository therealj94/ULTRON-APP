/**
 * AUR10 · los controles separados en el teléfono (mobile/src/compa/controles.ts, lib/intenciones.ts).
 *
 *   · el teléfono declara la mano `controles` y entiende las acciones nuevas (detener_audio, colgar,
 *     tarea); una con otra forma se ignora;
 *   · cada acción toca SOLO su puerto: colgar no toca la tarea, cancelar la tarea no cuelga, detener el
 *     audio no silencia el micrófono (dobles que anotan cada llamada);
 *   · la tarea se maneja por las rutas que ya existen de su computadora (parar, pausar, reanudar,
 *     control), con lo que el servicio sabe hacer, y lo que no se pudo se dice;
 *   · la mesa (interpretar): «cállate» / «para» siguen callando como siempre; «cuelga» y «cancela la
 *     tarea» son controles; con audio y tarea vivos, «para» a secas pregunta.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { MANOS } from '../lib/manos-app';
import { MANOS_APP } from '../mobile/src/nucleo/contrato';
import { accionDeControlMesa, aplicarAccionControl, controlDeAccion, controlarTareaPc, estadoControlesDe, type ApiMin } from '../mobile/src/compa/controles';
import * as controlesMovil from '../mobile/src/compa/controles';

test('el contrato del teléfono: declara `controles` (la misma lista que el servidor) y valida las acciones nuevas', async () => {
  // El puente de acciones se carga sin que tsc de la raíz lo siga (es código de la app, con su tsconfig estricto).
  const ruta = '../mobile/src/compa/acciones';
  const { esAccionApp } = (await import(ruta)) as { esAccionApp: (a: unknown) => boolean };
  assert.deepEqual([...MANOS_APP], [...MANOS]);
  assert.ok(MANOS_APP.includes('controles'));
  assert.equal(esAccionApp({ tipo: 'detener_audio' }), true);
  assert.equal(esAccionApp({ tipo: 'colgar' }), true);
  assert.equal(esAccionApp({ tipo: 'tarea', que: 'cancelar' }), true);
  assert.equal(esAccionApp({ tipo: 'tarea', que: 'borrar' }), false);
  assert.equal(esAccionApp({ tipo: 'tarea' }), false);
});

/** Un api() de mentira: el estado de su computadora y las rutas que se llaman. */
function apiFalsa(estado: any, o: { fase?: string; falla?: boolean } = {}) {
  const llamadas: Array<{ ruta: string; cuerpo?: any }> = [];
  const api: ApiMin = async (ruta, init) => {
    llamadas.push({ ruta, cuerpo: init?.body ? JSON.parse(String(init.body)) : undefined });
    if (ruta === '/api/computadora') return estado;
    if (o.falla) throw new Error('La computadora no contestó.');
    return { ok: true, fase: o.fase ?? null };
  };
  return { api, llamadas };
}

const viva = (estadoTarea: string, capacidades = ['pausar', 'control']) => ({ configurada: true, ok: true, capacidades, actual: { id: 't-1', estado: estadoTarea, pasos: 3, instruccion: 'busca vuelos', ultimo: null } });

test('la tarea por sus rutas: cancelar, pausar, seguir y tomar el control, con lo que sabe el servicio', async () => {
  let f = apiFalsa(viva('trabajando'));
  assert.deepEqual(await controlarTareaPc('cancelar', f.api), { ok: true });
  assert.deepEqual(f.llamadas.map((l) => l.ruta), ['/api/computadora', '/api/computadora/tareas/t-1/parar']);
  f = apiFalsa(viva('trabajando'));
  assert.equal((await controlarTareaPc('pausar', f.api)).ok, true);
  assert.equal(f.llamadas[1].ruta, '/api/computadora/tareas/t-1/pausar');
  f = apiFalsa(viva('pausada'));
  assert.equal((await controlarTareaPc('reanudar', f.api)).ok, true);
  assert.equal(f.llamadas[1].ruta, '/api/computadora/tareas/t-1/reanudar');
  f = apiFalsa(viva('trabajando'));
  assert.equal((await controlarTareaPc('tomar', f.api)).ok, true);
  assert.deepEqual(f.llamadas[1], { ruta: '/api/computadora/tareas/t-1/control', cuerpo: { tomar: true } });
  // Lo que no se puede, dicho (y sin llamar a la ruta).
  f = apiFalsa({ configurada: true, ok: true, actual: null });
  const sin = await controlarTareaPc('cancelar', f.api);
  assert.equal(sin.ok, false);
  assert.match(sin.detalle!, /no hay ninguna tarea/i);
  assert.equal(f.llamadas.length, 1);
  f = apiFalsa(viva('hecha'));
  assert.equal((await controlarTareaPc('cancelar', f.api)).ok, false, 'una tarea terminada no se cancela');
  f = apiFalsa(viva('trabajando', []));
  const noPausa = await controlarTareaPc('pausar', f.api);
  assert.equal(noPausa.ok, false);
  assert.match(noPausa.detalle!, /pausar/);
  assert.equal(f.llamadas.length, 1);
  // Un toque que ya había salido: se dice que termina primero (no «detenida» todavía).
  f = apiFalsa(viva('trabajando'), { fase: 'draining' });
  const drenando = await controlarTareaPc('cancelar', f.api);
  assert.equal(drenando.ok, true);
  assert.match(drenando.detalle!, /terminando/);
  f = apiFalsa(viva('trabajando'), { falla: true });
  assert.deepEqual(await controlarTareaPc('cancelar', f.api), { ok: false, detalle: 'La computadora no contestó.' });
});

/** Los puertos del teléfono, de mentira: anotan qué se tocó. */
function puertos(o: { llamada?: boolean } = {}) {
  const tocado: string[] = [];
  return {
    tocado,
    p: {
      pararAudio: () => void tocado.push('audio'),
      cortarTurno: () => void tocado.push('turno'),
      microfono: (s: boolean) => (tocado.push(s ? 'mic-off' : 'mic-on'), { ok: true }),
      colgar: () => (tocado.push('colgar'), o.llamada === false ? { ok: false, detalle: 'No hay ninguna llamada que colgar.' } : { ok: true }),
      tarea: async (que: string) => (tocado.push(`tarea-${que}`), { ok: true }),
    },
  };
}

test('cada acción toca SOLO su puerto: colgar no cancela la tarea; cancelar la tarea no cuelga; callar no silencia', async () => {
  let x = puertos();
  assert.equal((await aplicarAccionControl({ tipo: 'colgar' }, x.p)).ok, true);
  assert.deepEqual(x.tocado, ['colgar']);
  x = puertos();
  await aplicarAccionControl({ tipo: 'tarea', que: 'cancelar' }, x.p);
  assert.deepEqual(x.tocado, ['tarea-cancelar']);
  x = puertos();
  await aplicarAccionControl({ tipo: 'detener_audio' }, x.p);
  assert.deepEqual(x.tocado, ['audio']);
  x = puertos({ llamada: false });
  const r = await aplicarAccionControl({ tipo: 'colgar' }, x.p);
  assert.deepEqual([r.ok, r.detalle], [false, 'No hay ninguna llamada que colgar.']);
});

test('la mesa emite el control como la acción del VozProvider, ida y vuelta sin perder el efecto', async () => {
  const { CONTROLES } = await import('../mobile/src/lib/controlesVoz');
  for (const c of CONTROLES) {
    const a = accionDeControlMesa(c);
    const vuelta = controlDeAccion(a);
    // Interrumpir, en el teléfono, es detener el audio (el turno lo corta la mesa, que es quien lo tiene).
    assert.equal(vuelta, c === 'interrumpir' ? 'detener_audio' : c, c);
  }
});

test('lo que está vivo, para la mesa y el servidor: audio, tarea, llamada y turno', () => {
  assert.deepEqual(estadoControlesDe({ hablando: true, cola: 0, tarea: 'trabajando', ciclo: 'en_llamada', pensando: false }), { audio: true, tarea: true, llamada: true, turno: false });
  assert.deepEqual(estadoControlesDe({ hablando: false, cola: 2, tarea: 'hecha', ciclo: 'reposo', pensando: true }), { audio: true, tarea: false, llamada: false, turno: true });
  assert.deepEqual(estadoControlesDe({ hablando: false, cola: 0, tarea: null, ciclo: 'colgada', pensando: false }), { audio: false, tarea: false, llamada: false, turno: false });
});

test('la mesa: callar sigue callando; colgar y la tarea son controles; con audio y tarea, «para» pregunta', async () => {
  // Como el puente de acciones: tsc de la raíz no lo sigue (sus tipos vienen de la app, con expo-constants).
  const rutaIntenciones = '../mobile/src/lib/intenciones';
  const { interpretar } = (await import(rutaIntenciones)) as { interpretar: (t: string, ctx?: Record<string, unknown>) => { tipo: string; [k: string]: unknown } };
  for (const f of ['cállate', 'para', 'para ya', 'basta', 'silencio', 'silencio por favor', 'shh', 'stop', 'alto', 'ya cállate', 'cállate ya']) {
    assert.equal(interpretar(f).tipo, 'callar', f);
  }
  assert.deepEqual(interpretar('cuelga'), { tipo: 'control', control: 'colgar' });
  assert.deepEqual(interpretar('cancela la tarea'), { tipo: 'control', control: 'cancelar_tarea' });
  assert.deepEqual(interpretar('pausa la tarea'), { tipo: 'control', control: 'pausar_tarea' });
  assert.deepEqual(interpretar('tomo el control'), { tipo: 'control', control: 'tomar_control' });
  assert.deepEqual(interpretar('silencia el micrófono'), { tipo: 'control', control: 'silenciar_mic' });
  const a = interpretar('para', { audio: true, tarea: true });
  assert.equal(a.tipo, 'aclarar');
  assert.deepEqual(a.tipo === 'aclarar' && a.opciones, ['detener_audio', 'cancelar_tarea']);
  assert.deepEqual(interpretar('para', { tarea: true }), { tipo: 'control', control: 'cancelar_tarea' });
  assert.equal(interpretar('para', { audio: true }).tipo, 'callar');
  // Lo de siempre sigue igual: la entrevista, el cerebro.
  assert.equal(interpretar('para', { enConocer: true }).tipo, 'callar');
  assert.equal(interpretar('ya está', { enConocer: true }).tipo, 'conocer_salir');
  assert.equal(interpretar('para mañana necesito el informe').tipo, 'cerebro');
});

/*
 * P2 (auditoría del 4-oct): en la llamada, «cállate» calla TAMBIÉN la salida de la llamada (compa/sesionVoz.ts,
 * callarSalida); la voz de la mesa (lib/tts.ts) no es el audio de la llamada. Callar no cuelga ni toca la tarea.
 */
function telefono(o: { enLlamada: boolean; callarLlamada?: 'ok' | 'falla' | 'sin' }) {
  const tocado: string[] = [];
  const p = controlesMovil.puertosTelefono({
    pararVozMesa: () => void tocado.push('voz-mesa'),
    cerrarBoca: () => void tocado.push('boca'),
    soltarPausaMicrofono: () => void tocado.push('soltar-mic-mesa'),
    enLlamada: () => o.enLlamada,
    colgar: () => (tocado.push('colgar'), { ok: true }),
    api: async (ruta: string) => (tocado.push(`api:${ruta}`), { configurada: true, actual: null }),
    ...(o.callarLlamada === 'sin'
      ? {}
      : { callarLlamada: () => (tocado.push('salida-llamada'), o.callarLlamada === 'falla' ? { ok: false, detalle: 'No pude callar la llamada.' } : { ok: true }) }),
  } as any);
  return { p, tocado };
}

test('P2 móvil: en la llamada, detener el audio calla la salida de la llamada además de la voz de la mesa; no cuelga ni toca la tarea', async () => {
  let t = telefono({ enLlamada: true, callarLlamada: 'ok' });
  const r = await aplicarAccionControl({ tipo: 'detener_audio' }, t.p);
  assert.equal(r.ok, true);
  assert.deepEqual(t.tocado, ['voz-mesa', 'boca', 'salida-llamada'], 'el micrófono de la llamada no se toca; tampoco la tarea');
  // Sin llamada: solo la voz de la mesa (y se suelta su pausa del micrófono), nunca la llamada.
  t = telefono({ enLlamada: false, callarLlamada: 'ok' });
  await aplicarAccionControl({ tipo: 'detener_audio' }, t.p);
  assert.deepEqual(t.tocado, ['voz-mesa', 'boca', 'soltar-mic-mesa']);
  // La llamada no se pudo callar: se dice (no es un «listo» de más).
  t = telefono({ enLlamada: true, callarLlamada: 'falla' });
  const f = await aplicarAccionControl({ tipo: 'detener_audio' }, t.p);
  assert.deepEqual([f.ok, f.detalle], [false, 'No pude callar la llamada.']);
  t = telefono({ enLlamada: true, callarLlamada: 'sin' });
  const s = await aplicarAccionControl({ tipo: 'detener_audio' }, t.p);
  assert.equal(s.ok, false, 'sin cómo callar la llamada, no se finge');
});
