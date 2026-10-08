/**
 * LA VOZ DEL DOCTOR, FRASE POR FRASE (lo puro: los sonidos se inyectan; se prueba en Node con sonidos falsos).
 *
 * Una cola por respuesta, como el locutor de AU-RA (lib/tts.ts `StreamSpeaker`), pero para las frases que ya vienen
 * cortadas del servidor (`frase` del stream) o de `partirEnFrases`:
 *  · cada frase se PREPARA mientras suena la anterior (por el reproductor en streaming, PCM por AudioTrack, la
 *    siguiente queda encadenada sin hueco; por expo-av, ya bajada);
 *  · la primera lleva `primera` (el servidor la dice con el modelo rápido);
 *  · `callar()` corta YA: lo que suena se calla, lo preparado se suelta y nada de esta cola vuelve a sonar;
 *  · cada frase que suena se anota en el registro de la voz (lib/interrupcion.ts `RegistroVoz`): con eso el oído
 *    reconoce su eco y, si la persona la corta, se sabe qué alcanzó a oír (`fraccion()` de la que sonaba).
 *
 * Un sonido es cualquier `Reproducible` (lib/sonidoTipos.ts): un `Audio.Sound` de expo-av o un `SonidoVivo`.
 */
import type { EstadoSonido, Reproducible } from '../lib/sonidoTipos';
import { letras, tienePalabras } from '../lib/cortesVoz';
import type { FraseVoz } from './turnoVivo';

/**
 * `previo`: el final de la frase anterior de la MISMA voz (sin él, el servidor trata cada frase como el comienzo de
 * una respuesta: le pone muletilla de arranque y el tono de la emoción, server/voz.ts). La primera de la respuesta, o
 * la primera de otro personaje de la mesa, va sin él.
 */
export type PedidoVoz = FraseVoz & { primera: boolean; previo?: string };

/** Lo más que viaja de la frase anterior (va en la dirección del GET; el servidor usa 300-400). */
export const PREVIO_MAX = 300;

export type DepsColaVoz = {
  /** El sonido de una frase, sin sonar todavía (null: no hubo voz; se sigue con la siguiente). */
  preparar(p: PedidoVoz): Promise<Reproducible | null>;
  /** Cuando `actual` suene, `siguiente` puede ir pegada detrás (el reproductor en streaming). */
  encadenar?(actual: Reproducible, siguiente: Promise<Reproducible | null>, sigueValiendo: () => boolean): void;
  /** El registro de lo que dice la voz (eco y lo oído al cortar). */
  registro?: { empezo(texto: string): void; termino(): void; callo(): void };
  /** Lo más que se espera una frase sin saber su duración (tope de seguridad). */
  topeMs?: (texto: string) => number;
};

export type AvisosColaVoz = {
  /** La primera frase se manda a sonar (aquí se pausa el oído o se pone a oír encima). */
  alEmpezar?: () => void;
  /** El reproductor confirmó que una frase suena (el comienzo real). */
  alSonar?: (texto: string) => void;
  /** Dijo todo lo que le dieron y la cerraron (`terminado`), o la callaron (`cancelado`). Una sola vez. */
  alTerminar?: (como: 'terminado' | 'cancelado') => void;
};

/** El tope de una frase sin duración conocida: 20 s más ~90 ms por letra (una frase larga leída despacio). */
export function topeDeFrase(texto: string): number {
  return 20_000 + letras(texto) * 90;
}

type Sonando = { s: Reproducible; pos: number; dur: number; soltar: () => void };

export class ColaVoz {
  private cola: FraseVoz[] = [];
  private encoladas: string[] = [];
  private preparada: { f: FraseVoz; p: Promise<Reproducible | null> } | null = null;
  private sonando: Sonando | null = null;
  private bombeando = false;
  private cerrada = false;
  private cancelada = false;
  private terminada = false;
  private empezo = false;
  private pedidas = 0;
  /** La última frase pedida (para el `previo` de la siguiente). */
  private ultima: { voz: string; personaje: string } | null = null;

  constructor(
    private readonly deps: DepsColaVoz,
    private readonly avisos: AvisosColaVoz = {}
  ) {}

  /** Una frase más para decir (en orden). Cerrada o callada: no hace nada. */
  decir(f: FraseVoz) {
    if (this.cerrada || this.cancelada) return;
    const t = String(f.texto || '').trim();
    if (!t || !tienePalabras(f.voz || t)) return;
    const frase: FraseVoz = { ...f, texto: t };
    this.cola.push(frase);
    this.encoladas.push(t);
    if (!this.bombeando) {
      void this.bombear();
      return;
    }
    // Suena otra: esta se prepara ya y, por el reproductor en streaming, queda pegada detrás (sin hueco).
    if (!this.preparada && this.cola[0] === frase) {
      const prep = { f: frase, p: this.preparar(frase) };
      this.preparada = prep;
      const actual = this.sonando?.s;
      if (actual) this.deps.encadenar?.(actual, prep.p, () => this.preparada === prep && !this.cancelada);
    }
  }

