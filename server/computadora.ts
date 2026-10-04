/**
 * LA COMPUTADORA DE LOS AGENTES: el cliente del nodo de scripts/nodo-computadora.
 *
 * José (1-oct): «darle computadora a los agentes… como grokbot… ocupo esto funcione». Cada avatar puede
 * encargarle a su propia computadora en la nube (un escritorio Ubuntu con Firefox y LibreOffice) una
 * tarea de pantalla: buscar y comparar en páginas, llenar un formulario, leer algo que solo se ve
 * navegando. La maneja Holo-3.1-9B en la GPU propia (gratis) o Claude (de pago, si hay clave), según
 * Ajustes (`motorComputadora` del perfil).
 *
 * Una tarea tarda de uno a tres minutos (medido: 11 pasos, 80 s). El turno espera lo que puede
 * (`esperaMs`); si no alcanza, la tarea sigue y el resultado queda guardado para esa persona: se lo dice
 * en el turno siguiente (`avisosPendientes`) y la app lo puede mirar (`/api/computadora/...`).
 *
 * José (2-oct): «le pedí que abriera una página, la abrió y se quedó ahí». Desde entonces, en vivo y
 * hasta el final (el canal de acciones del teléfono, `alAvisarApp`):
 *  · al empezar, el teléfono abre solo la vista en vivo (`empieza`) y pone el tecleo bajito;
 *  · mientras trabaja (ya sin el turno esperando) se le cuentan los avances, uno cada 12 s como mucho
 *    (`paso`: «Ya entré a bch.hn.», «Estoy leyendo la página.»);
 *  · si la tarea no alcanzó (se acabaron los pasos o dice que quedó a medias) la MISIÓN sigue sola con
 *    otra tarea desde donde quedó la pantalla, hasta MAX_CONTINUACIONES (`sigue`); nunca si lo que la paró
 *    fue una clave, un pago o un captcha;
 *  · al terminar, el resultado va al teléfono YA (`termina` con el texto) y AURA lo dice sin esperar el
 *    turno siguiente; si no le llegó a ningún teléfono, queda para el turno siguiente como antes.
 *  · «Abre bch.hn» a secas se le pide al nodo como «…y dime qué hay en la página» (`prepararMision`).
 *
 * José (2-oct, tarde): «tiene que funcionar ya todo… copiemos cómo lo hacen Grok, el agente de ChatGPT».
 * Desde entonces cada encargo es una MISIÓN como la de un agente tipo Operator:
 *  · un PLAN corto (3-6 pasos) antes de empezar: lo escribe el cerebro en el pedido («… PLAN: a | b | c»,
 *    `separarPlan`) o, si no, se arma de la instrucción (`planDeMision`); la app lo muestra como lista que se
 *    va marcando (`estadoDelPlan`: hecho, actual, en espera, falló) con la captura en vivo arriba;
 *  · el tiempo transcurrido, Detener, Pausar/Seguir y Tomar el control/Devolver (si el nodo lo sabe:
 *    `capacidades` en /salud; el agente.py de antes no las tiene y la app solo ofrece Detener);
 *  · CONFIRMACIONES: antes de algo sensible (enviar, iniciar sesión, publicar, borrar) el nodo se queda
 *    quieto en `confirmar` con su `pregunta`; se le pregunta en la app (botones) y en voz (`confirmar`), y el
 *    «sí» de la conversación lo resuelve el servidor (`resolverPreguntaComputadora`). Pagar o comprar: nunca
 *    (el nodo no hace ese toque aunque el modelo lo pida);
 *  · el RESULTADO queda en una tarjeta (texto, datos, enlaces y la captura final: `FinalMision`) que se
 *    puede compartir, y el historial de sus misiones recientes (`historialDe`);
 *  · ROBUSTEZ: encargar se reintenta una vez si el nodo no contesta; si deja de contestar a media tarea se le
 *    dice («sigo intentando») y, si no vuelve, se cierra con un final honesto (nunca la vista colgada); si se
 *    pasa del tiempo se ofrece seguir (y el «sí» sigue la misión desde donde quedó).
 */
import { nivelDeCorreo } from './nivel';
import crypto from 'node:crypto';
import { respuestaPura } from '../lib/afirmacion';
import { clave } from '../lib/boveda';
import { almacenDurable, claveDe, crearUnaVez, leerDurable } from '../lib/durable';
import { evaluarEntrega, requisitosCombinados, SOLO_RESPONDI, SOLO_RESPONDI_EN, type ArchivoNodo, type Entrega, type ItemEntrega, type PedidoEntrega } from '../lib/tareas-durables';

export type MotorNodo = 'holo' | 'claude';
/**
 * `hecho`: el recibo del nodo (agente.py nuevo): false si la acción no se hizo (la negó, la pararon, otra época).
 * `incierto`: salió y se cortó a medias; no se sabe si pasó (no es «no se hizo»).
 */
export type PasoTarea = { n: number; t: number; accion: string; args?: Record<string, unknown>; ms?: number; miniatura?: string | null; hecho?: boolean; incierto?: boolean };
/**
 * Parar y tomar/devolver el control en tres estados (agente.py de AUR03): `fenced` (recibido, ningún despacho
 * nuevo), `draining` (un toque ya salió y se espera que termine) y `quiescent` (nada en vuelo: ya es verdad).
 * null: el nodo de antes no lo dice.
 */
export type FaseQuietud = 'fenced' | 'draining' | 'quiescent';
/**
 * Los estados del nodo. `pausada`, `confirmar` (espera el sí de la persona) y `control` (la persona tiene el
 * escritorio) solo los da el agente.py nuevo: siguen vivos, pero quietos.
 */
export type EstadoTarea = 'en_cola' | 'trabajando' | 'pausada' | 'confirmar' | 'control' | 'hecha' | 'parada' | 'sin_pasos' | 'fallo';
export type Tarea = {
  id: string;
  motor: MotorNodo;
  instruccion: string;
  estado: EstadoTarea;
  pasos: PasoTarea[];
  respuesta: string | null;
  error: string | null;
  segundos: number;
  /** Lo que pregunta antes de algo sensible (solo en `confirmar`). */
  pregunta?: string | null;
  /** Cuál pregunta es (agente.py nuevo): el sí la nombra y otra no se contesta con él (auditoría 3-oct, PC01). */
  pregunta_id?: string | null;
  /** La huella de la propuesta que se muestra (agente.py de AUR02): el sí la devuelve, ligado a lo que se vio. */
  propuesta?: string | null;
  /**
   * Lo que el NODO comprobó en su espacio de trabajo al terminar (agente.py nuevo, `comprobar_archivos`): existe,
   * bytes, sha256. Sin el campo (el agente.py de antes) o null (no pudo mirar): nada de archivos se dio por comprobado.
   */
  archivos?: ArchivoNodo[] | null;
  archivos_error?: string | null;
};

const TERMINADA = new Set<EstadoTarea>(['hecha', 'parada', 'sin_pasos', 'fallo']);
/** Vivas pero quietas: no avanzan solas, no se narran y no cuentan para el tope de tiempo. */
const QUIETA = new Set<EstadoTarea>(['pausada', 'confirmar', 'control']);
/**
 * Lo que el nodo sabe hacer además de encargar y parar (agente.py nuevo: /salud → capacidades). `entrada`: el contrato
 * de entradas del visor (época, secuencia, viewport, ACK) y el frame en cabeceras; `seguro`: la entrada segura (AUR09).
 */
export type CapacidadNodo = 'pausar' | 'confirmar' | 'control' | 'entrada' | 'seguro';
const CAPACIDADES_NODO: readonly CapacidadNodo[] = ['pausar', 'confirmar', 'control', 'entrada', 'seguro'];
/** Cada cuánto se pregunta por la tarea mientras se espera. */
const SONDEO_MS = 2000;
/** Tras esto, una tarea que nadie terminó de esperar se deja de seguir. */
const SEGUIR_MAX_MS = 15 * 60_000;

/** Quién es, sin decirle el correo al nodo: le basta para saber si cambió de dueño (y limpiar el escritorio). */
function huellaDe(quien: string): string {
  return crypto.createHash('sha256').update(`computadora|${quien}`).digest('hex').slice(0, 24);
}

function conf() {
  return { url: clave('computadora_url').replace(/\/+$/, ''), clave: clave('computadora_clave') };
}

export function computadoraConfigurada(): boolean {
  const c = conf();
  return !!c.url && !!c.clave;
}

/** Ajustes dice «gratis» o «pago»; el nodo habla de holo o claude. */
export function motorDelPerfil(motor: string | null | undefined, correo?: string): MotorNodo {
  if (motor !== 'pago') return 'holo';
  // El de pago (Claude) cuesta por tarea: es de la junta. A un miembro le corre el gratis aunque lo elija.
  return correo && nivelDeCorreo(correo) === 'miembro' ? 'holo' : 'claude';
}

/** Un error del nodo con su código HTTP (sin código: no contestó, la red o el tiempo). */
export class ErrorNodo extends Error {
  constructor(
    mensaje: string,
    readonly status?: number
  ) {
    super(mensaje);
  }
}

async function pedir(ruta: string, init: RequestInit & { ms?: number } = {}): Promise<any> {
  const c = conf();
  let r: Response;
  try {
    r = await fetch(`${c.url}${ruta}`, {
      ...init,
      headers: { authorization: `Bearer ${c.clave}`, 'content-type': 'application/json', ...(init.headers || {}) },
      signal: init.signal ?? AbortSignal.timeout(init.ms ?? 15_000),
    });
  } catch (e: any) {
    throw new ErrorNodo(String(e?.cause?.code || e?.message || e).slice(0, 200));
  }
  const texto = await r.text();
  let j: any = null;
  try {
    j = texto ? JSON.parse(texto) : null;
  } catch {
    j = null;
  }
  if (!r.ok) throw new ErrorNodo(String(j?.detail || j?.error || texto || `HTTP ${r.status}`).slice(0, 200), r.status);
  return j;
}

/** ¿Vale la pena intentarlo otra vez? Sin código (no contestó) o un 5xx; un 4xx es un no de verdad. */
const reintentable = (e: unknown) => !(e instanceof ErrorNodo) || !e.status || e.status >= 500;

/** ¿Pudo el pedido llegar al nodo aunque no supimos la respuesta? Sin conexión (rechazada, sin DNS) o un 4xx: no. */
const pedidoPudoLlegar = (e: unknown) => reintentable(e) && !/ECONNREFUSED|ENOTFOUND|EAI_AGAIN|EHOSTUNREACH|ENETUNREACH/.test(String((e as Error)?.message || e));

let capsCache: { en: number; caps: CapacidadNodo[] } | null = null;
const CAPS_MS = 60_000;

function capsDe(j: any): CapacidadNodo[] {
  return Array.isArray(j?.capacidades) ? j.capacidades.filter((c: unknown): c is CapacidadNodo => CAPACIDADES_NODO.includes(c as CapacidadNodo)) : [];
}

/** ¿Contesta el nodo? Qué motores ofrece, si está ocupado y qué sabe hacer. Para Ajustes y la salud del sistema. */
export async function estadoComputadora(): Promise<{ configurada: boolean; ok: boolean; motores: MotorNodo[]; ocupada: boolean; capacidades: CapacidadNodo[]; detalle?: string }> {
  if (!computadoraConfigurada()) return { configurada: false, ok: false, motores: [], ocupada: false, capacidades: [], detalle: 'Falta COMPUTADORA_URL o COMPUTADORA_CLAVE.' };
  try {
    const j = await pedir('/salud', { ms: 8000 });
    const capacidades = capsDe(j);
    capsCache = { en: Date.now(), caps: capacidades };
    return { configurada: true, ok: !!j?.ok, motores: Array.isArray(j?.motores) ? j.motores : [], ocupada: !!j?.ocupada, capacidades };
  } catch (e: any) {
    return { configurada: true, ok: false, motores: [], ocupada: false, capacidades: [], detalle: String(e?.message || e).slice(0, 160) };
  }
}

/** Lo que sabe el nodo (pausar, confirmar, control), guardado un minuto. Si no contesta: nada. */
export async function capacidadesNodo(): Promise<CapacidadNodo[]> {
  if (capsCache && Date.now() - capsCache.en < CAPS_MS) return capsCache.caps;
  return (await estadoComputadora()).capacidades;
}

export async function verTarea(id: string, miniaturas = false, ms = 10_000, senal?: AbortSignal): Promise<Tarea> {
  const tope = AbortSignal.timeout(Math.max(1, ms));
  return pedir(`/tareas/${encodeURIComponent(id)}${miniaturas ? '?miniaturas=1' : ''}`, { signal: senal ? AbortSignal.any([senal, tope]) : tope });
}

const fase = (x: unknown): FaseQuietud | null => (x === 'fenced' || x === 'draining' || x === 'quiescent' ? x : null);

/**
 * Parar. El agente.py de AUR03 contesta cuando ya nada está en vuelo (`quiescent`) o, pasado su tope (5 s), con
 * `draining` y el id de la parada: un toque que ya salió termina (y queda con su recibo). El de antes no dice fase
 * (null). Se espera hasta 12 s: más que el tope del nodo.
 */
export async function pararTarea(id: string): Promise<{ fase: FaseQuietud | null; parada: string | null }> {
  const j = await pedir(`/tareas/${encodeURIComponent(id)}/parar`, { method: 'POST', ms: 12_000 });
  return { fase: fase(j?.parada?.fase), parada: typeof j?.parada?.id === 'string' ? j.parada.id : null };
}

/** Lo que aprueba un sí: la pregunta (`id`) y la huella EXACTA de la propuesta que se le mostró (`huella`). */
export type PreguntaAtada = { id: string | null; huella: string | null };

/**
 * El sí o el no a ESA pregunta, atado a la propuesta exacta que se le mostró (revisión 4-oct: «una aprobación para Ana
 * no permite una acción para Bruno»). Un «sí» necesita la huella de la propuesta (lo que se aprueba, destino e importe
 * incluidos): sin ella no se manda (un nodo de antes, o un pedido que no dice qué aprueba). Justo antes de mandarlo se
 * mira qué pregunta el nodo AHORA: si es otra pregunta, u otra propuesta (otro destino) bajo el mismo id, no se manda,
 * aunque el nodo no lo revisara. Un «no» no autoriza nada: va con la pregunta que nombra.
 */
export async function confirmarAtado(tareaId: string, si: boolean, p: PreguntaAtada): Promise<void> {
  if (si) {
    if (!p.id || !p.huella) throw new ErrorNodo('ese sí no dice qué propuesta exacta aprueba (tu computadora tiene que ser la versión que la nombra); no lo mandé', 409);
    const t = await verTarea(tareaId, false, 8000);
    if (t.estado !== 'confirmar' || t.pregunta_id !== p.id || (t.propuesta ?? null) !== p.huella) {
      throw new ErrorNodo('lo que tu computadora pregunta ahora ya no es lo que aprobaste (otra pregunta u otro destino); no lo contesté, mira la de ahora', 409);
    }
  }
  await confirmarTarea(tareaId, si, p.id, p.huella);
}

/* Lo del agente.py nuevo (capacidades): pausar, seguir, el sí, el control de la persona y la pantalla de ahora. */
export async function pausarTarea(id: string): Promise<{ fase: FaseQuietud | null }> {
  const j = await pedir(`/tareas/${encodeURIComponent(id)}/pausar`, { method: 'POST', ms: 12_000 });
  return { fase: fase(j?.fase) };
}
export async function reanudarTarea(id: string): Promise<void> {
  await pedir(`/tareas/${encodeURIComponent(id)}/reanudar`, { method: 'POST', ms: 8000 });
}
/**
 * El sí o el no a UNA pregunta (`preguntaId`) y, si se conoce, a la propuesta que se le mostró (`propuesta`, la
 * huella del agente.py de AUR02): si la computadora ya pregunta otra cosa, el nodo dice 409. Para un «sí» se usa
 * `confirmarAtado`, que exige la propuesta y la revisa contra el nodo justo antes.
 */
export async function confirmarTarea(id: string, si: boolean, preguntaId?: string | null, propuesta?: string | null): Promise<void> {
  await pedir(`/tareas/${encodeURIComponent(id)}/confirmar`, {
    method: 'POST',
    body: JSON.stringify({ si, ...(preguntaId ? { pregunta_id: preguntaId } : {}), ...(propuesta ? { propuesta } : {}) }),
    ms: 8000,
  });
}
/**
 * Tomar o devolver el control: «tú controlas» / «sigo yo» solo con `quiescent` (con `draining`, termina sola). Con
 * `cliente` (el visor de AUR09; derivado de la sesión, clienteDeSesion) el control queda ligado a ese cliente y el nodo
 * cerca a cualquier otro; `epocaEsperada` (expectedControlEpoch): si el control ya cambió, el nodo dice 409. Devuelve la
 * época del control (`controlEpoch`, la que llevan las entradas); null con el nodo de antes.
 */
export async function controlTarea(id: string, tomar: boolean, o: { cliente?: string | null; epocaEsperada?: number | null } = {}): Promise<{ fase: FaseQuietud | null; epoca: number | null; seguro?: boolean }> {
  const cuerpo = { tomar, ...(o.cliente ? { clientId: o.cliente } : {}), ...(Number.isInteger(o.epocaEsperada) ? { expectedControlEpoch: o.epocaEsperada } : {}) };
  const j = await pedir(`/tareas/${encodeURIComponent(id)}/control`, { method: 'POST', body: JSON.stringify(cuerpo), ms: 12_000 });
  return { fase: fase(j?.fase), epoca: Number.isInteger(j?.epoca) ? j.epoca : null, ...(typeof j?.seguro === 'boolean' ? { seguro: j.seguro } : {}) };
}
export type AccionPersona = { tipo: 'click'; x: number; y: number } | { tipo: 'escribir'; texto: string; enter?: boolean } | { tipo: 'tecla'; teclas: string } | { tipo: 'scroll'; direccion: 'up' | 'down' };
export async function accionPersona(id: string, a: AccionPersona): Promise<void> {
  await pedir(`/tareas/${encodeURIComponent(id)}/accion`, { method: 'POST', body: JSON.stringify(a), ms: 20_000 });
}
/**
 * El frame de una captura (agente.py de AUR09): su secuencia, la hora del nodo (ms), el tamaño lógico (el de las
 * coordenadas de las entradas), la revisión del viewport, la época del control y si es privado (entrada segura: no se
 * guarda ni va a ningún modelo). null con el nodo de antes.
 */
export type FrameNodo = { seq: number; ts: number; ancho: number; alto: number; viewportRevision: number; epoca: number | null; privado: boolean };

function frameDe(h: Headers): FrameNodo | null {
  if (!h.get('x-frame-seq')) return null;
  const n = (k: string) => Number(h.get(k));
  const [seq, ts, ancho, alto, rev] = ['x-frame-seq', 'x-frame-ts', 'x-frame-ancho', 'x-frame-alto', 'x-viewport-rev'].map(n);
  if (![seq, ts, ancho, alto, rev].every((x) => Number.isFinite(x) && x >= 0)) return null;
  const epoca = h.get('x-control-epoca') == null ? null : n('x-control-epoca');
  return { seq, ts: Math.round(ts * 1000), ancho, alto, viewportRevision: rev, epoca: Number.isInteger(epoca) ? epoca : null, privado: h.get('x-privado') === '1' };
}

/** Lo que se ve ahora (JPEG), solo mientras esa tarea tiene el escritorio, con su frame (si el nodo lo dice). */
export async function pantallaDeTarea(id: string, ancho?: number): Promise<{ jpeg: Buffer; frame: FrameNodo | null }> {
  const c = conf();
  const q = Number.isInteger(ancho) ? `?ancho=${Math.max(480, Math.min(1280, Number(ancho)))}` : '';
  const r = await fetch(`${c.url}/tareas/${encodeURIComponent(id)}/pantalla${q}`, { headers: { authorization: `Bearer ${c.clave}` }, signal: AbortSignal.timeout(15_000) });
  if (!r.ok) throw new ErrorNodo(`HTTP ${r.status}`, r.status);
  return { jpeg: Buffer.from(await r.arrayBuffer()), frame: frameDe(r.headers) };
}

