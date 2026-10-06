/**
 * ASENTIR MIENTRAS LA PERSONA HABLA (mobile/src/lib/asentir.ts): cuándo un «mjm» sí, cuándo no, cuántos, y que lo
 * que se coló al micrófono no quede en su frase. Nunca sin cancelación de eco; encendido por omisión solo en Android con
 * micrófono crudo y cancelador de eco (ver la cabecera del módulo). La orquesta con el oído: tests/muletillas.test.ts.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AJUSTES_ASENTIR,
  ASENTIR_POR_OMISION,
  Asentidor,
  ajusteAsentirGuardado,
  debeAsentir,
  decidirAsentir,
  frasesAsentir,
  quitarAsentimientos,
  textoParaVoz,
  type EstadoAsentir,
} from '../mobile/src/lib/asentir';

const base: EstadoAsentir = { activo: true, ecoCancelado: true, auraHablando: false, parcial: 'y entonces fuimos a ver lo del terreno y', hablaMs: 8000, pausaMs: 500, ultimoMs: -Infinity, enTurno: 0, ahora: 100_000 };

test('apagado por omisión; y sin cancelación de eco, nunca (el «mjm» se oiría como suyo y atrasaría el cierre)', () => {
  assert.equal(ASENTIR_POR_OMISION, false);
  assert.ok(debeAsentir(base));
  assert.ok(!debeAsentir({ ...base, activo: false }));
  assert.ok(!debeAsentir({ ...base, ecoCancelado: false }));
  assert.ok(!debeAsentir({ ...base, silencioso: true }));
  assert.ok(!debeAsentir({ ...base, auraHablando: true }), 'nunca encima de su propia voz');
});

test('solo tras hablar un buen rato y en una pausa corta a media idea (nunca tras un punto o una pregunta)', () => {
  assert.ok(!debeAsentir({ ...base, hablaMs: 4000 }), 'poco rato');
  assert.ok(!debeAsentir({ ...base, pausaMs: 150 }), 'un respiro');
  assert.ok(!debeAsentir({ ...base, pausaMs: 1200 }), 'la frase ya se está cerrando');
  assert.ok(debeAsentir({ ...base, parcial: 'le dije que no, que mejor el lunes,' }));
  assert.ok(!debeAsentir({ ...base, parcial: 'y eso fue lo que pasó.' }), 'tras un punto quiere respuesta');
  assert.ok(!debeAsentir({ ...base, parcial: '¿vos qué harías?' }), 'tras una pregunta quiere respuesta');
});

test('en un tema triste o delicado, en silencio', () => {
  assert.ok(!debeAsentir({ ...base, parcial: 'es que mi abuelo murió la semana pasada y' }));
  assert.ok(!debeAsentir({ ...base, parcial: 'estuvo en el hospital toda la noche y' }));
});

test('uno cada diez segundos, dos por turno como mucho, nunca dos iguales seguidos', () => {
  const a = new Asentidor({ activo: true, ecoCancelado: true });
  a.oir('y entonces le conté a mi hermano lo del negocio y');
  let t = 0;
  const hablar = (ms: number) => {
    for (let i = 0; i < ms; i += 100) assert.equal(a.trozo(true, (t += 100)), null);
  };
  const callar = (ms: number) => {
    const dichas: string[] = [];
    for (let i = 0; i < ms; i += 100) {
      const f = a.trozo(false, (t += 100));
      if (f) dichas.push(f);
    }
    return dichas;
  };
  hablar(8000);
  const primera = callar(600);
  assert.equal(primera.length, 1, 'uno en la pausa');
  hablar(3000);
  assert.deepEqual(callar(600), [], 'antes de diez segundos, no');
  hablar(8000);
  const segunda = callar(600);
  assert.equal(segunda.length, 1);
  assert.notEqual(segunda[0], primera[0]);
  hablar(12_000);
  assert.deepEqual(callar(600), [], 'dos por turno');
  a.finTurno();
  // Una pausa larga corta el «hablando seguido»: vuelve a contar desde cero.
  hablar(5000);
  callar(2000);
  hablar(3000);
  assert.deepEqual(callar(600), [], 'tras una pausa larga, el rato vuelve a empezar');
  assert.ok(AJUSTES_ASENTIR.maxPorTurno === 2 && AJUSTES_ASENTIR.separacionMs === 10_000);
});

test('con el sondeo del fin de turno: solo si quedó colgando, y el «mjm» entero tiene que acabar antes del cierre', () => {
  assert.ok(debeAsentir({ ...base, clase: 'incompleto' }));
  assert.ok(!debeAsentir({ ...base, clase: 'dudoso' }), 'dudosa: se cierra a los 480 ms');
  assert.ok(!debeAsentir({ ...base, clase: 'completo' }));
  assert.ok(debeAsentir({ ...base, cierreMs: 1100, calladoMs: 500, tramoMs: 600 }), 'acaba justo al cierre');
  assert.ok(!debeAsentir({ ...base, cierreMs: 1100, calladoMs: 600, tramoMs: 600 }), 'terminaría encima del cierre');
  assert.ok(!debeAsentir({ ...base, cierreMs: 1000, tramoMs: 600 }), 'sin calladoMs cuenta la pausa (500 + 600 > 1000)');
  // El Asentidor elige la palabra que tiene clip y cabe; sin clip, ninguna.
  const a = new Asentidor({ activo: true, ecoCancelado: true, duracion: (f) => (f === 'okey' ? 300 : null) });
  a.oir('y entonces le conté a mi hermano lo del negocio y');
  let t = 0;
  for (let i = 0; i < 80; i++) a.trozo(true, (t += 100));
  const dichas: string[] = [];
  for (let i = 0; i < 6; i++) {
    const f = a.trozo(false, (t += 100), { clase: 'incompleto', cierreMs: 1100 });
    if (f) dichas.push(f);
  }
  assert.deepEqual(dichas, ['okey']);
  assert.equal(a.ultimoTramoMs, 300 + AJUSTES_ASENTIR.colaMs);
  const sinClip = new Asentidor({ activo: true, ecoCancelado: true, duracion: () => null });
  sinClip.oir('y entonces le conté a mi hermano lo del negocio y');
  t = 0;
  for (let i = 0; i < 80; i++) sinClip.trozo(true, (t += 100));
  for (let i = 0; i < 6; i++) assert.equal(sinClip.trozo(false, (t += 100)), null);
});

test('encendidas por omisión solo en Android con micrófono crudo y cancelación de eco; el servidor y la persona las apagan', () => {
  const tel = { android: true, microfonoCrudo: true, ecoDisponible: true, ajuste: null, remoto: true };
  assert.deepEqual(decidirAsentir(tel), { encendidas: true, porOmision: true, motivo: 'encendidas' });
  assert.equal(decidirAsentir({ ...tel, android: false }).motivo, 'sin_microfono_crudo', 'iOS: nunca');
  assert.equal(decidirAsentir({ ...tel, android: false, ajuste: true }).encendidas, false, 'iOS: ni eligiéndolas');
  assert.equal(decidirAsentir({ ...tel, microfonoCrudo: false }).encendidas, false, 'APK sin el micrófono crudo');
  assert.deepEqual(decidirAsentir({ ...tel, ecoDisponible: false, ajuste: true }), { encendidas: false, porOmision: false, motivo: 'sin_cancelacion_de_eco' });
  assert.equal(decidirAsentir({ ...tel, remoto: false }).motivo, 'apagadas_por_el_servidor');
  assert.equal(decidirAsentir({ ...tel, ajuste: false }).motivo, 'apagadas_por_la_persona');
  assert.equal(ajusteAsentirGuardado('1'), true);
  assert.equal(ajusteAsentirGuardado('0'), false);
  assert.equal(ajusteAsentirGuardado(null), null);
  assert.equal(ajusteAsentirGuardado('x'), null);
});

test('lo que se le pide a la voz: palabras cortas en los dos idiomas, con su punto', () => {
  assert.deepEqual([...frasesAsentir('es')], ['mjm', 'ajá', 'ya', 'okey']);
  assert.deepEqual([...frasesAsentir('en')], ['mhm', 'yeah', 'right', 'okay']);
  for (const i of ['es', 'en'] as const) for (const f of frasesAsentir(i)) assert.match(textoParaVoz(f), /^[A-ZÁ][\p{L}-]{0,7}\.$/u, f);
});

test('lo que se coló al micrófono sale de su frase (solo lo que AU-RA dijo, una vez, justo donde se coló)', () => {
  assert.equal(quitarAsentimientos('y entonces mjm le dije que no', [{ frase: 'mjm', antes: 'y entonces' }]), 'y entonces le dije que no');
  assert.equal(quitarAsentimientos('Ajá, y luego fuimos al banco', [{ frase: 'ajá', antes: '' }]), 'y luego fuimos al banco');
  assert.equal(quitarAsentimientos('aja y luego aja otra vez', [{ frase: 'ajá', antes: '' }]), 'y luego aja otra vez');
  assert.equal(quitarAsentimientos('ya te dije que ya voy', []), 'ya te dije que ya voy', 'sin asentimientos, nada cambia');
  const a = new Asentidor({ activo: true, ecoCancelado: true });
  assert.equal(a.quitarDelFinal('okey, entonces mañana'), 'okey, entonces mañana', 'el «okey» es de la persona: AU-RA no lo dijo');
});

/*
 * Revisión independiente (MEDIO 1): se quitaba la PRIMERA aparición de la palabra en todo el texto, no la que se coló.
 * «ya le dije a Juan…, ya, y que traiga…» perdía el «ya» de la persona; y si Turbo no escribió el «mjm», igual se borraba
 * un «ya» suyo. Regla: un «ya» de la persona no se toca; solo sale la aparición del tramo que Turbo entregó al retomar.
 */
