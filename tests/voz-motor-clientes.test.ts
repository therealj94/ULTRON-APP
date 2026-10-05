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
import * as VM from '../mobile/src/compa/vinculoMotor';
import * as VW from '../src/03-voz/vinculoMotor';
import { motivoFalloVoz } from '../mobile/src/compa/duenoAudio';

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
      onVincular: (g, pase, conversacion) => void vinculos.push(`${g}:${pase}:${conversacion}`),
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

/* ------------------------------------------------------------------ revisión 14: lo que contesta el vínculo */

/** La web con el motor nuevo y un servidor que contesta el vínculo con `respuestas` (en orden; la última se repite). */
function webVinculo(respuestas: { status: number; json: any }[]) {
  const estados: { e: string; d?: string }[] = [];
  let vinculos = 0;
  let colgada = 0;
  let opciones: OpcionesSesion | null = null;
  const c = new ConversacionEnVivo({
    pedir: async (ruta) => {
      if (ruta === '/api/voz/agente') return { ok: true, status: 200, json: { token: 'tok-se', pase: 'pase-r14', motor: 'speech-engine', primerMensaje: 'Aquí estoy.' } };
      if (ruta === '/api/voz/motor/vincular') {
        const r = respuestas[Math.min(vinculos++, respuestas.length - 1)];
        return { ok: r.status >= 200 && r.status < 300, ...r };
      }
      return { ok: true, status: 200, json: { ok: true } };
    },
    abrirSesion: async (o) => {
      opciones = o;
      return { endSession: () => void colgada++ };
    },
    onEstado: (e, d) => void estados.push({ e, d }),
    onMensaje: () => undefined,
  });
  return { c, estados, vinculos: () => vinculos, colgada: () => colgada, sdk: () => opciones! };
}
const esperarQue = async (f: () => boolean, ms = 4_000) => {
  const hasta = Date.now() + ms;
  while (!f()) {
    if (Date.now() > hasta) throw new Error('no pasó a tiempo');
    await new Promise((r) => setTimeout(r, 10));
  }
};

test('web (r14): el vínculo contesta 410 honesto (la llamada ya se cerró): la llamada se termina bien y dice por qué', async () => {
  const w = webVinculo([{ status: 410, json: { error: 'esa llamada ya se cerró (el vínculo es de un solo uso): empieza otra', codigo: 'llamada-cerrada', honesto: true } }]);
  assert.equal(await w.c.abrir({ avatar: 'aura', idioma: 'es' }), true);
  w.sdk().onConnect!({ conversationId: 'conv_r14_web' });
  await esperarQue(() => w.estados.some((x) => x.e === 'error'));
  assert.equal(w.c.estado(), 'error');
  assert.match(w.estados.at(-1)!.d!, /se cerró/);
  assert.equal(w.colgada(), 1, 'la sesión del SDK se cuelga, no queda abierta y muda');
  assert.equal(w.vinculos(), 1, 'un «no» honesto no se reintenta');
});

test('web (r14): un 404 sin cuerpo (un proxy) no es «no existe»: se reintenta y la llamada sigue', async () => {
  const w = webVinculo([{ status: 404, json: null }, { status: 404, json: null }, { status: 200, json: { ok: true, honesto: true } }]);
  assert.equal(await w.c.abrir({ avatar: 'aura', idioma: 'es' }), true);
  w.sdk().onConnect!({ conversationId: 'conv_r14_proxy' });
  await esperarQue(() => w.vinculos() === 3);
  await tic();
  assert.equal(
    w.estados.some((x) => x.e === 'error'),
    false,
    'no se terminó por un 404 que no es del servidor'
  );
  assert.equal(w.c.estado(), 'escuchando');
  assert.equal(w.colgada(), 0);
  w.c.cerrar();
});

test('web (r14): el 404 honesto del servidor (no hay llamada esperando) sí termina la llamada', async () => {
  const w = webVinculo([{ status: 404, json: { error: 'no hay una llamada esperando esa conversación', codigo: 'sin-llamada', honesto: true } }]);
  await w.c.abrir({ avatar: 'aura', idioma: 'es' });
  w.sdk().onConnect!({ conversationId: 'conv_r14_nadie' });
  await esperarQue(() => w.estados.some((x) => x.e === 'error'));
  assert.equal(w.vinculos(), 1);
});

