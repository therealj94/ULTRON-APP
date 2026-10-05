/**
 * LA VENTANA DE DECISIÓN DE LA MESA, SIN PANTALLA (José, 5-oct: «cuando tiene que enviar un mensaje a alguien o una
 * acción ocupa confirmación, que me salga el pop up y me pregunte, y sea tocar Sí o No o Editar, y pueda decirlo
 * hablado, pero que aparezca; … que maneje las cosas en orden»).
 *
 * Lo que decide la ventana (mobile/src/trabajos/VentanaDecision.tsx la pinta; useVentanaDecision.ts la mueve):
 *  · QUÉ entra: toda tarea que espera la decisión de la persona con una decisión de verdad (un WhatsApp o un correo que
 *    espera su «sí», lo que propone el taller, la tarea a medias que pregunta qué hacer) y la pregunta de su computadora
 *    antes de algo sensible. Lo pospuesto («Luego») no entra hasta que se cumple su hora. Una propuesta que venció entra
 *    UNA vez para preguntar si se rehace.
 *  · EN QUÉ ORDEN: lo que acaba de preguntar el turno (el borrador que AU-RA acaba de leer) primero; después lo más viejo
 *    primero. De a una, con «1 de 3»; resuelta una, aparece la siguiente. Lo que se está viendo no salta mientras siga
 *    esperando (una versión nueva de la misma tarea se ve en su lugar).
 *  · QUÉ BOTONES: los que la decisión de verdad ofrece. Un borrador: Sí · No · Editar (y «Luego»); lo que no se edita
 *    (lo del taller, la computadora), solo Sí · No; la tarea a medias, sus tres respuestas. «Sí» es la opción con efecto:
 *    nunca preseleccionada y no se arma hasta ARMADO_MS (lib/trabajos.ts `puedeActivar`).
 *  · CUÁNDO HABLA: la pregunta, corta y una sola vez por decisión, y nunca en una conversación de voz (ahí ya la hace el
 *    agente), mientras AU-RA ya habla, ni para lo que el turno acaba de leer en voz alta (sería decirlo dos veces).
 *  · EDITAR: el texto entero del borrador en un campo; «Guardar» manda el texto nuevo al servidor
 *    (POST /api/trabajos/:id/editar) y la ventana vuelve a mostrar la versión final para su «sí». Nada sale al editar.
 *
 * Puro: sin React ni React Native (lo prueba mobile/pruebas/decisiones/decisiones.prueba.mjs en Node).
 */
import { esperaDecision, opcionesTarjeta, type TareaVista } from './trabajos';

/* ------------------------------------------------------------------ lo que entra */

/** La pregunta de su computadora antes de algo sensible (server/computadora.ts: estado `confirmar`). */
export type PreguntaPc = { tareaId: string; instruccion: string; pregunta: string; preguntaId: string | null; propuesta: string | null; desde: number };

export type ItemVentana =
  | { tipo: 'tarea'; clave: string; id: string; tarea: TareaVista; creada: number }
  | { tipo: 'computadora'; clave: string; id: string; pc: PreguntaPc; creada: number };

/** Cuánto se va una decisión con «Luego» antes de volver sola. Corto: un borrador vence a los 15 minutos. */
export const LUEGO_MS = 5 * 60_000;

/** La clave de lo que se ve: la tarea y su decisión (otra decisión de la misma tarea es otra pregunta). */
export const claveDeTarea = (t: Pick<TareaVista, 'id' | 'decisionId' | 'decision'>) => `${t.id}:${t.decisionId || t.decision?.id || ''}`;
export const claveDePc = (p: Pick<PreguntaPc, 'tareaId' | 'preguntaId' | 'pregunta'>) => `pc:${p.tareaId}:${p.preguntaId || p.pregunta.slice(0, 40)}`;

const esBorrador = (t: TareaVista) => (t.environment.kind === 'correo' || t.environment.kind === 'whatsapp') && t.source === 'durable';

/** Una propuesta que venció o se quedó sin borrador (bloqueada, con su decisión): se pregunta si se rehace. */
export const vencida = (t: TareaVista) => !t.terminal && !!t.decision && (t.state === 'blocked' || !!t.decision.expired);

/**
 * ¿Esta tarea va a la ventana? Espera la decisión de la persona CON una decisión de verdad (una bloqueada sin decisión
 * no tiene nada que contestar aquí: va al panel) y no está pospuesta.
 */
