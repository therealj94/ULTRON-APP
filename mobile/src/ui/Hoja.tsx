/**
 * La hoja inferior: sube desde abajo con un resorte sobre un velo, se cierra arrastrándola hacia
 * abajo (sigue al dedo; si se suelta con impulso o pasó el tercio, se va), tocando el velo o con el
 * «atrás» de Android. Es la forma nativa de pedir un dato sin cambiar de pantalla: el apodo, el
 * cumpleaños, confirmar «cerrar sesión».
 *
 * Va en un Modal transparente para quedar encima de todo, y con su propia raíz de gestos (en Android
 * un Modal es otra ventana y no hereda la de la app).
 *
 * Lo de adentro va en un ScrollView: una hoja larga (los correos con sus servidores a mano) se recorre
 * con el dedo, también con el teclado abierto. Antes no había cómo bajar y el botón «Conectar» y el
 * error quedaban fuera de la pantalla (José, 2-oct). Por eso se arrastra para cerrar solo desde el asa
 * y el título: el arrastre en el contenido es para recorrerlo. La altura máxima es la del espacio que
 * deja el teclado (porcentaje del contenedor que achica KeyboardAvoidingView), no la de la pantalla.
 */
import { useEffect, useState, type ReactNode } from 'react';
import { Keyboard, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';
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
  /** Lo que queda fijo abajo, fuera del desplazamiento (un mando que siempre se debe poder tocar: Detener). */
  pie?: ReactNode;
};

export function Hoja({ visible, onCerrar, titulo, subtitulo, children, pie }: Props) {
  const tema = useTema();
  const ins = useSafeAreaInsets();
  const { height, width } = useWindowDimensions();
  const [montada, setMontada] = useState(visible);
  const y = useSharedValue(height);
  const arrastre = useSharedValue(0);
  // Android de pantalla completa (edge-to-edge) a veces no achica la ventana del Modal con el teclado:
  // por si acaso, lo que mide el teclado se suma al final del contenido, para poder subir el último
  // campo y el botón por encima. Si la ventana sí se achicó, solo queda un espacio vacío al final.
  const [teclado, setTeclado] = useState(0);
  useEffect(() => {
    if (Platform.OS !== 'android' || !visible) return;
    const a = Keyboard.addListener('keyboardDidShow', (e) => setTeclado(e.endCoordinates?.height || 0));
    const b = Keyboard.addListener('keyboardDidHide', () => setTeclado(0));
    return () => {
      a.remove();
      b.remove();
      setTeclado(0);
    };
  }, [visible]);

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
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={[s.abajo, { paddingTop: ins.top + 12 }]} pointerEvents="box-none">
          <Animated.View
            style={[
              s.hoja,
              { backgroundColor: tema.fondo, borderColor: tema.borde, maxHeight: '100%' },
              ancha && { width: 560, alignSelf: 'center' },
              sombraDe(tema, 2),
              aHoja,
            ]}
          >
            <GestureDetector gesture={pan}>
              <View collapsable={false} style={s.agarre}>
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
              </View>
            </GestureDetector>
            <ScrollView
              style={s.contenido}
              contentContainerStyle={{ paddingHorizontal: MEDIDA.espacio.xl, paddingBottom: (pie ? MEDIDA.espacio.l : ins.bottom + MEDIDA.espacio.xl) + teclado }}
              keyboardShouldPersistTaps="handled"
              keyboardDismissMode="none"
              showsVerticalScrollIndicator
            >
              {children}
            </ScrollView>
            {pie ? <View style={[s.pie, { borderTopColor: tema.borde, paddingBottom: ins.bottom + MEDIDA.espacio.m }]}>{pie}</View> : null}
          </Animated.View>
        </KeyboardAvoidingView>
      </GestureHandlerRootView>
    </Modal>
  );
}

const s = StyleSheet.create({
  abajo: { flex: 1, justifyContent: 'flex-end' },
  hoja: { borderTopLeftRadius: MEDIDA.radio.xl, borderTopRightRadius: MEDIDA.radio.xl, paddingTop: 10, borderWidth: StyleSheet.hairlineWidth * 2, borderBottomWidth: 0, overflow: 'hidden' },
  agarre: { paddingHorizontal: MEDIDA.espacio.xl },
  contenido: { flexGrow: 0, flexShrink: 1 },
  asa: { width: 40, height: 5, borderRadius: 3, alignSelf: 'center', marginBottom: 14, opacity: 0.9 },
  cabeza: { gap: 6, marginBottom: MEDIDA.espacio.l },
  pie: { paddingHorizontal: MEDIDA.espacio.xl, paddingTop: MEDIDA.espacio.m, borderTopWidth: StyleSheet.hairlineWidth },
});
