/**
 * LAS CAPAS DEL MAPA, POR CATEGORÍAS.
 *
 * Antes la caja de capas era una lista plana de todo lo cargado —ochenta litologías seguidas de
 * setenta proyectos— y no había forma de pedir «la geología» o «el mapa político» de una vez. Aquí
 * se decide a qué categoría va cada cosa (las capas de la base por su rol, los mapas del índice de
 * teselas por su nombre) y qué se quiere decir cuando alguien dice «muéstrame los ríos» o «esconde
 * la geología».
 *
 * Al abrir el mapa solo se enciende el mapa político de Honduras: departamentos y municipios.
 * Todo lo demás se pide, tocando la categoría o diciéndolo.
 *
 * Sin React ni MapLibre: lo importan también los comandos de voz, que van en el paquete de entrada.
 */

export type ClaveCategoria =
  | 'politico'
  | 'geologia'
  | 'recursos'
  | 'ambiente'
  | 'hidrografia'
  | 'topografia'
  | 'relieve'
  | 'satelite'
  | 'proyectos'
  | 'historico'
  | 'otros';

export type Categoria = { clave: ClaveCategoria; nombre: string; detalle: string; color: string };

/** En el orden en que se muestran. */
export const CATEGORIAS: Categoria[] = [
  { clave: 'politico', nombre: 'Mapa político', detalle: 'Departamentos y municipios de Honduras', color: '#FFFFFF' },
  { clave: 'geologia', nombre: 'Geología', detalle: 'Rocas, fallas, placas, provincias y tractos', color: '#E9D18B' },
  { clave: 'recursos', nombre: 'Yacimientos y geoquímica', detalle: 'Ocurrencias, muestras y anomalías', color: '#FFE066' },
  { clave: 'ambiente', nombre: 'Ambiente y restricciones', detalle: 'Áreas protegidas, microcuencas, bosque, minería informal', color: '#2ECC71' },
  { clave: 'hidrografia', nombre: 'Ríos y poblados', detalle: 'Red hídrica y caseríos', color: '#4FA3E0' },
  { clave: 'topografia', nombre: 'Mapas topográficos', detalle: 'Hojas cartográficas escaneadas', color: '#C9B48A' },
  { clave: 'relieve', nombre: 'Relieve', detalle: 'Curvas de nivel y sombreado', color: '#A8B5BC' },
  { clave: 'satelite', nombre: 'Satélite (Sentinel-2)', detalle: 'Arcillas, óxidos de hierro, vegetación', color: '#FF4FD8' },
  { clave: 'proyectos', nombre: 'Proyectos propios', detalle: 'Polígonos de los proyectos de la casa', color: '#FFB020' },
  { clave: 'historico', nombre: 'Estudios históricos', detalle: 'JICA y otros estudios viejos', color: '#B8A68A' },
  { clave: 'otros', nombre: 'Otros mapas', detalle: 'Lo que no cae en las demás', color: '#C9D5DB' },
];

/** Lo que se enciende solo al abrir el mapa. */
export const POR_DEFECTO: ClaveCategoria = 'politico';

const DE_ROL: Record<string, ClaveCategoria> = {
  departamento: 'politico',
  municipio: 'politico',
  litologia: 'geologia',
  falla: 'geologia',
  placa: 'geologia',
  provincia_geologica: 'geologia',
  tracto_permisivo: 'geologia',
  ocurrencia: 'recursos',
  area_protegida: 'ambiente',
  microcuenca: 'ambiente',
  forestal: 'ambiente',
  zona_informal: 'ambiente',
  rio: 'hidrografia',
  poblado: 'hidrografia',
  proyecto: 'proyectos',
  historico: 'historico',
};

export function categoriaDeRol(rol: string): ClaveCategoria {
  return DE_ROL[rol] || 'otros';
}

/** Un mapa del índice de teselas va a su categoría por lo que dice su clave, su nombre o su grupo. */
export function categoriaDeRaster(x: { clave: string; nombre?: string; grupo?: string }): ClaveCategoria {
  const t = normalizar(`${x.clave} ${x.nombre || ''} ${x.grupo || ''}`);
  if (/sentinel|satelit|\bs2\b/.test(t)) return 'satelite';
  if (/curvas|relieve/.test(t)) return 'relieve';
  if (/hojas?|cartograf|topograf|1620/.test(t)) return 'topografia';
  if (/anomal|geoquim/.test(t)) return 'recursos';
  if (/\bfallas?\b|geolog|estructural|litolog/.test(t)) return 'geologia';
  if (/\brios?\b|hidric|caserio|poblad|aldea/.test(t)) return 'hidrografia';
  if (/jica|historic/.test(t)) return 'historico';
  return 'otros';
}

