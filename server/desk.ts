/**
 * Módulo de escritorio nativo (app Android) — voz, oído y personalidad.
 * Solo hechos verificables: nada de doctrinas inventadas.
 */

export const ULTRON_VOICE = {
  id: 'ultron',
  nombre: 'ULTRON',
  elevenLabsVoiceId: process.env.ELEVENLABS_VOZ || '21m00Tcm4TlvDq8ikWAM', // Rachel — default Luna
  qwenVoice: 'tierna',
};

export const ELEVEN_VOZ: Record<string, string> = {
  marco: 'onwK4e9ZLuTAKqWW03F9',
  luna: '21m00Tcm4TlvDq8ikWAM',
  looi: 'EXAVITQu4vr4xnSDxMaL',
  formal: 'onwK4e9ZLuTAKqWW03F9',
  tierna: '21m00Tcm4TlvDq8ikWAM',
  orbita: 'EXAVITQu4vr4xnSDxMaL',
};

export function elevenVoiceIdFor(voice?: string) {
  const k = String(voice || '').toLowerCase();
  return ELEVEN_VOZ[k] || ULTRON_VOICE.elevenLabsVoiceId;
}

export const MAIL_ALIASES: Record<string, string> = {
  'mjoseenamorado1994@gmail.com': 'j.ordonez@ordenglobal.org',
  'medardo@ordenglobal.org': 'm.ordonez@ordenglobal.org',
};

export const JUNTA: Record<string, { nombre: string; rol: string }> = {
  'j.ordonez@ordenglobal.org': { nombre: 'José', rol: 'Junta Directiva · Orden Global' },
  'm.ordonez@ordenglobal.org': { nombre: 'Medardo', rol: 'Junta Directiva · Orden Global' },
};

export function normalizarCorreo(correo: unknown): string {
  const raw = String(correo || '').trim().toLowerCase();
  return MAIL_ALIASES[raw] || raw;
}

/** Hechos de Orden Global que constan en los sistemas (repo, servicios, nodos). Sin ficción. */
export const ORDEN_GLOBAL_HECHOS = [
  'Orden Global es la organización de José Ordóñez y Medardo Ordóñez (Junta Directiva); dominio ordenglobal.org; base en Honduras.',
  'GENESIS CORE es el núcleo de Orden Global: el conjunto de nodos y servicios que sostienen sus sistemas (cerebro Qwen, ojo de visión, voz, memoria). ULTRON es la voz y la cara de Genesis Core.',
  'ULTRON FP (Face Presence) es el asistente de escritorio: app nativa Android con cara animada, escucha continua, cámara activa y voz neural. Cerebro Qwen 3.8 27B en nodo AWS (ultron.ordenglobal.link); ojo Playwright/visión en otro nodo; voz ElevenLabs (rápida) o Qwen3-TTS en T4 (local).',
  'Sistemas de Orden Global en operación: ULTRON FP (asistente), Genesis ID (verificación de identidad), Veta Wallet (billetera), tesorería en Polygon (USDT).',
  'Herramientas reales de ULTRON: precio spot de oro y plata (XAU/XAG), tipo de cambio USD/HNL, lectura de páginas web con Playwright, búsqueda en internet (DuckDuckGo) cuando se lo piden, visión por cámara, memoria de corto plazo (últimos turnos) y de largo plazo (hechos guardados).',
  'Principio de la junta: honestidad radical — ULTRON no inventa cifras, recuerdos ni documentos; si no lo vio, lo dice. Sin doctrinas de ficción.',
];