export function entraEnVentana(t: TareaVista, ahora = Date.now(), o: { todas?: boolean } = {}): boolean {
  if (t.terminal || !t.decision || t.sinConfirmar) return false;
  if (t.source === 'computadora') return false;
  if (t.state === 'blocked') return true;
  // Abierta desde el indicador (`todas`): también lo pospuesto (la persona pidió verlo ahora).
  if (o.todas && t.state === 'awaiting_approval') return true;
  return esperaDecision(t, ahora);
}

const fecha = (iso: string | undefined, si: number) => {
  const n = iso ? Date.parse(iso) : NaN;
  return Number.isFinite(n) ? n : si;
};

/**
 * La fila de la ventana: lo que acaba de preguntar el turno primero (`primero`: los ids de tareas que enlazó su respuesta),
 * después lo más viejo primero. `luego`: lo que la persona dejó para luego EN ESTE teléfono (clave → hasta cuándo), para
 * lo que no se pospone en el servidor (una vencida, la pregunta de su computadora).
 */
export function colaVentana(o: { tareas: TareaVista[]; pc?: PreguntaPc | null; ahora?: number; primero?: string[]; luego?: Record<string, number>; todas?: boolean }): ItemVentana[] {
  const ahora = o.ahora ?? Date.now();
  // Abierta desde el indicador: todo lo que espera, también lo dejado para luego.
  const luego = o.todas ? {} : o.luego || {};
  const items: ItemVentana[] = [];
  for (const t of o.tareas) {
    if (!entraEnVentana(t, ahora, { todas: o.todas })) continue;
    const clave = claveDeTarea(t);
    if ((luego[clave] ?? 0) > ahora) continue;
    items.push({ tipo: 'tarea', clave, id: t.id, tarea: t, creada: fecha(t.decision?.createdAt, fecha(t.createdAt, fecha(t.updatedAt, ahora))) });
  }
  if (o.pc && o.pc.pregunta) {
    const clave = claveDePc(o.pc);
    if (!((luego[clave] ?? 0) > ahora)) items.push({ tipo: 'computadora', clave, id: `pc:${o.pc.tareaId}`, pc: o.pc, creada: o.pc.desde });
  }
  const primero = o.primero || [];
  const rango = (x: ItemVentana) => {
    const i = primero.indexOf(x.id);
    return i < 0 ? Number.MAX_SAFE_INTEGER : i;
  };
  return items.sort((a, b) => rango(a) - rango(b) || a.creada - b.creada || a.clave.localeCompare(b.clave));
}

/**
 * Cuál se muestra: lo que se estaba viendo si sigue esperando (por su id: una versión nueva de la misma tarea se ve en su
 * lugar); si no, la primera de la fila. Excepción: lo que acaba de preguntar el turno (`nuevo`) toma su lugar.
 */
export function elegirActual(cola: ItemVentana[], o: { actual?: string | null; nuevo?: string | null } = {}): ItemVentana | null {
  if (!cola.length) return null;
  if (o.nuevo) {
    const n = cola.find((x) => x.id === o.nuevo);
    if (n) return n;
  }
  if (o.actual) {
    const a = cola.find((x) => x.id === o.actual);
    if (a) return a;
  }
  return cola[0];
}

/**
 * En una conversación de voz las respuestas de AU-RA no pasan por la mesa (no hay «lo que enlazó el turno»): lo que
 * apareció DESPUÉS de empezar a mostrar la actual (`visto.t`) es lo que AU-RA acaba de preguntar en voz, y toma el lugar
 * (el más nuevo; una vez cada uno: `tomados` con «voz:<clave>»). Fuera de una conversación de voz, nada.
 */
export function nuevoPorVoz(cola: ItemVentana[], o: { conversando: boolean; visto: { id: string; t: number } | null; tomados: ReadonlySet<string> }): ItemVentana | undefined {
  if (!o.conversando || !o.visto) return undefined;
  const v = o.visto;
  return [...cola].reverse().find((x) => x.creada > v.t && x.id !== v.id && !o.tomados.has(`voz:${x.clave}`));
}

/**
 * ¿Se abre sola? No se le echa encima otra vez (José: «Luego» la cierra): cerrada con «Luego», se queda cerrada hasta
 * `hasta`, salvo para algo NUEVO (una pregunta que llegó después de cerrarla, o lo que acaba de preguntar el turno).
 * Abierta desde el indicador (`forzada`), siempre.
 */
export function seAbreSola(item: ItemVentana | null, o: { ahora: number; cerrada?: { en: number; hasta: number } | null; delTurno?: boolean; forzada?: boolean }): boolean {
  if (!item) return false;
  if (o.forzada) return true;
  const c = o.cerrada;
  if (!c || o.ahora >= c.hasta) return true;
  return !!o.delTurno || item.creada > c.en;
}

