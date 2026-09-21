/**
 * CARGADOR DE ELECTRUM — mete archivos en el cerebro desde la línea de comandos.
 *
 * Es la puerta por la que entra todo: shapefiles del catastro, KML de bloques, informes 43-101,
 * resoluciones, ensayos de laboratorio. Lo geográfico va al catastro y se cruza; los documentos se
 * trocean con su página para poder citarlos.
 *
 *   ELECTRUM_DB_URL=postgres://electrum:clave@host:5432/electrum \
 *     npx tsx scripts/electrum/aprender.ts catastro.zip informe.pdf resolucion.pdf
 *
 * Opciones:
 *   --quien <nombre>       quién lo sube (queda registrado)
 *   --concesion <id>       ata el documento a una concesión del catastro
 *   --tipo <texto>         fuerza el tipo del documento en vez de deducirlo
 *   --seco                 lee y dice qué haría, sin escribir nada
 *
 * Acepta carpetas: entra en ellas y carga lo que reconoce. No falla por un archivo malo, lo dice y
 * sigue con los demás: cuando alguien manda cincuenta archivos, uno roto no puede parar la carga.
 *
 * Para una carga grande —cientos de expedientes, gigabytes— el orden es este:
 *
 *   1. `--seco` sobre la carpeta. No escribe nada y dice cuántos entran de verdad, cuántos son
 *      escaneos sin texto que hay que pasar por OCR antes, y cuánto texto va a ocupar en la base.
 *      Lo que se guarda es el TEXTO, no el archivo: una carpeta de gigabytes son decenas de MB.
 *   2. La carga de verdad. Se puede cortar y relanzar las veces que haga falta: cada documento
 *      lleva la huella de su contenido y lo ya cargado se salta en un md5, sin volver a leerlo.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import JSZip from 'jszip';
import { aprender, inspeccionar } from '../../server/electrum/aprender';
import { ingerir, resumenCapa } from '../../server/electrum/gis';
import { cerrarBase, hayBase, recalcularTraslapes, saludBase } from '../../server/electrum/db';

/** Por encima de esto, un shapefile no se lee de una pieza: se queda sin memoria y tumba la carga. */
const TOPE_SHP = 300 * 1024 ** 2;

const RECONOCIDO = /\.(zip|shp|dbf|shx|prj|cpg|sbn|sbx|qpj|qmd|kml|kmz|geojson|json|csv|gpkg|dxf|pdf|docx|txt|md|markdown)$/i;

const AYUDA = `Cargador de Electrum.

  ELECTRUM_DB_URL=postgres://usuario:clave@host:5432/electrum \\
    npx tsx scripts/electrum/aprender.ts <archivo|carpeta>...

  --quien <nombre>    quién lo sube (queda registrado)
  --concesion <id>    ata el documento a una concesión del catastro
  --tipo <texto>      fuerza el tipo del documento en vez de deducirlo
  --seco              lee y dice qué haría, sin escribir nada

Se puede cortar y relanzar: lo ya cargado se salta por la huella de su contenido.

Entran: shapefile (.zip/.shp), KML, KMZ, GeoJSON, CSV, PDF, Word, texto y Markdown.`;

const args = process.argv.slice(2);
const opts: { quien: string | null; concesion: number | null; tipo: string | null; seco: boolean } =
  { quien: null, concesion: null, tipo: null, seco: false };
const rutas: string[] = [];
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === '--quien') opts.quien = args[++i];
  else if (a === '--concesion') opts.concesion = Number(args[++i]);
  else if (a === '--tipo') opts.tipo = args[++i];
  else if (a === '--seco') opts.seco = true;
  else if (a === '--ayuda' || a === '-h') {
    console.log(AYUDA);
    process.exit(0);
  } else rutas.push(a);
}

if (!rutas.length) {
  console.error('Decime qué cargar. `npx tsx scripts/electrum/aprender.ts --ayuda` para ver cómo.');
  process.exit(1);
}

