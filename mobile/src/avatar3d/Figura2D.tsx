/**
 * EL CUERPO 2D DE AURA fuera del paseo: la misma figurita de la compañera (compa/figura.ts +
 * pintarCompa.ts), quieta en su lugar y del tamaño que haga falta, para el panel al lado de los chats
 * y la pantalla completa. Recibe el mismo estado que el cuerpo 3D (PropsCuerpo) y es su respaldo:
 * si no hay modelo o falla, es esto lo que se ve.
 *
 * Lo vivo se mueve como en la compañera: respira, parpadea, la boca sigue a la voz (senalVoz), el
 * anillo late cuando le hablan (nivelOido), los zzz y los puntitos. Claudio va con su retrato.
 */
import { useEffect, useMemo } from 'react';
import { Image, StyleSheet, View } from 'react-native';
import { Canvas, Picture, Skia } from '@shopify/react-native-skia';
import Animated, { Easing, cancelAnimation, useAnimatedStyle, useDerivedValue, useReducedMotion, useSharedValue, withRepeat, withSequence, withSpring, withTiming } from 'react-native-reanimated';
import { FOTOS_CLAUDIO } from '../avatares/ClaudioRetrato';
import { FIGURAS, VIVO_QUIETO, estiloDe, fotoClaudio, medidas, mezclarFigura, type Figura } from '../compa/figura';
import { grabarCompa, grabarVacioCompa } from '../compa/pintarCompa';
import { nivelOido } from '../compa/canales';
import { senalVoz } from './senalVoz';
import type { PropsCuerpo } from './contrato';

export function Figura2D({ avatar, estado, ancho, alto }: PropsCuerpo) {
  const reducido = useReducedMotion();
  const lado = Math.max(40, Math.min(ancho, alto));
  const M = useMemo(() => medidas(lado), [lado]);
  const estilo = useMemo(() => estiloDe(avatar), [avatar]);
  const exp = estado.expresion;

  const desde = useSharedValue<Figura>(FIGURAS.tranquila);
  const hacia = useSharedValue<Figura>(FIGURAS.tranquila);
  const mezcla = useSharedValue(1);
  const parpadeo = useSharedValue(1);
  const respira = useSharedValue(0.5);
  const latido = useSharedValue(0.5);
  const fase = useSharedValue(0);
  const voz = useSharedValue(0);
  const oido = useSharedValue(0);
  const dedoX = useSharedValue(0);
  const dedoY = useSharedValue(0);
  const dedo = useSharedValue(0);

  // La cara: una sola curva de la expresión anterior a la nueva.
  useEffect(() => {
    desde.value = mezclarFigura(desde.value, hacia.value, mezcla.value);
    hacia.value = FIGURAS[exp];
    mezcla.value = 0;
    mezcla.value = withTiming(1, { duration: exp === 'uy' || exp === 'enojada' ? 140 : 280, easing: Easing.out(Easing.cubic) });
  }, [exp, desde, hacia, mezcla]);

  // Adónde mira (la mirada del estado, como el dedo en la compañera).
  const { x: mx, y: my, activa } = estado.mirar;
  useEffect(() => {
    dedoX.value = withSpring(activa ? mx : 0, { stiffness: 160, damping: 18 });
    dedoY.value = withSpring(activa ? my : 0, { stiffness: 160, damping: 18 });
    dedo.value = withTiming(activa ? 1 : 0, { duration: 200 });
  }, [activa, mx, my, dedo, dedoX, dedoY]);

  // Parpadeo (dormida no parpadea).
  const dormida = exp === 'dormida';
  useEffect(() => {
    if (dormida) return;
    let vivo = true;
    let t: ReturnType<typeof setTimeout>;
    const programar = () => {
      t = setTimeout(() => {
        if (!vivo) return;
        parpadeo.value = withSequence(withTiming(0.08, { duration: 70 }), withTiming(1, { duration: 90 }));
        programar();
      }, 2800 + Math.random() * 3200);
    };
    programar();
    return () => {
      vivo = false;
      clearTimeout(t);
    };
  }, [dormida, parpadeo]);

  // Respira y late (con «menos movimiento», quieta); la fase de los zzz y los puntitos.
  useEffect(() => {
    if (reducido) {
      respira.value = 0.5;
      latido.value = 0.5;
      return;
    }
    respira.value = withRepeat(withTiming(1, { duration: dormida ? 2600 : 1700, easing: Easing.inOut(Easing.sin) }), -1, true);
    latido.value = withRepeat(withTiming(1, { duration: 1400, easing: Easing.inOut(Easing.sin) }), -1, true);
    return () => {
      cancelAnimation(respira);
      cancelAnimation(latido);
    };
  }, [dormida, reducido, respira, latido]);
  const conFase = (exp === 'dormida' || exp === 'piensa') && !reducido;
  useEffect(() => {
    if (!conFase) return;
    fase.value = 0;
    fase.value = withRepeat(withTiming(1, { duration: exp === 'dormida' ? 3000 : 1400, easing: Easing.linear }), -1, false);
    return () => cancelAnimation(fase);
  }, [conFase, exp, fase]);

  // La boca y el oído, sin pasar por React.
  useEffect(() => senalVoz.boca.escuchar((b) => (voz.value = withTiming(b.nivel, { duration: 60 }))), [voz]);
  useEffect(() => nivelOido.escuchar((l) => (oido.value = withTiming(l, { duration: 80 }))), [oido]);

  const cuadro = useDerivedValue(() => {
    try {
      return grabarCompa(
        Skia,
        M,
        mezclarFigura(desde.value, hacia.value, mezcla.value),
        { ...VIVO_QUIETO, parpadeo: parpadeo.value, respira: respira.value, voz: voz.value, oido: oido.value, dedoX: dedoX.value, dedoY: dedoY.value, dedo: dedo.value, fase: fase.value, latido: latido.value },
        estilo
      );
    } catch {
      return grabarVacioCompa(Skia);
    }
  }, [M, estilo]);

  // El retrato de Claudio con el mismo encuadre que en la compañera (allí, 9 px bajados sobre 52).
  const ladoFoto = M.R * 1.86;
  const hablaOpac = useAnimatedStyle(() => ({ opacity: voz.value > 0.18 ? 1 : 0 }));

  return (
    <View style={[s.caja, { width: ancho, height: alto }]} pointerEvents="none">
      <View style={{ width: lado, height: lado }}>
        <Canvas style={{ width: lado, height: lado }}>
          <Picture picture={cuadro} />
        </Canvas>
        {estilo.retrato ? (
          <View style={[s.retrato, { width: ladoFoto, height: ladoFoto, borderRadius: ladoFoto / 2, left: M.cx - ladoFoto / 2, top: M.cy - ladoFoto / 2 }]}>
            <Image source={FOTOS_CLAUDIO[fotoClaudio(exp)]} style={[s.foto, { transform: [{ scale: 1.5 }, { translateY: ladoFoto * 0.172 }] }]} resizeMode="cover" />
            {fotoClaudio(exp) === 'base' ? (
              <Animated.Image source={FOTOS_CLAUDIO.habla[1]} style={[s.foto, StyleSheet.absoluteFill, { transform: [{ scale: 1.5 }, { translateY: ladoFoto * 0.172 }] }, hablaOpac]} resizeMode="cover" />
            ) : null}
          </View>
        ) : null}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  caja: { alignItems: 'center', justifyContent: 'center' },
  retrato: { position: 'absolute', overflow: 'hidden', backgroundColor: '#1F1B18' },
  foto: { width: '100%', height: '100%' },
});
