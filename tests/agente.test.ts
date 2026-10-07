/**
 * Harness agéntico.
 *
 * El bucle recibe la función `pensar`, así que se prueba entero sin tocar la red: se le pone un
 * modelo de mentira que emite exactamente lo que se quiere probar. Es la única forma de saber que el
 * presupuesto, los reintentos y los errores hacen lo que dicen, porque esas ramas con un modelo de
 * verdad no se disparan cuando uno quiere.
 */
import './datos-prueba'; // la junta inventada de las pruebas (lo real vive en Render)
import test from 'node:test';
import assert from 'node:assert/strict';
import { correrAgente, type Mensaje, type Pensar } from '../lib/agente/bucle';
import { deHermes, deLegado, deNativo, herramientasNativas, instruccionHermes, leerLlamadas, limpiarTexto, validar } from '../lib/agente/protocolo';
import type { Contexto, Herramienta } from '../lib/agente/tipos';

const CTX: Contexto = { quien: 'jose', nivel: 'mando', plataforma: 'electrum', canal: 'mesa', mensaje: 'prueba' };
const CONSULTA: Contexto = { ...CTX, nivel: 'lee' };

const clima: Herramienta = {
  nombre: 'clima',
  descripcion: 'Dice el clima de una ciudad. Usala solo si preguntan por el tiempo.',
  esquema: { type: 'object', properties: { ciudad: { type: 'string', description: 'Ciudad' } }, required: ['ciudad'] },
  plataformas: ['electrum'],
  async ejecutar(a) {
    return { ok: true, texto: `En ${a.ciudad} hay 24 grados.`, ui: { ciudad: a.ciudad } };
  },
};

const sumar: Herramienta = {
  nombre: 'sumar',
  descripcion: 'Suma dos números.',
  esquema: {
    type: 'object',
    properties: { a: { type: 'number', description: 'primero' }, b: { type: 'number', description: 'segundo' } },
    required: ['a', 'b'],
  },
  plataformas: ['electrum'],
  async ejecutar(x) {
    return { ok: true, texto: `Son ${(x.a as number) + (x.b as number)}.` };
  },
};

const borrar: Herramienta = {
  nombre: 'borrar_todo',
  descripcion: 'Borra la base. Peligrosa.',
  escribe: true,
  esquema: { type: 'object', properties: {} },
  plataformas: ['electrum'],
  async ejecutar() {
    return { ok: true, texto: 'Borrado.' };
  },
};

const lenta: Herramienta = {
  nombre: 'lenta',
  descripcion: 'Tarda demasiado.',
  plataformas: ['electrum'],
  msMaximo: 60,
  esquema: { type: 'object', properties: {} },
  async ejecutar() {
    await new Promise((r) => setTimeout(r, 400));
    return { ok: true, texto: 'nunca llega' };
  },
};

/** Modelo de mentira: devuelve por turno lo que se le diga. */
function modelo(...turnos: Array<string | { texto: string; mensaje?: any }>): { pensar: Pensar; vistos: Mensaje[][] } {
  let i = 0;
  const vistos: Mensaje[][] = [];
  const pensar: Pensar = async ({ mensajes }) => {
    vistos.push(JSON.parse(JSON.stringify(mensajes)));
    const t = turnos[Math.min(i++, turnos.length - 1)];
    return typeof t === 'string' ? { texto: t } : t;
  };
  return { pensar, vistos };
}

const HS = [clima, sumar, borrar, lenta];

