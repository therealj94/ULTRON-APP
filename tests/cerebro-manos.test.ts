/**
 * Las manos como herramientas (lib/cerebro-manos.ts): qué herramientas tiene cada turno y que cada llamada
 * se vuelva EXACTAMENTE la línea que el resto del servidor ya sabe validar y correr.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { herramientasDelTurno, lineaDeHerramienta, reglasDeManos, topeDeVoz, TOPE_VOZ_CHARS, type ManosDelTurno } from '../lib/cerebro-manos';
import { extraerAcciones, validarAccion } from '../lib/acciones-app';
import { extraerPedidoHerramienta } from '../lib/harness';
import { confirmaPropuesta, esAfirmacionSola, RECORDATORIO_MIN_MS } from '../lib/manos-app';

const AHORA = Date.UTC(2026, 9, 4, 4, 8); // 3-oct 22:08 en Honduras
const nombres = (d: ManosDelTurno) => herramientasDelTurno(d).map((t) => t.toolSpec!.name);
const nada: ManosDelTurno = { app: false, manos: [], sistema: false, computadora: false, correo: false, whatsapp: false, sesion: false, triaje: false };

/** La acción de la app que sale de una línea, ya validada como la valida el servidor. */
function accionDe(linea: string | null) {
  assert.ok(linea, 'sin línea');
  const { acciones, texto } = extraerAcciones(`Va.\n${linea}`);
  assert.equal(texto.trim(), 'Va.', 'la línea no se dice');
  assert.equal(acciones.length, 1);
  return validarAccion(acciones[0]);
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

test('«llámame en 30 segundos» (la llamada de José del 3-oct) es una llamada de AU-RA en 30 s, no «eso es un recordatorio»', () => {
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

test('las manos del teléfono salen con la forma del contrato de la app', () => {
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
