/**
 * LA BURBUJA DE AURA, LO QUE NO ES PANTALLA: sus estados, lo que dice cada uno, qué pasa al cerrarla, el hilo que
 * comparte con la mesa y el aviso de que está abierta.
 *
 * La burbuja (src/burbuja/Burbuja.tsx) sale encima de cualquier app al mantener el botón lateral: escucha en el acto,
 * dice «Te escucho…» / «Pensando…», enseña la respuesta un momento, la dice con la voz de AURA y ofrece «Abrir en AURA»
 * para seguir la MISMA conversación en la app entera. Vive en el mismo motor de JS que la app (si la app está abierta
 * detrás, su mesa sigue montada): por eso necesita dos acuerdos con la mesa, y viven aquí, sin React Native, para que
 * los dos lados (y Node) los lean igual:
 *
 *  · `burbujaAbierta`: mientras está abierta, el micrófono es de la burbuja (compa/duenoAudio.ts, dueño «burbuja»): la
 *    mesa suelta su oído y no contesta encima. Al cerrarse lo vuelve a tomar si le toca.
 *  · `hiloCompartido`: la burbuja pregunta con el hilo de la mesa (lo que se venía hablando) y le deja lo que habló;
 *    la mesa lo suma a su hilo y a su chat cuando la burbuja se cierra (o al montarse, si la app no estaba abierta).
 *
 * Sin React Native: se prueba en Node (tests/asistente-digital-movil.test.ts).
 */

export type EstadoBurbuja =
  | 'arrancando'
  | 'escuchando'
  | 'pensando'
  | 'hablando'
  | 'escribiendo'
  | 'camara'
  | 'sin-sesion'
  | 'sin-permiso'
  | 'sin-oido'
  | 'ocupada'
  | 'error';

/** La línea corta bajo el orbe. Vacía cuando lo que se ve es la respuesta (hablando) o el teclado. */
export function textoEstado(e: EstadoBurbuja, en = false): string {
  switch (e) {
    case 'arrancando':
      return en ? 'One moment…' : 'Un momento…';
    case 'escuchando':
      return en ? 'Listening…' : 'Te escucho…';
    case 'pensando':
      return en ? 'Thinking…' : 'Pensando…';
    case 'camara':
      return en ? 'Point and take the photo' : 'Apunta y toma la foto';
    case 'sin-sesion':
      return en ? 'Sign in to AURA first' : 'Entra a AURA primero';
    case 'sin-permiso':
      return en ? 'I need the microphone to hear you' : 'Necesito el micrófono para escucharte';
    case 'sin-oido':
      return en ? 'I couldn’t open the microphone. Is another app using it? You can type.' : 'No pude abrir el micrófono. ¿Otra app lo está usando? Puedes escribirme.';
    case 'ocupada':
      return en ? 'AURA is on a call right now' : 'AURA está en una llamada ahora';
    case 'error':
      return en ? 'Something failed. Try again or open AURA.' : 'Algo falló. Inténtalo otra vez o abre AURA.';
    default:
      return '';
  }
}

/** ¿El micrófono de la burbuja debe estar abierto en este estado? (escribiendo o con la cámara, no: no se oye a medias). */
export function quiereOido(e: EstadoBurbuja): boolean {
  return e === 'escuchando';
}

/** Estados sin conversación posible: solo se ofrece abrir la app (o reintentar). */
export function sinConversacion(e: EstadoBurbuja): boolean {
  return e === 'sin-sesion' || e === 'ocupada';
}

/* ── cerrar ──────────────────────────────────────────────────────────────────────────────────── */

export type MotivoCierre = 'fuera' | 'atras' | 'abrir-app' | 'silencio' | 'fondo';

export type Cierre = {
  /** Callar la voz de AURA (siempre: la burbuja no sigue hablando sin verse). */
  callar: true;
  /** Cortar el turno que piensa (el stream del cerebro). */
  cancelarTurno: true;
  /** Soltar el micrófono y devolver el oído a quien lo tenía (siempre). */
  soltarMic: true;
  /**
   * Terminar la actividad desde JS (BackHandler.exitApp → finish de la burbuja). NO con «abrir-app»: para entonces la
   * que está delante es MainActivity, y el «atrás» de React le llegaría a ella (la mandaría al fondo). Ahí la burbuja se
   * termina sola al dejar de verse (onStop). Con «fondo» ya se está terminando.
   */
  terminarActividad: boolean;
  /** Abrir la app entera en la mesa, escuchando (ultronfp://hablar?origen=burbuja). */
  abrirApp: boolean;
};

