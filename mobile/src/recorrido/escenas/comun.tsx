/**
 * Las piezas que comparten las escenas del recorrido: la pantallita donde pasa el ejemplo, las burbujas
 * de chat, el texto que se escribe solo, el anillo que dice «toca aquí», los íconos y las animaciones
 * de entrada. Solo React Native y su Animated (sin módulos nativos): así se ve igual en el teléfono y
 * en una vista previa del navegador con react-native-web (así se sacaron sus capturas).
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Animated, Easing, Image, Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { IMAGENES_ICONOS } from '../../ui/iconosPng';
import type { NombreIcono } from '../../ui/iconos';

/** Lo que recibe cada escena. */
export type PropsEscena = {
  /** El paso de la animación (guion.ts: cada línea puede mover el paso). */
  paso: string;
  /** Está esperando que la persona toque (el objetivo late). */
  esperando: boolean;
  /** La persona ya tocó en esta escena (responde a su toque, no al reloj). */
  tocado: boolean;
  onToque: () => void;
  /** El color del que habla ahora. */
  acento: string;
  idioma: 'es' | 'en';
  ancho: number;
  alto: number;
  /** Solo la última escena: eligió qué probar. */
  onElegir?: (id: string) => void;
  /** Marca dónde está algo en la pantalla (la franja de los chats, adonde vuela Claudio). */
  marcarLugar?: (nombre: string, r: { x: number; y: number; w: number; h: number }) => void;
};

export const COLOR = {
  fondo: '#121316',
  panel: '#1C1E22',
  panel2: '#25282D',
  borde: 'rgba(255,255,255,0.10)',
  texto: '#F2EEE8',
  texto2: '#C4BDB3',
  texto3: '#8F8A83',
  claudio: '#FF9A4D',
  antonio: '#45C9DE',
  aura: '#D6B56C',
  ojos: '#5CE1FF',
  verde: '#3DDC84',
  rojo: '#FF5A5F',
  azul: '#4FA8FF',
} as const;

export const t = (idioma: 'es' | 'en', es: string, en: string) => (idioma === 'en' ? en : es);

/** Un valor que va de 0 a 1 cuando `activo` se prende (y vuelve a 0 si se apaga). */
export function useAparece(activo: boolean, o: { ms?: number; retraso?: number; resorte?: boolean } = {}) {
  const v = useRef(new Animated.Value(activo ? 1 : 0)).current;
  useEffect(() => {
    const a = o.resorte && activo
      ? Animated.spring(v, { toValue: 1, useNativeDriver: true, speed: 12, bounciness: 9, delay: o.retraso || 0 })
      : Animated.timing(v, { toValue: activo ? 1 : 0, duration: o.ms ?? 380, delay: activo ? o.retraso || 0 : 0, easing: Easing.out(Easing.cubic), useNativeDriver: true });
    a.start();
    return () => a.stop();
  }, [activo]); // eslint-disable-line react-hooks/exhaustive-deps
  return v;
}

/** Un valor que va y viene de 0 a 1 sin parar (latidos, ondas, respiración). */
export function useVaiven(ms = 1200, activo = true) {
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!activo) {
      v.setValue(0);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(v, { toValue: 1, duration: ms / 2, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        Animated.timing(v, { toValue: 0, duration: ms / 2, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [ms, activo, v]);
  return v;
}

/** Un valor que corre de 0 a 1 y vuelve a empezar (barridos, órbitas). */
export function useCiclo(ms = 2000, activo = true) {
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!activo) return;
    v.setValue(0);
    const loop = Animated.loop(Animated.timing(v, { toValue: 1, duration: ms, easing: Easing.linear, useNativeDriver: true }));
    loop.start();
    return () => loop.stop();
  }, [ms, activo, v]);
  return v;
}

