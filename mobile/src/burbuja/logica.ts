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

export class AvisoBurbuja {
  private abierta_ = false;
  private oyentes = new Set<Oyente>();

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
    for (const f of [...this.oyentes]) f();
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
