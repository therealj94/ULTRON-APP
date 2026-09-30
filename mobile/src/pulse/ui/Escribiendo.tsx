/**
 * «Escribiendo…»: la burbuja de la otra persona con tres puntos que saltan en ola. Cada punto es un
 * valor de Reanimated con su retraso; se para solo al desmontarse.
 */
import { useEffect } from 'react';
import { View } from 'react-native';
import Animated, { cancelAnimation, Easing, useAnimatedStyle, useSharedValue, withDelay, withRepeat, withSequence, withTiming, type SharedValue } from 'react-native-reanimated';
import { MEDIDA, useTema } from '../../nucleo/tema';

function Punto({ v, color }: { v: SharedValue<number>; color: string }) {
  const st = useAnimatedStyle(() => ({ opacity: 0.35 + v.value * 0.65, transform: [{ translateY: -v.value * 3.5 }] }), [v]);
  return <Animated.View style={[{ width: 7, height: 7, borderRadius: 3.5, backgroundColor: color, marginHorizontal: 2.5 }, st]} />;
}

export function Escribiendo() {
  const p = useTema();
  const a = useSharedValue(0);
  const b = useSharedValue(0);
  const c = useSharedValue(0);
  useEffect(() => {
    const ola = (v: SharedValue<number>, retraso: number) => {
      v.value = withDelay(
        retraso,
        withRepeat(withSequence(withTiming(1, { duration: 300, easing: Easing.out(Easing.quad) }), withTiming(0, { duration: 300, easing: Easing.in(Easing.quad) }), withTiming(0, { duration: 300 })), -1)
      );
    };
    ola(a, 0);
    ola(b, 150);
    ola(c, 300);
    return () => {
      cancelAnimation(a);
      cancelAnimation(b);
      cancelAnimation(c);
    };
  }, [a, b, c]);
  return (
    <View
      style={{
        alignSelf: 'flex-start',
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: p.burbujaOtro,
        borderRadius: MEDIDA.radio.l,
        borderBottomLeftRadius: 6,
        paddingHorizontal: 14,
        height: 38,
        marginTop: MEDIDA.espacio.s,
        marginBottom: MEDIDA.espacio.xs,
      }}
      accessibilityLabel="escribiendo"
    >
      <Punto v={a} color={p.texto2} />
      <Punto v={b} color={p.texto2} />
      <Punto v={c} color={p.texto2} />
    </View>
  );
}
