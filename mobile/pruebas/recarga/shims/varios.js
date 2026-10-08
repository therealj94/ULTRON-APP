// Lo demás de fuera, de mentira: la voz (tts.stopSpeaking), el reporte (migas y la marca de cierre intencional), los
// datos del build, expo-constants, el splash, los gestos y las dos apps (una pantalla con el cuerpo en video y sonidos
// cargados, como la mesa de AU-RA).
'use strict';
const React = require('react');
const m = require('./mundo.js');

const tts = {
  async stopSpeaking() {
    m.ev('stopSpeaking');
  },
};

const reporte = {
  miga: (t) => m.migas.push(String(t)),
  async cierreIntencional(motivo) {
    m.migas.push(String(motivo));
    m.ev('cierreIntencional', motivo);
  },
};

const recepcion = { fijarDatosBuild() {} };
const constants = { default: { expoConfig: { extra: {} } }, expoConfig: { extra: {} } };
const splash = { preventAutoHideAsync: async () => {}, setOptions() {}, hideAsync: async () => {} };

/** La app de mentira: el cuerpo en video (como avatares/video/CuerpoVideo) y lo que la prueba le pida cargar al montar. */
function AppFalsa() {
  const { Video, Audio } = require('expo-av');
  React.useEffect(() => {
    m.ev('app-montada');
    for (const nombre of m.alMontar || []) void Audio.Sound.createAsync(nombre).catch(() => {});
    return () => m.ev('app-desmontada');
  }, []);
  return React.createElement('View', { nombre: 'app' }, React.createElement(Video, { nombre: 'cuerpo-claudio' }));
}

module.exports = { tts, reporte, recepcion, constants, splash, AppFalsa };
