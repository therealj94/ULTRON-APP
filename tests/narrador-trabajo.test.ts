/**
 * EL NARRADOR DEL TRABAJO (mobile/src/compa/narrador.ts), puro y con reloj falso: el ritmo (el primero ≤ 700 ms, luego
 * uno cada 3,5–5 s), la variedad (ninguna frase dos veces en la sesión), que nunca habla encima de la respuesta y que no
 * cuenta avances falsos («estoy buscando» solo tras `empece`, «no aparece» solo tras `nada`, «hay 2» solo con su número).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ConductorNarrador,
  MemoriaNarrador,
  Narrador,
  PASO_NARRADOR,
  eventoProgresoValido,
  frasesNarrador,
  limpiarDetalle,
  lineaDePantalla,
  type EventoProgreso,
} from '../mobile/src/compa/narrador';

const azar0 = () => 0;

/** Avanza el reloj de a 50 ms y junta lo que el narrador decide decir (con su momento). */
function simular(n: Narrador, guion: Array<[number, EventoProgreso | 'respuesta']>, hastaMs: number) {
  const dichos: { ms: number; texto: string }[] = [];
  const pasos = [...guion].sort((a, b) => a[0] - b[0]);
  for (let t = 0; t <= hastaMs; t += 50) {
    while (pasos.length && pasos[0][0] <= t) {
      const [, ev] = pasos.shift()!;
      if (ev === 'respuesta') n.alRespuesta();
      else n.alEvento(ev, t);
    }
    const p = n.proximo();
    if (p !== null && p <= t) {
      const texto = n.tomar(t);
      if (texto) dichos.push({ ms: t, texto });
    }
  }
  return dichos;
}

test('el primero sale a ≤ 700 ms de EMPEZAR la herramienta (no antes) y dice lo que de verdad pasa', () => {
  const n = new Narrador({ avatar: 'aura', idioma: 'es', azar: azar0 });
  const dichos = simular(n, [[1_000, { fase: 'empece', herramienta: 'correo', detalle_seguro: 'Ana' }]], 1_900);
  assert.equal(dichos.length, 1, JSON.stringify(dichos));
  assert.ok(dichos[0].ms >= 1_000 && dichos[0].ms - 1_000 <= PASO_NARRADOR.primeraMaxMs, `a ${dichos[0].ms - 1_000} ms de empezar`);
  assert.match(dichos[0].texto, /Ana/);
  assert.match(dichos[0].texto, /correo/);
  assert.ok(PASO_NARRADOR.primeraMs <= PASO_NARRADOR.primeraMaxMs && PASO_NARRADOR.primeraMaxMs <= 700);
});

test('sin evento no hay comentario: antes de empezar ni una palabra (ni «ya casi»)', () => {
  const n = new Narrador({ avatar: 'aura', idioma: 'es' });
  assert.equal(n.proximo(), null);
  assert.equal(n.tomar(10_000), null);
  // Un `listo` o un `espera_ok` solos no se narran.
  n.alEvento({ fase: 'espera_ok', herramienta: 'correo' }, 0);
  n.alEvento({ fase: 'listo', herramienta: 'correo' }, 10);
  assert.deepEqual(simular(n, [], 20_000), []);
});

test('la respuesta llega antes: nada pendiente se dice, y después del primer texto no habla más en el turno', () => {
  const n = new Narrador({ avatar: 'aura', idioma: 'es', azar: azar0 });
  // La búsqueda empezó a los 0 y la respuesta llegó a los 200 ms (antes de los 400 del primero).
  assert.deepEqual(simular(n, [[0, { fase: 'empece', herramienta: 'web' }], [200, 'respuesta']], 20_000), []);
  // Ya dijo el primero y la respuesta empieza: el «encontré» que venía no sale.
  const m = new Narrador({ avatar: 'aura', idioma: 'es', azar: azar0 });
  const dichos = simular(m, [[0, { fase: 'empece', herramienta: 'web' }], [3_000, { fase: 'encontre', herramienta: 'web', n: 5 }], [3_200, 'respuesta'], [3_300, { fase: 'empece', herramienta: 'leer' }]], 20_000);
  assert.equal(dichos.length, 1, JSON.stringify(dichos));
  assert.equal(m.respondida, true);
});

test('ritmo: como mucho uno cada 3,5 s, «sigo…» a los ~5 s sin novedad y un tope por turno', () => {
  const n = new Narrador({ avatar: 'aura', idioma: 'es', azar: azar0 });
  // Su computadora trabaja 40 s sin terminar.
  const dichos = simular(n, [[0, { fase: 'empece', herramienta: 'computadora' }]], 40_000);
  assert.ok(dichos.length >= 2 && dichos.length <= PASO_NARRADOR.maxPorTurno, JSON.stringify(dichos));
  for (let i = 1; i < dichos.length; i++) {
    const hueco = dichos[i].ms - dichos[i - 1].ms;
    assert.ok(hueco >= PASO_NARRADOR.cadaMinMs, `hueco de ${hueco} ms`);
    assert.ok(hueco <= PASO_NARRADOR.seguirMs + 100, `sin silencio largo entre avances: ${hueco} ms`);
  }
  // Los «sigo…» son de la computadora (lo que está corriendo), no genéricos de otra cosa.
  for (const d of dichos.slice(1)) assert.ok(frasesNarrador('seguir', 'computadora', 'aura', 'es').includes(d.texto), d.texto);
});

