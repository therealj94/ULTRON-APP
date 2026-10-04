/**
 * EL ROSTRO DE AU-RA: la pantalla de su cara, dibujada cuadro a cuadro.
 *
 * Antes eran dos óvalos de luz y una boca que cambiaba de pieza (sonrisa, «o», línea): se leía la
 * emoción, pero no se sentía. Ahora la cara es una pantalla viva, como la de un compañero robot de
 * verdad:
 *
 *  · Los ojos tienen párpados (arriba y abajo) que se cierran con curva, cejas que los cortan en
 *    ángulo (enojo, tristeza, duda), un brillo que sigue la mirada y un resplandor que respira.
 *  · Sonreír sube el párpado de abajo y el ojo queda en arco «^ ^»; la risa los aprieta «> <»; el
 *    cariño los vuelve corazones que laten; la tristeza deja caer una lágrima.
 *  · La boca sigue el audio de verdad (el nivel que manda la voz) y cambia de forma con la emoción.
 *  · Parpadea con ritmo humano (a veces doble), mira de reojo cuando está quieta, se sonroja.
 *
 * Todo sale de dos cosas: `rasgosDe(ánimo)` (pura: qué cara pone cada emoción; la prueba la fija sin
 * navegador) y `Rostro`, que lleva los rasgos hacia esa cara con suavidad y los dibuja en un canvas
 * 2D. La sala pone ese canvas como textura de su visor (sala.ts).
 */
import type { Animo } from './tareas';

/** Algo especial en lugar de los ojos de siempre. */
export type Especial = 'ninguno' | 'risa' | 'corazones' | 'dormido' | 'estrellas';

/** La cara, en números: lo que se interpola de una emoción a otra. */
export type Rasgos = {
  /** Apertura del ojo (0 cerrado, 1 normal, 1.3 muy abierto). */
  abre: number;
  /** Ojo en arco de sonrisa «^» (0..1): el párpado de abajo sube en curva. */
  feliz: number;
  /** Ceja: −1 triste (el lado de adentro sube), +1 enojo (el lado de adentro baja). */
  ceja: number;
  /** Tamaño del ojo. */
  escala: number;
  /** Brillo interior (pupila de luz): más grande = más tierno/atento. */
  pupila: number;
  /** Hacia dónde mira la emoción (pensar mira arriba, tristeza abajo). −1..1. */
  miraX: number;
  miraY: number;
  /** Asimetría: positivo agranda el ojo derecho y achica el izquierdo (curiosidad, duda). */
  ladeo: number;
  /** Guiño del ojo izquierdo (0..1). */
  guino: number;
  /** Boca: curva (−1 triste, 1 sonrisa), apertura, ancho y cuánto de «o». */
  bocaCurva: number;
  bocaAbre: number;
  bocaAncho: number;
  bocaO: number;
  /** Rubor (0..1). */
  rubor: number;
  /** Intensidad de la luz de la cara. */
  brillo: number;
  /** Tinte de la luz [r, g, b] 0..255. */
  tono: [number, number, number];
  /** Lágrima (0..1). */
  lagrima: number;
};

export type Cara = { rasgos: Rasgos; especial: Especial };

const LUZ: [number, number, number] = [247, 235, 208];

export const RASGOS_BASE: Rasgos = {
  abre: 1, feliz: 0, ceja: 0, escala: 1, pupila: 1, miraX: 0, miraY: 0, ladeo: 0, guino: 0,
  bocaCurva: 0.35, bocaAbre: 0, bocaAncho: 1, bocaO: 0, rubor: 0, brillo: 1, tono: LUZ, lagrima: 0,
};

