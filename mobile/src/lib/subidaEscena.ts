/**
 * LA FOTO DE LA ESCENA AL SERVIDOR DESDE LA CÁMARA EN VIVO (components/CamaraVivo.tsx), con su IO por fuera para
 * probarla en Node (pruebas/camara/contratos.prueba.mjs). CAM-B, CAM-E y CAM-G del master §25:
 *
 *  · La voz primero (CAM-B): el mismo `intervaloServidor` que la cámara de fotos, CON `ocupada` (la mesa piensa o
 *    habla → no se sube nada). Si la mesa empieza a hablar mientras se sacaba la foto, no se sube TODAVÍA: se guarda y
 *    sube apenas la mesa calla, si sigue valiendo (José, 6-oct: «escena descartada (la mesa empezó a hablar)»).
 *  · La respuesta es de la cámara que la pidió (CAM-E): sello del cerco antes de la foto y otra vez antes de aplicar;
 *    cambiar frontal→trasera (o apagar) mientras el servidor mira hace que esa vista no se aplique a la escena nueva.
 *  · Fechada al capturar (CAM-G): la vista lleva la hora de captura de la foto (la del nativo; si no la trae, la de
 *    antes de pedirla), su lado y su época: «Lo que veo» la dibuja solo sobre esa foto y unos segundos.
 *  · En vivo y barato (José, 6-oct: «no se siente en vivo»): sin «Comenta lo que ve» también se sube, pero solo si
 *    ML Kit vio que la escena cambió desde la última vista (`cambioEn`) o aún no hay ninguna (SUBIDA.vivoMs). La vista
 *    va con su foto a `aplicar`: la mesa la guarda como vista fresca (lib/vistaTurno.ts) y «¿qué ves?» contesta al
 *    instante.
 *  · Si el servidor no puede ver (503 seguidos, el 6-oct durante 10 min), cada fallo espacia la siguiente subida en
 *    vez de insistir cada 20 s.
 *  · Sin pagar de más (revisión del 6-oct): mover el teléfono (`movidaEn`) solo cuenta como escena nueva cuando se
 *    queda quieto `SUBIDA.quietoTrasMoverMs` en la posición nueva (caminar con él en la mano no sube nada), y las
 *    subidas en vivo tienen un tope de `SUBIDA.vivoMaxHora` por hora. El servidor las mira primero con Bedrock
 *    (`continuo`, lib/vision.ts ordenOjos).
 */
import { ORIGEN, type CercoCamara, type VistaFechada } from './cercoCamara';
import { SUBIDA, intervaloServidor, mismaEscena, type VistaCamara } from './vistaCamara';
import type { Lado } from './vistaEnVivo';

export type FotoEscena = { b64?: string; ts?: number; epoca?: number; lado?: string } | null;

export type IoEscena = {
  ahora: () => number;
  foto: () => Promise<FotoEscena>;
  ver: (b64: string) => Promise<VistaCamara | null>;
  /**
   * Lo de este momento: si duerme, cuántas personas, si «Comenta lo que ve» pide escena, si la mesa piensa/habla,
   * cuándo vio ML Kit el último cambio de la escena (llegó/se fue alguien; 0 si no se sabe) y cuándo se movió el
   * teléfono por última vez (el acelerómetro; 0 si no se sabe).
   */
  estado: () => { dormida: boolean; personas: number; necesitaEscena: boolean; ocupada: boolean; cambioEn?: number; movidaEn?: number };
  aplicar: (v: VistaFechada<VistaCamara> & { lado: Lado; epoca: number; foto?: string }) => void;
  /** Por qué no se aplicó algo (para las migas). */
  descartada?: (motivo: string) => void;
};

export const MINIMO_FOTO_ESCENA = 4000;
/**
 * La foto guardada mientras la mesa hablaba sube al callarse si es de hace menos que esto: lo mismo que vale una vista
 * fresca para «¿qué ves?» (lib/vistaTurno.ts VISTA_TURNO.frescaMs), así la que llega sirve al turno siguiente.
 */
export const PENDIENTE_MAX_MS = 20_000;

export class SubidaEscena {
  private vivo = true;
  private subiendo = false;
  private ultimo = 0;
  private sinCambios = 0;
  private personasAntes = -1;
  private antes: VistaCamara | null = null;
  /** Hora de captura de la última vista aplicada (0: ninguna todavía). */
  private vistaEn = 0;
  /** Subidas seguidas sin vista (el servidor no pudo ver). */
  private fallos = 0;
  /** Cuándo salió cada subida en vivo de la última hora (el tope SUBIDA.vivoMaxHora). */
  private vivasHora: number[] = [];
  private topeAvisado = false;
  /**
   * La foto que ya se sacó cuando la mesa empezó a hablar (José, 6-oct: «escena descartada (la mesa empezó a hablar)»).
   * Antes se tiraba y, al callarse la mesa, había que sacar otra y esperar al servidor: lo que se veía mientras hablaba
   * no llegaba al turno siguiente. Ahora se guarda y sube apenas la mesa queda libre, si sigue valiendo (misma cámara,
   * de hace ≤ `PENDIENTE_MAX_MS` y sin que la escena cambiara después).
   */
  private pendiente: { f: { b64: string; ts?: number; epoca?: number; lado?: string }; sello: ReturnType<CercoCamara['sello']>; capturada: number; enVivo: boolean } | null = null;

