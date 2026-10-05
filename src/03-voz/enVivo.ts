/**
 * LA CONVERSACIÓN EN VIVO DE LA WEB: el mismo agente de ElevenLabs que usa la app (WebRTC, nuestro
 * cerebro detrás por /api/voz/llm), como el modo voz de ChatGPT. La persona habla y AU-RA contesta
 * de corrido, la interrumpe cuando quiere y no hay un turno de «dictar → esperar → leer frase a frase».
 *
 * El micrófono de siempre (useOido: Scribe v2 Realtime Turbo en vivo, o el reconocimiento del navegador de respaldo, + voz frase por frase) sigue siendo el
 * respaldo: si la conversación no abre (sin sesión, sin minutos, sin red), la mesa vuelve a él.
 *
 *  · El permiso es de un solo uso y lo pide el servidor con la sesión de la mesa (/api/voz/agente):
 *    la llave de ElevenLabs nunca llega al navegador.
 *  · El pase (quién habla) viaja como variable dinámica y vuelve al servidor en cada turno (X-Pase).
 *  · Al colgar se avisa a /api/voz/agente/cerrar: el pase deja de valer ya, no a los cinco minutos.
 *
 * Sin React ni el SDK adentro: los recibe (`abrirSesion`, `pedir`), así se prueba en Node.
 *
 * Mientras conecta o está abierta cuenta como trabajo activo (10-infra/trabajoActivo.ts; AUR14): la PWA no
 * aplica una versión nueva encima de la llamada; al colgar avisa y la recarga pendiente sigue.
 *
 * UNA SOLA TERMINACIÓN (A4, auditoría del 4-oct, paquete P2): se corte sola (onDisconnect), la cuelguen
 * (cerrar: el botón, «cuelga», salir de la cuenta, desmontar la mesa), falle (onError) o venza un plazo, todo
 * pasa por `terminar()`: la generación avanza (ningún callback de esa sesión vuelve a tocar estado, mensajes ni
 * audio), los plazos se apagan, la sesión del SDK se cuelga (endSession es idempotente en el SDK), el pase se
 * suelta una vez y el micrófono silenciado y la salida callada vuelven a cero. Antes la desconexión natural
 * dejaba «cerrada» con los callbacks vivos: un «speaking» tardío la devolvía a «hablando».
 *
 * EL MOTOR NUEVO (prototipo de Speech Engine, docs/voz/SPEECH-ENGINE.md): solo si el servidor lo dice en su
 * respuesta (`motor: 'speech-engine'`, para una cuenta con el interruptor). Entonces se le pide al SDK la
 * primera frase (`overrides.agent.firstMessage`: Speech Engine no tiene una propia) y, al conectar, se ata la
 * conversación al pase (/api/voz/motor/vincular) por si ElevenLabs no reenvía `X-Pase`. Lo que contesta se lee
 * con honestidad (src/03-voz/vinculoMotor.ts): si el servidor dice, con su código, que esa llamada ya no se va a
 * atar (se cerró, es de otra cuenta…), la llamada se termina bien y dice por qué; un error pasajero (un 404 de
 * un proxy, sin red) se reintenta y no se toma como respuesta. Sin eso, nada cambia: las mismas opciones al SDK
 * y las mismas peticiones de siempre.
 *
 * Los controles de la llamada (P2): `silenciarMic` deja de mandar el micrófono de ESTA sesión sin colgar
 * (setMicMuted del SDK) y se puede volver a escuchar; `callarSalida` calla lo que la llamada está diciendo
 * (volumen 0) hasta que termina esa frase, y la siguiente se oye. Lo que el SDK no sepa hacer no se anuncia
 * (`puedeSilenciar`, `onControles`) ni se finge. Callar o colgar no tocan el trabajo durable.
 */
import { avisarTrabajoLibre, registrarTrabajoActivo } from '../10-infra/trabajoActivo';
import { vincularConReintentos } from './vinculoMotor';

export type EstadoEnVivo = 'cerrada' | 'conectando' | 'escuchando' | 'hablando' | 'error';

/**
 * Lo poco del SDK (@elevenlabs/client, Conversation) que se usa aquí. Silenciar y el volumen son opcionales:
 * si la sesión no los trae, no se anuncian.
 */
