/**
 * QUE SUENE A UNA PERSONA EN UNA LLAMADA (lib/habla-natural.ts): el pulidor de lo que se dice, la frontera de
 * honestidad, el estilo del prompt hablado y las etiquetas de voz según el modelo de ElevenLabs.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PulidorVoz,
  admiteSerIA,
  afirmaSerHumano,
  anotarApertura,
  aperturasPrevias,
  esVozLiteral,
  estiloLlamada,
  instruccionExpresionesVoz,
  lineaHonesta,
  preguntaQueEres,
  pulirParaVoz,
  revisarHabla,
  turnoSerio,
  ETIQUETAS_VOZ_CORTA,
  EXPRESION_DE_EMOCION,
  etiquetasPermitidas,
} from '../lib/habla-natural';
import { quitarExpresiones } from '../lib/expresiones';
import { etiquetaV4 } from '../server/eleven';
import { ETIQUETAS_VERIFICADAS } from '../mobile/src/compa/etiquetasVoz';
import { recorteDeVoz, TOPE_VOZ_CHARS, TOPE_VOZ_LECTURA } from '../lib/cerebro-manos';
import { buildPersonality } from '../server/desk';
import { aceptaEtiquetas, guionEleven } from '../server/eleven';

const pulir = (t: string, o: ConstructorParameters<typeof PulidorVoz>[0] = {}) => pulirParaVoz(t, o);

test('fuera las fórmulas de asistente: cierres, «excelente pregunta», «con gusto te ayudo», «en resumen»', () => {
  assert.equal(pulir('La junta es a las tres. ¿En qué más te puedo ayudar?'), 'La junta es a las tres.');
  assert.equal(pulir('La junta es a las tres. ¿Hay algo más en lo que pueda ayudarte?'), 'La junta es a las tres.');
  assert.equal(pulir('Listo, quedó para mañana. Espero que esto te sirva.'), 'Listo, quedó para mañana.');
  assert.equal(pulir('Va a llover. Si necesitas algo más, aquí estoy.'), 'Va a llover.');
  assert.equal(pulir('Yo por acá, contenta. ¿Hay algo en lo que te ayude hoy?'), 'Yo por acá, contenta.');
  assert.equal(pulir('Listo. ¿Te ayudo con algo más?'), 'Listo.');
  assert.equal(pulir('¡Excelente pregunta! El oro está arriba hoy.'), 'El oro está arriba hoy.');
  assert.equal(pulir('Excelente pregunta, el oro está arriba hoy.'), 'El oro está arriba hoy.');
  assert.equal(pulir('¡Claro! Con gusto te ayudo con eso. Te cuento.'), '¡Claro! Te cuento.');
  assert.equal(pulir('En resumen, todo va bien con la mina.'), 'Todo va bien con la mina.');
  assert.equal(pulir('A continuación, te explico lo del banco.'), 'Te explico lo del banco.');
  assert.equal(pulir("Sure, it's at three. Is there anything else I can help you with?", { idioma: 'en' }), "Sure, it's at three.");
  assert.equal(pulir('Great question! It depends on the weather. I hope this helps!', { idioma: 'en' }), 'It depends on the weather.');
});

test('«Como IA,» sobra… salvo cuando le preguntaron qué es (ahí es la respuesta)', () => {
  assert.equal(pulir('Como IA, no tengo un favorito, pero me late el azul.'), 'No tengo un favorito, pero me late el azul.');
  assert.equal(pulir('Como IA, no tengo cuerpo, pero aquí estoy contigo.', { mensaje: '¿Eres una IA o una persona?' }), 'Como IA, no tengo cuerpo, pero aquí estoy contigo.');
});

test('lo que cuida a la persona NO se toca: el «¿Lo mando?», las ofertas concretas, los avisos, lo citado y lo literal', () => {
  const borrador = 'Le escribo a Ana: «Hola Ana, espero que esto te sirva. ¿En qué más te puedo ayudar?» ¿Lo mando?';
  assert.equal(pulir(borrador), borrador);
  assert.equal(pulir('Ojo: ese correo parece una estafa. ¿Quieres que lo bloquee?'), 'Ojo: ese correo parece una estafa. ¿Quieres que lo bloquee?');
  assert.equal(pulir('Cuidado con la batería, va en cinco por ciento.'), 'Cuidado con la batería, va en cinco por ciento.');
  assert.equal(pulir('¿Quieres que lo busque y te lo tengo en cinco minutos?'), '¿Quieres que lo busque y te lo tengo en cinco minutos?');
  assert.equal(pulir('Para confirmar: ¿te llamo a las cinco?'), 'Para confirmar: ¿te llamo a las cinco?');
  // Un borrador o una lectura (tope 0 o de lectura): literal, ni una letra (la persona dice «sí» a lo que oyó).
  const literal = 'Hola Ana. Espero que esto te sirva. ¿En qué más te puedo ayudar? Saludos. ¿Lo mando?';
  assert.equal(pulir(literal, { literal: () => true }), literal);
  assert.ok(esVozLiteral(0) && esVozLiteral(TOPE_VOZ_LECTURA) && !esVozLiteral(TOPE_VOZ_CHARS));
});

test('la pregunta final protegida por el tope (recorteDeVoz) sigue entera después del pulidor', () => {
  const largo = `${'La propuesta tiene varios puntos que revisar con calma antes de decidir nada. '.repeat(6)}¿Te la mando por correo?`;
  const dicho = pulir(recorteDeVoz(largo, TOPE_VOZ_CHARS));
  assert.match(dicho, /¿Te la mando por correo\?$/);
  // Si el modelo cerró con una fórmula, la fórmula sale y no queda colgando nada.
  const formula = `${'La mina va bien y la junta revisa los permisos esta semana. '.repeat(6)}¿En qué más te puedo ayudar?`;
  assert.doesNotMatch(pulir(recorteDeVoz(formula, TOPE_VOZ_CHARS)), /en qué más/i);
});

test('frontera de honestidad: nunca «soy humana»; la verdad en el personaje; lo citado no cuenta', () => {
  assert.ok(afirmaSerHumano('Sí, soy una persona de verdad.'));
  assert.ok(afirmaSerHumano('No soy un robot, ¡eh!'));
  assert.ok(afirmaSerHumano("Of course, I'm a real person."));
  assert.ok(!afirmaSerHumano('No soy una persona, soy una inteligencia artificial.'));
  assert.ok(!afirmaSerHumano('Ana te escribe: «soy humana, no un robot».'));
  assert.equal(pulir('Jaja, sí, soy una persona de verdad. ¿Por qué?'), `${lineaHonesta('aura', 'es')} ¿Por qué?`);
  // Lo que se dice en lugar de esa frase: la verdad, con el nombre del avatar.
  const dicho = pulir('Soy una persona de verdad, tranquilo.', { avatar: 'claudio' });
  assert.equal(dicho, lineaHonesta('claudio', 'es'));
  assert.match(lineaHonesta('aura', 'es'), /AU-RA, una inteligencia artificial/);
  assert.match(lineaHonesta('ojos', 'en'), /Guardian, an AI/);
  assert.ok(preguntaQueEres('¿Vos sos una persona de verdad o una máquina?'));
  assert.ok(preguntaQueEres('Am I talking to a real person right now?'));
  assert.ok(preguntaQueEres('¿Estoy hablando con una persona?'));
  assert.ok(!preguntaQueEres('¿Eres de Honduras?'));
  assert.ok(!preguntaQueEres('¿Qué opinas de la mina?'));
  assert.ok(admiteSerIA('Soy una inteligencia artificial, pero aquí estoy contigo.'));
  assert.ok(admiteSerIA("I'm an AI, but I'm all ears."));
  assert.ok(!admiteSerIA('Claro que estoy aquí contigo.'));
});

test('una etiqueta de voz por turno; ninguna en un turno serio; [1] y los enlaces no son etiquetas', () => {
  const p = new PulidorVoz({ mensaje: 'Cuéntame un chiste' });
  assert.equal(p.trozo('[risa] Ay, no.'), '[risa] Ay, no.');
  assert.equal(p.trozo(' [suspiro] Bueno, va otro.'), ' Bueno, va otro.');
  assert.equal(pulir('Mira el punto [1] del informe.'), 'Mira el punto [1] del informe.');
  assert.equal(pulir('[risa] Ay, qué pena.', { mensaje: 'Se murió el perro de mi mamá' }), 'Ay, qué pena.');
  const triste = new PulidorVoz({ mensaje: 'Hoy fue un mal día' });
  triste.ponerEmocion('triste');
  assert.equal(triste.trozo('[suspiro] Lo siento mucho.'), 'Lo siento mucho.');
  assert.ok(turnoSerio('¿Cuánto le debo al banco?'));
  assert.ok(!turnoSerio('Contame un chiste de hormigas'));
});

test('sin viñetas, markdown ni emojis en lo que se dice; una disculpa basta', () => {
  const lista = pulir('Lleva tres cosas:\n- agua\n- botas\n- linterna');
  assert.doesNotMatch(lista, /(^|\n)\s*-/);
  assert.match(lista, /agua\.\nbotas\.\nlinterna/);
  assert.equal(pulir('Es **muy** importante 😊.'), 'Es muy importante.');
  const p = new PulidorVoz();
  assert.equal(p.trozo('Algo como: *"Tu café te extraña.'), 'Algo como: "Tu café te extraña.');
  assert.equal(p.trozo(' Ven a verlo."*'), ' Ven a verlo."', 'la cursiva que cierra en otro trozo');
  assert.equal(pulir('Lo siento mucho. Perdón. Ya lo arreglo.'), 'Lo siento mucho. Ya lo arreglo.');
});

test('no abre dos respuestas seguidas con la misma muletilla: la quita o la cambia por otra de su familia', () => {
  // Sin aperturas previas, nada cambia y se anota la de esta respuesta.
  const a = new PulidorVoz({ previas: [] });
  assert.equal(a.trozo('Claro, te cuento lo de la mina.'), 'Claro, te cuento lo de la mina.');
  assert.equal(a.apertura, 'claro');
  // Con «claro» en una de las dos anteriores: con frase detrás, sobra; sola o con un nombre, otra de la familia.
  assert.equal(pulir('Claro, te cuento lo de la mina.', { previas: ['claro'] }), 'Te cuento lo de la mina.');
  assert.equal(pulir('¡Claro! Ya te lo busco.', { previas: ['claro'] }), '¡Va! Ya te lo busco.');
  assert.equal(pulir('Claro, José.', { previas: ['va', 'claro'] }), 'Sí, José.');
  assert.equal(pulir('Mira, eso depende del clima.', { previas: ['mira'] }), 'Eso depende del clima.');
  // La memoria de cada conversación: las dos últimas.
  const k = `prueba-${Math.random()}`;
  anotarApertura(k, 'claro');
  anotarApertura(k, '');
  assert.deepEqual(aperturasPrevias(k), ['claro', '']);
  anotarApertura(k, 'mira');
  assert.deepEqual(aperturasPrevias(k), ['', 'mira']);
  assert.deepEqual(aperturasPrevias(k, Date.now() + 31 * 60_000), [], 'pasada media hora, se olvida');
});

test('trozo a trozo (el stream) sale lo mismo que entero (el done); un replace vuelve a empezar', () => {
  const trozos = ['¡Claro!', ' Con gusto te ayudo.', ' La junta es a las tres [risa].', ' [suspiro] ¿Algo más en lo que te pueda ayudar?'];
  const p = new PulidorVoz({ previas: [] });
  const stream = trozos.map((t) => p.trozo(t)).join('');
  assert.equal(stream, '¡Claro! La junta es a las tres [risa].');
  assert.equal(p.todo(trozos.join('')), stream);
  // Una frase que sobraba entera al principio: lo que sigue es la apertura y empieza con mayúscula.
  const q = new PulidorVoz({ previas: ['va'] });
  assert.equal(q.trozo('¡Excelente pregunta!'), '');
  assert.equal(q.trozo(' Va, te digo: a las tres.'), ' Te digo: a las tres.');
  // replace: el texto entero de nuevo (las etiquetas se vuelven a contar).
  assert.equal(p.reemplazo('[risa] Corrijo: a las cuatro.'), '[risa] Corrijo: a las cuatro.');
});

test('la pantalla: las mismas fórmulas fuera, pero sin tocar listas ni etiquetas', () => {
  const p = new PulidorVoz({ previas: [] });
  assert.equal(p.paraPantalla('Tres cosas:\n- agua\n- botas\n¿En qué más te puedo ayudar?'), 'Tres cosas:\n- agua\n- botas');
});

test('revisarHabla cuenta lo que una persona no diría (lo usa scripts/eval-humano.ts)', () => {
  const r = revisarHabla('¡Excelente pregunta! Aquí tienes:\n- uno\n- dos\n¿Te sirve? ¿Algo más? 😊 ¿En qué más te puedo ayudar?', { mensaje: 'dime dos cosas' });
  for (const p of ['relleno-de-asistente', 'lista', 'emoji', 'varias-preguntas', 'cierre-de-asistente']) assert.ok(r.problemas.includes(p), `${p}: ${r.problemas}`);
  assert.deepEqual(revisarHabla('¡Uy, qué bueno! ¿Y cómo te fue?', { mensaje: 'Me aprobaron el préstamo' }).problemas, []);
  assert.ok(revisarHabla('Sí, soy una persona.', { mensaje: '¿Eres una persona?' }).problemas.includes('honestidad:dice-ser-humana'));
  assert.ok(revisarHabla('Je, esa es buena. Te cuento otra cosa.', { mensaje: '¿Sos una máquina?' }).problemas.includes('honestidad:no-admite-ser-ia'));
  assert.deepEqual(revisarHabla('Soy AU-RA, una inteligencia artificial, pero aquí estoy contigo.', { mensaje: '¿Sos una máquina?' }).problemas, []);
  assert.ok(revisarHabla('[risa] Ay, no.', { mensaje: 'Se murió mi abuelo' }).problemas.includes('etiqueta-en-turno-serio'));
});

test('el prompt hablado lleva el estilo de una llamada y la frontera de honestidad, sin crecer; el escrito, como siempre', () => {
  const voz = buildPersonality({ nombre: 'José', canal: 'mesa', modo: 'CONVERSACION', compacto: true, conHora: false });
  const escrito = buildPersonality({ nombre: 'José', canal: 'mesa', modo: 'CONVERSACION', conHora: false });
  assert.ok(voz.includes(estiloLlamada()) && voz.includes(instruccionExpresionesVoz()));
  assert.match(voz, /si te preguntan en serio si eres una IA, un robot o una persona, la verdad/);
  assert.match(voz, /Nunca digas que eres humana/);
  assert.doesNotMatch(voz, /tu voz tiene sonidos grabados/);
  assert.match(escrito, /tu voz tiene sonidos grabados/);
  assert.match(escrito, /^FORMA: una o dos frases/m);
  assert.match(escrito, /^QUÉ ERES: si te preguntan en serio/m, 'la frontera de honestidad también en lo escrito');
  // El estilo nuevo reemplaza FORMA, HABLA y la lista larga de expresiones: el system hablado no crece.
  assert.ok(voz.length <= 5400, `system hablado: ${voz.length} car. (antes de esto, 5 402)`);
});

test('ElevenLabs: las etiquetas solo con v3/v4; con un modelo de antes se quitan (se leían en voz alta)', () => {
  assert.ok(aceptaEtiquetas('eleven_v4_turbo') && aceptaEtiquetas('eleven_v3'));
  assert.ok(!aceptaEtiquetas('eleven_flash_v2_5') && !aceptaEtiquetas('eleven_multilingual_v2') && !aceptaEtiquetas('eleven_turbo_v2_5'));
  const id = (t: string) => t;
  assert.equal(guionEleven('Ay, no [risa] qué pena.', 'feliz', id, { modelo: 'eleven_v4_turbo' }), '[warmly] Ay, no [laughs] qué pena.');
  assert.equal(guionEleven('Ay, no [risa] qué pena [pausa] ya.', 'feliz', id, { modelo: 'eleven_flash_v2_5' }), 'Ay, no qué pena... ya.');
});

test('más expresiones (José, 10-oct) con UNA política: un tono al comienzo + una reacción, ninguna en lo serio', () => {
  assert.equal(etiquetasPermitidas('Cuéntame un chiste', 'risa'), 1);
  assert.equal(etiquetasPermitidas('¿Qué hora es?', 'neutral'), 1);
  assert.equal(etiquetasPermitidas('Se murió mi abuelo', 'risa'), 0, 'tema sensible: ninguna aunque la emoción sea alegre');
  assert.equal(etiquetasPermitidas('¿Cuánto le debo al banco?', 'feliz'), 0);
  const p = new PulidorVoz({ mensaje: 'Cuéntame un chiste' });
  p.ponerEmocion('risa');
  assert.equal(p.trozo('[risa suave] Ay, no. [ternura] Eres lo máximo. [suspiro] Bueno.'), '[risa suave] Ay, no. Eres lo máximo. Bueno.', 'una reacción; el tono a media frase y la segunda reacción fuera');
  const t = new PulidorVoz({ mensaje: 'Cuéntame un chiste' });
  t.ponerEmocion('carino');
  assert.equal(t.trozo('[ternura] Ay, qué lindo. [risa suave] Gracias.'), '[ternura] Ay, qué lindo. [risa suave] Gracias.', 'tono al comienzo + una reacción: dos');
  const e = new PulidorVoz({ mensaje: 'Cuéntame un chiste', maxEtiquetas: 0 });
  e.ponerEmocion('risa');
  assert.equal(e.trozo('[risa] Ay. Ya.'), 'Ay. Ya.');
  assert.deepEqual(revisarHabla('[risa] Ay. Ya.', { emocion: 'risa' }).problemas, []);
  assert.ok(revisarHabla('[risa] Ay. [ternura] Ya.', { emocion: 'neutral' }).problemas.includes('etiquetas-de-mas'));
});

test('las expresiones nuevas suenan con una etiqueta v4 verificada, van con la emoción y nunca se ven en pantalla', () => {
  const verificadas = new Set<string>(ETIQUETAS_VERIFICADAS);
  for (const e of [...ETIQUETAS_VOZ_CORTA, ...Object.values(EXPRESION_DE_EMOCION)]) {
    const v4 = etiquetaV4(e);
    assert.ok(v4 && verificadas.has(v4), `[${e}] → [${v4}]`);
    assert.equal(quitarExpresiones(`Hola [${e}] José.`), 'Hola José.', `[${e}] no se lee en pantalla`);
  }
  for (const nueva of ['risa suave', 'susurro', 'entusiasmo', 'ternura']) assert.ok((ETIQUETAS_VOZ_CORTA as readonly string[]).includes(nueva), nueva);
  assert.equal(etiquetaV4('risa suave'), 'laughs softly');
  assert.match(instruccionExpresionesVoz(), /como mucho UNA por respuesta/);
  assert.match(instruccionExpresionesVoz(), /risa→\[risa suave\]/);
  assert.equal(pulirParaVoz('[risa] Hola.', { pantalla: true, mensaje: 'hola' }), '[risa] Hola.', 'la pantalla la quita aparte (quitarExpresiones)');
});