test('un avance que llega pegado al anterior espera su turno (≥ 3,5 s desde lo último dicho)', () => {
  const n = new Narrador({ avatar: 'aura', idioma: 'es', azar: azar0 });
  const dichos = simular(n, [[0, { fase: 'empece', herramienta: 'correo' }], [900, { fase: 'encontre', herramienta: 'correo', n: 2, detalle_seguro: 'Ana' }]], 8_000);
  assert.equal(dichos.length, 2, JSON.stringify(dichos));
  assert.ok(dichos[1].ms - dichos[0].ms >= PASO_NARRADOR.cadaMinMs);
  assert.match(dichos[1].texto, /2/);
  assert.match(dichos[1].texto, /Ana/);
});

test('lo que algo ya dijo (la frase de espera, el cerebro antes de la herramienta) cuenta para el ritmo', () => {
  const n = new Narrador({ avatar: 'aura', idioma: 'es', azar: azar0 });
  n.yaSeDijo(0);
  const dichos = simular(n, [[100, { fase: 'empece', herramienta: 'web' }]], 3_000);
  assert.deepEqual(dichos, [], 'el primero no se pega a lo que ya sonó');
});

test('sin avances falsos: «no aparece» solo con `nada`, «hay N» solo con su número, y nada de cerrar tras un `nada`', () => {
  const todas = (momento: string, h: Parameters<typeof frasesNarrador>[1]) => ['ojos', 'aura', 'claudio', 'antonio'].flatMap((a) => ['es', 'en'].flatMap((i) => frasesNarrador(momento, h, a, i as 'es' | 'en')));
  for (const f of [...todas('empece', 'web'), ...todas('empece', 'correo'), ...todas('seguir', 'web')]) {
    assert.doesNotMatch(f, /encontr|found|no aparece|nothing|aquí está|here it is|listo|done|terminé|ya quedó/i, `«${f}» no puede dar un resultado`);
  }
  for (const f of [...todas('empece', 'correo'), ...todas('seguir', 'correo'), ...todas('cerrando', 'web')]) {
    assert.doesNotMatch(f, /te aviso|I'll let you know|ya casi|almost/i, `«${f}» no promete`);
  }
  // Un `encontre` sin número no inventa uno; con 0 es «nada».
  const n = new Narrador({ avatar: 'aura', idioma: 'es', azar: azar0 });
  const a = simular(n, [[0, { fase: 'encontre', herramienta: 'correo' }]], 1_000);
  assert.equal(a.length, 1);
  assert.doesNotMatch(a[0].texto, /\d/);
  const m = new Narrador({ avatar: 'aura', idioma: 'es', azar: azar0 });
  const b = simular(m, [[0, { fase: 'encontre', herramienta: 'correo', n: 0 }]], 2_000);
  assert.ok(frasesNarrador('nada', 'correo', 'aura', 'es').includes(b[0]?.texto), JSON.stringify(b));
  // Tras un `nada`, no sale «Ya, te cuento…» (no hay qué contar).
  const z = new Narrador({ avatar: 'aura', idioma: 'es', azar: azar0 });
  const c = simular(z, [[0, { fase: 'empece', herramienta: 'web' }], [600, { fase: 'nada', herramienta: 'web' }], [700, { fase: 'listo', herramienta: 'web' }]], 30_000);
  for (const d of c) assert.ok(!frasesNarrador('cerrando', 'web', 'aura', 'es').includes(d.texto), d.texto);
  // La búsqueda en internet no dice «hay 5»: el número no dice nada al oído.
  const w = new Narrador({ avatar: 'aura', idioma: 'es', azar: azar0 });
  const d = simular(w, [[0, { fase: 'encontre', herramienta: 'web', n: 5 }]], 1_000);
  assert.doesNotMatch(d[0].texto, /5/);
});

test('variedad: en la misma sesión ninguna frase sale dos veces (sin frase nueva, se calla)', () => {
  const memoria = new MemoriaNarrador();
  const vistos: string[] = [];
  for (let turno = 0; turno < 6; turno++) {
    const n = new Narrador({ avatar: 'aura', idioma: 'es', memoria });
    vistos.push(...simular(n, [[0, { fase: 'empece', herramienta: 'web' }], [6_000, { fase: 'encontre', herramienta: 'web', n: 3 }]], 12_000).map((x) => x.texto));
  }
  assert.ok(vistos.length >= 6, JSON.stringify(vistos));
  assert.equal(new Set(vistos).size, vistos.length, `repetidas: ${JSON.stringify(vistos)}`);
  // Otro avatar, otra forma de ser.
  assert.ok(frasesNarrador('empece', 'web', 'antonio', 'es').some((f) => /brazos/.test(f)));
  assert.ok(frasesNarrador('empece', 'web', 'claudio', 'es').some((f) => /husmear|olfate/i.test(f)));
  assert.ok(frasesNarrador('empece', 'web', 'ojos', 'es').every((f) => f.length <= 24), 'el Guardián, breve');
  assert.ok(frasesNarrador('empece', 'correo', 'aura', 'en').every((f) => !/[áéíóúñ¿]/.test(f)), 'en inglés, en inglés');
});

test('la línea de pantalla: una sola, en su lugar, con lo real; se va con `listo`', () => {
  assert.equal(lineaDePantalla({ fase: 'empece', herramienta: 'correo', detalle_seguro: 'Ana' }), 'Buscando lo de Ana en tu correo…');
  assert.equal(lineaDePantalla({ fase: 'encontre', herramienta: 'correo', detalle_seguro: 'Ana', n: 2 }), 'Encontré 2 de Ana');
  assert.equal(lineaDePantalla({ fase: 'nada', herramienta: 'correo', detalle_seguro: 'Ana' }), 'No aparece nada de Ana');
  assert.equal(lineaDePantalla({ fase: 'empece', herramienta: 'web' }, 'en'), 'Searching the web…');
  assert.equal(lineaDePantalla({ fase: 'encontre', herramienta: 'web', n: 5 }), 'Encontré 5 resultados');
  assert.equal(lineaDePantalla({ fase: 'listo', herramienta: 'web' }), '');
  for (const ev of [{ fase: 'empece', herramienta: 'trabajo' }, { fase: 'paso', herramienta: 'leer' }, { fase: 'espera_ok', herramienta: 'whatsapp' }] as EventoProgreso[]) {
    const l = lineaDePantalla(ev);
    assert.ok(l && !/herramienta|ejecutando|tool|harness/i.test(l), l);
  }
});

test('lo que llega por el SSE se valida: nada raro entra a la pantalla ni a la voz', () => {
  assert.equal(eventoProgresoValido({ fase: 'empece', herramienta: 'correo-privado' }), null);
  assert.equal(eventoProgresoValido({ fase: 'ejecutando', herramienta: 'web' }), null);
  assert.equal(eventoProgresoValido(null), null);
  assert.deepEqual(eventoProgresoValido({ fase: 'encontre', herramienta: 'correo', n: 2, detalle_seguro: 'Ana', extra: 'x' }), { fase: 'encontre', herramienta: 'correo', n: 2, detalle_seguro: 'Ana' });
  assert.equal(eventoProgresoValido({ fase: 'encontre', herramienta: 'correo', detalle_seguro: 'ana@correo.hn' })?.detalle_seguro, undefined);
  assert.equal(limpiarDetalle('https://banco.hn/x'), '');
  assert.equal(limpiarDetalle('+504 9999 8888'), '');
  assert.equal(limpiarDetalle('<b>Ana</b>'), 'b Ana /b');
});

test('el conductor: dice a tiempo con relojes falsos, tira lo pendiente si suena otra cosa y se calla al responder', () => {
  let ahora = 0;
  const relojes: Array<{ en: number; f: () => void; vivo: boolean }> = [];
  const dichos: string[] = [];
  let puede = true;
  const c = new ConductorNarrador(new Narrador({ avatar: 'aura', idioma: 'es', azar: azar0 }), {
    decir: (t) => dichos.push(t),
    puede: () => puede,
    ahora: () => ahora,
    setTimeout: (f, ms) => {
      const r = { en: ahora + ms, f, vivo: true };
      relojes.push(r);
      return r;
    },
    clearTimeout: (h) => ((h as { vivo: boolean }).vivo = false),
  });
  const avanzar = (hasta: number) => {
    for (;;) {
      const r = relojes.filter((x) => x.vivo && x.en <= hasta).sort((a, b) => a.en - b.en)[0];
      if (!r) break;
      r.vivo = false;
      ahora = r.en;
      r.f();
    }
    ahora = hasta;
  };
  c.evento({ fase: 'empece', herramienta: 'web' });
  avanzar(1_000);
  assert.equal(dichos.length, 1);
  // Suena otra cosa cuando tocaba el siguiente: no se dice tarde.
  puede = false;
  c.evento({ fase: 'encontre', herramienta: 'web', n: 3 });
  avanzar(5_000);
  assert.equal(dichos.length, 1);
  puede = true;
  c.respuesta();
  avanzar(60_000);
  assert.equal(dichos.length, 1, 'tras la respuesta, nada');
});
