/**
 * Tracker óptico de RESPALDO (sin modelo): centroide de luminancia + movimiento sobre un cuadro
 * de 64×48. Solo se usa cuando MediaPipe no carga (offline, CDN caído, WebGL roto). No sabe
 * distinguir una cara de una lámpara: por eso el motor real es `vision/mediapipe.ts`.
 *
 * Presencia honesta: `detected` exige ENERGÍA real (textura + movimiento sostenido, ver
 * `vision/optico.ts`). Una sala vacía, una pared lisa o la cámara tapada dan `detected: false`
 * siempre, aunque el cuadro sea claro: el respaldo no inventa un «llego» mientras carga el modelo.
 *
 * Se puede usar de dos maneras:
 *  - `start(cb)` / `stop()`: bucle propio limitado a ~16 fps (compatibilidad).
 *  - `paso(ts)`: un solo cuadro, para que `vision/motor.ts` lo llame desde su propio bucle.
 */
import { DetectedObject } from '../types';
import type { Observacion } from './vision/escena';
import { analizarCuadro, MemoriaMovimiento, tieneEnergia } from './vision/optico';

export interface FaceTrackResult {
  detected: boolean;
  x: number; // -1 (izquierda) .. +1 (derecha), ya espejado
  y: number; // -1 (arriba) .. +1 (abajo)
  confidence: number;
  faceWidth: number;
  fps: number;
  spatialZone: 'LEFT' | 'CENTER' | 'RIGHT';
  distance: 'NEAR' | 'OPTIMAL' | 'FAR';
  objects: DetectedObject[];
  isWaving: boolean;
  /** Ya no se estima (era una heurística inventada); se conserva por compatibilidad. */
  hasDrink: boolean;
}

const W = 64;
const H = 48;
const FPS_OBJETIVO = 16;

export class OpticalFaceTracker {
  private video: HTMLVideoElement | null = null;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D | null;
  private animId: number | null = null;
  private isRunning = false;
  private onTrackCallback: ((res: FaceTrackResult) => void) | null = null;

  private smoothX = 0;
  private smoothY = 0;
  private prevFrameData: Uint8ClampedArray | null = null;
  private frameCount = 0;
  private lastFpsTime = 0;
  private lastStep = 0;
  private currentFps = 0;

