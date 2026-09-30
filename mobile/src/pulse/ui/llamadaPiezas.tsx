/**
 * LAS PIEZAS DE UNA PANTALLA DE LLAMADA, las de PULSE2CHAT (PantallaLlamada.tsx) y las de la llamada del
 * avatar (compa/LlamadaAvatar.tsx): iconos de trazo dibujados con Skia, el botón redondo con háptica, el
 * «desliza para contestar» y el aro dorado que late mientras suena (con la inicial, o con la cara del
 * avatar). Una sola copia: las dos llamadas se ven y se tocan igual.
 *
 * Siempre en la paleta OSCURA: una llamada es un escenario, como la mesa.
 */
import { useEffect, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  Easing,
  Extrapolation,
  cancelAnimation,
  interpolate,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { Canvas, Group, Path, Skia, type SkPath } from '@shopify/react-native-skia';
import { MEDIDA, OSCURO as P } from '../../nucleo/tema';
import { tr } from '../../i18n';

/** Contestar y colgar: la salvia y la terracota de la paleta, más vivas (un botón de llamada se reconoce por el color). */
export const VERDE = '#5E9E62';
export const ROJO = '#D4533C';
export const RESORTE_SUAVE = { ...MEDIDA.resorte.suave };
export const RESORTE_VIVO = { ...MEDIDA.resorte.vivo };

export function reloj(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

export function tocar(tipo: 'ligera' | 'media' | 'exito' | 'seleccion') {
  try {
    const p =
      tipo === 'exito'
        ? Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
        : tipo === 'seleccion'
          ? Haptics.selectionAsync()
          : Haptics.impactAsync(tipo === 'media' ? Haptics.ImpactFeedbackStyle.Medium : Haptics.ImpactFeedbackStyle.Light);
    void p.catch(() => {});
  } catch {
    /* sin motor de vibración no pasa nada */
  }
}

/* ── iconos: trazos de 24×24 (familia Lucide, ISC) dibujados con Skia ─────────────────────── */

export type NombreIcono = 'minimizar' | 'telefono' | 'colgar' | 'mic' | 'micNo' | 'video' | 'videoNo' | 'voltear' | 'altavoz' | 'candado' | 'arriba';
const TRAZOS: Record<NombreIcono, string[]> = {
  telefono: [
    'M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 0.7 2.81 2 2 0 0 1-0.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-0.45 12.84 12.84 0 0 0 2.81 0.7A2 2 0 0 1 22 16.92z',
  ],
  colgar: [
    'M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 0.7 2.81 2 2 0 0 1-0.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-0.45 12.84 12.84 0 0 0 2.81 0.7A2 2 0 0 1 22 16.92z',
  ],
  mic: ['M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z', 'M19 10v2a7 7 0 0 1-14 0v-2', 'M12 19v3'],
  micNo: ['M2 2l20 20', 'M18.89 13.23A7.12 7.12 0 0 0 19 12v-2', 'M5 10v2a7 7 0 0 0 12 5', 'M15 9.34V5a3 3 0 0 0-5.68-1.33', 'M9 9v3a3 3 0 0 0 5.12 2.12', 'M12 19v3'],
  video: ['M22 8l-6 4 6 4V8z', 'M4 6h10a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2z'],
  videoNo: ['M2 2l20 20', 'M10.66 6H14a2 2 0 0 1 2 2v2.34l1 1L22 8v8', 'M16 16a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h2'],
  voltear: ['M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8', 'M21 3v5h-5', 'M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16', 'M8 16H3v5'],
  altavoz: ['M11 5L6 9H2v6h4l5 4V5z', 'M15.54 8.46a5 5 0 0 1 0 7.07', 'M19.07 4.93a10 10 0 0 1 0 14.14'],
  candado: ['M5 11h14a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2z', 'M7 11V7a5 5 0 0 1 10 0v4'],
  arriba: ['M18 15l-6-6-6 6'],
  minimizar: ['M6 9l6 6 6-6'],
};
const trazos = new Map<string, SkPath | null>();
function trazo(d: string): SkPath | null {
  if (!trazos.has(d)) trazos.set(d, Skia.Path.MakeFromSVGString(d));
  return trazos.get(d) || null;
}
/** El auricular colgado es el mismo teléfono girado 135°, como en todos los teléfonos. */
const GIRO_COLGAR = [{ rotate: (135 * Math.PI) / 180 }];

export function Icono({ nombre, tam, color, grosor = 2 }: { nombre: NombreIcono; tam: number; color: string; grosor?: number }) {
  return (
    <View pointerEvents="none" style={{ width: tam, height: tam }}>
      <Canvas style={{ width: tam, height: tam }}>
        <Group transform={[{ scale: tam / 24 }]}>
          <Group origin={{ x: 12, y: 12 }} transform={nombre === 'colgar' ? GIRO_COLGAR : []}>
            {TRAZOS[nombre].map((d, i) => {
              const p = trazo(d);
              return p ? <Path key={i} path={p} style="stroke" strokeWidth={grosor} strokeCap="round" strokeJoin="round" color={color} /> : null;
            })}
          </Group>
        </Group>
      </Canvas>
    </View>
  );
}

/** La inicial en un aro dorado; mientras suena, el aro late y dos ondas salen de él. */
export function Avatar({ inicial = '', tam, late, children, quieto = false }: { inicial?: string; tam: number; late: boolean; children?: ReactNode; quieto?: boolean }) {
  const onda = useSharedValue(0);
  const latido = useSharedValue(1);
  useEffect(() => {
    if (late && !quieto) {
      onda.value = 0;
      onda.value = withRepeat(withTiming(1, { duration: 2000, easing: Easing.out(Easing.quad) }), -1, false);
      latido.value = withRepeat(withSequence(withTiming(1.045, { duration: 420, easing: Easing.out(Easing.quad) }), withTiming(1, { duration: 580, easing: Easing.inOut(Easing.quad) })), -1, false);
    } else {
      cancelAnimation(onda);
      cancelAnimation(latido);
      onda.value = withTiming(0, { duration: MEDIDA.duracion.normal });
      latido.value = withSpring(1, RESORTE_SUAVE);
    }
  }, [late, onda, latido]);
  // Dos ondas desfasadas media vuelta: mientras una se apaga, la otra nace.
  const onda1 = useAnimatedStyle(() => {
    const v = onda.value % 1;
    return { opacity: late ? interpolate(v, [0, 0.15, 1], [0, 0.5, 0]) : 0, transform: [{ scale: interpolate(v, [0, 1], [1, 1.6]) }] };
  });
  const onda2 = useAnimatedStyle(() => {
    const v = (onda.value + 0.5) % 1;
    return { opacity: late ? interpolate(v, [0, 0.15, 1], [0, 0.5, 0]) : 0, transform: [{ scale: interpolate(v, [0, 1], [1, 1.6]) }] };
  });
  const estiloAro = useAnimatedStyle(() => ({ transform: [{ scale: latido.value }] }));
  const r = tam / 2;
  return (
    <View style={{ width: tam * 1.7, height: tam * 1.7, alignItems: 'center', justifyContent: 'center' }}>
      <Animated.View style={[s.onda, { width: tam, height: tam, borderRadius: r }, onda1]} />
      <Animated.View style={[s.onda, { width: tam, height: tam, borderRadius: r }, onda2]} />
      <Animated.View style={estiloAro}>
        <LinearGradient colors={[P.acentoTexto, P.acento, '#8C6D2F']} start={{ x: 0.1, y: 0 }} end={{ x: 0.9, y: 1 }} style={{ width: tam, height: tam, borderRadius: r, padding: 3 }}>
          <View style={[s.avatarDentro, { borderRadius: r }]}>
            {children ?? <Text style={[s.inicial, { fontSize: tam * 0.4 }]}>{inicial}</Text>}
          </View>
        </LinearGradient>
      </Animated.View>
    </View>
  );
}

export function Boton({
  icono,
  etiqueta,
  onPress,
  fondo,
  activo,
  tam = 68,
  haptica = 'ligera',
}: {
  icono: NombreIcono;
  etiqueta: string;
  onPress: () => void;
  fondo?: string;
  activo?: boolean;
  tam?: number;
  haptica?: 'ligera' | 'media';
}) {
  const escala = useSharedValue(1);
  const estilo = useAnimatedStyle(() => ({ transform: [{ scale: escala.value }] }));
  // Encendido = círculo claro con el icono oscuro, como en la app de teléfono del sistema.
  const color = fondo ? '#FFFFFF' : activo ? P.fondo : P.texto;
  const bg = fondo || (activo ? P.texto : 'rgba(236,232,226,0.13)');
  return (
    <Pressable
      onPressIn={() => (escala.value = withSpring(0.88, RESORTE_VIVO))}
      onPressOut={() => (escala.value = withSpring(1, RESORTE_VIVO))}
      onPress={() => {
        tocar(haptica);
        onPress();
      }}
      accessibilityRole="button"
      accessibilityLabel={etiqueta}
      accessibilityState={{ selected: !!activo }}
      hitSlop={6}
      style={s.boton}
    >
      <Animated.View style={[s.circulo, { width: tam, height: tam, borderRadius: tam / 2, backgroundColor: bg }, !fondo && !activo && s.circuloVidrio, estilo]}>
        <Icono nombre={icono} tam={Math.round(tam * 0.4)} color={color} />
      </Animated.View>
      <Text style={s.etiqueta} numberOfLines={1}>
        {etiqueta}
      </Text>
    </Pressable>
  );
}

/** «Desliza para contestar»: la perilla va hasta el final (82 %) o vuelve con un resorte. */
export function Deslizar({ ancho, icono, texto, onListo }: { ancho: number; icono: NombreIcono; texto: string; onListo: () => void }) {
  const PERILLA = 64;
  const recorrido = Math.max(1, ancho - PERILLA - 8);
  const x = useSharedValue(0);
  const pista = useSharedValue(0);
  const hecho = useSharedValue(false);
  const brillo = useSharedValue(0);
  useEffect(() => {
    // Un empujoncito cada tanto: dice que la perilla se mueve sin tener que leerlo.
    pista.value = withRepeat(withSequence(withDelay(1800, withTiming(18, { duration: 260, easing: Easing.out(Easing.quad) })), withSpring(0, RESORTE_VIVO)), -1, false);
    brillo.value = withRepeat(withTiming(1, { duration: 2200, easing: Easing.inOut(Easing.quad) }), -1, true);
    return () => {
      cancelAnimation(pista);
      cancelAnimation(brillo);
    };
  }, [pista, brillo]);
  const listo = () => {
    tocar('exito');
    onListo();
  };
  const gesto = Gesture.Pan()
    .activeOffsetX([-6, 6])
    .onBegin(() => {
      cancelAnimation(pista);
      pista.value = withTiming(0, { duration: 80 });
      runOnJS(tocar)('seleccion');
    })
    .onUpdate((e) => {
      if (hecho.value) return;
      x.value = Math.min(recorrido, Math.max(0, e.translationX));
    })
    .onEnd(() => {
      if (hecho.value) return;
      if (x.value > recorrido * 0.82) {
        hecho.value = true;
        x.value = withTiming(recorrido, { duration: 120 });
        runOnJS(listo)();
      } else {
        x.value = withSpring(0, RESORTE_VIVO);
      }
    });
  const estiloPerilla = useAnimatedStyle(() => ({ transform: [{ translateX: x.value + pista.value }] }));
  const estiloRelleno = useAnimatedStyle(() => ({ width: x.value + pista.value + PERILLA + 8, opacity: interpolate(x.value, [0, recorrido], [0.35, 1], Extrapolation.CLAMP) }));
  const estiloTexto = useAnimatedStyle(() => ({ opacity: interpolate(x.value, [0, recorrido * 0.5], [0.55 + brillo.value * 0.45, 0], Extrapolation.CLAMP) }));
  return (
    <View
      style={[s.pistaDeslizar, { width: ancho }]}
      accessible
      accessibilityRole="button"
      accessibilityLabel={texto}
      accessibilityActions={[{ name: 'activate', label: tr('Contestar', 'Answer') }]}
      onAccessibilityAction={listo}
      onAccessibilityTap={listo}
    >
      <Animated.View style={[s.rellenoDeslizar, estiloRelleno]} />
      <Animated.Text style={[s.textoDeslizar, { paddingLeft: PERILLA }, estiloTexto]} numberOfLines={1}>
        {texto}
      </Animated.Text>
      <GestureDetector gesture={gesto}>
        <Animated.View style={[s.perilla, { width: PERILLA, height: PERILLA, borderRadius: PERILLA / 2 }, estiloPerilla]}>
          <Icono nombre={icono} tam={26} color="#FFFFFF" />
        </Animated.View>
      </GestureDetector>
    </View>
  );
}

const s = StyleSheet.create({
  onda: { position: 'absolute', borderWidth: 2, borderColor: P.acento },
  avatarDentro: { flex: 1, backgroundColor: P.superficie, alignItems: 'center', justifyContent: 'center' },
  inicial: { color: P.acentoTexto, fontWeight: '600', letterSpacing: 1 },
  boton: { alignItems: 'center', width: 84 },
  circulo: { alignItems: 'center', justifyContent: 'center' },
  circuloVidrio: { borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(236,232,226,0.18)' },
  etiqueta: { color: P.texto2, fontSize: MEDIDA.letra.chica, marginTop: MEDIDA.espacio.s },
  pistaDeslizar: {
    height: 76,
    borderRadius: 38,
    backgroundColor: 'rgba(236,232,226,0.10)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(236,232,226,0.2)',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  rellenoDeslizar: { position: 'absolute', left: 0, top: 0, bottom: 0, borderRadius: 38, backgroundColor: 'rgba(94,158,98,0.45)' },
  textoDeslizar: { color: P.texto, fontSize: MEDIDA.letra.cuerpo, textAlign: 'center', letterSpacing: 0.3, paddingRight: MEDIDA.espacio.l },
  perilla: { position: 'absolute', left: 6, backgroundColor: VERDE, alignItems: 'center', justifyContent: 'center', elevation: 6, shadowColor: '#000', shadowOpacity: 0.35, shadowRadius: 8, shadowOffset: { width: 0, height: 3 } },
});
