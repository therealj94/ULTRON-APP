/**
 * DR ELECTRUM ABRE CAPAS CONVERSANDO (instrucciones de corrección v1.0, sección 4.4).
 *
 * Antes, «dame las fichas de ocurrencia» caía en el panel de especialistas (sonaba a geología) y ese
 * panel no tenía las herramientas del mapa: Electrum contestaba de memoria y no abría nada. Esto va
 * ANTES del modelo, sin adivinar: entiende qué capa es con el catálogo (alias, nombre, ID o valor de
 * filtro), pregunta lo que falta con los valores reales, abre con las mismas órdenes que usa el panel
 * y confirma con lo que de verdad hay (cuántas, de qué color). Si no es un pedido de capas, devuelve
 * null y contesta el modelo, que también tiene las herramientas (manos.ts).
 *
 * Es puro salvo `contar`, que se inyecta: las pruebas lo corren sin base.
 */
import { normalizar } from '../../src-electrum/mapa/categorias';
import {
  palabrasSignificativas,
  buscarCapas,
  encendibleCat,
  enumerar,
  filtrosEnTexto,
  frase,
  hojasCat,
  id6,
  nombreDeColor,
  porIdDe,
  unidad,
  colorDeValor,
  type EntradaCatalogo,
  type EstadoMapa,
  type Filtros,
} from '../../src-electrum/mapa/catalogo';

/** Lo que el panel hace con cada orden (src-electrum/mapa/IndiceCapas.tsx). */
export type OrdenMapa =
  | { op: 'encender'; id: number; filtros?: Filtros; encuadrar?: boolean }
  | { op: 'filtro'; id: number; filtros: Filtros }
  | { op: 'apagar'; id: number }
  | { op: 'solo'; ids: number[] }
  | { op: 'limpiar' }
  | { op: 'acercar'; id: number; filtros?: Filtros };

/** Lo que quedó preguntado, para entender la respuesta («Todas», «Áreas protegidas»). */
export type Pendiente =
  | { tipo: 'filtro'; id: number; campo: string }
  | { tipo: 'elegir'; ids: number[]; solo?: boolean }
  | { tipo: 'ofrecer'; palabra: string };

export type Respuesta = { texto: string; ordenes: OrdenMapa[]; pendiente: Pendiente | null };

export type Entorno = {
  capas: EntradaCatalogo[];
  estado: EstadoMapa;
  pendiente?: Pendiente | null;
  /** Cuántas entidades cumplen (null si no se puede contar: teselas, imágenes). */
  contar: (id: number, filtros: Filtros) => Promise<number | null>;
};

/* ------------------------------------------------------------------ las palabras */

const VERBO_ABRIR =
  /\b(dame|deme|damelas|damelos|abre|abreme|abrime|abrir|abra|abrela|abrelas|muestra|muestrame|muestrenme|muestrelas|ensena|ensename|pon|ponme|ponga|enciende|enciendeme|prende|prendeme|activa|activame|carga|cargame|quiero ver|quisiera ver|ver|agrega|agregame|anade|anademe|trae|traeme|despliega|visualiza|pinta|dibuja|mira|necesito|deja|dejame)\b/;
const VERBO_QUITAR = /\b(quita|quitame|quitalas?|quitalos?|quitala|quitalo|cierra|cierralas?|cierralos?|apaga|apagalas?|apagalos?|esconde|escondelas?|escondelos?|oculta|ocultalas?|ocultalos?|saca|sacalas?|sacalos?|retira|retiralas?|borra|borralas?)\b/;
const PRONOMBRE = /^(quitalas?|quitalos?|quitala|quitalo|cierralas?|cierralos?|apagalas?|apagalos?|escondelas?|escondelos?|ocultalas?|ocultalos?|sacalas?|sacalos?|retiralas?|borralas?)$|\b(eso|esa|esas|esos|esta|estas|la ultima|lo ultimo)\b/;
const LIMPIAR = /^(limpia|limpiar|limpie|despeja|borra todo|apaga todo|cierra todo|quita todo)\b.*$|^(limpia|despeja)( el| todo el)? mapa|\b(quita|apaga|cierra|esconde|oculta)(r)? todas las capas\b/;
const TODAS = /\b(todas?|todos?|todo|completas?|sin filtro|cualquiera|las dos|los dos|ambas|ambos)\b/;
const GENERICAS = new Set(['zona', 'zonas', 'area', 'areas', 'capa', 'capas', 'mapa', 'mapas', 'las', 'los', 'la', 'el', 'de', 'del', 'y', 'en', 'me', 'por', 'favor', 'ahora', 'tambien', 'ademas', 'solo', 'una', 'un', 'unas', 'unos', 'que', 'hay', 'donde', 'puntos', 'lugares', 'sitios', 'datos', 'informacion', 'lo', 'le', 'mas']);
const ORDEN_MINERAL = ['oro', 'plata', 'cobre', 'plomo', 'zinc', 'hierro', 'antimonio', 'manganeso', 'niquel'];

