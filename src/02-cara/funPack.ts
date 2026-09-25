/**
 * Fun pack — piezas de "juguete" de la cara (visor rojo, coronas de modo, glifos,
 * sable jedi, blásters, vaso holográfico, mano que saluda, visor de cámara).
 * FaceCanvas sólo las dibuja con `funMode` (excepto vaso/mano/visor si App las
 * pide explícitamente por props, y la cámara que es utilitaria). Sin funMode la
 * cara queda limpia: ojos, boca, halo, motas y anillo de voz.
 */
import type { Mode } from '../types';
import type { Theme } from './dibujo';

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

export interface LaserBolt {
id: number;
side: 'left' | 'right';
startX: number;
startY: number;
currentX: number;
currentY: number;
targetX: number;
targetY: number;
progress: number;
color: string;
}

export interface Impact {
id: number;
x: number;
y: number;
alpha: number;
radius: number;
angle: number;
}

export interface CombatState {
isActive: boolean;
level: number; // 0 a 1
shotsRemaining: number;
lastShotTime: number;
startTime: number;
lasers: LaserBolt[];
impacts: Impact[];
weapon: 'none' | 'blaster' | 'jedi';
}

/** Polyfill mínimo para navegadores sin roundRect (usado por blásters y mano). */
export function ensureRoundRect(ctx: CanvasRenderingContext2D) {
  if (typeof (ctx as any).roundRect !== 'function') {
    (ctx as any).roundRect = function (this: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) {
      this.rect(x, y, w, h);
    };
  }
}

// Glifos de modo dentro del ojo (apagados por defecto; sólo funMode + showHud)
export function drawModeEyeGlyph(
  ctx: CanvasRenderingContext2D,
  rx: number,
  ry: number,
  side: number,
  m: Mode,
  theme: Theme,
  t: number,
  A: { lx: number; ly: number; dilate: number; breath: number }
) {
  ctx.save();
  ctx.strokeStyle = '#000000';
  ctx.fillStyle = '#000000';
  ctx.lineWidth = rx * 0.09;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.globalAlpha = 0.85;

  const ix = A.lx * rx * 0.2;
  const iy = A.ly * ry * 0.2;

  switch (m) {
    case 'MINING':
      if (side < 0) {
        // Left Eye: Double Concentric Ring
        ctx.beginPath();
        ctx.arc(ix, iy, rx * 0.42, 0, Math.PI * 2);
        ctx.stroke();
      } else {
        // Right Eye: Pickaxe (Laser-cut silhouette)
        ctx.save();
        ctx.translate(ix, iy);
        ctx.rotate(Math.PI * 0.25);
        // Pickaxe head arc
        ctx.lineWidth = rx * 0.12;
        ctx.beginPath();
        ctx.arc(0, -rx * 0.2, rx * 0.38, Math.PI * 0.2, Math.PI * 0.8);
        ctx.stroke();
        // Pickaxe handle
        ctx.lineWidth = rx * 0.09;
        ctx.beginPath();
        ctx.moveTo(0, -rx * 0.2);
        ctx.lineTo(0, rx * 0.42);
        ctx.stroke();
        ctx.restore();
      }
      break;

    case 'GOLD':
      // Dual glowing gold rings
      ctx.beginPath();
      ctx.arc(ix, iy, rx * 0.46, 0, Math.PI * 2);
      ctx.stroke();
      break;

    case 'CREATIVE':
      // Paintbrush in both eyes
      ctx.save();
      ctx.translate(ix, iy);
      ctx.rotate(side * -0.4);
      ctx.lineWidth = rx * 0.08;
      // Brush handle
      ctx.beginPath();
      ctx.moveTo(0, rx * 0.45);
      ctx.lineTo(0, -rx * 0.1);
      ctx.stroke();
      // Brush bristle tip
      ctx.fillStyle = '#000000';
      ctx.beginPath();
      ctx.moveTo(-rx * 0.12, -rx * 0.1);
      ctx.lineTo(rx * 0.12, -rx * 0.1);
      ctx.lineTo(0, -rx * 0.42);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
      break;

    case 'ANALYTICAL':
      if (side < 0) {
        // Left Eye: Target concentric ring
        ctx.beginPath();
        ctx.arc(ix, iy, rx * 0.45, 0, Math.PI * 2);
        ctx.stroke();
      } else {
        // Right Eye: Magnifying glass / Precision scanner
        ctx.save();
        ctx.translate(ix, iy);
        ctx.beginPath();
        ctx.arc(-rx * 0.08, -ry * 0.08, rx * 0.28, 0, Math.PI * 2);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(rx * 0.12, ry * 0.12);
        ctx.lineTo(rx * 0.38, ry * 0.38);
        ctx.stroke();
        ctx.restore();
      }
      break;

    case 'STRATEGIC':
      ctx.save();
      ctx.translate(ix, iy);
      ctx.lineWidth = Math.max(1.5, rx * 0.05);
      // Outer rotated tactical diamond
      ctx.beginPath();
      ctx.moveTo(0, -ry * 0.42);
      ctx.lineTo(rx * 0.42, 0);
      ctx.lineTo(0, ry * 0.42);
      ctx.lineTo(-rx * 0.42, 0);
      ctx.closePath();
      ctx.stroke();

      // Inner tactical crosshair and focal ring
      ctx.beginPath();
      ctx.arc(0, 0, rx * 0.18, 0, Math.PI * 2);
      ctx.moveTo(-rx * 0.5, 0);
      ctx.lineTo(-rx * 0.22, 0);
      ctx.moveTo(rx * 0.22, 0);
      ctx.lineTo(rx * 0.5, 0);
      ctx.moveTo(0, -ry * 0.5);
      ctx.lineTo(0, -ry * 0.22);
      ctx.moveTo(0, ry * 0.22);
      ctx.lineTo(0, ry * 0.5);
      ctx.stroke();
      ctx.restore();
      break;

    case 'GUARDIAN':
      // Heraldic knight shield in both eyes
      ctx.save();
      ctx.translate(ix, iy);
      ctx.beginPath();
      ctx.moveTo(-rx * 0.28, -ry * 0.32);
      ctx.lineTo(rx * 0.28, -ry * 0.32);
      ctx.lineTo(rx * 0.28, 0);
      ctx.quadraticCurveTo(rx * 0.25, ry * 0.36, 0, ry * 0.44);
      ctx.quadraticCurveTo(-rx * 0.25, ry * 0.36, -rx * 0.28, 0);
      ctx.closePath();
      ctx.stroke();
      // Shield vertical divider
      ctx.beginPath();
      ctx.moveTo(0, -ry * 0.32);
      ctx.lineTo(0, ry * 0.42);
      ctx.stroke();
      ctx.restore();
      break;

    case 'EXPLORER':
      if (side < 0) {
        // Left Eye: Compass with needle
        ctx.save();
        ctx.translate(ix, iy);
        ctx.beginPath();
        ctx.arc(0, 0, rx * 0.42, 0, Math.PI * 2);
        ctx.stroke();
        // Needle
        ctx.rotate(t * 0.8);
        ctx.beginPath();
        ctx.moveTo(0, -rx * 0.38);
        ctx.lineTo(rx * 0.1, 0);
        ctx.lineTo(0, rx * 0.38);
        ctx.lineTo(-rx * 0.1, 0);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      } else {
        // Right Eye: 8-point nautical windrose star
        ctx.save();
        ctx.translate(ix, iy);
        ctx.rotate(t * 0.3);
        for (let i = 0; i < 4; i++) {
          ctx.rotate(Math.PI / 4);
          ctx.beginPath();
          ctx.moveTo(0, -rx * 0.42);
          ctx.lineTo(0, rx * 0.42);
          ctx.stroke();
        }
        ctx.restore();
      }
      break;

    default:
      // Standard Pupil
      ctx.beginPath();
      ctx.arc(ix, iy, rx * A.dilate * A.breath, 0, Math.PI * 2);
      ctx.fill();
      break;
  }

  ctx.restore();
}

