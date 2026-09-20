/**
 * Escena: lo que ULTRON entiende de lo que ve la cámara.
 *
 * Módulo PURO (sin DOM, sin MediaPipe): recibe observaciones por cuadro ya medidas
 * (posición, tamaño, gestos crudos) y produce el estado + eventos con histéresis y
 * una frase en español que el cerebro puede usar como hecho.
 *
 * Convención de ejes (ver README, sección Cámara):
 *  - x, y en -1..1. x positivo = la persona está a SU derecha (espejo del video frontal),
 *    así los ojos de la cara miran hacia donde está la persona. Visto desde ULTRON, x>0 es
 *    «a mi izquierda»: la frase se escribe siempre en primera persona (ULTRON) para no
 *    sugerir una segunda persona al único presente.
 *  - tam = alto de la cara relativo al alto del cuadro (0..1).
 */

export type MotorVision = 'mediapipe' | 'optico' | 'ninguno';

export type Cabeza = 'centro' | 'izquierda' | 'derecha' | 'arriba' | 'abajo';

export type EventoEscena =
  | 'llego'
  | 'se_fue'
  | 'sonrie'
  | 'deja_de_sonreir'
  | 'saluda'
  | 'dos_personas'
  | 'mira'
  | 'aparta_mirada'
  | 'cerca'
  | 'lejos';

export interface Principal {
  x: number;
  y: number;
  tam: number;
  mirando: boolean;
  sonrisa: number;
  sorpresa: number;
  ojosCerrados: boolean;
  bocaAbierta: number;
  cabeza: Cabeza;
}

export interface Escena {
  personas: number;
  principal: null | Principal;
  eventos: EventoEscena[];
  descripcion: string;
  motor: MotorVision;
  ts: number;
}

/**
 * Medición cruda de UN cuadro, tal como la entrega el motor (MediaPipe u óptico).
 * Coordenadas del video SIN espejar: cx, cy en 0..1 (0,0 arriba-izquierda del cuadro).
 */
export interface Observacion {
  ts: number;
  motor: MotorVision;
  personas: number;
  cara: null | {
    cx: number;
    cy: number;
    tam: number;
    /**
     * Giro horizontal en grados RELATIVO a la línea persona→cámara (0 = mira a la pantalla aunque
     * esté a un lado del cuadro); positivo = gira hacia SU derecha.
     */
    yaw: number;
    /** Inclinación en grados, también relativa a la cámara; positivo = mira hacia arriba. */
    pitch: number;
    sonrisa: number;
    sorpresa: number;
    bocaAbierta: number;
    /** Cierre de párpados 0..1 (promedio de los dos ojos). */
    parpadeo: number;
  };
  /** Movimiento lateral alto rápido y repetido (solo lo mide el tracker óptico). */
  saludo?: boolean;
}

// ---- Umbrales (todos en un solo lugar) -----------------------------------------------

export const UMBRALES = {
  llegoMs: 600,
  seFueMs: 2000,
  toleranciaCorteMs: 350,
  sonrieOn: 0.55,
  sonrieOff: 0.3,
  cercaOn: 0.45,
  cercaOff: 0.38,
  lejosOn: 0.12,
  lejosOff: 0.16,
  dosPersonasMs: 1000,
  /** Histéresis de salida de `dos_personas`: la segunda cara debe faltar este tiempo para poder re-anunciar. */
  dosPersonasOffMs: 1500,
  ojosCerradosNivel: 0.6,
  ojosCerradosMs: 400,
  miraYawOn: 20,
  miraPitchOn: 15,
  miraYawOff: 28,
  miraPitchOff: 22,
  miraMs: 250,
  cabezaYaw: 14,
  cabezaPitch: 12,
  saludoDebounceMs: 4000,
  ladoX: 0.3,
  /** Alisado (EMA) del giro de cabeza antes de la histéresis de `mirando`/`cabeza`. */
  alisadoGiro: 0.35,
} as const;

// ---- Helpers puros ----------------------------------------------------------------------

export const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
export const clamp11 = (v: number) => (v < -1 ? -1 : v > 1 ? 1 : v);

/** x del video (0..1, sin espejar) → x de la escena (-1..1, espejado). */
export function espejarX(cx01: number): number {
  return clamp11(0 - (cx01 * 2 - 1));
}

/** y del video (0..1) → y de la escena (-1 arriba .. 1 abajo). */
export function normalizarY(cy01: number): number {
  return clamp11(cy01 * 2 - 1);
}

