/**
 * Español | English: el idioma de la app, de la voz de los avatares y de sus respuestas.
 *
 * Va en la entrada y en la bienvenida (se elige al entrar) y en el menú. Al tocarlo cambia al
 * momento toda la interfaz y queda guardado en el teléfono.
 */
import { Pressable, StyleSheet, Text, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { fijarIdioma, useIdioma, type Idioma } from '../i18n';
import { saveSettings } from '../lib/storage';
import { T } from '../tema';

export async function elegirIdioma(i: Idioma) {
  fijarIdioma(i);
  await saveSettings({ idioma: i }).catch(() => {});
}

export function SelectorIdioma({ acento = T.principal, sobreAcento = T.sobrePrincipal }: { acento?: string; sobreAcento?: string }) {
  const idioma = useIdioma();
  const opcion = (i: Idioma, texto: string, etiqueta: string) => {
    const activo = idioma === i;
    return (
      <Pressable
        key={i}
        onPress={() => {
          if (activo) return;
          void Haptics.selectionAsync().catch(() => {});
          void elegirIdioma(i);
        }}
        style={[s.opcion, activo && { backgroundColor: acento }]}
        accessibilityRole="button"
        accessibilityState={{ selected: activo }}
        accessibilityLabel={etiqueta}
        hitSlop={6}
      >
        <Text style={[s.texto, activo && { color: sobreAcento }]}>{texto}</Text>
      </Pressable>
    );
  };
  return (
    <View style={s.raiz} accessibilityRole="radiogroup">
      {opcion('es', 'ES', 'Español')}
      {opcion('en', 'EN', 'English')}
    </View>
  );
}

const s = StyleSheet.create({
  raiz: { flexDirection: 'row', backgroundColor: T.panel, borderRadius: 999, padding: 3, borderWidth: 1, borderColor: T.borde, alignSelf: 'flex-start' },
  opcion: { minWidth: 48, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 12 },
  texto: { color: T.texto2, fontSize: 14, fontWeight: '800', letterSpacing: 0.5 },
});
