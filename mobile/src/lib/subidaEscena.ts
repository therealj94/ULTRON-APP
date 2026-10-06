/**
 * LA FOTO DE LA ESCENA AL SERVIDOR DESDE LA CÁMARA EN VIVO (components/CamaraVivo.tsx), con su IO por fuera para
 * probarla en Node (pruebas/camara/contratos.prueba.mjs). CAM-B, CAM-E y CAM-G del master §25:
 *
 *  · La voz primero (CAM-B): el mismo `intervaloServidor` que la cámara de fotos, CON `ocupada` (la mesa piensa o
 *    habla → no se sube nada). Si la mesa empieza a hablar mientras se sacaba la foto, no se sube.
 *  · La respuesta es de la cámara que la pidió (CAM-E): sello del cerco antes de la foto y otra vez antes de aplicar;
 *    cambiar frontal→trasera (o apagar) mientras el servidor mira hace que esa vista no se aplique a la escena nueva.
 *  · Fechada al capturar (CAM-G): la vista lleva la hora de captura de la foto (la del nativo; si no la trae, la de
 *    antes de pedirla), su lado y su época: «Lo que veo» la dibuja solo sobre esa foto y unos segundos.
 */
import { ORIGEN, type CercoCamara, type VistaFechada } from './cercoCamara';
import { intervaloServidor, mismaEscena, type VistaCamara } from './vistaCamara';
import type { Lado } from './vistaEnVivo';

export type FotoEscena = { b64?: string; ts?: number; epoca?: number; lado?: string } | null;

export type IoEscena = {
  ahora: () => number;
  foto: () => Promise<FotoEscena>;
  ver: (b64: string) => Promise<VistaCamara | null>;
  /** Lo de este momento: si duerme, cuántas personas, si «Comenta lo que ve» pide escena y si la mesa piensa/habla. */
  estado: () => { dormida: boolean; personas: number; necesitaEscena: boolean; ocupada: boolean };
  aplicar: (v: VistaFechada<VistaCamara> & { lado: Lado; epoca: number }) => void;
  /** Por qué no se aplicó algo (para las migas). */
  descartada?: (motivo: string) => void;
};

export const MINIMO_FOTO_ESCENA = 4000;

export class SubidaEscena {
  private vivo = true;
  private subiendo = false;
  private ultimo = 0;
  private sinCambios = 0;
  private personasAntes = -1;
  private antes: VistaCamara | null = null;

  constructor(private io: IoEscena, private cerco: CercoCamara) {}

  /** Cada segundo: ¿toca subir? Devuelve la subida en curso (para esperarla en las pruebas) o null. */
  tic(): Promise<void> | null {
    if (!this.vivo || this.subiendo) return null;
    const st = this.io.estado();
    if (this.personasAntes >= 0 && st.personas !== this.personasAntes) this.sinCambios = 0;
    this.personasAntes = st.personas;
    const cada = intervaloServidor({ mlkit: true, dormida: st.dormida, conPersona: st.personas > 0, necesitaEscena: st.necesitaEscena, sinCambios: this.sinCambios, ocupada: st.ocupada });
    const ahora = this.io.ahora();
    if (!(ahora - this.ultimo >= cada)) return null;
    const previo = this.ultimo;
    this.ultimo = ahora;
    this.subiendo = true;
    const sello = this.cerco.sello();
    return (async () => {
      try {
        const f = await this.io.foto();
        if (!this.vivo || !f?.b64 || f.b64.length < MINIMO_FOTO_ESCENA) return;
        // Empezó a hablar mientras se sacaba la foto: no se sube (y se vuelve a intentar cuando termine).
        if (this.io.estado().ocupada) {
          this.ultimo = previo;
          return this.io.descartada?.('la mesa empezó a hablar');
        }
        const m = this.cerco.admitirResultado(f, sello, this.io.ahora(), ORIGEN.fotoMaxMs);
        if (m !== 'ok') return this.io.descartada?.(`foto ${m}`);
        const capturada = typeof f.ts === 'number' && f.ts > 0 ? f.ts : ahora;
        const v = await this.io.ver(f.b64);
        if (!this.vivo || !v) return;
        if (!this.cerco.vigente(sello)) return this.io.descartada?.('vista de la cámara anterior');
        this.sinCambios = mismaEscena(this.antes, v) ? this.sinCambios + 1 : 0;
        this.antes = v;
        this.io.aplicar({ v, ts: capturada, lado: sello.lado, epoca: sello.epoca });
      } catch {
        /* sin vista esta vez */
      } finally {
        this.subiendo = false;
      }
    })();
  }

  detener() {
    this.vivo = false;
  }
}
