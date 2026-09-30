// Los dobles chicos del banco de la mesa (cada alias de vite.config.mts apunta a un archivo propio que
// re-exporta de aquí lo suyo).
import type { ReactNode } from 'react';
import { View } from 'react-native';

// react-native-worklets: lo que se agenda en el hilo de JS se llama en el acto.
export const scheduleOnRN = (f: (...a: unknown[]) => void, ...a: unknown[]) => f(...a);

// expo-haptics: sin vibración en el navegador.
export const impactAsync = async () => {};
export const notificationAsync = async () => {};
export const selectionAsync = async () => {};
export const ImpactFeedbackStyle = { Light: 'light', Medium: 'medium', Heavy: 'heavy' };
export const NotificationFeedbackType = { Success: 'success', Warning: 'warning', Error: 'error' };

// expo-font: las fuentes del sistema del navegador.
export const loadAsync = async () => {};
export const isLoaded = () => true;

// expo-blur
export const BlurView = View;

// react-native-safe-area-context: un teléfono típico con barra de gestos (24 arriba, 16 abajo).
export const useSafeAreaInsets = () => ({ top: 24, bottom: 16, left: 0, right: 0 });
export const initialWindowMetrics = { insets: { top: 24, bottom: 16, left: 0, right: 0 }, frame: { x: 0, y: 0, width: 0, height: 0 } };
export const SafeAreaProvider = ({ children }: { children: ReactNode }) => <>{children}</>;

// react-native-gesture-handler: Gesture.Pan()… devuelve más cadena; el detector solo pinta a sus hijos.
const cadena = (): any => new Proxy(function () {}, { get: (_t, k) => (k === 'then' ? undefined : cadena()), apply: () => cadena() });
export const Gesture = cadena();
export const GestureDetector = ({ children }: { children: ReactNode }) => <>{children}</>;
export const GestureHandlerRootView = View;

// AsyncStorage en memoria.
const m = new Map<string, string>();
export const almacen = {
  getItem: async (k: string) => m.get(k) ?? null,
  setItem: async (k: string, v: string) => void m.set(k, v),
  removeItem: async (k: string) => void m.delete(k),
};

// expo-keep-awake: la pantalla del navegador no se apaga.
export const activateKeepAwakeAsync = async () => {};
export const deactivateKeepAwake = async () => {};
