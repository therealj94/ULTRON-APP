/**
 * LAS APPS DEL TELÉFONO, POR SU NOMBRE (José, 10-oct, AU-RA 5.7.0 en su S26: «le pedí abrir una app, Spotify, en mi
 * celular y no pudo»).
 *
 * El servidor no sabe qué tiene instalado: manda `abrir_app { app: "Spotify" }` tal como se dijo y el teléfono lo resuelve
 * aquí contra sus apps (`listarApps()` del módulo nativo AuraTelefono: paquete y nombre de cada app que se puede abrir):
 *  · sin tildes ni mayúsculas, sin «la app de», «aplicación», artículos;
 *  · con los apodos de siempre («Maps» y «Google Maps», «Insta», «la cámara», «Ajustes», «Teléfono», «wasap»…) y sus
 *    paquetes conocidos (Samsung y Google);
 *  · una sola que encaja → esa; varias → se pregunta cuál (nunca se abre una al azar); ninguna → no está instalada.
 *
 * Puro (sin React Native): lo prueban tests/telefono-acciones.test.ts y el ejecutor (telefono/ejecutor.ts).
 */

export type AppInstalada = { paquete: string; nombre: string };
export type Resolucion = { tipo: 'una'; app: AppInstalada } | { tipo: 'varias'; opciones: AppInstalada[] } | { tipo: 'ninguna' };

/** Los esquemas de enlace permitidos (los mismos de lib/telefono-apps.ts y TelefonoAura.kt). */
export const ESQUEMAS_ENLACE = ['spotify', 'whatsapp', 'geo', 'https', 'tel', 'mailto'] as const;

export const plano = (s: unknown) =>
  String(s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9ñ+\s]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/** El nombre pedido sin el relleno: «abre la app de Google Maps» → «google maps». */
export function nombreLimpio(pedido: string): string {
  return plano(pedido)
    .replace(/^(abre(me)?|abrir|lanza|inicia|pon(me)?)\s+/, '')
    .replace(/^(la|el|los|las|mi|tu)\s+/, '')
    .replace(/^(app|aplicacion)( de| del)?\s+/, '')
    .replace(/^(la|el)\s+/, '')
    .replace(/\s+(app|aplicacion)$/, '')
    .replace(/\s+(del|de mi|de tu) (telefono|celular|cel)$/, '')
    .trim();
}

