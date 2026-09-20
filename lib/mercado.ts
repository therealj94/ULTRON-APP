/**
 * EL SPOT DE LOS METALES — uno solo, para los dos cerebros.
 *
 * Esto estaba escrito dos veces: una en `server.ts` para ULTRON, con caché de treinta segundos, y
 * otra en las manos de Electrum, sin caché ninguna. Dos copias de la misma llamada no es solo
 * desorden: gold-api.com limita por IP, las dos plataformas salen por la MISMA IP de Render, y la
 * copia sin caché le gastaba el cupo a la que sí la tenía. El precio del oro de la junta se caía
 * por culpa de la demostración minera.
 *
 * Esta es una de las pocas herramientas que de verdad se comparten. La mayoría no: el catastro y el
 * mapa son de Electrum, el taller y la bóveda son de ULTRON, y prestarlas sería juntar lo que se
 * pidió separar. Se comparte el precio del oro porque el oro es el mismo oro.
 */

export type Spot = { sym: 'XAU' | 'XAG'; metal: 'oro' | 'plata'; usd: number; fuente: string; updatedAt: string | null };

const TTL_MS = 30_000;
const cache = new Map<string, { at: number; dato: Spot }>();

export function simboloDe(metal: unknown): 'XAU' | 'XAG' {
  return String(metal || '').toLowerCase().startsWith('plat') ? 'XAG' : 'XAU';
}

/** Precio spot en dólares por onza troy. Lanza si la fuente no responde: nadie inventa un precio. */
export async function spotMetal(sym: 'XAU' | 'XAG'): Promise<Spot> {
  const hit = cache.get(sym);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.dato;

  const r = await fetch(`https://api.gold-api.com/price/${sym}`, { signal: AbortSignal.timeout(8000) });
  const j: any = await r.json();
  const precio = Number(j?.price ?? j?.bid ?? j?.ask);
  if (!isFinite(precio) || precio <= 0) throw new Error('gold-api sin price');

  const dato: Spot = {
    sym,
    metal: sym === 'XAG' ? 'plata' : 'oro',
    usd: precio,
    fuente: 'gold-api.com',
    updatedAt: j?.updatedAt || null,
  };
  cache.set(sym, { at: Date.now(), dato });
  return dato;
}

/** Pruebas: vacía la caché para que la siguiente llamada vaya de verdad. */
export function olvidarSpot() {
  cache.clear();
}