export type SesionAgente = {
  endSession: () => Promise<void> | void;
  /** El id de la conversación en ElevenLabs (Conversation.getId del SDK); solo para el motor nuevo. */
  getId?: () => string;
  setMicMuted?: (silenciado: boolean) => void;
  setVolume?: (o: { volume: number }) => void;
};
export type OpcionesSesion = {
  conversationToken: string;
  connectionType: 'webrtc';
  dynamicVariables: Record<string, string>;
  /** Solo con el motor nuevo: la primera frase (Speech Engine no tiene una propia). */
  overrides?: { agent: { firstMessage: string } };
  onConnect?: (p?: { conversationId?: string }) => void;
  onDisconnect?: () => void;
  onError?: (mensaje: string) => void;
  onModeChange?: (m: { mode: string }) => void;
  onMessage?: (m: { message: string; source: string }) => void;
};

/** Qué sabe hacer la llamada abierta (silenciar su micrófono sin colgar) y cómo está. */
export type ControlesEnVivo = { silenciable: boolean; silenciado: boolean };
export type ResultadoEnVivo = { ok: boolean; detalle?: string };

export type DepsEnVivo = {
  /** Conversation.startSession del SDK (se carga solo al abrir: no pesa en la primera pantalla). */
  abrirSesion: (o: OpcionesSesion) => Promise<SesionAgente>;
  /** fetch con la sesión de la mesa (headersMesa). */
  pedir: (ruta: string, cuerpo: unknown) => Promise<{ ok: boolean; status: number; json: any }>;
  onEstado: (e: EstadoEnVivo, detalle?: string) => void;
  onMensaje: (quien: 'persona' | 'aura', texto: string) => void;
  /** Lo que la llamada sabe hacer ahora y cómo está: la interfaz anuncia solo eso (cada vez que cambia). */
  onControles?: (c: ControlesEnVivo) => void;
};

/**
 * Plazos de la apertura (CALL02, auditoría del 3-oct; los mismos que la app, mobile/src/compa/sesion.ts):
 * antes el inicio podía quedarse en «conectando» para siempre si el permiso no volvía o el WebRTC no
 * terminaba. Pedir el permiso y conectar son esperas distintas, cada una con su plazo, y las dos juntas
 * con un tope total. Al vencer: error recuperable (la mesa vuelve a su micrófono) y lo que llegue tarde
 * se cuelga y su pase se suelta.
 */
export const PERMISO_MAX_MS = 15_000;
export const CONECTAR_MAX_MS = 12_000;
export const ABRIR_MAX_MS = 25_000;
const NO_CONECTO = 'La conversación en vivo no conectó a tiempo. Seguimos con el micrófono de siempre.';
const VENCIDO = Symbol('vencido');

/** Los relojes de una apertura: vencen (o se cancelan) y quien espera deja de esperar. */
type Plazos = {
  /** La fase que empieza ahora, con su plazo (reemplaza al de la anterior). */
  fase: (ms: number) => void;
  /** Espera `p`, o a que venza o se cancele la apertura (VENCIDO). */
  esperar: <T>(p: Promise<T>) => Promise<T | typeof VENCIDO>;
  /** Conectó (o falló por su cuenta): los relojes se apagan. */
  listo: () => void;
  /** Colgaron: quien espera deja de esperar, sin error. */
  cancelar: () => void;
};

/** Lo que dice la mesa cuando no abre, según lo que contestó el servidor. */
export function porQueNoAbre(status: number, json: any): string {
  if (status === 401) return 'Entrá de nuevo para hablar en vivo.';
  if (json?.codigo === 'TOPE_VOZ' && json?.error) return String(json.error);
  if (json?.honesto && json?.error) return String(json.error);
  return 'No pude abrir la conversación en vivo. Seguimos con el micrófono de siempre.';
}

export class ConversacionEnVivo {
  private sesion: SesionAgente | null = null;
  private pase = '';
  /** Cada apertura es una generación: lo que llegue de una vieja (o de una ya terminada) no toca nada. */
  private gen = 0;
  private estado_: EstadoEnVivo = 'cerrada';
  /** Los plazos de la apertura en curso (null: no hay ninguna conectando). */
  private plazo: Plazos | null = null;
  /** El micrófono de ESTA sesión, silenciado sin colgar. */
  private micSilenciado_ = false;
  /** Lo que la llamada estaba diciendo se calló (volumen 0) hasta que termine esa frase. */
  private salidaCallada = false;
  /** Lo último que se le contó a la interfaz (onControles), para no repetirlo. */
  private anunciado = 'false:false';

