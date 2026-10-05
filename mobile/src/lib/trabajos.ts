/**
 * EL PANEL DE TAREAS, SIN PANTALLA (AUR08, sección 6 del documento maestro). Lo que comparten el teléfono
 * (mobile/src/trabajos/) y la web (src/13-trabajo/Trabajos.tsx la importa tal cual): el contrato del
 * servidor (server/trabajos.ts, GET /api/trabajos), un reductor que reconcilia lo que llega, el indicador
 * mínimo, las reglas de la tarjeta de decisión y un cliente HTTP que no sabe de qué transporte se trata.
 *
 * Reglas:
 *  · El backend es la fuente de verdad. El cliente no inventa tareas ni estados: una versión vieja que llega
 *    tarde no pisa una nueva; un terminal no vuelve atrás; un fallo de red no borra lo que había.
 *  · El indicador dice «Trabajando · 2» o «Necesito una decisión · 1», no parpadea en cada sondeo y no gira
 *    con «reducir movimiento» ni en un estado terminal o de espera.
 *  · Progreso solo con denominador real («3 de 5 pasos»), nunca un porcentaje.
 *  · La opción con efecto nunca está preseleccionada, nunca es la principal, no se arma hasta ARMADO_MS
 *    después de aparecer la tarjeta, no se activa con Enter ni justo después de escribir otra cosa.
 *
 * Puro: sin React ni React Native (lo prueban tests/trabajos-cliente.test.ts en Node).
 */

/* ------------------------------------------------------------------ el contrato (copia del servidor) */

export type EstadoTarea =
  | 'created'
  | 'planning'
  | 'queued'
  | 'waiting_resource'
  | 'awaiting_approval'
  | 'running'
  | 'pausing'
  | 'paused'
  | 'takeover_requested'
  | 'human_control'
  | 'reconciling'
  | 'verifying'
  | 'completed'
  /** Ronda 7: solo respondió (una consulta, un texto en el chat). Terminal y SIN comprobar; nunca «completada». */
  | 'respondida'
  | 'partial'
  | 'failed'
  | 'blocked'
  | 'cancelling'
  | 'cancelled';

export type OpcionVista = { id: string; label: string; effect: string; risk: 'efecto' | 'sin-efecto' };
export type DecisionVista = {
  id: string;
  kind: string;
  question: string;
  why: string;
  proposal: { action: string; account?: string; recipient?: string; data: string[]; amount?: string; recurrence?: string; scope: string };
  options: OpcionVista[];
  createdAt: string;
  expiresAt?: string;
  expired: boolean;
  postponed: boolean;
  postponedUntil?: string;
};
export type EvidenciaVista = { id: string; tipo: string; etiqueta: string; ref?: string };
export type ResultadoVista = { id: string; summary: string; evidence: EvidenciaVista[]; partial: string[]; pending: string[]; at: string };

export type TareaVista = {
  id: string;
  version: number;
  state: EstadoTarea;
  /** Un servidor que habla con una app de antes manda `respondida` como `partial` y el estado de verdad aquí. */
  estadoReal?: EstadoTarea;
  terminal: boolean;
  source: 'durable' | 'tarea-en-curso' | 'computadora';
  title: string;
  objective: string;
  acceptance: { id: string; text: string; required: boolean; status: string; evidenceIds: string[] }[];
  environment: { kind: string; id: string; displayName: string };
  currentStep?: string;
  progress?: { done: number; total: number; unit: string } | null;
  decisionId?: string;
  decision?: DecisionVista | null;
  result?: ResultadoVista | null;
  lastHeartbeatAt?: string;
  /** La tarea en curso que espera que la persona siga (servidor: `awaiting_approval` sin decisión). Ver `esperaQueSigas`. */
  awaitingInput?: boolean;
  nextCheckAt?: string;
  stopCondition?: string;
  createdAt?: string;
  updatedAt: string;
  controls: { pause: boolean; resume: boolean; cancel: boolean; open?: 'computadora' };
  /**
   * Solo del cliente (revisión 9, MEDIO-1): la última lista del servidor vino PARCIAL (`completo: false`) y esta tarea no
   * estaba en ella. Se queda a la vista con lo último que se supo, marcada «sin confirmar»: no se pudo leer, no es que
   * ya no exista. La siguiente lista completa (o la tarea leída por su id) la confirma o la quita.
   */
  sinConfirmar?: boolean;
};

