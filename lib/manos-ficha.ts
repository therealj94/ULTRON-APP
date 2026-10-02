/**
 * LA FICHA DE MANOS: lo que el asistente PUEDE HACER en cada plataforma, dicho como persona.
 *
 * José (1-oct): «a cada avatar hay que darle conocimiento de lo que puede hacer como asistente de la
 * persona… darle manos, que sepan lo que pueden y ejecutar en todos».
 *
 * Una sola lista por plataforma, sacada de lo que de verdad ejecuta cada una:
 *  · app (AU-RA en el teléfono): lib/manos-app.ts (llamar, leer y buscar chats, recordatorios, que te
 *    llame, perfil, idioma) y lib/acciones-app.ts (pantallas, tema, avatar, redactar/enviar, silencio),
 *    más las herramientas del cerebro (lib/capacidades.ts: internet, cámara, oro, lempira, PDF).
 *  · web (la mesa en el navegador): las herramientas del cerebro, sin las manos del teléfono.
 *  · windows (el .exe): el enum Mano de windows/src/Aura.Windows.Core/Manos.cs.
 *  · electrum (Dr Electrum): server/electrum/manos.ts.
 * Entra en el prompt (para que nunca ofrezca lo que esa plataforma no hace) y en la respuesta al
 * instante de «¿qué puedes hacer?» (lib/respuestas-fijas.ts), que rota cuáles nombra para no sonar
 * grabada. tests/manos-ficha.test.ts vigila que cada mano de la ficha exista en su plataforma.
 */
import type { Idioma } from '../server/eleven';
import { computadoraDisponible, correoDisponible } from './harness';

export type PlataformaManos = 'app' | 'web' | 'windows' | 'electrum';

type Mano = {
  /** La mano o herramienta real que la respalda (lo que la prueba busca en el código). */
  de: string;
  es: string;
  en: string;
  /** Un ejemplo de cómo pedirlo (para el prompt y para «¿qué puedes hacer?»). */
  ejemplo?: { es: string; en: string };
};

/** Las manos que dependen de un servicio aparte: sin él configurado, no se ofrecen. */
function disponible(m: Mano): boolean {
  if (m.de === 'correo') return correoDisponible();
  return m.de !== 'computadora' || computadoraDisponible();
}

/** Las manos de una plataforma que de verdad están hoy. */
export function manosDe(plataforma: PlataformaManos): Mano[] {
  return FICHA[plataforma].filter(disponible);
}

