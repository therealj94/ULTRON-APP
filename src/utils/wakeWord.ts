/** Detecta “hey ultron” / variantes en español o inglés. */
export function isHeyUltron(text: string): boolean {
  const t = text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!t) return false;

  // Frases wake explícitas
  if (
    /\b(hey|oye|hola|ok|okay|ei|ey)\s+(ultron|ultronfp|ultra)\b/.test(t) ||
    /\bultron\s+(oye|escucha|activa|despierta)\b/.test(t) ||
    /\bhey\s+ultron\b/.test(t)
  ) {
    return true;
  }

  // Solo “ultron” al inicio de frase corta (wake)
  if (/^(ultron|ultron fp)\b/.test(t) && t.split(' ').length <= 3) {
    return true;
  }

  return false;
}

/** Quita el wake word del comando restante. */
export function stripHeyUltron(text: string): string {
  return text
    .replace(
      /^(hey|oye|hola|ok|okay|ei|ey)\s+(ultron|ultronfp|ultra)[,.]?\s*/i,
      ''
    )
    .replace(/^ultron(\s+fp)?[,.]?\s*/i, '')
    .trim();
}
