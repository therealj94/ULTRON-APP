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

/*
 * Revisión independiente del 6-oct (M2): el borrador convertido elegía destino y texto equivocados. «Juan te escribió
 * «¿llegas hoy?». ¿Le mando un mensaje…?» armaba un borrador para «viejo» (de un pedido de cinco turnos atrás) con las
 * palabras de Juan; «Tu mamá dijo «compra pan». ¿Te lo anoto o le escribo algo?», uno para Pedro; «¿Te mando el resumen
 * así? «Oro 2400…»» (el «te» es la persona), uno para Carlos; y «no, mejor dile que llego a las 9» daba el destino «9»
 * (que server/whatsapp.ts buscarChat toma como el número de la lista). Ahora solo se convierte lo inequívoco:
 *  · la cita es lo que AU-RA propone mandarle a alguien («¿Le escribo esto? «…»», «¿Le escribo a X: «…»?», «Le escribo
 *    a X: «…». ¿Lo envío?»), nunca lo que otro escribió o dijo («X te escribió / dijo «…»»);
 *  · el verbo va a un tercero («le / se lo»), nunca «te mando / te escribo» (la persona misma);
 *  · a quién: nombrado en la MISMA propuesta o en el último pedido de envío de la persona (de las últimas tres frases
 *    suyas, con solo preguntas de AU-RA en medio: el mismo hilo), nunca un número suelto. Ante la duda, null.
 */

