/**
 * LO QUE EL CEREBRO SABE DE LAS CARAS EN UN TURNO DE LA MESA (José, 6-oct, con su hija en la mesa: «la cámara aún tiene
 * fallas»). Lo usa server.ts al armar HECHOS; se prueba en tests/caras-turno.test.ts.
 *
 * Lo que pasó: «Me acompaña mi hija» → «¿es Nora? ¿O es Ivón?» (dos nombres sacados de la memoria familiar, con la cara
 * sin reconocer); «Reconoce a [ella]» → «no puedo identificar personas por su cara» (falso: el motor de caras del
 * teléfono, mobile/src/caras, reconoce a las caras guardadas y ya había reconocido a José); «Mira, mira» → «¿Qué ves?».
 * El turno no le decía al cerebro qué puede de verdad, y la vista llegaba con «No identifiques a nadie por su cara».
 *
 * Ahora, cuando el turno PREGUNTA por lo que se ve o por alguien (o la persona presenta a alguien) y la ESCENA del
 * teléfono trae caras («Reconozco a…», «… que no conozco», «… sin identificar todavía»), va un hecho CARAS corto con la
 * verdad: reconoces a las guardadas, nombras solo lo que ESCENA confirma (o lo que te acaban de decir), nunca un nombre de
 * MEMORIA para una cara sin reconocer; a quien no conoces lo dices y, UNA vez por persona desconocida en la sesión del
 * teléfono, ofreces aprenderlo («¿Cómo se llama? Si quieres, aprendo su cara y la recuerdo»; la app pide después el «sí»
 * de esa persona). Revisión del 6-oct: antes iba en CADA turno con una cara en la escena (450–600 car.: el turno hablado
 * pesado se pasaba del tope de fichas, tests/voz-presupuesto.test.ts) y con alguien sin guardar a la vista la oferta
 * salía en cada respuesta. Para un invitado (modo invitado) no se ofrece aprender caras. Si preguntan por alguien y la
 * escena no trae caras, la verdad de por qué (reconocer caras apagado o nadie a la vista) sin inventar.
 */

/**
 * «¿Qué ves?», «¿me ves?», «mírame», «¿quién está conmigo?», «reconoce a…»: preguntan por lo que ve la cámara. «Mira» suelto
 * NO (es muletilla: «mira, recuérdame lo del banco»): solo con «esto/aquí/acá» detrás, o la frase entera «mira» / «mira,
 * mira» (abajo, MIRA_SOLO).
 */
export const RE_PREGUNTA_POR_VER =
  /\b(qu[eé] ves|qu[eé] hay aqu[ií]|qui[eé]n (est[aá]|hay|anda)( aqu[ií]| ah[ií]| conmigo)?|me ves|c[oó]mo me ves|estoy solo|cu[aá]ntos somos|qu[eé] cara tengo|me veo|m[ií]rame|m[ií]ra (esto|aqu[ií]|ac[aá])|reconoce[rs]?|reconoces|qui[eé]n es (ella|[eé]l|esta persona)|me acompa[nñ]a|est[aá] conmigo)(?![\wáéíóúñ])/;
/** La frase entera es «mira», «¡mira, mira!»: pide mirar. */
const MIRA_SOLO = /^[\s¡!¿?.,]*(m[ií]ra[\s¡!¿?.,]*)+$/;

export function preguntaPorVer(texto: string): boolean {
  const t = String(texto || '').toLowerCase();
  return RE_PREGUNTA_POR_VER.test(t) || MIRA_SOLO.test(t);
}

/** «Reconoce a Bea», «¿quién es ella?», «me acompaña mi hija»: el turno pregunta por QUIÉN es alguien. */
const RE_PREGUNTA_POR_QUIEN = /\b(reconoce[rs]?|reconoces|qui[eé]n es (ella|[eé]l|esta persona)|qui[eé]n (est[aá]|anda) conmigo|me acompa[nñ]a|est[aá] conmigo|sabes qui[eé]n)\b/;
/** «Te presento a Bea», «quiero que conozcas a mi hija», «aprende su cara»: presenta a alguien. */
const RE_PRESENTA = /\b(te presento a|quiero que conozcas a|conoce a mi|(aprende|recuerda|guarda)(te)? (su|la|esta) cara)\b/;

