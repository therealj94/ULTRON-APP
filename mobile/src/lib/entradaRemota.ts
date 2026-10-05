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
 *  · El lote de teclado (`LoteTeclado`, auditoría A3 del 4-oct): un texto con su Enter, o un pegado de varias líneas,
 *    sale como una secuencia que espera el ACK y la imagen de después antes del siguiente evento; ante un rechazo,
 *    una desconexión o un cambio de control se pausa y conserva lo que falta, y lo incierto no se repite solo.
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
  /**
   * El texto del lote que está saliendo (auditoría A3): no se borra hasta saber cómo le fue. Mientras no es null el
   * campo queda quieto (no se edita ni se confirma otra vez); `aplicado` lo vacía, `devolver` lo deja editable.
   */
  enviando: string | null = null;

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

  /**
   * Confirmar (botón Enviar o la tecla de retorno del teclado): el texto compuesto en trozos, con Enter si `conEnter`.
   * El campo NO se vacía aquí (antes sí, y lo que no llegaba se perdía): queda como `enviando` hasta que el lote diga
   * cómo le fue. Con un lote en camino no sale otro.
   */
  confirmar(conEnter: boolean): EventoTeclado[] {
    if (this.enviando != null) return [];
    const out = eventosDeTexto(this.texto, conEnter);
    if (out.length) this.enviando = this.texto;
    return out;
  }

  /** Todo llegó: el campo queda vacío. */
  aplicado() {
    this.texto = '';
    this.enviando = null;
  }

  /** El lote está en pausa: el campo enseña lo que falta (sigue quieto hasta seguir o recuperar). */
  mostrarPendiente(t: string) {
    this.texto = t;
  }

  /** Lo que no llegó vuelve al campo, editable. */
  devolver(t: string) {
    this.texto = t;
    this.enviando = null;
  }
}

/** El texto como eventos: cada línea en trozos de text_commit y cada salto como la tecla Enter (más Enter al final si se pidió). */
export function eventosDeTexto(texto: string, conEnter: boolean): EventoTeclado[] {
  const out: EventoTeclado[] = [];
  const lineas = String(texto ?? '').split(/\r\n|\r|\n/);
  lineas.forEach((l, i) => {
    if (i > 0) out.push({ type: 'key', payload: { tecla: 'enter', mods: [] } });
    for (const trozo of trocearTexto(normalizarTexto(l), 500)) out.push({ type: 'text_commit', payload: { texto: trozo } });
  });
  if (conEnter) out.push({ type: 'key', payload: { tecla: 'enter', mods: [] } });
  return out;
}

