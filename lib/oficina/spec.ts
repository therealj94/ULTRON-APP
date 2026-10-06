/**
 * ARCHIVOS DE OFICINA: LA ESPECIFICACIÓN TIPADA (FILE-01, auditoría maestra del 6-oct §8).
 *
 * Dos ensayos de «informe.docx, presupuesto.xlsx y carta.pdf» con el ratón sobre LibreOffice (nodo Holo) llegaron a 31
 * pasos y unos 300 s sin dejar un solo archivo. Aquí va la otra ruta, API antes que ratón:
 *
 *   petición → ESPECIFICACIÓN (el modelo llena este esquema en JSON) → generación → validación estructural →
 *   validación semántica (contenido, totales) → render opcional → entrega con recibo.
 *
 * Este módulo es la primera pieza y es PURO (sin disco, sin red): valida y normaliza lo que mandó el modelo, sanea el
 * nombre de cada archivo y calcula los totales del presupuesto EN CÓDIGO (ExcelJS escribe fórmulas, no las calcula).
 * Lo que no cabe en el esquema se rechaza con el porqué, para que el modelo lo corrija; nunca se inventa un relleno.
 * Cuatro tipos: Word y PDF (secciones o carta), Excel (presupuesto) y PowerPoint (diapositivas con tipo: portada,
 * viñetas, dos columnas, tabla, cifras, gráfico, cita y cierre; con topes de lo que se lee en una diapositiva).
 */

export const TIPOS_ARCHIVO = ['docx', 'xlsx', 'pdf', 'pptx'] as const;
export type TipoArchivo = (typeof TIPOS_ARCHIVO)[number];

export const MIME: Record<TipoArchivo, string> = {
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pdf: 'application/pdf',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
};

/** Cómo se nombra cada tipo para la persona. */
export const CLASE: Record<TipoArchivo, string> = { docx: 'documento de Word', xlsx: 'hoja de Excel', pdf: 'PDF', pptx: 'presentación de PowerPoint' };

/** Topes: un pedido normal cabe holgado; uno desbocado (o malicioso) no llena el disco ni el turno. */
export const TOPES = {
  archivos: 5,
  titulo: 200,
  parrafo: 4000,
  secciones: 60,
  parrafosTotal: 400,
  vinetas: 60,
  columnas: 12,
  filas: 300,
  celda: 500,
  partidas: 500,
  notas: 20,
  /** Bytes de un archivo generado. Más que esto no se entrega. */
  bytes: 8 * 1024 * 1024,
} as const;

/* ------------------------------------------------------------------ la forma */

export type Tabla = { cabecera: string[]; filas: string[][] };
export type Seccion = { titulo?: string; parrafos: string[]; vinetas: string[]; tabla?: Tabla };
export type Carta = {
  lugar_fecha?: string;
  destinatario: string[];
  asunto?: string;
  saludo: string;
  cuerpo: string[];
  despedida: string;
  firma: string[];
};
/** Un documento de texto (Word o PDF): secciones, o una carta. */
export type EspecTexto = { titulo: string; subtitulo?: string; autor?: string; secciones: Seccion[]; carta?: Carta };
export type Partida = { concepto: string; unidad?: string; cantidad: number; precio_unitario: number };
/** Un presupuesto (Excel): partidas, impuesto y descuento opcionales; los totales los calcula el código. */
export type EspecHoja = {
  titulo: string;
  cliente?: string;
  fecha?: string;
  moneda: string;
  partidas: Partida[];
  impuesto?: { nombre: string; porcentaje: number };
  descuento_porcentaje?: number;
  /** El total que dijo la persona (o el modelo), si dijo uno: se compara con el calculado; si no coincide, no se entrega. */
  total_declarado?: number;
  notas: string[];
};

/* Una presentación (PowerPoint): diapositivas con tipo; el diseño (tema, tipografía, numeración) lo pone el código. */
export const TIPOS_DIAPOSITIVA = ['portada', 'vinetas', 'dos_columnas', 'tabla', 'cifras', 'grafico', 'cita', 'cierre'] as const;
export type TipoDiapositiva = (typeof TIPOS_DIAPOSITIVA)[number];
export const TEMAS_PRESENTACION = ['azul', 'verde', 'grafito', 'vino'] as const;
export type TemaPresentacion = (typeof TEMAS_PRESENTACION)[number];
export type Columna = { titulo?: string; vinetas: string[] };
export type Cifra = { valor: string; etiqueta: string };
export type Grafico = { tipo: 'barras' | 'lineas' | 'pastel'; categorias: string[]; series: { nombre: string; valores: number[] }[]; unidad?: string };
export type Diapositiva = {
  tipo: TipoDiapositiva;
  /** Toda diapositiva lleva título (lo usa un lector de pantalla para navegar); en la cita es opcional. */
  titulo: string;
  subtitulo?: string;
  vinetas: string[];
  columnas?: [Columna, Columna];
  tabla?: Tabla;
  cifras?: Cifra[];
  grafico?: Grafico;
  cita?: { texto: string; autor?: string };
  notas?: string;
};
export type EspecPresentacion = {
  titulo: string;
  subtitulo?: string;
  autor?: string;
  tema: TemaPresentacion;
  diapositivas: Diapositiva[];
  /** Cuántas pidió la PERSONA («de 8 diapositivas»): lo pone la entrega (lib/entregables.ts diapositivasPedidas), nunca el modelo. */
  diapositivas_pedidas?: number;
};

