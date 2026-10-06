/**
 * ARCHIVOS DE OFICINA: LA VALIDACIÓN (FILE-01/FILE-02). Un ZIP válido o unas celdas no vacías no prueban que el
 * presupuesto sea correcto (auditoría §8). Por eso son tres pasos distintos, cada uno con su evidencia:
 *
 *  1. ESTRUCTURAL — lo que hay por dentro es del tipo que dice el nombre (bytes mágicos), el contenedor está entero
 *     (un ZIP con su directorio central y TODAS sus partes obligatorias; un PDF con xref, %%EOF y al menos una página),
 *     cada XML se puede leer, y no trae nada que no pusimos: macros, ActiveX ni relaciones a direcciones de afuera.
 *     En una presentación, además: cada diapositiva que nombra la presentación existe, y lo único incrustado que se
 *     acepta es el libro de datos de un gráfico (revisado por dentro).
 *  2. SEMÁNTICA — se RELEE con lectores independientes del que lo escribió (lib/leer-oficina.ts para Word, Excel y
 *     PowerPoint —diapositiva por diapositiva, en su orden; tablas celda por celda y gráficos serie por serie—,
 *     pdf.js para el PDF, ExcelJS releyendo la hoja) y se comprueba que está TODO lo pedido: cada título, párrafo,
 *     viñeta y celda; en el presupuesto, cada partida, cada fórmula en su sitio y cada total, que además se vuelve a
 *     calcular desde las cantidades y precios releídos. Una fórmula que no pusimos, o un texto que empieza por «=»
 *     sin neutralizar, es un fallo.
 *  3. RENDER (opcional) — LibreOffice sin cabeza, con perfil temporal y tope de tiempo, lo convierte a PDF: que abre
 *     en un programa de oficina de verdad y cuántas páginas salen. El render de LibreOffice no es idéntico al de
 *     Microsoft Office, y así se dice en el recibo.
 */
import { execFile } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import { DOMParser } from '@xmldom/xmldom';
import { paginasDeDocx, paginasDePptx, paginasDeXlsx } from '../leer-oficina';
import { textoPorPaginas } from '../leer-pdf-pdfjs';
import { textoVisiblePdf } from '../pdf';
import { disposicionHoja, formulasHoja, HOJA_PRESUPUESTO } from './generar';
import { calcularTotales, celdaSegura, dinero, entero, importeCentavos, TOPES, textosDiapositiva, textosEsperados, type ArchivoPedido, type EspecHoja, type EspecPresentacion, type EspecTexto, type TipoArchivo } from './spec';

export type Comprobacion = { que: string; ok: boolean; detalle?: string };
export type Render = { estado: 'hecho' | 'omitido' | 'fallido'; motor?: string; paginas?: number; ms?: number; detalle: string };
export type Validacion = {
  /** Lo que es por dentro (bytes mágicos + contenedor), no lo que dice el nombre. */
  tipoReal: TipoArchivo | 'otro';
  estructural: { ok: boolean; defectos: string[] };
  semantico: { ok: boolean; comprobaciones: Comprobacion[] };
  paginas?: number;
  render?: Render;
};

/* ------------------------------------------------------------------ utilidades */

/** Las cinco entidades de XML y las numéricas (lo que escribe un generador en un texto). */
const desescaparXml = (s: string) =>
  s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&amp;/g, '&');
const compacto = (s: string) => String(s ?? '').normalize('NFC').replace(/\s+/g, '');
const corto = (s: string, n = 60) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** ¿Están todos? Devuelve la comprobación con los que faltan (los primeros, citados). */
function todos(que: string, esperados: string[], texto: string, ver: (s: string) => string = (s) => s): Comprobacion {
  const hay = compacto(texto);
  const faltan = esperados.filter((e) => !hay.includes(compacto(ver(e))));
  return faltan.length
    ? { que, ok: false, detalle: `faltan ${faltan.length} de ${esperados.length}: ${faltan.slice(0, 3).map((f) => `«${corto(f)}»`).join(', ')}` }
    : { que, ok: true, detalle: `${esperados.length} de ${esperados.length}` };
}

/** El tipo por dentro: %PDF, o un ZIP de Office con su parte principal. */
export async function tipoPorDentro(datos: Buffer): Promise<TipoArchivo | 'otro'> {
  if (datos.subarray(0, 5).toString('latin1') === '%PDF-') return 'pdf';
  if (datos.length < 4 || datos.readUInt32LE(0) !== 0x04034b50) return 'otro';
  try {
    const zip = await JSZip.loadAsync(datos);
    if (zip.file('word/document.xml')) return 'docx';
    if (zip.file('xl/workbook.xml')) return 'xlsx';
    if (zip.file('ppt/presentation.xml')) return 'pptx';
  } catch {
    /* un ZIP roto no es de ningún tipo */
  }
  return 'otro';
}

/* ------------------------------------------------------------------ estructural */

