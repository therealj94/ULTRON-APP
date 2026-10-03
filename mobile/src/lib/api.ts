/**
 * Cliente del backend (Render, rama main).
 *   POST /api/turno, /api/turno/stream (SSE) · GET|POST /api/tts · POST /api/stt · POST /api/vision/analyze
 *   POST /api/memoria (requiere sesión) · GET|POST /api/cantar · POST /api/orar · GET /api/capacidades · GET /api/health
 * Toda llamada pasa por api(): manda la cabecera de sesión y, si el servidor responde 401, renueva el
 * token con las credenciales guardadas y reintenta una vez. También dice qué teléfono es
 * (`x-aura-aparato`, ver aparato.ts); los turnos, además, que salen de la app (`x-aura-origen: app`).
 */
import { API_BASE } from '../config';
import type { Mode, SessionUser } from '../config';
import { normalizarEmocion, pelarEtiqueta, type Emocion } from './emocion';
import { loadCreds, loadMesaToken, loadSession, saveMesaToken } from './storage';
import { quitarExpresiones } from './expresiones';
import { cabecerasAparato } from './aparato';
import { generacionCuenta, sigueVigente } from './cuenta';
import { avatarActual } from '../avatares/actual';
import { idiomaActual } from '../i18n';
import { etiquetasDeVista, vistaDeEtiquetas, vistaDeRespuesta, type FocoVision, type VistaCamara } from './vistaCamara';

/** Tope de una renovación del token: una que nunca contesta no puede retener las peticiones. */
export const TOPE_RENOVAR_MS = 10_000;

let refreshing: { gen: number; p: Promise<boolean> } | null = null;

/**
 * Renueva el token con la clave guardada de QUIEN está dentro. Una sola renovación en vuelo por
 * generación de la sesión (lib/cuenta.ts): si la persona cambia mientras viaja, la respuesta vieja
 * NO se guarda (sería un token ajeno), y la renovación de la persona nueva es otra.
 */
async function renovarSesion(): Promise<boolean> {
  const gen = generacionCuenta();
  if (refreshing && refreshing.gen === gen) return refreshing.p;
  const p = (async () => {
    const [creds, sesion] = await Promise.all([loadCreds(), loadSession()]);
    if (!creds?.correo || !creds?.clave) return false;
    // Solo la clave de QUIEN está dentro. En un teléfono compartido la guardada puede ser de otra
    // persona (entró con clave y salió; ahora está alguien que entró con Genesis): renovar con ella
    // metía perfil, memoria y voz en la cuenta ajena mientras la pantalla seguía mostrando al primero.
    const quien = creds.correo.trim().toLowerCase();
    if (!sesion?.correo || quien !== sesion.correo.trim().toLowerCase()) return false;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TOPE_RENOVAR_MS);
    try {
      const res = await fetch(`${API_BASE}/api/ultron/entrar`, {
        method: 'POST',
        signal: ctrl.signal,
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ correo: creds.correo, clave: creds.clave }),
      });
      const data: any = await res.json().catch(() => ({}));
      if (!res.ok || !data?.token) return false;
      // Antes de guardar: ¿sigue dentro la misma persona, en la misma sesión? Si salió o entró otra
      // mientras viajaba, este token no es de nadie que esté aquí.
      const ahora = await loadSession().catch(() => null);
      if (!sigueVigente(gen) || String(ahora?.correo || '').trim().toLowerCase() !== quien) return false;
      await saveMesaToken(String(data.token));
      return true;
    } catch {
      return false;
    } finally {
      clearTimeout(timer);
    }
  })().finally(() => {
    if (refreshing?.p === p) refreshing = null;
  });
  refreshing = { gen, p };
  return p;
}

function esSesionCaida(status: number, data: any) {
  return status === 401 || data?.code === 'sesion_requerida' || /sesión requerida|privado/i.test(String(data?.error || ''));
}