/**
 * Topes de una presentación: lo que cabe LEGIBLE en una diapositiva de 16:9 con letra de 18 pt o más. Lo que no cabe se
 * rechaza con el porqué («divídelo en dos diapositivas»), nunca se encoge hasta que no se lea ni se corta en silencio.
 */
export const TOPES_PPTX = {
  diapositivas: 40,
  titulo: 120,
  vinetas: 8,
  vineta: 220,
  vinetasColumna: 6,
  columnas: 6,
  filas: 10,
  celda: 120,
  cifras: 4,
  valorCifra: 24,
  etiquetaCifra: 80,
  categorias: 12,
  categoriasPastel: 8,
  series: 4,
  cita: 400,
  notas: 3000,
} as const;

export type ArchivoPedido =
  | { tipo: 'docx'; nombre: string; spec: EspecTexto }
  | { tipo: 'pdf'; nombre: string; spec: EspecTexto }
  | { tipo: 'xlsx'; nombre: string; spec: EspecHoja }
  | { tipo: 'pptx'; nombre: string; spec: EspecPresentacion };

/** Lo que un archivo del pedido no cumple, dicho para el modelo (que lo corrija) y para la persona. */
export type ErrorEspec = { nombre: string; errores: string[] };

/* ------------------------------------------------------------------ texto */

/** Una línea: sin controles ni saltos, espacios juntos, con tope. */
export function linea(v: unknown, max: number): string {
  return String(v ?? '')
    .normalize('NFC')
    .replace(/[\u0000-\u001f\u007f\u2028\u2029]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max)
    .trim();
}

/** Un texto con párrafos: un salto de línea (o varios) separa párrafos; cada uno, una línea limpia. */
function parrafos(v: unknown, max: number): string[] {
  const xs = Array.isArray(v) ? v : v === undefined || v === null ? [] : [v];
  const out: string[] = [];
  for (const x of xs) {
    for (const p of String(x ?? '').normalize('NFC').replace(/\r\n?/g, '\n').split(/\n+/)) {
      const l = linea(p, max);
      if (l) out.push(l);
    }
  }
  return out;
}

/* ------------------------------------------------------------------ nombres */

const RESERVADOS_WIN = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

/**
 * El nombre de archivo que se entrega: sin carpetas («../../etc/x» → «x»), sin caracteres que rompen un sistema de
 * archivos o una cabecera HTTP, con tope, y con la extensión del tipo REAL (un «informe.doc» pedido como docx sale
 * «informe.docx»; un nombre vacío, «documento.docx»).
 */
