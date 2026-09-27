/**
 * El panel de infraestructura: lectores de oficina, el plan de una importación del cubo, y lo que
 * se hace con lo cargado (carpetas, estados, mover, renombrar, borrar, bitácora) con sus permisos.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import JSZip from 'jszip';
import type { AddressInfo } from 'node:net';

process.env.ULTRON_SESION_SECRETO = process.env.ULTRON_SESION_SECRETO || 'secreto-de-sesion-para-pruebas-largo-1234';
process.env.ELECTRUM_IMPORTAR_EN_PROCESO = '1';
// Con llave puesta la puerta se cierra también fuera de producción: sin sesión, 401.
const llaveAntes = process.env.ELECTRUM_CLAVE;
process.env.ELECTRUM_CLAVE = 'llave-de-prueba-biblioteca';

const { paginasDePptx, paginasDeRtf, paginasDeXlsx, paginasDeDoc, textoDeFlujoWord } = await import('../lib/leer-oficina');
const { planear, planDeTrabajo } = await import('../server/electrum/importar');
const bib = await import('../server/electrum/biblioteca');
const { montarRutasBiblioteca } = await import('../server/electrum/biblioteca-rutas');
const { aprender } = await import('../server/electrum/aprender');
const { consulta, hayBase } = await import('../server/electrum/db');
const { emitirSesion } = await import('../server/seguridad');
const { fijarCuentasAprobadas } = await import('../lib/acceso');

const sinBase = hayBase() ? false : 'sin ELECTRUM_DB_URL';

/* ------------------------------------------------------------------------ lectores */

test('RTF: acentos por código de página y Unicode, sin tablas de fuentes ni numeración', () => {
  const rtf =
    String.raw`{\rtf1\ansi\ansicpg1252\uc1{\fonttbl{\f0\froman Times New Roman;}}{\colortbl;\red0\green0\blue0;}` +
    String.raw`{\*\pnseclvl1\pnucrm\pnstart1{\pntxta .}}{\stylesheet{\s0 Normal;}}` +
    String.raw`\pard INVENTARIO MINERO DE HONDURAS\par Nombre: El Dorado\par Distrito: Sierra del R\'edo Tinto\par Met\u225?lico: Oro\tab Au\par}`;
  const [p] = paginasDeRtf(Buffer.from(rtf, 'latin1'));
  assert.ok(p);
  assert.match(p.texto, /^INVENTARIO MINERO DE HONDURAS/);
  assert.match(p.texto, /Sierra del Río Tinto/);
  assert.match(p.texto, /Metálico: Oro Au/);
  assert.doesNotMatch(p.texto, /Times New Roman|Normal|\(\)|\.\)/);
});

test('PPTX: una página por diapositiva en el orden de la presentación, con sus notas', async () => {
  const z = new JSZip();
  const diapo = (t: string[]) => `<p:sld><p:cSld><p:spTree>${t.map((x) => `<a:p><a:r><a:t>${x}</a:t></a:r></a:p>`).join('')}</p:spTree></p:cSld></p:sld>`;
  z.file('ppt/slides/slide10.xml', diapo(['Cierre']));
  z.file('ppt/slides/slide2.xml', diapo(['Producción de oro', '71,600 onz troy']));
  z.file('ppt/slides/slide1.xml', diapo(['Situación actual', 'Minería en Honduras']));
  z.file('ppt/slides/_rels/slide2.xml.rels', `<Relationships><Relationship Id="rId2" Target="../notesSlides/notesSlide7.xml"/></Relationships>`);
  z.file('ppt/notesSlides/notesSlide7.xml', `<p:notes><a:p><a:r><a:t>Fuente: BCH &amp; INHGEOMIN</a:t></a:r></a:p></p:notes>`);
  // Sin presentation.xml: el orden sale del número del nombre.
  const sinOrden = await paginasDePptx(await z.generateAsync({ type: 'nodebuffer' }));
  assert.deepEqual(
    sinOrden.map((p) => [p.pagina, p.texto.split('\n')[0]]),
    [
      [1, 'Situación actual'],
      [2, 'Producción de oro'],
      [3, 'Cierre'],
    ]
  );
  // Con presentation.xml manda la presentación: «Cierre» (slide10) se movió a la segunda posición.
  z.file(
    'ppt/presentation.xml',
    `<p:presentation><p:sldIdLst><p:sldId id="256" r:id="rId7"/><p:sldId id="257" r:id="rId9"/><p:sldId id="258" r:id="rId8"/></p:sldIdLst></p:presentation>`
  );
  z.file(
    'ppt/_rels/presentation.xml.rels',
    `<Relationships><Relationship Id="rId7" Target="slides/slide1.xml"/><Relationship Id="rId8" Target="slides/slide2.xml"/><Relationship Id="rId9" Target="slides/slide10.xml"/></Relationships>`
  );
  const paginas = await paginasDePptx(await z.generateAsync({ type: 'nodebuffer' }));
  assert.deepEqual(
    paginas.map((p) => [p.pagina, p.texto.split('\n')[0]]),
    [
      [1, 'Situación actual'],
      [2, 'Cierre'],
      [3, 'Producción de oro'],
    ]
  );
  assert.match(paginas[2].texto, /71,600 onz troy\n\nNotas: Fuente: BCH & INHGEOMIN/, 'las notas se encuentran por la relación de la diapositiva');
});

