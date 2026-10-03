/**
 * LA TARJETA VISA DE VETA WALLET, DIBUJADA IGUAL QUE EN SU APP (veta-wallet-app/src/screens/Card.js):
 * negra con grabado de circuito en oro, el monograma de Orden Global al frente, PREMIUM y VISA, el chip con
 * su halo, el número (cortado salvo que se haya pedido con la contraseña), VALID THRU y el titular. Atrás:
 * banda magnética, firma y la caja blanca del CVV.
 *
 * Se gira con un toque (rotateY con resorte, las dos caras con backfaceVisibility oculta). El grabado es un
 * PNG transparente (assets/cartera/circuito.png, sacado de los mismos trazos SVG de la app): así gira como
 * cualquier imagen, sin una vista de Skia por cara.
 */
import { forwardRef, useImperativeHandle, useRef, useState } from 'react';
import { Animated, Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { tr } from '../../i18n';
import { vibrar } from '../../ui';
import { formatearPan, type DatosTarjeta } from './sesion';

const LOGO = require('../../../assets/cartera/orden-global.png');
const CIRCUITO = require('../../../assets/cartera/circuito.png');

/** Los colores de la tarjeta (theme.js de Veta Wallet). */
const NEGRO = ['#221D15', '#12100C', '#050505'] as const;
const ORO = '#C9A961';
const ORO_LT = '#EAD79C';
const ORO_HI = '#F8EFCF';

export type ManejoTarjeta = { girar: (aReverso?: boolean) => void };

type Props = {
  last4?: string;
  titular?: string;
  congelada?: boolean;
  /** Número, vencimiento y CVV ya pedidos con la contraseña (se ocultan solos). */
  datos?: DatosTarjeta | null;
  /** Sin datos del servidor todavía: se dibuja con puntos y un destello. */
  cargando?: boolean;
};

export const TarjetaVisa = forwardRef<ManejoTarjeta, Props>(function TarjetaVisa({ last4, titular, congelada, datos, cargando }, ref) {
  const giro = useRef(new Animated.Value(0)).current;
  const [reverso, setReverso] = useState(false);
  const [ancho, setAncho] = useState(0);
  const alto = ancho ? ancho / 1.586 : 0;
  const k = ancho ? ancho / 346 : 1; // la de Veta Wallet mide ~346 × 224

  const girar = (aReverso?: boolean) => {
    const a = aReverso ?? !reverso;
    if (a === reverso) return;
    vibrar('suave');
    Animated.spring(giro, { toValue: a ? 1 : 0, useNativeDriver: true, friction: 8, tension: 10 }).start();
    setReverso(a);
  };
  useImperativeHandle(ref, () => ({ girar }));

  const frente = giro.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '180deg'] });
  const atras = giro.interpolate({ inputRange: [0, 1], outputRange: ['180deg', '360deg'] });
  const numero = datos?.pan ? formatearPan(datos.pan) : `••••  ••••  ••••  ${last4 || '••••'}`;

  return (
    <Pressable
      onPress={() => girar()}
      onLayout={(e) => setAncho(e.nativeEvent.layout.width)}
      style={{ height: alto || 220 }}
      accessibilityRole="button"
      accessibilityLabel={reverso ? tr('Tarjeta, reverso. Toca para ver el frente.', 'Card, back. Tap for the front.') : tr('Tarjeta, frente. Toca para ver el reverso.', 'Card, front. Tap for the back.')}
    >
      {ancho ? (
        <>
          {/* ── frente ── */}
          <Animated.View style={[s.cara, { height: alto, transform: [{ perspective: 1000 }, { rotateY: frente }] }]}>
            <LinearGradient colors={NEGRO} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={s.fondo}>
              <Image source={CIRCUITO} style={StyleSheet.absoluteFill} resizeMode="stretch" />
              <Image source={LOGO} resizeMode="contain" style={[s.monograma, { top: 36 * k, height: 92 * k }]} />
              {congelada ? <View style={s.velo} /> : null}
              <View style={[s.dentro, { paddingHorizontal: 19 * k, paddingTop: 16 * k, paddingBottom: 17 * k }]}>
                <View style={s.arriba}>
                  <Text style={[s.premium, { fontSize: 10.5 * k }]}>PREMIUM</Text>
                  <Text style={[s.visa, { fontSize: 21 * k }]}>VISA</Text>
                </View>
                <View style={[s.datos, { gap: 13 * k }]}>
                  <Chip k={k} />
                  <View style={{ flex: 1 }}>
                    <Text style={[s.numero, { fontSize: 20.5 * k, opacity: cargando ? 0.5 : 1 }]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.65} selectable={!!datos?.pan}>
                      {numero}
                    </Text>
                    <View style={[s.valido, { marginTop: 7 * k, gap: 7 * k }]}>
                      <Text style={[s.validoK, { fontSize: 6.5 * k, lineHeight: 8 * k }]}>{'VALID\nTHRU'}</Text>
                      <Text style={[s.validoV, { fontSize: 14 * k }]} selectable={!!datos?.expiry}>
                        {datos?.expiry || '••/••'}
                      </Text>
                    </View>
                    <Text style={[s.titular, { fontSize: 15 * k, marginTop: 6 * k }]} numberOfLines={1}>
                      {(titular || '').toUpperCase() || '—'}
                    </Text>
                  </View>
                </View>
              </View>
              {congelada ? (
                <View style={s.selloCongelada}>
                  <Text style={s.selloTxt}>❄ {tr('CONGELADA', 'FROZEN')}</Text>
                </View>
              ) : null}
            </LinearGradient>
          </Animated.View>

          {/* ── reverso ── */}
          <Animated.View style={[s.cara, { height: alto, transform: [{ perspective: 1000 }, { rotateY: atras }] }]}>
            <LinearGradient colors={NEGRO} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={s.fondo}>
              <Image source={CIRCUITO} style={StyleSheet.absoluteFill} resizeMode="stretch" />
              <View style={[s.banda, { top: 20 * k, height: 44 * k }]} />
              <View style={[s.filaFirma, { top: 82 * k, left: 19 * k, right: 19 * k }]}>
                <View style={[s.firma, { height: 34 * k }]} />
                <View style={s.cajaCvv}>
                  <Text style={s.cvvK}>CVV</Text>
                  <Text style={s.cvv} selectable={!!datos?.cvv}>
                    {datos?.cvv || '•••'}
                  </Text>
                </View>
              </View>
              <View style={[s.pieAtras, { bottom: 14 * k, left: 19 * k, right: 19 * k }]}>
                <Text style={[s.notaAtras, { fontSize: 8.5 * k, lineHeight: 12.5 * k }]}>{'Veta Wallet · Orden Global\nSoporte: soporte@ordenglobal.org'}</Text>
                <Text style={[s.visa, { fontSize: 17 * k }]}>VISA</Text>
              </View>
            </LinearGradient>
          </Animated.View>
        </>
      ) : null}
    </Pressable>
  );
});

