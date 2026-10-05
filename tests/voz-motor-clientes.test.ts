/**
 * Los clientes y el motor nuevo de la llamada (prototipo de Speech Engine, docs/voz/SPEECH-ENGINE.md).
 *
 * El teléfono y la web eligen el camino por lo que contesta el servidor: SOLO si /api/voz/agente trae
 * `motor: 'speech-engine'` le piden al SDK la primera frase (`overrides.agent.firstMessage`) y, al
 * conectar, atan la conversación al pase (/api/voz/motor/vincular). Sin eso (el interruptor apagado) las
 * opciones del SDK y las peticiones son EXACTAMENTE las de siempre.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { ConversacionEnVivo, type OpcionesSesion } from '../src/03-voz/enVivo';
import { abrirSesionVoz, type ConvMin, type OpcionesConv } from '../mobile/src/compa/sesionVoz';
import { Precalentador } from '../mobile/src/compa/permiso';

/* ------------------------------------------------------------------ la web */

function web(json: any, id = 'conv_web_1') {
  const pedidos: { ruta: string; cuerpo: any }[] = [];
  let opciones: OpcionesSesion | null = null;
  const c = new ConversacionEnVivo({
    pedir: async (ruta, cuerpo) => {
      pedidos.push({ ruta, cuerpo });
      return ruta === '/api/voz/agente' ? { ok: true, status: 200, json } : { ok: true, status: 200, json: { ok: true } };
    },
    abrirSesion: async (o) => {
      opciones = o;
      return { endSession: () => undefined, getId: () => id };
    },
    onEstado: () => undefined,
    onMensaje: () => undefined,
  });
  return { c, pedidos, sdk: () => opciones! };
}
const tic = () => new Promise((r) => setImmediate(r));

test('web, interruptor apagado: las mismas opciones al SDK y ninguna petición nueva', async () => {
  const w = web({ token: 'tok', pase: 'pase-1', agente: 'agent_x' });
  assert.equal(await w.c.abrir({ avatar: 'aura', idioma: 'es' }), true);
  w.sdk().onConnect!({ conversationId: 'conv_web_1' });
  await tic();
  assert.deepEqual(Object.keys(w.sdk()), ['conversationToken', 'connectionType', 'dynamicVariables', 'onConnect', 'onModeChange', 'onMessage', 'onError', 'onDisconnect']);
  assert.deepEqual(w.sdk().dynamicVariables, { pase: 'pase-1' });
  assert.deepEqual(
    w.pedidos.map((p) => p.ruta),
    ['/api/voz/agente'],
    'sin vínculo'
  );
  w.c.cerrar();
});

test('web, motor nuevo: primera frase al SDK y la conversación atada al pase una sola vez', async () => {
  const w = web({ token: 'tok-se', pase: 'pase-2', agente: 'seng_x', motor: 'speech-engine', primerMensaje: 'Aquí estoy. Te escucho.' });
  assert.equal(await w.c.abrir({ avatar: 'aura', idioma: 'es' }), true);
  assert.deepEqual(w.sdk().overrides, { agent: { firstMessage: 'Aquí estoy. Te escucho.' } });
  assert.deepEqual(w.sdk().dynamicVariables, { pase: 'pase-2' }, 'el pase sigue viajando como variable (X-Pase)');
  w.sdk().onConnect!({ conversationId: 'conv_web_1' });
  await tic();
  const vinculos = w.pedidos.filter((p) => p.ruta === '/api/voz/motor/vincular');
  assert.deepEqual(vinculos, [{ ruta: '/api/voz/motor/vincular', cuerpo: { pase: 'pase-2', conversacion: 'conv_web_1' } }]);
  w.c.cerrar();
});

