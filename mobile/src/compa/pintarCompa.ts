/**
 * El dibujo de la compañera con la API imperativa de Skia (un SkPicture por cuadro).
 *
 * Igual que la cara de anillos (cara/pintar.ts): una sola función que corre en un worklet del hilo
 * de la interfaz y que el arnés web dibuja idéntica con CanvasKit. `Skia` entra por parámetro y los
 * enums van como números (TileMode.Clamp=0, BlurStyle.Normal=0, ClipOp.Difference=0 /
 * Intersect=1, PaintStyle.Stroke=1, StrokeCap.Round=1).
 *
 * De atrás hacia delante: la sombrita en el suelo, el aura dorada (AU-RA), el anillo que late al
 * escucharte, los piecitos, el cuerpo de vidrio, el rubor, los ojos (con párpados, ojos felices,
 * «> <» y cejas), la boquita que sigue a la voz, los zzz, los puntitos de pensar y la palomita ✔.
 */
import type { SkCanvas, SkPaint, Skia } from '@shopify/react-native-skia';
import type { EstiloCompa, Figura, Medidas, VivoCompa } from './figura';
import { rebotePaso } from './figura';

type SkiaApi = typeof Skia;

const CLAMP = 0;
const BLUR = 0;
const DIFERENCIA = 0;
const INTERSECCION = 1;
const TRAZO = 1;
const REDONDA = 1;

function col(Sk: SkiaApi, hex: string, a: number) {
  'worklet';
  const c = Sk.Color(hex);
  c[3] = a < 0 ? 0 : a > 1 ? 1 : a;
  return c;
}

function pincel(Sk: SkiaApi, hex: string, a: number, trazo = 0): SkPaint {
  'worklet';
  const p = Sk.Paint();
  p.setAntiAlias(true);
  p.setColor(col(Sk, hex, a));
  if (trazo > 0) {
    p.setStyle(TRAZO);
    p.setStrokeWidth(trazo);
    p.setStrokeCap(REDONDA);
  }
  return p;
}

const lim1 = (v: number) => {
  'worklet';
  return v < -1 ? -1 : v > 1 ? 1 : v;
};
const lim01 = (v: number) => {
  'worklet';
  return v < 0 ? 0 : v > 1 ? 1 : v;
};

function ojo(Sk: SkiaApi, c: SkCanvas, ex: number, ey: number, r: number, f: Figura, v: VivoCompa, e: EstiloCompa, gx: number, gy: number, lado: -1 | 1) {
  'worklet';
  const visible = 1 - lim01(f.apretar);
  if (visible > 0.01) {
    c.save();
    // Párpado de arriba: se recorta desde arriba.
    const tapaY = ey - r * 1.3 + lim01(f.tapa) * r * 2.6;
    c.clipRect(Sk.XYWHRect(ex - r * 2, tapaY, r * 4, r * 4), INTERSECCION, true);
    // Ojos felices: un círculo que sube desde abajo borra la mitad de abajo (queda «∩»).
    if (f.sonrisa > 0.01) {
      const feliz = Sk.Path.Make();
      feliz.addCircle(ex, ey + r * (2.5 - 1.55 * lim01(f.sonrisa)), r * 1.55);
      c.clipPath(feliz, DIFERENCIA, true);
    }
    // Parpadeo: el ojo se aplasta sobre su centro.
    c.translate(ex, ey);
    c.scale(1, v.parpadeo);
    c.translate(-ex, -ey);
    const fondo = pincel(Sk, e.deep, 0.45 * visible);
    c.drawCircle(ex, ey, r, fondo);
    const brillo = pincel(Sk, e.main, 0.35 * visible, r * 0.5);
    brillo.setMaskFilter(Sk.MaskFilter.MakeBlur(BLUR, r * 0.25, true));
    c.drawCircle(ex, ey, r * 0.86, brillo);
    const anillo = pincel(Sk, e.main, visible, r * 0.3);
    c.drawCircle(ex, ey, r * 0.86, anillo);
    const pr = r * 0.4 * f.pupila;
    const px = ex + gx * r * 0.42;
    const py = ey + gy * r * 0.42;
    c.drawCircle(px, py, pr, pincel(Sk, e.hi, visible));
    c.drawCircle(px - pr * 0.35, py - pr * 0.4, pr * 0.32, pincel(Sk, '#FFFFFF', 0.85 * visible));
    c.restore();
  }
  // Dormida: una rayita curva donde estaba el ojo.
  if (f.tapa > 0.82) {
    const a = (f.tapa - 0.82) / 0.18;
    const linea = Sk.Path.Make();
    linea.moveTo(ex - r * 0.85, ey + r * 0.05);
    linea.quadTo(ex, ey + r * 0.6, ex + r * 0.85, ey + r * 0.05);
    c.drawPath(linea, pincel(Sk, e.main, a, r * 0.3));
  }
  // «> <»: el ojo izquierdo mira a la derecha y el derecho a la izquierda.
  if (f.apretar > 0.01) {
    const s = lado === -1 ? 1 : -1;
    const ch = Sk.Path.Make();
    ch.moveTo(ex - s * r * 0.55, ey - r * 0.6);
    ch.lineTo(ex + s * r * 0.5, ey);
    ch.lineTo(ex - s * r * 0.55, ey + r * 0.6);
    c.drawPath(ch, pincel(Sk, e.main, lim01(f.apretar), r * 0.32));
  }
}

