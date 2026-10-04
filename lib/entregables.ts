/**
 * RESULTADOS REALMENTE COMPROBADOS (revisión externa, bloqueo): ni «Listo» ni «Listo, 3 archivos» prueban que se
 * entregaron tres archivos. Aquí cada cosa que se pidió es un REQUISITO propio y se comprueba por separado contra lo
 * que el NODO encontró en su espacio de trabajo al terminar (scripts/nodo-computadora/agente.py `comprobar_archivos`):
 *
 *   · cantidad   — «tres documentos», «3 PDFs», «un Word y dos PDFs» son tantos requisitos como cosas; sin decir
 *                  cuántos («los PDFs») no hay forma de saber que están todos: queda «sin comprobar», nunca verificado;
 *   · identidad  — «informe.docx» lo cumple solo un archivo que se llame así (y en la carpeta pedida, si la dijo); uno
 *                  sin nombre, uno del tipo pedido; uno genérico («descarga el reglamento»), uno cuyo nombre lo diga;
 *   · tipo       — la extensión y lo que el nodo vio POR DENTRO (bytes mágicos: `tipo`). Un nodo de antes que no lo mira
 *                  deja el tipo «sin comprobar»;
 *   · existencia, acceso e integridad — existe, dentro del espacio (no fuera, no un enlace que sale), más de 0 bytes,
 *                  sha256 válido, y hecho o cambiado durante ESTA misión (`reciente`, que sigue `desde_tarea`).
 *
 * Un archivo cumple a lo más UN requisito; lo que sobra (un runtime.log) nunca cuenta. Se completa solo si TODOS los
 * requisitos quedan verificados, cada uno con SU evidencia. Puro: sin red ni disco.
 */

/** Un archivo que el NODO comprobó al terminar (agente.py `comprobar_archivos`). Nunca sale del texto del modelo. */
export type ArchivoNodo = {
  ruta: string;
  existe: boolean;
  bytes: number;
  sha256: string | null;
  /** Cambió durante esta misión (desde su primera tarea). */
  reciente?: boolean;
  /** Lo nombraban la instrucción o la respuesta. */
  mencionado?: boolean;
  /** Lo nombrado caía fuera del espacio de trabajo: no se miró. */
  fuera?: boolean;
  /** Lo que el nodo vio por dentro (bytes mágicos): pdf, png, jpeg, gif, webp, docx, xlsx, pptx, odt, ods, odp, odg, ole, zip, rtf, texto, binario, vacio. Sin el campo: un nodo de antes, tipo sin comprobar. */
  tipo?: string;
  /** Los primeros 8 bytes en hex (para que la persona lo vea, no para decidir). */
  magia?: string;
};

export type Requisito = {
  id: string;
  /** Cómo se nombra para la persona: «informe.docx», «PDF n.º 2», «un archivo». */
  etiqueta: string;
  /** El nombre pedido (con su extensión) o nada si solo se pidió un tipo. */
  nombre?: string;
  /** La ruta tal como la dijo, si dijo carpeta (~/Documents/x.pdf). */
  ruta?: string;
  /** Las extensiones que valen; vacío: cualquiera (entonces cuenta la identidad por el nombre). */
  extensiones: string[];
  /** Cómo se llama el tipo para la persona («un PDF», «un documento de Word»). */
  clase: string;
  /** Se sabe cuántos son. «Los PDFs» sin número: no. */
  cantidadSegura: boolean;
  /** `pedido`: lo pidió la persona. `respuesta`: tu computadora dijo que lo dejó (el nodo lo buscó y no está). */
  origen: 'pedido' | 'respuesta';
};

export type EstadoItem = 'verified' | 'not_met' | 'unknown';
export type ItemEntrega = {
  id: string;
  etiqueta: string;
  estado: EstadoItem;
  /** Lo que se comprobó o por qué no, dicho para la persona. */
  detalle: string;
  origen: Requisito['origen'];
  /** El archivo que lo cumple (verificado) o el que se miró para decir por qué no. */
  archivo?: ArchivoNodo;
};

/* ------------------------------------------------------------------ texto */

