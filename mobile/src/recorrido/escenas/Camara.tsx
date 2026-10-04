/**
 * La cámara: se abre el visor sobre un escritorio, la persona toca el botón (o sale sola), ¡flash!, la
 * foto se congela, una línea la recorre analizándola y aparecen los recuadros con lo que vio, uno por
 * uno, y la descripción que diría AU-RA.
 */
import { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, Text, View } from 'react-native';
import { COLOR, Chip, Entra, t, Toca, useAparece, useCiclo, useVaiven, type PropsEscena } from './comun';

type Cosa = { emoji: string; x: number; y: number; tam: number; es: string; en: string; seguro: number };
const COSAS: Cosa[] = [
  { emoji: '💻', x: 0.55, y: 0.44, tam: 64, es: 'Laptop', en: 'Laptop', seguro: 97 },
  { emoji: '☕', x: 0.2, y: 0.6, tam: 40, es: 'Taza de café', en: 'Coffee cup', seguro: 95 },
  { emoji: '🪴', x: 0.84, y: 0.3, tam: 48, es: 'Planta', en: 'Plant', seguro: 92 },
  { emoji: '📓', x: 0.36, y: 0.8, tam: 36, es: 'Cuaderno', en: 'Notebook', seguro: 90 },
];

const ORDEN = ['abre', 'flash', 'analiza', 'resultado'];

export default function Camara({ paso, esperando, onToque, ancho, alto, idioma, acento }: PropsEscena) {
  const i = ORDEN.indexOf(paso);
  const abre = useAparece(true, { resorte: true });
  const congelada = useAparece(i >= 1, { ms: 260 });
  const flash = useRef(new Animated.Value(0)).current;
  const barrido = useCiclo(1500, i === 2);
  const vivo = useVaiven(1000, i === 0);

  useEffect(() => {
    if (paso !== 'flash') return;
    flash.setValue(1);
    Animated.timing(flash, { toValue: 0, duration: 650, easing: Easing.out(Easing.quad), useNativeDriver: true }).start();
  }, [paso, flash]);

  const W = Math.min(ancho - 20, 440);
  const H = alto - 12;
  const visorH = H - 96;
  const visorW = W - 20;
  return (
    <View style={{ width: ancho, height: alto, alignItems: 'center', justifyContent: 'center' }}>
      <Animated.View style={[st.camara, { width: W, height: H, opacity: abre, transform: [{ scale: abre.interpolate({ inputRange: [0, 1], outputRange: [0.4, 1] }) }] }]}>
        {/* El visor: lo que ve la cámara (un escritorio). */}
        <Animated.View style={[st.visor, { width: visorW, height: visorH, transform: [{ scale: congelada.interpolate({ inputRange: [0, 1], outputRange: [1, 0.96] }) }] }]}>
          <View style={st.pared} />
          <View style={[st.mesa, { top: visorH * 0.55 }]} />
          {COSAS.map((c) => (
            <Text key={c.emoji} style={[st.cosa, { fontSize: c.tam, left: c.x * visorW - c.tam * 0.6, top: c.y * visorH - c.tam * 0.7 }]}>
              {c.emoji}
            </Text>
          ))}
          {/* Las esquinas del encuadre. */}
          {(['tl', 'tr', 'bl', 'br'] as const).map((k) => (
            <View key={k} style={[st.esquina, k.includes('t') ? { top: 10 } : { bottom: 10 }, k.includes('l') ? { left: 10 } : { right: 10 }, { borderColor: acento }, esquina(k)]} />
          ))}
          {i === 0 ? (
            <View style={st.enVivo}>
              <Animated.View style={[st.punto, { opacity: vivo.interpolate({ inputRange: [0, 1], outputRange: [1, 0.3] }) }]} />
              <Text style={st.enVivoTexto}>{t(idioma, 'CÁMARA', 'CAMERA')}</Text>
            </View>
          ) : null}
          {/* El barrido que analiza la foto. */}
          {i === 2 ? (
            <>
              <View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(69,201,222,0.06)' }]} />
              <Animated.View style={[st.barrido, { width: visorW, transform: [{ translateY: barrido.interpolate({ inputRange: [0, 1], outputRange: [0, visorH - 4] }) }] }]} />
            </>
          ) : null}
          {/* Lo que vio, con su recuadro. */}
          {COSAS.map((c, k) => {
            const arriba = c.y * visorH - c.tam * 0.85;
            // Si la etiqueta no cabe encima del recuadro (visor bajito, acostado), va debajo.
            const debajo = arriba < 26;
            return (
            <Entra key={`r${c.emoji}`} visible={i >= 3} retraso={k * 380} desde={0} style={[st.recuadro, { left: c.x * visorW - c.tam * 0.8, top: arriba, width: c.tam * 1.5, height: c.tam * 1.35, borderColor: acento }]}>
              <View style={[st.etiqueta, debajo ? { bottom: -22 } : { top: -22 }, { backgroundColor: acento }]}>
                <Text style={st.etiquetaTexto} numberOfLines={1}>
                  {idioma === 'en' ? c.en : c.es} · {c.seguro}%
                </Text>
              </View>
            </Entra>
            );
          })}
          {i === 2 ? <Chip texto={t(idioma, 'ANALIZANDO…', 'ANALYZING…')} color={COLOR.antonio} fondo="rgba(0,0,0,0.55)" style={st.analizando} /> : null}
        </Animated.View>

        {/* Abajo: el botón de la foto, o lo que dice AU-RA de la foto. */}
        <View style={st.pie}>
          {i >= 3 ? (
            <Entra visible retraso={COSAS.length * 380}>
              <View style={st.descripcion}>
                <Text style={st.de}>AU-RA</Text>
                <Text style={st.descTexto} numberOfLines={2}>
                  {t(idioma, 'Veo un escritorio con una laptop, una taza de café, una planta y un cuaderno.', 'I see a desk with a laptop, a coffee cup, a plant and a notebook.')}
                </Text>
              </View>
            </Entra>
          ) : (
            <Toca activo={esperando && i === 0} color={acento} tam={66} onPress={onToque} etiqueta={t(idioma, 'Tomar la foto', 'Take the photo')}>
              <View style={st.disparador}>
                <View style={[st.disparadorDentro, i >= 1 && { backgroundColor: '#ddd' }]} />
              </View>
            </Toca>
          )}
        </View>
      </Animated.View>
      {/* ¡Flash! Toda la escena se pone blanca un instante. */}
      <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: '#fff', opacity: flash }]} />
    </View>
  );
}

