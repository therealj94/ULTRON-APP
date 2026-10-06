/**
 * LA MIRADA DEL AVATAR HACIA LA PERSONA, SEPARADA DEL RENDER DE REACT (master §25.6, CAM-A).
 *
 * Antes: DeskScreen recibía la mirada de la cámara (hasta 15 eventos/s en la cámara en vivo) y la pasaba por
 * `setGaze` a lo sumo cada 250 ms: el avatar se movía a saltos de ~4 Hz y cada salto re-renderizaba la mesa.
 * Ahora la cámara solo deja el OBJETIVO aquí (`objetivo`, sin estado de React) y quien dibuja pide la pose de
 * su cuadro (`paso(ahora)`): el cuerpo 3D cada ~33 ms (Avatar3D → mensaje `mirar` a la escena, que interpola a
 * 60 fps), las caras 2D desde el mismo valor alisado.
 *
 *  · Alisado con deltaTime (exponencial, independiente de los cuadros por segundo).
 *  · Zona muerta: un temblor del detector de menos de `zonaMuerta` no mueve nada.
 *  · Límites de giro (x ≈ yaw, y ≈ pitch, en −1..1 del rig) y velocidad acotada (unidades/s).
 *  · Pérdida: se sostiene `sostenerMs` donde estaba y después vuelve suave al centro; recién ahí `activa: false`
 *    (el cuerpo retoma su mirada viva). Un objetivo sin noticias en `edadMaxMs` cuenta como perdido.
 *  · Movimiento reducido (ajuste de accesibilidad del teléfono): menos giro y más lento. `seguir: false` lo apaga.
 *
 * La mirada es una decisión de interfaz: no mide a dónde mira la persona ni dice quién es.
 */

export type PoseMirada = { x: number; y: number; activa: boolean };

export const MIRADA = {
  zonaMuerta: 0.03,
  limiteX: 0.85,
  limiteY: 0.6,
  /** 1/s: qué tan rápido se acerca al objetivo (constante de tiempo ≈ 1/rapidez). */
  rapidez: 9,
  /** Unidades del rig por segundo (todo el recorrido −1..1 en ~0,9 s como mucho). */
  velMax: 2.2,
  sostenerMs: 700,
  /**
   * Red de seguridad: sin eventos de la cámara en este tiempo, el objetivo se da por perdido aunque nadie dijo
   * «activa: false» (el latido del nativo con caras es 0,5 s; la cámara de fotos con ML Kit, ≤ ~1,1 s por foto).
   */
  edadMaxMs: 2500,
  /** Paso de tiempo máximo que se integra de una vez (una pausa larga no hace saltar la cabeza). */
  dtMaxMs: 100,
  reducido: { limiteX: 0.35, limiteY: 0.2, velMax: 0.7, rapidez: 4 },
};

export type ConfigMirada = typeof MIRADA;

const recortar = (v: number, l: number) => Math.max(-l, Math.min(l, v));

/** Lo que un cuerpo necesita para leer la mirada por su cuenta (Avatar3D). */
export type FuenteMirada = {
  paso: (ahora: number, o?: { reducido?: boolean; seguir?: boolean }) => PoseMirada;
  /** Un cuerpo que la lee cada cuadro; mientras haya alguno, la mesa no la pasa por su estado de React. */
  conectar: () => () => void;
};

export class ControladorMirada implements FuenteMirada {
  private meta = { x: 0, y: 0 };
  private siguiendo = false;
  private visto = -Infinity;
  private perdidoEn = -Infinity;
  private pose = { x: 0, y: 0 };
  private activa = false;
  private t: number | null = null;
  private lectores = 0;

  constructor(private cfg: ConfigMirada = MIRADA) {}

