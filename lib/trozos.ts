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

/**
 * EL TOPE DE VOZ TERMINA EN UNA FRASE ENTERA (José, 6-oct, APK 5.5.0: «la llamada fue fluida pero de repente falló»).
 * Lo que se suelta mientras llega puede acabar en la coma de una cláusula larga (el contrato de cortesVoz.ts), y el
 * tope se miraba ahí: a las 17:11 «[voz] tope: dijo 295 de 326 caracteres» y «252 de 349» callaban a media frase
 * («…el segundo es de Beto, que pregunta por la factura pendiente,» y nada más), y eso suena a que se cortó la llamada.
 *
 * Cuando lo dicho ya llegó al tope, esto dice hasta dónde seguir para terminar la frase en curso:
 *  · `entera`: lo dicho ya acaba en un final de frase (o no se dijo nada; `hasta` = `enviado`), o la frase que quedó a
 *    medias ya llegó cerrada y cabe en `limite` (`hasta` = su final): se dice hasta ahí y se para;
 *  · `esperar`: su final todavía no llegó (el modelo sigue escribiendo): no se para ni se suelta otra coma;
 *  · `larga`: su final pasaría de `limite` (una frase descomunal): se queda como está, en su pausa.
 * Con `completo` (el texto ya llegó entero), el final del texto también es final de frase.
 */
export type CierreFrase = { estado: 'entera' | 'esperar' | 'larga'; hasta: number };

export function cierreDeFrase(cuerpo: string, enviado: number, o: { completo?: boolean; limite?: number } = {}): CierreFrase {
  const t = String(cuerpo || '');
  if (enviado <= 0) return { estado: 'entera', hasta: 0 };
  const limite = o.limite ?? Infinity;
  const finales = cortesDe(t, { comas: false }).map((c) => c.fin);
  // Lo dicho ya acaba en un final de frase (con o sin el espacio que lo sigue).
  let antes = 0;
  for (const f of finales) {
    if (f > enviado) break;
    antes = f;
  }
  if (finales.includes(enviado) || (antes > 0 && !t.slice(antes, enviado).trim())) return { estado: 'entera', hasta: enviado };
  if (enviado >= t.trimEnd().length && o.completo) return { estado: 'entera', hasta: enviado };
  const sigue = finales.find((f) => f > enviado);
  const fin = sigue ?? (o.completo ? t.trimEnd().length : -1);
  if (fin < 0) return { estado: 'esperar', hasta: enviado };
  if (fin > limite) return { estado: 'larga', hasta: enviado };
  return { estado: 'entera', hasta: Math.max(enviado, fin) };
}

/**
 * Lo más que se alarga lo dicho sobre el tope duro para terminar la frase que quedó a medias (~10 s de voz). Más allá
 * (una frase descomunal, sin punto) se queda en su pausa, como antes.
 */
export const FRASE_EXTRA_VOZ = 180;
