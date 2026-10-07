// lib/storage de mentira para el chat: el token y la sesión de la mesa, en memoria (globalThis.__mesa).
const m = globalThis.__mesa || (globalThis.__mesa = { token: '', creds: null, sesion: null });
exports.loadMesaToken = async () => m.token || '';
exports.saveMesaToken = async (t) => {
  m.token = t || '';
};
exports.loadSession = async () => m.sesion || null;
exports.saveSession = async (s) => {
  m.sesion = s || null;
};
exports.loadCreds = async () => null;
exports.leerClaveConHuella = async () => null;
