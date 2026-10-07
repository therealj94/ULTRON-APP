// lib/storage de mentira: token, clave y sesión salen de globalThis.__mesa (las pruebas lo ponen).
const m = globalThis.__mesa || (globalThis.__mesa = { token: '', creds: null, sesion: null });
exports.loadMesaToken = async () => m.token || '';
exports.saveMesaToken = async (t) => {
  m.token = t || '';
};
// La prueba pone `creds = { correo, clave }`: como la app de verdad (lib/storage.ts), loadCreds NO devuelve la clave;
// la clave sale de leerClaveConHuella (en el teléfono, solo con la huella).
exports.loadCreds = async () => (m.creds ? { correo: m.creds.correo, name: m.creds.name, conHuella: !!m.creds.clave } : null);
exports.leerClaveConHuella = async () => (m.creds && m.creds.clave) || null;
exports.loadSession = async () => m.sesion || null;
exports.saveSession = async (s) => {
  m.sesion = s || null;
};
exports.saveSettings = async () => {};
