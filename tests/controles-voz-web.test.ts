/**
 * AUR10 en la web (src/03-voz/controles.ts) y AUR14.5: los mismos controles separados que el teléfono, con
 * lo que la web tiene: callar su voz (hablar.ts), colgar la conversación en vivo (enVivo.ts) y la tarea de
 * su computadora por las mismas rutas. P2 (auditoría del 4-oct): silenciar, detener audio y colgar van a la
 * sesión de llamada REAL; el TTS de la mesa no es el audio de la llamada. Lo que el SDK no sepa hacer se
 * dice y no se anuncia, no se finge.
 *
 * Y la conversación en vivo de la web: colgar en cualquier fase deja los timers en cero, cuelga la sesión
 * del SDK y suelta el pase una vez; mientras está abierta, la PWA no recarga encima (trabajo activo).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as controlesWeb from '../src/03-voz/controles';
import { puertosWeb, tareaWeb, type PedirWeb } from '../src/03-voz/controles';
import { ejecutarControl, interpretarControl } from '../lib/controles-voz';
import { ConversacionEnVivo, type OpcionesSesion } from '../src/03-voz/enVivo';
import { _olvidarTrabajos, trabajoActivo } from '../src/10-infra/trabajoActivo';

function pedirFalso(estado: any, o: { fase?: string } = {}) {
  const llamadas: Array<{ ruta: string; init?: any }> = [];
  const pedir: PedirWeb = async (ruta, init) => {
    llamadas.push({ ruta, init });
    if (ruta === '/api/computadora') return { ok: true, status: 200, json: estado };
    return { ok: true, status: 200, json: { ok: true, fase: o.fase ?? null } };
  };
  return { pedir, llamadas };
}

test('la tarea desde la web: las mismas rutas y las mismas negativas honestas que el teléfono', async () => {
  const viva = { configurada: true, capacidades: ['pausar', 'control'], actual: { id: 't-9', estado: 'trabajando' } };
  let f = pedirFalso(viva);
  assert.deepEqual(await tareaWeb('cancelar', f.pedir), { ok: true });
  assert.deepEqual(f.llamadas.map((l) => l.ruta), ['/api/computadora', '/api/computadora/tareas/t-9/parar']);
  f = pedirFalso(viva);
  await tareaWeb('tomar', f.pedir);
  assert.equal(f.llamadas[1].ruta, '/api/computadora/tareas/t-9/control');
  assert.deepEqual(JSON.parse(f.llamadas[1].init.body), { tomar: true });
  f = pedirFalso({ configurada: true, actual: null });
  const sin = await tareaWeb('cancelar', f.pedir);
  assert.equal(sin.ok, false);
  assert.equal(f.llamadas.length, 1, 'sin tarea no se llama a ninguna ruta');
  f = pedirFalso({ ...viva, capacidades: [] });
  assert.equal((await tareaWeb('pausar', f.pedir)).ok, false);
});

test('los puertos de la web: callar no cuelga ni toca la tarea; colgar no toca la tarea; el micrófono, honesto', async () => {
  const tocado: string[] = [];
  let estadoVivo = 'escuchando';
  // P2: callar con la llamada abierta calla TAMBIÉN la salida de la llamada (el TTS de la mesa no es su audio).
  const enVivo = {
    estado: () => estadoVivo,
    cerrar: () => (tocado.push('colgar'), (estadoVivo = 'cerrada')),
    callarSalida: () => (tocado.push('callar-llamada'), { ok: true }),
  };
  const f = pedirFalso({ configurada: true, capacidades: ['pausar'], actual: { id: 't-1', estado: 'trabajando' } });
  const p = puertosWeb({ callar: () => tocado.push('callar'), enVivo, pedir: f.pedir });
  assert.equal((await ejecutarControl('detener_audio', p)).ok, true);
  assert.deepEqual(tocado, ['callar', 'callar-llamada']);
  assert.equal(f.llamadas.length, 0);
  tocado.splice(0, tocado.length, 'callar');
  assert.equal((await ejecutarControl('colgar', p)).ok, true);
  assert.deepEqual(tocado, ['callar', 'colgar']);
  assert.equal(f.llamadas.length, 0, 'colgar no toca la tarea');
  const otra = await ejecutarControl('colgar', p);
  assert.equal(otra.ok, false, 'sin conversación en vivo no hay qué colgar');
  const mic = await ejecutarControl('silenciar_mic', p);
  assert.equal(mic.ok, false);
  assert.match(mic.detalle!, /micr/i);
  assert.equal((await ejecutarControl('cancelar_tarea', p)).ok, true);
  assert.deepEqual(tocado, ['callar', 'colgar'], 'cancelar la tarea no calla ni cuelga');
  // Y la frase, como en todas partes.
  assert.deepEqual(interpretarControl('para', { audio: true, tarea: true })?.tipo, 'aclarar');
});

/* ── la conversación en vivo de la web: recursos al colgar ──────────────────────────────────── */

