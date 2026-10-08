/**
 * Las teselas propias (mapa base y mapas escaneados) pasan por el servidor a tramos, leídas del cubo
 * con la sesión de Dr Electrum. Aquí el cubo es de mentira: un `fetch` que contesta como S3.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import type { AddressInfo } from 'node:net';

process.env.ULTRON_SESION_SECRETO = process.env.ULTRON_SESION_SECRETO || 'secreto-de-sesion-para-pruebas-largo-1234';
const llaveAntes = process.env.ELECTRUM_CLAVE;
process.env.ELECTRUM_CLAVE = 'llave-de-prueba-teselas';

const { montarRutasTeselas, olvidarTeselas } = await import('../server/electrum/teselas');
const { emitirSesion } = await import('../server/seguridad');
const { fijarCuentasAprobadas } = await import('../lib/acceso');

/** Lo que hay en el cubo de mentira, y qué se le pidió. */
const cubo = new Map<string, Buffer>();
const pedidos: { key: string; range: string | null }[] = [];
const fetchReal = globalThis.fetch;

function s3DeMentira(url: string, init?: RequestInit): Response {
  const u = new URL(url);
  const key = decodeURIComponent(u.pathname.slice(1));
  const h = new Headers(init?.headers);
  const range = h.get('range');
  pedidos.push({ key, range });
  const obj = cubo.get(key);
  if (!obj) return new Response('<Error><Code>NoSuchKey</Code></Error>', { status: 404 });
  if (!range) return new Response(new Uint8Array(obj), { status: 200, headers: { etag: '"e1"' } });
  const [a, b] = range.replace('bytes=', '').split('-').map(Number);
  if (a >= obj.length) return new Response('<Error><Code>InvalidRange</Code></Error>', { status: 416 });
  const fin = Math.min(b, obj.length - 1);
  return new Response(new Uint8Array(obj.subarray(a, fin + 1)), {
    status: 206,
    headers: { 'content-range': `bytes ${a}-${fin}/${obj.length}`, etag: '"e1"' },
  });
}