/** Al revés: los eventos de texto como se ven en el campo (Enter = salto de línea; el Enter final aparte). */
export function textoDeEventos(eventos: readonly EventoTeclado[]): { texto: string; conEnter: boolean } {
  let texto = '';
  let conEnter = false;
  eventos.forEach((e, i) => {
    if (e.type === 'text_commit') texto += e.payload.texto;
    else if (e.payload.tecla === 'enter' && !e.payload.mods.length) {
      if (i === eventos.length - 1) conEnter = true;
      else texto += '\n';
    }
  });
  return { texto, conEnter };
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
/**
 * `incierta`: salió y no se sabe si se aplicó (se cortó la red esperando el ACK, o el servidor dice que el nodo no
 * contestó). Lo incierto no se repite solo: la persona mira la pantalla y decide (auditoría A3).
 */
export type ResultadoEntrada = { ok: true; ack: AckEntrada } | { ok: false; motivo: string; error?: string; incierta?: true };
/** Lo que espera la imagen de después: llegó, o por qué no (se cortó, otro tomó el control, se acabó el plazo). */
export type EsperaImagen = { ok: true } | { ok: false; motivo: string };

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
  /** Quien espera una imagen de después (el lote de teclado): se le avisa con cada cambio. */
  private esperas = new Set<() => void>();

  constructor(private o: { tareaId: string; clientId: string; enviar: (e: EntradaRemota) => Promise<AckEntrada>; reloj?: () => number; alCambio?: () => void }) {
    this.reloj = o.reloj ?? Date.now;
  }

  get clientId() {
    return this.o.clientId;
  }

  /** Cambia con cada control nuevo, pérdida del control o corte de red: lo de antes ya no sigue solo. */
  get generacionActual() {
    return this.generacion;
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

  /**
   * Espera, como mucho `plazoMs`, la imagen que pide lo riesgoso (Enter, un clic): una de después de la última entrada,
   * de esta época y de menos de 2 s. La guarda de frame fresco NO se relaja: esto solo espera a que se cumpla. Si en
   * medio se corta la red o cambia el control, se deja de esperar y se dice por qué.
   */
  esperarImagen(plazoMs: number, cancelada?: () => string | null): Promise<EsperaImagen> {
    const gen = this.generacion;
    const epoca0 = this.epoca;
    return new Promise<EsperaImagen>((resolve) => {
      let hecho = false;
      let reloj: ReturnType<typeof setTimeout> | null = null;
      const fin = (r: EsperaImagen) => {
        if (hecho) return;
        hecho = true;
        if (reloj) clearTimeout(reloj);
        this.esperas.delete(mirar);
        resolve(r);
      };
      const mirar = () => {
        const c = cancelada?.();
        if (c) return fin({ ok: false, motivo: c });
        if (this.epoca == null) return fin({ ok: false, motivo: 'sin_control' });
        if (this.epoca !== epoca0) return fin({ ok: false, motivo: 'epoca_cambio' });
        if (gen !== this.generacion) return fin({ ok: false, motivo: 'desconectado' });
        if (!this.bloqueo('key', { tecla: 'enter', mods: [] })) fin({ ok: true });
      };
      this.esperas.add(mirar);
      mirar();
      if (!hecho) reloj = setTimeout(() => fin({ ok: false, motivo: this.bloqueo('key', { tecla: 'enter', mods: [] }) || 'sin_imagen' }), Math.max(0, plazoMs));
    });
  }

  /** Que quien espera una imagen vuelva a mirar ya (p. ej. porque se pausó lo que esperaba). */
  despertar() {
    for (const f of [...this.esperas]) f();
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
        // Salió y no volvió el ACK: no se sabe si se aplicó (A3: la incertidumbre se conserva, no se repite sola).
        this.alDesconectar();
        return { ok: false, motivo: 'desconectado', incierta: true };
      }
      // Cualquier error suelta los modificadores armados (no quedan «pegados» para la tecla siguiente).
      this.mods.soltarTodo();
      if (code === 'cliente' || code === 'epoca_revocada' || code === 'sin_control' || code === 'epoca_cambio') this.sinControl();
      else if (code === 'viewport' || code === 'incierta') this.pedirResync();
      this.cambio();
      // 4xx: el servidor o el nodo la rechazó (no se aplicó). 5xx o «incierta»: pudo aplicarse o no.
      const incierta = code === 'incierta' || status >= 500;
      return { ok: false, motivo: code || `http_${status}`, error: String(err?.message || ''), ...(incierta ? { incierta: true as const } : {}) };
    }
  }

  private cambio() {
    this.despertar();
    try {
      this.o.alCambio?.();
    } catch {
      /* un oyente roto no rompe nada */
    }
  }
}

/* ------------------------------------------------------------------ el lote de teclado (auditoría A3) */

/** Cuánto espera el lote la imagen de después antes de pausarse (con el control, la captura va cada ~0,7 s). */
export const PLAZO_IMAGEN_MS = 5000;

export type FaseLote = 'libre' | 'enviando' | 'esperando_imagen' | 'pausada';
export type ResultadoLote = { ok: true; aplicados: number } | { ok: false; motivo: string; aplicados: number; pendientes: number; incierto: boolean };

const ENTER_SONDA = { tecla: 'enter', mods: [] as Mod[] };
const MOTIVOS_GUARDA = new Set(['tras_entrada', 'resync', 'viejo', 'sin_frame']);

/**
 * Lo que se escribe de una vez (un texto, un pegado de varias líneas, el Enter de después) como UNA secuencia:
 *
 *  · cada evento espera su ACK antes del siguiente, y lo riesgoso (Enter) o lo que sigue a un Enter espera además la
 *    imagen de después (la guarda de frame fresco de `SesionRemota` se cumple esperando, no se quita);
 *  · un rechazo PAUSA el lote y conserva lo no aplicado (nada se vacía antes de saber cómo le fue): se puede seguir o
 *    recuperar al campo;
 *  · si se corta la red, otro toma el control o se cierra la vista, se pausa; nada sigue solo al volver;
 *  · lo incierto (salió y no volvió el ACK) queda aparte: no se repite hasta que la persona mire la pantalla y diga
 *    si llegó (`resolverIncierto`). Así un Enter nunca sale dos veces sin reconciliar;
 *  · `privado` (entrada segura): lo pendiente no se enseña en avisos y se tira al salir de la entrada segura.
 */
