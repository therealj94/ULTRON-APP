/**
 * Los atajos del avatar en pantalla (su oficio): una fila de píldoras con su color que se desliza de
 * lado. Tocar una se lo pide a la mesa como si se hubiera dicho en voz alta.
 *
 *  · Guardián: ¿qué ves?, vigila, consejo de seguridad, describe la escena.
 *  · AU-RA: mi día, recuérdame algo, dame ánimo, ora conmigo.
 *  · Claudio: ideas de contenido, escribe un post, eslóganes, guion de video.
 *
 * Delante de todas, «Llámame» (si la mesa la pasa): el avatar te llama (compa/LlamadaAvatar).
 */
import { Pressable, ScrollView, StyleSheet, Text } from 'react-native';
import { de } from '../i18n';
import type { Accion, TemaAvatar } from '../avatares/catalogo';
import { Icono } from '../pulse/ui/Icono';

type Props = {
  acciones: readonly Accion[];
  tema: TemaAvatar;
  onAccion: (pedido: string) => void;
  /** El atajo «Llámame» delante de los demás (la llamada del avatar). */
  llamame?: { etiqueta: string; onPress: () => void };
};

export function AccionesAvatar({ acciones, tema, onAccion, llamame }: Props) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.fila} keyboardShouldPersistTaps="handled">
      {llamame ? (
        <Pressable
          onPress={llamame.onPress}
          android_ripple={{ color: tema.acentoFondo }}
          style={({ pressed }) => [s.pildora, s.llamame, { borderColor: tema.acento, backgroundColor: pressed ? tema.acento : tema.acentoFondo }]}
          accessibilityRole="button"
          accessibilityLabel={llamame.etiqueta}
        >
          <Icono nombre="llamar" tam={18} color={tema.acentoTexto} grosor={2} />
          <Text style={[s.texto, { color: tema.acentoTexto }]} numberOfLines={1}>
            {llamame.etiqueta}
          </Text>
        </Pressable>
      ) : null}
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
  pildora: { minHeight: 48, borderRadius: 24, borderWidth: 1, paddingHorizontal: 14, justifyContent: 'center', overflow: 'hidden' },
  llamame: { flexDirection: 'row', alignItems: 'center', gap: 6, borderWidth: 1.5 },
  texto: { fontSize: 14, fontWeight: '700' },
});
