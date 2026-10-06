// `expo` simulado: sin módulos nativos propios (el micrófono crudo del oído Turbo no existe aquí), así
// la fachada del oído arranca con el reconocedor del teléfono, como en una APK anterior. La voz en streaming
// (AuraVoz) solo existe si la prueba pone un reproductor simulado en `__mundo.vozNativa` (vozvivo.cjs).
module.exports = {
  requireOptionalNativeModule: (nombre) => (nombre === 'AuraVoz' ? (globalThis.__mundo && globalThis.__mundo.vozNativa) || null : null),
};