test('leer llamadas en los tres formatos', async (t) => {
  await t.test('nativo: el servidor ya las parseó, y pueden ser varias', () => {
    const m = {
      tool_calls: [
        { function: { name: 'clima', arguments: { ciudad: 'Tegucigalpa' } } },
        { id: 'x1', function: { name: 'sumar', arguments: '{"a":2,"b":3}' } },
      ],
    };
    const l = deNativo(m);
    assert.equal(l.length, 2);
    assert.equal(l[0].argumentos.ciudad, 'Tegucigalpa');
    assert.equal(l[1].argumentos.b, 3, 'los argumentos como cadena JSON también se leen');
    assert.equal(l[1].id, 'x1');
  });

  await t.test('hermes: el formato con el que Qwen3 fue entrenado', () => {
    const texto = 'Voy a ver.\n<tool_call>{"name": "clima", "arguments": {"ciudad": "Danlí"}}</tool_call>';
    const l = deHermes(texto);
    assert.equal(l.length, 1);
    assert.equal(l[0].nombre, 'clima');
    assert.equal(l[0].via, 'hermes');
  });

  await t.test('hermes: varias seguidas', () => {
    const texto =
      '<tool_call>{"name":"clima","arguments":{"ciudad":"A"}}</tool_call><tool_call>{"name":"sumar","arguments":{"a":1,"b":1}}</tool_call>';
    assert.equal(deHermes(texto).length, 2);
  });

  await t.test('hermes: sin cerrar la etiqueta, que pasa de verdad', () => {
    const l = deHermes('<tool_call>{"name":"clima","arguments":{"ciudad":"B"}}');
    assert.equal(l.length, 1);
    assert.equal(l[0].argumentos.ciudad, 'B');
  });

  await t.test('hermes: JSON roto se ignora sin tumbar el turno', () => {
    assert.deepEqual(deHermes('<tool_call>{esto no es json}</tool_call>'), []);
  });

  await t.test('legado: la línea vieja sigue funcionando', () => {
    const l = deLegado('PEDIR_HERRAMIENTA: clima Tegucigalpa', new Set(['clima']));
    assert.equal(l.length, 1);
    assert.equal(l[0].argumentos.consulta, 'Tegucigalpa');
    assert.equal(l[0].via, 'legado');
  });

  await t.test('una herramienta que no existe se descarta', () => {
    assert.deepEqual(leerLlamadas(null, '<tool_call>{"name":"lanzar_misil","arguments":{}}</tool_call>', HS), []);
  });

  await t.test('la misma llamada dos veces en una respuesta cuenta una', () => {
    const texto = '<tool_call>{"name":"clima","arguments":{"ciudad":"A"}}</tool_call><tool_call>{"name":"clima","arguments":{"ciudad":"A"}}</tool_call>';
    assert.equal(leerLlamadas(null, texto, HS).length, 1);
  });

  await t.test('las etiquetas no se leen en voz alta', () => {
    const t2 = limpiarTexto('Ahí va.\n<tool_call>{"name":"clima","arguments":{}}</tool_call>\nPEDIR_HERRAMIENTA: clima X');
    assert.equal(t2, 'Ahí va.');
  });
});

test('las herramientas se le ofrecen al modelo en su idioma', async (t) => {
  await t.test('formato nativo, el de Ollama y las APIs tipo OpenAI', () => {
    const n = herramientasNativas([clima]);
    assert.equal(n[0].type, 'function');
    assert.equal(n[0].function.name, 'clima');
    assert.equal(n[0].function.parameters.required![0], 'ciudad');
  });

  await t.test('instrucción Hermes cuando el servidor no acepta tools', () => {
    const i = instruccionHermes([clima]);
    assert.match(i, /<tool_call>/);
    assert.match(i, /<tools>/);
    assert.match(i, /"name":"clima"/);
    assert.match(i, /no inventes/i);
  });
});

test('validación de argumentos', async (t) => {
  await t.test('convierte lo que llega como texto', () => {
    const v = validar(sumar.esquema, { a: '2,5', b: 3 });
    assert.ok(v.ok);
    assert.equal((v as any).args.a, 2.5);
  });

  await t.test('un campo obligatorio que falta se explica, no se traga', () => {
    const v = validar(sumar.esquema, { a: 1 });
    assert.equal(v.ok, false);
    assert.match((v as any).error, /Falta el campo «b»/);
  });

  await t.test('un número que no es número se explica', () => {
    const v = validar(sumar.esquema, { a: 'hola', b: 1 });
    assert.match((v as any).error, /tiene que ser un número/);
  });

  await t.test('enum fuera de lista', () => {
    const e = { type: 'object' as const, properties: { modo: { type: 'string', description: 'm', enum: ['a', 'b'] } }, required: ['modo'] };
    assert.match((validar(e, { modo: 'z' }) as any).error, /solo admite: a, b/);
  });
});

