/**
 * Corre una importación del cubo de expedientes creada desde el panel de infraestructura.
 *
 * El panel crea la fila en `importacion` y lanza un trabajo de Render con
 * `node dist/importar-cubo.cjs <id>`: otra máquina, con las mismas variables que el servicio, que
 * baja cada archivo, lo aprende y anota el avance en la base. Así el servicio web —512 MB— sigue
 * contestando mientras entran dos mil archivos.
 *
 * A mano: `npx tsx scripts/electrum/importar-cubo.ts <id>`.
 */
import { correrImportacion } from '../../server/electrum/importar';

const id = Math.floor(Number(process.argv[2]));
if (!Number.isFinite(id) || id <= 0) {
  console.error('uso: importar-cubo <id de importación>');
  process.exit(2);
}
correrImportacion(id)
  .then((estado) => {
    console.log(`[importar] importación ${id}: ${estado}`);
    process.exit(estado === 'fallida' ? 1 : 0);
  })
  .catch((e) => {
    console.error('[importar] se cayó:', e);
    process.exit(1);
  });
