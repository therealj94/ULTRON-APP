/**
 * LAS MARCAS DE SUPRESIÓN (tombstones): lo que la persona borró no vuelve por ningún camino (documento
 * maestro, sección 13 «Borrado sin resurrección»; AUR11).
 *
 * Borrar un dato toca varios almacenes —«lo que sé de ti» (lib/conocer-persona.ts), la respuesta del perfil
 * (lib/perfil-persona.ts), los resúmenes de conversaciones y el tramo en curso (lib/episodios.ts)— y cada uno
 * se puede repoblar con una copia vieja: un teléfono que estuvo offline y reenvía su caché, un tramo de
 * conversación de antes que el modelo resume después, un respaldo restaurado o un formato viejo migrado.
 *
 * Por eso cada borrado escribe PRIMERO una marca, aquí, en un cajón propio (`ultron/supresiones/<huella>`:
 * separado de lo que marca, así restaurar el cajón de «lo que sé de ti» no se lleva sus marcas), con:
 *   · versión (un reloj por persona que solo sube) y la hora (`en`, reloj del servidor);
 *   · qué cubre: ids de datos, claves comunes (categoría + clave), las palabras que identifican lo borrado
 *     (para los derivados de texto: resúmenes y tramo) y los campos del perfil (`encuesta.vive`);
 *   · qué almacenes faltan por procesar (`pendientes`): el job durable. Un reinicio a mitad lo deja aquí y
 *     lib/olvido.ts lo reanuda; mientras tanto TODA lectura ya filtra con la marca.
 *
 * La regla: una copia de algo DICHO (o guardado) a la hora `t` está suprimida si una marca la cubre y
 * `t <= en`. Lo que la persona cuente después del borrado vale (la marca no prohíbe para siempre); lo de
 * antes, venga de donde venga, no.
 *
 * Las marcas se conservan (una marca mínima evita reimportar sin querer): hasta MAX_TUMBAS por persona; las
 * más viejas ya terminadas se van primero.
 */
import path from 'node:path';
import { CajonNoDisponible, clavePersona, crearCajones, nuevoId, palabras, plegar } from './cerebro-comun';

export type Almacen = 'conocer' | 'episodios' | 'perfil';
export const ALMACENES: readonly Almacen[] = ['conocer', 'episodios', 'perfil'];
export type ClaveDato = { categoria: string; clave: string };

export type Tumba = {
  id: string;
  /** El reloj de la persona al marcar: sube con cada marca. */
  version: number;
  /** Cuándo se pidió (reloj del servidor). Lo dicho hasta aquí, si la marca lo cubre, no vuelve. */
  en: number;
  /** olvido: datos sueltos; todo: «Borrar todo lo que te conté»; correccion: el valor viejo de un dato corregido. */
  tipo: 'olvido' | 'todo' | 'correccion';
  ids: string[];
  claves: ClaveDato[];
  /** Por cada dato borrado, las palabras que lo identifican («Vive en Tela» → ["tela"]). */
  terminos: string[][];
  /** Campos del perfil: 'encuesta.vive', 'cumple'. */
  campos: string[];
  /** Los almacenes que todavía no se procesaron. Vacío = hecho. */
  pendientes: Almacen[];
  hecho?: number;
};

export type NuevaTumba = Pick<Tumba, 'tipo'> & Partial<Pick<Tumba, 'ids' | 'claves' | 'terminos' | 'campos' | 'pendientes' | 'en'>>;

type CajonSupresiones = { version: 1; reloj: number; tumbas: Tumba[] };

export const MAX_TUMBAS = 400;

const lista = (v: unknown, n: number, f: (x: any) => any) => (Array.isArray(v) ? v : []).slice(0, n).map(f).filter((x) => x !== null && x !== undefined && x !== '');

function sanearTumba(x: any): Tumba | null {
  const en = Number(x?.en) || 0;
  const version = Number(x?.version) || 0;
  if (!en || !version) return null;
  const tipo = x?.tipo === 'todo' || x?.tipo === 'correccion' ? x.tipo : 'olvido';
  return {
    id: String(x?.id || nuevoId('sp')).slice(0, 40),
    version,
    en,
    tipo,
    ids: lista(x?.ids, 60, (i) => String(i).slice(0, 40)),
    claves: lista(x?.claves, 30, (k) => (k && typeof k.clave === 'string' && k.clave ? { categoria: String(k.categoria || ''), clave: plegar(k.clave).slice(0, 60) } : null)),
    terminos: lista(x?.terminos, 60, (t) => {
      const ws = lista(t, 12, (w) => plegar(String(w)).slice(0, 40));
      return ws.length ? ws : null;
    }),
    campos: lista(x?.campos, 20, (c) => String(c).slice(0, 40)),
    pendientes: lista(x?.pendientes, 3, (a) => ((ALMACENES as readonly string[]).includes(a) ? a : null)),
    ...(Number(x?.hecho) ? { hecho: Number(x.hecho) } : {}),
  };
}

