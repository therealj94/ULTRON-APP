/**
 * El recordatorio: la persona lo pide, el avatar repite la hora y queda guardado; luego se va a los
 * chats y CLAUDIO MISMO se hace chiquito y vuela a la franja de arriba (así es AuraAlLado,
 * avatar3d/DockAura.tsx): la escena deja su lugar en la franja y lo marca (`marcarLugar`); el vuelo lo
 * hace el recorrido con su video. Una flecha dice «aquí me quedo» y a las 5 baja el aviso de su llamada.
 */
import { useEffect, useRef } from 'react';
import { Animated, StyleSheet, Text, View } from 'react-native';
import { Image } from 'react-native';
import { Burbuja, COLOR, Entra, Escribe, Icono, Pantallita, t, useAparece, useVaiven, type PropsEscena } from './comun';

const FOTO_CLAUDIO = require('../../../assets/avatares/claudio/base.webp');

const ORDEN = ['pide', 'confirma', 'achica', 'suena'];
const CHATS = [
  { nombre: 'Mamá', ultimo: { es: '¿Vienes a comer el domingo?', en: 'Coming for lunch Sunday?' }, hora: '4:41' },
  { nombre: 'Beto', ultimo: { es: 'Listo, nos vemos a las tres', en: 'Great, see you at three' }, hora: '4:12' },
  { nombre: 'Equipo', ultimo: { es: 'Ana: subí el informe', en: 'Ana: uploaded the report' }, hora: '3:55' },
  { nombre: 'Carla', ultimo: { es: '😂😂', en: '😂😂' }, hora: '2:30' },
];

export default function Recordatorio({ paso, ancho, alto, idioma, marcarLugar }: PropsEscena) {
  const i = ORDEN.indexOf(paso);
  const enChats = useAparece(i >= 2, { ms: 420 });
  const flecha = useVaiven(900, i === 2);
  const aviso = useAparece(i >= 3, { resorte: true });
  const W = Math.min(ancho - 20, 440);
  const H = alto - 12;
  const chica = 40;
  // El lugar de Claudio en la franja: se mide en la pantalla y se lo dice al recorrido, que lo hace volar.
  const lugar = useRef<View>(null);
  const medir = () => lugar.current?.measureInWindow((x, y, w, h) => w > 0 && marcarLugar?.('franja', { x, y, w, h }));
  useEffect(() => {
    // Al pasar a los chats, cuando el golpe de cámara de ese paso ya se asentó: ahí está la franja.
    if (i !== 2) return;
    const id = setTimeout(medir, 480);
    return () => clearTimeout(id);
  }, [i]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <Pantallita ancho={W} alto={H}>
      {/* El chat donde lo pide. */}
      <Animated.View style={[StyleSheet.absoluteFill, st.chat, { opacity: enChats.interpolate({ inputRange: [0, 1], outputRange: [1, 0] }) }]}>
        <Entra visible={i >= 0}>
          <Burbuja de="yo">
            <Escribe texto={t(idioma, 'Recuérdame a las 5 tomar la pastilla', 'Remind me at 5 to take my pill')} activo={i === 0} style={st.yo} />
          </Burbuja>
        </Entra>
        <Entra visible={i >= 1}>
          <Burbuja de="aura">
            <Text style={st.de}>AU-RA</Text>
            <Text style={st.texto}>{t(idioma, '¿Te lo recuerdo hoy a las 5:00 p. m.?', 'Shall I remind you today at 5:00 p.m.?')}</Text>
          </Burbuja>
        </Entra>
        <Entra visible={i >= 1} retraso={700}>
          <Burbuja de="yo">{t(idioma, 'Sí', 'Yes')}</Burbuja>
        </Entra>
        <Entra visible={i >= 1} retraso={1200}>
          <View style={st.tarjeta}>
            <View style={st.reloj}>
              <Icono nombre="reloj" tam={26} color={COLOR.aura} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={st.hora}>5:00 p. m.</Text>
              <Text style={st.que}>{t(idioma, 'Tomar la pastilla', 'Take the pill')}</Text>
            </View>
            <View style={st.listo}>
              <Icono nombre="check" tam={18} color="#111" />
            </View>
          </View>
        </Entra>
      </Animated.View>

      {/* Los chats, con AU-RA chiquita en la franja de arriba. */}
      <Animated.View style={[StyleSheet.absoluteFill, { opacity: enChats }]}>
        <View style={st.franja}>
          {/* Aquí aterriza Claudio (el recorrido lo trae volando con su video). */}
          <View ref={lugar} collapsable={false} onLayout={medir} style={[st.lugar, { width: chica, height: chica, borderRadius: chica / 2 }]} />
          <View style={{ flex: 1 }}>
            <Text style={st.franjaNombre}>Claudio</Text>
            <Text style={st.franjaTexto} numberOfLines={1}>
              {t(idioma, 'Te recuerdo la pastilla a las 5:00', 'I’ll remind you about the pill at 5:00')}
            </Text>
          </View>
          <Icono nombre="microfono" tam={18} color={COLOR.claudio} />
        </View>
        {i === 2 ? (
          <Animated.View style={[st.flecha, { transform: [{ translateY: flecha.interpolate({ inputRange: [0, 1], outputRange: [0, -5] }) }] }]}>
            <Text style={st.flechaTexto}>⬆ {t(idioma, 'Aquí me quedo, chiquito', 'I stay right here, tiny')}</Text>
          </Animated.View>
        ) : null}
        <View style={st.lista}>
          {CHATS.map((c) => (
            <View key={c.nombre} style={st.fila}>
              <View style={st.avatar}>
                <Text style={st.inicial}>{c.nombre[0]}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={st.nombre}>{c.nombre}</Text>
                <Text style={st.ultimo} numberOfLines={1}>
                  {c.ultimo[idioma]}
                </Text>
              </View>
              <Text style={st.horaChat}>{c.hora}</Text>
            </View>
          ))}
        </View>
      </Animated.View>

      {/* A las 5: baja el aviso de la llamada. */}
      <Animated.View style={[st.aviso, { opacity: aviso, transform: [{ translateY: aviso.interpolate({ inputRange: [0, 1], outputRange: [-120, 0] }) }] }]}>
        <View style={st.avisoArriba}>
          <View style={st.avisoFoto}>
            <Image source={FOTO_CLAUDIO} style={{ width: 46, height: 46, marginTop: 2 }} resizeMode="contain" />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={st.avisoTitulo}>{t(idioma, 'Claudio te está llamando', 'Claudio is calling you')}</Text>
            <Text style={st.avisoTexto}>{t(idioma, '5:00 p. m. · Tu pastilla', '5:00 p.m. · Your pill')}</Text>
          </View>
        </View>
        <View style={st.avisoBotones}>
          <View style={[st.avisoBoton, { backgroundColor: COLOR.rojo }]}>
            <Text style={st.avisoBotonTexto}>{t(idioma, 'Rechazar', 'Decline')}</Text>
          </View>
          <View style={[st.avisoBoton, { backgroundColor: COLOR.verde }]}>
            <Text style={st.avisoBotonTexto}>{t(idioma, 'Contestar', 'Answer')}</Text>
          </View>
        </View>
      </Animated.View>
    </Pantallita>
  );
}

