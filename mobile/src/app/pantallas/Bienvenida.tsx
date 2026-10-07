/**
 * La bienvenida (la primera vez en este teléfono, sin sesión): tres pantallas que se deslizan con el
 * dedo, cada una con su ilustración viva y parallax.
 *
 *   1. AURA habla contigo
 *   2. Chatea y llama cifrado con tu familia
 *   3. Tu AURA te conoce y te ayuda
 *
 * Los puntos siguen al dedo; «Siguiente» avanza con la misma animación del deslizamiento; en la
 * última dice «Entrar». «Saltar» va directo a la entrada. Arriba, el idioma (cambia todo al momento).
 * Se ve una sola vez: al terminar o saltar queda anotado en el teléfono.
 */
import { useCallback, useState } from 'react';
import { StyleSheet, View, useWindowDimensions } from 'react-native';
import Animated, { useAnimatedRef, useAnimatedScrollHandler, useDerivedValue, useSharedValue, type SharedValue } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { tr, useIdioma } from '../../i18n';
import { MEDIDA, useTema } from '../../nucleo/tema';
import { Boton, Puntos, SelectorIdioma, Texto, vibrar } from '../../ui';
import { IlustracionChat, IlustracionConoce, IlustracionHabla } from '../ilustraciones';
import type { RaizParams } from '../rutas';
import { marcarBienvenidaVista } from '../sesion';

type Props = NativeStackScreenProps<RaizParams, 'Bienvenida'>;

type Hoja = { titulo: () => string; texto: () => string; Ilustracion: typeof IlustracionHabla };

const HOJAS: Hoja[] = [
  {
    titulo: () => tr('AU-RA habla contigo', 'AU-RA talks with you'),
    texto: () =>
      tr(
        'Háblale como a una amiga: te escucha, te contesta con su voz y te acompaña mientras chateas.',
        'Talk to her like a friend: she listens, answers with her own voice and keeps you company while you chat.'
      ),
    Ilustracion: IlustracionHabla,
  },
  {
    titulo: () => tr('Chatea y llama cifrado con tu familia', 'Chat and call your family, encrypted'),
    texto: () =>
      tr(
        'Mensajes, fotos, llamadas y videollamadas cifrados de punta a punta. Solo ustedes los ven.',
        'Messages, photos, calls and video calls, end-to-end encrypted. Only you can see them.'
      ),
    Ilustracion: IlustracionChat,
  },
  {
    titulo: () => tr('Tu AU-RA te conoce y te ayuda', 'Your AU-RA knows you and helps'),
    texto: () =>
      tr(
        'Se acuerda de tus cumpleaños, tus gustos y tu gente. Te escribe mensajes, organiza tu día y más.',
        'She remembers your birthdays, what you like and your people. She writes messages, plans your day and more.'
      ),
    Ilustracion: IlustracionConoce,
  },
];

function Pagina({ i, x, ancho, alto, horizontal }: { i: number; x: SharedValue<number>; ancho: number; alto: number; horizontal: boolean }) {
  const h = HOJAS[i];
  const p = useDerivedValue(() => i - x.value / Math.max(1, ancho));
  // El paralaje va al revés del dedo: la página que se va se queda un poco atrás.
  const pos = useDerivedValue(() => -p.value);
  const tamIlu = horizontal ? Math.min(alto * 0.72, ancho * 0.42) : Math.min(ancho - 40, alto * 0.54, 400);
  return (
    <View style={[{ width: ancho }, horizontal ? s.paginaH : s.pagina]}>
      <View style={[s.ilustracion, horizontal && { flex: 1 }]}>
        <h.Ilustracion p={pos} tam={tamIlu} />
      </View>
      <View style={[s.textos, horizontal && s.textosH]}>
        <Texto v="heroe" centro={!horizontal} accessibilityRole="header">
          {h.titulo()}
        </Texto>
        <Texto v="grande" color="texto2" centro={!horizontal}>
          {h.texto()}
        </Texto>
      </View>
    </View>
  );
}

export function Bienvenida({ navigation }: Props) {
  useIdioma();
  const tema = useTema();
  const ins = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const horizontal = width > height;
  const ref = useAnimatedRef<Animated.ScrollView>();
  const x = useSharedValue(0);
  const [pagina, setPagina] = useState(0);
  const ultima = pagina === HOJAS.length - 1;

  const alScroll = useAnimatedScrollHandler({
    onScroll: (e) => {
      x.value = e.contentOffset.x;
    },
    onMomentumEnd: (e) => {
      scheduleOnRN(setPagina, Math.round(e.contentOffset.x / Math.max(1, width)));
    },
  });

  const terminar = useCallback(() => {
    void marcarBienvenidaVista();
    navigation.replace('Entrar');
  }, [navigation]);

  const siguiente = () => {
    if (ultima) return terminar();
    vibrar('seleccion');
    const n = pagina + 1;
    ref.current?.scrollTo({ x: n * width, animated: true });
    setPagina(n);
  };

  const altoPaginas = height - ins.top - ins.bottom - (horizontal ? 80 : 172);

  return (
    <View style={[s.raiz, { backgroundColor: tema.fondo, paddingTop: ins.top, paddingBottom: ins.bottom }]}>
      <View style={s.barra}>
        <SelectorIdioma />
        {!ultima && <Boton titulo={tr('Saltar', 'Skip')} variante="fantasma" onPress={terminar} />}
      </View>
      <Animated.ScrollView
        ref={ref}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onScroll={alScroll}
        scrollEventThrottle={16}
        style={{ flex: 1 }}
        decelerationRate="fast"
        overScrollMode="never"
      >
        {HOJAS.map((_, i) => (
          <Pagina key={i} i={i} x={x} ancho={width} alto={altoPaginas} horizontal={horizontal} />
        ))}
      </Animated.ScrollView>
      <View style={[s.pie, horizontal && s.pieH]}>
        <Puntos total={HOJAS.length} posicion={x} ancho={width} />
        <Boton
          titulo={ultima ? tr('Entrar', 'Sign in') : tr('Siguiente', 'Next')}
          iconoDerecha={ultima ? undefined : 'flecha'}
          icono={ultima ? 'huella' : undefined}
          onPress={siguiente}
          style={horizontal ? { minWidth: 220 } : { alignSelf: 'stretch' }}
        />
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  raiz: { flex: 1 },
  barra: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: MEDIDA.espacio.l, height: 56 },
  pagina: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: MEDIDA.espacio.xl, gap: MEDIDA.espacio.xl },
  paginaH: { flex: 1, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 40, gap: 36 },
  ilustracion: { alignItems: 'center', justifyContent: 'center' },
  textos: { gap: 12, maxWidth: 440, alignItems: 'center' },
  textosH: { flex: 1, alignItems: 'flex-start' },
  pie: { paddingHorizontal: MEDIDA.espacio.xl, paddingBottom: MEDIDA.espacio.l, gap: MEDIDA.espacio.xl, alignItems: 'center' },
  pieH: { flexDirection: 'row', justifyContent: 'space-between', paddingBottom: MEDIDA.espacio.s, paddingHorizontal: 40 },
});
