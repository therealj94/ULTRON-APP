// expo-av de mentira: cada sonido que se carga queda en mundo.cargas con su archivo y sus opciones (bucle, volumen, desde
// dónde empieza) y si se paró o se descargó.
'use strict';
const m = require('./mundo.js');

class Sound {
  constructor(archivo, opciones) {
    this.carga = { archivo, opciones, parado: false, descargado: false };
  }
  static async createAsync(src, opciones = {}) {
    const sound = new Sound(src, opciones);
    m.cargas.push(sound.carga);
    if (m.demoraCarga) await new Promise((r) => setTimeout(r, m.demoraCarga));
    return { sound, status: { isLoaded: true } };
  }
  setOnPlaybackStatusUpdate() {}
  async setPositionAsync() {}
  async playAsync() {}
  async stopAsync() {
    this.carga.parado = true;
  }
  async pauseAsync() {}
  async unloadAsync() {
    this.carga.descargado = true;
  }
}

module.exports = {
  Audio: {
    setAudioModeAsync: async () => {},
    Sound,
  },
};
