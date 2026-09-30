/**
 * La tarjeta: superficie del tema, borde de un pelo, esquinas grandes y una sombra suave que en el
 * tema claro se nota y en el oscuro casi no (ahí el borde hace el trabajo). Con `vidrio` es un panel
 * esmerilado (expo-blur) para ponerlo sobre ilustraciones o degradados. Con `onPress` se hunde al
 * tocarla, como un botón.
 */
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import { BlurView } from 'expo-blur';
import { MEDIDA, useTema, type Paleta } from '../nucleo/tema';
import { vibrar } from './hapticos';

type Props = {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  vidrio?: boolean;
  /** Borde en el color del acento y fondo apenas dorado (la opción elegida). */
  activa?: boolean;
  onPress?: () => void;
  etiqueta?: string;
  relleno?: number;
};

export function sombraDe(tema: Paleta, nivel: 1 | 2 = 1): ViewStyle {
  return {
    shadowColor: '#000',
    shadowOpacity: tema.oscuro ? 0.35 : nivel === 1 ? 0.07 : 0.12,
    shadowRadius: nivel === 1 ? 14 : 24,
    shadowOffset: { width: 0, height: nivel === 1 ? 6 : 12 },
    elevation: tema.oscuro ? 0 : nivel === 1 ? 2 : 6,
  };
}

export function Tarjeta({ children, style, vidrio, activa, onPress, etiqueta, relleno = MEDIDA.espacio.l }: Props) {
  const tema = useTema();
  const escala = useSharedValue(1);
  const a = useAnimatedStyle(() => ({ transform: [{ scale: escala.value }] }));
  const caja: ViewStyle = {
    borderRadius: MEDIDA.radio.l,
    padding: relleno,
    borderWidth: activa ? 1.5 : StyleSheet.hairlineWidth * 2,
    borderColor: activa ? tema.acento : tema.borde,
    backgroundColor: vidrio ? 'transparent' : activa ? tema.acentoFondo : tema.superficie,
    overflow: vidrio ? 'hidden' : 'visible',
    ...sombraDe(tema),
  };
  const dentro = (
    <>
      {vidrio && (
        <>
          <BlurView intensity={40} tint={tema.oscuro ? 'dark' : 'light'} experimentalBlurMethod="dimezisBlurView" style={StyleSheet.absoluteFill} />
          <View style={[StyleSheet.absoluteFill, { backgroundColor: tema.oscuro ? 'rgba(44,46,50,0.55)' : 'rgba(255,255,255,0.6)' }]} />
        </>
      )}
      {children}
    </>
  );
  if (!onPress) return <View style={[caja, style]}>{dentro}</View>;
  return (
    <Animated.View style={[a, style]}>
      <Pressable
        onPress={onPress}
        onPressIn={() => {
          escala.value = withSpring(0.975, MEDIDA.resorte.vivo);
          vibrar('seleccion');
        }}
        onPressOut={() => {
          escala.value = withSpring(1, MEDIDA.resorte.vivo);
        }}
        android_ripple={{ color: tema.acentoFondo }}
        style={caja}
        accessibilityRole="button"
        accessibilityState={{ selected: !!activa }}
        accessibilityLabel={etiqueta}
      >
        {dentro}
      </Pressable>
    </Animated.View>
  );
}
