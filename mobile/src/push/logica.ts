/**
 * LOS AVISOS DEL SERVIDOR CON LA APP CERRADA (Firebase Cloud Messaging): qué significa cada uno y cómo
 * se enseña. Puro: sin React Native ni Firebase (lo prueba node con un notifee falso); el pegamento con
 * el teléfono está en push/nativo.ts y el manejador de fondo en push/fondo.ts.
 *
 * El servidor (lib/push.ts) manda SOLO DATOS, todo texto, con `aura: 'push'`, `tipo`, `id`, `para`
 * (el seudónimo de la cuenta, lib/cuenta.ts) y `enviado` (ms). La app decide cómo se ve:
 *
 *   llamada      {de:'AURA', motivo}   → la MISMA llamada entrante que un «llámame a las 5 para
 *                                        recordarme…» (compa/recordatorios.ts: categoría llamada,
 *                                        pantalla completa, timbre en bucle, Contestar / Rechazar). Al
 *                                        contestar, la app abre la conversación con AURA y le pasa el
 *                                        `motivo` por el mismo camino (`[[recordatorio]] <motivo>`). Si
 *                                        no contesta, queda «AURA te llamó» (como el aviso final).
 *                                        Una llamada que llega tarde (más de LLAMADA_VIEJA_MS) ya no
 *                                        suena: queda el aviso «AURA te llamó».
 *   mensaje      {titulo, texto, abrir?} → aviso normal de prioridad alta; al tocarlo, la mesa (o lo que
 *                                        diga `abrir`) y AURA lo lee con su voz.
 *   propuesta    {texto, pedido}        → aviso con «Sí» / «Luego». «Sí» abre la app y hace el pedido;
 *                                        «Luego» se contesta al servidor sin abrir nada.
 *   recordatorio {texto}                → aviso; al tocarlo, AURA lo dice.
 *                {rid, cuando}         → (A-3) la vez de un recordatorio del servidor: si este teléfono ya tenía puesta
 *                                        su alarma (notifee), ya sonó aquí y el aviso NO se enseña (`yaSonoAqui`); igual
 *                                        sirve para reconciliar las alarmas (compa/recordatoriosSync.ts). Lo mismo una
 *                                        `llamada` con `rid`.
 *   computadora  {texto}                → «Terminé en mi computadora: …»; al tocarlo, la vista en vivo.
 *   mensaje-externo {canal, titulo, texto, sugerencia, chat, nombre, urgente?}
 *                                        → un WhatsApp o un correo IMPORTANTE que le llegó (server, lib/alertas-
 *                                        mensajes.ts): una línea de qué dijo y la respuesta sugerida. Al tocarlo,
 *                                        WhatsApp: se abre ESE chat con la sugerencia como borrador en la caja de
 *                                        texto (whatsapp/pedido.ts; no sale nada sin tocar «Enviar»). Correo: se abren
 *                                        sus correos y AURA dice de quién es.
 *
 *   decision     {objetivoId, tareaId?, decisionId, revision, pregunta, opciones:[{id, etiqueta≤24}]≤3}
 *                                        → (Fase 2) «Necesito tu decisión»: un botón por opción (≤3). Tocar un botón manda
 *                                        ESA opción con la revisión del aviso (`revisionVista`), sin abrir la app; si el
 *                                        objetivo cambió mientras tanto (409) el aviso pasa a «Cambió mientras tanto: ábrelo
 *                                        para ver la versión nueva»; si salió, a una confirmación corta. Tocar el aviso abre
 *                                        el objetivo. Privado como todos: con el teléfono bloqueado Android no enseña la
 *                                        pregunta ni los botones (`privacidadDecision`); al desbloquear, sí.
 *
 * Nada se enseña si `para` no es de quien está registrado en este teléfono (teléfono compartido: si ya
 * entró otra persona, el aviso de la anterior no aparece). Cada aviso una sola vez (por tipo e id).
 */
import { tr } from '../i18n';
import { avisoDeLlamada, avisoNormal, CANAL_LLAMADA, type ConstantesNotifee } from '../compa/recordatorios';

