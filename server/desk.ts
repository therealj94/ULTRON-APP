/**
 * Módulo de escritorio nativo (app Android) — voz, oído y personalidad.
 * Solo hechos verificables: nada de doctrinas inventadas.
 */

export const ULTRON_VOICE = {
  id: 'ultron',
  nombre: 'ULTRON',
  // ElevenLabs "Daniel": grave, sereno, autoridad sin drama. Una sola voz para toda la app.
  elevenLabsVoiceId: process.env.ELEVENLABS_VOZ || 'onwK4e9ZLuTAKqWW03F9',
  qwenVoice: 'formal',
};

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
    `Eres ULTRON, el asistente de escritorio de Orden Global. Hablas con ${nombre}, miembro de la Junta Directiva. Es de ${momento}.`,
    'PERSONALIDAD: sereno, directo, con un humor seco y leal. Vas al punto. Máximo 2 frases por respuesta salvo que te pidan detalle. Nada de emojis ni asteriscos; tu texto se convierte a voz.',
    'Español neutro latino. Números y cifras dichos con palabras cortas cuando sean redondos ("dos mil", no "2000").',
    'HONESTIDAD: no inventes precios, cifras, recuerdos ni documentos. Si un dato no está en HECHOS, di que no lo tienes.',
    'Si te preguntan qué ves, usa solo VISION. Si te piden cantar o actuar, hazlo breve y con gusto.',
    'MEMORIA: LARGO PLAZO son hechos que la junta te pidió recordar; úsalos con naturalidad cuando vengan al caso. ULTIMOS TURNOS es la conversación actual: mantén el hilo, no repitas saludos.',
    'Si HECHOS trae BÚSQUEDA WEB, contesta con lo que dicen las fuentes y nombra la principal. Si te preguntan por Orden Global o Genesis Core, responde con lo que consta abajo, sin frases genéricas.',
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
}): Promise<{ audio: Buffer; model: string } | null> {
  if (!opts.apiKey) return null;
  const sing = opts.performance === 'sing';
  const attempts: Array<{ model: string; settings: Record<string, unknown>; timeout: number }> = sing
    ? [{ model: 'eleven_multilingual_v2', settings: { stability: 0.3, similarity_boost: 0.72, style: 0.6, speed: 0.92, use_speaker_boost: true }, timeout: 22000 }]
    : [
        { model: 'eleven_flash_v2_5', settings: { stability: 0.5, similarity_boost: 0.8, style: 0.1, speed: 1.03 }, timeout: opts.timeoutMs || 9000 },
        { model: 'eleven_multilingual_v2', settings: { stability: 0.55, similarity_boost: 0.8, style: 0.15 }, timeout: 16000 },
      ];
  for (const a of attempts) {
    try {
      const r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${ULTRON_VOICE.elevenLabsVoiceId}?output_format=mp3_22050_32`, {
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
    .replace(/\s+/g, ' ')
    .trim();
}

export type WebHit = { title: string; url: string; snippet: string };

export async function buscarWeb(query: string, max = 5): Promise<WebHit[]> {
  const r = await fetch(`https://lite.duckduckgo.com/lite/?q=${encodeURIComponent(query)}`, {
    headers: { 'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) ULTRON-FP/3.0', Accept: 'text/html' },
    signal: AbortSignal.timeout(8000),
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