/** Lo que la escena dice de las caras: ¿reconoce a alguien?, ¿cuántas sin nombre? */
export function carasDeEscena(escena: string): { reconocidas: boolean; sinNombre: boolean; desconocidas: number } {
  const e = String(escena || '');
  const sinNombre = /\b(que no conozco|sin identificar|I don'?t know|not identified)\b/i.test(e);
  let desconocidas = 0;
  for (const m of e.matchAll(/(\d+) (?:persona\(s\)|person\(s\)) (?:que no conozco|sin identificar|I don'?t know|not identified)/gi)) desconocidas += Number(m[1]) || 0;
  return { reconocidas: /\b(reconozco a|I recognize)\b/i.test(e), sinNombre, desconocidas: sinNombre ? Math.max(1, desconocidas) : 0 };
}

/* ── la oferta de aprender: una vez por persona desconocida en la sesión del teléfono ─────────── */

/** Sin turnos con alguien desconocido a la vista durante esto, la sesión de la mesa se da por terminada. */
export const SESION_OFERTA_MS = 30 * 60_000;
const MAX_AMBITOS = 500;
/** Por ámbito (cuenta + aparato): a cuántas personas desconocidas ya se les ofreció aprender, y cuándo se vio la última. */
const ofertas = new Map<string, { ofrecidas: number; t: number }>();

/** ¿Toca ofrecer aprender (hay más desconocidas que ofertas hechas en esta sesión)? Si toca, lo anota. */
function tocaOfrecer(ambito: string | undefined, desconocidas: number, ahora: number): boolean {
  if (desconocidas <= 0) return false;
  // Sin ámbito (un turno sin cuenta de la app) no hay sesión que recordar: se ofrece, y solo llega aquí si preguntó.
  if (!ambito) return true;
  const o = ofertas.get(ambito);
  const vigente = o && ahora - o.t <= SESION_OFERTA_MS ? o : null;
  const ofrecidas = vigente ? vigente.ofrecidas : 0;
  ofertas.delete(ambito);
  ofertas.set(ambito, { ofrecidas: Math.max(ofrecidas, desconocidas), t: ahora });
  while (ofertas.size > MAX_AMBITOS) ofertas.delete(ofertas.keys().next().value as string);
  return desconocidas > ofrecidas;
}

/** Para las pruebas: olvida las ofertas hechas. */
export function olvidarOfertasCaras() {
  ofertas.clear();
}

/**
 * El hecho CARAS del turno (null si no viene al caso). `escena`: la del teléfono, ya cortada como la usa server.ts;
 * `mensaje`: lo que dijo; `invitado`: el turno va en modo invitado (sin nombres guardados ni aprender caras); `ambito`:
 * la cuenta y el aparato (server/app-contexto ambitoApp), para no repetir la oferta de aprender en la sesión.
 */
export function hechoCaras(o: { escena: string; mensaje: string; invitado?: boolean; ambito?: string; ahora?: number }): string | null {
  const c = carasDeEscena(o.escena);
  const m = String(o.mensaje || '').toLowerCase();
  const preguntaQuien = RE_PREGUNTA_POR_QUIEN.test(m);
  // Solo si el turno va de lo que se ve o de alguien: en el resto, la ESCENA basta (y el turno hablado tiene tope).
  const viene = preguntaQuien || preguntaPorVer(m) || RE_PRESENTA.test(m);
  if (!viene) return null;
  if (o.invitado) return 'CARAS: no digas el nombre de nadie por su cara ni ofrezcas aprender caras; quién es alguien lo ve la dueña de la cuenta.';
  if (c.reconocidas || c.sinNombre) {
    const base = 'CARAS: tu teléfono SÍ reconoce las caras que la dueña te presentó; nombra solo a quien ESCENA reconoce o te acaban de decir, nunca un nombre de MEMORIA (ni como pregunta). Nunca digas que no puedes reconocer caras.';
    if (!c.sinNombre) return base;
    if (tocaOfrecer(o.ambito, c.desconocidas, o.ahora ?? Date.now()))
      return `${base} A quien no conoces: «veo a alguien que todavía no conozco. ¿Cómo se llama? Si quieres, aprendo su cara y la recuerdo».`;
    return `${base} A quien no conoces, «alguien que todavía no conozco»; ya ofreciste aprender su cara: no lo repitas.`;
  }
  if (preguntaQuien) return 'CARAS: no llegó quién es nadie por la cara (reconocer caras apagado o nadie a la vista). No adivines nombres; para reconocer a alguien, que active «Reconocer caras» (Más → Caras) y te lo presente. No digas que no puedes reconocer caras.';
  return null;
}

/* ── tanda F1: quien espera la confirmación de la dueña no se nombra en la escena ───────────────────── */

const plano = (t: string) =>
  String(t || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

/**
 * La escena del teléfono sin el nombre de nadie que todavía no se puede reconocer: un posible menor que la dueña no
 * confirmó en su pantalla (lib/biometria-consentimiento.ts reconocible). Sale de «Reconozco a …» / "I recognize …" (con su
 * parentesco) y de «Por la voz, habla …» / "By voice, …"; en su lugar queda que hay alguien guardado que todavía no se
 * puede reconocer, sin nombre (y sin «que no conozco», para que no se ofrezca aprenderla otra vez). `nombres`: los de esas
 * personas (lib/caras-miembro.ts nombresCarasPorConfirmar, lib/voces-miembro.ts nombresVocesPorConfirmar).
 */
export function escenaSinPorConfirmar(escena: string, nombres: readonly string[]): string {
  const e = String(escena || '');
  const quitar = new Set(nombres.map(plano).filter(Boolean));
  if (!e || !quitar.size) return e;
  let quitadas = 0;
  let en = false;
  let out = e.replace(/\b(reconozco a|I recognize)\s+([^;.]*)/gi, (m, intro: string, lista: string) => {
    const partes = lista.split(/,\s*/);
    const quedan = partes.filter((p) => !quitar.has(plano(p.replace(/\s*\([^)]*\)\s*$/, ''))));
    if (quedan.length === partes.length) return m;
    if (/^I /i.test(intro)) en = true;
    quitadas += partes.length - quedan.length;
    return quedan.length ? `${intro} ${quedan.join(', ')}` : '';
  });
  out = out
    .replace(/\bPor la voz, habla ([^,.;()]{1,60})(?: \([^)]{0,40}\))?, no [^.;]*[.;]?/gi, (m, n: string) => {
      if (!quitar.has(plano(n))) return m;
      quitadas += 1;
      return '';
    })
    .replace(/\bBy voice, ([^,.;()]{1,60}) is speaking(?: \([^)]{0,40}\))?, not [^.;]*[.;]?/gi, (m, n: string) => {
      if (!quitar.has(plano(n))) return m;
      en = true;
      quitadas += 1;
      return '';
    });
  if (!quitadas) return e;
  const aviso = en
    ? `${quitadas} saved person(s) I can't recognize yet (the owner still has to confirm it on screen): don't name them`
    : `${quitadas} persona(s) guardada(s) que todavía no puedo reconocer (falta que la dueña lo confirme en su pantalla): no la nombres`;
  out = out
    .replace(/\b(Con la c[aá]mara trasera|With the back camera):\s*(?=;|$)/gi, '')
    .replace(/(\s*;\s*)+/g, '; ')
    .replace(/^[\s;,.]+|[\s;,]+$/g, '')
    .trim();
  return out ? `${out}; ${aviso}` : aviso.charAt(0).toUpperCase() + aviso.slice(1);
}