// Draw LOOI Red Cyberpunk Sunglasses (Photo 2)
export function drawLooiVisor(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  baseR: number,
  eyeSpacing: number,
  dropProgress: number,
  t: number
) {
  ctx.save();
  // Drop down from forehead
  const startY = cy - baseR * 2.2;
  const finalY = cy - baseR * 0.15;
  const curY = lerp(startY, finalY, dropProgress);

  ctx.translate(cx, curY);

  const visorW = eyeSpacing * 2.2 + baseR * 1.5;
  const visorH = baseR * 1.25;

  // Glowing red drop shadow
  ctx.shadowColor = '#FF2A4D';
  ctx.shadowBlur = 28;

  // Outer Futuristic Red Bezel Frame
  ctx.fillStyle = '#CC0D28';
  ctx.strokeStyle = '#FF3B5C';
  ctx.lineWidth = baseR * 0.08;
  ctx.lineJoin = 'miter';

  ctx.beginPath();
  // Modern angular shape like LOOI Photo 2
  ctx.moveTo(-visorW * 0.5, -visorH * 0.4);
  ctx.lineTo(-visorW * 0.15, -visorH * 0.55);
  ctx.lineTo(0, -visorH * 0.38); // bridge dip
  ctx.lineTo(visorW * 0.15, -visorH * 0.55);
  ctx.lineTo(visorW * 0.5, -visorH * 0.4);
  ctx.lineTo(visorW * 0.44, visorH * 0.5);
  ctx.lineTo(0, visorH * 0.3); // bottom center
  ctx.lineTo(-visorW * 0.44, visorH * 0.5);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  // Dark Tinted Lens Cutout
  ctx.fillStyle = 'rgba(15, 0, 3, 0.78)';
  ctx.beginPath();
  ctx.moveTo(-visorW * 0.45, -visorH * 0.3);
  ctx.lineTo(-visorW * 0.12, -visorH * 0.45);
  ctx.lineTo(-visorW * 0.02, -visorH * 0.28);
  ctx.lineTo(-visorW * 0.02, visorH * 0.22);
  ctx.lineTo(-visorW * 0.38, visorH * 0.4);
  ctx.closePath();
  ctx.fill();

  ctx.beginPath();
  ctx.moveTo(visorW * 0.45, -visorH * 0.3);
  ctx.lineTo(visorW * 0.12, -visorH * 0.45);
  ctx.lineTo(visorW * 0.02, -visorH * 0.28);
  ctx.lineTo(visorW * 0.02, visorH * 0.22);
  ctx.lineTo(visorW * 0.38, visorH * 0.4);
  ctx.closePath();
  ctx.fill();

  // Star Catchlight Sparkle on Right Lens (Exact from LOOI Photo 2!)
  const starX = visorW * 0.36;
  const starY = -visorH * 0.08;
  const starR = baseR * 0.25 * (0.85 + 0.15 * Math.sin(t * 5));

  ctx.save();
  ctx.translate(starX, starY);
  ctx.fillStyle = '#FFFFFF';
  ctx.shadowColor = '#FFFFFF';
  ctx.shadowBlur = 18;

  // 4-point glittering star
  ctx.beginPath();
  ctx.moveTo(0, -starR);
  ctx.quadraticCurveTo(0, 0, starR, 0);
  ctx.quadraticCurveTo(0, 0, 0, starR);
  ctx.quadraticCurveTo(0, 0, -starR, 0);
  ctx.quadraticCurveTo(0, 0, 0, -starR);
  ctx.closePath();
  ctx.fill();
  ctx.restore();

  ctx.restore();
}