const limpio = (t: string) => normalizar(t).replace(/\s+/g, ' ').trim();

/** Lo que va después del verbo: «ahora, además del oro, ábreme las zonas de reserva» → «las zonas de reserva». */
function objetoDe(t: string, verbo: RegExp): string {
  const m = verbo.exec(t);
  if (!m) return t;
  return t.slice(m.index + m[0].length).replace(/^(tambien|ademas|por favor|porfa|nada mas|solo|solamente)\s+/, '').trim();
}

/** El valor principal de una capa: el campo de su estilo si es por categorías; si no, el primero. */
function filtroPrincipal(e: EntradaCatalogo) {
  const fs = e.filtros || [];
  return fs.find((f) => f.campo === e.estilo?.campo) || null;
}

/** Los valores para ofrecer, en el orden de la tabla de minerales y después por nombre. */
function valoresOfrecidos(e: EntradaCatalogo, campo: string): string[] {
  const f = (e.filtros || []).find((x) => x.campo === campo);
  if (!f) return [];
  const rank = (v: string) => {
    const i = ORDEN_MINERAL.indexOf(normalizar(v).split(' ')[0]);
    return i < 0 ? 100 : i;
  };
  return f.valores.map(String).sort((a, b) => rank(a) - rank(b) || a.localeCompare(b, 'es'));
}

const minus = (v: string) => (/^[A-ZÁÉÍÓÚÑ][a-záéíóúñ]/.test(v) ? v.toLowerCase() : v);

/** Palabras que pueden acompañar un pedido de capa sin cambiar qué capa es. */
const RELLENO = new Set(['todas', 'toda', 'todo', 'todos', 'mineral', 'minerale', 'filtro', 'color', 'colore', 'ahi', 'aqui', 'favor', 'porfa', 'porfavor', 'otra', 'otro', 'vez', 'tambien', 'encima', 'zona', 'area', 'punto', 'lugar', 'sitio', 'nuevamente', 'otra vez', 'doctor', 'doc', 'electrum', 'dr', 'quisiera', 'podrias', 'puede', 'puedes', 'favor']);

/**
 * ¿Se explica TODO el pedido con la capa y sus filtros? «las fichas de ocurrencia de oro» sí; «las
 * concesiones de oro» (el catastro no tiene mineral) o «el informe de Pantaleona» no: eso es una
 * pregunta para el modelo, no una capa.
 */
function cubre(e: EntradaCatalogo, frase_: string, objeto: string, filtros: Filtros | null): boolean {
  const explicadas = new Set([
    ...palabrasSignificativas(frase_),
    ...palabrasSignificativas(e.nombre),
    ...(e.alias || []).flatMap((a) => palabrasSignificativas(a)),
    ...Object.values(filtros || {}).flat().flatMap((v) => palabrasSignificativas(v)),
  ]);
  return palabrasSignificativas(objeto).every((w) => explicadas.has(w) || RELLENO.has(w) || GENERICAS.has(w));
}

/** ¿Suena a pedido de capa aunque no haya ninguna con ese nombre? («ábreme las zonas de litio») */
const PIDE_CAPA = /\b(zonas?|capas?|areas?|puntos? de|fichas?|depositos?|yacimientos?|ocurrencias?|mapa de)\b/;

/* ------------------------------------------------------------------ el diálogo */

