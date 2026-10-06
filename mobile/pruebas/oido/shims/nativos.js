// Lo demás nativo que toca el oído, de mentira: react-native (Platform, PermissionsAndroid), expo-av
// (la grabación del motor de la nube), expo-file-system y el cliente de la API (transcribir).
'use strict';

const mundo = (globalThis.__mundo = globalThis.__mundo || {});
mundo.grabando = 0;
/** La voz: cuánto tarda /api/tts en dar el audio de una frase y cuánto dura al sonar (por letra). */
mundo.ttsMs = mundo.ttsMs ?? 450;
mundo.msPorLetra = mundo.msPorLetra ?? 60;
mundo.sonidos = [];
/** Qué frase quedó en cada archivo de la caché (el audio de mentira es el texto). */
mundo.rutas = new Map();
const textoDeUrl = (u) => decodeURIComponent((/[?&]text=([^&]*)/.exec(u) || [])[1] || '');
/**
 * Descargas a mano (pruebas/oido/locutor.cjs): con `mundo.descargaManual` cada /api/tts queda en
 * `mundo.descargas` hasta que la prueba la suelte (`d.soltar()`); `d.abortada` dice si quien la pidió la canceló.
 */
mundo.descargas = [];
mundo.pedidas = [];
/** Los sonidos creados y todavía sin soltar (unloadAsync): un sonido abandonado se queda aquí. */
mundo.vivos = new Set();
/** Cuánto tarda el reproductor en avisar que de verdad suena después de playAsync (0: en el acto). */
mundo.confirmaMs = mundo.confirmaMs ?? 0;
function bajar(url, path, tarea) {
  mundo.pedidas.push(textoDeUrl(url));
  return new Promise((r) => {
    const fin = () => {
      mundo.rutas.set(path, textoDeUrl(url));
      r({ status: 200, headers: { 'Content-Type': 'audio/wav' }, uri: path });
    };
    if (mundo.descargaManual) {
      const d = { texto: textoDeUrl(url), abortada: false, soltada: false, soltar: () => ((d.soltada = true), fin()) };
      if (tarea) tarea.d = d;
      mundo.descargas.push(d);
      return;
    }
    setTimeout(fin, mundo.ttsMs);
  });
}

/** Un sonido de expo-av que «suena» con el reloj de la prueba (avisa didJustFinish al terminar). */
class Sound {
  constructor(uri) {
    this.uri = uri;
    this.texto = mundo.rutas.get(uri) || textoDeUrl(uri) || uri;
    this.dur = Math.max(300, this.texto.length * mundo.msPorLetra);
    this.cb = null;
  }
  static async createAsync(src) {
    const sound = new Sound(String(src?.uri || ''));
    mundo.vivos.add(sound);
    return { sound };
  }
  setOnPlaybackStatusUpdate(cb) {
    this.cb = cb;
  }
  async playAsync() {
    const t0 = Date.now();
    mundo.sonidos.push({ texto: this.texto, en: t0, sonido: this });
    const sonar = () => {
      this.sonandoDesde = Date.now();
      this.cb?.({ isLoaded: true, isPlaying: true, positionMillis: 0, durationMillis: this.dur });
      this.t = setTimeout(() => this.cb?.({ isLoaded: true, isPlaying: false, positionMillis: this.dur, durationMillis: this.dur, didJustFinish: true }), this.dur);
    };
    if (mundo.confirmaMs > 0) {
      // Cargando: el reproductor todavía no suena (así es el primer aviso de expo-av en un teléfono).
      this.cb?.({ isLoaded: true, isPlaying: false, positionMillis: 0, durationMillis: this.dur });
      this.t = setTimeout(sonar, mundo.confirmaMs);
    } else sonar();
  }
  async stopAsync() {
    this.parado = true;
    clearTimeout(this.t);
  }
  async unloadAsync() {
    this.soltado = true;
    mundo.vivos.delete(this);
    clearTimeout(this.t);
  }
}

class Recording {
  async prepareToRecordAsync() {}
  setProgressUpdateInterval() {}
  setOnRecordingStatusUpdate() {}
  async startAsync() {
    mundo.grabando += 1;
  }
  async stopAndUnloadAsync() {
    mundo.grabando = Math.max(0, mundo.grabando - 1);
  }
  getURI() {
    return 'file:///tmp/nube.m4a';
  }
}

module.exports = {
  reactNative: {
    Platform: { OS: 'android', select: (o) => o.android ?? o.default },
    PermissionsAndroid: {
      PERMISSIONS: { RECORD_AUDIO: 'RECORD_AUDIO' },
      RESULTS: { GRANTED: 'granted' },
      request: async () => 'granted',
    },
  },
  expoAv: {
    Audio: {
      requestPermissionsAsync: async () => ({ granted: true }),
      setAudioModeAsync: async () => {},
      Recording,
      Sound,
      AndroidOutputFormat: { MPEG_4: 2 },
      AndroidAudioEncoder: { AAC: 3 },
      IOSAudioQuality: { MEDIUM: 64 },
      IOSOutputFormat: { MPEG4AAC: 'aac' },
    },
  },
  fileSystem: {
    cacheDirectory: 'file:///cache/',
    readAsStringAsync: async () => '',
    deleteAsync: async () => {},
    readDirectoryAsync: async () => [],
    moveAsync: async () => {},
    writeAsStringAsync: async () => {},
    getInfoAsync: async () => ({ exists: true, size: 4096 }),
    // /api/tts: tarda lo que diga el mundo y devuelve el audio (el «archivo» lleva el texto en la URL).
    downloadAsync: (url, path) => bajar(url, path),
    // La misma descarga, que se puede cancelar (como expo: downloadAsync da undefined si se canceló).
    createDownloadResumable: (url, path) => {
      const tarea = {
        d: null,
        cancelada: false,
        resolver: null,
        downloadAsync() {
          return new Promise((r) => {
            tarea.resolver = r;
            bajar(url, path, tarea).then((x) => !tarea.cancelada && r(x));
          });
        },
        async cancelAsync() {
          tarea.cancelada = true;
          if (tarea.d) tarea.d.abortada = true;
          tarea.resolver?.(undefined);
        },
      };
      return tarea;
    },
    EncodingType: { Base64: 'base64' },
  },
  api: {
    transcribe: async () => '',
    // El oído Turbo no corre en este arnés (sin micrófono crudo: `expo` simulado no lo trae).
    transcribirWav: async () => '',
    pedirPermisoTurbo: async () => null,
    TTS_ENDPOINT: 'https://prueba/api/tts',
    CANTAR_ENDPOINT: 'https://prueba/api/cantar',
    ORAR_ENDPOINT: 'https://prueba/api/orar',
    sessionHeaders: async () => ({}),
    ttsUrl: (text) => `https://prueba/api/tts?text=${encodeURIComponent(text)}`,
  },
  constants: { expoConfig: { extra: {}, version: 'prueba' } },
};