/** Los apodos de siempre: [apodos, paquetes conocidos, nombres que suele tener la app]. */
const ALIAS: Array<{ apodos: string[]; paquetes: string[]; nombres: string[] }> = [
  { apodos: ['spotify'], paquetes: ['com.spotify.music'], nombres: ['spotify'] },
  { apodos: ['whatsapp', 'whats app', 'wasap', 'guasap', 'whats', 'wsp'], paquetes: ['com.whatsapp'], nombres: ['whatsapp'] },
  { apodos: ['whatsapp business'], paquetes: ['com.whatsapp.w4b'], nombres: ['whatsapp business'] },
  { apodos: ['youtube', 'you tube'], paquetes: ['com.google.android.youtube'], nombres: ['youtube'] },
  { apodos: ['youtube music', 'yt music'], paquetes: ['com.google.android.apps.youtube.music'], nombres: ['youtube music'] },
  { apodos: ['maps', 'google maps', 'mapas', 'mapa', 'gps'], paquetes: ['com.google.android.apps.maps'], nombres: ['maps', 'google maps'] },
  { apodos: ['waze'], paquetes: ['com.waze'], nombres: ['waze'] },
  { apodos: ['gmail', 'correo de google'], paquetes: ['com.google.android.gm'], nombres: ['gmail'] },
  { apodos: ['instagram', 'insta'], paquetes: ['com.instagram.android'], nombres: ['instagram'] },
  { apodos: ['tiktok', 'tik tok'], paquetes: ['com.zhiliaoapp.musically', 'com.ss.android.ugc.trill'], nombres: ['tiktok'] },
  { apodos: ['facebook', 'face'], paquetes: ['com.facebook.katana'], nombres: ['facebook'] },
  { apodos: ['messenger'], paquetes: ['com.facebook.orca'], nombres: ['messenger'] },
  { apodos: ['telegram'], paquetes: ['org.telegram.messenger'], nombres: ['telegram'] },
  { apodos: ['netflix'], paquetes: ['com.netflix.mediaclient'], nombres: ['netflix'] },
  { apodos: ['uber'], paquetes: ['com.ubercab'], nombres: ['uber'] },
  { apodos: ['chrome', 'navegador', 'google chrome'], paquetes: ['com.android.chrome', 'com.sec.android.app.sbrowser'], nombres: ['chrome', 'internet', 'samsung internet'] },
  { apodos: ['play store', 'tienda', 'playstore', 'google play'], paquetes: ['com.android.vending'], nombres: ['play store', 'google play store'] },
  { apodos: ['camara', 'camera', 'la camara'], paquetes: ['com.sec.android.app.camera', 'com.google.android.GoogleCamera', 'com.android.camera'], nombres: ['camara', 'camera'] },
  { apodos: ['ajustes', 'configuracion', 'settings', 'ajustes del telefono', 'configuracion del telefono'], paquetes: ['com.android.settings'], nombres: ['ajustes', 'configuracion', 'settings'] },
  { apodos: ['calendario', 'calendar', 'agenda'], paquetes: ['com.google.android.calendar', 'com.samsung.android.calendar'], nombres: ['calendario', 'calendar', 'google calendar'] },
  { apodos: ['telefono', 'marcador', 'phone', 'llamadas'], paquetes: ['com.google.android.dialer', 'com.samsung.android.dialer'], nombres: ['telefono', 'phone'] },
  { apodos: ['mensajes', 'sms', 'messages'], paquetes: ['com.google.android.apps.messaging', 'com.samsung.android.messaging'], nombres: ['mensajes', 'messages'] },
  { apodos: ['reloj', 'alarmas', 'clock'], paquetes: ['com.google.android.deskclock', 'com.sec.android.app.clockpackage'], nombres: ['reloj', 'clock'] },
  { apodos: ['galeria', 'fotos', 'photos', 'gallery'], paquetes: ['com.sec.android.gallery3d', 'com.google.android.apps.photos'], nombres: ['galeria', 'fotos', 'google fotos', 'gallery', 'photos'] },
  { apodos: ['calculadora', 'calculator'], paquetes: ['com.sec.android.app.popupcalculator', 'com.google.android.calculator'], nombres: ['calculadora', 'calculator'] },
  { apodos: ['contactos', 'contacts'], paquetes: ['com.samsung.android.app.contacts', 'com.google.android.contacts'], nombres: ['contactos', 'contacts'] },
];

/** La distancia de edición (para «spotfy», «instragram»), con tope: más de `max` cuenta como lejos. */
function distancia(a: string, b: string, max = 2): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let mejor = i;
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      mejor = Math.min(mejor, cur[j]);
    }
    if (mejor > max) return max + 1;
    prev = cur;
  }
  return prev[b.length];
}

const unicas = (xs: AppInstalada[]) => xs.filter((x, i) => xs.findIndex((y) => y.paquete === x.paquete) === i);
const de = (xs: AppInstalada[]): Resolucion => {
  const u = unicas(xs);
  return u.length === 1 ? { tipo: 'una', app: u[0] } : u.length > 1 ? { tipo: 'varias', opciones: u.slice(0, 4) } : { tipo: 'ninguna' };
};

