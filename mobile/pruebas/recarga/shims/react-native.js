// react-native de mentira para montar la raíz (App.tsx) en node: cada primitivo es una etiqueta del árbol de
// pruebas/visor/montar.js. AppState siempre delante; el teclado, cerrado.
'use strict';
module.exports = {
  View: 'View',
  Text: 'Text',
  Platform: { OS: 'android', Version: 34, constants: {}, select: (o) => o.android ?? o.default },
  AppState: { currentState: 'active', addEventListener: () => ({ remove() {} }) },
  Keyboard: { isVisible: () => false, addListener: () => ({ remove() {} }), dismiss() {} },
};
