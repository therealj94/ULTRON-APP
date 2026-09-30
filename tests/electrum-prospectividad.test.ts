/**
 * Prospectividad: el puntaje junta geología, muestras y satélite; lo que no se midió no suma ni
 * resta y se dice; las clases de ley son las del mapa.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

const { puntuar, claseLey, prospectividadEnRenglones } = await import('../server/electrum/prospectividad');

const geo = (puntos: number, conCapas = true) =>
  ({
    fuentes: conCapas ? { litologia: ['Mapa geológico'], falla: ['Fallas'] } : {},
    indicios: {
      nivel: puntos >= 7 ? 'alto' : puntos >= 4 ? 'medio' : puntos ? 'bajo' : 'sin indicios',
      puntos,
      criterios: [
        { clave: 'intrusivo', cumple: puntos > 0, puntos: puntos > 0 ? 2 : 0, evidencia: '', modelos: [] },
        { clave: 'cruces_de_fallas', cumple: puntos > 2, puntos: puntos > 2 ? 1 : 0, evidencia: '', modelos: [] },
      ],
      modelos: puntos ? ['pórfido de cobre'] : [],
    },
  }) as any;

const muestra = (codigo: string, leyes: Record<string, number>, km = 0, limites: Record<string, string> | null = null) => ({ codigo, tipo: 'roca', km, leyes, limites });
const sat = (expuesto: number, arc: [number, number, number], fe: [number, number, number]) => ({ ha: 500, ha_comparable: 480, veg: [0, 0, 0] as [number, number, number], ha_expuesto: expuesto, arc, fe });

test('clase de ley con los cortes del mapa; bajo el límite es cero', () => {
  assert.equal(claseLey('au', 4), 0);
  assert.equal(claseLey('au', 20), 2);
  assert.equal(claseLey('au', 1200), 5);
  assert.equal(claseLey('au', 1200, '<'), 0);
  assert.equal(claseLey('cu', null), 0);
});

test('sin datos en nada: cero, cobertura cero y cada ausencia dicha', () => {
  const p = puntuar(null, [], null);
  assert.equal(p.puntaje, 0);
  assert.equal(p.cobertura, 0);
  // Auditoría H07: «no estudiado» no es «muy baja».
  assert.equal(p.nivel, 'sin datos');
  assert.equal(p.estado, 'sin_datos');
  assert.ok(p.componentes.every((c) => !c.medido));
  const r = prospectividadEnRenglones(p).join('\n');
  assert.match(r, /Sin datos para evaluar/);
  assert.match(r, /no es un puntaje bajo/);
  assert.match(r, /Sin muestras de JICA/);
  assert.match(r, /no una estimación de recursos/);
});

test('todo a favor: alta, con cada componente en su tope', () => {
  const p = puntuar(
    geo(12),
    [1, 2, 3, 4, 5].map((i) => muestra(`R-${i}`, { au: 1500, cu: 6000 })),
    sat(100, [20, 15, 10], [20, 15, 10])
  );
  const c = Object.fromEntries(p.componentes.map((x) => [x.clave, x]));
  assert.equal(c.geologia.puntos, 45);
  assert.equal(c.geoquimica.puntos, 30);
  assert.equal(c.satelite.puntos, 25);
  assert.equal(p.puntaje, 100);
  assert.equal(p.nivel, 'alta');
  assert.equal(p.cobertura, 100);
});

test('el satélite al azar (10 % sobre p90, sin extremos) no suma; bajo vegetación no se mide', () => {
  const alAzar = puntuar(null, [], sat(100, [8, 2, 0], [9, 1, 0]));
  assert.equal(alAzar.componentes[2].puntos, 0);
  assert.equal(alAzar.componentes[2].medido, true);
  const tapado = puntuar(null, [], sat(1, [1, 0, 0], [0, 0, 0]));
  assert.equal(tapado.componentes[2].medido, false);
  assert.match(tapado.componentes[2].evidencia, /bajo vegetación/);
});

test('indicadores pesan menos que el oro: una muestra de As alto no iguala una de Au alto', () => {
  const oro = puntuar(null, [muestra('A', { au: 1200 })], null).componentes[1].puntos;
  const arsenico = puntuar(null, [muestra('B', { as: 6000 })], null).componentes[1].puntos;
  assert.ok(oro > arsenico, `${oro} > ${arsenico}`);
  const bajo = puntuar(null, [muestra('C', { au: 1200 }, 0.4, { au: '<' })], null).componentes[1];
  assert.equal(bajo.puntos, 0);
  assert.equal(bajo.medido, true, 'hubo muestreo: medido aunque no sume');
});

test('geología sin capas cargadas no se cuenta como medida', () => {
  const p = puntuar(geo(0, false), [], null);
  assert.equal(p.componentes[0].medido, false);
  const q = puntuar(geo(5), [], null);
  assert.equal(q.componentes[0].puntos, 22.5);
  assert.equal(q.cobertura, 45);
  // Solo geología (45 de 100): hay puntaje, pero es evidencia insuficiente para compararlo.
  assert.equal(q.estado, 'insuficiente');
  assert.match(prospectividadEnRenglones(q).join('\n'), /no se compara con concesiones mejor documentadas/);
});