export class LoteTeclado {
  pendientes: EventoTeclado[] = [];
  aplicados = 0;
  incierto: EventoTeclado | null = null;
  motivo: string | null = null;
  privado = false;
  private fase: FaseLote = 'libre';
  private corriendo: Promise<ResultadoLote> | null = null;
  private trasRiesgosa = false;
  private pausaPedida: string | null = null;

  constructor(private o: { sesion: SesionRemota; pedirImagen?: () => void; plazoImagenMs?: number; alCambio?: () => void }) {}

  estado(): FaseLote {
    return this.fase;
  }

  /** Mandando o esperando la imagen: lo demás (clics, teclas sueltas, otro texto) espera a que termine. */
  ocupado(): boolean {
    return this.fase === 'enviando' || this.fase === 'esperando_imagen';
  }

  /** Hay algo sin terminar (en marcha, en pausa o incierto). */
  abierto(): boolean {
    return this.ocupado() || this.fase === 'pausada' || this.pendientes.length > 0 || !!this.incierto;
  }

  agregar(eventos: readonly EventoTeclado[], o: { privado?: boolean } = {}) {
    if (!this.abierto()) {
      this.aplicados = 0;
      this.trasRiesgosa = false;
      this.privado = false;
    }
    if (o.privado) this.privado = true;
    for (const e of eventos) this.pendientes.push(e.type === 'key' ? { type: 'key', payload: { tecla: e.payload.tecla, mods: [...e.payload.mods] } } : { type: 'text_commit', payload: { texto: e.payload.texto } });
    this.cambio();
  }

  /** Manda lo pendiente, uno a uno, hasta terminar o pausarse. Una sola vuelta a la vez. */
  correr(): Promise<ResultadoLote> {
    if (this.corriendo) return this.corriendo;
    this.pausaPedida = null;
    this.motivo = null;
    const r = this.vuelta().finally(() => {
      this.corriendo = null;
    });
    this.corriendo = r;
    return r;
  }

  /** Seguir tras una pausa. Con algo incierto sin resolver no sale nada (primero mirar la pantalla y decir si llegó). */
  reanudar(): Promise<ResultadoLote> {
    if (this.corriendo) return this.corriendo;
    if (this.incierto) return Promise.resolve(this.pausa('incierto'));
    return this.correr();
  }

  /** Pausar desde fuera (se cerró la vista, se fue la app atrás): lo que va en camino termina; lo siguiente espera. */
  pausar(motivo: string) {
    if (this.ocupado()) {
      this.pausaPedida = motivo;
      this.o.sesion.despertar(); // si esperaba la imagen, deja de esperar ya (y el Enter no sale)
    } else if (this.pendientes.length || this.incierto) this.pausa(motivo);
  }

  /**
   * La persona miró la pantalla: `llego` true, lo incierto cuenta como hecho; false, vuelve al principio de lo pendiente
   * (y saldrá, una sola vez, cuando toque «Seguir»).
   */
  resolverIncierto(llego: boolean) {
    const e = this.incierto;
    if (!e || this.ocupado()) return;
    this.incierto = null;
    if (llego) {
      this.aplicados += 1;
      this.trasRiesgosa = esRiesgosa(e.type, e.payload);
    } else this.pendientes.unshift(e);
    if (!this.pendientes.length) this.cerrar();
    this.cambio();
  }

  /** Lo que falta, como se ve en el campo (sin lo incierto, que se resuelve aparte). */
  textoPendiente(): { texto: string; conEnter: boolean } {
    return textoDeEventos(this.pendientes);
  }

  /** Saca lo pendiente para editarlo en el campo (lo incierto sigue esperando respuesta). */
  recuperar(): { texto: string; conEnter: boolean } {
    if (this.ocupado()) return { texto: '', conEnter: false };
    const t = this.textoPendiente();
    this.pendientes = [];
    if (!this.incierto) this.cerrar();
    this.cambio();
    return t;
  }

