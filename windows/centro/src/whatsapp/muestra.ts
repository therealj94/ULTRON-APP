/**
 * WhatsApp en MODO MUESTRA (la página fuera de WebView2: el navegador, las fotos del diseño, las pruebas).
 * Datos inventados para ver y fotografiar el panel sin el .exe ni el WhatsApp de nadie: contestan como los
 * métodos `whatsapp.*` del puente (PUENTE.md).
 *
 *   · Empieza SIN vincular: el QR cambia cada vez que se pregunta; tras unas preguntas (~10 s) «lo escaneaste»
 *     y queda vinculado. Con `?wa=vinculado` en la dirección empieza ya vinculado.
 *   · «Vincular con número» devuelve un código de 8 letras.
 *   · Enviar un texto que diga «fallar» falla (para ver el error); lo demás se agrega a la conversación.
 */
import type { ChatWA, EstadoWA, MensajeWA } from './formato';

const MIN = 60_000;
const HORA = 60 * MIN;
const DIA = 24 * HORA;

const KARLA = '50499887766@s.whatsapp.net';
const JUNTA = '120363041122334455@g.us';
const MAMA = '50433445566@s.whatsapp.net';
const BETO = '50488776655@s.whatsapp.net';
const FAMILIA = '120363099887766554@g.us';
const DESCONOCIDO = '50498765432@s.whatsapp.net';
const SOPORTE = '50422334455@s.whatsapp.net';

let vinculado = typeof location !== 'undefined' && /[?&]wa=vinculado\b/.test(location.search || '');
let vinculando = false;
let preguntas = 0;
let qrSerie = 0;
let codigo = '';
let serie = 0;
let chats: ChatWA[] = [];
const mensajes = new Map<string, MensajeWA[]>();

function sembrar() {
  const t = Date.now();
  chats = [
    { jid: KARLA, nombre: 'Karla 💛', grupo: false, noLeidos: 2, hora: t - 4 * MIN, ultimo: '¿Ya saliste de la junta?', ultimoMio: false },
    { jid: JUNTA, nombre: 'Junta Orden Global', grupo: true, noLeidos: 5, hora: t - 35 * MIN, ultimo: 'Mañana a las 9 en la oficina de Tegucigalpa', ultimoMio: false, ultimoDe: 'Mario Zelaya' },
    { jid: MAMA, nombre: 'Mamá', grupo: false, noLeidos: 0, hora: t - 2 * HORA, ultimo: 'Sí mami, ya comí 🙏', ultimoMio: true },
    { jid: BETO, nombre: 'Beto · Maple Minerals', grupo: false, noLeidos: 0, hora: t - DIA - 3 * HORA, ultimo: '📄 Contrato-concesion-v3.pdf', ultimoMio: false },
    { jid: FAMILIA, nombre: 'Familia Ordóñez', grupo: true, noLeidos: 12, hora: t - 2 * DIA, ultimo: '🎤 Nota de voz (0:42)', ultimoMio: false, ultimoDe: 'Tía Rosa' },
    { jid: DESCONOCIDO, nombre: '+504 9876-5432', grupo: false, noLeidos: 1, hora: t - 5 * DIA, ultimo: 'Buenas, ¿hablo con el ingeniero José?', ultimoMio: false },
    { jid: SOPORTE, nombre: 'Dr Electrum · soporte', grupo: false, noLeidos: 0, hora: t - 20 * DIA, ultimo: 'Listo, ya quedó actualizado el catastro.', ultimoMio: true },
  ];
  const m = (chat: string, id: string, hace: number, x: Partial<MensajeWA>): MensajeWA => ({
    id, chat, de: x.mio ? '' : chat, nombreDe: '', mio: false, hora: t - hace, tipo: 'texto', texto: '', ...x,
  });
  mensajes.set(KARLA, [
    m(KARLA, 'k1', DIA + 2 * HORA, { texto: 'Buenos días amor ☀️ ¿cómo amaneciste?' }),
    m(KARLA, 'k2', DIA + 2 * HORA - 3 * MIN, { mio: true, texto: 'Bien gracias a Dios. Hoy tengo junta a las 10.' }),
    m(KARLA, 'k3', DIA + HORA, { tipo: 'imagen', texto: 'Mira cómo quedó la sala 😍', miniatura: miniatura('sala'), conMedia: true }),
    m(KARLA, 'k4', DIA + HORA - 2 * MIN, { mio: true, texto: '¡Quedó preciosa!', editado: true }),
    m(KARLA, 'k5', 3 * HORA, { tipo: 'audio', duracion: 12, conMedia: true }),
    m(KARLA, 'k6', 3 * HORA - MIN, { eliminado: true }),
    m(KARLA, 'k7', 2 * HORA, { mio: true, tipo: 'documento', archivo: 'Presupuesto-octubre.xlsx', texto: '', conMedia: true }),
    m(KARLA, 'k8', 6 * MIN, { texto: 'Pasé por la farmacia, ya tengo lo de tu mamá' }),
    m(KARLA, 'k9', 4 * MIN, { texto: '¿Ya saliste de la junta?' }),
  ]);
  mensajes.set(JUNTA, [
    m(JUNTA, 'j1', 3 * HORA, { de: '50495550001@s.whatsapp.net', nombreDe: 'Mario Zelaya', texto: 'Compañeros, el acta de ayer ya está en la carpeta.' }),
    m(JUNTA, 'j2', 3 * HORA - MIN, { de: '50495550001@s.whatsapp.net', nombreDe: 'Mario Zelaya', texto: 'Revísenla antes de mañana por favor 🙏' }),
    m(JUNTA, 'j3', 2 * HORA, { de: '50495550002@s.whatsapp.net', nombreDe: 'Lic. Andrea Paz', tipo: 'documento', archivo: 'Acta-junta-01-oct.pdf', conMedia: true }),
    m(JUNTA, 'j4', HORA, { mio: true, texto: 'Recibido. Mañana la firmamos.' }),
    m(JUNTA, 'j5', 35 * MIN, { de: '50495550001@s.whatsapp.net', nombreDe: 'Mario Zelaya', texto: 'Mañana a las 9 en la oficina de Tegucigalpa' }),
  ]);
  mensajes.set(MAMA, [
    m(MAMA, 'm1', 3 * HORA, { texto: '¿Ya comiste mijo?' }),
    m(MAMA, 'm2', 2 * HORA, { mio: true, texto: 'Sí mami, ya comí 🙏' }),
  ]);
  mensajes.set(FAMILIA, [
    m(FAMILIA, 'f1', 2 * DIA + 10 * MIN, { de: '50495550003@s.whatsapp.net', nombreDe: 'Tía Rosa', tipo: 'ubicacion', texto: 'Casa de la abuela, Comayagüela' }),
    m(FAMILIA, 'f2', 2 * DIA, { de: '50495550003@s.whatsapp.net', nombreDe: 'Tía Rosa', tipo: 'audio', duracion: 42, conMedia: true }),
  ]);
}
sembrar();