/* ------------------------------------------------------------------ el contrato de entradas del visor (AUR09) */

/**
 * Una entrada del visor (RemoteInput de AUR09, con los nombres de ese contrato): de la sesión remota (la tarea), de un
 * cliente, con la época del control, su secuencia, la revisión del viewport con que se miró y un tipo con sus datos.
 * Las coordenadas van en píxeles LÓGICOS del escritorio (los del frame), no de la pantalla del teléfono.
 */
export type EntradaRemota = {
  remoteSessionId: string;
  clientId: string;
  controlEpoch: number;
  inputSequence: number;
  viewportRevision: number;
  type: 'pointer' | 'scroll' | 'key' | 'text_commit' | 'release_all';
  payload: Record<string, unknown>;
};
export type AckEntrada = { secuencia: number; estado: string; ts: number; frame_seq: number; epoca: number; duplicada?: boolean };

/** Lo más que pesa una entrada (el texto va acotado aparte, a 500). */
export const MAX_ENTRADA_BYTES = 4096;
const MODS_ORDEN = ['ctrl', 'shift', 'alt'] as const;
const TECLAS_ESPECIALES = ['enter', 'tab', 'escape', 'backspace', 'delete', 'up', 'down', 'left', 'right', 'home', 'end', 'pageup', 'pagedown', 'space', 'f5'];
const NAVEGACION = ['up', 'down', 'left', 'right', 'home', 'end', 'pageup', 'pagedown'];
/** Ctrl + letra: seleccionar todo, copiar, pegar, cortar, deshacer, rehacer, buscar, barra, recargar, pestaña nueva y cerrarla. */
const LETRAS_CTRL = 'acvxzyflrtw'.split('');

/** La lista blanca de teclas y combinaciones (la misma que agente.py y mobile/src/lib/entradaRemota.ts). */
export function comboPermitido(mods: readonly string[], tecla: string): boolean {
  const m = new Set(mods);
  if ([...m].some((x) => !(MODS_ORDEN as readonly string[]).includes(x))) return false;
  const es = (...xs: string[]) => m.size === xs.length && xs.every((x) => m.has(x));
  if (m.size === 0) return TECLAS_ESPECIALES.includes(tecla);
  if (es('shift')) return [...NAVEGACION, 'tab', 'enter'].includes(tecla);
  if (es('ctrl')) return LETRAS_CTRL.includes(tecla) || [...NAVEGACION, 'backspace', 'delete', 'enter', 'tab'].includes(tecla);
  if (es('ctrl', 'shift')) return [...NAVEGACION, 'z', 't', 'tab'].includes(tecla);
  if (es('alt')) return tecla === 'left' || tecla === 'right';
  return false;
}

/** Valida una entrada como el nodo (antes de mandarla): null si no vale. El texto, compuesto (NFC) y sin controles. */
export function validarEntradaRemota(b: any, id: string): EntradaRemota | null {
  if (!b || typeof b !== 'object' || b.remoteSessionId !== id) return null;
  const ent = (v: unknown, lo: number, hi: number) => typeof v === 'number' && Number.isInteger(v) && v >= lo && v <= hi;
  if (typeof b.clientId !== 'string' || !/^[A-Za-z0-9_-]{8,64}$/.test(b.clientId)) return null;
  if (!ent(b.controlEpoch, 0, 1e9) || !ent(b.inputSequence, 1, 1e12) || !ent(b.viewportRevision, 0, 1e9)) return null;
  const p = b.payload && typeof b.payload === 'object' && !Array.isArray(b.payload) ? b.payload : {};
  const xy = (k: string) => ent(p[k], 0, 8192);
  const mods = (v: unknown, permitidos: readonly string[]): string[] | null => {
    if (v == null) return [];
    if (!Array.isArray(v) || v.length > 3 || v.some((x) => !permitidos.includes(x))) return null;
    return MODS_ORDEN.filter((x) => v.includes(x));
  };
  const base = { remoteSessionId: id, clientId: b.clientId, controlEpoch: b.controlEpoch, inputSequence: b.inputSequence, viewportRevision: b.viewportRevision };
  switch (b.type) {
    case 'pointer': {
      const accion = p.accion ?? 'click';
      const m = mods(p.mods, ['ctrl', 'shift']);
      if (!['click', 'doble', 'derecho', 'arrastre'].includes(accion) || !xy('x') || !xy('y') || !m) return null;
      if (accion === 'arrastre' && (!xy('x2') || !xy('y2'))) return null;
      return { ...base, type: 'pointer', payload: { accion, x: p.x, y: p.y, mods: m, ...(accion === 'arrastre' ? { x2: p.x2, y2: p.y2 } : {}) } };
    }
    case 'scroll': {
      const dy = p.dy ?? 0;
      const dx = p.dx ?? 0;
      if (!xy('x') || !xy('y') || !ent(dy, -10, 10) || !ent(dx, -10, 10) || (!dy && !dx)) return null;
      return { ...base, type: 'scroll', payload: { x: p.x, y: p.y, dy, dx } };
    }
    case 'key': {
      const tecla = typeof p.tecla === 'string' ? p.tecla.toLowerCase() : '';
      const m = mods(p.mods, MODS_ORDEN);
      if (!m || !comboPermitido(m, tecla)) return null;
      return { ...base, type: 'key', payload: { tecla, mods: m } };
    }
    case 'text_commit': {
      if (typeof p.texto !== 'string') return null;
      const texto = p.texto.normalize('NFC');
      if (texto.length < 1 || texto.length > 500 || /[\u0000-\u001f\u007f]/.test(texto)) return null;
      return { ...base, type: 'text_commit', payload: { texto } };
    }
    case 'release_all':
      return { ...base, type: 'release_all', payload: {} };
    default:
      return null;
  }
}

/** Manda una entrada (ya validada, con el cliente derivado de la sesión) y devuelve su ACK. */
export async function entradaRemota(id: string, e: EntradaRemota): Promise<AckEntrada> {
  const j = await pedir(`/tareas/${encodeURIComponent(id)}/entrada`, { method: 'POST', body: JSON.stringify(e), ms: 20_000 });
  return j?.ack;
}

/** La entrada segura (agente.py de AUR09): activar, o salir con el frame que la persona vio (`frameSeq`). */
export async function seguroTarea(id: string, activar: boolean, cliente: string | null, frameSeq?: number | null): Promise<{ seguro: boolean; epoca: number | null }> {
  const cuerpo = { activar, ...(cliente ? { clientId: cliente } : {}), ...(Number.isInteger(frameSeq) ? { frameSeq } : {}) };
  const j = await pedir(`/tareas/${encodeURIComponent(id)}/seguro`, { method: 'POST', body: JSON.stringify(cuerpo), ms: 8000 });
  return { seguro: !!j?.seguro, epoca: Number.isInteger(j?.epoca) ? j.epoca : null };
}

/**
 * El cliente que ve el nodo: derivado de la persona, de SU sesión (el token, que nunca sale del servidor) y del id que
 * da el visor. Otra sesión con el mismo id es otro cliente: el id del visor solo no da autoridad (AUR09).
 */
export function clienteDeSesion(correo: string, token: string | undefined, clientId: string): string {
  return crypto.createHash('sha256').update(`visor|${correo}|${token ?? ''}|${clientId}`).digest('hex').slice(0, 32);
}

/** Lo que dice cada rechazo del nodo, en palabras para la app (el código va aparte: la app decide con él). */
const MOTIVOS_ENTRADA: Record<string, string> = {
  sin_control: 'Primero toma el control.',
  cliente: 'Otro dispositivo tiene el control ahora.',
  epoca_revocada: 'El control cambió; mira la pantalla de ahora.',
  epoca_cambio: 'El control cambió; mira la pantalla de ahora.',
  secuencia_vieja: 'Esa entrada ya pasó; no la repito.',
  viewport: 'La pantalla cambió; toca otra vez sobre la de ahora.',
  aun_no: 'Un momento: está terminando su último paso.',
  tasa: 'Más despacio: demasiadas entradas seguidas.',
  incierta: 'No sé si se hizo; mira la pantalla antes de seguir.',
  frame_viejo: 'Mira la pantalla de ahora antes de terminar la entrada segura.',
  seguro: 'Primero termina la entrada segura.',
  entrada_invalida: 'Esa entrada no la entiendo.',
};
const codigoDe = (msg: string) => /^([a-z_]+):/.exec(msg)?.[1] ?? null;

/** Lo que la persona puede hacer con el control: validado antes de mandarlo al nodo. */
export function validarAccionPersona(b: any): AccionPersona | null {
  if (!b || typeof b !== 'object') return null;
  const en = (v: unknown) => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1000;
  if (b.tipo === 'click' && en(b.x) && en(b.y)) return { tipo: 'click', x: Math.round(b.x), y: Math.round(b.y) };
  if (b.tipo === 'escribir' && typeof b.texto === 'string' && b.texto.length >= 1 && b.texto.length <= 500) return { tipo: 'escribir', texto: b.texto, enter: !!b.enter };
  if (b.tipo === 'tecla' && typeof b.teclas === 'string' && /^[a-z0-9+]{1,20}$/i.test(b.teclas)) return { tipo: 'tecla', teclas: b.teclas.toLowerCase() };
  if (b.tipo === 'scroll' && (b.direccion === 'up' || b.direccion === 'down')) return { tipo: 'scroll', direccion: b.direccion };
  return null;
}

export async function pantallaComputadora(): Promise<Buffer> {
  const c = conf();
  const r = await fetch(`${c.url}/pantalla`, { headers: { authorization: `Bearer ${c.clave}` }, signal: AbortSignal.timeout(15_000) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return Buffer.from(await r.arrayBuffer());
}

/* ------------------------------------------------------------------ de quién es cada tarea */

/**
 * Un encargo: una tarea del nodo y de quién es. Una MISIÓN puede ser varias tareas seguidas (`vuelta`
 * 0, 1, 2…): si una no alcanzó, la siguiente sigue desde donde quedó la pantalla. `instruccion` es
 * siempre la misión tal como se pidió (lo que se le cuenta a la persona); al nodo le va `paraNodo`.
 */
type Encargo = {
  id: string;
  quien: string;
  instruccion: string;
  creada: number;
  terminada?: Tarea;
  avisada?: boolean;
  /** El teléfono del turno (x-aura-aparato): ahí se abre la vista en vivo. null: todos los de la cuenta. */
  aparato: string | null;
  idioma: 'es' | 'en';
  motor: MotorNodo;
  maxPasos: number;
  /** Cuántas tareas van en esta misión antes de esta (0: la primera). */
  vuelta: number;
  /** Cuándo el turno dejó de esperarla (desde ahí se narra y se avisa al terminar). */
  soltada?: number;
  /** Alguien ya decidió qué hacer con su final (el turno o el seguimiento): no se hace dos veces. */
  cerrada?: boolean;
  /** El último paso que se contó en voz, cuándo y cuántas frases van. */
  narrado: number;
  ultimaVoz: number;
  dichas: number;
  ultimaFrase?: string;
  /** Cuántas veces se contó cada acción (para variar la frase: «Estoy leyendo», «Sigo leyendo»…). */
  porAccion: Record<string, number>;
  /** La misión de la que es parte (su plan, su tiempo, su final). */
  mision: Mision;
  /** En qué paso del plan iba la misión cuando empezó esta tarea (el avance se cuenta desde ahí). */
  indiceAlEmpezar: number;
  /** Lo último que se vio de la tarea (para un final honesto si el nodo deja de contestar). */
  ultimaVista?: Tarea;
  /** El último estado visto: para avisar al teléfono cuando se pausa, espera un sí o sigue. */
  ultimoEstado?: EstadoTarea;
  /** Consultas seguidas sin respuesta del nodo, desde cuándo, y si ya se le dijo a la persona. */
  fallos: number;
  primerFallo: number;
  avisadoSinRespuesta?: boolean;
  /** La última pregunta que ya contestó (cuál y cuándo): una consulta atrasada no la vuelve a preguntar. */
  contestada?: { texto: string; id: string | null; en: number };
  /** Hasta cuándo se la sigue (se alarga mientras está quieta: pausa, control o esperando su sí). */
  limite: number;
  /**
   * La generación del encargo (sube al cerrarlo) y la versión de lo último aceptado del nodo (solo crece): una
   * respuesta que salió antes y llega después no cambia nada (AUR04).
   */
  gen: number;
  version: number;
  /** La vuelta del seguimiento que está programada (se cancela al cerrar; los recibos se quedan). */
  reloj?: ReturnType<typeof setTimeout>;
};

/** Cómo va cada paso del plan en la app. */
export type EstadoPlan = 'hecho' | 'actual' | 'espera' | 'pendiente' | 'fallo';
/** `recibo`: el paso del nodo que lo hizo (tarea y número). Sin recibo, un paso nunca sale «hecho». */
export type PasoPlan = { texto: string; estado: EstadoPlan; recibo?: { tarea: string; n: number } };
/**
 * La tarjeta del final: lo que se dice, lo que encontró, datos y enlaces sueltos, y la captura final. `ok` solo si
 * terminó Y lo entregado se comprobó (`comprobado`: el dato pedido, el archivo que el nodo encontró); «Listo» no basta.
 * `visitados`: las páginas que de verdad abrió (los `enlaces` también traen las del texto, para compartir).
 * `archivos`: lo que el nodo comprobó al terminar (null: no lo comprobó). `sinComprobar`: qué faltó, si faltó.
 * `entregables`: CADA cosa pedida (si se pidieron archivos), con su estado y su porqué; null si no se pidieron archivos.
 */
export type FinalMision = {
  estado: EstadoTarea;
  ok: boolean;
  texto: string;
  respuesta: string | null;
  error: string | null;
  enlaces: string[];
  datos: { clave: string; valor: string }[];
  captura: string | null;
  segundos: number;
  pasos: number;
  visitados: string[];
  archivos: ArchivoNodo[] | null;
  comprobado: boolean;
  /**
   * Ronda 7: SOLO respondió (una consulta o un texto en el chat). Es un final terminado pero NO comprobado: `ok` y
   * `comprobado` siguen en false. Una app de antes no conoce el campo y la muestra como «Sin comprobar» (terminada).
   */
  respondida: boolean;
  sinComprobar: string | null;
  entregables: EntregableFinal[] | null;
};
/** Una cosa pedida, para la tarjeta y el panel: `verified` (con su archivo comprobado), `not_met` (falta o no es lo pedido) o `unknown` (no se pudo comprobar). */
export type EntregableFinal = { id: string; texto: string; estado: ItemEntrega['estado']; detalle: string; ruta?: string };
/**
 * Una MISIÓN: lo que se pidió, su plan y su final, aunque la hagan varias tareas del nodo. Su id es el de su
 * primera tarea. Vive en memoria (el historial se pierde si el servidor se reinicia; el nodo olvida las
 * tareas tras una hora, la tarjeta del final no).
 */
type Mision = {
  id: string;
  quien: string;
  instruccion: string;
  plan: string[];
  /** El plan lo escribió el cerebro (si no, se armó de la instrucción). */
  planDelCerebro: boolean;
  /**
   * Lo que se pidió, calculado UNA vez al crearla con lo que pidió la PERSONA en su turno y con lo que el modelo encargó
   * (lib/entregables.ts `requisitosCombinados`: gana lo más exigente). No se recalcula con otro texto después.
   */
  requisitos?: PedidoEntrega;
  /** Lo que pidió la PERSONA en su turno, tal cual (G2-C): la entrega se evalúa sobre esto y sobre lo que encargó el modelo. */
  pedidoPersona?: string;
  inicio: number;
  tareas: string[];
  /** El paso del plan en que va (nunca retrocede). */
  indice: number;
  /** El recibo de cada paso del plan que el nodo de verdad hizo (auditoría 3-oct, PC05): el plan propuesto y lo hecho son cosas distintas. */
  recibos: Record<number, { tarea: string; n: number }>;
  fin?: number;
  final?: FinalMision;
  /**
   * Lo que su computadora le preguntó y todavía no contesta (`id`: cuál, si el nodo lo dice; `huella`: la de la
   * propuesta que se le mostró, agente.py de AUR02). `reemplazoDe` (permisos exactos, 4-oct): esta pregunta reemplazó a
   * otra de la misma tarea que todavía esperaba (otra pregunta u otra propuesta bajo el mismo id): dice cuál era. El
   * primer «sí» del chat pudo ser para esa, así que no contesta esta: primero se le dice qué pregunta ahora.
   */
  pregunta?: { tareaId: string; texto: string; desde: number; id: string | null; huella?: string | null; reemplazoDe?: string } | null;
  /** Se quedó a medias y se le ofreció seguir: su «sí» la sigue (hasta aquí vale). */
  ofreceSeguir?: number;
  /** Cuántas veces la persona dijo «sigue» después de un final a medias. */
  rondas: number;
  /** Pasos útiles de las tareas anteriores de la misión. */
  pasosPrevios: number;
  idioma: 'es' | 'en';
  motor: MotorNodo;
  aparato: string | null;
  /**
   * La conversación que la encargó (la del turno: el aparato, la web, la voz). Permisos exactos (revisión 4-oct): sus
   * preguntas se contestan por el chat de ESA conversación; en otra, un «sí» no es para ellas (ahí están los botones).
   */
  ambito?: string | null;
  maxPasos: number;
};
const ENCARGOS = new Map<string, Encargo>();
const MISIONES = new Map<string, Mision>();
/** Las misiones de cada persona, la más nueva al final (HISTORIAL_MAX como mucho). */
const HISTORIAL = new Map<string, string[]>();
export const HISTORIAL_MAX = 10;
/** Cuánto vale una pregunta sin contestar, y la oferta de seguir, para el «sí» de la conversación. */
const PREGUNTA_VALE_MS = 15 * 60_000;
const SEGUIR_VALE_MS = 10 * 60_000;
/** Veces que la persona puede decir «sigue» a una misión que quedó a medias. */
export const MAX_RONDAS = 2;
/** La última tarea de cada persona (para la app). */
const ULTIMA = new Map<string, string>();
/**
 * Las tareas de cada persona que siguieron después de que su turno dejó de esperar y que todavía no se
 * le contaron. Todas: una segunda tarea no tapa a la primera.
 */
const PENDIENTES = new Map<string, Set<string>>();

/* ------------------------------------------------------------------ la app en vivo */

/**
 * Lo que su computadora le cuenta al teléfono (lib/acciones-app.ts, AccionComputadora): `empieza` abre
 * la vista en vivo, `paso` es una frase corta de avance, `sigue` otra tarea de la misma misión y
 * `termina` el final (con `texto`, el resultado para decirlo; sin él, ya lo dijo el turno).
 */
export type FaseAviso = 'empieza' | 'paso' | 'sigue' | 'confirmar' | 'pausa' | 'reanuda' | 'termina';
/**
 * `plan` va en `empieza` (la lista que la app marca); `pregunta` en `confirmar` (los botones Sí / No, aunque
 * la diga el turno); `estado` en `pausa` (pausada o control).
 */
export type AvisoApp = { tipo: 'computadora'; fase: FaseAviso; id: string; texto?: string; ok?: boolean; plan?: string[]; pregunta?: string; estado?: 'pausada' | 'control' };
/** Empuja el aviso al canal de acciones (server.ts: empujarAccion) y dice a cuántos teléfonos llegó. */
export type AvisadorApp = (quien: string, aviso: AvisoApp, aparato: string | null) => number;
let avisador: AvisadorApp | null = null;

/** server.ts conecta el canal de acciones del teléfono (las pruebas, un espía). null lo desconecta. */
export function alAvisarApp(f: AvisadorApp | null) {
  avisador = f;
}

/** Al aparato del turno; con `todos`, si ese no está escuchando, a cualquier teléfono de la cuenta. */
function avisarApp(e: Encargo, aviso: AvisoApp, todos = false): number {
  if (!avisador) return 0;
  try {
    let n = avisador(e.quien, aviso, e.aparato);
    if (!n && todos && e.aparato) n = avisador(e.quien, aviso, null);
    return n;
  } catch {
    return 0;
  }
}

/**
 * Los tiempos del seguimiento (las pruebas los acortan):
 *  · sondeoMs: cada cuánto se mira la tarea después de que el turno la soltó;
 *  · silencioTrasTurnoMs: tras soltarla, este rato callado (que se oiga lo que el turno contestó);
 *  · narrarCadaMs: entre una frase de avance y la siguiente, como mínimo (sin llenar la conversación);
 *  · trabajandoCadaMs: sin pasos nuevos en este rato, «sigo trabajando»;
 *  · fallosAntesDeAvisar: consultas seguidas sin respuesta del nodo antes de decir «no me contesta, sigo intentando»;
 *  · sinRespuestaMs: sin respuesta en este rato, se cierra con un final honesto (nunca la vista colgada);
 *  · reintentoMs: la espera antes del segundo intento de encargar.
 */
export const TIEMPOS_SEGUIR = { sondeoMs: 3000, silencioTrasTurnoMs: 8000, narrarCadaMs: 12_000, trabajandoCadaMs: 35_000, fallosAntesDeAvisar: 5, sinRespuestaMs: 120_000, reintentoMs: 1500 };
/** Frases de avance por tarea, como mucho. */
export const MAX_FRASES = 8;
/** Tareas de más que una misión puede encadenar cuando una no alcanzó. */
export const MAX_CONTINUACIONES = 3;

export function duenoDe(id: string): string | null {
  return ENCARGOS.get(id)?.quien ?? null;
}

/** La misión tal como se pidió (sin lo que se le agregó para el nodo). */
export function misionDe(id: string): string | null {
  return ENCARGOS.get(id)?.instruccion ?? null;
}

export function ultimaTareaDe(quien: string): string | null {
  return ULTIMA.get(quien) ?? null;
}

/**
 * ¿Tiene ahora una tarea viva en su computadora (encargada y todavía sin cerrar)? Solo lee lo que hay en
 * memoria, sin preguntar al nodo: el camino rápido de la voz (AUR10) lo usa para saber si «para» a secas
 * puede querer decir parar la tarea (y entonces pregunta) o solo callar.
 */
export function tareaVivaDe(quien: string): boolean {
  const id = ultimaTareaDe(String(quien || '').toLowerCase()) ?? ultimaTareaDe(quien);
  const e = id ? ENCARGOS.get(id) : null;
  return !!e && !e.cerrada && !e.terminada;
}

export function pendientesDe(quien: string): string[] {
  return [...(PENDIENTES.get(quien) ?? [])];
}

/**
 * Lo que terminó después de que el turno dejó de esperar y todavía no se le dijo: va como HECHO en el
 * turno siguiente de esa persona. Solo se mira: se da por dicho con `confirmarAvisos` cuando el modelo
 * de verdad contestó con esos hechos (un «hola» que contesta el banco o el modelo chico no los lleva).
 * Si el teléfono lo recibió al terminar (y AURA lo dijo), ya no está aquí.
 */
export function avisosPendientes(quien: string): { ids: string[]; hecho: string } | null {
  const listas = pendientesDe(quien)
    .map((id) => ENCARGOS.get(id))
    .filter((e): e is Encargo => !!e?.terminada && !e.avisada);
  if (!listas.length) return null;
  const partes = listas.map((e) => `«${e.instruccion.slice(0, 160)}»: ${resumenTarea(e.terminada!, e.instruccion, e.mision.requisitos)}`);
  return {
    ids: listas.map((e) => e.id),
    hecho: `COMPUTADORA (terminó lo que te encargaron antes) ${partes.join(' · ')} Díselo al empezar, en una o dos frases.`,
  };
}

/** Ya se le dijo: no se vuelve a contar. */
export function confirmarAvisos(quien: string, ids: readonly string[]) {
  const set = PENDIENTES.get(quien);
  for (const id of ids) {
    const e = ENCARGOS.get(id);
    if (e) e.avisada = true;
    set?.delete(id);
  }
  if (set && !set.size) PENDIENTES.delete(quien);
}

function anotarPendiente(e: Encargo) {
  if (!PENDIENTES.has(e.quien)) PENDIENTES.set(e.quien, new Set());
  PENDIENTES.get(e.quien)!.add(e.id);
}

/* ------------------------------------------------------------------ el plan (como Operator: la lista que se va marcando) */

const sinAcentos = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const limpiarPaso = (s: string) =>
  s
    .replace(/^\s*(?:\d+\s*[.)-]|[-*•·])\s*/, '')
    .replace(/\s+/g, ' ')
    .replace(/[.\s]+$/, '')
    .trim()
    .slice(0, 80);

/**
 * El cerebro escribe el plan al final del pedido: «Entra a bch.hn y dime el dólar PLAN: Entrar a bch.hn |
 * Buscar el tipo de cambio | Darte compra y venta». Devuelve la misión sin el plan, y el plan (2 a 6 pasos) o null.
 */
export function separarPlan(texto: string): { mision: string; plan: string[] | null } {
  const t = String(texto || '').replace(/\s+/g, ' ').trim();
  const m = /^(.*?)[\s.·,;-]*\bPLAN\s*:\s*(.+)$/.exec(t);
  if (!m || m[1].trim().length < 4) return { mision: t, plan: null };
  let partes = m[2].split('|');
  if (partes.length < 2) partes = m[2].split(';');
  if (partes.length < 2) partes = m[2].split(/\s(?=\d+[.)]\s)/);
  const plan = partes.map(limpiarPaso).filter((p) => p.length >= 3).slice(0, 6);
  return { mision: m[1].trim(), plan: plan.length >= 2 ? plan : null };
}

