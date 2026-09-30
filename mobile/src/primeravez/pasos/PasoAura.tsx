/**
 * (e) AURA se presenta: qué sabe hacer, en tarjetas que llegan una tras otra. Con «Escúchala» lo
 * dice en voz alta con la voz del avatar elegido (la función de hablar de la mesa, src/lib/tts.ts).
 */
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated';
import { tr } from '../../i18n';
import { speak, stopSpeaking } from '../../lib/tts';
import { MEDIDA, useTema } from '../../nucleo/tema';
import { Aparecer, Boton, Icono, Tarjeta, Texto, type NombreIcono } from '../../ui';
import { EncabezadoPaso, VistaAvatar } from '../piezas';
import type { PropsPaso } from './tipos';

type Poder = { icono: NombreIcono; titulo: () => string; texto: () => string };

const PODERES: Poder[] = [
  { icono: 'chat', titulo: () => tr('Hablo contigo mientras chateas', 'I talk with you while you chat'), texto: () => tr('Te leo los mensajes y te ayudo a contestar sin soltar lo que haces.', 'I read you messages and help you reply without stopping what you’re doing.') },
  { icono: 'llamada', titulo: () => tr('Llamo por ti', 'I call for you'), texto: () => tr('Dime «llama a mi mamá» y marco, con voz o video.', 'Say “call my mom” and I’ll dial, voice or video.') },
  { icono: 'lapiz', titulo: () => tr('Escribo mensajes por ti', 'I write messages for you'), texto: () => tr('Te dejo el borrador listo; tú decides si se envía.', 'I leave the draft ready; you decide whether to send it.') },
  { icono: 'tocar', titulo: () => tr('Tócame para hablarme', 'Tap me to talk'), texto: () => tr('Un toque y te escucho, en cualquier pantalla.', 'One tap and I’m listening, on any screen.') },
  { icono: 'oido', titulo: () => tr('Doble toque para silenciarme', 'Double-tap to mute me'), texto: () => tr('Me callo y dejo de escuchar hasta que me llames.', 'I go quiet and stop listening until you call me.') },
];

function Latido({ activo, children }: { activo: boolean; children: React.ReactNode }) {
  const v = useSharedValue(0);
  useEffect(() => {
    v.value = activo ? withRepeat(withTiming(1, { duration: 520, easing: Easing.inOut(Easing.sin) }), -1, true) : withTiming(0, { duration: 200 });
  }, [activo, v]);
  const a = useAnimatedStyle(() => ({ transform: [{ scale: 1 + v.value * 0.06 }] }));
  return <Animated.View style={a}>{children}</Animated.View>;
}

export function PasoAura({ borrador, horizontal }: PropsPaso) {
  const tema = useTema();
  const [hablando, setHablando] = useState(false);
  useEffect(() => () => void stopSpeaking(), []);
  const apodo = borrador.apodo.trim();
  const escuchar = () => {
    if (hablando) {
      void stopSpeaking();
      setHablando(false);
      return;
    }
    const texto = [
      tr(`Hola, ${apodo}. Soy AURA, y estoy aquí para ti.`, `Hi, ${apodo}. I’m AURA, and I’m here for you.`),
      ...PODERES.map((p) => `${p.titulo()}. ${p.texto()}`),
    ].join(' ');
    setHablando(true);
    void speak(texto, { emocion: 'feliz', onEnd: () => setHablando(false) }).catch(() => setHablando(false));
  };
  return (
    <View style={{ gap: MEDIDA.espacio.xl }}>
      <View style={[s.cabeza, horizontal && { flexDirection: 'row', alignItems: 'center' }]}>
        <Latido activo={hablando}>
          <VistaAvatar id={borrador.avatar} tam={horizontal ? 120 : 132} />
        </Latido>
        <View style={{ flex: horizontal ? 1 : undefined }}>
          <EncabezadoPaso etiqueta={tr('Conóceme', 'Meet me')} titulo={tr(`Hola, ${apodo}. Soy AURA`, `Hi, ${apodo}. I’m AURA`)} texto={tr('Esto es lo que puedo hacer por ti:', 'Here’s what I can do for you:')} />
        </View>
      </View>
      <View style={{ gap: MEDIDA.espacio.s }}>
        {PODERES.map((p, i) => (
          <Aparecer key={p.icono} retraso={180 + i * 110} desde="derecha" distancia={28}>
            <Tarjeta relleno={MEDIDA.espacio.m}>
              <View style={s.poder}>
                <View style={[s.icono, { backgroundColor: tema.acentoFondo }]}>
                  <Icono nombre={p.icono} tam={20} color={tema.acentoTexto} />
                </View>
                <View style={{ flex: 1, gap: 2 }}>
                  <Texto v="cuerpoFuerte">{p.titulo()}</Texto>
                  <Texto v="chica" color="texto2">
                    {p.texto()}
                  </Texto>
                </View>
              </View>
            </Tarjeta>
          </Aparecer>
        ))}
      </View>
      <Aparecer retraso={800}>
        <Boton titulo={hablando ? tr('Callar', 'Stop') : tr('Escúchala', 'Listen to her')} icono="volumen" variante="secundario" onPress={escuchar} />
      </Aparecer>
    </View>
  );
}

const s = StyleSheet.create({
  cabeza: { gap: MEDIDA.espacio.m, alignItems: 'flex-start' },
  poder: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  icono: { width: 42, height: 42, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
});