// Draw Mode Crowns / Emblems (Exact to Photo 3 Tablets)
export function drawModeCrown(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  R: number,
  m: Mode,
  theme: Theme,
  t: number
) {
  ctx.save();
  ctx.translate(cx, cy);

  ctx.strokeStyle = theme.primary;
  ctx.fillStyle = theme.primary;
  ctx.lineWidth = R * 0.06;
  ctx.shadowColor = theme.glow;
  ctx.shadowBlur = 20;

  switch (m) {
    case 'MINING': {
      // Rotating Mechanical Gear on forehead
      ctx.save();
      ctx.rotate(t * 1.5);
      const gearR = R * 0.48;
      const teeth = 10;
      ctx.beginPath();
      for (let i = 0; i < teeth * 2; i++) {
        const angle = (i * Math.PI) / teeth;
        const r = i % 2 === 0 ? gearR : gearR * 0.76;
        const gx = Math.cos(angle) * r;
        const gy = Math.sin(angle) * r;
        if (i === 0) ctx.moveTo(gx, gy);
        else ctx.lineTo(gx, gy);
      }
      ctx.closePath();
      ctx.stroke();
      // Inner bore
      ctx.beginPath();
      ctx.arc(0, 0, gearR * 0.32, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
      break;
    }

    case 'GOLD': {
      // 3D Gold Ingot on forehead (Image 3)
      ctx.save();
      const ingotW = R * 0.85;
      const ingotH = R * 0.38;

      // Ingot Top Face (bright metallic gold)
      const topGrad = ctx.createLinearGradient(-ingotW * 0.4, -ingotH, ingotW * 0.4, 0);
      topGrad.addColorStop(0, '#FFF6A3');
      topGrad.addColorStop(0.5, '#F5C542');
      topGrad.addColorStop(1, '#D99B00');
      ctx.fillStyle = topGrad;

      ctx.beginPath();
      ctx.moveTo(-ingotW * 0.38, -ingotH * 0.8);
      ctx.lineTo(ingotW * 0.38, -ingotH * 0.8);
      ctx.lineTo(ingotW * 0.5, 0);
      ctx.lineTo(-ingotW * 0.5, 0);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      // Ingot Front Face
      const frontGrad = ctx.createLinearGradient(0, 0, 0, ingotH);
      frontGrad.addColorStop(0, '#F5C542');
      frontGrad.addColorStop(1, '#875C00');
      ctx.fillStyle = frontGrad;

      ctx.beginPath();
      ctx.moveTo(-ingotW * 0.5, 0);
      ctx.lineTo(ingotW * 0.5, 0);
      ctx.lineTo(ingotW * 0.42, ingotH * 0.65);
      ctx.lineTo(-ingotW * 0.42, ingotH * 0.65);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      // Gold Shimmer Glint
      const glintX = Math.sin(t * 3) * (ingotW * 0.28);
      ctx.fillStyle = '#FFFFFF';
      ctx.beginPath();
      ctx.arc(glintX, -ingotH * 0.4, R * 0.08, 0, Math.PI * 2);
      ctx.fill();

      ctx.restore();
      break;
    }

    case 'CREATIVE': {
      // Glowing Lightbulb with internal filament and radiation sparks
      const bulbR = R * 0.38;
      ctx.beginPath();
      ctx.arc(0, -bulbR * 0.3, bulbR, Math.PI * 0.75, Math.PI * 2.25);
      ctx.lineTo(bulbR * 0.4, bulbR * 0.75);
      ctx.lineTo(-bulbR * 0.4, bulbR * 0.75);
      ctx.closePath();
      ctx.stroke();

      // Screw base
      ctx.beginPath();
      ctx.moveTo(-bulbR * 0.3, bulbR * 0.95);
      ctx.lineTo(bulbR * 0.3, bulbR * 0.95);
      ctx.moveTo(-bulbR * 0.2, bulbR * 1.15);
      ctx.lineTo(bulbR * 0.2, bulbR * 1.15);
      ctx.stroke();

      // Filament
      ctx.lineWidth = R * 0.04;
      ctx.beginPath();
      ctx.moveTo(-bulbR * 0.2, bulbR * 0.5);
      ctx.lineTo(0, -bulbR * 0.3);
      ctx.lineTo(bulbR * 0.2, bulbR * 0.5);
      ctx.stroke();

      // Radiating light rays
      for (let i = 0; i < 5; i++) {
        const a = -Math.PI * 0.8 + (i * Math.PI * 0.6) / 4;
        const r1 = bulbR * 1.35;
        const r2 = bulbR * 1.75 + Math.sin(t * 6 + i) * (bulbR * 0.25);
        ctx.beginPath();
        ctx.moveTo(Math.cos(a) * r1, -bulbR * 0.3 + Math.sin(a) * r1);
        ctx.lineTo(Math.cos(a) * r2, -bulbR * 0.3 + Math.sin(a) * r2);
        ctx.stroke();
      }
      break;
    }

    case 'ANALYTICAL': {
      // Telemetry Crown: Connected nodes and peak graph
      const pts = [
        { x: -R * 0.65, y: R * 0.2 },
        { x: -R * 0.35, y: -R * 0.4 },
        { x: 0, y: -R * 0.1 },
        { x: R * 0.35, y: -R * 0.55 },
        { x: R * 0.65, y: R * 0.1 },
      ];
      ctx.beginPath();
      pts.forEach((p, i) => {
        if (i === 0) ctx.moveTo(p.x, p.y);
        else ctx.lineTo(p.x, p.y);
      });
      ctx.stroke();

      // Nodes
      pts.forEach((p, i) => {
        ctx.fillStyle = i === 3 ? '#00FFA3' : theme.primary;
        ctx.beginPath();
        ctx.arc(p.x, p.y, R * 0.08, 0, Math.PI * 2);
        ctx.fill();
      });
      break;
    }

    case 'STRATEGIC': {
      // Tactical Crown with tactical directional vectors
      ctx.beginPath();
      ctx.moveTo(-R * 0.6, R * 0.15);
      ctx.lineTo(-R * 0.4, -R * 0.45);
      ctx.lineTo(0, -R * 0.15);
      ctx.lineTo(R * 0.4, -R * 0.45);
      ctx.lineTo(R * 0.6, R * 0.15);
      ctx.closePath();
      ctx.stroke();

      // Central strategic diamond
      ctx.fillStyle = theme.primary;
      ctx.beginPath();
      ctx.moveTo(0, -R * 0.5);
      ctx.lineTo(R * 0.1, -R * 0.35);
      ctx.lineTo(0, -R * 0.2);
      ctx.lineTo(-R * 0.1, -R * 0.35);
      ctx.closePath();
      ctx.fill();
      break;
    }

    case 'GUARDIAN': {
      // Fortress Battlement Crown with locks
      const cw = R * 0.85;
      const ch = R * 0.42;
      ctx.beginPath();
      ctx.moveTo(-cw * 0.5, ch * 0.5);
      ctx.lineTo(-cw * 0.5, -ch * 0.5);
      ctx.lineTo(-cw * 0.25, -ch * 0.5);
      ctx.lineTo(-cw * 0.25, -ch * 0.15);
      ctx.lineTo(-cw * 0.08, -ch * 0.15);
      ctx.lineTo(-cw * 0.08, -ch * 0.5);
      ctx.lineTo(cw * 0.08, -ch * 0.5);
      ctx.lineTo(cw * 0.08, -ch * 0.15);
      ctx.lineTo(cw * 0.25, -ch * 0.15);
      ctx.lineTo(cw * 0.25, -ch * 0.5);
      ctx.lineTo(cw * 0.5, -ch * 0.5);
      ctx.lineTo(cw * 0.5, ch * 0.5);
      ctx.closePath();
      ctx.stroke();

      // Peripheral Floating Padlocks
      const drawLock = (px: number, py: number) => {
        ctx.save();
        ctx.translate(px, py);
        ctx.beginPath();
        ctx.arc(0, -R * 0.1, R * 0.08, Math.PI, 0);
        ctx.stroke();
        ctx.fillRect(-R * 0.1, -R * 0.02, R * 0.2, R * 0.16);
        ctx.restore();
      };
      drawLock(-R * 0.88, -R * 0.15 + Math.sin(t * 2) * 5);
      drawLock(R * 0.88, -R * 0.25 + Math.cos(t * 2.2) * 5);
      break;
    }

    case 'EXPLORER': {
      // Astrological Telescope angled to the upper right
      ctx.save();
      ctx.rotate(-Math.PI * 0.18);
      ctx.beginPath();
      // Main barrel
      ctx.rect(-R * 0.14, -R * 0.65, R * 0.28, R * 0.8);
      ctx.stroke();
      // Front lens hood
      ctx.beginPath();
      ctx.rect(-R * 0.2, -R * 0.82, R * 0.4, R * 0.18);
      ctx.stroke();
      // Eyepiece
      ctx.beginPath();
      ctx.rect(-R * 0.09, R * 0.15, R * 0.18, R * 0.18);
      ctx.stroke();
      ctx.restore();
      break;
    }
  }

  ctx.restore();
}

// Draw Mode Floating Atmospheric Particles
export function drawModeEnvironment(
  ctx: CanvasRenderingContext2D,
  R: number,
  m: Mode,
  theme: Theme,
  t: number
) {
  ctx.save();
  if (m === 'CREATIVE') {
    // Color paint specks floating around
    const colors = ['#05E1FF', '#FF3BB0', '#FFD800', '#00FFA3'];
    for (let i = 0; i < 14; i++) {
      const a = t * 0.4 + i * 0.75;
      const r = R * (1.9 + (i % 3) * 0.3);
      const px = Math.cos(a) * r * 1.35;
      const py = Math.sin(a * 0.8) * r * 0.65;
      ctx.fillStyle = colors[i % colors.length];
      ctx.globalAlpha = 0.55 + 0.35 * Math.sin(t * 3 + i);
      ctx.beginPath();
      ctx.arc(px, py, R * 0.045, 0, Math.PI * 2);
      ctx.fill();
    }
  } else if (m === 'GOLD') {
    // Golden 4-point twinkling stars
    ctx.fillStyle = '#FFE58F';
    ctx.shadowColor = '#F5C542';
    ctx.shadowBlur = 10;
    for (let i = 0; i < 9; i++) {
      const a = t * 0.3 + i * 1.1;
      const r = R * (1.85 + (i % 4) * 0.25);
      const px = Math.cos(a) * r * 1.4;
      const py = Math.sin(a) * r * 0.7;
      const sr = R * 0.07 * (0.5 + 0.5 * Math.abs(Math.sin(t * 2 + i)));

      ctx.save();
      ctx.translate(px, py);
      ctx.beginPath();
      ctx.moveTo(0, -sr);
      ctx.lineTo(sr * 0.25, -sr * 0.25);
      ctx.lineTo(sr, 0);
      ctx.lineTo(sr * 0.25, sr * 0.25);
      ctx.lineTo(0, sr);
      ctx.lineTo(-sr * 0.25, sr * 0.25);
      ctx.lineTo(-sr, 0);
      ctx.lineTo(-sr * 0.25, -sr * 0.25);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
  }
  ctx.restore();
}

// Sable jedi (funMode)
export function drawJediSaber(ctx: CanvasRenderingContext2D, W: number, H: number, t: number) {
  const x = W * 0.72;
  const y = H * 0.62;
  const sway = Math.sin(t * 2.2) * 0.08;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(-0.7 + sway);
  ctx.fillStyle = '#1a1a1a';
  ctx.fillRect(-7, 0, 14, 46);
  ctx.fillStyle = '#05E1FF';
  ctx.shadowColor = '#05E1FF';
  ctx.shadowBlur = 28;
  const len = 160 + Math.sin(t * 8) * 6;
  ctx.fillRect(-4, -len, 8, len);
  ctx.fillStyle = '#E8FFFF';
  ctx.shadowBlur = 12;
  ctx.fillRect(-1.5, -len, 3, len);
  ctx.restore();
}

export function drawCombatBlasterTurrets(
  ctx: CanvasRenderingContext2D,
  baseR: number,
  eyeSpacing: number,
  combat: CombatState,
  t: number
) {
  const lvl = combat.level;
  if (lvl <= 0.005) return;

  const turretDistance = eyeSpacing + baseR * (0.85 + lvl * 0.65);

  // Left Blaster Cannon
  drawSingleBlasterTurret(ctx, -turretDistance, 0, -1, lvl, t, combat);
  // Right Blaster Cannon
  drawSingleBlasterTurret(ctx, turretDistance, 0, 1, lvl, t, combat);
}

export function drawSingleBlasterTurret(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  side: number,
  level: number,
  t: number,
  combat: CombatState
) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(side, 1);

  // Mechanical mounting arm connecting from head
  ctx.strokeStyle = '#1E293B';
  ctx.lineWidth = 10;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(-35 * (1 - level), 0);
  ctx.lineTo(20, 0);
  ctx.stroke();

  // Hydraulic piston detail
  ctx.strokeStyle = '#05E1FF';
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.moveTo(-15 * (1 - level), -5);
  ctx.lineTo(15, -5);
  ctx.stroke();

  // Heavy Armor Housing
  ctx.fillStyle = '#0F172A';
  ctx.strokeStyle = '#EF4444';
  ctx.lineWidth = 2;
  ctx.shadowColor = '#EF4444';
  ctx.shadowBlur = 10 * level;

  ctx.beginPath();
  ctx.roundRect(-22, -26, 44, 52, [8, 14, 14, 8]);
  ctx.fill();
  ctx.stroke();

  // Warning hazard stripes / glowing red energy chamber
  ctx.fillStyle = '#FF1133';
  ctx.shadowColor = '#FF1133';
  ctx.shadowBlur = 14;
  ctx.beginPath();
  ctx.roundRect(-10, -16, 20, 32, 4);
  ctx.fill();

  // Energy core pulsing
  ctx.fillStyle = '#FFFFFF';
  ctx.beginPath();
  ctx.arc(0, 0, 4 + Math.sin(t * 16) * 1.5, 0, Math.PI * 2);
  ctx.fill();

  // Twin Plasma Barrels extending forward
  const firingThisSide = combat.shotsRemaining > 0 && ((side < 0 && combat.shotsRemaining % 2 === 0) || (side > 0 && combat.shotsRemaining % 2 !== 0));
  const recoil = firingThisSide ? -8 : 0;

  ctx.fillStyle = '#334155';
  ctx.strokeStyle = '#64748B';
  ctx.lineWidth = 1.5;

  // Upper barrel
  ctx.beginPath();
  ctx.roundRect(16 + recoil, -18, 28, 9, 3);
  ctx.fill();
  ctx.stroke();

  // Lower barrel
  ctx.beginPath();
  ctx.roundRect(16 + recoil, 9, 28, 9, 3);
  ctx.fill();
  ctx.stroke();

  // Barrel interior plasma glow
  ctx.fillStyle = '#FF1133';
  ctx.fillRect(40 + recoil, -16, 5, 5);
  ctx.fillRect(40 + recoil, 11, 5, 5);

  // Muzzle flash when firing
  if (firingThisSide) {
    ctx.fillStyle = '#FFFFFF';
    ctx.shadowColor = '#FF4400';
    ctx.shadowBlur = 30;
    ctx.beginPath();
    ctx.arc(50 + recoil, -14, 14, 0, Math.PI * 2);
    ctx.arc(50 + recoil, 13, 14, 0, Math.PI * 2);
    ctx.fill();

    // Muzzle spark spikes
    ctx.strokeStyle = '#FFAA00';
    ctx.lineWidth = 2;
    for (let s = 0; s < 5; s++) {
      const a = (s / 5) * Math.PI * 2 + t * 20;
      ctx.beginPath();
      ctx.moveTo(50 + recoil, -14);
      ctx.lineTo(50 + recoil + Math.cos(a) * 25, -14 + Math.sin(a) * 25);
      ctx.stroke();
    }
  }

  ctx.restore();
}

// 7. Draw Holographic Drink Cup (Refreshing Soda / Water)
export function drawHolographicDrinkCup(
  ctx: CanvasRenderingContext2D,
  baseR: number,
  eyeSpacing: number,
  progress: number,
  t: number
) {
  if (progress <= 0.005) return;

  ctx.save();
  // Position on lower right near mouth
  const cupX = eyeSpacing * 0.98;
  const cupY = baseR * 0.95 + (1 - progress) * 80;
  ctx.translate(cupX, cupY);
  ctx.globalAlpha = Math.min(1, progress * 1.2);

  // Holographic Cup Body (Tapered tumbler glass)
  ctx.strokeStyle = '#05E1FF';
  ctx.lineWidth = 2.5;
  ctx.shadowColor = '#05E1FF';
  ctx.shadowBlur = 18;

  // Glass Tumbler
  ctx.beginPath();
  ctx.moveTo(-22, -35);
  ctx.lineTo(22, -35);
  ctx.lineTo(16, 42);
  ctx.quadraticCurveTo(0, 48, -16, 42);
  ctx.closePath();

  // Liquid fill (sparkling cyan/blue soda)
  const liquidGrad = ctx.createLinearGradient(0, -25, 0, 42);
  liquidGrad.addColorStop(0, 'rgba(5, 225, 255, 0.45)');
  liquidGrad.addColorStop(0.5, 'rgba(0, 180, 255, 0.65)');
  liquidGrad.addColorStop(1, 'rgba(0, 100, 220, 0.85)');
  ctx.fillStyle = liquidGrad;
  ctx.fill();
  ctx.stroke();

  // Liquid surface meniscus wave
  ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
  ctx.beginPath();
  ctx.ellipse(0, -22 + Math.sin(t * 4) * 2, 18, 5, 0, 0, Math.PI * 2);
  ctx.fill();

  // 3 Floating 3D-styled Ice Cubes
  for (let c = 0; c < 3; c++) {
    const ix = -10 + c * 10 + Math.sin(t * 2 + c) * 3;
    const iy = -12 + (c % 2) * 16 + Math.cos(t * 3 + c) * 2;
    ctx.save();
    ctx.translate(ix, iy);
    ctx.rotate(0.2 * (c + 1) + Math.sin(t * 2) * 0.1);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.45)';
    ctx.strokeStyle = '#FFFFFF';
    ctx.lineWidth = 1;
    ctx.strokeRect(-6, -6, 12, 12);
    ctx.fillRect(-6, -6, 12, 12);
    ctx.restore();
  }

  // Carbonated fizzy rising bubbles
  for (let b = 0; b < 7; b++) {
    const by = 35 - ((t * 25 + b * 14) % 65);
    const bx = Math.sin(b * 3 + t * 4) * 12;
    ctx.fillStyle = '#FFFFFF';
    ctx.shadowColor = '#05E1FF';
    ctx.shadowBlur = 8;
    ctx.beginPath();
    ctx.arc(bx, by, 1.8 + (b % 3) * 0.8, 0, Math.PI * 2);
    ctx.fill();
  }

  // Glowing Neon Straw curving directly toward AU-RA's mouth
  ctx.strokeStyle = '#FF3BB0';
  ctx.lineWidth = 4;
  ctx.shadowColor = '#FF3BB0';
  ctx.shadowBlur = 12;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(4, 30);
  ctx.lineTo(12, -35);
  // Bend toward mouth (to the left)
  ctx.quadraticCurveTo(15, -55, -25, -52);
  ctx.stroke();

  // Inner bright core of straw
  ctx.strokeStyle = '#FFFFFF';
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // "ELECTRO-DRINK" hologram label badge
  ctx.fillStyle = '#05E1FF';
  ctx.font = 'bold 8px monospace';
  ctx.textAlign = 'center';
  ctx.fillText('REFRESH · 100%', 0, 24);

  ctx.restore();
}

