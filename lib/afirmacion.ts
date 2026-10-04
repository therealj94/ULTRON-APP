/**
 * LA REGLA ÚNICA DE PERMISOS EXACTOS (revisión independiente, tercera ronda, 4-oct).
 *
 * Una decisión pendiente (un correo, un WhatsApp, la pregunta de su computadora, el borrador de AU-RA en la app, una
 * llamada o un recordatorio propuestos, lo escrito en el chat abierto) se ejecuta sin preguntar SOLO si el mensaje es:
 *
 *   · una AFIRMACIÓN PURA: palabras de sí o de envío más relleno cortés, y nada más
 *     («sí», «dale», «ok», «sí señor», «sí, mándalo ahorita», «sí, envíalo AURA», «yes», «send it», «go ahead»); o
 *   · algo que nombra EXACTAMENTE esa decisión: cada cosa nombrada (destinatario, canal, hora, la acción) es de ella
 *     («sí, a Ana» con un correo para Ana; «sí, el correo»; «sí, llámale» con la llamada propuesta).
 *
 * Cualquier otro contenido —un nombre que no es, un número u hora que no es la suya («a las 5», «mañana»), otro canal
 * («por correo» con un WhatsApp), «y a Bruno», «a los dos», un texto nuevo— no ejecuta nada: si lo nombrado no
 * coincide sin dudas con UNA decisión, se pregunta. Con varias decisiones esperando, una afirmación pura tampoco
 * decide: se pregunta cuál. Las negativas pasan por la misma selección: «no» suelto con varias esperando pregunta
 * cuál; «no, el correo» descarta solo el correo.
 *
 * TODOS los caminos pasan por aquí: el turno del servidor (server/decision-turno.ts), el atajo de la app y el camino
 * del cerebro (lib/acciones-app.ts: ordenPorReglas, prepararAcciones), los «sí»/«no» de correo, WhatsApp y su
 * computadora (respuestaAlBorrador, respuestaSiNo: devuelven «si» solo con una afirmación pura).
 */

export type TipoDecision = 'correo' | 'whatsapp' | 'computadora' | 'mensaje' | 'chat' | 'llamar' | 'recordatorio' | 'cancelar_recordatorio';

/**
 * Una decisión que espera. `destino`: a quién va, como texto (nombres, correos, números: se comparan sus palabras).
 * `texto`: lo que pregunta (su computadora) o de qué se trata (un recordatorio). `cuando`: la hora de un recordatorio.
 * `discreta`: lo escrito a mano en el chat abierto: solo cuenta si el mensaje pide enviar («envíalo») o lo nombra.
 */
export type DecisionPendiente = { tipo: TipoDecision; destino?: string; texto?: string; cuando?: number; discreta?: boolean; id?: string };

export type Decidido<P extends DecisionPendiente = DecisionPendiente> =
  | { tipo: 'ejecutar'; p: P; analisis: Analisis }
  | { tipo: 'no'; p: P; analisis: Analisis }
  | { tipo: 'preguntar'; motivo: 'ambiguo' | 'no-coincide'; candidatos: P[]; negativa: boolean; analisis: Analisis }
  | { tipo: 'nada'; analisis: Analisis };

/* ------------------------------------------------------------------ las listas */

const set = (s: string) => new Set(s.split(/\s+/).filter(Boolean));

