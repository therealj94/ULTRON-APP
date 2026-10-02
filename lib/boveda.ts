/**
 * Bóveda: un solo lugar para saber qué claves hay. Nunca se dumpa el valor.
 * Overlay en memoria (POST /api/vault/...) gana sobre process.env hasta el redeploy.
 */

export type Caja = {
  id: string;
  nombre: string;
  listo: boolean;
  falta?: string;
  usa: string;
};

const overlay = new Map<string, string>();

const ENV: Record<string, string[]> = {
  voicebox_url: ['VOICEBOX_URL'],
  voicebox_clave: ['VOICEBOX_CLAVE'],
  gemini: ['GEMINI_API_KEY'],
  elevenlabs: ['ELEVENLABS_API_KEY', 'XI_API_KEY'],
  ojo_url: ['ULTRON_OJO_URL', 'PLAYWRIGHT_NODE_URL'],
  ojo_clave: ['ULTRON_OJO_CLAVE'],
  nodo_url: ['ULTRON_NODO_URL', 'QWEN_ENDPOINT_URL'],
  nodo_secreto: ['ULTRON_NODO_SECRETO'],
  telegram_token: ['TELEGRAM_BOT_TOKEN'],
  telegram_chat: ['TELEGRAM_CHAT_ID'],
  telegram_webhook: ['TELEGRAM_WEBHOOK_SECRET'],
  aws_key: ['AWS_ACCESS_KEY_ID'],
  aws_secret: ['AWS_SECRET_ACCESS_KEY'],
  memoria_bucket: ['ULTRON_MEMORIA_BUCKET'],
  twilio_sid: ['TWILIO_ACCOUNT_SID'],
  twilio_tok: ['TWILIO_AUTH_TOKEN'],
  twilio_wa: ['TWILIO_WHATSAPP_FROM'],
  twilio_voz: ['TWILIO_VOICE_FROM'],
  jefe_wa: ['JEFE_WHATSAPP'],
  jefe_tel: ['JEFE_TELEFONO'],
  resend: ['RESEND_API_KEY'],
  mail_from: ['MAIL_FROM'],
  // La computadora de los agentes (scripts/nodo-computadora): https://<ip>.sslip.io/api y su clave.
  computadora_url: ['COMPUTADORA_URL'],
  computadora_clave: ['COMPUTADORA_CLAVE'],
  // El WhatsApp personal (servicios/whatsapp-puente, servicio privado de Render) y quién lo puede ver.
  whatsapp_url: ['WHATSAPP_PUENTE_URL'],
  whatsapp_clave: ['WHATSAPP_PUENTE_CLAVE'],
  whatsapp_duenos: ['WHATSAPP_DUENOS'],
  // Correo de cada persona: la llave con que se cifran sus claves (si falta, la de la sesión) y la app de
  // Microsoft para entrar a Outlook/Microsoft 365 con OAuth (lib/correo).
  correo_cifrado: ['CORREO_CLAVE_CIFRADO', 'ULTRON_SESION_SECRETO'],
  ms_client_id: ['MS_CLIENT_ID'],
  // Los avisos al teléfono con la app cerrada (lib/push.ts): el JSON entero de la cuenta de servicio de Firebase.
  firebase_cuenta: ['FIREBASE_SERVICE_ACCOUNT'],
};

export function clave(id: string): string {
  const over = overlay.get(id);
  if (over) return over;
  for (const k of ENV[id] || [id]) {
    const v = String(process.env[k] || '').trim();
    if (v) return v;
  }
  return '';
}

export function guardarCaja(id: string, valor: string) {
  const v = String(valor || '').trim();
  if (!v) {
    overlay.delete(id);
    return;
  }
  overlay.set(id, v);
}

