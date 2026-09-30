/**
 * LA BOCA DE AURA COMO SEÑAL: 0..1 de apertura y un visema, 20 veces por segundo, para cualquier
 * cuerpo que la dibuje (la figurita 2D, el modelo 3D, lo que venga).
 *
 * De dónde sale hoy la voz de AURA:
 *  · la voz de la MESA (lib/tts.ts): los tiempos por letra que manda el servidor, sobre la posición
 *    real del audio (`formaReproducida`), o una envolvente sincronizada con él (lipsync.ts);
 *  · la CONVERSACIÓN fluida (components/ModoConversacion.tsx): el volumen real que da el SDK de
 *    ElevenLabs cada 50 ms, que entra a tts por `nivelExterno`.
 * Las dos terminan en `tts.escucharNivelVoz`; el VozProvider conecta ese nivel aquí (`nivel`). La
 * conversación, además, puede dar el ESPECTRO (solo si algún cuerpo pidió la forma de la boca:
 * `quiereForma`, porque medirlo tiene costo) y la ALINEACIÓN por letra si ElevenLabs la manda.
 *
 * Sin React Native: se prueba en Node.
 */
import { canal } from '../compa/canales';
import { BOCA_CERRADA, type Boca, type Visema } from './tipos';
import { componerBoca, LineaVisemas, type Alineacion } from './visemas';

/** Un espectro más viejo que esto ya no describe lo que suena. */
const ESPECTRO_VIGENTE_MS = 200;

export class SenalVoz {
  /** La boca de ahora; quien la dibuja escucha aquí (sin pasar por React). */
  readonly boca = canal<Boca>(BOCA_CERRADA);
  private linea: LineaVisemas;
  private espectroUltimo: { bandas: number[]; en: number } | null = null;
  private interesados = 0;
  private ultimoNivel = 0;
  /** El visema que dicta el audio de la mesa en este instante (sus tiempos por letra), o null. */
  private formaFija: Visema | null = null;

  constructor(
    private reloj: () => number = Date.now,
    demoraMs = 120
  ) {
    this.linea = new LineaVisemas(demoraMs);
  }

  /** El volumen de la voz (0..1): cada vez que llega, sale una boca nueva si cambió. */
  nivel(n: number) {
    this.ultimoNivel = n;
    this.publicar();
  }

  /** Las bandas de la voz del agente (se copian: el SDK reusa su arreglo). */
  espectro(bandas: ArrayLike<number>) {
    this.espectroUltimo = { bandas: Array.from(bandas), en: this.reloj() };
  }

  /**
   * El visema del audio de la mesa que suena ahora (lib/tts.ts lo saca de los tiempos por letra y de
   * la posición real del audio). Manda sobre todo lo demás; null lo suelta. El nivel que viene
   * después publica la boca.
   */
  formaReproducida(v: Visema | null) {
    this.formaFija = v;
  }

  /** La alineación por letra de un pedazo de audio de ElevenLabs. */
  alineacion(al: Alineacion) {
    this.linea.agregar(al, this.reloj());
  }

  /** Le hablaron encima o se cerró la conversación: la boca se cierra y se olvida lo que faltaba. */
  cortar() {
    this.linea.cortar();
    this.espectroUltimo = null;
    this.ultimoNivel = 0;
    this.formaFija = null;
    this.boca.emitir(BOCA_CERRADA);
  }

  /** ¿Algún cuerpo quiere la forma de la boca (visemas)? Si no, no se mide el espectro. */
  quiereForma(): boolean {
    return this.interesados > 0;
  }

  /** Un cuerpo que dibuja visemas se anota; devuelve cómo desanotarse. */
  pedirForma(): () => void {
    this.interesados++;
    let hecho = false;
    return () => {
      if (hecho) return;
      hecho = true;
      this.interesados = Math.max(0, this.interesados - 1);
    };
  }

  private publicar() {
    const t = this.reloj();
    const e = this.espectroUltimo && t - this.espectroUltimo.en <= ESPECTRO_VIGENTE_MS ? this.espectroUltimo.bandas : null;
    const b = componerBoca(this.ultimoNivel, { alineado: this.formaFija ?? this.linea.en(t), espectro: e });
    const u = this.boca.ultimo();
    if (u.nivel === b.nivel && u.visema === b.visema && u.peso === b.peso) return;
    this.boca.emitir(b);
  }
}

/** Una sola para toda la app. */
export const senalVoz = new SenalVoz();