/** Las constantes de notifee que se usan (las de los recordatorios y el estilo de texto largo). */
export type ConstantesPush = ConstantesNotifee & { AndroidStyle?: { BIGTEXT: number } };

export const TIPOS_PUSH = ['llamada', 'mensaje', 'propuesta', 'recordatorio', 'computadora', 'mensaje-externo', 'decision'] as const;
export type TipoPush = (typeof TIPOS_PUSH)[number];

/** Lo que llega, ya validado y acotado. */
export type DatosPush = {
  tipo: TipoPush;
  id: string;
  para: string;
  enviado: number;
  titulo: string;
  texto: string;
  /** llamada: por qué llama AURA. */
  motivo: string;
  /** propuesta: lo que se pide al decir «Sí». */
  pedido: string;
  /** mensaje: qué abrir al tocarlo. */
  abrir: string;
  /** mensaje-externo: 'whatsapp' | 'correo'. */
  canal: string;
  /** mensaje-externo: el chat de WhatsApp (jid) o la ref del correo. */
  chat: string;
  /** mensaje-externo: quién escribió (o el grupo). */
  nombre: string;
  /** mensaje-externo: la respuesta sugerida (va como borrador; nunca se manda sola). */
  sugerencia: string;
  /** mensaje-externo: '1' si es urgente. */
  urgente: string;
  /** A-3: el recordatorio del servidor de esta vez, y cuál vez (ms). Vacío / 0 en los demás avisos. */
  rid: string;
  cuando: number;
  /**
   * mensaje: lo que AURA dice al tocarlo, ya en la app (revisión de la tanda F: el resumen de la mañana trae en `texto`
   * solo cuántos y quién, para la pantalla bloqueada, y lo detallado aquí). Vacío: dice `texto`.
   */
  decir: string;
  /** decision (Fase 2): de qué objetivo y (si es la aprobación de una tarea suya) de qué tarea. */
  objetivoId: string;
  tareaId: string;
  decisionId: string;
  /** decision: la revisión del objetivo (o la versión de la tarea) que vio el aviso: va como `revisionVista`. */
  revision: number;
  pregunta: string;
  /** decision: un botón por opción (≤3, etiquetas cortas). */
  opciones: OpcionAviso[];
};

export type OpcionAviso = { id: string; etiqueta: string };
/** Cuántas opciones lleva el aviso y de qué largo (lib/push.ts MAX_OPCIONES_PUSH / MAX_ETIQUETA_PUSH). */
export const MAX_OPCIONES_AVISO = 3;
export const MAX_ETIQUETA_AVISO = 24;
/** El prefijo de los botones de una decisión: `aura-push-decidir:<id de la opción>`. */
export const ACCION_DECIDIR = 'aura-push-decidir:';
/**
 * La privacidad de los avisos de AURA en la pantalla bloqueada (la de siempre: `privado()`, visibilidad PRIVATE): Android
 * enseña que hay un aviso, no lo que dice. Un aviso de decisión la respeta: sin contenido en la pantalla bloqueada.
 */
export const CONTENIDO_EN_BLOQUEO = false;

export const CANAL_AVISOS = 'aura-avisos';
export const ACCION_ABRIR = 'aura-push-abrir';
export const ACCION_SI = 'aura-push-si';
export const ACCION_LUEGO = 'aura-push-luego';
/** Una llamada que tardó más que esto en llegar ya no suena (el servidor le da 60 s de vida en FCM). */
export const LLAMADA_VIEJA_MS = 90_000;
/** Cuánto se recuerda un aviso ya enseñado (para no enseñarlo dos veces). */
export const VENTANA_VISTOS_MS = 6 * 3600_000;
export const MAX_VISTOS = 80;
/** `tareas`: la mesa con el panel de tareas abierto (p. ej. «Terminé de investigar», server/investigar.ts). */
export const ABRIBLES = ['mesa', 'chats', 'ajustes', 'computadora', 'correos', 'tareas', 'whatsapp'] as const;

const linea = (s: unknown, max: number) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

