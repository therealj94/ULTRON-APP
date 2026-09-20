/**
 * Pruebas de los cálculos de minería. Los números de referencia salen de la aritmética del oficio,
 * no de correr el código y copiar lo que dio: si alguno cambia, es que se rompió algo.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  GRAMOS_POR_ONZA_TROY,
  aisc,
  gtAPorcentaje,
  leerNumero,
  leyDeCorte,
  leyDiluida,
  librasContenidas,
  onzasContenidas,
  ozPorToneladaCortaAGt,
  porcentajeAGt,
  recuperable,
  resolverCalculoMina,
  stripRatio,
  tonelajeDesdeVolumen,
  vidaDeMina,
} from '../lib/minas/calculos';

const cerca = (a: number, b: number, tol = 0.01) => assert.ok(Math.abs(a - b) <= tol, `${a} no está cerca de ${b}`);

test('conversiones de unidades', async (t) => {
  await t.test('la onza troy son 31,1034768 gramos', () => {
    assert.equal(GRAMOS_POR_ONZA_TROY, 31.1034768);
  });

  await t.test('una onza por tonelada corta son 34,2857 g/t', () => {
    cerca(ozPorToneladaCortaAGt(1), 34.2857, 0.001);
  });

  await t.test('uno por ciento son diez mil g/t, y de vuelta', () => {
    assert.equal(porcentajeAGt(1), 10_000);
    assert.equal(gtAPorcentaje(10_000), 1);
  });

  await t.test('volumen por densidad da tonelaje', () => {
    assert.equal(tonelajeDesdeVolumen(1000, 2.7), 2700);
  });
});

test('contenido metálico', async (t) => {
  await t.test('un millón de toneladas a 1 g/t son 32.150,7 onzas', () => {
    // 1.000.000 g / 31,1034768 = 32.150,7 oz. Es la equivalencia clásica: 1 tonelada de oro ≈ 32.151 oz.
    cerca(onzasContenidas(1_000_000, 1), 32_150.7, 0.1);
  });

  await t.test('250.000 t a 3,4 g/t son 27.328 onzas', () => {
    cerca(onzasContenidas(250_000, 3.4), 27_328.1, 1);
  });

  await t.test('la recuperación descuenta lo que la planta no saca', () => {
    cerca(recuperable(10_000, 92), 9_200, 0.001);
  });

  await t.test('cobre: 1.000.000 t al 0,5% son 11 millones de libras', () => {
    cerca(librasContenidas(1_000_000, 0.5), 11_023_113.1, 1);
  });

  await t.test('la dilución baja la ley: 15% sobre 8 g/t deja 6,96', () => {
    cerca(leyDiluida(8, 15), 6.9565, 0.001);
  });
});

test('parámetros de mina', async (t) => {
  await t.test('strip ratio', () => {
    assert.equal(stripRatio(3_000_000, 1_000_000), 3);
  });

  await t.test('vida de mina', () => {
    assert.equal(vidaDeMina(10_000_000, 1_000_000), 10);
  });

  await t.test('AISC', () => {
    assert.equal(aisc(90_000_000, 100_000), 900);
  });

  await t.test('ley de corte: 25 USD/t, oro a 2.000, 90% de recuperación → 0,432 g/t', () => {
    // valor de un gramo recuperado = 2000/31,1035 x 0,9 = 57,87 USD → 25/57,87 = 0,432 g/t
    cerca(leyDeCorte({ costoPorTonelada: 25, precioPorOnza: 2000, recuperacionPorcentaje: 90 }), 0.432, 0.002);
  });
});

test('lectura de números escritos como los escribe la gente', async (t) => {
  await t.test('punto de miles', () => assert.equal(leerNumero('250.000'), 250000));
  await t.test('coma decimal', () => assert.equal(leerNumero('3,4'), 3.4));
  await t.test('punto decimal', () => assert.equal(leerNumero('3.4'), 3.4));
  await t.test('coma de miles al estilo inglés', () => assert.equal(leerNumero('1,250,000'), 1250000));
  await t.test('mezcla: punto de miles y coma decimal', () => assert.equal(leerNumero('1.250,75'), 1250.75));
  await t.test('mezcla al revés', () => assert.equal(leerNumero('1,250.75'), 1250.75));
});

test('preguntas de mina en lenguaje natural', async (t) => {
  await t.test('tonelaje y ley dan onzas contenidas', () => {
    const r = resolverCalculoMina('si tengo 250.000 toneladas a 3,4 g/t, ¿cuántas onzas son?');
    assert.ok(r, 'debería resolver');
    assert.equal(r!.tipo, 'contenido-metalico');
    cerca(r!.valores.onzasContenidas, 27_328.1, 1);
    assert.match(r!.texto, /27\.328|27\.329/);
  });

  await t.test('«1,5 millones de toneladas» se entiende con su escala', () => {
    const r = resolverCalculoMina('1,5 millones de toneladas a 2 gramos por tonelada');
    assert.ok(r);
    assert.equal(r!.valores.toneladas, 1_500_000);
    cerca(r!.valores.onzasContenidas, 96_452.1, 1);
  });

  await t.test('la recuperación se aplica si la mencionan', () => {
    const r = resolverCalculoMina('500.000 toneladas a 4 g/t con 90% de recuperación');
    assert.ok(r);
    cerca(r!.valores.onzasRecuperables!, onzasContenidas(500_000, 4) * 0.9, 1);
  });

  await t.test('el precio de la onza convierte a dinero y avisa que es bruto', () => {
    const r = resolverCalculoMina('100.000 toneladas a 5 g/t, oro a 2.400 la onza');
    assert.ok(r);
    cerca(r!.valores.valorBruto!, onzasContenidas(100_000, 5) * 2400, 10);
    assert.match(r!.texto, /valor bruto, no ganancia/);
  });

  await t.test('el spot de la mesa sirve de precio si no lo dicen', () => {
    const r = resolverCalculoMina('200.000 toneladas a 3 g/t', { precioOnza: 2500 });
    assert.ok(r);
    assert.equal(r!.valores.precioPorOnza, 2500);
  });

  await t.test('la dilución baja la ley antes de contar onzas', () => {
    const r = resolverCalculoMina('50.000 toneladas a 10 g/t con 20% de dilución');
    assert.ok(r);
    cerca(r!.valores.leyUsada, 8.3333, 0.001);
  });

  await t.test('ley de corte completa', () => {
    const r = resolverCalculoMina('calculá la ley de corte con 25 dólares por tonelada, oro a 2.000 la onza y 90% de recuperación');
    assert.ok(r);
    assert.equal(r!.tipo, 'ley-de-corte');
    cerca(r!.valores.leyDeCorte, 0.432, 0.002);
  });

  await t.test('ley de corte sin costo pide el dato en vez de inventarlo', () => {
    const r = resolverCalculoMina('¿cuál es la ley de corte?', { precioOnza: 2000 });
    assert.ok(r);
    assert.equal(r!.tipo, 'ley-de-corte-incompleta');
    assert.match(r!.texto, /costo por tonelada/);
  });

  await t.test('strip ratio con dos tonelajes', () => {
    const r = resolverCalculoMina('el strip ratio si son 3.000.000 toneladas de estéril y 1.000.000 toneladas de mineral');
    assert.ok(r);
    assert.equal(r!.tipo, 'strip-ratio');
    cerca(r!.valores.stripRatio, 3, 0.01);
  });

  await t.test('conversión de onzas por tonelada corta', () => {
    const r = resolverCalculoMina('cuánto es 0,5 onzas por tonelada corta en gramos por tonelada');
    assert.ok(r);
    cerca(r!.valores.gramosPorTonelada, 17.14, 0.01);
  });

  await t.test('una charla normal NO se convierte en cuenta', () => {
    assert.equal(resolverCalculoMina('¿qué es un pórfido de cobre?'), null);
    assert.equal(resolverCalculoMina('hola, cómo estás'), null);
    assert.equal(resolverCalculoMina('explicame la lixiviación en pilas'), null);
  });
});

test('padrón de concesiones (datos de demostración)', async (t) => {
  const { buscarConcesion, diasParaVencer, fichaTexto, porVencer, responderConcesion, resumenPadron } = await import('../lib/minas/concesiones');
  // Fecha fija: si no, la prueba cambia de resultado cada día.
  const hoy = new Date('2026-06-01T12:00:00Z');

  await t.test('encuentra por nombre', () => {
    const r = buscarConcesion('Cerro Partido');
    assert.equal(r.length, 1);
    assert.equal(r[0].id, 'EXP-2019-0118');
  });

  await t.test('encuentra por titular y devuelve las dos del mismo dueño', () => {
    const r = buscarConcesion('Minera Demo del Norte');
    assert.equal(r.length, 2);
  });

  await t.test('calcula los días que faltan para vencer', () => {
    const [c] = buscarConcesion('Cerro Partido'); // vence 2026-11-15
    assert.equal(diasParaVencer(c, hoy), 167);
  });

  await t.test('avisa de las que vencen pronto, la más urgente primero', () => {
    const lista = porVencer(365, hoy);
    assert.equal(lista[0].nombre, 'Cerro Partido'); // 2026-11-15, la más próxima
    assert.ok(lista.some((c) => c.nombre === 'Quebrada Seca'));
  });

  await t.test('la ficha se lee como una frase y marca el plazo corto', () => {
    const [c] = buscarConcesion('Cerro Partido');
    const f = fichaTexto(c, hoy);
    assert.match(f, /EXP-2019-0118/);
    assert.match(f, /plan de labores/);
    assert.doesNotMatch(f, /Ltda\.\./, 'no debe quedar el punto doble del titular');
  });

  await t.test('siempre dice que es demostración', () => {
    assert.match(responderConcesion('contame de Quebrada Seca', hoy)!, /demostraci[oó]n/);
    assert.match(responderConcesion('qué concesiones hay', hoy)!, /demostraci[oó]n/);
  });

  await t.test('una charla que no va de concesiones no dispara el padrón', () => {
    assert.equal(responderConcesion('qué es un skarn', hoy), null);
    assert.equal(responderConcesion('hola', hoy), null);
  });

  await t.test('avisa cuando el padrón se contradice: vigente con la fecha pasada', () => {
    const [c] = buscarConcesion('Cerro Partido');
    const tarde = new Date('2027-01-01T12:00:00Z'); // ya pasó el 2026-11-15
    assert.match(fichaTexto(c, tarde), /la da por vigente pero la fecha ya pasó/);
  });

  await t.test('el resumen nombra todas', () => {
    const r = resumenPadron(hoy);
    for (const n of ['Quebrada Seca', 'Cerro Partido', 'Las Lajas', 'Río Blanco']) assert.ok(r.includes(n), `falta ${n}`);
  });
});
