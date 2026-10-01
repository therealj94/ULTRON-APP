/**
 * DÓNDE VIVE EL CORREO DE CADA QUIEN: los servidores IMAP (leer) y SMTP (mandar) de una dirección.
 *
 * José (1-oct): «que pueda revisar correo y contestar… hay correos que no están en Gmail y están en
 * otros lados». No se inventan servidores: primero los proveedores grandes que se conocen de memoria,
 * después la base de Thunderbird (ISPDB, la misma que usa Thunderbird para configurar solo cualquier
 * dominio: autoconfig.thunderbird.net), después la configuración que publica el propio dominio
 * (autoconfig.<dominio>), y si nada de eso, el registro MX del dominio (un correo de empresa en Google
 * Workspace o Microsoft 365 se reconoce por su MX).
 *
 * Cómo se entra:
 *  · `clave`: usuario y contraseña. Gmail, Yahoo e iCloud piden una «contraseña de aplicación» (con
 *    verificación en dos pasos); un hosting propio, la del buzón.
 *  · `microsoft`: Outlook, Hotmail, Live y Microsoft 365 ya no aceptan contraseñas por IMAP/SMTP (Microsoft
 *    apagó la autenticación básica): se entra con OAuth2 (lib/correo/microsoft.ts).
 */
import dns from 'node:dns/promises';
import { pedirPublico } from '../red-publica';

export type Servidor = { host: string; puerto: number; seguro: boolean };
export type Proveedor = {
  nombre: string;
  imap: Servidor;
  smtp: Servidor;
  auth: 'clave' | 'microsoft';
  /** El usuario de entrada: casi siempre la dirección entera. */
  usuario: 'correo' | 'local';
  /** Cómo conseguir la clave, dicho a la persona. */
  ayuda: string;
  /** De dónde salió (para el registro y para decirlo con honestidad). */
  fuente: 'conocido' | 'ispdb' | 'dominio' | 'mx' | 'adivinado';
  /** ¿El servidor guarda solo lo enviado por SMTP en «Enviados»? (Gmail sí; los demás hay que guardarlo.) */
  guardaEnviados: boolean;
};

const GMAIL: Omit<Proveedor, 'fuente'> = {
  nombre: 'Gmail',
  imap: { host: 'imap.gmail.com', puerto: 993, seguro: true },
  smtp: { host: 'smtp.gmail.com', puerto: 465, seguro: true },
  auth: 'clave',
  usuario: 'correo',
  ayuda: 'Gmail pide una contraseña de aplicación: activa la verificación en dos pasos y créala en myaccount.google.com/apppasswords (16 letras). Tu contraseña normal no sirve.',
  guardaEnviados: true,
};
const MICROSOFT: Omit<Proveedor, 'fuente'> = {
  nombre: 'Outlook / Microsoft 365',
  imap: { host: 'outlook.office365.com', puerto: 993, seguro: true },
  smtp: { host: 'smtp.office365.com', puerto: 587, seguro: false },
  auth: 'microsoft',
  usuario: 'correo',
  ayuda: 'Outlook, Hotmail y Microsoft 365 no aceptan contraseñas: entra con tu cuenta de Microsoft (te doy un código para microsoft.com/devicelogin).',
  guardaEnviados: true,
};
const YAHOO: Omit<Proveedor, 'fuente'> = {
  nombre: 'Yahoo',
  imap: { host: 'imap.mail.yahoo.com', puerto: 993, seguro: true },
  smtp: { host: 'smtp.mail.yahoo.com', puerto: 465, seguro: true },
  auth: 'clave',
  usuario: 'correo',
  ayuda: 'Yahoo pide una contraseña de aplicación: Seguridad de la cuenta → Generar contraseña de aplicación.',
  guardaEnviados: false,
};
const ICLOUD: Omit<Proveedor, 'fuente'> = {
  nombre: 'iCloud',
  imap: { host: 'imap.mail.me.com', puerto: 993, seguro: true },
  smtp: { host: 'smtp.mail.me.com', puerto: 587, seguro: false },
  auth: 'clave',
  usuario: 'correo',
  ayuda: 'iCloud pide una contraseña específica de app: appleid.apple.com → Inicio de sesión y seguridad → Contraseñas específicas de apps.',
  guardaEnviados: false,
};
const ZOHO: Omit<Proveedor, 'fuente'> = {
  nombre: 'Zoho Mail',
  imap: { host: 'imap.zoho.com', puerto: 993, seguro: true },
  smtp: { host: 'smtp.zoho.com', puerto: 465, seguro: true },
  auth: 'clave',
  usuario: 'correo',
  ayuda: 'Zoho: activa IMAP en Configuración → Correo → IMAP; si tienes verificación en dos pasos, usa una contraseña de aplicación.',
  guardaEnviados: false,
};

