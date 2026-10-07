/**
 * FILE-01: generar (docx, ExcelJS, lib/pdf.ts) y validar (lib/oficina/validar.ts). Un ZIP válido o unas celdas no vacías
 * no prueban nada: cada archivo se relee con un lector independiente y se compara con lo pedido; los totales del
 * presupuesto se vuelven a calcular desde lo releído. Aquí también se prueba que la validación SÍ detecta lo malo:
 * un ZIP cortado, un total alterado, una fórmula colada, un párrafo que falta, un enlace de afuera.
 */
import './datos-prueba'; // la junta inventada de las pruebas (lo real vive en Render)
import test from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import { DOMParser } from '@xmldom/xmldom';
import { paginasDeDocx, paginasDeXlsx } from '../lib/leer-oficina';
import { textoPorPaginas } from '../lib/leer-pdf-pdfjs';
import { disposicionHoja, generarArchivo, generarDocx, generarPdf, generarXlsx } from '../lib/oficina/generar';
import { validarPedido, type ArchivoPedido, type EspecHoja } from '../lib/oficina/spec';
import { libreOfficeDisponible, renderizar, tipoPorDentro, validarArchivo } from '../lib/oficina/validar';

const INFORME = {
  tipo: 'docx',
  nombre: 'informe.docx',
  spec: {
    titulo: 'Informe de avance de obra',
    subtitulo: 'Ampliación del almacén de Comayagüela — octubre de 2026',
    autor: 'Orden Global',
    secciones: [
      { titulo: 'Resumen', parrafos: ['La obra avanzó un 40 % según el cronograma; la cimentación está terminada y los muros van al 60 %.'] },
      { titulo: 'Pendientes', vinetas: ['Instalar la cubierta metálica', 'Pedir la inspección de bomberos'] },
      { titulo: 'Costos a la fecha', tabla: { cabecera: ['Rubro', 'Monto (L)'], filas: [['Materiales de construcción y acarreo', '80,000.00'], ['Mano de obra', '45,400.00']] } },
    ],
  },
};
const PRESUPUESTO = {
  tipo: 'xlsx',
  nombre: 'presupuesto.xlsx',
  spec: {
    titulo: 'Presupuesto de ampliación',
    cliente: 'Comercial López S. de R.L.',
    fecha: '6 de octubre de 2026',
    moneda: 'L',
    partidas: [
      { concepto: 'Cemento gris', unidad: 'bolsa', cantidad: 120, precio_unitario: 245.5 },
      { concepto: 'Varilla de 3/8"', unidad: 'quintal', cantidad: 8, precio_unitario: 1890 },
      { concepto: '=HYPERLINK("http://malo.example")', unidad: 'u', cantidad: 3, precio_unitario: 0.1 },
    ],
    impuesto: { nombre: 'ISV', porcentaje: 15 },
    descuento_porcentaje: 5,
    notas: ['Precios sin transporte.', '+ válido por 15 días'],
  },
};
const CARTA = {
  tipo: 'pdf',
  nombre: 'carta.pdf',
  spec: {
    carta: {
      lugar_fecha: 'Tegucigalpa, 6 de octubre de 2026',
      destinatario: ['Sra. Ana López', 'Gerente de Compras', 'Comercial López S. de R.L.'],
      asunto: 'Presupuesto de ampliación del almacén',
      saludo: 'Estimada señora López:',
      cuerpo: ['Le envío el presupuesto «actualizado» de la ampliación, con el ISV incluido y un descuento del 5 %.', '¿Podríamos reunirnos el lunes para revisarlo? ¡Gracias de antemano!'],
      despedida: 'Atentamente,',
      firma: ['José Villeda', 'Orden Global'],
    },
  },
};

function uno(x: unknown): ArchivoPedido {
  const r = validarPedido(x);
  assert.deepEqual(r.errores, []);
  return r.archivos[0];
}

async function reZip(datos: Buffer, cambiar: (zip: JSZip) => Promise<void>): Promise<Buffer> {
  const zip = await JSZip.loadAsync(datos);
  await cambiar(zip);
  return zip.generateAsync({ type: 'nodebuffer' });
}

