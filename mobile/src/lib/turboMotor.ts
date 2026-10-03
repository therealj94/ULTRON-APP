/**
 * EL OÍDO TURBO del teléfono (José, 2-oct: «opción 2, que sea la mejor versión de todas, tan fluido»).
 *
 * El micrófono crudo (modules/aura-mic) entrega trozos de 0,1 s. Mientras no hay voz, se guardan los
 * últimos 0,6 s (para no comerse la primera sílaba); cuando hay voz, esos trozos y los que siguen van
 * EN VIVO a Scribe v2 Realtime Turbo por un WebSocket abierto con un token de un solo uso que da el
 * servidor (la clave de ElevenLabs nunca llega al teléfono). Turbo devuelve lo que va entendiendo
 * (parciales: la cara y el texto reaccionan mientras se habla) y, al callar, la frase entera ~0,05 s
 * después del cierre (medido el 2-oct: 36–57 ms).
 *
 * Cuándo se cierra la frase lo decide el teléfono con el volumen y con lo que Turbo ya entendió:
 * corto si terminó en punto o pregunta, largo si se quedó en «y», «de», «para»… (turboLogica.ts).
 *
 * Dinero: si la frase habla de pagar, enviar, ORIGEN, montos o cifras, se vuelve a oír con Scribe v2
 * en el servidor antes de actuar (en la prueba Turbo escribió «100 dólares» por «cien lempiras»).
 *
 * Si algo falla, nunca se pierde la frase: sin token, sin red al WebSocket o sin respuesta a tiempo,
 * la frase entera (que el teléfono guardó) se manda en WAV a /api/stt, que la oye con Turbo o Scribe v2.
 * Tres fallos seguidos del en vivo y se usa solo ese camino durante 5 minutos.
 *
 * Sin dependencias de React Native: el micrófono, la red y el reloj se inyectan (pruebas en Node).
 */
import {
  SILENCIO_COMMIT_B64,
  esFraseDeDinero,
  limpiarFinal,
  nivelDeDb,
  ruidoInicial,
  seguirRuido,
  VENTANA_RUIDO_TROZOS,
  silencioParaCerrar,
  umbralVoz,
  wavDeTrozos,
} from './turboLogica';

export type TrozoAudio = { audio: string; db: number };

export type WsTurbo = {
  readonly readyState: number;
  send(datos: string): void;
  close(): void;
  onopen: (() => void) | null;
  onmessage: ((e: { data: any }) => void) | null;
  onerror: ((e?: any) => void) | null;
  onclose: ((e?: any) => void) | null;
};

export type DepsTurbo = {
  abrirMic(alTrozo: (t: TrozoAudio) => void, alFallo: (motivo: string) => void): Promise<(() => void) | null>;
  permiso(): Promise<{ url: string } | null>;
  transcribirWav(wavB64: string, confirmar: boolean): Promise<string>;
  crearWs(url: string): WsTurbo;
  ahora?: () => number;
  tiempos?: Partial<typeof TIEMPOS>;
};

export type CallbacksTurbo = {
  onSpeechStart?: () => void;
  onPartial?: (texto: string) => void;
  onLevel?: (nivel01: number) => void;
  onFinal?: (texto: string) => void;
  onListeningChange?: (on: boolean) => void;
  onError?: (motivo: string) => void;
  /** El micrófono crudo no abre: que el oído vuelva al reconocedor del teléfono. */
  onUnavailable?: (motivo: string) => void;
};

