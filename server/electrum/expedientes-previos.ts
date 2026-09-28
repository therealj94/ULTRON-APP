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
 * trozos van pegados a la pregunta, con su documento y su página.
 *
 * Si la pregunta NOMBRA un documento («el informe de Minas de Oro 2», «JICA Fase III»), se busca
 * solo dentro de él: el nombre suele estar en el título del archivo y no en su texto, y buscar en
 * todo traería trozos de otros informes que se citarían como si fueran del pedido. Se mira primero
 * la pregunta y, si no nombra ninguno, lo último que se dijo antes («¿y qué concluye?»).
 */
import { buscarEnExpedientes, consulta, hayBase, type HitExpediente } from './db';

/**
 * Una pregunta sobre lo que dice un papel. Se queda corto a propósito: una pregunta de catastro o de
 * precios no tiene por qué cargar trozos de informes.
 */
const PIDE_DOCUMENTO =
  /\b(informes?|documentos?|expedientes?|estudios?|fichas?|presentaci[oó]n(es)?|reportes?|reglamentos?|leyes|decretos?|resoluci[oó]n(es)?|cap[ií]tulos?|p[aá]ginas?|conclusi[oó]n(es)?|tablas?|anexos?|jica|indexsa|inhgeomin|minoro|fom|ocr)\b|qu[eé] (dice|dicen|concluye|concluyen|reporta|reportan)\b|seg[uú]n (el|la|los|las)\b/i;

export function pideDocumento(mensaje: string): boolean {
  return PIDE_DOCUMENTO.test(String(mensaje || ''));
}

/** Palabras que no distinguen un documento de otro: se ignoran al buscar cuál nombran. */
const GENERICAS = new Set(
  'informe informes documento documentos expediente expedientes estudio estudios ficha fichas presentacion presentaciones reporte reportes tecnico tecnica sobre segun dice dicen concluye concluyen reporta pagina paginas capitulo capitulos conclusion conclusiones tabla tablas anexo anexos zona zonas area cual cuales cuanto cuantos cuanta como donde para desde entre todo todos toda todas esta este estos estas tiene tienen hay dame decime quiero saber leyes recursos principales ocr pdf'.split(' ')
);
const ROMANOS = /^(i|ii|iii|iv|v|vi|vii|viii|ix|x)$/;

const sinAcentos = (t: string) => t.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

/** Las palabras de la pregunta que pueden nombrar un documento: largas, números y romanos. */
export function palabrasDeNombre(texto: string): string[] {
  const out = new Set<string>();
  for (const w of sinAcentos(texto).split(/[^a-z0-9ñ]+/)) {
    if (!w || GENERICAS.has(w)) continue;
    if (/^\d{1,4}$/.test(w) || ROMANOS.test(w) || w.length >= 4) out.add(w);
  }
  return [...out].slice(0, 12);
}

/**
 * El documento que la pregunta nombra, si nombra uno: el que más palabras de la pregunta tiene en
 * su nombre o carpeta (como palabras enteras: «2» no casa con «2001»), con al menos dos y sin
 * empate. Entre los que empatan en nombre, el de más texto (el informe y no su mapa).
 */
export async function documentoNombrado(texto: string): Promise<{ id: number; nombre: string } | null> {
  const palabras = palabrasDeNombre(texto);
  if (palabras.length < 2) return null;
  const suma = palabras.map((_, i) => `(unaccent(lower(d.nombre || ' ' || coalesce(d.carpeta, ''))) ~ ('\\m' || $${i + 1} || '\\M'))::int`).join(' + ');
  const filas = await consulta<{ id: number; nombre: string; puntos: number }>(
    `SELECT d.id, d.nombre, (${suma}) AS puntos
       FROM documento d
      WHERE EXISTS (SELECT 1 FROM fragmento f WHERE f.documento_id = d.id)
      ORDER BY puntos DESC, (SELECT count(*) FROM fragmento f WHERE f.documento_id = d.id) DESC, d.id DESC
      LIMIT 2`,
    palabras
  );
  const [a, b] = filas;
  if (!a || Number(a.puntos) < 2 || (b && Number(b.puntos) === Number(a.puntos) && !mismoNombreBase(a.nombre, b.nombre))) return null;
  return { id: Number(a.id), nombre: a.nombre };
}

/** «Informe X (OCR).txt» y «Informe X.pdf» son el mismo informe para esto. */
function mismoNombreBase(a: string, b: string) {
  const base = (t: string) => sinAcentos(t).replace(/\.[a-z0-9]{2,4}$/, '').replace(/\(?ocr\)?/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
  return base(a) === base(b);
}

export type Previos = { documento: string | null; trozos: string[] };

/** Los trozos de los expedientes que tocan la pregunta, listos para pegar. Vacío si no aplica. */
export async function expedientesDeLaPregunta(mensaje: string, opts: { antes?: string[]; limite?: number } = {}): Promise<Previos> {
  if (!hayBase() || !pideDocumento(mensaje)) return { documento: null, trozos: [] };
  const nombrado = (await documentoNombrado(mensaje)) || (opts.antes?.length ? await documentoNombrado([...opts.antes, mensaje].join(' ')) : null);
  const hits: HitExpediente[] = await buscarEnExpedientes(String(mensaje).slice(0, 400), opts.limite ?? 4, nombrado ? { documento: `#${nombrado.id}` } : {}).catch(() => []);
  return {
    documento: nombrado?.nombre ?? null,
    trozos: hits.map((h) => `- ${h.documento}${h.pagina ? `, p. ${h.pagina}` : ''}: «${h.texto.replace(/\s+/g, ' ').trim().slice(0, 500)}»`),
  };
}

export function bloqueExpedientes(p: Previos, puedeLeer: boolean): string {
  if (!p.trozos.length) return '';
  const de = p.documento
    ? `lo que encontró la búsqueda DENTRO de «${p.documento}», que es el documento que nombran`
    : 'lo que encontró la búsqueda en todos los documentos (son de documentos distintos: fijate de cuál es cada trozo antes de citarlo)';
  const leer = puedeLeer ? '; para leer el capítulo o la tabla entera, expediente_leer con ese documento y página' : '';
  return `DE LOS EXPEDIENTES CARGADOS, ${de}. Son trozos cortos; citá documento y página${leer}:\n${p.trozos.join('\n')}`;
}