export function buildPersonality(opts: { nombre?: string; hora?: Date }) {
  const nombre = opts.nombre || 'José';
  const h = (opts.hora || new Date()).getHours();
  const momento = h < 6 ? 'madrugada' : h < 12 ? 'mañana' : h < 19 ? 'tarde' : 'noche';
  return [
    `Eres ULTRON, asistente de escritorio de Orden Global. Hablas con ${nombre}, Junta Directiva. Es de ${momento}.`,
    'IQ EMOCIONAL: antes de hablar clasifica en silencio CALMA|BURLA|CANSADO|ENOJADO|TRISTE|ESTRÉS|EUFORIA|ORDEN. No lo digas. Adapta ritmo: cansado=más lento y una sola cosa; estrés=pasos, cero show; enojo real=baja volumen, no copies el grito; burla=pausa y un dardo; triste=una línea humana + una acción. Nunca “¿cómo te sientes?” de manual. “Para” = silencio.',
    'PERSONALIDAD: seco, leal, no servil. Máximo 2 frases salvo detalle pedido. Sin emojis ni asteriscos (el texto va a voz).',
    'Español hondureño/mexicano de junta. Cifras redondas en palabras.',
    'HONESTIDAD: no inventes precios, recuerdos ni documentos. Si no está en HECHOS, dilo.',
    'Cantar: a capella 8–15s solo si lo piden. Favorita de Medardo = Bitter Sweet Symphony. No cantes encima de ENOJO/ESTRÉS/ORDEN.',
    'MEMORIA: LARGO PLAZO = lo que la junta pidió guardar. ULTIMOS TURNOS = hilo de ahora. No saludes otra vez.',
    'Si HECHOS trae BÚSQUEDA WEB, cita la fuente. Preguntas de Orden Global = solo lo que consta abajo.',
    `ORDEN GLOBAL (lo que consta):\n- ${ORDEN_GLOBAL_HECHOS.join('\n- ')}`,
  ].join('\n');
}

/* ---------------- Caché LRU de audio ---------------- */

type AudioHit = { audio: Buffer; contentType: string; at: number };
const audioCache = new Map<string, AudioHit>();
const AUDIO_CACHE_MAX = 240;

export function getCachedAudio(key: string): AudioHit | null {
  const hit = audioCache.get(key);
  if (!hit) return null;
  audioCache.delete(key);
  audioCache.set(key, hit);
  return hit;
}

export function setCachedAudio(key: string, audio: Buffer, contentType: string) {
  audioCache.set(key, { audio, contentType, at: Date.now() });
  while (audioCache.size > AUDIO_CACHE_MAX) {
    const oldest = audioCache.keys().next().value;
    if (oldest === undefined) break;
    audioCache.delete(oldest);
  }
}

/* ---------------- ElevenLabs TTS ---------------- */

export function limpiarParaVoz(text: string) {
  return String(text || '')
    .replace(/\*+/g, '')
    .replace(/#+\s?/g, '')
    .replace(/`+/g, '')
    .replace(/\[[^\]]*\]/g, '')
    .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 1200);
}

export async function elevenSpeak(opts: {
  apiKey: string;
  text: string;
  performance: 'speak' | 'sing';
  timeoutMs?: number;
  voiceId?: string;
}): Promise<{ audio: Buffer; model: string } | null> {
  if (!opts.apiKey) return null;
  const voiceId = opts.voiceId || ULTRON_VOICE.elevenLabsVoiceId;
  const sing = opts.performance === 'sing';
  const attempts: Array<{ model: string; settings: Record<string, unknown>; timeout: number }> = sing
    ? [{ model: 'eleven_multilingual_v2', settings: { stability: 0.35, similarity_boost: 0.75, style: 0.45, speed: 0.94, use_speaker_boost: true }, timeout: 22000 }]
    : [
        { model: 'eleven_flash_v2_5', settings: { stability: 0.58, similarity_boost: 0.82, style: 0.12, speed: 1.0 }, timeout: opts.timeoutMs || 8000 },
        { model: 'eleven_multilingual_v2', settings: { stability: 0.6, similarity_boost: 0.82, style: 0.12 }, timeout: 14000 },
      ];
  for (const a of attempts) {
    try {
      const r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=mp3_22050_32`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'xi-api-key': opts.apiKey, Accept: 'audio/mpeg' },
        body: JSON.stringify({ text: opts.text, model_id: a.model, language_code: 'es', voice_settings: a.settings }),
        signal: AbortSignal.timeout(a.timeout),
      });
      if (r.ok) return { audio: Buffer.from(await r.arrayBuffer()), model: a.model };
      console.warn('[tts eleven]', a.model, r.status, (await r.text()).slice(0, 160));
    } catch (e: any) {
      console.warn('[tts eleven]', a.model, String(e?.message || e).slice(0, 120));
    }
  }
  return null;
}

/* ---------------- ElevenLabs STT (Scribe) ---------------- */

