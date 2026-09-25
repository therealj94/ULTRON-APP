/**
 * LA TRAZA DE UN TURNO — qué se preguntó, cómo se clasificó, qué agente contestó, qué herramientas
 * corrieron, qué documentos se consultaron, qué reglas intervinieron, qué modelo habló, cuánto tardó
 * y qué contestó.
 *
 * Es la respuesta a «¿de dónde salió esto?», que es lo primero que va a preguntar un cliente, un
 * auditor o la propia junta cuando una respuesta no cuadre. Y es la materia prima de la evaluación:
 * sin trazas no hay cómo saber si una versión nueva contesta mejor o peor que la anterior.
 *
 * Viaja con el turno por AsyncLocalStorage: cualquier pieza, por profunda que esté (el bucle de
 * herramientas, el motor de reglas, la llamada al modelo), puede anotar en la traza del turno en el
 * que corre sin que haya que pasarla de mano en mano por veinte firmas de función.
 *
 * Guardar la traza NUNCA frena ni rompe el turno: se escribe al cerrar, sin esperar, y si falla va
 * al log.
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import crypto from 'node:crypto';
import { anexar, leerTodas, paraTraza, reescribir, sql, tipo } from './base';

export type Paso = {
  herramienta: string;
  ok: boolean;
  ms?: number;
  resumen?: string;
  /** Los argumentos, ya tapados. Sirven para reproducir la llamada. */
  args?: Record<string, unknown>;
  ronda?: number;
};

export type DecisionRegistrada = {
  herramienta: string;
  veredicto: 'permitir' | 'bloquear' | 'revision';
  regla: string;
  motivo: string;
  aprobacion?: string;
};

export type Clasificacion = {
  tarea: string;
  riesgo: number;
  nivelRiesgo: 'bajo' | 'medio' | 'alto' | 'critico';
  requiereQwen: boolean;
  agente: string | null;
  revisionHumana: boolean;
  confianza: number;
  fuente: 'laya' | 'reglas';
  ms?: number;
  /** El mensaje parece un intento de torcer al sistema (ignorar reglas, sacar secretos, suplantar). */
  inyeccion?: boolean;
  /** En modo sombra: lo que decidió el otro clasificador, para comparar sin actuar. */
  sombra?: Omit<Clasificacion, 'sombra'> | null;
};

export type Traza = {
  id: string;
  t_inicio: string;
  t_fin: string | null;
  plataforma: string;
  canal: string | null;
  quien: string | null;
  nivel: string | null;
  pregunta: string;
  clasificacion: Clasificacion | null;
  agente: string | null;
  modelo: string | null;
  via: string | null;
  pasos: Paso[];
  documentos: Array<{ fuente: string; ref?: string; puntaje?: number }>;
  politica: DecisionRegistrada[];
  respuesta: string | null;
  emocion: string | null;
  ms: number | null;
  tokens_in: number | null;
  tokens_out: number | null;
  error: string | null;
  version: string | null;
  feedback: number | null;
  feedback_nota: string | null;
  feedback_de: string | null;
};

const almacenTurno = new AsyncLocalStorage<RegistroTurno>();

/** La traza del turno en curso, si hay uno. Las piezas profundas anotan aquí sin recibirla. */
export function trazaActual(): RegistroTurno | null {
  return almacenTurno.getStore() || null;
}

/** Corre `fn` dentro del turno: todo lo que se anote durante `fn` (y lo que ella espere) va a esta traza. */
export function enTurno<T>(reg: RegistroTurno, fn: () => T): T {
  return almacenTurno.run(reg, fn);
}

function version(): string | null {
  return String(process.env.RENDER_GIT_COMMIT || process.env.GIT_COMMIT || '').slice(0, 12) || null;
}

const MAX_PASOS = 60;

export class RegistroTurno {
  readonly t: Traza;
  private readonly t0 = Date.now();
  private cerrado = false;
  /** Se resuelve cuando la traza quedó guardada (o falló). Solo para pruebas y para cierres ordenados. */
  guardado: Promise<void> = Promise.resolve();

  constructor(o: { plataforma: string; canal?: string | null; quien?: string | null; nivel?: string | null; pregunta: string }) {
    this.t = {
      id: crypto.randomUUID(),
      t_inicio: new Date().toISOString(),
      t_fin: null,
      plataforma: o.plataforma,
      canal: o.canal ?? null,
      quien: o.quien ?? null,
      nivel: o.nivel ?? null,
      pregunta: paraTraza(o.pregunta),
      clasificacion: null,
      agente: null,
      modelo: null,
      via: null,
      pasos: [],
      documentos: [],
      politica: [],
      respuesta: null,
      emocion: null,
      ms: null,
      tokens_in: null,
      tokens_out: null,
      error: null,
      version: version(),
      feedback: null,
      feedback_nota: null,
      feedback_de: null,
    };
  }

  get id() {
    return this.t.id;
  }

  /** Quién resultó ser: se sabe después de abrir la traza (hace falta leer la sesión y el padrón). */
  identidad(quien: string | null, nivel: string | null) {
    this.t.quien = quien;
    this.t.nivel = nivel;
  }