/** Una foto inventada (degradado con un sol) como JPEG base64; sin lienzo (Node, pruebas), nada. */
function miniatura(semilla: string, ancho = 96, alto = 72): string | undefined {
  try {
    if (typeof document === 'undefined') return undefined;
    const c = document.createElement('canvas');
    c.width = ancho;
    c.height = alto;
    const g = c.getContext('2d');
    if (!g) return undefined;
    const fondo = g.createLinearGradient(0, 0, ancho, alto);
    fondo.addColorStop(0, semilla === 'sala' ? '#c79a62' : '#3a6ea5');
    fondo.addColorStop(1, '#2b2118');
    g.fillStyle = fondo;
    g.fillRect(0, 0, ancho, alto);
    g.fillStyle = '#f6e7c8';
    g.beginPath();
    g.arc(ancho * 0.72, alto * 0.32, alto * 0.14, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#5b3d25';
    g.fillRect(ancho * 0.1, alto * 0.62, ancho * 0.55, alto * 0.22);
    return c.toDataURL('image/jpeg', 0.8).split(',')[1];
  } catch {
    return undefined;
  }
}

/** Unos segundos de silencio en WAV (8 kHz, 8 bits) en base64: la «nota de voz» de la muestra. */
function silencio(segundos: number): string {
  const n = Math.round(8000 * segundos);
  const b = new Uint8Array(44 + n);
  const v = new DataView(b.buffer);
  const txt = (o: number, t: string) => [...t].forEach((c, i) => (b[o + i] = c.charCodeAt(0)));
  txt(0, 'RIFF'); v.setUint32(4, 36 + n, true); txt(8, 'WAVE'); txt(12, 'fmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, 8000, true);
  v.setUint32(28, 8000, true); v.setUint16(32, 1, true); v.setUint16(34, 8, true); txt(36, 'data'); v.setUint32(40, n, true);
  b.fill(128, 44);
  let s = '';
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return btoa(s);
}

/** Un QR de mentira (SVG): las tres esquinas y un relleno que cambia en cada serie. */
function qrMuestra(n: number): string {
  const N = 29;
  let s = (n + 1) * 2654435761;
  const azar = () => ((s = (s * 1103515245 + 12345) >>> 0) >>> 16) & 1;
  const celdas: string[] = [];
  const esquina = (x: number, y: number) => x < 8 && y < 8;
  for (let y = 0; y < N; y++)
    for (let x = 0; x < N; x++) {
      const enEsquina = esquina(x, y) || esquina(N - 1 - x, y) || esquina(x, N - 1 - y);
      if (enEsquina) continue;
      if (azar()) celdas.push(`M${x} ${y}h1v1h-1z`);
    }
  const ojo = (x: number, y: number) => `M${x} ${y}h7v7h-7zM${x + 1} ${y + 1}v5h5v-5zM${x + 2} ${y + 2}h3v3h-3z`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-2 -2 ${N + 4} ${N + 4}" shape-rendering="crispEdges"><rect x="-2" y="-2" width="${N + 4}" height="${N + 4}" fill="#fff"/><path fill-rule="evenodd" fill="#111" d="${ojo(0, 0)}${ojo(N - 7, 0)}${ojo(0, N - 7)}${celdas.join('')}"/></svg>`;
  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
}

function estado(): EstadoWA {
  if (vinculado) return { disponible: true, permitido: true, vinculado: true, conectado: true, numero: '50499990000', nombre: 'José' };
  if (vinculando) {
    preguntas++;
    // «Lo escaneaste»: después de unas preguntas queda vinculado (como cuando el teléfono lee el QR).
    if (preguntas >= 4) {
      vinculado = true;
      vinculando = false;
      return estado();
    }
    return codigo
      ? { disponible: true, permitido: true, vinculado: false, vinculando: true, codigo }
      : { disponible: true, permitido: true, vinculado: false, vinculando: true, qr: qrMuestra(++qrSerie) };
  }
  return { disponible: true, permitido: true, vinculado: false };
}

const copia = <T>(x: T): T => JSON.parse(JSON.stringify(x));

/** Lo que contestaría AURA a `whatsapp.*` (o lanza el error con su texto, como el puente). */
export async function muestraWhatsApp(metodo: string, args: any): Promise<unknown> {
  switch (metodo) {
    case 'whatsapp.estado':
      return estado();
    case 'whatsapp.vincular': {
      vinculando = true;
      preguntas = 0;
      const tel = String(args?.telefono || '').replace(/\D/g, '');
      if (tel) {
        codigo = 'AURA' + String(4000 + (serie++ % 5000)).slice(-4).replace(/\d/g, (d) => 'KLMNPQRSTV'[Number(d)]);
        return { codigo };
      }
      codigo = '';
      return { qr: qrMuestra(++qrSerie) };
    }
    case 'whatsapp.desvincular':
      vinculado = false;
      vinculando = false;
      codigo = '';
      sembrar();
      return { ok: true };
    case 'whatsapp.chats': {
      if (!vinculado) throw new Error('WhatsApp no está vinculado.');
      const q = String(args?.buscar || '').toLowerCase();
      return { chats: copia(chats.filter((c) => !q || c.nombre.toLowerCase().includes(q))) };
    }
    case 'whatsapp.mensajes': {
      const chat = String(args?.chat || '');
      if (!chat) throw new Error('Falta el chat.');
      const antes = Number(args?.antes) || 0;
      const todos = mensajes.get(chat) || [];
      return { chat, mensajes: copia(antes ? todos.filter((m) => m.hora < antes) : todos) };
    }
    case 'whatsapp.enviar': {
      const chat = String(args?.chat || '');
      const texto = String(args?.texto || '');
      if (!chat || !texto.trim()) throw new Error('Falta el chat o el texto.');
      if (texto.length > 4000) throw new Error('El mensaje es muy largo (máximo 4000 letras).');
      await new Promise((r) => setTimeout(r, 500));
      if (/fallar/i.test(texto)) throw new Error('El puente de WhatsApp no contestó (muestra).');
      const m: MensajeWA = { id: 'demo-' + ++serie, chat, de: '', nombreDe: '', mio: true, hora: Date.now(), tipo: 'texto', texto };
      mensajes.set(chat, [...(mensajes.get(chat) || []), m]);
      const c = chats.find((x) => x.jid === chat);
      if (c) Object.assign(c, { hora: m.hora, ultimo: texto, ultimoMio: true });
      return { mensaje: copia(m) };
    }
    case 'whatsapp.leido': {
      const c = chats.find((x) => x.jid === String(args?.chat || ''));
      if (c) c.noLeidos = 0;
      return { ok: true };
    }
    case 'whatsapp.media': {
      const m = (mensajes.get(String(args?.chat || '')) || []).find((x) => x.id === String(args?.id || ''));
      if (!m) throw new Error('Ese mensaje no existe.');
      if (m.tipo === 'audio') return { base64: silencio(Math.min(3, m.duracion || 1)), mime: 'audio/wav' };
      if (m.tipo === 'documento') return { base64: btoa('Documento de muestra: ' + (m.archivo || '')), mime: 'text/plain' };
      const base64 = miniatura('sala', 960, 720);
      if (!base64) throw new Error('No se pudo abrir el archivo.');
      return { base64, mime: 'image/jpeg' };
    }
    default:
      return null;
  }
}

/** Solo pruebas: vuelve al principio (sin vincular). */
export function _reiniciarMuestra(conVinculo = false) {
  vinculado = conVinculo;
  vinculando = false;
  preguntas = 0;
  codigo = '';
  sembrar();
}