/** Lo que enlaza la respuesta del chat (`tareas` en el `done` o en el JSON del turno). */
export type RefTarea = { id: string; title: string; state: EstadoTarea; version: number; updatedAt: string };

const TERMINALES = new Set<EstadoTarea>(['completed', 'respondida', 'partial', 'failed', 'cancelled']);

/** Esta app conoce el estado `respondida` (ronda 7): se lo dice al servidor en cada petición de tareas. */
const CON_ESTADOS = 'estados=respondida';
const conEstados = (ruta: string) => `${ruta}${ruta.includes('?') ? '&' : '?'}${CON_ESTADOS}`;

/* ------------------------------------------------------------------ el reductor */

export type EstadoTrabajos = {
  porId: Record<string, TareaVista>;
  orden: string[];
  cargado: boolean;
  error: string | null;
  actualizado: number;
  /** El aviso de la última lista PARCIAL («No pude leer una de tus tareas…»); null si vino completa. */
  aviso?: string | null;
};

export type AccionTrabajos =
  /** `completo: false` (lo dice el servidor o el cliente no pudo traer todas las páginas): la lista no es «eso es todo». */
  | { tipo: 'lista'; tareas: TareaVista[]; en: number; completo?: boolean; aviso?: string }
  | { tipo: 'una'; tarea: TareaVista; en: number }
  | { tipo: 'quitar'; id: string }
  | { tipo: 'error'; mensaje: string; en: number }
  | { tipo: 'sin-sesion' };

export const estadoInicial = (): EstadoTrabajos => ({ porId: {}, orden: [], cargado: false, error: null, actualizado: 0, aviso: null });

/** Lo que se dice cuando la lista vino parcial y el servidor no explicó por qué. */
export const AVISO_LISTA_PARCIAL = 'No pude leer todas tus tareas en este momento; las que no pude confirmar siguen a la vista con lo último que supe.';

/** La tarea sin la marca «sin confirmar» (el servidor acaba de darla). */
function confirmada(t: TareaVista): TareaVista {
  if (!t.sinConfirmar) return t;
  const { sinConfirmar: _fuera, ...resto } = t;
  return resto;
}

/** ¿`nueva` puede reemplazar a `vieja`? Nunca hacia atrás en versión; nunca de terminal a vivo. */
function gana(vieja: TareaVista | undefined, nueva: TareaVista): boolean {
  if (!vieja) return true;
  if (vieja.terminal && !nueva.terminal) return false;
  return nueva.version >= vieja.version;
}

function ordenar(porId: Record<string, TareaVista>): string[] {
  return Object.values(porId)
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
    .map((t) => t.id);
}

export function reducir(s: EstadoTrabajos, a: AccionTrabajos): EstadoTrabajos {
  switch (a.tipo) {
    case 'lista': {
      // La lista COMPLETA manda en QUÉ tareas hay; cada una, con su versión, en CÓMO están.
      const porId: Record<string, TareaVista> = {};
      for (const t of a.tareas) {
        if (!t || typeof t.id !== 'string' || !t.id) continue;
        const vieja = s.porId[t.id];
        porId[t.id] = gana(vieja, t) ? confirmada(t) : confirmada(vieja);
      }
      // Una lista PARCIAL no dice qué tareas hay (revisión 9, MEDIO-1): las que ya se conocían y no vinieron se quedan
      // con lo último que se supo, marcadas «sin confirmar». Nunca desaparecen en silencio.
      const parcial = a.completo === false;
      if (parcial) {
        for (const id of Object.keys(s.porId)) {
          if (porId[id]) continue;
          const vieja = s.porId[id];
          porId[id] = vieja.sinConfirmar ? vieja : { ...vieja, sinConfirmar: true };
        }
      }
      const aviso = parcial ? (typeof a.aviso === 'string' && a.aviso.trim() ? a.aviso.trim() : AVISO_LISTA_PARCIAL) : null;
      return { porId, orden: ordenar(porId), cargado: true, error: null, actualizado: a.en, aviso };
    }
    case 'una': {
      const vieja = s.porId[a.tarea.id];
      if (!gana(vieja, a.tarea)) return s;
      const porId = { ...s.porId, [a.tarea.id]: confirmada(a.tarea) };
      return { ...s, porId, orden: ordenar(porId), actualizado: a.en };
    }
    case 'quitar': {
      if (!s.porId[a.id]) return s;
      const porId = { ...s.porId };
      delete porId[a.id];
      return { ...s, porId, orden: ordenar(porId) };
    }
    case 'error':
      // Sin red no es «no hay tareas»: lo que había se queda a la vista.
      return { ...s, error: a.mensaje };
    case 'sin-sesion':
      return estadoInicial();
  }
}