/** Las opciones del aviso `decision`: llegan como texto JSON (FCM solo lleva texto) o ya como lista. ≤3, válidas. */
export function leerOpcionesAviso(v: unknown): OpcionAviso[] {
  let xs: unknown = v;
  if (typeof v === 'string') {
    try {
      xs = JSON.parse(v);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(xs)) return [];
  const out: OpcionAviso[] = [];
  for (const x of xs) {
    const id = String((x as OpcionAviso)?.id ?? '');
    const etiqueta = linea((x as OpcionAviso)?.etiqueta, MAX_ETIQUETA_AVISO);
    if (!/^[A-Za-z0-9_:.-]{1,60}$/.test(id) || !etiqueta || out.some((o) => o.id === id)) continue;
    out.push({ id, etiqueta });
    if (out.length >= MAX_OPCIONES_AVISO) break;
  }
  return out;
}

/** Los datos de FCM, validados. null si no son un aviso de AURA (o están rotos). Nunca lanza. */
export function leerDatos(d: unknown): DatosPush | null {
  if (!d || typeof d !== 'object') return null;
  const x = d as Record<string, unknown>;
  if (x.aura !== 'push') return null;
  const tipo = String(x.tipo || '') as TipoPush;
  if (!TIPOS_PUSH.includes(tipo)) return null;
  const id = String(x.id || '');
  if (!/^[A-Za-z0-9_.:-]{1,80}$/.test(id)) return null;
  const para = String(x.para || '');
  if (!/^u[0-9a-f]{16}$/.test(para)) return null;
  const abrir = linea(x.abrir, 20).toLowerCase();
  const canal = linea(x.canal, 12).toLowerCase();
  // El chat de un mensaje externo: un jid de WhatsApp o la ref de un correo («<cuenta>:<uid>»); otra cosa no se abre.
  const chat = linea(x.chat, 140);
  const chatValido = canal === 'whatsapp' ? /^[0-9A-Za-z._:-]{3,120}@[a-z.]{2,40}$/.test(chat) : canal === 'correo' ? /^[A-Za-z0-9_-]{1,80}:\d{1,12}$/.test(chat) : false;
  if (tipo === 'mensaje-externo' && !chatValido) return null;
  // Una decisión sin a qué contestar (ni objetivo ni tarea, sin id de decisión o sin revisión) no se enseña.
  const objetivoId = /^ob_[a-z0-9]{8,40}$/.test(String(x.objetivoId || '')) ? String(x.objetivoId) : '';
  const tareaId = /^[A-Za-z0-9_-]{4,64}$/.test(String(x.tareaId || '')) ? String(x.tareaId) : '';
  const decisionId = /^[A-Za-z0-9_:.-]{1,80}$/.test(String(x.decisionId || '')) ? String(x.decisionId) : '';
  const revision = Number(x.revision);
  if (tipo === 'decision' && ((!objetivoId && !tareaId) || !decisionId || !Number.isInteger(revision) || revision < 1)) return null;
  return {
    tipo,
    id,
    para,
    enviado: Number(x.enviado) || 0,
    titulo: linea(x.titulo, 80),
    texto: linea(x.texto, 600),
    motivo: linea(x.motivo, 300),
    pedido: linea(x.pedido, 600),
    abrir: (ABRIBLES as readonly string[]).includes(abrir) ? abrir : '',
    canal: canal === 'whatsapp' || canal === 'correo' ? canal : '',
    chat: chatValido ? chat : '',
    nombre: linea(x.nombre, 80),
    sugerencia: linea(x.sugerencia, 300),
    urgente: x.urgente === '1' || x.urgente === true ? '1' : '',
    rid: /^aura-rec-s[a-z0-9]{8,20}$/.test(String(x.rid || '')) ? String(x.rid) : '',
    cuando: Number.isFinite(Number(x.cuando)) ? Number(x.cuando) : 0,
    decir: tipo === 'mensaje' ? linea(x.decir, 900) : '',
    objetivoId: tipo === 'decision' ? objetivoId : '',
    tareaId: tipo === 'decision' ? tareaId : '',
    decisionId: tipo === 'decision' ? decisionId : '',
    revision: tipo === 'decision' ? revision : 0,
    pregunta: tipo === 'decision' ? linea(x.pregunta, 200) : '',
    opciones: tipo === 'decision' ? leerOpcionesAviso(x.opciones) : [],
  };
}

/** El id base de la llamada (con la forma de los recordatorios, para que sus manejadores la atiendan). */
export const baseLlamada = (id: string) => `aura-push-${id.toLowerCase().replace(/[^a-z0-9-]/g, '-').slice(0, 60)}`;
export const idAviso = (p: Pick<DatosPush, 'tipo' | 'id'>) => `aura-push-${p.tipo}-${p.id}`;

/** Lo que va en `data` del aviso (notifee solo acepta texto): de dónde vino y qué hacer al tocarlo. */
function datosAviso(p: DatosPush): Record<string, string> {
  return {
    aura: 'push',
    tipo: p.tipo,
    id: p.id,
    para: p.para,
    titulo: p.titulo,
    texto: p.texto,
    pedido: p.pedido,
    abrir: p.abrir,
    // Lo que AURA dice al tocarlo: en los datos del aviso (no se muestra), nunca en el cuerpo que se ve bloqueado.
    ...(p.tipo === 'mensaje' && p.decir ? { decir: p.decir } : {}),
    ...(p.tipo === 'mensaje-externo' ? { canal: p.canal, chat: p.chat, nombre: p.nombre, sugerencia: p.sugerencia, urgente: p.urgente } : {}),
    ...(p.tipo === 'decision'
      ? { objetivoId: p.objetivoId, tareaId: p.tareaId, decisionId: p.decisionId, revision: String(p.revision), pregunta: p.pregunta, opciones: JSON.stringify(p.opciones) }
      : {}),
  };
}

function privado(k: ConstantesNotifee): Record<string, unknown> {
  return k.AndroidVisibility ? { visibility: k.AndroidVisibility.PRIVATE ?? 0 } : {};
}

export type Plan =
  /** `ya_sono`: la alarma de esa vez de un recordatorio del servidor ya estaba puesta en este teléfono (A-3). */
  | { que: 'ignorar'; porque: 'ajeno' | 'sin_dueno' | 'repetido' | 'ya_sono' }
  /** `canales`: los que hay que crear antes; `despues`: un aviso programado (la llamada perdida). */
  | { que: 'mostrar'; canales: Record<string, unknown>[]; aviso: Record<string, unknown>; despues?: { aviso: Record<string, unknown>; cuando: number } };

export function canalLlamada(k: ConstantesNotifee): Record<string, unknown> {
  // La misma configuración que compa/recordatorios.ts: los canales de Android no cambian después de creados.
  return {
    id: CANAL_LLAMADA,
    name: tr('AURA te llama (recordatorios)', 'AURA calls you (reminders)'),
    description: tr('Cuando le pides a AURA que te llame para recordarte algo', 'When you ask AURA to call you to remind you of something'),
    importance: k.AndroidImportance.HIGH,
    sound: 'default',
    vibration: true,
    vibrationPattern: [300, 700, 300, 700],
    ...(k.AndroidVisibility ? { visibility: k.AndroidVisibility.PUBLIC } : {}),
  };
}

export function canalAvisos(k: ConstantesNotifee): Record<string, unknown> {
  return {
    id: CANAL_AVISOS,
    name: tr('Avisos de AURA', 'AURA notifications'),
    description: tr('Mensajes, propuestas y lo que termina tu computadora', 'Messages, suggestions and what your computer finishes'),
    importance: k.AndroidImportance.HIGH,
    sound: 'default',
  };
}

function avisoComun(p: DatosPush, k: ConstantesPush, titulo: string, cuerpo: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: idAviso(p),
    title: titulo,
    body: cuerpo,
    data: datosAviso(p),
    android: {
      channelId: CANAL_AVISOS,
      importance: k.AndroidImportance.HIGH,
      ...privado(k),
      pressAction: { id: ACCION_ABRIR, launchActivity: 'default' },
      ...(k.AndroidStyle ? { style: { type: k.AndroidStyle.BIGTEXT, text: cuerpo } } : {}),
      ...extra,
    },
  };
}

