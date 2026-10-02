/**
 * «Responder hablando»: el botón del micrófono de cada pregunta. Mientras oye, late y enseña lo que va
 * entendiendo; al terminar entrega lo dicho (la pregunta lo convierte en opciones y texto: flujo.ts
 * chipsDeDictado / opcionDeDictado). Si el teléfono no puede, lo dice y se sigue escribiendo.
 */
import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withRepeat, withSequence, withTiming } from 'react-native-reanimated';
import { tr, useIdioma } from '../i18n';
import { MEDIDA, useTema } from '../nucleo/tema';
import { Icono, Texto, vibrar } from '../ui';
import { dictar, type Dictado } from './dictado';

export function ResponderHablando({ onDicho, pistas = [] }: { onDicho: (texto: string) => void; pistas?: readonly string[] }) {
  const tema = useTema();
  const idioma = useIdioma();
  const [oyendo, setOyendo] = useState(false);
  const [parcial, setParcial] = useState('');
  const [aviso, setAviso] = useState('');
  const dictado = useRef<Dictado | null>(null);
  const late = useSharedValue(1);
  const a = useAnimatedStyle(() => ({ transform: [{ scale: late.value }] }));

  useEffect(() => {
    late.value = oyendo ? withRepeat(withSequence(withTiming(1.12, { duration: 520 }), withTiming(1, { duration: 520 })), -1) : withTiming(1, { duration: 160 });
  }, [oyendo, late]);

  // Al salir de la pregunta (siguiente, atrás, cerrar) lo que estaba oyendo se tira.
  useEffect(() => () => dictado.current?.cancelar(), []);

  const tocar = async () => {
    if (oyendo) {
      dictado.current?.parar();
      return;
    }
    vibrar('seleccion');
    setAviso('');
    setParcial('');
    const d = await dictar(
      idioma === 'en' ? 'en' : 'es',
      {
        onParcial: setParcial,
        onFinal: (t) => {
          setParcial(t);
          onDicho(t);
        },
        onFin: () => {
          setOyendo(false);
          dictado.current = null;
        },
        onError: setAviso,
      },
      pistas
    );
    dictado.current = d;
    if (d) setOyendo(true);
  };

  return (
    <View style={{ gap: 6 }}>
      <Pressable
        onPress={() => void tocar()}
        accessibilityRole="button"
        accessibilityLabel={oyendo ? tr('Terminar de hablar', 'Stop talking') : tr('Responder hablando', 'Answer by voice')}
        style={[s.boton, { borderColor: oyendo ? tema.acento : tema.borde, backgroundColor: oyendo ? tema.acentoFondo : tema.superficie }]}
      >
        <Animated.View style={[s.icono, { backgroundColor: oyendo ? tema.acento : tema.acentoFondo }, a]}>
          <Icono nombre="microfono" tam={20} color={oyendo ? tema.sobreAcento : tema.acentoTexto} />
        </Animated.View>
        <View style={{ flex: 1 }}>
          <Texto v="cuerpoFuerte">
            {oyendo ? tr('Te escucho… toca para terminar', 'Listening… tap to finish') : tr('Responder hablando', 'Answer by voice')}
          </Texto>
          <Texto v="chica" color="texto3" numberOfLines={2}>
            {parcial ? `«${parcial}»` : tr('Dilo con tus palabras: lo escribo y marco las opciones que nombres.', 'Say it your way: I’ll type it and tick the options you name.')}
          </Texto>
        </View>
      </Pressable>
      {!!aviso && (
        <Texto v="chica" color="aviso">
          {aviso}
        </Texto>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  boton: { flexDirection: 'row', alignItems: 'center', gap: 12, borderWidth: 1, borderRadius: MEDIDA.radio.m, paddingHorizontal: 12, paddingVertical: 10, minHeight: 56 },
  icono: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
});