/** «1 de 3» (nada si es una sola). */
export function textoPosicion(i: number, n: number, idioma: 'es' | 'en' = 'es'): string {
  if (n <= 1 || i < 0) return '';
  return idioma === 'en' ? `${i + 1} of ${n}` : `${i + 1} de ${n}`;
}

/* ------------------------------------------------------------------ lo que se ve */

/** El texto entre «» de una línea de datos («Texto: «Hola»» → «Hola»). */
const entreComillas = (s: string, clave: string) => {
  const m = String(s || '').match(new RegExp(`^${clave}:\\s*«([\\s\\S]*)»\\s*$`));
  return m ? m[1] : null;
};

export type DatosVentana = {
  /** La cabecera: «WhatsApp», «Correo», «Tu computadora», «Canales de la junta»… */
  etiqueta: string;
  pregunta: string;
  /** A quién va, tal cual lo da el servidor (nombre y número, o la dirección). */
  para?: string;
  desde?: string;
  asunto?: string;
  /** El texto exacto (el entero si el servidor lo manda; si no, el de la tarjeta). */
  texto?: string;
  /** Otras líneas de la propuesta (lo que no es asunto ni texto). */
  extra: string[];
  nota?: string;
  vencida: boolean;
  /** ¿Se puede editar aquí? (un borrador vigente, con su texto entero). */
  editable: boolean;
};

/** Lo más largo que se edita en la ventana (el servidor manda el texto entero hasta 6000). */
export const MAX_EDITAR = 5900;

export function datosVentana(item: ItemVentana, idioma: 'es' | 'en' = 'es'): DatosVentana {
  const en = idioma === 'en';
  if (item.tipo === 'computadora') {
    return {
      etiqueta: en ? 'Your computer' : 'Tu computadora',
      pregunta: item.pc.pregunta,
      extra: item.pc.instruccion ? [en ? `Task: ${item.pc.instruccion}` : `Encargo: ${item.pc.instruccion}`] : [],
      nota: en ? 'It is waiting for your OK before doing something sensitive.' : 'Espera tu sí antes de hacer algo sensible.',
      vencida: false,
      editable: false,
    };
  }
  const t = item.tarea;
  const d = t.decision!;
  const datos = d.proposal.data || [];
  const asunto = d.proposal.subject ?? datos.map((x) => entreComillas(x, 'Asunto')).find((x) => x !== null) ?? undefined;
  const textoCorto = datos.map((x) => entreComillas(x, 'Texto') ?? entreComillas(x, 'Contenido')).find((x) => x !== null) ?? undefined;
  const texto = d.proposal.text ?? textoCorto;
  const extra = datos.filter((x) => entreComillas(x, 'Asunto') === null && entreComillas(x, 'Texto') === null && entreComillas(x, 'Contenido') === null);
  const venc = vencida(t);
  const etiqueta = t.environment.kind === 'whatsapp' ? 'WhatsApp' : t.environment.kind === 'correo' ? (en ? 'Email' : 'Correo') : t.environment.kind === 'servidor' ? (en ? 'Board channels' : 'Canales de la junta') : t.source === 'tarea-en-curso' ? (en ? 'Unfinished task' : 'Tarea a medias') : en ? 'Decision' : 'Decisión';
  const editable = !venc && esBorrador(t) && d.options.some((o) => o.id === 'editar') && d.options.some((o) => o.id === 'aprobar') && typeof d.proposal.text === 'string' && d.proposal.text.length <= MAX_EDITAR;
  return {
    etiqueta,
    pregunta: venc ? preguntaVencida(t, idioma) : d.question,
    ...(d.proposal.recipient ? { para: d.proposal.recipient } : {}),
    ...(d.proposal.account ? { desde: d.proposal.account } : {}),
    ...(asunto ? { asunto } : {}),
    ...(texto ? { texto } : {}),
    extra,
    ...(venc ? { nota: t.currentStep || (en ? 'It was not sent.' : 'No se envió nada.') } : d.why ? { nota: d.why } : {}),
    vencida: venc,
    editable,
  };
}

const sinParentesis = (s: string) => String(s || '').replace(/\s*\([^)]*\)/g, '').replace(/\s+/g, ' ').trim();