/** El aviso «AURA te llamó» (la llamada perdida, o la que llegó tarde). */
export function avisoLlamadaPerdida(p: DatosPush, k: ConstantesNotifee, dueno: string, ahora: number): Record<string, unknown> {
  const motivo = p.motivo || p.texto || tr('Quería hablar contigo.', 'I wanted to talk to you.');
  return { ...avisoNormal(baseLlamada(p.id), motivo, ahora, 'final', true, k, dueno), title: tr('AURA te llamó', 'AURA called you') };
}

/**
 * Qué hacer con un aviso que llegó. `dueno`: el seudónimo registrado en este teléfono ('' si nadie).
 * `visto`: si ese aviso ya se enseñó. Puro: quien llama crea los canales y lo enseña.
 */
export function planear(p: DatosPush, o: { dueno: string; ahora: number; k: ConstantesPush; visto?: boolean; yaSonoAqui?: boolean }): Plan {
  if (!o.dueno) return { que: 'ignorar', porque: 'sin_dueno' };
  if (p.para !== o.dueno) return { que: 'ignorar', porque: 'ajeno' };
  if (o.visto) return { que: 'ignorar', porque: 'repetido' };
  // Un recordatorio del servidor cuya alarma de esa vez ya estaba aquí: sonó con notifee, no suena dos veces.
  if (p.rid && o.yaSonoAqui && (p.tipo === 'recordatorio' || p.tipo === 'llamada')) return { que: 'ignorar', porque: 'ya_sono' };
  const { k, ahora, dueno } = o;
  switch (p.tipo) {
    case 'llamada': {
      const motivo = p.motivo || p.texto || tr('Quiero hablar contigo.', 'I want to talk to you.');
      // Llegó tarde (teléfono sin red un rato): no suena una llamada vieja; queda que llamó.
      if (p.enviado && ahora - p.enviado > LLAMADA_VIEJA_MS) return { que: 'mostrar', canales: [canalLlamada(k)], aviso: avisoLlamadaPerdida(p, k, dueno, ahora) };
      const base = baseLlamada(p.id);
      const aviso = avisoDeLlamada(base, motivo, ahora, 'l1', k, dueno);
      return {
        que: 'mostrar',
        canales: [canalLlamada(k)],
        // El texto del aviso es el motivo, no «Para recordarte…»; lo demás (datos, botones, pantalla
        // completa, timbre, un minuto sonando) es el de la llamada de un recordatorio.
        aviso: { ...aviso, title: tr('AURA te llama', 'AURA is calling'), body: motivo },
        // Si no contesta en el minuto que suena, queda «AURA te llamó». Contestar o rechazar lo quita
        // (recordatorios.ts alContestar cancela `<base>-final`).
        despues: { aviso: avisoLlamadaPerdida(p, k, dueno, ahora), cuando: ahora + 65_000 },
      };
    }
    case 'mensaje':
      return { que: 'mostrar', canales: [canalAvisos(k)], aviso: avisoComun(p, k, p.titulo || 'AURA', p.texto || tr('Tengo algo para ti.', 'I have something for you.')) };
    case 'propuesta':
      return {
        que: 'mostrar',
        canales: [canalAvisos(k)],
        aviso: avisoComun(p, k, p.titulo || 'AURA', p.texto || tr('Tengo una idea para ti.', 'I have an idea for you.'), {
          actions: [
            { title: tr('Sí', 'Yes'), pressAction: { id: ACCION_SI, launchActivity: 'default' } },
            { title: tr('Luego', 'Later'), pressAction: { id: ACCION_LUEGO } },
          ],
        }),
      };
    case 'recordatorio':
      return { que: 'mostrar', canales: [canalAvisos(k)], aviso: avisoComun(p, k, tr('AURA te recuerda', 'AURA reminds you'), p.texto) };
    case 'computadora':
      return {
        que: 'mostrar',
        canales: [canalAvisos(k)],
        // El título lo pone el servidor según cómo terminó de verdad (nunca «Terminé» si no quedó); uno viejo no lo manda.
        aviso: avisoComun(p, k, p.titulo || tr('Terminé en mi computadora', 'Done on my computer'), p.texto || tr('Ya terminé la tarea.', 'I finished the task.')),
      };
    case 'mensaje-externo':
      return { que: 'mostrar', canales: [canalAvisos(k)], aviso: avisoMensajeExterno(p, k) };
    case 'decision':
      return { que: 'mostrar', canales: [canalAvisos(k)], aviso: avisoDecision(p, k) };
  }
}

