/**
 * REVISIÓN INDEPENDIENTE DE LA GUARDA DE HONESTIDAD (6-oct, sobre 10bc9fa: «no publicable»). La guarda es CONSERVADORA:
 * solo reescribe lo que AU-RA afirma claramente en primera persona que YA hizo, sin recibo; ante la duda, no toca nada.
 * Una prueba por punto (todas fallan con 10bc9fa):
 *  · G1: lo que presenta un borrador para aprobarlo («Listo, quedó así: «…». ¿Lo envío?») queda tal cual, con su cita.
 *  · G2: leer datos («Tu cita está agendada para el lunes», «Tienes 3 mensajes enviados hoy») no es afirmar nada.
 *  · M1: tras un envío real, «Perfecto, gracias» → «¡De nada! Ya se lo mandé a Ana» no se desmiente (ni por un apodo).
 *  · M2: el «¿Le escribo esto? «…»» solo se vuelve borrador si es inequívoco (a quién y qué).
 *  · M3: «Ya le avisé», «Acabo de mandarle el mensaje», "Ok, sent it"… sin recibo se corrigen.
 *  · MENOR: «Sí, mándalo…» y «No, mándalo…» seguidas no son la misma frase.
 * Datos inventados.
 */
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { _olvidarEfectos, afirmacionesDeHecho, anotarEfectoReal, efectosRecientes, guardaDeHonestidad, sinLoRespaldado, type ReciboEfecto } from '../lib/honestidad';
import { destinoPedido, propuestaDeEnvio } from '../lib/borrador-propuesto';
import { insertarTurno, mismaFrase } from '../lib/hilo-orden';

const NADA = { recibos: [] as ReciboEfecto[] };
const BORRADOR_ANA = { recibos: [] as ReciboEfecto[], borrador: { canal: 'whatsapp' as const, para: 'Ana Paz' } };

describe('G1: presentar un borrador para aprobarlo no es afirmar que salió', () => {
  const presentaciones = [
    'Listo, quedó así: «Hola Ana, llego a las 9». ¿Lo envío?',
    'Ya quedó el borrador para Ana: «Hola Ana, llego a las 9». ¿Lo envío?',
    'Lo puse más formal: «Estimada Ana, llego a las 9». ¿Lo mando?',
    '[EMO: neutral] Listo, le escribí a Ana: "Llego a las 9". ¿Te parece bien?',
    'Listo, ya quedó.\n\n«Hola Ana, llego a las 9»\n\n¿Lo envío?',
  ];
  it('con el borrador esperando, sin borrador, y con lo que pidió la persona: el texto queda entero, con su cita', () => {
    for (const t of presentaciones) {
      for (const ctx of [BORRADOR_ANA, NADA, { ...BORRADOR_ANA, mensaje: 'Ponlo más formal.' }, { ...NADA, mensaje: 'Sí.' }]) {
        const g = guardaDeHonestidad(t, ctx);
        assert.equal(g.cambiada, false, `reescribió: ${t} → ${g.texto}`);
        assert.equal(g.texto, t);
      }
      assert.deepEqual(afirmacionesDeHecho(t), [], t);
    }
  });
  it('«Ya quedó el borrador» sin pregunta tampoco afirma un envío; «Lo puse más formal.» no es un recordatorio', () => {
    assert.equal(guardaDeHonestidad('Ya quedó el borrador para Ana.', BORRADOR_ANA).cambiada, false);
    assert.equal(guardaDeHonestidad('Lo puse más formal.', NADA).cambiada, false);
  });
  it('lo que dice que SALIÓ sí se corrige, aunque después pregunte (y sin cita que presentar)', () => {
    const g = guardaDeHonestidad('Ya se lo mandé a Ana. ¿Te parece bien?', BORRADOR_ANA);
    assert.equal(g.cambiada, true);
    assert.match(g.texto, /^Todavía no lo envié: el mensaje para Ana Paz está esperando tu aprobación/);
    // Sin pregunta de aprobación, «¡Listo! Mensaje enviado a Rosa: "…"» sigue siendo falso (la prueba de 10bc9fa).
    assert.equal(guardaDeHonestidad('¡Listo! Mensaje enviado a Rosa por WhatsApp: "¿Cómo vamos?".', { ...NADA, borrador: { canal: 'whatsapp', para: 'Rosa' } }).cambiada, true);
  });
});