test('web: un primerMensaje sin motor no cambia nada (lo decide el servidor, no un campo suelto)', async () => {
  const w = web({ token: 'tok', pase: 'pase-3', primerMensaje: 'Hola' });
  await w.c.abrir({ avatar: 'aura', idioma: 'es' });
  assert.equal('overrides' in w.sdk(), false);
  w.c.cerrar();
});

/* ------------------------------------------------------------------ el teléfono */

function telefono(permiso: { token: string; pase: string; motor?: 'speech-engine'; primerMensaje?: string }) {
  let ops: OpcionesConv | null = null;
  const vinculos: string[] = [];
  const conv: ConvMin = {
    startSession: (x) => void (ops = x),
    endSession: () => undefined,
    setVolume: () => undefined,
    getOutputVolume: () => 0,
    getInputVolume: () => 0,
    getOutputByteFrequencyData: () => new Uint8Array(4),
  };
  const cerrar = abrirSesionVoz({
    gen: 3,
    conv: () => conv,
    permiso: async () => permiso,
    cbs: () => ({
      onEstado: () => undefined,
      onMensaje: () => undefined,
      onInterrupcion: () => undefined,
      onNiveles: () => undefined,
      onVincular: (g, pase, conversacion) => vinculos.push(`${g}:${pase}:${conversacion}`),
    }),
    silenciada: () => false,
    abierta: { current: false },
    hablando: { current: false },
    reloj: () => 0,
    intervalo: () => 1,
    limpiarIntervalo: () => undefined,
    boca: { seguir: (s) => s, cortar: () => undefined },
    envolventeLibre: () => () => 0,
    senal: { quiereForma: () => false, espectro: () => undefined, alineacion: () => undefined },
    miga: () => undefined,
    pasoMs: 33,
  });
  return { ops: () => ops!, vinculos, cerrar };
}

test('teléfono, interruptor apagado: las mismas opciones al SDK y sin vínculo', async () => {
  const t = telefono({ token: 'tok', pase: 'pase-1' });
  await tic();
  assert.deepEqual(Object.keys(t.ops()), ['conversationToken', 'connectionType', 'dynamicVariables', 'onConnect', 'onModeChange', 'onMessage', 'onInterruption', 'onAudioAlignment', 'onError', 'onDisconnect']);
  t.ops().onConnect!({ conversationId: 'conv_tel_1' });
  assert.deepEqual(t.vinculos, []);
  t.cerrar();
});

test('teléfono, motor nuevo: primera frase al SDK y la conversación atada al pase', async () => {
  const t = telefono({ token: 'tok-se', pase: 'pase-9', motor: 'speech-engine', primerMensaje: '¡Aquí estoy! Cuéntame.' });
  await tic();
  assert.deepEqual(t.ops().overrides, { agent: { firstMessage: '¡Aquí estoy! Cuéntame.' } });
  assert.deepEqual(t.ops().dynamicVariables, { pase: 'pase-9' });
  t.ops().onConnect!({ conversationId: 'conv_tel_1' });
  assert.deepEqual(t.vinculos, ['3:pase-9:conv_tel_1']);
  t.cerrar();
});

test('el permiso precalentado guarda el motor y la primera frase solo si el servidor dijo motor nuevo', async () => {
  const conMotor = new Precalentador(async () => ({ token: 't', pase: 'p', motor: 'speech-engine', primerMensaje: ' Te escucho. ' }));
  const p1 = await conMotor.tomar('aura', 'es');
  assert.equal(p1.motor, 'speech-engine');
  assert.equal(p1.primerMensaje, 'Te escucho.');
  const sin = new Precalentador(async () => ({ token: 't', pase: 'p', primerMensaje: 'Te escucho.' }));
  const p2 = await sin.tomar('aura', 'es');
  assert.equal('motor' in p2, false);
  assert.equal('primerMensaje' in p2, false);
  const otro = new Precalentador(async () => ({ token: 't', pase: 'p', motor: 'otra-cosa' }));
  assert.equal('motor' in (await otro.tomar('aura', 'es')), false);
});
