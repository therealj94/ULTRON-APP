/**
 * LA COLA DE APROBACIONES — lo que una regla mandó a revisión humana.
 *
 * Lo que entra aquí queda CONGELADO: herramienta, argumentos y una huella (sha256) de las dos cosas.
 * Lo que se aprueba es exactamente eso, y lo ejecuta el SERVIDOR cuando se completan las firmas; el
 * modelo no vuelve a intervenir. Así no puede pasar que se apruebe «mandar el informe a Carlos» y el
 * modelo, en la segunda vuelta, lo mande a otro.
 *
 * Reglas de la firma:
 *  · Firma quien tiene mando en esa plataforma, con identidad verificada.
 *  · Quien pidió la acción no firma la suya (cuatro ojos).
 *  · Una sola negativa la rechaza. Hacen falta `necesarias` positivas para aprobarla.
 *  · Vence a las 24 h (APROBACION_HORAS) sin tocarse.
 *  · Antes de ejecutar se vuelven a pasar las reglas, ya con las firmas: si entre tanto el KYC dejó
 *    de estar aprobado, no se ejecuta aunque la junta haya firmado.
 *
 * Cada paso queda en la cadena de auditoría.
 */
import crypto from 'node:crypto';
import type { Nivel, Plataforma } from '../acceso';
import { canonico, auditar } from './auditoria';
import { enTransaccion, leerTodas, reescribir, sql, tipo } from './base';
import { taparValores } from './traza';
import type { Efecto } from './politica';

export type EstadoAprobacion = 'pendiente' | 'aprobada' | 'rechazada' | 'vencida' | 'ejecutada' | 'fallida';

export type Firma = { quien: string; decision: 'aprobar' | 'rechazar'; t: string; nota?: string | null };

export type Aprobacion = {
  id: string;
  creada: string;
  vence: string;
  plataforma: Plataforma;
  herramienta: string;
  efecto: Efecto;
  argumentos: Record<string, unknown>;
  huella: string;
  pedida_por: string | null;
  regla: string;
  motivo: string;
  riesgo: number | null;
  necesarias: number;
  estado: EstadoAprobacion;
  firmas: Firma[];
  resultado: { ok: boolean; texto: string; t: string } | null;
  traza_id: string | null;
  contexto: { destino?: string | null; hechos?: unknown } | null;
};

export type Ejecutor = (args: Record<string, unknown>, ap: Aprobacion) => Promise<{ ok: boolean; texto: string }>;

const ejecutores = new Map<string, Ejecutor>();
/** Quien sabe hacer la acción, registrado al arrancar (el taller, las manos de Electrum...). */
export function registrarEjecutor(herramienta: string, fn: Ejecutor) {
  ejecutores.set(herramienta, fn);
}
/**
 * Quien sabe traer los hechos FRESCOS de una acción (KYC, firmas de la junta) al momento de
 * ejecutarla. Sin fuente registrada se usan los que se guardaron al pedirla, y eso se dice.
 */
type FuenteHechos = (args: Record<string, unknown>) => Promise<unknown>;
const fuentesHechos = new Map<string, FuenteHechos>();
export function registrarFuenteDeHechos(herramienta: string, fn: FuenteHechos) {
  fuentesHechos.set(herramienta, fn);
}

export function hayEjecutor(herramienta: string) {
  return ejecutores.has(herramienta);
}

type Aviso = (ap: Aprobacion, que: 'creada' | 'aprobada' | 'rechazada' | 'ejecutada' | 'fallida') => Promise<void> | void;
const avisos: Aviso[] = [];
/** A quién se le avisa (Telegram de la junta, por ejemplo). Un aviso que falla no frena nada. */
export function alAvisar(fn: Aviso) {
  avisos.push(fn);
}
async function avisar(ap: Aprobacion, que: Parameters<Aviso>[1]) {
  for (const f of avisos) {
    try {
      await f(ap, que);
    } catch (e: any) {
      console.error('[aprobaciones] aviso falló:', String(e?.message || e).slice(0, 120));
    }
  }
}

function horas(): number {
  const h = Number(process.env.APROBACION_HORAS || 24);
  return Number.isFinite(h) && h > 0 ? h : 24;
}

