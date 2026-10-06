/**
 * ARCHIVOS DE OFICINA: LA GENERACIÓN (FILE-01). De una especificación ya validada (lib/oficina/spec.ts) a los bytes.
 *
 *  · Word (.docx): `docx` (MIT, fijado en package.json; ficha en docs/dependencias/oficina.md). Títulos y encabezados
 *    con estilos de verdad (Título, Título 1), viñetas, tablas con fila de cabecera que se repite, idioma es-HN y las
 *    propiedades del documento (título, autor): accesible y editable, no un volcado de texto.
 *  · Excel (.xlsx): ExcelJS (MIT, fijado). ExcelJS NO calcula fórmulas: cada importe, el subtotal, el descuento, el
 *    impuesto y el total se calculan aquí en centavos enteros y se escriben como VALOR de la celda junto con su FÓRMULA
 *    (quien lo abra puede cambiar una cantidad y la hoja recalcula; `fullCalcOnLoad` lo pide al abrir). Ningún texto del
 *    pedido entra como fórmula: celdaSegura.
 *  · PDF: el escritor propio de siempre (lib/pdf.ts, multipágina, sin dependencias). No se trae otra biblioteca.
 *  · PowerPoint (.pptx): PptxGenJS (MIT, fijado), en lib/oficina/pptx.ts: tema sobrio con contraste AA, títulos en el
 *    marcador de título, numeración, notas del orador, tablas y gráficos nativos con texto alternativo.
 *
 * Generar no es entregar: lo que sale de aquí todavía pasa por la validación estructural y semántica (validar.ts).
 */
import ExcelJS from 'exceljs';
import { AlignmentType, BorderStyle, Document, HeadingLevel, Packer, Paragraph, ShadingType, Table, TableCell, TableRow, TextRun, WidthType } from 'docx';
import { documentoPdf, type Bloque } from '../pdf';
import { generarPptx } from './pptx';
import { calcularTotales, celdaSegura, type ArchivoPedido, type EspecHoja, type EspecTexto, type Seccion } from './spec';

/* ------------------------------------------------------------------ Word */

const BORDE = { style: BorderStyle.SINGLE, size: 4, color: '9AA5B1' } as const;

function tablaDocx(t: NonNullable<Seccion['tabla']>): Table {
  const ancho = Math.floor(100 / t.cabecera.length);
  const celda = (texto: string, cabecera: boolean) =>
    new TableCell({
      width: { size: ancho, type: WidthType.PERCENTAGE },
      ...(cabecera ? { shading: { type: ShadingType.CLEAR, color: 'auto', fill: 'E8EDF2' } } : {}),
      children: [new Paragraph({ children: [new TextRun({ text: texto, bold: cabecera })] })],
    });
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: { top: BORDE, bottom: BORDE, left: BORDE, right: BORDE, insideHorizontal: BORDE, insideVertical: BORDE },
    rows: [
      // La cabecera se repite arriba de cada página (y un lector de pantalla sabe que es cabecera).
      new TableRow({ tableHeader: true, children: t.cabecera.map((c) => celda(c, true)) }),
      ...t.filas.map((f) => new TableRow({ cantSplit: true, children: f.map((c) => celda(c, false)) })),
    ],
  });
}

function seccionesDocx(secciones: Seccion[]): (Paragraph | Table)[] {
  const out: (Paragraph | Table)[] = [];
  for (const s of secciones) {
    if (s.titulo) out.push(new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun(s.titulo)] }));
    for (const p of s.parrafos) out.push(new Paragraph({ spacing: { after: 120 }, children: [new TextRun(p)] }));
    for (const v of s.vinetas) out.push(new Paragraph({ bullet: { level: 0 }, children: [new TextRun(v)] }));
    if (s.tabla) {
      out.push(tablaDocx(s.tabla));
      out.push(new Paragraph({ children: [] }));
    }
  }
  return out;
}

function cartaDocx(s: EspecTexto): Paragraph[] {
  const c = s.carta!;
  const vacio = () => new Paragraph({ children: [] });
  const out: Paragraph[] = [];
  if (c.lugar_fecha) out.push(new Paragraph({ alignment: AlignmentType.RIGHT, children: [new TextRun(c.lugar_fecha)] }), vacio());
  for (const d of c.destinatario) out.push(new Paragraph({ children: [new TextRun(d)] }));
  if (c.destinatario.length) out.push(vacio());
  if (c.asunto) out.push(new Paragraph({ children: [new TextRun({ text: 'Asunto: ', bold: true }), new TextRun({ text: c.asunto, bold: true })] }), vacio());
  out.push(new Paragraph({ spacing: { after: 160 }, children: [new TextRun(c.saludo)] }));
  for (const p of c.cuerpo) out.push(new Paragraph({ alignment: AlignmentType.JUSTIFIED, spacing: { after: 160 }, children: [new TextRun(p)] }));
  out.push(new Paragraph({ spacing: { before: 120, after: 480 }, children: [new TextRun(c.despedida)] }));
  for (const f of c.firma) out.push(new Paragraph({ children: [new TextRun(f)] }));
  return out;
}

