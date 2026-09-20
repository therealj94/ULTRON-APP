/**
 * dibujo.ts — helpers de dibujo de la cara "limpia": tema por modo, ojos vivos,
 * boca paramétrica, halo que respira, motas ambientales, chispas y anillo de voz.
 * Todo lo que es "juguete" vive en funPack.ts. Nada aquí usa shadowBlur dentro
 * de bucles por partícula: las motas van con un sprite pre-renderizado.
 */
import type { Mode, FaceState, AnimationEngineState, TouchRipple } from '../types';
import { perfil } from '../perfil';

export interface Theme {
  primary: string;
  glow: string;
  core: string;
  accent: string;
  dark: string;
}

/** Mezcla un hex hacia el blanco (t>0) o hacia el negro (t<0). Para derivar brillo y sombra de un acento. */
function mezclar(hex: string, t: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  const canal = (c: number) => Math.round(t >= 0 ? c + (255 - c) * t : c * (1 + t));
  const r = canal((n >> 16) & 255);
  const g = canal((n >> 8) & 255);
  const b = canal(n & 255);
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0').toUpperCase()}`;
}

/**
 * Paleta derivada del acento de la plataforma. El Cerebro de Minas tiene que verse distinto de
 * Genesis de un vistazo: si solo cambia el rótulo, es la misma app con otro nombre. El `accent`
 * secundario de cada modo se respeta, que es lo que da variedad dentro de una misma plataforma.
 */
function paletaDeAcento(base: string, secundario: string): Theme {
  return { primary: base, glow: mezclar(base, 0.35), core: mezclar(base, 0.85), accent: secundario, dark: mezclar(base, -0.85) };
}

/** Paleta OLED por modo. En Genesis la marca es negro + cian #05E1FF; otra plataforma, otro acento. */
export function getThemeColors(m: Mode): Theme {
  const p = perfil();
  // GOLD es oro a propósito en cualquier plataforma: es el modo del metal, no de la marca.
  if (p.id !== 'genesis' && m !== 'GOLD') return paletaDeAcento(p.acento, baseDelModo(m).accent);
  return baseDelModo(m);
}

