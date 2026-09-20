/**
 * dibujo.ts — helpers de dibujo de la cara "limpia": tema por modo, ojos vivos,
 * boca paramétrica, halo que respira, motas ambientales, chispas y anillo de voz.
 * Todo lo que es "juguete" vive en funPack.ts. Nada aquí usa shadowBlur dentro
 * de bucles por partícula: las motas van con un sprite pre-renderizado.
 */
import type { Mode, FaceState, AnimationEngineState, TouchRipple } from '../types';

export interface Theme {
  primary: string;
  glow: string;
  core: string;
  accent: string;
  dark: string;
}

/** Paleta OLED por modo. GUARDIAN es la marca: negro + cian #05E1FF. */
export function getThemeColors(m: Mode): Theme {
  switch (m) {
    case 'GOLD':
      return { primary: '#F5C542', glow: '#FFE17D', core: '#FFF4C2', accent: '#FFB800', dark: '#3D2800' };
    case 'CREATIVE':
      return { primary: '#05E1FF', glow: '#67EFFF', core: '#E0FAFF', accent: '#FF4DF0', dark: '#002530' };
    case 'ANALYTICAL':
      return { primary: '#05E1FF', glow: '#4FE4FF', core: '#D8F7FF', accent: '#00FFA3', dark: '#00242E' };
    case 'STRATEGIC':
      return { primary: '#05E1FF', glow: '#4AE1FF', core: '#D9F8FF', accent: '#4C82FF', dark: '#001E2B' };
    case 'EXPLORER':
      return { primary: '#05E1FF', glow: '#64E5FF', core: '#E3FAFF', accent: '#26C6DA', dark: '#00222B' };
    case 'MINING':
      return { primary: '#05E1FF', glow: '#59E3FF', core: '#DDF9FF', accent: '#FF9E2C', dark: '#00222B' };
    case 'GUARDIAN':
    default:
      return { primary: '#05E1FF', glow: '#5CE4FF', core: '#E0F9FF', accent: '#00C8FF', dark: '#001E29' };
  }
}

// ───────────────────────── utilidades numéricas ─────────────────────────
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));
export const smoothstep = (x: number) => {
  const t = clamp(x, 0, 1);
  return t * t * (3 - 2 * t);
};
/** Ease "back-out": sube a ~1.1 y asienta en 1. Para el despertar de los párpados. */
export const backOut = (p: number) => {
  const c1 = 1.20158;
  const c3 = c1 + 1;
  const x = clamp(p, 0, 1) - 1;
  return 1 + c3 * x * x * x + c1 * x * x;
};
/** Acercamiento exponencial independiente del framerate. */
export const approach = (cur: number, target: number, rate: number, dt: number) =>
  cur + (target - cur) * Math.min(1, dt * rate);

// ───────────────────────── estado de "vida" ─────────────────────────
export interface Mote {
  x: number; // 0..1 del ancho
  y: number; // 0..1 del alto
  vx: number;
  vy: number;
  r: number; // radio base en fracción de baseR
  ph: number; // fase propia
  a: number; // alfa base
}

export interface Sparkle {
  x: number; // px relativos al centro de la cara
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  r: number;
}

/**
 * Capa "viva" de la cara: todo lo que no cabía en AnimationEngineState y que
 * la expresión, el despertar y el ambiente necesitan. Valores *T son metas; los
 * demás se acercan a la meta cada frame.
 */