/** La cara de cada ánimo. Pura: la prueba (tests/sala-rostro.test.ts) la fija sin navegador. */
export function rasgosDe(animo: Animo): Cara {
  const r: Rasgos = { ...RASGOS_BASE, tono: [...LUZ] as [number, number, number] };
  let especial: Especial = 'ninguno';
  switch (animo) {
    case 'feliz':
      Object.assign(r, { feliz: 0.85, abre: 1, bocaCurva: 0.95, bocaAncho: 1.15, bocaAbre: 0.18, rubor: 0.55, brillo: 1.15, pupila: 1.1 });
      r.tono = [255, 236, 196];
      break;
    case 'orgullo':
      Object.assign(r, { feliz: 0.6, abre: 0.85, ceja: 0.12, bocaCurva: 0.8, bocaAncho: 1.05, rubor: 0.35, brillo: 1.15 });
      r.tono = [255, 226, 160];
      break;
    case 'risa':
      especial = 'risa';
      Object.assign(r, { feliz: 1, bocaCurva: 1, bocaAbre: 0.75, bocaAncho: 1.2, rubor: 0.75, brillo: 1.2 });
      r.tono = [255, 236, 190];
      break;
    case 'sorpresa':
      Object.assign(r, { abre: 1.18, escala: 1.08, pupila: 0.7, ceja: -0.35, bocaCurva: 0, bocaO: 1, bocaAbre: 0.65, bocaAncho: 0.75, brillo: 1.2 });
      break;
    case 'alarma':
      Object.assign(r, { abre: 1.15, escala: 1.06, pupila: 0.6, ceja: -0.65, bocaCurva: -0.3, bocaO: 0.7, bocaAbre: 0.45, bocaAncho: 0.8, brillo: 1.25 });
      r.tono = [255, 196, 120];
      break;
    case 'curioso':
      Object.assign(r, { abre: 1.1, ladeo: 0.28, miraX: 0.25, miraY: -0.1, ceja: -0.15, bocaCurva: 0.25, bocaAncho: 0.7, bocaO: 0.25, pupila: 1.15 });
      break;
    case 'escepticismo':
      Object.assign(r, { abre: 0.72, ladeo: -0.45, ceja: 0.35, miraX: -0.2, bocaCurva: -0.12, bocaAncho: 0.8 });
      break;
    case 'pensando':
      Object.assign(r, { abre: 0.88, miraX: 0.45, miraY: -0.55, ladeo: 0.12, ceja: -0.1, bocaCurva: 0.05, bocaO: 0.35, bocaAncho: 0.55, brillo: 0.95 });
      r.tono = [214, 230, 255];
      break;
    case 'preocupado':
      Object.assign(r, { abre: 0.92, ceja: -0.75, miraY: 0.1, bocaCurva: -0.5, bocaAncho: 0.8, brillo: 0.9 });
      r.tono = [226, 226, 240];
      break;
    case 'triste':
      Object.assign(r, { abre: 0.72, ceja: -1, miraY: 0.35, bocaCurva: -0.85, bocaAncho: 0.85, brillo: 0.75, lagrima: 1, pupila: 1.2 });
      r.tono = [176, 206, 255];
      break;
    case 'molesto':
      Object.assign(r, { abre: 0.72, ceja: 1, bocaCurva: -0.55, bocaAncho: 0.95, brillo: 1.05 });
      r.tono = [255, 176, 150];
      break;
    case 'cansado':
      Object.assign(r, { abre: 0.42, ceja: -0.25, miraY: 0.15, bocaCurva: 0, bocaAncho: 0.7, brillo: 0.7 });
      break;
    case 'carino':
      especial = 'corazones';
      Object.assign(r, { feliz: 0.7, bocaCurva: 0.85, bocaAncho: 1.05, rubor: 1, brillo: 1.15 });
      r.tono = [255, 190, 205];
      break;
    case 'travieso':
      Object.assign(r, { guino: 1, feliz: 0.4, ladeo: 0.1, bocaCurva: 0.75, bocaAncho: 0.95, rubor: 0.5 });
      break;
    case 'canto':
      Object.assign(r, { feliz: 0.75, bocaCurva: 0.5, bocaAbre: 0.55, bocaO: 0.45, bocaAncho: 0.9, rubor: 0.4, brillo: 1.15 });
      r.tono = [255, 230, 180];
      break;
    case 'oracion':
      Object.assign(r, { abre: 0.06, feliz: 0.35, bocaCurva: 0.3, bocaAncho: 0.7, brillo: 0.85 });
      r.tono = [255, 240, 214];
      break;
    case 'escuchando':
      Object.assign(r, { abre: 1.1, escala: 1.05, pupila: 1.2, ceja: -0.1, bocaCurva: 0.3, bocaAncho: 0.85, brillo: 1.15 });
      break;
    case 'dormido':
      especial = 'dormido';
      Object.assign(r, { abre: 0.04, bocaCurva: 0.1, bocaO: 0.4, bocaAbre: 0.15, bocaAncho: 0.5, brillo: 0.5 });
      r.tono = [200, 210, 240];
      break;
    case 'firme':
    case 'seco':
      Object.assign(r, { abre: 0.9, ceja: 0.25, bocaCurva: 0, bocaAncho: 0.8 });
      break;
    default:
      break;
  }
  return { rasgos: r, especial };
}

/** Lo que la sala le pasa en cada cuadro. */
export type Pulso = {
  /** Está hablando y nivel de su voz (0..1); `conAudio` si el nivel llega de verdad. */
  habla: boolean;
  nivel: number;
  conAudio: boolean;
  /** Hacia dónde mira (el puntero o la cámara), −1..1. */
  mirarX: number;
  mirarY: number;
  /** Movimiento reducido: sin brillitos ni miradas de reojo. */
  reducido?: boolean;
};