/** Aplana carpetas y descarta lo que no reconocemos, diciéndolo. */
function expandir(entradas: string[]): string[] {
  const salida: string[] = [];
  for (const r of entradas) {
    let st;
    try {
      st = fs.statSync(r);
    } catch {
      console.error(`  ✗ ${r}: no existe`);
      continue;
    }
    if (st.isDirectory()) {
      for (const f of fs.readdirSync(r).sort()) salida.push(...expandir([path.join(r, f)]));
    } else if (RECONOCIDO.test(r)) {
      salida.push(r);
    } else {
      console.error(`  – ${path.basename(r)}: formato que no cargo, lo salto`);
    }
  }
  return salida;
}

/**
 * Junta las piezas sueltas de un shapefile en un zip antes de cargarlo.
 *
 * Un shapefile no es un archivo, son cuatro: el `.shp` lleva la geometría, el `.dbf` los nombres y
 * atributos, el `.shx` el índice y el `.prj` el sistema de coordenadas. Pasarle el `.shp` solo al
 * motor le da polígonos mudos y, sin el `.prj`, además mal situados: las coordenadas se leen como
 * grados cuando venían en UTM. Eso no falla, que es lo peor: entra un catastro entero equivocado.
 *
 * Quien sube una carpeta los manda sueltos, porque así están en su disco. Aquí se vuelven a juntar
 * por nombre base y se le entrega al motor el zip que sí sabe leer entero.
 */
async function juntarShapefiles(lista: string[]): Promise<string[]> {
  const porBase = new Map<string, string[]>();
  const sueltos: string[] = [];
  for (const f of lista) {
    if (/\.(shp|dbf|shx|prj|cpg|sbn|sbx|qpj|qmd|shp\.xml)$/i.test(f)) {
      const base = f.replace(/\.[^.]+$/, '');
      if (!porBase.has(base)) porBase.set(base, []);
      porBase.get(base)!.push(f);
    } else sueltos.push(f);
  }

  const salida = [...sueltos];
  for (const [base, piezas] of porBase) {
    const shp = piezas.find((f) => /\.shp$/i.test(f));
    if (!shp) {
      // Piezas sin su .shp: sobran, y decirlo evita que alguien las busque luego.
      console.error(`  – ${path.basename(base)}: hay ${piezas.length} piezas de shapefile sin el .shp, las salto`);
      continue;
    }
    if (piezas.length === 1) {
      // Un .shp solo ni siquiera se abre: el motor intenta descomprimirlo y devuelve «but-unzip~2»,
      // que no le dice nada a nadie. Mejor decir qué falta y cómo se arregla.
      console.error(
        `  ✗ ${path.basename(shp)}: falta el resto del shapefile (.dbf, .shx, .prj). ` +
          `Subí la carpeta entera, no solo el .shp.`
      );
      continue;
    }
    // Un shapefile enorme se parsea ENTERO en memoria antes de tocar la base, así que uno de dos
    // gigas no va lento: tumba el proceso por falta de memoria y se lleva por delante la carga
    // entera, incluidos los cientos de archivos que ya iban bien. Más vale saltarlo diciéndolo.
    //
    // El caso real fueron las curvas de nivel de 20 m de un país entero: millones de líneas que
    // además no son catastro sino relieve, y que en una base de consulta no pintan nada. Eso se
    // sirve como teselas, no como filas.
    const tam = fs.statSync(shp).size;
    if (tam > TOPE_SHP) {
      console.error(
        `  ✗ ${path.basename(shp)}: ${(tam / 1024 ** 3).toFixed(2)} GB, demasiado para leerlo de una pieza ` +
          `(el tope son ${(TOPE_SHP / 1024 ** 2).toFixed(0)} MB). Hay que partirlo o simplificarlo antes.`
      );
      continue;
    }

    const zip = new JSZip();
    for (const f of piezas) zip.file(path.basename(f), fs.readFileSync(f));

    /*
     * Si el .dbf no es UTF-8 válido y nadie declaró la codificación, se declara Latin-1.
     *
     * El formato DBF guarda la página de códigos en un byte que los exportadores dejan en cero muy
     * a menudo, y entonces el lector supone UTF-8. Cuando los bytes son Latin-1 —lo que sale por
     * defecto de ArcGIS— cada vocal acentuada se convierte en un carácter de reemplazo: «R?o
     * Medina» en vez de «Río Medina». No falla, no avisa; solo deja los nombres rotos, y con ellos
     * la búsqueda, porque nadie escribe «R<reemplazo>o» en un buscador.
     *
     * La prueba es objetiva, no una corazonada: si los bytes decodifican como UTF-8, se dejan en
     * paz; si no decodifican, son Latin-1. En el catastro de Honduras esto recupera 139 nombres.
     * Los que ya venían con un signo de interrogación literal no tienen arreglo aquí: esos se
     * perdieron al exportarlos y hay que pedir el archivo otra vez.
     */
    if (!piezas.some((f) => /\.cpg$/i.test(f))) {
      const dbf = piezas.find((f) => /\.dbf$/i.test(f));
      if (dbf) {
        let esUtf8 = true;
        try {
          new TextDecoder('utf-8', { fatal: true }).decode(fs.readFileSync(dbf));
        } catch {
          esUtf8 = false;
        }
        if (!esUtf8) zip.file(`${path.basename(base)}.cpg`, 'ISO-8859-1');
      }
    }
    // El nombre del zip lleva el del shapefile: es lo que se va a ver luego en la lista de capas.
    const destino = path.join(os.tmpdir(), `${path.basename(base)}.zip`);
    fs.writeFileSync(destino, await zip.generateAsync({ type: 'nodebuffer' }));
    temporales.push(destino);
    salida.push(destino);
  }
  return salida.sort();
}