const cajones = crearCajones<CajonSupresiones>({
  nombre: 'supresiones',
  prefijoS3: 'supresiones',
  dirEnv: 'ULTRON_SUPRESIONES_DIR',
  dirPorOmision: 'supresiones',
  // Junto a «lo que sé de ti» si esa carpeta se movió (las pruebas la apuntan a un temporal).
  carpetaPorOmision: () => (process.env.ULTRON_CONOCER_DIR ? path.join(path.dirname(process.env.ULTRON_CONOCER_DIR), 'supresiones') : ''),
  vacio: () => ({ version: 1, reloj: 0, tumbas: [] }),
  sanear: (raw: any) => {
    const tumbas = (Array.isArray(raw?.tumbas) ? raw.tumbas : []).map(sanearTumba).filter(Boolean) as Tumba[];
    // El reloj nunca baja de la versión más alta que haya (un cajón a medio escribir no lo atrasa).
    const reloj = Math.max(Number(raw?.reloj) || 0, ...tumbas.map((t) => t.version), 0);
    return { version: 1, reloj, tumbas };
  },
});

/** Las más viejas ya terminadas se van primero; las pendientes nunca. */
function podar(c: CajonSupresiones) {
  if (c.tumbas.length <= MAX_TUMBAS) return;
  const fuera = c.tumbas
    .filter((t) => !t.pendientes.length)
    .sort((a, b) => a.en - b.en)
    .slice(0, c.tumbas.length - MAX_TUMBAS);
  const ids = new Set(fuera.map((t) => t.id));
  c.tumbas = c.tumbas.filter((t) => !ids.has(t.id));
}

/**
 * Escribe una marca (ANTES de tocar cualquier almacén). Lanza CajonNoDisponible si no se pudo leer lo
 * guardado: entonces no se borra nada (borrar sin marca deja la puerta abierta a resucitar).
 */
export async function marcarSupresion(persona: string, t: NuevaTumba): Promise<{ tumba: Tumba; durable: boolean }> {
  const clave = clavePersona(persona);
  if (!clave) throw new Error('Sin persona no hay qué borrar.');
  const { resultado, durable } = await cajones.modificar(clave, (c) => {
    c.reloj += 1;
    const tumba = sanearTumba({
      id: nuevoId('sp'),
      version: c.reloj,
      en: t.en ?? Date.now(),
      tipo: t.tipo,
      ids: t.ids || [],
      claves: t.claves || [],
      terminos: t.terminos || [],
      campos: t.campos || [],
      pendientes: t.pendientes ?? [...ALMACENES],
    }) as Tumba;
    if (!tumba.pendientes.length) tumba.hecho = tumba.en;
    c.tumbas.push(tumba);
    podar(c);
    return tumba;
  });
  return { tumba: resultado, durable };
}

/** Un almacén quedó procesado (con recibo durable) para esta marca. Nunca lanza: false si no se pudo anotar. */
export async function cerrarAlmacen(persona: string, id: string, almacen: Almacen): Promise<boolean> {
  try {
    const { durable } = await cajones.modificar(clavePersona(persona), (c) => {
      const t = c.tumbas.find((x) => x.id === id);
      if (!t) return;
      t.pendientes = t.pendientes.filter((a) => a !== almacen);
      if (!t.pendientes.length && !t.hecho) t.hecho = Date.now();
    });
    return durable;
  } catch {
    return false;
  }
}

/** Las marcas de la persona. Lanza CajonNoDisponible si no se pudieron leer (quien lee falla cerrado). */
export async function tumbasDe(persona: string): Promise<Tumba[]> {
  const l = await cajones.leer(clavePersona(persona));
  if (!l.ok) throw new CajonNoDisponible('lo que borraste');
  return l.valor.tumbas;
}

/** Las de la caché, sin esperar; undefined si todavía no se cargaron (quien lee sin esperar no usa nada). */
export function tumbasEnCache(persona: string): Tumba[] | undefined {
  const clave = clavePersona(persona);
  if (!clave) return [];
  return cajones.enCache(clave)?.tumbas;
}

/** El reloj de la persona (sube con cada marca): entra en la firma del system congelado. */
export function relojSupresiones(persona: string): number {
  return cajones.enCache(clavePersona(persona))?.reloj ?? 0;
}

export function precargarSupresiones(persona: string): Promise<void> {
  return cajones.leer(clavePersona(persona)).then(
    () => undefined,
    () => undefined
  );
}

/* ------------------------------------------------------------------ las reglas (puras) */

const mismaClave = (k: ClaveDato, categoria: string | undefined, clave: string | undefined) => !!clave && k.categoria === categoria && k.clave === plegar(clave);