/** Entra subiendo y apareciendo. */
export function Entra({ visible, retraso = 0, desde = 18, children, style }: { visible: boolean; retraso?: number; desde?: number; children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const v = useAparece(visible, { retraso, resorte: true });
  return (
    <Animated.View style={[style, { opacity: v.interpolate({ inputRange: [0, 0.6, 1], outputRange: [0, 1, 1] }), transform: [{ translateY: v.interpolate({ inputRange: [0, 1], outputRange: [desde, 0] }) }] }]}>
      {children}
    </Animated.View>
  );
}

/** Texto que se escribe solo, letra por letra, cuando `activo`. */
export function Escribe({ texto, activo, ms = 38, style, cursor = true }: { texto: string; activo: boolean; ms?: number; style?: StyleProp<any>; cursor?: boolean }) {
  const [n, setN] = useState(activo ? 0 : texto.length);
  useEffect(() => {
    if (!activo) {
      setN(texto.length);
      return;
    }
    setN(0);
    const id = setInterval(() => setN((k) => (k >= texto.length ? (clearInterval(id), k) : k + 1)), ms);
    return () => clearInterval(id);
  }, [activo, texto, ms]);
  return (
    <Text style={style}>
      {texto.slice(0, n)}
      {cursor && activo && n < texto.length ? '▍' : ''}
    </Text>
  );
}

/** Un ícono de la app (PNG blanco teñido). */
export function Icono({ nombre, tam = 22, color = COLOR.texto }: { nombre: NombreIcono; tam?: number; color?: string }) {
  return <Image source={IMAGENES_ICONOS[nombre]} style={{ width: tam, height: tam, tintColor: color }} resizeMode="contain" />;
}

/** El marco de teléfono donde pasa cada ejemplo. */
export function Pantallita({ children, ancho, alto, fondo = COLOR.panel, style }: { children: ReactNode; ancho: number; alto: number; fondo?: string; style?: StyleProp<ViewStyle> }) {
  return (
    <View style={[s.pantallita, { width: ancho, height: alto, backgroundColor: fondo }, style]}>
      <View style={s.muesca} />
      {children}
    </View>
  );
}

/** Una burbuja de chat: de la persona (derecha) o de AU-RA (izquierda). */
export function Burbuja({ de, children, color = COLOR.aura, style }: { de: 'yo' | 'aura' | 'otro'; children: ReactNode; color?: string; style?: StyleProp<ViewStyle> }) {
  const yo = de === 'yo';
  return (
    <View style={[s.burbuja, yo ? [s.burbujaYo, { backgroundColor: color }] : de === 'aura' ? s.burbujaAura : s.burbujaOtro, style]}>
      {typeof children === 'string' ? <Text style={[s.burbujaTexto, yo && { color: '#141414' }]}>{children}</Text> : children}
    </View>
  );
}

/** El anillo que late encima de lo que hay que tocar, con su manito. */
export function Toca({ activo, color, tam = 76, children, onPress, etiqueta, style }: { activo: boolean; color: string; tam?: number; children: ReactNode; onPress: () => void; etiqueta: string; style?: StyleProp<ViewStyle> }) {
  const late = useCiclo(1300, activo);
  const mano = useVaiven(900, activo);
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={etiqueta} hitSlop={14} style={[{ alignItems: 'center', justifyContent: 'center' }, style]}>
      {activo ? (
        <>
          <Animated.View pointerEvents="none" style={[s.anillo, { width: tam, height: tam, borderRadius: tam / 2, borderColor: color, opacity: late.interpolate({ inputRange: [0, 1], outputRange: [0.9, 0] }), transform: [{ scale: late.interpolate({ inputRange: [0, 1], outputRange: [1, 1.9] }) }] }]} />
          <Animated.View pointerEvents="none" style={[s.anillo, { width: tam, height: tam, borderRadius: tam / 2, borderColor: color, opacity: late.interpolate({ inputRange: [0, 0.5, 1], outputRange: [0, 0.7, 0] }), transform: [{ scale: late.interpolate({ inputRange: [0, 1], outputRange: [1.3, 2.3] }) }] }]} />
        </>
      ) : null}
      {children}
      {activo ? (
        <Animated.View pointerEvents="none" style={[s.mano, { transform: [{ translateY: mano.interpolate({ inputRange: [0, 1], outputRange: [8, -2] }) }, { scale: mano.interpolate({ inputRange: [0, 1], outputRange: [1, 0.9] }) }] }]}>
          <Text style={{ fontSize: 30 }}>👆</Text>
        </Animated.View>
      ) : null}
    </Pressable>
  );
}

