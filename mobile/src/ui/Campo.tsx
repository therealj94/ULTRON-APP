/**
 * Campo de texto con etiqueta, al estilo de Android: la etiqueta arriba, el borde se enciende en
 * dorado al escribir (con una transición, no de golpe), el error va debajo del campo y no en un aviso
 * que tapa la pantalla, y la clave se puede mostrar con el ojito (José, 3-oct: «en todo lado se ponga
 * password salga el ojito para ver la contraseña»). Con `autoComplete` el gestor de contraseñas del
 * teléfono ofrece lo guardado. `grande` es el campo protagonista de una pantalla (el apodo).
 */
import { forwardRef, useEffect, useState } from 'react';
import { Pressable, StyleSheet, TextInput, View, type TextInputProps } from 'react-native';
import Animated, { interpolateColor, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { tr } from '../i18n';
import { MEDIDA, useTema } from '../nucleo/tema';
import { Icono } from './Icono';
import { Texto } from './Texto';
import { estiloLetra } from './tipografia';

type Props = TextInputProps & {
  etiqueta: string;
  error?: string;
  ayuda?: string;
  clave?: boolean;
  grande?: boolean;
};

export const Campo = forwardRef<TextInput, Props>(function Campo({ etiqueta, error, ayuda, clave, grande, style, onFocus, onBlur, ...rest }, ref) {
  const tema = useTema();
  const [foco, setFoco] = useState(false);
  const [ver, setVer] = useState(false);
  const f = useSharedValue(0);
  useEffect(() => {
    f.value = withTiming(foco ? 1 : 0, { duration: MEDIDA.duracion.rapida });
  }, [foco, f]);
  const borde = error ? tema.aviso : undefined;
  const aCaja = useAnimatedStyle(() => ({ borderColor: borde ?? interpolateColor(f.value, [0, 1], [tema.borde, tema.acento]) }));

  return (
    <View style={s.raiz}>
      <Texto v="chicaFuerte" color={error ? 'aviso' : foco ? 'acentoTexto' : 'texto2'} style={{ marginLeft: 4 }}>
        {etiqueta}
      </Texto>
      <Animated.View style={[s.caja, grande && s.cajaGrande, { backgroundColor: tema.superficie }, aCaja]}>
        <TextInput
          ref={ref}
          placeholderTextColor={tema.texto3}
          selectionColor={tema.acento}
          cursorColor={tema.acento}
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
          style={[s.input, estiloLetra(grande ? 'titulo' : 'grande'), grande && s.inputGrande, { color: tema.texto }, style]}
          accessibilityLabel={etiqueta}
          {...rest}
        />
        {clave && (
          <Pressable onPress={() => setVer((v) => !v)} hitSlop={10} accessibilityRole="button" accessibilityLabel={ver ? tr('Ocultar clave', 'Hide password') : tr('Mostrar clave', 'Show password')} style={s.ojo}>
            <Icono nombre={ver ? 'ojoTachado' : 'ojo'} tam={21} color={foco ? tema.acentoTexto : tema.texto2} />
          </Pressable>
        )}
      </Animated.View>
      {!!error && (
        <Texto v="chica" color="aviso" style={{ marginLeft: 4 }}>
          {error}
        </Texto>
      )}
      {!error && !!ayuda && (
        <Texto v="chica" color="texto3" style={{ marginLeft: 4 }}>
          {ayuda}
        </Texto>
      )}
    </View>
  );
});

const s = StyleSheet.create({
  raiz: { gap: 7, width: '100%' },
  caja: { flexDirection: 'row', alignItems: 'center', borderWidth: 1.5, borderRadius: MEDIDA.radio.m, minHeight: 54 },
  cajaGrande: { minHeight: 68, borderRadius: MEDIDA.radio.l },
  input: { flex: 1, paddingHorizontal: 16, paddingVertical: 12 },
  inputGrande: { paddingHorizontal: 20 },
  ojo: { paddingHorizontal: 14, minHeight: 44, justifyContent: 'center' },
});
