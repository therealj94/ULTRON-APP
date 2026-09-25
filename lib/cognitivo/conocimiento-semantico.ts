/**
 * EL CEREBRO POR SIGNIFICADO — la otra mitad de `lib/cerebro.ts`.
 *
 * `hechosCerebro` elige las líneas del conocimiento que comparten palabras con la pregunta. Falla
 * cuando se pregunta con otras palabras: «¿quién puso la plata para arrancar?» no comparte ninguna
 * con «Fundador: Medardo…». Aquí cada línea tiene su vector (BGE-M3) y se buscan las más cercanas.
 *
 * Solo se usa cuando la búsqueda por palabras no encontró nada: si ya hay líneas, las palabras
 * exactas mandan (son más precisas con nombres y cifras). Los vectores de las líneas se calculan una
 * vez por proceso y se guardan en disco por huella del texto: cambiar una línea del conocimiento
 * recalcula solo esa.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { coseno, embeddingsConfigurados, vectorDe, vectorizar } from './embeddings';
import { dirArchivos } from './base';

type Indice = { lineas: string[]; vectores: number[][] };
const indices = new Map<string, Promise<Indice | null>>();

const huella = (s: string) => crypto.createHash('sha1').update(s).digest('hex').slice(0, 16);

async function construir(id: string, lineas: string[]): Promise<Indice | null> {
  const archivo = path.join(dirArchivos(), `vectores-${id}.json`);
  let guardados: Record<string, number[]> = {};
  try {
    guardados = JSON.parse(fs.readFileSync(archivo, 'utf8'));
  } catch {
    /* primera vez */
  }
  const faltan = lineas.filter((l) => !guardados[huella(l)]);
  if (faltan.length) {
    const vs = await vectorizar(faltan);
    if (!vs) return null;
    faltan.forEach((l, i) => (guardados[huella(l)] = vs[i]));
    try {
      fs.mkdirSync(path.dirname(archivo), { recursive: true });
      const vivos = new Set(lineas.map(huella));
      fs.writeFileSync(archivo, JSON.stringify(Object.fromEntries(Object.entries(guardados).filter(([k]) => vivos.has(k)))));
    } catch {
      /* sin disco: se recalcula la próxima vez */
    }
  }
  return { lineas, vectores: lineas.map((l) => guardados[huella(l)]) };
}

/**
 * Las líneas del conocimiento más cercanas a la pregunta por significado. Vacío si no hay servicio
 * de embeddings, si falla, o si nada pasa el umbral (no se inyecta ruido como si fuera saber).
 */
export async function lineasPorSignificado(id: string, lineas: string[], pregunta: string, max = 4): Promise<string[]> {
  if (!embeddingsConfigurados() || !lineas.length || !pregunta.trim()) return [];
  const clave = `${id}:${huella(lineas.join('\n'))}`;
  if (!indices.has(clave)) indices.set(clave, construir(id, lineas).catch(() => null));
  const idx = await indices.get(clave)!;
  if (!idx) {
    indices.delete(clave); // se reintenta en el próximo turno
    return [];
  }
  const q = await vectorDe(pregunta);
  if (!q) return [];
  const umbral = Number(process.env.EMBED_UMBRAL_CEREBRO || 0.5);
  return idx.vectores
    .map((v, i) => ({ i, s: coseno(q, v) }))
    .filter((x) => x.s >= umbral)
    .sort((a, b) => b.s - a.s)
    .slice(0, max)
    .sort((a, b) => a.i - b.i)
    .map((x) => idx.lineas[x.i]);
}

export function resetIndicesTest() {
  indices.clear();
}
