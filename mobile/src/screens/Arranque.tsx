/**
 * LA INTRO: «PULSE 2CHAT × AURA — powered by ORDEN GLOBAL».
 *
 * Una apertura de cine, corta: sobre negro se enciende el aura dorada (halo que respira, anillo que
 * gira, motas que orbitan), las letras de PULSE 2CHAT suben una por una, cae el «×» y AURA aparece
 * en oro con un brillo que la cruza, como la luz sobre una moneda. Abajo, «powered by ORDEN GLOBAL»
 * y una línea dorada que avanza con lo que de verdad se está cargando (sesión, perfil, avatares,
 * voces, servidor), no con un reloj.
 *
 * Dura ~2,4 s la primera vez y ~1,2 s si ya hay sesión (`rapido`). Al terminar (`salir`), el aura se
 * abre hacia afuera, todo se desvanece y avisa `onFin`: la navegación funde a la pantalla siguiente.
 *
 * Es oscura en los dos temas a propósito: el arranque nativo de Android es negro y el paso de uno a
 * otro no se nota. Todo se mueve en el hilo de la interfaz (Reanimated + Skia).
 */
import { useEffect } from 'react';
import { StyleSheet, View, useWindowDimensions } from 'react-native';
import Animated, { Easing, interpolate, useAnimatedStyle, useDerivedValue, useSharedValue, withDelay, withTiming, type SharedValue } from 'react-native-reanimated';
import { Canvas, Group, LinearGradient, Text as SkTexto, useFont, vec } from '@shopify/react-native-skia';
import { LinearGradient as Degradado } from 'expo-linear-gradient';
import { scheduleOnRN } from 'react-native-worklets';
import { Aura } from '../ui/Aura';
import { Texto } from '../ui/Texto';
import { fuente, fuenteDisplay } from '../ui/tipografia';

/** Se conserva el tipo de antes: la intro sigue mostrando pasos reales. */
export type PasoArranque = { id: string; texto: string; hecho: boolean };

type Props = {
  /** 0..1, lo que va cargado. */
  progreso: number;
  /** Qué se está cargando ahora («Afinando las voces»). */
  texto: string;
  version: string;
  /** Si algo no se pudo (sin red), se dice aquí en vez de quedarse girando. */
  aviso?: string;
  /** Ya hay sesión: la misma apertura, a doble velocidad. */
  rapido?: boolean;
  /** true = terminar: el aura se abre y se funde. */
  salir?: boolean;
  onFin?: () => void;
};

const ORO = '#D6B56C';
const ORO_CLARO = '#FFF1CC';
const MARFIL = '#ECE8E2';
const PULSE = 'PULSE 2CHAT';

function Letra({ c, i, t0, paso, avance, tam }: { c: string; i: number; t0: number; paso: number; avance: SharedValue<number>; tam: number }) {
  const a = useAnimatedStyle(() => {
    const inicio = t0 + i * paso;
    const p = interpolate(avance.value, [inicio, inicio + 380], [0, 1], 'clamp');
    return { opacity: p, transform: [{ translateY: (1 - p) * 14 }] };
  });
  return (
    <Animated.Text style={[s.letra, fuente('extra'), { fontSize: tam, letterSpacing: tam * 0.38 }, a]} allowFontScaling={false}>
      {c === ' ' ? ' ' : c}
    </Animated.Text>
  );
}

