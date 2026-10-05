/**
 * EL CUADRO DE LOS EFECTOS: las ondas de los toques, el sable (espadaJedi.ts) y los blasters (blasters.ts),
 * en un solo SkPicture por cuadro. CapaEfectos lo graba en el hilo de la interfaz (un worklet, como la cara
 * de anillos en cara/pintar.ts) y scripts/qa/efectos-avatar.ts lo pinta con CanvasKit en la computadora.
 */
import type { SkCanvas } from '@shopify/react-native-skia';
import { pintarBlasters } from './blasters';
import { ONDA_MS, salida, type Onda, type PlanBlasters, type PlanEspada } from './escena';
import { pintarEspada } from './espadaJedi';
import { brilloRedondo, col, difuso, pincel, type SkiaApi } from './pincel';

/** Lo que hay que pintar en un instante: la secuencia (o ninguna) con su tiempo, y las ondas con el suyo (ms; < 0 = apagada). */
export type Escena = {
  plan: PlanEspada | PlanBlasters | null;
  t: number;
  ondas: (Onda | null)[];
  tOndas: number[];
  /** En el círculo de la llamada: se recorta al círculo (en Android el borde redondeado de la vista no recorta el lienzo). */
  circulo?: boolean;
};

export function pintarOnda(Sk: SkiaApi, c: SkCanvas, o: Onda, t: number) {
  'worklet';
  if (t < 0 || t > ONDA_MS) return;
  const q = t / ONDA_MS;
  const fuerza = o.sutil ? 0.6 : 1;
  if (o.reducido) {
    // Quieta: un brillo suave que aparece y se va, sin crecer.
    const a = (q < 0.3 ? q / 0.3 : (1 - q) / 0.7) * 0.5 * fuerza;
    c.drawCircle(o.x, o.y, o.r * 0.7, brilloRedondo(Sk, o.x, o.y, o.r * 0.7, o.color, a, o.color));
    return;
  }
  const r = o.r * (0.25 + 0.75 * salida(q));
  const a = (1 - q) * fuerza;
  c.drawCircle(o.x, o.y, r * 0.8, brilloRedondo(Sk, o.x, o.y, r * 0.8, o.color, 0.35 * a, o.color));
  const anillo = pincel(Sk, Math.max(1.2, o.r * 0.05) * (1 - q * 0.5));
  anillo.setColor(col(Sk, o.color, 0.85 * a));
  difuso(Sk, anillo, o.r * 0.03);
  c.drawCircle(o.x, o.y, r, anillo);
  if (o.molesto) {
    // Molesto: un segundo anillo que llega tarde.
    const r2 = o.r * 0.6 * salida(Math.max(0, q - 0.15) / 0.85);
    const anillo2 = pincel(Sk, Math.max(1, o.r * 0.035));
    anillo2.setColor(col(Sk, o.color, 0.7 * a));
    c.drawCircle(o.x, o.y, r2, anillo2);
  }
}

export function pintarEscena(Sk: SkiaApi, c: SkCanvas, e: Escena, W = 0, H = 0) {
  'worklet';
  if (e.circulo && W > 0 && H > 0) c.clipRRect(Sk.RRectXY(Sk.XYWHRect(0, 0, W, H), W / 2, H / 2), 1, true);
  if (e.plan) {
    if (e.plan.efecto === 'espada') pintarEspada(Sk, c, e.plan, e.t);
    else pintarBlasters(Sk, c, e.plan, e.t);
  }
  for (let i = 0; i < e.ondas.length; i++) {
    const o = e.ondas[i];
    if (o) pintarOnda(Sk, c, o, e.tOndas[i] ?? -1);
  }
}

/** Graba el cuadro (W×H) como SkPicture. */
export function grabarEscena(Sk: SkiaApi, W: number, H: number, e: Escena) {
  'worklet';
  const rec = Sk.PictureRecorder();
  const c = rec.beginRecording(Sk.XYWHRect(0, 0, Math.max(1, W), Math.max(1, H)));
  pintarEscena(Sk, c, e, W, H);
  return rec.finishRecordingAsPicture();
}

/** Un cuadro vacío (sin nada que pintar, o si el dibujo falló). */
export function grabarVacio(Sk: SkiaApi) {
  'worklet';
  const rec = Sk.PictureRecorder();
  rec.beginRecording(Sk.XYWHRect(0, 0, 1, 1));
  return rec.finishRecordingAsPicture();
}
