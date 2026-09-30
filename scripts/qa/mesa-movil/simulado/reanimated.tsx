// Reanimated en el banco: cada valor compartido es un objeto con `value`, las animaciones llegan al
// final en el acto (withTiming(1) → 1) y los estilos animados se calculan una vez al dibujar. Una
// captura es un cuadro quieto: lo que se mira es dónde queda cada cosa, no el movimiento.
import { forwardRef, useReducer, useRef } from 'react';
import { Image, ScrollView, Text, View } from 'react-native';

const cadena = (): any => new Proxy(function () {}, { get: (_t, k) => (k === 'then' ? undefined : cadena()), apply: () => cadena() });

/** Un valor compartido: al cambiarlo (desde un efecto), el componente se vuelve a dibujar con él. */
export function useSharedValue<T>(inicial: T) {
  const [, redibujar] = useReducer((x: number) => x + 1, 0);
  const ref = useRef<{ value: T } | null>(null);
  if (!ref.current) {
    let v = inicial;
    ref.current = {
      get value() {
        return v;
      },
      set value(n: T) {
        if (n === v) return;
        v = n;
        queueMicrotask(redibujar);
      },
    };
  }
  return ref.current;
}
export const useDerivedValue = <T,>(f: () => T) => ({ value: f() });
export const useAnimatedStyle = (f: () => object) => f();
export const useAnimatedProps = (f: () => object) => f();
export const useReducedMotion = () => false;
export const withTiming = <T,>(v: T, _o?: unknown, fin?: (ok: boolean) => void) => (fin?.(true), v);
export const withSpring = <T,>(v: T) => v;
export const withDelay = <T,>(_ms: number, v: T) => v;
export const withSequence = <T,>(...vs: T[]) => vs[vs.length - 1];
export const withRepeat = <T,>(v: T) => v;
export const cancelAnimation = () => {};
export const runOnJS = <F,>(f: F) => f;
export const Extrapolation = { CLAMP: 'clamp', EXTEND: 'extend', IDENTITY: 'identity' };
export const interpolate = (x: number, entrada: number[], salida: number[]) => {
  // Por tramos, como Reanimated (con CLAMP en los extremos): [0, 0.6, 1] → [0, 0.4, 1] también.
  if (x <= entrada[0]) return salida[0];
  for (let i = 1; i < entrada.length; i++) {
    if (x <= entrada[i]) {
      const t = (x - entrada[i - 1]) / (entrada[i] - entrada[i - 1] || 1);
      return salida[i - 1] + (salida[i] - salida[i - 1]) * t;
    }
  }
  return salida[salida.length - 1];
};
export const Easing = new Proxy({}, { get: () => (x: unknown) => x });
export const FadeIn = cadena();
export const FadeOut = cadena();
export const FadeInRight = cadena();
export const FadeOutLeft = cadena();
export const SlideInDown = cadena();
export const Layout = cadena();
export const FadeInDown = cadena();
export const FadeInUp = cadena();
export const ZoomIn = cadena();

// Animated.View y compañía, sin las props de animación de entrada/salida.
const sinAnim = (C: any) =>
  forwardRef<any, any>(function Animado({ entering: _e, exiting: _x, layout: _l, ...p }, ref) {
    return <C ref={ref} {...p} />;
  });
const Animated = { View: sinAnim(View), Text: sinAnim(Text), Image: sinAnim(Image), ScrollView: sinAnim(ScrollView), createAnimatedComponent: sinAnim };
export default Animated;
