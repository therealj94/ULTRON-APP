/**
 * LA LISTA DE WHATSAPP GUARDADA EN EL TELÉFONO: la de la última vez que contestó el servidor. Sin red, la pestaña
 * sigue a la vista y enseña esto con el aviso «sin conexión» (auditoría A3), en vez de desaparecer o girar sin fin.
 *
 * Una sola ranura, marcada con el seudónimo de la cuenta (lib/cuenta): otra cuenta no la lee, y al salir o entrar
 * otra persona se borra. Los mensajes de WhatsApp ya viven en el servidor de AU-RA (no son de punta a punta): aquí
 * solo va la lista (nombre, hora y la vista previa del último), como la que ya estaba en pantalla.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { alCambiarCuenta, seudonimoActual } from '../lib/cuenta';
import { guardadoWADe, paraGuardarWA, type ChatWA, type EstadoWA, type GuardadoWA } from './logica';

const CAJON = 'aura.wa.guardado.v1';

export async function leerGuardadoWA(): Promise<GuardadoWA | null> {
  const quien = seudonimoActual();
  if (!quien) return null;
  try {
    const t = await AsyncStorage.getItem(CAJON);
    return t ? guardadoWADe(JSON.parse(t), quien) : null;
  } catch {
    return null;
  }
}

export function guardarWA(estado: EstadoWA | null, chats: ChatWA[] | null) {
  const g = paraGuardarWA(seudonimoActual(), estado, chats);
  if (g) void AsyncStorage.setItem(CAJON, JSON.stringify(g)).catch(() => {});
}

/**
 * Salir o entrar otra persona: lo de la anterior no se queda en el teléfono. Al arrancar (la sesión guardada vuelve
 * a fijar la MISMA cuenta) se conserva: es justo lo que hace falta para verlo sin red.
 */
export async function soltarAjenoWA() {
  const quien = seudonimoActual();
  try {
    const t = await AsyncStorage.getItem(CAJON);
    if (t && !guardadoWADe(JSON.parse(t), quien)) await AsyncStorage.removeItem(CAJON);
  } catch {
    await AsyncStorage.removeItem(CAJON).catch(() => {});
  }
}

alCambiarCuenta(() => void soltarAjenoWA());
