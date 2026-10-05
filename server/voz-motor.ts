/**
 * EL PROTOTIPO DE SPEECH ENGINE (docs/voz/SPEECH-ENGINE.md): la llamada en vivo por una conexión directa.
 *
 * Hoy la llamada va por un agente de ElevenLabs con «LLM propio»: cada turno es una petición HTTP a
 * /api/voz/llm (server/voz-agente.ts) y la interrupción se infiere (ElevenLabs corta la petición, o la
 * respuesta vuelve recortada en el historial). Speech Engine invierte la conexión: ElevenLabs abre UN
 * WebSocket por llamada hacia nosotros y por él manda `init`, `user_transcript` (con todo el historial y un
 * `event_id` que sube), `ping` y `close`; nosotros contestamos `agent_response` a trozos (con el `event_id`
 * al que responden) y `pong`. Fuente: https://elevenlabs.io/docs/api-reference/speech-engine/speech-engine-upstream
 *
 * VA EN PARALELO Y APAGADO: no toca los agentes, las voces ni los números, y solo se usa si
 *  1. el servidor tiene el motor encendido (AURA_MOTOR_VOZ=speech-engine; sin eso ni se escucha el WebSocket),
 *  2. la cuenta está en el interruptor `motorVozCuentas` (lib/interruptores.ts, lo cambia quien tiene mando), y
 *  3. hay un recurso de Speech Engine para ese avatar e idioma (ELEVENLABS_SPEECH_ENGINE_<AVATAR>_<IDIOMA>).
 * Si falta cualquiera, /api/voz/agente da el agente de siempre y su respuesta no cambia en nada.
 *
 * EL MISMO CEREBRO, SIN DUPLICAR: cada `user_transcript` se convierte en una petición INTERNA a la misma ruta
 * del LLM propio (la que devuelve montarVozAgente), con el historial en formato OpenAI y el pase de quien
 * habla. Así pasan por el mismo sitio el pase y la sesión viva, el nivel y los permisos (solo consulta, sin
 * mando), la vista autorizada («No usarlo»: la arma el cerebro con su memoria; el historial de ElevenLabs no
 * llega al cerebro, solo la última frase), los cupos y los minutos de voz, el reintento que se engancha, el
 * turno especulativo (las acciones esperan su confirmación), la frase de espera si el cerebro tarda, el
 * cerebro de respaldo y las frases de fallo. Lo de aquí es solo el idioma de Speech Engine:
 *  · un `event_id` nuevo mientras el turno anterior seguía saliendo: ese turno se suelta (es la interrupción
 *    «nativa»: ElevenLabs descarta igual lo que llegue con el id viejo);
 *  · el mismo `event_id` otra vez: no es otro turno;
 *  · «ajá», «mjm» mientras AURA hablaba: no corta el cerebro; lo que faltaba se sigue diciendo con el id
 *    nuevo, desde donde la persona dejó de oír (sin repetir lo que ya oyó);
 *  · si la ruta contesta con un error (sin pase válido, freno), una frase y no un silencio, o se cierra.
 *
 * LA AUTENTICIDAD, como dice la documentación: cada conexión trae `X-Elevenlabs-Speech-Engine-Authorization`,
 * un JWT HS256 firmado con el SHA-256 de nuestra llave de ElevenLabs (iss y sub fijos, exp con 60 s de
 * holgura). Y, como el «LLM propio» de hoy, una segunda llave nuestra (`X-Aura-Motor`) guardada en los
 * secretos de ElevenLabs. Quién habla viaja como hoy, en el pase firmado: la cabecera `X-Pase` (variable
 * dinámica) o, si ElevenLabs no la reenvía, el teléfono lo ata a la conversación (/api/voz/motor/vincular).
 *
 * Sin dependencias nuevas: el WebSocket de servidor (RFC 6455, solo texto) está aquí abajo, chico y probado
 * contra el cliente WebSocket de undici.
 */
import crypto from 'crypto';
import { EventEmitter } from 'events';
import type http from 'http';
import type { Duplex } from 'stream';
import type express from 'express';
import { clave } from '../lib/boveda';
import { interruptor } from '../lib/interruptores';
import { quitarExpresiones } from '../lib/expresiones';
import { mismoSecreto, secretoDerivado, type Sesion } from './seguridad';
import { normalizarIdioma, type AvatarVoz, type Idioma } from './eleven';
import { ETIQUETA_SECRETO_LLM, PHRASES, leerPase, ultimoDeLaPersona } from './voz-agente';
import { anotarTurnoVoz, comparacionVoz, fijarRedVoz, marcarMotor, type Interrupcion, type MedidaTurnoVoz } from './voz-medidas';

/* ------------------------------------------------------------------ la configuración */

export const RUTA_MOTOR = '/api/voz/motor';
/** La segunda llave (como «aura-llm» del agente): se deriva del secreto de las sesiones. */
export const ETIQUETA_SECRETO_MOTOR = 'elevenlabs-motor-v1';
export const CABECERA_JWT = 'x-elevenlabs-speech-engine-authorization';
export const CABECERA_LLAVE = 'x-aura-motor';
export const EMISOR_JWT = 'https://api.elevenlabs.io/convai/speech-engine';
export const SUJETO_JWT = 'convai_speech_engine_upstream';
export const HOLGURA_JWT_S = 60;
/** Cuánto se espera a que el teléfono ate la conversación a su pase (si ElevenLabs no reenvió `X-Pase`). */
export const VINCULAR_MS = 6_000;
/** Lo que dura un vínculo sin que llegue su conversación. */
export const VINCULO_TTL_MS = 60_000;
/** Un mensaje de ElevenLabs trae todo el historial: 20 minutos de charla caben de sobra. */
export const MAX_MENSAJE = 4 * 1024 * 1024;

