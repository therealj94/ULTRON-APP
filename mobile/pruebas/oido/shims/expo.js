// `expo` simulado: sin módulos nativos propios (el micrófono crudo del oído Turbo no existe aquí), así
// la fachada del oído arranca con el reconocedor del teléfono, como en una APK anterior.
module.exports = { requireOptionalNativeModule: () => null };
