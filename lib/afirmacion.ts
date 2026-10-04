/**
 * LA REGLA ÚNICA DE PERMISOS EXACTOS (revisión independiente, tercera y cuarta ronda, 4-oct).
 *
 * Una decisión pendiente (un correo, un WhatsApp, la pregunta de su computadora, el borrador de AU-RA en la app, una
 * llamada o un recordatorio propuestos, lo escrito en el chat abierto) se ejecuta sin preguntar SOLO si el mensaje es:
 *
 *   · una AFIRMACIÓN PURA: palabras de sí o de envío más relleno (cortés o de voz), y nada más
 *     («sí», «siiii», «dale», «ok», «👍», «ajá», «sí señor», «eh sí», «sí, mándalo ahorita», «Aura, sí», «go ahead»); o
 *   · algo que nombra EXACTAMENTE esa decisión: cada cosa nombrada (destinatario, canal, hora, la acción) es de ella, y
 *     si va a varios, los nombra a todos («sí, a Ana» con un correo para Ana; «sí, el correo»; «sí, llámale»).
 *
 * Cualquier otro contenido —un nombre que no es (también el del avatar detrás de «a/para»: «sí, a Aura»), un destino
 * propio («a mí», «a mi correo») con algo para otra persona, un número u hora que no es la suya (los montos de la
 * pregunta no cuentan), otro canal, solo una parte de los destinatarios, «a los dos», un texto nuevo— no ejecuta nada:
 * si lo nombrado no coincide sin dudas con UNA decisión, se pregunta. Una pregunta («¿sí?», «sí o qué») nunca es un sí.
 * Con varias decisiones esperando, una afirmación pura tampoco decide: se pregunta cuál. Las negativas pasan por la
 * misma selección: «no» suelto con varias esperando pregunta cuál; «no, el correo» descarta solo el correo; y un «no»
 * con un destinatario detrás («no, a Bruno») puede ser una corrección: se pregunta, no se descarta nada.
 *
 * TODOS los caminos pasan por aquí: el turno del servidor (server/decision-turno.ts), el atajo de la app y el camino
 * del cerebro (lib/acciones-app.ts: ordenPorReglas, prepararAcciones), los «sí»/«no» de correo, WhatsApp y su
 * computadora (respuestaAlBorrador, respuestaSiNo: devuelven «si» solo con una afirmación pura).
 */

export type TipoDecision = 'correo' | 'whatsapp' | 'computadora' | 'mensaje' | 'chat' | 'llamar' | 'recordatorio' | 'cancelar_recordatorio';

/**
 * Una decisión que espera. `destino`: a quién va, como texto (nombres, correos, números: se comparan sus palabras).
 * `destinatarios`: si va a varios, cada uno (nombrar solo a una parte no la elige). `texto`: lo que pregunta (su
 * computadora) o de qué se trata (un recordatorio); sus números y montos no cuentan. `cuando`: la hora de un
 * recordatorio. `discreta`: lo escrito a mano en el chat abierto: solo cuenta si el mensaje pide enviar o lo nombra.
 * `propia`: va para la misma persona (solo así coincide «a mí»).
 */
export type DecisionPendiente = {
  tipo: TipoDecision;
  destino?: string;
  destinatarios?: string[];
  texto?: string;
  cuando?: number;
  discreta?: boolean;
  propia?: boolean;
  id?: string;
};

/**
 * `ambiguo`: varias encajan y no dice cuál. `no-coincide`: lo nombrado no es de ninguna. `aclarar`: no queda claro si
 * responde (es una pregunta, o un «no» con un destinatario detrás que puede ser una corrección).
 */
export type MotivoPregunta = 'ambiguo' | 'no-coincide' | 'aclarar';

export type Decidido<P extends DecisionPendiente = DecisionPendiente> =
  | { tipo: 'ejecutar'; p: P; analisis: Analisis }
  | { tipo: 'no'; p: P; analisis: Analisis }
  | { tipo: 'preguntar'; motivo: MotivoPregunta; candidatos: P[]; negativa: boolean; analisis: Analisis }
  | { tipo: 'nada'; analisis: Analisis };

/* ------------------------------------------------------------------ las listas */

const set = (s: string) => new Set(s.split(/\s+/).filter(Boolean));

