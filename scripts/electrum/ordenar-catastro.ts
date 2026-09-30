/**
 * Ordenar el catastro desde la línea de comandos (o como trabajo de Render, que es donde la base
 * acepta conexiones): lo mismo que «Ordenar catastro» en Infraestructura.
 *
 *   npx tsx scripts/electrum/ordenar-catastro.ts              propuesta; no cambia nada
 *   npx tsx scripts/electrum/ordenar-catastro.ts --aplicar    aplica la propuesta tal cual
 *
 * Antes de proponer aplica el esquema del panel (con la v10), como hace el servidor al arrancar.
 */
import { asegurarBiblioteca } from '../../server/electrum/biblioteca';
import { cerrarBase, hayBase } from '../../server/electrum/db';
import { aplicar, fraseFuente, fuenteCatastro, proponer } from '../../server/electrum/ordenar';

async function main() {
  if (!hayBase()) throw new Error('Falta ELECTRUM_DB_URL.');
  if (!(await asegurarBiblioteca())) throw new Error('No pude preparar el esquema del panel.');
  const aplicarlo = process.argv.includes('--aplicar');
  console.log('[ordenar] antes:', fraseFuente(await fuenteCatastro()));
  const { oficial, filas } = await proponer();
  console.log('[ordenar] propuesta ' + JSON.stringify({ oficial, filas }));
  if (!aplicarlo) return console.log('[ordenar] en seco: no se cambió nada.');
  const r = await aplicar(
    filas.map(({ capaId, accion }) => ({ capaId, accion })),
    'ordenar-catastro (trabajo)'
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
