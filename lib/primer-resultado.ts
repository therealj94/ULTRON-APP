/**
 * EL PRIMER RESULTADO, MEDIDO (auditoría externa del 4-oct, P4 · R1 y «Guion físico», paso 2).
 *
 * La primera vez del teléfono (mobile/src/primeravez/) ya recoge el objetivo y la restricción y deja la
 * primera petición escrita en la mesa. Eso es un borrador, no un resultado: aquí se registra, por cuenta,
 * qué pasó DESPUÉS, hasta que hay de verdad algo útil, y cuánto le costó a la persona llegar ahí.
 *
 *   eligiendo   → está en la primera vez (cuenta toques, saltos y si omitió conectar cuentas)
 *   preparada   → terminó con la petición escrita en la mesa (o `sin-peticion` si saltó el objetivo:
 *                 entonces su primera petición es lo primero que mande)
 *   enviada     → la mandó (con su idTurno: es lo que permite recuperarla al reabrir)
 *   en-tarea    → la respuesta abrió tareas durables que siguen: el resultado es el de esas tareas
 *   util        → una respuesta con contenido, o la tarea terminó (`verificado` solo con evidencia)
 *   parcial     → hubo resultado pero faltó algo, y se guarda QUÉ faltó (la fuente o la parte)
 *   fallida     → error, sin respuesta o la tarea falló: no es un resultado; lo siguiente que mande
 *                 cuenta como reintento
 * Petición precargada ≠ resultado. Un error, una respuesta vencida (de otra sesión) o «sigo con eso»
 * (el turno sigue en curso o se está reconciliando) tampoco lo son.
 *
 * Recuperar al reabrir: se reusa lo que ya existe, nada de un sistema de tareas paralelo. Con la petición
 * enviada y dentro de la vida del turno durable (server/turno-unico.ts, VIDA_DURABLE_MS), se vuelve a pedir
 * con EL MISMO idTurno: el servidor devuelve la misma respuesta sin correr otro turno. Más tarde, la
 * petición vuelve a la caja para que la persona decida. Las tareas durables se leen de /api/trabajos.
 *
 * Privacidad: la petición solo vive en el teléfono, en la clave de su cuenta (como el objetivo de la
 * primera vez). Las métricas (`metricas`, `lineaMetrica`) no llevan nada de lo pedido ni de lo contestado:
 * tiempos, conteos y estados.
 *
 * Puro: sin React ni React Native. La copia del teléfono es mobile/src/lib/primerResultado.ts (Metro no
 * importa fuera de mobile/); tests/primer-resultado.test.ts comprueba que las dos dicen lo mismo.
 */

export const VERSION_PRIMER = 1 as const;

/** La vida del registro durable de un turno en el servidor (server/turno-unico.ts VIDA_DURABLE_MS). */
export const VIDA_TURNO_MS = 30 * 60_000;

/** El objetivo inicial del documento maestro: valor útil en una sesión de unos cinco minutos (no una promesa). */
export const OBJETIVO_MS = 5 * 60_000;

export type EstadoPrimer = 'eligiendo' | 'preparada' | 'sin-peticion' | 'enviada' | 'en-tarea' | 'util' | 'parcial' | 'fallida';

const ESTADOS: readonly EstadoPrimer[] = ['eligiendo', 'preparada', 'sin-peticion', 'enviada', 'en-tarea', 'util', 'parcial', 'fallida'];

/** Conectar cuentas en la primera vez: no se ofreció, la pasó con «Siguiente» o la saltó. */
export type ConectarPrimer = 'no-ofrecida' | 'vista' | 'saltada';

export type EsfuerzoPrimer = { toques: number; saltos: number; atras: number; conectar: ConectarPrimer };

export type PrimerResultado = {
  v: typeof VERSION_PRIMER;
  /** El correo de la cuenta dueña, normalizado: otra cuenta no lo lee. */
  cuenta: string;
  estado: EstadoPrimer;
  /** Lo pedido (o la petición preparada). Solo en el teléfono, para recuperarlo; nunca en las métricas. */
  peticion: string;
  inicioMs: number;
  preparadaMs?: number;
  primerEnvioMs?: number;
  enviadaMs?: number;
  resultadoMs?: number;
  idTurno?: string;
  tareas?: string[];
  trazaId?: string;
  verificado?: boolean;
  /** Lo que faltó en un resultado parcial (la fuente o la parte), o por qué falló. */
  faltantes?: string[];
  motivo?: string;
  /** Envíos que no dieron resultado antes del bueno. */
  intentos: number;
  /** La persona cambió la petición preparada antes de mandarla. */
  editada?: boolean;
  esfuerzo: EsfuerzoPrimer;
  sirvio?: boolean;
  opinadoMs?: number;
};

