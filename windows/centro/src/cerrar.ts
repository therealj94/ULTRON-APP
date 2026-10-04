import { pedir } from './puente';
import { T } from './estado';

/** Cierra AURA de verdad (con confirmación): el notch, el Centro, la voz y el ícono de la bandeja. */
export async function cerrarAura() {
  if (!confirm(T('¿Cerrar AURA por completo? Deja de escucharte y se quita de la bandeja. La vuelves a abrir desde el menú Inicio.', 'Quit AURA completely? It stops listening and leaves the tray. Reopen it from the Start menu.'))) return;
  await pedir('app.cerrar').catch(() => {});
}