export const TIEMPOS = {
  /** Lo que se guarda antes de que empiece la voz (trozos de 0,1 s). */
  prerolloTrozos: 6,
  /** Menos que esto de voz y sin texto de Turbo: un golpe o un ruido, no una frase. */
  minimoFraseMs: 220,
  /** Una frase nunca pasa de esto: se cierra y se sigue oyendo. */
  maximoFraseMs: 15_000,
  /** Tras el cierre, lo que se espera la frase de Turbo antes de mandarla por /api/stt. */
  esperaFinalMs: 2_500,
  /** Lo que se espera a Scribe v2 para confirmar una frase de dinero. */
  confirmarMs: 6_000,
  /** WebSocket sin voz este rato: se cierra (y se vuelve a abrir con la próxima frase). */
  inactivoMs: 20_000,
  /** Un token guardado más que esto se pide de nuevo (ElevenLabs los da por 15 min). */
  vigenciaPermisoMs: 10 * 60_000,
  /** Tres fallos seguidos del en vivo: solo /api/stt durante este rato. */
  pausaVivoMs: 5 * 60_000,
  /** Sin trozos del micrófono este rato (queriendo oír): está colgado. */
  micMudoMs: 3_000,
  /** «Oyendo» este rato sin que Turbo entienda una palabra (con el en vivo andando): era ruido, no voz. */
  ruidoSinTextoMs: 4_000,
  /** Turbo ya entendió algo y su texto no cambia en este rato: la persona terminó de hablar. */
  textoQuietoMs: 2_000,
};

const ABIERTO = 1;

export class MotorTurbo {
  private cb: CallbacksTurbo = {};
  private readonly t: typeof TIEMPOS;
  private readonly ahora: () => number;

  private quiere = false;
  private pausado = false;
  private cerrarMic: (() => void) | null = null;
  private abriendoMic = false;
  private fallosMic = 0;
  private reintentoMic: ReturnType<typeof setTimeout> | null = null;
  private ultimoTrozoEn = 0;
  private micDesde = 0;

  private ruido = -60;
  /** Los volúmenes de los últimos ~3 s: su mínimo es el ruido de fondo. Vacío = micrófono recién abierto. */
  private historial: number[] = [];
  private ultimoNivel = -1;
  private prerollo: string[] = [];
  private enVoz = false;
  private vozDesde = 0;
  private ultimaVozEn = 0;
  private trozosFrase: string[] = [];
  private parcial = '';
  /** Cuándo cambió por última vez lo que Turbo va entendiendo. */
  private parcialEn = 0;
  /** Lo que Turbo cerró por su cuenta a media frase (frases larguísimas): va delante de la siguiente. */
  private prefijo = '';

  private ws: WsTurbo | null = null;
  private wsAbierto = false;
  private conectando = false;
  private cola: string[] = [];
  private pendientes: { trozos: string[]; vence: ReturnType<typeof setTimeout> }[] = [];
  private inactivo: ReturnType<typeof setTimeout> | null = null;
  private fallosVivo = 0;
  private sinVivoHasta = 0;

  private guardado: { url: string; en: number } | null = null;
  private pidiendo: Promise<void> | null = null;

  /** Las frases salen en orden aunque una espere la confirmación de dinero. */
  private cadena: Promise<void> = Promise.resolve();

  constructor(private readonly deps: DepsTurbo) {
    this.t = { ...TIEMPOS, ...(deps.tiempos || {}) };
    this.ahora = deps.ahora || Date.now;
  }

  setCallbacks(cb: CallbacksTurbo) {
    this.cb = cb;
  }

  // ── lo que pide la fachada (lib/speech.ts) ────────────────────────────────────────────────────
  activar() {
    this.quiere = true;
    this.prepararPermiso();
    void this.arrancarMic();
  }

  silenciar() {
    this.quiere = false;
    this.pararMic();
    this.olvidarFrase();
    this.cerrarWs(false);
  }

  pausar(p: boolean) {
    if (this.pausado === p) return;
    this.pausado = p;
    if (p) {
      // Mientras suena su voz, el micrófono se cierra (no se oye a sí misma) y la frase a medias se olvida.
      this.pararMic();
      this.olvidarFrase();
    } else {
      void this.arrancarMic();
    }
  }

  reiniciar() {
    this.pararMic();
    this.olvidarFrase();
    this.fallosMic = 0;
    void this.arrancarMic();
  }

