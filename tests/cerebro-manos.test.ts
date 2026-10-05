/**
 * Las manos como herramientas (lib/cerebro-manos.ts): qué herramientas tiene cada turno y que cada llamada
 * se vuelva EXACTAMENTE la línea que el resto del servidor ya sabe validar y correr.
 */
import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { herramientasDelTurno, lineaDeHerramienta, reglasDeManos, topeDeVoz, TOPE_VOZ_CHARS, type ManosDelTurno } from '../lib/cerebro-manos';
import { extraerAcciones, validarAccion } from '../lib/acciones-app';
import { extraerPedidoHerramienta } from '../lib/harness';
import { confirmaPropuesta, esAfirmacionSola, RECORDATORIO_MIN_MS } from '../lib/manos-app';

const AHORA = Date.UTC(2026, 9, 4, 4, 8); // 3-oct 22:08 en Honduras
// El reloj se fija en AHORA: el código descarta los recordatorios vencidos, y con el reloj real estas
// fechas fijas vencen solas y la prueba se rompe el día después de escrita.
mock.timers.enable({ apis: ['Date'], now: AHORA });
const nombres = (d: ManosDelTurno) => herramientasDelTurno(d).map((t) => t.toolSpec!.name);
const nada: ManosDelTurno = { app: false, manos: [], sistema: false, computadora: false, correo: false, whatsapp: false, sesion: false, triaje: false };

/** La acción de la app que sale de una línea, ya validada como la valida el servidor. */
function accionDe(linea: string | null) {
  assert.ok(linea, 'sin línea');
  // Extraer y validar miran el reloj (un recordatorio en el pasado no vale): se hace en el mismo AHORA de la prueba,
  // no en la hora real (antes, pasada esa hora, «en 30 s» caía en el pasado y la prueba fallaba sola).
  const real = Date.now;
  Date.now = () => AHORA;
  try {
    const { acciones, texto } = extraerAcciones(`Va.\n${linea}`);
    assert.equal(texto.trim(), 'Va.', 'la línea no se dice');
    assert.equal(acciones.length, 1);
    return validarAccion(acciones[0]);
  } finally {
    Date.now = real;
  }
}

test('cada turno tiene solo las herramientas que puede usar', () => {
  // La web sin teléfono ni sesión: buscar y leer, nada de la app.
  assert.deepEqual(nombres(nada), ['buscar_web', 'leer_pagina']);
  // El teléfono con sus manos y la cuenta con todo.
  const todo = nombres({ app: true, manos: ['llamar', 'leer', 'buscar', 'idioma', 'perfil', 'recordatorio', 'llamame', 'cartera', 'pagar'], sistema: true, computadora: true, correo: true, whatsapp: true, sesion: true, triaje: true });
  for (const n of ['abrir_pantalla', 'ajustar_app', 'chat_aura', 'llamar_contacto', 'llamarme', 'recordatorio', 'leer_mensajes', 'buscar_en_chats', 'cambiar_idioma', 'recordar_de_mi', 'abrir_cartera', 'preparar_pago', 'estado_sistema', 'computadora', 'correo', 'whatsapp', 'tarea', 'mision', 'circulo', 'cartera_saldo', 'ordenar_mensajes'])
    assert.ok(todo.includes(n), n);
  // Un APK viejo (sin manos): la app sí, llamar y recordar no.
  const viejo = nombres({ ...nada, app: true });
  assert.ok(viejo.includes('abrir_pantalla'));
  assert.ok(!viejo.includes('llamar_contacto') && !viejo.includes('llamarme') && !viejo.includes('recordatorio'));
  // Mismo turno, mismas herramientas en el mismo orden.
  assert.deepEqual(nombres({ ...nada, app: true, manos: ['llamar'] }), nombres({ ...nada, app: true, manos: ['llamar'] }));
});

