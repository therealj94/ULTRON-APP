/**
 * LA FRASE NUEVA MANDA (José, 7-oct, mesa de AU-RA: «está loco repitiendo las cosas… contesta a lo de antes»).
 *
 * Antes, si la persona hablaba mientras AU-RA todavía pensaba la respuesta, su frase nueva esperaba en `pending` y la
 * respuesta a la frase VIEJA sonaba igual (y sus acciones salían) antes de atender la nueva: una respuesta tardía a algo
 * que ya no es lo que la persona está diciendo. Ahora:
 *  · pensando (el turno del cerebro sigue en camino y su respuesta todavía no suena) y llega una frase NUEVA de verdad:
 *    ese turno se CORTA (no suena, no se hacen sus acciones; el servidor tampoco las empuja: llegó otra frase) y la frase
 *    nueva va en el turno siguiente. La de antes ya está en el hilo: el servidor la manda como parte del pedido nuevo
 *    («antes dijo X; ahora dice Y»), no la descarta (lib/conversacion.ts notaSinRespuesta);
 *  · hablando (la respuesta ya suena): como siempre. La interrupción la decide el oído (`interrumpir`); si no corta, las
 *    frases se juntan en orden y van después (Codex, 3-oct: «se juntan, no se pisan»).
 *
 * REVISIÓN INDEPENDIENTE (7-oct, G2): cualquier cosa oída mientras pensaba cortaba el turno («¿hola?», «¿me oyes?», un
 * «ajá», un trozo de la tele) y la pregunta se perdía; y un «sí» a un envío podía quedar cortado con el envío a medias.
 *  · una frase de relleno o de sondeo (`esFraseDeRelleno`: «¿hola?», «¿me oyes?», «ajá», «mmm», «ok», «sí» sueltos) NO
 *    corta: el turno sigue y contesta; la frase se suelta (un «sí» oído antes de la pregunta nunca confirma nada);
 *  · una frase corta (menos de 3 palabras) sin verbo de pedido («¿y Beto?», «el martes») no corta: espera y va después;
 *  · con una herramienta con efectos en curso o ya ejecutada en ese turno (`efecto`: un envío, un borrador), nunca se
 *    corta: el turno termina, anota su recibo y lo dice; la frase nueva va después.
 * Pura y sin React Native (la prueba en Node: mobile/pruebas/mesa/mesa.prueba.mjs; el servidor usa `esFraseDeRelleno`).
 */

export type FraseDuranteTurno = {
  /** Cortar el turno en camino (su respuesta no suena ni hace nada). */
  cortar: boolean;
  /** Lo que queda esperando para el turno siguiente. */
  pendiente: string;
  /** La frase era de relleno o de sondeo mientras pensaba: no corta y no se manda. */
  descartada?: boolean;
};

const plano = (s: string) =>
  String(s || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9ñ\s]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/** Llamar por su nombre, «¿hola?», «¿me oyes?», «¿sigues ahí?»: ver si está, no pedir algo. */
const RE_SONDEO =
  /^(?:(?:hola|ola|hey|oye|ey|alo|halo|aura|au ra|claudio|antonio|guardian)(?: (?:hola|oye|aura|au ra|claudio|antonio|guardian))*|(?:(?:hola|oye|aura) )?(?:me|nos) (?:oyes|escuchas|oiste|escuchaste|estas oyendo|estas escuchando)|(?:(?:hola|oye|aura) )?(?:estas|sigues) (?:ahi|alli|ahi todavia|ahi aun)|hay alguien|can you hear me|are you there|hello|hi)$/;
/** Muletillas, ruido y afirmaciones sueltas («ajá», «mmm», «ok», «sí»): solo acompañan, mientras piensa no piden nada. */
const RE_MULETILLA =
  /^(?:(?:a+j+a+|a+j+a+m+|a+h+a+|m+|m+h+m+|m+j+m+|e+h+|e+m+|u+m+|u+h+|a+h+|o+h+|eh|este|pues|bueno|o sea|ok|okey|okay|oki|va|vale|dale|ya|si|sip|claro|sale|aja|mhm|uh huh|yeah|yes|yep|hmm+)\s*)+$/;
/** Lo que pide o corrige algo: con esto, aunque sea corta, la frase es nueva de verdad. */
const RE_PEDIDO =
  /\b(?:no|nel|para|parale|espera\w*|cancela\w*|olvida\w*|calla\w*|deja\w*|mejor|dile|decile|di|manda\w*|envia\w*|escrib\w*|llama\w*|marca\w*|busca\w*|abre\w*|cierra\w*|cambia\w*|pon|ponme|ponlo|ponla|quita\w*|lee\w*|responde\w*|contesta\w*|agrega\w*|borra\w*|apaga\w*|enciende\w*|prende\w*|sube\w*|baja\w*|repite\w*|regresa\w*|vuelve\w*|ve|vete|muestra\w*|ensena\w*|pasa\w*|stop|wait|cancel|send|call|open|read|show)\b/;

/** «¿Hola?», «¿me oyes?», «ajá», «mmm», «ok», «sí» (sueltos): relleno o sondeo, no una frase nueva. */
export function esFraseDeRelleno(cmd: string): boolean {
  const q = plano(cmd);
  if (!q) return true;
  return RE_SONDEO.test(q) || RE_MULETILLA.test(q);
}

/** Corta (menos de 3 palabras) y sin verbo de pedido: «¿y Beto?», «el martes». No corta el turno; espera y va después. */
function cortaSinPedido(cmd: string): boolean {
  const q = plano(cmd);
  return q.split(' ').filter(Boolean).length < 3 && !RE_PEDIDO.test(q);
}

export function fraseDuranteTurno(o: {
  /** La frase nueva (ya sin espacios de más). */
  cmd: string;
  /** Lo que ya esperaba (frases que llegaron mientras sonaba la respuesta), o null. */
  pendiente: string | null;
  /** Hay un turno del cerebro en camino (su stream sigue abierto). */
  pensando: boolean;
  /** La respuesta de ese turno ya suena. */
  hablando: boolean;
  /** En ese turno empezó (o ya corrió) una herramienta con efectos: un envío, un borrador, su computadora. */
  efecto?: boolean;
}): FraseDuranteTurno {
  const cmd = String(o.cmd || '').trim();
  const antes = String(o.pendiente || '').trim();
  const juntas = antes ? `${antes} ${cmd}`.trim() : cmd;
  if (o.pensando && !o.hablando) {
    // «¿Hola?», «¿me oyes?», «ajá» mientras piensa: el turno sigue y contesta; la frase no se manda.
    if (esFraseDeRelleno(cmd)) return { cortar: false, pendiente: antes, descartada: true };
    // Algo con efectos ya empezó, o la frase es corta y no pide nada: el turno termina y la frase va después.
    if (o.efecto || cortaSinPedido(cmd)) return { cortar: false, pendiente: juntas };
    return { cortar: true, pendiente: juntas };
  }
  return { cortar: false, pendiente: juntas };
}