const CONOCIDOS: Record<string, Omit<Proveedor, 'fuente'>> = {
  'gmail.com': GMAIL,
  'googlemail.com': GMAIL,
  'outlook.com': MICROSOFT,
  'hotmail.com': MICROSOFT,
  'hotmail.es': MICROSOFT,
  'live.com': MICROSOFT,
  'msn.com': MICROSOFT,
  'outlook.es': MICROSOFT,
  'yahoo.com': YAHOO,
  'yahoo.es': YAHOO,
  'ymail.com': YAHOO,
  'icloud.com': ICLOUD,
  'me.com': ICLOUD,
  'mac.com': ICLOUD,
  'zoho.com': ZOHO,
  'zohomail.com': ZOHO,
};

/** Por el MX se reconoce un dominio propio alojado en Google o en Microsoft. */
function porMx(mx: string): Omit<Proveedor, 'fuente'> | null {
  const m = mx.toLowerCase();
  if (/(^|\.)google(mail)?\.com\.?$|googlemail|aspmx\.l\.google/.test(m)) return { ...GMAIL, nombre: 'Google Workspace' };
  if (/mail\.protection\.outlook\.com\.?$|outlook\.com\.?$/.test(m)) return { ...MICROSOFT, nombre: 'Microsoft 365' };
  if (/zoho\.(com|eu)\.?$/.test(m)) return ZOHO;
  if (/yahoodns\.net\.?$/.test(m)) return YAHOO;
  return null;
}

export function dominioDe(correo: string): string {
  return String(correo || '').trim().toLowerCase().split('@')[1] || '';
}

export function correoValido(correo: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(String(correo || '').trim());
}

/** Lee un config-v1.1.xml de Thunderbird (ISPDB o el del dominio): el primer IMAP y el primer SMTP. */
export function leerAutoconfig(xml: string): { imap: Servidor; smtp: Servidor; usuario: 'correo' | 'local'; nombre: string } | null {
  const bloque = (tipo: 'incomingServer' | 'outgoingServer', proto: string) => {
    const re = new RegExp(`<${tipo}\\s+type="${proto}"[^>]*>([\\s\\S]*?)</${tipo}>`, 'gi');
    const todos = [...xml.matchAll(re)].map((m) => m[1]);
    // Primero el que va cifrado de entrada (SSL), después STARTTLS; nunca uno sin cifrar.
    const dato = (b: string, t: string) => (b.match(new RegExp(`<${t}>([^<]*)</${t}>`, 'i'))?.[1] || '').trim();
    const ordenados = todos
      .map((b) => ({ host: dato(b, 'hostname'), puerto: Number(dato(b, 'port')), socket: dato(b, 'socketType').toUpperCase(), usuario: dato(b, 'username') }))
      .filter((s) => s.host && s.puerto && (s.socket === 'SSL' || s.socket === 'STARTTLS'))
      .sort((a, b) => (a.socket === 'SSL' ? 0 : 1) - (b.socket === 'SSL' ? 0 : 1));
    return ordenados[0] || null;
  };
  const i = bloque('incomingServer', 'imap');
  const o = bloque('outgoingServer', 'smtp');
  if (!i || !o) return null;
  const nombre = (xml.match(/<displayName>([^<]*)<\/displayName>/i)?.[1] || '').trim();
  return {
    imap: { host: i.host, puerto: i.puerto, seguro: i.socket === 'SSL' },
    smtp: { host: o.host, puerto: o.puerto, seguro: o.socket === 'SSL' },
    usuario: /%EMAILLOCALPART%/.test(i.usuario) ? 'local' : 'correo',
    nombre,
  };
}

