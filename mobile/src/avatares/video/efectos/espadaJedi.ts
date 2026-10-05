/**
 * EL SABLE DE LUZ, dibujado con Skia en un cuadro: la estela de los tajos detrás, la hoja en tres capas
 * (un resplandor ancho y difuso del color del avatar, el brillo y el núcleo casi blanco), el destello al
 * encenderse y la empuñadura metálica encima, en la mano. La geometría de cada instante es de escena.ts.
 *
 * Es un worklet: corre en el hilo de la interfaz dentro del cuadro de CapaEfectos, y en la computadora
 * con CanvasKit (scripts/qa/efectos-avatar.ts), que pinta exactamente lo mismo.
 */
import type { SkCanvas } from '@shopify/react-native-skia';
import { estadoEspada, puntasEspada, type PlanEspada } from './escena';
import { CLAMP, RELLENO, brilloRedondo, col, difuso, pincel, type SkiaApi } from './pincel';

export function pintarEspada(Sk: SkiaApi, c: SkCanvas, p: PlanEspada, t: number) {
  'worklet';
  const s = estadoEspada(p, t);
  if (!s.visible) return;
  const g = p.grosor;
  const largo = p.largo * s.hoja;

  // 1 · La estela: un abanico detrás del tajo, del color de la hoja, que se apaga hacia lo más viejo
  //     (un degradado que gira con el sable, centrado en la mano) y con los bordes difusos. Solo si se
  //     mueve rápido; desde media hoja hacia la punta, para no tapar la mano ni la cara.
  const n = s.estela.length;
  if (s.fuerzaEstela > 0.05 && n) {
    const viejo = s.estela[n - 1];
    const r1 = p.mango * 0.55 + largo;
    const r0 = p.mango * 0.55 + largo * 0.42;
    const cx = p.pivote.x;
    const cy = p.pivote.y;
    const abanico = Sk.Path.Make();
    abanico.moveTo(cx + Math.sin(s.ang) * r1, cy - Math.cos(s.ang) * r1);
    for (let k = 0; k < n; k++) abanico.lineTo(cx + Math.sin(s.estela[k]) * r1, cy - Math.cos(s.estela[k]) * r1);
    for (let k = n - 1; k >= 0; k--) abanico.lineTo(cx + Math.sin(s.estela[k]) * r0, cy - Math.cos(s.estela[k]) * r0);
    abanico.lineTo(cx + Math.sin(s.ang) * r0, cy - Math.cos(s.ang) * r0);
    abanico.close();
    // El ángulo del sable (0 arriba, horario) en los grados del degradado de barrido (0 a la derecha, 0..360).
    const grados = (a: number) => {
      'worklet';
      const d = (a * 180) / Math.PI - 90;
      return ((d % 360) + 360) % 360;
    };
    const g0 = grados(Math.min(viejo, s.ang));
    const g1 = grados(Math.max(viejo, s.ang));
    const fuerte = col(Sk, p.color, 0.34 * s.fuerzaEstela * s.alfaHoja);
    const nada = col(Sk, p.color, 0);
    const relleno = pincel(Sk);
    relleno.setStyle(RELLENO);
    if (g1 - g0 > 0.5) relleno.setShader(Sk.Shader.MakeSweepGradient(cx, cy, s.ang >= viejo ? [nada, fuerte] : [fuerte, nada], [0, 1], CLAMP, null, 0, g0, g1));
    else relleno.setColor(col(Sk, p.color, 0.15 * s.fuerzaEstela * s.alfaHoja));
    difuso(Sk, relleno, g * 1.6);
    c.drawPath(abanico, relleno);
  }

  // 2 · La hoja: resplandor, brillo y núcleo.
  if (s.hoja > 0.001 && s.alfaHoja > 0.001) {
    const q = puntasEspada(p, s.ang, s.hoja);
    const a = s.alfaHoja;
    // Un resplandor ancho y difuso, el brillo del color, la hoja de color y el núcleo casi blanco.
    const capa = (ancho: number, hex: string, alfa: number, sigma: number) => {
      'worklet';
      const pz = pincel(Sk, ancho);
      pz.setColor(col(Sk, hex, alfa));
      difuso(Sk, pz, sigma);
      c.drawLine(q.bx, q.by, q.px, q.py, pz);
    };
    capa(g * 11, p.color, 0.32 * s.brillo * a, g * 5);
    capa(g * 4.2, p.color, 0.8 * s.brillo * a, g * 1.7);
    capa(g * 2.1, p.color, a, g * 0.5);
    capa(g * 1.15, p.nucleo, a, g * 0.2);
    // 3 · El destello al encenderse, en la boca de la empuñadura.
    if (s.destello > 0.01) c.drawCircle(q.bx, q.by, g * 10 * s.destello, brilloRedondo(Sk, q.bx, q.by, g * 10 * s.destello, p.color, 0.85 * s.destello * a));
  }

  // 4 · La empuñadura, encima de la base de la hoja, girada con ella.
  if (s.alfaMango > 0.001) pintarMango(Sk, c, p, s.ang, s.alfaMango);
}

