/**
 * Las manos que le faltaban a Dr Electrum (auditoría del 10 de octubre de 2026): la pantalla, el
 * análisis de un área dictada, el estado del sistema, y los campos de los KML de ArcGIS que el
 * cerebro leía como HTML.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { comandoDePantalla, pantalla, poligonoDeTexto } from '../server/electrum/manos-pantalla';
import { camposDeDescripcion } from '../server/electrum/gis';
import { MAPA, MANOS, TODAS } from '../server/electrum/manos';

test('pantalla: lo pedido es el mismo comando que ya ejecuta la voz', () => {
  assert.deepEqual(comandoDePantalla('fondo', 'satélite'), { accion: 'fondo', cual: 'satelite' });
  assert.deepEqual(comandoDePantalla('fondo', 'calles'), { accion: 'fondo', cual: 'calles' });
  assert.deepEqual(comandoDePantalla('tres_d', 'si'), { accion: 'tresD', activar: true });
  assert.deepEqual(comandoDePantalla('vista', 'pais'), { accion: 'pais' });
  assert.deepEqual(comandoDePantalla('vista', 'acercar'), { accion: 'zoom', dir: 1 });
  assert.deepEqual(comandoDePantalla('abrir', 'tablero'), { accion: 'abrir', que: 'tablero' });
  assert.deepEqual(comandoDePantalla('ficha', 'timelapse'), { accion: 'ficha', que: 'timelapse' });
  assert.deepEqual(comandoDePantalla('mesa', 'no'), { accion: 'mesa', abrir: false });
  assert.ok('error' in comandoDePantalla('fondo', 'marciano'));
  assert.ok('error' in comandoDePantalla('borrar', 'todo'), 'lo que no es un control no se hace');
  // Un interruptor sin valor no se adivina: no apaga el 3D por omisión.
  for (const a of ['tres_d', 'mesa', 'silencio', 'pantalla_completa']) assert.ok('error' in comandoDePantalla(a, ''), a);
  assert.deepEqual(comandoDePantalla('tres_d', 'no'), { accion: 'tresD', activar: false });
});

test('pantalla: manda la orden a la interfaz y no dice que hizo lo que no hizo', async () => {
  const web = { canal: 'mesa', mapa: { capas: [] } } as any;
  const tg = await pantalla.ejecutar({ accion: 'fondo', valor: 'satelite' }, { canal: 'telegram' } as any);
  assert.equal(tg.ok, false, 'en Telegram no hay pantalla que cambiar');
  assert.equal(tg.ui, undefined);
  const r = await pantalla.ejecutar({ accion: 'fondo', valor: 'satelite' }, web);
  assert.equal(r.ok, true);
  assert.deepEqual(r.ui, { accion: 'comando', comando: { accion: 'fondo', cual: 'satelite' } });
  const mal = await pantalla.ejecutar({ accion: 'vista', valor: 'nada' }, web);
  assert.equal(mal.ok, false);
  assert.equal(mal.ui, undefined);
});

test('area_analizar: vértices en grados, al revés (lat, lon) o en UTM 16N', () => {
  const g = poligonoDeTexto('-87.0 13.3; -86.99 13.3; -86.99 13.31; -87.0 13.31') as any;
  assert.equal(g.g.type, 'Polygon');
  assert.deepEqual(g.g.coordinates[0][0], g.g.coordinates[0].at(-1), 'el anillo se cierra solo');
  const latlon = poligonoDeTexto('13.3 -87.0; 13.3 -86.99; 13.31 -86.99') as any;
  assert.deepEqual(latlon.g.coordinates[0][0], [-87.0, 13.3]);
  const utm = poligonoDeTexto('500000 1470000; 501000 1470000; 501000 1471000; 500000 1471000', 'UTM 16N WGS84') as any;
  const [lon, lat] = utm.g.coordinates[0][0];
  assert.ok(lon > -87.1 && lon < -86.9 && lat > 13.2 && lat < 13.4, `${lon} ${lat}`);
  assert.ok('error' in poligonoDeTexto('-87 13'), 'menos de tres vértices no es un área');
  assert.ok('error' in poligonoDeTexto('-70 40; -70.1 40; -70.1 40.1'), 'fuera de Honduras');
});

test('KML de ArcGIS: los campos de la tabla de la descripción salen como atributos', () => {
  const v =
    '<html><body><table><tr style="x"><td>0</td></tr><tr><td><table><tr><td>fid</td><td>60</td></tr>' +
    '<tr bgcolor="#d4"><td>Unidad</td><td>Tpm</td></tr><tr><td>Formación</td><td>Grupo Padre Miguel</td></tr><tr><td>era</td><td></td></tr>' +
    '<tr><td>Litolog&#237;a</td><td>toba &amp; ignimbrita</td></tr></table></td></tr></table></body></html>';
  assert.deepEqual(camposDeDescripcion({ '@type': 'html', value: v }), { fid: '60', Unidad: 'Tpm', Formación: 'Grupo Padre Miguel', Litología: 'toba & ignimbrita' });
  assert.deepEqual(camposDeDescripcion('texto suelto sin tabla'), {});
  assert.deepEqual(camposDeDescripcion(null), {});
});

test('las manos nuevas están registradas: sin panel y en el modo mapa', () => {
  for (const n of ['pantalla', 'area_analizar', 'sistema_estado']) {
    assert.ok(MANOS[n], n);
    assert.ok(TODAS.some((h) => h.nombre === n), `${n} sin panel`);
  }
  for (const n of ['pantalla', 'area_analizar', 'encender_capa', 'mapa_volar']) assert.ok(MAPA.some((h) => h.nombre === n), `${n} en modo mapa`);
});

test('filtros por el validador de argumentos (bucle del cerebro y MCP): el objeto llega objeto', async () => {
  const fs = await import('node:fs');
  const { filtrosReales, contar_entidades } = await import('../server/electrum/manos-capas');
  const { validar } = await import('../lib/agente/protocolo');
  // Antes el validador convertía {"mineral":["Oro"]} en «[object Object]» (revisión de Codex en #171).
  const v = validar(contar_entidades.esquema, { id_capa: '110002', filtros: { mineral: ['Oro'] } });
  assert.ok(v.ok);
  assert.deepEqual((v as any).args.filtros, { mineral: ['Oro'] });
  const t = validar(contar_entidades.esquema, { id_capa: '110002', filtros: '{"mineral":["Oro"]}' });
  assert.deepEqual((t as any).args.filtros, { mineral: ['Oro'] }, 'como texto JSON también');
  assert.equal(validar(contar_entidades.esquema, { id_capa: '110002', filtros: 'oro' }).ok, false, 'lo que no es objeto se dice');
  const capas = JSON.parse(fs.readFileSync('scripts/indice-capas/manifest.json', 'utf8')).capas;
  const fichas = capas.find((c: any) => c.id === 110002);
  assert.deepEqual(filtrosReales(fichas, '{"mineral":["Oro"]}').filtros, { mineral: ['Oro'] });
  assert.deepEqual(filtrosReales(fichas, { mineral: ['Oro'] }).filtros, { mineral: ['Oro'] });
  assert.ok(filtrosReales(fichas, 'mineral oro').error, 'texto que no es JSON: se dice, no se cuenta todo');
});