/** El chip de oro con su halo (tres capas cada vez más grandes y transparentes, como en Veta Wallet). */
function Chip({ k }: { k: number }) {
  return (
    <View style={{ alignItems: 'center', justifyContent: 'center', marginBottom: 2 }}>
      <View style={[s.halo, { width: 86 * k, height: 72 * k, backgroundColor: 'rgba(223,192,120,0.06)' }]} />
      <View style={[s.halo, { width: 70 * k, height: 58 * k, backgroundColor: 'rgba(223,192,120,0.11)' }]} />
      <View style={[s.halo, { width: 56 * k, height: 46 * k, backgroundColor: 'rgba(223,192,120,0.20)' }]} />
      <LinearGradient colors={['#FBF3D6', '#DEC078', '#8F7236']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ width: 42 * k, height: 32 * k, borderRadius: 6, overflow: 'hidden' }}>
        <View style={[s.lineaChip, { top: 11 * k }]} />
        <View style={[s.lineaChip, { top: 20 * k }]} />
        <View style={[s.columnaChip, { left: 15 * k }]} />
      </LinearGradient>
    </View>
  );
}

const sombra = { textShadowColor: 'rgba(0,0,0,0.65)', textShadowOffset: { width: 0, height: 1.5 }, textShadowRadius: 2.5 };

const s = StyleSheet.create({
  cara: { position: 'absolute', top: 0, left: 0, right: 0, borderRadius: 20, backfaceVisibility: 'hidden', shadowColor: '#000', shadowOpacity: 0.35, shadowRadius: 14, shadowOffset: { width: 0, height: 8 }, elevation: 10 },
  fondo: { flex: 1, borderRadius: 20, overflow: 'hidden', borderWidth: 1, borderColor: 'rgba(201,169,97,0.34)' },
  monograma: { position: 'absolute', alignSelf: 'center', width: '64%', opacity: 0.95 },
  velo: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.58)', zIndex: 2 },
  dentro: { flex: 1, justifyContent: 'space-between' },
  arriba: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  premium: { letterSpacing: 4.5, color: 'rgba(234,215,156,0.85)', fontWeight: '600' },
  visa: { fontWeight: '800', fontStyle: 'italic', color: ORO_HI, letterSpacing: 0.5 },
  datos: { flexDirection: 'row', alignItems: 'flex-end' },
  numero: { letterSpacing: 2.4, color: ORO_HI, fontWeight: '700', ...sombra },
  valido: { flexDirection: 'row', alignItems: 'center' },
  validoK: { letterSpacing: 1.2, color: 'rgba(234,215,156,0.7)', fontWeight: '700' },
  validoV: { color: ORO_LT, fontWeight: '700', letterSpacing: 1.6, ...sombra },
  titular: { color: ORO_LT, fontWeight: '700', letterSpacing: 1.8, ...sombra },
  halo: { position: 'absolute', borderRadius: 14 },
  lineaChip: { position: 'absolute', left: 0, right: 0, height: 1, backgroundColor: 'rgba(90,70,25,0.55)' },
  columnaChip: { position: 'absolute', top: 0, bottom: 0, width: 1, backgroundColor: 'rgba(90,70,25,0.55)' },
  selloCongelada: { position: 'absolute', alignSelf: 'center', top: '42%', zIndex: 3, borderWidth: 1.5, borderColor: ORO, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 6, backgroundColor: 'rgba(5,5,5,0.6)' },
  selloTxt: { color: ORO_HI, fontWeight: '900', letterSpacing: 3, fontSize: 13 },
  banda: { position: 'absolute', left: 0, right: 0, backgroundColor: '#080705' },
  filaFirma: { position: 'absolute', flexDirection: 'row', alignItems: 'center', gap: 10 },
  firma: { flex: 1, backgroundColor: '#EFEAE0', borderRadius: 3 },
  cajaCvv: { backgroundColor: '#FFFFFF', borderRadius: 4, paddingHorizontal: 11, paddingVertical: 4, alignItems: 'center', minWidth: 66 },
  cvvK: { color: '#5A5A5A', fontSize: 7.5, letterSpacing: 1.6, fontWeight: '800' },
  cvv: { color: '#0B0B0B', fontWeight: '800', letterSpacing: 2.5, fontSize: 20, lineHeight: 24 },
  pieAtras: { position: 'absolute', flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end' },
  notaAtras: { color: 'rgba(234,215,156,0.55)', flex: 1, marginRight: 10 },
});
