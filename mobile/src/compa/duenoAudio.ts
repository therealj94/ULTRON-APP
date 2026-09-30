/**
 * UN SOLO DUEÑO DEL AUDIO: quién tiene el micrófono y la voz en cada momento.
 *
 * En la app hay tres cosas que quieren oír y hablar: la llamada (PULSE2CHAT), la conversación en
 * vivo con ElevenLabs (VozProvider) y la mesa (su oído de siempre + su voz por /api/tts). Antes cada
 * una se cuidaba sola y así fallaba (lo vio José en 4.7.0):
 *
 *  · «me dejó de escuchar»: la mesa calla su voz con `stopSpeaking()` al empezar la conversación o una
 *    llamada. Esa voz había pausado el micrófono (`pauseMicForTts(true)`) y, cortada a la mitad, nunca
 *    llamaba a su `onEnd`: la pausa quedaba puesta. Al fallar la conversación (o colgar) el micrófono
 *    se «abría» pausado —el reconocedor ni arranca con la pausa puesta y el perro guardián la da por
 *    buena— y la mesa quedaba sorda hasta la siguiente frase suya;
 *  · «se quedaron ambos hablando»: la mesa sigue montada debajo de los chats (la pila nativa no la
 *    desmonta). Con la conversación caída, su oído volvía a abrirse detrás de los chats, oía a la
 *    persona hablándole a la compañera y contestaba por su lado; y si la conversación se abría desde
 *    la compañera, el turno que la mesa tenía en curso seguía hablando encima.
 *
 * Aquí se decide el dueño (puro) y `OidoMesa` aplica los cambios en la mesa, siempre igual: al perder
 * el audio corta el turno, calla la voz, SUELTA LA PAUSA y cierra el micrófono; al recuperarlo suelta
 * la pausa y abre el micrófono si la persona lo quería abierto.
 *
 * Sin React Native: se prueba en Node.
 */

export type DuenoAudio = 'llamada' | 'conversacion' | 'mesa' | 'nadie';

export type SituacionAudio = {
  /** Hay una llamada (sonando, conectando o hablando). */
  enLlamada: boolean;
  /** La conversación en vivo tiene el micrófono (montada, o dormida por un silencio largo). */
  conversacion: boolean;
  /** La mesa es la pantalla que se ve (no tapada por los chats, Ajustes o el perfil). */
  mesaVisible: boolean;
  /** La app está delante. */
  appActiva: boolean;
};

/** La llamada manda sobre todo; después la conversación; la mesa solo si se la ve. */
export function duenoAudio(s: SituacionAudio): DuenoAudio {
  if (s.enLlamada) return 'llamada';
  if (s.conversacion) return 'conversacion';
  if (s.mesaVisible && s.appActiva) return 'mesa';
  return 'nadie';
}

export type DepsOidoMesa = {
  muteMic: () => Promise<void> | void;
  unmuteMic: () => Promise<void> | void;
  pauseMicForTts: (pausa: boolean) => void;
  stopSpeaking: () => Promise<void> | void;
  /** Corta el turno que la mesa tenga pensando o hablando (el stream del cerebro, lo encolado). */
  cancelarTurno: () => void;
  /** ¿La persona quiere el micrófono de la mesa abierto? (no lo silenció ella). */
  micQuerido: () => boolean;
  miga?: (texto: string) => void;
};

export class OidoMesa {
  private dueno: DuenoAudio | null = null;

  constructor(private d: DepsOidoMesa) {}

  actual(): DuenoAudio | null {
    return this.dueno;
  }

  /**
   * Anota el dueño SIN tocar nada: al montarse la mesa, que todavía no abrió su oído (lo abre ella
   * al tener el permiso). Abrir el micrófono antes del permiso hacía caer al reconocedor a la nube.
   */
  fijar(dueno: DuenoAudio) {
    this.dueno = dueno;
  }

  /** ¿La mesa puede hablar ahora? (una frase suya, un saludo, un «mmm»). */
  puedeHablar(): boolean {
    return this.dueno === 'mesa' || this.dueno === null;
  }

  /** Aplica el dueño nuevo. Devuelve lo que hizo (para la miga y las pruebas). */
  aplicar(nuevo: DuenoAudio): 'suelta' | 'toma' | 'nada' {
    const antes = this.dueno;
    this.dueno = nuevo;
    if (antes === nuevo) return 'nada';
    if (nuevo !== 'mesa') {
      // Primero se calla y se corta; la pausa se suelta SIEMPRE (una voz cortada no llama a su onEnd).
      this.d.cancelarTurno();
      void this.d.stopSpeaking();
      this.d.pauseMicForTts(false);
      void this.d.muteMic();
      this.d.miga?.(`oído de la mesa: lo suelta (${nuevo})`);
      return 'suelta';
    }
    this.d.pauseMicForTts(false);
    if (this.d.micQuerido()) void this.d.unmuteMic();
    this.d.miga?.(`oído de la mesa: lo toma${this.d.micQuerido() ? '' : ' (silenciado por la persona)'}`);
    return 'toma';
  }

  /**
   * La voz de la mesa se cortó por otra razón («cállate», otra frase encima): su `onEnd` no llega, así
   * que la pausa se suelta aquí. Sin esto el micrófono queda pausado para siempre.
   */
  vozCortada() {
    if (this.dueno === 'mesa' || this.dueno === null) this.d.pauseMicForTts(false);
  }
}

/**
 * Por qué no abrió la conversación en vivo, dicho para la persona (el detalle técnico va a la miga).
 * `detalle` es lo que dejó el error: el mensaje del servidor, «HTTP 404», el del SDK…
 */
export function motivoFalloVoz(detalle?: string, en = false): string {
  const d = String(detalle || '').toLowerCase();
  const t = (es: string, ing: string) => (en ? ing : es);
  if (/\b401\b|sesi[oó]n|entra de nuevo|sign in/.test(d)) return t('tu sesión venció; entra de nuevo', 'your session expired; sign in again');
  if (/\b404\b|not found|cannot post/.test(d)) return t('el servidor todavía no tiene la conversación en vivo (se estaba actualizando)', 'the server doesn’t have live conversation yet (it was updating)');
  if (/\b429\b|demasiad|too many|tope|cupo/.test(d)) return t('se acabaron los minutos de voz por ahora; prueba en un rato', 'voice minutes are used up for now; try again later');
  if (/\b503\b|no est[aá] (disponible|lista)|unavailable/.test(d)) return t('la conversación en vivo no está disponible ahora', 'live conversation isn’t available right now');
  if (/\b502\b|no pude abrir/.test(d)) return t('el servicio de voz no respondió; intenta en un momento', 'the voice service didn’t answer; try again in a moment');
  if (/permis|permission|micr[oó]fono|microphone|not-allowed/.test(d)) return t('no tengo permiso del micrófono', 'I don’t have microphone permission');
  if (/abort|timeout|network|red\b|conexi[oó]n|failed to fetch|fetch failed|webrtc|ice/.test(d)) return t('no hay buena conexión', 'the connection is poor');
  return t('no pude conectar', 'I couldn’t connect');
}
