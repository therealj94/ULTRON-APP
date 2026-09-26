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
import { enTurno, iniciarTraza, trazaActual } from '../../lib/cognitivo/traza';
import { clasificar } from '../../lib/cognitivo/clasificador';
import { AVISO_INYECCION } from '../../lib/cognitivo/agentes';
import { MEMORIA_ESTRUCTURADA } from '../../lib/manos/memoria';
import { fichaEnTexto, fichasMencionadas } from '../../lib/cognitivo/entidades';
import { correrAgente, type Mensaje } from '../../lib/agente/bucle';
import type { MsgHilo } from './hilo';
import type { Contexto } from '../../lib/agente/tipos';
import { extraerEmocion, type Emocion } from '../../lib/emocion';
import { quitarExpresiones } from '../../lib/expresiones';
import { fetchNodo, NODO_MODELO, NODO_SECRETO, NODO_URL } from '../../lib/nodo';
import { convocar, herramientasDe, promptPanel } from './especialistas';
import { manosDe, TODAS } from './manos';
import { CONOCIMIENTO_MINAS } from '../../src/08-cerebro-minas/conocimiento';
import { hechosCerebro, lineas as lineasCerebro } from '../../lib/cerebro';
import { lineasPorSignificado } from '../../lib/cognitivo/conocimiento-semantico';
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
  /** Para dejar la opinión («sirvió / no sirvió») sobre esta respuesta y para auditarla. */
  trazaId?: string;
};

/**
 * EL CONTRATO DE TIEMPO, en un solo sitio.
 *
 * Antes había tres relojes que no se hablaban: el cliente móvil cortaba a los 45 s, el turno
 * declaraba un presupuesto de 50 s y la llamada al modelo tenía su propio tope de 60 s. Esa
 * combinación permite lo peor de los dos mundos — que la app abandone una petición que el servidor
 * todavía está atendiendo, y que el servidor siga gastando el nodo para nadie.
 *
 * Ahora son tres números en orden y con holgura entre ellos:
 *
 *   llamada al modelo  ≤  lo que queda del TURNO  <  lo que espera el CLIENTE
 *
 * El primero ya no es fijo: se lo da el bucle, que sabe cuánto del presupuesto se consumió en las
 * rondas anteriores. Así el turno no puede pasarse de su propio presupuesto, que es lo que hacía
 * que el contrato fuera papel mojado.
 */
export const PRESUPUESTO_TURNO_MS = 50_000;
/** Lo que esperan la pantalla y el teléfono. Tiene que ser MAYOR que el presupuesto del turno. */
export const ESPERA_CLIENTE_MS = 75_000;
/** Ni una llamada eterna ni una que no alcanza a pensar. */
const MIN_LLAMADA_MS = 8_000;
const MAX_LLAMADA_MS = 60_000;

/**
 * Pregunta al nodo. Devuelve el mensaje entero para poder leer `tool_calls` nativo si el servidor
 * lo trae; si no, el harness lo saca del texto en formato Hermes.
 */
async function pensarConQwen(mensajes: Mensaje[], herramientas: unknown[], msRestante: number) {
  const tope = Math.min(MAX_LLAMADA_MS, Math.max(MIN_LLAMADA_MS, msRestante));
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
    signal: AbortSignal.timeout(tope),
  });
  const j: any = await r.json().catch(() => ({}));
  const mensaje = j?.message || {};
  trazaActual()?.tokens(j?.prompt_eval_count, j?.eval_count);
  trazaActual()?.modelo(NODO_MODELO);
  return { texto: String(mensaje.content || ''), mensaje };
}

/** El nombre con el que la saluda. Sin padrón detrás, no se inventa uno. */
function nombreVisible(ctx: Contexto): string {
  if (!ctx.quien) return 'quien tenés enfrente';
  return personaPorId(ctx.quien)?.nombre || 'quien tenés enfrente';
}

/** Lo que la pantalla puede ir viendo mientras el turno corre, sin esperar al final. */
export type EnVivo = {
  /** Una herramienta terminó: su nombre, si salió bien y qué encontró. */
  herramienta?: { herramienta: string; ok: boolean; resumen: string; ms: number };
  /** Órdenes para el mapa. Llegan EN EL MOMENTO, que es el punto de toda esta plataforma. */
  ui?: Record<string, unknown>;
  /** Qué especialistas se convocaron. Sale antes que nada: es lo primero que se sabe. */
  panel?: string;
};

export type OpcionesTurno = {
  /**
   * Lo que se venía hablando, con su rol. **Va aparte del mensaje a propósito.**
   *
   * Pegarlo dentro del mensaje —como hacía Telegram— parece lo mismo y no lo es: el panel de
   * especialistas se elige contando palabras del oficio sobre el texto que llega, así que un hilo
   * de geología hacía que una pregunta legal convocara al geólogo y dejara al legal fuera. La
   * pregunta de ahora tiene que llegar sola a `convocar`; el pasado va donde el modelo espera
   * encontrarlo, que es en los mensajes anteriores.
   */
  historial?: MsgHilo[];
  /**
   * Se llama en cuanto hay algo que enseñar.
   *
   * El gancho `alVivo` del harness existía desde el principio, con un comentario que decía «el mapa
   * no espera al final» — y nadie lo consumía, así que el mapa SÍ esperaba al final. Un turno con
   * tres rondas de herramientas puede tardar cincuenta segundos, y durante esos cincuenta segundos
   * la pantalla enseñaba «pensando…» mientras el catastro ya había contestado hace cuarenta.
   */
  enVivo?: (e: EnVivo) => void;
  /** ¿Se fue quien preguntaba? El turno deja de empezar cosas nuevas. */
  abandonado?: () => boolean;
};

