// expo-av de mentira con la MISMA forma que el de verdad (build/Audio/Sound.js): `createAsync` crea un Sound y llama a
// `loadAsync` del prototipo; `unloadAsync` solo suelta si está cargado; una segunda carga se rechaza. Cada reproductor
// nativo queda en mundo.sonidos con su estado (cargado / soltado). `<Video>` es un componente que anota cuándo se
// monta y cuándo se desmonta (al desmontar, expo-av suelta su reproductor en el hilo principal).
'use strict';
const React = require('react');
const m = require('./mundo.js');

let claves = 0;

class Sound {
  _loaded = false;
  _loading = false;
  _key = null;
  static createAsync = async (source, initialStatus = {}, onPlaybackStatusUpdate = null) => {
    const sound = new Sound();
    if (onPlaybackStatusUpdate) sound.setOnPlaybackStatusUpdate(onPlaybackStatusUpdate);
    const status = await sound.loadAsync(source, initialStatus);
    return { sound, status };
  };
  async loadAsync(source) {
    if (this._loading) throw new Error('The Sound is already loading.');
    if (this._loaded) throw new Error('The Sound is already loaded.');
    this._loading = true;
    const nombre = typeof source === 'string' ? source : source?.uri || String(source);
    const demora = m.demoraCarga[nombre] || 0;
    if (demora) await new Promise((r) => setTimeout(r, demora));
    this._loading = false;
    if (nombre.startsWith('roto')) throw new Error('no se pudo cargar ' + nombre);
    const nativo = { clave: ++claves, nombre, cargado: true, soltado: false };
    m.sonidos.push(nativo);
    m.ev('cargar', nombre);
    this._key = nativo;
    this._loaded = true;
    return { isLoaded: true };
  }
  async unloadAsync() {
    if (!this._loaded) return { isLoaded: false };
    this._loaded = false;
    const nativo = this._key;
    this._key = null;
    // Un nativo que no responde (la prueba del tope).
    if (m.colgar && m.colgar.has(nativo.nombre)) return new Promise(() => {});
    // En el nativo, unloadForSound corre en el hilo principal (AVManager.runOnUiQueueThread): un rato después.
    await new Promise((r) => setTimeout(r, 5));
    nativo.cargado = false;
    nativo.soltado = true;
    m.ev('descargar', nativo.nombre);
    return { isLoaded: false };
  }
  setOnPlaybackStatusUpdate() {}
  async playAsync() {
    return { isLoaded: this._loaded };
  }
  async stopAsync() {
    return { isLoaded: this._loaded };
  }
}

function Video(props) {
  React.useEffect(() => {
    const v = { nombre: props.nombre || 'video', montado: true };
    m.videos.push(v);
    m.ev('video-montado', v.nombre);
    return () => {
      v.montado = false;
      m.ev('video-desmontado', v.nombre);
    };
  }, []);
  return React.createElement('Video', props);
}

module.exports = {
  Audio: { Sound, setAudioModeAsync: async () => {} },
  Video,
  ResizeMode: { CONTAIN: 'contain', COVER: 'cover' },
};
