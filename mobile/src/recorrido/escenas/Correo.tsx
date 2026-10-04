/**
 * Los correos: la bandeja con los proveedores que entran (Gmail, Outlook, Yahoo, el de tu empresa), el
 * correo nuevo que AU-RA lee, la respuesta como borrador que solo sale con el «sí» y dónde se conectan.
 */
import { Animated, StyleSheet, Text, View } from 'react-native';
import { COLOR, Chip, Entra, Icono, Ondas, Pantallita, t, useAparece, type PropsEscena } from './comun';

const ORDEN = ['bandeja', 'lee', 'responde', 'conectar'];
const CORREOS = [
  { de: 'Beto Paz', asunto: { es: 'Factura de septiembre', en: 'September invoice' }, hora: '9:41', nuevo: true },
  { de: 'Ana · Oficina', asunto: { es: 'Reunión del lunes', en: 'Monday meeting' }, hora: '8:15', nuevo: true },
  { de: 'Tienda en línea', asunto: { es: 'Tu pedido va en camino', en: 'Your order is on its way' }, hora: 'Ayer', nuevo: false },
];
const PROVEEDORES = ['Gmail', 'Outlook', 'Yahoo', 'iCloud', '@tuempresa'];

export default function Correo({ paso, ancho, alto, idioma, acento }: PropsEscena) {
  const i = ORDEN.indexOf(paso);
  const resalta = useAparece(i >= 1, { ms: 300 });
  const W = Math.min(ancho - 20, 440);
  const H = alto - 12;
  return (
    <Pantallita ancho={W} alto={H}>
      <View style={st.cabecera}>
        <Icono nombre="correo" tam={22} color={COLOR.antonio} />
        <Text style={st.titulo}>{t(idioma, 'Bandeja de entrada', 'Inbox')}</Text>
        <Chip texto={t(idioma, '2 NUEVOS', '2 NEW')} color={COLOR.antonio} />
      </View>
      <View style={st.proveedores}>
        {PROVEEDORES.map((p, k) => (
          <Entra key={p} visible retraso={k * 90}>
            <View style={st.proveedor}>
              <Text style={st.proveedorTexto}>{p}</Text>
            </View>
          </Entra>
        ))}
      </View>
      <View style={{ paddingHorizontal: 10, gap: 6 }}>
        {CORREOS.map((c, k) => {
          const elegido = k === 0;
          return (
            <Animated.View
              key={c.de}
              style={[
                st.fila,
                elegido && { transform: [{ scale: resalta.interpolate({ inputRange: [0, 1], outputRange: [1, 1.02] }) }] },
              ]}
            >
              {elegido ? <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, st.marco, { borderColor: acento, opacity: resalta }]} /> : null}
              <View style={[st.punto, { backgroundColor: c.nuevo ? COLOR.antonio : 'transparent' }]} />
              <View style={{ flex: 1 }}>
                <Text style={[st.de, c.nuevo && { fontWeight: '800' }]}>{c.de}</Text>
                <Text style={st.asunto} numberOfLines={1}>
                  {c.asunto[idioma]}
                </Text>
              </View>
              <Text style={st.hora}>{k === 2 ? t(idioma, 'Ayer', 'Yesterday') : c.hora}</Text>
            </Animated.View>
          );
        })}
      </View>
      {i === 1 ? (
        <Entra visible style={st.cuerpo}>
          <Text style={st.cuerpoTexto}>{t(idioma, '«Hola, te mando la factura de septiembre. ¿Me confirmas que la recibiste?»', '“Hi, here’s the September invoice. Can you confirm you got it?”')}</Text>
          <View style={st.lee}>
            <Icono nombre="volumen" tam={15} color={COLOR.aura} />
            <Text style={st.leeTexto}>{t(idioma, 'AU-RA te lo lee', 'AU-RA reads it to you')}</Text>
            <Ondas activo color={COLOR.aura} barras={6} alto={14} />
          </View>
        </Entra>
      ) : null}
      {i === 2 ? (
        <Entra visible style={st.borrador}>
          <Text style={st.borradorDe}>{t(idioma, 'RESPUESTA · BORRADOR', 'REPLY · DRAFT')}</Text>
          <Text style={st.borradorTexto}>{t(idioma, 'Hola Beto, la recibí. ¡Gracias!', 'Hi Beto, got it. Thanks!')}</Text>
          <Entra visible retraso={1500}>
            <Chip texto={t(idioma, '✓ «SÍ» · CORREO ENVIADO', '✓ “YES” · EMAIL SENT')} color={COLOR.verde} fondo="rgba(61,220,132,0.12)" />
          </Entra>
        </Entra>
      ) : null}
      {i === 3 ? (
        <Entra visible style={st.ajustes}>
          <Icono nombre="ajustes" tam={22} color={COLOR.texto2} />
          <Text style={st.ajustesTexto}>{t(idioma, 'Ajustes', 'Settings')}</Text>
          <Text style={st.ajustesFlecha}>›</Text>
          <View style={[st.ajustesDestino, { borderColor: acento }]}>
            <Icono nombre="correo" tam={18} color={acento} />
            <Text style={[st.ajustesTexto, { color: acento }]}>{t(idioma, 'Tus correos', 'Your email')}</Text>
          </View>
        </Entra>
      ) : null}
    </Pantallita>
  );
}

const st = StyleSheet.create({
  cabecera: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingTop: 22, paddingHorizontal: 14, paddingBottom: 8 },
  titulo: { flex: 1, color: COLOR.texto, fontSize: 17, fontWeight: '800' },
  proveedores: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, paddingHorizontal: 12, paddingBottom: 10 },
  proveedor: { paddingHorizontal: 9, paddingVertical: 4, borderRadius: 999, backgroundColor: COLOR.panel2 },
  proveedorTexto: { color: COLOR.texto2, fontSize: 12, fontWeight: '700' },
  fila: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 10, borderRadius: 14, backgroundColor: COLOR.panel2, borderWidth: 1.5, borderColor: 'transparent' },
  marco: { borderRadius: 14, borderWidth: 1.5 },
  punto: { width: 9, height: 9, borderRadius: 5 },
  de: { color: COLOR.texto, fontSize: 14.5 },
  asunto: { color: COLOR.texto2, fontSize: 13 },
  hora: { color: COLOR.texto3, fontSize: 12 },
  cuerpo: { margin: 10, padding: 12, borderRadius: 14, backgroundColor: 'rgba(255,255,255,0.04)', gap: 8 },
  cuerpoTexto: { color: COLOR.texto, fontSize: 14, lineHeight: 20, fontStyle: 'italic' },
  lee: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  leeTexto: { color: COLOR.aura, fontSize: 12.5, fontWeight: '700' },
  borrador: { margin: 10, padding: 12, borderRadius: 16, borderWidth: 1.5, borderStyle: 'dashed', borderColor: COLOR.aura, gap: 8 },
  borradorDe: { color: COLOR.aura, fontSize: 11, fontWeight: '800', letterSpacing: 1 },
  borradorTexto: { color: COLOR.texto, fontSize: 15.5, fontWeight: '600' },
  ajustes: { flexDirection: 'row', alignItems: 'center', gap: 8, margin: 12, padding: 12, borderRadius: 16, backgroundColor: COLOR.panel2 },
  ajustesTexto: { color: COLOR.texto2, fontSize: 15, fontWeight: '700' },
  ajustesFlecha: { color: COLOR.texto3, fontSize: 22 },
  ajustesDestino: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999, borderWidth: 1.5 },
});
