/**
 * Caché en memoria para fluidez (sin Redis por ahora — Map basta en Render starter).
 * - personalidad: saludos / cómo estás
 * - TTS: audios frecuentes (Buffer)
 * - contexto: resúmenes cortos de conversación
 */

type Entry<T> = { value: T; at: number; hits: number };

const MAX = 200;
const TTL_MS = 30 * 60 * 1000;

function prune<T>(map: Map<string, Entry<T>>) {
  const now = Date.now();
  for (const [k, v] of map) {
    if (now - v.at > TTL_MS) map.delete(k);
  }
  if (map.size <= MAX) return;
  const sorted = [...map.entries()].sort((a, b) => a[1].at - b[1].at);
  for (let i = 0; i < sorted.length - MAX; i++) map.delete(sorted[i][0]);
}

const personalityCache = new Map<string, Entry<string>>();
const ttsCache = new Map<string, Entry<{ audio: Buffer; contentType: string }>>();
const contextCache = new Map<string, Entry<string>>();

function norm(s: string): string {
  return s.toLowerCase().trim().replace(/\s+/g, ' ').slice(0, 160);
}

export function getCachedPersonalityReply(message: string): string | null {
  prune(personalityCache);
  const e = personalityCache.get(norm(message));
  if (!e) return null;
  e.hits += 1;
  e.at = Date.now();
  return e.value;
}

export function setCachedPersonalityReply(message: string, reply: string): void {
  const key = norm(message);
  if (!/^(hola|hey|buenas|cómo estás|como estas|qué tal|que tal|gracias|buenos días|buenas noches)/i.test(key)) {
    return;
  }
  personalityCache.set(key, { value: reply, at: Date.now(), hits: 1 });
  prune(personalityCache);
}

export function getCachedTts(key: string): { audio: Buffer; contentType: string } | null {
  prune(ttsCache);
  const e = ttsCache.get(key);
  if (!e) return null;
  e.hits += 1;
  return e.value;
}

export function setCachedTts(key: string, audio: Buffer, contentType: string): void {
  if (audio.length > 800_000) return;
  ttsCache.set(key, { value: { audio, contentType }, at: Date.now(), hits: 1 });
  prune(ttsCache);
}

export function getCachedContextSummary(conversationId: string): string | null {
  prune(contextCache);
  return contextCache.get(conversationId)?.value || null;
}

export function setCachedContextSummary(conversationId: string, summary: string): void {
  contextCache.set(conversationId, { value: summary.slice(0, 800), at: Date.now(), hits: 1 });
  prune(contextCache);
}

export function cacheStats() {
  return {
    personality: personalityCache.size,
    tts: ttsCache.size,
    context: contextCache.size,
  };
}
