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
  origen: 'pedido' | 'respuesta';  /** Lo que tiene que decir su nombre para ser ESTE («enero» de «las facturas de enero, febrero y marzo»). */
  claves?: string[];
  /** Pidió «tres archivos» sin más: cualquier archivo nuevo y sano cumple uno (sin registros ni temporales, sin repetir). */
  libre?: boolean;
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

/* ---- el papel de algo en la oración: lo que se entrega, de dónde sale, o nada claro ---- */

/** Dejar algo: crear, guardar, descargar, exportar… */
const RE_V_ENTREGA = /^(crea\w*|crear\w*|haz|hazme|hacer|hagas|escrib\w*|genera\w*|arma\w*|prepara\w*|redacta\w*|guard\w*|descarg\w*|baja|bajame|bajate|bajar\w*|export\w*|saca\w*|toma\w*|make|create|write|generate|draft|save|download|export|take)$/;
/** Pedirlo sin verbo de hacer: «necesito tres PDFs», «dame los dos documentos». */
const RE_V_NECESIDAD = /^(necesito|necesitamos|necesita|ocupo|ocupamos|quiero|queremos|dame|deme|damelos|damelas|dámelos|consigue\w*|consiguen|need|want)$/;
/** De dónde sale lo que se usa: leer, abrir, revisar, usar, buscar… («lee informe.pdf», «busca fotos»). */
const RE_V_ORIGEN = /^(lee|leer|leyendo|lea|leelo|leela|abre|abrir|abriendo|revisa\w*|usa|usar|usando|utiliza\w*|mira|mirar|analiza\w*|compara\w*|basad[oa]s?|busca\w*|encuentra\w*|read|reading|open|use|using|review|analyze|compare|based|search|find)$/;
/** Convertir o resumir: su objeto es el ORIGEN; el destino va después de «a», «en», «como» («convierte datos.csv a PDF», «resume reporte.pdf en un Word»). */
const RE_V_CONVERTIR = /^(conviert\w*|convertir\w*|transforma\w*|pasa|pasalo|pasala|pasar|resume|resumir|resumelo|resumela|resumiendo|convert\w*|transform\w*|summarize)$/;
const RE_DESTINO_ANTES = /\b(?:a|al|en|como|to|into|as)\s+(?:(?:un|una|el|la|the|a|an)\s+)?$/;
/** «guárdalo como PDF», «expórtala a Word», «save it as PDF»: el formato de lo mismo, no otra cosa. */
const RE_REFORMATO_ANTES = /\b([a-zñ]+?(?:lo|la|los|las))\s+(?:como|a|al|en)\s+(?:(?:un|una)\s+)?$|\b(save|export|convert)\s+(?:it|them)\s+(?:as|to|into)\s+(?:(?:a|an)\s+)?$/;
const RE_FIN_ORACION = /[.;!?\n]/;

type Papel = 'entrega' | 'origen' | 'ninguno';

/** El verbo más cercano ANTES (en la misma oración) y el papel que le da a lo que viene: lo que va antes es `antes`. */
function verboYPapel(antes: string): { verbo: string | null; papel: Papel } {
  const ini = Math.max(...[...antes.matchAll(new RegExp(RE_FIN_ORACION, 'g'))].map((m) => (m.index ?? 0) + 1), 0);
  const oracion = antes.slice(ini);
  const palabras = oracion.match(/[a-zñ]+/g) || [];
  for (let i = palabras.length - 1; i >= 0; i--) {
    const w = palabras[i];
    if (RE_V_ENTREGA.test(w) || RE_V_NECESIDAD.test(w)) return { verbo: w, papel: 'entrega' };
    if (RE_V_ORIGEN.test(w)) return { verbo: w, papel: 'origen' };
    if (RE_V_CONVERTIR.test(w)) return { verbo: w, papel: RE_DESTINO_ANTES.test(antes.trimEnd() + ' ') ? 'entrega' : 'origen' };
  }
  return { verbo: null, papel: 'ninguno' };
}
const papelEn = (antes: string): Papel => verboYPapel(antes).papel;
/** «create a file»: la «a» después de un verbo en inglés es el artículo, no «a la carpeta». */
const esArticuloIngles = (previo: string) => /\b(make|create|write|generate|draft|save|download|export|take)\s+an?\s+$/.test(previo);
/** Bajar o guardar algo (no «haz las cuentas»): solo entonces un plural de otra cosa son archivos. */
const RE_V_BAJAR = /^(guard|descarg|baj|export|download|save)/;