export function huellaDe(plataforma: string, herramienta: string, args: Record<string, unknown>) {
  return crypto.createHash('sha256').update(canonico({ plataforma, herramienta, args })).digest('hex');
}

/* ------------------------------------------------------------------ almacén */

function desdeFila(f: any): Aprobacion {
  const iso = (v: any) => (v ? new Date(v).toISOString() : v);
  return { ...f, creada: iso(f.creada), vence: iso(f.vence), riesgo: f.riesgo ?? null, necesarias: Number(f.necesarias), firmas: f.firmas || [], contexto: f.contexto || null };
}

async function guardarNueva(ap: Aprobacion) {
  if (tipo() === 'postgres') {
    await sql(
      `INSERT INTO cognitivo.aprobacion (id, creada, vence, plataforma, herramienta, efecto, argumentos, huella, pedida_por, regla, motivo, riesgo, necesarias, estado, firmas, traza_id, contexto)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`,
      [ap.id, ap.creada, ap.vence, ap.plataforma, ap.herramienta, ap.efecto, JSON.stringify(ap.argumentos), ap.huella, ap.pedida_por, ap.regla, ap.motivo, ap.riesgo, ap.necesarias, ap.estado, JSON.stringify(ap.firmas), ap.traza_id, JSON.stringify(ap.contexto)]
    );
    return;
  }
  reescribir('aprobaciones', [...leerTodas<Aprobacion>('aprobaciones'), ap]);
}

/** Cambia una aprobación de forma atómica: lee, aplica `fn` y guarda, sin que otro firme en medio. */
async function modificar(id: string, fn: (ap: Aprobacion) => Aprobacion | null): Promise<Aprobacion | null> {
  if (tipo() === 'postgres') {
    return enTransaccion(async (q) => {
      const [f] = await q(`SELECT * FROM cognitivo.aprobacion WHERE id = $1 FOR UPDATE`, [id]);
      if (!f) return null;
      const nueva = fn(desdeFila(f));
      if (!nueva) return desdeFila(f);
      await q(`UPDATE cognitivo.aprobacion SET estado = $2, firmas = $3, resultado = $4 WHERE id = $1`, [id, nueva.estado, JSON.stringify(nueva.firmas), nueva.resultado ? JSON.stringify(nueva.resultado) : null]);
      return nueva;
    });
  }
  const todas = leerTodas<Aprobacion>('aprobaciones');
  const i = todas.findIndex((a) => a.id === id);
  if (i < 0) return null;
  const nueva = fn(todas[i]);
  if (!nueva) return todas[i];
  todas[i] = nueva;
  reescribir('aprobaciones', todas);
  return nueva;
}

/* ------------------------------------------------------------------ ciclo */

export async function crearAprobacion(o: {
  plataforma: Plataforma;
  herramienta: string;
  efecto: Efecto;
  args: Record<string, unknown>;
  pedidaPor: string | null;
  regla: string;
  motivo: string;
  riesgo: number | null;
  necesarias: number;
  trazaId: string | null;
  destino?: string | null;
  hechos?: unknown;
}): Promise<Aprobacion | null> {
  const ahora = Date.now();
  const ap: Aprobacion = {
    id: crypto.randomUUID(),
    creada: new Date(ahora).toISOString(),
    vence: new Date(ahora + horas() * 3600_000).toISOString(),
    plataforma: o.plataforma,
    herramienta: o.herramienta,
    efecto: o.efecto,
    argumentos: o.args,
    huella: huellaDe(o.plataforma, o.herramienta, o.args),
    pedida_por: o.pedidaPor,
    regla: o.regla,
    motivo: o.motivo,
    riesgo: o.riesgo,
    // Sin solicitante verificado no hay «cuatro ojos» posible: quien la pidió escribiendo un nombre
    // podría firmarla él mismo con su sesión. Entonces hacen falta dos personas distintas.
    necesarias: Math.max(o.pedidaPor ? 1 : 2, Math.min(5, o.necesarias || 1)),
    estado: 'pendiente',
    firmas: [],
    resultado: null,
    traza_id: o.trazaId,
    contexto: { destino: o.destino ?? null, hechos: o.hechos ?? null },
  };
  try {
    // La misma acción pedida dos veces seguidas no abre dos solicitudes: se devuelve la que ya espera.
    const ya = (await listarAprobaciones({ plataforma: o.plataforma, estado: 'pendiente', limite: 200 })).find((x) => x.huella === ap.huella);
    if (ya) return ya;
    await guardarNueva(ap);
  } catch (e: any) {
    console.error('[aprobaciones] no pude encolar:', String(e?.message || e).slice(0, 160));
    return null;
  }
  await auditar({
    tipo: 'aprobacion.creada',
    plataforma: ap.plataforma,
    quien: ap.pedida_por,
    datos: { id: ap.id, herramienta: ap.herramienta, huella: ap.huella, regla: ap.regla, necesarias: ap.necesarias, argumentos: taparValores(ap.argumentos) as any },
  });
  await avisar(ap, 'creada');
  return ap;
}