describe('G2: leer datos no es afirmar una acción propia', () => {
  const datos = [
    'Tienes la reunión con Pedro programada para mañana a las 10.',
    'Tu cita está agendada para el lunes.',
    'Te recuerdo que a las 3 tienes la reunión.',
    'Ya quedó claro: el oro está a 2400.',
    'Tienes 3 mensajes enviados hoy.',
    'El correo de Ana fue enviado a las 3 pm.',
    'El oro ya salió a 2400.',
    'Ana tiene la cita agendada y los correos enviados.',
    'Your meeting is scheduled for Monday.',
    "Ana's email was sent at 3 pm.",
    'Ya le llegó el correo de Ana.',
    'I told you the gold price yesterday.',
  ];
  it('ninguna es una afirmación de hecho; la guarda no las toca', () => {
    for (const t of datos) {
      assert.deepEqual(afirmacionesDeHecho(t), [], t);
      assert.equal(guardaDeHonestidad(t, { ...NADA, mensaje: '¿Qué tengo hoy?' }).cambiada, false, t);
      assert.equal(guardaDeHonestidad(t, { ...NADA, mensaje: 'Sí.' }).cambiada, false, t);
    }
  });
  it('las afirmaciones claras de AU-RA sobre lo que ella hizo siguen contando', () => {
    for (const [t, clase] of [
      ['Ya lo envié.', 'envio'],
      ['Listo, enviado tu mensaje.', 'envio'],
      ['Listo, tu WhatsApp quedó enviado.', 'envio'],
      ['Ya salió tu mensaje.', 'envio'],
      ['Te lo agendé para el lunes.', 'recordatorio'],
      ['Listo, alarma programada para las 6.', 'recordatorio'],
      ['Te puse la alarma para las 6.', 'recordatorio'],
      ['Ya le escribí a Ana.', 'envio'],
      ['Anotado.', 'guardado'],
      ['Listo, ya le llegó.', 'envio'],
    ] as const)
      assert.equal(afirmacionesDeHecho(t)[0]?.clase, clase, t);
  });
});

