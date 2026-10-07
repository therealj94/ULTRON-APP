/**
 * Taller de AU-RA: despacha tareas reales (sistema, PDF, canales, pendientes).
 * Si el canal no está configurado, el HECHO dice que falta la clave. No se finge el envío.
 */

import { canales, hacerPdf, leerPdf } from './canales';
import { catalogoCanales, fotoSistema, redesplegarMesa } from './sistema';
import { agregarTarea, marcarTarea, resumenTareas } from './tareas';
import { fotoBoveda, clave } from './boveda';
import { dictarSistema, notaDeVoz, pideNotaDeVoz } from './voz';
import { enumerar, nombresConNivel, puedeCambiarSistema, quienesMandan, type MiembroId } from './junta';
import type { Nivel } from './acceso';
import type { NivelAura } from './perfiles/tipos';
import { autorizar, evaluar, textoDeDecision, type Efecto } from './cognitivo/politica';
import { registrarEjecutor } from './cognitivo/aprobaciones';
import crypto from 'node:crypto';
import { claveDe, crearUnaVez, hashArgumentos, leerDurable } from './durable';
import { nivelDe, personaPorId } from './acceso';
import type { VinculoTaller } from './tareas-durables';

/**
 * `propuesta`: lo que quedó esperando la aprobación de la persona (revisión 10, MEDIO-C). El cliente lo enseña y, al
 * confirmar, aprueba ESA decisión (POST /api/trabajos/:tarea/decisiones con su id y versión).
 */
export type TallerOut = { hechos: string[]; tools: string[]; decir?: string; propuesta?: PropuestaTallerVista };

function publicBase() {
  return (process.env.PUBLIC_BASE || process.env.RENDER_EXTERNAL_URL || '').replace(/\/$/, '');
}

/**
 * ¿Pide solo LEER el correo? (revisión 10, MENOR-D). Leer, buscar, abrir, revisar o enseñar correos —o preguntar si hay—
 * sin un verbo que mande, avise o llame: «Lee los correos marcados como urgente», «busca el correo con el PDF», «abre el
 * correo con el pdf de telegram». Antes «urgente», «pdf» o el nombre de un canal dentro de lo que se busca lo volvían un
 * aviso urgente o un envío. Con un verbo de salida sigue siendo sensible («revisa mi correo y mándame un resumen por
 * Telegram», «avísame urgente si hay correo de Ana», «llámame si hay correos»). `l`: en minúsculas y sin tildes.
 * La misma regla está en src/13-trabajo/accionSensible.ts (tests/taller-aprobacion.test.ts compara las dos).
 */
export function soloLeeCorreo(l: string): boolean {
  if (!/\b(correos?|e-?mails?|mails?|gmail|bandeja|inbox)\b/.test(l)) return false;
  const lee = /\b(lee(?:me|r)?|lea|busca(?:me|r)?|encuentra(?:me)?|muestra(?:me)?|ensena(?:me)?|abre(?:me)?|revisa(?:me|r)?|resume(?:me)?|tengo|hay|cuantos|cuales)\b/.test(l);
  const sale = /\b(envia(?:me|le|lo|la|r)?|manda(?:me|le|lo|la|r)?|reenvia\w*|avisa(?:me|le|nos|r)?|alerta|notifica\w*|llama(?:me|nos|le|r)?|haz una llamada|hacer una llamada|call me)\b/.test(l);
  return lee && !sale;
}

export function parsePedido(raw: string): {
  accion: 'sistema' | 'mantenimiento' | 'redeploy' | 'tarea' | 'listar' | 'hecho' | 'pdf' | 'enviar' | 'llamar' | 'boveda' | 'urgente' | 'voz' | null;
  canal: 'telegram' | 'whatsapp' | 'correo' | null;
  texto: string;
} {
  const q = String(raw || '').trim();
  const l = q.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  // Leer, buscar o enseñar el correo sin pedir mandar ni avisar nada no sale del sistema (revisión 10, MENOR-D).
  const lee = soloLeeCorreo(l);
  const canal: 'telegram' | 'whatsapp' | 'correo' | null = /telegram|tg\b/.test(l)
    ? 'telegram'
    : /whats?app|\bwsp\b|\bwa\b/.test(l)
      ? 'whatsapp'
      : /correo|email|gmail|mail\b/.test(l)
        ? 'correo'
        : null;
  if (/\b(boveda|cajas de (la )?boveda|abri la boveda|abre la boveda)\b/.test(l)) return { accion: 'boveda', canal, texto: q };
  // «redespliega», «redesplegar», «redespliégala»: el verbo cambia la raíz (antes solo casaba «redeploy»).
  if (/\b(redeploy|redespl(?:ie|ié|e)g\w*|reinicia(r)? la mesa|nuevo deploy)\b/.test(l)) return { accion: 'redeploy', canal, texto: q };
  if (pideNotaDeVoz(q)) return { accion: 'voz', canal: canal || 'telegram', texto: q };
  if (/\b(mantenimiento|repara|arregla|diagnostico|diagnóstico)\b/.test(l)) return { accion: 'mantenimiento', canal, texto: q };
  // «¿cómo está el oro?» o «¿cómo está Pedro?» no preguntan por el sistema: solo cuenta si dice de qué.
  if (/\b(como esta|cómo está)\s+(el |la |los )?(sistema|mesa|servidor|plataforma|cerebro|nodos?|todo)\b|\b(estado del sistema|los nodos|salud del sistema|que nodos)\b/.test(l) || /^(status|salud)\b/.test(l)) {
    return { accion: 'sistema', canal, texto: q };
  }
  // Envío gana a "llamada": el cuerpo de un PDF/Telegram puede listar canales pendientes.
  if (!lee && (/\b(envia|envía|manda|mandale|mandame|mándame)\b/.test(l) || (canal && /\bpdf\b/.test(l)))) {
    return { accion: 'enviar', canal, texto: q };
  }
  if (!lee && /\b(haz un pdf|genera(?:r)? (un )?pdf|pdf de)\b/.test(l)) return { accion: 'pdf', canal, texto: q };
  if (!lee && (/\b(urgente|avisame|alerta junta)\b/.test(l) || (canal === 'telegram' && /\b(llama(?:me|nos)?|ll[aá]mame|llamanos)\b/.test(l)))) {
    return { accion: 'urgente', canal: canal || 'telegram', texto: q };
  }
  if (!lee && /\b(llama(?:me)?|ll[aá]mame|haz una llamada|hacer una llamada|call me)\b/.test(l)) {
    return { accion: 'llamar', canal, texto: q };
  }
  if (/\b(pendientes|tareas|lista de tareas)\b/.test(l) && !/\b(anota|agrega|apunta|recuerda)\b/.test(l)) {
    return { accion: 'listar', canal, texto: q };
  }
  const mHecho = l.match(/\b(tarea|pendiente)\s+([a-z0-9]+)\s+(hecha|listo|cerrada)\b/);
  if (mHecho) return { accion: 'hecho', canal, texto: mHecho[2] };
  const mAdd = q.match(/\b(?:anota|apunta|agrega|recu[eé]rdame|recu[eé]dame|nueva tarea)(?:\s+(?:que|esto))?\s*[:\-]?\s*(.+)$/i);
  if (mAdd && mAdd[1].trim().length > 2) return { accion: 'tarea', canal, texto: mAdd[1].trim() };
  return { accion: null, canal, texto: q };
}

