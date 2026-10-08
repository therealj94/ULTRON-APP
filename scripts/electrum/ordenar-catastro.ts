/**
 * Ordenar el catastro desde la línea de comandos (o como trabajo de Render, que es donde la base
 * acepta conexiones): lo mismo que «Ordenar catastro» en Infraestructura.
 *
 *   npx tsx scripts/electrum/ordenar-catastro.ts              propuesta; no cambia nada
 *   npx tsx scripts/electrum/ordenar-catastro.ts --aplicar    aplica la propuesta tal cual
 *   … --oficial <capa_id>                                     la capa que es el catastro vigente, en vez
 *                                                             de adivinarla (por defecto: la de más
 *                                                             concesiones que se llame «catastro» o
 *                                                             «derechos mineros»). Al recargar el mismo
 *                                                             catastro con unas pocas más, la nueva
 *                                                             ganaba y la vigente —con su
 *                                                             prospectividad, carteras y alertas— se
 *                                                             proponía para borrar.
 *   … --oficial-huellas huellas.txt                            huellas del archivo oficial (una por
 *                                                             línea): lo que sea del archivo cuenta
 *                                                             como oficial aunque esté en otra capa
 *
 * Antes de proponer aplica el esquema del panel (con la v10), como hace el servidor al arrancar.
 */
import fs from 'node:fs';
import { asegurarBiblioteca } from '../../server/electrum/biblioteca';
import { cerrarBase, consulta, hayBase } from '../../server/electrum/db';
import { aplicar, fraseFuente, fuenteCatastro, proponer } from '../../server/electrum/ordenar';

async function main() {
  if (!hayBase()) throw new Error('Falta ELECTRUM_DB_URL.');
  if (!(await asegurarBiblioteca())) throw new Error('No pude preparar el esquema del panel.');
  const aplicarlo = process.argv.includes('--aplicar');
  console.log('[ordenar] antes:', fraseFuente(await fuenteCatastro()));
  const i = process.argv.indexOf('--oficial-huellas');
  const huellas = i > 0 ? [...new Set(fs.readFileSync(process.argv[i + 1], 'utf8').split(/\s+/).filter((h) => /^[0-9a-f]{32}$/.test(h)))] : [];
  if (huellas.length) {
    const [{ n }] = await consulta<{ n: number }>(`SELECT count(DISTINCT huella)::int AS n FROM concesion WHERE huella = ANY($1::text[])`, [huellas]);
    console.log(`[ordenar] huellas del archivo oficial: ${huellas.length}; en la base: ${n}`);
  }
  const j = process.argv.indexOf('--oficial');
  const oficialPedida = j > 0 ? Number(process.argv[j + 1]) : null;
  if (j > 0 && !(Number.isInteger(oficialPedida) && oficialPedida! > 0)) throw new Error('--oficial necesita el id de una capa.');
  const { oficial, filas } = await proponer(oficialPedida, huellas);
  console.log('[ordenar] propuesta ' + JSON.stringify({ oficial, filas }));
  if (!aplicarlo) return console.log('[ordenar] en seco: no se cambió nada.');
  const r = await aplicar(
    filas.map(({ capaId, accion }) => ({ capaId, accion })),
    'ordenar-catastro (trabajo)',
    huellas
  );
  console.log('[ordenar] resultado ' + JSON.stringify(r));
  console.log('[ordenar] después:', fraseFuente(await fuenteCatastro()));
}

main()
  .catch((e) => {
    console.error('[ordenar] fallo:', String(e?.message || e));
    process.exitCode = 1;
  })
  .finally(() => cerrarBase().catch(() => {}));