  destruir() {
    this.silenciar();
    this.cb = {};
  }

  quiereOir() {
    return this.quiere;
  }

  estaPausado() {
    return this.pausado;
  }

  /** ¿Oyendo de verdad ahora? (micrófono abierto y entregando audio). */
  escuchando() {
    return this.quiere && !this.pausado && !!this.cerrarMic && this.ahora() - this.ultimoTrozoEn < this.t.micMudoMs;
  }

  /** El vigilante: queriendo oír y sin pausa, el micrófono tiene que estar entregando audio. */
  vivo() {
    if (!this.quiere || this.pausado) return true;
    if (this.abriendoMic || this.reintentoMic) return this.ahora() - this.micDesde < 8_000;
    return !!this.cerrarMic && this.ahora() - this.ultimoTrozoEn < this.t.micMudoMs + 1_000;
  }

  // ── micrófono ─────────────────────────────────────────────────────────────────────────────────
  private async arrancarMic() {
    if (this.reintentoMic) {
      clearTimeout(this.reintentoMic);
      this.reintentoMic = null;
    }
    if (this.abriendoMic || this.cerrarMic || !this.quiere || this.pausado) return;
    this.abriendoMic = true;
    this.micDesde = this.ahora();
    let cerrar: (() => void) | null = null;
    try {
      cerrar = await this.deps.abrirMic(
        (t) => this.trozo(t),
        (m) => this.falloMic(m)
      );
    } catch (e: any) {
      this.cb.onError?.(String(e?.message || e));
    }
    this.abriendoMic = false;
    if (!cerrar) {
      this.fallosMic++;
      if (this.fallosMic >= 3) {
        this.fallosMic = 0;
        this.cb.onUnavailable?.('el micrófono no abre');
        return;
      }
      this.reintentoMic = setTimeout(() => {
        this.reintentoMic = null;
        void this.arrancarMic();
      }, 700);
      return;
    }
    if (!this.quiere || this.pausado) {
      cerrar();
      return;
    }
    this.cerrarMic = cerrar;
    this.fallosMic = 0;
    this.historial = [];
    this.ultimoTrozoEn = this.ahora();
    this.cb.onListeningChange?.(true);
  }

  private pararMic() {
    if (this.reintentoMic) {
      clearTimeout(this.reintentoMic);
      this.reintentoMic = null;
    }
    const c = this.cerrarMic;
    this.cerrarMic = null;
    if (c) {
      try {
        c();
      } catch {
        /* */
      }
      this.cb.onListeningChange?.(false);
    }
  }

  private falloMic(motivo: string) {
    this.cb.onError?.(motivo);
    this.pararMic();
    this.olvidarFrase();
    if (!this.quiere || this.pausado) return;
    this.fallosMic++;
    if (this.fallosMic >= 3) {
      this.fallosMic = 0;
      this.cb.onUnavailable?.(motivo);
      return;
    }
    this.reintentoMic = setTimeout(() => {
      this.reintentoMic = null;
      void this.arrancarMic();
    }, 600);
  }

