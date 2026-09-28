/**
 * Lo que Sentinel-2 midió en cada concesión: carga validada (sin inventar concesiones que no
 * están), el texto con sus límites que ven la ficha y Dr Electrum, y los permisos de la ruta.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import type { AddressInfo } from 'node:net';

process.env.ULTRON_SESION_SECRETO = process.env.ULTRON_SESION_SECRETO || 'secreto-de-sesion-para-pruebas-largo-1234';

const { cargarSatelite, sateliteEnRenglones, montarRutasSatelite } = await import('../server/electrum/satelite');
const { fichaParaMapa } = await import('../server/electrum/explorar');
const { consulta, hayBase } = await import('../server/electrum/db');
const { emitirSesion } = await import('../server/seguridad');
const { fijarCuentasAprobadas } = await import('../lib/acceso');

const sinBase = hayBase() ? false : 'sin ELECTRUM_DB_URL';

async function concesionDePrueba(nombre: string): Promise<number> {
  await consulta(`DELETE FROM concesion WHERE nombre = $1`, [nombre]);
  const [r] = await consulta<{ id: string }>(
    `INSERT INTO concesion (nombre, geom) VALUES ($1, ST_Multi(ST_GeomFromText('POLYGON((-84.53 15.28, -84.52 15.28, -84.52 15.29, -84.53 15.29, -84.53 15.28))', 4326))) RETURNING id::text`,
    [nombre]
  );
  return Number(r.id);
}

const medido = { ha: 118.2, ha_comparable: 110.5, veg: [4.3, 1.5, 0.6], ha_expuesto: 12.4, arc: [2.2, 0.9, 0.3], fe: [0, 0, 0] };

test('satélite: carga, concesiones que no están, texto con límites y ficha', { skip: sinBase }, async () => {
  const id = await concesionDePrueba('prueba-sat-1');
  const r = await cargarSatelite(
    [
      { id, datos: medido as any },
      { id: 999999999, datos: medido as any },
      { id, datos: { ...medido, veg: [1, 2] } as any },
      { id: -1, datos: medido as any },
    ],
    'temporada seca 2025 → 2026',
    'Copernicus Sentinel-2 L2A'
  );
  assert.equal(r.guardadas, 1);
  assert.equal(r.fuera_del_catastro, 1, 'una concesión que no está no se inventa');
  assert.deepEqual(
    r.rechazadas.map((x) => x.motivo),
    ['datos incompletos', 'id inválido']
  );

  const t = (await sateliteEnRenglones(id)).join('\n');
  assert.match(t, /^Copernicus Sentinel-2 L2A, temporada seca 2025 → 2026; píxel de 40 m\./);
  assert.match(t, /Caída de vegetación densa: 6\.4 ha \(5\.8 % de las 111 ha comparables; moderada 4\.3, fuerte 1\.5, muy fuerte 0\.6\)/);
  assert.match(t, /quema, sequía o cosecha/);
  assert.match(t, /Suelo expuesto: 12 ha de 118\. Anomalía de arcillas \(alteración argílica\/sericítica\): 3\.4 ha, 1\.2 alta o muy alta\. Óxidos de hierro: ninguna\./);
  assert.match(t, /no un hallazgo/);

  // Volver a cargar reemplaza.
  await cargarSatelite([{ id, datos: { ...medido, veg: [0, 0, 0], ha_expuesto: 0 } as any }], 'otra', 'Copernicus Sentinel-2 L2A');
  const t2 = (await sateliteEnRenglones(id)).join('\n');
  assert.match(t2, /Sin caída de vegetación densa en las 111 ha comparables/);
  assert.match(t2, /Sin suelo expuesto: bajo la vegetación el satélite no ve la roca/);

  // La ficha del mapa lo trae; una concesión sin medir lo dice.
  const f = await fichaParaMapa(id);
  assert.equal(f?.satelite.estado, 'ok');
  assert.match((f?.satelite as any).renglones.join(' '), /Sin caída de vegetación densa/);
  const otra = await concesionDePrueba('prueba-sat-2');
  const f2 = await fichaParaMapa(otra);
  assert.deepEqual((f2?.satelite as any).renglones, ['Esta concesión todavía no se midió con Sentinel-2.']);

  // Borrar la concesión borra lo medido.
  await consulta(`DELETE FROM concesion WHERE id = ANY($1)`, [[id, otra]]);
  const [{ n }] = await consulta<{ n: number }>(`SELECT count(*)::int AS n FROM satelite_concesion WHERE concesion_id = $1`, [id]);
  assert.equal(n, 0);
});

test('satélite: cargar solo con nivel de escritura', { skip: sinBase }, async (t) => {
  const llave = process.env.ELECTRUM_CLAVE;
  process.env.ELECTRUM_CLAVE = 'llave-de-prueba-satelite';
  fijarCuentasAprobadas([
    { id: 'lector-sat', nombre: 'Lector', correos: ['lector@mina.hn'], acceso: { electrum: 'lee' } } as any,
    { id: 'obrero-sat', nombre: 'Obrero', correos: ['obrero@mina.hn'], acceso: { electrum: 'escribe' } } as any,
  ]);
  const id = await concesionDePrueba('prueba-sat-3');
  const app = express();
  app.use(express.json());
  montarRutasSatelite(app);
  const srv = app.listen(0);
  await new Promise((r) => srv.once('listening', r));
  t.after(async () => {
    srv.close();
    fijarCuentasAprobadas([]);
    if (llave === undefined) delete process.env.ELECTRUM_CLAVE;
    else process.env.ELECTRUM_CLAVE = llave;
    await consulta(`DELETE FROM concesion WHERE id = $1`, [id]);
  });
  const url = `http://127.0.0.1:${(srv.address() as AddressInfo).port}/api/electrum/satelite/cargar`;
  const post = async (token: string | null, cuerpo: unknown) =>
    (await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', ...(token ? { 'x-ultron-sesion': token } : {}) }, body: JSON.stringify(cuerpo) })).status;
  const cuerpo = { concesiones: [{ id, datos: medido }], periodo: 'temporada seca 2025 → 2026', fuente: 'Copernicus Sentinel-2 L2A' };
  assert.equal(await post(null, cuerpo), 401);
  assert.equal(await post(emitirSesion({ correo: 'lector@mina.hn', nombre: 'Lector', rol: 'x' }).token, cuerpo), 403);
  const obrero = emitirSesion({ correo: 'obrero@mina.hn', nombre: 'Obrero', rol: 'x' }).token;
  assert.equal(await post(obrero, { concesiones: [] }), 400);
  assert.equal(await post(obrero, cuerpo), 200);
});
