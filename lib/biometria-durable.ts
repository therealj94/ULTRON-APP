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
 *
 * Revisión 9 (MENOR 6): las lápidas tenían tope (MAX_LAPIDAS, las más nuevas) y pasado el tope la más vieja se perdía: una
 * copia vieja con esa persona la podía devolver. Ahora lo que sale del tope se COMPACTA en una marca de agua: `marcaLapidas`
 * (la hora de la lápida más nueva que salió) y `vivosEnMarca` (los ids de quienes seguían vivos y habían nacido hasta esa
 * hora: a lo más las personas del cajón, nada biométrico). Toda persona nacida hasta la marca que no está en esa lista ya
 * murió, aunque su lápida ya no esté: ninguna copia ni respaldo la devuelve. Las lápidas nuevas siguen siendo por id.
 */
import fs from 'node:fs';

export type Lapida = { id: string; t: number };
export type Durable = { rev?: number; lapidas?: Lapida[]; borradoTodo?: number; marcaLapidas?: number; vivosEnMarca?: string[] };
type ConPersonas<P> = Durable & { personas: P[] };

/** Cuántas lápidas por id se guardan (las más nuevas); las de antes quedan en la marca de agua (compactarLapidas). */
export const MAX_LAPIDAS = 500;
/** Tope de lo que se acepta al leer (lo que este servicio escribe nunca pasa de MAX_LAPIDAS: se compacta al guardar). */
const TOPE_LEIDO = MAX_LAPIDAS * 4;

/**
 * La hora de alta de alguien NUEVO: siempre después de «olvida todas» y de la marca de agua. Con la misma hora en
 * milisegundos (un alta justo tras borrar, frecuente en un servidor rápido) contaba como de antes del borrado y no
 * se guardaba (`aplicarLapidas` borra lo creado `<=` esas horas).
 */
export function horaDeAlta(d: Durable | null | undefined, ahora: number): number {
  return Math.max(ahora, (Number(d?.borradoTodo) || 0) + 1, (Number(d?.marcaLapidas) || 0) + 1);
}

/** Lo durable de un JSON leído (rev, lápidas, borradoTodo, la marca de agua), saneado. */
export function sanearDurable(x: any): Required<Pick<Durable, 'rev' | 'lapidas'>> & Pick<Durable, 'borradoTodo' | 'marcaLapidas' | 'vivosEnMarca'> {
  const rev = Number.isFinite(Number(x?.rev)) && Number(x?.rev) > 0 ? Math.floor(Number(x.rev)) : 0;
  const lapidas = (Array.isArray(x?.lapidas) ? x.lapidas : [])
    .filter((l: any) => typeof l?.id === 'string' && l.id && Number.isFinite(Number(l?.t)))
    .map((l: any) => ({ id: String(l.id).slice(0, 40), t: Number(l.t) }))
    .slice(-TOPE_LEIDO);
  const borradoTodo = Number(x?.borradoTodo) > 0 ? Number(x.borradoTodo) : undefined;
  const marcaLapidas = Number(x?.marcaLapidas) > 0 ? Number(x.marcaLapidas) : undefined;
  const vivosEnMarca = marcaLapidas ? (Array.isArray(x?.vivosEnMarca) ? x.vivosEnMarca : []).filter((v: unknown) => typeof v === 'string' && v).map((v: string) => v.slice(0, 40)).slice(0, TOPE_LEIDO) : undefined;
  return { rev, lapidas, ...(borradoTodo ? { borradoTodo } : {}), ...(marcaLapidas ? { marcaLapidas, vivosEnMarca } : {}) };
}

/**
 * Quita a quien tenga lápida (por id), se haya creado antes de un «olvida todas», o haya nacido hasta la marca de agua y
 * no esté entre los vivos de esa marca (su lápida se compactó).
 */
export function aplicarLapidas<P extends { id: string; creado?: number }>(personas: P[], d: Durable): P[] {
  const muertos = new Set((d.lapidas || []).map((l) => l.id));
  const todo = Number(d.borradoTodo) || 0;
  const marca = Number(d.marcaLapidas) || 0;
  const vivos = new Set(d.vivosEnMarca || []);
  return personas.filter((p) => !muertos.has(p.id) && !(todo && (Number(p.creado) || 0) <= todo) && !(marca && (Number(p.creado) || 0) <= marca && !vivos.has(p.id)));
}