  // ── voz ───────────────────────────────────────────────────────────────────────────────────────
  private trozo(t: TrozoAudio) {
    if (!this.cerrarMic || this.pausado || !this.quiere) return;
    const ahora = this.ahora();
    this.ultimoTrozoEn = ahora;
    const db = typeof t.db === 'number' && Number.isFinite(t.db) ? t.db : -100;
    if (!this.historial.length) this.ruido = ruidoInicial(db);
    this.historial.push(db);
    if (this.historial.length > VENTANA_RUIDO_TROZOS) this.historial.shift();
    this.ruido = seguirRuido(this.ruido, this.historial);
    const hayVoz = db >= umbralVoz(this.ruido);
    const nivel = nivelDeDb(db, this.ruido);
    if (Math.abs(nivel - this.ultimoNivel) > 0.08 || (nivel === 0 && this.ultimoNivel !== 0)) {
      this.ultimoNivel = nivel;
      this.cb.onLevel?.(nivel);
    }

    if (!this.enVoz) {
      if (hayVoz) return this.empezarFrase(t.audio, ahora);
      this.prerollo.push(t.audio);
      if (this.prerollo.length > this.t.prerolloTrozos) this.prerollo.shift();
      return;
    }

    this.trozosFrase.push(t.audio);
    this.enviarAudio(t.audio, false);
    if (hayVoz) this.ultimaVozEn = ahora;
    // Turbo oye en vivo y en todo este rato no entendió ni una palabra: era ruido (un ventilador, la tele
    // lejos). Se tira la frase y el ruido de fondo sube a lo que suena ahora, para no volver a caer.
    if (!this.parcial.trim() && this.wsAbierto && ahora - this.vozDesde >= this.t.ruidoSinTextoMs) {
      this.ruido = Math.max(this.ruido, db, ...this.historial.slice(-5));
      return this.descartarFrase();
    }
    // Turbo ya entendió algo y no ha cambiado su texto en un rato: la persona terminó, aunque el volumen
    // (ruido de fondo, eco) siga pareciendo voz. Los parciales llegan cada ~1 s mientras se habla.
    if (this.parcial.trim() && this.wsAbierto && ahora - this.parcialEn >= this.t.textoQuietoMs && ahora - this.ultimaVozEn < this.t.textoQuietoMs) {
      return this.cerrarFrase();
    }
    if (ahora - this.vozDesde >= this.t.maximoFraseMs) return this.cerrarFrase();
    if (ahora - this.ultimaVozEn >= silencioParaCerrar(this.parcial)) {
      if (this.parcial.trim() || this.ultimaVozEn - this.vozDesde >= this.t.minimoFraseMs) this.cerrarFrase();
      else this.descartarFrase();
    }
  }

  private empezarFrase(audio: string, ahora: number) {
    this.enVoz = true;
    this.vozDesde = this.ultimaVozEn = ahora;
    this.parcial = '';
    this.trozosFrase = [...this.prerollo, audio];
    this.prerollo = [];
    if (this.inactivo) {
      clearTimeout(this.inactivo);
      this.inactivo = null;
    }
    this.cb.onSpeechStart?.();
    if (this.ahora() >= this.sinVivoHasta) {
      void this.asegurarWs();
      for (const a of this.trozosFrase) this.enviarAudio(a, false);
    }
  }

  /** Un golpe o un ruido corto sin texto: no es una frase. */
  private descartarFrase() {
    this.enVoz = false;
    this.trozosFrase = [];
    this.soltarParcial();
    this.programarInactivo();
  }

  /** Pausa o silencio a media frase: se olvida lo que iba (lo mismo que hacen los otros oídos). */
  private olvidarFrase() {
    this.enVoz = false;
    this.trozosFrase = [];
    this.prerollo = [];
    this.soltarParcial();
  }

  private soltarParcial() {
    if (this.parcial) {
      this.parcial = '';
      this.cb.onPartial?.('');
    }
  }

  private cerrarFrase() {
    this.enVoz = false;
    const trozos = this.trozosFrase;
    this.trozosFrase = [];
    this.prerollo = [];
    this.parcial = '';
    if (this.ws || this.conectando) {
      this.enviarAudio(SILENCIO_COMMIT_B64, true);
      const p = {
        trozos,
        vence: setTimeout(() => this.vencioFinal(p), this.t.esperaFinalMs),
      };
      this.pendientes.push(p);
    } else {
      this.respaldo(trozos);
    }
    this.programarInactivo();
  }

  // ── el en vivo con Turbo ──────────────────────────────────────────────────────────────────────
  private enviarAudio(b64: string, commit: boolean) {
    if (!this.ws && !this.conectando) return;
    const msg = JSON.stringify({ message_type: 'input_audio_chunk', audio_base_64: b64, commit, sample_rate: 16000 });
    if (this.wsAbierto && this.ws && this.ws.readyState === ABIERTO) {
      try {
        this.ws.send(msg);
      } catch {
        this.tirarWs(true);
      }
    } else {
      this.cola.push(msg);
    }
  }