  /** Ya se anotó como trabajo activo (una vez por conversación). */
  private registrada = false;

  constructor(private d: DepsEnVivo) {}

  /** ¿Está ocupada (conectando o abierta)? Una recarga ahora cortaría la llamada. */
  ocupada(): boolean {
    return this.estado_ === 'conectando' || this.estado_ === 'escuchando' || this.estado_ === 'hablando';
  }

  /** Los plazos de la apertura `gen`: el total corre desde ya; cada fase pone el suyo. */
  private plazos(gen: number): Plazos {
    this.plazo?.cancelar();
    let fin!: () => void;
    const vencido = new Promise<typeof VENCIDO>((r) => (fin = () => r(VENCIDO)));
    let reloj: ReturnType<typeof setTimeout> | null = null;
    const apagar = () => {
      clearTimeout(total);
      if (reloj) clearTimeout(reloj);
      reloj = null;
      if (this.plazo === p) this.plazo = null;
    };
    const vencer = () => {
      apagar();
      fin();
      // Venció un plazo de esta apertura: error recuperable (la mesa vuelve a su micrófono), la misma terminación.
      if (gen === this.gen) this.terminar('error', NO_CONECTO);
    };
    const total = setTimeout(vencer, ABRIR_MAX_MS);
    const p: Plazos = {
      fase: (ms) => {
        if (reloj) clearTimeout(reloj);
        reloj = setTimeout(vencer, ms);
      },
      esperar: (x) => Promise.race([x, vencido]),
      listo: apagar,
      cancelar: () => {
        apagar();
        fin();
      },
    };
    this.plazo = p;
    return p;
  }

  estado(): EstadoEnVivo {
    return this.estado_;
  }

  private poner(gen: number, e: EstadoEnVivo, detalle?: string) {
    if (gen !== this.gen) return;
    this.estado_ = e;
    this.d.onEstado(e, detalle);
    if (!this.ocupada()) avisarTrabajoLibre();
  }

  /** La sesión abierta (con su SDK) de la generación vigente; null si no hay ninguna. */
  private abierta(): SesionAgente | null {
    return this.sesion && (this.estado_ === 'escuchando' || this.estado_ === 'hablando') ? this.sesion : null;
  }

  /** ¿Se puede silenciar el micrófono de la llamada sin colgar? Solo con una abierta cuyo SDK lo sepa. */
  puedeSilenciar(): boolean {
    return typeof this.abierta()?.setMicMuted === 'function';
  }

  micSilenciado(): boolean {
    return this.micSilenciado_;
  }

  /** Le cuenta a la interfaz qué sabe hacer la llamada ahora (solo si cambió). */
  private anunciar() {
    const c: ControlesEnVivo = { silenciable: this.puedeSilenciar(), silenciado: this.micSilenciado_ };
    const k = `${c.silenciable}:${c.silenciado}`;
    if (k === this.anunciado) return;
    this.anunciado = k;
    this.d.onControles?.(c);
  }

  /** Silenciar (o volver a escuchar) el micrófono de ESTA sesión, sin colgar. */
  silenciarMic(silenciar: boolean): ResultadoEnVivo {
    const s = this.abierta();
    if (!s) return { ok: false, detalle: 'No hay ninguna conversación en vivo abierta.' };
    if (typeof s.setMicMuted !== 'function') return { ok: false, detalle: 'En vivo no puedo silenciar el micrófono sin colgar.' };
    if (this.micSilenciado_ === silenciar) return { ok: false, detalle: silenciar ? 'El micrófono ya estaba silenciado.' : 'Ya te estaba escuchando.' };
    try {
      s.setMicMuted(silenciar);
    } catch {
      return { ok: false, detalle: 'No pude cambiar el micrófono de la conversación en vivo.' };
    }
    this.micSilenciado_ = silenciar;
    this.anunciar();
    return { ok: true };
  }

