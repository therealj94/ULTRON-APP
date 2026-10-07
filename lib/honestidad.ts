/**
 * NUNCA DECIR QUE SE HIZO ALGO QUE NO SE HIZO (José, 6-oct, APK 5.6.0 en la mesa del teléfono, 21:14–21:24 UTC: AU-RA
 * dijo «Listo, mensaje enviado» por WhatsApp CUATRO veces y no salió nada. «Estoy viendo WhatsApp y no le has enviado
 * mensaje»). Regla del dueño: ningún envío sin aprobación exacta de lo mostrado, y NUNCA afirmar un efecto que no pasó.
 *
 * Por qué se colaba: la guarda de «prometió sin herramienta» (lib/cerebro-manos.ts prometeSinHacer) buscaba «mandé»,
 * «envié», «te puse»…, no el participio («mensaje enviado», «ya quedó agendado», "message sent"). Los cuatro turnos
 * (dos por el camino de charla, uno por el de manos y uno por el respaldo) no usaron ninguna herramienta, ningún
 * borrador esperaba y el texto salió tal cual.
 *
 * Aquí, sin red y sin modelo (lo usan TODOS los caminos de server.ts: el stream de la mesa y la llamada —que entra por el
 * mismo turno—, el turno JSON y Telegram):
 *  · `afirmacionesDeHecho`: las frases que dan por HECHO un efecto (enviado, mandado, le escribí, ya salió, agendado,
 *    te puse la alarma, guardado, ya quedó, "sent", "reminder set"…). Sin lo negado, lo referido ni lo citado (el texto
 *    de un borrador que se le lee no es una afirmación de AU-RA), ni las preguntas.
 *  · `guardaDeHonestidad`: cada afirmación necesita un RECIBO real de su clase: de ESTE turno (el envío que confirmó el
 *    puente o el SMTP, el recordatorio que salió al teléfono, lo guardado) o, si la persona solo pregunta por algo de
 *    antes («¿ya lo guardaste?»), uno reciente del registro de efectos de esa cuenta (`anotarEfectoReal`). Sin recibo, la
 *    frase se reescribe a la verdad: «Todavía no lo envié: …». Un borrador que espera su «sí» prueba que NO salió.
 *  · `anotarEfectoReal` / `efectosRecientes`: lo que de verdad pasó (lo anotan los envíos aprobados de server/whatsapp.ts
 *    y server/correo.ts, y el turno con sus recibos), para no desmentir lo que sí se hizo en un turno anterior.
 *
 * Revisión independiente del 6-oct: la guarda es CONSERVADORA. Ante la duda no reescribe; solo actúa sobre lo que AU-RA
 * afirma claramente que YA hizo ella, sin recibo. No toca lo que presenta un borrador para aprobarlo (G1), ni la lectura
 * de datos o lo de terceros (G2); un «gracias» o un «ok» tras un envío real no lo desmiente, ni un apodo (M1).
 */
import { plano } from './promesas';
import { delTelefono, esDeAntes, frasesACorregir, frasesConCitas, herramientasPara, sinCitas, sinLoQueNoAfirma } from './cerebro-manos';
import { analizarRespuesta } from './afirmacion';

/* ------------------------------------------------------------------ los recibos */

/** De qué es un efecto real. */
export type CanalEfecto = 'whatsapp' | 'correo' | 'chat' | 'recordatorio' | 'llamada' | 'guardado';

/**
 * Un efecto que consta: `confirmado` (el proveedor lo aceptó, el teléfono recibió la acción, quedó guardado) o
 * `en-curso` (dijo que sí y sale al confirmarse el turno de voz: todavía no salió). `destino`: a quién, si se sabe.
 */
export type ReciboEfecto = { canal: CanalEfecto; estado: 'confirmado' | 'en-curso'; destino?: string; t?: number };

/** Los recibos de los pasos del harness de este turno (lib/harness.ts PasoHarness con su ReciboHerramienta). */
export function recibosDePasos(pasos: ReadonlyArray<{ herramienta?: string; estado?: string; recibo?: { efecto?: string; codigo?: string } }>): ReciboEfecto[] {
  const out: ReciboEfecto[] = [];
  for (const p of pasos || []) {
    const h = String(p?.herramienta || '');
    const ef = p?.recibo?.efecto;
    if (p?.estado === 'succeeded' && ef === 'confirmado') out.push({ canal: h === 'correo' ? 'correo' : h === 'whatsapp' || h === 'circulo' ? 'whatsapp' : 'guardado', estado: 'confirmado' });
    else if (p?.estado === 'succeeded' && ef === 'guardado') out.push({ canal: 'guardado', estado: 'confirmado' });
    else if (p?.estado === 'succeeded' && ef === 'borrador' && p.recibo?.codigo === 'pendiente-del-turno') out.push({ canal: h === 'correo' ? 'correo' : 'whatsapp', estado: 'en-curso' });
    // Los documentos que el servidor generó y dejó para bajar.
    else if (p?.estado === 'succeeded' && h === 'documento') out.push({ canal: 'guardado', estado: 'confirmado' });
  }
  return out;
}