const normal = (c: string | null | undefined) => String(c || '').trim().toLowerCase();

const unaLinea = (s: unknown, max: number) =>
  String(s ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max)
    .trim();

/** La clave del teléfono, una por cuenta. */
export function clavePrimer(correo: string): string {
  return `aura.primeravez.resultado.v1:${normal(correo)}`;
}

export function nuevoPrimer(cuenta: string, ahora: number): PrimerResultado {
  return { v: VERSION_PRIMER, cuenta: normal(cuenta), estado: 'eligiendo', peticion: '', inicioMs: ahora, intentos: 0, esfuerzo: { toques: 0, saltos: 0, atras: 0, conectar: 'no-ofrecida' } };
}

const num = (x: unknown): number | undefined => (typeof x === 'number' && Number.isFinite(x) && x >= 0 ? x : undefined);
const textos = (x: unknown, n: number, max: number): string[] | undefined => {
  if (!Array.isArray(x)) return undefined;
  const r = x.map((s) => unaLinea(s, max)).filter(Boolean).slice(0, n);
  return r.length ? r : undefined;
};

/**
 * Lo guardado → el registro, sano, SOLO si es de esta cuenta. Roto, de otra versión o de otra cuenta: null
 * (un teléfono compartido no pasa el primer resultado de A a B).
 */
export function leerPrimer(raw: string | null | undefined, cuenta: string): PrimerResultado | null {
  let j: any;
  try {
    j = JSON.parse(String(raw ?? 'null'));
  } catch {
    return null;
  }
  if (!j || typeof j !== 'object' || j.v !== VERSION_PRIMER) return null;
  const c = normal(cuenta);
  if (!c || normal(j.cuenta) !== c) return null;
  if (!ESTADOS.includes(j.estado)) return null;
  const inicioMs = num(j.inicioMs);
  if (inicioMs === undefined) return null;
  const e = j.esfuerzo && typeof j.esfuerzo === 'object' ? j.esfuerzo : {};
  const r: PrimerResultado = {
    v: VERSION_PRIMER,
    cuenta: c,
    estado: j.estado,
    peticion: unaLinea(j.peticion, 600),
    inicioMs,
    intentos: Math.floor(num(j.intentos) ?? 0),
    esfuerzo: {
      toques: Math.floor(num(e.toques) ?? 0),
      saltos: Math.floor(num(e.saltos) ?? 0),
      atras: Math.floor(num(e.atras) ?? 0),
      conectar: e.conectar === 'vista' || e.conectar === 'saltada' ? e.conectar : 'no-ofrecida',
    },
  };
  for (const k of ['preparadaMs', 'primerEnvioMs', 'enviadaMs', 'resultadoMs', 'opinadoMs'] as const) {
    const v = num(j[k]);
    if (v !== undefined) r[k] = v;
  }
  const id = unaLinea(j.idTurno, 80);
  if (id) r.idTurno = id;
  const traza = unaLinea(j.trazaId, 80);
  if (traza) r.trazaId = traza;
  const tareas = textos(j.tareas, 5, 80);
  if (tareas) r.tareas = tareas;
  const faltan = textos(j.faltantes, 5, 120);
  if (faltan) r.faltantes = faltan;
  const motivo = unaLinea(j.motivo, 120);
  if (motivo) r.motivo = motivo;
  if (typeof j.verificado === 'boolean') r.verificado = j.verificado;
  if (typeof j.editada === 'boolean') r.editada = j.editada;
  if (typeof j.sirvio === 'boolean') r.sirvio = j.sirvio;
  return r;
}

/* ── qué fue lo que volvió ───────────────────────────────────────────────────────────────── */

export type ClaseResultado =
  | { clase: 'ignorar' }
  | { clase: 'pendiente' }
  | { clase: 'util'; verificado: boolean }
  | { clase: 'parcial'; faltantes: string[]; verificado?: boolean }
  | { clase: 'fallida'; motivo: string }
  | { clase: 'en-tarea'; tareas: string[] };

/** Lo que importa de una tarea durable (TareaVista o RefTarea de lib/trabajos.ts). */
export type TareaPrimer = {
  id: string;
  title?: string;
  state?: string;
  estadoReal?: string;
  result?: { evidence?: readonly unknown[]; partial?: readonly string[] } | null;
};