/** Resuelve el nombre dicho (o el paquete) contra las apps instaladas. Ver arriba. */
export function resolverApp(pedido: string, apps: readonly AppInstalada[], paquete?: string): Resolucion {
  const lista = (apps || []).filter((a) => a && a.paquete && a.nombre);
  if (paquete) {
    const exacta = lista.find((a) => a.paquete === paquete);
    if (exacta) return { tipo: 'una', app: exacta };
  }
  const n = nombreLimpio(pedido);
  if (!n) return { tipo: 'ninguna' };
  const conNombre = lista.map((a) => ({ a, p: plano(a.nombre) }));
  // 1. El nombre exacto.
  const exactas = conNombre.filter((x) => x.p === n).map((x) => x.a);
  if (exactas.length) return de(exactas);
  // 2. Un apodo conocido: sus paquetes o sus nombres de siempre (el apodo más largo que encaje gana: «youtube music»).
  const grupo = ALIAS.filter((g) => g.apodos.some((ap) => n === ap || new RegExp(`(^| )${ap}( |$)`).test(n))).sort(
    (x, y) => Math.max(...y.apodos.filter((ap) => n.includes(ap)).map((ap) => ap.length), 0) - Math.max(...x.apodos.filter((ap) => n.includes(ap)).map((ap) => ap.length), 0)
  )[0];
  if (grupo) {
    const porPaquete = grupo.paquetes.map((p) => lista.find((a) => a.paquete === p)).filter((a): a is AppInstalada => !!a);
    if (porPaquete.length === 1) return { tipo: 'una', app: porPaquete[0] };
    const porNombre = conNombre.filter((x) => grupo.nombres.includes(x.p)).map((x) => x.a);
    const juntas = unicas([...porPaquete, ...porNombre]);
    if (juntas.length) return de(juntas);
  }
  // 3. Las que empiezan o contienen lo dicho como palabras («google» → varias; «drive» → «Drive»).
  const contienen = conNombre.filter((x) => new RegExp(`(^| )${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}( |$)`).test(x.p)).map((x) => x.a);
  if (contienen.length) return de(contienen);
  // 4. Un error de dedo («spotfy»): solo con nombres de 5+ letras, y una sola a distancia mínima.
  if (n.length >= 5) {
    const cerca = conNombre.map((x) => ({ a: x.a, d: distancia(n, x.p) })).filter((x) => x.d <= (n.length >= 8 ? 2 : 1));
    if (cerca.length) {
      const min = Math.min(...cerca.map((x) => x.d));
      return de(cerca.filter((x) => x.d === min).map((x) => x.a));
    }
  }
  return { tipo: 'ninguna' };
}

/** ¿Un enlace que se puede abrir? (esquema permitido, sin espacios; mismas reglas que el servidor y el nativo). */
export function enlacePermitido(uri: unknown): boolean {
  const u = String(uri ?? '').trim();
  const m = /^([a-z][a-z0-9+.-]*):\S+$/i.exec(u);
  return !!m && u.length <= 600 && (ESQUEMAS_ENLACE as readonly string[]).includes(m[1].toLowerCase());
}

const txt = (v: unknown, max: number) => typeof v === 'string' && v.trim().length > 0 && v.length <= max;
const entero = (v: unknown, min: number, max: number) => typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max;

export const TIPOS_TELEFONO = ['abrir_app', 'abrir_enlace', 'navegar', 'alarma', 'temporizador', 'sms', 'evento_calendario'] as const;

/** ¿Es una acción del teléfono bien formada? (la misma forma estricta que valida el servidor: lib/telefono-apps.ts). */
export function esAccionTelefono(a: any): boolean {
  if (!a || typeof a !== 'object') return false;
  switch (a.tipo) {
    case 'abrir_app':
      return txt(a.app, 150) && (a.paquete === undefined || (typeof a.paquete === 'string' && /^[a-zA-Z][\w]*(\.[a-zA-Z][\w]*)+$/.test(a.paquete)));
    case 'abrir_enlace':
      return enlacePermitido(a.uri) && (a.app === undefined || txt(a.app, 60)) && (a.web === undefined || (enlacePermitido(a.web) && String(a.web).startsWith('https:')));
    case 'navegar':
      return txt(a.destino, 200);
    case 'alarma':
      return entero(a.hora, 0, 23) && entero(a.minutos, 0, 59) && (a.etiqueta === undefined || txt(a.etiqueta, 80));
    case 'temporizador':
      return entero(a.segundos, 1, 86_400) && (a.etiqueta === undefined || txt(a.etiqueta, 80));
    case 'sms':
      return typeof a.numero === 'string' && /^\+?\d{7,15}$/.test(a.numero) && txt(a.texto, 600) && (a.nombre === undefined || txt(a.nombre, 80));
    case 'evento_calendario':
      return txt(a.titulo, 200) && typeof a.inicio === 'number' && typeof a.fin === 'number' && a.fin > a.inicio;
    default:
      return false;
  }
}