  /** Tirar todo lo que falta (también lo incierto). Lo de la entrada segura se tira así al terminarla. */
  descartar() {
    this.pendientes = [];
    if (this.ocupado()) {
      this.pausaPedida = 'descartado';
      this.o.sesion.despertar();
      return;
    }
    this.incierto = null;
    this.cerrar();
    this.cambio();
  }

  private cerrar() {
    this.fase = 'libre';
    this.motivo = null;
    this.privado = false;
  }

  private pausa(motivo: string): ResultadoLote {
    this.fase = 'pausada';
    this.motivo = motivo;
    this.cambio();
    return { ok: false, motivo, aplicados: this.aplicados, pendientes: this.pendientes.length, incierto: !!this.incierto };
  }

  private descartado(): ResultadoLote {
    this.pausaPedida = null;
    this.pendientes = [];
    this.incierto = null;
    const aplicados = this.aplicados;
    this.cerrar();
    this.cambio();
    return { ok: false, motivo: 'descartado', aplicados, pendientes: 0, incierto: false };
  }

  private async vuelta(): Promise<ResultadoLote> {
    const s = this.o.sesion;
    // Si en medio se corta la red o cambia el control (aunque lo que iba en camino llegara), lo siguiente ya no sale solo.
    const gen = s.generacionActual;
    let reintentosGuarda = 0;
    while (this.pendientes.length) {
      if (this.pausaPedida === 'descartado') return this.descartado();
      if (this.pausaPedida) return this.pausa(this.pausaPedida);
      if (s.epoca == null) return this.pausa('sin_control');
      if (s.generacionActual !== gen) return this.pausa('desconectado');
      const ev = this.pendientes[0];
      // Enter (y lo que viene después de un Enter) espera la imagen de después de lo anterior.
      if ((esRiesgosa(ev.type, ev.payload) || this.trasRiesgosa) && s.bloqueo('key', ENTER_SONDA)) {
        this.fase = 'esperando_imagen';
        this.cambio();
        this.o.pedirImagen?.();
        const w = await s.esperarImagen(this.o.plazoImagenMs ?? PLAZO_IMAGEN_MS, () => this.pausaPedida);
        if (this.pausaPedida === 'descartado') return this.descartado();
        if (this.pausaPedida) return this.pausa(this.pausaPedida);
        if (w.ok === false) return this.pausa(w.motivo);
      }
      this.fase = 'enviando';
      this.cambio();
      const r = await s.entrada(ev.type, ev.payload);
      if (this.pendientes[0] === ev) this.pendientes.shift();
      if (r.ok === true) {
        this.aplicados += 1;
        this.trasRiesgosa = esRiesgosa(ev.type, ev.payload);
        reintentosGuarda = 0;
        this.o.pedirImagen?.();
        continue;
      }
      // (sin narrowing en el tsconfig de la web, que no es strict: se nombra el caso de fallo)
      const no = r as Extract<ResultadoEntrada, { ok: false }>;
      if (this.pausaPedida === 'descartado') return this.descartado();
      if (no.incierta) {
        this.incierto = ev;
        return this.pausa(no.motivo);
      }
      // No se aplicó: vuelve al principio de lo pendiente.
      this.pendientes.unshift(ev);
      // La guarda saltó entre la espera y el envío (llegó otra entrada antes): se espera otra vez, pocas veces.
      if (MOTIVOS_GUARDA.has(no.motivo) && reintentosGuarda < 2) {
        reintentosGuarda += 1;
        this.trasRiesgosa = true;
        continue;
      }
      return this.pausa(no.motivo);
    }
    if (this.pausaPedida === 'descartado') return this.descartado();
    this.pausaPedida = null;
    const aplicados = this.aplicados;
    this.cerrar();
    this.cambio();
    return { ok: true, aplicados };
  }

  private cambio() {
    try {
      this.o.alCambio?.();
    } catch {
      /* un oyente roto no rompe nada */
    }
  }
}

/**
 * La secuencia de «Enviar» del visor (la misma en la app y en la web): el texto del campo sale como un lote; si todo
 * llega, el campo se vacía; si se pausa, el campo enseña lo que falta y sigue quieto hasta seguir o recuperar.
 */
