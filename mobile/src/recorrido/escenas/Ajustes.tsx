/**
 * Ajustes (ajustes/Ajustes.tsx) por partes, con el camino para llegar (Más → Ajustes, o «abre ajustes»):
 * tu perfil, el tema y el idioma; lo de AURA; la iniciativa y su computadora; la privacidad y cerrar
 * sesión. Al final, que si se pierde le pregunte a AU-RA: le guía paso a paso y le lleva (lib/menu-app.ts).
 */
import { StyleSheet, Text, View } from 'react-native';
import { Burbuja, COLOR, Entra, Pantallita, t, type PropsEscena } from './comun';
import { Camino, FilaMenu, Grupo, Senala } from './guia';

const ORDEN = ['abre', 'perfil', 'aura', 'privacidad', 'pide'];

export default function Ajustes({ paso, ancho, alto, idioma, acento }: PropsEscena) {
  const i = ORDEN.indexOf(paso);
  const W = Math.min(ancho - 20, 440);
  const H = alto - 12;
  return (
    <Pantallita ancho={W} alto={H}>
      <View style={st.cuerpo}>
        <Text style={st.titulo}>{t(idioma, 'Ajustes', 'Settings')}</Text>
        {i === 0 ? (
          <Entra visible style={{ gap: 12 }}>
            <Camino pasos={[t(idioma, 'Más', 'More'), t(idioma, 'Ajustes', 'Settings')]} color={acento} />
            <Burbuja de="yo" color={acento}>
              {t(idioma, '«Abre ajustes»', '“Open settings”')}
            </Burbuja>
          </Entra>
        ) : null}
        {i === 1 ? (
          <Entra visible style={{ gap: 10 }}>
            <Senala activo color={acento} mano={false}>
              <Grupo titulo={t(idioma, 'TU PERFIL', 'YOUR PROFILE')}>
                <FilaMenu icono="persona" titulo={t(idioma, 'Apodo', 'Nickname')} valor="Chepe" />
                <FilaMenu icono="cara" titulo="Avatar" valor="AU-RA" />
                <FilaMenu icono="pastel" titulo={t(idioma, 'Cumpleaños', 'Birthday')} valor={t(idioma, '14 mar', 'Mar 14')} />
              </Grupo>
            </Senala>
            <Grupo titulo={t(idioma, 'APARIENCIA · IDIOMA', 'APPEARANCE · LANGUAGE')}>
              <FilaMenu icono="luna" titulo={t(idioma, 'Oscuro · Claro · Sistema', 'Dark · Light · System')} valor="" />
              <FilaMenu icono="idioma" titulo="Español · English" valor="" />
            </Grupo>
          </Entra>
        ) : null}
        {i === 2 ? (
          <Entra visible>
            <Senala activo color={acento} mano={false}>
              <Grupo titulo="AURA">
                <FilaMenu icono="chispas" titulo={t(idioma, 'Lo que sé de ti', 'What I know about you')} />
                <FilaMenu icono="familia" titulo={t(idioma, 'Mi círculo', 'My circle')} />
                <FilaMenu icono="estrella" titulo={t(idioma, 'Misiones', 'Missions')} />
                <FilaMenu icono="correo" titulo={t(idioma, 'Tus correos', 'Your email')} />
                <FilaMenu icono="ayuda" titulo={t(idioma, 'Iniciativa de AURA · Su computadora', 'Initiative · Their computer')} />
              </Grupo>
            </Senala>
          </Entra>
        ) : null}
        {i === 3 ? (
          <Entra visible style={{ gap: 10 }}>
            <Senala activo color={acento} mano={false}>
              <Grupo titulo={t(idioma, 'PRIVACIDAD', 'PRIVACY')}>
                <FilaMenu icono="escudo" titulo={t(idioma, 'Permisos del teléfono', 'Phone permissions')} valor="4/4" />
                <FilaMenu icono="reloj" titulo={t(idioma, 'Alarmas y recordatorios', 'Alarms & reminders')} valor={t(idioma, 'Permitido', 'Allowed')} />
              </Grupo>
            </Senala>
            <Grupo titulo=" ">
              <FilaMenu icono="salir" titulo={t(idioma, 'Cerrar sesión', 'Sign out')} valor="" />
            </Grupo>
          </Entra>
        ) : null}
        {i === 4 ? (
          <View style={{ gap: 8 }}>
            <Entra visible>
              <Burbuja de="yo" color={acento}>
                {t(idioma, '¿Cómo conecto mi correo?', 'How do I connect my email?')}
              </Burbuja>
            </Entra>
            <Entra visible retraso={900}>
              <Burbuja de="aura">
                {t(idioma, 'Fácil: 1) Ajustes, 2) «Tus correos», 3) tu dirección y una contraseña de aplicación. ¿Te llevo?', 'Easy: 1) Settings, 2) “Your email”, 3) your address and an app password. Shall I take you there?')}
              </Burbuja>
            </Entra>
          </View>
        ) : null}
      </View>
    </Pantallita>
  );
}

const st = StyleSheet.create({
  cuerpo: { flex: 1, paddingTop: 24, paddingHorizontal: 12, gap: 12 },
  titulo: { color: COLOR.texto, fontSize: 22, fontWeight: '800' },
});
