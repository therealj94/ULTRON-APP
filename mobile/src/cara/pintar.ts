/**
 * El dibujo de la cara de anillos, con la API imperativa de Skia.
 *
 * Una sola función, `pintar`, recibe un lienzo, la geometría del momento y el tema. La usa CaraSkia
 * dentro de un worklet (graba un SkPicture por cuadro, en el hilo de la interfaz) y la usa la prueba
 * visual en Node (scripts/qa/cara-skia.mjs) con CanvasKit. Así lo que se revisa en la computadora es
 * exactamente lo que dibuja el teléfono.
 *
 * `Skia` entra como parámetro para no depender de cómo se carga el módulo en cada sitio. Los enums
 * van como números (son los mismos en JSI y en CanvasKit): TileMode.Clamp=0, BlurStyle.Normal=0,
 * ClipOp.Difference=0 / Intersect=1, PaintStyle.Fill=0 / Stroke=1, StrokeCap.Butt=0 / Round=1.
 */
import type { SkCanvas, SkPaint, Skia } from '@shopify/react-native-skia';
import type { Geometria, Ojo, Tema } from './estados';
import { mezclarHex } from './estados';

type SkiaApi = typeof Skia;

const CLAMP = 0;
const BLUR_NORMAL = 0;
const CLIP_INTERSECCION = 1;
const TRAZO = 1;
const PUNTA_PLANA = 0;
const PUNTA_REDONDA = 1;
const BORRAR = 8; // BlendMode.DstOut

/** Un color #RRGGBB con opacidad. */
function col(Sk: SkiaApi, hex: string, a: number) {
  'worklet';
  const c = Sk.Color(hex);
  c[3] = a < 0 ? 0 : a > 1 ? 1 : a;
  return c;
}

function pincel(Sk: SkiaApi): SkPaint {
  'worklet';
  const p = Sk.Paint();
  p.setAntiAlias(true);
  return p;
}

