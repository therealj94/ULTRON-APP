/**
 * CUÁNDO SOLTAR TEXTO DEL MODELO MIENTRAS LLEGA (el streaming de /api/turno/stream y de la voz).
 *
 * El modelo escribe a trozos de pocas letras; soltar cada trozo haría que la voz lea medias palabras
 * y que una línea de pedido de herramienta («PEDIR_HERRAMIENTA: …») se escapara a la pantalla. Esperar
 * la respuesta entera haría esperar segundos por la primera palabra. Se suelta por frases.
 *
 * Dónde se puede cortar lo decide UN contrato compartido con la app y la mesa web
 * (mobile/src/lib/cortesVoz.ts; auditoría externa del 6-oct, VOZ-05): lo que aquí se suelta hasta un corte,
 * la app lo vuelve a cortar en el mismo sitio sin retener nada. Antes este archivo esperaba el espacio de
 * después del punto, partía «Dr. Gómez» tras «Dr.» y solo usaba la coma en el primer tramo que soltaba.
 */
import { COMA_PRIMERA as COMA_PRIMERA_VOZ, cortesDe } from '../mobile/src/lib/cortesVoz';

/**
 * Hasta dónde se puede soltar lo que va llegando del modelo: el índice del ÚLTIMO carácter del último corte
 * (se suelta `cuerpo.slice(enviado, corte + 1)`), o -1 si no hay corte después de `enviado`. Los cortes son
 * los del contrato: frases cerradas (aunque el punto sea lo último llegado, salvo una cifra o una
 * abreviatura) y, en la primera frase de la respuesta o en una que se alarga, una cláusula segura en su coma.
 * Una línea PEDIR_HERRAMIENTA empieza línea, así que nunca queda antes de un corte.
 */
export function puntoDeCorte(cuerpo: string, enviado: number): number {
  const cortes = cortesDe(cuerpo);
  const ultimo = cortes.length ? cortes[cortes.length - 1].fin - 1 : -1;
  return ultimo > enviado ? ultimo : -1;
}

/**
 * Desde cuántos caracteres la PRIMERA frase se puede soltar en una coma. Antes 60: una respuesta de
 * una sola frase larga («Te recomiendo empezar por lo más urgente, revisar…») salía entera al final y
 * la voz esperaba al 27B completo. Con ~28 sale el primer tramo con sentido («Te recomiendo empezar
 * por lo más urgente,») y la app pide su audio mientras el modelo sigue escribiendo; una coma
 * temprana («Mira,») sigue esperando. Es el mismo número que el de la app (viene de ahí).
 */
export const COMA_PRIMERA = COMA_PRIMERA_VOZ;