export type OpcionesRostro = {
  /** Ojos de luz sobre un visor oscuro (orbe) o pintados sobre la piel. */
  luz: boolean;
  /** Color de los ojos pintados y del visor. */
  tinta: string;
  mejilla: string;
  /** Dónde caen ojos y boca en el lienzo (0..1), y la separación de los ojos. */
  ojoY: number;
  bocaY: number;
  separacion: number;
  /** Tamaño del ojo relativo al alto del lienzo. */
  ojoAlto: number;
  /** Proporción ancho/alto del ojo. */
  ojoAncho: number;
  /** Azar (las pruebas lo fijan). */
  azar?: () => number;
};

const lerp = (a: number, b: number, k: number) => a + (b - a) * k;
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const suave = (x: number) => x * x * (3 - 2 * x);

type Brillito = { x: number; y: number; vida: number; max: number; tam: number };

/**
 * Lleva la cara hacia la del ánimo y la dibuja. Un solo objeto por sala; `dibujar` pinta todo el
 * lienzo (es barato: unas pocas figuras con resplandor).
 */
export class Rostro {
  private r: Rasgos = { ...RASGOS_BASE, tono: [...LUZ] as [number, number, number] };
  private pesos: Record<Especial, number> = { ninguno: 1, risa: 0, corazones: 0, dormido: 0, estrellas: 0 };
  private reloj = 0;
  private proxParpadeo = 2;
  private parpadeo = 0;
  private dobleParpadeo = false;
  private reojo = { x: 0, y: 0, prox: 1.5 };
  private brillitos: Brillito[] = [];
  private lagrimaY = 0;
  private bocaSuave = 0;
  /** La mirada que manda la sala (puntero o cámara), suavizada. */
  private mira = { x: 0, y: 0 };
  private azar: () => number;
  private fondo: HTMLCanvasElement | OffscreenCanvas | null = null;
  private capa: { c: HTMLCanvasElement | OffscreenCanvas; g: CanvasRenderingContext2D } | null = null;

  constructor(private o: OpcionesRostro) {
    this.azar = o.azar ?? Math.random;
  }

  /** Avanza el tiempo: interpola hacia `cara`, parpadea, mira de reojo, mueve la boca. */
  avanzar(dt: number, cara: Cara, p: Pulso) {
    this.reloj += dt;
    const t = this.reloj;
    // Las emociones fuertes llegan rápido; volver a la calma, despacio.
    const fuerte = cara.especial !== 'ninguno' || cara.rasgos.abre > 1.15 || Math.abs(cara.rasgos.ceja) > 0.6;
    const k = 1 - Math.pow(fuerte ? 0.0005 : 0.004, dt);
    const d = cara.rasgos;
    const r = this.r;
    for (const clave of Object.keys(d) as (keyof Rasgos)[]) {
      if (clave === 'tono') continue;
      (r as any)[clave] = lerp(r[clave] as number, d[clave] as number, k);
    }
    r.tono = [lerp(r.tono[0], d.tono[0], k), lerp(r.tono[1], d.tono[1], k), lerp(r.tono[2], d.tono[2], k)];
    // Los ojos especiales (corazones, risa) se van rápido: un corazón a medias en otra emoción se ve raro.
    const kEsp = 1 - Math.pow(0.0001, dt);
    for (const e of Object.keys(this.pesos) as Especial[]) this.pesos[e] = lerp(this.pesos[e], e === cara.especial ? 1 : 0, kEsp);
    // La lágrima se seca rápido al cambiar de emoción.
    if (d.lagrima < r.lagrima) r.lagrima = lerp(r.lagrima, d.lagrima, kEsp);

    // Parpadeo humano: cada 2,5-6 s, a veces doble; nunca con los ojos ya cerrados o especiales.
    const especial = cara.especial !== 'ninguno';
    if (t > this.proxParpadeo && !especial && d.abre > 0.3) {
      this.parpadeo = 0.17;
      this.proxParpadeo = t + (this.dobleParpadeo ? 0.28 : 2.5 + this.azar() * 3.5);
      this.dobleParpadeo = !this.dobleParpadeo && this.azar() < 0.18;
    }
    this.parpadeo = Math.max(0, this.parpadeo - dt);

    this.mira.x = lerp(this.mira.x, clamp(p.mirarX, -1, 1), 1 - Math.pow(0.01, dt));
    this.mira.y = lerp(this.mira.y, clamp(p.mirarY, -1, 1), 1 - Math.pow(0.01, dt));
    // De reojo: quieta y sin nadie a quien mirar, la mirada se va sola un momento.
    if (!p.reducido && t > this.reojo.prox) {
      const quieta = Math.abs(p.mirarX) < 0.05 && Math.abs(p.mirarY) < 0.05;
      this.reojo.x = quieta ? (this.azar() - 0.5) * 0.7 : 0;
      this.reojo.y = quieta ? (this.azar() - 0.5) * 0.3 : 0;
      this.reojo.prox = t + 1.2 + this.azar() * 2.8;
    }

    // La boca: el nivel de la voz de verdad o, sin nivel, un habla creíble (dos senos que no se repiten).
    const objetivoBoca = p.habla ? (p.conAudio ? clamp(p.nivel * 1.25, 0, 1) : 0.25 + Math.abs(Math.sin(t * 17) * Math.sin(t * 5.3)) * 0.7) : 0;
    this.bocaSuave = lerp(this.bocaSuave, objetivoBoca, 1 - Math.pow(p.habla ? 0.000001 : 0.001, dt));

    // Brillitos de alegría junto a los ojos.
    if (!p.reducido && (r.feliz > 0.6 || this.pesos.corazones > 0.5) && this.azar() < dt * 1.6) {
      const lado = this.azar() < 0.5 ? -1 : 1;
      this.brillitos.push({ x: 0.5 + lado * (this.o.separacion + 0.1 + this.azar() * 0.06), y: this.o.ojoY - 0.12 - this.azar() * 0.1, vida: 0.9, max: 0.9, tam: 0.6 + this.azar() * 0.6 });
    }
    for (const b of this.brillitos) b.vida -= dt;
    this.brillitos = this.brillitos.filter((b) => b.vida > 0);

    this.lagrimaY = r.lagrima > 0.4 ? (this.lagrimaY + dt * 0.22) % 1 : 0;
  }

