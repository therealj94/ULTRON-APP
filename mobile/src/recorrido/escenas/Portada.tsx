/**
 * Bienvenida: el nombre de AU-RA se enciende y alrededor empiezan a girar todas las cosas que sabe
 * hacer (las que el recorrido va a enseñar).
 */
import { Animated, StyleSheet, Text, View } from 'react-native';
import type { NombreIcono } from '../../ui/iconos';
import { COLOR, Icono, t, useAparece, useCiclo, useVaiven, type PropsEscena } from './comun';

const ORBITA: { icono: NombreIcono; color: string }[] = [
  { icono: 'microfono', color: COLOR.aura },
  { icono: 'camara', color: COLOR.ojos },
  { icono: 'llamada', color: COLOR.verde },
  { icono: 'reloj', color: COLOR.claudio },
  { icono: 'chat', color: COLOR.azul },
  { icono: 'correo', color: COLOR.antonio },
  { icono: 'globo', color: '#B48CFF' },
  { icono: 'corazon', color: COLOR.rojo },
];

export default function Portada({ paso, ancho, alto, idioma }: PropsEscena) {
  const titulo = useAparece(true, { resorte: true });
  const anillo = useAparece(paso !== 'entra', { ms: 700 });
  const gira = useCiclo(16000, true);
  const brillo = useVaiven(2600);
  const R = Math.min(ancho, alto) * 0.36;
  const todos = paso === 'iconos';
  return (
    <View style={[st.raiz, { width: ancho, height: alto }]}>
      <Animated.View style={[st.halo, { width: R * 2.2, height: R * 2.2, borderRadius: R * 1.1, opacity: brillo.interpolate({ inputRange: [0, 1], outputRange: [0.35, 0.7] }), transform: [{ scale: brillo.interpolate({ inputRange: [0, 1], outputRange: [0.94, 1.06] }) }] }]} />
      <Animated.View style={[StyleSheet.absoluteFill, st.centro, { opacity: anillo, transform: [{ rotate: gira.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] }) }] }]}>
        {ORBITA.map((o, i) => {
          const a = (i / ORBITA.length) * Math.PI * 2;
          return (
            <Animated.View
              key={o.icono}
              style={[
                st.icono,
                {
                  borderColor: o.color,
                  transform: [
                    { translateX: Math.cos(a) * R },
                    { translateY: Math.sin(a) * R },
                    // Cada ícono gira al revés que el anillo: siempre se ve derecho.
                    { rotate: gira.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '-360deg'] }) },
                    { scale: todos ? brillo.interpolate({ inputRange: [0, 1], outputRange: [1, i % 2 ? 1.15 : 0.95] }) : 1 },
                  ],
                },
              ]}
            >
              <Icono nombre={o.icono} tam={22} color={o.color} />
            </Animated.View>
          );
        })}
      </Animated.View>
      <Animated.View style={[st.centro, { opacity: titulo, transform: [{ scale: titulo.interpolate({ inputRange: [0, 1], outputRange: [0.6, 1] }) }] }]}>
        <Text style={st.marca}>AU-RA</Text>
        <Text style={st.lema}>{t(idioma, 'Tu compañera que ve, oye, habla y hace', 'Your companion that sees, hears, talks and does')}</Text>
      </Animated.View>
    </View>
  );
}

const st = StyleSheet.create({
  raiz: { alignItems: 'center', justifyContent: 'center' },
  centro: { alignItems: 'center', justifyContent: 'center' },
  halo: { position: 'absolute', backgroundColor: 'rgba(214,181,108,0.16)' },
  icono: { position: 'absolute', width: 46, height: 46, borderRadius: 23, borderWidth: 1.5, backgroundColor: COLOR.panel, alignItems: 'center', justifyContent: 'center' },
  marca: { color: COLOR.aura, fontSize: 52, fontWeight: '900', letterSpacing: 4, textShadowColor: 'rgba(214,181,108,0.6)', textShadowRadius: 18 },
  lema: { color: COLOR.texto2, fontSize: 14, marginTop: 6, textAlign: 'center', maxWidth: 220 },
});