const temporales: string[] = [];
const archivos = await juntarShapefiles(expandir(rutas));
if (!archivos.length) {
  console.error('No hay nada que cargar.');
  process.exit(1);
}

if (!opts.seco) {
  if (!hayBase()) {
    console.error('Falta ELECTRUM_DB_URL. Sin base no hay dónde guardar. Probá con --seco para ver qué haría.');
    process.exit(1);
  }
  const s = await saludBase();
  if (!s.viva) {
    console.error(`La base no responde: ${s.motivo}`);
    process.exit(1);
  }
  console.log(`Catastro conectado. PostGIS ${s.postgis}, ${s.concesiones} concesiones cargadas.\n`);
}

let bien = 0;
let mal = 0;
let repetidos = 0;
const arranque = Date.now();

// El ensayo no cuenta archivos: cuenta lo que de verdad va a quedar en el cerebro. Un montón de
// expedientes mineros son escaneos sin capa de texto, y en una carpeta grande esa proporción es el
// único número que importa antes de empezar, porque decide si hay que pasar medio lote por OCR.
const censo = { indexables: 0, escaneos: 0, cortos: 0, paginas: 0, fragmentos: 0, caracteres: 0, bytes: 0 };
const paraOcr: string[] = [];

for (const [i, ruta] of archivos.entries()) {
  const nombre = path.basename(ruta);
  process.stdout.write(`▸ [${i + 1}/${archivos.length}] ${nombre} … `);
  try {
    const datos = fs.readFileSync(ruta);
    censo.bytes += datos.length;

    if (opts.seco) {
      if (/\.(zip|shp|kml|kmz|geojson|json|csv)$/i.test(nombre)) {
        const { capa, avisos } = await ingerir(nombre, datos);
        console.log(capa ? `\n   ${resumenCapa(capa, avisos)}` : `\n   ${avisos.map((a) => a.texto).join(' ')}`);
        if (capa) censo.indexables++;
      } else {
        const ins = await inspeccionar(nombre, datos);
        console.log(`\n   ${ins.dicho}`);
        if (ins.veredicto === 'indexable') {
          censo.indexables++;
          censo.paginas += ins.paginas;
          censo.fragmentos += ins.fragmentos;
          censo.caracteres += ins.caracteres;
        } else if (ins.veredicto === 'escaneo') {
          censo.escaneos++;
          paraOcr.push(ruta);
        } else {
          censo.cortos++;
        }
      }
      bien++;
      continue;
    }

    const r = await aprender(nombre, datos, {
      subidoPor: opts.quien || 'cargador',
      concesionId: opts.concesion ?? undefined,
      tipoDoc: opts.tipo ?? undefined,
      // Una sola vez al final, no después de cada archivo: cruzar todas las concesiones contra
      // todas cien veces seguidas no termina nunca, y el resultado es el mismo.
      sinTraslapes: true,
    });

    const repetido = Boolean((r.ui as any)?.repetido);
    console.log(r.clase === 'nada' ? 'no entró' : repetido ? 'ya estaba' : r.clase);
    console.log(`   ${r.dicho}`);
    for (const a of r.avisos) if (a.nivel !== 'info') console.log(`   [${a.nivel}] ${a.texto}`);
    if (r.clase === 'nada') mal++;
    else if (repetido) repetidos++;
    else bien++;
  } catch (e: any) {
    console.log('falló');
    console.log(`   ${String(e?.message || e).slice(0, 200)}`);
    mal++;
  }
}

