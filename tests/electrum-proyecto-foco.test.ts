/**
 * EL PROYECTO EN FOCO (regla 7 de la Etapa 1): de qué proyecto se habla en un seguimiento, y que al
 * pasar a otro no se mezclen. Con los proyectos del índice real del repositorio.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { bloqueProyecto, previasDelFoco, proyectoEnFoco, proyectosDelIndice, proyectosEn } from '../server/electrum/proyecto-foco';

const P = proyectosDelIndice(JSON.parse(fs.readFileSync('scripts/indice-capas/manifest.json', 'utf8')).capas);
const u = (content: string) => ({ role: 'user' as const, content });
const a = (content: string) => ({ role: 'assistant' as const, content });

test('los proyectos salen del índice, con sus alias', () => {
  assert.deepEqual(P.map((p) => p.id).sort(), [301000, 302000, 303000, 304000]);
  assert.deepEqual(proyectosEn('dame el plan de Buena Vista', P).map((p) => p.id), [302000]);
  assert.deepEqual(proyectosEn('y de Monarka?', P).map((p) => p.id), [302000]);
  assert.deepEqual(proyectosEn('el proyecto Cimarrón, en El Chaparro', P).map((p) => p.id), [303000]);
  assert.deepEqual(proyectosEn('¿cuántas concesiones hay en Olancho?', P), []);
  // Como palabra entera: «pantaleonas» o «buenavistazo» no son el proyecto.
  assert.deepEqual(proyectosEn('pantaleonas', P), []);
});

test('un seguimiento sin nombre es del proyecto de la conversación', () => {
  const f = proyectoEnFoco('¿y su geología?', [u('háblame de Pantaleona'), a('Pantaleona tiene 3 vetas…')], P);
  assert.equal(f.actual?.id, 301000);
  assert.equal(f.sigue, true);
  assert.match(bloqueProyecto(f)!, /^PROYECTO EN FOCO: Pantaleona \(carpeta 301000 del índice\), el de esta conversación/);
});

test('cambiar de proyecto: el nuevo manda y se avisa que no se arrastre el viejo', () => {
  const f = proyectoEnFoco('ahora pasemos a Buena Vista', [u('háblame de Pantaleona'), a('Pantaleona tiene 3 vetas…')], P);
  assert.equal(f.actual?.id, 302000);
  assert.equal(f.anterior?.id, 301000);
  const b = bloqueProyecto(f)!;
  assert.match(b, /ahora Buenavista Monarca/);
  assert.match(b, /no arrastres sus cifras, documentos ni conclusiones a Buenavista Monarca/);
  // Y el seguimiento siguiente ya es del nuevo.
  const g = proyectoEnFoco('¿y las trincheras?', [u('háblame de Pantaleona'), a('Pantaleona…'), u('ahora pasemos a Buena Vista'), a('Buena Vista tiene…')], P);
  assert.equal(g.actual?.id, 302000);
});

test('comparar dos proyectos: separados; y sin proyecto, sin nota', () => {
  const f = proyectoEnFoco('compara Pantaleona con Cimarrón', [], P);
  assert.equal(f.actual, null);
  assert.match(bloqueProyecto(f)!, /^PROYECTOS: la pregunta compara Pantaleona y Cimarrón/);
  assert.equal(bloqueProyecto(proyectoEnFoco('¿qué dice la ley de minería?', [], P)), null);
});

test('alias que son frases comunes: solo con señal de proyecto', () => {
  assert.deepEqual(proyectosEn('¿qué minas de oro hay en Honduras?', P), []);
  assert.deepEqual(proyectosEn('la aldea tiene buena vista al valle', P), []);
  assert.deepEqual(proyectosEn('dame el proyecto minas de oro', P).map((p) => p.id), [304000]);
  assert.deepEqual(proyectosEn('¿qué hay en Minas de Oro?', P).map((p) => p.id), [304000]);
  assert.deepEqual(proyectosEn('el informe de Buena Vista', P).map((p) => p.id), [302000]);
  assert.deepEqual(proyectosEn('el plan de MDO', P).map((p) => p.id), [304000]);
  assert.deepEqual(proyectosEn('mdo', P), []);
  // Un nombre propio de verdad no necesita señal.
  assert.deepEqual(proyectosEn('¿y pantaleona?', P).map((p) => p.id), [301000]);
});

test('las preguntas de antes no cruzan la frontera del proyecto', () => {
  const h = [u('¿qué dice el informe de muestreo de Pantaleona?'), a('Pantaleona…'), u('¿y el anexo?'), a('…'), u('pasemos a Monarka'), a('Buenavista Monarca…')];
  const f = proyectoEnFoco('¿qué concluye el informe?', h, P);
  assert.equal(f.actual?.id, 302000);
  assert.deepEqual(previasDelFoco(h, f, P), ['pasemos a Monarka'], 'nada de Pantaleona');
  // Al cambiar, nada de antes.
  const g = proyectoEnFoco('pasemos a Monarka', h.slice(0, 4), P);
  assert.deepEqual(previasDelFoco(h.slice(0, 4), g, P), []);
  // Dentro del mismo proyecto, las dos últimas.
  const k = proyectoEnFoco('¿y el tercero?', h.slice(0, 4), P);
  assert.deepEqual(previasDelFoco(h.slice(0, 4), k, P), ['¿qué dice el informe de muestreo de Pantaleona?', '¿y el anexo?']);
  // Sin proyecto: no se mete en una conversación de proyecto.
  const sin = [u('Pantaleona'), a('…'), u('¿cuántas concesiones hay?'), a('…')];
  assert.deepEqual(previasDelFoco(sin, { actual: null, anterior: null, varios: [], sigue: false }, P), ['¿cuántas concesiones hay?']);
});
