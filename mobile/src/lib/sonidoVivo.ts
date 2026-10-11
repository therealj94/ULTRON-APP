/**
 * Una frase por el reproductor en streaming (modules/aura-voz), con la MISMA cara que un sonido de expo-av:
 * `setOnPlaybackStatusUpdate`, `playAsync`, `stopAsync`, `unloadAsync`. Así lib/tts.ts la suena con el mismo
 * playPrepared (registroVoz, la boca, «suena» de la traza, cancelar, la generación) sin un camino aparte que se
 * desincronice. docs/adr/ADR-voz-en-streaming.md.
 *
 *  · Se encola en el nativo AL PREPARARLA, con `esperar`: empieza a bajar ya, pero no suena hasta `playAsync` (la mesa
 *    la prepara mientras suena otra cosa, como hace con expo-av).
 *  · `encadenar()`: puede sonar en cuanto termine la de delante, sin hueco. La mesa la llama cuando la de delante YA
 *    suena por el nativo; cualquier cosa que la invalide después (cancelar, reemplazar, otra locución) la cancela.
 *  · Los avisos del nativo se vuelven estados como los de expo-av: «sonando» → isPlaying (el comienzo REAL: la pista
 *    avanzó), «posicion» → positionMillis por los cuadros que sonaron, «termino» → didJustFinish.
 *  · Si falla ANTES de sonar (nada llegó a la pista), la frase NO se pierde: se pide por el camino de siempre
 *    (`respaldo`, /api/tts + expo-av) y suena eso, con los mismos avisos. Quien la creó decide si eso apaga el camino
 *    nuevo en la sesión (`alFallar`, lib/vozNativa.ts falloDeSesion).
 *  · Sin foco de audio (el nativo avisa «error» `foco`: lo negó o lo quitó antes de sonar) NO hay respaldo: expo-av
 *    tampoco tiene foco y sonaría encima de una llamada. La frase termina con `{ isLoaded: false, error: 'foco' }`
 *    (playPrepared la da por terminada: la boca se cierra y queda el texto) y se avisa `alSinFoco`, no `alFallar`
 *    (no es un fallo del camino nuevo: no cuenta para apagarlo).
 *
 * Puro: el módulo nativo se inyecta (las pruebas usan uno simulado).
 */
import { VOZ_VIVO, eventoVozValido, nivelDeRms, type CodigoFallo, type EventoVoz } from './vozNativa';
import type { ModuloVoz } from './auraVoz';

import type { EstadoSonido, Reproducible } from './sonidoTipos';
export type { EstadoSonido, Reproducible } from './sonidoTipos';

export type FalloVoz = { codigo: CodigoFallo; status?: number; motivo: string };

type OpcionesSonido = {
  /** La frase por el camino de siempre (bajada entera, expo-av), si el nativo falla antes de sonar. */
  respaldo: () => Promise<Reproducible | null>;
  /** Falló antes de sonar (ya se está pidiendo el respaldo). */
  alFallar: (f: FalloVoz) => void;
  /** Juntó el prebúfer: lo que la traza llama «audio» (onAudioBajado). */
  alListo?: () => void;
  /** Sonó por el nativo (los fallos seguidos vuelven a cero). */
  alSonar?: () => void;
  /** El sistema no dio (o quitó) el foco de audio antes de que sonara: va por texto, sin respaldo. */
  alSinFoco?: (f: FalloVoz) => void;
};

export class SonidoVivo implements Reproducible {
  private cb: ((st: EstadoSonido) => void) | null = null;
  private pedido = false;
  private soltado = false;
  private suena = false;
  private listo = false;
  private ultimo: EstadoSonido | null = null;
  private final: EstadoSonido | null = null;
  private durMs = 0;
  private rms = -1;
  private muerto = false;
  private respaldo: Promise<Reproducible | null> | null = null;
  private deRespaldo: Reproducible | null = null;
  private alSonarNativo: Array<() => void> = [];

  constructor(
    readonly id: string,
    private readonly modulo: ModuloVoz,
    private readonly o: OpcionesSonido,
    private readonly olvidar: () => void
  ) {}

  /** ¿Va por el camino de siempre (el nativo falló antes de sonar)? */
  get enRespaldo() {
    return !!this.respaldo;
  }

  /** ¿Ya suena (o sonó) por el nativo? */
  get sonando() {
    return this.suena;
  }

