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
    /^(si|dale|ok|vale|hazlo|hazlo vos|procede|adelante|claro|bueno|sigue|continua|mas|explica|por que|entonces|y eso|y eso\?|y\?|si hacerlo|si,? haz|si, hacerlo)/.test(q) &&
    q.length < 240
  ) {
    return true;
  }
  if (q.length < 80 && /^(y |e |entonces |pero |ok |vale |si |mas |sigue |continua )/.test(q)) {
    return true;
  }
  return (
    q.length < 280 &&
    /\b(esto|eso|ese codigo|el codigo|el repo|el readme|la pagina|el enlace|el link|el proyecto|profund[oa]|descarga(lo| el codigo)?|analiza(lo)?|revisa (esto|eso|el|la|lo|profundo)|el objeto|lo de antes|el mismo|sigue|continua|mas detalle)\b/.test(
      q
    )
  );
}

export function esPreguntaExterna(message: string): boolean {
  if (esInterno(message)) return false;
  const q = fold(message);
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

export function ultimoTema(hilo: TurnoHilo[]): { tema: string; url?: string } {
  const urls: string[] = [];
  let tema = '';
  for (let i = hilo.length - 1; i >= 0; i--) {
    const t = String(hilo[i]?.texto || '').trim();
    if (!t) continue;
    if (/^\[(HILO|RESPONDE)/.test(t)) continue;
    for (const u of extraerUrls(t)) if (!urls.includes(u)) urls.push(u);
    if (!tema && t.length > 8) tema = t.replace(/\s+/g, ' ').slice(0, 280);
    if (urls.length && tema) break;
  }
  return { tema, url: urls[0] };
}

export function hechoHilo(hilo: TurnoHilo[]): string | null {
  const t = ultimoTema(hilo);
  if (!t.tema && !t.url) return null;
  const url = t.url && t.tema && !t.tema.includes(t.url) ? ` [${t.url}]` : '';
  return `HILO ACTIVO: ${t.tema || t.url}${url}. Seguí esto. No pidas que te lo repitan.`;
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

/** Reescribe «esto/hazlo/sigue» con el objeto del hilo para que Qwen no pida el archivo otra vez. */
export function resolverReferencia(message: string, hilo: TurnoHilo[] = []): string {
  const q = String(message || '').trim();
  if (!q || !hilo.length) return q;
  if (!esContinuacion(q) && q.length > 90) return q;
  if (!esContinuacion(q) && q.length <= 90 && !/^(y |e |entonces |dale|ok|sigue|mas|explica)/i.test(fold(q))) {
    return q;
  }
  const prev = ultimoTema(hilo);
  if (!prev.url && !prev.tema) return q;
  const objeto = prev.url ? prev.url : prev.tema;
  return `${q}\n\n[HILO: seguimos con «${objeto}». No pidas el enlace ni el archivo otra vez. Si hay URL, léela. No empieces de cero.]`;
}

/** El chat de Telegram es la columna. La memoria personal rellena huecos, no la pisa. */
export function unirHilos(chat: TurnoHilo[], persona: TurnoHilo[]): TurnoHilo[] {
  const seen = new Set<string>();
  const key = (t: TurnoHilo) => `${t.rol === 'ultron' || t.rol === 'assistant' ? 'a' : 'u'}|${String(t.texto || '').replace(/\s+/g, ' ').trim().slice(0, 220)}`;
  const out: TurnoHilo[] = [];
  for (const t of [...(persona || []), ...(chat || [])]) {
    const texto = String(t?.texto || '').trim();
    if (!texto) continue;
    const k = key(t);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push({ rol: t.rol, texto });
  }
  return out;
}

export function fusionarHilo(opts: {
  durable?: TurnoHilo[];
  cliente?: TurnoHilo[];
  mensaje: string;
  max?: number;
}): MsgHilo[] {
  const durable = opts.durable || [];
  const cliente = opts.cliente || [];
  const src = cliente.length ? unirHilos(cliente, durable) : durable;
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
  const linea = (t: TurnoHilo) => `${t.rol === 'ultron' || t.rol === 'assistant' ? 'ULTRON' : 'Junta'}: ${String(t.texto).replace(/\s+/g, ' ').slice(0, 400)}`;
  return {
    corto: cortoItems.map(linea).join('\n'),
    mediano: medianoItems.map(linea).join('\n'),
  };
}
