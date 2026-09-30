/**
 * Lector de eventos SSE (text/event-stream) para lo que llega a trozos por XMLHttpRequest.
 *
 * `fetch` de React Native no entrega el cuerpo por partes; el XHR sí (onprogress con responseText
 * creciendo), en Android también. Este lector recibe el texto COMPLETO acumulado cada vez y devuelve
 * solo los eventos nuevos y enteros: un bloque a medias se queda para la próxima.
 *
 * Sin React Native: las pruebas lo usan en Node.
 */

export type EventoSse = { evento: string; datos: string; id?: string };

export class LectorSse {
  private visto = 0;

  /** Todo el texto recibido hasta ahora → los eventos completos que no se habían leído. */
  leer(total: string): EventoSse[] {
    if (total.length < this.visto) this.visto = 0; // otra conexión: se empieza de cero
    const nuevo = total.slice(this.visto);
    const corte = /\r?\n\r?\n/g;
    const out: EventoSse[] = [];
    let desde = 0;
    let m: RegExpExecArray | null;
    while ((m = corte.exec(nuevo))) {
      const ev = partirBloque(nuevo.slice(desde, m.index).replace(/\r/g, ''));
      desde = m.index + m[0].length;
      if (ev) out.push(ev);
    }
    // Lo que queda sin su línea en blanco se lee la próxima vez.
    this.visto += desde;
    return out;
  }

  reiniciar() {
    this.visto = 0;
  }
}

/** Un bloque SSE → evento. Comentarios («: ping») y bloques sin `data:` no son eventos. */
export function partirBloque(bloque: string): EventoSse | null {
  let evento = 'message';
  let id: string | undefined;
  const datos: string[] = [];
  for (const linea of bloque.split('\n')) {
    if (!linea || linea.startsWith(':')) continue;
    const dos = linea.indexOf(':');
    const campo = dos < 0 ? linea : linea.slice(0, dos);
    const valor = dos < 0 ? '' : linea.slice(dos + 1).replace(/^ /, '');
    if (campo === 'event') evento = valor.trim() || 'message';
    else if (campo === 'data') datos.push(valor);
    else if (campo === 'id') id = valor.trim();
  }
  if (!datos.length) return null;
  return { evento, datos: datos.join('\n'), ...(id ? { id } : {}) };
}

/** El JSON de un evento, o null si no es JSON (un evento ajeno no rompe nada). */
export function jsonDe<T = any>(ev: EventoSse): T | null {
  try {
    return JSON.parse(ev.datos) as T;
  } catch {
    return null;
  }
}
