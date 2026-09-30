/**
 * LOS RECORDATORIOS DE AURA: «recuérdame a las 5 llamar a mi mamá» → un aviso local en el teléfono.
 *
 * AURA pregunta primero con la hora exacta («¿Te recuerdo "Llamar a mi mamá" hoy a las 5:00 de la
 * tarde?») y el servidor manda `recordatorio` SOLO tras el «sí» (lib/manos-app.ts). Aquí se pone:
 *  · con permiso de avisos (Android 13+ lo pide; si la persona lo negó, se dice cómo activarlo);
 *  · con notifee, que ya está en el APK (lo usa el servicio de las llamadas), como aviso programado.
 *    La alarma es la «inexacta que despierta al teléfono» (SET_AND_ALLOW_WHILE_IDLE): no pide el
 *    permiso de alarmas exactas y en la práctica suena en el minuto, aun con el teléfono dormido;
 *  · una sola vez aunque la orden llegue dos veces (por el SSE y en la respuesta del turno).
 * Nada sale del teléfono: el aviso vive en el sistema de Android.
 *
 * Todo lo de afuera entra por `deps`: las pruebas lo corren en node con un notifee falso.
 */
import { tr } from '../i18n';

/** Lo que se usa de notifee (el de verdad o uno falso). */
export type NotifeeMin = {
  requestPermission: () => Promise<{ authorizationStatus: number }>;
  createChannel: (c: { id: string; name: string; importance?: number; sound?: string }) => Promise<string>;
  createTriggerNotification: (n: Record<string, unknown>, t: Record<string, unknown>) => Promise<string>;
};
export type ConstantesNotifee = {
  TriggerType: { TIMESTAMP: number };
  AlarmType: { SET_AND_ALLOW_WHILE_IDLE: number };
  AuthorizationStatus: { DENIED: number };
  AndroidImportance: { HIGH: number };
};

export type DepsRecordatorio = {
  notifee: () => { m: NotifeeMin; k: ConstantesNotifee } | null;
  ahora?: () => number;
};

export const CANAL_RECORDATORIOS = 'aura-recordatorios';
/** Lo que queda por delante como mínimo para poner un aviso (el servidor ya pide un minuto). */
export const MARGEN_MS = 20_000;
export const MAX_ADELANTE_MS = 400 * 24 * 3600_000;
export const VENTANA_REPETIDO_MS = 10_000;

export type Resultado = { ok: boolean; detalle: string; id?: string };

const recientes = new Map<string, { r: Resultado; en: number }>();

/** La hora del aviso en palabras cortas, como la oyó la persona («hoy a las 5:00 p. m.»). */
export function horaCorta(cuando: number, ahora: number): string {
  const d = new Date(cuando);
  const hoy = new Date(ahora);
  const manana = new Date(ahora + 86_400_000);
  const mismoDia = (x: Date, y: Date) => x.getFullYear() === y.getFullYear() && x.getMonth() === y.getMonth() && x.getDate() === y.getDate();
  const h = d.getHours();
  const reloj = `${h % 12 || 12}:${String(d.getMinutes()).padStart(2, '0')} ${h < 12 ? 'a. m.' : 'p. m.'}`;
  const relojEn = `${h % 12 || 12}:${String(d.getMinutes()).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
  if (mismoDia(d, hoy)) return tr(`hoy a las ${reloj}`, `today at ${relojEn}`);
  if (mismoDia(d, manana)) return tr(`mañana a las ${reloj}`, `tomorrow at ${relojEn}`);
  return tr(`el ${d.getDate()}/${d.getMonth() + 1} a las ${reloj}`, `on ${d.getMonth() + 1}/${d.getDate()} at ${relojEn}`);
}

/** Pone el aviso. Nunca lanza: lo que falle se contesta con un motivo que AURA puede decir. */
export async function programarRecordatorio(a: { texto: string; cuando: number }, d: DepsRecordatorio): Promise<Resultado> {
  const ahora = (d.ahora || Date.now)();
  const texto = String(a.texto || '').replace(/\s+/g, ' ').trim().slice(0, 140);
  if (!texto) return { ok: false, detalle: tr('No me quedó claro qué recordarte.', "I didn't catch what to remind you.") };
  if (!Number.isFinite(a.cuando) || a.cuando < ahora + MARGEN_MS) return { ok: false, detalle: tr('Esa hora ya pasó. Dime otra.', 'That time already passed. Tell me another one.') };
  if (a.cuando > ahora + MAX_ADELANTE_MS) return { ok: false, detalle: tr('Eso está demasiado lejos para un recordatorio.', "That's too far ahead for a reminder.") };
  const clave = `${a.cuando}|${texto}`;
  const ya = recientes.get(clave);
  if (ya && ahora - ya.en < VENTANA_REPETIDO_MS) return ya.r;
  const n = d.notifee();
  if (!n) return { ok: false, detalle: tr('En este teléfono no puedo poner avisos.', "I can't set reminders on this phone.") };
  const { m, k } = n;
  try {
    const permiso = await m.requestPermission();
    if (permiso.authorizationStatus === k.AuthorizationStatus.DENIED) {
      return { ok: false, detalle: tr('Necesito permiso de avisos para recordarte. Actívalo en Ajustes, en Avisos.', 'I need notification permission to remind you. Turn it on in Settings, under Notifications.') };
    }
    const canal = await m.createChannel({ id: CANAL_RECORDATORIOS, name: tr('Recordatorios de AURA', 'AURA reminders'), importance: k.AndroidImportance.HIGH, sound: 'default' });
    const id = await m.createTriggerNotification(
      {
        id: `aura-rec-${a.cuando.toString(36)}-${(texto.length * 131 + texto.charCodeAt(0)).toString(36)}`,
        title: tr('AURA te recuerda', 'AURA reminds you'),
        body: texto,
        android: { channelId: canal, pressAction: { id: 'default' }, importance: k.AndroidImportance.HIGH },
      },
      { type: k.TriggerType.TIMESTAMP, timestamp: a.cuando, alarmManager: { type: k.AlarmType.SET_AND_ALLOW_WHILE_IDLE } }
    );
    const r: Resultado = { ok: true, detalle: tr(`Te aviso ${horaCorta(a.cuando, ahora)}.`, `I'll remind you ${horaCorta(a.cuando, ahora)}.`), id };
    recientes.set(clave, { r, en: ahora });
    if (recientes.size > 50) recientes.delete(recientes.keys().next().value as string);
    return r;
  } catch {
    return { ok: false, detalle: tr('No pude poner el recordatorio.', "I couldn't set the reminder.") };
  }
}

/** Solo pruebas. */
export function _olvidarRecordatorios() {
  recientes.clear();
}