function preguntaVencida(t: TareaVista, idioma: 'es' | 'en'): string {
  const para = sinParentesis(t.decision?.proposal.recipient || '');
  const que = t.environment.kind === 'whatsapp' ? (idioma === 'en' ? 'The WhatsApp' : 'El WhatsApp') : t.environment.kind === 'correo' ? (idioma === 'en' ? 'The email' : 'El correo') : idioma === 'en' ? 'The proposal' : 'La propuesta';
  if (idioma === 'en') return `${que}${para ? ` for ${para}` : ''} expired without being sent. Shall I redo it?`;
  return `${que}${para ? ` para ${para}` : ''} venció sin enviarse. ¿Lo rehago?`;
}

/* ------------------------------------------------------------------ los botones */

export type TipoBoton = 'si' | 'no' | 'editar' | 'rehacer' | 'opcion';
/** `opcion`: la opción del servidor que se manda (POST decisiones); `editar` y `rehacer` son de la ventana. */
export type BotonVentana = { id: string; tipo: TipoBoton; etiqueta: string; conEfecto: boolean; opcion?: string; efecto?: string };

/**
 * Los botones grandes. Un borrador vigente: Sí · No · Editar. Lo que no se edita: Sí · No. Una vencida: Rehacer ·
 * Descartar. La tarea a medias y lo demás: sus propias respuestas. «Luego» va aparte (no es una respuesta).
 */
export function botonesVentana(item: ItemVentana, idioma: 'es' | 'en' = 'es'): BotonVentana[] {
  const en = idioma === 'en';
  if (item.tipo === 'computadora') {
    return [
      { id: 'si', tipo: 'si', etiqueta: en ? 'Yes' : 'Sí', conEfecto: true },
      { id: 'no', tipo: 'no', etiqueta: 'No', conEfecto: false },
    ];
  }
  const t = item.tarea;
  const d = t.decision!;
  const ids = new Set(d.options.map((o) => o.id));
  const efecto = (id: string) => d.options.find((o) => o.id === id)?.effect;
  if (vencida(t)) {
    const out: BotonVentana[] = [];
    if (esBorrador(t)) out.push({ id: 'rehacer', tipo: 'rehacer', etiqueta: en ? 'Redo it' : 'Rehacer', conEfecto: false });
    if (ids.has('rechazar')) out.push({ id: 'rechazar', tipo: 'no', etiqueta: en ? 'Discard' : 'Descartar', conEfecto: false, opcion: 'rechazar', efecto: efecto('rechazar') });
    return out;
  }
  if (ids.has('aprobar')) {
    const out: BotonVentana[] = [{ id: 'aprobar', tipo: 'si', etiqueta: en ? 'Yes' : 'Sí', conEfecto: true, opcion: 'aprobar', efecto: efecto('aprobar') }];
    if (ids.has('rechazar')) out.push({ id: 'rechazar', tipo: 'no', etiqueta: 'No', conEfecto: false, opcion: 'rechazar', efecto: efecto('rechazar') });
    if (datosVentana(item, idioma).editable) out.push({ id: 'editar', tipo: 'editar', etiqueta: en ? 'Edit' : 'Editar', conEfecto: false });
    return out;
  }
  // Sus propias respuestas (la tarea a medias: «Dejarla para después», «Terminarla primero», «Descartarla»).
  return opcionesTarjeta(d).map((o) => ({ id: o.id, tipo: 'opcion' as const, etiqueta: o.label, conEfecto: o.conEfecto, opcion: o.id, efecto: o.effect }));
}

/** ¿Tiene «Luego»? Todo lo que no sea ya una opción de la decisión misma (la tarea a medias ya trae «para después»). */
export function tieneLuego(item: ItemVentana): boolean {
  if (item.tipo === 'computadora') return true;
  return botonesVentana(item).every((b) => b.tipo !== 'opcion');
}

/** «Luego» en el servidor (posponer con hora: vuelve sola) solo si la decisión lo ofrece y sigue vigente. */
export function luegoEnServidor(item: ItemVentana): boolean {
  return item.tipo === 'tarea' && !vencida(item.tarea) && !!item.tarea.decision?.options.some((o) => o.id === 'posponer');
}

/** Hasta cuándo se va con «Luego» (ISO, para `hasta` del servidor). */
export const hastaLuego = (ahora = Date.now()) => new Date(ahora + LUEGO_MS).toISOString();

/* ------------------------------------------------------------------ lo que dice en voz alta */

