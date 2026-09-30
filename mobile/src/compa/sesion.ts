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
 *    silenciada o no). Si la llamada termina con la app DETRÁS, no se reabre: se queda cerrada, como
 *    al pasar a segundo plano (antes volvía a abrir ElevenLabs con el micrófono en segundo plano).
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
  /** «Conectando…» más de esto sin conectar cuenta como fallo (CONECTAR_MAX_MS). */
  conectarMaxMs?: number;
  /** Abierta y sin silencio, sin nada del micrófono en este rato: no le llega la voz (SORDA_MS). */
  sordaMs?: number;
};

export const SILENCIO_CIERRA_MS = 3 * 60_000;
/**
 * Lo más que puede quedarse «Conectando…». Antes no había tope: si la conexión no terminaba nunca, la
 * sesión seguía «montada» para siempre, el audio seguía siendo suyo y NADIE más escuchaba (la mesa y
 * la compañera le ceden el micrófono a la conversación). Fallar aquí hace el reintento de siempre y,
 * si tampoco, suelta el audio: el oído del teléfono vuelve.
 */
export const CONECTAR_MAX_MS = 12_000;
/**
 * Conectada, sin silencio, y en todo este rato ni una muestra del micrófono por encima del piso
 * (UMBRAL_ENTRADA) ni una frase de la persona: el micrófono de WebRTC no le llega (otro lo tiene, el
 * sistema lo silenció). Se trata como un fallo al abrir y el audio vuelve al oído del teléfono.
 */
export const SORDA_MS = 15_000;
/** Un micrófono vivo nunca da un cero perfecto (ruido de fondo): por debajo de esto es que no llega nada. */
export const UMBRAL_ENTRADA = 0.0005;

export class ControlSesion {
  private v: VistaSesion;
  private oyentes = new Set<(v: VistaSesion) => void>();
  private silencioDesde = 0;
  /** Cómo estaba al empezar la llamada. */
  private alColgar: { montada: boolean; silenciada: boolean; dormida: boolean } | null = null;
  private reloj: () => number;
  private silencioCierraMs: number;
  private reintentos: number;
  private conectarMaxMs: number;
  private sordaMs: number;
  /** Desde cuándo está «conectando» la generación vigente. */
  private conectandoDesde = 0;
  /** Desde cuándo escucha sin silencio (0: no escucha o está silenciada). */
  private oyendoDesde = -1;
  /** Le llegó algo del micrófono (o una frase de la persona) en esta generación. */
  private oyoAlgo = false;

  constructor(avatar: AvatarId, idioma: Idioma, o: Opciones = {}) {
    this.reloj = o.reloj || Date.now;
    this.silencioCierraMs = o.silencioCierraMs ?? SILENCIO_CIERRA_MS;
    this.reintentos = o.reintentos ?? 1;
    this.conectarMaxMs = o.conectarMaxMs ?? CONECTAR_MAX_MS;
    this.sordaMs = o.sordaMs ?? SORDA_MS;
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
    const antes = this.v;
    this.v = n;
    this.anotarPlazos(antes, n);
    for (const f of [...this.oyentes]) f(n);
  }

  /** Los relojes del vigilante: desde cuándo conecta y desde cuándo escucha sin silencio. */
  private anotarPlazos(antes: VistaSesion, n: VistaSesion) {
    const ahora = this.reloj();
    if (n.gen !== antes.gen) {
      this.oyoAlgo = false;
      this.oyendoDesde = -1;
    }
    if (n.montada && n.estado === 'conectando' && (n.gen !== antes.gen || antes.estado !== 'conectando' || !antes.montada)) this.conectandoDesde = ahora;
    const oyendo = n.montada && !n.silenciada && (n.estado === 'escuchando' || n.estado === 'hablando');
    if (!oyendo) this.oyendoDesde = -1;
    else if (this.oyendoDesde < 0) this.oyendoDesde = ahora;
  }

