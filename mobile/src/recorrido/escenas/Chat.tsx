/**
 * Los mensajes de PULSE2CHAT: llega el mensaje de Beto y AU-RA lo lee en voz alta; arma la respuesta
 * como borrador y espera el «sí» (la persona toca «Sí, envíalo» o sale solo); la burbuja se va al chat
 * con las dos palomitas.
 */
import { Animated, StyleSheet, Text, View } from 'react-native';
import { Burbuja, COLOR, Entra, Icono, Ondas, Pantallita, t, Toca, useAparece, type PropsEscena } from './comun';

const ORDEN = ['lee', 'borrador', 'enviado'];

export default function Chat({ paso, esperando, onToque, ancho, alto, idioma, acento }: PropsEscena) {
  const i = ORDEN.indexOf(paso);
  const enviado = useAparece(i >= 2, { resorte: true });
  const palomitas = useAparece(i >= 2, { ms: 300, retraso: 700 });
  const W = Math.min(ancho - 20, 440);
  const H = alto - 12;
  const respuesta = t(idioma, 'Sí, llego a las tres 👍', 'Yes, I’ll be there at three 👍');
  return (
    <Pantallita ancho={W} alto={H}>
      <View style={st.cabecera}>
        <View style={st.avatar}>
          <Text style={st.inicial}>B</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={st.nombre}>Beto</Text>
          <Text style={st.sub}>PULSE2CHAT · {t(idioma, 'cifrado', 'encrypted')}</Text>
        </View>
        <Icono nombre="llamada" tam={20} color={COLOR.texto2} />
      </View>
      <View style={st.mensajes}>
        <Entra visible>
          <Burbuja de="otro">
            <Text style={st.texto}>{t(idioma, '¿Llegas a la reunión de las tres?', 'Are you coming to the three o’clock meeting?')}</Text>
            <Text style={st.horaMsg}>2:41 p. m.</Text>
          </Burbuja>
        </Entra>
        {i === 0 ? (
          <Entra visible retraso={500}>
            <View style={st.lee}>
              <Icono nombre="volumen" tam={16} color={COLOR.aura} />
              <Text style={st.leeTexto}>{t(idioma, 'AU-RA te lo lee', 'AU-RA reads it to you')}</Text>
              <Ondas activo color={COLOR.aura} barras={6} alto={16} />
            </View>
          </Entra>
        ) : null}
        {/* La respuesta ya enviada, con sus palomitas azules. */}
        <Animated.View style={{ opacity: enviado, transform: [{ translateY: enviado.interpolate({ inputRange: [0, 1], outputRange: [60, 0] }) }, { scale: enviado.interpolate({ inputRange: [0, 1], outputRange: [0.8, 1] }) }] }}>
          {i >= 2 ? (
            <Burbuja de="yo" color={acento}>
              <Text style={[st.texto, { color: '#141414' }]}>{respuesta}</Text>
              <View style={st.pieMsg}>
                <Text style={[st.horaMsg, { color: 'rgba(0,0,0,0.55)' }]}>2:42 p. m.</Text>
                <Animated.Text style={[st.palomitas, { opacity: palomitas }]}>✓✓</Animated.Text>
              </View>
            </Burbuja>
          ) : null}
        </Animated.View>
      </View>
      {/* El borrador que espera el «sí». */}
      {i === 1 ? (
        <Entra visible style={st.borrador}>
          <Text style={st.borradorDe}>{t(idioma, 'BORRADOR · NO ENVIADO', 'DRAFT · NOT SENT')}</Text>
          <Text style={st.borradorTexto}>{respuesta}</Text>
          <Text style={st.borradorPregunta}>{t(idioma, 'AU-RA: ¿Lo envío?', 'AU-RA: Shall I send it?')}</Text>
          <View style={st.botones}>
            <View style={st.cambiar}>
              <Text style={st.cambiarTexto}>{t(idioma, 'Cambiar', 'Change')}</Text>
            </View>
            <Toca activo={esperando} color={COLOR.verde} tam={50} onPress={onToque} etiqueta={t(idioma, 'Sí, envíalo', 'Yes, send it')}>
              <View style={st.enviar}>
                <Text style={st.enviarTexto}>{t(idioma, 'Sí, envíalo', 'Yes, send it')}</Text>
              </View>
            </Toca>
          </View>
        </Entra>
      ) : (
        <View style={st.escribir}>
          <Text style={st.escribirTexto}>{t(idioma, 'Mensaje', 'Message')}</Text>
          <Icono nombre="microfono" tam={20} color={COLOR.texto3} />
        </View>
      )}
    </Pantallita>
  );
}

const st = StyleSheet.create({
  cabecera: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingTop: 22, paddingHorizontal: 14, paddingBottom: 10, borderBottomWidth: 1, borderBottomColor: COLOR.borde },
  avatar: { width: 38, height: 38, borderRadius: 19, backgroundColor: '#2E4A3A', alignItems: 'center', justifyContent: 'center' },
  inicial: { color: COLOR.texto, fontSize: 16, fontWeight: '800' },
  nombre: { color: COLOR.texto, fontSize: 16, fontWeight: '800' },
  sub: { color: COLOR.texto3, fontSize: 12 },
  mensajes: { flex: 1, padding: 14, gap: 10 },
  texto: { color: COLOR.texto, fontSize: 15, lineHeight: 20 },
  horaMsg: { color: COLOR.texto3, fontSize: 11, marginTop: 3, alignSelf: 'flex-end' },
  pieMsg: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 4 },
  palomitas: { color: '#1E6FD9', fontSize: 13, fontWeight: '900', marginTop: 3 },
  lee: { flexDirection: 'row', alignItems: 'center', gap: 8, alignSelf: 'flex-start', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999, backgroundColor: 'rgba(214,181,108,0.14)' },
  leeTexto: { color: COLOR.aura, fontSize: 13, fontWeight: '700' },
  borrador: { margin: 12, padding: 14, borderRadius: 18, borderWidth: 1.5, borderStyle: 'dashed', borderColor: COLOR.aura, backgroundColor: 'rgba(214,181,108,0.08)', gap: 6 },
  borradorDe: { color: COLOR.aura, fontSize: 11, fontWeight: '800', letterSpacing: 1 },
  borradorTexto: { color: COLOR.texto, fontSize: 16, fontWeight: '600' },
  borradorPregunta: { color: COLOR.texto2, fontSize: 13 },
  botones: { flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center', gap: 10, marginTop: 4 },
  cambiar: { paddingHorizontal: 14, paddingVertical: 10, borderRadius: 999, borderWidth: 1, borderColor: COLOR.borde },
  cambiarTexto: { color: COLOR.texto2, fontSize: 14, fontWeight: '700' },
  enviar: { paddingHorizontal: 18, paddingVertical: 11, borderRadius: 999, backgroundColor: COLOR.verde },
  enviarTexto: { color: '#062312', fontSize: 15, fontWeight: '800' },
  escribir: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', margin: 12, paddingHorizontal: 16, paddingVertical: 12, borderRadius: 999, backgroundColor: COLOR.panel2 },
  escribirTexto: { color: COLOR.texto3, fontSize: 15 },
});
