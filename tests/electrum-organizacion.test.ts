/**
 * Auditoría H14, decidido por José: Dr Electrum recibe expedientes de clientes distintos, así que lo
 * de un cliente no lo ve otro. Aquí, con PostGIS y datos sintéticos: la casa (Orden Global) y un
 * cliente (mina.hn) cargan documentos y capas, y cada uno ve lo suyo más lo común.
 *
 * Necesita ELECTRUM_DB_URL; sin base, se salta lo que toca la base.
 */
import './datos-prueba'; // la junta inventada de las pruebas (lo real vive en Render)
import test from 'node:test';
import assert from 'node:assert/strict';
import { buscarEnExpedientes, cerrarBase, consulta, hayBase, leerSeguido } from '../server/electrum/db';
import { aprender } from '../server/electrum/aprender';
import { anotar, bitacora, eliminar } from '../server/electrum/biblioteca';
import { rasgoParaMapa } from '../server/electrum/explorar';
import { capasPorRol } from '../server/electrum/entorno';
import { asegurarOrganizacion, CASA, conOrganizacion, organizacionDePersona, slugOrganizacion } from '../server/electrum/organizacion';

test('de qué organización es cada persona', () => {
  assert.equal(organizacionDePersona({ id: 'jose', correos: ['jose.h@ordenglobal.org'] }), CASA);
  assert.equal(organizacionDePersona({ id: 'tg', correos: [] }), CASA, 'la junta por Telegram, sin correo, es de la casa');
  assert.equal(organizacionDePersona({ id: 'perez', correos: ['perez@mina.hn'], origen: 'web' }), 'mina.hn');
  assert.equal(organizacionDePersona({ id: 'ana', correos: ['ana@gmail.com'], origen: 'web' }), 'persona-ana', 'dos cuentas de gmail no son colegas');
  assert.equal(organizacionDePersona({ id: 'jo', correos: ['jo@ordenglobal.org'], origen: 'web' }), CASA);
  assert.equal(organizacionDePersona({ id: 'x', correos: ['x@mina.hn'], organizacion: 'Minas del Norte' }), 'minas-del-norte', 'lo que diga el padrón manda');
  // Quien José puso a mano en el padrón es su equipo: sigue viendo lo de la casa aunque su correo sea otro.
  assert.equal(organizacionDePersona({ id: 'carga', correos: ['carga@mina.hn'] }), CASA);
  assert.equal(organizacionDePersona({ id: 'cli', correos: ['cli@mina.hn'], organizacion: 'mina.hn' }), 'mina.hn', 'a un cliente del padrón se le pone la organización');
  assert.equal(slugOrganizacion("x'; DROP TABLE documento; --"), 'x-drop-table-documento');
});

const SIN_BASE = hayBase() ? false : 'sin ELECTRUM_DB_URL';
const CLIENTE = 'mina.hn';
const OTRO = 'otra-empresa.hn';
const TEXTO = Buffer.from('Informe técnico de la veta Quebrada Seca. La ley media de oro es 3,4 g/t en el muestreo de canal.\n'.repeat(20));

