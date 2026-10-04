/**
 * Háblale: el micrófono late con la voz, la pregunta se escribe sola, AU-RA contesta con su agenda y,
 * cuando se alarga, la persona le habla encima y se calla.
 */
import { Animated, StyleSheet, Text, View } from 'react-native';
import { Burbuja, COLOR, Entra, Escribe, Icono, Ondas, Pantallita, t, useAparece, useVaiven, type PropsEscena } from './comun';

const ORDEN = ['mic', 'pregunta', 'respuesta', 'interrumpe'];

export default function Hablar({ paso, ancho, alto, idioma }: PropsEscena) {
  const i = ORDEN.indexOf(paso);
  const late = useVaiven(1100);
  const corta = useAparece(i >= 3, { ms: 260 });
  const W = Math.min(ancho - 20, 440);
  return (
    <Pantallita ancho={W} alto={alto - 12}>
      <View style={st.chat}>
        <Entra visible={i >= 1}>
          <Burbuja de="yo">
            <Escribe texto={t(idioma, '¿Qué tengo que hacer hoy?', 'What do I have to do today?')} activo={i === 1} style={st.yo} />
          </Burbuja>
        </Entra>
        <Entra visible={i >= 2} retraso={150}>
          <Animated.View style={{ opacity: corta.interpolate({ inputRange: [0, 1], outputRange: [1, 0.45] }) }}>
            <Burbuja de="aura">
              <Text style={st.de}>AU-RA</Text>
              <Text style={st.texto}>{t(idioma, 'Hoy tienes tres cosas:', 'Today you have three things:')}</Text>
              <Text style={st.item}>🕙 {t(idioma, '10:00 · Reunión con Beto', '10:00 · Meeting with Beto')}</Text>
              <Text style={st.item}>💡 {t(idioma, '2:00 · Pagar la luz', '2:00 · Pay the power bill')}</Text>
              <Text style={st.item}>💊 {t(idioma, '5:00 · Tu pastilla', '5:00 · Your pill')}</Text>
              <Text style={st.texto}>{t(idioma, 'Y además, a las tres…', 'And also, at three…')}</Text>
            </Burbuja>
          </Animated.View>
        </Entra>
        <Entra visible={i >= 3} retraso={120}>
          <Burbuja de="yo">{t(idioma, '¡Espera, espera!', 'Wait, wait!')}</Burbuja>
        </Entra>
        <Entra visible={i >= 3} retraso={600}>
          <View style={st.calla}>
            <Text style={{ fontSize: 16 }}>🤫</Text>
            <Text style={st.callaTexto}>{t(idioma, 'Se calló. Te escucha.', 'She stopped. She’s listening.')}</Text>
          </View>
        </Entra>
      </View>
      <View style={st.pie}>
        <Animated.View style={[st.mic, { transform: [{ scale: late.interpolate({ inputRange: [0, 1], outputRange: [1, i === 0 || i === 3 ? 1.12 : 1.03] }) }] }]}>
          <Icono nombre="microfono" tam={30} color="#141414" />
        </Animated.View>
        <View style={{ alignItems: 'flex-start', gap: 4 }}>
          <Text style={st.estado}>{i === 2 ? t(idioma, 'AU-RA habla', 'AU-RA is talking') : t(idioma, 'Te escucho', 'I’m listening')}</Text>
          <Ondas activo color={i === 2 ? COLOR.aura : COLOR.verde} barras={9} />
        </View>
      </View>
    </Pantallita>
  );
}

const st = StyleSheet.create({
  chat: { flex: 1, paddingHorizontal: 14, paddingTop: 26, gap: 10 },
  yo: { color: '#141414', fontSize: 15, fontWeight: '600' },
  de: { color: COLOR.aura, fontSize: 11, fontWeight: '800', letterSpacing: 1, marginBottom: 2 },
  texto: { color: COLOR.texto, fontSize: 14.5, lineHeight: 20 },
  item: { color: COLOR.texto, fontSize: 14, lineHeight: 21, paddingLeft: 2 },
  calla: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'center', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999, backgroundColor: 'rgba(61,220,132,0.14)' },
  callaTexto: { color: COLOR.verde, fontSize: 13, fontWeight: '700' },
  pie: { flexDirection: 'row', alignItems: 'center', gap: 14, padding: 14, borderTopWidth: 1, borderTopColor: COLOR.borde },
  mic: { width: 58, height: 58, borderRadius: 29, backgroundColor: COLOR.aura, alignItems: 'center', justifyContent: 'center' },
  estado: { color: COLOR.texto2, fontSize: 13, fontWeight: '700' },
});
