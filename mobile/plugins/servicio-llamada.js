/**
 * EL SERVICIO EN PRIMER PLANO DE LAS LLAMADAS, EN EL MANIFIESTO.
 *
 * notifee trae su servicio (`app.notifee.core.ForegroundService`) declarado en SU manifiesto con
 * `foregroundServiceType="shortService"`: un servicio corto, que Android 14 mata a los ~3 minutos y
 * que no sirve para tener el micrófono abierto. Desde Android 14 (targetSdk 34) cada servicio en
 * primer plano tiene que decir en el manifiesto QUÉ usa, y al arrancarlo solo se pueden pedir tipos
 * que estén declarados ahí; si no, `startForeground` lanza y la llamada muere al irse a segundo plano.
 *
 * Este plugin reemplaza el tipo del servicio por `microphone|camera` (tools:replace, para que el
 * fusionador de manifiestos no se pelee con el de notifee) y asegura los permisos de esos tipos.
 * src/pulse/servicioLlamada.ts arranca el servicio pidiendo `microphone` siempre y `camera` solo en
 * videollamada: declarar los dos no obliga a usar los dos.
 *
 * NUNCA `phoneCall`: ese tipo exige ser la app de teléfono del sistema (o pasar por Telecom) y Play
 * lo rechaza en una app de mensajería.
 *
 * Se comprueba regenerando el nativo (`npx expo prebuild -p android --no-install --clean`) y
 * leyendo android/app/src/main/AndroidManifest.xml, no confiando en este comentario.
 */
const { AndroidConfig, withAndroidManifest } = require('expo/config-plugins');

const SERVICIO = 'app.notifee.core.ForegroundService';
const TIPOS = 'microphone|camera';

/** Sin estos, Android 14 rechaza arrancar el servicio con esos tipos aunque estén declarados. */
const PERMISOS = [
  'android.permission.FOREGROUND_SERVICE',
  'android.permission.FOREGROUND_SERVICE_MICROPHONE',
  'android.permission.FOREGROUND_SERVICE_CAMERA',
];

function conServicio(config) {
  return withAndroidManifest(config, (c) => {
    const manifiesto = c.modResults;
    // `tools:replace` necesita el espacio de nombres declarado en la raíz.
    manifiesto.manifest.$ = { ...manifiesto.manifest.$, 'xmlns:tools': 'http://schemas.android.com/tools' };

    const app = AndroidConfig.Manifest.getMainApplicationOrThrow(manifiesto);
    // Idempotente: si ya estaba (otra corrida, u otro plugin), se reescribe en vez de duplicarse.
    const otros = (app.service || []).filter((s) => s?.$?.['android:name'] !== SERVICIO);
    app.service = [
      ...otros,
      {
        $: {
          'android:name': SERVICIO,
          'android:exported': 'false',
          'android:foregroundServiceType': TIPOS,
          'tools:replace': 'android:foregroundServiceType',
        },
      },
    ];
    return c;
  });
}

module.exports = function servicioLlamada(config) {
  config = AndroidConfig.Permissions.withPermissions(config, PERMISOS);
  return conServicio(config);
};
