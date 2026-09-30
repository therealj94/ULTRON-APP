/**
 * Lo que se toca en el chat responde al dedo: se hunde un poco con un resorte de Reanimated (en el
 * hilo de la interfaz, sin pasar por React) y, si se pide, vibra suave. Un botón que no reacciona es
 * lo primero que delata que una app «parece web».
 */
import type { ReactNode } from 'react';
import { Pressable, type AccessibilityRole, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import { MEDIDA } from '../../nucleo/tema';

type Props = {
  onPress?: () => void;
  onLongPress?: () => void;
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  /** Estilo de la caja que se hunde (márgenes, posición). */
  caja?: StyleProp<ViewStyle>;
  /** Cuánto se hunde (0,96 por omisión; las filas largas, menos). */
  hundir?: number;
  vibrar?: boolean;
  deshabilitado?: boolean;
  etiqueta?: string;
  rol?: AccessibilityRole;
  ripple?: string;
  hitSlop?: number;
};

export function Tocable({ onPress, onLongPress, children, style, caja, hundir = 0.96, vibrar, deshabilitado, etiqueta, rol = 'button', ripple, hitSlop }: Props) {
  const escala = useSharedValue(1);
  const animado = useAnimatedStyle(() => ({ transform: [{ scale: escala.value }] }), [escala]);
  return (
    <Animated.View style={[caja, animado, deshabilitado && { opacity: 0.4 }]}>
      <Pressable
        onPress={deshabilitado ? undefined : onPress}
        onLongPress={deshabilitado ? undefined : onLongPress}
        onPressIn={() => {
          if (deshabilitado) return;
          escala.value = withTiming(hundir, { duration: 90 });
          if (vibrar) void Haptics.selectionAsync().catch(() => {});
        }}
        onPressOut={() => {
          escala.value = withSpring(1, MEDIDA.resorte.vivo);
        }}
        android_ripple={ripple ? { color: ripple, borderless: false } : undefined}
        accessibilityRole={rol}
        accessibilityLabel={etiqueta}
        accessibilityState={{ disabled: !!deshabilitado }}
        hitSlop={hitSlop}
        style={style}
      >
        {children}
      </Pressable>
    </Animated.View>
  );
}
