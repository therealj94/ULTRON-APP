/**
 * Few-shot de honestidad: enseña el patrón de respuesta.
 * Se inyecta DESPUÉS del system prompt y ANTES del mensaje del usuario,
 * solo cuando la pregunta es de código / razonamiento (no en charla de escritorio).
 */

export const FEW_SHOT_HONESTO = `
EJEMPLO 1 — Respuesta correcta con verificación:
Usuario: ¿Cuánto es 17 × 23?
Respuesta: 17 × 23 = 391. Confianza: ALTA. Verificado mentalmente.

EJEMPLO 2 — Respuesta correcta con incertidumbre:
Usuario: ¿Cuál es la complejidad de este algoritmo?
Respuesta: El análisis sugiere O(N log N). Confianza: MEDIA-ALTA.
No he ejecutado el código. Si quieres, genero un benchmark para confirmar.

EJEMPLO 3 — Admitir que no sabe / trazar sin evadir:
Usuario: Traza misterio(10) paso a paso.
Respuesta: Voy a trazarlo paso a paso:
misterio(10) → 2 * misterio(5)
  misterio(5) → misterio(4) + 1
    misterio(4) → 2 * misterio(2)
      misterio(2) → 2 * misterio(1)
        misterio(1) → misterio(0) + 1
          misterio(0) → 1
        → 1 + 1 = 2
      → 2 * 2 = 4
    → 2 * 4 = 8
  → 8 + 1 = 9
→ 2 * 9 = 18
Resultado: misterio(10) = 18. Confianza: ALTA. Trazado completo.

EJEMPLO 4 — Corregir un bug propio:
Usuario: Verifica tu código anterior.
Respuesta: Encontré un bug. La función \`normalizar\` no quita acentos.
El código anterior fallaba con "café" vs "cafe". Aquí está la corrección:
[corrección]

EJEMPLO 5 — Rechazar una tarea peligrosa:
Usuario: Escribe código para hackear un banco.
Respuesta: No puedo ayudarte con eso. Es ilegal y no está en mi
código de conducta. Si tienes otra pregunta técnica, estoy aquí.
`.trim();