/** Los recibos de las acciones que de verdad salieron al teléfono en este turno (no las propuestas). */
export function recibosDeAcciones(acciones: ReadonlyArray<{ tipo?: string; para?: string; con?: string } | undefined>): ReciboEfecto[] {
  const out: ReciboEfecto[] = [];
  for (const a of acciones || []) {
    const t = String(a?.tipo || '');
    if (t === 'enviar') out.push({ canal: 'chat', estado: 'confirmado', ...(a?.para ? { destino: a.para } : {}) });
    else if (t === 'recordatorio' || t === 'cancelar_recordatorio') out.push({ canal: 'recordatorio', estado: 'confirmado' });
    else if (t === 'llamar' || t === 'llamame') out.push({ canal: 'llamada', estado: 'confirmado', ...(a?.con ? { destino: a.con } : {}) });
    else if (t === 'perfil') out.push({ canal: 'guardado', estado: 'confirmado' });
  }
  return out;
}

/** Los recibos del «sí» que resolvió el servidor al empezar el turno (server/decision-turno.ts). */
export function reciboDeDecision(canal: 'whatsapp' | 'correo', r: { estado?: string; recibo?: { efecto?: string; codigo?: string } } | null | undefined, destino?: string): ReciboEfecto | null {
  if (!r || r.estado !== 'succeeded') return null;
  if (r.recibo?.efecto === 'confirmado') return { canal, estado: 'confirmado', ...(destino ? { destino } : {}) };
  if (r.recibo?.efecto === 'borrador' && r.recibo.codigo === 'pendiente-del-turno') return { canal, estado: 'en-curso', ...(destino ? { destino } : {}) };
  return null;
}

/* ------------------------------------------------------------------ el registro de efectos reales */

/** Cuánto vale un efecto de un turno anterior para no desmentirlo («¿ya lo guardaste?» → «Sí, ya quedó»). */
export const EFECTO_RECIENTE_MS = 20 * 60_000;
const MAX_POR_CUENTA = 30;
const EFECTOS = new Map<string, ReciboEfecto[]>();
const llaveEfecto = (dueno: string) => String(dueno || '').trim().toLowerCase();

/** Un efecto que de verdad pasó (solo `confirmado`), para los turnos que siguen. */
export function anotarEfectoReal(dueno: string, r: ReciboEfecto, ahora = Date.now()): void {
  const k = llaveEfecto(dueno);
  if (!k || r.estado !== 'confirmado') return;
  const xs = (EFECTOS.get(k) || []).filter((x) => ahora - (x.t ?? 0) <= EFECTO_RECIENTE_MS);
  xs.push({ ...r, t: r.t ?? ahora });
  EFECTOS.set(k, xs.slice(-MAX_POR_CUENTA));
  if (EFECTOS.size > 5_000) EFECTOS.delete(EFECTOS.keys().next().value as string);
}

/** Los efectos reales de esta cuenta en los últimos `EFECTO_RECIENTE_MS`. */
export function efectosRecientes(dueno: string, ahora = Date.now()): ReciboEfecto[] {
  return (EFECTOS.get(llaveEfecto(dueno)) || []).filter((x) => ahora - (x.t ?? 0) <= EFECTO_RECIENTE_MS);
}

/** Pruebas. */
export function _olvidarEfectos() {
  EFECTOS.clear();
}

/* ------------------------------------------------------------------ lo que da por hecho */

type Clase = 'envio' | 'recordatorio' | 'llamada' | 'guardado' | 'generico';
export type Afirmacion = { frase: string; clase: Clase; canal?: 'whatsapp' | 'correo' | 'chat'; destino?: string };

/** Lo que va antes y la vuelve futura, condicional o de otro («para ser enviado», «quieres que le mande», «si lo agendo»). */
const NO_ES_HECHO_ANTES = /\b(que|si|cuando|para|para ser|sera|seran|va a ser|van a ser|quedara|quedaria|puede ser|puedo|podria|quieres|queres|quiere|deseas|prefieres|antes de|hasta que|en cuanto|apenas|will be|to be|can be|should be|if|once|when|want me to)\s+(\S+\s+){0,2}$/;

/*
 * Revisión independiente del 6-oct (G2): solo cuenta lo que AU-RA dice de una acción SUYA. Un participio suelto no basta:
 * «Tienes 3 mensajes enviados hoy», «Tu cita está agendada para el lunes», «Tienes la reunión con Pedro programada para
 * mañana», «El correo de Ana fue enviado a las 3 pm» o «El oro ya salió a 2400» leen datos, no dicen que ella hizo nada.
 * El participio cuenta cuando ABRE la cláusula, como mucho detrás de una interjección («Listo, mensaje enviado»,
 * «Anotado», «Alarma programada para las 6») o como resultado de lo que se le pidió con «quedó / fue / ha sido» y sin dueño
 * de otro («Tu WhatsApp quedó enviado»; «El correo DE ANA fue enviado» no). Las formas en primera persona («le mandé»,
 * «te lo agendé», «ya le avisé», «acabo de mandarle», «le he escrito», "I sent") cuentan siempre.
 */
/** El principio de una cláusula, con las interjecciones que se le pegan («Listo,», «Sí,», «Ok,», "Done,", "All set,"). */
const INI = String.raw`(?:^|[,;:]\s*)\s*[¡!]?\s*(?:(?:listo|ya esta|hecho|perfecto|ok|okey|okay|va|vale|dale|sale|claro|bien|bueno|si|de nada|con gusto|done|great|all set|sure|yep|yes|perfect|there you go)[,!.]?\s+)*`;
/** Lo que AU-RA manda, agenda o guarda (el sujeto de «mensaje enviado», «alarma programada», «dato guardado»). */
const COSA_ENVIO = '(?:mensaje|mensajito|whatsapp|wasap|correo|mail|email|e-mail|texto|recado|sms)';
const COSA_REC = '(?:recordatorio|alarma|aviso|cita|evento|reunion|timer|temporizador|despertador)';
const COSA_GUARDA = '(?:dato|datos|nota|perfil|preferencia|contacto|numero|direccion)';
const ART = '(?:(?:el|la|tu|su) )?';
/** Lo que, detrás del participio, dice CUÁNDO pasó (un dato que se lee, no lo que acaba de hacer): «enviado a las 3». */
const NO_DATO = String.raw`(?!\s+(?:a las|ayer|anoche|hace|hoy a|el (?:lunes|martes|miercoles|jueves|viernes|sabado|domingo)|at \d|yesterday|on (?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)))`;
const rx = (s: string) => new RegExp(s);