type Ooxml = 'docx' | 'xlsx' | 'pptx';
const PRINCIPAL: Record<Ooxml, { partes: string[]; contenido: string }> = {
  docx: { partes: ['[Content_Types].xml', '_rels/.rels', 'word/document.xml'], contenido: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml' },
  xlsx: { partes: ['[Content_Types].xml', '_rels/.rels', 'xl/workbook.xml', 'xl/_rels/workbook.xml.rels'], contenido: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml' },
  pptx: { partes: ['[Content_Types].xml', '_rels/.rels', 'ppt/presentation.xml', 'ppt/_rels/presentation.xml.rels'], contenido: 'application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml' },
};

/** Lo que apunta una relación, como ruta dentro del ZIP («../charts/chart1.xml» desde ppt/slides → ppt/charts/chart1.xml). */
function destinoRel(desde: string, target: string): string {
  if (target.startsWith('/')) return target.slice(1);
  const partes = desde.split('/').slice(0, -1);
  for (const p of target.split('/')) {
    if (p === '..') partes.pop();
    else if (p && p !== '.') partes.push(p);
  }
  return partes.join('/');
}

/** Las relaciones de una parte: id → {tipo (lo último de su Type), destino}. */
async function relacionesDe(zip: JSZip, parte: string): Promise<Record<string, { tipo: string; destino: string }>> {
  const xml = (await zip.file(parte.replace(/([^/]+)$/, '_rels/$1.rels'))?.async('text')) || '';
  const out: Record<string, { tipo: string; destino: string }> = {};
  for (const m of xml.matchAll(/<Relationship\b[^>]*>/g)) {
    const id = /\bId="([^"]+)"/.exec(m[0])?.[1];
    const target = /\bTarget="([^"]+)"/.exec(m[0])?.[1];
    const tipo = /\bType="([^"]+)"/.exec(m[0])?.[1] || '';
    if (id && target) out[id] = { tipo: tipo.split('/').pop() || '', destino: destinoRel(parte, desescaparXml(target)) };
  }
  return out;
}

/**
 * Las diapositivas EN ORDEN según ppt/presentation.xml (su lista sldIdLst resuelta por sus relaciones: el nombre del
 * archivo no dice el orden) y las que esa lista nombra pero no están en el ZIP (una diapositiva faltante).
 */
export async function diapositivasDe(zip: JSZip): Promise<{ partes: string[]; faltan: string[] }> {
  const pres = (await zip.file('ppt/presentation.xml')?.async('text')) || '';
  const rels = await relacionesDe(zip, 'ppt/presentation.xml');
  const lista = /<p:sldIdLst>([\s\S]*?)<\/p:sldIdLst>/.exec(pres)?.[1] || '';
  const partes: string[] = [];
  const faltan: string[] = [];
  for (const m of lista.matchAll(/<p:sldId\b[^>]*\br:id="([^"]+)"/g)) {
    const r = rels[m[1]];
    if (r && zip.file(r.destino)) partes.push(r.destino);
    else faltan.push(r?.destino || m[1]);
  }
  return { partes, faltan };
}

/**
 * Un libro de datos incrustado (el de un gráfico): tiene que ser un .xlsx de verdad, entero, sin macros, sin objetos
 * incrustados y sin enlaces de afuera. Devuelve sus defectos.
 */
async function revisarIncrustado(nombre: string, datos: Buffer): Promise<string[]> {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(datos);
  } catch {
    return [`el libro incrustado ${nombre} está dañado`];
  }
  const d: string[] = [];
  if (!zip.file('xl/workbook.xml')) d.push(`${nombre} no es un libro de Excel`);
  for (const n of Object.keys(zip.files)) {
    if (zip.files[n].dir) continue;
    if (/vbaProject\.bin$|\/activeX\/|\.bin$|\/embeddings\//i.test(n)) d.push(`${nombre} trae macros u objetos incrustados (${n})`);
    if (!/\.(xml|rels)$/i.test(n)) continue;
    const xml = await zip.files[n].async('text');
    if (/TargetMode\s*=\s*"External"/i.test(xml) || /externalLink/i.test(xml)) d.push(`${nombre} apunta a una dirección de afuera (${n})`);
    if (/macroEnabled/i.test(xml)) d.push(`${nombre} es un libro con macros`);
  }
  return d;
}

function xmlBienFormado(xml: string): string | null {
  try {
    new DOMParser({
      onError: (nivel: string, msg: string) => {
        if (nivel !== 'warning') throw new Error(msg);
      },
    }).parseFromString(xml, 'text/xml');
    return null;
  } catch (e: any) {
    return String(e?.message || e).split('\n')[0].slice(0, 120);
  }
}

