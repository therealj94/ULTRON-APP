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
 *
 * LETRA GRANDE (UX-01, auditoría del 11-oct): sin tope de tamaño. Antes la letra paraba en 1,4: quien la usa al 200 %
 * no la tenía justo donde trabaja. Ahora la caja es de varios renglones y crece con lo escrito (hasta
 * `altoMaxEntrada`: cinco renglones de esa letra, nunca más de un tercio de la ventana —con el teclado abierto acostado
 * la ventana se encoge y la caja también, y lo de más se desliza adentro—). «Enter» sigue mandando (blurOnSubmit).
 * El teclado, el ícono y el botón de enviar se quedan abajo, junto al último renglón.
 */
import type { RefObject } from 'react';
import { StyleSheet, TextInput, View, useWindowDimensions } from 'react-native';
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

/**
 * Cuánto puede crecer una caja de escribir de la mesa: cinco renglones de su letra (16 por la escala del sistema),
 * pero nunca más de un tercio de la ventana ni menos de 48 dp (lo que se toca). Lo usa también ChatMesa.
 */
export function altoMaxEntrada(altoVentana: number, escala: number, letra = 16): number {
  const renglones = Math.round(letra * Math.max(1, escala) * 1.35 * 5 + 24);
  return Math.max(48, Math.min(renglones, Math.round(altoVentana / 3)));
}

export function EscribeleMesa({ nombreAvatar, tema, valor, onCambiar, onEnviar, entradaRef }: Props) {
  const conTexto = !!valor.trim();
  const { height: altoVentana, fontScale } = useWindowDimensions();
  return (
    <View style={[s.pildora, conTexto && { borderColor: tema.acento }]}>
      <View style={s.icono}>
        <Icono nombre="teclado" tam={20} color={T.texto2} grosor={1.8} />
      </View>
      <TextInput
        ref={entradaRef}
        value={valor}
        onChangeText={onCambiar}
        placeholder={tr(`Escríbele a ${nombreAvatar}…`, `Write to ${nombreAvatar}…`)}
        placeholderTextColor={T.texto2}
        style={[s.entrada, { maxHeight: altoMaxEntrada(altoVentana, fontScale) }]}
        testID="mesa-escribele"
        accessibilityLabel={tr(`Escríbele a ${nombreAvatar}`, `Write to ${nombreAvatar}`)}
        multiline
        returnKeyType="send"
        enablesReturnKeyAutomatically
        blurOnSubmit
        onSubmitEditing={onEnviar}
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
    // Abajo, no al centro: al crecer la caja, el ícono y «enviar» se quedan junto al último renglón.
    alignItems: 'flex-end',
    gap: 10,
    minHeight: 52,
    paddingVertical: 2,
    paddingLeft: 16,
    paddingRight: 4,
    borderRadius: 26,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.14)',
    backgroundColor: 'rgba(20,21,23,0.86)',
  },
  icono: { height: 48, justifyContent: 'center' },
  entrada: { flex: 1, minWidth: 0, color: T.texto, fontSize: 16, paddingTop: 12, paddingBottom: 12, minHeight: 48, textAlignVertical: 'center' },
  enviar: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center' },
});
