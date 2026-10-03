/**
 * EL VISOR DE SU COMPUTADORA, LA LÓGICA (sin React Native; AUR09 del documento maestro del 3-oct).
 *
 * El visor dedicado (app/VisorComputadora.tsx) muestra el escritorio de la computadora en la nube a pantalla completa
 * y deja usarlo de verdad. Todo lo que decide va aquí, probado en Node (tests/visor-computadora.test.ts):
 *
 *  · UNA sola capa de transformación de coordenadas: la vista guarda su zoom y su centro en píxeles LÓGICOS del
 *    escritorio (los del frame, 1280x800), no en píxeles del teléfono; así rotar, abrir el teclado o cambiar de
 *    tamaño recalcula la transformación sin desalinear nada. Un toque se pasa a píxel lógico con `aLogico` y nada más.
 *  · Gestos (`Gestos`): toque = clic (espera 250 ms por si es doble), doble toque = doble clic, toque largo = clic
 *    derecho, mantener y mover = arrastre, mover = scroll (nunca un clic) y dos dedos = zoom y pan de la VISTA (no
 *    tocan el escritorio).
 *  · Teclado (`BufferTeclado`, `Modificadores`): el texto se escribe en el campo del teléfono (con su IME: acentos,
 *    dictado, emoji) y se manda COMPUESTO al confirmar (text_commit), no tecla por tecla: nada de keydown + texto
 *    duplicados. Teclas especiales y combinaciones de una lista blanca (la misma del servidor y del nodo).
 *    Ctrl/Shift/Alt se arman para la tecla siguiente y se sueltan en blur, desconexión, toma del control y error.
 *  · Frescura (`edadFrame`, `bloqueoDeEntrada`): la edad del frame sale del servidor (no de la hora del teléfono);
 *    a más de 2 s se avisa, y lo riesgoso (clics, Enter, Supr, combinaciones) espera una imagen de ahora.
 *  · La sesión (`SesionRemota`): cada entrada lleva sesión, cliente, época, secuencia y viewport; una a la vez, con
 *    su ACK; lo bloqueado no gasta secuencia y, tras reconectar, lo que no se confirmó NO se reenvía.
 */

/* ------------------------------------------------------------------ coordenadas: una sola capa */

export type Tam = { ancho: number; alto: number };
export type Punto = { x: number; y: number };
/** La vista: cuánto zoom (1 = ajustar) y qué punto del escritorio (en píxeles lógicos) queda en el centro de la caja. */
export type VistaZoom = { zoom: number; centro: Punto };
/** pantalla = lógico · s + t (en píxeles de la caja del visor). */
export type Transformacion = { s: number; tx: number; ty: number };

export const ZOOM_MAX = 4;

/** Ajustar: todo el escritorio a la vista, centrado. */
export function vistaAjustada(frame: Tam): VistaZoom {
  return { zoom: 1, centro: { x: frame.ancho / 2, y: frame.alto / 2 } };
}

function escalaBase(caja: Tam, frame: Tam): number {
  return Math.min(caja.ancho / Math.max(1, frame.ancho), caja.alto / Math.max(1, frame.alto));
}

/** El zoom entre 1 y 4, y el centro donde la imagen no deja huecos (si es más chica que la caja, centrada). */
export function limitarVista(caja: Tam, frame: Tam, v: VistaZoom): VistaZoom {
  const zoom = Math.max(1, Math.min(ZOOM_MAX, Number.isFinite(v.zoom) ? v.zoom : 1));
  const s = escalaBase(caja, frame) * zoom;
  const eje = (c: number, total: number, cajaEje: number) => {
    const medio = cajaEje / 2 / s;
    if (total * s <= cajaEje) return total / 2;
    return Math.max(medio, Math.min(total - medio, Number.isFinite(c) ? c : total / 2));
  };
  return { zoom, centro: { x: eje(v.centro.x, frame.ancho, caja.ancho), y: eje(v.centro.y, frame.alto, caja.alto) } };
}

/** La transformación de ESTA caja (la de ahora: rotada, con el teclado abierto…) para la vista. */
export function transformacion(caja: Tam, frame: Tam, v: VistaZoom): Transformacion {
  const l = limitarVista(caja, frame, v);
  const s = escalaBase(caja, frame) * l.zoom;
  return { s, tx: caja.ancho / 2 - l.centro.x * s, ty: caja.alto / 2 - l.centro.y * s };
}