  /**
   * Calla lo que la llamada está diciendo AHORA (volumen 0), sin colgar ni silenciar el micrófono. Cuando esa
   * frase termina (o la interrumpen: el modo vuelve a escuchar) el volumen vuelve y la siguiente se oye. Sin
   * llamada, o escuchando, no suena nada de ella: no hay nada que callar.
   */
  callarSalida(): ResultadoEnVivo {
    const s = this.abierta();
    if (!s || this.estado_ !== 'hablando') return { ok: true };
    if (typeof s.setVolume !== 'function') return { ok: false, detalle: 'No puedo callar el audio de la llamada en vivo; si querés, colgá.' };
    try {
      s.setVolume({ volume: 0 });
    } catch {
      return { ok: false, detalle: 'No pude callar el audio de la llamada en vivo.' };
    }
    this.salidaCallada = true;
    return { ok: true };
  }

  /** Terminó la frase que se calló: el volumen vuelve para la siguiente. */
  private devolverSalida() {
    if (!this.salidaCallada) return;
    this.salidaCallada = false;
    try {
      this.sesion?.setVolume?.({ volume: 1 });
    } catch {
      /* la sesión ya no está */
    }
  }

  /** Abre la conversación. Devuelve false (y el porqué en onEstado 'error') si no abrió. */
  async abrir(o: { avatar: string; idioma: 'es' | 'en' }): Promise<boolean> {
    if (this.ocupada()) return true;
    if (!this.registrada) {
      this.registrada = true;
      registrarTrabajoActivo('voz-en-vivo', () => this.ocupada());
    }
    // Lo que hubiera quedado de una sesión anterior se suelta antes de abrir otra: nunca dos micrófonos.
    this.liberar();
    const gen = ++this.gen;
    /** Todo lo que llega de esta apertura pasa por aquí: lo de una terminada (o de otra) no hace nada. */
    const vigente = () => gen === this.gen;
    this.poner(gen, 'conectando');
    const plazo = this.plazos(gen);
    // 1) El permiso del servidor, con su plazo. Si vuelve cuando esta apertura ya venció o la colgaron,
    //    el pase que trae ya no es de nadie: se suelta en el acto (no a los cinco minutos).
    plazo.fase(PERMISO_MAX_MS);
    const pedido = this.d.pedir('/api/voz/agente', { avatar: o.avatar, idioma: o.idioma }).catch(() => ({ ok: false, status: 0, json: null as any }));
    void pedido.then((tarde) => {
      if (!vigente() && tarde.ok && tarde.json?.pase) void this.d.pedir('/api/voz/agente/cerrar', { pase: String(tarde.json.pase) }).catch(() => undefined);
    });
    const r = await plazo.esperar(pedido);
    if (r === VENCIDO || !vigente()) return false;
    if (!r.ok || !r.json?.token || !r.json?.pase) {
      this.terminar('error', porQueNoAbre(r.status, r.json));
      return false;
    }
    const pase = String(r.json.pase);
    this.pase = pase;
    // El motor nuevo, solo si el servidor lo dijo (cuenta con el interruptor): sin eso, las opciones de siempre.
    const motorNuevo = r.json.motor === 'speech-engine';
    const primera = motorNuevo && typeof r.json.primerMensaje === 'string' ? r.json.primerMensaje.trim() : '';
    let vinculada = false;
    /** Ata la conversación de ElevenLabs al pase (una vez): el servidor sabe quién habla aunque no llegue `X-Pase`. */
    const vincular = (id: unknown) => {
      const conversacion = String(id || '');
      if (!motorNuevo || vinculada || !conversacion || !vigente()) return;
      vinculada = true;
      void vincularConReintentos(
        async () => {
          const r = await this.d.pedir('/api/voz/motor/vincular', { pase, conversacion });
          return { status: r.status, json: r.json };
        },
        { sigue: vigente }
      ).then((v) => {
        // El servidor dijo (con su código) que esta llamada no va a hablar como esta cuenta, y ya la cuelga: se
        // termina aquí, diciendo por qué. Lo pasajero no se toma como respuesta (decide el servidor).
        if (vigente() && v.que === 'fin') this.terminar('error', `La llamada en vivo se cerró (${v.motivo}). Abrila de nuevo para seguir.`);
      });
    };
    // 2) Conectar el WebRTC, con su plazo (hasta onConnect). Una sesión que aparece cuando esta apertura
    //    ya no vale se cuelga en cuanto llega.
    plazo.fase(CONECTAR_MAX_MS);
    try {
      const apertura = this.d.abrirSesion({
        conversationToken: String(r.json.token),
        connectionType: 'webrtc',
        dynamicVariables: { pase },
        ...(primera ? { overrides: { agent: { firstMessage: primera } } } : {}),
        onConnect: (p) => {
          if (!vigente()) return;
          vincular(p?.conversationId);
          plazo.listo();
          this.poner(gen, 'escuchando');
          this.anunciar();
        },
        onModeChange: ({ mode }) => {
          if (!vigente()) return;
          // Ya habla o escucha: conectó, aunque el onConnect no haya llegado antes.
          plazo.listo();
          // Terminó la frase (o la interrumpieron): lo que se calló vuelve a sonar para la siguiente.
          if (mode !== 'speaking') this.devolverSalida();
          this.poner(gen, mode === 'speaking' ? 'hablando' : 'escuchando');
          this.anunciar();
        },
        onMessage: (m) => {
          if (!vigente()) return;
          const texto = String(m?.message || '').trim();
          if (texto) this.d.onMensaje(m.source === 'user' ? 'persona' : 'aura', texto);
        },
        onError: (mensaje) => {
          if (!vigente()) return;
          // Con 'error' la mesa vuelve a su micrófono: esta sesión se cuelga ya, no queda abierta al lado.
          this.terminar('error', String(mensaje || 'La conversación se cortó.'));
        },
        onDisconnect: () => {
          // Se cortó sola (ElevenLabs por inactividad, la red): la MISMA terminación que colgar.
          if (!vigente()) return;
          this.terminar('cerrada');
        },
      });
      // Colgaron, venció o terminó mientras conectaba (onError/onDisconnect antes de tener la sesión): cuando
      // la sesión aparezca ya no es de nadie y se cuelga, no queda abierta al lado.
      void apertura.then(
        (tarde) => {
          if (!vigente()) void Promise.resolve(tarde.endSession()).catch(() => undefined);
        },
        () => undefined
      );
      const s = await plazo.esperar(apertura);
      if (s === VENCIDO || !vigente()) return false;
      this.sesion = s;
      if (motorNuevo && !vinculada && typeof s.getId === 'function') {
        try {
          vincular(s.getId());
        } catch {
          /* sin id todavía: lo trajo onConnect o no hace falta (X-Pase) */
        }
      }
      this.anunciar();
      return true;
    } catch (e: any) {
      if (vigente())
        this.terminar(
          'error',
          /permission|notallowed|denied/i.test(String(e?.name || e?.message || e)) ? 'Permití el micrófono en el navegador para hablar en vivo.' : 'No pude abrir la conversación en vivo. Seguimos con el micrófono de siempre.'
        );
      return false;
    }
  }

