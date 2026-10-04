// El cliente de la API de AURA, de mentira: lo contesta la prueba (globalThis.__api). Anota de QUIÉN era la
// sesión al salir cada petición, como haría el de verdad (manda el token de quien esté dentro en ese momento).
exports.api = async (ruta, init, ms) => (globalThis.__api ? globalThis.__api(ruta, init || {}, ms) : {});
