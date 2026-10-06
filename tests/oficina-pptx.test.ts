/**
 * PRESENTACIONES (.pptx) con la misma vara que Word, Excel y PDF: especificación tipada → PptxGenJS → RELECTURA del
 * archivo (estructura OOXML, texto de cada diapositiva en su lugar, tablas celda por celda, gráficos con sus series y
 * valores, numeración, títulos accesibles) → entrega con recibo → descarga. Y la prueba de que la validación SÍ caza lo
 * malo: ZIP cortado, diapositiva faltante, enlace de afuera, macros, valores del gráfico cambiados, orden alterado.
 *
 * Un segundo lector independiente abre el archivo: python-pptx (si hay un Python con `pptx`: PYTHON_PPTX=/ruta/python o
 * `python3`), y si no, un parseo DOM propio con @xmldom (sin las expresiones regulares de la validación).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import type { AddressInfo } from 'node:net';
import JSZip from 'jszip';
import { DOMParser } from '@xmldom/xmldom';
import { almacenEnMemoria } from '../lib/durable';
import { diapositivasPedidas, requisitosDeEntrega } from '../lib/entregables';
import { paginasDePptx } from '../lib/leer-oficina';
import { lineaDeHerramienta, herramientasDelTurno, herramientasQueCumplen, type ManosDelTurno } from '../lib/cerebro-manos';
import { extraerPedidoHerramienta } from '../lib/harness';
import { abrirDescarga, almacenArchivosMemoria, disposicionDescarga, idArchivo } from '../lib/oficina/almacen';
import { crearDocumentos } from '../lib/oficina/entrega';
import { generarArchivo } from '../lib/oficina/generar';
import { contraste, TEMAS, textoAlternativo } from '../lib/oficina/pptx';
import { MIME, nombreSeguro, TOPES_PPTX, validarPedido, type ArchivoPedido } from '../lib/oficina/spec';
import { libreOfficeDisponible, renderizar, tipoPorDentro, validarArchivo } from '../lib/oficina/validar';
import { correrDocumento, montarRutasDocumentos } from '../server/documentos';
import { conEnlacesDeDocumentos } from '../server/enlace-documento';
import { enTurnoConTrabajos, nuevoContextoTrabajos, pedidoDeDocumentos } from '../server/trabajos';

/** Una presentación de verdad: 8 diapositivas para inversionistas, con tabla, gráfico, cifras, cita y notas. */
const PRESENTACION = {
  tipo: 'pptx',
  nombre: 'Exploración Olancho.pptx',
  spec: {
    titulo: 'Exploración aurífera en Olancho',
    subtitulo: 'Informe a inversionistas — tercer trimestre de 2026',
    autor: 'Orden Global',
    tema: 'azul',
    diapositivas: [
      { tipo: 'portada', titulo: 'Exploración aurífera en Olancho', subtitulo: 'Informe a inversionistas — tercer trimestre de 2026', notas: 'Agradecer la asistencia y presentar al equipo técnico.' },
      {
        tipo: 'vinetas',
        titulo: 'Resumen ejecutivo',
        vinetas: ['Se perforaron 2,400 m en 18 sondeos', 'Ley media de 3.2 g/t en la zona norte', 'Licencia ambiental aprobada en agosto', 'Presupuesto ejecutado al 92 %', 'Comunidad de Juticalpa informada y de acuerdo'],
        notas: 'Subrayar que la ley media supera la del estudio previo (2.7 g/t).',
      },
      { tipo: 'cifras', titulo: 'Indicadores clave', cifras: [{ valor: '3.2 g/t', etiqueta: 'Ley media de oro' }, { valor: '2,400 m', etiqueta: 'Metros perforados' }, { valor: 'L 18.6 M', etiqueta: 'Inversión acumulada' }, { valor: '92 %', etiqueta: 'Presupuesto ejecutado' }] },
      {
        tipo: 'tabla',
        titulo: 'Recursos estimados por zona',
        tabla: {
          cabecera: ['Zona', 'Toneladas', 'Ley (g/t)', 'Onzas de oro'],
          filas: [
            ['Norte', '1,200,000', '3.2', '123,500'],
            ['Centro', '850,000', '2.1', '57,400'],
            ['Sur', '430,000', '1.6', '22,100'],
            ['Total', '2,480,000', '2.5', '203,000'],
          ],
        },
      },
      { tipo: 'grafico', titulo: 'Metros perforados por trimestre', grafico: { tipo: 'barras', categorias: ['T4 2025', 'T1 2026', 'T2 2026', 'T3 2026'], series: [{ nombre: 'Plan', valores: [500, 600, 650, 650] }, { nombre: 'Real', valores: [420, 610, 700, 670] }], unidad: 'metros' } },
      { tipo: 'dos_columnas', titulo: 'Oportunidades y riesgos', columnas: [{ titulo: 'Oportunidades', vinetas: ['Precio del oro sobre USD 2,600/oz', 'Acceso por carretera pavimentada'] }, { titulo: 'Riesgos', vinetas: ['Temporada de lluvias de junio a octubre', 'Trámite de agua aún pendiente'] }] },
      { tipo: 'cita', titulo: 'Lo que dice la comunidad', cita: { texto: 'Queremos empleo para nuestros hijos y el río limpio; con este proyecto podemos tener las dos cosas.', autor: 'Patronato de Juticalpa' } },
      { tipo: 'cierre', titulo: 'Próximos pasos', subtitulo: 'Fase de pre-factibilidad en el primer trimestre de 2027', notas: 'Abrir a preguntas.' },
    ],
  },
};
const PEDIDO = 'Hazme una presentación de 8 diapositivas sobre la exploración en Olancho para los inversionistas';