test('un «ya» de la persona no se toca: solo sale la aparición que cae justo detrás de donde retomó', () => {
  const colado = { frase: 'ya', antes: 'ya le dije a Juan que venga' };
  assert.equal(quitarAsentimientos('Ya le dije a Juan que venga, ya, y que traiga el carro.', [colado]), 'Ya le dije a Juan que venga, y que traiga el carro.', 'sale el de AU-RA, no el primero (el de la persona)');
  assert.equal(quitarAsentimientos('Ya le dije a Juan que venga y que traiga el carro.', [colado]), 'Ya le dije a Juan que venga y que traiga el carro.', 'Turbo no escribió el «ya» de AU-RA: nada se toca');
  assert.equal(quitarAsentimientos('Ya le dije a Juan que venga y que traiga el carro, ya.', [colado]), 'Ya le dije a Juan que venga y que traiga el carro, ya.', 'un «ya» suyo lejos del tramo tampoco');
  // Sin saber dónde retomó (el tramo nunca se cortó: a Turbo le llegó silencio), nada.
  const a = new Asentidor({ activo: true, ecoCancelado: true, duracion: () => 300 });
  a.oir('ya le dije a mi hermano lo del negocio y');
  let t = 0;
  for (let i = 0; i < 80; i++) a.trozo(true, (t += 100));
  let dicha: string | null = null;
  for (let i = 0; i < 6 && !dicha; i++) dicha = a.trozo(false, (t += 100));
  assert.ok(dicha);
  assert.equal(a.limpiar(`Ya le dije a mi hermano lo del negocio y ${dicha}, que venga`), `Ya le dije a mi hermano lo del negocio y ${dicha}, que venga`, 'sin «seColo» no hay colado');
  // La persona retomó encima con lo que Turbo ya tenía escrito: sale solo la del tramo, una vez.
  a.seColo(dicha!, 'ya le dije a mi hermano lo del negocio y');
  const conDos = `Ya le dije a mi hermano lo del negocio y ${dicha}, que venga, ${dicha}`;
  assert.equal(a.limpiar(conDos), `Ya le dije a mi hermano lo del negocio y que venga, ${dicha}`, 'el parcial: sin la colada');
  assert.equal(a.quitarDelFinal(conDos), `Ya le dije a mi hermano lo del negocio y que venga, ${dicha}`, 'la final: igual (la segunda es de la persona)');
  assert.equal(a.quitarDelFinal(conDos), conDos, 'y se olvidan al cerrar el turno');
});

