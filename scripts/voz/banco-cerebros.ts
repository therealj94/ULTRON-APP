/**
 * ¿Qué cerebro piensa y usa sus manos bien, y rápido? (José, 3-oct: «le pedí que me llamara y no hizo la
 * llamada… toma las decisiones para que esto funcione»).
 *
 * Banco con los pedidos reales de José (la llamada de las 22:08 incluida, con su «Okey» de seguimiento) y
 * las manos como HERRAMIENTAS de verdad (toolConfig de Bedrock Converse), no como líneas de texto que el
 * modelo tiene que recordar. Mide la primera reacción (texto o herramienta), el total, y si hizo lo que
 * se pedía.
 *
 *   npx tsx scripts/voz/banco-cerebros.ts [modelo …]
 *
 * Usa las credenciales de AWS del entorno.
 */
import { BedrockRuntimeClient, ConverseStreamCommand, type Message, type Tool } from '@aws-sdk/client-bedrock-runtime';
import type { DocumentType } from '@smithy/types';

const REGION = process.env.CEREBRO_VOZ_REGION || 'us-west-2';
const cliente = new BedrockRuntimeClient({ region: REGION, maxAttempts: 1 });

const AHORA = '2026-10-03 22:08 (sábado), hora de Honduras';

const SISTEMA_CORTO = `Eres AU-RA, la compañera de José en su teléfono. Hablas con él por voz: frases cortas, cálidas, naturales, en español de Honduras. Nada de listas ni markdown.
Tienes manos (herramientas). Cuando te pida algo que una herramienta hace, ÚSALA en ese mismo turno; no expliques cómo se llama por dentro ni digas que «eso es un recordatorio». Si falta un dato imprescindible, pregúntalo en una frase.
Lo que sale de su teléfono a otra persona (llamar a alguien, mandar un mensaje) se confirma: la herramienta lo deja listo y tú le preguntas «¿Lo mando?» o «¿Le marco?». Si en el turno siguiente dice que sí («sí», «ok», «okey», «dale», «va»), lo haces con confirmado=true.
Lo que es para él mismo (que tú lo llames, un recordatorio, abrir algo, buscar) se hace directo, sin preguntar.
Ahora: ${AHORA}.
Contactos: Mamá, Beto, Ana López.`;

import { readFileSync } from 'node:fs';
/** Con SISTEMA_DE=<volcado de DEPURAR_MANOS>, el system REAL de AU-RA (con su hora y contactos) en lugar del corto. */
const SISTEMA = process.env.SISTEMA_DE ? JSON.parse(readFileSync(process.env.SISTEMA_DE, 'utf8')).system.map((x: { text: string }) => x.text).join('\n') : SISTEMA_CORTO;

const herramienta = (name: string, description: string, properties: Record<string, unknown>, required: string[] = []): Tool => ({
  toolSpec: { name, description, inputSchema: { json: { type: 'object', properties, required } as DocumentType } },
});

const HERRAMIENTAS: Tool[] = [
  herramienta('llamarme', 'Que AU-RA llame a José a su teléfono: ahora (sin segundos) o dentro de un rato (en_segundos). «Llámame», «llámame en 30 segundos», «márcame en 10 minutos».', {
    en_segundos: { type: 'integer', description: 'Dentro de cuántos segundos. 0 u omitido = ahora.' },
    motivo: { type: 'string', description: 'Para qué, si lo dijo.' },
  }),
  herramienta('recordatorio', 'Un recordatorio o alarma a una hora. AU-RA lo llama a esa hora y se lo dice.', {
    cuando: { type: 'string', description: 'AAAA-MM-DDTHH:MM, hora de Honduras.' },
    texto: { type: 'string' },
  }, ['cuando', 'texto']),
  herramienta('llamar_contacto', 'Llamar o videollamar a un contacto desde su teléfono. Sin confirmado=true solo lo deja listo y hay que preguntarle.', {
    contacto: { type: 'string' },
    video: { type: 'boolean' },
    confirmado: { type: 'boolean' },
  }, ['contacto']),
  herramienta('whatsapp_enviar', 'Mandar un WhatsApp a alguien. Sin confirmado=true deja el borrador y hay que leérselo y preguntar.', {
    para: { type: 'string' },
    texto: { type: 'string', description: 'El mensaje ya redactado, en su voz.' },
    confirmado: { type: 'boolean' },
  }, ['para', 'texto']),
  herramienta('correo', 'Su correo: revisar, buscar, leer.', { accion: { type: 'string', enum: ['revisar', 'buscar', 'leer'] }, que: { type: 'string' } }, ['accion']),
  herramienta('buscar_web', 'Buscar en internet algo de hoy o que no sabes.', { consulta: { type: 'string' } }, ['consulta']),
  herramienta('abrir', 'Abrir una pantalla de la app.', { pantalla: { type: 'string', enum: ['mesa', 'chats', 'ajustes', 'perfil', 'computadora', 'whatsapp', 'correos'] } }, ['pantalla']),
  herramienta('musica', 'Poner música (Spotify o YouTube).', { que: { type: 'string' } }, ['que']),
  herramienta('computadora', 'Usar su computadora en la nube para HACER algo en páginas web (entrar a un sitio, buscar dentro, traer datos).', { mision: { type: 'string' } }, ['mision']),
];