function esquina(k: 'tl' | 'tr' | 'bl' | 'br') {
  return {
    borderTopWidth: k.includes('t') ? 3 : 0,
    borderBottomWidth: k.includes('b') ? 3 : 0,
    borderLeftWidth: k.includes('l') ? 3 : 0,
    borderRightWidth: k.includes('r') ? 3 : 0,
  };
}

const st = StyleSheet.create({
  camara: { borderRadius: 28, backgroundColor: '#0B0B0D', borderWidth: 1, borderColor: COLOR.borde, alignItems: 'center', paddingTop: 10, overflow: 'hidden' },
  visor: { borderRadius: 20, overflow: 'hidden', backgroundColor: '#3A3530' },
  pared: { ...StyleSheet.absoluteFillObject, backgroundColor: '#4A4239' },
  mesa: { position: 'absolute', left: -20, right: -20, bottom: -10, backgroundColor: '#8A6A4A', borderTopWidth: 6, borderTopColor: '#9C7A57', transform: [{ perspective: 400 }, { rotateX: '18deg' }] },
  cosa: { position: 'absolute' },
  esquina: { position: 'absolute', width: 26, height: 26, borderRadius: 3 },
  enVivo: { position: 'absolute', top: 14, alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: 'rgba(0,0,0,0.5)', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999 },
  punto: { width: 8, height: 8, borderRadius: 4, backgroundColor: COLOR.rojo },
  enVivoTexto: { color: '#fff', fontSize: 11, fontWeight: '800', letterSpacing: 1.2 },
  barrido: { position: 'absolute', top: 0, left: 0, height: 4, backgroundColor: COLOR.antonio, shadowColor: COLOR.antonio, shadowOpacity: 1, shadowRadius: 12, elevation: 8 },
  recuadro: { position: 'absolute', borderWidth: 2, borderRadius: 8 },
  etiqueta: { position: 'absolute', left: -2, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6 },
  etiquetaTexto: { color: '#111', fontSize: 11, fontWeight: '800' },
  analizando: { position: 'absolute', bottom: 12, alignSelf: 'center' },
  pie: { flex: 1, alignSelf: 'stretch', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 14 },
  disparador: { width: 62, height: 62, borderRadius: 31, borderWidth: 4, borderColor: '#fff', alignItems: 'center', justifyContent: 'center' },
  disparadorDentro: { width: 46, height: 46, borderRadius: 23, backgroundColor: '#fff' },
  descripcion: { backgroundColor: COLOR.panel2, borderRadius: 16, paddingHorizontal: 14, paddingVertical: 8, borderWidth: 1, borderColor: 'rgba(214,181,108,0.35)' },
  de: { color: COLOR.aura, fontSize: 11, fontWeight: '800', letterSpacing: 1 },
  descTexto: { color: COLOR.texto, fontSize: 14, lineHeight: 19 },
});