/** Lo citado: «…», "…", “…” (con o sin *énfasis*). */
const CITA = /[«"“]\s*\*?([^»"”\n]{2,600}?)\*?\s*[»"”]/;
/** Los verbos de mandarle algo A UN TERCERO («le escribo», «se lo mando», «les envío»); «te mando» es a la persona. */
const A_TERCERO = String.raw`\b(?:le|les|se lo|se la|se los|se las)\s+(?:escribo|escribi|mando|mande|envio|envie|digo|pongo|redacte|prepare|dejo)\b`;
/** La pregunta que propone mandarle a un tercero lo que viene citado justo después («¿Le escribo esto?» + «…»). */
const PREGUNTA_ANTES = new RegExp(String.raw`¿[^¿?]*${A_TERCERO}[^¿?]*\?[\s*:]*$`);
/** La pregunta que lleva la cita dentro («¿Le escribo a Ana: «…»?»): lo de antes de la cita. */
const PREGUNTA_ABIERTA = new RegExp(String.raw`¿[^¿?]*${A_TERCERO}[^¿?]*$`);
/** La declaración que la presenta («Le escribo a Rosa:», «Le escribí a Rosa Mejía:»), con su pregunta de aprobación después. */
const DECLARA = new RegExp(String.raw`${A_TERCERO}[^.?!¿«"“]{0,60}:[\s*]*$`);
const APRUEBA_DESPUES = /^[\s*.]*¿[^?]*\b((se |le )?(lo|la) (envio|mando|mandamos|enviamos)|te parece( bien)?|(asi )?(esta|queda) bien|send it)\b[^?]*\?/;
/** Lo que otro escribió, dijo o mandó (la cita es SUYA, no lo que AU-RA propone): «Juan te escribió», «Tu mamá dijo». */
// Con sus tildes: «mandó / envió» (de otro) no es «mando / envío» (AU-RA, «¿Le mando esto a Ana?»).
const DE_OTRO = /(?<![\p{L}])(escribió|dijo|dice|decía|mandó|envió|respondió|contestó|preguntó|pregunta|comentó|avisó|puso|reenvió|wrote|said|says|texted|asked)(?![\p{L}])/iu;
const DE_OTRO_DESPUES = /^[\s,*»"”]*(te |me |nos |le )?(escribió|dijo|dice|mandó|envió|respondió|contestó|preguntó|wrote|said|texted|asked)(?![\p{L}])/iu;
/** Lo que pide a la persona mandar algo a alguien («mándale», «escríbele a», «dile», "text Ana"). */
const PIDE_ENVIO = /\b(mand|envi|escrib|reenvi|contest|respond)\w*|\b(dile|digale|decile|diles|avisale|avisele|preguntale|preguntele)\b|\b(send|text|message|write|tell)\b/;
/** Palabras que cortan un nombre dicho por la persona («a mi viejo por WhatsApp que…»). */
const CORTA_NOMBRE = new Set('por que de del en con y para ahora hoy manana whatsapp wasap correo mensaje mensajito un una el la lo le ya pues porfa favor si no como cuando on via that saying please'.split(' '));
/** Lo que no es un nombre de contacto (canal, relleno). */
const NO_NOMBRE = /^(whatsapp|pulse2chat|gmail|outlook|correo|mensaje)$/i;
/** Un destino de verdad: con letras y sin cifras («9», «las 9» no: buscarChat lo tomaría como el número de la lista). */
const esNombre = (d: string | null | undefined): d is string => !!d && /\p{L}{2,}/u.test(d) && !/\d/.test(d) && !NO_NOMBRE.test(d);

/** El nombre propio (con mayúscula) detrás de «a» / «para» en la propuesta misma (fuera de lo citado). */
function destinoEnPropuesta(marco: string): string | null {
  const re = /\b(?:a|para)\s+((?:[A-ZÁÉÍÓÚÑ][\p{L}]+)(?:\s+[A-ZÁÉÍÓÚÑ][\p{L}]+){0,3})/gu;
  for (let m = re.exec(marco); m; m = re.exec(marco)) {
    const d = m[1].replace(/\s+(WhatsApp|Gmail|Outlook)$/u, '').trim();
    if (esNombre(d)) return d;
  }
  return null;
}

/**
 * A quién pidió la persona mandarlo, en sus palabras («mándele un mensaje a mi viejo por WhatsApp» → «viejo»). Sin el
 * posesivo («mi», «mis», «tu», «su»): la herramienta busca el contacto por su nombre. Solo antes de lo que hay que decir
 * («dile QUE llego a las 9» no tiene a quién: el «a las 9» es del recado).
 */
export function destinoPedido(mensaje: string): string | null {
  const p = plano(mensaje).replace(/[¿?¡!.,;:\-–—]/g, ' ').replace(/\s+/g, ' ');
  const verbo = /\b(?:send|text|message|tell|write)\w*\b/.exec(p) || /\b(?:mand|envi|escrib|dile|digale|decile|pregunt|avis|contest|respond)\w*\b/.exec(p);
  if (!verbo) return null;
  const tras = p.slice(verbo.index).split(/\b(?:que|si|diciendo|saying|that)\b/)[0];
  const m = /\bto\s+(.+)$/.exec(tras) || /\b(?:a|para)\s+(.+)$/.exec(tras.replace(/^\S+/, ''));
  if (!m) return null;
  const ws = m[1].split(' ').filter(Boolean);
  while (ws.length && /^(mi|mis|tu|tus|su|sus|el|la|los|las|my|the)$/.test(ws[0])) ws.shift();
  const nombre: string[] = [];
  for (const w of ws) {
    if (CORTA_NOMBRE.has(w) || nombre.length >= 3) break;
    nombre.push(w);
  }
  const d = nombre.join(' ').trim();
  return esNombre(d) ? d : null;
}

/**
 * El último pedido de envío de la persona en este hilo: `mensaje` y, hacia atrás, sus frases del hilo (hasta tres en total),
 * pasando solo por preguntas de AU-RA («¿Qué le querés decir?»). Una respuesta de AU-RA que no pregunta cierra el hilo.
 */
function pedidoDelHilo(mensaje: string | undefined, hilo: ReadonlyArray<{ role: string; content: string }>): string | null {
  const suyas: string[] = [];
  if (String(mensaje || '').trim()) suyas.push(String(mensaje));
  for (let i = hilo.length - 1; i >= 0 && suyas.length < 3; i--) {
    const m = hilo[i];
    if (m.role === 'user') suyas.push(m.content);
    else if (!/[¿?]/.test(sinCitas(m.content))) break;
  }
  for (const x of suyas) {
    if (!PIDE_ENVIO.test(plano(x))) continue;
    const d = destinoPedido(x);
    if (d) return d;
  }
  return null;
}

/**
 * ¿La respuesta propone mandar un WhatsApp con su texto, sin la herramienta? Devuelve a quién y qué (para pedir
 * `whatsapp responder`), o null. `hilo`: lo hablado (de ahí sale a quién, si la propuesta no lo dice).
 */
export function propuestaDeEnvio(dicho: string, o: { mensaje?: string; hilo?: ReadonlyArray<{ role: string; content: string }> } = {}): PropuestaEnvio | null {
  const t = String(dicho || '').replace(/^\s*(ACCION_APP|PEDIR_HERRAMIENTA)\s*:.*$/gim, ' ');
  const cita = CITA.exec(t);
  if (!cita) return null;
  const texto = cita[1].replace(/^\*+|\*+$/g, '').trim();
  if (texto.length < 2) return null;
  const sinCita = sinCitas(t);
  // Lo de antes de la cita, desde donde empieza su frase o su pregunta; y lo de después.
  const antesTodo = sinCita.slice(0, cita.index);
  const pegado = antesTodo.replace(/[\s*:]+$/, '');
  // Si lo de antes es una pregunta cerrada («¿Le escribo esto?»), desde su «¿»; si no, desde el fin de la frase anterior.
  const ini = pegado.endsWith('?') ? pegado.lastIndexOf('¿') : Math.max(...['.', '!', '?', '\n'].map((c) => pegado.lastIndexOf(c))) + 1;
  const marco = antesTodo.slice(Math.max(0, ini));
  const antes = plano(marco);
  const despues = plano(sinCita.slice(cita.index + cita[0].length));
  // La cita es de otro («Juan te escribió», «Tu mamá dijo», «"…", me dijo Ana»): nunca es lo que AU-RA propone mandar.
  if (DE_OTRO.test(antesTodo) || DE_OTRO_DESPUES.test(sinCita.slice(cita.index + cita[0].length))) return null;
  const propone = PREGUNTA_ANTES.test(antes) || (PREGUNTA_ABIERTA.test(antes) && /^[^¿]*\?/.test(despues)) || (DECLARA.test(antes) && APRUEBA_DESPUES.test(despues));
  if (!propone) return null;
  // Un correo se arma con su dirección y su asunto: eso lo hace el modelo con la herramienta (aquí no se adivina).
  const recientes = [o.mensaje || '', ...[...(o.hilo || [])].reverse().filter((m) => m.role === 'user').slice(0, 2).map((m) => m.content)];
  const deCorreo = (x: string) => /\b(correo|mail|email|e-mail)\b/i.test(plano(x)) && !/\bwhats\w*|\bwasap\b/i.test(plano(x));
  if (deCorreo(sinCita) || deCorreo(recientes.find((x) => PIDE_ENVIO.test(plano(x))) || '')) return null;
  const destino = destinoEnPropuesta(marco) || pedidoDelHilo(o.mensaje, o.hilo || []);
  if (!esNombre(destino)) return null;
  return { canal: 'whatsapp', destino, texto };
}

/** ¿Es el mismo texto del borrador que ya espera? (entonces la respuesta solo pregunta por él: ya tiene su tarjeta). */
export function mismoTextoBorrador(espera: string | undefined, propuesto: string): boolean {
  const n = (x: string) => plano(x).replace(/[^a-z0-9ñ]+/g, ' ').trim();
  return !!espera && n(espera) === n(propuesto);
}
