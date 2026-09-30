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
 * Y lo que vio en 5.1:
 *  · «lo hice pequeño en chat y me dejó de escuchar»: con la mesa tapada el dueño era «nadie» y nadie
 *    abría otro oído; la compañera se veía pero era sorda. Ahora, con la app delante y la compañera a
 *    la vista, el dueño es la COMPAÑERA: el mismo oído de la mesa sigue abierto (sin cerrarlo ni
 *    reabrirlo al cambiar de pantalla), el mismo cerebro contesta y la compañera lo dice con esa voz y
 *    su globito. Dos voces siguen sin poder ser: la conversación en vivo y la llamada mandan sobre ella.
 *  · «regresé en grande y no me volvió a escuchar»: al recuperar el audio se hacía `unmute` del
 *    reconocedor que quedó de antes; si se había colgado mientras otro tenía el micrófono, seguía
 *    colgado. Ahora se reabre uno NUEVO (`reabrirMic`), y el vigilante (abajo) reinicia al que no da
 *    señales de vida.
 *
 * Aquí se decide el dueño (puro) y `OidoMesa` aplica los cambios en la mesa, siempre igual: al perder
 * el audio corta el turno, calla la voz, SUELTA LA PAUSA y cierra el micrófono; al recuperarlo abre un
 * reconocedor nuevo si la persona lo quería abierto.
 *
 * Sin React Native: se prueba en Node.
 */

export type DuenoAudio = 'llamada' | 'conversacion' | 'mesa' | 'companera' | 'nadie';

/** ¿El oído del teléfono (el reconocedor de la mesa) es el que escucha con este dueño? */
export function oidoPropio(d: DuenoAudio | null): boolean {
  return d === 'mesa' || d === 'companera';
}

export type SituacionAudio = {
  /** Hay una llamada (sonando, conectando o hablando). */
  enLlamada: boolean;
  /** La conversación en vivo tiene el micrófono (montada, o dormida por un silencio largo). */
  conversacion: boolean;
  /** La mesa es la pantalla que se ve (no tapada por los chats, Ajustes o el perfil). */
  mesaVisible: boolean;
  /** La app está delante. */
  appActiva: boolean;
  /** La compañera se ve (en los chats, Ajustes o el perfil: chiquita, al lado o a pantalla completa). */
  companeraVisible?: boolean;
};

/**
 * La llamada manda sobre todo; después la conversación; con la app delante, la mesa si se la ve y, si
 * no, la compañera (si se la ve). Con la app detrás, nadie.
 */
export function duenoAudio(s: SituacionAudio): DuenoAudio {
  if (s.enLlamada) return 'llamada';
  if (s.conversacion) return 'conversacion';
  if (!s.appActiva) return 'nadie';
  if (s.mesaVisible) return 'mesa';
  if (s.companeraVisible) return 'companera';
  return 'nadie';
}

export type DepsOidoMesa = {
  muteMic: () => Promise<void> | void;
  unmuteMic: () => Promise<void> | void;
  /** Un reconocedor NUEVO que quiere oír, sin la pausa (speech.reabrirMic). Si falta, `unmuteMic`. */
  reabrirMic?: () => Promise<void> | void;
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

  /** ¿El oído del teléfono es el que escucha? (en la mesa o, con la mesa tapada, en la compañera). */
  oye(): boolean {
    return this.dueno === null || oidoPropio(this.dueno);
  }

  /**
   * ¿La mesa puede hablar ahora? (una frase suya, un saludo, un «mmm»). También con la mesa tapada si
   * el audio es de la compañera: es la misma voz y la compañera la dice (su boca sigue esa voz).
   */
  puedeHablar(): boolean {
    return this.oye();
  }

  /**
   * Aplica el dueño nuevo. Devuelve lo que hizo (para la miga y las pruebas). Entre la mesa y la
   * compañera no se toca nada: es el mismo oído y el turno en curso sigue (se contesta en chiquito).
   */
  aplicar(nuevo: DuenoAudio): 'suelta' | 'toma' | 'nada' {
    const antes = this.dueno;
    this.dueno = nuevo;
    if (antes === nuevo) return 'nada';
    const ahoraOye = oidoPropio(nuevo);
    const antesOia = antes === null || oidoPropio(antes);
    if (ahoraOye && antesOia) {
      this.d.miga?.(`oído de la mesa: sigue (${antes ?? 'arranque'} → ${nuevo})`);
      return 'nada';
    }
    if (!ahoraOye) {
      // Primero se calla y se corta; la pausa se suelta SIEMPRE (una voz cortada no llama a su onEnd).
      this.d.cancelarTurno();
      void this.d.stopSpeaking();
      this.d.pauseMicForTts(false);
      void this.d.muteMic();
      this.d.miga?.(`oído de la mesa: lo suelta (${nuevo})`);
      return 'suelta';
    }
    this.d.pauseMicForTts(false);
    // Un reconocedor NUEVO: el de antes pudo quedar colgado mientras el micrófono era de otro.
    if (this.d.micQuerido()) void (this.d.reabrirMic ?? this.d.unmuteMic)();
    this.d.miga?.(`oído de la mesa: lo toma (${nuevo})${this.d.micQuerido() ? '' : ' (silenciado por la persona)'}`);
    return 'toma';
  }

  /**
   * La voz de la mesa se cortó por otra razón («cállate», otra frase encima): su `onEnd` no llega, así
   * que la pausa se suelta aquí. Sin esto el micrófono queda pausado para siempre.
   */
  vozCortada() {
    if (this.oye()) this.d.pauseMicForTts(false);
  }
}