export function pintarCompa(Sk: SkiaApi, c: SkCanvas, M: Medidas, f: Figura, v: VivoCompa, e: EstiloCompa) {
  'worklet';
  const { cx, cy, R } = M;
  const { alto, giro } = rebotePaso(v, R);
  const pie = cy + R;

  // 1 · Sombrita: más chica y tenue cuanto más alto va.
  const lejos = lim01(alto / (R * 0.5));
  const sombra = pincel(Sk, '#000000', 0.38 * (1 - lejos * 0.5));
  sombra.setMaskFilter(Sk.MaskFilter.MakeBlur(BLUR, R * 0.1, true));
  const sw = R * 1.5 * (1 - lejos * 0.3);
  c.drawOval(Sk.XYWHRect(cx - sw / 2, pie + R * 0.2, sw, R * 0.3), sombra);

  c.save();
  c.translate(0, -alto);
  c.rotate(giro, cx, pie);
  // Respira: se estira y se ensancha apenas; la expresión la estira o la aplasta más.
  const est = f.estirar + (v.respira - 0.5) * 0.035;
  c.translate(cx, pie);
  c.scale(1 - est * 0.5, 1 + est);
  c.translate(-cx, -pie);

  // 2 · El aura dorada de AU-RA (late despacio; con la voz brilla más).
  if (e.aura) {
    const fuerza = 0.2 + 0.1 * v.latido + 0.25 * lim01(v.voz);
    const aura = Sk.Paint();
    aura.setAntiAlias(true);
    aura.setShader(Sk.Shader.MakeRadialGradient(Sk.Point(cx, cy), R * 1.7, [col(Sk, e.main, fuerza), col(Sk, e.main, fuerza * 0.35), col(Sk, e.main, 0)], [0.45, 0.72, 1], CLAMP));
    c.drawCircle(cx, cy, R * 1.7, aura);
    const aro = pincel(Sk, e.hi, 0.18 + 0.12 * v.latido, Math.max(1, R * 0.035));
    aro.setMaskFilter(Sk.MaskFilter.MakeBlur(BLUR, R * 0.04, true));
    c.drawCircle(cx, cy, R * (1.2 + 0.03 * v.latido), aro);
  }

  // 3 · El anillo que late con tu voz (escuchando).
  if (f.halo > 0.01) {
    const oido = lim01(v.oido);
    const halo = pincel(Sk, e.main, f.halo * (0.3 + 0.6 * oido), Math.max(1.5, R * (0.05 + 0.05 * oido)));
    c.drawCircle(cx, cy, R * (1.14 + 0.2 * oido), halo);
  }

  // 4 · Piecitos: uno arriba y otro abajo al caminar.
  for (let i = 0; i < 2; i++) {
    const lado = i === 0 ? -1 : 1;
    const sube = Math.max(0, Math.sin(v.paso * Math.PI * 2 + i * Math.PI)) * R * 0.2 * v.caminando;
    const px = cx + lado * R * 0.4 + v.dir * R * 0.05 * v.caminando;
    const py = pie - R * 0.14 - sube;
    const rect = Sk.XYWHRect(px - R * 0.23, py - R * 0.13, R * 0.46, R * 0.28);
    c.drawOval(rect, pincel(Sk, e.cuerpoLuz, 1));
    c.drawOval(rect, pincel(Sk, e.main, 0.55, Math.max(1, R * 0.04)));
  }

  // 5 · El cuerpo: vidrio oscuro con luz arriba a la izquierda y el borde del color del avatar.
  const cuerpo = Sk.Paint();
  cuerpo.setAntiAlias(true);
  cuerpo.setShader(Sk.Shader.MakeRadialGradient(Sk.Point(cx - R * 0.35, cy - R * 0.45), R * 1.6, [col(Sk, e.cuerpoLuz, 1), col(Sk, e.cuerpo, 1)], [0, 1], CLAMP));
  const cuerpoRect = Sk.XYWHRect(cx - R * 1.04, cy - R, R * 2.08, R * 2);
  c.drawOval(cuerpoRect, cuerpo);
  const resplandor = pincel(Sk, e.main, 0.35, R * 0.08);
  resplandor.setMaskFilter(Sk.MaskFilter.MakeBlur(BLUR, R * 0.08, true));
  c.drawOval(cuerpoRect, resplandor);
  c.drawOval(cuerpoRect, pincel(Sk, e.main, 0.7, Math.max(1.2, R * 0.045)));
  c.drawOval(Sk.XYWHRect(cx - R * 0.62, cy - R * 0.82, R * 0.62, R * 0.32), pincel(Sk, '#FFFFFF', 0.1));

  // La mirada: la de la expresión, la del dedo, y un poco hacia donde camina.
  const gx = lim1(f.miradaX * (1 - v.dedo) + v.dedoX * v.dedo + v.dir * 0.35 * v.caminando);
  const gy = lim1(f.miradaY * (1 - v.dedo) + v.dedoY * v.dedo);

  // 6 · Rubor.
  if (f.rubor > 0.01) {
    const rub = pincel(Sk, e.rubor, 0.42 * f.rubor);
    rub.setMaskFilter(Sk.MaskFilter.MakeBlur(BLUR, R * 0.06, true));
    for (const lado of [-1, 1]) c.drawOval(Sk.XYWHRect(cx + lado * R * 0.6 - R * 0.17, cy + R * 0.12, R * 0.34, R * 0.18), rub);
  }

  if (!e.retrato) {
    const r = R * 0.25;
    const ey = cy - R * 0.14 + gy * R * 0.05;
    const exL = cx - R * 0.37 + gx * R * 0.07;
    const exR = cx + R * 0.37 + gx * R * 0.07;

    // 7 · Ojos.
    ojo(Sk, c, exL, ey, r, f, v, e, gx, gy, -1);
    ojo(Sk, c, exR, ey, r, f, v, e, gx, gy, 1);

    // 8 · Cejas: enojo (bajan al centro) o pena (suben al centro).
    const ceja = Math.max(f.ceno, f.pena);
    if (ceja > 0.01) {
      for (const lado of [-1, 1]) {
        const ex = lado === -1 ? exL : exR;
        const afuera = ey - r * 1.45 - r * 0.25 * f.ceno + r * 0.3 * f.pena;
        const adentro = ey - r * 1.45 + r * 0.45 * f.ceno - r * 0.3 * f.pena;
        const p = Sk.Path.Make();
        p.moveTo(ex + lado * r * 0.95, afuera);
        p.lineTo(ex - lado * r * 0.7, adentro);
        c.drawPath(p, pincel(Sk, e.main, ceja, r * 0.34));
      }
    }

    // 9 · La boquita: una curva cerrada, o abierta con la voz (en «D» si sonríe).
    const mx = cx + gx * R * 0.05;
    const my = cy + R * 0.4;
    const w = R * 0.4 * f.ancho;
    const abierta = lim01(f.abierta + lim01(v.voz) * 0.95);
    // Con la voz, la forma del visema: la «o» y la «u» juntan la boca; la «e», la «i» y la «s» la estiran.
    const forma = 1 - 0.38 * lim01(v.redonda ?? 0) + 0.22 * lim01(v.ancha ?? 0);
    const alto = 1 + 0.18 * lim01(v.redonda ?? 0) - 0.22 * lim01(v.ancha ?? 0);
    const curva = f.boca * R * 0.13;
    if (abierta < 0.06) {
      const p = Sk.Path.Make();
      p.moveTo(mx - w / 2, my - curva * 0.4);
      p.quadTo(mx, my + curva * 1.2, mx + w / 2, my - curva * 0.4);
      c.drawPath(p, pincel(Sk, e.main, 0.95, Math.max(1.4, R * 0.075)));
    } else {
      const h = R * (0.08 + 0.3 * abierta) * alto;
      const hueco = Sk.Path.Make();
      if (f.boca > 0.35) {
        const ww = w * (0.85 + 0.15 * abierta) * forma;
        hueco.moveTo(mx - ww / 2, my - h * 0.2);
        hueco.quadTo(mx, my - h * 0.05, mx + ww / 2, my - h * 0.2);
        hueco.cubicTo(mx + ww / 2, my + h * 1.1, mx - ww / 2, my + h * 1.1, mx - ww / 2, my - h * 0.2);
        hueco.close();
      } else {
        const ww = w * (0.6 + 0.3 * abierta) * forma;
        hueco.addOval(Sk.XYWHRect(mx - ww / 2, my - h * 0.35, ww, h));
      }
      c.drawPath(hueco, pincel(Sk, '#120C08', 1));
      if (abierta > 0.35) {
        c.save();
        c.clipPath(hueco, INTERSECCION, true);
        c.drawOval(Sk.XYWHRect(mx - w * 0.25, my + h * 0.3, w * 0.5, h * 0.7), pincel(Sk, e.rubor, 0.75));
        c.restore();
      }
      c.drawPath(hueco, pincel(Sk, e.main, 0.9, Math.max(1.2, R * 0.05)));
    }
  }

  // 10 · Los zzz que suben (dormida).
  if (f.zzz > 0.01) {
    for (let i = 0; i < 3; i++) {
      const t = (v.fase + i / 3) % 1;
      const s = R * (0.14 + 0.14 * t);
      const x = cx + R * 0.72 + t * R * 0.45;
      const y = cy - R * 0.85 - t * R * 1.0;
      const z = Sk.Path.Make();
      z.moveTo(x, y);
      z.lineTo(x + s, y);
      z.lineTo(x, y + s);
      z.lineTo(x + s, y + s);
      const a = f.zzz * (t < 0.15 ? t / 0.15 : 1 - (t - 0.15) / 0.85);
      c.drawPath(z, pincel(Sk, e.hi, a, Math.max(1.2, R * 0.06)));
    }
  }

  // 11 · Los tres puntitos de pensar.
  if (f.puntos > 0.01) {
    for (let i = 0; i < 3; i++) {
      const brinca = Math.max(0, Math.sin((v.fase * 3 - i * 0.33) * Math.PI * 2));
      c.drawCircle(cx + R * 0.55 + i * R * 0.3, cy - R * 1.22 - brinca * R * 0.12, R * 0.075 * (1 + 0.35 * brinca), pincel(Sk, e.hi, f.puntos * (0.55 + 0.45 * brinca)));
    }
  }
  c.restore();

  // 12 · La palomita ✔ (se dibuja de un trazo y luego se desvanece).
  if (v.palomita > 0.001) {
    const traza = lim01(v.palomita);
    const se = v.palomita > 1 ? lim01(2 - v.palomita) : 1;
    const pop = traza < 0.3 ? 0.6 + (traza / 0.3) * 0.55 : 1.15 - Math.min(0.15, (traza - 0.3) * 0.5);
    const bx = cx + R * 0.82;
    const by = cy - R * 0.82 - alto;
    const br = R * 0.36 * pop;
    c.drawCircle(bx, by, br, pincel(Sk, '#6FA56A', se));
    c.drawCircle(bx, by, br, pincel(Sk, '#FFFFFF', 0.85 * se, Math.max(1, R * 0.04)));
    const ch = Sk.Path.Make();
    ch.moveTo(bx - br * 0.45, by + br * 0.02);
    ch.lineTo(bx - br * 0.1, by + br * 0.36);
    ch.lineTo(bx + br * 0.5, by - br * 0.34);
    const parte = traza < 0.25 ? 0 : (traza - 0.25) / 0.75;
    if (parte > 0.01) {
      if (parte < 0.999) ch.trim(0, parte, false);
      c.drawPath(ch, pincel(Sk, '#FFFFFF', se, Math.max(1.4, R * 0.09)));
    }
  }
}

/** Graba un cuadro. */
export function grabarCompa(Sk: SkiaApi, M: Medidas, f: Figura, v: VivoCompa, e: EstiloCompa) {
  'worklet';
  const rec = Sk.PictureRecorder();
  const c = rec.beginRecording(Sk.XYWHRect(0, 0, M.S, M.S));
  pintarCompa(Sk, c, M, f, v, e);
  return rec.finishRecordingAsPicture();
}

export function grabarVacioCompa(Sk: SkiaApi) {
  'worklet';
  const rec = Sk.PictureRecorder();
  rec.beginRecording(Sk.XYWHRect(0, 0, 1, 1));
  return rec.finishRecordingAsPicture();
}
