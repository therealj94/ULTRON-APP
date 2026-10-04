/**
 * LA REGLA ÚNICA DE PERMISOS EXACTOS (revisión independiente, rondas 3 a 5, 4-oct). LISTA BLANCA, CERRADA POR DEFECTO.
 *
 * Una decisión pendiente (un correo, un WhatsApp, la pregunta de su computadora, el borrador de AU-RA en la app, una
 * llamada o un recordatorio propuestos, lo escrito en el chat abierto) se ejecuta:
 *
 *   · SIN PREGUNTAR (el atajo): solo si, tras normalizar (minúsculas, sin tildes ni signos, «👍»/«✅» como «sí») y quitar
 *     un conjunto CERRADO de fichas —las afirmaciones (AFIRMA) y la cortesía (CORTESIA, y «señor» o el nombre del avatar
 *     solo como vocativo suelto)—, NO QUEDA NINGUNA ficha. Cualquier otra ficha (él, «al señor», «Bueno», «Lee», una
 *     hora, un número, un nombre, un canal, una palabra desconocida) significa que el atajo no ejecuta.
 *   · EN EL TURNO COMPLETO: lo que sobra (sin las palabras de enlace) tiene que identificar sin dudas UNA decisión:
 *     su destinatario (nombre del contacto o correo exacto, también dictado: «arroba», «punto»), su canal, o ambos, y a
 *     todos si van varios. Si alguna ficha no cuadra con ella, o cuadra con el texto o el destino de otra pendiente
 *     («el de la luz»), o es un pronombre (él, ella, le, him…), se PREGUNTA.
 *
 * Una pregunta («¿sí?», «sí o qué») nunca afirma. Con varias decisiones esperando, la afirmación pura tampoco decide.
 * Las negativas pasan por la misma selección: solo «no», «no lo mandes», «cancela», «cancélalo», «no gracias», «mejor no»
 * (y sus variantes cercanas) descartan, y solo con una pendiente o una selección clara; «no sé», «no es eso» preguntan;
 * un «no» con un destinatario detrás («no, a Bruno») puede ser una corrección: se pregunta, no se descarta nada.
 *
 * TODOS los caminos pasan por aquí: el turno del servidor (server/decision-turno.ts), el atajo de la app y el camino
 * del cerebro (lib/acciones-app.ts: ordenPorReglas, prepararAcciones), los «sí»/«no» de correo, WhatsApp y su
 * computadora (respuestaAlBorrador, respuestaSiNo: devuelven «si» solo con una afirmación pura).
 */

export type TipoDecision = 'correo' | 'whatsapp' | 'computadora' | 'mensaje' | 'chat' | 'llamar' | 'recordatorio' | 'cancelar_recordatorio';

/**
 * Una decisión que espera. `destino`: a quién va, como texto (nombres, correos, números). `destinatarios`: si va a
 * varios, cada uno (nombrar solo a una parte no la elige). `texto`: lo que pregunta (su computadora) o de qué se trata
 * (un recordatorio): sus palabras (no sus números ni montos) la identifican. `tema`: de qué habla un borrador (asunto,
 * texto): NO lo identifica, pero si lo nombrado cuadra con el tema de OTRA, se pregunta. `cuando`: la hora de un
 * recordatorio. `discreta`: lo escrito a mano en el chat abierto (solo cuenta si se pide enviar o se nombra). `propia`:
 * va para la misma persona (solo así coincide «a mí»).
 */
export type DecisionPendiente = {
  tipo: TipoDecision;
  destino?: string;
  destinatarios?: string[];
  texto?: string;
  tema?: string;
  cuando?: number;
  discreta?: boolean;
  propia?: boolean;
  id?: string;
};

/**
 * `ambiguo`: varias encajan y no dice cuál. `no-coincide`: lo nombrado no es de ninguna (o cuadra con otra). `aclarar`:
 * no queda claro si responde (una pregunta, un pronombre, el nombre del avatar que es un contacto, «no sé», un «no» con
 * un destinatario detrás que puede ser una corrección).
 */
export type MotivoPregunta = 'ambiguo' | 'no-coincide' | 'aclarar';

export type Decidido<P extends DecisionPendiente = DecisionPendiente> =
  | { tipo: 'ejecutar'; p: P; analisis: Analisis }
  | { tipo: 'no'; p: P; analisis: Analisis }
  | { tipo: 'preguntar'; motivo: MotivoPregunta; candidatos: P[]; negativa: boolean; analisis: Analisis }
  | { tipo: 'nada'; analisis: Analisis };

