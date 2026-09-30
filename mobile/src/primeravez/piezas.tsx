/**
 * Piezas que comparten los pasos de la primera vez (y Ajustes):
 *
 *   EncabezadoPaso   la etiqueta dorada, el título grande en serif y la explicación
 *   SelectorCumple   el cumpleaños sin año: los meses en una fila que se desliza y los días en una
 *                    cuadrícula de botones redondos (el 29 de febrero existe; el 31 de abril no)
 *   VistaAvatar      el avatar vivo: su cara (los ojos que parpadean y miran, o la foto de Claudio)
 *                    dentro de su aura, con los colores del avatar
 */
import { useEffect, useRef } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withDelay, withRepeat, withSequence, withSpring, withTiming } from 'react-native-reanimated';
import { tr, useIdioma } from '../i18n';
import { MEDIDA, useTema } from '../nucleo/tema';
import { avatarPorId, type AvatarId } from '../avatares/catalogo';
import { FOTOS_CLAUDIO } from '../avatares/ClaudioRetrato';
import { Aparecer, Aura, Texto, vibrar } from '../ui';
import { DIAS_POR_MES } from './flujo';

export function EncabezadoPaso({ etiqueta, titulo, texto, centro }: { etiqueta?: string; titulo: string; texto?: string; centro?: boolean }) {
  return (
    <View style={{ gap: 8 }}>
      {!!etiqueta && (
        <Aparecer>
          <Texto v="etiqueta" color="acentoTexto" centro={centro}>
            {etiqueta}
          </Texto>
        </Aparecer>
      )}
      <Aparecer retraso={40}>
        <Texto v="heroe" centro={centro} accessibilityRole="header">
          {titulo}
        </Texto>
      </Aparecer>
      {!!texto && (
        <Aparecer retraso={90}>
          <Texto v="grande" color="texto2" centro={centro}>
            {texto}
          </Texto>
        </Aparecer>
      )}
    </View>
  );
}

/* ── el cumpleaños ────────────────────────────────────────────────────────────────────────── */

const MESES_ES = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
const MESES_EN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function Redondo({ texto, activo, onPress, ancho }: { texto: string; activo: boolean; onPress: () => void; ancho?: number }) {
  const tema = useTema();
  const e = useSharedValue(1);
  const a = useAnimatedStyle(() => ({ transform: [{ scale: e.value }] }));
  useEffect(() => {
    if (activo) e.value = withSequence(withTiming(1.12, { duration: 110 }), withSpring(1, MEDIDA.resorte.vivo));
  }, [activo, e]);
  return (
    <Animated.View style={a}>
      <Pressable
        onPress={() => {
          vibrar('seleccion');
          onPress();
        }}
        style={[s.redondo, ancho ? { width: ancho, borderRadius: 14 } : null, { backgroundColor: activo ? tema.acento : tema.superficie, borderColor: activo ? tema.acento : tema.borde }]}
        accessibilityRole="button"
        accessibilityState={{ selected: activo }}
        hitSlop={2}
      >
        <Texto v="chicaFuerte" color={activo ? 'sobreAcento' : 'texto'}>
          {texto}
        </Texto>
      </Pressable>
    </Animated.View>
  );
}

