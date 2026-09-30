// Imitación mínima de `react-native` (el candado no la usa; está por si algún import la arrastra).
export const Platform = { OS: 'android', Version: 34, select: (o) => o.android ?? o.default };
export const AppState = { currentState: 'active', addEventListener: () => ({ remove() {} }) };
export const Vibration = { vibrate() {}, cancel() {} };
export const Linking = { openSettings: async () => {} };
export const PermissionsAndroid = { PERMISSIONS: {}, RESULTS: { GRANTED: 'granted' }, requestMultiple: async () => ({}) };
export default { Platform, AppState, Vibration, Linking, PermissionsAndroid };
