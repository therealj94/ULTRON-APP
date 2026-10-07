// lib/storage de mentira: token, clave y sesión salen de globalThis.__mesa (las pruebas lo ponen).
const m = globalThis.__mesa || (globalThis.__mesa = { token: '', creds: null, sesion: null });
exports.loadMesaToken = async () => m.token || '';
exports.saveMesaToken = async (t) => {
  m.token = t || '';
};
// Dos modos:
//  · `__mesa.llavero` (un llavero de mentira, ver huella.cjs): la entrada guardada es la de VERDAD
//    (lib/credsSeguras.ts), con la migración de la clave de la 5.6.0 y la clave detrás de la huella;
//  · `__mesa.creds = { correo, clave }` (las pruebas de siempre): como la app de verdad, loadCreds NO devuelve la clave,
//    y la renovación la usa sin preguntar (como la clave en claro de la 5.6.0, `legado`).
const { crearCreds } = require('../../../src/lib/credsSeguras');
let deVerdad = null;
const reales = () => {
  if (!m.llavero) return null;
  if (!deVerdad || deVerdad.ll !== m.llavero) deVerdad = { ll: m.llavero, c: crearCreds(m.llavero) };
  return deVerdad.c;
};
const mismo = (a, b) => String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();
exports.loadCreds = async () => (reales() ? reales().leer() : m.creds ? { correo: m.creds.correo, name: m.creds.name, conHuella: !!m.creds.clave } : null);
exports.saveCreds = async (c) => (reales() ? reales().guardar(c) : ((m.creds = c), !!(c && c.conHuella)));
exports.leerClaveConHuella = async (motivo) => (reales() ? reales().claveConHuella(motivo) : (m.creds && m.creds.clave) || null);
exports.claveParaRenovar = async (correo, motivo, puede) => {
  if (reales()) return reales().claveParaRenovar(correo, motivo, puede);
  return m.creds && m.creds.clave && mismo(m.creds.correo, correo) ? { clave: m.creds.clave, via: 'legado' } : { clave: null, via: 'ninguna' };
};
exports.desbloquearConHuella = async (motivo, o) => (reales() ? reales().desbloquear(motivo, o) : null);
exports.claveGuardadaCoincide = async (correo, clave) => (reales() ? reales().comprobarSinRed(correo, clave) : false);
exports.loadSession = async () => m.sesion || null;
exports.saveSession = async (s) => {
  m.sesion = s || null;
};
exports.saveSettings = async () => {};
