/**
 * LOS RECORDATORIOS DE AURA, en el teléfono.
 *
 *   «recuérdame a las 5 llamar a mi mamá»          → un AVISO a esa hora.
 *   «llámame a las 5 para recordarme la pastilla»   → a esa hora AURA TE LLAMA: aviso de llamada
 *       entrante (categoría llamada, pantalla completa si Android lo deja, timbre en bucle, Contestar /
 *       Rechazar). Al contestar se abre la app en la conversación con AURA y ella te lo dice con su voz.
 *       Si no contestas, vuelve a llamar UNA vez a los 5 minutos; si tampoco, queda el aviso normal.
 *   «¿qué recordatorios tengo?» / «cancela el de las 5» → se leen de aquí (el contexto se los cuenta al
 *       servidor) y se cancelan aquí, con su «sí».
 *
 * AURA pregunta primero con la hora exacta y el servidor manda la orden SOLO tras el «sí»
 * (lib/manos-app.ts). Cómo se pone:
 *  · con permiso de avisos (Android 13+; si lo negó, se dice cómo activarlo);
 *  · con notifee (ya viene en el APK por el servicio de las llamadas). Los avisos programados de notifee
 *    sobreviven a cerrar la app y a reiniciar el teléfono: su RebootBroadcastReceiver los vuelve a
 *    agendar al encender (lo declara su manifiesto, con RECEIVE_BOOT_COMPLETED);
 *  · la alarma EXACTA solo si Android la permite a AU-RA («Alarmas y recordatorios»,
 *    SCHEDULE_EXACT_ALARM, que ya trae notifee); si no, la inexacta que despierta al teléfono
 *    (SET_AND_ALLOW_WHILE_IDLE), que puede llegar con unos minutos de diferencia, y se dice.
 *    USE_EXACT_ALARM NO: Play lo reserva a apps de despertador y calendario;
 *  · la llamada se programa ENTERA por adelantado (llamada, reintento a los 5 min y aviso final), así
 *    funciona con la app cerrada; contestar o rechazar cancela lo que falta;
 *  · una sola vez aunque la orden llegue dos veces (por el SSE y en la respuesta del turno);
 *  · TODO o NADA: si falla un paso de la llamada, se quita lo que ya se había puesto (o se dice que
 *    quedó a medias, si ni eso se pudo), en vez de contestar «no pude» con una llamada ya agendada.
 * Nada sale del teléfono: el aviso vive en el sistema de Android.
 *
 * DE QUIÉN ES CADA AVISO (teléfono compartido): cada aviso lleva el SEUDÓNIMO de su dueño (lib/cuenta.ts,
 * no el correo) y su id lo incluye. Listar, cancelar, la lectura por voz y lo que pasa al sonar solo
 * ven los de quien está dentro; los viejos sin dueño no se le atribuyen a nadie. Al cerrar sesión los
 * avisos de esa persona SIGUEN puestos (son suyos, los espera), pero nadie más los lista, los cancela
 * ni los oye. Con el teléfono bloqueado el aviso es PRIVADO: Android enseña que hay un aviso de AU-RA,
 * no lo que dice (según el ajuste de la pantalla de bloqueo del teléfono).
 *
 * Todo lo de afuera entra por `deps`: las pruebas lo corren en node con un notifee falso. El pegamento
 * con la app (manejadores de notifee, la pantalla «AURA te llama», las llamadas de PULSE2CHAT) está
 * en recordatoriosNativo.ts.
 */
import { tr } from '../i18n';
import type { RecordatorioPuesto } from '../nucleo/contrato';
import { baseServidor, RE_ID_SERVIDOR } from './recordatoriosServidor';

