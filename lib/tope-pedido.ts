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
 * Aquí, sin red: si system + contexto + HECHOS + hilo + mensaje pasan del tope, en este orden:
 *   1) se ACORTAN los mensajes largos del hilo, de los más viejos a los más nuevos, dejando el principio y el final con
 *      «…» en medio (los últimos HILO_INTOCABLE no, todavía);
 *   2) si lo que falta es poco (menos de AHORRO_MINIMO_DESCARTE) y recortar alcanza, se recortan el HECHO más largo y los
 *      últimos mensajes, sin quitar ninguno entero (auditoría del 10-oct: «hilo -4» dos veces para ahorrar 390 y 104
 *      caracteres);
 *   3) se quita lo más VIEJO del hilo, entero (nunca los últimos HILO_INTOCABLE mensajes);
 *   4) se recorta el HECHO más largo (con la marca «…(recortado)»), después los últimos mensajes y, como último recurso,
 *      el mensaje.
 * Solo para Bedrock: el Qwen del nodo reutiliza lo leído y su prefijo no cambia.
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
/** Los últimos mensajes del hilo que nunca se quitan enteros (y empiezan por la persona). */
export const HILO_INTOCABLE = 4;
/** Un mensaje viejo del hilo no baja de esto al acortarlo (principio y final). */
const HILO_MINIMO_CAR = 300;
/** Uno de los últimos no baja de esto. */
const HILO_RECIENTE_MINIMO_CAR = 800;
/** No se quita un mensaje entero para ahorrar menos que esto si recortar alcanza. */
export const AHORRO_MINIMO_DESCARTE = 800;

/** El principio y el final de un texto, con «…» en medio, en `n` caracteres como mucho. */
export function recortarMedio(texto: string, n: number): string {
  const t = String(texto || '');
  if (t.length <= n) return t;
  const cabe = Math.max(2, n - 1);
  const cabeza = Math.ceil(cabe * 0.65);
  return `${t.slice(0, cabeza).trimEnd()}…${t.slice(t.length - (cabe - cabeza)).trimStart()}`;
}

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
  /** Desde dónde va lo intocable: los últimos HILO_INTOCABLE, empezando por la persona. */
  const intocableDesde = () => {
    let i = Math.max(0, p.hilo.length - HILO_INTOCABLE);
    while (i > 0 && p.hilo[i]?.role === 'assistant') i--;
    return i;
  };
  /** Acorta el mensaje i del hilo hasta `minimo`, sin pasarse de lo que sobra. Devuelve lo ahorrado. */
  const acortar = (i: number, minimo: number) => {
    const c = String(p.hilo[i].content || '');
    const sobra = largo(p) - tope;
    if (sobra <= 0 || c.length <= minimo) return 0;
    const nuevo = recortarMedio(c, Math.max(minimo, c.length - sobra));
    p.hilo[i] = { ...p.hilo[i], content: nuevo };
    return c.length - nuevo.length;
  };
  let acortados = 0;
  // 1) Los mensajes largos del hilo, de los más viejos a los más nuevos (los últimos, todavía no).
  for (let i = 0; i < intocableDesde() && largo(p) > tope; i++) if (acortar(i, HILO_MINIMO_CAR) > 0) acortados++;
  // 2) Falta poco y recortar alcanza: el HECHO más largo y los últimos mensajes, sin quitar ninguno entero.
  let hechosRecortados = 0;
  const recortarHechos = () => {
    for (let vuelta = 0; largo(p) > tope && vuelta < 64; vuelta++) {
      let i = -1;
      for (let j = 0; j < p.hechos.length; j++) if (p.hechos[j].length > HECHO_MINIMO_CAR && (i < 0 || p.hechos[j].length > p.hechos[i].length)) i = j;
      if (i < 0) break;
      const h = p.hechos[i].endsWith(MARCA) ? p.hechos[i].slice(0, -MARCA.length) : p.hechos[i];
      const sobra = largo(p) - tope;
      const nuevo = Math.max(HECHO_MINIMO_CAR, Math.min(Math.floor(h.length / 2), h.length - sobra));
      if (nuevo >= h.length) break;
      p.hechos[i] = `${h.slice(0, nuevo).trimEnd()}${MARCA}`;
      hechosRecortados++;
    }
  };
  const recortarRecientes = () => {
    for (let i = intocableDesde(); i < p.hilo.length && largo(p) > tope; i++) if (acortar(i, HILO_RECIENTE_MINIMO_CAR) > 0) acortados++;
  };
  const sobra = largo(p) - tope;
  if (sobra > 0 && sobra < AHORRO_MINIMO_DESCARTE) {
    const cabeHechos = p.hechos.reduce((n, h) => n + Math.max(0, h.length - HECHO_MINIMO_CAR - MARCA.length), 0);
    const cabeHilo = p.hilo.slice(intocableDesde()).reduce((n, m) => n + Math.max(0, String(m.content || '').length - HILO_RECIENTE_MINIMO_CAR), 0);
    if (cabeHechos + cabeHilo >= sobra) {
      recortarHechos();
      recortarRecientes();
    }
  }
  // 3) Lo más viejo del hilo, entero (nunca los últimos HILO_INTOCABLE).
  let quitados = 0;
  while (largo(p) > tope && intocableDesde() > 0) {
    p.hilo.shift();
    quitados++;
  }
  // Bedrock exige que el hilo empiece por la persona: un asistente suelto al principio se quita también.
  while (p.hilo.length && p.hilo[0].role === 'assistant' && quitados > 0) {
    p.hilo.shift();
    quitados++;
  }
  if (quitados) recortes.push(`hilo -${quitados}`);
  // 4) El HECHO más largo, a la mitad (sin bajar del mínimo), hasta que quepa; después los últimos mensajes.
  recortarHechos();
  if (hechosRecortados) recortes.push(`hechos ×${hechosRecortados}`);
  recortarRecientes();
  if (acortados) recortes.push(`hilo ✂${acortados}`);
  // 3) Lo que pegó o dictó, como último recurso.
  if (largo(p) > tope && p.mensaje.length > MENSAJE_MINIMO_CAR) {
    const cabe = Math.max(MENSAJE_MINIMO_CAR, p.mensaje.length - (largo(p) - tope));
    p.mensaje = `${p.mensaje.slice(0, cabe).trimEnd()}${MARCA}`;
    recortes.push('mensaje');
  }
  return { ...p, recortes, antes, despues: largo(p) };
}
