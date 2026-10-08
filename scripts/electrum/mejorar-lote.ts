/**
 * Terminar de leer un lote ya cargado: lo que quedó con poco texto (escaneos con alguna letra suelta,
 * presentaciones que son puras imágenes) se pasa por OCR en el nodo de carga y su texto se pone EN
 * el mismo documento —mismo nombre, carpeta y original—, sin crear un «.txt» aparte. Y las copias
 * exactas de un mismo documento se borran (con bitácora), dejando la más antigua.
 *
 *   tsx scripts/electrum/mejorar-lote.ts --listar s3://cubo/lote/ > pendientes.tsv
 *       id <TAB> estado <TAB> ruta del original dentro del lote, de lo que tiene poco texto
 *   tsx scripts/electrum/mejorar-lote.ts --cargar-ocr pendientes.tsv dir-ocr/
 *       pone el texto de dir-ocr/<ruta sin extensión>.txt en cada documento (solo si mejora); si no
 *       hay .txt pero está dir-ocr/<ruta> tal cual, lo relee con su lector (un cortado viejo)
 *   tsx scripts/electrum/mejorar-lote.ts --repetidos [--aplicar]
 *       copias con el mismo nombre y el mismo texto: las lista; con --aplicar borra todas menos una
 *
 * En el nodo de carga, con los túneles:  con-cerebro tsx scripts/electrum/mejorar-lote.ts …
 */
import fs from 'node:fs';
import path from 'node:path';
import { cargarTextoEn, eliminar } from '../../server/electrum/biblioteca';
import { cerrarBase, consulta, hayBase } from '../../server/electrum/db';

const QUIEN = 'mejorar-lote (nodo de carga)';
const args = process.argv.slice(2);

/** Mismo criterio que el panel (biblioteca.ts): varias páginas y poco texto por página, o la firma del tope viejo. */
const POCO_TEXTO = `
  SELECT d.id, d.archivo,
         CASE WHEN coalesce(d.paginas, 0) > 3 AND coalesce(f.car, 0) BETWEEN 7400 AND 8200 THEN 'cortado' ELSE 'poco_texto' END AS estado
    FROM documento d
    LEFT JOIN (SELECT documento_id, sum(length(texto))::int AS car FROM fragmento GROUP BY documento_id) f ON f.documento_id = d.id
   WHERE d.archivo LIKE $1
     AND ((coalesce(d.paginas, 0) > 3 AND coalesce(f.car, 0) BETWEEN 7400 AND 8200)
       OR (coalesce(d.paginas, 0) >= 3 AND coalesce(f.car, 0) < d.paginas * 400))
   ORDER BY d.id`;

async function listar(prefijo: string) {
  const p = prefijo.replace(/\/?$/, '/');
  const filas = await consulta<{ id: string; archivo: string; estado: string }>(POCO_TEXTO, [`${p}%`]);
  for (const f of filas) console.log(`${f.id}\t${f.estado}\t${f.archivo.slice(p.length)}`);
  console.error(`[mejorar] ${filas.length} con poco texto o cortados bajo ${p}`);
}

async function cargarOcr(lista: string, dir: string) {
  let mejor = 0;
  let igual = 0;
  let falta = 0;
  for (const linea of fs.readFileSync(lista, 'utf8').split('\n').filter(Boolean)) {
    const [id, , rel] = linea.split('\t');
    // El .txt del OCR si lo hay; si no, el archivo mismo (con su lector): así se relee entero un
    // documento que quedó cortado con el tope viejo y cuyo original volvió a llegar en un lote.
    const txt = path.join(dir, rel.replace(/\.[^./]+$/, '') + '.txt');
    const crudo = path.join(dir, rel);
    const fuente = [txt, crudo].find((f) => fs.existsSync(f) && fs.statSync(f).isFile() && fs.statSync(f).size);
    if (!fuente) {
      falta++;
      continue;
    }
    const r = await cargarTextoEn(Number(id), path.basename(fuente), fs.readFileSync(fuente), QUIEN);
    if (r.ok && r.ahora > r.antes) mejor++;
    else igual++;
    console.log(`${r.ok && r.ahora > r.antes ? '✓' : '='} ${rel}: ${r.dicho}`);
  }
  console.log(`[mejorar] ${mejor} con más texto, ${igual} sin cambio, ${falta} sin OCR.`);
}

async function repetidos(aplicar: boolean) {
  // El texto entero de cada documento, en orden: dos archivos distintos con el mismo nombre y el mismo
  // texto son el mismo documento dos veces (un .docx guardado de nuevo, una copia en otra carpeta).
  const grupos = await consulta<{ ids: string[]; nombre: string; n: number }>(
    `WITH t AS (
       SELECT d.id, lower(d.nombre) AS ln, d.nombre,
              md5(string_agg(f.texto, '' ORDER BY f.pagina, f.orden)) AS h
         FROM documento d JOIN fragmento f ON f.documento_id = d.id
        GROUP BY d.id
     )
     SELECT array_agg(id::text ORDER BY id) AS ids, min(nombre) AS nombre, count(*)::int AS n
       FROM t GROUP BY ln, h HAVING count(*) > 1 ORDER BY 2`
  );
  const sobran = grupos.flatMap((g) => g.ids.slice(1).map(Number));
  for (const g of grupos) console.log(`${g.n}× ${g.nombre}  (se queda ${g.ids[0]}, sobran ${g.ids.slice(1).join(', ')})`);
  console.log(`[mejorar] ${grupos.length} documentos repetidos con el mismo texto; ${sobran.length} copias de más.`);
  if (!aplicar || !sobran.length) return console.log('[mejorar] en seco: no se borró nada (--aplicar para borrar).');
  const r = await eliminar(sobran.map((id) => ({ clase: 'documento' as const, id })), QUIEN);
  console.log(`[mejorar] borradas ${r.eliminados} copias (anotadas en la bitácora).`);
}

async function main() {
  if (!hayBase()) throw new Error('Falta ELECTRUM_DB_URL.');
  const i = (f: string) => args.indexOf(f);
  if (i('--listar') >= 0) return listar(args[i('--listar') + 1]);
  if (i('--cargar-ocr') >= 0) return cargarOcr(args[i('--cargar-ocr') + 1], args[i('--cargar-ocr') + 2]);
  if (i('--repetidos') >= 0) return repetidos(args.includes('--aplicar'));
  throw new Error('Decime qué: --listar <prefijo s3>, --cargar-ocr <lista> <dir> o --repetidos [--aplicar].');
}

main()
  .catch((e) => {
    console.error('[mejorar] fallo:', String(e?.message || e));
    process.exitCode = 1;
  })
  .finally(() => cerrarBase().catch(() => {}));
