/**
 * EL CEREBRO RÁPIDO DE DR ELECTRUM (server/electrum/cerebro.ts pensarElectrum, lib/cerebro-rapido.ts aBedrockConManos).
 *
 * Lo que se fija aquí, sin red (el SDK de Bedrock con `send` cambiado, o un `hablar` falso):
 *  · el hilo del harness, con sus `tool_calls` y sus resultados (`role: 'tool'`), llega a Bedrock como toolUse /
 *    toolResult emparejados (una llamada sin resultado se cierra; sin herramientas, todo va como texto);
 *  · las herramientas de Electrum (no las de AU-RA) van como toolSpec con su esquema;
 *  · lo que sale vuelve en la forma que el bucle espera ({ texto, mensaje: { content, tool_calls } }) y el bucle corre
 *    la herramienta y vuelve a pensar con su resultado;
 *  · si Bedrock no da nada útil, ESA vuelta la piensa el Qwen del nodo, con el protocolo Hermes; si ya dijo algo, no;
 *  · sus fallos no degradan la salud ni el cortacircuitos de AU-RA.
 */
import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BedrockRuntimeClient } from '@aws-sdk/client-bedrock-runtime';
import { aBedrockConManos, type MensajeConManos } from '../lib/cerebro-rapido';
import { herramientasNativas, leerLlamadas } from '../lib/agente/protocolo';
import { correrAgente, type Mensaje } from '../lib/agente/bucle';
import type { Herramienta } from '../lib/agente/tipos';

let C: typeof import('../server/electrum/cerebro');
let R: typeof import('../lib/cerebro-rapido');
let I: typeof import('../lib/cognitivo/interruptor');

const original = BedrockRuntimeClient.prototype.send;
const ENV = ['CEREBRO_VOZ_PRIMERA_MS', 'CEREBRO_VOZ_TOTAL_MS', 'CEREBRO_VOZ_LANZAMIENTOS', 'CEREBRO_VOZ_RESPALDO', 'CEREBRO_VOZ_EXTRA', 'ELECTRUM_CEREBRO', 'CEREBRO_VOZ'];

before(async () => {
  process.env.AWS_ACCESS_KEY_ID = 'AKIAPRUEBA';
  process.env.AWS_SECRET_ACCESS_KEY = 'prueba';
  process.env.AWS_REGION = 'us-west-2';
  C = await import('../server/electrum/cerebro');
  R = await import('../lib/cerebro-rapido');
  I = await import('../lib/cognitivo/interruptor');
});
beforeEach(() => {
  for (const k of ENV) delete process.env[k];
  R.reiniciarSaludModelos();
  I.resetInterruptoresTest();
  (BedrockRuntimeClient.prototype as any).send = original;
});
after(() => {
  (BedrockRuntimeClient.prototype as any).send = original;
});

/** Una herramienta de Electrum de mentira (la forma de manos.ts). */
const catastro: Herramienta = {
  nombre: 'catastro_buscar',
  descripcion: 'Busca concesiones mineras en el catastro por nombre o código.',
  plataformas: ['electrum'],
  esquema: { type: 'object', properties: { texto: { type: 'string', description: 'Nombre o código' } }, required: ['texto'] },
  ejecutar: async (args) => ({ ok: true, texto: `Clavo Rico (${String(args.texto)}): 120 ha, vigente hasta 2027.`, ui: { accion: 'volar', concesion_id: 7 } }),
};