/* ── el vigilante del oído ─────────────────────────────────────────────────────────────────── */

/** Reinicios seguidos sin que el reconocedor dé señales de vida antes de pasar a la nube. */
export const TOPE_REINICIOS_OIDO = 3;

export type DepsVigilante = {
  /** ¿El oído es nuestro ahora? (dueño mesa o compañera). */
  esNuestro: () => boolean;
  /** La persona lo silenció. */
  silenciado: () => boolean;
  /** Suena la voz de AURA (la pausa es legítima). */
  hablando: () => boolean;
  /** Esperando al cerebro. */
  pensando: () => boolean;
  /** El micrófono está pausado «por la voz». */
  pausado: () => boolean;
  soltarPausa: () => void;
  /** ¿Todavía no se lo da por muerto? (señales de vida o el plazo de gracia de un arranque; speech.micWatchdogOk). */
  vivo: () => boolean;
  /**
   * ¿Dio señales de vida DE VERDAD? (sin el plazo de gracia; speech.oidoVivoDeVerdad). Solo así se da
   * por revivido: si no, cada reinicio regalaba otro plazo y nunca se llegaba al tope. Si falta, `vivo`.
   */
  revivio?: () => boolean;
  /** Reinicio duro (un reconocedor nuevo). */
  reiniciar: () => Promise<void> | void;
  /** Reiniciarlo no sirvió: el oído sigue por la nube. false si ya estaba ahí. */
  caerANube: (motivo: string) => Promise<boolean> | boolean;
  miga?: (texto: string) => void;
};

export type Revision = 'nada' | 'pausa-suelta' | 'reinicia' | 'nube' | 'sordo';

/**
 * Cada pocos segundos, con la app delante y el oído nuestro (en la mesa O en la compañera: antes solo
 * con la mesa a la vista, y el oído de la compañera nadie lo cuidaba):
 *  · una pausa «por la voz» sin voz dos vueltas seguidas → se suelta (una voz cortada no avisó);
 *  · el reconocedor sin señales de vida → reinicio duro; tras TOPE_REINICIOS_OIDO seguidos sin que
 *    reviva → la nube; y si tampoco, queda «sordo» (la etiqueta lo dice, nunca «te escucho»).
 * Puro: el componente le pasa cómo preguntar y cómo actuar.
 */
export class VigilanteOido {
  private pausadoSinVoz = 0;
  private reinicios = 0;
  private sordo = false;

  constructor(private d: DepsVigilante) {}

  /** ¿Se rindió? (reinició, cayó a la nube y sigue sin vida). */
  estaSordo(): boolean {
    return this.sordo;
  }

  revisar(): Revision {
    const d = this.d;
    if (!d.esNuestro() || d.silenciado() || d.hablando()) {
      this.pausadoSinVoz = 0;
      return 'nada';
    }
    if (d.pausado()) {
      if (d.pensando()) return 'nada';
      if (++this.pausadoSinVoz >= 2) {
        d.miga?.('oído: pausa colgada sin voz, se suelta');
        d.soltarPausa();
        this.pausadoSinVoz = 0;
        return 'pausa-suelta';
      }
      return 'nada';
    }
    this.pausadoSinVoz = 0;
    if (d.vivo()) {
      // En el plazo de gracia de un arranque se espera; el contador solo vuelve a cero con vida de verdad.
      if ((d.revivio ?? d.vivo)()) {
        if (this.reinicios || this.sordo) d.miga?.('oído: volvió a dar señales de vida');
        this.reinicios = 0;
        this.sordo = false;
      }
      return 'nada';
    }
    if (this.sordo) return 'sordo';
    if (this.reinicios >= TOPE_REINICIOS_OIDO) {
      this.reinicios = 0;
      d.miga?.('oído: sin vida tras reiniciarlo; pasa a la nube');
      void Promise.resolve(d.caerANube('el reconocedor del teléfono no revive')).then((cayo) => {
        if (!cayo) {
          this.sordo = true;
          d.miga?.('oído: ni reiniciándolo ni en la nube; sordo (la etiqueta lo dice)');
        }
      });
      return 'nube';
    }
    this.reinicios += 1;
    d.miga?.(`oído: sin señales de vida, reinicio ${this.reinicios}/${TOPE_REINICIOS_OIDO}`);
    void d.reiniciar();
    return 'reinicia';
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
  if (/no lleg[oó] audio/.test(d)) return t('no me llegaba tu voz por la conversación en vivo', 'your voice wasn’t reaching the live conversation');
  if (/no conect[oó] a tiempo/.test(d)) return t('tardó demasiado en conectar', 'it took too long to connect');
  if (/permis|permission|micr[oó]fono|microphone|not-allowed/.test(d)) return t('no tengo permiso del micrófono', 'I don’t have microphone permission');
  if (/abort|timeout|network|red\b|conexi[oó]n|failed to fetch|fetch failed|webrtc|ice/.test(d)) return t('no hay buena conexión', 'the connection is poor');
  return t('no pude conectar', 'I couldn’t connect');
}