/** setTimeout/clearTimeout contados (los plazos de la apertura). */
function contarTimers(t: { after: (f: () => void) => void }) {
  const real = { set: globalThis.setTimeout, clear: globalThis.clearTimeout };
  const vivos = new Set<unknown>();
  (globalThis as any).setTimeout = (f: () => void, ms?: number) => {
    const id = real.set(() => {
      vivos.delete(id);
      f();
    }, ms);
    vivos.add(id);
    return id;
  };
  (globalThis as any).clearTimeout = (id: unknown) => {
    vivos.delete(id);
    real.clear(id as any);
  };
  t.after(() => {
    globalThis.setTimeout = real.set;
    globalThis.clearTimeout = real.clear;
  });
  return { vivos: () => vivos.size };
}

function armar(o: { permiso?: Promise<any> } = {}) {
  const cerrados: string[] = [];
  let sesiones = 0;
  let opciones: OpcionesSesion | null = null;
  let resolverSesion!: (s: { endSession: () => void }) => void;
  const c = new ConversacionEnVivo({
    pedir: async (ruta, cuerpo: any) => {
      if (ruta.endsWith('/cerrar')) {
        cerrados.push(cuerpo.pase);
        return { ok: true, status: 200, json: {} };
      }
      return o.permiso ? o.permiso : { ok: true, status: 200, json: { token: 'tok', pase: 'pase-w' } };
    },
    abrirSesion: (x) => {
      opciones = x;
      sesiones += 1;
      return new Promise((r) => (resolverSesion = r));
    },
    onEstado: () => undefined,
    onMensaje: () => undefined,
  });
  const sesion = { endSession: () => void (sesiones -= 1) };
  return { c, cerrados, sesiones: () => sesiones, sdk: () => opciones!, conectar: () => resolverSesion(sesion) };
}

const tic = () => new Promise((r) => setImmediate(r));