function ojo(Sk: SkiaApi, c: SkCanvas, o: Ojo, g: Geometria, t: Tema, main: string, hi: string, deep: string) {
  'worklet';
  const d = g.L.d;
  const anillo = g.L.anillo;
  const r = d / 2;
  const inner = r - anillo;

  // Párpados: el ojo va en su propia capa y los párpados se BORRAN de ella con borde suave (DstOut).
  // Así el fondo con degradado nunca se toca y el resplandor no queda cortado a cuchillo.
  const conParpados = g.tapa > 0.001 || g.sonrisa > 0.001;
  if (conParpados) c.saveLayer();
  c.save();
  // Parpadeo: el ojo se aplasta sobre su centro.
  c.translate(o.x, o.y);
  c.scale(1, g.parpadeo);
  c.translate(-o.x, -o.y);

  // 1 · Resplandor: la capa más profunda, se mueve poco al inclinar.
  const bloom = pincel(Sk);
  bloom.setShader(
    Sk.Shader.MakeRadialGradient(Sk.Point(o.x + o.bx, o.y + o.by), d * 0.85, [col(Sk, main, 0.16 * g.luz), col(Sk, main, 0.05 * g.luz), col(Sk, main, 0)], [0, 0.45, 1], CLAMP),
  );
  c.drawCircle(o.x + o.bx, o.y + o.by, d * 0.85, bloom);

  const ax = o.x + o.ax;
  const ay = o.y + o.ay;

  // 2 · Halo fino; late al escuchar.
  const halo = pincel(Sk);
  halo.setStyle(TRAZO);
  halo.setStrokeWidth(Math.max(1, d * 0.008));
  halo.setColor(col(Sk, main, (0.22 + 0.4 * g.halo) * g.luz));
  c.drawCircle(ax, ay, r * 1.22 * (1 + g.halo * 0.03), halo);

  // 3 · Anillo: resplandor, pista y arco (lleno, barra de avance o arco que gira).
  const rr = r - anillo / 2;
  const oval = Sk.XYWHRect(ax - rr, ay - rr, rr * 2, rr * 2);
  const brillo = pincel(Sk);
  brillo.setStyle(TRAZO);
  brillo.setStrokeWidth(anillo);
  brillo.setColor(col(Sk, main, 0.55 * g.luz));
  brillo.setMaskFilter(Sk.MaskFilter.MakeBlur(BLUR_NORMAL, d * 0.07, true));
  const arco = Sk.Path.Make();
  if (g.arcoBarrido >= 359.5) arco.addCircle(ax, ay, rr);
  else arco.addArc(oval, g.arcoInicio, Math.max(0.5, g.arcoBarrido));
  c.drawPath(arco, brillo);
  if (g.pistaAlfa > 0) {
    const pista = pincel(Sk);
    pista.setStyle(TRAZO);
    pista.setStrokeWidth(anillo);
    pista.setColor(col(Sk, main, g.pistaAlfa));
    c.drawCircle(ax, ay, rr, pista);
  }
  const tubo = pincel(Sk);
  tubo.setStyle(TRAZO);
  tubo.setStrokeWidth(anillo);
  tubo.setStrokeCap(g.arcoBarrido >= 359.5 ? PUNTA_PLANA : PUNTA_REDONDA);
  // Degradado de barrido: brillo arriba a la izquierda, como un tubo de luz con volumen.
  tubo.setShader(
    Sk.Shader.MakeSweepGradient(ax, ay, [col(Sk, main, 1), col(Sk, deep, 1), col(Sk, main, 1), col(Sk, hi, 1), col(Sk, main, 1)], [0, 0.22, 0.45, 0.63, 1], CLAMP),
  );
  c.drawPath(arco, tubo);

  // 4 · Pozo.
  const pozo = pincel(Sk);
  pozo.setShader(
    Sk.Shader.MakeRadialGradient(Sk.Point(ax, ay - inner * 0.28), inner * 1.15, [Sk.Color('#0D2830'), Sk.Color('#06171C'), Sk.Color('#020A0D')], [0, 0.45, 0.8], CLAMP),
  );
  c.drawCircle(ax, ay, inner, pozo);
  const borde = pincel(Sk);
  borde.setStyle(TRAZO);
  borde.setStrokeWidth(Math.max(1, d * 0.02));
  borde.setColor(Sk.Color('#01070A'));
  c.drawCircle(ax, ay, inner - d * 0.01, borde);

  // Todo lo de dentro se queda dentro del pozo.
  c.save();
  const dentro = Sk.Path.Make();
  dentro.addCircle(ax, ay, inner - d * 0.005);
  c.clipPath(dentro, CLIP_INTERSECCION, true);

  // 5 · Pupila: halo, cuerpo con núcleo caliente y brillo.
  const pg = pincel(Sk);
  pg.setColor(col(Sk, main, 0.5 * g.luz));
  pg.setMaskFilter(Sk.MaskFilter.MakeBlur(BLUR_NORMAL, o.pr * 0.55, true));
  c.drawCircle(o.px, o.py, o.pr * 1.25, pg);
  const pupila = pincel(Sk);
  pupila.setShader(
    Sk.Shader.MakeRadialGradient(Sk.Point(o.px - o.pr * 0.24, o.py - o.pr * 0.32), o.pr * 1.35, [col(Sk, hi, 1), col(Sk, main, 1), col(Sk, deep, 1)], [0, 0.42, 1], CLAMP),
  );
  c.drawCircle(o.px, o.py, o.pr, pupila);
  if (g.luz > 0.4) {
    const glint = pincel(Sk);
    glint.setColor(col(Sk, '#FFFFFF', 0.85 * g.luz));
    c.drawCircle(o.px - o.pr * 0.36, o.py - o.pr * 0.4, o.pr * 0.26, glint);
  }

  // 6 · Reflejo de vidrio: un arco suave arriba, como una lente.
  const vidrio = pincel(Sk);
  vidrio.setShader(
    Sk.Shader.MakeLinearGradient(Sk.Point(ax, ay - inner), Sk.Point(ax, ay - inner * 0.15), [col(Sk, '#FFFFFF', 0.13), col(Sk, '#FFFFFF', 0)], null, CLAMP),
  );
  c.drawOval(Sk.XYWHRect(ax - inner * 0.72, ay - inner * 0.95, inner * 1.44, inner * 0.8), vidrio);
  c.restore();

  c.restore();
  if (conParpados) {
    const goma = pincel(Sk);
    goma.setBlendMode(BORRAR);
    if (g.tapa > 0.001) {
      goma.setMaskFilter(Sk.MaskFilter.MakeBlur(BLUR_NORMAL, d * 0.012, true));
      c.drawCircle(o.x, o.tapaY, o.tapaR, goma);
    }
    if (g.sonrisa > 0.001) {
      goma.setMaskFilter(Sk.MaskFilter.MakeBlur(BLUR_NORMAL, d * 0.035, true));
      c.drawCircle(o.x, o.sonrisaY, o.sonrisaR, goma);
    }
    c.restore();
  }
}

