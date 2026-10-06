/**
 * ARCHIVOS DE OFICINA: LA PRESENTACIÓN (.pptx). De una EspecPresentacion ya validada (spec.ts) a los bytes, con PptxGenJS
 * (MIT, fijado a 4.0.1 en package.json; ficha en docs/dependencias/oficina.md). Corre en Node sin navegador: no usa
 * imágenes ni URLs (la biblioteca solo carga `node:https`/`node:fs` para medios, y aquí no hay medios).
 *
 * El modelo escribe el CONTENIDO; el diseño es de aquí y es siempre el mismo, sobrio y legible:
 *  · 16:9 (13,33 × 7,5 pulgadas), tipografía segura (Arial: está en Windows, macOS y, como Liberation Sans con las
 *    mismas medidas, en Linux/LibreOffice), títulos de 30 pt y texto de 18 pt o más.
 *  · Cuatro temas de color (azul, verde, grafito, vino). Cada par texto/fondo cumple el contraste AA de WCAG 2.1
 *    (≥ 4,5:1) y cada color de serie de un gráfico ≥ 3:1 contra el fondo (tests/oficina-pptx.test.ts lo calcula).
 *  · Cada diapositiva tiene su título en el marcador de TÍTULO del patrón (un lector de pantalla navega por él; el
 *    comprobador de accesibilidad de PowerPoint lo exige), idioma es-HN en cada texto, numeración en todas menos la
 *    portada, el título de la presentación al pie, notas del orador si las hay y texto alternativo en cada gráfico.
 *  · Gráficos nativos (barras, líneas, pastel): PowerPoint los guarda con su libro de datos incrustado (un .xlsx dentro
 *    del .pptx) para que «Editar datos» funcione; la validación lo revisa por dentro (sin macros ni enlaces).
 */
import JSZip from 'jszip';
import PptxGenJS from 'pptxgenjs';
import type { Diapositiva, EspecPresentacion, Grafico, TemaPresentacion } from './spec';

/* ------------------------------------------------------------------ tema */

export type Tema = {
  /** Fondo de las diapositivas de contenido. */
  fondo: string;
  /** Texto principal y de los títulos. */
  texto: string;
  /** Texto secundario (pie, autor de una cita). */
  tenue: string;
  /** Color del tema: fondo de portada y cierre, cabecera de tabla, cifras, columnas. */
  acento: string;
  /** Texto sobre el acento. */
  sobreAcento: string;
  /** Subtítulo sobre el acento (más suave, sin bajar del AA). */
  sobreAcentoSuave: string;
  /** Filas alternas de una tabla y tarjetas de cifras (el texto va encima). */
  banda: string;
  borde: string;
  /** Colores de las series de un gráfico, en orden. */
  series: string[];
};

/** Series compartidas (oscuras, distinguibles entre sí): todas ≥ 3:1 contra blanco. */
const SERIES_COMUNES = ['B45309', '2E7D32', '6A1B9A', 'AD1457', '00796B', '5D4037', '455A64', 'C62828'];

export const TEMAS: Record<TemaPresentacion, Tema> = {
  azul: { fondo: 'FFFFFF', texto: '1F2933', tenue: '52606D', acento: '1F4E79', sobreAcento: 'FFFFFF', sobreAcentoSuave: 'D9E6F2', banda: 'EEF3F8', borde: 'B8C4CE', series: ['1F4E79', ...SERIES_COMUNES] },
  verde: { fondo: 'FFFFFF', texto: '1F2933', tenue: '52606D', acento: '1E5631', sobreAcento: 'FFFFFF', sobreAcentoSuave: 'D8EBDD', banda: 'EDF5EF', borde: 'B7CBBC', series: ['1E5631', 'B45309', '1F4E79', '6A1B9A', 'AD1457', '00796B', '5D4037', '455A64'] },
  grafito: { fondo: 'FFFFFF', texto: '1F2933', tenue: '52606D', acento: '2F3A45', sobreAcento: 'FFFFFF', sobreAcentoSuave: 'DCE1E6', banda: 'EFF1F3', borde: 'BEC5CC', series: ['2F3A45', 'B45309', '1F4E79', '2E7D32', '6A1B9A', 'AD1457', '00796B', '5D4037'] },
  vino: { fondo: 'FFFFFF', texto: '1F2933', tenue: '52606D', acento: '7A1F3D', sobreAcento: 'FFFFFF', sobreAcentoSuave: 'F2DCE4', banda: 'F7EEF1', borde: 'D2B9C2', series: ['7A1F3D', '1F4E79', 'B45309', '2E7D32', '6A1B9A', '00796B', '5D4037', '455A64'] },
};