function extraerCuerpo(q: string) {
  return q
    .replace(/^(env[ií]a|manda|m[aá]ndame|mandale|haz un pdf|genera(r)? (un )?pdf|pdf de|por telegram|por whatsapp|por correo|ll[aá]mame[,:]?|avisame urgente|avísame urgente|urgente)\s*/i, '')
    .replace(/\b(por|a|al|en)\s+(telegram|whatsapp|wsp|correo|email|gmail)\b/gi, '')
    .replace(/\b(un )?pdf\b/gi, '')
    .trim();
}

/**
 * LAS ACCIONES CON EFECTO DEL TALLER — cada una es una función con argumentos explícitos.
 *
 * Existen separadas del despacho por el motor de reglas: una acción que una regla manda a revisión
 * queda congelada en la cola con sus argumentos, y cuando la junta la aprueba el SERVIDOR la ejecuta
 * llamando a esta misma función con esos mismos argumentos (lib/cognitivo/aprobaciones.ts). Si la
 * acción viviera enredada en el `if` del despacho, no habría nada que ejecutar después.
 */
type ResultadoAccion = { ok: boolean; texto: string };

export const ACCIONES_TALLER: Record<string, { efecto: Efecto; correr: (a: Record<string, unknown>) => Promise<ResultadoAccion> }> = {
  voz_estado: {
    efecto: 'externo',
    async correr() {
      const foto = await fotoSistema();
      const dicho = dictarSistema(foto);
      if (!clave('telegram_token') || !clave('telegram_chat')) return { ok: false, texto: 'Falta TELEGRAM_BOT_TOKEN o TELEGRAM_CHAT_ID. No envié nada.' };
      const voz = await notaDeVoz(dicho);
      if (!voz) {
        const r = await canales.telegram({ texto: dicho });
        return { ok: r.ok, texto: r.ok ? `${dicho} Mandé el estado por texto. Sin audio.` : r.detalle };
      }
      const r = await canales.telegramVoz({ buf: voz, caption: 'AU-RA · estado del sistema' });
      return { ok: r.ok, texto: r.ok ? dicho : r.detalle };
    },
  },
  urgente: {
    efecto: 'externo',
    async correr(a) {
      const dicho = String(a.texto || 'AU-RA te necesita. Es urgente.');
      const voz = await notaDeVoz(dicho);
      const r = await canales.telegramUrgente(dicho, voz);
      return { ok: r.ok, texto: `${r.detalle}${voz ? '' : ' Sin audio: avisé por texto que suena.'}` };
    },
  },
  llamada: {
    efecto: 'externo',
    async correr(a) {
      const dicho = String(a.texto || 'Hola, te llama AU-RA.');
      const r = await canales.llamada(dicho);
      if (r.ok) return { ok: true, texto: r.detalle };
      const voz = await notaDeVoz(dicho);
      const tg = await canales.telegramUrgente(dicho, voz);
      return { ok: tg.ok, texto: `${r.detalle} ${tg.ok ? 'Te avisé por Telegram.' : tg.detalle}` };
    },
  },
  redeploy: {
    efecto: 'sistema',
    async correr() {
      const r = await redesplegarMesa();
      return { ok: r.ok, texto: r.detalle };
    },
  },
  tarea_anotar: {
    efecto: 'escritura',
    async correr(a) {
      const t = agregarTarea(String(a.texto || ''), a.usuario ? String(a.usuario) : undefined);
      return { ok: true, texto: `TAREA ANOTADA [${t.id}]: ${t.texto}` };
    },
  },
  tarea_cerrar: {
    efecto: 'escritura',
    async correr(a) {
      const t = marcarTarea(String(a.id || ''), true);
      return t ? { ok: true, texto: `TAREA CERRADA [${t.id}]: ${t.texto}` } : { ok: false, texto: `No encontré la tarea ${a.id}.` };
    },
  },
  /**
   * La captura de una página al grupo de la junta (revisión 11, MEDIO-1). La imagen exacta que se propuso queda guardada
   * por su sha256 (`guardarFotoTaller`) y `a.foto` es ese hash: entra en la huella. Al aprobar se manda ESA imagen, y solo
   * si sus bytes siguen dando el mismo hash.
   */
  foto: {
    efecto: 'externo',
    async correr(a) {
      const buf = await leerFotoTaller(String(a.foto || ''));
      if (!buf) return { ok: false, texto: 'TELEGRAM: no encontré la captura que aprobaste (o ya no es la misma imagen). No mandé nada.' };
      const r = await canales.telegramFoto({ buf, caption: String(a.texto || '') || 'Captura de AU-RA' });
      return { ok: r.ok, texto: `TELEGRAM: ${r.detalle}` };
    },
  },
  enviar: {
    efecto: 'externo',
    async correr(a) {
      const canal = String(a.canal || '');
      const cuerpo = String(a.texto || '');
      const conPdf = !!a.pdf;
      let pdf: { id: string; buf: Buffer; filename: string } | undefined;
      if (conPdf) {
        const made = hacerPdf('AU-RA', cuerpo);
        const buf = leerPdf(made.id);
        if (buf) pdf = { id: made.id, buf, filename: made.id };
      }
      if (canal === 'telegram') {
        const r = await canales.telegram({ texto: cuerpo, pdf });
        return { ok: r.ok, texto: `TELEGRAM: ${r.detalle}` };
      }
      if (canal === 'whatsapp') {
        const base = publicBase();
        const media = pdf && base ? `${base}/api/taller/archivo/${pdf.id}` : undefined;
        const r = await canales.whatsapp(cuerpo, media);
        return { ok: r.ok, texto: `WHATSAPP: ${r.detalle}${pdf && !media ? ' (sin PDF: falta PUBLIC_BASE)' : ''}` };
      }
      if (canal === 'correo') {
        const r = await canales.correo({ asunto: conPdf ? 'PDF de AU-RA' : cuerpo.slice(0, 80), texto: cuerpo, pdf: pdf ? { filename: pdf.filename, buf: pdf.buf } : undefined });
        return { ok: r.ok, texto: `CORREO: ${r.detalle}` };
      }
      return { ok: false, texto: 'No supe el canal. Di telegram, WhatsApp o correo.' };
    },
  },
};

