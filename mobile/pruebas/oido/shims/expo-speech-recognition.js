// expo-speech-recognition de mentira, con el comportamiento del módulo Android de verdad
// (node_modules/expo-speech-recognition/android/.../ExpoSpeechService.kt, v3.1.3):
//  · start() y abort() se «postean» al hilo principal (mainHandler.post): corren después, en orden;
//  · start() destruye el reconocedor anterior SIN mandar `end`; el `start` llega cuando el servicio
//    está listo (onReadyForSpeech), y desde ahí `volumechange` cada 120 ms;
//  · abort() → teardownAndEnd(): cancel + destroy + `end` SIEMPRE (aunque no hubiera nada);
//  · un error → `error` y teardownAndEnd(ERROR) → `end`;
//  · si se destruye un reconocedor que todavía no estaba listo, el siguiente contesta `busy`
//    (RecognitionService ocupado) — lo que pasa al pedir dos arranques seguidos.
// El «mundo» (globalThis.__mundo) decide lo de afuera: si WebRTC tiene el micrófono (Android le da el
// audio a VOICE_COMMUNICATION y el reconocedor oye silencio), si el servicio falla al arrancar, y lo
// que la persona dice (`__mundo.decir(texto)`).
'use strict';

const mundo = (globalThis.__mundo = globalThis.__mundo || {});
Object.assign(mundo, {
  hiloMs: mundo.hiloMs ?? 2,
  listoMs: mundo.listoMs ?? 80,
  webrtcTieneMic: false,
  fallaAlArrancar: null,
  // Un teléfono que no avisa ni `start` ni el `end` de un abort() (la red de seguridad del oído).
  sinAvisos: false,
  arranques: 0,
  abortos: 0,
  eventos: [],
});

const oyentes = new Map();
let speech = null;
let n = 0;

function emitir(nombre, e) {
  mundo.eventos.push(nombre);
  for (const f of [...(oyentes.get(nombre) || [])]) f(e);
}
const post = (f) => setTimeout(f, mundo.hiloMs);

function destruir(s) {
  s.vivo = false;
  if (s.t) clearTimeout(s.t);
  if (s.vol) clearInterval(s.vol);
}

function teardown(avisar = true) {
  const s = speech;
  speech = null;
  if (s) destruir(s);
  if (avisar) emitir('end', null);
}

/** ¿Hay un reconocedor escuchando de verdad (listo, y el micrófono le da audio)? */
mundo.nativoOye = () => !!speech && speech.estado === 'ACTIVE' && !mundo.webrtcTieneMic;
mundo.nativoActivo = () => !!speech && speech.estado === 'ACTIVE';

/**
 * El final que un reconocedor ya abortado tenía en camino: el puente de React Native lo entrega tarde,
 * cuando ya se soltó la pausa o se reabrió (y antes del `start` del reconocedor nuevo).
 */
mundo.finalViejo = (texto) => emitir('result', { isFinal: true, results: [{ transcript: texto }] });

/** La persona dice algo: si el reconocedor oye, parciales y el final. Devuelve si lo oyó. */
mundo.oirNativo = (texto) => {
  if (!mundo.nativoOye()) return false;
  const s = speech;
  emitir('speechstart', null);
  const palabras = texto.split(' ');
  emitir('result', { isFinal: false, results: [{ transcript: palabras.slice(0, Math.max(1, palabras.length - 1)).join(' ') }] });
  s.t2 = setTimeout(() => {
    if (!s.vivo) return;
    emitir('result', { isFinal: true, results: [{ transcript: texto }] });
  }, 300);
  return true;
};

module.exports = {
  ExpoSpeechRecognitionModule: {
    isRecognitionAvailable: () => true,
    requestPermissionsAsync: async () => ({ granted: true }),
    addListener(nombre, f) {
      if (!oyentes.has(nombre)) oyentes.set(nombre, new Set());
      oyentes.get(nombre).add(f);
      return { remove: () => oyentes.get(nombre).delete(f) };
    },
    start() {
      mundo.arranques += 1;
      post(() => {
        const previo = speech;
        const ocupado = !!previo && previo.estado === 'STARTING';
        if (previo) destruir(previo);
        const s = { id: ++n, estado: 'STARTING', vivo: true };
        speech = s;
        emitir('audiostart', null);
        s.t = setTimeout(() => {
          if (!s.vivo) return;
          const falla = ocupado ? 'busy' : mundo.fallaAlArrancar;
          if (falla) {
            emitir('error', { error: falla, message: falla });
            if (speech === s) teardown();
            return;
          }
          s.estado = 'ACTIVE';
          if (!mundo.sinAvisos) emitir('start', null);
          s.vol = setInterval(() => {
            if (s.vivo) emitir('volumechange', { value: mundo.webrtcTieneMic ? -2 : 0.5 });
          }, 120);
        }, mundo.listoMs);
      });
    },
    abort() {
      mundo.abortos += 1;
      post(() => teardown(!mundo.sinAvisos));
    },
    stop() {
      post(teardown);
    },
  },
};