export async function conversarCapas(mensaje: string, x: Entorno): Promise<Respuesta | null> {
  const t = limpio(mensaje);
  if (!t || t.length > 300) return null;
  const por = porIdDe(x.capas);
  const encendidas = x.estado.capas.filter((c) => por.has(c.id));
  const ultima = encendidas[encendidas.length - 1] || null;

  /* --- la respuesta a lo que se preguntó */
  const p = x.pendiente;
  if (p?.tipo === 'filtro') {
    const e = por.get(p.id);
    if (e) {
      const f = filtrosEnTexto(e, t);
      if (f) return abrir(x, e, f, false);
      if (TODAS.test(t) || /^(si|dale|ok|bueno|claro)\b/.test(t)) return abrir(x, e, {}, false);
    }
  }
  if (p?.tipo === 'elegir') {
    const opciones = p.ids.map((i) => por.get(i)).filter((e): e is EntradaCatalogo => !!e);
    // «Deja solo las zonas de reserva» → «Áreas protegidas»: el «solo» de la pregunta se cumple al contestar.
    const conSolo = async (es: EntradaCatalogo[], r: (y: Entorno) => Promise<Respuesta>): Promise<Respuesta> => {
      if (!p.solo) return r(x);
      const ids = es.flatMap((e) => (e.tipo === 'grupo' ? hojasCat(x.capas, e.id) : [e])).map((h) => h.id);
      const res = await r({ ...x, estado: { capas: x.estado.capas.filter((c) => ids.includes(c.id)) } });
      if (res.ordenes.length) {
        res.ordenes.unshift({ op: 'solo', ids });
        res.texto = res.texto.replace(/^(Listo, abrí|Abrí|Agregué)/, 'Dejé solo');
      }
      return res;
    };
    if (/\b(las dos|los dos|ambas|ambos|todas|todos|las tres)\b/.test(t)) return conSolo(opciones, (y) => abrirVarias(y, opciones));
    const ord = t.match(/\b(primera|primero|segunda|segundo|tercera|tercero)\b/);
    if (ord) {
      const i = { primera: 0, primero: 0, segunda: 1, segundo: 1, tercera: 2, tercero: 2 }[ord[1]]!;
      if (opciones[i]) return conSolo([opciones[i]], (y) => abrir(y, opciones[i], filtrosEnTexto(opciones[i], t) || undefined, false));
    }
    const sub = opciones.filter((e) => buscarCapas([e, ...x.capas.filter((c) => c.padre === e.id)], t).length || normalizar(e.nombre).split(' ').some((w) => w.length > 4 && t.includes(w)));
    if (sub.length === 1) return conSolo(sub, (y) => abrir(y, sub[0], filtrosEnTexto(sub[0], t) || undefined, false));
  }
  if (p?.tipo === 'ofrecer') {
    if (/\b(minerales|que hay|cuales|muestrame|si|dale)\b/.test(t) && !/\botros\b/.test(t)) return listarMinerales(x);
    if (/\b(otros|busca|buscalo)\b/.test(t)) {
      const w = p.palabra;
      const hits = x.capas.filter((c) => (c.padre === 800000 || String(c.id).startsWith('8')) && normalizar(c.nombre).includes(w));
      if (!hits.length) return { texto: `Tampoco hay nada en Otros que se llame «${w}».`, ordenes: [], pendiente: null };
      return preguntarCual(`En Otros encontré`, hits, false);
    }
  }

  /* --- limpiar, qué hay encendido */
  if (LIMPIAR.test(t)) return { texto: 'Listo: dejé solo el perímetro de Honduras.', ordenes: [{ op: 'limpiar' }], pendiente: null };
  if (/\b(que|cuales) (capas )?(tengo|hay|estan|esta|quedan)( abiertas?| encendidas?| prendidas?| en el mapa| puestas?)\b|\bestado del mapa\b/.test(t)) {
    if (!encendidas.length) return { texto: 'No hay ninguna capa encendida: solo el perímetro de Honduras.', ordenes: [], pendiente: null };
    return { texto: `Tengo encendidas: ${enumerar(encendidas.map((c) => `${frase(por.get(c.id)!, c.filtros)} (${id6(c.id)})`))}.`, ordenes: [], pendiente: null };
  }

  /* --- contar */
  if (/\bcuant[oa]s?\b/.test(t)) {
    const r = await contarPedido(x, t, ultima ? por.get(ultima.id) || null : null);
    if (r) return r;
  }

  /* --- abrir */
  const quitar = VERBO_QUITAR.test(t) && !VERBO_ABRIR.test(t.replace(VERBO_QUITAR, ''));
  const soloM = /\b(solo|solamente|unicamente|nada mas)\b/.test(t) && /\b(deja|dejame|muestra|muestrame|pon|ponme|quiero|ver|abre|abreme|dame)\b/.test(t);
  if (VERBO_ABRIR.test(t) && !quitar) {
    const objeto = objetoDe(t, VERBO_ABRIR);
    if (!objeto || /^(el )?(mapa|indice|panel)( de capas)?$/.test(objeto)) return null; // «muéstrame el mapa»: no es una capa
    // «muéstrame las capas» / «qué capas hay»: es una pregunta para el modelo (capas_listar).
    if (/^(las |los )?capas$/.test(objeto)) return null;
    const cands = buscarCapas(x.capas, objeto);
    if (!cands.length) {
      // ¿Un valor de filtro de una capa ya abierta? («ábreme las de plata»)
      const cambio = cambiarFiltro(x, objeto, encendidas, por);
      if (cambio) return cambio;
      return PIDE_CAPA.test(objeto) ? noEncontre(x, objeto) : null;
    }
    // Si sobra algo que ninguna candidata explica, es una pregunta, no una capa.
    if (!cands.some((c) => cubre(por.get(c.id)!, c.frase, objeto, filtrosEnTexto(por.get(c.id)!, objeto)))) return null;
    if (cands.length > 1) return preguntarCual(`«${mensajeCorto(objeto)}» puede ser`, cands.map((c) => por.get(c.id)!), soloM, x.capas);
    const e = por.get(cands[0].id)!;
    const f = filtrosEnTexto(e, objeto);
    // «Deja solo…»: lo demás se apaga, así que la respuesta no dice que sigue visible.
    const xr = soloM ? { ...x, estado: { capas: x.estado.capas.filter((c) => c.id === e.id) } } : x;
    const r = await abrir(xr, e, f || undefined, TODAS.test(objeto) ? false : undefined);
    if (soloM && r.ordenes.length) {
      r.ordenes.unshift({ op: 'solo', ids: [e.id] });
      r.texto = r.texto.replace(/^(Listo, abrí|Abrí|Agregué)/, 'Dejé solo');
    }
    return r;
  }

  /* --- quitar */
  if (quitar) {
    const objeto = objetoDe(t, VERBO_QUITAR);
    const pron = PRONOMBRE.test(t.split(' ')[0]) || !objeto || PRONOMBRE.test(objeto);
    let e: EntradaCatalogo | null = null;
    if (!pron) {
      const cands0 = buscarCapas(x.capas, objeto);
      if (cands0.length && !cands0.some((c) => cubre(por.get(c.id)!, c.frase, objeto, null))) return null;
      const cands = cands0.map((c) => por.get(c.id)!);
      const prendidas = cands.filter((c) => encendidas.some((y) => y.id === c.id) || hojasCat(x.capas, c.id).some((h) => encendidas.some((y) => y.id === h.id)));
      e = prendidas[0] || cands[0] || null;
      if (!e) return PIDE_CAPA.test(objeto) ? noEncontre(x, objeto) : null;
    } else if (ultima) e = por.get(ultima.id) || null;
    if (!e) return { texto: 'No hay ninguna capa encendida para quitar.', ordenes: [], pendiente: null };
    const ids = (e.tipo === 'grupo' ? hojasCat(x.capas, e.id) : [e]).map((h) => h.id).filter((i) => encendidas.some((y) => y.id === i));
    if (!ids.length) return { texto: `${cap(frase(e))} no está encendida.`, ordenes: [], pendiente: null };
    const est = encendidas.find((y) => y.id === ids[0]);
    return { texto: `Quité ${ids.length === 1 ? frase(por.get(ids[0])!, est?.filtros) : `las ${ids.length} capas de «${e.nombre}»`}.`, ordenes: ids.map((id) => ({ op: 'apagar' as const, id })), pendiente: null };
  }

  /* --- cambiar el filtro de lo que está abierto («cámbialo a plata», «ahora las de cobre») */
  if (/\b(cambia\w*|ahora|mejor|pasa\w*|pon\w*|y las|y los|solo)\b/.test(t) && encendidas.length) {
    const r = cambiarFiltro(x, t, encendidas, por);
    if (r) return r;
  }
  return null;
}