test('XLSX: una página por hoja, filas con « | », celdas compartidas e inline, encabezado repetido', async () => {
  const z = new JSZip();
  z.file(
    'xl/workbook.xml',
    `<workbook><sheets><sheet name="Muestreo" sheetId="1" r:id="rId1"/><sheet name="Vacía" sheetId="2" r:id="rId2"/></sheets></workbook>`
  );
  z.file(
    'xl/_rels/workbook.xml.rels',
    `<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml" Type="x"/><Relationship Id="rId2" Target="worksheets/sheet2.xml" Type="x"/></Relationships>`
  );
  z.file('xl/sharedStrings.xml', `<sst><si><t>Numero</t></si><si><t>Au g/t</t></si><si><r><t>La </t></r><r><t>Lola</t></r></si></sst>`);
  const filas = [`<row r="1"><c r="A1" t="s"><v>0</v></c><c r="C1" t="s"><v>1</v></c></row>`];
  for (let n = 2; n <= 45; n++) filas.push(`<row r="${n}"><c r="A${n}"><v>${n - 1}</v></c><c r="C${n}"><v>${(n / 10).toFixed(2)}</v></c></row>`);
  filas.push(`<row r="46"><c r="A46" t="s"><v>2</v></c><c r="B46" t="inlineStr"><is><t>bocamina</t></is></c><c r="D46" t="b"><v>1</v></c></row>`);
  z.file('xl/worksheets/sheet1.xml', `<worksheet><sheetData>${filas.join('')}</sheetData></worksheet>`);
  z.file('xl/worksheets/sheet2.xml', `<worksheet><sheetData/></worksheet>`);
  const paginas = await paginasDeXlsx(await z.generateAsync({ type: 'nodebuffer' }));
  assert.equal(paginas.length, 1, 'la hoja vacía no cuenta');
  const t = paginas[0].texto;
  assert.match(t, /^Hoja «Muestreo»\nNumero |  | Au g\/t\n1 |  | 0\.20\n/);
  assert.match(t, /\[Numero \|  \| Au g\/t\]/, 'el encabezado vuelve cada 40 filas');
  assert.match(t, /La Lola \| bocamina \|  \| sí$/);
});

test('DOC que en realidad es WordPerfect 5.1: texto, acentos, tabuladores y funciones saltadas', async () => {
  const cabecera = Buffer.alloc(16);
  Buffer.from([0xff, 0x57, 0x50, 0x43]).copy(cabecera);
  cabecera.writeUInt32LE(16, 4);
  const txt = (s: string) => Buffer.from(s, 'latin1');
  const ext = (n: number, juego: number) => Buffer.from([0xc0, n, juego, 0xc0]);
  const variable = Buffer.from([0xd0, 0x01, 0x04, 0x00, 0xaa, 0xbb, 0x01, 0xd0]); // se salta entera
  const tab = Buffer.from([0xc1, 1, 2, 3, 4, 5, 6, 7, 0xc1]);
  const doc = Buffer.concat([
    cabecera,
    txt('INVENTARIO MINERO DE HONDURAS'), Buffer.from([0x0a]),
    variable,
    txt('Met'), ext(27, 1), txt('lico: Au, Ag'), Buffer.from([0x0a]),
    tab, txt('Ubicaci'), ext(59, 1), txt('n: CA'), ext(56, 1), txt('ADA DEL BUEY, due'), ext(57, 1), txt('o g'), ext(71, 1), txt('iris'),
  ]);
  const [p] = await paginasDeDoc(doc);
  assert.equal(p.texto, 'INVENTARIO MINERO DE HONDURAS\nMetálico: Au, Ag\nUbicación: CAÑADA DEL BUEY, dueño güiris');
});

