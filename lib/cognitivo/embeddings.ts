/**
 * EMBEDDINGS — convertir texto en vectores para buscar por significado.
 *
 * BGE-M3 (BAAI): multilingüe, bueno en español, vectores de 1024 dimensiones. Se sirve con Text
 * Embeddings Inference de Hugging Face en la T4 (`POST /embed`), detrás del proxy con clave
 * (infra/t4/). Sin `EMBED_URL`, todo lo que depende de esto se apaga solo y la búsqueda sigue
 * siendo por texto, como antes.
 *
 * Por qué búsqueda HÍBRIDA y no solo vectores: los vectores entienden «¿quién tiene el permiso del
 * cerro?» cuando el documento dice «titular de la concesión», pero se equivocan con lo exacto: un
 * número de expediente, una cifra, un nombre propio raro. El texto completo acierta justo en eso.
 * Se piden las dos listas y se funden por rango (RRF), que no necesita calibrar puntajes entre dos
 * escalas que no se parecen.
 */

export const DIMENSION = Number(process.env.EMBED_DIM || 1024);

function conf() {
  return {
    url: String(process.env.EMBED_URL || '').replace(/\/$/, ''),
    clave: String(process.env.EMBED_API_KEY || ''),
    ms: Number(process.env.EMBED_TIMEOUT_MS || 8000),
  };
}

export function embeddingsConfigurados(): boolean {
  return !!conf().url;
}

/** Caché corta para consultas repetidas (la misma pregunta en dos turnos seguidos). */
const cache = new Map<string, number[]>();
const MAX_CACHE = 500;

/** Vectores de varios textos, en lotes. Null si el servicio no está o falla: quien llama cae a texto. */
export async function vectorizar(textos: string[], opts: { lote?: number } = {}): Promise<number[][] | null> {
  const { url, clave, ms } = conf();
  if (!url || !textos.length) return url ? [] : null;
  const lote = Math.max(1, Math.min(64, opts.lote || 32));
  const out: number[][] = [];
  try {
    for (let i = 0; i < textos.length; i += lote) {
      const trozo = textos.slice(i, i + lote).map((t) => String(t || ' ').slice(0, 8000));
      const r = await fetch(`${url}/embed`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(clave ? { Authorization: `Bearer ${clave}` } : {}) },
        body: JSON.stringify({ inputs: trozo, normalize: true, truncate: true }),
        signal: AbortSignal.timeout(ms),
      });
      if (!r.ok) return null;
      const j = await r.json();
      const vs: number[][] = Array.isArray(j) ? j : j?.embeddings || j?.data?.map((d: any) => d.embedding);
      if (!Array.isArray(vs) || vs.length !== trozo.length || vs.some((v) => !Array.isArray(v) || v.length !== DIMENSION)) return null;
      out.push(...vs);
    }
    return out;
  } catch {
    return null;
  }
}

/** El vector de una sola consulta, con caché. */
export async function vectorDe(texto: string): Promise<number[] | null> {
  const k = texto.trim().toLowerCase();
  const ya = cache.get(k);
  if (ya) return ya;
  const vs = await vectorizar([texto]);
  const v = vs?.[0] || null;
  if (v) {
    if (cache.size >= MAX_CACHE) cache.delete(cache.keys().next().value as string);
    cache.set(k, v);
  }
  return v;
}

/** El formato que entiende pgvector: '[0.1,0.2,…]'. */
export function literalPg(v: number[]): string {
  return `[${v.map((x) => (Number.isFinite(x) ? Number(x.toFixed(6)) : 0)).join(',')}]`;
}

export function coseno(a: number[], b: number[]): number {
  let d = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    d += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return na && nb ? d / Math.sqrt(na * nb) : 0;
}

/**
 * Funde listas ordenadas por rango recíproco (RRF, k=60). Cada lista aporta 1/(k+posición): lo
 * que sale arriba en las dos gana, y un resultado que solo una lista vio no se pierde.
 */
export function fundirPorRango<T>(listas: T[][], clave: (x: T) => string, k = 60): Array<{ item: T; puntaje: number; de: number[] }> {
  const acc = new Map<string, { item: T; puntaje: number; de: number[] }>();
  listas.forEach((lista, li) =>
    lista.forEach((x, pos) => {
      const id = clave(x);
      const e = acc.get(id) || { item: x, puntaje: 0, de: [] };
      e.puntaje += 1 / (k + pos + 1);
      e.de.push(li);
      acc.set(id, e);
    })
  );
  return [...acc.values()].sort((a, b) => b.puntaje - a.puntaje);
}