  /** Lo que dice la cámara (x, y en −1..1; activa = hay a quién mirar). Sin React: solo guarda. */
  objetivo(x: number, y: number, activa: boolean, ts: number) {
    if (activa && Number.isFinite(x) && Number.isFinite(y)) {
      this.meta = { x: recortar(x, 1), y: recortar(y, 1) };
      this.siguiendo = true;
      this.visto = ts;
      return;
    }
    if (this.siguiendo) this.perdidoEn = ts;
    this.siguiendo = false;
  }

  /** Suelta ya, sin sostener (el dedo toma la mirada). */
  soltar(ts: number) {
    this.siguiendo = false;
    this.perdidoEn = ts - this.cfg.sostenerMs;
  }

  reiniciar() {
    this.meta = { x: 0, y: 0 };
    this.siguiendo = false;
    this.visto = -Infinity;
    this.perdidoEn = -Infinity;
    this.pose = { x: 0, y: 0 };
    this.activa = false;
    this.t = null;
  }

  conectar(): () => void {
    this.lectores += 1;
    let suelto = false;
    return () => {
      if (suelto) return;
      suelto = true;
      this.lectores = Math.max(0, this.lectores - 1);
    };
  }

  conectados(): number {
    return this.lectores;
  }

  /** La pose para el cuadro de `ahora` (ms, el mismo reloj que `objetivo`). Avanza el tiempo; sin pasos hacia atrás. */
  paso(ahora: number, o?: { reducido?: boolean; seguir?: boolean }): PoseMirada {
    const c = this.cfg;
    const r = o?.reducido ? { ...c, ...c.reducido } : c;
    const dt = this.t === null ? 0 : Math.max(0, Math.min(c.dtMaxMs, ahora - this.t)) / 1000;
    if (this.t === null || ahora > this.t) this.t = ahora;
    // ¿Sigue habiendo a quién mirar? Sin noticias en edadMaxMs, perdido desde que dejó de llegar.
    if (this.siguiendo && ahora - this.visto > c.edadMaxMs) {
      this.siguiendo = false;
      this.perdidoEn = this.visto + c.edadMaxMs;
    }
    let meta: { x: number; y: number };
    let activa: boolean;
    if (o?.seguir === false) {
      meta = { x: 0, y: 0 };
      activa = false;
    } else if (this.siguiendo) {
      meta = { x: recortar(this.meta.x, r.limiteX), y: recortar(this.meta.y, r.limiteY) };
      // Zona muerta: un temblor chico del detector no mueve la cabeza.
      if (Math.abs(meta.x - this.pose.x) < c.zonaMuerta && Math.abs(meta.y - this.pose.y) < c.zonaMuerta) meta = { ...this.pose };
      activa = true;
    } else if (ahora - this.perdidoEn < c.sostenerMs) {
      meta = { ...this.pose };
      activa = this.activa;
    } else {
      meta = { x: 0, y: 0 };
      activa = this.activa && (Math.abs(this.pose.x) > 0.02 || Math.abs(this.pose.y) > 0.02);
    }
    const k = 1 - Math.exp(-r.rapidez * dt);
    const tope = r.velMax * dt;
    // Los límites valen también al volver de una pose más amplia (p. ej. al activar movimiento reducido).
    const px = recortar(this.pose.x, Math.max(r.limiteX, Math.abs(meta.x)));
    const py = recortar(this.pose.y, Math.max(r.limiteY, Math.abs(meta.y)));
    this.pose = {
      x: recortar(px + recortar((meta.x - px) * k, tope), r.limiteX),
      y: recortar(py + recortar((meta.y - py) * k, tope), r.limiteY),
    };
    this.activa = activa;
    return { x: this.pose.x, y: this.pose.y, activa };
  }
}

/** ¿Vale la pena mandar esta pose al cuerpo? (cambió algo que se vea, o pasó de activa a no) */
export function poseCambio(a: PoseMirada | null, b: PoseMirada, umbral = 0.004): boolean {
  return !a || a.activa !== b.activa || Math.abs(a.x - b.x) >= umbral || Math.abs(a.y - b.y) >= umbral;
}