async function estructuraOoxml(datos: Buffer, tipo: Ooxml): Promise<{ defectos: string[]; zip: JSZip | null }> {
  const defectos: string[] = [];
  if (datos.length < 4 || datos.readUInt32LE(0) !== 0x04034b50) return { defectos: ['no empieza como un ZIP de Office'], zip: null };
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(datos);
  } catch (e: any) {
    return { defectos: [`el ZIP está dañado o cortado (${String(e?.message || e).slice(0, 80)})`], zip: null };
  }
  let descomprimido = 0;
  zip.forEach((_, f: any) => (descomprimido += Number(f?._data?.uncompressedSize || 0)));
  if (descomprimido > 100 * 1024 * 1024) defectos.push('se descomprime a más de 100 MB');
  const p = PRINCIPAL[tipo];
  for (const parte of p.partes) if (!zip.file(parte)) defectos.push(`le falta la parte ${parte}`);
  if (tipo === 'xlsx' && !Object.keys(zip.files).some((n) => /^xl\/worksheets\/sheet\d+\.xml$/.test(n))) defectos.push('no tiene ninguna hoja');
  const tipos = (await zip.file('[Content_Types].xml')?.async('text')) || '';
  if (tipos && !tipos.includes(p.contenido)) defectos.push(`[Content_Types].xml no declara el documento principal de ${tipo}`);
  if (/macroEnabled/i.test(tipos)) defectos.push('[Content_Types].xml lo declara como documento CON MACROS');
  if (tipo === 'pptx' && zip.file('ppt/presentation.xml')) {
    const d = await diapositivasDe(zip);
    if (!d.partes.length && !d.faltan.length) defectos.push('no tiene ninguna diapositiva');
    if (d.faltan.length) defectos.push(`le faltan ${d.faltan.length} diapositiva(s) que la presentación nombra (${d.faltan.slice(0, 3).join(', ')})`);
  }
  for (const nombre of Object.keys(zip.files)) {
    const f = zip.files[nombre];
    if (f.dir) continue;
    if (/vbaProject\.bin$|\/activeX\/|\.bin$/i.test(nombre)) defectos.push(`trae una parte binaria o con macros (${nombre})`);
    // Lo único incrustado que se acepta es el libro de datos de un gráfico (un .xlsx), y se revisa por dentro.
    if (/(?:^|\/)embeddings\//i.test(nombre)) {
      if (tipo === 'pptx' && /^ppt\/embeddings\/[\w.-]+\.xlsx$/i.test(nombre)) defectos.push(...(await revisarIncrustado(nombre, await f.async('nodebuffer'))));
      else defectos.push(`trae un objeto incrustado (${nombre})`);
    }
    if (!/\.(xml|rels)$/i.test(nombre)) continue;
    const xml = await f.async('text');
    const mal = xmlBienFormado(xml);
    if (mal) defectos.push(`${nombre} no es XML válido (${mal})`);
    if (/TargetMode\s*=\s*"External"/i.test(xml)) defectos.push(`${nombre} apunta a una dirección de afuera`);
    if (/\/relationships\/oleObject"/i.test(xml)) defectos.push(`${nombre} incrusta un objeto OLE`);
  }
  return { defectos, zip };
}

function estructuraPdf(datos: Buffer): { defectos: string[]; paginas: number } {
  const defectos: string[] = [];
  const cab = datos.subarray(0, 8).toString('latin1');
  if (!/^%PDF-1\.\d/.test(cab)) defectos.push('no empieza como un PDF');
  const cola = datos.subarray(Math.max(0, datos.length - 1024)).toString('latin1');
  if (!/%%EOF\s*$/.test(cola)) defectos.push('está cortado (no termina en %%EOF)');
  if (!/startxref\s+\d+/.test(cola)) defectos.push('no tiene su tabla de referencias (startxref)');
  const texto = datos.toString('latin1');
  const paginas = (texto.match(/\/Type\s*\/Page(?![s\w])/g) || []).length;
  if (!paginas) defectos.push('no tiene ninguna página');
  if (/\/JavaScript|\/JS\s|\/Launch|\/EmbeddedFile/.test(texto)) defectos.push('trae JavaScript, acciones o archivos incrustados');
  return { defectos, paginas };
}

/* ------------------------------------------------------------------ semántica */

async function semanticaDocx(s: EspecTexto, datos: Buffer, zip: JSZip): Promise<Comprobacion[]> {
  const c: Comprobacion[] = [];
  const paginas = await paginasDeDocx(datos);
  const texto = paginas.map((p) => p.texto).join('\n');
  c.push({ que: 'se relee el texto (lib/leer-oficina.ts)', ok: texto.length > 0, detalle: `${texto.length} caracteres` });
  const e = textosEsperados(s, !s.carta);
  c.push(todos('títulos y párrafos', [...e.parrafos, ...e.secciones], texto));
  if (e.cabeceras.length) c.push(todos('cabeceras de tabla', e.cabeceras, texto));
  if (e.celdas.length) c.push(todos('celdas de tabla', e.celdas, texto));
  const doc = (await zip.file('word/document.xml')?.async('text')) || '';
  if (s.secciones.some((x) => x.titulo)) c.push({ que: 'encabezados con estilo (navegables y accesibles)', ok: /w:pStyle w:val="Heading1"/.test(doc) });
  const core = (await zip.file('docProps/core.xml')?.async('text')) || '';
  const tituloCore = desescaparXml(/<dc:title>([\s\S]*?)<\/dc:title>/.exec(core)?.[1] || '');
  c.push({ que: 'título en las propiedades del documento', ok: compacto(tituloCore) === compacto(s.titulo) });
  const estilos = (await zip.file('word/styles.xml')?.async('text')) || '';
  c.push({ que: 'idioma español (es-HN) declarado', ok: /w:lang w:val="es-HN"/.test(estilos) });
  return c;
}