/** Marca como vencidas las que pasaron su plazo. Se llama al leer: no hace falta un reloj aparte. */
async function vencer(aps: Aprobacion[]): Promise<Aprobacion[]> {
  const ahora = new Date().toISOString();
  const out: Aprobacion[] = [];
  for (const ap of aps) {
    if (ap.estado === 'pendiente' && ap.vence < ahora) {
      const v = await modificar(ap.id, (x) => (x.estado === 'pendiente' ? { ...x, estado: 'vencida' } : null));
      if (v?.estado === 'vencida') await auditar({ tipo: 'aprobacion.vencida', plataforma: v.plataforma, quien: null, datos: { id: v.id, herramienta: v.herramienta } });
      out.push(v || ap);
    } else out.push(ap);
  }
  return out;
}

export async function listarAprobaciones(f: { plataforma?: Plataforma; estado?: EstadoAprobacion; limite?: number } = {}): Promise<Aprobacion[]> {
  const limite = Math.min(Math.max(f.limite || 50, 1), 500);
  let filas: Aprobacion[];
  if (tipo() === 'postgres') {
    filas = (
      await sql(
        `SELECT * FROM cognitivo.aprobacion WHERE ($1::text IS NULL OR plataforma = $1) AND ($2::text IS NULL OR estado = $2) ORDER BY creada DESC LIMIT $3`,
        [f.plataforma || null, f.estado || null, limite]
      )
    ).map(desdeFila);
  } else {
    filas = leerTodas<Aprobacion>('aprobaciones')
      .filter((a) => (!f.plataforma || a.plataforma === f.plataforma) && (!f.estado || a.estado === f.estado))
      .reverse()
      .slice(0, limite);
  }
  const vivas = await vencer(filas);
  return f.estado ? vivas.filter((a) => a.estado === f.estado) : vivas;
}

export async function aprobacionPorId(id: string): Promise<Aprobacion | null> {
  // Se acepta el id corto (8 caracteres) que va en los avisos de Telegram.
  if (!/^[0-9a-f-]{8,36}$/i.test(id)) return null;
  const todas = await listarAprobaciones({ limite: 500 });
  const hallada = todas.filter((a) => a.id === id || a.id.startsWith(id.toLowerCase()));
  return hallada.length === 1 ? hallada[0] : null;
}

export type ResultadoFirma = { ok: boolean; motivo: string; aprobacion?: Aprobacion };

/**
 * Firma una solicitud. Si con esta firma se completan las necesarias, se EJECUTA en el acto con los
 * argumentos congelados — pasando otra vez por las reglas — y se devuelve el resultado.
 */
