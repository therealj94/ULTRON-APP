/**
 * REVISIÓN INDEPENDIENTE DE a000e04 (7-oct, «no publicable»): las piezas sin servidor (el turno entero:
 * tests/mesa-revision-g1g2-servidor.test.ts). Principio: ante la duda, la guarda NO actúa; nunca decir algo falso.
 * Frases, nombres, precios y citas inventados.
 *
 *  G1. lib/repeticion.ts: una respuesta CORREGIDA o ACTUALIZADA (el borrador de «hoy» a «mañana», «agrégale perdón», el
 *      oro de 2.450 a 2.460, la cita del lunes al martes, dos correos a tres) no es repetición; un borrador nunca se toca;
 *      solo se quitan frases idénticas o casi idénticas con los mismos datos; «ya te lo dije» ya no existe.
 *  G2. mobile/src/lib/fraseNueva.ts y lib/conversacion.ts: «¿hola?», «¿me oyes?» o un «ajá» mientras piensa no cortan; un
 *      turno con un envío en curso no se corta; la frase cortada va como parte del pedido nuevo (no «no lo contestes»),
 *      salvo una orden de cambio de avatar tardía; los turnos de relleno no dejan tardío al de antes (lib/acciones-app.ts).
 *  M1. lib/abiertos.ts: «¿cómo va todo?», «eso es todo», «gracias por todo», «lo que queda del día», «¿qué falta para
 *      llegar?» no preguntan por pendientes.
 *  M2. pideRepetir: «¿me lo repites?», «¿me repites?», «¿cómo?», «¿perdón?», «repíteme eso», «vuelve a decirlo», «no te
 *      oí», «otra vez».
 *  M3. lib/conversacion.ts: un turno que SÍ contestó (sin quedar en la memoria, AUR07) no sale como «sin respuesta».
 *  MENOR: WhatsApp con «pregúntale…» y «whats»; «sí, pásame con Claudio», «sí, cámbiame», «sí quiero» aceptan; en el
 *      stream una frase repetida suelta no retiene el resto (vaRepitiendo).
 *
 * Con a000e04 falla cada bloque (lo comprueba la nota del commit). Se corre con NODE_ENV=test y sin él.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

const R = await import('../lib/repeticion');
const A = await import('../lib/abiertos');
const C = await import('../lib/conversacion');
const F = await import('../mobile/src/lib/fraseNueva');
const AA = await import('../lib/acciones-app');
const { herramientaFueraDeTema } = await import('../lib/cerebro-manos');

/** Lo que el revisor probó (sus scripts probe2.ts): la respuesta nueva corrige o actualiza la anterior. */
const CORRECCIONES: Array<[string, string, string]> = [
  ['Le escribo a Beto: “Llego tarde a la reunión de mañana”. ¿Lo envío?', 'Le escribo a Beto: “Llego tarde a la reunión de hoy”. ¿Lo envío?', 'no, que es la de mañana'],
  ['Le escribo a Beto: “Llego tarde a la reunión de las cinco, perdón”. ¿Lo envío?', 'Le escribo a Beto: “Llego tarde a la reunión de las cinco”. ¿Lo envío?', 'agrégale perdón'],
  ['El oro está a 2.460 dólares la onza ahora mismo, subió un uno por ciento desde ayer.', 'El oro está a 2.450 dólares la onza ahora mismo, subió un uno por ciento desde ayer.', '¿y ahora cuánto?'],
  ['Tu cita con el dentista es el martes a las cuatro de la tarde en la clínica.', 'Tu cita con el dentista es el lunes a las cuatro de la tarde en la clínica.', 'pásala al martes'],
  ['Tienes tres correos nuevos: uno de Ana sobre el contrato, otro de Beto y uno del banco.', 'Tienes dos correos nuevos: uno de Ana sobre el contrato, otro de Beto y uno del banco.', 'revisa'],
];

const PARRAFO =
  'Je, sí, me cambié de ropa. Era Aura, ahora soy Claudio, el mismo cerebro con otro traje. Y de lo que quedó: tienes la reunión con la cooperativa el jueves y faltaba revisar las cuentas del molino antes de esa fecha.';

