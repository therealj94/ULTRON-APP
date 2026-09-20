/**
 * Telegram inbound: solo chats/usuarios de la junta. Cero teatro, nadie más entra.
 */

import crypto from 'node:crypto';
import { nivelDe, padron } from './acceso';
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

/**
 * Quién puede escribirle al bot de ULTRON.
 *
 * Sale del PADRÓN, no de una lista de cuatro nombres clavada en el archivo. Si José le da acceso a
 * alguien en `ULTRON_PADRON` con su id de Telegram, esa persona puede escribirle al bot; antes el
 * padrón decía que sí y el bot seguía diciendo que no, que es peor que no tener padrón.
 *
 * Los `TELEGRAM_ALLOWED_CHAT_IDS` y el `TELEGRAM_CHAT_ID` de siempre se respetan: son los chats de
 * grupo, que no son personas y por eso no viven en el padrón.
 */
export function chatsPermitidos(): string[] {
  const grupos = [...listaIds(process.env.TELEGRAM_ALLOWED_CHAT_IDS)];
  const uno = String(process.env.TELEGRAM_CHAT_ID || '').trim();
  if (uno) grupos.push(uno);
  const gente = padron()
    .filter((p) => nivelDe(p, 'ultron'))
    .flatMap((p) => p.telegram);
  return [...new Set([...grupos, ...gente])];
}

export function usuariosPermitidos(): string[] {
  return listaIds(process.env.TELEGRAM_ALLOWED_USER_IDS);
}

/**
 * Si este update se atiende o se tira.
 *
 * El matiz de los GRUPOS. Telegram numera los chats de grupo, supergrupo y canal en negativo, y los
 * privados con el mismo número que el usuario. Un id de persona en la lista autorizaba antes a esa
 * persona ESCRIBIENDO DESDE CUALQUIER CHAT: si alguien mete el bot en un grupo suyo e invita a
 * José, el turno se ejecutaba entero —herramientas y memoria incluidas— y solo al final fallaba al
 * responder, porque `telegramResponder` sí comprueba el chat. O sea que un tercero podía meterle
 * hechos a la memoria privada de José desde su propio grupo.
 *
 * Ahora un grupo tiene que estar en la lista por su propio id. El chat privado sigue funcionando
 * igual, porque ahí el id del chat ES el de la persona.
 */
export function telegramAutorizado(chatId: string | number, userId?: string | number): boolean {
  const chats = chatsPermitidos();
  if (!chats.length) return false;
  const cid = String(chatId);
  const uid = String(userId || '');

  const esGrupo = cid.startsWith('-');
  const entra = esGrupo ? chats.includes(cid) : chats.includes(cid) || (!!uid && chats.includes(uid));
  if (!entra) return false;

  const users = usuariosPermitidos();
  if (!users.length) return true;
  return users.includes(uid);
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

/** Quién manda y quién consulta, según el padrón de hoy. */
function lineaDeAccesos(): string {
  const gente = padron().filter((p) => nivelDe(p, 'ultron'));
  const mandan = gente.filter((p) => nivelDe(p, 'ultron') === 'mando').map((p) => p.nombre);
  const resto = gente.filter((p) => nivelDe(p, 'ultron') !== 'mando').map((p) => p.nombre);
  if (!resto.length) return `Mando: ${mandan.join(' y ') || 'nadie'}. Nadie más cambia el sistema.`;
  return `${resto.join(' y ')}: consulta. Pueden usar el taller; no cambian el sistema (sin redespliegue, sin mantenimiento, sin ejecutor). Eso es de ${mandan.join(' y ') || 'nadie'}.`;
}

export function ayudaTelegram(): string {
  return [
    'ULTRON privado. Solo este chat de la junta.',
    'Puedo: estado del sistema, nota de voz (`/audio`), bóveda, pendientes, PDF, buscar en internet, leer una página, código, oro/plata/HNL.',
    'Si me subes una foto o un PDF, los leo. No invento lo que no está en el archivo. Imagen como archivo también vale.',
    'Si me mandas una nota de voz, la oigo, la transcribo y te contesto por escrito. Audio de vuelta solo si lo pides (`/audio`).',
    'Urgente: «avísame urgente…» o «llámanos por telegram». Suena el teléfono y, si hay voz, te mando nota. El bot no hace llamada de teléfono; eso es Twilio (aún sin clave).',
    'Memoria: una por persona, en S3. Corto, mediano y largo. No mezclo las conversaciones. «esto» es lo último que hablamos. Si no está en el cerebro, busco en internet sin que me lo pidas.',
    lineaDeAccesos(),
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

/** Baja un archivo de Telegram con el token del bot que lo recibió. Los dos bots la usan. */
export async function archivoTelegram(token: string, fileId: string): Promise<Buffer | null> {
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

/**
 * Lee un update de Telegram. El token se puede pasar aparte porque ahora hay DOS bots —ULTRON FP y
 * Dr Electrum FP— y los archivos de cada uno solo se bajan con el token de su propio bot.
 */
export async function parsearUpdateTelegram(update: any, tokenBot?: string): Promise<TgParsed | null> {
  const msg = update?.message || update?.edited_message;
  if (!msg) return null;
  const chatId = String(msg.chat?.id ?? '');
  const userId = String(msg.from?.id ?? '');
  if (!chatId) return null;
  const nombre = String(msg.from?.first_name || msg.from?.username || 'jefe').slice(0, 40);
  const texto = String(msg.text || msg.caption || '').trim();
  const comando = texto.startsWith('/') ? texto.split(/\s+/)[0].split('@')[0].toLowerCase() : undefined;
  const token = (tokenBot ?? process.env.TELEGRAM_BOT_TOKEN ?? '').trim();
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