  /** Cómo está ahora (para la prueba y para que la sala acompañe con el cuerpo). */
  estadoActual(): { rasgos: Rasgos; pesos: Record<Especial, number>; parpadeando: boolean; boca: number } {
    return { rasgos: { ...this.r }, pesos: { ...this.pesos }, parpadeando: this.parpadeo > 0, boca: this.bocaSuave };
  }

  private color(a = 1, mezcla = 0) {
    const [r, g, b] = this.r.tono;
    const m = (c: number) => Math.round(lerp(c, 255, mezcla));
    return `rgba(${m(r)},${m(g)},${m(b)},${a})`;
  }

  private nuevoLienzo(w: number, h: number): HTMLCanvasElement | OffscreenCanvas {
    if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    return c;
  }

  /** El visor oscuro de cristal (solo con ojos de luz): se pinta una vez y se reusa. */
  private pintarFondo(w: number, h: number) {
    const c = this.nuevoLienzo(w, h);
    const g = c.getContext('2d') as CanvasRenderingContext2D;
    const m = h * 0.06;
    const rr = (h - 2 * m) / 2;
    const pildora = () => {
      g.beginPath();
      g.moveTo(m + rr, m);
      g.lineTo(w - m - rr, m);
      g.arc(w - m - rr, h / 2, rr, -Math.PI / 2, Math.PI / 2);
      g.lineTo(m + rr, h - m);
      g.arc(m + rr, h / 2, rr, Math.PI / 2, (3 * Math.PI) / 2);
      g.closePath();
    };
    const fondo = g.createLinearGradient(0, 0, 0, h);
    fondo.addColorStop(0, '#2A2C31');
    fondo.addColorStop(0.55, this.o.tinta);
    fondo.addColorStop(1, '#101114');
    g.fillStyle = fondo;
    pildora();
    g.fill();
    // Profundidad: los bordes del cristal más oscuros.
    const vi = g.createRadialGradient(w / 2, h / 2, h * 0.2, w / 2, h / 2, w * 0.55);
    vi.addColorStop(0, 'rgba(0,0,0,0)');
    vi.addColorStop(1, 'rgba(0,0,0,0.55)');
    g.fillStyle = vi;
    pildora();
    g.fill();
    // Líneas de pantalla, muy tenues.
    g.save();
    pildora();
    g.clip();
    g.fillStyle = 'rgba(255,255,255,0.025)';
    for (let y = m; y < h - m; y += 4) g.fillRect(0, y, w, 1);
    // El reflejo de arriba: una franja curva de luz.
    const ref = g.createLinearGradient(0, m, 0, h * 0.42);
    ref.addColorStop(0, 'rgba(255,255,255,0.16)');
    ref.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = ref;
    g.beginPath();
    g.ellipse(w * 0.5, m + h * 0.02, w * 0.36, h * 0.2, 0, 0, Math.PI);
    g.fill();
    g.restore();
    // Un filo de luz en el borde.
    g.strokeStyle = 'rgba(255,255,255,0.10)';
    g.lineWidth = 2;
    pildora();
    g.stroke();
    this.fondo = c;
  }

