/**
 * LOS EXPEDIENTES POR SIGNIFICADO — la mitad vectorial de la búsqueda híbrida.
 *
 * Cada fragmento de un expediente guarda su vector (BGE-M3) en `fragmento.embedding` si la base
 * tiene pgvector (esquema.sql, bloque 5). Esto:
 *  · rellena los vectores que faltan (al subir un documento, en segundo plano, y con
 *    `scripts/cognitivo/indexar-vectores.ts` para lo que ya estaba cargado);
 *  · busca los fragmentos más cercanos a una pregunta.
 *
 * Todo es opcional y se apaga solo: sin pgvector o sin servicio de embeddings, `vectoresListos()`
 * dice que no y la búsqueda de expedientes se queda en texto completo.
 */
import { consulta, hayBase } from './db';
import { embeddingsConfigurados, literalPg, vectorDe, vectorizar } from '../../lib/cognitivo/embeddings';

let columna: { valor: boolean; t: number } | null = null;

/** ¿Tiene la base la columna de vectores? Se pregunta una vez por minuto, no en cada búsqueda. */
export async function hayColumnaVectores(): Promise<boolean> {
  if (!hayBase()) return false;
  if (columna && Date.now() - columna.t < 60_000) return columna.valor;
  try {
    const f = await consulta(`SELECT 1 FROM information_schema.columns WHERE table_name = 'fragmento' AND column_name = 'embedding' LIMIT 1`);
    columna = { valor: f.length > 0, t: Date.now() };
  } catch {
    columna = { valor: false, t: Date.now() };
  }
  return columna.valor;
}

export async function vectoresListos(): Promise<boolean> {
  return embeddingsConfigurados() && (await hayColumnaVectores());
}

/**
 * Rellena vectores que faltan, de a `lote`. Devuelve cuántos puso. Si el servicio falla a mitad,
 * se detiene sin error: lo que falte se rellena en la próxima pasada.
 */
export async function indexarPendientes(opts: { documentoId?: number; maximo?: number; lote?: number } = {}): Promise<number> {
  if (!(await vectoresListos())) return 0;
  const maximo = opts.maximo ?? 5000;
  const lote = opts.lote ?? 32;
  let hechos = 0;
  while (hechos < maximo) {
    const filas = await consulta<{ id: number; texto: string }>(
      `SELECT id, texto FROM fragmento WHERE embedding IS NULL ${opts.documentoId ? 'AND documento_id = $2' : ''} ORDER BY id LIMIT $1`,
      opts.documentoId ? [lote, opts.documentoId] : [lote]
    );
    if (!filas.length) break;
    const vs = await vectorizar(filas.map((f) => f.texto), { lote });
    if (!vs) break;
    await consulta(
      `UPDATE fragmento AS f SET embedding = v.e::vector
         FROM (SELECT unnest($1::bigint[]) AS id, unnest($2::text[]) AS e) AS v
        WHERE f.id = v.id`,
      [filas.map((f) => f.id), vs.map(literalPg)]
    );
    hechos += filas.length;
  }
  return hechos;
}

export type HitVector = { id: number; documento: string; pagina: number | null; texto: string; similitud: number };

/** Los fragmentos más cercanos a la pregunta, por coseno. Vacío si no hay vectores. */
export async function buscarPorSignificado(texto: string, limite = 30): Promise<HitVector[]> {
  if (!(await vectoresListos())) return [];
  const v = await vectorDe(texto);
  if (!v) return [];
  const filas = await consulta<HitVector>(
    `SELECT f.id, d.nombre AS documento, f.pagina, left(f.texto, 700) AS texto,
            (1 - (f.embedding <=> $1::vector))::float8 AS similitud
       FROM fragmento f JOIN documento d ON d.id = f.documento_id
      WHERE f.embedding IS NOT NULL
      ORDER BY f.embedding <=> $1::vector
      LIMIT $2`,
    [literalPg(v), limite]
  );
  // Por debajo de esto, el vecino más cercano no tiene que ver con la pregunta.
  const umbral = Number(process.env.EMBED_UMBRAL || 0.35);
  return filas.map((f) => ({ ...f, id: Number(f.id) })).filter((f) => f.similitud >= umbral);
}

/** Cuántos fragmentos tienen vector y cuántos faltan. Null si la base no tiene la columna. */
export async function coberturaVectores(): Promise<{ con: number; sin: number } | null> {
  if (!(await hayColumnaVectores())) return null;
  const [f] = await consulta<{ con: string; sin: string }>(
    `SELECT count(*) FILTER (WHERE embedding IS NOT NULL) AS con, count(*) FILTER (WHERE embedding IS NULL) AS sin FROM fragmento`
  );
  return { con: Number(f?.con || 0), sin: Number(f?.sin || 0) };
}