export function cierreBurbuja(motivo: MotivoCierre): Cierre {
  return {
    callar: true,
    cancelarTurno: true,
    soltarMic: true,
    terminarActividad: motivo === 'fuera' || motivo === 'atras' || motivo === 'silencio',
    abrirApp: motivo === 'abrir-app',
  };
}

/**
 * Si la burbuja ya se cerró (una vez). Revisión de fases: «Abrir en AURA» la cierra ANTES de abrir la app (suelta el
 * micrófono y deja lo hablado); si el enlace no abre la app, la burbuja sigue delante y antes quedaba trabada: cerrada
 * por dentro, «atrás» y tocar fuera ya no hacían nada. `falloAbrirApp` la deja abierta otra vez (solo después de
 * «abrir-app»: un cierre de verdad no se deshace) y se cierra como siempre.
 */
export class ControlCierre {
  private motivo: MotivoCierre | null = null;

  cerrada(): boolean {
    return this.motivo !== null;
  }

  /** El cierre que toca, o null si ya estaba cerrada (cerrar dos veces no hace nada). */
  cerrar(motivo: MotivoCierre): Cierre | null {
    if (this.motivo !== null) return null;
    this.motivo = motivo;
    return cierreBurbuja(motivo);
  }

  /** «Abrir en AURA» no abrió la app: la burbuja vuelve a estar abierta (true) para cerrarse con «atrás» o fuera. */
  falloAbrirApp(): boolean {
    if (this.motivo !== 'abrir-app') return false;
    this.motivo = null;
    return true;
  }
}

/** Sin hablarle, sin escribir y sin nada en curso: la burbuja se cierra sola y suelta el micrófono. */
export const CIERRE_POR_SILENCIO_MS = 30_000;

export function debeCerrarPorSilencio(o: { estado: EstadoBurbuja; ultimaActividad: number; ahora: number }): boolean {
  if (o.estado !== 'escuchando' && o.estado !== 'sin-oido' && o.estado !== 'error') return false;
  return o.ahora - o.ultimaActividad >= CIERRE_POR_SILENCIO_MS;
}

/** Lo que se pregunta si la persona manda la foto sin decir nada. */
export function preguntaDeFoto(texto: string, en = false): string {
  const t = texto.trim();
  if (t) return t;
  return en ? 'What do you see in this photo?' : '¿Qué ves en esta foto?';
}

/* ── el aviso «la burbuja está abierta» ─────────────────────────────────────────────────────── */

type Oyente = () => void;

/** Lo más que espera la burbuja el acuse de la mesa antes de abrir su micrófono igual (una mesa colgada no la deja sorda). */
export const TOPE_ACUSE_MS = 1_500;

/**
 * Revisión de fases: el ACUSE. Al abrirse la burbuja la mesa suelta su micrófono (compa/duenoAudio.ts `OidoMesa`); antes
 * la burbuja esperaba 150 ms fijos y abría el suyo: si el `muteMic` de la mesa llegaba tarde, cerraba el micrófono de la
 * burbuja (es el mismo oído, prestado). Ahora la mesa ACUSA cuando terminó de soltarlo (o en el acto si no lo tenía
 * abierto) y la burbuja espera ese acuse (con tope).
 */
export class AvisoBurbuja {
  private abierta_ = false;
  private oyentes = new Set<Oyente>();
  /** ¿La mesa ya soltó el micrófono para ESTA apertura? (sin burbuja, no hay nada que soltar). */
  private acusado = true;
  private esperando = new Set<() => void>();

  abierta = (): boolean => this.abierta_;

  suscribir = (f: Oyente): (() => void) => {
    this.oyentes.add(f);
    return () => {
      this.oyentes.delete(f);
    };
  };

  fijar(abierta: boolean) {
    if (this.abierta_ === abierta) return;
    this.abierta_ = abierta;
    // Una apertura nueva espera su propio acuse; al cerrarse no queda nadie esperando.
    if (abierta) this.acusado = false;
    else this.acusar();
    for (const f of [...this.oyentes]) f();
  }

  /** La mesa ya soltó su micrófono (o no lo tenía): la burbuja puede abrir el suyo. */
  acusar() {
    this.acusado = true;
    for (const f of [...this.esperando]) f();
    this.esperando.clear();
  }

  /** Espera el acuse de la mesa (true) o el tope (false). Sin burbuja abierta, o ya acusado: en el acto. */
  esperarAcuse(topeMs = TOPE_ACUSE_MS): Promise<boolean> {
    if (this.acusado || !this.abierta_) return Promise.resolve(true);
    return new Promise((ok) => {
      const listo = () => {
        clearTimeout(reloj);
        ok(true);
      };
      const reloj = setTimeout(() => {
        this.esperando.delete(listo);
        ok(false);
      }, topeMs);
      this.esperando.add(listo);
    });
  }
}