/** Lo que se espera ante un 429: lo que diga `Retry-After` (en segundos), acotado. */
function esperaDe429(res: Response): number {
  const s = Number(res.headers?.get?.('retry-after'));
  return Number.isFinite(s) && s > 0 ? Math.min(5_000, s * 1000) : 900;
}

/** La promesa, o false si antes llega el límite. */
function hastaElLimite(p: Promise<boolean>, limite: number): Promise<boolean> {
  return new Promise((listo) => {
    const t = setTimeout(() => listo(false), Math.max(0, limite - Date.now()));
    p.then(
      (v) => {
        clearTimeout(t);
        listo(v);
      },
      () => {
        clearTimeout(t);
        listo(false);
      }
    );
  });
}

/**
 * Una petición al backend. `timeoutMs` es el tope TOTAL (reintento de 429 y renovación incluidos):
 * reintentar no vuelve a empezar la cuenta.
 */
export async function api<T = any>(path: string, init?: RequestInit, timeoutMs = 30_000, retry401 = true): Promise<T> {
  return pedirApi<T>(path, init, Date.now() + timeoutMs, retry401);
}

async function pedirApi<T>(path: string, init: RequestInit | undefined, limite: number, reintentar: boolean): Promise<T> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), Math.max(1, limite - Date.now()));
  try {
    const token = await loadMesaToken();
    const aparato = await cabecerasAparato().catch(() => ({}));
    const res = await fetch(`${API_BASE}${path}`, {
      ...init,
      signal: ctrl.signal,
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        ...aparato,
        ...(token ? { 'x-ultron-sesion': token } : {}),
        ...(init?.headers || {}),
      },
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      if (res.status === 429 && reintentar) {
        const espera = esperaDe429(res);
        if (Date.now() + espera < limite) {
          await new Promise((r) => setTimeout(r, espera));
          return pedirApi<T>(path, init, limite, false);
        }
      }
      if (reintentar && esSesionCaida(res.status, data) && !path.includes('/entrar')) {
        // La renovación también cuenta contra el tope total: una que no contesta no retiene la petición.
        const ok = await hastaElLimite(renovarSesion(), limite);
        if (ok && Date.now() < limite) return pedirApi<T>(path, init, limite, false);
      }
      const err = new Error((data as any).error || `HTTP ${res.status}`);
      (err as any).status = res.status;
      (err as any).data = data;
      throw err;
    }
    return data as T;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * ¿Sigue viva la sesión guardada de esta persona? Lo pregunta la intro antes de abrir la mesa:
 *   viva    → el servidor la reconoce (o se renovó con la clave de esta misma persona)
 *   caida   → el servidor dice que no, o que es de otra cuenta: hay que volver a entrar
 *   sin_red → no se pudo preguntar: se entra igual (la mesa tiene modo local)
 * Quien entró con Genesis no tiene clave para renovar: al vencer su token vuelve a la entrada en vez
 * de quedarse «dentro» con una sesión que el servidor ya no acepta.
 */
export async function comprobarSesion(correo: string, timeoutMs = 3_000): Promise<'viva' | 'caida' | 'sin_red'> {
  const quien = correo.trim().toLowerCase();
  const pregunta = async (): Promise<'viva' | 'caida' | 'sin_red'> => {
    const token = await loadMesaToken();
    if (!token) return 'caida';
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(`${API_BASE}/api/ultron/sesion`, { signal: ctrl.signal, headers: { Accept: 'application/json', 'x-ultron-sesion': token } });
      if (!res.ok) return res.status === 401 ? 'caida' : 'sin_red';
      const data: any = await res.json().catch(() => null);
      if (!data || typeof data.authenticated !== 'boolean') return 'sin_red';
      if (!data.authenticated) return 'caida';
      return String(data.user?.correo || '').trim().toLowerCase() === quien ? 'viva' : 'caida';
    } catch {
      return 'sin_red';
    } finally {
      clearTimeout(timer);
    }
  };
  const r = await pregunta();
  if (r !== 'caida') return r;
  return (await renovarSesion()) ? pregunta() : 'caida';
}