function pintarMango(Sk: SkiaApi, c: SkCanvas, p: PlanEspada, ang: number, alfa: number) {
  'worklet';
  const M = p.mango;
  const w = p.anchoMango;
  c.save();
  c.translate(p.pivote.x, p.pivote.y);
  c.rotate((ang * 180) / Math.PI, 0, 0);
  // En este marco la hoja sale hacia -y; el pomo queda en +y.
  const metal = (x0: number, ancho: number, oscuro: boolean) => {
    'worklet';
    const m = pincel(Sk);
    const cols = oscuro ? ['#17191C', '#6C737C', '#B9C0C9', '#4A5058', '#141618'] : ['#2A2D32', '#9BA2AC', '#EEF1F5', '#7D848E', '#25282C'];
    m.setShader(Sk.Shader.MakeLinearGradient(Sk.Point(x0, 0), Sk.Point(x0 + ancho, 0), cols.map((h) => col(Sk, h, alfa)), [0, 0.28, 0.45, 0.72, 1], CLAMP));
    return m;
  };
  // Sombra suave debajo, para que se despegue del pelaje o la chaqueta.
  const sombra = pincel(Sk);
  sombra.setColor(col(Sk, '#000000', 0.35 * alfa));
  difuso(Sk, sombra, w * 0.5);
  c.drawRRect(Sk.RRectXY(Sk.XYWHRect(-w * 0.55, -M * 0.53, w * 1.1, M), w * 0.3, w * 0.3), sombra);
  // El cuerpo.
  c.drawRRect(Sk.RRectXY(Sk.XYWHRect(-w / 2, -M * 0.42, w, M * 0.84), w * 0.18, w * 0.18), metal(-w / 2, w, false));
  // El agarre: anillos oscuros.
  const anillo = pincel(Sk);
  anillo.setColor(col(Sk, '#121417', 0.92 * alfa));
  for (let i = 0; i < 5; i++) c.drawRect(Sk.XYWHRect(-w / 2, M * (0.02 + i * 0.075), w, M * 0.036), anillo);
  // El botón.
  const boton = pincel(Sk);
  boton.setColor(col(Sk, '#E0313F', alfa));
  c.drawRRect(Sk.RRectXY(Sk.XYWHRect(w * 0.12, -M * 0.3, w * 0.32, M * 0.09), w * 0.08, w * 0.08), boton);
  // La boca (más ancha) y el pomo.
  c.drawRRect(Sk.RRectXY(Sk.XYWHRect(-w * 0.64, -M * 0.56, w * 1.28, M * 0.15), w * 0.12, w * 0.12), metal(-w * 0.64, w * 1.28, true));
  const borde = pincel(Sk, Math.max(0.8, w * 0.08));
  borde.setColor(col(Sk, '#D9DEE5', 0.7 * alfa));
  c.drawLine(-w * 0.6, -M * 0.555, w * 0.6, -M * 0.555, borde);
  c.drawRRect(Sk.RRectXY(Sk.XYWHRect(-w * 0.56, M * 0.4, w * 1.12, M * 0.08), w * 0.25, w * 0.25), metal(-w * 0.56, w * 1.12, true));
  c.restore();
}