  paso(p: Paso) {
    if (this.t.pasos.length >= MAX_PASOS) return;
    this.t.pasos.push({
      ...p,
      resumen: p.resumen ? paraTraza(p.resumen, 300) : undefined,
      args: p.args ? (taparValores(p.args) as Record<string, unknown>) : undefined,
    });
  }

  /** Nombres de herramientas sin detalle (AU-RA las corre antes de llamar al modelo). */
  herramientas(nombres: string[]) {
    const ya = new Set(this.t.pasos.map((p) => p.herramienta));
    for (const n of nombres) if (!ya.has(n)) this.paso({ herramienta: n, ok: true });
  }

  documento(d: { fuente: string; ref?: string; puntaje?: number }) {
    if (this.t.documentos.length < 40) this.t.documentos.push({ ...d, fuente: paraTraza(d.fuente, 200) });
  }

  politica(d: DecisionRegistrada) {
    if (this.t.politica.length < 40) this.t.politica.push({ ...d, motivo: paraTraza(d.motivo, 300) });
  }

  clasificacion(c: Clasificacion) {
    this.t.clasificacion = c;
    if (c.agente && !this.t.agente) this.t.agente = c.agente;
  }

  /** Lo que dijo el clasificador en sombra, que llega después (no se le espera). */
  sombraClasificacion(s: Clasificacion | null) {
    if (this.cerrado || !this.t.clasificacion) return;
    this.t.clasificacion = { ...this.t.clasificacion, sombra: s } as Clasificacion;
  }

  agente(nombre: string | null) {
    this.t.agente = nombre;
  }

  modelo(nombre: string | null, via?: string | null) {
    if (nombre) this.t.modelo = nombre;
    if (via) this.t.via = via;
  }

  /** Suma tokens de una llamada al modelo (un turno puede tener varias rondas). */
  tokens(entrada?: number | null, salida?: number | null) {
    if (Number.isFinite(entrada as number)) this.t.tokens_in = (this.t.tokens_in || 0) + Number(entrada);
    if (Number.isFinite(salida as number)) this.t.tokens_out = (this.t.tokens_out || 0) + Number(salida);
  }

  error(e: unknown) {
    this.t.error = paraTraza(e instanceof Error ? e.message : e, 500);
  }

  /**
   * Cierra y guarda. Se puede llamar una sola vez; las siguientes no hacen nada. No espera a que se
   * guarde: devuelve enseguida y deja la promesa en `guardado`.
   */
  cerrar(o: { respuesta?: string | null; emocion?: string | null; via?: string | null; modelo?: string | null; error?: unknown } = {}) {
    if (this.cerrado) return this.guardado;
    this.cerrado = true;
    if (o.respuesta !== undefined) this.t.respuesta = o.respuesta === null ? null : paraTraza(o.respuesta, 6000);
    if (o.emocion !== undefined) this.t.emocion = o.emocion;
    if (o.via) this.t.via = o.via;
    if (o.modelo) this.t.modelo = o.modelo;
    if (o.error) this.error(o.error);
    this.t.t_fin = new Date().toISOString();
    this.t.ms = Date.now() - this.t0;
    this.guardado = guardarTraza(this.t).catch((e) => console.error('[traza] no se guardó', this.t.id, String(e?.message || e).slice(0, 160)));
    return this.guardado;
  }
}

/** Tapa secretos y acorta cada valor, sin romper la forma del objeto (sirve para reproducir la llamada). */
export function taparValores(v: unknown, prof = 0): unknown {
  if (typeof v === 'string') return paraTraza(v, 400);
  if (v === null || typeof v !== 'object') return v;
  if (prof >= 3) return '[…]';
  if (Array.isArray(v)) return v.slice(0, 20).map((x) => taparValores(x, prof + 1));
  const out: Record<string, unknown> = {};
  for (const [k, x] of Object.entries(v as Record<string, unknown>).slice(0, 30)) {
    out[k] = /clave|password|secret|token|api.?key/i.test(k) ? '[SECRETO TAPADO]' : taparValores(x, prof + 1);
  }
  return out;
}

export function iniciarTraza(o: ConstructorParameters<typeof RegistroTurno>[0]) {
  return new RegistroTurno(o);
}

/* ------------------------------------------------------------------ guardar y leer */

async function guardarTraza(t: Traza) {
  if (tipo() === 'postgres') {
    await sql(
      `INSERT INTO cognitivo.traza_turno
        (id, t_inicio, t_fin, plataforma, canal, quien, nivel, pregunta, clasificacion, agente, modelo, via,
         pasos, documentos, politica, respuesta, emocion, ms, tokens_in, tokens_out, error, version)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22)
       ON CONFLICT (id) DO NOTHING`,
      [
        t.id, t.t_inicio, t.t_fin, t.plataforma, t.canal, t.quien, t.nivel, t.pregunta,
        t.clasificacion ? JSON.stringify(t.clasificacion) : null, t.agente, t.modelo, t.via,
        JSON.stringify(t.pasos), JSON.stringify(t.documentos), JSON.stringify(t.politica),
        t.respuesta, t.emocion, t.ms, t.tokens_in, t.tokens_out, t.error, t.version,
      ]
    );
    return;
  }
  anexar('trazas', t);
}

