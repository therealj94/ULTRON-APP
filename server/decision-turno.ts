/**
 * EL «SÍ» O EL «NO» DEL CHAT, AL EMPEZAR EL TURNO (server.ts, prepararTurno): lo que esperaba la decisión de la
 * persona —un correo o un WhatsApp que AURA dejó en borrador, la pregunta de su computadora, lo que espera la app— lo
 * resuelve el SERVIDOR aquí, no el modelo, y vuelve el HECHO para que AURA lo diga.
 *
 * Permisos exactos: la decisión la toma la REGLA ÚNICA (lib/afirmacion.ts, decidirPendiente). Una decisión se ejecuta
 * solo si el mensaje es una afirmación pura con una sola esperando, o si nombra exactamente esa (destinatario, canal,
 * hora). Lo demás pregunta. Las negativas pasan por la misma selección: «no» suelto con varias esperando pregunta cuál;
 * «no, el correo» descarta solo el correo.
 *
 * Exportado aparte para probarlo con efectos simulados (tests/permisos-exactos.test.ts, tests/permisos-ronda3.test.ts).
 */
import { apartadosCorreoDe, borradorCorreoPorIntento, borradorDe, nombresRecientesCorreo, promoverApartadoCorreo, resolverApartadoCorreo, resolverBorrador } from './correo';
import { apartadosWhatsappDe, borradorWhatsappDe, borradorWhatsappPorIntento, conocidosDeChats, destinoWhatsapp, promoverApartadoWhatsapp, resolverApartadoWhatsapp, resolverBorradorWhatsapp, whatsappPermitido } from './whatsapp';
import { preguntasComputadora, resolverPreguntaComputadora } from './computadora';
import { cerrarDecisionPorChat, clasificarEnvio, type SalidaEnvio } from './trabajos';
import { analizarRespuesta, decidirPendiente, type Decidido, type DecisionPendiente, type TipoDecision } from '../lib/afirmacion';
import { enPantallaDe, type EnPantalla } from './decision-en-pantalla';
import { llaveConversacion, resumenTexto, tomarVencidos } from './borradores-cola';
import type { RetencionAcciones } from './voz-agente';
import { otraVozDelTurno } from '../lib/voces-miembro';
import { decisionVistaDelTurno, hechoSiNoEstaLigada, vistaHablada, type VistaHablada } from './decision-hablada';

/** Lo que la app (PULSE2CHAT) tiene esperando el «sí» de un turno anterior: un mensaje, una llamada, un recordatorio. */
export type AppEsperando = { que: string; para: string; cuando?: number; huella?: string; video?: boolean };

export type OpcionesDecisionTurno = {
  /** De quién es la decisión (la sesión del turno). */
  dueno: string;
  /** La conversación (el aparato, la web, la voz): los borradores son de una persona EN una conversación. */
  ambito: string;
  mensaje: string;
  /** En la voz el efecto espera a que el turno se confirme. */
  retener?: RetencionAcciones;
  /** ¿Esta cuenta tiene su WhatsApp aquí? (whatsappPermitido). */
  whatsapp: boolean;
  /** ¿La app (PULSE2CHAT) tiene un borrador de un turno anterior esperando su «sí»? (pendienteAnterior). */
  appEspera?: boolean;
  /** Qué espera la app (su borrador o su propuesta de un turno anterior, o lo escrito en el chat abierto). */
  app?: AppEsperando | null;
  /**
   * Quinta ronda: los nombres de sus contactos (los que mandó el teléfono): el nombre del avatar que es un contacto no
   * es un vocativo («Antonio, sí»).
   */
  conocidos?: string[];
  /** Persistir antes de actuar (server/turno-unico.ts efectoDelTurno('decision')): false = no se resuelve nada. */
  registrarEfecto: () => Promise<boolean>;
  /**
   * José (5-oct): el borrador que la persona tiene a la vista en la ventana de decisión (o por el que AU-RA acaba de
   * preguntar). Sin pasarlo, el que dice server/decision-en-pantalla.ts; `null`: ninguno.
   */
  enPantalla?: EnPantalla | null;
  /**
   * La escena del turno (la cámara y las voces del teléfono). Si dice que por la voz habla OTRA persona, no la dueña
   * («Por la voz, habla Ana (tu esposa), no José»: lib/voces-miembro.ts), su «sí» o su «no» no deciden nada de la cuenta.
   */
  escena?: string;
  /**
   * Revisión 7.5 (M1′): el campo aparte `quienHabla: { id, reciente? }` del teléfono, con el origen y la sesión del turno
   * para validarlo (lib/voces-miembro.ts otraVozDelTurno: solo la app, solo una voz guardada de ESA cuenta que no es la
   * dueña). Con `reciente` (un «sí» corto del que no se supo la voz, justo después de otra persona) también frena: solo
   * frena, nunca da permiso.
   */
  quienHabla?: unknown;
  origen?: unknown;
  sesion?: { correo?: string; nombre?: string } | null;
  /**
   * Revisión del 6-oct (bloqueante 1, server/decision-hablada.ts): el turno fue HABLADO (la voz de la mesa, el dictado,
   * la conversación de voz; con `retener` también). Un «sí» hablado solo manda el borrador atado a la huella que ese
   * aparato muestra: `decisionVista` (el campo del teléfono) o el registro de la ventana de ese `aparato`.
   */
  hablado?: boolean;
  decisionVista?: unknown;
  aparato?: unknown;
};

