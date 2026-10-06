/**
 * BORRAR BIOMETRÍA DE VERDAD (SEC-03): lápidas, versión y precedencia de la supresión para los cajones de caras
 * (lib/caras-miembro.ts) y voces (lib/voces-miembro.ts).
 *
 * El defecto: al olvidar una cara o una voz, S3 aceptaba el cajón nuevo pero la escritura LOCAL fallaba (disco lleno,
 * sin permiso…) y se tragaba el error: la operación resolvía «ok». Tras un reinicio (o con la caché vacía) se leía
 * primero el disco —la copia vieja, con la persona— y la persona borrada VOLVÍA.
 *
 * Ahora:
 *  · cada cajón lleva `rev` (sube en cada cambio) y `lapidas` (los ids olvidados, con su hora) y `borradoTodo` (la hora
 *    de «olvida todas»): son solo ids y horas, nada biométrico;
 *  · al leer con S3 configurado se leen LAS DOS copias (disco y S3) y gana la de `rev` más alta; las lápidas de
 *    cualquiera de las dos se aplican siempre (una copia vieja, un respaldo restaurado o un disco que no se pudo
 *    escribir nunca resucitan a nadie). Si S3 no contesta, no se expone el disco solo: no se sabe si es viejo (falla
 *    cerrado, «no disponible»);
 *  · al escribir, si el disco falla se intenta QUITAR la copia local vieja; si tampoco se puede, el borrado queda
 *    `degradado` (S3 ya no la tiene, la copia local sí) y se dice así, sin afirmar supresión completa. Sin S3 (solo
 *    disco), una escritura local fallida es un borrado que NO ocurrió: error, como cuando S3 no guarda;
 *  · al arrancar no hace falta nada aparte: la primera lectura de cada cuenta ya aplica la precedencia antes de
 *    devolver nada (y repara la copia atrasada).
 * Lo que no se promete: borrar al instante respaldos inmutables fuera de este servicio.
 */
import fs from 'node:fs';

export type Lapida = { id: string; t: number };
export type Durable = { rev?: number; lapidas?: Lapida[]; borradoTodo?: number };
type ConPersonas<P> = Durable & { personas: P[] };

/** Cuántas lápidas se guardan (las más nuevas). Son ids al azar: con esto alcanza de sobra. */
export const MAX_LAPIDAS = 500;

/** Lo durable de un JSON leído (rev, lápidas, borradoTodo), saneado. */
export function sanearDurable(x: any): Required<Pick<Durable, 'rev' | 'lapidas'>> & Pick<Durable, 'borradoTodo'> {
  const rev = Number.isFinite(Number(x?.rev)) && Number(x?.rev) > 0 ? Math.floor(Number(x.rev)) : 0;
  const lapidas = (Array.isArray(x?.lapidas) ? x.lapidas : [])
    .filter((l: any) => typeof l?.id === 'string' && l.id && Number.isFinite(Number(l?.t)))
    .map((l: any) => ({ id: String(l.id).slice(0, 40), t: Number(l.t) }))
    .slice(-MAX_LAPIDAS);
  const borradoTodo = Number(x?.borradoTodo) > 0 ? Number(x.borradoTodo) : undefined;
  return { rev, lapidas, ...(borradoTodo ? { borradoTodo } : {}) };
}

/** Quita a quien tenga lápida (por id) o se haya creado antes de un «olvida todas». */
export function aplicarLapidas<P extends { id: string; creado?: number }>(personas: P[], d: Durable): P[] {
  const muertos = new Set((d.lapidas || []).map((l) => l.id));
  const todo = Number(d.borradoTodo) || 0;
  return personas.filter((p) => !muertos.has(p.id) && !(todo && (Number(p.creado) || 0) <= todo));
}

function unirLapidas(a: Lapida[] = [], b: Lapida[] = []): Lapida[] {
  const m = new Map<string, number>();
  for (const l of [...a, ...b]) m.set(l.id, Math.max(m.get(l.id) || 0, l.t));
  return [...m.entries()]
    .map(([id, t]) => ({ id, t }))
    .sort((x, y) => x.t - y.t)
    .slice(-MAX_LAPIDAS);
}

/**
 * Las dos copias (disco y S3) en una: gana la de `rev` más alta (empate: la de S3, la durable), y las lápidas de las
 * DOS se aplican. `atrasada` dice cuál hay que reescribir (la de menor rev o la que no tenía las lápidas).
 */
