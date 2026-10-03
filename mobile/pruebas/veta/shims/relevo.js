// El relevo del chat, de mentira: quién está en el chat y su ficha (la contesta la prueba).
const st = globalThis.__relevo || (globalThis.__relevo = { yo: null, ficha: async () => null });
exports.quien = () => st.yo;
exports.ficha = (correo) => st.ficha(correo);
exports.alSalir = () => () => {};