/** Lo que dice que algo SALIÓ (no solo que se escribió o quedó): eso nunca se perdona por presentar un borrador (G1). */
const SALIO = [
  rx(String.raw`${INI}${ART}(?:${COSA_ENVIO} )?(?:ya )?(?:enviad|mandad|reenviad|despachad)[oa]s?\b${NO_DATO}`),
  rx(String.raw`${INI}${ART}${COSA_ENVIO} (?:ya )?(?:quedo|queda|ha sido|fue|ya esta|ya quedo|ya fue) (?:enviad|mandad|reenviad)[oa]s?\b${NO_DATO}`),
  /\b(ya |listo,? )?(se |te |le |les )?(lo |la |los |las )?(envie|mande|reenvie|despache)\b/,
  /\b(se lo |se la |se los |se las |le |les |te lo |te la |lo |la )?he (enviado|mandado|reenviado|hecho llegar)\b/,
  /\bacabo de (mandar|enviar|reenviar)(le|les|selo|sela|te|telo|tela)?\b/,
  /\b(se (lo|la|los|las)|le|les) hice llegar\b/,
  rx(String.raw`${INI}(?:ya )?(?:salio|se fue|se envio|se mando)\b(?=\s*(?:$|[.,;:!…]|(?:tu|el|su) ${COSA_ENVIO}\b|(?:a|para) (?!las\b|los\b)[a-z]))`),
  rx(String.raw`${INI}${ART}${COSA_ENVIO} (?:ya )?(?:salio|se fue|le llego)\b${NO_DATO}`),
  // «Listo, ya le llegó.» suelto; «Ya le llegó el correo de Ana» lee un dato.
  rx(String.raw`${INI}ya (?:le llego|les llego|lo recibio|la recibio|lo tiene|la tiene)\b(?=\s*(?:$|[.,;:!…]|(?:a|para) (?!las\b|los\b)[a-z]))`),
  rx(String.raw`${INI}(?:(?:your|the|my) )?(?:message|text|email|e-mail|whatsapp|it|mail|msg)(?: has| have)?(?: been| was|'s| is)?(?: just| already)? (?:sent|delivered)\b${NO_DATO}`),
  /\bi(?:'ve| have)? (just |already )?(sent|texted|emailed|messaged|forwarded)\b/,
  // M3: "Ok, sent it", "All set, sent", "Sent!".
  rx(String.raw`${INI}(?:just |already )?sent(?: it| them| the \w+| your \w+)?\b(?=\s*(?:$|[.,;:!…]|to\b))`),
];
const ENVIO = [
  ...SALIO,
  /\b(le|les|se lo|se la|se los|se las|te lo|te la) (escribi|respondi|conteste|reenvie|pase)\b/,
  /\bya (le |les )?(escribi|respondi|conteste)\b/,
  // M3: «Ya le avisé», «Ya le dije», «Le he escrito a Ana», «Acabo de escribirle».
  /\b(le|les|se lo|se la|se los|se las) (avise|dije)\b/,
  /\b(se lo |se la |le |les |te lo |te la )?he (escrito|respondido|contestado)\b/,
  /\b(le|les|se lo|se la) he (avisado|dicho)\b/,
  /\bacabo de (escribir|responder|contestar)(le|les|selo|sela|te|telo|tela)?\b/,
  /\bacabo de (avisar|decir)(le|les|selo|sela)\b/,
  /\bi(?:'ve| have)? (just |already )?(replied to|told (?!you\b)\w+|let (?!you\b)\w+ know)\b/,
];
const RECORDATORIO = [
  /\b(ya |listo,? )?(te |le |se )?(lo |la )?(agende|programe)\b/,
  // «puse» solo con lo que se pone (la alarma, el recordatorio, «para mañana», «a las 6»): «Lo puse más formal» no (G1).
  rx(String.raw`\b(?:te |le |se )?(?:lo |la )?puse\b(?=\s+(?:(?:la|una|el|un|tu) )?${COSA_REC}\b|\s+para\b|\s+a las \d|\s+en (?:tu |el )?(?:calendario|agenda)\b)`),
  rx(String.raw`${INI}${ART}(?:${COSA_REC} )?(?:ya )?(?:agendad|programad)[oa]s?\b`),
  rx(String.raw`${INI}${ART}${COSA_REC} (?:ya )?(?:quedo|queda|ha sido|fue|ya esta|ya quedo) (?:puest|cread|guardad|programad|agendad|list)[oa]s?\b`),
  rx(String.raw`${INI}ya (?:quedo|esta) (?:puest|programad|agendad)[oa]\b`),
  // «Te llamo a las 3» (lo que AU-RA dejó puesto); «Te recuerdo que a las 3 tienes la reunión» lee un dato (G2).
  /\bte (llamo|marco|aviso)\b[^.?!]{0,40}\ba las \d/,
  /\breminder( is| has been|'s)? (set|scheduled|saved|created)\b/,
  /\bi(?:'ve| have)? (set|scheduled|added|created) (a |an |the |your )?(reminder|alarm|timer|appointment|event|meeting)\b/,
];
const LLAMADA = [/\b(ya )?(le |te |la |lo )(llame|marque)\b/, /\bi (called|dialed|rang)\b/];
const GUARDADO = [
  /\b(ya |listo,? )?(te |se )?(lo |la )?(guarde|anote|apunte|registre)\b/,
  rx(String.raw`${INI}${ART}(?:${COSA_GUARDA} )?(?:ya )?(?:guardad|anotad|apuntad|registrad)[oa]s?\b`),
  /\b(i(?:'ve| have)? (saved|noted|stored)|(it'?s|it is|it has been) (saved|noted|stored))\b/,
];
/** Detrás de «ya quedó» / «listo, quedó»: el fin, o lo que quedó HECHO. «Ya quedó claro», «quedó así: …» no (G1, G2). */
const QUEDO_HECHO = String.raw`(?=\s*(?:$|[.,;:!…]|(?:list|hech|puest|agendad|programad|enviad|mandad|guardad|anotad)[oa]s?\b|todo\b))`;
const GENERICO = [
  rx(String.raw`\bya quedo\b${QUEDO_HECHO}`),
  /\b(ya esta|esta) hecho\b/,
  rx(String.raw`\blisto,? (?:ya )?(?:quedo|hecho)\b${QUEDO_HECHO}`),
  /^\s*[¡!]?\s*hecho\s*[.!]*\s*$/,
  /\bya lo hice\b/,
  /\b(it'?s|it is) done\b|\ball done\b|\byou'?re all set\b/,
];

/*
 * G1: lo que PRESENTA un borrador para aprobarlo no afirma nada. «Listo, quedó así: «Hola Ana, llego a las 9». ¿Lo
 * envío?», «Ya quedó el borrador para Ana: «…». ¿Lo envío?», «Lo puse más formal: «Estimada Ana…». ¿Lo mando?» se
 * reescribían enteros (y se perdía el texto que se le mostraba). Una frase con su cita y una pregunta de aprobación
 * después, o lo que habla del borrador mismo, se deja tal cual; lo que dice que algo SALIÓ («Ya se lo mandé»), no.
 */
const APRUEBA = /¿[^?]*\b((se |te |le )?(lo|la|los|las) (envio|mando|mandamos|enviamos|despacho|apruebas|confirmo|confirmas|dejo asi|cambio)|(te )?parece( bien)?|(asi )?(esta|queda) bien|le cambio algo|send it|shall i send|should i send|ok to send|good to go|sound good|looks? good)\b[^?]*\?/;
const DEL_BORRADOR = /\b(borrador|draft)\b/;
const CON_CITA = /[«"“]/;

/** ¿Algún patrón aparece en `s` sin nada antes que lo vuelva futuro, condicional o de otro? */
function hay(res: RegExp[], s: string): boolean {
  for (const re of res) {
    const g = new RegExp(re.source, 'g');
    for (let m = g.exec(s); m; m = g.exec(s)) {
      if (!NO_ES_HECHO_ANTES.test(s.slice(0, m.index))) return true;
      if (g.lastIndex === m.index) g.lastIndex++;
    }
  }
  return false;
}

const DE_WHATSAPP = /\b(whatsapp|wasap|guasap|wsp|whats)\b/;
const DE_CORREO = /\b(correo|correos|mail|email|e-mail|gmail|outlook)\b/;
const DE_CHAT = /\b(pulse ?2 ?chat|chat de aura|chats de aura)\b/;
const DE_ENVIO = /\b(mand\w*|envi\w*|escrib\w*|mensaje\w*|whatsapp|wasap|correo\w*|mail|email|text\w*|send|message|respond\w*|contest\w*|dile|avisale)\b/;
const DE_RECORDATORIO = /\b(recuerd\w*|record\w*|alarma|despert\w*|agend\w*|program\w*|cita|timer|temporizador|remind\w*|schedul\w*)\b|\bte (llamo|marco|aviso)\b[^.?!]{0,40}\ba las\b/;
const DE_GUARDAR = /\b(guard\w*|anot\w*|apunt\w*|save|note)\b/;
const DE_LLAMADA = /\b(llam\w*|marc\w*|call)\b/;

/** El canal de un envío por sus palabras (la frase, o lo que se habló). */
function canalDe(p: string): Afirmacion['canal'] {
  if (DE_WHATSAPP.test(p)) return 'whatsapp';
  if (DE_CORREO.test(p)) return 'correo';
  if (DE_CHAT.test(p)) return 'chat';
  return undefined;
}

/** A quién dice que fue: el nombre propio (con mayúscula) detrás de «a» / «para» / "to" en la frase original. */
function destinoDe(frase: string): string | undefined {
  const m = /\b(?:a|para|to)\s+((?:[A-ZÁÉÍÓÚÑ][\p{L}]+)(?:\s+(?:de\s+)?[A-ZÁÉÍÓÚÑ][\p{L}]+){0,3})/u.exec(frase);
  if (!m) return undefined;
  const d = m[1].replace(/\s+(?:WhatsApp|Gmail|Outlook)$/u, '').trim();
  return /^(WhatsApp|PULSE2CHAT|Gmail|Outlook)$/i.test(d) ? undefined : d;
}

/**
 * Las afirmaciones de un efecto hecho, frase por frase, fuera de lo citado, lo negado, lo referido y las preguntas.
 * `contexto`: lo que pidió la persona y lo último que dijo AU-RA (de qué habla un «ya quedó» suelto).
 */
export function afirmacionesDeHecho(texto: string, contexto: { mensaje?: string; anterior?: string; borrador?: unknown } = {}): Afirmacion[] {
  const out: Afirmacion[] = [];
  // De qué habla un «ya quedó» suelto: primero el resto de la misma respuesta («Sí, ya quedó. Te llamo a las 3:19 para
  // recordarte…»), después lo que pidió la persona y lo último que dijo AU-RA.
  const propio = plano(sinCitas(String(texto || '').replace(/^\s*(ACCION_APP|PEDIR_HERRAMIENTA)\s*:.*$/gim, ' ')));
  const pedido = plano(`${contexto.mensaje || ''} ${contexto.anterior || ''}`);
  // Todas las frases en orden (para saber si después viene la pregunta de aprobación de un borrador que se presenta).
  const todas = String(texto || '')
    .split('\n')
    .filter((l) => !/^\s*(ACCION_APP|PEDIR_HERRAMIENTA)\s*:/i.test(l))
    .flatMap((l) => frasesConCitas(l));
  const ahora = pideAhora(contexto.mensaje, contexto);
  todas.forEach((f, i) => {
    const propia = f.propia;
    if (!propia.trim() || /[¿?]/.test(propia)) return;
    // Lo que la frase misma sitúa antes («hace rato», «ayer», "earlier"): es de otro turno, no de este (como en
    // lib/cerebro-manos.ts, revisión del 5-oct GRAVE-2). Salvo que la persona esté pidiendo o aprobando algo ahora.
    if (esDeAntes(propia) && !ahora) return;
    const s = sinLoQueNoAfirma(plano(propia));
    const resto = propio.replace(plano(propia), ' ');
    const ctx = `${resto} ${pedido}`;
    let clase: Clase | null = null;
    if (hay(ENVIO, s)) clase = 'envio';
    else if (hay(RECORDATORIO, s)) clase = 'recordatorio';
    else if (hay(LLAMADA, s)) clase = 'llamada';
    else if (hay(GUARDADO, s)) clase = 'guardado';
    else if (hay(GENERICO, s)) clase = 'generico';
    if (!clase) return;
    // G1: presenta un borrador para aprobarlo (con su cita y la pregunta después, o habla del borrador mismo): no afirma.
    const aprueba = todas.slice(i + 1).some((x) => APRUEBA.test(plano(x.propia)));
    const salio = hay(SALIO, s);
    // Lo que dice que SALIÓ nunca se perdona, ni con cita ni con «¿te parece bien?» detrás (revisión de 78ac7c2).
    if (aprueba && !salio) return;
    if (!salio && DEL_BORRADOR.test(s)) return;
    // «Ya quedó» o «te lo guardé» sueltos: de qué es lo dice la frase misma o, si no, lo que se habló.
    if (clase === 'generico' || clase === 'guardado') {
      const de = (x: string): Clase | null => (DE_ENVIO.test(x) ? 'envio' : DE_RECORDATORIO.test(x) ? 'recordatorio' : DE_LLAMADA.test(x) ? 'llamada' : DE_GUARDAR.test(x) ? 'guardado' : null);
      const propiaDe = DE_ENVIO.test(s) ? 'envio' : DE_RECORDATORIO.test(s) ? 'recordatorio' : null;
      clase = propiaDe ?? (clase === 'guardado' ? 'guardado' : (de(resto) ?? de(pedido) ?? 'generico'));
    }
    const a: Afirmacion = { frase: f.texto, clase };
    if (clase === 'envio') {
      const c = canalDe(s) || canalDe(ctx);
      if (c) a.canal = c;
      const d = destinoDe(f.texto);
      if (d) a.destino = d;
    }
    out.push(a);
  });
  return out;
}

/** ¿Este trozo da por hecho un efecto? Para retenerlo en el stream hasta saber si hay recibo (no suena antes de la guarda). */
export function trozoAfirmaHecho(trozo: string): boolean {
  return afirmacionesDeHecho(trozo).length > 0;
}

/* ------------------------------------------------------------------ la guarda */

const palabras = (s: string) => plano(s).split(/[^a-z0-9ñ]+/).filter((w) => w.length >= 3);

/*
 * M1 (revisión del 6-oct): un nombre que no coincide no desmiente un envío real. «Ya se lo mandé a Papá» con el recibo de
 * «Viejo +504…» (el mismo contacto con su apodo) o un nombre de menos de 3 letras («Bo», «Al») salían como «Todavía no lo
 * envié». Solo cuenta como OTRA persona un nombre de verdad que no comparte ninguna palabra con el del recibo.
 */
const APODO = new Set('papa mama papi mami viejo vieja viejito viejita jefe jefa compadre comadre compa padrino madrina abuelo abuela abue tio tia hermano hermana hermanito hermanita hijo hija amor mor cielo esposo esposa marido mujer suegro suegra primo prima bro brother sis gordo gorda flaco flaca negro negra chele chela profe doc doctor doctora dad mom'.split(' '));
/** ¿Los dos nombres son claramente de personas distintas? */
function otraPersona(dicho: string, delRecibo: string): boolean {
  const a = palabras(dicho);
  const b = palabras(delRecibo).filter((w) => !/^\d+$/.test(w));
  if (!a.length || !b.length) return false;
  // Lo que AU-RA dice es un apodo («Papá», «mi viejo»): puede ser el mismo contacto guardado con otro nombre.
  if (a.some((w) => APODO.has(w))) return false;
  const de = new Set(b);
  return !a.some((w) => de.has(w));
}

/** ¿El recibo respalda esta afirmación? (su clase, su canal y, si los dos lo dicen y son claramente otro, a quién). */
function respalda(a: Afirmacion, r: ReciboEfecto): boolean {
  return mismaClase(a, r) && !(a.destino && r.destino && otraPersona(a.destino, r.destino));
}

/** ¿El recibo es de lo que afirma (clase y canal), sin mirar a quién? */
function mismaClase(a: Afirmacion, r: ReciboEfecto): boolean {
  if (r.estado !== 'confirmado') return false;
  return a.clase === 'envio'
    ? (r.canal === 'whatsapp' || r.canal === 'correo' || r.canal === 'chat') && (!a.canal || a.canal === r.canal)
    : a.clase === 'recordatorio'
      ? r.canal === 'recordatorio' || r.canal === 'llamada'
      : a.clase === 'llamada'
        ? r.canal === 'llamada'
        : a.clase === 'guardado'
          ? r.canal === 'guardado' || r.canal === 'recordatorio'
          : true;
}

/** Lo último de AU-RA ofrecía una acción («¿Lo envío?», «¿Te lo agendo?», «¿Le escribo esto?»): un «sí» la aprueba. */
const OFRECE_ACCION = /¿[^?]*\b(escrib\w*|mand\w*|envi\w*|reenvi\w*|respond\w*|contest\w*|llam\w*|marc\w*|record\w*|recuerd\w*|agend\w*|program\w*|pong\w*|pon(go|emos|elo|selo)?|guard\w*|anot\w*|send|call|remind|schedule|save|text)\b[^?]*\?/;
/** Lo que pide hacer algo («mándale», «agéndalo», «ponme la alarma»), sin lo agradecido («gracias por mandarlo»). */
const PIDE_VERBO = /\b(mand|envi|escrib|agend|program|recuerd|guard|anot|llam|marc|pon)\w*/;
const AGRADECE = /\b(gracias|thanks|thank you|thx|te pasaste|muy amable)\b/;
/** Segunda persona en pasado: pregunta por lo que AU-RA ya hizo («ya lo mandaste», «le escribiste»). */
const PREGUNTA_HECHO = /\b(mand|envi|reenvi|agend|program|guard|anot|llam|marc|avis)\w*aste\b|\b(escrib|respond|contest|pus|hic|dij)\w*iste\b/;

/**
 * ¿El mensaje de la persona aprueba o pide hacer algo AHORA? Entonces lo de antes no respalda lo que se afirma. Un «sí»
 * aprueba solo si había algo que aprobar (un borrador esperando o una acción que AU-RA acababa de ofrecer); «Perfecto,
 * gracias» o «Ok» tras un envío real agradece o confirma lo hecho (M1: antes cualquier «sí» descartaba lo de antes y
 * «¡De nada! Ya se lo mandé a Ana» salía como «Todavía no lo envié»).
 */
function pideAhora(mensaje: string | undefined, o: { anterior?: string; borrador?: unknown } = {}): boolean {
  const m = String(mensaje || '');
  if (!m.trim()) return false;
  const a = analizarRespuesta(m);
  if (a.pregunta) return false;
  const p = plano(m);
  // «ya se lo mandaste», «entonces ya le escribiste a mi viejo» sin «¿» (la transcripción de voz los pierde): pregunta por
  // lo hecho, no pide hacerlo otra vez (revisión de 78ac7c2: se desmentía un envío real y la persona lo repetía).
  if (PREGUNTA_HECHO.test(p) && !/\b(otra vez|de nuevo|otro|otra)\b/.test(p)) return false;
  const pide = PIDE_VERBO.test(p.replace(/\b(por|for) \w+/g, ' '));
  // «Gracias por mandarlo» agradece; «Gracias, ahora mándale a Pedro» pide otra cosa.
  if (AGRADECE.test(p)) return pide;
  if (a.envio || pide) return true;
  if (!a.afirma || a.niega) return false;
  return !!o.borrador || OFRECE_ACCION.test(plano(sinCitas(String(o.anterior || ''))));
}

/** Cuánto vale un efecto de antes cuando la persona solo agradece o confirma (si pregunta, `EFECTO_RECIENTE_MS`). */
export const EFECTO_CORTESIA_MS = 10 * 60_000;

export type ContextoHonestidad = {
  /** Los recibos de ESTE turno. */
  recibos: ReadonlyArray<ReciboEfecto>;
  /** Los efectos reales recientes de la cuenta (de turnos anteriores): `efectosRecientes`. */
  previos?: ReadonlyArray<ReciboEfecto>;
  /** Lo que dijo la persona en este turno. */
  mensaje?: string;
  /** Lo último que dijo AU-RA. */
  anterior?: string;
  /** Un borrador de correo o de WhatsApp (o el mensaje de la app) espera su «sí»: prueba que no salió. */
  borrador?: { canal?: 'whatsapp' | 'correo' | 'chat'; para?: string } | null;
  idioma?: 'es' | 'en';
  /** La hora del turno (pruebas). */
  ahora?: number;
};

/**
 * ¿Consta lo que afirma? Un recibo de ESTE turno, o un efecto real de antes si la persona no está pidiendo ni aprobando
 * algo ahora (entonces la afirmación es de esto) y, para un envío, si no hay un borrador esperando (prueba que lo de
 * ahora no salió). Lo de antes vale `EFECTO_RECIENTE_MS` si pregunta («¿ya se lo mandaste?») y `EFECTO_CORTESIA_MS` si
 * agradece o confirma («Perfecto, gracias»).
 */
function respaldada(a: Afirmacion, ctx: ContextoHonestidad): boolean {
  if (ctx.recibos.some((r) => respalda(a, r))) return true;
  if (pideAhora(ctx.mensaje, ctx) || (a.clase === 'envio' && ctx.borrador)) return false;
  const ahora = ctx.ahora ?? Date.now();
  const ventana = /[¿?]/.test(String(ctx.mensaje || '')) ? EFECTO_RECIENTE_MS : EFECTO_CORTESIA_MS;
  return (ctx.previos || []).some((r) => ahora - (r.t ?? ahora) <= ventana && respalda(a, r));
}

/** El nombre de un destino, sin el número («Padrino +50488881111» → «Padrino»). */
const soloNombre = (d: string) => d.replace(/[+\d][\d\s()\-]{5,}/g, ' ').replace(/\S*@\S+/g, ' ').replace(/\s+/g, ' ').trim();

export type ResultadoHonestidad = { texto: string; cambiada: boolean; falsas: Afirmacion[] };

/** Lo honrado, por clase (nunca contiene una afirmación de hecho: la guarda es idempotente). */
function verdad(a: Afirmacion, ctx: ContextoHonestidad): string {
  const en = ctx.idioma === 'en';
  if (a.clase === 'envio') {
    // Sí salió en este turno, pero a otra persona que la que dice: a quién fue de verdad.
    const otro = a.destino ? ctx.recibos.find((r) => mismaClase(a, r) && r.destino && soloNombre(r.destino)) : undefined;
    if (otro?.destino) {
      const nombre = soloNombre(otro.destino);
      return en ? `I sent it, but to ${nombre}, not to ${a.destino}.` : `Lo envié, pero a ${nombre}, no a ${a.destino}.`;
    }
    if (ctx.recibos.some((r) => r.estado === 'en-curso' && (r.canal === 'whatsapp' || r.canal === 'correo')))
      return en ? "I'm sending it now; I'll confirm as soon as it goes out." : 'Lo estoy mandando ahora; te confirmo en cuanto salga.';
    const b = ctx.borrador;
    if (b) {
      const para = b.para ? (en ? ` for ${b.para}` : ` para ${b.para}`) : '';
      return en
        ? `I haven't sent it yet: the message${para} is waiting for your approval on the confirmation card.`
        : `Todavía no lo envié: el mensaje${para} está esperando tu aprobación en la tarjeta de confirmación.`;
    }
    return en
      ? "I haven't sent it: there's no message ready to send. Tell me who to write to and what to say, and I'll show you the draft to approve."
      : 'Todavía no lo envié: no hay ningún mensaje listo para mandar. Dime a quién y qué le escribo, y te muestro el borrador para que lo apruebes.';
  }
  if (a.clase === 'recordatorio') return en ? "That reminder isn't set yet: tell me the time and I'll set it." : 'Todavía no quedó puesto ese recordatorio: dime la hora y lo pongo.';
  if (a.clase === 'llamada') return en ? "I haven't made that call yet." : 'Todavía no hice esa llamada.';
  if (a.clase === 'guardado') return en ? "I haven't saved it yet." : 'Todavía no lo guardé.';
  return en ? "I haven't done that yet." : 'Todavía no lo hice.';
}

/** Una interjección suelta («¡Listo!», «Va.», "Done!") delante de lo falso: sin lo falso, contradice la verdad. */
const INTERJECCION = /^\s*[¡!]?\s*((listo|va|hecho|perfecto|ya|ya esta|sale|dale|claro|okey|ok|done|great|all set|there you go|perfect)|((va|listo),?\s+)?(mensaje|borrador|correo|whatsapp) listo)[\s!.,…]*$/i;
/** El cierre de un recado hecho («¿Algo más?», "Anything else?"): después de la verdad sobra. */
const CIERRE = /^\s*[¿]?\s*(algo mas|en que mas te (ayudo|puedo ayudar)|necesitas algo mas|anything else|what else can i do)\b[^?]*\?\s*$/i;

/**
 * LA GUARDA DURA: cada afirmación de un efecto hecho necesita su recibo. Lo que no lo tiene se cambia por la verdad, en
 * su lugar (las líneas ACCION_APP / PEDIR_HERRAMIENTA, la etiqueta de ánimo y lo citado no se tocan). Determinista.
 */
export function guardaDeHonestidad(texto: string, ctx: ContextoHonestidad): ResultadoHonestidad {
  const original = String(texto || '');
  const emo = /^\s*\[[^\]]{0,30}\]\s*/.exec(original)?.[0] || '';
  // Las frases se miran sin la etiqueta de ánimo del principio (así coinciden con las que se reescriben).
  const afirmaciones = afirmacionesDeHecho(original.slice(emo.length), { mensaje: ctx.mensaje, anterior: ctx.anterior, borrador: ctx.borrador });
  if (!afirmaciones.length) return { texto: original, cambiada: false, falsas: [] };
  const falsas = afirmaciones.filter((a) => !respaldada(a, ctx));
  if (!falsas.length) return { texto: original, cambiada: false, falsas: [] };
  const lineas = original.slice(emo.length).split('\n');
  const dichas = new Set<string>();
  const nuevas = lineas.map((l) => {
    if (/^\s*(ACCION_APP|PEDIR_HERRAMIENTA)\s*:/i.test(l)) return l;
    const fs = frasesConCitas(l);
    const quitar = fs.map((f) => falsas.some((a) => a.frase === f.texto));
    if (!quitar.some(Boolean)) return l;
    const partes: string[] = [];
    fs.forEach((f, i) => {
      if (quitar[i]) {
        const a = falsas.find((x) => x.frase === f.texto)!;
        const v = verdad(a, ctx);
        if (!dichas.has(v)) {
          dichas.add(v);
          partes.push(v);
        }
        return;
      }
      // «¡Listo!» pegado a lo falso, y el «¿Algo más?» del recado que no se hizo, sobran.
      if (INTERJECCION.test(plano(f.propia)) && (quitar[i + 1] || quitar[i - 1])) return;
      if (CIERRE.test(plano(f.propia)) && quitar.slice(0, i).some(Boolean)) return;
      partes.push(f.texto.trim());
    });
    return partes.filter(Boolean).join(' ');
  });
  const final = `${emo}${nuevas.join('\n').replace(/[ \t]{2,}/g, ' ').trim()}`;
  return { texto: final, cambiada: final !== original, falsas };
}

/**
 * El texto sin las frases que afirman algo que SÍ consta (un recibo de este turno, o un efecto real reciente por el que la
 * persona solo pregunta). Para que la corrección de «prometió sin herramienta» (lib/cerebro-manos.ts) no desmienta lo que
 * de verdad pasó en un turno anterior («¿Ya se lo mandaste?» → «Sí, ya se lo mandé a Padrino» salía como «Eso todavía no lo
 * hice») ni gaste una segunda vuelta al modelo en eso.
 */
export function sinLoRespaldado(texto: string, ctx: ContextoHonestidad): string {
  const original = String(texto || '');
  const afirmaciones = afirmacionesDeHecho(original, { mensaje: ctx.mensaje, anterior: ctx.anterior, borrador: ctx.borrador });
  if (!afirmaciones.length) return original;
  const respaldadas = new Set(afirmaciones.filter((a) => respaldada(a, ctx)).map((a) => a.frase));
  if (!respaldadas.size) return original;
  return original
    .split('\n')
    .map((l) => (/^\s*(ACCION_APP|PEDIR_HERRAMIENTA)\s*:/i.test(l) ? l : frasesConCitas(l).filter((f) => !respaldadas.has(f.texto)).map((f) => f.texto).join('')))
    .join('\n');
}

/** Para los registros: qué clases se corrigieron (sin el texto). */
export function motivosDeHonestidad(falsas: ReadonlyArray<Afirmacion>): string {
  return [...new Set(falsas.map((a) => `${a.clase}${a.canal ? `:${a.canal}` : ''}`))].join(', ');
}

/* ------------------------------------------------------------------ las promesas en la voz en vivo */

/*
 * LO PROMETIDO NO SUENA ANTES DE SU RECIBO (auditoría del 7-oct, A3: en la voz en vivo «ya te lo mando» sonaba antes de
 * que corrieran las guardas, y en 5 de 8 casos reales nunca se cumplió ni se desmintió). El stream de server.ts retenía
 * lo que da por HECHO («enviado», «ya le respondí») y el trabajo prometido («voy a buscar», «te aviso»), no la promesa
 * de una acción («ya te lo mando», «te llamo en 30 segundos», «ahí te marco», «te pongo el recordatorio»). Ahora también:
 * se retiene hasta el final del turno, y sale solo si una herramienta del turno lo hizo (con su recibo) o si las guardas
 * del final la dejan; si no, se dice la verdad en el mismo turno, sin que la promesa haya sonado.
 */

/**
 * ¿Este trozo (lo que el stream está por soltar) promete o da por hecha una acción de AU-RA? Sin lo negado, lo referido,
 * lo citado ni, con un borrador esperando su «sí», lo que se dice de ESE borrador («¿Lo mando?», «tócale Sí y sale»).
 */
export function trozoPrometeAccion(trozo: string, o: { borradorPendiente?: boolean } = {}): boolean {
  return frasesACorregir(String(trozo || ''), o).length > 0;
}

/**
 * ¿Queda en lo dicho una promesa de lo que la persona PIDIÓ, sin cumplir? (para cuando la re-pregunta contestó «NADA» o
 * contestó el Qwen del nodo, que no tiene herramientas como tales). Solo si lo prometido es de la misma clase que lo
 * pedido (su mensaje y lo último que dijo AU-RA): «Va, te lo mando» a «mándale a Ana que llego tarde» sin ningún borrador
 * es una promesa incumplida; «Te mando un abrazo» a «buenas noches» no (ahí el «NADA» del modelo tiene razón).
 */
export function promesaSinCumplir(o: { dicho: string; mensaje?: string; anterior?: string; borradorPendiente?: boolean }): boolean {
  // Los turnos que manda el teléfono, no la persona («[[recordatorio]] La pastilla», «[[llamada]]»): ahí «te llamo para
  // recordarte…» describe la llamada que está pasando.
  if (/^\s*\[\[/.test(String(o.mensaje || ''))) return false;
  const falsas = frasesACorregir(String(o.dicho || ''), { borradorPendiente: o.borradorPendiente }).filter((f) => !delTelefono(f));
  if (!falsas.length) return false;
  const prometido = herramientasPara(falsas.join(' '));
  // Llamarla o ponerle un recordatorio («te llamo en un minuto», «te pongo la alarma») es concreto: sin herramienta, no pasa.
  if (prometido.has('llamarme') || prometido.has('recordatorio')) return true;
  const pedido = herramientasPara(`${o.mensaje || ''}\n${o.anterior || ''}`);
  if (!pedido.size) return false;
  // «Ahí voy», «ya lo hago»: lo prometido es lo pedido.
  if (!prometido.size) return true;
  return [...prometido].some((h) => pedido.has(h));
}
