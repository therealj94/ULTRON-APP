/**
 * Lo que comparten los dibujos de los efectos (espadaJedi.ts, blasters.ts, pintar.ts): colores con
 * opacidad, pinceles y resplandores, con la API imperativa de Skia.
 *
 * `Skia` entra como parámetro (como en cara/pintar.ts): en el teléfono es el de JSI, en el hilo de la
 * interfaz; en la computadora, CanvasKit (scripts/qa/efectos-avatar.ts). Los enums van como números,
 * que son los mismos en los dos: BlurStyle.Normal=0, PaintStyle.Fill=0 / Stroke=1, StrokeCap.Round=1,
 * TileMode.Clamp=0.
 */
import type { SkPaint, Skia } from '@shopify/react-native-skia';

export type SkiaApi = typeof Skia;

export const CLAMP = 0;
export const BLUR_NORMAL = 0;
export const RELLENO = 0;
export const TRAZO = 1;
export const PUNTA_REDONDA = 1;

/** Un color #RRGGBB con opacidad. */
export function col(Sk: SkiaApi, hex: string, a: number) {
  'worklet';
  const c = Sk.Color(hex);
  c[3] = a < 0 ? 0 : a > 1 ? 1 : a;
  return c;
}

/** Un pincel con suavizado; trazo redondo si lleva `ancho`. */
export function pincel(Sk: SkiaApi, ancho = 0): SkPaint {
  'worklet';
  const p = Sk.Paint();
  p.setAntiAlias(true);
  if (ancho > 0) {
    p.setStyle(TRAZO);
    p.setStrokeWidth(ancho);
    p.setStrokeCap(PUNTA_REDONDA);
  }
  return p;
}

/** Difumina lo que pinte el pincel (el resplandor). */
export function difuso(Sk: SkiaApi, p: SkPaint, sigma: number) {
  'worklet';
  if (sigma > 0.3) p.setMaskFilter(Sk.MaskFilter.MakeBlur(BLUR_NORMAL, sigma, true));
}

/** Un brillo redondo: color en el centro que se apaga hacia el borde. */
export function brilloRedondo(Sk: SkiaApi, x: number, y: number, r: number, hex: string, a: number, centro = '#FFFFFF') {
  'worklet';
  const p = pincel(Sk);
  p.setShader(Sk.Shader.MakeRadialGradient(Sk.Point(x, y), Math.max(0.5, r), [col(Sk, centro, a), col(Sk, hex, a * 0.55), col(Sk, hex, 0)], [0, 0.35, 1], CLAMP));
  return p;
}