describe('el hilo del harness, como lo pide Bedrock', () => {
  const hilo: MensajeConManos[] = [
    { role: 'system', content: 'Sos Dr Electrum.' },
    { role: 'user', content: '¿Dónde queda Clavo Rico?' },
    {
      role: 'assistant',
      content: 'Déjame mirar el catastro.',
      tool_calls: [
        { id: 'el_1', type: 'function', function: { name: 'catastro_buscar', arguments: { texto: 'Clavo Rico' } } },
        { id: 'el:2', type: 'function', function: { name: 'gis_medir', arguments: '{"concesion_id": 7}' } },
      ],
    },
    { role: 'tool', tool_name: 'catastro_buscar', tool_call_id: 'el_1', content: 'Clavo Rico: 120 ha.' },
  ];

  it('con herramientas: toolUse y toolResult emparejados; la que no volvió se cierra', () => {
    const { system, messages } = aBedrockConManos([...hilo, { role: 'user', content: '(Sistema) Redactá la respuesta.' }], { nativas: true });
    assert.deepEqual(system, [{ text: 'Sos Dr Electrum.' }]);
    assert.deepEqual(
      messages.map((m) => m.role),
      ['user', 'assistant', 'user']
    );
    const asis = messages[1].content as any[];
    assert.equal(asis[0].text, 'Déjame mirar el catastro.');
    assert.deepEqual(asis[1].toolUse, { toolUseId: 'el_1', name: 'catastro_buscar', input: { texto: 'Clavo Rico' } });
    // El id con caracteres que Bedrock no acepta se limpia; los argumentos en texto JSON se leen.
    assert.deepEqual(asis[2].toolUse, { toolUseId: 'el2', name: 'gis_medir', input: { concesion_id: 7 } });
    const res = messages[2].content as any[];
    assert.deepEqual(res[0].toolResult, { toolUseId: 'el_1', content: [{ text: 'Clavo Rico: 120 ha.' }] });
    assert.equal(res[1].toolResult.toolUseId, 'el2');
    assert.equal(res[1].toolResult.status, 'error', 'sin resultado: se cierra diciendo que no se ejecutó');
    // Lo que el bucle le dice después va en el mismo mensaje de la persona, detrás de los resultados.
    assert.equal(res[2].text, '(Sistema) Redactá la respuesta.');
  });

  it('un resultado sin id se empareja por nombre; termina siempre en la persona', () => {
    const { messages } = aBedrockConManos(
      [
        { role: 'user', content: 'hola' },
        { role: 'assistant', content: '', tool_calls: [{ id: 'a1', function: { name: 'catastro_buscar', arguments: {} } }] },
        { role: 'tool', tool_name: 'catastro_buscar', content: 'Esa llamada ya la hiciste.' },
      ],
      { nativas: true }
    );
    assert.equal(messages[messages.length - 1].role, 'user');
    assert.equal((messages[2].content as any[])[0].toolResult.toolUseId, 'a1');
    assert.equal((messages[1].content as any[]).length, 1, 'sin texto vacío delante del toolUse');
  });

  it('sin herramientas (la vuelta de cierre): todo como texto, sin un solo bloque de herramienta', () => {
    const { messages } = aBedrockConManos(hilo, { nativas: false });
    const bloques = messages.flatMap((m) => m.content as any[]);
    assert.ok(bloques.every((b) => typeof b.text === 'string'), 'Bedrock no acepta toolUse sin toolConfig');
    assert.match(String((messages[1].content as any[])[0].text), /Pedí «catastro_buscar»/);
    assert.match(String((messages[2].content as any[])[0].text), /Resultado de «catastro_buscar»\) Clavo Rico: 120 ha\./);
  });

  it('las herramientas de Electrum, como toolSpec con su esquema', () => {
    const [t] = C.aHerramientasBedrock(herramientasNativas([catastro]));
    assert.equal(t.toolSpec?.name, 'catastro_buscar');
    assert.equal(t.toolSpec?.description, catastro.descripcion);
    assert.deepEqual((t.toolSpec?.inputSchema as any).json, { type: 'object', properties: catastro.esquema.properties, required: ['texto'] });
  });
});

