/**
 * LA MESA MIENTRAS TRABAJA (compa/narrador.ts en el teléfono): con cada `event: progreso` del turno (lib/api.ts
 * `onProgreso`) la mesa
 *  · enseña UNA línea suave que cambia en su lugar («Revisando tu correo…» → «Encontré 2 de Ana») y se va con la
 *    respuesta (`alLinea('')`);
 *  · dice, con la voz del avatar, un comentario corto de lo que de verdad está pasando (el narrador decide qué y cuándo)
 *    SOLO si nada más suena ni sonó en este turno: el relleno («déjame ver…») o el principio de la respuesta ya son la
 *    voz del turno, y un `speak` encima cortaría el locutor de la respuesta (tts.ts: misma generación);
 *  · corta lo pendiente en cuanto llega texto de la respuesta (`respuesta()`): lo que todavía no suena no suena; lo que
 *    ya suena termina su frase y el locutor de la respuesta espera (como el relleno, lib/relleno.ts). Desde ahí el
 *    narrador ya no habla en el turno; la LÍNEA sí vuelve si después empieza otra herramienta (el modelo dijo «déjame
 *    ver» y luego buscó). `terminar()` (el turno cerró, bien, mal o cancelado) lo apaga todo;
 *  · pone el sonido de trabajo (tecleo, papel; assets/sfx, compa/ambiente.ts) mientras corre una herramienta, solo si
 *    `sonido()` lo permite: con el micrófono abierto de la mesa, el tecleo lo oiría el propio oído (no hay cancelación
 *    de eco fuera de la conversación), así que DeskScreen solo lo deja con el micrófono en silencio. Ese es el gancho.
 *
 * Sin React Native: la voz, el sonido y la línea entran por `deps` (DeskScreen; pruebas en compa.prueba.mjs).
 */
import { ConductorNarrador, MemoriaNarrador, Narrador, lineaDePantalla, type EventoProgreso, type HerramientaProgreso } from './narrador';
import type { SonidoAmbiente } from './frasesEstado';

/** El sonido de trabajo de cada herramienta (los mismos de la conversación: compa/frasesEstado.ts TAREAS). */
export const SONIDO_DE_TRABAJO: Record<HerramientaProgreso, SonidoAmbiente | null> = {
  web: 'teclado',
  leer: 'papel',
  correo: 'teclado',
  whatsapp: 'teclado',
  computadora: 'teclado',
  trabajo: 'papel',
};

export type DepsTrabajoMesa = {
  avatar: string;
  idioma: 'es' | 'en';
  /** La de la sesión de la mesa: ninguna frase se repite entre turnos. */
  memoria: MemoriaNarrador;
  /** ¿Puede hablar la mesa ahora? (nada suena, el turno no se canceló, no es la conversación en vivo ni una llamada). */
  puedeHablar: () => boolean;
  /** Dice el comentario; `corte` se cumple cuando llega la respuesta (lo que no sonó no suena). */
  hablar: (texto: string, corte: Promise<void>) => void;
  /** La línea suave de la mesa ('' = quitarla). */
  alLinea: (linea: string) => void;
  /** El sonido de trabajo (null: sin sonido). */
  ambiente?: { poner: (s: SonidoAmbiente) => void; quitar: () => void } | null;
  /** ¿Puede sonar el tecleo ahora? (el gancho: la mesa lo deja solo con su micrófono en silencio). */
  sonido?: () => boolean;
  ahora?: () => number;
  setTimeout?: (f: () => void, ms: number) => unknown;
  clearTimeout?: (h: unknown) => void;
};

export class TrabajoMesa {
  private conductor: ConductorNarrador;
  private soltarCorte: (() => void) | null = null;
  private corte: Promise<void>;
  private sonando: SonidoAmbiente | null = null;
  /** Ya llegó texto de la respuesta: el narrador no habla más en este turno (la línea sí sigue lo que pase). */
  private hablo = false;
  private cerrado = false;
  /** Lo que el narrador dijo en este turno (para la traza y las pruebas). */
  readonly dichos: string[] = [];

  constructor(private d: DepsTrabajoMesa) {
    this.corte = new Promise<void>((r) => (this.soltarCorte = r));
    this.conductor = new ConductorNarrador(new Narrador({ avatar: d.avatar, idioma: d.idioma, memoria: d.memoria }), {
      puede: () => !this.cerrado && !this.hablo && d.puedeHablar(),
      decir: (t) => {
        this.dichos.push(t);
        d.hablar(t, this.corte);
      },
      ahora: d.ahora,
      setTimeout: d.setTimeout,
      clearTimeout: d.clearTimeout,
    });
  }

  /** Un evento de progreso del turno. */
  evento(ev: EventoProgreso) {
    if (this.cerrado) return;
    this.d.alLinea(lineaDePantalla(ev, this.d.idioma));
    if (this.hablo) return;
    this.conductor.evento(ev);
    if (ev.fase === 'empece' || (ev.fase === 'paso' && ev.herramienta === 'computadora')) this.ponerSonido(SONIDO_DE_TRABAJO[ev.herramienta]);
    else this.quitarSonido();
  }

  /** Sonó otra cosa del turno (el relleno, el principio de la respuesta): cuenta para el ritmo. */
  yaSeDijo() {
    if (!this.cerrado) this.conductor.yaSeDijo();
  }

  /** Llegó texto de la respuesta: el narrador se calla en este turno, lo pendiente no suena y la línea se va. */
  respuesta() {
    if (this.cerrado) return;
    this.hablo = true;
    this.conductor.respuesta();
    this.soltarCorte?.();
    this.soltarCorte = null;
    this.quitarSonido();
    this.d.alLinea('');
  }

  /** El turno terminó (bien, mal o cancelado): todo apagado; lo que llegue tarde no hace nada. */
  terminar() {
    if (this.cerrado) return;
    this.respuesta();
    this.cerrado = true;
  }

  private ponerSonido(s: SonidoAmbiente | null) {
    if (!s || !this.d.ambiente || !(this.d.sonido?.() ?? false)) return this.quitarSonido();
    if (this.sonando === s) return;
    this.sonando = s;
    try {
      this.d.ambiente.poner(s);
    } catch {
      /* sin sonido, sigue igual */
    }
  }

  private quitarSonido() {
    if (!this.sonando) return;
    this.sonando = null;
    try {
      this.d.ambiente?.quitar();
    } catch {
      /* ya no sonaba */
    }
  }
}