export async function firmar(o: { id: string; quien: string | null; nivel: Nivel | null; plataforma: Plataforma; decision: 'aprobar' | 'rechazar'; nota?: string | null }): Promise<ResultadoFirma> {
  if (!o.quien || o.nivel !== 'mando') return { ok: false, motivo: 'Solo firma quien tiene mando en esta plataforma, con su sesión o su Telegram.' };
  const actual = await aprobacionPorId(o.id);
  if (!actual || actual.plataforma !== o.plataforma) return { ok: false, motivo: 'No encuentro esa solicitud.' };

  let motivo = '';
  const nueva = await modificar(actual.id, (ap) => {
    if (ap.estado !== 'pendiente') {
      motivo = `La solicitud ya está ${ap.estado}.`;
      return null;
    }
    if (ap.vence < new Date().toISOString()) {
      motivo = 'La solicitud venció.';
      return { ...ap, estado: 'vencida' };
    }
    if (ap.pedida_por && ap.pedida_por === o.quien) {
      motivo = 'Quien pidió la acción no puede aprobarla: hace falta otra persona.';
      return null;
    }
    if (ap.firmas.some((f) => f.quien === o.quien)) {
      motivo = 'Ya firmaste esta solicitud.';
      return null;
    }
    const firmas = [...ap.firmas, { quien: o.quien!, decision: o.decision, t: new Date().toISOString(), nota: o.nota ?? null }];
    const positivas = firmas.filter((f) => f.decision === 'aprobar').length;
    const estado: EstadoAprobacion = o.decision === 'rechazar' ? 'rechazada' : positivas >= ap.necesarias ? 'aprobada' : 'pendiente';
    return { ...ap, firmas, estado };
  });
  if (!nueva) return { ok: false, motivo: 'No encuentro esa solicitud.' };
  if (motivo) return { ok: false, motivo, aprobacion: nueva };

  await auditar({ tipo: 'aprobacion.firmada', plataforma: nueva.plataforma, quien: o.quien, datos: { id: nueva.id, decision: o.decision, huella: nueva.huella, nota: o.nota ?? null } });

  if (nueva.estado === 'rechazada') {
    await auditar({ tipo: 'aprobacion.rechazada', plataforma: nueva.plataforma, quien: o.quien, datos: { id: nueva.id, herramienta: nueva.herramienta } });
    await avisar(nueva, 'rechazada');
    return { ok: true, motivo: 'Rechazada. No se hará.', aprobacion: nueva };
  }
  if (nueva.estado === 'pendiente') {
    const faltan = nueva.necesarias - nueva.firmas.filter((f) => f.decision === 'aprobar').length;
    return { ok: true, motivo: `Firmada. Falta${faltan === 1 ? '' : 'n'} ${faltan} firma${faltan === 1 ? '' : 's'} más.`, aprobacion: nueva };
  }

  await auditar({ tipo: 'aprobacion.aprobada', plataforma: nueva.plataforma, quien: o.quien, datos: { id: nueva.id, herramienta: nueva.herramienta, firmas: nueva.firmas.map((f) => f.quien) } });
  await avisar(nueva, 'aprobada');
  const ejecutada = await ejecutarAprobada(nueva);
  return { ok: true, motivo: ejecutada.resultado?.ok ? `Aprobada y hecha: ${ejecutada.resultado.texto}` : `Aprobada, pero no se pudo hacer: ${ejecutada.resultado?.texto}`, aprobacion: ejecutada };
}

async function ejecutarAprobada(ap: Aprobacion): Promise<Aprobacion> {
  // La huella tiene que seguir cuadrando: si alguien tocó los argumentos en la base, no se ejecuta.
  if (huellaDe(ap.plataforma, ap.herramienta, ap.argumentos) !== ap.huella) {
    return terminar(ap, false, 'Los argumentos no coinciden con lo que se aprobó (la huella cambió). No ejecuto.');
  }
  const { evaluar } = await import('./politica');
  const fuente = fuentesHechos.get(ap.herramienta);
  let hechosFrescos: unknown = null;
  if (fuente) {
    try {
      hechosFrescos = await fuente(ap.argumentos);
    } catch (e: any) {
      return terminar(ap, false, `No pude comprobar los datos al momento de ejecutar (${String(e?.message || e).slice(0, 120)}). No ejecuto a ciegas.`);
    }
  }
  const firmantes = ap.firmas.filter((f) => f.decision === 'aprobar').map((f) => f.quien);
  const { personaPorId, nivelDe } = await import('../acceso');
  const persona = personaPorId(ap.pedida_por);
  const d = evaluar({
    herramienta: ap.herramienta,
    efecto: ap.efecto,
    plataforma: ap.plataforma,
    args: ap.argumentos,
    quien: ap.pedida_por,
    nivel: persona ? nivelDe(persona, ap.plataforma) : null,
    prueba: 'sesion',
    riesgo: ap.riesgo,
    destino: (ap.contexto?.destino as any) ?? null,
    hechos: (hechosFrescos ?? ap.contexto?.hechos ?? undefined) as any,
    aprobada: { id: ap.id, firmas: firmantes },
  });
  // Solo `permitir` ejecuta. Si una regla todavía pide revisión (faltan firmas de junta, por
  // ejemplo), aprobar esta solicitud no alcanza.
  if (d.veredicto !== 'permitir') return terminar(ap, false, `Aprobada, pero ahora una regla lo impide (${d.regla}): ${d.motivo}`);
  const fn = ejecutores.get(ap.herramienta);
  if (!fn) return terminar(ap, false, `No hay quien ejecute «${ap.herramienta}» en este servidor.`);
  try {
    const r = await fn(ap.argumentos, ap);
    return terminar(ap, r.ok, r.texto);
  } catch (e: any) {
    return terminar(ap, false, `Falló al ejecutar: ${String(e?.message || e).slice(0, 200)}`);
  }
}

