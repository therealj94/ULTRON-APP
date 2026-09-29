/**
 * EL MAPA NO DEPENDE DE QUE EL MODELO SE ACUERDE DE MOVERLO.
 *
 * Visto en producción (27-09): José pidió «muéstrame Los Chaguites en el mapa» y el doctor contestó
 * «Ahí la tiene, resaltada en el mapa» SIN llamar a `mapa_volar`: el mapa se quedó en Honduras
 * entera. El modelo imitaba su propia respuesta del turno anterior, que sí había volado. Pedirle en
 * el prompt que no lo haga es pedirle que se porte bien; esto lo hace imposible:
 *
 *  · Si la persona pidió ver algo en el mapa, o la respuesta DICE que lo mostró, y en este turno no
 *    salió ninguna orden para el mapa, se resuelve qué concesión era —por el id o el expediente que
 *    nombra la respuesta, por lo que pidió la persona, o por lo último que se habló— y se vuela.
 *  · Si no se puede saber cuál era, la respuesta no puede quedar diciendo que ya está en el mapa: se
 *    le agrega que no se movió y qué hace falta para moverlo.
 */
import type { MsgHilo } from './hilo';
import { buscarConcesiones, geometriaDe, unicaExacta, type FilaConcesion } from './db';
import { buscarLugar, pedidoDeLugar } from './lugares';
import { pedidoDeFiltro } from './minerales';

/** La persona quiere VER algo: muéstrame, enséñame, ubícala, ¿dónde queda?, llévame, en el mapa… */
export const PIDE_MAPA = /\b(mu[eé]str|mostr|ens[eé][ñn]|ub[ií]ca|ubicaci[oó]n|d[oó]nde (queda|est[aá])|ll[eé]v[aá]me|vol[aá] (a|hasta)|localiza|en el mapa|al mapa)/i;
/** La respuesta dice que ya lo enseñó. */
export const DICE_MAPA = /(en el mapa|resaltad[ao]|ah[ií] la tien|ah[ií] lo tien|ya est[aá] sobre|se la muestro|te la muestro|mir[ae] el mapa|la ves en el mapa)/i;

/** ¿Alguna orden de este turno ya movió o pintó el mapa? */
export const movioElMapa = (ui: Array<Record<string, unknown>>) =>
  ui.some((d) => (d?.accion === 'volar' || d?.accion === 'capa' || d?.accion === 'candidatas') && !!d.geojson);

/** Lo que sobra de un pedido cuando se le quitan las palabras de pedir y de relleno. */
const RELLENO = new Set(
  (
    'muestrame mostrame muestra mostra ensename ensena ubicame ubica ubicala ubicalo llevame lleva vola volar volá hasta ' +
    'donde queda esta está en el la lo los las un una unos unas de del al mapa por favor pf porfa ahi ahí esa ese esta este ' +
    'concesion concesión consesion concesiones y a me te se ver verla verlo quiero dame alguna algun algún otra otro cual cuál ' +
    'que qué sobre dr doctor electrum'
  )
    .split(/\s+/)
    .map((w) => w.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase())
);
export function nombreDelPedido(mensaje: string): string {
  return String(mensaje || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9ñ\s-]/g, ' ')
    .split(/\s+/)
    .filter((w) => w && !RELLENO.has(w))
    .join(' ')
    .trim();
}

type Resuelta = { id: number; nombre: string };

/** «(id 7)», «id 7», «expediente 1276» en un texto: lo más fiable, porque lo escribió una herramienta. */
async function porReferencias(texto: string): Promise<Resuelta | null> {
  const ids = [...String(texto).matchAll(/\bid\s*(\d{1,7})\b/gi)].map((m) => Number(m[1]));
  for (const id of ids.reverse()) {
    const g = await geometriaDe(id).catch(() => null);
    if (g) return { id, nombre: `la concesión ${id}` };
  }
  const exps = [...String(texto).matchAll(/\bexpediente\s+(?:n[°ºo.]*\s*)?([\w./-]{1,30})/gi)].map((m) => m[1].replace(/[.,;:]+$/, ''));
  for (const e of exps.reverse()) {
    const f = await porExpediente(e);
    if (f) return f;
  }
  /*
   * «la concesión 1276»: la gente dice el número del expediente, no el id interno. Se prueba como
   * expediente y, si no hay ninguno así, como id.
   */
  const nums = [...String(texto).matchAll(/\bcon[cs]esi[oó]n\s+(?:n[°ºo.]*\s*)?(\d{1,7})\b/gi)].map((m) => m[1]);
  for (const n of nums.reverse()) {
    const f = await porExpediente(n);
    if (f) return f;
    const g = await geometriaDe(Number(n)).catch(() => null);
    if (g) return { id: Number(n), nombre: `la concesión ${n}` };
  }
  return null;
}

async function porExpediente(e: string): Promise<Resuelta | null> {
  const filas = await buscarConcesiones(e, 6).catch(() => [] as FilaConcesion[]);
  const f = filas.find((x) => String(x.expediente || '').toLowerCase() === e.toLowerCase());
  return f ? { id: Number(f.id), nombre: f.nombre } : null;
}

