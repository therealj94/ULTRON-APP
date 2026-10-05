/**
 * ¿SUENA LA VOZ DE LA MESA AHORA? La única fuente de verdad para que el cuerpo mueva la boca.
 *
 * José, 5-oct (Samsung, Claudio en video): «cuando le pregunto, el animado habla cuando no está
 * diciendo nada». El cuerpo hablaba por la CARA que pedía la mesa (SPEAKING), y esa cara llega antes que
 * la voz: con la emoción del turno (neutral → SPEAKING) mientras el cerebro todavía escribe, y en `say`
 * antes de pedir el audio al servidor (segundos con la red del campo). Ahora habla solo mientras un audio
 * suena de verdad: lib/tts avisa aquí desde que el reproductor dice «sonando» hasta que termina, se
 * pausa, se corta (stopSpeaking) o falla.
 *
 * `preparando`: se pidió decir algo y su primer audio todavía no suena (la voz se está bajando). El cuerpo
 * piensa en vez de quedarse en reposo entre «pensando» y «hablando».
 *
 * Sin React Native: lo prueban en Node (pruebas/avatar3d.prueba.mjs).
 */
import { canal } from '../compa/canales';

export type EstadoVozMesa = { sonando: boolean; preparando: boolean };

const CALLADA: EstadoVozMesa = { sonando: false, preparando: false };

export class VozSonando {
  /** Los audios que suenan ahora (uno, salvo el instante en que uno termina y empieza el siguiente). */
  private suenan = new Set<object>();
  /** Las locuciones que pidieron audio y todavía no suena el primero. */
  private preparan = new Set<object>();
  private cambios = canal<EstadoVozMesa>(CALLADA);

  /** Un audio avisa si suena (true) o no (pausado, cargando, terminado, cortado o con error). */
  sonar(audio: object, suena: boolean) {
    if (suena) this.suenan.add(audio);
    else this.suenan.delete(audio);
    this.publicar();
  }

  /** Una locución pidió su audio (true) o ya no espera (empezó a sonar, terminó, se cortó). */
  preparar(locucion: object, si: boolean) {
    if (si) this.preparan.add(locucion);
    else this.preparan.delete(locucion);
    this.publicar();
  }

  /** stopSpeaking: todo calla de golpe (sin esperar a que el reproductor avise). */
  callar() {
    this.suenan.clear();
    this.preparan.clear();
    this.publicar();
  }

  /** La foto de ahora: el mismo objeto mientras no cambie (sirve tal cual a useSyncExternalStore). */
  ahora = (): EstadoVozMesa => this.cambios.ultimo();

  /** Avisa solo cuando cambia algo. Devuelve cómo desanotarse. */
  escuchar = (f: (e: EstadoVozMesa) => void): (() => void) => this.cambios.escuchar(f);

  private publicar() {
    const antes = this.cambios.ultimo();
    const sonando = this.suenan.size > 0;
    const preparando = this.preparan.size > 0;
    if (antes.sonando === sonando && antes.preparando === preparando) return;
    this.cambios.emitir({ sonando, preparando });
  }
}

/** La voz de la mesa (lib/tts): una sola en la app. */
export const vozSonando = new VozSonando();
