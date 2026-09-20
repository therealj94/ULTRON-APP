/**
 * Escena: lo que ULTRON entiende de lo que ve la cámara (móvil).
 *
 * Mismo contrato que la web (`src/02-cara/vision/escena.ts`), con tres motores:
 *  - 'mlkit'    → detección facial nativa en el teléfono (react-native-vision-camera + ML Kit), ~10 fps.
 *  - 'servidor' → respaldo: una foto cada 12 s a /api/vision/analyze (etiquetas), sin gestos ni posición fina.
 *  - 'ninguno'  → cámara apagada o sin permiso.
 *
 * Módulo PURO (sin React ni módulos nativos): recibe observaciones por cuadro y produce el estado +
 * eventos con histéresis y una frase en español que el cerebro usa como hecho («ESCENA (cámara local): …»).
 *
 * Convención de ejes (igual que la web):
 *  - x, y en -1..1. x positivo = la persona está hacia la DERECHA de la pantalla vista de frente
 *    (ESPEJADO respecto al cuadro crudo de la cámara frontal), así las pupilas (translateX positivo)
 *    apuntan hacia donde está la persona. y positivo = abajo. Visto desde ULTRON, x>0 es «a mi
 *    izquierda»: la frase va siempre en primera persona (ULTRON habla) para no sugerirle al único
 *    presente que hay alguien más a SU lado.
 *  - tam = alto de la cara relativo al alto del cuadro (0..1).
 *  - yaw/pitch de `Observacion` son RELATIVOS a la línea persona→cámara (0 = mira a la pantalla aunque
 *    esté en un borde del cuadro); `observacionMlkit` descuenta el ángulo de posición (`anguloEsperado`).
 *
 * Diferencias con la web, a propósito:
 *  - NO existe el evento 'saluda': lo medía el tracker óptico de la web (movimiento lateral alto y
 *    repetido) y ML Kit no da landmarks de mano ni trayectoria en modo 'fast'. Tampoco hay `Observacion.saludo`.
 *  - Muestreo intermitente: con la cara dormida la cámara se apaga ~9,5 s de cada 12 s. El rato SIN
 *    observaciones es desconocido, no ausencia (`huecoMuestreoMs`): las marcas de tiempo se desplazan por
 *    la duración del hueco en vez de contarlo, así no hay `se_fue`/`llego` falsos al volver.
 */

export type MotorVision = 'mlkit' | 'servidor' | 'ninguno';

export type Cabeza = 'centro' | 'izquierda' | 'derecha' | 'arriba' | 'abajo';

export type EventoEscena =
  | 'llego'
  | 'se_fue'
  | 'sonrie'
  | 'deja_de_sonreir'
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
  /** Solo motor 'servidor': etiquetas que devolvió el nodo de visión (persona, taza, teléfono…). */
  etiquetas?: string[];
}

/**
 * Medición cruda de UN cuadro (coordenadas del cuadro SIN espejar: cx, cy en 0..1, origen arriba-izquierda).
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
}

// ---- Umbrales (todos en un solo lugar) -----------------------------------------------

export const UMBRALES = {
  llegoMs: 600,
  seFueMs: 2000,
  toleranciaCorteMs: 450,
  sonrieOn: 0.55,
  sonrieOff: 0.3,
  cercaOn: 0.45,
  cercaOff: 0.38,
  lejosOn: 0.12,
  lejosOff: 0.16,
  dosPersonasMs: 1000,
  /** Histéresis de SALIDA de `dos_personas`: la segunda cara debe faltar esto para poder re-anunciar. */
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
  ladoX: 0.3,
  /** Alisado (EMA) del giro de cabeza antes de la histéresis de `mirando`/`cabeza`. Igual que la web. */
  alisadoGiro: 0.35,
  /**
   * Hueco de MUESTREO: si entre dos observaciones pasa más que esto, la cámara estuvo apagada y no se
   * sabe nada de ese rato (no se imputa ausencia). Tiene que ser MAYOR que la cadencia normal más lenta:
   * con la cara dormida ML Kit corre a FPS_DORMIDO = 2 (un cuadro cada 500 ms) dentro de la ventana, así
   * que 700 ms deja pasar la cadencia dormida y solo marca los cortes reales (9,5 s con el sensor apagado).
   * No se reusa `toleranciaCorteMs` (450 ms) porque ese umbral mide continuidad de CARA, no de muestreo.
   */
  huecoMuestreoMs: 700,
} as const;