/**
 * Revisión de fases: CUÁNDO VUELVE LA APP. Al cerrarse la burbuja, el aviso «abierta» se suelta solo cuando la app vuelve
 * a estar delante DE VERDAD: después de cerrarse hace falta ver un ciclo fondo → activa. Antes, si al cerrar AppState
 * todavía decía «active» (era la BURBUJA la que estaba delante, terminando), se soltaba en el acto y la mesa reabría su
 * micrófono en segundo plano, encima de la otra app. Con la burbuja cerrada, la única actividad que puede volver a estar
 * delante es MainActivity (una burbuja nueva vuelve a fijar «abierta» y cancela esta espera).
 */
export class VueltaDeLaApp {
  private fase: 'nada' | 'esperando-fondo' | 'esperando-delante' = 'nada';

  /** Se cerró la burbuja: `estadoAhora` es el AppState de este momento (si dice «active», es la burbuja que se va). */
  empezar(estadoAhora: string) {
    this.fase = estadoAhora === 'active' ? 'esperando-fondo' : 'esperando-delante';
  }

  cancelar() {
    this.fase = 'nada';
  }

  esperando(): boolean {
    return this.fase !== 'nada';
  }

  /** Un cambio de AppState. true: la app volvió delante de verdad (soltar el aviso ahora). */
  cambio(estado: string): boolean {
    if (this.fase === 'esperando-fondo') {
      if (estado !== 'active') this.fase = 'esperando-delante';
      return false;
    }
    if (this.fase === 'esperando-delante' && estado === 'active') {
      this.fase = 'nada';
      return true;
    }
    return false;
  }
}

export const burbujaAbierta = new AvisoBurbuja();

/* ── el hilo compartido con la mesa ──────────────────────────────────────────────────────────── */

/** La misma forma que `Turn` de lib/api.ts (aquí sin importarla: este archivo no puede traer React Native). */
export type TurnoHilo = { rol: 'usuario' | 'ultron'; texto: string };

/** El hilo que viaja al cerebro: los mismos 12 turnos que manda la mesa. */
export const TOPE_HILO = 12;

export class HiloCompartido {
  private lectorMesa: { correo: string; leer: () => TurnoHilo[] } | null = null;
  private porEntregar: { correo: string; turnos: TurnoHilo[] } = { correo: '', turnos: [] };

  /** La mesa se monta y deja leer su hilo (devuelve cómo dejar de hacerlo). */
  proveer(correo: string, leer: () => TurnoHilo[]): () => void {
    const yo = { correo: correo.toLowerCase(), leer };
    this.lectorMesa = yo;
    return () => {
      if (this.lectorMesa === yo) this.lectorMesa = null;
    };
  }

  /** ¿Hay una mesa montada (la app abierta detrás)? Entonces hay que esperar a que suelte el micrófono. */
  hayMesa(): boolean {
    return !!this.lectorMesa;
  }

  /** El hilo para el próximo turno de la burbuja: el de la mesa (si es de esta cuenta) y lo que la burbuja ya habló. */
  historial(correo: string): TurnoHilo[] {
    const c = correo.toLowerCase();
    let mesa: TurnoHilo[] = [];
    try {
      mesa = this.lectorMesa && this.lectorMesa.correo === c ? this.lectorMesa.leer() : [];
    } catch {
      mesa = [];
    }
    const propios = this.porEntregar.correo === c ? this.porEntregar.turnos : [];
    return [...mesa, ...propios].slice(-TOPE_HILO);
  }

  /** Lo que la burbuja habló (la pregunta y la respuesta). De otra cuenta, lo anterior se tira. */
  anotar(correo: string, turno: TurnoHilo) {
    const c = correo.toLowerCase();
    const texto = turno.texto.trim();
    if (!texto) return;
    if (this.porEntregar.correo !== c) this.porEntregar = { correo: c, turnos: [] };
    this.porEntregar.turnos = [...this.porEntregar.turnos, { rol: turno.rol, texto }].slice(-TOPE_HILO);
  }

  /** La mesa se lo lleva a su hilo (una sola vez); de otra cuenta no le toca nada. */
  tomarPorEntregar(correo: string): TurnoHilo[] {
    const c = correo.toLowerCase();
    if (this.porEntregar.correo !== c) return [];
    const t = this.porEntregar.turnos;
    this.porEntregar = { correo: c, turnos: [] };
    return t;
  }
}

export const hiloCompartido = new HiloCompartido();