type Dependencias = {
  traer?: (url: string) => Promise<string | null>;
  mx?: (dominio: string) => Promise<string[]>;
};

/** El dominio lo escribe la persona: autoconfig.<dominio> se pide por la red pública, nunca a la interna. */
async function traerTexto(url: string): Promise<string | null> {
  try {
    const r = await pedirPublico(url, { ms: 6000, maxBytes: 200_000 });
    return r.status >= 200 && r.status < 300 ? r.texto : null;
  } catch {
    return null;
  }
}

async function mxDe(dominio: string): Promise<string[]> {
  try {
    const r = await dns.resolveMx(dominio);
    return r.sort((a, b) => a.priority - b.priority).map((m) => m.exchange);
  } catch {
    return [];
  }
}

const ayudaClave = (nombre: string) =>
  `Usa la contraseña de tu correo de ${nombre}. Si tiene verificación en dos pasos, crea una contraseña de aplicación en su configuración.`;

/** Los servidores de una dirección. Nunca lanza: si no hay nada seguro, propone mail.<dominio> y lo dice. */
export async function detectarProveedor(correo: string, dep: Dependencias = {}): Promise<Proveedor | null> {
  if (!correoValido(correo)) return null;
  const dominio = dominioDe(correo);
  const traer = dep.traer ?? traerTexto;
  const mx = dep.mx ?? mxDe;
  const conocido = CONOCIDOS[dominio];
  if (conocido) return { ...conocido, fuente: 'conocido' };

  const desdeXml = (xml: string | null, fuente: 'ispdb' | 'dominio'): Proveedor | null => {
    const c = xml ? leerAutoconfig(xml) : null;
    if (!c) return null;
    // Un dominio de Office 365 en la ISPDB sigue necesitando OAuth.
    const ms = /office365\.com$|outlook\.com$/i.test(c.imap.host);
    return {
      nombre: c.nombre || dominio,
      imap: c.imap,
      smtp: c.smtp,
      auth: ms ? 'microsoft' : 'clave',
      usuario: c.usuario,
      ayuda: ms ? MICROSOFT.ayuda : ayudaClave(c.nombre || dominio),
      fuente,
      guardaEnviados: /gmail\.com$/i.test(c.imap.host),
    };
  };

  const ispdb = desdeXml(await traer(`https://autoconfig.thunderbird.net/v1.1/${encodeURIComponent(dominio)}`), 'ispdb');
  if (ispdb) return ispdb;
  const propio = desdeXml(await traer(`https://autoconfig.${dominio}/mail/config-v1.1.xml?emailaddress=${encodeURIComponent(correo)}`), 'dominio');
  if (propio) return propio;

  const mxs = await mx(dominio);
  for (const m of mxs) {
    const p = porMx(m);
    if (p) return { ...p, fuente: 'mx' };
    // La ISPDB también conoce proveedores por el dominio de su MX (hostings grandes).
    const base = m.replace(/\.$/, '').split('.').slice(-2).join('.');
    const deMx = desdeXml(await traer(`https://autoconfig.thunderbird.net/v1.1/${encodeURIComponent(base)}`), 'ispdb');
    if (deMx) return { ...deMx, fuente: 'mx' };
  }
  // Lo de casi todo hosting (cPanel, Plesk): mail.<dominio> con SSL. Se prueba al conectar.
  return {
    nombre: dominio,
    imap: { host: `mail.${dominio}`, puerto: 993, seguro: true },
    smtp: { host: `mail.${dominio}`, puerto: 465, seguro: true },
    auth: 'clave',
    usuario: 'correo',
    ayuda: `${ayudaClave(dominio)} Si no conecta, pídele a quien administra tu dominio el servidor IMAP y SMTP.`,
    fuente: 'adivinado',
    guardaEnviados: false,
  };
}