export const lista = (s: EstadoTrabajos): TareaVista[] => s.orden.map((id) => s.porId[id]).filter(Boolean);

/* ------------------------------------------------------------------ grupos, resumen e indicador */

const pospuesta = (t: TareaVista, ahora: number) => !!t.decision?.postponed && (!t.decision.postponedUntil || Date.parse(t.decision.postponedUntil) > ahora);
/** Espera a la persona: una decisión vigente (no pospuesta) o una tarea bloqueada. */
export const esperaDecision = (t: TareaVista, ahora = Date.now()) => !t.terminal && (t.state === 'blocked' || (t.state === 'awaiting_approval' && !!t.decision && !pospuesta(t, ahora)));

/**
 * La tarea en curso de la conversación que ESPERA QUE SIGAS (José, 5-oct): avanza solo cuando la persona habla («sigue»,
 * «el siguiente»), así que no es trabajo de fondo ni una decisión. Nada de «Trabajando», spinner ni «última señal»: se
 * pinta aparte, «Espera que sigas». El servidor la manda en `awaiting_approval` sin decisión con `awaitingInput`; un
 * servidor de antes la mandaba en `running`: también lo es (una tarea en curso nunca trabaja por detrás).
 */
export const esperaQueSigas = (t: Pick<TareaVista, 'terminal' | 'state' | 'decision' | 'source' | 'awaitingInput'>) =>
  !t.terminal && !t.decision && (t.state === 'awaiting_approval' ? t.awaitingInput === true || t.source === 'tarea-en-curso' : t.state === 'running' && t.source === 'tarea-en-curso');

/**
 * Igual que el servidor (lib/tareas-durables.ts `resumenTareas`). Una tarea `sinConfirmar` (la última lista vino
 * parcial y no estaba en ella) NO cuenta como «trabajando» (revisión 10, MENOR-F): no se sabe si sigue viva, y contarla
 * dejaba el indicador girando mientras la lista seguía incompleta. Se sigue viendo en el panel, marcada «sin confirmar».
 */
export function resumen(xs: TareaVista[], ahora = Date.now()): { trabajando: number; decisiones: number; esperan: number } {
  let trabajando = 0;
  let decisiones = 0;
  let esperan = 0;
  for (const t of xs) {
    if (t.terminal || t.state === 'paused') continue;
    if (esperaDecision(t, ahora)) decisiones++;
    else if (esperaQueSigas(t)) esperan++;
    else if (t.state !== 'awaiting_approval' && !t.sinConfirmar) trabajando++;
  }
  return { trabajando, decisiones, esperan };
}

/** Cuántas recientes (terminadas) se muestran. */
export const MAX_RECIENTES = 8;

/**
 * Los grupos del panel: las que necesitan tu decisión, las que esperan que sigas (la tarea en curso de la conversación),
 * las que están en marcha (trabajo de verdad, y las pausadas) y las recientes.
 */
export function grupos(xs: TareaVista[], ahora = Date.now()): { decisiones: TareaVista[]; esperan: TareaVista[]; activas: TareaVista[]; recientes: TareaVista[] } {
  const decisiones: TareaVista[] = [];
  const esperan: TareaVista[] = [];
  const activas: TareaVista[] = [];
  const recientes: TareaVista[] = [];
  for (const t of xs) {
    if (t.terminal || TERMINALES.has(t.state)) recientes.push(t);
    else if (esperaDecision(t, ahora)) decisiones.push(t);
    else if (esperaQueSigas(t)) esperan.push(t);
    else activas.push(t);
  }
  recientes.sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
  return { decisiones, esperan, activas, recientes: recientes.slice(0, MAX_RECIENTES) };
}

