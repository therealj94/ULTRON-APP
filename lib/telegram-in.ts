/**
 * Telegram inbound: solo chats/usuarios de la junta. Cero teatro, nadie más entra.
 */

import crypto from 'node:crypto';
import { dataUrlDeImagen, esImagenNombre, esPdfNombre } from './leer-pdf';
import { esAudioNombre, mimeDeAudio } from './oido';

export type TgParsed = {
  chatId: string;
  userId: string;
  nombre: string;
  texto: string;
  comando?: string;
  imageDataUrl?: string;
  audio?: { mime: string; buffer: Buffer };
  documento?: { filename: string; mime: string; buffer: Buffer };
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
  const jose = [
    ...listaIds(process.env.TELEGRAM_JOSE_CHAT_ID),
    ...listaIds(process.env.TELEGRAM_JOSE_USER_ID),
    ...listaIds(process.env.TELEGRAM_JOSE_USER_IDS),
  ];
  const medardo = [
    ...listaIds(process.env.TELEGRAM_MEDARDO_CHAT_ID),
    ...listaIds(process.env.TELEGRAM_MEDARDO_USER_ID),
    ...listaIds(process.env.TELEGRAM_MEDARDO_USER_IDS),
  ];
  const carlos = [
    ...listaIds(process.env.TELEGRAM_CARLOS_CHAT_ID),
    ...listaIds(process.env.TELEGRAM_CARLOS_USER_ID),
    ...listaIds(process.env.TELEGRAM_CARLOS_USER_IDS),
  ];
  const mayra = [
    ...listaIds(process.env.TELEGRAM_MAYRA_CHAT_ID),
    ...listaIds(process.env.TELEGRAM_MAYRA_USER_ID),
    ...listaIds(process.env.TELEGRAM_MAYRA_USER_IDS),
  ];
  return [...new Set([...extra, ...(uno ? [uno] : []), ...jose, ...medardo, ...carlos, ...mayra])];
}

export function usuariosPermitidos(): string[] {
  return listaIds(process.env.TELEGRAM_ALLOWED_USER_IDS);
}

export function telegramAutorizado(chatId: string | number, userId?: string | number): boolean {
  const chats = chatsPermitidos();
  if (!chats.length) return false;
  const cid = String(chatId);
  const uid = String(userId || '');
  if (chats.includes(cid) || (uid && chats.includes(uid))) {
    const users = usuariosPermitidos();
    if (!users.length) return true;
    return users.includes(uid);
  }
  return false;
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
    'Puedo: estado del sistema, nota de voz (`/audio`), bóveda, pendientes, PDF, buscar en internet, leer una página, código, oro/plata/HNL.',
    'Si me subes una foto o un PDF, los leo. No invento lo que no está en el archivo. Imagen como archivo también vale.',
    'Si me mandas una nota de voz, la oigo, la transcribo y te contesto por escrito. Audio de vuelta solo si lo pides (`/audio`).',
    'Urgente: «avísame urgente…» o «llámanos por telegram». Suena el teléfono y, si hay voz, te mando nota. El bot no hace llamada de teléfono; eso es Twilio (aún sin clave).',
    'Memoria: una para José, otra para Medardo, otra para Carlos y otra para Mayra, en S3. Corto, mediano y largo por persona. No mezclo las conversaciones. «esto» es lo último que hablamos. Si no está en el cerebro, busco en internet sin que me lo pidas.',
    'Carlos y Mayra: consulta. Pueden usar el taller; no cambian el sistema (sin redespliegue, sin mantenimiento, sin ejecutor).',
    'Ejemplos: «cómo está el sistema», «mándame audio del sistema», «busca noticias de oro», «anota que mañana hay junta», «haz un pdf del resumen».',
  ].join('\n');
}

const hilos = new Map<string, { rol: string; texto: string }[]>();

export function hiloTelegram(chatId: string): { rol: string; texto: string }[] {
  return hilos.get(String(chatId)) || [];
}

export function recordarTelegram(chatId: string, user: string, ultron: string) {
  const prev = hiloTelegram(chatId);
  hilos.set(String(chatId), [...prev, { rol: 'user', texto: user }, { rol: 'ultron', texto: ultron }].slice(-24));
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
  let documento: TgParsed['documento'];
  if (token && Array.isArray(msg.photo) && msg.photo.length) {
    const best = msg.photo[msg.photo.length - 1];
    const buf = best?.file_id ? await archivoTelegram(token, best.file_id) : null;
    if (buf && buf.length > 80) imageDataUrl = dataUrlDeImagen(buf);
  }
  if (token && msg.document?.file_id) {
    const filename = String(msg.document.file_name || 'archivo');
    const mime = String(msg.document.mime_type || '');
    const buf = await archivoTelegram(token, msg.document.file_id);
    if (buf && buf.length > 80) {
      if (esImagenNombre(filename, mime) && !imageDataUrl) {
        imageDataUrl = dataUrlDeImagen(buf);
      } else if (esAudioNombre(filename, mime) && !audio) {
        audio = { mime: mimeDeAudio(filename, mime), buffer: buf };
      } else if (esPdfNombre(filename, mime) || buf.subarray(0, 5).toString('latin1') === '%PDF-') {
        documento = { filename, mime: mime || 'application/pdf', buffer: buf };
      }
    } else if (esPdfNombre(filename, mime) || (buf && buf.subarray(0, 5).toString('latin1') === '%PDF-')) {
      documento = { filename, mime: mime || 'application/pdf', buffer: buf && buf.length > 80 ? buf : Buffer.alloc(0) };
    }
  }
  if (!token && msg.document) {
    const filename = String(msg.document.file_name || 'archivo');
    const mime = String(msg.document.mime_type || '');
    if (esAudioNombre(filename, mime) && !audio) {
      audio = { mime: mimeDeAudio(filename, mime), buffer: Buffer.alloc(0) };
    } else {
      documento = { filename, mime, buffer: Buffer.alloc(0) };
    }
  }
  if (token && (msg.voice?.file_id || msg.audio?.file_id)) {
    const id = msg.voice?.file_id || msg.audio?.file_id;
    const buf = await archivoTelegram(token, id);
    const mime = mimeDeAudio(
      msg.audio?.file_name || (msg.voice ? 'nota.ogg' : 'audio.mp3'),
      msg.voice?.mime_type || msg.audio?.mime_type || '',
      !!msg.voice
    );
    if (buf && buf.length > 80) audio = { mime, buffer: buf };
    else audio = { mime, buffer: Buffer.alloc(0) };
  }
  if (!token && (msg.voice || msg.audio)) {
    audio = {
      mime: mimeDeAudio('', msg.voice?.mime_type || msg.audio?.mime_type || '', !!msg.voice),
      buffer: Buffer.alloc(0),
    };
  }
  if (!texto && !imageDataUrl && !audio && !documento) return null;
  return { chatId, userId, nombre, texto, comando, imageDataUrl, audio, documento };
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
