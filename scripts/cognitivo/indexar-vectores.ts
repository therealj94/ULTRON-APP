/**
 * Rellena los vectores de los expedientes que ya estaban cargados antes de la búsqueda por
 * significado. Se corre una vez después de instalar pgvector y levantar el servicio de embeddings,
 * y cuantas veces haga falta: solo toca lo que falta.
 *
 *   ELECTRUM_DB_URL=… EMBED_URL=… EMBED_API_KEY=… npx tsx scripts/cognitivo/indexar-vectores.ts
 */
import { indexarPendientes, vectoresListos } from '../../server/electrum/vectores';
import { cerrarBase, consulta } from '../../server/electrum/db';

async function main() {
  if (!(await vectoresListos())) {
    console.error('No hay vectores: falta EMBED_URL, o la base no tiene la columna (aplicá esquema.sql con pgvector instalado).');
    process.exit(1);
  }
  const [{ n }] = await consulta<{ n: string }>('SELECT count(*)::text AS n FROM fragmento WHERE embedding IS NULL');
  console.log(`${n} fragmentos sin vector.`);
  let total = 0;
  for (;;) {
    const hechos = await indexarPendientes({ maximo: 1000 });
    total += hechos;
    if (!hechos) break;
    console.log(`… ${total}`);
  }
  console.log(`Listo: ${total} fragmentos con vector.`);
  await cerrarBase();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
