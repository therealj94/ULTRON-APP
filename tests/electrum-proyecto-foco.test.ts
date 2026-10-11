/**
 * EL PROYECTO EN FOCO (regla 7 de la Etapa 1): de qué proyecto se habla en un seguimiento, y que al
 * pasar a otro no se mezclen. Con los proyectos del índice real del repositorio.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { bloqueProyecto, proyectoEnFoco, proyectosDelIndice, proyectosEn } from '../server/electrum/proyecto-foco';

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
