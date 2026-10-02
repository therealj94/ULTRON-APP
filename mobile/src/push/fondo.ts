/**
 * EL MANEJADOR DE FONDO DE FIREBASE MESSAGING: se registra al cargar el módulo, ANTES de la app.
 *
 * Lo importa index.js en su primera línea. Con la app cerrada, Android despierta el JS solo para entregar
 * el aviso (una tarea sin pantalla): `setBackgroundMessageHandler` tiene que existir ya, fuera de
 * cualquier componente, o el aviso se pierde. Con la app delante, `onMessage` hace lo mismo. Los dos
 * terminan en push/nativo.ts `atenderMensaje`, que nunca lanza.
 *
 * Solo AU-RA en Android (Dr Electrum no lleva Firebase). Un APK sin el nativo de Firebase: no pasa nada.
 */
import { atenderMensaje, mensajeria } from './nativo';

(function registrarFondo() {
  const f = mensajeria();
  if (!f) return;
  try {
    f.m.setBackgroundMessageHandler(f.msg, async (r) => {
      await atenderMensaje(r?.data);
    });
  } catch {
    /* sin manejador de fondo, los avisos llegan solo con la app abierta */
  }
  try {
    f.m.onMessage(f.msg, async (r) => {
      await atenderMensaje(r?.data);
    });
  } catch {
    /* sin avisos en primer plano: el canal de acciones sigue llegando con la app abierta */
  }
})();
