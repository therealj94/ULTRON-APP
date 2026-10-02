/**
 * Autolinking de React Native por variante (app.config.js: `ULTRON_APP=electrum`).
 *
 * Firebase Cloud Messaging (src/push) es solo de AU-RA: `google-services.json` trae un único cliente,
 * el paquete de AU-RA, y app.config.js ni siquiera pone sus plugins en la rama del doctor. Sin esto, el
 * nativo de @react-native-firebase igual se enlazaba en la APK de Dr Electrum: peso muerto y un Firebase
 * que arranca sin configuración. En Dr Electrum el JS no lo carga nunca (push/nativo.ts mira ES_ELECTRUM).
 */
const electrum = String(process.env.ULTRON_APP || 'ultron').toLowerCase() === 'electrum';
const fuera = { platforms: { android: null, ios: null } };
/*
 * @react-native-firebase/app trae su propio react-native.config.js, y el autolinking de Expo, al juntarlo
 * con este, pierde el `android: null` (deepObjectMerge trata null como objeto vacío y deja el de la
 * librería). Apuntar su código Android a una carpeta que no existe lo deja fuera igual: sin build.gradle,
 * el autolinking no lo enlaza. Comprobado con `npx expo-modules-autolinking react-native-config`.
 */
const fueraConConfigPropia = { platforms: { android: { sourceDir: 'no-se-enlaza-en-dr-electrum' }, ios: null } };

module.exports = {
  dependencies: electrum
    ? {
        '@react-native-firebase/app': fueraConConfigPropia,
        '@react-native-firebase/messaging': fuera,
      }
    : {},
};
