/**
 * En qué idioma se está hablando con Dr Electrum: español por defecto, inglés si le hablan en inglés.
 *
 * Lo fijan dos cosas: el oído (el servidor detecta si lo dictado fue español o inglés) y la
 * respuesta del turno (el servidor decide con el texto de la pregunta). La voz lee en el idioma de
 * la última respuesta, y la próxima pregunta lleva este valor como pista para cuando el texto solo
 * no alcanza a decirlo («Olancho», «ok»).
 */
export type Idioma = 'es' | 'en';

let actual: Idioma = 'es';

export function idiomaActual(): Idioma {
  return actual;
}

/** Acepta lo que venga del servidor; cualquier otra cosa deja el idioma como estaba. */
export function fijarIdioma(v: unknown): void {
  if (v === 'es' || v === 'en') actual = v;
}
