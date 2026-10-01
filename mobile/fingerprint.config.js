/**
 * Qué entra en la huella nativa (runtimeVersion, política `fingerprint`). Una huella nueva = APK nueva
 * para todos; nada de eso debe moverla si no cambia el nativo:
 *  · ExpoConfigVersions: `version` y `versionCode` de app.json (subir de versión no es nativo).
 *  · PackageJsonScriptsAll: los `scripts` de package.json (los parches nativos van por `patches/`).
 *  · ExpoConfigExtraSection: `extra` (URL del servidor, variante, acento): la OTA lo lleva en su manifiesto.
 * El resto de app.config (paquete, permisos, plugins, iconos, proyecto EAS) sigue dentro.
 * eas.json ya queda fuera (`ignorePaths`; sale como `easBuild` sin hash).
 *
 * Cambiar ESTE archivo cambia la huella una vez: la siguiente APK hay que instalarla a mano.
 */
/** @type {import('expo/fingerprint').Config} */
module.exports = {
  sourceSkips: [
    'GitIgnore',
    'PackageJsonAndroidAndIosScriptsIfNotContainRun',
    'PackageJsonScriptsAll',
    'ExpoConfigVersions',
    'ExpoConfigExtraSection',
  ],
  ignorePaths: ['eas.json'],
};