export async function confirmarEscritura(buffer: BufferTeclado, lote: LoteTeclado, conEnter: boolean, o: { privado?: boolean } = {}): Promise<ResultadoLote> {
  if (lote.abierto() || buffer.enviando != null) return { ok: false, motivo: 'ocupado', aplicados: 0, pendientes: lote.pendientes.length, incierto: !!lote.incierto };
  const eventos = buffer.confirmar(conEnter);
  if (!eventos.length) return { ok: true, aplicados: 0 };
  lote.agregar(eventos, o);
  return trasLote(buffer, lote, await lote.correr());
}

/** Seguir el lote en pausa (botón «Seguir»), con el mismo trato del campo. */
export async function seguirEscritura(buffer: BufferTeclado, lote: LoteTeclado): Promise<ResultadoLote> {
  return trasLote(buffer, lote, await lote.reanudar());
}

/** Lo incierto, resuelto por la persona tras mirar la pantalla («Sí llegó» / «No llegó»). */
export function resolverEscritura(buffer: BufferTeclado, lote: LoteTeclado, llego: boolean) {
  lote.resolverIncierto(llego);
  if (buffer.enviando == null) return;
  if (!lote.abierto()) buffer.aplicado();
  else buffer.mostrarPendiente(lote.textoPendiente().texto);
}

/** Recuperar al campo, editable, lo que no llegó (botón «Editar»). */
export function recuperarEscritura(buffer: BufferTeclado, lote: LoteTeclado): { texto: string; conEnter: boolean } {
  if (lote.ocupado()) return { texto: buffer.texto, conEnter: false };
  const t = lote.recuperar();
  buffer.devolver(t.texto);
  return t;
}

/** Tirar lo que falta (y vaciar el campo): al terminar la entrada segura o si la persona lo pide. */
export function descartarEscritura(buffer: BufferTeclado, lote: LoteTeclado) {
  lote.descartar();
  buffer.aplicado();
}

function trasLote(buffer: BufferTeclado, lote: LoteTeclado, r: ResultadoLote): ResultadoLote {
  if (r.ok === true || (r as Extract<ResultadoLote, { ok: false }>).motivo === 'descartado') buffer.aplicado();
  else if (buffer.enviando != null) buffer.mostrarPendiente(lote.textoPendiente().texto);
  return r;
}

/** Qué decir de un lote en pausa (es, en). Con entrada segura nunca se repite el texto. */
export function avisoDeLote(lote: Pick<LoteTeclado, 'motivo' | 'incierto' | 'privado' | 'pendientes'>): [string, string] | null {
  if (lote.incierto) {
    const que = lote.incierto.type === 'key' ? '⏎' : lote.privado ? '•••' : `«${Array.from(lote.incierto.payload.texto).slice(0, 40).join('')}»`;
    return [`No sé si llegó ${que}. Mira la pantalla y dime si llegó: no lo repito sin que lo digas.`, `I don’t know whether ${que} arrived. Look at the screen and tell me: I won’t repeat it until you say so.`];
  }
  const m = lote.motivo || '';
  if (!m) return null;
  if (m === 'desconectado') return ['Se cortó la conexión: lo que falta espera. Toca «Seguir» cuando vuelva.', 'The connection dropped: the rest is waiting. Tap “Resume” once it is back.'];
  if (m === 'sin_control' || m === 'epoca_cambio' || m === 'cliente' || m === 'epoca_revocada') return ['Ya no tienes el control: lo que falta espera, sin mandarse.', 'You no longer have control: the rest is waiting, unsent.'];
  if (m === 'cerrado') return ['Lo que faltaba quedó guardado: toca «Seguir» para mandarlo.', 'What was left is kept: tap “Resume” to send it.'];
  if (m === 'sin_imagen' || MOTIVOS_GUARDA.has(m)) return ['No llegó la imagen de ahora: lo que falta espera. Toca «Seguir» para intentarlo otra vez.', 'The current image didn’t arrive: the rest is waiting. Tap “Resume” to try again.'];
  return ['No se aplicó: lo que falta quedó guardado. Toca «Seguir» o «Editar».', 'It wasn’t applied: the rest is kept. Tap “Resume” or “Edit”.'];
}