async function semanticaPdf(s: EspecTexto, datos: Buffer): Promise<{ comprobaciones: Comprobacion[]; paginas?: number }> {
  const c: Comprobacion[] = [];
  const leido = await textoPorPaginas(datos, 30_000);
  if (!leido) return { comprobaciones: [{ que: 'se abre con pdf.js', ok: false, detalle: 'pdf.js no pudo abrirlo' }] };
  const texto = leido.paginas.join('\n');
  c.push({ que: 'se abre con pdf.js y se relee el texto', ok: texto.trim().length > 0, detalle: `${leido.total} página(s), ${texto.length} caracteres` });
  const e = textosEsperados(s, true);
  // Lo que el PDF no puede mostrar (fuera de WinAnsi) se dice como tal: no es «se perdió al releer».
  const invisibles = [...new Set([...e.parrafos, ...e.secciones, ...e.celdas].flatMap((t) => [...t].filter((ch, i, xs) => textoVisiblePdf(ch) === '?' && ch !== '?' && xs.indexOf(ch) === i)))];
  if (invisibles.length) c.push({ que: 'caracteres que el PDF puede mostrar', ok: false, detalle: `no puede mostrar: ${invisibles.slice(0, 8).join(' ')}` });
  c.push(todos('títulos y párrafos', e.parrafos, texto, textoVisiblePdf));
  // lib/pdf.ts escribe los títulos de sección en mayúsculas: se comparan así.
  if (e.secciones.length) c.push(todos('títulos de sección', e.secciones, texto, (x) => textoVisiblePdf(x.toUpperCase())));
  // En una tabla, una celda larga se parte en varias líneas que pdf.js intercala con las de sus vecinas: cada PALABRA.
  if (e.celdas.length) c.push(todos('celdas de tabla (palabra por palabra)', e.celdas.flatMap((x) => x.split(/\s+/)).filter(Boolean), texto, textoVisiblePdf));
  // Una cabecera más ancha que su columna se recorta con «…»: basta su comienzo.
  if (e.cabeceras.length) c.push(todos('cabeceras de tabla (su comienzo)', e.cabeceras.map((x) => [...x].slice(0, 4).join('')), texto, textoVisiblePdf));
  return { comprobaciones: c, paginas: leido.total };
}

const valorNumero = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const resultado = (cell: ExcelJS.Cell): number | null => {
  const v = cell.value as any;
  return v && typeof v === 'object' && 'result' in v ? valorNumero(v.result) : null;
};
const formula = (cell: ExcelJS.Cell): string | null => {
  const v = cell.value as any;
  return v && typeof v === 'object' && typeof v.formula === 'string' ? v.formula : v && typeof v === 'object' && typeof v.sharedFormula === 'string' ? `(compartida) ${v.sharedFormula}` : null;
};
const texto = (cell: ExcelJS.Cell): string => {
  const v = cell.value as any;
  if (v === null || v === undefined) return '';
  if (typeof v === 'object' && Array.isArray(v.richText)) return v.richText.map((r: any) => r.text).join('');
  return String(v);
};

