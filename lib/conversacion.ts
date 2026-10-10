/**
 * Hilo por miembro: corto (mensajes reales a Qwen), mediano (texto), largo (hechos).
 * «esto/hazlo» apunta al último tema o URL. Si no está en el cerebro, se busca en internet.
 */

import { consultaWeb } from '../src/06-manos/web';
import { padron } from './acceso';
import { listaDeEnv } from './datos-privados';

export type TurnoHilo = { rol: string; texto: string };
export type MsgHilo = { role: 'user' | 'assistant'; content: string };
export type PedidoRed = { query: string; leer?: string };

function fold(s: string) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function extraerUrls(texto: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (raw: string) => {
    let u = String(raw || '').replace(/[.,;:!?)\]>'"]+$/g, '');
    if (/^github\.com\//i.test(u)) u = 'https://' + u;
    if (!/^https?:\/\//i.test(u)) return;
    if (seen.has(u)) return;
    seen.add(u);
    out.push(u);
  };
  const re = /https?:\/\/[^\s)\]>'"]+/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(String(texto || '')))) push(m[0]);
  const gh = String(texto || '').match(/\bgithub\.com\/[\w.-]+\/[\w.-]+/gi) || [];
  for (const g of gh) push(g);
  return out;
}

/** README crudo de un repo GitHub, además de la página. */
export function urlsParaLeer(url: string): string[] {
  const u = String(url || '').replace(/\/+$/, '');
  const gh = u.match(/^https?:\/\/github\.com\/([\w.-]+)\/([\w.-]+)(?:\/|$)/i);
  if (!gh) return u ? [u] : [];
  const repo = `https://github.com/${gh[1]}/${gh[2]}`;
  return [
    repo,
    `https://raw.githubusercontent.com/${gh[1]}/${gh[2]}/main/README.md`,
    `https://raw.githubusercontent.com/${gh[1]}/${gh[2]}/master/README.md`,
  ];
}

/** Un nombre del padrón como palabra de una expresión (sin acentos, en minúsculas, sin nada que la rompa). */
const palabra = (t: string) => fold(t).replace(/[^a-z0-9 ]/g, '').trim();

export function esSaludoCorto(message: string): boolean {
  const q = fold(message);
  // «hola, José»: los nombres de la junta salen del padrón (en el entorno, no en el repo público).
  const nombres = ['jefe', ...padron().filter((p) => p.acceso.ultron).map((p) => palabra(p.nombre).split(' ')[0])].filter(Boolean);
  const ok = /^(hola|buenas( tardes| dias| noches)?|buen dia|que tal|como estas|hey|ey)( [a-z0-9]+)?[ .!?]*$/.exec(q);
  if (!ok) return false;
  const quien = (ok[3] || '').trim();
  return !quien || nombres.includes(quien);
}

export function esInterno(message: string): boolean {
  const q = fold(message);
  if (!q) return true;
  if (esSaludoCorto(message)) return true;
  if (/^(gracias|ok|vale|jaja|listo|de acuerdo|duerme|despierta)[ .!]*$/.test(q)) return true;
  if (/\b(recuerda que|anota que|olvidate|olvida que)\b/.test(q)) return true;
  if (/^(modo |canta |sable|blaster|pium)/.test(q)) return true;
  if (/^(que hora|que dia|ayuda|comandos)\b/.test(q)) return true;
  return false;
}

/**
 * «Sí, hazlo», «dale», «revisa eso»: sigue con lo último del hilo. Con límite de palabra y sin
 * despedidas ni negaciones: «buenos días», «bueno, gracias», «claro que no» o «siempre me pasa eso»
 * no son un «sí» (1-oct: lanzaban una búsqueda web con la última frase de AU-RA como consulta).
 */
export function esContinuacion(message: string): boolean {
  const q = fold(message);
  if (!q) return false;
  if (/\b(no|gracias|buen[oa]s? (dias|tardes|noches)|adios|chao|hasta luego)\b/.test(q)) return false;
  if (/^(si|dale|ok|okay|vale|hazlo|procede|adelante|claro|bueno|listo)\b/.test(q) && q.length < 120) return true;
  return (
    q.length < 280 &&
    (/\b(ese codigo|el codigo|el repo|el readme|la pagina|el enlace|el link|el proyecto|el objeto)\b/.test(q) ||
      /\b(revisa|analiza|descarga|lee|abre|mira|busca|investiga)(lo|la)?( (mas )?(a )?profund[oa])? (esto|eso|ese|esa|aquello)\b/.test(q) ||
      /\b(analizalo|descargalo|revisalo|revisa profundo|a fondo)\b/.test(q))
  );
}

/** Preguntas a AU-RA sobre sí mismo o sobre la relación: se contestan como persona, sin internet. */
export function esSobreUltron(message: string): boolean {
  const q = fold(message);
  return (
    /\b(como (estas|andas|amaneciste|te sentis|te va|dormiste|vas)|que (sentis|opinas de mi|te parece que|tal (estas|andas))|estas (bien|cansad|triste|content|enojad)|te (gusta|cae|molesta|aburr)|quien (eres|sos)|que (eres|sos)|tu (nombre|voz|cara|dia)|sos (humano|robot|real)|me (queres|extranaste)|tenes (miedo|sentimientos|hambre|sueno))\b/.test(q) ||
    /\b(ultron|aura|vos|tu|te|contigo)\b/.test(q) && /\b(como|que|por que)\b/.test(q) && q.length < 70 && !/\b(precio|noticia|busca|quien es|que es)\b/.test(q)
  );
}

/** Temas que ya viven en el cerebro de Orden Global: primero se contesta con lo que consta; el 27B pide web si le falta. */
export function esTemaOG(message: string): boolean {
  const q = fold(message);
  if (/\b(5550|origen|auka|agka|ondk|mnka|orden ?global|genesis|veta|ordenex|aucorp|au corp|prospera|junta|bo?veda|gramin|besu|qbft|ordenscan|mytokenpay|pulse2chat|kiri|danli|choluteca|inhgeomin)\b/.test(q)) return true;
  // Los nombres de la junta que son «tema de Orden Global» (AURA_NOMBRES_TEMA_OG, por comas; fuera del repo público).
  return listaDeEnv('AURA_NOMBRES_TEMA_OG', 'preguntar por alguien de la junta por su nombre ya no se contesta solo con el cerebro')
    .map(palabra)
    .filter(Boolean)
    .some((n) => new RegExp(`\\b${n}\\b`).test(q));
}

export function esPreguntaExterna(message: string): boolean {
  if (esInterno(message)) return false;
  if (esSobreUltron(message)) return false;
  const q = fold(message);
  // «busca en mis chats…»: eso lo busca el teléfono en PULSE2CHAT (lib/manos-app.ts), no internet.
  if (/\b(en|in) (los |mis |my )?(chats?|mensajes|conversaciones|messages)\b/.test(q)) return false;
  if (esTemaOG(message) && !consultaWeb(message)) return false;
  if (/\b(precio|spot).*\b(oro|plata|xau|xag|lempira|hnl)\b|\b(oro|plata|lempira|hnl).*\b(precio|spot|tipo de cambio)\b/.test(q)) {
    return false;
  }
  if (consultaWeb(message)) return true;
  if (
    /\b(quien (es|fue|creo)|que (es|fue|hace|dijo|significa)|donde (esta|queda|vive)|cuando (salio|paso|es)|cual es|como (se|funciona|instalo)|github|repo|readme|noticias|version de|que hay de|busca|investiga)\b/.test(
      q
    )
  ) {
    return true;
  }
  if (/\?/.test(message) && q.length > 18) return true;
  return false;
}

function ultimoTema(hilo: TurnoHilo[]): { tema: string; url?: string } {
  const urls: string[] = [];
  let tema = '';
  for (let i = hilo.length - 1; i >= 0; i--) {
    const t = String(hilo[i]?.texto || '').trim();
    if (!t) continue;
    for (const u of extraerUrls(t)) if (!urls.includes(u)) urls.push(u);
    if (!tema && t.length > 24) tema = t.replace(/\s+/g, ' ').slice(0, 220);
    if (urls.length && tema) break;
  }
  return { tema, url: urls[0] };
}

/** Si no está en el cerebro (hechos OG / memoria), hay que ir a internet. */
export function pedidoRed(message: string, hilo: TurnoHilo[] = []): PedidoRed | null {
  const explicit = consultaWeb(message);
  const urlsMsg = extraerUrls(message);
  if (explicit) return { query: explicit, leer: urlsMsg[0] };
  if (urlsMsg.length) return { query: String(message).replace(/\s+/g, ' ').slice(0, 160), leer: urlsMsg[0] };

  const prev = ultimoTema(hilo);
  if (esContinuacion(message) && (prev.url || prev.tema)) {
    return { query: prev.tema || prev.url || message, leer: prev.url };
  }
  if (esPreguntaExterna(message)) {
    return { query: String(message).replace(/[?¿.!]+$/g, '').trim().slice(0, 160), leer: prev.url };
  }
  return null;
}

/** Reescribe «esto/hazlo» con el objeto del hilo para que Qwen no pida el archivo otra vez. */
export function resolverReferencia(message: string, hilo: TurnoHilo[] = []): string {
  const q = String(message || '').trim();
  if (!q || !esContinuacion(q)) return q;
  const prev = ultimoTema(hilo);
  if (!prev.url && !prev.tema) return q;
  const objeto = prev.url ? prev.url : prev.tema;
  return `${q}\n\n[HILO: «esto» es lo último que hablamos: ${objeto}. No pidas el enlace ni el archivo otra vez. Si hay URL, léela y analiza a fondo. Si no, busca el proyecto en internet y revisa el README.]`;
}

export function fusionarHilo(opts: {
  durable?: TurnoHilo[];
  cliente?: TurnoHilo[];
  mensaje: string;
  max?: number;
  /** Caracteres por mensaje (la voz usa menos: cada ficha es tiempo antes de hablar). */
  maxCaracteres?: number;
  /**
   * Caracteres de los últimos mensajes (los 2 últimos de AU-RA y los 2 últimos de la persona): lo que se acaba de decir
   * no se corta a media frase (auditoría del 10-oct: en la voz, 600 cortaban la oferta que su «sí» contestaba). Nunca
   * menos que `maxCaracteres`.
   */
  maxCaracteresRecientes?: number;
  /**
   * Lo que SÍ contestó en turnos cuya respuesta no quedó en la memoria (una herramienta incierta o parcial, AUR07; una
   * respuesta cortada): `respuestasSinMemoria`. Va en su lugar del hilo, así esas frases no salen como «sin respuesta».
   */
  respondidas?: readonly RespuestaSinMemoria[];
}): MsgHilo[] {
  const durable = opts.durable || [];
  const cliente = opts.cliente || [];
  const src = durable.length >= 2 ? durable : [...cliente, ...durable];
  const tope = opts.maxCaracteres ?? 1800;
  const topeReciente = Math.max(tope, opts.maxCaracteresRecientes ?? tope);
  // Se arma con el texto hasta el tope de los recientes; al final, cada uno con su tope (viejo o reciente).
  const msgs: MsgHilo[] = [];
  for (const t of src.slice(-(opts.max ?? 16))) {
    const content = String(t.texto || '').trim().slice(0, topeReciente);
    if (!content) continue;
    const role: 'user' | 'assistant' = t.rol === 'ultron' || t.rol === 'assistant' ? 'assistant' : 'user';
    msgs.push({ role, content });
  }
  const corto = (x: string) => x.slice(0, tope);
  // Revisión independiente (7-oct, M3): la respuesta que sí dio y no quedó en la memoria vuelve a su lugar (detrás de la
  // frase que contestó, si no tiene ya una respuesta): esa frase no estaba «sin respuesta».
  const respondidas = [...(opts.respondidas || [])];
  if (respondidas.length) {
    for (let k = 0; k < msgs.length; k++) {
      if (msgs[k].role !== 'user' || msgs[k + 1]?.role === 'assistant') continue;
      const j = respondidas.findIndex((r) => String(r.dijo || '').trim().slice(0, tope) === corto(msgs[k].content));
      if (j < 0) continue;
      msgs.splice(k + 1, 0, { role: 'assistant', content: String(respondidas[j].respuesta || '').trim().slice(0, topeReciente) });
      respondidas.splice(j, 1);
      k++;
    }
  }
  const actual = String(opts.mensaje || '').trim().slice(0, tope);
  if (msgs.length && msgs[msgs.length - 1].role === 'user' && corto(msgs[msgs.length - 1].content) === actual) {
    msgs.pop();
  }
  // Cada uno con su tope: los 2 últimos de cada lado, el de los recientes; los demás, el de siempre.
  const vistos = { user: 0, assistant: 0 };
  for (let k = msgs.length - 1; k >= 0; k--) {
    const reciente = ++vistos[msgs[k].role] <= 2;
    if (!reciente) msgs[k] = { ...msgs[k], content: corto(msgs[k].content) };
  }
  // Las frases suyas del final que quedaron sin respuesta de AU-RA, antes de la de ahora (José, 7-oct): van juntas y
  // marcadas como de antes, no sueltas (sin mensaje de ahora, como para precalentar, el hilo queda tal cual).
  let i = msgs.length;
  while (i > 0 && msgs[i - 1].role === 'user') i--;
  if (actual && i < msgs.length) msgs.splice(i, msgs.length - i, { role: 'user', content: notaSinRespuesta(msgs.slice(i).map((m) => corto(m.content))) });
  return msgs;
}

/* ------------------------------------------------------------------ lo que contestó sin quedar en la memoria */

export type RespuestaSinMemoria = { dijo: string; respuesta: string; t: number };
/** Cuánto vale (la sesión de la mesa) y cuántas por persona. */
export const SIN_MEMORIA_MS = 3 * 3600_000;
const TOPE_SIN_MEMORIA = 20;
const sinMemoria = new Map<string, RespuestaSinMemoria[]>();

/**
 * Revisión independiente (7-oct, M3): un turno CONTESTÓ pero su respuesta no va a la memoria como conclusión (una
 * herramienta incierta o con datos parciales, AUR07; una respuesta cortada). Se anota aquí (en el proceso, no en su
 * memoria larga) para que el hilo sepa que esa frase sí tuvo respuesta y cuál fue.
 */
export function anotarRespuestaSinMemoria(clave: string, dijo: string, respuesta: string, ahora = Date.now()) {
  const k = String(clave || '').trim().toLowerCase();
  if (!k || !String(dijo || '').trim() || !String(respuesta || '').trim()) return;
  const xs = (sinMemoria.get(k) || []).filter((r) => ahora - r.t <= SIN_MEMORIA_MS);
  xs.push({ dijo: String(dijo).trim(), respuesta: String(respuesta).trim(), t: ahora });
  sinMemoria.delete(k);
  sinMemoria.set(k, xs.slice(-TOPE_SIN_MEMORIA));
  if (sinMemoria.size > 5000) sinMemoria.delete(sinMemoria.keys().next().value as string);
}

/** Las respuestas sin memoria de esa persona, vigentes (de la más vieja a la más nueva). */
export function respuestasSinMemoria(clave: string, ahora = Date.now()): RespuestaSinMemoria[] {
  return (sinMemoria.get(String(clave || '').trim().toLowerCase()) || []).filter((r) => ahora - r.t <= SIN_MEMORIA_MS);
}

/** Solo pruebas. */
export function _olvidarRespuestasSinMemoria() {
  sinMemoria.clear();
}

/**
 * LAS FRASES QUE QUEDARON SIN RESPUESTA (José, 7-oct, 00:31–00:33 UTC). Sus frases «Necesito que cambies a Claudio»
 * (mal oída) y «¿Qué tenemos pendiente?» quedaron en el hilo sin respuesta de AU-RA. Bedrock junta los mensajes seguidos
 * del mismo lado (lib/cerebro-rapido.ts aBedrock), así que el modelo recibía «cambies a Claudio… ¿qué tenemos
 * pendiente?… ¿Qué cambiaste, Claudio?» como UN mensaje y contestaba a la primera: «Ahí va, ya me pongo en Claudio» un
 * minuto tarde. Ahora esas frases van juntas y marcadas como de antes, y lo de ahora va claro al final.
 *
 * Revisión independiente (7-oct, G2): la nota decía «ya pasó: no lo contestes ni hagas lo que pedía», así que una
 * pregunta cortada por otra frase se perdía (y un «sí» a un envío no podía reintentarse). Ahora va como parte del pedido
 * nuevo: «antes dijo X; ahora dice Y», y se contesta lo que corresponda a las dos (si lo de ahora lo corrige, vale lo de
 * ahora). Lo único que sí se descarta es una orden de CAMBIO DE AVATAR tardía (la regla del 7-oct): eso no se hace ni se
 * pregunta por lo de antes (y el servidor tampoco lo empuja: server.ts accionesDelCerebro).
 */
export function notaSinRespuesta(frases: string[]): string {
  const limpias = frases.map((f) => String(f || '').replace(/\s+/g, ' ').trim()).filter(Boolean);
  const avatar = limpias.filter((f) => esOrdenDeAvatar(f));
  const resto = limpias.filter((f) => !esOrdenDeAvatar(f));
  const cita = (xs: string[]) => xs.map((f) => `«${f}»`).join(' · ');
  const partes: string[] = [];
  if (resto.length)
    partes.push(
      `Antes dijo esto y todavía no le contestaste: ${cita(resto)}. Ahora dice lo que sigue: contesta lo que corresponda a todo junto (si lo de ahora lo cambia o lo corrige, vale lo de ahora; si es otra cosa, contesta también lo de antes, breve).`
    );
  if (avatar.length) partes.push(`${MARCA_AVATAR_ATRAS} (${cita(avatar)}) quedó atrás: no lo hagas ni lo preguntes por eso.`);
  return `(${partes.join(' ')})`;
}

const MARCA_AVATAR_ATRAS = 'Lo de cambiar de avatar';

/** ¿El último mensaje de la persona en el hilo lleva una orden de avatar que quedó atrás? (server.ts no la retoma). */
export function avatarQuedoAtras(hilo: readonly MsgHilo[]): boolean {
  const u = hilo[hilo.length - 1];
  return !!u && u.role === 'user' && u.content.startsWith('(') && u.content.includes(MARCA_AVATAR_ATRAS);
}

/** «Cambia a Claudio», «necesito que me pases con AU-RA»: una orden de cambiar de avatar (para la nota de arriba). */
export function esOrdenDeAvatar(frase: string): boolean {
  const q = fold(frase);
  return /\b(cambi\w*|pasa(me|r|rme)?|pases|pon(me|er|gas)?|switch|change|swap|quiero hablar con)\b/.test(q) && /\b(claudio|aura|au-ra|au ra|antonio|ant-onio|guardian|avatar)\b/.test(q);
}

/**
 * Qué va en el bloque de memoria del prompt (lib/memoria.ts, lib/memoria-miembro.ts):
 *   · 'todo'    — todo: la memoria larga, el hilo corto y la conversación mediana (lo de siempre).
 *   · 'mediano' — sin el hilo corto: el turno ya manda el hilo como mensajes (server.ts), y el corto
 *                 repetido dentro del system cambiaba en cada turno y obligaba al nodo a releerlo todo.
 *   · 'firma'   — lo que, si cambia, obliga a rehacer el system a media conversación
 *                 (server/prompt-turno.ts fijoDeLaConversacion): con quién habla, su acceso y lo que
 *                 pidió recordar a propósito. Lo que se guarda solo por nombrar «la mina» o «la junta»
 *                 no entra: pasa en muchos turnos, y lo dicho en la conversación ya está en los mensajes.
 */
export type HiloMemoria = 'todo' | 'mediano' | 'firma';

export function capasHilo(corta: TurnoHilo[]): { corto: string; mediano: string } {
  const items = (corta || []).filter((t) => String(t.texto || '').trim());
  const cortoItems = items.slice(-8);
  const medianoItems = items.slice(-40, -8);
  const linea = (t: TurnoHilo) => `${t.rol === 'ultron' || t.rol === 'assistant' ? 'AU-RA' : 'Junta'}: ${String(t.texto).replace(/\s+/g, ' ').slice(0, 400)}`;
  return {
    corto: cortoItems.map(linea).join('\n'),
    mediano: medianoItems.map(linea).join('\n'),
  };
}
