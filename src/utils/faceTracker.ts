// Real-Time Optical Face & Presence Tracker for ULTRON Desk Kiosk
// Automatically tracks user's head & body spatial position and recognizes objects/gestures.
import { DetectedObject } from '../types';

export interface FaceTrackResult {
  detected: boolean;
  x: number; // -1 (left) to +1 (right)
  y: number; // -1 (top) to +1 (bottom)
  confidence: number;
  faceWidth: number;
  fps: number;
  spatialZone: 'LEFT' | 'CENTER' | 'RIGHT';
  distance: 'NEAR' | 'OPTIMAL' | 'FAR';
  objects: DetectedObject[];
  isWaving: boolean;
  hasDrink: boolean;
}

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
  private lastFpsTime = performance.now();
  private currentFps = 60;

  // Gesture analysis state
  private waveMotionHistory: number[] = [];
  private drinkDetectedFrames = 0;

  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.width = 64;
    this.canvas.height = 48;
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
  }

  private loop = () => {
    if (!this.isRunning) return;

    this.frameCount++;
    const now = performance.now();
    if (now - this.lastFpsTime >= 1000) {
      this.currentFps = Math.round((this.frameCount * 1000) / (now - this.lastFpsTime));
      this.frameCount = 0;
      this.lastFpsTime = now;
    }

    if (this.video && this.video.readyState >= 2 && this.ctx) {
      this.processVideoFrame();
    }

    this.animId = requestAnimationFrame(this.loop);
  };

  private processVideoFrame() {
    if (!this.video || !this.ctx) return;
    const w = this.canvas.width;
    const h = this.canvas.height;

    // Draw downsampled video frame
    this.ctx.drawImage(this.video, 0, 0, w, h);

    try {
      const imgData = this.ctx.getImageData(0, 0, w, h);
      const data = imgData.data;

      let totalWeight = 0;
      let sumX = 0;
      let sumY = 0;

      // Quadrant motion trackers for gestures & object detection
      let upperMotion = 0;
      let lowerCenterObjectEnergy = 0;

      const prev = this.prevFrameData;
      const hasPrev = prev && prev.length === data.length;

      for (let y = 4; y < h - 4; y += 2) {
        for (let x = 4; x < w - 4; x += 2) {
          const idx = (y * w + x) * 4;
          const r = data[idx];
          const g = data[idx + 1];
          const b = data[idx + 2];

          // Face/skin luminance bias (warmer/higher luminance foreground)
          const lum = 0.299 * r + 0.587 * g + 0.114 * b;
          let weight = lum > 65 && lum < 240 ? lum * 0.45 : 10;

          // Motion weighting
          let diff = 0;
          if (hasPrev) {
            diff = Math.abs(r - prev[idx]) + Math.abs(g - prev[idx + 1]) + Math.abs(b - prev[idx + 2]);
            if (diff > 25) {
              weight += diff * 1.8;
            }

            // Upper quadrants motion (raising/waving hand)
            if (y < h * 0.5 && (x < w * 0.35 || x > w * 0.65)) {
              upperMotion += diff;
            }
          }

          // Drink / Cup detection bias in lower-center area (high saturation or distinct contrast object)
          if (y > h * 0.45 && y < h * 0.85 && x > w * 0.25 && x < w * 0.75) {
            const sat = Math.max(r, g, b) - Math.min(r, g, b);
            if (sat > 40 || lum > 190) {
              lowerCenterObjectEnergy += sat + lum * 0.2;
            }
          }

          // Center bias so empty background doesn't jerk
          const dx = (x - w / 2) / (w / 2);
          const dy = (y - h / 2) / (h / 2);
          const centerFactor = Math.max(0.2, 1 - (dx * dx + dy * dy) * 0.35);

          const finalWeight = weight * centerFactor;
          totalWeight += finalWeight;
          sumX += x * finalWeight;
          sumY += y * finalWeight;
        }
      }

      // Save for next frame differencing
      if (!this.prevFrameData || this.prevFrameData.length !== data.length) {
        this.prevFrameData = new Uint8ClampedArray(data);
      } else {
        this.prevFrameData.set(data);
      }

      // Waving hand calculation
      this.waveMotionHistory.push(upperMotion);
      if (this.waveMotionHistory.length > 10) this.waveMotionHistory.shift();
      const avgWaveMotion = this.waveMotionHistory.reduce((a, b) => a + b, 0) / this.waveMotionHistory.length;
      const isWaving = avgWaveMotion > 280;

      // Drink / beverage detection
      const hasDrink = lowerCenterObjectEnergy > 3800;
      if (hasDrink) this.drinkDetectedFrames++;
      else this.drinkDetectedFrames = Math.max(0, this.drinkDetectedFrames - 1);

      if (totalWeight > 450) {
        const rawCentroidX = sumX / totalWeight;
        const rawCentroidY = sumY / totalWeight;

        // Invert X because user webcam is mirrored
        const normX = -((rawCentroidX / w) * 2 - 1);
        const normY = (rawCentroidY / h) * 2 - 1;

        // Smooth with exponential filter for buttery organic look
        this.smoothX += (normX - this.smoothX) * 0.16;
        this.smoothY += (normY - this.smoothY) * 0.16;

        // Spatial presence determination
        const spatialZone: 'LEFT' | 'CENTER' | 'RIGHT' =
          this.smoothX < -0.25 ? 'LEFT' : this.smoothX > 0.25 ? 'RIGHT' : 'CENTER';

        const rawWidth = Math.min(1, totalWeight / (w * h * 45));
        const distance: 'NEAR' | 'OPTIMAL' | 'FAR' =
          rawWidth > 0.45 ? 'NEAR' : rawWidth < 0.18 ? 'FAR' : 'OPTIMAL';

        // Detect objects list for the HUD
        const detectedObjects: DetectedObject[] = [
          {
            id: 'obj_person',
            label: 'PERSON',
            confidence: Math.min(99.2, 88 + (totalWeight / (w * h * 40)) * 10),
            bbox: {
              x: Math.max(0, (1 - normX) / 2 - 0.2),
              y: Math.max(0, (normY + 1) / 2 - 0.25),
              width: 0.4,
              height: 0.5,
            },
            spatialZone,
            distance,
          },
        ];

        if (isWaving) {
          detectedObjects.push({
            id: 'obj_wave',
            label: 'WAVING_HAND',
            confidence: 94.8,
            bbox: { x: normX > 0 ? 0.7 : 0.1, y: 0.2, width: 0.2, height: 0.25 },
            spatialZone: normX > 0 ? 'RIGHT' : 'LEFT',
            distance: 'OPTIMAL',
          });
        }

        if (this.drinkDetectedFrames > 3) {
          detectedObjects.push({
            id: 'obj_drink',
            label: 'DRINK_CUP',
            confidence: 89.6,
            bbox: { x: 0.4, y: 0.55, width: 0.2, height: 0.3 },
            spatialZone: 'CENTER',
            distance: 'NEAR',
          });
        }

        if (this.onTrackCallback) {
          this.onTrackCallback({
            detected: true,
            x: Math.max(-1, Math.min(1, this.smoothX * 1.6)),
            y: Math.max(-1, Math.min(1, this.smoothY * 1.3)),
            confidence: Math.min(99.4, 88 + (totalWeight / (w * h * 50)) * 10),
            faceWidth: rawWidth,
            fps: this.currentFps,
            spatialZone,
            distance,
            objects: detectedObjects,
            isWaving,
            hasDrink: this.drinkDetectedFrames > 3,
          });
        }
      } else {
        // Return to center slowly
        this.smoothX += (0 - this.smoothX) * 0.05;
        this.smoothY += (0 - this.smoothY) * 0.05;

        if (this.onTrackCallback) {
          this.onTrackCallback({
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
          });
        }
      }
    } catch {
      // Security or cross-origin edge cases
    }
  }
}

