/**
 * LA COMPARACIÓN DE LOS DOS CAMINOS DE LA LLAMADA, HONESTA (server/voz-medidas.ts, docs/voz/SPEECH-ENGINE.md §5).
 *
 * Un asentimiento («ajá»), un turno cortado, una frase de espera sola, una respuesta vacía, un error o un
 * turno sin respuesta del cerebro NO son respuestas: no cuentan para el mínimo ni para los percentiles del
 * primer audio, y los errores, respaldos y cortados cuentan EN CONTRA. La respuesta de verdad (el cerebro, sin la
 * frase de espera, con los cortados) no puede empeorar. Sin la evidencia mínima (≥20 turnos comparables de ≥5
 * conversaciones, ≥5 interrupciones y ≥5 asentimientos a propósito por camino y por red, en ≥4 bloques alternos
 * de ≥5 turnos) el veredicto es «insuficiente» y dice qué falta. Y el veredicto solo informa: nunca enciende ni
 * apaga nada.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

process.env.ULTRON_MEMORIA_BUCKET = '';
delete process.env.AURA_MOTOR_VOZ;

const MED = await import('../server/voz-medidas');
type Medida = import('../server/voz-medidas').MedidaTurnoVoz;
type Motor = 'agente' | 'speech-engine';

const m = (motor: Motor, t: number, primer: number | null, extra: Partial<Medida> = {}): Medida => ({
  motor,
  t,
  conv: 'c1',
  primerTextoMs: primer,
  cerebroMs: primer,
  totalMs: primer ?? 0,
  puente: false,
  interrupcion: null,
  repetido: false,
  asentimiento: false,
  respaldo: false,
  error: false,
  tarde: false,
  cortado: false,
  red: 'wifi',
  ...extra,
});

/**
 * Una prueba bien hecha en una red: bloques alternos A-B-A-B de `k` turnos completos por bloque, con la
 * latencia de cada camino, y (con `ejercicios`) las 5 interrupciones y 5 asentimientos a propósito por camino.
 */
function prueba(o: { ag: number; se: number; k?: number; red?: string; t0?: number; bloquesPorCamino?: number }) {
  const k = o.k ?? 10;
  const red = o.red ?? 'wifi';
  let t = o.t0 ?? 1_000_000;
  const ms: Medida[] = [];
  for (let b = 0; b < (o.bloquesPorCamino ?? 2); b++)
    for (const motor of ['agente', 'speech-engine'] as Motor[])
      // Varias llamadas por bloque (tres), como en la prueba de verdad: ≥5 conversaciones por camino y por red.
      for (let i = 0; i < k; i++) ms.push(m(motor, (t += 1000), (motor === 'agente' ? o.ag : o.se) + i * 10, { red, conv: `${red}-${motor[0]}${b}-${i % 3}` }));
  return ms;
}
const ejercicios = (red = 'wifi', bien: Partial<Record<Motor, { interrupcion?: number; asentimiento?: number }>> = {}) => {
  const out: import('../server/voz-medidas').EjercicioVoz[] = [];
  for (const motor of ['agente', 'speech-engine'] as Motor[])
    for (const tipo of ['interrupcion', 'asentimiento'] as const)
      for (let i = 0; i < 5; i++) out.push({ motor, tipo, bien: i < (bien[motor]?.[tipo] ?? 5), t: 2_000_000 + i, red });
  return out;
};

/** Los turnos que cortan las interrupciones a propósito (`n` por camino; mientras hablaba: con su cerebro). */
const cortesAProposito = (n: Partial<Record<Motor, number>> = {}, red = 'wifi') => {
  const out: Medida[] = [];
  for (const motor of ['agente', 'speech-engine'] as Motor[])
    for (let i = 0; i < (n[motor] ?? 5); i++) out.push(m(motor, 3_000_000 + (motor === 'agente' ? 0 : 500) + i, motor === 'agente' ? 1500 : 1100, { cortado: true, red, conv: `${red}-${motor[0]}0-${i % 3}` }));
  return out;
};

async function comparar(ms: Medida[], ej: import('../server/voz-medidas').EjercicioVoz[] = []) {
  MED._reiniciarMedidas();
  for (const x of ms) MED.anotarTurnoVoz(x);
  for (const e of ej) MED.anotarEjercicioVoz?.(e);
  return MED.comparacionVoz();
}