describe('M1: lo que de verdad salió hace poco no se desmiente si la persona agradece o confirma', () => {
  beforeEach(() => _olvidarEfectos());
  const t0 = 1_800_000_000_000;

  it('«Perfecto, gracias» → «¡De nada! Ya se lo mandé a Ana.» queda (también «Ok», «Genial», «Listo»)', () => {
    anotarEfectoReal('ana-dueno@x.test', { canal: 'whatsapp', estado: 'confirmado', destino: 'Ana Paz +50477770000' }, t0);
    const previos = efectosRecientes('ana-dueno@x.test', t0 + 60_000);
    for (const mensaje of ['Perfecto, gracias', 'Ok', 'Genial, gracias.', 'Listo', 'Sí, gracias', 'Gracias por mandarlo'])
      assert.equal(guardaDeHonestidad('¡De nada! Ya se lo mandé a Ana.', { recibos: [], previos, mensaje, anterior: 'Listo, mensaje enviado a Ana Paz.', ahora: t0 + 60_000 }).cambiada, false, mensaje);
    // sinLoRespaldado (la corrección de «prometió sin herramienta») tampoco lo cuenta como promesa.
    assert.equal(sinLoRespaldado('¡De nada! Ya se lo mandé a Ana.', { recibos: [], previos, mensaje: 'Perfecto, gracias', ahora: t0 + 60_000 }).trim(), '¡De nada!');
  });

  it('un apodo («Papá» con el recibo de «Viejo») o un nombre de menos de 3 letras («Bo») no desmienten un envío real', () => {
    anotarEfectoReal('dueno@x.test', { canal: 'whatsapp', estado: 'confirmado', destino: 'Viejo +50477771234' }, t0);
    anotarEfectoReal('dueno@x.test', { canal: 'whatsapp', estado: 'confirmado', destino: 'Bo' }, t0);
    const previos = efectosRecientes('dueno@x.test', t0 + 60_000);
    assert.equal(guardaDeHonestidad('Sí, ya se lo mandé a Papá.', { recibos: [], previos, mensaje: '¿Ya le escribiste a mi papá?', ahora: t0 + 60_000 }).cambiada, false);
    assert.equal(guardaDeHonestidad('Listo, mensaje enviado a Papá.', { recibos: [{ canal: 'whatsapp', estado: 'confirmado', destino: 'Viejo +50477771234' }], mensaje: 'Sí, enviarlo.' }).cambiada, false);
    assert.equal(guardaDeHonestidad('Ya se lo mandé a Bo.', { recibos: [], previos, mensaje: 'Gracias', ahora: t0 + 60_000 }).cambiada, false);
  });

  it('pero lo nuevo sí se juzga por este turno: un «sí» a lo que AU-RA ofrecía, un borrador esperando, lo viejo o OTRA persona', () => {
    anotarEfectoReal('ana-dueno@x.test', { canal: 'whatsapp', estado: 'confirmado', destino: 'Ana Paz +50477770000' }, t0);
    const previos = efectosRecientes('ana-dueno@x.test', t0 + 60_000);
    // «Sí» a «¿Le mando otro a Ana?»: aprueba algo nuevo, y nada salió en este turno.
    assert.equal(guardaDeHonestidad('Listo, ya se lo mandé a Ana.', { recibos: [], previos, mensaje: 'Sí.', anterior: '¿Le mando otro a Ana para confirmar?', ahora: t0 + 60_000 }).cambiada, true);
    assert.equal(guardaDeHonestidad('Ya se lo mandé a Ana.', { recibos: [], previos, mensaje: 'Perfecto, gracias', borrador: { canal: 'whatsapp', para: 'Ana Paz' }, ahora: t0 + 60_000 }).cambiada, true);
    // Agradecer vale para lo de los últimos 10 minutos (preguntar, 20).
    const tarde = efectosRecientes('ana-dueno@x.test', t0 + 15 * 60_000);
    assert.equal(guardaDeHonestidad('¡De nada! Ya se lo mandé a Ana.', { recibos: [], previos: tarde, mensaje: 'Perfecto, gracias', ahora: t0 + 15 * 60_000 }).cambiada, true);
    assert.equal(guardaDeHonestidad('Sí, ya se lo mandé a Ana.', { recibos: [], previos: tarde, mensaje: '¿Ya se lo mandaste?', ahora: t0 + 15 * 60_000 }).cambiada, false);
    // Un nombre de verdad que no es el del recibo: salió, pero a otra persona (y eso se dice, no «todavía no»).
    assert.equal(guardaDeHonestidad('Ya se lo mandé a Rosa.', { recibos: [], previos, mensaje: 'Gracias', ahora: t0 + 60_000 }).cambiada, true);
    const otra = guardaDeHonestidad('Listo, mensaje enviado a Rosa.', { recibos: [{ canal: 'whatsapp', estado: 'confirmado', destino: 'Padrino +50488881111' }], mensaje: 'Sí, enviarlo.' });
    assert.equal(otra.texto, 'Lo envié, pero a Padrino, no a Rosa.');
    assert.equal(guardaDeHonestidad(otra.texto, { recibos: [{ canal: 'whatsapp', estado: 'confirmado', destino: 'Padrino +50488881111' }], mensaje: 'Sí, enviarlo.' }).cambiada, false);
  });
});

