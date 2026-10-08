// AsyncStorage de mentira. `globalThis.__as.retener(clave)` → true deja esa lectura en espera hasta
// que la prueba llame a la función guardada en `__as.soltar[clave]` (para ver una lectura que llega tarde).
const as = globalThis.__as || (globalThis.__as = { m: new Map(), retener: () => false, soltar: {} });

const AsyncStorage = {
  getItem: async (k) => {
    if (as.retener(k)) return new Promise((r) => (as.soltar[k] = () => r(as.m.has(k) ? as.m.get(k) : null)));
    return as.m.has(k) ? as.m.get(k) : null;
  },
  setItem: async (k, v) => {
    as.m.set(k, v);
  },
  removeItem: async (k) => {
    as.m.delete(k);
  },
  multiRemove: async (ks) => {
    for (const k of ks) as.m.delete(k);
  },
  getAllKeys: async () => [...as.m.keys()],
};

module.exports = { __esModule: true, default: AsyncStorage };