  /** Pinta la cara entera en `g` (el lienzo de la textura del visor). */
  dibujar(g: CanvasRenderingContext2D, w: number, h: number) {
    const o = this.o;
    const r = this.r;
    const t = this.reloj;
    g.clearRect(0, 0, w, h);
    if (o.luz) {
      if (!this.fondo) this.pintarFondo(w, h);
      g.drawImage(this.fondo as CanvasImageSource, 0, 0);
    }
    if (!this.capa) {
      const c = this.nuevoLienzo(w, h);
      this.capa = { c, g: c.getContext('2d') as CanvasRenderingContext2D };
    }
    const respira = 1 + Math.sin(t * 2.1) * 0.04;
    const brillo = clamp(r.brillo * respira, 0.3, 1.5);

    // Hacia dónde miran: la emoción, el puntero y el reojo.
    const mx = clamp(r.miraX * 0.6 + this.reojo.x + this.mira.x * 0.8, -1, 1);
    const my = clamp(r.miraY * 0.6 + this.reojo.y + this.mira.y * 0.8, -1, 1);
    const ojoH = h * o.ojoAlto * r.escala;
    const ojoW = ojoH * o.ojoAncho;
    const cy = h * o.ojoY + my * h * 0.05;
    const cx = w * 0.5 + mx * w * 0.035;
    const sep = w * o.separacion;

    // El parpadeo: cierra y abre con curva (más rápido al cerrar).
    let cierre = 1;
    if (this.parpadeo > 0) {
      const f = 1 - this.parpadeo / 0.17;
      cierre = f < 0.4 ? 1 - suave(f / 0.4) : suave((f - 0.4) / 0.6);
    }

    const pNormal = this.pesos.ninguno + this.pesos.estrellas;
    for (const lado of [-1, 1] as const) {
      const x = cx + lado * sep;
      // Asimetría: ladeo agranda un ojo; el guiño cierra el izquierdo.
      const asim = 1 + r.ladeo * lado * 0.35;
      let abre = r.abre * cierre * asim;
      if (lado === -1) abre *= 1 - r.guino * 0.92;
      if (pNormal > 0.02) this.ojo(g, x, cy, ojoW * (1 + r.ladeo * lado * 0.08), ojoH, abre, lado, brillo, pNormal, mx, my, lado === -1 ? r.guino : 0);
      if (this.pesos.risa > 0.02) this.ojoRisa(g, x, cy, ojoW, ojoH, lado, brillo, this.pesos.risa);
      if (this.pesos.corazones > 0.02) this.corazon(g, x, cy, ojoH * (0.95 + Math.sin(t * 6) * 0.08), brillo, this.pesos.corazones);
      if (this.pesos.dormido > 0.02) this.ojoDormido(g, x, cy, ojoW, ojoH, brillo, this.pesos.dormido);
    }

    if (r.rubor > 0.02) this.rubor(g, cx, cy + ojoH * 0.62, sep, ojoW, r.rubor);
    if (r.lagrima > 0.3) this.lagrima(g, cx - sep + ojoW * 0.25, cy + ojoH * 0.45, ojoH, r.lagrima, brillo);
    this.boca(g, w * 0.5 + mx * w * 0.015, h * o.bocaY + my * h * 0.015, w, h, brillo);
    for (const b of this.brillitos) this.brillito(g, b.x * w, b.y * h, h * 0.05 * b.tam, b.vida / b.max);
  }

