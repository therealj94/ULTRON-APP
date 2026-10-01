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
 * en el turno siguiente (`tareaTerminadaPara`) y la app lo puede mirar (`/api/computadora/...`).
 */
import crypto from 'node:crypto';
import { clave } from '../lib/boveda';

export type MotorNodo = 'holo' | 'claude';
export type PasoTarea = { n: number; t: number; accion: string; args?: Record<string, unknown>; ms?: number; miniatura?: string | null };
export type EstadoTarea = 'en_cola' | 'trabajando' | 'hecha' | 'parada' | 'sin_pasos' | 'fallo';
export type Tarea = {
  id: string;
  motor: MotorNodo;
  instruccion: string;
  estado: EstadoTarea;
  pasos: PasoTarea[];
  respuesta: string | null;
  error: string | null;
  segundos: number;
};

const TERMINADA = new Set<EstadoTarea>(['hecha', 'parada', 'sin_pasos', 'fallo']);
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
export function motorDelPerfil(motor: string | null | undefined): MotorNodo {
  return motor === 'pago' ? 'claude' : 'holo';
}

async function pedir(ruta: string, init: RequestInit & { ms?: number } = {}): Promise<any> {
  const c = conf();
  const r = await fetch(`${c.url}${ruta}`, {
    ...init,
    headers: { authorization: `Bearer ${c.clave}`, 'content-type': 'application/json', ...(init.headers || {}) },
    signal: init.signal ?? AbortSignal.timeout(init.ms ?? 15_000),
  });
  const texto = await r.text();
  let j: any = null;
  try {
    j = texto ? JSON.parse(texto) : null;
  } catch {
    j = null;
  }
  if (!r.ok) throw new Error(String(j?.detail || j?.error || texto || `HTTP ${r.status}`).slice(0, 200));
  return j;
}

/** ¿Contesta el nodo? Qué motores ofrece y si está ocupado. Para Ajustes y la salud del sistema. */
export async function estadoComputadora(): Promise<{ configurada: boolean; ok: boolean; motores: MotorNodo[]; ocupada: boolean; detalle?: string }> {
  if (!computadoraConfigurada()) return { configurada: false, ok: false, motores: [], ocupada: false, detalle: 'Falta COMPUTADORA_URL o COMPUTADORA_CLAVE.' };
  try {
    const j = await pedir('/salud', { ms: 8000 });
    return { configurada: true, ok: !!j?.ok, motores: Array.isArray(j?.motores) ? j.motores : [], ocupada: !!j?.ocupada };
  } catch (e: any) {
    return { configurada: true, ok: false, motores: [], ocupada: false, detalle: String(e?.message || e).slice(0, 160) };
  }
}

export async function verTarea(id: string, miniaturas = false, ms = 10_000, senal?: AbortSignal): Promise<Tarea> {
  const tope = AbortSignal.timeout(Math.max(1, ms));
  return pedir(`/tareas/${encodeURIComponent(id)}${miniaturas ? '?miniaturas=1' : ''}`, { signal: senal ? AbortSignal.any([senal, tope]) : tope });
}

export async function pararTarea(id: string): Promise<void> {
  await pedir(`/tareas/${encodeURIComponent(id)}/parar`, { method: 'POST', ms: 8000 });
}