export type SalidaDecisionTurno = {
  hechos: string[];
  turnoVigente: boolean;
  delCorreo: string | null;
  delWhatsapp: string | null;
  deLaPregunta: string | null;
  /** No se hizo ninguna: varias esperando sin decir cuál, o lo nombrado no coincide con ninguna. */
  ambiguo: boolean;
  /** Lo que espera la app NO se hace en este turno (el mensaje fue ambiguo, no coincide, o eligió otra cosa). */
  appBloqueada: boolean;
  /** La regla única eligió una decisión y la respondió (sí o no): el mensaje era la respuesta, no otra orden. */
  respondio: boolean;
  /**
   * Séptima ronda (G1-N1): lo que esperaba la app cuando se decidió (con su huella). Las acciones de la app se cumplen
   * solo si cuando salen espera exactamente eso (server.ts accionesDelCerebro, mismaEsperaApp).
   */
  appVista?: AppEsperando | null;
};

/* ------------------------------------------------------------------ lo que espera en esta conversación */

/**
 * Una decisión que espera su «sí» en esta conversación (la forma de la regla única, más de dónde viene). `aVista`: es el
 * borrador que la persona tiene a la vista en la ventana de decisión (José, 5-oct); `apartado`: estaba apartado para el
 * panel (siguió con otra cosa) y cuenta solo porque lo tiene a la vista.
 */
export type PendienteTurno = DecisionPendiente & { origen: 'correo' | 'whatsapp' | 'computadora' | 'app'; huella?: string; aVista?: boolean; apartado?: boolean; creado?: number };

/**
 * El borrador que la persona tiene a la vista en la ventana de decisión: el que se pasa, o el del registro
 * (server/decision-en-pantalla.ts). Revisión independiente (G2): solo la ventana de verdad; que AU-RA haya MENCIONADO algo
 * pendiente no lo pone «a la vista» (un «sí» suelto de después no lo manda).
 */
function vistaDe(o: { dueno: string; ambito: string; enPantalla?: EnPantalla | null }): EnPantalla | null {
  const v = o.enPantalla === undefined ? enPantallaDe(o.dueno, o.ambito) : o.enPantalla && o.enPantalla.ambito === o.ambito ? o.enPantalla : null;
  return v && v.via === 'pantalla' ? v : null;
}

/**
 * ¿La escena dice que por la voz habla OTRA persona, no la dueña? (la misma frase que lee lib/voces-miembro.ts
 * reglaQuienHabla). Quién habla y de quién es la cuenta, o null.
 */
export function otraVozDe(escena: string | undefined): { quien: string; duena: string } | null {
  const e = String(escena || '');
  const m = /\bPor la voz, habla ([^,.;()]{1,60})(?: \([^)]{0,40}\))?, no ([^,.;()]{1,60})/i.exec(e) || /\bBy voice, ([^,.;()]{1,60}) is speaking(?: \([^)]{0,40}\))?, not ([^,.;()]{1,60})/i.exec(e);
  return m ? { quien: m[1].trim(), duena: m[2].trim() } : null;
}

const esLaVista = (v: EnPantalla | null, canal: 'correo' | 'whatsapp', b: { intento: string; huella: string }) => !!v && v.canal === canal && v.intento === b.intento && v.huella === b.huella;

const TIPO_APP: Record<string, TipoDecision> = { mensaje: 'mensaje', borrador: 'chat', llamar: 'llamar', recordatorio: 'recordatorio', cancelar_recordatorio: 'cancelar_recordatorio' };

/**
 * Lo que un «sí» o un «no» del chat podría resolver en este turno, en esta conversación: el borrador de correo y el de
 * WhatsApp (los que el chat todavía resuelve: no los apartados para el panel), cada pregunta de su computadora (de esta
 * conversación) y lo que espera la app. Lo escrito a mano en el chat abierto es «discreto»: solo cuenta si el mensaje
 * pide enviar o lo nombra.
 */