  /** Un ojo: la forma, los párpados (cejas en ángulo y arco de sonrisa), el brillo que mira. */
  private ojo(g: CanvasRenderingContext2D, x: number, y: number, ew: number, eh: number, abre: number, lado: -1 | 1, brillo: number, alfa: number, mx: number, my: number, guino: number) {
    const o = this.o;
    const r = this.r;
    const capa = this.capa!;
    const c = capa.g;
    const w = (capa.c as HTMLCanvasElement).width;
    const h = (capa.c as HTMLCanvasElement).height;
    c.clearRect(0, 0, w, h);
    c.save();
    // 1) la forma llena: una píldora redondeada (los ojos de luz son altos; los pintados, redondos)
    const alto = eh * clamp(abre, 0, 1.4);
    const radio = Math.min(ew / 2, Math.max(1, alto / 2));
    const relleno = o.luz ? this.color(1) : o.tinta;
    c.fillStyle = relleno;
    if (alto < 3) {
      // cerrado: una rayita con curva de sonrisa
      c.strokeStyle = relleno;
      c.lineWidth = Math.max(3, eh * 0.09);
      c.lineCap = 'round';
      c.beginPath();
      c.moveTo(x - ew * 0.55, y);
      c.quadraticCurveTo(x, y + eh * (0.12 + r.feliz * 0.12), x + ew * 0.55, y);
      c.stroke();
    } else {
      c.beginPath();
      c.moveTo(x - ew / 2 + radio, y - alto / 2);
      c.lineTo(x + ew / 2 - radio, y - alto / 2);
      c.arcTo(x + ew / 2, y - alto / 2, x + ew / 2, y - alto / 2 + radio, radio);
      c.lineTo(x + ew / 2, y + alto / 2 - radio);
      c.arcTo(x + ew / 2, y + alto / 2, x + ew / 2 - radio, y + alto / 2, radio);
      c.lineTo(x - ew / 2 + radio, y + alto / 2);
      c.arcTo(x - ew / 2, y + alto / 2, x - ew / 2, y + alto / 2 - radio, radio);
      c.lineTo(x - ew / 2, y - alto / 2 + radio);
      c.arcTo(x - ew / 2, y - alto / 2, x - ew / 2 + radio, y - alto / 2, radio);
      c.closePath();
      c.fill();

      // 2) adentro: el brillo (pupila de luz, o reflejo blanco en los pintados) que sigue la mirada
      c.globalCompositeOperation = 'source-atop';
      const px = x + mx * ew * 0.22;
      const py = y + my * alto * 0.18;
      if (o.luz) {
        const nucleo = c.createRadialGradient(px, py, 0, px, py, ew * 0.75 * r.pupila);
        nucleo.addColorStop(0, 'rgba(255,255,255,0.95)');
        nucleo.addColorStop(0.45, this.color(0.35, 0.6));
        nucleo.addColorStop(1, 'rgba(0,0,0,0.08)');
        c.fillStyle = nucleo;
        c.fillRect(x - ew, y - alto, ew * 2, alto * 2);
      } else {
        c.fillStyle = 'rgba(255,255,255,0.95)';
        c.beginPath();
        c.ellipse(px + ew * 0.16, py - alto * 0.2, ew * 0.16 * r.pupila, ew * 0.16 * r.pupila, 0, 0, Math.PI * 2);
        c.fill();
        c.fillStyle = 'rgba(255,255,255,0.6)';
        c.beginPath();
        c.ellipse(px - ew * 0.12, py + alto * 0.18, ew * 0.07, ew * 0.07, 0, 0, Math.PI * 2);
        c.fill();
      }
      c.globalCompositeOperation = 'destination-out';
      c.fillStyle = '#000';
      // 3) la ceja: un corte en ángulo desde arriba (enojo: adentro baja; tristeza: adentro sube)
      // La línea va de afuera a adentro: con enojo el lado de adentro baja; con tristeza, el de
      // afuera (el ojo «de perrito»). El guiño y las cejas fuertes además bajan el párpado entero.
      const adentro = -lado; // hacia la nariz
      const baja = Math.max(0, Math.abs(r.ceja) - 0.15) * alto * 0.28 + guino * alto * 0.3;
      const topY = y - alto / 2 + baja;
      const pend = r.ceja * ew * 0.32;
      const xAdentro = x + adentro * ew;
      const xAfuera = x - adentro * ew;
      c.beginPath();
      c.moveTo(xAfuera, topY - pend);
      c.lineTo(xAdentro, topY + pend);
      c.lineTo(xAdentro, y - alto * 2 - ew);
      c.lineTo(xAfuera, y - alto * 2 - ew);
      c.closePath();
      c.fill();
      // 4) el arco de sonrisa: un círculo grande que sube desde abajo y deja el ojo en «^»
      if (r.feliz > 0.02) {
        const rr = ew * 0.95;
        const sube = r.feliz * alto * 0.62;
        c.beginPath();
        c.ellipse(x, y + alto / 2 + rr * 0.92 - sube, rr, rr, 0, 0, Math.PI * 2);
        c.fill();
      }
    }
    c.restore();
    // a la cara, con su resplandor (los de luz) o tal cual (los pintados)
    g.save();
    g.globalAlpha = alfa;
    if (o.luz) {
      g.shadowColor = this.color(0.9);
      g.shadowBlur = 18 * brillo;
    }
    g.drawImage(capa.c as CanvasImageSource, 0, 0);
    if (o.luz && brillo > 1) {
      g.globalAlpha = alfa * (brillo - 1) * 0.8;
      g.shadowBlur = 34;
      g.drawImage(capa.c as CanvasImageSource, 0, 0);
    }
    g.restore();
  }

