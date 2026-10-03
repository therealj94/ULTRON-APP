/**
 * LO QUE AURA LLEVA DE LA PERSONA, EN EL TELÉFONO (la lógica, sin React Native): sus misiones, lo que sabe
 * de ella, lo que quedó a medias y su círculo cercano (server/iniciativa.ts y server/cerebro-continuo.ts;
 * docs/INICIATIVA.md y docs/CEREBRO-CONTINUO.md).
 *
 * Las hojas (ajustes/Misiones.tsx, ajustes/LoQueSeDeTi.tsx, ajustes/Circulo.tsx) solo dibujan: los tipos de
 * lo que contesta el servidor, los cuerpos que se le mandan, y las cuentas y palabras de cada fila viven
 * aquí, para probarlas en Node (compa/pruebas/iniciativa.prueba.mjs).
 *
 *   GET  /api/misiones                         → { misiones }        POST /api/misiones {accion, …}
 *   GET  /api/cerebro/conocer                  → { categorias, total, faltan }   DELETE /api/cerebro/conocer/:id
 *   GET  /api/cerebro/abiertos                 → { abiertos, cerrados }          POST /api/cerebro/abiertos/:id/cerrar {estado}
 *   GET  /api/circulo                          → { personas, puede }  POST /api/circulo  DELETE /api/circulo/:id
 */

type Idioma = 'es' | 'en';

/* ── las hojas que se abren desde cualquier pantalla (app/hojas.ts) ───────────────────────────── */

/**
 * Las pantallas de más que «abrir» entiende para lo de AURA (como compa/computadora.ts PANTALLAS_MAS): sus
 * misiones, lo que sabe de ti y tu círculo. El servidor todavía no las manda; si un día lo hace con
 * {"tipo":"abrir","pantalla":"misiones"}, la app ya las abre.
 */
export const PANTALLAS_CEREBRO = ['misiones', 'conocer', 'circulo'] as const;
export type PantallaCerebro = (typeof PANTALLAS_CEREBRO)[number];

export function esPantallaCerebro(p: unknown): p is PantallaCerebro {
  return typeof p === 'string' && (PANTALLAS_CEREBRO as readonly string[]).includes(p);
}

/* ── misiones ────────────────────────────────────────────────────────────────────────────────── */

export type EstadoMision = 'activa' | 'pausada' | 'hecha' | 'descartada';
export type PasoMision = { texto: string; hecho: boolean; t: number };
export type Mision = {
  id: string;
  /** Su número entre las abiertas («la misión 2»); las cerradas no tienen. */
  numero?: number;
  titulo: string;
  objetivo: string;
  porque?: string;
  pasos: PasoMision[];
  proximoPaso: string;
  estado: EstadoMision;
  notas: { texto: string; t: number }[];
  creada: number;
  actualizada: number;
  vence?: number;
};

export const MAX_TITULO_MISION = 80;
export const MAX_OBJETIVO_MISION = 300;
export const MAX_PASOS_MISION = 12;

/** La lista del GET, sana (lo que no tiene forma de misión se salta). */
export function misionesDe(r: unknown): Mision[] {
  const l = (r as { misiones?: unknown } | null)?.misiones;
  if (!Array.isArray(l)) return [];
  return l
    .filter((m: any) => m && typeof m.id === 'string' && typeof m.titulo === 'string')
    .map((m: any) => ({
      ...m,
      objetivo: typeof m.objetivo === 'string' ? m.objetivo : '',
      pasos: Array.isArray(m.pasos) ? m.pasos.filter((p: any) => p && typeof p.texto === 'string').map((p: any) => ({ texto: p.texto, hecho: !!p.hecho, t: Number(p.t) || 0 })) : [],
      proximoPaso: typeof m.proximoPaso === 'string' ? m.proximoPaso : '',
      notas: Array.isArray(m.notas) ? m.notas : [],
    }));
}

export const abierta = (m: Pick<Mision, 'estado'>) => m.estado === 'activa' || m.estado === 'pausada';

