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
 */
import fs from 'node:fs';
import path from 'node:path';
import { aprender } from '../../server/electrum/aprender';
import { ingerir, resumenCapa } from '../../server/electrum/gis';
import { cerrarBase, hayBase, saludBase } from '../../server/electrum/db';

const RECONOCIDO = /\.(zip|shp|kml|kmz|geojson|json|csv|gpkg|dxf|pdf|txt|md|markdown)$/i;

const AYUDA = `Cargador de Electrum.

  ELECTRUM_DB_URL=postgres://usuario:clave@host:5432/electrum \\
    npx tsx scripts/electrum/aprender.ts <archivo|carpeta>...

  --quien <nombre>    quién lo sube (queda registrado)
  --concesion <id>    ata el documento a una concesión del catastro
  --tipo <texto>      fuerza el tipo del documento en vez de deducirlo
  --seco              lee y dice qué haría, sin escribir nada

Entran: shapefile (.zip/.shp), KML, KMZ, GeoJSON, CSV, PDF, texto y Markdown.`;

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

const archivos = expandir(rutas);
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

for (const ruta of archivos) {
  const nombre = path.basename(ruta);
  process.stdout.write(`▸ ${nombre} … `);
  try {
    const datos = fs.readFileSync(ruta);

    if (opts.seco) {
      // En seco solo se lee lo geográfico: un documento no se puede resumir sin indexarlo.
      if (/\.(zip|shp|kml|kmz|geojson|json|csv)$/i.test(nombre)) {
        const { capa, avisos } = await ingerir(nombre, datos);
        console.log(capa ? `\n   ${resumenCapa(capa, avisos)}` : `\n   ${avisos.map((a) => a.texto).join(' ')}`);
      } else {
        console.log(`\n   ${(datos.length / 1024).toFixed(0)} KB, se indexaría como documento.`);
      }
      bien++;
      continue;
    }

    const r = await aprender(nombre, datos, {
      subidoPor: opts.quien || 'cargador',
      concesionId: opts.concesion ?? undefined,
      tipoDoc: opts.tipo ?? undefined,
    });

    console.log(r.clase === 'nada' ? 'no entró' : r.clase);
    console.log(`   ${r.dicho}`);
    for (const a of r.avisos) if (a.nivel !== 'info') console.log(`   [${a.nivel}] ${a.texto}`);
    r.clase === 'nada' ? mal++ : bien++;
  } catch (e: any) {
    console.log('falló');
    console.log(`   ${String(e?.message || e).slice(0, 200)}`);
    mal++;
  }
}

console.log(`\n${bien} ${bien === 1 ? 'archivo' : 'archivos'} en el cerebro${mal ? `, ${mal} sin cargar` : ''}.`);
if (!opts.seco) {
  const s = await saludBase();
  console.log(`El catastro tiene ahora ${s.concesiones} concesiones.`);
  await cerrarBase();
}
process.exit(mal && !bien ? 1 : 0);
