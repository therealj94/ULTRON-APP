/**
 * El permiso de la conversación fluida, pedido ANTES de que haga falta.
 *
 * Abrir una conversación son dos esperas: pedirle a nuestro servidor el permiso de un solo uso
 * (POST /api/voz/agente → token de ElevenLabs + pase firmado de quién habla) y conectar el WebRTC. La
 * primera se adelanta mientras SUENA la llamada del avatar (toda conversación empieza sonando): cuando
 * la persona contesta, el permiso ya está en la mano y solo falta conectar. Antes también al entrar, al
 * volver a la app y al tocar a la compañera, y cada vez el servidor calentaba el nodo sin ninguna llamada.
 *
 * El token sirve UNA vez y vence (se guarda 4 minutos, bastante menos de lo que dura en ElevenLabs);
 * al tomarlo se gasta. El pase dura 30 minutos en el servidor.
 *
 * Sin React Native: `pedir` se inyecta (en la app es `api()`), así las pruebas lo usan en Node.
 */
import type { AvatarId } from '../avatares/catalogo';
import type { Idioma } from '../i18n';

/** `cid`: el id de la conversación en el servidor (lo devuelve /api/voz/agente desde la 5.0). */
/** `restanteMs`: lo que le queda de voz hoy a un miembro (el servidor lo manda; la junta, sin tope). */
/**
 * `motor` y `primerMensaje`: solo si el servidor abrió el motor nuevo de la llamada (prototipo de Speech Engine,
 * docs/voz/SPEECH-ENGINE.md, una cuenta con el interruptor). Sin ellos, todo como siempre.
 */
export type Permiso = { token: string; pase: string; cid?: string; restanteMs?: number; motor?: 'speech-engine'; primerMensaje?: string; avatar: AvatarId; idioma: Idioma; en: number };
export type PedirPermiso = (avatar: AvatarId, idioma: Idioma) => Promise<{ token: string; pase: string; cid?: string; restanteMs?: number; motor?: string; primerMensaje?: string }>;

export const VIDA_PERMISO_MS = 4 * 60_000;

const clave = (a: AvatarId, i: Idioma) => `${a}|${i}`;

export class Precalentador {
  private guardado: Permiso | null = null;
  private enCurso = new Map<string, Promise<Permiso>>();
  /** Los que ya se usaron: un precalentado que llega tarde no puede guardar uno gastado. */
  private gastados = new WeakSet<Permiso>();

  constructor(
    private pedir: PedirPermiso,
    private vida = VIDA_PERMISO_MS,
    private reloj: () => number = Date.now
  ) {}

  private fresco(a: AvatarId, i: Idioma): Permiso | null {
    const g = this.guardado;
    if (!g || g.avatar !== a || g.idioma !== i) return null;
    if (this.reloj() - g.en > this.vida) {
      this.guardado = null;
      return null;
    }
    return g;
  }

  private traer(a: AvatarId, i: Idioma): Promise<Permiso> {
    const k = clave(a, i);
    const ya = this.enCurso.get(k);
    if (ya) return ya;
    const p = this.pedir(a, i)
      .then((r) => {
        if (!r?.token || !r?.pase) throw new Error('el servidor no dio permiso de voz');
        return {
          token: r.token,
          pase: r.pase,
          ...(r.cid ? { cid: String(r.cid) } : {}),
          ...(Number.isFinite(r.restanteMs) ? { restanteMs: Number(r.restanteMs) } : {}),
          ...(r.motor === 'speech-engine' ? { motor: 'speech-engine' as const } : {}),
          ...(r.motor === 'speech-engine' && typeof r.primerMensaje === 'string' && r.primerMensaje.trim() ? { primerMensaje: r.primerMensaje.trim() } : {}),
          avatar: a,
          idioma: i,
          en: this.reloj(),
        };
      })
      .finally(() => this.enCurso.delete(k));
    this.enCurso.set(k, p);
    return p;
  }

  /** ¿Hay uno listo para este avatar e idioma? */
  listo(a: AvatarId, i: Idioma): boolean {
    return !!this.fresco(a, i);
  }

  /** Deja uno listo (sin esperar ni molestar si falla: se pedirá otra vez al tomarlo). */
  precalentar(a: AvatarId, i: Idioma): Promise<void> {
    if (this.fresco(a, i)) return Promise.resolve();
    return this.traer(a, i).then(
      (p) => {
        // Si mientras tanto se pidió otro avatar, este no estorba: el guardado es el último que llegó.
        if (!this.gastados.has(p)) this.guardado = p;
      },
      () => {}
    );
  }

  /**
   * El permiso para abrir YA. Se gasta: el siguiente se pide de nuevo. `nuevo` salta el guardado
   * (reintento después de un fallo al conectar: el guardado pudo ser el culpable).
   */
  async tomar(a: AvatarId, i: Idioma, nuevo = false): Promise<Permiso> {
    const g = nuevo ? null : this.fresco(a, i);
    if (g) {
      this.guardado = null;
      this.gastados.add(g);
      return g;
    }
    if (nuevo) this.guardado = null;
    const p = await this.traer(a, i);
    this.gastados.add(p);
    if (this.guardado === p) this.guardado = null;
    return p;
  }

  olvidar() {
    this.guardado = null;
  }
}