describe('G1) la guarda de repetición no borra lo corregido ni lo actualizado', () => {
  it('cada corrección del revisor queda entera (con y sin lo que dijo la persona)', () => {
    for (const [nueva, vieja, mensaje] of CORRECCIONES) {
      for (const o of [{ mensaje }, {}]) {
        const g = R.guardaRepeticion(nueva, [vieja], o);
        assert.equal(g.repite, false, `${nueva} (${JSON.stringify(o)})`);
        assert.equal(g.vacia, false);
        assert.equal(g.texto, nueva);
      }
    }
  });

  it('la frase cambiada se queda aunque las demás sí se repitan (solo lo idéntico, con los mismos datos, se va)', () => {
    const vieja = 'El oro está a 2.450 dólares la onza ahora mismo en Nueva York. La plata sigue igual que la semana pasada en el mercado. El cobre bajó un poco en la sesión.';
    const nueva = 'El oro está a 2.460 dólares la onza ahora mismo en Nueva York. La plata sigue igual que la semana pasada en el mercado. El cobre bajó un poco en la sesión.';
    const g = R.guardaRepeticion(nueva, [vieja]);
    assert.equal(g.repite, false, 'cambió el precio: es una actualización');
    assert.match(g.texto, /2\.460/);
  });

  it('un borrador nunca se toca, ni repetido tal cual', () => {
    const b = 'Le escribo a Beto: «Llego tarde a la reunión de hoy». ¿Lo envío?';
    assert.equal(R.guardaRepeticion(b, [b]).repite, false);
    assert.equal(R.guardaRepeticion(PARRAFO, [PARRAFO], { conBorrador: true }).repite, false, 'quien llama dice que el turno tiene borrador');
    assert.equal(R.guardaRepeticion(`${PARRAFO}\nACCION_APP: {"tipo":"atras"}`, [PARRAFO]).repite, false, 'con una acción para la app');
  });

  it('lo de siempre sigue: el mismo párrafo a otra frase repite; con algo nuevo queda solo lo nuevo', () => {
    const g = R.guardaRepeticion(PARRAFO, ['Perdón, ya volví.', PARRAFO], { mensaje: 'Me cambió a Claudio.' });
    assert.equal(g.repite, true);
    assert.equal(g.vacia, true);
    const n = R.guardaRepeticion(`${PARRAFO} Por cierto, el clima de hoy está despejado en Comayagua.`, [PARRAFO]);
    assert.equal(n.repite, true);
    assert.equal(n.texto, 'Por cierto, el clima de hoy está despejado en Comayagua.');
  });

  it('si de la respuesta solo queda el saludo («Claro que sí, José.»), cuenta como vacía: no suena solo el saludo', () => {
    // Revisión de 23b2f5f: vuelve a preguntar con otras palabras, contesta lo mismo con un saludo delante.
    const g = R.guardaRepeticion(`Claro que sí, José. ${PARRAFO}`, [PARRAFO], { mensaje: '¿A qué hora era lo del dentista?' });
    assert.equal(g.repite, true);
    assert.equal(g.vacia, true, 'el saludo solo no es una respuesta');
    assert.equal(g.texto, '');
  });

  it('nunca «ya te lo dije»: la frase fija se fue y la segunda vuelta no puede decirlo', () => {
    assert.equal((R as Record<string, unknown>).respuestaBreveSinRepetir, undefined, 'la frase «Eso ya te lo dije» ya no existe');
    assert.doesNotMatch(R.notaNoRepetir('es'), /Si no hay nada nuevo, dilo/);
    assert.equal(R.diceQueYaLoDijo('Eso ya te lo dije hace un momento. ¿Qué necesitas ahora?'), true);
    assert.equal(R.diceQueYaLoDijo('I already told you that.'), true);
    assert.equal(R.diceQueYaLoDijo('Perdón, me repetí. Dime qué necesitas ahora.'), false);
  });

  it('el «2.460» no parte la frase en el punto', () => {
    assert.deepEqual(R.frasesDe('El oro está a 2.460 dólares. Sube.'), ['El oro está a 2.460 dólares. ', 'Sube.']);
  });
});