export function pendientesDelTurno(o: { dueno: string; ambito: string; whatsapp: boolean; app?: AppEsperando | null; enPantalla?: EnPantalla | null }): PendienteTurno[] {
  if (!o.dueno) return [];
  const out: PendienteTurno[] = [];
  const vista = vistaDe(o);
  /**
   * Los borradores de un canal que el chat resuelve: el del lugar principal si no está apartado y, José (5-oct), el que
   * la persona tiene a la vista en la ventana de decisión aunque estuviera apartado para el panel (o lo hubiera desplazado
   * otro): la ventana se lo está preguntando AHORA. Solo ese, con su intento y su huella exactos.
   */
  const delCanal = <B extends { intento: string; huella: string; creado: number; soloPanel?: boolean }>(canal: 'correo' | 'whatsapp', principal: B | null, porIntento: (i: string) => B | null) => {
    const xs: { b: B; aVista: boolean; apartado: boolean }[] = [];
    if (principal && !principal.soloPanel) xs.push({ b: principal, aVista: esLaVista(vista, canal, principal), apartado: false });
    const v = vista?.canal === canal ? porIntento(vista.intento) : null;
    if (v && esLaVista(vista, canal, v) && !xs.some((x) => x.b.intento === v.intento)) xs.push({ b: v, aVista: true, apartado: true });
    return xs;
  };
  const marcas = (x: { b: { creado: number }; aVista: boolean; apartado: boolean }) => ({ creado: x.b.creado, ...(x.aVista ? { aVista: true } : {}), ...(x.apartado ? { apartado: true } : {}) });
  for (const x of delCanal('correo', borradorDe(o.dueno, o.ambito), (i) => borradorCorreoPorIntento(o.dueno, o.ambito, i))) {
    const c = x.b;
    // Cuarta ronda: a varios, cada uno cuenta (nombrar solo a una parte no lo elige); a la persona misma, «a mí» coincide.
    const propia = c.para.length > 0 && c.para.every((y) => y.trim().toLowerCase() === o.dueno.trim().toLowerCase());
    // Quinta ronda: su asunto y su texto son su `tema` (no la identifican, pero si lo nombrado cuadra con el tema de otra,
    // se pregunta: «el de la luz»).
    out.push({ origen: 'correo', tipo: 'correo', destino: `${(c.nombres || []).join(' ')} ${c.para.join(' ')}`.trim(), ...(c.para.length > 1 ? { destinatarios: [...c.para] } : {}), ...(propia ? { propia: true } : {}), tema: `${c.asunto} ${c.texto}`, desde: c.desde, ...(c.proveedorCuenta ? { proveedorCuenta: c.proveedorCuenta } : {}), id: c.intento, huella: c.huella, ...marcas(x) });
  }
  const wsDelCanal = o.whatsapp ? delCanal('whatsapp', borradorWhatsappDe(o.dueno, o.ambito), (i) => borradorWhatsappPorIntento(o.dueno, o.ambito, i)) : [];
  for (const x of wsDelCanal) {
    const w = x.b;
    // Sexta ronda: un grupo se marca (solo su nombre completo lo identifica) y su JID no entra al destino.
    const grupo = !!w.grupo || /@g\.us$/.test(w.chat);
    out.push({ origen: 'whatsapp', tipo: 'whatsapp', destino: grupo ? destinoWhatsapp(w) : `${destinoWhatsapp(w)} ${w.chat}`, ...(grupo ? { grupo: true } : {}), tema: w.texto, id: w.intento, huella: w.huella, ...marcas(x) });
  }
  for (const p of preguntasComputadora(o.dueno, o.ambito)) out.push({ origen: 'computadora', tipo: 'computadora', texto: p.texto, id: p.tareaId, ...(p.version !== undefined ? { huella: p.version } : {}) });
  if (o.app) {
    const tipo = TIPO_APP[o.app.que] ?? 'mensaje';
    out.push({ origen: 'app', tipo, destino: o.app.para, ...(tipo === 'recordatorio' || tipo === 'cancelar_recordatorio' ? { texto: o.app.para } : {}), ...(o.app.cuando ? { cuando: o.app.cuando } : {}), ...(tipo === 'chat' ? { discreta: true } : {}), ...(o.app.huella ? { huella: o.app.huella } : {}), ...(o.app.video !== undefined ? { video: o.app.video } : {}) });
  }
  return out;
}

function decirPendiente(p: PendienteTurno): string {
  if (p.origen === 'correo') return `el correo a ${p.destino}`;
  if (p.origen === 'whatsapp') return `el WhatsApp a ${p.destino}`;
  if (p.origen === 'computadora') return `lo que pregunta su computadora («${p.texto}»)`;
  if (p.tipo === 'llamar') return `la llamada a ${p.destino}`;
  if (p.tipo === 'chat') return `lo que está escrito en el chat de ${p.destino}`;
  if (p.tipo === 'mensaje') return `el mensaje del chat para ${p.destino}`;
  return `el recordatorio «${p.texto}»`;
}

/**
 * ¿El camino rápido de la app (server.ts ordenDeApp) NO puede resolver este turno? Si espera otra decisión en el
 * servidor (un correo, un WhatsApp, la pregunta de su computadora en esta conversación) y el mensaje responde a algo
 * (un sí, un no, un «mándalo») o la app tiene algo esperando, lo decide el turno completo con la regla única. (Además,
 * el atajo mismo solo ejecuta con una afirmación pura: lo que nombra algo siempre va al turno completo.)
 */