/* ------------------------------------------------------------------ lo que se pide */

/** Lo que se puede encender, sea capa de la base, mapa del índice, las muestras o las curvas. */
export type ItemCapa =
  | { tipo: 'capa'; id: number; nombre: string; rol: string }
  | { tipo: 'raster'; clave: string; nombre: string; grupo?: string }
  | { tipo: 'muestras' }
  | { tipo: 'curvas' };

export function claveItem(i: ItemCapa): string {
  return i.tipo === 'capa' ? `capa:${i.id}` : i.tipo === 'raster' ? `raster:${i.clave}` : i.tipo;
}

export function categoriaDeItem(i: ItemCapa): ClaveCategoria {
  if (i.tipo === 'capa') return categoriaDeRol(i.rol);
  if (i.tipo === 'raster') return categoriaDeRaster(i);
  return i.tipo === 'muestras' ? 'recursos' : 'relieve';
}

/** Minúsculas, sin tildes ni signos. */
export function normalizar(texto: string): string {
  return String(texto || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * Cómo se nombra cada categoría al hablar. Sin «relieve» (es el 3D) ni «satélite» a secas (es el
 * fondo): esas órdenes ya existían y siguen haciendo lo mismo.
 */
const ALIAS_CATEGORIA: Array<[ClaveCategoria, RegExp]> = [
  ['politico', /\b(mapa politico|politicos?|politicas?|limites?|division politica|division administrativa)\b/],
  ['geologia', /\b(geologia|geologicas?|geologicos?|capas geologicas)\b/],
  ['recursos', /\b(recursos|geoquimica|mineralizacion|recursos minerales)\b/],
  ['ambiente', /\b(ambiente|ambientales?|restricciones|zonas restringidas|restringidas?)\b/],
  ['hidrografia', /\b(hidrografia|hidrologia|rios y poblados)\b/],
  ['topografia', /\b(topografic[oa]s?|topografia|cartografic[oa]s?|mapas escaneados|escaneados)\b/],
  ['relieve', /\b(curvas de nivel|curvas|terreno)\b/],
  ['satelite', /\b(sentinel|imagenes satelitales|indices satelitales|capas satelitales|satelitales)\b/],
  ['proyectos', /\b(proyectos?( propios)?|nuestros proyectos)\b/],
  ['historico', /\b(historic[oa]s?|jica|estudios viejos|estudios antiguos)\b/],
];

/** Cómo se nombra cada clase de capa de la base. */
const ALIAS_ROL: Array<[string, RegExp]> = [
  ['departamento', /\bdepartamentos?\b/],
  ['municipio', /\bmunicipios?\b/],
  ['litologia', /\b(rocas?|litologia|litologic[oa]s?|unidades geologicas)\b/],
  ['falla', /\bfallas?\b/],
  ['placa', /\bplacas?( tectonicas)?\b/],
  ['provincia_geologica', /\bprovincias?\b/],
  ['tracto_permisivo', /\btractos?\b/],
  ['ocurrencia', /\b(ocurrencias?|yacimientos?|indicios?|prospectos?)\b/],
  ['area_protegida', /\b(areas? protegidas?|protegidas?|parques?( nacionales)?|reservas?)\b/],
  ['microcuenca', /\b(micro ?cuencas?|cuencas?)\b/],
  ['forestal', /\b(forestal|bosques?)\b/],
  ['zona_informal', /\b(informal|mineria informal|artesanal|guiris)\b/],
  ['rio', /\b(rios?|red hidrica|quebradas?)\b/],
  ['poblado', /\b(caserios?|poblados?|aldeas?|comunidades)\b/],
];

/** Lo que se dice de los mapas del índice, que no tienen rol. */
const ALIAS_RASTER: Array<[RegExp, RegExp]> = [
  [/\b(rios?|red hidrica|quebradas?)\b/, /\brios?\b|hidric/],
  [/\b(caserios?|poblados?|aldeas?|comunidades)\b/, /caserio|poblad|aldea/],
  [/\bfallas?\b/, /\bfallas?\b/],
  [/\bhojas?\b/, /\bhojas?\b/],
  [/\b(arcillas?|alteracion)\b/, /arcilla/],
  [/\b(hierro|oxidos?)\b/, /hierro|oxido/],
  [/\bvegetacion\b/, /vegetacion/],
  [/\banomalias?\b/, /anomal/],
  [/\bcurvas\b/, /curvas/],
];

const TODO = /^(todo|todas|todos|todo lo demas|todas las capas|las capas|capas|todo el resto)$/;

/** Lo que se quita de lo dicho antes de buscar: artículos y «la capa de». */
function limpiarPedido(que: string): string {
  return normalizar(que)
    .replace(/^(el|la|los|las|un|una|mi|mis)\s+/, '')
    .replace(/^(capas?|mapas?)\s+(de|del)\s+(la\s+|las\s+|los\s+|el\s+)?/, '')
    .replace(/^(el|la|los|las)\s+/, '')
    .trim();
}

/**
 * ¿Lo dicho nombra algo de las capas? Sin mirar el catálogo: lo usan los comandos de voz para no
 * confundir una pregunta con una orden.
 */
export function esPedidoDeCapa(que: string): boolean {
  const t = limpiarPedido(que);
  if (!t) return false;
  if (TODO.test(t)) return true;
  if (/\bmuestras?\b/.test(t)) return true;
  return ALIAS_CATEGORIA.some(([, re]) => re.test(t)) || ALIAS_ROL.some(([, re]) => re.test(t)) || ALIAS_RASTER.some(([re]) => re.test(t));
}

const VACIAS = new Set(['de', 'del', 'la', 'las', 'el', 'los', 'y', 'en', 'mapa', 'mapas', 'capa', 'capas', 'honduras', 'todo', 'todos', 'todas']);

/**
 * Lo que alguien pidió, contra lo que hay. Primero lo concreto («las fallas» son las fallas de la
 * base Y las del índice), después la categoría entera («la geología»), y si nada de eso, el nombre
 * de la capa tal como está en el catálogo («hojas cartográficas»).
 */
export function resolverPedido(que: string, items: ItemCapa[]): { items: ItemCapa[]; categoria?: ClaveCategoria; todo?: boolean } {
  const t = limpiarPedido(que);
  if (!t) return { items: [] };
  if (TODO.test(t)) return { items, todo: true };

  const concretos = items.filter((i) => {
    if (i.tipo === 'muestras') return /\bmuestras?\b/.test(t);
    if (i.tipo === 'curvas') return /\bcurvas\b/.test(t);
    if (i.tipo === 'capa') return ALIAS_ROL.some(([rol, re]) => rol === i.rol && re.test(t));
    const nombre = normalizar(`${i.clave} ${i.nombre}`);
    return ALIAS_RASTER.some(([dicho, propio]) => dicho.test(t) && propio.test(nombre));
  });
  if (concretos.length) return { items: concretos };

  const cat = ALIAS_CATEGORIA.find(([, re]) => re.test(t))?.[0];
  if (cat) return { items: items.filter((i) => categoriaDeItem(i) === cat), categoria: cat };

  // Por el nombre: todas las palabras con peso de lo dicho tienen que estar en el nombre.
  const palabras = t.split(' ').filter((p) => p.length >= 4 && !VACIAS.has(p));
  if (!palabras.length) return { items: [] };
  return {
    items: items.filter((i) => {
      if (i.tipo !== 'capa' && i.tipo !== 'raster') return false;
      const nombre = normalizar(i.nombre);
      return palabras.every((p) => nombre.includes(p.replace(/s$/, '')));
    }),
  };
}

/** Cómo se dice lo que se encendió o apagó: «la geología», «3 capas», «los municipios». */
export function nombreDePedido(r: { items: ItemCapa[]; categoria?: ClaveCategoria; todo?: boolean }): string {
  if (r.todo) return 'todas las capas';
  if (r.categoria) return CATEGORIAS.find((c) => c.clave === r.categoria)!.nombre.toLowerCase();
  if (r.items.length === 1) {
    const i = r.items[0];
    return i.tipo === 'muestras' ? 'las muestras' : i.tipo === 'curvas' ? 'las curvas de nivel' : i.nombre;
  }
  return `${r.items.length} capas`;
}
