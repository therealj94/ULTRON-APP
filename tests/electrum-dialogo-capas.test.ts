/**
 * DR ELECTRUM ABRE CAPAS CONVERSANDO: los diálogos de referencia A–E de las instrucciones de
 * corrección v1.0 (sección 4.5), contra el manifiesto real del repositorio. El conteo es de mentira
 * (aquí no hay base): lo que se prueba es qué entiende, qué pregunta, qué ordena al panel y que la
 * confirmación lleve los números que le da el conteo.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { dialogoCapas, estadoDelCliente, type OrdenMapa, type Pendiente } from '../server/electrum/dialogo-capas';
import { validarFiltros, type EntradaCatalogo, type EstadoMapa, type Filtros } from '../src-electrum/mapa/catalogo';

const CAPAS: EntradaCatalogo[] = JSON.parse(fs.readFileSync('scripts/indice-capas/manifest.json', 'utf8')).capas;
/** Cuentas de mentira: 412 fichas, 187 de oro, 64 de plata (las del documento). */
const CUENTAS: Record<string, number> = { '110002': 412, '110002|Oro': 187, '110002|Plata': 64 };
const contar = async (id: number, f: Filtros) => {
  const v = Object.values(f).flat();
  return CUENTAS[[id, ...v].join('|')] ?? (v.length ? 9 : CAPAS.find((c) => c.id === id)?.num_entidades ?? null);
};

/** Una conversación: el panel ejecuta las órdenes y manda su estado con la pregunta siguiente. */
function conversacion() {
  let estado: EstadoMapa = { capas: [] };
  let pendiente: Pendiente | null = null;
  const ordenes: OrdenMapa[][] = [];
  return {
    get estado() {
      return estado;
    },
    ordenes,
    async decir(t: string) {
      const r = await dialogoCapas(t, { capas: CAPAS, estado, pendiente, contar });
      if (!r) return null;
      pendiente = r.pendiente;
      ordenes.push(r.ordenes);
      for (const o of r.ordenes) {
        if (o.op === 'encender') estado = { capas: [...estado.capas.filter((c) => c.id !== o.id), { id: o.id, filtros: o.filtros || {} }] };
        if (o.op === 'filtro') estado = { capas: estado.capas.map((c) => (c.id === o.id ? { ...c, filtros: o.filtros } : c)) };
        if (o.op === 'apagar') estado = { capas: estado.capas.filter((c) => c.id !== o.id) };
        if (o.op === 'solo') estado = { capas: estado.capas.filter((c) => o.ids.includes(c.id)) };
        if (o.op === 'limpiar') estado = { capas: [] };
      }
      return r.texto;
    },
  };
}

test('caso A — sin filtro: ofrece los minerales reales y «Todas» abre todo con la cuenta', async () => {
  const c = conversacion();
  const p = await c.decir('Dame las fichas de ocurrencia.');
  assert.match(p!, /^Tengo las fichas de ocurrencia minera de: oro, plata, cobre/);
  assert.match(p!, /¿Quieres todas o algún mineral en especial\?$/);
  assert.doesNotMatch(p!, /plomo|zinc|litio/, 'solo valores que existen en los datos');
  assert.deepEqual(c.ordenes.at(-1), [], 'todavía no abre nada');
  const r = await c.decir('Todas.');
  assert.equal(r, 'Listo, abrí todas las fichas de ocurrencia (412 puntos), cada mineral con su color.');
  assert.deepEqual(c.estado.capas, [{ id: 110002, filtros: {} }]);
});

test('caso B — con filtro: abre solo el oro, con la cuenta y el color', async () => {
  const c = conversacion();
  const r = await c.decir('Ábreme las fichas de ocurrencia de oro.');
  assert.equal(r, 'Abrí solo las fichas de oro: 187 puntos, en amarillo.');
  assert.deepEqual(c.estado.capas, [{ id: 110002, filtros: { mineral: ['Oro'] } }]);
});

test('caso C — agregar otra capa sin perder la anterior, preguntando cuál', async () => {
  const c = conversacion();
  await c.decir('Ábreme las fichas de ocurrencia de oro.');
  const p = await c.decir('Ahora, además del oro, ábreme las zonas de reserva.');
  assert.equal(p, '«zonas de reserva» puede ser Áreas protegidas o Patrimonio público forestal. ¿Cuál quieres, o las dos?');
  const r = await c.decir('Áreas protegidas.');
  assert.match(r!, /^Agregué «Áreas protegidas» \(324 áreas\)\. Siguen visibles las fichas de oro\.$/);
  assert.deepEqual(c.estado.capas.map((x) => x.id), [110002, 101001], 'las fichas de oro siguen');
});