/** El motor encendido en ESTE servidor (variable de entorno; por omisión, apagado para todos). */
export function motorEncendido(): boolean {
  return String(process.env.AURA_MOTOR_VOZ || '').trim().toLowerCase() === 'speech-engine';
}

/** El recurso de Speech Engine de ese avatar e idioma (un id `seng_…`), o '' si no hay. */
export function idMotorDe(avatar: AvatarVoz, idioma: Idioma): string {
  const v = String(process.env[`ELEVENLABS_SPEECH_ENGINE_${avatar.toUpperCase()}_${idioma.toUpperCase()}`] || '').trim();
  return /^seng_[A-Za-z0-9]{6,64}$/.test(v) ? v : '';
}

/**
 * La primera frase de la llamada: la misma que dicen los agentes (scripts/elevenlabs-agentes.ts, PRIMERA; una
 * prueba mira que sigan iguales). Speech Engine no tiene primer mensaje propio: lo pide el teléfono
 * (`overrides.agent.firstMessage`), con la opción `overrides.first_message` encendida en el recurso.
 */
export const PRIMERA_MOTOR: Record<AvatarVoz, Record<Idioma, string>> = {
  ojos: { es: 'Te escucho.', en: 'I’m listening.' },
  aura: { es: 'Aquí estoy. Te escucho.', en: 'I’m here. I’m listening.' },
  claudio: { es: '¡Aquí estoy! Cuéntame.', en: 'I’m here! Tell me.' },
  antonio: { es: '¡Aquí ANT-ONIO! ¿En qué te echo una mano?', en: 'ANT-ONIO here! What can I help you with?' },
};

/** Para /api/voz/agente (server/voz-agente.ts, `motorDe`): el recurso que se abre en vez del agente, o null. */
export function motorDe(correo: string, avatar: AvatarVoz, idioma: Idioma): { id: string; primerMensaje: string } | null {
  if (!motorEncendido()) return null;
  const cuentas = interruptor('motorVozCuentas');
  if (!Array.isArray(cuentas) || !cuentas.includes(String(correo || '').toLowerCase())) return null;
  const id = idMotorDe(avatar, idioma);
  return id ? { id, primerMensaje: PRIMERA_MOTOR[avatar][idioma] } : null;
}

/* ------------------------------------------------------------------ asentir no es interrumpir */

/**
 * Lo que es asentir mientras AURA habla: la misma lista que los agentes le dan a ElevenLabs
 * (scripts/elevenlabs-agentes.ts, ASENTIR → `interruption_ignore_terms`; una prueba mira que sigan iguales)
 * más sus variantes escritas («mjm», «aja»). En Speech Engine la lista también se le da al recurso (`turn`);
 * esto es la red por si igual llega como turno.
 */
