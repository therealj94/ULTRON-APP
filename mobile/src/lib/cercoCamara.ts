/**
 * DE QUÉ CÁMARA Y DE CUÁNDO ES CADA COSA (master §25.5; CAM-C, CAM-E, CAM-G). Lo puro: se prueba en Node
 * (pruebas/camara/contratos.prueba.mjs).
 *
 * Todo lo que la cámara en vivo produce llega tarde y por otro hilo: eventos del nativo, recortes para reconocer,
 * fotos para el servidor y su respuesta. Antes se fechaban al LLEGAR (Date.now) y solo se miraba el lado; ahora cada
 * cosa lleva su ORIGEN y se cerca antes de aplicarla:
 *
 *  · `CercoCamara.sello()` antes de pedir algo; `vigente(sello)` después de cada await. Cambiar de cámara
 *    (`poner(lado)`), apagarla o volver a montarla sube la época: lo pedido antes no se aplica a la escena nueva.
 *  · `admitirEvento`: un evento del nativo de otra cámara, de una época vieja del nativo (otro enlace de CameraX),
 *    fuera de orden (`cuadro`) o con la captura demasiado vieja (o del futuro) se descarta.
 *  · `admitirResultado`: lo mismo para un recorte o una foto (su `ts` es la hora de CAPTURA del cuadro).
 *  · `vistaVigente`: los objetos que vio el servidor valen sobre ESA foto: unos segundos desde su captura, con la
 *    misma cámara y sin que el teléfono se haya movido después. Nunca como seguimiento continuo.
 *
 * Una APK anterior (OTA sin el Kotlin nuevo) no manda `epoca`/`cuadro`: entonces valen el lado, la edad y la época
 * de JS, que no dependen del nativo.
 */
import type { Lado } from './vistaEnVivo';

export type SelloCamara = { epoca: number; lado: Lado };
export type MotivoDescarte = 'ok' | 'cambio' | 'otro-lado' | 'epoca-vieja' | 'desordenado' | 'viejo' | 'futuro';

export const ORIGEN = {
  /** Un evento del nativo con la captura más vieja que esto ya no describe la escena (cola del puente, pausa). */
  eventoMaxMs: 1500,
  /** Un recorte para reconocer: del cuadro analizado hace menos que esto. */
  recorteMaxMs: 2500,
  /** Una foto para el servidor (la cámara de fotos tarda más que un cuadro). */
  fotoMaxMs: 4000,
  /** Holgura para relojes: una captura «del futuro» más allá de esto es basura. */
  futuroMs: 250,
};

/** Lo que trae del nativo cualquier cosa fechada (evento, recorte, foto). Todos opcionales menos lo que ya había. */
export type OrigenNativo = { ts?: number; epoca?: number; cuadro?: number; lado?: string };

export class CercoCamara {
  private epoca = 1;
  private lado: Lado;
  private epocaNativa = -1;
  private cuadro = -1;

  constructor(lado: Lado = 'frontal') {
    this.lado = lado;
  }

  /** La cámara que debe estar mirando. Si cambia, todo lo pedido con la anterior deja de valer. */
  poner(lado: Lado): boolean {
    if (lado === this.lado) return false;
    this.lado = lado;
    this.epoca += 1;
    return true;
  }

  /** Apagar / segundo plano: nada pedido antes se aplica. */
  invalidar() {
    this.epoca += 1;
  }

  /** Se montó otra vista nativa: su época y sus cuadros empiezan de cero. */
  montada() {
    this.epoca += 1;
    this.epocaNativa = -1;
    this.cuadro = -1;
  }

  sello(): SelloCamara {
    return { epoca: this.epoca, lado: this.lado };
  }

  vigente(s: SelloCamara | null | undefined): boolean {
    return !!s && s.epoca === this.epoca && s.lado === this.lado;
  }

  get epocaActual(): number {
    return this.epoca;
  }

  get ladoActual(): Lado {
    return this.lado;
  }

  /** ¿Se usa este evento del nativo? Lleva la cuenta de época y cuadro del nativo. */
  admitirEvento(e: OrigenNativo & { lado: string; ts: number }, ahora: number): MotivoDescarte {
    if (e.lado !== this.lado) return 'otro-lado';
    if (typeof e.epoca === 'number') {
      if (e.epoca < this.epocaNativa) return 'epoca-vieja';
      if (e.epoca > this.epocaNativa) {
        this.epocaNativa = e.epoca;
        this.cuadro = -1;
      }
    }
    if (typeof e.cuadro === 'number') {
      if (e.cuadro <= this.cuadro) return 'desordenado';
      this.cuadro = e.cuadro;
    }
    return edad(e.ts, ahora, ORIGEN.eventoMaxMs);
  }

  /** ¿Se aplica este recorte o esta foto pedidos con `s`? */
  admitirResultado(r: OrigenNativo | null | undefined, s: SelloCamara, ahora: number, maxMs: number): MotivoDescarte {
    if (!this.vigente(s)) return 'cambio';
    if (!r) return 'cambio';
    if (typeof r.lado === 'string' && r.lado !== s.lado) return 'otro-lado';
    if (typeof r.epoca === 'number' && this.epocaNativa >= 0 && r.epoca !== this.epocaNativa) return 'epoca-vieja';
    return typeof r.ts === 'number' && r.ts > 0 ? edad(r.ts, ahora, maxMs) : 'ok';
  }
}

function edad(ts: number, ahora: number, maxMs: number): MotivoDescarte {
  if (!(ts > 0)) return 'ok';
  if (ts - ahora > ORIGEN.futuroMs) return 'futuro';
  return ahora - ts > maxMs ? 'viejo' : 'ok';
}

/* ── lo que vio el servidor: sobre ESA foto ──────────────────────────────────────────────────── */

/** Los objetos del servidor valen sobre su foto: como mucho esto desde su CAPTURA. */
export const VISTA_SERVIDOR_MS = 8000;

export type VistaFechada<V> = { v: V; ts: number; lado?: Lado; epoca?: number };

/**
 * ¿Se pueden dibujar todavía los objetos de esta vista? Fecha de captura (no de llegada), misma cámara y época, y
 * el teléfono quieto desde que se sacó la foto (`movidaEn`: la última vez que se movió).
 */
export function vistaVigente<V>(vista: VistaFechada<V> | null | undefined, o: { ahora: number; lado: Lado; epoca?: number; movidaEn?: number }): boolean {
  if (!vista || !Number.isFinite(vista.ts)) return false;
  if (o.ahora - vista.ts > VISTA_SERVIDOR_MS || vista.ts - o.ahora > ORIGEN.futuroMs) return false;
  if (vista.lado && vista.lado !== o.lado) return false;
  if (typeof vista.epoca === 'number' && typeof o.epoca === 'number' && vista.epoca !== o.epoca) return false;
  if (typeof o.movidaEn === 'number' && o.movidaEn > vista.ts) return false;
  return true;
}

/**
 * ¿Se movió el teléfono? Dos lecturas seguidas del acelerómetro (en g): el cambio del VECTOR, no solo de su largo
 * (girar el teléfono cambia hacia dónde cae la gravedad aunque el largo siga en 1 g).
 */
export function seMovioTelefono(a: { x: number; y: number; z: number } | null, b: { x: number; y: number; z: number }, umbral = 0.08): boolean {
  if (!a) return false;
  return Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z) >= umbral;
}