export interface Vida {
  wakeT: number; // segundos desde montaje
  wake: number; // 0..1.1 apertura de párpados al despertar
  lid: number; // multiplicador de apertura (1 abierto, 0.55 pesado)
  lidT: number;
  wide: number; // >1 ojos muy abiertos (sorpresa)
  wideT: number;
  browLift: number; // 0..1 cejas arriba en paralelo
  browLiftT: number;
  browAsym: number; // + ceja derecha arriba, − izquierda
  browAsymT: number;
  tilt: number; // inclinación de cabeza (rad)
  tiltT: number;
  lift: number; // pecho arriba / brinco sostenido (unidades de R)
  liftT: number;
  swayX: number; // balanceo horizontal (unidades de R)
  gazeX: number; // sesgo de mirada
  gazeY: number;
  gazeXT: number;
  gazeYT: number;
  laughAmp: number; // amplitud de risa (decae)
  laughPhase: number;
  yawn: number; // 0..1 progreso del bostezo
  yawning: boolean;
  hmmIn: number; // temporizador del "hmm" pensativo
  hmm: number; // envolvente del pulso
  freeze: number; // segundos sin parpadeo ni sacadas (sorpresa)
  blinkSpeed: number; // 1 normal, <1 lento
  longBlink: boolean;
  mouthSkew: number; // −1..1 media sonrisa (travieso)
  mouthSkewT: number;
  mouthExtra: number; // apertura extra por risa / bostezo / hmm (se recalcula cada frame)
  browExtra: number; // desplazamientos de la capa de expresión (se recalculan cada frame)
  smileExtra: number;
  dilateExtra: number;
  breathRate: number; // 1 normal, 0.6 lento (triste/cansado)
  breathPhase: number; // fase acumulada de respiración (evita saltos al cambiar el ritmo)
  jolt: number; // brinco instantáneo en unidades de R (risa, hmm); no se suaviza
  sparkAcc: number; // acumulador de emisión de chispas
  cierre: number; // 0 ojos abiertos → 1 cerrados suave (oración); rampa lineal, no parpadeo
  cierreT: number;
  flutter: number; // apertura extra de micro-aleteo con ojos cerrados (0..~0.12)
  flutterIn: number; // temporizador hasta el próximo aleteo
  flutterPhase: number; // −1 inactivo; ≥0 segundos dentro del aleteo
  jaw: number; // 0..1 mandíbula: sigue lipLevel con ataque rápido (altura + empuje abajo de la boca)
  serenidad: number; // 0..1 quietud: apaga vaivén de cabeza, respiración del halo y sacadas
  serenidadT: number;
  ring: number; // anillo de voz suavizado
  ring2: number;
  energia: number; // 0..1 energía ambiental suavizada
  motes: Mote[];
  sparkles: Sparkle[];
  lastTouch: { x: number; y: number; t: number } | null; // x,y en −0.5..0.5; t = performance.now()
}

export function crearVida(nMotas: number): Vida {
  return {
    wakeT: 0,
    wake: 0,
    lid: 1,
    lidT: 1,
    wide: 1,
    wideT: 1,
    browLift: 0,
    browLiftT: 0,
    browAsym: 0,
    browAsymT: 0,
    tilt: 0,
    tiltT: 0,
    lift: 0,
    liftT: 0,
    swayX: 0,
    gazeX: 0,
    gazeY: 0,
    gazeXT: 0,
    gazeYT: 0,
    laughAmp: 0,
    laughPhase: 0,
    yawn: 0,
    yawning: false,
    hmmIn: 2.4,
    hmm: 0,
    freeze: 0,
    blinkSpeed: 1,
    longBlink: false,
    mouthSkew: 0,
    mouthSkewT: 0,
    mouthExtra: 0,
    browExtra: 0,
    smileExtra: 0,
    dilateExtra: 0,
    breathRate: 1,
    breathPhase: 0,
    jolt: 0,
    sparkAcc: 0,
    cierre: 0,
    cierreT: 0,
    flutter: 0,
    flutterIn: 3,
    flutterPhase: -1,
    jaw: 0,
    serenidad: 0,
    serenidadT: 0,
    ring: 0,
    ring2: 0,
    energia: 0.4,
    motes: crearMotas(nMotas),
    sparkles: [],
    lastTouch: null,
  };
}

/** Lo que las funciones de dibujo necesitan saber de la escena en este frame. */
export interface Escena {
  face: FaceState;
  mode: Mode;
  t: number;
  lip: number;
  funMode: boolean;
}

// ───────────────────────── motas ambientales ─────────────────────────
export function crearMotas(n: number): Mote[] {
  const out: Mote[] = [];
  for (let i = 0; i < n; i++) {
    out.push({
      x: Math.random(),
      y: Math.random(),
      vx: (Math.random() - 0.5) * 0.012,
      vy: -0.004 - Math.random() * 0.01,
      r: 0.018 + Math.random() * 0.03,
      ph: Math.random() * Math.PI * 2,
      a: 0.25 + Math.random() * 0.45,
    });
  }
  return out;
}

export function actualizarMotas(motes: Mote[], dt: number, energia: number, t: number) {
  const speed = 0.25 + energia * 1.9;
  for (const m of motes) {
    m.x += (m.vx * speed + Math.sin(t * 0.6 + m.ph) * 0.003 * speed) * dt;
    m.y += m.vy * speed * dt;
    if (m.y < -0.05) {
      m.y = 1.05;
      m.x = Math.random();
    }
    if (m.x < -0.05) m.x = 1.05;
    else if (m.x > 1.05) m.x = -0.05;
  }
}

