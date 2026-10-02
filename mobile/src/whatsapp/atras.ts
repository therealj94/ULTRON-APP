/**
 * «Atrás» con un chat de WhatsApp abierto: lo cierra a él, no la ventana de los chats. En un Modal
 * (PulseChat) el botón del sistema llega a `onRequestClose`, no a BackHandler: por eso la ventana
 * pregunta aquí primero.
 */
const manejadores: Array<() => boolean> = [];

export function registrarAtras(f: () => boolean): () => void {
  manejadores.push(f);
  return () => {
    const i = manejadores.lastIndexOf(f);
    if (i >= 0) manejadores.splice(i, 1);
  };
}

/** true si algo de WhatsApp lo atendió (había un chat abierto). */
export function atrasWhatsapp(): boolean {
  for (let i = manejadores.length - 1; i >= 0; i--) if (manejadores[i]()) return true;
  return false;
}