export const ASENTIR_MOTOR: Record<Idioma, string[]> = {
  es: ['ajá', 'sí', 'ok', 'okay', 'mhm', 'claro', 'ya', 'exacto', 'ah ok', 'vale'],
  en: ['uh-huh', 'yeah', 'yes', 'ok', 'okay', 'mhm', 'right', 'sure', 'got it'],
};
const VARIANTES_ASENTIR = ['aja', 'aha', 'aham', 'ajam', 'mjm', 'mm', 'mmm', 'hmm', 'mhmm', 'uh huh', 'si', 'ah', 'oh ok'];
const plano = (t: string) =>
  String(t || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[-–—]/g, ' ')
    .replace(/[^a-z0-9ñ\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
const ASENTIR_PLANO = new Set([...ASENTIR_MOTOR.es, ...ASENTIR_MOTOR.en, ...VARIANTES_ASENTIR].map(plano));

/** ¿La frase es solo asentir («Ajá.», «sí, sí», «mjm»)? Como mucho cuatro palabras, todas de asentir. */
export function esAsentimiento(texto: string): boolean {
  const p = plano(texto);
  if (!p) return false;
  if (ASENTIR_PLANO.has(p)) return true;
  const palabras = p.split(' ');
  if (palabras.length > 4) return false;
  // «ah ok ah ok», «sí sí», «mjm, ajá»: cada palabra (o pareja) es de asentir.
  for (let i = 0; i < palabras.length; ) {
    if (i + 1 < palabras.length && ASENTIR_PLANO.has(`${palabras[i]} ${palabras[i + 1]}`)) i += 2;
    else if (ASENTIR_PLANO.has(palabras[i])) i += 1;
    else return false;
  }
  return true;
}

/* ------------------------------------------------------------------ la autenticidad */

const b64url = (s: string) => Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64');

/**
 * El JWT de ElevenLabs (https://elevenlabs.io/docs/api-reference/speech-engine/speech-engine-upstream,
 * «Authentication»): HS256 con el SHA-256 de la llave como secreto, `iss` y `sub` fijos, `exp` e `iat` con
 * 60 s de holgura. La llave de una región de residencia (`…_residency_xx`) firma sin ese sufijo (así lo
 * hace su SDK). Nunca dice la llave ni el token: solo el motivo.
 */
export function verificarJwtMotor(valor: unknown, apiKey: string, ahora = Date.now()): { ok: true } | { ok: false; motivo: string } {
  let token = String(Array.isArray(valor) ? valor[0] : valor || '').trim();
  if (/^bearer\s+/i.test(token)) token = token.replace(/^bearer\s+/i, '').trim();
  const llave = String(apiKey || '').trim().replace(/_residency_[a-z0-9]+$/, '');
  if (!llave) return { ok: false, motivo: 'sin llave de ElevenLabs en el servidor' };
  const partes = token.split('.');
  if (partes.length !== 3 || partes.some((p) => !p)) return { ok: false, motivo: 'sin JWT' };
  let cabecera: any;
  let carga: any;
  try {
    cabecera = JSON.parse(b64url(partes[0]).toString('utf8'));
    carga = JSON.parse(b64url(partes[1]).toString('utf8'));
  } catch {
    return { ok: false, motivo: 'JWT ilegible' };
  }
  if (cabecera?.alg !== 'HS256') return { ok: false, motivo: 'algoritmo no aceptado' };
  const secreto = crypto.createHash('sha256').update(llave, 'utf8').digest();
  const esperada = crypto.createHmac('sha256', secreto).update(`${partes[0]}.${partes[1]}`).digest();
  const dada = b64url(partes[2]);
  if (dada.length !== esperada.length || !crypto.timingSafeEqual(dada, esperada)) return { ok: false, motivo: 'firma que no coincide' };
  if (carga?.iss !== EMISOR_JWT) return { ok: false, motivo: 'emisor equivocado' };
  if (carga?.sub !== SUJETO_JWT) return { ok: false, motivo: 'sujeto equivocado' };
  const s = Math.floor(ahora / 1000);
  if (typeof carga.exp !== 'number' || carga.exp + HOLGURA_JWT_S < s) return { ok: false, motivo: 'vencido' };
  if (typeof carga.iat !== 'number' || carga.iat - HOLGURA_JWT_S > s) return { ok: false, motivo: 'emitido en el futuro' };
  return { ok: true };
}

/* ------------------------------------------------------------------ el WebSocket (RFC 6455, solo texto) */

const GUID_WS = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

function rechazarUpgrade(socket: Duplex, codigo: number, texto: string) {
  try {
    socket.write(`HTTP/1.1 ${codigo} ${texto}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
  } catch {
    /* ya se fue */
  }
  socket.destroy();
}

/**
 * Una conexión WebSocket del lado del servidor: mensajes de texto (también partidos en fragmentos), ping y
 * cierre. Lo que manda el cliente tiene que venir enmascarado; nada de extensiones (sin compresión).
 */
export class ConexionWs extends EventEmitter {
  private buf: Buffer = Buffer.alloc(0);
  private fragmentos: Buffer[] = [];
  private enFragmento = false;
  /** El mensaje partido es de texto (uno binario se lee y se tira). */
  private fragmentoTexto = false;
  private tamFragmento = 0;
  abierta = true;

  constructor(private readonly s: Duplex, cabeza?: Buffer) {
    super();
    s.on('data', (d: Buffer) => this.datos(d));
    s.on('close', () => this.terminar());
    s.on('error', () => this.terminar());
    if (cabeza?.length) this.datos(cabeza);
  }

  private datos(d: Buffer) {
    if (!this.abierta) return;
    this.buf = this.buf.length ? Buffer.concat([this.buf, d]) : d;
    while (this.abierta && this.uno());
  }

  /** Lee un marco si ya llegó entero. */
  private uno(): boolean {
    const b = this.buf;
    if (b.length < 2) return false;
    const fin = (b[0] & 0x80) !== 0;
    const op = b[0] & 0x0f;
    if (b[0] & 0x70) return this.cerrar(1002, 'rsv'), false;
    const conMascara = (b[1] & 0x80) !== 0;
    let largo = b[1] & 0x7f;
    let i = 2;
    if (largo === 126) {
      if (b.length < 4) return false;
      largo = b.readUInt16BE(2);
      i = 4;
    } else if (largo === 127) {
      if (b.length < 10) return false;
      if (b.readUInt32BE(2) !== 0) return this.cerrar(1009, 'grande'), false;
      largo = b.readUInt32BE(6);
      i = 10;
    }
    if (!conMascara) return this.cerrar(1002, 'sin mascara'), false;
    if (largo > MAX_MENSAJE) return this.cerrar(1009, 'grande'), false;
    if (b.length < i + 4 + largo) return false;
    const mascara = b.subarray(i, i + 4);
    const carga = Buffer.from(b.subarray(i + 4, i + 4 + largo));
    for (let k = 0; k < carga.length; k++) carga[k] ^= mascara[k & 3];
    this.buf = b.subarray(i + 4 + largo);
    if (op === 0x8) {
      const codigo = carga.length >= 2 ? carga.readUInt16BE(0) : 1000;
      this.cerrar(codigo >= 1000 && codigo < 5000 && codigo !== 1005 && codigo !== 1006 ? codigo : 1000);
      return false;
    }
    if (op === 0x9) {
      this.marco(0xa, carga);
      return true;
    }
    if (op === 0xa) return true;
    if (op === 0x1 || op === 0x2) {
      if (this.enFragmento) return this.cerrar(1002, 'fragmento'), false;
      if (fin) {
        if (op === 0x1) this.emit('mensaje', carga.toString('utf8'));
        return true;
      }
      this.enFragmento = true;
      this.fragmentos = op === 0x1 ? [carga] : [];
      this.tamFragmento = carga.length;
      this.fragmentoTexto = op === 0x1;
      return true;
    }
    if (op === 0x0) {
      if (!this.enFragmento) return this.cerrar(1002, 'continuacion'), false;
      this.tamFragmento += carga.length;
      if (this.tamFragmento > MAX_MENSAJE) return this.cerrar(1009, 'grande'), false;
      const texto = this.fragmentoTexto;
      if (texto) this.fragmentos.push(carga);
      if (fin) {
        this.enFragmento = false;
        const todo = Buffer.concat(this.fragmentos);
        this.fragmentos = [];
        if (texto) this.emit('mensaje', todo.toString('utf8'));
      }
      return true;
    }
    this.cerrar(1002, 'opcode');
    return false;
  }

  private marco(op: number, carga: Buffer) {
    const n = carga.length;
    const cab = n < 126 ? Buffer.from([0x80 | op, n]) : n < 65536 ? Buffer.from([0x80 | op, 126, n >> 8, n & 0xff]) : Buffer.alloc(10);
    if (n >= 65536) {
      cab[0] = 0x80 | op;
      cab[1] = 127;
      cab.writeUInt32BE(0, 2);
      cab.writeUInt32BE(n, 6);
    }
    try {
      this.s.write(Buffer.concat([cab, carga]));
    } catch {
      this.terminar();
    }
  }

  enviar(obj: unknown) {
    if (this.abierta) this.marco(0x1, Buffer.from(JSON.stringify(obj), 'utf8'));
  }

  cerrar(codigo = 1000, motivo = '') {
    if (!this.abierta) return;
    const m = Buffer.from(String(motivo).slice(0, 100), 'utf8');
    const carga = Buffer.alloc(2 + m.length);
    carga.writeUInt16BE(codigo, 0);
    m.copy(carga, 2);
    this.marco(0x8, carga);
    this.abierta = false;
    try {
      this.s.end();
    } catch {
      /* ya se fue */
    }
    const h = setTimeout(() => this.s.destroy(), 2_000);
    h.unref?.();
    this.emit('cierre', codigo);
  }

  private terminar() {
    if (!this.abierta) return;
    this.abierta = false;
    this.emit('cierre', 1006);
  }
}

/** Acepta el upgrade (101) si es un WebSocket bien pedido; si no, lo rechaza y devuelve null. */
export function aceptarWebSocket(req: http.IncomingMessage, socket: Duplex, cabeza?: Buffer): ConexionWs | null {
  const clave = req.headers['sec-websocket-key'];
  if (String(req.headers.upgrade || '').toLowerCase() !== 'websocket' || typeof clave !== 'string' || !clave || String(req.headers['sec-websocket-version'] || '') !== '13') {
    rechazarUpgrade(socket, 400, 'Bad Request');
    return null;
  }
  const acepta = crypto.createHash('sha1').update(clave + GUID_WS).digest('base64');
  socket.write(['HTTP/1.1 101 Switching Protocols', 'Upgrade: websocket', 'Connection: Upgrade', `Sec-WebSocket-Accept: ${acepta}`, '', ''].join('\r\n'));
  (socket as any).setNoDelay?.(true);
  return new ConexionWs(socket, cabeza);
}

/* ------------------------------------------------------------------ la respuesta interna */

/**
 * Lo poco de una respuesta de Express que usa la ruta del LLM propio: recibe su SSE en formato OpenAI y lo
 * vuelve texto para Speech Engine. «Cerrarla desde fuera» es lo mismo que hoy hace ElevenLabs cuando corta
 * la petición: la ruta lo trata igual (espera el reintento un momento y suelta el turno).
 */
export class RespuestaMotor extends EventEmitter {
  statusCode = 200;
  writableEnded = false;
  destroyed = false;
  headersSent = false;
  cuerpoJson: any = null;
  private buf = '';
  private terminada = false;

  constructor(
    private readonly alTexto: (t: string) => void,
    private readonly alFinal: () => void
  ) {
    super();
  }

  setHeader() {
    return this;
  }
  flushHeaders() {
    this.headersSent = true;
  }
  status(c: number) {
    this.statusCode = c;
    return this;
  }
  json(obj: unknown) {
    this.cuerpoJson = obj;
    this.end();
    return this;
  }
  write(trozo: unknown) {
    if (this.writableEnded || this.destroyed) return false;
    this.headersSent = true;
    this.buf += String(trozo ?? '');
    let corte: number;
    while ((corte = this.buf.indexOf('\n\n')) >= 0) {
      const bloque = this.buf.slice(0, corte).trim();
      this.buf = this.buf.slice(corte + 2);
      if (!bloque.startsWith('data:')) continue;
      const datos = bloque.slice(5).trim();
      if (datos === '[DONE]') {
        this.final();
        continue;
      }
      try {
        const j = JSON.parse(datos);
        const c = j?.choices?.[0];
        const texto = c?.delta?.content;
        if (typeof texto === 'string' && texto) this.alTexto(texto);
        if (c?.finish_reason) this.final();
      } catch {
        /* un trozo que no es JSON no es nuestro */
      }
    }
    return true;
  }
  end(trozo?: unknown) {
    if (this.writableEnded) return this;
    if (trozo !== undefined && trozo !== null && trozo !== '') this.write(trozo);
    this.writableEnded = true;
    this.final();
    this.emit('finish');
    this.emit('close');
    return this;
  }
  /** ElevenLabs ya no espera este turno (llegó otro, o colgó): como cuando corta la petición. */
  cerrarDesdeFuera() {
    if (this.writableEnded || this.destroyed) return;
    this.destroyed = true;
    this.emit('close');
  }
  private final() {
    if (this.terminada) return;
    this.terminada = true;
    this.alFinal();
  }
}

/* ------------------------------------------------------------------ una llamada */

type Turno = {
  eventId: number;
  mensaje: string;
  res: RespuestaMotor;
  /** Lo que ya salió hacia la voz en este turno. */
  enviado: string;
  /** Ya salió el `is_final` (o ya no es de nadie): no se manda nada más. */
  final: boolean;
};

export type DepsSesionMotor = {
  /** La ruta del LLM propio (montarVozAgente): el mismo camino que el agente de siempre. */
  llm: express.RequestHandler;
  enviar: (msg: unknown) => void;
  cerrar: (codigo: number, motivo: string) => void;
  ip: string;
  /** El pase que vino en la cabecera `X-Pase` (variable dinámica), o ''. */
  paseCabecera: string;
  /** Espera el pase que el teléfono ató a esta conversación (null si no llega a tiempo). */
  esperarPase: (conversacion: string) => Promise<string | null>;
  /** ¿Esta cuenta (la del pase) tiene el motor? Si no, la llamada se cierra. */
  permitido: (pase: string) => boolean;
  /** Para lo que mide el adaptador fuera de la ruta (asentir, duplicados, errores). */
  anotar?: (m: Omit<MedidaTurnoVoz, 'red'>) => void;
};

const aplanar = (t: string) => quitarExpresiones(String(t || '')).replace(/\s+/g, ' ').trim().toLowerCase();
const planaFrase = (t: string) => String(t || '').toLowerCase().replace(/\s+/g, ' ').trim();

/**
 * Lo que falta decir de `enviado` si la persona oyó hasta `oido` (el mensaje de AURA que ElevenLabs devuelve
 * en el historial, recortado a lo que alcanzó a decir). Sin `oido`: todo. Si `oido` no es el principio de lo
 * enviado no se sabe dónde quedó: nada (mejor no repetir).
 */
export function restoTrasOido(enviado: string, oido: string): string {
  const o = aplanar(oido).replace(/(\.{3}|…|—|-)$/, '').trim();
  if (!o) return enviado.replace(/^\s+/, '');
  if (!aplanar(enviado).startsWith(o)) return '';
  const partes = enviado.split(/(\s+)/);
  let acumulado = '';
  for (let i = 0; i < partes.length; i++) {
    acumulado += partes[i];
    const n = aplanar(acumulado).length;
    if (n >= o.length) {
      // Cortado a mitad de palabra: esa palabra se dice entera otra vez.
      const desde = n > o.length && partes[i].trim() ? i : i + 1;
      return partes.slice(desde).join('').replace(/^\s+/, '');
    }
  }
  return '';
}

/** El último mensaje de AURA antes de la última frase de la persona (lo que oyó), o null si no hay. */
function oidoDe(messages: { role: string; content: string }[]): string | null {
  let i = messages.length - 1;
  while (i >= 0 && messages[i].role === 'user') i--;
  return i >= 0 && messages[i].role === 'assistant' ? messages[i].content : null;
}

export class SesionMotor {
  conversacion = '';
  cerrada = false;
  private actual: Turno | null = null;
  private ultimoEvento = -Infinity;
  private pase: Promise<string | null> | null = null;
  private soltarInit: ((c: string) => void) | null = null;
  private iniciada: Promise<string>;
  private comprobado = false;

  constructor(private readonly d: DepsSesionMotor) {
    this.iniciada = new Promise((r) => (this.soltarInit = r));
  }

  /** El pase de esta llamada: el de la cabecera o el que ate el teléfono (esperando el `init`). */
  private paseDeLlamada(): Promise<string | null> {
    if (!this.pase) {
      this.pase = this.d.paseCabecera
        ? Promise.resolve(this.d.paseCabecera)
        : Promise.race([this.iniciada.then((c) => this.d.esperarPase(c)), new Promise<null>((r) => setTimeout(() => r(null), VINCULAR_MS + 1_000).unref?.())]);
    }
    return this.pase;
  }

  /** Un mensaje de ElevenLabs (ya leído del WebSocket). */
  async recibir(crudo: unknown): Promise<void> {
    if (this.cerrada) return;
    let msg: any = crudo;
    if (typeof crudo === 'string') {
      try {
        msg = JSON.parse(crudo);
      } catch {
        return;
      }
    }
    switch (msg?.type) {
      case 'init':
        this.conversacion = String(msg.conversation_id || '').slice(0, 200);
        this.soltarInit?.(this.conversacion);
        void this.comprobar();
        return;
      case 'ping':
        this.d.enviar({ type: 'pong' });
        return;
      case 'close':
        this.terminar(1000, 'fin');
        return;
      case 'user_transcript':
        return this.transcripcion(msg);
      default:
        // `error` de ElevenLabs y lo que no se conoce: nada que contestar (su error no se lee en voz).
        return;
    }
  }

  /** Que la cuenta del pase tenga el motor; si no hay pase o no lo tiene, la llamada se cierra. */
  private async comprobar(): Promise<string | null> {
    const pase = await this.paseDeLlamada();
    if (this.cerrada) return null;
    if (!pase) {
      this.terminar(1008, 'sin pase');
      return null;
    }
    if (!this.comprobado) {
      if (!this.d.permitido(pase)) {
        this.terminar(1008, 'motor no activo para esta cuenta');
        return null;
      }
      this.comprobado = true;
    }
    return pase;
  }

  private async transcripcion(msg: any) {
    const eventId = Number.isFinite(Number(msg.event_id)) ? Number(msg.event_id) : this.ultimoEvento + 1;
    if (eventId <= this.ultimoEvento) {
      // El mismo turno otra vez (o uno viejo): no es otro turno ni se piensa dos veces.
      this.anotarSuelto({ repetido: true });
      return;
    }
    this.ultimoEvento = eventId;
    const historial: any[] = Array.isArray(msg.user_transcript) ? msg.user_transcript : [];
    const messages = historial.map((m) => ({ role: m?.role === 'agent' ? 'assistant' : 'user', content: String(m?.content ?? '') }));
    const pase = await this.comprobar();
    // Mientras se esperaba el pase llegó otro turno: este ya no es de nadie.
    if (!pase || this.cerrada || eventId !== this.ultimoEvento) return;
    const ultimo = ultimoDeLaPersona(messages);
    const prev = this.actual;
    if (prev && esAsentimiento(ultimo) && this.quedaPorDecir(prev, messages)) return this.seguir(prev, eventId, messages);
    let interrupcion: Interrupcion = null;
    if (prev && !prev.final) {
      // Llegó otro turno mientras este seguía saliendo: ese ya no lo oye nadie. Si ya había dicho algo y no
      // es la misma frase otra vez (un reintento, que la ruta engancha), la persona lo interrumpió.
      if (prev.enviado.trim() && planaFrase(prev.mensaje) !== planaFrase(ultimo)) interrupcion = 'nativa';
      this.soltar(prev);
    }
    await this.empezar(eventId, messages, ultimo, pase, interrupcion);
  }

  /** ¿El turno anterior sigue saliendo, o se cortó antes de decirse entero? */
  private quedaPorDecir(prev: Turno, messages: { role: string; content: string }[]): boolean {
    if (!prev.final) return true;
    const oido = oidoDe(messages);
    return oido !== null && !!restoTrasOido(prev.enviado, oido).trim() && aplanar(oido).length < aplanar(prev.enviado).length;
  }

  /** «Ajá» mientras hablaba: el cerebro sigue, y lo que falta sale con el id nuevo desde donde dejó de oír. */
  private seguir(prev: Turno, eventId: number, messages: { role: string; content: string }[]) {
    const oido = oidoDe(messages);
    const resto = oido === null ? prev.enviado.replace(/^\s+/, '') : restoTrasOido(prev.enviado, oido);
    prev.eventId = eventId;
    if (resto.trim()) this.d.enviar({ type: 'agent_response', content: resto, event_id: eventId, is_final: false });
    if (prev.final) this.d.enviar({ type: 'agent_response', content: '', event_id: eventId, is_final: true });
    this.anotarSuelto({ asentimiento: true });
  }

  /** El turno ya no es de nadie: se cierra su respuesta (la ruta lo suelta como cuando ElevenLabs corta). */
  private soltar(t: Turno) {
    t.final = true;
    t.res.cerrarDesdeFuera();
  }

  private async empezar(eventId: number, messages: { role: string; content: string }[], mensaje: string, pase: string, interrupcion: Interrupcion) {
    const turno: Turno = {
      eventId,
      mensaje,
      enviado: '',
      final: false,
      res: new RespuestaMotor(
        (t) => this.texto(turno, t),
        () => this.fin(turno)
      ),
    };
    this.actual = turno;
    const req = {
      method: 'POST',
      url: '/api/voz/llm',
      ip: this.d.ip,
      socket: { remoteAddress: this.d.ip, setNoDelay: () => undefined },
      headers: { authorization: `Bearer ${secretoDerivado(ETIQUETA_SECRETO_LLM)}`, 'x-pase': pase, 'content-type': 'application/json' },
      body: { model: 'aura', stream: true, messages },
    };
    marcarMotor(req, { motor: 'speech-engine', interrupcion });
    try {
      await this.d.llm(req as any, turno.res as any, () => undefined);
    } catch (e: any) {
      console.warn('[voz motor] la ruta falló', String(e?.message || e).slice(0, 160));
      this.fallo(turno, 500);
    }
    // La ruta terminó sin cerrar la respuesta (no debería): se cierra aquí para que la voz no quede esperando.
    if (!turno.res.writableEnded && !turno.res.destroyed) turno.res.end();
  }

  private texto(t: Turno, texto: string) {
    if (t.final || t !== this.actual || this.cerrada) return;
    t.enviado += texto;
    this.d.enviar({ type: 'agent_response', content: texto, event_id: t.eventId, is_final: false });
  }

  private fin(t: Turno) {
    if (t.final) return;
    if (t.res.statusCode >= 400) return this.fallo(t, t.res.statusCode);
    t.final = true;
    if (t !== this.actual || this.cerrada) return;
    this.d.enviar({ type: 'agent_response', content: '', event_id: t.eventId, is_final: true });
  }

  /**
   * La ruta no contestó con voz (un error): sin pase válido o sin sesión, la llamada se cierra (como hoy,
   * que ElevenLabs cuelga); con el freno, una frase y la llamada sigue; con cualquier otro, «se me cortó».
   */
  private fallo(t: Turno, codigo: number) {
    if (t.final) return;
    t.final = true;
    if (t !== this.actual || this.cerrada) return;
    this.anotarSuelto({ error: true });
    if (codigo === 401 || codigo === 403) return this.terminar(1008, 'sin permiso');
    const idioma = this.idioma();
    const frase = codigo === 429 ? PHRASES.rapido[idioma] : PHRASES.corte[idioma];
    t.enviado += frase;
    this.d.enviar({ type: 'agent_response', content: frase, event_id: t.eventId, is_final: false });
    this.d.enviar({ type: 'agent_response', content: '', event_id: t.eventId, is_final: true });
  }

  private idiomaPase: Idioma | null = null;
  private idioma(): Idioma {
    return this.idiomaPase ?? 'es';
  }

  /** Para las frases de fallo: el idioma de la llamada (del pase). */
  fijarIdioma(i: Idioma) {
    this.idiomaPase = i;
  }

  private anotarSuelto(m: Partial<MedidaTurnoVoz>) {
    try {
      this.d.anotar?.({
        motor: 'speech-engine',
        t: Date.now(),
        conv: this.conversacion ? crypto.createHash('sha256').update(this.conversacion).digest('hex').slice(0, 10) : '',
        primerTextoMs: null,
        cerebroMs: null,
        totalMs: 0,
        puente: false,
        interrupcion: null,
        repetido: false,
        asentimiento: false,
        respaldo: false,
        error: false,
        tarde: false,
        cortado: false,
        ...m,
      });
    } catch {
      /* la medida no es la llamada */
    }
  }

  /** Cuelga: el turno en curso se suelta (la ruta corta el cerebro) y la conexión se cierra. */
  terminar(codigo: number, motivo: string) {
    if (this.cerrada) return;
    this.cerrada = true;
    if (this.actual && !this.actual.final) this.soltar(this.actual);
    this.d.cerrar(codigo, motivo);
  }
}

/* ------------------------------------------------------------------ las rutas */

export type DepsMotor = {
  /** La ruta del LLM propio que devuelve montarVozAgente. */
  llm: express.RequestHandler;
  exigirMesaODesk: express.RequestHandler;
  /** Solo el dueño (mando) ve la comparación. */
  exigirMando: express.RequestHandler;
  limitar: (max: number, ventanaMs?: number, grupo?: string) => express.RequestHandler;
  sesionDe: (req: express.Request) => Sesion | null;
  /** La llave de ElevenLabs con que firma el JWT (por omisión, la de la bóveda). */
  apiKey?: () => string;
  /** Las pruebas acortan la espera del vínculo. */
  vincularMs?: number;
  /** Las pruebas cambian quién tiene el motor (por omisión, motorDe). */
  motorDe?: typeof motorDe;
};

/**
 * Las rutas del prototipo. El WebSocket solo se escucha con el motor encendido al arrancar; la comparación
 * (solo el dueño) está siempre: mide también el camino de siempre.
 */
export function montarMotorVoz(app: express.Express, httpServer: http.Server | null, d: DepsMotor): { cerrar: () => void } {
  const elMotor = d.motorDe ?? motorDe;
  const llave = d.apiKey ?? (() => clave('elevenlabs'));
  const esperaVinculo = d.vincularMs ?? VINCULAR_MS;
  /** conversación de ElevenLabs → el pase que el teléfono ató, y quién espera ese vínculo. */
  const vinculos = new Map<string, { pase: string; hasta: number }>();
  const esperando = new Map<string, ((p: string) => void)[]>();
  const sesiones = new Set<SesionMotor>();

  const permitido = (pase: string) => {
    const p = leerPase(pase);
    return !!p && !!elMotor(p.correo, p.avatar, p.idioma);
  };

  const esperarPase = (conversacion: string): Promise<string | null> => {
    const ya = vinculos.get(conversacion);
    if (ya && ya.hasta > Date.now()) {
      vinculos.delete(conversacion);
      return Promise.resolve(ya.pase);
    }
    return new Promise((listo) => {
      const h = setTimeout(() => {
        const l = esperando.get(conversacion)?.filter((f) => f !== alVincular) || [];
        if (l.length) esperando.set(conversacion, l);
        else esperando.delete(conversacion);
        listo(null);
      }, esperaVinculo);
      h.unref?.();
      const alVincular = (p: string) => {
        clearTimeout(h);
        listo(p);
      };
      esperando.set(conversacion, [...(esperando.get(conversacion) || []), alVincular]);
    });
  };

  /**
   * El teléfono ata su conversación de ElevenLabs a su pase (solo si ElevenLabs no reenvió `X-Pase`): con
   * SU sesión y SU pase, así nadie habla como otra persona.
   */
  app.post(`${RUTA_MOTOR}/vincular`, d.exigirMesaODesk, d.limitar(30, 60_000, 'voz-agente'), (req, res) => {
    if (!motorEncendido()) return res.status(404).json({ error: 'no está', honesto: true });
    const s = d.sesionDe(req);
    if (!s) return res.status(401).json({ error: 'sesión requerida', honesto: true });
    const pase = String(req.body?.pase || '');
    const conversacion = String(req.body?.conversacion || '');
    const p = leerPase(pase);
    if (!p || p.correo.toLowerCase() !== s.correo.toLowerCase()) return res.status(403).json({ error: 'ese pase no es tuyo', honesto: true });
    if (!elMotor(p.correo, p.avatar, p.idioma)) return res.status(403).json({ error: 'el motor nuevo no está activo para tu cuenta', honesto: true });
    if (!/^[A-Za-z0-9_-]{6,128}$/.test(conversacion)) return res.status(400).json({ error: 'conversación inválida', honesto: true });
    const ahora = Date.now();
    for (const [k, v] of vinculos) if (v.hasta <= ahora) vinculos.delete(k);
    const quienes = esperando.get(conversacion);
    if (quienes?.length) {
      esperando.delete(conversacion);
      for (const f of quienes) f(pase);
    } else vinculos.set(conversacion, { pase, hasta: ahora + VINCULO_TTL_MS });
    return res.json({ ok: true, honesto: true });
  });

  /** La comparación de los dos caminos (server/voz-medidas.ts): solo el dueño. */
  app.get('/api/voz/comparacion', d.exigirMando, d.limitar(30), async (req, res) => {
    const n = (v: unknown) => (Number.isFinite(Date.parse(String(v || ''))) ? Date.parse(String(v)) : undefined);
    res.json({ ...(await comparacionVoz({ desde: n(req.query?.desde), hasta: n(req.query?.hasta) })), motorEncendido: motorEncendido(), honesto: true });
  });
  /** El dueño etiqueta la tanda que sigue («wifi», «4g»): así se compara por red. */
  app.post('/api/voz/comparacion/red', d.exigirMando, d.limitar(30), (req, res) => {
    res.json({ ok: true, red: fijarRedVoz(req.body?.red), honesto: true });
  });

  /** Quien prueba llaves a ciegas: se dice en el registro una vez cada 10 minutos (nunca la llave). */
  let avisoRechazo = 0;
  const alUpgrade = (req: http.IncomingMessage, socket: Duplex, cabeza: Buffer) => {
    let ruta = '';
    try {
      ruta = new URL(req.url || '/', 'http://x').pathname;
    } catch {
      ruta = '';
    }
    if (ruta !== RUTA_MOTOR) {
      // Otro WebSocket (el de Vite en desarrollo): no es nuestro. Si nadie más escucha, se suelta.
      if (httpServer && httpServer.listenerCount('upgrade') <= 1) socket.destroy();
      return;
    }
    if (!motorEncendido()) return rechazarUpgrade(socket, 404, 'Not Found');
    const key = llave();
    if (!key) return rechazarUpgrade(socket, 503, 'Service Unavailable');
    const v = verificarJwtMotor(req.headers[CABECERA_JWT], key);
    const llaveDada = String(req.headers[CABECERA_LLAVE] || '');
    if (!v.ok || !llaveDada || !mismoSecreto(secretoDerivado(ETIQUETA_SECRETO_MOTOR), llaveDada)) {
      if (Date.now() - avisoRechazo > 10 * 60_000) {
        avisoRechazo = Date.now();
        console.warn(`[voz motor] conexión rechazada: ${'motivo' in v ? v.motivo : 'sin la llave del motor'}`);
      }
      return rechazarUpgrade(socket, 401, 'Unauthorized');
    }
    const ws = aceptarWebSocket(req, socket, cabeza);
    if (!ws) return;
    const paseCabecera = String(req.headers['x-pase'] || '');
    const sesion = new SesionMotor({
      llm: d.llm,
      enviar: (m) => ws.enviar(m),
      cerrar: (codigo, motivo) => ws.cerrar(codigo, motivo),
      ip: String(req.socket?.remoteAddress || 'elevenlabs'),
      paseCabecera,
      esperarPase,
      permitido: (pase) => {
        const ok = permitido(pase);
        const p = ok ? leerPase(pase) : null;
        if (p) sesion.fijarIdioma(normalizarIdioma(p.idioma));
        return ok;
      },
      anotar: (m) => anotarTurnoVoz(m),
    });
    sesiones.add(sesion);
    ws.on('mensaje', (t: string) => void sesion.recibir(t).catch((e) => console.warn('[voz motor] mensaje', String(e?.message || e).slice(0, 120))));
    ws.on('cierre', () => {
      sesiones.delete(sesion);
      sesion.terminar(1000, 'cerrada');
    });
  };
  if (httpServer && motorEncendido()) httpServer.on('upgrade', alUpgrade);
  return {
    cerrar: () => {
      httpServer?.off('upgrade', alUpgrade);
      for (const s of sesiones) s.terminar(1001, 'apagado');
      sesiones.clear();
    },
  };
}