/* ------------------------------------------------------------------ la captura que espera aprobación */

/** El dueño (fijo) de las capturas guardadas: se guardan por su contenido, no por quién las pidió. */
const DUENO_FOTOS = 'taller-capturas';
/** La captura más grande que se guarda para proponerla (una página entera en JPEG cabe de sobra). */
const MAX_FOTO_BYTES = 6 * 1024 * 1024;
const shaFoto = (buf: Buffer) => crypto.createHash('sha256').update(buf).digest('hex');

/**
 * Guarda los bytes exactos de una captura en lo durable (S3 con varias réplicas; si no, el disco) por su sha256 y lo
 * devuelve. null: no se pudo guardar (o es demasiado grande): entonces no se propone nada.
 */
export async function guardarFotoTaller(buf: Buffer): Promise<string | null> {
  if (!Buffer.isBuffer(buf) || !buf.length || buf.length > MAX_FOTO_BYTES) return null;
  const sha = shaFoto(buf);
  const r = await crearUnaVez(claveDe('taller/capturas', DUENO_FOTOS, sha), { sha, b64: buf.toString('base64') }).catch(() => null);
  return r?.ok ? sha : null;
}

/** Los bytes de la captura `sha`, solo si siguen dando ese hash. */
export async function leerFotoTaller(sha: string): Promise<Buffer | null> {
  if (!/^[a-f0-9]{64}$/.test(sha)) return null;
  const l = await leerDurable<{ sha: string; b64: string }>(claveDe('taller/capturas', DUENO_FOTOS, sha)).catch(() => null);
  if (!l || l.ok === false || !l.valor || typeof l.valor.b64 !== 'string') return null;
  const buf = Buffer.from(l.valor.b64, 'base64');
  return shaFoto(buf) === sha ? buf : null;
}

// Lo aprobado en la cola lo ejecuta el servidor con estas mismas funciones.
for (const [nombre, a] of Object.entries(ACCIONES_TALLER)) registrarEjecutor(`taller.${nombre}`, (args) => a.correr(args));