test('Word: se genera, es un ZIP de Office con XML válido, y se relee entero (títulos, viñetas, tabla, idioma)', async () => {
  const a = uno(INFORME);
  const b = await generarArchivo(a);
  assert.equal(await tipoPorDentro(b), 'docx');
  // Chequeo zip + XML independiente del validador.
  const zip = await JSZip.loadAsync(b);
  for (const p of ['[Content_Types].xml', '_rels/.rels', 'word/document.xml', 'word/styles.xml', 'docProps/core.xml']) assert.ok(zip.file(p), p);
  for (const n of Object.keys(zip.files).filter((x) => /\.(xml|rels)$/.test(x))) {
    new DOMParser({ onError: (nivel: string, m: string) => { if (nivel !== 'warning') throw new Error(`${n}: ${m}`); } }).parseFromString(await zip.file(n)!.async('text'), 'text/xml');
  }
  const texto = (await paginasDeDocx(b)).map((p) => p.texto).join('\n');
  assert.match(texto, /Informe de avance de obra/);
  assert.match(texto, /Comayagüela/);
  assert.match(texto, /Instalar la cubierta metálica/);
  assert.match(texto, /Mano de obra\s+45,400\.00/);
  const v = await validarArchivo(a, b);
  assert.equal(v.estructural.ok, true, JSON.stringify(v.estructural));
  assert.equal(v.semantico.ok, true, JSON.stringify(v.semantico));
  assert.ok(v.semantico.comprobaciones.some((c) => /encabezados con estilo/.test(c.que) && c.ok));
  assert.ok(v.semantico.comprobaciones.some((c) => /es-HN/.test(c.que) && c.ok));
});

test('Excel: totales calculados en código, escritos como valor Y fórmula, y verificados al releer con ExcelJS y con leer-oficina', async () => {
  const a = uno(PRESUPUESTO);
  assert.equal(a.tipo, 'xlsx');
  const h = a.spec as EspecHoja;
  const b = await generarArchivo(a);
  const v = await validarArchivo(a, b);
  assert.equal(v.estructural.ok, true, JSON.stringify(v.estructural));
  assert.equal(v.semantico.ok, true, JSON.stringify(v.semantico.comprobaciones.filter((c) => !c.ok)));

  // Relectura independiente en la prueba: cantidades × precios → importes → subtotal → descuento → ISV → total.
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(b as any);
  const ws = wb.getWorksheet('Presupuesto')!;
  const d = disposicionHoja(h);
  let sub = 0;
  for (let r = d.primera; r <= d.ultima; r++) {
    const cant = ws.getCell(`D${r}`).value as number;
    const precio = ws.getCell(`E${r}`).value as number;
    const f = ws.getCell(`F${r}`).value as { formula: string; result: number };
    assert.equal(f.formula, `ROUND(D${r}*E${r},2)`);
    assert.equal(Math.round(f.result * 100), Math.round(cant * precio * 100));
    sub += Math.round(f.result * 100);
  }
  const val = (fila: number | null) => (ws.getCell(`F${fila}`).value as { result: number }).result;
  assert.equal(Math.round(val(d.subtotal) * 100), sub);
  assert.equal(sub, 4_458_030); // 29 460 + 15 120 + 0,30
  const desc = Math.round(sub * 0.05);
  assert.equal(Math.round(val(d.descuento) * 100), desc);
  const isv = Math.round((sub - desc) * 0.15);
  assert.equal(Math.round(val(d.impuesto) * 100), isv);
  assert.equal(val(d.total), (sub - desc + isv) / 100);
  assert.equal(val(d.total), 48_703.97);
  // El texto que parecía fórmula quedó como texto (neutralizado), no como fórmula.
  assert.equal(ws.getCell(`B${d.primera + 2}`).value, `'=HYPERLINK("http://malo.example")`);
  assert.equal(ws.getCell(`B${d.notas! + 2}`).value, `'+ válido por 15 días`);
  // El otro lector (leer-oficina, sin ExcelJS) ve los conceptos y el total escrito.
  const crudo = (await paginasDeXlsx(b)).map((p) => p.texto).join('\n');
  assert.match(crudo, /Cemento gris/);
  assert.match(crudo, /48703\.97/);
  const libro = await (await JSZip.loadAsync(b)).file('xl/workbook.xml')!.async('text');
  assert.match(libro, /<calcPr[^>]*fullCalcOnLoad="1"/, 'Excel/LibreOffice recalculan al abrir');
});