export type FiltroTrazas = { plataforma?: string; quien?: string; limite?: number; desde?: string; soloErrores?: boolean; conPolitica?: boolean };

export async function listarTrazas(f: FiltroTrazas = {}): Promise<Traza[]> {
  const limite = Math.min(Math.max(f.limite || 50, 1), 500);
  if (tipo() === 'postgres') {
    const filas = await sql<Traza>(
      `SELECT * FROM cognitivo.traza_turno
       WHERE ($1::text IS NULL OR plataforma = $1)
         AND ($2::text IS NULL OR quien = $2)
         AND ($3::timestamptz IS NULL OR t_inicio >= $3)
         AND (NOT $4 OR error IS NOT NULL)
         AND (NOT $5 OR jsonb_array_length(politica) > 0)
       ORDER BY t_inicio DESC LIMIT $6`,
      [f.plataforma || null, f.quien || null, f.desde || null, !!f.soloErrores, !!f.conPolitica, limite]
    );
    return filas.map(normalizarFila);
  }
  return leerTodas<Traza>('trazas')
    .filter(
      (t) =>
        (!f.plataforma || t.plataforma === f.plataforma) &&
        (!f.quien || t.quien === f.quien) &&
        (!f.desde || t.t_inicio >= f.desde) &&
        (!f.soloErrores || !!t.error) &&
        (!f.conPolitica || t.politica.length > 0)
    )
    .reverse()
    .slice(0, limite);
}

export async function trazaPorId(id: string): Promise<Traza | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  if (tipo() === 'postgres') {
    const [f] = await sql<Traza>(`SELECT * FROM cognitivo.traza_turno WHERE id = $1`, [id]);
    return f ? normalizarFila(f) : null;
  }
  return leerTodas<Traza>('trazas').find((t) => t.id === id) || null;
}

/**
 * La opinión de la persona sobre una respuesta: +1 sirvió, -1 no sirvió, con nota opcional.
 * Solo la persona que preguntó (o alguien con mando) la puede dejar: quien la da queda anotado.
 */
export async function darFeedback(id: string, valor: 1 | -1, nota: string | null, de: string | null): Promise<boolean> {
  const t = await trazaPorId(id);
  if (!t) return false;
  const limpia = nota ? paraTraza(nota, 600) : null;
  if (tipo() === 'postgres') {
    await sql(`UPDATE cognitivo.traza_turno SET feedback = $2, feedback_nota = $3, feedback_de = $4 WHERE id = $1`, [id, valor, limpia, de]);
    return true;
  }
  const todas = leerTodas<Traza>('trazas');
  const i = todas.findIndex((x) => x.id === id);
  if (i < 0) return false;
  todas[i] = { ...todas[i], feedback: valor, feedback_nota: limpia, feedback_de: de };
  reescribir('trazas', todas);
  return true;
}

/** Números para el panel: cuántos turnos, cuántos fallaron, latencia, lo que la gente marcó. */
export async function resumenTrazas(plataforma?: string, horas = 24 * 7) {
  const desde = new Date(Date.now() - horas * 3600_000).toISOString();
  const ts = await listarTrazas({ plataforma, desde, limite: 500 });
  const ms = ts.map((t) => t.ms || 0).filter(Boolean).sort((a, b) => a - b);
  const p = (q: number) => (ms.length ? ms[Math.min(ms.length - 1, Math.floor(q * ms.length))] : null);
  const porHerramienta: Record<string, { usos: number; fallos: number }> = {};
  for (const t of ts)
    for (const s of t.pasos) {
      const h = (porHerramienta[s.herramienta] ||= { usos: 0, fallos: 0 });
      h.usos++;
      if (!s.ok) h.fallos++;
    }
  return {
    desde,
    turnos: ts.length,
    errores: ts.filter((t) => t.error).length,
    bloqueos: ts.reduce((n, t) => n + t.politica.filter((d) => d.veredicto === 'bloquear').length, 0),
    revisiones: ts.reduce((n, t) => n + t.politica.filter((d) => d.veredicto === 'revision').length, 0),
    msP50: p(0.5),
    msP95: p(0.95),
    tokensIn: ts.reduce((n, t) => n + (t.tokens_in || 0), 0),
    tokensOut: ts.reduce((n, t) => n + (t.tokens_out || 0), 0),
    utiles: ts.filter((t) => t.feedback === 1).length,
    noUtiles: ts.filter((t) => t.feedback === -1).length,
    porHerramienta,
    porAgente: ts.reduce<Record<string, number>>((m, t) => ((m[t.agente || 'general'] = (m[t.agente || 'general'] || 0) + 1), m), {}),
  };
}

function normalizarFila(f: any): Traza {
  const iso = (v: any) => (v ? new Date(v).toISOString() : null);
  return { ...f, t_inicio: iso(f.t_inicio)!, t_fin: iso(f.t_fin), pasos: f.pasos || [], documentos: f.documentos || [], politica: f.politica || [] };
}