export type ContextoTaller = {
  usuario?: string;
  quien?: MiembroId | null;
  /** Nivel en AU-RA según el padrón, ya verificado. */
  nivel?: Nivel | null;
  prueba?: 'sesion' | 'telegram' | 'nombre' | null;
  canal?: 'mesa' | 'telegram';
  riesgo?: number | null;
  /**
   * El turno llega por la conversación fluida (un pase de voz, no una sesión): solo consulta. Nada
   * que salga del sistema (Telegram, WhatsApp, correo, urgente, llamada) ni que lo cambie
   * (redespliegue, mantenimiento), aunque quien hable tenga mando. Eso se pide en la mesa.
   */
  soloConsulta?: boolean;
  /**
   * Con quién habla (server/nivel.ts). Un miembro de la comunidad no tiene taller: ni estado del
   * sistema, ni bóveda, ni pendientes de la junta, ni envíos al Telegram de la organización.
   * Sin este campo, junta (como siempre).
   */
  nivelAura?: NivelAura;
  /**
   * Las manos que el teléfono de este turno hace por su cuenta (lib/manos-app.ts). Con ellas, «llama
   * a Beto» es una llamada de PULSE2CHAT (con su «sí»), no la de Twilio; y «avísame a las 5 que…» es
   * un recordatorio, no un aviso urgente a la junta.
   */
  manosApp?: readonly string[];
  /**
   * Antes de correr una acción con efecto (lo que no es `lectura`): persiste que se despacha en el turno
   * (server/turno-unico.ts `efectoDelTurno`). false = NO se corre: el turno no quedó registrado (sin almacén,
   * turno sin efectos o ya de otro proceso) y un reintento la repetiría (revisión externa, 4-oct).
   */
  antesDeEfecto?: (herramienta: string) => Promise<boolean>;
  /**
   * La cuenta de la sesión firmada que pide (su correo). Lo que sale a los canales de la junta queda propuesto a ESTA
   * cuenta y solo ella lo aprueba (revisión 10, MEDIO-C). Sin cuenta no hay a quién atar la aprobación: no se hace.
   */
  cuenta?: string | null;
  /**
   * Deja la propuesta esperando su aprobación (server/trabajos.ts `abrirDecisionDeTaller`: una tarea durable con su
   * decisión exacta, la misma que el panel de tareas de la web y del teléfono enseñan). null: no se pudo dejar.
   */
  proponer?: (p: PropuestaTaller) => Promise<PropuestaAbierta | null>;
};

/* ------------------------------------------------------------------ propuestas con aprobación exacta */

/**
 * LO QUE SALE A LOS CANALES DE LA JUNTA NO SE HACE SIN APROBACIÓN (revisión 10, MEDIO-C). La tarjeta «Confirmar» vivía
 * solo en la web: la app o un POST directo a /api/turno llegaban hasta el envío. Ahora el SERVIDOR no ejecuta Telegram,
 * WhatsApp, correo, aviso urgente, nota de voz ni llamada desde el chat: deja una propuesta (una tarea durable con su
 * decisión, lib/tareas-durables.ts) atada a la cuenta, la acción, el destino configurado, el contenido y la versión
 * (`huellaTaller`). Se ejecuta solo al aprobar ESA decisión (POST /api/trabajos/:id/decisiones: su id, su versión, la
 * sesión de la misma cuenta), una sola vez (`ejecutarUnaVez` por tarea + decisión), antes de que caduque, y solo si la
 * huella recalculada al ejecutar es la misma. Otro contenido o destino es otra propuesta y otra aprobación.
 */
export const ACCIONES_CON_APROBACION: ReadonlySet<string> = new Set(['voz_estado', 'urgente', 'llamada', 'enviar', 'foto']);
/** La versión del formato de la propuesta: entra en la huella (una propuesta de otro formato no se ejecuta). */
export const VERSION_PROPUESTA_TALLER = 1;
/** Lo más largo que se propone (y se manda) como contenido. */
const MAX_CONTENIDO = 2000;

export type CanalPropuesta = 'telegram' | 'whatsapp' | 'correo' | 'telefono';

/** Lo que se propone: el vínculo exacto (lo que se ejecutará) y cómo se le enseña a la persona. */
export type PropuestaTaller = Omit<VinculoTaller, 'tipo'> & { canal: CanalPropuesta; titulo: string; destinatario: string; contenido: string };
/** La decisión que quedó esperando: con su id y su versión se aprueba. */
export type PropuestaAbierta = { tarea: string; decision: string; version: number; caduca: number };
/** Lo que el cliente recibe en el turno (`propuestaTaller`). */
export type PropuestaTallerVista = PropuestaAbierta & { accion: string; canal: CanalPropuesta; titulo: string; destinatario: string; contenido: string };

const DESTINO_TALLER: Record<CanalPropuesta, string> = {
  telegram: 'Grupo de Telegram de la junta (el chat configurado en el servidor)',
  whatsapp: 'WhatsApp de la junta (el número configurado en el servidor)',
  correo: 'Correo de la organización (la dirección configurada en el servidor)',
  telefono: 'Teléfono de la junta configurado en el servidor (llamada de Twilio)',
};
const NOMBRE_CANAL: Record<'telegram' | 'whatsapp' | 'correo', string> = { telegram: 'Telegram', whatsapp: 'WhatsApp', correo: 'correo' };

function canalDeAccion(accion: string, args: Record<string, unknown>): CanalPropuesta {
  if (accion === 'enviar') return (['telegram', 'whatsapp', 'correo'] as const).find((c) => c === args.canal) || 'telegram';
  return accion === 'llamada' ? 'telefono' : 'telegram';
}

/**
 * A dónde va de verdad, según la configuración del servidor de AHORA (no se guarda: entra en la huella). Si entre la
 * propuesta y la aprobación cambia el chat, el número o el correo configurado, la huella cambia y no se ejecuta.
 */
function destinoConfigurado(accion: string, args: Record<string, unknown>): Record<string, string> {
  const canal = canalDeAccion(accion, args);
  const tg = clave('telegram_chat');
  if (canal === 'telegram') return { canal, chat: tg };
  if (canal === 'whatsapp') return { canal, a: process.env.JEFE_WHATSAPP || '', desde: process.env.TWILIO_WHATSAPP_FROM || '' };
  if (canal === 'correo') return { canal, a: process.env.MAIL_TO_JEFE || process.env.MAIL_FROM || '', desde: process.env.MAIL_FROM || '' };
  // La llamada, si Twilio no la hace, avisa por Telegram (ACCIONES_TALLER.llamada): los dos destinos cuentan.
  return { canal, a: process.env.JEFE_TELEFONO || '', desde: process.env.TWILIO_VOICE_FROM || '', respaldo: tg };
}