/** Dirección de la cabeza a partir de yaw/pitch en grados (convención de `Observacion`). */
export function cabezaDesde(yaw: number, pitch: number): Cabeza {
  const ay = Math.abs(yaw);
  const ap = Math.abs(pitch);
  if (ay < UMBRALES.cabezaYaw && ap < UMBRALES.cabezaPitch) return 'centro';
  if (ay >= ap) return yaw > 0 ? 'derecha' : 'izquierda';
  return pitch > 0 ? 'arriba' : 'abajo';
}

/** Cuenta en palabras para la frase (sin inventar más allá de lo contado). */
function palabraNumero(n: number): string {
  const t = ['cero', 'una', 'dos', 'tres', 'cuatro', 'cinco', 'seis'];
  return n < t.length ? t[n] : String(n);
}

export interface EstadoDescribible {
  personas: number;
  principal: null | Principal;
  motor: MotorVision;
}

/**
 * Lado desde el punto de vista de ULTRON (quien habla). x>0 = la persona está a SU derecha
 * (espejado), o sea a la IZQUIERDA de ULTRON/cámara.
 */
export function ladoDesdeUltron(x: number): 'a mi izquierda' | 'a mi derecha' | 'frente a mí' {
  if (x > UMBRALES.ladoX) return 'a mi izquierda';
  if (x < -UMBRALES.ladoX) return 'a mi derecha';
  return 'frente a mí';
}

/**
 * Frase en español que ULTRON puede usar como hecho, siempre en primera persona (ULTRON habla,
 * «mi» es ULTRON). Nunca inventa edad, género ni identidad.
 *  «Veo a una persona cerca, a mi izquierda, sonriendo y mirando la pantalla.»
 *  «No veo a nadie ahora.» · «Veo a dos personas.» · «La cámara está apagada.»
 */
export function describirEscena(e: EstadoDescribible): string {
  if (e.motor === 'ninguno') return 'La cámara está apagada.';
  if (e.personas <= 0) return 'No veo a nadie ahora.';
  if (!e.principal) {
    // Contamos caras pero todavía no hay una principal confirmada: se dice lo que se sabe y nada más.
    return e.personas >= 2 ? `Veo a ${palabraNumero(e.personas)} personas.` : 'No veo a nadie ahora.';
  }
  if (e.motor === 'optico') {
    // El respaldo óptico solo ve luz y movimiento: no afirma que sea una persona ni describe gestos.
    return `Creo que hay alguien ${ladoDesdeUltron(e.principal.x)}, pero el sensor básico no distingue detalles.`;
  }

  const p = e.principal;
  const partes: string[] = [];

  if (e.personas >= 2) {
    partes.push(`Veo a ${palabraNumero(e.personas)} personas`);
    const detalle: string[] = [];
    if (p.tam >= UMBRALES.cercaOn) detalle.push('una muy cerca');
    if (p.sonrisa >= UMBRALES.sonrieOn) detalle.push('una sonriendo');
    if (p.mirando) detalle.push('la más cercana mira la pantalla');
    if (detalle.length) partes.push(', ' + detalle.join(', '));
    return partes.join('') + '.';
  }

  let frase = 'Veo a una persona';
  if (p.tam >= UMBRALES.cercaOn) frase += ' cerca';
  else if (p.tam > 0 && p.tam <= UMBRALES.lejosOn) frase += ' lejos';

  frase += ', ' + ladoDesdeUltron(p.x);

  const gestos: string[] = [];
  if (p.ojosCerrados) gestos.push('con los ojos cerrados');
  else if (p.sorpresa >= 0.5) gestos.push('con cara de sorpresa');
  else if (p.sonrisa >= UMBRALES.sonrieOn) gestos.push('sonriendo');
  else if (p.bocaAbierta >= 0.45) gestos.push('con la boca abierta');

  if (p.mirando) gestos.push('mirando la pantalla');
  else if (p.cabeza === 'arriba') gestos.push('mirando hacia arriba');
  else if (p.cabeza === 'abajo') gestos.push('mirando hacia abajo');
  else if (p.cabeza === 'izquierda' || p.cabeza === 'derecha') gestos.push('mirando hacia otro lado');

  if (gestos.length === 1) frase += ', ' + gestos[0];
  else if (gestos.length >= 2) frase += ', ' + gestos.slice(0, -1).join(', ') + ' y ' + gestos[gestos.length - 1];

  return frase + '.';
}

// ---- Máquina de eventos ---------------------------------------------------------------------

type ZonaDistancia = 'cerca' | 'media' | 'lejos';

/**
 * Máquina de estado con histéresis. Determinista: solo depende de las observaciones y de sus `ts`
 * (milisegundos), así que se prueba sin DOM ni relojes reales.
 */
