/**
 * LOS RECHAZOS DE ELEVENLABS, POR LO QUE DICEN (auditoría del 11-oct, VOZ-07; server/eleven.ts).
 *
 * Antes cualquier 400/404/422 de /with-timestamps apagaba los tiempos del modelo por seis horas, y cualquier 400/422
 * con `previous_request_ids` apagaba el enlace de audio: una voz que no existe o un id vencido dejaban la boca sin
 * tiempos (o las frases sin enlazar) para todos. Ahora:
 *
 *  · se lee la estructura del error (detail/status/code/param/loc/message) y SOLO un rechazo inequívoco de ESE
 *    parámetro se recuerda, por modelo + endpoint + formato, con telemetría;
 *  · un rechazo del parámetro que no es del modelo (un id vencido) o ambiguo se reintenta UNA vez sin él, sin recordar;
 *  · el reintento cabe en el MISMO plazo total de la frase (no otros 15 s);
 *  · un error de otra cosa (la voz no existe) no se reintenta: fallaría igual;
 *  · 429/401/402 nunca multiplican pedidos.
 *
 * ElevenLabs se finge interceptando `fetch`: nada sale de la máquina.
 */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import {
  _olvidarSinEnlace,
  _olvidarSinTiempos,
  _reiniciarFrenoEleven,
  abrirEleven,
  clasificarRechazo,
  enlaceActivo,
  hablarEleven,
  MODELO_ELEVEN,
  telemetriaEleven,
  tiemposDisponibles,
  VOCES_ELEVEN,
} from '../server/eleven';

type Llamada = { url: string; cuerpo: any; senal?: AbortSignal; t: number };
// AbortSignal.timeout no sostiene el proceso (su reloj va sin ref): en el servidor lo sostiene el HTTP; aquí, esto.
const sostener = setInterval(() => undefined, 1000);
after(() => clearInterval(sostener));
const IDS = ['req_previa_000001'];

async function conEleven<T>(responder: (l: Llamada, n: number) => Response | Promise<Response>, fn: (llamadas: Llamada[]) => Promise<T>): Promise<T> {
  const real = globalThis.fetch;
  const antes = process.env.ELEVENLABS_API_KEY;
  const llamadas: Llamada[] = [];
  process.env.ELEVENLABS_API_KEY = 'xi-de-prueba';
  _reiniciarFrenoEleven();
  _olvidarSinTiempos();
  _olvidarSinEnlace();
  globalThis.fetch = (async (entrada: any, init?: any) => {
    const url = String(entrada?.url || entrada);
    if (!url.startsWith('https://api.elevenlabs.io/')) return real(entrada, init);
    const l = { url, cuerpo: typeof init?.body === 'string' ? JSON.parse(init.body) : init?.body, senal: init?.signal, t: Date.now() };
    llamadas.push(l);
    return responder(l, llamadas.length);
  }) as typeof fetch;
  try {
    return await fn(llamadas);
  } finally {
    globalThis.fetch = real;
    if (antes === undefined) delete process.env.ELEVENLABS_API_KEY;
    else process.env.ELEVENLABS_API_KEY = antes;
    _reiniciarFrenoEleven();
    _olvidarSinTiempos();
    _olvidarSinEnlace();
  }
}

const mp3 = () => new Response(new Uint8Array(4000).fill(0xff), { status: 200, headers: { 'Content-Type': 'audio/mpeg', 'request-id': 'req_nueva_000002' } });
const json = (status: number, cuerpo: unknown) => new Response(typeof cuerpo === 'string' ? cuerpo : JSON.stringify(cuerpo), { status, headers: { 'Content-Type': 'application/json' } });
const tipo = (l: Llamada) => (l.url.includes('/with-timestamps') ? 'tiempos' : 'audio');

