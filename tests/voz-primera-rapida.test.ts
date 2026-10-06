/**
 * LA PRIMERA FRASE CON LA VOZ RÁPIDA (server/eleven.ts modeloDeLocucion; José, 6-oct: «que sea tan rápido contestar
 * una conversación que nadie note que es una IA»).
 *
 * El teléfono pide la voz frase por frase y espera el audio ENTERO de cada una (con sus tiempos para la boca) antes de
 * sonarla. Medido el 6-oct (scripts/voz/latencia-voz.ts voz, 3 frases × 4, como lo pide el teléfono): eleven_v4_turbo
 * 625 ms de mediana (p75 665), eleven_turbo_v2_5 208 ms (p75 256), eleven_flash_v2_5 209 ms (p75 227). La PRIMERA frase
 * de una respuesta (sin `previo`), corta y sin etiquetas de expresión va con turbo v2.5 (misma voz, ~0,4 s antes); las
 * demás, y cualquier frase con etiquetas (las entiende solo v4), con el modelo expresivo de siempre.
 * ELEVENLABS_MODELO_PRIMERA lo cambia (p. ej. eleven_flash_v2_5) o lo apaga («no»). ElevenLabs se finge con `fetch`.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { MODELO_PRIMERA_OMISION, aceptaEtiquetas, modeloDeLocucion, modeloEleven, _reiniciarFrenoEleven, _olvidarSinTiempos } from '../server/eleven';
import { hablar } from '../server/voz';

type Llamada = { url: string; cuerpo: any };
async function conEleven<T>(fn: (llamadas: Llamada[]) => Promise<T>): Promise<T> {
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
    if (url.includes('/with-timestamps')) {
      const t = String(cuerpo.text);
      return new Response(
        JSON.stringify({
          audio_base64: Buffer.from(new Uint8Array(4000).fill(0xfe)).toString('base64'),
          normalized_alignment: { characters: [...t], character_start_times_seconds: [...t].map((_, i) => i * 0.07), character_end_times_seconds: [...t].map((_, i) => i * 0.07 + 0.06) },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }
    return new Response(new Uint8Array(4000).fill(0xff), { status: 200, headers: { 'Content-Type': 'audio/mpeg' } });
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

test('qué modelo: la primera frase corta y sin etiquetas, el rápido; lo demás, el expresivo', () => {
  assert.equal(MODELO_PRIMERA_OMISION, 'eleven_turbo_v2_5');
  assert.equal(modeloDeLocucion({ texto: 'Claro que sí, mira,', plataforma: 'ultron' }), MODELO_PRIMERA_OMISION);
  assert.equal(modeloDeLocucion({ texto: 'Y además va bien.', previo: 'Claro que sí.', plataforma: 'ultron' }), modeloEleven(), 'con frase antes: el de siempre');
  assert.equal(modeloDeLocucion({ texto: '[risita] ¡Qué bueno!', plataforma: 'ultron' }), modeloEleven(), 'con etiqueta de expresión: v4 (la entiende)');
  assert.equal(modeloDeLocucion({ texto: 'x'.repeat(200), plataforma: 'ultron' }), modeloEleven(), 'larga: el de siempre');
  assert.equal(modeloDeLocucion({ texto: 'Buenas tardes.', plataforma: 'electrum' }), modeloEleven(), 'Dr Electrum, igual que siempre');
  assert.equal(aceptaEtiquetas('eleven_v4_turbo'), true);
  assert.equal(aceptaEtiquetas('eleven_turbo_v2_5'), false);
  process.env.ELEVENLABS_MODELO_PRIMERA = 'no';
  assert.equal(modeloDeLocucion({ texto: 'Claro.', plataforma: 'ultron' }), modeloEleven(), '«no» lo apaga');
  process.env.ELEVENLABS_MODELO_PRIMERA = 'eleven_flash_v2_5';
  assert.equal(modeloDeLocucion({ texto: 'Claro.', plataforma: 'ultron' }), 'eleven_flash_v2_5');
  delete process.env.ELEVENLABS_MODELO_PRIMERA;
});

test('la primera frase de AU-RA va al rápido, con tiempos, sin el tono v4 (lo leería en voz alta) y con su propia caché', async () => {
  await conEleven(async (llamadas) => {
    const h = await hablar({ texto: 'Claro que sí, José.', emocion: 'feliz', plataforma: 'ultron', tiempos: true });
    assert.equal(h?.motor, `elevenlabs:${MODELO_PRIMERA_OMISION}`);
    assert.equal(llamadas.length, 1);
    assert.match(llamadas[0].url, /\/with-timestamps\?/);
    assert.equal(llamadas[0].cuerpo.model_id, MODELO_PRIMERA_OMISION);
    assert.doesNotMatch(llamadas[0].cuerpo.text, /\[/, 'sin etiquetas: ese modelo no las entiende');
    assert.ok(h?.alineacion, 'la boca sigue con sus tiempos');
    // La segunda frase (con `previo`) va con el expresivo, y con su tono de entonación seguido.
    const seg = await hablar({ texto: 'Eso va muy bien.', emocion: 'feliz', plataforma: 'ultron', previo: 'Claro que sí, José.', tiempos: true });
    assert.equal(seg?.motor, `elevenlabs:${modeloEleven()}`);
    assert.equal(llamadas[1].cuerpo.model_id, modeloEleven());
  });
});

test('con etiqueta de expresión, la primera frase sigue con v4 y conserva su etiqueta', async () => {
  await conEleven(async (llamadas) => {
    const h = await hablar({ texto: '[risa] ¡Qué bueno!', emocion: 'risa', plataforma: 'ultron', sinCache: true });
    assert.equal(h?.motor, `elevenlabs:${modeloEleven()}`);
    assert.match(llamadas[0].cuerpo.text, /\[/);
  });
});