export class MaquinaEscena {
  private presente = false;
  private tPrimeraCara: number | null = null;
  private tUltimaCara: number | null = null;
  private sonriendo = false;
  private mirando = false;
  private tMiraCandidato: number | null = null;
  private zona: ZonaDistancia = 'media';
  private dosAnunciado = false;
  private tDosDesde: number | null = null;
  /** Desde cuándo falta la segunda cara (histéresis de salida de `dos_personas`). */
  private tDosPerdido: number | null = null;
  private tOjosCerradosDesde: number | null = null;
  private tUltimoSaludo = -Infinity;
  private suave: { x: number; y: number; tam: number; yaw: number; pitch: number } | null = null;
  /** Última cara publicada: se mantiene durante el corte corto (< seFueMs) para no parpadear. */
  private ultimoPrincipal: Principal | null = null;
  private ultimaEscena: Escena | null = null;

  constructor(private readonly u = UMBRALES, private readonly alisado = 0.35) {}

  /** ¿Hay una persona confirmada (tras `llego` y antes de `se_fue`)? */
  get presenteConfirmado(): boolean {
    return this.presente;
  }

  reiniciar() {
    this.presente = false;
    this.tPrimeraCara = null;
    this.tUltimaCara = null;
    this.sonriendo = false;
    this.mirando = false;
    this.tMiraCandidato = null;
    this.zona = 'media';
    this.dosAnunciado = false;
    this.tDosDesde = null;
    this.tDosPerdido = null;
    this.tOjosCerradosDesde = null;
    this.suave = null;
    this.ultimoPrincipal = null;
    this.ultimaEscena = null;
  }

  /**
   * Cambio de motor en caliente (óptico → MediaPipe): conserva la presencia (no vuelve a emitir
   * `llego` a la misma persona) y la última cara publicada (la salida sigue congelada hasta el primer
   * cuadro del motor nuevo: nunca `personas: 1` con `principal: null`), y olvida solo lo que el motor
   * anterior no medía bien (sonrisa, mirada, zona, ojos, suavizado).
   */
  cambiarMotor() {
    this.sonriendo = false;
    this.mirando = false;
    this.tMiraCandidato = null;
    this.zona = 'media';
    this.dosAnunciado = false;
    this.tDosDesde = null;
    this.tDosPerdido = null;
    this.tOjosCerradosDesde = null;
    this.suave = null;
  }

  get escena(): Escena | null {
    return this.ultimaEscena;
  }

