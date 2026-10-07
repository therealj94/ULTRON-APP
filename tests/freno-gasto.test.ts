/**
 * EL FRENO DE GASTO DIARIO (lib/freno-gasto.ts, auditoría del 7-oct, C-2): un tope global por día y por proveedor
 * (caracteres de ElevenLabs TTS, segundos de oído, llamadas a los ojos), configurable por entorno, con una línea clara
 * en el registro al saltar. Con ElevenLabs y los ojos falsos: pasado el tope, NO se les llama.
 */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { estadoGasto, gastarCupoDiario, segundosDeAudio, topeGasto, TOPES_GASTO_OMISION, _reiniciarFrenoGasto } from '../lib/freno-gasto';
import { abrirEleven, hablarEleven, _reiniciarFrenoEleven } from '../server/eleven';
import { transcribirAudio } from '../lib/oido';
import { wavDePrueba } from './voicebox-falso';

const ENV = ['AURA_TOPE_DIA_TTS_CARACTERES', 'AURA_TOPE_DIA_STT_SEGUNDOS', 'AURA_TOPE_DIA_VISION_LLAMADAS', 'ELEVENLABS_API_KEY'] as const;
const antes = Object.fromEntries(ENV.map((k) => [k, process.env[k]]));
const fetchReal = globalThis.fetch;
const pedidasEleven: string[] = [];
globalThis.fetch = (async (entrada: any, init?: any) => {
  const url = String(entrada?.url || entrada);
  if (!url.startsWith('https://api.elevenlabs.io/')) return fetchReal(entrada, init);
  pedidasEleven.push(url);
  return new Response(new Uint8Array(2000), { status: 200, headers: { 'content-type': 'audio/mpeg' } });
}) as typeof fetch;
after(() => {
  globalThis.fetch = fetchReal;
  for (const k of ENV) {
    if (antes[k] === undefined) delete process.env[k];
    else process.env[k] = antes[k];
  }
});

/** Lo que se escribe en console.error mientras corre `fn`. */
async function registro(fn: () => unknown): Promise<string[]> {
  const lineas: string[] = [];
  const real = console.error;
  console.error = (...a: unknown[]) => void lineas.push(a.map(String).join(' '));
  try {
    await fn();
  } finally {
    console.error = real;
  }
  return lineas;
}

test('los topes: generosos por omisión, por entorno si es un número >= 0; lo raro se ignora', () => {
  delete process.env.AURA_TOPE_DIA_TTS_CARACTERES;
  assert.equal(topeGasto('tts'), TOPES_GASTO_OMISION.tts);
  assert.ok(TOPES_GASTO_OMISION.tts >= 500_000 && TOPES_GASTO_OMISION.stt >= 36_000 && TOPES_GASTO_OMISION.vision >= 5_000, 'generosos');
  process.env.AURA_TOPE_DIA_TTS_CARACTERES = '1200';
  assert.equal(topeGasto('tts'), 1200);
  process.env.AURA_TOPE_DIA_TTS_CARACTERES = 'mucho';
  assert.equal(topeGasto('tts'), TOPES_GASTO_OMISION.tts);
  process.env.AURA_TOPE_DIA_TTS_CARACTERES = '-5';
  assert.equal(topeGasto('tts'), TOPES_GASTO_OMISION.tts);
  process.env.AURA_TOPE_DIA_TTS_CARACTERES = '0';
  assert.equal(topeGasto('tts'), 0, '0 apaga el proveedor');
});

test('se cobra hasta el tope; al pasarse, «no» con UNA línea clara en el registro; al otro día vuelve a cero', async () => {
  _reiniciarFrenoGasto();
  process.env.AURA_TOPE_DIA_VISION_LLAMADAS = '2';
  const dia = Date.parse('2026-10-07T18:00:00Z');
  assert.equal(gastarCupoDiario('vision', 1, dia), true);
  assert.equal(gastarCupoDiario('vision', 1, dia), true);
  const lineas = await registro(() => {
    assert.equal(gastarCupoDiario('vision', 1, dia), false);
    assert.equal(gastarCupoDiario('vision', 1, dia), false);
  });
  assert.equal(lineas.length, 1, 'una vez por día y proveedor');
  assert.match(lineas[0], /\[freno-gasto\] TOPE DIARIO ALCANZADO: los ojos \(visión\) lleva 2 de 2 llamadas hoy \(2026-10-07, Honduras\)/);
  assert.match(lineas[0], /AURA_TOPE_DIA_VISION_LLAMADAS/);
  assert.deepEqual(estadoGasto(dia).vision, { usado: 2, tope: 2, dia: '2026-10-07' });
  // Medianoche de Honduras (UTC−6): otro día, otro cupo.
  assert.equal(gastarCupoDiario('vision', 1, Date.parse('2026-10-08T07:00:00Z')), true);
});

test('ElevenLabs TTS: cuenta los caracteres de cada síntesis (una sola vez por frase) y pasado el tope no se le llama', async () => {
  _reiniciarFrenoGasto();
  _reiniciarFrenoEleven();
  process.env.ELEVENLABS_API_KEY = 'xi-de-prueba';
  process.env.AURA_TOPE_DIA_TTS_CARACTERES = '30';
  pedidasEleven.length = 0;
  const frase = 'Veinte letras justas'; // 20 caracteres
  assert.ok(await hablarEleven({ texto: frase, voz: 'voz-x', tiempos: false }));
  assert.equal(pedidasEleven.length, 1);
  assert.equal(estadoGasto().tts.usado, 20);
  // La segunda pasaría de 30: no sale a ElevenLabs (quien llama sigue con Voicebox).
  const lineas = await registro(async () => {
    assert.equal(await hablarEleven({ texto: frase, voz: 'voz-x' }), null);
    assert.equal(await abrirEleven({ texto: frase, voz: 'voz-x' }), null);
  });
  assert.equal(pedidasEleven.length, 1, 'ElevenLabs no se tocó');
  assert.match(lineas.join('\n'), /ElevenLabs TTS lleva 20 de 30 caracteres/);
});

test('el oído: cuenta los segundos del audio (WAV exacto; lo demás por el peso) y pasado el tope no oye', async () => {
  assert.equal(segundosDeAudio(wavDePrueba(3, 16000)), 3);
  assert.equal(segundosDeAudio(Buffer.alloc(40_000), 'audio/m4a'), 10, '32 kbps');
  _reiniciarFrenoGasto();
  process.env.AURA_TOPE_DIA_STT_SEGUNDOS = '4';
  let oidos = 0;
  const proveedores = [{ nombre: 'falso', listo: () => true, oir: async () => (oidos++, { texto: 'hola', via: 'falso' }) }];
  const wav = wavDePrueba(3, 16000);
  assert.equal((await transcribirAudio({ audio: wav, mime: 'audio/wav', proveedores })).texto, 'hola');
  const r = await transcribirAudio({ audio: wav, mime: 'audio/wav', proveedores });
  assert.equal(r.via, 'tope');
  assert.equal(r.texto, '');
  assert.equal(oidos, 1, 'el proveedor no se llamó la segunda vez');
});