/* ------------------------------------------------------------------ las listas cerradas */

const set = (s: string) => new Set(s.split(/\s+/).filter(Boolean));

/**
 * Las afirmaciones: SOLO estas (una ficha). Las de la lista de la revisión, más variantes de escritura muy cercanas
 * («okey», «sip») y las que ya confirmaban sin ambigüedad («perfecto», «de acuerdo», «adelante», «sigue»).
 */
const AFIRMA = set(
  'si sip simon yes yeah yep dale ok okay okey oki va vale claro listo hazlo hagalo hagale envialo envielo enviala ' +
    'mandalo mandelo mandala mandaselo mandeselo enviaselo mandale enviale andale andele sale cabal aja obvio afirmativo ' +
    'sure adelante perfecto correcto exacto chevere confirmo sigue continua continue'
);
/** Afirmaciones de varias fichas. */
const AFIRMA_FRASES = ['de una', 'va pues', 'dale pues', 'ta bueno', 'esta bueno', 'ya estuvo', 'no hay clavo', 'no hay problema', 'por supuesto', 'send it', 'go ahead', 'do it', 'claro que si', 'de acuerdo', 'esta bien'];
/** La cortesía y el relleno de voz: SOLO estas. */
const CORTESIA = set('porfa porfavor porfis gracias pues ya ahorita nomas eh este please thanks');
const CORTESIA_FRASES = ['por favor', 'por fa', 'a ver', 'tal cual', 'asi esta bien', 'asi esta perfecto', 'ese mismo', 'thank you'];
/** «señor», «señora» y el nombre del avatar: cortesía SOLO como vocativo suelto al principio o al final. */
const VOCATIVOS = set('senor senora aura claudio antonio ojos guardian');
const AVATARES = set('aura claudio antonio ojos guardian');
/** Las negativas que descartan (una ficha y frases). */
const NIEGA = set('no nop nope nel cancela cancelalo cancelala descartalo descartala borralo borrala cancel');
const NIEGA_FRASES = ['no lo mandes', 'no la mandes', 'no lo envies', 'no la envies', 'no lo hagas', 'no gracias', 'no thanks', 'mejor no', 'dont send it', 'don t send it', 'dont', 'don t'];
/** Los verbos que descartan con claridad lo nombrado («no, cancela el de Bruno»). */
const CANCELA_CLARO = set('cancela cancelalo cancelala descartalo descartala borralo borrala cancel');
/** Lo que, junto a un sí, lo frena o lo contradice («sí espera», «dale, para»). */
const FRENA = set('espera esperate alto stop wait nunca tampoco nada not never todavia jamas ni');
/** Un «no» seguido de una de estas se contradice («no, sí mándalo»). */
const SI_FUERTE = set('si sip simon yes yeah yep hazlo hagalo adelante confirmo afirmativo');
/** Pedir enviar (también los verbos sueltos que no son un sí: «manda», «send»). */
const ENVIO = set('envialo envielo enviala mandalo mandelo mandala mandaselo mandeselo enviaselo mandale enviale manda envia mandar enviar send sendit mandarlo enviarlo');
/** «mándamelo», «send me»: piden enviar Y dicen a quién: a la persona. */
const A_MI = set('mandamelo mandamela mandamelos enviamelo enviamela enviamelos mandame enviame pasamelo reenviamelo');
/** Palabras de enlace: en el turno completo no nombran nada (en el atajo, cualquiera de ellas ya es contenido). */
const ENLACE = set('a al el la los las lo de del por para to the y and e en con via o this that it of for');
/** Detrás de estas, lo que sigue es a quién va («a Aura», «al señor», «para mí», «to me»). */
const PREP_DESTINO = set('a al para pa to for con de');
/** Pronombres: nunca identifican a nadie. («él» con tilde se marca antes de quitar tildes.) */
const PRONOMBRES = set('pronel ella ellos ellas le les him her them');
/** «a mí», «para mí», «to me», «a mi correo». */
const YO = set('mi me yo myself mio mia');
const CANAL_PROPIO = set('correo email mail numero cel celular telefono whatsapp chat');
const YO_PROPIO = 'yo_propio';
/** Lo que cambia o duda: no es un «sí» a lo que espera. */
const CAMBIO = set('pero mejor otra otro otros cambia cambiale cambialo corrige corrigelo agrega agregale quita quitale instead but change');
/** Palabras que pueden nombrar CUALQUIER mensaje (el de correo, WhatsApp, la app o el chat). */
const DE_MENSAJE = set('mensaje message borrador draft texto mensajito');
/** Varios a la vez. */
const PLURAL = set('ambos ambas todos todas both all');
/** En una pregunta, lo que pregunta por mandar («¿lo mando?»): se pide confirmar. */
const PREGUNTA_ENVIO = set('mando envio mandamos enviamos mandarlo enviarlo hago');