/** Luminancia relativa (WCAG 2.1) de un color «RRGGBB». */
function luminancia(hex: string): number {
  const c = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}

/** Contraste WCAG entre dos colores «RRGGBB» (1 a 21). AA: ≥ 4,5 texto normal; ≥ 3 texto grande y gráficos. */
export function contraste(a: string, b: string): number {
  const [x, y] = [luminancia(a), luminancia(b)].sort((m, n) => n - m);
  return (x + 0.05) / (y + 0.05);
}

/* ------------------------------------------------------------------ medidas */

export const FUENTE = 'Arial';
export const IDIOMA = 'es-HN';
/** Pulgadas (LAYOUT_WIDE). */
const ANCHO = 13.333;
const ALTO = 7.5;
const MARGEN = 0.6;
const UTIL = ANCHO - 2 * MARGEN;
const CUERPO_Y = 1.75;
const CUERPO_ALTO = 4.95;

const MAESTRO_CONTENIDO = 'AURA_CONTENIDO';
const MAESTRO_PORTADA = 'AURA_PORTADA';
const MAESTRO_LIMPIO = 'AURA_LIMPIO';
const MARCADOR_TITULO = 'titulo';

/** Número legible para el texto alternativo («12,500.5»: como lo lee alguien en Honduras). */
const cifra = (n: number) => n.toLocaleString('en-US', { maximumFractionDigits: 2 });

const NOMBRE_GRAFICO: Record<Grafico['tipo'], string> = { barras: 'barras', lineas: 'líneas', pastel: 'pastel' };

/** El texto alternativo de un gráfico: su tipo, título y TODOS sus datos (un lector de pantalla no ve las barras). */
export function textoAlternativo(titulo: string, g: Grafico): string {
  const datos = g.series.map((s) => `${g.series.length > 1 || g.tipo === 'pastel' ? `${s.nombre}: ` : ''}${g.categorias.map((c, i) => `${c} ${cifra(s.valores[i])}${g.unidad ? ` ${g.unidad}` : ''}`).join(', ')}`).join('; ');
  return `Gráfico de ${NOMBRE_GRAFICO[g.tipo]}${titulo ? `: ${titulo}` : ''}. ${datos}`.slice(0, 1500);
}

/* ------------------------------------------------------------------ cada tipo de diapositiva */

type Slide = PptxGenJS.Slide;

function patrones(p: PptxGenJS, t: Tema) {
  // Alineado a la izquierda, como todo lo demás (el marcador de título viene centrado por omisión).
  const titulo = { fontFace: FUENTE, fontSize: 30, bold: true, color: t.texto, align: 'left' as const, valign: 'bottom' as const, lang: IDIOMA, margin: 0 };
  const numero = { x: ANCHO - MARGEN - 1, y: ALTO - 0.55, w: 1, h: 0.35, fontFace: FUENTE, fontSize: 12, color: t.tenue, align: 'right' as const };
  p.defineSlideMaster({
    title: MAESTRO_CONTENIDO,
    background: { color: t.fondo },
    objects: [
      // La raya del acento bajo el título: lo único decorativo.
      { rect: { x: MARGEN, y: 1.45, w: 1.1, h: 0.07, fill: { color: t.acento }, line: { color: t.acento, width: 0 } } },
      { placeholder: { options: { name: MARCADOR_TITULO, type: 'title', x: MARGEN, y: 0.35, w: UTIL, h: 1.0, ...titulo }, text: '' } },
    ],
    slideNumber: numero,
  });
  // Una cita sin título: sin la raya de acento (que subraya un título que no hay), con su número.
  p.defineSlideMaster({ title: MAESTRO_LIMPIO, background: { color: t.fondo }, slideNumber: numero });
  p.defineSlideMaster({
    title: MAESTRO_PORTADA,
    background: { color: t.acento },
    objects: [{ placeholder: { options: { name: MARCADOR_TITULO, type: 'title', x: MARGEN + 0.2, y: 2.0, w: UTIL - 0.4, h: 1.9, ...titulo, fontSize: 40, color: t.sobreAcento }, text: '' } }],
  });
}