  /** La apertura de la boca (0..1) por el volumen REAL que suena ahora; null si no hay (todavía, o va por expo-av). */
  nivelBoca(): number | null {
    if (this.respaldo || !this.suena || this.final || this.rms < 0) return null;
    return nivelDeRms(this.rms);
  }

  /** `f` corre cuando suene por el nativo (o ya, si suena). No corre si falla y va por el respaldo. */
  cuandoSuene(f: () => void) {
    if (this.suena) f();
    else if (!this.respaldo && !this.muerto) this.alSonarNativo.push(f);
  }

  /** Puede sonar en cuanto termine lo de delante (sin hueco). Va por el respaldo o ya la soltaron: nada. */
  encadenar() {
    if (this.muerto || this.respaldo || this.soltado || this.final) return;
    this.soltado = true;
    try {
      this.modulo.soltar(this.id);
    } catch (e) {
      this.falla({ codigo: 'puente', motivo: String((e as Error)?.message || e) });
    }
  }

  setOnPlaybackStatusUpdate(cb: ((st: EstadoSonido) => void) | null) {
    this.cb = cb;
  }

  async playAsync() {
    if (this.muerto || this.pedido) return;
    this.pedido = true;
    if (this.respaldo) return this.tocarRespaldo();
    this.encadenar();
    if (this.respaldo) return;
    // Pudo empezar antes (encadenada detrás de otra): se cuenta lo que ya pasó.
    if (this.ultimo) this.dar(this.ultimo);
    if (this.final) this.dar(this.final);
  }

  async stopAsync() {
    this.morir();
  }

  async unloadAsync() {
    this.morir();
    const s = this.deRespaldo;
    this.deRespaldo = null;
    if (s) await s.unloadAsync().catch(() => {});
    else if (this.respaldo) void this.respaldo.then((x) => x?.unloadAsync().catch(() => {}));
  }

  /** Se acabó: el nativo la suelta (si sonaba, se calla ya) y nada más se avisa. `cancelarNativo`: false si ya se paró todo. */
  morir(cancelarNativo = true) {
    if (this.muerto) return;
    this.muerto = true;
    this.alSonarNativo = [];
    this.olvidar();
    if (cancelarNativo && !this.respaldo && !this.final) {
      try {
        this.modulo.cancelar(this.id);
      } catch {
        /* */
      }
    }
    void this.deRespaldo?.stopAsync().catch(() => {});
  }

  /** Un aviso del nativo, ya revisado. */
  evento(e: EventoVoz) {
    if (this.muerto || this.respaldo) return;
    switch (e.tipo) {
      case 'listo':
        if (!this.listo) {
          this.listo = true;
          try {
            this.o.alListo?.();
          } catch {
            /* */
          }
        }
        return;
      case 'bajado':
        this.durMs = e.ms;
        return;
      case 'sonando':
        if (this.suena) return;
        this.suena = true;
        try {
          this.o.alSonar?.();
        } catch {
          /* */
        }
        this.dar({ isLoaded: true, isPlaying: true, positionMillis: 0, ...this.duracion() });
        for (const f of this.alSonarNativo.splice(0)) {
          try {
            f();
          } catch {
            /* */
          }
        }
        return;
      case 'posicion':
        if (!this.suena || this.final) return;
        this.rms = e.nivel;
        this.dar({ isLoaded: true, isPlaying: true, positionMillis: e.ms, ...this.duracion() });
        return;
      case 'termino': {
        if (this.final) return;
        // Lo que de verdad sonó, por los cuadros de la pista (cortada o truncada: menos que lo bajado).
        const ms = e.ms;
        this.olvidar();
        if (!this.suena) {
          this.suena = true;
          this.dar({ isLoaded: true, isPlaying: true, positionMillis: 0 });
        }
        this.final = { isLoaded: true, isPlaying: false, positionMillis: ms, durationMillis: ms, didJustFinish: true };
        this.dar(this.final);
        return;
      }
      case 'error':
        this.olvidar();
        // Ya sonaba (no debería: el nativo avisa «termino» cortada): se da por terminada.
        if (this.suena) {
          this.final = { isLoaded: true, isPlaying: false, positionMillis: this.ultimo?.positionMillis || 0, durationMillis: this.ultimo?.positionMillis || 0, didJustFinish: true };
          this.dar(this.final);
          return;
        }
        if (e.codigo === 'foco') return this.sinFoco({ codigo: e.codigo, motivo: e.motivo });
        this.falla({ codigo: e.codigo, status: e.status, motivo: e.motivo });
        return;
    }
  }

