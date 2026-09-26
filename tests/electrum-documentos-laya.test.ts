/**
 * Qué es cada documento y qué trae, con el modelo `documento` de Laya (server/electrum/documentos-laya.ts).
 *
 * La lógica se prueba sola; el guardado, contra PostGIS de verdad (ELECTRUM_DB_URL; si no está, se
 * salta) con un Laya de mentira que contesta lotes como servidor.py.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { juntar, lecturaEnTexto, muestrear, clasificarDocumento, clasificarPendientes } from '../server/electrum/documentos-laya';
import { _reiniciarLaya, type RespuestaModelo } from '../lib/laya';
import { cerrarBase, consulta, hayBase } from '../server/electrum/db';

const TIPOS = ['doc_resolucion', 'doc_contrato', 'doc_ambiental', 'doc_tecnico', 'doc_plano', 'doc_financiero', 'doc_solicitud', 'doc_otro'];
const REQS = ['req_firma_autoridad', 'req_coordenadas', 'req_agua', 'req_comunidad', 'req_cierre', 'req_plazo'];

function resp(tipo: string, pTipo: number, reqs: Record<string, number> = {}): RespuestaModelo {
  const p: Record<string, number> = Object.fromEntries([...TIPOS, ...REQS].map((k) => [k, 0.02]));
  p[tipo] = pTipo;
  Object.assign(p, reqs);
  return { p, etiquetas: REQS.filter((r) => (reqs[r] ?? 0) >= 0.5), grupos: { tipo }, umbrales: Object.fromEntries(REQS.map((r) => [r, 0.5])), ms: 30 };
}

test('muestrear: el primer fragmento siempre, y el resto repartido hasta el final', () => {
  const cien = Array.from({ length: 100 }, (_, i) => i);
  const m = muestrear(cien, 32);
  assert.equal(m.length, 32);
  assert.equal(m[0], 0);
  assert.equal(m[m.length - 1], 99, 'llega hasta el último');
  assert.deepEqual(muestrear([1, 2, 3], 32), [1, 2, 3]);
});

test('juntar: el encabezado dice el tipo si está seguro; un requisito está si algún fragmento lo trae', () => {
  const frags = [
    { pagina: 1, orden: 0, texto: 'RESOLUCIÓN No. DEMO-1' },
    { pagina: 3, orden: 1, texto: 'vértices…' },
    { pagina: 7, orden: 2, texto: 'plazo de 30 días' },
  ];
  const l = juntar(frags, [
    resp('doc_resolucion', 0.91, { req_firma_autoridad: 0.8 }),
    resp('doc_plano', 0.7, { req_coordenadas: 0.93 }),
    resp('doc_resolucion', 0.6, { req_plazo: 0.66, req_coordenadas: 0.4 }),
  ]);
  assert.equal(l.tipo, 'resolución');
  assert.equal(l.requisitos.req_coordenadas.presente, true);
  assert.equal(l.requisitos.req_coordenadas.pagina, 3, 'la página del fragmento más claro');
  assert.equal(l.requisitos.req_plazo.pagina, 7);
  assert.equal(l.requisitos.req_agua.presente, false);
  const t = lecturaEnTexto('res.pdf', l);
  assert.match(t, /de tipo resolución \(91 %/);
  assert.match(t, /coordenadas o linderos \(página 3\)/);
  assert.match(t, /No lo vi: .*fuentes de agua/);
  assert.match(t, /lectura automática/);
});

test('juntar: si el encabezado duda, gana el tipo con más probabilidad sumada', () => {
  const frags = [0, 1, 2].map((i) => ({ pagina: i + 1, orden: i, texto: 'x' }));
  const l = juntar(frags, [resp('doc_otro', 0.4), resp('doc_contrato', 0.85), resp('doc_contrato', 0.8)]);
  assert.equal(l.tipoId, 'doc_contrato');
});

/** Un Laya de mentira: por cada texto de un lote, lo que diga `decidir`. */
function layaFalso(decidir: (texto: string) => RespuestaModelo): Promise<{ url: string; cerrar: () => void; pedidos: any[] }> {
  const pedidos: any[] = [];
  const srv = http.createServer((req, res) => {
    let b = '';
    req.on('data', (c) => (b += c));
    req.on('end', () => {
      const cuerpo = JSON.parse(b || '{}');
      pedidos.push({ ruta: req.url, cuerpo });
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ resultados: (cuerpo.textos || []).map(decidir), ms: 50 }));
    });
  });
  return new Promise((ok) =>
    srv.listen(0, '127.0.0.1', () => ok({ url: `http://127.0.0.1:${(srv.address() as AddressInfo).port}`, cerrar: () => { srv.closeAllConnections?.(); srv.close(); }, pedidos })),
  );
}

