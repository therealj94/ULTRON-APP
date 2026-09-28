/**
 * Las muestras geoquímicas de JICA: carga (sin duplicar, con validación), los límites del
 * laboratorio («<5», «>10000») que no se pueden presentar como cifras, el GeoJSON del mapa, la
 * tarjeta, la búsqueda por cercanía que usa Dr Electrum y los permisos de las rutas.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import type { AddressInfo } from 'node:net';

process.env.ULTRON_SESION_SECRETO = process.env.ULTRON_SESION_SECRETO || 'secreto-de-sesion-para-pruebas-largo-1234';

const { cargarMuestras, muestrasParaMapa, muestraFicha, muestrasCerca, montarRutasMuestras, textoLey, muestrasDeZonaEnTexto } = await import('../server/electrum/muestras');
const { consulta, hayBase } = await import('../server/electrum/db');
const { emitirSesion } = await import('../server/seguridad');
const { fijarCuentasAprobadas } = await import('../lib/acceso');

const sinBase = hayBase() ? false : 'sin ELECTRUM_DB_URL';

test('textoLey: los límites del laboratorio se dicen como límites', () => {
  assert.equal(textoLey('au', 5, '<'), '<5 ppb');
  assert.equal(textoLey('pb', 10000, '>'), '>10,000 ppm');
  assert.equal(textoLey('ag', 0.2), '0.2 ppm');
  assert.equal(textoLey('cu', 214), '214 ppm');
  assert.equal(textoLey('zn', null), null);
});

// En la Mosquitia, lejos de todo muestreo de JICA: las muestras reales no se mezclan con las de la prueba.
const base = { fuente: 'prueba-muestras', tipo: 'roca' } as const;
const filas = [
  { ...base, codigo: 'PRUEBA001', e: 421561, n: 1579090, lon: -84.5271, lat: 15.2803, au: { v: 16650 }, ag: { v: 19.1 }, as: { v: 7 }, cu: { v: 2 }, hg: { v: 57 }, mo: { v: 3 }, pb: { v: 14 }, sb: { v: 5 }, zn: { v: 3 }, lugar: 'Chanton (S)' },
  { ...base, codigo: 'PRUEBA002', e: 421661, n: 1579190, lon: -84.5262, lat: 15.2812, au: { v: 5, menor: true }, ag: { v: 0.2, menor: true }, pb: { v: 10000, mayor: true } },
  { ...base, tipo: 'sedimento', codigo: 'PRUEBA003', e: 422561, n: 1580090, lon: -84.5178, lat: 15.2893, au: { v: 340 }, ag: { v: 70 }, completa: false },
];

test('muestras: carga sin duplicar, validación, mapa, tarjeta y cercanía', { skip: sinBase }, async () => {
  await cargarMuestras([]); // crea la tabla
  await consulta(`DELETE FROM muestra_geoquimica WHERE fuente = 'prueba-muestras'`);

  const r = await cargarMuestras([
    ...filas,
    { ...base, codigo: 'x', e: 1, n: 1, lon: 0, lat: 0, au: { v: 1 } } as any,
    { ...base, codigo: 'FUERA1', e: 421561, n: 1579090, lon: -70, lat: 14.28, au: { v: 1 } },
    { ...base, codigo: 'SINLEY', e: 421561, n: 1579090, lon: -87.72, lat: 14.28 },
  ]);
  assert.equal(r.guardadas, 3);
  assert.deepEqual(
    r.rechazadas.map((x) => x.motivo),
    ['código inválido', 'fuera de Honduras', 'sin ninguna ley']
  );
  // Volver a cargar corrige, no duplica.
  await cargarMuestras([{ ...filas[0], ag: { v: 19.5 } }]);
  const [{ n }] = await consulta<{ n: number }>(`SELECT count(*)::int AS n FROM muestra_geoquimica WHERE fuente = 'prueba-muestras'`);
  assert.equal(n, 3);

  // El mapa: lo bajo el límite de detección va como 0; lo sobre el tope, con su tope.
  const mapa = (await muestrasParaMapa()) as any;
  const p = (c: string) => mapa.features.find((f: any) => f.properties.c === c)?.properties;
  assert.equal(p('PRUEBA001').au, 16650);
  assert.equal(p('PRUEBA001').ag, 19.5);
  assert.equal(p('PRUEBA002').au, 0);
  assert.equal(p('PRUEBA002').pb, 10000);
  assert.equal(p('PRUEBA003').cu, undefined, 'lo no medido no se inventa');

  // La tarjeta dice los límites como límites.
  const f = await muestraFicha(p('PRUEBA002').id);
  assert.ok(f);
  assert.deepEqual(f!.leyes, [
    ['Au', '<5 ppb'],
    ['Ag', '<0.2 ppm'],
    ['Pb', '>10,000 ppm'],
  ]);
  assert.equal(f!.utm[0], 421661);
  assert.match(f!.datum, /NAD27/);
  assert.equal(await muestraFicha(999999999), null);

  // Cerca de un punto, por oro: la de 16 650 ppb primero y la «<5» al final aunque su 5 pese más que nada.
  const c = await muestrasCerca({ lon: -84.5271, lat: 15.2803, radioKm: 3, elemento: 'au' });
  const mias = c.muestras.filter((m) => m.codigo.startsWith('PRUEBA'));
  assert.deepEqual(
    mias.map((m) => m.codigo),
    ['PRUEBA001', 'PRUEBA003', 'PRUEBA002']
  );
  assert.equal(mias[0].ley, '16,650 ppb');
  assert.equal(mias[2].ley, '<5 ppb');
  // Con mínimo, lo bajo el límite no cuenta como «al menos».
  const altas = await muestrasCerca({ lon: -84.5271, lat: 15.2803, radioKm: 3, elemento: 'au', minimo: 100 });
  assert.deepEqual(
    altas.muestras.filter((m) => m.codigo.startsWith('PRUEBA')).map((m) => m.codigo),
    ['PRUEBA001', 'PRUEBA003']
  );
  const lejos = await muestrasCerca({ lon: -85.0, lat: 15.5, radioKm: 1, elemento: 'au' });
  assert.equal(lejos.muestras.filter((m) => m.codigo.startsWith('PRUEBA')).length, 0);

  // Lo que geologia_zona le pasa a Dr Electrum: las de más oro, los máximos y las advertencias.
  const circulo = { type: 'Polygon', coordinates: [[[-84.53, 15.278], [-84.515, 15.278], [-84.515, 15.292], [-84.53, 15.292], [-84.53, 15.278]]] };
  const dicho = await muestrasDeZonaEnTexto(circulo, 0);
  assert.match(dicho, /^MUESTRAS GEOQUÍMICAS JICA en la zona: \d+ \(/);
  assert.match(dicho, /Más oro: PRUEBA001 \(roca, dentro\) Au 16,650 ppb, Ag 19\.5 ppm; PRUEBA003 \(sedimento, dentro\) Au 340 ppb/);
  assert.doesNotMatch(dicho, /PRUEBA002 \(roca, dentro\) Au/, 'una «<5» no está entre las de más oro');
  assert.match(dicho, /Pb >10,000 ppm \(PRUEBA002\)/);
  assert.match(dicho, /NAD27/);
  const vacio = await muestrasDeZonaEnTexto({ type: 'Point', coordinates: [-85.0, 15.5] }, 1);
  assert.match(vacio, /ninguna en la zona y a 1 km alrededor/);

  await consulta(`DELETE FROM muestra_geoquimica WHERE fuente = 'prueba-muestras'`);
});

test('muestras: rutas con sesión, y cargar solo con nivel de escritura', { skip: sinBase }, async (t) => {
  const llave = process.env.ELECTRUM_CLAVE;
  process.env.ELECTRUM_CLAVE = 'llave-de-prueba-muestras';
  fijarCuentasAprobadas([
    { id: 'lector-mu', nombre: 'Lector', correos: ['lector@mina.hn'], acceso: { electrum: 'lee' } } as any,
    { id: 'obrero-mu', nombre: 'Obrero', correos: ['obrero@mina.hn'], acceso: { electrum: 'escribe' } } as any,
  ]);
  const app = express();
  app.use(express.json({ limit: '12mb' }));
  montarRutasMuestras(app);
  const srv = app.listen(0);
  await new Promise((r) => srv.once('listening', r));
  t.after(async () => {
    srv.close();
    fijarCuentasAprobadas([]);
    if (llave === undefined) delete process.env.ELECTRUM_CLAVE;
    else process.env.ELECTRUM_CLAVE = llave;
    await consulta(`DELETE FROM muestra_geoquimica WHERE fuente = 'prueba-muestras'`);
  });
  const url = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
  const lector = emitirSesion({ correo: 'lector@mina.hn', nombre: 'Lector', rol: 'x' }).token;
  const obrero = emitirSesion({ correo: 'obrero@mina.hn', nombre: 'Obrero', rol: 'x' }).token;
  const pedir = async (ruta: string, token?: string, cuerpo?: unknown) => {
    const r = await fetch(url + ruta, {
      method: cuerpo === undefined ? 'GET' : 'POST',
      headers: { 'content-type': 'application/json', ...(token ? { 'x-ultron-sesion': token } : {}) },
      body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
    });
    return { status: r.status, json: (await r.json().catch(() => ({}))) as any };
  };

  assert.equal((await pedir('/api/electrum/mapa/muestras')).status, 401);
  assert.equal((await pedir('/api/electrum/muestras/cargar', lector, { muestras: filas })).status, 403);
  assert.equal((await pedir('/api/electrum/muestras/cargar', obrero, { nada: 1 })).status, 400);
  const c = await pedir('/api/electrum/muestras/cargar', obrero, { muestras: filas });
  assert.equal(c.status, 200);
  assert.equal(c.json.guardadas, 3);

  const m = await pedir('/api/electrum/mapa/muestras', lector);
  assert.equal(m.status, 200);
  const una = m.json.features.find((f: any) => f.properties.c === 'PRUEBA003');
  assert.ok(una);
  assert.deepEqual(una.geometry.coordinates, [-84.5178, 15.2893]);
  const ficha = await pedir(`/api/electrum/mapa/muestra/${una.properties.id}`, lector);
  assert.equal(ficha.status, 200);
  assert.equal(ficha.json.codigo, 'PRUEBA003');
  assert.equal(ficha.json.completa, false);
  assert.equal((await pedir('/api/electrum/mapa/muestra/abc', lector)).status, 400);
  assert.equal((await pedir('/api/electrum/mapa/muestra/999999999', lector)).status, 404);
});
