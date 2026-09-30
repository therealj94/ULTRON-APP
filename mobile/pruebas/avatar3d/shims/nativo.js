// Lo nativo de mentira para correr el perfil (src/lib/perfil.ts) en node: AsyncStorage en memoria,
// la api que contesta lo que ponga la prueba (globalThis.__api), los ajustes y la voz que no hacen
// nada, y lo poco de react-native que tocan el tema y el idioma.
const memoria = (globalThis.__almacen = globalThis.__almacen || new Map());

const AsyncStorage = {
  getItem: async (k) => (memoria.has(k) ? memoria.get(k) : null),
  setItem: async (k, v) => void memoria.set(k, String(v)),
  removeItem: async (k) => void memoria.delete(k),
};

module.exports = {
  default: AsyncStorage,
  ...AsyncStorage,
  // lib/api
  api: async (...a) => (globalThis.__api ? globalThis.__api(...a) : {}),
  // lib/storage
  saveSettings: async () => {},
  // lib/tts
  setAvatarVoz: () => {},
  // react-native
  Appearance: { getColorScheme: () => 'dark', addChangeListener: () => ({ remove() {} }) },
  useColorScheme: () => 'dark',
  Platform: { OS: 'android', select: (o) => o.android ?? o.default },
  NativeModules: {},
};