/** Lo que se usa de notifee (el de verdad o uno falso). */
export type NotifeeMin = {
  requestPermission: () => Promise<{ authorizationStatus: number }>;
  getNotificationSettings?: () => Promise<{ authorizationStatus?: number; android?: { alarm?: number } }>;
  createChannel: (c: Record<string, unknown>) => Promise<string>;
  createTriggerNotification: (n: Record<string, unknown>, t: Record<string, unknown>) => Promise<string>;
  getTriggerNotifications?: () => Promise<{ notification: { id?: string; data?: Record<string, unknown> } }[]>;
  cancelTriggerNotifications?: (ids?: string[]) => Promise<void>;
  cancelNotification?: (id: string) => Promise<void>;
  displayNotification?: (n: Record<string, unknown>) => Promise<string>;
};
export type ConstantesNotifee = {
  TriggerType: { TIMESTAMP: number };
  AlarmType: { SET_AND_ALLOW_WHILE_IDLE: number; SET_EXACT_AND_ALLOW_WHILE_IDLE?: number };
  AuthorizationStatus: { DENIED: number; AUTHORIZED?: number };
  AndroidImportance: { HIGH: number };
  AndroidCategory?: { CALL: string; REMINDER?: string };
  AndroidVisibility?: { PUBLIC: number; PRIVATE?: number };
  AndroidNotificationSetting?: { ENABLED: number };
  EventType?: { DISMISSED: number; PRESS: number; ACTION_PRESS: number; DELIVERED: number };
};

export type DepsRecordatorio = {
  notifee: () => { m: NotifeeMin; k: ConstantesNotifee } | null;
  ahora?: () => number;
  /** El seudónimo de quien está dentro ('' sin nadie): de quién son los avisos que se ponen y se ven. */
  dueno?: () => string;
};

export const CANAL_RECORDATORIOS = 'aura-recordatorios';
/** Canal propio de la llamada: importancia alta y timbre (los canales de Android no cambian después). */
export const CANAL_LLAMADA = 'aura-recordatorio-llamada';
/** Lo que queda por delante como mínimo para poner un aviso (el servidor ya pide un minuto). */
export const MARGEN_MS = 20_000;
export const MAX_ADELANTE_MS = 400 * 24 * 3600_000;
export const VENTANA_REPETIDO_MS = 10_000;
/** La llamada suena un minuto; el reintento, a los 5 minutos; el aviso final, cuando termina el reintento. */
export const SUENA_MS = 60_000;
export const REINTENTO_MS = 5 * 60_000;
export const AVISO_FINAL_MS = REINTENTO_MS + SUENA_MS;

/** Los botones y toques de la llamada (los lee recordatoriosNativo.ts). */
export const ACCION_CONTESTAR = 'aura-rec-contestar';
export const ACCION_RECHAZAR = 'aura-rec-rechazar';
export const ACCION_ABRIR = 'aura-rec-abrir';
export const ACCION_PANTALLA = 'aura-rec-pantalla';

export type Paso = 'aviso' | 'l1' | 'l2' | 'final';
/** `parcial`: falló a medias y no se pudo deshacer lo que ya estaba puesto (se dice, no se esconde). */
export type Resultado = { ok: boolean; detalle: string; id?: string; exacto?: boolean; parcial?: boolean };

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

/**
 * El id base de un recordatorio. La misma orden repetida (misma hora, mismo texto, mismo dueño) da el
 * mismo id: no se duplica, ni tras reiniciar. El dueño entra en el id: la misma orden de dos personas
 * son dos avisos, y uno no pisa al otro.
 */
export function idRecordatorio(cuando: number, texto: string, dueno = ''): string {
  let h = 0;
  for (const c of `${dueno}|${texto}`) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return `aura-rec-${cuando.toString(36)}-${h.toString(36)}`;
}

/** Visibilidad en la pantalla bloqueada: privada (Android oculta el contenido), si notifee la trae. */
function privado(k: ConstantesNotifee): Record<string, unknown> {
  return k.AndroidVisibility ? { visibility: k.AndroidVisibility.PRIVATE ?? 0 } : {};
}

/** Los ids de todo lo que se programa para un recordatorio (para cancelarlo entero). */
export function idsDe(base: string): string[] {
  return [base, `${base}-l1`, `${base}-l2`, `${base}-final`];
}

const limpiar = (s: unknown) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, 140);