  private prepararPermiso() {
    if (this.pidiendo || (this.guardado && this.ahora() - this.guardado.en < this.t.vigenciaPermisoMs)) return;
    this.pidiendo = this.deps
      .permiso()
      .then((p) => {
        this.guardado = p?.url ? { url: p.url, en: this.ahora() } : null;
      })
      .catch(() => {
        this.guardado = null;
      })
      .finally(() => {
        this.pidiendo = null;
      });
  }

  /** El token de un solo uso: el guardado si sigue vigente, si no uno nuevo. Después se pide el siguiente. */
  private async tomarPermiso(): Promise<string | null> {
    if (this.guardado && this.ahora() - this.guardado.en >= this.t.vigenciaPermisoMs) this.guardado = null;
    if (!this.guardado) {
      this.prepararPermiso();
      await this.pidiendo;
    }
    const url = this.guardado?.url || null;
    this.guardado = null;
    this.prepararPermiso();
    return url;
  }

  private async asegurarWs() {
    if (this.ws || this.conectando) return;
    this.conectando = true;
    this.cola = [];
    const url = await this.tomarPermiso();
    if (!this.conectando) return;
    if (!url) return this.falloVivo('sin permiso del servidor para oír en vivo');
    let w: WsTurbo;
    try {
      w = this.deps.crearWs(url);
    } catch (e: any) {
      return this.falloVivo(String(e?.message || e));
    }
    this.ws = w;
    w.onopen = () => {
      if (w !== this.ws) return;
      this.wsAbierto = true;
      this.conectando = false;
      const cola = this.cola;
      this.cola = [];
      try {
        for (const m of cola) w.send(m);
      } catch {
        this.tirarWs(true);
      }
    };
    w.onmessage = (e) => w === this.ws && this.mensaje(e.data);
    w.onerror = () => w === this.ws && this.tirarWs(!this.wsAbierto);
    w.onclose = () => w === this.ws && this.tirarWs(!this.wsAbierto);
  }

  private mensaje(datos: any) {
    let j: any;
    try {
      j = typeof datos === 'string' ? JSON.parse(datos) : datos;
    } catch {
      return;
    }
    const tipo = String(j?.message_type || '');
    if (tipo === 'session_started') {
      this.fallosVivo = 0;
      return;
    }
    if (tipo === 'partial_transcript') {
      const texto = String(j.text || '').trim();
      if (this.enVoz && !this.pausado && texto && texto !== this.parcial) {
        this.parcial = texto;
        this.parcialEn = this.ahora();
        this.cb.onPartial?.(texto);
      }
      return;
    }
    if (tipo === 'committed_transcript' || tipo === 'committed_transcript_with_timestamps') {
      const texto = String(j.text || '').trim();
      const p = this.pendientes.shift();
      if (!p) {
        // Turbo cerró solo a media frase: lo dicho va delante de lo que siga.
        if (texto) this.prefijo = `${this.prefijo}${texto} `;
        return;
      }
      clearTimeout(p.vence);
      const todo = `${this.prefijo}${texto}`;
      this.prefijo = '';
      this.entregar(todo, p.trozos);
      return;
    }
    if (/error|exceeded|limited|throttl/i.test(tipo)) {
      this.cb.onError?.(`Turbo: ${tipo} ${j.error || j.message || ''}`.trim());
      this.tirarWs(true);
    }
  }

  private vencioFinal(p: { trozos: string[] }) {
    const i = this.pendientes.indexOf(p as any);
    if (i < 0) return;
    // Turbo no contestó a tiempo: esa conexión no sirve; lo pendiente va por /api/stt.
    this.tirarWs(true);
  }