test('clasificar: por la estructura del error, no por el número', () => {
  // La voz que no existe (422 o 404): es de otra cosa, nunca «el modelo no da tiempos».
  assert.equal(clasificarRechazo(422, JSON.stringify({ detail: { status: 'voice_not_found', message: "A voice with voice_id 'x' was not found." } }), 'timestamps'), 'otro');
  assert.equal(clasificarRechazo(404, JSON.stringify({ detail: { status: 'voice_not_found', message: 'not found' } }), 'previous_request_ids'), 'otro');
  // La validación de FastAPI (detail como lista, con loc): el campo manda.
  assert.equal(clasificarRechazo(422, JSON.stringify({ detail: [{ loc: ['body', 'voice_settings', 'stability'], msg: 'Input should be less than 1', type: 'less_than_equal' }] }), 'timestamps'), 'otro');
  assert.equal(clasificarRechazo(422, JSON.stringify({ detail: [{ loc: ['body', 'previous_request_ids'], msg: 'Request id not found', type: 'value_error' }] }), 'previous_request_ids'), 'parametro');
  // Inequívoco: nombra el parámetro y dice que no se soporta.
  assert.equal(clasificarRechazo(400, JSON.stringify({ detail: 'previous_request_ids not supported' }), 'previous_request_ids'), 'no-soportado');
  assert.equal(clasificarRechazo(422, JSON.stringify({ detail: { status: 'invalid_parameters', param: 'previous_request_ids', message: 'Request stitching is not available for this model.' } }), 'previous_request_ids'), 'no-soportado');
  assert.equal(clasificarRechazo(422, JSON.stringify({ detail: { status: 'model_not_supported' } }), 'timestamps'), 'no-soportado', 'en /with-timestamps, «el modelo no se soporta» habla del endpoint');
  assert.equal(clasificarRechazo(400, JSON.stringify({ detail: { message: 'Timestamps are not supported for this model' } }), 'timestamps'), 'no-soportado');
  // Del parámetro pero no del modelo: un id vencido.
  assert.equal(clasificarRechazo(400, JSON.stringify({ detail: { status: 'invalid_request', message: 'Request req_x in previous_request_ids was not found or expired.' } }), 'previous_request_ids'), 'parametro');
  // Sin nada que leer: ambiguo (se reintenta una vez, no se recuerda).
  assert.equal(clasificarRechazo(400, '', 'timestamps'), 'ambiguo');
  assert.equal(clasificarRechazo(404, '<html>Not Found</html>', 'timestamps'), 'ambiguo');
  assert.equal(clasificarRechazo(422, JSON.stringify({ detail: { status: 'invalid_request' } }), 'previous_request_ids'), 'ambiguo');
  // El freno manda sobre todo lo demás, aunque el cuerpo nombre el parámetro.
  assert.equal(clasificarRechazo(429, JSON.stringify({ detail: { status: 'too_many_concurrent_requests', message: 'previous_request_ids not supported' } }), 'previous_request_ids'), 'pausa');
  assert.equal(clasificarRechazo(401, '{"detail":{"status":"invalid_api_key"}}', 'timestamps'), 'pausa');
  assert.equal(clasificarRechazo(503, 'caído', 'timestamps'), 'transitorio');
});

test('422 por una voz que no existe NO apaga los tiempos del modelo, y no se reintenta (fallaría igual)', async () => {
  await conEleven(
    () => json(422, { detail: { status: 'voice_not_found', message: "A voice with voice_id 'nada' was not found." } }),
    async (llamadas) => {
      const r = await hablarEleven({ texto: 'Hola', voz: 'voz-que-no-existe', tiempos: true });
      assert.equal(r, null, 'sin voz de ElevenLabs: sigue Voicebox');
      assert.equal(tiemposDisponibles(), true, 'los tiempos del modelo siguen');
      assert.deepEqual(llamadas.map(tipo), ['tiempos'], 'un solo pedido');
    }
  );
});

test('400/404 sin estructura: se pide el audio solo UNA vez, sin apagar los tiempos por seis horas', async () => {
  for (const [status, cuerpo] of [
    [404, '<html>Not Found</html>'],
    [400, ''],
  ] as const) {
    await conEleven(
      (l) => (tipo(l) === 'tiempos' ? new Response(cuerpo, { status }) : mp3()),
      async (llamadas) => {
        const r = await hablarEleven({ texto: 'Hola', voz: VOCES_ELEVEN.aura.es, tiempos: true });
        assert.ok(r && r.audio[0] === 0xff, `${status}: el audio de siempre`);
        assert.equal(tiemposDisponibles(), true, `${status}: ambiguo, no se recuerda`);
        assert.deepEqual(llamadas.map(tipo), ['tiempos', 'audio']);
      }
    );
  }
});