/**
 * La privacidad de un aviso de decisión en la pantalla bloqueada. Con contenido permitido (`CONTENIDO_EN_BLOQUEO`):
 * público, con su pregunta y sus botones. Sin él (lo de siempre en AU-RA): privado; Android enseña solo «AU-RA · contenido
 * oculto» en la pantalla bloqueada segura —ni la pregunta ni los botones— y todo al desbloquear.
 */
export function privacidadDecision(k: ConstantesNotifee, contenidoEnBloqueo = CONTENIDO_EN_BLOQUEO): { visibility?: number; botonesEnBloqueo: boolean; preguntaEnBloqueo: boolean } {
  if (contenidoEnBloqueo) return { ...(k.AndroidVisibility ? { visibility: k.AndroidVisibility.PUBLIC } : {}), botonesEnBloqueo: true, preguntaEnBloqueo: true };
  return { ...(k.AndroidVisibility ? { visibility: k.AndroidVisibility.PRIVATE ?? 0 } : {}), botonesEnBloqueo: false, preguntaEnBloqueo: false };
}

/** Los botones del aviso: uno por opción (≤3), cada uno manda ESA opción sin abrir la app. */
export function botonesDecision(p: Pick<DatosPush, 'opciones'>): { title: string; pressAction: { id: string } }[] {
  return p.opciones.slice(0, MAX_OPCIONES_AVISO).map((o) => ({ title: o.etiqueta, pressAction: { id: `${ACCION_DECIDIR}${o.id}` } }));
}