test('DOC: el texto vigente sale del tramo que declara el documento; si es «guardado rápido», nada', () => {
  const flujo = (banderas: number, texto: Buffer) => {
    const cab = Buffer.alloc(0x400);
    cab.writeUInt16LE(0xa5ec, 0);
    cab.writeUInt16LE(banderas, 0x0a);
    const relleno = Buffer.alloc(0x200); // ceros delante, como en las fichas FOMR
    cab.writeUInt32LE(0x400, 0x18); // fcMin
    cab.writeUInt32LE(0x400 + relleno.length + texto.length, 0x1c); // fcMac
    const viejo = Buffer.from('Nombre: NOMBRE VIEJO BORRADO', 'latin1'); // resto fuera del tramo
    return Buffer.concat([cab, relleno, texto, viejo]);
  };
  // Con un campo de Word (\x13 PRIVATE \x15): la instrucción no es texto.
  const ficha = Buffer.from('No. 105\x13 PRIVATE \x15\rCodigo: Iofa\r\tINVENTARIO MINERO DE HONDURAS\r1.\tNombre: GUANGOLOLO\x07Au ?\x07\r5.\tUbicación: LA PAZ\r', 'latin1');
  const t = textoDeFlujoWord(flujo(0, ficha));
  assert.equal(t, 'No. 105\nCodigo: Iofa\nINVENTARIO MINERO DE HONDURAS\n1. Nombre: GUANGOLOLO Au ?\n5. Ubicación: LA PAZ');
  assert.doesNotMatch(t, /VIEJO/, 'lo que queda fuera del tramo declarado no entra');
  assert.equal(textoDeFlujoWord(flujo(0x0004, ficha)), '', 'guardado rápido: no se adivina');
  assert.equal(textoDeFlujoWord(Buffer.from('no es un flujo de Word')), '');
  // Texto en UTF-16 (fExtChar).
  const u16 = Buffer.from('Metálico: Au\rñandú', 'utf16le');
  assert.equal(textoDeFlujoWord(flujo(0x1000, u16)), 'Metálico: Au\nñandú');
});

test('DOC: un archivo que no es Word 97 no cuelga ni inventa texto', async () => {
  await assert.rejects(paginasDeDoc(Buffer.from('esto no es un documento de Word')));
});

/* ------------------------------------------------------------------------ plan de importación */

test('importar: agrupa shapefiles, ordena en carpetas y dice por qué omite cada cosa', () => {
  const P = 'entrada/INDEXSA/';
  const o = (key: string, bytes = 1000) => ({ key: P + key, bytes, modificado: '' });
  const plan = planear(
    [
      o('Minas de Oro/Geologia.shp', 5000),
      o('Minas de Oro/Geologia.SHX'),
      o('Minas de Oro/Geologia.dbf'),
      o('Minas de Oro/Geologia.prj'),
      o('Minas de Oro/Geologia.sbn'),
      o('Minas de Oro/Geologia2.shp', 100),
      o('Minas de Oro/Geologia2.dbf'),
      o('Minas de Oro/suelta.dbf'),
      o('Minas de Oro/Minas de Oro.mxd'),
      o('Minas de Oro/informe.pdf'),
      o('Minas de Oro/~$PUNTOS.xlsx'),
      o('Minas de Oro/PUNTOS.xlsx'),
      o('FOM/FOM I 002.doc'),
      o('FOM/FOMR 169.rtf'),
      o('FOM/viejo.xls'),
      o('La Lola/lola.kmz'),
      o('La Lola/shapes.rar'),
      o('Estudio/pag-001.jpg'),
      o('Estudio/enorme.pdf', 200 * 1024 * 1024),
      o('Estudio/vacio.pdf', 0),
      o('raiz.docx'),
      o('Grande/catastro.shp', 30 * 1024 * 1024),
      o('Grande/catastro.dbf', 40 * 1024 * 1024),
    ],
    P,
    'INDEXSA 2026'
  );
  const por = (k: string) => plan.unidades.find((u) => u.key === P + k);
  const motivo = (k: string) => plan.omitidos.find((x) => x.key === P + k)?.motivo;
  const shp = por('Minas de Oro/Geologia.shp');
  assert.equal(shp?.tipo, 'shapefile');
  assert.deepEqual(Object.keys((shp as any).partes).sort(), ['dbf', 'prj', 'shp', 'shx']);
  assert.equal(shp?.carpeta, 'INDEXSA 2026/Minas de Oro');
  assert.equal(por('raiz.docx')?.carpeta, 'INDEXSA 2026');
  assert.equal(por('FOM/FOM I 002.doc')?.tipo, 'documento');
  assert.equal(por('FOM/FOMR 169.rtf')?.tipo, 'documento');
  assert.equal(por('Minas de Oro/PUNTOS.xlsx')?.tipo, 'documento');
  assert.equal(por('La Lola/lola.kmz')?.tipo, 'geo');
  assert.match(motivo('Minas de Oro/Geologia2.shp') || '', /vacío/);
  assert.match(motivo('Minas de Oro/suelta.dbf') || '', /sin su \.shp/);
  assert.match(motivo('Minas de Oro/Geologia.sbn') || '', /acompañante/);
  assert.match(motivo('Minas de Oro/Minas de Oro.mxd') || '', /acompañante/);
  assert.match(motivo('Minas de Oro/~$PUNTOS.xlsx') || '', /temporal/);
  assert.match(motivo('FOM/viejo.xls') || '', /Office 97/);
  assert.match(motivo('La Lola/shapes.rar') || '', /rar/);
  assert.match(motivo('Estudio/pag-001.jpg') || '', /imagen/);
  assert.match(motivo('Estudio/enorme.pdf') || '', /pesa más/);
  assert.match(motivo('Estudio/vacio.pdf') || '', /vacío/);
  assert.match(motivo('Grande/catastro.shp') || '', /más de 64 MB entre todas sus partes/, 'el tope vale para el shapefile entero');
  assert.equal(por('Grande/catastro.shp'), undefined);
  // Con imágenes pedidas, la foto entra.
  const conFotos = planear([o('Estudio/pag-001.jpg')], P, null, { imagenes: true });
  assert.equal(conFotos.unidades[0]?.tipo, 'imagen');
  assert.equal(conFotos.unidades[0]?.carpeta, 'Estudio');
});