const spriteCache = new Map<string, HTMLCanvasElement>();
/** Sprite radial pre-renderizado (sin shadowBlur por partícula). */
export function spriteMota(color: string): HTMLCanvasElement | null {
  const hit = spriteCache.get(color);
  if (hit) return hit;
  if (typeof document === 'undefined') return null;
  const size = 48;
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const g = c.getContext('2d');
  if (!g) return null;
  const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, '#ffffff');
  grad.addColorStop(0.18, color);
  grad.addColorStop(0.55, color + '55');
  grad.addColorStop(1, color + '00');
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  spriteCache.set(color, c);
  return c;
}

export function drawMotes(
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  baseR: number,
  motes: Mote[],
  theme: Theme,
  energia: number,
  breath: number,
  wake: number,
  t: number
) {
  const sprite = spriteMota(theme.primary);
  if (!sprite) return;
  const cx = W / 2;
  const cy = H / 2;
  // Las motas "respiran" con la cara: se expanden y contraen un pelo desde el centro.
  const breathScale = 1 + (breath - 1) * 1.6;
  const vis = clamp(wake, 0, 1) * (0.35 + energia * 0.65);
  ctx.save();
  for (const m of motes) {
    const px = cx + (m.x * W - cx) * breathScale;
    const py = cy + (m.y * H - cy) * breathScale;
    const tw = 0.7 + 0.3 * Math.sin(t * (1.2 + energia * 2) + m.ph);
    const r = baseR * m.r * (0.8 + energia * 0.5) * tw;
    ctx.globalAlpha = m.a * vis * tw;
    ctx.drawImage(sprite, px - r, py - r, r * 2, r * 2);
  }
  ctx.restore();
}

// ───────────────────────── chispas (canto) ─────────────────────────
export function emitirChispa(list: Sparkle[], x: number, y: number, baseR: number, cap = 24) {
  if (list.length >= cap) return;
  list.push({
    x,
    y,
    vx: (Math.random() - 0.5) * baseR * 0.9,
    vy: -baseR * (0.9 + Math.random() * 1.1),
    life: 0,
    max: 0.9 + Math.random() * 0.6,
    r: baseR * (0.03 + Math.random() * 0.035),
  });
}

export function actualizarChispas(list: Sparkle[], dt: number) {
  for (let i = list.length - 1; i >= 0; i--) {
    const s = list[i];
    s.life += dt;
    s.x += s.vx * dt;
    s.y += s.vy * dt;
    s.vy *= 1 - dt * 0.8;
    if (s.life >= s.max) list.splice(i, 1);
  }
}

