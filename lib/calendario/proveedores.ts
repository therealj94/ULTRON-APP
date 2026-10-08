/**
 * EL CALENDARIO DE MICROSOFT (Graph) Y EL DE GOOGLE, DESDE EL SERVIDOR: entrar, renovar el permiso y leer, crear, mover
 * o borrar eventos. Sin estado: los tokens los guarda lib/calendario/conexiones.ts; aquí solo se habla con cada API
 * (con un `fetch` que las pruebas cambian por uno falso).
 *
 * MICROSOFT: la MISMA app que el correo (lib/correo/microsoft.ts, MS_CLIENT_ID o MICROSOFT_CLIENT_ID) y el mismo
 * «código en otro aparato» (microsoft.com/devicelogin), pidiendo además `Calendars.ReadWrite` de Graph: consentimiento
 * incremental (Microsoft solo pregunta lo nuevo). Los tokens del calendario son otros (otro recurso: Graph, no
 * outlook.office.com) y se guardan aparte, cifrados igual.
 *
 * GOOGLE: Google NO deja pedir el calendario con el código de las teles (su «device flow» no admite ese permiso). Se
 * entra con la vuelta web de siempre (OAuth con PKCE): el teléfono abre en el navegador la dirección que le da el
 * servidor, Google vuelve a https://<servidor>/api/calendario/google/vuelta y el servidor canjea el código con el
 * secreto de una app «Aplicación web» (GOOGLE_WEB_CLIENT_ID + GOOGLE_WEB_CLIENT_SECRET). Sin ellas: «falta configurar».
 *
 * Crear es idempotente: Graph con `transactionId` y Google con el `id` del evento salen del intento aprobado, así que
 * repetir el mismo «sí» (un reintento, una red que se cortó) no crea dos eventos.
 */
import crypto from 'node:crypto';
import { clave } from '../boveda';
import { consultarCodigo, pedirCodigo, renovar as renovarMs, type CodigoDispositivo } from '../correo/microsoft';
import { inicioDelDia, isoHN, paredHN, ZONA_HN, type EventoCal } from './tiempo';

type Fetch = typeof fetch;

export type ProveedorCal = 'microsoft' | 'google';
export const PROVEEDORES_CAL: ProveedorCal[] = ['microsoft', 'google'];
export const NOMBRE_PROVEEDOR: Record<ProveedorCal, string> = { microsoft: 'Outlook / Microsoft 365', google: 'Google Calendar' };

export type TokensCal = { acceso: string; renovacion: string; venceEl: number };

/** Lo que falta para poder ofrecer cada proveedor (nombres de variables, nunca valores). */
export function faltaConfigurar(p: ProveedorCal): string[] {
  if (p === 'microsoft') return clave('ms_client_id') ? [] : ['MS_CLIENT_ID (o MICROSOFT_CLIENT_ID)'];
  return [clave('google_web_id') ? '' : 'GOOGLE_WEB_CLIENT_ID', clave('google_web_secreto') ? '' : 'GOOGLE_WEB_CLIENT_SECRET'].filter(Boolean);
}
export const configurado = (p: ProveedorCal) => faltaConfigurar(p).length === 0;

/** Un fallo con su motivo: `auth` (renovar y reintentar), `reconectar`, `permiso`, `no-encontrado`, `proveedor`, `incierto`. */
export class ErrorCalendario extends Error {
  constructor(
    mensaje: string,
    readonly codigo: 'auth' | 'reconectar' | 'permiso' | 'no-encontrado' | 'proveedor' | 'incierto' | 'falta-configurar' | 'datos',
    readonly status = 0
  ) {
    super(mensaje);
  }
}

/* ------------------------------------------------------------------ entrar y renovar */

