/**
 * Campo de texto con etiqueta, al estilo de Android: la etiqueta arriba, el borde se enciende en
 * dorado al escribir, el error va debajo del campo (no en un aviso que tapa la pantalla) y la clave
 * se puede mostrar. Con `autoComplete` el gestor de contraseñas del teléfono ofrece lo guardado.
 */
import { forwardRef, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View, type TextInputProps } from 'react-native';
import { T } from '../tema';

type Props = TextInputProps & {
  etiqueta: string;
  error?: string;
  clave?: boolean;
};

export const Campo = forwardRef<TextInput, Props>(function Campo({ etiqueta, error, clave, style, onFocus, onBlur, ...rest }, ref) {
  const [foco, setFoco] = useState(false);
  const [ver, setVer] = useState(false);
  return (
    <View style={s.raiz}>
      <Text style={[s.etiqueta, foco && s.etiquetaFoco, !!error && s.etiquetaError]}>{etiqueta}</Text>
      <View style={[s.caja, foco && s.cajaFoco, !!error && s.cajaError]}>
        <TextInput
          ref={ref}
          placeholderTextColor={T.texto3}
          secureTextEntry={clave && !ver}
          autoCapitalize="none"
          autoCorrect={false}
          onFocus={(e) => {
            setFoco(true);
            onFocus?.(e);
          }}
          onBlur={(e) => {
            setFoco(false);
            onBlur?.(e);
          }}
          style={[s.input, style]}
          accessibilityLabel={etiqueta}
          {...rest}
        />
        {clave && (
          <Pressable onPress={() => setVer((v) => !v)} hitSlop={10} accessibilityRole="button" accessibilityLabel={ver ? 'Ocultar clave' : 'Mostrar clave'} style={s.ojo}>
            <Text style={s.ojoTexto}>{ver ? 'Ocultar' : 'Mostrar'}</Text>
          </Pressable>
        )}
      </View>
      {!!error && <Text style={s.error}>{error}</Text>}
    </View>
  );
});

const s = StyleSheet.create({
  raiz: { gap: 6, width: '100%' },
  etiqueta: { color: T.texto2, fontSize: 13, fontWeight: '600', marginLeft: 4 },
  etiquetaFoco: { color: T.principalTexto },
  etiquetaError: { color: T.avisoTexto },
  caja: { flexDirection: 'row', alignItems: 'center', borderWidth: 1.5, borderColor: T.borde, borderRadius: 16, backgroundColor: T.fondo, minHeight: 52 },
  cajaFoco: { borderColor: T.principal },
  cajaError: { borderColor: T.aviso },
  input: { flex: 1, color: T.texto, fontSize: 16, paddingHorizontal: 16, paddingVertical: 12 },
  ojo: { paddingHorizontal: 14, minHeight: 44, justifyContent: 'center' },
  ojoTexto: { color: T.principalTexto, fontSize: 13, fontWeight: '600' },
  error: { color: T.avisoTexto, fontSize: 13, marginLeft: 4 },
});
