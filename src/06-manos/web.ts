/** Manos: búsqueda y lectura web. Sin API key. El 27B no vive aquí. */

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

export async function buscarWeb(query: string, max = 5): Promise<WebHit[]> {
  const orden: Array<() => Promise<WebHit[]>> = esNoticia(query)
    ? [() => buscarNoticias(query, max), () => buscarDDG(query, max), () => buscarBing(query, max)]
    : [() => buscarDDG(query, max), () => buscarBing(query, max), () => buscarNoticias(query, max)];
  for (const fn of orden) {
    try {
      const hits = await fn();
      if (hits.length) return hits;
    } catch {
      /* siguiente */
    }
  }
  return [];
}

export async function leerPagina(url: string, maxChars = 1800): Promise<string> {
  try {
    const r = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AU-RA-FP/3.0', Accept: 'text/html,*/*' },
      signal: AbortSignal.timeout(7000),
      redirect: 'follow',
    });
    const ct = r.headers.get('content-type') || '';
    if (!/html|text|json/.test(ct)) return '';
    const html = await r.text();
    const body = html.match(/<body[\s\S]*<\/body>/i)?.[0] || html;
    return stripHtml(body).slice(0, maxChars);
  } catch {
    return '';
  }
}

export function consultaWeb(message: string): string | null {
  const q = message.trim();
  const m = q.match(
    /^(?:(?:ultron|aura|au-ra|au ra)[,\s]+)?(?:busca(?:me)?|investiga|googlea|averigua|consulta en internet|busca en internet|qu[eé] dice internet (?:de|sobre)|noticias (?:de|sobre)|qu[eé] hay de nuevo (?:de|sobre)|dame informaci[oó]n (?:de|sobre))\s+(.+)$/i
  );
  if (m) return m[1].replace(/[?¿.!]+$/g, '').trim();
  if (/\b(noticias|[uú]ltimas noticias|qu[eé] pas[oó] hoy|hoy en el mundo)\b/i.test(q)) return q.replace(/[?¿.!]+$/g, '');
  return null;
}