const plegar = (s: unknown) =>
  String(s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
const sinUrls = (s: string) => s.replace(/\b(?:https?|ftp):\/\/\S+|\bwww\.\S+/gi, ' ');
const limpio = (v: unknown, max: number) =>
  String(v ?? '')
    .replace(/[\u0000-\u001f\u007f\u2028\u2029]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
export const nombreDeRuta = (ruta: string) => limpio(String(ruta).split('/').filter(Boolean).pop() || ruta, 80);
const extDe = (nombre: string) => (/\.([a-z0-9]{1,5})$/i.exec(nombre)?.[1] || '').toLowerCase();

/** «a», «a y b», «a, b y c». */
export function enLista(xs: string[], y = 'y'): string {
  if (xs.length <= 1) return xs.join('');
  return `${xs.slice(0, -1).join(', ')} ${y} ${xs[xs.length - 1]}`;
}

/* ------------------------------------------------------------------ tipos */

export const EXT_ARCHIVO = 'odt|ods|odp|odg|docx?|xlsx?|pptx?|pdf|txt|csv|tsv|md|rtf|html?|json|xml|png|jpe?g|gif|svg|webp|zip';
const RE_NOMBRE = new RegExp(`(?<![\\w/.~-])((?:~/|/|\\./)?(?:[\\w.-]+/)*[\\w-][\\w.-]*\\.(?:${EXT_ARCHIVO}))(?![\\w-])`, 'gi');

/** Qué tiene que haber visto el nodo por dentro para cada extensión. */
const TIPOS_POR_EXT: Record<string, string[]> = {
  pdf: ['pdf'],
  png: ['png'],
  jpg: ['jpeg'],
  jpeg: ['jpeg'],
  gif: ['gif'],
  webp: ['webp'],
  docx: ['docx'],
  xlsx: ['xlsx'],
  pptx: ['pptx'],
  odt: ['odt'],
  ods: ['ods'],
  odp: ['odp'],
  odg: ['odg'],
  doc: ['ole'],
  xls: ['ole'],
  ppt: ['ole'],
  zip: ['zip', 'docx', 'xlsx', 'pptx', 'odt', 'ods', 'odp', 'odg'],
  rtf: ['rtf'],
  txt: ['texto'],
  csv: ['texto'],
  tsv: ['texto'],
  md: ['texto'],
  json: ['texto'],
  xml: ['texto'],
  html: ['texto'],
  htm: ['texto'],
  svg: ['texto'],
};

/** Cómo se llama el tipo de una extensión, para la persona. */
const CLASE_POR_EXT: Record<string, string> = {
  pdf: 'un PDF',
  png: 'una imagen PNG',
  jpg: 'una imagen JPEG',
  jpeg: 'una imagen JPEG',
  gif: 'una imagen GIF',
  webp: 'una imagen WebP',
  docx: 'un documento de Word',
  doc: 'un documento de Word',
  xlsx: 'una hoja de Excel',
  xls: 'una hoja de Excel',
  pptx: 'una presentación de PowerPoint',
  ppt: 'una presentación de PowerPoint',
  odt: 'un documento de texto (ODT)',
  ods: 'una hoja de cálculo (ODS)',
  odp: 'una presentación (ODP)',
  odg: 'un dibujo (ODG)',
  zip: 'un ZIP',
  rtf: 'un documento RTF',
  csv: 'un CSV',
  tsv: 'un TSV',
};
const claseDeExt = (ext: string) => CLASE_POR_EXT[ext] || (ext ? `un archivo .${ext}` : 'un archivo');

/** Lo que el nodo vio por dentro, dicho para la persona. */
const TIPO_EN_PALABRAS: Record<string, string> = {
  pdf: 'un PDF',
  png: 'una imagen PNG',
  jpeg: 'una imagen JPEG',
  gif: 'una imagen GIF',
  webp: 'una imagen WebP',
  docx: 'un documento de Word',
  xlsx: 'una hoja de Excel',
  pptx: 'una presentación',
  odt: 'un documento ODT',
  ods: 'una hoja ODS',
  odp: 'una presentación ODP',
  odg: 'un dibujo ODG',
  ole: 'un archivo de Office antiguo',
  zip: 'un ZIP',
  rtf: 'un RTF',
  texto: 'texto',
  binario: 'otro tipo de archivo',
  vacio: 'nada (está vacío)',
};

/** Lo que nunca es un entregable que no se nombró: registros, temporales, descargas a medias. */
const RE_BASURA = /(^|\/)(runtime|debug|error|out|nohup)\.(log|txt)$|\.(log|tmp|temp|part|crdownload|download|lock|swp|bak|pid|old)$/i;

/* ------------------------------------------------------------------ qué se pidió */

type Familia = { clave: string; re: string; ext: string[]; clase: string; claseN: string; claseP: string };
// En orden: lo más específico primero («documento de Word» antes que «documento», «archivo de texto» antes que «archivo»).
const FAMILIAS: Familia[] = [
  { clave: 'word', re: '(?:documentos?\\s+(?:de\\s+|en\\s+)?)?(?:word|docx)s?', ext: ['docx', 'doc', 'odt', 'rtf'], clase: 'un documento de Word', claseN: 'documento de Word', claseP: 'documentos de Word' },
  { clave: 'hoja', re: 'hojas?\\s+de\\s+(?:calculo|excel)|excel(?:es|s)?|planillas?|xlsx|spreadsheets?', ext: ['xlsx', 'xls', 'ods', 'csv'], clase: 'una hoja de cálculo', claseN: 'hoja de cálculo', claseP: 'hojas de cálculo' },
  { clave: 'presentacion', re: 'presentacion(?:es)?|powerpoints?|pptx|presentations?', ext: ['pptx', 'ppt', 'odp'], clase: 'una presentación', claseN: 'presentación', claseP: 'presentaciones' },
  { clave: 'texto', re: 'archivos?\\s+de\\s+texto|txt|text\\s+files?', ext: ['txt', 'md'], clase: 'un archivo de texto', claseN: 'archivo de texto', claseP: 'archivos de texto' },
  { clave: 'pdf', re: 'pdfs?', ext: ['pdf'], clase: 'un PDF', claseN: 'PDF', claseP: 'PDFs' },
  { clave: 'csv', re: 'csvs?', ext: ['csv'], clase: 'un CSV', claseN: 'CSV', claseP: 'CSVs' },
  { clave: 'png', re: 'pngs?', ext: ['png'], clase: 'una imagen PNG', claseN: 'PNG', claseP: 'PNGs' },
  { clave: 'imagen', re: 'imagen(?:es)?|images?|fotos?|fotografias?|photos?|capturas?(?:\\s+de\\s+pantalla)?|screenshots?', ext: ['png', 'jpg', 'jpeg', 'webp', 'gif'], clase: 'una imagen', claseN: 'imagen', claseP: 'imágenes' },
  // «Tres documentos: informe.docx, presupuesto.xlsx y carta.pdf»: en la oficina, una hoja también es un documento.
  { clave: 'documento', re: 'documentos?|documents?', ext: ['docx', 'doc', 'odt', 'rtf', 'pdf', 'txt', 'md', 'xlsx', 'xls', 'ods', 'csv', 'pptx', 'ppt', 'odp'], clase: 'un documento', claseN: 'documento', claseP: 'documentos' },
  { clave: 'archivo', re: 'archivos?|ficheros?|files?', ext: [], clase: 'un archivo', claseN: 'archivo', claseP: 'archivos' },
];
const CANTIDADES: Record<string, number> = {
  un: 1, una: 1, uno: 1, el: 1, la: 1, otro: 1, otra: 1, one: 1, another: 1, the: 0,
  dos: 2, ambos: 2, ambas: 2, two: 2, both: 2, tres: 3, three: 3, cuatro: 4, four: 4, cinco: 5, five: 5,
  seis: 6, six: 6, siete: 7, seven: 7, ocho: 8, eight: 8, nueve: 9, nine: 9, diez: 10, ten: 10,
};
const PLURALES = 'los|las|unos|unas|varios|varias|algunos|algunas|mis|tus|sus|esos|esas|estos|estas|some|several|these|those';
const DET = `\\d{1,2}|${Object.keys(CANTIDADES).join('|')}|${PLURALES}`;
// Un adjetivo suelto entre el número y el tipo («tres nuevos documentos», «dos breves PDFs»).
const RE_FRASE = new RegExp(`(?<![\\w.])(?:(${DET})\\s+)?(?:(?:nuev[oa]s?|breves?|cort[oa]s?|nuevos|new|short)\\s+)?(${FAMILIAS.map((f) => `(?:${f.re})`).join('|')})(?![\\w.])`, 'g');
/** Antes del tipo, esto dice de dónde sale (del PDF, de los documentos) o en qué carpeta (la carpeta Documentos): no qué entregar. */
const RE_ORIGEN_ANTES = /(?:\b(?:del|de|desde|dentro de|from|of)\s+(?:(?:la|el|los|las|mi|tu|su|mis|tus|sus|the|my|your)\s+)?|\b(?:carpeta|folder)\s+(?:de\s+)?)$/;
/** «en Documentos», «a mis imágenes»: con un tipo que también es carpeta, es dónde; con un formato («a CSV», «en Word», «como PDF») es lo que se entrega. */
const RE_LUGAR_ANTES = /\b(?:en|a|al|in|into|to)\s+(?:(?:la|el|los|las|mi|tu|su|mis|tus|sus|the|my|your)\s+)?$/;
const FAMILIAS_CARPETA = new Set(['documento', 'archivo', 'imagen']);
/** Un verbo de dejar algo (crear, guardar, descargar…). Una frase de tipo sin uno antes en la oración («lee el PDF») no es un entregable. */
const RE_VERBO_ENTREGA =
  /\b(crea\w*|crear\w*|haz|hazme|hacer|escrib\w*|genera\w*|arma\w*|prepara\w*|redacta\w*|guard\w*|descarg\w*|baja\w*|export\w*|convierte\w*|convertir\w*|saca\w*|toma\w*|make|create|write|generate|draft|save|download|export|convert|take)\b/;

/** Palabras que no identifican nada (verbos, carpetas, relleno). */
const VACIAS = new Set(
  (
    'crea crear creame hazme hacer escribe escribir genera generar arma armame prepara preparame redacta guarda guardar guardalo guardala guardalos ' +
    'guardalas descarga descargar descargalo descargala descargalos bajate exporta exportar convierte saca toma documento documentos archivo archivos ' +
    'carpeta descargas downloads documents escritorio desktop imagenes pictures computadora pagina sitio favor porfa porfavor ' +
    'despues luego tambien ademas donde todos todas cada nuevo nueva nuevos nuevas resumen copia contenido datos informacion ' +
    'please create write download files folder their there about'
  ).split(' ')
);

/** Las palabras que identifican lo pedido («reglamento», «facturas»), para un archivo pedido sin nombre. */
export function clavesDe(instruccion: string): string[] {
  const p = plegar(sinUrls(String(instruccion || ''))).replace(RE_NOMBRE, ' ');
  const out: string[] = [];
  for (const w of p.match(/[a-z0-9ñ]{5,}/g) || []) {
    if (VACIAS.has(w) || FAMILIAS.some((f) => new RegExp(`^(?:${f.re})$`).test(w))) continue;
    const raiz = w.replace(/(es|s)$/, '');
    if (raiz.length >= 4 && !out.includes(raiz)) out.push(raiz);
  }
  return out.slice(0, 12);
}

/**
 * Los requisitos de lo que se pidió dejar. «Crea tres documentos: informe.docx, presupuesto.xlsx y carta.pdf» → tres
 * con nombre y tipo; «guarda 3 PDFs» → tres PDFs sin nombre; «un Word y dos PDFs» → tres. Un nombre que viene después
 * de «un documento…» del mismo tipo es ESE documento (no otro). `seguro: false` si no se puede saber cuántos.
 * Sin nada de eso (pero sí pide dejar algo), un archivo cuyo nombre lo identifique.
 */
export function requisitosDeEntrega(instruccion: string): { items: Requisito[]; seguro: boolean } {
  const original = String(instruccion || '');
  const sinWeb = sinUrls(original);
  const p = plegar(sinWeb);
  // Los nombres, en orden y sin repetir (por su nombre de archivo).
  const nombres: { nombre: string; ruta?: string; pos: number }[] = [];
  for (const m of sinWeb.matchAll(RE_NOMBRE)) {
    const ruta = m[1];
    const nombre = nombreDeRuta(ruta);
    if (nombres.some((n) => n.nombre.toLowerCase() === nombre.toLowerCase())) continue;
    nombres.push({ nombre, ...(ruta.includes('/') ? { ruta } : {}), pos: m.index ?? 0 });
  }
  // Las frases de tipo con su cantidad («tres documentos», «3 PDFs», «una hoja de cálculo»).
  type Frase = { fam: Familia; cantidad: number | null; pos: number; otro: boolean; absorbio: number };
  const frases: Frase[] = [];
  const sinNombres = p.replace(RE_NOMBRE, (x) => ' '.repeat(x.length)); // «informe.docx» no es la frase «docx»
  for (const m of sinNombres.matchAll(RE_FRASE)) {
    const pos = m.index ?? 0;
    const antes = sinNombres.slice(0, pos);
    const oracion = antes.slice(Math.max(antes.lastIndexOf('.'), antes.lastIndexOf(';'), antes.lastIndexOf('\n')) + 1);
    if (!RE_VERBO_ENTREGA.test(oracion)) continue;
    const det = m[1] || '';
    const sustantivo = m[2];
    const fam = FAMILIAS.find((f) => new RegExp(`^(?:${f.re})$`).test(sustantivo));
    if (!fam) continue;
    // «del PDF», «de los documentos», «la carpeta PDFs»: de dónde sale o dónde va, no qué entregar. «guárdalo en
    // Documentos»: la carpeta. «Exporta la tabla a CSV», «un resumen en Word»: el formato de lo que se entrega.
    const previo = antes.trimEnd() + ' ';
    if (RE_ORIGEN_ANTES.test(previo) || (FAMILIAS_CARPETA.has(fam.clave) && RE_LUGAR_ANTES.test(previo))) continue;
    const plural = /^(?:\w+?)(?:s|es)\b/.test(sustantivo.split(/\s+/)[0]) && !/^(?:xlsx|docx|pptx)$/.test(sustantivo);
    let cantidad: number | null;
    if (/^\d+$/.test(det)) cantidad = Math.min(50, Number(det));
    else if (det in CANTIDADES && CANTIDADES[det] > 0) cantidad = CANTIDADES[det];
    else if (det && new RegExp(`^(?:${PLURALES})$`).test(det)) cantidad = plural ? null : 1;
    else cantidad = plural ? null : 1;
    frases.push({ fam, cantidad, pos, otro: /^(otro|otra|another)$/.test(det), absorbio: 0 });
  }
  const items: Requisito[] = [];
  let seguro = true;
  // Cada nombre es suyo; si viene después de una frase del mismo tipo que aún tiene sitio, es una de esas cosas.
  for (const n of nombres) {
    const ext = extDe(n.nombre);
    const f = [...frases].reverse().find((x) => !x.otro && x.pos < n.pos && (x.fam.ext.length === 0 || x.fam.ext.includes(ext)) && (x.cantidad === null || x.absorbio < x.cantidad));
    if (f) f.absorbio++;
    items.push({ id: '', etiqueta: n.nombre, nombre: n.nombre, ...(n.ruta ? { ruta: n.ruta } : {}), extensiones: [ext], clase: claseDeExt(ext), cantidadSegura: true, origen: 'pedido' });
  }
  for (const f of frases) {
    if (f.cantidad === null) {
      if (f.absorbio > 0) continue; // «los documentos informe.docx y carta.pdf»: los nombres dicen cuántos
      seguro = false;
      items.push({ id: '', etiqueta: `${f.fam.claseP} (no dijiste cuántos)`, extensiones: f.fam.ext, clase: f.fam.clase, cantidadSegura: false, origen: 'pedido' });
      continue;
    }
    const resto = f.cantidad - f.absorbio;
    for (let k = 1; k <= resto; k++) {
      items.push({ id: '', etiqueta: resto > 1 ? `${f.fam.claseN} n.º ${k}` : f.fam.clase, extensiones: f.fam.ext, clase: f.fam.clase, cantidadSegura: true, origen: 'pedido' });
    }
  }
  if (!items.length) items.push({ id: '', etiqueta: 'el archivo que pediste', extensiones: [], clase: 'un archivo', cantidadSegura: true, origen: 'pedido' });
  const TOPE = 10;
  if (items.length > TOPE) seguro = false;
  return { items: items.slice(0, TOPE).map((x, i) => ({ ...x, id: `entrega-${i + 1}` })), seguro };
}

/* ------------------------------------------------------------------ comprobar cada archivo */

type Veredicto = { estado: EstadoItem; motivo: string };

const rutaValida = (ruta: string) => !!ruta && ruta.length <= 400 && ruta.startsWith('/') && !/[\u0000-\u001f]/.test(ruta) && !/(^|\/)\.\.?(\/|$)/.test(ruta);

/** ¿Este archivo cumple un requisito de estas extensiones? Todo o nada, con el porqué. */
export function veredictoArchivo(a: ArchivoNodo, extensiones: string[]): Veredicto {
  const n = nombreDeRuta(a.ruta);
  if (a.fuera) return { estado: 'not_met', motivo: `${n} está fuera de su carpeta de trabajo (no lo miré)` };
  if (a.existe !== true) return { estado: 'not_met', motivo: `falta ${n}` };
  if (!rutaValida(a.ruta)) return { estado: 'not_met', motivo: `${n} no está en una ruta válida de su carpeta de trabajo` };
  if (!(Number.isFinite(a.bytes) && a.bytes > 0) || a.tipo === 'vacio') return { estado: 'not_met', motivo: `${n} está vacío` };
  if (typeof a.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(a.sha256)) return { estado: 'not_met', motivo: `${n} no tiene una huella (sha256) válida` };
  if (a.reciente === false) return { estado: 'not_met', motivo: `${n} ya estaba antes de esta misión (no lo hizo ahora)` };
  if (a.reciente !== true) return { estado: 'unknown', motivo: `${n}: no pude comprobar que lo hizo esta misión` };
  const ext = extDe(n);
  if (extensiones.length && !extensiones.includes(ext)) return { estado: 'not_met', motivo: `${n} no es ${claseDeExt(extensiones[0])}` };
  const esperados = TIPOS_POR_EXT[ext];
  if (!a.tipo) return { estado: 'unknown', motivo: `${n}: tu computadora no lo revisó por dentro, así que no sé si es ${claseDeExt(ext)}` };
  if (!esperados) return { estado: 'unknown', motivo: `${n}: no sé comprobar por dentro un archivo .${ext || '?'}` };
  if (!esperados.includes(a.tipo)) return { estado: 'not_met', motivo: `${n} no es ${claseDeExt(ext)} de verdad (por dentro es ${TIPO_EN_PALABRAS[a.tipo] || 'otra cosa'})` };
  return { estado: 'verified', motivo: '' };
}

const ORDEN: Record<EstadoItem, number> = { verified: 0, unknown: 1, not_met: 2 };

/** Lo que se comprobó de un archivo que cumple, dicho corto. */
export function detalleComprobado(a: ArchivoNodo): string {
  const n = nombreDeRuta(a.ruta);
  const t = a.tipo ? TIPO_EN_PALABRAS[a.tipo] || a.tipo : '';
  return `${n} · ${a.bytes} bytes${t ? ` · ${t} por dentro` : ''} · sha256 ${String(a.sha256).slice(0, 12)}… · hecho en esta misión`;
}

/**
 * Compara lo pedido con lo que el nodo encontró. Cada requisito, su archivo (a lo más uno) y su estado; cada archivo,
 * a lo más un requisito. `lista` null: el nodo no comprobó nada (un nodo de antes, o no pudo mirar).
 */
export function compararEntrega(instruccion: string, lista: ArchivoNodo[] | null): { items: ItemEntrega[]; seguro: boolean; sobran: ArchivoNodo[] } {
  const { items: reqs, seguro } = requisitosDeEntrega(instruccion);
  if (!lista) {
    return {
      items: reqs.map((r) => ({ id: r.id, etiqueta: r.etiqueta, estado: 'unknown', detalle: `${r.etiqueta}: sin comprobar (tu computadora no revisó sus archivos al terminar)`, origen: r.origen })),
      seguro,
      sobran: [],
    };
  }
  const usados = new Set<ArchivoNodo>();
  const claves = clavesDe(instruccion);
  const identifica = (a: ArchivoNodo) => claves.some((k) => plegar(nombreDeRuta(a.ruta)).includes(k));
  const items: ItemEntrega[] = [];
  const conVeredicto = (a: ArchivoNodo, exts: string[]) => ({ a, v: veredictoArchivo(a, exts) });
  const mejor = (xs: { a: ArchivoNodo; v: Veredicto }[]) => xs.sort((x, y) => ORDEN[x.v.estado] - ORDEN[y.v.estado] || Number(identifica(y.a)) - Number(identifica(x.a)))[0];
  const cerrarItem = (r: Requisito, elegido: { a: ArchivoNodo; v: Veredicto } | undefined, sinArchivo: string): ItemEntrega => {
    if (!elegido) return { id: r.id, etiqueta: r.etiqueta, estado: 'not_met', detalle: sinArchivo, origen: r.origen };
    usados.add(elegido.a);
    const { a, v } = elegido;
    return { id: r.id, etiqueta: r.etiqueta, estado: v.estado, detalle: v.estado === 'verified' ? detalleComprobado(a) : v.motivo, origen: r.origen, archivo: a };
  };

  // 1) Lo que tiene nombre: solo un archivo que se llame así (y en la carpeta que dijo).
  for (const r of reqs.filter((x) => x.nombre)) {
    const mismo = lista.filter((a) => !usados.has(a) && nombreDeRuta(a.ruta).toLowerCase() === r.nombre!.toLowerCase());
    let cand = mismo.map((a) => conVeredicto(a, r.extensiones));
    if (r.ruta && cand.length) {
      const rel = r.ruta.replace(/^~\//, '/').replace(/^\.\//, '/');
      const aqui = (a: ArchivoNodo) => a.ruta === r.ruta || (r.ruta!.startsWith('/') ? a.ruta === r.ruta : a.ruta.toLowerCase().endsWith((rel.startsWith('/') ? rel : `/${rel}`).toLowerCase()));
      const enLaCarpeta = cand.filter((c) => aqui(c.a) || c.a.existe !== true);
      if (!enLaCarpeta.some((c) => c.v.estado === 'verified')) {
        const otra = cand.find((c) => c.v.estado === 'verified' && !aqui(c.a));
        if (otra) {
          cand = [{ a: otra.a, v: { estado: 'not_met', motivo: `${r.nombre} quedó en otra carpeta (${limpio(otra.a.ruta, 120)}), no en ${r.ruta}` } }];
        } else cand = enLaCarpeta.length ? enLaCarpeta : cand;
      } else cand = enLaCarpeta;
    }
    items.push(cerrarItem(r, mejor(cand), `falta ${r.nombre}`));
  }
  // 2) Lo que solo tiene tipo («3 PDFs»): un archivo de ese tipo, cada uno distinto; nunca basura que no se nombró.
  for (const r of reqs.filter((x) => !x.nombre && x.extensiones.length)) {
    const cand = lista.filter((a) => !usados.has(a) && a.existe === true && !RE_BASURA.test(a.ruta) && r.extensiones.includes(extDe(nombreDeRuta(a.ruta)))).map((a) => conVeredicto(a, r.extensiones));
    if (!r.cantidadSegura) {
      const buenos = cand.filter((c) => c.v.estado === 'verified');
      buenos.forEach((c) => usados.add(c.a));
      items.push({
        id: r.id,
        etiqueta: r.etiqueta,
        estado: buenos.length ? 'unknown' : 'not_met',
        detalle: buenos.length
          ? `encontré ${buenos.length} (${enLista(buenos.slice(0, 4).map((c) => nombreDeRuta(c.a.ruta)))}), pero no dijiste cuántos: no puedo comprobar que estén todos`
          : `no encontré ningún archivo nuevo de ese tipo (${r.etiqueta.replace(/ \(no dijiste cuántos\)$/, '')})`,
        origen: r.origen,
      });
      continue;
    }
    items.push(cerrarItem(r, mejor(cand), `falta ${r.etiqueta}`));
  }
  // 3) Lo genérico («descarga el reglamento»): un archivo nuevo y sano cuyo nombre lo identifique; si no, no se sabe.
  for (const r of reqs.filter((x) => !x.nombre && !x.extensiones.length)) {
    const cand = lista.filter((a) => !usados.has(a) && a.existe === true && !RE_BASURA.test(a.ruta)).map((a) => conVeredicto(a, []));
    const buenos = cand.filter((c) => c.v.estado === 'verified');
    if (!r.cantidadSegura) {
      // «Guarda los archivos»: sin decir cuántos ni de qué tipo, nada lo puede comprobar.
      buenos.forEach((c) => usados.add(c.a));
      items.push({ id: r.id, etiqueta: r.etiqueta, estado: buenos.length ? 'unknown' : 'not_met', detalle: buenos.length ? `encontré ${enLista(buenos.slice(0, 4).map((c) => nombreDeRuta(c.a.ruta)))}, pero no dijiste cuántos: no puedo comprobar que estén todos` : 'no encontré ningún archivo nuevo en su carpeta de trabajo', origen: r.origen });
      continue;
    }
    const suyo = buenos.find((c) => identifica(c.a));
    if (suyo) {
      items.push(cerrarItem(r, suyo, ''));
      continue;
    }
    if (buenos.length) {
      items.push({ id: r.id, etiqueta: r.etiqueta, estado: 'unknown', detalle: `encontré ${enLista(buenos.slice(0, 3).map((c) => nombreDeRuta(c.a.ruta)))}, pero no puedo saber si es lo que pediste`, origen: r.origen });
      continue;
    }
    items.push(cerrarItem(r, mejor(cand), 'no encontré ningún archivo nuevo en su carpeta de trabajo'));
  }
  // 4) Lo que tu computadora dijo que dejó y el nodo no encontró (o cae fuera): una afirmación falsa también cuenta.
  const nombresPedidos = new Set(reqs.filter((x) => x.nombre).map((x) => x.nombre!.toLowerCase()));
  const yaVistos = new Set([...usados].map((a) => nombreDeRuta(a.ruta).toLowerCase()));
  let k = reqs.length;
  for (const a of lista) {
    const n = nombreDeRuta(a.ruta);
    if (!a.mencionado || (a.existe === true && !a.fuera) || nombresPedidos.has(n.toLowerCase()) || yaVistos.has(n.toLowerCase()) || usados.has(a)) continue;
    if (items.length >= 12) break;
    yaVistos.add(n.toLowerCase());
    usados.add(a);
    items.push({ id: `entrega-${++k}`, etiqueta: `${n} (tu computadora dijo que lo dejó)`, estado: 'not_met', detalle: a.fuera ? `dijo que dejó ${n}, pero está fuera de su carpeta de trabajo` : `dijo que dejó ${n}, pero no está`, origen: 'respuesta', archivo: a });
  }
  const sobran = lista.filter((a) => !usados.has(a) && a.existe === true && a.reciente !== false);
  return { items, seguro, sobran };
}

/** «De lo que pediste, comprobé 2 de 3: falta carta.pdf. runtime.log no es lo que pediste.» (null si todo se comprobó). */
export function faltaEnPalabras(items: ItemEntrega[], sobran: ArchivoNodo[], sinMirar: boolean): string | null {
  if (items.every((i) => i.estado === 'verified')) return null;
  if (sinMirar) return 'Tu computadora dice que dejó lo pedido, pero no pude comprobarlo: no revisó sus archivos al terminar.';
  const pedidos = items.filter((i) => i.origen === 'pedido');
  const hechos = pedidos.filter((i) => i.estado === 'verified').length;
  const problemas = pedidos.filter((i) => i.estado !== 'verified').map((i) => i.detalle);
  const partes: string[] = [];
  if (pedidos.length) partes.push(`De lo que pediste, comprobé ${hechos} de ${pedidos.length}${problemas.length ? `: ${problemas.join('; ')}` : ''}.`);
  const dichos = items.filter((i) => i.origen === 'respuesta' && i.estado !== 'verified').map((i) => i.detalle);
  if (dichos.length) partes.push(`${dichos.join('; ').replace(/^./, (c) => c.toUpperCase())}.`);
  const extra = sobran.slice(0, 3).map((a) => nombreDeRuta(a.ruta));
  if (extra.length) partes.push(`${enLista(extra)} ${extra.length > 1 ? 'no son' : 'no es'} lo que pediste.`);
  return partes.join(' ');
}
