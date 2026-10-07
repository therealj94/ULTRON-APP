/**
 * La paleta de la mesa de los avatares (Grafito, elegida el 25-sep; la misma de la web, src/11-sala/tema.css).
 *
 * Ya no es una paleta aparte (auditoría M5): los colores salen del único juego de tokens de la app,
 * src/nucleo/tema.ts (`MESA`, derivada de `OSCURO`). Se reexporta aquí con su nombre de siempre para quien
 * ya la usaba (la mesa, su chat, la barra, el menú).
 */
export { MESA as T, SOMBRA } from './nucleo/tema';
