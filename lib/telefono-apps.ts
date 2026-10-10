/**
 * ABRIR OTRAS APPS DEL TELÉFONO (José, 10-oct, AU-RA 5.7.0 en su S26: «le pedí abrir una app, Spotify, en mi celular y no
 * pudo»). El registro decía «prometió sin herramienta con 13 de 29: la re-pregunta va con todas» y «no usó ninguna al
 * pedírsela»: no había NINGUNA herramienta que abriera una app del teléfono, así que el cerebro prometía «te abro
 * Spotify» y la guarda lo desmentía con un «Eso todavía no lo hice» que no decía por qué.
 *
 * Desde la APK 5.7.1 el teléfono sabe (plugins/asistente-digital.js, TelefonoAura.kt): listar sus apps, abrir una por su
 * paquete y abrir un enlace profundo (spotify:search:…, whatsapp://send?…, geo:…, https:…). El teléfono lo declara con la
 * mano `abrir_apps` (en su contexto, o en el turno con `capacidades`) y SOLO entonces el cerebro tiene la herramienta
 * `abrir_en_telefono` (lib/cerebro-manos.ts). Aquí, sin red ni dependencias:
 *  · la forma de las dos acciones (`abrir_app {app, paquete?}` y `abrir_enlace {uri, app?, web?}`) y su validación;
 *  · de lo que pidió el modelo (`app`, `enlace`, `que`) a la acción: «pon música de Bad Bunny en Spotify» →
 *    `spotify:search:Bad%20Bunny` (con su respaldo por la web si Spotify no está);
 *  · las frases que piden abrir otra app (para elegir la herramienta en un turno hablado) y las que nombran una app que NO
 *    es una pantalla de AU-RA (para no confundir «te abro Spotify» con abrir Ajustes de la app).
 *
 * El nombre lo resuelve el TELÉFONO contra sus apps instaladas (mobile/src/telefono/apps.ts): el servidor no sabe qué
 * tiene instalado. Lo que hizo vuelve como recibo (POST /api/app/recibo): sin ese recibo nadie dice «abrí».
 * Nunca en Dr Electrum (server.ts solo ofrece la mano en AU-RA).
 */

/** Los esquemas de enlace que el teléfono abre (los mismos `<queries>` del manifiesto y el filtro de TelefonoAura.kt). */
export const ESQUEMAS_ENLACE = ['spotify', 'whatsapp', 'geo', 'https', 'tel', 'mailto'] as const;
export type EsquemaEnlace = (typeof ESQUEMAS_ENLACE)[number];
export const MAX_NOMBRE_APP = 60;
export const MAX_ENLACE = 600;
export const MAX_QUE = 120;

export type AccionTelefono =
  /** Abre una app instalada por su nombre (el teléfono lo resuelve contra sus apps) o su paquete. */
  | { tipo: 'abrir_app'; app: string; paquete?: string }
  /** Abre un enlace profundo; `web` (https) es el respaldo si no hay app que lo abra. */
  | { tipo: 'abrir_enlace'; uri: string; app?: string; web?: string }
  /** La navegación hasta un destino (Google Maps; si no, Waze; si no, geo:). */
  | { tipo: 'navegar'; destino: string; app?: string }
  /** La alarma del reloj del teléfono (AlarmClock, sin abrir el reloj). */
  | { tipo: 'alarma'; hora: number; minutos: number; etiqueta?: string }
  /** El temporizador del reloj del teléfono. */
  | { tipo: 'temporizador'; segundos: number; etiqueta?: string }
  /** Un BORRADOR de SMS con el número y el texto: ella le da enviar (sin SEND_SMS). */
  | { tipo: 'sms'; numero: string; texto: string; nombre?: string }
  /** La pantalla de evento nuevo del calendario del teléfono, llena: ELLA lo guarda (revisión obligatoria). */
  | { tipo: 'evento_calendario'; titulo: string; inicio: number; fin: number };