/** Sin plan del cerebro (o encargada desde la app): uno corto armado de la instrucción, de 3 a 6 pasos. */
export function planDeMision(instruccion: string, idioma: 'es' | 'en' = 'es'): string[] {
  const t = String(instruccion || '').replace(/\s+/g, ' ').trim();
  const b = sinAcentos(t);
  const en = idioma === 'en';
  const plan: string[] = [];
  const sitio = /\b((?:[a-z0-9-]+\.)+(?:com|org|net|hn|gob|edu|io|gov|info|es|mx|co|us|uk|app|dev)(?:\.[a-z]{2})?)\b/i.exec(t)?.[1];
  if (sitio) plan.push(en ? `Open ${sitio}` : `Entrar a ${sitio}`);
  else if (/google/.test(b)) plan.push(en ? 'Open Google' : 'Abrir Google');
  else plan.push(en ? 'Open the browser' : 'Abrir el navegador');
  if (/\b(busca|buscar|buscame|encuentra|search|find|look up)\b/.test(b)) plan.push(en ? 'Search for what you asked' : 'Buscar lo que pediste');
  if (/\b(compara|comparar|compare)\b/.test(b)) plan.push(en ? 'Compare the options' : 'Comparar las opciones');
  if (/\b(llena|llenar|completa|completar|formulario|fill|form)\b/.test(b)) plan.push(en ? 'Fill in the form' : 'Llenar el formulario');
  if (/\b(envia|enviar|envialo|manda|mandar|mandalo|publica|publicar|publicalo|borra|borrar|borralo|elimina|eliminar|inicia sesion|iniciar sesion|submit|send|post|delete|log ?in|sign ?in)\b/.test(b))
    plan.push(en ? 'Ask for your OK before anything sensitive' : 'Pedirte el sí antes de lo delicado');
  if (plan.length < 3 || /\b(lee|leer|revisa|dime|cuenta|saca|extrae|que hay|read|check|tell|what)\b/.test(b)) plan.push(en ? 'Read what the page shows' : 'Leer lo que muestra la página');
  plan.push(en ? 'Give you the result' : 'Darte el resultado');
  return [...new Set(plan)].slice(0, 6);
}

type TipoPlan = 'abrir' | 'buscar' | 'leer' | 'llenar' | 'confirmar' | 'resultado' | 'otro';
type TipoPaso = 'abrir' | 'escribir' | 'navegar' | 'leer' | 'confirmar' | 'resultado';

export function tipoDePlan(texto: string): TipoPlan {
  const t = sinAcentos(String(texto || ''));
  if (/\b(resultado|result|darte|decirte|contarte|dime|tell|report|resum|respuesta|answer)/.test(t)) return 'resultado';
  if (/\b(el si|tu si|permiso|confirm|aprob|your ok|ok before)/.test(t)) return 'confirmar';
  if (/\b(abr|entr|ir a|ve a|visit|open|go to|naveg)/.test(t)) return 'abrir';
  if (/\b(busc|escrib|search|type|find|look)/.test(t)) return 'buscar';
  if (/\b(llen|complet|formul|fill|form|envi|submit|publi|post|mand)/.test(t)) return 'llenar';
  if (/\b(le[eo]|revis|mir|compar|sac|extra|anot|read|check|review|analiz|copi)/.test(t)) return 'leer';
  return 'otro';
}

function tipoDePaso(accion: string): TipoPaso | null {
  switch (accion) {
    case 'open_url':
      return 'abrir';
    case 'type':
      return 'escribir';
    case 'click':
    case 'left_click':
    case 'double_click':
    case 'triple_click':
    case 'right_click':
    case 'key':
    case 'drag':
    case 'left_click_drag':
      return 'navegar';
    case 'scroll':
    case 'wait':
    case 'nada':
    case 'zoom':
    case 'screenshot':
    case 'mouse_move':
      return 'leer';
    case 'pedir_confirmacion':
    case 'confirmacion':
      return 'confirmar';
    case 'answer':
      return 'resultado';
    default:
      return null; // escritorio_limpio, lo que hizo la persona: no mueven el plan
  }
}

const COMPATIBLE: Record<TipoPaso, TipoPlan[]> = {
  abrir: ['abrir'],
  escribir: ['buscar', 'llenar'],
  navegar: ['buscar', 'llenar', 'leer', 'otro'],
  leer: ['leer', 'otro'],
  confirmar: ['confirmar', 'llenar'],
  resultado: ['resultado'],
};

/**
 * En qué paso del plan va, desde `desde`, según lo que hizo el nodo: cada acción mueve el plan al paso
 * más cercano que le corresponde (mirando hasta dos adelante); el último («darte el resultado») solo con
 * la respuesta. Nunca retrocede. `recibos`: cada paso del plan al que llegó una acción de verdad (con el
 * número de esa acción); los que se saltaron no tienen recibo. Lo que el nodo dice que no hizo (`hecho:
 * false`) no mueve nada.
 */
export function recibosDelPlan(plan: readonly string[], pasos: readonly (Pick<PasoTarea, 'accion' | 'hecho'> & { n?: number })[], desde = 0): { indice: number; recibos: { j: number; n: number }[] } {
  const ultimo = plan.length - 1;
  if (ultimo < 0) return { indice: 0, recibos: [] };
  const tipos = plan.map(tipoDePlan);
  const tope = tipos[ultimo] === 'resultado' ? ultimo - 1 : ultimo;
  let i = Math.max(0, Math.min(desde, ultimo));
  const recibos: { j: number; n: number }[] = [];
  const anotar = (j: number, n: number) => {
    if (!recibos.some((r) => r.j === j)) recibos.push({ j, n });
  };
  pasos.forEach((p, k) => {
    if (p.hecho === false) return;
    const tp = tipoDePaso(p.accion);
    if (!tp) return;
    const n = Number.isFinite(p.n) ? Number(p.n) : k + 1;
    if (tp === 'resultado') {
      i = ultimo;
      anotar(ultimo, n);
      return;
    }
    for (let j = i; j <= Math.min(i + 2, tope); j++) {
      if (COMPATIBLE[tp].includes(tipos[j])) {
        i = j;
        anotar(j, n);
        break;
      }
    }
  });
  return { indice: i, recibos };
}

export function avanzarPlan(plan: readonly string[], pasos: readonly Pick<PasoTarea, 'accion' | 'hecho'>[], desde = 0): number {
  return recibosDelPlan(plan, pasos, desde).indice;
}

/**
 * El plan para la app: hecho SOLO con su recibo (auditoría 3-oct, PC05: un final «ok» marcaba todos los pasos
 * aunque nada los mostrara), el actual (o en espera si está quieta), pendiente o el que falló. Sin `recibos`
 * (quien llama sin ellos) vale lo de antes del paso de ahora, nunca lo de después.
 */
export function estadoDelPlan(m: Pick<Mision, 'plan' | 'indice' | 'final'> & { recibos?: Mision['recibos'] }, estado?: EstadoTarea | null): PasoPlan[] {
  return m.plan.map((texto, j) => {
    const recibo = m.recibos ? m.recibos[j] : undefined;
    const conRecibo = m.recibos ? !!recibo : j < m.indice;
    let e: EstadoPlan;
    // Terminada bien o solo respondió: lo que tiene recibo, hecho; lo demás, pendiente (no es un fallo).
    if (m.final?.ok || m.final?.respondida) e = conRecibo ? 'hecho' : 'pendiente';
    else if (m.final) e = j === m.indice ? 'fallo' : j < m.indice && conRecibo ? 'hecho' : 'pendiente';
    else e = j === m.indice ? (estado && QUIETA.has(estado) ? 'espera' : 'actual') : j < m.indice && conRecibo ? 'hecho' : 'pendiente';
    return recibo ? { texto, estado: e, recibo } : { texto, estado: e };
  });
}

function moverPlan(e: Encargo, t: Pick<Tarea, 'pasos'>) {
  const m = e.mision;
  const r = recibosDelPlan(m.plan, t.pasos, e.indiceAlEmpezar);
  for (const { j, n } of r.recibos) if (!m.recibos[j]) m.recibos[j] = { tarea: e.id, n };
  m.indice = Math.max(m.indice, r.indice);
}

/* ------------------------------------------------------------------ el final: la tarjeta que se comparte */

const pasosUtiles = (t: Pick<Tarea, 'pasos'>) => t.pasos.filter((p) => p.hecho !== false && !['answer', 'escritorio_limpio', 'pedir_confirmacion', 'confirmacion', 'persona', 'modo_seguro'].includes(p.accion)).length;

