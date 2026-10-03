// Llavero de mentira que ANOTA con qué opciones se guardó cada llave (para comprobar que la contraseña de
// Veta Wallet solo se guarda detrás de la biometría) y deja simular que la biometría se cancela.
const st = globalThis.__ss || (globalThis.__ss = { m: new Map(), opciones: new Map(), cancelarBio: false });
exports.WHEN_UNLOCKED_THIS_DEVICE_ONLY = 'WHEN_UNLOCKED_THIS_DEVICE_ONLY';
exports.getItemAsync = async (k, o) => {
  if (o && o.requireAuthentication && st.cancelarBio) throw new Error('User canceled the authentication');
  return st.m.has(k) ? st.m.get(k) : null;
};
exports.setItemAsync = async (k, v, o) => { st.m.set(k, String(v)); st.opciones.set(k, o || {}); };
exports.deleteItemAsync = async (k) => { st.m.delete(k); st.opciones.delete(k); };
