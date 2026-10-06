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
 *  · pone el SONIDO DE TRABAJO (José, 6-oct: «si está haciendo o pensando algo que se escuchen cosas como eso del
 *    teclado, tanto con el avatar como en la llamada»; compa/sonidosTrabajo.ts) por señales reales del turno:
 *      - mientras corre una herramienta (su `progreso`): tecleo al buscar o escribir, papel al leer, clics en su
 *        computadora;
 *      - con `pensando`, mientras el turno sigue sin decir nada pasados PENSANDO_DESDE_MS (lo rápido no lo oye): el
 *        murmullo suave;
 *      - se va en cuanto AU-RA habla (el relleno, un comentario: `vozEmpieza`; vuelve con `vozTermina` si sigue el
 *        trabajo), en cuanto llega la respuesta, en cuanto la persona habla (`personaHabla`: ya no vuelve en el turno) y
 *        a los MAX_SONIDO_MS de cada sonido (no se queda en bucle);
 *      - solo si `sonido()` lo deja (DeskScreen: efectos, su ajuste y el servidor; y el oído: con el micrófono abierto,
 *        solo si oye con el cancelador de eco). Mientras suena, `alFondo(true)`: el oído sube su umbral (oye a la persona,
 *        no al tecleo que se cuela).
 *
 * Sin React Native: la voz, el sonido y la línea entran por `deps` (DeskScreen; pruebas en compa.prueba.mjs y
 * mobile/pruebas/sonidos).
 */
import { ConductorNarrador, MemoriaNarrador, Narrador, lineaDePantalla, type EventoProgreso, type HerramientaProgreso } from './narrador';
import type { SonidoAmbiente } from './frasesEstado';
import { MAX_SONIDO_MS, PENSANDO_DESDE_MS } from './sonidosTrabajo';

