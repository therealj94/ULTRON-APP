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
  /**
   * Lo vio ENTERO (no solo la cabecera): un PDF con %%EOF y una página, un ZIP con su directorio central y sus partes, un
   * PNG con IEND… (agente.py `integridad`). false: cortado o dañado (`defecto` dice por qué). Sin el campo o null: no
   * se pudo comprobar (un nodo de antes): nunca verificado.
   */
  integro?: boolean | null;
  /**
   * La versión del validador que dijo `integro` (ronda 9, G4: agente.py VALIDADOR_VERSION). Un `integro: true` sin ella,
   * o de una versión menor que VALIDADOR_MIN, es de un nodo viejo que aceptaba cascarones vacíos: sin comprobar.
   */
  integro_v?: number;
  defecto?: string;
};

/**
 * La versión mínima del validador del nodo en la que se confía (ronda 9, G4). Los de antes daban por enteros archivos sin
 * contenido (un PNG sin IDAT en la 7, un PDF con un /Pages vacío en la 8): su «íntegro» queda «sin comprobar».
 */
export const VALIDADOR_MIN = 9;

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
  origen: 'pedido' | 'respuesta';  /** Lo que tiene que decir su nombre para ser ESTE («enero» de «las facturas de enero, febrero y marzo»). */
  claves?: string[];
  /** Pidió «tres archivos» sin más: cualquier archivo nuevo y sano cumple uno (sin registros ni temporales, sin repetir). */
  libre?: boolean;
  /** Algo sin nombre que se bajó o se abrió puede ser lo mismo que esto: nunca queda verificado (dice qué). */
  dudoso?: string;
  /** La carpeta dicha con palabras («en la carpeta facturas», «en Documentos/facturas»), normalizada: documents/facturas. */
  carpeta?: string;
  /** Un nombre con espacios sin comillas («el informe final.pdf»): el nombre puede ser este, más largo. Solo cumple
   * sin duda un archivo que se llame así; uno que se llame como `nombre` queda «sin comprobar». */
  alternativa?: string;
  /** Se pidió producir algo sin un tipo de archivo que se pueda revisar («una gráfica», «un logo», «la factura de Ana»):
   * nunca queda verificado. */
  inverificable?: boolean;
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
/** El nombre de archivo de una ruta, en NFC: «cotización.xlsx» compuesto o descompuesto (NFD en el disco) es el mismo. */
export const nombreDeRuta = (ruta: string) => limpio(String(ruta).normalize('NFC').split('/').filter(Boolean).pop() || ruta, 80);
const extDe = (nombre: string) => (/\.([a-z0-9]{1,5})$/i.exec(nombre)?.[1] || '').toLowerCase();

/** «a», «a y b», «a, b y c». */
export function enLista(xs: string[], y = 'y'): string {
  if (xs.length <= 1) return xs.join('');
  return `${xs.slice(0, -1).join(', ')} ${y} ${xs[xs.length - 1]}`;
}

/* ------------------------------------------------------------------ tipos */

export const EXT_ARCHIVO = 'odt|ods|odp|odg|docx?|xlsx?|pptx?|pdf|txt|csv|tsv|md|rtf|html?|json|xml|png|jpe?g|gif|svg|webp|zip';
/**
 * Un nombre de archivo en el texto: letras Unicode («cotización.xlsx» entero, no «n.xlsx»), con carpeta o sin ella, y
 * con un paréntesis antes de la extensión («reporte (1).pdf», «reporte (versión final).docx»). Igual que el nodo
 * (agente.py RE_ARCHIVO, con `\w` Unicode de Python).
 */
const RE_NOMBRE = new RegExp(
  // Un apóstrofo entre letras es parte del nombre («O'Brien.pdf», «O’Neil.docx»): nunca se corta en «Brien.pdf».
  `(?<![\\p{L}\\p{N}_/.~'’-])((?:~/|/|\\./)?(?:[\\p{L}\\p{N}_.-]+/)*[\\p{L}\\p{N}_-](?:[\\p{L}\\p{N}_.-]|(?<=[\\p{L}\\p{N}])['’](?=[\\p{L}\\p{N}]))*(?:\\s?\\([^()\\n]{1,40}\\))?\\.(?:${EXT_ARCHIVO}))(?![\\p{L}\\p{N}_-])`,
  'giu'
);
/** Entre comillas se toma completo, con espacios: «informe final.pdf», "mis notas.txt". */
// Entre comillas simples, un apóstrofo ENTRE letras no cierra la comilla: «'O'Brien.pdf'» es «O'Brien.pdf».
const RE_NOMBRE_COMILLAS = new RegExp(`["«“'‘]((?:[^"»”'’\\n]|(?<=[\\p{L}\\p{N}])['’](?=[\\p{L}\\p{N}])){1,120}?\\.(?:${EXT_ARCHIVO}))["»”'’]`, 'giu');
/** Antes de un nombre sin comillas, esto lo corta: un artículo, una preposición, una conjunción, un pronombre o un verbo. */
const CORTAN_NOMBRE = new Set(
  (
    'el la los las un una unos unas lo le les me te se nos mi tu su mis tus sus este esta ese esa al del de en con como para por desde hasta sobre entre ' +
    'y e o u ni que llamado llamada nombre nombrado the a an of in on at to from as into called named and or my your this that it'
  ).split(' ')
);
export type NombreEnTexto = { ruta: string; nombre: string; pos: number; fin: number; alternativa?: string };
/**
 * Los nombres de archivo de un texto, en orden: los de comillas completos; los demás con el patrón de arriba. Si la
 * palabra de antes no corta (no es artículo, preposición, conjunción ni verbo), el nombre pudo tener más palabras
 * («informe final.pdf»): va en `alternativa`.
 */