/** Palabras de sí. «dale», «ok», «va» valen igual en todos lados (cuarta ronda: la app y el correo, lo mismo). */
const SI = set(
  'si sip simon yes yeah yep hazlo hagalo hacelo goahead doit adelante confirmo deuna afirmativo ' +
    'dale ok okay okey oki okis okidoki va vaya sale orale andale hazle claro listo perfecto correcto exacto sure estabien sigue siguele continua continue ' +
    'aja obvio porsupuesto deacuerdo'
);
/** Un «no» seguido de una de estas se contradice («no, sí mándalo»). */
const SI_CONTRA = set('si sip simon yes yeah yep hazlo hagalo hacelo goahead doit adelante confirmo deuna afirmativo');
/** Palabras de envío: también son afirmación. Las que llevan «me» («mándamelo») además dicen a quién: a la persona. */
const A_MI = set('mandamelo mandamela mandamelos enviamelo enviamela enviamelos mandame enviame pasamelo reenviamelo');
const ENVIO = set('envialo enviala envialos envialas enviaselo enviaselos mandalo mandala mandalos mandalas mandaselo mandaselos sendit envia manda mandale enviale enviales mandales mandar enviar send');
/** Relleno cortés y de voz: no dice nada más. (El nombre del avatar NO: solo como vocativo suelto, ver AVATARES.) */
const RELLENO = set(
  'senor senora senorita porfavor porfa porfis favor please ahorita ahora ya nomas hagale talcual asi gracias thanks bueno pues entonces now then ' +
    'eh ehm em m mm hm um uhm aver este mismo misma'
);
/** Los nombres del avatar: relleno solo como vocativo suelto al principio o al final («Aura, sí», «sí, Claudio»). */
const AVATARES = set('aura claudio antonio ojos guardian');
/** Palabras de enlace: ni afirman ni nombran nada. */
const ENLACE = set('a al el la lo los las le les de del que e o y por para con me te se mi tu su un una es eso esto ese esa esta this that it him her them the to and of for');
/** Detrás de estas, un nombre es a quién va («a Aura», «para mí», «to me»). */
const PREP_DESTINO = set('a al para pa to for con le');
/** «a mí», «para mí», «to me», «a mi correo»: la persona misma. */
const YO = set('mi me yo myself mio mia');
const CANAL_PROPIO = set('correo email mail numero cel celular telefono whatsapp chat');
/** Marca del destino propio en el contenido. */
const YO_PROPIO = 'yo_propio';
/** Lo que cambia o duda: no es un «sí» a lo que espera (se arma otra cosa o se pregunta). */
const CAMBIO = set('pero mejor otra otro otros cambia cambiale cambialo corrige corrigelo agrega agregale quita quitale envez instead but change');
/** Palabras que pueden nombrar CUALQUIER mensaje (el de correo, WhatsApp, la app o el chat). */
const DE_MENSAJE = set('mensaje message borrador draft texto mensajito');
/** Lo que dice una negativa («no lo mandes», «mejor no», «cancélalo», «don't»): no nombra nada. */
const NEGATIVAS = set('no nop nope nel negativo nunca nevermind cancela cancelalo cancelala descartalo descartala descarta borra borralo borrala olvidalo olvida dejalo deja detente paralo para alto stop cancel dont mejor todavia ahorita espera esperate mandes envies hagas mandas llames pongas borres quites thanks gracias');
/** Un «no» que claramente descarta lo nombrado («no, cancela el de Bruno», «no lo mandes»), no que lo corrige. */
const CANCELA_CLARO = set('cancela cancelalo cancelala descarta descartalo descartala borra borralo borrala olvida olvidalo elimina eliminalo mandes envies cancel');
/** Varios a la vez: nunca una sola decisión. */
const PLURAL = set('ambos ambas todos todas both all');
/** En una pregunta, lo que pregunta por mandar («¿lo mando?»): no se ejecuta, se pide confirmar. */
const PREGUNTA_ENVIO = set('mando envio mandamos enviamos mandarlo enviarlo hago');

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
/** Las palabras que nombran un canal o una acción (de cualquier decisión). */
const DE_CANAL = new Set<string>([...Object.values(NOMBRES).flatMap((s) => [...s]), ...DE_MENSAJE]);
/** Los verbos que cumplen la propuesta de quitar un recordatorio. */
const VERBO_CANCELAR = set('cancelalo cancelala quitalo quitala borralo borrala eliminalo eliminala cancel delete remove');

