/**
 * «¿Con quién quieres hablar?»: la bienvenida la primera vez, y el cambio de avatar desde el menú.
 *
 * Tres tarjetas grandes con el personaje de verdad (las mismas fotos que se mueven en la mesa), su
 * nombre, cómo es y qué voz tiene. Tocar una la elige: vibra, se ilumina el borde y la mesa la
 * presenta con su propia voz. En horizontal van lado a lado; en vertical, una debajo de la otra.
 */
import { useEffect, useRef } from 'react';
import { Animated, Easing, Image, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import * as Haptics from 'expo-haptics';
import { T } from '../tema';
import { AVATARES, type AvatarId } from './catalogo';
import { FOTOS_CLAUDIO } from './ClaudioRetrato';
import { FOTOS_CLAUDIO_PIE } from './ClaudioDePie';

type Props = {
  nombre: string;
  saludo: string;
  actual: AvatarId;
  onElegir: (id: AvatarId) => void;
  /** Sin esto no hay «cerrar»: la primera vez hay que elegir. */
  onCerrar?: () => void;
};

/** Los ojos de AU-RA en miniatura: dos anillos dorados sobre negro, como su cara en la mesa. */
function OjosAura() {
  return (
    <View style={s.ojosCaja}>
      <View style={s.ojos}>
        <View style={s.ojo}>
          <View style={s.pupila} />
        </View>
        <View style={s.ojo}>
          <View style={s.pupila} />
        </View>
      </View>
    </View>
  );
}

export function SelectorAvatar({ nombre, saludo, actual, onElegir, onCerrar }: Props) {
  const { width, height } = useWindowDimensions();
  const horizontal = width > height;
  const entrada = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(entrada, { toValue: 1, duration: 420, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
  }, [entrada]);

  const ancho = horizontal ? Math.min(240, (width - 96) / 3) : Math.min(width - 40, 420);
  const alto = horizontal ? Math.min(height - 150, 300) : 150;

  return (
    <Animated.View style={[s.raiz, { opacity: entrada }]}>
      <ScrollView contentContainerStyle={[s.contenido, horizontal && s.contenidoH]} showsVerticalScrollIndicator={false}>
        <Animated.View style={{ transform: [{ translateY: entrada.interpolate({ inputRange: [0, 1], outputRange: [12, 0] }) }], alignItems: 'center' }}>
          <Text style={s.saludo}>{saludo}, {nombre}</Text>
          <Text style={s.pregunta}>¿Con quién quieres hablar?</Text>
          <Text style={s.nota}>Lo cambias cuando quieras desde el menú. Todos saben lo mismo; cambia la cara y la voz.</Text>
        </Animated.View>
        <View style={[s.tarjetas, { flexDirection: horizontal ? 'row' : 'column' }]}>
          {AVATARES.map((a, i) => {
            const elegido = a.id === actual;
            return (
              <Animated.View
                key={a.id}
                style={{
                  opacity: entrada,
                  transform: [{ translateY: entrada.interpolate({ inputRange: [0, 1], outputRange: [24 + i * 12, 0] }) }],
                }}
              >
                <Pressable
                  onPress={() => {
                    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
                    onElegir(a.id);
                  }}
                  android_ripple={{ color: 'rgba(214,181,108,0.18)' }}
                  style={({ pressed }) => [
                    s.tarjeta,
                    { width: ancho, height: alto, flexDirection: horizontal ? 'column' : 'row' },
                    elegido && s.tarjetaElegida,
                    pressed && { transform: [{ scale: 0.97 }] },
                  ]}
                  accessibilityRole="button"
                  accessibilityLabel={`${a.nombre}. ${a.descripcion} Voz: ${a.voz}`}
                  accessibilityState={{ selected: elegido }}
                >
                  <View style={[s.foto, horizontal ? { width: '100%', flex: 1 } : { width: alto - 24, height: alto - 24 }]}>
                    {a.id === 'aura' ? (
                      <OjosAura />
                    ) : (
                      <Image source={a.id === 'claudio' ? FOTOS_CLAUDIO.base : FOTOS_CLAUDIO_PIE.base} resizeMode="contain" style={s.img} />
                    )}
                  </View>
                  <View style={[s.texto, !horizontal && { flex: 1 }]}>
                    <Text style={s.nombre}>{a.nombre}</Text>
                    <Text style={s.desc} numberOfLines={2}>
                      {a.descripcion}
                    </Text>
                    <Text style={s.voz}>Voz: {a.voz}</Text>
                  </View>
                  {elegido && <Text style={s.marca}>✓</Text>}
                </Pressable>
              </Animated.View>
            );
          })}
        </View>
        {onCerrar && (
          <Pressable onPress={onCerrar} style={s.cerrar} accessibilityRole="button" hitSlop={8}>
            <Text style={s.cerrarTexto}>Seguir con {AVATARES.find((a) => a.id === actual)?.nombre}</Text>
          </Pressable>
        )}
      </ScrollView>
    </Animated.View>
  );
}

const s = StyleSheet.create({
  raiz: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(35,37,40,0.97)', zIndex: 50 },
  contenido: { flexGrow: 1, alignItems: 'center', justifyContent: 'center', padding: 20, gap: 18 },
  contenidoH: { paddingVertical: 14, gap: 14 },
  saludo: { color: T.principalTexto, fontSize: 15, fontWeight: '700', letterSpacing: 0.3 },
  pregunta: { color: T.texto, fontSize: 26, fontWeight: '800', marginTop: 4, textAlign: 'center' },
  nota: { color: T.texto3, fontSize: 13, marginTop: 6, textAlign: 'center', maxWidth: 520 },
  tarjetas: { gap: 14, alignItems: 'center' },
  tarjeta: { backgroundColor: T.panel, borderRadius: 24, borderWidth: 1.5, borderColor: T.borde, padding: 12, gap: 12, overflow: 'hidden', alignItems: 'center' },
  tarjetaElegida: { borderColor: T.principal, backgroundColor: T.principalFondo },
  foto: { borderRadius: 18, backgroundColor: T.fondo, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  img: { width: '100%', height: '100%' },
  texto: { gap: 2, alignSelf: 'stretch' },
  nombre: { color: T.texto, fontSize: 18, fontWeight: '800' },
  desc: { color: T.texto2, fontSize: 13, lineHeight: 18 },
  voz: { color: T.texto3, fontSize: 12, marginTop: 2 },
  marca: { position: 'absolute', top: 10, right: 14, color: T.principal, fontSize: 20, fontWeight: '800' },
  ojosCaja: { flex: 1, width: '100%', backgroundColor: '#000', alignItems: 'center', justifyContent: 'center' },
  ojos: { flexDirection: 'row', gap: 18 },
  ojo: { width: 44, height: 44, borderRadius: 22, borderWidth: 5, borderColor: T.principal, alignItems: 'center', justifyContent: 'center' },
  pupila: { width: 12, height: 12, borderRadius: 6, backgroundColor: T.principalTexto },
  cerrar: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 16 },
  cerrarTexto: { color: T.principalTexto, fontSize: 15, fontWeight: '700' },
});
