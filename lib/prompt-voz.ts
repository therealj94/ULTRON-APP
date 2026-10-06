/**
 * EL PROMPT DE UN TURNO HABLADO CON EL CEREBRO CON MANOS (Bedrock), SIN LO QUE CASI NUNCA HACE FALTA.
 *
 * José, 6-oct: la «primera ficha» de la mesa hablada pasó de 905 ms (mediana) a 2023 ms de un día a otro. Medido con el
 * server.ts de verdad contra un Bedrock falso (el mismo turno, ca375c3 contra a2ccc94): el pedido era casi igual de
 * grande los dos días (~30 000 caracteres, 9 473 fichas en GLM-5: +0,7 %), así que la subida fue del proveedor. Pero
 * cada ficha cuenta: con el mismo proveedor, 9 339 → 5 758 fichas bajaron la primera señal de Kimi de 1,3 s a 0,77 s.
 *
 * Bedrock no reutiliza lo leído de un turno a otro (no hay caché de prefijo para GLM ni Kimi), así que aquí lo que no
 * hace falta en ESTE turno no va, sin costo para el turno siguiente (el system del nodo, que sí reutiliza, no cambia):
 *
 *  · el MENÚ DE LA APP (dónde está cada cosa) solo si pregunta cómo o dónde hacer algo en la app;
 *  · TUS MANOS AQUÍ (lo que puede ofrecer) solo si pregunta qué puede hacer; las herramientas ya dicen qué hace cada
 *    una y las reglas de MANOS (el «sí» antes de mandar, nunca decir que salió sin el resultado) van SIEMPRE;
 *  · el «piensa paso a paso» (COT) no va en la voz: son dos o tres frases dichas en voz alta.
 *
 * Lo que cuida a la persona no se toca: el consentimiento, el «sí» al texto exacto, quién habla (la dueña o no), los
 * avisos de seguridad del turno y lo que espera su decisión van siempre que tocan.
 */

const sinTildes = (s: string) =>
  String(s || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();

/** ¿Pregunta cómo o dónde hacer algo en la app? (entonces el menú sirve para guiarla paso a paso). */
const GUIA =
  /\b(como (hago|le hago|se hace|se pone|pongo|conecto|activo|desactivo|agrego|vinculo|cambio|quito|apago|prendo|enciendo|entro|abro|veo|configuro|uso|salgo|cierro|pago|cobro)|donde (esta|estan|queda|encuentro|veo|pongo|se pone|se cambia|se ve|se activa)|en que (parte|pantalla|menu|lado)|configur\w*|ajustes?|vincul\w*|conect\w*|permisos?|menu|boton\w*|pestana\w*|instal\w*|actualiz\w*|no (lo )?encuentro|no me (sale|aparece)|paso a paso|guiame|ensename a|how do i|where (is|are|do i)|settings)\b/;

/** ¿Pregunta qué puede hacer AU-RA (o si puede algo)? (entonces la ficha de lo que ofrece sirve). */
const CAPACIDADES = /\b(que (puedes|podes|sabes|haces|mas)|puedes|podes|podrias|sabes hacer|eres capaz|me (ayudas|puedes ayudar)|ayudame|funciones|capacidades|para que sirves|what (can|else) you|can you|are you able)\b/;

export function pideGuiaDeApp(texto: string): boolean {
  return GUIA.test(sinTildes(texto));
}

export function pideCapacidades(texto: string): boolean {
  return CAPACIDADES.test(sinTildes(texto));
}

/**
 * Las reglas de la app para el cerebro con manos en un turno HABLADO: siempre las reglas de MANOS; la ficha de lo que
 * ofrece y el menú de la app solo si lo que dijo (o lo último que dijo antes) los pide. `voz: false` (escrito): todo,
 * como siempre.
 */
export function reglasAppDelTurno(o: { voz: boolean; manosAqui: string; menuAqui: string; reglasManos: string; mensaje: string; anterior?: string }): string {
  const dicho = `${o.mensaje}\n${o.anterior || ''}`;
  const manos = !o.voz || pideCapacidades(dicho) ? o.manosAqui : '';
  const menu = !o.voz || pideGuiaDeApp(dicho) ? o.menuAqui : '';
  return [manos, menu, o.reglasManos].filter((x) => x && x.trim()).join('\n');
}

/**
 * EL PRESUPUESTO DE UN TURNO HABLADO (fichas estimadas, lib/tiempos-turno.ts fichasEstimadas): lo que se le manda a
 * Bedrock en un turno pesado y realista (cámara con caras, otra voz que habla, WhatsApp, diez contactos, cinco turnos de
 * hilo, una pregunta que pide «analiza a fondo»). Medido con tests/voz-presupuesto.test.ts el 6-oct:
 *   · a2ccc94 (antes): system y mensajes ~5 586 fichas; con las 24 herramientas (~4 257), ~9 843;
 *   · con esto:         system y mensajes ~4 616 fichas; total ~8 873.
 * Las herramientas no cambian (sus descripciones llevan el «sí» antes de mandar y lo que nunca se dice sin resultado).
 */
export const PRESUPUESTO_VOZ_FICHAS = 9300;
/** Solo el system y los mensajes (sin las herramientas). */
export const PRESUPUESTO_VOZ_TEXTO_FICHAS = 5000;
