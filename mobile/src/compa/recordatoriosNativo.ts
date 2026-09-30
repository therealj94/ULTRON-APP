/**
 * EL PEGAMENTO DE LOS RECORDATORIOS CON EL TELÉFONO (la lógica está en recordatorios.ts).
 *
 *  · notifee del APK (el mismo del servicio de las llamadas), o null si no está;
 *  · los eventos de la llamada de AURA: con la app delante (onForegroundEvent) y con la app detrás o
 *    cerrada (el ÚNICO manejador de fondo de notifee vive en pulse/servicioLlamada.ts, que le pasa
 *    aquí lo que no es de la llamada de PULSE2CHAT);
 *  · lo que abrió la app (getInitialNotification): «Contestar» desde el aviso, o la pantalla completa;
 *  · la pantalla de la llamada es la del avatar (LlamadaAvatar, con el ciclo de compa/llamadaCiclo.ts):
 *    `sonar` la pone a sonar (VozProvider escucha `llamadaSonando`) y sus botones vuelven aquí;
 *  · no encimarse a una llamada de PULSE2CHAT en curso: la llamada de AURA se quita y se vuelve a
 *    poner cuando la otra termina (lo avisa el bus, `llamada`).
 *
 * Se carga con la app (lo importa app/acciones.ts): notifee pide que los manejadores existan desde el
 * arranque, también cuando Android despierta la app solo para entregar un evento de fondo.
 */
import { emitir, escuchar } from '../nucleo/contrato';
import { sumarManejadorDeFondo } from '../pulse/servicioLlamada';
import { seudonimoActual } from '../lib/cuenta';
import { registrarTrabajoActivo } from '../lib/barreraOta';
import * as R from './recordatorios';

type NotifeeCompleto = R.NotifeeMin & {
  onForegroundEvent: (f: (e: R.EventoNotifee) => void) => () => void;
  getInitialNotification?: () => Promise<{ notification?: { data?: Record<string, unknown> }; pressAction?: { id?: string } } | null>;
};

let cargado: { m: NotifeeCompleto; k: R.ConstantesNotifee } | null | undefined;
/** notifee del APK, o null si este teléfono no lo tiene (un APK sin él, o node). */
export function notifeeReal(): { m: NotifeeCompleto; k: R.ConstantesNotifee } | null {
  if (cargado !== undefined) return cargado;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('@notifee/react-native');
    if (!mod?.default?.createTriggerNotification) return (cargado = null);
    cargado = {
      m: mod.default,
      k: {
        TriggerType: mod.TriggerType,
        AlarmType: mod.AlarmType,
        AuthorizationStatus: mod.AuthorizationStatus,
        AndroidImportance: mod.AndroidImportance,
        AndroidCategory: mod.AndroidCategory,
        AndroidVisibility: mod.AndroidVisibility,
        AndroidNotificationSetting: mod.AndroidNotificationSetting,
        EventType: mod.EventType,
      },
    };
  } catch {
    cargado = null;
  }
  return cargado;
}

/** El dueño de los avisos es quien está dentro (su seudónimo, lib/cuenta.ts). */
export const depsRecordatorios: R.DepsRecordatorio = { notifee: notifeeReal, dueno: seudonimoActual };

let enLlamada = false;
let aplazadas: R.LlamadaRecordatorio[] = [];

/**
 * La llamada que sonó es de OTRA persona (o de nadie: un aviso viejo sin dueño): se calla la que suena
 * y nada más. No se enseña «AURA te llama» con su texto, no se lee en voz alta y no se le quitan a su
 * dueño el reintento ni el aviso final.
 */
async function callarAjena(l: R.LlamadaRecordatorio) {
  R.fijarSonando(null);
  await notifeeReal()?.m.cancelNotification?.(`${l.base}-${l.paso}`).catch(() => undefined);
}

/** La persona contestó (el botón del aviso o el de la pantalla «AURA te llama»). */
export async function contestar(l: R.LlamadaRecordatorio) {
  if (!R.esDeQuienEsta(l, depsRecordatorios)) return callarAjena(l);
  R.fijarSonando(null);
  await R.alContestar(l.base, depsRecordatorios);
  if (R.anotarContestada(l)) emitir('recordatorio', { texto: l.texto, base: l.base });
}

/**
 * Contestó en la pantalla de la llamada del avatar (compa/LlamadaAvatar.tsx): el ciclo ya abre la
 * conversación; aquí solo se calla el aviso y se quita lo que faltaba (reintento y aviso final).
 */
export async function contestadaEnPantalla(l: R.LlamadaRecordatorio) {
  if (!R.esDeQuienEsta(l, depsRecordatorios)) return callarAjena(l);
  R.fijarSonando(null);
  R.anotarContestada(l, Date.now(), false);
  await R.alContestar(l.base, depsRecordatorios);
}

/**
 * Con la app delante suena la pantalla del avatar (con su timbre): el aviso de notifee que sonaba a la
 * vez se calla para no oír dos timbres. El reintento y el aviso final siguen programados.
 */
export async function callarAvisoQueSuena(l: R.LlamadaRecordatorio) {
  await R.aplazar(l, depsRecordatorios);
}

/** No contestó en la app (sonó su minuto): el reintento y el aviso final de notifee siguen puestos. */
export function perdidaEnPantalla() {
  R.fijarSonando(null);
}

export async function rechazar(l: R.LlamadaRecordatorio) {
  if (!R.esDeQuienEsta(l, depsRecordatorios)) return callarAjena(l);
  R.fijarSonando(null);
  await R.alRechazar(l, depsRecordatorios);
}

/** Suena: la pantalla de la llamada del avatar, solo para su dueño. */
function sonar(l: R.LlamadaRecordatorio) {
  if (R.esDeQuienEsta(l, depsRecordatorios)) R.fijarSonando(l);
}

/** Un evento de notifee: true si era de los recordatorios. */
export async function atenderEvento(e: R.EventoNotifee): Promise<boolean> {
  const n = notifeeReal();
  if (!n) return false;
  const r = R.interpretarEvento(e, n.k);
  if (!r) return false;
  if (r.que === 'contestar') await contestar(r.llamada);
  else if (r.que === 'rechazar') await rechazar(r.llamada);
  else if (enLlamada) {
    // En plena llamada de PULSE2CHAT no suena encima: vuelve cuando esa termine.
    await R.aplazar(r.llamada, depsRecordatorios);
    if (!aplazadas.some((x) => x.base === r.llamada.base)) aplazadas.push(r.llamada);
  } else sonar(r.llamada);
  return true;
}

(function registrar() {
  const n = notifeeReal();
  if (!n) return;
  try {
    n.m.onForegroundEvent((e) => void atenderEvento(e));
  } catch {
    /* sin eventos en primer plano, el aviso igual suena y abre la app */
  }
  sumarManejadorDeFondo(atenderEvento);
  // Una llamada de AURA sonando: la actualización por aire no recarga encima (lib/ota.ts).
  registrarTrabajoActivo('recordatorio-sonando', () => !!R.llamadaSonando());
  escuchar('llamada', ({ activa }) => {
    enLlamada = !!activa;
    if (!activa && aplazadas.length) {
      const ya = aplazadas;
      aplazadas = [];
      for (const l of ya) void R.reponer(l, depsRecordatorios);
    }
  });
  void n.m
    .getInitialNotification?.()
    .then((ini) => {
      const r = R.interpretarApertura(ini, n.k);
      if (!r) return;
      if (r.que === 'contestar') void contestar(r.llamada);
      else if (r.que === 'rechazar') void rechazar(r.llamada);
      else sonar(r.llamada);
    })
    .catch(() => undefined);
})();
