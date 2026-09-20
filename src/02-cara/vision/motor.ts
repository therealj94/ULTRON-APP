/**
 * MotorVision: junta el video, el detector (MediaPipe o tracker óptico de respaldo), la
 * máquina de escena y la mirada suavizada, en UN bucle rAF limitado por tiempo (15–20 fps).
 *
 *  video ──► detectForVideo (MediaPipe) ──► Observacion ──► MaquinaEscena ──► Escena
 *        └─► OpticalFaceTracker.paso (solo si MediaPipe no cargó en 6 s)   └─► onGaze (x,y,active)
 *
 * Emisión: `onEscena` como máximo cada `intervaloEstadoMs` (500 ms) y de inmediato cuando hay eventos.
 * `onGaze` solo cuando la mirada cambia de verdad (cuantizada a 0.01, o cambia `active`): con la sala
 * vacía no se emite nada, así App no re-renderiza 18 veces por segundo.
 */
import { OpticalFaceTracker } from '../faceTracker';
import { MaquinaEscena, type Escena, type MotorVision as TipoMotor, type Observacion } from './escena';
import { crearLandmarker, esTiempoAgotado, observacionDesdeResultado, type Delegado, type LandmarkerListo, type OpcionesCarga } from './mediapipe';

export interface Mirada {
  x: number;
  y: number;
  active: boolean;
}

export interface EstadoMotor {
  motor: TipoMotor | 'cargando';
  delegado: Delegado | null;
  fps: number;
}

export interface OpcionesMotor {
  onEscena?: (e: Escena) => void;
  onGaze?: (g: Mirada) => void;
  onEstado?: (s: EstadoMotor) => void;
  /** 15–20 recomendado. */
  fpsObjetivo?: number;
  intervaloEstadoMs?: number;
  carga?: OpcionesCarga;
  log?: (...a: unknown[]) => void;
}

export class MotorVision {
  private video: HTMLVideoElement | null = null;
  private animId: number | null = null;
  private corriendo = false;
  private abortar: AbortController | null = null;

  private landmarker: LandmarkerListo | null = null;
  private optico: OpticalFaceTracker | null = null;
  private motor: TipoMotor | 'cargando' = 'cargando';

  private readonly maquina = new MaquinaEscena();
  private readonly fpsObjetivo: number;
  private readonly intervaloEstadoMs: number;
  private readonly log: (...a: unknown[]) => void;

  private ultimoPaso = 0;
  private ultimoTsDetect = -1;
  private ultimaEmision = 0;
  private cuadros = 0;
  private tFps = 0;
  private fps = 0;

  private mirada: Mirada = { x: 0, y: 0, active: false };
  private objetivoMirada = { x: 0, y: 0 };
  private ultimaMiradaEmitida: Mirada | null = null;

  constructor(private readonly op: OpcionesMotor = {}) {
    this.fpsObjetivo = Math.max(5, Math.min(30, op.fpsObjetivo ?? 18));
    this.intervaloEstadoMs = op.intervaloEstadoMs ?? 500;
    this.log = op.log ?? ((...a) => console.info(...a));
  }

  get estado(): EstadoMotor {
    return { motor: this.motor, delegado: this.landmarker?.delegado ?? null, fps: this.fps };
  }

  get escena(): Escena | null {
    return this.maquina.escena;
  }

  /** Arranca con un <video> que ya tiene (o tendrá) srcObject. Carga MediaPipe; si no llega en 6 s, óptico. */
  async arrancar(video: HTMLVideoElement) {
    if (this.corriendo) this.detener();
    this.video = video;
    this.corriendo = true;
    this.maquina.reiniciar();
    this.motor = 'cargando';
    this.ultimoTsDetect = -1;
    this.cuadros = 0;
    this.tFps = 0;
    this.fps = 0;
    this.mirada = { x: 0, y: 0, active: false };
    this.ultimaMiradaEmitida = null;
    this.abortar = new AbortController();
    const signal = this.abortar.signal;
    this.emitirEstado();
    this.animId = requestAnimationFrame(this.bucle);

    const { listo, tardio } = crearLandmarker({ ...this.op.carga, signal, log: this.log });
    try {
      const lm = await listo;
      if (signal.aborted) {
        lm.landmarker.close();
        return;
      }
      this.usarMediapipe(lm);
    } catch (e) {
      if (signal.aborted) return;
      this.log('[vision] MediaPipe no disponible:', esTiempoAgotado(e) ? 'tiempo agotado (6 s)' : (e as Error)?.message ?? e);
      this.usarOptico();
      if (esTiempoAgotado(e)) {
        // Si el modelo termina de cargar más tarde, subimos de óptico a MediaPipe sin cortar nada.
        tardio.then(
          (lm) => {
            if (signal.aborted || !this.corriendo) {
              lm.landmarker.close();
              return;
            }
            this.usarMediapipe(lm);
          },
          () => {}
        );
      }
    }
  }