function datos(base: string, texto: string, cuando: number, paso: Paso, llamada: boolean, dueno: string): Record<string, string> {
  // A-3: la alarma de un recordatorio del servidor lleva su id (`rid`): así se reconcilia (compa/recordatoriosServidor.ts).
  const rid = /^(aura-rec-s[a-z0-9]{8,20})-[a-z0-9]{1,12}$/.exec(base)?.[1];
  return { aura: 'recordatorio', base, texto, cuando: String(cuando), paso, llamada: llamada ? '1' : '0', dueno, ...(rid ? { rid } : {}) };
}

/** El aviso de llamada entrante de AURA (la primera y el reintento). */
export function avisoDeLlamada(base: string, texto: string, cuando: number, paso: 'l1' | 'l2', k: ConstantesNotifee, dueno = ''): Record<string, unknown> {
  return {
    id: `${base}-${paso}`,
    title: tr('AURA te llama', 'AURA is calling'),
    body: tr(`Para recordarte: ${texto}`, `To remind you: ${texto}`),
    data: datos(base, texto, cuando, paso, true, dueno),
    android: {
      channelId: CANAL_LLAMADA,
      category: k.AndroidCategory?.CALL ?? 'call',
      importance: k.AndroidImportance.HIGH,
      // Privada (antes pública): bloqueado, se ve que AURA llama, no para qué.
      ...privado(k),
      // Con el teléfono bloqueado, Android abre la app a pantalla completa (si deja a AU-RA usarla;
      // si no, queda el aviso con timbre). La app muestra «AURA te llama» con Contestar / Rechazar.
      fullScreenAction: { id: ACCION_PANTALLA, launchActivity: 'default' },
      pressAction: { id: ACCION_ABRIR, launchActivity: 'default' },
      actions: [
        { title: tr('Contestar', 'Answer'), pressAction: { id: ACCION_CONTESTAR, launchActivity: 'default' } },
        { title: tr('Rechazar', 'Decline'), pressAction: { id: ACCION_RECHAZAR } },
      ],
      loopSound: true,
      ongoing: true,
      autoCancel: false,
      lightUpScreen: true,
      timeoutAfter: SUENA_MS,
    },
  };
}

/** El aviso normal (el de «recuérdame…», o el que queda si no contestó la llamada). */
export function avisoNormal(base: string, texto: string, cuando: number, paso: 'aviso' | 'final', llamada: boolean, k: ConstantesNotifee, dueno = ''): Record<string, unknown> {
  return {
    id: paso === 'aviso' ? base : `${base}-final`,
    title: paso === 'final' ? tr('AURA te llamó para recordarte', 'AURA called to remind you') : tr('AURA te recuerda', 'AURA reminds you'),
    body: texto,
    data: datos(base, texto, cuando, paso, llamada, dueno),
    android: { channelId: CANAL_RECORDATORIOS, pressAction: { id: 'default' }, importance: k.AndroidImportance.HIGH, ...privado(k) },
  };
}

async function alarmaExacta(m: NotifeeMin, k: ConstantesNotifee): Promise<boolean> {
  if (!m.getNotificationSettings || k.AlarmType.SET_EXACT_AND_ALLOW_WHILE_IDLE === undefined) return false;
  try {
    const s = await m.getNotificationSettings();
    return s?.android?.alarm === (k.AndroidNotificationSetting?.ENABLED ?? 1);
  } catch {
    return false;
  }
}