describe('MENOR) en el stream, una frase repetida suelta no retiene el resto', () => {
  it('solo va repitiendo si la respuesta entera va camino de ser repetición', () => {
    const vieja = 'Tienes la reunión con la cooperativa el jueves a las diez de la mañana en la planta.';
    const repetida = 'Tienes la reunión con la cooperativa el jueves a las diez de la mañana en la planta. ';
    assert.equal(R.vaRepitiendo(repetida, [vieja]), true, 'por ahora solo lo repetido: espera');
    const conNuevo = `${repetida}Por cierto, el clima de hoy está despejado. También llegó la factura de la luz al correo.`;
    assert.equal(R.vaRepitiendo(conNuevo, [vieja]), false, 'lo que sigue es nuevo: se suelta');
    assert.equal(R.vaRepitiendo(repetida, [vieja], { conBorrador: true }), false, 'con borrador nunca');
  });
});

describe('M2) pedir que repita', () => {
  it('se reconoce (y entonces la guarda no actúa)', () => {
    for (const m of ['¿me lo repites?', '¿me repites?', '¿cómo?', '¿perdón?', 'repíteme eso', 'vuelve a decirlo', 'no te oí', 'otra vez', '¿qué?', 'léemelo', '¿cuáles eran?', 'no entiendo, cómo era']) {
      assert.equal(R.pideRepetir(m), true, m);
      assert.equal(R.guardaRepeticion(PARRAFO, [PARRAFO], { mensaje: m }).repite, false, m);
    }
    for (const m of ['Me cambió a Claudio.', '¿Cómo estás?', '¿Qué tenemos pendiente?']) assert.equal(R.pideRepetir(m), false, m);
  });
});

describe('M1) preguntar por pendientes, solo lo explícito', () => {
  it('lo del revisor no cuenta; las preguntas de verdad sí', () => {
    for (const m of ['¿Cómo va todo?', 'eso es todo, gracias', 'todo bien', 'gracias por todo', 'lo que queda del día', '¿qué quedó del partido?', '¿qué falta para llegar?']) {
      assert.equal(A.preguntaPorPendientes(m), false, m);
    }
    for (const m of ['¿Qué tenemos pendiente?', '¿qué me falta?', '¿qué tareas tengo?', '¿qué nos falta por hacer?', '¿qué quedó a medias?', '¿en qué quedamos?', '¿qué tengo que hacer hoy?']) {
      assert.equal(A.preguntaPorPendientes(m), true, m);
    }
  });
});

describe('G2) la frase oída mientras piensa', () => {
  it('relleno o sondeo: no corta y no se manda', () => {
    for (const cmd of ['¿Hola?', '¿Me oyes?', 'ajá', 'mmm', '¿sigues ahí?']) {
      assert.deepEqual(F.fraseDuranteTurno({ cmd, pendiente: null, pensando: true, hablando: false }), { cortar: false, pendiente: '', descartada: true }, cmd);
    }
  });

  it('con un envío en curso nada corta; una frase nueva de verdad sí corta sin él', () => {
    assert.equal(F.fraseDuranteTurno({ cmd: '¿Qué tenemos pendiente?', pendiente: null, pensando: true, hablando: false, efecto: true }).cortar, false);
    assert.equal(F.fraseDuranteTurno({ cmd: '¿Qué tenemos pendiente?', pendiente: null, pensando: true, hablando: false }).cortar, true);
  });

  it('la frase cortada va como parte del pedido nuevo (no «no lo contestes»); la orden de avatar tardía se descarta', () => {
    const nota = C.notaSinRespuesta(['¿Cómo va la planta de beneficio?']);
    assert.match(nota, /Antes dijo esto y todavía no le contestaste: «¿Cómo va la planta de beneficio\?»/);
    assert.match(nota, /contesta lo que corresponda a todo junto/);
    assert.doesNotMatch(nota, /no lo contestes|Ya pasó/);
    const conAvatar = C.notaSinRespuesta(['Oye, ¿me cambias al avatar de Claudio?', '¿Cómo va la planta?']);
    assert.match(conAvatar, /Lo de cambiar de avatar \(«Oye, ¿me cambias al avatar de Claudio\?»\) quedó atrás: no lo hagas ni lo preguntes/);
    assert.equal(C.avatarQuedoAtras([{ role: 'user', content: conAvatar }]), true);
    assert.equal(C.avatarQuedoAtras([{ role: 'user', content: nota }]), false);
  });

  it('en el servidor, un turno de relleno después no deja tardío al de antes; uno de verdad, sí', () => {
    AA._reiniciarAccionesApp();
    const amb = 'persona.relleno@prueba.hn';
    const n = AA.abrirTurnoApp(amb);
    const m = AA.abrirTurnoApp(amb);
    AA.marcarTurnoRelleno(amb, m);
    assert.equal(F.esFraseDeRelleno('¿Me oyes?'), true);
    assert.equal(AA.turnoAppVigente(amb, n), true, '«¿me oyes?» no lo deja tardío');
    AA.abrirTurnoApp(amb);
    assert.equal(AA.turnoAppVigente(amb, n), false, 'una frase de verdad, sí');
  });
});

