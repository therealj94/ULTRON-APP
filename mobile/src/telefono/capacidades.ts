/**
 * QUÉ COMPLETA CADA SUPERFICIE DE LA APP (revisión del dueño, F02: «La burbuja debe saber qué puede completar»).
 *
 * Cada turno le dice al servidor desde dónde habla y qué sabe completar ahí (`superficie` y `capacidades` en el cuerpo:
 * lib/api.ts; el contrato está en lib/superficie.ts del servidor):
 *  · la mesa: todas sus manos (MANOS_APP), navegar la app (`pantallas`) y mostrar una propuesta para aprobarla (`revision`);
 *  · la burbuja: solo lo que hace sin la app de atrás: abrir otras apps y los intents del teléfono (reloj, SMS, calendario).
 *    No navega la app ni muestra la ventana de decisión: eso lo deja para «Abrir en AURA». Y «llámame» (APK 5.7.1): la
 *    burbuja abre la app y la llamada suena ahí, también con la app cerrada (burbuja/llamameBurbuja.ts).
 * Las manos del teléfono solo en AU-RA y en Android.
 *
 * Y los permisos que el latido cuenta (lib/aparatos.ts), leídos de notifee. Puro (sin React Native).
 */
import { MANOS_APP } from '../nucleo/contrato';

export type SuperficieApp = 'mesa' | 'burbuja';
const DEL_TELEFONO = ['abrir_apps', 'intents_telefono'];

export function capacidadesDeSuperficie(superficie: SuperficieApp, o: { android: boolean; electrum: boolean }): string[] {
  const telefono = o.android && !o.electrum;
  if (superficie === 'burbuja') return telefono ? [...DEL_TELEFONO, 'llamame'] : [];
  return [...MANOS_APP.filter((m) => telefono || !DEL_TELEFONO.includes(m)), 'pantallas', 'revision'];
}

/** Dónde corre la app (lo fija App.tsx al arrancar: Android y la variante). Sin fijar: sin manos del teléfono. */
let entorno = { android: false, electrum: true };
export function fijarEntornoTelefono(e: { android: boolean; electrum: boolean }): void {
  entorno = { ...e };
}
/** Las capacidades de la superficie para el cuerpo del turno (lib/api.ts). */
export function capacidadesDelTurno(superficie: SuperficieApp): string[] {
  return capacidadesDeSuperficie(superficie, entorno);
}

/** Los permisos del latido, de lo que dice notifee (AuthorizationStatus y AndroidNotificationSetting). */
export function permisosDeNotifee(s: { authorizationStatus?: number; android?: { alarm?: number } } | null | undefined): Record<string, 'si' | 'no' | 'preguntar'> {
  const out: Record<string, 'si' | 'no' | 'preguntar'> = {};
  if (!s) return out;
  const a = s.authorizationStatus;
  if (typeof a === 'number') out.notificaciones = a === 1 || a === 2 ? 'si' : a === 0 ? 'no' : 'preguntar';
  const alarma = s.android?.alarm;
  if (typeof alarma === 'number' && alarma !== -1) out.alarmas_exactas = alarma === 1 ? 'si' : 'no';
  return out;
}
