/**
 * EL RECORRIDO: una tarjeta por capacidad (tutorial/pasos.ts), encima de la mesa, con el avatar
 * detrás. Se pasa con «Siguiente» o deslizando; «Saltar» lo cierra; «No volver a mostrar» queda
 * guardado para esta persona. Se vuelve a abrir desde «Más → Qué puedo hacer».
 */
import { useMemo, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import Animated, { FadeIn, FadeInRight, FadeOutLeft } from 'react-native-reanimated';
import { tr } from '../i18n';
import { T } from '../tema';
import type { TemaAvatar } from '../avatares/catalogo';
import { Icono } from '../pulse/ui/Icono';
import { Tocable } from '../pulse/ui/Tocable';
import { pasosTutorial } from './pasos';

type Props = {
  visible: boolean;
  nombreAvatar: string;
  tema: TemaAvatar;
  /** Se cerró. `noVolver`: marcó «no volver a mostrar» (o llegó al final). */
  onCerrar: (noVolver: boolean) => void;
  /** Para las capturas: empezar en este paso. */
  pasoInicial?: number;
};

export function Tutorial({ visible, nombreAvatar, tema, onCerrar, pasoInicial = 0 }: Props) {
  const pasos = useMemo(() => pasosTutorial(nombreAvatar), [nombreAvatar]);
  const [i, setI] = useState(pasoInicial);
  const [noVolver, setNoVolver] = useState(true);
  const { width } = useWindowDimensions();
  if (!visible) return null;
  const p = pasos[Math.min(i, pasos.length - 1)];
  const ultimo = i >= pasos.length - 1;
  const cerrar = (fin: boolean) => {
    onCerrar(fin || noVolver);
    setI(0);
  };
  return (
    <Modal visible transparent animationType="fade" statusBarTranslucent onRequestClose={() => cerrar(false)}>
      <View style={s.velo}>
        <Animated.View entering={FadeIn.duration(220)} style={[s.tarjeta, { width: Math.min(width - 32, 460), borderColor: tema.acento }]}>
          <Text style={[s.cuenta, { color: tema.acentoTexto }]}>
            {tr(`Qué puede hacer ${nombreAvatar}`, `What ${nombreAvatar} can do`)} · {i + 1}/{pasos.length}
          </Text>
          <Animated.View key={p.id} entering={FadeInRight.duration(240)} exiting={FadeOutLeft.duration(160)} style={s.cuerpo}>
            <View style={[s.icono, { backgroundColor: tema.acentoFondo }]}>
              <Icono nombre={p.icono} tam={34} color={tema.acentoTexto} grosor={1.9} />
            </View>
            <Text style={s.titulo} accessibilityRole="header">
              {p.titulo}
            </Text>
            <Text style={s.texto}>{p.texto}</Text>
            {p.ejemplo ? <Text style={[s.ejemplo, { color: tema.acentoTexto }]}>{p.ejemplo}</Text> : null}
          </Animated.View>
          <View style={s.puntos} accessibilityElementsHidden>
            {pasos.map((q, k) => (
              <View key={q.id} style={[s.punto, k === i && { backgroundColor: tema.acento, width: 18 }]} />
            ))}
          </View>
          <Pressable onPress={() => setNoVolver((v) => !v)} style={s.check} accessibilityRole="checkbox" accessibilityState={{ checked: noVolver }} hitSlop={6}>
            <View style={[s.caja, noVolver && { backgroundColor: tema.acento, borderColor: tema.acento }]}>{noVolver ? <Icono nombre="palomita" tam={16} color={tema.sobreAcento} grosor={2.6} /> : null}</View>
            <Text style={s.checkTexto}>{tr('No volver a mostrar', 'Don’t show again')}</Text>
          </Pressable>
          <View style={s.botones}>
            <Tocable onPress={() => cerrar(false)} etiqueta={tr('Saltar el recorrido', 'Skip the tour')} style={s.saltar}>
              <Text style={s.saltarTexto}>{tr('Saltar', 'Skip')}</Text>
            </Tocable>
            {i > 0 ? (
              <Tocable onPress={() => setI(i - 1)} etiqueta={tr('Paso anterior', 'Previous step')} style={s.saltar}>
                <Text style={s.saltarTexto}>{tr('Atrás', 'Back')}</Text>
              </Tocable>
            ) : null}
            <Tocable onPress={() => (ultimo ? cerrar(true) : setI(i + 1))} vibrar etiqueta={ultimo ? tr('Empezar', 'Start') : tr('Siguiente paso', 'Next step')} style={[s.siguiente, { backgroundColor: tema.acento }]}>
              <Text style={[s.siguienteTexto, { color: tema.sobreAcento }]}>{ultimo ? tr('¡Empezar!', 'Start!') : tr('Siguiente', 'Next')}</Text>
            </Tocable>
          </View>
        </Animated.View>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  velo: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16 },
  tarjeta: { backgroundColor: T.fondo2, borderRadius: 28, borderWidth: 1.5, padding: 22, gap: 14 },
  cuenta: { fontSize: 13, fontWeight: '800', letterSpacing: 0.5 },
  cuerpo: { gap: 10, minHeight: 210 },
  icono: { width: 64, height: 64, borderRadius: 32, alignItems: 'center', justifyContent: 'center' },
  titulo: { color: T.texto, fontSize: 22, fontWeight: '800' },
  texto: { color: T.texto2, fontSize: 16, lineHeight: 23 },
  ejemplo: { fontSize: 16, fontWeight: '700', fontStyle: 'italic' },
  puntos: { flexDirection: 'row', gap: 6, alignSelf: 'center' },
  punto: { width: 7, height: 7, borderRadius: 4, backgroundColor: T.borde },
  check: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 44 },
  caja: { width: 24, height: 24, borderRadius: 7, borderWidth: 2, borderColor: T.texto3, alignItems: 'center', justifyContent: 'center' },
  checkTexto: { color: T.texto2, fontSize: 15 },
  botones: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  saltar: { minHeight: 48, paddingHorizontal: 14, justifyContent: 'center', borderRadius: 24 },
  saltarTexto: { color: T.texto2, fontSize: 15, fontWeight: '700' },
  siguiente: { marginLeft: 'auto', minHeight: 52, paddingHorizontal: 26, borderRadius: 26, justifyContent: 'center' },
  siguienteTexto: { fontSize: 16, fontWeight: '800' },
});
