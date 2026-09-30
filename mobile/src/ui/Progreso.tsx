/**
 * Progreso: la barra de la primera vez (avanza con un resorte, en dorado) y los puntos de página de
 * la bienvenida, que siguen al dedo mientras se desliza: el punto activo se estira y se enciende.
 */
import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { Extrapolation, interpolate, interpolateColor, useAnimatedStyle, useSharedValue, withSpring, type SharedValue } from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';
import { useTema } from '../nucleo/tema';
import { oroDe } from './Boton';

export function BarraProgreso({ valor, alto = 4 }: { valor: number; alto?: number }) {
  const tema = useTema();
  const v = useSharedValue(0);
  useEffect(() => {
    v.value = withSpring(Math.max(0, Math.min(1, valor)), { damping: 20, stiffness: 120 });
  }, [valor, v]);
  const a = useAnimatedStyle(() => ({ width: `${v.value * 100}%` }));
  return (
    <View
      style={[s.pista, { height: alto, borderRadius: alto / 2, backgroundColor: tema.superficie2 }]}
      accessibilityRole="progressbar"
      accessibilityValue={{ min: 0, max: 100, now: Math.round(valor * 100) }}
    >
      <Animated.View style={[{ height: alto, borderRadius: alto / 2, overflow: 'hidden' }, a]}>
        <LinearGradient colors={oroDe(tema.oscuro)} start={{ x: 0, y: 0.5 }} end={{ x: 1, y: 0.5 }} style={StyleSheet.absoluteFill} />
      </Animated.View>
    </View>
  );
}

function Punto({ i, posicion, ancho }: { i: number; posicion: SharedValue<number>; ancho: number }) {
  const tema = useTema();
  const a = useAnimatedStyle(() => {
    const d = Math.abs(posicion.value / Math.max(1, ancho) - i);
    const t = interpolate(d, [0, 1], [1, 0], Extrapolation.CLAMP);
    return { width: 8 + 18 * t, backgroundColor: interpolateColor(t, [0, 1], [tema.borde, tema.acento]) };
  });
  return <Animated.View style={[s.punto, a]} />;
}

/** `posicion` es el desplazamiento horizontal del carrusel; `ancho`, el de una página. */
export function Puntos({ total, posicion, ancho }: { total: number; posicion: SharedValue<number>; ancho: number }) {
  return (
    <View style={s.puntos} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {Array.from({ length: total }, (_, i) => (
        <Punto key={i} i={i} posicion={posicion} ancho={ancho} />
      ))}
    </View>
  );
}

const s = StyleSheet.create({
  pista: { width: '100%', overflow: 'hidden' },
  puntos: { flexDirection: 'row', gap: 7, alignItems: 'center' },
  punto: { height: 8, borderRadius: 4 },
});