/** Un punto de la caja en píxel lógico del escritorio; null si cae fuera de la imagen (no es un clic). */
export function aLogico(T: Transformacion, frame: Tam, px: number, py: number): Punto | null {
  const x = (px - T.tx) / T.s;
  const y = (py - T.ty) / T.s;
  if (!(x >= 0 && y >= 0 && x < frame.ancho && y < frame.alto)) return null;
  return { x: Math.min(frame.ancho - 1, Math.floor(x)), y: Math.min(frame.alto - 1, Math.floor(y)) };
}

export function aPantalla(T: Transformacion, x: number, y: number): Punto {
  return { x: x * T.s + T.tx, y: y * T.s + T.ty };
}

/** Zoom por `factor` dejando quieto el punto bajo `foco` (el medio de los dos dedos, o donde tocó). */
export function zoomEn(caja: Tam, frame: Tam, v: VistaZoom, factor: number, foco: Punto): VistaZoom {
  const T = transformacion(caja, frame, v);
  const p = { x: (foco.x - T.tx) / T.s, y: (foco.y - T.ty) / T.s };
  const zoom = Math.max(1, Math.min(ZOOM_MAX, limitarVista(caja, frame, v).zoom * (Number.isFinite(factor) && factor > 0 ? factor : 1)));
  const s = escalaBase(caja, frame) * zoom;
  const tx = foco.x - p.x * s;
  const ty = foco.y - p.y * s;
  return limitarVista(caja, frame, { zoom, centro: { x: (caja.ancho / 2 - tx) / s, y: (caja.alto / 2 - ty) / s } });
}

/** Mover la vista con los dedos (en píxeles de la caja). */
export function desplazar(caja: Tam, frame: Tam, v: VistaZoom, dx: number, dy: number): VistaZoom {
  const l = limitarVista(caja, frame, v);
  const s = escalaBase(caja, frame) * l.zoom;
  return limitarVista(caja, frame, { zoom: l.zoom, centro: { x: l.centro.x - dx / s, y: l.centro.y - dy / s } });
}

/** El botón Ajustar / Zoom: con zoom vuelve a ajustar; ajustada, acerca al doble (en `foco` o en el centro). */
export function alternarZoom(caja: Tam, frame: Tam, v: VistaZoom, foco?: Punto): VistaZoom {
  if (limitarVista(caja, frame, v).zoom > 1.01) return vistaAjustada(frame);
  return zoomEn(caja, frame, vistaAjustada(frame), 2, foco ?? { x: caja.ancho / 2, y: caja.alto / 2 });
}

/** Para el servicio de antes (sin el contrato de entradas): coordenadas en [0, 1000]. */
export function aNormalizado(p: Punto, frame: Tam): Punto {
  const c = (v: number, total: number) => Math.max(0, Math.min(1000, Math.round((v / Math.max(1, total)) * 1000)));
  return { x: c(p.x, frame.ancho), y: c(p.y, frame.alto) };
}

/* ------------------------------------------------------------------ gestos */

export type Gesto =
  | { tipo: 'toque'; x: number; y: number }
  | { tipo: 'doble'; x: number; y: number }
  | { tipo: 'derecho'; x: number; y: number }
  | { tipo: 'arrastre'; x: number; y: number; x2: number; y2: number }
  /** Lo que se movió el dedo desde el aviso anterior (píxeles de la caja), con la rueda puesta donde empezó. */
  | { tipo: 'scroll'; x: number; y: number; dx: number; dy: number }
  | { tipo: 'zoom'; factor: number; foco: Punto }
  | { tipo: 'pan'; dx: number; dy: number };

type OpcionesGestos = { reloj?: () => number; slop?: number; largoMs?: number; dobleMs?: number; dobleDist?: number };

/**
 * Los gestos sobre la pantalla del escritorio, como una máquina de estados (la vista le pasa los toques de
 * PanResponder y hace lo que devuelve). Un dedo que se mueve más de `slop` ya nunca es un clic.
 */
export class Gestos {
  private reloj: () => number;
  private slop: number;
  private largoMs: number;
  private dobleMs: number;
  private dobleDist: number;
  private estado: 'nada' | 'posible' | 'scroll' | 'arrastre' | 'pinza' = 'nada';
  private inicioP: Punto = { x: 0, y: 0 };
  private inicioT = 0;
  private ultimoP: Punto = { x: 0, y: 0 };
  private pinza: { dist: number; medio: Punto } | null = null;
  /** Un toque que todavía puede ser la primera mitad de un doble. */
  private pendiente: { x: number; y: number; t: number } | null = null;