/**
 * ¿Esta copia de un dato está suprimida? `t` es cuándo se dijo (o se guardó) esta copia. Los datos que YA
 * están en el almacén se cubren por id, por clave común o por «todo»; lo que ENTRA (un tramo viejo que se
 * resume, un POST de un teléfono que estuvo offline) también por las palabras de lo borrado.
 */
export function datoSuprimido(tumbas: readonly Tumba[], d: { id?: string; categoria?: string; clave?: string; dato: string; t: number }, o: { entrante?: boolean } = {}): boolean {
  let ws: Set<string> | null = null;
  for (const tb of tumbas) {
    if (d.t > tb.en) continue;
    if (tb.tipo === 'todo') return true;
    if (d.id && tb.ids.includes(d.id)) return true;
    if (tb.claves.some((k) => mismaClave(k, d.categoria, d.clave))) return true;
    if (o.entrante && tb.terminos.length) {
      ws ??= new Set(palabras(d.dato));
      if (tb.terminos.some((grupo) => grupo.every((w) => ws!.has(w)))) return true;
    }
  }
  return false;
}

/**
 * ¿Este valor de un campo del perfil está suprimido? `hechoEn`: cuándo se puso (la marca del servidor o la
 * hora del cambio en el teléfono). Sin hora (una copia vieja, un reenvío de la caché), la marca gana.
 * Devuelve la hora de la marca que lo cubre, o 0.
 */
export function campoSuprimido(tumbas: readonly Tumba[], campo: string, hechoEn?: number): number {
  let en = 0;
  for (const tb of tumbas) if (tb.campos.includes(campo) && !(Number(hechoEn) > tb.en)) en = Math.max(en, tb.en);
  return en;
}

/** Para el teléfono: cada campo del perfil con su marca más reciente. */
export function camposSuprimidos(tumbas: readonly Tumba[]): Record<string, number> {
  const r: Record<string, number> = {};
  for (const tb of tumbas) for (const c of tb.campos) r[c] = Math.max(r[c] || 0, tb.en);
  return r;
}

/** Palabras que no identifican nada por sí solas (las de las plantillas de cada respuesta). */
const GENERICAS = new Set(
  'vive dedica llama gusta gustan encanta favorita favorito comida musica familia quiere aura ayude ayuda trabaja trabajo oficio pasatiempo cumple cumpleano ano esposa esposo hija hijo madre padre suya suyo'.split(' ')
);

/**
 * Las palabras que identifican un dato, para encontrarlo en el texto de los derivados («Vive en Tela» →
 * ["tela"]; «Su hija se llama Lucía» → ["lucia"]). Sin palabras propias (todo plantilla), vacío. De la clave
 * solo se descarta la categoría (lo de antes de «:»): el valor («hija:lucia» → «lucia») es justo lo que
 * identifica el dato.
 */
export function terminosDe(texto: string, clave?: string): string[] {
  const k = String(clave || '');
  const fuera = new Set(palabras((k.includes(':') ? k.slice(0, k.indexOf(':')) : k).replace(/_/g, ' ')));
  const ws = palabras(texto).filter((w) => !GENERICAS.has(w) && !fuera.has(w));
  return [...new Set(ws)].slice(0, 12);
}

/** Los términos de las marcas que pueden tocar algo de la hora `desde` (las marcadas después de eso). */
export function terminosVigentes(tumbas: readonly Tumba[], desde: number): string[][] {
  const r: string[][] = [];
  for (const tb of tumbas) if (tb.en >= desde) r.push(...tb.terminos);
  return r;
}

export const OLVIDADO = '[olvidado]';

/** La raíz de una palabra como la arma `palabras` (plegada, sin plural simple). */
function raiz(w: string): string {
  const p = plegar(w);
  return p.length > 4 && p.endsWith('es') ? p.slice(0, -2) : p.length > 3 && p.endsWith('s') ? p.slice(0, -1) : p;
}

/**
 * El texto de un derivado (un resumen, un turno del tramo) sin las palabras de lo borrado: cada una se
 * cambia por «[olvidado]» (o por `marca`: la vista autorizada tapa lo LIMITADO con «[reservado]», sin
 * borrarlo de ningún almacén). Si no hay nada que tapar, el mismo texto.
 */
export function limpiarTexto(texto: string, terminos: readonly (readonly string[])[], marca = OLVIDADO): string {
  if (!texto || !terminos.length) return texto;
  const todas = new Set(terminos.flat());
  if (!todas.size) return texto;
  return texto.replace(/[\p{L}\p{N}]+/gu, (w) => (todas.has(raiz(w)) ? marca : w));
}

/** Solo pruebas: como tras un redespliegue. */
export function _olvidarCacheSupresiones() {
  cajones._olvidarCache();
}