/** El teléfono con el motor nuevo; `vincular` es lo que devuelve el VozProvider (el resultado del vínculo). */
function telefonoVinculo(vincular: () => Promise<any>) {
  let ops: OpcionesConv | null = null;
  const estados: { e: string; d?: string }[] = [];
  let colgada = 0;
  const conv: ConvMin = {
    startSession: (x) => void (ops = x),
    endSession: () => void colgada++,
    setVolume: () => undefined,
    getOutputVolume: () => 0,
    getInputVolume: () => 0,
    getOutputByteFrequencyData: () => new Uint8Array(4),
  };
  const cerrar = abrirSesionVoz({
    gen: 7,
    conv: () => conv,
    permiso: async () => ({ token: 'tok-se', pase: 'pase-tel', motor: 'speech-engine', primerMensaje: 'Aquí estoy.' }),
    cbs: () => ({
      onEstado: (_g, e, d) => void estados.push({ e, d }),
      onMensaje: () => undefined,
      onInterrupcion: () => undefined,
      onNiveles: () => undefined,
      onVincular: () => vincular(),
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
  return { ops: () => ops!, estados, colgada: () => colgada, cerrar };
}

test('teléfono (r14): el servidor contesta 410/409 honesto al vínculo → la sesión termina como error, con el porqué', async () => {
  for (const [status, codigo, error] of [
    [410, 'llamada-cerrada', 'esa llamada ya se cerró (el vínculo es de un solo uso): empieza otra'],
    [409, 'ocupada', 'esa conversación ya está vinculada'],
  ] as const) {
    const t = telefonoVinculo(() => VM.vincularConReintentos(async () => ({ status, json: { error, codigo, honesto: true } }), { dormir: async () => undefined }));
    await tic();
    t.ops().onConnect!({ conversationId: `conv_tel_${status}` });
    await esperarQue(() => t.estados.some((x) => x.e === 'error'));
    const fin = t.estados.at(-1)!;
    assert.equal(fin.e, 'error', String(status));
    assert.match(fin.d!, /vínculo del motor/);
    assert.equal(t.colgada(), 1, `${status}: se le pide el fin al SDK`);
    assert.match(motivoFalloVoz(fin.d), /se cerró antes de quedar atada/, 'a la persona: qué pasó, no «el servidor no tiene la conversación»');
    t.cerrar();
  }
});

test('teléfono (r14): un 404 sin cuerpo (un proxy) o sin red no termina la llamada: es pasajero y se reintenta', async () => {
  let pedidos = 0;
  const t = telefonoVinculo(() =>
    VM.vincularConReintentos(
      async () => {
        pedidos++;
        return pedidos === 1 ? { status: 404, json: {} } : pedidos === 2 ? { status: 0, json: null } : { status: 502, json: null };
      },
      { dormir: async () => undefined }
    )
  );
  await tic();
  t.ops().onConnect!({ conversationId: 'conv_tel_proxy' });
  await esperarQue(() => pedidos === 3);
  await tic();
  await tic();
  assert.equal(
    t.estados.some((x) => x.e === 'error'),
    false
  );
  assert.equal(t.estados.at(-1)!.e, 'escuchando');
  assert.equal(t.colgada(), 0);
  t.cerrar();
});

test('leerVinculo: solo el cuerpo honesto del servidor concluye; el número solo no (teléfono y web, la misma regla)', () => {
  for (const L of [VM.leerVinculo, VW.leerVinculo]) {
    assert.deepEqual(L(200, { ok: true, honesto: true }), { que: 'ok' });
    assert.equal(L(404, null).que, 'transitorio', 'un 404 sin cuerpo (proxy) no es «no existe»');
    assert.equal(L(404, {}).que, 'transitorio');
    assert.equal(L(404, { error: 'Not Found' }).que, 'transitorio', 'un cuerpo que no es el nuestro');
    assert.equal(L(404, { error: 'x', codigo: 'sin-llamada' }).que, 'transitorio', 'sin `honesto` no concluye');
    assert.deepEqual(L(404, { error: 'no hay una llamada esperando esa conversación', codigo: 'sin-llamada', honesto: true }), { que: 'fin', codigo: 'sin-llamada', motivo: 'no hay una llamada esperando esa conversación' });
    assert.equal(L(410, { error: 'cerrada', codigo: 'llamada-cerrada', honesto: true }).que, 'fin');
    assert.equal(L(409, { error: 'ocupada', codigo: 'ocupada', honesto: true }).que, 'fin');
    assert.equal(L(500, { error: 'x', codigo: 'ocupada', honesto: true }).que, 'transitorio', 'un 5xx es pasajero');
    assert.equal(L(429, { error: 'demasiadas' }).que, 'transitorio');
    assert.equal(L(0, null).que, 'transitorio');
    assert.equal(L(200, '<html>').que, 'transitorio', 'un 200 que no es el nuestro tampoco confirma');
  }
  assert.deepEqual(VW.CODIGOS_FIN_VINCULO, VM.CODIGOS_FIN_VINCULO, 'la web y el teléfono conocen los mismos códigos');
});

test('vincularConReintentos: reintenta lo pasajero (con su espera) y para en la primera respuesta clara', async () => {
  const esperas: number[] = [];
  let n = 0;
  const r = await VM.vincularConReintentos(async () => (++n < 3 ? { status: 404, json: null } : { status: 200, json: { ok: true } }), { dormir: async (ms) => void esperas.push(ms) });
  assert.deepEqual(r, { que: 'ok' });
  assert.equal(n, 3);
  assert.deepEqual(esperas, [1_000, 1_000]);
  n = 0;
  const f = await VM.vincularConReintentos(async () => (n++, { status: 410, json: { error: 'cerrada', codigo: 'llamada-cerrada', honesto: true } }), { dormir: async () => undefined });
  assert.equal(f.que, 'fin');
  assert.equal(n, 1);
  n = 0;
  const caida = await VM.vincularConReintentos(
    async () => {
      n++;
      throw new Error('sin red');
    },
    { dormir: async () => undefined }
  );
  assert.equal(caida.que, 'transitorio');
  assert.equal(n, 3, 'como mucho 3 intentos');
  n = 0;
  await VM.vincularConReintentos(async () => (n++, { status: 404, json: null }), { dormir: async () => undefined, sigue: () => n < 1 });
  assert.equal(n, 1, 'si la llamada ya no es la de ahora, no se sigue pidiendo');
});