  constructor(o: OpcionesGestos = {}) {
    this.reloj = o.reloj ?? Date.now;
    this.slop = o.slop ?? 10;
    this.largoMs = o.largoMs ?? 450;
    this.dobleMs = o.dobleMs ?? 250;
    this.dobleDist = o.dobleDist ?? 24;
  }

  /** Empezó un dedo (con todos los que hay ahora). */
  inicio(toques: Punto[]): Gesto[] {
    if (toques.length >= 2) {
      this.estado = 'pinza';
      this.pinza = { dist: distancia(toques[0], toques[1]), medio: medio(toques[0], toques[1]) };
      return [];
    }
    if (this.estado === 'pinza' || !toques.length) return [];
    this.estado = 'posible';
    this.inicioP = { ...toques[0] };
    this.ultimoP = { ...toques[0] };
    this.inicioT = this.reloj();
    return [];
  }

  mover(toques: Punto[]): Gesto[] {
    if (this.estado === 'pinza') {
      if (toques.length < 2 || !this.pinza) return [];
      const d = distancia(toques[0], toques[1]);
      const m = medio(toques[0], toques[1]);
      const out: Gesto[] = [];
      if (this.pinza.dist > 0 && d > 0 && Math.abs(d / this.pinza.dist - 1) > 1e-6) out.push({ tipo: 'zoom', factor: d / this.pinza.dist, foco: m });
      const dx = m.x - this.pinza.medio.x;
      const dy = m.y - this.pinza.medio.y;
      if (dx || dy) out.push({ tipo: 'pan', dx, dy });
      this.pinza = { dist: d, medio: m };
      return out;
    }
    if (this.estado === 'nada' || !toques.length) return [];
    const p = toques[0];
    if (this.estado === 'posible') {
      if (distancia(p, this.inicioP) <= this.slop) return [];
      // Lo mantuvo quieto antes de moverse: arrastre. Si no: scroll.
      this.estado = this.reloj() - this.inicioT >= this.largoMs ? 'arrastre' : 'scroll';
      if (this.estado === 'arrastre') {
        this.ultimoP = { ...p };
        return [];
      }
    }
    if (this.estado === 'arrastre') {
      this.ultimoP = { ...p };
      return [];
    }
    const dx = p.x - this.ultimoP.x;
    const dy = p.y - this.ultimoP.y;
    this.ultimoP = { ...p };
    return dx || dy ? [{ tipo: 'scroll', x: this.inicioP.x, y: this.inicioP.y, dx, dy }] : [];
  }

  /** Se levantó un dedo (`quedan`: los que siguen). */
  fin(quedan: Punto[]): Gesto[] {
    if (quedan.length) return []; // con dedos todavía abajo no se decide nada
    const estado = this.estado;
    this.estado = 'nada';
    this.pinza = null;
    const ahora = this.reloj();
    if (estado === 'arrastre') return [{ tipo: 'arrastre', x: this.inicioP.x, y: this.inicioP.y, x2: this.ultimoP.x, y2: this.ultimoP.y }];
    if (estado !== 'posible') return [];
    const { x, y } = this.inicioP;
    if (ahora - this.inicioT >= this.largoMs) {
      this.pendiente = null;
      return [{ tipo: 'derecho', x, y }];
    }
    const p = this.pendiente;
    if (p && ahora - p.t <= this.dobleMs + this.largoMs && distancia(p, { x, y }) <= this.dobleDist) {
      this.pendiente = null;
      return [{ tipo: 'doble', x: p.x, y: p.y }];
    }
    const salen: Gesto[] = p ? [{ tipo: 'toque', x: p.x, y: p.y }] : [];
    this.pendiente = { x, y, t: ahora };
    return salen;
  }

  /** Cada poco (la vista llama con un reloj): el toque que ya no puede ser doble sale como clic. */
  tick(): Gesto[] {
    const p = this.pendiente;
    if (!p || this.estado === 'posible' || this.reloj() - p.t < this.dobleMs) return [];
    this.pendiente = null;
    return [{ tipo: 'toque', x: p.x, y: p.y }];
  }

