/**
 * Los avisos con la app cerrada (push/nativo.ts, Firebase Cloud Messaging): la pantalla bloqueada recibe
 * el aviso de AU-RA, se contesta desde ahí («Sí» / «Luego») y, al final, dónde se da el permiso de Avisos
 * (Ajustes → Privacidad → Permisos del teléfono) y el de «Alarmas y recordatorios».
 */
import { Animated, StyleSheet, Text, View } from 'react-native';
import { COLOR, Entra, Icono, Pantallita, t, useAparece, type PropsEscena } from './comun';
import { Camino, FilaMenu, Grupo, Senala } from './guia';

const ORDEN = ['llega', 'responde', 'permiso'];

export default function Avisos({ paso, ancho, alto, idioma, acento }: PropsEscena) {
  const i = ORDEN.indexOf(paso);
  const llega = useAparece(i >= 0, { resorte: true, retraso: 250 });
  const W = Math.min(ancho - 20, 440);
  const H = alto - 12;
  if (i >= 2) {
    return (
      <Pantallita ancho={W} alto={H}>
        <View style={st.ajustes}>
          <Camino pasos={[t(idioma, 'Ajustes', 'Settings'), t(idioma, 'Privacidad', 'Privacy'), t(idioma, 'Permisos', 'Permissions')]} color={acento} />
          <Entra visible>
            <Grupo titulo={t(idioma, 'PERMISOS DEL TELÉFONO', 'PHONE PERMISSIONS')}>
              <FilaMenu icono="microfono" titulo={t(idioma, 'Micrófono', 'Microphone')} valor="✓" />
              <FilaMenu icono="camara" titulo={t(idioma, 'Cámara', 'Camera')} valor="✓" />
              <Senala activo color={acento}>
                <FilaMenu icono="campana" titulo={t(idioma, 'Avisos', 'Notifications')} sub={t(idioma, 'Para escribirte con la app cerrada', 'To reach you with the app closed')} valor={t(idioma, 'Permitir', 'Allow')} />
              </Senala>
            </Grupo>
          </Entra>
          <Entra visible retraso={900}>
            <Grupo titulo={t(idioma, 'PRIVACIDAD', 'PRIVACY')}>
              <FilaMenu icono="reloj" titulo={t(idioma, 'Alarmas y recordatorios', 'Alarms & reminders')} sub={t(idioma, 'Para que suenen a la hora exacta', 'So they ring right on time')} valor={t(idioma, 'Permitido', 'Allowed')} />
            </Grupo>
          </Entra>
        </View>
      </Pantallita>
    );
  }
  return (
    <Pantallita ancho={W} alto={H} fondo="#0E1014">
      <View style={st.bloqueo}>
        <Icono nombre="candado" tam={18} color={COLOR.texto3} />
        <Text style={st.hora}>7:30</Text>
        <Text style={st.fecha}>{t(idioma, 'jueves, 2 de octubre', 'Thursday, October 2')}</Text>
      </View>
      <Animated.View style={[st.aviso, { opacity: llega, transform: [{ translateY: llega.interpolate({ inputRange: [0, 1], outputRange: [-40, 0] }) }] }]}>
        <View style={st.avisoCab}>
          <View style={[st.app, { backgroundColor: COLOR.aura }]}>
            <Text style={st.appLetra}>A</Text>
          </View>
          <Text style={st.avisoDe}>AU-RA · {t(idioma, 'ahora', 'now')}</Text>
        </View>
        <Text style={st.avisoTexto}>{t(idioma, '¿Te recuerdo llamar a tu mamá hoy a las 5:00?', 'Shall I remind you to call your mom today at 5:00?')}</Text>
        <View style={st.botones}>
          <Senala activo={i === 1} color={COLOR.verde} mano style={{ flex: 1 }}>
            <View style={[st.boton, { backgroundColor: 'rgba(61,220,132,0.16)' }]}>
              <Text style={[st.botonTexto, { color: COLOR.verde }]}>{t(idioma, 'Sí', 'Yes')}</Text>
            </View>
          </Senala>
          <View style={[st.boton, { flex: 1 }]}>
            <Text style={st.botonTexto}>{t(idioma, 'Luego', 'Later')}</Text>
          </View>
        </View>
      </Animated.View>
      {i === 1 ? (
        <Entra visible retraso={1600} style={st.hecho}>
          <Text style={st.hechoTexto}>{t(idioma, '✓ Listo: a las 5:00 te llamo', '✓ Done: I’ll call you at 5:00')}</Text>
        </Entra>
      ) : null}
    </Pantallita>
  );
}

const st = StyleSheet.create({
  bloqueo: { alignItems: 'center', paddingTop: 30, gap: 2 },
  hora: { color: COLOR.texto, fontSize: 52, fontWeight: '300', letterSpacing: 1 },
  fecha: { color: COLOR.texto2, fontSize: 14 },
  aviso: { margin: 14, marginTop: 18, padding: 12, borderRadius: 18, backgroundColor: 'rgba(40,42,48,0.96)', borderWidth: 1, borderColor: COLOR.borde, gap: 8 },
  avisoCab: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  app: { width: 22, height: 22, borderRadius: 6, alignItems: 'center', justifyContent: 'center' },
  appLetra: { color: '#141414', fontSize: 13, fontWeight: '900' },
  avisoDe: { color: COLOR.texto2, fontSize: 12, fontWeight: '700' },
  avisoTexto: { color: COLOR.texto, fontSize: 15, lineHeight: 20, fontWeight: '600' },
  botones: { flexDirection: 'row', gap: 8 },
  boton: { alignItems: 'center', paddingVertical: 9, borderRadius: 12, backgroundColor: COLOR.panel2 },
  botonTexto: { color: COLOR.texto, fontSize: 14, fontWeight: '800' },
  hecho: { alignSelf: 'center', paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999, backgroundColor: 'rgba(61,220,132,0.14)' },
  hechoTexto: { color: COLOR.verde, fontSize: 13, fontWeight: '800' },
  ajustes: { flex: 1, paddingTop: 24, paddingHorizontal: 12, gap: 12 },
});