/* ------------------------------------------------------------------ la reproducción del hallazgo */

test('REPRODUCCIÓN: muchos «ajá» rapidísimos en Speech Engine ya no dan «adoptar»', async () => {
  // El agente: 20 respuestas de verdad a ~800 ms. Speech Engine: 4 respuestas a ~800 ms y 30 asentimientos
  // que la ruta contestó en 40 ms (lo de siempre: cuentan como turnos y bajan los percentiles).
  const ms: Medida[] = [];
  for (let i = 0; i < 20; i++) ms.push(m('agente', 1_000 + i, 800 + i * 10));
  for (let i = 0; i < 4; i++) ms.push(m('speech-engine', 2_000 + i, 800 + i * 10));
  for (let i = 0; i < 30; i++) ms.push(m('speech-engine', 3_000 + i, 40, { asentimiento: true }));
  const r: any = await comparar(ms);
  assert.equal(r.total.veredicto.adoptar, false, `no se adopta con asentimientos: ${JSON.stringify(r.total.veredicto)}`);
  assert.equal(r.total.veredicto.estado, 'insuficiente');
  assert.equal(r.porRed.wifi['speech-engine'].completos, 4, 'solo las 4 respuestas de verdad son comparables');
  assert.equal(r.porRed.wifi['speech-engine'].primerTexto.p50, 810, 'los 40 ms de los «ajá» no entran al percentil');
  assert.equal(r.porRed.wifi['speech-engine'].excluidos.asentimientos, 30);
  assert.ok(r.total.veredicto.faltan.some((f: string) => /speech-engine/.test(f) && /16 turnos/.test(f)), r.total.veredicto.faltan.join(' | '));
});

test('la ruta marca como asentimiento el turno cuya última frase de la persona es solo «ajá» (sin guardar lo dicho)', () => {
  MED._reiniciarMedidas();
  const base = { primerTextoMs: 40, cerebroMs: 40, totalMs: 40, puente: false, interrupcion: null, repetido: false, respaldo: false, error: false, tarde: false, cortado: false, conv: 'c' } as const;
  MED.anotarDesdeRuta({ body: { messages: [{ role: 'assistant', content: 'Te cuento…' }, { role: 'user', content: 'Ajá.' }] } }, base);
  MED.anotarDesdeRuta({ body: { messages: [{ role: 'user', content: '¿Cuánto vale el oro hoy?' }] } }, base);
  const [a, b] = MED._medidas();
  assert.equal(a.asentimiento, true);
  assert.equal(b.asentimiento, false);
  assert.equal(JSON.stringify(MED._medidas()).includes('oro'), false, 'nada de lo dicho');
});

/* ------------------------------------------------------------------ la reproducción del hallazgo H5 */

test('REPRODUCCIÓN H5 (a): un primer audio rápido que es solo la frase de espera, con el cerebro a 6 s, ya no da «adoptar»', async () => {
  // Speech Engine dice la frase de espera a 300 ms, pero la respuesta de verdad llega a ~6 s; el agente, 800/800.
  const ms = prueba({ ag: 800, se: 300 });
  for (const x of ms) if (x.motor === 'speech-engine') Object.assign(x, { puente: true, cerebroMs: 6_000 + (x.primerTextoMs ?? 0), totalMs: 7_000 });
  const r: any = await comparar(ms, ejercicios());
  const v = r.porRed.wifi.veredicto;
  assert.equal(r.total.veredicto.estado, 'mantener', JSON.stringify(r.total.veredicto));
  assert.equal(v.primerTextoP50Mejor, true, 'el primer audio sí mejora (es la frase de espera)');
  assert.equal(v.cerebroP50NoPeor, false);
  assert.equal(v.cerebroP95NoPeor, false);
  assert.ok(v.motivos.some((x: string) => /respuesta de verdad p50/.test(x)), v.motivos.join(' | '));
  // La frase de espera rápida con el cerebro igual que el agente (dentro del margen) sí puede ganar.
  const ok = prueba({ ag: 1500, se: 300 });
  for (const x of ok) if (x.motor === 'speech-engine') Object.assign(x, { puente: true, cerebroMs: 1_600 + (x.primerTextoMs ?? 0) - 300 });
  const r2: any = await comparar(ok, ejercicios());
  assert.equal(r2.total.veredicto.estado, 'adoptar', JSON.stringify(r2.total.veredicto));
});

