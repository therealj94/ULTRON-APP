/**
 * LOS BLASTERS, dibujados con Skia en un cuadro: cada disparo sale de un borde con un fogonazo, cruza la
 * pantalla como un trazo rojo brillante (resplandor difuso, estela tenue y núcleo casi blanco) y revienta
 * en el borde de enfrente con un destello y chispas que saltan hacia adentro y caen. La sacudida de la
 * pantalla la pone CapaEfectos (escena.ts, `sacudida`). Con «reducir movimiento» los disparos no vuelan:
 * son trazos quietos que aparecen y se van despacio (escena.ts, `estadoRayo`).
 *
 * Worklet, como el sable (espadaJedi.ts): el mismo dibujo en el teléfono y en scripts/qa/efectos-avatar.ts.
 */
import type { SkCanvas } from '@shopify/react-native-skia';
import { COLOR_RAYO, IMPACTO_MS, estadoRayo, type PlanBlasters } from './escena';
import { brilloRedondo, col, difuso, pincel, type SkiaApi } from './pincel';

/** Lo que caen las chispas (px/ms²). */
const GRAVEDAD = 0.0007;

export function pintarBlasters(Sk: SkiaApi, c: SkCanvas, p: PlanBlasters, t: number) {
  'worklet';
  if (t < 0 || t > p.dur) return;
  const g = p.grosor;
  const A = p.alfa;
  for (let i = 0; i < p.rayos.length; i++) {
    const r = p.rayos[i];
    const s = estadoRayo(p, r, t);

    // El fogonazo de salida, en el borde de donde disparan.
    if (s.fogonazo > 0.01) {
      const rf = p.destello * (0.7 + 0.5 * (1 - s.fogonazo));
      c.drawCircle(r.x0, r.y0, rf, brilloRedondo(Sk, r.x0, r.y0, rf, COLOR_RAYO.rayo, 0.95 * s.fogonazo * A, '#FFF6D8'));
    }

    // El disparo: estela, resplandor y núcleo.
    if (s.vuelo > 0.01) {
      const a = s.vuelo * A;
      const ex = s.cx - (s.hx - s.cx) * 1.4;
      const ey = s.cy - (s.hy - s.cy) * 1.4;
      if (!p.reducido) {
        const estela = pincel(Sk, g * 2.2);
        estela.setColor(col(Sk, COLOR_RAYO.rayo, 0.22 * a));
        difuso(Sk, estela, g * 1.6);
        c.drawLine(ex, ey, s.cx, s.cy, estela);
      }
      const bloom = pincel(Sk, g * 7);
      bloom.setColor(col(Sk, COLOR_RAYO.rayo, 0.5 * a));
      difuso(Sk, bloom, g * 3.2);
      c.drawLine(s.cx, s.cy, s.hx, s.hy, bloom);
      const brillo = pincel(Sk, g * 2.4);
      brillo.setColor(col(Sk, COLOR_RAYO.rayo, 0.9 * a));
      difuso(Sk, brillo, g * 0.7);
      c.drawLine(s.cx, s.cy, s.hx, s.hy, brillo);
      const nucleo = pincel(Sk, g);
      nucleo.setColor(col(Sk, COLOR_RAYO.nucleo, a));
      c.drawLine(s.cx, s.cy, s.hx, s.hy, nucleo);
    }

    // El impacto en el borde de enfrente: destello y chispas.
    if (s.impacto >= 0) {
      if (p.reducido) {
        const rq = p.destello * 0.9;
        c.drawCircle(r.x1, r.y1, rq, brilloRedondo(Sk, r.x1, r.y1, rq, COLOR_RAYO.rayo, 0.45 * s.vuelo * A));
        continue;
      }
      const q = s.impacto;
      const ri = p.destello * (1 + 0.9 * q);
      c.drawCircle(r.x1, r.y1, ri, brilloRedondo(Sk, r.x1, r.y1, ri, COLOR_RAYO.rayo, (1 - q) * (1 - q) * A, '#FFF8E6'));
      // Un anillo de choque que se abre y se apaga.
      const choque = pincel(Sk, Math.max(1, g * 0.9) * (1 - q));
      choque.setColor(col(Sk, COLOR_RAYO.chispa, 0.8 * (1 - q) * A));
      difuso(Sk, choque, g * 0.4);
      c.drawCircle(r.x1, r.y1, p.destello * (0.4 + 1.4 * q), choque);
      const ms = q * IMPACTO_MS;
      const ch = r.chispas;
      for (let k = 0; k + 2 < ch.length; k += 3) {
        const ang = ch[k];
        const v = ch[k + 1];
        const lc = ch[k + 2] * (1 - q * 0.6);
        const x = r.x1 + Math.cos(ang) * v * ms;
        const y = r.y1 + Math.sin(ang) * v * ms + GRAVEDAD * ms * ms * 0.5;
        // La dirección de la chispa en este instante (con la caída).
        const vx = Math.cos(ang) * v;
        const vy = Math.sin(ang) * v + GRAVEDAD * ms;
        const vn = Math.max(0.0001, Math.sqrt(vx * vx + vy * vy));
        const brilloCh = pincel(Sk, Math.max(2, g * 2));
        brilloCh.setColor(col(Sk, COLOR_RAYO.rayo, 0.5 * (1 - q) * A));
        difuso(Sk, brilloCh, g);
        c.drawLine(x - (vx / vn) * lc, y - (vy / vn) * lc, x, y, brilloCh);
        const chispa = pincel(Sk, Math.max(1, g * 0.75));
        chispa.setColor(col(Sk, q < 0.4 ? '#FFF3D6' : COLOR_RAYO.chispa, (1 - q * q) * A));
        c.drawLine(x - (vx / vn) * lc, y - (vy / vn) * lc, x, y, chispa);
      }
    }
  }
}