describe('M2: el borrador convertido solo cuando la propuesta es inequívoca', () => {
  const hiloViejo = [
    { role: 'user', content: 'Mándele un mensaje a mi viejo por WhatsApp.' },
    { role: 'assistant', content: '¿Qué le digo?' },
    { role: 'user', content: 'Que cómo vamos.' },
    { role: 'assistant', content: 'Listo, quedó el borrador para Viejo.' },
    { role: 'user', content: '¿Cómo está el oro?' },
    { role: 'assistant', content: 'Está a 2400.' },
    { role: 'user', content: '¿Algo nuevo en WhatsApp?' },
  ];
  it('nunca una cita de otro, nunca «te mando» (la persona), nunca un número como destino, nunca un pedido viejo', () => {
    assert.equal(propuestaDeEnvio('Juan te escribió «¿llegas hoy?». ¿Le mando un mensaje para avisarle?', { mensaje: '¿Qué me escribió Juan?', hilo: hiloViejo }), null);
    assert.equal(propuestaDeEnvio('«¿Llegas hoy?», te escribió Juan. ¿Le escribo algo?', { mensaje: '¿Qué dice?', hilo: [{ role: 'user', content: 'escríbele a Juan' }] }), null);
    assert.equal(propuestaDeEnvio('Tu mamá dijo «compra pan». ¿Te lo anoto o le escribo algo?', { mensaje: '¿Qué dijo mi mamá?', hilo: [{ role: 'user', content: 'escríbele a Pedro que ya voy' }, { role: 'assistant', content: '¿Le escribo esto? «Ya voy»' }] }), null);
    assert.equal(propuestaDeEnvio('¿Te mando el resumen así? «Oro 2400, plata 31»', { mensaje: 'Resúmeme el día.', hilo: [{ role: 'user', content: 'mándale el reporte a Carlos' }, { role: 'assistant', content: '¿Algo más?' }] }), null);
    assert.equal(propuestaDeEnvio('¿Le escribo esto? «Llego a las 9»', { mensaje: 'No, mejor dile que llego a las 9.' }), null);
    assert.equal(destinoPedido('No, mejor dile que llego a las 9.'), null);
    assert.equal(destinoPedido('Mándale a las 9 el reporte'), null);
    // El pedido de «viejo» quedó atrás (otra charla en medio): no se usa para una propuesta nueva.
    assert.equal(propuestaDeEnvio('¿Le escribo esto? «Ya voy»', { mensaje: 'Contéstale que ya voy.', hilo: hiloViejo }), null);
  });
  it('lo inequívoco sí: a quién en la misma propuesta, o en el último pedido de la persona de este hilo', () => {
    assert.deepEqual(propuestaDeEnvio('¿Le escribo a Ana: «Llego a las 9»?', { mensaje: 'Sí.' }), { canal: 'whatsapp', destino: 'Ana', texto: 'Llego a las 9' });
    assert.deepEqual(propuestaDeEnvio('¿Le mando esto a Beto?: «Ya voy»', { mensaje: 'Ok.' }), { canal: 'whatsapp', destino: 'Beto', texto: 'Ya voy' });
    assert.deepEqual(propuestaDeEnvio('¿Le escribo esto? «Llego a las 9»', { mensaje: 'No, mejor dile que llego a las 9.', hilo: [{ role: 'user', content: 'Escríbele a mi viejo que llego a las 8.' }, { role: 'assistant', content: '¿Le escribo esto? «Llego a las 8»' }] }), { canal: 'whatsapp', destino: 'viejo', texto: 'Llego a las 9' });
  });
});

