// react-native de mentira para correr la lógica del chat en node: Linking y AppState con oyentes
// que las pruebas pueden disparar a mano (globalThis.__rn).
const oy = globalThis.__rn || (globalThis.__rn = { url: [], app: [], inicial: null, openURL: null });
exports.Linking = {
  addEventListener: (_e, f) => {
    oy.url.push(f);
    return { remove() { oy.url = oy.url.filter((x) => x !== f); } };
  },
  openURL: async (u) => {
    if (oy.openURL) return oy.openURL(u);
    throw new Error('no app');
  },
  getInitialURL: async () => oy.inicial || null,
};
exports.AppState = {
  currentState: 'active',
  addEventListener: (_e, f) => {
    oy.app.push(f);
    return { remove() { oy.app = oy.app.filter((x) => x !== f); } };
  },
};
// `__rn.os` deja probar otra plataforma (por omisión, Android).
exports.Platform = {
  get OS() {
    return oy.os || 'android';
  },
  select: (o) => o[oy.os || 'android'] ?? o.default,
};