test('REPRODUCCIÓN H5 (b): 40 turnos lentos (4 s) que la persona cortó ya no desaparecen: no da «adoptar»', async () => {
  const ms = prueba({ ag: 1500, se: 1100 });
  // Los cortó la persona antes de que hablara el cerebro: sin primer texto, sin cerebro, 4 s esperando.
  for (let i = 0; i < 40; i++)
    ms.push(m('speech-engine', 1_000_000 + 10_000 + i * 10, null, { cortado: true, cerebroMs: null, totalMs: 4_000, conv: `wifi-s0-${i % 3}` }));
  const r: any = await comparar(ms, ejercicios());
  const v = r.porRed.wifi.veredicto;
  assert.equal(r.total.veredicto.estado, 'mantener', JSON.stringify(r.total.veredicto));
  assert.ok(v.regresiones.includes('cortados'), 'más cortados que el agente es una regresión');
  assert.equal(r.porRed.wifi['speech-engine'].cerebroConCortados.censurados, 40, 'los cortados entran como observaciones censuradas');
  assert.equal(r.porRed.wifi['speech-engine'].cerebroConCortados.p50, 4_000, 'con lo que llevaban esperando (cota por debajo)');
  assert.equal(v.cerebroP50NoPeor, false);
  // La misma proporción de cortados en los dos caminos (rápidos) no es una regresión.
  const igual = prueba({ ag: 1500, se: 1100 });
  for (const motor of ['agente', 'speech-engine'] as Motor[])
    igual.push(m(motor, 1_000_000 + (motor === 'agente' ? 5_500 : 15_500), 900, { cortado: true, conv: `wifi-${motor[0]}0-0` }));
  const r2: any = await comparar(igual, ejercicios());
  assert.deepEqual(r2.porRed.wifi.veredicto.regresiones, []);
  assert.equal(r2.total.veredicto.estado, 'adoptar', JSON.stringify(r2.total.veredicto));
});

test('REPRODUCCIÓN H5 (c): 20 turnos de UNA sola conversación por camino ya no bastan: «insuficiente»', async () => {
  const ms = prueba({ ag: 1500, se: 1100 }).map((x) => ({ ...x, conv: x.motor === 'agente' ? 'a1' : 's1' }));
  const r: any = await comparar(ms, ejercicios());
  assert.equal(r.total.veredicto.estado, 'insuficiente', JSON.stringify(r.total.veredicto));
  assert.equal(r.porRed.wifi['speech-engine'].conversacionesComparables, 1);
  for (const motor of ['agente', 'speech-engine'])
    assert.ok(r.total.veredicto.faltan.some((f: string) => f.includes(`${motor}:`) && /4 conversaciones/.test(f)), r.total.veredicto.faltan.join(' | '));
  assert.equal(MED.MIN_CONVERSACIONES, 5);
});