test('el rechazo inequívoco de los tiempos se recuerda por modelo (otro modelo sigue pidiéndolos), con telemetría', async () => {
  await conEleven(
    (l) => (tipo(l) === 'tiempos' ? json(422, { detail: { status: 'unsupported_feature', message: `Timestamps are not supported for model ${MODELO_ELEVEN}` } }) : mp3()),
    async (llamadas) => {
      await hablarEleven({ texto: 'Hola', voz: VOCES_ELEVEN.aura.es, tiempos: true });
      assert.equal(tiemposDisponibles(MODELO_ELEVEN), false);
      assert.equal(tiemposDisponibles('eleven_flash_v2_5'), true, 'la clave lleva el modelo');
      const t = telemetriaEleven();
      assert.ok(
        t.capacidadesApagadas.some((c) => c.capacidad === 'timestamps' && c.clave.startsWith(`${MODELO_ELEVEN}|with-timestamps|`) && c.status === 422),
        JSON.stringify(t)
      );
      assert.ok(Object.keys(t.rechazos).some((k) => k.includes('no-soportado')), JSON.stringify(t.rechazos));
      await hablarEleven({ texto: 'Otra', voz: VOCES_ELEVEN.aura.es, tiempos: true });
      assert.deepEqual(llamadas.slice(2).map(tipo), ['audio'], 'no insiste');
    }
  );
});

test('422 propio de previous_request_ids (un id vencido): se reintenta UNA vez sin ids y el enlace sigue para las demás frases', async () => {
  await conEleven(
    (l) => (l.cuerpo.previous_request_ids ? json(422, { detail: [{ loc: ['body', 'previous_request_ids', 0], msg: 'Request req_previa_000001 not found or expired', type: 'value_error' }] }) : mp3()),
    async (llamadas) => {
      const r = await abrirEleven({ texto: 'La segunda.', voz: VOCES_ELEVEN.aura.es, previo: 'La primera.', previosIds: IDS });
      assert.ok(r?.body, 'no se queda muda');
      assert.equal(llamadas.length, 2, 'acotado: uno con ids y uno sin');
      assert.ok(!llamadas[1].cuerpo.previous_request_ids);
      assert.equal(llamadas[1].cuerpo.previous_text, 'La primera.', 'queda el enlace por texto');
      assert.equal(enlaceActivo(MODELO_ELEVEN), true, 'no es del modelo: no se apaga');
    }
  );
});

test('previous_request_ids que el modelo NO soporta: se apaga por modelo + endpoint + formato, acotado a un reintento', async () => {
  await conEleven(
    (l) => (l.cuerpo.previous_request_ids ? json(422, { detail: { status: 'invalid_parameters', param: 'previous_request_ids', message: 'previous_request_ids is not supported for this model' } }) : mp3()),
    async (llamadas) => {
      const r = await abrirEleven({ texto: 'La segunda.', voz: VOCES_ELEVEN.aura.es, previo: 'La primera.', previosIds: IDS, formato: 'pcm_22050' });
      assert.ok(r?.body);
      assert.equal(llamadas.length, 2);
      assert.equal(enlaceActivo(MODELO_ELEVEN, Date.now(), 'stream|pcm_22050'), false, 'ese endpoint y formato, apagado');
      assert.equal(enlaceActivo(MODELO_ELEVEN, Date.now(), 'stream|mp3_44100_96'), true, 'otro formato no se da por perdido');
      assert.equal(enlaceActivo('eleven_flash_v2_5'), true, 'otro modelo tampoco');
      // La frase siguiente por el mismo camino ya no manda los ids: un solo pedido.
      await abrirEleven({ texto: 'La tercera.', voz: VOCES_ELEVEN.aura.es, previo: 'La segunda.', previosIds: IDS, formato: 'pcm_22050' });
      assert.equal(llamadas.length, 3);
      assert.ok(!llamadas[2].cuerpo.previous_request_ids);
      assert.ok(telemetriaEleven().capacidadesApagadas.some((c) => c.capacidad === 'previous_request_ids' && c.clave === `${MODELO_ELEVEN}|stream|pcm_22050`));
    }
  );
});

