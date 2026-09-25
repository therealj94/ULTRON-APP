/**
 * Recuperación dirigida del cerebro del perfil activo.
 *
 * El conocimiento entero va en el system, pero un 27B con un prompt largo a veces «no encuentra» el
 * dato. Aquí se eligen las líneas que hablan de lo que preguntaron y se ponen como HECHO del turno,
 * pegadas a la pregunta. Antes esto era exclusivo de Orden Global (lib/cerebro-og.ts); ahora sirve a
 * cualquier perfil, porque cada uno trae su conocimiento y su tabla de sinónimos.
 */
import { perfilActivo, type PerfilCerebro } from './perfiles';

const fold = (s: string) =>
  String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');

/** Las líneas de hecho de cada perfil, calculadas una sola vez. */
const lineasPorPerfil = new Map<string, string[]>();

export function lineas(perfil: PerfilCerebro): string[] {
  const cache = lineasPorPerfil.get(perfil.id);
  if (cache) return cache;
  const ls = perfil.conocimiento
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.startsWith('-'));
  lineasPorPerfil.set(perfil.id, ls);
  return ls;
}

/** Líneas del cerebro relevantes para el mensaje. Vacío si el tema no es de este cerebro. */
export function hechosCerebro(message: string, max = 14, perfil = perfilActivo()): string[] {
  const q = fold(message);
  if (!q) return [];
  const claves = new Set<string>();
  let porSinonimo = false;
  for (const [re, palabras] of perfil.alias)
    if (re.test(q)) {
      porSinonimo = true;
      palabras.forEach((p) => claves.add(p));
    }
  for (const w of q.split(/[^a-z0-9.\/-]+/)) if (w.length >= 5) claves.add(w);
  if (!claves.size) return [];
  /*
   * Si ningún sinónimo del perfil reconoció el tema, la pregunta probablemente no es de este cerebro
   * y solo quedan palabras sueltas: «orden» pescaba «un orden de magnitud» y «global» pescaba «el
   * estándar global». Se pide el doble de coincidencia para no inyectar ruido como si fuera saber.
   */
  const minimo = porSinonimo ? 2 : 4;
  const puntuadas = lineas(perfil)
    .map((l, i) => {
      const f = fold(l);
      let score = 0;
      for (const c of claves) if (f.includes(c)) score += c.length >= 5 ? 2 : 1;
      return { l, i, score };
    })
    .filter((x) => x.score >= minimo);
  puntuadas.sort((a, b) => b.score - a.score || a.i - b.i);
  return puntuadas
    .slice(0, max)
    .sort((a, b) => a.i - b.i)
    .map((x) => x.l);
}

/** El hecho ya redactado para el turno, o null si no hay nada del tema. */
export function hechoCerebro(message: string, perfil = perfilActivo()): string | null {
  const ls = hechosCerebro(message, 14, perfil);
  if (!ls.length) return null;
  return `${perfil.tituloConocimiento} (esto lo sabés de verdad; responde con esto y sin decir «no tengo acceso»):\n${ls.join('\n')}`;
}