/** «2 de 5 pasos». */
export function avanceMision(m: Pick<Mision, 'pasos'>, idioma: Idioma = 'es'): { hechos: number; total: number; texto: string; fraccion: number } {
  const total = m.pasos.length;
  const hechos = m.pasos.filter((p) => p.hecho).length;
  const texto = !total ? (idioma === 'en' ? 'No steps yet' : 'Sin pasos todavía') : idioma === 'en' ? `${hechos} of ${total} steps` : `${hechos} de ${total} pasos`;
  return { hechos, total, texto, fraccion: total ? hechos / total : 0 };
}

const DIA_MS = 86_400_000;

/** Para cuándo es, en palabras («vence mañana», «se pasó hace 3 días», «vence el 14 oct»). Null sin fecha. */
export function venceEnPalabras(vence: number | undefined, ahora: number, idioma: Idioma = 'es'): { texto: string; tarde: boolean; pronto: boolean } | null {
  if (!vence || !Number.isFinite(vence)) return null;
  const en = idioma === 'en';
  // Por días de calendario en Honduras (UTC−6, sin horario de verano).
  const dia = (t: number) => Math.floor((t - 6 * 3_600_000) / DIA_MS);
  // Una fecha que AURA guardó como «AAAA-MM-DD» llega como medianoche UTC (las 6 de la tarde del día
  // anterior en Honduras): esa cuenta como su día, no como el anterior.
  const diaVence = vence % DIA_MS === 0 ? vence / DIA_MS : dia(vence);
  const d = diaVence - dia(ahora);
  if (d < 0) {
    const n = -d;
    return { texto: en ? (n === 1 ? 'was due yesterday' : `overdue by ${n} days`) : n === 1 ? 'venció ayer' : `se pasó hace ${n} días`, tarde: true, pronto: false };
  }
  if (d === 0) return { texto: en ? 'due today' : 'vence hoy', tarde: false, pronto: true };
  if (d === 1) return { texto: en ? 'due tomorrow' : 'vence mañana', tarde: false, pronto: true };
  if (d < 7) return { texto: en ? `due in ${d} days` : `vence en ${d} días`, tarde: false, pronto: d <= 3 };
  const f = new Date(vence % DIA_MS === 0 ? vence : vence - 6 * 3_600_000);
  const MESES = en ? ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] : ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
  const fecha = en ? `${MESES[f.getUTCMonth()]} ${f.getUTCDate()}` : `${f.getUTCDate()} ${MESES[f.getUTCMonth()]}`;
  return { texto: en ? `due ${fecha}` : `vence el ${fecha}`, tarde: false, pronto: false };
}

/** Lo que se escribe a mano para una misión nueva (la hoja). */
export type BorradorMision = { titulo: string; objetivo: string; pasos: string; vence: string };

/** «2026-10-14», «14/10/2026» o «14-10» (este año, o el que viene si ya pasó) → «AAAA-MM-DD»; '' si va vacío; null si no se entiende. */
export function fechaMision(v: string, ahora: number): string | null {
  const s = v.trim();
  if (!s) return '';
  const dosDig = (n: number) => String(n).padStart(2, '0');
  const valida = (a: number, m: number, d: number) => {
    const f = new Date(Date.UTC(a, m - 1, d));
    return f.getUTCFullYear() === a && f.getUTCMonth() === m - 1 && f.getUTCDate() === d ? `${a}-${dosDig(m)}-${dosDig(d)}` : null;
  };
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) return valida(Number(m[1]), Number(m[2]), Number(m[3]));
  m = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (m) return valida(Number(m[3]), Number(m[2]), Number(m[1]));
  m = s.match(/^(\d{1,2})[/-](\d{1,2})$/);
  if (m) {
    const hoy = new Date(ahora - 6 * 3_600_000);
    let a = hoy.getUTCFullYear();
    const iso = valida(a, Number(m[2]), Number(m[1]));
    if (!iso) return null;
    if (Date.parse(`${iso}T23:59:59-06:00`) < ahora) a += 1;
    return valida(a, Number(m[2]), Number(m[1]));
  }
  return null;
}

/**
 * El cuerpo de POST /api/misiones {accion:'crear'} desde lo escrito, o el error en palabras. Los pasos van
 * uno por renglón (o separados por «;»). La fecha se manda en milisegundos, al mediodía de Honduras de ese
 * día («AAAA-MM-DD» el servidor lo leería como medianoche UTC: las 6 de la tarde del día anterior aquí).
 */