export function atajoDeAppBloqueado(o: { dueno: string; ambito: string; whatsapp: boolean; appEspera: boolean; mensaje?: string; contexto?: { borrador?: string | null } | null }): boolean {
  if (!pendientesDelTurno({ dueno: o.dueno, ambito: o.ambito, whatsapp: o.whatsapp }).length) return false;
  const a = analizarRespuesta(String(o.mensaje || ''));
  return o.appEspera || !!String(o.contexto?.borrador || '').trim() || a.afirma || a.niega;
}

/* ------------------------------------------------------------------ el turno */

/**
 * José (5-oct): con varias esperando, un «sí» o un «no» PURO es para la que tiene a la vista en la ventana de decisión
 * (o por la que AU-RA acaba de preguntar): esa es la pregunta más reciente. Solo si es UNA de las candidatas y el
 * mensaje no nombra otra cosa; si no, se pregunta como siempre. Nunca va a parar a una vieja en silencio.
 */
export function conLaVista<P extends PendienteTurno>(d: Decidido<P>, vista: Pick<EnPantalla, 't'> | null): Decidido<P> {
  if (!vista || d.tipo !== 'preguntar' || d.motivo !== 'ambiguo' || !(d.analisis.pura || d.analisis.negativaPura)) return d;
  const vistas = d.candidatos.filter((p) => p.aVista);
  if (vistas.length !== 1) return d;
  // Una pregunta MÁS NUEVA que lo que se veía (AU-RA armó otro borrador después): la vista ya no es la pregunta más
  // reciente; se pregunta cuál.
  if (d.candidatos.some((p) => p !== vistas[0] && (p.creado ?? 0) >= vista.t)) return d;
  // Revisión independiente (G1): lo que espera la app (un mensaje, una llamada, un recordatorio) y la pregunta de su
  // computadora son preguntas del último turno de AU-RA: siempre más nuevas que lo que se ve. Ni el «sí» ni el «no».
  if (d.candidatos.some((p) => p !== vistas[0] && (p.origen === 'app' || p.origen === 'computadora'))) return d;
  return d.analisis.niega ? { tipo: 'no', p: vistas[0], analisis: d.analisis } : { tipo: 'ejecutar', p: vistas[0], analisis: d.analisis };
}

/* ------------------------------------------------------------------ lo que quedó pendiente, en orden */

/** Un borrador que sigue esperando su decisión en esta conversación (el principal o un apartado), para decirlo en orden. */
export type PendienteEnOrden = { canal: 'correo' | 'whatsapp'; intento: string; huella: string; creado: number; para: string; texto: string; enChat: boolean };

/**
 * Lo que sigue esperando su decisión en esta conversación, del más viejo al más nuevo: los borradores de correo y de
 * WhatsApp (el del lugar principal, apartado o no, y los que otro desplazó). Lo vencido sale (y se avisa una vez).
 */
export function pendientesEnOrden(dueno: string, ambito: string, whatsapp: boolean): PendienteEnOrden[] {
  if (!dueno) return [];
  const out: PendienteEnOrden[] = [];
  const c = borradorDe(dueno, ambito);
  // `enChat`: el del lugar principal sin apartar (se le leyó y su «sí» del chat lo resuelve); lo demás, solo su tarjeta.
  for (const b of [...(c ? [c] : []), ...apartadosCorreoDe(dueno, ambito)]) out.push({ canal: 'correo', intento: b.intento, huella: b.huella, creado: b.creado, para: b.para.join(', '), texto: b.asunto || b.texto, enChat: b === c && !b.soloPanel });
  if (whatsapp) {
    const w = borradorWhatsappDe(dueno, ambito);
    for (const b of [...(w ? [w] : []), ...apartadosWhatsappDe(dueno, ambito)]) out.push({ canal: 'whatsapp', intento: b.intento, huella: b.huella, creado: b.creado, para: destinoWhatsapp(b), texto: b.texto, enChat: b === w && !b.soloPanel });
  }
  return out.sort((a, b) => a.creado - b.creado);
}

/** De qué ya se le habló («quedó pendiente…»): una vez por borrador, para no insistir. */
const MENCIONADOS = new Map<string, string[]>();
const MAX_MENCIONADOS = 30;

/**
 * ¿Toca mencionarlo? (una vez por borrador). Revisión 7.5 (MENOR 4): la mención se GASTA solo si el turno cuenta. En la
 * voz, con `retener`, se anota cuando el turno se confirma (`retener.hacer`): un turno especulativo que se descarta (la
 * frase seguía) no se oyó, y antes dejaba la mención por dicha para siempre.
 */
function mencionarUnaVez(llave: string, intento: string, retener?: RetencionAcciones): boolean {
  if ((MENCIONADOS.get(llave) || []).includes(intento)) return false;
  const anotar = () => {
    const xs = MENCIONADOS.get(llave) || [];
    if (!xs.includes(intento)) MENCIONADOS.set(llave, [...xs, intento].slice(-MAX_MENCIONADOS));
  };
  if (retener) retener.hacer(anotar);
  else anotar();
  return true;
}

