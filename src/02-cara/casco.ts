/**
 * EL CASCO MINERO DE DR ELECTRUM.
 *
 * Solo Electrum lo lleva (prop `casco` de FaceCanvas): AU-RA sigue con la cara limpia. Va en el
 * espacio de la cabeza —se inclina, rebota y respira con ella— y encima de las cejas, que llegan a
 * −1.6 R cuando se levantan: el ala empieza en −1.9 R para no taparlas nunca.
 *
 * La lámpara está viva: prende al despertar, late con la voz, barre de lado a lado cuando piensa y
 * se apaga dormido. Su destello se corre hacia donde miran los ojos, así la luz «apunta».
 */
import type { AnimationEngineState } from '../types';
import type { Escena, Theme, Vida } from './dibujo';
import { clamp } from './dibujo';

export type LuzCasco = {
  /** 0 apagada … 1 plena (puede pasar de 1 en un destello). */
  intensidad: number;
  /** −1..1: hacia dónde se corre el destello (sigue la mirada). */
  apunta: number;
};

/** Cuánta luz da la lámpara según lo que está haciendo la cara. */
export function luzDeLampara(E: Escena, V: Vida, lip: number, destello: number): number {
  const wake = clamp(V.wake, 0, 1);
  let base: number;
  if (E.face === 'SLEEPING') base = 0.06;
  else if (E.face === 'THINKING') base = 0.5 + 0.35 * Math.abs(Math.sin(E.t * 3.1));
  else if (E.face === 'SPEAKING' || E.face === 'SING') base = 0.82 + 0.3 * clamp(lip, 0, 1);
  else base = 0.78 + 0.06 * Math.sin(E.t * 1.3);
  return clamp(base * wake + destello * 0.7, 0, 1.4);
}

