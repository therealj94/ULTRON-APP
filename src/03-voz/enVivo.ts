/**
 * LA CONVERSACIÓN EN VIVO DE LA WEB: el mismo agente de ElevenLabs que usa la app (WebRTC, nuestro
 * cerebro detrás por /api/voz/llm), como el modo voz de ChatGPT. La persona habla y AU-RA contesta
 * de corrido, la interrumpe cuando quiere y no hay un turno de «dictar → esperar → leer frase a frase».
 *
 * El micrófono de siempre (useOido: reconocimiento del navegador + voz frase por frase) sigue siendo el
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

  constructor(private d: DepsEnVivo) {}

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
    let r: { ok: boolean; status: number; json: any };
    try {
      r = await this.d.pedir('/api/voz/agente', { avatar: o.avatar, idioma: o.idioma });
    } catch {
      r = { ok: false, status: 0, json: null };
    }
    if (gen !== this.gen) return false;
    if (!r.ok || !r.json?.token || !r.json?.pase) {
      this.poner(gen, 'error', porQueNoAbre(r.status, r.json));
      return false;
    }
    const pase = String(r.json.pase);
    this.pase = pase;
    try {
      const s = await this.d.abrirSesion({
        conversationToken: String(r.json.token),
        connectionType: 'webrtc',
        dynamicVariables: { pase },
        onConnect: () => this.poner(gen, 'escuchando'),
        onModeChange: ({ mode }) => this.poner(gen, mode === 'speaking' ? 'hablando' : 'escuchando'),
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
      if (gen === this.gen && this.estado_ === 'error') {
        // Falló mientras conectaba (onError antes de tener la sesión): se cuelga, no queda abierta.
        void Promise.resolve(s.endSession()).catch(() => undefined);
        this.avisarCierre(pase);
        return false;
      }
      if (gen !== this.gen) {
        // Colgaron mientras conectaba: esta sesión ya no es de nadie.
        void Promise.resolve(s.endSession()).catch(() => undefined);
        this.avisarCierre(pase);
        return false;
      }
      this.sesion = s;
      return true;
    } catch (e: any) {
      this.avisarCierre(pase);
      this.poner(gen, 'error', /permission|notallowed|denied/i.test(String(e?.name || e?.message || e)) ? 'Permití el micrófono en el navegador para hablar en vivo.' : 'No pude abrir la conversación en vivo. Seguimos con el micrófono de siempre.');
      return false;
    }
  }

  /** Cuelga. Lo que llegue después de la sesión vieja ya no cuenta. */
  cerrar() {
    const s = this.sesion;
    const pase = this.pase;
    this.sesion = null;
    this.gen++;
    this.estado_ = 'cerrada';
    this.d.onEstado('cerrada');
    if (s) void Promise.resolve(s.endSession()).catch(() => undefined);
    this.avisarCierre(pase);
  }

  /** Cuelga la sesión que haya sin tocar el estado (lo que llegue de ella ya no cuenta). */
  private soltarSesion() {
    const s = this.sesion;
    const pase = this.pase;
    if (!s && !pase) return;
    this.sesion = null;
    this.gen++;
    if (s) void Promise.resolve(s.endSession()).catch(() => undefined);
    this.avisarCierre(pase);
  }

  private avisarCierre(pase: string) {
    if (!pase || pase !== this.pase) return;
    this.pase = '';
    void this.d.pedir('/api/voz/agente/cerrar', { pase }).catch(() => undefined);
  }
}