// ---- Helpers puros ----------------------------------------------------------------------

export const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
export const clamp11 = (v: number) => (v < -1 ? -1 : v > 1 ? 1 : v);

/** x del cuadro (0..1, sin espejar) → x de la escena (-1..1, espejado). */
export function espejarX(cx01: number): number {
  return clamp11(0 - (cx01 * 2 - 1));
}

/** y del cuadro (0..1) → y de la escena (-1 arriba .. 1 abajo). */
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

function palabraNumero(n: number): string {
  const t = ['cero', 'una', 'dos', 'tres', 'cuatro', 'cinco', 'seis'];
  return n < t.length ? t[n] : String(n);
}

/**
 * Lado desde el punto de vista de ULTRON (quien habla). x>0 = la persona está a SU derecha
 * (espejado), o sea a la IZQUIERDA de ULTRON/cámara. Igual que la web.
 */
export function ladoDesdeUltron(x: number): 'a mi izquierda' | 'a mi derecha' | 'frente a mí' {
  if (x > UMBRALES.ladoX) return 'a mi izquierda';
  if (x < -UMBRALES.ladoX) return 'a mi derecha';
  return 'frente a mí';
}

export interface EstadoDescribible {
  personas: number;
  principal: null | Principal;
  motor: MotorVision;
  etiquetas?: string[];
}

/**
 * Frase en español que ULTRON puede usar como hecho, siempre en primera persona (ULTRON habla,
 * «mi» es ULTRON). Nunca inventa edad, género ni identidad.
 *  «Veo a una persona cerca, a mi izquierda, sonriendo y mirando la pantalla.»
 *  «No veo a nadie ahora.» · «Veo a dos personas.» · «La cámara está apagada.»
 */