export const PERMISOS_CAL_MS = 'offline_access https://graph.microsoft.com/Calendars.ReadWrite https://graph.microsoft.com/User.Read';
export const PERMISOS_CAL_GOOGLE = 'openid email https://www.googleapis.com/auth/calendar.events';
const GOOGLE_AUTH = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN = 'https://oauth2.googleapis.com/token';
const GOOGLE_YO = 'https://openidconnect.googleapis.com/v1/userinfo';
const GRAPH = 'https://graph.microsoft.com/v1.0';
const GCAL = 'https://www.googleapis.com/calendar/v3/calendars/primary/events';

/** Microsoft: el código para microsoft.com/devicelogin, con el permiso del calendario. */
export function pedirCodigoMicrosoft(traer: Fetch = fetch): Promise<CodigoDispositivo> {
  if (!configurado('microsoft')) throw new ErrorCalendario('Falta configurar Microsoft en el servidor.', 'falta-configurar');
  return pedirCodigo(traer, PERMISOS_CAL_MS);
}

export async function consultarCodigoMicrosoft(codigo: string, traer: Fetch = fetch) {
  return consultarCodigo(codigo, traer);
}

/** Google: la dirección para entrar (PKCE S256). El verificador y el estado los guarda quien la pide. */
export function urlEntrarGoogle(o: { estado: string; reto: string; vuelta: string; pista?: string }): string {
  const q = new URLSearchParams({
    client_id: clave('google_web_id'),
    redirect_uri: o.vuelta,
    response_type: 'code',
    scope: PERMISOS_CAL_GOOGLE,
    access_type: 'offline',
    // Consentimiento incremental: lo que ya dio (correo, otras apps) se suma; `consent` asegura el token de renovación.
    include_granted_scopes: 'true',
    prompt: 'consent',
    state: o.estado,
    code_challenge: o.reto,
    code_challenge_method: 'S256',
    ...(o.pista ? { login_hint: o.pista } : {}),
  });
  return `${GOOGLE_AUTH}?${q.toString()}`;
}

export function pkce(): { verificador: string; reto: string } {
  const verificador = crypto.randomBytes(32).toString('base64url');
  return { verificador, reto: crypto.createHash('sha256').update(verificador).digest('base64url') };
}

async function formulario(url: string, datos: Record<string, string>, traer: Fetch): Promise<any> {
  const r = await traer(url, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(datos).toString(), signal: AbortSignal.timeout(15_000) });
  const j: any = await r.json().catch(() => ({}));
  return { status: r.status, ...j };
}

const aTokens = (j: any, vieja = ''): TokensCal => ({ acceso: String(j.access_token), renovacion: String(j.refresh_token || vieja), venceEl: Date.now() + (Number(j.expires_in) || 3600) * 1000 });

/** Google: canjea el código de la vuelta. */
export async function canjearGoogle(codigo: string, verificador: string, vuelta: string, traer: Fetch = fetch): Promise<TokensCal> {
  const j = await formulario(GOOGLE_TOKEN, { grant_type: 'authorization_code', code: codigo, code_verifier: verificador, redirect_uri: vuelta, client_id: clave('google_web_id'), client_secret: clave('google_web_secreto') }, traer);
  if (!j.access_token) throw new ErrorCalendario(j.error_description || j.error || 'Google no dio el permiso.', 'proveedor', j.status);
  if (!j.refresh_token) throw new ErrorCalendario('Google no dio el permiso para renovar (sin refresh_token). Quita el acceso de AU-RA en tu cuenta de Google y vuelve a conectar.', 'reconectar', j.status);
  return aTokens(j);
}

/** Un token de acceso nuevo. Microsoft rota el de renovación; Google normalmente no (se conserva el de antes). */
export async function renovarTokens(p: ProveedorCal, t: TokensCal, traer: Fetch = fetch): Promise<TokensCal> {
  if (p === 'microsoft') {
    try {
      return await renovarMs(t.renovacion, traer, PERMISOS_CAL_MS);
    } catch (e: any) {
      throw new ErrorCalendario(String(e?.message || e), e?.codigo === 'reconectar' ? 'reconectar' : 'proveedor');
    }
  }
  const j = await formulario(GOOGLE_TOKEN, { grant_type: 'refresh_token', refresh_token: t.renovacion, client_id: clave('google_web_id'), client_secret: clave('google_web_secreto') }, traer);
  if (!j.access_token) throw new ErrorCalendario(j.error_description || j.error || 'No pude renovar el permiso de Google.', j.error === 'invalid_grant' ? 'reconectar' : 'proveedor', j.status);
  return aTokens(j, t.renovacion);
}

