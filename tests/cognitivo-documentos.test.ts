/**
 * El escaneo que antes se rechazaba se lee con Docling cuando está configurado, con sus páginas y
 * sus tablas fila por fila. Sin Docling, o si Docling falla, se rechaza como siempre.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { paginasDeDocling } from '../lib/cognitivo/documentos';
import { inspeccionar } from '../server/electrum/aprender';

function pdfSinTexto(): Buffer {
  const flujo = Buffer.from('0.5 0.5 0.5 rg 50 50 500 700 re f');
  const objs = [
    Buffer.from('<< /Type /Catalog /Pages 2 0 R >>'),
    Buffer.from('<< /Type /Pages /Kids [3 0 R] /Count 1 >>'),
    Buffer.from('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << >> >>'),
    Buffer.concat([Buffer.from(`<< /Length ${flujo.length} >>\nstream\n`), flujo, Buffer.from('\nendstream')]),
  ];
  let pdf = Buffer.from('%PDF-1.4\n');
  const offs: number[] = [];
  objs.forEach((o, i) => {
    offs.push(pdf.length);
    pdf = Buffer.concat([pdf, Buffer.from(`${i + 1} 0 obj\n`), o, Buffer.from('\nendobj\n')]);
  });
  const x = pdf.length;
  let xref = `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  for (const o of offs) xref += `${String(o).padStart(10, '0')} 00000 n \n`;
  return Buffer.concat([pdf, Buffer.from(`${xref}trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${x}\n%%EOF\n`)]);
}

const P = (n: number) => [{ page_no: n, bbox: {}, charspan: [0, 1] }];
const DOC = {
  body: { children: [{ $ref: '#/texts/0' }, { $ref: '#/groups/0' }, { $ref: '#/tables/0' }, { $ref: '#/texts/3' }] },
  furniture: { children: [{ $ref: '#/texts/4' }] },
  groups: [{ self_ref: '#/groups/0', label: 'list', children: [{ $ref: '#/texts/1' }, { $ref: '#/texts/2' }] }],
  texts: [
    { self_ref: '#/texts/0', label: 'section_header', text: 'Informe técnico de la concesión El Porvenir', prov: P(1) },
    { self_ref: '#/texts/1', label: 'list_item', text: 'Titular: Minera del Sur S.A.', prov: P(1) },
    { self_ref: '#/texts/2', label: 'list_item', text: 'Superficie: 1.250 hectáreas en El Paraíso', prov: P(1) },
    { self_ref: '#/texts/3', label: 'text', text: 'Las leyes de la tabla anterior se obtuvieron por ensayo al fuego en un laboratorio acreditado, con duplicados cada veinte muestras y blancos de control.', prov: P(2) },
    { self_ref: '#/texts/4', label: 'page_header', text: 'CONFIDENCIAL — página', prov: P(1) },
  ],
  tables: [
    {
      self_ref: '#/tables/0',
      label: 'table',
      prov: P(2),
      data: { grid: [[{ text: 'Sondeo' }, { text: 'Au g/t' }, { text: 'Metros' }], [{ text: 'DDH-01' }, { text: '3,2' }, { text: '12' }], [{ text: '' }, { text: ' ' }, { text: '' }]] },
    },
  ],
};

test('el documento de Docling se lee por páginas, en orden, con las tablas por filas y sin encabezados de página', () => {
  const p = paginasDeDocling(DOC);
  assert.deepEqual(p.map((x) => x.pagina), [1, 2]);
  assert.match(p[0].texto, /^Informe técnico[\s\S]*Titular: Minera del Sur[\s\S]*1\.250 hectáreas/);
  assert.doesNotMatch(p[0].texto, /CONFIDENCIAL/);
  assert.match(p[1].texto, /\[TABLA\]\nSondeo \| Au g\/t \| Metros\nDDH-01 \| 3,2 \| 12/);
  assert.doesNotMatch(p[1].texto, /\|\s*\|\s*$/m, 'las filas vacías no se escriben');
  assert.ok(p[1].texto.indexOf('[TABLA]') < p[1].texto.indexOf('Las leyes'));
});

function servidor(responder: (req: http.IncomingMessage, cuerpo: Buffer) => [number, unknown]) {
  const vistos: Array<{ url: string; auth?: string; cuerpo: string }> = [];
  const s = http.createServer((req, res) => {
    const partes: Buffer[] = [];
    req.on('data', (c) => partes.push(c));
    req.on('end', () => {
      const cuerpo = Buffer.concat(partes);
      vistos.push({ url: req.url || '', auth: req.headers.authorization, cuerpo: cuerpo.toString('latin1') });
      const [st, j] = responder(req, cuerpo);
      res.writeHead(st, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(j));
    });
  });
  return new Promise<{ url: string; vistos: typeof vistos; cerrar: () => void }>((ok) =>
    s.listen(0, '127.0.0.1', () => ok({ url: `http://127.0.0.1:${(s.address() as AddressInfo).port}`, vistos, cerrar: () => s.close() })),
  );
}

async function conDocling<T>(url: string | null, fn: () => Promise<T>) {
  const antes = { u: process.env.DOCLING_URL, k: process.env.DOCLING_API_KEY };
  if (url) process.env.DOCLING_URL = url;
  else delete process.env.DOCLING_URL;
  process.env.DOCLING_API_KEY = 'clave-de-prueba';
  try {
    return await fn();
  } finally {
    if (antes.u) process.env.DOCLING_URL = antes.u;
    else delete process.env.DOCLING_URL;
    if (antes.k) process.env.DOCLING_API_KEY = antes.k;
    else delete process.env.DOCLING_API_KEY;
  }
}

test('un escaneo se vuelve indexable con Docling', async () => {
  const s = await servidor((req) => (req.url === '/v1/convert/file' ? [200, { document: { json_content: DOC }, status: 'success' }] : [404, {}]));
  try {
    const i = await conDocling(s.url, () => inspeccionar('escaneo.pdf', pdfSinTexto()));
    assert.equal(i.veredicto, 'indexable');
    assert.equal(i.paginas, 2);
    assert.ok(i.fragmentos >= 1);
    assert.equal(s.vistos.length, 1);
    assert.equal(s.vistos[0].auth, 'Bearer clave-de-prueba');
    assert.match(s.vistos[0].cuerpo, /name="files"; filename="escaneo.pdf"/);
    assert.match(s.vistos[0].cuerpo, /name="do_ocr"\r\n\r\ntrue/);
  } finally {
    s.cerrar();
  }
});

test('con un docling-serve viejo (v1alpha) también', async () => {
  const s = await servidor((req) => (req.url === '/v1alpha/convert/file' ? [200, { document: { json_content: DOC } }] : [404, {}]));
  try {
    const i = await conDocling(s.url, () => inspeccionar('escaneo.pdf', pdfSinTexto()));
    assert.equal(i.veredicto, 'indexable');
    assert.deepEqual(s.vistos.map((v) => v.url), ['/v1/convert/file', '/v1alpha/convert/file']);
  } finally {
    s.cerrar();
  }
});

test('si Docling falla, no está o no saca nada, el escaneo se rechaza como antes', async () => {
  const mal = await servidor(() => [500, { detail: 'se cayó' }]);
  const vacio = await servidor(() => [200, { document: { json_content: { texts: [], tables: [] } } }]);
  try {
    for (const url of [mal.url, vacio.url, null, 'http://127.0.0.1:9']) {
      const i = await conDocling(url, () => inspeccionar('escaneo.pdf', pdfSinTexto()));
      assert.equal(i.veredicto, 'escaneo', String(url));
      assert.match(i.dicho, /escaneo/i);
    }
  } finally {
    mal.cerrar();
    vacio.cerrar();
  }
});
