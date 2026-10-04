/**
 * La cartera de Veta Wallet: los saldos (solo lectura), pagar desde un chat de PULSE2CHAT con la moneda de
 * arriba, la firma en Veta Wallet con su contraseña de siempre y el comprobante verificado en la cadena.
 * Lo de verdad: cartera/HojaCartera.tsx, cartera/HojaPagar.tsx y cartera/TarjetaPago.tsx.
 */
import { Animated, StyleSheet, Text, View } from 'react-native';
import { COLOR, Burbuja, Chip, Entra, Icono, Pantallita, t, useAparece, type PropsEscena } from './comun';

const ORDEN = ['saldos', 'pagar', 'firma', 'comprobante'];
const MONEDAS = [
  { simbolo: 'ORIGEN', cantidad: '120.5' },
  { simbolo: 'VETA', cantidad: '3,400' },
];

export default function Cartera({ paso, ancho, alto, idioma, acento }: PropsEscena) {
  const i = Math.max(0, ORDEN.indexOf(paso));
  const brillo = useAparece(i === 0, { ms: 500 });
  const W = Math.min(ancho - 20, 440);
  const H = alto - 12;
  return (
    <Pantallita ancho={W} alto={H}>
      {i === 0 ? (
        <View style={{ padding: 14, paddingTop: 22, gap: 10 }}>
          <View style={st.cabecera}>
            <Icono nombre="wallet" tam={22} color={COLOR.aura} />
            <Text style={st.titulo}>{t(idioma, 'Cartera', 'Wallet')}</Text>
            <Chip texto={t(idioma, 'SOLO LECTURA', 'READ-ONLY')} color={COLOR.verde} fondo="rgba(61,220,132,0.12)" />
          </View>
          <Animated.View style={[st.total, { opacity: brillo.interpolate({ inputRange: [0, 1], outputRange: [0.4, 1] }) }]}>
            <Text style={st.totalEtiqueta}>{t(idioma, 'Tus monedas', 'Your coins')}</Text>
            {MONEDAS.map((m, k) => (
              <Entra key={m.simbolo} visible retraso={200 + k * 160}>
                <View style={st.moneda}>
                  <View style={[st.ficha, { borderColor: k === 0 ? COLOR.aura : COLOR.antonio }]}>
                    <Text style={[st.fichaTexto, { color: k === 0 ? COLOR.aura : COLOR.antonio }]}>{m.simbolo[0]}</Text>
                  </View>
                  <Text style={st.monedaNombre}>{m.simbolo}</Text>
                  <Text style={st.monedaCantidad}>{m.cantidad}</Text>
                </View>
              </Entra>
            ))}
          </Animated.View>
          <Text style={st.nota}>{t(idioma, 'AURA nunca mueve tu dinero.', 'AURA never moves your money.')}</Text>
        </View>
      ) : null}
      {i === 1 ? (
        <View style={{ flex: 1 }}>
          <View style={st.chatCab}>
            <View style={st.avatarChat}>
              <Text style={st.avatarLetra}>A</Text>
            </View>
            <Text style={[st.titulo, { fontSize: 16 }]}>Ana</Text>
            <View style={[st.monedaBoton, { borderColor: acento }]}>
              <Icono nombre="wallet" tam={18} color={acento} />
            </View>
          </View>
          <View style={{ padding: 12, gap: 8 }}>
            <Burbuja de="otro">
              <Text style={st.burbujaTexto}>{t(idioma, '¿Me pasas lo del almuerzo?', 'Can you send me the lunch money?')}</Text>
            </Burbuja>
            <Entra visible retraso={500} style={st.hojaPago}>
              <Text style={st.hojaTitulo}>{t(idioma, 'ENVIAR DINERO A ANA', 'SEND MONEY TO ANA')}</Text>
              <Text style={st.hojaMonto}>5 ORIGEN</Text>
              <Text style={st.hojaDir}>0x7a3f…c91e</Text>
            </Entra>
          </View>
        </View>
      ) : null}
      {i === 2 ? (
        <View style={st.firma}>
          <Icono nombre="candado" tam={34} color={COLOR.aura} />
          <Text style={st.titulo}>Veta Wallet</Text>
          <Text style={st.firmaTexto}>{t(idioma, 'Enviar 5 ORIGEN a Ana', 'Send 5 ORIGEN to Ana')}</Text>
          <View style={st.campoClave}>
            <Text style={st.clave}>••••••••</Text>
          </View>
          <Entra visible retraso={900}>
            <Chip texto={t(idioma, '✓ FIRMADO CON TU CONTRASEÑA', '✓ SIGNED WITH YOUR PASSWORD')} color={COLOR.verde} fondo="rgba(61,220,132,0.12)" />
          </Entra>
        </View>
      ) : null}
      {i === 3 ? (
        <View style={{ padding: 12, paddingTop: 22, gap: 10 }}>
          <Burbuja de="yo" color={acento}>
            <Text style={[st.burbujaTexto, { color: COLOR.fondo }]}>{t(idioma, 'Listo, ahí va.', 'Done, there you go.')}</Text>
          </Burbuja>
          <Entra visible retraso={300} style={st.comprobante}>
            <View style={st.cabecera}>
              <Icono nombre="check" tam={20} color={COLOR.verde} />
              <Text style={[st.titulo, { fontSize: 15 }]}>5 ORIGEN → Ana</Text>
            </View>
            <Text style={[st.nota, { color: COLOR.verde }]}>{t(idioma, 'Verificado en la cadena de Orden Global', 'Verified on the Orden Global chain')}</Text>
            <Text style={st.enlace}>{t(idioma, 'Ver en OrdenScan ›', 'View on OrdenScan ›')}</Text>
          </Entra>
        </View>
      ) : null}
    </Pantallita>
  );
}

