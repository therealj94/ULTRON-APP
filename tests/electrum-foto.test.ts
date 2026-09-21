/**
 * LA FOTO DE UN PAPEL MINERO.
 *
 * Lo que se pide del teléfono en el campo: sacarle una foto al plano o a la resolución que está
 * sobre la mesa de INHGEOMIN y que eso quede en el expediente, buscable. No «describime la imagen»
 * —un pie de foto no se cita y no se busca— sino una transcripción que después aparezca cuando
 * alguien pregunte por ese número de resolución.
 *
 * Estas pruebas levantan un ojo de mentira: comprueban el camino entero de verdad —qué se le pide
 * al modelo de visión, qué se guarda, qué pasa si no hay ojo— sin depender de una clave de nadie.
 *
 * Necesitan base. Sin ELECTRUM_DB_URL se saltan; lo que no se hace es fingir que pasaron. A
 * diferencia de electrum-db.test.ts, esta NO trunca nada: mete sus documentos y los borra al final.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { aprender } from '../server/electrum/aprender';
import { buscarEnExpedientes, cerrarBase, consulta, hayBase } from '../server/electrum/db';
import { guardarCaja } from '../lib/boveda';

const HAY = hayBase();

/** Lo que contestaría un modelo de visión mirando una resolución hondureña en papel. */
const TRANSCRITO = [
  'INSTITUTO HONDUREÑO DE GEOLOGÍA Y MINAS',
  'Resolución No. 0417-2024',
  'Expediente: 1382-EXPL',
  'Tegucigalpa, M.D.C., 14 de marzo de 2024',
  'Concesión: QUEBRADA SECA — Titular: Minera Demo Andina S.A. de C.V.',
  'Superficie: 248,50 hectáreas. Datum WGS84, zona 16N.',
  'SELLO: INHGEOMIN · DIRECCIÓN EJECUTIVA · RECIBIDO 14 MAR 2024',
  'Firma: ilegible',
  'Es una resolución de otorgamiento de concesión de explotación.',
].join('\n');

/** Bytes cualesquiera: acá no se decodifica la imagen, se la manda al ojo tal cual. */
const foto = (semilla: string) => Buffer.from(`\x89PNG\r\n\x1a\n${semilla}${'x'.repeat(200)}`, 'binary');

test('la foto de un papel entra al expediente', { skip: HAY ? false : 'sin ELECTRUM_DB_URL' }, async (t) => {
  const pedidos: any[] = [];
  const srv = http.createServer((req, res) => {
    let b = '';
    req.on('data', (c) => (b += c));
    req.on('end', () => {
      pedidos.push({ ruta: req.url, clave: req.headers['x-ojo-clave'], cuerpo: JSON.parse(b || '{}') });
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ texto: TRANSCRITO }));
    });
  });
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
  const urlOjo = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
  guardarCaja('ojo_url', urlOjo);
  guardarCaja('ojo_clave', 'prueba');

  const r = await aprender('plano-quebrada-seca.jpg', foto('a'));

  await t.test('queda como documento, no como «no sé qué es esto»', () => {
    assert.equal(r.clase, 'documento');
    assert.match(r.dicho, /foto/i);
  });

  await t.test('se le pide TRANSCRIBIR, y se le prohíbe inventar', () => {
    const p = String(pedidos[0]?.cuerpo?.prompt || '');
    assert.match(p, /TRANSCRIB/);
    assert.match(p, /resoluci[oó]n/i);
    assert.match(p, /sello/i);
    assert.match(p, /ilegible/i);
    assert.match(p, /No adivines/i);
  });

  await t.test('la imagen viaja como data URL con su tipo', () => {
    assert.match(String(pedidos[0]?.cuerpo?.imagen || ''), /^data:image\/jpeg;base64,/);
  });

  await t.test('lo que se leyó en la foto se puede buscar después', async () => {
    const hits = await buscarEnExpedientes('resolución 0417-2024 Quebrada Seca', 5);
    assert.ok(hits.length, 'lo fotografiado tiene que aparecer al buscarlo');
    assert.match(hits.map((h: any) => h.texto).join(' '), /0417-2024/);
  });

  await t.test('se clasifica por lo que dice, no por ser una foto', async () => {
    const [d] = await consulta<{ tipo: string }>(
      `SELECT tipo FROM documento WHERE nombre = 'plano-quebrada-seca.jpg' LIMIT 1`
    );
    assert.equal(d.tipo, 'resolución');
  });

  await t.test('queda dicho que es una transcripción, no el original', () => {
    assert.match(r.avisos.map((a) => a.texto).join(' '), /transcripci[oó]n de una foto/i);
  });

  await t.test('la misma foto dos veces no se duplica', async () => {
    const otra = await aprender('otro-nombre.jpg', foto('a'));
    assert.ok((otra.ui as any)?.repetido, 'misma huella: no entra dos veces aunque cambie el nombre');
    const [c] = await consulta<{ n: string }>(
      `SELECT count(*)::text AS n FROM documento WHERE nombre IN ('plano-quebrada-seca.jpg','otro-nombre.jpg')`
    );
    assert.equal(c.n, '1');
  });

  await t.test('una foto sin extensión se reconoce por su tipo MIME', async () => {
    const sinNombre = await aprender('IMG_0042', foto('b'), { mime: 'image/jpeg' });
    assert.equal(sinNombre.clase, 'documento');
  });

  t.after(async () => {
    await consulta(
      `DELETE FROM documento WHERE nombre IN ('plano-quebrada-seca.jpg','otro-nombre.jpg','IMG_0042','sin-ojo.jpg')`
    );
    guardarCaja('ojo_url', '');
    guardarCaja('ojo_clave', '');
    srv.close();
    await cerrarBase();
  });
});

test('sin ojo configurado no se guarda un documento vacío', { skip: HAY ? false : 'sin ELECTRUM_DB_URL' }, async (t) => {
  // Lo importante no es que falle: es que NO deje una fila que después parezca un expediente
  // cargado. Un documento vacío en el índice es peor que no tenerlo, porque miente en la lista.
  guardarCaja('ojo_url', '');
  guardarCaja('ojo_clave', '');
  const gem = process.env.GEMINI_API_KEY;
  delete process.env.GEMINI_API_KEY;

  const r = await aprender('sin-ojo.jpg', foto('c'));

  await t.test('lo dice en vez de tragárselo', () => {
    assert.equal(r.clase, 'nada');
    assert.match(r.dicho, /no pude leer esa foto/i);
  });

  await t.test('no quedó nada en el índice', async () => {
    const [c] = await consulta<{ n: string }>(`SELECT count(*)::text AS n FROM documento WHERE nombre = 'sin-ojo.jpg'`);
    assert.equal(c.n, '0');
  });

  t.after(async () => {
    if (gem) process.env.GEMINI_API_KEY = gem;
    await cerrarBase();
  });
});