/** Barras de sonido que se mueven (una voz sonando). */
export function Ondas({ activo, color, barras = 7, alto = 26 }: { activo: boolean; color: string; barras?: number; alto?: number }) {
  const v = useCiclo(900, activo);
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, height: alto }}>
      {Array.from({ length: barras }, (_, i) => {
        const fase = (i * 0.37) % 1;
        return (
          <Animated.View
            key={i}
            style={{
              width: 4,
              height: alto,
              borderRadius: 2,
              backgroundColor: color,
              transform: [
                {
                  scaleY: activo
                    ? v.interpolate({ inputRange: [0, fase, Math.min(0.999, fase + 0.5), 1], outputRange: [0.25, 1, 0.3, 0.25].map((k, j) => (j === 1 ? 0.55 + 0.45 * ((i % 3) / 2) : k)) })
                    : 0.2,
                },
              ],
            }}
          />
        );
      })}
    </View>
  );
}

/** La cara de ojos (AU-RA dorada, el Guardián celeste): un círculo oscuro con dos ojos que parpadean. */
export function Ojos({ color, tam = 64 }: { color: string; tam?: number }) {
  const parpadeo = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    let vivo = true;
    let t0: ReturnType<typeof setTimeout>;
    const otra = () => {
      t0 = setTimeout(() => {
        if (!vivo) return;
        Animated.sequence([
          Animated.timing(parpadeo, { toValue: 0.1, duration: 70, useNativeDriver: true }),
          Animated.timing(parpadeo, { toValue: 1, duration: 110, useNativeDriver: true }),
        ]).start(otra);
      }, 2200 + Math.random() * 2400);
    };
    otra();
    return () => {
      vivo = false;
      clearTimeout(t0);
    };
  }, [parpadeo]);
  const ojo = { width: tam * 0.2, height: tam * 0.3, borderRadius: tam * 0.1, backgroundColor: color, shadowColor: color, shadowOpacity: 0.9, shadowRadius: tam * 0.12 };
  return (
    <View style={{ width: tam, height: tam, borderRadius: tam / 2, backgroundColor: '#17181B', borderWidth: 2, borderColor: color, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: tam * 0.14 }}>
      <Animated.View style={[ojo, { transform: [{ scaleY: parpadeo }] }]} />
      <Animated.View style={[ojo, { transform: [{ scaleY: parpadeo }] }]} />
    </View>
  );
}

/** Una etiqueta chiquita (estado, «EJEMPLO»). */
export function Chip({ texto, color, fondo, style }: { texto: string; color: string; fondo?: string; style?: StyleProp<ViewStyle> }) {
  return (
    <View style={[s.chip, { borderColor: color, backgroundColor: fondo || 'transparent' }, style]}>
      <Text style={[s.chipTexto, { color }]}>{texto}</Text>
    </View>
  );
}

export const s = StyleSheet.create({
  pantallita: { borderRadius: 28, borderWidth: 1, borderColor: COLOR.borde, overflow: 'hidden', alignSelf: 'center' },
  muesca: { position: 'absolute', top: 7, alignSelf: 'center', width: 64, height: 6, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.12)', zIndex: 5 },
  burbuja: { maxWidth: '84%', paddingHorizontal: 14, paddingVertical: 10, borderRadius: 18 },
  burbujaYo: { alignSelf: 'flex-end', borderBottomRightRadius: 6 },
  burbujaAura: { alignSelf: 'flex-start', backgroundColor: COLOR.panel2, borderBottomLeftRadius: 6, borderWidth: 1, borderColor: 'rgba(214,181,108,0.35)' },
  burbujaOtro: { alignSelf: 'flex-start', backgroundColor: COLOR.panel2, borderBottomLeftRadius: 6 },
  burbujaTexto: { color: COLOR.texto, fontSize: 15, lineHeight: 20 },
  anillo: { position: 'absolute', borderWidth: 3 },
  mano: { position: 'absolute', right: -30, bottom: -10 },
  chip: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4, alignSelf: 'flex-start' },
  chipTexto: { fontSize: 11, fontWeight: '800', letterSpacing: 0.8 },
});