/** La pregunta corta para decirla (sin números entre paréntesis: «¿Envío este WhatsApp a Ana?»). */
export function fraseVentana(item: ItemVentana, idioma: 'es' | 'en' = 'es'): string {
  if (item.tipo === 'computadora') return idioma === 'en' ? `Your computer is asking: ${sinParentesis(item.pc.pregunta).slice(0, 140)}` : `Tu computadora pregunta: ${sinParentesis(item.pc.pregunta).slice(0, 140)}`;
  const d = datosVentana(item, idioma);
  return sinParentesis(d.pregunta).slice(0, 160);
}

/**
 * ¿La ventana dice la pregunta en voz alta? Una vez por decisión (`dichas`), nunca en una conversación de voz (ahí la
 * hace el agente; José: «no suena en una conversación de voz»), ni mientras AU-RA ya habla, ni con la mesa tapada, ni
 * para lo que el turno acaba de leer en voz alta (`delTurno`: sería decirlo dos veces).
 */
export function debeHablar(o: { clave: string; dichas: ReadonlySet<string>; conversando: boolean; hablando: boolean; visible: boolean; delTurno: boolean }): boolean {
  return o.visible && !o.conversando && !o.hablando && !o.delTurno && !o.dichas.has(o.clave);
}

/* ------------------------------------------------------------------ editar */

export type Edicion = { clave: string; texto: string; original: string; asunto?: string; asuntoOriginal?: string };

/** Empieza a editar: el texto entero (y el asunto, en un correo). null si no se puede editar aquí. */
export function empezarEdicion(item: ItemVentana, idioma: 'es' | 'en' = 'es'): Edicion | null {
  const d = datosVentana(item, idioma);
  if (!d.editable || item.tipo !== 'tarea' || d.texto === undefined) return null;
  const correo = item.tarea.environment.kind === 'correo';
  return { clave: item.clave, texto: d.texto, original: d.texto, ...(correo ? { asunto: d.asunto ?? '', asuntoOriginal: d.asunto ?? '' } : {}) };
}

/** ¿Se puede guardar? Que no quede vacío, que no sea larguísimo y que algo haya cambiado. */
export function puedeGuardar(e: Edicion | null): boolean {
  if (!e) return false;
  const t = e.texto.trim();
  if (!t || t.length > MAX_EDITAR) return false;
  return t !== e.original.trim() || (e.asunto !== undefined && e.asunto.trim() !== (e.asuntoOriginal ?? '').trim());
}

/** Lo que va al servidor al guardar (POST /api/trabajos/:id/editar). */
export function cuerpoEdicion(e: Edicion): { texto: string; asunto?: string } {
  return { texto: e.texto.trim(), ...(e.asunto !== undefined && e.asunto.trim() !== (e.asuntoOriginal ?? '').trim() ? { asunto: e.asunto.trim() } : {}) };
}

/**
 * Qué decisión se le dice al servidor que está a la vista (POST en-pantalla). Revisión independiente (MENOR a): mientras
 * se EDITA, ninguna: lo que se ve ya no es lo que va a salir, y un «sí» dicho entonces mandaría el texto viejo. Al
 * guardar, la versión nueva se vuelve a mostrar (y a registrar); al cancelar, vuelve la de antes.
 */
export function tareaEnPantalla(item: ItemVentana | null, edicion: Edicion | null): TareaVista | null {
  if (!item || item.tipo !== 'tarea') return null;
  if (edicion && edicion.clave === item.clave) return null;
  return item.tarea;
}

/** ¿La edición sigue siendo de lo que se ve? (si cambió la decisión mientras escribía, no se guarda a ciegas). */
export const edicionVigente = (e: Edicion | null, item: ItemVentana | null) => !!e && !!item && e.clave === item.clave;

/* ------------------------------------------------------------------ rehacer lo vencido */

/** Lo que se le pide a AU-RA para rehacer un borrador vencido (arma uno nuevo que vuelve a la ventana para su «sí»). */
export function pedidoRehacer(item: ItemVentana, idioma: 'es' | 'en' = 'es'): string | null {
  if (item.tipo !== 'tarea' || !esBorrador(item.tarea)) return null;
  const d = datosVentana(item, idioma);
  const para = d.para || '';
  const que = item.tarea.environment.kind === 'whatsapp' ? 'WhatsApp' : idioma === 'en' ? 'email' : 'correo';
  const texto = (d.texto || '').slice(0, 1200);
  if (idioma === 'en') return `Redo the ${que} for ${para}${d.asunto ? ` (subject: ${d.asunto})` : ''}: «${texto}»`;
  return `Rehaz el ${que} para ${para}${d.asunto ? ` (asunto: ${d.asunto})` : ''}: «${texto}»`;
}