/** Las direcciones del resultado y las páginas que abrió (sin repetir, hasta 5). */
export function enlacesDe(t: Pick<Tarea, 'respuesta' | 'pasos'>): string[] {
  const urls: string[] = [];
  for (const m of String(t.respuesta || '').matchAll(/https?:\/\/[^\s)»"'<>\]]+/g)) urls.push(m[0].replace(/[.,;:!?]+$/, ''));
  for (const p of t.pasos) {
    const u = p.accion === 'open_url' ? String((p.args as any)?.url || '').trim() : '';
    if (u) urls.push(/^https?:\/\//i.test(u) ? u : `https://${u}`);
  }
  const vistos = new Set<string>();
  return urls.filter((u) => u.length <= 300 && !vistos.has(u.replace(/\/+$/, '')) && vistos.add(u.replace(/\/+$/, ''))).slice(0, 5);
}

/** Las páginas que su computadora abrió DE VERDAD (pasos open_url que el nodo hizo): esas sí cuentan como evidencia. */
export function visitadosDe(t: Pick<Tarea, 'pasos'>): string[] {
  const urls = t.pasos
    .filter((p) => p.accion === 'open_url' && p.hecho !== false && !p.incierto)
    .map((p) => String((p.args as any)?.url || '').trim())
    .filter(Boolean)
    .map((u) => (/^https?:\/\//i.test(u) ? u : `https://${u}`));
  const vistos = new Set<string>();
  return urls.filter((u) => u.length <= 300 && !vistos.has(u.replace(/\/+$/, '')) && vistos.add(u.replace(/\/+$/, ''))).slice(0, 5);
}

/** Lo que el nodo dijo de sus archivos, saneado (null si no lo comprobó: el agente.py de antes o no pudo mirar). */
export function archivosDe(t: Pick<Tarea, 'archivos'>): ArchivoNodo[] | null {
  if (!Array.isArray(t.archivos)) return null;
  return t.archivos.slice(0, 20).flatMap((a: any) =>
    a && typeof a === 'object' && typeof a.ruta === 'string'
      ? [
          {
            ruta: a.ruta.slice(0, 400),
            existe: a.existe === true,
            bytes: Number.isFinite(a.bytes) ? Math.max(0, Math.floor(a.bytes)) : 0,
            sha256: typeof a.sha256 === 'string' ? a.sha256.slice(0, 64) : null,
            ...(typeof a.reciente === 'boolean' ? { reciente: a.reciente } : {}),
            ...(a.mencionado === true ? { mencionado: true } : {}),
            ...(a.fuera === true ? { fuera: true } : {}),
            // Lo que el nodo vio por dentro (agente.py nuevo). Sin el campo: tipo sin comprobar.
            ...(typeof a.tipo === 'string' && /^[a-z0-9]{1,12}$/.test(a.tipo) ? { tipo: a.tipo } : {}),
            ...(typeof a.magia === 'string' && /^[0-9a-f]{2,32}$/.test(a.magia) ? { magia: a.magia } : {}),
            // Si lo vio entero (agente.py `integridad`); sin el campo: un nodo de antes, sin comprobar.
            ...(typeof a.integro === 'boolean' ? { integro: a.integro } : {}),
            ...(typeof a.defecto === 'string' ? { defecto: a.defecto.slice(0, 120) } : {}),
          },
        ]
      : []
  );
}

/** Lo entregado de una tarea terminada, comprobado o no (lib/tareas-durables.ts `evaluarEntrega`). */
export function entregaDe(instruccion: string, t: Pick<Tarea, 'id' | 'respuesta' | 'pasos' | 'archivos'>, requisitos?: PedidoEntrega | null): Entrega {
  return evaluarEntrega({ id: t.id, instruccion, resultado: t.respuesta ?? null, enlaces: visitadosDe(t), datos: datosDe(t.respuesta), archivos: archivosDe(t), requisitos: requisitos ?? null });
}

/** «Compra: 24.70», «Venta: 24.95»: los datos sueltos de la respuesta, para la tabla de la tarjeta. */
export function datosDe(respuesta: string | null | undefined): { clave: string; valor: string }[] {
  const out: { clave: string; valor: string }[] = [];
  for (const linea of String(respuesta || '').split(/\n|;|•|\s·\s|(?<=[.!?])\s+(?=[A-ZÁÉÍÓÚÑ])/)) {
    const m = /^\s*(?:[-*]|\d+[.)])?\s*([^:]{2,40}?)\s*:\s*(.{1,140}?)[.\s]*$/.exec(linea);
    // Una dirección sola no es un dato: va en los enlaces.
    if (!m || /https?$/i.test(m[1]) || /^\/\//.test(m[2]) || /^https?:\/\/\S+$/.test(m[2])) continue;
    out.push({ clave: m[1].trim(), valor: m[2].trim() });
  }
  return out.slice(0, 8);
}

function ultimaMiniatura(t: Pick<Tarea, 'pasos'>): string | null {
  return [...t.pasos].reverse().find((p) => p.miniatura)?.miniatura || null;
}

/** Cada cosa pedida para la tarjeta (null si no se pidieron archivos). Sin terminar, nada queda verificado. */
export function entregablesDe(entrega: Entrega, termino: boolean): EntregableFinal[] | null {
  if (entrega.tipo !== 'archivo') return null;
  return entrega.items.map((i) => ({
    id: i.id,
    texto: i.etiqueta,
    estado: termino ? i.estado : i.estado === 'verified' ? 'unknown' : i.estado,
    detalle: termino ? i.detalle : 'No terminó: no se comprobó.',
    ...(i.estado === 'verified' && i.archivo ? { ruta: i.archivo.ruta.slice(0, 300) } : {}),
  }));
}

/** La misión terminó: se guarda su tarjeta (y, sin esperar, la captura final del nodo). */
function cerrarMision(e: Encargo, t: Tarea) {
  const m = e.mision;
  m.fin = Date.now();
  m.pregunta = null;
  moverPlan(e, t);
  // «Listo» no es evidencia (revisión externa, 4-oct): ok solo si lo entregado se comprobó.
  const entrega = entregaDe(m.instruccion, t, m.requisitos);
  const ok = t.estado === 'hecha' && !misionIncompleta(t) && entrega.comprobada;
  m.final = {
    estado: t.estado,
    ok,
    texto: fraseDeFinal(m.instruccion, t, m.idioma, m.requisitos),
    respuesta: t.respuesta ?? null,
    error: t.error ?? null,
    enlaces: enlacesDe(t),
    datos: datosDe(t.respuesta),
    captura: ultimaMiniatura(t),
    segundos: Math.round((m.fin - m.inicio) / 1000),
    pasos: m.pasosPrevios + pasosUtiles(t),
    visitados: visitadosDe(t),
    archivos: archivosDe(t),
    comprobado: t.estado === 'hecha' && entrega.comprobada,
    respondida: t.estado === 'hecha' && !ok && !misionIncompleta(t) && !!entrega.respondida,
    sinComprobar: t.estado === 'hecha' && !entrega.comprobada ? entrega.falta : null,
    entregables: entregablesDe(entrega, t.estado === 'hecha'),
  };
  // A medias (sin pasos o perdió el contacto) y no la paró la persona: su «sí» la sigue.
  m.ofreceSeguir = !ok && (t.estado === 'sin_pasos' || t.estado === 'fallo') && m.rondas < MAX_RONDAS ? Date.now() : undefined;
  const final = m.final;
  if (!final.captura && ENCARGOS.has(t.id) && t.pasos.length)
    void verTarea(t.id, true, 10_000)
      .then((x) => {
        final.captura = ultimaMiniatura(x);
      })
      .catch(() => undefined);
}

/**
 * La versión del estado que se le da a la app: crece con cada respuesta (y entre reinicios del servidor, porque
 * va con la hora). La app descarta una respuesta con una versión menor que la última que ya vio de esa misión:
 * un GET viejo que llega tarde no vuelve a poner lo de antes (auditoría 3-oct, PC05).
 */
let versionAnterior = 0;
export function versionDeEstado(): number {
  versionAnterior = Math.max(versionAnterior + 1, Date.now() * 1000);
  return versionAnterior;
}

/** Lo que la app muestra de una misión: el plan marcado, el tiempo, la pregunta pendiente (y cuál es) y el final. */
export function vistaMision(m: Mision, estado?: EstadoTarea | null, pregunta?: string | null, preguntaId?: string | null, version = versionDeEstado(), propuesta?: string | null) {
  const enConfirmar = estado === 'confirmar';
  return {
    version,
    id: m.id,
    instruccion: m.instruccion,
    plan: estadoDelPlan(m, estado),
    planDelCerebro: m.planDelCerebro,
    inicio: m.inicio,
    transcurrido: Math.round(((m.fin ?? Date.now()) - m.inicio) / 1000),
    vuelta: Math.max(0, m.tareas.length - 1),
    tareaId: m.tareas[m.tareas.length - 1] ?? m.id,
    pregunta: m.pregunta?.texto ?? (enConfirmar ? pregunta || null : null),
    /** Cuál pregunta es: la app la manda con su sí (si ya cambió, el servidor dice 409 y no la contesta). */
    preguntaId: m.pregunta ? m.pregunta.id : enConfirmar ? preguntaId || null : null,
    /** La huella de la propuesta que muestra (revisión 4-oct): la app la manda con su sí; otra propuesta no se aprueba. */
    propuesta: m.pregunta ? m.pregunta.huella ?? null : enConfirmar ? propuesta || null : null,
    final: m.final ?? null,
    // El botón «Seguir»: quedó a medias (no la paró la persona) y quedan rondas.
    // Una que solo respondió ya terminó (ronda 7): no se ofrece seguir.
    puedeSeguir: !!m.final && !m.final.ok && !m.final.respondida && m.final.estado !== 'parada' && m.rondas < MAX_RONDAS,
  };
}
export type VistaMision = ReturnType<typeof vistaMision>;

/** Sus misiones recientes, la más nueva primero: para el historial de la pantalla de su computadora. */
export function historialDe(quien: string) {
  return [...(HISTORIAL.get(quien) ?? [])]
    .reverse()
    .map((id) => MISIONES.get(id))
    .filter((m): m is Mision => !!m)
    .map((m) => ({
      id: m.id,
      tareaId: m.tareas[m.tareas.length - 1] ?? m.id,
      instruccion: m.instruccion.slice(0, 200),
      estado: m.final?.estado ?? ('trabajando' as EstadoTarea),
      ok: m.final?.ok ?? null,
      respondida: !!m.final?.respondida,
      inicio: m.inicio,
      segundos: Math.round(((m.fin ?? Date.now()) - m.inicio) / 1000),
      resultado: (m.final?.respuesta || m.final?.error || '').slice(0, 160) || null,
    }));
}

export function misionDeTarea(id: string): Mision | null {
  return ENCARGOS.get(id)?.mision ?? null;
}

function anotarMision(m: Mision) {
  MISIONES.set(m.id, m);
  const lista = [...(HISTORIAL.get(m.quien) ?? []).filter((x) => x !== m.id), m.id];
  while (lista.length > HISTORIAL_MAX) MISIONES.delete(lista.shift()!);
  HISTORIAL.set(m.quien, lista);
}

/* ------------------------------------------------------------------ la misión: completa y hasta el final */

const RE_SOLO_ABRIR = /^(?:abre|abrir|abreme|ábreme|entrar? (?:a|en)|ve a|ir a|visita|open|go to|visit)\s+(.+)$/i;
/** Lo que dice que hay algo más que hacer después de abrir: entonces la misión ya está completa. */
const RE_HAY_MAS = /\b(y|e|and|para|dime|busca|buscar|compara|saca|llena|lee|revisa|cuenta|tell|find|search|compare|read|check|luego|despu[eé]s|then)\b|[,;:]/i;

/**
 * Lo que va al nodo. «Abre bch.hn» y nada más dejaba la página abierta y la tarea «hecha» en dos pasos
 * (José, 2-oct: «abrió la página y se quedó ahí»): se le pide además contar qué hay en ella.
 */
export function prepararMision(instruccion: string, idioma: 'es' | 'en' = 'es'): string {
  const t = String(instruccion || '').replace(/\s+/g, ' ').trim();
  const m = RE_SOLO_ABRIR.exec(t);
  // Solo «abre <sitio>» (unas pocas palabras, sin «y dime…»): lo demás ya dice qué traer.
  if (!m || RE_HAY_MAS.test(m[1]) || m[1].split(' ').length > 6) return t;
  const sin = t.replace(/[.\s]+$/, '');
  return idioma === 'en'
    ? `${sin}, and once it loads, tell me in two or three sentences what the page shows (the main things on it).`
    : `${sin}, y cuando cargue dime en dos o tres frases qué hay en la página (lo principal que se ve).`;
}

/** «No terminé», «me faltó», «couldn't finish»: la respuesta dice que quedó a medias. */
const RE_INCOMPLETA =
  /\b(no (pude|logr[eé]|alcanc[eé]) (a )?(terminar|completar|acabar)|no (termin[eé]|complet[eé]|acab[eé])|qued[oó] (a medias|incomplet[ao])|incomplet[ao]|me falt[oó]|faltan? (pasos|por hacer)|todav[ií]a no (termin|acab)|ran out of steps|(could ?not|couldn'?t|was(n'?t| not) able to) (finish|complete)|did(n'?t| not) (finish|complete)|not (yet )?(finished|completed?)|incomplete|only partially)\b/i;
/** Lo que la detuvo a propósito (una clave, un pago, un captcha): eso no se insiste, se le dice. */
const RE_BLOQUEO =
  /contrase|password|clave de acceso|iniciar? sesi|inicio de sesi|log ?in\b|sign ?in|captcha|no soy un robot|robot|pag(o|ar)\b|tarjeta|comprar?\b|compra\b|payment|\bpay\b|credit card|checkout|verificaci[oó]n en dos|two.factor|2fa|permiso|permission/i;

/**
 * ¿La misión tiene que seguir con otra tarea? Solo si se acabaron los pasos o la respuesta dice que
 * quedó a medias, y nunca si lo que la paró fue una clave, un pago o un captcha (eso no lo hace).
 * Parada (la persona la paró) o falla del nodo: no se insiste.
 */
export function misionIncompleta(t: Pick<Tarea, 'estado' | 'respuesta' | 'error'>): boolean {
  const texto = `${t.respuesta || ''} ${t.error || ''}`;
  if (RE_BLOQUEO.test(texto)) return false;
  if (t.estado === 'sin_pasos') return true;
  if (t.estado !== 'hecha') return false;
  return !String(t.respuesta || '').trim() || RE_INCOMPLETA.test(String(t.respuesta || ''));
}

/** La tarea que sigue la misión: desde donde quedó la pantalla (el escritorio es el mismo), sin empezar de cero. */
export function instruccionContinuar(mision: string, t: Pick<Tarea, 'pasos'>, idioma: 'es' | 'en' = 'es'): string {
  const hechos = t.pasos
    .filter((p) => p.accion !== 'escritorio_limpio' && p.accion !== 'answer')
    .slice(-4)
    .map((p) => pasoEnPalabras(p, idioma));
  const m = mision.slice(0, 900);
  // Lo que salió y se cortó a medias: seguir (lo pidió la persona) no es repetirlo. Se mira la pantalla primero.
  const inciertas = t.pasos.filter((p) => p.incierto).slice(-2).map((p) => pasoEnPalabras(p, idioma));
  if (idioma === 'en') {
    const ojo = inciertas.length ? ` Unconfirmed: «${inciertas.join('; ')}» may already have happened. Do NOT repeat it: look at the screen first and, if you can't confirm it, stop and ask.` : '';
    return `Continue this mission from where the screen is now, without starting over: «${m}».${hechos.length ? ` The last things you did: ${hechos.join('; ')}.` : ''}${ojo} Finish the whole mission and answer with the concrete result that was asked for.`;
  }
  const ojo = inciertas.length ? ` Sin confirmar: «${inciertas.join('; ')}» pudo haberse hecho ya. NO la repitas: mira la pantalla primero y, si no puedes confirmarlo, detente y pregunta.` : '';
  return `Sigue con esta misión desde donde está la pantalla ahora, sin empezar de cero: «${m}».${hechos.length ? ` Lo último que hiciste: ${hechos.join('; ')}.` : ''}${ojo} Termina la misión completa y responde con el resultado concreto que se pidió.`;
}

/** ¿Dejó la tarea una acción que salió y se cortó a medias (no se sabe si pasó)? */
export function conAccionIncierta(t: Pick<Tarea, 'pasos'>): boolean {
  return (t.pasos || []).some((p) => p.incierto === true);
}

/* ------------------------------------------------------------------ lo que se dice mientras trabaja */

function dominio(url: unknown): string {
  const t = String(url ?? '').trim().replace(/^[a-z]+:\/\//i, '').replace(/^www\./i, '');
  return t.split(/[/?#]/)[0].slice(0, 40) || t.slice(0, 40);
}

/**
 * La frase corta de un avance, para decirla en voz («Ya entré a bch.hn.», «Estoy leyendo la página.»).
 * `i` cambia la frase entre las que dicen lo mismo (no repetir «sigo leyendo» tres veces).
 */
export function fraseDePaso(p: Pick<PasoTarea, 'accion' | 'args'>, idioma: 'es' | 'en' = 'es', i = 0): string {
  const a = (p.args || {}) as Record<string, any>;
  const en = idioma === 'en';
  const una = (xs: string[]) => xs[Math.abs(i) % xs.length];
  const corto = (x: unknown, n = 40) => {
    const t = String(x ?? '').replace(/\s+/g, ' ').trim();
    return t.length > n ? `${t.slice(0, n - 1)}…` : t;
  };
  switch (p.accion) {
    case 'open_url':
      return en ? `I'm on ${dominio(a.url)} now.` : `Ya entré a ${dominio(a.url)}.`;
    case 'type':
      return a.text ? (en ? `I'm typing «${corto(a.text)}».` : `Estoy escribiendo «${corto(a.text)}».`) : en ? "I'm typing." : 'Estoy escribiendo.';
    case 'click':
    case 'left_click':
    case 'double_click':
      return a.element
        ? en ? `I clicked «${corto(a.element, 30)}».` : `Toqué «${corto(a.element, 30)}».`
        : una(en ? ["I'm opening what I found.", "I'm moving through the page."] : ['Estoy abriendo lo que encontré.', 'Sigo navegando en la página.']);
    case 'scroll':
      return una(en ? ["I'm reading the page.", "I'm still reading…", "I'm going through the results…"] : ['Estoy leyendo la página.', 'Sigo leyendo…', 'Analizando los resultados…']);
    case 'wait':
      return en ? 'Waiting for the page to load.' : 'Esperando a que cargue la página.';
    case 'nada':
    case 'screenshot':
    case 'zoom':
      return en ? "I'm looking at what's on the screen." : 'Estoy analizando lo que veo.';
    case 'key':
      return una(en ? ["I'm moving through the page.", 'Still working on it.'] : ['Sigo navegando.', 'Sigo en eso.']);
    default:
      return en ? "I'm still working on it." : 'Sigo trabajando en eso.';
  }
}

/** El final, para decirlo en voz sin pasar por el cerebro (el teléfono lo dice tal cual). */
export function fraseDeFinal(mision: string, t: Tarea, idioma: 'es' | 'en' = 'es', requisitos?: PedidoEntrega | null): string {
  const en = idioma === 'en';
  const corto = (x: unknown, n: number) => {
    const s = String(x ?? '').replace(/\s+/g, ' ').trim();
    return s.length > n ? `${s.slice(0, n - 1)}…` : s;
  };
  if (t.estado === 'hecha') {
    // Lo que no se comprobó no se dice como hecho: ni «listo», ni «ya lo guardé» (revisión externa, 4-oct).
    const ent = entregaDe(mision, t, requisitos);
    // Respondió (ronda 7): la respuesta y que lo demás NO está comprobado (ronda 8: nunca «no hice nada»); nunca «Listo».
    if (!ent.comprobada && ent.respondida && !misionIncompleta(t)) {
      const r = corto(t.respuesta, 650);
      return en ? `${SOLO_RESPONDI_EN}${r ? ` ${r}` : ''}` : `${SOLO_RESPONDI}${r ? ` ${r}` : ''}`;
    }
    if (!ent.comprobada) return fraseSinComprobar(ent, en, corto(t.respuesta, 200));
    const r = corto(t.respuesta, 650);
    const arch = ent.tipo === 'archivo' ? archivosEnPalabras(ent, en) : '';
    return r ? (en ? `Done, I finished on my computer. ${r}${arch}` : `Listo, ya terminé en mi computadora. ${r}${arch}`) : en ? `Done, I finished on my computer.${arch}` : `Listo, ya terminé en mi computadora.${arch}`;
  }
  if (t.estado === 'sin_pasos') {
    const u = [...t.pasos].reverse().find((p) => p.accion !== 'answer' && p.accion !== 'escritorio_limpio');
    const donde = u ? ` ${en ? 'I stopped at' : 'Me quedé en'}: ${pasoEnPalabras(u, idioma).toLowerCase()}.` : '';
    return en ? `I couldn't finish «${corto(mision, 80)}» on my computer.${donde} Want me to keep going?` : `No alcancé a terminar «${corto(mision, 80)}» en mi computadora.${donde} ¿Sigo?`;
  }
  if (t.estado === 'fallo') return en ? `My computer failed: ${corto(t.error || 'no details', 120)}.` : `Mi computadora falló: ${corto(t.error || 'sin detalle', 120)}.`;
  if (t.error) return en ? `I stopped the computer task: ${corto(t.error, 120)}.` : `Paré lo de mi computadora: ${corto(t.error, 120)}.`;
  return en ? 'I stopped the computer task.' : 'Paré lo de mi computadora.';
}

/** «informe.odt (4096 bytes)»: cada cosa pedida que el nodo comprobó, con SU archivo (vacío si no comprobó nada). */
function listaComprobados(ent: Entrega, max = 4): string {
  const xs = ent.items.filter((i) => i.estado === 'verified' && i.archivo);
  const nombres = xs.slice(0, max).map((i) => {
    const n = i.archivo!.ruta.split('/').pop();
    return `${n === i.etiqueta ? n : `${i.etiqueta}: ${n}`} (${i.archivo!.bytes} bytes)`;
  });
  return nombres.join(', ') + (xs.length > max ? ` y ${xs.length - max} más` : '');
}

function archivosEnPalabras(ent: Entrega, en: boolean): string {
  const lista = listaComprobados(ent);
  if (!lista) return '';
  return en ? ` (I checked ${ent.hechos} of ${ent.total}: ${lista}.)` : ` (Lo comprobé, ${ent.hechos} de ${ent.total}: ${lista}.)`;
}

/**
 * El final de una tarea que dice que terminó pero cuya entrega no se pudo comprobar: honesto, sin «listo». Lo que
 * dijo el modelo va entre comillas y a su nombre («mi computadora dice…»): es lo que afirma, no un hecho.
 */
function fraseSinComprobar(ent: Entrega, en: boolean, respuesta: string): string {
  const r = respuesta ? `«${respuesta}»` : '';
  if (ent.tipo === 'archivo') {
    // Sin la revisión del nodo no hay nada que contar por cosa; con ella, cuántas de cuántas y qué falta de cada una.
    if (!ent.revisado) {
      return en
        ? `My computer says it saved it${r ? ` (${r})` : ''}, but I couldn’t verify that the file is there, so I’m not calling it done. Want me to check again?`
        : `Mi computadora dice que lo guardó${r ? ` (${r})` : ''}, pero no pude comprobar que el archivo esté ahí, así que no lo doy por hecho. ¿Lo reviso otra vez?`;
    }
    if (en) {
      const malos = ent.items.filter((i) => i.estado !== 'verified').map((i) => i.etiqueta);
      return `My computer says it finished${r ? ` (${r})` : ''}, but I could only verify ${ent.hechos} of ${ent.total} of what you asked for. Missing or not right: ${malos.slice(0, 4).join(', ')}. I’m not calling it done. Want me to check again?`;
    }
    const falta = String(ent.falta || '').replace(/\s+/g, ' ').trim();
    return `Mi computadora dice que terminó${r ? ` (${r})` : ''}, pero no lo doy por hecho. ${falta.length > 420 ? `${falta.slice(0, 419)}…` : falta} ¿Lo reviso otra vez?`;
  }
  if (ent.tipo === 'accion') {
    return en
      ? `My computer says ${r || 'it did it'}, but I couldn’t verify it from here. Please check before we count it as done.`
      : `Mi computadora dice ${r || 'que ya lo hizo'}, pero no pude comprobarlo desde aquí. Revísalo antes de darlo por hecho.`;
  }
  return en
    ? `My computer finished${r ? ` and said ${r}` : ''}, but it didn’t bring back what you asked for, so I couldn’t verify it.`
    : `Mi computadora terminó${r ? ` y dijo ${r}` : ''}, pero no trajo lo que pediste, así que no pude comprobarlo.`;
}

/** La pregunta antes de algo sensible, para decirla en voz. */
export function fraseDePregunta(pregunta: string, idioma: 'es' | 'en' = 'es'): string {
  const p = String(pregunta || '').replace(/\s+/g, ' ').trim().slice(0, 300);
  return idioma === 'en' ? `Before I go on I need your OK. ${p} Say yes or no.` : `Antes de seguir necesito tu sí. ${p} Dime sí o no.`;
}

/**
 * «sí» / «no» a lo que su computadora preguntó (o a «¿sigo?»), con la regla única (lib/afirmacion.ts): «si» solo con una
 * afirmación pura, «no» solo con una negativa pura; lo que nombra algo lo decide la selección (server/decision-turno.ts).
 */
export function respuestaSiNo(mensaje: string): 'si' | 'no' | null {
  return respuestaPura(mensaje);
}

/* ------------------------------------------------------------------ seguir la tarea hasta el final */

/**
 * El seguimiento de cada tarea, desde que se encarga: mientras el turno la espera no hace nada (el turno
 * ya la mira); en cuanto la suelta, la mira cada TIEMPOS_SEGUIR.sondeoMs, le cuenta los avances al teléfono y, al
 * terminar, decide: seguir la misión con otra tarea o avisar el final YA (no en el turno siguiente).
 */
function seguir(e: Encargo) {
  const programar = () => {
    e.reloj = setTimeout(vuelta, TIEMPOS_SEGUIR.sondeoMs);
    e.reloj.unref?.();
  };
  const vuelta = async () => {
    // Terminó o se olvidó (las pruebas): ya no se sigue.
    if (!sigueVivo(e, e.gen)) return;
    // Se pasó del tope trabajando (lo quieto no cuenta): se para y se le dice dónde quedó, con «¿sigo?».
    if (Date.now() > e.limite) {
      void pararTarea(e.id).catch(() => undefined);
      const u = e.ultimaVista;
      await alTerminar(e, { id: e.id, motor: e.motor, instruccion: e.instruccion, pasos: u?.pasos ?? [], respuesta: null, segundos: u?.segundos ?? 0, estado: 'sin_pasos', error: 'Llevaba demasiado tiempo.' }, false, true);
      return;
    }
    if (e.soltada) {
      // Lo que se ve al salir la consulta: si al volver el encargo ya se cerró, se olvidó o es de otra generación,
      // la respuesta (o el error) es vieja y no cambia nada ni se avisa (AUR04: hecha→pausada tras el cierre).
      const gen = e.gen;
      try {
        const t = await verTarea(e.id);
        if (!aceptarLectura(e, gen, t)) return;
        alContestar(e);
        if (TERMINADA.has(t.estado)) {
          await alTerminar(e, t, false);
          return;
        }
        moverPlan(e, t);
        alCambiarEstado(e, t, false);
        if (QUIETA.has(t.estado)) e.limite = Math.max(e.limite, Date.now() + SEGUIR_MAX_MS);
        else narrar(e, t);
      } catch (err) {
        if (!sigueVivo(e, gen)) return;
        if (await sinRespuesta(e, err)) return;
      }
    }
    if (sigueVivo(e, e.gen)) programar();
  };
  programar();
}

/** ¿El encargo sigue abierto, es el anotado y de la misma generación que cuando salió la consulta? */
function sigueVivo(e: Encargo, gen: number): boolean {
  return !e.cerrada && e.gen === gen && ENCARGOS.get(e.id) === e;
}

/**
 * Una lectura del nodo, después del await (AUR04): vale solo si el encargo sigue vivo y en la misma generación,
 * y si la transición es legal (un final no vuelve a un estado vivo). Si vale, queda como la última vista con su
 * versión (que solo crece).
 */
function aceptarLectura(e: Encargo, gen: number, t: Tarea): boolean {
  if (!sigueVivo(e, gen)) return false;
  const antes = e.ultimaVista?.estado;
  if (antes && TERMINADA.has(antes) && !TERMINADA.has(t.estado)) return false;
  e.ultimaVista = t;
  e.version++;
  return true;
}

/** El nodo volvió a contestar: si se le había dicho que no contestaba, que sepa que sigue. */
function alContestar(e: Encargo) {
  if (e.avisadoSinRespuesta) avisarApp(e, { tipo: 'computadora', fase: 'paso', id: e.id, texto: e.idioma === 'en' ? 'My computer is answering again; I keep going.' : 'Mi computadora ya me contesta; sigo.' });
  e.fallos = 0;
  e.primerFallo = 0;
  e.avisadoSinRespuesta = false;
}

/**
 * El nodo no contestó. Unas cuantas veces seguidas: se le dice («sigo intentando»). Si no vuelve en
 * TIEMPOS_SEGUIR.sinRespuestaMs, o dice que esa tarea ya no existe (se reinició), se cierra con un final
 * honesto: la vista nunca se queda colgada. true: ya se cerró.
 */
async function sinRespuesta(e: Encargo, err: unknown): Promise<boolean> {
  const ahora = Date.now();
  e.fallos++;
  if (!e.primerFallo) e.primerFallo = ahora;
  const perdida = err instanceof ErrorNodo && err.status === 404;
  if (perdida || ahora - e.primerFallo >= TIEMPOS_SEGUIR.sinRespuestaMs) {
    const u = e.ultimaVista;
    const error = perdida
      ? e.idioma === 'en'
        ? 'it restarted and lost the task; I don’t know if it finished'
        : 'se reinició y perdió la tarea; no sé si alcanzó a terminar'
      : e.idioma === 'en'
        ? 'it stopped answering halfway; I don’t know if it finished'
        : 'dejó de contestarme a mitad de la tarea; no sé si alcanzó a terminar';
    await alTerminar(e, { id: e.id, motor: e.motor, instruccion: e.instruccion, pasos: u?.pasos ?? [], respuesta: null, segundos: u?.segundos ?? 0, estado: 'fallo', error }, false, true);
    return true;
  }
  if (e.fallos >= TIEMPOS_SEGUIR.fallosAntesDeAvisar && !e.avisadoSinRespuesta && e.soltada) {
    e.avisadoSinRespuesta = true;
    avisarApp(e, { tipo: 'computadora', fase: 'paso', id: e.id, texto: e.idioma === 'en' ? "My computer isn't answering; I keep trying." : 'Mi computadora no me contesta; sigo intentando.' }, true);
  }
  return false;
}

/**
 * Se pausó, espera su sí, la tomó la persona o siguió: se le avisa al teléfono una vez por cambio. En el
 * turno (`enTurno`) la pregunta la dice el cerebro: el teléfono solo recibe los botones.
 */
function alCambiarEstado(e: Encargo, t: Tarea, enTurno: boolean) {
  const antes = e.ultimoEstado;
  e.ultimoEstado = t.estado;
  const m = e.mision;
  const en = e.idioma === 'en';
  if (t.estado === 'confirmar' && t.pregunta) {
    const id = t.pregunta_id || null;
    // La misma pregunta (por su id y la huella de su propuesta; con el nodo de antes, por su texto) no se vuelve a avisar.
    // Otra propuesta bajo el mismo id (otro destino) es OTRA pregunta: se avisa con su texto y su huella nuevos, y un
    // «sí» que se dio para la de antes ya no la contesta (revisión 4-oct).
    if (m.pregunta?.tareaId === e.id && (id ? m.pregunta.id === id && (m.pregunta.huella ?? null) === (t.propuesta ?? null) : m.pregunta.texto === t.pregunta)) return;
    // Una consulta que salió antes de que llegara su respuesta: esa pregunta ya está contestada.
    if (id ? e.contestada?.id === id : e.contestada?.texto === t.pregunta && Date.now() - e.contestada.en < 10_000) return;
    // Permisos exactos (4-oct): si esperaba OTRA de esta tarea (otro id, u otra propuesta bajo el mismo id), la nueva
    // queda marcada: un «sí» que ya venía en camino era para la de antes.
    const previa = m.pregunta?.tareaId === e.id ? m.pregunta : null;
    m.pregunta = { tareaId: e.id, texto: t.pregunta, desde: Date.now(), id, huella: t.propuesta || null, ...(previa ? { reemplazoDe: previa.texto } : {}) };
    avisarApp(e, { tipo: 'computadora', fase: 'confirmar', id: e.id, pregunta: t.pregunta, ...(enTurno ? {} : { texto: fraseDePregunta(t.pregunta, e.idioma) }) }, true);
    return;
  }
  if (antes === t.estado) return;
  if (antes === 'confirmar') m.pregunta = null;
  if (t.estado === 'pausada' || t.estado === 'control') {
    const texto =
      t.estado === 'pausada'
        ? en
          ? 'Okay, I paused my computer. Tell me when to go on.'
          : 'Listo, pausé mi computadora. Me dices cuándo sigo.'
        : en
          ? 'Okay, the computer is yours. When you are done, tap «Give back» and I go on from there.'
          : 'Listo, la computadora es tuya. Cuando termines, toca «Devolver» y sigo desde ahí.';
    avisarApp(e, { tipo: 'computadora', fase: 'pausa', id: e.id, estado: t.estado, texto });
    return;
  }
  if (t.estado === 'trabajando' && antes && QUIETA.has(antes)) {
    const texto = antes === 'control' ? (en ? 'Thanks, I go on from where you left it.' : 'Gracias, sigo desde donde la dejaste.') : antes === 'pausada' ? (en ? 'Going on.' : 'Sigo.') : undefined;
    avisarApp(e, { tipo: 'computadora', fase: 'reanuda', id: e.id, ...(texto ? { texto } : {}) });
  }
}

/** Un avance nuevo (o «sigo trabajando» si tarda), como mucho cada TIEMPOS_SEGUIR.narrarCadaMs y sin repetir. */
function narrar(e: Encargo, t: Tarea, ahora = Date.now()) {
  if (!e.soltada || ahora - e.soltada < TIEMPOS_SEGUIR.silencioTrasTurnoMs) return;
  if (ahora - e.ultimaVoz < TIEMPOS_SEGUIR.narrarCadaMs || e.dichas >= MAX_FRASES) return;
  const utiles = t.pasos.filter((p) => p.hecho !== false && !['escritorio_limpio', 'answer', 'pedir_confirmacion', 'confirmacion', 'persona'].includes(p.accion));
  const nuevo = utiles.length ? utiles[utiles.length - 1] : null;
  let texto = '';
  if (nuevo && nuevo.n > e.narrado) {
    e.narrado = nuevo.n;
    const vez = e.porAccion[nuevo.accion] ?? 0;
    e.porAccion[nuevo.accion] = vez + 1;
    texto = fraseDePaso(nuevo, e.idioma, vez);
  } else if (ahora - Math.max(e.ultimaVoz, e.soltada) >= TIEMPOS_SEGUIR.trabajandoCadaMs) {
    texto = e.idioma === 'en' ? "I'm still working on my computer." : 'Sigo trabajando en mi computadora.';
  }
  if (!texto || texto === e.ultimaFrase) return;
  e.ultimaFrase = texto;
  e.ultimaVoz = ahora;
  e.dichas++;
  avisarApp(e, { tipo: 'computadora', fase: 'paso', id: e.id, texto });
}

/**
 * La tarea terminó. Si la misión quedó a medias (y no fue por una clave, un pago o un captcha), sigue con
 * otra tarea desde donde quedó, hasta MAX_CONTINUACIONES. Si no, el final: con `enTurno` lo dice el turno
 * (el teléfono solo se entera); si no, se le empuja al teléfono para que AURA lo diga ya, y si le llegó,
 * ya no queda para el turno siguiente.
 */
async function alTerminar(e: Encargo, t: Tarea, enTurno: boolean, sinSeguir = false): Promise<{ sigue: Encargo | null }> {
  // Un final se decide una vez (AUR04): lo que llegue después (otra consulta, un error) no lo vuelve a decidir.
  if (e.cerrada) return { sigue: null };
  e.cerrada = true;
  e.gen++;
  e.terminada = t;
  e.ultimaVista = t;
  // El seguimiento ya no hace falta: se cancela su vuelta (los recibos, el final y la misión se quedan).
  if (e.reloj) clearTimeout(e.reloj);
  e.reloj = undefined;
  // Una acción que salió y se cortó a medias (`incierto`) no se sigue sola: la continuación «desde donde está la
  // pantalla» podría repetirla (un pago, un envío). La misión cierra a medias y la persona decide si sigue.
  if (!sinSeguir && misionIncompleta(t) && !conAccionIncierta(t) && e.vuelta < MAX_CONTINUACIONES) {
    const e2 = await crearEncargo({
      instruccion: e.instruccion,
      paraNodo: instruccionContinuar(e.instruccion, t, e.idioma),
      quien: e.quien,
      motor: e.motor,
      aparato: e.aparato,
      idioma: e.idioma,
      maxPasos: e.maxPasos,
      vuelta: e.vuelta + 1,
      mision: e.mision,
    }).catch(() => null);
    if (e2) {
      e.mision.pasosPrevios += pasosUtiles(t);
      moverPlan(e, t);
      e2.indiceAlEmpezar = e.mision.indice;
      // Esta ya no se cuenta sola: el final de la misión es el de la que sigue.
      e.avisada = true;
      confirmarAvisos(e.quien, [e.id]);
      e2.soltada = Date.now();
      e2.ultimaVoz = e2.soltada; // el «sigo con la misión» ya se dijo
      anotarPendiente(e2);
      // En el turno lo dice el cerebro (el HECHO lo cuenta); después, el teléfono.
      const dicho = e.idioma === 'en' ? 'I need a bit more; I keep going.' : 'Me falta un poco; sigo con la misión.';
      avisarApp(e2, { tipo: 'computadora', fase: 'sigue', id: e2.id, ...(enTurno ? {} : { texto: dicho }) });
      return { sigue: e2 };
    }
  }
  cerrarMision(e, t);
  if (enTurno || (t.estado === 'parada' && !t.error)) {
    e.avisada = true;
    confirmarAvisos(e.quien, [e.id]);
    avisarApp(e, { tipo: 'computadora', fase: 'termina', id: e.id, ok: !!e.mision.final?.ok });
    return { sigue: null };
  }
  const llego = avisarApp(e, { tipo: 'computadora', fase: 'termina', id: e.id, ok: !!e.mision.final?.ok, texto: e.mision.final?.texto ?? fraseDeFinal(e.instruccion, t, e.idioma, e.mision.requisitos) }, true);
  if (llego) confirmarAvisos(e.quien, [e.id]);
  return { sigue: null };
}

/** Pide la tarea al nodo y la anota (de quién, su última, su misión, su seguimiento). */
async function crearEncargo(o: {
  instruccion: string;
  paraNodo: string;
  quien: string;
  motor: MotorNodo;
  aparato: string | null;
  /** La conversación del turno que la encargó (ver Mision.ambito). */
  ambito?: string | null;
  idioma: 'es' | 'en';
  maxPasos: number;
  vuelta: number;
  /** La misión de la que es parte; sin ella, esta tarea empieza una (con este plan). */
  mision?: Mision;
  plan?: { pasos: string[]; delCerebro: boolean };
  /**
   * El id de este pedido (el mismo en el reintento): el nodo devuelve la misma tarea si ya la había creado y
   * la respuesta se perdió, en lugar de lanzar otra (auditoría 3-oct, PC04).
   */
  pedido?: string;
  /** Lo que la persona pidió en su turno (R5): con la instrucción, da los requisitos de la misión. */
  pedidoPersona?: string;
}): Promise<Encargo> {
  // `desde_tarea`: la primera tarea de la misión, para que el nodo cuente como «de esta misión» lo que se guardó en
  // una vuelta anterior (agente.py nuevo; el de antes lo ignora).
  const creada: { id: string } = await pedir('/tareas', {
    method: 'POST',
    body: JSON.stringify({ instruccion: o.paraNodo, motor: o.motor, max_pasos: o.maxPasos, dueno: huellaDe(o.quien), ...(o.pedido ? { request_id: o.pedido } : {}), ...(o.mision ? { desde_tarea: o.mision.id } : {}) }),
  });
  // Ya la conocía (el nodo dijo que era la misma de un pedido anterior): no se anota ni se sigue dos veces.
  const yaEra = ENCARGOS.get(creada.id);
  if (yaEra && yaEra.quien === o.quien) return yaEra;
  const ahora = Date.now();
  const m: Mision = o.mision ?? {
    id: creada.id,
    quien: o.quien,
    instruccion: o.instruccion,
    plan: o.plan?.pasos ?? planDeMision(o.instruccion, o.idioma),
    planDelCerebro: !!o.plan?.delCerebro,
    requisitos: requisitosCombinados(o.instruccion, o.pedidoPersona),
    ...(o.pedidoPersona ? { pedidoPersona: String(o.pedidoPersona).slice(0, 2000) } : {}),
    inicio: ahora,
    tareas: [],
    indice: 0,
    recibos: {},
    rondas: 0,
    pasosPrevios: 0,
    idioma: o.idioma,
    motor: o.motor,
    aparato: o.aparato,
    ambito: o.ambito ?? o.aparato ?? null,
    maxPasos: o.maxPasos,
  };
  m.tareas.push(creada.id);
  m.motor = o.motor;
  if (!o.mision) anotarMision(m);
  const e: Encargo = {
    id: creada.id,
    quien: o.quien,
    instruccion: o.instruccion,
    creada: ahora,
    aparato: o.aparato,
    idioma: o.idioma,
    motor: o.motor,
    maxPasos: o.maxPasos,
    vuelta: o.vuelta,
    narrado: 0,
    ultimaVoz: 0,
    dichas: 0,
    porAccion: {},
    mision: m,
    indiceAlEmpezar: m.indice,
    fallos: 0,
    primerFallo: 0,
    limite: ahora + SEGUIR_MAX_MS,
    gen: 0,
    version: 0,
  };
  ENCARGOS.set(e.id, e);
  ULTIMA.set(o.quien, e.id);
  seguir(e);
  return e;
}

/**
 * Encargar, con un segundo intento si el nodo no contestó (un 4xx es un no de verdad: no se insiste). Los dos
 * intentos llevan el MISMO id de pedido: si el primero sí llegó y solo se perdió la respuesta, el nodo devuelve
 * esa tarea y no lanza otra.
 */
async function crearConReintento(o: Parameters<typeof crearEncargo>[0]): Promise<Encargo> {
  const conPedido = { ...o, pedido: o.pedido || crypto.randomUUID() };
  try {
    return await crearEncargo(conPedido);
  } catch (err) {
    if (!reintentable(err)) throw err;
    await esperar(TIEMPOS_SEGUIR.reintentoMs);
    try {
      return await crearEncargo(conPedido);
    } catch (err2: any) {
      throw new ErrorNodo(`no contestó tras dos intentos: ${String(err2?.message || err2).slice(0, 100)}`, err2?.status);
    }
  }
}

/**
 * El resultado contado para el modelo: qué pasó, en cuántos pasos, la respuesta tal cual y si lo entregado se
 * comprobó. Lo que no se comprobó va marcado SIN COMPROBAR con la orden de no darlo por hecho (revisión externa, 4-oct:
 * AURA no dice «ya lo guardé» si el nodo no encontró el archivo).
 */
export function resumenTarea(t: Tarea, instruccion: string = t.instruccion, requisitos?: PedidoEntrega | null): string {
  const pasos = pasosUtiles(t);
  if (t.estado === 'hecha') {
    const ent = entregaDe(instruccion, t, requisitos);
    const dijo = String(t.respuesta || '').slice(0, 1500);
    if (!ent.comprobada && ent.respondida && !misionIncompleta(t)) {
      return (
        `RESPONDIDA (no comprobada), en ${pasos} pasos (${Math.round(t.segundos)} s). Lo que respondió tu computadora: ${dijo || '(nada)'} ` +
        `Díselo como respuesta. Si además te pidió que hicieras algo, dile que eso NO está comprobado y que lo revise antes de darlo por hecho. No digas «listo» ni que quedó hecho, y tampoco que tu computadora no tocó nada: corrió y pudo tocar cosas.`
      );
    }
    if (!ent.comprobada) {
      return (
        `Hecha en ${pasos} pasos (${Math.round(t.segundos)} s), según tu computadora. Lo que dijo: ${dijo || '(nada)'} ` +
        `SIN COMPROBAR: ${ent.falta || 'no pude comprobarlo.'}${ent.tipo === 'archivo' && ent.hechos ? ` Sí se comprobó: ${listaComprobados(ent, 10)}.` : ''} No digas que quedó hecho ni guardado: di que tu computadora dice que terminó, que no pudiste comprobarlo todo, cuenta qué se comprobó y qué falta de cada cosa, y ofrece revisarlo.`
      );
    }
    const lista = ent.tipo === 'archivo' ? listaComprobados(ent, 10) : '';
    return `Hecha en ${pasos} pasos (${Math.round(t.segundos)} s). Lo que encontró o hizo: ${dijo}${lista ? ` COMPROBADO por tu computadora, cada cosa pedida con su archivo (${ent.hechos} de ${ent.total}): ${lista}.` : ''}`;
  }
  if (t.estado === 'parada') return t.error ? `Se detuvo antes de terminar: ${t.error}.` : 'La pararon antes de terminar.';
  if (t.estado === 'sin_pasos') return `No la terminó en ${pasos} pasos. ${t.error || ''}`.trim();
  return `Falló: ${t.error || 'sin detalle'}.`;
}

/**
 * Encarga una tarea y espera hasta `esperaMs`. Si termina, el HECHO lleva el resultado; si no, dice que
 * sigue (y en qué paso va) y la tarea se sigue mirando: se narra en el teléfono y su final se le dice
 * en cuanto llegue. Al empezar, el teléfono abre la vista en vivo (`empieza`).
 */
export async function encargarTarea(o: {
  instruccion: string;
  quien: string;
  motor: MotorNodo;
  esperaMs: number;
  senal?: AbortSignal;
  maxPasos?: number;
  /** El teléfono del turno (x-aura-aparato). */
  aparato?: string | null;
  /** La conversación del turno (server.ts ambitoDelTurno); sin ella, la del aparato. */
  ambito?: string | null;
  idioma?: 'es' | 'en';
  /** Encargada desde la app (sin turno): el teléfono dice el plan en voz al empezar. */
  decirPlan?: boolean;
  /** El id del pedido de la app (`requestId`): repetido, el nodo devuelve la misma tarea. */
  pedido?: string;
  /**
   * Lo que pidió la PERSONA en el turno (R5). El argumento de la herramienta lo escribe el modelo y puede parafrasear
   * «tres capturas» como «una captura»: los requisitos salen de los dos y gana lo más exigente.
   */
  pedidoPersona?: string;
}): Promise<{ hecho: string; id: string | null; tarea: Tarea | null; incierto?: boolean; comprobada?: boolean; respondida?: boolean }> {
  if (!computadoraConfigurada()) {
    return { hecho: 'HARNESS computadora: no está configurada en este servidor. No la usé; dilo con naturalidad.', id: null, tarea: null };
  }
  const idioma: 'es' | 'en' = o.idioma === 'en' ? 'en' : 'es';
  // «… PLAN: a | b | c»: el plan que escribió el cerebro (si no, uno armado de la instrucción).
  const separado = separarPlan(o.instruccion);
  const instruccion = separado.mision;
  const plan = { pasos: separado.plan ?? planDeMision(instruccion, idioma), delCerebro: !!separado.plan };
  let e: Encargo;
  let nota = '';
  const base = { instruccion, paraNodo: prepararMision(instruccion, idioma), quien: o.quien, aparato: o.aparato ?? null, ambito: o.ambito ?? o.aparato ?? null, idioma, maxPasos: o.maxPasos ?? 25, vuelta: 0, plan, pedido: o.pedido, pedidoPersona: o.pedidoPersona };
  try {
    try {
      e = await crearConReintento({ ...base, motor: o.motor });
    } catch (err: any) {
      // Eligió Claude en Ajustes pero el nodo no tiene su clave: la hace la gratis, y se dice.
      if (o.motor !== 'claude' || !/claude/i.test(String(err?.message || ''))) throw err;
      e = await crearConReintento({ ...base, motor: 'holo' });
      nota = ' (La hizo el modelo gratis: Claude no está configurado en la computadora.)';
    }
  } catch (err: any) {
    // `incierto`: el nodo no contestó (o dio 5xx) después de que el pedido pudo llegarle; un 4xx o una conexión
    // rechazada son un no de verdad (no se creó nada).
    return { hecho: `HARNESS computadora: no pude encargarla (${String(err?.message || err).slice(0, 120)}). Dilo con honestidad y ofrece intentarlo en un momento. No inventes el resultado.`, id: null, tarea: null, incierto: pedidoPudoLlegar(err) };
  }
  // El teléfono abre la vista en vivo: la captura, el plan, los pasos en palabras y el tecleo bajito.
  const dichoPlan = o.decirPlan ? fraseDePlan(plan.pasos, idioma) : '';
  const enVivo = avisarApp(e, { tipo: 'computadora', fase: 'empieza', id: e.id, plan: plan.pasos, ...(dichoPlan ? { texto: dichoPlan } : {}) }) > 0;
  const mira = enVivo
    ? 'En su teléfono ya se abrió sola la vista en vivo de tu computadora: dile que mire la pantalla, que le vas contando y que le dices el resultado en cuanto termine.'
    : 'Puede mirarla en vivo en la app, en «Más → Su computadora»; le dices el resultado en cuanto termine.';
  // Si el plan no lo escribió el cerebro, que lo diga en una frase (como un agente: primero el plan).
  const conPlan = plan.delCerebro ? '' : ` Tu plan: ${plan.pasos.join(' → ')}; díselo en una frase corta.`;
  const hasta = Date.now() + Math.max(0, o.esperaMs);
  let t: Tarea | null = null;
  // El plazo es de verdad: ni la pausa ni la consulta se pasan de lo que queda (ni de la interrupción).
  while (Date.now() < hasta && !o.senal?.aborted) {
    await esperar(Math.min(SONDEO_MS, hasta - Date.now()), o.senal);
    const queda = hasta - Date.now();
    if (queda <= 0 || o.senal?.aborted) break;
    const gen = e.gen;
    let leida: Tarea;
    try {
      leida = await verTarea(e.id, false, Math.min(10_000, queda), o.senal);
    } catch {
      continue;
    }
    // Se cerró mientras se consultaba (AUR04): vale el final que ya se decidió, no la lectura vieja.
    if (!aceptarLectura(e, gen, leida)) {
      if (e.cerrada && e.terminada) return { hecho: `HARNESS computadora «${instruccion.slice(0, 160)}»: ${resumenTarea(e.terminada, instruccion, e.mision.requisitos)}${nota}`, id: e.id, tarea: e.terminada, comprobada: !!e.mision.final?.comprobado, respondida: !!e.mision.final?.respondida };
      continue;
    }
    t = leida;
    moverPlan(e, t);
    // Se detuvo a pedir permiso antes de algo sensible: lo pregunta el turno (el teléfono pone los botones).
    if (t.estado === 'confirmar' && t.pregunta && !e.cerrada) {
      alCambiarEstado(e, t, true);
      e.soltada = Date.now();
      anotarPendiente(e);
      return {
        hecho:
          `HARNESS computadora «${instruccion.slice(0, 160)}»: tu computadora se detuvo a pedir permiso antes de algo sensible: «${t.pregunta}». ` +
          `Pregúntale con esas palabras si lo haces (sí o no) y espera su respuesta; no digas que ya lo hiciste.${conPlan} ${mira}`,
        id: e.id,
        tarea: t,
      };
    }
    if (TERMINADA.has(t.estado) && !e.cerrada) {
      const { sigue } = await alTerminar(e, t, true);
      if (sigue) {
        return {
          hecho:
            `HARNESS computadora «${instruccion.slice(0, 160)}»: la primera parte no alcanzó (${resumenTarea(t, instruccion, e.mision.requisitos).slice(0, 200)}) y ya sigue sola en tu computadora con lo que falta.${nota} ` +
            `Di que sigues trabajando en eso. ${mira} No inventes el resultado.`,
          id: sigue.id,
          tarea: t,
        };
      }
      return { hecho: `HARNESS computadora «${instruccion.slice(0, 160)}»: ${resumenTarea(t, instruccion, e.mision.requisitos)}${nota}`, id: e.id, tarea: t, comprobada: !!e.mision.final?.comprobado, respondida: !!e.mision.final?.respondida };
    }
  }
  if (!e.cerrada) {
    e.soltada = Date.now();
    anotarPendiente(e);
  }
  const ultimo = t?.pasos?.[t.pasos.length - 1];
  const vaEn = ultimo ? ` Va en el paso ${ultimo.n} (${pasoEnPalabras(ultimo)}).` : '';
  return {
    hecho:
      `HARNESS computadora «${instruccion.slice(0, 160)}»: la tarea sigue en tu computadora.${vaEn}${nota} ` +
      `Di que ya la estás haciendo («ya la estoy usando, mira la pantalla»).${conPlan} ${mira} No inventes el resultado.`,
    id: e.id,
    tarea: t,
  };
}

/** El plan dicho en voz, en una frase: «Va. Mi plan: entrar a bch.hn, leer… y darte el resultado.» */
export function fraseDePlan(plan: readonly string[], idioma: 'es' | 'en' = 'es'): string {
  const ps = plan.map((p) => p.charAt(0).toLowerCase() + p.slice(1));
  const lista = ps.length > 1 ? `${ps.slice(0, -1).join(', ')} ${idioma === 'en' ? 'and' : 'y'} ${ps[ps.length - 1]}` : ps[0] || '';
  return idioma === 'en' ? `On it. My plan: ${lista}.` : `Va. Mi plan: ${lista}.`;
}

/**
 * Las misiones de esta persona que esperan su sí ahora, si la pregunta sigue valiendo (la más reciente primero). Con
 * `ambito`, solo las que encargó ESA conversación (revisión 4-oct: una pregunta de otra pantalla no vuelve ambiguo el
 * «sí» de esta, ni se contesta desde aquí).
 */
function misionesConPregunta(quien: string, ambito?: string): Mision[] {
  const out: Mision[] = [];
  for (const id of [...(HISTORIAL.get(quien) ?? [])].reverse()) {
    const m = MISIONES.get(id);
    if (ambito !== undefined && (m?.ambito ?? null) !== ambito) continue;
    if (m?.pregunta && !m.final && Date.now() - m.pregunta.desde < PREGUNTA_VALE_MS && !out.includes(m)) out.push(m);
  }
  return out;
}

/**
 * Lo que su computadora espera que conteste por el chat (permisos exactos, 4-oct): cada pregunta (antes de algo
 * sensible) y el «¿sigo?» de una misión a medias. Con más de una, un «sí» suelto no decide cuál (server/decision-turno.ts).
 */
export function preguntasComputadora(quien: string, ambito?: string): { tareaId: string; texto: string; version?: string }[] {
  if (!quien) return [];
  const ps = misionesConPregunta(quien, ambito).map((m) => ({ tareaId: m.pregunta!.tareaId, texto: m.pregunta!.texto, version: versionPregunta(m.pregunta!) }));
  const ofrece = ps.length ? null : misionQueOfreceSeguir(quien, ambito);
  return ofrece ? [{ tareaId: ofrece.tareas.at(-1) ?? '', texto: `¿sigo con «${ofrece.instruccion.slice(0, 120)}»?` }] : ps;
}

function misionQueOfreceSeguir(quien: string, ambito?: string): Mision | null {
  const id = (HISTORIAL.get(quien) ?? []).at(-1);
  const m = id ? MISIONES.get(id) : null;
  if (m && ambito !== undefined && (m.ambito ?? null) !== ambito) return null;
  return m?.ofreceSeguir && Date.now() - m.ofreceSeguir < SEGUIR_VALE_MS ? m : null;
}

/**
 * La pregunta de la tarea `id` que contesta un sí de la app (AUR02): la que este servidor le mostró para ESA tarea
 * o, si no, la que el nodo tiene ahora para ella. Si la app nombra una (`pedida`), tiene que ser esa: un id de otra
 * tarea, de otra persona (la ruta ya lo niega) o de una pregunta que ya cambió no aprueba nada, aunque el nodo no lo
 * revisara. Devuelve el id y la huella de la propuesta mostrada (el nodo nuevo la revisa también); null: no vale.
 */
export async function preguntaDeTarea(id: string, pedida: string | null, propuestaPedida: string | null = null): Promise<PreguntaAtada | null> {
  const e = ENCARGOS.get(id);
  if (!e || e.cerrada) return null;
  const mostrada = e.mision.pregunta?.tareaId === id ? e.mision.pregunta : null;
  let p: PreguntaAtada | null = null;
  if (mostrada?.id && (!pedida || pedida === mostrada.id)) p = { id: mostrada.id, huella: mostrada.huella ?? null };
  else {
    const t = await verTarea(id, false, 8000).catch(() => null);
    if (!t || t.estado !== 'confirmar' || !t.pregunta) return null;
    if (pedida && t.pregunta_id !== pedida) return null;
    p = { id: t.pregunta_id ?? null, huella: t.propuesta ?? null };
  }
  // Si la app dice qué propuesta vio (revisión 4-oct), tiene que ser esta: la de otra (otro destino) no aprueba nada.
  if (propuestaPedida && propuestaPedida !== p.huella) return null;
  return p;
}

/** Ya contestó su sí o su no: el teléfono quita los botones y vuelve el tecleo enseguida (sin esperar al sondeo). */
function alResponder(tareaId: string, preguntaId?: string | null) {
  const e = ENCARGOS.get(tareaId);
  if (!e || e.cerrada) return;
  e.contestada = { texto: e.mision.pregunta?.texto ?? '', id: preguntaId ?? e.mision.pregunta?.id ?? null, en: Date.now() };
  e.mision.pregunta = null;
  e.ultimoEstado = 'trabajando';
  avisarApp(e, { tipo: 'computadora', fase: 'reanuda', id: e.id });
}

/** Lo que el turno de voz le da al servidor para soltar las acciones cuando se confirma (server/voz-agente.ts). */
type Retener = { hacer: (f: () => void) => void; alDescartar: (f: () => void) => void };

/**
 * Al empezar el turno: si su computadora espera su sí (o le ofreció seguir) y dijo «sí» o «no», se resuelve
 * AQUÍ (lo hace el servidor, no el modelo) y vuelve el HECHO para que AURA lo diga. Otra cosa: null (la
 * pregunta sigue esperando, y la app tiene los botones). En la voz, espera a que el turno se confirme.
 */
/** La versión de una pregunta (su id, su huella y su texto): un «sí» decidido para una no contesta otra (G1-N1). */
function versionPregunta(p: { id: string | null; huella?: string | null; texto: string }): string {
  return `${p.id ?? ''}|${p.huella ?? ''}|${p.texto}`;
}

export async function resolverPreguntaComputadora(quien: string, mensaje: string, retener?: Retener, opciones: { ambito?: string; elegida?: string; version?: string } = {}): Promise<string | null> {
  if (!quien) return null;
  // `ambito`: solo las de esta conversación. `elegida`: la tarea cuya pregunta nombró la persona (server/decision-turno.ts).
  const enEsta = misionesConPregunta(quien, opciones.ambito);
  const conPregunta = opciones.elegida ? enEsta.filter((x) => x.pregunta?.tareaId === opciones.elegida) : enEsta;
  const m = conPregunta[0] ?? null;
  // Séptima ronda (G1-N1): lo decidido fue ESA versión de la pregunta; si mientras tanto cambió, no se contesta.
  if (opciones.version !== undefined && m?.pregunta && versionPregunta(m.pregunta) !== opciones.version) {
    return `COMPUTADORA: NO contesté nada: mientras se decidía, su computadora cambió la pregunta (ahora: «${m.pregunta.texto}»). Léesela y pregúntale de nuevo.`;
  }
  const ofrece = m || enEsta.length ? null : misionQueOfreceSeguir(quien, opciones.ambito);
  if (!m && !ofrece) return null;
  // Las marcas del propio teléfono («[[lectura:…]]», «[[sigues]]») no son la persona.
  if (/^\s*\[\[/.test(String(mensaje || ''))) return null;
  const r = respuestaSiNo(mensaje);
  if (!r) {
    // Habló de otra cosa: el «¿sigo?» ya no vale para un «sí» suelto de después (el botón Seguir sí).
    // La pregunta antes de algo sensible sigue esperando: los botones están en la app.
    if (ofrece) ofrece.ofreceSeguir = undefined;
    return null;
  }
  // Permisos exactos (4-oct): dos misiones esperan su sí a la vez. Un «sí» (o un «no») suelto no dice a cuál: antes
  // contestaba la más reciente, aunque la persona hablara de la otra. No se contesta ninguna.
  if (conPregunta.length > 1) {
    return `COMPUTADORA: NO contesté nada: hay ${conPregunta.length} preguntas de su computadora esperando su sí (${conPregunta.map((x) => `«${x.pregunta!.texto}»`).join(' y ')}) y su «${r === 'si' ? 'sí' : 'no'}» no dice a cuál. Pregúntale cuál; también puede contestar cada una con sus botones en la app.`;
  }
  if (m) {
    const p = m.pregunta!;
    // Permisos exactos (4-oct): esta pregunta reemplazó a otra que esperaba (otra propuesta, quizá otro destino). Su
    // «sí» pudo ser para la de antes: no contesta esta. Se le dice qué pregunta ahora; el «sí» siguiente ya es para esta.
    if (r === 'si' && p.reemplazoDe) {
      const antes = p.reemplazoDe;
      delete p.reemplazoDe;
      // Un turno de voz que se descarta (la frase seguía) no cuenta como «ya se le dijo».
      retener?.alDescartar(() => {
        if (m.pregunta === p) p.reemplazoDe = antes;
      });
      return `COMPUTADORA: NO contesté todavía: antes de su «sí» su computadora cambió la pregunta (antes: «${antes}»; ahora: «${p.texto}»). Su «sí» pudo ser para la de antes. Léele la de ahora tal cual y pregúntale; si dice que sí otra vez, la contesto.`;
    }
    m.pregunta = null;
    // El sí va atado a ESTA pregunta: si cuando por fin sale (la voz espera a que el turno se confirme) la
    // computadora ya pregunta otra cosa, el nodo no la contesta con él (auditoría 3-oct, PC01).
    // Revisión 4-oct: el «sí» va atado a la huella de la propuesta que se le dijo; justo antes se revisa contra lo que el
    // nodo pregunta ahora (otra propuesta bajo el mismo id, otro destino: no se contesta con este «sí»).
    const hacer = () => confirmarAtado(p.tareaId, r === 'si', { id: p.id, huella: p.huella ?? null }).then(() => alResponder(p.tareaId, p.id));
    if (retener) {
      retener.alDescartar(() => {
        m.pregunta = p;
      });
      retener.hacer(() => void hacer().catch(() => undefined));
    } else {
      try {
        await hacer();
      } catch (err: any) {
        // Ya pregunta otra cosa (u otra propuesta): esa se avisa sola con su texto nuevo; esta no vuelve.
        if (err instanceof ErrorNodo && err.status === 409) {
          return `COMPUTADORA: NO contesté «${r === 'si' ? 'sí' : 'no'}» a «${p.texto}»: ${String(err.message).slice(0, 160)}. Díselo con honestidad: su computadora pregunta otra cosa ahora; que la mire antes de decidir.`;
        }
        m.pregunta = p;
        return `COMPUTADORA: quiso contestar «${r === 'si' ? 'sí' : 'no'}» a «${p.texto}», pero tu computadora no recibió la respuesta (${String(err?.message || err).slice(0, 80)}). Díselo y que lo toque en la app.`;
      }
    }
    return r === 'si'
      ? `COMPUTADORA: dijo que sí a «${p.texto}»; tu computadora sigue con eso. Díselo en una frase («va, sigo»).`
      : `COMPUTADORA: dijo que no a «${p.texto}»; tu computadora no lo hace y sigue sin eso. Díselo en una frase.`;
  }
  const o = ofrece!;
  o.ofreceSeguir = undefined;
  if (r === 'no') return `COMPUTADORA: no quiere que sigas con «${o.instruccion.slice(0, 120)}». Dile que está bien, que ahí queda.`;
  if (retener) {
    retener.alDescartar(() => {
      o.ofreceSeguir = Date.now();
    });
    retener.hacer(() => void seguirMision(o).catch(() => undefined));
  } else if (!(await seguirMision(o).catch(() => null))) {
    return `COMPUTADORA: quiso que siguieras con «${o.instruccion.slice(0, 120)}», pero tu computadora no contestó. Díselo con honestidad.`;
  }
  return `COMPUTADORA: dijo que sí; tu computadora sigue con «${o.instruccion.slice(0, 120)}» desde donde quedó. Dile que ya sigues y que mire la pantalla.`;
}

/** Sigue una misión que quedó a medias, desde donde quedó la pantalla (el «sí» a «¿sigo?» o el botón «Seguir»). */
export async function seguirMision(m: Mision, conTexto = false): Promise<Encargo | null> {
  if (m.rondas >= MAX_RONDAS) return null;
  const anterior = ENCARGOS.get(m.tareas[m.tareas.length - 1] ?? '');
  m.rondas++;
  m.ofreceSeguir = undefined;
  m.pasosPrevios += anterior?.terminada ? pasosUtiles(anterior.terminada) : 0;
  const finAntes = { final: m.final, fin: m.fin };
  m.final = undefined;
  m.fin = undefined;
  let e: Encargo;
  try {
    e = await crearConReintento({
      instruccion: m.instruccion,
      paraNodo: instruccionContinuar(m.instruccion, anterior?.terminada ?? { pasos: [] }, m.idioma),
      quien: m.quien,
      motor: m.motor,
      aparato: m.aparato,
      idioma: m.idioma,
      maxPasos: m.maxPasos,
      vuelta: 0,
      mision: m,
    });
  } catch {
    Object.assign(m, finAntes);
    m.rondas--;
    m.ofreceSeguir = Date.now();
    return null;
  }
  e.soltada = Date.now();
  e.ultimaVoz = e.soltada;
  anotarPendiente(e);
  avisarApp(e, { tipo: 'computadora', fase: 'sigue', id: e.id, ...(conTexto ? { texto: m.idioma === 'en' ? 'On it, I keep going from where I was.' : 'Va, sigo desde donde me quedé.' } : {}) }, true);
  return e;
}

/**
 * Lo que dice el cerebro con «PEDIR_HERRAMIENTA: computadora parar | pausar | seguir» (la persona lo dijo en
 * voz: «para tu computadora», «pausa», «sigue»). Lo demás es una misión nueva (encargarTarea).
 */
export async function comandoComputadora(quien: string, arg: string): Promise<string | null> {
  const c = sinAcentos(String(arg || '')).replace(/[.!¡¿?]+/g, '').trim();
  const verbo = /^(parar|para|detener|detente|deten|cancelar|cancela|stop)$/.test(c)
    ? 'parar'
    : /^(pausar|pausa|pause)$/.test(c)
      ? 'pausar'
      : /^(seguir|sigue|reanudar|reanuda|continuar|continua|resume|continue)$/.test(c)
        ? 'seguir'
        : null;
  if (!verbo) return null;
  const id = ultimaTareaDe(quien);
  const e = id ? ENCARGOS.get(id) : null;
  if (!e) return 'HARNESS computadora: no hay ninguna tarea suya en tu computadora ahora. Díselo.';
  const m = e.mision;
  try {
    if (verbo === 'parar') {
      if (e.cerrada) return 'HARNESS computadora: tu computadora ya había terminado; no había nada que parar. Díselo.';
      // «Paré» solo con quietud (AUR03): si un toque ya había salido, se termina (no se puede deshacer) y queda parada.
      const p = await pararTarea(e.id);
      if (p.fase === 'draining' || p.fase === 'fenced')
        return `HARNESS computadora: le pedí parar «${m.instruccion.slice(0, 120)}» y ya no empieza nada nuevo, pero está terminando una acción que ya había empezado (no la puede deshacer); en cuanto termine queda detenida. Díselo así, sin decir que ya paró.`;
      return `HARNESS computadora: paré «${m.instruccion.slice(0, 120)}». Díselo en una frase.`;
    }
    const caps = await capacidadesNodo();
    if (verbo === 'pausar') {
      if (!caps.includes('pausar')) return 'HARNESS computadora: tu computadora todavía no sabe pausar (falta actualizar su servicio); solo puedo pararla del todo. Explícaselo y pregúntale si la paras.';
      const p = await pausarTarea(e.id);
      if (p.fase === 'draining') return 'HARNESS computadora: la pausé; está terminando la acción que ya había empezado y después se queda quieta hasta que diga «sigue». Díselo en una frase.';
      return 'HARNESS computadora: la pausé; sigue cuando diga «sigue». Díselo en una frase.';
    }
    if (e.cerrada) {
      if (m.ofreceSeguir || m.final?.ok === false) {
        const e2 = await seguirMision(m);
        if (e2) return `HARNESS computadora: sigo con «${m.instruccion.slice(0, 120)}» desde donde quedó. Dile que mire la pantalla.`;
      }
      return 'HARNESS computadora: no hay nada a medias que seguir. Díselo.';
    }
    if (!caps.includes('pausar')) return 'HARNESS computadora: tu computadora sigue trabajando (no estaba en pausa). Díselo.';
    await reanudarTarea(e.id);
    return 'HARNESS computadora: siguió donde estaba. Díselo en una frase.';
  } catch (err: any) {
    return `HARNESS computadora: no pude (${String(err?.message || err).slice(0, 100)}). Díselo con honestidad.`;
  }
}

function esperar(ms: number, senal?: AbortSignal): Promise<void> {
  return new Promise((r) => {
    if (ms <= 0 || senal?.aborted) return r();
    const t = setTimeout(r, ms);
    senal?.addEventListener('abort', () => (clearTimeout(t), r()), { once: true });
  });
}

/** Su última tarea, en corto (sin capturas): para el aviso de la mesa «tu computadora está trabajando». */
export async function resumenUltima(quien: string): Promise<{ id: string; estado: EstadoTarea; pasos: number; instruccion: string; ultimo: string | null } | null> {
  const id = ultimaTareaDe(quien);
  if (!id) return null;
  try {
    const t = await verTarea(id, false, 5000);
    const u = t.pasos[t.pasos.length - 1];
    return { id, estado: t.estado, pasos: t.pasos.length, instruccion: (misionDe(id) || t.instruccion).slice(0, 200), ultimo: u ? pasoEnPalabras(u) : null };
  } catch {
    return null;
  }
}

/** Pruebas: olvidar los encargos. */
export function _olvidarEncargos() {
  for (const e of ENCARGOS.values()) if (e.reloj) clearTimeout(e.reloj);
  ENCARGOS.clear();
  MISIONES.clear();
  HISTORIAL.clear();
  capsCache = null;
  ULTIMA.clear();
  PENDIENTES.clear();
}

/* ------------------------------------------------------------------ rutas para la app y la web */

type DepsRutas = {
  exigirMesa: import('express').RequestHandler;
  limitar: (max: number, ventanaMs?: number, grupo?: string) => import('express').RequestHandler;
  /** La sesión autenticada (server/seguridad.ts): el correo y su token (el visor deriva de él su cliente, AUR09). */
  sesionDe: (req: import('express').Request) => { correo: string; token?: string } | null;
  /** Qué motor eligió en Ajustes («gratis» o «pago»); sin perfil, gratis. */
  motorDe?: (correo: string) => Promise<string | null | undefined>;
};

/**
 * La tarea para la app: con la captura SOLO del último paso (lo que la computadora está viendo ahora),
 * o la del paso que se pidió (`paso`). Todas juntas pesaban casi 1 MB en cada consulta.
 */
export function tareaParaApp(t: Tarea, paso?: number): Tarea {
  // Sin `paso`: el último paso con captura («escritorio_limpio» no trae): lo más reciente que vio.
  const mostrar = Number.isFinite(paso) ? Number(paso) : ([...t.pasos].reverse().find((p) => p.miniatura)?.n ?? -1);
  return { ...t, pasos: t.pasos.map((p) => (p.n === mostrar ? p : { ...p, miniatura: undefined })) };
}

/** Lo que dice cada paso, en palabras de persona (la app lo muestra en la lista de pasos). Lo que no se hizo, lo dice. */
export function pasoEnPalabras(p: Pick<PasoTarea, 'accion' | 'args' | 'hecho'>, idioma: 'es' | 'en' = 'es'): string {
  const texto = pasoEnPalabrasSolo(p, idioma);
  return p.hecho === false ? `${texto} ${idioma === 'en' ? '(not done)' : '(no se hizo)'}` : texto;
}

function pasoEnPalabrasSolo(p: Pick<PasoTarea, 'accion' | 'args'>, idioma: 'es' | 'en'): string {
  const a = (p.args || {}) as Record<string, any>;
  const en = idioma === 'en';
  const corto = (x: unknown, n = 60) => {
    const t = String(x ?? '').replace(/\s+/g, ' ').trim();
    return t.length > n ? `${t.slice(0, n - 1)}…` : t;
  };
  switch (p.accion) {
    case 'escritorio_limpio':
      return en ? 'Started a clean desktop' : 'Abrió un escritorio limpio';
    case 'open_url':
      return en ? `Opened ${corto(a.url)}` : `Abrió ${corto(a.url)}`;
    case 'click':
    case 'left_click':
      return a.element ? (en ? `Clicked «${corto(a.element, 40)}»` : `Tocó «${corto(a.element, 40)}»`) : en ? 'Clicked' : 'Hizo clic';
    case 'pedir_confirmacion':
      return en ? `Asked for your OK: «${corto(a.pregunta, 80)}»` : `Te pidió permiso: «${corto(a.pregunta, 80)}»`;
    case 'confirmacion':
      return a.si ? (en ? 'You said yes' : 'Dijiste que sí') : en ? 'You said no' : 'Dijiste que no';
    case 'persona':
      if (a.tipo === 'click' || a.tipo === 'pointer') return a.accion === 'arrastre' ? (en ? 'You dragged on the screen' : 'Tú arrastraste en la pantalla') : en ? 'You tapped the screen' : 'Tú tocaste la pantalla';
      if (a.tipo === 'escribir') return en ? `You typed (${Number(a.letras) || 0} characters)` : `Tú escribiste (${Number(a.letras) || 0} letras)`;
      if (a.tipo === 'texto') return en ? 'You typed' : 'Tú escribiste';
      if (a.tipo === 'tecla' || a.tipo === 'key') return en ? `You pressed ${corto(a.teclas, 20)}` : `Tú presionaste ${corto(a.teclas, 20)}`;
      return en ? 'You scrolled' : 'Tú moviste la página';
    case 'modo_seguro':
      return a.activo ? (en ? 'Secure input: AURA neither saw nor touched anything' : 'Entrada segura: AURA no vio ni tocó nada') : en ? 'Secure input ended' : 'Terminó la entrada segura';
    case 'screenshot':
      return en ? 'Looked at the screen' : 'Miró la pantalla';
    case 'zoom':
      return en ? 'Zoomed in to read' : 'Acercó para leer';
    case 'mouse_move':
      return en ? 'Moved the mouse' : 'Movió el ratón';
    case 'double_click':
      return en ? 'Double-clicked' : 'Hizo doble clic';
    case 'right_click':
      return en ? 'Right-clicked' : 'Hizo clic derecho';
    case 'type':
      return en ? `Typed «${corto(a.text, 50)}»${a.press_enter ? ' and pressed Enter' : ''}` : `Escribió «${corto(a.text, 50)}»${a.press_enter ? ' y dio Enter' : ''}`;
    case 'key':
      return en ? `Pressed ${corto(a.keys, 30)}` : `Presionó ${corto(a.keys, 30)}`;
    case 'scroll':
      return a.direction === 'up' ? (en ? 'Scrolled up' : 'Subió en la página') : en ? 'Scrolled down' : 'Bajó en la página';
    case 'drag':
      return en ? 'Dragged' : 'Arrastró';
    case 'wait':
      return en ? 'Waited for the page' : 'Esperó a que cargara';
    case 'answer':
      return en ? 'Finished and reported' : 'Terminó y dio el resultado';
    case 'nada':
      return en ? 'Looked at the screen' : 'Miró la pantalla';
    default:
      return corto(p.accion, 40);
  }
}

/**
 * Lo que la app muestra de su computadora: si está, qué motores ofrece, su última tarea con las
 * capturas de cada paso, y el botón de pararla. Cada quien ve solo sus tareas.
 *   GET  /api/computadora            → { configurada, ok, motores, ocupada, capacidades, ultima, actual, historial }
 *   GET  /api/computadora/tareas/:id → la tarea con miniaturas (si es suya) y su `mision` (plan marcado, tiempo, pregunta, final)
 *   POST /api/computadora/tareas/:id/parar                         → { fase }: quiescent (detenida) o draining (termina un toque)
 *   POST /api/computadora/tareas/:id/pausar | /reanudar            (si el nodo sabe: capacidades)
 *   POST /api/computadora/tareas/:id/confirmar {si, preguntaId}     el sí o el no a ESA pregunta de ESA tarea
 *   POST /api/computadora/tareas/:id/control {tomar, clientId?, expectedControlEpoch?}  → { fase, epoca }
 *   POST /api/computadora/tareas/:id/accion {tipo, …}               lo que hace la persona con el control (la app de antes)
 *   POST /api/computadora/tareas/:id/entrada {RemoteInput}          el visor (AUR09): una entrada con su ACK → { ack }
 *   POST /api/computadora/tareas/:id/seguro {activar, clientId, frameSeq?}  entrada segura (contraseñas)
 *   GET  /api/computadora/tareas/:id/pantalla?ancho=                { imagen, frame } lo que se ve ahora (JPEG en base64) y su frame
 *   GET  /api/computadora/misiones/:id                              una misión del historial (con su tarjeta final)
 *   POST /api/computadora/misiones/:id/seguir                       sigue una misión que quedó a medias
 */
/**
 * El registro durable de un encargo de la app por su `requestId` (`computadora-pedidos/<huella>/<requestId>`):
 * `creando` (reservado: se está lanzando), con `id` (la tarea que creó), `libre` (no se creó nada: se puede
 * probar otra vez) o `incierto` (no se sabe si llegó al nodo).
 */
type RegistroPedidoApp = { id?: string; estado?: 'creando' | 'libre' | 'incierto'; en: number };

/**
 * Lanza el encargo de la app UNA vez por dueño + `requestId`, con lo durable delante (AUR06; revisión externa,
 * 4-oct). Persistir antes de actuar: se RESERVA el pedido (`creando`) antes de pedirle nada al nodo, y se anota la
 * tarea al volver. Un error del almacén no es «no existe»:
 *  · si no se puede mirar ni reservar, no se lanza (503 honesto);
 *  · si el pedido ya tiene su tarea, se devuelve esa (otra réplica, o antes de un reinicio);
 *  · si quedó `creando`/`incierto` (se cayó a medias, o no se pudo anotar la tarea creada), NO se lanza otra:
 *    409 `pedido_incierto`, que mire sus tareas antes de pedirlo de nuevo. El nodo dedupe por request_id solo en
 *    RAM: tras reiniciarse lanzaría otra.
 */
async function lanzarUnaVez(clave: string, correo: string, hacer: () => Promise<{ code: number; j: any; incierto?: boolean }>): Promise<{ code: number; j: any }> {
  const a = almacenDurable();
  const sinAlmacen = (detalle: string) => {
    console.warn('[computadora] no pude mirar o reservar el pedido en el almacén durable; no lo lanzo:', String(detalle).slice(0, 120));
    return { code: 503, j: { error: 'No pude comprobar si ese encargo ya estaba hecho, así que no lo lancé. Prueba en un momento.', code: 'almacen', honesto: true } };
  };
  const yaEstaba = (r: RegistroPedidoApp) => {
    if (r.id) {
      if (duenoDe(r.id) !== null && duenoDe(r.id) !== correo) return { code: 404, j: { error: 'No encuentro esa tarea.', honesto: true } };
      const m = misionDeTarea(r.id);
      return { code: 200, j: { id: r.id, mision: m ? vistaMision(m) : null, repetido: true, honesto: true } };
    }
    return {
      code: 409,
      j: { error: 'Ese encargo ya se estaba lanzando y no sé si llegó a tu computadora. Mira tus tareas antes de pedirlo otra vez; no lo lanzo de nuevo a ciegas.', code: 'pedido_incierto', honesto: true },
    };
  };
  const ahora = Date.now();
  const l = await leerDurable<RegistroPedidoApp>(clave, a).catch((e) => ({ ok: false as const, detalle: String(e?.message || e) }));
  if (l.ok === false) return sinAlmacen(l.detalle);
  let etag: string;
  if (l.valor && l.valor.estado === 'libre' && !l.valor.id) {
    const w = await a.cas(clave, { estado: 'creando', en: ahora }, l.etag!).catch((e) => ({ ok: false as const, conflicto: false as const, detalle: String(e?.message || e) }));
    if (w.ok === false) return w.conflicto ? yaEstaba({ estado: 'creando', en: ahora }) : sinAlmacen(w.detalle);
    etag = w.etag;
  } else if (l.valor) {
    return yaEstaba(l.valor);
  } else {
    const c = await crearUnaVez<RegistroPedidoApp>(clave, { estado: 'creando', en: ahora }, a).catch((e) => ({ ok: false as const, detalle: String(e?.message || e) }));
    if (c.ok === false) return sinAlmacen(c.detalle);
    if (!c.creado) return yaEstaba(c.valor);
    etag = c.etag;
  }
  const r = await hacer().catch((e: any) => ({ code: 502, incierto: true, j: { error: String(e?.message || e).slice(0, 120), honesto: true } }));
  // Lo que pasó, anotado sobre la reserva. Si no se puede guardar, queda `creando`: un reintento tras un reinicio
  // sabrá que no se sabe y no lanzará otra (aquí, el Map de pedidos la sigue devolviendo).
  const fin: RegistroPedidoApp = r.code === 200 && r.j?.id ? { id: String(r.j.id), en: Date.now() } : { estado: r.incierto ? 'incierto' : 'libre', en: Date.now() };
  const w = await a.cas(clave, fin, etag).catch((e) => ({ ok: false as const, conflicto: false as const, detalle: String(e?.message || e) }));
  if (w.ok === false) console.warn(`[computadora] no pude anotar cómo quedó el pedido; queda «creando» (un reintento no lanzará otro): ${String((w as { detalle?: string }).detalle || 'conflicto').slice(0, 120)}`);
  return r;
}

export function montarRutasComputadora(app: import('express').Express, d: DepsRutas) {
  type Req = import('express').Request;
  type Res = import('express').Response;
  const correoDe = (req: Req) => String(d.sesionDe(req)?.correo || '').toLowerCase();
  const sinSesion = (res: Res) => res.status(401).json({ error: 'Entra con tu sesión.', code: 'sesion_requerida', honesto: true });
  const noEsSuya = (res: Res) => res.status(404).json({ error: 'No encuentro esa tarea.', honesto: true });
  const noContesto = (res: Res, que: string, e: any) => {
    const st = e instanceof ErrorNodo ? e.status : undefined;
    // 409: la tarea ya no está en ese estado (terminó, ya contestó, todavía no empieza): el nodo dice por qué.
    if (st === 409 || st === 400) return res.status(409).json({ error: `${que}: ${String(e?.message || '').slice(0, 120)}.`, honesto: true });
    return res.status(502).json({ error: `${que}: la computadora no contestó (${String(e?.message || e).slice(0, 80)}).`, honesto: true });
  };
  /** Lo del agente.py nuevo: si el nodo no lo sabe, se dice claro (501) y la app ofrece solo Detener. */
  const exigirCapacidad = async (res: Res, c: CapacidadNodo): Promise<boolean> => {
    if ((await capacidadesNodo()).includes(c)) return true;
    const que = c === 'pausar' ? 'pausar' : c === 'control' ? 'dejarte tomar el control' : 'pedirte permiso';
    res.status(501).json({ error: `Tu computadora todavía no sabe ${que}: falta actualizar su servicio (docs/COMPUTADORA.md). Puedo detenerla.`, code: 'no_soportado', honesto: true });
    return false;
  };
  /** Una acción sobre una tarea suya: dueño, capacidad (si hace falta) y la llamada al nodo. */
  const sobreTarea = (que: string, cap: CapacidadNodo | null, hacer: (id: string, req: Req) => Promise<unknown>) => async (req: Req, res: Res) => {
    const correo = correoDe(req);
    if (!correo) return sinSesion(res);
    if (duenoDe(req.params.id) !== correo) return noEsSuya(res);
    if (cap && !(await exigirCapacidad(res, cap))) return;
    try {
      const r = await hacer(req.params.id, req);
      return res.json({ ok: true, ...(r && typeof r === 'object' ? r : {}), honesto: true });
    } catch (e: any) {
      if (e?.codigo === 400) return res.status(400).json({ error: e.message, honesto: true });
      return noContesto(res, que, e);
    }
  };

  app.get('/api/computadora', d.exigirMesa, d.limitar(40), async (req, res) => {
    const correo = correoDe(req);
    if (!correo) return sinSesion(res);
    const [estado, actual] = await Promise.all([estadoComputadora(), resumenUltima(correo)]);
    res.setHeader('Cache-Control', 'no-store');
    return res.json({ ...estado, ultima: ultimaTareaDe(correo), actual, pendientes: pendientesDe(correo), historial: historialDe(correo), version: versionDeEstado(), honesto: true });
  });

  /**
   * Los encargos de la app por su `requestId` (de quién + id): un doble toque o un reintento del teléfono
   * devuelve la misma misión en lugar de lanzar otra (auditoría 3-oct, PC04). Si falló, aquí se olvida y manda lo
   * durable (lanzarUnaVez): un no de verdad deja el pedido `libre` (el reintento prueba otra vez); si no se sabe si
   * llegó al nodo, queda `incierto` y el reintento no lanza otra.
   */
  const pedidosApp = new Map<string, { en: number; r: Promise<{ code: number; j: any }> }>();
  const PEDIDO_APP_VALE_MS = 10 * 60_000;

  /**
   * La persona le encarga algo a su computadora desde la app (sin pasar por la conversación). No espera:
   * la app mira los pasos en vivo, y si termina sin que la mire, el avatar se lo cuenta en el turno siguiente.
   */
  app.post('/api/computadora/tareas', d.exigirMesa, d.limitar(8), async (req, res) => {
    const correo = correoDe(req);
    if (!correo) return sinSesion(res);
    const instruccion = String(req.body?.instruccion || '').replace(/\s+/g, ' ').trim();
    if (instruccion.length < 4) return res.status(400).json({ error: 'Dile qué hacer (una frase con lo que quieres).', honesto: true });
    if (instruccion.length > 600) return res.status(400).json({ error: 'Muy largo: dilo en menos de 600 letras.', honesto: true });
    const motor = motorDelPerfil(await d.motorDe?.(correo).catch(() => null), correo);
    // El teléfono que la pidió (el mismo id de aparato que usa el canal de acciones): ahí se narra y se avisa.
    const aparato = String(req.headers['x-aura-aparato'] || '').trim();
    const idioma = req.body?.idioma === 'en' ? 'en' : 'es';
    const pedido = typeof req.body?.requestId === 'string' && /^[A-Za-z0-9._:-]{8,80}$/.test(req.body.requestId) ? String(req.body.requestId) : '';
    const hacer = async (): Promise<{ code: number; j: any; incierto?: boolean }> => {
      const r = await encargarTarea({ instruccion, quien: correo, motor, esperaMs: 0, aparato: /^[A-Za-z0-9._:-]{1,128}$/.test(aparato) ? aparato : null, idioma, decirPlan: true, pedido: pedido ? `app:${pedido}` : undefined });
      if (!r.id) return { code: 503, incierto: !!r.incierto, j: { error: r.hecho.replace(/^HARNESS computadora:\s*/, '').replace(/\s*(Dilo con honestidad.*|No inventes.*|No la usé.*|dilo con naturalidad\.?)$/i, ''), honesto: true } };
      return { code: 200, j: { id: r.id, mision: misionDeTarea(r.id) ? vistaMision(misionDeTarea(r.id)!) : null, honesto: true } };
    };
    if (!pedido) {
      const r = await hacer();
      return res.status(r.code).json(r.j);
    }
    const llave = `${correo}|${pedido}`;
    for (const [k, v] of pedidosApp) if (Date.now() - v.en > PEDIDO_APP_VALE_MS) pedidosApp.delete(k);
    const claveDurable = claveDe('computadora-pedidos', correo, pedido);
    let previo = pedidosApp.get(llave);
    if (!previo) {
      // El doble toque en este proceso espera esta misma promesa (se anota antes de cualquier espera).
      previo = { en: Date.now(), r: lanzarUnaVez(claveDurable, correo, hacer) };
      pedidosApp.set(llave, previo);
    }
    const r = await previo.r.catch((e: any) => ({ code: 502, j: { error: String(e?.message || e).slice(0, 120), honesto: true } }));
    if (r.code !== 200 && pedidosApp.get(llave) === previo) pedidosApp.delete(llave);
    // La misma misión, con su estado de ahora (no el del primer pedido).
    const m = r.code === 200 ? misionDeTarea(r.j.id) : null;
    return res.status(r.code).json(m ? { ...r.j, mision: vistaMision(m) } : r.j);
  });

  app.get('/api/computadora/tareas/:id', d.exigirMesa, d.limitar(90), async (req, res) => {
    const correo = correoDe(req);
    if (!correo) return sinSesion(res);
    if (duenoDe(req.params.id) !== correo) return noEsSuya(res);
    res.setHeader('Cache-Control', 'no-store');
    const m = misionDeTarea(req.params.id);
    const idioma = req.query.idioma === 'en' ? 'en' : 'es';
    try {
      const paso = req.query.paso != null ? Number(req.query.paso) : undefined;
      const leida = await verTarea(req.params.id, true);
      const e = ENCARGOS.get(req.params.id);
      // Una lectura que salió antes del final y llega después (AUR04): el final ya decidido manda; un estado vivo
      // viejo no reabre «hecha» como «pausada», ni mueve el plan, ni vuelve a mostrar la pregunta.
      const crudo: Tarea =
        e?.terminada && !TERMINADA.has(leida.estado)
          ? { ...leida, estado: e.terminada.estado, respuesta: e.terminada.respuesta ?? leida.respuesta, error: e.terminada.error ?? leida.error, pregunta: null, pregunta_id: null, propuesta: null }
          : leida;
      // La misión como se pidió (al nodo le pudo ir con «sigue desde donde quedó…» o con «dime qué hay»).
      const t = tareaParaApp({ ...crudo, instruccion: misionDe(req.params.id) || crudo.instruccion }, paso);
      if (e && !e.cerrada && !TERMINADA.has(crudo.estado)) moverPlan(e, crudo);
      const version = versionDeEstado();
      return res.json({
        tarea: { ...t, pasos: t.pasos.map((p) => ({ ...p, texto: pasoEnPalabras(p, idioma) })) },
        mision: m ? vistaMision(m, crudo.estado, crudo.pregunta, crudo.pregunta_id, version, crudo.propuesta) : null,
        version,
        honesto: true,
      });
    } catch (e: any) {
      // El nodo ya la olvidó (pasó una hora) o no contesta: si la misión terminó, su tarjeta sigue aquí.
      if (m?.final) {
        const version = versionDeEstado();
        return res.json({
          tarea: { id: req.params.id, motor: m.motor, instruccion: m.instruccion, estado: m.final.estado, pasos: [], respuesta: m.final.respuesta, error: m.final.error, segundos: m.final.segundos },
          mision: vistaMision(m, null, null, null, version),
          version,
          honesto: true,
        });
      }
      return res.status(502).json({ error: `La computadora no contestó (${String(e?.message || e).slice(0, 80)}).`, mision: m ? vistaMision(m) : null, honesto: true });
    }
  });

  app.post('/api/computadora/tareas/:id/parar', d.exigirMesa, d.limitar(20), sobreTarea('No pude pararla', null, (id) => pararTarea(id)));
  app.post('/api/computadora/tareas/:id/pausar', d.exigirMesa, d.limitar(20), sobreTarea('No pude pausarla', 'pausar', (id) => pausarTarea(id)));
  app.post('/api/computadora/tareas/:id/reanudar', d.exigirMesa, d.limitar(20), sobreTarea('No pude seguir', 'pausar', (id) => reanudarTarea(id)));
  app.post(
    '/api/computadora/tareas/:id/confirmar',
    d.exigirMesa,
    d.limitar(20),
    sobreTarea('No le llegó tu respuesta', 'confirmar', async (id, req) => {
      if (typeof req.body?.si !== 'boolean') throw Object.assign(new Error('Di sí o no.'), { codigo: 400 });
      // El sí va atado a la pregunta que vio en la pantalla (`preguntaId`) y a la propuesta que mostraba (`propuesta`,
      // su huella). Revisión 4-oct: un «sí» que no dice a qué pregunta contesta ya no aprueba «la que haya ahora» (podía
      // ser otra, para otra persona). Un «no» no autoriza nada: vale con la pregunta que el servidor conoce.
      const pedida: string | null = typeof req.body?.preguntaId === 'string' && req.body.preguntaId ? String(req.body.preguntaId).slice(0, 64) : null;
      const propuestaPedida: string | null = typeof req.body?.propuesta === 'string' && req.body.propuesta ? String(req.body.propuesta).slice(0, 128) : null;
      if (req.body.si && !pedida) throw new ErrorNodo('ese sí no dice a qué pregunta contesta; mira la de ahora y vuelve a tocar «Sí»', 409);
      // Permisos exactos (4-oct): un «sí» que no nombra la propuesta que mostraba la tarjeta tampoco vale. Antes se tomaba
      // la que este servidor tenía guardada, que pudo cambiar (otro destino, otro contenido bajo el mismo id) después de
      // que la tarjeta se pintó. La app actual siempre la manda cuando el nodo la da; sin ella el nodo tampoco aceptaría.
      if (req.body.si && !propuestaPedida) throw new ErrorNodo('ese sí no dice qué propuesta exacta aprueba; mira la de ahora y vuelve a tocar «Sí»', 409);
      // AUR02: el servidor revisa que ese id sea la pregunta de ESTA tarea (la que mostró, o la que el nodo tiene
      // ahora para ella), aunque el nodo no lo revisara: un id de otra tarea u otra propuesta no aprueba nada.
      const p = await preguntaDeTarea(id, pedida, propuestaPedida);
      if (!p) throw new ErrorNodo('esa respuesta no es para la pregunta de esta tarea; mira la de ahora', 409);
      await confirmarAtado(id, req.body.si, p);
      alResponder(id, p.id);
      return { si: req.body.si };
    })
  );
  /** El id que da el visor (AUR09) para ligar su control; la app de antes no lo manda. */
  const idVisor = (v: unknown): string | null => (typeof v === 'string' && /^[A-Za-z0-9_-]{8,64}$/.test(v) ? v : null);
  /** El cliente que ve el nodo: el id del visor ligado a ESTA sesión (clienteDeSesion). */
  const clienteVisor = (req: Req, clientId: string | null): string | null => {
    const s = d.sesionDe(req);
    return s && clientId ? clienteDeSesion(String(s.correo).toLowerCase(), s.token, clientId) : null;
  };
  app.post(
    '/api/computadora/tareas/:id/control',
    d.exigirMesa,
    d.limitar(20),
    sobreTarea('No pude cambiar el control', 'control', (id, req) => {
      const esperada = req.body?.expectedControlEpoch;
      return controlTarea(id, !!req.body?.tomar, { cliente: clienteVisor(req, idVisor(req.body?.clientId)), epocaEsperada: Number.isInteger(esperada) ? esperada : null });
    })
  );
  /**
   * Lo que el servidor recuerda de las entradas de cada control (por tarea): el cliente, la época, la última secuencia
   * que dejó pasar y los ACK recientes. Un repetido devuelve el mismo ACK sin llegar al nodo y una secuencia vieja no
   * pasa: tras reconectar nada se reproduce. El nodo vuelve a revisar todo (es el árbitro); esto ahorra el viaje.
   */
  const libros = new Map<string, { cliente: string; epoca: number; ultima: number; acks: Map<number, AckEntrada> }>();
  const LIBROS_MAX = 500;
  const rechazo = (res: Res, e: any) => {
    const st = e instanceof ErrorNodo ? e.status : undefined;
    const code = codigoDe(String(e?.message || ''));
    const error = (code && MOTIVOS_ENTRADA[code]) || String(e?.message || 'La computadora no contestó.').slice(0, 160);
    if (st === 409 || st === 400 || st === 429) return res.status(st).json({ error, code, honesto: true });
    return res.status(502).json({ error: code === 'incierta' ? error : `La computadora no contestó (${String(e?.message || e).slice(0, 80)}).`, code: code ?? 'sin_respuesta', honesto: true });
  };
  app.post('/api/computadora/tareas/:id/entrada', d.exigirMesa, d.limitar(600), async (req, res) => {
    const correo = correoDe(req);
    if (!correo) return sinSesion(res);
    const id = req.params.id;
    if (duenoDe(id) !== correo) return noEsSuya(res);
    if (JSON.stringify(req.body ?? null).length > MAX_ENTRADA_BYTES) return res.status(413).json({ error: 'Esa entrada pesa demasiado.', code: 'entrada_invalida', honesto: true });
    const v = validarEntradaRemota(req.body, id);
    if (!v) return res.status(400).json({ error: MOTIVOS_ENTRADA.entrada_invalida, code: 'entrada_invalida', honesto: true });
    if (!(await exigirCapacidad(res, 'entrada'))) return;
    const cliente = clienteVisor(req, v.clientId)!;
    let libro = libros.get(id);
    if (!libro || libro.cliente !== cliente || libro.epoca !== v.controlEpoch) {
      libro = { cliente, epoca: v.controlEpoch, ultima: 0, acks: new Map() };
      libros.delete(id);
      libros.set(id, libro);
      while (libros.size > LIBROS_MAX) libros.delete(libros.keys().next().value!);
    }
    const previo = libro.acks.get(v.inputSequence);
    if (previo) return res.json({ ok: true, ack: { ...previo, duplicada: true }, honesto: true });
    if (v.inputSequence <= libro.ultima) return res.status(409).json({ error: MOTIVOS_ENTRADA.secuencia_vieja, code: 'secuencia_vieja', honesto: true });
    libro.ultima = v.inputSequence; // se gasta antes de mandarla: un repetido en camino no sale dos veces
    try {
      const ack = await entradaRemota(id, { ...v, clientId: cliente });
      libro.acks.set(v.inputSequence, ack);
      for (const k of [...libro.acks.keys()].slice(0, Math.max(0, libro.acks.size - 64))) libro.acks.delete(k);
      return res.json({ ok: true, ack, honesto: true });
    } catch (e: any) {
      // Nunca se registra el cuerpo (puede ser una contraseña en entrada segura): solo el código.
      return rechazo(res, e);
    }
  });
  app.post('/api/computadora/tareas/:id/seguro', d.exigirMesa, d.limitar(30), async (req, res) => {
    const correo = correoDe(req);
    if (!correo) return sinSesion(res);
    if (duenoDe(req.params.id) !== correo) return noEsSuya(res);
    if (typeof req.body?.activar !== 'boolean') return res.status(400).json({ error: 'Di si la activas o la terminas.', honesto: true });
    if (!(await exigirCapacidad(res, 'seguro'))) return;
    const frameSeq = Number.isInteger(req.body?.frameSeq) ? Number(req.body.frameSeq) : null;
    try {
      const r = await seguroTarea(req.params.id, req.body.activar, clienteVisor(req, idVisor(req.body?.clientId)), frameSeq);
      return res.json({ ok: true, ...r, honesto: true });
    } catch (e: any) {
      return rechazo(res, e);
    }
  });
  app.post(
    '/api/computadora/tareas/:id/accion',
    d.exigirMesa,
    d.limitar(120),
    sobreTarea('No se hizo', 'control', async (id, req) => {
      const a = validarAccionPersona(req.body);
      if (!a) throw Object.assign(new Error('Esa acción no la entiendo.'), { codigo: 400 });
      await accionPersona(id, a);
    })
  );
  /**
   * La pantalla de ahora, con su frame y su edad al salir del servidor (`edadMs`: la app le suma lo que tardó en llegar;
   * no depende de la hora del teléfono). El servidor no la guarda: pasa tal cual (en entrada segura viene `privado`).
   * 240 por minuto: el visor la pide cada ~0,7 s con el control (mientras AURA controla, cada 2 s).
   */
  app.get(
    '/api/computadora/tareas/:id/pantalla',
    d.exigirMesa,
    d.limitar(240),
    sobreTarea('No pude ver la pantalla', 'control', async (id, req) => {
      const ancho = Number(req.query.ancho);
      const { jpeg, frame } = await pantallaDeTarea(id, Number.isInteger(ancho) ? ancho : undefined);
      return { imagen: jpeg.toString('base64'), frame: frame ? { ...frame, edadMs: Math.max(0, Date.now() - frame.ts) } : null };
    })
  );

  app.get('/api/computadora/misiones/:id', d.exigirMesa, d.limitar(60), async (req, res) => {
    const correo = correoDe(req);
    if (!correo) return sinSesion(res);
    const m = MISIONES.get(req.params.id);
    if (!m || m.quien !== correo) return noEsSuya(res);
    res.setHeader('Cache-Control', 'no-store');
    const version = versionDeEstado();
    return res.json({ mision: vistaMision(m, null, null, null, version), version, honesto: true });
  });

  app.post('/api/computadora/misiones/:id/seguir', d.exigirMesa, d.limitar(8), async (req, res) => {
    const correo = correoDe(req);
    if (!correo) return sinSesion(res);
    const m = MISIONES.get(req.params.id);
    if (!m || m.quien !== correo) return noEsSuya(res);
    if (!m.final || m.final.ok) return res.status(409).json({ error: 'Esa misión no quedó a medias.', honesto: true });
    if (m.rondas >= MAX_RONDAS) return res.status(409).json({ error: 'Ya la seguí varias veces; mejor pídemela de nuevo con más detalle.', honesto: true });
    const e = await seguirMision(m, true);
    if (!e) return res.status(502).json({ error: 'La computadora no contestó; prueba en un momento.', honesto: true });
    return res.json({ id: e.id, honesto: true });
  });
}