const textoBase = (t: Tema) => ({ fontFace: FUENTE, color: t.texto, lang: IDIOMA });

function pie(s: Slide, e: EspecPresentacion, t: Tema) {
  s.addText(e.titulo, { x: MARGEN, y: ALTO - 0.55, w: UTIL - 1.2, h: 0.35, fontSize: 12, ...textoBase(t), color: t.tenue, fit: 'shrink', margin: 0 });
}

function vinetas(s: Slide, xs: string[], caja: { x: number; y: number; w: number; h: number }, t: Tema, tam: number) {
  s.addText(
    xs.map((v) => ({ text: v, options: { bullet: { indent: 22 }, paraSpaceAfter: 10, breakLine: true } })),
    { ...caja, fontSize: tam, ...textoBase(t), valign: 'top', fit: 'shrink', margin: 4 }
  );
}

function portadaOCierre(s: Slide, d: Diapositiva, e: EspecPresentacion, t: Tema) {
  s.addText(d.titulo, { placeholder: MARCADOR_TITULO });
  const sub = d.subtitulo || (d.tipo === 'portada' ? e.subtitulo : undefined);
  if (sub) s.addText(sub, { x: MARGEN + 0.2, y: 4.05, w: UTIL - 0.4, h: 1.0, fontSize: 22, ...textoBase(t), color: t.sobreAcentoSuave, valign: 'top', fit: 'shrink', margin: 0 });
  if (d.tipo === 'portada' && e.autor) s.addText(e.autor, { x: MARGEN + 0.2, y: ALTO - 1.2, w: UTIL - 0.4, h: 0.5, fontSize: 18, ...textoBase(t), color: t.sobreAcento, margin: 0 });
}

function tabla(s: Slide, d: Diapositiva, t: Tema) {
  const tb = d.tabla!;
  const filas = tb.filas.length;
  const tam = filas > 7 || tb.cabecera.length > 4 ? 14 : 16;
  const borde = { type: 'solid' as const, pt: 0.75, color: t.borde };
  const celda = (texto: string, o: PptxGenJS.TableCellProps) => ({ text: texto, options: { fontFace: FUENTE, fontSize: tam, lang: IDIOMA, border: [borde, borde, borde, borde], valign: 'middle' as const, margin: 0.06, ...o } });
  const rows = [
    tb.cabecera.map((c) => celda(c, { bold: true, color: t.sobreAcento, fill: { color: t.acento } })),
    ...tb.filas.map((f, i) => f.map((c) => celda(c, { color: t.texto, fill: { color: i % 2 ? t.banda : t.fondo } }))),
  ];
  s.addTable(rows as PptxGenJS.TableRow[], { x: MARGEN, y: CUERPO_Y + 0.1, w: UTIL, colW: Array(tb.cabecera.length).fill(UTIL / tb.cabecera.length), rowH: Math.min(0.5, CUERPO_ALTO / (filas + 1)) });
}

function cifras(s: Slide, d: Diapositiva, t: Tema) {
  const cs = d.cifras!;
  const hueco = 0.35;
  const w = (UTIL - hueco * (cs.length - 1)) / cs.length;
  cs.forEach((c, i) => {
    const x = MARGEN + i * (w + hueco);
    s.addShape('rect', { x, y: CUERPO_Y + 0.6, w, h: 3.2, fill: { color: t.banda }, line: { color: t.borde, width: 0.75 } });
    s.addText(c.valor, { x: x + 0.15, y: CUERPO_Y + 0.9, w: w - 0.3, h: 1.4, fontSize: cs.length > 3 ? 36 : 44, bold: true, ...textoBase(t), color: t.acento, align: 'center', valign: 'middle', fit: 'shrink', margin: 0 });
    s.addText(c.etiqueta, { x: x + 0.15, y: CUERPO_Y + 2.35, w: w - 0.3, h: 1.25, fontSize: 18, ...textoBase(t), align: 'center', valign: 'top', fit: 'shrink', margin: 0 });
  });
}

