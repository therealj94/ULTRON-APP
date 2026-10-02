/**
 * El final: chispas, la ventana de AURA para Windows que se asoma (su recorrido va aparte) y las
 * opciones para probar de verdad, ahora mismo, con un toque (cada una hace lo mismo que su botón en la
 * mesa: DeskScreen).
 */
import { Animated, Pressable, StyleSheet, Text, View } from 'react-native';
import { OPCIONES_FINAL } from '../guion';
import type { NombreIcono } from '../../ui/iconos';
import { COLOR, Entra, Icono, t, useCiclo, useVaiven, type PropsEscena } from './comun';

const ICONOS: Record<string, NombreIcono> = { hablar: 'microfono', camara: 'camara', llamame: 'llamada', recordatorio: 'reloj', chat: 'chat' };
const CHISPAS = ['✨', '🎉', '⭐', '✨', '🎊', '⭐', '✨', '🎉'];

export default function Final({ paso, esperando, ancho, alto, idioma, acento, onElegir }: PropsEscena) {
  const cae = useCiclo(3800);
  const late = useVaiven(1200, esperando);
  const opciones = paso === 'opciones';
  return (
    <View style={{ width: ancho, height: alto, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
      {CHISPAS.map((c, k) => (
        <Animated.Text
          key={k}
          style={[
            st.chispa,
            {
              left: ((k + 0.5) / CHISPAS.length) * ancho - 10,
              opacity: cae.interpolate({ inputRange: [0, 0.1, 0.85, 1], outputRange: [0, 1, 1, 0] }),
              transform: [{ translateY: cae.interpolate({ inputRange: [0, 1], outputRange: [-30 - (k % 3) * 30, alto + 20] }) }, { rotate: cae.interpolate({ inputRange: [0, 1], outputRange: ['0deg', `${k % 2 ? 200 : -200}deg`] }) }],
            },
          ]}
        >
          {c}
        </Animated.Text>
      ))}
      {!opciones ? (
        <Entra visible style={st.windows}>
          <View style={st.windowsBarra}>
            <View style={st.windowsLogo}>
              {[0, 1, 2, 3].map((k) => (
                <View key={k} style={st.windowsCuadro} />
              ))}
            </View>
            <Text style={st.windowsTitulo}>AURA · Windows</Text>
          </View>
          <Text style={st.windowsTexto}>{t(idioma, 'También en tu computadora. Su recorrido viene aparte.', 'Also on your computer. Its tour comes separately.')}</Text>
        </Entra>
      ) : (
        <View style={[st.opciones, { width: Math.min(ancho - 24, 460) }]}>
          {OPCIONES_FINAL.map((o, k) => (
            <Entra key={o.id} visible retraso={k * 110} style={{ width: '48%' }}>
              <Animated.View style={{ transform: [{ scale: late.interpolate({ inputRange: [0, 1], outputRange: [1, k % 2 ? 1.03 : 1.015] }) }] }}>
                <Pressable onPress={() => onElegir?.(o.id)} accessibilityRole="button" accessibilityLabel={o.etiqueta[idioma]} style={({ pressed }) => [st.opcion, { borderColor: acento }, pressed && { backgroundColor: 'rgba(255,255,255,0.08)' }]}>
                  <Icono nombre={ICONOS[o.id]} tam={26} color={acento} />
                  <Text style={st.opcionTexto}>{o.etiqueta[idioma]}</Text>
                </Pressable>
              </Animated.View>
            </Entra>
          ))}
        </View>
      )}
    </View>
  );
}

const st = StyleSheet.create({
  chispa: { position: 'absolute', top: 0, fontSize: 22 },
  windows: { width: 280, borderRadius: 14, backgroundColor: '#1D2633', borderWidth: 1, borderColor: 'rgba(79,168,255,0.5)', overflow: 'hidden' },
  windowsBarra: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, backgroundColor: '#243246' },
  windowsLogo: { width: 22, height: 22, flexDirection: 'row', flexWrap: 'wrap', gap: 2 },
  windowsCuadro: { width: 10, height: 10, backgroundColor: COLOR.azul },
  windowsTitulo: { color: COLOR.texto, fontSize: 16, fontWeight: '800' },
  windowsTexto: { color: COLOR.texto2, fontSize: 14, padding: 14, lineHeight: 20 },
  opciones: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: 12 },
  opcion: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingVertical: 16, borderRadius: 18, borderWidth: 1.5, backgroundColor: COLOR.panel },
  opcionTexto: { color: COLOR.texto, fontSize: 15, fontWeight: '800', flexShrink: 1 },
});
