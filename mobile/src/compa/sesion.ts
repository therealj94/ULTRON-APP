/**
 * El control de la conversación fluida: cuándo se abre, se cierra, se silencia y se reabre.
 *
 * Es la máquina que antes vivía repartida en DeskScreen y ModoConversacion, y que fallaba así:
 *  · M4: cambiar de avatar o de idioma, o reabrir rápido, dejaba la sesión cerrada o pegada en
 *    «Conectando…». El ConversationProvider del SDK guarda un candado (`lockRef`) mientras conecta y
 *    descarta en silencio cualquier `startSession` que llegue antes de que se suelte. Aquí cada
 *    arranque es una GENERACIÓN: la sesión se monta con `key={gen}` (un proveedor nuevo, sin candado
 *    viejo) y lo que avise una generación anterior se ignora.
 *  · M5: al pasar a segundo plano la sesión seguía abierta (micrófono y minutos de ElevenLabs). Ahora
 *    se cierra.
 *  · Llamadas: una llamada la cierra y al colgar vuelve exactamente como estaba (abierta o no,
 *    silenciada o no).
 *
 * Silenciar (doble toque a la compañera, «cállate», el botón del micrófono) corta el micrófono y la
 * voz AL INSTANTE sin cerrar la sesión, así al despertarla escucha de inmediato. Si pasa mucho rato
 * silenciada (3 min) la sesión se cierra para no gastar; despertarla entonces la reabre.
 *
 * Sin React ni React Native: el VozProvider lo conecta y las pruebas lo usan en Node.
 */
import type { AvatarId } from '../avatares/catalogo';
import type { Idioma } from '../i18n';

export type EstadoVoz = 'cerrada' | 'conectando' | 'escuchando' | 'hablando' | 'error';

export type VistaSesion = {
  /** La generación vigente: la sesión se monta con esta `key`. */
  gen: number;
  /** Hay que tener montada la sesión (conectando o abierta). */
  montada: boolean;
  estado: EstadoVoz;
  /** Micrófono y voz apagados (la sesión puede seguir abierta). */
  silenciada: boolean;
  /** Se cerró por llevar mucho rato silenciada: despertarla la reabre. */
  dormida: boolean;
  /** Hay una llamada: nada se abre hasta colgar. */
  suspendida: boolean;
  avatar: AvatarId;
  idioma: Idioma;
  /** 0 el primer intento; 1 el reintento (con permiso nuevo). */
  intento: number;
  detalle?: string;
};

export type Opciones = {
  reloj?: () => number;
  /** Silenciada más de esto, la sesión se cierra (se reabre al despertarla). */
  silencioCierraMs?: number;
  /** Reintentos automáticos si falla al abrir. */
  reintentos?: number;
};

export const SILENCIO_CIERRA_MS = 3 * 60_000;

export class ControlSesion {
  private v: VistaSesion;
  private oyentes = new Set<(v: VistaSesion) => void>();
  private silencioDesde = 0;
  /** Cómo estaba al empezar la llamada. */
  private alColgar: { montada: boolean; silenciada: boolean; dormida: boolean } | null = null;
  private reloj: () => number;
  private silencioCierraMs: number;
  private reintentos: number;

  constructor(avatar: AvatarId, idioma: Idioma, o: Opciones = {}) {
    this.reloj = o.reloj || Date.now;
    this.silencioCierraMs = o.silencioCierraMs ?? SILENCIO_CIERRA_MS;
    this.reintentos = o.reintentos ?? 1;
    this.v = { gen: 0, montada: false, estado: 'cerrada', silenciada: false, dormida: false, suspendida: false, avatar, idioma, intento: 0 };
  }

  vista(): VistaSesion {
    return this.v;
  }

  suscribir(f: (v: VistaSesion) => void): () => void {
    this.oyentes.add(f);
    return () => {
      this.oyentes.delete(f);
    };
  }

  private poner(cambio: Partial<VistaSesion>) {
    const n = { ...this.v, ...cambio };
    if (!('detalle' in cambio)) delete n.detalle;
    const igual = (Object.keys(n) as (keyof VistaSesion)[]).every((k) => n[k] === this.v[k]) && Object.keys(this.v).length === Object.keys(n).length;
    if (igual) return;
    this.v = n;
    for (const f of [...this.oyentes]) f(n);
  }

  /** Una generación nueva: la sesión anterior (si había) se desmonta y se monta otra limpia. */
  private abrir(cambio: Partial<VistaSesion> = {}) {
    this.poner({ gen: this.v.gen + 1, montada: true, estado: 'conectando', intento: 0, dormida: false, ...cambio });
  }