describe('pensarElectrum: una vuelta del bucle', () => {
  const base = { mensajes: [{ role: 'system', content: 'Sos Dr Electrum.' }, { role: 'user', content: '¿Clavo Rico?' }] as Mensaje[], herramientas: herramientasNativas([catastro]), msRestante: 30_000 };

  it('junta texto y herramientas en la forma del bucle, y suelta el texto mientras llega', async () => {
    const trozos: string[] = [];
    let modelo = '';
    const r = await C.pensarElectrum(
      { ...base, alTexto: (t) => trozos.push(t), alModelo: (m) => (modelo = m.modelo) },
      {
        hablar: async function* (_m, tools, _s, o) {
          assert.equal(tools[0].toolSpec?.name, 'catastro_buscar');
          assert.equal(o?.espacio, 'electrum', 'su propia salud');
          assert.equal(o?.conVueltas, true);
          yield { modelo: 'zai.glm-5' };
          yield { texto: 'Déjame mirar ' };
          yield { texto: 'el catastro.' };
          yield { herramienta: { nombre: 'catastro_buscar', input: { texto: 'Clavo Rico' } } };
          yield { fin: { motivo: 'tool_use', estado: 'completo' } };
        },
      }
    );
    assert.equal(modelo, 'zai.glm-5');
    assert.deepEqual(trozos, ['Déjame mirar ', 'el catastro.']);
    assert.equal(r.texto, 'Déjame mirar el catastro.');
    assert.equal(r.mensaje.content, r.texto);
    const llamadas = leerLlamadas(r.mensaje, r.texto, [catastro]);
    assert.equal(llamadas.length, 1);
    assert.deepEqual(llamadas[0].argumentos, { texto: 'Clavo Rico' });
    assert.match(String(llamadas[0].id), /^el_[0-9a-f]+$/);
  });

  it('Bedrock no da nada útil: esta vuelta la piensa el Qwen del nodo, con el protocolo Hermes', async () => {
    let pedido: Mensaje[] = [];
    const trozos: string[] = [];
    const r = await C.pensarElectrum(
      { ...base, alTexto: (t) => trozos.push(t) },
      {
        hablar: async function* () {
          throw new Error('el cerebro con manos no dio su primera señal útil en 7000 ms');
        },
        qwen: async (mensajes, _h, msRestante) => {
          pedido = mensajes;
          assert.ok(msRestante > 0 && msRestante <= 30_000);
          return { texto: 'Clavo Rico tiene 120 ha.', mensaje: { content: 'Clavo Rico tiene 120 ha.' } };
        },
      }
    );
    assert.equal(r.texto, 'Clavo Rico tiene 120 ha.');
    assert.match(String(pedido[0].content), /<tool_call>/, 'el nodo recibe el protocolo Hermes en el system');
    assert.match(String(pedido[0].content), /catastro_buscar/);
    assert.deepEqual(trozos, ['Clavo Rico tiene 120 ha.'], 'lo del nodo también se dice');
  });

  it('si ya dijo algo y se corta, se queda con lo dicho (no se repite con otro)', async () => {
    let alNodo = false;
    const r = await C.pensarElectrum(base, {
      hablar: async function* () {
        yield { modelo: 'zai.glm-5' };
        yield { texto: 'La concesión está vigente.' };
        throw new Error('se quedó callado a media respuesta');
      },
      qwen: async () => {
        alNodo = true;
        return { texto: 'otra', mensaje: {} };
      },
    });
    assert.equal(alNodo, false);
    assert.equal(r.texto, 'La concesión está vigente.');
  });

  it('quien preguntaba se fue: lanza, sin ir al nodo', async () => {
    const corte = new AbortController();
    let alNodo = false;
    await assert.rejects(
      C.pensarElectrum(
        { ...base, senal: corte.signal },
        {
          hablar: async function* (_m, _t, senal) {
            corte.abort();
            if (senal?.aborted) throw new Error('la persona interrumpió');
            yield { modelo: 'x' };
          },
          qwen: async () => {
            alNodo = true;
            return { texto: '', mensaje: {} };
          },
        }
      )
    );
    assert.equal(alNodo, false);
  });

  it('sin tiempo para pensar, ni siquiera llama', async () => {
    await assert.rejects(C.pensarElectrum({ ...base, msRestante: 500 }), /sin tiempo/);
  });
});

