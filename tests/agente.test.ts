/**
 * Harness agéntico.
 *
 * El bucle recibe la función `pensar`, así que se prueba entero sin tocar la red: se le pone un
 * modelo de mentira que emite exactamente lo que se quiere probar. Es la única forma de saber que el
 * presupuesto, los reintentos y los errores hacen lo que dicen, porque esas ramas con un modelo de
 * verdad no se disparan cuando uno quiere.
 */
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
