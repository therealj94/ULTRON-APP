// lib/storage de mentira: token, clave y sesión salen de globalThis.__mesa (las pruebas lo ponen).
const m = globalThis.__mesa || (globalThis.__mesa = { token: '', creds: null, sesion: null });
exports.loadMesaToken = async () => m.token || '';
exports.saveMesaToken = async (t) => {
  m.token = t || '';
};
exports.loadCreds = async () => m.creds;
exports.loadSession = async () => m.sesion || null;
exports.saveSession = async (s) => {
  m.sesion = s || null;
};
exports.saveSettings = async () => {};