const hayVerboDeEntrega = (texto: string) => (texto.match(/[a-zñ]+/g) || []).some((w) => RE_V_ENTREGA.test(w) || RE_V_NECESIDAD.test(w) || RE_V_CONVERTIR.test(w));
/** La respuesta dice que dejó archivos («descargué las facturas», «guardé los PDFs»). */
const RE_DICE_DEJO = /\b(guarde|guardado|guardados|guardadas|descargue|descargado|descargados|descargadas|exporte|exportado|cree|creado|creados|genere|generado|saved|downloaded|exported|created)\b/;
const raizDe = (w: string) => w.replace(/(es|s)$/, '');

/**
 * Los requisitos de lo que se pidió dejar. «Crea tres documentos: informe.docx, presupuesto.xlsx y carta.pdf» → tres
 * con nombre y tipo; «guarda 3 PDFs» → tres PDFs; «un Word y dos PDFs» → tres; «descarga las facturas de enero,
 * febrero y marzo» → tres (una por mes). Lo que se usa («lee informe.pdf», «convierte datos.csv», «de ventas.xlsx») no
 * se entrega. «Guárdalo como PDF» es el formato del mismo entregable. El mismo nombre en dos carpetas son dos.
 * `seguro: false` si no se puede saber cuántos (un plural sin número ni enumeración). `explicitos`: cuántos salen de lo
 * que dijo (sin el «el archivo que pediste» de cuando no dijo nada): con alguno, la misión es de archivos.
 */