  /** No vienen más frases: al terminar la última, `alTerminar('terminado')`. */
  cerrar() {
    if (this.cerrada || this.cancelada) return;
    this.cerrada = true;
    if (!this.bombeando && !this.cola.length) this.terminar('terminado');
  }

  /** Corta ya: lo que suena se calla y nada de esta cola vuelve a sonar. Dos veces: nada más. */
  callar() {
    if (this.cancelada) return;
    this.cancelada = true;
    this.cerrada = true;
    this.cola = [];
    if (this.preparada) {
      soltar(this.preparada.p);
      this.preparada = null;
    }
    const s = this.sonando;
    this.sonando = null;
    if (s) {
      this.deps.registro?.callo();
      void Promise.resolve()
        .then(() => s.s.stopAsync())
        .catch(() => {});
      s.soltar();
    }
    this.terminar('cancelado');
  }

  /** ¿Suena algo de esta cola ahora? */
  get hablando(): boolean {
    return !!this.sonando;
  }

  /** ¿Terminó (dijo todo o la callaron)? */
  get termino(): boolean {
    return this.terminada;
  }

  /** Los textos que se le dieron, en orden (para no repetirlos al llegar el fin). */
  get frasesEncoladas(): string[] {
    return [...this.encoladas];
  }

  /** Cuánto sonó de la frase de ahora (0..1), si se sabe su duración. */
  fraccion(): number | undefined {
    const s = this.sonando;
    if (!s || !(s.dur > 0)) return undefined;
    return Math.max(0, Math.min(1, s.pos / s.dur));
  }

  private terminar(como: 'terminado' | 'cancelado') {
    if (this.terminada) return;
    this.terminada = true;
    try {
      this.avisos.alTerminar?.(como);
    } catch {
      /* quien escucha no rompe la voz */
    }
  }

  private preparar(f: FraseVoz): Promise<Reproducible | null> {
    const primera = this.pedidas === 0;
    this.pedidas += 1;
    const quien = f.personaje || 'electrum';
    const previo = this.ultima && this.ultima.personaje === quien ? this.ultima.voz.slice(-PREVIO_MAX).trim() : '';
    this.ultima = { voz: String(f.voz || f.texto || ''), personaje: quien };
    return Promise.resolve()
      .then(() => this.deps.preparar({ ...f, primera, ...(previo ? { previo } : {}) }))
      .catch(() => null)
      .then((s) => {
        if (s && this.cancelada) {
          void s.unloadAsync().catch(() => {});
          return null;
        }
        return s;
      });
  }

  private async bombear() {
    this.bombeando = true;
    try {
      while (this.cola.length && !this.cancelada) {
        const f = this.cola.shift()!;
        const lista = this.preparada;
        this.preparada = null;
        let p: Promise<Reproducible | null>;
        if (lista && lista.f === f) p = lista.p;
        else {
          if (lista) soltar(lista.p);
          p = this.preparar(f);
        }
        const s = await p;
        if (this.cancelada) {
          if (s) void s.unloadAsync().catch(() => {});
          break;
        }
        // La siguiente se prepara mientras suena esta.
        // (Si llegó mientras se preparaba esta, `decir` ya la empezó a preparar: no se pide dos veces.)
        // (TypeScript la da por null desde arriba; `decir` la pudo poner mientras se esperaba.)
        const ya = this.preparada as { f: FraseVoz; p: Promise<Reproducible | null> } | null;
        if (this.cola[0] && ya?.f !== this.cola[0]) {
          if (ya) soltar(ya.p);
          this.preparada = { f: this.cola[0], p: this.preparar(this.cola[0]) };
        }
        if (!s) continue;
        if (!this.empezo) {
          this.empezo = true;
          try {
            this.avisos.alEmpezar?.();
          } catch {
            /* */
          }
          // `alEmpezar` pudo callarla (es síncrono): entonces esto ya no suena.
          if (this.cancelada) {
            void s.unloadAsync().catch(() => {});
            break;
          }
        }
        const sig = this.preparada;
        if (sig) this.deps.encadenar?.(s, sig.p, () => this.preparada === sig && !this.cancelada);
        await this.tocar(s, f.texto);
      }
    } finally {
      this.bombeando = false;
      if (this.cancelada && this.preparada) {
        soltar(this.preparada.p);
        this.preparada = null;
      }
      if (!this.cancelada && this.cerrada && !this.cola.length) this.terminar('terminado');
    }
  }