/** «Necesito tu decisión»: la pregunta, un botón por opción y, al tocarlo, el objetivo. */
export function avisoDecision(p: DatosPush, k: ConstantesPush, contenidoEnBloqueo = CONTENIDO_EN_BLOQUEO): Record<string, unknown> {
  const priv = privacidadDecision(k, contenidoEnBloqueo);
  const botones = botonesDecision(p);
  const aviso = avisoComun(p, k, tr('Necesito tu decisión', 'I need your decision'), p.pregunta || tr('Ábrelo para decidir.', 'Open it to decide.'), botones.length ? { actions: botones } : {});
  const android = { ...(aviso.android as Record<string, unknown>) };
  if (priv.visibility !== undefined) android.visibility = priv.visibility;
  else delete android.visibility;
  return { ...aviso, android };
}

/** Cómo terminó mandar la decisión desde el aviso: `ok` (quedó, o ya estaba), `cambio` (409: cambió), `error` (red, otro). */
export type FinDecisionAviso = 'ok' | 'cambio' | 'error';

/** Qué significa la respuesta del servidor a la decisión mandada desde un botón del aviso. */
export function finDecisionAviso(r: { status: number; json?: any } | null | undefined): FinDecisionAviso {
  if (!r) return 'error';
  if (r.status >= 200 && r.status < 300) return 'ok';
  const codigo = String(r.json?.codigo || r.json?.code || '');
  // 409 (otra revisión, la pregunta ya cambió, ya se decidió, terminó), 404 (ya no está) o una opción que ya no se ofrece.
  if (r.status === 409 || r.status === 404 || codigo === 'opcion') return 'cambio';
  return 'error';
}

/** Lo que se manda al tocar un botón: la ruta y el cuerpo exactos (objetivo con `revisionVista`; tarea con su versión). */
export function pedidoDecisionAviso(p: Pick<DatosPush, 'tipo' | 'objetivoId' | 'tareaId' | 'decisionId' | 'revision' | 'opciones'>, opcion: string, aparato = ''): { ruta: string; cuerpo: Record<string, unknown> } | null {
  if (p.tipo !== 'decision' || !p.opciones.some((o) => o.id === opcion)) return null;
  if (p.tareaId) return { ruta: `/api/trabajos/${encodeURIComponent(p.tareaId)}/decisiones?estados=respondida`, cuerpo: { decisionId: p.decisionId, expectedVersion: p.revision, opcion } };
  if (!p.objetivoId) return null;
  return { ruta: `/api/objetivos/${encodeURIComponent(p.objetivoId)}/decisiones`, cuerpo: { decisionId: p.decisionId, opcion, revisionVista: p.revision, ...(aparato ? { aparato } : {}) } };
}