/** Palabras de sí. Las débiles («ok», «va», «dale», «claro»…) son lo que se contesta a cualquier cosa. */
const SI_FUERTE = set('si sii siii sip simon yes yeah yep hazlo hagalo hacelo goahead doit adelante confirmo deuna');
const SI_DEBIL = set('dale ok okay okey oki okis okidoki va vaya sale orale hazle claro listo perfecto correcto exacto sure estabien sigue siguele continua continue');
/** Palabras de envío: también son afirmación. */
const ENVIO = set('envialo enviala envialos envialas enviaselo enviaselos mandalo mandala mandalos mandalas mandaselo mandaselos sendit envia manda mandale enviale enviales mandales mandar enviar send');
/** Relleno cortés (y el nombre del avatar): no dice nada más. */
const RELLENO = set('senor senora senorita deacuerdo porfavor porfa porfis favor please ahorita ahora ya nomas hagale talcual asi gracias thanks bueno pues entonces aura claudio antonio ojos guardian now then');
/** Palabras de enlace: ni afirman ni nombran nada. */
const ENLACE = set('a al el la lo los las le les de del que e o por para con me te se mi tu su un una es eso esto ese esa this that it him her them the to and of for y');
/** Lo que cambia o duda: no es un «sí» a lo que espera (se arma otra cosa o se pregunta). */
const CAMBIO = set('pero mejor otra otro otros cambia cambiale cambialo corrige corrigelo agrega agregale quita quitale envez instead but change');
/** Palabras que pueden nombrar CUALQUIER mensaje (el de correo, WhatsApp, la app o el chat). */
const DE_MENSAJE = set('mensaje message borrador draft texto mensajito');
/** Lo que dice una negativa («no lo mandes», «mejor no», «cancélalo», «don't»): no nombra nada. */
const NEGATIVAS = set('no nop nope nel negativo nunca nevermind cancela cancelalo cancelala descartalo descartala descarta borra borralo borrala olvidalo olvida dejalo deja detente paralo para alto stop cancel dont mejor todavia ahorita espera esperate mandes envies hagas mandas llames pongas borres quites thanks gracias');
/** Varios a la vez: nunca una sola decisión. */
const PLURAL = set('ambos ambas todos todas both all');

/** Cómo se nombra cada decisión por su canal o su acción. */
const NOMBRES: Record<TipoDecision, Set<string>> = {
  correo: set('correo correos mail email emails imeil gmail outlook'),
  whatsapp: set('whatsapp wasap guasap wsp whats wa'),
  computadora: set('computadora compu pc maquina ordenador computer pregunta'),
  mensaje: set('pulse pulse2chat chat'),
  chat: set('pulse pulse2chat chat escribi escrito'),
  llamar: set('llamada videollamada llama llamale llamala llamalo llamar marcale marcala marcalo call comunicame'),
  recordatorio: set('recordatorio recordatorios reminder alarma recuerdame recordar ponlo ponmelo ponselo guardalo agendalo programalo set'),
  cancelar_recordatorio: set('recordatorio recordatorios reminder cancelalo cancelala quitalo quitala borralo borrala eliminalo cancel delete remove'),
};
const TIPOS_MENSAJE = new Set<TipoDecision>(['correo', 'whatsapp', 'mensaje', 'chat']);
/** Los verbos que cumplen la propuesta de quitar un recordatorio. */
const VERBO_CANCELAR = set('cancelalo cancelala quitalo quitala borralo borrala eliminalo eliminala cancel delete remove');

/** Palabras de los destinos o preguntas que no sirven para decir cuál. */
const COMUNES = set('com net org hn test example gmail hotmail outlook yahoo para por con que los las del una uno voy tocar toco hago enviar envio mandar boton sigo lo la el de a te tu su with the and you about');

/* ------------------------------------------------------------------ normalizar */

/** Minúsculas, sin tildes ni signos; las frases hechas en una palabra («por favor» → «porfavor»). */
export function normalizarRespuesta(mensaje: string): string {
  let q = ` ${String(mensaje || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9ñ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()} `;
  const juntas: Array<[RegExp, string]> = [
    [/ no mas /g, ' nomas '],
    [/ por fa /g, ' porfa '],
    [/ por favor /g, ' porfavor '],
    [/ de acuerdo /g, ' deacuerdo '],
    [/ tal cual /g, ' talcual '],
    [/ go ahead /g, ' goahead '],
    [/ send it /g, ' sendit '],
    [/ do it /g, ' doit '],
    [/ au ra /g, ' aura '],
    [/ ant onio /g, ' antonio '],
    [/ thank you /g, ' thanks '],
    [/ e mail /g, ' email '],
    [/ whats app /g, ' whatsapp '],
    [/ esta bien /g, ' estabien '],
    [/ de una /g, ' deuna '],
    [/ claro que si /g, ' si claro '],
    [/ never mind /g, ' nevermind '],
    [/ no thanks /g, ' no gracias '],
    [/ en vez /g, ' envez '],
    [/ (los|las|a los|a las) dos /g, ' ambos '],
    [/ right away /g, ' ahora '],
    [/ keep going /g, ' continue '],
    [/ don t /g, ' dont '],
    [/ hold on /g, ' espera '],
  ];
  for (let i = 0; i < 2; i++) for (const [re, r] of juntas) q = q.replace(re, r);
  return q.trim();
}

