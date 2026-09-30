/**
 * La hoja inferior: sube desde abajo con un resorte sobre un velo, se cierra arrastrándola hacia
 * abajo (sigue al dedo; si se suelta con impulso o pasó el tercio, se va), tocando el velo o con el
 * «atrás» de Android. Es la forma nativa de pedir un dato sin cambiar de pantalla: el apodo, el
 * cumpleaños, confirmar «cerrar sesión».
 *
 * Va en un Modal transparente para quedar encima de todo, y con su propia raíz de gestos (en Android
 * un Modal es otra ventana y no hereda la de la app).
 */
import { useEffect, useState, type ReactNode } from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';
import Animated, { Easing, interpolate, useAnimatedStyle, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import { scheduleOnRN } from 'react-native-worklets';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MEDIDA, useTema } from '../nucleo/tema';
import { vibrar } from './hapticos';
import { sombraDe } from './Tarjeta';
import { Texto } from './Texto';

type Props = {
  visible: boolean;
  onCerrar: () => void;
  titulo?: string;
  subtitulo?: string;
  children: ReactNode;
};

export function Hoja({ visible, onCerrar, titulo, subtitulo, children }: Props) {
  const tema = useTema();
  const ins = useSafeAreaInsets();
  const { height, width } = useWindowDimensions();
  const [montada, setMontada] = useState(visible);
  const y = useSharedValue(height);
  const arrastre = useSharedValue(0);

  useEffect(() => {
    if (visible) {
      setMontada(true);
      arrastre.value = 0;
      y.value = height;
      y.value = withSpring(0, { damping: 20, stiffness: 190, mass: 0.9 });
    } else if (montada) {
      y.value = withTiming(height, { duration: 240, easing: Easing.in(Easing.cubic) }, (fin) => {
        if (fin) scheduleOnRN(setMontada, false);
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const cerrar = () => {
    vibrar('suave');
    onCerrar();
  };

  const pan = Gesture.Pan()
    .activeOffsetY(8)
    .onUpdate((e) => {
      arrastre.value = Math.max(0, e.translationY);
    })
    .onEnd((e) => {
      if (e.translationY > 140 || e.velocityY > 900) scheduleOnRN(cerrar);
      else arrastre.value = withSpring(0, MEDIDA.resorte.suave);
    });

  const aHoja = useAnimatedStyle(() => ({ transform: [{ translateY: y.value + arrastre.value }] }));
  const aVelo = useAnimatedStyle(() => ({ opacity: interpolate(y.value + arrastre.value, [0, height * 0.6], [1, 0]) }));

  if (!montada) return null;
  const ancha = width > 640;
  return (
    <Modal visible transparent animationType="none" statusBarTranslucent navigationBarTranslucent onRequestClose={cerrar}>
      <GestureHandlerRootView style={{ flex: 1 }}>
        <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: tema.velo }, aVelo]}>
          <Pressable style={StyleSheet.absoluteFill} onPress={cerrar} accessibilityRole="button" accessibilityLabel="Cerrar" />
        </Animated.View>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={s.abajo} pointerEvents="box-none">
          <GestureDetector gesture={pan}>
            <Animated.View
              style={[
                s.hoja,
                { backgroundColor: tema.fondo, paddingBottom: ins.bottom + MEDIDA.espacio.xl, borderColor: tema.borde, maxHeight: height * 0.9 },
                ancha && { width: 560, alignSelf: 'center' },
                sombraDe(tema, 2),
                aHoja,
              ]}
            >
              <View style={[s.asa, { backgroundColor: tema.borde }]} />
              {(!!titulo || !!subtitulo) && (
                <View style={s.cabeza}>
                  {!!titulo && (
                    <Texto v="titulo" accessibilityRole="header">
                      {titulo}
                    </Texto>
                  )}
                  {!!subtitulo && (
                    <Texto v="cuerpo" color="texto2">
                      {subtitulo}
                    </Texto>
                  )}
                </View>
              )}
              {children}
            </Animated.View>
          </GestureDetector>
        </KeyboardAvoidingView>
      </GestureHandlerRootView>
    </Modal>
  );
}

const s = StyleSheet.create({
  abajo: { flex: 1, justifyContent: 'flex-end' },
  hoja: { borderTopLeftRadius: MEDIDA.radio.xl, borderTopRightRadius: MEDIDA.radio.xl, paddingHorizontal: MEDIDA.espacio.xl, paddingTop: 10, borderWidth: StyleSheet.hairlineWidth * 2, borderBottomWidth: 0 },
  asa: { width: 40, height: 5, borderRadius: 3, alignSelf: 'center', marginBottom: 14, opacity: 0.9 },
  cabeza: { gap: 6, marginBottom: MEDIDA.espacio.l },
});
