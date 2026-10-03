// Llavero de mentira que ANOTA con qué opciones se guardó cada llave (para comprobar que la contraseña de
// Veta Wallet solo se guarda detrás de la biometría) y deja simular que la biometría se cancela. `pausa`
// (opcional) deja a la prueba retener una lectura o un borrado: así se cambia de cuenta con el llavero a medias.
const st = globalThis.__ss || (globalThis.__ss = { m: new Map(), opciones: new Map(), cancelarBio: false, pausa: null });
const esperar = async (op, k) => { if (st.pausa) await st.pausa(op, k); };
exports.WHEN_UNLOCKED_THIS_DEVICE_ONLY = 'WHEN_UNLOCKED_THIS_DEVICE_ONLY';
exports.getItemAsync = async (k, o) => {
  await esperar('leer', k);
  if (o && o.requireAuthentication && st.cancelarBio) throw new Error('User canceled the authentication');
  return st.m.has(k) ? st.m.get(k) : null;
};
exports.setItemAsync = async (k, v, o) => { await esperar('escribir', k); st.m.set(k, String(v)); st.opciones.set(k, o || {}); };
exports.deleteItemAsync = async (k) => { await esperar('borrar', k); st.m.delete(k); st.opciones.delete(k); };
