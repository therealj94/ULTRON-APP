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
import { conEvidencias, evidenciasDelTurno, verificarCitas } from './evidencias';
import { clasificar } from '../../lib/cognitivo/clasificador';
import { AVISO_INYECCION, guiasDeClasificacion } from '../../lib/cognitivo/agentes';
import { MEMORIA_ESTRUCTURADA } from '../../lib/manos/memoria';
import { fichaEnTexto, fichasMencionadas } from '../../lib/cognitivo/entidades';
import { correrAgente, type Mensaje } from '../../lib/agente/bucle';
import type { MsgHilo } from './hilo';
import { garantizarMapa } from './mapa-garantia';
import { garantizarMapasGeo } from './geo-garantia';
import type { Contexto } from '../../lib/agente/tipos';
import { extraerEmocion, type Emocion } from '../../lib/emocion';
import { quitarExpresiones } from '../../lib/expresiones';
import { fetchNodo, NODO_MODELO, NODO_SECRETO, NODO_URL } from '../../lib/nodo';
import { decidirPanel, herramientasDe, promptPanel } from './especialistas';
import { bloqueMesa, duenioDe, EXPERTOS, OFICIOS, quienesDe, textoDeVoces, vocesDelTurno, type Voz } from './personajes';
import { bloqueExpedientes, expedientesDeLaPregunta } from './expedientes-previos';
import { manosDe, TODAS } from './manos';
import { CONOCIMIENTO_MINAS } from '../../src/08-cerebro-minas/conocimiento';
import { hechosCerebro, lineas as lineasCerebro } from '../../lib/cerebro';
import { bloqueInstituciones } from './instituciones';
import { lineasPorSignificado } from '../../lib/cognitivo/conocimiento-semantico';
import { PERFILES } from '../../lib/perfiles';
import { personaPorId } from '../../lib/acceso';
import { personalidadElectrum } from './personalidad';
import { buscarWebDetallado, consultaWeb, leerPagina, resumenMotores } from '../../src/06-manos/web';
import { detectarIdioma, idiomaDelTurno, type IdiomaTurno } from '../../lib/idioma-detectar';

/**
 * Le hablaron en inglés. El prompt entero está en español (personalidad, panel, cerebro), así que
 * sin esto el modelo contesta en español aunque la pregunta llegue en inglés.
 */
export const LINEA_INGLES =
  'LANGUAGE: the person is speaking ENGLISH. Answer ENTIRELY in natural English (en-US), even though this prompt, the tools, the catastro and the documents are in Spanish: translate what you quote. Keep proper names exactly as they are (concession names, expediente numbers, INHGEOMIN, SERNA, departments, laws). Switch back to Spanish only if they write in Spanish.';

