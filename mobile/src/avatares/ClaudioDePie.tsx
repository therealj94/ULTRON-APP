/**
 * Claudio de cuerpo entero, de pie.
 *
 * La ilustración de José sin fondo (assets/avatares/claudio-pie) y tres cuadros de boca sacados de
 * la misma foto (scripts/avatares-claudio.py). Como está parado, su pantalla completa es la
 * vertical. Respira, se mece desde los pies, brinca apenas y mueve la boca al ritmo de la voz. Una
 * sombra en el piso lo asienta: sin ella flota. Por ahora no cambia de cara con la emoción (no hay
 * fotos de cuerpo entero con otras caras); el retrato sí.
 */
import { memo, useEffect, useRef, useState } from 'react';
import { Animated, Easing, Pressable, StyleSheet, View, type ImageSourcePropType, type LayoutChangeEvent } from 'react-native';
import type { FaceState } from '../caraTipos';
import { aperturaBoca, fotoCuerpo, type FotoCuerpo } from './expresiones';

const FOTOS: Record<FotoCuerpo, ImageSourcePropType> = {
  base: require('../../assets/avatares/claudio-pie/base.webp'),
  cierra: require('../../assets/avatares/claudio-pie/cierra.webp'),
  habla1: require('../../assets/avatares/claudio-pie/habla1.webp'),
  habla2: require('../../assets/avatares/claudio-pie/habla2.webp'),
};
const ORDEN: FotoCuerpo[] = ['base', 'cierra', 'habla1', 'habla2'];

export const FOTOS_CLAUDIO_PIE = FOTOS;

type Props = {
  face: FaceState;
  gazeX?: number;
  speechLevelSource?: (cb: (nivel: number) => void) => () => void;
  onTap?: () => void;
  onLongPress?: () => void;
};

function ClaudioDePieBase({ face, gazeX = 0, speechLevelSource, onTap, onLongPress }: Props) {
  const opac = useRef(Object.fromEntries(ORDEN.map((f) => [f, new Animated.Value(f === 'base' ? 1 : 0)])) as Record<FotoCuerpo, Animated.Value>).current;
  const respira = useRef(new Animated.Value(0)).current;
  const mece = useRef(new Animated.Value(0)).current;
  const brinco = useRef(new Animated.Value(0)).current;
  const mira = useRef(new Animated.Value(0)).current;
  const apertura = useRef(-1);
  // La caja con la proporción de la foto (2:3), lo más grande que quepa: los pies quedan en su borde.
  const [lugar, setLugar] = useState({ w: 0, h: 0 });
  const medir = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    if (Math.abs(width - lugar.w) > 1 || Math.abs(height - lugar.h) > 1) setLugar({ w: width, h: height });
  };
  const altoCaja = Math.min(lugar.h * 0.9, lugar.w * 1.5);
  const cajaTam = { height: altoCaja, width: (altoCaja * 2) / 3 };

  /** La boca salta de cuadro sin fundido: fundida, se ven dos bocas a la vez. */
  const mostrar = (f: FotoCuerpo) => ORDEN.forEach((k) => opac[k].setValue(k === f ? 1 : 0));

  useEffect(() => {
    const r = Animated.loop(
      Animated.sequence([
        Animated.timing(respira, { toValue: 1, duration: 2100, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        Animated.timing(respira, { toValue: 0, duration: 2100, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      ])
    );
    const m = Animated.loop(
      Animated.sequence([
        Animated.timing(mece, { toValue: 1, duration: 3800, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        Animated.timing(mece, { toValue: -1, duration: 3800, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      ])
    );
    r.start();
    m.start();
    return () => {
      r.stop();
      m.stop();
    };
  }, [respira, mece]);

  // Sin otras caras de cuerpo entero, la emoción se dice con el cuerpo: un salto de sorpresa o de risa.
  const salto = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (face !== 'SURPRISED' && face !== 'STARTLE' && face !== 'LAUGH' && face !== 'HAPPY') return;
    const alto = face === 'HAPPY' ? 0.5 : 1;
    Animated.sequence([
      Animated.timing(salto, { toValue: alto, duration: 140, easing: Easing.out(Easing.quad), useNativeDriver: true }),
      Animated.spring(salto, { toValue: 0, useNativeDriver: true, speed: 14, bounciness: 10 }),
    ]).start();
  }, [face, salto]);

  useEffect(() => {
    Animated.spring(mira, { toValue: gazeX, useNativeDriver: true, speed: 5, bounciness: 2 }).start();
  }, [gazeX, mira]);

  useEffect(() => {
    if (!speechLevelSource) return;
    return speechLevelSource((nivel) => {
      brinco.setValue(nivel);
      // En silencio sonríe (su foto de siempre); con voz, la boca sigue el nivel.
      const n = nivel <= 0.02 ? -1 : aperturaBoca(nivel, Math.max(0, apertura.current));
      if (n === apertura.current) return;
      apertura.current = n;
      mostrar(fotoCuerpo(n >= 0, Math.max(0, n)));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [speechLevelSource, brinco]);

  // Todo pivota desde los pies: el cuerpo se ancla abajo y la escala crece hacia arriba.
  const cuerpo = [
    {
      translateY: Animated.add(
        Animated.add(respira.interpolate({ inputRange: [0, 1], outputRange: [0, -3] }), brinco.interpolate({ inputRange: [0, 1], outputRange: [0, -10] })),
        salto.interpolate({ inputRange: [0, 1], outputRange: [0, -36] })
      ),
    },
    { translateX: mira.interpolate({ inputRange: [-1, 1], outputRange: [-8, 8] }) },
    // Mecerse y mirar suman un solo giro (los grados no se suman como texto).
    { rotate: Animated.add(mece, mira).interpolate({ inputRange: [-2, 2], outputRange: ['-2.7deg', '2.7deg'] }) },
    { scaleY: respira.interpolate({ inputRange: [0, 1], outputRange: [1, 1.01] }) },
  ];

  return (
    <Pressable onPress={onTap} onLongPress={onLongPress} delayLongPress={500} onLayout={medir} style={styles.raiz} accessibilityRole="imagebutton" accessibilityLabel="Claudio de pie">
      <View pointerEvents="none" style={styles.halo} />
      {/* La caja tiene la proporción de la foto (2:3): así los pies quedan en su borde de abajo y la sombra, debajo de ellos. */}
      <View pointerEvents="none" style={[styles.caja, cajaTam]}>
        <Animated.View style={[styles.sombra, { transform: [{ scaleX: brinco.interpolate({ inputRange: [0, 1], outputRange: [1, 0.88] }) }] }]} />
        <Animated.View style={[StyleSheet.absoluteFill, { transform: cuerpo }]}>
          {ORDEN.map((f) => (
            <Animated.Image key={f} source={FOTOS[f]} resizeMode="contain" style={[styles.foto, { opacity: opac[f] }]} fadeDuration={0} />
          ))}
        </Animated.View>
      </View>
    </Pressable>
  );
}

export const ClaudioDePie = memo(ClaudioDePieBase);

const styles = StyleSheet.create({
  raiz: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'flex-end', overflow: 'hidden' },
  halo: { position: 'absolute', top: '12%', width: '90%', aspectRatio: 1, borderRadius: 9999, backgroundColor: 'rgba(214,181,108,0.08)' },
  caja: { marginBottom: '5%' },
  sombra: { position: 'absolute', bottom: -6, left: '22%', width: '56%', height: 16, borderRadius: 9999, backgroundColor: 'rgba(0,0,0,0.32)' },
  foto: { ...StyleSheet.absoluteFillObject, width: undefined, height: undefined },
});