  /** La conexión se cayó o no sirve: lo que esperaba respuesta se manda entero por /api/stt. */
  private tirarWs(contarFallo: boolean) {
    const w = this.ws;
    this.ws = null;
    this.wsAbierto = false;
    this.conectando = false;
    this.cola = [];
    if (w) {
      w.onopen = w.onmessage = w.onerror = w.onclose = null;
      try {
        w.close();
      } catch {
        /* */
      }
    }
    const pendientes = this.pendientes;
    this.pendientes = [];
    for (const p of pendientes) {
      clearTimeout(p.vence);
      this.respaldo(p.trozos);
    }
    if (contarFallo) this.contarFalloVivo();
    // A media frase: se reconecta y se vuelve a mandar todo lo que va de la frase.
    if (this.enVoz && this.ahora() >= this.sinVivoHasta) {
      void this.asegurarWs();
      for (const a of this.trozosFrase) this.enviarAudio(a, false);
    }
  }

  private falloVivo(motivo: string) {
    this.conectando = false;
    this.cola = [];
    this.cb.onError?.(motivo);
    this.contarFalloVivo();
    // Lo que se iba a cerrar por el en vivo: si la frase ya terminó y esperaba, va por /api/stt.
    const pendientes = this.pendientes;
    this.pendientes = [];
    for (const p of pendientes) {
      clearTimeout(p.vence);
      this.respaldo(p.trozos);
    }
  }

  private contarFalloVivo() {
    this.fallosVivo++;
    if (this.fallosVivo >= 3) {
      this.fallosVivo = 0;
      this.sinVivoHasta = this.ahora() + this.t.pausaVivoMs;
    }
  }

  private programarInactivo() {
    if (this.inactivo) clearTimeout(this.inactivo);
    this.inactivo = setTimeout(() => {
      this.inactivo = null;
      if (!this.enVoz && !this.pendientes.length) this.cerrarWs(false);
    }, this.t.inactivoMs);
  }

  private cerrarWs(_motivo: boolean) {
    if (this.inactivo) {
      clearTimeout(this.inactivo);
      this.inactivo = null;
    }
    const w = this.ws;
    this.ws = null;
    this.wsAbierto = false;
    this.conectando = false;
    this.cola = [];
    for (const p of this.pendientes) clearTimeout(p.vence);
    this.pendientes = [];
    this.prefijo = '';
    if (w) {
      w.onopen = w.onmessage = w.onerror = w.onclose = null;
      try {
        w.close();
      } catch {
        /* */
      }
    }
  }

  // ── entregar la frase ─────────────────────────────────────────────────────────────────────────
  private entregar(textoTurbo: string, trozos: string[]) {
    this.cadena = this.cadena
      .then(async () => {
        let texto = limpiarFinal(textoTurbo);
        if (!texto) return;
        if (esFraseDeDinero(texto) && trozos.length) {
          const confirmado = await this.conTope(this.deps.transcribirWav(wavDeTrozos(trozos), true), this.t.confirmarMs);
          const limpio = limpiarFinal(confirmado || '');
          if (limpio) texto = limpio;
        }
        if (this.quiere && !this.pausado) this.cb.onFinal?.(texto);
      })
      .catch(() => {});
  }

  /** La frase entera por /api/stt (el servidor la oye con Turbo y, si es de dinero, la confirma). */
  private respaldo(trozos: string[]) {
    if (trozos.length < 3) return;
    this.cadena = this.cadena
      .then(async () => {
        const texto = limpiarFinal((await this.conTope(this.deps.transcribirWav(wavDeTrozos(trozos), false), 16_000)) || '');
        if (texto && this.quiere && !this.pausado) this.cb.onFinal?.(texto);
      })
      .catch(() => {});
  }

  private conTope<T>(p: Promise<T>, ms: number): Promise<T | null> {
    return new Promise((resolver) => {
      const t = setTimeout(() => resolver(null), ms);
      p.then(
        (v) => {
          clearTimeout(t);
          resolver(v);
        },
        () => {
          clearTimeout(t);
          resolver(null);
        }
      );
    });
  }
}