/** «AURA» en oro de verdad (degradado de Skia) con el brillo que la cruza. */
function Marca({ ancho, alto, tam, brillo }: { ancho: number; alto: number; tam: number; brillo: SharedValue<number> }) {
  const f = useFont(require('../../assets/fuentes/CormorantGaramond-SemiBold.ttf'), tam);
  const pos = useDerivedValue(() => {
    const b = brillo.value;
    return [0, Math.max(0.001, b - 0.12), b, Math.min(0.999, b + 0.12), 1];
  });
  if (!f) {
    // Mientras Skia lee la fuente (décimas), la misma palabra con la serif del sistema.
    return (
      <Texto v="marca" color={ORO} centro style={{ fontSize: tam, lineHeight: alto, letterSpacing: tam * 0.12 }} allowFontScaling={false}>
        AURA
      </Texto>
    );
  }
  const texto = 'AURA';
  // Espaciado de marca: cada letra por su lado, con aire.
  const aire = tam * 0.12;
  const anchos = texto.split('').map((l) => f.getGlyphWidths(f.getGlyphIDs(l)).reduce((x, y) => x + y, 0));
  const total = anchos.reduce((x, y) => x + y, 0) + aire * (texto.length - 1);
  let x = (ancho - total) / 2;
  const base = alto * 0.78;
  return (
    <Canvas style={{ width: ancho, height: alto }} pointerEvents="none">
      <Group>
        {texto.split('').map((l, i) => {
          const xi = x;
          x += anchos[i] + aire;
          return <SkTexto key={i} x={xi} y={base} text={l} font={f} />;
        })}
        <LinearGradient start={vec((ancho - total) / 2, 0)} end={vec((ancho + total) / 2, alto)} colors={['#B8913F', '#E9CF8E', ORO_CLARO, '#E9CF8E', '#A8832F']} positions={pos} />
      </Group>
    </Canvas>
  );
}