  /** Suena una frase y espera a que termine (o a que la callen, o al tope). */
  private tocar(s: Reproducible, texto: string): Promise<void> {
    return new Promise<void>((resolver) => {
      let fin = false;
      let confirmada = false;
      let conDuracion = false;
      let guardia: ReturnType<typeof setTimeout> | null = null;
      const yo: Sonando = { s, pos: 0, dur: 0, soltar: () => acabar(false) };
      const acabar = (entera: boolean) => {
        if (fin) return;
        fin = true;
        if (guardia) clearTimeout(guardia);
        if (this.sonando === yo) {
          this.sonando = null;
          if (entera) this.deps.registro?.termino();
          else this.deps.registro?.callo();
        }
        try {
          s.setOnPlaybackStatusUpdate(null);
        } catch {
          /* */
        }
        void Promise.resolve()
          .then(() => s.unloadAsync())
          .catch(() => {});
        resolver();
      };
      this.sonando = yo;
      this.deps.registro?.empezo(texto);
      s.setOnPlaybackStatusUpdate((st: EstadoSonido) => {
        if (fin) return;
        if (!st.isLoaded) {
          if (st.error) acabar(false);
          return;
        }
        if (typeof st.positionMillis === 'number') yo.pos = st.positionMillis;
        if (typeof st.durationMillis === 'number' && st.durationMillis > 0) {
          yo.dur = st.durationMillis;
          if (!conDuracion) {
            conDuracion = true;
            if (guardia) clearTimeout(guardia);
            guardia = setTimeout(() => acabar(true), Math.max(0, st.durationMillis - (st.positionMillis || 0)) + 1500);
          }
        }
        if (!confirmada && st.isPlaying && !st.didJustFinish) {
          confirmada = true;
          try {
            this.avisos.alSonar?.(texto);
          } catch {
            /* */
          }
        }
        if (st.didJustFinish) acabar(true);
      });
      guardia = setTimeout(() => acabar(true), (this.deps.topeMs || topeDeFrase)(texto));
      Promise.resolve()
        .then(() => s.playAsync())
        .catch(() => acabar(false));
    });
  }
}

/** Suelta un sonido preparado que ya nadie va a usar (cuando llegue). */
function soltar(p: Promise<Reproducible | null>) {
  void p.then((s) => s?.unloadAsync().catch(() => {})).catch(() => {});
}

/* ------------------------------------------------------------------ la guardia del reproductor en streaming */

/**
 * La red de seguridad del reproductor en streaming en la app del doctor (la de AU-RA es lib/guardiaVoz.ts, atada a su
 * servidor y sus Ajustes). Antes de la PRIMERA frase por el nativo en el proceso se anota «arrancando» (y se espera a
 * que quede escrito); con la primera que suena y `sanoTrasMs` más, se borra. Si al abrir la app la marca sigue ahí, el
 * proceso anterior murió con la voz nativa arrancando: esa sesión va por la voz de siempre (expo-av), y dos golpes en
 * `ventanaMs` la dejan por la de siempre hasta que el más viejo caduque. Irse a segundo plano con calma borra la marca.
 */
export const GUARDIA_VOZ_CAMPO = { ventanaMs: 3 * 24 * 60 * 60_000, golpesMax: 2, sanoTrasMs: 10_000 } as const;

export type GuardiaVozCampo = { arrancando?: number; golpes?: number[] };

/** Lo guardado, revisado: basura → vacío. */
export function guardiaVozCampoValida(v: unknown): GuardiaVozCampo {
  const o = v as any;
  if (!o || typeof o !== 'object') return {};
  const golpes = Array.isArray(o.golpes) ? o.golpes.filter((t: unknown) => typeof t === 'number' && Number.isFinite(t)).slice(-10) : [];
  return { ...(typeof o.arrancando === 'number' && Number.isFinite(o.arrancando) ? { arrancando: o.arrancando } : {}), golpes };
}

/** Al abrir la app: lo que queda guardado y si esta sesión usa la voz nativa o la de siempre. */
export function guardiaVozAlAbrir(g: GuardiaVozCampo, ahora: number): { estado: GuardiaVozCampo; bloqueada: boolean } {
  const golpes = (g.golpes || []).filter((t) => ahora - t >= 0 && ahora - t < GUARDIA_VOZ_CAMPO.ventanaMs);
  const cayo = typeof g.arrancando === 'number';
  if (cayo) golpes.push(g.arrancando as number);
  return { estado: { golpes }, bloqueada: cayo || golpes.length >= GUARDIA_VOZ_CAMPO.golpesMax };
}
