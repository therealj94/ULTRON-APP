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
 *   … --decidir 417=borrar,274=dejar                           corrige la propuesta capa por capa (y suma
 *                                                             capas que no propuso, p. ej. una copia
 *                                                             repetida de una referencia)
 *   … --decidir … --solo-lo-decidido                         aplica SOLO las capas de --decidir (y la
 *                                                             oficial); el resto de la propuesta queda
 *                                                             como está. Sin esto, lo demás que proponga
 *                                                             (p. ej. borrar copias vacías) también se
 *                                                             aplica.
 *   … --oficial-huellas huellas.txt                            huellas del archivo oficial (una por
 *                                                             línea): lo que sea del archivo cuenta
 *                                                             como oficial aunque esté en otra capa
 *
 * Antes de proponer aplica el esquema del panel (con la v10), como hace el servidor al arrancar.
 */
import fs from 'node:fs';
import { asegurarBiblioteca } from '../../server/electrum/biblioteca';
import { cerrarBase, consulta, hayBase } from '../../server/electrum/db';
import { ACCIONES, aplicar, fraseFuente, fuenteCatastro, proponer, type Accion } from '../../server/electrum/ordenar';

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
  const d = process.argv.indexOf('--decidir');
  if (d > 0) {
    for (const par of String(process.argv[d + 1] || '').split(',').filter(Boolean)) {
      const [id, accion] = par.split('=');
      const capaId = Number(id);
      if (!Number.isInteger(capaId) || !ACCIONES.includes(accion as Accion)) throw new Error(`--decidir: «${par}» no es capa=acción (${ACCIONES.join(', ')}).`);
      const fila = filas.find((f) => f.capaId === capaId);
      if (fila) Object.assign(fila, { accion, motivo: 'decidido a mano (--decidir)' });
      else filas.push({ capaId, nombre: `capa ${capaId}`, carpeta: null, concesiones: 0, repetidas: 0, rol: null, accion: accion as Accion, motivo: 'decidido a mano (--decidir)' });
    }
  }
  if (process.argv.includes('--solo-lo-decidido')) {
    for (const f of filas) if (f.accion !== 'oficial' && f.motivo !== 'decidido a mano (--decidir)') Object.assign(f, { accion: 'dejar', motivo: 'fuera de --decidir' });
  }
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