/** Cómo se nombra cada decisión por su canal o su acción. */
const NOMBRES: Record<TipoDecision, Set<string>> = {
  correo: set('correo correos mail email emails imeil gmail outlook'),
  whatsapp: set('whatsapp wasap guasap wsp whats wa'),
  computadora: set('computadora compu pc maquina ordenador computer pregunta'),
  mensaje: set('pulse pulse2chat chat'),
  chat: set('pulse pulse2chat chat escribi escrito'),
  llamar: set('llamada videollamada llama llamale llamala llamalo llamar marcale marcala marcalo call comunicame'),
  recordatorio: set('recordatorio recordatorios reminder alarma recuerdame recordar ponlo ponmelo ponselo guardalo agendalo programalo'),
  cancelar_recordatorio: set('recordatorio recordatorios reminder cancelalo cancelala quitalo quitala borralo borrala eliminalo cancel delete remove'),
};
/** Los verbos de la acción misma: con ellos (y nada más) el atajo cumple una propuesta («llámale», «ponlo»). */
const VERBOS: Partial<Record<TipoDecision, Set<string>>> = {
  llamar: set('llamale llamala llamalo marcale marcala marcalo comunicame'),
  recordatorio: set('ponlo ponmelo ponselo guardalo agendalo programalo'),
  cancelar_recordatorio: set('cancelalo cancelala quitalo quitala borralo borrala eliminalo'),
};
const ACCION = new Set<string>([...NOMBRES.llamar, ...(VERBOS.recordatorio || [])]);
const TIPOS_MENSAJE = new Set<TipoDecision>(['correo', 'whatsapp', 'mensaje', 'chat']);
const DE_CANAL = new Set<string>([...Object.values(NOMBRES).flatMap((s) => [...s]), ...DE_MENSAJE]);
const VERBO_CANCELAR = set('cancelalo cancelala quitalo quitala borralo borrala eliminalo eliminala cancel delete remove');

/** Palabras de los destinos o preguntas que no sirven para decir cuál. */
const COMUNES = set('com net org hn test example gmail hotmail outlook yahoo para por con que los las del una uno voy tocar toco hago enviar envio mandar boton sigo lo la el de a te tu su with the and you about');

/* ------------------------------------------------------------------ normalizar */

