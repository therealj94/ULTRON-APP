// [latencia] CUÁNDO EMPIEZA A SONAR LA RESPUESTA EN LA MESA, con la voz real (lib/tts: speak y
// StreamSpeaker) y un /api/tts de mentira que tarda `ttsMs` por frase.
//
// José: «tarda en contestar; el "déjame ver" moverlo solo si lleva bastante tiempo; no se siente
// conversación fluida». En la mesa el relleno («Mmm… déjame ver.») salía a los 700 ms y la respuesta
// ESPERABA a que terminara de sonar (StreamSpeaker no corta una frase en curso: `await lastSpeak`).
// Aquí se mide, para cerebros que tardan distinto en dar su primer trozo, si sonó el relleno y a los
// cuántos ms empezó la respuesta de verdad. El umbral se lee del código de la mesa (DeskScreen:
// `setTimeout(mmm, …)`), así con SRC=main se mide main.
'use strict';

const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const reloj = require('./reloj.cjs');
const M = require(process.env.OIDO || path.join(__dirname, 'out/oido.cjs'));
const { TTS, FRASES, FRASES_ESTADO } = M;
const mundo = globalThis.__mundo;
const SRC = path.resolve(process.env.SRC || path.join(__dirname, '../../src'));

const desk = fs.readFileSync(path.join(SRC, 'screens/DeskScreen.tsx'), 'utf8');
const m = /setTimeout\(mmm,\s*([A-Z_0-9]+)\)/.exec(desk);
if (!m) throw new Error('no encuentro el temporizador del relleno en DeskScreen');
const UMBRAL = /^\d+$/.test(m[1]) ? Number(m[1]) : FRASES_ESTADO[m[1]];
assert.ok(Number.isFinite(UMBRAL), `umbral del relleno: ${m[1]}`);

/** Un turno: el cerebro manda su primer trozo a los `primerMs`; la mesa hace lo de askBrain. */
async function turno(primerMs, respuesta) {
  await TTS.stopSpeaking();
  await reloj.avanzar(50);
  mundo.sonidos = [];
  const t0 = Date.now();
  let relleno = false;
  let primeraVoz = -1;
  let timer = setTimeout(() => {
    relleno = true;
    void TTS.speak(FRASES.frase('mmm'), {});
  }, UMBRAL);
  setTimeout(() => {
    clearTimeout(timer); // el primer trozo cancela el relleno que no salió (cancelMmm)
    timer = null;
    const sp = new TTS.StreamSpeaker({ onAudioStart: () => (primeraVoz = Date.now() - t0) });
    sp.push(respuesta);
    sp.end();
  }, primerMs);
  await reloj.avanzar(20_000);
  return { primerMs, relleno, primeraVoz };
}

(async () => {
  mundo.ttsMs = 450;
  // El relleno ya en la caché (así está después del primer turno): sale sin esperar a /api/tts.
  void TTS.speak(FRASES.frase('mmm'), {});
  await reloj.avanzar(5000);
  const casos = [300, 800, 1200, 1800, 2400, 3500];
  const filas = [];
  let k = 0;
  for (const ms of casos) filas.push(await turno(ms, `Claro, te cuento lo número ${++k}. El proyecto va bien y avanza.`));
  console.log(`[latencia] mesa: relleno a los ${UMBRAL} ms · /api/tts ${mundo.ttsMs} ms por frase · «${FRASES.frase('mmm')}» ya en caché`);
  for (const f of filas) {
    const ideal = f.primerMs + mundo.ttsMs;
    console.log(
      `[latencia]   primer trozo del cerebro a ${String(f.primerMs).padStart(4)} ms → respuesta suena a ${String(f.primeraVoz).padStart(4)} ms${f.relleno ? ` (sonó «déjame ver»; +${f.primeraVoz - ideal} ms de espera por él)` : ' (sin relleno)'}`
    );
  }
  let fallos = 0;
  const chequear = (ok, msg) => {
    if (!ok) {
      fallos++;
      console.log(`FALLA ${msg}`);
    }
  };
  for (const f of filas) {
    if (f.primerMs < 2500) chequear(!f.relleno, `con el primer trozo a ${f.primerMs} ms no debe sonar «déjame ver» (José: «solo si lleva bastante tiempo»)`);
    if (!f.relleno) chequear(f.primeraVoz <= f.primerMs + mundo.ttsMs + 60, `sin relleno la respuesta suena en cuanto llega su audio (${f.primeraVoz} ms)`);
  }
  const lenta = filas.at(-1);
  chequear(lenta.relleno, 'con el cerebro lento (3,5 s) sí dice «déjame ver»');
  // VOZ 001 (auditoría de Codex, 3-oct): parar la voz a media frase suelta la espera del turno en el acto.
  // Antes `done` del StreamSpeaker esperaba al guard (duración + 1,5 s; hasta 25 s) y la siguiente
  // pregunta quedaba en cola con la voz ya callada.
  {
    await TTS.stopSpeaking();
    await reloj.avanzar(50);
    const sp = new TTS.StreamSpeaker({});
    sp.push('Esta es una respuesta larga que tardaría muchos segundos en sonar entera por la bocina del teléfono de José.');
    sp.end();
    let soltada = -1;
    const t1 = Date.now();
    void sp.done.then(() => (soltada = Date.now() - t1));
    await reloj.avanzar(mundo.ttsMs + 900);
    await TTS.stopSpeaking();
    await reloj.avanzar(300);
    console.log(`[latencia] parar la voz a media frase: la espera del turno se soltó a los ${soltada} ms`);
    chequear(soltada >= 0 && soltada < mundo.ttsMs + 1500, `al parar la voz, la espera del turno se suelta en el acto (se soltó a ${soltada} ms)`);
  }
  console.log(fallos ? `\n${fallos} falla(s) de latencia` : '\nlatencia bien');
  process.exit(fallos ? 1 : 0);
})();