/** Pone el recordatorio (aviso o llamada). Nunca lanza: lo que falle se contesta con un motivo que AURA puede decir. */
export async function programarRecordatorio(a: { texto: string; cuando: number; llamada?: boolean; rid?: string }, d: DepsRecordatorio): Promise<Resultado> {
  const ahora = (d.ahora || Date.now)();
  const texto = limpiar(a.texto);
  const llamada = a.llamada === true;
  if (!texto) return { ok: false, detalle: tr('No me quedó claro qué recordarte.', "I didn't catch what to remind you.") };
  if (!Number.isFinite(a.cuando) || a.cuando < ahora + MARGEN_MS) return { ok: false, detalle: tr('Esa hora ya pasó. Dime otra.', 'That time already passed. Tell me another one.') };
  if (a.cuando > ahora + MAX_ADELANTE_MS) return { ok: false, detalle: tr('Eso está demasiado lejos para un recordatorio.', "That's too far ahead for a reminder.") };
  // Sin dueño no se pone: un aviso de nadie lo vería (y lo cancelaría) quien entre después.
  const dueno = d.dueno?.() || '';
  if (!dueno) return { ok: false, detalle: tr('Para ponerte un recordatorio tienes que entrar con tu cuenta.', 'Sign in to your account to set a reminder.') };
  const clave = `${dueno}|${a.cuando}|${texto}|${llamada ? 1 : 0}`;
  const ya = recientes.get(clave);
  if (ya && ahora - ya.en < VENTANA_REPETIDO_MS) return ya.r;
  const n = d.notifee();
  if (!n) return { ok: false, detalle: tr('En este teléfono no puedo poner avisos.', "I can't set reminders on this phone.") };
  const { m, k } = n;
  // Lo que ya quedó agendado de ESTE recordatorio: si un paso falla, se quita (todo o nada).
  const puestos: string[] = [];
  const poner = async (aviso: Record<string, unknown>, disparo: Record<string, unknown>) => {
    await m.createTriggerNotification(aviso, disparo);
    puestos.push(String(aviso.id));
  };
  try {
    // Si ya está dado, no se pide: pedirlo abre (y cierra) una ventana del sistema que pausa la app, y en
    // una llamada eso la colgaba (VozProvider, SEGUNDO_PLANO_MS).
    const ya = m.getNotificationSettings ? await m.getNotificationSettings().catch(() => null) : null;
    const dado = k.AuthorizationStatus.AUTHORIZED !== undefined && ya?.authorizationStatus === k.AuthorizationStatus.AUTHORIZED;
    const permiso = dado ? { authorizationStatus: ya!.authorizationStatus as number } : await m.requestPermission();
    if (permiso.authorizationStatus === k.AuthorizationStatus.DENIED) {
      return { ok: false, detalle: tr('Necesito permiso de avisos para recordarte. Actívalo en Ajustes, en Avisos.', 'I need notification permission to remind you. Turn it on in Settings, under Notifications.') };
    }
    const exacto = await alarmaExacta(m, k);
    const alarma = { type: exacto ? (k.AlarmType.SET_EXACT_AND_ALLOW_WHILE_IDLE as number) : k.AlarmType.SET_AND_ALLOW_WHILE_IDLE };
    const cuando = (t: number) => ({ type: k.TriggerType.TIMESTAMP, timestamp: t, alarmManager: alarma });
    await m.createChannel({ id: CANAL_RECORDATORIOS, name: tr('Recordatorios de AURA', 'AURA reminders'), importance: k.AndroidImportance.HIGH, sound: 'default' });
    // Uno del servidor (A-3): la alarma de ESTA vez lleva su id (`<rid>-<vez>`), para reconciliarla con el servidor.
    const base = a.rid && RE_ID_SERVIDOR.test(a.rid) ? baseServidor(a.rid, a.cuando) : idRecordatorio(a.cuando, texto, dueno);
    if (llamada) {
      await m.createChannel({
        id: CANAL_LLAMADA,
        name: tr('AURA te llama (recordatorios)', 'AURA calls you (reminders)'),
        description: tr('Cuando le pides a AURA que te llame para recordarte algo', 'When you ask AURA to call you to remind you of something'),
        importance: k.AndroidImportance.HIGH,
        sound: 'default',
        vibration: true,
        vibrationPattern: [300, 700, 300, 700],
        ...(k.AndroidVisibility ? { visibility: k.AndroidVisibility.PUBLIC } : {}),
      });
      await poner(avisoDeLlamada(base, texto, a.cuando, 'l1', k, dueno), cuando(a.cuando));
      await poner(avisoDeLlamada(base, texto, a.cuando, 'l2', k, dueno), cuando(a.cuando + REINTENTO_MS));
      await poner(avisoNormal(base, texto, a.cuando, 'final', true, k, dueno), cuando(a.cuando + AVISO_FINAL_MS));
    } else {
      await poner(avisoNormal(base, texto, a.cuando, 'aviso', false, k, dueno), cuando(a.cuando));
    }
    const hora = horaCorta(a.cuando, ahora);
    const aprox = exacto ? '' : tr(' Puede llegar con unos minutos de diferencia: para que sea exacto, activa «Alarmas y recordatorios» para AU-RA en Ajustes.', ' It may arrive a few minutes late: for exact timing, allow "Alarms & reminders" for AU-RA in Settings.');
    const detalle = (llamada ? tr(`Te llamo ${hora}.`, `I'll call you ${hora}.`) : tr(`Te aviso ${hora}.`, `I'll remind you ${hora}.`)) + aprox;
    const r: Resultado = { ok: true, detalle, id: base, exacto };
    recientes.set(clave, { r, en: ahora });
    if (recientes.size > 50) recientes.delete(recientes.keys().next().value as string);
    return r;
  } catch {
    if (puestos.length) {
      // Falló a medias: lo que alcanzó a quedar agendado se quita. Si ni eso se puede, se dice.
      const quitado = m.cancelTriggerNotifications ? await m.cancelTriggerNotifications(puestos).then(() => true, () => false) : false;
      if (!quitado) {
        return {
          ok: false,
          parcial: true,
          id: puestos[0].replace(/-(l1|l2|final)$/, ''),
          detalle: tr(
            'El recordatorio quedó a medias y no pude quitar lo que alcancé a poner: puede sonar una vez. Dime «cancela el recordatorio» para quitarlo.',
            'The reminder was only partly set and I couldn’t remove what I had set: it may ring once. Say "cancel the reminder" to remove it.'
          ),
        };
      }
    }
    return { ok: false, detalle: tr('No pude poner el recordatorio.', "I couldn't set the reminder.") };
  }
}