/** La cuenta con la que entró (para mostrarla en Ajustes). */
export async function cuentaDe(p: ProveedorCal, acceso: string, traer: Fetch = fetch): Promise<string> {
  const j = await pedirJson(p === 'microsoft' ? `${GRAPH}/me?$select=mail,userPrincipalName` : GOOGLE_YO, acceso, {}, traer);
  return String((p === 'microsoft' ? j?.mail || j?.userPrincipalName : j?.email) || '').trim().toLowerCase();
}

/* ------------------------------------------------------------------ las APIs */

/** Pide y lee JSON; un 401 es `auth` (quien llama renueva y reintenta una vez). `escritura`: un corte es `incierto`. */
async function pedirJson(url: string, acceso: string, init: RequestInit & { escritura?: boolean } = {}, traer: Fetch = fetch): Promise<any> {
  let r: Response;
  try {
    r = await traer(url, { ...init, headers: { authorization: `Bearer ${acceso}`, accept: 'application/json', ...(init.body ? { 'content-type': 'application/json' } : {}), ...((init.headers as Record<string, string>) || {}) }, signal: AbortSignal.timeout(15_000) });
  } catch (e: any) {
    // Se cortó DESPUÉS de mandar una escritura: pudo hacerse. Una lectura que se cortó, no hizo nada.
    throw new ErrorCalendario(`El calendario no contestó (${String(e?.message || e).slice(0, 80)}).`, init.escritura ? 'incierto' : 'proveedor');
  }
  if (r.status === 204) return null;
  const j: any = await r.json().catch(() => null);
  if (r.ok) return j;
  const detalle = String(j?.error?.message || j?.error_description || j?.error || `HTTP ${r.status}`).slice(0, 160);
  if (r.status === 401) throw new ErrorCalendario(detalle, 'auth', 401);
  if (r.status === 403) throw new ErrorCalendario(`Sin permiso para el calendario (${detalle}).`, 'permiso', 403);
  if (r.status === 404 || r.status === 410) throw new ErrorCalendario('Ese evento ya no está en el calendario.', 'no-encontrado', r.status);
  if (r.status === 400) throw new ErrorCalendario(`El calendario no aceptó los datos (${detalle}).`, 'datos', 400);
  if (r.status === 409) throw new ErrorCalendario(detalle, 'datos', 409);
  // 5xx: para una escritura no se sabe si quedó.
  throw new ErrorCalendario(`El calendario falló (${detalle}).`, init.escritura && r.status >= 500 ? 'incierto' : 'proveedor', r.status);
}

/** Lo que se pide crear (ya validado; hora de Honduras). */
export type NuevoEvento = { titulo: string; inicio: number; fin: number; lugar?: string; notas?: string; invitados?: string[]; idempotencia: string };

/** «2026-10-09T21:00:00.0000000» en UTC (Prefer outlook.timezone="UTC") → instante. */
const deGraphUtc = (s: unknown) => Date.parse(`${String(s || '').replace(/(\.\d{3})\d*$/, '$1').replace(/Z$/, '')}Z`);

/** Un enlace de llamada que se puede abrir (https, acotado), o ''. */
const reunionDe = (u: unknown) => (typeof u === 'string' && /^https:\/\/\S{4,500}$/.test(u.trim()) ? u.trim() : '');
/** El enlace de video de Google (conferenceData), si no vino como hangoutLink. */
const videoDeGoogle = (e: any) => (Array.isArray(e?.conferenceData?.entryPoints) ? e.conferenceData.entryPoints.find((p: any) => p?.entryPointType === 'video')?.uri : '') || '';