test('PDF: lib/pdf.ts multipágina, se abre con pdf.js y está todo el texto de la carta en español', async () => {
  const a = uno(CARTA);
  const b = await generarArchivo(a);
  assert.equal(b.subarray(0, 5).toString('latin1'), '%PDF-');
  const leido = await textoPorPaginas(b);
  assert.ok(leido && leido.total >= 1);
  const texto = leido!.paginas.join('\n');
  assert.match(texto, /Estimada señora López:/);
  assert.match(texto, /¿Podríamos reunirnos el lunes/);
  assert.match(texto, /«actualizado»/);
  const v = await validarArchivo(a, b);
  assert.equal(v.estructural.ok, true, JSON.stringify(v.estructural));
  assert.equal(v.semantico.ok, true, JSON.stringify(v.semantico));
  assert.equal(v.paginas, 1);
  // Viñetas y tablas en el PDF: la viñeta es la de WinAnsi (no «?»).
  const informePdf = uno({ ...INFORME, tipo: 'pdf', nombre: 'informe.pdf' });
  const bp = await generarArchivo(informePdf);
  const vp = await validarArchivo(informePdf, bp);
  assert.equal(vp.semantico.ok, true, JSON.stringify(vp.semantico.comprobaciones.filter((c) => !c.ok)));
  assert.match((await textoPorPaginas(bp))!.paginas.join('\n'), /• Instalar la cubierta metálica/);
});

test('la validación detecta lo malo: ZIP cortado, tipo cambiado, total alterado, fórmula colada, enlace de afuera', async () => {
  const doc = uno(INFORME);
  const bDoc = await generarArchivo(doc);
  const cortado = bDoc.subarray(0, Math.floor(bDoc.length / 2));
  const v1 = await validarArchivo(doc, cortado);
  assert.equal(v1.estructural.ok, false);
  assert.equal(v1.semantico.ok, false);

  const pdf = uno(CARTA);
  const v2 = await validarArchivo(doc, generarPdf(pdf.spec as any));
  assert.equal(v2.estructural.ok, false);
  assert.match(v2.estructural.defectos.join(' '), /por dentro no es docx \(es pdf\)/);

  const xl = uno(PRESUPUESTO);
  const h = xl.spec as EspecHoja;
  const bXl = await generarXlsx(h);
  const d = disposicionHoja(h);
  // Un total alterado en el XML (el valor guardado ya no es el calculado).
  const alterado = await reZip(bXl, async (z) => {
    const f = 'xl/worksheets/sheet1.xml';
    const xml = await z.file(f)!.async('text');
    z.file(f, xml.replace(/(<c r="F\d+"[^>]*><f>F\d+-F\d+\+F\d+<\/f><v>)([^<]+)(<\/v>)/, '$11.00$3'));
  });
  const v3 = await validarArchivo(xl, alterado);
  assert.equal(v3.estructural.ok, true);
  assert.equal(v3.semantico.ok, false);
  assert.match(JSON.stringify(v3.semantico.comprobaciones.filter((c) => !c.ok)), /total/);

  // Una fórmula colada en una celda que no es del presupuesto.
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(bXl as any);
  wb.getWorksheet('Presupuesto')!.getCell(`B${d.total + 5}`).value = { formula: 'WEBSERVICE("http://x")', result: 0 } as any;
  wb.getWorksheet('Presupuesto')!.getCell(`C${d.total + 6}`).value = '=1+1';
  const colado = Buffer.from((await wb.xlsx.writeBuffer()) as ArrayBuffer);
  const v4 = await validarArchivo(xl, colado);
  const malas = v4.semantico.comprobaciones.filter((c) => !c.ok).map((c) => c.que).join(' | ');
  assert.match(malas, /solo las fórmulas del presupuesto/);
  assert.match(malas, /sin inyección de fórmulas/);

  // Una relación hacia una dirección de afuera (un documento que «llama a casa» al abrirse).
  const externo = await reZip(bDoc, async (z) => {
    const f = 'word/_rels/document.xml.rels';
    const xml = await z.file(f)!.async('text');
    z.file(f, xml.replace('</Relationships>', '<Relationship Id="rIdX" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="http://malo.example/x.png" TargetMode="External"/></Relationships>'));
  });
  const v5 = await validarArchivo(doc, externo);
  assert.equal(v5.estructural.ok, false);
  assert.match(v5.estructural.defectos.join(' '), /dirección de afuera/);

  // Un XML roto dentro de un ZIP sano.
  const roto = await reZip(bDoc, async (z) => void z.file('word/document.xml', '<w:document><w:body>'));
  const v6 = await validarArchivo(doc, roto);
  assert.equal(v6.estructural.ok, false);
  assert.match(v6.estructural.defectos.join(' '), /no es XML válido/);
});