test('importar: el plan del trabajo de Render va por su id interno', () => {
  // Sin la variable del entorno: una máquina configurada con «pro» no puede cambiar el resultado.
  const antes = process.env.ELECTRUM_IMPORTAR_PLAN;
  delete process.env.ELECTRUM_IMPORTAR_PLAN;
  try {
    assert.equal(planDeTrabajo(), 'plan-srv-008');
  } finally {
    if (antes !== undefined) process.env.ELECTRUM_IMPORTAR_PLAN = antes;
  }
  assert.equal(planDeTrabajo(''), 'plan-srv-008');
  assert.equal(planDeTrabajo('standard'), 'plan-srv-008');
  assert.equal(planDeTrabajo(' Pro '), 'plan-srv-010');
  assert.equal(planDeTrabajo('pro plus'), 'plan-srv-011');
  assert.equal(planDeTrabajo('plan-srv-006'), 'plan-srv-006');
  assert.equal(planDeTrabajo('gigante'), 'plan-srv-008', 'lo desconocido cae al estándar, no a un error de Render');
});

test('carpetas: se limpian (sin «..», sin vacíos, con tope)', () => {
  assert.equal(bib.normalizarCarpeta(' INDEXSA //  Minas  de Oro/ '), 'INDEXSA/Minas de Oro');
  assert.equal(bib.normalizarCarpeta('../../etc/./x'), 'etc/x');
  assert.equal(bib.normalizarCarpeta('a\\b\\c'), 'a/b/c');
  assert.equal(bib.normalizarCarpeta(''), null);
  assert.equal(bib.normalizarCarpeta('   /  / '), null);
  assert.equal(bib.normalizarCarpeta(Array.from({ length: 12 }, (_, i) => `n${i}`).join('/'))?.split('/').length, 8);
});

/* ------------------------------------------------------------------------ con base */

async function levantar() {
  const app = express();
  app.use(express.json());
  montarRutasBiblioteca(app);
  const srv = app.listen(0);
  await new Promise((r) => srv.once('listening', r));
  const base = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
  const pedir = async (ruta: string, cuerpo?: unknown, token?: string) => {
    const r = await fetch(base + ruta, {
      method: cuerpo === undefined ? 'GET' : 'POST',
      headers: { 'content-type': 'application/json', ...(token ? { 'x-ultron-sesion': token } : {}) },
      body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
    });
    return { status: r.status, json: (await r.json().catch(() => ({}))) as any };
  };
  return { srv, pedir };
}

