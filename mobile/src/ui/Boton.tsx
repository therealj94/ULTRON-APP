/**
 * El botón de la app: responde al dedo como uno nativo.
 *
 * Al tocar se hunde un poco (escala 0,97) y vibra suave; al soltar vuelve con un resorte. Un botón
 * que no reacciona es lo primero que delata que una app «parece web». Tres variantes: principal
 * (dorado, una por pantalla), secundario (salvia apagada) y texto (enlace con área de toque de 44).
 */
import { useRef, type ReactNode } from 'react';
import { ActivityIndicator, Animated, Pressable, StyleSheet, Text, type StyleProp, type ViewStyle } from 'react-native';
import * as Haptics from 'expo-haptics';
import { T } from '../tema';

type Props = {
  titulo: string;
  onPress: () => void;
  variante?: 'principal' | 'secundario' | 'texto' | 'contorno';
  cargando?: boolean;
  deshabilitado?: boolean;
  icono?: ReactNode;
  style?: StyleProp<ViewStyle>;
  etiqueta?: string;
};

export function Boton({ titulo, onPress, variante = 'principal', cargando, deshabilitado, icono, style, etiqueta }: Props) {
  const escala = useRef(new Animated.Value(1)).current;
  const apagado = deshabilitado || cargando;
  const hundir = () => {
    Animated.timing(escala, { toValue: 0.97, duration: 80, useNativeDriver: true }).start();
    void Haptics.selectionAsync().catch(() => {});
  };
  const soltar = () => Animated.spring(escala, { toValue: 1, useNativeDriver: true, speed: 30, bounciness: 6 }).start();
  const caja = variante === 'principal' ? s.principal : variante === 'secundario' ? s.secundario : variante === 'contorno' ? s.contorno : s.texto;
  const letra = variante === 'principal' ? s.letraPrincipal : variante === 'secundario' ? s.letraSecundario : variante === 'contorno' ? s.letraContorno : s.letraTexto;

  return (
    <Animated.View style={[{ transform: [{ scale: escala }] }, style, apagado && s.apagado]}>
      <Pressable
        onPress={apagado ? undefined : onPress}
        onPressIn={apagado ? undefined : hundir}
        onPressOut={soltar}
        android_ripple={variante === 'texto' ? undefined : { color: 'rgba(255,255,255,0.12)', borderless: false }}
        style={[s.base, caja]}
        accessibilityRole="button"
        accessibilityLabel={etiqueta || titulo}
        accessibilityState={{ disabled: !!apagado, busy: !!cargando }}
      >
        {cargando ? (
          <ActivityIndicator color={variante === 'principal' ? T.sobrePrincipal : T.principalTexto} />
        ) : (
          <>
            {icono}
            <Text style={letra}>{titulo}</Text>
          </>
        )}
      </Pressable>
    </Animated.View>
  );
}

const s = StyleSheet.create({
  base: { minHeight: 52, borderRadius: 26, paddingHorizontal: 22, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, overflow: 'hidden' },
  principal: { backgroundColor: T.principal },
  secundario: { backgroundColor: T.activoFondo },
  contorno: { borderWidth: 1, borderColor: T.borde, backgroundColor: 'transparent' },
  texto: { minHeight: 44, backgroundColor: 'transparent', paddingHorizontal: 8 },
  letraPrincipal: { color: T.sobrePrincipal, fontSize: 16, fontWeight: '700', letterSpacing: 0.2 },
  letraSecundario: { color: T.activoTexto, fontSize: 15, fontWeight: '600' },
  letraContorno: { color: T.texto, fontSize: 15, fontWeight: '600' },
  letraTexto: { color: T.principalTexto, fontSize: 14, fontWeight: '600' },
  apagado: { opacity: 0.55 },
});