export type RespuestaTurno = {
  /** Lo que se DICE: el texto con las etiquetas de expresión de v4 ([thoughtful]…), si las hay. */
  voz?: string;
  /**
   * Quién dice qué, cuando contesta la mesa (Don Chema, la Ing. Tatiana…) y no solo el doctor: cada
   * intervención suena con la voz de su personaje y se ve con su cara. Sin esto, habla Dr Electrum.
   */
  voces?: Voz[];
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
  /** En qué idioma contestó: el de quien preguntó; español si no se sabe. La voz lo lee en ese. */
  idioma?: IdiomaTurno;
  /** Las citas que se comprobaron contra lo leído: documento y página, para abrirlas (auditoría H13). */
  citas?: Array<{ codigo: string; documentoId: number; documento: string; pagina: number | null }>;
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

/** Lo que le queda al turno desde que llegó la petición. Nunca negativo. */
export function msRestanteDelTurno(inicio: number, ahora = Date.now()): number {
  return Math.max(0, PRESUPUESTO_TURNO_MS - (ahora - inicio));
}
/** Lo que esperan la pantalla y el teléfono. Tiene que ser MAYOR que el presupuesto del turno. */
export const ESPERA_CLIENTE_MS = 75_000;
/**
 * Ni una llamada eterna ni una que no alcanza a pensar. Antes había además un MÍNIMO de 8 s que se
 * daba aunque al turno le quedaran 2: así se pasaba de su presupuesto (auditoría H08). Ahora, con
 * menos de lo que hace falta para pensar, no se llama y el bucle cierra con lo que tiene.
 */
const MIN_PARA_PENSAR_MS = 1_500;
const MAX_LLAMADA_MS = 60_000;

/**
 * Pregunta al nodo. Devuelve el mensaje entero para poder leer `tool_calls` nativo si el servidor
 * lo trae; si no, el harness lo saca del texto en formato Hermes.
 */
async function pensarConQwen(mensajes: Mensaje[], herramientas: unknown[], msRestante: number, senal?: AbortSignal) {
  if (msRestante < MIN_PARA_PENSAR_MS) throw new Error('sin tiempo para pensar');
  const tope = Math.min(MAX_LLAMADA_MS, msRestante);
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
    // Se corta por tiempo o porque quien preguntaba se fue (auditoría H09), lo que pase primero.
    signal: senal ? AbortSignal.any([AbortSignal.timeout(tope), senal]) : AbortSignal.timeout(tope),
  });
  /*
   * Un nodo que contesta 502 o 500 NO contestó.
   *
   * Antes se leía el cuerpo igual, salía `{}`, y el bucle lo tomaba por una respuesta vacía del
   * modelo: el turno terminaba «contestó» con texto en blanco. La pantalla ponía «No pude
   * contestar» sin decir por qué y Telegram mandaba un mensaje vacío. Lanzando, el bucle hace lo
   * que ya sabe hacer con un cerebro caído: decir que no lo alcanzó y lo que alcanzó a averiguar.
   */
  if (!r.ok) throw new Error(`el nodo contestó ${r.status}`);
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
  /**
   * Se dispara cuando quien preguntaba se fue: corta la llamada al modelo y deja de esperar la
   * herramienta en curso (auditoría H09). La ruta la ata a `res.on('close')`.
   */
  senal?: AbortSignal;
  /**
   * Cuándo llegó la petición (ms). El presupuesto del turno se cuenta DESDE AHÍ, no desde que
   * empieza el bucle: clasificar, buscar en expedientes y en internet también gastan del mismo
   * reloj (auditoría H08). Sin él, desde que empieza el turno.
   */
  inicio?: number;
  /**
   * Quien pregunta pidió buscar en internet (el botón «Internet» de la pantalla). La búsqueda la
   * hace el servidor ANTES de pensar: no queda a criterio del modelo si busca o no, y las fuentes
   * llegan pegadas a la pregunta para que las cite.
   */
  internet?: boolean;
  /** La mesa técnica está abierta en pantalla: cada pregunta la discuten los tres. */
  mesa?: boolean;
  /**
   * Pista de idioma cuando el mensaje solo no lo dice («Olancho», «ok»): lo que detectó el
   * micrófono o el idioma en que se venía hablando. El texto del mensaje manda sobre la pista.
   */
  idioma?: string;
};

export async function turnoElectrum(mensaje: string, ctx: Contexto, opciones: OpcionesTurno = {}): Promise<RespuestaTurno> {
  // Cada turno deja su traza; todo lo que pasa adentro (herramientas, reglas, tokens) anota ahí.
  const reg = iniciarTraza({ plataforma: 'electrum', canal: ctx.canal, quien: ctx.quien, nivel: ctx.nivel, pregunta: mensaje });
  return enTurno(reg, async () => {
    try {
      // Lo que se lea en el turno queda como evidencia citable y se verifica al final (H13).
      const r = await conEvidencias(() => turnoElectrumInterno(mensaje, ctx, opciones));
      if (r.panel) reg.agente(r.panel);
      reg.cerrar({ respuesta: r.texto, emocion: r.emocion, via: r.fin });
      return { ...r, trazaId: reg.id };
    } catch (e) {
      reg.cerrar({ error: e });
      throw e;
    }
  });
}

/**
 * Lo que dice internet sobre la pregunta: los mejores resultados y el texto de las dos primeras
 * fuentes, con la instrucción de citarlas. Si no hay resultados, también se dice: así el modelo no
 * contesta «según internet» sin haber leído nada.
 */