test('panel: estados, carpetas, mover, renombrar, borrar y bitácora, con permisos por nivel', { skip: sinBase }, async () => {
  await bib.asegurarBiblioteca();
  await consulta(`DELETE FROM documento WHERE nombre LIKE 'prueba-bib-%'`);
  await consulta(`DELETE FROM capa WHERE nombre LIKE 'prueba-bib-%'`);
  await consulta(`DELETE FROM biblioteca_bitacora WHERE quien IN ('José', 'Obrero')`);
  fijarCuentasAprobadas([
    { id: 'lector-bib', nombre: 'Lector', correos: ['lector@mina.hn'], acceso: { electrum: 'lee' } } as any,
    { id: 'obrero-bib', nombre: 'Obrero', correos: ['obrero@mina.hn'], acceso: { electrum: 'escribe' } } as any,
  ]);
  const jose = emitirSesion({ correo: 'j.ordonez@ordenglobal.org', nombre: 'José', rol: 'Junta' }).token;
  const lector = emitirSesion({ correo: 'lector@mina.hn', nombre: 'Lector', rol: 'x' }).token;
  const obrero = emitirSesion({ correo: 'obrero@mina.hn', nombre: 'Obrero', rol: 'x' }).token;

  // Un documento sano en una carpeta, uno «cortado» a mano, uno sin texto y dos con el mismo nombre.
  const texto = Array.from({ length: 6 }, (_, i) => `Página ${i + 1}. ` + 'El distrito de Minas de Oro tiene vetas de cuarzo aurífero. '.repeat(30)).join('\f');
  const sano = await aprender('prueba-bib-sano.txt', Buffer.from(texto), { carpeta: 'INDEXSA/Minas de Oro', archivo: 's3://cubo/entrada/x/prueba-bib-sano.txt' });
  assert.equal(sano.clase, 'documento', sano.dicho);
  const idSano = Number((sano.ui as any).documento_id);
  const [c] = await consulta<{ id: number }>(`INSERT INTO documento (nombre, tipo, paginas, carpeta) VALUES ('prueba-bib-cortado.pdf', 'otro', 12, 'INDEXSA/Leyes') RETURNING id`);
  await consulta(`INSERT INTO fragmento (documento_id, pagina, orden, texto) VALUES ($1, 1, 0, $2)`, [c.id, 'x'.repeat(7990)]);
  const [v] = await consulta<{ id: number }>(`INSERT INTO documento (nombre, tipo, paginas) VALUES ('prueba-bib-escaneo.pdf', 'otro', 5) RETURNING id`);
  const [r1] = await consulta<{ id: number }>(`INSERT INTO documento (nombre, tipo, paginas) VALUES ('prueba-bib-doble.pdf', 'otro', 1) RETURNING id`);
  const [r2] = await consulta<{ id: number }>(`INSERT INTO documento (nombre, tipo, paginas) VALUES ('Prueba-Bib-Doble.pdf', 'otro', 1) RETURNING id`);
  for (const d of [r1, r2]) await consulta(`INSERT INTO fragmento (documento_id, pagina, orden, texto) VALUES ($1, 1, 0, 'contenido corto de una página')`, [d.id]);
  const [capa] = await consulta<{ id: number }>(
    `INSERT INTO capa (nombre, formato, origen_crs, entidades, carpeta) VALUES ('prueba-bib-capa', 'shapefile', 'EPSG:32616', 0, 'INDEXSA/Minas de Oro') RETURNING id`
  );

  const { srv, pedir } = await levantar();
  try {
    // Mirar: cualquiera con acceso. Sin sesión, no.
    assert.equal((await pedir('/api/electrum/biblioteca/resumen')).status, 401);
    const res = await pedir('/api/electrum/biblioteca/resumen', undefined, lector);
    assert.equal(res.status, 200);
    assert.equal(res.json.nivel, 'lee');
    assert.ok(res.json.porEstado.cortado >= 1 && res.json.porEstado.sin_texto >= 1 && res.json.porEstado.repetido >= 2 && res.json.porEstado.vacia >= 1);

    const lista = async (q: string) => (await pedir(`/api/electrum/biblioteca/items?${q}`, undefined, lector)).json.items as any[];
    const estadoDe = async (nombre: string) => (await lista(`q=${encodeURIComponent(nombre)}`)).find((i) => i.nombre === nombre)?.estado;
    assert.equal(await estadoDe('prueba-bib-sano.txt'), 'ok');
    assert.equal(await estadoDe('prueba-bib-cortado.pdf'), 'cortado');
    assert.equal(await estadoDe('prueba-bib-escaneo.pdf'), 'sin_texto');
    assert.equal(await estadoDe('prueba-bib-doble.pdf'), 'repetido');

    // La carpeta con subcarpetas trae lo de dentro; sin carpeta trae lo suelto.
    const enIndexsa = await lista('carpeta=INDEXSA&subcarpetas=1&q=prueba-bib');
    assert.deepEqual(enIndexsa.map((i) => i.nombre).sort(), ['prueba-bib-capa', 'prueba-bib-cortado.pdf', 'prueba-bib-sano.txt']);
    const sueltos = await lista('carpeta=~&q=prueba-bib');
    assert.ok(sueltos.some((i) => i.nombre === 'prueba-bib-escaneo.pdf'));
    const atencion = await lista('estado=atencion&q=prueba-bib');
    assert.ok(!atencion.some((i) => i.nombre === 'prueba-bib-sano.txt'));
    const arbol = (await pedir('/api/electrum/biblioteca/arbol', undefined, lector)).json.carpetas as any[];
    assert.ok(arbol.some((a) => a.carpeta === 'INDEXSA/Minas de Oro' && a.documentos >= 1 && a.capas >= 1));

    // El detalle trae el vistazo del texto y el original sin el nombre del cubo.
    const det = (await pedir(`/api/electrum/biblioteca/item/documento/${idSano}`, undefined, lector)).json.item;
    assert.equal(det.archivo, 'entrada/x/prueba-bib-sano.txt');
    assert.match(det.vistazo[0].texto, /Minas de Oro/);
    assert.equal(det.paginasConTexto, 6);

    // Permisos: el lector no mueve; el obrero mueve pero no borra; José borra.
    assert.equal((await pedir('/api/electrum/biblioteca/mover', { items: [{ clase: 'documento', id: v.id }], carpeta: 'X' }, lector)).status, 403);
    const mov = await pedir('/api/electrum/biblioteca/mover', { items: [{ clase: 'documento', id: v.id }, { clase: 'capa', id: capa.id }], carpeta: ' Escaneos / pendientes ' }, obrero);
    assert.equal(mov.status, 200);
    assert.equal(mov.json.movidos, 2);
    assert.equal(mov.json.carpeta, 'Escaneos/pendientes');

    // Renombrar la carpeta se lleva las subcarpetas; meterla dentro de sí misma, no.
    await pedir('/api/electrum/biblioteca/mover', { items: [{ clase: 'documento', id: r1.id }], carpeta: 'Escaneos/pendientes/viejos' }, obrero);
    assert.equal((await pedir('/api/electrum/biblioteca/carpeta', { de: 'Escaneos', a: 'Escaneos/dentro' }, obrero)).status, 400);
    const ren = await pedir('/api/electrum/biblioteca/carpeta', { de: 'Escaneos', a: 'Para OCR' }, obrero);
    assert.equal(ren.status, 200);
    assert.equal(ren.json.piezas, 3);
    const [x] = await consulta<{ carpeta: string }>(`SELECT carpeta FROM documento WHERE id = $1`, [r1.id]);
    assert.equal(x.carpeta, 'Para OCR/pendientes/viejos');

    const rn = await pedir('/api/electrum/biblioteca/renombrar', { clase: 'documento', id: r2.id, nombre: '  prueba-bib-doble v2.pdf ' }, obrero);
    assert.equal(rn.json.nombre, 'prueba-bib-doble v2.pdf');
    assert.equal(await estadoDe('prueba-bib-doble.pdf'), 'ok', 'con otro nombre ya no es repetido');

    // Borrar: solo mando, y solo confirmando.
    assert.equal((await pedir('/api/electrum/biblioteca/eliminar', { items: [{ clase: 'documento', id: c.id }], confirmo: true }, obrero)).status, 403);
    assert.equal((await pedir('/api/electrum/biblioteca/eliminar', { items: [{ clase: 'documento', id: c.id }] }, jose)).status, 400);
    const del = await pedir('/api/electrum/biblioteca/eliminar', { items: [{ clase: 'documento', id: c.id }, { clase: 'capa', id: capa.id }], confirmo: true }, jose);
    assert.equal(del.status, 200);
    assert.equal(del.json.eliminados, 2);
    const [quedan] = await consulta<{ n: number }>(`SELECT count(*)::int AS n FROM fragmento WHERE documento_id = $1`, [c.id]);
    assert.equal(quedan.n, 0, 'los fragmentos se van con el documento');

    // Una foto no se relee con los lectores de texto.
    process.env.ELECTRUM_EXPEDIENTES_BUCKET = 'cubo-de-prueba';
    const [foto] = await consulta<{ id: number }>(`INSERT INTO documento (nombre, tipo, paginas, archivo) VALUES ('prueba-bib-foto.jpg', 'otro', 1, 's3://cubo-de-prueba/biblioteca/x.jpg') RETURNING id`);
    const rf = await pedir(`/api/electrum/biblioteca/releer/${foto.id}`, {}, obrero);
    assert.equal(rf.json.ok, false);
    assert.match(rf.json.dicho, /foto/);
    delete process.env.ELECTRUM_EXPEDIENTES_BUCKET;

    // Importar y mirar el cubo: solo mando.
    assert.equal((await pedir('/api/electrum/biblioteca/importar', { prefijo: 'entrada/x/' }, obrero)).status, 403);
    assert.equal((await pedir('/api/electrum/biblioteca/cubo', undefined, obrero)).status, 403);

    // Todo quedó anotado, con quién.
    const bit = (await pedir('/api/electrum/biblioteca/bitacora', undefined, lector)).json.entradas as any[];
    const acciones = bit.filter((b) => b.quien === 'Obrero' || b.quien === 'José').map((b) => `${b.quien}:${b.accion}`);
    for (const a of ['Obrero:mover', 'Obrero:carpeta', 'Obrero:renombrar', 'José:eliminar']) assert.ok(acciones.includes(a), `falta ${a} en ${acciones}`);
  } finally {
    srv.close();
    fijarCuentasAprobadas([]);
    if (llaveAntes === undefined) delete process.env.ELECTRUM_CLAVE;
    else process.env.ELECTRUM_CLAVE = llaveAntes;
    await consulta(`DELETE FROM documento WHERE lower(nombre) LIKE 'prueba-bib-%'`);
    await consulta(`DELETE FROM capa WHERE nombre LIKE 'prueba-bib-%'`);
  }
});