/** Minúsculas, sin tildes ni signos (sin colapsar nada: «Lee» sigue siendo «lee»). */
export function normalizarRespuesta(mensaje: string): string {
  return String(mensaje || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9ñ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const RE_CORREO = /[a-z0-9._%+-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)+/g;

/** Los correos de un texto (minúsculas). */
function correosDe(texto: string | undefined): string[] {
  return (String(texto || '').toLowerCase().match(RE_CORREO) || []).map((x) => x.replace(/\.+$/, ''));
}

/**
 * Las fichas del mensaje: «👍» y «✅» como «sí», «él» (con tilde) como pronombre, los correos (también dictados: «ana
 * arroba example punto test») como una sola ficha `email:…`.
 */
function fichasDelMensaje(mensaje: string): string[] {
  let s = String(mensaje || '')
    .replace(/[\u{1F44D}\u{1F44C}\u{2705}\u{2714}\u{2611}]/gu, ' si ')
    .replace(/[\u{1F44E}\u{274C}\u{274E}]/gu, ' no ')
    .toLowerCase()
    .replace(/(^|[^\p{L}])él(?=[^\p{L}]|$)/gu, '$1 pronel ')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
  // Correos dictados: «arroba» → @, y «punto» pegado a un correo → «.».
  s = s.replace(/\s*\barroba\b\s*/g, '@');
  for (let i = 0; i < 4; i++) s = s.replace(/(@[a-z0-9.-]+)\s+punto\s+([a-z0-9-]+)/g, '$1.$2').replace(/([a-z0-9._-]+)\s+punto\s+([a-z0-9._-]+@)/g, '$1.$2');
  const correos: string[] = [];
  s = s.replace(RE_CORREO, (m) => ` zzcorreo${String.fromCharCode(97 + correos.push(m.replace(/\.+$/, '')) - 1)} `);
  return s
    .replace(/[^a-z0-9ñ]+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean)
    .map((w) => {
      const m = /^zzcorreo([a-z])$/.exec(w);
      return m ? `email:${correos[m[1].charCodeAt(0) - 97]}` : w;
    });
}

/** Las vocales (y letras) repetidas cuentan SOLO para reconocer un sí o un no («siiii», «nooo»): nada más se colapsa. */
const colapsada = (w: string) => w.replace(/([a-z])\1+/g, '$1');

/* ------------------------------------------------------------------ el análisis */

type Clase = 'si' | 'cortesia' | 'vocativo' | 'niega' | 'ficha';
type Unidad = { k: Clase; w: string };

export type Analisis = {
  palabras: string[];
  unidades: Unidad[];
  /** Empieza con una negativa reconocida. */
  niega: boolean;
  /** Dice sí y no a la vez («sí espera», «claro que no», «no, sí mándalo»). */
  contradice: boolean;
  cambio: boolean;
  redactar: boolean;
  /** Es una pregunta («¿sí?», «sí o qué», «¿verdad?»): nunca afirma. */
  pregunta: boolean;
  /** Hay un sí, un verbo de envío o de la acción. */
  afirma: boolean;
  envio: boolean;
  /** Lo que sobra sin cortesía, afirmaciones, enlaces ni verbos de envío: lo que tiene que identificar la decisión. */
  contenido: string[];
  /** TODAS las fichas que sobran (también los enlaces): con alguna, el atajo no ejecuta. */
  restos: string[];
  /** Detrás de «de/del» («el de Bruno»): eligen cuál, no a quién va. */
  rolDe: string[];
  cancelaClaro: boolean;
  plural: boolean;
  /** Un pronombre (él, ella, le, him…): nunca identifica a nadie. */
  pronombre: boolean;
  /** El nombre del avatar donde iría un vocativo, pero es un contacto o un destino: no se sabe si es a quién va. */
  avatarDudoso: boolean;
  /** Un destino propio («a mí», «mándamelo»). */
  propio: boolean;
  /** Afirmación pura: un sí y SOLO cortesía (no sobra ninguna ficha). */
  pura: boolean;
  /** Negativa pura: un «no» reconocido y solo cortesía. */
  negativaPura: boolean;
};

const REDACTAR = /(^| )(escribele|escribeles|escribe|dile|diles|avisale|redacta|write|tell|text)( |$)|(^| )(mandale|enviale|manda|envia|send)( a)? (un|otro|another|a) (mensaje|correo|whatsapp|message|email|mail)( |$)/;
const PREGUNTA_AL_FINAL = /(^| )(o que|verdad|cierto|o no)$/;

/** Las palabras de unos nombres (contactos, destinos). */
function palabrasDe(nombres: Iterable<string> | undefined): Set<string> {
  const out = new Set<string>();
  for (const n of nombres || []) for (const w of normalizarRespuesta(n).split(' ')) if (w) out.add(w);
  return out;
}

/** Parte las fichas en unidades: frases y fichas de las listas cerradas; lo demás, `ficha`. */
function unidadesDe(palabras: string[]): Unidad[] {
  const frases: Array<[string[], Clase]> = [
    ...AFIRMA_FRASES.map((f) => [f.split(' '), 'si'] as [string[], Clase]),
    ...CORTESIA_FRASES.map((f) => [f.split(' '), 'cortesia'] as [string[], Clase]),
    ...NIEGA_FRASES.map((f) => [f.split(' '), 'niega'] as [string[], Clase]),
  ].sort((a, b) => b[0].length - a[0].length);
  const out: Unidad[] = [];
  for (let i = 0; i < palabras.length; ) {
    const f = frases.find(([ws]) => ws.every((w, j) => palabras[i + j] === w));
    if (f) {
      out.push({ k: f[1], w: f[0].join(' ') });
      i += f[0].length;
      continue;
    }
    const w = palabras[i];
    const c = colapsada(w);
    const k: Clase = AFIRMA.has(w) || (c !== w && AFIRMA.has(c) && /^(si|yes|ok|va|dale|sale|vale|claro|listo|aja|obvio)$/.test(c))
      ? 'si'
      : NIEGA.has(w) || (c === 'no' && w !== c)
        ? 'niega'
        : CORTESIA.has(w) || /^m{2,}$|^e+h+$|^h+m+$/.test(w)
          ? 'cortesia'
          : VOCATIVOS.has(w)
            ? 'vocativo'
            : 'ficha';
    out.push({ k, w: k === 'si' && c !== w && AFIRMA.has(c) ? c : k === 'niega' && c === 'no' ? 'no' : w });
    i += 1;
  }
  return out;
}

/** `conocidos`: nombres de contactos y destinos. El del avatar que coincide con uno no es vocativo. */
export function analizarRespuesta(mensaje: string, o: { conocidos?: Iterable<string> } = {}): Analisis {
  const palabras = fichasDelMensaje(mensaje);
  const conocidos = palabrasDe(o.conocidos);
  const u = unidadesDe(palabras);
  const blanda = (x: Unidad | undefined) => !!x && (x.k === 'si' || x.k === 'cortesia' || x.k === 'vocativo');
  let avatarDudoso = false;
  // Posiciones: «claro» detrás de «a/al/para» es un nombre; «señor» y el avatar, solo vocativos sueltos.
  u.forEach((x, i) => {
    const antes = u[i - 1]?.w;
    const trasPrep = !!antes && PREP_DESTINO.has(antes);
    // «claro» afirma solo sola o al principio (detrás de otra cosa puede ser un nombre: «ok, Claro», «a Claro»).
    if (x.k === 'si' && x.w === 'claro' && (trasPrep || !u.slice(0, i).every((y) => y.k === 'cortesia' || y.k === 'vocativo'))) x.k = 'ficha';
    if (x.k === 'vocativo') {
      const suelto = !trasPrep && (u.slice(0, i).every(blanda) || u.slice(i + 1).every(blanda));
      if (!suelto) x.k = 'ficha';
      else if (AVATARES.has(x.w) && conocidos.has(x.w)) {
        avatarDudoso = true;
        x.k = 'ficha';
      } else x.k = 'cortesia';
    }
  });
  const ws = u.map((x) => x.w);
  const q = palabras.join(' ');
  const primera = u.find((x) => x.k !== 'cortesia');
  const niega = !!primera && primera.k === 'niega';
  const hayNo = u.some((x) => x.k === 'niega');
  const sis = u.filter((x) => x.k === 'si');
  const fichas = u.filter((x) => x.k === 'ficha');
  const envio = u.some((x) => ENVIO.has(x.w) || A_MI.has(x.w) || x.w === 'send it');
  const accion = fichas.some((x) => ACCION.has(x.w));
  const afirma = sis.length > 0 || envio || accion;
  // «para» solo al final frena («dale, para»); en medio es a quién va («para Bruno»).
  const frena = fichas.some((x) => FRENA.has(x.w)) || (u.at(-1)?.k === 'ficha' && u.at(-1)?.w === 'para');
  const contradice = niega ? u.slice(u.indexOf(primera!) + 1).some((x) => (x.k === 'si' && SI_FUERTE.has(x.w)) || ENVIO.has(x.w)) : afirma && (hayNo || frena);
  const pregunta = /[¿?]/.test(String(mensaje || '')) || PREGUNTA_AL_FINAL.test(q);
  const redactar = REDACTAR.test(q);
  const cambio = fichas.some((x) => CAMBIO.has(x.w));
  const plural = fichas.some((x) => PLURAL.has(x.w)) || /(^| )(los|las) dos( |$)/.test(q);
  let propio = u.some((x) => A_MI.has(x.w));
  let pronombre = false;
  const contenido: string[] = [];
  const restos: string[] = [];
  const rolDe: string[] = [];
  u.forEach((x, i) => {
    if (x.k !== 'ficha') return;
    const antes = u[i - 1]?.w;
    const despues = u[i + 1];
    restos.push(x.w);
    if (antes === 'de' || antes === 'del') rolDe.push(x.w);
    if (A_MI.has(x.w)) return void (propio = true);
    if (YO.has(x.w) && antes && (PREP_DESTINO.has(antes) || antes === 'send' || antes === 'send it')) {
      if (x.w !== 'mi' || !despues || CANAL_PROPIO.has(despues.w) || blanda(despues)) return void (propio = true);
    }
    if (PRONOMBRES.has(x.w)) return void (pronombre = true);
    // «a él» sin tilde, «a lo», «a la» sin nada detrás: pronombres.
    if ((x.w === 'el' || x.w === 'lo' || x.w === 'la') && antes && PREP_DESTINO.has(antes) && (!despues || blanda(despues))) return void (pronombre = true);
    if (ENLACE.has(x.w) || ENVIO.has(x.w) || CAMBIO.has(x.w) || FRENA.has(x.w)) return;
    if (niega && NIEGA.has(x.w)) return;
    contenido.push(x.w);
  });
  if (propio) contenido.push(YO_PROPIO);
  const cancelaClaro = niega && (u.some((x) => CANCELA_CLARO.has(x.w) || (x.k === 'niega' && x.w.includes(' '))) || (u.length > 1 && u.at(-1)!.w === 'no'));
  const limpia = !restos.length && !propio && !pronombre && !avatarDudoso && !pregunta;
  const pura = sis.length > 0 && limpia && !niega && !contradice;
  const negativaPura = niega && limpia && !contradice && !sis.length;
  return { palabras: ws, unidades: u, niega, contradice, cambio, redactar, pregunta, afirma, envio, contenido, restos, rolDe, cancelaClaro, plural, pronombre, avatarDudoso, propio, pura, negativaPura };
}

/** ¿Es una afirmación pura? (un sí y solo cortesía: «sí», «dale», «sí señor»; no «sí, a Lee» ni «¿sí?»). */
export function esAfirmacionPura(mensaje: string): boolean {
  return analizarRespuesta(mensaje).pura;
}

/**
 * El «sí» o el «no» a UNA decisión (correo, WhatsApp, su computadora): «si» solo con una afirmación pura, «no» solo con
 * una negativa pura; lo demás es null y lo decide la selección (decidirPendiente) o se vuelve a preguntar.
 */
export function respuestaPura(mensaje: string): 'si' | 'no' | null {
  const a = analizarRespuesta(mensaje);
  if (a.pura) return 'si';
  if (a.negativaPura) return 'no';
  return null;
}

/** ¿Es una negativa pura? («no», «cancela», «no lo mandes», «mejor no», «no, gracias»; no «no sé» ni «no, el correo»). */
export function esNegativaPura(mensaje: string): boolean {
  return analizarRespuesta(mensaje).negativaPura;
}

/* ------------------------------------------------------------------ ¿lo nombrado es de esta decisión? */

/** Las palabras de un destino o un texto. `distintivas`: sin las que salen en cualquiera («com», «para»…). */
function fichasDe(texto: string | undefined, distintivas = false): string[] {
  return normalizarRespuesta(texto || '')
    .split(' ')
    .filter((x) => x && (!distintivas || (!COMUNES.has(x) && (x.length >= 3 || /^\d+$/.test(x)))));
}

/** Los correos exactos de una decisión. */
function direccionesDe(p: DecisionPendiente): string[] {
  return [...correosDe(p.destino), ...(p.destinatarios || []).flatMap((d) => correosDe(d))];
}

/** Lo que IDENTIFICA a una decisión: su destino y, si es una pregunta o un recordatorio, las palabras de su texto. */
function fichasQueIdentifican(p: DecisionPendiente): string[] {
  const delTexto = p.tipo === 'computadora' || p.tipo === 'recordatorio' || p.tipo === 'cancelar_recordatorio' ? fichasDe(p.texto, true).filter((x) => !/\d/.test(x)) : [];
  return [...fichasDe(p.destino, true), ...(p.destinatarios || []).flatMap((d) => fichasDe(d, true)), ...delTexto];
}

/** Las palabras de la hora de un recordatorio (hora de Honduras): «5», «17», los minutos, «pm». */
function fichasHora(cuando: number | undefined): string[] {
  if (!cuando || !Number.isFinite(cuando)) return [];
  const hn = new Date(cuando - 6 * 3600_000);
  const h = hn.getUTCHours();
  const m = hn.getUTCMinutes();
  return [String(h % 12 || 12), String(h), ...(m ? [String(m), String(m).padStart(2, '0')] : []), h < 12 ? 'am' : 'pm'];
}

/** ¿Esta ficha identifica a esta decisión (su canal, su acción, su destinatario o correo, su hora, el propio)? */
function esDe(w: string, p: DecisionPendiente): boolean {
  if (w === YO_PROPIO) return !!p.propia;
  if (w.startsWith('email:')) return direccionesDe(p).includes(w.slice(6));
  if (NOMBRES[p.tipo].has(w)) return true;
  if (DE_MENSAJE.has(w) && TIPOS_MENSAJE.has(p.tipo)) return true;
  if (fichasQueIdentifican(p).includes(w)) return true;
  // Un número de teléfono dicho a medias («9999-1111»): el final de su número (solo del destino, nunca de un monto).
  if (/^\d{4,}$/.test(w) && fichasDe(p.destino, true).some((f) => /^\d+$/.test(f) && f.endsWith(w))) return true;
  if (/^\d+$|^(am|pm)$/.test(w) && fichasHora(p.cuando).includes(w)) return true;
  return false;
}

/** ¿Esta ficha cuadra con el destino o el texto/tema de OTRA decisión? (los canales genéricos no cuentan aquí). */
function tocaA(w: string, q: DecisionPendiente): boolean {
  if (DE_CANAL.has(w)) return false;
  if (esDe(w, q)) return true;
  return [...fichasDe(q.tema, true), ...fichasDe(q.texto, true)].filter((x) => !/\d/.test(x)).includes(w);
}

/** ¿El mensaje nombra algo de esta decisión? */
export function nombraDecision(a: Analisis, p: DecisionPendiente): boolean {
  return a.contenido.some((w) => w !== YO_PROPIO && !DE_MENSAJE.has(w) && esDe(w, p));
}

/**
 * ¿TODO lo nombrado identifica a esta decisión? Si va a varios y nombra a alguno, los nombra a TODOS, como a quién va
 * (no «el de Bruno»).
 */
export function cubreDecision(a: Analisis, p: DecisionPendiente): boolean {
  if (a.plural || !a.contenido.length || !a.contenido.every((w) => esDe(w, p))) return false;
  if ((p.destinatarios?.length ?? 0) > 1) {
    const grupos = p.destinatarios!.map((d) => [...fichasDe(d, true), ...correosDe(d).map((x) => `email:${x}`)]);
    const nombrados = grupos.filter((g) => g.some((t) => a.contenido.includes(t)));
    if (nombrados.length && nombrados.length < grupos.length) return false;
    if (nombrados.some((g) => g.some((t) => a.rolDe.includes(t)))) return false;
  }
  return true;
}

/* ------------------------------------------------------------------ la decisión */

/**
 * La regla única. Devuelve:
 *  · `ejecutar` la decisión `p` (afirmación pura con una sola esperando, o lo que sobra la identifica sin dudas);
 *  · `no` a la decisión `p` (negativa pura con una sola, o la descarta nombrándola con claridad);
 *  · `preguntar` (varias y no dice cuál, lo nombrado no coincide, o no queda claro);
 *  · `nada`: no es una respuesta a lo que espera (otra conversación, un cambio, «sí espera»).
 * `conocidos`: nombres de contactos (los destinos de lo que espera ya cuentan).
 */
export function decidirPendiente<P extends DecisionPendiente>(mensaje: string, pendientes: readonly P[], o: { conocidos?: Iterable<string> } = {}): Decidido<P> {
  const a = analizarRespuesta(mensaje, { conocidos: [...(o.conocidos || []), ...pendientes.flatMap((p) => [p.destino || '', ...(p.destinatarios || [])])] });
  const preguntar = (motivo: MotivoPregunta, candidatos: P[]): Decidido<P> => (candidatos.length ? { tipo: 'preguntar', motivo, candidatos, negativa: a.niega, analisis: a } : { tipo: 'nada', analisis: a });
  const noDiscretas = () => pendientes.filter((p) => !p.discreta || nombraDecision(a, p));
  // Cancelar un recordatorio: «cancélalo» / «sí, cancélalo» es su «sí». Lo demás tiene que ser un sí, cortesía, enlace o
  // algo de ese recordatorio.
  if (pendientes.length === 1 && pendientes[0].tipo === 'cancelar_recordatorio' && !a.pregunta && a.unidades.some((x) => VERBO_CANCELAR.has(x.w))) {
    const p = pendientes[0];
    const resto = a.unidades.filter((x) => !VERBO_CANCELAR.has(x.w));
    const limpio = resto.every((x) => x.k === 'si' || x.k === 'cortesia' || (x.k === 'ficha' && (ENLACE.has(x.w) || esDe(x.w, p))));
    if (limpio) return { tipo: 'ejecutar', p, analisis: a };
  }
  // Y su «no»: «déjalo», «no, déjalo así», «no lo quites» (dejar el recordatorio no tiene efecto: solo suelta la propuesta).
  if (pendientes.length === 1 && pendientes[0].tipo === 'cancelar_recordatorio' && !a.pregunta && !a.unidades.some((x) => x.k === 'si')) {
    const deja = /^(no )?(dejalo|dejalo asi|no lo quites|no lo borres|keep it)$/.test(a.palabras.filter((w) => w !== 'gracias').join(' ').replace(/^no no /, 'no '));
    if (deja) return { tipo: 'no', p: pendientes[0], analisis: a };
  }
  if (!pendientes.length) return { tipo: 'nada', analisis: a };
  // «no, mándalo a Bruno»: un «no» que corrige a quién va: se pregunta, nada se aparta.
  if (a.niega && a.envio && a.contenido.length && !a.redactar) return preguntar('aclarar', noDiscretas());
  if (a.contradice || a.redactar) return { tipo: 'nada', analisis: a };
  // Una pregunta nunca es un sí: si habla de esto, se pide confirmar.
  if (a.pregunta) return a.afirma || a.niega || a.palabras.some((w) => PREGUNTA_ENVIO.has(w)) ? preguntar('aclarar', noDiscretas()) : { tipo: 'nada', analisis: a };
  if (!a.niega && (!a.afirma || a.cambio)) return { tipo: 'nada', analisis: a };
  // Un pronombre, o el avatar que es un contacto: no se sabe a quién.
  if (a.pronombre || a.avatarDudoso) return preguntar('aclarar', noDiscretas());
  // Lo escrito a mano en el chat abierto solo cuenta si pide enviar o lo nombra.
  const vivas = pendientes.filter((p) => !p.discreta || a.envio || nombraDecision(a, p));
  if (!vivas.length) return { tipo: 'nada', analisis: a };
  const responder = (p: P): Decidido<P> => (a.niega ? { tipo: 'no', p, analisis: a } : { tipo: 'ejecutar', p, analisis: a });
  if (a.pura || a.negativaPura) return vivas.length === 1 ? responder(vivas[0]) : preguntar('ambiguo', [...vivas]);
  // Un «no» con algo detrás que no sea un canal: «no sé», «no es eso», «no, a Bruno»: no se descarta nada.
  if (a.niega && (!a.contenido.length || (!a.cancelaClaro && !a.contenido.every((w) => DE_CANAL.has(w))))) return preguntar('aclarar', [...vivas]);
  // Sobraron solo enlaces o verbos sueltos («sí, el», «sí, manda»): no identifica nada.
  if (!a.contenido.length) return preguntar('aclarar', [...vivas]);
  if (a.plural) return preguntar(vivas.length > 1 ? 'ambiguo' : 'no-coincide', [...vivas]);
  // Lo que sobra identifica UNA, y ninguna ficha cuadra con el destino o el tema de otra.
  const cubiertas = vivas.filter((p) => cubreDecision(a, p) && !pendientes.some((q) => q !== p && a.contenido.some((w) => tocaA(w, q))));
  if (cubiertas.length === 1) return responder(cubiertas[0]);
  if (cubiertas.length > 1) return preguntar('ambiguo', cubiertas);
  return preguntar('no-coincide', [...vivas]);
}

/**
 * ¿El atajo puede cumplir esta decisión sin el turno completo? Solo con una afirmación pura, o con el verbo de la
 * acción misma y nada más («llámale», «ponlo»).
 */
export function soloNombraLaAccion(a: Analisis, p: DecisionPendiente): boolean {
  if (a.pura) return true;
  const verbos = VERBOS[p.tipo];
  const otras = a.unidades.filter((x) => x.k !== 'si' && x.k !== 'cortesia').map((x) => x.w);
  return !!verbos && !a.pregunta && !a.pronombre && !a.avatarDudoso && !a.propio && otras.length > 0 && otras.every((w) => verbos.has(w));
}

/** ¿Este mensaje confirma ESTA decisión, sola, sin nombrar a quién ni cuándo? («sí», «okey», «llámale», «ponlo»). */
export function confirmaDecision(tipo: TipoDecision, mensaje: string): boolean {
  const d = decidirPendiente(mensaje, [{ tipo }]);
  return d.tipo === 'ejecutar' && soloNombraLaAccion(d.analisis, d.p);
}

/** ¿El mensaje confirma enviar un mensaje (un sí o un verbo de envío, sin nombrar otra cosa ni preguntar)? */
export function confirmaEnvioDeMensaje(mensaje: string): boolean {
  const a = analizarRespuesta(mensaje);
  return a.afirma && !a.niega && !a.contradice && !a.cambio && !a.redactar && !a.pregunta && !a.plural && !a.pronombre && !a.avatarDudoso && a.contenido.every((w) => DE_MENSAJE.has(w));
}
