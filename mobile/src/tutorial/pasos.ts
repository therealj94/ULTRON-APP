/**
 * ¿YA VIO EL RECORRIDO? (por persona, en los ajustes del teléfono). El recorrido en sí —Claudio y
 * ANT-ONIO enseñando lo que hace AU-RA— vive en src/recorrido. Se ofrece una vez por persona al llegar
 * a la mesa, en una ventana con «Empezar» y «Después» (src/bienvenida/VentanaBienvenida.tsx), y se
 * vuelve a abrir desde «Más → Qué puedo hacer».
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

/* ── la ventana del recorrido (José, 2-oct: «cuando es primera vez, ponerlo en una ventana») ── */

/**
 * La versión del recorrido. Sube cuando se le agregan cosas que vale la pena volver a enseñar: quien vio
 * una versión anterior (o la vieja `tutorialVisto`, que cuenta como la 1) vuelve a ver la ventana UNA vez.
 * La 2: la mesa y dónde tocar, WhatsApp, Correos, lo que sé de ti, Mi círculo, Misiones, propuestas,
 * avisos con la app cerrada y Ajustes.
 */
export const VERSION_RECORRIDO = 2;
/** «Después» se respeta: la ventana vuelve a salir sola, como mucho, estas veces. Siempre está en Más → Qué puedo hacer. */
export const MAX_POSPONER = 3;

export type MarcasRecorrido = {
  tutorialVisto?: Record<string, boolean>;
  recorridoVisto?: Record<string, number>;
  recorridoPospuesto?: Record<string, number>;
};

/** La versión que vio esta persona (0 si ninguna). */
export function versionVista(m: MarcasRecorrido, correo: string): number {
  const c = correoNormal(correo);
  if (!c) return 0;
  const v = Number(m.recorridoVisto?.[c]) || 0;
  return Math.max(v, m.tutorialVisto?.[c] ? 1 : 0);
}

/** ¿Se le ofrece sola la ventana del recorrido al llegar a la mesa? */
export function tocaOfrecerRecorrido(m: MarcasRecorrido, correo: string, version = VERSION_RECORRIDO): boolean {
  const c = correoNormal(correo);
  if (!c) return false;
  return versionVista(m, c) < version && (Number(m.recorridoPospuesto?.[c]) || 0) < MAX_POSPONER;
}

/** Lo vio (terminado o cerrado a la mitad): esta versión ya no se ofrece sola. */
export function conRecorridoVisto(m: MarcasRecorrido, correo: string, version = VERSION_RECORRIDO): Required<Pick<MarcasRecorrido, 'recorridoVisto' | 'tutorialVisto'>> {
  const c = correoNormal(correo);
  if (!c) return { recorridoVisto: { ...(m.recorridoVisto || {}) }, tutorialVisto: { ...(m.tutorialVisto || {}) } };
  return { recorridoVisto: { ...(m.recorridoVisto || {}), [c]: version }, tutorialVisto: conTutorialVisto(m.tutorialVisto, c) };
}

/** Dijo «Después»: se cuenta (pasado MAX_POSPONER ya no sale sola). */
export function conRecorridoPospuesto(m: MarcasRecorrido, correo: string): Required<Pick<MarcasRecorrido, 'recorridoPospuesto'>> {
  const c = correoNormal(correo);
  const antes = { ...(m.recorridoPospuesto || {}) };
  if (!c) return { recorridoPospuesto: antes };
  return { recorridoPospuesto: { ...antes, [c]: (Number(antes[c]) || 0) + 1 } };
}
