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
import { extraerEmocion, type Emocion } from '../../lib/emocion';
import { fetchNodo, NODO_MODELO, NODO_SECRETO, NODO_URL } from '../../lib/nodo';
import { convocar, herramientasDe, promptPanel } from './especialistas';
import { manosDe, TODAS } from './manos';
import { CONOCIMIENTO_MINAS } from '../../src/08-cerebro-minas/conocimiento';
import { hechosCerebro } from '../../lib/cerebro';
import { PERFILES } from '../../lib/perfiles';
import { personaPorId } from '../../lib/acceso';
import { personalidadElectrum } from './personalidad';

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
    personalidadElectrum({ nombre: nombreVisible(ctx), nivel: ctx.nivel, canal: ctx.canal }),
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
