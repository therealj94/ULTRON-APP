/**
 * ¿YA VIO EL RECORRIDO? (por persona, en los ajustes del teléfono). El recorrido en sí —Claudio y
 * ANT-ONIO enseñando lo que hace AU-RA— vive en src/recorrido. Se muestra una vez por persona al llegar
 * a la mesa y se vuelve a abrir desde «Más → Qué puedo hacer».
 *
 * Sin React Native: se prueba en Node.
 */

/* ── ¿ya lo vio? (por persona, en los ajustes del teléfono) ──────────────────────────────── */

const correoNormal = (c: string) => String(c || '').trim().toLowerCase();

/** Se muestra solo si esta persona no marcó «no volver a mostrar» ni lo terminó antes. */
export function tocaTutorial(vistos: Record<string, boolean> | undefined, correo: string): boolean {
  const c = correoNormal(correo);
  return !!c && !vistos?.[c];
}

export function conTutorialVisto(vistos: Record<string, boolean> | undefined, correo: string): Record<string, boolean> {
  const c = correoNormal(correo);
  return c ? { ...(vistos || {}), [c]: true } : { ...(vistos || {}) };
}