function unirLapidas(a: Lapida[] = [], b: Lapida[] = []): Lapida[] {
  const m = new Map<string, number>();
  for (const l of [...a, ...b]) m.set(l.id, Math.max(m.get(l.id) || 0, l.t));
  return [...m.entries()].map(([id, t]) => ({ id, t })).sort((x, y) => x.t - y.t);
}

/**
 * Si pasan de MAX_LAPIDAS, las más viejas salen y quedan en la marca de agua: `marcaLapidas` sube a la hora de la más
 * nueva que salió y `vivosEnMarca` pasa a ser quienes siguen vivos (en `personas`, el estado que vale, ya sin los
 * muertos) y nacieron hasta esa hora. Así no se pierde ninguna muerte: una persona olvidada nació antes de su lápida, y
 * si su lápida salió, nació hasta la marca y no está entre los vivos.
 */
export function compactarLapidas<P extends { id: string; creado?: number }>(d: Durable, personas: P[]): Durable {
  const lapidas = [...(d.lapidas || [])].sort((x, y) => x.t - y.t);
  if (lapidas.length <= MAX_LAPIDAS) return { ...d, lapidas };
  const fuera = lapidas.slice(0, lapidas.length - MAX_LAPIDAS);
  const marcaLapidas = Math.max(Number(d.marcaLapidas) || 0, ...fuera.map((l) => l.t));
  const vivosEnMarca = aplicarLapidas(personas, d)
    .filter((p) => (Number(p.creado) || 0) <= marcaLapidas)
    .map((p) => p.id);
  return { ...d, lapidas: lapidas.slice(-MAX_LAPIDAS), marcaLapidas, vivosEnMarca };
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
  // Las lápidas de las dos, y la marca de agua de CADA una (revisión 9): lo que una ya compactó sigue muerto en la otra.
  let personas = aplicarLapidas(base.personas, { lapidas, ...(borradoTodo ? { borradoTodo } : {}) });
  for (const c of [disco, s3]) if (c?.marcaLapidas) personas = aplicarLapidas(personas, { marcaLapidas: c.marcaLapidas, vivosEnMarca: c.vivosEnMarca });
  const marca = Math.max(Number(disco?.marcaLapidas) || 0, Number(s3?.marcaLapidas) || 0);
  const vivos = marca ? personas.filter((p) => (Number(p.creado) || 0) <= marca).map((p) => p.id) : undefined;
  const d = compactarLapidas({ lapidas, ...(borradoTodo ? { borradoTodo } : {}), ...(marca ? { marcaLapidas: marca, vivosEnMarca: vivos } : {}) }, personas);
  const { rev: _r, lapidas: _l, borradoTodo: _b, marcaLapidas: _m, vivosEnMarca: _v, ...resto } = base;
  const cajon = { ...resto, rev: Math.max(rd, rs), ...d, personas } as unknown as C;
  const firma = (c: C | null) => (c ? JSON.stringify([Number(c.rev) || 0, c.personas.map((p) => p.id), (c.lapidas || []).length, c.borradoTodo || 0, c.marcaLapidas || 0, (c.vivosEnMarca || []).length]) : '');
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
  const borradoTodo = nuevo.borradoTodo ?? previo?.borradoTodo;
  const marcaLapidas = nuevo.marcaLapidas ?? previo?.marcaLapidas;
  const d: Durable = {
    lapidas: nuevo.lapidas ?? previo?.lapidas ?? [],
    ...(borradoTodo ? { borradoTodo } : {}),
    ...(marcaLapidas ? { marcaLapidas, vivosEnMarca: nuevo.vivosEnMarca ?? previo?.vivosEnMarca ?? [] } : {}),
  };
  // Revisión 9: pasado el tope, las lápidas viejas se compactan con las personas que se guardan (el estado que vale).
  const personas = (nuevo as { personas?: unknown }).personas;
  return { ...nuevo, rev: Math.max((Number(previo?.rev) || 0) + 1, Date.now()), ...(Array.isArray(personas) ? compactarLapidas(d, personas as Array<{ id: string; creado?: number }>) : d) };
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
