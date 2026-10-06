/**
 * LA AUTORIDAD VIGENTE DE UNA CUENTA (SEC-04): ¿una sesión ya emitida sigue pudiendo leer datos privados o causar
 * efectos? Una sesión firmada vale hasta 14 días por sí sola; suspender la cuenta después NO la invalidaba (server/
 * seguridad.ts solo miraba firma, vencimiento, cierre y cambio de clave). Aquí, tres respuestas con su origen:
 *
 *  · `permitida`   — el registro de cuentas contestó «activa» hace menos de AUTORIDAD_VIVE_MS (permiso corto en
 *                    caché), o el despliegue declaró que no tiene registro de suspensiones (ver abajo).
 *  · `suspendida`  — el registro contestó «suspendida» (o la recarga periódica de cuentas la vio así). Queda anotada
 *                    hasta que el registro conteste otra cosa; mientras, ninguna sesión de esa cuenta vale.
 *  · `desconocida` — no se pudo saber ahora (el registro falló o tardó más del tope), o no hay registro y el
 *                    despliegue no dijo qué hacer. Falla CERRADO para lo privado: quien llama decide si la identidad
 *                    configurada en el despliegue (el padrón del entorno, no la base) puede seguir.
 *
 * POLÍTICA SIN REGISTRO (sin `CUENTAS_DB_URL` / `COGNITIVO_DB_URL` / `ELECTRUM_DB_URL`): «no configurado» NO es «no
 * suspendido». Se decide con `AURA_SUSPENSIONES`:
 *  · `ninguna`  — el despliegue declara que no tiene registro de suspensiones: toda sesión emitida vale hasta que vence
 *                 o se cierra (origen `sin_registro`). Se avisa al arrancar.
 *  · sin fijar  — en desarrollo (`AURA_DEV=1` / `NODE_ENV=test`) igual que `ninguna`, con aviso; en producción,
 *                 `desconocida` (falla cerrado para quien no está en el padrón del entorno).
 *  · `registro` — exige registro: sin URL, `desconocida` también en desarrollo.
 * Una caída transitoria del registro configurado es otra cosa: `desconocida` con origen `fallo`, nunca «permitida».
 *
 * PRESUPUESTO DE REVOCACIÓN: un «permitida» se reutiliza a lo más vigenciaPermiso() (30 s por omisión) en este proceso; pasado eso
 * se vuelve a preguntar. La recarga de cuentas (cada minuto) anota además toda suspensión que vea. Un fallo nunca
 * extiende un permiso viejo.
 */
import { modoDesarrollo } from '../lib/entorno';

export type Autoridad = 'permitida' | 'suspendida' | 'desconocida';
export type OrigenAutoridad = 'registro' | 'cache' | 'sin_registro' | 'sin_politica' | 'fallo';
export type ResultadoAutoridad = { estado: Autoridad; origen: OrigenAutoridad };

/** true = suspendida, false = activa (o sin cuenta). Lanza si no pudo saberlo. */
export type ConsultaSuspension = (correo: string) => Promise<boolean>;

export const AUTORIDAD_VIVE_MS = 30_000;
/**
 * El presupuesto de revocación de este despliegue: `AURA_AUTORIDAD_VIVE_MS` (0 a 300 000; por omisión 30 s). Más corto
 * = más consultas al registro; más largo = una suspensión tarda más en cortar una sesión viva.
 */
export function vigenciaPermiso(env: NodeJS.ProcessEnv = process.env): number {
  const v = Number(env.AURA_AUTORIDAD_VIVE_MS);
  return env.AURA_AUTORIDAD_VIVE_MS !== undefined && Number.isFinite(v) ? Math.min(300_000, Math.max(0, v)) : AUTORIDAD_VIVE_MS;
}
export const TOPE_AUTORIDAD_MS = 1500;

let consulta: ConsultaSuspension | null = null;
let hayRegistro: () => boolean = () => false;
/** Lo que fijó server/cuentas.ts (para volver a ello tras una prueba). */
let real: { consulta: ConsultaSuspension | null; hayRegistro: () => boolean } = { consulta: null, hayRegistro: () => false };
let tope = TOPE_AUTORIDAD_MS;

type Visto = { t: number; estado: 'permitida' | 'suspendida' } | { t: number; fallo: true };
const VISTO = new Map<string, Visto>();
const EN_CURSO = new Map<string, Promise<ResultadoAutoridad>>();

const normal = (c: string) => String(c || '').trim().toLowerCase();

/** server/cuentas.ts la fija al cargar: cómo preguntar y si hay registro configurado. */
export function fijarRegistroSuspension(fn: ConsultaSuspension, disponible: () => boolean) {
  consulta = fn;
  hayRegistro = disponible;
  real = { consulta: fn, hayRegistro: disponible };
}

export type PoliticaSinRegistro = 'ninguna' | 'cerrada';

/** Qué hacer cuando NO hay registro de cuentas configurado (ver arriba). */
export function politicaSinRegistro(env: NodeJS.ProcessEnv = process.env): PoliticaSinRegistro {
  const v = String(env.AURA_SUSPENSIONES || '').trim().toLowerCase();
  if (v === 'ninguna') return 'ninguna';
  if (v === 'registro') return 'cerrada';
  return modoDesarrollo(env) ? 'ninguna' : 'cerrada';
}