export function Arranque({ progreso, texto, version, aviso, rapido, salir, onFin }: Props) {
  const { width, height } = useWindowDimensions();
  const horizontal = width > height;
  // Acostado, el pie ocupa la parte de abajo: el aura se achica y sube para no pisarlo.
  const tamAura = horizontal ? Math.min(300, height * 0.64) : Math.min(360, width * 0.92, height * 0.5);
  const tamMarca = Math.round(tamAura * 0.2);
  const vel = rapido ? 0.55 : 1;

  /** El reloj de la apertura en milisegundos (todo lo demás se deriva de aquí). */
  const avance = useSharedValue(0);
  const encendido = useSharedValue(0);
  const expansion = useSharedValue(0);
  const brillo = useSharedValue(0);
  const fundido = useSharedValue(1);
  const barra = useSharedValue(0);

  useEffect(() => {
    const total = 2000;
    avance.value = withTiming(total, { duration: total * vel, easing: Easing.linear });
    encendido.value = withTiming(1, { duration: 900 * vel, easing: Easing.out(Easing.cubic) });
    brillo.value = withDelay(900 * vel, withTiming(1, { duration: 1100 * vel, easing: Easing.inOut(Easing.cubic) }));
  }, [avance, encendido, brillo, vel]);

  useEffect(() => {
    barra.value = withTiming(Math.max(0, Math.min(1, progreso)), { duration: 420, easing: Easing.out(Easing.cubic) });
  }, [progreso, barra]);

  useEffect(() => {
    if (!salir) return;
    expansion.value = withTiming(1, { duration: 620, easing: Easing.in(Easing.cubic) });
    fundido.value = withTiming(0, { duration: 520, easing: Easing.in(Easing.quad) }, (fin) => {
      if (fin && onFin) scheduleOnRN(onFin);
    });
  }, [salir, expansion, fundido, onFin]);

  const aPor = useAnimatedStyle(() => {
    const p = interpolate(avance.value, [650, 900], [0, 1], 'clamp');
    return { opacity: p, transform: [{ scale: 0.6 + 0.4 * p }, { rotate: `${(1 - p) * -90}deg` }] };
  });
  const aMarca = useAnimatedStyle(() => {
    const p = interpolate(avance.value, [760, 1300], [0, 1], 'clamp');
    return { opacity: p, transform: [{ scale: 0.94 + 0.06 * p }, { translateY: (1 - p) * 10 }] };
  });
  const aPie = useAnimatedStyle(() => ({ opacity: interpolate(avance.value, [1150, 1600], [0, 1], 'clamp') }));
  const aContenido = useAnimatedStyle(() => ({ opacity: fundido.value, transform: [{ scale: 1 + (1 - fundido.value) * 0.07 }] }));
  const aBarra = useAnimatedStyle(() => ({ width: `${barra.value * 100}%` }));

  return (
    <Animated.View style={[StyleSheet.absoluteFill, s.raiz]} accessibilityLabel="PULSE 2CHAT × AURA, powered by ORDEN GLOBAL" accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: 100, now: Math.round(progreso * 100) }}>
      <Degradado colors={['#0B0B0D', '#16171A', '#0B0B0D']} locations={[0, 0.5, 1]} style={StyleSheet.absoluteFill} />
      <View style={[s.centro, horizontal && { paddingBottom: 96 }]} pointerEvents="none">
        <View style={{ width: tamAura, height: tamAura, alignItems: 'center', justifyContent: 'center' }}>
          <View style={StyleSheet.absoluteFill}>
            <Aura tam={tamAura} particulas={34} color={ORO} colorClaro={ORO_CLARO} encendido={encendido} expansion={expansion} />
          </View>
          <Animated.View style={[s.pila, aContenido]}>
            <View style={s.filaLetras}>
              {PULSE.split('').map((c, i) => (
                <Letra key={i} c={c} i={i} t0={220} paso={38} avance={avance} tam={Math.max(10, Math.round(tamAura * 0.037))} />
              ))}
            </View>
            <Animated.Text style={[s.por, fuente('medio'), aPor]} allowFontScaling={false}>
              ×
            </Animated.Text>
            <Animated.View style={aMarca}>
              <Marca ancho={tamAura} alto={Math.round(tamMarca * 1.2)} tam={tamMarca} brillo={brillo} />
            </Animated.View>
          </Animated.View>
        </View>
      </View>

      <Animated.View style={[s.pie, horizontal && s.pieHorizontal, aPie, aContenido]} pointerEvents="none">
        <View style={s.powered}>
          <Texto v="mini" color="rgba(236,232,226,0.5)" style={{ letterSpacing: 1.2 }} allowFontScaling={false}>
            powered by
          </Texto>
          <Texto v="cuerpo" color={MARFIL} style={[fuenteDisplay(), s.orden]} allowFontScaling={false}>
            ORDEN GLOBAL
          </Texto>
        </View>
        <View style={s.pista}>
          <Animated.View style={[s.relleno, aBarra]}>
            <Degradado colors={['#8E6C24', ORO, ORO_CLARO]} start={{ x: 0, y: 0.5 }} end={{ x: 1, y: 0.5 }} style={StyleSheet.absoluteFill} />
          </Animated.View>
        </View>
        <Texto v="chica" color={aviso ? '#E39A7A' : 'rgba(236,232,226,0.55)'} centro numberOfLines={2} style={s.paso}>
          {aviso || texto}
        </Texto>
        <Texto v="mini" color="rgba(236,232,226,0.28)" centro>
          v{version}
        </Texto>
      </Animated.View>
    </Animated.View>
  );
}

const s = StyleSheet.create({
  raiz: { backgroundColor: '#0B0B0D', zIndex: 50 },
  centro: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  pila: { alignItems: 'center', justifyContent: 'center' },
  filaLetras: { flexDirection: 'row' },
  letra: { color: MARFIL, fontSize: 13, letterSpacing: 5, includeFontPadding: false },
  por: { color: ORO, fontSize: 22, lineHeight: 26, marginTop: 4, marginBottom: -4 },
  pie: { position: 'absolute', left: 0, right: 0, bottom: 34, alignItems: 'center', gap: 10 },
  pieHorizontal: { bottom: 14, gap: 6 },
  powered: { alignItems: 'center', gap: 1, marginBottom: 6 },
  orden: { fontSize: 17, lineHeight: 20, letterSpacing: 4 },
  pista: { width: 148, height: 2, borderRadius: 1, backgroundColor: 'rgba(236,232,226,0.12)', overflow: 'hidden' },
  relleno: { height: 2, borderRadius: 1, overflow: 'hidden' },
  paso: { maxWidth: 300, minHeight: 18 },
});
