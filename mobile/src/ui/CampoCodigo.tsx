/**
 * El código de 6 cifras como lo piden las apps del teléfono: seis casillas, la que toca se enciende en dorado y
 * cada cifra cae en la suya. Detrás hay UN solo TextInput (transparente, encima de las casillas) para que todo lo
 * nativo siga sirviendo: el teclado de números, pegar el código entero (con espacios o guiones), y el autocompletado
 * de Android/Samsung que ofrece el código del correo o del SMS (`one-time-code`). Al completar las 6 cifras llama a
 * `alCompletar` (la pantalla confirma sola, sin otro toque).
 */
import { forwardRef, useEffect, useState } from 'react';
import { StyleSheet, TextInput, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withRepeat, withSequence, withTiming } from 'react-native-reanimated';
import { tr } from '../i18n';
import { MEDIDA, useTema } from '../nucleo/tema';
import { Texto } from './Texto';
import { estiloLetra } from './tipografia';

export const LARGO_CODIGO = 6;

type Props = {
  valor: string;
  /** Recibe solo cifras, hasta 6. */
  alCambiar: (t: string) => void;
  alCompletar?: (codigo: string) => void;
  error?: string;
  editable?: boolean;
  autoFocus?: boolean;
  etiqueta?: string;
};

/** El cursor que parpadea en la casilla que toca. */
function Cursor({ color }: { color: string }) {
  const o = useSharedValue(1);
  useEffect(() => {
    o.value = withRepeat(withSequence(withTiming(0, { duration: 450 }), withTiming(1, { duration: 450 })), -1);
  }, [o]);
  const a = useAnimatedStyle(() => ({ opacity: o.value }));
  return <Animated.View style={[s.cursor, { backgroundColor: color }, a]} />;
}

export const CampoCodigo = forwardRef<TextInput, Props>(function CampoCodigo({ valor, alCambiar, alCompletar, error, editable = true, autoFocus, etiqueta }, ref) {
  const tema = useTema();
  const [foco, setFoco] = useState(false);
  const cifras = valor.replace(/\D/g, '').slice(0, LARGO_CODIGO);
  const activa = Math.min(cifras.length, LARGO_CODIGO - 1);

  return (
    <View style={s.raiz}>
      <View style={s.fila}>
        {Array.from({ length: LARGO_CODIGO }, (_, i) => {
          const llena = i < cifras.length;
          const aqui = foco && editable && i === activa && cifras.length < LARGO_CODIGO;
          const borde = error ? tema.aviso : aqui ? tema.acento : llena ? tema.acentoTexto : tema.borde;
          return (
            <View key={i} style={[s.casilla, { backgroundColor: tema.superficie, borderColor: borde, borderWidth: aqui || error ? 2 : 1.5 }]}>
              {llena ? (
                <Texto v="titulo" style={[estiloLetra('titulo'), s.cifra]}>
                  {cifras[i]}
                </Texto>
              ) : aqui ? (
                <Cursor color={tema.acento} />
              ) : null}
            </View>
          );
        })}
        <TextInput
          ref={ref}
          value={cifras}
          onChangeText={(t) => {
            const limpio = t.replace(/\D/g, '').slice(0, LARGO_CODIGO);
            alCambiar(limpio);
            if (limpio.length === LARGO_CODIGO && limpio !== cifras) alCompletar?.(limpio);
          }}
          onFocus={() => setFoco(true)}
          onBlur={() => setFoco(false)}
          keyboardType="number-pad"
          textContentType="oneTimeCode"
          autoComplete="one-time-code"
          importantForAutofill="yes"
          // Más que 6: un código pegado con espacios o guiones («123-456») llega entero y se limpia arriba (Codex, PR #178).
          maxLength={24}
          editable={editable}
          autoFocus={autoFocus}
          caretHidden
          contextMenuHidden={false}
          selectionColor="transparent"
          // Encima de las casillas y casi invisible (no del todo: con opacidad 0 Android no ofrece autocompletar).
          style={s.entrada}
          accessibilityLabel={etiqueta || tr('Código de 6 cifras', '6-digit code')}
          accessibilityHint={tr('Escribe o pega el código que te llegó al correo', 'Type or paste the code from your email')}
        />
      </View>
      {!!error && (
        <Texto v="chica" color="aviso" centro accessibilityLiveRegion="polite">
          {error}
        </Texto>
      )}
    </View>
  );
});

const s = StyleSheet.create({
  raiz: { gap: 10, width: '100%' },
  fila: { flexDirection: 'row', justifyContent: 'space-between', gap: 8 },
  casilla: { flex: 1, maxWidth: 56, aspectRatio: 0.82, borderRadius: MEDIDA.radio.m, alignItems: 'center', justifyContent: 'center' },
  cifra: { fontSize: 26, lineHeight: 32 },
  cursor: { width: 2, height: 26, borderRadius: 1 },
  entrada: { ...StyleSheet.absoluteFillObject, opacity: 0.02, color: 'transparent', fontSize: 1 },
});
