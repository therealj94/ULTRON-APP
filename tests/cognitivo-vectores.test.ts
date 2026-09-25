/**
 * Búsqueda por significado: el cliente de embeddings, la fusión por rango, el índice del cerebro y
 * la búsqueda híbrida de expedientes contra pgvector de verdad (en la base de pruebas).
 *
 * BGE-M3 se simula con un servidor que habla el protocolo de Text Embeddings Inference (`/embed`)
 * y que pone los sinónimos en la misma dimensión: así una pregunta que no comparte ninguna palabra
 * con el documento («¿quién tiene el permiso del cerro?» / «titular de la concesión Cerro Azul»)
 * tiene que encontrarlo por significado, y solo por significado.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { fundirPorRango, vectorizar, DIMENSION } from '../lib/cognitivo/embeddings';
import { lineasPorSignificado, resetIndicesTest } from '../lib/cognitivo/conocimiento-semantico';

const SINONIMOS: Record<string, string> = {
  permiso: 'concesion', concesion: 'concesion', derecho: 'concesion',
  dueño: 'titular', dueno: 'titular', titular: 'titular', tiene: 'titular', propietario: 'titular',
  cerro: 'cerro', montaña: 'cerro',
  fundo: 'fundador', fundador: 'fundador', arranco: 'fundador', empezo: 'fundador',
  plata: 'dinero', dinero: 'dinero', capital: 'dinero',
};
const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** Vector «semántico» de juguete: cada concepto a una dimensión fija, normalizado. */
function vectorFalso(texto: string): number[] {
  const v = new Array(DIMENSION).fill(0);
  for (const w of fold(texto).split(/[^a-zñ0-9]+/).filter((x) => x.length > 2)) {
    const c = SINONIMOS[w] || w;
    let h = 0;
    for (const ch of c) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    v[h % DIMENSION] += 1;
  }
  const n = Math.sqrt(v.reduce((a, x) => a + x * x, 0)) || 1;
  return v.map((x) => x / n);
}

function teiFalso(): Promise<{ url: string; cerrar: () => void; llamadas: number[] }> {
  const llamadas: number[] = [];
  const srv = http.createServer((req, res) => {
    let b = '';
    req.on('data', (c) => (b += c));
    req.on('end', () => {
      const { inputs } = JSON.parse(b || '{}');
      llamadas.push(inputs.length);
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(inputs.map(vectorFalso)));
    });
  });
  return new Promise((ok) => srv.listen(0, '127.0.0.1', () => ok({ url: `http://127.0.0.1:${(srv.address() as AddressInfo).port}`, cerrar: () => srv.close(), llamadas })));
}

test('fusión por rango: lo que sale arriba en las dos listas gana, y nada se pierde', () => {
  const r = fundirPorRango([['a', 'b', 'c'], ['c', 'a', 'd']], (x) => x);
  assert.equal(r[0].item, 'a');
  assert.deepEqual(r.map((x) => x.item).sort(), ['a', 'b', 'c', 'd']);
  assert.deepEqual(r.find((x) => x.item === 'd')!.de, [1]);
});

test('vectorizar: en lotes, y null si el servicio no está o devuelve otra dimensión', async () => {
  const t = await teiFalso();
  process.env.EMBED_URL = t.url;
  try {
    const vs = await vectorizar(Array.from({ length: 70 }, (_, i) => `texto ${i}`), { lote: 32 });
    assert.equal(vs?.length, 70);
    assert.deepEqual(t.llamadas, [32, 32, 6]);
    process.env.EMBED_DIM = '12';
  } finally {
    t.cerrar();
    delete process.env.EMBED_DIM;
  }
  process.env.EMBED_URL = 'http://127.0.0.1:9';
  assert.equal(await vectorizar(['x']), null);
  delete process.env.EMBED_URL;
  assert.equal(await vectorizar(['x']), null);
});