test('web en vivo: colgar en cada fase deja cero timers y cero sesiones, y suelta el pase una vez', async (t) => {
  const timers = contarTimers(t);
  _olvidarTrabajos();
  // 1) esperando el permiso
  let resolver!: (v: any) => void;
  let a = armar({ permiso: new Promise((r) => (resolver = r)) });
  const abriendo = a.c.abrir({ avatar: 'aura', idioma: 'es' });
  assert.ok(timers.vivos() > 0, 'los plazos corren');
  assert.deepEqual(trabajoActivo(), ['voz-en-vivo'], 'abriendo: la PWA no recarga encima');
  a.c.cerrar();
  resolver({ ok: true, status: 200, json: { token: 't', pase: 'tarde' } });
  assert.equal(await abriendo, false);
  await tic();
  assert.equal(timers.vivos(), 0);
  assert.equal(a.sesiones(), 0);
  assert.deepEqual(a.cerrados, ['tarde'], 'el pase que llegó tarde se suelta');
  assert.deepEqual(trabajoActivo(), []);
  // 2) conectando (la sesión del SDK todavía no aparece)
  a = armar();
  const p2 = a.c.abrir({ avatar: 'aura', idioma: 'es' });
  await tic();
  assert.equal(a.sesiones(), 1);
  a.c.cerrar();
  a.conectar();
  assert.equal(await p2, false);
  await tic();
  assert.deepEqual([timers.vivos(), a.sesiones()], [0, 0], 'la sesión que apareció tarde se colgó');
  assert.deepEqual(a.cerrados, ['pase-w']);
  // 3) conectada
  a = armar();
  const p3 = a.c.abrir({ avatar: 'aura', idioma: 'es' });
  await tic();
  a.conectar();
  assert.equal(await p3, true);
  a.sdk().onConnect!();
  assert.equal(timers.vivos(), 0, 'conectada: los plazos se apagaron');
  assert.deepEqual(trabajoActivo(), ['voz-en-vivo']);
  a.c.cerrar();
  await tic();
  assert.deepEqual([timers.vivos(), a.sesiones()], [0, 0]);
  assert.deepEqual(a.cerrados, ['pase-w']);
  assert.deepEqual(trabajoActivo(), []);
  // 4) tras un error
  a = armar();
  const p4 = a.c.abrir({ avatar: 'aura', idioma: 'es' });
  await tic();
  a.conectar();
  await p4;
  a.sdk().onError!('Server error');
  a.c.cerrar();
  await tic();
  assert.deepEqual([timers.vivos(), a.sesiones()], [0, 0]);
  assert.deepEqual(a.cerrados, ['pase-w'], 'el pase, una sola vez');
});

/* ── P2: los controles de la web, conectados a la sesión de llamada real ─────────────────────── */

/** Una conversación en vivo real (enVivo.ts) con un SDK de mentira que cuenta micrófono, volumen y fin. */
function llamadaReal(o: { sinMute?: boolean } = {}) {
  const sdk = { opciones: null as OpcionesSesion | null, mic: [] as boolean[], volumen: [] as number[], fin: 0 };
  const mensajes: string[] = [];
  const cerrados: string[] = [];
  const c = new ConversacionEnVivo({
    pedir: async (ruta, cuerpo: any) => {
      if (ruta.endsWith('/cerrar')) return (cerrados.push(cuerpo.pase), { ok: true, status: 200, json: {} });
      return { ok: true, status: 200, json: { token: 'tok', pase: 'pase-c' } };
    },
    abrirSesion: async (x) => {
      sdk.opciones = x;
      return {
        endSession: () => void sdk.fin++,
        setVolume: ({ volume }: { volume: number }) => void sdk.volumen.push(volume),
        ...(o.sinMute ? {} : { setMicMuted: (m: boolean) => void sdk.mic.push(m) }),
      };
    },
    onEstado: () => undefined,
    onMensaje: (q, t) => mensajes.push(`${q}:${t}`),
  });
  return { c, sdk, mensajes, cerrados };
}