export const TIPOS_TELEFONO = ['abrir_app', 'abrir_enlace', 'navegar', 'alarma', 'temporizador', 'sms', 'evento_calendario'] as const;
/** Las de la mano `abrir_apps` (abrir apps y enlaces, navegar) y las de `intents_telefono` (reloj, SMS, calendario). */
export const TIPOS_ABRIR = ['abrir_app', 'abrir_enlace', 'navegar'] as const;
export const TIPOS_INTENTS = ['alarma', 'temporizador', 'sms', 'evento_calendario'] as const;
export const esAccionTelefono = (a: { tipo?: unknown } | null | undefined): boolean => !!a && (TIPOS_TELEFONO as readonly unknown[]).includes(a.tipo);

const linea = (v: unknown, max: number) =>
  String(v ?? '')
    .replace(/[\u0000-\u001f\u007f\u2028\u2029]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max)
    .trim();
/** Sin tildes, en minúsculas. */
export const planoApp = (s: unknown) =>
  String(s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9ñ+\s.-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/** El nombre de una app tal como se dijo («Spotify», «Google Maps»), limpio; null si no queda nada. */
export function nombreAppValido(v: unknown): string | null {
  const n = linea(v, MAX_NOMBRE_APP)
    .replace(/ACCI[OÓ]N_APP|PEDIR_HERRAMIENTA/gi, ' ')
    .replace(/^(la |el )?(app|aplicaci[oó]n)( de)? /i, '')
    .replace(/\s+/g, ' ')
    .trim();
  return n && /[\p{L}\p{N}]/u.test(n) ? n : null;
}

/** Un paquete de Android (`com.spotify.music`); null si no tiene esa forma. */
export function paqueteValido(v: unknown): string | null {
  const p = String(v ?? '').trim();
  return p.length <= 150 && /^[a-zA-Z][a-zA-Z0-9_]*(\.[a-zA-Z][a-zA-Z0-9_]*)+$/.test(p) ? p : null;
}

/**
 * Un enlace que el teléfono puede abrir: uno de ESQUEMAS_ENLACE, sin espacios ni caracteres de control, ≤ MAX_ENLACE; un
 * https con su host. Lo demás (javascript:, intent:, file:, content:, http:) es null: nunca se abre.
 */
export function enlaceValido(v: unknown): string | null {
  const u = String(v ?? '').trim();
  if (!u || u.length > MAX_ENLACE || /[\s\u0000-\u001f\u007f<>"]/.test(u)) return null;
  const m = /^([a-z][a-z0-9+.-]*):(.*)$/i.exec(u);
  if (!m) return null;
  const esquema = m[1].toLowerCase() as EsquemaEnlace;
  if (!(ESQUEMAS_ENLACE as readonly string[]).includes(esquema)) return null;
  const resto = m[2];
  if (!resto) return null;
  if (esquema === 'https' && !/^\/\/[a-z0-9-]+(\.[a-z0-9-]+)+(:\d+)?(\/|\?|#|$)/i.test(resto)) return null;
  if (esquema === 'whatsapp' && !/^\/\/send\b/i.test(resto)) return null;
  if (esquema === 'tel' && !/^\+?[\d\s()-]{3,20}$/.test(resto)) return null;
  return `${esquema}:${resto}`;
}

/** La app que abre un esquema (para decir «Abriendo Spotify…» y para el recibo). */
export function appDeEnlace(uri: string): string | undefined {
  const e = uri.split(':')[0].toLowerCase();
  if (e === 'spotify') return 'Spotify';
  if (e === 'whatsapp') return 'WhatsApp';
  if (e === 'geo') return 'Maps';
  if (e === 'tel') return 'Teléfono';
  if (e === 'mailto') return 'Correo';
  if (/^https:\/\/(www\.|m\.|music\.)?youtube\.com\//i.test(uri) || /^https:\/\/youtu\.be\//i.test(uri)) return 'YouTube';
  if (/^https:\/\/(www\.)?google\.[a-z.]+\/maps/i.test(uri)) return 'Maps';
  if (/^https:\/\/(www\.)?waze\.com\//i.test(uri)) return 'Waze';
  if (/^https:\/\/open\.spotify\.com\//i.test(uri)) return 'Spotify';
  return undefined;
}

/** Lo que pide «que», sin el verbo ni la app («reproduce música de Bad Bunny en Spotify» → «Bad Bunny»). */
export function busquedaDeQue(que: unknown): string {
  return linea(que, MAX_QUE)
    .replace(/^(por favor,?\s+)?/i, '')
    .replace(/^(pon(me|le)?|reproduce(me)?|toca(me)?|busca(me)?|abre(me)?|quiero (oir|oír|escuchar|ver)|escuchar|ver|ll[eé]vame( a| al| hasta)?|c[oó]mo llego( a| al)?|navega( a| hasta)?|la ruta( a| al| hasta)?)\s+/i, '')
    .replace(/^(un poco de |algo de |la |el |los |las )?(m[uú]sica|canciones|canci[oó]n|videos?|playlist|lista|[aá]lbum|rolas?)( de| del)?\s+/i, '')
    .replace(/\s+(en|por|con)\s+(spotify|youtube|you tube|youtube music|maps|google maps|mapas|waze)\s*$/i, '')
    .replace(/[.!¡¿?]+$/g, '')
    .trim();
}

type Destino = 'spotify' | 'youtube' | 'maps' | 'waze';
const DESTINOS: Array<[Destino, RegExp]> = [
  ['spotify', /\bspotify\b/],
  ['youtube', /\b(you ?tube|youtube music|yt music)\b/],
  ['waze', /\bwaze\b/],
  ['maps', /\b(google maps|maps|mapas?|gps)\b/],
];
const destinoDe = (app: string): Destino | null => DESTINOS.find(([, re]) => re.test(planoApp(app)))?.[0] ?? null;
/** Sin app, por lo que pide: música → Spotify; un video → YouTube; una dirección → Maps. */
function destinoPorQue(que: string): Destino | null {
  const p = planoApp(que);
  if (/\b(musica|cancion\w*|rola\w*|playlist|album|escuchar|oir|reproduc\w*)\b/.test(p)) return 'spotify';
  if (/\b(video\w*|ver )\b/.test(p)) return 'youtube';
  if (/\b(llevame|como llego|ruta|navega\w*|direccion|ubicacion)\b/.test(p)) return 'maps';
  return null;
}

const NOMBRE_DESTINO: Record<Destino, string> = { spotify: 'Spotify', youtube: 'YouTube', maps: 'Maps', waze: 'Waze' };

/** El enlace profundo (y su respaldo por la web) para buscar `q` en esa app. */
export function enlaceDeBusqueda(destino: Destino, q: string): { uri: string; web: string } {
  const e = encodeURIComponent(q);
  switch (destino) {
    case 'spotify':
      return { uri: `spotify:search:${e}`, web: `https://open.spotify.com/search/${e}` };
    case 'youtube':
      return { uri: `https://www.youtube.com/results?search_query=${e}`, web: `https://www.youtube.com/results?search_query=${e}` };
    case 'waze':
      return { uri: `https://waze.com/ul?q=${e}&navigate=yes`, web: `https://waze.com/ul?q=${e}&navigate=yes` };
    case 'maps':
      return { uri: `geo:0,0?q=${e}`, web: `https://www.google.com/maps/search/?api=1&query=${e}` };
  }
}

/**
 * De lo que pidió el modelo con `abrir_en_telefono` a la acción para el teléfono (o null si no trae nada que abrir):
 *  · un `enlace` válido gana (con la app que lo abre);
 *  · `que` con una app que sabe buscar (Spotify, YouTube, Maps, Waze) —o sin app, por lo que pide— es su enlace de
 *    búsqueda con el respaldo por la web;
 *  · si no, abrir la app por su nombre (`paquete` si el modelo dio uno con esa forma).
 */
export function accionDeAbrir(i: { app?: unknown; enlace?: unknown; que?: unknown; paquete?: unknown }): AccionTelefono | null {
  const app = nombreAppValido(i.app);
  const uri = enlaceValido(i.enlace);
  if (uri) {
    const de = app || appDeEnlace(uri);
    return { tipo: 'abrir_enlace', uri, ...(de ? { app: de } : {}) };
  }
  const que = linea(i.que, MAX_QUE);
  const q = busquedaDeQue(que);
  const destino = app ? destinoDe(app) : que ? destinoPorQue(que) : null;
  if (destino && q && planoApp(q) !== planoApp(app || '')) {
    // «Llévame a San Pedro Sula»: la navegación (Google Maps, si no Waze, si no geo:), no solo el mapa.
    if (destino === 'maps') return { tipo: 'navegar', destino: q, ...(app ? { app } : {}) };
    const { uri: u, web } = enlaceDeBusqueda(destino, q);
    return { tipo: 'abrir_enlace', uri: u, app: app || NOMBRE_DESTINO[destino], ...(web !== u ? { web } : {}) };
  }
  if (!app) return destino ? { tipo: 'abrir_app', app: NOMBRE_DESTINO[destino] } : null;
  const paquete = paqueteValido(i.paquete) || paqueteValido(app);
  return { tipo: 'abrir_app', app, ...(paquete ? { paquete } : {}) };
}

/** La forma estricta de una acción del teléfono que llega de afuera (del modelo o de una línea ACCION_APP), o null. */
export function validarAccionTelefono(a: Record<string, unknown>): AccionTelefono | null {
  if (a.tipo === 'abrir_app') {
    const app = nombreAppValido(a.app);
    const paquete = paqueteValido(a.paquete);
    if (!app && !paquete) return null;
    return { tipo: 'abrir_app', app: app || (paquete as string), ...(paquete ? { paquete } : {}) };
  }
  if (a.tipo === 'abrir_enlace') {
    const uri = enlaceValido(a.uri);
    if (!uri) return null;
    const app = nombreAppValido(a.app) || appDeEnlace(uri);
    const web = enlaceValido(a.web);
    return { tipo: 'abrir_enlace', uri, ...(app ? { app } : {}), ...(web && web.startsWith('https:') && web !== uri ? { web } : {}) };
  }
  if (a.tipo === 'navegar') {
    const destino = linea(a.destino, 200).replace(/ACCI[OÓ]N_APP|PEDIR_HERRAMIENTA/gi, ' ').trim();
    const app = nombreAppValido(a.app);
    return destino ? { tipo: 'navegar', destino, ...(app ? { app } : {}) } : null;
  }
  if (a.tipo === 'alarma') {
    const hora = Number(a.hora);
    const minutos = Number(a.minutos);
    if (!Number.isInteger(hora) || !Number.isInteger(minutos) || hora < 0 || hora > 23 || minutos < 0 || minutos > 59) return null;
    const etiqueta = etiquetaValida(a.etiqueta);
    return { tipo: 'alarma', hora, minutos, ...(etiqueta ? { etiqueta } : {}) };
  }
  if (a.tipo === 'temporizador') {
    const segundos = Math.round(Number(a.segundos));
    if (!Number.isFinite(segundos) || segundos < 1 || segundos > MAX_TEMPORIZADOR_S) return null;
    const etiqueta = etiquetaValida(a.etiqueta);
    return { tipo: 'temporizador', segundos, ...(etiqueta ? { etiqueta } : {}) };
  }
  if (a.tipo === 'sms') {
    const numero = numeroSmsValido(a.numero);
    const texto = linea(a.texto, MAX_SMS).replace(/ACCI[OÓ]N_APP|PEDIR_HERRAMIENTA/gi, ' ').trim();
    const nombre = linea(a.nombre, 80);
    return numero && texto ? { tipo: 'sms', numero, texto, ...(nombre ? { nombre } : {}) } : null;
  }
  if (a.tipo === 'evento_calendario') {
    const titulo = linea(a.titulo, 200).replace(/ACCI[OÓ]N_APP|PEDIR_HERRAMIENTA/gi, ' ').trim();
    const inicio = Math.round(Number(a.inicio));
    const fin = Math.round(Number(a.fin));
    if (!titulo || !Number.isFinite(inicio) || !Number.isFinite(fin) || fin <= inicio || fin - inicio > 14 * 86_400_000) return null;
    return { tipo: 'evento_calendario', titulo, inicio, fin };
  }
  return null;
}

export const MAX_TEMPORIZADOR_S = 24 * 3600;
export const MAX_SMS = 600;
const etiquetaValida = (v: unknown) => linea(v, 80).replace(/ACCI[OÓ]N_APP|PEDIR_HERRAMIENTA/gi, ' ').trim() || undefined;
/** Un número para el SMS: dígitos (con + delante, espacios o guiones), de 7 a 15 cifras. */
export function numeroSmsValido(v: unknown): string | null {
  const t = String(v ?? '').trim();
  if (!/^\+?[\d\s()-]{7,22}$/.test(t)) return null;
  const cifras = t.replace(/\D/g, '');
  return cifras.length >= 7 && cifras.length <= 15 ? `${t.startsWith('+') ? '+' : ''}${cifras}` : null;
}

/** Honduras está en UTC-6 todo el año. «AAAA-MM-DDTHH:MM» (hora de Honduras) → epoch ms, o null. */
export function msDeHoraHN(v: unknown): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})$/.exec(String(v ?? '').trim());
  if (!m) return null;
  const [an, me, di, ho, mi] = m.slice(1).map(Number);
  if (me < 1 || me > 12 || di < 1 || di > 31 || ho > 23 || mi > 59) return null;
  return Date.UTC(an, me - 1, di, ho, mi) + 6 * 3600_000;
}
/** «HH:MM» o «AAAA-MM-DDTHH:MM» → la hora y los minutos (la alarma del reloj solo lleva la hora). */
export function horaDe(v: unknown): { hora: number; minutos: number } | null {
  const m = /(?:^|T|\s)(\d{1,2}):(\d{2})$/.exec(String(v ?? '').trim());
  if (!m) return null;
  const hora = Number(m[1]);
  const minutos = Number(m[2]);
  return hora <= 23 && minutos <= 59 ? { hora, minutos } : null;
}

/** De la herramienta `alarma_telefono` a la acción (o null). */
export function accionDeReloj(i: { accion?: unknown; hora?: unknown; segundos?: unknown; minutos?: unknown; etiqueta?: unknown }): AccionTelefono | null {
  const etiqueta = etiquetaValida(i.etiqueta);
  if (i.accion === 'temporizador') {
    const s = Math.round(Number(i.segundos) || Number(i.minutos) * 60 || 0);
    return validarAccionTelefono({ tipo: 'temporizador', segundos: s, etiqueta });
  }
  const h = horaDe(i.hora);
  return h ? validarAccionTelefono({ tipo: 'alarma', ...h, etiqueta }) : null;
}

/** De la herramienta `sms_telefono` a la acción: el número dicho, o el de un contacto del teléfono que lo tenga. */
export function accionDeSms(i: { a?: unknown; numero?: unknown; texto?: unknown }, contactos: ReadonlyArray<{ nombre?: string; telefono?: string }> = []): AccionTelefono | null {
  const dicho = linea(i.numero ?? i.a, 120);
  const directo = numeroSmsValido(dicho);
  if (directo) return validarAccionTelefono({ tipo: 'sms', numero: directo, texto: i.texto });
  const p = planoApp(dicho);
  if (!p) return null;
  const con = contactos.filter((c) => c.telefono && planoApp(c.nombre) === p);
  const parecidos = con.length ? con : contactos.filter((c) => c.telefono && planoApp(c.nombre).split(' ').includes(p));
  if (parecidos.length !== 1) return null;
  return validarAccionTelefono({ tipo: 'sms', numero: parecidos[0].telefono, texto: i.texto, nombre: parecidos[0].nombre });
}

/** De la herramienta `evento_telefono` a la acción (la pantalla del calendario del teléfono, para que ella la guarde). */
export function accionDeEvento(i: { titulo?: unknown; inicio?: unknown; minutos?: unknown }): AccionTelefono | null {
  const inicio = msDeHoraHN(i.inicio);
  if (inicio === null) return null;
  const min = Math.round(Number(i.minutos) || 60);
  return validarAccionTelefono({ tipo: 'evento_calendario', titulo: i.titulo, inicio, fin: inicio + Math.min(Math.max(min, 5), 24 * 60) * 60_000 });
}

const dos = (n: number) => String(n).padStart(2, '0');
/**
 * Lo que se dice al pedirla (nunca «ya la abrí», «quedó puesta» ni «agendado»: eso lo dice el recibo del teléfono). El SMS
 * lee SIEMPRE a quién y el texto final (regla de aprobación hablada: lo que va a otra persona se dice entero).
 */
export function dichoDeAbrir(a: AccionTelefono, idioma: 'es' | 'en' = 'es'): string {
  const en = idioma === 'en';
  switch (a.tipo) {
    case 'navegar':
      return en ? `Starting directions to ${a.destino}…` : `Abriendo la ruta a ${a.destino}…`;
    case 'alarma':
      return en ? `Setting the alarm for ${dos(a.hora)}:${dos(a.minutos)} on your phone…` : `Poniendo la alarma de las ${dos(a.hora)}:${dos(a.minutos)} en tu teléfono…`;
    case 'temporizador': {
      const m = Math.floor(a.segundos / 60);
      const s = a.segundos % 60;
      const cuanto = m && s ? `${m} min ${s} s` : m ? `${m} min` : `${s} s`;
      return en ? `Starting a ${cuanto} timer on your phone…` : `Poniendo un temporizador de ${cuanto} en tu teléfono…`;
    }
    case 'sms': {
      const quien = a.nombre ? `${a.nombre} (${a.numero})` : a.numero;
      return en ? `I'm leaving the text for ${quien} ready: «${a.texto}». You tap send.` : `Te dejo listo el SMS para ${quien}: «${a.texto}». Tú le das enviar.`;
    }
    case 'evento_calendario':
      return en ? `I'm opening your calendar with «${a.titulo}» filled in: save it to confirm.` : `Te abro el calendario con «${a.titulo}» lleno: guárdalo tú para confirmarlo.`;
    default: {
      const app = a.app || (a.tipo === 'abrir_enlace' ? appDeEnlace(a.uri) : '') || '';
      if (en) return app ? `Opening ${app}…` : 'Opening it…';
      return app ? `Abriendo ${app}…` : 'Abriéndolo…';
    }
  }
}

/** La mano que hace falta para una acción del teléfono. */
export const manoDeTelefono = (tipo: string): 'abrir_apps' | 'intents_telefono' | null =>
  (TIPOS_ABRIR as readonly string[]).includes(tipo) ? 'abrir_apps' : (TIPOS_INTENTS as readonly string[]).includes(tipo) ? 'intents_telefono' : null;

/**
 * Las apps de afuera que más se piden (no son pantallas de AU-RA). WhatsApp NO va: «abre WhatsApp» es la pestaña de
 * WhatsApp de AU-RA (abrir_pantalla); la app de WhatsApp se pide con «la app de WhatsApp» o con un enlace.
 */
const APP_EXTERNA =
  /\b(spotify|you ?tube|youtube music|instagram|insta|tik ?tok|netflix|waze|google maps|maps|gmail|facebook|messenger|uber|telegram|chrome|calculadora|galeria|play store|disney|prime video|deezer|apple music|x\.com|twitter)\b|\b(la|una|otra|esa|tu|mi) (app|aplicacion)\b|\bapps? (de|del) (mi |tu |el )?(telefono|celular|cel)\b/;
/** ¿El texto nombra una app de afuera (no una pantalla de AU-RA)? Se compara sin tildes. */
export function nombraAppExterna(texto: string): boolean {
  return APP_EXTERNA.test(planoApp(texto));
}

/**
 * ¿La frase pide abrir otra app del teléfono o algo dentro de ella? Para elegir la herramienta en un turno hablado
 * (lib/herramientas-turno.ts). «¿Qué opinas de la música de los noventa?» no: la música sola es charla.
 */
const PIDE_TELEFONO = new RegExp(
  [
    APP_EXTERNA.source,
    /\b(pon|ponme|ponle|ponga|reproduc\w*|toca|tocame|quiero (oir|escuchar)|dejame escuchar)\b.{0,40}\b(musica|cancion\w*|rola\w*|playlist|album|disco|podcast\w*)\b/.source,
    /\b(llevame|como llego|navega(r|me)?|guiame) (a|al|hasta|para)\b|\bla ruta (a|al|hasta|para)\b/.source,
    /\b(abre|abreme|abrime|abrir|lanza|inicia|entra a) (la |el )?(app|aplicacion|camara del telefono|ajustes del telefono|configuracion del telefono)\b/.source,
  ].join('|')
);
export function pideAbrirEnTelefono(texto: string): boolean {
  return PIDE_TELEFONO.test(planoApp(texto));
}