  /** Riéndose: «>» y «<», con un saltito. */
  private ojoRisa(g: CanvasRenderingContext2D, x: number, y: number, ew: number, eh: number, lado: -1 | 1, brillo: number, alfa: number) {
    const salto = Math.abs(Math.sin(this.reloj * 14)) * eh * 0.06;
    const a = ew * 0.55;
    const b = eh * 0.28;
    g.save();
    g.globalAlpha = alfa;
    g.strokeStyle = this.o.luz ? this.color(1) : this.o.tinta;
    g.lineWidth = Math.max(4, eh * 0.13);
    g.lineCap = 'round';
    g.lineJoin = 'round';
    if (this.o.luz) {
      g.shadowColor = this.color(0.9);
      g.shadowBlur = 16 * brillo;
    }
    const yy = y - salto;
    g.beginPath();
    // el vértice apunta a la nariz
    g.moveTo(x + lado * a * 0.5, yy - b);
    g.lineTo(x - lado * a * 0.5, yy);
    g.lineTo(x + lado * a * 0.5, yy + b);
    g.stroke();
    g.restore();
  }

  /** Cariño: corazones que laten. */
  private corazon(g: CanvasRenderingContext2D, x: number, y: number, s: number, brillo: number, alfa: number) {
    g.save();
    g.globalAlpha = alfa;
    g.fillStyle = this.o.luz ? 'rgb(255,128,160)' : '#D9506E';
    if (this.o.luz) {
      g.shadowColor = 'rgba(255,120,160,0.9)';
      g.shadowBlur = 20 * brillo;
    }
    const k = s * 0.5;
    g.beginPath();
    g.moveTo(x, y + k * 0.9);
    g.bezierCurveTo(x - k * 1.3, y + k * 0.1, x - k * 0.9, y - k * 1.0, x, y - k * 0.4);
    g.bezierCurveTo(x + k * 0.9, y - k * 1.0, x + k * 1.3, y + k * 0.1, x, y + k * 0.9);
    g.fill();
    g.fillStyle = 'rgba(255,255,255,0.6)';
    g.beginPath();
    g.ellipse(x - k * 0.45, y - k * 0.35, k * 0.18, k * 0.12, -0.6, 0, Math.PI * 2);
    g.fill();
    g.restore();
  }

  /** Dormida: arcos cerrados hacia abajo, en paz. */
  private ojoDormido(g: CanvasRenderingContext2D, x: number, y: number, ew: number, eh: number, brillo: number, alfa: number) {
    g.save();
    g.globalAlpha = alfa;
    g.strokeStyle = this.o.luz ? this.color(0.9) : this.o.tinta;
    g.lineWidth = Math.max(3, eh * 0.09);
    g.lineCap = 'round';
    if (this.o.luz) {
      g.shadowColor = this.color(0.7);
      g.shadowBlur = 10 * brillo;
    }
    g.beginPath();
    g.moveTo(x - ew * 0.6, y);
    g.quadraticCurveTo(x, y + eh * 0.22, x + ew * 0.6, y);
    g.stroke();
    g.restore();
  }

  /** Rubor: dos manchas suaves bajo los ojos (con rayitas en los de luz, como un compañero robot). */
  private rubor(g: CanvasRenderingContext2D, cx: number, y: number, sep: number, ew: number, fuerza: number) {
    for (const lado of [-1, 1]) {
      const x = cx + lado * (sep + ew * 0.35);
      const rad = ew * 0.9;
      const gr = g.createRadialGradient(x, y, 0, x, y, rad);
      const col = this.o.luz ? '255,140,170' : hexARgb(this.o.mejilla);
      gr.addColorStop(0, `rgba(${col},${(this.o.luz ? 0.8 : 0.55) * fuerza})`);
      gr.addColorStop(1, `rgba(${col},0)`);
      g.fillStyle = gr;
      g.beginPath();
      g.ellipse(x, y, rad, rad * 0.55, 0, 0, Math.PI * 2);
      g.fill();
      if (this.o.luz && fuerza > 0.4) {
        g.save();
        g.strokeStyle = `rgba(255,150,175,${(fuerza - 0.4) * 1.2})`;
        g.lineWidth = Math.max(2, ew * 0.07);
        g.lineCap = 'round';
        for (let i = -1; i <= 1; i++) {
          g.beginPath();
          g.moveTo(x + i * ew * 0.26 - ew * 0.08, y + ew * 0.12);
          g.lineTo(x + i * ew * 0.26 + ew * 0.08, y - ew * 0.12);
          g.stroke();
        }
        g.restore();
      }
    }
  }

  /** Una lágrima que cae despacio desde el ojo. */
  private lagrima(g: CanvasRenderingContext2D, x: number, y0: number, eh: number, fuerza: number, brillo: number) {
    const f = this.lagrimaY;
    const y = y0 + f * eh * 1.1;
    const s = eh * 0.13;
    g.save();
    g.globalAlpha = fuerza * (f < 0.8 ? 1 : (1 - f) / 0.2);
    g.fillStyle = this.o.luz ? 'rgb(150,200,255)' : '#7FB2E5';
    if (this.o.luz) {
      g.shadowColor = 'rgba(140,190,255,0.9)';
      g.shadowBlur = 12 * brillo;
    }
    g.beginPath();
    g.moveTo(x, y - s * 1.4);
    g.quadraticCurveTo(x + s, y, x, y + s);
    g.quadraticCurveTo(x - s, y, x, y - s * 1.4);
    g.fill();
    g.restore();
  }