/**
 * Los recordatorios que siguen puestos DE QUIEN ESTÁ DENTRO (uno por recordatorio, no por cada aviso que
 * lo compone). Sin nadie dentro, ninguno. Los de otra persona, y los viejos sin dueño, no se listan.
 */
export async function listarRecordatorios(d: DepsRecordatorio): Promise<RecordatorioPuesto[]> {
  const n = d.notifee();
  const dueno = d.dueno?.() || '';
  if (!n?.m.getTriggerNotifications || !dueno) return [];
  try {
    const todos = await n.m.getTriggerNotifications();
    const out: RecordatorioPuesto[] = [];
    for (const t of todos) {
      const x = t?.notification?.data || {};
      if (x.aura !== 'recordatorio' || (x.paso !== 'aviso' && x.paso !== 'l1')) continue;
      if (x.dueno !== dueno) continue;
      const cuando = Number(x.cuando);
      if (!Number.isFinite(cuando) || typeof x.base !== 'string') continue;
      out.push({ id: x.base, texto: limpiar(x.texto), cuando, llamada: x.llamada === '1' });
    }
    return out.sort((a, b) => a.cuando - b.cuando).slice(0, 20);
  } catch {
    return [];
  }
}

/** Cancela un recordatorio entero (el aviso, o la llamada, su reintento y su aviso final). Solo uno propio. */
export async function cancelarRecordatorio(id: string, d: DepsRecordatorio): Promise<Resultado> {
  if (!/^aura-rec-[a-z0-9-]{1,80}$/.test(id)) return { ok: false, detalle: tr('No encuentro ese recordatorio.', "I can't find that reminder.") };
  const n = d.notifee();
  if (!n?.m.cancelTriggerNotifications) return { ok: false, detalle: tr('En este teléfono no puedo quitar avisos.', "I can't remove reminders on this phone.") };
  const puestos = await listarRecordatorios(d);
  // Uno del servidor (A-3): el servidor ya lo borró al mandar la orden; aquí se quitan sus alarmas (las de cada vez).
  if (RE_ID_SERVIDOR.test(id)) {
    const suyas = puestos.filter((r) => r.id.startsWith(`${id}-`));
    try {
      if (suyas.length) await n.m.cancelTriggerNotifications(suyas.flatMap((r) => idsDe(r.id)));
      return { ok: true, detalle: tr('Recordatorio cancelado.', 'Reminder cancelled.') };
    } catch {
      return { ok: false, detalle: tr('No pude quitar el recordatorio.', "I couldn't remove the reminder.") };
    }
  }
  if (!puestos.some((r) => r.id === id)) return { ok: false, detalle: tr('Ese recordatorio ya no está.', "That reminder isn't there anymore.") };
  try {
    await n.m.cancelTriggerNotifications(idsDe(id));
    return { ok: true, detalle: tr('Recordatorio cancelado.', 'Reminder cancelled.') };
  } catch {
    return { ok: false, detalle: tr('No pude quitar el recordatorio.', "I couldn't remove the reminder.") };
  }
}