export function pintar(Sk: SkiaApi, c: SkCanvas, g: Geometria, t: Tema) {
  'worklet';
  const L = g.L;
  // Sin red: el color se apaga hacia el gris; dormida, a medias.
  const main = mezclarHex(t.gris, t.main, g.luz);
  const hi = mezclarHex(t.gris, t.hi, g.luz);
  const deep = mezclarHex(t.gris, t.deep, g.luz);

  // Fondo: casi negro con un poco de su color en el centro, como si ella iluminara la mesa.
  const fondo = pincel(Sk);
  fondo.setShader(
    Sk.Shader.MakeRadialGradient(Sk.Point(L.cx, L.cy - L.H * 0.02), Math.max(L.W, L.H) * 0.75, [Sk.Color(t.fondo), Sk.Color('#05090C'), Sk.Color('#000000')], [0, 0.56, 1], CLAMP),
  );
  c.drawRect(Sk.XYWHRect(0, 0, L.W, L.H), fondo);

  // Reflejo en la mesa.
  const piso = pincel(Sk);
  for (const x of [L.exL, L.exR]) {
    const y = L.bocaY + L.d * 0.55;
    piso.setShader(Sk.Shader.MakeRadialGradient(Sk.Point(x, y), L.d * 0.5, [col(Sk, main, 0.12 * g.luz), col(Sk, main, 0)], [0, 1], CLAMP));
    c.drawOval(Sk.XYWHRect(x - L.d * 0.5, y - L.d * 0.2, L.d, L.d * 0.4), piso);
  }

  // Respiración: la cara entera crece un poco alrededor de su centro.
  c.save();
  c.translate(L.cx, L.cy);
  c.scale(g.escala, g.escala);
  c.translate(-L.cx, -L.cy);

  ojo(Sk, c, g.izq, g, t, main, hi, deep);
  ojo(Sk, c, g.der, g, t, main, hi, deep);

  // «Te necesita»: un punto ámbar arriba del ojo derecho.
  if (g.punto > 0.01) {
    const o = g.der;
    const pr = L.d * 0.05;
    const px = o.x + L.d * 0.38;
    const py = o.y - L.d * 0.38;
    const glow = pincel(Sk);
    glow.setColor(col(Sk, '#F3A96B', 0.6 * g.punto));
    glow.setMaskFilter(Sk.MaskFilter.MakeBlur(BLUR_NORMAL, pr * 1.2, true));
    c.drawCircle(px, py, pr * 1.6, glow);
    const punto = pincel(Sk);
    punto.setColor(col(Sk, '#F3A96B', g.punto));
    c.drawCircle(px, py, pr, punto);
  }

  // Boca: una línea curva que se vuelve un óvalo cuando habla.
  const w = L.bocaW;
  const bx = L.cx;
  const by = L.bocaY;
  const abierta = g.bocaAbierta < 0 ? 0 : g.bocaAbierta > 1 ? 1 : g.bocaAbierta;
  if (abierta > 0.03) {
    const hh = L.d * 0.12 * abierta;
    const ov = pincel(Sk);
    ov.setColor(col(Sk, main, 0.95));
    const bg = pincel(Sk);
    bg.setColor(col(Sk, main, 0.45));
    bg.setMaskFilter(Sk.MaskFilter.MakeBlur(BLUR_NORMAL, L.d * 0.04, true));
    const rect = Sk.XYWHRect(bx - w * 0.33, by - hh / 2, w * 0.66, Math.max(2, hh));
    c.drawOval(rect, bg);
    c.drawOval(rect, ov);
  } else {
    const curva = Sk.Path.Make();
    curva.moveTo(bx - w / 2, by);
    curva.quadTo(bx, by + g.boca * L.d * 0.12, bx + w / 2, by);
    const bg = pincel(Sk);
    bg.setStyle(TRAZO);
    bg.setStrokeWidth(Math.max(2, L.d * 0.014) * 2.5);
    bg.setStrokeCap(PUNTA_REDONDA);
    bg.setColor(col(Sk, main, 0.35));
    bg.setMaskFilter(Sk.MaskFilter.MakeBlur(BLUR_NORMAL, L.d * 0.03, true));
    c.drawPath(curva, bg);
    const linea = pincel(Sk);
    linea.setStyle(TRAZO);
    linea.setStrokeWidth(Math.max(2, L.d * 0.014));
    linea.setStrokeCap(PUNTA_REDONDA);
    linea.setColor(col(Sk, main, 0.95));
    c.drawPath(curva, linea);
  }
  c.restore();
}

/** Graba un cuadro como SkPicture (lo que pinta el componente <Picture>). */
export function grabar(Sk: SkiaApi, g: Geometria, t: Tema) {
  'worklet';
  const rec = Sk.PictureRecorder();
  const c = rec.beginRecording(Sk.XYWHRect(0, 0, g.L.W, g.L.H));
  pintar(Sk, c, g, t);
  return rec.finishRecordingAsPicture();
}

/** Un cuadro vacío: lo que se muestra si el dibujo falló, mientras la pantalla cambia a la cara de siempre. */
export function grabarVacio(Sk: SkiaApi) {
  'worklet';
  const rec = Sk.PictureRecorder();
  rec.beginRecording(Sk.XYWHRect(0, 0, 1, 1));
  return rec.finishRecordingAsPicture();
}

