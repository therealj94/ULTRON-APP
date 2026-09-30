/**
 * Restricciones (server/electrum/restricciones.ts), carteras (cartera.ts) y que resubir una capa
 * no la duplique. Contra PostGIS, con capas armadas a partir del fixture del catastro: un área
 * protegida con zona núcleo sobre una concesión, una microcuenca en trámite sobre la otra.
 *
 * AVISO: como las demás pruebas del catastro, VACÍA la base a la que apuntes.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import type { Feature } from 'geojson';
import { ingerir, type Capa } from '../server/electrum/gis';
import { cerrarBase, consulta, guardarCapa, hayBase } from '../server/electrum/db';
import { asegurarBiblioteca } from '../server/electrum/biblioteca';
import { restriccionesDe, restriccionesEnTexto } from '../server/electrum/restricciones';
import { analizarCartera, carteraEnTexto, carteras } from '../server/electrum/cartera';
import { aplicar, proponer } from '../server/electrum/ordenar';

test('restricciones, carteras y capas sin duplicar', { skip: hayBase() ? false : 'sin ELECTRUM_DB_URL' }, async (t) => {
  const zip = fs.readFileSync(path.join(process.cwd(), 'tests', 'fixtures', 'gis', 'catastro.zip'));
  const { capa } = await ingerir('catastro.zip', zip);
  assert.ok(capa);
  await consulta('TRUNCATE traslape, concesion, entidad_geo, capa RESTART IDENTITY CASCADE');
  assert.ok(await asegurarBiblioteca());
  await consulta('TRUNCATE cartera RESTART IDENTITY CASCADE');

  const mover = (c: any, dx: number): any => (typeof c[0] === 'number' ? [c[0] + dx, c[1]] : c.map((x: any) => mover(x, dx)));
  /** Una capa de geografía hecha con el polígono de la concesión `i`, con los atributos de ICF. */
  const geografia = (nombre: string, i: number, props: Record<string, unknown>): Capa => {
    const c = structuredClone(capa!);
    c.nombre = nombre;
    c.geojson.features = [{ ...(c.geojson.features as Feature[])[i], properties: props }];
    return c;
  };

  const oficial = await guardarCapa({ ...structuredClone(capa!), nombre: 'DERECHOS MINEROS EN HONDURAS A JUNIO 2026' }, { subidoPor: 'pruebas' });
  assert.equal(oficial.concesiones, 2);
  const [a, b] = await consulta<{ id: string; nombre: string }>(`SELECT id::text, nombre FROM concesion ORDER BY id`);

  const ap = geografia('AREAS PROTEGIDAS', 0, {
    nomb_ap: 'Parque de Prueba', categoria: 'Parque Nacional', zona: 'Núcleo', inst_decla: 'Decreto Legislativo No. 87-87', estado: 'DECLARADA',
  });
  const apCarga = await guardarCapa(ap, { subidoPor: 'pruebas' });
  assert.equal(apCarga.entidades, 1);
  await guardarCapa(
    geografia('MICROCUENCAS DECLARADAS', 1, { nomb_micro: 'El Chorro', nomb_col: 'EUROCLIMA', estado: 'ENP', num_acuer: 'EN PROCESO', pobla_bene: 250 }),
    { subidoPor: 'pruebas' }
  );

  await t.test('la misma capa de geografía subida otra vez no se duplica', async () => {
    const otra = await guardarCapa(ap, { subidoPor: 'pruebas' });
    assert.equal(otra.capaId, 0);
    assert.equal(otra.entidades, 0);
    assert.equal(otra.repetidas, 1);
    const [{ n }] = await consulta<{ n: number }>(`SELECT count(*)::int AS n FROM capa WHERE nombre = 'AREAS PROTEGIDAS'`);
    assert.equal(n, 1);
  });

  await t.test('área protegida en zona núcleo: rojo, con decreto', async () => {
    const [r] = await restriccionesDe([Number(a.id)]);
    assert.equal(r.nivel, 'rojo');
    const i = r.items.find((x) => x.tipo === 'area_protegida');
    assert.ok(i, JSON.stringify(r.items));
    assert.equal(i.nombre, 'Parque de Prueba');
    assert.equal(i.zona, 'Núcleo');
    assert.match(i.instrumento || '', /87-87/);
    assert.ok(i.pct > 99, `pct ${i.pct}`);
    const texto = restriccionesEnTexto(r);
    assert.match(texto, /ROJO/);
    assert.match(texto, /Art\. 48/);
    assert.match(texto, /caseríos y aldeas/, 'sin capa de poblados, lo dice');
  });

  await t.test('microcuenca en trámite: ámbar, con su nombre y no el del colaborador', async () => {
    // Las dos concesiones del fixture se pisan un 25 %: la segunda también toca el área protegida.
    const [r] = await restriccionesDe([Number(b.id)]);
    assert.equal(r.nivel, 'rojo');
    const i = r.items.find((x) => x.tipo === 'microcuenca')!;
    assert.equal(i.nivel, 'ambar');
    assert.ok(r.items.some((x) => x.tipo === 'traslape' && x.nombre === a.nombre), 'y el traslape con la otra, de otro titular');
    assert.equal(i.nombre, 'El Chorro');
    assert.equal(i.zona, 'en proceso');
    assert.match(i.detalle || '', /abastece a 250 personas/);
  });

  await t.test('una capa que ya está entera en el catastro es una cartera', async () => {
    const zonas = structuredClone(capa!);
    zonas.nombre = 'ZONAS EMPRESA CON ANOTACION';
    const r = await guardarCapa(zonas, { subidoPor: 'pruebas' });
    assert.equal(r.concesiones, 0, 'no duplica');
    assert.deepEqual(r.cartera, { nombre: 'ZONAS EMPRESA CON ANOTACION', concesiones: 2 });

    const an = await analizarCartera('empresa');
    assert.ok(!('error' in an));
    assert.equal(an.filas.length, 2);
    assert.deepEqual(an.porNivel, { rojo: 2, ambar: 0, verde: 0 });
    assert.match(carteraEnTexto(an), /2 rojas/);
  });

  await t.test('volver a subir el MISMO catastro no crea una cartera', async () => {
    const r = await guardarCapa({ ...structuredClone(capa!), nombre: 'DERECHOS MINEROS EN HONDURAS A JUNIO 2026' }, { subidoPor: 'pruebas' });
    assert.equal(r.cartera, null);
    assert.equal((await carteras()).length, 1);
  });

  await t.test('un proyecto dibujado sobre un derecho oficial: se ordena como proyecto y el derecho va a su cartera', async () => {
    const proy = structuredClone(capa!);
    proy.nombre = 'MINAS DE ORO I';
    proy.geojson.features = [{ ...(proy.geojson.features as any[])[0], geometry: { ...(proy.geojson.features as any[])[0].geometry, coordinates: mover((proy.geojson.features as any[])[0].geometry.coordinates, 0.000005) } }];
    const r = await guardarCapa(proy, { subidoPor: 'pruebas' });
    assert.equal(r.concesiones, 1);
    await consulta(`UPDATE capa SET carpeta = 'Catastro minero/Proyectos y concesiones' WHERE id = $1`, [r.capaId]);

    const p = await proponer();
    const fila = p.filas.find((f) => f.capaId === r.capaId)!;
    assert.equal(fila.accion, 'proyecto', fila.motivo);
    const hecho = await aplicar(p.filas.map(({ capaId, accion }) => ({ capaId, accion })), 'pruebas');
    assert.ok(hecho.ok, hecho.dicho);
    assert.equal(hecho.concesionesDespues, 2);
    const an = await analizarCartera('proyectos y concesiones');
    assert.ok(!('error' in an), JSON.stringify(an));
    assert.equal(an.filas.length, 1);
    assert.equal(an.filas[0].nombre, a.nombre);
  });

  await cerrarBase();
});