test('P2 web: silenciar sin colgar y volver a escuchar; detener audio calla la llamada (y aparte el TTS); colgar no toca la tarea', async () => {
  const l = llamadaReal();
  await l.c.abrir({ avatar: 'aura', idioma: 'es' });
  l.sdk.opciones!.onConnect!();
  l.sdk.opciones!.onModeChange!({ mode: 'speaking' });
  let ttsCallado = 0;
  let turnosCortados = 0;
  const f = pedirFalso({ configurada: true, capacidades: ['pausar'], actual: { id: 't-1', estado: 'trabajando' } });
  const p = puertosWeb({ callar: () => void ttsCallado++, cortarTurno: () => void turnosCortados++, enVivo: l.c, pedir: f.pedir });

  // Silenciar: el micrófono de ESA sesión, sin colgar.
  const mute = await ejecutarControl('silenciar_mic', p);
  assert.deepEqual([mute.ok, mute.hechos], [true, ['mic']]);
  assert.deepEqual(l.sdk.mic, [true]);
  assert.equal(l.sdk.fin, 0, 'silenciar no cuelga');
  assert.equal(l.c.estado(), 'hablando');
  // Volver a escuchar.
  const unmute = await ejecutarControl('activar_mic', p);
  assert.equal(unmute.ok, true);
  assert.deepEqual(l.sdk.mic, [true, false]);
  l.sdk.opciones!.onMessage!({ source: 'user', message: 'te hablo de nuevo' });
  assert.deepEqual(l.mensajes, ['persona:te hablo de nuevo']);

  // Detener audio: lo que suena en la LLAMADA se calla (volumen 0); el TTS de la mesa se calla aparte.
  const stop = await ejecutarControl('detener_audio', p);
  assert.equal(stop.ok, true);
  assert.deepEqual(l.sdk.volumen, [0], 'la salida de la llamada se calla');
  assert.equal(ttsCallado, 1, 'el TTS ordinario se calla aparte (no es el audio de la llamada)');
  assert.equal(l.sdk.fin, 0, 'callar no cuelga');
  // La primera frase siguiente se oye.
  l.sdk.opciones!.onModeChange!({ mode: 'listening' });
  assert.deepEqual(l.sdk.volumen, [0, 1]);
  l.sdk.opciones!.onModeChange!({ mode: 'speaking' });
  l.sdk.opciones!.onMessage!({ source: 'ai', message: 'la siguiente' });
  assert.deepEqual(l.sdk.volumen, [0, 1]);
  assert.equal(l.mensajes.at(-1), 'aura:la siguiente');

  // Interrumpir: calla la salida y corta el turno; la llamada sigue.
  const corte = await ejecutarControl('interrumpir', p);
  assert.deepEqual([corte.ok, corte.hechos], [true, ['audio', 'turno']]);
  assert.deepEqual(l.sdk.volumen, [0, 1, 0]);
  assert.equal(turnosCortados, 1);
  assert.equal(l.c.ocupada(), true);

  assert.equal(f.llamadas.length, 0, 'silenciar, callar e interrumpir no tocan la tarea durable');
  // Colgar: cierra la llamada; la tarea sigue como estaba.
  assert.equal((await ejecutarControl('colgar', p)).ok, true);
  assert.equal(l.sdk.fin, 1);
  assert.deepEqual(l.cerrados, ['pase-c']);
  assert.equal(f.llamadas.length, 0, 'colgar no cancela la tarea durable');
  // Tras colgar, el micrófono de la sesión vieja ya no se toca.
  assert.equal((await ejecutarControl('silenciar_mic', p)).ok, false);
  assert.deepEqual(l.sdk.mic, [true, false]);
});

test('P2 web: sin llamada, detener audio es solo el TTS normal y no toca ninguna llamada', async () => {
  const l = llamadaReal();
  let ttsCallado = 0;
  const p = puertosWeb({ callar: () => void ttsCallado++, enVivo: l.c });
  const r = await ejecutarControl('detener_audio', p);
  assert.equal(r.ok, true);
  assert.equal(ttsCallado, 1);
  assert.deepEqual(l.sdk.volumen, []);
  const m = await ejecutarControl('silenciar_mic', p);
  assert.equal(m.ok, false);
  assert.match(m.detalle!, /conversación en vivo/);
});

