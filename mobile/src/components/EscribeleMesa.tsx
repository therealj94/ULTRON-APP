/**
 * «ESCRÍBELE…» EN LA MESA (auditoría visual del 7-oct, C4): escribirle al avatar a un toque, como en cualquier
 * asistente. Antes había que ir a «Más → Escribir» y bajar por el menú viejo hasta «Escribir una orden», y el
 * botón «Chat» de la barra abría los mensajes con la familia, no al avatar.
 *
 * Lo escrito va por el MISMO camino que un turno hablado (mandarTurno en la mesa: conversando, a la conversación;
 * si no, la mesa lo contesta). El borrador es el de la mesa (el mismo del chat del modo trabajo).
 *
 * Sin la etiqueta «Mensaje» ni el testID `mesa-entrada`: esos son del chat del modo trabajo (ChatMesa) y los flujos
 * del emulador los usan para saber que están en él.
 */
import type { RefObject } from 'react';
import { StyleSheet, TextInput, View } from 'react-native';
import { tr } from '../i18n';
import { T } from '../tema';
import type { TemaAvatar } from '../avatares/catalogo';
import { Icono } from '../pulse/ui/Icono';
import { Tocable } from '../pulse/ui/Tocable';

type Props = {
  nombreAvatar: string;
  tema: TemaAvatar;
  valor: string;
  onCambiar: (t: string) => void;
  onEnviar: () => void;
  entradaRef?: RefObject<TextInput | null>;
};

export function EscribeleMesa({ nombreAvatar, tema, valor, onCambiar, onEnviar, entradaRef }: Props) {
  const conTexto = !!valor.trim();
  return (
    <View style={[s.pildora, conTexto && { borderColor: tema.acento }]}>
      <Icono nombre="teclado" tam={20} color={T.texto2} grosor={1.8} />
      <TextInput
        ref={entradaRef}
        value={valor}
        onChangeText={onCambiar}
        placeholder={tr(`Escríbele a ${nombreAvatar}…`, `Write to ${nombreAvatar}…`)}
        placeholderTextColor={T.texto2}
        style={s.entrada}
        testID="mesa-escribele"
        accessibilityLabel={tr(`Escríbele a ${nombreAvatar}`, `Write to ${nombreAvatar}`)}
        returnKeyType="send"
        enablesReturnKeyAutomatically
        blurOnSubmit
        onSubmitEditing={onEnviar}
        maxFontSizeMultiplier={1.4}
      />
      {conTexto ? (
        <Tocable onPress={onEnviar} vibrar etiqueta={tr(`Enviar a ${nombreAvatar}`, `Send to ${nombreAvatar}`)} style={[s.enviar, { backgroundColor: tema.acento }]}>
          <Icono nombre="enviar" tam={22} color={tema.sobreAcento} grosor={2} />
        </Tocable>
      ) : null}
    </View>
  );
}

const s = StyleSheet.create({
  pildora: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    minHeight: 52,
    paddingLeft: 16,
    paddingRight: 4,
    borderRadius: 26,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.14)',
    backgroundColor: 'rgba(20,21,23,0.86)',
  },
  entrada: { flex: 1, minWidth: 0, color: T.texto, fontSize: 16, paddingVertical: 12, minHeight: 48 },
  enviar: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center' },
});