export function drawChispas(ctx: CanvasRenderingContext2D, list: Sparkle[], theme: Theme, t: number) {
  if (!list.length) return;
  ctx.save();
  ctx.fillStyle = theme.core;
  for (const s of list) {
    const k = s.life / s.max;
    const a = k < 0.2 ? k / 0.2 : 1 - (k - 0.2) / 0.8;
    const r = s.r * (0.7 + 0.3 * Math.sin(t * 18 + s.x));
    ctx.globalAlpha = clamp(a, 0, 1) * 0.9;
    ctx.beginPath();
    ctx.moveTo(s.x, s.y - r);
    ctx.lineTo(s.x + r * 0.35, s.y);
    ctx.lineTo(s.x, s.y + r);
    ctx.lineTo(s.x - r * 0.35, s.y);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}

// ───────────────────────── halo y anillo de voz ─────────────────────────
/** Halo exterior suave que respira. Un solo gradiente por frame. */
export function drawHalo(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  baseR: number,
  theme: Theme,
  intensity: number,
  warm = 0 // 0 cian de marca → 1 tono más claro y cálido (oración)
) {
  const R = baseR * 3.6;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(1.45, 1);
  const g = ctx.createRadialGradient(0, 0, baseR * 0.4, 0, 0, R);
  const a = clamp(intensity, 0, 1);
  const col = warm > 0.01 ? mixHex(theme.primary, theme.core, clamp(warm, 0, 1) * 0.45) : theme.primary;
  g.addColorStop(0, col + alphaHex(0.16 * a));
  g.addColorStop(0.45, col + alphaHex(0.07 * a));
  g.addColorStop(1, col + '00');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(0, 0, R, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

export function drawVoiceRing(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  baseR: number,
  eyeSpacing: number,
  theme: Theme,
  ring: number,
  ring2: number
) {
  if (ring < 0.01 && ring2 < 0.01) return;
  ctx.save();
  ctx.translate(cx, cy + baseR * 0.5);
  ctx.strokeStyle = theme.primary;
  ctx.lineCap = 'round';
  const rx = eyeSpacing + baseR * 1.75;
  const ry = baseR * 2.15;
  // Anillo principal: se expande con la voz.
  ctx.globalAlpha = clamp(ring, 0, 1) * 0.5;
  ctx.lineWidth = Math.max(1, baseR * 0.014);
  ctx.beginPath();
  ctx.ellipse(0, 0, rx + ring * baseR * 0.3, ry + ring * baseR * 0.22, 0, 0, Math.PI * 2);
  ctx.stroke();
  // Eco más tenue y rezagado.
  ctx.globalAlpha = clamp(ring2, 0, 1) * 0.22;
  ctx.lineWidth = Math.max(1, baseR * 0.008);
  ctx.beginPath();
  ctx.ellipse(0, 0, rx + baseR * 0.18 + ring2 * baseR * 0.55, ry + baseR * 0.14 + ring2 * baseR * 0.4, 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

export function drawShockwaves(ctx: CanvasRenderingContext2D, list: TouchRipple[]) {
  if (!list.length) return;
  ctx.save();
  for (const sw of list) {
    ctx.strokeStyle = sw.color;
    ctx.globalAlpha = sw.alpha * 0.7;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(sw.x, sw.y, sw.radius, 0, Math.PI * 2);
    ctx.stroke();
    if (sw.radius > 20) {
      ctx.globalAlpha = sw.alpha * 0.28;
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.arc(sw.x, sw.y, sw.radius * 0.7, 0, Math.PI * 2);
      ctx.stroke();
    }
  }
  ctx.restore();
}

function alphaHex(a: number) {
  const v = Math.round(clamp(a, 0, 1) * 255);
  return (v < 16 ? '0' : '') + v.toString(16);
}

/** Mezcla dos colores #rrggbb (k = 0 → a, 1 → b). */
export function mixHex(a: string, b: string, k: number): string {
  const pa = parseInt(a.slice(1, 7), 16);
  const pb = parseInt(b.slice(1, 7), 16);
  if (Number.isNaN(pa) || Number.isNaN(pb)) return a;
  const t = clamp(k, 0, 1);
  let out = '#';
  for (let s = 16; s >= 0; s -= 8) {
    const ca = (pa >> s) & 255;
    const cb = (pb >> s) & 255;
    const v = Math.round(ca + (cb - ca) * t);
    out += (v < 16 ? '0' : '') + v.toString(16);
  }
  return out;
}

// ───────────────────────── ojo vivo ─────────────────────────
export function aperturaOjo(A: AnimationEngineState, V: Vida, side: number) {
  const blink = side < 0 ? A.blinkL : A.blinkR;
  const base = blink * V.lid * V.wake * V.wide;
  // Cierre suave (oración): funde la apertura normal hacia una rendija serena con micro-aleteo.
  const k = smoothstep(V.cierre);
  return base * (1 - k) + k * (0.05 + V.flutter);
}

/**
 * Ojo OLED volumétrico (marca LOOI): disco con gradiente, brillo especular,
 * borde neón y ceja. Sonrisa alta → arco feliz. `dilate` mueve el núcleo
 * brillante (pupila visible sin pintar un punto negro).
 */
export function drawLivingEye(
  ctx: CanvasRenderingContext2D,
  ex: number,
  ey: number,
  R: number,
  theme: Theme,
  E: Escena,
  A: AnimationEngineState,
  V: Vida,
  side: number // -1 izquierdo, 1 derecho
) {
  const open = aperturaOjo(A, V, side);
  const isHappy =
    E.face === 'HAPPY' || E.face === 'PURR' || E.face === 'LAUGH' || A.smile > 0.75;
  const rx = R;
  const ry = Math.max(2, R * open);
  const dil = clamp(A.dilate + V.dilateExtra, 0.12, 0.75);

  ctx.save();
  ctx.translate(ex, ey);

  if (E.face === 'THINKING') {
    ctx.rotate(side * 0.12 * Math.sin(E.t * 2));
  }

  // Arcos felices (sonrisa, mimos, risa)
  if (isHappy && open > 0.15) {
    const squeeze = E.face === 'LAUGH' ? 0.1 * V.laughAmp * Math.abs(Math.sin(V.laughPhase)) : 0;
    ctx.save();
    ctx.strokeStyle = theme.primary;
    ctx.lineWidth = R * (0.18 + squeeze * 0.4);
    ctx.lineCap = 'round';
    ctx.shadowColor = theme.glow;
    ctx.shadowBlur = 24;
    ctx.beginPath();
    ctx.arc(0, R * (0.18 + squeeze), rx * (0.85 - squeeze), Math.PI * 1.15, Math.PI * 1.85);
    ctx.stroke();
    ctx.strokeStyle = theme.core;
    ctx.lineWidth = R * 0.08;
    ctx.shadowBlur = 0;
    ctx.beginPath();
    ctx.arc(0, R * (0.18 + squeeze), rx * (0.85 - squeeze), Math.PI * 1.2, Math.PI * 1.8);
    ctx.stroke();
    ctx.restore();
    drawBrow(ctx, R, open, theme, A, V, side);
    ctx.restore();
    return;
  }

  // Halo neón multicapa
  const halo = ctx.createRadialGradient(0, 0, rx * 0.4, 0, 0, rx * 1.45);
  halo.addColorStop(0, theme.primary + '38');
  halo.addColorStop(0.65, theme.primary + '12');
  halo.addColorStop(1, '#00000000');
  ctx.fillStyle = halo;
  ctx.beginPath();
  ctx.ellipse(0, 0, rx * 1.4, ry * 1.4, 0, 0, Math.PI * 2);
  ctx.fill();

  if (open > 0.1) {
    ctx.save();
    ctx.beginPath();
    ctx.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2);
    ctx.clip();

    // Disco esférico; el núcleo brillante crece con la dilatación.
    const eyeGrad = ctx.createRadialGradient(
      A.lx * rx * 0.25,
      A.ly * ry * 0.25 - ry * 0.1,
      rx * 0.1,
      0,
      0,
      rx * 1.05
    );
    eyeGrad.addColorStop(0, theme.core);
    eyeGrad.addColorStop(clamp(0.18 + dil * 0.45, 0.2, 0.62), theme.primary);
    eyeGrad.addColorStop(0.85, theme.glow + 'cc');
    eyeGrad.addColorStop(1, theme.dark);
    ctx.fillStyle = eyeGrad;
    ctx.shadowColor = theme.primary;
    ctx.shadowBlur = 28;
    ctx.beginPath();
    ctx.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;

    // Anillo de iris tenue: da profundidad y hace visible la dilatación.
    const irisR = rx * (0.26 + dil * 0.55);
    ctx.strokeStyle = theme.dark;
    ctx.globalAlpha = 0.2;
    ctx.lineWidth = rx * 0.06;
    ctx.beginPath();
    ctx.ellipse(A.lx * rx * 0.28, A.ly * ry * 0.28, irisR, irisR * Math.min(1, ry / rx + 0.15), 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = 1;

    // Brillos especulares que siguen la mirada
    const lookOffsetX = A.lx * rx * 0.32;
    const lookOffsetY = A.ly * ry * 0.32;
    ctx.fillStyle = '#ffffff';
    ctx.shadowColor = '#ffffff';
    ctx.shadowBlur = 8;
    ctx.globalAlpha = 0.95;
    ctx.beginPath();
    ctx.arc(lookOffsetX - rx * 0.32, lookOffsetY - ry * 0.32, rx * 0.16 * A.breath, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 0.65;
    ctx.beginPath();
    ctx.arc(lookOffsetX + rx * 0.28, lookOffsetY + ry * 0.28, rx * 0.08, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // Borde neón de precisión
  ctx.strokeStyle = theme.primary;
  ctx.lineWidth = R * 0.055;
  ctx.shadowColor = theme.glow;
  ctx.shadowBlur = 18;
  ctx.beginPath();
  ctx.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.shadowBlur = 0;

  drawBrow(ctx, R, open, theme, A, V, side);
  ctx.restore();
}

/**
 * Ceja ciber. `A.brow` > 0 inclina hacia el centro (enojo), < 0 levanta el
 * interior (tristeza/súplica). `V.browLift` sube ambas en paralelo (sorpresa) y
 * `V.browAsym` sube sólo una (curioso / pensando).
 */
function drawBrow(
  ctx: CanvasRenderingContext2D,
  R: number,
  open: number,
  theme: Theme,
  A: AnimationEngineState,
  V: Vida,
  side: number
) {
  const brow = A.brow + V.browExtra;
  const lift = V.browLift + Math.max(0, side * V.browAsym) * 0.7;
  const strength = Math.max(Math.abs(brow), lift);
  if (strength < 0.08) return;
  const by = R * Math.max(0.55, Math.min(open, 1)); // anclaje estable durante el parpadeo
  const alpha = clamp((strength - 0.08) / 0.22, 0, 1);

  ctx.save();
  ctx.strokeStyle = theme.primary;
  ctx.globalAlpha = alpha;
  ctx.lineWidth = R * 0.07;
  ctx.lineCap = 'round';
  ctx.shadowColor = theme.glow;
  ctx.shadowBlur = 12;
  const browY = -by * (1.15 + Math.max(0, brow) * 0.28) - lift * R * 0.38 - Math.max(0, -brow) * R * 0.08;
  const outerX = -side * R * 0.95;
  const innerX = side * R * 0.65;
  ctx.beginPath();
  ctx.moveTo(outerX, browY - brow * R * 0.2);
  ctx.lineTo(innerX, browY + brow * R * 0.22);
  ctx.stroke();
  ctx.restore();
}

// ───────────────────────── boca ─────────────────────────
/**
 * Boca ciber paramétrica: `A.mouth` abre (0 línea, 1 muy abierta), `A.smile`
 * curva las comisuras (+ sonrisa, − mueca) y `V.mouthSkew` la ladea (travieso).
 * Con funMode, CREATIVE y EXPLORER conservan sus bocas de tablet.
 */
export function drawCyberMouth(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  baseR: number,
  theme: Theme,
  E: Escena,
  A: AnimationEngineState,
  V: Vida
) {
  const color = theme.primary;
  ctx.save();
  // Mandíbula: al hablar la boca baja un poco además de abrirse; se lee de lejos.
  ctx.translate(cx, cy + baseR * 0.14 * V.jaw);
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = baseR * 0.06;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.shadowColor = color;
  ctx.shadowBlur = 16;
  ctx.globalAlpha = clamp(V.wake * 1.3, 0, 1);

  const mw = baseR * 0.85;

  if (E.funMode && E.mode === 'CREATIVE') {
    ctx.beginPath();
    for (let x = -mw * 0.5; x <= mw * 0.5; x += 4) {
      const wave = Math.sin(x * 0.12 + E.t * 6) * (baseR * 0.12);
      if (x === -mw * 0.5) ctx.moveTo(x, wave);
      else ctx.lineTo(x, wave);
    }
    ctx.stroke();
    ctx.restore();
    return;
  }
  if (E.funMode && E.mode === 'EXPLORER') {
    ctx.beginPath();
    ctx.arc(0, baseR * 0.45, mw * 0.5, Math.PI * 1.25, Math.PI * 1.75);
    ctx.stroke();
    ctx.restore();
    return;
  }

  const mouth = clamp(A.mouth + V.mouthExtra, 0, 1.15);
  const smile = clamp(A.smile + V.smileExtra, -1.2, 1.3);
  const skew = V.mouthSkew;
  const w = mw * 0.45 * (1 + 0.1 * smile + 0.08 * mouth - 0.06 * V.jaw);
  const h = baseR * (0.028 + 0.46 * mouth + 0.09 * V.jaw);
  const curv = smile * baseR * 0.2;
  const cornerL = -curv + skew * baseR * 0.07;
  const cornerR = -curv - skew * baseR * 0.07;

  ctx.rotate(skew * 0.1);
  ctx.beginPath();
  ctx.moveTo(-w, cornerL);
  ctx.quadraticCurveTo(0, curv * 0.9 - h, w, cornerR);
  ctx.quadraticCurveTo(0, curv * 0.9 + h, -w, cornerL);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  // Interior oscuro cuando la boca se abre: profundidad sin perder el neón.
  if (mouth > 0.22) {
    const k = clamp((mouth - 0.22) / 0.5, 0, 1);
    ctx.shadowBlur = 0;
    ctx.fillStyle = theme.dark;
    ctx.globalAlpha = 0.55 * k * clamp(V.wake, 0, 1);
    const iw = w * 0.62;
    const ih = h * 0.55;
    ctx.beginPath();
    ctx.moveTo(-iw, curv * 0.5);
    ctx.quadraticCurveTo(0, curv * 0.9 - ih, iw, curv * 0.5);
    ctx.quadraticCurveTo(0, curv * 0.9 + ih, -iw, curv * 0.5);
    ctx.closePath();
    ctx.fill();
  }

  ctx.restore();
}
