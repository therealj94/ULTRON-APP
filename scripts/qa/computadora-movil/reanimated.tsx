// Reanimated del banco de la mesa, más lo que usa el Campo de la hoja (interpolateColor: el color del final del tramo
// más cercano; una captura es un cuadro quieto).
export * from '../mesa-movil/simulado/reanimated';
export { default } from '../mesa-movil/simulado/reanimated';
export const interpolateColor = (x: number, entrada: number[], salida: string[]) => (x >= (entrada[entrada.length - 1] + entrada[0]) / 2 ? salida[salida.length - 1] : salida[0]);
export const useAnimatedScrollHandler = () => undefined;
export const useAnimatedRef = () => ({ current: null });
export const measure = () => null;
export const scrollTo = () => {};
