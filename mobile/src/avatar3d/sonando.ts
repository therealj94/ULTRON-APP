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
 * `preparando`: se pidió decir algo y su primer audio todavía no suena (la voz se está bajando), o la
 * locución ya habló y espera su frase siguiente más de PAUSA_HABLA_MS. El cuerpo piensa en vez de quedarse
 * en reposo entre «pensando» y «hablando».
 *
 * `hablando` (José, 7-oct, SM-S942B con 5.6.0: «empieza a mover la boca antes de que salga la voz»): LA CARA
 * habla con esto, no con la cara que pide la mesa. Es la locución (un `speak`, un locutor por frases, una
 * canción) cuyo primer audio el reproductor YA confirmó sonando y que todavía no terminó ni la cortaron. Entre
 * frase y frase de la misma locución sigue hablando (un respiro con la boca cerrada, sin parpadear a «piensa»),
 * pero si la frase siguiente tarda más de PAUSA_HABLA_MS vuelve a «preparando». Al terminar o al callarla
 * (stopSpeaking), false en el acto.
 *
 * Sin React Native: lo prueban en Node (pruebas/avatar3d.prueba.mjs y pruebas/oido/boca.cjs).
 */
import { canal } from '../compa/canales';

export type EstadoVozMesa = { sonando: boolean; preparando: boolean; hablando: boolean };

const CALLADA: EstadoVozMesa = { sonando: false, preparando: false, hablando: false };

/**
 * Un hueco entre frases de la misma locución más corto que esto sigue siendo «hablando» (boca cerrada): por
 * expo-av, entre que una termina y la siguiente (ya precargada) suena pasan ~100-300 ms; por el nativo, 0.
 */
export const PAUSA_HABLA_MS = 700;

/** Las caras que dicen «está hablando» y que sin voz que suene no se muestran (la mesa piensa mientras tanto). */
const CARAS_DE_HABLAR: ReadonlySet<string> = new Set(['SPEAKING', 'SING', 'PRAY']);

/**
 * La cara que se ve: una cara de hablar (SPEAKING, SING, PRAY) solo mientras la voz suena de verdad (`habla`);
 * antes de que suene (bajando, preparando la canción o la oración) se ve pensando. Las demás caras (contenta,
 * preocupada, la risa de unas cosquillas) no cambian: su boca la mueve solo el nivel real de la voz.
 */
export function caraConVoz<F extends string>(face: F, habla: boolean): F | 'THINKING' {
  return !habla && CARAS_DE_HABLAR.has(face) ? 'THINKING' : face;
}

/**
 * Lo que la compañera refleja de la mesa (compa/canales.ts ecoMesa): la mesa avisa «hablando» desde que decide
 * hablar (su turno ocupa el micrófono), pero la compañera mueve la boca solo cuando su voz SUENA; mientras la
 * voz se prepara, piensa.
 */
export function ecoVisible(eco: { hablando: boolean; pensando: boolean }, voz: EstadoVozMesa): { hablando: boolean; pensando: boolean } {
  const hablando = eco.hablando && voz.hablando;
  return { hablando, pensando: eco.pensando || (eco.hablando && !hablando) };
}

export class VozSonando {
  /** Los audios que suenan ahora (uno, salvo el instante en que uno termina y empieza el siguiente). */
  private suenan = new Set<object>();
  /** Las locuciones que pidieron audio y todavía no suena el primero. */
  private preparan = new Set<object>();
  /** Las locuciones cuyo primer audio ya sonó (confirmado por el reproductor) y que no terminaron. */
  private hablan = new Set<object>();
  /** Cuándo dejó de sonar el último audio (para el hueco corto entre frases). */
  private callaDesde = 0;
  private relojPausa: ReturnType<typeof setTimeout> | null = null;
  private cambios = canal<EstadoVozMesa>(CALLADA);

  constructor(private reloj: () => number = () => Date.now()) {}

  /**
   * Un audio avisa si suena (true) o no (pausado, cargando, terminado, cortado o con error). Con `locucion`, el
   * primer «suena» de esa locución la pasa de preparando a hablando.
   */
  sonar(audio: object, suena: boolean, locucion?: object) {
    const antes = this.suenan.size > 0;
    if (suena) this.suenan.add(audio);
    else this.suenan.delete(audio);
    if (suena && locucion) {
      this.preparan.delete(locucion);
      this.hablan.add(locucion);
    }
    if (antes && this.suenan.size === 0) this.callaDesde = this.reloj();
    this.publicar();
  }

  /** Una locución pidió su audio (true) o ya no espera (terminó, se cortó). */
  preparar(locucion: object, si: boolean) {
    if (si) {
      // Una que ya habló no vuelve a «preparando» por pedir su frase siguiente: eso lo decide el hueco.
      if (!this.hablan.has(locucion)) this.preparan.add(locucion);
    } else this.preparan.delete(locucion);
    this.publicar();
  }

  /** La locución terminó (dijo todo, la cancelaron o falló): ni prepara ni habla, en el acto. */
  terminar(locucion: object) {
    this.preparan.delete(locucion);
    this.hablan.delete(locucion);
    this.publicar();
  }

  /** stopSpeaking: todo calla de golpe (sin esperar a que el reproductor avise). */
  callar() {
    this.suenan.clear();
    this.preparan.clear();
    this.hablan.clear();
    this.publicar();
  }

  /** La foto de ahora: el mismo objeto mientras no cambie (sirve tal cual a useSyncExternalStore). */
  ahora = (): EstadoVozMesa => this.cambios.ultimo();

  /** Avisa solo cuando cambia algo. Devuelve cómo desanotarse. */
  escuchar = (f: (e: EstadoVozMesa) => void): (() => void) => this.cambios.escuchar(f);

  private publicar() {
    if (this.relojPausa) {
      clearTimeout(this.relojPausa);
      this.relojPausa = null;
    }
    const antes = this.cambios.ultimo();
    const sonando = this.suenan.size > 0;
    let hablando = sonando;
    let enHueco = false;
    if (this.hablan.size > 0 && !sonando) {
      const falta = PAUSA_HABLA_MS - (this.reloj() - this.callaDesde);
      if (falta > 0) {
        hablando = true;
        // Pasado el hueco sin otra frase sonando, deja de hablar (vuelve a «preparando»).
        enHueco = true;
        this.relojPausa = setTimeout(() => {
          this.relojPausa = null;
          this.publicar();
        }, falta);
      }
    }
    const preparando = this.preparan.size > 0 || (this.hablan.size > 0 && !sonando && !enHueco);
    if (antes.sonando === sonando && antes.preparando === preparando && antes.hablando === hablando) return;
    this.cambios.emitir({ sonando, preparando, hablando });
  }
}

/** La voz de la mesa (lib/tts): una sola en la app. */
export const vozSonando = new VozSonando();
