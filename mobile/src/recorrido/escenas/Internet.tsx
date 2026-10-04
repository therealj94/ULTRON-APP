/**
 * Internet: la búsqueda se escribe sola, giran los sitios que lee y sale el resumen en dos frases. Es
 * un ejemplo y lo dice («EJEMPLO»): nadie tiene que creerse el precio de la tarjeta.
 */
import { Animated, StyleSheet, Text, View } from 'react-native';
import { COLOR, Chip, Entra, Escribe, Icono, Pantallita, t, useCiclo, type PropsEscena } from './comun';

const SITIOS = ['🌐', '📰', '📊'];

export default function Internet({ paso, ancho, alto, idioma }: PropsEscena) {
  const listo = paso === 'resultado';
  const gira = useCiclo(1100, !listo);
  const W = Math.min(ancho - 20, 440);
  const H = alto - 12;
  return (
    <Pantallita ancho={W} alto={H}>
      <View style={st.barra}>
        <Icono nombre="globo" tam={20} color={COLOR.antonio} />
        <Escribe texto={t(idioma, 'precio del oro hoy', 'gold price today')} activo={paso === 'busca'} ms={70} style={st.busqueda} />
      </View>
      {!listo ? (
        <View style={st.leyendo}>
          <Animated.View style={{ transform: [{ rotate: gira.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] }) }] }}>
            <Text style={{ fontSize: 34 }}>🔎</Text>
          </Animated.View>
          <Text style={st.leyendoTexto}>{t(idioma, 'Buscando y leyendo…', 'Searching and reading…')}</Text>
          <View style={{ flexDirection: 'row', gap: 10 }}>
            {SITIOS.map((s, k) => (
              <Entra key={s} visible retraso={600 + k * 400}>
                <View style={st.sitio}>
                  <Text style={{ fontSize: 22 }}>{s}</Text>
                </View>
              </Entra>
            ))}
          </View>
        </View>
      ) : (
        <Entra visible style={st.resultado}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <Text style={st.titulo}>{t(idioma, 'El oro hoy', 'Gold today')}</Text>
            <Chip texto={t(idioma, 'EJEMPLO', 'EXAMPLE')} color={COLOR.claudio} />
          </View>
          <View style={st.grafica}>
            {[0.35, 0.42, 0.38, 0.5, 0.47, 0.58, 0.62, 0.7].map((h, k) => (
              <Entra key={k} visible retraso={k * 70} desde={10} style={{ flex: 1, height: '100%', justifyContent: 'flex-end' }}>
                <View style={[st.barraGrafica, { height: `${h * 100}%`, backgroundColor: k === 7 ? COLOR.aura : 'rgba(214,181,108,0.4)' }]} />
              </Entra>
            ))}
          </View>
          <Text style={st.resumen}>
            {t(idioma, 'Subió un poco esta semana y sigue cerca de su máximo. Lo leí en tres sitios y coinciden.', 'It rose a bit this week and stays near its high. I read it on three sites and they agree.')}
          </Text>
          <Text style={st.fuentes}>{t(idioma, 'Fuentes: 3 sitios', 'Sources: 3 sites')}</Text>
        </Entra>
      )}
    </Pantallita>
  );
}

const st = StyleSheet.create({
  barra: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 26, marginHorizontal: 12, paddingHorizontal: 14, paddingVertical: 12, borderRadius: 999, backgroundColor: COLOR.panel2, borderWidth: 1, borderColor: 'rgba(69,201,222,0.4)' },
  busqueda: { color: COLOR.texto, fontSize: 16, fontWeight: '600', flex: 1 },
  leyendo: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 14 },
  leyendoTexto: { color: COLOR.texto2, fontSize: 14, fontWeight: '700' },
  sitio: { width: 50, height: 50, borderRadius: 14, backgroundColor: COLOR.panel2, alignItems: 'center', justifyContent: 'center' },
  resultado: { margin: 12, padding: 16, borderRadius: 20, backgroundColor: COLOR.panel2, gap: 10 },
  titulo: { color: COLOR.texto, fontSize: 19, fontWeight: '800' },
  grafica: { height: 70, flexDirection: 'row', alignItems: 'flex-end', gap: 6 },
  barraGrafica: { borderRadius: 4 },
  resumen: { color: COLOR.texto, fontSize: 14.5, lineHeight: 21 },
  fuentes: { color: COLOR.texto3, fontSize: 12 },
});