async function terminar(ap: Aprobacion, ok: boolean, texto: string): Promise<Aprobacion> {
  const resultado = { ok, texto: String(texto).slice(0, 1000), t: new Date().toISOString() };
  const fin = (await modificar(ap.id, (x) => ({ ...x, estado: ok ? 'ejecutada' : 'fallida', resultado }))) || { ...ap, estado: ok ? 'ejecutada' : 'fallida', resultado };
  await auditar({ tipo: 'aprobacion.ejecutada', plataforma: ap.plataforma, quien: null, datos: { id: ap.id, herramienta: ap.herramienta, ok, texto: resultado.texto } });
  await avisar(fin, ok ? 'ejecutada' : 'fallida');
  return fin;
}

/** Texto corto para un aviso de Telegram. */
export function resumenParaAviso(ap: Aprobacion, que: string): string {
  const corto = ap.id.slice(0, 8);
  const args = JSON.stringify(taparValores(ap.argumentos)).slice(0, 300);
  if (que === 'creada')
    return `🔐 Solicitud ${corto} (${ap.plataforma}): «${ap.herramienta}» pedida por ${ap.pedida_por || 'sin identificar'}.\nMotivo: ${ap.motivo}\nArgumentos: ${args}\nFirmas necesarias: ${ap.necesarias}. Responde /aprobar ${corto} o /rechazar ${corto}.`;
  if (que === 'ejecutada' || que === 'fallida') return `${que === 'ejecutada' ? '✅' : '⚠️'} Solicitud ${corto}: ${ap.resultado?.texto || que}`;
  return `Solicitud ${corto}: ${que}.`;
}

/**
 * Los comandos de Telegram para firmar desde el teléfono: `/aprobar <id> [nota]`,
 * `/rechazar <id> [nota]` y `/solicitudes`. La identidad es la del Telegram comprobado contra el
 * padrón; el nivel, el de esa persona en la plataforma. Devuelve null si no es uno de estos
 * comandos, para que el mensaje siga su camino normal.
 */
export async function comandoDeAprobacion(o: {
  comando?: string;
  texto: string;
  quien: string | null;
  nivel: Nivel | null;
  plataforma: Plataforma;
}): Promise<string | null> {
  const c = o.comando;
  if (c !== '/aprobar' && c !== '/rechazar' && c !== '/solicitudes') return null;
  if (o.nivel !== 'mando' || !o.quien) return 'Las solicitudes las firma solo quien tiene mando, desde su propio Telegram.';
  if (c === '/solicitudes') {
    const pend = await listarAprobaciones({ plataforma: o.plataforma, estado: 'pendiente', limite: 10 });
    if (!pend.length) return 'No hay solicitudes esperando firma.';
    return pend
      .map((a) => `${a.id.slice(0, 8)} · «${a.herramienta}» de ${a.pedida_por || '?'} · ${a.firmas.filter((f) => f.decision === 'aprobar').length}/${a.necesarias} · ${a.motivo}`)
      .join('\n');
  }
  const [, id = '', ...resto] = o.texto.trim().split(/\s+/);
  if (!id) return `Falta el número de la solicitud: ${c} <id>.`;
  const r = await firmar({ id, quien: o.quien, nivel: o.nivel, plataforma: o.plataforma, decision: c === '/aprobar' ? 'aprobar' : 'rechazar', nota: resto.join(' ') || null });
  return r.motivo;
}