  /** Sin foco antes de sonar: termina sin voz (ni respaldo ni nada encadenado detrás); el nativo ya la soltó. */
  private sinFoco(f: FalloVoz) {
    this.alSonarNativo = [];
    this.final = { isLoaded: false, error: 'foco' };
    try {
      this.o.alSinFoco?.(f);
    } catch {
      /* */
    }
    this.dar(this.final);
  }

  /** La duración, solo cuando ya suena y se sabe (playPrepared pone su guardia con ella). */
  private duracion(): { durationMillis?: number } {
    return this.durMs > 0 ? { durationMillis: this.durMs } : {};
  }

  private dar(st: EstadoSonido) {
    if (st !== this.final) this.ultimo = st;
    if (!this.pedido || this.muerto || this.respaldo) return;
    try {
      this.cb?.(st);
    } catch {
      /* quien escucha no rompe la voz */
    }
  }

  /** Falló antes de sonar: la frase va por el camino de siempre (si ya la pidieron, suena en cuanto llegue). */
  private falla(f: FalloVoz) {
    if (this.respaldo || this.suena) return;
    this.alSonarNativo = [];
    this.olvidar();
    try {
      this.o.alFallar(f);
    } catch {
      /* */
    }
    this.respaldo = this.o
      .respaldo()
      .then((s) => {
        // Bajada por el camino de siempre: eso es lo que la traza llama «audio».
        if (s && !this.listo && !this.muerto) {
          this.listo = true;
          try {
            this.o.alListo?.();
          } catch {
            /* */
          }
        }
        return s;
      })
      .catch(() => null);
    if (this.pedido && !this.muerto) void this.tocarRespaldo();
  }

  private async tocarRespaldo() {
    const s = await this.respaldo;
    if (this.muerto) {
      void s?.unloadAsync().catch(() => {});
      return;
    }
    if (!s) {
      this.cb?.({ isLoaded: false, error: 'sin voz' });
      return;
    }
    this.deRespaldo = s;
    s.setOnPlaybackStatusUpdate((st) => {
      if (!this.muerto) this.cb?.(st);
    });
    await s.playAsync().catch(() => {
      if (!this.muerto) this.cb?.({ isLoaded: false, error: 'respaldo' });
    });
  }
}

/**
 * La central: un solo oyente de `onVoz` que reparte los avisos a cada frase por su id, y crea las frases. Un aviso de
 * una frase que ya no está (cancelada, terminada) se ignora.
 */
export class CentralVoz {
  private sonidos = new Map<string, SonidoVivo>();
  private sub: { remove(): void } | null = null;
  private sec = 0;

  constructor(private readonly modulo: ModuloVoz) {}

  private escuchar() {
    if (this.sub) return;
    this.sub = this.modulo.addListener('onVoz', (crudo) => {
      const e = eventoVozValido(crudo);
      if (e) this.sonidos.get(e.id)?.evento(e);
    });
  }

  /** Encola una frase (bajando ya, sin sonar hasta playAsync). null: el puente no la aceptó (va por el camino de siempre). */
  crear(o: OpcionesSonido & { url: string; cabeceras: Record<string, string>; prebufferMs?: number }): SonidoVivo | null {
    const id = `v${Date.now().toString(36)}-${(++this.sec).toString(36)}`;
    const s = new SonidoVivo(id, this.modulo, o, () => {
      if (this.sonidos.get(id) === s) this.sonidos.delete(id);
    });
    try {
      this.escuchar();
      this.sonidos.set(id, s);
      const ok = this.modulo.encolar(id, o.url, o.cabeceras, { esperar: true, prebufferMs: o.prebufferMs ?? VOZ_VIVO.prebufferMs });
      if (ok === false) throw new Error('el reproductor no aceptó la frase');
      return s;
    } catch (e) {
      this.sonidos.delete(id);
      try {
        o.alFallar({ codigo: 'puente', motivo: String((e as Error)?.message || e).slice(0, 160) });
      } catch {
        /* */
      }
      return null;
    }
  }

  /** Calla todo ya (stopSpeaking): el nativo vacía su cola y ninguna frase de antes vuelve a avisar. */
  parar() {
    try {
      this.modulo.parar();
    } catch {
      /* */
    }
    for (const s of [...this.sonidos.values()]) s.morir(false);
    this.sonidos.clear();
  }

  /** Cuántas frases esperan avisos (pruebas). */
  get vivas() {
    return this.sonidos.size;
  }
}
