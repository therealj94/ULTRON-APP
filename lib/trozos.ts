/**
 * CUÁNDO SOLTAR TEXTO DEL MODELO MIENTRAS LLEGA (el streaming de /api/turno/stream y de la voz).
 *
 * El modelo escribe a trozos de pocas letras; soltar cada trozo haría que la voz lea medias palabras
 * y que una línea de pedido de herramienta («PEDIR_HERRAMIENTA: …») se escapara a la pantalla. Esperar
 * la respuesta entera haría esperar segundos por la primera palabra. Se suelta por frases.
 */

/**
 * Hasta dónde se puede soltar lo que va llegando del modelo: la última frase cerrada (. ? ! o salto de
 * línea). Si todavía no se ha soltado nada y la primera frase se alarga, también en la última coma
 * (o punto y coma, o dos puntos) pasados los 60 caracteres: la voz empieza a hablar antes y la pausa
 * de una coma suena natural. Una línea PEDIR_HERRAMIENTA empieza línea, así que nunca queda antes.
 */
export function puntoDeCorte(cuerpo: string, enviado: number): number {
  const frase = Math.max(cuerpo.lastIndexOf('. '), cuerpo.lastIndexOf('? '), cuerpo.lastIndexOf('! '), cuerpo.lastIndexOf('\n'));
  if (frase > enviado || enviado > 0) return frase;
  const coma = Math.max(cuerpo.lastIndexOf(', '), cuerpo.lastIndexOf('; '), cuerpo.lastIndexOf(': '));
  return coma >= 60 ? coma : frase;
}
