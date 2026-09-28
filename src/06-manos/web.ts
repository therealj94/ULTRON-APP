/** Manos: búsqueda y lectura web. Funciona sin claves; con claves (Brave, Tavily) busca mejor. El 27B no vive aquí. */
import { pedirPublico } from '../../lib/red-publica';

export type WebHit = { title: string; url: string; snippet: string };

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

export function stripHtml(html: string) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/\s+/g, ' ')
    .trim();
}

async function buscarDDG(query: string, max: number): Promise<WebHit[]> {
  const r = await fetch(`https://lite.duckduckgo.com/lite/?q=${encodeURIComponent(query)}`, {
    headers: { 'User-Agent': UA, Accept: 'text/html' },
    signal: AbortSignal.timeout(5000),
  });
  const html = await r.text();
  const hits: WebHit[] = [];
  const linkRe = /<a([^>]*class=['"]result-link['"][^>]*)>([\s\S]*?)<\/a>/g;
  const snippetRe = /<td[^>]+class=['"]result-snippet['"][^>]*>([\s\S]*?)<\/td>/g;
  const links: Array<[string, string]> = [];
  let m: RegExpExecArray | null;
  while ((m = linkRe.exec(html)) && links.length < max) {
    const href = m[1].match(/href=['"]([^'"]+)['"]/)?.[1] || '';
    if (href) links.push([href.replace(/&amp;/g, '&'), stripHtml(m[2])]);
  }
  const snippets: string[] = [];
  while ((m = snippetRe.exec(html)) && snippets.length < max) snippets.push(stripHtml(m[1]));
  links.forEach(([href, title], i) => {
    let url = href;
    const uddg = href.match(/[?&]uddg=([^&]+)/);
    if (uddg) url = decodeURIComponent(uddg[1]);
    if (url.startsWith('//')) url = 'https:' + url;
    hits.push({ title, url, snippet: snippets[i] || '' });
  });
  return hits;
}

async function buscarBing(query: string, max: number): Promise<WebHit[]> {
  const r = await fetch(`https://www.bing.com/search?q=${encodeURIComponent(query)}&setlang=es&format=rss`, {
    headers: { 'User-Agent': UA, Accept: 'application/rss+xml,text/xml,*/*' },
    signal: AbortSignal.timeout(6000),
  });
  const xml = await r.text();
  const hits: WebHit[] = [];
  const itemRe = /<item>([\s\S]*?)<\/item>/g;
  let m: RegExpExecArray | null;
  while ((m = itemRe.exec(xml)) && hits.length < max) {
    const it = m[1];
    const title = stripHtml(it.match(/<title>([\s\S]*?)<\/title>/)?.[1] || '');
    const url = stripHtml(it.match(/<link>([\s\S]*?)<\/link>/)?.[1] || '');
    const snippet = stripHtml(it.match(/<description>([\s\S]*?)<\/description>/)?.[1] || '');
    if (title && url) hits.push({ title, url, snippet });
  }
  return hits;
}

async function buscarNoticias(query: string, max: number): Promise<WebHit[]> {
  const r = await fetch(
    `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=es-419&gl=HN&ceid=HN:es`,
    { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(6000), redirect: 'follow' }
  );
  const xml = await r.text();
  const hits: WebHit[] = [];
  const itemRe = /<item>([\s\S]*?)<\/item>/g;
  let m: RegExpExecArray | null;
  while ((m = itemRe.exec(xml)) && hits.length < max) {
    const it = m[1];
    const title = stripHtml(it.match(/<title>([\s\S]*?)<\/title>/)?.[1] || '');
    const source = stripHtml(it.match(/<source[^>]*>([\s\S]*?)<\/source>/)?.[1] || '');
    const sourceUrl = it.match(/<source url="([^"]+)"/)?.[1] || '';
    const pub = it.match(/<pubDate>([\s\S]*?)<\/pubDate>/)?.[1] || '';
    if (title) hits.push({ title, url: sourceUrl || 'https://news.google.com', snippet: `${source}${pub ? ' · ' + pub.slice(0, 16) : ''}` });
  }
  return hits;
}

const esNoticia = (q: string) => /\b(noticias?|hoy|[uú]ltima hora|qu[eé] pas[oó]|actualidad|titulares)\b/i.test(q);

/*
 * Con clave, los buscadores de verdad. Sin clave, los de siempre: los buscadores bloquean las IPs
 * de servidores (DuckDuckGo contesta «anomaly», Bing «Blocked»), así que ninguno es seguro solo.
 * La clave se pone en el entorno del servidor, nunca en el código.
 */
async function buscarBrave(query: string, max: number): Promise<WebHit[]> {
  const clave = String(process.env.BRAVE_SEARCH_API_KEY || '').trim();
  if (!clave) return [];
  const r = await fetch(`https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${max}&search_lang=es&safesearch=moderate`, {
    headers: { Accept: 'application/json', 'X-Subscription-Token': clave },
    signal: AbortSignal.timeout(6000),
  });
  if (!r.ok) throw new Error(`Brave ${r.status}`);
  const j: any = await r.json();
  return (j?.web?.results || []).slice(0, max).map((x: any) => ({ title: stripHtml(String(x.title || '')), url: String(x.url || ''), snippet: stripHtml(String(x.description || '')) }));
}

/*
 * Tavily: con `TAVILY_API_KEY` usa la cuenta (1 000 búsquedas al mes gratis); sin clave, su modo
 * sin llave (`X-Tavily-Access-Mode: keyless`), que busca y lee páginas con un límite de uso. Si el
 * límite contesta 429, Tavily descansa diez minutos y los demás motores siguen solos: no se gastan
 * pedidos que van a rebotar. `TAVILY_SIN_LLAVE=0` apaga el modo sin llave.
 */
const TAVILY = 'https://api.tavily.com';
let tavilyPausaHasta = 0;
function tavilyCabeceras(): Record<string, string> | null {
  const clave = String(process.env.TAVILY_API_KEY || '').trim();
  if (clave) return { 'Content-Type': 'application/json', Authorization: `Bearer ${clave}` };
  if (process.env.TAVILY_SIN_LLAVE === '0') return null;
  return { 'Content-Type': 'application/json', 'X-Tavily-Access-Mode': 'keyless' };
}
async function pedirTavily(ruta: string, cuerpo: unknown, ms: number): Promise<any | null> {
  const cabeceras = tavilyCabeceras();
  if (!cabeceras || Date.now() < tavilyPausaHasta) return null;
  const r = await fetch(`${TAVILY}${ruta}`, { method: 'POST', headers: cabeceras, body: JSON.stringify(cuerpo), signal: AbortSignal.timeout(ms) });
  if (r.status === 429 || r.status === 432 || r.status === 433) {
    tavilyPausaHasta = Date.now() + 10 * 60_000;
    throw new Error(`Tavily ${r.status}: límite, descansa 10 min`);
  }
  if (!r.ok) throw new Error(`Tavily ${r.status}`);
  return r.json();
}
/** Para las pruebas. */
export function reiniciarTavily() {
  tavilyPausaHasta = 0;
}

async function buscarTavily(query: string, max: number): Promise<WebHit[]> {
  const j = await pedirTavily('/search', { query, max_results: max, search_depth: 'basic' }, 8000);
  return (j?.results || []).slice(0, max).map((x: any) => ({ title: String(x.title || ''), url: String(x.url || ''), snippet: String(x.content || '').replace(/\s+/g, ' ').slice(0, 400) }));
}

/** Markdown de Tavily Extract a texto corrido: sin tablas, sin marcas y con los enlaces como texto. */
export function markdownATexto(md: string): string {
  return md
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/:?-{3,}:?/g, ' ')
    .replace(/[|#*_>`]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Lee una página con Tavily Extract cuando el servidor no pudo (sitio que bloquea IPs de nube o
 * que arma el texto con JavaScript). Solo nombres de dominio públicos: nunca una IP ni un nombre
 * interno, que no tienen por qué salir a un tercero.
 */
/**
 * Parámetros que suelen llevar una llave: enlaces prefirmados (S3, GCS, Azure), tokens de sesión o
 * de API. Una URL así no sale a un tercero aunque el sitio haya bloqueado al servidor.
 */
const PARAM_SECRETO = /(^|[_-])(token|sig|signature|key|apikey|api_key|auth|secret|pass|password|pwd|credential|session|sess|jwt|code|otp|hash)([_-]|$)|^x-(amz|goog|ms)-|^(se|sp|sv|sr|st|skoid|sktid)$/i;
export function urlSinSecretos(u: URL): boolean {
  if (u.username || u.password) return false;
  for (const k of u.searchParams.keys()) if (PARAM_SECRETO.test(k)) return false;
  return true;
}

export async function extraerConTavily(url: string, maxChars: number, ms = 15000): Promise<string> {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return '';
  }
  if (!/^https?:$/.test(u.protocol) || !u.hostname.includes('.') || /^[\d.]+$|:/.test(u.hostname) || /\.(local|internal|lan)$/i.test(u.hostname)) return '';
  if (!urlSinSecretos(u) || ms < 1500) return '';
  const j = await pedirTavily('/extract', { urls: [u.toString()] }, ms);
  const crudo = String(j?.results?.[0]?.raw_content || '');
  return markdownATexto(crudo).slice(0, maxChars);
}

/** Wikipedia: no bloquea servidores y cubre lo enciclopédico (geología, minerales, lugares, leyes). */
async function buscarWikipedia(query: string, max: number, idioma = 'es'): Promise<WebHit[]> {
  const r = await fetch(`https://${idioma}.wikipedia.org/w/api.php?action=query&list=search&format=json&utf8=1&srlimit=${max}&srsearch=${encodeURIComponent(query)}`, {
    headers: { 'User-Agent': 'DrElectrumFP/1.0 (busqueda de referencia minera)', Accept: 'application/json' },
    signal: AbortSignal.timeout(5000),
  });
  if (!r.ok) return [];
  const j: any = await r.json();
  return (j?.query?.search || []).map((x: any) => ({
    title: `${x.title} — Wikipedia`,
    url: `https://${idioma}.wikipedia.org/wiki/${encodeURIComponent(String(x.title).replace(/ /g, '_'))}`,
    snippet: stripHtml(String(x.snippet || '')),
  }));
}

const VACIAS = new Set('para como sobre entre desde hasta donde cual cuales quien quienes cuando este esta estos estas that with from what the and los las del una uno unos unas por con que hay ser mas muy hoy dia ayer como cuanto cuanta cuantos noticias noticia ultimas ultima dame busca buscar informacion sus son fue era'.split(' '));
const sinTilde = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
export function palabrasClave(q: string): string[] {
  return [...new Set(sinTilde(q).split(/[^a-z0-9ñ]+/).filter((w) => w.length >= 3 && !VACIAS.has(w)))];
}

/** Cuántas palabras de la consulta aparecen en el título o el extracto. */
export function relevancia(h: WebHit, claves: string[]): number {
  if (!claves.length) return 1;
  // Al principio de palabra: «oro» cuenta en «oro» y «orogénico», no en «valor».
  const t = ` ${sinTilde(`${h.title} ${h.snippet} ${decodeURIComponent(h.url)}`).replace(/[^a-z0-9ñ]+/g, ' ')}`;
  return claves.filter((w) => t.includes(` ${w}`)).length / claves.length;
}

/** Descarta lo que no es un resultado: páginas del propio buscador y enlaces sin dominio. */
function esResultado(h: WebHit): boolean {
  try {
    const u = new URL(h.url);
    if (!/^https?:$/.test(u.protocol)) return false;
    return !/(^|\.)(bing\.com|duckduckgo\.com|google\.com)$/i.test(u.hostname);
  } catch {
    return false;
  }
}

const normalUrl = (u: string) => u.replace(/^https?:\/\/(www\.)?/i, '').replace(/[#?].*$/, '').replace(/\/$/, '').toLowerCase();

export async function buscarWeb(query: string, max = 5): Promise<WebHit[]> {
  const claves = palabrasClave(query);
  const noticia = esNoticia(query);
  // Todos a la vez: el que conteste bien gana, el que se bloquea no retrasa a los demás.
  const motores: Array<[string, number, () => Promise<WebHit[]>]> = [
    ['brave', 3, () => buscarBrave(query, max + 3)],
    ['tavily', 3, () => buscarTavily(query, max + 3)],
    ['ddg', 2, () => buscarDDG(query, max + 3)],
    ['bing', 1, () => buscarBing(query, max + 3)],
    ['wikipedia', 1, () => buscarWikipedia(query, 3, 'es')],
    ['noticias', noticia ? 2.5 : 0.5, () => buscarNoticias(query, max)],
  ];
  const r = await Promise.allSettled(motores.map(([, , fn]) => fn()));
  const vistos = new Set<string>();
  const todos: Array<WebHit & { puntos: number; social: boolean }> = [];
  r.forEach((x, i) => {
    if (x.status !== 'fulfilled') return;
    x.value.forEach((h, k) => {
      if (!h.title || !h.url || !esResultado(h)) return;
      const clave = normalUrl(h.url);
      if (vistos.has(clave)) return;
      const rel = relevancia(h, claves);
      // Los raspados sin la mayoría de las palabras de la consulta son ruido (un buscador
      // bloqueado devuelve su portada; uno flojo, lo que tenga una palabra suelta). Los que tienen
      // su propio motor de relevancia (APIs, Wikipedia) solo necesitan compartir algo.
      const minimo = ['brave', 'tavily', 'wikipedia'].includes(motores[i][0]) ? 0.25 : 0.6;
      if (claves.length >= 2 && rel < minimo) return;
      vistos.add(clave);
      // Una publicación de red social no es una fuente para citar: va después de todas las demás.
      const social = /(^|\.)(facebook|instagram|tiktok|x|twitter|youtube|pinterest)\.com$/i.test(new URL(h.url).hostname);
      todos.push({ ...h, social, puntos: motores[i][1] + 3 * rel - k * 0.15 });
    });
  });
  return todos
    .sort((a, b) => Number(a.social) - Number(b.social) || b.puntos - a.puntos)
    .slice(0, max)
    .map(({ puntos: _p, social: _s, ...h }) => h);
}

/**
 * `web_leer` corta a los 15 s: lo directo y la vuelta por Tavily comparten ese presupuesto, así la
 * herramienta no vence con un pedido a Tavily todavía en el aire.
 */
const PRESUPUESTO_LEER_MS = 13_000;
export async function leerPagina(url: string, maxChars = 1800): Promise<string> {
  const t0 = Date.now();
  let directo = '';
  let bloqueada = false;
  try {
    // Conecta a la IP ya comprobada y revisa cada redirección (lib/red-publica.ts): esto lo abre
    // el modelo con URLs que no eligió una persona.
    const r = await pedirPublico(url, { ms: 7000, headers: { 'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AU-RA-FP/3.0', Accept: 'text/html,*/*' } });
    if (r.status < 400 && /html|text|json/.test(r.tipo)) {
      const html = r.texto;
      const body = html.match(/<body[\s\S]*<\/body>/i)?.[0] || html;
      directo = stripHtml(body).slice(0, maxChars);
    } else if (r.status >= 400) {
      bloqueada = true;
    }
  } catch (e: any) {
    // Lo que red-publica rechaza por no ser público no se reintenta afuera.
    if (/solo http|p[uú]blic|privad|interna|no permitid|bloquead/i.test(String(e?.message || ''))) return '';
    bloqueada = true;
  }
  // Si el sitio bloqueó al servidor o la página vino casi vacía (armada con JavaScript), la lee Tavily.
  if (bloqueada || directo.length < 200) {
    const otra = await extraerConTavily(url, maxChars, PRESUPUESTO_LEER_MS - (Date.now() - t0)).catch(() => '');
    if (otra.length > directo.length) return otra;
  }
  return directo;
}

export function consultaWeb(message: string): string | null {
  const q = message.trim();
  const m = q.match(
    /^(?:(?:ultron|aura|au-ra|au ra|dr\.? electrum|doctor electrum|doctor|electrum)[,\s]+)?(?:busc[aá](?:me)?(?: en (?:internet|la web))?|investig[aá]|googlea|averigu[aá]|consult[aá] en internet|qu[eé] dice internet (?:de|sobre)|noticias (?:de|sobre)|qu[eé] hay de nuevo (?:de|sobre)|dame informaci[oó]n (?:de|sobre))\s+(.+)$/i
  );
  if (m) return m[1].replace(/[?¿.!]+$/g, '').trim();
  if (/\b(noticias|[uú]ltimas noticias|qu[eé] pas[oó] hoy|hoy en el mundo)\b/i.test(q)) return q.replace(/[?¿.!]+$/g, '');
  return null;
}
