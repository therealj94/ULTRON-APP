/**
 * Los cuatro avatares: una tarjeta por cada uno; la del que se nombra crece y se ilumina con su color.
 */
import { Animated, Image, StyleSheet, Text, View } from 'react-native';
import { COLOR, Entra, Ojos, t, useAparece, type PropsEscena } from './comun';
import { OrbeMini } from '../../avatar3d/OrbeMini';

const FOTOS = {
  claudio: require('../../../assets/avatares/claudio/base.webp'),
  antonio: require('../../../assets/avatares/antonio/base.webp'),
};

const AVATARES = [
  { id: 'ojos', nombre: { es: 'Guardián', en: 'Guardian' }, oficio: { es: 'Cuida tu espacio', en: 'Watches your space' }, color: COLOR.ojos },
  { id: 'aura', nombre: { es: 'AU-RA', en: 'AU-RA' }, oficio: { es: 'Tu día, oración y canto', en: 'Your day, prayer, song' }, color: COLOR.aura },
  { id: 'claudio', nombre: { es: 'Claudio', en: 'Claudio' }, oficio: { es: 'Ideas y redes', en: 'Ideas and social' }, color: COLOR.claudio },
  { id: 'antonio', nombre: { es: 'ANT-ONIO', en: 'ANT-ONIO' }, oficio: { es: 'Planes y pendientes', en: 'Plans and to-dos' }, color: COLOR.antonio },
] as const;

function Tarjeta({ a, elegida, ancho, idioma, k }: { a: (typeof AVATARES)[number]; elegida: boolean; ancho: number; idioma: 'es' | 'en'; k: number }) {
  const v = useAparece(elegida, { resorte: true });
  const lado = ancho * 0.62;
  return (
    <Entra visible retraso={k * 120} style={{ width: ancho, alignItems: 'center' }}>
      <Animated.View
        style={[
          st.tarjeta,
          {
            width: ancho - 8,
            borderColor: a.color,
            opacity: v.interpolate({ inputRange: [0, 1], outputRange: [0.55, 1] }),
            transform: [{ scale: v.interpolate({ inputRange: [0, 1], outputRange: [0.92, 1.08] }) }, { translateY: v.interpolate({ inputRange: [0, 1], outputRange: [0, -10] }) }],
          },
        ]}
      >
        <View style={[st.cara, { width: lado, height: lado, borderRadius: lado / 2 }]}>
          {a.id === 'claudio' || a.id === 'antonio' ? (
            <Image source={FOTOS[a.id]} style={{ width: lado * 1.25, height: lado * 1.25, marginTop: lado * 0.04 }} resizeMode="contain" />
          ) : a.id === 'aura' ? (
            <OrbeMini lado={lado} />
          ) : (
            <Ojos color={a.color} tam={lado} />
          )}
        </View>
        <Text style={[st.nombre, { color: a.color }]} numberOfLines={1}>
          {a.nombre[idioma]}
        </Text>
        <Text style={st.oficio} numberOfLines={2}>
          {a.oficio[idioma]}
        </Text>
      </Animated.View>
    </Entra>
  );
}

export default function Avatares({ paso, ancho, alto, idioma }: PropsEscena) {
  const dos = ancho < 520;
  const col = dos ? (Math.min(ancho, 440) - 24) / 2 : (Math.min(ancho, 760) - 24) / 4;
  return (
    <View style={{ width: ancho, height: alto, alignItems: 'center', justifyContent: 'center' }}>
      <Text style={st.titulo}>{t(idioma, 'Un solo cerebro, cuatro personalidades', 'One brain, four personalities')}</Text>
      <View style={[st.rejilla, { width: col * (dos ? 2 : 4) }]}>
        {AVATARES.map((a, k) => (
          <Tarjeta key={a.id} a={a} elegida={paso === a.id} ancho={col} idioma={idioma} k={k} />
        ))}
      </View>
    </View>
  );
}

const st = StyleSheet.create({
  titulo: { color: COLOR.texto2, fontSize: 14, fontWeight: '700', marginBottom: 22 },
  rejilla: { flexDirection: 'row', flexWrap: 'wrap', rowGap: 14 },
  tarjeta: { alignItems: 'center', padding: 10, borderRadius: 20, borderWidth: 1.5, backgroundColor: COLOR.panel, gap: 4 },
  cara: { overflow: 'hidden', alignItems: 'center', justifyContent: 'center', backgroundColor: '#17181B' },
  nombre: { fontSize: 16, fontWeight: '900', marginTop: 6 },
  oficio: { color: COLOR.texto2, fontSize: 12, textAlign: 'center' },
});