/* ------------------------------------------------------------------ el análisis */

export type Analisis = {
  palabras: string[];
  /** Una negativa reconocida («no», «cancela», «no lo mandes», «mejor no», «descártalo»). */
  niega: boolean;
  /** Dice sí y no a la vez («sí espera», «claro que no»): no decide nada. */
  contradice: boolean;
  /** Pide un cambio o duda («pero», «mejor», «cámbiale»): no es un «sí» a lo que espera. */
  cambio: boolean;
  /** Es una orden de redactar algo nuevo («escríbele a Ana que…», «mándale un mensaje a Bruno que…»). */
  redactar: boolean;
  /** Hay palabras de sí, de envío o de la acción. */
  afirma: boolean;
  /** Hay un «sí» fuerte o una palabra de envío (no solo «ok», «va», «dale»). */
  fuerte: boolean;
  /** Pide enviar («envíalo», «mándalo»). */
  envio: boolean;
  /** Lo que NO es sí, envío, relleno ni enlace: nombres, números, horas, canales, acciones. */
  contenido: string[];
  /** Habla de varios a la vez («y a Bruno», «a los dos»). */
  plural: boolean;
  /** Afirmación pura: afirma y no trae contenido, ni cambio, ni duda, ni varios. */
  pura: boolean;
};

const NIEGA_INICIO = /^(no|nop|nope|nel|negativo|nunca|nevermind|cancela|cancelalo|cancelala|descartalo|descartala|descarta|borra|borralo|borrala|olvidalo|olvida|dejalo|deja|detente|paralo|stop|cancel|dont|mejor no|todavia no|ahorita no|espera|esperate|no lo|no la)( |$)/;
const NEGACION_DENTRO = /(^| )(no|nunca|jamas|tampoco|ni|nada|espera|esperate|cancela|cancelalo|paralo|alto|detente|stop|wait|cancel|dont|not|never|todavia)( |$)|(^| )para$/;
const REDACTAR = /(^| )(escribele|escribeles|escribe|dile|diles|avisale|redacta|write|tell|text)( |$)|(^| )(mandale|enviale|manda|envia|send)( a)? (un|otro|another|a) (mensaje|correo|whatsapp|message|email|mail)( |$)/;

export function analizarRespuesta(mensaje: string): Analisis {
  const q = normalizarRespuesta(mensaje);
  const palabras = q ? q.split(' ') : [];
  const vacio = !palabras.length;
  const tieneSi = palabras.some((w) => SI_FUERTE.has(w) || SI_DEBIL.has(w));
  const envio = palabras.some((w) => ENVIO.has(w));
  const fuerte = palabras.some((w) => SI_FUERTE.has(w)) || envio;
  const accion = palabras.some((w) => NOMBRES.llamar.has(w) || (NOMBRES.recordatorio.has(w) && /lo$|la$|me/.test(w)));
  // «para» o «alto» solos son «para ya» (en medio, «para Bruno» es a quién va).
  const niega = !vacio && (NIEGA_INICIO.test(q) || /^(para|para ya|alto|alto ya)$/.test(q));
  const restoTrasNo = q.replace(/^\S+ ?/, '');
  const contradice = niega ? palabras.slice(1).some((w) => SI_FUERTE.has(w) || ENVIO.has(w)) || /(^| )(si|dale|hazlo)( |$)/.test(restoTrasNo) : tieneSi && NEGACION_DENTRO.test(q);
  const cambio = palabras.some((w) => CAMBIO.has(w));
  const redactar = REDACTAR.test(q);
  const contenido = palabras.filter(
    (w) => !SI_FUERTE.has(w) && !SI_DEBIL.has(w) && !ENVIO.has(w) && !RELLENO.has(w) && !ENLACE.has(w) && !CAMBIO.has(w) && !(niega && NEGATIVAS.has(w))
  );
  const plural = palabras.some((w) => PLURAL.has(w)) || (contenido.length > 0 && palabras.includes('y')) || (contenido.length > 0 && palabras.includes('and'));
  const afirma = !vacio && (tieneSi || envio || accion);
  const pura = afirma && !niega && !contradice && !cambio && !redactar && !plural && contenido.length === 0;
  return { palabras, niega, contradice, cambio, redactar, afirma, fuerte, envio, contenido, plural, pura };
}