function mensajeCorto(t: string) {
  return t.replace(/^(las|los|la|el|unas|unos)\s+/, '');
}
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Abrir una capa (o las de un grupo). `preguntar` undefined: pregunta el filtro si la capa lo tiene y no se dijo. */
async function abrir(x: Entorno, e: EntradaCatalogo, filtros: Filtros | undefined, preguntar?: boolean): Promise<Respuesta> {
  if (e.sin_datos) return { texto: `«${e.nombre}» (${id6(e.id)}) está en el índice, pero sin datos: no llegó ningún archivo para esa capa.`, ordenes: [], pendiente: null };
  if (e.tipo === 'documento') return { texto: `«${e.nombre}» es un plano sin georreferencia: se abre desde el índice de capas, en el visor.`, ordenes: [], pendiente: null };
  if (e.tipo === 'grupo') {
    const hs = hojasCat(x.capas, e.id);
    if (!hs.length) return { texto: `«${e.nombre}» no tiene capas con datos todavía.`, ordenes: [], pendiente: null };
    if (hs.length === 1) return abrir(x, hs[0], filtros, preguntar);
    const hijos = x.capas.filter((c) => c.padre === e.id).sort((a, b) => a.orden - b.orden);
    if (hs.length > 10) return preguntarCual(`«${e.nombre}» tiene ${hs.length} capas. ¿Cuál quieres? Por ejemplo`, hijos.slice(0, 6), false);
    return abrirVarias(x, hs);
  }
  if (!encendibleCat(e)) return { texto: `«${e.nombre}» no está disponible para encender.`, ordenes: [], pendiente: null };
  const fp = filtroPrincipal(e);
  const conFiltro = filtros && Object.keys(filtros).length > 0;
  // Las capas de recursos (pintadas por mineral) se preguntan; las demás se abren enteras.
  const porMineral = !!fp && !!e.estilo?.categorias?.some((c) => c.grupo) && e.estilo?.fuente === 'paleta' && e.id !== 104001;
  if (!conFiltro && preguntar !== false && porMineral) {
    const vs = valoresOfrecidos(e, fp!.campo);
    const tipo = (fp!.etiqueta || fp!.campo).toLowerCase();
    return {
      texto: `Tengo ${e.id === 110002 ? 'las fichas de ocurrencia minera' : frase(e)} de: ${enumerar(vs.map(minus))}. ¿Quieres todas o algún ${tipo} en especial?`,
      ordenes: [],
      pendiente: { tipo: 'filtro', id: e.id, campo: fp!.campo },
    };
  }
  const yaEstaba = x.estado.capas.some((c) => c.id === e.id);
  const f = conFiltro ? filtros! : {};
  const n = await x.contar(e.id, f).catch(() => null);
  const otras = x.estado.capas.filter((c) => c.id !== e.id).map((c) => ({ c, e: porIdDe(x.capas).get(c.id) })).filter((y) => y.e);
  const cuantas = n != null ? unidad(e, n) : null;
  let texto: string;
  if (conFiltro) {
    const vals = Object.values(f).flat();
    const col = vals.length === 1 && fp ? nombreDeColor(colorDeValor(e, fp.campo, vals[0])) : null;
    if (n === 0) texto = `No hay ${frase(e, f)}: ninguna cumple ese filtro. La dejé encendida y vacía; di «todas» para verlas todas.`;
    else texto = `${yaEstaba ? 'Cambié' : 'Abrí'} solo ${frase(e, f)}${cuantas ? `: ${cuantas}` : ''}${col ? `, en ${col}` : ''}.`;
  } else {
    const varias = e.estilo?.tipo === 'categorizado' && (e.estilo.categorias?.length || 0) > 1;
    const nombre = e.id === 110002 ? 'las fichas de ocurrencia' : frase(e);
    // «cada mineral con su color» solo donde se eligió por mineral; lo demás, sin adornos (diálogo C).
    const det = varias && porMineral ? `, cada ${(fp?.etiqueta || e.estilo?.campo || 'categoría').toLowerCase()} con su color` : '';
    texto = otras.length ? `Agregué ${nombre}${cuantas ? ` (${cuantas})` : ''}${det}.` : `Listo, abrí ${varias && e.id >= 110001 && e.id <= 110004 ? 'todas ' : ''}${nombre}${cuantas ? ` (${cuantas})` : ''}${det}.`;
  }
  if (otras.length) texto += ` Siguen visibles ${enumerar(otras.slice(-3).map((y) => frase(y.e!, y.c.filtros)))}.`;
  return { texto, ordenes: [yaEstaba ? { op: 'filtro', id: e.id, filtros: f } : { op: 'encender', id: e.id, filtros: f, encuadrar: !otras.length }], pendiente: null };
}

