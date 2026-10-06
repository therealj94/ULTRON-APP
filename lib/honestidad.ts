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
 */
import { plano } from './promesas';
import { esDeAntes, frasesConCitas, sinCitas, sinLoQueNoAfirma } from './cerebro-manos';
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

const ENVIO = [
  /\b(enviad|mandad|reenviad|despachad)[oa]s?\b/,
  /\b(ya |listo,? )?(se |te |le |les )?(lo |la |los |las )?(envie|mande|reenvie|despache)\b/,
  /\b(le|les|se lo|se la|se los|se las|te lo|te la) (escribi|respondi|conteste|reenvie|pase)\b/,
  /\bya (le |les )?(escribi|respondi|conteste)\b/,
  /\bya (salio|se fue|se envio|se mando|llego|le llego|lo recibio|la recibio|lo tiene)\b/,
  /\bse (envio|mando)\b(?! (a las|en|dentro))/,
  /\b(el|tu|su) (mensaje|whatsapp|correo|mail)( ya)? (salio|se fue|llego)\b/,
  /\b(message|text|email|e-mail|whatsapp|it|mail|msg)( has| have)?( been| was|'s| is)?( just| already)? (sent|delivered)\b/,
  /\bi(?:'ve| have)? (just |already )?(sent|texted|emailed|messaged|forwarded|replied to)\b/,
  /^\s*[¡!]?\s*(done[,!.]?\s*)?sent\b/,
];
const RECORDATORIO = [
  /\b(ya |listo,? )?(te |le |se )?(lo |la )?(agende|programe|puse)\b/,
  /\b(agendad|programad)[oa]s?\b/,
  /\b(recordatorio|alarma|aviso|cita|evento|timer|temporizador|despertador|reunion)\b[^.?!]{0,30}\b(quedo|esta|fue|queda|ya esta) (puest|cread|guardad|programad|agendad|list)/,
  /\bya (quedo|esta) (puest|programad|agendad)[oa]\b/,
  /\bte (llamo|marco|aviso|recuerdo)\b[^.?!]{0,40}\ba las \d/,
  /\breminder( is| has been|'s)? (set|scheduled|saved|created)\b/,
  /\bi(?:'ve| have)? (set|scheduled|added|created) (a |an |the |your )?(reminder|alarm|timer|appointment|event|meeting)\b/,
];
const LLAMADA = [/\b(ya )?(le |te |la |lo )(llame|marque)\b/, /\bi (called|dialed|rang)\b/];
const GUARDADO = [
  /\b(ya |listo,? )?(te |se )?(lo |la )?(guarde|anote|apunte|registre)\b/,
  /\b(guardad|anotad|apuntad|registrad)[oa]s?\b/,
  /\b(i(?:'ve| have)? (saved|noted|stored)|(it'?s|it is|it has been) (saved|noted|stored))\b/,
];
const GENERICO = [
  /\bya quedo\b/,
  /\b(ya esta|esta) hecho\b/,
  /\blisto,? (ya )?(quedo|hecho)\b/,
  /^\s*[¡!]?\s*hecho\s*[.!]*\s*$/,
  /\bya lo hice\b/,
  /\b(it'?s|it is) done\b|\ball done\b|\byou'?re all set\b/,
];

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
export function afirmacionesDeHecho(texto: string, contexto: { mensaje?: string; anterior?: string } = {}): Afirmacion[] {
  const out: Afirmacion[] = [];
  // De qué habla un «ya quedó» suelto: primero el resto de la misma respuesta («Sí, ya quedó. Te llamo a las 3:19 para
  // recordarte…»), después lo que pidió la persona y lo último que dijo AU-RA.
  const propio = plano(sinCitas(String(texto || '').replace(/^\s*(ACCION_APP|PEDIR_HERRAMIENTA)\s*:.*$/gim, ' ')));
  const pedido = plano(`${contexto.mensaje || ''} ${contexto.anterior || ''}`);
  for (const l of String(texto || '').split('\n')) {
    if (/^\s*(ACCION_APP|PEDIR_HERRAMIENTA)\s*:/i.test(l)) continue;
    for (const f of frasesConCitas(l)) {
      const propia = f.propia;
      if (!propia.trim() || /[¿?]/.test(propia)) continue;
      // Lo que la frase misma sitúa antes («hace rato», «ayer», "earlier"): es de otro turno, no de este (como en
      // lib/cerebro-manos.ts, revisión del 5-oct GRAVE-2). Salvo que la persona esté pidiendo o aprobando algo ahora.
      if (esDeAntes(propia) && !pideAhora(contexto.mensaje)) continue;
      const s = sinLoQueNoAfirma(plano(propia));
      const resto = propio.replace(plano(propia), ' ');
      const ctx = `${resto} ${pedido}`;
      let clase: Clase | null = null;
      if (hay(ENVIO, s)) clase = 'envio';
      else if (hay(RECORDATORIO, s)) clase = 'recordatorio';
      else if (hay(LLAMADA, s)) clase = 'llamada';
      else if (hay(GUARDADO, s)) clase = 'guardado';
      else if (hay(GENERICO, s)) clase = 'generico';
      if (!clase) continue;
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
    }
  }
  return out;
}

/** ¿Este trozo da por hecho un efecto? Para retenerlo en el stream hasta saber si hay recibo (no suena antes de la guarda). */
export function trozoAfirmaHecho(trozo: string): boolean {
  return afirmacionesDeHecho(trozo).length > 0;
}

/* ------------------------------------------------------------------ la guarda */

const palabras = (s: string) => plano(s).split(/[^a-z0-9ñ]+/).filter((w) => w.length >= 3);

/** ¿El recibo respalda esta afirmación? (su clase, su canal y, si los dos lo dicen, a quién). */
function respalda(a: Afirmacion, r: ReciboEfecto): boolean {
  if (r.estado !== 'confirmado') return false;
  const okClase =
    a.clase === 'envio'
      ? (r.canal === 'whatsapp' || r.canal === 'correo' || r.canal === 'chat') && (!a.canal || a.canal === r.canal)
      : a.clase === 'recordatorio'
        ? r.canal === 'recordatorio' || r.canal === 'llamada'
        : a.clase === 'llamada'
          ? r.canal === 'llamada'
          : a.clase === 'guardado'
            ? r.canal === 'guardado' || r.canal === 'recordatorio'
            : true;
  if (!okClase) return false;
  if (a.destino && r.destino) {
    const de = new Set(palabras(r.destino));
    if (!palabras(a.destino).some((w) => de.has(w))) return false;
  }
  return true;
}

/** ¿El mensaje de la persona aprueba o pide hacer algo ahora («sí», «envíalo», «mándale…»)? Entonces lo de antes no cuenta. */
function pideAhora(mensaje: string | undefined): boolean {
  const m = String(mensaje || '');
  if (!m.trim()) return false;
  const a = analizarRespuesta(m);
  if (a.pregunta) return false;
  return (a.afirma && !a.niega) || /\b(mand|envi|escrib|agend|program|recuerd|guard|anot|llam|marc|pon)\w*/.test(plano(m));
}

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
};

export type ResultadoHonestidad = { texto: string; cambiada: boolean; falsas: Afirmacion[] };

/** Lo honrado, por clase (nunca contiene una afirmación de hecho: la guarda es idempotente). */
function verdad(a: Afirmacion, ctx: ContextoHonestidad): string {
  const en = ctx.idioma === 'en';
  if (a.clase === 'envio') {
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
  const afirmaciones = afirmacionesDeHecho(original.slice(emo.length), { mensaje: ctx.mensaje, anterior: ctx.anterior });
  if (!afirmaciones.length) return { texto: original, cambiada: false, falsas: [] };
  // Lo de un turno anterior cuenta solo si la persona no está pidiendo o aprobando algo AHORA (entonces la afirmación es
  // de esto) y, para un envío, si no hay un borrador esperando (prueba que lo de ahora no salió).
  const valePrevio = (a: Afirmacion) => !pideAhora(ctx.mensaje) && !(a.clase === 'envio' && ctx.borrador);
  const falsas = afirmaciones.filter((a) => !ctx.recibos.some((r) => respalda(a, r)) && !(valePrevio(a) && (ctx.previos || []).some((r) => respalda(a, r))));
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
  const afirmaciones = afirmacionesDeHecho(original, { mensaje: ctx.mensaje, anterior: ctx.anterior });
  if (!afirmaciones.length) return original;
  const valePrevio = (a: Afirmacion) => !pideAhora(ctx.mensaje) && !(a.clase === 'envio' && ctx.borrador);
  const respaldadas = new Set(afirmaciones.filter((a) => ctx.recibos.some((r) => respalda(a, r)) || (valePrevio(a) && (ctx.previos || []).some((r) => respalda(a, r)))).map((a) => a.frase));
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
