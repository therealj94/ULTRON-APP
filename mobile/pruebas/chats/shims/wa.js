// La API de WhatsApp y lo guardado en el teléfono, de mentira: la prueba decide CUÁNDO contesta cada una
// (globalThis.__wa.estado() devuelve una promesa que la prueba resuelve), para repetir la carrera de «abre WhatsApp».
const wa = (globalThis.__wa = globalThis.__wa || { pendientes: [], guardado: null });

function diferida() {
  let ok;
  let mal;
  const p = new Promise((a, b) => {
    ok = a;
    mal = b;
  });
  return { p, ok, mal };
}

module.exports = {
  estadoWA: () => {
    const d = diferida();
    wa.pendientes.push(d);
    return d.p;
  },
  leerGuardadoWA: async () => wa.guardado,
  guardarWA: () => {},
};