/** La huella de lo que se aprueba: cuenta, acción, argumentos (contenido), destino configurado y versión. */
export function huellaTaller(p: { cuenta: string; accion: string; args: Record<string, unknown>; version: number }): string {
  return hashArgumentos({ v: p.version, cuenta: String(p.cuenta || '').trim().toLowerCase(), herramienta: `taller.${p.accion}`, args: p.args, destino: destinoConfigurado(p.accion, p.args) });
}

/** Cómo se le enseña la acción a la persona (los mismos textos que la tarjeta de la web, src/13-trabajo/accionSensible.ts). */
function describirAccion(accion: string, args: Record<string, unknown>): { canal: CanalPropuesta; titulo: string; destinatario: string; contenido: string } {
  const canal = canalDeAccion(accion, args);
  const texto = String(args.texto || '');
  if (accion === 'voz_estado') return { canal, titulo: 'Mandar una nota de voz con el estado del sistema', destinatario: DESTINO_TALLER.telegram, contenido: 'El estado de los nodos, dicho con la voz de AU-RA.' };
  if (accion === 'urgente') return { canal, titulo: 'Avisar urgente a la junta', destinatario: `${DESTINO_TALLER.telegram}, como aviso urgente`, contenido: texto };
  if (accion === 'llamada') return { canal, titulo: 'Hacer una llamada', destinatario: DESTINO_TALLER.telefono, contenido: texto };
  if (accion === 'foto') return { canal, titulo: 'Mandar la captura de la página por Telegram', destinatario: DESTINO_TALLER.telegram, contenido: `${texto || 'Captura de AU-RA'} (imagen ${String(args.foto || '').slice(0, 12)})` };
  const c = canal === 'telefono' ? 'telegram' : canal;
  return { canal, titulo: `Mandar ${args.pdf ? 'un PDF' : 'un mensaje'} por ${NOMBRE_CANAL[c]}`, destinatario: DESTINO_TALLER[canal], contenido: texto };
}

/**
 * ¿Lo aprobado sigue siendo exactamente esto? La cuenta que aprueba es la que lo pidió, la acción es de las que piden
 * aprobación, la versión es la de este servidor y la huella recalculada AHORA (contenido y destino configurado) es la
 * misma que se aprobó.
 */
export function vinculoTallerVigente(v: VinculoTaller | null | undefined, cuenta: string): boolean {
  if (!v || v.tipo !== 'taller' || !ACCIONES_CON_APROBACION.has(v.accion)) return false;
  const c = String(cuenta || '').trim().toLowerCase();
  if (!c || v.cuenta !== c || v.version !== VERSION_PROPUESTA_TALLER) return false;
  return huellaTaller({ cuenta: v.cuenta, accion: v.accion, args: v.args, version: v.version }) === v.huella;
}

/**
 * Ejecuta lo aprobado (server/trabajos.ts, dentro de `ejecutarUnaVez`): vuelve a mirar el vínculo y las reglas con la
 * identidad de quien lo pidió, y corre la acción con los argumentos congelados. `stale`: ya no es lo aprobado (no se hizo).
 */
export async function ejecutarAprobadoTaller(v: VinculoTaller, o: { cuenta: string }): Promise<{ estado: 'succeeded' | 'failed' | 'stale'; resumen: string }> {
  if (!vinculoTallerVigente(v, o.cuenta)) return { estado: 'stale', resumen: 'Lo que espera ya no es lo que aprobaste (otro contenido, destino o cuenta). No mandé nada.' };
  const nombre = v.accion as keyof typeof ACCIONES_TALLER;
  const accion = ACCIONES_TALLER[nombre];
  const persona = personaPorId(v.quien);
  const d = await autorizar({
    herramienta: `taller.${nombre}`,
    efecto: accion.efecto,
    plataforma: 'ultron',
    args: v.args,
    quien: v.quien,
    nivel: persona ? nivelDe(persona, 'ultron') : null,
    // Se aprueba con la sesión firmada de esa misma cuenta (server/trabajos.ts).
    prueba: 'sesion',
    canal: 'mesa',
    riesgo: null,
    destino: 'junta',
  });
  if (d.veredicto !== 'permitir') return { estado: 'failed', resumen: textoDeDecision({ herramienta: nombre }, d) };
  const r = await accion.correr(v.args);
  return { estado: r.ok ? 'succeeded' : 'failed', resumen: r.texto };
}