/** ¿Es una afirmación pura? («sí», «dale», «sí señor», «sí, mándalo ahorita»; no «sí, a Bruno» ni «sí, a las 5»). */
export function esAfirmacionPura(mensaje: string): boolean {
  return analizarRespuesta(mensaje).pura;
}

/**
 * El «sí» o el «no» a UNA decisión (correo, WhatsApp, su computadora), con la regla única: «si» solo con una afirmación
 * pura, «no» solo con una negativa pura; lo demás (lo que nombra algo, cambia, duda o se contradice) es null y lo decide
 * la selección (decidirPendiente, en server/decision-turno.ts) o se vuelve a preguntar.
 */
export function respuestaPura(mensaje: string): 'si' | 'no' | null {
  const a = analizarRespuesta(mensaje);
  if (a.pura) return 'si';
  if (a.niega && !a.contradice && a.contenido.length === 0) return 'no';
  return null;
}

/** ¿Es una negativa pura? («no», «cancela», «no lo mandes», «mejor no»; no «no, el correo»). */
export function esNegativaPura(mensaje: string): boolean {
  const a = analizarRespuesta(mensaje);
  return a.niega && !a.contradice && a.contenido.length === 0;
}

/* ------------------------------------------------------------------ ¿lo nombrado es de esta decisión? */

/** Las palabras de un destino o una pregunta. `distintivas`: sin las que salen en cualquiera («com», «para»…). */
function fichasDe(texto: string | undefined, distintivas = false): string[] {
  return normalizarRespuesta(texto || '')
    .split(' ')
    .filter((x) => x && (!distintivas || (!COMUNES.has(x) && (x.length >= 3 || /^\d+$/.test(x)))));
}

/** Las palabras de la hora de un recordatorio (hora de Honduras): «5», «17», los minutos, «pm». */
function fichasHora(cuando: number | undefined): string[] {
  if (!cuando || !Number.isFinite(cuando)) return [];
  const hn = new Date(cuando - 6 * 3600_000);
  const h = hn.getUTCHours();
  const m = hn.getUTCMinutes();
  return [String(h % 12 || 12), String(h), ...(m ? [String(m), String(m).padStart(2, '0')] : []), h < 12 ? 'am' : 'pm'];
}

/** ¿Esta palabra del mensaje es de esta decisión (su canal, su acción, su destinatario, su hora)? */
function esDe(w: string, p: DecisionPendiente): boolean {
  if (NOMBRES[p.tipo].has(w)) return true;
  if (DE_MENSAJE.has(w) && TIPOS_MENSAJE.has(p.tipo)) return true;
  const fichas = [...fichasDe(p.destino), ...fichasDe(p.texto)];
  if (fichas.includes(w)) return true;
  // Un número de teléfono dicho a medias («9999-1111»): el final de su número.
  if (/^\d{4,}$/.test(w) && fichas.some((f) => /^\d+$/.test(f) && f.endsWith(w))) return true;
  if (/^\d+$|^(am|pm)$/.test(w) && fichasHora(p.cuando).includes(w)) return true;
  return false;
}

/** ¿El mensaje nombra algo de esta decisión? */
export function nombraDecision(a: Analisis, p: DecisionPendiente): boolean {
  const distintivas = new Set([...fichasDe(p.destino, true), ...fichasDe(p.texto, true)]);
  return a.contenido.some((w) => NOMBRES[p.tipo].has(w) || distintivas.has(w));
}

/** ¿TODO lo nombrado es de esta decisión? (y no habla de varios). */
export function cubreDecision(a: Analisis, p: DecisionPendiente): boolean {
  return !a.plural && a.contenido.length > 0 && a.contenido.every((w) => esDe(w, p));
}

/* ------------------------------------------------------------------ la decisión */

/**
 * La regla única. Devuelve:
 *  · `ejecutar` la decisión `p` (afirmación pura con una sola esperando, o nombra exactamente esa);
 *  · `no` a la decisión `p` (negativa pura con una sola, o nombra exactamente esa);
 *  · `preguntar` (varias y no dice cuál, o lo nombrado no coincide con ninguna);
 *  · `nada`: no es una respuesta a lo que espera (otra conversación, un cambio, una duda, «sí espera»).
 */