test('un PDF escaneado se reconoce en el acto (sin el lector propio) y trae sus páginas', { skip: sinBase }, async () => {
  const fs = await import('node:fs');
  const pdf = fs.readFileSync('tests/fixtures/escaneo-3-paginas.pdf');
  await consulta(`DELETE FROM documento WHERE nombre = 'prueba-bib-escaneo-real.pdf'`);
  const t0 = Date.now();
  const r = await aprender('prueba-bib-escaneo-real.pdf', pdf);
  assert.equal(r.clase, 'nada');
  assert.equal((r.ui as any)?.escaneo, true);
  assert.equal((r.ui as any)?.paginas, 3, 'las páginas las cuenta pdf.js');
  assert.ok(Date.now() - t0 < 5000, `tardó ${Date.now() - t0} ms`);
  const id = await bib.anotarSinTexto({ nombre: 'prueba-bib-escaneo-real.pdf', datos: pdf, carpeta: 'Escaneos', archivo: 's3://cubo/entrada/e.pdf', motivo: r.dicho, paginas: 3 });
  const [d] = await consulta<{ paginas: number; tipo: string }>(`SELECT paginas, tipo FROM documento WHERE id = $1`, [id]);
  assert.deepEqual(d, { paginas: 3, tipo: 'escaneo' });
  await consulta(`DELETE FROM documento WHERE nombre = 'prueba-bib-escaneo-real.pdf'`);
});