export const FICHA: Record<PlataformaManos, readonly Mano[]> = {
  app: [
    { de: 'llamame', es: 'llamarte cuando quieras, ahora o a la hora que digas', en: 'call you whenever you want, now or at a set time', ejemplo: { es: '«llámame mañana a las seis»', en: '“call me tomorrow at six”' } },
    { de: 'recordatorio', es: 'recordarte cosas a la hora que digas', en: 'remind you of things at any time you say', ejemplo: { es: '«recuérdame a las tres llamar al banco»', en: '“remind me at three to call the bank”' } },
    { de: 'llamar', es: 'llamar o videollamar a tus contactos de PULSE2CHAT', en: 'call or video call your PULSE2CHAT contacts', ejemplo: { es: '«llama a Beto»', en: '“call Beto”' } },
    { de: 'redactar', es: 'escribir y mandar mensajes por ti', en: 'write and send messages for you', ejemplo: { es: '«dile a Beto que ya voy»', en: '“tell Beto I’m on my way”' } },
    { de: 'leer', es: 'leerte tus mensajes', en: 'read your messages to you', ejemplo: { es: '«¿qué me escribió Ana?»', en: '“what did Ana write me?”' } },
    { de: 'buscar', es: 'buscar en tus chats', en: 'search your chats', ejemplo: { es: '«busca la dirección que me mandaron»', en: '“find the address they sent me”' } },
    { de: 'cartera', es: 'decirte cuánto tienes en tu Veta Wallet', en: 'tell you what’s in your Veta Wallet', ejemplo: { es: '«¿cuánto tengo en mi wallet?»', en: '“how much is in my wallet?”' } },
    { de: 'pagar', es: 'dejarte listo un envío de ORIGEN por PULSE2CHAT para que lo firmes en Veta Wallet', en: 'prepare an ORIGEN payment over PULSE2CHAT for you to sign in Veta Wallet', ejemplo: { es: '«mándale 5 ORIGEN a Ana»', en: '“send Ana 5 ORIGEN”' } },
    { de: 'web', es: 'buscar en internet', en: 'search the web' },
    { de: 'vision', es: 'ver por la cámara y decirte qué hay', en: 'see through the camera and tell you what’s there' },
    { de: 'metales', es: 'darte el precio del oro', en: 'give you gold and silver prices' },
    { de: 'fx', es: 'convertir lempiras a dólares', en: 'convert lempiras to dollars' },
    { de: 'pdf', es: 'leer tus PDF o fotos', en: 'read your PDFs or photos' },
    { de: 'perfil', es: 'acordarme de lo que me cuentes de ti', en: 'remember what you tell me about yourself' },
    { de: 'abrir', es: 'abrir pantallas de la app o cambiar el tema', en: 'open app screens or change the theme' },
    { de: 'computadora', es: 'usar mi propia computadora en la nube para hacer cosas en páginas por ti', en: 'use my own cloud computer to do things on websites for you', ejemplo: { es: '«usa tu computadora y compárame precios de vuelos a Miami»', en: '“use your computer and compare flight prices to Miami”' } },
    { de: 'correo', es: 'revisar y contestar tu correo, sea Gmail, Outlook, Yahoo o el de tu empresa', en: 'check and answer your email, whether Gmail, Outlook, Yahoo or your work address', ejemplo: { es: '«revisa mi correo y contéstale a Beto que sí la recibí»', en: '“check my email and tell Beto I got it”' } },
  ],
  web: [
    { de: 'chat', es: 'platicar contigo por voz o por escrito', en: 'talk with you by voice or text' },
    { de: 'web', es: 'buscar en internet', en: 'search the web' },
    { de: 'vision', es: 'ver por la cámara y decirte qué hay', en: 'see through the camera and tell you what’s there' },
    { de: 'pdf', es: 'leer los PDF o fotos que me subas', en: 'read PDFs or photos you upload' },
    { de: 'metales', es: 'darte el precio del oro', en: 'give you gold and silver prices' },
    { de: 'fx', es: 'convertir lempiras a dólares', en: 'convert lempiras to dollars' },
    { de: 'pagina', es: 'leerte páginas web', en: 'read web pages for you' },
    { de: 'computadora', es: 'usar mi propia computadora en la nube para hacer cosas en páginas por ti', en: 'use my own cloud computer to do things on websites for you' },
    { de: 'correo', es: 'revisar y contestar tu correo, sea Gmail, Outlook, Yahoo o el de tu empresa', en: 'check and answer your email, whether Gmail, Outlook, Yahoo or your work address' },
  ],
  windows: [
    { de: 'AbrirApp', es: 'abrir o cerrar programas', en: 'open or close programs', ejemplo: { es: '«abre Excel»', en: '“open Excel”' } },
    { de: 'Ventana', es: 'cambiar, minimizar o cerrar ventanas', en: 'switch, minimize or close windows', ejemplo: { es: '«cambia a Chrome»', en: '“switch to Chrome”' } },
    { de: 'Musica', es: 'ponerte música', en: 'play music', ejemplo: { es: '«pon Bad Bunny en Spotify»', en: '“play Bad Bunny on Spotify”' } },
    { de: 'VolumenSubir', es: 'subir, bajar o silenciar el volumen', en: 'raise, lower or mute the volume' },
    { de: 'Escribir', es: 'escribir por ti donde estés', en: 'type for you wherever you are', ejemplo: { es: '«escribe buenos días equipo»', en: '“type good morning team”' } },
    { de: 'BuscarWeb', es: 'buscar en Google', en: 'search Google' },
    { de: 'AbrirCarpeta', es: 'abrir tus archivos o carpetas', en: 'open your files or folders' },
    { de: 'Captura', es: 'tomar capturas de pantalla', en: 'take screenshots' },
    { de: 'Recordar', es: 'recordarte cosas', en: 'remind you of things', ejemplo: { es: '«recuérdame en diez minutos»', en: '“remind me in ten minutes”' } },
    { de: 'Correo', es: 'revisar tu correo o tu agenda', en: 'check your email or calendar' },
    { de: 'Pulse', es: 'llamar o escribir por PULSE2CHAT', en: 'call or message on PULSE2CHAT' },
    { de: 'Pulsar', es: 'apretar botones o atajos de teclado', en: 'press buttons or keyboard shortcuts', ejemplo: { es: '«presiona control c»', en: '“press control c”' } },
  ],
  electrum: [
    { de: 'catastro_buscar', es: 'buscar concesiones en el catastro minero', en: 'search concessions in the mining cadastre' },
    { de: 'expediente_leer', es: 'revisar expedientes', en: 'review files' },
    { de: 'gis_medir', es: 'medir áreas o ver traslapes en el mapa', en: 'measure areas or find overlaps on the map' },
    { de: 'geologia_zona', es: 'analizar la geología de una zona', en: 'analyze the geology of a zone' },
    { de: 'coordenadas_convertir', es: 'convertir coordenadas entre NAD27 y WGS84', en: 'convert coordinates between NAD27 and WGS84' },
    { de: 'calculo_mina', es: 'hacer cálculos de minería (ley, tonelaje, onzas)', en: 'run mining calculations (grade, tonnage, ounces)' },
    { de: 'metales_spot', es: 'darle el precio de los metales', en: 'give you metal prices' },
    { de: 'informe_pdf', es: 'armarle informes o planos en PDF', en: 'build PDF reports or plans' },
  ],
};