export function cuerpoNuevaMision(b: BorradorMision, ahora: number, idioma: Idioma = 'es'): { ok: true; cuerpo: Record<string, unknown> } | { ok: false; error: string } {
  const en = idioma === 'en';
  const titulo = b.titulo.replace(/\s+/g, ' ').trim().slice(0, MAX_TITULO_MISION);
  if (titulo.length < 3) return { ok: false, error: en ? 'Give it a title: what do you want to achieve?' : 'Ponle un título: ¿qué quieres lograr?' };
  const pasos = b.pasos
    .split(/[\n;]/)
    .map((p) => p.replace(/^\s*(?:[-•*]|\d+[.)])\s*/, '').replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .slice(0, MAX_PASOS_MISION);
  const vence = fechaMision(b.vence, ahora);
  if (vence === null) return { ok: false, error: en ? 'I don’t understand the date (use YYYY-MM-DD or DD/MM).' : 'No entiendo la fecha (usa AAAA-MM-DD o DD/MM).' };
  const cuerpo: Record<string, unknown> = { accion: 'crear', titulo };
  const objetivo = b.objetivo.replace(/\s+/g, ' ').trim().slice(0, MAX_OBJETIVO_MISION);
  if (objetivo) cuerpo.objetivo = objetivo;
  if (pasos.length) cuerpo.pasos = pasos;
  if (vence) cuerpo.vence = Date.parse(`${vence}T12:00:00-06:00`);
  return { ok: true, cuerpo };
}

/** Marcar un paso (el número es 1…, como lo cuenta el servidor). Los pasos hechos no se desmarcan. */
export function cuerpoPasoHecho(m: Pick<Mision, 'id' | 'pasos'>, indice: number): Record<string, unknown> | null {
  const p = m.pasos[indice];
  if (!p || p.hecho) return null;
  return { accion: 'avanzar', id: m.id, pasoHecho: indice + 1 };
}

/** Cerrar como hecha o descartarla. */
export function cuerpoCerrarMision(id: string, como: 'hecha' | 'descartada'): Record<string, unknown> {
  return como === 'hecha' ? { accion: 'cerrar', id } : { accion: 'cerrar', id, estado: 'descartada' };
}

/** La misión con el paso marcado, para verlo al instante mientras el servidor contesta. */
export function conPasoHecho(m: Mision, indice: number, ahora: number): Mision {
  const pasos = m.pasos.map((p, i) => (i === indice ? { ...p, hecho: true, t: ahora } : p));
  return { ...m, pasos, proximoPaso: pasos.find((p) => !p.hecho)?.texto || '' };
}

/* ── lo que sabe de ti y lo que quedó a medias ───────────────────────────────────────────────── */

export type DatoPersona = { id: string; categoria: string; dato: string; clave?: string; confianza: number; fuente: string; desde: number; visto: number; veces: number };
export type CategoriaConocer = { id: string; nombre: string; datos: DatoPersona[] };
export type Hueco = { clave: string; pregunta: string };
export type Conocer = { categorias: CategoriaConocer[]; total: number; faltan: Hueco[] };

/** El GET de lo que sabe, sano: solo las categorías con algo (en el orden del servidor). */
export function conocerDe(r: unknown): Conocer {
  const x = (r || {}) as { categorias?: unknown; total?: unknown; faltan?: unknown };
  const categorias = (Array.isArray(x.categorias) ? x.categorias : [])
    .filter((c: any) => c && typeof c.id === 'string')
    .map((c: any) => ({
      id: c.id,
      nombre: typeof c.nombre === 'string' && c.nombre ? c.nombre : c.id,
      datos: (Array.isArray(c.datos) ? c.datos : []).filter((d: any) => d && typeof d.id === 'string' && typeof d.dato === 'string'),
    }));
  const faltan = (Array.isArray(x.faltan) ? x.faltan : []).filter((h: any) => h && typeof h.pregunta === 'string');
  const total = Number.isFinite(Number(x.total)) ? Number(x.total) : categorias.reduce((n, c) => n + c.datos.length, 0);
  return { categorias, total, faltan };
}

