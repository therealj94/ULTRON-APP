/**
 * Memoria de largo plazo POR PERSONA en el teléfono de la mesa.
 *
 * El teléfono lo comparten varios miembros de la junta. Antes había una sola lista para todos y cada
 * turno le mandaba al cerebro lo que había dicho cualquiera: lo que José le pidió recordar le llegaba
 * también a Medardo. Ahora cada quien tiene su clave (por correo; sin correo, por nombre).
 *
 * La lista vieja se reparte UNA vez, sin filtrar nada ajeno: quien entra primero se queda solo con los
 * hechos firmados con su nombre exacto («José: …», que es como la mesa los escribía) y el resto se
 * descarta junto con la clave vieja. Nadie hereda lo de otro; lo que se pierde aquí sigue en la memoria
 * del servidor, que ya era por persona.
 *
 * Puro (sin react-native): lo prueba tests/memoria-movil.test.ts.
 */

export type LongFact = { hecho: string; at: string };
export type DuenoMemoria = { name: string; correo?: string };

/** La lista de antes, una para todos. Solo se lee para repartirla y luego se borra. */
export const CLAVE_MEMORIA_COMPARTIDA = 'ultron_fp_long_memory_v1';
const PREFIJO = 'ultron_fp_long_memory_v2:';
export const MAX_HECHOS = 60;

/** La clave de la memoria de una persona: por correo (normalizado); sin correo, por nombre. */
export function claveMemoria(u: DuenoMemoria): string {
  const correo = String(u.correo || '').trim().toLowerCase();
  if (correo) return `${PREFIJO}correo:${correo}`;
  const nombre = String(u.name || '').trim().toLowerCase();
  return `${PREFIJO}nombre:${nombre || 'sin-nombre'}`;
}

/** Lo guardado, tal cual venga (roto, null, otro formato), convertido en hechos válidos. */
export function hechosValidos(crudo: unknown): LongFact[] {
  if (!Array.isArray(crudo)) return [];
  const validos = crudo.filter(
    (f): f is LongFact => !!f && typeof f === 'object' && typeof (f as LongFact).hecho === 'string' && !!(f as LongFact).hecho.trim()
  );
  return validos.map((f) => ({ hecho: f.hecho, at: typeof f.at === 'string' ? f.at : '' }));
}

/** El hecho lo dictó esta persona: la mesa lo guardó como «Nombre: hecho» con su nombre exacto. */
export function firmadoPor(hecho: string, nombre: string): boolean {
  const n = nombre.trim();
  return !!n && hecho.startsWith(`${n}:`);
}

/**
 * Reparto de la lista compartida: a la memoria propia se le suman SOLO los hechos firmados con el
 * nombre de quien migra. Sin repetidos, lo propio primero y con el mismo tope que `addLongFact`.
 */
export function migrarCompartida(compartida: unknown, propia: unknown, nombre: string): LongFact[] {
  const mia = hechosValidos(propia);
  const vistos = new Set(mia.map((f) => f.hecho));
  const heredados = hechosValidos(compartida).filter((f) => {
    if (!firmadoPor(f.hecho, nombre) || vistos.has(f.hecho)) return false;
    vistos.add(f.hecho);
    return true;
  });
  return [...mia, ...heredados].slice(0, MAX_HECHOS);
}

/** Un hecho nuevo al frente de la lista (sin repetirlo), con tope. */
export function agregarHecho(lista: LongFact[], hecho: string, at: string): LongFact[] {
  const limpio = hecho.trim();
  if (!limpio) return lista;
  return [{ hecho: limpio, at }, ...lista.filter((f) => f.hecho !== limpio)].slice(0, MAX_HECHOS);
}
