// El cliente de la API, de mentira: /api/tts (la URL con texto, avatar e idioma, como lib/api.ts), el permiso de
// Turbo, /api/stt y GET /api/movil/config.
'use strict';
const m = require('./mundo.js');

function ttsUrl(text, performance, emocion = 'neutral', avatar = 'aura', idioma = 'es') {
  const q = new URLSearchParams({ text, performance, emocion, avatar, idioma, tiempos: '1' });
  return `https://prueba/api/tts?${q.toString()}`;
}

module.exports = {
  ttsUrl,
  TTS_ENDPOINT: 'https://prueba/api/tts',
  CANTAR_ENDPOINT: 'https://prueba/api/cantar',
  ORAR_ENDPOINT: 'https://prueba/api/orar',
  sessionHeaders: async () => ({}),
  pedirPermisoTurbo: async () => ({ url: 'wss://turbo/prueba' }),
  transcribirWav: async () => '',
  transcribe: async () => '',
  api: async (ruta) => {
    if (ruta === '/api/movil/config') {
      m.pedidosConfig++;
      if (m.config === 404) throw new Error('404');
      return m.config;
    }
    throw new Error(`ruta no simulada: ${ruta}`);
  },
};
