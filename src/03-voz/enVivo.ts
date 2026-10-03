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
 */

export type EstadoEnVivo = 'cerrada' | 'conectando' | 'escuchando' | 'hablando' | 'error';

/** Lo poco del SDK (@elevenlabs/client, Conversation) que se usa aquí. */
export type SesionAgente = { endSession: () => Promise<void> | void };
export type OpcionesSesion = {
  conversationToken: string;
  connectionType: 'webrtc';
  dynamicVariables: Record<string, string>;
  onConnect?: () => void;
  onDisconnect?: () => void;
  onError?: (mensaje: string) => void;
  onModeChange?: (m: { mode: string }) => void;
  onMessage?: (m: { message: string; source: string }) => void;
};

export type DepsEnVivo = {
  /** Conversation.startSession del SDK (se carga solo al abrir: no pesa en la primera pantalla). */
  abrirSesion: (o: OpcionesSesion) => Promise<SesionAgente>;
  /** fetch con la sesión de la mesa (headersMesa). */
  pedir: (ruta: string, cuerpo: unknown) => Promise<{ ok: boolean; status: number; json: any }>;
  onEstado: (e: EstadoEnVivo, detalle?: string) => void;
  onMensaje: (quien: 'persona' | 'aura', texto: string) => void;
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
  /** Cada apertura es una generación: lo que llegue de una vieja no toca el estado. */
  private gen = 0;
  private estado_: EstadoEnVivo = 'cerrada';
  /** Los plazos de la apertura en curso (null: no hay ninguna conectando). */
  private plazo: Plazos | null = null;

  constructor(private d: DepsEnVivo) {}

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
      this.vencio(gen);
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

  /** Venció un plazo de la apertura `gen`: error recuperable y lo de esa apertura se suelta. */
  private vencio(gen: number) {
    if (gen !== this.gen) return;
    this.poner(gen, 'error', NO_CONECTO);
    this.soltarSesion();
  }

  estado(): EstadoEnVivo {
    return this.estado_;
  }

  private poner(gen: number, e: EstadoEnVivo, detalle?: string) {
    if (gen !== this.gen) return;
    this.estado_ = e;
    this.d.onEstado(e, detalle);
  }

  /** Abre la conversación. Devuelve false (y el porqué en onEstado 'error') si no abrió. */
  async abrir(o: { avatar: string; idioma: 'es' | 'en' }): Promise<boolean> {
    if (this.estado_ === 'conectando' || this.estado_ === 'escuchando' || this.estado_ === 'hablando') return true;
    // Una sesión que quedó de un error se cuelga antes de abrir otra: nunca dos micrófonos.
    this.soltarSesion();
    const gen = ++this.gen;
    this.poner(gen, 'conectando');
    const plazo = this.plazos(gen);
    // 1) El permiso del servidor, con su plazo. Si vuelve cuando esta apertura ya venció o la colgaron,
    //    el pase que trae ya no es de nadie: se suelta en el acto (no a los cinco minutos).
    plazo.fase(PERMISO_MAX_MS);
    const pedido = this.d.pedir('/api/voz/agente', { avatar: o.avatar, idioma: o.idioma }).catch(() => ({ ok: false, status: 0, json: null as any }));
    void pedido.then((tarde) => {
      if (gen !== this.gen && tarde.ok && tarde.json?.pase) void this.d.pedir('/api/voz/agente/cerrar', { pase: String(tarde.json.pase) }).catch(() => undefined);
    });
    const r = await plazo.esperar(pedido);
    if (r === VENCIDO || gen !== this.gen) return false;
    if (!r.ok || !r.json?.token || !r.json?.pase) {
      plazo.listo();
      this.poner(gen, 'error', porQueNoAbre(r.status, r.json));
      return false;
    }
    const pase = String(r.json.pase);
    this.pase = pase;
    // 2) Conectar el WebRTC, con su plazo (hasta onConnect). Una sesión que aparece cuando esta apertura
    //    ya no vale se cuelga en cuanto llega.
    plazo.fase(CONECTAR_MAX_MS);
    try {
      const apertura = this.d.abrirSesion({
        conversationToken: String(r.json.token),
        connectionType: 'webrtc',
        dynamicVariables: { pase },
        onConnect: () => {
          if (gen !== this.gen) return;
          plazo.listo();
          this.poner(gen, 'escuchando');
        },
        onModeChange: ({ mode }) => {
          if (gen !== this.gen) return;
          // Ya habla o escucha: conectó, aunque el onConnect no haya llegado antes.
          plazo.listo();
          this.poner(gen, mode === 'speaking' ? 'hablando' : 'escuchando');
        },
        onMessage: (m) => {
          const texto = String(m?.message || '').trim();
          if (texto && gen === this.gen) this.d.onMensaje(m.source === 'user' ? 'persona' : 'aura', texto);
        },
        onError: (mensaje) => {
          if (gen !== this.gen) return;
          this.poner(gen, 'error', String(mensaje || 'La conversación se cortó.'));
          // Con 'error' la mesa vuelve a su micrófono: esta sesión se cuelga ya, no queda abierta al lado.
          this.soltarSesion();
        },
        onDisconnect: () => {
          if (gen !== this.gen) return;
          this.avisarCierre(pase);
          this.sesion = null;
          this.poner(gen, 'cerrada');
        },
      });
      // Colgaron, venció o falló mientras conectaba (onError antes de tener la sesión): cuando la sesión
      // aparezca ya no es de nadie y se cuelga, no queda abierta al lado.
      void apertura.then(
        (tarde) => {
          if (gen !== this.gen) void Promise.resolve(tarde.endSession()).catch(() => undefined);
        },
        () => undefined
      );
      const s = await plazo.esperar(apertura);
      if (s === VENCIDO || gen !== this.gen) return false;
      this.sesion = s;
      return true;
    } catch (e: any) {
      plazo.listo();
      this.avisarCierre(pase);
      this.poner(gen, 'error', /permission|notallowed|denied/i.test(String(e?.name || e?.message || e)) ? 'Permití el micrófono en el navegador para hablar en vivo.' : 'No pude abrir la conversación en vivo. Seguimos con el micrófono de siempre.');
      return false;
    }
  }

  /** Cuelga (también una apertura que todavía espera). Lo que llegue después de la sesión vieja ya no cuenta. */
  cerrar() {
    const s = this.sesion;
    const pase = this.pase;
    this.sesion = null;
    this.gen++;
    this.plazo?.cancelar();
    this.estado_ = 'cerrada';
    this.d.onEstado('cerrada');
    if (s) void Promise.resolve(s.endSession()).catch(() => undefined);
    this.avisarCierre(pase);
  }

  /**
   * Cuelga la sesión que haya sin tocar el estado (lo que llegue de ella ya no cuenta). La generación
   * avanza siempre: también un permiso que todavía no volvió deja de ser de esta conversación.
   */
  private soltarSesion() {
    const s = this.sesion;
    const pase = this.pase;
    this.gen++;
    this.plazo?.cancelar();
    if (!s && !pase) return;
    this.sesion = null;
    if (s) void Promise.resolve(s.endSession()).catch(() => undefined);
    this.avisarCierre(pase);
  }

  private avisarCierre(pase: string) {
    if (!pase || pase !== this.pase) return;
    this.pase = '';
    void this.d.pedir('/api/voz/agente/cerrar', { pase }).catch(() => undefined);
  }
}