  procesar(o: Observacion): Escena {
    const u = this.u;
    const ev: EventoEscena[] = [];
    const ts = o.ts;

    if (o.motor === 'ninguno') {
      const apagada: Escena = { personas: 0, principal: null, eventos: [], descripcion: describirEscena({ personas: 0, principal: null, motor: 'ninguno' }), motor: 'ninguno', ts };
      this.ultimaEscena = apagada;
      return apagada;
    }

    let principal: Principal | null = null;

    if (o.cara) {
      // --- presencia continua
      if (this.tPrimeraCara === null || (this.tUltimaCara !== null && ts - this.tUltimaCara > u.toleranciaCorteMs)) {
        this.tPrimeraCara = ts;
      }
      this.tUltimaCara = ts;
      if (!this.presente && ts - this.tPrimeraCara >= u.llegoMs) {
        this.presente = true;
        ev.push('llego');
      }

      // --- suavizado de posición/tamaño (primera muestra directa, luego EMA)
      const x = espejarX(o.cara.cx);
      const y = normalizarY(o.cara.cy);
      const tam = clamp01(o.cara.tam);
      if (!this.suave) this.suave = { x, y, tam, yaw: o.cara.yaw, pitch: o.cara.pitch };
      else {
        const a = this.alisado;
        this.suave.x += (x - this.suave.x) * a;
        this.suave.y += (y - this.suave.y) * a;
        this.suave.tam += (tam - this.suave.tam) * a;
        // El giro también se alisa: un estimador ruidoso cuadro a cuadro no debe hacer saltar `mirando`/`cabeza`.
        const g = u.alisadoGiro;
        this.suave.yaw += (o.cara.yaw - this.suave.yaw) * g;
        this.suave.pitch += (o.cara.pitch - this.suave.pitch) * g;
      }
      const yaw = this.suave.yaw;
      const pitch = this.suave.pitch;

      // --- sonrisa con histéresis
      const sonrisa = clamp01(o.cara.sonrisa);
      if (!this.sonriendo && sonrisa >= u.sonrieOn) {
        this.sonriendo = true;
        if (this.presente) ev.push('sonrie');
      } else if (this.sonriendo && sonrisa < u.sonrieOff) {
        this.sonriendo = false;
        if (this.presente) ev.push('deja_de_sonreir');
      }

      // --- mirada (cabeza apunta a la pantalla) con histéresis + sostén corto
      const ay = Math.abs(yaw);
      const ap = Math.abs(pitch);
      const apuntaOn = ay < u.miraYawOn && ap < u.miraPitchOn;
      const apuntaOff = ay > u.miraYawOff || ap > u.miraPitchOff;
      const candidato = this.mirando ? !apuntaOff : apuntaOn;
      if (candidato === this.mirando) this.tMiraCandidato = null;
      else {
        if (this.tMiraCandidato === null) this.tMiraCandidato = ts;
        if (ts - this.tMiraCandidato >= u.miraMs) {
          this.mirando = candidato;
          this.tMiraCandidato = null;
          if (this.presente) ev.push(candidato ? 'mira' : 'aparta_mirada');
        }
      }

      // --- distancia con histéresis
      const t = this.suave.tam;
      let zona = this.zona;
      if (zona === 'cerca') zona = t < u.cercaOff ? 'media' : 'cerca';
      else if (zona === 'lejos') zona = t > u.lejosOff ? 'media' : 'lejos';
      if (zona === 'media') zona = t > u.cercaOn ? 'cerca' : t < u.lejosOn ? 'lejos' : 'media';
      if (zona !== this.zona) {
        this.zona = zona;
        if (this.presente && zona !== 'media') ev.push(zona);
      }

      // --- ojos cerrados sostenidos
      if (o.cara.parpadeo > u.ojosCerradosNivel) {
        if (this.tOjosCerradosDesde === null) this.tOjosCerradosDesde = ts;
      } else this.tOjosCerradosDesde = null;
      const ojosCerrados = this.tOjosCerradosDesde !== null && ts - this.tOjosCerradosDesde >= u.ojosCerradosMs;

      principal = {
        x: this.suave.x,
        y: this.suave.y,
        tam: this.suave.tam,
        mirando: this.mirando,
        sonrisa,
        sorpresa: clamp01(o.cara.sorpresa),
        ojosCerrados,
        bocaAbierta: clamp01(o.cara.bocaAbierta),
        cabeza: cabezaDesde(yaw, pitch),
      };
      this.ultimoPrincipal = principal;
    } else {
      // sin cara en este cuadro
      if (this.tUltimaCara !== null && ts - this.tUltimaCara > u.toleranciaCorteMs) this.tPrimeraCara = null;
      if (this.presente && this.tUltimaCara !== null && ts - this.tUltimaCara >= u.seFueMs) {
        this.presente = false;
        this.tPrimeraCara = null;
        this.tUltimaCara = null;
        this.sonriendo = false;
        this.mirando = false;
        this.tMiraCandidato = null;
        this.zona = 'media';
        this.tOjosCerradosDesde = null;
        this.suave = null;
        this.ultimoPrincipal = null;
        this.dosAnunciado = false;
        this.tDosDesde = null;
        this.tDosPerdido = null;
        ev.push('se_fue');
      } else if (this.presente) {
        // Corte corto (falso negativo del detector): se mantiene la última cara conocida, con sus
        // gestos congelados, hasta que pase seFueMs. Así `principal`/`mirada.active` no parpadean.
        principal = this.ultimoPrincipal;
      }
    }

    // --- dos personas: estable 1 s para entrar (solo con alguien ya confirmado) y 1.5 s de ausencia
    //     de la segunda cara para poder re-anunciar (una cara que parpadea en el borde no repite el evento)
    if (o.personas >= 2 && this.presente) {
      this.tDosPerdido = null;
      if (this.tDosDesde === null) this.tDosDesde = ts;
      if (!this.dosAnunciado && ts - this.tDosDesde >= u.dosPersonasMs) {
        this.dosAnunciado = true;
        ev.push('dos_personas');
      }
    } else if (this.tDosDesde !== null) {
      if (this.tDosPerdido === null) this.tDosPerdido = ts;
      if (ts - this.tDosPerdido >= u.dosPersonasOffMs) {
        this.tDosDesde = null;
        this.tDosPerdido = null;
        this.dosAnunciado = false;
      }
    }

    // --- saludo (opcional, con debounce)
    if (o.saludo && ts - this.tUltimoSaludo >= u.saludoDebounceMs) {
      this.tUltimoSaludo = ts;
      ev.push('saluda');
    }

    // Antes del «llego» nadie cuenta todavía (evita parpadeos de detección); durante el corte corto
    // se sigue publicando la última cara conocida.
    const personas = this.presente ? Math.max(1, o.personas) : 0;
    const principalPublico = this.presente ? principal : null;

    const escena: Escena = {
      personas,
      principal: principalPublico,
      eventos: ev,
      descripcion: describirEscena({ personas, principal: principalPublico, motor: o.motor }),
      motor: o.motor,
      ts,
    };
    this.ultimaEscena = escena;
    return escena;
  }
}