test('el bucle', async (t) => {
  await t.test('llama, ve el resultado y contesta', async () => {
    const { pensar, vistos } = modelo('<tool_call>{"name":"clima","arguments":{"ciudad":"Danlí"}}</tool_call>', 'En Danlí hay veinticuatro grados.');
    const r = await correrAgente({ mensajes: [{ role: 'user', content: 'qué tiempo hace' }], herramientas: HS, ctx: CTX, pensar });
    assert.equal(r.fin, 'contestó');
    assert.equal(r.texto, 'En Danlí hay veinticuatro grados.');
    assert.equal(r.traza.length, 1);
    assert.equal(r.traza[0].ok, true);
    // El resultado de la herramienta tiene que haberle llegado al modelo.
    const ultimos = vistos[1];
    assert.equal(ultimos[ultimos.length - 1].role, 'tool');
    assert.match((ultimos[ultimos.length - 1] as any).content, /24 grados/);
  });

  await t.test('varias herramientas en la misma ronda', async () => {
    const { pensar } = modelo(
      { texto: '', mensaje: { tool_calls: [{ function: { name: 'clima', arguments: { ciudad: 'A' } } }, { function: { name: 'sumar', arguments: { a: 2, b: 2 } } }] } },
      'Listo.'
    );
    const r = await correrAgente({ mensajes: [{ role: 'user', content: 'x' }], herramientas: HS, ctx: CTX, pensar, nativo: true });
    assert.equal(r.traza.length, 2);
    assert.equal(r.fin, 'contestó');
  });

  await t.test('deja datos para la interfaz sin que el modelo escriba coordenadas', async () => {
    const { pensar } = modelo('<tool_call>{"name":"clima","arguments":{"ciudad":"Danlí"}}</tool_call>', 'Ahí está.');
    const vivos: unknown[] = [];
    const r = await correrAgente({
      mensajes: [{ role: 'user', content: 'x' }],
      herramientas: HS,
      ctx: CTX,
      pensar,
      alVivo: (_t, ui) => ui && vivos.push(ui),
    });
    assert.equal((r.ui[0] as any).ciudad, 'Danlí');
    assert.equal(vivos.length, 1, 'la interfaz se entera en el momento, no al final');
  });

  await t.test('un argumento inválido vuelve al modelo con el motivo, y corrige', async () => {
    const { pensar, vistos } = modelo(
      '<tool_call>{"name":"sumar","arguments":{"a":1}}</tool_call>',
      '<tool_call>{"name":"sumar","arguments":{"a":1,"b":2}}</tool_call>',
      'Son tres.'
    );
    const r = await correrAgente({ mensajes: [{ role: 'user', content: 'sumá' }], herramientas: HS, ctx: CTX, pensar });
    assert.equal(r.texto, 'Son tres.');
    assert.equal(r.traza[0].ok, false);
    assert.match(r.traza[0].resumen, /Falta el campo «b»/);
    assert.equal(r.traza[1].ok, true);
    // El modelo tuvo que VER el error para poder corregir.
    assert.match(JSON.stringify(vistos[1]), /Falta el campo/);
  });

  await t.test('repetir la misma llamada no la ejecuta dos veces', async () => {
    let veces = 0;
    const contada: Herramienta = { ...clima, async ejecutar(a) { veces++; return { ok: true, texto: `ok ${a.ciudad}` }; } };
    const { pensar } = modelo(
      '<tool_call>{"name":"clima","arguments":{"ciudad":"A"}}</tool_call>',
      '<tool_call>{"name":"clima","arguments":{"ciudad":"A"}}</tool_call>',
      'Ya está.'
    );
    const r = await correrAgente({ mensajes: [{ role: 'user', content: 'x' }], herramientas: [contada], ctx: CTX, pensar });
    assert.equal(veces, 1, 'la segunda vez se le devuelve lo de antes, no se vuelve a ejecutar');
    assert.equal(r.texto, 'Ya está.');
  });

  await t.test('una herramienta que escribe no corre con acceso de consulta', async () => {
    const { pensar } = modelo('<tool_call>{"name":"borrar_todo","arguments":{}}</tool_call>', 'No puedo hacer eso.');
    const r = await correrAgente({ mensajes: [{ role: 'user', content: 'borrá todo' }], herramientas: HS, ctx: CONSULTA, pensar });
    assert.equal(r.traza[0].ok, false);
    assert.match(r.traza[0].resumen, /consulta/);
  });

  await t.test('una herramienta colgada no cuelga el turno', async () => {
    const { pensar } = modelo('<tool_call>{"name":"lenta","arguments":{}}</tool_call>', 'Se tardó demasiado.');
    const t0 = Date.now();
    const r = await correrAgente({ mensajes: [{ role: 'user', content: 'x' }], herramientas: HS, ctx: CTX, pensar });
    assert.ok(Date.now() - t0 < 350, 'debió cortarla antes de que terminara');
    assert.equal(r.traza[0].ok, false);
    assert.match(r.traza[0].resumen, /tardó más de/);
    assert.equal(r.traza[0].estado, 'failed', 'una lectura que no contestó no hizo nada: fallo');
  });

  await t.test('EXEC03: una herramienta con efecto que vence su tope queda «unknown» y recibe la señal de cancelar', async () => {
    let senalVista: AbortSignal | undefined;
    let veces = 0;
    const enviar: Herramienta = {
      nombre: 'enviar_aviso',
      descripcion: 'Manda un aviso.',
      escribe: true,
      plataformas: ['electrum'],
      msMaximo: 60,
      esquema: { type: 'object', properties: {} },
      async ejecutar(_a, ctx) {
        veces++;
        senalVista = ctx.senal;
        // Ya lo despachó y se queda esperando la confirmación (que llega tarde).
        await new Promise((r) => setTimeout(r, 300));
        return { ok: true, texto: 'Aviso enviado.' };
      },
    };
    const { pensar, vistos } = modelo('<tool_call>{"name":"enviar_aviso","arguments":{}}</tool_call>', '<tool_call>{"name":"enviar_aviso","arguments":{}}</tool_call>', 'No sé si salió; lo reviso.');
    const r = await correrAgente({ mensajes: [{ role: 'user', content: 'avisa' }], herramientas: [enviar], ctx: CTX, pensar });
    assert.equal(r.traza.length, 1);
    assert.equal(r.traza[0].estado, 'unknown', 'dejar de esperar no es un fallo: pudo haber salido');
    assert.equal(r.traza[0].ok, false, 'y tampoco un éxito');
    assert.equal(senalVista?.aborted, true, 'la herramienta recibió la señal de cancelar, no solo se dejó de esperar');
    assert.match(JSON.stringify(vistos[1]), /no sé si se hizo|No lo repitas/i);
    assert.equal(veces, 1, 'el reintento del modelo no la vuelve a correr');
  });

  await t.test('el presupuesto de rondas corta el bucle infinito', async () => {
    // Un modelo que pide la misma herramienta con argumentos distintos para siempre.
    let n = 0;
    const pensar: Pensar = async () => ({ texto: `<tool_call>{"name":"clima","arguments":{"ciudad":"C${n++}"}}</tool_call>` });
    const r = await correrAgente({ mensajes: [{ role: 'user', content: 'x' }], herramientas: HS, ctx: CTX, pensar, presupuesto: { rondas: 2 } });
    assert.equal(r.fin, 'sin rondas');
    assert.equal(r.rondas, 3, 'dos rondas de herramientas y una para cerrar');
    assert.ok(r.texto.length > 0, 'aun así tiene que decir algo');
  });

  await t.test('el tope de llamadas también corta', async () => {
    const pensar: Pensar = async () => ({
      texto: [0, 1, 2, 3, 4].map((i) => `<tool_call>{"name":"clima","arguments":{"ciudad":"C${i}"}}</tool_call>`).join(''),
    });
    const r = await correrAgente({ mensajes: [{ role: 'user', content: 'x' }], herramientas: HS, ctx: CTX, pensar, presupuesto: { llamadas: 3, rondas: 2 } });
    assert.ok(r.traza.length <= 3, `ejecutó ${r.traza.length} y el tope era 3`);
  });

  await t.test('sin herramientas pedidas contesta directo, sin dar vueltas', async () => {
    const { pensar } = modelo('Hola, todo bien.');
    const r = await correrAgente({ mensajes: [{ role: 'user', content: 'hola' }], herramientas: HS, ctx: CTX, pensar });
    assert.equal(r.fin, 'contestó');
    assert.equal(r.rondas, 1);
    assert.equal(r.traza.length, 0);
  });

  await t.test('si el servidor no acepta tools, la instrucción Hermes entra en el system', async () => {
    const { pensar, vistos } = modelo('Listo.');
    await correrAgente({ mensajes: [{ role: 'system', content: 'Sos Electrum.' }, { role: 'user', content: 'x' }], herramientas: [clima], ctx: CTX, pensar });
    assert.match((vistos[0][0] as any).content, /Sos Electrum/);
    assert.match((vistos[0][0] as any).content, /<tool_call>/);
  });

  await t.test('con tools nativo NO se ensucia el system', async () => {
    const { pensar, vistos } = modelo('Listo.');
    await correrAgente({ mensajes: [{ role: 'system', content: 'Sos Electrum.' }, { role: 'user', content: 'x' }], herramientas: [clima], ctx: CTX, pensar, nativo: true });
    assert.equal((vistos[0][0] as any).content, 'Sos Electrum.');
  });
});

