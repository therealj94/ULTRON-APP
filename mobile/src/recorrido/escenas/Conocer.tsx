/**
 * Lo que AU-RA lleva de ti (app/HojasCerebro.tsx): «Lo que sé de ti» (ajustes/LoQueSeDeTi.tsx, cada dato
 * se corrige o se borra), «Mi círculo» (ajustes/Circulo.tsx, tu gente) y «Misiones» (ajustes/Misiones.tsx,
 * tus metas paso a paso). Cada tarjeta se señala cuando la nombran, con su camino de toques.
 */
import { StyleSheet, Text, View } from 'react-native';
import { COLOR, Entra, Icono, Pantallita, t, type PropsEscena } from './comun';
import { Camino, Senala } from './guia';

const ORDEN = ['sabe', 'circulo', 'misiones'];

export default function Conocer({ paso, ancho, alto, idioma, acento }: PropsEscena) {
  const i = ORDEN.indexOf(paso);
  const W = Math.min(ancho - 20, 440);
  const H = alto - 12;
  const camino =
    i === 0
      ? [t(idioma, 'Ajustes', 'Settings'), 'AURA', t(idioma, 'Lo que AURA aprendió de ti', 'What AURA learned')]
      : i === 1
        ? [t(idioma, 'Ajustes', 'Settings'), 'AURA', t(idioma, 'Mi círculo', 'My circle')]
        : [t(idioma, 'Más', 'More'), t(idioma, 'Misiones', 'Missions')];
  return (
    <Pantallita ancho={W} alto={H}>
      <View style={st.cuerpo}>
        <Camino key={paso} pasos={camino} color={acento} />
        <Senala activo={i === 0} color={acento} mano={i === 0}>
          <View style={st.tarjeta}>
            <View style={st.cab}>
              <Icono nombre="chispas" tam={18} color={COLOR.aura} />
              <Text style={st.titulo}>{t(idioma, 'Lo que sé de ti', 'What I know about you')}</Text>
            </View>
            <Text style={st.dato}>• {t(idioma, 'Su esposa se llama Ana', 'His wife is Ana')}</Text>
            <Text style={st.dato}>• {t(idioma, 'Le gusta el fútbol', 'He likes soccer')}</Text>
            {i === 0 ? (
              <Entra visible retraso={900}>
                <Text style={[st.accion, { color: acento }]}>{t(idioma, 'Corregir · Borrar', 'Fix · Erase')}</Text>
              </Entra>
            ) : null}
          </View>
        </Senala>
        <Senala activo={i === 1} color={acento} mano={i === 1}>
          <View style={st.tarjeta}>
            <View style={st.cab}>
              <Icono nombre="familia" tam={18} color={COLOR.antonio} />
              <Text style={st.titulo}>{t(idioma, 'Mi círculo', 'My circle')}</Text>
            </View>
            <View style={st.personas}>
              {[t(idioma, 'Mamá', 'Mom'), 'Ana', 'Beto'].map((n, k) => (
                <View key={n} style={st.persona}>
                  <View style={[st.avatar, { backgroundColor: ['#5B3A6E', '#6E4A2E', '#2E4A3A'][k] }]}>
                    <Text style={st.inicial}>{n[0]}</Text>
                  </View>
                  <Text style={st.nombre}>{n}</Text>
                </View>
              ))}
            </View>
          </View>
        </Senala>
        <Senala activo={i === 2} color={acento} mano={i === 2}>
          <View style={st.tarjeta}>
            <View style={st.cab}>
              <Icono nombre="estrella" tam={18} color={COLOR.claudio} />
              <Text style={st.titulo}>{t(idioma, 'Misiones', 'Missions')}</Text>
            </View>
            <Text style={st.dato}>{t(idioma, 'Vender el carro · 2 de 5 pasos', 'Sell the car · 2 of 5 steps')}</Text>
            <View style={st.barra}>
              <View style={[st.lleno, { width: '40%', backgroundColor: COLOR.claudio }]} />
            </View>
          </View>
        </Senala>
      </View>
    </Pantallita>
  );
}

const st = StyleSheet.create({
  cuerpo: { flex: 1, paddingTop: 24, paddingHorizontal: 12, gap: 10 },
  tarjeta: { borderRadius: 14, backgroundColor: COLOR.panel2, padding: 10, gap: 4 },
  cab: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  titulo: { color: COLOR.texto, fontSize: 14.5, fontWeight: '800' },
  dato: { color: COLOR.texto2, fontSize: 12.5 },
  accion: { fontSize: 12, fontWeight: '800', marginTop: 2 },
  personas: { flexDirection: 'row', gap: 14, marginTop: 2 },
  persona: { alignItems: 'center', gap: 2 },
  avatar: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  inicial: { color: COLOR.texto, fontSize: 13, fontWeight: '800' },
  nombre: { color: COLOR.texto2, fontSize: 11 },
  barra: { height: 6, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.08)', overflow: 'hidden', marginTop: 4 },
  lleno: { height: 6, borderRadius: 3 },
});
