/**
 * LA REVISIÓN DE UN TURNO — a quién debió convocar la mesa, la respuesta corregida y una nota —
 * guardada en la opinión que ya tiene cada traza (`feedback_nota`, hasta 600 caracteres).
 *
 * Sin dependencias de servidor: la usan la Escuela (en el navegador) al guardar y el exportador
 * (lib/entrenamiento/dataset.ts) al leer, y los dos tienen que entender exactamente lo mismo.
 */

/** Los especialistas que convoca Laya «electrum» (scripts/nodo-t4/laya/preguntas.json). */
export const ESPECIALISTAS = ['geologo', 'minas', 'civil', 'metalurgista', 'geomatica', 'ambiental', 'legal', 'economista'] as const;
export type Especialista = (typeof ESPECIALISTAS)[number];

export type Revision = {
  /** A quién debió convocar la mesa (0, 1 o 2; el principal primero). null = no se revisó el panel. */
  panel: Especialista[] | null;
  /** La respuesta que debió dar, escrita por la persona que revisa. */
  corrige: string | null;
  /** Qué estuvo mal o bien, en pocas palabras. */
  nota: string | null;
};

const CABECERA = '#escuela v1';
const TOPE_NOTA = 600;

/** La revisión como texto para `feedback_nota`. La corrección se recorta primero si no cabe. */
export function escribirRevision(r: Revision): string {
  const lineas = [CABECERA];
  if (r.panel) lineas.push(`panel: ${r.panel.join(', ') || 'nadie'}`);
  if (r.nota?.trim()) lineas.push(`nota: ${r.nota.replace(/\s+/g, ' ').trim()}`);
  let texto = lineas.join('\n');
  if (r.corrige?.trim()) {
    const espacio = TOPE_NOTA - texto.length - '\ncorrige: '.length;
    if (espacio > 20) texto += `\ncorrige: ${r.corrige.replace(/\s+/g, ' ').trim().slice(0, espacio)}`;
  }
  return texto.slice(0, TOPE_NOTA);
}

/** Lee lo que dejó la Escuela en `feedback_nota`. Una nota libre (del botón 👎) queda como `nota`. */
export function leerRevision(texto: string | null | undefined): Revision {
  const t = String(texto || '').trim();
  if (!t) return { panel: null, corrige: null, nota: null };
  if (!t.startsWith(CABECERA)) return { panel: null, corrige: null, nota: t };
  let panel: Especialista[] | null = null;
  let corrige: string | null = null;
  let nota: string | null = null;
  for (const l of t.split('\n').slice(1)) {
    const m = l.match(/^(panel|corrige|nota):\s?(.*)$/);
    if (!m) continue;
    if (m[1] === 'panel') {
      panel = m[2]
        .split(',')
        .map((x) => x.trim())
        .filter((x): x is Especialista => (ESPECIALISTAS as readonly string[]).includes(x))
        .slice(0, 2);
    } else if (m[1] === 'corrige') corrige = m[2].trim() || null;
    else nota = m[2].trim() || null;
  }
  return { panel, corrige, nota };
}