/** Lo que una plataforma NO hace (para que nunca lo ofrezca). */
const NO_AQUI: Record<PlataformaManos, { es: string; en: string }> = {
  app: {
    es: 'no manejas la computadora de la persona (eso es AURA para Windows): la tuya es otra, en la nube, y nunca pagas ni pones contraseñas con ella',
    en: 'you do not control the person’s computer (that is AURA for Windows): yours is a separate one in the cloud, and you never pay or enter passwords with it',
  },
  web: {
    es: 'desde la web no llamas, no mandas mensajes de PULSE2CHAT, no pones recordatorios ni lees chats (eso lo hace la app del teléfono); si te lo piden, dilo y ofrece hacerlo desde la app',
    en: 'from the web you do not call, send PULSE2CHAT messages, set reminders or read chats (the phone app does that); if asked, say so and offer the app',
  },
  windows: { es: 'no mueves la app del teléfono desde aquí', en: 'you do not move the phone app from here' },
  electrum: { es: 'no inventas datos de concesiones: lo que no esté en las herramientas, lo dices', en: 'never invent concession data: if the tools don’t have it, say so' },
};

/** El bloque del prompt: una línea con lo que puede y otra con lo que no (corto: va en el system). */
export function fichaManosPrompt(plataforma: PlataformaManos, idioma: Idioma = 'es'): string {
  const manos = manosDe(plataforma).map((m) => m[idioma]).join('; ');
  const no = NO_AQUI[plataforma][idioma];
  return idioma === 'en'
    ? `YOUR HANDS HERE (offer them with confidence and use them when asked; say it is done only once it really is): ${manos}. ${no[0].toUpperCase()}${no.slice(1)}.`
    : `TUS MANOS AQUÍ (ofrécelas con confianza y úsalas cuando te lo pidan; di que quedó solo cuando de verdad quedó): ${manos}. ${no[0].toUpperCase()}${no.slice(1)}.`;
}

/**
 * «¿Qué puedes hacer?» dicho al instante: cuatro o cinco manos (rotando cuáles, para que no suene
 * grabado), unidas como se dicen, y un ejemplo para pedirlo.
 */
export function quePuedoDecir(plataforma: PlataformaManos, idioma: Idioma = 'es', azar: () => number = Math.random): string {
  const todas = manosDe(plataforma);
  // Barajar (Fisher-Yates) y tomar 4 o 5, conservando el orden de la ficha (de lo más útil a lo menos).
  for (let i = todas.length - 1; i > 0; i--) {
    const j = Math.floor(azar() * (i + 1)) % (i + 1);
    [todas[i], todas[j]] = [todas[j], todas[i]];
  }
  const n = Math.min(todas.length, 4 + (azar() < 0.5 ? 1 : 0));
  const elegidas = todas.slice(0, n).sort((a, b) => FICHA[plataforma].indexOf(a) - FICHA[plataforma].indexOf(b));
  const y = idioma === 'en' ? 'and' : 'y';
  const lista = elegidas.map((m) => m[idioma]);
  const unida = lista.length > 1 ? `${lista.slice(0, -1).join(', ')} ${y} ${lista[lista.length - 1]}` : lista[0];
  return unida;
}

/** Un ejemplo de cómo pedir algo (de las manos que tienen ejemplo), o '' si ninguna. */
export function ejemploDeManos(plataforma: PlataformaManos, idioma: Idioma = 'es', azar: () => number = Math.random): string {
  const con = manosDe(plataforma).filter((m) => m.ejemplo);
  if (!con.length) return '';
  return con[Math.floor(azar() * con.length) % con.length].ejemplo![idioma];
}