type Caso = {
  nombre: string;
  turnos: Message[];
  /** null = no debe usar herramienta. */
  espera: null | { tool: string; revisar?: (input: any) => boolean };
};

const u = (t: string): Message => ({ role: 'user', content: [{ text: t }] });
const a = (t: string): Message => ({ role: 'assistant', content: [{ text: t }] });

const CASOS: Caso[] = [
  { nombre: 'la de anoche: llamar en 30 s', turnos: [u('Bien, ¿me puedes hacer un, un-- otra llamada en unos 30 segundos? ¿Me vas a llamar en 30 segundos?')], espera: { tool: 'llamarme', revisar: (i) => Number(i.en_segundos) >= 20 && Number(i.en_segundos) <= 40 } },
  { nombre: 'llámame en 10 min', turnos: [u('Llámame en diez minutos.')], espera: { tool: 'llamarme', revisar: (i) => Number(i.en_segundos) === 600 } },
  { nombre: 'llámame ya', turnos: [u('Oye, llámame.')], espera: { tool: 'llamarme', revisar: (i) => !i.en_segundos } },
  { nombre: 'recordatorio 5 pm', turnos: [u('Recuérdame mañana a las cinco de la tarde llamar al banco.')], espera: { tool: 'recordatorio', revisar: (i) => /T17:00/.test(String(i.cuando)) } },
  { nombre: 'llamar a Beto (propone)', turnos: [u('Llama a Beto.')], espera: { tool: 'llamar_contacto', revisar: (i) => /beto/i.test(i.contacto) && i.confirmado !== true } },
  {
    nombre: '«Okey» confirma la llamada',
    turnos: [u('Llama a Beto.'), a('¿Le marco a Beto?'), u('Okey.')],
    espera: { tool: 'llamar_contacto', revisar: (i) => /beto/i.test(i.contacto) && i.confirmado === true },
  },
  { nombre: 'WhatsApp a mamá', turnos: [u('Mándale un WhatsApp a mi mamá que ya voy.')], espera: { tool: 'whatsapp_enviar', revisar: (i) => /mam/i.test(i.para) && /voy/i.test(i.texto) && i.confirmado !== true } },
  { nombre: 'oro hoy', turnos: [u('¿A cómo está el oro hoy?')], espera: { tool: 'buscar_web' } },
  { nombre: 'revisa correos', turnos: [u('Revisa mis correos.')], espera: { tool: 'correo', revisar: (i) => i.accion === 'revisar' } },
  { nombre: 'música', turnos: [u('Hazme el favor de ponerme música de Marco Antonio Solís.')], espera: { tool: 'musica', revisar: (i) => /marco/i.test(i.que) } },
  { nombre: 'computadora bch', turnos: [u('Entra a la página del Banco Central y dime el tipo de cambio de hoy.')], espera: { tool: 'computadora' } },
  { nombre: '¿cómo estás?', turnos: [u('¿Cómo vas?')], espera: null },
  { nombre: 'inflación en una frase', turnos: [u('Explícame en una frase qué es la inflación.')], espera: null },
  { nombre: 'consejo cena', turnos: [u('¿Qué me recomiendas cenar hoy?')], espera: null },
];