export function SelectorCumple({ mes, dia, onCambiar }: { mes: number | null; dia: number | null; onCambiar: (mes: number | null, dia: number | null) => void }) {
  const idioma = useIdioma();
  const meses = idioma === 'en' ? MESES_EN : MESES_ES;
  const lista = useRef<ScrollView>(null);
  useEffect(() => {
    if (mes) setTimeout(() => lista.current?.scrollTo({ x: Math.max(0, (mes - 2) * 64), animated: false }), 0);
    // Solo al montar: después la persona desliza a gusto.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const dias = mes ? DIAS_POR_MES[mes - 1] : 31;
  return (
    <View style={{ gap: MEDIDA.espacio.l }}>
      <View style={{ gap: 8 }}>
        <Texto v="chicaFuerte" color="texto2">
          {tr('Mes', 'Month')}
        </Texto>
        <ScrollView ref={lista} horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingRight: 8 }}>
          {meses.map((m, i) => (
            <Redondo key={m} texto={m} ancho={56} activo={mes === i + 1} onPress={() => onCambiar(i + 1, dia && dia <= DIAS_POR_MES[i] ? dia : null)} />
          ))}
        </ScrollView>
      </View>
      <View style={{ gap: 8, opacity: mes ? 1 : 0.45 }} pointerEvents={mes ? 'auto' : 'none'}>
        <Texto v="chicaFuerte" color="texto2">
          {tr('Día', 'Day')}
        </Texto>
        <View style={s.dias}>
          {Array.from({ length: dias }, (_, i) => (
            <Redondo key={i} texto={String(i + 1)} activo={dia === i + 1} onPress={() => onCambiar(mes, i + 1)} />
          ))}
        </View>
      </View>
    </View>
  );
}

/* ── el avatar vivo ───────────────────────────────────────────────────────────────────────── */

function OjosVivos({ color, lado }: { color: string; lado: number }) {
  const parpado = useSharedValue(1);
  const mirada = useSharedValue(0);
  useEffect(() => {
    parpado.value = withRepeat(withSequence(withDelay(2600, withTiming(0.08, { duration: 90 })), withTiming(1, { duration: 120 })), -1, false);
    mirada.value = withRepeat(withSequence(withTiming(1, { duration: 1400, easing: Easing.inOut(Easing.sin) }), withTiming(-1, { duration: 2200, easing: Easing.inOut(Easing.sin) }), withTiming(0, { duration: 1200 })), -1, false);
  }, [parpado, mirada]);
  const ojo = Math.round(lado * 0.3);
  const borde = Math.max(2, Math.round(ojo * 0.12));
  const pupila = Math.round(ojo * 0.32);
  const aOjo = useAnimatedStyle(() => ({ transform: [{ scaleY: parpado.value }] }));
  const aPupila = useAnimatedStyle(() => ({ transform: [{ translateX: mirada.value * ojo * 0.16 }] }));
  return (
    <View style={{ flexDirection: 'row', gap: Math.round(lado * 0.1) }}>
      {[0, 1].map((i) => (
        <Animated.View key={i} style={[{ width: ojo, height: ojo, borderRadius: ojo / 2, borderWidth: borde, borderColor: color, alignItems: 'center', justifyContent: 'center' }, aOjo]}>
          <Animated.View style={[{ width: pupila, height: pupila, borderRadius: pupila / 2, backgroundColor: color }, aPupila]} />
        </Animated.View>
      ))}
    </View>
  );
}

export function VistaAvatar({ id, tam }: { id: AvatarId; tam: number }) {
  const a = avatarPorId(id);
  const cara = tam * 0.56;
  const flota = useSharedValue(0);
  useEffect(() => {
    flota.value = withRepeat(withTiming(1, { duration: 2400, easing: Easing.inOut(Easing.sin) }), -1, true);
  }, [flota]);
  const aFlota = useAnimatedStyle(() => ({ transform: [{ translateY: (flota.value - 0.5) * 6 }] }));
  return (
    <View style={{ width: tam, height: tam, alignItems: 'center', justifyContent: 'center' }}>
      <View style={StyleSheet.absoluteFill}>
        <Aura tam={tam} particulas={16} color={a.tema.acento} colorClaro={a.tema.acentoTexto} />
      </View>
      <Animated.View style={[{ width: cara, height: cara, borderRadius: cara / 2, backgroundColor: a.tema.fondo, overflow: 'hidden', alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: a.tema.acento }, aFlota]}>
        {id === 'claudio' ? (
          <Animated.Image source={FOTOS_CLAUDIO.base} resizeMode="cover" style={{ width: '100%', height: '100%' }} />
        ) : (
          <OjosVivos color={a.tema.acento} lado={cara} />
        )}
      </Animated.View>
    </View>
  );
}

const s = StyleSheet.create({
  redondo: { width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center', borderWidth: StyleSheet.hairlineWidth * 2 },
  dias: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
});
