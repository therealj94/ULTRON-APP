/**
 * Aparecer: lo que entra en pantalla llega con un resorte (se funde y se desliza unos puntos), no de
 * golpe. Con `retraso` se escalonan listas y tarjetas: el ojo sigue el orden en que se leen.
 *
 *   <Aparecer retraso={80 * i}><Tarjeta …/></Aparecer>
 *
 * Cambiar `clave` lo vuelve a reproducir (p. ej. al pasar de una pregunta a la siguiente).
 */
import { useEffect, type ReactNode } from 'react';
import type { StyleProp, ViewStyle } from 'react-native';
import Animated, { interpolate, useAnimatedStyle, useSharedValue, withDelay, withSpring, withTiming } from 'react-native-reanimated';
import { MEDIDA } from '../nucleo/tema';

type Props = {
  children: ReactNode;
  retraso?: number;
  desde?: 'abajo' | 'arriba' | 'derecha' | 'izquierda' | 'escala';
  distancia?: number;
  clave?: string | number;
  style?: StyleProp<ViewStyle>;
};

export function Aparecer({ children, retraso = 0, desde = 'abajo', distancia = 18, clave, style }: Props) {
  const p = useSharedValue(0);
  useEffect(() => {
    p.value = 0;
    p.value = withDelay(retraso, withSpring(1, MEDIDA.resorte.suave));
  }, [retraso, clave, p]);
  const op = useSharedValue(0);
  useEffect(() => {
    op.value = 0;
    op.value = withDelay(retraso, withTiming(1, { duration: MEDIDA.duracion.normal }));
  }, [retraso, clave, op]);

  const a = useAnimatedStyle(() => {
    const d = interpolate(p.value, [0, 1], [distancia, 0]);
    const t =
      desde === 'abajo'
        ? [{ translateY: d }]
        : desde === 'arriba'
          ? [{ translateY: -d }]
          : desde === 'derecha'
            ? [{ translateX: d }]
            : desde === 'izquierda'
              ? [{ translateX: -d }]
              : [{ scale: interpolate(p.value, [0, 1], [0.92, 1]) }];
    return { opacity: op.value, transform: t };
  });
  return <Animated.View style={[a, style]}>{children}</Animated.View>;
}