/** Deja la propuesta (sin ejecutar nada) y devuelve lo que se le dice a la persona. */
async function proponerTaller(nombre: keyof typeof ACCIONES_TALLER, args: Record<string, unknown>, ctx: ContextoTaller): Promise<ResultadoAccion & { decision: string; propuesta?: PropuestaTallerVista }> {
  const cuenta = String(ctx.cuenta || '').trim().toLowerCase();
  if (!cuenta.includes('@') || !ctx.proponer) {
    return { ok: false, decision: 'aprobacion', texto: 'No lo hice: esto sale a los canales de la junta y solo lo hago cuando lo confirmas en la mesa o en la app, con tu sesión. No mandé nada.' };
  }
  const congelados = { ...args, ...(typeof args.texto === 'string' ? { texto: args.texto.slice(0, MAX_CONTENIDO) } : {}) };
  const version = VERSION_PROPUESTA_TALLER;
  const huella = huellaTaller({ cuenta, accion: nombre, args: congelados, version });
  const desc = describirAccion(nombre, congelados);
  const abierta = await ctx.proponer({ accion: nombre, args: congelados, cuenta, quien: ctx.quien ?? null, huella, version, ...desc }).catch(() => null);
  if (!abierta) return { ok: false, decision: 'aprobacion', texto: 'No lo hice: no pude dejar la propuesta para que la confirmes, así que no mandé nada. Pídemelo otra vez en un momento.' };
  const minutos = Math.max(1, Math.round((abierta.caduca - Date.now()) / 60_000));
  return {
    ok: false,
    decision: 'aprobacion',
    texto: `Necesito tu confirmación antes de hacerlo: ${desc.titulo.charAt(0).toLowerCase()}${desc.titulo.slice(1)} — ${desc.destinatario}. Todavía no he mandado nada; confírmalo en la tarjeta o en tus tareas (vale ${minutos} min).`,
    propuesta: { ...abierta, accion: nombre, ...desc },
  };
}

/**
 * Lo que el modelo sabe cuando un miembro pide algo que solo es del taller de la junta. Deja claro
 * que lo de SU teléfono (mensajes, llamadas, recordatorios) sigue: eso va por las acciones de la app.
 */
export const TALLER_SOLO_JUNTA =
  'TALLER: el taller es de la junta, no de los miembros: no mandas nada al Telegram de la organización, no avisas a la junta, no das el estado de sus sistemas ni de la bóveda y no tocas sus pendientes. Si te lo piden, dilo con naturalidad. Lo que la persona pida para SU teléfono (mensajes a sus contactos, llamadas, recordatorios, pantallas) sí se hace, con las acciones de su app si están en este turno.';

/** Las acciones del taller que, pedidas por un miembro, merecen decirle al modelo que no son suyas. */
const DE_LA_JUNTA = new Set(['sistema', 'mantenimiento', 'redeploy', 'boveda', 'urgente', 'voz', 'listar']);

/** ¿El pedido es de las manos de la app y no del taller? («llámame» es la llamada de Twilio salvo con la mano `llamame`). */
function cedeALaApp(p: ReturnType<typeof parsePedido>, q: string, manos: readonly string[] | undefined): boolean {
  if (!manos?.length) return false;
  const l = q.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  // «llámame a las 5 para recordarme…» es un recordatorio con llamada de AURA, no la llamada de Twilio.
  if (p.accion === 'llamar' && manos.includes('recordatorio') && /\b(recordarme|recuerdame|recuerdes|acordarme|acuerde|olvide|pase|remind)\b/.test(l)) return true;
  if (p.accion === 'llamar' && manos.includes('llamar') && !/\b(llamame|llamanos|call me)\b/.test(l)) return true;
  // Con la app que sabe que el avatar llama, «llámame» es SU llamada (suena el teléfono), no la de Twilio.
  if (p.accion === 'llamar' && manos.includes('llamame') && /\b(llamame|call me)\b/.test(l)) return true;
  if (p.accion === 'urgente' && manos.includes('recordatorio') && /\bavisame\b/.test(l) && !/\b(urgente|alerta junta)\b/.test(l)) return true;
  return false;
}

/** Lo que el taller no hace desde la voz: todo lo que sale del sistema o lo cambia. */
const FUERA_DE_LA_VOZ = new Set(['redeploy', 'mantenimiento', 'voz', 'urgente', 'llamar', 'enviar']);

/**
 * Pasa la acción por las reglas y, si la dejan, la corre. Si no, devuelve el texto de la decisión
 * (bloqueada, o en espera de aprobación con su número de solicitud).
 */
async function conPermiso(nombre: keyof typeof ACCIONES_TALLER, args: Record<string, unknown>, ctx: ContextoTaller): Promise<ResultadoAccion & { decision?: string; propuesta?: PropuestaTallerVista }> {
  const accion = ACCIONES_TALLER[nombre];
  const pedido = {
    herramienta: `taller.${nombre}`,
    efecto: accion.efecto,
    plataforma: 'ultron' as const,
    args,
    quien: ctx.quien ?? null,
    nivel: ctx.nivel ?? null,
    prueba: ctx.prueba ?? null,
    canal: ctx.canal,
    riesgo: ctx.riesgo ?? null,
    // Todo lo que el taller manda va a los canales propios configurados (el grupo, el correo y el
    // WhatsApp de la junta). No hay forma de darle un destinatario arbitrario desde el chat.
    destino: accion.efecto === 'externo' ? ('junta' as const) : null,
  };
  // Lo que sale a los canales de la junta no corre desde el chat (revisión 10, MEDIO-C): si las reglas lo dejarían, se
  // PROPONE y espera la aprobación exacta de esta cuenta. Si no lo dejarían (bloqueo, revisión de la junta), se cuenta
  // como siempre: `autorizar` lo audita o lo deja en la cola de firmas.
  if (ACCIONES_CON_APROBACION.has(nombre) && evaluar(pedido).veredicto === 'permitir') return proponerTaller(nombre, args, ctx);
  const d = await autorizar(pedido);
  if (d.veredicto !== 'permitir') return { ok: false, texto: textoDeDecision({ herramienta: nombre }, d), decision: d.veredicto };
  // Una regla pudo cambiar entre `evaluar` y `autorizar` (el tope por hora): aun así, lo que pide aprobación no corre aquí.
  if (ACCIONES_CON_APROBACION.has(nombre)) return proponerTaller(nombre, args, ctx);
  // Persistir antes de actuar: sin dejarlo registrado en el turno, no se hace (un reintento lo repetiría).
  if (accion.efecto !== 'lectura' && ctx.antesDeEfecto && !(await ctx.antesDeEfecto(`taller.${nombre}`).catch(() => false))) {
    return { ok: false, texto: 'No lo hice: no pude dejar registrado este turno, así que no se mandó ni se cambió nada. Pídemelo otra vez en un momento.' };
  }
  return accion.correr(args);
}

