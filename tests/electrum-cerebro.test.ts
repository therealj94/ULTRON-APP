/**
 * El panel de especialistas, las manos y el troceado de documentos.
 *
 * Lo que se prueba aquí es lo que decide si Electrum sirve o no: a quién convoca cada pregunta, qué
 * herramientas se le ofrecen, y que un documento se corte de forma que las citas se puedan ir a
 * comprobar. Lo que necesita base de datos vive en tests/electrum-db.test.ts.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { ESPECIALISTAS, convocar, herramientasDe, promptPanel } from '../server/electrum/especialistas';
import { MANOS, TODAS, manosDe } from '../server/electrum/manos';
import { trocear } from '../server/electrum/aprender';
import { validar } from '../lib/agente/protocolo';

const ids = (m: string) => convocar(m).map((e) => e.id);

test('a quién convoca cada pregunta', async (t) => {
  await t.test('geología', () => assert.ok(ids('qué tipo de yacimiento es un pórfido').includes('geologo')));
  await t.test('método de explotación', () => assert.ok(ids('conviene cielo abierto o subterráneo para una veta angosta').includes('minas')));
  await t.test('obras civiles', () => assert.ok(ids('la presa de relaves crece aguas arriba, ¿es seguro?').includes('civil')));
  await t.test('planta', () => assert.ok(ids('qué recuperación espero con cianuración si el oro es refractario').includes('metalurgista')));
  await t.test('mapas y proyecciones', () => assert.ok(ids('el shapefile viene en UTM 16N, ¿el área está bien?').includes('geomatica')));
  await t.test('ambiental', () => assert.ok(ids('hay riesgo de drenaje ácido en la quebrada').includes('ambiental')));
  await t.test('legal', () => assert.ok(ids('cuándo vence la concesión y qué obligaciones tiene el titular').includes('legal')));
  await t.test('economía', () => assert.ok(ids('cuál es el AISC y el VAN del proyecto').includes('economista')));

  await t.test('un nombre de concesión no convoca al especialista equivocado', () => {
    // «Quebrada Seca» y «Cerro Partido» son NOMBRES. Antes «quebrada» convocaba al ambiental.
    const r = ids('¿se traslapan Quebrada Seca y Cerro Partido? ¿de quién es el derecho?');
    assert.ok(!r.includes('ambiental'), `el paisaje del nombre convocó al ambiental: ${r}`);
    assert.ok(r.includes('legal'), `debería estar el legal: ${r}`);
    assert.ok(r.includes('geomatica'), `debería estar geomática: ${r}`);
  });

  await t.test('una pregunta de dos mundos trae a los dos', () => {
    const r = ids('se traslapan dos concesiones, ¿de quién es el derecho?');
    assert.ok(r.includes('legal'), `trajo ${r}`);
    assert.ok(r.includes('geomatica'), `trajo ${r}`);
  });

  await t.test('nunca más de dos: con tres el system se contradice', () => {
    const r = convocar('yacimiento, método, planta, costos, concesión, relaves y proyección UTM');
    assert.ok(r.length <= 2, `convocó ${r.length}`);
  });

  await t.test('pedido a mano: manda sobre el tema', () => {
    const r = convocar('dr, póngame al geólogo: ¿cuánto cuesta la tonelada?');
    assert.equal(r[0].id, 'geologo', 'el pedido explícito va primero aunque el tema sea de costos');
  });

  await t.test('«que hable el legal»', () => {
    assert.equal(convocar('que hable el legal un momento')[0].id, 'legal');
  });

  await t.test('una charla sin tema técnico no convoca a nadie', () => {
    assert.deepEqual(convocar('hola, buenos días'), []);
    assert.deepEqual(convocar('gracias, muy amable'), []);
  });
});

test('el prompt del panel', async (t) => {
  await t.test('trae solo las reglas de los convocados, no las ocho', () => {
    const p = promptPanel(convocar('qué tipo de yacimiento es un pórfido'));
    assert.match(p, /GEÓLOGO/);
    assert.doesNotMatch(p, /METALURGISTA/);
    assert.doesNotMatch(p, /ECONOMISTA MINERO/);
  });

  await t.test('obliga a pasar lo que no es suyo', () => {
    const p = promptPanel(convocar('qué tipo de yacimiento es un pórfido'));
    assert.match(p, /NO es de este panel/);
  });

  await t.test('sin panel, contesta general y ofrece traer a alguien', () => {
    const p = promptPanel([]);
    assert.match(p, /ninguna especialidad/);
    assert.match(p, /ofrecé traer/);
  });

  await t.test('cada especialista vigila el error clásico de su oficio', () => {
    for (const e of ESPECIALISTAS) {
      assert.ok(e.vigila.length > 20, `${e.id} no dice qué vigila`);
      assert.ok(e.reglas.length >= 3, `${e.id} tiene pocas reglas`);
    }
  });
});

test('las manos', async (t) => {
  await t.test('cada herramienta declara para qué Y cuándo usarla', () => {
    for (const h of TODAS) {
      assert.ok(h.descripcion.length > 60, `${h.nombre}: descripción demasiado corta`);
      assert.match(h.nombre, /^[a-z_]+$/, `${h.nombre}: debe ser snake_case`);
      assert.equal(h.esquema.type, 'object');
      for (const [k, d] of Object.entries(h.esquema.properties)) {
        assert.ok(d.description?.length > 3, `${h.nombre}.${k} sin descripción`);
      }
    }
  });

  await t.test('al panel se le ofrecen solo sus herramientas, no las veinte', () => {
    const panel = convocar('cuándo vence la concesión');
    const suyas = manosDe(herramientasDe(panel));
    assert.ok(suyas.some((h) => h.nombre === 'catastro_vencimientos'));
    assert.ok(!suyas.some((h) => h.nombre === 'metales_spot'), 'el legal no necesita el precio del oro');
    assert.ok(suyas.length < TODAS.length);
  });

  await t.test('todas las herramientas que nombran los especialistas existen', () => {
    const reales = new Set(Object.keys(MANOS));
    // web_buscar y web_leer las aporta el cuerpo compartido, no las manos de Electrum.
    const delCuerpo = new Set(['web_buscar', 'web_leer']);
    for (const e of ESPECIALISTAS) {
      for (const h of e.herramientas) {
        assert.ok(reales.has(h) || delCuerpo.has(h), `${e.id} pide «${h}» y no existe`);
      }
    }
  });

  await t.test('el cálculo de mina no lo hace el modelo de cabeza', async () => {
    const r = await MANOS.calculo_mina.ejecutar({ enunciado: '250.000 toneladas a 3,4 g/t' }, { quien: null, mando: false, canal: 'mesa', mensaje: '' });
    assert.equal(r.ok, true);
    assert.match(r.texto, /27\.328/);
    assert.match(r.texto, /fórmula/);
  });

  await t.test('un enunciado que no es una cuenta lo dice, no inventa', async () => {
    const r = await MANOS.calculo_mina.ejecutar({ enunciado: 'hola qué tal' }, { quien: null, mando: false, canal: 'mesa', mensaje: '' });
    assert.equal(r.ok, false);
    assert.match(r.texto, /no saco una cuenta/);
  });

  await t.test('sin catastro conectado, las de base lo dicen en vez de fallar', async () => {
    const antes = process.env.ELECTRUM_DB_URL;
    delete process.env.ELECTRUM_DB_URL;
    const ctx = { quien: null, mando: false, canal: 'mesa' as const, mensaje: '' };
    for (const n of ['catastro_buscar', 'gis_traslapes', 'expediente_buscar']) {
      const r = await MANOS[n].ejecutar({ texto: 'x' }, ctx);
      assert.equal(r.ok, false, n);
      assert.match(r.texto, /no está conectado/, n);
    }
    if (antes) process.env.ELECTRUM_DB_URL = antes;
  });

  await t.test('gis_medir pide qué medir en vez de adivinar', async () => {
    const r = await MANOS.gis_medir.ejecutar({}, { quien: null, mando: false, canal: 'mesa', mensaje: '' });
    assert.equal(r.ok, false);
    assert.match(r.texto, /Decime qué medir/);
  });

  await t.test('gis_medir mide distancia entre dos puntos sin tocar la base', async () => {
    const r = await MANOS.gis_medir.ejecutar({ desde: '-86.58,14.03', hasta: '-86.57,14.04' }, { quien: null, mando: false, canal: 'mesa', mensaje: '' });
    assert.equal(r.ok, true);
    assert.match(r.texto, /1,5\d kilómetros/);
  });

  await t.test('los esquemas validan de verdad', () => {
    assert.equal(validar(MANOS.catastro_en_punto.esquema, { lon: -86.5 }).ok, false, 'falta lat');
    const v = validar(MANOS.catastro_en_punto.esquema, { lon: '-86,5', lat: '14,03' });
    assert.ok(v.ok);
    assert.equal((v as any).args.lon, -86.5, 'lee la coma decimal');
    assert.equal((v as any).args.radio_km, 5, 'aplica el valor por defecto');
  });
});

test('troceado de documentos: las citas tienen que poder comprobarse', async (t) => {
  const paginas = [
    { pagina: 1, texto: 'Introducción del informe.\n\nEl yacimiento se ubica en el municipio de Danlí.\n\n' + 'Detalle. '.repeat(120) },
    { pagina: 2, texto: 'La ley media es de 3,4 gramos por tonelada.\n\nLa recuperación metalúrgica esperada es del noventa por ciento.' },
  ];

  await t.test('cada trozo sabe de qué página salió', () => {
    const t2 = trocear(paginas);
    assert.ok(t2.length >= 2);
    assert.ok(t2.every((x) => x.pagina === 1 || x.pagina === 2));
    assert.ok(t2.some((x) => x.pagina === 2 && /3,4 gramos/.test(x.texto)));
  });

  await t.test('un trozo nunca cruza de página: si no, la cita miente', () => {
    for (const x of trocear(paginas)) {
      const dePagina1 = /Introducción|Danlí|Detalle/.test(x.texto);
      const dePagina2 = /ley media|recuperación metalúrgica/.test(x.texto);
      assert.ok(!(dePagina1 && dePagina2), `un trozo mezcló las dos páginas: ${x.texto.slice(0, 80)}`);
    }
  });

  await t.test('el orden es consecutivo, para poder reconstruir el documento', () => {
    const t2 = trocear(paginas);
    assert.deepEqual(t2.map((x) => x.orden), t2.map((_, i) => i));
  });

  await t.test('los trozos no se van de tamaño', () => {
    for (const x of trocear(paginas)) assert.ok(x.texto.length <= 1400, `trozo de ${x.texto.length} caracteres`);
  });

  await t.test('una tabla enorme se parte por frases, no a ciegas', () => {
    const tabla = [{ pagina: 1, texto: Array.from({ length: 80 }, (_, i) => `Sondaje DDH-${i} de 1,5 metros con ley 2,${i} g/t.`).join(' ') }];
    const t2 = trocear(tabla);
    assert.ok(t2.length > 1, 'debió partirse');
    // Ningún trozo debe terminar con un número cortado a la mitad.
    for (const x of t2) assert.doesNotMatch(x.texto, /\d,$/, `cortó un número: …${x.texto.slice(-30)}`);
  });

  await t.test('texto vacío no produce basura', () => {
    assert.deepEqual(trocear([{ pagina: 1, texto: '   ' }]), []);
    assert.deepEqual(trocear([]), []);
  });
});
