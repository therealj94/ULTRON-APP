/**
 * Recalcula la prospectividad desde la línea de comandos: lo mismo que «Calcular» en el tablero,
 * para después de una carga grande (geología, ocurrencias o muestras nuevas dejan vencidos los
 * puntajes, que se calcularon con otros insumos).
 *
 *   ELECTRUM_DB_URL=… npx tsx scripts/electrum/prospectividad-calcular.ts            solo lo pendiente
 *   ELECTRUM_DB_URL=… npx tsx scripts/electrum/prospectividad-calcular.ts --todas    todas
 *
 * En el nodo de carga:  con-cerebro tsx scripts/electrum/prospectividad-calcular.ts
 */
import { cerrarBase, hayBase } from '../../server/electrum/db';
import { calcularTodas, rankingProspectividad } from '../../server/electrum/prospectividad';

async function main() {
  if (!hayBase()) throw new Error('Falta ELECTRUM_DB_URL.');
  const antes = await rankingProspectividad(5);
  console.log(`[prospectividad] antes: ${antes.calculadas} al día, ${antes.pendientes} pendientes.`);
  const t = Date.now();
  await calcularTodas({ soloFaltantes: !process.argv.includes('--todas') });
  const despues = await rankingProspectividad(10);
  console.log(`[prospectividad] después (${((Date.now() - t) / 60000).toFixed(1)} min): ${despues.calculadas} al día, ${despues.pendientes} pendientes.`);
  for (const r of despues.ranking) console.log(`  ${String(r.puntaje).padStart(3)}  ${r.nombre}`);
}

main()
  .catch((e) => {
    console.error('[prospectividad] fallo:', String(e?.message || e));
    process.exitCode = 1;
  })
  .finally(() => cerrarBase().catch(() => {}));