test('«llámame en 30 segundos» (la llamada de José del 3-oct) es una llamada de AU-RA en 30 s, no «eso es un recordatorio»', (t) => {
  // El reloj del validador (cuandoValido) es el de la prueba: con el de la máquina, una hora fija ya pasada no vale.
  t.mock.method(Date, 'now', () => AHORA);
  const a = accionDe(lineaDeHerramienta('llamarme', { en_segundos: 30 }, AHORA));
  assert.deepEqual(a, { tipo: 'recordatorio', texto: 'Te llamo como me pediste', cuando: AHORA + 30_000, llamada: true });
  // Con motivo, lo dice al llamar; en diez minutos.
  assert.deepEqual(accionDe(lineaDeHerramienta('llamarme', { en_segundos: 600, motivo: 'Lo del banco' }, AHORA)), { tipo: 'recordatorio', texto: 'Lo del banco', cuando: AHORA + 600_000, llamada: true });
  // «en 5 segundos»: en cuanto el teléfono lo acepta, no se pierde.
  const pronto = accionDe(lineaDeHerramienta('llamarme', { en_segundos: 5 }, AHORA)) as { cuando: number };
  assert.ok(pronto && pronto.cuando >= AHORA + RECORDATORIO_MIN_MS);
  // Sin segundos: ahora mismo.
  assert.deepEqual(accionDe(lineaDeHerramienta('llamarme', {}, AHORA)), { tipo: 'llamame' });
});

test('las manos del teléfono salen con la forma del contrato de la app', (t) => {
  t.mock.method(Date, 'now', () => AHORA);
  assert.deepEqual(accionDe(lineaDeHerramienta('llamar_contacto', { contacto: 'Beto' })), { tipo: 'llamar', con: 'Beto', video: false });
  assert.deepEqual(accionDe(lineaDeHerramienta('llamar_contacto', { contacto: 'Ana', video: true })), { tipo: 'llamar', con: 'Ana', video: true });
  assert.deepEqual(accionDe(lineaDeHerramienta('recordatorio', { accion: 'poner', cuando: '2026-10-04T17:00', texto: 'Llamar al banco' }, AHORA)), {
    tipo: 'recordatorio',
    texto: 'Llamar al banco',
    cuando: Date.UTC(2026, 9, 4, 23, 0),
    llamada: true,
  });
  // Sin la mano «llamame», el recordatorio es un aviso normal.
  assert.deepEqual(accionDe(lineaDeHerramienta('recordatorio', { accion: 'poner', cuando: '2026-10-04T17:00', texto: 'Pastilla' }, AHORA, { conLlamada: false })), { tipo: 'recordatorio', texto: 'Pastilla', cuando: Date.UTC(2026, 9, 4, 23, 0) });
  assert.deepEqual(accionDe(lineaDeHerramienta('abrir_pantalla', { pantalla: 'ajustes' })), { tipo: 'abrir', pantalla: 'ajustes' });
  assert.deepEqual(accionDe(lineaDeHerramienta('ajustar_app', { cambio: 'tema_oscuro' })), { tipo: 'tema', valor: 'oscuro' });
  assert.deepEqual(accionDe(lineaDeHerramienta('ajustar_app', { cambio: 'avatar_guardian' })), { tipo: 'avatar', valor: 'ojos' });
  assert.deepEqual(accionDe(lineaDeHerramienta('chat_aura', { accion: 'redactar', con: 'Beto', texto: 'Llego tarde' })), { tipo: 'redactar', para: 'Beto', texto: 'Llego tarde' });
  assert.deepEqual(accionDe(lineaDeHerramienta('leer_mensajes', {})), { tipo: 'leer' });
  assert.deepEqual(accionDe(lineaDeHerramienta('recordar_de_mi', { campo: 'apodo', valor: 'Chepe' })), { tipo: 'perfil', campo: 'apodo', valor: 'Chepe' });
});