function deGraph(e: any): EventoCal {
  const todo = !!e?.isAllDay;
  // Un evento de todo el día es de FECHAS, no de horas: con la zona UTC pedida, «el 9» llega como 2026-10-09T00:00 UTC,
  // que en Honduras serían las 18:00 del 8. Se toma la fecha tal cual como día de Honduras.
  const inicio = todo ? inicioDelDia(String(e?.start?.dateTime || '').slice(0, 10)) : deGraphUtc(e?.start?.dateTime);
  const fin = todo ? inicioDelDia(String(e?.end?.dateTime || '').slice(0, 10)) : deGraphUtc(e?.end?.dateTime);
  return { id: String(e?.id || ''), proveedor: 'microsoft', titulo: String(e?.subject || '').trim(), inicio, fin, todoElDia: todo, ...(e?.location?.displayName ? { lugar: String(e.location.displayName) } : {}), ...(e?.webLink ? { enlace: String(e.webLink) } : {}), ...(reunionDe(e?.onlineMeeting?.joinUrl) ? { reunion: reunionDe(e.onlineMeeting.joinUrl) } : {}), ...(e?.isCancelled ? { cancelado: true } : {}) };
}

function deGoogle(e: any): EventoCal {
  const todo = !!e?.start?.date && !e?.start?.dateTime;
  const inicio = todo ? inicioDelDia(String(e.start.date)) : Date.parse(String(e?.start?.dateTime || ''));
  const fin = todo ? inicioDelDia(String(e?.end?.date || e.start.date)) : Date.parse(String(e?.end?.dateTime || ''));
  return { id: String(e?.id || ''), proveedor: 'google', titulo: String(e?.summary || '').trim(), inicio, fin, todoElDia: todo, ...(e?.location ? { lugar: String(e.location) } : {}), ...(e?.htmlLink ? { enlace: String(e.htmlLink) } : {}), ...(reunionDe(e?.hangoutLink || videoDeGoogle(e)) ? { reunion: reunionDe(e?.hangoutLink || videoDeGoogle(e)) } : {}), ...(e?.status === 'cancelled' ? { cancelado: true } : {}) };
}

/** El id de Google que sale del intento aprobado (base32hex: solo 0-9 y a-v; los dígitos hex caben). */
export const idGoogleDe = (idempotencia: string) => `aura${crypto.createHash('sha256').update(idempotencia).digest('hex').slice(0, 40)}`;

export async function listarEventos(p: ProveedorCal, acceso: string, desde: number, hasta: number, traer: Fetch = fetch): Promise<EventoCal[]> {
  const out: EventoCal[] = [];
  if (p === 'microsoft') {
    let url: string | null = `${GRAPH}/me/calendarView?${new URLSearchParams({ startDateTime: new Date(desde).toISOString(), endDateTime: new Date(hasta).toISOString(), $top: '100', $orderby: 'start/dateTime', $select: 'id,subject,start,end,location,isAllDay,isCancelled,webLink,onlineMeeting' })}`;
    for (let pagina = 0; url && pagina < 3; pagina++) {
      const j: any = await pedirJson(url, acceso, { headers: { Prefer: 'outlook.timezone="UTC"' } }, traer);
      for (const e of j?.value || []) out.push(deGraph(e));
      url = j?.['@odata.nextLink'] || null;
    }
  } else {
    let token = '';
    for (let pagina = 0; pagina < 3; pagina++) {
      const q = new URLSearchParams({ singleEvents: 'true', orderBy: 'startTime', timeMin: new Date(desde).toISOString(), timeMax: new Date(hasta).toISOString(), maxResults: '100', timeZone: ZONA_HN, ...(token ? { pageToken: token } : {}) });
      const j: any = await pedirJson(`${GCAL}?${q}`, acceso, {}, traer);
      for (const e of j?.items || []) out.push(deGoogle(e));
      token = String(j?.nextPageToken || '');
      if (!token) break;
    }
  }
  return out.filter((e) => e.id && Number.isFinite(e.inicio) && Number.isFinite(e.fin) && !e.cancelado);
}

