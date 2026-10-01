/**
 * La caché permanente de la voz en S3 (server/voz.ts): la frase corta que ya se generó con la voz del
 * avatar sale de S3 tras un redespliegue, sin volver a pagar ni esperar a ElevenLabs. José (1-oct):
 * «grabar los mensajes comunes y cachearlos, que conteste muchísimo más rápido». S3 y ElevenLabs se
 * fingen (S3 en memoria; ElevenLabs interceptando `fetch`).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { _reiniciarFrenoEleven, _olvidarSinTiempos } from '../server/eleven';
import { hablar, abrirVozEnVivo, _s3VozDePrueba, _vaciarCacheVoz, PREFIJO_S3_VOZ, S3_VOZ_MS } from '../server/voz';

type S3Falso = { datos: Map<string, any>; gets: string[]; puts: string[]; lento?: boolean };

function s3Falso(): S3Falso & { impl: Parameters<typeof _s3VozDePrueba>[0] } {
  const f: S3Falso = { datos: new Map(), gets: [], puts: [] };
  return {
    ...f,
    impl: {
      listo: () => true,
      get: async (key: string) => {
        f.gets.push(key);
        if (f.lento) await new Promise((r) => setTimeout(r, S3_VOZ_MS + 300));
        return f.datos.has(key) ? { ok: true, json: f.datos.get(key), detalle: 'ok' } : { ok: true, json: null, detalle: 'vacío', missing: true };
      },
      put: async (key: string, json: unknown) => {
        f.puts.push(key);
        f.datos.set(key, JSON.parse(JSON.stringify(json)));
        return { ok: true, detalle: 'ok' };
      },
    },
    get datos() { return f.datos; },
    get gets() { return f.gets; },
    get puts() { return f.puts; },
    set lento(v: boolean) { f.lento = v; },
  } as any;
}

async function conEleven<T>(fn: (llamadas: string[]) => Promise<T>): Promise<T> {
  const real = globalThis.fetch;
  const antes = process.env.ELEVENLABS_API_KEY;
  const llamadas: string[] = [];
  process.env.ELEVENLABS_API_KEY = 'xi-de-prueba';
  _reiniciarFrenoEleven();
  _olvidarSinTiempos();
  globalThis.fetch = (async (entrada: any, init?: any) => {
    const url = String(entrada?.url || entrada);
    if (!/elevenlabs\.io\//.test(url)) return real(entrada, init);
    llamadas.push(url);
    return new Response(new Uint8Array(5000).fill(0xab), { status: 200, headers: { 'Content-Type': 'audio/mpeg' } });
  }) as typeof fetch;
  try {
    return await fn(llamadas);
  } finally {
    globalThis.fetch = real;
    if (antes === undefined) delete process.env.ELEVENLABS_API_KEY;
    else process.env.ELEVENLABS_API_KEY = antes;
    _reiniciarFrenoEleven();
    _olvidarSinTiempos();
    _s3VozDePrueba(null);
  }
}

const espera = () => new Promise((r) => setTimeout(r, 20));

test('la frase corta se guarda en S3 y, tras redesplegar (LRU vacía), sale de S3 sin llamar a ElevenLabs', async () => {
  const s3 = s3Falso();
  _s3VozDePrueba(s3.impl);
  await conEleven(async (llamadas) => {
    const texto = `¡Hola, José! ¿En qué te ayudo? ${Math.random()}`;
    const primera = await hablar({ texto, avatar: 'claudio', idioma: 'es' });
    assert.equal(primera?.cache, false);
    assert.equal(llamadas.length, 1);
    await espera();
    assert.equal(s3.puts.length, 1, 'se guardó en S3');
    assert.ok(s3.puts[0].startsWith(PREFIJO_S3_VOZ));
    _vaciarCacheVoz();
    const deS3 = await hablar({ texto, avatar: 'claudio', idioma: 'es' });
    assert.equal(deS3?.cache, true, 'salió de la caché');
    assert.equal(llamadas.length, 1, 'ElevenLabs no se volvió a llamar');
    assert.equal(deS3!.audio.length, 5000);
    assert.equal(deS3!.audio[0], 0xab);
    assert.match(deS3!.motor, /^elevenlabs/);
    // Otra voz con la misma frase no hereda el audio de Claudio.
    await hablar({ texto, avatar: 'aura', idioma: 'es' });
    assert.equal(llamadas.length, 2);
    // Y la LRU la tiene otra vez: la tercera no va ni a S3.
    const gets = s3.gets.length;
    assert.equal((await hablar({ texto, avatar: 'claudio', idioma: 'es' }))?.cache, true);
    assert.equal(s3.gets.length, gets);
  });
});

test('la voz en vivo (web de Dr Electrum) también lee y guarda en S3', async () => {
  const s3 = s3Falso();
  _s3VozDePrueba(s3.impl);
  await conEleven(async (llamadas) => {
    const texto = `Buen día. ¿En qué le ayudo? ${Math.random()}`;
    const vivo = await abrirVozEnVivo({ texto, plataforma: 'electrum', idioma: 'es' });
    assert.equal(vivo?.tipo, 'vivo');
    if (vivo?.tipo === 'vivo') vivo.guardar(Buffer.alloc(3000, 0xcd));
    await espera();
    assert.equal(s3.puts.length, 1);
    _vaciarCacheVoz();
    const otra = await abrirVozEnVivo({ texto, plataforma: 'electrum', idioma: 'es' });
    assert.equal(otra?.tipo, 'cache');
    assert.equal(otra?.tipo === 'cache' && otra.habla.audio[0], 0xcd);
    assert.equal(llamadas.length, 1);
  });
});

test('lo privado y lo largo nunca van a S3; si S3 tarda, se sigue con ElevenLabs sin esperar', async () => {
  const s3 = s3Falso();
  _s3VozDePrueba(s3.impl);
  await conEleven(async (llamadas) => {
    await hablar({ texto: `Beto dice: te veo a las cinco ${Math.random()}`, avatar: 'aura', idioma: 'es', privado: true });
    await hablar({ texto: 'Una respuesta larga. '.repeat(20) + Math.random(), avatar: 'aura', idioma: 'es' });
    await espera();
    assert.equal(s3.puts.length, 0, 'ni lo privado ni lo largo');
    assert.equal(s3.gets.length, 0, 'ni se pregunta');
    s3.lento = true;
    const t0 = Date.now();
    const r = await hablar({ texto: `Aquí estoy. ${Math.random()}`, avatar: 'aura', idioma: 'es' });
    assert.ok(r && r.cache === false);
    assert.ok(Date.now() - t0 < S3_VOZ_MS + 250, `no esperó a S3: ${Date.now() - t0} ms`);
    assert.equal(llamadas.length, 3);
  });
});

test('lo que no está en S3 no se vuelve a preguntar enseguida', async () => {
  const s3 = s3Falso();
  _s3VozDePrueba(s3.impl);
  await conEleven(async () => {
    const texto = `Dígame. ${Math.random()}`;
    assert.equal((await abrirVozEnVivo({ texto, plataforma: 'electrum', idioma: 'es' }))?.tipo, 'vivo');
    assert.equal(s3.gets.length, 1);
    // No se terminó de oír (no se guardó): la segunda vez va directo a ElevenLabs, sin preguntar a S3.
    assert.equal((await abrirVozEnVivo({ texto, plataforma: 'electrum', idioma: 'es' }))?.tipo, 'vivo');
    assert.equal(s3.gets.length, 1);
  });
});
