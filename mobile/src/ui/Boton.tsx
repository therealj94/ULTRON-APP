/**
 * El botón de la app: responde al dedo como uno nativo.
 *
 * Al tocarlo se hunde con un resorte (escala 0,965) y vibra suave; al soltar vuelve rebotando. El
 * principal es de oro de verdad —un degradado, no un color plano— y al presionarlo le cruza un
 * brillo, como la luz sobre una moneda. Un botón que no reacciona es lo primero que delata que una
 * app «parece web».
 *
 * Variantes: `principal` (una por pantalla), `secundario` (superficie con borde), `fantasma` (solo
 * texto dorado, área de toque de 44), `peligro` (cerrar sesión, borrar). `texto` y `contorno` son los
 * nombres de antes y se siguen aceptando (el chat los usa).
 */
import { useEffect, type ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withSequence, withSpring, withTiming } from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';
import { MEDIDA, useTema } from '../nucleo/tema';
import { vibrar } from './hapticos';
import { Icono, type NombreIcono } from './Icono';
import { Texto } from './Texto';

export type VarianteBoton = 'principal' | 'secundario' | 'fantasma' | 'peligro' | 'texto' | 'contorno';

type Props = {
  titulo: string;
  onPress: () => void;
  variante?: VarianteBoton;
  cargando?: boolean;
  /** Lo que dice mientras carga (si no, solo la ruedita). */
  textoCargando?: string;
  deshabilitado?: boolean;
  /** Un nombre de ícono (se pinta del color del texto) o un nodo propio. */
  icono?: NombreIcono | ReactNode;
  iconoDerecha?: NombreIcono;
  tam?: 'normal' | 'chico';
  style?: StyleProp<ViewStyle>;
  etiqueta?: string;
};

const APorPresionar = Animated.createAnimatedComponent(Pressable);

/** El oro del botón principal en cada tema (claro: más hondo, para que el texto blanco se lea). */
export function oroDe(oscuro: boolean): [string, string, string] {
  return oscuro ? ['#EDD496', '#D6B56C', '#BA964A'] : ['#CFA956', '#B8913F', '#9A782F'];
}

export function Boton({ titulo, onPress, variante = 'principal', cargando, textoCargando, deshabilitado, icono, iconoDerecha, tam = 'normal', style, etiqueta }: Props) {
  const tema = useTema();
  const v = variante === 'texto' ? 'fantasma' : variante;
  const apagado = !!(deshabilitado || cargando);
  const escala = useSharedValue(1);
  const brillo = useSharedValue(-1);
  const ancho = useSharedValue(320);
  const presencia = useSharedValue(apagado ? 0.55 : 1);

  useEffect(() => {
    presencia.value = withTiming(deshabilitado ? 0.5 : 1, { duration: MEDIDA.duracion.rapida });
  }, [deshabilitado, presencia]);

  const aEscala = useAnimatedStyle(() => ({ transform: [{ scale: escala.value }], opacity: presencia.value }));
  const aBrillo = useAnimatedStyle(() => ({ transform: [{ translateX: brillo.value * ancho.value }, { rotate: '18deg' }] }));

  const hundir = () => {
    escala.value = withSpring(0.965, MEDIDA.resorte.vivo);
    if (v === 'principal') brillo.value = withSequence(withTiming(-1, { duration: 0 }), withTiming(1.2, { duration: 620, easing: Easing.out(Easing.cubic) }));
    vibrar('suave');
  };
  const soltar = () => {
    escala.value = withSpring(1, { damping: 10, stiffness: 260, mass: 0.7 });
  };

  const colorLetra =
    v === 'principal' ? tema.sobreAcento : v === 'secundario' || v === 'contorno' ? tema.texto : v === 'peligro' ? tema.aviso : tema.acentoTexto;
  const alto = tam === 'chico' ? 42 : v === 'fantasma' ? 44 : 54;
  const caja: ViewStyle =
    v === 'principal'
      ? { backgroundColor: tema.acento }
      : v === 'secundario'
        ? { backgroundColor: tema.superficie2, borderWidth: StyleSheet.hairlineWidth * 2, borderColor: tema.borde }
        : v === 'contorno'
          ? { borderWidth: 1.5, borderColor: tema.borde }
          : v === 'peligro'
            ? { backgroundColor: tema.avisoFondo }
            : {};
  const tamIcono = tam === 'chico' ? 18 : 20;

  return (
    <Animated.View style={[aEscala, style]}>
      <APorPresionar
        onPress={apagado ? undefined : onPress}
        onPressIn={apagado ? undefined : hundir}
        onPressOut={soltar}
        onLayout={(e) => {
          ancho.value = e.nativeEvent.layout.width;
        }}
        android_ripple={v === 'fantasma' ? undefined : { color: v === 'principal' ? 'rgba(255,255,255,0.18)' : tema.acentoFondo, borderless: false }}
        style={[s.base, { minHeight: alto, borderRadius: alto / 2, paddingHorizontal: v === 'fantasma' ? 10 : tam === 'chico' ? 18 : 24 }, caja]}
        accessibilityRole="button"
        accessibilityLabel={etiqueta || titulo}
        accessibilityState={{ disabled: apagado, busy: !!cargando }}
        hitSlop={v === 'fantasma' ? 6 : 0}
      >
        {v === 'principal' && (
          <>
            <LinearGradient colors={oroDe(tema.oscuro)} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
            {/* El filo de luz de arriba: da volumen sin sombra dura. */}
            <View pointerEvents="none" style={[s.filo, { borderRadius: alto / 2 }]} />
            <Animated.View pointerEvents="none" style={[s.brillo, aBrillo]}>
              <LinearGradient colors={['rgba(255,255,255,0)', 'rgba(255,255,255,0.55)', 'rgba(255,255,255,0)']} start={{ x: 0, y: 0.5 }} end={{ x: 1, y: 0.5 }} style={StyleSheet.absoluteFill} />
            </Animated.View>
          </>
        )}
        {cargando ? (
          <>
            <ActivityIndicator color={colorLetra} />
            {!!textoCargando && (
              <Texto v="boton" color={colorLetra} numberOfLines={2} style={s.letra}>
                {textoCargando}
              </Texto>
            )}
          </>
        ) : (
          <>
            {typeof icono === 'string' ? <Icono nombre={icono as NombreIcono} tam={tamIcono} color={colorLetra} /> : icono}
            {/* Hasta dos renglones con la letra grande del sistema (A18): la acción no se corta. */}
            <Texto v={tam === 'chico' ? 'chicaFuerte' : 'boton'} color={colorLetra} numberOfLines={2} style={[s.letra, tam === 'chico' ? { fontSize: 14 } : undefined]}>
              {titulo}
            </Texto>
            {iconoDerecha && <Icono nombre={iconoDerecha} tam={tamIcono} color={colorLetra} />}
          </>
        )}
      </APorPresionar>
    </Animated.View>
  );
}

const s = StyleSheet.create({
  letra: { flexShrink: 1, textAlign: 'center' },
  base: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, overflow: 'hidden' },
  filo: { ...StyleSheet.absoluteFillObject, borderTopWidth: 1, borderColor: 'rgba(255,255,255,0.35)' },
  brillo: { position: 'absolute', top: -30, bottom: -30, width: 70, left: 0 },
});