async function abrirVarias(x: Entorno, es: EntradaCatalogo[]): Promise<Respuesta> {
  const hs = es.flatMap((e) => (e.tipo === 'grupo' ? hojasCat(x.capas, e.id) : [e])).filter(encendibleCat);
  if (!hs.length) return { texto: 'Ninguna de esas tiene datos para encender.', ordenes: [], pendiente: null };
  const ordenes: OrdenMapa[] = hs.filter((h) => !x.estado.capas.some((c) => c.id === h.id)).map((h) => ({ op: 'encender' as const, id: h.id, filtros: {} }));
  const otras = x.estado.capas.map((c) => ({ c, e: porIdDe(x.capas).get(c.id) })).filter((y) => y.e && !hs.some((h) => h.id === y.c.id));
  let texto = `${otras.length ? 'Agregué' : 'Abrí'} ${enumerar(hs.map((h) => `«${h.nombre}»`))}.`;
  if (otras.length) texto += ` Siguen visibles ${enumerar(otras.slice(-3).map((y) => frase(y.e!, y.c.filtros)))}.`;
  return { texto, ordenes, pendiente: null };
}

function preguntarCual(inicio: string, es: EntradaCatalogo[], solo: boolean, todas: EntradaCatalogo[] = []): Respuesta {
  const por = porIdDe(todas);
  const base = es.map((e) => e.nombre.replace(/^\d\s+/, ''));
  // Dos que se llaman igual («Pantaleona» proyecto y concesión): se dice de qué grupo es cada una.
  const nombres = base.map((n, i) => (base.filter((y) => normalizar(y) === normalizar(n)).length > 1 && por.get(es[i].padre!) ? `${n} (${grupoDicho(por.get(es[i].padre!)!)})` : n));
  const pregunta = es.length === 2 ? '¿Cuál quieres, o las dos?' : '¿Cuál quieres?';
  return { texto: `${inicio} ${enumerar(nombres, 'o')}. ${pregunta}`, ordenes: [], pendiente: { tipo: 'elegir', ids: es.map((e) => e.id), solo } };
}