function baseDelModo(m: Mode): Theme {
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
  // ── boca: formas por emoción y visemas ──
  mouthRound: number; // 0..1 boca en «o» (sorpresa, «oh» táctil, visema redondo)
  mouthRoundT: number;
  mouthPress: number; // 0..1 labio apretado (molestia): fino, ancho, línea central
  mouthPressT: number;
  mouthWidth: number; // multiplicador de ancho (0.6 oración … 1.1 molestia)
  mouthWidthT: number;
  mouthStretch: number; // −1..1 estirada hacia un lado (arrastre)
  mouthStretchT: number;
  visRound: number; // visema actual: redondo («o/u»)
  visRoundT: number;
  visWide: number; // visema actual: ancho («e/i»)
  visWideT: number;
  visAsym: number; // −1..1 asimetría orgánica del labio inferior
  visAsymT: number;
  visLast: number; // lipLevel suavizado del frame anterior (detecta ataques)
  visHold: number; // segundos que se sostiene el visema actual
  // ── cejas ──
  browWorry: number; // 0..1 interior arriba y juntas (preocupación / súplica)
  browWorryT: number;
  browTwitch: number; // envolvente del tic de ceja en reposo (1 px)
  browTwitchSide: number; // −1 izquierda, 1 derecha
  browTwitchIn: number; // temporizador hasta el próximo tic
  pupilDrift: number; // deriva lenta de pupila en reposo
  // ── tacto ──
  squashL: number; // 0..1 aplastamiento del ojo izquierdo al tocarlo (decae)
  squashR: number;
  touchOh: number; // «oh» corto al tocar la barbilla (decae)
  touchSmile: number; // sonrisa al tocar la mejilla (decae)
  touchSmileSide: number; // -1..1 lado hacia el que tira esa sonrisa (se ladea vía mouthSkewT mientras dura)
  annoy: number; // molestia juguetona por toques repetidos (cejas + labio apretado)
  lookVX: number; // velocidad del muelle de mirada al arrastrar
  lookVY: number;
  // ── atención a la persona (cameraGaze) ──
  atencion: number; // 0..1 brillo + giro sutil hacia la persona
  atencionT: number;
  camX: number; // −1..1 lado de la persona, suavizado
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
    mouthRound: 0,
    mouthRoundT: 0,
    mouthPress: 0,
    mouthPressT: 0,
    mouthWidth: 1,
    mouthWidthT: 1,
    mouthStretch: 0,
    mouthStretchT: 0,
    visRound: 0,
    visRoundT: 0,
    visWide: 0,
    visWideT: 0,
    visAsym: 0,
    visAsymT: 0,
    visLast: 0,
    visHold: 0,
    browWorry: 0,
    browWorryT: 0,
    browTwitch: 0,
    browTwitchSide: 1,
    browTwitchIn: 3,
    pupilDrift: 0,
    squashL: 0,
    squashR: 0,
    touchOh: 0,
    touchSmile: 0,
    touchSmileSide: 0,
    annoy: 0,
    lookVX: 0,
    lookVY: 0,
    atencion: 0,
    atencionT: 0,
    camX: 0,
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
  const wk = clamp(warm, 0, 1);
  const col = wk > 0.01 ? mixHex(theme.primary, theme.core, wk * 0.55) : theme.primary;
  g.addColorStop(0, col + alphaHex((0.16 + 0.1 * wk) * a));
  g.addColorStop(0.45, col + alphaHex((0.07 + 0.05 * wk) * a));
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

/** Onda de toque: anillo fino que se expande desacelerando y se disuelve, más un eco interior. */
export function drawShockwaves(ctx: CanvasRenderingContext2D, list: TouchRipple[]) {
  if (!list.length) return;
  ctx.save();
  ctx.lineCap = 'round';
  for (const sw of list) {
    const k = clamp(sw.radius / sw.maxRadius, 0, 1);
    const fade = (1 - k) * (1 - k);
    ctx.strokeStyle = sw.color;
    // Un solo shadowBlur por onda (máximo 5 vivas): barato y evita que el anillo se vea como un contorno gris.
    ctx.shadowColor = sw.color;
    ctx.shadowBlur = 14 * fade;
    ctx.globalAlpha = fade * 0.9;
    ctx.lineWidth = Math.max(1, 3 * (1 - k * 0.5));
    ctx.beginPath();
    ctx.arc(sw.x, sw.y, sw.radius, 0, Math.PI * 2);
    ctx.stroke();
    // Eco interior más tenue, un poco rezagado.
    ctx.shadowBlur = 0;
    ctx.globalAlpha = fade * 0.3;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(sw.x, sw.y, sw.radius * 0.62, 0, Math.PI * 2);
    ctx.stroke();
    // Punto de contacto que se apaga rápido.
    if (k < 0.35) {
      ctx.globalAlpha = (1 - k / 0.35) * 0.6;
      ctx.fillStyle = sw.color;
      ctx.beginPath();
      ctx.arc(sw.x, sw.y, 4 * (1 - k / 0.35), 0, Math.PI * 2);
      ctx.fill();
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

/** Trazo neón: cuerpo con resplandor + filamento claro. Sólo para piezas únicas (cejas, párpados), nunca por partícula. */
function strokeNeon(
  ctx: CanvasRenderingContext2D,
  path: Path2D,
  color: string,
  core: string,
  w: number,
  alpha: number,
  blur = 14
) {
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = color;
  ctx.globalAlpha = alpha;
  ctx.lineWidth = w;
  if (blur > 0) {
    ctx.shadowColor = color;
    ctx.shadowBlur = blur;
  }
  ctx.stroke(path);
  ctx.shadowBlur = 0;
  ctx.strokeStyle = core;
  ctx.globalAlpha = alpha * 0.5;
  ctx.lineWidth = w * 0.36;
  ctx.stroke(path);
  ctx.globalAlpha = 1;
}

/**
 * Ojo OLED volumétrico (marca LOOI): disco con gradiente, brillo especular,
 * borde neón y ceja. Sonrisa alta → arco feliz. `dilate` mueve el núcleo
 * brillante (pupila visible sin pintar un punto negro). Con `cierre` alto
 * (oración) el ojo es un párpado sereno en arco, distinto de la raya de dormir.
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
  const sq = clamp(side < 0 ? V.squashL : V.squashR, 0, 1);
  const rx = R * (1 + 0.16 * sq);
  const ry = Math.max(2, R * open * (1 - 0.45 * sq));
  const dil = clamp(A.dilate + V.dilateExtra, 0.12, 0.75);

  ctx.save();
  ctx.translate(ex, ey);

  if (E.face === 'THINKING') {
    ctx.rotate(side * 0.12 * Math.sin(E.t * 2));
  }

  // Párpado sereno (oración): arco suave hacia abajo, con brillo, nada de raya plana.
  const k = smoothstep(V.cierre);
  if (k > 0.6 && E.face !== 'SLEEPING') {
    const a = clamp((k - 0.6) / 0.3, 0, 1);
    const bulge = R * (0.34 - V.flutter * 1.6);
    const p = new Path2D();
    p.moveTo(-R * 0.92, -R * 0.02);
    p.quadraticCurveTo(0, bulge, R * 0.92, -R * 0.02);
    strokeNeon(ctx, p, theme.primary, theme.core, R * 0.15, a);
    // Pestaña exterior: un trazo corto que da dirección al párpado.
    const l = new Path2D();
    l.moveTo(side * R * 0.9, -R * 0.01);
    l.quadraticCurveTo(side * R * 1.0, R * 0.04, side * R * 1.02, R * 0.12);
    strokeNeon(ctx, l, theme.primary, theme.core, R * 0.06, a * 0.6);
    drawBrow(ctx, R, 0.78, theme, A, V, side);
    ctx.restore();
    return;
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
    ctx.globalAlpha = 0.2 + 0.18 * (1 - dil); // pupila chica (sorpresa) → anillo más marcado
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
 * Ceja ciber en arco. Siempre presente (tenue en reposo, plena al expresar).
 * `A.brow` > 0 baja el extremo medial (junto a la nariz: V de enojo), < 0 lo levanta
 * (tristeza). `V.browWorry` levanta y junta los extremos mediales (preocupación).
 * Ojo: con side = -1 el ojo está en x negativa, así que el lateral es `side*R` y el medial `-side*R`.
 * `V.browLift` sube ambas y las arquea (sorpresa); `V.browAsym` sube sólo una
 * (curioso / pensando). `V.browTwitch` es el tic de 1 px en reposo.
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
  const brow = clamp(A.brow + V.browExtra, -1.2, 1.3);
  const worry = clamp(V.browWorry, 0, 1);
  const lift = clamp(V.browLift + Math.max(0, side * V.browAsym) * 0.7, 0, 1.6);
  const strength = Math.max(Math.abs(brow), lift, worry);
  const alpha = (0.42 + 0.58 * clamp(strength / 0.3, 0, 1)) * clamp(V.wake, 0, 1);
  const by = R * Math.max(0.55, Math.min(open, 1)); // anclaje estable durante el parpadeo
  const twitch = V.browTwitchSide === side ? V.browTwitch * R * 0.02 : 0;

  const browY = -by * (1.18 + Math.max(0, brow) * 0.22) - lift * R * 0.42 - Math.max(0, -brow) * R * 0.06 - twitch;
  // El ojo izquierdo (side = -1) está en x negativa: su extremo LATERAL (sien) es `side * R`
  // y el MEDIAL (hacia la nariz) es `-side * R * …`. Con worry/enojo el medial se acerca al centro.
  const outerX = side * R * 1.0;
  const innerX = -side * R * (0.68 + worry * 0.2 + Math.max(0, brow) * 0.08);
  // Extremo lateral (sien): sube con enojo, baja con tristeza/preocupación.
  const outerY = browY - brow * R * 0.16 + worry * R * 0.1;
  // Extremo medial (nariz): baja con enojo (V), sube con tristeza y preocupación (/ \).
  const innerY = browY + Math.max(0, brow) * R * 0.3 - Math.max(0, -brow) * R * 0.22 - worry * R * 0.3;
  // Arco: relajado siempre un poco; más con sorpresa y felicidad, casi recto al enojarse.
  const arch = R * (0.1 + lift * 0.22 + Math.max(0, -brow) * 0.04 - Math.max(0, brow) * 0.07 + worry * 0.06);
  const midX = (outerX + innerX) * 0.5 - side * R * 0.05;
  const midY = (outerY + innerY) * 0.5 - arch;

  const p = new Path2D();
  p.moveTo(outerX, outerY);
  p.quadraticCurveTo(midX, midY, innerX, innerY);
  ctx.save();
  // Coste por frame: en reposo (strength < 0.1) la ceja va SIN shadowBlur (sólo trazo + filamento);
  // el resplandor entra gradualmente (0 → 14) sólo cuando la ceja expresa algo.
  const blur = strength < 0.1 ? 0 : 6 + 8 * clamp((strength - 0.1) / 0.25, 0, 1);
  strokeNeon(ctx, p, theme.primary, theme.core, R * (0.085 + 0.02 * Math.max(0, brow)), alpha, blur);
  ctx.restore();
}

// ───────────────────────── boca ─────────────────────────
/**
 * Boca paramétrica con jerarquía real: dos labios en Bézier cúbica, interior
 * oscuro con profundidad y comisuras.
 *  - `A.mouth` + `V.mouthExtra` abre (0 cerrada, 1 muy abierta); `V.jaw` baja la mandíbula.
 *  - `A.smile` + `V.smileExtra` sube (+) o baja (−) las comisuras.
 *  - `V.mouthRound` / `V.visRound` redondean («o»); `V.visWide` ensancha («e»).
 *  - `V.mouthPress` aprieta el labio (molestia); `V.mouthWidth` escala el ancho.
 *  - `V.mouthSkew` ladea (travieso); `V.mouthStretch` estira hacia el dedo; `V.visAsym` desnivela el labio inferior.
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
  const R = baseR;
  ctx.save();
  // Mandíbula: al hablar la boca baja un poco además de abrirse; se lee de lejos.
  ctx.translate(cx + V.mouthStretch * R * 0.26, cy + R * 0.14 * V.jaw);
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = R * 0.06;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const wakeA = clamp(V.wake * 1.3, 0, 1);
  ctx.globalAlpha = wakeA;

  const mw = R * 0.85;

  if (E.funMode && E.mode === 'CREATIVE') {
    ctx.shadowColor = color;
    ctx.shadowBlur = 16;
    ctx.beginPath();
    for (let x = -mw * 0.5; x <= mw * 0.5; x += 4) {
      const wave = Math.sin(x * 0.12 + E.t * 6) * (R * 0.12);
      if (x === -mw * 0.5) ctx.moveTo(x, wave);
      else ctx.lineTo(x, wave);
    }
    ctx.stroke();
    ctx.restore();
    return;
  }
  if (E.funMode && E.mode === 'EXPLORER') {
    ctx.shadowColor = color;
    ctx.shadowBlur = 16;
    ctx.beginPath();
    ctx.arc(0, R * 0.45, mw * 0.5, Math.PI * 1.25, Math.PI * 1.75);
    ctx.stroke();
    ctx.restore();
    return;
  }

  const mouth = clamp(A.mouth + V.mouthExtra, 0, 1.2);
  const smile = clamp(A.smile + V.smileExtra, -1.2, 1.4);
  const round = clamp(V.mouthRound + V.visRound, 0, 1);
  const wide = clamp(V.visWide, 0, 1) * (1 - round);
  const press = clamp(V.mouthPress, 0, 1);
  const skew = V.mouthSkew;
  const stretch = clamp(V.mouthStretch, -1, 1);
  const asym = clamp(V.visAsym, -1, 1) * clamp(mouth * 2, 0, 1);
  const jaw = clamp(V.jaw, 0, 1);

  // Ancho: la sonrisa y el visema ancho lo abren; la «o» lo cierra.
  const w =
    R *
    0.6 *
    V.mouthWidth *
    (1 + 0.3 * Math.max(0, smile) + 0.16 * wide + 0.14 * press - 0.3 * round - 0.08 * mouth * round - 0.12 * Math.min(0, smile));
  // Alto: la apertura manda; el labio apretado la aplasta; la «o» la estira.
  const open = mouth * (1 - 0.6 * press);
  const h = R * (0.03 + 0.5 * open + 0.08 * jaw) * (1 + 0.35 * round);
  const curv = (smile > 0 ? smile * R * 0.24 : smile * R * 0.17) * (1 - 0.5 * round) * (1 - 0.55 * press);
  const pout = Math.max(0, -smile) * R * 0.04; // labio inferior hacia afuera en tristeza
  const wL = w * (1 - 0.22 * stretch);
  const wR = w * (1 + 0.22 * stretch);
  const cornerL = -curv + skew * R * 0.08;
  const cornerR = -curv - skew * R * 0.08;
  const kx = 0.52 + 0.1 * round - 0.12 * wide; // redondez de las curvas (0.55 ≈ elipse)
  const yU = curv * 0.5 - h * (0.4 + 0.15 * round);
  const yL = curv * 0.5 + h * (0.6 + 0.2 * round) + jaw * R * 0.05 + pout;
  const ax = asym * w * 0.3;

  ctx.rotate(skew * 0.08 + stretch * 0.07);

  const labios = new Path2D();
  labios.moveTo(-wL, cornerL);
  labios.bezierCurveTo(-wL * kx, yU, wR * kx, yU, wR, cornerR);
  labios.bezierCurveTo(wR * kx + ax, yL, -wL * kx + ax, yL, -wL, cornerL);
  labios.closePath();

  // Volumen del labio: gradiente vertical claro arriba → primario abajo.
  const top = Math.min(cornerL, cornerR, yU);
  const bot = Math.max(cornerL, cornerR, yL);
  const g = ctx.createLinearGradient(0, top, 0, bot);
  g.addColorStop(0, theme.glow);
  g.addColorStop(0.55, color);
  g.addColorStop(1, mixHex(color, theme.dark, 0.25));
  ctx.fillStyle = g;
  ctx.shadowColor = color;
  ctx.shadowBlur = 12; // antes 20: mismo halo perceptible, menos coste con dpr 2
  ctx.fill(labios);
  ctx.shadowBlur = 0;
  ctx.strokeStyle = color;
  ctx.lineWidth = R * 0.05;
  ctx.stroke(labios);

  // Interior oscuro cuando la boca se abre: cavidad con profundidad, sin perder el neón.
  if (open > 0.14) {
    const k = clamp((open - 0.14) / 0.4, 0, 1);
    const lipT = R * (0.055 + 0.03 * open); // grosor del labio
    const iwL = Math.max(1, wL - lipT * 1.4);
    const iwR = Math.max(1, wR - lipT * 1.4);
    const iyU = yU + lipT;
    const iyL = yL - lipT * 0.9;
    const cav = new Path2D();
    cav.moveTo(-iwL, cornerL * 0.85 + lipT * 0.2);
    cav.bezierCurveTo(-iwL * kx, iyU, iwR * kx, iyU, iwR, cornerR * 0.85 + lipT * 0.2);
    cav.bezierCurveTo(iwR * kx + ax, iyL, -iwL * kx + ax, iyL, -iwL, cornerL * 0.85 + lipT * 0.2);
    cav.closePath();
    const cg = ctx.createRadialGradient(0, (iyU + iyL) * 0.5, 0, 0, (iyU + iyL) * 0.5, Math.max(iwL, iwR));
    cg.addColorStop(0, '#000000');
    cg.addColorStop(0.7, theme.dark);
    cg.addColorStop(1, mixHex(theme.dark, color, 0.2));
    ctx.fillStyle = cg;
    ctx.globalAlpha = wakeA * (0.55 + 0.4 * k);
    ctx.fill(cav);
    // Lengua / fondo iluminado: elipse tenue abajo, hace la boca 3D.
    if (k > 0.35) {
      ctx.globalAlpha = wakeA * 0.28 * (k - 0.35) * (1 - round * 0.5);
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.ellipse(ax * 0.5, iyL - (iyL - iyU) * 0.22, Math.max(1, Math.min(iwL, iwR) * 0.55), Math.max(1, (iyL - iyU) * 0.18), 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = wakeA;
  }

  // Labio apretado: línea central oscura entre los labios.
  if (press > 0.25 && open < 0.2) {
    ctx.globalAlpha = wakeA * clamp((press - 0.25) / 0.5, 0, 1) * 0.7;
    ctx.strokeStyle = theme.dark;
    ctx.lineWidth = R * 0.028;
    ctx.beginPath();
    ctx.moveTo(-w * 0.8, curv * 0.35 + cornerL * 0.4);
    ctx.quadraticCurveTo(0, curv * 0.55, w * 0.8, curv * 0.35 + cornerR * 0.4);
    ctx.stroke();
    ctx.globalAlpha = wakeA;
  }

  // Comisuras: puntos de brillo que rematan la sonrisa amplia, pegados al extremo del labio
  // (centrados sobre la comisura, no separados) y con halo cian para que no floten como puntos grises sueltos.
  const ca = clamp((smile - 0.55) / 0.7, 0, 1);
  if (ca > 0.01) {
    const dy = -R * 0.02;
    const r = R * (0.024 + 0.02 * ca);
    const dot = new Path2D();
    dot.arc(-wL - R * 0.005, cornerL + dy, r, 0, Math.PI * 2);
    dot.arc(wR + R * 0.005, cornerR + dy, r, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.shadowColor = color;
    ctx.shadowBlur = 6;
    ctx.globalAlpha = wakeA * ca * 0.9;
    ctx.fill(dot);
    ctx.shadowBlur = 0;
    ctx.fillStyle = theme.core;
    ctx.globalAlpha = wakeA * ca * 0.7;
    ctx.fill(dot);
  }

  ctx.restore();
}
