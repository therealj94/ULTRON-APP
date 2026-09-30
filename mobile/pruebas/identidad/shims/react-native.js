// react-native de mentira para las pruebas de identidad: el del chat (Linking, AppState, Platform)
// más Appearance/useColorScheme, que lee el tema al aplicar el perfil.
const base = require('../../chat/shims/react-native.js');

module.exports = {
  ...base,
  Appearance: {
    getColorScheme: () => 'dark',
    setColorScheme() {},
    addChangeListener: () => ({ remove() {} }),
  },
  useColorScheme: () => 'dark',
};
