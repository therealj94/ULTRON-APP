/**
 * EL PRIMER RESULTADO, MEDIDO, EN EL TELÉFONO (auditoría del 4-oct, P4 · R1): COPIA de lib/primer-resultado.ts
 * (Metro no importa fuera de mobile/). La explicación está allí. tests/primer-resultado.test.ts comprueba que
 * las dos dicen exactamente lo mismo: si cambias una, cambia la otra.
 *
 * Sin React Native: la primera vez (primeravez/medida.ts) y la mesa lo usan igual que las pruebas en Node.
 */

/** v2 (auditoría del 5-oct, R1): cobertura de todas las tareas esperadas. Un registro v1 se sigue leyendo. */
export const VERSION_PRIMER = 2 as const;

/**
 * Cuántas tareas de un primer pedido se siguen (y se guardan). Si el turno abre más, las de más NO se dejan fuera en
 * silencio: se cuentan (`sinSeguir`) y el resultado nunca es un éxito completo.
 */
export const MAX_TAREAS_PRIMER = 20;

/** La vida del registro durable de un turno en el servidor (server/turno-unico.ts VIDA_DURABLE_MS). */
export const VIDA_TURNO_MS = 30 * 60_000;

/** El objetivo inicial del documento maestro: valor útil en una sesión de unos cinco minutos (no una promesa). */
export const OBJETIVO_MS = 5 * 60_000;

export type EstadoPrimer = 'eligiendo' | 'preparada' | 'sin-peticion' | 'enviada' | 'en-tarea' | 'util' | 'parcial' | 'fallida';

const ESTADOS: readonly EstadoPrimer[] = ['eligiendo', 'preparada', 'sin-peticion', 'enviada', 'en-tarea', 'util', 'parcial', 'fallida'];

/** Conectar cuentas en la primera vez: no se ofreció, la pasó con «Siguiente» o la saltó. */
export type ConectarPrimer = 'no-ofrecida' | 'vista' | 'saltada';

export type EsfuerzoPrimer = { toques: number; saltos: number; atras: number; conectar: ConectarPrimer };

/** Lo que se sabe de UNA tarea esperada: sin leer ≠ en curso ≠ terminada (y cómo). */
export type EstadoCobertura = 'sin-leer' | 'en-curso' | 'completada' | 'respondida' | 'parcial' | 'fallida';
const COBERTURAS: readonly EstadoCobertura[] = ['sin-leer', 'en-curso', 'completada', 'respondida', 'parcial', 'fallida'];
export type AvanceTarea = { id: string; estado: EstadoCobertura; evidencia?: true };

/**
 * Con qué se cerró el resultado: `completa` (todas las tareas esperadas, terminales), `excedida` (el turno abrió más
 * de MAX_TAREAS_PRIMER: nunca un éxito completo), `sin-tareas` (una respuesta sin tareas) o `previa` (un registro v1,
 * cerrado antes de exigir cobertura: las métricas lo separan).
 */
export type CoberturaPrimer = 'completa' | 'excedida' | 'sin-tareas' | 'previa';
const COBERTURAS_CIERRE: readonly CoberturaPrimer[] = ['completa', 'excedida', 'sin-tareas', 'previa'];

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
  /** Los IDs que abrió el turno: el conjunto que tiene que quedar cubierto (sin duplicados). */
  tareas?: string[];
  /** Tareas que abrió el turno por encima de MAX_TAREAS_PRIMER: no se siguen, pero cuentan (nunca éxito completo). */
  sinSeguir?: number;
  /** Lo que se sabe de cada tarea esperada (el progreso mientras falta alguna; al cerrar, cómo quedó cada una). */
  avance?: AvanceTarea[];
  /** Con qué cobertura se cerró (solo con resultado). */
  cobertura?: CoberturaPrimer;
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
 * Lo guardado → el registro, sano, SOLO si es de esta cuenta. Roto, de una versión desconocida o de otra cuenta: null
 * (un teléfono compartido no pasa el primer resultado de A a B).
 *
 * Un registro v1 (de antes de exigir cobertura, R1 del 5-oct) se lee tal cual: no se le inventa evidencia ni se toca
 * su opinión. Si ya estaba cerrado (útil o parcial) queda `cobertura: 'previa'`: las métricas lo distinguen de los
 * cerrados con todas las tareas a la vista. Si seguía en tarea, se cierra con las reglas de ahora.
 */