test('el harness avisa EN VIVO, no al final', async (t) => {
  /*
   * El gancho `alVivo` existía desde el principio, con un comentario que prometía que «el mapa no
   * espera al final» — y nadie lo consumía, así que el mapa sí esperaba. Esta prueba fija la
   * promesa: cada herramienta avisa cuando TERMINA ELLA, no cuando termina el turno.
   */
  const lento: Herramienta = {
    nombre: 'lento',
    descripcion: 'tarda a propósito',
    esquema: { type: 'object', properties: {} },
    plataformas: ['electrum'],
    async ejecutar() {
      await new Promise((r) => setTimeout(r, 60));
      return { ok: true, texto: 'listo', ui: { accion: 'volar', geojson: {} } };
    },
  };

  let ronda = 0;
  const pensar = async () => {
    ronda += 1;
    if (ronda === 1) return { texto: '<tool_call>{"name":"lento","arguments":{}}</tool_call>' };
    await new Promise((r) => setTimeout(r, 120)); // el modelo redactando la respuesta final
    return { texto: 'Ya está.' };
  };

  const t0 = Date.now();
  const avisos: Array<{ ms: number; ui: boolean }> = [];
  const r = await correrAgente({
    mensajes: [{ role: 'user', content: 'x' }],
    herramientas: [lento],
    ctx: CTX,
    pensar,
    alVivo: (_t, ui) => avisos.push({ ms: Date.now() - t0, ui: !!ui }),
  });
  const total = Date.now() - t0;

  await t.test('avisó una vez, con los datos para el mapa', () => {
    assert.equal(avisos.length, 1);
    assert.equal(avisos[0].ui, true, 'el aviso trae la ui: es lo que mueve el mapa');
  });

  await t.test('avisó bastante antes de terminar el turno', () => {
    // La herramienta tarda 60 ms y el modelo 120 ms más en redactar. El aviso tiene que llegar en
    // ese hueco, no al final: si llegara al final, esta diferencia sería casi cero.
    assert.ok(avisos[0].ms < total - 80, `avisó a +${avisos[0].ms}ms de un turno de ${total}ms`);
    assert.match(r.texto, /Ya está/);
  });
});