/**
 * La captura de una página que se pidió mandar al grupo de la junta (revisión 11, MEDIO-1). Antes server.ts la publicaba
 * con `telegramFoto` en cuanto alguien con mando decía «captura» o «screenshot», sin propuesta ni aprobación. Ahora es una
 * acción del taller como las demás: se guarda la imagen exacta (su sha256 va en los argumentos y por tanto en la huella)
 * y queda PROPUESTA a la cuenta; se manda una vez, al aprobar esa decisión. Sin cuenta, sin almacén o con las reglas en
 * contra, no sale nada. La respuesta del chat sigue diciendo lo que la página contiene.
 */
export async function proponerCapturaTaller(foto: { buf: Buffer; titulo?: string; url: string }, ctx: ContextoTaller): Promise<{ texto: string; propuesta?: PropuestaTallerVista }> {
  if (ctx.nivelAura === 'miembro') return { texto: TALLER_SOLO_JUNTA };
  if (ctx.soloConsulta) return { texto: 'Desde la conversación de voz no mando capturas al grupo. Pídemelo escrito en la mesa.' };
  const sha = await guardarFotoTaller(foto.buf);
  if (!sha) return { texto: 'No dejé la captura para mandarla: no pude guardarla. No mandé nada al grupo.' };
  const texto = String(foto.titulo || foto.url || '').replace(/\s+/g, ' ').trim().slice(0, 300) || 'Captura de AU-RA';
  const r = await conPermiso('foto', { foto: sha, texto, url: String(foto.url || '').slice(0, 500) }, ctx);
  return { texto: r.texto, ...(r.propuesta ? { propuesta: r.propuesta } : {}) };
}

