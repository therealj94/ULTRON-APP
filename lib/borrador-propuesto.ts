/**
 * EL BORRADOR DE VERDAD, NO UN «¿LE ESCRIBO ESTO?» EN TEXTO (José, 6-oct, 21:15:59 UTC: AU-RA contestó «¿Le escribo esto?
 * "Viejo, ¿cómo vamos?"» sin usar la herramienta de WhatsApp; no quedó ningún borrador, el «Sí, enviarlo» no tenía nada que
 * aprobar y el modelo terminó diciendo «Listo, mensaje enviado»).
 *
 * Un borrador de verdad es el de la herramienta (server/whatsapp.ts guardarBorrador): destinatario RESUELTO contra sus chats
 * y contactos (si hay dos parecidos, se pregunta cuál), texto exacto, su tarjeta Confirmar en la ventana de decisión, y su
 * «sí» lo resuelve el servidor (server/decision-turno.ts). Aquí, sin red: si la respuesta del modelo PROPONE mandar un
 * mensaje con su texto citado y no usó la herramienta, se saca qué propuso (a quién y qué) para que server.ts pida la
 * herramienta en su lugar (`whatsapp responder`). Sin texto citado o sin a quién, no se inventa nada: null.
 */
import { plano } from './promesas';
import { sinCitas } from './cerebro-manos';

export type PropuestaEnvio = { canal: 'whatsapp'; destino: string; texto: string };

/** La respuesta pregunta si manda (o dice que va a escribir) un mensaje: «¿Le escribo esto?», «¿Lo envío?», «le escribo a Ana: …». */
const PREGUNTA_ENVIO = /¿[^?]*\b(le |se |te )?(lo |la )?(escribo|envio|mando|mandamos|enviamos|mandarlo|enviarlo|mando asi|envio asi)\b[^?]*\?|\b(le |se )(escribo|mando|envio)\b[^.?!]{0,60}:/;
/** Lo citado: «…», "…", “…” (con o sin *énfasis*). */
const CITA = /[«"“]\s*\*?([^»"”\n]{2,600}?)\*?\s*[»"”]/;
/** Palabras que cortan un nombre dicho por la persona («a mi viejo por WhatsApp que…»). */
const CORTA_NOMBRE = new Set('por que de del en con y para ahora hoy manana whatsapp wasap correo mensaje mensajito un una el la lo le ya pues porfa favor si no como cuando on via that saying please'.split(' '));
/** Lo que no es un nombre de contacto (canal, relleno). */
const NO_NOMBRE = /^(whatsapp|pulse2chat|gmail|outlook|correo|mensaje)$/i;

/** El nombre propio (con mayúscula) detrás de «a» / «para», fuera de lo citado. */
function destinoEnRespuesta(sinCita: string): string | null {
  const re = /\b(?:a|para)\s+((?:[A-ZÁÉÍÓÚÑ][\p{L}]+)(?:\s+[A-ZÁÉÍÓÚÑ][\p{L}]+){0,3})/gu;
  for (let m = re.exec(sinCita); m; m = re.exec(sinCita)) {
    const d = m[1].replace(/\s+(WhatsApp|Gmail|Outlook)$/u, '').trim();
    if (d && !NO_NOMBRE.test(d)) return d;
  }
  return null;
}

/**
 * A quién pidió la persona mandarlo, en sus palabras («mándele un mensaje a mi viejo por WhatsApp» → «viejo»). Sin el
 * posesivo («mi», «mis», «tu», «su»): la herramienta busca el contacto por su nombre.
 */
export function destinoPedido(mensaje: string): string | null {
  const p = plano(mensaje).replace(/[¿?¡!.,;:\-–—]/g, ' ').replace(/\s+/g, ' ');
  const m =
    /\b(?:send|text|message|tell|write)\w*\b.*?\bto\s+(.+)$/.exec(p) || /\b(?:mand|envi|escrib|dile|digale|decile|pregunt|avis|contest|respond)\w*\b.*?\b(?:a|para)\s+(.+)$/.exec(p);
  if (!m) return null;
  const ws = m[1].split(' ').filter(Boolean);
  while (ws.length && /^(mi|mis|tu|tus|su|sus|el|la|los|las|my|the)$/.test(ws[0])) ws.shift();
  const nombre: string[] = [];
  for (const w of ws) {
    if (CORTA_NOMBRE.has(w) || nombre.length >= 3) break;
    nombre.push(w);
  }
  const d = nombre.join(' ').trim();
  return d && !NO_NOMBRE.test(d) ? d : null;
}

/**
 * ¿La respuesta propone mandar un WhatsApp con su texto, sin la herramienta? Devuelve a quién y qué (para pedir
 * `whatsapp responder`), o null. `hilo`: lo hablado (de ahí sale a quién, si la respuesta no lo dice).
 */
export function propuestaDeEnvio(dicho: string, o: { mensaje?: string; hilo?: ReadonlyArray<{ role: string; content: string }> } = {}): PropuestaEnvio | null {
  const t = String(dicho || '').replace(/^\s*(ACCION_APP|PEDIR_HERRAMIENTA)\s*:.*$/gim, ' ');
  const cita = CITA.exec(t);
  if (!cita) return null;
  const texto = cita[1].replace(/^\*+|\*+$/g, '').trim();
  if (texto.length < 2) return null;
  const sinCita = sinCitas(t);
  if (!PREGUNTA_ENVIO.test(plano(sinCita))) return null;
  // Un correo se arma con su dirección y su asunto: eso lo hace el modelo con la herramienta (aquí no se adivina).
  const recientes = [o.mensaje || '', ...[...(o.hilo || [])].reverse().filter((m) => m.role === 'user').slice(0, 6).map((m) => m.content)];
  const deCorreo = (x: string) => /\b(correo|mail|email|e-mail)\b/i.test(plano(x)) && !/\bwhats\w*|\bwasap\b/i.test(plano(x));
  if (deCorreo(sinCita) || deCorreo(recientes.find((x) => /\b(mand|envi|escrib)\w*/.test(plano(x))) || '')) return null;
  const destino = destinoEnRespuesta(sinCita) || recientes.map(destinoPedido).find((d): d is string => !!d) || null;
  if (!destino) return null;
  return { canal: 'whatsapp', destino, texto };
}

/** ¿Es el mismo texto del borrador que ya espera? (entonces la respuesta solo pregunta por él: ya tiene su tarjeta). */
export function mismoTextoBorrador(espera: string | undefined, propuesto: string): boolean {
  const n = (x: string) => plano(x).replace(/[^a-z0-9ñ]+/g, ' ').trim();
  return !!espera && n(espera) === n(propuesto);
}