/* ── la llamada de AURA cuando llega ─────────────────────────────────────────────────────── */

export type LlamadaRecordatorio = { base: string; texto: string; cuando: number; paso: 'l1' | 'l2'; dueno?: string };
export type EventoNotifee = { type: number; detail?: { notification?: { id?: string; data?: Record<string, unknown> }; pressAction?: { id?: string } } };

/**
 * Qué significa un evento de notifee para los recordatorios, o null si no es de ellos:
 *  · `suena`: la llamada llegó (DELIVERED) o la persona la tocó / Android abrió la pantalla completa;
 *    la app muestra «AURA te llama»;
 *  · `contestar` / `rechazar`: los botones.
 */
export function interpretarEvento(e: EventoNotifee, k: ConstantesNotifee): { que: 'suena' | 'contestar' | 'rechazar'; llamada: LlamadaRecordatorio } | null {
  const x = e?.detail?.notification?.data || {};
  if (x.aura !== 'recordatorio' || (x.paso !== 'l1' && x.paso !== 'l2') || typeof x.base !== 'string') return null;
  const llamada: LlamadaRecordatorio = { base: x.base, texto: limpiar(x.texto), cuando: Number(x.cuando) || 0, paso: x.paso, dueno: typeof x.dueno === 'string' ? x.dueno : '' };
  const T = k.EventType ?? { DISMISSED: 0, PRESS: 1, ACTION_PRESS: 2, DELIVERED: 3 };
  const accion = e.detail?.pressAction?.id;
  if (e.type === T.ACTION_PRESS && accion === ACCION_CONTESTAR) return { que: 'contestar', llamada };
  if (e.type === T.ACTION_PRESS && accion === ACCION_RECHAZAR) return { que: 'rechazar', llamada };
  if (e.type === T.DELIVERED || e.type === T.PRESS) return { que: 'suena', llamada };
  return null;
}

/** Lo que abrió la app (getInitialNotification): contestar desde el botón, o que suene en pantalla. */
export function interpretarApertura(inicial: { notification?: { data?: Record<string, unknown> }; pressAction?: { id?: string } } | null | undefined, k: ConstantesNotifee) {
  if (!inicial?.notification) return null;
  const T = k.EventType ?? { DISMISSED: 0, PRESS: 1, ACTION_PRESS: 2, DELIVERED: 3 };
  const id = inicial.pressAction?.id;
  return interpretarEvento({ type: id === ACCION_CONTESTAR || id === ACCION_RECHAZAR ? T.ACTION_PRESS : T.PRESS, detail: { notification: inicial.notification, pressAction: { id } } }, k);
}

/** Contestó: se quita lo que sonaba y lo que faltaba (reintento y aviso final). */
export async function alContestar(base: string, d: DepsRecordatorio) {
  const n = d.notifee();
  if (!n) return;
  await n.m.cancelTriggerNotifications?.([`${base}-l2`, `${base}-final`]).catch(() => undefined);
  for (const id of [`${base}-l1`, `${base}-l2`]) await n.m.cancelNotification?.(id).catch(() => undefined);
}