test('lo que corre el servidor sale como el pedido de siempre del harness', () => {
  const ped = (l: string | null) => extraerPedidoHerramienta(String(l));
  assert.deepEqual(ped(lineaDeHerramienta('buscar_web', { consulta: 'precio del oro hoy' })), { herramienta: 'web', arg: 'precio del oro hoy' });
  assert.deepEqual(ped(lineaDeHerramienta('correo', { accion: 'revisar' })), { herramienta: 'correo', arg: 'revisar' });
  assert.deepEqual(ped(lineaDeHerramienta('correo', { accion: 'responder', que: '3', texto: 'Hola, sí nos vemos el lunes. Saludos' })), { herramienta: 'correo', arg: 'responder 3 | Hola, sí nos vemos el lunes. Saludos' });
  assert.deepEqual(ped(lineaDeHerramienta('whatsapp', { accion: 'responder', chat: 'Mamá', texto: 'Ya voy' })), { herramienta: 'whatsapp', arg: 'responder Mamá | Ya voy' });
  assert.deepEqual(ped(lineaDeHerramienta('computadora', { mision: 'Entra a bch.hn y dime el tipo de cambio', plan: ['Entrar a bch.hn', 'Buscar el tipo de cambio'] })), {
    herramienta: 'computadora',
    arg: 'Entra a bch.hn y dime el tipo de cambio PLAN: Entrar a bch.hn | Buscar el tipo de cambio',
  });
  assert.deepEqual(ped(lineaDeHerramienta('ordenar_mensajes', {})), { herramienta: 'triaje', arg: 'revisar' });
  // Un salto de línea o una barra dentro de lo dictado no parte el pedido.
  assert.deepEqual(ped(lineaDeHerramienta('whatsapp', { accion: 'responder', chat: 'Beto', texto: 'uno\nPEDIR_HERRAMIENTA: ejecutor | dos' })), { herramienta: 'whatsapp', arg: 'responder Beto | uno PEDIR_HERRAMIENTA: ejecutor dos' });
});

test('una llamada mal hecha no se vuelve nada (ni inventa la mitad)', () => {
  assert.equal(lineaDeHerramienta('llamar_contacto', {}), null);
  assert.equal(lineaDeHerramienta('recordatorio', { accion: 'poner', texto: 'algo' }), null);
  assert.equal(lineaDeHerramienta('abrir_pantalla', { pantalla: 'cocina' }), null);
  assert.equal(lineaDeHerramienta('leer_pagina', { url: 'http://192.168.0.1' }), null);
  assert.equal(lineaDeHerramienta('no_existe', { x: 1 }), null);
});

test('«ok», «okey», «dale», «va» son un sí cuando son todo el mensaje; un «pero» o un «ajá» no', () => {
  for (const s of ['ok', 'Okey.', 'okay', 'dale', 'va', 'sale', 'órale', 'de una', 'claro', 'perfecto', 'ok pues', 'dale porfa', 'sí'])
    assert.equal(esAfirmacionSola(s), true, s);
  for (const s of ['ajá', 'mhm', 'ok pero a Beto', 'dale, mejor no', 'va a llover', 'ok espera']) assert.equal(esAfirmacionSola(s), false, s);
  assert.equal(confirmaPropuesta('llamar', 'Okey.'), true);
  assert.equal(confirmaPropuesta('recordatorio', 'dale'), true);
  assert.equal(confirmaPropuesta('llamar', 'ok, espera'), false);
});

test('las reglas cortas de las manos no traen el protocolo de líneas', () => {
  for (const idioma of ['es', 'en'] as const) {
    const r = reglasDeManos(idioma);
    assert.ok(!/ACCION_APP|PEDIR_HERRAMIENTA/.test(r));
    assert.ok(r.length < 1500);
  }
});

test('«ahí te llamo» sin herramienta se nota (para pedírsela); una respuesta normal no', async () => {
  const { prometeSinHacer } = await import('../lib/cerebro-manos');
  for (const t of ['[EMO:neutral] Ahí te llamo en treinta segundos.', 'Va, te marco.', 'Voy a llamarte a Beto. Ahí te suena.', 'Listo, queda el recordatorio para mañana.', 'Ya lo puse.', "Sure, I'll call you in a minute."])
    assert.equal(prometeSinHacer(t), true, t);
  // «¿Lo envío?» dice que el borrador ya está; una oferta («¿Te busco recetas?») no promete nada.
  assert.equal(prometeSinHacer('«Llego tarde.» ¿Lo envío?'), true);
  for (const t of ['[EMO:neutral] La inflación es cuando suben los precios.', 'Bien, ¿y vos cómo andás?', '¿Qué tal una sopa de pollo?', 'El oro está a cuatro mil dólares la onza.', 'Una sopa te caería bien. ¿Te busco recetas?', '¿Quieres que te llame mañana?'])
    assert.equal(prometeSinHacer(t), false, t);
});