function grafico(p: PptxGenJS, s: Slide, d: Diapositiva, t: Tema) {
  const g = d.grafico!;
  const tipo = g.tipo === 'pastel' ? p.ChartType.pie : g.tipo === 'lineas' ? p.ChartType.line : p.ChartType.bar;
  const datos = g.series.map((x) => ({ name: x.nombre, labels: g.categorias, values: x.valores }));
  const etiquetasDeValor = g.tipo === 'pastel' || g.categorias.length * g.series.length <= 12;
  const comun = {
    x: MARGEN,
    y: CUERPO_Y,
    w: UTIL,
    h: CUERPO_ALTO,
    altText: textoAlternativo(d.titulo, g),
    lang: IDIOMA,
    chartColors: g.tipo === 'pastel' ? t.series.slice(0, g.categorias.length) : t.series.slice(0, g.series.length),
    showLegend: g.series.length > 1 || g.tipo === 'pastel',
    legendPos: (g.tipo === 'pastel' ? 'r' : 'b') as 'r' | 'b',
    legendFontFace: FUENTE,
    legendFontSize: 16,
    legendColor: t.texto,
    dataLabelColor: t.texto,
    dataLabelFontFace: FUENTE,
    dataLabelFontSize: 14,
  };
  if (g.tipo === 'pastel') {
    s.addChart(tipo, datos, { ...comun, showPercent: true, showValue: false, dataLabelPosition: 'outEnd', dataLabelColor: t.texto });
    return;
  }
  s.addChart(tipo, datos, {
    ...comun,
    showValue: etiquetasDeValor,
    dataLabelPosition: g.tipo === 'lineas' ? 't' : 'outEnd',
    dataLabelFormatCode: '#,##0.##',
    barDir: 'col',
    barGrouping: 'clustered',
    lineSize: 3,
    lineDataSymbol: 'circle',
    lineDataSymbolSize: 9,
    catAxisLabelColor: t.texto,
    catAxisLabelFontFace: FUENTE,
    catAxisLabelFontSize: 14,
    valAxisLabelColor: t.texto,
    valAxisLabelFontFace: FUENTE,
    valAxisLabelFontSize: 14,
    valAxisLabelFormatCode: '#,##0.##',
    valGridLine: { color: t.borde, size: 0.75 },
    catGridLine: { style: 'none' },
    ...(g.unidad ? { showValAxisTitle: true, valAxisTitle: g.unidad, valAxisTitleColor: t.texto, valAxisTitleFontFace: FUENTE, valAxisTitleFontSize: 14 } : {}),
  });
}

function cita(s: Slide, d: Diapositiva, t: Tema) {
  const c = d.cita!;
  const arriba = d.titulo ? CUERPO_Y : 0.9;
  s.addText(`«${c.texto}»`, { x: MARGEN + 0.8, y: arriba + 0.3, w: UTIL - 1.6, h: 3.4, fontSize: c.texto.length > 220 ? 24 : 30, italic: true, ...textoBase(t), align: 'center', valign: 'middle', fit: 'shrink', margin: 0 });
  if (c.autor) s.addText(`— ${c.autor}`, { x: MARGEN + 0.8, y: arriba + 3.85, w: UTIL - 1.6, h: 0.6, fontSize: 20, ...textoBase(t), color: t.tenue, align: 'center', margin: 0 });
}