test('la semántica exige TODO lo pedido: un párrafo que no está en el archivo es un fallo con su cita', async () => {
  const pedido = uno(INFORME);
  const b = await generarDocx(pedido.spec as any);
  const conMas = uno({ ...INFORME, spec: { ...INFORME.spec, secciones: [...INFORME.spec.secciones, { titulo: 'Conclusión', parrafos: ['Este párrafo no está en el archivo.'] }] } });
  const v = await validarArchivo(conMas, b);
  assert.equal(v.estructural.ok, true);
  assert.equal(v.semantico.ok, false);
  assert.match(JSON.stringify(v.semantico.comprobaciones), /Este párrafo no está en el archivo/);
  // En el PDF, lo que WinAnsi no puede mostrar se dice como tal.
  const raro = uno({ tipo: 'pdf', nombre: 'r.pdf', spec: { titulo: 'Prueba', secciones: [{ parrafos: ['Ideograma 漢字 y emoji 🙂'] }] } });
  const vr = await validarArchivo(raro, generarPdf(raro.spec as any));
  assert.equal(vr.semantico.ok, false);
  assert.match(JSON.stringify(vr.semantico.comprobaciones), /no puede mostrar/);
});

test('render: sin LibreOffice queda «omitido»; con LibreOffice completo, abre y cuenta páginas (nunca bloquea en silencio)', async () => {
  const doc = uno(INFORME);
  const b = await generarArchivo(doc);
  const antes = process.env.AURA_SOFFICE;
  process.env.AURA_SOFFICE = 'off';
  try {
    assert.equal(libreOfficeDisponible(), null);
    const r = await renderizar(b, 'docx');
    assert.equal(r.estado, 'omitido');
    const v = await validarArchivo(doc, b, { renderizar: true });
    assert.equal(v.render?.estado, 'omitido');
    assert.equal(v.semantico.ok, true);
  } finally {
    if (antes === undefined) delete process.env.AURA_SOFFICE;
    else process.env.AURA_SOFFICE = antes;
  }
  if (!libreOfficeDisponible()) return;
  // Hay un soffice: o lo abre (hecho, con páginas), o dice por qué no (un LibreOffice sin Writer: «fallido» con su detalle).
  const r = await renderizar(b, 'docx', 60_000);
  assert.ok(r.estado === 'hecho' || r.estado === 'fallido', JSON.stringify(r));
  if (r.estado === 'hecho') assert.ok((r.paginas || 0) >= 1);
  else assert.ok(r.detalle.length > 10);
});

test('contenido difícil: comillas, &, <>, apóstrofos, tabuladores, palabras larguísimas y una tabla de 120 filas (PDF multipágina)', async () => {
  const raro = 'Informe "final" de O\'Brien & Cía <2026> — 100 % ¿sí? ¡ya! • ñandú €';
  const largo = 'Supercalifragilisticoespialidoso'.repeat(4);
  const filas = Array.from({ length: 120 }, (_, i) => [`Fila ${i + 1} con un texto bastante largo para que la celda se parta en varias líneas dentro del PDF`, `${i * 10}`]);
  const texto = { titulo: raro, subtitulo: raro, autor: 'A & B', secciones: [{ titulo: raro, parrafos: [raro, largo, 'Línea con\ttabulador'], vinetas: [raro], tabla: { cabecera: ['Descripción larga de la columna', 'N'], filas } }] };
  const r = validarPedido({
    archivos: [
      { tipo: 'docx', nombre: 'borde.docx', spec: texto },
      { tipo: 'pdf', nombre: 'borde.pdf', spec: texto },
      { tipo: 'xlsx', nombre: 'borde.xlsx', spec: { titulo: raro, cliente: raro, partidas: [{ concepto: raro, unidad: '<u>', cantidad: 1, precio_unitario: 1 }], notas: [raro] } },
    ],
  });
  assert.deepEqual(r.errores, []);
  for (const a of r.archivos) {
    const v = await validarArchivo(a, await generarArchivo(a));
    assert.equal(v.estructural.ok && v.semantico.ok, true, `${a.nombre}: ${JSON.stringify(v.semantico.comprobaciones.filter((c) => !c.ok))}`);
    if (a.tipo === 'pdf') assert.ok((v.paginas || 0) >= 3, 'la tabla se derrama a varias páginas');
  }
});