test('la etiqueta de ánimo sola no cuenta como respuesta: si después se calla, se corta y pasa al de respaldo', async () => {
  process.env.CEREBRO_VOZ_PRIMERA_MS = '60';
  const { BedrockRuntimeClient } = await import('@aws-sdk/client-bedrock-runtime');
  const { hablarConManos } = await import('../lib/cerebro-rapido');
  const original = BedrockRuntimeClient.prototype.send;
  const modelos: string[] = [];
  (BedrockRuntimeClient.prototype as any).send = async function (cmd: any, o: { abortSignal?: AbortSignal } = {}) {
    modelos.push(cmd.input.modelId);
    return {
      stream: (async function* () {
        yield { contentBlockDelta: { delta: { text: '[EMO: neutral]' } } };
        await new Promise((r, no) => {
          const t = setTimeout(r, 1000);
          o.abortSignal?.addEventListener('abort', () => (clearTimeout(t), no(new Error('cortado'))));
        });
        yield { contentBlockDelta: { delta: { text: ' tarde' } } };
      })(),
    };
  };
  try {
    const t0 = Date.now();
    await assert.rejects(async () => {
      for await (const _ of hablarConManos([{ role: 'user', content: 'hola' }], [])) {
        /* nada */
      }
    });
    assert.ok(Date.now() - t0 < 900, 'no esperó al trozo tardío');
    assert.equal(modelos.length, 2, 'probó el principal y el de respaldo');
  } finally {
    (BedrockRuntimeClient.prototype as any).send = original;
    delete process.env.CEREBRO_VOZ_PRIMERA_MS;
  }
});

test('tope de voz: en voz hay tope salvo que pida algo largo; escrito, nunca', () => {
  assert.equal(topeDeVoz('cómo va la planta', true), TOPE_VOZ_CHARS);
  assert.equal(topeDeVoz('cómo va la planta', false), 0);
  for (const largo of ['cuéntame un cuento', 'léeme el correo de Ana', 'explícame paso a paso cómo pagar', 'ora conmigo', 'cántame algo', 'dímelo en detalle', 'tell me a story']) {
    assert.equal(topeDeVoz(largo, true), 0, largo);
  }
});

test('se corta a media respuesta: lo dicho sale y DESPUÉS el error (el servidor lo cierra como parcial, no como completo)', async () => {
  const { BedrockRuntimeClient } = await import('@aws-sdk/client-bedrock-runtime');
  const { hablarConManos } = await import('../lib/cerebro-rapido');
  const original = BedrockRuntimeClient.prototype.send;
  const modelos: string[] = [];
  (BedrockRuntimeClient.prototype as any).send = async function (cmd: any) {
    modelos.push(cmd.input.modelId);
    return {
      stream: (async function* () {
        yield { contentBlockDelta: { delta: { text: '[EMO: neutral] La planta va bien. Este mes' } } };
        throw new Error('ModelStreamErrorException: se cayó el stream');
      })(),
    };
  };
  try {
    let texto = '';
    await assert.rejects(async () => {
      for await (const p of hablarConManos([{ role: 'user', content: 'cómo va la planta' }], [])) if ('texto' in p) texto += p.texto;
    }, /se cayó el stream/);
    assert.match(texto, /La planta va bien\. Este mes/, 'lo dicho alcanzó a salir');
    assert.equal(modelos.length, 1, 'con algo ya dicho no se salta al de respaldo (se repetiría)');
  } finally {
    (BedrockRuntimeClient.prototype as any).send = original;
  }
});

