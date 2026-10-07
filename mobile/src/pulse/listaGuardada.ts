/**
 * LA LISTA DE PULSE2CHAT GUARDADA EN EL TELÉFONO (sin el texto de los mensajes: ver listaSinRed.ts). Sin red,
 * la lista enseña esto con el aviso «sin conexión» en vez de la pantalla vacía de «Agrega a alguien» (A3).
 *
 * Una sola ranura, marcada con el seudónimo de la cuenta del chat; al salir del chat se borra.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { seudonimoDe } from '../lib/cuenta';
import * as RELEVO from './relevo';
import { listaGuardadaDe, paraGuardarLista, type ListaGuardada } from './listaSinRed';

const CAJON = 'aura.p2c.lista.v1';

export async function leerListaGuardada(correo: string): Promise<ListaGuardada | null> {
  const quien = seudonimoDe(correo);
  if (!quien) return null;
  try {
    const t = await AsyncStorage.getItem(CAJON);
    return t ? listaGuardadaDe(JSON.parse(t), quien) : null;
  } catch {
    return null;
  }
}

let ultima = '';
export function guardarLista(correo: string, conversaciones: RELEVO.Conversacion[] | null) {
  const g = paraGuardarLista(seudonimoDe(correo), conversaciones);
  if (!g) return;
  const t = JSON.stringify({ ...g, hora: 0 });
  // Sin cambios (la lista se sondea cada 15 s): no se vuelve a escribir.
  if (t === ultima) return;
  ultima = t;
  void AsyncStorage.setItem(CAJON, JSON.stringify(g)).catch(() => {});
}

// Al salir del chat (o de la cuenta): nada de esta persona queda en el teléfono.
RELEVO.alSalir(() => {
  ultima = '';
  void AsyncStorage.removeItem(CAJON).catch(() => {});
});