async function semanticaXlsx(h: EspecHoja, datos: Buffer): Promise<Comprobacion[]> {
  const c: Comprobacion[] = [];
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(datos as any);
  } catch (e: any) {
    return [{ que: 'ExcelJS vuelve a abrir el libro', ok: false, detalle: String(e?.message || e).slice(0, 120) }];
  }
  const ws = wb.getWorksheet(HOJA_PRESUPUESTO);
  c.push({ que: `hoja «${HOJA_PRESUPUESTO}»`, ok: !!ws && wb.worksheets.length === 1, detalle: `${wb.worksheets.length} hoja(s)` });
  if (!ws) return c;
  const d = disposicionHoja(h);
  const t = calcularTotales(h);
  const esperadas = formulasHoja(h, d);
  c.push({ que: 'título', ok: texto(ws.getCell('A1')) === celdaSegura(h.titulo) });

  // Cada partida: concepto, cantidad, precio, fórmula del importe y su valor; y el importe recalculado desde lo releído.
  const malas: string[] = [];
  const importesReleidos: number[] = [];
  h.partidas.forEach((p, i) => {
    const r = d.primera + i;
    const fila = ws.getRow(r);
    const cant = valorNumero(fila.getCell(4).value);
    const precio = valorNumero(fila.getCell(5).value);
    const imp = resultado(fila.getCell(6));
    const problemas: string[] = [];
    if (texto(fila.getCell(2)) !== celdaSegura(p.concepto)) problemas.push('concepto');
    if (cant !== p.cantidad) problemas.push('cantidad');
    if (precio !== p.precio_unitario) problemas.push('precio');
    if (formula(fila.getCell(6)) !== esperadas[`F${r}`]) problemas.push('fórmula del importe');
    if (imp === null || Math.round(imp * 100) !== t.importes[i]) problemas.push('importe');
    if (cant !== null && precio !== null && imp !== null && importeCentavos(cant, precio) !== Math.round(imp * 100)) problemas.push('importe ≠ cantidad × precio releídos');
    importesReleidos.push(imp === null ? NaN : Math.round(imp * 100));
    if (problemas.length) malas.push(`fila ${r} (${problemas.join(', ')})`);
  });
  c.push({ que: 'partidas (concepto, cantidad, precio, fórmula e importe)', ok: !malas.length, detalle: malas.length ? malas.slice(0, 4).join('; ') : `${h.partidas.length} de ${h.partidas.length}` });

  // Los totales: la fórmula exacta, el valor escrito y el valor vuelto a calcular desde lo releído.
  const subR = importesReleidos.reduce((a, b) => a + b, 0);
  const descR = d.descuento ? Math.round(Number((resultado(ws.getCell(`F${d.descuento}`)) ?? NaN) * 100)) : 0;
  const impR = d.impuesto ? Math.round(Number((resultado(ws.getCell(`F${d.impuesto}`)) ?? NaN) * 100)) : 0;
  const filas: Array<[string, number | null, number, number]> = [
    ['subtotal', d.subtotal, t.subtotal, subR],
    ['descuento', d.descuento, t.descuento, d.descuento ? entero((subR * h.descuento_porcentaje!) / 100) : 0],
    ['impuesto', d.impuesto, t.impuesto, d.impuesto ? entero(((subR - descR) * h.impuesto!.porcentaje) / 100) : 0],
    ['total', d.total, t.total, subR - descR + impR],
  ];
  for (const [que, r, calculado, recalculado] of filas) {
    if (!r) continue;
    const cell = ws.getCell(`F${r}`);
    const escrito = resultado(cell);
    const ok = formula(cell) === esperadas[`F${r}`] && escrito !== null && Math.round(escrito * 100) === calculado && recalculado === calculado;
    c.push({ que: `${que}: fórmula, valor y recálculo`, ok, detalle: ok ? dinero(calculado, h.moneda) : `fórmula ${formula(cell) ?? '(ninguna)'}, escrito ${escrito ?? '(nada)'}, calculado ${calculado / 100}, recalculado ${recalculado / 100}` });
  }

  // Nada más es fórmula, y ningún texto empieza como fórmula sin neutralizar.
  const extrañas: string[] = [];
  const peligrosos: string[] = [];
  ws.eachRow({ includeEmpty: false }, (row) =>
    row.eachCell({ includeEmpty: false }, (cell) => {
      const f = formula(cell);
      if (f !== null && esperadas[cell.address] !== f) extrañas.push(cell.address);
      if (f === null && typeof cell.value === 'string' && /^[=+\-@\t\r]/.test(cell.value)) peligrosos.push(cell.address);
    })
  );
  c.push({ que: 'solo las fórmulas del presupuesto', ok: !extrañas.length, detalle: extrañas.length ? `fórmulas inesperadas en ${extrañas.slice(0, 5).join(', ')}` : `${Object.keys(esperadas).length} fórmulas` });
  c.push({ que: 'sin inyección de fórmulas en textos', ok: !peligrosos.length, ...(peligrosos.length ? { detalle: `textos que empiezan como fórmula en ${peligrosos.slice(0, 5).join(', ')}` } : {}) });

  // Un segundo lector, independiente de ExcelJS (lib/leer-oficina.ts): los conceptos y el total escrito están en el XML.
  const pags = await paginasDeXlsx(datos).catch(() => []);
  const crudo = pags.map((p) => p.texto).join('\n');
  c.push(todos('conceptos releídos con lib/leer-oficina.ts', h.partidas.map((p) => celdaSegura(p.concepto)), crudo));
  c.push({ que: 'total escrito releído con lib/leer-oficina.ts', ok: crudo.split(/[\s|]+/).includes(String(t.total / 100)) });
  return c;
}

/** Los valores de una lista de puntos de un gráfico (`<c:pt idx><c:v>…</c:v></c:pt>`), en el orden de su idx. */
function puntos(xml: string): string[] {
  const out: string[] = [];
  for (const m of xml.matchAll(/<c:pt\b[^>]*\bidx="(\d+)"[^>]*>\s*<c:v>([\s\S]*?)<\/c:v>/g)) out[Number(m[1])] = desescaparXml(m[2]);
  return out;
}

const ELEMENTO_GRAFICO = { barras: 'c:barChart', lineas: 'c:lineChart', pastel: 'c:pieChart' } as const;

/**
 * La presentación, releída: el texto con lib/leer-oficina.ts (paginasDePptx, el lector de lo que LLEGA, que no comparte
 * código con PptxGenJS) diapositiva por diapositiva y en su orden; las tablas y los gráficos desde su XML (celda por
 * celda; cada serie con sus categorías y valores), la numeración, el título de cada diapositiva en su marcador, el
 * texto alternativo de cada gráfico, las propiedades y el idioma.
 */