function uno(x: unknown): ArchivoPedido {
  const r = validarPedido(x);
  assert.deepEqual(r.errores, []);
  return r.archivos[0];
}

async function reZip(datos: Buffer, cambiar: (zip: JSZip) => Promise<void>): Promise<Buffer> {
  const zip = await JSZip.loadAsync(datos);
  await cambiar(zip);
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}

let cache: Buffer | null = null;
async function generada(): Promise<{ a: ArchivoPedido; b: Buffer }> {
  const a = uno(PRESENTACION);
  cache ||= await generarArchivo(a);
  return { a, b: cache };
}

/* ------------------------------------------------------------------ el segundo lector */

const PY_PPTX = `
import json, sys
from pptx import Presentation
p = Presentation(sys.argv[1])
out = {'ancho': p.slide_width, 'alto': p.slide_height, 'titulo': p.core_properties.title, 'diapositivas': []}
for s in p.slides:
    d = {'titulo': s.shapes.title.text if s.shapes.title is not None else None, 'textos': [], 'tablas': [], 'graficos': [],
         'notas': s.notes_slide.notes_text_frame.text if s.has_notes_slide and s.notes_slide.notes_text_frame is not None else ''}
    for sh in s.shapes:
        if sh.has_text_frame: d['textos'].append(sh.text_frame.text)
        if getattr(sh, 'has_table', False) and sh.has_table: d['tablas'].append([[c.text for c in r.cells] for r in sh.table.rows])
        if getattr(sh, 'has_chart', False) and sh.has_chart:
            pl = sh.chart.plots[0]
            d['graficos'].append({'tipo': str(sh.chart.chart_type), 'categorias': [str(c) for c in pl.categories], 'series': [{'nombre': se.name, 'valores': list(se.values)} for se in pl.series]})
    out['diapositivas'].append(d)
print(json.dumps(out, ensure_ascii=False))
`;

type Leido = { lector: string; titulo: string; diapositivas: { titulo: string | null; textos: string[]; tablas: string[][][]; graficos: { categorias: string[]; series: { nombre: string; valores: number[] }[] }[]; notas: string }[] };

function pythonConPptx(): string | null {
  for (const py of [process.env.PYTHON_PPTX, 'python3'].filter(Boolean) as string[]) {
    try {
      execFileSync(py, ['-I', '-c', 'import pptx'], { stdio: 'ignore', timeout: 20_000 });
      return py;
    } catch {
      /* sigue */
    }
  }
  return null;
}

/** El parseo propio (DOM de @xmldom, no las regex de la validación): lo mismo que devuelve python-pptx. */
async function leerConDom(datos: Buffer): Promise<Leido> {
  const zip = await JSZip.loadAsync(datos);
  const dom = async (n: string) => new DOMParser().parseFromString((await zip.file(n)?.async('text')) || '<x/>', 'text/xml');
  const todos = (nodo: any, tag: string): any[] => Array.from(nodo.getElementsByTagName(tag));
  const rels = async (parte: string): Promise<Record<string, string>> => {
    const d = await dom(parte.replace(/([^/]+)$/, '_rels/$1.rels'));
    const destino = (t: string) => (t.startsWith('/') ? t.slice(1) : path.posix.normalize(path.posix.join(path.posix.dirname(parte), t)));
    return Object.fromEntries(todos(d, 'Relationship').map((r) => [r.getAttribute('Id'), destino(r.getAttribute('Target'))]));
  };
  const pres = await dom('ppt/presentation.xml');
  const rp = await rels('ppt/presentation.xml');
  const core = await dom('docProps/core.xml');
  const out: Leido = { lector: 'DOM propio (@xmldom)', titulo: todos(core, 'dc:title')[0]?.textContent || '', diapositivas: [] };
  for (const id of todos(pres, 'p:sldId')) {
    const parte = rp[id.getAttribute('r:id')];
    const s = await dom(parte);
    const parrafos = (n: any) => todos(n, 'a:p').map((p) => todos(p, 'a:t').map((t) => t.textContent).join(''));
    const formas = todos(s, 'p:sp');
    const tituloSp = formas.find((sp) => todos(sp, 'p:ph').some((ph) => ph.getAttribute('type') === 'title'));
    const r = await rels(parte);
    const graficos = [];
    for (const destino of Object.values(r).filter((x) => /charts\/chart\d+\.xml$/.test(x))) {
      const c = await dom(destino);
      const sers = todos(c, 'c:ser');
      const pts = (n: any) => todos(n, 'c:pt').map((p) => todos(p, 'c:v')[0]?.textContent || '');
      graficos.push({ categorias: pts(todos(sers[0], 'c:cat')[0]), series: sers.map((se) => ({ nombre: pts(todos(se, 'c:tx')[0])[0], valores: pts(todos(se, 'c:val')[0]).map(Number) })) });
    }
    const notaRel = Object.values(r).find((x) => /notesSlide\d+\.xml$/.test(x));
    const notas = notaRel ? todos(await dom(notaRel), 'p:sp').filter((sp) => todos(sp, 'p:ph').some((ph) => ph.getAttribute('type') === 'body')).flatMap(parrafos).join('\n') : '';
    out.diapositivas.push({
      titulo: tituloSp ? parrafos(tituloSp).join('\n') : null,
      textos: formas.map((sp) => parrafos(sp).join('\n')),
      tablas: todos(s, 'a:tbl').map((t) => todos(t, 'a:tr').map((tr) => todos(tr, 'a:tc').map((tc) => parrafos(tc).join('\n')))),
      graficos,
      notas,
    });
  }
  return out;
}

