/**
 * Los atajos del avatar en pantalla (su oficio): una fila de píldoras con su color que se desliza de
 * lado. Tocar una se lo pide a la mesa como si se hubiera dicho en voz alta.
 *
 *  · Guardián: ¿qué ves?, vigila, consejo de seguridad, describe la escena.
 *  · AU-RA: mi día, recuérdame algo, dame ánimo, ora conmigo.
 *  · Claudio: ideas de contenido, escribe un post, eslóganes, guion de video.
 */
import { Pressable, ScrollView, StyleSheet, Text } from 'react-native';
import { de } from '../i18n';
import type { Accion, TemaAvatar } from '../avatares/catalogo';

type Props = {
  acciones: readonly Accion[];
  tema: TemaAvatar;
  onAccion: (pedido: string) => void;
};

export function AccionesAvatar({ acciones, tema, onAccion }: Props) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.fila} keyboardShouldPersistTaps="handled">
      {acciones.map((a) => (
        <Pressable
          key={a.id}
          onPress={() => onAccion(de(a.pedido))}
          android_ripple={{ color: tema.acentoFondo }}
          style={({ pressed }) => [s.pildora, { borderColor: tema.acento, backgroundColor: pressed ? tema.acentoFondo : 'rgba(20,21,23,0.82)' }]}
          accessibilityRole="button"
          accessibilityLabel={de(a.etiqueta)}
        >
          <Text style={[s.texto, { color: tema.acentoTexto }]} numberOfLines={1}>
            {de(a.etiqueta)}
          </Text>
        </Pressable>
      ))}
    </ScrollView>
  );
}

const s = StyleSheet.create({
  fila: { gap: 8, paddingHorizontal: 12, alignItems: 'center' },
  pildora: { minHeight: 40, borderRadius: 20, borderWidth: 1, paddingHorizontal: 14, justifyContent: 'center', overflow: 'hidden' },
  texto: { fontSize: 14, fontWeight: '700' },
});