/** La línea del arranque: qué política rige (para el log y /api/health). */
export function describirPoliticaAutoridad(env: NodeJS.ProcessEnv = process.env): string {
  if (hayRegistro()) return 'registro de cuentas: se revisa la suspensión de cada sesión (permiso en caché 30 s; si el registro falla, solo el padrón del entorno)';
  return politicaSinRegistro(env) === 'ninguna'
    ? 'SIN registro de cuentas y AURA_SUSPENSIONES=ninguna (o desarrollo): las sesiones valen hasta vencer; no hay suspensiones que aplicar'
    : 'SIN registro de cuentas en producción y sin AURA_SUSPENSIONES: las sesiones de quien no está en el padrón del entorno NO leen datos privados ni causan efectos (falla cerrado). Configura CUENTAS_DB_URL o declara AURA_SUSPENSIONES=ninguna';
}

/** Lo que se sabe sin esperar (para los caminos síncronos: sesionDe, el pase de voz). */
export function autoridadSabida(correo: string, ahora = Date.now()): ResultadoAutoridad {
  const q = normal(correo);
  if (!hayRegistro()) return politicaSinRegistro() === 'ninguna' ? { estado: 'permitida', origen: 'sin_registro' } : { estado: 'desconocida', origen: 'sin_politica' };
  const v = VISTO.get(q);
  if (!v || 'fallo' in v) return { estado: 'desconocida', origen: 'fallo' };
  // Una suspensión vista no caduca sola: vale hasta que el registro diga otra cosa.
  if (v.estado === 'suspendida') return { estado: 'suspendida', origen: 'cache' };
  return ahora - v.t < vigenciaPermiso() ? { estado: 'permitida', origen: 'cache' } : { estado: 'desconocida', origen: 'fallo' };
}

/** ¿Se sabe que está suspendida? (sin esperar; lo desconocido NO cuenta como suspendida aquí). */
export function suspensionSabida(correo: string): boolean {
  const v = VISTO.get(normal(correo));
  return !!v && !('fallo' in v) && v.estado === 'suspendida';
}

/**
 * La autoridad, preguntando al registro si lo sabido ya no vale. Nunca lanza. Una sola consulta por correo a la vez.
 */
export function comprobarAutoridad(correo: string, ahora = Date.now()): Promise<ResultadoAutoridad> {
  const q = normal(correo);
  const sabida = autoridadSabida(q, ahora);
  if (!hayRegistro() || sabida.estado === 'permitida') return Promise.resolve(sabida);
  // Una suspensión reciente vale sin preguntar; una vieja se vuelve a preguntar (una reactivación entra en el mismo
  // presupuesto), y si el registro falla sigue suspendida.
  const v = VISTO.get(q);
  if (sabida.estado === 'suspendida' && v && ahora - v.t < vigenciaPermiso()) return Promise.resolve(sabida);
  const ya = EN_CURSO.get(q);
  if (ya) return ya;
  const p = preguntar(q).finally(() => EN_CURSO.delete(q));
  EN_CURSO.set(q, p);
  return p;
}

async function preguntar(q: string): Promise<ResultadoAutoridad> {
  let reloj: ReturnType<typeof setTimeout> | undefined;
  try {
    if (!consulta) throw new Error('sin consulta');
    const c = consulta;
    const limite = new Promise<'tope'>((ok) => {
      reloj = setTimeout(() => ok('tope'), tope);
      reloj.unref?.();
    });
    const si = await Promise.race([Promise.resolve().then(() => c(q)), limite]);
    if (si !== true && si !== false) throw new Error('sin respuesta a tiempo');
    anotar(q, si ? 'suspendida' : 'permitida');
    return { estado: si ? 'suspendida' : 'permitida', origen: 'registro' };
  } catch {
    // Un fallo NUNCA deja un permiso: borra el «permitida» que hubiera (una suspensión sabida se conserva).
    const v = VISTO.get(q);
    if (!(v && !('fallo' in v) && v.estado === 'suspendida')) VISTO.set(q, { t: Date.now(), fallo: true });
    return suspensionSabida(q) ? { estado: 'suspendida', origen: 'cache' } : { estado: 'desconocida', origen: 'fallo' };
  } finally {
    clearTimeout(reloj);
  }
}

function anotar(q: string, estado: 'permitida' | 'suspendida') {
  if (VISTO.size >= 20_000) for (const k of [...VISTO.keys()].slice(0, 5000)) VISTO.delete(k);
  VISTO.set(q, { t: Date.now(), estado });
}

/**
 * La recarga periódica de cuentas (server/cuentas.ts) anota lo que ve: una suspendida queda suspendida al instante en
 * este proceso (sin esperar a que esa sesión vuelva a pedir algo); una activa que estaba suspendida se olvida (la próxima
 * petición pregunta). No renueva permisos: el permiso corto solo sale de una consulta por petición.
 */
export function anotarEstadosDeCuentas(filas: Array<{ correo: string; estado: string }>) {
  for (const f of filas) {
    const q = normal(f.correo);
    if (!q) continue;
    if (f.estado === 'suspendida') anotar(q, 'suspendida');
    else if (suspensionSabida(q)) VISTO.delete(q);
  }
}

/** Solo pruebas. */
export function _autoridadDePrueba(o: { consulta?: ConsultaSuspension | null; registro?: boolean; topeMs?: number } | null) {
  VISTO.clear();
  EN_CURSO.clear();
  tope = TOPE_AUTORIDAD_MS;
  if (!o) {
    consulta = real.consulta;
    hayRegistro = real.hayRegistro;
    return;
  }
  if (o.consulta !== undefined) consulta = o.consulta;
  if (o.registro !== undefined) hayRegistro = () => !!o.registro;
  tope = o.topeMs ?? TOPE_AUTORIDAD_MS;
}
/** Solo pruebas: envejece lo sabido (como si pasara el tiempo). */
export function _envejecerAutoridad(ms: number) {
  for (const v of VISTO.values()) v.t -= ms;
}
