/**
 * Catastro en PostGIS, contra una base de verdad.
 *
 * Estas pruebas necesitan un PostgreSQL con PostGIS. Sin ELECTRUM_DB_URL se saltan, porque no vale
 * la pena tumbar el CI por una dependencia de infraestructura; lo que NO se hace es fingir que
 * pasaron. Para correrlas:
 *
 *   ELECTRUM_DB_URL=postgres://usuario@host:5432/electrum npx tsx --test tests/electrum-db.test.ts
 *
 * Lo que de verdad comprueban: que PostGIS y el motor GIS de TypeScript dan el MISMO número. Son
 * dos implementaciones independientes del área geodésica —ST_Area sobre geography por un lado, la
 * esfera autálica de Snyder por el otro—; si coinciden hasta el centésimo de hectárea, las dos están
 * bien. Si un día alguien rompe una, la otra lo delata.
 */
/*
 * AVISO: estas pruebas VACÍAN la base a la que apuntes.
 *
 * Cargan su propio catastro de dos concesiones y truncan lo que haya. Apuntarlas a una base con
 * datos de verdad los borra sin preguntar. Cuesta una tarde descubrirlo por el camino torcido:
 * levantar la web contra esa base, ver el mapa con dos polígonos donde había mil, y dedicarse a
 * buscar un fallo de dibujo que no existía —el mapa pintaba correctamente lo poco que le quedaba—.
 *
 * Para trabajar con datos reales y probar a la vez, usa DOS bases distintas.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { aprender } from '../server/electrum/aprender';
import { manosDe } from '../server/electrum/manos';
import { areaHectareas, ingerir, traslapesEnCapa } from '../server/electrum/gis';
import {
  buscarConcesiones,
  buscarEnExpedientes,
  capaGeojson,
  cerrarBase,
  cercaDe,
  concesionEnPunto,
  consulta,
  geometriaDe,
  guardarCapa,
  hayBase,
  recalcularTraslapes,
  saludBase,
  traslapes,
} from '../server/electrum/db';

const HAY = hayBase();
const cerca = (a: number, b: number, tol: number) => assert.ok(Math.abs(a - b) <= tol, `${a} no está cerca de ${b} (±${tol})`);

test('catastro en PostGIS', { skip: HAY ? false : 'sin ELECTRUM_DB_URL: no hay base contra la que probar' }, async (t) => {
  const zip = fs.readFileSync(path.join(process.cwd(), 'tests', 'fixtures', 'gis', 'catastro.zip'));
  const { capa, avisos } = await ingerir('catastro.zip', zip);
  assert.ok(capa);

  // Base limpia: estas pruebas mandan sobre su propio contenido.
  await consulta('TRUNCATE traslape, concesion, entidad_geo, capa RESTART IDENTITY CASCADE');
  const carga = await guardarCapa(capa!, { avisos, subidoPor: 'pruebas' });

  await t.test('la base está viva y con PostGIS', async () => {
    const s = await saludBase();
    assert.equal(s.viva, true, s.motivo);
    assert.match(String(s.postgis), /^3\./);
    assert.equal(s.concesiones, 2);
  });

  await t.test('entran las dos concesiones con sus campos del .dbf', async () => {
    assert.equal(carga.concesiones, 2);
    const filas = await consulta<{ nombre: string; expediente: string; titular: string }>(
      'SELECT nombre, expediente, titular FROM concesion ORDER BY id'
    );
    assert.deepEqual(filas.map((f) => f.expediente), ['EXP-2021-0442', 'EXP-2019-0118']);
    assert.equal(filas[0].nombre, 'Quebrada Seca');
    assert.match(filas[1].titular, /Andina/);
  });

  await t.test('PostGIS y el motor de TypeScript miden lo mismo', async () => {
    const [fila] = await consulta<{ guardada: number; postgis: number }>(
      `SELECT hectareas::float8 AS guardada, ha_elipsoide(geom)::float8 AS postgis
       FROM concesion ORDER BY id LIMIT 1`
    );
    const enTs = areaHectareas(capa!.geojson.features[0]);
    // Dos implementaciones independientes del área geodésica: tienen que coincidir.
    cerca(fila.postgis, enTs, 0.01);
    cerca(fila.guardada, enTs, 0.0001);
    cerca(fila.postgis, 400.3, 0.4);
  });

  await t.test('guarda el área declarada aparte, para poder contrastarla', async () => {
    const [f] = await consulta<{ dec: number; med: number }>(
      'SELECT hectareas_dec::float8 AS dec, hectareas::float8 AS med FROM concesion ORDER BY id LIMIT 1'
    );
    assert.equal(f.dec, 400);
    assert.ok(f.med > f.dec, 'la medida sobre el elipsoide debe ser mayor que la declarada en la cuadrícula');
  });

  await t.test('guarda los atributos originales completos', async () => {
    const [f] = await consulta<{ a: any }>('SELECT atributos AS a FROM concesion ORDER BY id LIMIT 1');
    assert.equal(f.a.EXPEDIENTE, 'EXP-2021-0442');
    assert.equal(f.a.HECTAREAS, 400);
  });

  await t.test('el traslape que calcula la base coincide con el del motor', async () => {
    const n = await recalcularTraslapes();
    assert.equal(n, 1);
    const [t1] = await traslapes();
    assert.equal(t1.a, 'Quebrada Seca');
    assert.equal(t1.b, 'Cerro Partido');
    cerca(t1.hectareas, traslapesEnCapa(capa!)[0].hectareas, 0.01);
    cerca(t1.hectareas, 100.07, 0.2);
  });

  await t.test('búsqueda tolerante: encuentra aunque esté mal escrito', async () => {
    const r = await buscarConcesiones('Quebrda Seca');
    assert.ok(r.length, 'debería encontrar Quebrada Seca con un error de tecleo');
    assert.equal(r[0].nombre, 'Quebrada Seca');
  });

  await t.test('búsqueda por titular y por expediente exacto', async () => {
    assert.ok((await buscarConcesiones('Andina')).some((c) => c.nombre === 'Cerro Partido'));
    const porExp = await buscarConcesiones('EXP-2019-0118');
    assert.equal(porExp[0].nombre, 'Cerro Partido');
  });

  await t.test('qué concesión cubre este punto', async () => {
    const g = await geometriaDe(1);
    assert.ok(g);
    const [lon, lat] = g!.centro;
    const aqui = await concesionEnPunto(lon, lat);
    assert.ok(aqui.some((c) => c.nombre === 'Quebrada Seca'));
    assert.equal((await concesionEnPunto(-87.9, 14.9)).length, 0);
  });

  await t.test('qué hay cerca, medido sobre el elipsoide', async () => {
    const g = await geometriaDe(1);
    const [lon, lat] = g!.centro;
    const cercanas = await cercaDe(lon, lat, 5);
    assert.equal(cercanas.length, 2, 'las dos están a menos de cinco kilómetros');
    assert.ok(cercanas[0].km < cercanas[1].km, 'deben venir ordenadas por distancia');
    assert.equal(cercanas[0].km, 0, 'la que contiene al punto está a cero');
  });

  await t.test('la capa sale como GeoJSON lista para el mapa', async () => {
    const fc = await capaGeojson(carga.capaId);
    assert.equal(fc.type, 'FeatureCollection');
    assert.equal(fc.features.length, 2);
    assert.equal((fc.features[0].properties as any).nombre, 'Quebrada Seca');
    assert.ok((fc.features[0].geometry as any).coordinates.length);
  });

  await t.test('el encuadre sirve para volar el mapa', async () => {
    const g = await geometriaDe(1);
    const [o, s, e, n] = g!.encuadre;
    assert.ok(o < e && s < n);
    cerca(s, 14.02, 0.05);
  });

  await t.test('cargar el MISMO archivo dos veces no duplica el catastro', async () => {
    // Pasó de verdad en la primera carga: 4 concesiones y «Quebrada Seca se traslapa con Quebrada
    // Seca» al 100 %. Con eso, un padrón entero parece un desastre de superposiciones que no existe.
    const otra = await guardarCapa(capa!, { avisos, subidoPor: 'pruebas' });
    assert.equal(otra.concesiones, 0, 'no debió entrar ninguna');
    assert.equal(otra.repetidas, 2, 'debió reconocer las dos como ya cargadas');
    const [{ n }] = await consulta<{ n: string }>('SELECT count(*)::text AS n FROM concesion');
    assert.equal(n, '2');
    assert.equal(await recalcularTraslapes(), 1, 'sigue habiendo un solo traslape, no cuatro');
  });

  // ── Reanudar una carga grande ───────────────────────────────────────────────────────────────
  //
  // 1,2 GB de expedientes no entran de una sentada: se corta la red, se cae la sesión, alguien hace
  // Ctrl-C. Relanzar tiene que continuar, no volver a meterlo todo. Sin esto, una búsqueda devolvía
  // la misma cita dos y tres veces con páginas idénticas.
  await t.test('el mismo documento no entra dos veces', async () => {
    const datos = Buffer.from(
      'Informe de reanudacion. La veta principal buza sesenta y ocho grados al noreste y se reconoce ' +
        'en superficie a lo largo de mil cuatrocientos metros de corrida continua, con clavos ' +
        'mineralizados de ley variable entre dos y siete gramos por tonelada de oro.'
    );
    const a = await aprender('reanudar.txt', datos);
    assert.equal(a.clase, 'documento');
    assert.ok(!(a.ui as any)?.repetido, 'la primera vez tiene que entrar');

    const b = await aprender('reanudar.txt', datos);
    assert.equal((b.ui as any)?.repetido, true, 'la segunda vez tiene que saltarse');

    const [n] = await consulta<{ n: string }>(`SELECT count(*)::text AS n FROM documento WHERE nombre = 'reanudar.txt'`);
    assert.equal(n.n, '1');
  });

  await t.test('el mismo contenido con otro nombre tampoco entra dos veces', async () => {
    const datos = Buffer.from(
      'Padron de patentes. El titular mantiene al dia el pago correspondiente al periodo en curso y ' +
        'acredita el cumplimiento de las obligaciones de amparo sobre la totalidad de las pertenencias.'
    );
    await aprender('patentes.txt', datos);
    const otra = await aprender('patentes (1).txt', datos);
    assert.equal((otra.ui as any)?.repetido, true, 'el papel es el mismo aunque el archivo se llame distinto');
  });

  await t.test('lo cargado antes de que existiera la huella se adopta, no se duplica', async () => {
    const datos = Buffer.from(
      'Resolucion antigua. Se autoriza el plan de labores presentado por el titular para la vigencia ' +
        'solicitada, sujeto a las condiciones de seguridad minera que se detallan en el anexo tecnico.'
    );
    await aprender('antigua.txt', datos);
    // Así se ve una fila cargada por la versión anterior del cargador: sin huella.
    await consulta(`UPDATE documento SET huella = NULL WHERE nombre = 'antigua.txt'`);

    const otra = await aprender('antigua.txt', datos);
    assert.equal((otra.ui as any)?.repetido, true);
    const [f] = await consulta<{ n: string; conH: string }>(
      `SELECT count(*)::text AS n, count(huella)::text AS "conH" FROM documento WHERE nombre = 'antigua.txt'`
    );
    assert.equal(f.n, '1', 'no se duplicó');
    assert.equal(f.conH, '1', 'y quedó con huella, para no volver a pasar por aquí');
  });

  await t.test('un documento distinto que se llama igual NO se adopta', async () => {
    // El punto flojo de adoptar por nombre: dos resoluciones distintas se llaman igual y tienen una
    // página. Si esto se rompiera, un expediente real se perdería en silencio, que es peor que
    // duplicarlo.
    const uno = Buffer.from(
      'Se aprueba la solicitud de la concesion Rio Claro por encontrarse acreditado el pago integro ' +
        'de la patente correspondiente al periodo, segun consta en el registro regional respectivo.'
    );
    const otro = Buffer.from(
      'Se rechaza la solicitud de la concesion Rio Claro por no acreditar el pago de la patente ' +
        'correspondiente al periodo, segun consta en el expediente administrativo del registro.'
    );
    await aprender('homonima.txt', uno);
    await consulta(`UPDATE documento SET huella = NULL WHERE nombre = 'homonima.txt'`);

    const r = await aprender('homonima.txt', otro);
    assert.ok(!(r.ui as any)?.repetido, 'no es el mismo papel: tiene que entrar');
    const [f] = await consulta<{ n: string }>(`SELECT count(*)::text AS n FROM documento WHERE nombre = 'homonima.txt'`);
    assert.equal(f.n, '2');
  });

  // ── Un padrón sin fechas no es un padrón tranquilo ──────────────────────────────────────────
  //
  // El catastro nacional de Honduras no trae ni una fecha de vencimiento en sus 1079 concesiones, y
  // la herramienta contestaba «ninguna concesión vence en los próximos 365 días» con toda calma.
  // Es la misma respuesta vacía para dos cosas opuestas: «no vence nada» tranquiliza, «no hay
  // fechas» avisa de que falta un dato. Decir la primera cuando pasa la segunda es mentir.
  await t.test('sin fechas cargadas, no dice que no vence nada: dice que no se sabe', async () => {
    const [n] = await consulta<{ n: string }>(`SELECT count(*)::text AS n FROM concesion WHERE vence IS NOT NULL`);
    if (Number(n.n) > 0) return; // hay fechas: este caso no aplica en esta base

    const [hay] = await consulta<{ n: string }>(`SELECT count(*)::text AS n FROM concesion`);
    if (!Number(hay.n)) return; // sin concesiones tampoco aplica

    const herramienta = manosDe(['catastro_vencimientos'])[0];
    assert.ok(herramienta, 'la herramienta tiene que existir');
    const r = await herramienta.ejecutar({ dias: 365 }, {} as never);
    assert.match(r.texto, /no traen? fecha|no puedo decirlo/i, `contestó: ${r.texto}`);
    assert.doesNotMatch(r.texto, /^Ninguna concesión vence/, 'eso sería tranquilizar sin saber');
  });

  t.after(async () => {
    await consulta(
      `DELETE FROM documento WHERE nombre IN ('reanudar.txt','patentes.txt','patentes (1).txt','antigua.txt','homonima.txt')`
    );
    await cerrarBase();
  });
});

test('búsqueda en expedientes', { skip: HAY ? false : 'sin ELECTRUM_DB_URL' }, async (t) => {
  await consulta('TRUNCATE documento, fragmento RESTART IDENTITY CASCADE');
  const [doc] = await consulta<{ id: number }>(
    `INSERT INTO documento (nombre, tipo, paginas) VALUES ('informe.txt','43-101',2) RETURNING id`
  );
  await consulta(
    `INSERT INTO fragmento (documento_id, pagina, orden, texto) VALUES ($1,1,0,$2), ($1,2,1,$3)`,
    [
      doc.id,
      'Se ejecutaron catorce sondajes diamantinos. La ley media ponderada del recurso inferido es de 3,4 gramos por tonelada de oro.',
      'El recurso permanece en categoría inferida. No se ha declarado reserva alguna y no existe estudio de prefactibilidad.',
    ]
  );

  await t.test('una PREGUNTA encuentra, no solo palabras sueltas', async () => {
    // websearch_to_tsquery une todo con Y, y «cuál» no es palabra vacía en español: preguntar
    // «¿cuál es la ley media?» exigía que el documento dijera literalmente «cuál». No encontraba nada.
    const r = await buscarEnExpedientes('¿cuál es la ley media del recurso?');
    assert.ok(r.length, 'una pregunta normal debe encontrar algo');
    assert.match(r[0].texto, /ley media ponderada/);
  });

  await t.test('la cita sale centrada en la coincidencia, no en el principio del trozo', async () => {
    const r = await buscarEnExpedientes('reserva declarada');
    assert.ok(r.length);
    assert.match(r[0].texto, /reserva/);
  });

  await t.test('la cita trae la página, que es lo que la hace comprobable', async () => {
    const r = await buscarEnExpedientes('prefactibilidad');
    assert.equal(r[0].pagina, 2);
    assert.equal(r[0].documento, 'informe.txt');
  });

  await t.test('lo que no está, no se inventa', async () => {
    assert.deepEqual(await buscarEnExpedientes('uranio en Marte'), []);
  });

  // ── Reanudar una carga grande ───────────────────────────────────────────────────────────────
  //
  // 1,2 GB de expedientes no entran de una sentada: se corta la red, se cae la sesión, alguien hace
  // Ctrl-C. Relanzar tiene que continuar, no volver a meterlo todo. Sin esto, una búsqueda devolvía
  // la misma cita dos y tres veces con páginas idénticas.
  await t.test('el mismo documento no entra dos veces', async () => {
    const datos = Buffer.from(
      'Informe de reanudacion. La veta principal buza sesenta y ocho grados al noreste y se reconoce ' +
        'en superficie a lo largo de mil cuatrocientos metros de corrida continua, con clavos ' +
        'mineralizados de ley variable entre dos y siete gramos por tonelada de oro.'
    );
    const a = await aprender('reanudar.txt', datos);
    assert.equal(a.clase, 'documento');
    assert.ok(!(a.ui as any)?.repetido, 'la primera vez tiene que entrar');

    const b = await aprender('reanudar.txt', datos);
    assert.equal((b.ui as any)?.repetido, true, 'la segunda vez tiene que saltarse');

    const [n] = await consulta<{ n: string }>(`SELECT count(*)::text AS n FROM documento WHERE nombre = 'reanudar.txt'`);
    assert.equal(n.n, '1');
  });

  await t.test('el mismo contenido con otro nombre tampoco entra dos veces', async () => {
    const datos = Buffer.from(
      'Padron de patentes. El titular mantiene al dia el pago correspondiente al periodo en curso y ' +
        'acredita el cumplimiento de las obligaciones de amparo sobre la totalidad de las pertenencias.'
    );
    await aprender('patentes.txt', datos);
    const otra = await aprender('patentes (1).txt', datos);
    assert.equal((otra.ui as any)?.repetido, true, 'el papel es el mismo aunque el archivo se llame distinto');
  });

  await t.test('lo cargado antes de que existiera la huella se adopta, no se duplica', async () => {
    const datos = Buffer.from(
      'Resolucion antigua. Se autoriza el plan de labores presentado por el titular para la vigencia ' +
        'solicitada, sujeto a las condiciones de seguridad minera que se detallan en el anexo tecnico.'
    );
    await aprender('antigua.txt', datos);
    // Así se ve una fila cargada por la versión anterior del cargador: sin huella.
    await consulta(`UPDATE documento SET huella = NULL WHERE nombre = 'antigua.txt'`);

    const otra = await aprender('antigua.txt', datos);
    assert.equal((otra.ui as any)?.repetido, true);
    const [f] = await consulta<{ n: string; conH: string }>(
      `SELECT count(*)::text AS n, count(huella)::text AS "conH" FROM documento WHERE nombre = 'antigua.txt'`
    );
    assert.equal(f.n, '1', 'no se duplicó');
    assert.equal(f.conH, '1', 'y quedó con huella, para no volver a pasar por aquí');
  });

  await t.test('un documento distinto que se llama igual NO se adopta', async () => {
    // El punto flojo de adoptar por nombre: dos resoluciones distintas se llaman igual y tienen una
    // página. Si esto se rompiera, un expediente real se perdería en silencio, que es peor que
    // duplicarlo.
    const uno = Buffer.from(
      'Se aprueba la solicitud de la concesion Rio Claro por encontrarse acreditado el pago integro ' +
        'de la patente correspondiente al periodo, segun consta en el registro regional respectivo.'
    );
    const otro = Buffer.from(
      'Se rechaza la solicitud de la concesion Rio Claro por no acreditar el pago de la patente ' +
        'correspondiente al periodo, segun consta en el expediente administrativo del registro.'
    );
    await aprender('homonima.txt', uno);
    await consulta(`UPDATE documento SET huella = NULL WHERE nombre = 'homonima.txt'`);

    const r = await aprender('homonima.txt', otro);
    assert.ok(!(r.ui as any)?.repetido, 'no es el mismo papel: tiene que entrar');
    const [f] = await consulta<{ n: string }>(`SELECT count(*)::text AS n FROM documento WHERE nombre = 'homonima.txt'`);
    assert.equal(f.n, '2');
  });

  t.after(async () => {
    await consulta(
      `DELETE FROM documento WHERE nombre IN ('reanudar.txt','patentes.txt','patentes (1).txt','antigua.txt','homonima.txt')`
    );
    await cerrarBase();
  });
});