test('REPRODUCCIÓN H5 (d): un cambio de paso (19 A, 1 B, 1 A, 19 B) no son 4 bloques alternos: «insuficiente»', async () => {
  const ms: Medida[] = [];
  let t = 1_000_000;
  const tramo = (motor: Motor, n: number, b: number) => {
    for (let i = 0; i < n; i++) ms.push(m(motor, (t += 1000), (motor === 'agente' ? 1500 : 1100) + i * 10, { conv: `wifi-${motor[0]}${b}-${i % 6}` }));
  };
  tramo('agente', 19, 0);
  tramo('speech-engine', 1, 0);
  tramo('agente', 1, 1);
  tramo('speech-engine', 19, 1);
  const r: any = await comparar(ms, ejercicios());
  assert.equal(r.total.veredicto.estado, 'insuficiente', JSON.stringify(r.total.veredicto));
  assert.equal(r.porRed.wifi.bloques, 2, 'los tramos de menos de 5 turnos no cuentan como bloque');
  assert.deepEqual(
    r.total.veredicto.faltan.map((f: string) => f.replace(/\(.*/, '')),
    ['wifi: faltan bloques alternos A-B-A-B de ≥5 turnos comparables '],
    'solo faltan bloques'
  );
  // Cuatro bloques de 5 (el mínimo por bloque) sí valen.
  assert.equal(MED.contarBloques(prueba({ ag: 1500, se: 1100, k: 5 })), 4);
  assert.equal(MED.contarBloques(prueba({ ag: 1500, se: 1100, k: 4 })), 0);
  assert.equal(MED.MIN_TURNOS_BLOQUE, 5);
});

/* ------------------------------------------------------------------ lo que no es una respuesta */

test('cortados, solo frase de espera, vacíos, errores, respaldos, tardes y repetidos no son respuestas comparables', () => {
  const ms = [
    m('speech-engine', 1, 500),
    m('speech-engine', 2, 30, { asentimiento: true }),
    m('speech-engine', 3, 30, { cortado: true }),
    m('speech-engine', 4, 30, { puente: true, cerebroMs: null }),
    m('speech-engine', 5, null, { cerebroMs: null }),
    m('speech-engine', 6, 30, { error: true }),
    m('speech-engine', 7, 30, { respaldo: true }),
    m('speech-engine', 8, 30, { tarde: true }),
    m('speech-engine', 9, null, { repetido: true }),
    m('speech-engine', 10, 30, { cerebroMs: null }),
  ];
  const r = MED.resumir(ms);
  assert.equal(r.turnos, 10);
  assert.equal(r.completos, 1);
  assert.deepEqual(r.primerTexto, { p50: 500, p95: 500 }, 'solo el turno completo entra al percentil');
  assert.deepEqual(r.excluidos, { asentimientos: 1, cortados: 1, soloEspera: 1, vacios: 1, errores: 1, respaldos: 1, tardes: 1, repetidos: 1, sinCerebro: 1 });
  assert.equal(MED.claseTurno(m('agente', 1, 400, { puente: true })), 'completo', 'la frase de espera seguida del cerebro sí es respuesta (su primer audio es la espera)');
});

/* ------------------------------------------------------------------ la evidencia mínima */

test('una prueba bien hecha y clara: «adoptar» (y solo informa)', async () => {
  const r: any = await comparar([...prueba({ ag: 1500, se: 1100 }), ...prueba({ ag: 1800, se: 1300, red: '4g', t0: 5_000_000 })], [...ejercicios('wifi'), ...ejercicios('4g')]);
  assert.equal(r.total.veredicto.estado, 'adoptar', JSON.stringify(r.total.veredicto));
  assert.equal(r.total.veredicto.adoptar, true);
  assert.equal(r.total.veredicto.consultivo, true);
  assert.equal(r.consultivo, true);
  assert.match(r.aviso, /no enciende ni apaga/);
  assert.equal(r.porRed.wifi.veredicto.estado, 'adoptar');
  assert.equal(r.porRed['4g'].veredicto.estado, 'adoptar');
});

test('menos de 20 turnos comparables en un camino de una red: «insuficiente» y dice cuántos faltan', async () => {
  const ms = prueba({ ag: 1500, se: 1100 }).filter((x, i) => !(x.motor === 'speech-engine' && i % 7 === 0));
  const r: any = await comparar(ms, ejercicios());
  assert.equal(r.total.veredicto.estado, 'insuficiente');
  assert.ok(r.total.veredicto.faltan.some((f: string) => /wifi/.test(f) && /speech-engine/.test(f) && /turnos comparables/.test(f)), r.total.veredicto.faltan.join(' | '));
});

test('cada red por separado: 20 en wifi y 20 en 4g, no 40 entre las dos', async () => {
  const ms = [...prueba({ ag: 1500, se: 1100, k: 10 }), ...prueba({ ag: 1500, se: 1100, k: 5, red: '4g', t0: 5_000_000 })];
  const r: any = await comparar(ms, [...ejercicios('wifi'), ...ejercicios('4g')]);
  assert.equal(r.porRed.wifi.veredicto.estado, 'adoptar');
  assert.equal(r.porRed['4g'].veredicto.estado, 'insuficiente');
  assert.equal(r.total.veredicto.estado, 'insuficiente', 'una red sin evidencia deja el total en insuficiente');
  assert.ok(r.total.veredicto.faltan.some((f: string) => /^4g:/.test(f)), r.total.veredicto.faltan.join(' | '));
});

test('sin las 5 interrupciones o los 5 asentimientos a propósito por camino: «insuficiente»', async () => {
  const sinEj: any = await comparar(prueba({ ag: 1500, se: 1100 }));
  assert.equal(sinEj.total.veredicto.estado, 'insuficiente');
  assert.ok(sinEj.total.veredicto.faltan.some((f: string) => /5 interrupciones a propósito/.test(f)));
  assert.ok(sinEj.total.veredicto.faltan.some((f: string) => /5 asentimientos a propósito/.test(f)));
  const cuatro = ejercicios().filter((e, i) => !(e.motor === 'speech-engine' && e.tipo === 'asentimiento' && i % 5 === 0));
  const r: any = await comparar(prueba({ ag: 1500, se: 1100 }), cuatro);
  assert.equal(r.total.veredicto.estado, 'insuficiente');
  assert.ok(r.total.veredicto.faltan.some((f: string) => /speech-engine/.test(f) && /1 asentimiento/.test(f)), r.total.veredicto.faltan.join(' | '));
});

test('sin bloques alternos (todo el agente primero y luego todo Speech Engine): «insuficiente»', async () => {
  const r: any = await comparar(prueba({ ag: 1500, se: 1100, k: 20, bloquesPorCamino: 1 }), ejercicios());
  assert.equal(r.porRed.wifi.bloques, 2);
  assert.equal(r.total.veredicto.estado, 'insuficiente');
  assert.ok(r.total.veredicto.faltan.some((f: string) => /bloques alternos/.test(f)), r.total.veredicto.faltan.join(' | '));
});

/* ------------------------------------------------------------------ la regla, con evidencia */

test('empate dentro del ruido: no se adopta (margen ≥150 ms y ≥10 % en p50 Y en p95)', async () => {
  // 100 ms mejor: menos de 150 ms → «mantener».
  const r1: any = await comparar(prueba({ ag: 1500, se: 1400 }), ejercicios());
  assert.equal(r1.total.veredicto.estado, 'mantener', JSON.stringify(r1.total.veredicto));
  assert.equal(r1.total.veredicto.primerTextoP50Mejor, false);
  // 200 ms mejor sobre 3 s: más de 150 ms pero menos del 10 % → «mantener».
  const r2: any = await comparar(prueba({ ag: 3000, se: 2800 }), ejercicios());
  assert.equal(r2.total.veredicto.estado, 'mantener');
  // p50 claro pero p95 peor (cola larga): «mantener».
  const ms = prueba({ ag: 1500, se: 1100 });
  ms.filter((x) => x.motor === 'speech-engine').slice(-2).forEach((x) => (x.primerTextoMs = 9_000));
  const r3: any = await comparar(ms, ejercicios());
  assert.equal(r3.total.veredicto.primerTextoP50Mejor, true);
  assert.equal(r3.total.veredicto.primerTextoP95Mejor, false);
  assert.equal(r3.total.veredicto.estado, 'mantener');
  assert.deepEqual([MED.MARGEN_MS, MED.MARGEN_RELATIVO], [150, 0.1]);
});

test('detecta menos interrupciones a propósito, o corta por un «ajá» que el agente no: no se adopta', async () => {
  const r1: any = await comparar(prueba({ ag: 1500, se: 1100 }), ejercicios('wifi', { 'speech-engine': { interrupcion: 4 } }));
  assert.equal(r1.total.veredicto.estado, 'mantener');
  assert.equal(r1.total.veredicto.interrupcionesIgualOMas, false);
  const r2: any = await comparar(prueba({ ag: 1500, se: 1100 }), ejercicios('wifi', { 'speech-engine': { asentimiento: 3 } }));
  assert.equal(r2.total.veredicto.estado, 'mantener');
  assert.equal(r2.total.veredicto.asentimientosIgualOMas, false);
  // Si el agente también falla una, la misma tasa vale.
  const r3: any = await comparar(prueba({ ag: 1500, se: 1100 }), ejercicios('wifi', { agente: { interrupcion: 4 }, 'speech-engine': { interrupcion: 4 } }));
  assert.equal(r3.total.veredicto.estado, 'adoptar');
});

test('cualquier regresión (errores, respaldos, repetidos, tardes, vacíos, solo espera) bloquea «adoptar», y sus turnos no ayudan a la latencia', async () => {
  for (const [bandera, extra] of [
    ['errores', { error: true }],
    ['respaldos', { respaldo: true }],
    ['repetidos', { repetido: true, primerTextoMs: null }],
    ['tardes', { tarde: true }],
    ['vacios', { primerTextoMs: null, cerebroMs: null }],
    ['soloEspera', { puente: true, cerebroMs: null }],
    // H5: los cortados también (si la persona corta más en un camino, casi siempre es porque tarda).
    ['cortados', { cortado: true }],
  ] as [string, Partial<Medida>][]) {
    const ms = prueba({ ag: 1500, se: 1100 });
    // Uno más (no uno cambiado): Speech Engine sigue con sus 20 comparables y el error va en su contra.
    ms.push(m('speech-engine', 1_000_000 + 25_500, 20, extra));
    // R16-3: las 5 interrupciones a propósito anotadas cortan 5 turnos en cada camino (se descuentan de los cortados).
    if (bandera === 'cortados') ms.push(...cortesAProposito());
    const r: any = await comparar(ms, ejercicios());
    assert.equal(r.total.veredicto.estado, 'mantener', `${bandera}: ${JSON.stringify(r.total.veredicto)}`);
    assert.deepEqual(r.porRed.wifi.veredicto.regresiones, [bandera], bandera);
    assert.equal(r.porRed.wifi['speech-engine'].completos, 20, `${bandera}: no es comparable`);
  }
});

test('el veredicto solo informa: comparar no cambia el motor ni ningún interruptor', async () => {
  const antes = process.env.AURA_MOTOR_VOZ;
  const r: any = await comparar([...prueba({ ag: 1500, se: 1100 }), ...prueba({ ag: 1800, se: 1300, red: '4g', t0: 5_000_000 })], [...ejercicios('wifi'), ...ejercicios('4g')]);
  assert.equal(r.total.veredicto.adoptar, true);
  assert.equal(process.env.AURA_MOTOR_VOZ, antes, 'el motor sigue como estaba');
});

test('un ejercicio mal formado no se anota', () => {
  MED._reiniciarMedidas();
  assert.equal(MED.anotarEjercicioVoz({ motor: 'otro', tipo: 'interrupcion', bien: true }), null);
  assert.equal(MED.anotarEjercicioVoz({ motor: 'agente', tipo: 'gritar', bien: true }), null);
  assert.equal(MED.anotarEjercicioVoz({ motor: 'agente', tipo: 'interrupcion' }), null, 'sin decir si salió bien, no cuenta');
  const e = MED.anotarEjercicioVoz({ motor: 'agente', tipo: 'interrupcion', bien: false });
  assert.equal(e?.bien, false);
  assert.equal(MED._ejercicios().length, 1);
});

/* ------------------------------------------------------------------ revisión 16: R16-3 y R16-4 */

/** Interrupciones a propósito en otra cantidad por camino (todas bien); 5 asentimientos por camino. */
const ejerciciosN = (interrupciones: Record<Motor, number>, red = 'wifi') => {
  const out: import('../server/voz-medidas').EjercicioVoz[] = [];
  for (const motor of ['agente', 'speech-engine'] as Motor[]) {
    for (let i = 0; i < interrupciones[motor]; i++) out.push({ motor, tipo: 'interrupcion', bien: true, t: 2_000_000 + i, red });
    for (let i = 0; i < 5; i++) out.push({ motor, tipo: 'asentimiento', bien: true, t: 2_100_000 + i, red });
  }
  return out;
};
/** Cortes de impaciencia en Speech Engine: lo cortó la persona antes de que hablara el cerebro, a los 1100 ms. */
const impaciencia = (n: number) => Array.from({ length: n }, (_, i) => m('speech-engine', 3_100_000 + i, null, { cortado: true, cerebroMs: null, totalMs: 1100, conv: `wifi-s0-${i % 3}` }));

test('R16-3: 10 interrupciones a propósito en el agente contra 5 en Speech Engine ya no tapan 5 cortes de impaciencia: «insuficiente» (desparejos); y con ejercicios parejos los cortes a propósito se descuentan', async () => {
  // La reproducción: 10 cortes a propósito en el agente; 5 a propósito + 5 de impaciencia en Speech Engine.
  const ms = [...prueba({ ag: 1500, se: 1100 }), ...cortesAProposito({ agente: 10, 'speech-engine': 5 }), ...impaciencia(5)];
  const r: any = await comparar(ms, ejerciciosN({ agente: 10, 'speech-engine': 5 }));
  assert.equal(r.total.veredicto.estado, 'insuficiente', JSON.stringify(r.total.veredicto));
  assert.ok(r.total.veredicto.faltan.some((f: string) => /interrupciones a propósito desparejos \(agente 10, speech-engine 5\)/.test(f)), r.total.veredicto.faltan.join(' | '));
  // El control (5 contra 5): los 5 de impaciencia son una regresión.
  const c: any = await comparar([...prueba({ ag: 1500, se: 1100 }), ...cortesAProposito(), ...impaciencia(5)], ejerciciosN({ agente: 5, 'speech-engine': 5 }));
  assert.equal(c.total.veredicto.estado, 'mantener', JSON.stringify(c.total.veredicto));
  assert.deepEqual(c.porRed.wifi.veredicto.regresiones, ['cortados']);
  // Parejos (6 y 5, dentro del ±20 %): 6 cortes a propósito en el agente contra 5 + 1 de impaciencia ya no empatan.
  const d: any = await comparar([...prueba({ ag: 1500, se: 1100 }), ...cortesAProposito({ agente: 6, 'speech-engine': 5 }), ...impaciencia(1)], ejerciciosN({ agente: 6, 'speech-engine': 5 }));
  assert.equal(d.total.veredicto.estado, 'mantener', JSON.stringify(d.total.veredicto));
  assert.deepEqual(d.porRed.wifi.veredicto.regresiones, ['cortados']);
  assert.deepEqual(MED.cortadosSinEjercicios(d.porRed.wifi['speech-engine']), { cortados: 1, de: 21 });
  assert.deepEqual(MED.cortadosSinEjercicios(d.porRed.wifi.agente), { cortados: 0, de: 20 });
  // Y sin cortes de impaciencia, con ejercicios parejos, se adopta.
  const ok: any = await comparar([...prueba({ ag: 1500, se: 1100 }), ...cortesAProposito()], ejerciciosN({ agente: 5, 'speech-engine': 5 }));
  assert.equal(ok.total.veredicto.estado, 'adoptar', JSON.stringify(ok.total.veredicto));
  assert.equal(MED.EJERCICIOS_PAREJOS, 0.8);
});

test('R16-4: la paradoja de Simpson (40 A y 5 B en la hora mala, 5 A y 100 B en la buena, B peor en las dos) ya no da «adoptar»; una ganancia de verdad en bloques parejos sí', async () => {
  const ms: Medida[] = [];
  let t = 1_000_000;
  const bloque = (motor: Motor, n: number, base: number, b: number) => {
    for (let i = 0; i < n; i++) ms.push(m(motor, (t += 1000), base + (i % 10) * 10, { conv: `wifi-${motor[0]}${b}-${i % 6}` }));
  };
  // Hora mala: el agente a ~2000 ms, Speech Engine a ~2200. Hora buena: el agente a ~800, Speech Engine a ~900.
  bloque('agente', 40, 2000, 0);
  bloque('speech-engine', 5, 2200, 0);
  bloque('agente', 5, 800, 1);
  bloque('speech-engine', 100, 900, 1);
  const r: any = await comparar(ms, ejercicios());
  const v = r.porRed.wifi.veredicto;
  assert.equal(v.primerTextoP50Mejor, true, 'junto, Speech Engine parece mejor (el reparto de las horas)');
  assert.equal(r.total.veredicto.estado, 'mantener', JSON.stringify(r.total.veredicto));
  assert.deepEqual(r.porRed.wifi.pares, { total: 2, ganaSE: 0 });
  assert.equal(v.ganaEnLaMayoriaDePares, false);
  assert.ok(v.motivos.some((x: string) => /pares de bloques A\/B \(gana 0 de 2\)/.test(x)), v.motivos.join(' | '));
  // Una ganancia de verdad, en tres pares de bloques parejos: gana los tres y se adopta.
  const bien: any = await comparar(prueba({ ag: 1500, se: 1100, bloquesPorCamino: 3 }), ejercicios());
  assert.deepEqual(bien.porRed.wifi.pares, { total: 3, ganaSE: 3 });
  assert.equal(bien.total.veredicto.estado, 'adoptar', JSON.stringify(bien.total.veredicto));
  assert.equal(bien.total.veredicto.ganaEnLaMayoriaDePares, true);
});