/** Crea el evento. `repetido`: ya existía con esa idempotencia (un reintento): no se creó otro. */
export async function crearEvento(p: ProveedorCal, acceso: string, ev: NuevoEvento, traer: Fetch = fetch): Promise<EventoCal & { repetido?: boolean }> {
  if (p === 'microsoft') {
    const cuerpo = {
      subject: ev.titulo,
      start: { dateTime: paredHN(ev.inicio), timeZone: 'Central America Standard Time' },
      end: { dateTime: paredHN(ev.fin), timeZone: 'Central America Standard Time' },
      ...(ev.lugar ? { location: { displayName: ev.lugar } } : {}),
      ...(ev.notas ? { body: { contentType: 'text', content: ev.notas } } : {}),
      ...(ev.invitados?.length ? { attendees: ev.invitados.map((c) => ({ emailAddress: { address: c }, type: 'required' })) } : {}),
      // Graph no crea otro si el mismo transactionId se repite (un reintento).
      transactionId: ev.idempotencia,
    };
    const j = await pedirJson(`${GRAPH}/me/events`, acceso, { method: 'POST', body: JSON.stringify(cuerpo), headers: { Prefer: 'outlook.timezone="UTC"' }, escritura: true }, traer);
    return deGraph(j);
  }
  const id = idGoogleDe(ev.idempotencia);
  const cuerpo = {
    id,
    summary: ev.titulo,
    start: { dateTime: isoHN(ev.inicio), timeZone: ZONA_HN },
    end: { dateTime: isoHN(ev.fin), timeZone: ZONA_HN },
    ...(ev.lugar ? { location: ev.lugar } : {}),
    ...(ev.notas ? { description: ev.notas } : {}),
    ...(ev.invitados?.length ? { attendees: ev.invitados.map((c) => ({ email: c })) } : {}),
  };
  try {
    return deGoogle(await pedirJson(GCAL, acceso, { method: 'POST', body: JSON.stringify(cuerpo), escritura: true }, traer));
  } catch (e) {
    // 409: ese id ya existe = el mismo «sí» ya lo creó antes. Se lee el que quedó.
    if (e instanceof ErrorCalendario && e.status === 409) return { ...deGoogle(await pedirJson(`${GCAL}/${id}`, acceso, {}, traer)), repetido: true };
    throw e;
  }
}

export async function moverEvento(p: ProveedorCal, acceso: string, id: string, inicio: number, fin: number, traer: Fetch = fetch): Promise<EventoCal> {
  const enc = encodeURIComponent(id);
  if (p === 'microsoft') {
    const cuerpo = { start: { dateTime: paredHN(inicio), timeZone: 'Central America Standard Time' }, end: { dateTime: paredHN(fin), timeZone: 'Central America Standard Time' } };
    return deGraph(await pedirJson(`${GRAPH}/me/events/${enc}`, acceso, { method: 'PATCH', body: JSON.stringify(cuerpo), headers: { Prefer: 'outlook.timezone="UTC"' }, escritura: true }, traer));
  }
  const cuerpo = { start: { dateTime: isoHN(inicio), timeZone: ZONA_HN }, end: { dateTime: isoHN(fin), timeZone: ZONA_HN } };
  return deGoogle(await pedirJson(`${GCAL}/${enc}`, acceso, { method: 'PATCH', body: JSON.stringify(cuerpo), escritura: true }, traer));
}

export async function borrarEvento(p: ProveedorCal, acceso: string, id: string, traer: Fetch = fetch): Promise<void> {
  const enc = encodeURIComponent(id);
  await pedirJson(p === 'microsoft' ? `${GRAPH}/me/events/${enc}` : `${GCAL}/${enc}`, acceso, { method: 'DELETE', escritura: true }, traer);
}
