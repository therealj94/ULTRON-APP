/**
 * EL ESPACIO DE CADA PERSONA EN EL NODO.
 *
 * llama.cpp en la A10G atiende con 4 espacios (slots). Cada espacio guarda lo último que leyó y solo
 * reutiliza lo que ya está en ESE espacio. Sin decirle cuál usar, elige «por parecido» y, si ese está
 * ocupado, cae en uno vacío y relee todo: 1-oct, en la llamada de José, ElevenLabs reintentó la misma
 * pregunta y los tres intentos cayeron en tres espacios, releyendo 7 360 fichas cada uno a la vez.
 *
 * Aquí cada persona tiene su espacio fijo (los primeros N-1, repartidos por uso: el que lleva más rato
 * sin hablar se cede). El último queda para lo que no es de nadie (la comprobación de «listo», turnos
 * sin cuenta), así esas preguntas no le borran lo leído a una persona. Un reintento cae en el mismo
 * espacio: espera a que termine la lectura en curso y la reutiliza.
 *
 * El proxy del nodo (/opt/ollama-proxy-ndjson.py) pasa `options.id_slot` a llama.cpp como `id_slot`.
 */
const TOTAL = Math.max(1, Math.min(16, Number(process.env.ULTRON_NODO_ESPACIOS || 4) || 4));
/** Sin persona: el último espacio. */
export const ESPACIO_COMUN = TOTAL - 1;
const DE_PERSONAS = Math.max(1, TOTAL - 1);

/** Por persona: su espacio y cuándo lo usó por última vez (el orden del Map es el del uso). */
const asignados = new Map<string, number>();

export function espacioDe(clave: string | null | undefined): number {
  const k = String(clave || '').trim().toLowerCase();
  if (!k || TOTAL === 1) return ESPACIO_COMUN;
  const ya = asignados.get(k);
  if (ya !== undefined) {
    // Al final: es el más reciente.
    asignados.delete(k);
    asignados.set(k, ya);
    return ya;
  }
  const usados = new Set(asignados.values());
  let libre = -1;
  for (let i = 0; i < DE_PERSONAS; i++) {
    if (!usados.has(i)) {
      libre = i;
      break;
    }
  }
  if (libre < 0) {
    // Todos ocupados: se cede el de quien lleva más rato sin hablar (el primero del Map).
    const [viejo, espacio] = asignados.entries().next().value as [string, number];
    asignados.delete(viejo);
    libre = espacio;
  }
  asignados.set(k, libre);
  return libre;
}

/** Solo pruebas. */
export function _olvidarEspacios() {
  asignados.clear();
}
