// lib/storage de mentira: el token de la mesa sale de globalThis.__mesa (las pruebas lo ponen).
const m = globalThis.__mesa || (globalThis.__mesa = { token: 'tok-mesa', creds: null });
exports.loadMesaToken = async () => m.token;
exports.saveMesaToken = async (t) => {
  m.token = t;
};
// La prueba pone `creds = { correo, clave }`: como la app de verdad (lib/storage.ts), loadCreds NO devuelve la clave;
// la clave sale de leerClaveConHuella (en el teléfono, solo con la huella).
exports.loadCreds = async () => (m.creds ? { correo: m.creds.correo, name: m.creds.name, conHuella: !!m.creds.clave } : null);
exports.leerClaveConHuella = async () => (m.creds && m.creds.clave) || null;
// La renovación (lib/api.ts): la clave de la prueba sale sin preguntar, como la que dejó la 5.6.0 (`legado`).
exports.claveParaRenovar = async (correo) =>
  m.creds && m.creds.clave && String(m.creds.correo).toLowerCase() === String(correo).toLowerCase() ? { clave: m.creds.clave, via: 'legado' } : { clave: null, via: 'ninguna' };
// Quién está dentro (lib/storage.loadSession): la renovación solo usa la clave de esa persona.
exports.loadSession = async () => m.sesion || null;
exports.saveSession = async (s) => {
  m.sesion = s || null;
};
