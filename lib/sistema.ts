/**
 * Foto del sistema: nodos vivos, canales listos, qué falta. Sin fingir reparaciones.
 */

import { ejecutorActivo } from './ejecutor';
import { clave } from './boveda';

export type Nodo = { id: string; vivo: boolean; detalle: string };

async function probe(url: string, headers: Record<string, string> = {}, timeoutMs = 4000) {
  if (!url) return { ok: false, status: 0, text: 'URL vacía' };
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(url, { headers, signal: ctrl.signal });
    const text = await r.text();
    return { ok: r.ok || r.status === 401, status: r.status, text: text.slice(0, 160) };
  } catch (e: any) {
    return { ok: false, status: 0, text: String(e?.message || e).slice(0, 160) };
  } finally {
    clearTimeout(t);
  }
}

export type Canal = { id: string; nombre: string; listo: boolean; falta?: string };

export function catalogoCanales(): Canal[] {
  const tg = !!(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID);
  const tgIn = tg && !!process.env.TELEGRAM_WEBHOOK_SECRET;
  const codigo = ejecutorActivo();
  const wa = !!(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_WHATSAPP_FROM && process.env.JEFE_WHATSAPP);
  const mail = !!(process.env.RESEND_API_KEY && process.env.MAIL_FROM);
  const call = !!(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_VOICE_FROM && process.env.JEFE_TELEFONO);
  return [
    { id: 'sistema', nombre: 'Estado de nodos', listo: true },
    { id: 'tareas', nombre: 'Pendientes', listo: true },
    { id: 'pdf', nombre: 'Generar PDF', listo: true },
    { id: 'pdf-leer', nombre: 'Leer PDF subido', listo: true },
    { id: 'codigo', nombre: 'Código y ejecutor', listo: codigo, falta: codigo ? undefined : 'EJECUTOR_ACTIVO=false' },
    { id: 'web', nombre: 'Buscar / leer páginas', listo: true },
    { id: 'vision', nombre: 'Ver imágenes', listo: !!(clave('ojo_url') && clave('ojo_clave')) || !!clave('gemini'), falta: !!(clave('ojo_url') && clave('ojo_clave')) || !!clave('gemini') ? undefined : 'ULTRON_OJO_* o GEMINI_API_KEY' },
    { id: 'telegram', nombre: 'Telegram (enviar)', listo: tg, falta: tg ? undefined : 'TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID' },
    { id: 'telegram-in', nombre: 'Telegram (responder)', listo: tgIn, falta: tgIn ? undefined : 'TELEGRAM_WEBHOOK_SECRET + chat de junta' },
    { id: 'memoria', nombre: 'Memoria durable José/Medardo', listo: !!(process.env.ULTRON_MEMORIA_BUCKET && process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY), falta: process.env.ULTRON_MEMORIA_BUCKET ? undefined : 'ULTRON_MEMORIA_BUCKET + AWS_*' },
    { id: 'whatsapp', nombre: 'WhatsApp', listo: wa, falta: wa ? undefined : 'TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_WHATSAPP_FROM, JEFE_WHATSAPP' },
    { id: 'correo', nombre: 'Correo', listo: mail, falta: mail ? undefined : 'RESEND_API_KEY + MAIL_FROM' },
    { id: 'llamada', nombre: 'Llamada de voz', listo: call, falta: call ? undefined : 'TWILIO_VOICE_FROM + JEFE_TELEFONO' },
  ];
}

export async function fotoSistema(): Promise<{ nodos: Nodo[]; canales: Canal[]; resumen: string }> {
  const nodoUrl = (process.env.ULTRON_NODO_URL || process.env.QWEN_ENDPOINT_URL || '').replace(/\/$/, '');
  const ojoUrl = (process.env.ULTRON_OJO_URL || process.env.PLAYWRIGHT_NODE_URL || '').replace(/\/$/, '');
  const ttsUrl = (process.env.ULTRON_TTS_URL || '').replace(/\/$/, '');
  const fpUrl = (process.env.ULTRON_FP_URL || process.env.ULTRON_REMOTE_URL || '').replace(/\/$/, '');

  const [qwen, ojo, tts, fp] = await Promise.all([
    nodoUrl
      ? probe(`${nodoUrl}/salud`, { 'x-ultron-secreto': process.env.ULTRON_NODO_SECRETO || '' })
      : Promise.resolve({ ok: false, status: 0, text: 'ULTRON_NODO_URL vacío' }),
    ojoUrl
      ? probe(`${ojoUrl}/salud`, { 'X-Ojo-Clave': process.env.ULTRON_OJO_CLAVE || '' })
      : Promise.resolve({ ok: false, status: 0, text: 'ULTRON_OJO_URL vacío' }),
    ttsUrl
      ? probe(`${ttsUrl}/salud`, { 'x-ultron-tts-clave': process.env.ULTRON_TTS_CLAVE || '' })
      : Promise.resolve({ ok: false, status: 0, text: 'ULTRON_TTS_URL vacío' }),
    fpUrl ? probe(`${fpUrl}/salud`) : Promise.resolve({ ok: false, status: 0, text: 'ULTRON_FP_URL vacío' }),
  ]);

  const nodos: Nodo[] = [
    { id: 'qwen', vivo: qwen.ok, detalle: qwen.ok ? 'cerebro responde' : qwen.text },
    { id: 'ojo', vivo: ojo.ok, detalle: ojo.ok ? 'Playwright/visión' : ojo.text },
    { id: 'tts', vivo: tts.ok, detalle: tts.ok ? 'TTS responde' : tts.text },
    { id: 'fp', vivo: fp.ok, detalle: fp.ok ? 'FP responde' : fp.text },
    { id: 'eleven', vivo: !!process.env.ELEVENLABS_API_KEY, detalle: process.env.ELEVENLABS_API_KEY ? 'clave presente' : 'ELEVENLABS_API_KEY vacío' },
  ];
  const canales = catalogoCanales();
  const caidos = nodos.filter((n) => !n.vivo).map((n) => n.id);
  const listos = canales.filter((c) => c.listo).map((c) => c.nombre);
  const faltan = canales.filter((c) => !c.listo).map((c) => `${c.nombre} (${c.falta})`);
  const resumen =
    `SISTEMA: nodos ${nodos.filter((n) => n.vivo).map((n) => n.id).join(', ') || 'ninguno vivo'}` +
    (caidos.length ? `. Caídos: ${caidos.join(', ')}.` : '. Todos los nodos medidos responden.') +
    ` Canales listos: ${listos.join(', ')}. Faltan claves: ${faltan.join('; ') || 'ninguno'}.` +
    ' No se toca el nodo Qwen. Reparar = re-probar o redesplegar la mesa en Render si lo pides.';
  return { nodos, canales, resumen };
}

export async function redesplegarMesa(): Promise<{ ok: boolean; detalle: string }> {
  const key = process.env.RENDER_API_KEY || '';
  const id = process.env.RENDER_SERVICE_ID || '';
  if (!key || !id) return { ok: false, detalle: 'Falta RENDER_API_KEY o RENDER_SERVICE_ID. No redesplegué nada.' };
  try {
    const r = await fetch(`https://api.render.com/v1/services/${id}/deploys`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
      signal: AbortSignal.timeout(15000),
    });
    const t = await r.text();
    if (!r.ok) return { ok: false, detalle: `Render ${r.status}: ${t.slice(0, 180)}` };
    return { ok: true, detalle: 'Render aceptó un deploy de la mesa. Tarda unos minutos.' };
  } catch (e: any) {
    return { ok: false, detalle: String(e?.message || e).slice(0, 180) };
  }
}