export function leerPrimer(raw: string | null | undefined, cuenta: string): PrimerResultado | null {
  let j: any;
  try {
    j = JSON.parse(String(raw ?? 'null'));
  } catch {
    return null;
  }
  if (!j || typeof j !== 'object' || (j.v !== VERSION_PRIMER && j.v !== 1)) return null;
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
  const tareas = textos(j.tareas, MAX_TAREAS_PRIMER, 80);
  if (tareas) r.tareas = unicos(tareas);
  const faltan = textos(j.faltantes, 5, 120);
  if (faltan) r.faltantes = faltan;
  const motivo = unaLinea(j.motivo, 120);
  if (motivo) r.motivo = motivo;
  if (typeof j.verificado === 'boolean') r.verificado = j.verificado;
  if (typeof j.editada === 'boolean') r.editada = j.editada;
  if (typeof j.sirvio === 'boolean') r.sirvio = j.sirvio;
  if (j.v === 1) {
    // Cerrado con las reglas de antes: se marca, no se corrige hacia atrás.
    if (r.estado === 'util' || r.estado === 'parcial') r.cobertura = 'previa';
    return r;
  }
  const sinSeguir = Math.floor(num(j.sinSeguir) ?? 0);
  if (sinSeguir > 0) r.sinSeguir = sinSeguir;
  if (COBERTURAS_CIERRE.includes(j.cobertura)) r.cobertura = j.cobertura;
  if (Array.isArray(j.avance)) {
    const avance: AvanceTarea[] = [];
    for (const a of j.avance) {
      const id = a && typeof a === 'object' ? unaLinea(a.id, 80) : '';
      if (!id || !COBERTURAS.includes(a.estado) || avance.some((x) => x.id === id)) continue;
      avance.push(a.evidencia === true ? { id, estado: a.estado, evidencia: true } : { id, estado: a.estado });
      if (avance.length >= MAX_TAREAS_PRIMER) break;
    }
    if (avance.length) r.avance = avance;
  }
  return r;
}

/** Sin vacíos ni repetidos, en el orden en que llegaron. */
function unicos(xs: readonly unknown[]): string[] {
  const r: string[] = [];
  for (const x of xs) if (typeof x === 'string' && x && !r.includes(x)) r.push(x);
  return r;
}

/* ── qué fue lo que volvió ───────────────────────────────────────────────────────────────── */

/**
 * `avance` (solo lo que viene de tareas): cómo quedó cada tarea esperada. Un cierre con `avance` cubrió TODAS.
 */
export type ClaseResultado =
  | { clase: 'ignorar' }
  | { clase: 'pendiente'; avance?: AvanceTarea[] }
  | { clase: 'util'; verificado: boolean; avance?: AvanceTarea[] }
  | { clase: 'parcial'; faltantes: string[]; verificado?: boolean; avance?: AvanceTarea[] }
  | { clase: 'fallida'; motivo: string; avance?: AvanceTarea[] }
  | { clase: 'en-tarea'; tareas: string[]; sinSeguir?: number };