/* ------------------------------------------------- el reloj del turno (F05/F06) */

test('el presupuesto de tiempo manda de verdad', async (t) => {
  await t.test('la llamada al modelo sabe cuánto le queda al turno', async () => {
    // Antes `restante` se calculaba en el bucle y NO se usaba: el modelo corría con su propio tope
    // de sesenta segundos, así que un turno con presupuesto de cincuenta podía tardar ciento diez,
    // y el cliente —que esperaba cuarenta y cinco— ya se había ido.
    const vistos: number[] = [];
    const pensar: Pensar = async ({ msRestante }) => {
      vistos.push(msRestante);
      await new Promise((r) => setTimeout(r, 40));
      return vistos.length === 1
        ? { texto: '<tool_call>{"name":"clima","arguments":{"ciudad":"Danlí"}}</tool_call>' }
        : { texto: 'Listo.' };
    };
    await correrAgente({
      mensajes: [{ role: 'user', content: 'x' }],
      herramientas: HS,
      ctx: CTX,
      pensar,
      presupuesto: { ms: 5_000 },
    });
    assert.equal(vistos.length, 2);
    assert.ok(vistos[0] <= 5_000, 'nunca puede prometer más de lo que queda');
    assert.ok(vistos[1] < vistos[0], `la segunda ronda tiene menos tiempo: ${vistos[1]} vs ${vistos[0]}`);
  });

  await t.test('si la llamada se corta por tiempo, el turno NO se cae: entrega lo que averiguó', async () => {
    let n = 0;
    const pensar: Pensar = async () => {
      n++;
      if (n === 1) return { texto: '<tool_call>{"name":"clima","arguments":{"ciudad":"Danlí"}}</tool_call>' };
      const e = new Error('The operation was aborted due to timeout');
      e.name = 'TimeoutError';
      throw e;
    };
    const r = await correrAgente({ mensajes: [{ role: 'user', content: 'x' }], herramientas: HS, ctx: CTX, pensar });
    assert.equal(r.fin, 'sin tiempo');
    // Lo que importa: la consulta del clima ya estaba hecha y no se tira a la basura.
    assert.ok(r.traza.some((x) => x.ok), 'la traza de lo que sí funcionó se conserva');
    assert.match(r.texto, /tiempo/i);
  });

  await t.test('si el cerebro se cae, se dice que se cayó y no se inventa nada', async () => {
    let n = 0;
    const pensar: Pensar = async () => {
      n++;
      if (n === 1) return { texto: '<tool_call>{"name":"clima","arguments":{"ciudad":"Danlí"}}</tool_call>' };
      throw new Error('ECONNREFUSED 10.0.0.9:11434');
    };
    const r = await correrAgente({ mensajes: [{ role: 'user', content: 'x' }], herramientas: HS, ctx: CTX, pensar });
    assert.equal(r.fin, 'cerebro caído');
    assert.ok(r.traza.some((x) => x.ok));
    assert.match(r.texto, /ECONNREFUSED/);
    assert.ok(!/no sé|quizás/i.test(r.texto), 'no rellena el hueco con una respuesta inventada');
  });

  await t.test('el turno no se pasa de su presupuesto', async () => {
    // Un modelo que siempre tarda más de lo que queda. Sin acotar la llamada con `msRestante`,
    // esto se iría muy por encima del presupuesto.
    const pensar: Pensar = async ({ msRestante }) => {
      await new Promise((r) => setTimeout(r, Math.min(msRestante, 300)));
      return { texto: '<tool_call>{"name":"clima","arguments":{"ciudad":"Danlí"}}</tool_call>' };
    };
    const t0 = Date.now();
    const r = await correrAgente({
      mensajes: [{ role: 'user', content: 'x' }],
      herramientas: HS,
      ctx: CTX,
      pensar,
      presupuesto: { ms: 600, rondas: 20, llamadas: 40 },
    });
    const total = Date.now() - t0;
    assert.ok(total < 1_500, `el turno tardó ${total}ms con presupuesto de 600ms`);
    assert.ok(r.fin === 'sin tiempo' || r.fin === 'sin rondas' || r.fin === 'sin llamadas', `terminó por ${r.fin}`);
  });
});