test('cada organización ve lo suyo', { skip: SIN_BASE }, async (t) => {
  await consulta('TRUNCATE fragmento, documento, traslape, concesion, entidad_geo, capa RESTART IDENTITY CASCADE');
  await asegurarOrganizacion();

  // La casa carga su informe (como hasta ahora: sin marca) y el cliente sube EL MISMO archivo.
  const casa = await conOrganizacion(CASA, () => aprender('informe-quebrada.txt', TEXTO, { subidoPor: 'jose' }));
  const cli = await conOrganizacion(CLIENTE, () => aprender('informe-quebrada.txt', TEXTO, { subidoPor: 'perez' }));

  await t.test('el mismo archivo entra como del cliente, no como «ya estaba» de la casa', () => {
    assert.equal(casa.clase, 'documento');
    assert.doesNotMatch(cli.dicho, /ya estaba/);
    assert.notEqual((cli.ui as any).documento_id, (casa.ui as any).documento_id);
  });

  const idCasa = Number((casa.ui as any).documento_id);
  const idCli = Number((cli.ui as any).documento_id);

  await t.test('la búsqueda solo trae lo de la organización de quien pregunta', async () => {
    const deCli = await conOrganizacion(CLIENTE, () => buscarEnExpedientes('Quebrada Seca oro', 10));
    assert.ok(deCli.length > 0);
    assert.ok(deCli.every((h) => h.documentoId === idCli), 'el cliente no ve el de la casa');
    const deCasa = await conOrganizacion(CASA, () => buscarEnExpedientes('Quebrada Seca oro', 10));
    assert.ok(deCasa.every((h) => h.documentoId === idCasa), 'la casa no ve el del cliente');
    const deOtro = await conOrganizacion(OTRO, () => buscarEnExpedientes('Quebrada Seca oro', 10));
    assert.deepEqual(deOtro, [], 'un tercero no ve nada de ninguno');
  });

  await t.test('leer un documento ajeno por su número no funciona', async () => {
    const r = await conOrganizacion(CLIENTE, () => leerSeguido(`#${idCasa}`));
    assert.equal(r.ok, false);
    const propio = await conOrganizacion(CLIENTE, () => leerSeguido(`#${idCli}`));
    assert.equal(propio.ok, true);
  });

  await t.test('un cliente no borra lo de la casa', async () => {
    const r = await conOrganizacion(CLIENTE, () => eliminar([{ clase: 'documento', id: idCasa }], 'perez'));
    assert.equal(r.eliminados, 0);
    const [{ n }] = await consulta<{ n: number }>(`SELECT count(*)::int AS n FROM documento WHERE id = $1`, [idCasa]);
    assert.equal(n, 1);
  });

  await t.test('una capa del cliente es de proyecto y suya; las comunes las ven todos', async () => {
    await consulta(
      `INSERT INTO capa (nombre, formato, origen_crs, rol, entidades) VALUES ('Áreas protegidas sintéticas', 'geojson', 'EPSG:4326', 'area_protegida', 1)`
    );
    await consulta(
      `INSERT INTO entidad_geo (capa_id, nombre, geom) VALUES (1, 'Parque sintético', ST_MakeEnvelope(-87, 14, -86.9, 14.1, 4326))`
    );
    const geo = {
      type: 'FeatureCollection',
      features: [
        { type: 'Feature', properties: { NOMBRE: 'Bloque propio', TITULAR: 'Mina HN', EXPEDIENTE: '999' }, geometry: { type: 'Polygon', coordinates: [[[-86.5, 14.5], [-86.49, 14.5], [-86.49, 14.51], [-86.5, 14.51], [-86.5, 14.5]]] } },
      ],
    };
    const r = await conOrganizacion(CLIENTE, () => aprender('bloque-propio.geojson', Buffer.from(JSON.stringify(geo)), { subidoPor: 'perez' }));
    assert.notEqual(r.clase, 'nada', r.dicho);
    const [capa] = await consulta<{ organizacion: string; rol: string }>(`SELECT organizacion, rol FROM capa WHERE nombre ILIKE 'bloque-propio%'`);
    assert.equal(capa.organizacion, CLIENTE);
    assert.equal(capa.rol, 'proyecto');
    const [{ n }] = await consulta<{ n: number }>(`SELECT count(*)::int AS n FROM concesion`);
    assert.equal(n, 0, 'no entra al padrón nacional que ven todos');
    const delCliente = await conOrganizacion(CLIENTE, () => capasPorRol());
    const deOtro = await conOrganizacion(OTRO, () => capasPorRol());
    assert.ok(delCliente.some((c) => c.rol === 'proyecto'));
    assert.ok(!deOtro.some((c) => c.rol === 'proyecto'), 'otro cliente no ve el proyecto ajeno');
    assert.ok(deOtro.some((c) => c.rol === 'area_protegida'), 'las comunes sí');
  });

  // Revisión de Codex en #87: el detalle de un rasgo se pedía por id sin mirar de quién era la capa.
  await t.test('el detalle de un rasgo de un proyecto ajeno no se entrega por su número', async () => {
    const [e] = await consulta<{ id: number }>(
      `SELECT e.id::int AS id FROM entidad_geo e JOIN capa k ON k.id = e.capa_id WHERE k.organizacion = $1 LIMIT 1`,
      [CLIENTE]
    );
    assert.ok(e, 'el proyecto del cliente tiene rasgos');
    assert.ok(await conOrganizacion(CLIENTE, () => rasgoParaMapa(e.id)), 'el dueño lo ve');
    assert.equal(await conOrganizacion(OTRO, () => rasgoParaMapa(e.id)), null, 'otro cliente no');
  });

  // Revisión de Codex en #87: la bitácora es de todos los usuarios y llevaba nombres de informes ajenos.
  await t.test('la bitácora de cada organización es suya', async () => {
    await conOrganizacion(CLIENTE, () => anotar('perez', 'informe_demo', 'informe-secreto-del-cliente.pdf'));
    await conOrganizacion(CASA, () => anotar('jose', 'informe_demo', 'informe-de-la-casa.pdf'));
    const deOtro = await conOrganizacion(OTRO, () => bitacora(50));
    assert.ok(!deOtro.some((b) => /secreto|de-la-casa/.test(b.objeto)), 'un tercero no ve lo de nadie');
    const delCliente = await conOrganizacion(CLIENTE, () => bitacora(50));
    assert.ok(delCliente.some((b) => /secreto/.test(b.objeto)));
    assert.ok(!delCliente.some((b) => /de-la-casa/.test(b.objeto)));
  });

  await consulta('TRUNCATE fragmento, documento, traslape, concesion, entidad_geo, capa RESTART IDENTITY CASCADE');
  await cerrarBase();
});
