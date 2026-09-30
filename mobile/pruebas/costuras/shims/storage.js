// lib/storage de mentira: el token de la mesa sale de globalThis.__mesa (las pruebas lo ponen).
const m = globalThis.__mesa || (globalThis.__mesa = { token: 'tok-mesa', creds: null });
exports.loadMesaToken = async () => m.token;
exports.saveMesaToken = async (t) => {
  m.token = t;
};
exports.loadCreds = async () => m.creds;
// Quién está dentro (lib/storage.loadSession): la renovación solo usa la clave de esa persona.
exports.loadSession = async () => m.sesion || null;