  /** El volumen del micrófono de la conversación (0..1, ~20 Hz). */
  entrada(nivel: number) {
    if (nivel > UMBRAL_ENTRADA && this.v.montada) this.oyoAlgo = true;
  }

  /** La conversación entendió una frase de la persona: le llega la voz. */
  oyoFrase() {
    if (this.v.montada) this.oyoAlgo = true;
  }

  /**
   * El vigilante de la conversación (cada segundo): «Conectando…» sin tope, o abierta y sin que le
   * llegue nada del micrófono, cuentan como un fallo al abrir (reintento y, si tampoco, se suelta el
   * audio). Devuelve lo que hizo.
   */
  revisar(): 'nada' | 'no-conecto' | 'sorda' {
    const v = this.v;
    if (!v.montada || v.suspendida) return 'nada';
    const ahora = this.reloj();
    if (v.estado === 'conectando' && ahora - this.conectandoDesde >= this.conectarMaxMs) {
      this.alEstado(v.gen, 'error', 'no conectó a tiempo');
      return 'no-conecto';
    }
    if (this.oyendoDesde >= 0 && !this.oyoAlgo && ahora - this.oyendoDesde >= this.sordaMs) {
      // Sin reintento: la persona ya lleva un rato hablándole a nadie. El audio vuelve al oído del
      // teléfono en el acto (y se le dice por qué).
      this.poner({ montada: false, estado: 'error', silenciada: false, intento: 0, detalle: 'no llegó audio del micrófono' });
      return 'sorda';
    }
    return 'nada';
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

  /**
   * Silenciado SIN sesión (el modo llamada en espera recibe un doble toque, o se silenció mucho rato):
   * nadie escucha, ni la sesión ni el oído del teléfono (vozOcupaMicrofono: dormida). Despertar la reabre.
   */
  dormir() {
    if (this.v.suspendida) return;
    this.poner({ montada: false, estado: 'cerrada', silenciada: true, dormida: true, intento: 0 });
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

  /**
   * La acción `silencio` de AURA, con lo que de verdad pasó (el `hecho` lo cuenta tal cual: un
   * «cállate» sin conversación abierta no es un «listo»).
   */
  aplicarSilencio(valor: boolean): { ok: boolean; detalle?: string } {
    const v = this.v;
    if (valor) {
      if (v.suspendida) return { ok: false, detalle: 'Hay una llamada en curso: AURA ya está apagada.' };
      if (!v.montada) return { ok: false, detalle: 'No hay conversación abierta que silenciar.' };
      if (v.silenciada) return { ok: false, detalle: 'Ya estaba en silencio.' };
      this.silenciar(true);
      return { ok: this.v.silenciada };
    }
    if (v.suspendida) return { ok: false, detalle: 'Hay una llamada en curso: AURA vuelve al colgar.' };
    if (v.montada && !v.silenciada && v.estado !== 'error') return { ok: false, detalle: 'Ya estaba escuchando.' };
    this.silenciar(false);
    return this.v.montada && !this.v.silenciada ? { ok: true } : { ok: false, detalle: 'No se pudo abrir la conversación.' };
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

  /**
   * Empezó o terminó una llamada (voz o video). `enPrimerPlano` (al terminar): si la app está detrás,
   * la conversación NO se reabre (nada de micrófono ni minutos de ElevenLabs en segundo plano); queda
   * cerrada, igual que si se hubiera ido a segundo plano sin llamada.
   */
  llamada(activa: boolean, enPrimerPlano = true) {
    if (activa) {
      if (this.v.suspendida) return;
      this.alColgar = { montada: this.v.montada, silenciada: this.v.silenciada, dormida: this.v.dormida };
      this.poner({ suspendida: true, montada: false, estado: 'cerrada', intento: 0 });
      return;
    }
    if (!this.v.suspendida) return;
    const antes = this.alColgar || { montada: false, silenciada: false, dormida: false };
    this.alColgar = null;
    if (!enPrimerPlano) {
      this.poner({ suspendida: false, montada: false, estado: 'cerrada', silenciada: false, dormida: false, intento: 0 });
      return;
    }
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
