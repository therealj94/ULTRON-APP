/**
 * LO QUE HACE LA CÁMARA CADA MINUTO (José, 6-oct: «la cámara tarda en reconocer y se queda atrasado con la voz»). Mientras
 * está encendida, una miga por minuto:
 *
 *   cámara 60 s: 2.9 f/s · foto 180 · mlkit 40 · lee 13 · caras 4× 650 (motor 480, 75 KB) · pausa 3 · sube 1 · js 12/380
 *
 *  · f/s     fotos por segundo del bucle;
 *  · foto    lo que tarda `takePictureAsync` (ms, media);  mlkit: lo que tarda ML Kit con esa foto;
 *  · lee     leer la foto en base64 del disco (solo cuando el motor de caras o el servidor la quieren);
 *  · caras   análisis del motor de caras: cuántos, ida y vuelta (ms, media), lo que tardó la WebView y el tamaño mandado;
 *  · pausa   veces que no se reconoció por estar pensando o hablando (lib/camaraModo.ts, caras/seguimiento.ts);
 *  · sube    fotos subidas al servidor;  js: atraso medio/máximo del hilo de JS (lib/pulsoJs.ts).
 *
 * Pura: se prueba en Node (tests/latencia-movil.test.ts).
 */

export const RESUMEN_CAMARA_MS = 60_000;

const media = (a: number[]) => (a.length ? Math.round(a.reduce((s, x) => s + x, 0) / a.length) : 0);

export class EstadisticaCamara {
  private desde: number;
  private fotos: number[] = [];
  private ml: number[] = [];
  private lecturas: { ms: number; car: number }[] = [];
  private analisisMs: { ida: number; motor?: number }[] = [];
  private pausas = 0;
  private subidas = 0;
  constructor(ahora = Date.now()) {
    this.desde = ahora;
  }
  foto(ms: number) {
    this.fotos.push(ms);
  }
  mlkit(ms: number) {
    this.ml.push(ms);
  }
  /** Leer la foto en base64 (`car`: largo del base64). */
  lectura(ms: number, car: number) {
    this.lecturas.push({ ms, car });
  }
  /** Un análisis del motor de caras: ida y vuelta, y lo que dijo la WebView que tardó. */
  analisis(idaMs: number, motorMs?: number) {
    this.analisisMs.push({ ida: idaMs, ...(typeof motorMs === 'number' && Number.isFinite(motorMs) ? { motor: motorMs } : {}) });
  }
  /** No se reconoció esta foto porque la mesa pensaba o hablaba. */
  saltada() {
    this.pausas += 1;
  }
  subida() {
    this.subidas += 1;
  }
  toca(ahora: number): boolean {
    return ahora - this.desde >= RESUMEN_CAMARA_MS;
  }
  reiniciar(ahora: number) {
    this.desde = ahora;
    this.fotos = [];
    this.ml = [];
    this.lecturas = [];
    this.analisisMs = [];
    this.pausas = 0;
    this.subidas = 0;
  }

  /** La línea del período (y se reinicia). null si no hubo fotos (la cámara recién encendida o dormida). */
  linea(ahora: number, js?: { media: number; max: number }): string | null {
    const seg = Math.max(1, (ahora - this.desde) / 1000);
    const n = this.fotos.length;
    const partes: string[] = [];
    if (n) {
      partes.push(`${(n / seg).toFixed(1)} f/s`, `foto ${media(this.fotos)}`);
      if (this.ml.length) partes.push(`mlkit ${media(this.ml)}`);
      if (this.lecturas.length) partes.push(`lee ${media(this.lecturas.map((l) => l.ms))}`);
      if (this.analisisMs.length) {
        const motor = this.analisisMs.filter((a) => a.motor !== undefined).map((a) => a.motor!);
        const kb = this.lecturas.length ? Math.round(media(this.lecturas.map((l) => l.car)) / 1000) : 0;
        const det = [motor.length ? `motor ${media(motor)}` : '', kb ? `${kb} KB` : ''].filter(Boolean).join(', ');
        partes.push(`caras ${this.analisisMs.length}× ${media(this.analisisMs.map((a) => a.ida))}${det ? ` (${det})` : ''}`);
      }
      if (this.pausas) partes.push(`pausa ${this.pausas}`);
      if (this.subidas) partes.push(`sube ${this.subidas}`);
      if (js) partes.push(`js ${Math.round(js.media)}/${Math.round(js.max)}`);
    }
    const s = Math.round(seg);
    this.reiniciar(ahora);
    return n ? `cámara ${s} s: ${partes.join(' · ')}` : null;
  }
}

/** La de la app (la cámara y el motor de caras anotan aquí). */
export const estadisticaCamara = new EstadisticaCamara();