test('si quien preguntaba se fue, el turno deja de gastar', async (t) => {
  await t.test('no empieza una ronda nueva', async () => {
    let rondas = 0;
    let fuera = false;
    const pensar: Pensar = async () => {
      rondas++;
      fuera = true; // se va justo después de la primera vuelta
      return { texto: '<tool_call>{"name":"clima","arguments":{"ciudad":"Danlí"}}</tool_call>' };
    };
    const r = await correrAgente({
      mensajes: [{ role: 'user', content: 'x' }],
      herramientas: HS,
      ctx: CTX,
      pensar,
      abandonado: () => fuera,
      presupuesto: { rondas: 5, llamadas: 20, ms: 10_000 },
    });
    assert.equal(r.fin, 'abandonado');
    assert.equal(rondas, 1, 'no vuelve a pensar para nadie');
  });

  await t.test('no arranca una herramienta nueva', async () => {
    let fuera = true;
    const pensar: Pensar = async () => ({
      texto: '<tool_call>{"name":"clima","arguments":{"ciudad":"Danlí"}}</tool_call>',
    });
    const r = await correrAgente({
      mensajes: [{ role: 'user', content: 'x' }],
      herramientas: HS,
      ctx: CTX,
      pensar,
      abandonado: () => fuera,
    });
    assert.equal(r.fin, 'abandonado');
    assert.equal(r.traza.length, 0, 'ni una herramienta corrió');
  });
});

