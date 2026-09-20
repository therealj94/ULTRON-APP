/**
 * EL TURNO DE DR ELECTRUM — donde se juntan todas las piezas.
 *
 * Convoca al panel que corresponde, le ofrece solo sus herramientas, corre el harness agéntico y
 * devuelve tres cosas: el texto, la traza de lo que hizo, y las órdenes para la pantalla.
 *
 * La traza no es depuración: es lo que un ingeniero exige para creerle. «Consultó el catastro, midió
 * sobre el elipsoide, encontró el traslape» vale más que la respuesta sola, y es lo que separa esto
 * de un chatbot que suena convincente.
 */
import { correrAgente, type Mensaje } from '../../lib/agente/bucle';
import type { Contexto } from '../../lib/agente/tipos';
import { extraerEmocion, INSTRUCCION_EMOCION, type Emocion } from '../../lib/emocion';
import { fetchNodo, NODO_MODELO, NODO_SECRETO, NODO_URL } from '../../lib/nodo';
import { convocar, herramientasDe, promptPanel } from './especialistas';
import { manosDe, TODAS } from './manos';
import { CONOCIMIENTO_MINAS } from '../../src/08-cerebro-minas/conocimiento';
import { hechosCerebro } from '../../lib/cerebro';
import { PERFILES } from '../../lib/perfiles';
import { fraseDeAcceso, personaPorId } from '../../lib/acceso';

export type RespuestaTurno = {
  texto: string;
  emocion: Emocion;
  /** Qué especialistas contestaron, para mostrarlo encima de la respuesta. */
  panel: string;
  traza: Array<{ herramienta: string; ok: boolean; resumen: string; ms: number }>;
  /** Órdenes para el mapa y los paneles. */
  ui: Array<Record<string, unknown>>;
  fin: string;
};

function identidad(nombre: string): string {
  return [
    `Sos Dr Electrum, la cara y la voz de ELECTRUM, la estación de trabajo minera. Hablás con ${nombre}.`,
    'Sabés de minería como quien la ha trabajado, y tenés un mapa y un catastro delante que se mueven cuando hablás.',
    INSTRUCCION_EMOCION,
    'FORMA: dos o tres frases. Español de Centroamérica, directo, sin listas ni adornos. Números con unidad, siempre.',
    'HERRAMIENTAS: úsalas antes de contestar cualquier cosa que debería salir del catastro, de un expediente o de una cuenta. No contestes de memoria sobre una concesión concreta ni calcules de cabeza.',
    'CUANDO NOMBRES UNA CONCESIÓN, mostrala en el mapa: quien pregunta la está viendo mientras hablás, y eso es la mitad de la explicación.',
    'HONESTIDAD: si una herramienta no trae el dato, decilo. No lo inventes ni lo rellenes con lo que suena razonable.',
    'ESTA ES UNA DEMOSTRACIÓN: no sustituye a una Persona Calificada ni a un informe firmado. Si alguien va a decidir una inversión con lo que decís, recordáselo una vez, sin sermonear.',
  ].join('\n');
}

/**
 * Pregunta al nodo. Devuelve el mensaje entero para poder leer `tool_calls` nativo si el servidor
 * lo trae; si no, el harness lo saca del texto en formato Hermes.
 */
async function pensarConQwen(mensajes: Mensaje[], herramientas: unknown[]) {
  const r = await fetchNodo(`${NODO_URL}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-ultron-secreto': NODO_SECRETO },
    body: JSON.stringify({
      model: NODO_MODELO,
      stream: false,
      messages: mensajes,
      // Si el servidor no conoce `tools`, lo ignora y el harness cae al formato Hermes.
      tools: herramientas,
      options: { temperature: 0.4 },
    }),
    signal: AbortSignal.timeout(60_000),
  });
  const j: any = await r.json().catch(() => ({}));
  const mensaje = j?.message || {};
  return { texto: String(mensaje.content || ''), mensaje };
}

/** El nombre con el que la saluda. Sin padrón detrás, no se inventa uno. */
function nombreVisible(ctx: Contexto): string {
  if (!ctx.quien) return 'quien tenés enfrente';
  return personaPorId(ctx.quien)?.nombre || 'quien tenés enfrente';
}

export async function turnoElectrum(mensaje: string, ctx: Contexto): Promise<RespuestaTurno> {
  const panel = convocar(mensaje);
  const herramientas = panel.length ? manosDe(herramientasDe(panel)) : TODAS;

  // El conocimiento minero entero va en el system; lo que toca la pregunta, además, pegado a ella.
  const delCerebro = hechosCerebro(mensaje, 12, PERFILES.minas);

  const system = [
    identidad(nombreVisible(ctx)),
    // Que el modelo sepa el nivel de quien tiene enfrente evita la peor forma de decir que no:
    // ofrecerle a alguien que suba un expediente y rebotarlo después con un error de permisos.
    fraseDeAcceso(ctx.nivel, 'electrum'),
    '',
    promptPanel(panel),
    '',
    'CEREBRO DE MINAS:',
    CONOCIMIENTO_MINAS,
  ].join('\n');

  const usuario = delCerebro.length
    ? `DE TU CEREBRO, sobre lo que preguntan (esto lo sabés de verdad):\n${delCerebro.join('\n')}\n\n${mensaje}`
    : mensaje;

  if (!NODO_URL || !NODO_SECRETO) {
    return {
      texto: 'No alcanzo mi cerebro ahora mismo. No te voy a inventar una respuesta: dame un momento y volvé a preguntarme.',
      emocion: 'preocupado',
      panel: panel.map((e) => e.nombre).join(' y '),
      traza: [],
      ui: [],
      fin: 'sin cerebro',
    };
  }

  const r = await correrAgente({
    mensajes: [
      { role: 'system', content: system },
      { role: 'user', content: usuario },
    ],
    herramientas,
    ctx,
    pensar: ({ mensajes, herramientas: nativas }) => pensarConQwen(mensajes, nativas),
    presupuesto: { rondas: 3, llamadas: 8, ms: 50_000 },
  });

  const emo = extraerEmocion(r.texto);
  return {
    texto: emo.texto,
    emocion: emo.emocion,
    panel: panel.map((e) => e.nombre).join(' y '),
    traza: r.traza.map((t) => ({ herramienta: t.llamada.nombre, ok: t.ok, resumen: t.resumen, ms: t.ms })),
    ui: r.ui,
    fin: r.fin,
  };
}