describe('M3: las formas que se colaban', () => {
  it('sin recibo, cada una se corrige; con el recibo, quedan', () => {
    for (const t of ['Ya le avisé.', 'Ya le dije.', 'Acabo de mandarle el mensaje.', 'Ya se lo hice llegar.', 'Le he escrito a Ana.', 'Ok, sent it.', 'All set, sent.', 'Ya le avisé a Ana por WhatsApp.']) {
      assert.equal(afirmacionesDeHecho(t)[0]?.clase, 'envio', t);
      const g = guardaDeHonestidad(t, { ...NADA, mensaje: 'Avísale a Ana que llego tarde.', idioma: /sent/.test(t) ? 'en' : 'es' });
      assert.equal(g.cambiada, true, t);
      assert.match(g.texto, /^(Todavía no lo envié|I haven't sent it)/, t);
      assert.equal(guardaDeHonestidad(t, { recibos: [{ canal: 'whatsapp', estado: 'confirmado', destino: 'Ana +50477770000' }], mensaje: 'Sí.' }).cambiada, false, t);
    }
  });
  it('sin romper G2: «Te dije que el oro está a 2400» (a la persona) y «Le dije a Ana que…» dicho por otro no', () => {
    assert.deepEqual(afirmacionesDeHecho('Ya te dije que el oro está a 2400.'), []);
    assert.deepEqual(afirmacionesDeHecho('Ana dijo que ya le avisó a Pedro.'), []);
    assert.deepEqual(afirmacionesDeHecho('Acabo de decirte lo del oro.'), []);
  });
});

describe('MENOR: la frase entera', () => {
  it('«Sí, mándalo…» y «No, mándalo…» son dos frases; las dos quedan en el hilo', () => {
    assert.equal(mismaFrase('Sí, mándalo ya por favor.', 'No, mándalo ya por favor.'), false);
    assert.equal(mismaFrase('Ya mándalo a Beto ahora.', 'No mándalo a Beto ahora.'), false);
    // La primera palabra mal oída que rima sigue siendo la misma frase (José, 6-oct).
    assert.equal(mismaFrase('Vamos entonces, ¿ya lo guardaste?', 'Estamos entonces, ¿ya lo guardaste?'), true);
    const t0 = 1_000_000;
    const h = insertarTurno([{ rol: 'user', texto: 'Sí, mándalo ya por favor.', t: t0 }], { rol: 'user', texto: 'No, mándalo ya por favor.', t: t0 + 2_000 }, 50);
    assert.deepEqual(h?.map((x) => x.texto), ['Sí, mándalo ya por favor.', 'No, mándalo ya por favor.']);
  });
});

describe('revisión de 78ac7c2: lo que dice que salió nunca se perdona; preguntar sin «¿» no desmiente lo hecho', () => {
  beforeEach(() => _olvidarEfectos());
  const t0 = 1_800_000_000_000;
  it('«Listo, se lo mandé: «…». ¿Lo dejo así?» sin recibo se corrige (la cita no perdona un envío)', () => {
    const ctx = { recibos: [] as ReciboEfecto[], borrador: { canal: 'whatsapp' as const, para: 'Viejo' }, mensaje: 'Sí, enviarlo.' };
    for (const t of ['Listo, se lo mandé: «Viejo, ¿cómo vamos?». ¿Lo dejo así?', '¡Listo! Mensaje enviado a tu viejo: «¿Cómo vamos?». ¿Te parece bien?', 'Le mandé esto a tu viejo: «¿Cómo vamos?». ¿Está bien así?'])
      assert.equal(guardaDeHonestidad(t, ctx).cambiada, true, t);
    // Presentar sigue intacto.
    assert.equal(guardaDeHonestidad('Listo, quedó así: «Viejo, ¿cómo vamos?». ¿Lo envío?', ctx).cambiada, false);
  });
  it('tras un envío real, «ya se lo mandaste» / «entonces ya le escribiste a mi viejo» sin «¿» no desmiente', () => {
    anotarEfectoReal('dueno2@x.test', { canal: 'whatsapp', estado: 'confirmado', destino: 'Viejo +50477771234' }, t0);
    const previos = efectosRecientes('dueno2@x.test', t0 + 60_000);
    for (const mensaje of ['ya se lo mandaste', 'Va, ya lo mandaste', 'entonces ya le escribiste a mi viejo'])
      assert.equal(guardaDeHonestidad('Sí, ya se lo mandé a tu viejo.', { recibos: [], previos, mensaje, ahora: t0 + 60_000 }).cambiada, false, mensaje);
    // Pedir otro sí es nuevo: sin recibo de este turno, se corrige.
    assert.equal(guardaDeHonestidad('Listo, ya se lo mandé a tu viejo.', { recibos: [], previos, mensaje: 'mándaselo otra vez', ahora: t0 + 60_000 }).cambiada, true);
  });
  it('«¡Hecho! Ya le llegó a Ana.» sin recibo se corrige entero (no queda «Todavía no lo hice. Ya le llegó a Ana.»)', () => {
    const g = guardaDeHonestidad('¡Hecho! Ya le llegó a Ana.', { recibos: [], mensaje: 'Mándale a Ana que llego tarde.' });
    assert.equal(g.cambiada, true);
    assert.doesNotMatch(g.texto, /Ya le llegó a Ana/);
    assert.equal(guardaDeHonestidad('Ya le llegó el correo de Ana.', NADA).cambiada, false, 'leer un dato');
  });
});
