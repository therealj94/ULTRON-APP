/**
 * Hilo por miembro: corto (mensajes reales a Qwen), mediano (texto), largo (hechos).
 * «esto/hazlo» apunta al último tema o URL. Si no está en el cerebro, se busca en internet.
 */

import { consultaWeb } from '../src/06-manos/web';

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

export function esSaludoCorto(message: string): boolean {
  const q = fold(message);
  return /^(hola|buenas( tardes| dias| noches)?|buen dia|que tal|como estas|hey|ey)( jefe| jose| medardo| carlos| mayra)?[ .!?]*$/.test(q);
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

export function esContinuacion(message: string): boolean {
  const q = fold(message);
  if (!q) return false;
  if (
    /^(si|dale|ok|vale|hazlo|hazlo vos|procede|adelante|claro|bueno|si hacerlo|si,? haz|si, hacerlo)/.test(q) &&
    q.length < 240
  ) {
    return true;
  }
  return (
    q.length < 280 &&
    /\b(esto|eso|ese codigo|el codigo|el repo|el readme|la pagina|el enlace|el link|el proyecto|profund[oa]|descarga(lo| el codigo)?|analiza(lo)?|revisa (esto|eso|el|la|lo|profundo)|el objeto)\b/.test(q)
  );
}

/** Preguntas a AU-RA sobre sí mismo o sobre la relación: se contestan como persona, sin internet. */
export function esSobreUltron(message: string): boolean {
  const q = fold(message);
  return (
    /\b(como (estas|andas|amaneciste|te sentis|te va|dormiste|vas)|que (sentis|opinas de mi|te parece que|tal (estas|andas))|estas (bien|cansad|triste|content|enojad)|te (gusta|cae|molesta|aburr)|quien (eres|sos)|que (eres|sos)|tu (nombre|voz|cara|dia)|sos (humano|robot|real)|me (queres|extranaste)|tenes (miedo|sentimientos|hambre|sueno))\b/.test(q) ||
    /\b(ultron|vos|tu|te|contigo)\b/.test(q) && /\b(como|que|por que)\b/.test(q) && q.length < 70 && !/\b(precio|noticia|busca|quien es|que es)\b/.test(q)
  );
}

/** Temas que ya viven en el cerebro de Orden Global: primero se contesta con lo que consta; el 27B pide web si le falta. */
export function esTemaOG(message: string): boolean {
  const q = fold(message);
  return /\b(5550|origen|auka|agka|ondk|mnka|orden ?global|genesis|veta|ordenex|aucorp|au corp|prospera|medardo|melany|paguada|mayra|junta|bo?veda|gramin|besu|qbft|ordenscan|mytokenpay|pulse2chat|kiri|danli|choluteca|inhgeomin)\b/.test(q);
}

export function esPreguntaExterna(message: string): boolean {
  if (esInterno(message)) return false;
  if (esSobreUltron(message)) return false;
  const q = fold(message);
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
}): MsgHilo[] {
  const durable = opts.durable || [];
  const cliente = opts.cliente || [];
  const src = durable.length >= 2 ? durable : [...cliente, ...durable];
  const msgs: MsgHilo[] = [];
  for (const t of src.slice(-(opts.max ?? 16))) {
    const content = String(t.texto || '').trim().slice(0, 1800);
    if (!content) continue;
    const role: 'user' | 'assistant' = t.rol === 'ultron' || t.rol === 'assistant' ? 'assistant' : 'user';
    msgs.push({ role, content });
  }
  const actual = String(opts.mensaje || '').trim().slice(0, 1800);
  if (msgs.length && msgs[msgs.length - 1].role === 'user' && msgs[msgs.length - 1].content === actual) {
    msgs.pop();
  }
  return msgs;
}

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