/** Por el nombre que queda en el pedido, si da UNA sola concesión. */
async function porNombre(texto: string): Promise<Resuelta | null> {
  const q = nombreDelPedido(texto);
  if (q.length < 3) return null;
  const filas = await buscarConcesiones(q, 6).catch(() => [] as FilaConcesion[]);
  const f = filas.length === 1 ? filas[0] : unicaExacta(filas, q);
  return f ? { id: Number(f.id), nombre: f.nombre } : null;
}

/** Qué concesión quiso ver, o null si no hay forma honesta de saberlo. */
export async function concesionAMostrar(mensaje: string, respuesta: string, historial: MsgHilo[] = []): Promise<Resuelta | null> {
  return (
    (await porReferencias(respuesta)) ||
    // Lo que pidió la persona, por número antes que por nombre: «muéstrame el expediente 1276».
    (await porReferencias(mensaje)) ||
    (await porNombre(mensaje)) ||
    // Lo último que se habló, de lo más nuevo a lo más viejo: «muéstramela en el mapa» después de
    // que el doctor la nombró.
    (await (async () => {
      for (const m of [...historial].reverse().slice(0, 6)) {
        const r = (await porReferencias(m.content)) || (m.role === 'user' ? await porNombre(m.content) : null);
        if (r) return r;
      }
      return null;
    })())
  );
}

export type Garantia = { ui?: Record<string, unknown>; texto: string; nota?: string };

/**
 * Después del turno: si hacía falta mover el mapa y no se movió, se mueve; si no se puede, se dice.
 * `canal` telegram no tiene mapa: ahí no se hace nada.
 */
/** Los ids de concesión distintos que trajeron las herramientas del turno («… (id 1397) …»). */
export function idsEnHerramientas(texto: string): number[] {
  return [...new Set([...String(texto || '').matchAll(/\bid (\d{1,7})\b/g)].map((m) => Number(m[1])))];
}

export async function garantizarMapa(p: {
  mensaje: string;
  texto: string;
  ui: Array<Record<string, unknown>>;
  historial?: MsgHilo[];
  canal?: string;
  /** Lo que devolvieron las herramientas que salieron bien, junto. */
  herramientas?: string;
}): Promise<Garantia> {
  if (p.canal === 'telegram') return { texto: p.texto };
  // «Muéstrame solo las de oro»: si el turno no marcó el filtro, se marca aquí.
  const filtro = pedidoDeFiltro(p.mensaje);
  if (filtro && !p.ui.some((d) => d?.accion === 'filtrar')) {
    return { texto: p.texto, ui: { accion: 'filtrar', mineral: filtro === 'quitar' ? null : filtro }, nota: `filtro del mapa: ${filtro}` };
  }
  if (movioElMapa(p.ui) || p.ui.some((d) => d?.accion === 'lugar' || d?.accion === 'filtrar')) return { texto: p.texto };
  const pide = PIDE_MAPA.test(p.mensaje) || !!pedidoDeLugar(p.mensaje);
  const dice = DICE_MAPA.test(p.texto);
  /*
   * Se habla de UNA concesión (las herramientas trajeron una sola): el mapa va a ella aunque nadie
   * haya dicho «muéstrame». Si estamos hablando de Clavo Rico, Clavo Rico tiene que estar en pantalla.
   */
  const unicas = idsEnHerramientas(p.herramientas || '');
  if (!pide && !dice && unicas.length === 1) {
    const g = await geometriaDe(unicas[0]).catch(() => null);
    if (g) {
      return {
        texto: p.texto,
        ui: { accion: 'volar', concesion_id: unicas[0], centro: g.centro, encuadre: g.encuadre, geojson: g.geojson, resaltar: true, garantia: true },
        nota: `el mapa voló a la concesión ${unicas[0]}: es de la que se habló`,
      };
    }
  }
  if (!pide && !dice) return { texto: p.texto };
  const c = await concesionAMostrar(p.mensaje, p.texto, p.historial || []);
  if (c) {
    const g = await geometriaDe(c.id).catch(() => null);
    if (g) {
      return {
        texto: p.texto,
        ui: { accion: 'volar', concesion_id: c.id, centro: g.centro, encuadre: g.encuadre, geojson: g.geojson, resaltar: true, garantia: true },
        nota: `el mapa voló a ${c.nombre} (id ${c.id}) aunque el modelo no lo pidió`,
      };
    }
  }
  // No es una concesión: ¿un lugar de Honduras? («llévame a Juticalpa», «¿dónde queda Trujillo?»)
  const q = pedidoDeLugar(p.mensaje);
  const l = q ? buscarLugar(q) : null;
  if (l) {
    return {
      texto: p.texto,
      ui: { accion: 'lugar', nombre: l.lugar.nombre, tipo: l.lugar.tipo, departamento: l.lugar.departamento, centro: l.lugar.centro, zoom: l.lugar.zoom },
      nota: `el mapa fue a ${l.lugar.nombre} (${l.lugar.tipo})`,
    };
  }
  if (dice) {
    return {
      texto: `${p.texto}\n\n(Ojo: el mapa no se movió esta vez. Decime el nombre o el expediente de la concesión y te la muestro.)`,
      nota: 'la respuesta decía que lo mostró y no se pudo saber qué concesión era',
    };
  }
  return { texto: p.texto };
}
