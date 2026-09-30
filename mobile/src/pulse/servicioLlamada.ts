/**
 * El servicio en primer plano de una llamada de PULSE2CHAT (Android).
 *
 * Sin él, Android congela la app a los pocos segundos de irse a segundo plano (o de apagar la
 * pantalla): se corta el micrófono, el buzón deja de oír y la llamada muere sin que nadie cuelgue.
 * Con él, la llamada sigue viva y se ve en la barra: «Llamada con Ana · PULSE2CHAT», con el reloj y
 * un botón Colgar.
 *
 * Tipos del servicio: `microphone` siempre y `camera` solo en videollamada con la cámara concedida.
 * NUNCA `phoneCall`: ese exige ser la app de teléfono del sistema (o usar Telecom), y Play lo rechaza.
 * El manifiesto lo declara `plugins/servicio-llamada.js` sobre el servicio de notifee.
 *
 * Android 14 solo deja arrancar un servicio de micrófono con la app DELANTE: por eso llamada.ts lo
 * arranca en cuanto abre el micrófono (la persona acaba de tocar llamar o contestar) y aquí solo se
 * actualiza el texto al conectar.
 */
import { Platform } from 'react-native';
import type * as Notifee from '@notifee/react-native';
import { tr } from '../i18n';

const ID = 'pulse2chat-llamada';
const CANAL = 'pulse2chat-llamada-en-curso';
const ACCION_COLGAR = 'colgar';

type Modulo = typeof Notifee;

let modulo: Modulo | null | undefined;
/** notifee solo existe en el APK de Android. En otra plataforma (o en un APK sin él) no hay servicio y no pasa nada. */
function cargar(): Modulo | null {
  if (modulo !== undefined) return modulo;
  if (Platform.OS !== 'android') return (modulo = null);
  try {
    modulo = require('@notifee/react-native') as Modulo;
  } catch {
    modulo = null;
  }
  return modulo;
}

let alColgar: (() => void) | null = null;
/** Lo que se quiere AHORA: una notificación que termina de mostrarse después de colgar se quita sola. */
let deseado = false;
let generacion = 0;
let canalListo = false;
let desde = 0;

/**
 * El botón Colgar de la notificación. Devuelve true si el evento era de la llamada.
 *
 * notifee acepta UN SOLO manejador de segundo plano (`onBackgroundEvent`) para toda la app: si otra
 * pieza registra el suyo, tiene que llamar primero a esta función y no hacer nada más si da true.
 */
export function manejarEventoLlamada(evento: { type: number; detail?: any }): boolean {
  const m = cargar();
  if (!m) return false;
  const d = evento?.detail || {};
  if (d.notification?.id !== ID) return false;
  if (evento.type === m.EventType.ACTION_PRESS && d.pressAction?.id === ACCION_COLGAR) {
    try {
      alColgar?.();
    } catch {
      /* colgar no tumba el servicio */
    }
  }
  return true;
}

/*
 * El registro va al cargar el módulo (lo importa llamada.ts, que carga con la app): notifee pide que
 * la tarea del servicio y el manejador de segundo plano existan antes de mostrar la notificación.
 * La tarea es una promesa que no se resuelve: el servicio vive hasta `stopForegroundService`.
 */
(function registrar() {
  const m = cargar();
  if (!m) return;
  try {
    m.default.registerForegroundService(() => new Promise<void>(() => {}));
    m.default.onForegroundEvent((e) => void manejarEventoLlamada(e));
    m.default.onBackgroundEvent(async (e) => {
      manejarEventoLlamada(e);
    });
  } catch {
    /* sin notifee nativo (p. ej. un APK viejo) la llamada funciona, solo que no en segundo plano */
  }
})();

async function asegurarCanal(m: Modulo) {
  if (canalListo) return;
  await m.default.createChannel({
    id: CANAL,
    name: tr('Llamada en curso', 'Ongoing call'),
    description: tr('Mantiene viva la llamada de PULSE2CHAT con la pantalla apagada', 'Keeps the PULSE2CHAT call alive with the screen off'),
    // Baja: la notificación está para quedarse y colgar, no para sonar encima del timbre propio.
    importance: m.AndroidImportance.LOW,
    vibration: false,
    visibility: m.AndroidVisibility.PUBLIC,
  });
  canalListo = true;
}

export type EstadoServicio = 'llamando' | 'conectando' | 'hablando';

/** Arranca el servicio, o actualiza su texto si ya estaba (misma notificación, mismo id). */
export async function arrancar(o: { nombre: string; video: boolean; estado: EstadoServicio; alColgar: () => void }) {
  const m = cargar();
  if (!m) return;
  alColgar = o.alColgar;
  deseado = true;
  const mia = ++generacion;
  if (o.estado === 'hablando' && !desde) desde = Date.now();
  const T = m.AndroidForegroundServiceType;
  try {
    await asegurarCanal(m);
    if (mia !== generacion || !deseado) return;
    await m.default.displayNotification({
      id: ID,
      title: tr(`Llamada con ${o.nombre} · PULSE2CHAT`, `Call with ${o.nombre} · PULSE2CHAT`),
      body:
        o.estado === 'hablando'
          ? tr('Cifrada de punta a punta', 'End-to-end encrypted')
          : o.estado === 'llamando'
            ? tr('Sonando…', 'Ringing…')
            : tr('Conectando…', 'Connecting…'),
      android: {
        channelId: CANAL,
        asForegroundService: true,
        foregroundServiceTypes: o.video ? [T.FOREGROUND_SERVICE_TYPE_MICROPHONE, T.FOREGROUND_SERVICE_TYPE_CAMERA] : [T.FOREGROUND_SERVICE_TYPE_MICROPHONE],
        category: m.AndroidCategory.CALL,
        ongoing: true,
        autoCancel: false,
        onlyAlertOnce: true,
        color: '#D6B56C',
        colorized: false,
        ...(o.estado === 'hablando' && desde ? { showChronometer: true, timestamp: desde, showTimestamp: true } : {}),
        // Tocar la notificación vuelve a la app (a la pantalla de la llamada, que está encima de todo).
        pressAction: { id: 'default', launchActivity: 'default' },
        actions: [{ title: tr('Colgar', 'Hang up'), pressAction: { id: ACCION_COLGAR } }],
      },
    });
    // Colgaron mientras se mostraba: el servicio que acaba de arrancar se para ya.
    if (!deseado) await quitar(m);
  } catch {
    /* sin servicio la llamada sigue; solo no aguanta en segundo plano */
  }
}

async function quitar(m: Modulo) {
  try {
    await m.default.stopForegroundService();
  } catch {}
  try {
    await m.default.cancelNotification(ID);
  } catch {}
}

/** Para el servicio y quita la notificación. Se puede llamar aunque nunca haya arrancado. */
export async function detener() {
  const m = cargar();
  deseado = false;
  generacion++;
  desde = 0;
  alColgar = null;
  if (m) await quitar(m);
}