export function fusionarCopias<P extends { id: string; creado?: number }, C extends ConPersonas<P>>(
  disco: C | null,
  s3: C | null
): { cajon: C | null; atrasada: Array<'disco' | 's3'> } {
  if (!disco && !s3) return { cajon: null, atrasada: [] };
  const rd = Number(disco?.rev) || 0;
  const rs = Number(s3?.rev) || 0;
  const base = (s3 && rs >= rd ? s3 : disco) as C;
  const lapidas = unirLapidas(disco?.lapidas, s3?.lapidas);
  const borradoTodo = Math.max(Number(disco?.borradoTodo) || 0, Number(s3?.borradoTodo) || 0) || undefined;
  const d: Durable = { lapidas, ...(borradoTodo ? { borradoTodo } : {}) };
  const personas = aplicarLapidas(base.personas, d);
  const cajon = { ...base, rev: Math.max(rd, rs), lapidas, ...(borradoTodo ? { borradoTodo } : {}), personas } as C;
  const firma = (c: C | null) => (c ? JSON.stringify([Number(c.rev) || 0, c.personas.map((p) => p.id), (c.lapidas || []).length, c.borradoTodo || 0]) : '');
  const final = firma(cajon);
  const atrasada: Array<'disco' | 's3'> = [];
  if (firma(disco) !== final) atrasada.push('disco');
  if (s3 && firma(s3) !== final) atrasada.push('s3');
  return { cajon, atrasada };
}

/**
 * El cajón siguiente: `rev` sube (al menos la hora en ms, para que se pueda comparar aunque no se haya podido leer la
 * versión anterior), conservando las lápidas.
 */
export function siguiente<C extends Durable>(previo: Durable | null | undefined, nuevo: C): C {
  return { ...nuevo, rev: Math.max((Number(previo?.rev) || 0) + 1, Date.now()), lapidas: nuevo.lapidas ?? previo?.lapidas ?? [], ...(nuevo.borradoTodo ?? previo?.borradoTodo ? { borradoTodo: nuevo.borradoTodo ?? previo?.borradoTodo } : {}) };
}

/** Las lápidas de antes más estas (al olvidar a alguien). */
export function conLapidas(previo: Durable | null | undefined, ids: string[], ahora = Date.now()): Lapida[] {
  return unirLapidas(previo?.lapidas, ids.map((id) => ({ id, t: ahora })));
}

/* ── el disco, inyectable (las pruebas simulan un disco que falla) ─────────────────────────────────── */

type Disco = Pick<typeof fs, 'writeFileSync' | 'renameSync' | 'unlinkSync' | 'mkdirSync'>;
const DISCO_REAL: Disco = { writeFileSync: fs.writeFileSync, renameSync: fs.renameSync, unlinkSync: fs.unlinkSync, mkdirSync: fs.mkdirSync };
let disco: Disco = DISCO_REAL;
/** Solo pruebas: otro disco (p. ej. uno cuya escritura lanza). `null` vuelve al de verdad. */
export function _discoBiometriaDePrueba(d: Partial<Disco> | null) {
  disco = d ? { ...DISCO_REAL, ...d } : DISCO_REAL;
}

/**
 * Escribe el JSON (tmp + rename). `ok`; si falla, intenta quitar la copia vieja: `quitada` (ya no hay copia local que
 * pueda resucitar nada; la próxima lectura va a S3) o `fallo` (la copia vieja sigue ahí: estado degradado).
 */
export function escribirLocal(carpeta: string, archivo: string, dato: unknown): 'ok' | 'quitada' | 'fallo' {
  try {
    disco.mkdirSync(carpeta, { recursive: true });
    disco.writeFileSync(`${archivo}.tmp`, JSON.stringify(dato), { mode: 0o600 });
    disco.renameSync(`${archivo}.tmp`, archivo);
    return 'ok';
  } catch (e: any) {
    console.warn('[biometría] no pude escribir la copia local', String(e?.message || e).slice(0, 120));
    try {
      disco.unlinkSync(archivo);
      return 'quitada';
    } catch (e2: any) {
      return e2?.code === 'ENOENT' ? 'quitada' : 'fallo';
    }
  }
}

/** Cómo quedó un borrado: completo, o con la copia local vieja todavía en el disco (S3 ya no la tiene). */
export type EstadoBorrado = { completo: true } | { completo: false; pendiente: 'copia_local'; detalle: string };

/**
 * S3 ya no tiene a la persona, pero la copia local vieja no se pudo reescribir ni quitar: el borrado NO está completo y
 * no se dice que lo está. `resultado` es lo que habría devuelto el borrado (la persona o cuántas). La próxima lectura
 * aplica la precedencia (S3 más nuevo + lápidas), así que esa copia no resucita a nadie mientras S3 conteste.
 */
export class BorradoDegradado<T = unknown> extends Error {
  constructor(
    public resultado: T,
    public detalle = 'la copia local no se pudo reescribir ni quitar'
  ) {
    super(detalle);
  }
}