export async function despacharTaller(message: string, opts?: ContextoTaller): Promise<TallerOut> {
  const p = parsePedido(message);
  if (!p.accion || cedeALaApp(p, message, opts?.manosApp)) return { hechos: [], tools: [] };
  const tools: string[] = [];
  const hechos: string[] = [];
  let propuesta: PropuestaTallerVista | undefined;
  const out = (decir?: string): TallerOut => ({ hechos, tools, decir, ...(propuesta ? { propuesta } : {}) });
  const ctx: ContextoTaller = opts || {};
  /** `conPermiso`, guardando la propuesta que quedó esperando aprobación (va en la respuesta del turno). */
  const permiso = async (nombre: keyof typeof ACCIONES_TALLER, args: Record<string, unknown>) => {
    const r = await conPermiso(nombre, args, ctx);
    if (r.propuesta) propuesta = r.propuesta;
    return r;
  };
  /*
   * Un miembro no llega a NINGUNA acción del taller: ni a las que leen (sistema, bóveda, pendientes de
   * la junta) ni a las que mandan (Telegram, WhatsApp o correo de la organización, llamadas de Twilio,
   * redespliegue). Sin `decir`: contesta el modelo. Si lo que pidió es de la junta, se le dice al
   * modelo; si es algo suyo que el taller confundió («anota…», «recuérdame…», «llámame», «mándale un
   * WhatsApp a Beto»), no se dice nada: eso lo resuelven las acciones de su app.
   */
  if (ctx.nivelAura === 'miembro') {
    const deLaJunta = DE_LA_JUNTA.has(p.accion) || ((p.accion === 'enviar' || p.accion === 'pdf') && p.canal === 'telegram');
    return { hechos: deLaJunta ? [TALLER_SOLO_JUNTA] : [], tools: [] };
  }
  const consulta = !puedeCambiarSistema(opts?.quien) || !!opts?.soloConsulta;

  if (opts?.soloConsulta && p.accion && (FUERA_DE_LA_VOZ.has(p.accion) || (p.accion === 'pdf' && p.canal))) {
    tools.push(p.accion);
    hechos.push(
      'ACCESO (conversación de voz): solo consulta. Desde la voz no mando mensajes, avisos urgentes ni llamadas, no redespliego y no hago mantenimiento. Se pide en la mesa, con la sesión abierta. Lo demás (estado, oro, web, pendientes, memoria) sí.'
    );
    return out('Eso no lo hago desde la conversación de voz. Pídemelo escrito en la mesa y lo vemos.');
  }

  if (consulta && (p.accion === 'redeploy' || p.accion === 'mantenimiento')) {
    tools.push(p.accion);
    hechos.push(
      `ACCESO: consulta. ${enumerar(nombresConNivel('lee'), 'y', 'Quien tiene acceso de consulta')} no cambia${nombresConNivel('lee').length > 1 ? 'n' : ''} el sistema. No redespliego, no hago mantenimiento ni corro el ejecutor. ${quienesMandan()} sí pueden. El resto del taller (estado, PDF, fotos, voz, web, oro, pendientes, memoria propia) sí.`
    );
    return out(`Eso cambia el sistema. Tu acceso es consulta: no lo hago. Pedile a ${enumerar(nombresConNivel('mando'), 'o', 'alguien de la junta con mando').replace(/ o (?=[^ ]+$)/, ' o a ')}.`);
  }

  if (p.accion === 'sistema' || p.accion === 'mantenimiento') {
    tools.push(p.accion === 'mantenimiento' ? 'mantenimiento' : 'sistema');
    const foto = await fotoSistema();
    hechos.push(foto.resumen);
    hechos.push('Nodos: ' + foto.nodos.map((n) => `${n.id}=${n.vivo ? 'vivo' : 'caído'} (${n.detalle})`).join('; '));
    if (p.accion === 'mantenimiento') {
      hechos.push('MANTENIMIENTO: re-probé los nodos. No SSH al cerebro Qwen (prohibido). Si un nodo está caído, dilo y pide clave o redespliegue de la mesa. No afirmo que lo arreglé si sigue caído.');
    }
    const caidos = foto.nodos.filter((n) => !n.vivo).map((n) => n.id);
    const faltan = foto.canales.filter((c) => !c.listo).map((c) => c.nombre);
    const decir = caidos.length
      ? `${caidos.join(', ')} no responde. ${p.accion === 'mantenimiento' ? 'Re-probé. No toqué el nodo Qwen.' : 'El resto, sí.'}`
      : `Nodos en pie. Sin clave: ${faltan.join(', ') || 'ningún canal'}.`;
    return out(decir);
  }

  if (p.accion === 'boveda') {
    tools.push('boveda');
    const f = fotoBoveda();
    hechos.push(f.resumen);
    const decir = f.faltan.length
      ? `Bóveda: ${f.listos.join(', ') || 'nada listo'}. Falta: ${f.faltan.join('; ')}.`
      : 'Bóveda completa. Todas las cajas con clave.';
    return out(decir);
  }

  if (p.accion === 'voz') {
    tools.push('voz');
    const r = await permiso('voz_estado', {});
    hechos.push(`VOZ TELEGRAM: ${r.texto}`);
    return out(r.texto);
  }

  if (p.accion === 'urgente') {
    tools.push('urgente');
    const r = await permiso('urgente', { texto: extraerCuerpo(p.texto) || 'AU-RA te necesita. Es urgente.' });
    hechos.push(`URGENTE TELEGRAM: ${r.texto}`);
    hechos.push('El bot de Telegram no hace llamada de teléfono. Llamada real = Twilio (caja llamada).');
    return out(r.texto);
  }

  if (p.accion === 'redeploy') {
    tools.push('redeploy');
    const r = await permiso('redeploy', {});
    hechos.push(`REDEPLOY MESA: ${r.texto}`);
    return out(r.texto);
  }

  if (p.accion === 'listar') {
    tools.push('tareas');
    const r = resumenTareas();
    hechos.push(r);
    const abiertas = r.startsWith('TAREAS ABIERTAS') ? r.replace(/^TAREAS ABIERTAS[^:]*:\n?/, '').replace(/\n/g, '; ') : r;
    return out(abiertas.slice(0, 280));
  }

  if (p.accion === 'tarea') {
    tools.push('tareas');
    const r = await permiso('tarea_anotar', { texto: p.texto, usuario: opts?.usuario || null });
    hechos.push(r.ok ? `${r.texto}. ${resumenTareas()}` : r.texto);
    return out(r.ok ? `Anotado: ${p.texto}` : r.texto);
  }

  if (p.accion === 'hecho') {
    tools.push('tareas');
    const r = await permiso('tarea_cerrar', { id: p.texto });
    hechos.push(r.texto);
    return out(r.ok ? r.texto.replace(/^TAREA CERRADA \[[^\]]+\]: /, 'Cerrada: ') : r.decision ? r.texto : 'No encontré esa tarea.');
  }

  if (p.accion === 'llamar') {
    tools.push('llamada');
    const r = await permiso('llamada', { texto: extraerCuerpo(p.texto) || 'Hola, te llama AU-RA.' });
    hechos.push(`LLAMADA: ${r.texto}`);
    return out(r.texto);
  }

  const quierePdf = /\bpdf\b/i.test(message) || p.accion === 'pdf';
  const cuerpo = extraerCuerpo(p.texto) || `Nota de AU-RA · ${new Date().toISOString()}`;

  if (p.accion === 'enviar' || (p.accion === 'pdf' && p.canal)) {
    const canal = p.canal;
    if (!canal) {
      hechos.push('ENVÍO: no supe el canal. Di telegram, whatsapp o correo.');
      tools.push('enviar');
      return out('No supe el canal. Di telegram, WhatsApp o correo.');
    }
    if (quierePdf) tools.push('pdf');
    tools.push(canal);
    const r = await permiso('enviar', { canal, texto: cuerpo, pdf: quierePdf });
    hechos.push(r.texto);
    return out(r.texto.replace(/^(TELEGRAM|WHATSAPP|CORREO): /, ''));
  }

  if (quierePdf) {
    // Un PDF que se queda aquí no sale del sistema: no pasa por las reglas de envío.
    tools.push('pdf');
    const made = hacerPdf('AU-RA', cuerpo);
    hechos.push(`PDF generado (${made.bytes} bytes, id ${made.id}).`);
    return out(`PDF listo, ${made.id}. Dime si lo mando por Telegram, WhatsApp o correo.`);
  }
  return out();
}

export function hechosCatalogo(): string {
  const c = catalogoCanales();
  const listos = c.filter((x) => x.listo).map((x) => x.nombre);
  const no = c.filter((x) => !x.listo).map((x) => `${x.nombre}: falta ${x.falta}`);
  return `TALLER: listos [${listos.join(', ')}]. Sin clave (no los ofrezcas como hechos): ${no.join('; ') || 'ninguno'}.`;
}