async function semanticaPptx(e: EspecPresentacion, datos: Buffer, zip: JSZip): Promise<{ comprobaciones: Comprobacion[]; paginas: number }> {
  const c: Comprobacion[] = [];
  const n = e.diapositivas.length;
  const { partes } = await diapositivasDe(zip);
  const leidas = await paginasDePptx(datos);
  const porPagina = new Map(leidas.map((p) => [p.pagina, p.texto]));
  c.push({ que: 'número de diapositivas (releídas con lib/leer-oficina.ts)', ok: partes.length === n && leidas.length === n, detalle: `${partes.length} en el archivo, ${leidas.length} con texto, ${n} pedidas en la especificación` });
  if (e.diapositivas_pedidas !== undefined) c.push({ que: `las ${e.diapositivas_pedidas} diapositivas que pidió la persona`, ok: partes.length === e.diapositivas_pedidas, detalle: `tiene ${partes.length}` });

  const faltanTexto: string[] = [];
  const faltanNotas: string[] = [];
  const faltanCeldas: string[] = [];
  const tablasMal: string[] = [];
  const graficosMal: string[] = [];
  const sinNumero: number[] = [];
  const sinTitulo: number[] = [];
  const sinAlt: number[] = [];
  let tablas = 0;
  let graficos = 0;
  for (const [i, d] of e.diapositivas.entries()) {
    const k = i + 1;
    const parte = partes[i];
    const xml = parte ? (await zip.file(parte)?.async('text')) || '' : '';
    const leido = porPagina.get(k) || '';
    const [cuerpo, notas = ''] = leido.split(/\n\nNotas: /);
    const esperado = textosDiapositiva(d);
    const hay = compacto(cuerpo);
    for (const t of esperado.textos) if (!hay.includes(compacto(t))) faltanTexto.push(`diapositiva ${k}: «${corto(t, 40)}»`);
    if (d.notas && !compacto(notas).includes(compacto(d.notas))) faltanNotas.push(`diapositiva ${k}`);
    // El título va en el marcador de título (type="title", con el idx 0 implícito que buscan los lectores), no en una
    // caja cualquiera.
    if (d.titulo) {
      const ph = /<p:sp>(?:(?!<\/p:sp>)[\s\S])*?<p:ph\b[^>]*\btype="title"[\s\S]*?<\/p:sp>/.exec(xml)?.[0] || '';
      const marca = /<p:ph\b[^>]*>/.exec(ph)?.[0] || '';
      const textoPh = [...ph.matchAll(/<a:t>([\s\S]*?)<\/a:t>/g)].map((m) => desescaparXml(m[1])).join('');
      if (compacto(textoPh) !== compacto(d.titulo) || /\bidx="(?!0")\d+"/.test(marca)) sinTitulo.push(k);
    }
    if (d.tipo !== 'portada' && d.tipo !== 'cierre' && !/<a:fld\b[^>]*\btype="slidenum"/.test(xml)) sinNumero.push(k);
    if (d.tabla) {
      tablas++;
      const tbl = /<a:tbl>([\s\S]*?)<\/a:tbl>/.exec(xml)?.[1] || '';
      const filas = [...tbl.matchAll(/<a:tr\b[\s\S]*?<\/a:tr>/g)].map((m) => [...m[0].matchAll(/<a:tc\b[\s\S]*?<\/a:tc>/g)].map((x) => [...x[0].matchAll(/<a:t>([\s\S]*?)<\/a:t>/g)].map((t) => desescaparXml(t[1])).join('')));
      const esperadas = [d.tabla.cabecera, ...d.tabla.filas];
      if (filas.length !== esperadas.length || filas.some((f) => f.length !== d.tabla!.cabecera.length)) tablasMal.push(`diapositiva ${k}: ${filas.length} filas × ${filas[0]?.length ?? 0} columnas (pedidas ${esperadas.length} × ${d.tabla.cabecera.length})`);
      else esperadas.forEach((f, r) => f.forEach((cel, col) => compacto(filas[r][col]) !== compacto(cel) && faltanCeldas.push(`diapositiva ${k}, fila ${r + 1}, columna ${col + 1}: «${corto(cel, 30)}»`)));
    }
    if (d.grafico) {
      graficos++;
      const g = d.grafico;
      const rels = parte ? await relacionesDe(zip, parte) : {};
      const rel = Object.values(rels).find((r) => r.tipo === 'chart');
      const cx = rel ? (await zip.file(rel.destino)?.async('text')) || '' : '';
      const sers = [...cx.matchAll(/<c:ser>([\s\S]*?)<\/c:ser>/g)].map((m) => m[1]);
      const problemas: string[] = [];
      if (!cx) problemas.push('no tiene el gráfico');
      else {
        if (!cx.includes(`<${ELEMENTO_GRAFICO[g.tipo]}>`)) problemas.push(`no es de ${g.tipo}`);
        if (sers.length !== g.series.length) problemas.push(`${sers.length} series (pedidas ${g.series.length})`);
        g.series.forEach((s, j) => {
          const ser = sers[j] || '';
          const nombre = puntos(/<c:tx>([\s\S]*?)<\/c:tx>/.exec(ser)?.[1] || '')[0] || '';
          const cats = puntos(/<c:cat>([\s\S]*?)<\/c:cat>/.exec(ser)?.[1] || '');
          const vals = puntos(/<c:val>([\s\S]*?)<\/c:val>/.exec(ser)?.[1] || '').map(Number);
          if (compacto(nombre) !== compacto(s.nombre)) problemas.push(`serie ${j + 1} se llama «${corto(nombre, 20)}»`);
          if (cats.length !== g.categorias.length || cats.some((x, q) => compacto(x) !== compacto(g.categorias[q]))) problemas.push(`serie ${j + 1}: categorías distintas`);
          if (vals.length !== s.valores.length || vals.some((v, q) => !(Math.abs(v - s.valores[q]) <= 1e-9 * Math.max(1, Math.abs(s.valores[q]))))) problemas.push(`serie ${j + 1}: valores distintos`);
        });
      }
      if (problemas.length) graficosMal.push(`diapositiva ${k}: ${problemas.slice(0, 3).join(', ')}`);
      if (!/<p:cNvPr\b[^>]*\bdescr="[^"]{10,}"/.test(xml)) sinAlt.push(k);
    }
  }
  c.push({ que: 'títulos, viñetas, cifras y citas en SU diapositiva', ok: !faltanTexto.length, detalle: faltanTexto.length ? `faltan ${faltanTexto.length}: ${faltanTexto.slice(0, 3).join('; ')}` : `${n} de ${n} diapositivas completas` });
  if (e.diapositivas.some((d) => d.notas)) c.push({ que: 'notas del orador', ok: !faltanNotas.length, ...(faltanNotas.length ? { detalle: `faltan en ${faltanNotas.join(', ')}` } : {}) });
  c.push({ que: 'cada título en el marcador de título (navegable y accesible)', ok: !sinTitulo.length, ...(sinTitulo.length ? { detalle: `diapositivas ${sinTitulo.join(', ')}` } : {}) });
  c.push({ que: 'numeración de diapositivas', ok: !sinNumero.length, ...(sinNumero.length ? { detalle: `sin número: ${sinNumero.join(', ')}` } : {}) });
  if (tablas) c.push({ que: 'tablas con todas sus celdas', ok: !tablasMal.length && !faltanCeldas.length, detalle: tablasMal.length ? tablasMal.slice(0, 2).join('; ') : faltanCeldas.length ? `celdas distintas: ${faltanCeldas.slice(0, 3).join('; ')}` : `${tablas} tabla(s)` });
  if (graficos) {
    c.push({ que: 'gráficos con sus series, categorías y valores', ok: !graficosMal.length, detalle: graficosMal.length ? graficosMal.slice(0, 2).join('; ') : `${graficos} gráfico(s)` });
    c.push({ que: 'texto alternativo en cada gráfico', ok: !sinAlt.length, ...(sinAlt.length ? { detalle: `sin él: diapositivas ${sinAlt.join(', ')}` } : {}) });
  }
  const core = (await zip.file('docProps/core.xml')?.async('text')) || '';
  const tituloCore = desescaparXml(/<dc:title>([\s\S]*?)<\/dc:title>/.exec(core)?.[1] || '');
  c.push({ que: 'título en las propiedades de la presentación', ok: compacto(tituloCore) === compacto(e.titulo) });
  const primera = partes[0] ? (await zip.file(partes[0])?.async('text')) || '' : '';
  c.push({ que: 'idioma español (es-HN) declarado', ok: /\blang="es-HN"/.test(primera) });
  return { comprobaciones: c, paginas: partes.length };
}

