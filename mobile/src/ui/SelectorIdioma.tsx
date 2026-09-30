/**
 * Español | English: el idioma de la app, de la voz de los avatares y de sus respuestas.
 *
 * Va en la entrada, en la bienvenida, en Ajustes y en el menú de la mesa. Al tocarlo cambia al
 * momento toda la interfaz (la píldora se desliza) y queda guardado en el teléfono; con sesión,
 * también en el perfil.
 *
 * Toma los colores del tema. El menú de la mesa le pasa el acento de su avatar: la mesa es un
 * escenario oscuro en los dos temas, así que con `acento` se pinta siempre con la paleta oscura.
 */
import { useEffect } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import { fijarIdioma, useIdioma, type Idioma } from '../i18n';
import { saveSettings } from '../lib/storage';
import { MEDIDA, OSCURO, useTema, type Paleta } from '../nucleo/tema';
import { vibrar } from './hapticos';
import { Texto } from './Texto';

/** Quien tenga el perfil cargado se suscribe aquí para guardarlo también allá (lo registra lib/perfil). */
let alElegir: ((i: Idioma) => void) | null = null;
export function alElegirIdioma(f: ((i: Idioma) => void) | null) {
  alElegir = f;
}

export async function elegirIdioma(i: Idioma) {
  fijarIdioma(i);
  alElegir?.(i);
  await saveSettings({ idioma: i }).catch(() => {});
}

const ANCHO = 50;

export function SelectorIdioma({ acento, sobreAcento, paleta }: { acento?: string; sobreAcento?: string; paleta?: Paleta }) {
  const idioma = useIdioma();
  const delTema = useTema();
  const tema = paleta || (acento ? OSCURO : delTema);
  const x = useSharedValue(idioma === 'en' ? ANCHO : 0);
  useEffect(() => {
    x.value = withSpring(idioma === 'en' ? ANCHO : 0, MEDIDA.resorte.vivo);
  }, [idioma, x]);
  const a = useAnimatedStyle(() => ({ transform: [{ translateX: x.value }] }));
  const opcion = (i: Idioma, texto: string, etiqueta: string) => {
    const activo = idioma === i;
    return (
      <Pressable
        key={i}
        onPress={() => {
          if (activo) return;
          vibrar('seleccion');
          void elegirIdioma(i);
        }}
        style={s.opcion}
        accessibilityRole="radio"
        accessibilityState={{ selected: activo }}
        accessibilityLabel={etiqueta}
        hitSlop={6}
      >
        <Texto v="chicaFuerte" color={activo ? sobreAcento || tema.sobreAcento : tema.texto2} style={{ letterSpacing: 0.8 }}>
          {texto}
        </Texto>
      </Pressable>
    );
  };
  return (
    <View style={[s.raiz, { backgroundColor: tema.superficie, borderColor: tema.borde }]} accessibilityRole="radiogroup">
      <Animated.View style={[s.pildora, { backgroundColor: acento || tema.acento }, a]} />
      {opcion('es', 'ES', 'Español')}
      {opcion('en', 'EN', 'English')}
    </View>
  );
}

const s = StyleSheet.create({
  raiz: { flexDirection: 'row', borderRadius: 999, padding: 3, borderWidth: StyleSheet.hairlineWidth * 2, alignSelf: 'flex-start' },
  pildora: { position: 'absolute', top: 3, left: 3, width: ANCHO, height: 34, borderRadius: 17 },
  opcion: { width: ANCHO, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
});