type Opciones = { extra?: Record<string, unknown>; nombre?: string };

async function correr(modelo: string, caso: Caso, op: Opciones) {
  const t0 = Date.now();
  let primera = 0;
  let texto = '';
  const tools: { name: string; json: string }[] = [];
  let actual: { name: string; json: string } | null = null;
  const r = await cliente.send(
    new ConverseStreamCommand({
      modelId: modelo,
      system: [{ text: SISTEMA }],
      messages: caso.turnos,
      toolConfig: { tools: HERRAMIENTAS },
      inferenceConfig: { maxTokens: 400 },
      ...(op.extra ? { additionalModelRequestFields: op.extra as any } : {}),
    })
  );
  for await (const ev of r.stream!) {
    if (ev.contentBlockStart?.start?.toolUse) {
      if (!primera) primera = Date.now() - t0;
      actual = { name: ev.contentBlockStart.start.toolUse.name || '', json: '' };
      tools.push(actual);
    }
    const d = ev.contentBlockDelta?.delta;
    if (d?.text) {
      if (!primera && d.text.trim()) primera = Date.now() - t0;
      texto += d.text;
    }
    if (d?.toolUse?.input && actual) actual.json += d.toolUse.input;
    if (ev.contentBlockStop) actual = null;
  }
  const total = Date.now() - t0;
  const llamadas = tools.map((t) => {
    let input: any = {};
    try {
      input = JSON.parse(t.json || '{}');
    } catch {
      /* */
    }
    return { name: t.name, input };
  });
  let ok: boolean;
  if (caso.espera === null) ok = llamadas.length === 0 && texto.trim().length > 0;
  else {
    const e = caso.espera;
    const c = llamadas.find((l) => l.name === e.tool);
    ok = !!c && (!e.revisar || e.revisar(c.input));
  }
  return { primera, total, texto: texto.replace(/\s+/g, ' ').trim(), llamadas, ok };
}

const MODELOS: Array<[string, Opciones]> = (process.argv.slice(2).length ? process.argv.slice(2) : [
  'us.anthropic.claude-sonnet-5-5',
  'us.anthropic.claude-sonnet-4-6',
  'qwen.qwen3-235b-a22b-2507-v1:0',
  'moonshotai.kimi-k2.5',
  'zai.glm-5',
  'deepseek.v3.2',
  'mistral.mistral-large-3-675b-instruct',
]).map((m) => {
  // Sonnet 5.5 piensa por omisión: para la voz, sin pensar entre herramientas y con esfuerzo bajo.
  if (/sonnet-5-5/.test(m)) return [m, { extra: { thinking: { type: 'between_tools' }, output_config: { effort: 'low' } } }];
  return [m, {}];
});

async function main() {
  const resumen: string[] = [];
  for (const [modelo, op] of MODELOS) {
    console.log(`\n=== ${modelo}`);
    let bien = 0;
    const primeras: number[] = [];
    for (const caso of CASOS) {
      try {
        const r = await correr(modelo, caso, op);
        if (r.ok) bien++;
        primeras.push(r.primera);
        console.log(`${r.ok ? '✔' : '✘'} ${caso.nombre} · 1ª ${r.primera} ms · total ${r.total} ms`);
        if (r.texto) console.log(`    dice: ${r.texto.slice(0, 220)}`);
        for (const l of r.llamadas) console.log(`    mano: ${l.name} ${JSON.stringify(l.input)}`);
      } catch (e: any) {
        console.log(`✘ ${caso.nombre} · ERROR ${String(e?.name || '')}: ${String(e?.message || e).slice(0, 160)}`);
        primeras.push(99999);
      }
    }
    primeras.sort((x, y) => x - y);
    const mediana = primeras[Math.floor(primeras.length / 2)];
    resumen.push(`${modelo}: ${bien}/${CASOS.length} bien · 1ª reacción mediana ${mediana} ms · peor ${primeras[primeras.length - 1]} ms`);
  }
  console.log('\n=== RESUMEN');
  for (const l of resumen) console.log(l);
}

void main();