/**
 * El aviso después de tocar un botón (reemplaza al de la pregunta, con el mismo id): una confirmación corta, «Cambió
 * mientras tanto: ábrelo para ver la versión nueva», o que no se pudo. Sin botones; tocarlo abre el objetivo.
 */
export function avisoTrasDecidir(p: DatosPush, fin: FinDecisionAviso, opcion: string, k: ConstantesPush): Record<string, unknown> {
  const etiqueta = p.opciones.find((o) => o.id === opcion)?.etiqueta || '';
  const titulo = fin === 'ok' ? tr('Listo', 'Done') : fin === 'cambio' ? tr('Cambió mientras tanto', 'It changed in the meantime') : tr('No pude mandar tu decisión', "I couldn't send your decision");
  const cuerpo =
    fin === 'ok'
      ? etiqueta
        ? tr(`Elegiste «${etiqueta}». Sigo con eso.`, `You chose «${etiqueta}». I'll carry on.`)
        : tr('Tu decisión quedó. Sigo con eso.', "Your decision is in. I'll carry on.")
      : fin === 'cambio'
        ? tr('Cambió mientras tanto: ábrelo para ver la versión nueva.', 'It changed in the meantime: open it to see the new version.')
        : tr('No sé si llegó. Ábrelo para ver cómo quedó antes de repetir.', "I don't know if it arrived. Open it to check before trying again.");
  const aviso = avisoComun(p, k, titulo, cuerpo);
  const android = { ...(aviso.android as Record<string, unknown>) };
  delete android.actions;
  return { ...aviso, android };
}

/** El aviso de un mensaje importante: quién y qué dijo, y la respuesta sugerida (que se abre como borrador al tocarlo). */
export function avisoMensajeExterno(p: DatosPush, k: ConstantesPush): Record<string, unknown> {
  const titulo = p.titulo || (p.canal === 'correo' ? tr('Correo importante', 'Important email') : tr('WhatsApp importante', 'Important WhatsApp'));
  const cuerpo = `${p.texto || tr('Te escribieron.', 'Someone wrote to you.')}${p.sugerencia ? `\n${tr('Sugerencia', 'Suggestion')}: «${p.sugerencia}»` : ''}`;
  const responder = p.canal === 'whatsapp' && p.sugerencia ? [{ title: tr('Responder', 'Reply'), pressAction: { id: ACCION_ABRIR, launchActivity: 'default' } }] : [];
  return avisoComun(p, k, titulo, cuerpo, responder.length ? { actions: responder } : {});
}

/**
 * Qué hace la app al tocar un mensaje importante. WhatsApp: abrir ESE chat con la sugerencia como borrador (no se manda).
 * Correo: abrir sus correos y que AURA diga de quién es. null si el aviso no trae a dónde ir.
 */
export function destinoMensajeExterno(p: DatosPush): { abrir: 'whatsapp'; chat: string; nombre: string; borrador: string } | { abrir: 'correos'; decir: string } | null {
  if (p.tipo !== 'mensaje-externo' || !p.chat) return null;
  if (p.canal === 'whatsapp') return { abrir: 'whatsapp', chat: p.chat, nombre: p.nombre, borrador: p.sugerencia };
  if (p.canal === 'correo') return { abrir: 'correos', decir: p.texto };
  return null;
}

/* ── los toques ──────────────────────────────────────────────────────────────────────────── */

export type AccionPush = 'abrir' | 'si' | 'luego' | 'decidir';
export type EventoAviso = { type: number; detail?: { notification?: { id?: string; data?: Record<string, unknown> }; pressAction?: { id?: string } } };

/**
 * Qué significa un evento de notifee para estos avisos, o null si no es de ellos (la llamada no pasa
 * por aquí: sus datos son los de un recordatorio y la atiende compa/recordatoriosNativo.ts).
 */