/** «Necesito una decisión · 1» antes que «Trabajando · 2»; nada activo → null (no se muestra). */
export function textoIndicador(r: { trabajando: number; decisiones: number; esperan?: number }, idioma: 'es' | 'en' = 'es'): string | null {
  if (r.decisiones > 0) return idioma === 'en' ? `I need a decision · ${r.decisiones}` : `Necesito una decisión · ${r.decisiones}`;
  if (r.trabajando > 0) return idioma === 'en' ? `Working · ${r.trabajando}` : `Trabajando · ${r.trabajando}`;
  // La tarea en curso de la conversación: no trabaja por detrás, pero tiene que poder abrirse (pausarla, cancelarla).
  // Sin indicador no había cómo llegar al panel. Quieto: nada de «Trabajando» ni movimiento (movimientoIndicador).
  if (r.esperan && r.esperan > 0) return idioma === 'en' ? `Waiting for you · ${r.esperan}` : `Espera que sigas · ${r.esperan}`;
  return null;
}

/** Lo mínimo entre dos cambios del indicador (no parpadea con cada sondeo o evento). */
export const MINIMO_INDICADOR_MS = 2500;

export type Indicador = { texto: string | null; desde: number };

/**
 * El indicador que se ve: cambia como mucho cada MINIMO_INDICADOR_MS, salvo cuando aparece una decisión
 * nueva (esa no espera: es lo que la persona tiene que ver).
 */
export function indicadorEstable(prev: Indicador | null, nuevo: string | null, ahora: number): Indicador {
  if (!prev) return { texto: nuevo, desde: ahora };
  if (prev.texto === nuevo) return prev;
  const subeDecision = !!nuevo && /decisi[oó]n|decision/i.test(nuevo) && !(prev.texto && /decisi[oó]n|decision/i.test(prev.texto));
  if (subeDecision || ahora - prev.desde >= MINIMO_INDICADOR_MS) return { texto: nuevo, desde: ahora };
  return prev;
}

/** ¿El indicador se mueve? Solo trabajando, sin decisión pendiente y sin «reducir movimiento». */
export function movimientoIndicador(r: { trabajando: number; decisiones: number }, reducirMovimiento: boolean): boolean {
  return !reducirMovimiento && r.trabajando > 0 && r.decisiones === 0;
}

/** ¿Este estado lleva algo que gira? Nunca un terminal ni una espera (una espera infinita no se disfraza). */
export function gira(s: EstadoTarea): boolean {
  return s === 'running' || s === 'verifying' || s === 'queued' || s === 'planning' || s === 'created' || s === 'pausing' || s === 'cancelling';
}

const ETIQUETAS: Record<EstadoTarea, [string, string]> = {
  created: ['Preparando', 'Getting ready'],
  planning: ['Planeando', 'Planning'],
  queued: ['En cola', 'Queued'],
  waiting_resource: ['Esperando un recurso', 'Waiting for a resource'],
  awaiting_approval: ['Espera tu decisión', 'Needs your decision'],
  running: ['Trabajando', 'Working'],
  pausing: ['Pausando…', 'Pausing…'],
  paused: ['En pausa', 'Paused'],
  takeover_requested: ['Pidiendo el control', 'Requesting control'],
  human_control: ['Tienes el control', 'You have control'],
  reconciling: ['Sin confirmar · lo reviso', 'Unconfirmed · checking'],
  verifying: ['Verificando', 'Verifying'],
  completed: ['Completada', 'Completed'],
  respondida: ['Respondida · sin comprobar', 'Answered · not verified'],
  partial: ['Parcial', 'Partial'],
  failed: ['No se pudo', 'Failed'],
  blocked: ['Bloqueada', 'Blocked'],
  cancelling: ['Cancelando…', 'Cancelling…'],
  cancelled: ['Cancelada', 'Cancelled'],
};

export function etiquetaEstado(s: EstadoTarea, idioma: 'es' | 'en' = 'es'): string {
  const e = ETIQUETAS[s] || ETIQUETAS.reconciling;
  return idioma === 'en' ? e[1] : e[0];
}