/** Bedrock falso: cada modelo contesta con su guion de eventos (SDK falso; nada sale de la máquina). */
async function conBedrockFalso(guion: (modelo: string) => any[], f: (modelos: string[]) => Promise<void>) {
  const { BedrockRuntimeClient } = await import('@aws-sdk/client-bedrock-runtime');
  const original = BedrockRuntimeClient.prototype.send;
  const modelos: string[] = [];
  (BedrockRuntimeClient.prototype as any).send = async function (cmd: any) {
    modelos.push(cmd.input.modelId);
    const evs = guion(cmd.input.modelId);
    return {
      stream: (async function* () {
        for (const ev of evs) yield ev;
      })(),
    };
  };
  try {
    await f(modelos);
  } finally {
    (BedrockRuntimeClient.prototype as any).send = original;
  }
}

test('STREAM02: el mismo texto con tres finales distintos da tres estados distintos (end_turn, max_tokens, sin messageStop)', async () => {
  const { hablarConManos } = await import('../lib/cerebro-rapido');
  const texto = { contentBlockDelta: { delta: { text: '[EMO: neutral] La planta va bien este mes.' } } };
  const correr = async () => {
    let fin: any = null;
    let dicho = '';
    let error: unknown = null;
    try {
      for await (const p of hablarConManos([{ role: 'user', content: 'cómo va la planta' }], [])) {
        if ('texto' in p) dicho += p.texto;
        if ('fin' in p) fin = p.fin;
      }
    } catch (e) {
      error = e;
    }
    return { fin, dicho, error };
  };
  await conBedrockFalso(
    () => [texto, { contentBlockStop: {} }, { messageStop: { stopReason: 'end_turn' } }],
    async () => {
      const r = await correr();
      assert.equal(r.error, null);
      assert.deepEqual(r.fin, { motivo: 'end_turn', estado: 'completo' });
    }
  );
  await conBedrockFalso(
    () => [texto, { messageStop: { stopReason: 'max_tokens' } }],
    async (modelos) => {
      const r = await correr();
      assert.equal(r.error, null, 'se cortó por largo, no por fallo: lo dicho queda');
      assert.deepEqual(r.fin, { motivo: 'max_tokens', estado: 'truncado' }, 'max_tokens no es una respuesta terminada');
      assert.equal(modelos.length, 1, 'con algo ya dicho no se repite con el de respaldo');
    }
  );
  await conBedrockFalso(
    () => [texto],
    async (modelos) => {
      const r = await correr();
      assert.match(String((r.error as Error)?.message), /sin messageStop/, 'un EOF sin cierre es un corte, no un end_turn');
      assert.equal(r.fin, null);
      assert.match(r.dicho, /La planta va bien/);
      assert.equal(modelos.length, 1);
    }
  );
});

test('STREAM02: antes de la primera frase, un EOF sin cierre o un max_tokens pasa al de respaldo (el fallback se conserva)', async () => {
  const { hablarConManos } = await import('../lib/cerebro-rapido');
  for (const malo of [[], [{ contentBlockDelta: { delta: { text: '[EMO: neutral]' } } }, { messageStop: { stopReason: 'max_tokens' } }]]) {
    await conBedrockFalso(
      (modelo) => (modelo === 'zai.glm-5' ? malo : [{ contentBlockDelta: { delta: { text: 'Hola, aquí estoy.' } } }, { messageStop: { stopReason: 'end_turn' } }]),
      async (modelos) => {
        let dicho = '';
        let fin: any = null;
        let quien = '';
        for await (const p of hablarConManos([{ role: 'user', content: 'hola' }], [])) {
          if ('texto' in p) dicho += p.texto;
          if ('fin' in p) fin = p.fin;
          if ('modelo' in p) quien = p.modelo;
        }
        assert.deepEqual(modelos, ['zai.glm-5', 'moonshotai.kimi-k2.5']);
        assert.equal(quien, 'moonshotai.kimi-k2.5', 'el modelo que contestó de verdad');
        assert.match(dicho, /Hola, aquí estoy\.$/, 'contestó el de respaldo');
        assert.equal(fin?.estado, 'completo');
      }
    );
  }
});