  private waveMotionHistory: number[] = [];
  private ultimo: FaceTrackResult | null = null;
  private readonly movimiento = new MemoriaMovimiento();
  private tsActual = 0;

  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.width = W;
    this.canvas.height = H;
    this.ctx = this.canvas.getContext('2d', { willReadFrequently: true });
  }

  public setVideoElement(video: HTMLVideoElement) {
    this.video = video;
  }

  public start(callback: (res: FaceTrackResult) => void) {
    this.onTrackCallback = callback;
    this.isRunning = true;
    this.loop();
  }

  public stop() {
    this.isRunning = false;
    if (this.animId) {
      cancelAnimationFrame(this.animId);
      this.animId = null;
    }
    this.prevFrameData = null;
    this.waveMotionHistory = [];
    this.movimiento.reiniciar();
  }

  public get fps() {
    return this.currentFps;
  }

  private loop = () => {
    if (!this.isRunning) return;
    const now = performance.now();
    if (now - this.lastStep >= 1000 / FPS_OBJETIVO) {
      const r = this.paso(now);
      if (r && this.onTrackCallback) this.onTrackCallback(r);
    }
    this.animId = requestAnimationFrame(this.loop);
  };

  /** Procesa un cuadro. Devuelve null si el video aún no tiene datos. */
  public paso(ts: number = performance.now()): FaceTrackResult | null {
    if (!this.video || this.video.readyState < 2 || !this.ctx) return null;
    this.lastStep = ts;
    this.tsActual = ts;
    this.frameCount++;
    if (ts - this.lastFpsTime >= 1000) {
      this.currentFps = this.lastFpsTime ? Math.round((this.frameCount * 1000) / (ts - this.lastFpsTime)) : this.frameCount;
      this.frameCount = 0;
      this.lastFpsTime = ts;
    }
    try {
      this.ultimo = this.procesar();
    } catch {
      // seguridad / cross-origin
      this.ultimo = null;
    }
    return this.ultimo;
  }

  /** Último resultado traducido al contrato de `vision/escena.ts`. */
  public observacion(ts: number): Observacion {
    const r = this.ultimo;
    if (!r || !r.detected) return { ts, motor: 'optico', personas: 0, cara: null, saludo: r?.isWaving ?? false };
    return {
      ts,
      motor: 'optico',
      personas: 1,
      cara: {
        // r.x ya está espejado; deshacemos el espejo para entregar coordenadas de video 0..1
        cx: (1 - r.x) / 2,
        cy: (r.y + 1) / 2,
        tam: Math.min(1, r.faceWidth * 1.2),
        yaw: 0,
        pitch: 0,
        sonrisa: 0,
        sorpresa: 0,
        bocaAbierta: 0,
        parpadeo: 0,
      },
      saludo: r.isWaving,
    };
  }

  private procesar(): FaceTrackResult {
    const ctx = this.ctx!;
    const video = this.video!;
    ctx.drawImage(video, 0, 0, W, H);
    const data = ctx.getImageData(0, 0, W, H).data;

    const e = analizarCuadro(data, this.prevFrameData, W, H);
    const { totalWeight, sumX, sumY, upperMotion } = e;
    // Movimiento sostenido (varios cuadros con cambio real en los últimos 3 s): sin él no hay nadie.
    const movimientoSostenido = this.movimiento.registrar(this.tsActual, e.conPrevio ? e.pixelesMovidos : 0);

    if (!this.prevFrameData || this.prevFrameData.length !== data.length) this.prevFrameData = new Uint8ClampedArray(data);
    else this.prevFrameData.set(data);

    // Saludo: movimiento lateral alto sostenido y repetido (ventana de 10 cuadros ≈ 0.6 s)
    this.waveMotionHistory.push(upperMotion);
    if (this.waveMotionHistory.length > 10) this.waveMotionHistory.shift();
    const avgWave = this.waveMotionHistory.reduce((a, b) => a + b, 0) / this.waveMotionHistory.length;
    const picos = this.waveMotionHistory.filter((v) => v > 200).length;
    const isWaving = avgWave > 280 && picos >= 4;

    if (tieneEnergia(e, movimientoSostenido)) {
      const rawCentroidX = sumX / totalWeight;
      const rawCentroidY = sumY / totalWeight;
      // Espejo: la cámara frontal se ve como espejo
      const normX = -((rawCentroidX / W) * 2 - 1);
      const normY = (rawCentroidY / H) * 2 - 1;
      this.smoothX += (normX - this.smoothX) * 0.16;
      this.smoothY += (normY - this.smoothY) * 0.16;

      const spatialZone: FaceTrackResult['spatialZone'] = this.smoothX < -0.25 ? 'LEFT' : this.smoothX > 0.25 ? 'RIGHT' : 'CENTER';
      const rawWidth = Math.min(1, totalWeight / (W * H * 45));
      const distance: FaceTrackResult['distance'] = rawWidth > 0.45 ? 'NEAR' : rawWidth < 0.18 ? 'FAR' : 'OPTIMAL';
      const confidence = Math.min(80, 55 + (totalWeight / (W * H * 50)) * 10); // heurístico: nunca se vende como certeza

      const objects: DetectedObject[] = [
        {
          id: 'obj_person',
          label: 'PERSON',
          confidence,
          bbox: { x: Math.max(0, (1 - normX) / 2 - 0.2), y: Math.max(0, (normY + 1) / 2 - 0.25), width: 0.4, height: 0.5 },
          spatialZone,
          distance,
        },
      ];
      if (isWaving) {
        objects.push({
          id: 'obj_wave',
          label: 'WAVING_HAND',
          confidence: 60,
          bbox: { x: normX > 0 ? 0.7 : 0.1, y: 0.2, width: 0.2, height: 0.25 },
          spatialZone: normX > 0 ? 'RIGHT' : 'LEFT',
          distance: 'OPTIMAL',
        });
      }

      return {
        detected: true,
        x: Math.max(-1, Math.min(1, this.smoothX * 1.6)),
        y: Math.max(-1, Math.min(1, this.smoothY * 1.3)),
        confidence,
        faceWidth: rawWidth,
        fps: this.currentFps,
        spatialZone,
        distance,
        objects,
        isWaving,
        hasDrink: false,
      };
    }

    this.smoothX += (0 - this.smoothX) * 0.05;
    this.smoothY += (0 - this.smoothY) * 0.05;
    return {
      detected: false,
      x: this.smoothX,
      y: this.smoothY,
      confidence: 0,
      faceWidth: 0,
      fps: this.currentFps,
      spatialZone: 'CENTER',
      distance: 'FAR',
      objects: [],
      isWaving: false,
      hasDrink: false,
    };
  }
}
