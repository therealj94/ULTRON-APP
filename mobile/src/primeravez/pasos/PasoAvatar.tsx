/**
 * (c) El avatar: Guardián, AU-RA o Claudio. Arriba el elegido, vivo (parpadea, mira, flota dentro
 * de su aura, con sus colores); abajo las tres tarjetas. Tocar una la elige al momento (vibra y
 * cambia la voz); «Oír su voz» lo hace presentarse con la suya.
 */
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import { de, tr, useIdioma } from '../../i18n';
import { setAvatarVoz, speak, stopSpeaking } from '../../lib/tts';
import { MEDIDA, useTema } from '../../nucleo/tema';
import { AVATARES, avatarPorId, type AvatarId } from '../../avatares/catalogo';
import { MiniAvatar } from '../../avatares/MiniAvatar';
import { Aparecer, Boton, Texto, vibrar } from '../../ui';
import { EncabezadoPaso, VistaAvatar } from '../piezas';
import type { PropsPaso } from './tipos';

function Opcion({ id, activo, onPress }: { id: AvatarId; activo: boolean; onPress: () => void }) {
  const tema = useTema();
  const a = avatarPorId(id);
  const e = useSharedValue(1);
  const an = useAnimatedStyle(() => ({ transform: [{ scale: e.value }] }));
  return (
    <Animated.View style={[{ flex: 1 }, an]}>
      <Pressable
        onPress={onPress}
        onPressIn={() => {
          e.value = withSpring(0.95, MEDIDA.resorte.vivo);
        }}
        onPressOut={() => {
          e.value = withSpring(1, MEDIDA.resorte.vivo);
        }}
        style={[s.opcion, { backgroundColor: activo ? tema.acentoFondo : tema.superficie, borderColor: activo ? a.tema.acento : tema.borde, borderWidth: activo ? 2 : StyleSheet.hairlineWidth * 2 }]}
        accessibilityRole="radio"
        accessibilityState={{ selected: activo }}
        accessibilityLabel={`${de(a.nombre)}, ${de(a.oficio)}`}
      >
        <View style={[s.mini, { borderColor: a.tema.acento }]}>
          <MiniAvatar id={id} lado={56} />
        </View>
        <Texto v="cuerpoFuerte" centro numberOfLines={1}>
          {de(a.nombre)}
        </Texto>
      </Pressable>
    </Animated.View>
  );
}

export function PasoAvatar({ borrador, cambiar, horizontal }: PropsPaso) {
  useIdioma();
  const a = avatarPorId(borrador.avatar);
  const [hablando, setHablando] = useState(false);
  const elegir = (id: AvatarId) => {
    if (id === borrador.avatar) return;
    vibrar('medio');
    void stopSpeaking();
    setAvatarVoz(id);
    cambiar({ avatar: id });
  };
  const oir = () => {
    setAvatarVoz(borrador.avatar);
    setHablando(true);
    void speak(de(a.presentacion), { emocion: 'feliz', onEnd: () => setHablando(false) }).catch(() => setHablando(false));
  };
  return (
    <View style={{ gap: MEDIDA.espacio.xl }}>
      <EncabezadoPaso etiqueta={tr('Tu compañía', 'Your companion')} titulo={tr('¿Con quién quieres hablar?', 'Who do you want to talk to?')} texto={tr('Los tres tienen el mismo cerebro; cada uno con su cara, su voz y lo suyo.', 'All three share one brain; each with its own face, voice and specialty.')} />
      <View style={[s.vista, horizontal && { flexDirection: 'row', gap: MEDIDA.espacio.xl }]}>
        <Aparecer clave={borrador.avatar} desde="escala">
          <VistaAvatar id={borrador.avatar} tam={horizontal ? 170 : 200} />
        </Aparecer>
        <Aparecer clave={`t-${borrador.avatar}`} retraso={60} style={{ alignItems: horizontal ? 'flex-start' : 'center', gap: 4, flexShrink: 1 }}>
          <Texto v="titulo" centro={!horizontal}>
            {de(a.nombre)}
          </Texto>
          <Texto v="cuerpoFuerte" color="acentoTexto" centro={!horizontal}>
            {de(a.oficio)}
          </Texto>
          <Texto v="chica" color="texto2" centro={!horizontal}>
            {de(a.descripcion)} {de(a.voz)}.
          </Texto>
          <Boton titulo={hablando ? tr('Hablando…', 'Speaking…') : tr('Oír su voz', 'Hear the voice')} icono="volumen" variante="fantasma" tam="chico" onPress={oir} deshabilitado={hablando} />
        </Aparecer>
      </View>
      <View style={s.fila} accessibilityRole="radiogroup">
        {AVATARES.map((x) => (
          <Opcion key={x.id} id={x.id} activo={x.id === borrador.avatar} onPress={() => elegir(x.id)} />
        ))}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  vista: { alignItems: 'center', gap: MEDIDA.espacio.m },
  fila: { flexDirection: 'row', gap: 10 },
  opcion: { alignItems: 'center', gap: 8, paddingVertical: 14, paddingHorizontal: 8, borderRadius: MEDIDA.radio.l },
  mini: { width: 56, height: 56, borderRadius: 28, overflow: 'hidden', borderWidth: 1.5 },
});