/** «concesiones Indexa», «proyecto Pantaleona»: el grupo de una capa, dicho en una frase. */
function grupoDicho(g: EntradaCatalogo): string {
  const n = g.nombre.replace(/^\d\s+/, '');
  return g.padre === 300000 ? `proyecto ${n}` : n;
}

function noEncontre(x: Entorno, objeto: string): Respuesta {
  const resto = normalizar(objeto)
    .split(' ')
    .filter((w) => w && !GENERICAS.has(w));
  const palabra = resto.join(' ') || objeto;
  return {
    texto: `No encontré una capa ni un valor de «${palabra}» en el índice. Puedo buscar en Otros o mostrarte qué minerales sí hay.`,
    ordenes: [],
    pendiente: { tipo: 'ofrecer', palabra },
  };
}

function listarMinerales(x: Entorno): Respuesta {
  const vistos = new Map<string, string>();
  for (const e of x.capas) {
    if (!encendibleCat(e) || !e.estilo?.categorias?.some((c) => c.grupo) || e.id === 104001) continue;
    for (const c of e.estilo.categorias) if (c.grupo && !/sin dato|no definido/i.test(c.grupo)) vistos.set(normalizar(c.grupo), c.grupo);
  }
  const xs = [...vistos.values()].sort((a, b) => {
    const r = (v: string) => (ORDEN_MINERAL.indexOf(normalizar(v)) + 1 || 100);
    return r(a) - r(b) || a.localeCompare(b, 'es');
  });
  return { texto: `En las capas de recursos hay: ${enumerar(xs.map(minus))}. Dime cuál y te lo abro.`, ordenes: [], pendiente: null };
}

/** «Cámbialo a plata»: el valor nombrado, en la última capa abierta que lo tenga. */
function cambiarFiltro(x: Entorno, t: string, encendidas: EstadoMapa['capas'], por: Map<number, EntradaCatalogo>): Respuesta | null {
  for (const c of [...encendidas].reverse()) {
    const e = por.get(c.id);
    if (!e) continue;
    const f = filtrosEnTexto(e, t);
    if (!f) continue;
    const r: Respuesta = { texto: '', ordenes: [{ op: 'filtro', id: e.id, filtros: f }], pendiente: null };
    (r as any).contar = { e, f };
    return r;
  }
  return null;
}