  constructor(private io: IoEscena, private cerco: CercoCamara) {}

  /** Cada segundo: ¿toca subir? Devuelve la subida en curso (para esperarla en las pruebas) o null. */
  tic(): Promise<void> | null {
    if (!this.vivo || this.subiendo) return null;
    const st = this.io.estado();
    if (this.pendiente && !st.ocupada) {
      const pe = this.pendiente;
      this.pendiente = null;
      const ahora = this.io.ahora();
      const vieja = ahora - pe.capturada > PENDIENTE_MAX_MS || (st.cambioEn ?? 0) > pe.capturada || (st.movidaEn ?? 0) > pe.capturada;
      if (!vieja && this.cerco.vigente(pe.sello)) {
        this.ultimo = ahora;
        this.subiendo = true;
        return this.subir(pe.f, pe.sello, pe.capturada, pe.enVivo, ahora);
      }
      this.io.descartada?.(vieja ? 'la guardada mientras hablaba ya es vieja' : 'la guardada mientras hablaba es de la cámara anterior');
    }
    if (this.personasAntes >= 0 && st.personas !== this.personasAntes) this.sinCambios = 0;
    this.personasAntes = st.personas;
    const ahora = this.io.ahora();
    // El teléfono movido después de la última vista cuenta solo si ya se quedó quieto en la posición nueva.
    const movidaEn = st.movidaEn ?? 0;
    const asentado = movidaEn > this.vistaEn && ahora - movidaEn >= SUBIDA.quietoTrasMoverMs;
    const cambio = !this.vistaEn || (st.cambioEn ?? 0) > this.vistaEn || asentado;
    const cada = intervaloServidor({ mlkit: true, dormida: st.dormida, conPersona: st.personas > 0, necesitaEscena: st.necesitaEscena, sinCambios: this.sinCambios, ocupada: st.ocupada, cambio, fallos: this.fallos });
    if (!(ahora - this.ultimo >= cada)) return null;
    const enVivo = !st.necesitaEscena;
    if (enVivo) {
      this.vivasHora = this.vivasHora.filter((t) => ahora - t < 3_600_000);
      if (this.vivasHora.length >= SUBIDA.vivoMaxHora) {
        if (!this.topeAvisado) this.io.descartada?.(`tope de ${SUBIDA.vivoMaxHora} subidas en vivo por hora`);
        this.topeAvisado = true;
        return null;
      }
      this.topeAvisado = false;
    }
    const previo = this.ultimo;
    this.ultimo = ahora;
    this.subiendo = true;
    const sello = this.cerco.sello();
    return (async () => {
      let sigue = false;
      try {
        const f = await this.io.foto();
        if (!this.vivo || !f?.b64 || f.b64.length < MINIMO_FOTO_ESCENA) return;
        const m = this.cerco.admitirResultado(f, sello, this.io.ahora(), ORIGEN.fotoMaxMs);
        if (m !== 'ok') return this.io.descartada?.(`foto ${m}`);
        const capturada = typeof f.ts === 'number' && f.ts > 0 ? f.ts : ahora;
        // Empezó a hablar mientras se sacaba la foto: no se sube ahora (la voz primero, CAM-B), pero tampoco se tira: se
        // guarda y sube apenas la mesa quede libre (ver `pendiente`).
        if (this.io.estado().ocupada) {
          this.ultimo = previo;
          this.pendiente = { f: { b64: f.b64, ts: f.ts, epoca: f.epoca, lado: f.lado }, sello, capturada, enVivo };
          return this.io.descartada?.('la mesa empezó a hablar; la guardo para cuando calle');
        }
        sigue = true;
        await this.subir(f as { b64: string }, sello, capturada, enVivo, ahora);
      } catch {
        /* sin vista esta vez */
      } finally {
        if (!sigue) this.subiendo = false;
      }
    })();
  }

  /** La foto (ya admitida) al servidor y, si vuelve con vista y la cámara sigue siendo la misma, a la mesa. */
  private async subir(f: { b64: string }, sello: ReturnType<CercoCamara['sello']>, capturada: number, enVivo: boolean, ahora: number): Promise<void> {
    try {
      // Cuenta para el tope la que de verdad va al servidor.
      if (enVivo) this.vivasHora.push(ahora);
      const v = await this.io.ver(f.b64).catch(() => null);
      if (!this.vivo) return;
      if (!v) {
        this.fallos += 1;
        return;
      }
      this.fallos = 0;
      if (!this.cerco.vigente(sello)) return this.io.descartada?.('vista de la cámara anterior');
      this.sinCambios = mismaEscena(this.antes, v) ? this.sinCambios + 1 : 0;
      this.antes = v;
      this.vistaEn = capturada;
      this.io.aplicar({ v, ts: capturada, lado: sello.lado, epoca: sello.epoca, foto: f.b64 });
    } catch {
      /* sin vista esta vez */
    } finally {
      this.subiendo = false;
    }
  }

  detener() {
    this.vivo = false;
  }
}