  cancelar() {
    this.estado = 'nada';
    this.pinza = null;
    this.pendiente = null;
  }
}

const distancia = (a: Punto, b: Punto) => Math.hypot(a.x - b.x, a.y - b.y);
const medio = (a: Punto, b: Punto): Punto => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

/** El movimiento del dedo (en píxeles lógicos) en pasos de rueda: el dedo sube → la página baja (positivo). */
export class AcumuladorScroll {
  private acumulado = 0;
  constructor(private porPaso = 40) {}
  sumar(dedoDy: number): number {
    this.acumulado += -dedoDy;
    const n = Math.trunc(this.acumulado / this.porPaso);
    this.acumulado -= n * this.porPaso;
    return Math.max(-10, Math.min(10, n));
  }
  reiniciar() {
    this.acumulado = 0;
  }
}

/* ------------------------------------------------------------------ teclado */

export type Mod = 'ctrl' | 'shift' | 'alt';
const MODS: readonly Mod[] = ['ctrl', 'shift', 'alt'];
const TECLAS_ESPECIALES = ['enter', 'tab', 'escape', 'backspace', 'delete', 'up', 'down', 'left', 'right', 'home', 'end', 'pageup', 'pagedown', 'space', 'f5'];
const NAVEGACION = ['up', 'down', 'left', 'right', 'home', 'end', 'pageup', 'pagedown'];
/** Ctrl + letra: seleccionar todo, copiar, pegar, cortar, deshacer, rehacer, buscar, barra, recargar, pestaña nueva y cerrarla. */
const LETRAS_CTRL = 'acvxzyflrtw'.split('');

/** La lista blanca de teclas y combinaciones (la misma de server/computadora.ts y agente.py). */
export function comboPermitido(mods: readonly string[], tecla: string): boolean {
  const m = new Set(mods);
  if ([...m].some((x) => !(MODS as readonly string[]).includes(x))) return false;
  const es = (...xs: string[]) => m.size === xs.length && xs.every((x) => m.has(x));
  if (m.size === 0) return TECLAS_ESPECIALES.includes(tecla);
  if (es('shift')) return [...NAVEGACION, 'tab', 'enter'].includes(tecla);
  if (es('ctrl')) return LETRAS_CTRL.includes(tecla) || [...NAVEGACION, 'backspace', 'delete', 'enter', 'tab'].includes(tecla);
  if (es('ctrl', 'shift')) return [...NAVEGACION, 'z', 't', 'tab'].includes(tecla);
  if (es('alt')) return tecla === 'left' || tecla === 'right';
  return false;
}

/** Ctrl, Shift y Alt «armados» para la tecla siguiente (se usan una vez; se sueltan en blur, desconexión, toma y error). */
export class Modificadores {
  private armados = new Set<Mod>();
  alternar(m: Mod) {
    if (this.armados.has(m)) this.armados.delete(m);
    else this.armados.add(m);
  }
  activos(): Mod[] {
    return MODS.filter((m) => this.armados.has(m));
  }
  /** Los de esta tecla, y quedan sueltos. */
  consumir(): Mod[] {
    const a = this.activos();
    this.armados.clear();
    return a;
  }
  /** Suelta todo; true si había alguno armado. */
  soltarTodo(): boolean {
    const habia = this.armados.size > 0;
    this.armados.clear();
    return habia;
  }
}

/** El texto como se escribe en la computadora: compuesto (NFC: e + ´ = é) y sin caracteres de control. */
export function normalizarTexto(t: string): string {
  return String(t ?? '')
    .normalize('NFC')
    .replace(/[\u0000-\u001f\u007f]/g, '');
}

/** ¿El punto de código `c` se pega al anterior (no se puede partir antes de él)? */
const SE_PEGA = (c: number) =>
  c === 0x200d || (c >= 0xfe00 && c <= 0xfe0f) || (c >= 0x1f3fb && c <= 0x1f3ff) || (c >= 0x300 && c <= 0x36f) || (c >= 0xe0020 && c <= 0xe007f) || c === 0x20e3;
const BANDERA = (c: number) => c >= 0x1f1e6 && c <= 0x1f1ff;