/** Lo que importa de la respuesta de un turno (ChatResult de la mesa). */
export type TurnoPrimer = {
  reply?: string;
  error?: string;
  vencida?: boolean;
  parcial?: boolean;
  cierre?: string;
  motivo?: string;
  /** «Sigo con eso» (el mismo turno sigue en curso, 409) o «lo estoy reconciliando»: todavía no hay resultado. */
  pendiente?: boolean;
  tareas?: unknown;
};

const TERMINALES = new Set(['completed', 'respondida', 'partial', 'failed', 'cancelled']);

function refsDe(x: unknown): TareaPrimer[] {
  if (!Array.isArray(x)) return [];
  return x.filter((t): t is TareaPrimer => !!t && typeof t === 'object' && typeof (t as TareaPrimer).id === 'string' && !!(t as TareaPrimer).id).slice(0, 5);
}

/**
 * Las tareas del primer pedido → qué resultado dieron. Mientras alguna siga, `pendiente`. Terminadas:
 * completadas → útil (verificado solo si TODAS traen evidencia); `respondida` → útil sin comprobar; parcial →
 * lo que faltó; fallida o cancelada → falta esa tarea. Todas mal → fallida.
 */
export function clasificarTareas(tareas: readonly TareaPrimer[], ids?: readonly string[]): ClaseResultado {
  const xs = ids?.length ? tareas.filter((t) => ids.includes(t.id)) : [...tareas];
  if (!xs.length) return { clase: 'pendiente' };
  let ok = 0;
  let verificadas = 0;
  const faltantes: string[] = [];
  for (const t of xs) {
    const s = String(t.estadoReal || t.state || '');
    if (!TERMINALES.has(s)) return { clase: 'pendiente' };
    if (s === 'completed' || s === 'respondida') {
      ok++;
      if (s === 'completed' && (t.result?.evidence?.length ?? 0) > 0) verificadas++;
    } else if (s === 'partial') {
      const p = (t.result?.partial || []).map((x) => unaLinea(x, 120)).filter(Boolean);
      faltantes.push(...(p.length ? p : [unaLinea(t.title, 120) || 'una parte de la tarea']));
    } else faltantes.push(unaLinea(t.title, 120) || 'la tarea');
  }
  if (ok === xs.length) return { clase: 'util', verificado: verificadas === xs.length };
  const parciales = xs.some((t) => String(t.estadoReal || t.state) === 'partial');
  if (!ok && !parciales) return { clase: 'fallida', motivo: 'la tarea no terminó' };
  return { clase: 'parcial', faltantes: faltantes.slice(0, 5), verificado: false };
}

/**
 * La respuesta de un turno → qué fue. Solo cuenta como útil una respuesta CON contenido que no sea un error,
 * no venga cortada y no sea de otra sesión. Si abrió tareas que siguen, el resultado es el de las tareas.
 */
export function clasificarTurno(res: TurnoPrimer | null | undefined): ClaseResultado {
  if (!res || res.vencida) return { clase: 'ignorar' };
  if (res.pendiente) return { clase: 'pendiente' };
  const reply = String(res.reply || '').trim();
  if (!reply) return { clase: 'fallida', motivo: unaLinea(res.error, 120) || 'sin respuesta' };
  const refs = refsDe(res.tareas);
  if (refs.length) {
    const t = clasificarTareas(refs);
    if (t.clase === 'pendiente') return { clase: 'en-tarea', tareas: refs.map((x) => x.id) };
    return t;
  }
  if (res.parcial || res.error || (res.cierre && res.cierre !== 'done')) {
    return { clase: 'parcial', faltantes: [unaLinea(res.motivo || res.error, 120) || 'la respuesta se cortó'] };
  }
  return { clase: 'util', verificado: false };
}

/* ── la máquina de estados ───────────────────────────────────────────────────────────────── */

export type EventoPrimer =
  | { tipo: 'toque'; accion: 'seguir' | 'saltar' | 'atras'; paso?: string }
  | { tipo: 'preparar'; peticion: string }
  | { tipo: 'enviar'; idTurno: string; texto: string }
  | { tipo: 'turno'; idTurno?: string; resultado: ClaseResultado; trazaId?: string }
  | { tipo: 'tareas'; tareas: readonly TareaPrimer[] }
  | { tipo: 'opinar'; sirvio: boolean };

const TERMINAL: readonly EstadoPrimer[] = ['util', 'parcial'];

/** ¿Ya hubo primer resultado (útil o parcial)? Desde ahí solo cambia la opinión. */
export const hayResultado = (r: PrimerResultado | null | undefined) => !!r && TERMINAL.includes(r.estado);