/**
 * Rechazó: no se vuelve a llamar (lo dijo ella), pero el recordatorio queda escrito en el aviso normal,
 * ya, para que no se pierda.
 */
export async function alRechazar(l: LlamadaRecordatorio, d: DepsRecordatorio) {
  const n = d.notifee();
  if (!n) return;
  await alContestar(l.base, d);
  await n.m.displayNotification?.(avisoNormal(l.base, l.texto, l.cuando, 'final', true, n.k, l.dueno || '')).catch(() => undefined);
}

/**
 * La llamada llegó en plena llamada de PULSE2CHAT: no se le encima. Se quita y se vuelve a poner
 * cuando esa llamada termine (`reponer`).
 */
export async function aplazar(l: LlamadaRecordatorio, d: DepsRecordatorio) {
  await d.notifee()?.m.cancelNotification?.(`${l.base}-${l.paso}`).catch(() => undefined);
}
export async function reponer(l: LlamadaRecordatorio, d: DepsRecordatorio) {
  const n = d.notifee();
  await n?.m.displayNotification?.(avisoDeLlamada(l.base, l.texto, l.cuando, l.paso, n.k, l.dueno || '')).catch(() => undefined);
}

/** ¿Esta llamada es de quien está dentro? Las de otra persona (o sin dueño) no se enseñan ni se dicen. */
export function esDeQuienEsta(l: LlamadaRecordatorio, d: DepsRecordatorio): boolean {
  const dueno = d.dueno?.() || '';
  return !!dueno && l.dueno === dueno;
}

/* ── «AURA te llama» en la app (la pantalla que se ve al sonar) ───────────────────────────── */

let sonando: LlamadaRecordatorio | null = null;
const oyentes = new Set<() => void>();
export const llamadaSonando = () => sonando;
export function fijarSonando(l: LlamadaRecordatorio | null) {
  if (sonando?.base === l?.base && sonando?.paso === l?.paso) return;
  sonando = l;
  for (const f of [...oyentes]) f();
}
export function escucharSonando(f: () => void): () => void {
  oyentes.add(f);
  return () => {
    oyentes.delete(f);
  };
}

/*
 * Lo que AURA tiene que decir porque la persona contestó. Queda guardado hasta que la voz lo toma:
 * si contestó con la app cerrada, el toque abre la app y la voz se monta DESPUÉS del aviso. Una misma
 * llamada contestada dos veces (el evento de fondo y el de apertura) se dice una sola.
 */
let porDecir: LlamadaRecordatorio | null = null;
const dichos = new Map<string, number>();
const oyentesPorDecir = new Set<() => void>();
export const VENTANA_CONTESTADA_MS = 10 * 60_000;

export function anotarContestada(l: LlamadaRecordatorio, ahora: number = Date.now(), avisar = true): boolean {
  for (const [b, t] of dichos) if (ahora - t > VENTANA_CONTESTADA_MS) dichos.delete(b);
  if (dichos.has(l.base)) return false;
  dichos.set(l.base, ahora);
  // Contestada en la pantalla de la llamada (el ciclo ya lo sabe): se anota y no se avisa a nadie más.
  if (!avisar) return true;
  porDecir = l;
  for (const f of [...oyentesPorDecir]) f();
  return true;
}
/** La voz lo toma (y ya no lo toma nadie más). */
export function tomarPorDecir(): LlamadaRecordatorio | null {
  const l = porDecir;
  porDecir = null;
  return l;
}
export function escucharPorDecir(f: () => void): () => void {
  oyentesPorDecir.add(f);
  return () => {
    oyentesPorDecir.delete(f);
  };
}

/** Solo pruebas. */
export function _olvidarRecordatorios() {
  recientes.clear();
  sonando = null;
  porDecir = null;
  dichos.clear();
}