function dosColumnas(s: Slide, d: Diapositiva, t: Tema) {
  const hueco = 0.5;
  const w = (UTIL - hueco) / 2;
  d.columnas!.forEach((c, i) => {
    const x = MARGEN + i * (w + hueco);
    let y = CUERPO_Y;
    if (c.titulo) {
      s.addText(c.titulo, { x, y, w, h: 0.6, fontSize: 22, bold: true, ...textoBase(t), color: t.acento, valign: 'bottom', fit: 'shrink', margin: 0 });
      y += 0.75;
    }
    vinetas(s, c.vinetas, { x, y, w, h: CUERPO_Y + CUERPO_ALTO - y }, t, 20);
  });
}

/* ------------------------------------------------------------------ la presentación */

export async function generarPptx(e: EspecPresentacion): Promise<Buffer> {
  const t = TEMAS[e.tema] || TEMAS.azul;
  const p = new PptxGenJS();
  p.layout = 'LAYOUT_WIDE';
  p.title = e.titulo;
  p.author = e.autor || 'AU-RA';
  p.company = 'AU-RA';
  if (e.subtitulo) p.subject = e.subtitulo;
  p.theme = { headFontFace: FUENTE, bodyFontFace: FUENTE };
  patrones(p, t);
  for (const d of e.diapositivas) {
    const fuerte = d.tipo === 'portada' || d.tipo === 'cierre';
    const s = p.addSlide({ masterName: fuerte ? MAESTRO_PORTADA : d.titulo ? MAESTRO_CONTENIDO : MAESTRO_LIMPIO });
    if (fuerte) portadaOCierre(s, d, e, t);
    else {
      if (d.titulo) s.addText(d.titulo, { placeholder: MARCADOR_TITULO });
      if (d.tipo === 'vinetas') vinetas(s, d.vinetas, { x: MARGEN, y: CUERPO_Y, w: UTIL, h: CUERPO_ALTO }, t, d.vinetas.length > 5 ? 20 : 24);
      else if (d.tipo === 'dos_columnas') dosColumnas(s, d, t);
      else if (d.tipo === 'tabla') tabla(s, d, t);
      else if (d.tipo === 'cifras') cifras(s, d, t);
      else if (d.tipo === 'grafico') grafico(p, s, d, t);
      else if (d.tipo === 'cita') cita(s, d, t);
      pie(s, e, t);
    }
    if (d.notas) s.addNotes(d.notas);
  }
  const datos = await p.write({ outputType: 'nodebuffer' });
  return retocar(Buffer.isBuffer(datos) ? datos : Buffer.from(datos as ArrayBuffer));
}

/**
 * Tres retoques al paquete que escribe PptxGenJS, sin tocar el contenido:
 *  · el marcador de TÍTULO sin `idx` (el 0 implícito): PptxGenJS le pone idx="101" y los lectores que buscan el título
 *    por idx 0 (python-pptx, varios lectores de pantalla y conversores) no lo encontraban;
 *  · las notas del orador en es-HN (PptxGenJS las marca en-US: el corrector y la voz de lectura irían en inglés);
 *  · fuera de [Content_Types].xml las declaraciones de partes que no existen (PptxGenJS declara un patrón por diapositiva).
 */
async function retocar(datos: Buffer): Promise<Buffer> {
  const zip = await JSZip.loadAsync(datos);
  for (const n of Object.keys(zip.files)) {
    if (/^ppt\/(?:slides|slideLayouts)\/[^/]+\.xml$/.test(n)) {
      const xml = await zip.file(n)!.async('text');
      zip.file(n, xml.replace(/<p:ph\b[^>]*>/g, (ph) => (/\btype="title"/.test(ph) ? ph.replace(/\s+idx="\d+"/, '') : ph)));
    } else if (/^ppt\/notesSlides\/[^/]+\.xml$/.test(n)) {
      zip.file(n, (await zip.file(n)!.async('text')).replace(/\blang="en-US"/g, `lang="${IDIOMA}"`));
    }
  }
  const tipos = await zip.file('[Content_Types].xml')!.async('text');
  zip.file('[Content_Types].xml', tipos.replace(/<Override PartName="\/([^"]+)"[^>]*\/>/g, (o, parte) => (zip.file(parte) ? o : '')));
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 6 } });
}