export async function turnoElectrum(mensaje: string, ctx: Contexto, opciones: OpcionesTurno = {}): Promise<RespuestaTurno> {
  // Cada turno deja su traza; todo lo que pasa adentro (herramientas, reglas, tokens) anota ahí.
  const reg = iniciarTraza({ plataforma: 'electrum', canal: ctx.canal, quien: ctx.quien, nivel: ctx.nivel, pregunta: mensaje });
  return enTurno(reg, async () => {
    try {
      const r = await turnoElectrumInterno(mensaje, ctx, opciones);
      if (r.panel) reg.agente(r.panel);
      reg.cerrar({ respuesta: r.texto, emocion: r.emocion, via: r.fin });
      return { ...r, trazaId: reg.id };
    } catch (e) {
      reg.cerrar({ error: e });
      throw e;
    }
  });
}

async function turnoElectrumInterno(mensaje: string, ctx: Contexto, opciones: OpcionesTurno): Promise<RespuestaTurno> {
  const { historial = [], enVivo, abandonado } = opciones;
  // La decisión rápida del turno. El panel lo sigue eligiendo `convocar` (es lo medido en las
  // evaluaciones); de la clasificación se usa el riesgo, que va a las reglas, y la alerta de ataque.
  const clas = await clasificar(mensaje, 'electrum');
  trazaActual()?.clasificacion(clas);
  ctx = { ...ctx, riesgo: clas.riesgo };
  const panel = convocar(mensaje);
  // Las de su oficio y, para todos, la memoria estructurada (fichas de empresas, concesiones, personas).
  const herramientas = [...(panel.length ? manosDe(herramientasDe(panel)) : TODAS), ...MEMORIA_ESTRUCTURADA];
  const nombrePanel = panel.map((e) => e.nombre).join(' y ');
  // Lo primero que se puede decir: quién va a contestar. No cuesta nada y quita la sensación de
  // que no pasa nada.
  if (nombrePanel) enVivo?.({ panel: nombrePanel });

  // El conocimiento minero entero va en el system; lo que toca la pregunta, además, pegado a ella.
  let delCerebro = hechosCerebro(mensaje, 12, PERFILES.minas);
  // Sin coincidencia de palabras, por significado (si hay servicio de embeddings).
  if (!delCerebro.length) delCerebro = await lineasPorSignificado(PERFILES.minas.id, lineasCerebro(PERFILES.minas), mensaje);

  const system = [
    personalidadElectrum({ nombre: nombreVisible(ctx), nivel: ctx.nivel, canal: ctx.canal }),
    '',
    promptPanel(panel),
    // Sin esta línea el modelo trata cada mensaje como si fuera el primero aunque le llegue el
    // historial: contesta bien, pero vuelve a presentar lo que ya dijo y pide otra vez el nombre de
    // la concesión. Con ella, «¿y el segundo?» se resuelve contra lo que él mismo acaba de listar.
    ...(historial.length
      ? [
          '',
          'ESTO VIENE DE ANTES: los mensajes previos son esta misma conversación. «eso», «el segundo», «la otra» se refieren a lo que ya se dijo — resolvelo vos y no lo preguntes de nuevo. Si de verdad quedó ambiguo, decí entre cuáles dudás.',
        ]
      : []),
    '',
    ...(clas.inyeccion ? ['', AVISO_INYECCION] : []),
    '',
    'CEREBRO DE MINAS:',
    CONOCIMIENTO_MINAS,
  ].join('\n');

  // Las fichas de lo que se nombra en la pregunta van pegadas a ella: lo que se sabe con certeza.
  const fichas = await fichasMencionadas('electrum', mensaje).catch(() => []);
  if (fichas.length) delCerebro = [...delCerebro, ...fichas.map(fichaEnTexto)];

  const usuario = delCerebro.length
    ? `DE TU CEREBRO, sobre lo que preguntan (esto lo sabés de verdad):\n${delCerebro.join('\n')}\n\n${mensaje}`
    : mensaje;

  if (!NODO_URL || !NODO_SECRETO) {
    return {
      texto: 'No alcanzo mi cerebro ahora mismo. No te voy a inventar una respuesta: dame un momento y volvé a preguntarme.',
      emocion: 'preocupado',
      panel: nombrePanel,
      traza: [],
      ui: [],
      fin: 'sin cerebro',
    };
  }

  const r = await correrAgente({
    mensajes: [
      { role: 'system', content: system },
      ...(historial as Mensaje[]),
      { role: 'user', content: usuario },
    ],
    herramientas,
    ctx,
    pensar: ({ mensajes, herramientas: nativas, msRestante }) => pensarConQwen(mensajes, nativas, msRestante),
    presupuesto: { rondas: 3, llamadas: 8, ms: PRESUPUESTO_TURNO_MS },
    abandonado,
    alVivo: enVivo
      ? (t, ui) => {
          enVivo({ herramienta: { herramienta: t.llamada.nombre, ok: t.ok, resumen: t.resumen, ms: t.ms } });
          if (ui) enVivo({ ui });
        }
      : undefined,
  });

  const emo = extraerEmocion(r.texto);
  return {
    // Las expresiones de voz ([risa], [suspiro]…) son de AU-RA y suenan con la voz de Dora. Si el
    // modelo del doctor escribe una, no se enseña ni se oye: su voz las quita (server/voz.ts) y aquí
    // salen del texto que llega a la pantalla, al hilo y a Telegram.
    texto: quitarExpresiones(emo.texto).trim(),
    emocion: emo.emocion,
    panel: nombrePanel,
    traza: r.traza.map((t) => ({ herramienta: t.llamada.nombre, ok: t.ok, resumen: t.resumen, ms: t.ms })),
    ui: r.ui,
    fin: r.fin,
  };
}