export function _olvidarMencionados() {
  MENCIONADOS.clear();
}

/* ------------------------------------------------------------------ el turno */

export async function resolverDecisionesDelTurno(o: OpcionesDecisionTurno): Promise<SalidaDecisionTurno> {
  const { dueno, ambito, mensaje: message, retener } = o;
  const hechos: string[] = [];
  const nada = (extra: Partial<SalidaDecisionTurno> = {}): SalidaDecisionTurno => ({ hechos, turnoVigente: true, delCorreo: null, delWhatsapp: null, deLaPregunta: null, ambiguo: false, appBloqueada: false, respondio: false, ...extra });
  if (!dueno) return nada();
  // Lo que la persona tiene a la vista (la ventana de decisión de la mesa, o lo que AU-RA acaba de preguntar). En un turno
  // hablado, lo que dice el teléfono que muestra ESE aparato (o su registro): server/decision-hablada.ts.
  const hablado = o.hablado === true || !!retener;
  const hv: VistaHablada | null = hablado ? vistaHablada({ dueno, ambito, whatsapp: o.whatsapp, campo: decisionVistaDelTurno(o.decisionVista), aparato: o.aparato, registro: vistaDe({ dueno, ambito, enPantalla: o.enPantalla }) }) : null;
  const vista = hv ? hv.vista : vistaDe({ dueno, ambito, enPantalla: o.enPantalla });
  // Lo que espera cuando la persona contestó (lo que estaba contestando).
  const pendientes = pendientesDelTurno({ dueno, ambito, whatsapp: o.whatsapp, app: o.app, enPantalla: vista });
  // Lo que quedó atrás (José, 5-oct): un borrador que venció sin decidirse se dice una vez («¿lo rehago?»), no desaparece.
  pendientesEnOrden(dueno, ambito, o.whatsapp);
  hechos.push(...tomarVencidos(llaveConversacion(dueno, ambito)));
  // Sexta ronda (M1-B): quién más se llama así. Los contactos del teléfono (si los mandó), las personas de sus chats de
  // WhatsApp (con un tope corto; sin teléfono, como en la web, son lo único que lo sabe) y quien le escribió hace poco.
  // Séptima ronda (G1-N1): se cargan ANTES de decidir, y si mientras tanto lo que espera cambió (otro turno de la misma
  // conversación apartó un borrador y armó otro), no se decide nada: se pregunta de nuevo. G1-m1: si la lista de chats
  // no llegó a tiempo, se sabe que está incompleta.
  const deChats = pendientes.length && o.whatsapp ? await conocidosDeChats(dueno) : { nombres: [] as string[], completo: true };
  const conocidos = pendientes.length ? [...(o.conocidos || []), ...nombresRecientesCorreo(dueno, ambito), ...deChats.nombres] : o.conocidos;
  const firma = (ps: PendienteTurno[]) => JSON.stringify(ps.filter((p) => p.origen !== 'app').map((p) => [p.origen, p.id, p.huella ?? '']));
  if (pendientes.length && firma(pendientesDelTurno({ dueno, ambito, whatsapp: o.whatsapp, enPantalla: vista })) !== firma(pendientes)) {
    hechos.push(`HECHO: mientras leía su respuesta («${message.slice(0, 80)}»), lo que esperaba su decisión cambió (otro borrador o pregunta reemplazó al de antes). NO hice nada: ni se mandó ni se descartó. Dile qué espera ahora y pregúntale de nuevo.`);
    return nada({ ambiguo: true, appBloqueada: !!o.app, appVista: o.app ?? null });
  }
  // La regla única; con varias esperando, un «sí»/«no» puro es para la que tiene a la vista (conLaVista).
  const d = conLaVista(decidirPendiente(message, pendientes, { conocidos, conocidosIncompletos: !deChats.completo }), vista);
  // Revisión independiente (MENOR c): la voz reconoció a OTRA persona (no la dueña). Su «sí» no manda lo de la cuenta ni
  // su «no» lo descarta: nada cambia y se pide la confirmación de la dueña (su voz, o tocar Sí en su ventana). Por la
  // escena o por el campo aparte `quienHabla` (validado); revisión 7.5 (M1′): también la precaución `reciente`.
  const otraVoz = d.tipo === 'ejecutar' || d.tipo === 'no' ? (otraVozDe(o.escena) ?? (await otraVozDelTurno({ quienHabla: o.quienHabla, origen: o.origen, sesion: o.sesion }))) : null;
  if (otraVoz && (d.tipo === 'ejecutar' || d.tipo === 'no')) {
    const porQue =
      'reciente' in otraVoz && otraVoz.reciente
        ? `la frase fue muy corta para saber por la voz quién la dijo, y hace un momento hablaba ${otraVoz.quien}, no ${otraVoz.duena} (la persona dueña de la cuenta). Por precaución NO hice nada`
        : `la voz dice que quien habla es ${otraVoz.quien}, no ${otraVoz.duena} (la persona dueña de la cuenta). NO hice nada`;
    hechos.push(
      `HECHO: dijo «${message.slice(0, 80)}», pero ${porQue}: ni se mandó, ni se descartó, ni se contestó lo que esperaba (${decirPendiente(d.p)}). Dile con amabilidad que eso lo confirma ${otraVoz.duena}: con su voz (una frase un poco más larga, como «sí, mándalo») o tocando «Sí» en su ventana de decisión.`
    );
    return nada({ ambiguo: true, appBloqueada: !!o.app, appVista: o.app ?? null });
  }
  // Revisión del 6-oct (bloqueante 1): un «sí» HABLADO manda un correo o un WhatsApp solo si está atado a la huella exacta
  // que ese aparato muestra. Si no (sin ventana, la de antes de editar, la de otro aparato), no se elige ni se manda nada.
  if (hv && d.tipo === 'ejecutar' && (d.p.origen === 'correo' || d.p.origen === 'whatsapp')) {
    const no = hechoSiNoEstaLigada(d.p, hv, message, decirPendiente(d.p));
    if (no) {
      hechos.push(no);
      return nada({ ambiguo: true, appBloqueada: !!o.app, appVista: o.app ?? null });
    }
  }
  const efecto = d.tipo === 'ejecutar' && d.p.origen !== 'app';
  // Un «sí» que va a mandar un borrador o soltar a su computadora: antes se deja anotado en el turno durable (AUR06,
  // persistir antes de actuar). Si este proceso ya no es el dueño del turno, no se resuelve nada aquí.
  const turnoVigente = efecto ? await o.registrarEfecto() : true;
  if (!turnoVigente) {
    hechos.push('HECHO: este turno no quedó registrado para mandar nada (o ya lo atiende otro proceso del servidor). NO se mandó ningún borrador ni se soltó la computadora. No digas que se envió: dile que lo intente otra vez en un momento.');
    return nada({ turnoVigente: false, appBloqueada: !!o.app, appVista: o.app ?? null });
  }
  if (d.tipo === 'preguntar') {
    const una = d.candidatos.length === 1;
    const lista = una ? decirPendiente(d.candidatos[0]) : d.candidatos.map((p, i) => `${i + 1}) ${decirPendiente(p)}`).join('; ');
    const espera = una ? `lo que espera su decisión es ${lista}` : `lo que espera su decisión son ${d.candidatos.length} cosas: ${lista}`;
    const dijo = d.analisis.niega ? '«no»' : '«sí»';
    hechos.push(
      d.motivo === 'ambiguo'
        ? `HECHO: dijo ${dijo} («${message.slice(0, 80)}»), pero ${espera}. Su respuesta no dice a cuál: NO hice ninguna (no se mandó, no se descartó ni se le contestó nada). Pregúntale cuál —que diga, por ejemplo, «sí, el correo» o a quién va—.`
        : d.motivo === 'aclarar'
          ? `HECHO: dijo «${message.slice(0, 80)}», y ${espera}. No queda claro si es su respuesta (es una pregunta, o un «no» que nombra a alguien y puede ser una corrección): NO hice nada (no se mandó ni se descartó). Pregúntale qué quiere —que confirme con un «sí» o diga qué cambiar—.`
          : `HECHO: dijo «${message.slice(0, 80)}», pero ${espera}, y lo que nombró no coincide (otra persona, el propio, otro canal, otra hora, solo una parte de los destinatarios o varios a la vez). NO hice nada. Pregúntale si es eso lo que quiere —que lo diga— o qué otra cosa quería.`
    );
    return nada({ ambiguo: true, appBloqueada: !!o.app, appVista: o.app ?? null });
  }
  // Lo que decidió la regla, o nada: con `nada` (no respondió a lo que espera, o cambió de tema) cada borrador recibe el
  // mensaje tal cual y queda apartado para el panel, como siempre.
  const elegido = d.tipo === 'ejecutar' || d.tipo === 'no' ? d.p : null;
  const respuesta = d.tipo === 'ejecutar' ? 'sí' : d.tipo === 'no' ? 'no' : message;
  const toca = (origen: PendienteTurno['origen']) => !elegido || elegido.origen === origen;
  const decision = d.tipo === 'ejecutar' ? ('si' as const) : d.tipo === 'no' ? ('no' as const) : null;
  // Séptima ronda (G1-N1): cada resolvedor recibe el intento y la huella de lo que vio la decisión; si cuando por fin
  // resuelve espera otro borrador (o este cambió), no toca nada y lo dice. Sin uno visto, ese canal no se toca. Un apartado
  // que solo cuenta por estar a la vista se toca únicamente si la regla lo eligió (otra cosa no lo aparta otra vez).
  const vistoDe = (origen: 'correo' | 'whatsapp') => (elegido?.origen === origen ? elegido : pendientes.find((p) => p.origen === origen && !p.apartado));
  const vistoCorreo = vistoDe('correo');
  const vistoWhatsapp = vistoDe('whatsapp');
  // Un apartado elegido (lo tenía a la vista) pasa al lugar principal: su «sí» sigue el camino de siempre (vigencia,
  // huella, la voz que espera a confirmar el turno) y lo que estaba ahí pasa a los apartados, sin perderse.
  const deshacerPromocion = elegido?.apartado && elegido.id ? (elegido.origen === 'correo' ? promoverApartadoCorreo(dueno, ambito, elegido.id) : elegido.origen === 'whatsapp' ? promoverApartadoWhatsapp(dueno, ambito, elegido.id) : null) : null;
  /**
   * Su tarea del panel se cierra con lo que de verdad pasó (AUR08, sin doble efecto). En el chat, al resolver. En la voz
   * (José, 5-oct), el «no» al resolver y el «sí» cuando el envío por fin sale (después de contestar, al confirmarse el
   * turno): antes, en la voz, la tarea se quedaba esperando su decisión aunque el mensaje ya hubiera salido.
   */
  const alTerminarDe = (p: PendienteTurno | undefined) => (retener && decision === 'si' && p?.id && elegido === p ? { alTerminar: (h: { texto: string }) => void cerrarDecisionPorChat(dueno, p.id!, 'si', h.texto).catch(() => undefined) } : {});
  const atado = (p: PendienteTurno | undefined) => ({ intento: p?.id ?? '', ...(p?.huella ? { huellaVista: p.huella } : {}), decidido: !!elegido && elegido === p, ...(p?.aVista && elegido === p ? { enPantalla: true } : {}), ...alTerminarDe(p) });
  const cerrarSiToca = (p: PendienteTurno | undefined, hecho: string | null, sigue: boolean) => {
    if (!hecho || !p?.id || sigue) return;
    if (retener && decision !== 'no') return;
    void cerrarDecisionPorChat(dueno, p.id, decision, hecho).catch(() => undefined);
  };
  const delCorreo = toca('correo') && vistoCorreo ? await resolverBorrador(dueno, ambito, respuesta, retener, atado(vistoCorreo)) : null;
  if (delCorreo) hechos.push(delCorreo);
  // Si el mismo borrador sigue esperando (hay que confirmar a quién va, o repetir un envío incierto), su decisión del
  // panel queda abierta: no se cierra como si se hubiera decidido.
  cerrarSiToca(vistoCorreo, delCorreo, !!vistoCorreo?.id && borradorDe(dueno, ambito)?.intento === vistoCorreo.id);
  const delWhatsapp = o.whatsapp && toca('whatsapp') && vistoWhatsapp ? await resolverBorradorWhatsapp(dueno, ambito, respuesta, retener, atado(vistoWhatsapp)) : null;
  if (delWhatsapp) hechos.push(delWhatsapp);
  cerrarSiToca(vistoWhatsapp, delWhatsapp, !!vistoWhatsapp?.id && borradorWhatsappDe(dueno, ambito)?.intento === vistoWhatsapp.id);
  // Revisión independiente (M2): en la voz, si el turno se descarta (la frase seguía), el cambio de lugar se deshace. Se
  // anota DESPUÉS del resolvedor: corre después de su «reponer» y deja cada borrador donde estaba.
  if (retener && deshacerPromocion) retener.alDescartar(deshacerPromocion);
  // Su computadora se detuvo a pedir su sí (o le ofreció seguir): solo la que eligió la regla (o, sin elección, como
  // siempre: un mensaje que no es respuesta no la toca).
  const elegida = elegido?.origen === 'computadora' ? elegido.id : undefined;
  const version = elegido?.origen === 'computadora' ? elegido.huella : undefined;
  const deLaPregunta = toca('computadora') && !delCorreo && !delWhatsapp ? await resolverPreguntaComputadora(dueno, respuesta, retener, { ambito, ...(elegida ? { elegida } : {}), ...(version !== undefined ? { version } : {}) }) : null;
  if (deLaPregunta) hechos.push(deLaPregunta);
  // Un «sí» que no tiene a qué contestar (el borrador venció, el servidor se reinició o nunca se armó): que
  // el modelo no lo tome por un envío y diga «enviado» por el historial (José, 3-oct).
  if (!pendientes.length && d.analisis.pura && !o.appEspera && !o.app) {
    const apartado = borradorDe(dueno, ambito)?.soloPanel || borradorWhatsappDe(dueno, ambito)?.soloPanel || apartadosCorreoDe(dueno, ambito).length > 0 || (o.whatsapp && apartadosWhatsappDe(dueno, ambito).length > 0);
    hechos.push(
      apartado
        ? 'HECHO: si su «sí» era para el borrador de antes: ese ya no se resuelve por el chat (siguió con otra cosa en medio). NO se mandó nada. Está en su panel de tareas y en la ventana de decisión de su pantalla, por si lo quiere aprobar ahí (o decir «sí» mientras lo ve); o arma uno nuevo y vuelve a preguntar. No digas que se envió.'
        : 'HECHO: si su «sí» era para mandar un mensaje o un correo: ahora no hay ningún borrador esperando (venció o no se armó). NO se mandó nada. No digas que se envió: pregúntale qué quiere mandar y a quién.'
    );
  }
  // En orden, sin dejar nada atrás (José, 5-oct): terminada una, lo que sigue esperando (lo más viejo primero) se menciona
  // UNA vez, y queda como «la pregunta más reciente»: su «sí» siguiente es para eso, no para algo de antes.
  if (elegido && elegido.origen !== 'app') {
    const quedan = pendientesEnOrden(dueno, ambito, o.whatsapp).filter((x) => x.intento !== elegido.id);
    const sig = quedan[0];
    if (sig && mencionarUnaVez(llaveConversacion(dueno, ambito), sig.intento, retener)) {
      const que = sig.canal === 'correo' ? `el correo para ${sig.para} («${resumenTexto(sig.texto, 60)}»)` : `el WhatsApp para ${sig.para} («${resumenTexto(sig.texto, 60)}»)`;
      const mas = quedan.length > 1 ? ` Después de ese quedan ${quedan.length - 1} más en su panel; no los enumeres.` : '';
      // Revisión independiente (G2): mencionarlo es SOLO información. Lo que espera en el chat (el borrador que se le leyó y
      // no apartó) se resuelve con su «sí» como siempre; un apartado, solo con la ventana de decisión a la vista (ahí ve a
      // quién va y el texto exacto) o tocando Sí: un «sí» suelto después de la mención no lo manda.
      hechos.push(
        sig.enChat
          ? `PENDIENTE EN ORDEN: después de decir lo de ahora, menciónale en UNA frase que sigue esperando su decisión ${que}, y pregúntale si lo envía. Si dice que sí, sale ESE (el servidor lo manda, no tú). No lo repitas si ya lo dijo.${mas}`
          : `PENDIENTE EN ORDEN: después de decir lo de ahora, menciónale en UNA frase que quedó pendiente ${que} y que está en su ventana de decisión (y en su panel de tareas) para que lo apruebe ahí (Sí · No · Editar) o diga «sí» mientras la ve. NO le preguntes «¿lo envío?» como si un «sí» suelto lo mandara: así no sale. No lo repitas si ya lo dijo.${mas}`
      );
    }
  }
  return nada({ delCorreo, delWhatsapp, deLaPregunta, appBloqueada: !!o.app && !!elegido && elegido.origen !== 'app', respondio: !!elegido, appVista: o.app ?? null });
}

