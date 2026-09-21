/**
 * DR ELECTRUM FP EN TELEGRAM — el segundo bot, no una sucursal del primero.
 *
 * Comparte el cuerpo con ULTRON (el mismo Qwen, el mismo harness, el mismo lector de PDF) y no
 * comparte NADA de lo que importa:
 *
 *   · Otro token de bot          → es otra cuenta de Telegram, otro @usuario, otra conversación.
 *   · Otro secreto de webhook    → un update firmado para ULTRON no entra por esta puerta.
 *   · Otro padrón                → estar en la junta no te mete a la demo minera, y al revés.
 *   · Otro hilo                  → lo que se habla acá no aparece en el chat de la junta.
 *
 * Esa última línea es la que hace falta escribir para que sea verdad: el hilo de ULTRON vive en un
 * Map dentro de lib/telegram-in.ts, y si reusáramos ese Map, dos chats con el mismo id numérico
 * —cosa que pasa, porque el id es del CHAT, no del bot— se verían los mensajes del otro.
 *
 * El nivel de acceso decide algo concreto, no decorativo: quien tiene `escribe` puede mandarle un
 * shapefile o un expediente y ENTRA AL CEREBRO; quien tiene `lee` recibe el archivo leído para ese
 * turno y nada se guarda. Es la diferencia entre enseñarle algo y prestárselo un momento.
 */
import crypto from 'node:crypto';
import { archivoTelegram, parsearUpdateTelegram, type TgParsed } from '../../lib/telegram-in';
import { identificar, nivelDe, padron, type Identificacion, type Nivel } from '../../lib/acceso';
import { extraerPdf } from '../../lib/leer-pdf';
import { aprender } from './aprender';
import { turnoElectrum } from './turno';
import { claveHilo, fusionarHiloElectrum, hiloDe, olvidarHilo, recordarHilo, type TurnoHilo } from './hilo';
import { tomarInforme } from './informe';

const ES_GEO = /\.(zip|kml|kmz|geojson|json|csv|shp)$/i;
const MAX_ARCHIVO = 40 * 1024 * 1024;

export function electrumBotToken(): string {
  return String(process.env.ELECTRUM_BOT_TOKEN || '').trim();
}

export function electrumBotListo(): boolean {
  return !!electrumBotToken() && !!String(process.env.ELECTRUM_WEBHOOK_SECRET || '').trim();
}

/**
 * Chats abiertos a la demostración: una sala donde Dr Electrum contesta a quien esté dentro, con
 * nivel de consulta y nada más. Hay que ponerlos a mano en `ELECTRUM_TELEGRAM_CHATS`; sin eso, al
 * bot solo le hablan personas del padrón. No hay sala abierta por defecto.
 */
