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
  // Revisión 7.5 (MENOR 1): «rehacer» es la versión nueva del que ya armó (server/correo.ts lo reemplaza aunque cambie el asunto).
  assert.deepEqual(ped(lineaDeHerramienta('correo', { accion: 'rehacer', para: 'ana@example.test', asunto: 'Informe', texto: 'Versión 2.' })), { herramienta: 'correo', arg: 'rehacer ana@example.test | Informe | Versión 2.' });
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
  // «Se calla» = más que el plazo total (con la cobertura en paralelo, el que va en vuelo sigue hasta ese plazo).
  process.env.CEREBRO_VOZ_TOTAL_MS = '400';
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
    // Cobertura en paralelo (6-oct): el principal, el de respaldo y un pedido nuevo al principal (CEREBRO_VOZ_LANZAMIENTOS).
    assert.deepEqual(modelos, ['zai.glm-5', 'moonshotai.kimi-k2.5', 'zai.glm-5'], 'probó el principal, el de respaldo y otra vez el principal');
  } finally {
    (BedrockRuntimeClient.prototype as any).send = original;
    delete process.env.CEREBRO_VOZ_PRIMERA_MS;
    delete process.env.CEREBRO_VOZ_TOTAL_MS;
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

/* ------------------------------------------------------------------ revisión del 5-oct: GRAVE-1 y GRAVE-2 */

// «contéstale a Ana que todo bien pero que el transporte se duplicó»: el borrador entero y la pregunta (322 caracteres).
const BORRADOR_ANA =
  'Le dejé listo el WhatsApp para Ana: «Hola Ana, todo bien por aquí, gracias por preguntar. Solo una cosa: el transporte de esta semana se duplicó, porque hubo que mandar dos viajes del camión a la planta. Si quieres lo vemos el lunes con calma y te paso los recibos de los dos viajes para que los revises.» ¿Lo mando?';

test('GRAVE-1: con tope, la pregunta final a la persona («¿Lo mando?») siempre se dice', async () => {
  const M: Record<string, any> = await import('../lib/cerebro-manos');
  assert.ok(BORRADOR_ANA.length > 300, String(BORRADOR_ANA.length));
  const dicho = M.recorteDeVoz(BORRADOR_ANA, TOPE_VOZ_CHARS);
  assert.match(dicho, /¿Lo mando\?$/, `la pregunta se oye: «${dicho}»`);
  // Una respuesta larga que termina en pregunta: lo primero y la pregunta, nunca solo el principio.
  const larga = `${'El banco dice que la tarjeta vence pronto y que hay que pasar a renovarla. '.repeat(8)}¿Quieres que te lo recuerde mañana?`;
  const d2 = M.recorteDeVoz(larga, TOPE_VOZ_CHARS);
  assert.ok(d2.length < larga.length, 'sí recorta');
  assert.ok(d2.startsWith('El banco dice'), 'empieza por lo primero');
  assert.match(d2, /¿Quieres que te lo recuerde mañana\?$/);
  assert.ok(d2.length <= M.TOPE_VOZ_DURO + 2, String(d2.length));
});

test('GRAVE-1: un turno con borrador o confirmación no lleva tope (se dice entero); lo de antes sigue igual', async () => {
  const M: Record<string, any> = await import('../lib/cerebro-manos');
  // Hay algo esperando su «sí» (un borrador de correo/WhatsApp, una llamada o un recordatorio por confirmar).
  assert.equal(M.topeDeVoz('léemelo otra vez', true, { confirmacion: true }), 0);
  assert.equal(M.topeDeVoz('sí', true, { confirmacion: true }), 0);
  assert.equal(M.topeDeVoz('cómo va la planta', true, { confirmacion: false }), TOPE_VOZ_CHARS);
  // El turno armó un borrador (recibo `borrador`): sin tope. Una lectura ya no lo quita: lleva el tope de lectura
  // (revisión independiente del 5-oct, MENOR-D; ver su prueba abajo).
  assert.equal(typeof M.pasoSinTopeDeVoz, 'function', 'existe pasoSinTopeDeVoz');
  assert.equal(M.pasoSinTopeDeVoz({ herramienta: 'whatsapp', estado: 'succeeded', recibo: { efecto: 'borrador', referencia: 'w1' } }), true);
  assert.equal(M.pasoSinTopeDeVoz({ herramienta: 'correo', estado: 'succeeded', recibo: { efecto: 'borrador', referencia: 'c1' } }), true);
  assert.equal(M.pasoSinTopeDeVoz({ herramienta: 'correo', estado: 'succeeded', recibo: { efecto: 'ninguno', lectura: true } }), false);
  assert.equal(M.pasoSinTopeDeVoz({ herramienta: 'web', estado: 'succeeded', recibo: { efecto: 'ninguno' } }), false);
  assert.equal(M.pasoSinTopeDeVoz({ herramienta: 'correo', estado: 'failed', recibo: { efecto: 'ninguno', codigo: 'proveedor' } }), false);
  // Un borrador en el chat de la app (chat_aura redactar) también.
  assert.equal(M.accionConBorrador(`Le escribo a Beto. ¿Lo envío?\n${lineaDeHerramienta('chat_aura', { accion: 'redactar', con: 'Beto', texto: 'Llego tarde' })}`), true);
  assert.equal(M.accionConBorrador(`Va.\n${lineaDeHerramienta('abrir_pantalla', { pantalla: 'ajustes' })}`), false);
  // Sin tope, el borrador de Ana se dice entero.
  assert.equal(M.recorteDeVoz(BORRADOR_ANA, 0), BORRADOR_ANA);
  // La línea del prompt hablado no aplica a borradores ni confirmaciones.
  assert.equal(typeof M.lineaRespuestaHablada, 'function', 'existe lineaRespuestaHablada');
  assert.match(M.lineaRespuestaHablada('es'), /salvo borradores y confirmaciones: esos se dicen completos/);
  assert.match(M.lineaRespuestaHablada('en'), /except drafts and confirmations/i);
});

test('GRAVE-1: server.ts quita el tope en turnos de borrador, confirmación o lectura (stream, done y JSON)', async () => {
  const fs = await import('node:fs');
  const src = fs.readFileSync(new URL('../server.ts', import.meta.url), 'utf8');
  const turno = src.slice(src.indexOf('async function turnoEnVivo('), src.indexOf("app.get('/api/taller'"));
  // Lo que espera su «sí» al empezar el turno (o lo que el turno resolvió) quita el tope desde el principio.
  assert.match(turno, /topeDeVoz\(message, !!opciones\.voz, \{ confirmacion: p\.vozCompleta \}\)/);
  // Un paso del harness con borrador lo quita (y una lectura lo sube al de lectura: MENOR-D) antes de que la vuelta hable.
  assert.match(turno, /alPaso: \(paso\) => subirTope\(topeTrasPaso\(topeDelTurno, paso\)\)/);
  // El prompt hablado: la línea nueva (con la salvedad), y no va en un turno de confirmación.
  assert.match(src, /if \(topeDeVoz\(message, !!opciones\.voz, \{ confirmacion: vozCompleta \}\) > 0\) hechos\.push\(lineaRespuestaHablada\(/);
  assert.ok(!/RESPUESTA HABLADA: esto se dice en voz alta\. Dos o tres frases cortas como mucho/.test(src), 'la línea vieja (sin salvedad) ya no está');
  // El respaldo JSON: sin tope si el turno fue de borrador o confirmación (una lectura, con el de lectura: MENOR-D).
  const json = src.slice(src.indexOf("app.post('/api/turno', "), src.indexOf("app.post('/api/turno', ") + 4000);
  assert.match(json, /recorteDeVoz\(out\.voz, topeDelJson\(out, /);
  assert.match(src, /function topeDelJson\([^)]*\): number \{\s*if \(out\.vozCompleta\) return 0;/);
});

test('GRAVE-2: un «NADA» a la re-pregunta se respeta (no se corrige como antes de la mesa rápida)', async () => {
  const M: Record<string, any> = await import('../lib/cerebro-manos');
  const repreguntar = (piezas: any[]) => () =>
    (async function* () {
      for (const p of piezas) yield p;
    })();
  const r = await M.cumplirLoDicho({ dicho: 'Va, te lo mando.', disponibles: ['whatsapp'], mensaje: 'mándale a Ana que llego tarde', repreguntar: repreguntar([{ modelo: 'zai.glm-5' }, { texto: 'NADA' }]), usar: () => true });
  assert.equal(r.correccion, 'repregunta');
  assert.equal(r.cumplida, false);
  assert.equal(r.nada, true, 'el modelo dijo que no prometió nada');
});

test('GRAVE-2: la corrección local solo va cuando de verdad no pasó nada', async () => {
  const M: Record<string, any> = await import('../lib/cerebro-manos');
  assert.equal(typeof M.debeCorregirSinHerramienta, 'function', 'existe debeCorregirSinHerramienta');
  const local = { correccion: 'local', cumplida: false, candidatas: [], ms: 0 };
  const repregunta = { correccion: 'repregunta', cumplida: false, candidatas: ['whatsapp'], ms: 900 };
  // `dicho`: lo que respondió (de ahí sale qué prometió; revisión independiente del 5-oct, MEDIO-C).
  const base = { usoManos: false, borradorPendiente: false, pasos: [], dicho: 'Va, te lo mando.' };
  assert.equal(M.debeCorregirSinHerramienta({ ...base, promesa: local }), true, 'ninguna herramienta lo cumple: se corrige');
  assert.equal(M.debeCorregirSinHerramienta({ ...base, promesa: repregunta }), true, 're-preguntó y no usó ninguna');
  assert.equal(M.debeCorregirSinHerramienta({ ...base, promesa: null }), false, 'no prometió');
  // Escenario B del revisor: la re-pregunta contestó «NADA» → como antes del cambio, el texto queda.
  assert.equal(M.debeCorregirSinHerramienta({ ...base, promesa: { ...repregunta, nada: true } }), false);
  // Escenario A: un borrador de un turno anterior; «léemelo otra vez» → lo lee y pregunta «¿Lo mando?».
  assert.equal(M.debeCorregirSinHerramienta({ ...base, borradorPendiente: true, promesa: local, dicho: BORRADOR_ANA }), false);
  // Una herramienta del turno que cumple lo prometido terminó bien: no se le dice «no lo hice».
  assert.equal(M.debeCorregirSinHerramienta({ ...base, pasos: [{ herramienta: 'correo', estado: 'succeeded' }], promesa: repregunta }), false);
  assert.equal(M.debeCorregirSinHerramienta({ ...base, usoManos: true, promesa: local }), false);
});

test('GRAVE-2: «desde aquí no tengo cómo» solo cuando no hay herramienta que lo haga', async () => {
  const { corregirPromesaSinHerramienta } = await import('../lib/cerebro-manos');
  const sin = corregirPromesaSinHerramienta('Va, te llamo en un minuto.', 'es', { sinHerramienta: true } as any);
  assert.match(sin.texto, /desde aquí no tengo cómo/);
  // La herramienta existía (se le pidió y no la usó): decir «no tengo cómo» sería falso.
  const con = corregirPromesaSinHerramienta('Va, te llamo en un minuto.', 'es', { sinHerramienta: false } as any);
  assert.equal(con.cambiada, true);
  assert.doesNotMatch(con.texto, /no tengo cómo/, con.texto);
  assert.match(con.texto, /todavía no lo hice/i);
  const en = corregirPromesaSinHerramienta("Sure, I'll call you in a minute.", 'en', { sinHerramienta: false } as any);
  assert.doesNotMatch(en.texto, /can't do it from here/, en.texto);
});

test('GRAVE-2: lo que ya pasó en otro turno («ya te lo mandé hace rato») no es una promesa nueva ni se borra', async () => {
  const { corregirPromesaSinHerramienta, prometeSinHacer } = await import('../lib/cerebro-manos');
  for (const t of ['Sí, ya te lo mandé hace rato.', 'Ese correo se lo mandé ayer a las cinco.', 'Lo puse esta mañana, ya está.', 'I already sent it earlier today.'])
    assert.equal(prometeSinHacer(t), false, t);
  const c = corregirPromesaSinHerramienta('Sí, ya te lo mandé hace rato.');
  assert.deepEqual(c, { texto: 'Sí, ya te lo mandé hace rato.', cambiada: false });
  // Sin nada que diga que fue antes, «ya lo mandé» sigue siendo dar por hecho algo de ESTE turno.
  for (const t of ['Listo, ya te lo mandé.', 'Ya lo puse.', 'Va, te llamo en treinta segundos.']) assert.equal(prometeSinHacer(t), true, t);
});

test('GRAVE-2: server.ts pasa por debeCorregirSinHerramienta (NADA, borrador pendiente, pasos del turno)', async () => {
  const fs = await import('node:fs');
  const src = fs.readFileSync(new URL('../server.ts', import.meta.url), 'utf8');
  const turno = src.slice(src.indexOf('async function turnoEnVivo('), src.indexOf("app.get('/api/taller'"));
  // Revisión independiente (MEDIO-C): con lo dicho y el mensaje; la corrección perdona solo lo del borrador pendiente.
  // Revisión del 6-oct: «algo espera su sí» suma los apartados de la ventana de decisión y el mensaje listo de la app.
  assert.match(turno, /const borradorPendiente = algoEsperaSuSi\(\);/);
  assert.match(turno, /const algoEsperaSuSi = \(\) =>\s*hayBorradorPendiente\(\) \|\|/);
  assert.match(turno, /debeCorregirSinHerramienta\(\{ promesa, usoManos, borradorPendiente, pasos: pasosTurno, dicho: antes, mensaje: message \}\)/);
  assert.match(turno, /corregirPromesaSinHerramienta\(reply, idioma === 'en' \? 'en' : 'es', \{ sinHerramienta: promesa\?\.correccion === 'local', borradorPendiente, mensaje: message \}\)/);
  // Y la re-pregunta tampoco se lanza por lo que se dice de eso.
  assert.match(turno, /borradorPendiente: algoEsperaSuSi\(\),\s*repreguntar:/);
});

/* ------------------------------------------------------------------ revisión independiente del 5-oct (GRAVE-A … MENOR-E) */

test('GRAVE-A: lo que también dice PARA CUÁNDO («para mañana en la mañana», «para el lunes», «más temprano, a las 5») sigue siendo promesa', async () => {
  const M: Record<string, any> = await import('../lib/cerebro-manos');
  // Con 3e163da estas eran promesas; con ee5cfb0 pasaban por «cosas de antes» y nadie las corregía.
  const falsas = ['Listo, te puse el recordatorio para mañana en la mañana.', 'Ya te agendé la cita para el lunes.', 'Te puse la alarma más temprano, a las 5.'];
  for (const t of falsas) {
    assert.equal(M.prometeSinHacer(t), true, t);
    const c = M.corregirPromesaSinHerramienta(t, 'es');
    assert.equal(c.cambiada, true, `se corrige: ${t}`);
    assert.match(c.texto, /todavía no lo hice/i, c.texto);
  }
  // Lo de otro turno, con una marca de pasado clara, sigue sin ser promesa.
  for (const t of ['Sí, ya te lo mandé hace rato.', 'Ese correo se lo mandé ayer a las cinco.', 'Lo puse esta mañana, ya está.', 'Te lo mandé el lunes pasado.', 'Ya te lo mandé hace un rato para que lo revises.', 'I already sent it yesterday.'])
    assert.equal(M.prometeSinHacer(t), false, t);
  // Tercera revisión (5-oct): con una marca de pasado clara, lo dicho es de otro turno aunque diga para cuándo (marcarlo
  // lanzaba una re-pregunta oculta que podía volver a poner la alarma, o «Eso todavía no lo hice»).
  for (const t of ['Ayer te puse la alarma a las 5.', 'Hace rato te puse la alarma para las 5.', 'Ayer te agendé la cita para el lunes.'])
    assert.equal(M.prometeSinHacer(t), false, t);
});

test('tercera revisión (5-oct): con un borrador esperando solo se perdona lo del borrador; el tope solo cae si el turno lo toca', async () => {
  const M: Record<string, any> = await import('../lib/cerebro-manos');
  const base = { promesa: { correccion: 'local', cumplida: false, candidatas: [], ms: 0 }, usoManos: false, pasos: [], borradorPendiente: true, mensaje: 'pon una alarma a las 6' };
  // Lo del borrador queda; lo demás que da por hecho, se corrige aunque venga en la misma frase.
  assert.equal(M.debeCorregirSinHerramienta({ ...base, dicho: '¿Lo mando?' }), false);
  assert.equal(M.debeCorregirSinHerramienta({ ...base, dicho: 'Ahí está el borrador; ya te puse la alarma también.' }), true);
  assert.equal(M.debeCorregirSinHerramienta({ ...base, dicho: 'Listo, te puse la alarma, ¿lo mando?' }), true);
  // La charla de siempre con algo pendiente: con tope.
  for (const mensaje of ['¿cómo está el clima?', 'otra vez el clima', 'cambia de tema', 'repite el chiste', 'confírmame la hora del vuelo'])
    assert.equal(M.vozCompletaDelTurno({ esperaba: true, resolvio: false, mensaje }), false, mensaje);
  // Lo que sí pide lo pendiente: entero.
  for (const mensaje of ['léeme el correo para Ana', '¿y el correo de Ana?', 'dile que mejor el jueves', 'read me the draft', 'léemelo otra vez', 'mándalo'])
    assert.equal(M.vozCompletaDelTurno({ esperaba: true, resolvio: false, mensaje }), true, mensaje);
});

test('MEDIO-B: que algo espere su «sí» no quita el tope en todos los turnos; solo si el turno lo toca', async () => {
  const M: Record<string, any> = await import('../lib/cerebro-manos');
  assert.equal(typeof M.vozCompletaDelTurno, 'function', 'existe vozCompletaDelTurno');
  const esperando = { esperaba: true, resolvio: false };
  // Un borrador espera (vive 15 min) y pregunta otra cosa: con tope, y la línea «RESPUESTA HABLADA» va.
  assert.equal(M.vozCompletaDelTurno({ ...esperando, mensaje: '¿qué pasó con el dólar?' }), false);
  assert.equal(M.topeDeVoz('¿qué pasó con el dólar?', true, { confirmacion: M.vozCompletaDelTurno({ ...esperando, mensaje: '¿qué pasó con el dólar?' }) }), TOPE_VOZ_CHARS);
  const larga = 'El dólar cerró hoy en 24,70 lempiras, un poco arriba de ayer, y el Banco Central dice que la subasta fue normal. '.repeat(10);
  assert.ok(larga.length > 1000);
  assert.ok(M.recorteDeVoz(larga, TOPE_VOZ_CHARS).length <= M.TOPE_VOZ_DURO, 'no lee 1 000+ caracteres');
  // Pide releerlo, cambiarlo o confirmarlo: va entero.
  for (const m of ['léemelo otra vez', '¿cómo quedó?', '¿qué dice el borrador?', 'cámbiale la hora a las 5', 'mándalo', 'read it back'])
    assert.equal(M.vozCompletaDelTurno({ ...esperando, mensaje: m }), true, m);
  // Lo resolvió (la regla única eligió, preguntó cuál, o un «sí»/«no» al borrador): va entero.
  assert.equal(M.vozCompletaDelTurno({ esperaba: true, resolvio: true, mensaje: 'sí' }), true);
  // Nada esperaba: no hay confirmación que valga.
  assert.equal(M.vozCompletaDelTurno({ esperaba: false, resolvio: false, mensaje: '¿cómo quedó?' }), false);
});

test('MEDIO-B: server.ts decide la voz entera por lo que el turno toca, y lo escrito en la caja del chat no espera su «sí»', async () => {
  const fs = await import('node:fs');
  const src = fs.readFileSync(new URL('../server.ts', import.meta.url), 'utf8');
  const prep = src.slice(src.indexOf('async function prepararTurno('), src.indexOf('async function respuestaChica('));
  assert.doesNotMatch(prep, /const vozCompleta = esperabaSi \|\|/, 'esperar no basta');
  assert.match(prep, /const appPreguntada = appEsperando && appEsperando\.que !== 'borrador' \? appEsperando : null;/);
  assert.match(prep, /const esperabaSi =\s*!!appPreguntada \|\|/);
  assert.match(prep, /const resolvioPendiente = decision\.respondio \|\| decision\.ambiguo \|\| !!deLaPregunta \|\| \(!!\(delCorreo \|\| delWhatsapp\) && respuestaAlBorrador\(message\) !== null\);/);
  assert.match(prep, /const vozCompleta = vozCompletaDelTurno\(\{ esperaba: esperabaSi, resolvio: resolvioPendiente, mensaje: message \}\);/);
});

test('MEDIO-C: con un borrador esperando, solo se perdona lo de ESE borrador; lo demás falso se corrige', async () => {
  const M: Record<string, any> = await import('../lib/cerebro-manos');
  const local = { correccion: 'local', cumplida: false, candidatas: [], ms: 0 };
  const base = { usoManos: false, borradorPendiente: true, pasos: [], promesa: local };
  // «Listo, te puse la alarma» sin ninguna herramienta de alarma: se corrige aunque espere un borrador.
  assert.equal(M.debeCorregirSinHerramienta({ ...base, dicho: 'Listo, te puse la alarma.' }), true);
  const c = M.corregirPromesaSinHerramienta('Listo, te puse la alarma. ¿Lo mando?', 'es', { borradorPendiente: true });
  assert.equal(c.cambiada, true);
  assert.doesNotMatch(c.texto, /te puse la alarma/, c.texto);
  assert.match(c.texto, /¿Lo mando\?/, 'lo del borrador queda');
  // «Ya te lo mandé» con el borrador esperando es falso (solo sale con su «sí»).
  assert.equal(M.debeCorregirSinHerramienta({ ...base, dicho: 'Listo, ya te lo mandé.' }), true);
  // Leerlo y preguntar si se manda es verdad: no se toca (tampoco lo que dice el borrador citado).
  for (const d of [BORRADOR_ANA, 'Te lo leo otra vez: «Hola Ana, te llamo mañana para lo del camión.» ¿Se lo envío así?', 'Ahí está el borrador. ¿Lo mando?']) {
    assert.equal(M.debeCorregirSinHerramienta({ ...base, dicho: d }), false, d);
    assert.equal(M.corregirPromesaSinHerramienta(d, 'es', { borradorPendiente: true }).cambiada, false, d);
  }
});

test('MEDIO-C: una herramienta que terminó bien solo cuenta si es de las que cumplirían lo prometido', async () => {
  const M: Record<string, any> = await import('../lib/cerebro-manos');
  const local = { correccion: 'local', cumplida: false, candidatas: [], ms: 0 };
  const base = { usoManos: false, borradorPendiente: false, promesa: local };
  // Buscó el clima (bien) y dijo «te puse el recordatorio» sin ponerlo: se corrige.
  assert.equal(M.debeCorregirSinHerramienta({ ...base, pasos: [{ herramienta: 'web', estado: 'succeeded' }], dicho: 'Mañana llueve en Tegucigalpa. Te puse el recordatorio.' }), true);
  // El correo que se mandó de verdad sí respalda «te lo mando».
  assert.equal(M.debeCorregirSinHerramienta({ ...base, pasos: [{ herramienta: 'correo', estado: 'succeeded' }], dicho: 'Va, te lo mando.' }), false);
  // Una herramienta que falló no respalda nada.
  assert.equal(M.debeCorregirSinHerramienta({ ...base, pasos: [{ herramienta: 'correo', estado: 'failed' }], dicho: 'Va, te lo mando.' }), true);
});

test('MENOR-D: una lectura lleva el tope de lectura (un trozo y su «¿sigo?»), no queda sin tope', async () => {
  const M: Record<string, any> = await import('../lib/cerebro-manos');
  assert.equal(typeof M.topeTrasPaso, 'function', 'existe topeTrasPaso');
  assert.equal(M.TOPE_VOZ_LECTURA, 650);
  const lectura = { herramienta: 'correo', estado: 'succeeded', recibo: { efecto: 'ninguno', lectura: true } };
  const web = { herramienta: 'web', estado: 'succeeded', recibo: { efecto: 'ninguno' } };
  const borrador = { herramienta: 'whatsapp', estado: 'succeeded', recibo: { efecto: 'borrador' } };
  assert.equal(M.topeTrasPaso(TOPE_VOZ_CHARS, lectura), 650);
  assert.equal(M.topeTrasPaso(TOPE_VOZ_CHARS, web), TOPE_VOZ_CHARS);
  assert.equal(M.topeTrasPaso(TOPE_VOZ_CHARS, borrador), 0);
  assert.equal(M.topeTrasPaso(0, lectura), 0, 'sin tope (pidió «completo») sigue sin tope');
  assert.equal(M.topeTrasPaso(TOPE_VOZ_CHARS, { ...lectura, estado: 'failed' }), TOPE_VOZ_CHARS);
  // Lectura y búsqueda en el mismo turno: el total sigue en 650 (antes, la lectura quitaba el tope a todo).
  assert.equal([web, lectura, web].reduce((t, p) => M.topeTrasPaso(t, p), TOPE_VOZ_CHARS), 650);
  // Un correo de 2 800 caracteres: se dice el principio y el «¿sigo?», sin pasar de 650.
  const cuerpo = 'Le escribo para confirmarle los detalles del envío de la próxima semana, que incluye los repuestos del molino. '.repeat(25);
  const dicho = `Es del proveedor, sobre el envío. ${cuerpo.slice(0, 2800)} ¿Sigo?`;
  const tope = M.topeTrasPaso(TOPE_VOZ_CHARS, lectura);
  const voz = M.recorteDeVoz(dicho, tope);
  assert.ok(voz.length <= 650, String(voz.length));
  assert.ok(voz.length > M.TOPE_VOZ_DURO, 'un trozo entero, más que el tope corto');
  assert.ok(voz.startsWith('Es del proveedor'));
  assert.match(voz, /¿Sigo\?$/);
});

test('MENOR-D: server.ts usa el tope de lectura (stream, harness y respaldo JSON)', async () => {
  const fs = await import('node:fs');
  const src = fs.readFileSync(new URL('../server.ts', import.meta.url), 'utf8');
  const turno = src.slice(src.indexOf('async function turnoEnVivo('), src.indexOf("app.get('/api/taller'"));
  assert.match(turno, /alPaso: \(paso\) => subirTope\(topeTrasPaso\(topeDelTurno, paso\)\)/);
  assert.doesNotMatch(turno, /TOPE_VOZ_DURO/, 'el duro va con el tope del turno (duroDeVoz)');
  assert.match(turno, /hasta > duroDeVoz\(topeDelTurno\)/);
  assert.match(src, /vozPasos: \{ borrador: h\.pasos\.some\(pasoSinTopeDeVoz\), lectura: h\.pasos\.some\(pasoDeLectura\) \}/);
  assert.doesNotMatch(src, /sinTopeDeVoz: h\.pasos\.some/);
  assert.match(src, /return out\.vozLectura \? topeConLectura\(tope\) : tope;/);
});

test('MENOR-E: la pregunta final no es una citada, retórica ni larga; con emoji o una frase corta detrás, sí', async () => {
  const M: Record<string, any> = await import('../lib/cerebro-manos');
  const relleno = 'El correo de hoy trae varias cosas sobre la planta, el transporte de la semana y los pagos pendientes. '.repeat(5);
  // (1) Citada: la pregunta es de Ana, no de AU-RA.
  const citada = `${relleno}Ana te escribe: «¿Puedes venir mañana?»`;
  assert.equal(M.preguntaFinal(citada), '');
  assert.doesNotMatch(M.recorteDeVoz(citada, TOPE_VOZ_CHARS), /¿Puedes venir mañana\?/);
  assert.equal(M.preguntaFinal(`${relleno}Ana dice: "¿Vienes?"`), '');
  // (2) Retórica.
  for (const r of ['¿Quién no quiere un día libre?', 'Es buena noticia, ¿no?', '¿Sabes qué?', "Who doesn't love a day off?"]) assert.equal(M.preguntaFinal(`${relleno}${r}`), '', r);
  assert.equal(M.preguntaFinal(`${relleno}¿No quieres que se lo mande?`), '¿No quieres que se lo mande?', 'una pregunta de verdad que empieza por «no»');
  // (3) Larga: no se pega, y lo dicho nunca pasa del tope duro.
  const larga = '¿Quieres que te arme un resumen de todos los correos de la planta y del transporte de esta semana, con los pagos pendientes y lo que falta firmar, para mandárselo a Beto?';
  assert.ok(larga.length > 120);
  assert.equal(M.preguntaFinal(`${relleno}${larga}`), '');
  assert.ok(M.recorteDeVoz(`${relleno}${larga}`, TOPE_VOZ_CHARS).length <= M.TOPE_VOZ_DURO);
  // (4) Emoji o una frase corta detrás: la pregunta se conserva.
  assert.equal(M.preguntaFinal(`${relleno}¿Lo mando? 😊`), '¿Lo mando? 😊');
  assert.equal(M.preguntaFinal(`${relleno}¿Lo mando? Avísame.`), '¿Lo mando? Avísame.');
  assert.match(M.recorteDeVoz(`${relleno}¿Lo mando? 😊`, TOPE_VOZ_CHARS), /¿Lo mando\? 😊$/);
  assert.match(M.recorteDeVoz(`${relleno}¿Lo mando? Avísame.`, TOPE_VOZ_CHARS), /¿Lo mando\? Avísame\.$/);
  // Una frase larga detrás ya no es «la pregunta final».
  assert.equal(M.preguntaFinal(`${relleno}¿Lo mando? Si no, lo dejamos para mañana con calma y lo revisamos juntos.`), '');
  // Nunca pasa del tope duro, sea cual sea el largo de la pregunta.
  for (let n = 5; n <= 400; n += 5) {
    const q = `¿${'a'.repeat(n)}?`;
    const v = M.recorteDeVoz(`${relleno}${q}`, TOPE_VOZ_CHARS);
    assert.ok(v.length <= M.TOPE_VOZ_DURO, `${n}: ${v.length}`);
  }
});

test('tercera revisión (5-oct): en el stream la pregunta final se dice siempre (preguntaFinal la limita a 120)', async () => {
  const fs = await import('node:fs');
  const src = fs.readFileSync(new URL('../server.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /enviado \+ 1 \+ q\.length <= duroDeVoz\(topeDelTurno\)/, 'sin la condición que la dejaba fuera');
  assert.match(src, /if \(q && enviado <= decible\.lastIndexOf\(q\)\) \{/);
  const M: Record<string, any> = await import('../lib/cerebro-manos');
  const q = M.preguntaFinal('x '.repeat(200) + '¿Te llamo a Ana a las 5?');
  assert.ok(q && q.length <= 120, String(q));
});

/* ------------------------------------------------------------------ revisión del 6-oct: re-preguntas de 3–4,6 s en la voz */

/** Todas las manos de un turno del teléfono con cuenta (como el de José): la re-pregunta tiene de dónde escoger. */
const delTelefonoCompleto: ManosDelTurno = {
  app: true,
  manos: ['llamar', 'leer', 'buscar', 'idioma', 'perfil', 'recordatorio', 'llamame', 'cartera', 'pagar'],
  sistema: true,
  computadora: true,
  correo: true,
  whatsapp: true,
  sesion: true,
  triaje: true,
  investigar: true,
};

test('6-oct: describir la cámara en la misma respuesta («te leo lo que veo») no es una promesa', async () => {
  const { prometeSinHacer } = await import('../lib/cerebro-manos');
  for (const t of ['[EMO: neutral] Te leo lo que veo: una persona sonriendo.', 'Te digo lo que hay: dos personas y una mesa.', 'Le cuento quién está: José y Ana.', 'Te describo la escena: estás en la cocina.']) {
    assert.equal(prometeSinHacer(t), false, t);
  }
  // Leer otra cosa sí sigue siendo promesa.
  assert.equal(prometeSinHacer('Te leo tus correos.'), true);
  assert.equal(prometeSinHacer('Ahí te llamo.'), true);
});

test('6-oct: lo que hace solo el teléfono (cámara, «Lo que veo», caras, voces) no lanza la segunda vuelta; se corrige con la frase que sirve', async () => {
  const { cumplirLoDicho, debeCorregirSinHerramienta, corregirPromesaSinHerramienta, herramientasQueCumplen } = await import('../lib/cerebro-manos');
  const disponibles = nombres(delTelefonoCompleto);
  let vueltas = 0;
  const repreguntar = () =>
    (async function* () {
      vueltas++;
      yield { texto: 'NADA' };
    })();
  const casos: Array<[string, string]> = [
    ['[EMO: neutral] Listo, te pongo la cámara trasera.', 'cambia a la cámara de atrás'],
    ['[EMO: neutral] Va, la abro.', 'abre la cámara'],
    ['[EMO: neutral] Ahí te la abro.', 'enciende la cámara por favor'],
    ['[EMO: neutral] Listo, ya te abrí «Lo que veo».', 'enséñame lo que ves'],
    ['[EMO: neutral] Va, te pongo la vista de lo que veo.', 'muéstrame lo que ves'],
    ['[EMO: neutral] Listo, ya puse tu voz.', 'aprende mi voz'],
  ];
  for (const [dicho, mensaje] of casos) {
    assert.deepEqual(herramientasQueCumplen(dicho, disponibles, { mensaje }), [], `${dicho} (${mensaje})`);
    const p = await cumplirLoDicho({ dicho, disponibles, mensaje, repreguntar, usar: () => false });
    assert.equal(p.correccion, 'local', dicho);
    // Lo que dio por hecho no pasó: se corrige aquí, sin red, diciéndole cómo pedírselo al teléfono.
    assert.equal(debeCorregirSinHerramienta({ promesa: p, usoManos: false, borradorPendiente: false, pasos: [], dicho, mensaje }), true, dicho);
    const c = corregirPromesaSinHerramienta(dicho, 'es', { sinHerramienta: true, mensaje });
    assert.match(c.texto, /lo hace tu teléfono cuando se lo dices tal cual/, c.texto);
    assert.doesNotMatch(c.texto, /desde aquí no tengo cómo/);
  }
  assert.equal(vueltas, 0, 'ninguna segunda vuelta al modelo');
  // Con algo que una herramienta sí hace en la misma frase, cuenta como siempre.
  assert.ok(herramientasQueCumplen('Listo, te abro la cámara y te pongo el recordatorio.', disponibles, { mensaje: 'abre la cámara' }).includes('recordatorio'));
});

test('6-oct: con un borrador esperando, lo que se dice de él («¿Lo envío?», «tócale Sí y sale», la ventana de decisión) no se vuelve a pedir', async () => {
  const { cumplirLoDicho, herramientasQueCumplen, debeCorregirSinHerramienta } = await import('../lib/cerebro-manos');
  const disponibles = nombres(delTelefonoCompleto);
  let vueltas = 0;
  const repreguntar = () =>
    (async function* () {
      vueltas++;
      yield { texto: 'NADA' };
    })();
  const casos = [
    'Sigue esperando el correo para Ana. ¿Lo envío?',
    'Está en tu ventana de decisión: tócale Sí y lo mando.',
    'Si me dices que sí, te lo mando.',
    'En cuanto me confirmes, lo envío.',
    'Quedó pendiente el WhatsApp para Beto; lo tienes en tu ventana de decisión para que lo apruebes ahí.',
  ];
  for (const dicho of casos) {
    assert.deepEqual(herramientasQueCumplen(dicho, disponibles, { mensaje: '¿qué pasó con lo de Ana?', borradorPendiente: true }), [], dicho);
    const p = await cumplirLoDicho({ dicho, disponibles, mensaje: '¿qué pasó con lo de Ana?', borradorPendiente: true, repreguntar, usar: () => false });
    assert.equal(p.correccion, 'local', dicho);
    // Y no se borra: es verdad mientras el borrador espera.
    assert.equal(debeCorregirSinHerramienta({ promesa: p, usoManos: false, borradorPendiente: true, pasos: [], dicho, mensaje: '¿qué pasó con lo de Ana?' }), false, dicho);
  }
  assert.equal(vueltas, 0);
  // Sin borrador esperando, «tócale Sí y lo mando» promete un mensaje que no existe: se le vuelve a pedir.
  assert.ok(herramientasQueCumplen('Tócale Sí y lo mando.', disponibles, { mensaje: 'mándale un WhatsApp a Beto' }).length > 0);
  // «Ya lo mandé» con un borrador esperando sigue siendo falso (el borrador solo sale con su «sí»).
  const ya = await cumplirLoDicho({ dicho: 'Listo, ya lo mandé.', disponibles, mensaje: 'mándalo', borradorPendiente: true, repreguntar, usar: () => false });
  assert.equal(ya.correccion, 'repregunta');
});

test('6-oct: la promesa de verdad se sigue corrigiendo con la segunda vuelta («te llamo en 30 segundos» sin herramienta)', async () => {
  const { cumplirLoDicho } = await import('../lib/cerebro-manos');
  const usadas: string[] = [];
  const p = await cumplirLoDicho({
    dicho: '[EMO: feliz] ¡Va, te llamo en 30 segundos!',
    disponibles: nombres(delTelefonoCompleto),
    mensaje: 'llámame en 30 segundos',
    borradorPendiente: true,
    repreguntar: () =>
      (async function* () {
        yield { modelo: 'zai.glm-5' };
        yield { herramienta: { nombre: 'llamarme', input: { en_segundos: 30 } } };
      })(),
    usar: (h) => (usadas.push(h.nombre), true),
  });
  assert.deepEqual([p.correccion, p.cumplida, usadas], ['repregunta', true, ['llamarme']]);
});
