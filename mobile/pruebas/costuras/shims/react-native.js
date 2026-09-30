// react-native de mentira para las costuras: el del chat (Linking, AppState con oyentes que se
// disparan a mano por globalThis.__rn) más lo que usa el motor de llamadas (vibración, permisos).
// `globalThis.__rn.estado` cambia el AppState.currentState que ven las piezas.
const base = require('../../chat/shims/react-native.js');
const oy = globalThis.__rn;
if (!('estado' in oy)) oy.estado = 'active';

module.exports = {
  ...base,
  AppState: {
    get currentState() {
      return oy.estado;
    },
    addEventListener: base.AppState.addEventListener,
  },
  Platform: { OS: 'android', Version: 34, select: (o) => o.android ?? o.default },
  Vibration: { vibrate() {}, cancel() {} },
  PermissionsAndroid: {
    PERMISSIONS: { RECORD_AUDIO: 'mic', CAMERA: 'cam', BLUETOOTH_CONNECT: 'bt', POST_NOTIFICATIONS: 'avisos' },
    RESULTS: { GRANTED: 'granted', DENIED: 'denied', NEVER_ASK_AGAIN: 'never_ask_again' },
    requestMultiple: async (q) => Object.fromEntries(q.map((p) => [p, 'granted'])),
  },
};