  /** La boca: curva, abierta con la voz o en «o». */
  private boca(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, brillo: number) {
    const r = this.r;
    const habla = this.bocaSuave;
    const ancho = w * 0.12 * r.bocaAncho * (1 - r.bocaO * 0.35) * (1 + habla * 0.12);
    const abre = clamp(r.bocaAbre + habla * 0.85, 0, 1.2);
    const curva = r.bocaCurva * h * 0.075;
    const tinta = this.o.luz ? this.color(1) : this.o.tinta;
    g.save();
    if (this.o.luz) {
      g.shadowColor = this.color(0.9);
      g.shadowBlur = 14 * brillo;
    }
    const alto = abre * h * 0.11;
    if (r.bocaO > 0.5 && abre > 0.05) {
      // «o»: un anillo (sorpresa) o una elipse llena (cantando)
      const rx = ancho * 0.55;
      const ry = Math.max(rx * 0.7, alto * 0.6);
      g.fillStyle = tinta;
      g.beginPath();
      g.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
      g.fill();
      g.globalCompositeOperation = this.o.luz ? 'source-over' : 'source-over';
      g.fillStyle = this.o.luz ? 'rgba(20,20,24,0.85)' : 'rgba(120,50,50,0.85)';
      g.beginPath();
      g.ellipse(x, y, rx * 0.55, ry * 0.55, 0, 0, Math.PI * 2);
      g.fill();
    } else if (alto < 2.5) {
      // cerrada: una línea con curva
      g.strokeStyle = tinta;
      g.lineWidth = Math.max(4, h * 0.032);
      g.lineCap = 'round';
      g.beginPath();
      g.moveTo(x - ancho, y - curva * 0.3);
      g.quadraticCurveTo(x, y + curva, x + ancho, y - curva * 0.3);
      g.stroke();
    } else {
      // abierta: labio de arriba con la curva de la emoción y el de abajo según cuánto abre
      g.fillStyle = tinta;
      g.beginPath();
      g.moveTo(x - ancho, y - curva * 0.3);
      g.quadraticCurveTo(x, y + curva * 0.6, x + ancho, y - curva * 0.3);
      g.quadraticCurveTo(x + ancho * 0.6, y + curva * 0.5 + alto, x, y + curva * 0.5 + alto * 1.15);
      g.quadraticCurveTo(x - ancho * 0.6, y + curva * 0.5 + alto, x - ancho, y - curva * 0.3);
      g.closePath();
      g.fill();
      // adentro, más oscuro (y la lengua, si abre bastante)
      g.shadowBlur = 0;
      g.fillStyle = this.o.luz ? 'rgba(18,18,22,0.75)' : 'rgba(90,30,32,0.9)';
      g.beginPath();
      g.ellipse(x, y + curva * 0.45 + alto * 0.55, ancho * 0.62, Math.max(1, alto * 0.42), 0, 0, Math.PI * 2);
      g.fill();
      if (alto > h * 0.04) {
        g.fillStyle = this.o.luz ? this.color(0.55, 0.3) : 'rgba(220,110,120,0.9)';
        g.beginPath();
        g.ellipse(x, y + curva * 0.5 + alto * 0.85, ancho * 0.36, alto * 0.22, 0, 0, Math.PI * 2);
        g.fill();
      }
    }
    g.restore();
  }

  /** Un destello de cuatro puntas. */
  private brillito(g: CanvasRenderingContext2D, x: number, y: number, s: number, vida: number) {
    const k = Math.sin(vida * Math.PI);
    g.save();
    g.globalAlpha = k;
    g.fillStyle = this.o.luz ? 'rgba(255,248,225,1)' : 'rgba(255,214,120,1)';
    if (this.o.luz) {
      g.shadowColor = 'rgba(255,235,180,0.9)';
      g.shadowBlur = 10;
    }
    const a = s * (0.6 + k * 0.6);
    g.beginPath();
    g.moveTo(x, y - a);
    g.quadraticCurveTo(x, y, x + a, y);
    g.quadraticCurveTo(x, y, x, y + a);
    g.quadraticCurveTo(x, y, x - a, y);
    g.quadraticCurveTo(x, y, x, y - a);
    g.fill();
    g.restore();
  }
}

function hexARgb(hex: string): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return '242,164,139';
  const n = parseInt(m[1], 16);
  return `${(n >> 16) & 255},${(n >> 8) & 255},${n & 255}`;
}