test('aprender: .rtf, .pptx y .xlsx entran como documentos con su carpeta y su original', { skip: sinBase }, async () => {
  await bib.asegurarBiblioteca();
  await consulta(`DELETE FROM documento WHERE nombre LIKE 'prueba-bib-of-%'`);
  const z = new JSZip();
  z.file('ppt/slides/slide1.xml', `<p:sld><a:p><a:r><a:t>Estrategia de gestión de la minería artesanal en Honduras</a:t></a:r></a:p></p:sld>`);
  z.file('ppt/slides/slide2.xml', `<p:sld><a:p><a:r><a:t>Registro de mineros artesanales, ventanilla única y trazabilidad del oro</a:t></a:r></a:p></p:sld>`);
  const r = await aprender('prueba-bib-of-agenda.pptx', await z.generateAsync({ type: 'nodebuffer' }), { carpeta: 'INDEXSA/Presentación 1', archivo: 's3://cubo/entrada/p.pptx' });
  assert.equal(r.clase, 'documento', r.dicho);
  const [d] = await consulta<{ carpeta: string; archivo: string; paginas: number }>(`SELECT carpeta, archivo, paginas FROM documento WHERE nombre = 'prueba-bib-of-agenda.pptx'`);
  assert.deepEqual(d, { carpeta: 'INDEXSA/Presentación 1', archivo: 's3://cubo/entrada/p.pptx', paginas: 2 });
  const f = await consulta<{ pagina: number; texto: string }>(
    `SELECT f.pagina, f.texto FROM fragmento f JOIN documento d ON d.id = f.documento_id WHERE d.nombre = 'prueba-bib-of-agenda.pptx' ORDER BY f.orden`
  );
  assert.ok(f.some((x) => Number(x.pagina) === 2 && /ventanilla única/.test(x.texto)), 'la diapositiva 2 se cita como página 2');

  // Volver a subirlo (mismo contenido) sin carpeta no lo mueve ni lo duplica.
  const otra = await aprender('prueba-bib-of-agenda.pptx', await z.generateAsync({ type: 'nodebuffer' }), { carpeta: 'Otra' });
  assert.equal((otra.ui as any)?.repetido, true);
  const [d2] = await consulta<{ carpeta: string }>(`SELECT carpeta FROM documento WHERE nombre = 'prueba-bib-of-agenda.pptx'`);
  assert.equal(d2.carpeta, 'INDEXSA/Presentación 1', 'lo que ya tenía carpeta no se mueve solo');
  await consulta(`DELETE FROM documento WHERE nombre LIKE 'prueba-bib-of-%'`);
});

