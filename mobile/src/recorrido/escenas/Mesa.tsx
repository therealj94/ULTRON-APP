/**
 * La mesa y dónde tocar: el avatar al centro y abajo los tres botones (Chat · Hablar · Más), cada uno
 * señalado cuando lo nombran. En «Más» la persona toca de verdad y sube la hoja con todo lo demás (lo
 * mismo que components/HojaMas.tsx).
 */
import { Animated, StyleSheet, Text, View } from 'react-native';
import { COLOR, Icono, Ojos, Ondas, Pantallita, t, Toca, useAparece, type PropsEscena } from './comun';
import { BotonBarra, Senala } from './guia';
import type { NombreIcono } from '../../ui/iconos';

const ORDEN = ['barra', 'hablar', 'chat', 'mas', 'hoja'];

const MOSAICOS: { icono: NombreIcono; es: string; en: string }[] = [
  { icono: 'llamada', es: 'Que te llame', en: 'Call me' },
  { icono: 'lapiz', es: 'Escribir', en: 'Type' },
  { icono: 'camara', es: 'Cámara', en: 'Camera' },
  { icono: 'cara', es: 'Caras', en: 'Faces' },
  { icono: 'estrella', es: 'Misiones', en: 'Missions' },
  { icono: 'enlace', es: 'Su computadora', en: 'Computer' },
  { icono: 'ayuda', es: 'Qué puedo hacer', en: 'What I can do' },
  { icono: 'ajustes', es: 'Ajustes', en: 'Settings' },
];

export default function Mesa({ paso, esperando, onToque, ancho, alto, idioma, acento }: PropsEscena) {
  const i = ORDEN.indexOf(paso);
  const hoja = useAparece(i >= 4, { resorte: true });
  const W = Math.min(ancho - 20, 440);
  const H = alto - 12;
  return (
    <Pantallita ancho={W} alto={H} fondo="#1C1D20">
      <View style={st.arriba}>
        <Text style={st.etiqueta}>{t(idioma, 'LA MESA', 'THE DESK')}</Text>
      </View>
      <View style={st.centro}>
        <Ojos color={COLOR.aura} tam={84} />
        {i === 1 ? (
          <View style={{ marginTop: 12 }}>
            <Ondas activo color={COLOR.aura} />
          </View>
        ) : null}
      </View>
      <View style={st.barra}>
        <Senala activo={i === 0 || i === 2} color={acento} mano={i === 2} style={{ flex: 1 }}>
          <BotonBarra icono="chat" texto="Chat" color={acento} />
        </Senala>
        <Senala activo={i === 0 || i === 1} color={acento} mano={i === 1} style={{ flex: 1 }} radio={30}>
          <BotonBarra icono="microfono" texto={t(idioma, 'Hablar', 'Talk')} grande color={COLOR.aura} />
        </Senala>
        <View style={{ flex: 1, alignItems: 'center' }}>
          {i === 3 ? (
            <Toca activo={esperando} color={acento} tam={54} onPress={onToque} etiqueta={t(idioma, 'Más', 'More')}>
              <BotonBarra icono="mas" texto={t(idioma, 'Más', 'More')} color={acento} />
            </Toca>
          ) : (
            <Senala activo={i === 0} color={acento} mano={false} style={{ width: '100%' }}>
              <BotonBarra icono="mas" texto={t(idioma, 'Más', 'More')} color={acento} />
            </Senala>
          )}
        </View>
      </View>
      {/* La hoja «Más»: sube desde abajo con todo lo demás. */}
      {i >= 4 ? (
        <Animated.View style={[st.hoja, { opacity: hoja, transform: [{ translateY: hoja.interpolate({ inputRange: [0, 1], outputRange: [H * 0.5, 0] }) }] }]}>
          <View style={st.asa} />
          <Text style={st.hojaTitulo}>{t(idioma, 'Más', 'More')}</Text>
          <View style={st.rejilla}>
            {MOSAICOS.map((m) => (
              <View key={m.es} style={st.mosaico}>
                <Icono nombre={m.icono} tam={18} color={COLOR.texto} />
                <Text style={st.mosaicoTexto} numberOfLines={1}>
                  {t(idioma, m.es, m.en)}
                </Text>
              </View>
            ))}
          </View>
        </Animated.View>
      ) : null}
    </Pantallita>
  );
}

const st = StyleSheet.create({
  arriba: { paddingTop: 22, alignItems: 'center' },
  etiqueta: { color: COLOR.texto3, fontSize: 11, fontWeight: '800', letterSpacing: 1.4 },
  centro: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  barra: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingBottom: 14, paddingTop: 6, gap: 6, borderTopWidth: 1, borderTopColor: COLOR.borde },
  hoja: { position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: COLOR.panel, borderTopLeftRadius: 22, borderTopRightRadius: 22, borderWidth: 1, borderColor: COLOR.borde, padding: 12, gap: 8 },
  asa: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.2)' },
  hojaTitulo: { color: COLOR.texto, fontSize: 16, fontWeight: '800' },
  rejilla: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  mosaico: { width: '48.5%', flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 10, paddingVertical: 9, borderRadius: 12, backgroundColor: COLOR.panel2 },
  mosaicoTexto: { color: COLOR.texto, fontSize: 12.5, fontWeight: '700', flexShrink: 1 },
});
