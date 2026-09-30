/**
 * La cabecera grande que colapsa: el título arriba, en la serif, grande como el de Ajustes del
 * sistema; al desplazar sube y se desvanece mientras aparece la barra compacta de vidrio con el mismo
 * título en chico. Todo en el hilo de la interfaz (un manejador de scroll de Reanimated): sigue al
 * dedo sin saltos.
 *
 *   <PantallaConCabecera titulo="Ajustes" onAtras={navigation.goBack}>…</PantallaConCabecera>
 */
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { Extrapolation, interpolate, useAnimatedScrollHandler, useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import { BlurView } from 'expo-blur';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { tr } from '../i18n';
import { MEDIDA, useTema } from '../nucleo/tema';
import { vibrar } from './hapticos';
import { Icono, type NombreIcono } from './Icono';
import { Texto } from './Texto';

export const ALTO_BARRA = 56;

/** El botón redondo de las barras (atrás, cerrar): 44 de toque, fondo de superficie. */
export function BotonRedondo({ icono = 'atras', onPress, etiqueta, tam = 42 }: { icono?: NombreIcono; onPress: () => void; etiqueta?: string; tam?: number }) {
  const tema = useTema();
  const e = useSharedValue(1);
  const a = useAnimatedStyle(() => ({ transform: [{ scale: e.value }] }));
  return (
    <Animated.View style={a}>
      <Pressable
        onPress={() => {
          vibrar('seleccion');
          onPress();
        }}
        onPressIn={() => {
          e.value = withSpring(0.9, MEDIDA.resorte.vivo);
        }}
        onPressOut={() => {
          e.value = withSpring(1, MEDIDA.resorte.vivo);
        }}
        hitSlop={8}
        style={[s.redondo, { width: tam, height: tam, borderRadius: tam / 2, backgroundColor: tema.superficie, borderColor: tema.borde }]}
        accessibilityRole="button"
        accessibilityLabel={etiqueta || (icono === 'cerrar' ? tr('Cerrar', 'Close') : tr('Atrás', 'Back'))}
      >
        <Icono nombre={icono} tam={20} color={tema.texto} />
      </Pressable>
    </Animated.View>
  );
}

type Props = {
  titulo: string;
  subtitulo?: string;
  onAtras?: () => void;
  derecha?: ReactNode;
  children: ReactNode;
  contenidoStyle?: StyleProp<ViewStyle>;
};

export function PantallaConCabecera({ titulo, subtitulo, onAtras, derecha, children, contenidoStyle }: Props) {
  const tema = useTema();
  const ins = useSafeAreaInsets();
  const y = useSharedValue(0);
  const alScroll = useAnimatedScrollHandler((e) => {
    y.value = e.contentOffset.y;
  });
  const aBarra = useAnimatedStyle(() => ({ opacity: interpolate(y.value, [10, 60], [0, 1], Extrapolation.CLAMP) }));
  const aTituloChico = useAnimatedStyle(() => ({
    opacity: interpolate(y.value, [44, 80], [0, 1], Extrapolation.CLAMP),
    transform: [{ translateY: interpolate(y.value, [44, 80], [8, 0], Extrapolation.CLAMP) }],
  }));
  const aTituloGrande = useAnimatedStyle(() => ({
    opacity: interpolate(y.value, [0, 70], [1, 0], Extrapolation.CLAMP),
    // Al tirar hacia abajo el título crece un poco desde la izquierda, como el del sistema.
    transform: [
      { translateY: interpolate(y.value, [-120, 0, 80], [30, 0, -18], Extrapolation.CLAMP) },
      { scale: interpolate(y.value, [-120, 0], [1.12, 1], Extrapolation.CLAMP) },
    ],
  }));
  const altoBarra = ins.top + ALTO_BARRA;

  return (
    <View style={[s.raiz, { backgroundColor: tema.fondo }]}>
      <Animated.ScrollView
        onScroll={alScroll}
        scrollEventThrottle={16}
        contentContainerStyle={[{ paddingTop: altoBarra + 4, paddingBottom: ins.bottom + 40, paddingHorizontal: MEDIDA.espacio.l }, contenidoStyle]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <Animated.View style={[s.tituloGrande, aTituloGrande]}>
          <Texto v="heroe" accessibilityRole="header">
            {titulo}
          </Texto>
          {!!subtitulo && (
            <Texto v="cuerpo" color="texto2" style={{ marginTop: 6 }}>
              {subtitulo}
            </Texto>
          )}
        </Animated.View>
        {children}
      </Animated.ScrollView>

      <View style={[s.barra, { height: altoBarra, paddingTop: ins.top }]} pointerEvents="box-none">
        <Animated.View style={[StyleSheet.absoluteFill, aBarra]} pointerEvents="none">
          <BlurView intensity={50} tint={tema.oscuro ? 'dark' : 'light'} experimentalBlurMethod="dimezisBlurView" style={StyleSheet.absoluteFill} />
          <View style={[StyleSheet.absoluteFill, { backgroundColor: tema.oscuro ? 'rgba(28,29,32,0.72)' : 'rgba(247,243,236,0.78)' }]} />
          <View style={[s.linea, { backgroundColor: tema.borde }]} />
        </Animated.View>
        <View style={s.filaBarra} pointerEvents="box-none">
          <View style={s.lado}>{onAtras && <BotonRedondo onPress={onAtras} />}</View>
          <Animated.View style={[s.centro, aTituloChico]} pointerEvents="none">
            <Texto v="cuerpoFuerte" numberOfLines={1}>
              {titulo}
            </Texto>
          </Animated.View>
          <View style={[s.lado, { alignItems: 'flex-end' }]}>{derecha}</View>
        </View>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  raiz: { flex: 1 },
  redondo: { alignItems: 'center', justifyContent: 'center', borderWidth: StyleSheet.hairlineWidth * 2 },
  tituloGrande: { paddingTop: 8, paddingBottom: 22, paddingHorizontal: 4, transformOrigin: 'left' },
  barra: { position: 'absolute', top: 0, left: 0, right: 0 },
  linea: { position: 'absolute', left: 0, right: 0, bottom: 0, height: StyleSheet.hairlineWidth },
  filaBarra: { flex: 1, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12 },
  lado: { width: 64 },
  centro: { flex: 1, alignItems: 'center' },
});
