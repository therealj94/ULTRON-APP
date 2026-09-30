/**
 * El chip: una respuesta rápida que se toca en vez de escribirse («Baleadas», «Tengo hijos»). Al
 * elegirlo se llena de dorado con un resorte y vibra; vuelve a tocarse para soltarlo.
 */
import { Pressable, StyleSheet } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import { MEDIDA, useTema } from '../nucleo/tema';
import { vibrar } from './hapticos';
import { Icono, type NombreIcono } from './Icono';
import { Texto } from './Texto';

type Props = {
  texto: string;
  activo?: boolean;
  onPress: () => void;
  icono?: NombreIcono;
  tam?: 'normal' | 'chico';
};

export function Chip({ texto, activo, onPress, icono, tam = 'normal' }: Props) {
  const tema = useTema();
  const escala = useSharedValue(1);
  const a = useAnimatedStyle(() => ({ transform: [{ scale: escala.value }] }));
  const color = activo ? tema.sobreAcento : tema.texto;
  return (
    <Animated.View style={a}>
      <Pressable
        onPress={() => {
          vibrar('seleccion');
          onPress();
        }}
        onPressIn={() => {
          escala.value = withSpring(0.94, MEDIDA.resorte.vivo);
        }}
        onPressOut={() => {
          escala.value = withSpring(1, MEDIDA.resorte.vivo);
        }}
        style={[
          s.chip,
          tam === 'chico' && s.chico,
          { backgroundColor: activo ? tema.acento : tema.superficie, borderColor: activo ? tema.acento : tema.borde },
        ]}
        accessibilityRole="button"
        accessibilityState={{ selected: !!activo }}
        accessibilityLabel={texto}
        hitSlop={4}
      >
        {icono && <Icono nombre={icono} tam={tam === 'chico' ? 15 : 17} color={activo ? tema.sobreAcento : tema.acentoTexto} />}
        <Texto v={tam === 'chico' ? 'chica' : 'cuerpoFuerte'} color={color} style={tam === 'chico' ? undefined : { fontSize: 14 }}>
          {texto}
        </Texto>
      </Pressable>
    </Animated.View>
  );
}

const s = StyleSheet.create({
  chip: { flexDirection: 'row', alignItems: 'center', gap: 7, minHeight: 40, paddingHorizontal: 15, borderRadius: 20, borderWidth: 1 },
  chico: { minHeight: 32, paddingHorizontal: 12, borderRadius: 16, gap: 5 },
});
