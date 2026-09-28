/**
 * LOS EXPEDIENTES, PEGADOS A LA PREGUNTA.
 *
 * Dr Electrum tiene `expediente_buscar` y `expediente_leer`, pero el modelo del nodo a veces
 * contesta sin llamarlas. Probado en producción: «¿qué dice el informe de Minas de Oro 2 sobre
 * Tatanacho?» → «no lo tengo cargado», con el informe de 88 páginas cargado y sin una sola llamada
 * a herramientas. Es la peor respuesta posible: niega lo que sí hay.
 *
 * Igual que con el mapa (mapa-garantia.ts), lo que no puede fallar no se deja a la memoria del
 * modelo. Si la pregunta es sobre documentos, antes de pensar se busca en los expedientes y los
 * trozos van pegados a la pregunta, con su documento y su página. El modelo sigue teniendo las
 * herramientas para leer más; lo que ya no puede es decir que no hay nada sin haber mirado.
 */
import { buscarEnExpedientes, hayBase, type HitExpediente } from './db';

/**
 * Una pregunta sobre lo que dice un papel. Se queda corto a propósito: una pregunta de catastro o de
 * precios no tiene por qué cargar trozos de informes.
 */
const PIDE_DOCUMENTO =
  /\b(informes?|documentos?|expedientes?|estudios?|fichas?|presentaci[oó]n(es)?|reportes?|reglamentos?|leyes|decretos?|resoluci[oó]n(es)?|cap[ií]tulos?|p[aá]ginas?|conclusi[oó]n(es)?|tablas?|anexos?|jica|indexsa|inhgeomin|minoro|fom|ocr)\b|qu[eé] (dice|dicen|concluye|concluyen|reporta|reportan)\b|seg[uú]n (el|la|los|las)\b/i;

export function pideDocumento(mensaje: string): boolean {
  return PIDE_DOCUMENTO.test(String(mensaje || ''));
}

/** Los trozos de los expedientes que tocan la pregunta, listos para pegar. Vacío si no aplica. */
export async function expedientesDeLaPregunta(mensaje: string, limite = 4): Promise<string[]> {
  if (!hayBase() || !pideDocumento(mensaje)) return [];
  const hits: HitExpediente[] = await buscarEnExpedientes(String(mensaje).slice(0, 400), limite).catch(() => []);
  return hits.map((h) => `- ${h.documento}${h.pagina ? `, p. ${h.pagina}` : ''}: «${h.texto.replace(/\s+/g, ' ').trim().slice(0, 500)}»`);
}

export function bloqueExpedientes(trozos: string[]): string {
  return trozos.length
    ? `DE LOS EXPEDIENTES CARGADOS, lo que encontró la búsqueda para esta pregunta (trozos cortos; citá documento y página; para leer el capítulo o la tabla entera, expediente_leer con ese documento y página):\n${trozos.join('\n')}`
    : '';
}