/** Partes de como mucho `max` (en unidades de JS, como cuenta el servidor) sin partir un emoji, una bandera ni un acento. */
export function trocearTexto(t: string, max = 500): string[] {
  const racimos: string[] = [];
  const cps = Array.from(t);
  for (let i = 0; i < cps.length; i++) {
    const c = cps[i].codePointAt(0)!;
    const prev = i > 0 ? cps[i - 1].codePointAt(0)! : -1;
    const ultimo = racimos.length - 1;
    const pegar = ultimo >= 0 && (SE_PEGA(c) || prev === 0x200d || (BANDERA(c) && BANDERA(prev) && Array.from(racimos[ultimo]).length % 2 === 1));
    if (pegar) racimos[ultimo] += cps[i];
    else racimos.push(cps[i]);
  }
  const out: string[] = [];
  let actual = '';
  for (const r of racimos) {
    if (actual && actual.length + r.length > max) {
      out.push(actual);
      actual = '';
    }
    actual += r;
  }
  if (actual) out.push(actual);
  return out;
}

export type EventoTeclado = { type: 'text_commit'; payload: { texto: string } } | { type: 'key'; payload: { tecla: string; mods: Mod[] } };

/**
 * El campo de escribir del visor. Mientras la persona escribe (con su IME, que compone, corrige y dicta) no se manda
 * nada; al confirmar sale el texto FINAL como text_commit (y Enter si lo pidió). Con Ctrl o Alt armados, la letra
 * que entra es una combinación (si está en la lista) y no se queda en el campo.
 */
export class BufferTeclado {
  texto = '';

  /** El campo cambió: devuelve la combinación para mandar YA (Ctrl/Alt + letra), o null. */
  cambiar(nuevo: string, mods: readonly Mod[]): EventoTeclado | null {
    const conCombo = mods.includes('ctrl') || mods.includes('alt');
    if (conCombo && nuevo.startsWith(this.texto)) {
      const agregado = Array.from(nuevo.slice(this.texto.length));
      if (agregado.length === 1) {
        const tecla = agregado[0].toLowerCase();
        return comboPermitido(mods, tecla) ? { type: 'key', payload: { tecla, mods: [...mods] } } : null;
      }
    }
    this.texto = nuevo;
    return null;
  }

  /** Confirmar (botón Enviar o la tecla de retorno del teclado): el texto compuesto en trozos, con Enter si `conEnter`. */
  confirmar(conEnter: boolean): EventoTeclado[] {
    const out: EventoTeclado[] = [];
    const lineas = this.texto.split(/\r\n|\r|\n/);
    lineas.forEach((l, i) => {
      if (i > 0) out.push({ type: 'key', payload: { tecla: 'enter', mods: [] } });
      for (const trozo of trocearTexto(normalizarTexto(l), 500)) out.push({ type: 'text_commit', payload: { texto: trozo } });
    });
    if (conEnter) out.push({ type: 'key', payload: { tecla: 'enter', mods: [] } });
    this.texto = '';
    return out;
  }
}

/* ------------------------------------------------------------------ frescura y control */

/** El frame que da el servidor con la pantalla (server/computadora.ts, FrameNodo + su edad al salir). */
export type FrameMeta = { seq: number; ts: number; ancho: number; alto: number; viewportRevision: number; epoca: number | null; privado: boolean; edadMs: number };
export type TipoEntrada = 'pointer' | 'scroll' | 'key' | 'text_commit' | 'release_all';
export const FRAME_VIEJO_MS = 2000;

/** La edad del frame: la que tenía al salir del servidor más lo que lleva aquí (sin la hora del teléfono). */
export function edadFrame(meta: Pick<FrameMeta, 'edadMs'>, recibidoEn: number, ahora: number): number {
  return Math.max(0, meta.edadMs) + Math.max(0, ahora - recibidoEn);
}

/** Lo que no se hace sobre una imagen vieja: clics, Enter, Supr, Borrar y las combinaciones con Ctrl o Alt. */
export function esRiesgosa(tipo: TipoEntrada, payload: Record<string, any>): boolean {
  if (tipo === 'pointer') return true;
  if (tipo !== 'key') return false;
  const mods: string[] = Array.isArray(payload?.mods) ? payload.mods : [];
  return mods.includes('ctrl') || mods.includes('alt') || ['enter', 'delete', 'backspace', 'space'].includes(String(payload?.tecla));
}

export type Bloqueo = null | 'sin_frame' | 'viejo' | 'resync' | 'tras_entrada';

