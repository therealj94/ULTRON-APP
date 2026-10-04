/**
 * La computadora en la nube: una ventana sale de la nube, el cursor se mueve solo, escribe en el
 * buscador, hace clic y aparecen los resultados; al final, el aviso de que terminó con lo que encontró.
 */
import { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, Text, View } from 'react-native';
import { COLOR, Entra, Escribe, Pantallita, t, useAparece, type PropsEscena } from './comun';

const ORDEN = ['abre', 'cursor', 'listo'];

export default function Computadora({ paso, ancho, alto, idioma }: PropsEscena) {
  const i = ORDEN.indexOf(paso);
  const ventana = useAparece(true, { resorte: true });
  const W = Math.min(ancho - 20, 440);
  const H = alto - 12;
  // El cursor recorre: del centro al buscador (escribe), al botón (clic) y al primer resultado (clic).
  const recorrido = useRef(new Animated.Value(0)).current;
  const clic = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (i < 1) {
      recorrido.setValue(0);
      return;
    }
    const pulsa = () => Animated.sequence([Animated.timing(clic, { toValue: 1, duration: 120, useNativeDriver: true }), Animated.timing(clic, { toValue: 0, duration: 320, useNativeDriver: true })]);
    const a = Animated.sequence([
      Animated.timing(recorrido, { toValue: 1, duration: 700, easing: Easing.inOut(Easing.cubic), useNativeDriver: true }),
      pulsa(),
      Animated.delay(1500),
      Animated.timing(recorrido, { toValue: 2, duration: 600, easing: Easing.inOut(Easing.cubic), useNativeDriver: true }),
      pulsa(),
      Animated.delay(900),
      Animated.timing(recorrido, { toValue: 3, duration: 600, easing: Easing.inOut(Easing.cubic), useNativeDriver: true }),
      pulsa(),
    ]);
    a.start();
    return () => a.stop();
  }, [i, recorrido, clic]);

  const anchoV = W - 24;
  const pts = { x: [anchoV * 0.6, anchoV * 0.3, anchoV * 0.82, anchoV * 0.35], y: [H * 0.6, 92, 92, 160] };
  return (
    <Pantallita ancho={W} alto={H} fondo="#101418">
      <Text style={st.nube}>☁️ {t(idioma, 'Su computadora en la nube', 'Her computer in the cloud')}</Text>
      <Animated.View style={[st.ventana, { width: anchoV, opacity: ventana, transform: [{ scale: ventana.interpolate({ inputRange: [0, 1], outputRange: [0.3, 1] }) }, { translateY: ventana.interpolate({ inputRange: [0, 1], outputRange: [-80, 0] }) }] }]}>
        <View style={st.titulo}>
          {[COLOR.rojo, '#FFBD2E', COLOR.verde].map((c) => (
            <View key={c} style={[st.punto, { backgroundColor: c }]} />
          ))}
          <View style={st.direccion}>
            <Text style={st.direccionTexto} numberOfLines={1}>
              🔒 vuelos.ejemplo.com
            </Text>
          </View>
        </View>
        <View style={st.pagina}>
          <View style={st.formulario}>
            <View style={st.campo}>
              <Escribe texto={t(idioma, 'Tegucigalpa → San Pedro Sula', 'Tegucigalpa → San Pedro Sula')} activo={i >= 1} ms={55} style={st.campoTexto} />
            </View>
            <View style={st.boton}>
              <Text style={st.botonTexto}>{t(idioma, 'Buscar', 'Search')}</Text>
            </View>
          </View>
          {[0, 1, 2].map((k) => (
            <Entra key={k} visible={i >= 1} retraso={2900 + k * 250} style={[st.resultado, k === 0 && i >= 2 && st.elegido]}>
              <Text style={st.resultadoHora}>{['6:00', '9:30', '14:15'][k]}</Text>
              <View style={st.linea} />
              <Text style={st.resultadoPrecio}>{['L 1,850', 'L 2,100', 'L 2,400'][k]}</Text>
            </Entra>
          ))}
        </View>
        {/* El cursor, con su clic. */}
        {i >= 1 ? (
          <Animated.View
            pointerEvents="none"
            style={[
              st.cursor,
              {
                transform: [
                  { translateX: recorrido.interpolate({ inputRange: [0, 1, 2, 3], outputRange: pts.x }) },
                  { translateY: recorrido.interpolate({ inputRange: [0, 1, 2, 3], outputRange: pts.y }) },
                ],
              },
            ]}
          >
            <Animated.View style={[st.onda, { opacity: clic, transform: [{ scale: clic.interpolate({ inputRange: [0, 1], outputRange: [0.4, 1.6] }) }] }]} />
            <Text style={st.flecha}>➤</Text>
          </Animated.View>
        ) : null}
      </Animated.View>
      <Entra visible={i >= 2} style={st.aviso}>
        <Text style={st.avisoTitulo}>✓ {t(idioma, 'Listo', 'Done')}</Text>
        <Text style={st.avisoTexto}>{t(idioma, 'Encontré 3 vuelos; el más barato sale a las 6:00. ¿Te mando el enlace?', 'I found 3 flights; the cheapest leaves at 6:00. Want the link?')}</Text>
      </Entra>
    </Pantallita>
  );
}