/** Quita un dato de la vista (al borrarlo), sin esperar a volver a leer. */
export function sinDato(c: Conocer, id: string): Conocer {
  let quitados = 0;
  const categorias = c.categorias.map((k) => {
    const datos = k.datos.filter((d) => d.id !== id);
    quitados += k.datos.length - datos.length;
    return { ...k, datos };
  });
  return { ...c, categorias, total: Math.max(0, c.total - quitados) };
}

/** «Lo dijiste tú» / «Lo deduje» según la confianza y la fuente. */
export function origenDato(d: Pick<DatoPersona, 'confianza' | 'fuente'>, idioma: Idioma = 'es'): string {
  const en = idioma === 'en';
  if (d.fuente === 'manual') return en ? 'You added it' : 'Lo agregaste tú';
  if (d.confianza >= 0.8) return en ? 'You told me' : 'Me lo dijiste';
  return en ? 'I inferred it' : 'Lo deduje';
}

export type TipoAbierto = 'promesa_aura' | 'promesa_persona' | 'pregunta' | 'tarea' | 'borrador' | 'mision';
export type Abierto = { id: string; texto: string; tipo: TipoAbierto; estado: string; importante: boolean; creado: number; actualizado: number; cuando?: string };

export function abiertosDe(r: unknown): Abierto[] {
  const l = (r as { abiertos?: unknown } | null)?.abiertos;
  if (!Array.isArray(l)) return [];
  return l.filter((a: any) => a && typeof a.id === 'string' && typeof a.texto === 'string' && (a.estado === undefined || a.estado === 'abierto'));
}

/** De quién es lo que quedó a medias, en palabras. */
export function etiquetaAbierto(t: string, idioma: Idioma = 'es'): string {
  const en = idioma === 'en';
  switch (t) {
    case 'promesa_aura':
      return en ? 'I promised it' : 'Te lo prometí';
    case 'promesa_persona':
      return en ? 'You said you’d do it' : 'Dijiste que lo harías';
    case 'pregunta':
      return en ? 'Still unanswered' : 'Quedó sin resolver';
    case 'borrador':
      return en ? 'Unsent draft' : 'Borrador sin mandar';
    case 'mision':
      return en ? 'Mission' : 'Misión';
    default:
      return en ? 'Started' : 'Empezado';
  }
}

/** Los importantes primero, luego lo más reciente. */
export function ordenarAbiertos(l: Abierto[]): Abierto[] {
  return [...l].sort((a, b) => Number(b.importante) - Number(a.importante) || (b.actualizado || b.creado || 0) - (a.actualizado || a.creado || 0));
}

/* ── tu círculo ──────────────────────────────────────────────────────────────────────────────── */

export const RELACIONES = ['esposa', 'esposo', 'pareja', 'hija', 'hijo', 'madre', 'padre', 'hermana', 'hermano', 'familia', 'amigo', 'amiga', 'socio', 'socia', 'asistente', 'otro'] as const;
export type Relacion = (typeof RELACIONES)[number];
export type PermisoRecordatorio = 'preguntar' | 'permitido';

export type PersonaCirculo = {
  id: string;
  nombre: string;
  alias: string[];
  relacion: Relacion;
  canales: { whatsapp?: string; pulse2chat?: string; telefono?: string; correo?: string };
  permisos: { recordatorios: PermisoRecordatorio; mensajes: 'preguntar' };
  notas?: string;
  creado: number;
  actualizado: number;
};
export type PuedeCirculo = { whatsapp: boolean; llamada: 'solo_dueno' | 'sin_configurar'; pulse2chat: 'app' };

export function circuloDe(r: unknown): { personas: PersonaCirculo[]; puede: PuedeCirculo | null } {
  const x = (r || {}) as { personas?: unknown; puede?: unknown };
  const personas = (Array.isArray(x.personas) ? x.personas : [])
    .filter((p: any) => p && typeof p.id === 'string' && typeof p.nombre === 'string')
    .map((p: any) => ({
      ...p,
      canales: p.canales && typeof p.canales === 'object' ? p.canales : {},
      permisos: { recordatorios: p.permisos?.recordatorios === 'permitido' ? 'permitido' : 'preguntar', mensajes: 'preguntar' },
    }));
  const pu = x.puede as PuedeCirculo | undefined;
  return { personas, puede: pu && typeof pu === 'object' ? pu : null };
}