test('el reintento sin el parámetro cabe en el MISMO plazo total de la frase (no arranca otros 15 s)', async () => {
  const t0 = Date.now();
  let cortadoEn = -1;
  await conEleven(
    (l, n) => {
      if (n === 1) return new Promise<Response>((ok) => setTimeout(() => ok(json(400, { detail: 'previous_request_ids not supported' })), 100));
      // El reintento se queda sin contestar: lo corta el plazo de la frase.
      return new Promise<Response>((_ok, mal) => {
        l.senal?.addEventListener('abort', () => {
          cortadoEn = Date.now() - t0;
          mal(l.senal?.reason ?? new Error('abortado'));
        });
      });
    },
    async (llamadas) => {
      const r = await abrirEleven({ texto: 'La segunda.', voz: VOCES_ELEVEN.aura.es, previosIds: IDS, timeoutMs: 1500 });
      assert.equal(r, null);
      assert.equal(llamadas.length, 2);
      assert.ok(cortadoEn > 0 && cortadoEn < 1500 + 250, `cortado a los ${cortadoEn} ms: dentro del plazo de 1,5 s, no 0,1 + 1,5 s`);
    }
  );
});

test('sin tiempo para un reintento útil, no se reintenta', async () => {
  await conEleven(
    (_l, n) => (n === 1 ? new Promise<Response>((ok) => setTimeout(() => ok(json(400, { detail: 'previous_request_ids not supported' })), 300)) : mp3()),
    async (llamadas) => {
      const r = await abrirEleven({ texto: 'La segunda.', voz: VOCES_ELEVEN.aura.es, previosIds: IDS, timeoutMs: 500 });
      assert.equal(r, null);
      assert.equal(llamadas.length, 1);
    }
  );
});

test('429, 401 y 402 nunca multiplican pedidos (con ids, con tiempos, o los dos)', async () => {
  for (const [status, cuerpo] of [
    [429, { detail: { status: 'too_many_concurrent_requests', message: 'previous_request_ids rate limited' } }],
    [401, { detail: { status: 'invalid_api_key' } }],
    [402, { detail: { status: 'quota_exceeded' } }],
  ] as const) {
    await conEleven(
      () => json(status, cuerpo),
      async (llamadas) => {
        assert.equal(await hablarEleven({ texto: 'Hola', voz: VOCES_ELEVEN.aura.es, tiempos: true, previosIds: IDS }), null);
        assert.equal(llamadas.length, 1, `${status} con tiempos e ids: un pedido`);
        _reiniciarFrenoEleven();
        assert.equal(await abrirEleven({ texto: 'Hola', voz: VOCES_ELEVEN.aura.es, previosIds: IDS }), null);
        assert.equal(llamadas.length, 2, `${status} por /stream con ids: un pedido más`);
        assert.equal(enlaceActivo(MODELO_ELEVEN), true, `${status}: el enlace no se apaga`);
        assert.equal(tiemposDisponibles(), true, `${status}: los tiempos no se apagan`);
      }
    );
  }
});

test('un pedido cancelado por quien llama (la persona se fue) no se reintenta', async () => {
  const corte = new AbortController();
  await conEleven(
    (l) =>
      new Promise<Response>((_ok, mal) => {
        l.senal?.addEventListener('abort', () => mal(l.senal?.reason ?? new Error('abortado')));
      }),
    async (llamadas) => {
      setTimeout(() => corte.abort(), 50);
      const r = await hablarEleven({ texto: 'Hola', voz: VOCES_ELEVEN.aura.es, tiempos: true, senal: corte.signal });
      assert.equal(r, null);
      assert.equal(llamadas.length, 1, 'sin el audio solo de respaldo: nadie lo espera');
      assert.equal(llamadas[0].senal?.aborted, true);
    }
  );
});
