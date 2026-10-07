/**
 * EL TOPE DEL PEDIDO AL CEREBRO CON MANOS (auditoría del 7-oct, M3 / MEDIO-2: el turno `be0e7100` de José mandó
 * `prompt 50942 car. ~15920 fichas` y tardó 29 s; un turno escrito normal ya lleva ~28 000 caracteres de system y mensajes
 * más las 25 herramientas).
 *
 * Lo que puede inflar un pedido sin que nadie lo note, de más a menos: el hilo (hasta ~16 mensajes de hasta 1 800
 * caracteres escritos), los HECHOS del turno (lo que terminó su computadora o una investigación, el borrador que espera,
 * la tarea en curso, su iniciativa, las fichas de la memoria, lo que trajo una búsqueda o una página) y, rara vez, lo
 * que la persona pegó o dictó. El system no se toca (ahí van las reglas que la cuidan).
 *
 * Aquí, sin red: si system + contexto + HECHOS + hilo + mensaje pasan del tope, se quita primero lo más VIEJO del hilo
 * (siempre quedan los dos últimos mensajes), después se recorta el HECHO más largo (con la marca «…(recortado)») y, como
 * último recurso, el mensaje. Solo para Bedrock: el Qwen del nodo reutiliza lo leído y su prefijo no cambia.
 */

/** Hablando: system y mensajes (sin herramientas) ≈ 5 600 fichas como mucho (lib/prompt-voz.ts mide ~4 600 en uno pesado). */
export const TOPE_PEDIDO_VOZ_CAR = 18_000;
/** Escrito: ≈ 9 400 fichas como mucho (uno normal, ~28 000 caracteres con 16 mensajes de hilo). */
export const TOPE_PEDIDO_TEXTO_CAR = 30_000;
/** Un HECHO no baja de esto al recortarlo (lo que trae una lectura sigue sirviendo). */
const HECHO_MINIMO_CAR = 1_200;
/** El mensaje de la persona no baja de esto. */
const MENSAJE_MINIMO_CAR = 4_000;
const MARCA = ' …(recortado)';

export type PiezasPedido = { system: string; contexto?: string; hechos: string[]; hilo: Array<{ role: string; content: string }>; mensaje: string };
export type PedidoAcotado = PiezasPedido & { recortes: string[]; antes: number; despues: number };

const largo = (p: PiezasPedido) =>
  p.system.length + (p.contexto || '').length + p.hechos.reduce((n, h) => n + h.length + 1, 0) + p.hilo.reduce((n, m) => n + String(m.content || '').length, 0) + p.mensaje.length;

/** El pedido dentro de su tope (ver arriba). `recortes`: qué se quitó, sin contenido (para el log). */
export function acotarPedido(piezas: PiezasPedido, o: { voz?: boolean; tope?: number } = {}): PedidoAcotado {
  const tope = o.tope ?? (o.voz ? TOPE_PEDIDO_VOZ_CAR : TOPE_PEDIDO_TEXTO_CAR);
  const p: PiezasPedido = { ...piezas, hechos: [...piezas.hechos], hilo: [...piezas.hilo] };
  const antes = largo(p);
  const recortes: string[] = [];
  if (antes <= tope) return { ...p, recortes, antes, despues: antes };
  // 1) Lo más viejo del hilo (quedan los dos últimos mensajes).
  let quitados = 0;
  while (largo(p) > tope && p.hilo.length > 2) {
    p.hilo.shift();
    quitados++;
  }
  // Bedrock exige que el hilo empiece por la persona: un asistente suelto al principio se quita también.
  while (p.hilo.length && p.hilo[0].role === 'assistant' && quitados > 0) {
    p.hilo.shift();
    quitados++;
  }
  if (quitados) recortes.push(`hilo -${quitados}`);
  // 2) El HECHO más largo, a la mitad (sin bajar del mínimo), hasta que quepa.
  let hechosRecortados = 0;
  for (let vuelta = 0; largo(p) > tope && vuelta < 64; vuelta++) {
    let i = -1;
    for (let j = 0; j < p.hechos.length; j++) if (p.hechos[j].length > HECHO_MINIMO_CAR && (i < 0 || p.hechos[j].length > p.hechos[i].length)) i = j;
    if (i < 0) break;
    const h = p.hechos[i].endsWith(MARCA) ? p.hechos[i].slice(0, -MARCA.length) : p.hechos[i];
    const sobra = largo(p) - tope;
    const nuevo = Math.max(HECHO_MINIMO_CAR, Math.min(Math.floor(h.length / 2), h.length - sobra));
    p.hechos[i] = `${h.slice(0, nuevo).trimEnd()}${MARCA}`;
    hechosRecortados++;
  }
  if (hechosRecortados) recortes.push(`hechos ×${hechosRecortados}`);
  // 3) Lo que pegó o dictó, como último recurso.
  if (largo(p) > tope && p.mensaje.length > MENSAJE_MINIMO_CAR) {
    const cabe = Math.max(MENSAJE_MINIMO_CAR, p.mensaje.length - (largo(p) - tope));
    p.mensaje = `${p.mensaje.slice(0, cabe).trimEnd()}${MARCA}`;
    recortes.push('mensaje');
  }
  return { ...p, recortes, antes, despues: largo(p) };
}