  /** Abrir la conversación. En una llamada no se abre (queda anotado para cuando cuelgue). */
  iniciar(): boolean {
    if (this.v.suspendida) {
      if (this.alColgar) this.alColgar = { montada: true, silenciada: false, dormida: false };
      return false;
    }
    if (this.v.montada && this.v.estado !== 'error') {
      if (this.v.silenciada) this.silenciar(false);
      return true;
    }
    this.abrir({ silenciada: false });
    return true;
  }

  terminar() {
    if (this.v.suspendida && this.alColgar) this.alColgar = { montada: false, silenciada: false, dormida: false };
    this.poner({ montada: false, estado: 'cerrada', silenciada: false, dormida: false, intento: 0 });
  }

  alternar() {
    if (this.v.montada) this.terminar();
    else this.iniciar();
  }

  /**
   * Silenciar o despertar. Despertar sin sesión la abre (el doble toque que la despierta también la
   * pone a escuchar); silenciar sin sesión no hace nada (ya está callada).
   */
  silenciar(valor: boolean) {
    if (valor) {
      if (!this.v.montada || this.v.silenciada) return;
      this.silencioDesde = this.reloj();
      this.poner({ silenciada: true });
      return;
    }
    if (this.v.montada) {
      if (this.v.silenciada) this.poner({ silenciada: false });
      return;
    }
    this.iniciar();
  }

  /** El doble toque a la compañera: la duerme si está despierta y la despierta (y escucha) si no. */
  despertarOSilenciar(): 'despierta' | 'duerme' | 'nada' {
    if (this.v.suspendida) return 'nada';
    if (this.v.montada && !this.v.silenciada && this.v.estado !== 'error') {
      this.silenciar(true);
      return 'duerme';
    }
    this.silenciar(false);
    return 'despierta';
  }

  /** Lo que avisa la sesión montada. Lo de una generación vieja no cuenta. */
  alEstado(gen: number, e: EstadoVoz, detalle?: string) {
    if (gen !== this.v.gen || !this.v.montada) return;
    if (e === 'error') {
      if (this.v.intento < this.reintentos) {
        this.poner({ gen: this.v.gen + 1, estado: 'conectando', intento: this.v.intento + 1, detalle });
        return;
      }
      this.poner({ montada: false, estado: 'error', silenciada: false, intento: 0, detalle });
      return;
    }
    if (e === 'cerrada') {
      // La cerró el otro lado (ElevenLabs por inactividad, la red). Silenciada, queda dormida.
      const dormida = this.v.silenciada;
      this.poner({ montada: false, estado: 'cerrada', intento: 0, dormida, silenciada: dormida });
      return;
    }
    this.poner({ estado: e, ...(e === 'escuchando' || e === 'hablando' ? { intento: 0 } : {}) });
  }

  /** Empezó o terminó una llamada (voz o video). */
  llamada(activa: boolean) {
    if (activa) {
      if (this.v.suspendida) return;
      this.alColgar = { montada: this.v.montada, silenciada: this.v.silenciada, dormida: this.v.dormida };
      this.poner({ suspendida: true, montada: false, estado: 'cerrada', intento: 0 });
      return;
    }
    if (!this.v.suspendida) return;
    const antes = this.alColgar || { montada: false, silenciada: false, dormida: false };
    this.alColgar = null;
    if (antes.montada) {
      if (antes.silenciada) this.silencioDesde = this.reloj();
      this.abrir({ suspendida: false, silenciada: antes.silenciada });
    } else this.poner({ suspendida: false, dormida: antes.dormida, silenciada: antes.dormida });
  }

  /** La app se fue al segundo plano: la sesión se cierra (M5). Al volver no se reabre sola. */
  segundoPlano() {
    if (this.v.suspendida) return;
    if (this.v.montada || this.v.dormida) this.poner({ montada: false, estado: 'cerrada', silenciada: false, dormida: false, intento: 0 });
  }

  /** Cambió el avatar o el idioma: con la sesión abierta, se reabre con la voz nueva. */
  perfil(avatar: AvatarId, idioma: Idioma) {
    if (avatar === this.v.avatar && idioma === this.v.idioma) return;
    if (this.v.montada) this.abrir({ avatar, idioma, silenciada: this.v.silenciada });
    else this.poner({ avatar, idioma });
  }

  /** El reloj: silenciada demasiado rato → se cierra y queda dormida. */
  tic() {
    if (this.v.montada && this.v.silenciada && this.reloj() - this.silencioDesde >= this.silencioCierraMs) {
      this.poner({ montada: false, estado: 'cerrada', dormida: true, intento: 0 });
    }
  }
}
