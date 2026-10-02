/**
 * La memoria: la persona le pide que se acuerde, la nota vuela a su memoria (un brillo que la guarda);
 * pasan las semanas en el calendario y, cuando pregunta, AU-RA se acuerda.
 */
import { Animated, StyleSheet, Text, View } from 'react-native';
import { Burbuja, COLOR, Entra, Pantallita, t, useAparece, useVaiven, type PropsEscena } from './comun';

export default function Memoria({ paso, ancho, alto, idioma }: PropsEscena) {
  const despues = paso === 'recuerda';
  const vuela = useAparece(true, { ms: 1100, retraso: 1400 });
  const brillo = useVaiven(1800);
  const W = Math.min(ancho - 20, 440);
  const H = alto - 12;
  return (
    <Pantallita ancho={W} alto={H}>
      {!despues ? (
        <View style={st.lienzo}>
          <Burbuja de="yo" style={{ marginTop: 26, marginRight: 12 }}>
            {t(idioma, 'Acuérdate: el cumpleaños de mi mamá es el 14 de marzo', 'Remember: my mom’s birthday is March 14')}
          </Burbuja>
          <View style={st.centro}>
            <Animated.View style={[st.memoria, { opacity: brillo.interpolate({ inputRange: [0, 1], outputRange: [0.75, 1] }), transform: [{ scale: brillo.interpolate({ inputRange: [0, 1], outputRange: [0.96, 1.05] }) }] }]}>
              <Text style={{ fontSize: 44 }}>🧠</Text>
              <Text style={st.memoriaTexto}>{t(idioma, 'Memoria de AU-RA', 'AU-RA’s memory')}</Text>
            </Animated.View>
            <Animated.View
              style={[
                st.nota,
                {
                  opacity: vuela.interpolate({ inputRange: [0, 0.8, 1], outputRange: [1, 0.9, 0] }),
                  transform: [{ translateY: vuela.interpolate({ inputRange: [0, 1], outputRange: [-110, 0] }) }, { scale: vuela.interpolate({ inputRange: [0, 1], outputRange: [1, 0.25] }) }],
                },
              ]}
            >
              <Text style={st.notaTexto}>🎂 {t(idioma, 'Mamá · 14 de marzo', 'Mom · March 14')}</Text>
            </Animated.View>
          </View>
          <Entra visible retraso={2500}>
            <Text style={st.guardado}>✓ {t(idioma, 'Guardado en su memoria', 'Saved in her memory')}</Text>
          </Entra>
        </View>
      ) : (
        <View style={[st.lienzo, { paddingTop: 24, gap: 10 }]}>
          <Entra visible>
            <View style={st.calendario}>
              <Text style={st.calMes}>{t(idioma, 'TRES SEMANAS DESPUÉS', 'THREE WEEKS LATER')}</Text>
              <Text style={st.calDia}>📅</Text>
            </View>
          </Entra>
          <Entra visible retraso={600} style={{ paddingHorizontal: 12 }}>
            <Burbuja de="yo">{t(idioma, '¿Cuándo cumple años mi mamá?', 'When is my mom’s birthday?')}</Burbuja>
          </Entra>
          <Entra visible retraso={1500} style={{ paddingHorizontal: 12 }}>
            <Burbuja de="aura">
              <Text style={st.de}>AU-RA</Text>
              <Text style={st.texto}>{t(idioma, 'El 14 de marzo. ¿Quieres que te lo recuerde ese día en la mañana?', 'On March 14. Want me to remind you that morning?')}</Text>
            </Burbuja>
          </Entra>
        </View>
      )}
    </Pantallita>
  );
}

const st = StyleSheet.create({
  lienzo: { flex: 1 },
  centro: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  memoria: { width: 150, height: 150, borderRadius: 75, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(214,181,108,0.12)', borderWidth: 2, borderColor: 'rgba(214,181,108,0.6)' },
  memoriaTexto: { color: COLOR.aura, fontSize: 12, fontWeight: '800', marginTop: 4 },
  nota: { position: 'absolute', paddingHorizontal: 14, paddingVertical: 10, borderRadius: 14, backgroundColor: '#FFF6D6' },
  notaTexto: { color: '#3B2F12', fontSize: 15, fontWeight: '800' },
  guardado: { color: COLOR.verde, fontSize: 14, fontWeight: '800', textAlign: 'center', marginBottom: 16 },
  calendario: { alignSelf: 'center', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 8, borderRadius: 14, backgroundColor: COLOR.panel2 },
  calMes: { color: COLOR.texto3, fontSize: 11, fontWeight: '800', letterSpacing: 1.2 },
  calDia: { fontSize: 30 },
  de: { color: COLOR.aura, fontSize: 11, fontWeight: '800', letterSpacing: 1, marginBottom: 2 },
  texto: { color: COLOR.texto, fontSize: 14.5, lineHeight: 20 },
});