/** El sonido de trabajo de cada herramienta (los mismos de la conversación: compa/frasesEstado.ts TAREAS). */
export const SONIDO_DE_TRABAJO: Record<HerramientaProgreso, SonidoAmbiente | null> = {
  web: 'teclado',
  leer: 'papel',
  correo: 'teclado',
  whatsapp: 'teclado',
  computadora: 'clics',
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
  /** ¿Puede sonar ahora? (el gancho: efectos, ajuste, servidor y un oído que no lo tome por voz). */
  sonido?: () => boolean;
  /** El murmullo de «pensando» mientras el turno no dice nada (la mesa lo pide; sin esto, solo las herramientas). */
  pensando?: boolean;
  /** Desde cuándo suena el murmullo (PENSANDO_DESDE_MS; las pruebas lo cambian). */
  pensandoMs?: number;
  /** Suena (true) o calló (false) un sonido de trabajo: el oído sube o baja su umbral. */
  alFondo?: (on: boolean) => void;
  /** Para la miga: «trabajo: pensando», «trabajo: fuera (habla)». */
  miga?: (t: string) => void;
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
  /** El sonido de la herramienta que corre ahora (por su `progreso`), o null. */
  private deHerramienta: SonidoAmbiente | null = null;
  /** La voz de AU-RA suena ahora (el relleno, un comentario): ningún sonido encima. */
  private voz = false;
  /** La persona habló en este turno: los sonidos ya no vuelven. */
  private persona = false;
  /** Cuándo empezó a sonar cada sonido en este turno (su tope cuenta desde ahí, aunque se corte y vuelva). */
  private desde = new Map<SonidoAmbiente, number>();
  private readonly inicio: number;
  private readonly ahora: () => number;
  private readonly poner: (f: () => void, ms: number) => unknown;
  private readonly quitarReloj: (h: unknown) => void;
  private relojes: unknown[] = [];
  /** Lo que el narrador dijo en este turno (para la traza y las pruebas). */
  readonly dichos: string[] = [];

  constructor(private d: DepsTrabajoMesa) {
    this.ahora = d.ahora ?? Date.now;
    this.poner = d.setTimeout ?? ((f, ms) => setTimeout(f, ms));
    this.quitarReloj = d.clearTimeout ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>));
    this.inicio = this.ahora();
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
    // El turno en curso empieza a «pensar»: si llega a PENSANDO_DESDE_MS sin decir nada, el murmullo.
    if (d.pensando) this.reloj(() => this.aplicar(), d.pensandoMs ?? PENSANDO_DESDE_MS);
  }

  /** Un evento de progreso del turno. */
  evento(ev: EventoProgreso) {
    if (this.cerrado) return;
    this.d.alLinea(lineaDePantalla(ev, this.d.idioma));
    if (this.hablo) return;
    this.conductor.evento(ev);
    this.deHerramienta = ev.fase === 'empece' || (ev.fase === 'paso' && ev.herramienta === 'computadora') ? SONIDO_DE_TRABAJO[ev.herramienta] : null;
    this.aplicar();
  }

  /** Sonó otra cosa del turno (el relleno, el principio de la respuesta): cuenta para el ritmo. */
  yaSeDijo() {
    if (!this.cerrado) this.conductor.yaSeDijo();
  }

  /** La voz de AU-RA empieza a sonar (el relleno, un comentario del narrador): el sonido se va. */
  vozEmpieza() {
    if (this.cerrado) return;
    this.voz = true;
    this.aplicar('habla');
  }

  /** Su voz terminó: si el turno sigue trabajando (o pensando), el sonido vuelve. */
  vozTermina() {
    if (this.cerrado || !this.voz) return;
    this.voz = false;
    this.aplicar();
  }

  /** La persona habló: el sonido se va y ya no vuelve en este turno. */
  personaHabla() {
    if (this.cerrado || this.persona) return;
    this.persona = true;
    this.aplicar('persona');
  }

  /** Cambió lo que deja sonar (un ajuste, el oído): se vuelve a mirar. */
  revisar() {
    if (!this.cerrado) this.aplicar('ajuste');
  }

  /** Llegó texto de la respuesta: el narrador se calla en este turno, lo pendiente no suena y la línea se va. */
  respuesta() {
    if (this.cerrado) return;
    this.hablo = true;
    this.conductor.respuesta();
    this.soltarCorte?.();
    this.soltarCorte = null;
    this.aplicar('respuesta');
    this.d.alLinea('');
  }

  /** El turno terminó (bien, mal o cancelado): todo apagado; lo que llegue tarde no hace nada. */
  terminar() {
    if (this.cerrado) return;
    this.respuesta();
    this.cerrado = true;
    this.quitarSonido('fin');
    for (const h of this.relojes.splice(0)) this.quitarReloj(h);
  }

  /** Lo que el turno de verdad está haciendo ahora, si algo puede sonar: la herramienta o, con `pensando`, pensar. */
  private deseado(): SonidoAmbiente | null {
    if (this.cerrado || this.hablo || this.persona || this.voz) return null;
    if (this.deHerramienta) return this.deHerramienta;
    if (this.d.pensando && this.ahora() - this.inicio >= (this.d.pensandoMs ?? PENSANDO_DESDE_MS)) return 'pensando';
    return null;
  }

  private aplicar(motivo = 'listo') {
    let s = this.deseado();
    if (s && !(this.d.sonido?.() ?? false)) s = null;
    // Su tope: un sonido que ya sonó lo suyo en el turno no vuelve (nada en bucle).
    if (s && this.ahora() - (this.desde.get(s) ?? this.ahora()) >= MAX_SONIDO_MS[s]) s = null;
    if (s === this.sonando) return;
    if (!s) return this.quitarSonido(motivo);
    this.ponerSonido(s);
  }

  private ponerSonido(s: SonidoAmbiente) {
    if (!this.d.ambiente) return;
    const primera = !this.desde.has(s);
    if (primera) this.desde.set(s, this.ahora());
    const queda = MAX_SONIDO_MS[s] - (this.ahora() - this.desde.get(s)!);
    this.sonando = s;
    this.d.miga?.(`trabajo: ${s}`);
    try {
      this.d.ambiente.poner(s);
    } catch {
      /* sin sonido, sigue igual */
    }
    this.d.alFondo?.(true);
    this.reloj(() => this.sonando === s && this.aplicar('tope'), Math.max(0, queda));
  }

  private quitarSonido(motivo: string) {
    if (!this.sonando) return;
    this.sonando = null;
    this.d.miga?.(`trabajo: fuera (${motivo})`);
    try {
      this.d.ambiente?.quitar();
    } catch {
      /* ya no sonaba */
    }
    this.d.alFondo?.(false);
  }

  private reloj(f: () => void, ms: number) {
    const h = this.poner(() => {
      this.relojes = this.relojes.filter((x) => x !== h);
      f();
    }, ms);
    this.relojes.push(h);
  }
}