export function interpretarToque(e: EventoAviso, k: ConstantesNotifee): { accion: AccionPush; datos: DatosPush; idAviso: string; opcion?: string } | null {
  const datos = leerDatosAviso(e?.detail?.notification?.data);
  if (!datos) return null;
  const T = k.EventType ?? { DISMISSED: 0, PRESS: 1, ACTION_PRESS: 2, DELIVERED: 3 };
  const id = e.detail?.pressAction?.id;
  const idA = String(e.detail?.notification?.id || idAviso(datos));
  if (e.type === T.ACTION_PRESS && id === ACCION_SI) return { accion: 'si', datos, idAviso: idA };
  if (e.type === T.ACTION_PRESS && id === ACCION_LUEGO) return { accion: 'luego', datos, idAviso: idA };
  // Un botón de una decisión: la opción tiene que ser una de las que trajo el aviso (nada inventado desde el evento).
  if (e.type === T.ACTION_PRESS && typeof id === 'string' && id.startsWith(ACCION_DECIDIR)) {
    const opcion = id.slice(ACCION_DECIDIR.length);
    return datos.tipo === 'decision' && datos.opciones.some((o) => o.id === opcion) ? { accion: 'decidir', datos, idAviso: idA, opcion } : null;
  }
  if (e.type === T.PRESS || (e.type === T.ACTION_PRESS && id === ACCION_ABRIR)) return { accion: 'abrir', datos, idAviso: idA };
  return null;
}

/** Lo que abrió la app (getInitialNotification de notifee). */
export function interpretarAperturaPush(ini: { notification?: { id?: string; data?: Record<string, unknown> }; pressAction?: { id?: string } } | null | undefined, k: ConstantesNotifee) {
  if (!ini?.notification) return null;
  const T = k.EventType ?? { DISMISSED: 0, PRESS: 1, ACTION_PRESS: 2, DELIVERED: 3 };
  const id = ini.pressAction?.id;
  return interpretarToque({ type: id === ACCION_SI || id === ACCION_LUEGO ? T.ACTION_PRESS : T.PRESS, detail: { notification: ini.notification, pressAction: { id } } }, k);
}

/** Los datos guardados en un aviso ya enseñado (los mismos campos, sin `enviado`). */
function leerDatosAviso(d: unknown): DatosPush | null {
  if (!d || typeof d !== 'object') return null;
  const x = d as Record<string, unknown>;
  if (x.aura !== 'push' || x.tipo === 'llamada') return null;
  return leerDatos({ ...x, enviado: x.enviado ?? '0' });
}

/** Lo que AURA dice al abrir un aviso tocado (null: no dice nada). */
export function textoAlAbrir(p: DatosPush): string | null {
  switch (p.tipo) {
    case 'mensaje':
      if (p.decir) return p.decir;
      return p.texto ? (p.titulo && p.titulo !== 'AURA' ? `${p.titulo}. ${p.texto}` : p.texto) : null;
    case 'recordatorio':
      return p.texto ? tr(`Te recuerdo: ${p.texto}`, `A reminder: ${p.texto}`) : null;
    case 'propuesta':
      return p.texto || null;
    case 'computadora':
      if (!p.texto) return null;
      return p.titulo ? `${p.titulo}. ${p.texto}` : tr(`Terminé en mi computadora: ${p.texto}`, `I finished on my computer: ${p.texto}`);
    default:
      return null;
  }
}

/* ── una sola vez ────────────────────────────────────────────────────────────────────────── */

export type Vistos = Record<string, number>;

export const claveVisto = (p: Pick<DatosPush, 'tipo' | 'id'>) => `${p.tipo}:${p.id}`;

/** Los vistos que siguen valiendo (los de la ventana, los más nuevos, hasta MAX_VISTOS), con `clave` sumada. */
export function anotarVisto(v: Vistos, clave: string, ahora: number): Vistos {
  const vivos = Object.entries({ ...v, [clave]: ahora })
    .filter(([, t]) => Number.isFinite(t) && ahora - t < VENTANA_VISTOS_MS)
    .sort((a, b) => b[1] - a[1])
    .slice(0, MAX_VISTOS);
  return Object.fromEntries(vivos);
}

export function yaVisto(v: Vistos, clave: string, ahora: number): boolean {
  const t = v[clave];
  return Number.isFinite(t) && ahora - t < VENTANA_VISTOS_MS;
}