const st = StyleSheet.create({
  chat: { paddingHorizontal: 14, paddingTop: 26, gap: 10 },
  yo: { color: '#141414', fontSize: 15, fontWeight: '600' },
  de: { color: COLOR.aura, fontSize: 11, fontWeight: '800', letterSpacing: 1, marginBottom: 2 },
  texto: { color: COLOR.texto, fontSize: 14.5, lineHeight: 20 },
  tarjeta: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: 18, backgroundColor: COLOR.panel2, borderWidth: 1, borderColor: 'rgba(214,181,108,0.5)' },
  reloj: { width: 46, height: 46, borderRadius: 23, backgroundColor: 'rgba(214,181,108,0.15)', alignItems: 'center', justifyContent: 'center' },
  hora: { color: COLOR.texto, fontSize: 20, fontWeight: '800' },
  que: { color: COLOR.texto2, fontSize: 14 },
  listo: { width: 30, height: 30, borderRadius: 15, backgroundColor: COLOR.verde, alignItems: 'center', justifyContent: 'center' },
  franja: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 22, marginHorizontal: 10, padding: 8, borderRadius: 16, backgroundColor: 'rgba(255,154,77,0.12)', borderWidth: 1, borderColor: 'rgba(255,154,77,0.45)' },
  franjaNombre: { color: COLOR.claudio, fontSize: 12, fontWeight: '800' },
  franjaTexto: { color: COLOR.texto, fontSize: 13 },
  lista: { paddingHorizontal: 12, paddingTop: 10, gap: 4 },
  fila: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 8 },
  avatar: { width: 42, height: 42, borderRadius: 21, backgroundColor: '#2E3A4A', alignItems: 'center', justifyContent: 'center' },
  inicial: { color: COLOR.texto, fontSize: 17, fontWeight: '800' },
  nombre: { color: COLOR.texto, fontSize: 15, fontWeight: '700' },
  ultimo: { color: COLOR.texto3, fontSize: 13 },
  horaChat: { color: COLOR.texto3, fontSize: 12 },
  flecha: { alignSelf: 'flex-start', marginTop: 8, marginLeft: 14, backgroundColor: COLOR.claudio, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999 },
  flechaTexto: { color: '#1A1007', fontSize: 13, fontWeight: '800' },
  lugar: { borderWidth: 2, borderStyle: 'dashed', borderColor: 'rgba(255,154,77,0.6)' },
  avisoFoto: { width: 38, height: 38, borderRadius: 19, overflow: 'hidden', backgroundColor: '#3A2A1D', alignItems: 'center', borderWidth: 2, borderColor: COLOR.claudio },
  aviso: { position: 'absolute', top: 76, left: 10, right: 10, borderRadius: 20, backgroundColor: '#2A2C31', padding: 12, gap: 10, borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)', shadowColor: '#000', shadowOpacity: 0.5, shadowRadius: 14, elevation: 10 },
  avisoArriba: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  avisoTitulo: { color: COLOR.texto, fontSize: 15, fontWeight: '800' },
  avisoTexto: { color: COLOR.texto2, fontSize: 13 },
  avisoBotones: { flexDirection: 'row', gap: 10 },
  avisoBoton: { flex: 1, borderRadius: 12, paddingVertical: 9, alignItems: 'center' },
  avisoBotonTexto: { color: '#fff', fontSize: 14, fontWeight: '800' },
});
