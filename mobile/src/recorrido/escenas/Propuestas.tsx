/**
 * Lo que AU-RA propone sola (compa/iniciativa.ts, components/TarjetaPropuesta.tsx): la tarjeta arriba en la
 * mesa con «Sí, hazlo» · «Luego» · «No» (la persona toca «Sí, hazlo») y, al final, dónde se elige cuántas
 * propuestas quiere: Ajustes → Iniciativa de AURA (Alta, Media, Baja, Apagada).
 */
import { Animated, StyleSheet, Text, View } from 'react-native';
import { COLOR, Entra, Pantallita, t, Toca, useAparece, type PropsEscena } from './comun';
import { OrbeMini } from '../../avatar3d/OrbeMini';
import { Camino, Senala } from './guia';

const ORDEN = ['tarjeta', 'responde', 'nivel'];

export default function Propuestas({ paso, esperando, tocado, onToque, ancho, alto, idioma, acento }: PropsEscena) {
  const i = ORDEN.indexOf(paso);
  const entra = useAparece(true, { resorte: true, retraso: 300 });
  const W = Math.min(ancho - 20, 440);
  const H = alto - 12;
  if (i >= 2) {
    return (
      <Pantallita ancho={W} alto={H}>
        <View style={st.ajustes}>
          <Camino pasos={[t(idioma, 'Ajustes', 'Settings'), t(idioma, 'Iniciativa de AURA', 'AURA’s initiative')]} color={acento} />
          <Senala activo color={acento} mano={false}>
            <View style={st.segmento}>
              {[t(idioma, 'Alta', 'High'), t(idioma, 'Media', 'Medium'), t(idioma, 'Baja', 'Low'), t(idioma, 'Apagada', 'Off')].map((n, k) => (
                <View key={n} style={[st.seg, k === 1 && { backgroundColor: COLOR.aura }]}>
                  <Text style={[st.segTexto, k === 1 && { color: '#141414' }]}>{n}</Text>
                </View>
              ))}
            </View>
          </Senala>
          <Entra visible retraso={500}>
            <Text style={st.pie}>
              {t(idioma, 'Alta: cada 2 h (hasta 6 al día) · Media: cada 4 h (hasta 3) · Baja: 1 al día · Apagada: nada. Nunca de noche.', 'High: every 2 h (up to 6 a day) · Medium: every 4 h (up to 3) · Low: 1 a day · Off: none. Never at night.')}
            </Text>
          </Entra>
        </View>
      </Pantallita>
    );
  }
  const hecho = i === 1 && tocado;
  return (
    <Pantallita ancho={W} alto={H} fondo="#1C1D20">
      <Animated.View style={[st.tarjeta, { borderColor: acento, opacity: entra, transform: [{ translateY: entra.interpolate({ inputRange: [0, 1], outputRange: [-30, 0] }) }] }]}>
        <Text style={[st.de, { color: acento }]}>{t(idioma, '✦ AU-RA · PARA TU MISIÓN', '✦ AU-RA · FOR YOUR MISSION')}</Text>
        <Text style={st.texto}>{t(idioma, '¿Cómo vas con «Vender el carro»? Si quieres, te busco cuánto piden por uno igual.', 'How’s “Sell the car” going? If you want, I’ll check what similar ones go for.')}</Text>
        {hecho ? (
          <Entra visible>
            <Text style={st.hecho}>{t(idioma, '✓ ¡Va! Lo busco y te aviso.', '✓ On it! I’ll look and let you know.')}</Text>
          </Entra>
        ) : (
          <View style={st.botones}>
            <Toca activo={i === 1 && esperando} color={COLOR.verde} tam={46} onPress={onToque} etiqueta={t(idioma, 'Sí, hazlo', 'Yes, do it')}>
              <View style={[st.boton, { backgroundColor: acento }]}>
                <Text style={[st.botonTexto, { color: '#141414' }]}>{t(idioma, 'Sí, hazlo', 'Yes, do it')}</Text>
              </View>
            </Toca>
            <View style={[st.boton, st.secundario]}>
              <Text style={st.botonTexto}>{t(idioma, 'Luego', 'Later')}</Text>
            </View>
            <Text style={st.no}>No</Text>
          </View>
        )}
      </Animated.View>
      <View style={st.centro}>
        <OrbeMini lado={70} />
      </View>
    </Pantallita>
  );
}

const st = StyleSheet.create({
  tarjeta: { margin: 12, marginTop: 26, padding: 12, borderRadius: 18, borderWidth: 1.5, backgroundColor: 'rgba(28,30,34,0.97)', gap: 8 },
  de: { fontSize: 11, fontWeight: '800', letterSpacing: 1 },
  texto: { color: COLOR.texto, fontSize: 14.5, lineHeight: 20 },
  botones: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  boton: { paddingHorizontal: 14, paddingVertical: 9, borderRadius: 999 },
  secundario: { borderWidth: 1, borderColor: COLOR.borde },
  botonTexto: { color: COLOR.texto, fontSize: 13.5, fontWeight: '800' },
  no: { color: COLOR.texto3, fontSize: 13.5, fontWeight: '700', paddingHorizontal: 6 },
  hecho: { color: COLOR.verde, fontSize: 14, fontWeight: '800' },
  centro: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  ajustes: { flex: 1, paddingTop: 26, paddingHorizontal: 12, gap: 14 },
  segmento: { flexDirection: 'row', borderRadius: 999, backgroundColor: COLOR.panel2, padding: 3 },
  seg: { flex: 1, alignItems: 'center', paddingVertical: 9, borderRadius: 999 },
  segTexto: { color: COLOR.texto2, fontSize: 12.5, fontWeight: '800' },
  pie: { color: COLOR.texto2, fontSize: 12.5, lineHeight: 18 },
});