/** La etiqueta de UNA tarea: «Espera que sigas» si espera a la persona (no «Trabajando» ni «Espera tu decisión»). */
export function etiquetaTarea(t: Pick<TareaVista, 'terminal' | 'state' | 'decision' | 'source' | 'awaitingInput'>, idioma: 'es' | 'en' = 'es'): string {
  if (esperaQueSigas(t)) return idioma === 'en' ? 'Waiting for you' : 'Espera que sigas';
  return etiquetaEstado(t.state, idioma);
}

/** ¿Esta tarea lleva algo que gira? Como `gira`, pero nunca la que espera que sigas (esperarte no es trabajar). */
export const giraTarea = (t: Pick<TareaVista, 'terminal' | 'state' | 'decision' | 'source' | 'awaitingInput'>) => gira(t.state) && !esperaQueSigas(t);

/** «3 de 5 páginas comprobadas». Sin denominador real, null (no se inventa un avance). */
export function textoProgreso(p: TareaVista['progress'], idioma: 'es' | 'en' = 'es'): string | null {
  if (!p || !(p.total > 0) || !(p.done >= 0)) return null;
  return idioma === 'en' ? `${Math.min(p.done, p.total)} of ${p.total} ${p.unit}` : `${Math.min(p.done, p.total)} de ${p.total} ${p.unit}`;
}

/**
 * Lo pedido, uno por uno: «✓ informe.docx», «✗ presupuesto.xlsx», «? carta.pdf». Solo cuando hay más de un criterio
 * (con uno solo, el resultado ya lo dice). La marca es su estado de verdad: verificado solo con su evidencia.
 */
export function criteriosEnPalabras(acc: TareaVista['acceptance'] | undefined): { id: string; texto: string; estado: string }[] {
  if (!acc || acc.length < 2) return [];
  const marca = (s: string) => (s === 'verified' ? '✓' : s === 'not_met' ? '✗' : s === 'unknown' ? '?' : '·');
  return acc.map((c) => ({ id: c.id, estado: c.status, texto: `${marca(c.status)} ${String(c.text).split(/:\s/)[0].slice(0, 120)}` }));
}

/**
 * «hace 2 min» para la «última señal» de una tarea; '' si espera que sigas (no hay nada trabajando por detrás que dé
 * señales: decir «última señal hace 2 min» sugería que algo corría).
 */
export function ultimaSenal(t: Pick<TareaVista, 'terminal' | 'state' | 'decision' | 'source' | 'awaitingInput' | 'lastHeartbeatAt' | 'updatedAt'>, ahora = Date.now(), idioma: 'es' | 'en' = 'es'): string {
  if (esperaQueSigas(t)) return '';
  return haceCuanto(t.lastHeartbeatAt || t.updatedAt, ahora, idioma);
}

/** «hace 2 min», para «última señal». */
export function haceCuanto(iso: string | undefined, ahora = Date.now(), idioma: 'es' | 'en' = 'es'): string {
  const t = iso ? Date.parse(iso) : NaN;
  if (!Number.isFinite(t)) return '';
  const s = Math.max(0, Math.round((ahora - t) / 1000));
  const en = idioma === 'en';
  if (s < 45) return en ? 'just now' : 'hace un momento';
  const m = Math.round(s / 60);
  if (m < 60) return en ? `${m} min ago` : `hace ${m} min`;
  const h = Math.round(m / 60);
  if (h < 36) return en ? `${h} h ago` : `hace ${h} h`;
  const d = Math.round(h / 24);
  return en ? `${d} d ago` : `hace ${d} d`;
}

/* ------------------------------------------------------------------ la tarjeta de decisión */

/** Cuánto espera la opción con efecto antes de poder activarse, desde que aparece la tarjeta. */
export const ARMADO_MS = 1500;
/** Si escribió algo hace menos que esto, la opción con efecto no se activa (iba a otra cosa). */
export const ESCRIBIENDO_MS = 1200;

export type OpcionTarjeta = { id: string; label: string; effect: string; conEfecto: boolean; principal: boolean; preseleccionada: false };

/**
 * Las opciones como se pintan: las sin efecto primero (en su orden), la de efecto al final; ninguna
 * preseleccionada; la principal (el estilo destacado) nunca es la de efecto.
 */