  detener() {
    this.corriendo = false;
    this.abortar?.abort();
    this.abortar = null;
    if (this.animId !== null) {
      cancelAnimationFrame(this.animId);
      this.animId = null;
    }
    if (this.landmarker) {
      try {
        this.landmarker.landmarker.close();
      } catch {
        /* ya cerrado */
      }
      this.landmarker = null;
    }
    if (this.optico) {
      this.optico.stop();
      this.optico = null;
    }
    this.video = null;
    this.motor = 'ninguno';
    this.mirada = { x: 0, y: 0, active: false };
    this.emitirMirada();
  }

  /** Emite `onGaze` solo si cambió respecto de la última emisión (x,y a 2 decimales o `active`). */
  private emitirMirada() {
    const x = Math.round(this.mirada.x * 100) / 100;
    const y = Math.round(this.mirada.y * 100) / 100;
    const active = this.mirada.active;
    const u = this.ultimaMiradaEmitida;
    if (u && u.active === active && u.x === x && u.y === y) return;
    this.ultimaMiradaEmitida = { x, y, active };
    this.op.onGaze?.({ x, y, active });
  }

  private usarMediapipe(lm: LandmarkerListo) {
    if (this.landmarker && this.landmarker !== lm) {
      try {
        this.landmarker.landmarker.close();
      } catch {
        /* nada */
      }
    }
    this.landmarker = lm;
    if (this.optico) {
      this.optico.stop();
      this.optico = null;
    }
    // Si el óptico ya confirmó a alguien, se conserva la presencia (sin segundo `llego`).
    if (this.motor === 'optico') this.maquina.cambiarMotor();
    else this.maquina.reiniciar();
    this.motor = 'mediapipe';
    this.log('[vision] motor', this.motor);
    this.emitirEstado();
  }

  private usarOptico() {
    if (!this.optico) this.optico = new OpticalFaceTracker();
    if (this.video) this.optico.setVideoElement(this.video);
    this.motor = 'optico';
    this.log('[vision] motor', this.motor);
    this.emitirEstado();
  }

  private emitirEstado() {
    this.op.onEstado?.(this.estado);
  }

  private bucle = (ahora: number) => {
    if (!this.corriendo) return;
    this.animId = requestAnimationFrame(this.bucle);

    const intervalo = 1000 / this.fpsObjetivo;
    if (ahora - this.ultimoPaso < intervalo - 1) return;
    this.ultimoPaso = ahora;

    const v = this.video;
    if (!v || v.readyState < 2 || v.videoWidth === 0 || document.hidden) return;

    let obs: Observacion | null = null;
    if (this.motor === 'mediapipe' && this.landmarker) {
      // MediaPipe exige timestamps estrictamente crecientes (ms).
      const ts = Math.max(Math.floor(ahora), this.ultimoTsDetect + 1);
      this.ultimoTsDetect = ts;
      try {
        const r = this.landmarker.landmarker.detectForVideo(v, ts);
        obs = observacionDesdeResultado(r, ahora, v.videoHeight > 0 ? v.videoWidth / v.videoHeight : 4 / 3);
      } catch (e) {
        this.log('[vision] detectForVideo falló, paso a óptico:', (e as Error)?.message ?? e);
        try {
          this.landmarker.landmarker.close();
        } catch {
          /* nada */
        }
        this.landmarker = null;
        this.usarOptico();
        return;
      }
    } else if (this.motor === 'optico' && this.optico) {
      this.optico.setVideoElement(v);
      if (this.optico.paso(ahora)) obs = this.optico.observacion(ahora);
    } else {
      return; // cargando: todavía no hay motor
    }
    if (!obs) return;

    // fps reales de detección
    this.cuadros++;
    if (!this.tFps) this.tFps = ahora;
    else if (ahora - this.tFps >= 1000) {
      this.fps = Math.round((this.cuadros * 1000) / (ahora - this.tFps));
      this.cuadros = 0;
      this.tFps = ahora;
      this.emitirEstado();
    }

    const escena = this.maquina.procesar(obs);

    // Mirada: hacia la cara principal, suavizada; sin cara vuelve al centro despacio.
    const cara = obs.cara;
    if (cara) {
      this.objetivoMirada.x = Math.max(-1, Math.min(1, -(cara.cx * 2 - 1) * 1.4));
      this.objetivoMirada.y = Math.max(-1, Math.min(1, (cara.cy * 2 - 1) * 1.2));
    } else {
      this.objetivoMirada.x = 0;
      this.objetivoMirada.y = 0;
    }
    const k = cara ? 0.28 : 0.06;
    this.mirada.x += (this.objetivoMirada.x - this.mirada.x) * k;
    this.mirada.y += (this.objetivoMirada.y - this.mirada.y) * k;
    this.mirada.active = !!escena.principal;
    this.emitirMirada();

    if (escena.eventos.length > 0 || ahora - this.ultimaEmision >= this.intervaloEstadoMs) {
      this.ultimaEmision = ahora;
      this.op.onEscena?.(escena);
    }
  };
}
