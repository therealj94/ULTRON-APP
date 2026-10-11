/**
 * LO QUE MIDE EL SERVIDOR ES TEXTO, NO AUDIO (auditoría del 11-oct, VOZ-04; server/voz-medidas.ts,
 * scripts/medir-latencia-voz.ts).
 *
 * `primerTextoMs` es cuándo salió el primer TEXTO del servidor hacia la voz; el primer byte de audio y el primer
 * cuadro que sonó no los ve el servidor. Las razones del veredicto decían «primer audio» para ese número: ahora dicen
 * «primer texto del servidor». El campo guardado se lee con su nombre viejo y se escribe con los dos
 * (`primerTextoServidorMs` y `primerTextoMs`), y el contrato trae, vacíos hasta que alguien los mida de verdad, el
 * primer byte de audio y el primer cuadro sonado.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as MED from '../server/voz-medidas';

const camino = (motor: MED.MotorVoz, primer: number, cerebro: number): MED.ResumenCamino => {
  const ms: MED.MedidaTurnoVoz[] = [];
  for (let i = 0; i < 30; i++)
    ms.push(MED.normalizarMedida({ motor, t: i, conv: `c${i % 6}`, primerTextoMs: primer, cerebroMs: cerebro, totalMs: cerebro + 100, puente: false, interrupcion: null, repetido: false, asentimiento: false, respaldo: false, error: false, tarde: false, cortado: false, red: 'wifi' })!);
  const ej: MED.EjercicioVoz[] = [];
  for (let i = 0; i < 6; i++) ej.push({ motor, tipo: 'interrupcion', bien: true, t: i, red: 'wifi' }, { motor, tipo: 'asentimiento', bien: true, t: i, red: 'wifi' });
  return MED.resumir(ms, ej);
};

test('las razones del veredicto hablan de «texto del servidor», nunca de audio, para los tiempos de texto', () => {
  const ag = camino('agente', 800, 1500);
  // Speech Engine no mejora el primer texto y empeora el cerebro: salen todas las razones de tiempos.
  const se = camino('speech-engine', 800, 3000);
  const v = MED.veredicto(ag, se, 4, { total: 2, ganaSE: 0 });
  assert.equal(v.estado, 'mantener');
  const tiempos = v.motivos.filter((m) => /p50|p95/.test(m));
  assert.ok(tiempos.length >= 2, JSON.stringify(v.motivos));
  for (const m of v.motivos) assert.doesNotMatch(m, /audio/i, `«${m}» no puede decir audio`);
  assert.ok(v.motivos.some((m) => /primer texto del servidor p50/.test(m)), JSON.stringify(v.motivos));
  assert.ok(v.motivos.some((m) => /primer texto del servidor p95/.test(m)));
  // Los nombres nuevos, con los viejos como alias (quien ya los lee no se rompe).
  assert.equal(v.primerTextoServidorP50Mejor, v.primerTextoP50Mejor);
  assert.equal(v.primerTextoServidorP95Mejor, v.primerTextoP95Mejor);
  assert.deepEqual(ag.primerTextoServidor, ag.primerTexto);
});

test('compatibilidad: se lee el campo viejo, se escribe con los dos nombres; el audio queda vacío si nadie lo midió', () => {
  const vieja = MED.normalizarMedida({ motor: 'agente', t: 1, conv: 'c', primerTextoMs: 640, cerebroMs: 900, totalMs: 1000 } as any)!;
  assert.equal(vieja.primerTextoServidorMs, 640);
  assert.equal(vieja.primerTextoMs, 640);
  assert.equal(vieja.primerByteAudioMs, null, 'sin valores inventados');
  assert.equal(vieja.primerCuadroSonadoMs, null);
  const nueva = MED.normalizarMedida({ motor: 'speech-engine', t: 2, conv: 'c', primerTextoServidorMs: 510, cerebroMs: 700, totalMs: 800, primerByteAudioMs: 900 } as any)!;
  assert.equal(nueva.primerTextoMs, 510, 'el nombre viejo sigue escrito');
  assert.equal(nueva.primerTextoServidorMs, 510);
  assert.equal(nueva.primerByteAudioMs, 900, 'lo que alguien sí midió, se guarda');
  assert.equal(MED.normalizarMedida({ motor: 'nada', t: 1, totalMs: 1 }), null);
  MED._reiniciarMedidas();
  MED.anotarTurnoVoz({ motor: 'agente', t: 3, conv: 'c', primerTextoMs: 300, cerebroMs: 400, totalMs: 500, puente: false, interrupcion: null, repetido: false, asentimiento: false, respaldo: false, error: false, tarde: false, cortado: false });
  const [m] = MED._medidas();
  assert.equal(m.primerTextoServidorMs, 300);
  assert.equal(m.primerTextoMs, 300);
  assert.equal(m.primerByteAudioMs, null);
  const r = MED.resumir(MED._medidas());
  assert.deepEqual(r.primerByteAudio, { p50: null, p95: null, medidas: 0 }, 'el primer byte de audio: sin medir, nulo');
  MED._reiniciarMedidas();
});

test('el script de latencia dice lo que mide: texto del servidor, sintético', () => {
  const src = fs.readFileSync(new URL('../scripts/medir-latencia-voz.ts', import.meta.url), 'utf8');
  assert.match(src, /texto del servidor \(sintético\)/);
  assert.doesNotMatch(src, /primera palabra \$\{/, 'ya no imprime «primera palabra» como si fuera voz');
});