export function decidirPendiente<P extends DecisionPendiente>(mensaje: string, pendientes: readonly P[]): Decidido<P> {
  const a = analizarRespuesta(mensaje);
  // Cancelar un recordatorio: «cancélalo» / «sí, cancélalo» es su «sí», no un «no» (ni un «sí» que se contradice). Lo
  // demás del mensaje tiene que ser un sí, relleno o algo de ese recordatorio; un «no» o un «déjalo» no lo cancela.
  if (pendientes.length === 1 && pendientes[0].tipo === 'cancelar_recordatorio' && a.palabras.some((w) => VERBO_CANCELAR.has(w))) {
    const resto = analizarRespuesta(a.palabras.filter((w) => !VERBO_CANCELAR.has(w)).join(' '));
    if (!resto.niega && !resto.contradice && !resto.cambio && !resto.plural && !resto.redactar && resto.contenido.every((w) => esDe(w, pendientes[0]))) return { tipo: 'ejecutar', p: pendientes[0], analisis: a };
  }
  if (!pendientes.length || a.contradice || a.redactar) return { tipo: 'nada', analisis: a };
  if (!a.niega && (!a.afirma || a.cambio)) return { tipo: 'nada', analisis: a };
  // Lo escrito a mano en el chat abierto solo cuenta si pide enviar o lo nombra (un «sí» suelto no es para eso).
  const vivas = pendientes.filter((p) => !p.discreta || a.envio || nombraDecision(a, p));
  if (!vivas.length) return { tipo: 'nada', analisis: a };
  const responder = (p: P): Decidido<P> => (a.niega ? { tipo: 'no', p, analisis: a } : { tipo: 'ejecutar', p, analisis: a });
  if (a.contenido.length === 0 && !a.plural) {
    if (vivas.length === 1) return responder(vivas[0]);
    return { tipo: 'preguntar', motivo: 'ambiguo', candidatos: [...vivas], negativa: a.niega, analisis: a };
  }
  if (a.plural) return { tipo: 'preguntar', motivo: 'ambiguo', candidatos: [...vivas], negativa: a.niega, analisis: a };
  const cubiertas = vivas.filter((p) => cubreDecision(a, p));
  if (cubiertas.length === 1) return responder(cubiertas[0]);
  if (cubiertas.length > 1) return { tipo: 'preguntar', motivo: 'ambiguo', candidatos: cubiertas, negativa: a.niega, analisis: a };
  return { tipo: 'preguntar', motivo: 'no-coincide', candidatos: [...vivas], negativa: a.niega, analisis: a };
}

/**
 * ¿Lo nombrado es SOLO la acción o el canal de esta decisión? («sí, llámale», «ponlo», «ok, manda el mensaje»; no
 * «sí, a Ana» ni «a las 5»). El atajo de la app ejecuta solo así: lo que nombra a quién o cuándo lo decide el turno
 * completo, con todo lo que espera a la vista.
 */
export function soloNombraLaAccion(a: Analisis, p: DecisionPendiente): boolean {
  return !a.plural && a.contenido.every((w) => NOMBRES[p.tipo].has(w) || (DE_MENSAJE.has(w) && TIPOS_MENSAJE.has(p.tipo)));
}

/**
 * ¿Este mensaje confirma ESTA decisión, sola, sin nombrar a quién ni cuándo? (la propuesta de la app: «sí», «okey»,
 * «llámale», «ponlo»; no «sí, pero llama a Ana», «si puedes más tarde», «llámale» a un recordatorio).
 */
export function confirmaDecision(tipo: TipoDecision, mensaje: string): boolean {
  const d = decidirPendiente(mensaje, [{ tipo }]);
  return d.tipo === 'ejecutar' && soloNombraLaAccion(d.analisis, d.p);
}

/** ¿El mensaje confirma enviar un mensaje (un «sí» fuerte o un verbo de envío, sin nombrar otra cosa)? */
export function confirmaEnvioDeMensaje(mensaje: string): boolean {
  const a = analizarRespuesta(mensaje);
  return a.fuerte && !a.niega && !a.contradice && !a.cambio && !a.redactar && !a.plural && a.contenido.every((w) => DE_MENSAJE.has(w));
}