test('STREAM02: una herramienta pedida con tool_use cierra como completa', async () => {
  const { hablarConManos } = await import('../lib/cerebro-rapido');
  await conBedrockFalso(
    () => [
      { contentBlockStart: { start: { toolUse: { name: 'llamar', toolUseId: 't1' } } } },
      { contentBlockDelta: { delta: { toolUse: { input: '{"a":"Beto"}' } } } },
      { contentBlockStop: {} },
      { messageStop: { stopReason: 'tool_use' } },
    ],
    async () => {
      const piezas: any[] = [];
      for await (const p of hablarConManos([{ role: 'user', content: 'llama a Beto' }], [])) piezas.push(p);
      assert.deepEqual(piezas.find((p) => 'herramienta' in p)?.herramienta, { nombre: 'llamar', input: { a: 'Beto' } });
      assert.deepEqual(piezas.at(-1), { fin: { motivo: 'tool_use', estado: 'completo' } });
    }
  );
});

/* ------------------------------------------------------------------ 5-oct: la mesa del teléfono, más rápida */

// Las herramientas de un teléfono con sesión y la app, SIN las manos de llamar ni de recordatorio (como el de
// José si no las declaró): ahí «te llamo en 30 segundos» no lo cumple ninguna herramienta.
const conSesion: ManosDelTurno = { ...nada, app: true, sesion: true, investigar: true };
const conLlamar: ManosDelTurno = { ...conSesion, manos: ['llamame', 'recordatorio'] };

test('5-oct: qué herramienta del turno cumpliría la promesa se decide sin red (vacío = ninguna)', async () => {
  const { herramientasQueCumplen } = await import('../lib/cerebro-manos');
  const sin = nombres(conSesion);
  const con = nombres(conLlamar);
  // Sin la mano de llamar ni la de recordatorio: nada que hacer con eso.
  assert.deepEqual(herramientasQueCumplen('[EMO: feliz] Va, te llamo en 30 segundos.', sin, { mensaje: 'llámame en 30 segundos' }), []);
  assert.deepEqual(herramientasQueCumplen('Listo, queda el recordatorio para mañana.', sin, { mensaje: 'recuérdame mañana lo del banco' }), []);
  // Con ellas, sí (y solo las que hacen eso).
  assert.deepEqual(herramientasQueCumplen('[EMO: feliz] Va, te llamo en 30 segundos.', con, { mensaje: 'llámame en 30 segundos' }), ['llamarme']);
  assert.ok(herramientasQueCumplen('Listo, queda el recordatorio para mañana.', con, { mensaje: 'recuérdame mañana' }).includes('recordatorio'));
  // Buscar siempre se puede (buscar_web va en todo turno).
  assert.ok(herramientasQueCumplen('Déjame buscarlo.', sin, { mensaje: '¿quién ganó el partido?' }).includes('buscar_web'));
  // Una frase genérica se juzga por lo que se pidió; un «te aviso» de relleno en una charla, por nada.
  assert.deepEqual(herramientasQueCumplen('Ahí voy.', sin, { mensaje: '¿cómo estás?' }), []);
  assert.deepEqual(herramientasQueCumplen('Claro, te aviso cuando termine.', sin, { mensaje: '¿cómo estás?' }), []);
  assert.deepEqual(herramientasQueCumplen('Claro, te aviso cuando termine.', sin, { mensaje: 'investiga el precio del cacao' }), ['investigar']);
  assert.deepEqual(herramientasQueCumplen('Ahí voy.', con, { mensaje: 'llámame' }), ['llamarme']);
  // Un «sí» a una propuesta de AU-RA: lo pedido es lo que ella propuso.
  assert.deepEqual(herramientasQueCumplen('Va, ahí voy.', con, { mensaje: 'sí', anterior: '¿Te llamo en diez minutos?' }), ['llamarme']);
});

