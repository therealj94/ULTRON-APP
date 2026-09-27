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
import { indexarPendientes } from '../../server/electrum/vectores';
import { clasificarPendientes } from '../../server/electrum/documentos-laya';

const id = Math.floor(Number(process.argv[2]));
if (!Number.isFinite(id) || id <= 0) {
  console.error('uso: importar-cubo <id de importación>');
  process.exit(2);
}
correrImportacion(id)
  .then(async (estado) => {
    console.log(`[importar] importación ${id}: ${estado}`);
    /*
     * `aprender` deja los vectores y la clasificación de Laya corriendo en segundo plano, sin
     * esperarlos: en el servidor sigue vivo el proceso y terminan solos. Aquí el proceso se acaba
     * al salir, así que se hace una pasada final y se ESPERA: si no, los últimos documentos de la
     * carga quedaban sin búsqueda por significado y sin tipo.
     */
    const vectores = await indexarPendientes({ maximo: 200_000 }).catch((e) => (console.error('[importar] vectores:', e), 0));
    const laya = await clasificarPendientes({ limite: 5000 }).catch((e) => (console.error('[importar] laya:', e), null));
    console.log(`[importar] vectores: ${vectores} · Laya: ${laya ? `${laya.clasificados} clasificados, ${laya.fallidos} sin lector` : 'no corrió'}`);
    process.exit(estado === 'fallida' ? 1 : 0);
  })
  .catch((e) => {
    console.error('[importar] se cayó:', e);
    process.exit(1);
  });
