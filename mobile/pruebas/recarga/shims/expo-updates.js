// expo-updates de mentira: reloadAsync anota una foto del mundo en el instante en que se llama (¿quedaba algún
// sonido cargado, algún <Video> montado, la raíz pintada?) y puede fallar a pedido; useUpdates lee mundo.updates.
'use strict';
const m = require('./mundo.js');

module.exports = {
  isEnabled: true,
  channel: 'production',
  runtimeVersion: null,
  isEmbeddedLaunch: false,
  createdAt: null,
  get updateId() {
    return m.updateId;
  },
  useUpdates: () => m.updates,
  async reloadAsync() {
    m.recargas += 1;
    m.ev('reloadAsync');
    m.alRecargar = m.foto ? m.foto() : null;
    if (m.recargaFalla) throw new Error('reloadAsync falló');
  },
  async checkForUpdateAsync() {
    m.busquedas += 1;
    m.ev('checkForUpdateAsync');
    return { isAvailable: false };
  },
  async fetchUpdateAsync() {
    m.ev('fetchUpdateAsync');
    return { isNew: false };
  },
};
