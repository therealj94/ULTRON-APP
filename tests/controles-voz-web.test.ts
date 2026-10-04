/**
 * AUR10 en la web (src/03-voz/controles.ts) y AUR14.5: los mismos controles separados que el teléfono, con
 * lo que la web tiene: callar su voz (hablar.ts), colgar la conversación en vivo (enVivo.ts) y la tarea de
 * su computadora por las mismas rutas. Lo que la web no tiene (silenciar el micrófono de la conversación en
 * vivo) se dice, no se finge.
 *
 * Y la conversación en vivo de la web: colgar en cualquier fase deja los timers en cero, cuelga la sesión
 * del SDK y suelta el pase una vez; mientras está abierta, la PWA no recarga encima (trabajo activo).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
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
  const enVivo = { estado: () => estadoVivo, cerrar: () => (tocado.push('colgar'), (estadoVivo = 'cerrada')) };
  const f = pedirFalso({ configurada: true, capacidades: ['pausar'], actual: { id: 't-1', estado: 'trabajando' } });
  const p = puertosWeb({ callar: () => tocado.push('callar'), enVivo, pedir: f.pedir });
  assert.equal((await ejecutarControl('detener_audio', p)).ok, true);
  assert.deepEqual(tocado, ['callar']);
  assert.equal(f.llamadas.length, 0);
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