/** Cabecera de sesión para descargas de audio (FileSystem/XHR no pasan por api()). */
export async function sessionHeaders(): Promise<Record<string, string>> {
  const token = await loadMesaToken();
  return token ? { 'x-ultron-sesion': token } : {};
}

export type Health = {
  ok: boolean;
  qwen?: { vivo?: boolean; modelo?: string | null };
  tts?: { vivo?: boolean };
  ojo?: { vivo?: boolean; vision?: boolean };
  /** Voicebox configurado en el servidor (voz y oído propios). */
  voicebox?: boolean;
};

export async function healthCheck() {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8_000);
  try {
    const res = await fetch(`${API_BASE}/api/health`, {
      signal: ctrl.signal,
      headers: { Accept: 'application/json' },
    });
    const data = (await res.json().catch(() => ({}))) as Health;
    if (!res.ok) throw new Error((data as any).error || `HTTP ${res.status}`);
    return data;
  } finally {
    clearTimeout(timer);
  }
}

export async function loginBiometric(user: SessionUser, timeoutMs = 12_000) {
  const data = await api<{ user?: { nombre?: string; rol?: string; correo?: string }; token?: string }>('/api/ultron/biometric-login', {
    method: 'POST',
    body: JSON.stringify({ biometricType: 'desk_access', userName: user.name, role: user.role, correo: user.correo }),
  }, timeoutMs);
  if (data.token) await saveMesaToken(data.token);
  return data;
}

export async function loginClave(correo: string, clave: string) {
  const data = await api<{ miembro?: { nombre?: string; rol?: string; correo?: string }; token?: string }>('/api/ultron/entrar', {
    method: 'POST',
    body: JSON.stringify({ correo: String(correo).trim().toLowerCase(), clave }),
  }, 15_000);
  if (data.token) await saveMesaToken(data.token);
  return data;
}

/**
 * «Olvidé mi clave»: el servidor manda al correo un enlace de 30 minutos (el mismo de la web). Siempre
 * contesta lo mismo, exista o no la cuenta, para no revelar quién tiene acceso.
 */
export async function olvideClave(correo: string): Promise<string> {
  const data = await api<{ message?: string }>('/api/ultron/clave/olvide', { method: 'POST', body: JSON.stringify({ correo: String(correo).trim().toLowerCase() }) }, 15_000, false);
  return data.message || 'Si ese correo tiene acceso, te llegará un enlace para poner una contraseña nueva.';
}

/**
 * «Crear cuenta»: en AU-RA nadie entra solo. Se manda una solicitud y José (o quien apruebe) la
 * revisa; si la aprueba, llega un correo para crear la contraseña.
 */
export async function pedirCuenta(nombre: string, correo: string, motivo: string): Promise<string> {
  const data = await api<{ message?: string }>(
    '/api/ultron/cuentas/solicitar',
    { method: 'POST', body: JSON.stringify({ nombre: nombre.trim(), correo: String(correo).trim().toLowerCase(), motivo: motivo.trim() }) },
    15_000,
    false
  );
  return data.message || 'Recibimos tu solicitud. Cuando sea revisada te escribiremos a ese correo.';
}

/**
 * Cierra la sesión del token que había AL EMPEZAR (el de A), y solo ese:
 *  · lo suelta de este teléfono en el acto, si sigue siendo el guardado (si alguien ya entró con otro,
 *    el suyo no se toca);
 *  · lo revoca en el servidor con ESE token en la cabecera, sin pasar por api(): un 401 no dispara la
 *    renovación del token que se está cerrando, y una respuesta tardía no borra el de quien entró
 *    después (antes, al terminar, guardaba null encima del token de B).
 * `token` permite pasar el que se capturó antes; sin él, se lee el guardado.
 */