/* ------------------------------------------------------------------ render (LibreOffice) */

function enPath(bin: string): string | null {
  if (bin.includes('/')) return fs.existsSync(bin) ? bin : null;
  for (const dir of String(process.env.PATH || '').split(':')) {
    const f = path.join(dir, bin);
    try {
      fs.accessSync(f, fs.constants.X_OK);
      return f;
    } catch {
      /* sigue */
    }
  }
  return null;
}

/** ¿Hay LibreOffice para renderizar? (`AURA_SOFFICE` o `soffice` en el PATH; `AURA_SOFFICE=off` lo apaga). */
export function libreOfficeDisponible(): string | null {
  const b = String(process.env.AURA_SOFFICE || 'soffice').trim();
  if (!b || b === 'off') return null;
  return enPath(b);
}

/**
 * Lo convierte a PDF con LibreOffice sin cabeza: perfil temporal propio (nada del usuario del servidor, sin macros
 * guardadas), sin restaurar ni asistente, con tope de tiempo (se mata al vencer) y todo en una carpeta temporal que se
 * borra al final. Lo que se generó aquí no trae macros ni enlaces de afuera (lo comprueba la estructura).
 */
export async function renderizar(datos: Buffer, ext: TipoArchivo, topeMs = 45_000): Promise<Render> {
  const bin = libreOfficeDisponible();
  if (!bin) return { estado: 'omitido', detalle: 'no hay LibreOffice en este servidor' };
  if (ext === 'pdf') return { estado: 'omitido', detalle: 'ya es PDF: lo abrió pdf.js' };
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aura-render-'));
  const t0 = Date.now();
  let aviso = '';
  try {
    const entrada = path.join(dir, `entrada.${ext}`);
    fs.writeFileSync(entrada, datos);
    const salida = path.join(dir, 'salida');
    await new Promise<void>((resolve, reject) => {
      execFile(
        bin,
        ['--headless', '--norestore', '--nolockcheck', '--nodefault', '--nofirststartwizard', `-env:UserInstallation=file://${path.join(dir, 'perfil')}`, '--convert-to', 'pdf', '--outdir', salida, entrada],
        { timeout: topeMs, killSignal: 'SIGKILL', env: { PATH: process.env.PATH || '/usr/bin:/bin', HOME: dir, LANG: 'es_HN.UTF-8' } },
        (err, _out, errOut) => {
          aviso = String(errOut || '').split('\n').filter((l) => l && !/javaldx/.test(l)).join(' ').slice(0, 160);
          return err ? reject(err) : resolve();
        }
      );
    });
    const pdf = path.join(salida, 'entrada.pdf');
    // «source file could not be loaded» con un archivo que ya pasó la estructura y la relectura suele ser un LibreOffice
    // sin Writer/Calc (solo el núcleo): se dice tal cual, no se adivina.
    if (!fs.existsSync(pdf)) return { estado: 'fallido', motor: 'LibreOffice', ms: Date.now() - t0, detalle: `LibreOffice no produjo el PDF${aviso ? ` (${aviso})` : ''}` };
    const b = fs.readFileSync(pdf);
    const paginas = (b.toString('latin1').match(/\/Type\s*\/Page(?![s\w])/g) || []).length;
    return paginas
      ? { estado: 'hecho', motor: 'LibreOffice', paginas, ms: Date.now() - t0, detalle: `abre en LibreOffice: ${paginas} página(s) (su render no es idéntico al de Microsoft Office)` }
      : { estado: 'fallido', motor: 'LibreOffice', ms: Date.now() - t0, detalle: 'el PDF de LibreOffice no tiene páginas' };
  } catch (e: any) {
    return { estado: 'fallido', motor: 'LibreOffice', ms: Date.now() - t0, detalle: e?.killed ? `LibreOffice no terminó en ${Math.round(topeMs / 1000)} s` : String(e?.message || e).slice(0, 120) };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/* ------------------------------------------------------------------ todo junto */

/** La huella de unos bytes (sha256 en hex). */
export const sha256 = (b: Buffer) => crypto.createHash('sha256').update(b).digest('hex');

/**
 * Valida un archivo generado contra SU especificación. Si la estructura falla, la semántica no se intenta (no hay qué
 * releer). `renderizar`: además lo abre LibreOffice (si lo hay; si no, queda «omitido» y se dice).
 */
export async function validarArchivo(a: ArchivoPedido, datos: Buffer, o: { renderizar?: boolean } = {}): Promise<Validacion> {
  const tipoReal = await tipoPorDentro(datos);
  const defectos: string[] = [];
  if (!datos.length) defectos.push('está vacío');
  if (datos.length > TOPES.bytes) defectos.push(`pesa ${datos.length} bytes (máximo ${TOPES.bytes})`);
  if (tipoReal !== a.tipo) defectos.push(`por dentro no es ${a.tipo} (es ${tipoReal})`);
  let zip: JSZip | null = null;
  let paginas: number | undefined;
  if (a.tipo === 'pdf') {
    const e = estructuraPdf(datos);
    defectos.push(...e.defectos);
    paginas = e.paginas;
  } else {
    const e = await estructuraOoxml(datos, a.tipo);
    defectos.push(...e.defectos);
    zip = e.zip;
  }
  const estructural = { ok: !defectos.length, defectos: [...new Set(defectos)] };
  if (!estructural.ok) return { tipoReal, estructural, semantico: { ok: false, comprobaciones: [{ que: 'semántica', ok: false, detalle: 'no se intentó: la estructura falló' }] } };
  let comprobaciones: Comprobacion[];
  try {
    if (a.tipo === 'docx') comprobaciones = await semanticaDocx(a.spec, datos, zip!);
    else if (a.tipo === 'xlsx') comprobaciones = await semanticaXlsx(a.spec, datos);
    else if (a.tipo === 'pptx') {
      const r = await semanticaPptx(a.spec, datos, zip!);
      comprobaciones = r.comprobaciones;
      paginas = r.paginas;
    } else {
      const r = await semanticaPdf(a.spec, datos);
      comprobaciones = r.comprobaciones;
      paginas = r.paginas ?? paginas;
    }
  } catch (e: any) {
    comprobaciones = [{ que: 'relectura', ok: false, detalle: String(e?.message || e).slice(0, 120) }];
  }
  const semantico = { ok: comprobaciones.length > 0 && comprobaciones.every((c) => c.ok), comprobaciones };
  let render = o.renderizar && semantico.ok ? await renderizar(datos, a.tipo) : undefined;
  // Una presentación sale de LibreOffice con una página por diapositiva: si no, se dice (sus páginas son las diapositivas).
  if (a.tipo === 'pptx' && render?.estado === 'hecho' && render.paginas !== paginas) render = { ...render, estado: 'fallido', detalle: `LibreOffice sacó ${render.paginas} página(s) y la presentación tiene ${paginas} diapositiva(s)` };
  if (render?.paginas && a.tipo !== 'pdf' && a.tipo !== 'pptx') paginas = render.paginas;
  return { tipoReal, estructural, semantico, ...(paginas !== undefined ? { paginas } : {}), ...(render ? { render } : {}) };
}
