/**
 * WhatsApp en los chats (whatsapp/ChatsConWhatsapp.tsx y PantallaWhatsapp.tsx): las pestañas PULSE2CHAT ·
 * WhatsApp · Correos arriba (la persona toca la de WhatsApp), cómo se vincula «Con un código» (su número,
 * y en su WhatsApp: ⋮ → Dispositivos vinculados → Vincular con el número de teléfono) y la lista lista.
 */
import { StyleSheet, Text, View } from 'react-native';
import { COLOR, Entra, Pantallita, t, Toca, type PropsEscena } from './comun';
import { Senala } from './guia';

const ORDEN = ['pestanas', 'vincular', 'codigo', 'listo'];
const VERDE = '#25D366';

export default function Whatsapp({ paso, esperando, onToque, ancho, alto, idioma, acento }: PropsEscena) {
  const i = ORDEN.indexOf(paso);
  const W = Math.min(ancho - 20, 440);
  const H = alto - 12;
  const pestana = (txt: string, activa: boolean) => (
    <View style={[st.pestana, activa && { borderBottomColor: VERDE }]}>
      <Text style={[st.pestanaTexto, activa && { color: COLOR.texto }]}>{txt}</Text>
    </View>
  );
  return (
    <Pantallita ancho={W} alto={H}>
      <View style={st.pestanas}>
        {pestana('PULSE2CHAT', i === 0)}
        {i === 0 ? (
          <Toca activo={esperando} color={VERDE} tam={46} onPress={onToque} etiqueta="WhatsApp" style={{ flex: 1 }}>
            {pestana('WhatsApp', false)}
          </Toca>
        ) : (
          pestana('WhatsApp', true)
        )}
        {pestana(t(idioma, 'Correos', 'Email'), false)}
      </View>
      {i === 0 ? (
        <View style={st.cuerpo}>
          {['Mamá', 'Beto Paz', 'Ana López'].map((n, k) => (
            <View key={n} style={st.chat}>
              <View style={[st.avatar, { backgroundColor: ['#5B3A6E', '#2E4A3A', '#6E4A2E'][k] }]}>
                <Text style={st.inicial}>{n[0]}</Text>
              </View>
              <Text style={st.nombre}>{n}</Text>
            </View>
          ))}
          <Text style={st.desliza}>{t(idioma, '← desliza de lado para cambiar →', '← swipe sideways to switch →')}</Text>
        </View>
      ) : null}
      {i === 1 ? (
        <Entra visible style={st.cuerpo}>
          <Text style={st.titulo}>{t(idioma, 'Vincula tu WhatsApp', 'Link your WhatsApp')}</Text>
          <View style={st.segmento}>
            <View style={[st.seg, { backgroundColor: VERDE }]}>
              <Text style={[st.segTexto, { color: '#062312' }]}>{t(idioma, 'Con un código', 'With a code')}</Text>
            </View>
            <View style={st.seg}>
              <Text style={st.segTexto}>{t(idioma, 'Con QR', 'With QR')}</Text>
            </View>
          </View>
          <View style={st.campo}>
            <Text style={st.campoTexto}>504 9999 9999</Text>
          </View>
          <Senala activo color={acento}>
            <View style={[st.boton, { backgroundColor: VERDE }]}>
              <Text style={st.botonTexto}>{t(idioma, 'Pedir el código', 'Get the code')}</Text>
            </View>
          </Senala>
        </Entra>
      ) : null}
      {i === 2 ? (
        <Entra visible style={st.cuerpo}>
          <Text style={st.sub}>{t(idioma, 'Escribe este código en WhatsApp:', 'Type this code in WhatsApp:')}</Text>
          <Text style={st.codigo}>K7Q2-9XPA</Text>
          {[
            t(idioma, '⋮ (Más opciones)', '⋮ (More options)'),
            t(idioma, 'Dispositivos vinculados', 'Linked devices'),
            t(idioma, 'Vincular un dispositivo', 'Link a device'),
            t(idioma, 'Vincular con el número de teléfono', 'Link with phone number instead'),
          ].map((p, k) => (
            <Entra key={p} visible retraso={350 * k}>
              <Text style={st.pasoTexto}>
                {k + 1}. {p}
              </Text>
            </Entra>
          ))}
        </Entra>
      ) : null}
      {i === 3 ? (
        <Entra visible style={st.cuerpo}>
          <Text style={[st.sub, { color: VERDE }]}>{t(idioma, '✓ Vinculado · +504 9999 9999', '✓ Linked · +504 9999 9999')}</Text>
          {[
            ['Mamá', t(idioma, '¿Vienes a cenar?', 'Coming to dinner?'), '2'],
            [t(idioma, 'Trabajo', 'Work'), t(idioma, 'Reunión mañana 9:00', 'Meeting tomorrow 9:00'), ''],
            ['Beto', t(idioma, 'Te mandé la dirección', 'Sent you the address'), '1'],
          ].map(([n, m, c]) => (
            <View key={n} style={st.chat}>
              <View style={[st.avatar, { backgroundColor: '#1F3B2C' }]}>
                <Text style={st.inicial}>{n[0]}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={st.nombre}>{n}</Text>
                <Text style={st.msg} numberOfLines={1}>
                  {m}
                </Text>
              </View>
              {c ? (
                <View style={st.contador}>
                  <Text style={st.contadorTexto}>{c}</Text>
                </View>
              ) : null}
            </View>
          ))}
        </Entra>
      ) : null}
    </Pantallita>
  );
}

const st = StyleSheet.create({
  pestanas: { flexDirection: 'row', paddingTop: 22, borderBottomWidth: 1, borderBottomColor: COLOR.borde },
  pestana: { flex: 1, alignItems: 'center', paddingVertical: 10, borderBottomWidth: 3, borderBottomColor: 'transparent' },
  pestanaTexto: { color: COLOR.texto3, fontSize: 12.5, fontWeight: '800' },
  cuerpo: { flex: 1, padding: 14, gap: 10 },
  chat: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  avatar: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  inicial: { color: COLOR.texto, fontSize: 15, fontWeight: '800' },
  nombre: { color: COLOR.texto, fontSize: 15, fontWeight: '700' },
  msg: { color: COLOR.texto3, fontSize: 12.5 },
  desliza: { color: COLOR.texto3, fontSize: 12, textAlign: 'center', marginTop: 'auto' },
  titulo: { color: COLOR.texto, fontSize: 18, fontWeight: '800' },
  segmento: { flexDirection: 'row', borderRadius: 999, backgroundColor: COLOR.panel2, padding: 3 },
  seg: { flex: 1, alignItems: 'center', paddingVertical: 8, borderRadius: 999 },
  segTexto: { color: COLOR.texto2, fontSize: 13, fontWeight: '800' },
  campo: { borderWidth: 1, borderColor: COLOR.borde, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10 },
  campoTexto: { color: COLOR.texto, fontSize: 16, letterSpacing: 1 },
  boton: { alignItems: 'center', paddingVertical: 12, borderRadius: 14 },
  botonTexto: { color: '#062312', fontSize: 15, fontWeight: '800' },
  sub: { color: COLOR.texto2, fontSize: 13, fontWeight: '700' },
  codigo: { color: COLOR.texto, fontSize: 30, fontWeight: '800', letterSpacing: 4, textAlign: 'center', paddingVertical: 6 },
  pasoTexto: { color: COLOR.texto, fontSize: 14, lineHeight: 20 },
  contador: { minWidth: 20, height: 20, borderRadius: 10, backgroundColor: VERDE, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 5 },
  contadorTexto: { color: '#062312', fontSize: 11, fontWeight: '900' },
});