/**
 * ¿Esta entrada espera? Lo riesgoso, sin imagen, con una de más de 2 s, mientras falta la imagen nueva que se pidió
 * (al tomar el control, al reconectar, si cambió la pantalla) o la de después de la última entrada. Lo demás (bajar,
 * escribir, Tab, flechas) pasa; soltar todo, siempre.
 */
export function bloqueoDeEntrada(o: {
  tipo: TipoEntrada;
  payload: Record<string, any>;
  frame: { meta: FrameMeta; recibidoEn: number } | null;
  ahora: number;
  resyncDesde: number | null;
  ultimoAckFrame: number | null;
  /** La época del control que se tiene: una imagen de una época anterior no es la de ahora. */
  epoca?: number | null;
}): Bloqueo {
  if (o.tipo === 'release_all' || !esRiesgosa(o.tipo, o.payload)) return null;
  if (!o.frame) return 'sin_frame';
  if (edadFrame(o.frame.meta, o.frame.recibidoEn, o.ahora) > FRAME_VIEJO_MS) return 'viejo';
  if (o.resyncDesde != null && o.frame.meta.seq <= o.resyncDesde) return 'resync';
  if (o.epoca != null && o.frame.meta.epoca != null && o.frame.meta.epoca < o.epoca) return 'resync';
  if (o.ultimoAckFrame != null && o.frame.meta.seq <= o.ultimoAckFrame) return 'tras_entrada';
  return null;
}

/** El indicador del visor: «AURA controla», «Solicitando control», «Tú controlas» o «Sin conexión». */
export type ModoControl = 'aura' | 'pidiendo' | 'tu' | 'sin_conexion';
export function modoDeControl(o: { estado: string | null | undefined; conectado: boolean; pidiendo: boolean }): ModoControl {
  if (!o.conectado) return 'sin_conexion';
  if (o.estado === 'control') return 'tu';
  if (o.pidiendo) return 'pidiendo';
  return 'aura';
}

/**
 * Cada cuánto se pide la pantalla: con el control en sus manos, cada ~0,7 s contando lo que tardó la anterior (nunca
 * dos a la vez: se pide la siguiente cuando llega la anterior, y nunca antes de 250 ms); mientras AURA trabaja, cada 2 s.
 */
export function intervaloCaptura(modo: ModoControl, duracionUltimaMs: number): number {
  if (modo === 'tu' || modo === 'pidiendo') return Math.max(250, 700 - Math.max(0, duracionUltimaMs));
  return 2000;
}

/* ------------------------------------------------------------------ la sesión remota */

export type EntradaRemota = {
  remoteSessionId: string;
  clientId: string;
  controlEpoch: number;
  inputSequence: number;
  viewportRevision: number;
  type: TipoEntrada;
  payload: Record<string, unknown>;
};
export type AckEntrada = { secuencia: number; estado: string; ts: number; frame_seq: number; epoca: number; duplicada?: boolean };
export type ResultadoEntrada = { ok: true; ack: AckEntrada } | { ok: false; motivo: string; error?: string };

