/**
 * EL CARGADOR Y SUS VECINOS, CONTRA EL SERVIDOR COMPILADO (hace falta `npm run build` y
 * ELECTRUM_DB_URL apuntando a una base de pruebas).
 *
 * Todo esto se vio subiendo archivos de verdad por la pantalla:
 *
 *  · Un .json o .geojson que el navegador manda como `application/json` lo consumía el lector de
 *    JSON global antes que el cargador: «El archivo llegó vacío» a un GeoJSON bueno.
 *  · Un CSV de dos bocaminas pesa menos de 80 bytes y también «llegaba vacío».
 *  · Un id de concesión que no es número tumbaba el informe con un 500.
 *  · La lista de expedientes le devolvía a cualquiera el error crudo de Postgres.
 *  · El catastro para el mapa viajaba sin comprimir: cerca de un mega en cada apertura.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import http from 'node:http';
import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const SERVIDOR = path.join(process.cwd(), 'dist', 'server.cjs');
const PUERTO = 7803;
const BASE = `http://127.0.0.1:${PUERTO}`;
const SECRETO = 'secreto-de-prueba-subir';
const hay = fs.existsSync(SERVIDOR) && !!process.env.ELECTRUM_DB_URL;

function token(): string {
  const at = Date.now();
  const cuerpo = Buffer.from(JSON.stringify({ correo: 'carga@mina.hn', nombre: 'Carga', rol: 'QA', at, exp: at + 3_600_000 })).toString('base64url');
  return `u1.${cuerpo}.${crypto.createHmac('sha256', SECRETO).update(cuerpo).digest('base64url')}`;
}

async function esperar() {
  for (let i = 0; i < 60; i++) {
    try {
      if ((await fetch(`${BASE}/electrum.html`)).ok) return true;
    } catch {
      /* todavía no */
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}

/** Un GET crudo, para ver el cuerpo tal como viaja (fetch lo descomprime solo). */
function crudo(ruta: string, cabeceras: Record<string, string>): Promise<{ status: number; headers: http.IncomingHttpHeaders; cuerpo: Buffer }> {
  return new Promise((ok, mal) => {
    http
      .get(`${BASE}${ruta}`, { headers: cabeceras }, (res) => {
        const t: Buffer[] = [];
        res.on('data', (c) => t.push(c));
        res.on('end', () => ok({ status: res.statusCode || 0, headers: res.headers, cuerpo: Buffer.concat(t) }));
      })
      .on('error', mal);
  });
}

