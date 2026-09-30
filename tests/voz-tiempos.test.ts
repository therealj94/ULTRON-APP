/**
 * La voz de la mesa con sus tiempos por letra (la boca del avatar a tiempo): /api/tts pide a
 * ElevenLabs /with-timestamps con la MISMA voz, modelo y ajustes; si el modelo no da tiempos, se
 * anota y se pide el audio solo, como siempre. ElevenLabs se finge interceptando `fetch`.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { hablarEleven, tiemposDisponibles, _olvidarSinTiempos, _reiniciarFrenoEleven, modeloEleven, VOCES_ELEVEN } from '../server/eleven';
import { hablar } from '../server/voz';
import { cabeceraAlineacion } from '../lib/alineacion';

type Llamada = { url: string; cuerpo: any };

async function conEleven<T>(responder: (url: string, cuerpo: any) => Response, fn: (llamadas: Llamada[]) => Promise<T>): Promise<T> {
  const real = globalThis.fetch;
  const antes = process.env.ELEVENLABS_API_KEY;
  const llamadas: Llamada[] = [];
  process.env.ELEVENLABS_API_KEY = 'xi-de-prueba';
  _reiniciarFrenoEleven();
  _olvidarSinTiempos();
  globalThis.fetch = (async (entrada: any, init?: any) => {
    const url = String(entrada?.url || entrada);
    if (!url.startsWith('https://api.elevenlabs.io/')) return real(entrada, init);
    const cuerpo = typeof init?.body === 'string' ? JSON.parse(init.body) : init?.body;
    llamadas.push({ url, cuerpo });
    return responder(url, cuerpo);
  }) as typeof fetch;
  try {
    return await fn(llamadas);
  } finally {
    globalThis.fetch = real;
    if (antes === undefined) delete process.env.ELEVENLABS_API_KEY;
    else process.env.ELEVENLABS_API_KEY = antes;
    _reiniciarFrenoEleven();
    _olvidarSinTiempos();
  }
}

const mp3 = () => new Response(new Uint8Array(4000).fill(0xff), { status: 200, headers: { 'Content-Type': 'audio/mpeg' } });
const conTiempos = (texto: string) =>
  new Response(
    JSON.stringify({
      audio_base64: Buffer.from(new Uint8Array(4000).fill(0xfe)).toString('base64'),
      alignment: { characters: [...texto], character_start_times_seconds: [...texto].map((_, i) => i * 0.07), character_end_times_seconds: [...texto].map((_, i) => i * 0.07 + 0.06) },
      normalized_alignment: { characters: [...texto], character_start_times_seconds: [...texto].map((_, i) => 0.05 + i * 0.07), character_end_times_seconds: [...texto].map((_, i) => 0.11 + i * 0.07) },
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } }
  );

test('con tiempos: el mismo pedido (voz, modelo, ajustes) a /with-timestamps; el audio y la alineación normalizada', async () => {
  await conEleven(
    (url) => (url.includes('/with-timestamps') ? conTiempos('Hola') : mp3()),
    async (llamadas) => {
      const r = await hablarEleven({ texto: 'Hola', voz: VOCES_ELEVEN.antonio.es, estabilidad: 0.4, tiempos: true });
      assert.ok(r);
      assert.equal(r!.audio[0], 0xfe);
      assert.deepEqual((r!.alineacion as any).character_start_times_seconds[0], 0.05, 'la normalizada manda');
      assert.equal(llamadas.length, 1);
      assert.match(llamadas[0].url, new RegExp(`/text-to-speech/${VOCES_ELEVEN.antonio.es}/with-timestamps\\?output_format=mp3_44100_96$`));
      assert.equal(llamadas[0].cuerpo.model_id, modeloEleven());
      assert.deepEqual(llamadas[0].cuerpo.voice_settings, { stability: 0.4, similarity_boost: 0.8 });
    }
  );
});

test('si el modelo no da tiempos (422): se pide el audio solo, y por un rato ni se intenta', async () => {
  await conEleven(
    (url) => (url.includes('/with-timestamps') ? new Response('{"detail":{"status":"model_not_supported"}}', { status: 422 }) : mp3()),
    async (llamadas) => {
      const r = await hablarEleven({ texto: 'Hola', voz: VOCES_ELEVEN.aura.es, tiempos: true });
      assert.ok(r && r.audio[0] === 0xff, 'el audio de siempre');
      assert.equal(r!.alineacion, undefined);
      assert.equal(tiemposDisponibles(), false);
      assert.deepEqual(llamadas.map((l) => (l.url.includes('/with-timestamps') ? 'tiempos' : 'audio')), ['tiempos', 'audio']);
      await hablarEleven({ texto: 'Otra', voz: VOCES_ELEVEN.aura.es, tiempos: true });
      assert.deepEqual(llamadas.slice(2).map((l) => (l.url.includes('/with-timestamps') ? 'tiempos' : 'audio')), ['audio'], 'no insiste');
    }
  );
});

test('sin cupo (402) con tiempos: no hay voz de ElevenLabs y no se paga dos veces', async () => {
  await conEleven(
    () => new Response('{"detail":{"status":"quota_exceeded"}}', { status: 402 }),
    async (llamadas) => {
      assert.equal(await hablarEleven({ texto: 'Hola', voz: VOCES_ELEVEN.aura.es, tiempos: true }), null);
      assert.equal(llamadas.length, 1);
    }
  );
});

test('/api/tts sin tiempos es como antes; con tiempos, la alineación va con el audio y en la caché', async () => {
  await conEleven(
    (url) => (url.includes('/with-timestamps') ? conTiempos('Buen día, prueba de tiempos.') : mp3()),
    async (llamadas) => {
      const sin = await hablar({ texto: 'Buen día, prueba de tiempos.', avatar: 'claudio', idioma: 'es', sinCache: true });
      assert.ok(sin && !sin.alineacion);
      assert.ok(llamadas.every((l) => !l.url.includes('/with-timestamps')), 'sin pedirlos, no se piden');
      const con = await hablar({ texto: 'Buen día, prueba de tiempos.', avatar: 'claudio', idioma: 'es', tiempos: true, sinCache: true });
      assert.ok(con?.alineacion, 'trae los tiempos');
      assert.match(String(cabeceraAlineacion(con!.alineacion)), /^1\./);
      const n = llamadas.length;
      const deCache = await hablar({ texto: 'Buen día, prueba de tiempos.', avatar: 'claudio', idioma: 'es', tiempos: true });
      assert.equal(deCache?.cache, true);
      assert.ok(deCache?.alineacion, 'la caché guarda los tiempos');
      assert.equal(llamadas.length, n);
    }
  );
});
