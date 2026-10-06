// expo-av de mentira: un sonido dura lo que dura su palabra (mundo.duracionDe) y mientras suena, la bocina se cuela
// al micrófono (mundo.bocinaHasta). Lo que suena queda en mundo.sonidos con su volumen.
'use strict';
const m = require('./mundo.js');

class Sound {
  constructor(uri, volumen) {
    this.uri = uri;
    this.volumen = volumen;
    const a = m.archivos.get(uri);
    this.texto = a ? a.texto : uri;
    this.dur = m.duracionDe(this.texto);
  }
  static async createAsync(src, opciones = {}) {
    const sound = new Sound(String(src?.uri || ''), opciones.volume ?? 1);
    return { sound, status: { isLoaded: true, durationMillis: sound.dur } };
  }
  setOnPlaybackStatusUpdate() {}
  async setPositionAsync() {}
  async playAsync() {
    m.sonidos.push({ uri: this.uri, texto: this.texto, volumen: this.volumen, en: Date.now() });
    m.bocinaHasta = Date.now() + this.dur;
  }
  async stopAsync() {
    m.callados++;
    m.bocinaHasta = Math.min(m.bocinaHasta, Date.now());
  }
  async pauseAsync() {}
  async unloadAsync() {}
}

class Recording {
  async prepareToRecordAsync() {}
  setProgressUpdateInterval() {}
  setOnRecordingStatusUpdate() {}
  async startAsync() {}
  async stopAndUnloadAsync() {}
  getURI() {
    return 'file:///tmp/nube.m4a';
  }
}

module.exports = {
  Audio: {
    requestPermissionsAsync: async () => ({ granted: true }),
    setAudioModeAsync: async () => {},
    Sound,
    Recording,
    AndroidOutputFormat: { MPEG_4: 2 },
    AndroidAudioEncoder: { AAC: 3 },
    IOSAudioQuality: { MEDIUM: 64 },
    IOSOutputFormat: { MPEG4AAC: 'aac' },
  },
};