test('5-oct: sin herramienta que lo cumpla NO hay segunda vuelta al modelo; con ella, sí (una)', async () => {
  const { cumplirLoDicho } = await import('../lib/cerebro-manos');
  let vueltas = 0;
  const repreguntar = (piezas: any[]) => () =>
    (async function* () {
      vueltas++;
      for (const p of piezas) yield p;
    })();
  const usadas: string[] = [];
  const usar = (h: { nombre: string }) => (usadas.push(h.nombre), true);

  const local = await cumplirLoDicho({ dicho: 'Va, te llamo en 30 segundos.', disponibles: nombres(conSesion), mensaje: 'llámame en 30 segundos', repreguntar: repreguntar([{ texto: 'NADA' }]), usar });
  assert.equal(vueltas, 0, 'no se volvió a preguntar: no había herramienta');
  assert.deepEqual(local, { correccion: 'local', cumplida: false, candidatas: [], ms: 0 });

  const cumplida = await cumplirLoDicho({
    dicho: 'Va, te llamo en 30 segundos.',
    disponibles: nombres(conLlamar),
    mensaje: 'llámame en 30 segundos',
    repreguntar: repreguntar([{ modelo: 'zai.glm-5' }, { herramienta: { nombre: 'llamarme', input: { en_segundos: 30 } } }]),
    usar,
  });
  assert.equal(vueltas, 1);
  assert.equal(cumplida.correccion, 'repregunta');
  assert.equal(cumplida.cumplida, true);
  assert.deepEqual(usadas, ['llamarme']);

  const negada = await cumplirLoDicho({ dicho: 'Va, te llamo.', disponibles: nombres(conLlamar), mensaje: 'llámame', repreguntar: repreguntar([{ texto: 'NADA' }]), usar });
  assert.equal(vueltas, 2);
  assert.deepEqual([negada.correccion, negada.cumplida], ['repregunta', false], 'no la usó: lo prometido no pasó');
});

test('5-oct: corregida sin segunda vuelta, la respuesta nunca deja un «te llamo» / «ya lo puse» / «lo estoy haciendo» falso', async () => {
  const { corregirPromesaSinHerramienta, prometeSinHacer } = await import('../lib/cerebro-manos');
  const { vigilarPromesas } = await import('../lib/promesas');
  const casos = [
    '[EMO: feliz] Va, te llamo en 30 segundos.',
    'Listo, queda el recordatorio para mañana a las cinco.',
    'El clima está bonito hoy. Ya lo puse.',
    'Claro, te aviso cuando termine.',
    'Ahí voy, en eso estoy.',
    'Ya lo estoy haciendo. Te cuento cuando tenga algo.',
    "Sure, I'll call you in a minute.",
  ];
  for (const t of casos) {
    const idioma = /Sure/.test(t) ? 'en' : 'es';
    const c = corregirPromesaSinHerramienta(t, idioma);
    const v = vigilarPromesas(c.texto, { pasos: [], acciones: 0, idioma });
    assert.equal(prometeSinHacer(v.texto), false, `${t} → ${v.texto}`);
    assert.ok(v.texto.trim().length > 10, `queda algo honrado que decir: ${t} → ${v.texto}`);
  }
  // Lo que no promete queda, la etiqueta de ánimo y las líneas de la máquina también.
  const c = corregirPromesaSinHerramienta('[EMO: feliz] El clima está bonito hoy. Ya lo puse.\nACCION_APP: {"tipo":"atras"}');
  assert.equal(c.cambiada, true);
  assert.equal(c.texto, '[EMO: feliz] El clima está bonito hoy. Eso todavía no lo hice: desde aquí no tengo cómo.\nACCION_APP: {"tipo":"atras"}');
  // Una respuesta normal no se toca.
  assert.deepEqual(corregirPromesaSinHerramienta('[EMO: neutral] La inflación es cuando suben los precios.'), { texto: '[EMO: neutral] La inflación es cuando suben los precios.', cambiada: false });
});