export function opcionesTarjeta(d: Pick<DecisionVista, 'options'>): OpcionTarjeta[] {
  const sin = d.options.filter((o) => o.risk !== 'efecto');
  const con = d.options.filter((o) => o.risk === 'efecto');
  return [...sin, ...con].map((o) => ({ id: o.id, label: o.label, effect: o.effect, conEfecto: o.risk === 'efecto', principal: false, preseleccionada: false as const }));
}

/**
 * ¿Se puede activar esta opción ahora? La de efecto: no por Enter, no antes de ARMADO_MS desde que apareció
 * la tarjeta y no si escribió algo hace un instante (la tarjeta apareció mientras escribía otra cosa).
 */
export function puedeActivar(op: Pick<OpcionTarjeta, 'conEfecto'>, o: { aparecio: number; ahora: number; via: 'toque' | 'enter' | 'teclado'; escribioHace?: number }): boolean {
  if (!op.conEfecto) return true;
  if (o.via === 'enter') return false;
  if (o.ahora - o.aparecio < ARMADO_MS) return false;
  if (o.escribioHace !== undefined && o.escribioHace < ESCRIBIENDO_MS) return false;
  return true;
}

const GENERICA = /^(s[ií]|ok|okay|vale|aprobar|aceptar|confirmar|yes|approve|confirm)$/i;

/** Con varias tareas, un botón genérico («Sí», «Aprobar») nombra la tarea a la que contesta. */
export function etiquetaBoton(op: Pick<OpcionVista, 'id' | 'label'>, t: Pick<TareaVista, 'title'>, variasTareas: boolean): string {
  const l = String(op.label || '').trim();
  if (variasTareas && GENERICA.test(l)) return `${l}: ${t.title}`;
  return l;
}

/** El error recuperable de cada código 409/400 del servidor: qué pasó y que no se ejecutó nada. */
export function mensajeDeError(codigo: string | undefined, idioma: 'es' | 'en' = 'es'): string {
  const es: Record<string, string> = {
    'decision-vieja': 'Esa propuesta ya cambió. No ejecuté nada: mira la nueva antes de decidir.',
    version: 'La tarea cambió mientras decidías. No ejecuté nada: mira cómo quedó.',
    caducada: 'La propuesta caducó y no la ejecuté. Pide una nueva si aún la quieres.',
    'propuesta-cambiada': 'Lo que espera ya no es lo que aprobaste. No envié nada.',
    'ya-decidida': 'Esa decisión ya se tomó. No hice nada nuevo.',
    'sin-decision': 'Esta tarea ya no espera ninguna decisión.',
    terminal: 'La tarea ya terminó; no hay nada que decidir.',
    opcion: 'Esa opción no se ofreció. No hice nada.',
    'no-pausable': 'Ahora espera tu decisión; no hay trabajo que pausar.',
    'abrir-computadora': 'Eso se hace en la vista de tu computadora.',
    red: 'No pude hablar con el servidor. No sé si llegó: vuelve a mirar antes de repetir.',
  };
  const en: Record<string, string> = {
    'decision-vieja': 'That proposal changed. Nothing was done: check the new one first.',
    version: 'The task changed while you decided. Nothing was done.',
    caducada: 'The proposal expired and was not executed.',
    'propuesta-cambiada': 'What is waiting is no longer what you approved. Nothing was sent.',
    'ya-decidida': 'That decision was already made. Nothing new was done.',
    'sin-decision': 'This task no longer needs a decision.',
    terminal: 'The task already finished.',
    opcion: 'That option was not offered. Nothing was done.',
    'no-pausable': 'It is waiting for your decision; nothing to pause.',
    'abrir-computadora': 'That is done from your computer view.',
    red: 'Could not reach the server. Check again before retrying.',
  };
  const m = (idioma === 'en' ? en : es)[String(codigo || '')];
  return m || (idioma === 'en' ? 'It could not be done. Nothing was executed.' : 'No se pudo. No ejecuté nada.');
}

/* ------------------------------------------------------------------ cada cuánto se pregunta */