// 8. Draw Cute Cyber-Robotic Waving Hand
export function drawCyberWavingHand(
  ctx: CanvasRenderingContext2D,
  baseR: number,
  eyeSpacing: number,
  progress: number,
  t: number
) {
  if (progress <= 0.005) return;

  ctx.save();
  // Position on right side of face
  const handX = eyeSpacing * 1.38;
  const handY = -baseR * 0.15 + (1 - progress) * 60;
  ctx.translate(handX, handY);
  ctx.globalAlpha = Math.min(1, progress * 1.2);

  // Oscillation for wave gesture (back and forth)
  const waveAngle = Math.sin(t * 8) * 0.38;
  ctx.rotate(waveAngle);

  // Sleek robotic arm link
  ctx.strokeStyle = '#1E293B';
  ctx.lineWidth = 12;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(35, 45);
  ctx.lineTo(0, 15);
  ctx.stroke();

  // Glowing cyan cyber conduit
  ctx.strokeStyle = '#05E1FF';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(30, 42);
  ctx.lineTo(0, 15);
  ctx.stroke();

  // Palm base plate
  ctx.fillStyle = '#0F172A';
  ctx.strokeStyle = '#05E1FF';
  ctx.lineWidth = 2;
  ctx.shadowColor = '#05E1FF';
  ctx.shadowBlur = 14;
  ctx.beginPath();
  ctx.roundRect(-14, -10, 28, 26, 8);
  ctx.fill();
  ctx.stroke();

  // Center repulsor palm beacon (pulsing friendly greeting light)
  ctx.fillStyle = '#05E1FF';
  ctx.beginPath();
  ctx.arc(0, 3, 5 + Math.sin(t * 10) * 1.5, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = '#FFFFFF';
  ctx.beginPath();
  ctx.arc(0, 3, 2.5, 0, Math.PI * 2);
  ctx.fill();

  // 4 Articulated fingers waving
  const fingerHeights = [18, 22, 21, 16];
  const fingerXs = [-9, -3, 3, 9];

  for (let f = 0; f < 4; f++) {
    const fx = fingerXs[f];
    const fh = fingerHeights[f];
    const fBend = Math.sin(t * 8 + f * 0.4) * 3;

    ctx.save();
    ctx.translate(fx, -10);
    ctx.fillStyle = '#0F172A';
    ctx.strokeStyle = '#05E1FF';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.roundRect(-2.5, -fh + fBend, 5, fh, 3);
    ctx.fill();
    ctx.stroke();

    // Finger tip LED node
    ctx.fillStyle = '#00FFA3';
    ctx.beginPath();
    ctx.arc(0, -fh + fBend + 2.5, 1.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // Thumb pointing outward
  ctx.save();
  ctx.translate(14, 0);
  ctx.rotate(0.5);
  ctx.fillStyle = '#0F172A';
  ctx.strokeStyle = '#05E1FF';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.roundRect(-2.5, -12, 5, 12, 3);
  ctx.fill();
  ctx.stroke();
  ctx.restore();

  // Radiating friendly greeting sparkle stars around hand
  for (let s = 0; s < 4; s++) {
    const sa = t * 3 + s * 1.57;
    const sr = 24 + Math.sin(t * 4 + s) * 6;
    ctx.fillStyle = '#05E1FF';
    ctx.shadowColor = '#05E1FF';
    ctx.shadowBlur = 10;
    ctx.beginPath();
    ctx.arc(Math.cos(sa) * sr, Math.sin(sa) * sr - 10, 2, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.restore();
}

// 9. Draw Laser Bolts and Glass Impact Fractures across Full Screen
export function drawLaserBoltsAndImpacts(
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  combat: CombatState
) {
  ctx.save();

  // Laser Beams
  for (const l of combat.lasers) {
    const dx = l.targetX - l.startX;
    const dy = l.targetY - l.startY;
    const angle = Math.atan2(dy, dx);
    const len = 42;

    ctx.save();
    ctx.translate(l.currentX, l.currentY);
    ctx.rotate(angle);

    // Outer plasma trail
    ctx.strokeStyle = '#FF1133';
    ctx.lineWidth = 6;
    ctx.shadowColor = '#FF0033';
    ctx.shadowBlur = 20;
    ctx.beginPath();
    ctx.moveTo(-len, 0);
    ctx.lineTo(0, 0);
    ctx.stroke();

    // White hot core
    ctx.strokeStyle = '#FFFFFF';
    ctx.lineWidth = 2.5;
    ctx.shadowColor = '#FFFFFF';
    ctx.shadowBlur = 10;
    ctx.beginPath();
    ctx.moveTo(-len * 0.7, 0);
    ctx.lineTo(0, 0);
    ctx.stroke();

    ctx.restore();
  }

  // Impact Craters on the Screen Glass
  for (const imp of combat.impacts) {
    ctx.save();
    ctx.translate(imp.x, imp.y);
    ctx.globalAlpha = Math.min(1, imp.alpha);

    // Red thermal burn glow
    const burnGrad = ctx.createRadialGradient(0, 0, 0, 0, 0, imp.radius);
    burnGrad.addColorStop(0, 'rgba(255, 50, 50, 0.85)');
    burnGrad.addColorStop(0.4, 'rgba(255, 0, 0, 0.45)');
    burnGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = burnGrad;
    ctx.beginPath();
    ctx.arc(0, 0, imp.radius, 0, Math.PI * 2);
    ctx.fill();

    // Shattered Glass Radial Fracture Spikes
    ctx.strokeStyle = '#FFFFFF';
    ctx.lineWidth = 1.6;
    ctx.shadowColor = '#FF3366';
    ctx.shadowBlur = 8;

    for (let r = 0; r < 7; r++) {
      const a = imp.angle + (r / 7) * Math.PI * 2;
      const rad = imp.radius * (0.8 + (r % 3) * 0.35);
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(Math.cos(a) * rad * 0.5, Math.sin(a) * rad * 0.5);
      ctx.lineTo(Math.cos(a + 0.15) * rad, Math.sin(a + 0.15) * rad);
      ctx.stroke();
    }

    // Concentric fracture ring
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.6)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(0, 0, imp.radius * 0.45, 0, Math.PI * 2);
    ctx.stroke();

    ctx.restore();
  }

  ctx.restore();
}

// 10. Draw Optical Camera Viewfinder & White Shutter Flash
export function drawCameraViewfinderAndFlash(
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  flashAlpha: number,
  isViewfinderActive: boolean
) {
  ctx.save();

  // Camera viewfinder reticles if active
  if (isViewfinderActive) {
    const marginX = W * 0.08;
    const marginY = H * 0.08;
    const bracketLen = Math.min(W, H) * 0.08;

    ctx.strokeStyle = '#05E1FF';
    ctx.lineWidth = 3;
    ctx.shadowColor = '#05E1FF';
    ctx.shadowBlur = 12;

    // Top-Left bracket
    ctx.beginPath();
    ctx.moveTo(marginX + bracketLen, marginY);
    ctx.lineTo(marginX, marginY);
    ctx.lineTo(marginX, marginY + bracketLen);
    ctx.stroke();

    // Top-Right bracket
    ctx.beginPath();
    ctx.moveTo(W - marginX - bracketLen, marginY);
    ctx.lineTo(W - marginX, marginY);
    ctx.lineTo(W - marginX, marginY + bracketLen);
    ctx.stroke();

    // Bottom-Left bracket
    ctx.beginPath();
    ctx.moveTo(marginX, H - marginY - bracketLen);
    ctx.lineTo(marginX, H - marginY);
    ctx.lineTo(marginX + bracketLen, H - marginY);
    ctx.stroke();

    // Bottom-Right bracket
    ctx.beginPath();
    ctx.moveTo(W - marginX - bracketLen, H - marginY);
    ctx.lineTo(W - marginX, H - marginY);
    ctx.lineTo(W - marginX, H - marginY - bracketLen);
    ctx.stroke();

    // Center auto-focus targeting box
    ctx.strokeStyle = 'rgba(5, 225, 255, 0.7)';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(W / 2 - 30, H / 2 - 30, 60, 60);

    // Center crosshair dot
    ctx.fillStyle = '#05E1FF';
    ctx.beginPath();
    ctx.arc(W / 2, H / 2, 3, 0, Math.PI * 2);
    ctx.fill();

    // Telemetry OSD
    ctx.fillStyle = '#05E1FF';
    ctx.font = 'bold 11px monospace';
    ctx.fillText('AF-L · 4K UHD 60FPS · ISO 400 · 1/500s', marginX + 8, marginY + 24);

    // Flashing REC indicator
    ctx.fillStyle = '#FF1133';
    ctx.beginPath();
    ctx.arc(W - marginX - 45, marginY + 20, 5, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#FFFFFF';
    ctx.font = 'bold 11px monospace';
    ctx.fillText('REC', W - marginX - 35, marginY + 24);
  }

  // Pure White Shutter Flash
  if (flashAlpha > 0.005) {
    ctx.fillStyle = `rgba(255, 255, 255, ${Math.min(1, flashAlpha)})`;
    ctx.fillRect(0, 0, W, H);
  }

  ctx.restore();
}