export function cajas(): Caja[] {
  const ojo = !!(clave('ojo_url') && clave('ojo_clave'));
  const tg = !!(clave('telegram_token') && clave('telegram_chat'));
  const wa = !!(clave('twilio_sid') && clave('twilio_tok') && clave('twilio_wa') && clave('jefe_wa'));
  const call = !!(clave('twilio_sid') && clave('twilio_tok') && clave('twilio_voz') && clave('jefe_tel'));
  const mail = !!(clave('resend') && clave('mail_from'));
  const mem = !!(clave('aws_key') && clave('aws_secret') && clave('memoria_bucket'));
  const voz = !!(clave('voicebox_url') && clave('voicebox_clave'));
  return [
    { id: 'qwen', nombre: 'Cerebro Qwen', listo: !!clave('nodo_url'), falta: clave('nodo_url') ? undefined : 'ULTRON_NODO_URL', usa: 'pensar y contestar' },
    { id: 'ojo', nombre: 'Ojo (visión + páginas)', listo: ojo, falta: ojo ? undefined : 'ULTRON_OJO_URL + ULTRON_OJO_CLAVE', usa: 'ver fotos y capturar pantallas' },
    { id: 'gemini', nombre: 'Visión Gemini (reserva)', listo: !!clave('gemini'), falta: clave('gemini') ? undefined : 'GEMINI_API_KEY', usa: 'leer imagen si el ojo no responde' },
    { id: 'elevenlabs', nombre: 'Voz y oído ElevenLabs (Dr Electrum)', listo: !!clave('elevenlabs'), falta: clave('elevenlabs') ? undefined : 'ELEVENLABS_API_KEY', usa: 'voz v4 Turbo de Dr Electrum y dictado con Scribe; Voicebox queda de respaldo' },
    { id: 'voz', nombre: 'Voz y oído (Voicebox)', listo: voz, falta: voz ? undefined : 'VOICEBOX_URL + VOICEBOX_CLAVE', usa: 'hablar, oír notas de voz, nota de voz urgente' },
    { id: 'telegram', nombre: 'Telegram junta', listo: tg, falta: tg ? undefined : 'TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID', usa: 'chat, fotos, aviso urgente' },
    { id: 'telegram-in', nombre: 'Telegram webhook', listo: tg && !!clave('telegram_webhook'), falta: clave('telegram_webhook') ? undefined : 'TELEGRAM_WEBHOOK_SECRET', usa: 'responder desde Telegram' },
    { id: 'memoria', nombre: 'Memoria S3 (José / Medardo / Carlos / Mayra)', listo: mem, falta: mem ? undefined : 'ULTRON_MEMORIA_BUCKET + AWS_*', usa: 'conversaciones y hechos que no se pierden al redesplegar' },
    { id: 'whatsapp', nombre: 'WhatsApp', listo: wa, falta: wa ? undefined : 'TWILIO_* + JEFE_WHATSAPP', usa: 'mensajes WhatsApp' },
    { id: 'correo', nombre: 'Correo', listo: mail, falta: mail ? undefined : 'RESEND_API_KEY + MAIL_FROM', usa: 'email' },
    { id: 'llamada', nombre: 'Llamada telefónica', listo: call, falta: call ? undefined : 'TWILIO_VOICE_FROM + JEFE_TELEFONO', usa: 'llamada de verdad (no Telegram)' },
  ];
}

export function fotoBoveda(): { honesto: true; cajas: Caja[]; listos: string[]; faltan: string[]; resumen: string } {
  const all = cajas();
  const listos = all.filter((c) => c.listo).map((c) => c.nombre);
  const faltan = all.filter((c) => !c.listo).map((c) => `${c.nombre} (${c.falta})`);
  const resumen =
    `BÓVEDA: listos [${listos.join(', ') || 'ninguno'}]. ` +
    `Sin clave: ${faltan.join('; ') || 'ninguna'}. ` +
    'No recito secretos. Telegram no hace llamada de teléfono; urgente = mensaje que suena + nota de voz si Voicebox responde.';
  return { honesto: true, cajas: all, listos, faltan, resumen };
}
