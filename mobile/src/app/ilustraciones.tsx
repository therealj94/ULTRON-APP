/**
 * Las ilustraciones vivas de la bienvenida. Cada una recibe `p`: dónde está su página respecto a la
 * pantalla (0 = en el centro, −1 = una a la izquierda, 1 = una a la derecha), y sus capas se mueven a
 * distinta velocidad con el dedo (parallax): lo del fondo va lento, lo de adelante rápido. Además se
 * mueven solas (respiran, flotan, orbitan) para que la pantalla no parezca una foto.
 *
 *   IlustracionHabla   el aura con las barras de su voz y su globo de «Hola»
 *   IlustracionChat    dos burbujas, el candado del cifrado y la llamada que late
 *   IlustracionConoce  AURA al centro y lo que sabe de ti orbitando (cumple, música, comida, familia)
 */
import { useEffect, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { Easing, interpolate, useAnimatedStyle, useSharedValue, withDelay, withRepeat, withSequence, withTiming, type SharedValue } from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';
import { tr } from '../i18n';
import { useTema } from '../nucleo/tema';
import { MiniAvatar } from '../avatares/MiniAvatar';
import { Aura, conAlfa } from '../ui/Aura';
import { oroDe } from '../ui/Boton';
import { Icono, type NombreIcono } from '../ui/Icono';
import { sombraDe } from '../ui/Tarjeta';
import { Texto } from '../ui/Texto';

type Props = { p: SharedValue<number>; tam: number };

/** Una capa que se desplaza con el dedo `factor` veces el ancho de la ilustración. */
function Capa({ p, tam, factor, children, style }: { p: SharedValue<number>; tam: number; factor: number; children: ReactNode; style?: object }) {
  const a = useAnimatedStyle(() => ({
    transform: [{ translateX: p.value * tam * factor }],
    opacity: interpolate(Math.abs(p.value), [0, 0.8], [1, 0], 'clamp'),
  }));
  return <Animated.View style={[StyleSheet.absoluteFill, s.centrado, style, a]} pointerEvents="none">{children}</Animated.View>;
}

/** Un vaivén vertical suave (flotar). */
function useFlotar(amplitud: number, ms: number, retraso = 0) {
  const v = useSharedValue(0);
  useEffect(() => {
    v.value = withDelay(retraso, withRepeat(withTiming(1, { duration: ms, easing: Easing.inOut(Easing.sin) }), -1, true));
  }, [v, ms, retraso]);
  return useAnimatedStyle(() => ({ transform: [{ translateY: (v.value - 0.5) * 2 * amplitud }] }));
}

/* ── 1. AURA habla contigo ────────────────────────────────────────────────────────────────── */

function Barra({ i, alto, color }: { i: number; alto: number; color: string }) {
  const v = useSharedValue(0.3);
  useEffect(() => {
    const d = 260 + ((i * 97) % 5) * 70;
    v.value = withDelay(i * 60, withRepeat(withSequence(withTiming(1, { duration: d }), withTiming(0.25, { duration: d })), -1, true));
  }, [v, i]);
  const a = useAnimatedStyle(() => ({ height: 6 + v.value * alto }));
  return <Animated.View style={[{ width: 5, borderRadius: 3, backgroundColor: color }, a]} />;
}

export function IlustracionHabla({ p, tam }: Props) {
  const tema = useTema();
  const flota = useFlotar(6, 2200);
  const barras = [0.35, 0.6, 0.9, 1, 0.75, 1, 0.9, 0.6, 0.35];
  return (
    <View style={{ width: tam, height: tam }}>
      <Capa p={p} tam={tam} factor={0.25}>
        <Aura tam={tam * 0.92} particulas={22} color={tema.acento} colorClaro={tema.oscuro ? '#FFF1CC' : '#F3E0B0'} />
      </Capa>
      <Capa p={p} tam={tam} factor={0.55}>
        <View style={[s.barras, { marginTop: tam * 0.02 }]}>
          {barras.map((b, i) => (
            <Barra key={i} i={i} alto={tam * 0.16 * b} color={i % 2 ? tema.acento : tema.acentoTexto} />
          ))}
        </View>
      </Capa>
      <Capa p={p} tam={tam} factor={1.1} style={{ alignItems: 'flex-end', justifyContent: 'flex-start', paddingTop: tam * 0.08, paddingRight: tam * 0.02 }}>
        <Animated.View style={[s.globo, { backgroundColor: tema.superficie, borderColor: tema.borde }, sombraDe(tema, 2), flota]}>
          <Icono nombre="volumen" tam={16} color={tema.acentoTexto} />
          <Texto v="chicaFuerte">{tr('¡Hola! ¿Cómo va tu día?', 'Hi! How’s your day?')}</Texto>
        </Animated.View>
      </Capa>
      <Capa p={p} tam={tam} factor={0.8} style={{ alignItems: 'flex-start', justifyContent: 'flex-end', paddingBottom: tam * 0.1, paddingLeft: tam * 0.04 }}>
        <View style={[s.pastilla, { backgroundColor: tema.acentoFondo }]}>
          <Icono nombre="microfono" tam={15} color={tema.acentoTexto} />
          <Texto v="mini" color="acentoTexto">
            {tr('Te escucha', 'Listening')}
          </Texto>
        </View>
      </Capa>
    </View>
  );
}

/* ── 2. Chatea y llama cifrado ────────────────────────────────────────────────────────────── */

function Onda({ retraso, lado, color }: { retraso: number; lado: number; color: string }) {
  const v = useSharedValue(0);
  useEffect(() => {
    v.value = withDelay(retraso, withRepeat(withTiming(1, { duration: 2000, easing: Easing.out(Easing.quad) }), -1, false));
  }, [v, retraso]);
  const a = useAnimatedStyle(() => ({ opacity: 0.55 * (1 - v.value), transform: [{ scale: 1 + v.value * 0.9 }] }));
  return <Animated.View style={[{ position: 'absolute', width: lado, height: lado, borderRadius: lado / 2, borderWidth: 2, borderColor: color }, a]} />;
}

export function IlustracionChat({ p, tam }: Props) {
  const tema = useTema();
  const f1 = useFlotar(5, 2400);
  const f2 = useFlotar(6, 2800, 300);
  const f3 = useFlotar(4, 2000, 600);
  const llam = tam * 0.24;
  return (
    <View style={{ width: tam, height: tam }}>
      <Capa p={p} tam={tam} factor={0.2}>
        <View style={{ width: tam * 0.78, height: tam * 0.78, borderRadius: tam, backgroundColor: conAlfa(tema.acento, tema.oscuro ? 0.08 : 0.12) }} />
      </Capa>
      <Capa p={p} tam={tam} factor={0.7} style={{ alignItems: 'flex-start', justifyContent: 'flex-start', paddingTop: tam * 0.16, paddingLeft: tam * 0.04 }}>
        <Animated.View style={[s.burbuja, s.burbujaOtro, { backgroundColor: tema.burbujaOtro, borderColor: tema.borde }, sombraDe(tema), f1]}>
          <Texto v="chica" color={tema.textoOtro}>
            {tr('¿Vienes a cenar el domingo? 🍲', 'Coming for dinner on Sunday? 🍲')}
          </Texto>
        </Animated.View>
      </Capa>
      <Capa p={p} tam={tam} factor={1.05} style={{ alignItems: 'flex-end', justifyContent: 'center', paddingRight: tam * 0.04, paddingTop: tam * 0.08 }}>
        <Animated.View style={[s.burbuja, s.burbujaMia, { overflow: 'hidden' }, sombraDe(tema), f2]}>
          <LinearGradient colors={oroDe(tema.oscuro)} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
          <Texto v="chicaFuerte" color={tema.textoMia}>
            {tr('¡Claro que sí, mamá! ❤', 'Of course, Mom! ❤')}
          </Texto>
        </Animated.View>
      </Capa>
      <Capa p={p} tam={tam} factor={0.45} style={{ justifyContent: 'flex-end', paddingBottom: tam * 0.08 }}>
        <View style={{ width: llam, height: llam, alignItems: 'center', justifyContent: 'center' }}>
          <Onda retraso={0} lado={llam} color={tema.exito} />
          <Onda retraso={1000} lado={llam} color={tema.exito} />
          <View style={[s.circulo, { width: llam, height: llam, borderRadius: llam / 2, backgroundColor: tema.exito }]}>
            <Icono nombre="llamada" tam={llam * 0.42} color="#FFFFFF" />
          </View>
        </View>
      </Capa>
      <Capa p={p} tam={tam} factor={1.35} style={{ alignItems: 'flex-start', justifyContent: 'flex-end', paddingLeft: tam * 0.1, paddingBottom: tam * 0.3 }}>
        <Animated.View style={[s.candado, { backgroundColor: tema.superficie, borderColor: tema.borde }, sombraDe(tema, 2), f3]}>
          <Icono nombre="candado" tam={20} color={tema.acentoTexto} />
        </Animated.View>
      </Capa>
    </View>
  );
}

/* ── 3. Tu AURA te conoce ─────────────────────────────────────────────────────────────────── */

const ORBITA: { icono: NombreIcono; es: string; en: string }[] = [
  { icono: 'pastel', es: '14 de marzo', en: 'March 14' },
  { icono: 'musica', es: 'Bachata', en: 'Bachata' },
  { icono: 'comida', es: 'Baleadas', en: 'Baleadas' },
  { icono: 'familia', es: 'Ana y Sofía', en: 'Ana & Sofía' },
  { icono: 'trabajo', es: 'Tu negocio', en: 'Your business' },
];

function Satelite({ i, total, giro, radio, children }: { i: number; total: number; giro: SharedValue<number>; radio: number; children: ReactNode }) {
  const a = useAnimatedStyle(() => {
    const ang = (i / total) * Math.PI * 2 + giro.value * Math.PI * 2 - Math.PI / 2;
    return { transform: [{ translateX: Math.cos(ang) * radio }, { translateY: Math.sin(ang) * radio * 0.82 }] };
  });
  return <Animated.View style={[s.satelite, a]}>{children}</Animated.View>;
}

export function IlustracionConoce({ p, tam }: Props) {
  const tema = useTema();
  const giro = useSharedValue(0);
  useEffect(() => {
    giro.value = withRepeat(withTiming(1, { duration: 36000, easing: Easing.linear }), -1, false);
  }, [giro]);
  const cara = tam * 0.34;
  return (
    <View style={{ width: tam, height: tam }}>
      <Capa p={p} tam={tam} factor={0.2}>
        <View style={{ width: tam * 0.86, height: tam * 0.7, borderRadius: tam, borderWidth: 1, borderColor: conAlfa(tema.acento, 0.35), borderStyle: 'dashed' }} />
      </Capa>
      <Capa p={p} tam={tam} factor={0.4}>
        <View style={[s.cara, { width: cara, height: cara, borderRadius: cara / 2, borderColor: tema.acento }, sombraDe(tema, 2)]}>
          <MiniAvatar id="aura" lado={cara} />
        </View>
      </Capa>
      <Capa p={p} tam={tam} factor={0.9}>
        {ORBITA.map((o, i) => (
          <Satelite key={o.icono} i={i} total={ORBITA.length} giro={giro} radio={tam * 0.4}>
            <View style={[s.dato, { backgroundColor: tema.superficie, borderColor: tema.borde }, sombraDe(tema)]}>
              <Icono nombre={o.icono} tam={15} color={tema.acentoTexto} />
              <Texto v="mini" numberOfLines={1}>
                {tr(o.es, o.en)}
              </Texto>
            </View>
          </Satelite>
        ))}
      </Capa>
    </View>
  );
}

const s = StyleSheet.create({
  centrado: { alignItems: 'center', justifyContent: 'center' },
  barras: { flexDirection: 'row', alignItems: 'center', gap: 5, height: 80 },
  globo: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 14, paddingVertical: 10, borderRadius: 18, borderBottomRightRadius: 6, borderWidth: StyleSheet.hairlineWidth * 2 },
  pastilla: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999 },
  burbuja: { paddingHorizontal: 14, paddingVertical: 10, borderRadius: 18, maxWidth: 230 },
  burbujaOtro: { borderBottomLeftRadius: 6, borderWidth: StyleSheet.hairlineWidth * 2 },
  burbujaMia: { borderBottomRightRadius: 6 },
  circulo: { alignItems: 'center', justifyContent: 'center' },
  candado: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', borderWidth: StyleSheet.hairlineWidth * 2 },
  cara: { overflow: 'hidden', borderWidth: 2 },
  satelite: { position: 'absolute' },
  dato: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, paddingVertical: 7, borderRadius: 999, borderWidth: StyleSheet.hairlineWidth * 2 },
});