export async function generarDocx(s: EspecTexto): Promise<Buffer> {
  const hijos: (Paragraph | Table)[] = [];
  if (s.carta) {
    hijos.push(...cartaDocx(s));
    if (s.secciones.length) hijos.push(new Paragraph({ pageBreakBefore: true, children: [] }), ...seccionesDocx(s.secciones));
  } else {
    hijos.push(new Paragraph({ heading: HeadingLevel.TITLE, children: [new TextRun(s.titulo)] }));
    if (s.subtitulo) hijos.push(new Paragraph({ spacing: { after: 240 }, children: [new TextRun({ text: s.subtitulo, italics: true, color: '52606D' })] }));
    hijos.push(...seccionesDocx(s.secciones));
  }
  const doc = new Document({
    creator: s.autor || 'AU-RA',
    lastModifiedBy: 'AU-RA',
    title: s.titulo,
    ...(s.subtitulo ? { subject: s.subtitulo } : {}),
    styles: { default: { document: { run: { font: 'Calibri', size: 22, language: { value: 'es-HN' } } } } },
    sections: [{ children: hijos }],
  });
  return Packer.toBuffer(doc);
}

/* ------------------------------------------------------------------ Excel */

/** Dónde queda cada cosa de la hoja: la validación relee esas mismas celdas. */
export type DisposicionHoja = {
  hoja: string;
  cabecera: number;
  primera: number;
  ultima: number;
  subtotal: number;
  descuento: number | null;
  impuesto: number | null;
  total: number;
  notas: number | null;
};

export const HOJA_PRESUPUESTO = 'Presupuesto';

export function disposicionHoja(h: EspecHoja): DisposicionHoja {
  const cabecera = 4;
  const primera = cabecera + 1;
  const ultima = primera + h.partidas.length - 1;
  let fila = ultima + 1;
  const subtotal = fila++;
  const descuento = h.descuento_porcentaje ? fila++ : null;
  const impuesto = h.impuesto ? fila++ : null;
  const total = fila++;
  return { hoja: HOJA_PRESUPUESTO, cabecera, primera, ultima, subtotal, descuento, impuesto, total, notas: h.notas.length ? total + 2 : null };
}

/** Las fórmulas de cada fila de totales (la validación exige estas y ninguna otra). */
export function formulasHoja(h: EspecHoja, d = disposicionHoja(h)): Record<string, string> {
  const f: Record<string, string> = {};
  for (let r = d.primera; r <= d.ultima; r++) f[`F${r}`] = `ROUND(D${r}*E${r},2)`;
  f[`F${d.subtotal}`] = `SUM(F${d.primera}:F${d.ultima})`;
  const base = d.descuento ? `(F${d.subtotal}-F${d.descuento})` : `F${d.subtotal}`;
  if (d.descuento) f[`F${d.descuento}`] = `ROUND(F${d.subtotal}*${h.descuento_porcentaje}/100,2)`;
  if (d.impuesto) f[`F${d.impuesto}`] = `ROUND(${base}*${h.impuesto!.porcentaje}/100,2)`;
  f[`F${d.total}`] = [`F${d.subtotal}`, d.descuento ? `-F${d.descuento}` : '', d.impuesto ? `+F${d.impuesto}` : ''].join('');
  return f;
}

const FMT_DINERO = '#,##0.00';

