// Lo que ven los simulados de los sonidos de trabajo: lo que sonó (expo-av), el disco, lo que contesta el servidor y las
// migas. Uno solo para el paquete y las pruebas (en globalThis, como pruebas/muletillas/shims/mundo.js).
'use strict';
const CONFIG = () => ({ camaraRapida: { activa: true }, vozStream: { activa: true }, asentir: { activo: true }, ambiente: { activo: true } });
const mundo = (globalThis.__sonidos = globalThis.__sonidos || {
  /** Cada createAsync: el archivo (su nombre), sus opciones y si se paró o se descargó. */
  cargas: [],
  disco: new Map(),
  /** Lo que contesta GET /api/movil/config (404: un servidor viejo). */
  config: CONFIG(),
  pedidosConfig: 0,
  migas: [],
  /** Lo que tarda createAsync (para probar una carga que llega tarde). */
  demoraCarga: 0,
  reiniciar() {
    this.cargas.length = 0;
    this.disco.clear();
    this.migas.length = 0;
    this.pedidosConfig = 0;
    this.demoraCarga = 0;
    this.config = CONFIG();
  },
});
module.exports = mundo;
