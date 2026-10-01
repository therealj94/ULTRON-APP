/**
 * Cómo la mesa web parte en frases lo que llega del turno en stream, para ir diciéndolas sin esperar al
 * final. Una pieza sale cuando está cerrada:
 *   · termina en . ! ? … (aunque no venga el espacio de después: el servidor manda la frase terminada
 *     SIN ese espacio, lib/trozos.ts, y antes esperaba al trozo siguiente o al final del turno);
 *   · o es un corte largo por coma, punto y coma o dos puntos (el servidor ya lo decidió así para que la
 *     primera palabra no espere a que termine una frase larga).
 * Diagnóstico de voz, 1-oct, H3.
 */
export const MIN_CORTE_COMA = 40;

export function cortarFrases(pendiente: string, final = false): { listas: string[]; resto: string } {
  const partes = pendiente.split(/(?<=[.!?…])\s+/);
  const ultima = (partes[partes.length - 1] || '').trim();
  const cerrada = /[.!?…]["»”')\]]*$/.test(ultima) || (/[,;:]$/.test(ultima) && ultima.length >= MIN_CORTE_COMA);
  const todas = final || cerrada;
  const listas = (todas ? partes : partes.slice(0, -1)).map((p) => p.trim()).filter(Boolean);
  return { listas, resto: todas ? '' : partes[partes.length - 1] || '' };
}