test('clasificarDocumento guarda la lectura y afina el tipo solo cuando las reglas no supieron', { skip: hayBase() ? false : 'sin ELECTRUM_DB_URL' }, async (t) => {
  const l = await layaFalso((texto) => (/RESOLUCI/.test(texto) ? resp('doc_resolucion', 0.95, { req_firma_autoridad: 0.9 }) : resp('doc_resolucion', 0.5, { req_agua: /quebrada/.test(texto) ? 0.88 : 0.1 })));
  const antes = process.env.ULTRON_LAYA_URL;
  process.env.ULTRON_LAYA_URL = l.url;
  _reiniciarLaya();
  const ids: number[] = [];
  const nuevo = async (nombre: string, tipo: string, textos: string[]) => {
    const [d] = await consulta<{ id: number }>(`INSERT INTO documento (nombre, tipo, paginas) VALUES ($1, $2, $3) RETURNING id`, [nombre, tipo, textos.length]);
    ids.push(d.id);
    for (const [i, x] of textos.entries()) await consulta(`INSERT INTO fragmento (documento_id, pagina, orden, texto) VALUES ($1,$2,$3,$4)`, [d.id, i + 1, i, x]);
    return d.id;
  };
  try {
    await t.test('«otro» de las reglas pasa a lo que dice Laya, con los requisitos y su página', async () => {
      const id = await nuevo(`prueba-laya-${Date.now()}.pdf`, 'otro', ['RESOLUCIÓN No. DEMO-44 …', 'se protege la quebrada El Ocotal', 'Comuníquese.']);
      const lectura = await clasificarDocumento(id);
      assert.ok(lectura);
      const [d] = await consulta<{ tipo: string; meta: any }>(`SELECT tipo, meta FROM documento WHERE id = $1`, [id]);
      assert.equal(d.tipo, 'resolución');
      assert.equal(d.meta.laya.requisitos.req_agua.presente, true);
      assert.equal(d.meta.laya.requisitos.req_agua.pagina, 2);
      assert.equal(d.meta.laya.requisitos.req_firma_autoridad.presente, true);
      assert.equal(l.pedidos.at(-1).ruta, '/v1/documento');
    });
    await t.test('un tipo que puso quien lo subió, o uno más fino de las reglas, no se pisa', async () => {
      const fijado = await nuevo(`fijado-${Date.now()}.pdf`, 'otro', ['RESOLUCIÓN No. DEMO-45']);
      await clasificarDocumento(fijado, { tipoFijado: true });
      const [a] = await consulta<{ tipo: string; meta: any }>(`SELECT tipo, meta FROM documento WHERE id = $1`, [fijado]);
      assert.equal(a.tipo, 'otro');
      assert.equal(a.meta.laya.tipo, 'resolución', 'la lectura queda guardada igual');
      const fino = await nuevo(`ni43-${Date.now()}.pdf`, '43-101', ['RESOLUCIÓN citada en el informe']);
      await clasificarDocumento(fino);
      const [b] = await consulta<{ tipo: string }>(`SELECT tipo FROM documento WHERE id = $1`, [fino]);
      assert.equal(b.tipo, '43-101');
    });
    await t.test('los pendientes: solo los que no tienen lectura, y con todos, también los demás', async () => {
      await consulta(`UPDATE documento SET meta = meta || '{"laya": {}}'::jsonb WHERE NOT (meta ? 'laya')`);
      const sin = await nuevo(`pendiente-${Date.now()}.pdf`, 'otro', ['RESOLUCIÓN No. DEMO-46']);
      const r = await clasificarPendientes();
      assert.deepEqual(r, { revisados: 1, clasificados: 1, fallidos: 0 });
      const [d] = await consulta<{ tipo: string }>(`SELECT tipo FROM documento WHERE id = $1`, [sin]);
      assert.equal(d.tipo, 'resolución');
      assert.deepEqual(await clasificarPendientes(), { revisados: 0, clasificados: 0, fallidos: 0 });
      const todos = await clasificarPendientes({ todos: true });
      assert.ok(todos.revisados >= ids.length);
    });
  } finally {
    if (ids.length) await consulta(`DELETE FROM documento WHERE id = ANY($1::bigint[])`, [ids]);
    if (antes === undefined) delete process.env.ULTRON_LAYA_URL;
    else process.env.ULTRON_LAYA_URL = antes;
    _reiniciarLaya();
    l.cerrar();
    await cerrarBase();
  }
});