const st = StyleSheet.create({
  nube: { color: COLOR.texto2, fontSize: 13, fontWeight: '700', textAlign: 'center', marginTop: 22, marginBottom: 8 },
  ventana: { alignSelf: 'center', borderRadius: 14, backgroundColor: '#F4F5F7', overflow: 'hidden' },
  titulo: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, paddingVertical: 8, backgroundColor: '#E2E4E8' },
  punto: { width: 10, height: 10, borderRadius: 5 },
  direccion: { flex: 1, marginLeft: 8, backgroundColor: '#fff', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 },
  direccionTexto: { color: '#555', fontSize: 11 },
  pagina: { padding: 12, gap: 8 },
  formulario: { flexDirection: 'row', gap: 8, marginBottom: 6 },
  campo: { flex: 1, borderWidth: 1, borderColor: '#C9CDD3', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 8, backgroundColor: '#fff' },
  campoTexto: { color: '#222', fontSize: 12.5 },
  boton: { backgroundColor: '#1E6FD9', borderRadius: 8, paddingHorizontal: 12, justifyContent: 'center' },
  botonTexto: { color: '#fff', fontSize: 12.5, fontWeight: '800' },
  resultado: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 10, borderRadius: 10, backgroundColor: '#fff', borderWidth: 1, borderColor: '#E1E4E8' },
  elegido: { borderColor: '#1E6FD9', borderWidth: 2 },
  resultadoHora: { color: '#222', fontSize: 14, fontWeight: '800', width: 48 },
  linea: { flex: 1, height: 2, backgroundColor: '#D5D9DE', borderRadius: 1 },
  resultadoPrecio: { color: '#1E6FD9', fontSize: 14, fontWeight: '800' },
  cursor: { position: 'absolute', left: 0, top: 0 },
  flecha: { fontSize: 22, color: '#111', transform: [{ rotate: '-120deg' }], textShadowColor: '#fff', textShadowRadius: 3 },
  onda: { position: 'absolute', left: -8, top: -6, width: 34, height: 34, borderRadius: 17, backgroundColor: 'rgba(30,111,217,0.35)' },
  aviso: { position: 'absolute', bottom: 12, left: 12, right: 12, padding: 12, borderRadius: 16, backgroundColor: COLOR.panel2, borderWidth: 1, borderColor: 'rgba(61,220,132,0.5)' },
  avisoTitulo: { color: COLOR.verde, fontSize: 14, fontWeight: '800' },
  avisoTexto: { color: COLOR.texto, fontSize: 13.5, lineHeight: 19 },
});