test('5-oct: server.ts no vuelve a preguntar a ciegas: pasa por cumplirLoDicho y corrige sin red cuando no hay herramienta', async () => {
  const fs = await import('node:fs');
  const src = fs.readFileSync(new URL('../server.ts', import.meta.url), 'utf8');
  const turno = src.slice(src.indexOf('async function turnoEnVivo('), src.indexOf("app.get('/api/taller'"));
  assert.ok(!/for await \(const pieza of hablarConManos\(vuelta/.test(turno), 'la segunda vuelta ya no se pide directo');
  assert.match(turno, /cumplirLoDicho\(\{/);
  assert.match(turno, /corregirPromesaSinHerramienta\(reply/);
});

test('5-oct: tope de voz: «léemelo completo» y «sigue leyendo» no tienen tope; una respuesta normal sí', () => {
  for (const largo of ['léemelo completo', 'léelo entero', 'sigue leyendo', 'continúa', 'léeme el correo de Ana', 'lee mi último correo', 'keep reading'])
    assert.equal(topeDeVoz(largo, true), 0, largo);
  for (const corto of ['¿qué dice el correo de Ana?', 'cómo va la planta', '¿quién ganó el partido?']) assert.equal(topeDeVoz(corto, true), TOPE_VOZ_CHARS, corto);
});

test('5-oct: lo que se dice con tope: frases enteras hasta TOPE_VOZ_CHARS, nunca más de TOPE_VOZ_DURO, y siempre un principio exacto', async () => {
  const { recorteDeVoz, TOPE_VOZ_DURO } = await import('../lib/cerebro-manos');
  // La respuesta de 1 100 caracteres del registro del 5-oct («dijo 1100 de 1100»): ~70 s de voz.
  const larga = 'El correo es del banco y dice que tu tarjeta vence pronto. '.repeat(19).trim();
  assert.ok(larga.length >= 1100);
  const dicho = recorteDeVoz(larga, TOPE_VOZ_CHARS);
  assert.ok(larga.startsWith(dicho));
  assert.ok(dicho.length >= TOPE_VOZ_CHARS && dicho.length <= TOPE_VOZ_DURO, String(dicho.length));
  assert.match(dicho.trimEnd(), /\.$/, 'termina en frase');
  // Una sola frase larguísima: se corta en una pausa antes del tope duro.
  const sinPunto = 'una lista de cosas, '.repeat(60);
  const d2 = recorteDeVoz(sinPunto, TOPE_VOZ_CHARS);
  assert.ok(sinPunto.startsWith(d2) && d2.length <= TOPE_VOZ_DURO && d2.length > TOPE_VOZ_CHARS / 2, String(d2.length));
  // Sin tope o corta: entera.
  assert.equal(recorteDeVoz(larga, 0), larga);
  assert.equal(recorteDeVoz('Corta y clara.', TOPE_VOZ_CHARS), 'Corta y clara.');
});

test('5-oct: server.ts aplica el tope también a lo que sale de golpe (replace, lo retenido, el done) y el registro dice lo de verdad dicho', async () => {
  const fs = await import('node:fs');
  const src = fs.readFileSync(new URL('../server.ts', import.meta.url), 'utf8');
  const turno = src.slice(src.indexOf('async function turnoEnVivo('), src.indexOf("app.get('/api/taller'"));
  // Antes: `soltar('replace', decible)` y `soltar('replace', ahora)` mandaban la respuesta ENTERA a la voz.
  assert.ok(!/soltar\('replace', (decible|ahora)\)/.test(turno), 'ningún replace manda el texto entero sin tope');
  // Antes: con tope y la vuelta del harness, `enviado = decible.length` hacía decir al registro «1100 de 1100».
  assert.ok(!/enviado = decible\.length;/.test(turno), 'enviado no finge que se dijo todo');
  assert.match(turno, /recorteDeVoz\(/);
  // El `done` de un turno con tope lleva en `voz` solo lo que se dice (el texto entero va en `reply`).
  assert.match(turno, /voz: vozConTope\(/);
  // Y el respaldo JSON de la mesa (/api/turno) también, si el turno fue dictado por voz.
  const json = src.slice(src.indexOf("app.post('/api/turno', "), src.indexOf("app.post('/api/turno', ") + 4000);
  assert.match(json, /voz: turnoHablado\(body\) \? recorteDeVoz\(out\.voz/);
});
