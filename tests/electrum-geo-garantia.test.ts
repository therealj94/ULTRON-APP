/**
 * «Ahí tenés los tres» sin haber dibujado nada (La Escalera, 28-09): la garantía dibuja los mapas
 * con la misma herramienta, o corrige la respuesta si no se pudo.
 */
import './datos-prueba'; // la junta inventada de las pruebas (lo real vive en Render)
import test from 'node:test';
import assert from 'node:assert/strict';
import { garantizarMapasGeo, PIDE_MAPAS_GEO, tipoPedido, zonaDelPedido } from '../server/electrum/geo-garantia';
import type { Contexto, Herramienta } from '../lib/agente/tipos';

const ctx: Contexto = { quien: 'jose', nivel: 'mando', plataforma: 'electrum', canal: 'mesa' } as Contexto;
const BOTON = 'Hacé los tres mapas geológicos (litológico, estructural y geotectónico) de la concesión La Escalera (id 228).';

function falsa(ok = true) {
  const llamadas: any[] = [];
  const h = {
    nombre: 'mapa_geologico',
    descripcion: '',
    esquema: { type: 'object', properties: { tipo: { type: 'string' }, concesion_id: { type: 'integer' }, nombre: { type: 'string' } } },
    plataformas: ['electrum'],
    async ejecutar(args: any) {
      llamadas.push(args);
      return ok
        ? { ok: true, texto: 'Dibujé 3 mapas (mapa litológico, mapa estructural, mapa geotectónico); ya están listos para ver. Si hace falta explicarlos…', ui: { informe: { id: 'a' }, informes: [{ id: 'a' }, { id: 'b' }, { id: 'c' }] } }
        : { ok: false, texto: 'No encontré esa concesión en el catastro.' };
    },
  } as unknown as Herramienta;
  return { h, llamadas };
}

test('lo que pide el botón de la ficha', () => {
  assert.deepEqual(zonaDelPedido(BOTON), { concesion_id: 228 });
  assert.equal(tipoPedido(BOTON), 'todos');
  assert.equal(tipoPedido('hacé el mapa estructural de la concesión Minas de Oro'), 'estructural');
  assert.deepEqual(zonaDelPedido('mapa litológico de la concesión Cerro Partido'), { nombre: 'Cerro Partido' });
  assert.deepEqual(zonaDelPedido('mapa litológico de la concesión Cerro Partido por favor'), { nombre: 'Cerro Partido' });
  assert.deepEqual(zonaDelPedido('los mapas geológicos de la concesión Finca San Luis y Finca el Mango para mañana'), { nombre: 'Finca San Luis y Finca el Mango' });
});

test('solo cuenta como pedido si dice «mapa»', () => {
  for (const si of [BOTON, 'hacé el mapa estructural de X', 'mapa de fallas de la concesión Y', 'quiero los mapas geológicos', 'el mapa geotectónico']) assert.ok(PIDE_MAPAS_GEO.test(si), si);
  for (const no of ['explicame el contexto litológico de la concesión X', '¿qué rumbo estructural tiene?', 'el marco geotectónico de Honduras']) assert.ok(!PIDE_MAPAS_GEO.test(no), no);
});

test('el modelo dijo «ahí tenés los tres» sin dibujar: se dibujan de verdad', async () => {
  const { h, llamadas } = falsa();
  const g = await garantizarMapasGeo({ mensaje: BOTON, texto: 'Ahí tenés los tres, José. Litológico, estructural y geotectónico de La Escalera.', corrieron: [{ herramienta: 'laya_panel', ok: true }], herramienta: h, ctx });
  assert.deepEqual(llamadas, [{ tipo: 'todos', concesion_id: 228 }]);
  assert.equal((g.ui as any).informes.length, 3);
  assert.match(g.texto, /Ahí tenés los tres/, 'ahora es verdad: se deja');
  assert.match(String(g.nota), /no los dibujó/);
});

test('si ya los dibujó, no se hace nada', async () => {
  const { h, llamadas } = falsa();
  const g = await garantizarMapasGeo({ mensaje: BOTON, texto: 'Ahí están.', corrieron: [{ herramienta: 'mapa_geologico', ok: true }], herramienta: h, ctx });
  assert.equal(llamadas.length, 0);
  assert.equal(g.ui, undefined);
  assert.equal(g.texto, 'Ahí están.');
});

test('si no se pueden dibujar, la respuesta no puede decir que están', async () => {
  const { h } = falsa(false);
  const g = await garantizarMapasGeo({ mensaje: BOTON, texto: 'Ahí tenés los tres, José.', corrieron: [], herramienta: h, ctx });
  assert.equal(g.ui, undefined);
  assert.doesNotMatch(g.texto, /^Ahí tenés/);
  assert.match(g.texto, /No te los pude dibujar.*No encontré esa concesión/s);
});

test('una pregunta que no pide mapas no se toca', async () => {
  const { h, llamadas } = falsa();
  const g = await garantizarMapasGeo({ mensaje: '¿cuántas concesiones hay en Olancho?', texto: 'Hay 206.', corrieron: [], herramienta: h, ctx });
  assert.equal(llamadas.length, 0);
  assert.equal(g.texto, 'Hay 206.');
});