export function nombresEn(texto: string, esVerbo: (w: string) => boolean = () => false): NombreEnTexto[] {
  const t = String(texto || '').normalize('NFC');
  const out: NombreEnTexto[] = [];
  let resto = t;
  for (const m of t.matchAll(RE_NOMBRE_COMILLAS)) {
    const pos = m.index ?? 0;
    const ruta = m[1].trim();
    out.push({ ruta, nombre: nombreDeRuta(ruta), pos, fin: pos + m[0].length });
    resto = resto.slice(0, pos) + ' '.repeat(m[0].length) + resto.slice(pos + m[0].length);
  }
  for (const m of resto.matchAll(RE_NOMBRE)) {
    const pos = m.index ?? 0;
    const ruta = m[1];
    const n: NombreEnTexto = { ruta, nombre: nombreDeRuta(ruta), pos, fin: pos + m[0].length };
    if (!ruta.includes('/') && /\s$/.test(resto.slice(0, pos)) && !/[,;:.!?()«»"“”]\s*$/.test(resto.slice(0, pos))) {
      const palabras = resto.slice(Math.max(0, pos - 80), pos).match(/[\p{L}\p{N}_-]+(?=\s+$|\s+[\p{L}\p{N}_-])/gu) || [];
      const previas = (resto.slice(Math.max(0, pos - 80), pos).trimEnd().split(/(?<=[,;:.!?()«»"“”])|\s+/u) || []).filter(Boolean);
      const extra: string[] = [];
      for (let i = previas.length - 1; i >= 0 && extra.length < 3; i--) {
        const w = previas[i];
        if (/[,;:.!?()«»"“”]$/.test(w)) break;
        const wp = plegar(w);
        if (CORTAN_NOMBRE.has(wp) || /^\d+$/.test(wp) || esVerbo(wp) || FAMILIAS.some((f) => new RegExp(`^(?:${f.re})$`).test(wp))) break;
        extra.unshift(w);
      }
      void palabras;
      if (extra.length) n.alternativa = `${extra.join(' ')} ${n.nombre}`;
    }
    out.push(n);
  }
  return out.sort((a, b) => a.pos - b.pos);
}
/** El texto con los nombres de archivo en blanco (mismo largo): para buscar verbos y frases sin que «facturas.zip» sea «zip». */
function sinNombresDe(texto: string): string {
  const t = String(texto || '').normalize('NFC');
  let r = t;
  for (const n of nombresEn(t)) r = r.slice(0, n.pos) + ' '.repeat(n.fin - n.pos) + r.slice(n.fin);
  return r;
}

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
  { clave: 'zip', re: 'zips?|comprimidos?|archivos?\\s+comprimidos?', ext: ['zip'], clase: 'un ZIP', claseN: 'ZIP', claseP: 'ZIPs' },
  { clave: 'pdf', re: 'pdfs?', ext: ['pdf'], clase: 'un PDF', claseN: 'PDF', claseP: 'PDFs' },
  { clave: 'csv', re: 'csvs?', ext: ['csv'], clase: 'un CSV', claseN: 'CSV', claseP: 'CSVs' },
  { clave: 'png', re: 'pngs?', ext: ['png'], clase: 'una imagen PNG', claseN: 'PNG', claseP: 'PNGs' },
  { clave: 'jpg', re: 'jpe?gs?', ext: ['jpg', 'jpeg'], clase: 'una imagen JPEG', claseN: 'JPEG', claseP: 'JPEGs' },
  { clave: 'imagen', re: 'imagen(?:es)?|images?|fotos?|fotografias?|photos?|pantallazos?|capturas?(?:\\s+de\\s+pantalla)?|screenshots?', ext: ['png', 'jpg', 'jpeg', 'webp', 'gif'], clase: 'una imagen', claseN: 'imagen', claseP: 'imágenes' },
  // «Tres documentos: informe.docx, presupuesto.xlsx y carta.pdf»: en la oficina, una hoja también es un documento.
  { clave: 'documento', re: 'documentos?|documents?', ext: ['docx', 'doc', 'odt', 'rtf', 'pdf', 'txt', 'md', 'xlsx', 'xls', 'ods', 'csv', 'pptx', 'ppt', 'odp'], clase: 'un documento', claseN: 'documento', claseP: 'documentos' },
  { clave: 'archivo', re: 'archivos?|ficheros?|files?', ext: [], clase: 'un archivo', claseN: 'archivo', claseP: 'archivos' },
];
/** Los sustantivos que solo dicen «archivo» (o «documento», «imagen»): un formato pegado a ellos los precisa. */
const FAMILIAS_GENERICAS = new Set(['archivo', 'documento', 'imagen']);
const CANTIDADES: Record<string, number> = {
  un: 1, una: 1, uno: 1, el: 1, la: 1, otro: 1, otra: 1, one: 1, another: 1, the: 0,
  dos: 2, ambos: 2, ambas: 2, two: 2, both: 2, tres: 3, three: 3, cuatro: 4, four: 4, cinco: 5, five: 5,
  seis: 6, six: 6, siete: 7, seven: 7, ocho: 8, eight: 8, nueve: 9, nine: 9, diez: 10, ten: 10,
};
const PLURALES = 'los|las|unos|unas|varios|varias|algunos|algunas|mis|tus|sus|esos|esas|estos|estas|some|several|these|those';
const DET = `\\d{1,2}|${Object.keys(CANTIDADES).join('|')}|${PLURALES}`;
// Un adjetivo suelto entre el número y el tipo («tres nuevos documentos», «dos breves PDFs»).
const RE_FRASE = new RegExp(`(?<![\\w.])(?:(${DET})\\s+)?(?:(?:nuev[oa]s?|breves?|cort[oa]s?|nuevos|new|short)\\s+)?(${FAMILIAS.map((f) => `(?:${f.re})`).join('|')})(?![\\w.])`, 'g');
/** Entre un sustantivo y su formato: «archivos PDF», «documentos en Word», «imagen de tipo PNG», «en formato PDF». */
const RE_PEGADO = /^\s+(?:(?:en|de)\s+)?(?:(?:tipo|formato)\s+)?(?:(?:de|en)\s+)?$/;
/** Antes del tipo, esto dice de dónde sale (del PDF, de los documentos) o en qué carpeta (la carpeta Documentos): no qué entregar. */
const RE_ORIGEN_ANTES = /(?:\b(?:del|de|desde|dentro de|from|of)\s+(?:(?:la|el|los|las|mi|tu|su|mis|tus|sus|the|my|your)\s+)?|\b(?:carpeta|folder)\s+(?:de\s+)?)$/;
/** «en Documentos», «a mis imágenes»: con un tipo que también es carpeta, es dónde; con un formato («a CSV», «en Word», «como PDF») es lo que se entrega. */
const RE_LUGAR_ANTES = /\b(?:en|a|al|in|into|to)\s+(?:(?:la|el|los|las|mi|tu|su|mis|tus|sus|the|my|your)\s+)?$/;
const FAMILIAS_CARPETA = new Set(['documento', 'archivo', 'imagen']);

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
  const p = plegar(sinNombresDe(sinUrls(String(instruccion || ''))));
  const out: string[] = [];
  for (const w of p.match(/[a-z0-9ñ]{5,}/g) || []) {
    if (VACIAS.has(w) || FAMILIAS.some((f) => new RegExp(`^(?:${f.re})$`).test(w))) continue;
    const raiz = w.replace(/(es|s)$/, '');
    if (raiz.length >= 4 && !out.includes(raiz)) out.push(raiz);
  }
  return out.slice(0, 12);
}

/* ---- el papel de algo en la oración: lo que se entrega, de dónde sale, o nada claro ---- */

/** Dejar algo: crear, guardar, descargar, exportar, imprimir, comprimir, copiar… */
const RE_V_ENTREGA =
  /^(crea\w*|crear\w*|haz|hazme|hacer|hagas|escrib\w*|genera\w*|arma\w*|prepara\w*|redacta\w*|guard\w*|descarg\w*|baja|bajame|bajate|bajar\w*|export\w*|saca\w*|toma\w*|imprim\w*|comprim\w*|zipea\w*|pon|ponme|ponlo|ponla|ponlos|ponlas|make|create|write|generate|draft|save|download|export|take|print\w*|grab|snap|screenshot|capture|compress\w*|zip)$/;
/**
 * Operar sobre archivos que ya existen: copiar, mover, renombrar, borrar, descomprimir. Son ACCIONES: su objeto es el
 * origen y el resultado no se crea de cero; el texto no las comprueba (evaluarEntrega: «sin comprobar», salvo una copia
 * que el nodo muestre con la misma huella en la carpeta pedida).
 */
const RE_V_OPERACION =
  /^(copia|copiame|copialo|copiala|copialos|copialas|copiar\w*|mueve|muevelo|muevela|muevelos|muevelas|mover\w*|renombra\w*|borra\w*|elimina\w*|descomprim\w*|extrae\w*|unzip\w*|copy|move|rename|delete|remove|extract)$/;
/** «una copia», «a copy»: el sustantivo, no el verbo. */
const ARTICULOS = new Set(['un', 'una', 'la', 'el', 'otra', 'otro', 'a', 'an', 'the', 'su', 'tu', 'mi']);
/** Pedirlo sin verbo de hacer: «necesito tres PDFs», «dame los dos documentos». */
const RE_V_NECESIDAD = /^(necesito|necesitamos|necesita|ocupo|ocupamos|quiero|queremos|dame|deme|damelos|damelas|consigue\w*|consiguen|need|want)$/;
/** De dónde sale lo que se usa, o un dato que se pide de algo: leer, abrir, usar, buscar, «dime»… («lee informe.pdf», «busca fotos»). */
const RE_V_ORIGEN =
  /^(lee|leer|leyendo|lea|leelo|leela|abre|abrir|abriendo|revisa\w*|usa|usar|usando|utiliza\w*|mira|mirar|analiza\w*|compara\w*|basad[oa]s?|busca\w*|encuentra\w*|dime|dinos|di|cuentame|explica\w*|muestrame|ensename|read|reading|open|use|using|review|analyze|compare|based|search|find|tell|show|explain|describe)$/;
/** Convertir o resumir: su objeto es el ORIGEN; el destino va después de «a», «en», «como» («convierte datos.csv a PDF», «resume reporte.pdf en un Word»). */
const RE_V_CONVERTIR = /^(conviert\w*|convertir\w*|transforma\w*|pasa|pasalo|pasala|pasar|resume|resumir|resumelo|resumela|resumiendo|convert\w*|transform\w*|summarize)$/;
/** Crear algo NUEVO (no guardar lo que se bajó): después de bajar algo sin nombre, lo creado no se distingue de lo bajado. */
const RE_V_CREAR = /^(crea\w*|crear\w*|haz|hazme|hacer|hagas|escrib\w*|genera\w*|arma\w*|prepara\w*|redacta\w*|make|create|write|generate|draft)$/;
/** Lo que pone un archivo en la carpeta sin crearlo: bajar, abrir un adjunto… */
const RE_V_TRAER = /^(baja|bajame|bajate|bajar\w*|descarga|descargar|descargame|abre|abrir|abriendo|download|open|usa|usar|usando|lee|leer|leyendo|read|use)$/;
const RE_V_COMPRIMIR = /^(comprim\w*|zipea\w*|compress\w*|zip)$/;
const RE_DESTINO_ANTES = /\b(?:a|al|en|como|to|into|as)\s+(?:(?:un|una|el|la|the|a|an)\s+)?$/;
/** «guárdalo como PDF», «expórtala a Word», «save it as PDF»: el formato de lo mismo, no otra cosa. */
const RE_REFORMATO_ANTES = /\b([a-zñ]+?(?:lo|la|los|las))\s+(?:como|a|al|en)\s+(?:(?:un|una)\s+)?$|\b(save|export|convert|print)\s+(?:it|them)\s+(?:as|to|into)\s+(?:(?:a|an)\s+)?$/;
const RE_FIN_ORACION = /[.;!?\n]/;

type Papel = 'entrega' | 'origen' | 'ninguno';

/** El verbo más cercano ANTES (en la misma oración) y el papel que le da a lo que viene: lo que va antes es `antes`. */
function verboYPapel(antes: string): { verbo: string | null; papel: Papel } {
  const ini = Math.max(...[...antes.matchAll(new RegExp(RE_FIN_ORACION, 'g'))].map((m) => (m.index ?? 0) + 1), 0);
  const oracion = antes.slice(ini);
  const palabras = oracion.match(/[a-zñ]+/g) || [];
  for (let i = palabras.length - 1; i >= 0; i--) {
    const w = palabras[i];
    if (RE_V_OPERACION.test(w)) {
      if (ARTICULOS.has(palabras[i - 1] || '')) continue; // «una copia en ~/Desktop/…»
      return { verbo: w, papel: 'origen' };
    }
    if (RE_V_ENTREGA.test(w) || RE_V_NECESIDAD.test(w)) return { verbo: w, papel: 'entrega' };
    if (RE_V_ORIGEN.test(w)) return { verbo: w, papel: 'origen' };
    if (RE_V_CONVERTIR.test(w)) return { verbo: w, papel: RE_DESTINO_ANTES.test(antes.trimEnd() + ' ') ? 'entrega' : 'origen' };
  }
  return { verbo: null, papel: 'ninguno' };
}
const papelEn = (antes: string): Papel => verboYPapel(antes).papel;
/** «create a file», «grab a screenshot»: la «a» después de un verbo en inglés es el artículo, no «a la carpeta». */
const esArticuloIngles = (previo: string) => /\b(make|create|write|generate|draft|save|download|export|take|grab|snap|capture|print)\s+an?\s+$/.test(previo);
/** Bajar o guardar algo (no «haz las cuentas»): solo entonces un plural de otra cosa son archivos. */
const RE_V_BAJAR = /^(guard|descarg|baj|export|download|save)/;
const raizDe = (w: string) => w.replace(/(es|s)$/, '');

/** Producir algo nuevo cuyo tipo puede no reconocerse («hazme una gráfica», «diseña un logo», «graba un audio»). */
const RE_V_PRODUCIR_COSA =
  /^(crea|creame|crear|creen|haz|hazme|hacer|hagas|genera|generame|generar|prepara|preparame|preparar|arma|armame|armar|disena|disename|disenar|dibuja|dibujame|dibujar|graba|grabame|grabar|escribe|escribeme|escribir|redacta|redactame|redactar|make|create|generate|draw|record|write|draft|design|compose|build|produce)$/;
/** Dejar un archivo (bajar, guardar, exportar, imprimir, capturar, comprimir). */
const RE_V_PRODUCIR_ARCHIVO =
  /^(exporta|exportame|exportar|guarda|guardame|guardar|descarga|descargame|descargar|baja|bajame|bajate|bajar|imprime|imprimeme|imprimir|toma|tomame|saca|sacame|comprime|comprimir|zipea|save|export|download|print|take|grab|snap|capture|screenshot|compress|zip)$/;
/** Traducir: el producto es texto que va en la respuesta. */
const RE_V_TRADUCIR = /^(traduce|traduceme|traducelo|traducela|traducir|translate)$/;
/**
 * Productos de TEXTO que van en la respuesta misma: un resumen, una lista, una traducción, una explicación, ideas, un
 * plan, pasos, un borrador (que no sea de correo ni de WhatsApp), un poema, un chiste, un mensaje para leer aquí.
 */
const RE_PRODUCTO_TEXTO =
  /^(?:aqui\s+|here\s+)?(?:(?:un|una|unos|unas|el|la|los|las|mi|me|nos|a|an|the|some|\d+|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|two|three|four|five|ten)\s+)*(?:(?:breve|corto|corta|rapido|rapida|pequeno|pequena|short|quick|brief)\s+)?(?:resumen(?:es)?|resumencito|tabla|tablas|table|lista|listas|traduccion|traducciones|explicacion|respuesta|ideas?|plan|pasos|borrador|poema|poemas|chiste|chistes|mensaje|cuento|parrafo|summary|summaries|list|lists|translation|explanation|answer|ideas?|plan|steps|draft|poem|joke|jokes|message|paragraph|outline|esquema)(?:\s+(?:breve|corto|corta|short))?\b/;
/** Lo que vuelve archivo (o correo) a un producto de texto: «en PDF», «un documento», «guárdalo», «un correo». */
const RE_NO_ES_TEXTO_EN_CHAT =
  /\b(archivos?|ficheros?|documentos?|hojas?|presentacion(?:es)?|carpetas?|pdfs?|words?|excel(?:es)?|xlsx|docx|pptx|csv|zip|guard\w*|descarg\w*|export\w*|imprim\w*|correos?|e-?mails?|mails?|whatsapp|imagen(?:es)?|graficas?|graficos?|fotos?|capturas?|logos?|videos?|audios?|files?|documents?|spreadsheets?|slides?|folders?|charts?|images?|pictures?)\b/;

/** Actuar afuera: subir, enviar, publicar. */
const RE_V_ACTUAR = /^(sube|subir|subelo|subela|envia|enviale|enviar|envialo|enviala|manda|mandale|mandar|mandalo|publica|publicar|publicalo|upload|send|post|publish)$/;
/** Lo que marca una consulta: preguntar, buscar y decir, explicar, leer y decir. */
const RE_CONSULTA =
  /^(dime|dinos|di|decime|cuentame|cuanto|cuanta|cuantos|cuantas|que|cual|cuales|quien|quienes|donde|cuando|como|porque|busca|buscame|averigua|averiguame|investiga|consulta|explica|explicame|resume|resumeme|lee|leeme|revisa|verifica|comprueba|mira|checa|chequea|what|whats|how|which|who|where|when|why|find|search|look|check|explain|summarize|read|tell|is|are|does|do|can)$/;

/**
 * ¿Es una CONSULTA pura (lo único que se completa con el texto de la respuesta)? Lista blanca: tiene que haber una marca
 * de pregunta («dime», «cuánto», «qué», «busca», «explica», «¿…?») y NINGÚN verbo de producir o actuar (crear, hacer,
 * guardar, descargar, copiar, enviar…), ni un nombre de archivo. Si no se puede decidir, no es consulta.
 */
export function esConsulta(instruccion: string): boolean {
  const original = sinUrls(String(instruccion || ''));
  if (nombresEn(original).length) return false;
  const p = plegar(sinNombresDe(original));
  const palabras = p.match(/[a-zñ]+/g) || [];
  if (palabras.some((w, i) => RE_V_PRODUCIR_COSA.test(w) || RE_V_PRODUCIR_ARCHIVO.test(w) || RE_V_ACTUAR.test(w) || RE_V_ENTREGA.test(w) || (RE_V_OPERACION.test(w) && !ARTICULOS.has(palabras[i - 1] || ''))))
    return false;
  // Lista blanca de verdad (ronda 6): CADA fragmento empieza por un verbo de consulta o por una palabra que no es verbo,
  // y no hay un imperativo con enclítico que no sea de consulta («anótalo», «mándaselo», «apártame», «instálalas»).
  if (!fragmentosAceptables(p, false) || accionEnclitica(sinNombresDe(original), false) || verboDeAccionEn(sinNombresDe(original)) || imperativoEnFragmento(p)) return false;
  return /[¿?]/.test(p) || palabras.some((w) => RE_CONSULTA.test(w) || RE_INFINITIVO_CONSULTA.test(w)) || pideUnDato(p);
}

/** «necesito SABER», «me puedes DECIR», «podrías BUSCAR»: el infinitivo de una consulta también la marca (ronda 7). */
const RE_INFINITIVO_CONSULTA =
  /^(saber|decir|decirme|decirnos|buscar|buscarme|averiguar|averiguarme|investigar|consultar|revisar|leer|leerme|explicar|explicarme|contar|contarme|conocer|comparar|resumir|resumirme|encontrar|checar|verificar|comprobar|know|find|look|check)$/;
/**
 * «I need the gold price», «quiero el precio del dólar»: pedir un DATO con «necesito / quiero / need / want» y un
 * determinante, sin nada que sea archivo, documento o correo en ese fragmento (eso es una entrega, no una consulta).
 */
const DETERMINANTES = new Set('el la los las un una unos unas mi mis tu su sus the a an my your our some'.split(' '));
function pideUnDato(p: string): boolean {
  return fragmentosDe(p).some((f) => {
    if (RE_NO_ES_TEXTO_EN_CHAT.test(f) || /\b(informes?|reportes?|reports?|presupuestos?|facturas?|invoices?|contratos?|contracts?|budgets?)\b/.test(f)) return false;
    const ws = f.match(/[a-zñ0-9']+/g) || [];
    let i = 0;
    while (i < ws.length && (SALTABLES.has(ws[i]) || /^(i|we|yo|nosotros|me|nos|would|like|really)$/.test(ws[i]))) i++;
    return /^(necesito|necesitamos|ocupo|quiero|queremos|quisiera|need|want|needs|wants)$/.test(ws[i] || '') && DETERMINANTES.has(ws[i + 1] || '');
  });
}

/** Los fragmentos de una instrucción, por sus conectores: y, e, luego, después, entonces, and, then, «,», «;», «.». */
function fragmentosDe(p: string): string[] {
  return p
    .replace(/[¿¡«»"“”()]/g, ' ')
    // Un punto parte solo si termina la frase (no en «bch.hn» ni en «24.70»).
    .split(/[,;!?:\n]|\.(?=\s|$)|\s(?:y|e|luego|despues|entonces|and|then)\s/)
    .map((x) => x.trim())
    .filter(Boolean);
}
/** Cómo puede empezar un fragmento de consulta: un verbo de consulta (lista CERRADA). */
const INICIO_CONSULTA =
  /^(?:(?:busca|averigua|investiga|consulta|revisa|mira|compara|lee|resume|encuentra|explica|cuenta|muestra|ensena|checa|chequea|verifica|comprueba|fija)(?:me|te|lo|la|los|las|nos|melo|mela|noslo|nosla)?|dime|dimelo|dinos|decime|di|ve|abre|entra|visita|saber|decir|decirme|decirnos|buscar|buscarme|averiguar|investigar|consultar|revisar|mirar|ver|comparar|leer|resumir|resumirme|encontrar|explicar|explicarme|contar|contarme|conocer|checar|verificar|comprobar|find|search|look|check|tell|explain|read|summarize|compare|show|open|visit|what|whats|how|which|who|whom|whose|when|where|why|is|are|was|were|does|do|did|know)$/;
/** …o una palabra que no es verbo (lista CERRADA): artículos, determinantes, preposiciones, números, interrogativos. */
const INICIO_NO_VERBO = new Set(
  (
    // Ronda 8: sin «esta», «estos», «estas»: sin tilde son también «está», «estás» (verbo: «si está barata renueva…»).
    'el la los las lo un una unos unas este ese esa esos esas aquel aquella mi mis tu tus su sus nuestro nuestra ' +
    'a al de del en con por para sin sobre entre hasta desde hacia segun ante tras ' +
    'que cual cuales cuanto cuanta cuantos cuantas como donde cuando quien quienes porque si tambien ademas favor porfa porfavor gracias ' +
    'cero uno dos tres cuatro cinco seis siete ocho nueve diez cien mil ' +
    'the a an of in on at to for with from by about also please if whether some any my your our its this that these those ' +
    'one two three four five ten'
  ).split(' ')
);
/** Producir texto que va en la respuesta (solo cuenta si se permite: el texto en el chat). */
const INICIO_TEXTO = (w: string) => RE_V_PRODUCIR_COSA.test(w) || RE_V_NECESIDAD.test(w) || RE_V_TRADUCIR.test(w);
/**
 * Lo que se salta al principio de un fragmento para ver la palabra que de verdad lo empieza (ronda 7): «si», «además»,
 * «por favor», «also», «please»… («y si alcanza PAGA la luz», «y por favor RESERVA», «Also BUY») y lo que pide sin
 * decir el verbo todavía («necesito SABER», «me puedes DECIR», «podrías BUSCAR», «I need THE…»).
 */
const SALTABLES = new Set('si ademas tambien por favor porfa porfavor pues bueno also please so then if and y e luego despues entonces'.split(' '));
const MODALES = new Set('necesito necesitamos necesita quiero queremos quisiera me nos te puedes puede podrias podria pudieras puedo i we need want would like can could you to'.split(' '));
/** «¿Está abierto…?», «¿Hay vuelos…?», «¿Es cierto…?»: un verbo de estado empieza una consulta solo si es una PREGUNTA. */
const INICIO_PREGUNTA = /^(es|esta|estan|estas|hay|son|sera|seran|tiene|tienen|queda|quedan|sigue|siguen|abre|abren|cierra|cierran)$/;
function fragmentosAceptables(p: string, permitirTexto: boolean): boolean {
  const pregunta = /[¿?]/.test(p);
  return fragmentosDe(p).every((f) => {
    const ws = f.match(/[a-zñ0-9']+/g) || [];
    let i = 0;
    while (i < ws.length && (SALTABLES.has(ws[i]) || MODALES.has(ws[i]))) i++;
    const w = ws[i] || '';
    // Tras «si» no hay pregunta: «si está barata…» es la condición de una acción, no «¿está barata?».
    const trasSi = ws.slice(0, i).includes('si') || ws.slice(0, i).includes('if');
    return !w || INICIO_CONSULTA.test(w) || (INICIO_NO_VERBO.has(w) && !SALTABLES.has(w)) || /^\d+$/.test(w) || (pregunta && !trasSi && INICIO_PREGUNTA.test(w)) || (permitirTexto && INICIO_TEXTO(w));
  });
}

/**
 * Ronda 8 («analiza el fragmento entero»): un imperativo en medio de un fragmento, aunque el fragmento empiece por una
 * palabra que no es verbo («y EN la página VENDE mis acciones», «si llueve APAGA los aspersores», «si está barata RENUEVA
 * la suscripción»). Una palabra terminada como un imperativo (-a, -e) que NO va detrás de un artículo, una preposición
 * o un interrogativo, y SÍ va delante de su objeto (mis, el, la, un, a…). Los verbos de consulta no cuentan.
 */
const OBJETO_DETRAS = new Set('mis mi tus tu sus su el la los las un una unos unas a al todo todos toda todas esa ese esos esas eso esto lo le les'.split(' '));
const NOMINAL_DELANTE = new Set(
  (
    'el la los las lo un una unos unas mi mis tu tus su sus este esta estos estas ese esa esos esas del al de a en con por para sin sobre entre hasta desde hacia segun ' +
    'que cual cuales cuanto cuanta cuantos cuantas como donde cuando quien quienes si no ya muy mas menos tan hora se te me nos le les ' +
    'the a an of in on at to for with from by my your our its this that these those is are was were be'
  ).split(' ')
);
/** Palabras terminadas en -a/-e que no son imperativos (preposiciones, adverbios, tiempo): «para el», «ahora la», «siempre el». */
const NO_IMPERATIVO = new Set(
  (
    'para sobre entre desde hasta hacia ante donde como cuando siempre ahora antes tarde manana noche semana mismo misma toda todo cada otra otro nunca mientras grande grandes este esta ese esa aquella ' +
    // Verbos de estado en tercera persona («qué precio TIENE el café», «cuánto CUESTA la onza», «a qué hora ABRE el banco»).
    'tiene cuesta vale queda hace dice sale llega viene pasa juega gana pesa mide dura falta parece existe incluye contiene significa aparece ocurre sucede empieza termina abre ofrece'
  ).split(' ')
);
function imperativoEnFragmento(p: string): boolean {
  return fragmentosDe(p).some((f) => {
    const ws = f.match(/[a-zñ]+/g) || [];
    for (let i = 1; i < ws.length - 1; i++) {
      const w = ws[i];
      if (w.length < 4 || !/[ae]$/.test(w) || NO_IMPERATIVO.has(w) || INICIO_NO_VERBO.has(w) || NOMINAL_DELANTE.has(w) || INICIO_CONSULTA.test(w) || RAIZ_CONSULTA.test(w)) continue;
      if (NOMINAL_DELANTE.has(ws[i - 1]) || !OBJETO_DETRAS.has(ws[i + 1])) continue;
      return true;
    }
    return false;
  });
}

/**
 * Defensa (ronda 7): un verbo de ACCIÓN conocido en cualquier forma (compra, compre, compras, comprar, paga, reserva,
 * instala, anota; buy, pay, book, install, order…) saca la misión del camino de consulta. Lo que es un sustantivo detrás
 * de un artículo («la compra», «el pago», «la reserva», «the order», «a book») no.
 */
// Ronda 8: también vender, firmar, aceptar, confirmar, aprobar, retirar, donar, invertir, reiniciar, apagar, cambiar,
// publicar, subir, votar, depositar, cerrar, pedir, solicitar, activar, desactivar, responder, renovar, seguir (a alguien).
const RE_FORMA_ACCION =
  /^(?:compr|pag|pagu|reserv|instal|desinstal|anot|apart|agend|mand|envi|reenvi|transfier|transfer|cancel|llen|rellen|borr|elimin|descarg|guard|llam|avis|orden|alquil|contrat|suscrib|inscrib|imprim|renombr|compart|vend|firm|acept|confirm|aprob|aprueb|retir|don|invert|inviert|reinici|apag|apagu|cambi|public|publiqu|sub|vot|deposit|cierr|cerr|ped|pid|solicit|activ|desactiv|respond|renov|renuev|sigu)(?:a|as|e|es|en|an|o|ar|er|ir|ando|iendo|ado|ido|ada|ida|amos|emos|imos|aste|aron|ara|aria|are|ue|ues|uen)(?:lo|la|los|las|le|les|me|nos|selo|sela|melo|mela)?$/;
const RE_ACCION_EN =
  /^(buy|buys|buying|bought|pay|pays|paying|paid|book|books|booking|booked|install|installs|installing|installed|order|orders|ordering|ordered|purchase|purchases|purchased|purchasing|reserve|reserves|reserved|send|sends|sending|sent|email|emails|emailed|text|texts|texted|share|shares|shared|post|posts|posted|delete|deletes|deleted|remove|removes|removed|fix|fixes|fixed|cancel|cancels|cancelled|canceled|transfer|transfers|transferred|subscribe|subscribed|download|downloads|downloaded|upload|uploads|uploaded|save|saves|saved|forward|reply|replies|replied|schedule|scheduled|sell|sells|selling|sold|sign|signs|signed|accept|accepts|accepted|approve|approves|approved|withdraw|withdraws|withdrew|donate|donates|donated|invest|invests|invested|restart|restarts|restarted|reboot|shut|change|changes|changed|wire|wires|wired|turn|turns|turned|switch|vote|votes|voted|renew|renews|renewed|deposit|deposits|deposited|activate|activated|deactivate|deactivated|enable|enabled|disable|disabled|unsubscribe|unsubscribed|publish|published|submit|submitted|confirm|confirmed)$/;
const ANTES_DE_SUSTANTIVO = new Set('el la los las un una unos unas mi tu su mis tus sus este esta ese esa del al de se the a an my your our this that its his her their in of'.split(' '));
const NO_SON_ACCION = new Set(['aparte', 'cobre', 'mando', 'llamas', 'done', 'dones', 'subes']);
/** Delante de un interrogativo, el verbo describe («a qué hora CIERRA», «cuánto SUBE», «dónde VENDEN», «quién RESPONDE»). */
const INTERROGATIVO_DELANTE = new Set('que cual cuales cuanto cuanta cuantos cuantas donde cuando quien quienes como hora'.split(' '));
const DESCRIPTIVOS = /^(sube|suben|subio|baja|bajan|cambia|cambian|cierra|cierran|abre|abren|sigue|siguen)$/;
function verboDeAccionEn(original: string): boolean {
  const ws = plegar(String(original || '')).match(/[a-zñ']+/g) || [];
  return ws.some((w, i) => {
    if (NO_SON_ACCION.has(w)) return false;
    const es = RE_FORMA_ACCION.test(w);
    const en = RE_ACCION_EN.test(w);
    if (!es && !en) return false;
    // «la compra», «el pago», «the order»: un sustantivo (solo en las formas que pueden serlo).
    if (ANTES_DE_SUSTANTIVO.has(ws[i - 1] || '') && (en || /[aoe]$/.test(w))) return false;
    // «a qué hora cierra», «cuánto sube», «si sube el dólar»: describe, no manda (la acción, si la hay, es OTRA palabra).
    if (es && (INTERROGATIVO_DELANTE.has(ws[i - 1] || '') || (DESCRIPTIVOS.test(w) && (ws[i - 1] === 'si' || ws[i - 1] === 'esta')))) return false;
    return true;
  });
}

/**
 * ¿La respuesta REMITE a otro lugar en vez de traer el texto? («lo dejé abierto en el navegador», «ya se encuentra
 * disponible en la pantalla», «está en la ventana del editor», «is now displayed on the desktop screen»). Eso no es la
 * entrega: el texto no vino en la respuesta.
 */
// Ronda 8: también el portapapeles, Firefox, Chrome, gedit, LibreOffice, la terminal, una nota o «la página que abrí».
const RE_LUGAR =
  /\b(pantalla|ventana|navegador|escritorio|editor|pestana|portapapeles|firefox|chrome|chromium|gedit|libreoffice|writer|terminal|consola|bloc de notas|aplicacion de notas|screen|desktop|browser|window|tab|clipboard|notepad|notes app|console)\b/;
const RE_REMITE =
  /\b(esta en|quedo en|queda en|se encuentra|disponible|deje abiert[oa]|dejo abiert[oa]|lo deje|la deje|te lo deje|abiert[oa] en|copie|pegues|pegarlo|puedes leer|puedes verl[oa]|lo tienes en|ya lo tienes|lo encuentras|lo veras|aparece en|que abri|que cree|que deje|imprimi|is on|is in|on the|in the|displayed|shown|left (it )?open|open on|open in|copied|paste|you can read|you will find|i opened|printed)\b/;
const RE_REMITE_SOLO =
  /\b(lo deje abierto|la deje abierta|left it open|is now displayed|displayed on|shown on|(?:pagina|sitio|archivo|documento|nota|aplicacion|ventana|pestana)\b[^.;]{0,60}\bque (?:abri|cree|deje|escribi)|(?:page|site|file|document|note|tab|window) i (?:opened|created|left))\b/;
export function remiteAOtroLugar(respuesta: string | null | undefined): boolean {
  return plegar(String(respuesta || ''))
    .split(/(?<=[.!?…])\s+|\n+/)
    .some((f) => (RE_LUGAR.test(f) && RE_REMITE.test(f)) || RE_REMITE_SOLO.test(f));
}
const RE_CLITICO = /(selos|selas|selo|sela|noslo|nosla|melo|mela|telo|tela|los|las|les|lo|la|le|me|nos)$/;
/** Imperativos con enclítico comunes, sin tilde (como se escriben de prisa). */
const RE_IMPERATIVO_CLITICO =
  /^(anota|compra|aparta|instala|desinstala|manda|envia|reenvia|comparte|reserva|paga|borra|elimina|guarda|descarga|sube|publica|pide|ordena|agenda|apunta|copia|mueve|renombra|imprime|baja|avisa|llama|marca|agrega|anade|cambia|arregla|actualiza|cierra|transfiere|deposita|cobra|cancela|confirma|acepta|rechaza|firma|llena|rellena|completa|registra|inscribe|suscribe|haz|pon|di|da|escribe)(selos|selas|selo|sela|noslo|nosla|melo|mela|los|las|les|lo|la|le|me|nos)$/;
const RAIZ_CONSULTA = /^(busca|averigua|investiga|consulta|revisa|mira|fija|compara|di|explica|cuenta|lee|resume|encuentra|muestra|ensena|checa|verifica|comprueba)$/;
const RAIZ_TEXTO = /^(crea|haz|genera|prepara|arma|disena|dibuja|escribe|redacta|traduce|da|resume|explica)$/;
/**
 * ¿Hay un imperativo con enclítico que no sea de consulta («anótalo», «cómpralos», «apártame», «instálalas»,
 * «mándaselo»)? Con tilde, si lo que queda antes del enclítico acaba como un imperativo (a, e, i) y no va detrás de un
 * artículo («Los Ángeles», «la película» no). Sin tilde, los de la lista. `permitirTexto`: «escríbeme», «hazme»,
 * «tradúceme» no cuentan (el texto en el chat).
 */
function accionEnclitica(original: string, permitirTexto: boolean): boolean {
  const ws = [...String(original || '').normalize('NFC').matchAll(/\p{L}+/gu)].map((m) => m[0]);
  return ws.some((w, i) => {
    const p = plegar(w);
    const c = RE_CLITICO.exec(p);
    if (!c) return false;
    const raiz = p.slice(0, p.length - c[1].length);
    if (RAIZ_CONSULTA.test(raiz) || (permitirTexto && RAIZ_TEXTO.test(raiz))) return false;
    if (ARTICULOS.has(plegar(ws[i - 1] || '')) || INICIO_NO_VERBO.has(plegar(ws[i - 1] || '')) && /^(el|la|los|las|un|una|unos|unas|mi|mis|tu|tus|su|sus)$/.test(plegar(ws[i - 1] || ''))) return false;
    if (RE_IMPERATIVO_CLITICO.test(p)) return true;
    return /[áéíóú]/.test(w.toLowerCase()) && raiz.length >= 3 && /[aei]$/.test(raiz);
  });
}

/** ¿La instrucción solo opera sobre archivos que ya existen (copiar, mover, renombrar, borrar, descomprimir), sin crear nada? */
export function esOperacionDeArchivos(instruccion: string): boolean {
  // Con los nombres quitados: «facturas.zip» no es el verbo «zip».
  const palabras = plegar(sinNombresDe(sinUrls(String(instruccion || '')))).match(/[a-zñ]+/g) || [];
  const op = palabras.some((w, i) => RE_V_OPERACION.test(w) && !ARTICULOS.has(palabras[i - 1] || ''));
  const otra = palabras.some((w) => RE_V_ENTREGA.test(w) || RE_V_NECESIDAD.test(w) || RE_V_CONVERTIR.test(w));
  return op && !otra;
}

/* ---- correcciones, negaciones y ejemplos de referencia ---- */

/** «dos PDFs, no, tres PDFs», «en PDF no, mejor en Word», «un Word, perdón, un PDF»: lo de después reemplaza a lo de antes. */
const RE_CORRECCION = /\bno\s*[,:;]|\bmejor\b|\bmas bien\b|\bperdon\b|\bdigo\b|\bo sea\b|\bquiero decir\b|\bcorrijo\b|\bi mean\b|\bactually\b|\brather\b|\bsorry\b/;
/** «y no un Word», «sin PDF», «not a PDF»: eso no se pide. */
const RE_NEGACION_ANTES = /\b(?:no|sin|without|not|ni)\s+(?:(?:un|una|el|la|los|las|en|a|an|the|ningun|ninguna)\s+)?$/;
/** «como el PDF de ayer», «igual que el anterior», «basado en la plantilla»: un ejemplo de referencia (origen), no un entregable. */
const RE_REFERENCIA_ANTES =
  /(?:\b(?:como|like)\s+(?:el|la|los|las|the)\s+|\b(?:igual que|igual a|parecid[oa]s? a|similar a|basad[oa]s? en|siguiendo|al estilo de|similar to|based on|same as)\s+(?:(?:el|la|los|las|al|the)\s+)?)$/;

/* ---- la carpeta dicha con palabras ---- */

const ALIAS_CARPETA: Record<string, string> = {
  documentos: 'documents', 'mis documentos': 'documents', documents: 'documents',
  escritorio: 'desktop', desktop: 'desktop',
  descargas: 'downloads', downloads: 'downloads',
  imagenes: 'pictures', pictures: 'pictures', fotos: 'pictures',
};
/** «Documentos/Facturas» → «documents/facturas»; «escritorio» → «desktop». */
export function normalizarCarpeta(c: string): string {
  return plegar(c)
    .split('/')
    .map((x) => x.replace(/\s+/g, ' ').trim())
    .filter((x) => x && x !== '~' && x !== '.')
    .map((x) => ALIAS_CARPETA[x] || x)
    .join('/');
}
/** ¿El archivo está directamente en esa carpeta (al final de su ruta)? */
export function enCarpeta(ruta: string, carpeta: string): boolean {
  const padre = normalizarCarpeta(String(ruta).split('/').slice(0, -1).join('/')).split('/');
  const quiere = carpeta.split('/').filter(Boolean);
  if (!quiere.length || quiere.length > padre.length) return false;
  return quiere.every((x, i) => padre[padre.length - quiere.length + i] === x);
}
/** «en la carpeta facturas», «a la carpeta de José», «en Documentos/facturas», «en el escritorio», «en Descargas», «into the Reports folder». */
const RE_CARPETA_DICHA = new RegExp(
  [
    // «en la carpeta Facturas 2024»: el nombre completo, hasta la puntuación (cortarCarpeta lo recorta en «y …»).
    '\\b(?:en|a|al|dentro de|in|into|to)\\s+(?:(?:la|el|mi|tu|su|the|my|your)\\s+)?(?:carpeta|folder|directorio)\\s+(?:de\\s+|del\\s+|llamada\\s+|called\\s+)?["«]?([a-z0-9ñ_.-][^,.;:!?\\n"»]*)',
    '\\b(?:en|a|al|in|into|to)\\s+(?:(?:la|el|mis|tus|sus|mi|tu|su|the|my|your)\\s+)?((?:documentos|documents|escritorio|desktop|descargas|downloads|imagenes|pictures)(?:/[^/,.;:!?\\n"»]+)*)',
    '\\b(?:en|a|al|in|into|to)\\s+(~?/?[a-z0-9ñ_.-]+(?:/[^/,.;:!?\\n"»]+)+)/?',
  ].join('|'),
  'g'
);
/** Lo que sigue a la carpeta y no es su nombre: «… y mándalo», «… para el cliente». */
function cortarCarpeta(c: string): { carpeta: string; duda: boolean } {
  const corto = c.replace(/\s+(?:y|e|o|u|and|or|para|por|con|que|donde|luego|despues|then|for|with)\s.*$/, '').replace(/\s+(?:y|e|and)$/, '').trim();
  const ultimo = corto.split('/').pop() || '';
  // Un nombre de carpeta muy largo, o con «de la», «del»: no se sabe dónde termina.
  const duda = ultimo.split(/\s+/).length > 4 || /\s(?:de|del|de la|de los|of the)\s/.test(` ${ultimo} `.replace(/^\s\S+/, ''));
  return { carpeta: corto, duda };
}

/** Lo que se usa sin nombre («baja el estado de cuenta», «abre el excel del correo»): `ext` null si no se sabe de qué tipo es. */
export type OrigenSinNombre = { etiqueta: string; ext: string[] | null; pos: number };
export type PedidoEntrega = {
  items: Requisito[];
  seguro: boolean;
  explicitos: number;
  /** Lo que la instrucción usa como ORIGEN: nunca cumple un requisito (ni sus copias). */
  origenes: { nombres: string[]; sinNombre: OrigenSinNombre[] };
  /** Lo único que se pide producir es TEXTO que va en la respuesta (un resumen, una lista, una traducción): la respuesta es la entrega. */
  textoEnChat?: boolean;
  /** Lo que pidió la PERSONA, guardado con los requisitos al crear la misión (G2-C: se evalúa sobre las dos instrucciones). */
  pedidoPersona?: string;
};

/**
 * Los requisitos de lo que se pidió dejar. «Crea tres documentos: informe.docx, presupuesto.xlsx y carta.pdf» → tres
 * con nombre y tipo; «guarda 3 PDFs» → tres PDFs; «un Word y dos PDFs» → tres; «dos archivos PDF» → dos PDFs (el
 * formato pegado precisa el sustantivo); «descarga las facturas de enero, febrero y marzo» → tres (una por mes);
 * «dos capturas del sitio por favor» → dos (sin verbo también: mencionar un tipo de archivo es pedirlo, salvo que sea de
 * donde sale: «abre el PDF y dime qué dice»). Lo que se usa («lee informe.pdf», «convierte datos.csv», «de ventas.xlsx»)
 * no se entrega y queda en `origenes`. «Guárdalo como PDF» es el formato del mismo entregable. El mismo nombre en dos
 * carpetas son dos. `seguro: false` si no se puede saber cuántos, o si algo sin nombre que se baja o se abre no se
 * puede distinguir de lo que se crea. `explicitos`: cuántos salen de lo que dijo: con alguno, la misión es de archivos.
 */
export function requisitosDeEntrega(instruccion: string): PedidoEntrega {
  const sinWeb = sinUrls(String(instruccion || '')).normalize('NFC');
  const p = plegar(sinWeb);
  let seguro = true;
  const origenes: PedidoEntrega['origenes'] = { nombres: [], sinNombre: [] };

  // 1) Los nombres que se entregan; los de origen, aparte. Sin repetir la MISMA ruta; el mismo nombre en otra carpeta es otro.
  type Nombre = { nombre: string; ruta?: string; pos: number; fin: number; alternativa?: string };
  const vistos: Nombre[] = [];
  const esVerbo = (w: string) => RE_V_ENTREGA.test(w) || RE_V_NECESIDAD.test(w) || RE_V_ORIGEN.test(w) || RE_V_CONVERTIR.test(w) || RE_V_OPERACION.test(w) || RE_V_PRODUCIR_COSA.test(w) || RE_V_PRODUCIR_ARCHIVO.test(w);
  const enTexto = nombresEn(sinWeb, esVerbo);
  const sinNombres = (() => {
    let r = p;
    for (const n of enTexto) r = r.slice(0, n.pos) + ' '.repeat(n.fin - n.pos) + r.slice(n.fin);
    return r;
  })();
  for (const m of enTexto) {
    const pos = m.pos;
    const ruta = m.ruta;
    const antes = sinNombres.slice(0, pos);
    const papel = papelEn(antes);
    if (papel === 'origen' || RE_ORIGEN_ANTES.test(antes.trimEnd() + ' ') || RE_REFERENCIA_ANTES.test(antes.trimEnd() + ' ')) {
      if (!origenes.nombres.includes(nombreDeRuta(ruta).toLowerCase())) origenes.nombres.push(nombreDeRuta(ruta).toLowerCase());
      continue;
    }
    vistos.push({ nombre: nombreDeRuta(ruta), ...(ruta.includes('/') ? { ruta } : {}), pos, fin: m.fin, ...(m.alternativa ? { alternativa: m.alternativa } : {}) });
  }
  const clave = (n: Nombre) => (n.ruta ? n.ruta.replace(/^\.\//, '') : n.nombre).toLowerCase();
  const nombres: Nombre[] = [];
  for (const n of vistos) {
    if (nombres.some((x) => clave(x) === clave(n))) continue;
    // «factura.pdf» suelto y «~/Documents/factura.pdf»: el mismo; dos carpetas distintas: dos.
    const mismoNombre = (x: Nombre) => x.nombre.toLowerCase() === n.nombre.toLowerCase();
    if (!n.ruta && vistos.some((x) => x.ruta && mismoNombre(x))) continue;
    nombres.push(n);
  }

  // 2) Las frases de tipo con su cantidad («tres documentos», «3 PDFs», «una hoja de cálculo», «como PDF»). Primero
  // las crudas; un formato pegado a un sustantivo genérico lo precisa («dos archivos PDF», «two PDF files»).
  type Cruda = { fam: Familia; det: string; sustantivo: string; pos: number; fin: number }; // sinNombres: «informe.docx» no es la frase «docx»
  const crudas: Cruda[] = [];
  for (const m of sinNombres.matchAll(RE_FRASE)) {
    const fam = FAMILIAS.find((f) => new RegExp(`^(?:${f.re})$`).test(m[2]));
    if (fam) crudas.push({ fam, det: m[1] || '', sustantivo: m[2], pos: m.index ?? 0, fin: (m.index ?? 0) + m[0].length });
  }
  const unidas: Cruda[] = [];
  for (let i = 0; i < crudas.length; i++) {
    const a = crudas[i];
    const b = crudas[i + 1];
    if (b && !b.det && RE_PEGADO.test(sinNombres.slice(a.fin, b.pos))) {
      // «archivos PDF», «documentos en Word», «imágenes PNG»: el genérico, con el formato del segundo.
      if (FAMILIAS_GENERICAS.has(a.fam.clave) && !FAMILIAS_GENERICAS.has(b.fam.clave) && (a.fam.ext.length === 0 || b.fam.ext.some((e) => a.fam.ext.includes(e)))) {
        unidas.push({ ...a, fam: b.fam, fin: b.fin });
        i++;
        continue;
      }
      // «PDF files», «Word documents»: el formato primero, el genérico después (inglés).
      if (!FAMILIAS_GENERICAS.has(a.fam.clave) && FAMILIAS_GENERICAS.has(b.fam.clave) && /^\s+$/.test(sinNombres.slice(a.fin, b.pos))) {
        const plural = /s$/.test(b.sustantivo);
        unidas.push({ ...a, sustantivo: plural ? `${a.sustantivo}s` : a.sustantivo, fin: b.fin });
        i++;
        continue;
      }
    }
    unidas.push(a);
  }

  type Frase = { fam: Familia; cantidad: number | null; pos: number; fin: number; otro: boolean; absorbio: number; verbo: string | null };
  const frases: Frase[] = [];
  const reformatos: { fam: Familia; pos: number }[] = [];
  for (const u of unidas) {
    const { fam, det, sustantivo, pos } = u;
    const previo = sinNombres.slice(0, pos).trimEnd() + ' ';
    const v = verboYPapel(sinNombres.slice(0, pos));
    // «como el PDF de ayer», «igual que la plantilla»: un ejemplo, no algo que entregar.
    if (RE_REFERENCIA_ANTES.test(previo) || (/^(el|la|los|las|the)$/.test(det) && /\b(?:como|like)\s+$/.test(previo))) continue;
    // «del PDF», «abre el PDF», «busca fotos»: de dónde sale (se anota como origen). «en Documentos»: la carpeta.
    if (v.papel === 'origen' || RE_ORIGEN_ANTES.test(previo)) {
      if (v.papel === 'origen' && v.verbo && RE_V_TRAER.test(v.verbo)) origenes.sinNombre.push({ etiqueta: fam.clase, ext: fam.ext.length ? fam.ext : null, pos });
      continue;
    }
    if (FAMILIAS_CARPETA.has(fam.clave) && RE_LUGAR_ANTES.test(previo) && !esArticuloIngles(previo)) continue;
    const plural = /^(?:\w+?)(?:s|es)\b/.test(sustantivo.split(/\s+/)[0]) && !/^(?:xlsx|docx|pptx)$/.test(sustantivo);
    let cantidad: number | null;
    if (/^\d+$/.test(det)) cantidad = Math.min(50, Number(det));
    else if (det in CANTIDADES && CANTIDADES[det] > 0) cantidad = CANTIDADES[det];
    else cantidad = plural ? null : 1;
    // Sin verbo en su oración también cuenta: mencionar un tipo de archivo es pedirlo («dos capturas del sitio por favor»).
    if (RE_REFORMATO_ANTES.test(previo)) {
      reformatos.push({ fam, pos });
      continue;
    }
    frases.push({ fam, cantidad, pos, fin: u.fin, otro: /^(otro|otra|another)$/.test(det), absorbio: 0, verbo: v.verbo });
  }
  // Una corrección hablada («dos PDFs, no, tres PDFs», «en PDF no, mejor en Word») reemplaza lo que corrige; «y no un
  // Word» excluye lo que niega. Entre nombres y frases, en el orden en que se dijeron.
  {
    const menciones = [...nombres.map((n) => ({ n, f: null as Frase | null, pos: n.pos, fin: n.fin })), ...frases.map((f) => ({ n: null as Nombre | null, f, pos: f.pos, fin: f.fin }))].sort((x, y) => x.pos - y.pos);
    const fuera = new Set<unknown>();
    menciones.forEach((cur, i) => {
      const antesDe = sinNombres.slice(i > 0 ? menciones[i - 1].fin : 0, cur.pos);
      if (RE_NEGACION_ANTES.test(sinNombres.slice(0, cur.pos).trimEnd() + ' ') && !/[,;:]\s*$/.test(antesDe.trimEnd())) fuera.add(cur.n || cur.f);
      else if (i > 0 && RE_CORRECCION.test(antesDe)) fuera.add(menciones[i - 1].n || menciones[i - 1].f);
    });
    for (let i = nombres.length - 1; i >= 0; i--) if (fuera.has(nombres[i])) nombres.splice(i, 1);
    for (let i = frases.length - 1; i >= 0; i--) if (fuera.has(frases[i])) frases.splice(i, 1);
  }
  // «Crea un documento… y guárdalo como PDF»: el formato del entregable de antes (el mismo archivo), no otro. Si lo de
  // antes tiene nombre («crea informe.docx y expórtalo a PDF»), son dos: el nombrado y el exportado.
  const extra: Frase[] = [];
  for (const r of reformatos) {
    const f = [...frases].reverse().find((x) => x.pos < r.pos);
    const n = [...nombres].reverse().find((x) => x.pos < r.pos);
    if (f && (!n || n.pos < f.pos)) {
      f.fam = r.fam;
      continue;
    }
    extra.push({ fam: r.fam, cantidad: 1, pos: r.pos, fin: r.pos, otro: true, absorbio: 0, verbo: null });
  }
  frases.push(...extra);
  // «Comprime la carpeta reportes»: comprimir deja un ZIP aunque no lo nombre.
  const palabras = sinNombres.match(/[a-zñ]+/g) || [];
  const iComp = palabras.findIndex((w) => RE_V_COMPRIMIR.test(w));
  if (iComp >= 0 && !frases.some((f) => f.fam.clave === 'zip') && !nombres.some((n) => extDe(n.nombre) === 'zip')) {
    const zip = FAMILIAS.find((f) => f.clave === 'zip')!;
    const posZip = sinNombres.search(new RegExp(`\\b${palabras[iComp]}\\b`));
    frases.push({ fam: zip, cantidad: 1, pos: posZip, fin: posZip, otro: true, absorbio: 0, verbo: palabras[iComp] });
  }
  frases.sort((a, b) => a.pos - b.pos);

  // Algo sin nombre que se baja («baja el estado de cuenta») y DESPUÉS se crea otra cosa: lo bajado no se distingue de
  // lo creado si es de tipo desconocido o del mismo tipo.
  for (const m of sinNombres.matchAll(/\b(baja|bajame|bajate|descarga|descargame|download)\s+((?:(?:el|la|los|las|mi|tu|su|the|my)\s+)?[a-zñ]+(?:\s+(?:de|del)\s+[a-zñ]+)?)/g)) {
    const pos = m.index ?? 0;
    const objeto = m[2];
    if (unidas.some((u) => u.pos >= pos && u.pos <= pos + m[0].length)) continue; // «descarga el PDF»: ya es una frase de tipo
    const despues = frases.some((f) => f.pos > pos && f.verbo && RE_V_CREAR.test(f.verbo));
    if (despues) origenes.sinNombre.push({ etiqueta: objeto.trim(), ext: null, pos });
  }

  const items: Requisito[] = [];
  const posDe = new Map<Requisito, number>();
  const repetido = (n: Nombre) => nombres.filter((x) => x.nombre.toLowerCase() === n.nombre.toLowerCase()).length > 1;
  const dudosoPara = (ext: string[], pos: number) => origenes.sinNombre.find((o) => o.pos < pos && (o.ext === null || ext.length === 0 || o.ext.some((e) => ext.includes(e))));
  // Cada nombre es suyo; si viene después de una frase del mismo tipo que aún tiene sitio, es una de esas cosas.
  for (const n of nombres) {
    const ext = extDe(n.nombre);
    const f = [...frases].reverse().find((x) => !x.otro && x.pos < n.pos && (x.fam.ext.length === 0 || x.fam.ext.includes(ext)) && (x.cantidad === null || x.absorbio < x.cantidad));
    if (f) f.absorbio++;
    items.push({ id: '', etiqueta: n.ruta && repetido(n) ? n.ruta : n.nombre, nombre: n.nombre, ...(n.ruta ? { ruta: n.ruta } : {}), ...(n.alternativa ? { alternativa: n.alternativa } : {}), extensiones: [ext], clase: claseDeExt(ext), cantidadSegura: true, origen: 'pedido' });
    posDe.set(items[items.length - 1], n.pos);
  }
  for (const f of frases) {
    const dudoso = dudosoPara(f.fam.ext, f.pos);
    const marca = dudoso ? { dudoso: dudoso.etiqueta } : {};
    if (dudoso) seguro = false;
    if (f.cantidad === null) {
      if (f.absorbio > 0) continue; // «los documentos informe.docx y carta.pdf»: los nombres dicen cuántos
      seguro = false;
      items.push({ id: '', etiqueta: `${f.fam.claseP} (no dijiste cuántos)`, extensiones: f.fam.ext, clase: f.fam.clase, cantidadSegura: false, origen: 'pedido', ...marca });
      posDe.set(items[items.length - 1], f.pos);
      continue;
    }
    const resto = f.cantidad - f.absorbio;
    for (let k = 1; k <= resto; k++) {
      items.push({ id: '', etiqueta: resto > 1 ? `${f.fam.claseN} n.º ${k}` : f.fam.clase, extensiones: f.fam.ext, clase: f.fam.clase, cantidadSegura: true, origen: 'pedido', ...(f.fam.ext.length ? {} : { libre: true }), ...marca });
      posDe.set(items[items.length - 1], f.pos);
    }
  }

  // 3) Sin nombres ni tipos: un plural de otra cosa («descarga las facturas de enero, febrero y marzo», «baja 3
  // facturas»). Con número o enumeración, una por cada una; sin ellos, no se sabe cuántas (nunca verificado).
  if (!items.length) {
    for (const m of sinNombres.matchAll(new RegExp(`(?<![\\w.])(${DET})\\s+([a-zñ]{4,})\\b([^.;!?\\n]*)`, 'g'))) {
      const [, det, sustantivo, resto] = m;
      const v = verboYPapel(sinNombres.slice(0, m.index ?? 0));
      if (v.papel !== 'entrega' || !v.verbo || !RE_V_BAJAR.test(v.verbo) || VACIAS.has(sustantivo)) continue;
      const numero = /^\d+$/.test(det) ? Number(det) : det in CANTIDADES && CANTIDADES[det] > 1 ? CANTIDADES[det] : 0;
      const plural = /(s|es)$/.test(sustantivo);
      if (!numero && !(plural && new RegExp(`^(?:${PLURALES})$`).test(det))) break; // singular: un archivo que lo diga
      const enumeracion = /^\s*(?:de|del|para|of|for)\s+(?:(?:los|las|el|la|the)\s+)?(?:meses\s+de\s+|anos\s+|dias\s+)?([a-zñ0-9]+(?:\s*,\s*[a-zñ0-9]+)*\s+(?:y|e|and)\s+[a-zñ0-9]+)/.exec(resto);
      const partes = enumeracion ? enumeracion[1].split(/\s*,\s*|\s+(?:y|e|and)\s+/).filter(Boolean) : [];
      if (partes.length >= 2 && (!numero || numero === partes.length)) {
        partes.slice(0, 10).forEach((x) => items.push({ id: '', etiqueta: `${sustantivo}: ${x}`, extensiones: [], clase: 'un archivo', cantidadSegura: true, origen: 'pedido', claves: [raizDe(x)] }));
      } else if (numero) {
        for (let k = 1; k <= Math.min(numero, 10); k++) items.push({ id: '', etiqueta: `${sustantivo} n.º ${k}`, extensiones: [], clase: 'un archivo', cantidadSegura: true, origen: 'pedido', claves: [raizDe(sustantivo).slice(0, 7)] });
      } else {
        seguro = false;
        items.push({ id: '', etiqueta: `${sustantivo} (no dijiste cuántas)`, extensiones: [], clase: 'un archivo', cantidadSegura: false, origen: 'pedido' });
      }
      break;
    }
  }
  // 5) Cada verbo de PRODUCIR necesita algo reconocible que entregar. «Hazme una gráfica», «diseña un logo», «crea la
  // factura de Ana»: sin un tipo de archivo que se pueda revisar, un requisito «lo que pediste: …» que nunca se verifica.
  let textoEnChat = false;
  let produceOtraCosa = false;
  {
    const ws = [...sinNombres.matchAll(/[a-zñ]+/g)];
    const esCualquierVerbo = (w: string) => esVerbo(w) || RE_V_ACTUAR.test(w) || RE_CONSULTA.test(w) || RE_V_TRADUCIR.test(w);
    if (ws.some((m) => RE_V_TRADUCIR.test(m[0]))) textoEnChat = true;
    const entregables = [...nombres.map((n) => n.pos), ...frases.map((f) => f.pos)];
    ws.forEach((m, i) => {
      const w = m[0];
      // «dame una lista de ideas», «necesito un resumen»: pedir texto también es pedir un producto de texto.
      const pide = RE_V_NECESIDAD.test(w);
      if (!RE_V_PRODUCIR_COSA.test(w) && !pide) return;
      const ini = (m.index ?? 0) + w.length;
      let fin = sinNombres.length;
      const finOracion = sinNombres.slice(ini).search(RE_FIN_ORACION);
      if (finOracion >= 0) fin = ini + finOracion;
      for (let j = i + 1; j < ws.length; j++) {
        const x = ws[j];
        if ((x.index ?? 0) >= fin) break;
        if (esCualquierVerbo(x[0]) && !ARTICULOS.has(ws[j - 1]?.[0] || '')) {
          fin = x.index ?? fin;
          break;
        }
      }
      if (entregables.some((q) => q >= ini && q < fin)) {
        produceOtraCosa = true;
        return;
      }
      const objeto = limpio(sinWeb.slice(ini, fin).replace(/^\s*(?:me|nos|le|les)\s+/i, '').replace(/\s+(?:y|e|and)\s*$/i, ''), 60);
      if (!objeto || /^(lo|la|los|las|it|them|eso|esto)$/i.test(objeto)) return;
      // Texto que va en la respuesta («un resumen de la noticia», «una lista de ideas»): la respuesta es la entrega.
      const objetoP = plegar(sinWeb.slice(ini, fin)).trim();
      if (RE_PRODUCTO_TEXTO.test(objetoP) && !RE_NO_ES_TEXTO_EN_CHAT.test(objetoP)) {
        textoEnChat = true;
        return;
      }
      if (pide) return; // «necesito tres PDFs» ya salió como frase; lo demás no es producir
      produceOtraCosa = true;
      items.push({ id: '', etiqueta: `lo que pediste: ${objeto}`, extensiones: [], clase: 'lo que pediste', cantidadSegura: true, origen: 'pedido', inverificable: true });
      posDe.set(items[items.length - 1], m.index ?? 0);
    });
  }
  const explicitos = items.length;
  // Una consulta sobre un archivo nombrado («lee informe.pdf y dime qué dice»): no es un dato que se dé por bueno con el
  // texto, ni algo que se entregue; queda sin comprobar.
  if (!items.length && origenes.nombres.length)
    items.push({ id: '', etiqueta: `lo que pediste sobre ${origenes.nombres.slice(0, 3).join(', ')}`, extensiones: [], clase: 'lo que pediste', cantidadSegura: true, origen: 'pedido', inverificable: true });
  if (!items.length) items.push({ id: '', etiqueta: 'el archivo que pediste', extensiones: [], clase: 'un archivo', cantidadSegura: true, origen: 'pedido' });

  // 4) La carpeta dicha con palabras, con un verbo de dejar: restricción del requisito al que se refiere. «guárdalos» =
  // todo lo anterior; «guárdalo» = lo último; «guarda informe.pdf en la carpeta X» = lo que va entre el verbo y la
  // carpeta. Si no se puede asociar sin duda (o dos carpetas para lo mismo), no es seguro.
  let finCarpetaAnterior = -1;
  for (const m of sinNombres.matchAll(RE_CARPETA_DICHA)) {
    const pos = m.index ?? 0;
    const desdeCarpeta = finCarpetaAnterior;
    finCarpetaAnterior = pos + m[0].length;
    const cortada = cortarCarpeta(m[1] || m[2] || m[3] || '');
    const carpeta = normalizarCarpeta(cortada.carpeta);
    if (!carpeta) continue;
    if (cortada.duda) seguro = false;
    const antes = sinNombres.slice(0, pos);
    const ini = Math.max(...[...antes.matchAll(new RegExp(RE_FIN_ORACION, 'g'))].map((x) => (x.index ?? 0) + 1), 0);
    const ws = [...antes.slice(ini).matchAll(/[a-zñ]+/g)];
    let verbo: { w: string; pos: number } | null = null;
    for (let i = ws.length - 1; i >= 0; i--) {
      const w = ws[i][0];
      if (RE_V_OPERACION.test(w) && !ARTICULOS.has(ws[i - 1]?.[0] || '')) break; // copiar/mover: es el destino de una acción
      if (RE_V_ENTREGA.test(w) || RE_V_NECESIDAD.test(w)) {
        verbo = { w, pos: ini + (ws[i].index ?? 0) };
        break;
      }
    }
    if (!verbo) continue;
    const v = verbo;
    const conPos = items.filter((it) => posDe.has(it));
    let objetivo: Requisito[];
    // Cada cosa lleva la carpeta más cercana a su derecha: «informe.pdf en Documentos y carta.pdf en el Escritorio».
    const desde = Math.max(v.pos, desdeCarpeta);
    if (/(los|las)$/.test(v.w) || /\bthem\b/.test(antes.slice(v.pos))) objetivo = conPos.filter((it) => posDe.get(it)! < pos && posDe.get(it)! > desdeCarpeta);
    else if (/(lo|la)$/.test(v.w) && v.w.length > 4) objetivo = conPos.filter((it) => posDe.get(it)! < pos).slice(-1);
    else objetivo = conPos.filter((it) => posDe.get(it)! > desde && posDe.get(it)! < pos);
    if (!objetivo.length && items.length === 1) objetivo = items; // un solo entregable: es ese
    if (!objetivo.length) {
      seguro = false;
      continue;
    }
    for (const it of objetivo) {
      if (it.carpeta && it.carpeta !== carpeta) seguro = false;
      it.carpeta = carpeta;
    }
  }
  const TOPE = 10;
  if (items.length > TOPE) seguro = false;
  // Solo texto en el chat si NADA más lo vuelve archivo: ni un nombre, ni un tipo de archivo, ni «guárdalo», ni otra cosa
  // que producir, ni bajar, copiar o enviar.
  const palabrasTodas = sinNombres.match(/[a-zñ]+/g) || [];
  const soloTexto =
    textoEnChat &&
    !produceOtraCosa &&
    fragmentosAceptables(sinNombres, true) &&
    !accionEnclitica(sinWeb, true) &&
    !verboDeAccionEn(sinNombres) &&
    !imperativoEnFragmento(sinNombres) &&
    explicitos === 0 &&
    !enTexto.length &&
    !RE_NO_ES_TEXTO_EN_CHAT.test(sinNombres) &&
    !palabrasTodas.some((w, i) => RE_V_PRODUCIR_ARCHIVO.test(w) || RE_V_ACTUAR.test(w) || (RE_V_OPERACION.test(w) && !ARTICULOS.has(palabrasTodas[i - 1] || '')));
  return { items: items.slice(0, TOPE).map((x, i) => ({ ...x, id: `entrega-${i + 1}` })), seguro, explicitos, origenes, ...(soloTexto ? { textoEnChat: true } : {}) };
}

/** Lo que solo acusa recibo («Listo», «Ya está», «Aquí tienes:») al principio de una respuesta. */
const RE_ACUSE_INICIAL = /^\s*(?:¡\s*)?(?:listo|lista|hecho|hecha|ya\s+esta|ya\s+quedo|claro|perfecto|ok|okay|vale|done|sure|of course|aqui\s+(?:esta|tienes|va)|here\s+(?:it\s+is|you\s+go|is))[\s,.;:!¡-]*/;

/**
 * ¿La respuesta trae el texto pedido (no un acuse)? Quitado lo que solo acusa recibo, al menos 80 caracteres. La regla
 * de «trae algo» (respuestaInformativa) la aplica quien llama.
 */
export function respuestaConTexto(respuesta: string | null | undefined, datos?: { clave: string; valor: string }[] | null): boolean {
  // Si el texto va en un campo propio («Resumen: …», «Traducción: …»), ese es el que cuenta.
  const campo = (datos || []).find((d) => /^(resumen|traduccion|traducción|summary|translation|lista|tabla)$/i.test(plegar(d.clave).trim()));
  return textoSinAcuses(campo ? campo.valor : String(respuesta || '')).length >= 80;
}

/**
 * Lo que afirma haberlo hecho, en primera persona o refiriéndose al pedido (ronda 6): «ya hice el resumen», «lo
 * terminé», «lo revisé», «quedó listo», «como me pediste», «aquí lo tienes», «I've finished», «as you asked»… Esas
 * frases no son el resumen: se quitan antes de medir.
 */
const RE_AFIRMA_HECHO =
  /\b(ya hice|lo hice|la hice|hice el|hice la|hice tu|lo termine|la termine|termine|lo revise|la revise|revise|lo complete|la complete|complete|lo prepare|la prepare|prepare|quedo list[oa]|quedo bien|me (lo |la )?pediste|como (me lo |me la |me )?pediste|como pediste|tal como|aqui (lo|la) tienes|aqui (esta|tienes|va)|listo|hecho|ya esta|ya quedo|correctamente|con cuidado|dos veces|i have done|i ve done|i've done|i have finished|i ve finished|i've finished|i finished|i completed|i have completed|i ve completed|i've completed|done|as you asked|as requested|here it is|here you go|i made|i wrote|i translated|i ve translated|i've translated|i have translated|lo traduje|ya traduje|lo resumi|ya resumi|lo escribi|ya escribi|carefully|ready for you)\b/;
export function textoSinAcuses(respuesta: string): string {
  const frases = plegar(String(respuesta || ''))
    .split(/(?<=[.!?…])\s+|\n+|:\s+/)
    .map((x) => x.trim())
    .filter(Boolean);
  const sinAcuse = (f: string) => {
    let r = f;
    for (let i = 0; i < 4; i++) {
      const n = r.replace(RE_ACUSE_INICIAL, '');
      if (n === r) break;
      r = n;
    }
    return r.trim();
  };
  // Una frase que afirma haberlo hecho se quita entera; de las demás, el acuse del principio.
  return frases
    .filter((f) => !RE_AFIRMA_HECHO.test(f))
    .map(sinAcuse)
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Cuánto dice un requisito: un nombre (3) más que un tipo (2), un tipo más que «un archivo» (1). */
const especificidad = (r: Requisito) => (r.nombre ? 3 : r.extensiones.length ? 2 + 1 / (1 + r.extensiones.length) : r.claves?.length ? 1.5 : 1);

/**
 * La misma cosa pedida dicha de dos maneras, con lo MÁS específico de las dos (nunca se pierde un nombre, una
 * extensión, una carpeta ni una duda). null si se contradicen: otro nombre, otro tipo, otra carpeta.
 */
function fundir(x: Requisito, y: Requisito): Requisito | null {
  const carpetas = [x.carpeta, y.carpeta].filter(Boolean);
  if (carpetas.length === 2 && carpetas[0] !== carpetas[1]) return null;
  const comun = { carpeta: x.carpeta || y.carpeta, dudoso: x.dudoso || y.dudoso, cantidadSegura: x.cantidadSegura && y.cantidadSegura };
  const limpiar = (r: Requisito): Requisito => {
    const o = { ...r };
    if (!o.carpeta) delete o.carpeta;
    if (!o.dudoso) delete o.dudoso;
    return o;
  };
  if (x.nombre && y.nombre) {
    if (x.nombre.toLowerCase() !== y.nombre.toLowerCase()) return null;
    if (x.ruta && y.ruta && x.ruta.toLowerCase() !== y.ruta.toLowerCase()) return null;
    return limpiar({ ...(x.ruta ? x : y), ...comun });
  }
  const nombrado = x.nombre ? x : y.nombre ? y : null;
  if (nombrado) {
    const otro = nombrado === x ? y : x;
    if (otro.extensiones.length && !otro.extensiones.includes(nombrado.extensiones[0])) return null;
    return limpiar({ ...nombrado, ...comun });
  }
  if (x.extensiones.length && y.extensiones.length) {
    const inter = x.extensiones.filter((e) => y.extensiones.includes(e));
    if (!inter.length) return null;
    const base = x.extensiones.length <= y.extensiones.length ? x : y;
    const r = limpiar({ ...base, ...comun, extensiones: inter });
    delete r.libre;
    return r;
  }
  const tipado = x.extensiones.length ? x : y.extensiones.length ? y : x.claves?.length ? x : y.claves?.length ? y : x;
  const r = limpiar({ ...tipado, ...comun });
  if (!(x.libre && y.libre)) delete r.libre;
  return r;
}

/**
 * Uno a uno: cada requisito de una fuente con su par en la otra, quedándose con lo más específico. La cantidad es la
 * mayor (lo que sobra de una fuente se suma). Si a los dos les sobran cosas que no casan, se contradicen.
 */
function combinarUnoAUno(a: Requisito[], b: Requisito[]): { items: Requisito[]; contradiccion: boolean } {
  const libres = [...b];
  const items: Requisito[] = [];
  const sinPar: Requisito[] = [];
  for (const x of [...a].sort((p, q) => especificidad(q) - especificidad(p))) {
    let mejor = -1;
    let fusion: Requisito | null = null;
    libres.forEach((y, i) => {
      const f = fundir(x, y);
      if (f && (mejor < 0 || especificidad(y) > especificidad(libres[mejor]))) {
        mejor = i;
        fusion = f;
      }
    });
    if (mejor >= 0 && fusion) {
      items.push(fusion);
      libres.splice(mejor, 1);
    } else sinPar.push(x);
  }
  return { items: [...items, ...sinPar, ...libres], contradiccion: sinPar.length > 0 && libres.length > 0 };
}

/**
 * Los requisitos de lo que pidió la PERSONA y de lo que el modelo le encargó a la computadora (que puede parafrasear
 * «tres capturas» como «una captura»). Si uno contiene al otro, gana el más exigente; si se contradicen («un PDF» y «un
 * Word»), `seguro: false`. Los orígenes de los dos cuentan. Se calcula UNA vez, al crear la misión.
 */
export function requisitosCombinados(instruccion: string, pedidoPersona?: string | null): PedidoEntrega {
  const a = requisitosDeEntrega(instruccion);
  if (!pedidoPersona || !String(pedidoPersona).trim()) return a;
  const b = requisitosDeEntrega(String(pedidoPersona));
  const persona = { pedidoPersona: String(pedidoPersona).slice(0, 2000) };
  const origenes = { nombres: [...new Set([...a.origenes.nombres, ...b.origenes.nombres])], sinNombre: [...a.origenes.sinNombre, ...b.origenes.sinNombre] };
  if (!b.explicitos) return { ...a, origenes, ...persona };
  if (!a.explicitos) return { ...b, origenes, ...persona };
  // Uno a uno, con lo más específico de cada par (R5 de la cuarta ronda: antes se elegía una lista entera).
  const { items, contradiccion } = combinarUnoAUno(a.items, b.items);
  const tope = items.slice(0, 10).map((x, i) => ({ ...x, id: `entrega-${i + 1}` }));
  return { items: tope, seguro: a.seguro && b.seguro && !contradiccion && items.length <= 10, explicitos: tope.length, origenes, ...persona };
}

/** ¿Lo único que se pidió producir es texto que va en la respuesta? (con lo que pidió la persona, si se sabe). */
export function esTextoEnChat(instruccion: string, pedido?: PedidoEntrega | null): boolean {
  const a = requisitosDeEntrega(instruccion);
  if (pedido && (pedido.explicitos > 0 || pedido.items.some((i) => i.inverificable))) return false;
  return !!a.textoEnChat && (!pedido || pedido.explicitos === 0);
}

/**
 * La única acción sobre archivos que se puede comprobar, y estrictamente: «copia contrato.pdf a la carpeta jose». El
 * original (nombrado) existe con su huella, y en la carpeta pedida hay un archivo con su mismo nombre, en otra ruta y con
 * la MISMA sha256. Cualquier otra cosa: null («sin comprobar»).
 */
export function comprobarCopia(instruccion: string, lista: ArchivoNodo[]): { destino: ArchivoNodo; detalle: string } | null {
  const sinWeb = sinUrls(String(instruccion || ''));
  const p = plegar(sinWeb);
  const palabras = plegar(sinNombresDe(sinWeb)).match(/[a-zñ]+/g) || [];
  void p;
  if (!palabras.some((w, i) => /^(copia|copialo|copiala|copiar|copy)$/.test(w) && !ARTICULOS.has(palabras[i - 1] || ''))) return null;
  if (palabras.some((w, i) => RE_V_OPERACION.test(w) && !/^(copia|copialo|copiala|copiar|copy)$/.test(w) && !ARTICULOS.has(palabras[i - 1] || ''))) return null;
  const nombres = nombresEn(sinWeb).map((m) => m.nombre.toLowerCase());
  const carpetas = [...plegar(sinNombresDe(sinWeb)).matchAll(RE_CARPETA_DICHA)].map((m) => normalizarCarpeta(cortarCarpeta(m[1] || m[2] || m[3] || '').carpeta)).filter(Boolean);
  if (nombres.length !== 1 || carpetas.length !== 1) return null;
  const [nombre] = nombres;
  const [carpeta] = carpetas;
  const sanos = lista.filter((a) => a && a.existe === true && !a.fuera && typeof a.sha256 === 'string' && /^[0-9a-f]{64}$/.test(a.sha256) && a.bytes > 0 && rutaValida(a.ruta) && nombreDeRuta(a.ruta).toLowerCase() === nombre);
  const destinos = sanos.filter((a) => enCarpeta(a.ruta, carpeta));
  const originales = sanos.filter((a) => !enCarpeta(a.ruta, carpeta));
  for (const d of destinos) {
    const o = originales.find((x) => x.sha256 === d.sha256 && x.ruta !== d.ruta);
    if (o) return { destino: d, detalle: `${nombreDeRuta(d.ruta)} está en ${carpeta} con la misma huella que el original (sha256 ${String(d.sha256).slice(0, 12)}…)` };
  }
  return null;
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
  // Entero, no solo la cabecera (ronda 6): un PDF de 9 bytes con «%PDF-» o un docx sin directorio central no cumplen.
  if (a.integro === false) return { estado: 'not_met', motivo: `${n} está incompleto o dañado (${limpio(a.defecto || 'no pasó la revisión', 80)})` };
  if (a.integro !== true) return { estado: 'unknown', motivo: `${n}: tu computadora no comprobó que esté entero` };
  // Ronda 9 (G4): «íntegro» solo de un validador que conocemos; el de un nodo viejo aceptaba archivos sin contenido.
  if (!(typeof a.integro_v === 'number' && Number.isFinite(a.integro_v) && a.integro_v >= VALIDADOR_MIN))
    return { estado: 'unknown', motivo: `${n}: lo revisó un validador viejo de tu computadora (versión ${typeof a.integro_v === 'number' ? a.integro_v : 'sin marca'}; hace falta la ${VALIDADOR_MIN}), así que no sé si tiene contenido de verdad` };
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
export function compararEntrega(instruccion: string, lista: ArchivoNodo[] | null, pedido?: PedidoEntrega | null): { items: ItemEntrega[]; seguro: boolean; sobran: ArchivoNodo[] } {
  const { items: reqs, seguro, origenes } = pedido || requisitosDeEntrega(instruccion);
  if (!lista) {
    return {
      items: reqs.map((r) => ({ id: r.id, etiqueta: r.etiqueta, estado: 'unknown', detalle: `${r.etiqueta}: sin comprobar (tu computadora no revisó sus archivos al terminar)`, origen: r.origen })),
      seguro,
      sobran: [],
    };
  }
  const usados = new Set<ArchivoNodo>();
  const claves = clavesDe(instruccion);
  const identifica = (a: ArchivoNodo, propias?: string[]) => (propias?.length ? propias : claves).some((k) => plegar(nombreDeRuta(a.ruta)).includes(k));
  // Lo que la instrucción nombra como ORIGEN («convierte datos.csv») no es una afirmación de tu computadora ni algo que sobre.
  const nombradosEnInstruccion = new Set(nombresEn(sinUrls(String(instruccion || ''))).map((m) => m.nombre.toLowerCase()));
  // «el informe final.pdf»: si existe «informe final.pdf», el «final.pdf» que no está no es una afirmación falsa.
  const cortosResueltos = new Set(
    reqs.filter((r) => r.alternativa && lista.some((a) => a.existe === true && nombreDeRuta(a.ruta).toLowerCase() === r.alternativa!.toLowerCase())).map((r) => r.nombre!.toLowerCase())
  );
  const items: ItemEntrega[] = [];
  // R3: lo que la instrucción usa como origen (y sus copias: «ventas (1).xlsx») nunca cumple un requisito.
  const tallo = (n: string) =>
    n
      .toLowerCase()
      .replace(/\.[a-z0-9]{1,5}$/, '')
      .replace(/(\s*\(\d+\)|\s*\((copia|copy)\)|[-_ ](copia|copy)|[-_ ]\d+)$/, '')
      .trim();
  const origenesN = (origenes?.nombres || []).map((n) => ({ n, tallo: tallo(n), ext: extDe(n) }));
  const esOrigen = (a: ArchivoNodo) => {
    const n = nombreDeRuta(a.ruta).toLowerCase();
    return origenesN.some((o) => o.n === n || (o.tallo === tallo(n) && o.ext === extDe(n)));
  };
  // R4: un mismo contenido (sha256) cumple a lo más una cosa pedida.
  const shas = new Map<string, string>();
  const conVeredicto = (a: ArchivoNodo, exts: string[], carpeta?: string) => {
    const otro = a.existe === true && typeof a.sha256 === 'string' ? shas.get(a.sha256) : undefined;
    if (otro) return { a, v: { estado: 'not_met' as const, motivo: `${nombreDeRuta(a.ruta)} es una copia idéntica de ${otro} (el mismo contenido cuenta una vez)` } };
    const v = veredictoArchivo(a, exts);
    // La carpeta que dijo con palabras también se comprueba.
    if (v.estado === 'verified' && carpeta && !enCarpeta(a.ruta, carpeta)) {
      const padre = String(a.ruta).split('/').slice(-2, -1)[0] || '/';
      return { a, v: { estado: 'not_met' as const, motivo: `${nombreDeRuta(a.ruta)} quedó en «${limpio(padre, 60)}», no en la carpeta ${carpeta}` } };
    }
    return { a, v };
  };
  const mejor = (xs: { a: ArchivoNodo; v: Veredicto }[]) => xs.sort((x, y) => ORDEN[x.v.estado] - ORDEN[y.v.estado] || Number(identifica(y.a)) - Number(identifica(x.a)))[0];
  const cerrarItem = (r: Requisito, elegido: { a: ArchivoNodo; v: Veredicto } | undefined, sinArchivo: string): ItemEntrega => {
    if (!elegido) return { id: r.id, etiqueta: r.etiqueta, estado: 'not_met', detalle: sinArchivo, origen: r.origen };
    usados.add(elegido.a);
    const { a, v } = elegido;
    if (v.estado === 'verified' && a.sha256) shas.set(a.sha256, nombreDeRuta(a.ruta));
    // R3: algo sin nombre que se bajó o se abrió puede ser este mismo archivo: no se distingue de lo creado.
    if (v.estado === 'verified' && r.dudoso)
      return { id: r.id, etiqueta: r.etiqueta, estado: 'unknown', detalle: `encontré ${nombreDeRuta(a.ruta)}, pero no puedo distinguir lo que creó de lo que bajó o abrió (${r.dudoso})`, origen: r.origen, archivo: a };
    return { id: r.id, etiqueta: r.etiqueta, estado: v.estado, detalle: v.estado === 'verified' ? detalleComprobado(a) : v.motivo, origen: r.origen, archivo: a };
  };

  // 1) Lo que tiene nombre: solo un archivo que se llame así (y en la carpeta que dijo). Primero lo que dijo con carpeta:
  // el mismo nombre en dos carpetas son dos entregables, y el de una carpeta no cumple el de la otra.
  const enRuta = (a: ArchivoNodo, ruta: string) => {
    if (a.ruta === ruta) return true;
    if (ruta.startsWith('/') || a.existe !== true) return false;
    const rel = `/${ruta.replace(/^~\//, '').replace(/^\.\//, '')}`.toLowerCase();
    return a.ruta.toLowerCase().endsWith(rel);
  };
  const conNombre = reqs.filter((x) => x.nombre);
  for (const r of [...conNombre.filter((x) => x.ruta), ...conNombre.filter((x) => !x.ruta)]) {
    // «el informe final.pdf»: el nombre completo, si está, es ese; si solo está «final.pdf», no se sabe.
    if (r.alternativa) {
      const largo = lista.filter((a) => !usados.has(a) && !esOrigen(a) && nombreDeRuta(a.ruta).toLowerCase() === r.alternativa!.toLowerCase());
      if (largo.length) {
        items.push(cerrarItem({ ...r, etiqueta: r.alternativa }, mejor(largo.map((a) => conVeredicto(a, r.extensiones, r.carpeta))), `falta ${r.alternativa}`));
        continue;
      }
      const corto = lista.filter((a) => !usados.has(a) && !esOrigen(a) && a.existe === true && nombreDeRuta(a.ruta).toLowerCase() === r.nombre!.toLowerCase());
      items.push({
        id: r.id,
        etiqueta: r.etiqueta,
        estado: corto.length ? 'unknown' : 'not_met',
        detalle: corto.length ? `encontré ${r.nombre}, pero no sé si pediste «${r.alternativa}» o «${r.nombre}» (ponlo entre comillas)` : `falta ${r.alternativa} (o ${r.nombre})`,
        origen: r.origen,
      });
      corto.slice(0, 1).forEach((a) => usados.add(a));
      continue;
    }
    const otras = conNombre.filter((x) => x !== r && x.ruta && x.nombre!.toLowerCase() === r.nombre!.toLowerCase());
    const mismo = lista.filter(
      (a) =>
        !usados.has(a) &&
        !esOrigen(a) &&
        nombreDeRuta(a.ruta).toLowerCase() === r.nombre!.toLowerCase() &&
        !otras.some((x) => enRuta(a, x.ruta!)) &&
        // Lo que el nodo no encontró, con su carpeta: es de la cosa pedida con ESA carpeta.
        (a.existe === true || !a.ruta.includes('/') || !r.ruta || a.ruta === r.ruta)
    );
    let cand = mismo.map((a) => conVeredicto(a, r.extensiones, r.carpeta));
    if (r.ruta && cand.length) {
      const enLaCarpeta = cand.filter((c) => enRuta(c.a, r.ruta!) || c.a.existe !== true);
      const otra = cand.find((c) => c.v.estado === 'verified' && !enRuta(c.a, r.ruta!));
      if (!enLaCarpeta.some((c) => c.v.estado === 'verified') && otra) {
        // Solo para decir por qué: ese archivo no se gasta (puede ser de otra cosa pedida).
        items.push({ id: r.id, etiqueta: r.etiqueta, estado: 'not_met', detalle: `${r.nombre} quedó en otra carpeta (${limpio(otra.a.ruta, 120)}), no en ${r.ruta}`, origen: r.origen });
        continue;
      }
      cand = enLaCarpeta;
    }
    items.push(cerrarItem(r, mejor(cand), `falta ${r.etiqueta}`));
  }
  // 2) Lo que solo tiene tipo («3 PDFs»): un archivo de ese tipo, cada uno distinto; nunca basura que no se nombró.
  for (const r of reqs.filter((x) => !x.nombre && x.extensiones.length)) {
    const cand = lista.filter((a) => !usados.has(a) && !esOrigen(a) && a.existe === true && !RE_BASURA.test(a.ruta) && r.extensiones.includes(extDe(nombreDeRuta(a.ruta)))).map((a) => conVeredicto(a, r.extensiones, r.carpeta));
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
  // «Tres archivos» (libre): cualquier archivo nuevo y sano cumple uno; van al final para no quitarle a lo identificado.
  for (const r of reqs.filter((x) => x.inverificable)) {
    items.push({ id: r.id, etiqueta: r.etiqueta, estado: 'unknown', detalle: `${r.etiqueta}: no sé comprobar esto desde aquí (no tiene un tipo de archivo que pueda revisar)`, origen: r.origen });
  }
  const genericos = reqs.filter((x) => !x.nombre && !x.extensiones.length && !x.inverificable);
  for (const r of [...genericos.filter((x) => !x.libre), ...genericos.filter((x) => x.libre)]) {
    const cand = lista.filter((a) => !usados.has(a) && !esOrigen(a) && a.existe === true && !RE_BASURA.test(a.ruta)).map((a) => conVeredicto(a, [], r.carpeta));
    const buenos = cand.filter((c) => c.v.estado === 'verified');
    if (!r.cantidadSegura) {
      // «Guarda los archivos»: sin decir cuántos ni de qué tipo, nada lo puede comprobar.
      buenos.forEach((c) => usados.add(c.a));
      items.push({ id: r.id, etiqueta: r.etiqueta, estado: buenos.length ? 'unknown' : 'not_met', detalle: buenos.length ? `encontré ${enLista(buenos.slice(0, 4).map((c) => nombreDeRuta(c.a.ruta)))}, pero no dijiste cuántos: no puedo comprobar que estén todos` : 'no encontré ningún archivo nuevo en su carpeta de trabajo', origen: r.origen });
      continue;
    }
    const suyo = buenos.find((c) => identifica(c.a, r.claves)) || (r.libre ? buenos[0] : undefined);
    if (suyo) {
      items.push(cerrarItem(r, suyo, ''));
      continue;
    }
    if (buenos.length) {
      // Se miró uno para decir por qué, y se aparta: el mismo archivo no explica dos cosas.
      usados.add(buenos[0].a);
      items.push({ id: r.id, etiqueta: r.etiqueta, estado: 'unknown', detalle: `encontré ${nombreDeRuta(buenos[0].a.ruta)}, pero no puedo saber si es ${r.claves?.length ? r.etiqueta : 'lo que pediste'}`, origen: r.origen });
      continue;
    }
    items.push(cerrarItem(r, mejor(cand), r.claves?.length || r.libre ? `falta ${r.etiqueta}` : 'no encontré ningún archivo nuevo en su carpeta de trabajo'));
  }
  // 4) R1: lo que se nombró (tu computadora dijo que lo dejó, o la instrucción lo usa) y no está, o cae fuera, es un
  // criterio no cumplido: nunca se completa con un archivo mencionado que no existe.
  const nombresPedidos = new Set(reqs.filter((x) => x.nombre).map((x) => x.nombre!.toLowerCase()));
  const yaVistos = new Set([...usados].map((a) => nombreDeRuta(a.ruta).toLowerCase()));
  let k = reqs.length;
  for (const a of lista) {
    const n = nombreDeRuta(a.ruta);
    if (!a.mencionado || (a.existe === true && !a.fuera) || usados.has(a) || cortosResueltos.has(n.toLowerCase())) continue;
    if (yaVistos.has(n.toLowerCase()) || (nombresPedidos.has(n.toLowerCase()) && items.some((i) => i.archivo === a))) continue;
    if (items.length >= 14) break;
    yaVistos.add(n.toLowerCase());
    usados.add(a);
    const deLaInstruccion = nombradosEnInstruccion.has(n.toLowerCase());
    items.push({
      id: `entrega-${++k}`,
      etiqueta: deLaInstruccion ? `${n} (lo nombraste)` : `${n} (tu computadora dijo que lo dejó)`,
      estado: 'not_met',
      detalle: deLaInstruccion ? `${n} no está en su carpeta de trabajo${a.fuera ? ' (está fuera)' : ''}` : a.fuera ? `dijo que dejó ${n}, pero está fuera de su carpeta de trabajo` : `dijo que dejó ${n}, pero no está`,
      origen: 'respuesta',
      archivo: a,
    });
  }
  const sobran = lista.filter((a) => !usados.has(a) && !esOrigen(a) && a.existe === true && a.reciente !== false && !nombradosEnInstruccion.has(nombreDeRuta(a.ruta).toLowerCase()));
  // En el orden en que se pidió (lo que dijo tu computadora, al final).
  const orden = new Map(reqs.map((r, i) => [r.id, i]));
  items.sort((x, y) => (orden.get(x.id) ?? 99) - (orden.get(y.id) ?? 99));
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
