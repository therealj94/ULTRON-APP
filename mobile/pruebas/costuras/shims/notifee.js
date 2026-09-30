// notifee de mentira: el servicio de la llamada. Cada notificación queda en globalThis.__notifee.
const n = globalThis.__notifee || (globalThis.__notifee = { avisos: [], activo: false, paradas: 0 });

module.exports = {
  __esModule: true,
  default: {
    registerForegroundService() {},
    onForegroundEvent: () => () => {},
    onBackgroundEvent() {},
    createChannel: async () => 'canal',
    displayNotification: async (a) => {
      n.avisos.push(a);
      if (a.android && a.android.asForegroundService) n.activo = true;
      return a.id;
    },
    stopForegroundService: async () => {
      if (n.activo) n.paradas++;
      n.activo = false;
    },
    cancelNotification: async () => {},
  },
  EventType: { DISMISSED: 0, PRESS: 1, ACTION_PRESS: 2 },
  AndroidImportance: { LOW: 2, DEFAULT: 3, HIGH: 4 },
  AndroidVisibility: { PUBLIC: 1 },
  AndroidCategory: { CALL: 'call' },
  AndroidForegroundServiceType: { FOREGROUND_SERVICE_TYPE_MICROPHONE: 128, FOREGROUND_SERVICE_TYPE_CAMERA: 64 },
};