test('lo que el modelo pide y no se puede usar vuelve al modelo en vez de perderse', async (t) => {
  await t.test('una herramienta que no tiene: se le dice cuáles tiene y contesta en texto', async () => {
    // Caso real (Telegram, 26-sep): pidió un PDF con una herramienta inexistente y el turno quedó vacío.
    const { pensar, vistos } = modelo('<tool_call>{"name":"crear_pdf","arguments":{"tema":"caliza"}}</tool_call>', 'Ese PDF no lo puedo armar con lo que tengo.');
    const r = await correrAgente({ mensajes: [{ role: 'user', content: 'hazme un pdf' }], herramientas: HS, ctx: CTX, pensar });
    assert.equal(r.fin, 'contestó');
    assert.equal(r.texto, 'Ese PDF no lo puedo armar con lo que tengo.');
    const aviso = vistos[1].at(-1)!;
    assert.equal(aviso.role, 'user');
    assert.match(String((aviso as any).content), /«crear_pdf» no es una de tus herramientas/);
    assert.match(String((aviso as any).content), /clima, sumar/);
  });
  await t.test('JSON roto dentro de la etiqueta y respuesta vacía también se devuelven', async () => {
    const { pensar, vistos } = modelo('<tool_call>{"name": "clima", "arguments": {ciudad: Tegus}}</tool_call>', '', 'Listo.');
    const r = await correrAgente({ mensajes: [{ role: 'user', content: 'x' }], herramientas: HS, ctx: CTX, pensar });
    assert.equal(r.texto, 'Listo.');
    assert.match(String((vistos[1].at(-1) as any).content), /JSON no se puede leer/);
    assert.match(String((vistos[2].at(-1) as any).content), /llegó vacía/);
  });
  await t.test('no insiste para siempre: tras dos correcciones sale lo que haya', async () => {
    const { pensar } = modelo('<tool_call>{"name":"nada"}</tool_call>');
    const r = await correrAgente({ mensajes: [{ role: 'user', content: 'x' }], herramientas: HS, ctx: CTX, pensar });
    assert.equal(r.fin, 'contestó');
    assert.equal(r.rondas, 3);
  });
});

test('al acabarse las rondas, redacta con lo que averiguó en vez de pegar resultados crudos', async () => {
  let n = 0;
  const pensar: Pensar = async ({ herramientas }) =>
    herramientas.length ? { texto: `<tool_call>{"name":"clima","arguments":{"ciudad":"C${n++}"}}</tool_call>` } : { texto: 'En resumen: llueve en las tres ciudades.' };
  const r = await correrAgente({ mensajes: [{ role: 'user', content: 'x' }], herramientas: HS, ctx: CTX, pensar, presupuesto: { rondas: 2 } });
  assert.equal(r.fin, 'sin rondas');
  assert.equal(r.texto, 'En resumen: llueve en las tres ciudades.');
  assert.doesNotMatch(r.texto, /Me quedé sin vueltas/);
});

test('si el cierre vuelve a pedir una herramienta, se le insiste una vez antes de pegar resultados crudos', async () => {
  let n = 0;
  const cierres: string[] = [];
  const pensar: Pensar = async ({ herramientas, mensajes }) => {
    if (herramientas.length) return { texto: `<tool_call>{"name":"clima","arguments":{"ciudad":"C${n++}"}}</tool_call>` };
    cierres.push(String((mensajes.at(-1) as any).content));
    // Primer cierre: otro pedido de herramienta (se limpia y queda vacío). Segundo: el texto.
    return cierres.length === 1 ? { texto: '<tool_call>{"name":"clima","arguments":{"ciudad":"Otra"}}</tool_call>' } : { texto: 'Llueve en las tres ciudades.' };
  };
  const r = await correrAgente({ mensajes: [{ role: 'user', content: 'x' }], herramientas: HS, ctx: CTX, pensar, presupuesto: { rondas: 2 } });
  assert.equal(r.fin, 'sin rondas');
  assert.equal(r.texto, 'Llueve en las tres ciudades.');
  assert.equal(cierres.length, 2);
  assert.match(cierres[1], /NO podés pedir herramientas/);
});