test('expediente_buscar con `documento`: busca DENTRO del informe o de la carpeta, no en su portada', { skip: sinBase }, async () => {
  const { buscarEnExpedientes, filtroDocumento } = await import('../server/electrum/db');
  await bib.asegurarBiblioteca();
  await consulta(`DELETE FROM documento WHERE nombre LIKE 'prueba-bus-%'`);
  const informe = [
    'Página 1. INFORME SOBRE LA EXPLORACIÓN MINERA JICA MMAJ 2003 FASE III, Honduras.',
    'Página 2. Prólogo del gobierno del Japón para la cooperación técnica.',
    'Página 3. Épocas de mineralización: Mioceno con epitermales de baja sulfuración y pórfidos de cobre; Plioceno con epitermales de oro.',
  ].join('\f');
  await aprender('prueba-bus-JICA-MMAJ 2003 Fase III (OCR).txt', Buffer.from(informe), { carpeta: 'INDEXSA SEP 2026/LIBROS/FASE3' });
  // Otro documento que repite el nombre del informe muchas veces, para tentar a la búsqueda general.
  await aprender('prueba-bus-índice.txt', Buffer.from('JICA MMAJ 2003 Fase III. JICA Fase III. Informe JICA Fase III 2003. Índice general de la biblioteca.'), { carpeta: 'Otros' });
  await aprender('prueba-bus-oro.txt', Buffer.from('Situación actual: la producción formal de oro es de 71,600 onzas troy al año y la informal de 176,411 onzas.'), { carpeta: 'INDEXSA SEP 2026/PRESENTACION 1' });

  assert.equal(filtroDocumento('', 3).sql, '');
  assert.equal(filtroDocumento('JICA Fase III', 3).args.length, 3);

  const dentro = await buscarEnExpedientes('épocas de mineralización', 3, { documento: 'JICA Fase III' });
  assert.ok(dentro.length > 0);
  assert.equal(Number(dentro[0].pagina), 3, `trajo la página ${dentro[0].pagina}: ${dentro[0].texto}`);
  assert.ok(dentro.every((h) => h.documento.includes('Fase III (OCR)')), 'solo del informe pedido');

  const carpeta = await buscarEnExpedientes('producción de oro formal e informal', 3, { documento: 'INDEXSA presentacion' });
  assert.equal(carpeta[0]?.documento, 'prueba-bus-oro.txt');

  // Sin tema útil pero con documento: el comienzo del documento.
  const inicio = await buscarEnExpedientes('de', 3, { documento: 'JICA Fase III OCR' });
  assert.match(inicio[0]?.texto || '', /INFORME SOBRE LA EXPLORACIÓN/);

  await consulta(`DELETE FROM documento WHERE nombre LIKE 'prueba-bus-%'`);
});

test('expediente_listar: el panorama por carpeta, lo de una carpeta con su estado, y lo que necesita atención', { skip: sinBase }, async () => {
  const { TODAS } = await import('../server/electrum/manos');
  const listar = TODAS.find((h) => h.nombre === 'expediente_listar')!;
  assert.ok(listar, 'la mano existe y es de Electrum');
  await bib.asegurarBiblioteca();
  await consulta(`DELETE FROM documento WHERE nombre LIKE 'prueba-lis-%'`);
  await aprender('prueba-lis-ficha.txt', Buffer.from('INVENTARIO MINERO DE HONDURAS. Ficha de ocurrencia mineral El Dorado, oro aluvial en Iriona, Colón.'), { carpeta: 'Pruebas Listar/FOM' });
  const [esc] = await consulta<{ id: number }>(`INSERT INTO documento (nombre, tipo, paginas, carpeta) VALUES ('prueba-lis-escaneo.pdf', 'escaneo', 9, 'Pruebas Listar/Escaneos') RETURNING id`);
  try {
    const todo = await listar.ejecutar({}, {} as any);
    assert.match(todo.texto, /Pruebas Listar: 2 \(1 necesitan atención\)/);
    const carpeta = await listar.ejecutar({ filtro: 'Pruebas Listar' }, {} as any);
    assert.match(carpeta.texto, /2 piezas/);
    assert.match(carpeta.texto, /«prueba-lis-escaneo\.pdf» \(9 pág, SIN TEXTO/);
    const atencion = await listar.ejecutar({ filtro: 'Pruebas Listar', solo_atencion: true }, {} as any);
    assert.match(atencion.texto, /^1 pieza/);
    const nombre = await listar.ejecutar({ filtro: 'prueba-lis-ficha' }, {} as any);
    assert.match(nombre.texto, /leído\) en Pruebas Listar\/FOM/);
    const nada = await listar.ejecutar({ filtro: 'no existe en ningún lado xyz' }, {} as any);
    assert.match(nada.texto, /No hay nada cargado/);
  } finally {
    await consulta(`DELETE FROM documento WHERE nombre LIKE 'prueba-lis-%' OR id = $1`, [esc.id]);
  }
});