export async function generarXlsx(h: EspecHoja, ahora = new Date()): Promise<Buffer> {
  const t = calcularTotales(h);
  const d = disposicionHoja(h);
  const formulas = formulasHoja(h, d);
  const wb = new ExcelJS.Workbook();
  wb.creator = 'AU-RA';
  wb.lastModifiedBy = 'AU-RA';
  wb.title = h.titulo;
  wb.created = ahora;
  wb.modified = ahora;
  // Excel y LibreOffice recalculan al abrir: si alguien cambia una cantidad, el total sigue siendo verdad.
  wb.calcProperties.fullCalcOnLoad = true;
  const ws = wb.addWorksheet(d.hoja, { views: [{ state: 'frozen', ySplit: d.cabecera }], pageSetup: { orientation: 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 0 } });
  ws.columns = [{ width: 6 }, { width: 46 }, { width: 10 }, { width: 11 }, { width: 18 }, { width: 18 }];

  ws.getCell('A1').value = celdaSegura(h.titulo);
  ws.getCell('A1').font = { bold: true, size: 14 };
  ws.mergeCells('A1:F1');
  if (h.cliente) ws.getCell('A2').value = celdaSegura(`Cliente: ${h.cliente}`);
  if (h.fecha) ws.getCell('E2').value = celdaSegura(`Fecha: ${h.fecha}`);

  const cab = ws.getRow(d.cabecera);
  cab.values = ['N.º', 'Concepto', 'Unidad', 'Cantidad', `Precio unitario (${h.moneda})`, `Importe (${h.moneda})`].map(celdaSegura);
  cab.font = { bold: true };
  cab.eachCell((c) => {
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8EDF2' } };
    c.border = { bottom: { style: 'thin' } };
  });

  h.partidas.forEach((p, i) => {
    const r = d.primera + i;
    const fila = ws.getRow(r);
    fila.getCell(1).value = i + 1;
    fila.getCell(2).value = celdaSegura(p.concepto);
    fila.getCell(3).value = celdaSegura(p.unidad || '');
    fila.getCell(4).value = p.cantidad;
    fila.getCell(4).numFmt = '#,##0.###';
    fila.getCell(5).value = p.precio_unitario;
    fila.getCell(5).numFmt = FMT_DINERO;
    fila.getCell(6).value = { formula: formulas[`F${r}`], result: t.importes[i] / 100 };
    fila.getCell(6).numFmt = FMT_DINERO;
  });

  const total = (r: number | null, etiqueta: string, centavos: number, negrita = false) => {
    if (!r) return;
    const fila = ws.getRow(r);
    fila.getCell(5).value = celdaSegura(etiqueta);
    fila.getCell(5).font = { bold: true };
    fila.getCell(6).value = { formula: formulas[`F${r}`], result: centavos / 100 };
    fila.getCell(6).numFmt = FMT_DINERO;
    if (negrita) fila.getCell(6).font = { bold: true };
  };
  total(d.subtotal, 'Subtotal', t.subtotal);
  total(d.descuento, `Descuento (${h.descuento_porcentaje} %)`, t.descuento);
  total(d.impuesto, h.impuesto ? `${h.impuesto.nombre} (${h.impuesto.porcentaje} %)` : '', t.impuesto);
  total(d.total, 'Total', t.total, true);
  ws.getRow(d.total).getCell(6).border = { top: { style: 'thin' }, bottom: { style: 'double' } };

  if (d.notas) {
    ws.getCell(`A${d.notas}`).value = 'Notas';
    ws.getCell(`A${d.notas}`).font = { bold: true };
    h.notas.forEach((n, i) => (ws.getCell(`B${d.notas! + 1 + i}`).value = celdaSegura(n)));
  }
  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf as ArrayBuffer);
}

/* ------------------------------------------------------------------ PDF */

/** Los bloques de lib/pdf.ts para una especificación de texto (la carta o las secciones). */
export function bloquesPdf(s: EspecTexto): Bloque[] {
  const b: Bloque[] = [];
  if (s.carta) {
    const c = s.carta;
    if (c.lugar_fecha) b.push({ tipo: 'parrafo', texto: c.lugar_fecha });
    for (const d of c.destinatario) b.push({ tipo: 'parrafo', texto: d });
    // El asunto ya es el título del PDF cuando no hubo otro: no se repite.
    if (c.asunto && c.asunto !== s.titulo) b.push({ tipo: 'parrafo', texto: `Asunto: ${c.asunto}` });
    b.push({ tipo: 'espacio', alto: 6 }, { tipo: 'parrafo', texto: c.saludo });
    for (const p of c.cuerpo) b.push({ tipo: 'parrafo', texto: p });
    b.push({ tipo: 'parrafo', texto: c.despedida }, { tipo: 'espacio', alto: 28 });
    for (const f of c.firma) b.push({ tipo: 'parrafo', texto: f });
    if (s.secciones.length) b.push({ tipo: 'pagina' });
  }
  for (const sec of s.secciones) {
    if (sec.titulo) b.push({ tipo: 'seccion', texto: sec.titulo });
    for (const p of sec.parrafos) b.push({ tipo: 'parrafo', texto: p });
    for (const v of sec.vinetas) b.push({ tipo: 'parrafo', texto: `• ${v}` });
    if (sec.tabla) b.push({ tipo: 'tabla', cabecera: sec.tabla.cabecera, filas: sec.tabla.filas });
  }
  return b;
}

export function generarPdf(s: EspecTexto): Buffer {
  return documentoPdf({ titulo: s.titulo, ...(s.subtitulo ? { subtitulo: s.subtitulo } : {}), bloques: bloquesPdf(s), pie: s.autor || '', acento: [0.2, 0.33, 0.55] });
}

/** Un archivo del pedido → sus bytes. */
export async function generarArchivo(a: ArchivoPedido, ahora = new Date()): Promise<Buffer> {
  if (a.tipo === 'docx') return generarDocx(a.spec);
  if (a.tipo === 'xlsx') return generarXlsx(a.spec, ahora);
  if (a.tipo === 'pptx') return generarPptx(a.spec);
  return generarPdf(a.spec);
}
