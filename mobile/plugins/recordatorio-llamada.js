/**
 * LA LLAMADA DE AURA DE UN RECORDATORIO, EN EL MANIFIESTO («llámame a las 5 para recordarme…»).
 *
 * src/compa/recordatorios.ts programa un aviso de categoría llamada con `fullScreenAction`: con el
 * teléfono bloqueado, Android abre AU-RA a pantalla completa y se ve «AURA te llama» con Contestar /
 * Rechazar. Para eso hace falta USE_FULL_SCREEN_INTENT:
 *  · hasta Android 13 se concede al instalar;
 *  · desde Android 14 Play solo lo deja a apps de llamadas y despertadores (AU-RA hace llamadas de
 *    PULSE2CHAT, así que lo declara en Play Console como app de llamadas). Si Android no lo concede, el
 *    aviso igual suena con timbre y botones (heads-up), sin abrir la pantalla completa.
 *
 * Lo demás ya viene del manifiesto de notifee y NO se repite aquí: RECEIVE_BOOT_COMPLETED y su
 * RebootBroadcastReceiver (los avisos programados vuelven a agendarse al reiniciar el teléfono) y
 * SCHEDULE_EXACT_ALARM (alarma exacta si la persona la permite en «Alarmas y recordatorios»; si no,
 * inexacta). USE_EXACT_ALARM no se pide: Play lo reserva a despertadores y calendarios.
 *
 * Se comprueba regenerando el nativo (`npx expo prebuild -p android --no-install --clean`) y leyendo
 * android/app/src/main/AndroidManifest.xml.
 */
const { AndroidConfig } = require('expo/config-plugins');

const PERMISOS = ['android.permission.USE_FULL_SCREEN_INTENT'];

module.exports = function recordatorioLlamada(config) {
  return AndroidConfig.Permissions.withPermissions(config, PERMISOS);
};