export function drawCasco(
  ctx: CanvasRenderingContext2D,
  R: number,
  theme: Theme,
  E: Escena,
  A: AnimationEngineState,
  luz: LuzCasco
) {
  // El casco va un pelo detrás de la cabeza en los rebotes: se lee como un objeto puesto, no pintado.
  const lag = clamp(A.bounce, -0.4, 0.4) * R * 0.12;
  const alaY = -1.88 * R + lag;
  const topeY = -4.05 * R + lag;
  const ancho = 2.62 * R; // media anchura de la copa
  const ala = 3.05 * R; // media anchura del ala

  ctx.save();

  // ── la copa ──
  const copa = new Path2D();
  copa.moveTo(-ancho, alaY);
  copa.bezierCurveTo(-ancho * 1.04, alaY - R * 1.55, -ancho * 0.58, topeY, 0, topeY);
  copa.bezierCurveTo(ancho * 0.58, topeY, ancho * 1.04, alaY - R * 1.55, ancho, alaY);
  copa.closePath();
  const g = ctx.createLinearGradient(0, topeY, 0, alaY);
  g.addColorStop(0, '#FFD27A');
  g.addColorStop(0.45, '#F5A623');
  g.addColorStop(1, '#B86A0C');
  ctx.fillStyle = g;
  ctx.shadowColor = 'rgba(255,174,59,0.35)';
  ctx.shadowBlur = R * 0.5;
  ctx.fill(copa);
  ctx.shadowBlur = 0;

  // Nervaduras: la del centro y dos laterales, como un casco de verdad.
  ctx.strokeStyle = 'rgba(255,236,190,0.55)';
  ctx.lineWidth = R * 0.12;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(0, topeY + R * 0.12);
  ctx.lineTo(0, alaY - R * 1.62);
  ctx.stroke();
  ctx.lineWidth = R * 0.07;
  ctx.strokeStyle = 'rgba(255,236,190,0.28)';
  for (const s of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(s * ancho * 0.42, topeY + R * 0.28);
    ctx.quadraticCurveTo(s * ancho * 0.72, alaY - R * 1.2, s * ancho * 0.74, alaY - R * 0.12);
    ctx.stroke();
  }

  // Brillo especular que se pasea despacio por la copa.
  const brillo = Math.sin(E.t * 0.55) * 0.5;
  ctx.save();
  ctx.clip(copa);
  const gb = ctx.createRadialGradient(ancho * (brillo - 0.15), topeY + R * 0.55, R * 0.05, ancho * (brillo - 0.15), topeY + R * 0.55, R * 1.6);
  gb.addColorStop(0, 'rgba(255,255,255,0.55)');
  gb.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = gb;
  ctx.fillRect(-ancho, topeY, ancho * 2, alaY - topeY);
  // Cinta reflectiva con un destello que la recorre.
  const cintaY = alaY - R * 0.48;
  ctx.fillStyle = 'rgba(40,24,6,0.55)';
  ctx.fillRect(-ancho, cintaY, ancho * 2, R * 0.2);
  const x = (((E.t * 0.35) % 1.6) - 0.3) * ancho * 2 - ancho;
  const gc = ctx.createLinearGradient(x - R * 0.6, 0, x + R * 0.6, 0);
  gc.addColorStop(0, 'rgba(210,235,255,0)');
  gc.addColorStop(0.5, 'rgba(230,245,255,0.85)');
  gc.addColorStop(1, 'rgba(210,235,255,0)');
  ctx.fillStyle = gc;
  ctx.fillRect(-ancho, cintaY, ancho * 2, R * 0.2);
  ctx.restore();

  // ── el ala ──
  const alaP = new Path2D();
  alaP.moveTo(-ala, alaY + R * 0.1);
  alaP.quadraticCurveTo(0, alaY - R * 0.22, ala, alaY + R * 0.1);
  alaP.quadraticCurveTo(ala * 1.01, alaY + R * 0.3, ala * 0.92, alaY + R * 0.34);
  alaP.quadraticCurveTo(0, alaY + R * 0.12, -ala * 0.92, alaY + R * 0.34);
  alaP.quadraticCurveTo(-ala * 1.01, alaY + R * 0.3, -ala, alaY + R * 0.1);
  const ga = ctx.createLinearGradient(0, alaY - R * 0.2, 0, alaY + R * 0.34);
  ga.addColorStop(0, '#E8951C');
  ga.addColorStop(1, '#7A4406');
  ctx.fillStyle = ga;
  ctx.fill(alaP);
  ctx.strokeStyle = 'rgba(255,214,140,0.7)';
  ctx.lineWidth = R * 0.05;
  ctx.stroke(alaP);

  // ── la lámpara ──
  const lx = 0;
  const ly = alaY - R * 1.2;
  const I = luz.intensidad;
  // Soporte y carcasa.
  ctx.fillStyle = '#2B2F33';
  ctx.beginPath();
  ctx.roundRect(lx - R * 0.5, ly - R * 0.36, R * 1.0, R * 0.72, R * 0.18);
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.18)';
  ctx.lineWidth = R * 0.04;
  ctx.stroke();
  // Lente.
  const lente = ctx.createRadialGradient(lx - R * 0.08, ly - R * 0.08, R * 0.02, lx, ly, R * 0.3);
  lente.addColorStop(0, `rgba(255,255,245,${0.35 + 0.65 * Math.min(1, I)})`);
  lente.addColorStop(0.6, `rgba(255,${Math.round(200 + 40 * Math.min(1, I))},120,${0.25 + 0.6 * Math.min(1, I)})`);
  lente.addColorStop(1, 'rgba(120,80,20,0.9)');
  ctx.fillStyle = lente;
  ctx.beginPath();
  ctx.arc(lx, ly, R * 0.3, 0, Math.PI * 2);
  ctx.fill();

  // El haz: un resplandor grande y un destello horizontal que se corre hacia donde mira.
  if (I > 0.08) {
    ctx.globalCompositeOperation = 'lighter';
    const dx = clamp(luz.apunta, -1, 1) * R * 0.5;
    const halo = ctx.createRadialGradient(lx + dx, ly, R * 0.1, lx + dx, ly, R * (1.6 + 0.9 * I));
    halo.addColorStop(0, `rgba(255,236,170,${0.55 * Math.min(1.2, I)})`);
    halo.addColorStop(0.35, `rgba(255,190,90,${0.22 * Math.min(1.2, I)})`);
    halo.addColorStop(1, 'rgba(255,160,40,0)');
    ctx.fillStyle = halo;
    ctx.beginPath();
    ctx.arc(lx + dx, ly, R * (1.6 + 0.9 * I), 0, Math.PI * 2);
    ctx.fill();
    const largo = R * (2.4 + 1.6 * I);
    const destello = ctx.createLinearGradient(lx + dx - largo, 0, lx + dx + largo, 0);
    destello.addColorStop(0, 'rgba(255,230,170,0)');
    destello.addColorStop(0.5, `rgba(255,248,220,${0.5 * Math.min(1, I)})`);
    destello.addColorStop(1, 'rgba(255,230,170,0)');
    ctx.fillStyle = destello;
    ctx.fillRect(lx + dx - largo, ly - R * 0.035, largo * 2, R * 0.07);
    ctx.globalCompositeOperation = 'source-over';
  }

  // Tinte del color de la cara sobre el borde del ala: el casco pertenece a esta cara.
  ctx.strokeStyle = `${theme.glow}55`;
  ctx.lineWidth = R * 0.03;
  ctx.stroke(alaP);

  ctx.restore();
}