export async function pantallaComputadora(): Promise<Buffer> {
  const c = conf();
  const r = await fetch(`${c.url}/pantalla`, { headers: { authorization: `Bearer ${c.clave}` }, signal: AbortSignal.timeout(15_000) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return Buffer.from(await r.arrayBuffer());
}

/* ------------------------------------------------------------------ de quién es cada tarea */

type Encargo = { id: string; quien: string; instruccion: string; creada: number; terminada?: Tarea; avisada?: boolean };
const ENCARGOS = new Map<string, Encargo>();
/** La última tarea de cada persona (para la app). */
const ULTIMA = new Map<string, string>();
/**
 * Las tareas de cada persona que siguieron después de que su turno dejó de esperar y que todavía no se
 * le contaron. Todas: una segunda tarea no tapa a la primera.
 */
const PENDIENTES = new Map<string, Set<string>>();

export function duenoDe(id: string): string | null {
  return ENCARGOS.get(id)?.quien ?? null;
}

export function ultimaTareaDe(quien: string): string | null {
  return ULTIMA.get(quien) ?? null;
}

export function pendientesDe(quien: string): string[] {
  return [...(PENDIENTES.get(quien) ?? [])];
}

/**
 * Lo que terminó después de que el turno dejó de esperar y todavía no se le dijo: va como HECHO en el
 * turno siguiente de esa persona. Solo se mira: se da por dicho con `confirmarAvisos` cuando el modelo
 * de verdad contestó con esos hechos (un «hola» que contesta el banco o el modelo chico no los lleva).
 */
export function avisosPendientes(quien: string): { ids: string[]; hecho: string } | null {
  const listas = pendientesDe(quien)
    .map((id) => ENCARGOS.get(id))
    .filter((e): e is Encargo => !!e?.terminada && !e.avisada);
  if (!listas.length) return null;
  const partes = listas.map((e) => `«${e.instruccion.slice(0, 160)}»: ${resumenTarea(e.terminada!)}`);
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

function seguirEnSegundoPlano(e: Encargo) {
  if (!PENDIENTES.has(e.quien)) PENDIENTES.set(e.quien, new Set());
  PENDIENTES.get(e.quien)!.add(e.id);
  const hasta = e.creada + SEGUIR_MAX_MS;
  const vuelta = async () => {
    if (Date.now() > hasta) return;
    try {
      const t = await verTarea(e.id);
      if (TERMINADA.has(t.estado)) {
        e.terminada = t;
        return;
      }
    } catch {
      /* el nodo no contestó esta vez: se vuelve a probar */
    }
    setTimeout(vuelta, 5000).unref?.();
  };
  setTimeout(vuelta, 5000).unref?.();
}

/** El resultado contado para el modelo: qué pasó, en cuántos pasos, y la respuesta tal cual. */
export function resumenTarea(t: Tarea): string {
  const pasos = t.pasos.filter((p) => p.accion !== 'answer' && p.accion !== 'escritorio_limpio').length;
  if (t.estado === 'hecha') return `Hecha en ${pasos} pasos (${Math.round(t.segundos)} s). Lo que encontró o hizo: ${String(t.respuesta || '').slice(0, 1500)}`;
  if (t.estado === 'parada') return 'La pararon antes de terminar.';
  if (t.estado === 'sin_pasos') return `No la terminó en ${pasos} pasos. ${t.error || ''}`.trim();
  return `Falló: ${t.error || 'sin detalle'}.`;
}

/**
 * Encarga una tarea y espera hasta `esperaMs`. Si termina, el HECHO lleva el resultado; si no, dice que
 * sigue (y en qué paso va) y la tarea se sigue mirando para avisar después.
 */
export async function encargarTarea(o: {
  instruccion: string;
  quien: string;
  motor: MotorNodo;
  esperaMs: number;
  senal?: AbortSignal;
  maxPasos?: number;
}): Promise<{ hecho: string; id: string | null; tarea: Tarea | null }> {
  if (!computadoraConfigurada()) {
    return { hecho: 'HARNESS computadora: no está configurada en este servidor. No la usé; dilo con naturalidad.', id: null, tarea: null };
  }
  let creada: { id: string };
  let nota = '';
  const encargar = (motor: MotorNodo) =>
    pedir('/tareas', { method: 'POST', body: JSON.stringify({ instruccion: o.instruccion, motor, max_pasos: o.maxPasos ?? 25, dueno: huellaDe(o.quien) }) });
  try {
    try {
      creada = await encargar(o.motor);
    } catch (e: any) {
      // Eligió Claude en Ajustes pero el nodo no tiene su clave: la hace la gratis, y se dice.
      if (o.motor !== 'claude' || !/claude/i.test(String(e?.message || ''))) throw e;
      creada = await encargar('holo');
      nota = ' (La hizo el modelo gratis: Claude no está configurado en la computadora.)';
    }
  } catch (e: any) {
    return { hecho: `HARNESS computadora: no pude encargarla (${String(e?.message || e).slice(0, 120)}). No inventes el resultado.`, id: null, tarea: null };
  }
  const e: Encargo = { id: creada.id, quien: o.quien, instruccion: o.instruccion, creada: Date.now() };
  ENCARGOS.set(e.id, e);
  ULTIMA.set(o.quien, e.id);
  const hasta = Date.now() + Math.max(0, o.esperaMs);
  let t: Tarea | null = null;
  // El plazo es de verdad: ni la pausa ni la consulta se pasan de lo que queda (ni de la interrupción).
  while (Date.now() < hasta && !o.senal?.aborted) {
    await esperar(Math.min(SONDEO_MS, hasta - Date.now()), o.senal);
    const queda = hasta - Date.now();
    if (queda <= 0 || o.senal?.aborted) break;
    try {
      t = await verTarea(e.id, false, Math.min(10_000, queda), o.senal);
    } catch {
      continue;
    }
    if (TERMINADA.has(t.estado)) {
      e.terminada = t;
      e.avisada = true;
      return { hecho: `HARNESS computadora «${o.instruccion.slice(0, 160)}»: ${resumenTarea(t)}${nota}`, id: e.id, tarea: t };
    }
  }
  seguirEnSegundoPlano(e);
  const ultimo = t?.pasos?.[t.pasos.length - 1];
  const vaEn = ultimo ? ` Va en el paso ${ultimo.n} (${ultimo.accion}).` : '';
  return {
    hecho:
      `HARNESS computadora «${o.instruccion.slice(0, 160)}»: la tarea sigue en tu computadora.${vaEn}${nota} ` +
      'Di que ya la estás haciendo en tu computadora y que le cuentas en cuanto termine. No inventes el resultado.',
    id: e.id,
    tarea: t,
  };
}

function esperar(ms: number, senal?: AbortSignal): Promise<void> {
  return new Promise((r) => {
    if (ms <= 0 || senal?.aborted) return r();
    const t = setTimeout(r, ms);
    senal?.addEventListener('abort', () => (clearTimeout(t), r()), { once: true });
  });
}

/** Pruebas: olvidar los encargos. */
export function _olvidarEncargos() {
  ENCARGOS.clear();
  ULTIMA.clear();
  PENDIENTES.clear();
}

/* ------------------------------------------------------------------ rutas para la app y la web */

type DepsRutas = {
  exigirMesa: import('express').RequestHandler;
  limitar: (max: number, ventanaMs?: number, grupo?: string) => import('express').RequestHandler;
  sesionDe: (req: import('express').Request) => { correo: string } | null;
};

/**
 * Lo que la app muestra de su computadora: si está, qué motores ofrece, su última tarea con las
 * capturas de cada paso, y el botón de pararla. Cada quien ve solo sus tareas.
 *   GET  /api/computadora            → { configurada, ok, motores, ocupada, ultima }
 *   GET  /api/computadora/tareas/:id → la tarea con miniaturas (si es suya)
 *   POST /api/computadora/tareas/:id/parar
 */
export function montarRutasComputadora(app: import('express').Express, d: DepsRutas) {
  const correoDe = (req: import('express').Request) => String(d.sesionDe(req)?.correo || '').toLowerCase();
  const sinSesion = (res: import('express').Response) => res.status(401).json({ error: 'Entra con tu sesión.', code: 'sesion_requerida', honesto: true });

  app.get('/api/computadora', d.exigirMesa, d.limitar(30), async (req, res) => {
    const correo = correoDe(req);
    if (!correo) return sinSesion(res);
    const estado = await estadoComputadora();
    res.setHeader('Cache-Control', 'no-store');
    return res.json({ ...estado, ultima: ultimaTareaDe(correo), pendientes: pendientesDe(correo), honesto: true });
  });

  app.get('/api/computadora/tareas/:id', d.exigirMesa, d.limitar(60), async (req, res) => {
    const correo = correoDe(req);
    if (!correo) return sinSesion(res);
    if (duenoDe(req.params.id) !== correo) return res.status(404).json({ error: 'No encuentro esa tarea.', honesto: true });
    try {
      res.setHeader('Cache-Control', 'no-store');
      return res.json({ tarea: await verTarea(req.params.id, true), honesto: true });
    } catch (e: any) {
      return res.status(502).json({ error: `La computadora no contestó (${String(e?.message || e).slice(0, 80)}).`, honesto: true });
    }
  });

  app.post('/api/computadora/tareas/:id/parar', d.exigirMesa, d.limitar(20), async (req, res) => {
    const correo = correoDe(req);
    if (!correo) return sinSesion(res);
    if (duenoDe(req.params.id) !== correo) return res.status(404).json({ error: 'No encuentro esa tarea.', honesto: true });
    try {
      await pararTarea(req.params.id);
      return res.json({ ok: true, honesto: true });
    } catch (e: any) {
      return res.status(502).json({ error: `No pude pararla (${String(e?.message || e).slice(0, 80)}).`, honesto: true });
    }
  });
}