export function nombreSeguro(nombre: unknown, tipo: TipoArchivo): string {
  let n = String(nombre ?? '').normalize('NFC');
  n = n.split(/[\\/]/).pop() || '';
  n = n
    .replace(/[\u0000-\u001f\u007f<>:"|?*;]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  // Sin la extensión que traiga (la que vale es la del tipo).
  n = n.replace(/\.[A-Za-z0-9]{1,5}$/, '');
  n = n.replace(/^[.\s-]+|[.\s]+$/g, '');
  if (n.length > 80) n = n.slice(0, 80).trim();
  if (!n) n = tipo === 'xlsx' ? 'hoja' : tipo === 'pptx' ? 'presentación' : 'documento';
  if (RESERVADOS_WIN.test(n)) n = `_${n}`;
  return `${n}.${tipo}`;
}

/* ------------------------------------------------------------------ números y dinero */

/** Un número del modelo: número de verdad o un texto «12.5» / «12,5» (un solo separador = decimales). */
export function numero(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const s = String(v ?? '').trim().replace(/\s/g, '');
  if (!/^-?\d+(?:[.,]\d+)?$/.test(s)) return null;
  const n = Number(s.replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

/** Redondea a entero quitando el ruido binario (0,1 + 0,2): igual que ROUND de una hoja de cálculo en lo que importa. */
export const entero = (x: number) => Math.round(Number(x.toPrecision(12)));

/** El importe de una partida, en centavos: ROUND(cantidad × precio; 2). */
export function importeCentavos(cantidad: number, precio: number): number {
  return entero(cantidad * precio * 100);
}

export type Totales = {
  importes: number[];
  subtotal: number;
  descuento: number;
  base: number;
  impuesto: number;
  total: number;
};

/**
 * Los totales de un presupuesto, en CENTAVOS enteros (sin errores de coma flotante). Es lo que se escribe como valor
 * de cada celda con fórmula y lo que la validación vuelve a calcular, por su cuenta, desde lo que releyó.
 */
export function calcularTotales(h: Pick<EspecHoja, 'partidas' | 'impuesto' | 'descuento_porcentaje'>): Totales {
  const importes = h.partidas.map((p) => importeCentavos(p.cantidad, p.precio_unitario));
  const subtotal = importes.reduce((a, b) => a + b, 0);
  const descuento = h.descuento_porcentaje ? entero((subtotal * h.descuento_porcentaje) / 100) : 0;
  const base = subtotal - descuento;
  const impuesto = h.impuesto ? entero((base * h.impuesto.porcentaje) / 100) : 0;
  return { importes, subtotal, descuento, base, impuesto, total: base + impuesto };
}

/** «12 500,50» como lo lee alguien en Honduras (miles con coma, decimales con punto: L 12,500.50). */
export function dinero(centavos: number, moneda = ''): string {
  const s = (centavos / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return moneda ? `${moneda} ${s}` : s;
}

/* ------------------------------------------------------------------ inyección de fórmulas */

/**
 * Un texto que va a una celda y empieza como fórmula (=, +, -, @, o un tabulador / retorno que algunos programas
 * saltan) se escribe con un apóstrofo delante (recomendación de OWASP para CSV/hojas): nunca se ejecuta al abrirlo ni
 * al editar la celda. Los datos del pedido vienen del modelo, que a su vez puede haber leído un correo o una página.
 */
export function celdaSegura(texto: string): string {
  return /^[=+\-@\t\r\uFF1D\uFF0B\uFF0D\uFF20]/.test(texto) ? `'${texto}` : texto;
}

/* ------------------------------------------------------------------ validar */

type Obj = Record<string, unknown>;
const esObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v);

function validarTabla(v: unknown, donde: string, errores: string[]): Tabla | undefined {
  if (v === undefined || v === null) return undefined;
  if (!esObj(v)) {
    errores.push(`${donde}: la tabla tiene que ser {cabecera, filas}`);
    return undefined;
  }
  const cabecera = (Array.isArray(v.cabecera) ? v.cabecera : []).map((c) => linea(c, TOPES.celda));
  if (!cabecera.length || cabecera.some((c) => !c)) {
    errores.push(`${donde}: la tabla necesita una cabecera con todas sus columnas nombradas`);
    return undefined;
  }
  if (cabecera.length > TOPES.columnas) errores.push(`${donde}: la tabla tiene ${cabecera.length} columnas (máximo ${TOPES.columnas})`);
  const filasCrudas = Array.isArray(v.filas) ? v.filas : [];
  if (filasCrudas.length > TOPES.filas) errores.push(`${donde}: la tabla tiene ${filasCrudas.length} filas (máximo ${TOPES.filas})`);
  const filas = filasCrudas.slice(0, TOPES.filas).map((f, i) => {
    const celdas = (Array.isArray(f) ? f : [f]).map((c) => linea(c, TOPES.celda));
    if (celdas.length > cabecera.length) errores.push(`${donde}: la fila ${i + 1} tiene más celdas (${celdas.length}) que la cabecera (${cabecera.length})`);
    while (celdas.length < cabecera.length) celdas.push('');
    return celdas.slice(0, cabecera.length);
  });
  if (!filas.length) errores.push(`${donde}: la tabla no tiene filas`);
  return { cabecera: cabecera.slice(0, TOPES.columnas), filas };
}

function validarTexto(v: unknown, errores: string[]): EspecTexto {
  const s = esObj(v) ? v : {};
  let titulo = linea(s.titulo, TOPES.titulo);
  const secciones: Seccion[] = [];
  const crudas = Array.isArray(s.secciones) ? s.secciones : [];
  if (crudas.length > TOPES.secciones) errores.push(`tiene ${crudas.length} secciones (máximo ${TOPES.secciones})`);
  let total = 0;
  crudas.slice(0, TOPES.secciones).forEach((c, i) => {
    const o: Obj = esObj(c) ? c : { parrafos: c };
    const sec: Seccion = {
      ...(linea(o.titulo, TOPES.titulo) ? { titulo: linea(o.titulo, TOPES.titulo) } : {}),
      parrafos: parrafos(o.parrafos ?? o.texto, TOPES.parrafo),
      vinetas: parrafos(o.vinetas, TOPES.parrafo).slice(0, TOPES.vinetas),
    };
    const tabla = validarTabla(o.tabla, `sección ${i + 1}`, errores);
    if (tabla) sec.tabla = tabla;
    total += sec.parrafos.length + sec.vinetas.length;
    if (!sec.parrafos.length && !sec.vinetas.length && !sec.tabla) errores.push(`la sección ${i + 1}${sec.titulo ? ` («${sec.titulo}»)` : ''} está vacía`);
    secciones.push(sec);
  });
  if (total > TOPES.parrafosTotal) errores.push(`tiene ${total} párrafos (máximo ${TOPES.parrafosTotal})`);
  let carta: Carta | undefined;
  if (s.carta !== undefined && s.carta !== null) {
    const c = esObj(s.carta) ? s.carta : {};
    carta = {
      ...(linea(c.lugar_fecha, 200) ? { lugar_fecha: linea(c.lugar_fecha, 200) } : {}),
      destinatario: parrafos(c.destinatario, 200).slice(0, 8),
      ...(linea(c.asunto, TOPES.titulo) ? { asunto: linea(c.asunto, TOPES.titulo) } : {}),
      saludo: linea(c.saludo, 300),
      cuerpo: parrafos(c.cuerpo, TOPES.parrafo).slice(0, 60),
      despedida: linea(c.despedida, 300),
      firma: parrafos(c.firma, 200).slice(0, 6),
    };
    if (!carta.saludo) errores.push('la carta no tiene saludo');
    if (!carta.cuerpo.length) errores.push('la carta no tiene cuerpo');
    if (!carta.despedida) errores.push('la carta no tiene despedida');
    if (!carta.firma.length) errores.push('la carta no tiene firma');
  }
  if (!secciones.length && !carta) errores.push('no tiene contenido: hacen falta secciones (o una carta)');
  // Una carta sin título: su asunto, o «Carta» (el título de un PDF va arriba; el de un Word, en sus propiedades).
  if (!titulo && carta) titulo = carta.asunto || 'Carta';
  if (!titulo) errores.push('falta el título');
  return {
    titulo,
    ...(linea(s.subtitulo, TOPES.titulo) ? { subtitulo: linea(s.subtitulo, TOPES.titulo) } : {}),
    ...(linea(s.autor, 120) ? { autor: linea(s.autor, 120) } : {}),
    secciones,
    ...(carta ? { carta } : {}),
  };
}

function validarHoja(v: unknown, errores: string[]): EspecHoja {
  const s = esObj(v) ? v : {};
  const titulo = linea(s.titulo, TOPES.titulo);
  if (!titulo) errores.push('falta el título');
  const crudas = Array.isArray(s.partidas) ? s.partidas : [];
  if (!crudas.length) errores.push('el presupuesto no tiene partidas');
  if (crudas.length > TOPES.partidas) errores.push(`tiene ${crudas.length} partidas (máximo ${TOPES.partidas})`);
  const partidas: Partida[] = [];
  crudas.slice(0, TOPES.partidas).forEach((p, i) => {
    const o = esObj(p) ? p : {};
    const concepto = linea(o.concepto, TOPES.celda);
    const cantidad = numero(o.cantidad);
    const precio = numero(o.precio_unitario ?? o.precio);
    const donde = `partida ${i + 1}${concepto ? ` («${concepto.slice(0, 40)}»)` : ''}`;
    if (!concepto) errores.push(`${donde}: falta el concepto`);
    if (cantidad === null) errores.push(`${donde}: la cantidad no es un número`);
    else if (!(cantidad > 0) || cantidad > 1e9) errores.push(`${donde}: la cantidad tiene que ser mayor que 0 (y razonable)`);
    if (precio === null) errores.push(`${donde}: el precio unitario no es un número`);
    else if (precio < 0 || precio > 1e12) errores.push(`${donde}: el precio unitario no puede ser negativo (ni desmesurado)`);
    partidas.push({ concepto, ...(linea(o.unidad, 30) ? { unidad: linea(o.unidad, 30) } : {}), cantidad: cantidad ?? 0, precio_unitario: precio ?? 0 });
  });
  let impuesto: EspecHoja['impuesto'];
  if (s.impuesto !== undefined && s.impuesto !== null) {
    const o = esObj(s.impuesto) ? s.impuesto : { porcentaje: s.impuesto };
    const pct = numero(o.porcentaje);
    if (pct === null || pct < 0 || pct > 100) errores.push('el impuesto tiene que ser un porcentaje entre 0 y 100');
    else if (pct > 0) impuesto = { nombre: linea(o.nombre, 40) || 'Impuesto', porcentaje: pct };
  }
  let descuento: number | undefined;
  if (s.descuento_porcentaje !== undefined && s.descuento_porcentaje !== null) {
    const d = numero(s.descuento_porcentaje);
    if (d === null || d < 0 || d > 100) errores.push('el descuento tiene que ser un porcentaje entre 0 y 100');
    else if (d > 0) descuento = d;
  }
  let declarado: number | undefined;
  if (s.total_declarado !== undefined && s.total_declarado !== null && s.total_declarado !== '') {
    const t = numero(s.total_declarado);
    if (t === null) errores.push('el total declarado no es un número');
    else declarado = t;
  }
  return {
    titulo,
    ...(linea(s.cliente, 200) ? { cliente: linea(s.cliente, 200) } : {}),
    ...(linea(s.fecha, 60) ? { fecha: linea(s.fecha, 60) } : {}),
    moneda: linea(s.moneda, 8) || 'L',
    partidas,
    ...(impuesto ? { impuesto } : {}),
    ...(descuento ? { descuento_porcentaje: descuento } : {}),
    ...(declarado !== undefined ? { total_declarado: declarado } : {}),
    notas: parrafos(s.notas, 600).slice(0, TOPES.notas),
  };
}

/** Una lista de líneas (viñetas): cada una limpia; las que pasan del tope se DICEN (no se cortan en silencio). */
function lineas(v: unknown, max: number, donde: string, errores: string[]): string[] {
  const out = parrafos(v, 100_000);
  const largas = out.filter((x) => x.length > max);
  if (largas.length) errores.push(`${donde}: ${largas.length} viñeta(s) de más de ${max} caracteres («${largas[0].slice(0, 40)}…»): acórtalas o divídelas`);
  return out.map((x) => linea(x, max));
}

function validarGrafico(v: unknown, donde: string, errores: string[]): Grafico | undefined {
  if (!esObj(v)) {
    errores.push(`${donde}: falta el gráfico {tipo, categorias, series}`);
    return undefined;
  }
  const crudo = linea(v.tipo, 20).toLowerCase();
  const SINONIMOS: Record<string, Grafico['tipo']> = { barras: 'barras', barra: 'barras', columnas: 'barras', lineas: 'lineas', linea: 'lineas', líneas: 'lineas', línea: 'lineas', pastel: 'pastel', torta: 'pastel', circular: 'pastel' };
  const tipo: Grafico['tipo'] | undefined = SINONIMOS[crudo];
  if (!tipo) errores.push(`${donde}: el gráfico tiene que ser de barras, lineas o pastel`);
  const categorias = (Array.isArray(v.categorias) ? v.categorias : []).map((c) => linea(c, 60));
  const maxCat = tipo === 'pastel' ? TOPES_PPTX.categoriasPastel : TOPES_PPTX.categorias;
  if (categorias.length < 2 || categorias.some((c) => !c)) errores.push(`${donde}: el gráfico necesita al menos 2 categorías, todas con nombre`);
  if (categorias.length > maxCat) errores.push(`${donde}: el gráfico tiene ${categorias.length} categorías (máximo ${maxCat} para que se lea)`);
  const crudas = Array.isArray(v.series) ? v.series : [];
  const series = crudas.slice(0, TOPES_PPTX.series).map((s, i) => {
    const o: Obj = esObj(s) ? s : { valores: s };
    const nombre = linea(o.nombre, 60) || (crudas.length === 1 ? linea(v.unidad, 30) || 'Valor' : '');
    const valores = (Array.isArray(o.valores) ? o.valores : []).map(numero);
    if (!nombre) errores.push(`${donde}: la serie ${i + 1} no tiene nombre`);
    if (valores.length !== categorias.length) errores.push(`${donde}: la serie ${i + 1}${nombre ? ` («${nombre}»)` : ''} tiene ${valores.length} valores y hay ${categorias.length} categorías`);
    if (valores.some((x) => x === null || Math.abs(x) > 1e15)) errores.push(`${donde}: la serie ${i + 1} tiene valores que no son números`);
    return { nombre, valores: valores.map((x) => x ?? 0) };
  });
  if (!series.length) errores.push(`${donde}: el gráfico no tiene series con datos`);
  if (crudas.length > TOPES_PPTX.series) errores.push(`${donde}: el gráfico tiene ${crudas.length} series (máximo ${TOPES_PPTX.series})`);
  if (tipo === 'pastel') {
    if (series.length > 1) errores.push(`${donde}: un pastel lleva UNA serie (usa barras para comparar varias)`);
    const s = series[0];
    if (s && (s.valores.some((x) => x < 0) || !(s.valores.reduce((a, b) => a + b, 0) > 0))) errores.push(`${donde}: en un pastel los valores no pueden ser negativos y tienen que sumar más que 0`);
  }
  return { tipo: tipo || 'barras', categorias, series, ...(linea(v.unidad, 30) ? { unidad: linea(v.unidad, 30) } : {}) };
}

function validarPresentacion(v: unknown, errores: string[]): EspecPresentacion {
  const s = esObj(v) ? v : {};
  const titulo = linea(s.titulo, TOPES_PPTX.titulo);
  if (!titulo) errores.push('falta el título de la presentación');
  const temaDicho = linea(s.tema, 20).toLowerCase();
  const tema = ((TEMAS_PRESENTACION as readonly string[]).includes(temaDicho) ? temaDicho : 'azul') as TemaPresentacion;
  const crudas = Array.isArray(s.diapositivas) ? s.diapositivas : [];
  if (!crudas.length) errores.push('la presentación no tiene diapositivas');
  if (crudas.length > TOPES_PPTX.diapositivas) errores.push(`tiene ${crudas.length} diapositivas (máximo ${TOPES_PPTX.diapositivas})`);
  const diapositivas: Diapositiva[] = [];
  crudas.slice(0, TOPES_PPTX.diapositivas).forEach((c, i) => {
    const o: Obj = esObj(c) ? c : {};
    const tipoDicho = linea(o.tipo, 30).toLowerCase().replace(/[\s-]+/g, '_').replace('viñetas', 'vinetas');
    const tituloDiapo = linea(o.titulo, TOPES_PPTX.titulo);
    const donde = `diapositiva ${i + 1}${tituloDiapo ? ` («${tituloDiapo.slice(0, 40)}»)` : ''}`;
    if (!(TIPOS_DIAPOSITIVA as readonly string[]).includes(tipoDicho)) {
      errores.push(`${donde}: tipo «${tipoDicho || '(vacío)'}» desconocido (${TIPOS_DIAPOSITIVA.join(', ')})`);
      return;
    }
    const tipo = tipoDicho as TipoDiapositiva;
    const d: Diapositiva = { tipo, titulo: tituloDiapo || (tipo === 'portada' ? titulo : ''), vinetas: [] };
    if (linea(o.subtitulo, TOPES_PPTX.titulo)) d.subtitulo = linea(o.subtitulo, TOPES_PPTX.titulo);
    if (o.notas !== undefined && o.notas !== null) {
      const notas = parrafos(o.notas, TOPES_PPTX.notas).join('\n');
      if (notas.length > TOPES_PPTX.notas) errores.push(`${donde}: las notas del orador pasan de ${TOPES_PPTX.notas} caracteres`);
      if (notas) d.notas = notas.slice(0, TOPES_PPTX.notas);
    }
    if (!d.titulo && tipo !== 'cita') errores.push(`${donde}: falta el título de la diapositiva`);
    if (tipo === 'vinetas') {
      d.vinetas = lineas(o.vinetas, TOPES_PPTX.vineta, donde, errores);
      if (!d.vinetas.length) errores.push(`${donde}: no tiene viñetas`);
      if (d.vinetas.length > TOPES_PPTX.vinetas) errores.push(`${donde}: tiene ${d.vinetas.length} viñetas (máximo ${TOPES_PPTX.vinetas} para que se lean): divídela en dos diapositivas`);
    } else if (tipo === 'dos_columnas') {
      const cols = Array.isArray(o.columnas) ? o.columnas : [];
      if (cols.length !== 2) errores.push(`${donde}: lleva exactamente 2 columnas (trae ${cols.length})`);
      const par = cols.slice(0, 2).map((x, k) => {
        const co: Obj = esObj(x) ? x : { vinetas: x };
        const vin = lineas(co.vinetas, TOPES_PPTX.vineta, `${donde}, columna ${k + 1}`, errores);
        if (!vin.length) errores.push(`${donde}: la columna ${k + 1} no tiene viñetas`);
        if (vin.length > TOPES_PPTX.vinetasColumna) errores.push(`${donde}: la columna ${k + 1} tiene ${vin.length} viñetas (máximo ${TOPES_PPTX.vinetasColumna})`);
        return { ...(linea(co.titulo, 80) ? { titulo: linea(co.titulo, 80) } : {}), vinetas: vin };
      });
      if (par.length === 2) d.columnas = [par[0], par[1]];
    } else if (tipo === 'tabla') {
      const t = validarTabla(o.tabla, donde, errores);
      if (!t) errores.push(`${donde}: falta la tabla {cabecera, filas}`);
      else {
        if (t.cabecera.length > TOPES_PPTX.columnas) errores.push(`${donde}: la tabla tiene ${t.cabecera.length} columnas (máximo ${TOPES_PPTX.columnas} en una diapositiva)`);
        if (t.filas.length > TOPES_PPTX.filas) errores.push(`${donde}: la tabla tiene ${t.filas.length} filas (máximo ${TOPES_PPTX.filas} en una diapositiva): repártela en varias`);
        if ([...t.cabecera, ...t.filas.flat()].some((x) => x.length > TOPES_PPTX.celda)) errores.push(`${donde}: hay celdas de más de ${TOPES_PPTX.celda} caracteres`);
        d.tabla = t;
      }
    } else if (tipo === 'cifras') {
      const cs = Array.isArray(o.cifras) ? o.cifras : [];
      if (!cs.length) errores.push(`${donde}: no tiene cifras [{valor, etiqueta}]`);
      if (cs.length > TOPES_PPTX.cifras) errores.push(`${donde}: tiene ${cs.length} cifras (máximo ${TOPES_PPTX.cifras})`);
      d.cifras = cs.slice(0, TOPES_PPTX.cifras).map((x, k) => {
        const co: Obj = esObj(x) ? x : {};
        const valor = linea(co.valor, 200);
        const etiqueta = linea(co.etiqueta, 200);
        if (!valor || !etiqueta) errores.push(`${donde}: la cifra ${k + 1} necesita valor y etiqueta`);
        if (valor.length > TOPES_PPTX.valorCifra) errores.push(`${donde}: el valor de la cifra ${k + 1} es muy largo (máximo ${TOPES_PPTX.valorCifra}: «L 2.4 M», «38 %»)`);
        if (etiqueta.length > TOPES_PPTX.etiquetaCifra) errores.push(`${donde}: la etiqueta de la cifra ${k + 1} pasa de ${TOPES_PPTX.etiquetaCifra} caracteres`);
        return { valor, etiqueta };
      });
    } else if (tipo === 'grafico') {
      const g = validarGrafico(o.grafico, donde, errores);
      if (g) d.grafico = g;
    } else if (tipo === 'cita') {
      const co: Obj = esObj(o.cita) ? o.cita : { texto: o.cita ?? o.texto, autor: o.autor };
      const texto = linea(co.texto, 100_000);
      if (!texto) errores.push(`${donde}: falta el texto de la cita`);
      if (texto.length > TOPES_PPTX.cita) errores.push(`${donde}: la cita pasa de ${TOPES_PPTX.cita} caracteres`);
      d.cita = { texto: texto.slice(0, TOPES_PPTX.cita), ...(linea(co.autor, 120) ? { autor: linea(co.autor, 120) } : {}) };
    }
    // Portada y cierre: título y subtítulo. Una viñeta suelta en ellas no se pierde en silencio: se dice.
    if ((tipo === 'portada' || tipo === 'cierre' || tipo === 'cita') && Array.isArray(o.vinetas) && o.vinetas.length) errores.push(`${donde}: una diapositiva de ${tipo} no lleva viñetas (usa una de viñetas)`);
    diapositivas.push(d);
  });
  return {
    titulo,
    ...(linea(s.subtitulo, TOPES_PPTX.titulo) ? { subtitulo: linea(s.subtitulo, TOPES_PPTX.titulo) } : {}),
    ...(linea(s.autor, 120) ? { autor: linea(s.autor, 120) } : {}),
    tema,
    diapositivas,
  };
}

/**
 * Lo que TIENE que leerse en cada diapositiva al releer el .pptx (validación semántica), en el orden de la presentación.
 * `celdas`: las de su tabla (cabecera incluida), para comprobarlas aparte.
 */
export function textosDiapositiva(d: Diapositiva): { textos: string[]; celdas: string[] } {
  const textos: string[] = [];
  if (d.titulo) textos.push(d.titulo);
  if (d.subtitulo) textos.push(d.subtitulo);
  textos.push(...d.vinetas);
  for (const c of d.columnas || []) {
    if (c.titulo) textos.push(c.titulo);
    textos.push(...c.vinetas);
  }
  for (const c of d.cifras || []) textos.push(c.valor, c.etiqueta);
  if (d.cita) textos.push(d.cita.texto, ...(d.cita.autor ? [d.cita.autor] : []));
  const celdas = d.tabla ? [...d.tabla.cabecera, ...d.tabla.filas.flat().filter(Boolean)] : [];
  return { textos, celdas };
}

/**
 * Valida y normaliza el pedido entero (1 a 5 archivos). Acepta `{archivos: [{tipo, nombre, spec}]}` o un solo
 * `{tipo, nombre, spec}`. Devuelve los válidos (con su nombre saneado y sin repetir) y, aparte, los errores de cada
 * uno: un archivo malo no tumba a los demás, pero nunca se entrega «arreglado» por su cuenta.
 */
export function validarPedido(entrada: unknown): { archivos: ArchivoPedido[]; errores: ErrorEspec[] } {
  const e = esObj(entrada) ? entrada : {};
  const lista = Array.isArray(e.archivos) ? e.archivos : e.tipo !== undefined ? [e] : [];
  const archivos: ArchivoPedido[] = [];
  const errores: ErrorEspec[] = [];
  if (!lista.length) return { archivos, errores: [{ nombre: '(pedido)', errores: ['no vino ningún archivo: manda {archivos: [{tipo, nombre, spec}]}'] }] };
  if (lista.length > TOPES.archivos) errores.push({ nombre: '(pedido)', errores: [`pidió ${lista.length} archivos; hago hasta ${TOPES.archivos} por vez (los demás no los hice)`] });
  const usados = new Set<string>();
  for (const [i, crudo] of lista.slice(0, TOPES.archivos).entries()) {
    const o = esObj(crudo) ? crudo : {};
    const tipo = String(o.tipo || '').toLowerCase().replace(/^\./, '') as TipoArchivo;
    const nombreDicho = linea(o.nombre, 120) || `archivo ${i + 1}`;
    if (!(TIPOS_ARCHIVO as readonly string[]).includes(tipo)) {
      errores.push({ nombre: nombreDicho, errores: [`tipo «${linea(o.tipo, 20) || '(vacío)'}» no soportado: docx, xlsx, pptx o pdf`] });
      continue;
    }
    let nombre = nombreSeguro(o.nombre, tipo);
    // El mismo nombre dos veces: el segundo es «nombre (2).ext» (nunca se pisa uno con otro).
    for (let k = 2; usados.has(nombre.toLowerCase()); k++) nombre = nombre.replace(/(?: \(\d+\))?\.([a-z]+)$/, ` (${k}).$1`);
    usados.add(nombre.toLowerCase());
    const errs: string[] = [];
    const spec = o.spec ?? o;
    if (tipo === 'xlsx') {
      const h = validarHoja(spec, errs);
      if (!errs.length && h.total_declarado !== undefined) {
        const t = calcularTotales(h);
        if (Math.round(h.total_declarado * 100) !== t.total) errs.push(`el total calculado (${dinero(t.total, h.moneda)}) no coincide con el total declarado (${dinero(Math.round(h.total_declarado * 100), h.moneda)}): revisa cantidades y precios`);
      }
      if (errs.length) errores.push({ nombre, errores: errs });
      else archivos.push({ tipo, nombre, spec: h });
    } else if (tipo === 'pptx') {
      const p = validarPresentacion(spec, errs);
      if (errs.length) errores.push({ nombre, errores: errs });
      else archivos.push({ tipo, nombre, spec: p });
    } else {
      const t = validarTexto(spec, errs);
      if (errs.length) errores.push({ nombre, errores: errs });
      else archivos.push({ tipo, nombre, spec: t } as ArchivoPedido);
    }
  }
  return { archivos, errores };
}

/**
 * Los textos que TIENEN que aparecer al releer un documento de texto (validación semántica). En el Word de una carta
 * el título no se imprime (va en sus propiedades): `conTitulo` false.
 */
export function textosEsperados(s: EspecTexto, conTitulo = true): { parrafos: string[]; secciones: string[]; celdas: string[]; cabeceras: string[] } {
  const parrafosEsp: string[] = conTitulo ? [s.titulo] : [];
  if (s.subtitulo) parrafosEsp.push(s.subtitulo);
  const celdas: string[] = [];
  const cabeceras: string[] = [];
  const secciones: string[] = [];
  for (const sec of s.secciones) {
    if (sec.titulo) secciones.push(sec.titulo);
    parrafosEsp.push(...sec.parrafos, ...sec.vinetas);
    if (sec.tabla) {
      cabeceras.push(...sec.tabla.cabecera);
      for (const f of sec.tabla.filas) celdas.push(...f.filter(Boolean));
    }
  }
  if (s.carta) {
    const c = s.carta;
    if (c.lugar_fecha) parrafosEsp.push(c.lugar_fecha);
    parrafosEsp.push(...c.destinatario);
    if (c.asunto) parrafosEsp.push(c.asunto);
    parrafosEsp.push(c.saludo, ...c.cuerpo, c.despedida, ...c.firma);
  }
  return { parrafos: parrafosEsp.filter(Boolean), secciones, celdas, cabeceras };
}