test('el cerebro por significado encuentra la línea aunque no comparta palabras', async () => {
  const t = await teiFalso();
  process.env.EMBED_URL = t.url;
  process.env.COGNITIVO_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'sem-'));
  // Los vectores de juguete reparten el peso entre todas las palabras: su coseno es más bajo que el
  // de BGE-M3 para la misma cercanía. El umbral de producción (0,5) es para BGE-M3.
  process.env.EMBED_UMBRAL_CEREBRO = '0.25';
  resetIndicesTest();
  try {
    const lineas = ['- Fundador: Medardo José Ordóñez.', '- Chain id 5550, Besu QBFT.', '- AUKA = una onza de oro.'];
    const r = await lineasPorSignificado('prueba', lineas, '¿quién arrancó esto?');
    assert.deepEqual(r, ['- Fundador: Medardo José Ordóñez.']);
    // La segunda vez no vuelve a vectorizar las líneas: están en disco y en memoria.
    const antes = t.llamadas.length;
    await lineasPorSignificado('prueba', lineas, '¿quién fundó la empresa?');
    assert.equal(t.llamadas.length, antes + 1, 'solo la pregunta');
    // Lo que no se parece a nada no se inyecta como si fuera saber.
    assert.deepEqual(await lineasPorSignificado('prueba', lineas, 'receta de pupusas revueltas'), []);
  } finally {
    t.cerrar();
    delete process.env.EMBED_URL;
    delete process.env.EMBED_UMBRAL_CEREBRO;
  }
});

const URL_PRUEBAS = process.env.ELECTRUM_DB_URL || '';
const conBase = /pruebas/.test(URL_PRUEBAS);

test('expedientes: búsqueda híbrida contra pgvector de verdad', { skip: !conBase && 'sin base de pruebas' }, async () => {
  const { consulta, cerrarBase, buscarEnExpedientes } = await import('../server/electrum/db');
  const { indexarPendientes, hayColumnaVectores } = await import('../server/electrum/vectores');
  if (!(await hayColumnaVectores())) return; // la base de pruebas sin pgvector: nada que probar aquí
  const t = await teiFalso();
  process.env.EMBED_URL = t.url;
  const [doc] = await consulta<{ id: number }>(`INSERT INTO documento (nombre, tipo) VALUES ('Prueba vectores ${Date.now()}', 'otro') RETURNING id`);
  try {
    await consulta(
      `INSERT INTO fragmento (documento_id, pagina, orden, texto) VALUES
        ($1, 3, 1, 'El titular de la concesión Cerro Azul es Minera del Sur S.A., inscrita en el registro minero.'),
        ($1, 4, 2, 'El expediente 123-2019 fue presentado ante INHGEOMIN el 4 de marzo.'),
        ($1, 5, 3, 'La ley media ponderada de las muestras de canal es de 3,4 g/t de oro.')`,
      [doc.id]
    );
    assert.equal(await indexarPendientes({ documentoId: doc.id }), 3);
    const [{ n }] = await consulta<{ n: string }>(`SELECT count(*)::text AS n FROM fragmento WHERE documento_id = $1 AND embedding IS NULL`, [doc.id]);
    assert.equal(n, '0');

    // Ninguna palabra en común con el fragmento: solo el significado lo encuentra.
    const porSignificado = await buscarEnExpedientes('¿quién es el dueño del permiso del cerro?', 3);
    assert.ok(porSignificado.length > 0, 'debió encontrar algo');
    assert.match(porSignificado[0].texto, /titular de la concesi[oó]n Cerro Azul/);
    assert.equal(porSignificado[0].pagina, 3);
    assert.notEqual(porSignificado[0].via, 'texto');

    // Lo exacto lo sigue encontrando el texto completo.
    const exacto = await buscarEnExpedientes('expediente 123-2019', 3);
    assert.match(exacto[0].texto, /123-2019/);
    assert.notEqual(exacto[0].via, 'significado');
  } finally {
    await consulta(`DELETE FROM documento WHERE id = $1`, [doc.id]);
    t.cerrar();
    delete process.env.EMBED_URL;
    await cerrarBase();
  }
});
