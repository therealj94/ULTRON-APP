const st = globalThis.__ss || (globalThis.__ss = { m: new Map(), fallarLectura: 0, fallarEscritura: 0 });
exports.getItemAsync = async (k) => { if (st.fallarLectura > 0) { st.fallarLectura--; throw new Error('keystore: could not decrypt'); } return st.m.get(k) ?? null; };
exports.setItemAsync = async (k, v) => { if (st.fallarEscritura > 0) { st.fallarEscritura--; throw new Error('keystore write'); } st.m.set(k, v); };
exports.deleteItemAsync = async (k) => { st.m.delete(k); };
