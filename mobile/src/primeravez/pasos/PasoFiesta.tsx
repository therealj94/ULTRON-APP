/**
 * (h) La celebración: confeti dorado que cae, la palomita grande que se dibuja, «¡Todo listo!» y el
 * avatar elegido esperando. El botón de abajo (lo pone la primera vez) lleva a la mesa.
 */
import { useEffect, useMemo } from 'react';
import { StyleSheet, View, useWindowDimensions } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withDelay, withRepeat, withTiming } from 'react-native-reanimated';
import { de, tr } from '../../i18n';
import { MEDIDA, useTema } from '../../nucleo/tema';
import { avatarPorId } from '../../avatares/catalogo';
import { Aparecer, BotonCheck, Texto, vibrar } from '../../ui';
import { VistaAvatar } from '../piezas';
import type { PropsPaso } from './tipos';

type Papel = { x: number; retraso: number; dur: number; tam: number; giro: number; color: string; vaiven: number };

function Confeti({ p, alto }: { p: Papel; alto: number }) {
  const t = useSharedValue(0);
  useEffect(() => {
    t.value = withDelay(p.retraso, withRepeat(withTiming(1, { duration: p.dur, easing: Easing.linear }), -1, false));
  }, [t, p]);
  const a = useAnimatedStyle(() => ({
    opacity: t.value < 0.02 ? 0 : 1 - t.value * 0.6,
    transform: [
      { translateY: -40 + t.value * (alto + 80) },
      { translateX: Math.sin(t.value * Math.PI * 4) * p.vaiven },
      { rotate: `${t.value * p.giro}deg` },
    ],
  }));
  return <Animated.View style={[{ position: 'absolute', left: p.x, top: 0, width: p.tam, height: p.tam * 0.45, borderRadius: 2, backgroundColor: p.color }, a]} />;
}

/** La lluvia de confeti, a pantalla completa (la pone la primera vez encima de todo, sin tocar nada). */
export function LluviaConfeti({ avatar }: { avatar: PropsPaso['borrador']['avatar'] }) {
  const tema = useTema();
  const { width, height } = useWindowDimensions();
  const a = avatarPorId(avatar);
  const papeles = useMemo<Papel[]>(() => {
    const colores = [tema.acento, tema.acentoTexto, '#FFF1CC', a.tema.acento, tema.exito];
    let semilla = 11;
    const azar = () => {
      semilla = (semilla * 16807) % 2147483647;
      return (semilla - 1) / 2147483646;
    };
    return Array.from({ length: 34 }, (_, i) => ({
      x: azar() * width,
      retraso: azar() * 1400,
      dur: 2600 + azar() * 2200,
      tam: 8 + azar() * 8,
      giro: (azar() < 0.5 ? -1 : 1) * (360 + azar() * 540),
      color: colores[i % colores.length],
      vaiven: 8 + azar() * 22,
    }));
  }, [width, tema, a]);
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      {papeles.map((p, i) => (
        <Confeti key={i} p={p} alto={height} />
      ))}
    </View>
  );
}

export function PasoFiesta({ borrador }: PropsPaso) {
  const { width } = useWindowDimensions();
  const a = avatarPorId(borrador.avatar);
  useEffect(() => {
    vibrar('exito');
  }, []);
  return (
    <View style={{ gap: MEDIDA.espacio.xl, alignItems: 'center' }}>
      <Aparecer desde="escala">
        <BotonCheck hecho animarAlMontar={250} tam={76} vibra={false} />
      </Aparecer>
      <View style={{ gap: 8 }}>
        <Aparecer retraso={200}>
          <Texto v="heroe" centro accessibilityRole="header">
            {tr(`¡Todo listo, ${borrador.apodo.trim()}!`, `All set, ${borrador.apodo.trim()}!`)}
          </Texto>
        </Aparecer>
        <Aparecer retraso={320}>
          <Texto v="grande" color="texto2" centro>
            {tr(`${de(a.nombre)} ya te conoce un poquito y te espera en la mesa.`, `${de(a.nombre)} already knows you a little and is waiting at the desk.`)}
          </Texto>
        </Aparecer>
      </View>
      <Aparecer retraso={450} desde="escala">
        <VistaAvatar id={borrador.avatar} tam={Math.min(220, width * 0.55)} />
      </Aparecer>
    </View>
  );
}
