/**
 * «¿Con quién quieres hablar?»: se elige al entrar (después de la clave) y se cambia desde el menú.
 *
 * Tres tarjetas grandes, cada una con los colores de su avatar: el retrato, el nombre, su oficio,
 * qué voz tiene y qué sabe hacer. Arriba, el idioma (español o inglés), que también decide la voz.
 * Tocar una tarjeta la elige: vibra, se ilumina con su color, se dibuja su palomita ✔ y la mesa la
 * presenta con su voz. La elección también queda en el perfil (lib/perfil.ts), así que Ajustes y el
 * cerebro la ven. En horizontal van lado a lado; en vertical, una debajo de otra.
 *
 * La mesa es un escenario oscuro en los dos temas: esto se pinta siempre con la paleta de noche, con
 * la letra del sistema de diseño (src/ui).
 */
import { useEffect, useRef } from 'react';
import { Animated, Easing, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { T } from '../tema';
import { de, tr, useIdioma } from '../i18n';
import { SelectorIdioma } from '../ui/SelectorIdioma';
import { Palomita, fuente, fuenteDisplay, useFuentes, vibrar } from '../ui';
import { guardarPerfil } from '../lib/perfil';
import { OSCURO } from '../nucleo/tema';
import { AVATARES, avatarPorId, type AvatarId } from './catalogo';
import { MiniAvatar } from './MiniAvatar';

type Props = {
  nombre: string;
  saludo: string;
  actual: AvatarId;
  onElegir: (id: AvatarId) => void;
  /** Sin esto no hay «cerrar»: al entrar hay que elegir. */
  onCerrar?: () => void;
};

export function SelectorAvatar({ nombre, saludo, actual, onElegir, onCerrar }: Props) {
  useIdioma();
  useFuentes();
  const { width, height } = useWindowDimensions();
  const horizontal = width > height;
  const entrada = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(entrada, { toValue: 1, duration: 420, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
  }, [entrada]);

  const ancho = horizontal ? Math.min(250, (width - 96) / 3) : Math.min(width - 40, 440);
  const alto = horizontal ? Math.min(height - 150, 310) : 156;

  return (
    <Animated.View style={[s.raiz, { opacity: entrada }]}>
      <ScrollView contentContainerStyle={[s.contenido, horizontal && s.contenidoH]} showsVerticalScrollIndicator={false}>
        <View style={s.idioma}>
          <SelectorIdioma paleta={OSCURO} />
        </View>
        <Animated.View style={{ transform: [{ translateY: entrada.interpolate({ inputRange: [0, 1], outputRange: [12, 0] }) }], alignItems: 'center' }}>
          <Text style={[s.saludo, fuente('negrita')]}>
            {saludo}, {nombre}
          </Text>
          <Text style={[s.pregunta, fuenteDisplay()]}>{tr('¿Con quién quieres hablar?', 'Who do you want to talk to?')}</Text>
          <Text style={[s.nota, fuente('medio')]}>
            {tr(
              'Cada uno tiene su voz, sus colores y lo suyo. Lo cambias cuando quieras desde el menú.',
              'Each one has its own voice, colors and specialty. Switch anytime from the menu.'
            )}
          </Text>
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
                    vibrar('medio');
                    guardarPerfil({ avatar: a.id });
                    onElegir(a.id);
                  }}
                  android_ripple={{ color: a.tema.acentoFondo }}
                  style={({ pressed }) => [
                    s.tarjeta,
                    { width: ancho, height: alto, flexDirection: horizontal ? 'column' : 'row' },
                    elegido && { borderColor: a.tema.acento, backgroundColor: a.tema.acentoFondo },
                    pressed && { transform: [{ scale: 0.97 }], borderColor: a.tema.acento },
                  ]}
                  accessibilityRole="button"
                  accessibilityLabel={`${de(a.nombre)}. ${de(a.oficio)}. ${de(a.descripcion)} ${tr('Voz', 'Voice')}: ${de(a.voz)}`}
                  accessibilityState={{ selected: elegido }}
                >
                  <View style={[s.foto, { backgroundColor: a.tema.fondo }, horizontal ? { width: '100%', height: Math.round(alto * 0.46) } : { width: alto - 24, height: alto - 24 }]}>
                    <MiniAvatar id={a.id} lado={horizontal ? Math.round(alto * 0.46) : alto - 24} />
                  </View>
                  <View style={[s.texto, !horizontal && { flex: 1 }]}>
                    <Text style={[s.nombre, fuente('extra')]}>{de(a.nombre)}</Text>
                    <Text style={[s.oficio, fuente('negrita'), { color: a.tema.acentoTexto }]}>{de(a.oficio)}</Text>
                    <Text style={[s.desc, fuente('regular')]} numberOfLines={2}>
                      {de(a.descripcion)}
                    </Text>
                    <Text style={[s.voz, fuente('medio')]} numberOfLines={1}>
                      {tr('Voz', 'Voice')}: {de(a.voz)}
                    </Text>
                  </View>
                  {elegido && (
                    <View style={s.marca}>
                      <Palomita hecho tam={26} color={a.tema.acento} colorMarca={a.tema.sobreAcento} vibra={false} />
                    </View>
                  )}
                </Pressable>
              </Animated.View>
            );
          })}
        </View>
        {onCerrar && (
          <Pressable onPress={onCerrar} style={s.cerrar} accessibilityRole="button" hitSlop={8}>
            <Text style={[s.cerrarTexto, fuente('negrita'), { color: avatarPorId(actual).tema.acentoTexto }]}>
              {tr('Seguir con', 'Keep talking to')} {de(avatarPorId(actual).nombre)}
            </Text>
          </Pressable>
        )}
      </ScrollView>
    </Animated.View>
  );
}

const s = StyleSheet.create({
  raiz: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(24,25,27,0.98)', zIndex: 50 },
  contenido: { flexGrow: 1, alignItems: 'center', justifyContent: 'center', padding: 20, paddingTop: 64, gap: 18 },
  contenidoH: { paddingVertical: 14, paddingTop: 14, gap: 14 },
  idioma: { position: 'absolute', top: 14, right: 16 },
  saludo: { color: T.texto2, fontSize: 15, letterSpacing: 0.3 },
  pregunta: { color: T.texto, fontSize: 34, lineHeight: 40, marginTop: 4, textAlign: 'center' },
  nota: { color: T.texto3, fontSize: 13, marginTop: 6, textAlign: 'center', maxWidth: 520 },
  tarjetas: { gap: 14, alignItems: 'center' },
  tarjeta: { backgroundColor: T.panel, borderRadius: 24, borderWidth: 1.5, borderColor: T.borde, padding: 12, gap: 12, overflow: 'hidden', alignItems: 'center' },
  foto: { borderRadius: 18, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  texto: { gap: 2, alignSelf: 'stretch' },
  nombre: { color: T.texto, fontSize: 18 },
  oficio: { fontSize: 13 },
  desc: { color: T.texto2, fontSize: 13, lineHeight: 18 },
  voz: { color: T.texto3, fontSize: 12, marginTop: 2 },
  marca: { position: 'absolute', top: 10, right: 10 },
  cerrar: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 16 },
  cerrarTexto: { fontSize: 15 },
});