const minutos = (Date.now() - arranque) / 60000;

if (opts.seco) {
  // Un lote de prueba son kilobytes y el real son gigabytes: una sola unidad deja «0.0 MB» en uno
  // o un número de doce cifras en el otro, y ninguno de los dos se puede leer.
  const peso = (n: number) =>
    n >= 1024 ** 3 ? `${(n / 1024 ** 3).toFixed(2)} GB` : n >= 1024 ** 2 ? `${(n / 1024 ** 2).toFixed(1)} MB` : `${(n / 1024).toFixed(0)} KB`;
  console.log(`\n── Lo que entraría ──────────────────────────────`);
  console.log(`${archivos.length} archivos, ${peso(censo.bytes)} en disco.`);
  console.log(`${censo.indexables} ${censo.indexables === 1 ? 'entra' : 'entran'}: ${censo.paginas} páginas, ${censo.fragmentos} fragmentos, ${peso(censo.caracteres)} de texto.`);
  if (censo.escaneos) {
    console.log(
      censo.escaneos === 1
        ? '1 es un escaneo sin texto y NO entra: hay que pasarlo por OCR antes.'
        : `${censo.escaneos} son escaneos sin texto y NO entran: hay que pasarlos por OCR antes.`
    );
  }
  if (censo.cortos) {
    console.log(
      censo.cortos === 1
        ? '1 tiene texto pero demasiado corto para indexarlo.'
        : `${censo.cortos} tienen texto pero demasiado corto para indexarlos.`
    );
  }
  // Lo que se guarda es el texto, no el archivo: por eso 1,2 GB de PDF caben en unas decenas de MB.
  if (censo.bytes > 0 && censo.caracteres > 0) {
    console.log(`El cerebro guarda el texto, no el PDF: ${peso(censo.bytes)} de archivos son ${peso(censo.caracteres)} de base.`);
  }
  if (paraOcr.length) {
    const lista = path.join(process.cwd(), 'para-ocr.txt');
    fs.writeFileSync(lista, paraOcr.join('\n') + '\n');
    console.log(`La lista de los que necesitan OCR quedó en ${lista}.`);
  }
} else {
  const partes = [`${bien} ${bien === 1 ? 'archivo nuevo' : 'archivos nuevos'} en el cerebro`];
  if (repetidos) partes.push(`${repetidos} ya estaban y se saltaron`);
  if (mal) partes.push(`${mal} sin cargar`);
  console.log(`\n${partes.join(', ')}. ${minutos.toFixed(1)} min.`);
  if (bien) {
    process.stdout.write('\nCruzando el padrón entero para buscar traslapes… ');
    const t = await recalcularTraslapes();
    console.log(t === 1 ? '1 traslape.' : `${t} traslapes.`);
  }
  const s = await saludBase();
  console.log(`El catastro tiene ahora ${s.concesiones} concesiones.`);
  await cerrarBase();
}
// Los zip que se armaron para juntar las piezas de los shapefiles son de usar y tirar.
for (const t of temporales) {
  try {
    fs.unlinkSync(t);
  } catch {
    /* ya no estaba */
  }
}

process.exit(mal && !bien && !repetidos ? 1 : 0);
