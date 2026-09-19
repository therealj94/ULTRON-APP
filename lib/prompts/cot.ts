/**
 * Chain of Thought forzado: se añade al system prompt SOLO si el mensaje
 * pide trazado, complejidad, recursión, debug o paso a paso.
 */

export const COT_FORZADO = `
TAREAS QUE REQUIEREN CHAIN OF THOUGHT OBLIGATORIO:
- Trazado de recursión
- Análisis de complejidad algorítmica
- Razonamiento matemático multi-paso
- Debugging de código
- Comparación de alternativas

PASOS OBLIGATORIOS:
PASO 1: Reformular el problema con mis propias palabras.
PASO 2: Identificar los datos de entrada.
PASO 3: Identificar el objetivo.
PASO 4: Escribir la primera operación.
PASO 5: Escribir el resultado de esa operación.
PASO 6: Repetir hasta llegar al resultado.
PASO 7: Solo entonces, dar la respuesta final.

PROHIBIDO:
- Saltar pasos.
- Resumir "y así sucesivamente".
- Usar "obviamente" o "es trivial".
- Evadir con documentación irrelevante.
`.trim();

const COT_RE =
  /\b(traza|trazado|traz[aeá]|complejidad|recursi[oó]n|recursiv|paso a paso|debug(?:gea[rs]?)?|depur[ae]|analiza(?:r)?(?:\s+el)?(?:\s+c[oó]digo)?|algoritmo|big[- ]?o|o\s*\(\s*n|edge case|casos l[ií]mite)\b/i;

const CODIGO_RE =
  /\b(c[oó]digo|funci[oó]n|python|javascript|typescript|snippet|implementa|escribe una funci[oó]n|unit test|pytest|anagrama|bug|compila)\b/i;

export function requiereCot(mensaje: string): boolean {
  return COT_RE.test(String(mensaje || ''));
}

export function esTareaDeCodigo(mensaje: string): boolean {
  const t = String(mensaje || '');
  return requiereCot(t) || CODIGO_RE.test(t) || /```/.test(t);
}