async function bloqueInternet(mensaje: string, enVivo?: (e: EnVivo) => void): Promise<string> {
  const t0 = Date.now();
  const { hits, motores, tavily } = await buscarWebDetallado(mensaje.slice(0, 300), 6).catch(() => ({ hits: [], motores: {}, tavily: undefined }));
  const leidas = await Promise.all(hits.slice(0, 2).map((h) => leerPagina(h.url, 1500).catch(() => '')));
  const deDonde = resumenMotores(motores, tavily);
  enVivo?.({
    herramienta: {
      herramienta: 'web_buscar',
      ok: hits.length > 0,
      resumen: `${hits.length ? `${hits.length} resultados` : 'sin resultados'}${deDonde ? ` · ${deDonde}` : ''}`,
      ms: Date.now() - t0,
    },
  });
  if (!hits.length) {
    return 'DE INTERNET: lo pidieron buscar y la búsqueda no devolvió resultados ahora. Decilo así; no cites fuentes que no leíste.';
  }
  const lista = hits.map((h, i) => `[${i + 1}] ${h.title} — ${h.url}\n${h.snippet.slice(0, 280)}${leidas[i] ? `\nTexto de la página: ${leidas[i]}` : ''}`);
  return `DE INTERNET (lo pidieron buscar; usalo, y citá cada dato con su fuente así: (fuente: dominio). Lo que no esté acá no lo atribuyas a internet):\n${lista.join('\n\n')}`;
}