export function requisitosDeEntrega(instruccion: string, respuesta?: string | null): { items: Requisito[]; seguro: boolean; explicitos: number } {
  const sinWeb = sinUrls(String(instruccion || ''));
  const p = plegar(sinWeb);
  const verboEnAlguna = hayVerboDeEntrega(p);
  const dijoQueDejo = RE_DICE_DEJO.test(plegar(sinUrls(String(respuesta || ''))));
  let seguro = true;

  // 1) Los nombres que se entregan (no los de origen), sin repetir la MISMA ruta; el mismo nombre en otra carpeta es otro.
  type Nombre = { nombre: string; ruta?: string; pos: number };
  const vistos: Nombre[] = [];
  for (const m of sinWeb.matchAll(RE_NOMBRE)) {
    const pos = m.index ?? 0;
    const ruta = m[1];
    const antes = plegar(sinWeb.slice(0, pos));
    const papel = papelEn(antes);
    if (papel === 'origen' || RE_ORIGEN_ANTES.test(antes.trimEnd() + ' ')) continue;
    if (papel === 'ninguno' && !verboEnAlguna) continue;
    vistos.push({ nombre: nombreDeRuta(ruta), ...(ruta.includes('/') ? { ruta } : {}), pos });
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

  // 2) Las frases de tipo con su cantidad («tres documentos», «3 PDFs», «una hoja de cálculo», «como PDF»).
  type Frase = { fam: Familia; cantidad: number | null; pos: number; otro: boolean; absorbio: number };
  const frases: Frase[] = [];
  const sinNombres = p.replace(RE_NOMBRE, (x) => ' '.repeat(x.length)); // «informe.docx» no es la frase «docx»
  const reformatos: { fam: Familia; pos: number }[] = [];
  for (const m of sinNombres.matchAll(RE_FRASE)) {
    const pos = m.index ?? 0;
    const det = m[1] || '';
    const sustantivo = m[2];
    const fam = FAMILIAS.find((f) => new RegExp(`^(?:${f.re})$`).test(sustantivo));
    if (!fam) continue;
    const previo = sinNombres.slice(0, pos).trimEnd() + ' ';
    // «del PDF», «la carpeta PDFs»: de dónde sale o dónde va. «en Documentos»: la carpeta. «a CSV», «en Word»: el formato.
    if (RE_ORIGEN_ANTES.test(previo) || (FAMILIAS_CARPETA.has(fam.clave) && RE_LUGAR_ANTES.test(previo) && !esArticuloIngles(previo))) continue;
    const plural = /^(?:\w+?)(?:s|es)\b/.test(sustantivo.split(/\s+/)[0]) && !/^(?:xlsx|docx|pptx)$/.test(sustantivo);
    let cantidad: number | null;
    if (/^\d+$/.test(det)) cantidad = Math.min(50, Number(det));
    else if (det in CANTIDADES && CANTIDADES[det] > 0) cantidad = CANTIDADES[det];
    else cantidad = plural ? null : 1;
    const numero = /^\d+$/.test(det) || (det in CANTIDADES && CANTIDADES[det] > 1);
    const papel = papelEn(sinNombres.slice(0, pos));
    if (papel === 'origen') continue;
    // Sin verbo en su oración, cuenta si dijo cuántos y en algún lado pide dejarlos («Tres PDFs. Guárdalos.») o la
    // respuesta dice que los dejó: el número pedido manda.
    if (papel === 'ninguno' && !(numero && (verboEnAlguna || dijoQueDejo))) continue;
    if (RE_REFORMATO_ANTES.test(previo)) {
      reformatos.push({ fam, pos });
      continue;
    }
    frases.push({ fam, cantidad, pos, otro: /^(otro|otra|another)$/.test(det), absorbio: 0 });
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
    extra.push({ fam: r.fam, cantidad: 1, pos: r.pos, otro: true, absorbio: 0 });
  }
  frases.push(...extra);
  frases.sort((a, b) => a.pos - b.pos);

  const items: Requisito[] = [];
  const repetido = (n: Nombre) => nombres.filter((x) => x.nombre.toLowerCase() === n.nombre.toLowerCase()).length > 1;
  // Cada nombre es suyo; si viene después de una frase del mismo tipo que aún tiene sitio, es una de esas cosas.
  for (const n of nombres) {
    const ext = extDe(n.nombre);
    const f = [...frases].reverse().find((x) => !x.otro && x.pos < n.pos && (x.fam.ext.length === 0 || x.fam.ext.includes(ext)) && (x.cantidad === null || x.absorbio < x.cantidad));
    if (f) f.absorbio++;
    items.push({ id: '', etiqueta: n.ruta && repetido(n) ? n.ruta : n.nombre, nombre: n.nombre, ...(n.ruta ? { ruta: n.ruta } : {}), extensiones: [ext], clase: claseDeExt(ext), cantidadSegura: true, origen: 'pedido' });
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
      items.push({ id: '', etiqueta: resto > 1 ? `${f.fam.claseN} n.º ${k}` : f.fam.clase, extensiones: f.fam.ext, clase: f.fam.clase, cantidadSegura: true, origen: 'pedido', ...(f.fam.ext.length ? {} : { libre: true }) });
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
  const explicitos = items.length;
  if (!items.length) items.push({ id: '', etiqueta: 'el archivo que pediste', extensiones: [], clase: 'un archivo', cantidadSegura: true, origen: 'pedido' });
  const TOPE = 10;
  if (items.length > TOPE) seguro = false;
  return { items: items.slice(0, TOPE).map((x, i) => ({ ...x, id: `entrega-${i + 1}` })), seguro, explicitos };
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
export function compararEntrega(instruccion: string, lista: ArchivoNodo[] | null, respuesta?: string | null): { items: ItemEntrega[]; seguro: boolean; sobran: ArchivoNodo[] } {
  const { items: reqs, seguro } = requisitosDeEntrega(instruccion, respuesta);
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
  const nombradosEnInstruccion = new Set([...sinUrls(String(instruccion || '')).matchAll(RE_NOMBRE)].map((m) => nombreDeRuta(m[1]).toLowerCase()));
  const items: ItemEntrega[] = [];
  const conVeredicto = (a: ArchivoNodo, exts: string[]) => ({ a, v: veredictoArchivo(a, exts) });
  const mejor = (xs: { a: ArchivoNodo; v: Veredicto }[]) => xs.sort((x, y) => ORDEN[x.v.estado] - ORDEN[y.v.estado] || Number(identifica(y.a)) - Number(identifica(x.a)))[0];
  const cerrarItem = (r: Requisito, elegido: { a: ArchivoNodo; v: Veredicto } | undefined, sinArchivo: string): ItemEntrega => {
    if (!elegido) return { id: r.id, etiqueta: r.etiqueta, estado: 'not_met', detalle: sinArchivo, origen: r.origen };
    usados.add(elegido.a);
    const { a, v } = elegido;
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
    const otras = conNombre.filter((x) => x !== r && x.ruta && x.nombre!.toLowerCase() === r.nombre!.toLowerCase());
    const mismo = lista.filter(
      (a) =>
        !usados.has(a) &&
        nombreDeRuta(a.ruta).toLowerCase() === r.nombre!.toLowerCase() &&
        !otras.some((x) => enRuta(a, x.ruta!)) &&
        // Lo que el nodo no encontró, con su carpeta: es de la cosa pedida con ESA carpeta.
        (a.existe === true || !a.ruta.includes('/') || !r.ruta || a.ruta === r.ruta)
    );
    let cand = mismo.map((a) => conVeredicto(a, r.extensiones));
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
  // «Tres archivos» (libre): cualquier archivo nuevo y sano cumple uno; van al final para no quitarle a lo identificado.
  const genericos = reqs.filter((x) => !x.nombre && !x.extensiones.length);
  for (const r of [...genericos.filter((x) => !x.libre), ...genericos.filter((x) => x.libre)]) {
    const cand = lista.filter((a) => !usados.has(a) && a.existe === true && !RE_BASURA.test(a.ruta)).map((a) => conVeredicto(a, []));
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
  // 4) Lo que tu computadora dijo que dejó y el nodo no encontró (o cae fuera): una afirmación falsa también cuenta.
  const nombresPedidos = new Set(reqs.filter((x) => x.nombre).map((x) => x.nombre!.toLowerCase()));
  const yaVistos = new Set([...usados].map((a) => nombreDeRuta(a.ruta).toLowerCase()));
  let k = reqs.length;
  for (const a of lista) {
    const n = nombreDeRuta(a.ruta);
    if (!a.mencionado || (a.existe === true && !a.fuera) || nombresPedidos.has(n.toLowerCase()) || nombradosEnInstruccion.has(n.toLowerCase()) || yaVistos.has(n.toLowerCase()) || usados.has(a)) continue;
    if (items.length >= 12) break;
    yaVistos.add(n.toLowerCase());
    usados.add(a);
    items.push({ id: `entrega-${++k}`, etiqueta: `${n} (tu computadora dijo que lo dejó)`, estado: 'not_met', detalle: a.fuera ? `dijo que dejó ${n}, pero está fuera de su carpeta de trabajo` : `dijo que dejó ${n}, pero no está`, origen: 'respuesta', archivo: a });
  }
  const sobran = lista.filter((a) => !usados.has(a) && a.existe === true && a.reciente !== false && !nombradosEnInstruccion.has(nombreDeRuta(a.ruta).toLowerCase()));
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