test('teselas: tramos del cubo con sesión, índice de mapas escaneados, y los pedidos malos', async (t) => {
  const antes = { ...process.env };
  process.env.ELECTRUM_EXPEDIENTES_BUCKET = 'cubo-de-prueba';
  process.env.AWS_ACCESS_KEY_ID = 'AKIDPRUEBA';
  process.env.AWS_SECRET_ACCESS_KEY = 'secreto-de-prueba';
  globalThis.fetch = (async (entrada: any, init?: RequestInit) => {
    const url = typeof entrada === 'string' ? entrada : String(entrada?.url ?? entrada);
    if (url.includes('.amazonaws.com/')) return s3DeMentira(url, init);
    return fetchReal(entrada, init);
  }) as typeof fetch;
  olvidarTeselas();
  fijarCuentasAprobadas([{ id: 'lector-tes', nombre: 'Lector', correos: ['lector@mina.hn'], acceso: { electrum: 'lee' } } as any]);

  const app = express();
  montarRutasTeselas(app);
  const srv = app.listen(0);
  await new Promise((r) => srv.once('listening', r));
  t.after(() => {
    srv.close();
    globalThis.fetch = fetchReal;
    for (const k of ['ELECTRUM_EXPEDIENTES_BUCKET', 'AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY']) {
      if (antes[k] === undefined) delete process.env[k];
      else process.env[k] = antes[k];
    }
    if (llaveAntes === undefined) delete process.env.ELECTRUM_CLAVE;
    else process.env.ELECTRUM_CLAVE = llaveAntes;
    fijarCuentasAprobadas([]);
    olvidarTeselas();
  });
  const base = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
  const sesion = emitirSesion({ correo: 'lector@mina.hn', nombre: 'Lector', rol: 'x' }).token;
  const pedir = (ruta: string, cab: Record<string, string> = {}, conSesion = true) =>
    fetchReal(base + ruta, { headers: { ...(conSesion ? { 'x-ultron-sesion': sesion } : {}), ...cab } });

  const archivo = Buffer.from(Array.from({ length: 5000 }, (_, i) => i % 251));
  cubo.set('biblioteca/teselas/honduras.pmtiles', archivo);
  cubo.set(
    'biblioteca/teselas/indice.json',
    Buffer.from(
      JSON.stringify({
        base: true,
        rasters: [
          { clave: 'jica-olancho-geologico', nombre: 'Geológico de Olancho', encuadre: [-87, 14.6, -86.5, 15.4], zoomMax: 14 },
          // Curvas de nivel como teselas vectoriales: lo que va a una expresión del mapa, saneado.
          {
            clave: 'lote-1-curvas',
            nombre: 'Curvas',
            encuadre: [-89.4, 12.9, -83.1, 16.6],
            vector: { capa: 'curvas', color: '#E8C38A', etiqueta: 'cota', maestra: 'maestra' },
          },
          {
            clave: 'lote-1-curvas-mal',
            nombre: 'Curvas con basura',
            encuadre: [-89.4, 12.9, -83.1, 16.6],
            vector: { capa: 'curvas', color: 'red; x', etiqueta: ['get', 'secreto'], maestra: 'a b' },
          },
          { clave: 'lote-1-sin-capa', nombre: 'Sin capa', encuadre: [-89, 13, -83, 16], vector: { color: '#ffffff' } },
          // Estos dos no pasan: una clave que se sale de la carpeta y un encuadre roto.
          { clave: '../secreto', nombre: 'x', encuadre: [0, 0, 1, 1] },
          { clave: 'roto', nombre: 'Roto', encuadre: [0, 'a', 1] },
        ],
      })
    )
  );

  // Sin sesión no hay teselas ni índice.
  assert.equal((await pedir('/api/electrum/teselas/honduras.pmtiles', { range: 'bytes=0-99' }, false)).status, 401);
  assert.equal((await pedir('/api/electrum/mapa/rasters', {}, false)).status, 401);

  // El índice: solo lo que está bien formado.
  const idx = (await (await pedir('/api/electrum/mapa/rasters')).json()) as any;
  assert.equal(idx.base, true);
  assert.deepEqual(
    idx.rasters.map((r: any) => r.clave),
    ['jica-olancho-geologico', 'lote-1-curvas', 'lote-1-curvas-mal', 'lote-1-sin-capa']
  );
  const v = (c: string) => idx.rasters.find((r: any) => r.clave === c).vector;
  assert.equal(v('jica-olancho-geologico'), undefined, 'un ráster no trae vector');
  assert.deepEqual(v('lote-1-curvas'), { capa: 'curvas', color: '#E8C38A', etiqueta: 'cota', maestra: 'maestra' });
  // Color que no es #rrggbb y nombres que no son simples: fuera; la capa sí queda.
  assert.deepEqual(v('lote-1-curvas-mal'), { capa: 'curvas' });
  // Sin nombre de capa no hay qué pintar: se queda como si fuera ráster.
  assert.equal(v('lote-1-sin-capa'), undefined);

  // Un tramo: 206 con los bytes justos, su Content-Range y el ETag del cubo.
  const r1 = await pedir('/api/electrum/teselas/honduras.pmtiles', { range: 'bytes=100-199' });
  assert.equal(r1.status, 206);
  assert.equal(r1.headers.get('content-range'), 'bytes 100-199/5000');
  assert.equal(r1.headers.get('etag'), '"e1"');
  // Privado y revalidado siempre: un mapa re-subido no puede mezclarse con tramos viejos del navegador.
  assert.equal(r1.headers.get('cache-control'), 'private, no-cache');
  const r304 = await pedir('/api/electrum/teselas/honduras.pmtiles', { range: 'bytes=100-199', 'if-none-match': '"e1"' });
  assert.equal(r304.status, 304);
  assert.equal((await r304.arrayBuffer()).byteLength, 0);
  const otro = await pedir('/api/electrum/teselas/honduras.pmtiles', { range: 'bytes=100-199', 'if-none-match': '"viejo"' });
  assert.equal(otro.status, 206, 'otro ETag: van los bytes');
  await otro.arrayBuffer();
  assert.deepEqual(Buffer.from(await r1.arrayBuffer()), archivo.subarray(100, 200));
  const aS3 = pedidos.filter((p) => p.key === 'biblioteca/teselas/honduras.pmtiles').length;
  assert.equal(pedidos.at(-1)?.range, 'bytes=100-199');

  // El mismo tramo otra vez sale de la memoria, sin volver al cubo.
  const r2 = await pedir('/api/electrum/teselas/honduras.pmtiles', { range: 'bytes=100-199' });
  assert.equal(r2.status, 206);
  assert.deepEqual(Buffer.from(await r2.arrayBuffer()), archivo.subarray(100, 200));
  assert.equal(pedidos.filter((p) => p.key === 'biblioteca/teselas/honduras.pmtiles').length, aS3);

  // Un tramo que pasa del final se recorta al tamaño real (como pide el cliente de PMTiles: 16 KB de cabecera).
  const r3 = await pedir('/api/electrum/teselas/honduras.pmtiles', { range: 'bytes=0-16383' });
  assert.equal(r3.status, 206);
  assert.equal(r3.headers.get('content-range'), 'bytes 0-4999/5000');
  assert.equal((await r3.arrayBuffer()).byteLength, 5000);

  // Los pedidos malos.
  assert.equal((await pedir('/api/electrum/teselas/honduras.pmtiles')).status, 416, 'sin Range');
  assert.equal((await pedir('/api/electrum/teselas/honduras.pmtiles', { range: 'bytes=200-100' })).status, 416, 'al revés');
  assert.equal((await pedir('/api/electrum/teselas/honduras.pmtiles', { range: 'bytes=0-' })).status, 416, 'abierto');
  assert.equal((await pedir('/api/electrum/teselas/honduras.pmtiles', { range: `bytes=0-${9 * 1024 * 1024}` })).status, 416, 'demasiado grande');
  assert.equal((await pedir('/api/electrum/teselas/honduras.pmtiles', { range: 'bytes=9000-9100' })).status, 416, 'fuera del archivo');
  assert.equal((await pedir('/api/electrum/teselas/no-existe.pmtiles', { range: 'bytes=0-9' })).status, 404);
  const n = pedidos.length;
  for (const malo of ['indice.json', '..%2Findice.pmtiles', 'Mayusculas.pmtiles', 'x.mbtiles']) {
    assert.equal((await pedir(`/api/electrum/teselas/${malo}`, { range: 'bytes=0-9' })).status, 404, malo);
  }
  assert.equal(pedidos.length, n, 'un nombre que no es de teselas ni llega al cubo');
});
