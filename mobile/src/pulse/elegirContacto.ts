/**
 * Quién es «con» entre los contactos conocidos (lo puro de relevo.resolverContacto, para probarlo sin el teléfono):
 * correo exacto, nombre exacto o parecido (sin acentos, una palabra del nombre, el principio, o una letra mal oída
 * por la voz).
 */
export type ContactoConocido = { correo: string; nombre: string };

/** Minúsculas y sin acentos: «María» y «maria» son la misma. */
export const normalizar = (s: string) =>
  String(s || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();

function distancia(a: string, b: string): number {
  if (Math.abs(a.length - b.length) > 2) return 3;
  const fila = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let diag = fila[0];
    fila[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const arriba = fila[j];
      fila[j] = Math.min(fila[j] + 1, fila[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = arriba;
    }
  }
  return fila[b.length];
}

/** Si dos empatan gana la charla más reciente (las conversaciones vienen ordenadas así). */
export function elegirContacto(con: string, lista: readonly ContactoConocido[]): ContactoConocido | null {
  const q = normalizar(con);
  if (!q) return null;
  const porCorreo = lista.find((p) => p.correo === q);
  if (porCorreo) return porCorreo;
  let mejor: ContactoConocido | null = null;
  let puntos = 0;
  for (const p of lista) {
    const n = normalizar(p.nombre);
    const palabras = n.split(' ');
    const local = p.correo.split('@')[0];
    let v = 0;
    if (n === q) v = 100;
    else if (local === q) v = 90;
    else if (n.startsWith(q + ' ') || palabras.includes(q)) v = 80;
    else if (q.includes(' ') && n.includes(q)) v = 70;
    else if (q.length >= 3 && (n.startsWith(q) || palabras.some((w) => w.startsWith(q)))) v = 60;
    else if (q.length >= 3 && local.startsWith(q)) v = 50;
    else if (q.length >= 4 && palabras.some((w) => w.length >= 4 && distancia(w, q) <= (q.length >= 7 ? 2 : 1))) v = 40;
    if (v > puntos) {
      puntos = v;
      mejor = p;
    }
  }
  return mejor;
}
