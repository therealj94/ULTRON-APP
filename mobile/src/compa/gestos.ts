/**
 * Qué quiso hacer el dedo con la compañera: tocarla, tocarla dos veces, molestarla, acariciarla,
 * levantarla o arrastrarla.
 *
 * Puro (entran tiempos y posiciones, salen gestos) para probarlo en Node; el componente le pasa lo de
 * su PanResponder y programa un temporizador para `proximo()`.
 *
 *  · toque: uno solo, y nada más en 280 ms (hay que esperar: podría ser el primero de un doble toque);
 *  · dobleToque: dos seguidos y ninguno más (un tercero lo vuelve «molestar»);
 *  · molestar: tres o más toques seguidos (cada uno a menos de 280 ms del anterior);
 *  · levantar: mantenerla 450 ms sin mover el dedo; después, el dedo la lleva (moverArrastre);
 *  · caricia: el dedo va y viene encima de ella sin salirse (recorre 1,4 veces su radio);
 *  · arrastrar: el dedo se aleja más que su radio: la lleva consigo;
 *  · soltar: al levantar el dedo si la llevaba, con la velocidad (px/s) para lanzarla hacia un borde.
 */

export type Gesto = 'toque' | 'dobleToque' | 'molestar' | 'caricia' | 'levantar' | 'arrastrar' | 'moverArrastre' | 'soltar';

export type SalidaGesto = { gesto: Gesto; x: number; y: number; vx?: number; vy?: number };

export type OpcionesGestos = {
  /** Radio del cuerpo, en px. */
  radio: number;
  dobleMs?: number;
  largoMs?: number;
  /** Cuánto hay que mover el dedo para que deje de ser un toque. */
  umbral?: number;
  /** Cada cuánto puede repetirse «caricia» mientras se sigue acariciando. */
  cariciaCadaMs?: number;
};

type Pendiente = { gesto: 'toque' | 'dobleToque'; vence: number; x: number; y: number };

export class Gestos {
  private o: Required<OpcionesGestos>;
  private abajo = false;
  private t0 = 0;
  private x0 = 0;
  private y0 = 0;
  private lx = 0;
  private ly = 0;
  private lt = 0;
  private vx = 0;
  private vy = 0;
  private camino = 0;
  private movido = false;
  private largo = false;
  private arrastrando = false;
  private acariciando = false;
  private ultimaCaricia = -1e9;
  /** Horas de los toques seguidos (cada uno a menos de `dobleMs` del anterior). */
  private seguidos: number[] = [];
  private pendiente: Pendiente | null = null;

  constructor(o: OpcionesGestos) {
    this.o = { dobleMs: 280, largoMs: 450, umbral: 10, cariciaCadaMs: 1200, ...o };
  }

  /** Cuándo hay que llamar a `vencer` (hora absoluta), o null si no hace falta. */
  proximo(): number | null {
    const tiempos: number[] = [];
    if (this.pendiente) tiempos.push(this.pendiente.vence);
    if (this.abajo && !this.movido && !this.largo) tiempos.push(this.t0 + this.o.largoMs);
    return tiempos.length ? Math.min(...tiempos) : null;
  }

  /** ¿El dedo la lleva (levantada o arrastrada)? */
  llevando(): boolean {
    return this.abajo && (this.largo || this.arrastrando);
  }

  bajar(t: number, x: number, y: number): SalidaGesto[] {
    this.abajo = true;
    this.t0 = this.lt = t;
    this.x0 = this.lx = x;
    this.y0 = this.ly = y;
    this.vx = this.vy = 0;
    this.camino = 0;
    this.movido = this.largo = this.arrastrando = this.acariciando = false;
    return this.vencer(t);
  }