test('P2 web (sonda de la auditoría): con la llamada hablando, callar el TTS no se cuenta como callar la llamada', async () => {
  // El doble del arnés: una llamada que solo sabe su estado y colgar (nada de silenciar ni de callar su salida).
  let ttsCallado = 0;
  let colgadas = 0;
  const p = puertosWeb({ callar: () => void ttsCallado++, enVivo: { estado: () => 'hablando', cerrar: () => void colgadas++ } });
  const mute = await ejecutarControl('silenciar_mic', p);
  assert.equal(mute.ok, false, 'no sabe silenciar: lo dice');
  const stop = await ejecutarControl('detener_audio', p);
  assert.equal(stop.ok, false, 'callar la voz de la mesa NO es callar la llamada: no es un «listo»');
  assert.match(stop.detalle!, /llamada/);
  assert.equal(ttsCallado, 1, 'el TTS ordinario sí se calló');
  assert.equal(colgadas, 0, 'callar nunca cuelga');
});

test('P2 web: si el SDK no sabe silenciar, silenciar_mic lo dice y el botón NO se anuncia', async () => {
  const l = llamadaReal({ sinMute: true });
  await l.c.abrir({ avatar: 'aura', idioma: 'es' });
  l.sdk.opciones!.onConnect!();
  const p = puertosWeb({ callar: () => undefined, enVivo: l.c });
  const r = await ejecutarControl('silenciar_mic', p);
  assert.equal(r.ok, false);
  assert.equal(l.sdk.fin, 0);
  const b = controlesWeb.botonMicrofonoWeb({ vivoAbierta: true, silenciable: l.c.puedeSilenciar(), silenciado: false, micEnabled: true, escuchando: false });
  assert.equal(b.modo, 'no_disponible');
  assert.equal(b.disabled, true);
});

test('P2 web: el botón del micrófono en la llamada silencia la llamada (no el oído de la mesa) cuando se puede', () => {
  const mesa = controlesWeb.botonMicrofonoWeb({ vivoAbierta: false, silenciable: false, silenciado: false, micEnabled: true, escuchando: true });
  assert.deepEqual([mesa.modo, mesa.disabled, mesa.activo], ['mesa', false, true]);
  const enLlamada = controlesWeb.botonMicrofonoWeb({ vivoAbierta: true, silenciable: true, silenciado: false, micEnabled: true, escuchando: false });
  assert.deepEqual([enLlamada.modo, enLlamada.disabled, enLlamada.activo], ['llamada', false, true]);
  assert.match(enLlamada.etiqueta, /no cuelga/);
  const silenciada = controlesWeb.botonMicrofonoWeb({ vivoAbierta: true, silenciable: true, silenciado: true, micEnabled: true, escuchando: false });
  assert.deepEqual([silenciada.modo, silenciada.activo], ['llamada', false]);
  assert.match(silenciada.etiqueta, /volver a escuchar/i);
});

test('P2 web: App cablea la llamada a los controles, al botón del micrófono, a la salida de la cuenta y al desmontar', () => {
  const app = fs.readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
  assert.match(app, /botonMicrofonoWeb\(/, 'el botón del micrófono usa la regla compartida');
  assert.doesNotMatch(app, /onClick=\{alternarMic\} disabled=\{vivoAbierta\}/, 'el botón ya no se apaga a ciegas durante la llamada');
  assert.match(app, /silenciarMic\(/, 'el botón silencia la sesión de llamada real');
  assert.match(app, /onControles:/, 'la interfaz se entera de lo que la llamada sabe hacer');
  // Callar con la llamada abierta pasa por los puertos (que callan la salida de la llamada), no solo por el TTS.
  assert.doesNotMatch(app, /if \(c === 'detener_audio' \|\| c === 'interrumpir'\) \{\s*callarTodo\(\);\s*turnoCallado\.current = turnoEnCurso\.current;\s*continue;/);
  // La salida de la cuenta y el desmontaje cuelgan la llamada (la misma terminación única).
  assert.match(app, /genCuenta\.current\+\+;[\s\S]{0,600}vivoRef\.current\?\.cerrar\(\)/);
  assert.match(app, /useEffect\(\(\) => \(\) => vivoRef\.current\?\.cerrar\(\), \[\]\)/);
});