  /**
   * Cuelga (también una apertura que todavía espera): el botón, «cuelga», salir de la cuenta, desmontar la
   * mesa. Lo que llegue después de la sesión vieja ya no cuenta.
   */
  cerrar() {
    this.terminar('cerrada');
  }

  /**
   * LA terminación (A4): la generación avanza (ningún callback de la sesión terminada vuelve a contar), los
   * plazos se apagan, la sesión se cuelga y su pase se suelta una vez, el micrófono silenciado y la salida
   * callada vuelven a cero, y se avisa el estado final.
   */
  private terminar(final: 'cerrada' | 'error', detalle?: string) {
    this.liberar();
    this.estado_ = final;
    this.d.onEstado(final, detalle);
    this.anunciar();
    avisarTrabajoLibre();
  }

  /**
   * Suelta lo de la sesión que haya, sin avisar estado: la generación avanza siempre (también un permiso que
   * todavía no volvió deja de ser de esta conversación), los plazos se cancelan, la sesión se cuelga y el
   * pase se avisa al servidor.
   */
  private liberar() {
    const s = this.sesion;
    const pase = this.pase;
    this.gen++;
    this.plazo?.cancelar();
    this.sesion = null;
    this.micSilenciado_ = false;
    this.salidaCallada = false;
    if (s) void Promise.resolve(s.endSession()).catch(() => undefined);
    this.avisarCierre(pase);
  }

  private avisarCierre(pase: string) {
    if (!pase || pase !== this.pase) return;
    this.pase = '';
    void this.d.pedir('/api/voz/agente/cerrar', { pase }).catch(() => undefined);
  }
}
