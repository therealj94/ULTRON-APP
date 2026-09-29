/**
 * LO QUE SE LE PIDE AL MAPA CON PALABRAS, reconocido igual en el navegador (respuesta inmediata) y
 * en el servidor (garantía del turno): ir a un lugar de Honduras y marcar solo las concesiones de
 * un mineral o de una clase. Sin DOM ni base: se prueba solo.
 */

export type Mineral =
  | 'oro' | 'plata' | 'cobre' | 'zinc' | 'plomo' | 'hierro' | 'antimonio' | 'manganeso' | 'molibdeno' | 'estaño'
  | 'ópalo' | 'carbón' | 'caliza' | 'mármol' | 'yeso' | 'arcilla' | 'arena' | 'grava' | 'piedra' | 'puzolana';

const fold = (s: string) =>
  String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');

/** El mineral (o la clase) que alguien pide ver: «las de oro», «las que tengan cobre», «las no metálicas». */
export function mineralDePedido(texto: string): Mineral | 'metalicas' | 'no metalicas' | null {
  const t = fold(texto);
  if (/\bno metalic/.test(t)) return 'no metalicas';
  if (/\bmetalic/.test(t)) return 'metalicas';
  const nombres: Array<[Mineral, RegExp]> = [
    ['oro', /\boro\b/], ['plata', /\bplata\b/], ['cobre', /\bcobre\b/], ['zinc', /\bzinc\b/], ['plomo', /\bplomo\b/],
    ['hierro', /\bhierro\b/], ['antimonio', /\bantimonio\b/], ['manganeso', /\bmanganeso\b/], ['molibdeno', /\bmolibdeno\b/],
    ['estaño', /\bestano\b/], ['ópalo', /\bopalos?\b/], ['carbón', /\bcarbon\b/], ['caliza', /\b(caliza|cal)\b/],
    ['mármol', /\bmarmol\b/], ['yeso', /\byeso\b/], ['arcilla', /\b(arcilla|caolin|bentonita)\b/], ['arena', /\barenas?\b/],
    ['grava', /\bgravas?\b/], ['piedra', /\bpiedras?\b/], ['puzolana', /\bpuzolana\b/],
  ];
  return nombres.find(([, re]) => re.test(t))?.[0] ?? null;
}

/** ¿Es un pedido de filtrar el mapa por mineral? «muéstrame solo las de oro», «marca las de plata». */
export function pedidoDeFiltro(texto: string): ReturnType<typeof mineralDePedido> | 'quitar' | null {
  const t = fold(texto);
  if (/\b(quita|quitar|borra|limpia|sin)( el| los)? filtros?\b|\b(todas|todas las concesiones) (otra vez|de nuevo)\b|\bmuestra(me)? todas\b/.test(t)) return 'quitar';
  if (!/\b(muestra|muestrame|ensename|marca|marcame|filtra|resalta|pinta|solo|solamente|quiero ver|ver|cuales|dame)\b/.test(t)) return null;
  if (!/\b(concesion|concesiones|las de|las que|minas|derechos|las con|con indicios|las (no )?metalicas)\b/.test(t)) return null;
  return mineralDePedido(t);
}

/**
 * ¿Es un pedido de IR a un lugar? «llévame a Juticalpa», «ve a La Ceiba», «vamos al cerro Uyuca»,
 * «¿dónde queda Trujillo?». Devuelve lo que hay que buscar, o null.
 */
export function pedidoDeLugar(texto: string): string | null {
  const t = String(texto || '').trim().replace(/[¿?¡!.]+/g, ' ').trim();
  const m = t.match(
    /^(?:(?:dr\.?|doctor|electrum)[, ]+)?(?:por favor[, ]+)?(?:ll[eé]v[aá](?:me|nos)|lleva(?:me|nos)|ve(?:te)?|vamos|v[aá]monos|ir|anda|vu[eé]la|volemos|mu[eé]strame|ens[eé][ñn]ame|ub[ií]ca(?:me)?|busca en el mapa|ponme|d[oó]nde (?:queda|est[aá]))\s+(?:(?:a|al|hacia|hasta|para|en)\s+)?(.+)$/i
  );
  if (!m) return null;
  const resto = m[1].replace(/^(?:la ciudad de|el municipio de|el departamento de|la aldea|el pueblo de|el lugar)\s+/i, '').trim();
  if (!resto || resto.split(/\s+/).length > 7) return null;
  // Cosas del mapa que no son lugares: las atienden los comandos o el cerebro.
  if (/\b(concesi|expediente|mapa|capa|catastro|norte|sur|este|oeste|arriba|abajo|izquierda|derecha|ubicaci[oó]n|las de|los de|solo|sólo|concesiones|todas|todo el pa[ií]s|honduras)\b/i.test(resto)) return null;
  return resto;
}
