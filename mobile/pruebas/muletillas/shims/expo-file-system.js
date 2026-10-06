// expo-file-system/legacy de mentira: un disco en memoria y /api/tts que contesta con la voz que diga el mundo
// (cabecera X-Ultron-TTS) y deja en el archivo lo dicho (texto, avatar, idioma).
'use strict';
const m = require('./mundo.js');

function bajar(url, ruta) {
  const q = new URL(url).searchParams;
  const pedido = { texto: q.get('text'), avatar: q.get('avatar'), idioma: q.get('idioma') };
  m.tts.push(pedido);
  m.archivos.set(ruta, { ...pedido, motor: m.motorTts });
  return Promise.resolve({ status: 200, uri: ruta, headers: { 'Content-Type': 'audio/mpeg', 'X-Ultron-TTS': m.motorTts } });
}

module.exports = {
  documentDirectory: 'file:///docs/',
  cacheDirectory: 'file:///cache/',
  EncodingType: { Base64: 'base64' },
  makeDirectoryAsync: async () => {},
  getInfoAsync: async (ruta) => (m.archivos.has(ruta) ? { exists: true, size: 4096 } : { exists: false }),
  downloadAsync: (url, ruta) => bajar(url, ruta),
  createDownloadResumable: (url, ruta) => ({ downloadAsync: () => bajar(url, ruta), cancelAsync: async () => {} }),
  moveAsync: async ({ from, to }) => {
    if (!m.archivos.has(from)) throw new Error('no existe');
    m.archivos.set(to, m.archivos.get(from));
    m.archivos.delete(from);
  },
  deleteAsync: async (ruta) => void m.archivos.delete(ruta),
  readDirectoryAsync: async () => [],
  readAsStringAsync: async () => '',
  writeAsStringAsync: async () => {},
};
