/**
 * La vibración de la app: un solo lugar para todas las microinteracciones.
 *
 * Cada toque dice algo distinto: `seleccion` (elegir un chip, cambiar de pestaña), `suave` (hundir un
 * botón), `medio` (elegir una tarjeta grande), `exito` (la palomita ✔ que se completa), `aviso` y
 * `error`. Se apaga desde Ajustes («Vibración») y queda guardado en el teléfono: quien la apaga no
 * vuelve a sentir nada en ninguna pantalla, porque todas pasan por aquí.
 */
import { useSyncExternalStore } from 'react';
import * as Haptics from 'expo-haptics';
import AsyncStorage from '@react-native-async-storage/async-storage';

export type Toque = 'seleccion' | 'suave' | 'medio' | 'fuerte' | 'exito' | 'aviso' | 'error';

const CLAVE = 'aura.hapticos.v1';
let activos = true;
const oyentes = new Set<() => void>();

export function vibrar(t: Toque = 'seleccion') {
  if (!activos) return;
  const p =
    t === 'seleccion'
      ? Haptics.selectionAsync()
      : t === 'suave'
        ? Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
        : t === 'medio'
          ? Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)
          : t === 'fuerte'
            ? Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy)
            : Haptics.notificationAsync(
                t === 'exito' ? Haptics.NotificationFeedbackType.Success : t === 'aviso' ? Haptics.NotificationFeedbackType.Warning : Haptics.NotificationFeedbackType.Error
              );
  void p?.catch?.(() => {});
}

export function hapticosActivos(): boolean {
  return activos;
}

export async function fijarHapticos(si: boolean) {
  if (si === activos) return;
  activos = si;
  for (const f of oyentes) f();
  await AsyncStorage.setItem(CLAVE, si ? '1' : '0').catch(() => {});
}

/** Se lee una vez al arrancar; sin dato, vibra (lo normal en un teléfono). */
export async function cargarHapticos() {
  try {
    const v = await AsyncStorage.getItem(CLAVE);
    if (v === '0') {
      activos = false;
      for (const f of oyentes) f();
    }
  } catch {
    /* se queda encendida */
  }
}

export function useHapticos(): boolean {
  return useSyncExternalStore(
    (f) => {
      oyentes.add(f);
      return () => oyentes.delete(f);
    },
    () => activos,
    () => activos
  );
}