/*
 * Revisión independiente (MENOR 6): `linea()` dejaba pasar U+FFFE, U+FFFF y mitades sueltas de un par sustituto (un emoji
 * partido, también por el tope). Eso no es XML 1.0: Word, Excel y PowerPoint piden «reparar» el archivo. Es el saneador
 * común: los cuatro tipos salen sin ellos y el emoji entero se conserva.
 */
test('lo que XML 1.0 no admite (U+FFFE, U+FFFF, sustitutos sueltos, un emoji partido por el tope) no llega a ningún archivo', async () => {
  const MALO = /[\uFFFE\uFFFF\uFFFD]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;
  const raro = 'Antes\uFFFE medio\uFFFF y \uD800suelto\uDC00 fin 😀 listo';
  // 199 letras y un emoji: el tope de 200 lo corta por la mitad.
  const partido = `${'T'.repeat(199)}😀`;
  const conTexto = (t: string, titulo: string) => ({ titulo, subtitulo: t, autor: t, secciones: [{ titulo: t, parrafos: [t], vinetas: [t], tabla: { cabecera: [t, 'N'], filas: [[t, '1']] } }] });
  // El PDF (fuentes estándar) no dibuja emojis y la validación ya lo dice: ahí van solo los caracteres que XML no admite.
  const raroPdf = 'Antes\uFFFE medio\uFFFF y \uD800suelto\uDC00 fin listo';
  const r = validarPedido({
    archivos: [
      { tipo: 'docx', nombre: 'nx.docx', spec: conTexto(raro, partido) },
      { tipo: 'pdf', nombre: 'nx.pdf', spec: conTexto(raroPdf, raroPdf) },
      { tipo: 'xlsx', nombre: 'nx.xlsx', spec: { titulo: raro, cliente: raro, partidas: [{ concepto: raro, unidad: 'u', cantidad: 1, precio_unitario: 1 }], notas: [raro] } },
      { tipo: 'pptx', nombre: 'nx.pptx', spec: { titulo: raro, diapositivas: [{ tipo: 'portada', subtitulo: raro }, { tipo: 'vinetas', titulo: raro, vinetas: [raro], notas: `${'n'.repeat(2999)}😀` }] } },
    ],
  });
  assert.deepEqual(r.errores, []);
  const textos: string[] = [];
  const juntar = (v: unknown): void => {
    if (typeof v === 'string') textos.push(v);
    else if (Array.isArray(v)) v.forEach(juntar);
    else if (v && typeof v === 'object') Object.values(v).forEach(juntar);
  };
  juntar(r.archivos.map((a) => a.spec));
  for (const t of textos) assert.doesNotMatch(t, MALO, `quedó en la especificación: ${JSON.stringify(t)}`);
  assert.ok(textos.some((t) => t.includes('fin 😀 listo')), 'el emoji entero se conserva');
  assert.ok(textos.includes('T'.repeat(199)), 'el emoji partido por el tope se va entero, no a medias');
  for (const a of r.archivos) {
    const datos = await generarArchivo(a);
    const v = await validarArchivo(a, datos);
    assert.equal(v.estructural.ok && v.semantico.ok, true, `${a.nombre}: ${JSON.stringify(v.semantico.comprobaciones.filter((c) => !c.ok))}`);
    if (a.tipo === 'pdf') {
      const leido = await textoPorPaginas(datos);
      assert.ok(leido, 'el PDF se relee');
      assert.doesNotMatch(leido!.paginas.join('\n'), /[\uFFFE\uFFFF]/, 'el PDF sin U+FFFE/U+FFFF');
      continue;
    }
    // Cada parte XML del ZIP: UTF-8 válido y solo caracteres de XML 1.0 (un sustituto suelto saldría como U+FFFD).
    const zip = await JSZip.loadAsync(datos);
    const partes = Object.keys(zip.files).filter((n) => /\.(xml|rels)$/.test(n));
    assert.ok(partes.length > 3, a.nombre);
    for (const n of partes) {
      const xml = new TextDecoder('utf-8', { fatal: true }).decode(await zip.file(n)!.async('uint8array'));
      assert.doesNotMatch(xml, MALO, `${a.nombre} → ${n}`);
    }
  }
});
