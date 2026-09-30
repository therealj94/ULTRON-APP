/**
 * EL BOTÓN ENVIAR que se vuelve PALOMITA.
 *
 * Al tocarlo, en el acto (el mensaje ya aparece en el hilo mientras viaja): el botón se hunde y
 * rebota, el avión de papel se va y la palomita ✔ SE DIBUJA con Skia —el trazo crece de 0 a 1 en el
 * hilo de la interfaz—, un anillo dorado se abre como una onda y el teléfono da el toque de «hecho».
 * Un segundo después vuelve el avión, listo para el siguiente.
 *
 * Todo con Reanimated: nada de esto vuelve a pintar React cuadro por cuadro.
 */
import { useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withDelay, withSequence, withSpring, withTiming } from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import { MEDIDA, useTema } from '../../nucleo/tema';
import { tr } from '../../i18n';
import { Icono } from './Icono';
import { Tocable } from './Tocable';

type Props = {
  /** Hay algo que enviar. */
  activo: boolean;
  /** Se llama al tocar; la animación arranca a la vez (el hilo ya muestra el mensaje pendiente). */
  onEnviar: () => void;
  tam?: number;
};

export function BotonEnviar({ activo, onEnviar, tam = 46 }: Props) {
  const p = useTema();
  const escala = useSharedValue(1);
  const avion = useSharedValue(1);
  const trazo = useSharedValue(0);
  const palomita = useSharedValue(0);
  // La onda arranca «ya abierta» (invisible); cada envío la vuelve a lanzar desde 0.
  const onda = useSharedValue(1);

  const cajaAnimada = useAnimatedStyle(() => ({ transform: [{ scale: escala.value }] }), [escala]);
  const avionAnimado = useAnimatedStyle(
    () => ({
      opacity: avion.value,
      transform: [{ translateX: (1 - avion.value) * 14 }, { translateY: (avion.value - 1) * 14 }, { scale: 0.6 + avion.value * 0.4 }],
    }),
    [avion],
  );
  const ondaAnimada = useAnimatedStyle(
    () => ({
      opacity: (1 - onda.value) * 0.55,
      transform: [{ scale: 1 + onda.value * 0.75 }],
    }),
    [onda],
  );

  // Mientras se dibuja la palomita el botón sigue encendido aunque la caja ya quedó vacía.
  const [celebrando, setCelebrando] = useState(false);
  const reloj = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (reloj.current) clearTimeout(reloj.current);
    },
    [],
  );

  const tocar = () => {
    if (!activo) return;
    onEnviar();
    setCelebrando(true);
    if (reloj.current) clearTimeout(reloj.current);
    reloj.current = setTimeout(() => setCelebrando(false), 1250);
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    escala.value = withSequence(withTiming(0.84, { duration: 90 }), withSpring(1, MEDIDA.resorte.vivo));
    avion.value = withSequence(withTiming(0, { duration: 140 }), withDelay(980, withTiming(1, { duration: MEDIDA.duracion.normal })));
    trazo.value = 0;
    trazo.value = withDelay(110, withTiming(1, { duration: 340, easing: Easing.out(Easing.cubic) }));
    palomita.value = withSequence(withTiming(1, { duration: 80 }), withDelay(940, withTiming(0, { duration: 200 })));
    onda.value = 0;
    onda.value = withDelay(
      110,
      withTiming(1, {
        duration: MEDIDA.duracion.lenta,
        easing: Easing.out(Easing.quad),
      }),
    );
  };

  const r = tam / 2;
  return (
    <View style={{ width: tam, height: tam }}>
      <Animated.View
        pointerEvents="none"
        style={[
          {
            position: 'absolute',
            width: tam,
            height: tam,
            borderRadius: r,
            borderWidth: 2,
            borderColor: p.acento,
          },
          ondaAnimada,
        ]}
      />
      <Animated.View style={cajaAnimada}>
        <Tocable
          onPress={tocar}
          etiqueta={tr('Enviar', 'Send')}
          deshabilitado={!activo && !celebrando}
          hundir={1}
          style={{
            width: tam,
            height: tam,
            borderRadius: r,
            backgroundColor: p.acento,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Animated.View style={avionAnimado}>
            <Icono nombre="enviar" tam={tam * 0.5} color={p.sobreAcento} grosor={2} />
          </Animated.View>
          <View style={{ position: 'absolute' }} pointerEvents="none">
            <Icono nombre="palomita" tam={tam * 0.56} color={p.sobreAcento} grosor={2.6} fin={trazo} opacidad={palomita} />
          </View>
        </Tocable>
      </Animated.View>
    </View>
  );
}
