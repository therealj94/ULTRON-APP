/**
 * La pantalla de carga: del ícono a la app sin corte.
 *
 * El arranque nativo de Android dibuja el planeta de AU-RA centrado sobre grafito antes de que exista
 * JavaScript. Esta pantalla pone el MISMO planeta en el MISMO lugar y tamaño, así que el paso del
 * nativo a la app no se nota: el planeta empieza a flotar, su anillo se enciende, sube el nombre y
 * debajo se ve qué se está cargando de verdad (sesión, avatares, voces, servidor), con una barra que
 * avanza con los pasos reales, no con un reloj.
 */
import { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, Text, View } from 'react-native';
import { T } from '../tema';
import { tr } from '../i18n';

export type PasoArranque = { id: string; texto: string; hecho: boolean };

type Props = {
  pasos: PasoArranque[];
  version: string;
  opacity?: Animated.Value;
  /** Si algo no se pudo (sin red), se dice aquí en vez de quedarse girando. */
  aviso?: string;
};

/** El mismo lado que el arranque nativo (plugin expo-splash-screen, imageWidth 220). */
export const LADO_PLANETA = 220;

export function Arranque({ pasos, version, opacity, aviso }: Props) {
  const flota = useRef(new Animated.Value(0)).current;
  const halo = useRef(new Animated.Value(0)).current;
  const nombre = useRef(new Animated.Value(0)).current;
  const barra = useRef(new Animated.Value(0)).current;

  const hechos = pasos.filter((p) => p.hecho).length;
  const actual = pasos.find((p) => !p.hecho);

  useEffect(() => {
    const f = Animated.loop(
      Animated.sequence([
        Animated.timing(flota, { toValue: 1, duration: 1600, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        Animated.timing(flota, { toValue: 0, duration: 1600, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      ])
    );
    const h = Animated.loop(
      Animated.sequence([
        Animated.timing(halo, { toValue: 1, duration: 1300, easing: Easing.out(Easing.quad), useNativeDriver: true }),
        Animated.timing(halo, { toValue: 0, duration: 1300, easing: Easing.in(Easing.quad), useNativeDriver: true }),
      ])
    );
    f.start();
    h.start();
    Animated.timing(nombre, { toValue: 1, duration: 700, delay: 250, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
    return () => {
      f.stop();
      h.stop();
    };
  }, [flota, halo, nombre]);

  useEffect(() => {
    Animated.timing(barra, { toValue: pasos.length ? hechos / pasos.length : 0, duration: 380, easing: Easing.out(Easing.quad), useNativeDriver: false }).start();
  }, [hechos, pasos.length, barra]);

  return (
    <Animated.View style={[s.raiz, opacity ? { opacity } : null]} pointerEvents={opacity ? 'none' : 'auto'}>
      {/* El planeta queda centrado exacto, como el nativo; lo demás se acomoda debajo sin moverlo. */}
      <View style={s.centro}>
        <Animated.View style={[s.halo, { opacity: halo.interpolate({ inputRange: [0, 1], outputRange: [0.05, 0.2] }), transform: [{ scale: halo.interpolate({ inputRange: [0, 1], outputRange: [0.92, 1.08] }) }] }]} />
        <Animated.Image
          source={require('../../assets/splash-icon.png')}
          resizeMode="contain"
          accessibilityLabel="AU-RA"
          style={[s.planeta, { transform: [{ translateY: flota.interpolate({ inputRange: [0, 1], outputRange: [0, -6] }) }] }]}
        />
      </View>
      <Animated.View style={[s.debajo, { opacity: nombre, transform: [{ translateY: nombre.interpolate({ inputRange: [0, 1], outputRange: [14, 0] }) }] }]}>
        <Text style={s.marca}>AU-RA</Text>
        <Text style={s.lema}>by Orden Global</Text>
        <View style={s.pista}>
          <Animated.View style={[s.relleno, { width: barra.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] }) }]} />
        </View>
        <Text style={[s.paso, !!aviso && s.aviso]} accessibilityLiveRegion="polite">
          {aviso || actual?.texto || tr('Listo', 'Ready')}
        </Text>
      </Animated.View>
      <Text style={s.version}>v{version}</Text>
    </Animated.View>
  );
}

const s = StyleSheet.create({
  raiz: { ...StyleSheet.absoluteFillObject, backgroundColor: T.fondo, alignItems: 'center', justifyContent: 'center' },
  centro: { width: LADO_PLANETA, height: LADO_PLANETA, alignItems: 'center', justifyContent: 'center' },
  halo: { position: 'absolute', width: LADO_PLANETA * 0.78, height: LADO_PLANETA * 0.78, borderRadius: LADO_PLANETA, backgroundColor: 'rgba(214,181,108,0.35)' },
  planeta: { width: LADO_PLANETA, height: LADO_PLANETA },
  // Debajo del planeta, sin empujarlo: posición absoluta desde el centro de la pantalla.
  debajo: { position: 'absolute', top: '50%', marginTop: LADO_PLANETA / 2 - 6, alignItems: 'center', width: 280 },
  marca: { color: T.texto, fontSize: 30, fontWeight: '800', letterSpacing: 6 },
  lema: { color: T.texto3, fontSize: 12, letterSpacing: 2, marginTop: 2 },
  pista: { width: 180, height: 3, borderRadius: 2, backgroundColor: T.panel, marginTop: 18, overflow: 'hidden' },
  relleno: { height: 3, borderRadius: 2, backgroundColor: T.principal },
  paso: { color: T.texto2, fontSize: 13, marginTop: 10 },
  aviso: { color: T.avisoTexto },
  version: { position: 'absolute', bottom: 18, color: T.texto3, fontSize: 11 },
});