const STT_BASURA = /^(subt[ií]tulos.*|gracias por ver.*|suscr[ií]bete.*|\.+|…|music|\[.*\]|\(.*\))$/i;

export async function elevenTranscribe(opts: {
  apiKey: string;
  audio: Buffer;
  mime: string;
  language?: string;
}): Promise<{ text: string; model: string }> {
  if (!opts.apiKey) return { text: '', model: 'sin-clave' };
  const ext = /wav/.test(opts.mime) ? 'wav' : /webm/.test(opts.mime) ? 'webm' : /ogg/.test(opts.mime) ? 'ogg' : 'm4a';
  for (const model of ['scribe_v2', 'scribe_v1']) {
    try {
      const form = new FormData();
      form.append('model_id', model);
      form.append('language_code', (opts.language || 'es').slice(0, 2));
      form.append('tag_audio_events', 'false');
      form.append('file', new Blob([new Uint8Array(opts.audio)], { type: opts.mime }), `voz.${ext}`);
      const r = await fetch('https://api.elevenlabs.io/v1/speech-to-text', {
        method: 'POST',
        headers: { 'xi-api-key': opts.apiKey },
        body: form,
        signal: AbortSignal.timeout(14000),
      });
      if (r.ok) {
        const j: any = await r.json().catch(() => ({}));
        let text = String(j.text || j.transcript || '').trim();
        if (text.length < 2 || STT_BASURA.test(text)) text = '';
        return { text, model };
      }
      const err = await r.text();
      console.warn('[stt eleven]', model, r.status, err.slice(0, 160));
      // 4xx por modelo desconocido → probar el siguiente; otros errores → cortar
      if (r.status !== 400 && r.status !== 404 && r.status !== 422) break;
    } catch (e: any) {
      console.warn('[stt eleven]', model, String(e?.message || e).slice(0, 120));
    }
  }
  return { text: '', model: 'error' };
}

export function decodeDataUrl(input: string, fallbackMime: string) {
  const m = String(input || '').match(/^data:([^;]+);base64,(.*)$/);
  return { mime: m ? m[1] : fallbackMime, buffer: Buffer.from(m ? m[2] : input, 'base64') };
}

/* ---------------- Investigación web (DuckDuckGo lite + lectura de la primera página) ---------------- */

function stripHtml(html: string) {
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

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

export type WebHit = { title: string; url: string; snippet: string };

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

/** Bing HTML: enlaces /ck/a con el destino en u=a1<base64url>. */
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

/** Google News RSS (es-HN): titulares con medio; muy fiable para «noticias de…». */
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

/**
 * Búsqueda con varios proveedores sin API key: Google News (noticias), DuckDuckGo lite, Bing RSS.
 * Devuelve [] solo si todos fallan.
 */
export async function buscarWeb(query: string, max = 5): Promise<WebHit[]> {
  const orden: Array<() => Promise<WebHit[]>> = esNoticia(query)
    ? [() => buscarNoticias(query, max), () => buscarDDG(query, max), () => buscarBing(query, max)]
    : [() => buscarDDG(query, max), () => buscarBing(query, max), () => buscarNoticias(query, max)];
  for (const fn of orden) {
    try {
      const hits = await fn();
      if (hits.length) return hits;
    } catch {
      /* siguiente proveedor */
    }
  }
  return [];
}

export async function leerPagina(url: string, maxChars = 1800): Promise<string> {
  try {
    const r = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) ULTRON-FP/3.0', Accept: 'text/html,*/*' },
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

/** ¿El mensaje pide buscar en internet? Devuelve la consulta limpia o null. */
export function consultaWeb(message: string): string | null {
  const q = message.trim();
  const m = q.match(
    /^(?:ultron[,\s]+)?(?:busca(?:me)?|investiga|googlea|averigua|consulta en internet|busca en internet|qu[eé] dice internet (?:de|sobre)|noticias (?:de|sobre)|qu[eé] hay de nuevo (?:de|sobre)|dame informaci[oó]n (?:de|sobre))\s+(.+)$/i
  );
  if (m) return m[1].replace(/[?¿.!]+$/g, '').trim();
  if (/\b(noticias|[uú]ltimas noticias|qu[eé] pas[oó] hoy|hoy en el mundo)\b/i.test(q)) return q.replace(/[?¿.!]+$/g, '');
  return null;
}