  mover(t: number, x: number, y: number): SalidaGesto[] {
    if (!this.abajo) return [];
    const out = this.vencer(t);
    const dt = Math.max(1, t - this.lt);
    // Velocidad suavizada (px/s): la del último tramo pesa más.
    this.vx = this.vx * 0.3 + ((x - this.lx) / dt) * 1000 * 0.7;
    this.vy = this.vy * 0.3 + ((y - this.ly) / dt) * 1000 * 0.7;
    this.camino += Math.hypot(x - this.lx, y - this.ly);
    this.lx = x;
    this.ly = y;
    this.lt = t;
    const lejos = Math.hypot(x - this.x0, y - this.y0);
    if (!this.movido && lejos > this.o.umbral) this.movido = true;
    if (this.largo || this.arrastrando) {
      out.push({ gesto: 'moverArrastre', x, y });
      return out;
    }
    if (!this.movido) return out;
    const r = this.o.radio;
    // Acariciando se permite salirse un poco (la mano va y viene); si no, alejarse la arrastra.
    if (lejos > r * (this.acariciando ? 1.6 : 0.9)) {
      this.arrastrando = true;
      this.seguidos = [];
      this.pendiente = null;
      out.push({ gesto: 'arrastrar', x: this.x0, y: this.y0 }, { gesto: 'moverArrastre', x, y });
      return out;
    }
    if (this.camino > r * 1.4 && t - this.ultimaCaricia >= this.o.cariciaCadaMs) {
      this.acariciando = true;
      this.ultimaCaricia = t;
      this.camino = 0;
      out.push({ gesto: 'caricia', x, y });
    }
    return out;
  }

  subir(t: number, x: number, y: number): SalidaGesto[] {
    if (!this.abajo) return [];
    const out = this.vencer(t);
    this.abajo = false;
    // Un toque anterior que venció mientras este dedo estaba abajo sale ahora (no se pierde).
    out.push(...this.vencer(t));
    if (this.largo || this.arrastrando) {
      // Si el dedo ya estaba quieto al soltar, no hay lanzamiento.
      const quieto = t - this.lt > 90;
      out.push({ gesto: 'soltar', x, y, vx: quieto ? 0 : this.vx, vy: quieto ? 0 : this.vy });
      this.largo = this.arrastrando = false;
      return out;
    }
    if (this.movido) return out; // una caricia o un roce: no es toque
    const ultimo = this.seguidos[this.seguidos.length - 1];
    if (ultimo === undefined || t - ultimo > this.o.dobleMs) this.seguidos = [];
    this.seguidos.push(t);
    const n = this.seguidos.length;
    if (n >= 3) {
      this.pendiente = null;
      out.push({ gesto: 'molestar', x, y });
    } else this.pendiente = { gesto: n === 2 ? 'dobleToque' : 'toque', vence: t + this.o.dobleMs, x, y };
    return out;
  }

  /** Lo que se cumple con el tiempo: el toque que nadie siguió, o el dedo quieto que la levanta. */
  vencer(t: number): SalidaGesto[] {
    const out: SalidaGesto[] = [];
    const p = this.pendiente;
    if (p && t >= p.vence && !this.abajo) {
      this.pendiente = null;
      this.seguidos = [];
      out.push({ gesto: p.gesto, x: p.x, y: p.y });
    }
    if (this.abajo && !this.movido && !this.largo && t >= this.t0 + this.o.largoMs) {
      this.largo = true;
      this.pendiente = null;
      this.seguidos = [];
      out.push({ gesto: 'levantar', x: this.lx, y: this.ly });
    }
    return out;
  }

  /** El sistema se llevó el gesto (otro responder, un modal): si la llevaba, se suelta donde está. */
  cancelar(t: number): SalidaGesto[] {
    if (!this.abajo) return [];
    this.abajo = false;
    this.pendiente = null;
    this.seguidos = [];
    if (this.largo || this.arrastrando) {
      this.largo = this.arrastrando = false;
      return [{ gesto: 'soltar', x: this.lx, y: this.ly, vx: 0, vy: 0 }];
    }
    void t;
    return [];
  }
}
