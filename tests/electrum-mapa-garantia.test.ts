/**
 * El mapa no depende de que el modelo se acuerde de moverlo (server/electrum/mapa-garantia.ts).
 *
 * Lo visto en producción el 27-09: «muéstrame Los Chaguites en el mapa» → «Ahí la tiene, resaltada
 * en el mapa», sin ninguna herramienta, y el mapa quieto en Honduras entera. La parte de base de
 * datos necesita ELECTRUM_DB_URL y VACÍA el catastro, como tests/electrum-db.test.ts.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import type { Feature, Geometry } from 'geojson';
import { consulta, guardarCapa, hayBase } from '../server/electrum/db';
import { DICE_MAPA, PIDE_MAPA, garantizarMapa, movioElMapa, nombreDelPedido } from '../server/electrum/mapa-garantia';
import { MANOS } from '../server/electrum/manos';
import type { Capa } from '../server/electrum/gis';

const HAY = hayBase();

test('cuándo hace falta el mapa, sin base', async (t) => {
  await t.test('reconoce los pedidos de ver algo', () => {
    for (const m of ['Muéstrame Los Chaguites en el mapa', 'muestrame la concesion', 'enséñamela', '¿Dónde queda El Mochito?', 'ubícala', 'llévame a Clavo Rico', 'ponela en el mapa']) {
      assert.ok(PIDE_MAPA.test(m), m);
    }
    for (const m of ['¿Quién es el titular de Los Chaguites?', '¿Cuántas hectáreas tiene?', 'Hacé el informe']) {
      assert.ok(!PIDE_MAPA.test(m), m);
    }
  });

  await t.test('reconoce las respuestas que dicen haberlo mostrado', () => {
    for (const r of ['Ahí la tiene, Los Chaguites, resaltada en el mapa.', 'Ya está sobre la concesión.', 'Te la muestro en el mapa.']) {
      assert.ok(DICE_MAPA.test(r), r);
    }
    assert.ok(!DICE_MAPA.test('El titular es Minerales del Norte, vence en 2031.'));
  });

  await t.test('el nombre que queda en el pedido', () => {
    assert.equal(nombreDelPedido('Muéstrame Los Chaguites en el mapa, por favor'), 'chaguites');
    assert.equal(nombreDelPedido('¿Dónde queda la concesión El Mochito?'), 'mochito');
    assert.equal(nombreDelPedido('muéstramela en el mapa'), 'muestramela');
  });

  await t.test('qué cuenta como mover el mapa', () => {
    const g = { type: 'Point', coordinates: [0, 0] };
    assert.ok(movioElMapa([{ accion: 'volar', geojson: g }]));
    assert.ok(movioElMapa([{ filas: [] }, { accion: 'candidatas', geojson: { type: 'FeatureCollection', features: [] } }]));
    assert.ok(!movioElMapa([{ filas: [] }, { accion: 'volar' }]));
    assert.ok(!movioElMapa([]));
  });

  await t.test('sin pedido ni promesa, la respuesta pasa igual', async () => {
    const r = await garantizarMapa({ mensaje: '¿Quién es el titular?', texto: 'Minerales del Norte.', ui: [] });
    assert.deepEqual(r, { texto: 'Minerales del Norte.' });
  });

  await t.test('Telegram no tiene mapa: no se toca', async () => {
    const texto = 'Ahí la tiene, resaltada en el mapa.';
    const r = await garantizarMapa({ mensaje: 'muéstramela', texto, ui: [], canal: 'telegram' });
    assert.deepEqual(r, { texto });
  });

  await t.test('si una herramienta ya movió el mapa, no se agrega otra orden', async () => {
    const ui = [{ accion: 'volar', geojson: { type: 'Point', coordinates: [0, 0] } }];
    const r = await garantizarMapa({ mensaje: 'muéstrame Los Chaguites', texto: 'Ahí la tiene en el mapa.', ui });
    assert.equal(r.ui, undefined);
    assert.equal(r.texto, 'Ahí la tiene en el mapa.');
  });
});

const caja = (o: number, s: number, e: number, n: number): Geometry => ({
  type: 'Polygon',
  coordinates: [[[o, s], [e, s], [e, n], [o, n], [o, s]]],
});
function capa(nombre: string, rasgos: Array<[Record<string, unknown>, Geometry]>): Capa {
  const features: Feature[] = rasgos.map(([properties, geometry]) => ({ type: 'Feature', properties, geometry }));
  return { nombre, formato: 'geojson', origenCrs: 'EPSG:4326', entidades: features.length, descartadas: 0, geojson: { type: 'FeatureCollection', features } };
}

test('el mapa se mueve aunque el modelo no lo pida, contra PostGIS', { skip: HAY ? false : 'sin ELECTRUM_DB_URL' }, async (t) => {
  await consulta('TRUNCATE traslape, concesion, entidad_geo, capa RESTART IDENTITY CASCADE');
  await guardarCapa(
    capa('Catastro de prueba', [
      [{ NOMBRE: 'Los Chaguites', TITULAR: 'Minera Uno', EXPEDIENTE: '1276' }, caja(-87.2, 14.8, -87.18, 14.82)],
      [{ NOMBRE: 'Clavo Rico Norte', TITULAR: 'Minera Dos', EXPEDIENTE: 'EXP-9' }, caja(-86.9, 14.2, -86.88, 14.22)],
      [{ NOMBRE: 'Clavo Rico Sur', TITULAR: 'Minera Tres', EXPEDIENTE: 'EXP-10' }, caja(-86.9, 14.1, -86.88, 14.12)],
    ])
  );
  const [{ id: idCh }] = await consulta<{ id: number }>(`SELECT id::int FROM concesion WHERE nombre = 'Los Chaguites'`);

  await t.test('el caso de producción: pidió verla, el doctor dijo que ya estaba y no llamó nada', async () => {
    const r = await garantizarMapa({
      mensaje: 'Muéstrame Los Chaguites en el mapa',
      texto: 'Ahí la tiene, Los Chaguites, resaltada en el mapa.',
      ui: [],
    });
    assert.equal(r.ui?.accion, 'volar');
    assert.equal(r.ui?.concesion_id, idCh);
    assert.equal(r.ui?.garantia, true);
    const enc = r.ui?.encuadre as number[];
    assert.ok(Math.abs(enc[0] + 87.2) < 1e-6 && Math.abs(enc[3] - 14.82) < 1e-6, `encuadre ${enc}`);
    assert.equal(r.texto, 'Ahí la tiene, Los Chaguites, resaltada en el mapa.');
    assert.match(r.nota || '', /Los Chaguites/);
  });

  await t.test('«muéstramela en el mapa» después de que el doctor la nombró con su id', async () => {
    const r = await garantizarMapa({
      mensaje: 'muéstramela en el mapa',
      texto: 'Listo.',
      ui: [],
      historial: [
        { role: 'user', content: '¿Qué sabés de la concesión 1276?' },
        { role: 'assistant', content: `Los Chaguites (id ${idCh}), expediente 1276. Titular Minera Uno.` },
      ],
    });
    assert.equal(r.ui?.concesion_id, idCh);
  });

  await t.test('por el expediente que nombra la respuesta, sin confundirlo con el id', async () => {
    const r = await garantizarMapa({ mensaje: 'enséñamela', texto: 'Es la del expediente 1276, ahí la tiene en el mapa.', ui: [] });
    assert.equal(r.ui?.concesion_id, idCh);
  });

  await t.test('si no se sabe cuál era, no puede quedar diciendo que ya está en el mapa', async () => {
    const r = await garantizarMapa({ mensaje: 'muéstrame Clavo Rico', texto: 'Ahí la tiene, resaltada en el mapa.', ui: [] });
    assert.equal(r.ui, undefined);
    assert.match(r.texto, /el mapa no se movió esta vez/);
  });

  await t.test('catastro_buscar mueve el mapa por sí sola', async () => {
    const una = await MANOS.catastro_buscar.ejecutar({ texto: 'Los Chaguites' }, {} as never);
    assert.equal(una.ok, true, una.texto);
    assert.equal((una.ui as any).accion, 'volar');
    assert.equal((una.ui as any).concesion_id, idCh);
    assert.ok((una.ui as any).geojson);

    // Varias: se pintan todas y se encuadran juntas; el catastro no se reemplaza (no es 'capa').
    const varias = await MANOS.catastro_buscar.ejecutar({ texto: 'Clavo Rico' }, {} as never);
    assert.equal(varias.ok, true, varias.texto);
    const u = varias.ui as any;
    assert.equal(u.accion, 'candidatas');
    assert.equal(u.geojson.features.length, 2);
    assert.deepEqual(u.encuadre.map((x: number) => Math.round(x * 100) / 100), [-86.9, 14.1, -86.88, 14.22]);
  });

  await t.test('concesion_entorno también pone el mapa sobre la concesión', async () => {
    const r = await MANOS.concesion_entorno.ejecutar({ concesion_id: idCh }, {} as never);
    assert.equal(r.ok, true, r.texto);
    assert.equal((r.ui as any).accion, 'volar');
    assert.equal((r.ui as any).concesion_id, idCh);
  });
});