test('dónde está lo colado: con certeza, aproximado o sin ubicar (entonces no se toca nada)', () => {
  // Un parcial de Turbo que empezó de cero tras el sondeo (no trae lo de antes): su comienzo es el tramo.
  const deCero = { frase: 'ya', antes: 'ya le dije a Juan que venga y', deCero: true };
  assert.equal(quitarAsentimientos('ya, que traiga el carro', [deCero], { parcialTurbo: true }), 'que traiga el carro');
  assert.equal(quitarAsentimientos('que traiga el carro, ya', [deCero], { parcialTurbo: true }), 'que traiga el carro, ya', 'fuera del tramo (las primeras palabras), no');
  assert.equal(quitarAsentimientos('Ya, que traiga el carro.', [deCero]), 'Ya, que traiga el carro.', 'una frase entera sin el ancla no es un parcial de cero: no se adivina');
  // Turbo reescribió lo de antes (el ancla no está): la ÚLTIMA aparición, y solo si cae cerca de donde terminaba.
  const reescrito = { frase: 'okey', antes: 'okey mañana vamos al banco de la esquina' };
  assert.equal(quitarAsentimientos('Okey, mañana vamos al banco de las esquinas okey y luego al mercado', [reescrito]), 'Okey, mañana vamos al banco de las esquinas y luego al mercado');
  assert.equal(quitarAsentimientos('Okey, mañana vamos al banco de las esquinas y luego al mercado del centro, okey', [reescrito]), 'Okey, mañana vamos al banco de las esquinas y luego al mercado del centro, okey', 'la última está lejos del tramo: nada');
  assert.equal(quitarAsentimientos('Okey, mañana vamos al banco de las esquinas okey y luego al mercado, okey', [reescrito]), 'Okey, mañana vamos al banco de las esquinas okey y luego al mercado, okey', 'aproximado: solo la ÚLTIMA, y esa no cae en el tramo');
  // El ancla repetida tampoco es certeza: aproximado.
  const repetida = { frase: 'mjm', antes: 'y que venga y que venga' };
  assert.equal(quitarAsentimientos('y que venga y que venga mjm le dije', [repetida]), 'y que venga y que venga le dije');
  // Dos coladas en la misma frase: cada una en su tramo (la segunda tiene la primera en lo de antes).
  const dos = [
    { frase: 'mjm', antes: 'le conté lo del terreno y' },
    { frase: 'ajá', antes: 'le conté lo del terreno y mjm luego fuimos al banco y' },
  ];
  assert.equal(quitarAsentimientos('Le conté lo del terreno y mjm luego fuimos al banco y ajá, pagamos', dos), 'Le conté lo del terreno y luego fuimos al banco y pagamos');
});