describe('con el bucle de verdad', () => {
  it('pide la herramienta, el bucle la corre y la segunda vuelta recibe su resultado como toolResult', async () => {
    const pedidos: any[] = [];
    (BedrockRuntimeClient.prototype as any).send = async function (cmd: any) {
      pedidos.push(cmd.input);
      const n = pedidos.length;
      const evs =
        n === 1
          ? [
              { contentBlockDelta: { delta: { text: 'Déjame mirar el catastro.' } } },
              { contentBlockStop: {} },
              { contentBlockStart: { start: { toolUse: { name: 'catastro_buscar', toolUseId: 'x' } } } },
              { contentBlockDelta: { delta: { toolUse: { input: '{"texto":"Clavo Rico"}' } } } },
              { contentBlockStop: {} },
              { messageStop: { stopReason: 'tool_use' } },
            ]
          : [{ contentBlockDelta: { delta: { text: 'Clavo Rico tiene 120 ha y está vigente hasta 2027.' } } }, { contentBlockStop: {} }, { messageStop: { stopReason: 'end_turn' } }];
      return { stream: (async function* () { for (const e of evs) yield e; })() };
    };
    const trozos: string[] = [];
    const r = await correrAgente({
      mensajes: [
        { role: 'system', content: 'Sos Dr Electrum.' },
        { role: 'user', content: '¿Dónde queda Clavo Rico?' },
      ],
      herramientas: [catastro],
      ctx: { quien: null, nivel: 'lee', plataforma: 'electrum', canal: 'mesa', mensaje: '¿Dónde queda Clavo Rico?' },
      nativo: true,
      pensar: (p) => C.pensarElectrum({ ...p, alTexto: (t) => trozos.push(t) }),
      presupuesto: { rondas: 3, llamadas: 8, ms: 30_000 },
    });
    assert.equal(r.fin, 'contestó');
    assert.equal(r.texto, 'Clavo Rico tiene 120 ha y está vigente hasta 2027.');
    assert.deepEqual(r.ui, [{ herramienta: 'catastro_buscar', accion: 'volar', concesion_id: 7 }]);
    assert.equal(pedidos.length, 2);
    // Primera vuelta: sin protocolo Hermes en el system (van nativas) y con las herramientas de Electrum.
    assert.doesNotMatch(String(pedidos[0].system[0].text), /<tool_call>/);
    assert.deepEqual(
      pedidos[0].toolConfig.tools.map((t: any) => t.toolSpec.name),
      ['catastro_buscar']
    );
    // Segunda vuelta: el toolUse del asistente y su toolResult con el mismo id.
    const [, asis, res] = pedidos[1].messages;
    const uso = asis.content.find((b: any) => b.toolUse).toolUse;
    const resultado = res.content.find((b: any) => b.toolResult).toolResult;
    assert.equal(uso.name, 'catastro_buscar');
    assert.equal(resultado.toolUseId, uso.toolUseId);
    assert.match(resultado.content[0].text, /120 ha, vigente hasta 2027/);
    assert.deepEqual(trozos, ['Déjame mirar el catastro.', 'Clavo Rico tiene 120 ha y está vigente hasta 2027.']);
  });
});

describe('su salud es suya', () => {
  it('los fallos de Electrum no degradan ni apagan el cerebro rápido de AU-RA', async () => {
    process.env.CEREBRO_VOZ_RESPALDO = 'no';
    process.env.CEREBRO_VOZ_LANZAMIENTOS = '1';
    (BedrockRuntimeClient.prototype as any).send = async function () {
      throw new Error('ThrottlingException');
    };
    const base = { mensajes: [{ role: 'user', content: 'hola' }] as Mensaje[], herramientas: [], msRestante: 10_000 };
    for (let i = 0; i < R.FALLOS_PARA_APAGAR; i++) {
      await C.pensarElectrum(base, { qwen: async () => ({ texto: 'del nodo', mensaje: {} }) });
    }
    assert.equal(R.modeloDegradado('zai.glm-5'), false, 'AU-RA: GLM-5 sigue primero');
    assert.equal(R.modeloDegradado('zai.glm-5', Date.now(), 'electrum'), true, 'Electrum: va detrás de los sanos');
    assert.equal(I.disponible('cerebro_rapido'), true, 'el cortacircuitos de AU-RA sigue cerrado');
    assert.equal(I.disponible('cerebro_rapido_electrum'), false, 'el de Electrum se abrió');
    assert.equal(C.modoCerebroElectrum({ ...process.env, ELECTRUM_CEREBRO: '' }), 'qwen', 'con el suyo abierto, el nodo');
  });

  it('ELECTRUM_CEREBRO: qwen apaga Bedrock; rapido vale aunque AU-RA esté en CEREBRO_VOZ=qwen', () => {
    const env = { AWS_ACCESS_KEY_ID: 'a', AWS_SECRET_ACCESS_KEY: 'b' } as NodeJS.ProcessEnv;
    assert.equal(C.modoCerebroElectrum({ ...env }), 'rapido');
    assert.equal(C.modoCerebroElectrum({ ...env, ELECTRUM_CEREBRO: 'qwen' }), 'qwen');
    assert.equal(C.modoCerebroElectrum({ ...env, CEREBRO_VOZ: 'qwen' }), 'qwen', 'por omisión sigue a la voz de AU-RA');
    assert.equal(C.modoCerebroElectrum({ ...env, CEREBRO_VOZ: 'qwen', ELECTRUM_CEREBRO: 'rapido' }), 'rapido');
    assert.equal(C.modoCerebroElectrum({ ELECTRUM_CEREBRO: 'rapido' } as NodeJS.ProcessEnv), 'qwen', 'sin credenciales, no');
  });
});
