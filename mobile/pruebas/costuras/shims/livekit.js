// La sesión de audio de LiveKit de mentira: anota cada arranque y cada parada en globalThis.__audio,
// que es lo que miran las pruebas (la de ElevenLabs y la de la llamada son LA MISMA en el teléfono).
const audio = globalThis.__audio || (globalThis.__audio = { estado: 'parada', historia: [] });

module.exports = {
  AudioSession: {
    configureAudio: async () => {},
    startAudioSession: async () => {
      audio.estado = 'arrancada';
      audio.historia.push('start');
    },
    stopAudioSession: async () => {
      audio.estado = 'parada';
      audio.historia.push('stop');
    },
    selectAudioOutput: async () => {},
  },
};
