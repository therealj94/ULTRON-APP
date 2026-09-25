/**
 * Canales reales. Si falta clave, no se envía y se dice. Cero teatro.
 */

import fs from 'node:fs';
import path from 'node:path';
import { textoAPdf } from './pdf';
import { clave } from './boveda';

export type Envio = { ok: boolean; via: string; detalle: string; archivo?: string };

const PDF_DIR = path.join(process.cwd(), 'data', 'pdfs');

export function guardarPdf(nombre: string, buf: Buffer): string {
  fs.mkdirSync(PDF_DIR, { recursive: true });
  const id = `${Date.now().toString(36)}-${nombre.replace(/[^a-z0-9]+/gi, '-').slice(0, 24)}.pdf`;
  fs.writeFileSync(path.join(PDF_DIR, id), buf);
  return id;
}

export function leerPdf(id: string): Buffer | null {
  const safe = path.basename(id);
  const p = path.join(PDF_DIR, safe);
  return fs.existsSync(p) ? fs.readFileSync(p) : null;
}

export function hacerPdf(titulo: string, cuerpo: string) {
  const buf = textoAPdf({ titulo, cuerpo });
  const id = guardarPdf(titulo, buf);
  return { id, bytes: buf.length };
}

async function telegram(opts: { texto?: string; pdf?: { id: string; buf: Buffer; filename: string } }): Promise<Envio> {
  const token = clave('telegram_token');
  const chat = clave('telegram_chat');
  if (!token || !chat) return { ok: false, via: 'telegram', detalle: 'Falta TELEGRAM_BOT_TOKEN o TELEGRAM_CHAT_ID. No envié nada.' };
  const base = `https://api.telegram.org/bot${token}`;
  try {
    if (opts.pdf) {
      const form = new FormData();
      form.set('chat_id', chat);
      form.set('caption', (opts.texto || opts.pdf.filename).slice(0, 900));
      form.set('document', new Blob([new Uint8Array(opts.pdf.buf)], { type: 'application/pdf' }), opts.pdf.filename);
      const r = await fetch(`${base}/sendDocument`, { method: 'POST', body: form, signal: AbortSignal.timeout(20000) });
      const j: any = await r.json().catch(() => ({}));
      if (!r.ok || !j.ok) return { ok: false, via: 'telegram', detalle: `Telegram ${r.status}: ${JSON.stringify(j).slice(0, 160)}` };
      return { ok: true, via: 'telegram', detalle: `PDF enviado a chat ${chat}.`, archivo: opts.pdf.id };
    }
    const r = await fetch(`${base}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chat, text: String(opts.texto || '').slice(0, 3500) }),
      signal: AbortSignal.timeout(12000),
    });
    const j: any = await r.json().catch(() => ({}));
    if (!r.ok || !j.ok) return { ok: false, via: 'telegram', detalle: `Telegram ${r.status}: ${JSON.stringify(j).slice(0, 160)}` };
    return { ok: true, via: 'telegram', detalle: `Mensaje enviado a chat ${chat}.` };
  } catch (e: any) {
    return { ok: false, via: 'telegram', detalle: String(e?.message || e).slice(0, 160) };
  }
}

async function whatsapp(texto: string, mediaUrl?: string): Promise<Envio> {
  const sid = process.env.TWILIO_ACCOUNT_SID || '';
  const tok = process.env.TWILIO_AUTH_TOKEN || '';
  const from = process.env.TWILIO_WHATSAPP_FROM || '';
  const to = process.env.JEFE_WHATSAPP || '';
  if (!sid || !tok || !from || !to) {
    return { ok: false, via: 'whatsapp', detalle: 'Falta TWILIO_* o JEFE_WHATSAPP. No envié nada.' };
  }
  const body = new URLSearchParams({ From: from.startsWith('whatsapp:') ? from : `whatsapp:${from}`, To: to.startsWith('whatsapp:') ? to : `whatsapp:${to}`, Body: texto.slice(0, 1500) });
  if (mediaUrl) body.set('MediaUrl', mediaUrl);
  try {
    const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
      method: 'POST',
      headers: { Authorization: 'Basic ' + Buffer.from(`${sid}:${tok}`).toString('base64'), 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
      signal: AbortSignal.timeout(15000),
    });
    const j: any = await r.json().catch(() => ({}));
    if (!r.ok) return { ok: false, via: 'whatsapp', detalle: `Twilio ${r.status}: ${JSON.stringify(j).slice(0, 160)}` };
    return { ok: true, via: 'whatsapp', detalle: `WhatsApp aceptado (${j.sid || 'ok'}).` };
  } catch (e: any) {
    return { ok: false, via: 'whatsapp', detalle: String(e?.message || e).slice(0, 160) };
  }
}

async function correo(opts: { para?: string; asunto: string; texto: string; pdf?: { filename: string; buf: Buffer } }): Promise<Envio> {
  const key = process.env.RESEND_API_KEY || '';
  const from = process.env.MAIL_FROM || '';
  const para = opts.para || process.env.MAIL_TO_JEFE || process.env.MAIL_FROM || '';
  if (!key || !from) return { ok: false, via: 'correo', detalle: 'Falta RESEND_API_KEY o MAIL_FROM. No envié nada.' };
  const payload: any = { from, to: [para], subject: opts.asunto.slice(0, 140), text: opts.texto.slice(0, 8000) };
  if (opts.pdf) payload.attachments = [{ filename: opts.pdf.filename, content: opts.pdf.buf.toString('base64') }];
  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(15000),
    });
    const j: any = await r.json().catch(() => ({}));
    if (!r.ok) return { ok: false, via: 'correo', detalle: `Resend ${r.status}: ${JSON.stringify(j).slice(0, 160)}` };
    return { ok: true, via: 'correo', detalle: `Correo aceptado hacia ${para}.` };
  } catch (e: any) {
    return { ok: false, via: 'correo', detalle: String(e?.message || e).slice(0, 160) };
  }
}

async function llamada(texto: string): Promise<Envio> {
  const sid = process.env.TWILIO_ACCOUNT_SID || '';
  const tok = process.env.TWILIO_AUTH_TOKEN || '';
  const from = process.env.TWILIO_VOICE_FROM || '';
  const to = process.env.JEFE_TELEFONO || '';
  if (!sid || !tok || !from || !to) {
    return { ok: false, via: 'llamada', detalle: 'Falta TWILIO_VOICE_FROM o JEFE_TELEFONO. No llamé.' };
  }
  const twiml = `<Response><Say language="es-MX" voice="Polly.Andres">${escapeXml(texto.slice(0, 400))}</Say></Response>`;
  const body = new URLSearchParams({ From: from, To: to, Twiml: twiml });
  try {
    const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Calls.json`, {
      method: 'POST',
      headers: { Authorization: 'Basic ' + Buffer.from(`${sid}:${tok}`).toString('base64'), 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
      signal: AbortSignal.timeout(15000),
    });
    const j: any = await r.json().catch(() => ({}));
    if (!r.ok) return { ok: false, via: 'llamada', detalle: `Twilio ${r.status}: ${JSON.stringify(j).slice(0, 160)}` };
    return { ok: true, via: 'llamada', detalle: `Llamada iniciada a ${to} (${j.sid || 'ok'}).` };
  } catch (e: any) {
    return { ok: false, via: 'llamada', detalle: String(e?.message || e).slice(0, 160) };
  }
}

function escapeXml(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export async function telegramFoto(opts: { buf: Buffer; caption?: string; filename?: string; chatId?: string | number }): Promise<Envio> {
  const token = clave('telegram_token');
  const chat = String(opts.chatId || clave('telegram_chat'));
  if (!token || !chat) return { ok: false, via: 'telegram', detalle: 'Falta Telegram en la bóveda. No mandé la foto.' };
  try {
    const form = new FormData();
    form.set('chat_id', chat);
    form.set('caption', String(opts.caption || 'Captura de AU-RA').slice(0, 900));
    form.set('photo', new Blob([new Uint8Array(opts.buf)], { type: 'image/jpeg' }), opts.filename || 'ultron.jpg');
    const r = await fetch(`https://api.telegram.org/bot${token}/sendPhoto`, {
      method: 'POST',
      body: form,
      signal: AbortSignal.timeout(20000),
    });
    const j: any = await r.json().catch(() => ({}));
    if (!r.ok || !j.ok) return { ok: false, via: 'telegram', detalle: `Telegram foto ${r.status}: ${JSON.stringify(j).slice(0, 160)}` };
    return { ok: true, via: 'telegram', detalle: 'Foto enviada a la junta.' };
  } catch (e: any) {
    return { ok: false, via: 'telegram', detalle: String(e?.message || e).slice(0, 160) };
  }
}

export async function telegramVoz(opts: { buf: Buffer; caption?: string; chatId?: string | number }): Promise<Envio> {
  const token = clave('telegram_token');
  const chat = String(opts.chatId || clave('telegram_chat'));
  if (!token || !chat) return { ok: false, via: 'telegram', detalle: 'Falta Telegram en la bóveda. No mandé la voz.' };
  try {
    const form = new FormData();
    form.set('chat_id', chat);
    form.set('caption', String(opts.caption || 'AU-RA').slice(0, 900));
    form.set('disable_notification', 'false');
    form.set('voice', new Blob([new Uint8Array(opts.buf)], { type: 'audio/mpeg' }), 'ultron.mp3');
    let r = await fetch(`https://api.telegram.org/bot${token}/sendVoice`, {
      method: 'POST',
      body: form,
      signal: AbortSignal.timeout(20000),
    });
    let j: any = await r.json().catch(() => ({}));
    if (!r.ok || !j.ok) {
      const form2 = new FormData();
      form2.set('chat_id', chat);
      form2.set('caption', String(opts.caption || 'AU-RA').slice(0, 900));
      form2.set('audio', new Blob([new Uint8Array(opts.buf)], { type: 'audio/mpeg' }), 'ultron.mp3');
      r = await fetch(`https://api.telegram.org/bot${token}/sendAudio`, {
        method: 'POST',
        body: form2,
        signal: AbortSignal.timeout(20000),
      });
      j = await r.json().catch(() => ({}));
    }
    if (!r.ok || !j.ok) return { ok: false, via: 'telegram', detalle: `Telegram voz ${r.status}: ${JSON.stringify(j).slice(0, 160)}` };
    return { ok: true, via: 'telegram', detalle: 'Nota de voz enviada a la junta.' };
  } catch (e: any) {
    return { ok: false, via: 'telegram', detalle: String(e?.message || e).slice(0, 160) };
  }
}

export async function telegramUrgente(texto: string, voz?: Buffer): Promise<Envio> {
  const token = clave('telegram_token');
  const chat = clave('telegram_chat');
  if (!token || !chat) return { ok: false, via: 'telegram', detalle: 'Falta Telegram en la bóveda. No avisé.' };
  const body = `URGENTE · AU-RA\n${String(texto || 'Te necesita la junta.').slice(0, 3000)}`;
  try {
    const r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chat, text: body, disable_notification: false }),
      signal: AbortSignal.timeout(12000),
    });
    const j: any = await r.json().catch(() => ({}));
    if (!r.ok || !j.ok) return { ok: false, via: 'telegram', detalle: `Telegram urgente ${r.status}: ${JSON.stringify(j).slice(0, 160)}` };
    if (voz && voz.length > 80) {
      const v = await telegramVoz({ buf: voz, caption: 'AU-RA urgente' });
      return { ok: v.ok, via: 'telegram', detalle: `Aviso urgente enviado. ${v.detalle}` };
    }
    return { ok: true, via: 'telegram', detalle: 'Aviso urgente enviado (suena el teléfono). El bot de Telegram no hace llamada de voz tipo teléfono.' };
  } catch (e: any) {
    return { ok: false, via: 'telegram', detalle: String(e?.message || e).slice(0, 160) };
  }
}

export const canales = { telegram, whatsapp, correo, llamada, telegramFoto, telegramVoz, telegramUrgente };