describe('M3) lo que sí contestó sin quedar en la memoria no sale como «sin respuesta»', () => {
  it('fusionarHilo pone la respuesta en su lugar y no hay nota', () => {
    C._olvidarRespuestasSinMemoria();
    const quien = 'persona.m3@prueba.hn';
    C.anotarRespuestaSinMemoria(quien, '¿Qué me escribió Marisol por WhatsApp?', 'No pude abrir el chat de Marisol ahora; ¿lo intento otra vez?');
    const durable = [
      { rol: 'user', texto: 'Hola' },
      { rol: 'ultron', texto: 'Hola, aquí estoy.' },
      { rol: 'user', texto: '¿Qué me escribió Marisol por WhatsApp?' },
      { rol: 'user', texto: '¿Y el clima?' },
    ];
    const hilo = C.fusionarHilo({ durable, mensaje: '¿Y el clima?', respondidas: C.respuestasSinMemoria(quien) });
    assert.deepEqual(
      hilo.map((m) => m.role),
      ['user', 'assistant', 'user', 'assistant']
    );
    assert.equal(hilo[3].content, 'No pude abrir el chat de Marisol ahora; ¿lo intento otra vez?');
    assert.doesNotMatch(JSON.stringify(hilo), /Antes dijo esto/);
    // Sin respuesta de verdad, la nota sí.
    const sin = C.fusionarHilo({ durable, mensaje: '¿Y el clima?' });
    assert.match(sin.at(-1)!.content, /^\(Antes dijo esto/);
  });
});

describe('MENOR) WhatsApp con «pregúntale» y «whats»; el «sí» al avatar con más palabras', () => {
  it('herramientaFueraDeTema deja correr lo que sí habla de mensajes', () => {
    assert.equal(herramientaFueraDeTema('whatsapp', { chat: 'Carlos' }, { mensaje: 'pregúntale a mi hermano a qué hora llega' }), null);
    assert.equal(herramientaFueraDeTema('whatsapp', { accion: 'revisar' }, { mensaje: '¿qué hay de nuevo en whats?' }), null);
    assert.equal(herramientaFueraDeTema('whatsapp', { chat: 'Pedro' }, { mensaje: 'sí, hazlo', anterior: '¿Le digo a Pedro que sí?', afirma: true }), null);
    assert.ok(herramientaFueraDeTema('whatsapp', { chat: 'Marisol' }, { mensaje: 'Me cambió a Claudio.' }));
  });

  it('«sí, pásame con Claudio», «sí, cámbiame», «sí quiero» cambian; otro nombre, no', () => {
    const prop = { valor: 'claudio' as const, antes: 'aura' as const };
    for (const t of ['sí, pásame con Claudio', 'sí, cámbiame', 'sí quiero', 'claro, ponme a Claudio']) {
      const r = AA.ordenPorReglas(t, { avatarActual: 'aura', avatarPropuesto: prop } as any);
      assert.deepEqual(r?.accion, { tipo: 'avatar', valor: 'claudio' }, t);
    }
    assert.notDeepEqual(AA.ordenPorReglas('sí, pásame con Antonio', { avatarActual: 'aura', avatarPropuesto: prop } as any)?.accion, { tipo: 'avatar', valor: 'claudio' });
    assert.equal(AA.ordenPorReglas('no, quédate', { avatarActual: 'aura', avatarPropuesto: prop } as any)?.decir, 'Va, sigo yo.');
  });
});