const st = StyleSheet.create({
  cabecera: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  titulo: { flex: 1, color: COLOR.texto, fontSize: 17, fontWeight: '800' },
  total: { padding: 12, borderRadius: 16, backgroundColor: COLOR.panel2, gap: 8 },
  totalEtiqueta: { color: COLOR.texto3, fontSize: 11.5, fontWeight: '800', letterSpacing: 1 },
  moneda: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  ficha: { width: 30, height: 30, borderRadius: 15, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  fichaTexto: { fontSize: 14, fontWeight: '900' },
  monedaNombre: { flex: 1, color: COLOR.texto, fontSize: 15, fontWeight: '700' },
  monedaCantidad: { color: COLOR.texto, fontSize: 16, fontWeight: '800' },
  nota: { color: COLOR.texto2, fontSize: 12.5, fontWeight: '600' },
  chatCab: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingTop: 22, paddingHorizontal: 12, paddingBottom: 10, borderBottomWidth: 1, borderBottomColor: COLOR.borde },
  avatarChat: { width: 32, height: 32, borderRadius: 16, backgroundColor: COLOR.antonio, alignItems: 'center', justifyContent: 'center' },
  avatarLetra: { color: COLOR.fondo, fontWeight: '900' },
  monedaBoton: { width: 36, height: 36, borderRadius: 18, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  burbujaTexto: { color: COLOR.texto, fontSize: 14 },
  hojaPago: { marginTop: 6, padding: 12, borderRadius: 16, backgroundColor: COLOR.panel2, gap: 4 },
  hojaTitulo: { color: COLOR.aura, fontSize: 11, fontWeight: '800', letterSpacing: 1 },
  hojaMonto: { color: COLOR.texto, fontSize: 24, fontWeight: '900' },
  hojaDir: { color: COLOR.texto3, fontSize: 12.5 },
  firma: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10, padding: 16 },
  firmaTexto: { color: COLOR.texto2, fontSize: 14.5, fontWeight: '600' },
  campoClave: { alignSelf: 'stretch', marginHorizontal: 24, padding: 12, borderRadius: 12, backgroundColor: COLOR.panel2, alignItems: 'center' },
  clave: { color: COLOR.texto, fontSize: 20, letterSpacing: 4 },
  comprobante: { padding: 12, borderRadius: 16, borderWidth: 1.5, borderColor: COLOR.verde, gap: 6 },
  enlace: { color: COLOR.azul, fontSize: 13, fontWeight: '700' },
});