/** Lo que importa de una tarea durable (TareaVista o RefTarea de lib/trabajos.ts). */
export type TareaPrimer = {
  id: string;
  title?: string;
  state?: string;
  estadoReal?: string;
  version?: number;
  /** Solo del cliente: la última lista vino parcial y esta tarea no estaba (lib/trabajos.ts). Lo que dice puede ser viejo. */
  sinConfirmar?: boolean;
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

const validas = (x: unknown): TareaPrimer[] =>
  Array.isArray(x) ? x.filter((t): t is TareaPrimer => !!t && typeof t === 'object' && typeof (t as TareaPrimer).id === 'string' && !!(t as TareaPrimer).id) : [];

const estadoDe = (t: TareaPrimer) => String(t.estadoReal || t.state || '');
const conEvidencia = (t: TareaPrimer) => estadoDe(t) === 'completed' && (t.result?.evidence?.length ?? 0) > 0;

/**
 * Lo que se sabe de UN id esperado, con todas las entradas que trajeron ESE id exacto (un ajeno no cuenta). Varias con
 * el mismo id: gana la terminal (una terminal no vuelve atrás) y, entre ellas, la de versión más alta; si aun así se
 * contradicen, no se sabe (`sin-leer`). Una `sinConfirmar` que no es terminal tampoco se sabe: puede ser vieja.
 */
function cubrirUna(id: string, xs: readonly TareaPrimer[]): { avance: AvanceTarea; t: TareaPrimer | null } {
  const propias = xs.filter((t) => t.id === id && (!t.sinConfirmar || TERMINALES.has(estadoDe(t))));
  if (!propias.length) return { avance: { id, estado: 'sin-leer' }, t: null };
  const terminales = propias.filter((t) => TERMINALES.has(estadoDe(t)));
  const grupo = terminales.length ? terminales : propias;
  const vMax = Math.max(...grupo.map((t) => num(t.version) ?? 0));
  const arriba = grupo.filter((t) => (num(t.version) ?? 0) === vMax);
  const s = estadoDe(arriba[0]);
  if (arriba.some((t) => estadoDe(t) !== s)) return { avance: { id, estado: 'sin-leer' }, t: null };
  const t = arriba[0];
  if (!TERMINALES.has(s)) return { avance: { id, estado: 'en-curso' }, t };
  if (s === 'completed') return { avance: arriba.every(conEvidencia) ? { id, estado: 'completada', evidencia: true } : { id, estado: 'completada' }, t };
  if (s === 'respondida') return { avance: { id, estado: 'respondida' }, t };
  if (s === 'partial') return { avance: { id, estado: 'parcial' }, t };
  return { avance: { id, estado: 'fallida' }, t };
}

/** Cada id esperado (sin repetidos, en su orden) → sin leer, en curso o cómo terminó. */
export function coberturaTareas(tareas: readonly TareaPrimer[], ids: readonly string[]): AvanceTarea[] {
  const xs = validas(tareas);
  return unicos(ids).map((id) => cubrirUna(id, xs).avance);
}

/**
 * Las tareas del primer pedido → qué resultado dieron. `ids` es el conjunto AUTORITATIVO (los que abrió el turno); sin
 * él, los ids de las propias tareas. Mientras alguna esté sin leer o en curso: `pendiente` (con su avance): una lista
 * parcial, un 503, un 404, duplicados o IDs ajenos no la dan por buena ni por mala. Todas terminales: completadas →
 * útil (verificado solo si TODAS traen evidencia); `respondida` → útil sin comprobar; parcial → lo que faltó; fallida o
 * cancelada → falta esa tarea. Todas mal → fallida. `sinSeguir` (las que el turno abrió de más): nunca útil completo.
 */
export function clasificarTareas(tareas: readonly TareaPrimer[], ids?: readonly string[], sinSeguir = 0): ClaseResultado {
  const xs = validas(tareas);
  const esperadas = unicos(ids?.length ? ids : xs.map((t) => t.id));
  if (!esperadas.length) return { clase: 'pendiente' };
  const cub = esperadas.map((id) => cubrirUna(id, xs));
  const avance = cub.map((c) => c.avance);
  if (cub.some((c) => c.avance.estado === 'sin-leer' || c.avance.estado === 'en-curso')) return { clase: 'pendiente', avance };
  let ok = 0;
  let verificadas = 0;
  let parciales = 0;
  const faltantes: string[] = [];
  if (sinSeguir > 0) faltantes.push(`${sinSeguir} ${sinSeguir === 1 ? 'tarea más' : 'tareas más'} del pedido que no pude seguir`);
  for (const { avance: a, t } of cub) {
    if (a.estado === 'completada' || a.estado === 'respondida') {
      ok++;
      if (a.evidencia) verificadas++;
    } else if (a.estado === 'parcial') {
      parciales++;
      const p = (t?.result?.partial || []).map((x) => unaLinea(x, 120)).filter(Boolean);
      faltantes.push(...(p.length ? p : [unaLinea(t?.title, 120) || 'una parte de la tarea']));
    } else faltantes.push(unaLinea(t?.title, 120) || 'la tarea');
  }
  if (ok === cub.length && !(sinSeguir > 0)) return { clase: 'util', verificado: verificadas === cub.length, avance };
  if (!ok && !parciales) return { clase: 'fallida', motivo: 'la tarea no terminó', avance };
  return { clase: 'parcial', faltantes: faltantes.slice(0, 5), verificado: false, avance };
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
  const refs = validas(res.tareas);
  if (refs.length) {
    const ids = unicos(refs.map((x) => x.id));
    // Más de las que se siguen: no se recortan en silencio; se cuentan y el resultado lo espera en tarea.
    if (ids.length > MAX_TAREAS_PRIMER) return { clase: 'en-tarea', tareas: ids.slice(0, MAX_TAREAS_PRIMER), sinSeguir: ids.length - MAX_TAREAS_PRIMER };
    const t = clasificarTareas(refs, ids);
    if (t.clase === 'pendiente') return { clase: 'en-tarea', tareas: ids };
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
  /**
   * Lo que se pudo leer de las tareas. `ids` e `idTurno`: para QUÉ intento se leyó; si el registro ya espera otras
   * tareas u otro turno (reabrió, mandó otra vez), lo que llega tarde no cuenta.
   */
  | { tipo: 'tareas'; tareas: readonly TareaPrimer[]; ids?: readonly string[]; idTurno?: string }
  | { tipo: 'opinar'; sirvio: boolean };

const TERMINAL: readonly EstadoPrimer[] = ['util', 'parcial'];

/** ¿Ya hubo primer resultado (útil o parcial)? Desde ahí solo cambia la opinión. */
export const hayResultado = (r: PrimerResultado | null | undefined) => !!r && TERMINAL.includes(r.estado);

/** Lo que dejó un intento anterior (sus tareas, su avance, su cierre): no es de este. */
function sinIntento(r: PrimerResultado): PrimerResultado {
  const n: PrimerResultado = { ...r };
  for (const k of ['faltantes', 'motivo', 'tareas', 'sinSeguir', 'avance', 'cobertura', 'verificado'] as const) delete n[k];
  return n;
}

function conResultado(r: PrimerResultado, c: ClaseResultado, ahora: number): PrimerResultado {
  if (c.clase === 'ignorar' || c.clase === 'pendiente') return r;
  const base = sinIntento(r);
  if (c.clase === 'en-tarea') {
    const tareas = unicos(c.tareas).slice(0, MAX_TAREAS_PRIMER);
    const sinSeguir = Math.floor(num(c.sinSeguir) ?? 0);
    return { ...base, estado: 'en-tarea', tareas, ...(sinSeguir > 0 ? { sinSeguir } : {}) };
  }
  // Un cierre de tareas trae el avance de TODAS las esperadas; uno sin tareas es una respuesta sola.
  const deTareas: Partial<PrimerResultado> = c.avance?.length
    ? { tareas: c.avance.map((a) => a.id), avance: c.avance.map((a) => ({ ...a })), ...(r.sinSeguir ? { sinSeguir: r.sinSeguir } : {}), cobertura: r.sinSeguir ? 'excedida' : 'completa' }
    : { cobertura: 'sin-tareas' };
  switch (c.clase) {
    case 'util':
      return { ...base, ...deTareas, estado: 'util', resultadoMs: ahora, verificado: c.verificado };
    case 'parcial':
      return { ...base, ...deTareas, estado: 'parcial', resultadoMs: ahora, verificado: !!c.verificado, faltantes: c.faltantes.map((x) => unaLinea(x, 120)).filter(Boolean).slice(0, 5) };
    case 'fallida': {
      // Fallida no es un resultado: no lleva cobertura de cierre (lo siguiente que mande es un reintento).
      const n: PrimerResultado = { ...base, ...deTareas, estado: 'fallida', motivo: unaLinea(c.motivo, 120) || 'sin respuesta' };
      delete n.cobertura;
      return n;
    }
  }
}

const mismoConjunto = (a: readonly string[], b: readonly string[]) => {
  const x = unicos(a);
  const y = unicos(b);
  return x.length === y.length && x.every((id) => y.includes(id));
};

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
      // Otro intento: las tareas, el avance y el cierre del anterior no son de este.
      return sinIntento(n);
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
      // Leído para otro intento (otro turno u otras tareas): llega tarde y no cuenta.
      if (ev.idTurno && r.idTurno && ev.idTurno !== r.idTurno) return r;
      if (ev.ids && !mismoConjunto(ev.ids, r.tareas)) return r;
      const c = clasificarTareas(ev.tareas, r.tareas, r.sinSeguir);
      if (c.clase !== 'pendiente') return conResultado(r, c, ahora);
      // Falta alguna: se guarda el progreso (lo que ya terminó se ve), sin cerrar nada.
      const avance = c.avance || [];
      return JSON.stringify(avance) === JSON.stringify(r.avance || []) ? r : { ...r, avance };
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

/**
 * El progreso del primer pedido mientras espera sus tareas: cuántas terminaron de cuántas (las de más que no se siguen
 * cuentan en el total) y cuántas no se pudieron leer. Solo `en-tarea`; null en cualquier otro estado.
 */
export function avancePrimer(r: PrimerResultado | null | undefined): { listas: number; total: number; sinLeer: number } | null {
  if (!r || r.estado !== 'en-tarea' || !r.tareas?.length) return null;
  const avance = coberturaGuardada(r);
  const listas = avance.filter((a) => a.estado !== 'sin-leer' && a.estado !== 'en-curso').length;
  return { listas, total: avance.length + (r.sinSeguir || 0), sinLeer: avance.filter((a) => a.estado === 'sin-leer').length };
}

/** El avance guardado, por cada id esperado (lo que no tiene avance, sin leer). */
function coberturaGuardada(r: PrimerResultado): AvanceTarea[] {
  return unicos(r.tareas || []).map((id) => r.avance?.find((a) => a.id === id) || { id, estado: 'sin-leer' as const });
}

/* ── el ensamblado de la mesa: las tareas esperadas, de la lista o leídas una por una ──────────── */

/** Lo que dio leer UNA tarea por su id (lib/trabajos.ts `leer`): no es lo mismo «no existe» que «no pude leerla». */
export type LecturaTarea = { estado: 'ok'; tarea: TareaPrimer } | { estado: 'no-existe' } | { estado: 'error' };

/**
 * Lo que la mesa (DeskScreen) junta para el evento `tareas`: por cada id esperado, la tarea de la lista del panel si
 * es de fiar (no `sinConfirmar`, o terminal), y si no, leída por su id. Una lectura que falla (503, red), un 404 o una
 * respuesta con OTRO id no aportan nada: esa tarea queda sin leer (`sinLeer` / `noExisten`), nunca terminada.
 * Las de la lista que no se esperan no pasan (ajenas). Nunca lanza.
 */
export async function reunirTareasPrimer(
  ids: readonly string[],
  lista: readonly TareaPrimer[],
  leer: (id: string) => Promise<LecturaTarea>
): Promise<{ tareas: TareaPrimer[]; sinLeer: string[]; noExisten: string[] }> {
  const esperadas = unicos(ids);
  const deFiar = validas(lista).filter((t) => esperadas.includes(t.id) && (!t.sinConfirmar || TERMINALES.has(estadoDe(t))));
  const tareas: TareaPrimer[] = [...deFiar];
  const sinLeer: string[] = [];
  const noExisten: string[] = [];
  const faltan = esperadas.filter((id) => !deFiar.some((t) => t.id === id));
  const leidas = await Promise.all(
    faltan.map(async (id) => {
      try {
        return { id, l: await leer(id) };
      } catch {
        return { id, l: { estado: 'error' } as LecturaTarea };
      }
    })
  );
  for (const { id, l } of leidas) {
    if (l && l.estado === 'ok' && l.tarea && typeof l.tarea === 'object' && l.tarea.id === id) tareas.push(l.tarea);
    else if (l && l.estado === 'no-existe') noExisten.push(id);
    else sinLeer.push(id);
  }
  return { tareas, sinLeer, noExisten };
}

/**
 * Una vuelta de la mesa sobre las tareas del primer pedido (el efecto de DeskScreen, sin React): junta lo que hay y lo
 * anota ATADO a este intento (`ids`, `idTurno`). Si mientras se leía la sesión cambió, se reabrió o la pantalla se fue
 * (`vigente()` falso), no anota nada: lo tardío de otra cuenta o de otro intento no entra. Devuelve si anotó.
 */
export async function seguirTareasPrimer(o: {
  ids: readonly string[];
  idTurno?: string;
  lista: readonly TareaPrimer[];
  leer: (id: string) => Promise<LecturaTarea>;
  vigente: () => boolean;
  anotar: (ev: EventoPrimer) => unknown;
}): Promise<boolean> {
  const ids = unicos(o.ids);
  if (!ids.length) return false;
  const r = await reunirTareasPrimer(ids, o.lista, o.leer);
  if (!o.vigente()) return false;
  o.anotar({ tipo: 'tareas', tareas: r.tareas, ids, ...(o.idTurno ? { idTurno: o.idTurno } : {}) });
  return true;
}

/* ── recuperar al reabrir ────────────────────────────────────────────────────────────────── */

export type Recuperacion =
  | { accion: 'nada' }
  | { accion: 'rellenar'; texto: string }
  | { accion: 'reconsultar'; idTurno: string; texto: string }
  | { accion: 'esperar-tareas'; tareas: string[] };

/**
 * Al abrir la mesa: qué hacer con el primer pedido que quedó a medias. Preparado o fallido → vuelve a la caja
 * (lo manda la persona). Enviado y dentro de la vida del turno → se pregunta por ese idTurno en modo «solo
 * repetir» (`soloRepetir`: el servidor da la respuesta guardada, nunca corre otro turno; ver `trasSoloRepetir`).
 * Enviado hace más → a la caja, no se repite solo.
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

/**
 * Lo que contestó el servidor a «solo repetir» ese idTurno (revisión 9, R1), y qué se hace:
 *  · 200 con respuesta (o `reconciliando`), o 409 «en curso» → `repetir`: se pide otra vez con `soloRepetir` y el
 *    servidor da esa respuesta (o espera a ese turno); nunca corre uno nuevo.
 *  · 404 `no_existe` → `rellenar` y `noLlego`: el pedido no llegó (o no dejó nada); vuelve a la caja y lo manda la
 *    persona. Ningún turno nuevo corre sin que toque nada.
 *  · sin red, un servidor de antes (POST /api/turno/repetir le da 404 sin `codigo`) o cualquier otra cosa → `rellenar`
 *    sin saber.
 */
export type TrasRepetir = { accion: 'repetir' } | { accion: 'rellenar'; noLlego: boolean };
export function trasSoloRepetir(r: { status: number; json?: unknown } | null | undefined): TrasRepetir {
  if (!r) return { accion: 'rellenar', noLlego: false };
  const j = (r.json && typeof r.json === 'object' ? r.json : {}) as { codigo?: unknown; enCurso?: unknown; reply?: unknown; repetido?: unknown; reconciliando?: unknown };
  if (r.status === 404 && j.codigo === 'no_existe') return { accion: 'rellenar', noLlego: true };
  if (r.status === 409 && j.enCurso === true) return { accion: 'repetir' };
  // Solo una respuesta REPETIDA cuenta (la guardada de ese turno), nunca una recién corrida.
  if (r.status === 200 && j.repetido === true && (typeof j.reply === 'string' || j.reconciliando === true)) return { accion: 'repetir' };
  return { accion: 'rellenar', noLlego: false };
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
  /**
   * Con qué se cerró (R1 del 5-oct): `completa`/`excedida`/`sin-tareas`, o `previa` (registro v1, cerrado antes de
   * exigir cobertura: no se mezcla con los demás). null sin resultado.
   */
  cobertura: CoberturaPrimer | null;
  /**
   * Las tres señales por separado: cuántas tareas TERMINARON bien (completadas o respondidas), cuántas con evidencia
   * comprobable y cuántas siguen sin leer; la opinión es `sirvio`. null si el pedido no abrió tareas.
   */
  tareas: { total: number; terminadasBien: number; conEvidencia: number; sinLeer: number } | null;
};

export function metricas(r: PrimerResultado): MetricasPrimer {
  const util = r.estado === 'util';
  const conRes = hayResultado(r) && r.resultadoMs !== undefined;
  const hastaRes = conRes ? Math.max(0, r.resultadoMs! - r.inicioMs) : null;
  const hastaValor = util ? hastaRes : null;
  const av = r.tareas?.length ? coberturaGuardada(r) : null;
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
    cobertura: hayResultado(r) ? (r.cobertura ?? null) : null,
    tareas:
      av && r.cobertura !== 'previa'
        ? {
            total: av.length + (r.sinSeguir || 0),
            terminadasBien: av.filter((a) => a.estado === 'completada' || a.estado === 'respondida').length,
            conEvidencia: av.filter((a) => a.evidencia).length,
            sinLeer: av.filter((a) => a.estado === 'sin-leer').length,
          }
        : null,
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
    `cobertura ${m.cobertura ?? '—'}`,
    ...(m.tareas ? [`tareas ${m.tareas.terminadasBien}/${m.tareas.total} bien, ${m.tareas.conEvidencia} con evidencia, ${m.tareas.sinLeer} sin leer`] : []),
  ].join(' · ');
}