async function segundoLector(datos: Buffer): Promise<Leido> {
  const py = pythonConPptx();
  if (!py) return leerConDom(datos);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aura-pptx-'));
  try {
    const f = path.join(dir, 'p.pptx');
    fs.writeFileSync(f, datos);
    const j = JSON.parse(execFileSync(py, ['-I', '-c', PY_PPTX, f], { encoding: 'utf8', timeout: 60_000 }));
    return { lector: `python-pptx (${py})`, ...j };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/* ------------------------------------------------------------------ especificación */

test('spec pptx: la presentación de 8 diapositivas pasa; nombre, MIME y lo que no cabe se dice con su porqué', () => {
  const a = uno(PRESENTACION);
  assert.equal(a.tipo, 'pptx');
  assert.equal(a.nombre, 'Exploración Olancho.pptx');
  if (a.tipo === 'pptx') {
    assert.equal(a.spec.diapositivas.length, 8);
    assert.equal(a.spec.tema, 'azul');
  }
  assert.equal(MIME.pptx, 'application/vnd.openxmlformats-officedocument.presentationml.presentation');
  assert.equal(nombreSeguro('../../deck.ppt', 'pptx'), 'deck.pptx');
  assert.equal(nombreSeguro('', 'pptx'), 'presentación.pptx');
  assert.equal(nombreSeguro('con', 'pptx'), '_con.pptx');

  const d = (x: Record<string, unknown>) => ({ tipo: 'pptx', nombre: 'm.pptx', spec: { titulo: 'T', diapositivas: [x] } });
  const errores = (x: Record<string, unknown>) => validarPedido(d(x)).errores.flatMap((e) => e.errores).join(' | ');
  assert.match(errores({ tipo: 'animacion', titulo: 'X' }), /tipo «animacion» desconocido/);
  assert.match(errores({ tipo: 'vinetas', titulo: '', vinetas: ['a'] }), /falta el título de la diapositiva/);
  assert.match(errores({ tipo: 'vinetas', titulo: 'X', vinetas: Array.from({ length: 9 }, (_, i) => `v${i}`) }), /9 viñetas \(máximo 8.*divídela/);
  assert.match(errores({ tipo: 'vinetas', titulo: 'X', vinetas: ['x'.repeat(TOPES_PPTX.vineta + 1)] }), /más de 220 caracteres/);
  assert.match(errores({ tipo: 'dos_columnas', titulo: 'X', columnas: [{ vinetas: ['a'] }] }), /exactamente 2 columnas/);
  assert.match(errores({ tipo: 'tabla', titulo: 'X', tabla: { cabecera: ['a'], filas: Array.from({ length: 11 }, () => ['x']) } }), /11 filas \(máximo 10/);
  assert.match(errores({ tipo: 'cifras', titulo: 'X', cifras: Array.from({ length: 5 }, () => ({ valor: '1', etiqueta: 'e' })) }), /5 cifras \(máximo 4\)/);
  assert.match(errores({ tipo: 'grafico', titulo: 'X', grafico: { tipo: 'pastel', categorias: ['a', 'b'], series: [{ nombre: 's', valores: [1, 2] }, { nombre: 't', valores: [1, 2] }] } }), /pastel lleva UNA serie/);
  assert.match(errores({ tipo: 'grafico', titulo: 'X', grafico: { tipo: 'barras', categorias: ['a', 'b', 'c'], series: [{ nombre: 's', valores: [1, 2] }] } }), /2 valores y hay 3 categorías/);
  assert.match(errores({ tipo: 'grafico', titulo: 'X', grafico: { tipo: 'barras', categorias: ['a', 'b'], series: [{ nombre: 's', valores: [1, 'mucho'] }] } }), /no son números/);
  assert.match(errores({ tipo: 'grafico', titulo: 'X', grafico: { tipo: 'radar', categorias: ['a', 'b'], series: [{ nombre: 's', valores: [1, 2] }] } }), /barras, lineas o pastel/);
  assert.match(errores({ tipo: 'cita', cita: { texto: '' } }), /falta el texto de la cita/);
  assert.match(errores({ tipo: 'portada', titulo: 'X', vinetas: ['a'] }), /no lleva viñetas/);
  // La portada sin título toma el de la presentación; un tema desconocido cae en el sobrio por omisión.
  const p = validarPedido({ tipo: 'pptx', nombre: 'p.pptx', spec: { titulo: 'Plan', tema: 'neón', diapositivas: [{ tipo: 'portada' }] } }).archivos[0];
  assert.ok(p && p.tipo === 'pptx' && p.spec.diapositivas[0].titulo === 'Plan' && p.spec.tema === 'azul');
  // Números como texto («1,5») valen, como en el presupuesto.
  const g = validarPedido(d({ tipo: 'grafico', titulo: 'X', grafico: { tipo: 'columnas', categorias: ['a', 'b'], series: [{ nombre: 's', valores: ['1,5', 2] }] } })).archivos[0];
  assert.ok(g && g.tipo === 'pptx' && g.spec.diapositivas[0].grafico!.tipo === 'barras' && g.spec.diapositivas[0].grafico!.series[0].valores[0] === 1.5);
});

test('tema: cada par texto/fondo cumple el contraste AA (≥ 4,5:1) y cada color de serie ≥ 3:1 contra el fondo', () => {
  assert.equal(Math.round(contraste('000000', 'FFFFFF') * 10) / 10, 21);
  for (const [nombre, t] of Object.entries(TEMAS)) {
    const pares: Array<[string, string, string]> = [
      ['texto/fondo', t.texto, t.fondo],
      ['tenue/fondo', t.tenue, t.fondo],
      ['título de columna y cifra (acento)/fondo', t.acento, t.fondo],
      ['cifra (acento)/banda', t.acento, t.banda],
      ['texto/banda', t.texto, t.banda],
      ['portada: texto/acento', t.sobreAcento, t.acento],
      ['portada: subtítulo/acento', t.sobreAcentoSuave, t.acento],
    ];
    for (const [que, a, b] of pares) assert.ok(contraste(a, b) >= 4.5, `${nombre} ${que}: ${contraste(a, b).toFixed(2)}`);
    for (const s of t.series) assert.ok(contraste(s, t.fondo) >= 3, `${nombre} serie ${s}: ${contraste(s, t.fondo).toFixed(2)}`);
    assert.equal(new Set(t.series).size, t.series.length, `${nombre}: series sin repetir`);
  }
});

/* ------------------------------------------------------------------ generar y releer */

test('pptx: se genera en Node, es un ZIP OOXML de presentación y se relee entero, diapositiva por diapositiva', async () => {
  const t0 = Date.now();
  const { a, b } = await generada();
  assert.equal(await tipoPorDentro(b), 'pptx');
  assert.ok(b.length > 20_000 && b.length < 1024 * 1024, `tamaño razonable: ${b.length} bytes`);
  const v = await validarArchivo(a, b);
  assert.equal(v.tipoReal, 'pptx');
  assert.deepEqual(v.estructural.defectos, []);
  assert.equal(v.semantico.ok, true, JSON.stringify(v.semantico.comprobaciones.filter((c) => !c.ok)));
  assert.equal(v.paginas, 8);
  const ques = v.semantico.comprobaciones.map((c) => c.que).join(' | ');
  for (const q of ['número de diapositivas', 'en SU diapositiva', 'notas del orador', 'marcador de título', 'numeración', 'tablas con todas sus celdas', 'gráficos con sus series', 'texto alternativo', 'propiedades', 'es-HN']) assert.ok(ques.includes(q), `comprueba ${q}`);
  // Lo que lee el lector de lo que LLEGA (lib/leer-oficina.ts): 8 páginas, en orden, con las notas.
  const pags = await paginasDePptx(b);
  assert.deepEqual(pags.map((p) => p.pagina), [1, 2, 3, 4, 5, 6, 7, 8]);
  assert.match(pags[1].texto, /Resumen ejecutivo[\s\S]*Ley media de 3\.2 g\/t[\s\S]*Notas: Subrayar/);
  assert.ok(Date.now() - t0 < 15_000);
});

test('segundo lector independiente (python-pptx, o DOM propio): 8 diapositivas, títulos, tabla, gráfico, notas y 16:9', async (t) => {
  const { b } = await generada();
  const l = await segundoLector(b);
  t.diagnostic(`lector: ${l.lector}`);
  const e = PRESENTACION.spec;
  assert.equal(l.titulo, e.titulo);
  assert.equal(l.diapositivas.length, 8);
  assert.deepEqual(
    l.diapositivas.map((d) => d.titulo),
    e.diapositivas.map((d) => d.titulo)
  );
  if ('ancho' in l) assert.equal(Math.round(((l as any).ancho / (l as any).alto) * 100) / 100, 1.78);
  // La tabla, celda por celda.
  assert.deepEqual(l.diapositivas[3].tablas, [[e.diapositivas[3].tabla!.cabecera, ...e.diapositivas[3].tabla!.filas]]);
  // El gráfico: categorías, nombres de serie y valores.
  const g = l.diapositivas[4].graficos[0];
  assert.deepEqual(g.categorias, e.diapositivas[4].grafico!.categorias);
  assert.deepEqual(g.series.map((s) => [s.nombre, s.valores.map(Number)]), e.diapositivas[4].grafico!.series.map((s) => [s.nombre, s.valores]));
  // Viñetas, cifras, columnas y cita en su diapositiva; las notas del orador.
  const textoDe = (k: number) => l.diapositivas[k].textos.join('\n');
  for (const v of e.diapositivas[1].vinetas!) assert.ok(textoDe(1).includes(v), v);
  for (const c of e.diapositivas[2].cifras!) assert.ok(textoDe(2).includes(c.valor) && textoDe(2).includes(c.etiqueta));
  assert.ok(textoDe(5).includes('Trámite de agua aún pendiente'));
  assert.ok(textoDe(6).includes(e.diapositivas[6].cita!.texto));
  assert.match(l.diapositivas[1].notas, /Subrayar que la ley media/);
  assert.match(l.diapositivas[0].notas, /Agradecer la asistencia/);
});

test('pptx: barras, líneas y pastel salen como gráficos nativos con su texto alternativo (todos los datos)', async () => {
  const base = PRESENTACION.spec;
  const a = uno({
    tipo: 'pptx',
    nombre: 'graficos.pptx',
    spec: {
      titulo: 'Gráficos',
      tema: 'vino',
      diapositivas: [
        { tipo: 'grafico', titulo: 'Onzas por año', grafico: { tipo: 'lineas', categorias: ['2024', '2025', '2026'], series: [{ nombre: 'Oro', valores: [1200.5, 1500, 1720] }] } },
        { tipo: 'grafico', titulo: 'Reparto de la inversión', grafico: { tipo: 'pastel', categorias: ['Perforación', 'Laboratorio', 'Permisos'], series: [{ nombre: 'Inversión', valores: [62, 23, 15] }] } },
        base.diapositivas[4],
      ],
    },
  });
  const b = await generarArchivo(a);
  const v = await validarArchivo(a, b);
  assert.equal(v.estructural.ok && v.semantico.ok, true, JSON.stringify([v.estructural.defectos, v.semantico.comprobaciones.filter((c) => !c.ok)]));
  const zip = await JSZip.loadAsync(b);
  const charts = await Promise.all(Object.keys(zip.files).filter((n) => /^ppt\/charts\/chart\d+\.xml$/.test(n)).map((n) => zip.file(n)!.async('text')));
  assert.ok(charts.some((x) => x.includes('<c:lineChart>')) && charts.some((x) => x.includes('<c:pieChart>')) && charts.some((x) => x.includes('<c:barChart>')));
  if (a.tipo === 'pptx') assert.equal(textoAlternativo('Reparto', a.spec.diapositivas[1].grafico!), 'Gráfico de pastel: Reparto. Inversión: Perforación 62, Laboratorio 23, Permisos 15');
  const s1 = await zip.file('ppt/slides/slide1.xml')!.async('text');
  assert.match(s1, /descr="Gráfico de líneas: Onzas por año\. 2024 1,200\.5, 2025 1,500, 2026 1,720"/);
});

/* ------------------------------------------------------------------ lo malo se caza */

test('validación pptx: ZIP cortado, diapositiva faltante, enlace de afuera, macros y objetos incrustados no pasan', async () => {
  const { a, b } = await generada();
  const mal = async (datos: Buffer, re: RegExp, que: string) => {
    const v = await validarArchivo(a, datos);
    assert.equal(v.estructural.ok, false, `${que}: debió fallar la estructura`);
    assert.match(v.estructural.defectos.join(' | '), re, que);
    assert.equal(v.semantico.ok, false);
  };
  await mal(b.subarray(0, Math.floor(b.length * 0.6)), /dañado o cortado|no es pptx/, 'ZIP cortado');
  await mal(await reZip(b, async (z) => void z.remove('ppt/slides/slide5.xml')), /le faltan 1 diapositiva/, 'diapositiva faltante');
  await mal(
    await reZip(b, async (z) => {
      const f = 'ppt/slides/_rels/slide2.xml.rels';
      z.file(f, (await z.file(f)!.async('text')).replace('</Relationships>', '<Relationship Id="rId99" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="https://malo.example/x" TargetMode="External"/></Relationships>'));
    }),
    /slide2\.xml\.rels apunta a una dirección de afuera/,
    'enlace de afuera'
  );
  await mal(await reZip(b, async (z) => void z.file('ppt/vbaProject.bin', Buffer.from('macro'))), /binaria o con macros/, 'macro');
  await mal(
    await reZip(b, async (z) => {
      const f = '[Content_Types].xml';
      z.file(f, (await z.file(f)!.async('text')).replace('presentationml.presentation.main+xml', 'presentationml.presentation.main+xml"/><Override PartName="/x" ContentType="application/vnd.ms-powerpoint.presentation.macroEnabled.main+xml'));
    }),
    /CON MACROS/,
    'tipo con macros'
  );
  await mal(await reZip(b, async (z) => void z.file('ppt/embeddings/oleObject1.bin', Buffer.from('ole'))), /incrustado|binaria/, 'objeto OLE');
  // El libro de datos del gráfico, con un enlace a otro libro de afuera.
  await mal(
    await reZip(b, async (z) => {
      const n = Object.keys(z.files).find((x) => /^ppt\/embeddings\/.+\.xlsx$/.test(x))!;
      const libro = await reZip(await z.file(n)!.async('nodebuffer'), async (e) => {
        e.file('xl/_rels/workbook.xml.rels', (await e.file('xl/_rels/workbook.xml.rels')!.async('text')).replace('</Relationships>', '<Relationship Id="rId77" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/externalLink" Target="externalLinks/externalLink1.xml"/></Relationships>'));
      });
      z.file(n, libro);
    }),
    /Microsoft_Excel_Worksheet1\.xlsx apunta a una dirección de afuera/,
    'libro incrustado con enlace externo'
  );
  // Un docx disfrazado de .pptx: por dentro no es una presentación.
  const docx = await generarArchivo(uno({ tipo: 'docx', nombre: 'x.docx', spec: { titulo: 'X', secciones: [{ parrafos: ['hola'] }] } }));
  await mal(docx, /por dentro no es pptx \(es docx\)/, 'otro tipo');
});

test('validación pptx: lo que cambia por dentro (texto, celda, valor del gráfico, orden, una diapositiva menos) se caza al releer', async () => {
  const { a, b } = await generada();
  const semanticaMala = async (datos: Buffer, re: RegExp, que: string) => {
    const v = await validarArchivo(a, datos);
    assert.equal(v.estructural.ok, true, `${que}: la estructura sigue sana (${v.estructural.defectos.join('; ')})`);
    assert.equal(v.semantico.ok, false, `${que}: debió fallar la relectura`);
    assert.match(JSON.stringify(v.semantico.comprobaciones.filter((c) => !c.ok)), re, que);
  };
  const cambiar = (parte: string, de: string | RegExp, a2: string) => reZip(b, async (z) => void z.file(parte, (await z.file(parte)!.async('text')).replace(de, a2)));
  await semanticaMala(await cambiar('ppt/slides/slide2.xml', 'Licencia ambiental aprobada en agosto', 'Licencia en trámite'), /diapositiva 2: «Licencia ambiental/, 'viñeta cambiada');
  await semanticaMala(await cambiar('ppt/slides/slide4.xml', '<a:t>57,400</a:t>', '<a:t>75,400</a:t>'), /fila 3, columna 4/, 'celda cambiada');
  await semanticaMala(await cambiar('ppt/slides/slide4.xml', /<a:tr\b(?:(?!<\/a:tr>)[\s\S])*?Sur[\s\S]*?<\/a:tr>/, ''), /4 filas × 4 columnas \(pedidas 5 × 4\)/, 'fila de la tabla quitada');
  await semanticaMala(await cambiar('ppt/charts/chart1.xml', '<c:v>670</c:v>', '<c:v>970</c:v>'), /serie 2: valores distintos/, 'valor del gráfico cambiado');
  await semanticaMala(await cambiar('ppt/slides/slide3.xml', /<a:fld\b[^>]*type="slidenum"[\s\S]*?<\/a:fld>/, ''), /sin número: 3/, 'sin numeración');
  await semanticaMala(await cambiar('docProps/core.xml', /<dc:title>[^<]*<\/dc:title>/, '<dc:title>Otro</dc:title>'), /propiedades/, 'título de las propiedades');
  // El orden: la diapositiva 2 y la 3 intercambiadas en ppt/presentation.xml (los archivos siguen ahí).
  await semanticaMala(await cambiar('ppt/presentation.xml', /(<p:sldId id="257" r:id="rId3"\/>)(<p:sldId id="258" r:id="rId4"\/>)/, '$2$1'), /en SU diapositiva/, 'orden alterado');
  // Una diapositiva menos, quitada con cuidado (lista, relación y archivo): la estructura está sana, pero no son 8.
  const sinUna = await reZip(b, async (z) => {
    z.file('ppt/presentation.xml', (await z.file('ppt/presentation.xml')!.async('text')).replace('<p:sldId id="263" r:id="rId9"/>', ''));
    z.file('ppt/_rels/presentation.xml.rels', (await z.file('ppt/_rels/presentation.xml.rels')!.async('text')).replace(/<Relationship Id="rId9"[^>]*\/>/, ''));
    z.remove('ppt/slides/slide8.xml');
    z.remove('ppt/slides/_rels/slide8.xml.rels');
  });
  await semanticaMala(sinUna, /7 en el archivo.*8 pedidas/, 'una diapositiva menos');
});

/* ------------------------------------------------------------------ render */

test('render pptx: sin LibreOffice queda «omitido»; con LibreOffice (Impress) da una página por diapositiva; nunca rompe', async (t) => {
  const { a, b } = await generada();
  const antes = process.env.AURA_SOFFICE;
  process.env.AURA_SOFFICE = 'off';
  try {
    const v = await validarArchivo(a, b, { renderizar: true });
    assert.equal(v.render?.estado, 'omitido');
    assert.equal(v.semantico.ok, true);
    assert.equal(v.paginas, 8);
  } finally {
    if (antes === undefined) delete process.env.AURA_SOFFICE;
    else process.env.AURA_SOFFICE = antes;
  }
  if (!libreOfficeDisponible()) return t.diagnostic('sin LibreOffice: solo el camino «omitido»');
  const r = await renderizar(b, 'pptx', 90_000);
  t.diagnostic(`LibreOffice: ${JSON.stringify(r)}`);
  assert.ok(r.estado === 'hecho' || r.estado === 'fallido', JSON.stringify(r));
  if (r.estado === 'hecho') {
    assert.equal(r.paginas, 8, 'una página por diapositiva');
    const v = await validarArchivo(a, b, { renderizar: true });
    assert.equal(v.render?.estado, 'hecho');
    assert.equal(v.paginas, 8);
  } else assert.ok(r.detalle.length > 10, 'dice por qué (p. ej. un LibreOffice sin Impress)');
});

/* ------------------------------------------------------------------ requisitos */

test('requisitos: «una presentación de 8 diapositivas» es UNA presentación con 8 diapositivas (no 8 archivos ni conteo dudoso)', () => {
  assert.deepEqual(diapositivasPedidas(PEDIDO), [8]);
  assert.deepEqual(diapositivasPedidas('Haz una presentación de PowerPoint de diez láminas'), [10]);
  assert.deepEqual(diapositivasPedidas('Make a presentation with eight slides about gold'), [8]);
  assert.deepEqual(diapositivasPedidas('Crea resultados.pptx con 6 diapositivas'), [6]);
  assert.deepEqual(diapositivasPedidas('Hazme una presentación sobre ventas'), []);
  const r = requisitosDeEntrega(PEDIDO);
  assert.equal(r.items.length, 1);
  assert.equal(r.items[0].etiqueta, 'una presentación');
  assert.equal(r.items[0].cantidadSegura, true);
  assert.ok(r.items[0].extensiones.includes('pptx'));
  // «Presentación en/de PowerPoint» es una sola cosa dicha dos veces (antes salían dos requisitos y nunca quedaba completa).
  for (const t of ['Haz una presentación en PowerPoint sobre ventas', 'Haz una presentación de PowerPoint de diez láminas', 'Hazme una hoja de cálculo en Excel con los gastos']) assert.equal(requisitosDeEntrega(t).items.length, 1, t);
  assert.equal(requisitosDeEntrega('Hazme un informe en Word y una presentación de 10 láminas').items.length, 2);
  assert.equal(requisitosDeEntrega('Hazme dos presentaciones').items.length, 2);
});

/* ------------------------------------------------------------------ entrega, herramienta y descarga */

const entorno = () => ({ almacen: almacenEnMemoria(), archivos: almacenArchivosMemoria() });

test('entrega: «de 8 diapositivas» se comprueba en el archivo; con otra cantidad no se hace y se dice por qué', async () => {
  const env = entorno();
  const dueno = 'marta@ejemplo.com';
  const r = await crearDocumentos({ dueno, requestId: 'pptx-1', entrada: { archivos: [PRESENTACION] }, instruccion: PEDIDO, ...env });
  assert.equal(r.estado, 'completo', r.texto);
  const f = r.archivos[0];
  assert.equal(f.tipo, 'pptx');
  assert.equal(f.mime, MIME.pptx);
  assert.equal(f.paginas, 8);
  assert.equal(f.tipoReal, 'pptx');
  assert.ok(f.comprobaciones!.some((c) => c.que === 'las 8 diapositivas que pidió la persona' && c.ok));
  assert.match(r.texto, /DOCUMENTOS LISTOS Y COMPROBADOS.*Exploración Olancho\.pptx: presentación de PowerPoint de \d+(\.\d)? KB \(8 diapositivas\)/);
  assert.doesNotMatch(r.texto, /\/api\/documentos|\/tmp|data\/documentos/, 'sin rutas para el modelo');
  assert.equal(r.pedidos.length, 1);
  assert.equal(r.pedidos[0].estado, 'verified');
  const d = await abrirDescarga(dueno, f.id!, env);
  assert.equal(d.estado, 'ok');
  if (d.estado === 'ok') {
    assert.equal(d.m.mime, MIME.pptx);
    assert.equal(await tipoPorDentro(d.datos), 'pptx');
  }

  // Pidió 8 y la especificación trae 6: no se genera; el recibo dice el porqué para que el modelo la rehaga.
  const seis = { ...PRESENTACION, spec: { ...PRESENTACION.spec, diapositivas: PRESENTACION.spec.diapositivas.slice(0, 6) } };
  const r2 = await crearDocumentos({ dueno, requestId: 'pptx-2', entrada: { archivos: [seis] }, instruccion: PEDIDO, ...entorno() });
  assert.equal(r2.estado, 'fallido');
  assert.equal(r2.archivos[0].estado, 'fallido');
  assert.match(r2.texto, /pidió 8 diapositivas y la especificación trae 6/);
  assert.match(r2.texto, /NO PUDE HACER LOS DOCUMENTOS/);
});

const MANOS: ManosDelTurno = { app: false, manos: [], sistema: false, computadora: true, correo: false, whatsapp: false, sesion: true, triaje: false };

test('herramienta para el modelo: ofrece pptx (descripción, esquema y enum) y la promesa «te hago la presentación» la pide', () => {
  const doc = herramientasDelTurno(MANOS).find((t) => t.toolSpec!.name === 'crear_documento')!;
  assert.match(doc.toolSpec!.description!, /PowerPoint \(\.pptx\)/);
  const items = (doc.toolSpec!.inputSchema as any).json.properties.archivos.items;
  assert.deepEqual(items.properties.tipo.enum, ['docx', 'xlsx', 'pptx', 'pdf']);
  assert.match(items.properties.spec.description, /diapositivas:\[\{tipo:portada\|vinetas\|dos_columnas\|tabla\|cifras\|grafico\|cita\|cierre/);
  assert.ok(herramientasQueCumplen('Te preparo la presentación ahora mismo.', ['crear_documento'], { mensaje: 'hazme una presentación de 8 diapositivas' }).includes('crear_documento'));
});

test('de punta a punta: crear_documento (pptx) → línea → harness → runner → recibo → descarga con sesión y con el enlace firmado', async () => {
  const linea = lineaDeHerramienta('crear_documento', { archivos: [PRESENTACION] })!;
  const ped = extraerPedidoHerramienta(`Te la preparo.\n${linea}\n`)!;
  assert.equal(ped.herramienta, 'documento');
  const ctx = nuevoContextoTrabajos('turno-pptx-0001');
  const r = await enTurnoConTrabajos(ctx, () => correrDocumento({ dueno: 'marta@ejemplo.com', arg: ped.arg, pedido: PEDIDO }));
  assert.equal(r.estado, 'succeeded', r.texto);
  assert.match(r.texto, /^HARNESS documento: DOCUMENTOS LISTOS Y COMPROBADOS/);
  assert.match(r.texto, /8 diapositivas/);
  assert.doesNotMatch(r.texto, /\/api\/documentos/);
  assert.equal(ctx.refs[0]?.state, 'completed');
  const requestId = await enTurnoConTrabajos(ctx, async () => pedidoDeDocumentos(ped.arg).requestId);
  const id = idArchivo('marta@ejemplo.com', requestId, 'Exploración Olancho.pptx');

  const app = express();
  montarRutasDocumentos(app, {
    exigirMesa: (_req, _res, next) => next(),
    limitar: () => (_req, _res, next) => next(),
    sesionDe: (req) => (req.headers['x-prueba-sesion'] === undefined ? null : { correo: String(req.headers['x-prueba-sesion']) }),
    autoridad: async () => 'permitida',
  });
  const srv = app.listen(0, '127.0.0.1');
  await new Promise((ok) => srv.once('listening', ok));
  const base = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
  try {
    const res = await fetch(`${base}/api/documentos/${id}`, { headers: { 'x-prueba-sesion': 'marta@ejemplo.com' } });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('content-type'), MIME.pptx);
    assert.equal(res.headers.get('content-disposition'), disposicionDescarga('Exploración Olancho.pptx'));
    assert.match(String(res.headers.get('content-disposition')), /filename="Exploracion Olancho\.pptx"; filename\*=UTF-8''Exploraci%C3%B3n%20Olancho\.pptx/);
    assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
    const cuerpo = Buffer.from(await res.arrayBuffer());
    assert.equal(crypto.createHash('sha256').update(cuerpo).digest('hex'), res.headers.get('x-documento-sha256'));
    assert.equal(await tipoPorDentro(cuerpo), 'pptx');
    assert.equal((await paginasDePptx(cuerpo)).length, 8);
    assert.equal((await fetch(`${base}/api/documentos/${id}`, { headers: { 'x-prueba-sesion': 'ana@ejemplo.com' } })).status, 404, 'otra cuenta no la ve');
    // El enlace firmado de la tarjeta la baja sin cabeceras.
    const tarjeta = conEnlacesDeDocumentos({ result: { evidence: [{ tipo: 'archivo', ref: id }] } }, 'marta@ejemplo.com', base);
    const firmado = await fetch(tarjeta.result.evidence[0].ref!);
    assert.equal(firmado.status, 200);
    assert.equal(firmado.headers.get('content-type'), MIME.pptx);
    assert.equal(Buffer.from(await firmado.arrayBuffer()).length, cuerpo.length);
  } finally {
    await new Promise((ok) => srv.close(ok));
  }
});