export function describirEscena(e: EstadoDescribible): string {
  if (e.motor === 'ninguno') return 'La cámara está apagada.';
  if (e.motor === 'servidor') {
    // El respaldo solo tiene etiquetas del nodo de visión (cada ~12 s): no afirma gestos ni posición.
    const et = (e.etiquetas || []).filter(Boolean);
    if (!et.length && e.personas <= 0) return 'No veo a nadie ahora.';
    const quien = e.personas >= 2 ? `Veo a ${palabraNumero(e.personas)} personas` : e.personas === 1 ? 'Veo a una persona' : 'No veo a nadie';
    const resto = et.filter((l) => !/persona|rostro|cara|hombre|mujer|niñ|gente|face|person/.test(l));
    return resto.length ? `${quien}; en la mesa: ${resto.join(', ')}.` : `${quien}.`;
  }
  if (e.personas <= 0) return 'No veo a nadie ahora.';
  if (!e.principal) {
    // Contamos caras pero todavía no hay una principal confirmada (antes de «llego»): se dice lo que se sabe.
    return e.personas >= 2 ? `Veo a ${palabraNumero(e.personas)} personas.` : 'No veo a nadie ahora.';
  }

  const p = e.principal;
  if (e.personas >= 2) {
    const detalle: string[] = [];
    if (p.tam >= UMBRALES.cercaOn) detalle.push('una muy cerca');
    if (p.sonrisa >= UMBRALES.sonrieOn) detalle.push('una sonriendo');
    if (p.mirando) detalle.push('la más cercana mira la pantalla');
    return `Veo a ${palabraNumero(e.personas)} personas${detalle.length ? ', ' + detalle.join(', ') : ''}.`;
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

// ---- ML Kit → Observacion --------------------------------------------------------------------

/** Subconjunto de `Face` de react-native-vision-camera-face-detector que usamos (sin landmarks). */
export interface CaraMlkit {
  bounds: { x: number; y: number; width: number; height: number };
  yawAngle: number;
  pitchAngle: number;
  rollAngle?: number;
  /** -1 si no se clasificó. */
  smilingProbability: number;
  leftEyeOpenProbability: number;
  rightEyeOpenProbability: number;
}

export type OrientacionCuadro = 'portrait' | 'portrait-upside-down' | 'landscape-left' | 'landscape-right';

/**
 * Dimensiones del cuadro tal como lo ve ML Kit (ya rotado a «derecho»). vision-camera reporta
 * `frame.orientation` = inverso de `rotationDegrees`: con 90/270 (orientation landscape-*) la imagen que
 * analiza ML Kit tiene los lados intercambiados respecto a `frame.width × frame.height`.
 */
export function dimensionesMlkit(frameW: number, frameH: number, orientacion: OrientacionCuadro): { w: number; h: number } {
  const apaisado = orientacion === 'landscape-left' || orientacion === 'landscape-right';
  return apaisado ? { w: frameH, h: frameW } : { w: frameW, h: frameH };
}

/**
 * Campo de visión DIAGONAL por defecto de una cámara frontal (grados). Equivale a los 60° horizontales
 * que asume la web para un cuadro 4:3 (2·atan(tan 30°·5/4) ≈ 71,6°). En Android, vision-camera
 * calcula `format.fieldOfView` con la diagonal del sensor, así que se pasa tal cual.
 */
export const FOV_DIAGONAL_GRADOS = 72;

/** Convierte un campo de visión horizontal (iOS lo reporta así) a diagonal para un cuadro w×h. */
export function fovDiagonalDesdeHorizontal(hfov: number, w: number, h: number): number {
  if (!(hfov > 0) || !(w > 0) || !(h > 0)) return FOV_DIAGONAL_GRADOS;
  const tanH = Math.tan((hfov * Math.PI) / 360);
  const tanD = (tanH * Math.hypot(w, h)) / w;
  return (Math.atan(tanD) * 360) / Math.PI;
}

/**
 * Ángulo (grados) con que la cámara ve un punto del cuadro: cuánto tendría que girar la cabeza alguien
 * situado en (cx, cy) para mirar a la cámara. Se resta del giro absoluto para decidir `mirando` sin
 * castigar a quien está en un borde de la pantalla (con ~65° de campo, en x≈±0,7 son ~20-25°).
 *  - yaw > 0 = giro hacia SU derecha. Persona a la izquierda del cuadro (cx<0.5, sin espejar) mira a la
 *    cámara girando hacia SU izquierda → yaw esperado < 0.
 *  - pitch > 0 = mira arriba. Persona en la parte alta (cy<0.5) mira a la cámara bajando la cabeza →
 *    pitch esperado < 0.
 * (w, h) son las dimensiones del cuadro «derecho» que analizó ML Kit; el FOV diagonal se reparte entre
 * los ejes según el aspecto (modelo de agujero de alfiler).
 */
export function anguloEsperado(cx: number, cy: number, w: number, h: number, fovDiagonal = FOV_DIAGONAL_GRADOS): { yaw: number; pitch: number } {
  const ancho = w > 0 ? w : 4;
  const alto = h > 0 ? h : 3;
  const fov = fovDiagonal > 10 && fovDiagonal < 170 ? fovDiagonal : FOV_DIAGONAL_GRADOS;
  const tanD = Math.tan((fov * Math.PI) / 360);
  const diag = Math.hypot(ancho, alto);
  const tanH = (tanD * ancho) / diag;
  const tanV = (tanD * alto) / diag;
  const u = clamp11((cx - 0.5) * 2);
  const v = clamp11((cy - 0.5) * 2);
  return {
    yaw: (Math.atan(u * tanH) * 180) / Math.PI,
    pitch: (Math.atan(v * tanV) * 180) / Math.PI,
  };
}

/**
 * Traduce las caras de ML Kit de un cuadro a una `Observacion`. La cara principal es la más grande.
 *  - ML Kit no da sorpresa ni apertura de boca sin landmarks/contornos: quedan en 0. (Sí reporta los
 *    ángulos de Euler con nuestra configuración: `fast` + landmarks none + contornos none + clasificación.)
 *  - `yawAngle` (Euler Y) de ML Kit es positivo cuando la cara gira hacia la DERECHA de la imagen (sin
 *    espejar), es decir hacia la izquierda de la persona; se invierte para cumplir «positivo = hacia SU
 *    derecha». `pitchAngle` (Euler X) positivo = mira arriba, como la nuestra.
 *  - yaw/pitch salen RELATIVOS a la cámara: se descuenta `anguloEsperado(cx, cy)`, así quien está en un
 *    borde del cuadro mirando la pantalla da ≈ 0° y `mirando` funciona en toda la mesa.
 * @param fovDiagonal campo de visión diagonal del formato (grados); si no se conoce, el típico.
 */
export function observacionMlkit(
  caras: CaraMlkit[],
  frameW: number,
  frameH: number,
  orientacion: OrientacionCuadro,
  ts: number,
  fovDiagonal: number = FOV_DIAGONAL_GRADOS
): Observacion {
  const { w, h } = dimensionesMlkit(frameW, frameH, orientacion);
  const validas = caras.filter((c) => c && c.bounds && c.bounds.width > 0 && c.bounds.height > 0);
  if (!validas.length || w <= 0 || h <= 0) return { ts, motor: 'mlkit', personas: 0, cara: null };
  const p = validas.reduce((a, b) => (b.bounds.height > a.bounds.height ? b : a));
  const cx = clamp01((p.bounds.x + p.bounds.width / 2) / w);
  const cy = clamp01((p.bounds.y + p.bounds.height / 2) / h);
  const abiertoL = p.leftEyeOpenProbability;
  const abiertoR = p.rightEyeOpenProbability;
  const abiertos = [abiertoL, abiertoR].filter((v) => typeof v === 'number' && v >= 0);
  const parpadeo = abiertos.length ? clamp01(1 - abiertos.reduce((a, b) => a + b, 0) / abiertos.length) : 0;
  const yawAbs = -(Number.isFinite(p.yawAngle) ? p.yawAngle : 0);
  const pitchAbs = Number.isFinite(p.pitchAngle) ? p.pitchAngle : 0;
  const esperado = anguloEsperado(cx, cy, w, h, fovDiagonal);
  return {
    ts,
    motor: 'mlkit',
    personas: validas.length,
    cara: {
      cx,
      cy,
      tam: clamp01(p.bounds.height / h),
      yaw: yawAbs - esperado.yaw,
      pitch: pitchAbs - esperado.pitch,
      sonrisa: p.smilingProbability >= 0 ? clamp01(p.smilingProbability) : 0,
      sorpresa: 0,
      bocaAbierta: 0,
      parpadeo,
    },
  };
}

// ---- Etiquetas del servidor → Escena --------------------------------------------------------

const RE_PERSONA = /persona|rostro|cara|hombre|mujer|niñ|gente|face|person/;

/**
 * Escena a partir de las etiquetas del nodo de visión (motor 'servidor'). Sin posición ni gestos:
 * principal centrado y neutro cuando hay persona. `anterior` permite emitir llego/se_fue.
 */
export function escenaDesdeEtiquetas(etiquetas: string[], ts: number, anterior?: Escena | null): Escena {
  const et = etiquetas.map((s) => s.trim().toLowerCase()).filter(Boolean);
  const hayPersona = et.some((l) => RE_PERSONA.test(l));
  const varias = et.some((l) => /personas|gente|dos personas|grupo/.test(l));
  const personas = hayPersona ? (varias ? 2 : 1) : 0;
  const principal: Principal | null = hayPersona
    ? { x: 0, y: 0, tam: 0.3, mirando: false, sonrisa: 0, sorpresa: 0, ojosCerrados: false, bocaAbierta: 0, cabeza: 'centro' }
    : null;
  const eventos: EventoEscena[] = [];
  const antesHabia = !!anterior && anterior.motor !== 'ninguno' && anterior.personas > 0;
  if (hayPersona && !antesHabia) eventos.push('llego');
  if (!hayPersona && antesHabia) eventos.push('se_fue');
  if (personas >= 2 && (!anterior || anterior.personas < 2)) eventos.push('dos_personas');
  return { personas, principal, eventos, descripcion: describirEscena({ personas, principal, motor: 'servidor', etiquetas: et }), motor: 'servidor', ts, etiquetas: et };
}

/** Escena de cámara apagada / sin permiso. */
export function escenaApagada(ts: number): Escena {
  return { personas: 0, principal: null, eventos: [], descripcion: describirEscena({ personas: 0, principal: null, motor: 'ninguno' }), motor: 'ninguno', ts };
}

// ---- Máquina de eventos ---------------------------------------------------------------------

type ZonaDistancia = 'cerca' | 'media' | 'lejos';

/**
 * Máquina de estado con histéresis. Determinista: solo depende de las observaciones y de sus `ts`
 * (milisegundos), así que se prueba sin cámara ni relojes reales (`scripts/check-escena.mjs`).
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
  /** Desde cuándo falta la segunda cara (histéresis de SALIDA de `dos_personas`). */
  private tDosPerdido: number | null = null;
  private tOjosCerradosDesde: number | null = null;
  private suave: { x: number; y: number; tam: number; yaw: number; pitch: number } | null = null;
  /** ts de la última observación recibida (haya cara o no): sirve para detectar huecos de muestreo. */
  private tUltimaObs: number | null = null;
  /** Última cara publicada: se mantiene durante el corte corto (< seFueMs) para no parpadear. */
  private ultimoPrincipal: Principal | null = null;
  private ultimaEscena: Escena | null = null;

  constructor(private readonly u = UMBRALES, private readonly alisado = 0.35) {}

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
    this.tUltimaObs = null;
    this.ultimoPrincipal = null;
    this.ultimaEscena = null;
  }

  get escena(): Escena | null {
    return this.ultimaEscena;
  }

  get hayPersona(): boolean {
    return this.presente;
  }

  /**
   * @param opciones.inmediato con el detector a 1 cuadro cada 5 s (cara dormida) no hay «presencia
   *   continua» posible: una cara en un cuadro ya cuenta como llegada.
   */
  procesar(o: Observacion, opciones?: { inmediato?: boolean }): Escena {
    const u = this.u;
    const ev: EventoEscena[] = [];
    const ts = o.ts;

    if (o.motor === 'ninguno') {
      const apagada = escenaApagada(ts);
      this.ultimaEscena = apagada;
      return apagada;
    }

    // --- MEDIA 1: hueco de MUESTREO. Con la cara dormida la cámara se apaga ~9,5 s de cada 12 s; el rato
    // sin observaciones NO es ausencia, es desconocido. En vez de contarlo, se corren las marcas de tiempo
    // por la duración del hueco: al volver, la escena sigue exactamente donde estaba (ni `se_fue` ni `llego`
    // falsos) y solo el tiempo realmente observado cuenta para las histéresis.
    const hueco = this.tUltimaObs !== null && ts - this.tUltimaObs > u.huecoMuestreoMs ? ts - this.tUltimaObs : 0;
    if (hueco > 0) {
      if (this.tPrimeraCara !== null) this.tPrimeraCara += hueco;
      if (this.tUltimaCara !== null) this.tUltimaCara += hueco;
      if (this.tMiraCandidato !== null) this.tMiraCandidato += hueco;
      if (this.tOjosCerradosDesde !== null) this.tOjosCerradosDesde += hueco;
      if (this.tDosDesde !== null) this.tDosDesde += hueco;
      if (this.tDosPerdido !== null) this.tDosPerdido += hueco;
    }
    this.tUltimaObs = ts;

    let principal: Principal | null = null;

    if (o.cara) {
      // --- presencia continua
      if (this.tPrimeraCara === null || (this.tUltimaCara !== null && ts - this.tUltimaCara > u.toleranciaCorteMs)) {
        this.tPrimeraCara = opciones?.inmediato ? ts - u.llegoMs : ts;
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
        // El giro también se alisa (como la web): un estimador ruidoso cuadro a cuadro no debe hacer
        // saltar `mirando`/`cabeza`.
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
        // MEDIA 2 — corte corto (falso negativo de ML Kit 'fast' a 10 fps): se mantiene la última cara
        // conocida, con sus gestos congelados, hasta que pase seFueMs. Así `principal` no parpadea a null
        // (y la frase no dice «No veo a nadie ahora.» con personas en 1).
        principal = this.ultimoPrincipal;
      }
    }

    // --- dos personas: estable 1 s para entrar y dosPersonasOffMs de ausencia de la segunda cara para
    //     poder re-anunciar (una cara que parpadea en el borde no repite el evento).
    if (o.personas >= 2) {
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

    // Antes del «llego» la persona todavía no cuenta como presente (evita parpadeos de detección).
    const personas = this.presente ? Math.max(1, o.personas) : o.personas >= 2 ? o.personas : 0;
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
