/**
 * Telegram inbound: solo chats/usuarios de la junta. Cero teatro, nadie más entra.
 */

import crypto from 'node:crypto';

export type TgParsed = {
  chatId: string;
  userId: string;
  nombre: string;
  texto: string;
  comando?: string;
  imageDataUrl?: string;
  audio?: { mime: string; buffer: Buffer };
};

function listaIds(raw: string | undefined): string[] {
  return String(raw || '')
    .split(/[,\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function chatsPermitidos(): string[] {
  const extra = listaIds(process.env.TELEGRAM_ALLOWED_CHAT_IDS);
  const uno = String(process.env.TELEGRAM_CHAT_ID || '').trim();
  return [...new Set(extra.length ? extra : uno ? [uno] : [])];
}

export function usuariosPermitidos(): string[] {
  return listaIds(process.env.TELEGRAM_ALLOWED_USER_IDS);
}

export function telegramAutorizado(chatId: string | number, userId?: string | number): boolean {
  const chats = chatsPermitidos();
  if (!chats.length) return false;
  if (!chats.includes(String(chatId))) return false;
  const users = usuariosPermitidos();
  if (!users.length) return true;
  return users.includes(String(userId || ''));
}

export function telegramWebhookSecretOk(header: unknown): boolean {
  const expected = process.env.TELEGRAM_WEBHOOK_SECRET || '';
  const got = String(header || '');
  if (!expected || !got) return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(got);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

export function telegramPublicBase(): string {
  return (process.env.PUBLIC_BASE || process.env.RENDER_EXTERNAL_URL || '').replace(/\/$/, '');
}

export function ayudaTelegram(): string {
  return [
    'ULTRON privado. Solo este chat de la junta.',
    'Puedo: estado del sistema, pendientes, PDF, buscar en internet, leer una página, código (y ejecutarlo si me lo pides), oro/plata/HNL, visión si mandas foto.',
    'WhatsApp, correo y llamada: sin clave todavía. No los finjo.',
    'Ejemplos: «cómo está el sistema», «busca noticias de oro», «anota que mañana hay junta», «haz un pdf del resumen».',
  ].join('\n');
}

const hilos = new Map<string, { rol: string; texto: string }[]>();

export function hiloTelegram(chatId: string): { rol: string; texto: string }[] {
  return hilos.get(String(chatId)) || [];
}

export function recordarTelegram(chatId: string, user: string, ultron: string) {
  const prev = hiloTelegram(chatId);
  hilos.set(String(chatId), [...prev, { rol: 'user', texto: user }, { rol: 'ultron', texto: ultron }].slice(-12));
}

async function archivoTelegram(token: string, fileId: string): Promise<Buffer | null> {
  const r = await fetch(`https://api.telegram.org/bot${token}/getFile?file_id=${encodeURIComponent(fileId)}`, {
    signal: AbortSignal.timeout(12000),
  });
  const j: any = await r.json().catch(() => ({}));
  const p = String(j?.result?.file_path || '');
  if (!p) return null;
  const f = await fetch(`https://api.telegram.org/file/bot${token}/${p}`, { signal: AbortSignal.timeout(20000) });
  if (!f.ok) return null;
  return Buffer.from(await f.arrayBuffer());
}

export async function parsearUpdateTelegram(update: any): Promise<TgParsed | null> {
  const msg = update?.message || update?.edited_message;
  if (!msg) return null;
  const chatId = String(msg.chat?.id ?? '');
  const userId = String(msg.from?.id ?? '');
  if (!chatId) return null;
  const nombre = String(msg.from?.first_name || msg.from?.username || 'jefe').slice(0, 40);
  const texto = String(msg.text || msg.caption || '').trim();
  const comando = texto.startsWith('/') ? texto.split(/\s+/)[0].split('@')[0].toLowerCase() : undefined;
  const token = process.env.TELEGRAM_BOT_TOKEN || '';
  let imageDataUrl: string | undefined;
  let audio: TgParsed['audio'];
  if (token && Array.isArray(msg.photo) && msg.photo.length) {
    const best = msg.photo[msg.photo.length - 1];
    const buf = best?.file_id ? await archivoTelegram(token, best.file_id) : null;
    if (buf && buf.length > 80) imageDataUrl = `data:image/jpeg;base64,${buf.toString('base64')}`;
  }
  if (token && (msg.voice?.file_id || msg.audio?.file_id)) {
    const id = msg.voice?.file_id || msg.audio?.file_id;
    const buf = await archivoTelegram(token, id);
    if (buf && buf.length > 80) audio = { mime: msg.voice ? 'audio/ogg' : 'audio/mpeg', buffer: buf };
  }
  if (!texto && !imageDataUrl && !audio) return null;
  return { chatId, userId, nombre, texto, comando, imageDataUrl, audio };
}

export async function telegramResponder(chatId: string, texto: string): Promise<{ ok: boolean; detalle: string }> {
  const token = process.env.TELEGRAM_BOT_TOKEN || '';
  if (!token) return { ok: false, detalle: 'Falta TELEGRAM_BOT_TOKEN. No respondí.' };
  if (!telegramAutorizado(chatId)) return { ok: false, detalle: 'Chat no autorizado. No envié nada.' };
  const chunks = String(texto || '…')
    .trim()
    .match(/[\s\S]{1,3500}/g) || ['…'];
  try {
    for (const chunk of chunks.slice(0, 4)) {
      const r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text: chunk }),
        signal: AbortSignal.timeout(12000),
      });
      const j: any = await r.json().catch(() => ({}));
      if (!r.ok || !j.ok) return { ok: false, detalle: `Telegram ${r.status}: ${JSON.stringify(j).slice(0, 160)}` };
    }
    return { ok: true, detalle: `Respondí a chat ${chatId}.` };
  } catch (e: any) {
    return { ok: false, detalle: String(e?.message || e).slice(0, 160) };
  }
}

export async function registrarWebhookTelegram(): Promise<{ ok: boolean; detalle: string }> {
  const token = process.env.TELEGRAM_BOT_TOKEN || '';
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET || '';
  const base = telegramPublicBase();
  if (!token) return { ok: false, detalle: 'Falta TELEGRAM_BOT_TOKEN.' };
  if (!secret) return { ok: false, detalle: 'Falta TELEGRAM_WEBHOOK_SECRET. No registré webhook.' };
  if (!base) return { ok: false, detalle: 'Falta PUBLIC_BASE o RENDER_EXTERNAL_URL.' };
  try {
    const r = await fetch(`https://api.telegram.org/bot${token}/setWebhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url: `${base}/api/telegram/webhook`,
        secret_token: secret,
        allowed_updates: ['message', 'edited_message'],
        drop_pending_updates: false,
      }),
      signal: AbortSignal.timeout(12000),
    });
    const j: any = await r.json().catch(() => ({}));
    if (!r.ok || !j.ok) return { ok: false, detalle: `setWebhook ${r.status}: ${JSON.stringify(j).slice(0, 180)}` };
    return { ok: true, detalle: `Webhook en ${base}/api/telegram/webhook` };
  } catch (e: any) {
    return { ok: false, detalle: String(e?.message || e).slice(0, 160) };
  }
}