export async function logoutRemote(token?: string | null) {
  const cerrar = token === undefined ? await loadMesaToken().catch(() => '') : token || '';
  if (!cerrar) return;
  if ((await loadMesaToken().catch(() => '')) === cerrar) await saveMesaToken(null);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 6_000);
  try {
    await fetch(`${API_BASE}/api/ultron/salir`, {
      method: 'POST',
      signal: ctrl.signal,
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'x-ultron-sesion': cerrar },
      body: '{}',
    });
  } catch {
    /* sin red: el token ya no está en el teléfono y vence solo */
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Memoria de largo plazo del servidor. /api/memoria exige sesión: al pasar por api() un 401 renueva el
 * token con las credenciales guardadas. `usuario` es el nombre del miembro (la memoria es por persona).
 */
export async function rememberFact(hecho: string, usuario: string): Promise<boolean> {
  try {
    await api('/api/memoria', { method: 'POST', body: JSON.stringify({ hecho, usuario }) }, 8_000);
    return true;
  } catch {
    return false; // se guarda local igual
  }
}

/**
 * «Olvidar» en el servidor: POST /api/memoria {olvidar:true}. La identidad sale del token de la sesión
 * (nunca del body), así que solo borra lo de quien está en la mesa. true solo si el servidor confirmó
 * `olvidado`; con false la mesa dice la verdad (el teléfono olvidó, el servidor todavía no).
 */
export async function olvidarMemoriaServidor(usuario: string): Promise<boolean> {
  try {
    const r = await api<{ ok?: boolean; olvidado?: boolean }>('/api/memoria', { method: 'POST', body: JSON.stringify({ olvidar: true, usuario }) }, 10_000);
    return !!r?.olvidado;
  } catch {
    return false;
  }
}

export type Turn = { rol: 'usuario' | 'ultron'; texto: string };

export type ChatResult = {
  /** Para leer (burbuja, hilo): sin expresiones de voz. */
  reply: string;
  /** Para decir: con sus [risa], [suspiro]… Un servidor viejo no lo manda y vale `reply`. */
  voz?: string;
  emocion: Emocion;
  mode?: Mode;
  ms?: number;
  via?: string;
  error?: string;
  /** Lo que AURA pidió hacer en la app (AccionApp del contrato); la mesa lo pasa al bus. */
  acciones?: unknown;
  /**
   * El cerebro se cortó a media respuesta (el `done` trae `parcial: true`, o el stream venció con texto):
   * lo dicho se queda, pero no es una respuesta completa (auditoría de Codex, 3-oct).
   */
  parcial?: boolean;
};

type TurnoOpts = {
  message: string;
  mode: Mode;
  userName: string;
  correo?: string;
  historial: Turn[];
  memoria?: string[];
  image?: string;
  /** Descripción de la escena que ya interpretó la cámara local (quién está, qué hace). El servidor la usa como hecho «ESCENA (cámara local): …». */
  escena?: string;
  /**
   * Lo que la cámara ya vio con orden (`verCamara`, el `summary` del servidor): va como hecho y la foto
   * no se vuelve a subir. `foco` dice qué se pidió (leer, precio, qué es, escena).
   */
  visto?: string;
  foco?: FocoVision;
  /** Lo dijo en voz alta (el oído de la mesa): el servidor no espera a internet más de lo que espera la voz. */
  hablado?: boolean;
  /**
   * Solo el camino rápido: si es una orden clara se resuelve; si no, el servidor contesta
   * `via: 'solo-rapido'` sin despertar al cerebro (la usaba la espera del modo llamada anterior).
   */
  soloRapido?: boolean;
  /**
   * Uno por frase de la persona, el MISMO en sus reintentos (stream → JSON → JSON): el servidor no
   * corre otro turno con ese id, devuelve el que ya corrió o espera al que sigue en curso
   * (server/turno-unico.ts). Sin él, una frase podía ser tres turnos: el hilo repetido y las acciones dos veces.
   */
  idTurno?: string;
  /**
   * La persona le habló encima a la respuesta anterior y AU-RA se calló (lib/interrupcion.ts): lo que
   * alcanzó a oír. El servidor abre con un acuse corto («Va, dime») en vez de repetirse (lib/interrumpida.ts).
   */
  interrumpido?: { oido: string };
};

/** Un id para el turno de una frase (sin módulos nativos: no tiene que ser criptográfico, solo no repetirse). */
export function nuevoIdTurno(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

function turnoBody(opts: TurnoOpts) {
  const escena = String(opts.escena || '').replace(/\s+/g, ' ').trim().slice(0, 300);
  return JSON.stringify({
    message: opts.message,
    mode: opts.mode,
    usuario: opts.userName,
    correo: opts.correo,
    historial: opts.historial.slice(-10),
    memoria: opts.memoria || [],
    ...(opts.image ? { image: opts.image } : {}),
    ...(escena ? { escena } : {}),
    ...(opts.visto ? { visto: opts.visto.slice(0, 2600) } : {}),
    ...(opts.foco ? { foco: opts.foco } : {}),
    ...(opts.hablado ? { hablado: true } : {}),
    ...(opts.soloRapido ? { soloRapido: true } : {}),
    ...(opts.idTurno ? { idTurno: opts.idTurno } : {}),
    ...(opts.interrumpido ? { interrumpido: { oido: String(opts.interrumpido.oido || '').slice(-400) } } : {}),
    // Con quién habla la persona y en qué idioma: el cerebro contesta como ese avatar y en esa lengua.
    avatar: avatarActual(),
    idioma: idiomaActual(),
  });
}

/** Un turno con el cerebro (Qwen 27B). `image` = data URL jpeg opcional para preguntas visuales. */
export async function turno(opts: TurnoOpts): Promise<ChatResult> {
  try {
    const data = await api<any>('/api/turno', { method: 'POST', body: turnoBody(opts), headers: { 'x-aura-origen': 'app' } }, 70_000);
    const pelado = pelarEtiqueta(String(data.reply || ''));
    const emocion = data.emocion ? normalizarEmocion(data.emocion) : pelado.emocion || 'neutral';
    const voz = data.voz ? pelarEtiqueta(String(data.voz)).texto.trim() : undefined;
    return { reply: quitarExpresiones(pelado.texto).trim(), voz, emocion, mode: data.mode, ms: data.ms, via: data.via, error: data.error, acciones: data.acciones, ...(data.parcial === true ? { parcial: true } : {}) };
  } catch (e: any) {
    return { reply: '', emocion: 'neutral', error: e?.message || 'Sin conexión al cerebro' };
  }
}

export type StreamHandlers = {
  /** Emoción del turno: llega ANTES del primer delta (la cara reacciona antes que la voz). */
  onEmocion?: (e: Emocion) => void;
  /** Trozo para DECIR (con expresiones): quien lo enseñe, que se las quite. */
  onDelta: (piece: string) => void;
  onTools?: (tools: string[]) => void;
};

/**
 * Turno en streaming (SSE por XHR: fetch de React Native no expone el body en trozos).
 * Eventos: `emocion` {emocion} · `delta` {text} · `tools` {tools[]} · `done` {reply, emocion, ms, via} · `error`.
 * Si el servidor no soporta stream (404/5xx) lanza para que el caller use turno().
 */
export function turnoStream(opts: TurnoOpts, h: StreamHandlers): { promise: Promise<ChatResult>; abort: () => void } {
  const xhr = new XMLHttpRequest();
  let seen = 0;
  let full = '';
  let emocion: Emocion | null = null;
  let firstDelta = true;
  let done: ChatResult | null = null;
  let settled = false;
  let cancelar: (() => void) | null = null;
  const promise = new Promise<ChatResult>((resolve, reject) => {
    const finish = (r: ChatResult) => {
      if (settled) return;
      settled = true;
      resolve(r);
    };
    const fail = (e: Error) => {
      if (settled) return;
      settled = true;
      reject(e);
    };
    const setEmocion = (raw: unknown) => {
      if (emocion) return;
      emocion = normalizarEmocion(raw);
      h.onEmocion?.(emocion);
    };
    const consume = () => {
      const text = xhr.responseText || '';
      if (text.length <= seen) return;
      const chunk = text.slice(seen);
      const blocks = chunk.split('\n\n');
      // el último bloque puede estar incompleto: se conserva
      seen += chunk.length - blocks[blocks.length - 1].length;
      blocks.pop();
      for (const b of blocks) {
        const ev = b.match(/^event: (\w+)/m)?.[1];
        const dataLine = b.match(/^data: (.*)$/m)?.[1];
        if (!ev || dataLine === undefined) continue;
        let data: any = {};
        try {
          data = JSON.parse(dataLine);
        } catch {
          continue;
        }
        if (ev === 'emocion') setEmocion(data.emocion);
        else if (ev === 'delta' && (data.voz || data.text)) {
          let piece = String(data.voz || data.text);
          if (firstDelta) {
            // defensa: servidor viejo que no quitó la etiqueta inicial
            const pelado = pelarEtiqueta(piece);
            if (pelado.emocion) setEmocion(pelado.emocion);
            piece = pelado.texto;
            firstDelta = false;
            if (!piece) continue;
          }
          full += piece;
          h.onDelta(piece);
        } else if (ev === 'tools' && Array.isArray(data.tools)) h.onTools?.(data.tools);
        else if (ev === 'done') {
          if (data.emocion) setEmocion(data.emocion);
          done = {
            reply: quitarExpresiones(pelarEtiqueta(String(data.reply || full)).texto),
            voz: pelarEtiqueta(String(data.voz || data.reply || full)).texto,
            emocion: emocion || 'neutral',
            ms: data.ms,
            via: data.via,
            acciones: data.acciones,
            ...(data.parcial === true ? { parcial: true } : {}),
          };
        } else if (ev === 'error') done = { reply: quitarExpresiones(full), voz: full, emocion: emocion || 'neutral', error: String(data.error || 'error'), ...(full.trim() ? { parcial: true } : {}) };
      }
    };
    xhr.open('POST', `${API_BASE}/api/turno/stream`);
    xhr.setRequestHeader('Content-Type', 'application/json');
    xhr.setRequestHeader('Accept', 'text/event-stream');
    xhr.timeout = opts.image ? 75_000 : 70_000;
    xhr.onprogress = consume;
    xhr.onreadystatechange = () => {
      if (xhr.readyState !== 4) return;
      if (xhr.status === 429) return fail(new Error('HTTP 429'));
      if (xhr.status < 200 || xhr.status >= 300) return fail(new Error(`HTTP ${xhr.status}`));
      consume();
      const reply = String((done && done.reply) || quitarExpresiones(full)).trim();
      const voz = String((done && done.voz) || full).trim() || reply;
      if (!reply && !voz) return fail(new Error('stream vacío'));
      finish(done ? { ...done, reply, voz, emocion: emocion || done.emocion } : { reply, voz, emocion: emocion || 'neutral' });
    };
    xhr.onerror = () => fail(new Error('red'));
    // Cancelar (el usuario dijo «callar») rechaza ya, sin depender de cómo cierre el XHR al abortarlo.
    cancelar = () => fail(new Error('cancelado'));
    xhr.ontimeout = () => (full ? finish({ reply: quitarExpresiones(full).trim(), voz: full.trim(), emocion: emocion || 'neutral', error: 'timeout', parcial: true }) : fail(new Error('timeout')));
    const payload = turnoBody(opts);
    void Promise.all([loadMesaToken(), cabecerasAparato(true).catch(() => ({}) as Record<string, string>)]).then(([t, extra]) => {
      if (settled) return;
      if (t) xhr.setRequestHeader('x-ultron-sesion', t);
      for (const [k, v] of Object.entries(extra)) xhr.setRequestHeader(k, v);
      xhr.send(payload);
    });
  });
  return {
    promise,
    abort: () => {
      cancelar?.();
      try {
        xhr.abort();
      } catch {
        /* todavía no se había enviado */
      }
    },
  };
}

/** GET /api/tts?text=&emocion=&performance=&avatar=&idioma= → audio con la voz del avatar (cabecera X-Ultron-TTS con el motor). */
export function ttsUrl(text: string, performance: 'speak' | 'sing', emocion: Emocion = 'neutral', avatar = 'aura', idioma = 'es', vecinos: { previo?: string; siguiente?: string } = {}) {
  // `tiempos=1`: que el servidor mande también los tiempos por letra (la boca a tiempo, avatar3d/sincronia.ts).
  // `previo`/`siguiente`: lo dicho antes y lo que viene (entonación seguida; el tono solo en la primera).
  const q = new URLSearchParams({ text, performance, emocion, avatar, idioma, tiempos: '1' });
  if (vecinos.previo) q.set('previo', vecinos.previo);
  if (vecinos.siguiente) q.set('siguiente', vecinos.siguiente);
  return `${API_BASE}/api/tts?${q.toString()}`;
}

export const TTS_ENDPOINT = `${API_BASE}/api/tts`;
export const CANTAR_ENDPOINT = `${API_BASE}/api/cantar`;
export const ORAR_ENDPOINT = `${API_BASE}/api/orar`;

export type Cancion = { id: string; titulo: string; artista: string; pedir: string };

/** Repertorio fijo (mismo que lib/capacidades del servidor) por si GET /api/cantar no responde. */
export const CANCIONES_LOCAL: Cancion[] = [
  { id: 'jesus', titulo: 'Quiero conocer a Jesús', artista: 'Generación 12 (versión de AU-RA)', pedir: 'canta quiero conocer a Jesús' },
  { id: 'waymaker', titulo: 'Way Maker', artista: 'Sinach (versión de AU-RA)', pedir: 'canta way maker' },
  { id: 'bienvenida', titulo: 'Bienvenidos a AU-RA', artista: 'AU-RA', pedir: 'canta la de bienvenida' },
  { id: 'felizdia', titulo: 'Feliz día', artista: 'AU-RA', pedir: 'cantame feliz día' },
  { id: 'bendicion', titulo: 'Bendición', artista: 'AU-RA', pedir: 'canta una bendición' },
  { id: 'cuna', titulo: 'Duerme, duerme (canción de cuna)', artista: 'AU-RA', pedir: 'cantame una canción de cuna' },
  { id: 'bohemian', titulo: 'Bohemian Rhapsody', artista: 'Queen', pedir: 'canta 1' },
  { id: 'ligera', titulo: 'De música ligera', artista: 'Soda Stereo', pedir: 'canta 2' },
  { id: 'bittersweet', titulo: 'Bitter Sweet Symphony', artista: 'The Verve', pedir: 'canta 3' },
  { id: 'runaway', titulo: 'Runaway', artista: 'Kanye West', pedir: 'canta 4' },
  { id: 'bruno', titulo: 'Die With A Smile', artista: 'Bruno Mars', pedir: 'canta 5' },
];

export async function listCanciones(): Promise<Cancion[]> {
  try {
    const data = await api<{ canciones?: Cancion[] }>('/api/cantar', { method: 'GET' }, 8_000);
    return Array.isArray(data.canciones) && data.canciones.length ? data.canciones : CANCIONES_LOCAL;
  } catch {
    return CANCIONES_LOCAL;
  }
}

export async function transcribe(opts: { base64: string; mime: string }): Promise<string> {
  const data = await api<{ text?: string }>(
    '/api/stt',
    {
      method: 'POST',
      // audioBase64/mimeType: servidor 3.1; audio/mime: servidor anterior
      body: JSON.stringify({ audioBase64: `data:${opts.mime};base64,${opts.base64}`, mimeType: opts.mime, audio: opts.base64, mime: opts.mime, language: idiomaActual() }),
    },
    16_000
  );
  return String(data.text || '').trim();
}

/**
 * Un WAV (base64) al oído del servidor. `confirmar`: frase de dinero que Turbo ya oyó en vivo; el
 * servidor la vuelve a oír directo con Scribe v2 (sin pasar otra vez por Turbo).
 */
export async function transcribirWav(wavB64: string, confirmar = false, timeoutMs = 16_000): Promise<string> {
  const data = await api<{ text?: string }>(
    '/api/stt',
    {
      method: 'POST',
      body: JSON.stringify({ audioBase64: `data:audio/wav;base64,${wavB64}`, mimeType: 'audio/wav', language: idiomaActual(), ...(confirmar ? { confirmar: true } : {}) }),
    },
    timeoutMs
  );
  return String(data.text || '').trim();
}

/**
 * Permiso para oír en vivo con Scribe v2 Realtime Turbo: el servidor pide a ElevenLabs un token de un
 * solo uso (la clave nunca llega al teléfono) y devuelve la dirección del WebSocket lista, con el
 * modelo, el idioma y las pistas de vocabulario de AU-RA. null si el servidor no lo da.
 */
export async function pedirPermisoTurbo(): Promise<{ url: string; modelo: string } | null> {
  try {
    const d = await api<{ url?: string; modelo?: string }>('/api/stt/turbo/permiso', { method: 'POST', body: JSON.stringify({ language: idiomaActual() }) }, 8_000);
    return d?.url && /^wss:\/\//.test(d.url) ? { url: d.url, modelo: String(d.modelo || '') } : null;
  } catch {
    return null;
  }
}

export type RespuestaVista = {
  vista: VistaCamara | null;
  /** El hecho listo para el turno (vacío si el servidor es anterior y no lo arma). */
  visto: string;
  etiquetas: string[];
  /** false: el servidor no conoce el modo estructurado (contestó prosa); `vista` sale de las etiquetas. */
  estructurada: boolean;
};

const LISTA_VIEJA =
  'Responde SOLO con una lista corta en español, separada por comas, de lo visible (máximo 6): persona, objetos, gestos evidentes (ej: persona, taza, teléfono, saluda). Sin frases.';

/**
 * Ver con orden (POST /api/vision/analyze, modo «estructurado»): escena, objetos con caja, texto leído,
 * precios, según `foco`. El pedido al modelo lo arma el servidor. null si no se pudo ver.
 */
export async function verCamara(base64Jpeg: string, foco: FocoVision = 'escena', timeoutMs = 35_000): Promise<RespuestaVista | null> {
  try {
    const data = await api<{ summary?: string; vista?: unknown; etiquetas?: unknown }>(
      '/api/vision/analyze',
      {
        method: 'POST',
        // `prompt` solo lo usa un servidor anterior (sin modo estructurado): así devuelve la lista de
        // siempre y no prosa partida en «objetos». El servidor nuevo arma su propio pedido y lo ignora.
        body: JSON.stringify({ mediaType: 'image/jpeg', fileName: 'desk.jpg', base64Data: `data:image/jpeg;base64,${base64Jpeg}`, modo: 'estructurado', foco, prompt: LISTA_VIEJA }),
      },
      timeoutMs
    );
    const summary = String(data.summary || '').trim();
    const vista = vistaDeRespuesta(data.vista);
    if (vista) return { vista, visto: summary, etiquetas: etiquetasDeVista(vista), estructurada: true };
    if (!summary) return null;
    const vieja = vistaDeEtiquetas(summary);
    return { vista: vieja, visto: '', etiquetas: vieja ? etiquetasDeVista(vieja) : [], estructurada: false };
  } catch {
    return null;
  }
}

export async function describeImage(base64Jpeg: string, prompt: string): Promise<string> {
  try {
    const data = await api<{ summary?: string }>(
      '/api/vision/analyze',
      {
        method: 'POST',
        body: JSON.stringify({ mediaType: 'image/jpeg', fileName: 'desk.jpg', base64Data: `data:image/jpeg;base64,${base64Jpeg}`, prompt }),
      },
      35_000
    );
    return String(data.summary || '').trim();
  } catch {
    return '';
  }
}