/**
 * «Aprobar» o «Rechazar» desde el panel: el MISMO camino que el «sí»/«no» del chat (server/correo.ts y
 * server/whatsapp.ts, que vuelven a mirar vigencia y dueño justo antes de mandar), pero solo si el borrador
 * que espera es exactamente el aprobado: su id de intento y la huella que mostró la tarjeta (destinatario o chat,
 * cuenta y contenido; revisión 4-oct). Si cambió, no se toca nada (`stale`). José (5-oct): también un apartado que
 * otro borrador desplazó (sigue esperando en orden), con las mismas comprobaciones.
 */
export async function resolverBorradorDesdePanel(correo: string, canal: 'correo' | 'whatsapp', ambito: string, intento: string, respuesta: 'sí' | 'no', huella?: string): Promise<SalidaEnvio> {
  const principal = canal === 'correo' ? borradorDe(correo, ambito) : borradorWhatsappDe(correo, ambito);
  const b = principal && principal.intento === intento ? principal : canal === 'correo' ? borradorCorreoPorIntento(correo, ambito, intento) : borradorWhatsappPorIntento(correo, ambito, intento);
  if (!b || b.intento !== intento) return { estado: 'stale', resumen: 'El borrador ya no era el aprobado; no se envió nada.' };
  if (respuesta === 'sí' && (!huella || !b.huella || b.huella !== huella)) return { estado: 'stale', resumen: 'Lo que espera ya no es lo que aprobaste (otro destinatario, cuenta o contenido); no se envió nada.' };
  if (canal === 'whatsapp' && !(await whatsappPermitido(correo))) return { estado: 'failed', resumen: 'WHATSAPP: no lo mandé: esta cuenta ya no tiene su WhatsApp.' };
  const como = { desdePanel: true, ...(huella ? { huella } : {}) };
  let hecho: string | null;
  if (b === principal) hecho = canal === 'correo' ? await resolverBorrador(correo, ambito, respuesta, undefined, como) : await resolverBorradorWhatsapp(correo, ambito, respuesta, undefined, como);
  else hecho = ((canal === 'correo' ? await resolverApartadoCorreo(correo, ambito, intento, respuesta, huella) : await resolverApartadoWhatsapp(correo, ambito, intento, respuesta, huella))?.texto ?? null);
  if (hecho === null) return { estado: 'stale', resumen: 'El borrador ya no estaba esperando; no se envió nada.' };
  return { estado: respuesta === 'no' ? 'failed' : clasificarEnvio(hecho), resumen: hecho };
}
