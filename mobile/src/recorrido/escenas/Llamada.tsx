/**
 * La llamada: entra la llamada de Claudio con su foto, los anillos y el teléfono que vibra; la persona
 * contesta (o contesta sola), corre el reloj de la llamada con la voz sonando y, al final, cuelga.
 */
import { useEffect, useState } from 'react';
import { Animated, Image, StyleSheet, Text, View } from 'react-native';
import { COLOR, Icono, Ondas, Pantallita, t, Toca, useCiclo, useVaiven, type PropsEscena } from './comun';

const FOTO_CLAUDIO = require('../../../assets/avatares/claudio/base.webp');

const ORDEN = ['suena', 'encurso', 'cuelga'];

function useReloj(corre: boolean) {
  const [s, setS] = useState(0);
  useEffect(() => {
    if (!corre) return;
    const id = setInterval(() => setS((k) => k + 1), 1000);
    return () => clearInterval(id);
  }, [corre]);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export default function Llamada({ paso, esperando, onToque, ancho, alto, idioma }: PropsEscena) {
  const i = ORDEN.indexOf(paso);
  const suena = i === 0;
  const anillos = useCiclo(1600, suena);
  const vibra = useVaiven(140, suena);
  const reloj = useReloj(i === 1);
  const W = Math.min(ancho - 20, 440);
  const H = alto - 12;
  const foto = Math.min(110, H * 0.3);
  return (
    <Animated.View style={{ transform: [{ translateX: vibra.interpolate({ inputRange: [0, 1], outputRange: [-2, 2] }) }] }}>
      <Pantallita ancho={W} alto={H} fondo={i === 2 ? '#1A1A1C' : '#2A1D14'}>
        <View style={st.arriba}>
          <Text style={st.estado}>
            {i === 0 ? t(idioma, 'Llamada entrante…', 'Incoming call…') : i === 1 ? t(idioma, 'En llamada', 'On call') : t(idioma, 'Llamada terminada', 'Call ended')}
          </Text>
          <View style={{ alignItems: 'center', justifyContent: 'center', marginTop: 14 }}>
            {suena
              ? [0, 0.5].map((d) => (
                  <Animated.View
                    key={d}
                    style={[
                      st.anillo,
                      {
                        width: foto,
                        height: foto,
                        borderRadius: foto / 2,
                        opacity: anillos.interpolate({ inputRange: [0, 1], outputRange: d ? [0.4, 0] : [0.8, 0] }),
                        transform: [{ scale: anillos.interpolate({ inputRange: [0, 1], outputRange: d ? [1.25, 2.1] : [1, 1.7] }) }],
                      },
                    ]}
                  />
                ))
              : null}
            <View style={[st.foto, { width: foto, height: foto, borderRadius: foto / 2 }]}>
              <Image source={FOTO_CLAUDIO} style={{ width: foto * 1.25, height: foto * 1.25, marginTop: foto * 0.02 }} resizeMode="contain" />
            </View>
          </View>
          <Text style={st.nombre}>Claudio · AU-RA</Text>
          <Text style={st.sub}>{i === 1 ? reloj : i === 2 ? '0:12' : t(idioma, 'te está llamando', 'is calling you')}</Text>
          {i === 1 ? (
            <View style={{ marginTop: 12 }}>
              <Ondas activo color={COLOR.claudio} barras={11} alto={30} />
            </View>
          ) : null}
        </View>
        <View style={st.botones}>
          {i === 0 ? (
            <>
              <View style={{ alignItems: 'center', gap: 6 }}>
                <View style={[st.boton, { backgroundColor: COLOR.rojo }]}>
                  <View style={{ transform: [{ rotate: '135deg' }] }}>
                    <Icono nombre="llamada" tam={28} color="#fff" />
                  </View>
                </View>
                <Text style={st.etiqueta}>{t(idioma, 'Rechazar', 'Decline')}</Text>
              </View>
              <View style={{ alignItems: 'center', gap: 6 }}>
                <Toca activo={esperando} color={COLOR.verde} tam={64} onPress={onToque} etiqueta={t(idioma, 'Contestar', 'Answer')}>
                  <View style={[st.boton, { backgroundColor: COLOR.verde }]}>
                    <Icono nombre="llamada" tam={28} color="#fff" />
                  </View>
                </Toca>
                <Text style={st.etiqueta}>{t(idioma, 'Contestar', 'Answer')}</Text>
              </View>
            </>
          ) : i === 1 ? (
            <>
              <View style={[st.chico]}>
                <Icono nombre="microfono" tam={22} color={COLOR.texto} />
              </View>
              <View style={[st.boton, { backgroundColor: COLOR.rojo }]}>
                <View style={{ transform: [{ rotate: '135deg' }] }}>
                  <Icono nombre="llamada" tam={28} color="#fff" />
                </View>
              </View>
              <View style={[st.chico]}>
                <Icono nombre="volumen" tam={22} color={COLOR.texto} />
              </View>
            </>
          ) : (
            <Text style={st.etiqueta}>{t(idioma, 'Hasta luego 👋', 'Bye for now 👋')}</Text>
          )}
        </View>
      </Pantallita>
    </Animated.View>
  );
}

const st = StyleSheet.create({
  arriba: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingTop: 18 },
  estado: { color: COLOR.texto2, fontSize: 14, fontWeight: '700', letterSpacing: 0.5 },
  anillo: { position: 'absolute', borderWidth: 3, borderColor: COLOR.claudio },
  foto: { backgroundColor: '#3A2A1D', overflow: 'hidden', alignItems: 'center', borderWidth: 3, borderColor: COLOR.claudio },
  nombre: { color: COLOR.texto, fontSize: 22, fontWeight: '800', marginTop: 14 },
  sub: { color: COLOR.texto2, fontSize: 15, marginTop: 2, fontVariant: ['tabular-nums'] },
  botones: { flexDirection: 'row', justifyContent: 'space-evenly', alignItems: 'center', paddingBottom: 22, paddingTop: 8 },
  boton: { width: 62, height: 62, borderRadius: 31, alignItems: 'center', justifyContent: 'center' },
  chico: { width: 48, height: 48, borderRadius: 24, backgroundColor: 'rgba(255,255,255,0.12)', alignItems: 'center', justifyContent: 'center' },
  etiqueta: { color: COLOR.texto2, fontSize: 13, fontWeight: '700' },
});
