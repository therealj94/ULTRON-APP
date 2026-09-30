// react-native-web con cara de Android (el de electrum-movil) y, además, la LETRA GRANDE del sistema:
// `?escala=1.6` multiplica el tamaño de cada texto como lo hace Android con «Tamaño de fuente», para
// ver que nada se corta ni se encima (A18). Respeta maxFontSizeMultiplier si alguien lo pasa.
import { forwardRef } from 'react';
import { StyleSheet, Text as TextoWeb, useWindowDimensions as dimensionesWeb } from 'react-native-web';

export * from '../../electrum-movil/simulado/react-native';

const escala = Number(new URLSearchParams(globalThis.location?.search || '').get('escala') || 1);

export const Text = forwardRef<any, any>(function Texto({ style, maxFontSizeMultiplier, ...p }, ref) {
  if (escala === 1) return <TextoWeb ref={ref} style={style} {...p} />;
  const plano = StyleSheet.flatten(style) || {};
  const tope = typeof maxFontSizeMultiplier === 'number' && maxFontSizeMultiplier > 0 ? maxFontSizeMultiplier : Infinity;
  const f = Math.min(escala, tope);
  const tam = (plano.fontSize ?? 14) * f;
  const linea = plano.lineHeight ? plano.lineHeight * f : undefined;
  return <TextoWeb ref={ref} style={[style, { fontSize: tam }, linea ? { lineHeight: linea } : null]} {...p} />;
});

/** Las medidas de la ventana con la escala de la letra (`fontScale`), como las da Android. */
export function useWindowDimensions() {
  return { ...dimensionesWeb(), fontScale: escala };
}