async function turnoElectrumInterno(mensaje: string, ctx: Contexto, opciones: OpcionesTurno): Promise<RespuestaTurno> {
  const { historial = [], enVivo, abandonado, senal } = opciones;
  const inicio = opciones.inicio ?? Date.now();
  // Español por defecto; inglés si le hablan en inglés. Sin señal en el mensaje, la pista del
  // micrófono y, si no, el idioma de la última pregunta.
  const ultimaPregunta = [...historial].reverse().find((m) => m.role === 'user');
  const idioma = idiomaDelTurno(mensaje, opciones.idioma, ultimaPregunta ? detectarIdioma(String(ultimaPregunta.content || '')) : null);
  // El botón «Internet», o pedirlo con palabras («buscá en internet…», «noticias de…»): por
  // pantalla, por voz o por Telegram, igual.
  const internet = opciones.internet === true || consultaWeb(mensaje) !== null;
  // Quién del panel contesta (Laya) se pide YA, en paralelo con la clasificación: son dos consultas
  // independientes y en serie sumaban sus tiempos. Corre dentro de `enTurno`, así que su paso
  // queda en la traza de este turno igual que antes.
  const panelP = decidirPanel(opciones.mesa ? `mesa técnica: ${mensaje}` : mensaje);
  panelP.catch(() => undefined); // si la clasificación falla antes, que esto no quede como rechazo sin atender
  // La decisión rápida del turno. De la clasificación se usa el riesgo, que va a las reglas, y la
  // alerta de ataque.
  const clas = await clasificar(mensaje, 'electrum');
  trazaActual()?.clasificacion(clas);
  ctx = { ...ctx, riesgo: clas.riesgo, historial: historial.map((m) => ({ role: m.role, content: m.content })) };
  const { panel, fuente } = await panelP;
  // Quién de la mesa contesta: el dueño de cada especialidad convocada (personajes.ts).
  const mesa = fuente === 'mesa';
  const quienes = quienesDe(panel);
  const deLaMesa = bloqueMesa(quienes, mesa);
  // Las de su oficio y, para todos, la memoria estructurada (fichas de empresas, concesiones, personas).
  const base = panel.length ? manosDe(herramientasDe(panel)) : TODAS;
  // Con «Internet» pedido, las dos de la web están aunque el especialista convocado no las traiga.
  const herramientas = [...base, ...(internet ? manosDe(['web_buscar', 'web_leer']).filter((h) => !base.some((b) => b.nombre === h.nombre)) : []), ...MEMORIA_ESTRUCTURADA];
  // Con la mesa se ve quién habla: «Don Chema (Metalurgista) y Ing. Tatiana (Ingeniero Civil)».
  const nombrePanel = deLaMesa
    ? `${mesa ? 'Mesa técnica: ' : ''}${(mesa ? EXPERTOS : quienes)
        .map((p) => `${OFICIOS[p].nombre} (${panel.filter((e) => duenioDe(e.id) === p).map((e) => e.nombre).join(', ') || OFICIOS[p].titulo})`)
        .join(' y ')}`
    : panel.map((e) => e.nombre).join(' y ');
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
    // Ánimo, urgencia, estafa o alguien en riesgo, si Laya lo vio.
    ...guiasDeClasificacion(clas).flatMap((g) => ['', g]),
    '',
    'CEREBRO DE MINAS:',
    CONOCIMIENTO_MINAS,
    // Al final, para que pese más que el resto del prompt, que está en español.
    ...(idioma === 'en' ? ['', LINEA_INGLES] : []),
  ].join('\n');

  // Las fichas de lo que se nombra en la pregunta van pegadas a ella: lo que se sabe con certeza.
  const fichas = await fichasMencionadas('electrum', mensaje).catch(() => []);
  if (fichas.length) delCerebro = [...delCerebro, ...fichas.map(fichaEnTexto)];

  // Si preguntan por lo que dice un papel, lo que hay en los expedientes va pegado a la pregunta:
  // el modelo no puede decir «no lo tengo» sin haber mirado (expedientes-previos.ts).
  const antes = historial.filter((m) => m.role === 'user').slice(-2).map((m) => String(m.content || ''));
  const deExpedientes = bloqueExpedientes(
    await expedientesDeLaPregunta(mensaje, { antes }).catch(() => ({ documento: null, trozos: [] })),
    herramientas.some((h) => h.nombre === 'expediente_leer')
  );
  const deInternet = internet ? await bloqueInternet(consultaWeb(mensaje) || mensaje, enVivo) : null;
  // Quién dirige hoy INHGEOMIN, SERNA o el ICF y qué dice hoy la ley: con fecha y fuente.
  const deInstituciones = bloqueInstituciones(mensaje);
  const previos = [
    ...(delCerebro.length ? [`DE TU CEREBRO, sobre lo que preguntan (esto lo sabés de verdad):\n${delCerebro.join('\n')}`] : []),
    ...(deInstituciones ? [deInstituciones] : []),
    ...(deExpedientes ? [deExpedientes] : []),
    ...(deInternet ? [deInternet] : []),
    ...(deLaMesa ? [deLaMesa] : []),
  ];
  const usuario = previos.length ? `${previos.join('\n\n')}\n\n${mensaje}` : mensaje;

  if (!NODO_URL || !NODO_SECRETO) {
    return {
      texto:
        idioma === 'en'
          ? "I can't reach my brain right now. I won't make up an answer: give me a moment and ask me again."
          : 'No alcanzo mi cerebro ahora mismo. No te voy a inventar una respuesta: dame un momento y volvé a preguntarme.',
      idioma,
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
    pensar: ({ mensajes, herramientas: nativas, msRestante, senal: s }) => pensarConQwen(mensajes, nativas, msRestante, s),
    // Lo que queda del reloj único que empezó al llegar la petición (auditoría H08).
    presupuesto: { rondas: 3, llamadas: 8, ms: msRestanteDelTurno(inicio) },
    abandonado,
    senal,
    alVivo: enVivo
      ? (t, ui) => {
          enVivo({ herramienta: { herramienta: t.llamada.nombre, ok: t.ok, resumen: t.resumen, ms: t.ms } });
          if (ui) enVivo({ ui });
        }
      : undefined,
  });

  /*
   * Las citas se comprueban contra lo leído en ESTE turno (auditoría H13): `[D12-p5]` pasa a
   * «(documento, p. 5)» si esa página se leyó, y si no se quita y se dice. Va antes de todo lo
   * demás para que la pantalla, la voz y Telegram reciban lo mismo.
   */
  const verificadas = verificarCitas(r.texto, evidenciasDelTurno(), idioma === 'en' ? 'en' : 'es');
  const pasoCitas = verificadas.quitadas.length
    ? { herramienta: 'citas', ok: false, resumen: `citas sin respaldo quitadas: ${verificadas.quitadas.join(', ')}`, ms: 0 }
    : null;
  if (pasoCitas) trazaActual()?.paso(pasoCitas);
  const emo = extraerEmocion(verificadas.texto);
  // Las expresiones de voz ([risa], [suspiro]…) son de AU-RA y suenan con la voz de Dora. Si el
  // modelo del doctor escribe una, no se enseña ni se oye: su voz las quita (server/voz.ts) y aquí
  // salen del texto que llega a la pantalla, al hilo y a Telegram.
  const limpio = quitarExpresiones(emo.texto).trim();
  /*
   * Un turno no termina en blanco. Si el modelo cerró sin una palabra —pasa con un nodo que
   * devuelve 200 y el mensaje vacío—, lo que se enseña es lo que dijeron las herramientas, o que no
   * salió nada. Un globo vacío en la pantalla y un mensaje vacío en Telegram no le dicen nada a nadie.
   */
  const buenas = r.traza.filter((t) => t.ok);
  const texto =
    limpio ||
    (buenas.length
      ? `${buenas.map((t) => t.resumen).join(' ')} ${idioma === 'en' ? "I couldn't word it better; ask me again if you like." : 'No alcancé a redactarlo mejor; si querés, volvé a preguntármelo.'}`
      : idioma === 'en'
        ? "I didn't get an answer this time. I won't make one up: please ask me again."
        : 'No me salió ninguna respuesta esta vez. No te voy a inventar una: volvé a preguntármelo.');
  /*
   * El mapa no depende de que el modelo se acuerde de moverlo (mapa-garantia.ts): si se pidió ver
   * algo, o la respuesta dice que lo enseñó, y no salió ninguna orden para el mapa, se vuela aquí;
   * si no se sabe a qué, la respuesta no puede quedar diciendo que ya está en el mapa.
   */
  const ui = [...r.ui];
  const traza = r.traza.map((t) => ({ herramienta: t.llamada.nombre, ok: t.ok, resumen: t.resumen, ms: t.ms }));
  if (pasoCitas) traza.push(pasoCitas);
  let final = texto;
  try {
    const g = await garantizarMapa({ mensaje, texto, ui, historial, canal: ctx.canal, herramientas: traza.filter((t) => t.ok).map((t) => t.resumen).join('\n') });
    final = g.texto;
    if (g.ui) {
      ui.push(g.ui);
      enVivo?.({ ui: g.ui });
    }
    if (g.nota) {
      const paso = { herramienta: 'mapa_garantia', ok: !!g.ui, resumen: g.nota, ms: 0 };
      traza.push(paso);
      trazaActual()?.paso(paso);
    }
  } catch (e: any) {
    console.warn('[electrum] garantía del mapa:', String(e?.message || e).slice(0, 160));
  }
  // Lo mismo con los mapas geológicos (geo-garantia.ts): pedidos y no dibujados, se dibujan aquí.
  try {
    const g = await garantizarMapasGeo({ mensaje, texto: final, corrieron: traza, herramienta: herramientas.find((h) => h.nombre === 'mapa_geologico') ?? TODAS.find((h) => h.nombre === 'mapa_geologico'), ctx });
    final = g.texto;
    if (g.ui) {
      ui.push(g.ui);
      enVivo?.({ ui: g.ui });
    }
    if (g.nota) {
      const paso = { herramienta: 'mapas_geo_garantia', ok: !!g.ui, resumen: g.nota, ms: 0 };
      traza.push(paso);
      trazaActual()?.paso(paso);
    }
  } catch (e: any) {
    console.warn('[electrum] garantía de mapas geológicos:', String(e?.message || e).slice(0, 160));
  }
  /*
   * La VOZ lleva las etiquetas de expresión que escribió el modelo ([thoughtful], [laughs]…): la
   * pantalla no las enseña, pero Eleven v4 las actúa. Si alguna garantía cambió el texto, la voz
   * dice el texto final tal cual (sin etiquetas que ya no calzan).
   */
  const voz = final === texto && emo.texto.trim() !== limpio ? emo.texto.trim() : undefined;
  // La mesa: cada intervención con su personaje. El texto que se lee queda «Don Chema: …».
  const voces = deLaMesa ? vocesDelTurno(voz ?? final, mesa ? EXPERTOS : quienes) : [];
  return {
    texto: voces.length ? textoDeVoces(voces) : final,
    voz: voces.length ? undefined : voz,
    ...(voces.length ? { voces } : {}),
    emocion: emo.emocion,
    panel: nombrePanel,
    traza,
    ui,
    fin: r.fin,
    idioma,
    ...(verificadas.citas.length ? { citas: verificadas.citas.map((c) => ({ codigo: c.codigo, documentoId: c.documentoId, documento: c.documento, pagina: c.pagina })) } : {}),
  };
}