const NOMBRE_RELACION: Record<Relacion, { es: string; en: string }> = {
  esposa: { es: 'Esposa', en: 'Wife' },
  esposo: { es: 'Esposo', en: 'Husband' },
  pareja: { es: 'Pareja', en: 'Partner' },
  hija: { es: 'Hija', en: 'Daughter' },
  hijo: { es: 'Hijo', en: 'Son' },
  madre: { es: 'Mamá', en: 'Mom' },
  padre: { es: 'Papá', en: 'Dad' },
  hermana: { es: 'Hermana', en: 'Sister' },
  hermano: { es: 'Hermano', en: 'Brother' },
  familia: { es: 'Familia', en: 'Family' },
  amigo: { es: 'Amigo', en: 'Friend' },
  amiga: { es: 'Amiga', en: 'Friend' },
  socio: { es: 'Socio', en: 'Partner (work)' },
  socia: { es: 'Socia', en: 'Partner (work)' },
  asistente: { es: 'Asistente', en: 'Assistant' },
  otro: { es: 'Otra persona', en: 'Someone else' },
};

export function nombreRelacion(r: string, idioma: Idioma = 'es'): string {
  const n = NOMBRE_RELACION[r as Relacion] || NOMBRE_RELACION.otro;
  return n[idioma];
}

/** «+50499990000» → «+504 9999-0000» (Honduras); otros, tal cual. */
export function numeroLegible(n: string | undefined): string {
  const s = String(n || '').trim();
  const hn = s.match(/^\+504(\d{4})(\d{4})$/);
  return hn ? `+504 ${hn[1]}-${hn[2]}` : s;
}

/** Lo que se escribe a mano para alguien del círculo. */
export type BorradorPersona = { nombre: string; relacion: Relacion; whatsapp: string };

/** ¿Parece un número? (8 dígitos de Honduras, o de 8 a 15 con lada; lo normaliza el servidor). */
export function numeroValido(v: string): boolean {
  const d = v.replace(/[^\d]/g, '');
  return d.length >= 8 && d.length <= 15;
}

/**
 * El cuerpo de POST /api/circulo para agregar (sin `id`) o cambiar (con `id`). Sin WhatsApp escrito no
 * se manda canal (al cambiar, el servidor deja el que había). Los permisos no van aquí: los cambia su
 * interruptor (cuerpoPermiso), a propósito.
 */
export function cuerpoPersona(b: BorradorPersona, id?: string, idioma: Idioma = 'es'): { ok: true; cuerpo: Record<string, unknown> } | { ok: false; error: string } {
  const en = idioma === 'en';
  const nombre = b.nombre.replace(/\s+/g, ' ').trim().slice(0, 60);
  if (!nombre) return { ok: false, error: en ? 'Write their name.' : 'Escribe su nombre.' };
  const wa = b.whatsapp.trim();
  if (wa && !numeroValido(wa)) return { ok: false, error: en ? 'That WhatsApp doesn’t look like a number.' : 'Ese WhatsApp no parece un número.' };
  const cuerpo: Record<string, unknown> = { nombre, relacion: b.relacion };
  if (wa) cuerpo.canales = { whatsapp: wa };
  if (id) cuerpo.id = id;
  return { ok: true, cuerpo };
}

/** «AURA puede mandarle recordatorios sin preguntarme» (solo se da desde la app: POST /api/circulo). */
export function cuerpoPermiso(id: string, permitido: boolean): Record<string, unknown> {
  return { id, permisos: { recordatorios: permitido ? 'permitido' : 'preguntar' } };
}

export function borradorDe(p?: PersonaCirculo | null): BorradorPersona {
  return { nombre: p?.nombre || '', relacion: p?.relacion || 'otro', whatsapp: p?.canales.whatsapp || p?.canales.telefono || '' };
}