/** Cada cuánto se sondea: rápido con trabajo vivo, despacio sin nada, y nunca con la app en segundo plano. */
export function sondeoTrabajosMs(r: { trabajando: number; decisiones: number }, panelAbierto: boolean): number {
  if (r.trabajando > 0) return panelAbierto ? 3000 : 6000;
  if (r.decisiones > 0) return panelAbierto ? 5000 : 15_000;
  return panelAbierto ? 8000 : 30_000;
}

/* ------------------------------------------------------------------ el cliente HTTP */

export type Pedir = (ruta: string, init?: { method?: string; body?: string }) => Promise<{ status: number; json: any }>;

/** Leer una tarea por su id: no es lo mismo «no existe» (404) que «no pude leerla» (503, red, respuesta rara). */
export type LecturaTareaVista = { estado: 'ok'; tarea: TareaVista } | { estado: 'no-existe' } | { estado: 'error'; status?: number; sinSesion?: boolean };

export type ResultadoAccion = { ok: true; tarea: TareaVista | null; sugerencia?: string; repetida?: boolean } | { ok: false; codigo: string; mensaje: string; tarea?: TareaVista | null };

const enc = encodeURIComponent;

/** Cuántas páginas de GET /api/trabajos se siguen en un sondeo (un servidor que pagina por su cuenta). */
export const MAX_PAGINAS_TRABAJOS = 5;
const AVISO_PAGINA_NO_LEIDA = 'No pude traer todas tus tareas en este momento; las que no vinieron no es que no existan.';
const AVISO_MAS_PAGINAS = 'Tienes más tareas de las que pude traer ahora; las que no vinieron no es que no existan.';

