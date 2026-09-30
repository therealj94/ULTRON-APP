/**
 * PULSE2CHAT para el resto de la app: lo que la navegación 5.0 y la voz necesitan del chat.
 *
 *   · Pantallas: `PantallaChats` (lista) y `PantallaConversacion` (hilo), desacopladas de la
 *     navegación; `PulseChat` las envuelve en una ventana para la mesa.
 *   · El proveedor (`PulseProvider`): cuenta, buzón de señales, llamadas y los manejadores de voz.
 *   · Contactos y borradores: `resolverContacto`, `contactosConocidos`, `contextoChat`.
 */
export { PantallaChats, type PropsPantallaChats } from './PantallaChats';
export { PantallaConversacion, type PropsPantallaConversacion } from './PantallaConversacion';
export { PulseChat } from './PulseChat';
export { PulseProvider, usePulse, usePulseSiHay } from './PulseProvider';
export { resolverContacto, contactosConocidos, escucharConocidos, escucharCuenta, quien, salir, llaveVolatil, senalar, type ErrorSenal, type MotivoSenal } from './relevo';
export {
  borradorActual,
  borradorDe,
  chatAbierto,
  contextoChat,
  enviarBorrador,
  escribirBorrador,
  escucharBorradores,
  useBorrador,
  useBorradores,
  type Borrador,
  type Contacto,
} from './borradores';
export { refrescarLista, useLista, useHilo, enviarTexto } from './chats';