function chatsDeDemo(): string[] {
  return String(process.env.ELECTRUM_TELEGRAM_CHATS || '')
    .split(/[,\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function electrumWebhookSecretOk(header: unknown): boolean {
  const esperado = String(process.env.ELECTRUM_WEBHOOK_SECRET || '');
  const got = String(header || '');
  if (!esperado || !got) return false;
  const a = Buffer.from(esperado);
  const b = Buffer.from(got);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

export type QuienElectrum = { id: Identificacion | null; nivel: Nivel; nombre: string };

/**
 * Quién habla y con qué nivel. Se niega por omisión.
 *
 * El id de USUARIO manda, no el del chat: en un grupo, el chat es de todos y la persona es una. Un
 * chat de demostración deja pasar a un desconocido, pero solo con `lee` y solo si José puso ese
 * chat en el entorno a propósito.
 */
export function autorizarElectrum(chatId: string, userId: string, nombre: string): QuienElectrum | null {
  const id = identificar({ telegramUserId: userId, telegramChatId: chatId });
  if (id && id.prueba === 'telegram') {
    const nivel = nivelDe(id.persona, 'electrum');
    if (nivel) return { id, nivel, nombre: id.persona.nombre };
    // Está en el padrón pero no en esta plataforma. Eso NO es un desconocido al que le abrimos la
    // sala de demo: es alguien a quien explícitamente no se le dio Electrum. Fuera.
    return null;
  }
  if (chatsDeDemo().includes(String(chatId))) {
    return { id: null, nivel: 'lee', nombre: nombre || 'quien pregunta' };
  }
  return null;
}

/** Cuánta gente tiene puerta en Electrum. Para el panel de salud. */
export function genteDeElectrum(): Array<{ nombre: string; nivel: Nivel; telegram: boolean }> {
  return padron()
    .filter((p) => !!p.acceso.electrum)
    .map((p) => ({ nombre: p.nombre, nivel: p.acceso.electrum as Nivel, telegram: p.telegram.length > 0 }));
}

export function ayudaElectrum(nivel: Nivel): string {
  const lineas = [
    'Dr Electrum FP. Minería: geología, recursos, mina, planta, costos, permisos y catastro.',
    'Preguntame con palabras normales: «mostrame Cerro Partido», «¿se traslapa algo?», «250.000 t a 3,4 g/t, ¿cuántas onzas?», «¿qué vence este año?».',
    'Convoco al especialista que haga falta —geólogo, ingeniero de minas, metalurgista, civil, GIS, ambiental, legal o economista— y te digo cuál contestó.',
    'Si te mando un número, salió de una cuenta o del catastro, no de mi memoria. Y si no lo tengo, te lo digo.',
  ];
  if (nivel === 'lee') {
    lineas.push('Tu acceso es de consulta: podés preguntar todo, pero lo que me mandes lo leo para ese momento y no queda guardado.');
  } else {
    lineas.push(
      'Podés cargarme el cerebro: mandame shapefiles (.zip), KML, KMZ, GeoJSON o CSV y quedan de capa en el mapa, medidos sobre el elipsoide; los PDF quedan citables con su página.'
    );
  }
  lineas.push('Esto es una demostración. No sustituye a una Persona Calificada ni a un informe firmado.');
  return lineas.join('\n');
}

/* ------------------------------------------------------------------ el hilo */

/**
 * El hilo vive en `hilo.ts`, junto al de la pantalla. Acá quedan solo los nombres de siempre para
 * no tocar a quien los llama.
 *
 * La llave es el chat, no la persona: en Telegram un mismo humano puede escribir desde un grupo y
 * desde el privado, y ésas son dos conversaciones. Además puede llegar alguien sin identificar.
 */
function claveTelegram(chatId: string) {
  return claveHilo(`tg:${String(chatId)}`, 'telegram');
}

export function hiloElectrum(chatId: string): TurnoHilo[] {
  return hiloDe(claveTelegram(chatId));
}

export function recordarElectrum(chatId: string, persona: string, doctor: string) {
  recordarHilo(claveTelegram(chatId), persona, doctor);
}

/** Pruebas: deja el hilo en blanco. */
export function olvidarHilosElectrum() {
  olvidarHilo();
}

/* ------------------------------------------------------------------ hablar */

export async function responderElectrum(chatId: string, texto: string): Promise<{ ok: boolean; detalle: string }> {
  const token = electrumBotToken();
  if (!token) return { ok: false, detalle: 'Falta ELECTRUM_BOT_TOKEN. No respondí.' };
  const trozos = String(texto || '…')
    .trim()
    .match(/[\s\S]{1,3500}/g) || ['…'];
  try {
    for (const trozo of trozos.slice(0, 4)) {
      const r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text: trozo }),
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

/**
 * Manda un informe como archivo. Por Telegram un PDF se manda, no se enlaza: un enlace a
 * /api/electrum/informe exige sesión, y quien está en el chat no la tiene.
 */
export async function enviarInformeElectrum(chatId: string, id: string, pieDeFoto: string): Promise<boolean> {
  const token = electrumBotToken();
  const r = tomarInforme(id);
  if (!token || !r) return false;
  try {
    const cuerpo = new FormData();
    cuerpo.append('chat_id', chatId);
    cuerpo.append('caption', pieDeFoto.slice(0, 900));
    cuerpo.append('document', new Blob([new Uint8Array(r.pdf)], { type: 'application/pdf' }), r.nombre);
    const resp = await fetch(`https://api.telegram.org/bot${token}/sendDocument`, {
      method: 'POST',
      body: cuerpo,
      signal: AbortSignal.timeout(30_000),
    });
    const j: any = await resp.json().catch(() => ({}));
    return !!j?.ok;
  } catch {
    return false;
  }
}

export async function registrarWebhookElectrum(): Promise<{ ok: boolean; detalle: string }> {
  const token = electrumBotToken();
  const secreto = String(process.env.ELECTRUM_WEBHOOK_SECRET || '').trim();
  const base = (process.env.PUBLIC_BASE || process.env.RENDER_EXTERNAL_URL || '').replace(/\/$/, '');
  if (!token) return { ok: false, detalle: 'Falta ELECTRUM_BOT_TOKEN.' };
  if (!secreto) return { ok: false, detalle: 'Falta ELECTRUM_WEBHOOK_SECRET. No registré webhook.' };
  if (!base) return { ok: false, detalle: 'Falta PUBLIC_BASE o RENDER_EXTERNAL_URL.' };
  try {
    const r = await fetch(`https://api.telegram.org/bot${token}/setWebhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url: `${base}/api/electrum/telegram/webhook`,
        secret_token: secreto,
        allowed_updates: ['message', 'edited_message'],
        drop_pending_updates: false,
      }),
      signal: AbortSignal.timeout(12000),
    });
    const j: any = await r.json().catch(() => ({}));
    if (!r.ok || !j.ok) return { ok: false, detalle: `setWebhook ${r.status}: ${JSON.stringify(j).slice(0, 180)}` };
    return { ok: true, detalle: `Dr Electrum FP escucha en ${base}/api/electrum/telegram/webhook` };
  } catch (e: any) {
    return { ok: false, detalle: String(e?.message || e).slice(0, 160) };
  }
}

/* ------------------------------------------------------------------ archivos */

/**
 * Los documentos que le importan a Electrum no son los de ULTRON. `parsearUpdateTelegram` se queda
 * con PDF, imagen y audio; un shapefile comprimido lo descarta. Así que el .zip, el KML y el CSV se
 * recogen acá, directamente del update.
 */
async function archivoGeo(update: any, token: string): Promise<{ nombre: string; datos: Buffer } | null> {
  const doc = (update?.message || update?.edited_message)?.document;
  const nombre = String(doc?.file_name || '');
  if (!doc?.file_id || !nombre || !ES_GEO.test(nombre)) return null;
  if (Number(doc.file_size || 0) > MAX_ARCHIVO) return null;
  const datos = await archivoTelegram(token, doc.file_id);
  return datos && datos.length > 80 ? { nombre, datos } : null;
}

/**
 * Qué hacer con lo que mandaron. Aquí es donde el nivel de acceso deja de ser una palabra: con
 * `escribe` el archivo entra al cerebro y se queda; con `lee` se lee y se olvida.
 */
type Atendido = { dicho?: string; contexto?: string };

async function atenderArchivo(
  parsed: TgParsed,
  geo: { nombre: string; datos: Buffer } | null,
  quien: QuienElectrum
): Promise<Atendido | null> {
  const puedeCargar = quien.nivel === 'escribe' || quien.nivel === 'mando';

  if (geo) {
    if (!puedeCargar) {
      return {
        dicho: `Recibí «${geo.nombre}», pero tu acceso es de consulta y no puedo meterlo al catastro. Pedile a José que te suba a nivel de trabajo y te lo cargo.`,
      };
    }
    const r = await aprender(geo.nombre, geo.datos, { subidoPor: quien.nombre });
    const avisos = r.avisos.filter((a) => a.nivel === 'error' || a.nivel === 'ojo');
    return { dicho: [r.dicho, ...avisos.map((a) => a.texto)].filter(Boolean).join(' ') };
  }

  if (parsed.documento && parsed.documento.buffer.length > 80) {
    const { filename, buffer } = parsed.documento;
    if (puedeCargar) {
      const r = await aprender(filename, buffer, { subidoPor: quien.nombre });
      return { dicho: r.dicho };
    }
    const leido = extraerPdf(buffer);
    if (!leido.texto) return { dicho: `Me llegó «${filename}» pero no le saqué texto. No te voy a inventar lo que dice.` };
    return {
      contexto: `EXPEDIENTE QUE ACABAN DE MANDARTE («${filename}», ${leido.paginas} páginas). No queda guardado: tu interlocutor tiene acceso de consulta. Contestá SOLO con lo que diga este texto.\n\n${leido.texto.slice(0, 12000)}`,
    };
  }

  if (parsed.documento) {
    return { dicho: `Me llegó «${parsed.documento.filename}» pero no pude bajarlo de Telegram. Volvé a mandarlo.` };
  }
  return null;
}

/* ------------------------------------------------------------------ el turno */

/**
 * Un update entero, de la puerta a la respuesta. Devuelve qué pasó para poder probarlo sin Telegram
 * y para que el log del servidor diga algo útil en vez de «ok».
 */
export async function procesarElectrumTelegram(update: any): Promise<{ estado: string; chatId?: string }> {
  const token = electrumBotToken();
  if (!token) return { estado: 'sin token' };

  const parsed = await parsearUpdateTelegram(update, token);
  if (!parsed) return { estado: 'update sin nada que leer' };

  const quien = autorizarElectrum(parsed.chatId, parsed.userId, parsed.nombre);
  if (!quien) {
    console.warn('[electrum] telegram rechazado', parsed.chatId, parsed.userId, parsed.nombre);
    return { estado: 'rechazado', chatId: parsed.chatId };
  }

  if (parsed.comando === '/start' || parsed.comando === '/ayuda' || parsed.comando === '/help') {
    await responderElectrum(parsed.chatId, ayudaElectrum(quien.nivel));
    return { estado: 'ayuda', chatId: parsed.chatId };
  }

  const geo = await archivoGeo(update, token).catch(() => null);
  const archivo: Atendido | null = await atenderArchivo(parsed, geo, quien).catch((e: any) => ({
    dicho: `Se me cayó leyendo el archivo: ${String(e?.message || e).slice(0, 140)}`,
  }));

  // Un archivo cargado se contesta solo: el modelo no tiene nada que agregarle a «quedaron 143
  // concesiones en el catastro», y hacerlo pasar por Qwen solo le daría ocasión de adornarlo.
  if (archivo?.dicho && !parsed.texto) {
    await responderElectrum(parsed.chatId, archivo.dicho);
    recordarElectrum(parsed.chatId, `(archivo) ${geo?.nombre || parsed.documento?.filename || ''}`, archivo.dicho);
    return { estado: 'archivo', chatId: parsed.chatId };
  }

  let mensaje = parsed.texto;
  if (!mensaje && parsed.imageDataUrl) mensaje = '¿qué ves en esta imagen?';
  if (!mensaje && archivo?.contexto) mensaje = 'Resumime lo que dice este expediente, sin inventar nada.';
  if (!mensaje) return { estado: 'sin pregunta', chatId: parsed.chatId };

  /*
   * El hilo va COMO MENSAJES, no pegado adentro de la pregunta.
   *
   * Pegarlo —que es lo que se hacía acá— rompía el panel de especialistas en silencio: `convocar`
   * cuenta palabras del oficio sobre el texto que recibe, así que seis líneas hablando de un
   * pórfido hacían que «¿y cuándo vence?» convocara al Geólogo y al Ingeniero de Minas y dejara al
   * Legal Minero fuera, sin sus herramientas de catastro. Hay una prueba que lo fija.
   *
   * El archivo sí va pegado, y con razón: es contexto de ESTA pregunta, no de las anteriores.
   */
  const historial = fusionarHiloElectrum({
    servidor: hiloElectrum(parsed.chatId),
    mensaje,
  });
  const conArchivo = archivo?.contexto ? `${archivo.contexto}\n\n` : '';

  const salida = await turnoElectrum(
    `${conArchivo}${mensaje}`,
    {
      quien: quien.id?.persona.id || null,
      nivel: quien.nivel,
      plataforma: 'electrum',
      canal: 'telegram',
      mensaje,
    },
    { historial }
  );

  const texto = [archivo?.dicho, salida.texto].filter(Boolean).join('\n\n') || 'No pude contestar eso ahora mismo.';
  await responderElectrum(parsed.chatId, texto);
  recordarElectrum(parsed.chatId, mensaje, salida.texto);

  const informe = salida.ui.map((d: any) => d?.informe).find(Boolean);
  if (informe?.id) {
    const ok = await enviarInformeElectrum(parsed.chatId, String(informe.id), String(informe.nombre || 'informe.pdf'));
    if (!ok) await responderElectrum(parsed.chatId, 'Armé el informe pero no pude mandártelo por acá. Pedímelo desde la pantalla.');
    return { estado: ok ? 'informe' : 'informe falló', chatId: parsed.chatId };
  }
  return { estado: 'contestado', chatId: parsed.chatId };
}
