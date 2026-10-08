// Lo que ve la prueba de la recarga: una sola línea de tiempo con lo que pasó en lo «nativo» simulado (cargas y
// descargas de expo-av, montajes y desmontajes de <Video>, la voz, la marca de cierre, reloadAsync).
'use strict';
const m = (globalThis.__mundoRecarga = globalThis.__mundoRecarga || {
  t0: Date.now(),
  eventos: [],
  migas: [],
  sonidos: [],
  videos: [],
  // expo-updates
  recargas: 0,
  recargaFalla: false,
  busquedas: 0,
  updates: { isUpdatePending: false, downloadedUpdate: undefined },
  updateId: 'ota-corriendo',
  // lo que demora el nativo en cargar un sonido (ms); por nombre
  demoraCarga: {},
  // al llamar reloadAsync, una foto del mundo
  alRecargar: null,
});
m.ev = (que, dato) => m.eventos.push({ que, dato, en: Date.now() - m.t0 });
m.reiniciar = () => {
  m.t0 = Date.now();
  m.eventos = [];
  m.migas = [];
  m.sonidos = [];
  m.videos = [];
  m.recargas = 0;
  m.recargaFalla = false;
  m.busquedas = 0;
  m.updates = { isUpdatePending: false, downloadedUpdate: undefined };
  m.updateId = 'ota-corriendo';
  m.demoraCarga = {};
  m.alRecargar = null;
  m.colgar = null;
};
module.exports = m;