async function contarPedido(x: Entorno, t: string, ultima: EntradaCatalogo | null): Promise<Respuesta | null> {
  const objeto = t.replace(/^.*?\bcuant[oa]s?\b/, '').replace(/\b(hay|tengo|son|existen|tiene|tienen|en total|en el mapa)\b/g, ' ');
  const cands = buscarCapas(x.capas, objeto);
  // «¿cuántas concesiones vencen?» no es contar una capa: sobra «vencen».
  if (cands.length && !cands.some((c) => cubre(x.capas.find((y) => y.id === c.id)!, c.frase, objeto, filtrosEnTexto(x.capas.find((y) => y.id === c.id)!, objeto)))) return null;
  if (!cands.length && palabrasSignificativas(objeto).some((w) => !RELLENO.has(w) && !GENERICAS.has(w) && !(ultima && filtrosEnTexto(ultima, objeto)))) return null;
  const e = cands.length === 1 ? x.capas.find((c) => c.id === cands[0].id)! : !cands.length ? ultima : null;
  if (!e) return cands.length > 1 ? preguntarCual('¿De cuál? Puede ser', cands.map((c) => x.capas.find((y) => y.id === c.id)!), false) : null;
  if (!encendibleCat(e)) return null;
  const f = filtrosEnTexto(e, objeto) || {};
  const n = await x.contar(e.id, f).catch(() => null);
  if (n == null) return { texto: `No puedo contar los rasgos de «${e.nombre}»: se sirve por teselas.`, ordenes: [], pendiente: null };
  return { texto: `Hay ${unidad(e, n)} en ${frase(e, f)} (${id6(e.id)}).`, ordenes: [], pendiente: null };
}

/**
 * El diálogo completo, con el conteo del cambio de filtro (que necesita esperar al servidor).
 * `conversarCapas` deja marcado el cambio; aquí se cuenta y se arma la frase.
 */
export async function dialogoCapas(mensaje: string, x: Entorno): Promise<Respuesta | null> {
  const r = await conversarCapas(mensaje, x);
  if (!r) return null;
  const m = (r as any).contar as { e: EntradaCatalogo; f: Filtros } | undefined;
  if (m) {
    delete (r as any).contar;
    const n = await x.contar(m.e.id, m.f).catch(() => null);
    const vals = Object.values(m.f).flat();
    const fp = filtroPrincipal(m.e);
    const col = vals.length === 1 && fp ? nombreDeColor(colorDeValor(m.e, fp.campo, vals[0])) : null;
    const quien = m.e.id === 110002 || m.e.id === 110003 ? 'las fichas muestran' : m.e.id === 110001 ? 'los depósitos muestran' : `«${m.e.nombre}» muestra`;
    r.texto = `Ahora ${quien} solo ${enumerar(vals.map(minus), 'o')}${n != null ? `: ${unidad(m.e, n)}` : ''}${col ? `, en ${col}` : ''}.`;
  }
  return r;
}

/* ------------------------------------------------------------------ memoria de la pregunta */

const PENDIENTES = new Map<string, { p: Pendiente; cuando: number }>();
const VIDA = 15 * 60_000;

export function pendienteDe(clave: string): Pendiente | null {
  const x = PENDIENTES.get(clave);
  if (!x || Date.now() - x.cuando > VIDA) {
    PENDIENTES.delete(clave);
    return null;
  }
  return x.p;
}
export function guardarPendiente(clave: string, p: Pendiente | null) {
  if (p) PENDIENTES.set(clave, { p, cuando: Date.now() });
  else PENDIENTES.delete(clave);
  if (PENDIENTES.size > 2000) for (const k of [...PENDIENTES.keys()].slice(0, 500)) PENDIENTES.delete(k);
}

/** El estado que manda el panel con cada pregunta, limpio: IDs de seis dígitos y filtros de texto. */
export function estadoDelCliente(x: unknown): EstadoMapa {
  const capas = Array.isArray((x as any)?.capas) ? (x as any).capas : [];
  return {
    capas: capas
      .slice(0, 80)
      .map((c: any) => ({
        id: Number(c?.id),
        filtros: Object.fromEntries(
          Object.entries(c?.filtros && typeof c.filtros === 'object' ? c.filtros : {})
            .slice(0, 8)
            .map(([k, v]) => [String(k).slice(0, 80), (Array.isArray(v) ? v : []).slice(0, 60).map((s) => String(s).slice(0, 120))])
        ),
      }))
      .filter((c: { id: number }) => Number.isSafeInteger(c.id) && c.id > 0 && c.id <= 999999),
  };
}
