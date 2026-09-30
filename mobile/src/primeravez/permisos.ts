/**
 * LOS PERMISOS DE ANDROID, explicados: todos los de `PERMISOS_ANDROID` (src/nucleo/contrato.ts), con
 * su ícono, para qué los usa AURA dicho como persona, y el estado real del teléfono.
 *
 * Estados:
 *   · concedido  → ✔
 *   · pendiente  → se puede pedir (el diálogo del sistema sale)
 *   · bloqueado  → la persona tocó «No volver a preguntar» (o lo negó dos veces): Android ya no
 *                  muestra el diálogo y lo único que sirve es abrir los Ajustes de la app
 *   · noAplica   → este Android no lo pide (los avisos antes de Android 13, el Bluetooth antes de
 *                  Android 12): cuenta como concedido
 *
 * Android no deja preguntar si un permiso quedó bloqueado sin pedirlo; por eso lo que contestó el
 * último pedido se recuerda en el teléfono y se vuelve a comprobar al volver de Ajustes.
 */
import { Linking, PermissionsAndroid, Platform, type Permission } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { tr } from '../i18n';
import { PERMISOS_ANDROID } from '../nucleo/contrato';
import type { NombreIcono } from '../ui/iconos';

export type IdPermiso = (typeof PERMISOS_ANDROID)[number];
export type EstadoPermiso = 'concedido' | 'pendiente' | 'bloqueado' | 'noAplica';

export type InfoPermiso = {
  id: IdPermiso;
  icono: NombreIcono;
  titulo: () => string;
  porque: () => string;
  /** Versión de Android (API) desde la que existe; antes no se pide. */
  desde?: number;
};

export const INFO_PERMISOS: readonly InfoPermiso[] = [
  {
    id: 'android.permission.RECORD_AUDIO',
    icono: 'microfono',
    titulo: () => tr('Micrófono', 'Microphone'),
    porque: () => tr('Para que AURA te escuche y para tus llamadas y notas de voz.', 'So AURA can hear you, and for your calls and voice notes.'),
  },
  {
    id: 'android.permission.CAMERA',
    icono: 'camara',
    titulo: () => tr('Cámara', 'Camera'),
    porque: () => tr('Para las videollamadas y para que AURA vea lo que le enseñas.', 'For video calls and so AURA can see what you show her.'),
  },
  {
    id: 'android.permission.BLUETOOTH_CONNECT',
    icono: 'bluetooth',
    titulo: () => tr('Audífonos Bluetooth', 'Bluetooth headphones'),
    porque: () => tr('Para hablar y llamar con tus audífonos o el carro.', 'To talk and call with your headphones or car.'),
    desde: 31,
  },
  {
    id: 'android.permission.POST_NOTIFICATIONS',
    icono: 'campana',
    titulo: () => tr('Avisos', 'Notifications'),
    porque: () => tr('Para avisarte de mensajes, llamadas y recordatorios.', 'To let you know about messages, calls and reminders.'),
    desde: 33,
  },
];

const CLAVE_BLOQUEADOS = 'aura.permisos.bloqueados.v1';
let bloqueados: Set<string> | null = null;

async function leerBloqueados(): Promise<Set<string>> {
  if (bloqueados) return bloqueados;
  try {
    const v = JSON.parse((await AsyncStorage.getItem(CLAVE_BLOQUEADOS)) || '[]');
    bloqueados = new Set(Array.isArray(v) ? v.map(String) : []);
  } catch {
    bloqueados = new Set();
  }
  return bloqueados;
}

async function anotarBloqueado(id: string, si: boolean) {
  const b = await leerBloqueados();
  if (si === b.has(id)) return;
  if (si) b.add(id);
  else b.delete(id);
  await AsyncStorage.setItem(CLAVE_BLOQUEADOS, JSON.stringify([...b])).catch(() => {});
}

function versionAndroid(): number {
  return typeof Platform.Version === 'number' ? Platform.Version : parseInt(String(Platform.Version), 10) || 0;
}

export function aplica(info: InfoPermiso): boolean {
  if (Platform.OS !== 'android') return false;
  return !info.desde || versionAndroid() >= info.desde;
}

function infoDe(id: IdPermiso): InfoPermiso {
  return INFO_PERMISOS.find((p) => p.id === id) as InfoPermiso;
}

export async function estadoPermiso(id: IdPermiso): Promise<EstadoPermiso> {
  if (!aplica(infoDe(id))) return 'noAplica';
  try {
    if (await PermissionsAndroid.check(id as Permission)) {
      await anotarBloqueado(id, false);
      return 'concedido';
    }
  } catch {
    return 'pendiente';
  }
  return (await leerBloqueados()).has(id) ? 'bloqueado' : 'pendiente';
}

export async function estadosPermisos(): Promise<Record<IdPermiso, EstadoPermiso>> {
  const r = {} as Record<IdPermiso, EstadoPermiso>;
  for (const p of INFO_PERMISOS) r[p.id] = await estadoPermiso(p.id);
  return r;
}

function traducir(v: string | undefined): EstadoPermiso {
  return v === PermissionsAndroid.RESULTS.GRANTED ? 'concedido' : v === PermissionsAndroid.RESULTS.NEVER_ASK_AGAIN ? 'bloqueado' : 'pendiente';
}

/** Pide uno con el diálogo nativo. Si ya estaba bloqueado, no molesta: devuelve «bloqueado». */
export async function pedirPermiso(id: IdPermiso): Promise<EstadoPermiso> {
  const antes = await estadoPermiso(id);
  if (antes !== 'pendiente') return antes;
  try {
    const e = traducir(await PermissionsAndroid.request(id as Permission));
    await anotarBloqueado(id, e === 'bloqueado');
    return e;
  } catch {
    return 'pendiente';
  }
}

/** «Permitir todo»: un solo viaje al sistema con los que faltan (Android los encadena). */
export async function pedirTodos(): Promise<Record<IdPermiso, EstadoPermiso>> {
  const actuales = await estadosPermisos();
  const faltan = INFO_PERMISOS.filter((p) => actuales[p.id] === 'pendiente').map((p) => p.id);
  if (!faltan.length) return actuales;
  try {
    const r = await PermissionsAndroid.requestMultiple(faltan as Permission[]);
    for (const id of faltan) {
      const e = traducir((r as Record<string, string>)[id]);
      actuales[id] = e;
      await anotarBloqueado(id, e === 'bloqueado');
    }
  } catch {
    /* se queda como estaba: cada fila deja pedirlo sola */
  }
  return actuales;
}

export function listo(e: EstadoPermiso): boolean {
  return e === 'concedido' || e === 'noAplica';
}

/** Los Ajustes del sistema de esta app, para lo que quedó bloqueado. */
export function abrirAjustesSistema() {
  void Linking.openSettings().catch(() => {});
}
