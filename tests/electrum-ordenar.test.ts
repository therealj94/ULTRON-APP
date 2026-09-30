/**
 * Ordenar el catastro (server/electrum/ordenar.ts): de varias versiones mezcladas a UNA.
 *
 * El caso real: el catastro nacional de junio de 2026 cargado junto a trece capas «por estado» de
 * otra exportación y a los polígonos de los proyectos propios. Cada concesión salía traslapada con
 * su copia y las cifras contaban de más. Aquí se arma eso en chico y se comprueba que la propuesta
 * lo reconoce y que aplicarla deja un solo catastro, sin perder los proyectos ni lo histórico.
 *
 * AVISO: como las demás pruebas del catastro, VACÍA la base a la que apuntes.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import type { Feature } from 'geojson';
import { ingerir } from '../server/electrum/gis';
import { cerrarBase, consulta, guardarCapa, hayBase, rolDeCapa } from '../server/electrum/db';
import { asegurarBiblioteca } from '../server/electrum/biblioteca';
import { aplicar, esHistorico, fraseFuente, fuenteCatastro, proponer } from '../server/electrum/ordenar';

test('los nombres de JICA son históricos; un mapa geológico de JICA sigue siendo roca', () => {
  assert.equal(rolDeCapa('zonas de JICA'), 'historico');
  assert.equal(rolDeCapa('zona de estudio 3 fases jica'), 'historico');
  assert.equal(rolDeCapa('Mapa geológico JICA Olancho'), 'litologia');
  assert.equal(rolDeCapa('Proyecto Minas de Oro'), null);
  assert.ok(esHistorico('JICA-MMAJ 2003 - Exploración minera, Fase III (OCR).txt'));
  assert.ok(!esHistorico('DERECHOS MINEROS EN HONDURAS A JUNIO 2026'));
});

test('ordenar el catastro', { skip: hayBase() ? false : 'sin ELECTRUM_DB_URL' }, async (t) => {
  const zip = fs.readFileSync(path.join(process.cwd(), 'tests', 'fixtures', 'gis', 'catastro.zip'));
  const { capa } = await ingerir('catastro.zip', zip);
  assert.ok(capa);
  await consulta('TRUNCATE traslape, concesion, entidad_geo, capa RESTART IDENTITY CASCADE');
  assert.ok(await asegurarBiblioteca(), 'el esquema del panel (con la v10) se aplica');
  // La bitácora no se vacía entre corridas: se cuenta desde aquí.
  const [{ desde }] = await consulta<{ desde: string }>('SELECT coalesce(max(id), 0)::text AS desde FROM biblioteca_bitacora');

  const mover = (c: any, dx: number): any => (typeof c[0] === 'number' ? [c[0] + dx, c[1]] : c.map((x: any) => mover(x, dx)));
  const variante = (nombre: string, dx: number, props: Record<string, unknown> = {}) => {
    const c = structuredClone(capa!);
    c.nombre = nombre;
    c.geojson.features = (c.geojson.features as Feature[]).map((f: any) => ({
      ...f,
      properties: { ...f.properties, ...props },
      geometry: { ...f.geometry, coordinates: mover(f.geometry.coordinates, dx) },
    }));
    return c;
  };

  // El oficial, una versión vieja del mismo (corrida un metro: no es idéntica, es casi toda la
  // misma), un proyecto propio lejos, y unas zonas de JICA sin titular.
  const oficial = await guardarCapa(variante('DERECHOS MINEROS EN HONDURAS A JUNIO 2026', 0), { subidoPor: 'pruebas' });
  const vieja = await guardarCapa(variante('CONCESION METALICA OTORGADA PARA EXPLORAR', 0.00001), { subidoPor: 'pruebas' });
  const proyecto = await guardarCapa(variante('MONARKA I', 1.5), { subidoPor: 'pruebas' });
  const jicaCapa = variante('zonas de JICA', 3);
  jicaCapa.geojson.features = (jicaCapa.geojson.features as Feature[]).map((f) => ({ ...f, properties: { ZONA: 'Fase I' } }));
  const jica = await guardarCapa(jicaCapa, { subidoPor: 'pruebas' });
  assert.equal(oficial.concesiones, 2);
  assert.equal(vieja.concesiones, 2, 'la versión vieja entra: no es idéntica');
  assert.equal(proyecto.concesiones, 2);
  assert.equal(jica.concesiones, 0, 'sin titular no es concesión');

  await t.test('sin ordenar, el resumen avisa que hay capas mezcladas', async () => {
    const f = await fuenteCatastro();
    assert.equal(f.capas.length, 3);
    assert.match(fraseFuente(f), /sin ordenar/);
  });

  let filas: Awaited<ReturnType<typeof proponer>>['filas'] = [];
  await t.test('la propuesta reconoce qué es cada capa, sin cambiar nada', async () => {
    const p = await proponer();
    filas = p.filas;
    assert.equal(p.oficial, oficial.capaId, 'el oficial es el que dice «derechos mineros»');
    const de = (id: number) => filas.find((f) => f.capaId === id)?.accion;
    assert.equal(de(oficial.capaId), 'oficial');
    assert.equal(de(vieja.capaId), 'borrar');
    assert.equal(filas.find((f) => f.capaId === vieja.capaId)?.repetidas, 2);
    assert.equal(de(proyecto.capaId), 'proyecto');
    const [{ n }] = await consulta<{ n: number }>('SELECT count(*)::int AS n FROM concesion');
    assert.equal(n, 6, 'proponer no toca nada');
    const [j] = await consulta<{ rol: string | null }>('SELECT rol FROM capa WHERE id = $1', [jica.capaId]);
    assert.equal(j.rol, 'historico', 'las zonas de JICA entran ya como histórico');
  });

  await t.test('sin un oficial no se aplica nada', async () => {
    const r = await aplicar([{ capaId: vieja.capaId, accion: 'borrar' }], 'pruebas');
    assert.equal(r.ok, false);
    const [{ n }] = await consulta<{ n: number }>('SELECT count(*)::int AS n FROM capa WHERE id = $1', [vieja.capaId]);
    assert.equal(n, 1);
  });

  await t.test('aplicar deja un solo catastro y conserva el proyecto como referencia', async () => {
    const r = await aplicar(filas.map(({ capaId, accion }) => ({ capaId, accion })), 'pruebas');
    assert.equal(r.ok, true, r.dicho);
    assert.equal(r.concesionesAntes, 6);
    assert.equal(r.concesionesDespues, 2);
    assert.equal(r.borradas, 1);

    const [{ n: capaVieja }] = await consulta<{ n: number }>('SELECT count(*)::int AS n FROM capa WHERE id = $1', [vieja.capaId]);
    assert.equal(capaVieja, 0, 'la versión vieja se borró');
    const [p] = await consulta<{ rol: string; ent: number; conc: number; titular: string | null }>(
      `SELECT k.rol, (SELECT count(*)::int FROM entidad_geo e WHERE e.capa_id = k.id) AS ent,
              (SELECT count(*)::int FROM concesion c WHERE c.capa_id = k.id) AS conc,
              (SELECT e.atributos->>'titular' FROM entidad_geo e WHERE e.capa_id = k.id LIMIT 1) AS titular
         FROM capa k WHERE k.id = $1`,
      [proyecto.capaId]
    );
    assert.deepEqual({ rol: p.rol, ent: p.ent, conc: p.conc }, { rol: 'proyecto', ent: 2, conc: 0 });
    assert.ok(p.titular, 'la entidad conserva el titular que traía');

    const [{ n: bit }] = await consulta<{ n: number }>(
      `SELECT count(*)::int AS n FROM biblioteca_bitacora WHERE detalle->>'por' = 'ordenar catastro' AND id > $1`,
      [desde]
    );
    assert.equal(bit, 2, 'el borrado y el cambio de rol quedan en la bitácora');

    const [{ n: tr }] = await consulta<{ n: number }>('SELECT count(*)::int AS n FROM traslape');
    assert.equal(tr, r.traslapes, 'los traslapes se recalcularon sobre lo que quedó');
  });

  await t.test('ordenado, el resumen nombra el catastro vigente y lo que es referencia', async () => {
    const texto = fraseFuente(await fuenteCatastro());
    assert.match(texto, /Catastro vigente: «DERECHOS MINEROS EN HONDURAS A JUNIO 2026»/);
    assert.match(texto, /1 de proyectos propios/);
    assert.match(texto, /1 históricas/);
  });

  await t.test('catastro partido: lo que es del archivo oficial se adopta, no se borra', async () => {
    /*
     * El caso de producción: una capa «por estado» subida ANTES trae concesiones idénticas a las del
     * archivo oficial, que al cargarse no las repitió. La capa oficial queda incompleta, y borrar la
     * «por estado» se llevaría concesiones vigentes.
     */
    await consulta('TRUNCATE traslape, concesion, entidad_geo, capa RESTART IDENTITY CASCADE');
    const todo = variante('DERECHOS MINEROS EN HONDURAS A JUNIO 2026', 0);
    const una = structuredClone(todo);
    una.nombre = 'CONCESIÓN METÁLICA OTORGADA PARA EXPLORAR';
    una.geojson.features = [(una.geojson.features as Feature[])[0]];
    const porEstado = await guardarCapa(una, { subidoPor: 'pruebas' });
    const oficialP = await guardarCapa(todo, { subidoPor: 'pruebas' });
    assert.equal(porEstado.concesiones, 1);
    assert.equal(oficialP.concesiones, 1, 'la oficial queda partida: una de las dos no entró');
    const huellas = (await consulta<{ huella: string }>('SELECT huella FROM concesion')).map((x) => x.huella);

    const p = await proponer(oficialP.capaId, huellas);
    const f = p.filas.find((x) => x.capaId === porEstado.capaId)!;
    assert.equal(f.accion, 'borrar', f.motivo);
    assert.equal(f.adoptables, 1);
    const r = await aplicar(p.filas.map(({ capaId, accion }) => ({ capaId, accion })), 'pruebas', huellas);
    assert.ok(r.ok, r.dicho);
    assert.equal(r.concesionesDespues, 2, 'ninguna concesión vigente se perdió');
    const [{ n }] = await consulta<{ n: number }>('SELECT count(*)::int AS n FROM concesion WHERE capa_id = $1', [oficialP.capaId]);
    assert.equal(n, 2, 'la capa oficial queda completa');
  });

  await t.test('catastro partido sin huellas: la misma exportación (mismos campos) se junta en el oficial', async () => {
    await consulta('TRUNCATE traslape, concesion, entidad_geo, capa RESTART IDENTITY CASCADE');
    const todo = variante('DERECHOS MINEROS EN HONDURAS A JUNIO 2026', 0, { codigo: 1, nombre_zon: 'x' });
    const parte = structuredClone(todo);
    parte.nombre = 'ARTESANAL NO METALICA DELIMITADA';
    parte.geojson.features = [(parte.geojson.features as Feature[])[0]];
    const otro = variante('MINAS DE ORO I', 3, { codigo: 1, nombre_zon: 'x' });
    const pe = await guardarCapa(parte, { subidoPor: 'pruebas' });
    const of = await guardarCapa(todo, { subidoPor: 'pruebas' });
    const pr = await guardarCapa(otro, { subidoPor: 'pruebas' });
    const p = await proponer(of.capaId);
    const fpe = p.filas.find((x) => x.capaId === pe.capaId)!;
    assert.equal(fpe.adoptables, 1);
    assert.equal(fpe.accion, 'borrar', fpe.motivo);
    const fpr = p.filas.find((x) => x.capaId === pr.capaId)!;
    assert.equal(fpr.adoptables || 0, 0, 'un proyecto con los mismos campos no se mete en el catastro');
    const r = await aplicar(p.filas.map(({ capaId, accion }) => ({ capaId, accion })), 'pruebas');
    assert.ok(r.ok, r.dicho);
    const [{ n }] = await consulta<{ n: number }>('SELECT count(*)::int AS n FROM concesion WHERE capa_id = $1', [of.capaId]);
    assert.equal(n, 2, 'la capa oficial queda completa');
  });

  await cerrarBase();
});
