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
 * (o punto y coma, o dos puntos) pasados COMA_PRIMERA caracteres: la voz empieza a hablar antes y la
 * pausa de una coma suena natural. Una línea PEDIR_HERRAMIENTA empieza línea, así que nunca queda antes.
 */
export function puntoDeCorte(cuerpo: string, enviado: number): number {
  const frase = Math.max(cuerpo.lastIndexOf('. '), cuerpo.lastIndexOf('? '), cuerpo.lastIndexOf('! '), cuerpo.lastIndexOf('\n'));
  if (frase > enviado || enviado > 0) return frase;
  const coma = Math.max(cuerpo.lastIndexOf(', '), cuerpo.lastIndexOf('; '), cuerpo.lastIndexOf(': '));
  return coma >= COMA_PRIMERA ? coma : frase;
}

/**
 * Desde cuántos caracteres la PRIMERA frase se puede soltar en una coma. Antes 60: una respuesta de
 * una sola frase larga («Te recomiendo empezar por lo más urgente, revisar…») salía entera al final y
 * la voz esperaba al 27B completo. Con ~28 sale el primer tramo con sentido («Te recomiendo empezar
 * por lo más urgente,») y la app pide su audio mientras el modelo sigue escribiendo; una coma
 * temprana («Mira,») sigue esperando.
 */
export const COMA_PRIMERA = 28;