test('caso D — cambiar el filtro de lo abierto', async () => {
  const c = conversacion();
  await c.decir('Ábreme las fichas de ocurrencia de oro.');
  await c.decir('además ábreme las áreas protegidas');
  const r = await c.decir('Cámbialo a plata.');
  assert.equal(r, 'Ahora las fichas muestran solo plata: 64 puntos, en gris plata.');
  assert.deepEqual(c.estado.capas.find((x) => x.id === 110002)!.filtros, { mineral: ['Plata'] });
  const r2 = await c.decir('ahora las de cobre');
  assert.match(r2!, /^Ahora las fichas muestran solo cobre/);
});

test('caso E — una capa que no existe: lo dice, no inventa, y ofrece', async () => {
  const c = conversacion();
  const r = await c.decir('Ábreme las zonas de litio.');
  assert.equal(r, 'No encontré una capa ni un valor de «litio» en el índice. Puedo buscar en Otros o mostrarte qué minerales sí hay.');
  assert.deepEqual(c.estado.capas, []);
  const m = await c.decir('muéstrame qué minerales hay');
  assert.match(m!, /^En las capas de recursos hay: oro, plata, cobre/);
  assert.doesNotMatch(m!, /litio/);
});

test('contexto: «quítalas» es la última abierta; «solo» y «limpia» sí apagan', async () => {
  const c = conversacion();
  await c.decir('abre las fichas de oro');
  await c.decir('muestra los ríos');
  assert.equal(await c.decir('quítalas'), 'Quité «Red hídrica».');
  assert.deepEqual(c.estado.capas.map((x) => x.id), [110002]);
  await c.decir('muestra los municipios');
  await c.decir('deja solo las microcuencas');
  assert.deepEqual(c.estado.capas.map((x) => x.id), [108001]);
  assert.equal(await c.decir('limpia el mapa'), 'Listo: dejé solo el perímetro de Honduras.');
  assert.deepEqual(c.estado.capas, []);
});

test('funciona con otras capas filtrables, cuenta y dice qué hay encendido', async () => {
  const c = conversacion();
  assert.match((await c.decir('abre los depósitos de antimonio'))!, /^Abrí solo los depósitos de antimonio: 9 puntos, en violeta\.$/);
  assert.match((await c.decir('muestra los derechos mineros en solicitud'))!, /los derechos mineros de solicitud/);
  assert.match((await c.decir('cuántas fichas de cobre hay'))!, /^Hay 9 puntos en las fichas de cobre \(110002\)\.$/);
  assert.match((await c.decir('qué capas tengo abiertas'))!, /los depósitos de antimonio \(110001\)/);
});

test('lo que no es de capas sigue al modelo', async () => {
  const c = conversacion();
  for (const t of ['cuál es la ley de corte del oro', 'muéstrame el mapa', '¿qué concesiones vencen este mes?']) assert.equal(await c.decir(t), null, t);
});

test('valores de filtro: solo los que existen; lo inventado se rechaza', () => {
  const fichas = CAPAS.find((x) => x.id === 110002)!;
  assert.deepEqual(validarFiltros(fichas, { mineral: ['Oro'] }).filtros, { mineral: ['Oro'] });
  assert.deepEqual(validarFiltros(fichas, { MINERAL: ['oro'] }).filtros, { mineral: ['Oro'] }, 'el campo y el valor sin importar mayúsculas');
  const litio = validarFiltros(fichas, { mineral: ['Litio'] });
  assert.deepEqual(litio.filtros, {});
  assert.equal(litio.rechazados.length, 1);
});

test('el estado que manda el panel se limpia', () => {
  assert.deepEqual(estadoDelCliente({ capas: [{ id: 110002, filtros: { mineral: ['Oro'] } }, { id: 'x' }, { id: 1e9 }] }), { capas: [{ id: 110002, filtros: { mineral: ['Oro'] } }] });
  assert.deepEqual(estadoDelCliente(null), { capas: [] });
});
