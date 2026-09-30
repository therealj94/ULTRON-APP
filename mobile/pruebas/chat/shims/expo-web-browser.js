// La pestaña segura de mentira: la prueba decide qué devuelve (globalThis.__wb) y ve con qué se abrió.
exports.openAuthSessionAsync = async (...a) => (globalThis.__wb ? globalThis.__wb(...a) : { type: 'dismiss' });