function conResultado(r: PrimerResultado, c: ClaseResultado, ahora: number): PrimerResultado {
  const base: PrimerResultado = { ...r };
  delete base.faltantes;
  delete base.motivo;
  switch (c.clase) {
    case 'util':
      return { ...base, estado: 'util', resultadoMs: ahora, verificado: c.verificado };
    case 'parcial':
      return { ...base, estado: 'parcial', resultadoMs: ahora, verificado: !!c.verificado, faltantes: c.faltantes.map((x) => unaLinea(x, 120)).filter(Boolean).slice(0, 5) };
    case 'fallida':
      return { ...base, estado: 'fallida', motivo: unaLinea(c.motivo, 120) || 'sin respuesta' };
    case 'en-tarea':
      return { ...base, estado: 'en-tarea', tareas: c.tareas.slice(0, 5) };
    default:
      return r;
  }
}

/** Aplica un evento. Lo que no corresponde al estado actual no cambia nada (devuelve el mismo objeto). */
export function aplicar(r: PrimerResultado | null, ev: EventoPrimer, ahora: number): PrimerResultado | null {
  if (!r) return r;
  switch (ev.tipo) {
    case 'toque': {
      if (r.estado !== 'eligiendo') return r;
      const e = { ...r.esfuerzo, toques: r.esfuerzo.toques + 1 };
      if (ev.accion === 'saltar') e.saltos++;
      if (ev.accion === 'atras') e.atras++;
      if (ev.paso === 'conectar' && ev.accion !== 'atras') e.conectar = ev.accion === 'saltar' ? 'saltada' : 'vista';
      return { ...r, esfuerzo: e };
    }
    case 'preparar': {
      if (r.estado !== 'eligiendo') return r;
      const p = unaLinea(ev.peticion, 600);
      return { ...r, estado: p ? 'preparada' : 'sin-peticion', peticion: p, preparadaMs: ahora };
    }
    case 'enviar': {
      if (!['preparada', 'sin-peticion', 'enviada', 'fallida'].includes(r.estado)) return r;
      const id = unaLinea(ev.idTurno, 80);
      const texto = unaLinea(ev.texto, 600);
      if (!id || !texto) return r;
      // El mismo turno otra vez (recuperarlo al reabrir): no es otro intento.
      if (r.estado === 'enviada' && r.idTurno === id) return r;
      const reintento = r.estado === 'enviada' || r.estado === 'fallida';
      const n: PrimerResultado = { ...r, estado: 'enviada', idTurno: id, peticion: texto, enviadaMs: ahora, primerEnvioMs: r.primerEnvioMs ?? ahora, intentos: r.intentos + (reintento ? 1 : 0) };
      if (r.estado === 'preparada') n.editada = texto.toLowerCase() !== r.peticion.toLowerCase();
      delete n.motivo;
      return n;
    }
    case 'turno': {
      if (r.estado !== 'enviada') return r;
      if (ev.idTurno && r.idTurno && ev.idTurno !== r.idTurno) return r;
      const n = conResultado(r, ev.resultado, ahora);
      if (n === r) return r;
      const traza = unaLinea(ev.trazaId, 80);
      return traza ? { ...n, trazaId: traza } : n;
    }
    case 'tareas': {
      if (r.estado !== 'en-tarea' || !r.tareas?.length) return r;
      const c = clasificarTareas(ev.tareas, r.tareas);
      return c.clase === 'pendiente' ? r : conResultado(r, c, ahora);
    }
    case 'opinar': {
      if (!hayResultado(r) || r.sirvio !== undefined) return r;
      return { ...r, sirvio: !!ev.sirvio, opinadoMs: ahora };
    }
  }
}

/** ¿Se le pregunta «¿Te sirvió?»? Solo con resultado y una sola vez. */
export function debePreguntar(r: PrimerResultado | null | undefined): boolean {
  return hayResultado(r) && r!.sirvio === undefined;
}

/* ── recuperar al reabrir ────────────────────────────────────────────────────────────────── */

export type Recuperacion =
  | { accion: 'nada' }
  | { accion: 'rellenar'; texto: string }
  | { accion: 'reconsultar'; idTurno: string; texto: string }
  | { accion: 'esperar-tareas'; tareas: string[] };

/**
 * Al abrir la mesa: qué hacer con el primer pedido que quedó a medias. Preparado o fallido → vuelve a la caja
 * (lo manda la persona). Enviado y dentro de la vida del turno → se pide otra vez con el mismo idTurno (el
 * servidor repite la respuesta, no corre otro turno). Enviado hace más → a la caja, no se repite solo.
 */