test('el reintento del cierre no empieza si quien preguntó ya se fue', async () => {
  let n = 0;
  let cierres = 0;
  let ido = false;
  const pensar: Pensar = async ({ herramientas }) => {
    if (herramientas.length) return { texto: `<tool_call>{"name":"clima","arguments":{"ciudad":"C${n++}"}}</tool_call>` };
    cierres++;
    ido = true; // se va mientras corre el primer cierre, que además vuelve vacío
    return { texto: '<tool_call>{"name":"clima","arguments":{"ciudad":"Otra"}}</tool_call>' };
  };
  await correrAgente({ mensajes: [{ role: 'user', content: 'x' }], herramientas: HS, ctx: CTX, pensar, presupuesto: { rondas: 2 }, abandonado: () => ido });
  assert.equal(cierres, 1, 'no hubo segundo pedido al modelo');
});

/* ------------------------------------------------ auditoría H08 y H09: un reloj y cancelación */

const dormilona: Herramienta = {
  nombre: 'dormilona',
  descripcion: 'Tarda mucho.',
  esquema: { type: 'object', properties: {}, required: [] },
  plataformas: ['electrum'],
  msMaximo: 20_000,
  async ejecutar() {
    await new Promise((r) => setTimeout(r, 3_000));
    return { ok: true, texto: 'tarde' };
  },
};
const pideDormilona = { texto: '', mensaje: { tool_calls: [{ function: { name: 'dormilona', arguments: {} } }] } };

test('H08: una herramienta no se pasa de lo que le queda al turno, aunque su tope sea mayor', async () => {
  const { pensar } = modelo(pideDormilona, 'listo');
  const t0 = Date.now();
  const r = await correrAgente({ mensajes: [{ role: 'user', content: 'x' }], herramientas: [dormilona], ctx: CTX, pensar, nativo: true, presupuesto: { ms: 1_200 } });
  const ms = Date.now() - t0;
  assert.ok(ms < 2_500, `tardó ${ms} ms con un turno de 1,2 s y una herramienta de 20 s de tope`);
  assert.equal(r.traza[0].ok, false);
  assert.match(r.traza[0].resumen, /tardó más de/);
});

test('H09: si quien preguntaba se va, se deja de esperar la herramienta en el acto', async () => {
  const { pensar } = modelo(pideDormilona, 'listo');
  const corte = new AbortController();
  setTimeout(() => corte.abort(), 150);
  const t0 = Date.now();
  const r = await correrAgente({ mensajes: [{ role: 'user', content: 'x' }], herramientas: [dormilona], ctx: CTX, pensar, nativo: true, senal: corte.signal });
  const ms = Date.now() - t0;
  assert.ok(ms < 1_000, `siguió ${ms} ms después de irse`);
  assert.equal(r.fin, 'abandonado');
});

test('H09: la llamada al modelo recibe la señal y cortarla termina el turno como abandonado', async () => {
  const corte = new AbortController();
  let recibida: AbortSignal | undefined;
  const pensar: Pensar = ({ senal }) => {
    recibida = senal;
    return new Promise((_, mal) => senal?.addEventListener('abort', () => mal(new DOMException('abortado', 'AbortError'))));
  };
  setTimeout(() => corte.abort(), 100);
  const r = await correrAgente({ mensajes: [{ role: 'user', content: 'x' }], herramientas: [], ctx: CTX, pensar, senal: corte.signal });
  assert.equal(recibida, corte.signal);
  assert.equal(r.fin, 'abandonado');
});

test('H08: el reloj del turno cuenta desde que llegó la petición', async () => {
  const { msRestanteDelTurno, PRESUPUESTO_TURNO_MS } = await import('../server/electrum/turno');
  assert.equal(msRestanteDelTurno(1_000, 1_000), PRESUPUESTO_TURNO_MS);
  assert.equal(msRestanteDelTurno(1_000, 21_000), PRESUPUESTO_TURNO_MS - 20_000, 'lo gastado antes del bucle se descuenta');
  assert.equal(msRestanteDelTurno(0, PRESUPUESTO_TURNO_MS + 5_000), 0);
});