/** Un id de cliente para este visor (el servidor lo liga a la sesión: solo no da autoridad). */
export function nuevoClienteId(): string {
  return `visor-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Las entradas de UNA sesión remota (la tarea) desde este visor: la época del control que se tiene, la secuencia
 * (empieza en cada control), una entrada a la vez y su ACK. Lo bloqueado no gasta secuencia. Si se corta la red,
 * lo que esperaba en la cola se descarta (no se reproduce), se sueltan los modificadores, se pide imagen nueva y,
 * al volver, se manda release_all. Si otro dispositivo tomó el control (o el control cambió), se deja de mandar.
 */
export class SesionRemota {
  readonly mods = new Modificadores();
  epoca: number | null = null;
  frame: { meta: FrameMeta; recibidoEn: number } | null = null;
  resyncDesde: number | null = null;
  ultimoAckFrame: number | null = null;
  ultimoAck: AckEntrada | null = null;
  private seq = 0;
  private generacion = 0;
  private cadena: Promise<unknown> = Promise.resolve();
  private soltarAlVolver = false;
  private reloj: () => number;

  constructor(private o: { tareaId: string; clientId: string; enviar: (e: EntradaRemota) => Promise<AckEntrada>; reloj?: () => number; alCambio?: () => void }) {
    this.reloj = o.reloj ?? Date.now;
  }

  get clientId() {
    return this.o.clientId;
  }

  /** Se tomó el control (o se recuperó desde aquí): esta época, secuencia nueva, todo suelto y una imagen nueva. */
  alControl(epoca: number) {
    this.epoca = epoca;
    this.seq = 0;
    this.generacion += 1;
    this.ultimoAckFrame = null;
    this.soltarAlVolver = false;
    this.mods.soltarTodo();
    this.pedirResync();
  }

  /** Ya no tiene el control (lo devolvió, terminó, otro lo tomó): nada más sale de aquí. */
  sinControl() {
    this.epoca = null;
    this.generacion += 1;
    this.mods.soltarTodo();
    this.cambio();
  }

  alFrame(meta: FrameMeta, recibidoEn: number) {
    this.frame = { meta, recibidoEn };
    this.cambio();
  }

  /** Lo riesgoso espera una imagen más nueva que la de ahora. */
  pedirResync() {
    this.resyncDesde = this.frame?.meta.seq ?? -1;
    this.cambio();
  }

  /** ¿Lo riesgoso esperaría ahora? (para pintarlo en el visor). */
  bloqueo(tipo: TipoEntrada = 'pointer', payload: Record<string, any> = { accion: 'click' }): Bloqueo {
    return bloqueoDeEntrada({ tipo, payload, frame: this.frame, ahora: this.reloj(), resyncDesde: this.resyncDesde, ultimoAckFrame: this.ultimoAckFrame, epoca: this.epoca });
  }

  /** Se cortó la red (o la app se fue atrás): la cola se descarta, todo suelto y, al volver, release_all. */
  alDesconectar() {
    this.generacion += 1;
    this.mods.soltarTodo();
    this.soltarAlVolver = this.epoca != null;
    this.pedirResync();
  }

  /** Volvió la red: si había control, se sueltan teclas y botones allá también (con una secuencia nueva). */
  async alReconectar(): Promise<void> {
    if (!this.soltarAlVolver || this.epoca == null) return;
    this.soltarAlVolver = false;
    await this.entrada('release_all', {});
  }

  /** Una entrada: espera su turno, se revisa en ese momento y sale con la secuencia siguiente. */
  entrada(tipo: TipoEntrada, payload: Record<string, unknown>): Promise<ResultadoEntrada> {
    const gen = this.generacion;
    const r = this.cadena.then(() => this.mandar(gen, tipo, payload));
    this.cadena = r.catch(() => undefined);
    return r;
  }

  private async mandar(gen: number, tipo: TipoEntrada, payload: Record<string, unknown>): Promise<ResultadoEntrada> {
    if (gen !== this.generacion) return { ok: false, motivo: 'desconectado' };
    if (this.epoca == null) return { ok: false, motivo: 'sin_control' };
    const b = this.bloqueo(tipo, payload);
    if (b) return { ok: false, motivo: b };
    const e: EntradaRemota = {
      remoteSessionId: this.o.tareaId,
      clientId: this.o.clientId,
      controlEpoch: this.epoca,
      inputSequence: ++this.seq,
      viewportRevision: this.frame?.meta.viewportRevision ?? 0,
      type: tipo,
      payload,
    };
    try {
      const ack = await this.o.enviar(e);
      this.ultimoAck = ack;
      if (tipo !== 'release_all') this.ultimoAckFrame = Number.isFinite(ack?.frame_seq) ? ack.frame_seq : this.frame?.meta.seq ?? null;
      this.cambio();
      return { ok: true, ack };
    } catch (err: any) {
      const code: string | undefined = err?.data?.code;
      const status: number | undefined = err?.status;
      if (!status) {
        this.alDesconectar();
        return { ok: false, motivo: 'desconectado' };
      }
      // Cualquier error suelta los modificadores armados (no quedan «pegados» para la tecla siguiente).
      this.mods.soltarTodo();
      if (code === 'cliente' || code === 'epoca_revocada' || code === 'sin_control' || code === 'epoca_cambio') this.sinControl();
      else if (code === 'viewport' || code === 'incierta') this.pedirResync();
      this.cambio();
      return { ok: false, motivo: code || `http_${status}`, error: String(err?.message || '') };
    }
  }

  private cambio() {
    try {
      this.o.alCambio?.();
    } catch {
      /* un oyente roto no rompe nada */
    }
  }
}