export function queRecuperar(r: PrimerResultado | null | undefined, ahora: number): Recuperacion {
  if (!r) return { accion: 'nada' };
  if (r.estado === 'en-tarea' && r.tareas?.length) return { accion: 'esperar-tareas', tareas: [...r.tareas] };
  if (!r.peticion) return { accion: 'nada' };
  if (r.estado === 'preparada' || r.estado === 'fallida') return { accion: 'rellenar', texto: r.peticion };
  if (r.estado === 'enviada') {
    if (r.idTurno && r.enviadaMs !== undefined && ahora - r.enviadaMs <= VIDA_TURNO_MS) return { accion: 'reconsultar', idTurno: r.idTurno, texto: r.peticion };
    return { accion: 'rellenar', texto: r.peticion };
  }
  return { accion: 'nada' };
}

/* ── las métricas (sin contenido) ─────────────────────────────────────────────────────────── */

export type MetricasPrimer = {
  estado: EstadoPrimer;
  util: boolean;
  verificado: boolean;
  /** Desde que empezó la primera vez hasta el resultado útil. null si no hay resultado útil. */
  msHastaValor: number | null;
  /** Lo mismo, contando un resultado parcial. */
  msHastaResultado: number | null;
  /** Desde el primer envío hasta el resultado. */
  msEnvioAResultado: number | null;
  /** Cuánto duró la primera vez (hasta dejar la petición). */
  msPrimeraVez: number | null;
  toques: number;
  saltos: number;
  atras: number;
  conectar: ConectarPrimer;
  intentos: number;
  editada: boolean | null;
  fuentesFallidas: number;
  sirvio: boolean | null;
  dentroObjetivo: boolean | null;
};

export function metricas(r: PrimerResultado): MetricasPrimer {
  const util = r.estado === 'util';
  const conRes = hayResultado(r) && r.resultadoMs !== undefined;
  const hastaRes = conRes ? Math.max(0, r.resultadoMs! - r.inicioMs) : null;
  const hastaValor = util ? hastaRes : null;
  return {
    estado: r.estado,
    util,
    verificado: !!r.verificado && conRes,
    msHastaValor: hastaValor,
    msHastaResultado: hastaRes,
    msEnvioAResultado: conRes && r.primerEnvioMs !== undefined ? Math.max(0, r.resultadoMs! - r.primerEnvioMs) : null,
    msPrimeraVez: r.preparadaMs !== undefined ? Math.max(0, r.preparadaMs - r.inicioMs) : null,
    toques: r.esfuerzo.toques,
    saltos: r.esfuerzo.saltos,
    atras: r.esfuerzo.atras,
    conectar: r.esfuerzo.conectar,
    intentos: r.intentos,
    editada: r.editada ?? null,
    fuentesFallidas: r.estado === 'parcial' ? r.faltantes?.length || 0 : 0,
    sirvio: r.sirvio ?? null,
    dentroObjetivo: hastaValor === null ? null : hastaValor <= OBJETIVO_MS,
  };
}

const duracion = (ms: number | null) => {
  if (ms === null) return '—';
  const s = Math.round(ms / 1000);
  return s < 60 ? `${s} s` : `${Math.floor(s / 60)} min ${s % 60} s`;
};

/** Una línea para el diagnóstico de campo: solo tiempos, conteos y estados (nada de lo pedido ni contestado). */
export function lineaMetrica(m: MetricasPrimer): string {
  const si = (b: boolean | null) => (b === null ? '—' : b ? 'sí' : 'no');
  return [
    `primer resultado: ${m.estado}${m.verificado ? ' verificado' : ''}`,
    `hasta valor ${duracion(m.msHastaValor)}${m.dentroObjetivo === null ? '' : m.dentroObjetivo ? ' (≤5 min)' : ' (>5 min)'}`,
    `hasta resultado ${duracion(m.msHastaResultado)}`,
    `envío→resultado ${duracion(m.msEnvioAResultado)}`,
    `primera vez ${duracion(m.msPrimeraVez)}`,
    `${m.toques} toques, ${m.saltos} saltos, ${m.atras} atrás, conectar ${m.conectar}`,
    `${m.intentos} reintentos`,
    `editada ${si(m.editada)}`,
    `fuentes que faltaron ${m.fuentesFallidas}`,
    `sirvió ${si(m.sirvio)}`,
  ].join(' · ');
}
