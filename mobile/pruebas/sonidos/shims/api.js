// El cliente de la API, de mentira: solo GET /api/movil/config (server/movil-config.ts).
'use strict';
const m = require('./mundo.js');
module.exports = {
  api: async (ruta) => {
    if (ruta === '/api/movil/config') {
      m.pedidosConfig++;
      if (m.config === 404) throw new Error('404');
      return m.config;
    }
    throw new Error(`ruta no simulada: ${ruta}`);
  },
};