/** Las llamadas del panel, sobre el transporte de cada cliente (la `api` del teléfono, `fetch` de la web). */
export function crearClienteTrabajos(pedir: Pedir) {
  const post = async (ruta: string, cuerpo: Record<string, unknown> = {}): Promise<ResultadoAccion> => {
    try {
      const r = await pedir(conEstados(ruta), { method: 'POST', body: JSON.stringify(cuerpo) });
      if (r.status >= 200 && r.status < 300) return { ok: true, tarea: r.json?.tarea ?? null, ...(r.json?.sugerencia ? { sugerencia: String(r.json.sugerencia) } : {}), ...(r.json?.repetida ? { repetida: true } : {}) };
      const codigo = String(r.json?.codigo || r.json?.code || r.status);
      return { ok: false, codigo, mensaje: mensajeDeError(codigo), tarea: r.json?.tarea ?? null };
    } catch {
      return { ok: false, codigo: 'red', mensaje: mensajeDeError('red') };
    }
  };
  return {
    /**
     * P5/A7: `completo: false` (con `aviso`) si el servidor no pudo leer alguna tarea: la lista que llega es parcial, no
     * «eso es todo». Un servidor de antes no lo manda (se toma como completa, como siempre).
     *
     * Revisión 9: si el servidor pagina (`siguiente`), se siguen las páginas hasta MAX_PAGINAS_TRABAJOS; si quedan más, o
     * una página no se pudo leer, la lista va como PARCIAL (con su aviso), nunca como «eso es todo».
     */
    async listar(): Promise<{ ok: true; tareas: TareaVista[]; completo: boolean; aviso?: string } | { ok: false; sinSesion: boolean; mensaje: string }> {
      let r: { status: number; json: any };
      try {
        r = await pedir(conEstados('/api/trabajos'), { method: 'GET' });
      } catch (e: any) {
        return { ok: false, sinSesion: false, mensaje: String(e?.message || e).slice(0, 120) };
      }
      // 401: sin sesión; 403: sesión sin correo (no hay de quién serían). Las dos: no hay tareas que mostrar.
      if (r.status === 401 || r.status === 403) return { ok: false, sinSesion: true, mensaje: 'sin sesión' };
      if (r.status !== 200 || !Array.isArray(r.json?.tareas)) return { ok: false, sinSesion: false, mensaje: String(r.json?.error || r.status) };
      const tareas: TareaVista[] = [];
      const vistas = new Set<string>();
      const avisos: string[] = [];
      let completo = true;
      const sumar = (j: any) => {
        for (const t of j.tareas as TareaVista[]) {
          if (!t || typeof t.id !== 'string' || vistas.has(t.id)) continue;
          vistas.add(t.id);
          tareas.push(t);
        }
        if (j.completo === false) completo = false;
        if (typeof j.aviso === 'string' && j.aviso && !avisos.includes(j.aviso)) avisos.push(j.aviso);
      };
      sumar(r.json);
      let siguiente: string | null = typeof r.json.siguiente === 'string' && r.json.siguiente ? r.json.siguiente : null;
      let paginas = 1;
      while (siguiente && paginas < MAX_PAGINAS_TRABAJOS) {
        paginas++;
        let p: { status: number; json: any } | null = null;
        try {
          p = await pedir(conEstados(`/api/trabajos?cursor=${enc(siguiente)}`), { method: 'GET' });
        } catch {
          p = null;
        }
        if (!p || p.status !== 200 || !Array.isArray(p.json?.tareas)) {
          completo = false;
          avisos.push(AVISO_PAGINA_NO_LEIDA);
          siguiente = null;
          break;
        }
        sumar(p.json);
        siguiente = typeof p.json.siguiente === 'string' && p.json.siguiente ? p.json.siguiente : null;
      }
      if (siguiente) {
        completo = false;
        avisos.push(AVISO_MAS_PAGINAS);
      }
      const aviso = avisos.join(' ');
      return { ok: true, tareas, completo, ...(aviso ? { aviso } : {}) };
    },
    /**
     * UNA tarea por su id, diciendo qué pasó (auditoría del 5-oct, R1): `ok` (y es ESA tarea), `no-existe` (404: no
     * está, o no es de esta cuenta) o `error` (503, red, sesión, una respuesta sin tarea o con otro id). Un error no
     * dice nada de la tarea: ni que terminó ni que no.
     */
    async leer(id: string): Promise<LecturaTareaVista> {
      let r: { status: number; json: any };
      try {
        r = await pedir(conEstados(`/api/trabajos/${enc(id)}`), { method: 'GET' });
      } catch {
        return { estado: 'error' };
      }
      if (r.status === 200) {
        const t = r.json?.tarea;
        return t && typeof t === 'object' && t.id === id ? { estado: 'ok', tarea: t as TareaVista } : { estado: 'error', status: r.status };
      }
      if (r.status === 404) return { estado: 'no-existe' };
      return { estado: 'error', status: r.status, ...(r.status === 401 || r.status === 403 ? { sinSesion: true } : {}) };
    },
    /** Lo de siempre: la tarea, o null si no se pudo (no distingue por qué; para eso, `leer`). */
    async ver(id: string): Promise<TareaVista | null> {
      try {
        const r = await pedir(conEstados(`/api/trabajos/${enc(id)}`), { method: 'GET' });
        return r.status === 200 ? (r.json?.tarea as TareaVista) : null;
      } catch {
        return null;
      }
    },
    /** La opción EXACTA que se tocó, ligada a la decisión y a la versión que se vio. */
    decidir: (t: Pick<TareaVista, 'id' | 'version' | 'decisionId' | 'decision'>, opcion: string, extra: { hasta?: string } = {}) =>
      post(`/api/trabajos/${enc(t.id)}/decisiones`, { decisionId: t.decisionId || t.decision?.id || '', expectedVersion: t.version, opcion, ...(extra.hasta ? { hasta: extra.hasta } : {}) }),
    pausar: (id: string) => post(`/api/trabajos/${enc(id)}/pausar`),
    reanudar: (id: string) => post(`/api/trabajos/${enc(id)}/reanudar`),
    cancelar: (id: string) => post(`/api/trabajos/${enc(id)}/cancelar`),
  };
}

export type ClienteTrabajos = ReturnType<typeof crearClienteTrabajos>;

/** Las tareas que enlaza una respuesta del chat. Un servidor viejo no manda nada: lista vacía. */
export function refsDeTurno(r: unknown): RefTarea[] {
  const xs = (r as { tareas?: unknown })?.tareas;
  if (!Array.isArray(xs)) return [];
  return xs
    .filter((x): x is RefTarea => !!x && typeof x === 'object' && typeof (x as RefTarea).id === 'string' && !!(x as RefTarea).id)
    .map((x) => ({ id: x.id, title: String(x.title || ''), state: x.state, version: Number(x.version) || 0, updatedAt: String(x.updatedAt || '') }))
    .slice(0, 5);
}
