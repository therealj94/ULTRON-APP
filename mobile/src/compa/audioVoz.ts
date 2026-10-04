/**
 * ¿La conversación con ElevenLabs tiene tomado el audio del teléfono?
 *
 * El SDK (`@elevenlabs/react-native`) arranca la sesión de audio de LiveKit al empezar y la PARA al
 * soltarla: `endSession` → desconecta → `AudioSession.stopAudioSession()` → recién ahí `onDisconnect`.
 * En Android ese `stop` anula incluso un `start` que otro dejó pendiente, así que si una llamada
 * arranca su audio mientras AURA todavía se está cerrando, el cierre de AURA le apaga el audio a la
 * llamada. La llamada tiene que esperar a que la voz quede LIBRE de verdad.
 *
 * Cada generación de la sesión (`gen`) toma el audio justo antes de `startSession` y lo suelta:
 *  · en `onDisconnect` (el SDK ya paró su sesión de audio);
 *  · si falla al abrir (el SDK ya la paró antes de avisar el error);
 *  · por las dudas, si se desmontó y a los `topeMs` no avisó nada (un cierre que se perdió).
 * Cuando ya no queda ninguna, avisa `libre: true`; al tomarla la primera, `libre: false`. El
 * VozProvider lo pasa al bus del contrato (`voz`), que es lo que escucha la llamada.
 *
 * La mesa también espera (`esperarLibre`): al colgar la llamada del avatar reabre su reconocedor, y en
 * Android el `stopAudioSession` que llega después se lo mataba (1-oct: «después de colgar el micrófono
 * de la mesa dejó de escuchar»). Reabre cuando la voz quedó libre, o al tope si nadie avisa.
 *
 * Sin React Native: se prueba en Node.
 */
type Temporizador = (f: () => void, ms: number) => () => void;
const temporizador: Temporizador = (f, ms) => {
  const t = setTimeout(f, ms);
  return () => clearTimeout(t);
};

/** Desmontada y sin noticias, se da por suelta a los 4 s (la llamada espera como mucho 2,5 s igual). */
export const TOPE_CIERRE_MS = 4_000;

export class AudioVoz {
  private tomadas = new Set<number>();
  private topes = new Map<number, () => void>();
  private esperan = new Set<() => void>();

  constructor(
    private avisar: (libre: boolean) => void,
    private esperar: Temporizador = temporizador,
    private topeMs = TOPE_CIERRE_MS
  ) {}

  libre(): boolean {
    return this.tomadas.size === 0;
  }

  /** La generación `gen` va a abrir la sesión (y con ella, el audio). */
  tomar(gen: number) {
    if (this.tomadas.has(gen)) return;
    const estabaLibre = this.libre();
    this.tomadas.add(gen);
    if (estabaLibre) this.avisar(false);
  }

  /** La generación `gen` ya soltó el audio (se desconectó o no llegó a abrir). */
  soltar(gen: number) {
    this.topes.get(gen)?.();
    this.topes.delete(gen);
    if (!this.tomadas.delete(gen)) return;
    if (!this.libre()) return;
    this.avisar(true);
    for (const f of [...this.esperan]) f();
  }

  /** Resuelve cuando el audio quede libre (ya, si lo está), o a los `topeMs` aunque nadie avise. */
  esperarLibre(topeMs = this.topeMs): Promise<void> {
    if (this.libre()) return Promise.resolve();
    return new Promise<void>((listo) => {
      let cancelar: () => void = () => {};
      const fin = () => {
        if (!this.esperan.delete(fin)) return;
        cancelar();
        listo();
      };
      this.esperan.add(fin);
      cancelar = this.esperar(fin, topeMs);
    });
  }

  /** Se pidió cerrar `gen` (se desmontó): si no avisa en `topeMs`, se suelta igual. */
  cerrando(gen: number) {
    if (!this.tomadas.has(gen) || this.topes.has(gen)) return;
    this.topes.set(
      gen,
      this.esperar(() => {
        this.topes.delete(gen);
        this.soltar(gen);
      }, this.topeMs)
    );
  }
}