/** Palabras de los destinos o preguntas que no sirven para decir cuál. */
const COMUNES = set('com net org hn test example gmail hotmail outlook yahoo para por con que los las del una uno voy tocar toco hago enviar envio mandar boton sigo lo la el de a te tu su with the and you about');

/* ------------------------------------------------------------------ normalizar */

/**
 * Minúsculas, sin tildes ni signos; las vocales repetidas una sola vez («siiii» → «si»); los emojis de sí («👍», «✅»)
 * como «si»; las frases hechas en una palabra («por favor» → «porfavor», «a ver» → «aver»).
 */
export function normalizarRespuesta(mensaje: string): string {
  let q = ` ${String(mensaje || '')
    .replace(/[\u{1F44D}\u{1F44C}\u{2705}\u{2714}\u{2611}]/gu, ' si ')
    .replace(/[\u{1F44E}\u{274C}\u{274E}]/gu, ' no ')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9ñ]+/g, ' ')
    .replace(/([aeiou])\1+/g, '$1')
    .replace(/([a-zñ])\1{2,}/g, '$1')
    .replace(/\s+/g, ' ')
    .trim()} `;
  const juntas: Array<[RegExp, string]> = [
    [/ no mas /g, ' nomas '],
    [/ por fa /g, ' porfa '],
    [/ por favor /g, ' porfavor '],
    [/ por supuesto /g, ' porsupuesto '],
    [/ de acuerdo /g, ' deacuerdo '],
    [/ tal cual /g, ' talcual '],
    [/ a ver /g, ' aver '],
    [/ go ahead /g, ' goahead '],
    [/ send it /g, ' sendit '],
    [/ do it /g, ' doit '],
    [/ au ra /g, ' aura '],
    [/ ant onio /g, ' antonio '],
    [/ thank you /g, ' thanks '],
    [/ e mail /g, ' email '],
    [/ whats app /g, ' whatsapp '],
    [/ esta bien /g, ' estabien '],
    [/ esta perfecto /g, ' perfecto '],
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
  /** Es una pregunta («¿sí?», «sí o qué», «¿verdad?»): nunca es un sí. */
  pregunta: boolean;
  /** Hay palabras de sí, de envío o de la acción. */
  afirma: boolean;
  /** Pide enviar («envíalo», «mándalo»). */
  envio: boolean;
  /** Lo que NO es sí, envío, relleno ni enlace: nombres, números, horas, canales, acciones, el destino propio. */
  contenido: string[];
  /** Las palabras detrás de «de/del» («el de Bruno»): eligen cuál, no a quién va. */
  rolDe: string[];
  /** Un «no» que claramente descarta lo nombrado (un verbo de cancelar, o «… no» al final). */
  cancelaClaro: boolean;
  /** Habla de varios a la vez («a los dos», «todos»). */
  plural: boolean;
  /** Afirmación pura: afirma y no trae contenido, ni cambio, ni duda, ni pregunta, ni varios. */
  pura: boolean;
};

const NIEGA_INICIO = /^(no|nop|nope|nel|negativo|nunca|nevermind|cancela|cancelalo|cancelala|descartalo|descartala|descarta|borra|borralo|borrala|olvidalo|olvida|dejalo|deja|detente|paralo|stop|cancel|dont|mejor no|todavia no|ahorita no|espera|esperate|no lo|no la)( |$)/;
const NEGACION_DENTRO = /(^| )(no|nunca|jamas|tampoco|ni|nada|espera|esperate|cancela|cancelalo|paralo|alto|detente|stop|wait|cancel|dont|not|never|todavia)( |$)|(^| )para$/;
const REDACTAR = /(^| )(escribele|escribeles|escribe|dile|diles|avisale|redacta|write|tell|text)( |$)|(^| )(mandale|enviale|manda|envia|send)( a)? (un|otro|another|a) (mensaje|correo|whatsapp|message|email|mail)( |$)/;
const PREGUNTA_AL_FINAL = /(^| )(o que|verdad|cierto|o no)$/;

/** Las palabras de un nombre conocido (un contacto, un destino): si es el del avatar, no es vocativo. */
function palabrasDe(nombres: Iterable<string> | undefined): Set<string> {
  const out = new Set<string>();
  for (const n of nombres || []) for (const w of normalizarRespuesta(n).split(' ')) if (w) out.add(w);
  return out;
}

/**
 * `conocidos`: nombres de contactos o destinos. El nombre del avatar que coincide con uno de ellos no es un vocativo:
 * es a quién va.
 */
export function analizarRespuesta(mensaje: string, o: { conocidos?: Iterable<string> } = {}): Analisis {
  const q = normalizarRespuesta(mensaje);
  const palabras = q ? q.split(' ') : [];
  const vacio = !palabras.length;
  const conocidos = palabrasDe(o.conocidos);
  const neutra = (w: string) => SI.has(w) || ENVIO.has(w) || RELLENO.has(w);
  const tieneSi = palabras.some((w) => SI.has(w));
  const envio = palabras.some((w) => ENVIO.has(w) || A_MI.has(w));
  const accion = palabras.some((w) => NOMBRES.llamar.has(w) || (NOMBRES.recordatorio.has(w) && /lo$|la$|me/.test(w)));
  // «para» o «alto» solos son «para ya» (en medio, «para Bruno» es a quién va).
  const niega = !vacio && (NIEGA_INICIO.test(q) || /^(para|para ya|alto|alto ya)$/.test(q));
  const restoTrasNo = q.replace(/^\S+ ?/, '');
  const contradice = niega ? palabras.slice(1).some((w) => SI_CONTRA.has(w) || ENVIO.has(w)) || /(^| )(si|dale|hazlo)( |$)/.test(restoTrasNo) : tieneSi && NEGACION_DENTRO.test(q);
  const cambio = palabras.some((w) => CAMBIO.has(w));
  const redactar = REDACTAR.test(q);
  const pregunta = /[¿?]/.test(String(mensaje || '')) || PREGUNTA_AL_FINAL.test(q);
  const contenido: string[] = [];
  const rolDe: string[] = [];
  let propio = false;
  palabras.forEach((w, i) => {
    const antes = palabras[i - 1];
    const despues = palabras[i + 1];
    if (antes === 'de' || antes === 'del') rolDe.push(w);
    // El destino propio: «a mí», «para mí», «to me», «a mi correo», «mándamelo», «send me».
    if (A_MI.has(w)) return void (propio = true);
    if (YO.has(w) && antes && (PREP_DESTINO.has(antes) || antes === 'send' || antes === 'sendit')) {
      if (w !== 'mi' || despues === undefined || CANAL_PROPIO.has(despues) || neutra(despues)) return void (propio = true);
    }
    // El nombre del avatar: vocativo suelto al principio o al final, nunca detrás de «a/para/to» ni si es un contacto.
    if (AVATARES.has(w)) {
      const alPrincipio = palabras.slice(0, i).every(neutra);
      const alFinal = palabras.slice(i + 1).every(neutra);
      const vocativo = !conocidos.has(w) && !(antes && PREP_DESTINO.has(antes)) && (alPrincipio || alFinal);
      if (vocativo) return;
      return void contenido.push(w);
    }
    if (SI.has(w) || ENVIO.has(w) || RELLENO.has(w) || ENLACE.has(w) || CAMBIO.has(w) || (niega && NEGATIVAS.has(w))) return;
    contenido.push(w);
  });
  if (propio) contenido.push(YO_PROPIO);
  const plural = palabras.some((w) => PLURAL.has(w));
  const cancelaClaro = niega && (palabras.some((w) => CANCELA_CLARO.has(w)) || (palabras.length > 1 && palabras[palabras.length - 1] === 'no'));
  const afirma = !vacio && (tieneSi || envio || accion);
  const pura = afirma && !niega && !contradice && !cambio && !redactar && !pregunta && !plural && contenido.length === 0;
  return { palabras, niega, contradice, cambio, redactar, pregunta, afirma, envio, contenido, rolDe, cancelaClaro, plural, pura };
}

/** ¿Es una afirmación pura? («sí», «dale», «sí señor», «sí, mándalo ahorita»; no «sí, a Bruno» ni «¿sí?»). */
export function esAfirmacionPura(mensaje: string): boolean {
  return analizarRespuesta(mensaje).pura;
}

/** Una negativa pura: «no», «cancela», «no lo mandes», «mejor no» (no «no, el correo», ni «¿no?»). */
function negativaPura(a: Analisis): boolean {
  return a.niega && !a.contradice && !a.pregunta && a.contenido.length === 0;
}

/**
 * El «sí» o el «no» a UNA decisión (correo, WhatsApp, su computadora), con la regla única: «si» solo con una afirmación
 * pura, «no» solo con una negativa pura; lo demás (lo que nombra algo, cambia, duda, pregunta o se contradice) es null
 * y lo decide la selección (decidirPendiente, en server/decision-turno.ts) o se vuelve a preguntar.
 */
export function respuestaPura(mensaje: string): 'si' | 'no' | null {
  const a = analizarRespuesta(mensaje);
  if (a.pura) return 'si';
  if (negativaPura(a)) return 'no';
  return null;
}

/** ¿Es una negativa pura? («no», «cancela», «no lo mandes», «mejor no»; no «no, el correo»). */
export function esNegativaPura(mensaje: string): boolean {
  return negativaPura(analizarRespuesta(mensaje));
}

/* ------------------------------------------------------------------ ¿lo nombrado es de esta decisión? */

/** Las palabras de un destino o una pregunta. `distintivas`: sin las que salen en cualquiera («com», «para»…). */
function fichasDe(texto: string | undefined, distintivas = false): string[] {
  return normalizarRespuesta(texto || '')
    .split(' ')
    .filter((x) => x && (!distintivas || (!COMUNES.has(x) && (x.length >= 3 || /^\d+$/.test(x)))));
}

/** Las palabras que nombran esta decisión: las de su destino y, de su texto, solo las que no son números ni montos. */
function fichasDecision(p: DecisionPendiente): string[] {
  return [...fichasDe(p.destino, true), ...fichasDe(p.texto, true).filter((x) => !/\d/.test(x))];
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
  if (w === YO_PROPIO) return !!p.propia;
  if (NOMBRES[p.tipo].has(w)) return true;
  if (DE_MENSAJE.has(w) && TIPOS_MENSAJE.has(p.tipo)) return true;
  const fichas = fichasDecision(p);
  if (fichas.includes(w)) return true;
  // Un número de teléfono dicho a medias («9999-1111»): el final de su número (solo del destino, nunca de un monto).
  if (/^\d{4,}$/.test(w) && fichasDe(p.destino, true).some((f) => /^\d+$/.test(f) && f.endsWith(w))) return true;
  if (/^\d+$|^(am|pm)$/.test(w) && fichasHora(p.cuando).includes(w)) return true;
  return false;
}

/** ¿El mensaje nombra algo de esta decisión? */
export function nombraDecision(a: Analisis, p: DecisionPendiente): boolean {
  const distintivas = new Set(fichasDecision(p));
  return a.contenido.some((w) => NOMBRES[p.tipo].has(w) || distintivas.has(w));
}

/**
 * ¿TODO lo nombrado es de esta decisión? Y, si va a varios destinatarios y nombra a alguno, los nombra a TODOS, como
 * a quién va (no «el de Bruno»).
 */
export function cubreDecision(a: Analisis, p: DecisionPendiente): boolean {
  if (a.plural || !a.contenido.length || !a.contenido.every((w) => esDe(w, p))) return false;
  if ((p.destinatarios?.length ?? 0) > 1) {
    const grupos = p.destinatarios!.map((d) => fichasDe(d, true));
    const nombrados = grupos.filter((g) => g.some((t) => a.contenido.includes(t)));
    if (nombrados.length && nombrados.length < grupos.length) return false;
    if (nombrados.some((g) => g.some((t) => a.rolDe.includes(t)))) return false;
  }
  return true;
}

/* ------------------------------------------------------------------ la decisión */

/**
 * La regla única. Devuelve:
 *  · `ejecutar` la decisión `p` (afirmación pura con una sola esperando, o nombra exactamente esa);
 *  · `no` a la decisión `p` (negativa pura con una sola, o la descarta nombrándola con claridad);
 *  · `preguntar` (varias y no dice cuál, lo nombrado no coincide, o no queda claro: una pregunta, un «no, a Bruno»);
 *  · `nada`: no es una respuesta a lo que espera (otra conversación, un cambio, una duda, «sí espera»).
 * `conocidos`: nombres de contactos (el del avatar que es un contacto no es vocativo); los destinos de lo que espera ya
 * cuentan.
 */
export function decidirPendiente<P extends DecisionPendiente>(mensaje: string, pendientes: readonly P[], o: { conocidos?: Iterable<string> } = {}): Decidido<P> {
  const a = analizarRespuesta(mensaje, { conocidos: [...(o.conocidos || []), ...pendientes.flatMap((p) => [p.destino || '', ...(p.destinatarios || [])])] });
  const preguntar = (motivo: MotivoPregunta, candidatos: P[]): Decidido<P> => (candidatos.length ? { tipo: 'preguntar', motivo, candidatos, negativa: a.niega, analisis: a } : { tipo: 'nada', analisis: a });
  // Cancelar un recordatorio: «cancélalo» / «sí, cancélalo» es su «sí», no un «no» (ni un «sí» que se contradice). Lo
  // demás del mensaje tiene que ser un sí, relleno o algo de ese recordatorio; un «no» o un «déjalo» no lo cancela.
  if (pendientes.length === 1 && pendientes[0].tipo === 'cancelar_recordatorio' && !a.pregunta && a.palabras.some((w) => VERBO_CANCELAR.has(w))) {
    const resto = analizarRespuesta(a.palabras.filter((w) => !VERBO_CANCELAR.has(w)).join(' '));
    if (!resto.niega && !resto.contradice && !resto.cambio && !resto.plural && !resto.redactar && resto.contenido.every((w) => esDe(w, pendientes[0]))) return { tipo: 'ejecutar', p: pendientes[0], analisis: a };
  }
  if (!pendientes.length) return { tipo: 'nada', analisis: a };
  // «no, mándalo a Bruno»: un «no» que corrige a quién va (no un descarte ni un sí): se pregunta, nada se aparta.
  if (a.niega && a.envio && a.contenido.length && !a.redactar) return preguntar('aclarar', pendientes.filter((p) => !p.discreta || nombraDecision(a, p)));
  if (a.contradice || a.redactar) return { tipo: 'nada', analisis: a };
  // Una pregunta («¿sí?», «sí o qué», «¿lo mando?») nunca es un sí: si habla de esto, se pide confirmar.
  if (a.pregunta) {
    const deEsto = a.afirma || a.niega || a.palabras.some((w) => PREGUNTA_ENVIO.has(w));
    return deEsto ? preguntar('aclarar', pendientes.filter((p) => !p.discreta || nombraDecision(a, p))) : { tipo: 'nada', analisis: a };
  }
  if (!a.niega && (!a.afirma || a.cambio)) return { tipo: 'nada', analisis: a };
  // Lo escrito a mano en el chat abierto solo cuenta si pide enviar o lo nombra (un «sí» suelto no es para eso).
  const vivas = pendientes.filter((p) => !p.discreta || a.envio || nombraDecision(a, p));
  if (!vivas.length) return { tipo: 'nada', analisis: a };
  const responder = (p: P): Decidido<P> => (a.niega ? { tipo: 'no', p, analisis: a } : { tipo: 'ejecutar', p, analisis: a });
  // Un «no» con algo nombrado detrás que no sea un canal («no, a Bruno», «no, mándalo a Bruno»): puede ser una
  // corrección, no un descarte. Solo descarta con un verbo claro («no, cancela el de Bruno») o «no, el WhatsApp no».
  if (a.niega && a.contenido.length && !a.cancelaClaro && !a.contenido.every((w) => DE_CANAL.has(w))) return preguntar('aclarar', [...vivas]);
  if (a.contenido.length === 0 && !a.plural) {
    if (vivas.length === 1) return responder(vivas[0]);
    return preguntar('ambiguo', [...vivas]);
  }
  if (a.plural) return preguntar(vivas.length > 1 ? 'ambiguo' : 'no-coincide', [...vivas]);
  const cubiertas = vivas.filter((p) => cubreDecision(a, p));
  if (cubiertas.length === 1) return responder(cubiertas[0]);
  if (cubiertas.length > 1) return preguntar('ambiguo', cubiertas);
  return preguntar('no-coincide', [...vivas]);
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

/** ¿El mensaje confirma enviar un mensaje (un sí o un verbo de envío, sin nombrar otra cosa ni preguntar)? */
export function confirmaEnvioDeMensaje(mensaje: string): boolean {
  const a = analizarRespuesta(mensaje);
  return a.afirma && !a.niega && !a.contradice && !a.cambio && !a.redactar && !a.pregunta && !a.plural && a.contenido.every((w) => DE_MENSAJE.has(w));
}