test('el cargador de Electrum contra el servidor de verdad', { skip: hay ? false : 'hace falta `npm run build` y ELECTRUM_DB_URL' }, async (t) => {
  const proc: ChildProcess = spawn('node', [SERVIDOR], {
    env: {
      ...process.env,
      NODE_ENV: 'production',
      PORT: String(PUERTO),
      PLATAFORMA: '',
      ULTRON_SESION_SECRETO: SECRETO,
      ULTRON_PADRON: 'carga|Carga|carga@mina.hn||electrum=escribe',
      ULTRON_NODO_URL: '',
      VOICEBOX_URL: '',
      ULTRON_MEMORIA_BUCKET: '',
      AWS_ACCESS_KEY_ID: '',
      AWS_SECRET_ACCESS_KEY: '',
    },
    stdio: 'ignore',
    detached: true,
  });
  t.after(() => {
    try {
      process.kill(-proc.pid!);
    } catch {
      /* ya se fue */
    }
  });
  assert.ok(await esperar(), 'el servidor no levantó');
  const h = { 'x-ultron-sesion': token() };
  const subir = (nombre: string, datos: Buffer | string, tipo: string) =>
    fetch(`${BASE}/api/electrum/subir?nombre=${encodeURIComponent(nombre)}`, { method: 'POST', headers: { ...h, 'Content-Type': tipo }, body: datos });

  const sufijo = crypto.randomBytes(3).toString('hex');
  const lon = -85 - Math.random();
  // Veinte bloques: lo bastante para pasar del kilobyte a partir del cual se comprime.
  const geojson = JSON.stringify({
    type: 'FeatureCollection',
    features: Array.from({ length: 20 }, (_, i) => ({
      type: 'Feature',
      properties: { NOMBRE: i ? `Prueba JSON ${sufijo} ${i}` : `Prueba JSON ${sufijo}`, TITULAR: 'Pruebas S.A.' },
      geometry: { type: 'Polygon', coordinates: [[[lon, 15 + i * 0.02], [lon, 15.01 + i * 0.02], [lon + 0.01, 15.01 + i * 0.02], [lon + 0.01, 15 + i * 0.02], [lon, 15 + i * 0.02]]] },
    })),
  });

  await t.test('un GeoJSON mandado como application/json entra', async () => {
    const r = await subir(`prueba-${sufijo}.json`, geojson, 'application/json');
    const j: any = await r.json();
    assert.equal(r.status, 200, JSON.stringify(j));
    assert.equal(j.clase, 'catastro', j.dicho);
  });

  await t.test('un CSV de dos bocaminas, de menos de 80 bytes, no «llega vacío»', async () => {
    const csv = `n,lon,lat\nA,${lon.toFixed(3)},15\nB,${(lon + 0.01).toFixed(3)},15\n`;
    assert.ok(Buffer.byteLength(csv) < 80);
    const r = await subir(`bocas-${sufijo}.csv`, csv, 'text/csv');
    const j: any = await r.json();
    assert.equal(r.status, 200, JSON.stringify(j));
    assert.equal(j.clase, 'catastro', j.dicho);
  });

  await t.test('cero bytes sí es vacío', async () => {
    const r = await subir('nada.csv', '', 'text/csv');
    assert.equal(r.status, 400);
  });

  await t.test('el nombre se queda sin carpetas', async () => {
    const r = await subir(`../../etc/texto-${sufijo}.txt`, 'Un texto de prueba suficientemente largo para indexarse como documento.', 'text/plain');
    const j: any = await r.json();
    assert.equal(j.ui?.nombre, `texto-${sufijo}.txt`);
  });

  await t.test('un id de concesión que no es número es un pedido mal hecho, no un 500', async () => {
    const r = await fetch(`${BASE}/api/electrum/informe`, {
      method: 'POST',
      headers: { ...h, 'Content-Type': 'application/json' },
      body: JSON.stringify({ tipo: 'concesion', concesion_id: 'abc' }),
    });
    assert.equal(r.status, 400);
  });

  await t.test('la búsqueda de expedientes toma «%» y «_» al pie de la letra', async () => {
    const r: any = await (await fetch(`${BASE}/api/electrum/expedientes?q=%25`, { headers: h })).json();
    assert.equal(r.totales.capas + r.totales.documentos, 0, 'ningún nombre lleva «%»: no puede traer todo');
  });

  await t.test('el catastro para el mapa viaja comprimido si el navegador lo acepta', async () => {
    const comp = await crudo('/api/electrum/catastro.geojson', { ...h, 'Accept-Encoding': 'gzip' });
    assert.equal(comp.status, 200);
    assert.equal(comp.headers['content-encoding'], 'gzip');
    const j = JSON.parse(zlib.gunzipSync(comp.cuerpo).toString());
    assert.ok(j.geojson.features.some((f: any) => f.properties.nombre === `Prueba JSON ${sufijo}`));
    const plano = await crudo('/api/electrum/catastro.geojson', h);
    assert.equal(plano.headers['content-encoding'], undefined);
    assert.ok(JSON.parse(plano.cuerpo.toString()).geojson);
    // «gzip;q=0» prohíbe gzip: mandarlo comprimido lo deja ilegible para ese cliente.
    const prohibido = await crudo('/api/electrum/catastro.geojson', { ...h, 'Accept-Encoding': 'gzip;q=0, identity' });
    assert.equal(prohibido.headers['content-encoding'], undefined);
    assert.ok(JSON.parse(prohibido.cuerpo.toString()).geojson);
  });

  await t.test('la voz no contesta «no tengo voz» a un texto sin nada que decir', async () => {
    const r = await fetch(`${BASE}/api/electrum/voz`, { method: 'POST', headers: { ...h, 'Content-Type': 'application/json' }, body: JSON.stringify({ texto: '[risa] [suspiro]' }) });
    assert.equal(r.status, 400);
  });

  await t.test('entrar por la puerta de Electrum saluda como Electrum', async () => {
    // Sin cerebro remoto no hay clave que comprobar: se mira solo que la ruta sea la de este producto.
    const r = await fetch(`${BASE}/api/electrum/entrar`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) });
    assert.equal(r.status, 400);
  });

  t.after(async () => {
    // Lo que subió esta prueba se va: la base de pruebas es compartida con las demás.
    const { consulta, cerrarBase } = await import('../server/electrum/db');
    await consulta(`DELETE FROM capa WHERE nombre LIKE $1 OR nombre LIKE $2`, [`prueba-${sufijo}`, `bocas-${sufijo}`]);
    await consulta(`DELETE FROM documento WHERE nombre = $1`, [`texto-${sufijo}.txt`]);
    await cerrarBase();
  });
});
