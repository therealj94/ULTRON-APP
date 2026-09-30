/**
 * LAS MANOS DE AURA: lo que puede HACER en la app además de navegar y escribir borradores.
 *
 *   «llama a mi mamá», «videollamada con Beto»   → llamar       (SIEMPRE con su «sí» antes de marcar)
 *   «¿qué me dijo Beto?», «léeme mis mensajes»    → leer         (lo lee el teléfono, con la voz de AURA)
 *   «busca en mis chats la dirección»             → buscar       (el teléfono busca; solo dice en qué chat)
 *   «háblame en inglés»                           → idioma
 *   «dime Chepe», «vivo en San Pedro Sula»        → perfil       (un dato de «lo que sabe de mí»)
 *   «recuérdame a las 5 llamar a mi mamá»         → recordatorio (aviso local; SIEMPRE con su «sí»)
 *   «ponte en pantalla completa / a un lado»      → presentacion
 *
 * Aquí vive lo puro de esas manos: la forma de cada acción y su validación, las horas de Honduras de
 * los recordatorios, las órdenes cortas que se reconocen sin modelo (el camino rápido), lo que se dice
 * y las líneas del prompt. El canal, el contexto y las propuestas que esperan el «sí» siguen en
 * lib/acciones-app.ts, que importa esto (este archivo solo toma TIPOS de allá: no hay ciclo).
 *
 * Compatibilidad: una mano solo se usa si el teléfono dijo que la sabe hacer (`manos` en el contexto).
 * Un APK viejo no manda esa lista: el cerebro no las ve en el prompt, las reglas no las reconocen y
 * lo que el modelo escriba de más se descarta. Y si aun así le llegara una, su puente la ignora.
 *
 * Privacidad de leer y buscar: el servidor NO tiene los mensajes (van cifrados de punta a punta). El
 * cerebro nunca los ve: solo manda la orden. El teléfono los abre, arma el texto y lo dice con la voz
 * de AURA; para eso ese texto pasa por ElevenLabs y por aquí de paso (como la voz de cualquier frase),
 * sin guardarse en el hilo, la memoria ni la caché de audio (ver `lecturaDe` en acciones-app.ts).
 * Buscar ni eso: solo dice los nombres de los chats donde encontró la palabra.
 */
import type { ContextoApp, Contacto, Resolucion } from './acciones-app';

/* ------------------------------------------------------------------ las formas */

export const MANOS = ['llamar', 'leer', 'buscar', 'idioma', 'perfil', 'recordatorio', 'presentacion'] as const;
export type Mano = (typeof MANOS)[number];

export const CAMPOS_PERFIL = ['apodo', 'cumple', 'vive', 'trabajo', 'familia', 'gustos', 'comida', 'musica', 'otros'] as const;
export type CampoPerfil = (typeof CAMPOS_PERFIL)[number];
export type Presentacion = 'completa' | 'lado';
export type IdiomaApp = 'es' | 'en';

export type AccionMano =
  /** Llama (o videollama) a un contacto. Solo sale del servidor tras el «sí» de la persona. */
  | { tipo: 'llamar'; con: string; video: boolean }
  /** Lee lo último de `de` (o lo no leído de todos). `boleto` lo pone el servidor, nunca el modelo. */
  | { tipo: 'leer'; de?: string; boleto?: string }
  /** Busca palabras en los chats. `boleto` lo pone el servidor. */
  | { tipo: 'buscar'; q: string; boleto?: string }
  | { tipo: 'idioma'; valor: IdiomaApp }
  /** Un dato del perfil (apodo, cumple MM-DD o un campo de la encuesta). */
  | { tipo: 'perfil'; campo: CampoPerfil; valor: string }
  /** Aviso local a esa hora (epoch ms). Solo sale del servidor tras el «sí» de la persona. */
  | { tipo: 'recordatorio'; texto: string; cuando: number }
  | { tipo: 'presentacion'; valor: Presentacion };

/** Lo que espera el «sí» del turno siguiente (el borrador de un mensaje va aparte, en acciones-app). */
export type Propuesta = { tipo: 'llamar'; con: string; nombre: string; video: boolean } | { tipo: 'recordatorio'; texto: string; cuando: number };

export const MAX_APODO = 40;
export const MAX_CAMPO = 300;
export const MAX_RECORDATORIO = 140;
export const MAX_BUSQUEDA = 80;
/** Un recordatorio vale desde dentro de un minuto hasta dentro de un año. */
export const RECORDATORIO_MIN_MS = 60_000;
export const RECORDATORIO_MAX_MS = 366 * 24 * 3600_000;

const linea = (v: unknown, max: number) =>
  String(v ?? '')
    .replace(/[\u0000-\u001f\u007f\u2028\u2029]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max)
    .trim();
/** Lo que se guarda y vuelve al prompt no puede traer la marca de acción (la misma regla que neutralizarMarca). */
const sinMarca = (s: string) => s.replace(/ACCI[OÓ]N_APP/gi, (m) => m.replace('_', '-'));

const DIAS_DEL_MES = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
/** «MM-DD» de verdad (la misma regla que lib/perfil-persona.ts). */
export function cumpleValido(v: unknown): string | null {
  const m = /^(?:\d{4}-)?(\d{2})-(\d{2})$/.exec(String(v ?? '').trim());
  if (!m) return null;
  const mes = Number(m[1]);
  const dia = Number(m[2]);
  if (mes < 1 || mes > 12 || dia < 1 || dia > DIAS_DEL_MES[mes - 1]) return null;
  return `${m[1]}-${m[2]}`;
}

/**
 * Una mano con su forma estricta, o null si es una mano mal escrita, o undefined si el tipo no es de
 * las manos (lo decide el resto de validarAccion). El `boleto` de leer/buscar NUNCA se acepta de
 * afuera: lo pone empujarAccion.
 */
export function validarMano(a: Record<string, unknown>, ahora = Date.now()): AccionMano | null | undefined {
  switch (a.tipo) {
    case 'llamar': {
      const con = linea(a.con, 254);
      return con ? { tipo: 'llamar', con, video: a.video === true } : null;
    }
    case 'leer': {
      const de = linea(a.de, 254);
      return de ? { tipo: 'leer', de } : { tipo: 'leer' };
    }
    case 'buscar': {
      const q = sinMarca(linea(a.q, MAX_BUSQUEDA));
      return q.length >= 2 ? { tipo: 'buscar', q } : null;
    }
    case 'idioma':
      return a.valor === 'es' || a.valor === 'en' ? { tipo: 'idioma', valor: a.valor } : null;
    case 'presentacion':
      return a.valor === 'completa' || a.valor === 'lado' ? { tipo: 'presentacion', valor: a.valor } : null;
    case 'perfil': {
      const campo = a.campo as CampoPerfil;
      if (!CAMPOS_PERFIL.includes(campo)) return null;
      if (campo === 'cumple') {
        const c = cumpleValido(a.valor);
        return c ? { tipo: 'perfil', campo, valor: c } : null;
      }
      const valor = sinMarca(linea(a.valor, campo === 'apodo' ? MAX_APODO : MAX_CAMPO));
      return valor ? { tipo: 'perfil', campo, valor } : null;
    }
    case 'recordatorio': {
      const texto = sinMarca(linea(a.texto, MAX_RECORDATORIO));
      const cuando = cuandoValido(a.cuando, ahora);
      return texto && cuando ? { tipo: 'recordatorio', texto, cuando } : null;
    }
    default:
      return undefined;
  }
}

/** ¿El teléfono sabe hacer esta mano? (lo dijo en su contexto). Las acciones de siempre no pasan por aquí. */
export function puedeMano(ctx: ContextoApp | null | undefined, tipo: string): boolean {
  return !!ctx?.manos?.includes(tipo as Mano);
}

export function esMano(tipo: string): tipo is Mano {
  return (MANOS as readonly string[]).includes(tipo);
}

/** La lista `manos` que manda el teléfono, limpia: solo nombres conocidos, sin repetir. */
export function validarManos(v: unknown): Mano[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const out: Mano[] = [];
  for (const x of v) if (typeof x === 'string' && esMano(x) && !out.includes(x)) out.push(x);
  return out;
}

/* ------------------------------------------------------------------ las horas de Honduras */

/** Honduras está en UTC-6 todo el año (no cambia la hora en verano). */
const HN_MS = 6 * 3600_000;

type PartesHN = { anio: number; mes: number; dia: number; hora: number; min: number; semana: number };

export function partesHN(ms: number): PartesHN {
  const d = new Date(ms - HN_MS);
  return { anio: d.getUTCFullYear(), mes: d.getUTCMonth() + 1, dia: d.getUTCDate(), hora: d.getUTCHours(), min: d.getUTCMinutes(), semana: d.getUTCDay() };
}

/** La hora de Honduras (año, mes, día, hora, minuto) en epoch ms. Admite días fuera de rango (se corren). */
export function msDeHN(anio: number, mes: number, dia: number, hora: number, min: number): number {
  return Date.UTC(anio, mes - 1, dia, hora, min) + HN_MS;
}

/**
 * Cuándo, en epoch ms, o null si no vale. Acepta un número (epoch ms) o «AAAA-MM-DDTHH:MM» en hora de
 * Honduras (lo que escribe el cerebro), o con zona explícita (…Z, …-06:00). Tiene que ser entre dentro
 * de un minuto y dentro de un año: «recuérdame ayer» no es un recordatorio.
 */
export function cuandoValido(v: unknown, ahora = Date.now()): number | null {
  let t: number;
  if (typeof v === 'number') t = v;
  else {
    const s = String(v ?? '').trim();
    const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?$/.exec(s);
    if (m) {
      const [anio, mes, dia, hora, min] = m.slice(1, 6).map(Number);
      t = msDeHN(anio, mes, dia, hora, min);
      // El 31 de septiembre no existe: al volver a partes tiene que dar lo mismo.
      const p = partesHN(t);
      if (p.anio !== anio || p.mes !== mes || p.dia !== dia || p.hora !== hora || p.min !== min) return null;
    } else if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/.test(s)) t = Date.parse(s);
    else return null;
  }
  if (!Number.isFinite(t)) return null;
  t = Math.round(t);
  return t >= ahora + RECORDATORIO_MIN_MS && t <= ahora + RECORDATORIO_MAX_MS ? t : null;
}

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** «5:00 de la tarde», «12:30 del mediodía» / «5:00 PM». */
function reloj(p: PartesHN, idioma: IdiomaApp): string {
  const mm = String(p.min).padStart(2, '0');
  if (idioma === 'en') return `${p.hora % 12 || 12}:${mm} ${p.hora < 12 ? 'AM' : 'PM'}`;
  const h12 = p.hora % 12 || 12;
  const tramo = p.hora === 0 ? 'de la noche' : p.hora < 6 ? 'de la madrugada' : p.hora < 12 ? 'de la mañana' : p.hora === 12 ? 'del mediodía' : p.hora < 19 ? 'de la tarde' : 'de la noche';
  return `${h12}:${mm} ${tramo}`;
}

/** «hoy a las 5:00 de la tarde», «mañana a las 7:30 de la mañana», «el viernes 3 de octubre a las…». */
export function horaLegible(ms: number, ahora = Date.now(), idioma: IdiomaApp = 'es'): string {
  const p = partesHN(ms);
  const h = partesHN(ahora);
  const dias = Math.round((msDeHN(p.anio, p.mes, p.dia, 0, 0) - msDeHN(h.anio, h.mes, h.dia, 0, 0)) / 86_400_000);
  const r = reloj(p, idioma);
  if (idioma === 'en') {
    if (dias === 0) return `today at ${r}`;
    if (dias === 1) return `tomorrow at ${r}`;
    return `${DAYS[p.semana]}, ${MONTHS[p.mes - 1]} ${p.dia}${p.anio !== h.anio ? `, ${p.anio}` : ''} at ${r}`;
  }
  const alas = p.hora % 12 === 1 ? 'a la' : 'a las';
  if (dias === 0) return `hoy ${alas} ${r}`;
  if (dias === 1) return `mañana ${alas} ${r}`;
  return `el ${DIAS[p.semana]} ${p.dia} de ${MESES[p.mes - 1]}${p.anio !== h.anio ? ` de ${p.anio}` : ''} ${alas} ${r}`;
}

/** Para el prompt: «martes 30 de septiembre de 2026, 2:32 de la tarde (2026-09-30T14:32)». */
export function ahoraEnHonduras(ahora = Date.now()): string {
  const p = partesHN(ahora);
  const iso = `${p.anio}-${String(p.mes).padStart(2, '0')}-${String(p.dia).padStart(2, '0')}T${String(p.hora).padStart(2, '0')}:${String(p.min).padStart(2, '0')}`;
  return `${DIAS[p.semana]} ${p.dia} de ${MESES[p.mes - 1]} de ${p.anio}, ${reloj(p, 'es')} (${iso})`;
}

const NUMEROS: Record<string, number> = {
  un: 1, una: 1, uno: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10, once: 11, doce: 12,
  quince: 15, veinte: 20, treinta: 30, cuarenta: 40, cincuenta: 50, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7,
  eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, fifteen: 15, twenty: 20, thirty: 30, an: 1, a: 1,
};
const numero = (s: string | undefined): number | null => {
  if (!s) return null;
  if (/^\d+$/.test(s)) return Number(s);
  return NUMEROS[s] ?? null;
};

/**
 * «a las 5», «a las cinco y media de la tarde», «mañana a las 7», «5 pm» → epoch ms. Sin «de la
 * tarde / pm», la más próxima que todavía no pasó (a las 2 de la tarde, «a las 5» son las 5 de la
 * tarde); con «mañana», de 1 a 6 se entiende tarde («mañana a las 3» son las 3 de la tarde). Como la
 * persona oye la hora exacta antes de decir «sí», un error se corrige ahí.
 */
export function horaDeFrase(o: { h: string; m?: string; tramo?: string; dia?: string }, ahora = Date.now()): number | null {
  let h = numero(o.h);
  if (h === null || h < 0 || h > 23) return null;
  let min = 0;
  if (o.m === 'media') min = 30;
  else if (o.m === 'cuarto') min = 15;
  else if (o.m) {
    const n = numero(o.m);
    if (n === null || n > 59) return null;
    min = n;
  }
  const tramo = String(o.tramo || '').replace(/\s+/g, ' ');
  const tarde = /tarde|noche|pm|p m/.test(tramo);
  const manana = /manana|madrugada|am|a m/.test(tramo);
  if (tarde && h < 12) h += 12;
  // «las 12 de la noche» es la medianoche; «las 12 de la madrugada», también.
  if ((/noche/.test(tramo) || manana) && h === 12) h = 0;
  if (/mediodia/.test(tramo)) h = 12;
  const p = partesHN(ahora);
  const desfase = o.dia === 'pasado manana' ? 2 : o.dia === 'manana' || o.dia === 'tomorrow' ? 1 : 0;
  const a = (hora: number, dias: number) => msDeHN(p.anio, p.mes, p.dia + dias, hora, min);
  const ambigua = !tarde && !manana && !/mediodia/.test(tramo) && h >= 1 && h <= 11;
  if (desfase) {
    if (ambigua && h <= 6) h += 12;
    return a(h, desfase);
  }
  const candidatos = ambigua ? [a(h, 0), a(h + 12, 0), a(h, 1)] : [a(h, 0), a(h, 1)];
  return candidatos.find((t) => t >= ahora + RECORDATORIO_MIN_MS) ?? null;
}

/** «en 20 minutos», «en media hora», «en dos horas» → epoch ms. */
export function dentroDe(n: string, unidad: string, ahora = Date.now()): number | null {
  const horas = /hora|hour/.test(unidad);
  if (n === 'media' && horas) return ahora + 30 * 60_000;
  const v = numero(n);
  if (v === null || v <= 0) return null;
  return ahora + v * (horas ? 3600_000 : 60_000);
}

/* ------------------------------------------------------------------ las órdenes cortas (sin modelo) */

const plegar = (s: string) =>
  String(s || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();

/**
 * Las palabras de lo que dijo la persona, dos veces y alineadas: `q` plegadas (sin acentos ni signos,
 * para reconocer la orden) y `orig` como las dijo (para lo que se guarda o se lee: «San Pedro Sula»,
 * «Llamar a mi mamá»). Sin el «AURA,» del principio ni el «por favor» del final.
 */
export function palabras(texto: string): { q: string; orig: string[] } {
  const orig: string[] = [];
  const q: string[] = [];
  for (const crudo of String(texto || '').split(/\s+/)) {
    // «5:30» y «p.m.» se parten como los parte el oído: «5 30», «p m».
    for (const pedazo of crudo.split(/[:]/)) {
      const o = pedazo.replace(/^[^\p{L}\p{N}@]+|[^\p{L}\p{N}@]+$/gu, '');
      const p = plegar(o).replace(/[^a-z0-9ñ@._-]+/g, '').replace(/\.+$/, '');
      if (!p) continue;
      orig.push(o);
      // «p.m.» y «a.m.» se escriben de mil maneras: quedan «pm» y «am».
      q.push(/^[ap]\.m$/.test(p) ? p[0] + 'm' : p);
    }
  }
  const vocativo = /^(oye|hey|ey|aura|au-ra|claudio|guardian|porfa|please|ok|okay|mira)$/;
  for (let i = 0; i < 3 && q.length && vocativo.test(q[0]); i++) {
    q.shift();
    orig.shift();
  }
  if (q[0] === 'au' && q[1] === 'ra') {
    q.splice(0, 2);
    orig.splice(0, 2);
  }
  if (q.length >= 2 && q[0] === 'por' && q[1] === 'favor') {
    q.splice(0, 2);
    orig.splice(0, 2);
  }
  while (q.length && /^(porfa|please|pues|ya)$/.test(q[q.length - 1])) {
    q.pop();
    orig.pop();
  }
  if (q.length >= 2 && q[q.length - 2] === 'por' && q[q.length - 1] === 'favor') {
    q.splice(-2);
    orig.splice(-2);
  }
  return { q: q.join(' '), orig };
}

/** Las palabras originales que corresponden a un grupo de la expresión (por su posición en `q`). */
function tramo(q: string, orig: string[], ind: [number, number] | undefined): string {
  if (!ind) return '';
  const desde = q.slice(0, ind[0]).split(' ').filter(Boolean).length;
  const cuantas = q.slice(ind[0], ind[1]).split(' ').filter(Boolean).length;
  return orig.slice(desde, desde + cuantas).join(' ');
}

const mayuscula = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
const capitalizar = (s: string) => s.split(' ').map(mayuscula).join(' ');

/** Palabras que NO son un apodo («dime la hora», «dime algo», «call me later»). */
const NO_APODO = new Set(
  'la el los las lo que algo un una unos unas como cuando donde quien cual cuanto cuanta si no mas eso esto todo nada porque por para a de en hola adios gracias chiste chistes hora noticias bien mal otra otro tu mi me te cosas cositas later back tomorrow now soon please maybe'.split(
    ' '
  )
);

export type ResultadoMano = { tipo: 'accion'; accion: AccionMano; decir: string } | { tipo: 'propuesta'; propuesta: Propuesta; decir: string };

type OpcionesMano = {
  idioma?: IdiomaApp;
  contexto?: ContextoApp | null;
  resolver: (dicho: string, contactos: Contacto[]) => Resolucion;
  ahora?: number;
};

const HORA = String.raw`(?<h>\d{1,2}|una|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|once|doce)(?:(?: y)? (?<m>\d{2}|media|cuarto))?(?: (?<t>de la manana|de la tarde|de la noche|de la madrugada|del mediodia|am|pm|a m|p m))?`;
const HORA_EN = String.raw`(?<h>\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)(?: (?<m>\d{2}))?(?: (?<t>am|pm|a m|p m|in the morning|in the afternoon|in the evening|at night))?`;
const PEDIR_RECORDAR = String.raw`(?:recuerdame|recordame|recuerdeme|ponme un recordatorio(?: para)?|pon un recordatorio(?: para)?|avisame)`;
const DENTRO = String.raw`(?:en|dentro de) (?<n>\d+|un|una|media|dos|tres|cuatro|cinco|diez|quince|veinte|treinta|cuarenta|cincuenta) (?<u>minutos?|horas?|hora)`;

/**
 * Las manos que se reconocen sin modelo, si la frase es clara y el teléfono las sabe hacer. Si hay
 * duda (un nombre que no está o que se parece a dos, una hora que no se entiende), null: contesta el
 * cerebro, que pregunta. Llamar y recordar nunca salen directo: son una PROPUESTA que espera el «sí».
 */
export function manoPorReglas(texto: string, o: OpcionesMano): ResultadoMano | null {
  const ctx = o.contexto;
  if (!ctx?.manos?.length) return null;
  const { q, orig } = palabras(texto);
  if (!q) return null;
  const n = q.split(' ').length;
  const en = o.idioma === 'en';
  const ahora = o.ahora ?? Date.now();
  const puede = (m: Mano) => puedeMano(ctx, m);
  const uno = (dicho: string): Contacto | null => {
    const r = o.resolver(dicho, ctx.contactos || []);
    return r.tipo === 'uno' ? r.contacto : null;
  };

  // Recordatorios: frases largas («recuérdame a las cinco de la tarde llamar a mi mamá»).
  if (puede('recordatorio') && n <= 25) {
    const r = recordatorioPorReglas(q, orig, ahora);
    if (r) return { tipo: 'propuesta', propuesta: r, decir: preguntaDePropuesta(r, o.idioma, ahora) };
  }
  if (n > 9) return null;

  if (puede('llamar')) {
    const video =
      /^(?:(?:haz(?:me)?|hace(?:me)?|inicia|empieza|pon(?:me)?) (?:una )?)?(?:video ?llamada|videollamada|video call|videocall)(?: (?:a|al|con|with|to))? (?<con>.+)$/d.exec(q) ||
      /^(?:video ?llama(?:le)?|videollama(?:le)?|llama(?:le)?(?: por| en) video(?: a| al)?|video call) (?:a |al )?(?<con>.+)$/d.exec(q);
    const voz = video ? null : /^(?:llama(?:le)?|marca(?:le)?|haz(?:me)? una llamada|comunicame|call|phone|ring)(?: (?:a|al|con|to))? (?<con>.+)$/d.exec(q);
    const m = video || voz;
    if (m?.groups?.con) {
      const c = uno(m.groups.con);
      if (!c) return null;
      const p: Propuesta = { tipo: 'llamar', con: c.correo, nombre: c.nombre, video: !!video };
      return { tipo: 'propuesta', propuesta: p, decir: preguntaDePropuesta(p, o.idioma, ahora) };
    }
  }

  if (puede('leer')) {
    const todo = /^(?:(?:lee(?:me)?|leer) (?:mis|los) mensajes(?: nuevos| sin leer)?|que mensajes tengo|tengo mensajes(?: nuevos)?|hay mensajes(?: nuevos)?|me escribio alguien|alguien me escribio|read (?:me )?my messages|any new messages|do i have (?:any )?(?:new )?messages)$/.test(q);
    if (todo) return { tipo: 'accion', accion: { tipo: 'leer' }, decir: en ? 'Let me see…' : 'A ver…' };
    const de =
      /^(?:que|q) (?:me )?(?:dijo|escribio|mando|puso|contesto|respondio) (?<de>.+)$/d.exec(q) ||
      /^(?:lee(?:me)?|leer) (?:el|los) (?:ultimos? )?mensajes? (?:de|del) (?<de>.+)$/d.exec(q) ||
      /^(?:lee(?:me)?) lo (?:ultimo )?(?:de|que (?:me )?(?:dijo|escribio|mando)) (?<de>.+)$/d.exec(q) ||
      /^(?:tengo|hay) mensajes? (?:nuevos? )?de (?<de>.+)$/d.exec(q) ||
      /^what did (?<de>.+) (?:say|write|send)(?: me)?$/d.exec(q) ||
      /^read (?:me )?(?:the )?(?:last )?messages? from (?<de>.+)$/d.exec(q);
    if (de?.groups?.de) {
      const c = uno(de.groups.de);
      if (!c) return null;
      return { tipo: 'accion', accion: { tipo: 'leer', de: c.correo }, decir: en ? 'Let me see…' : 'A ver…' };
    }
  }

  if (puede('buscar')) {
    const m =
      /^(?:busca(?:me)?|encuentra(?:me)?|search(?: for)?) (?:en (?:los |mis )?(?:chats?|mensajes|conversaciones)|in (?:my )?(?:chats|messages)) (?:el mensaje |los mensajes |donde dice |que diga |lo de |sobre |acerca de )?(?<q>.+)$/d.exec(q) ||
      /^(?:busca(?:me)?|encuentra(?:me)?) (?:el|los) mensajes? (?:sobre|que dice|que diga|donde dice|con la palabra|acerca de) (?<q>.+)$/d.exec(q);
    if (m?.groups?.q) {
      const busca = linea(tramo(q, orig, m.indices?.groups?.q), MAX_BUSQUEDA);
      if (busca.length >= 2) return { tipo: 'accion', accion: { tipo: 'buscar', q: busca }, decir: en ? 'Let me look.' : 'Déjame buscar.' };
    }
  }

  if (puede('idioma')) {
    const m = /^(?:habla(?:me)?|contestame|responde(?:me)?|cambia(?:te|lo)?|pasate|ponte|pon(?:lo|la)?|switch|change|talk|speak)(?: (?:el idioma|al idioma|de idioma|the language|language))?(?: (?:a|al|en|in|to))? (?<l>ingles|espanol|english|spanish|castellano)$/.exec(q);
    if (m?.groups?.l) {
      const valor: IdiomaApp = /ingles|english/.test(m.groups.l) ? 'en' : 'es';
      return { tipo: 'accion', accion: { tipo: 'idioma', valor }, decir: valor === 'en' ? "Sure, I'll speak English from now on." : 'Listo, ahora te hablo en español.' };
    }
  }

  if (puede('perfil')) {
    const apodo = /^(?:(?<fijo>de ahora en adelante|desde ahora|a partir de ahora) )?(?<verbo>dime|decime|llamame|puedes decirme|quiero que me digas|prefiero que me digas|call me) (?<v>[a-zñ]+(?: [a-zñ]+)?)$/d.exec(q);
    if (apodo?.groups?.v) {
      const valor = tramo(q, orig, apodo.indices?.groups?.v);
      const primera = apodo.groups.v.split(' ')[0];
      // «dime…» también es «cuéntame»: solo vale si el nombre viene con mayúscula («Dime Chepe») o con
      // «de ahora en adelante». «llámame Chepe» no tiene otra lectura (AURA no llama a la persona).
      const ambiguo = /^(dime|decime)$/.test(apodo.groups.verbo) && !apodo.groups.fijo && !/^\p{Lu}/u.test(valor);
      if (!NO_APODO.has(primera) && !ambiguo && valor) {
        const v = linea(capitalizar(valor), MAX_APODO);
        return { tipo: 'accion', accion: { tipo: 'perfil', campo: 'apodo', valor: v }, decir: en ? `Done, I'll call you ${v} from now on.` : `Listo, desde ahora te digo ${v}.` };
      }
    }
    const vive = /^(?:ahora )?(?:vivo|resido|me mude|me cambie|i live|i moved) (?:en|a|para|in|to) (?<v>.+)$/d.exec(q);
    if (vive?.groups?.v) {
      const valor = tramo(q, orig, vive.indices?.groups?.v);
      // Una ciudad viene con mayúscula («San Pedro Sula»); «vivo en paz» no es un lugar.
      if (valor.split(' ').length <= 5 && /^\p{Lu}/u.test(valor)) {
        const v = linea(valor, MAX_CAMPO);
        return { tipo: 'accion', accion: { tipo: 'perfil', campo: 'vive', valor: v }, decir: en ? `Got it: you live in ${v}.` : `Anotado: vives en ${v}.` };
      }
    }
  }

  if (puede('presentacion')) {
    const m = /^(?:ponte|pasate|cambiate|hazte|muestrate|cambia|pon|go|switch|make yourself)(?: (?:en|a|al|to))? (?:(?:la|el) )?(?:modo )?(?<v>pantalla completa|completa|grande|full ?screen|al lado|a un lado|de lado|a la orilla|en la esquina|chiquita|pequena|chiquito|pequeno|to the side|side|small)$/.exec(q);
    if (m?.groups?.v) {
      const valor: Presentacion = /completa|grande|full/.test(m.groups.v) ? 'completa' : 'lado';
      return { tipo: 'accion', accion: { tipo: 'presentacion', valor }, decir: dichoPresentacion(valor, o.idioma) };
    }
  }
  return null;
}

function recordatorioPorReglas(q: string, orig: string[], ahora: number): Propuesta | null {
  const intentos: Array<[RegExp, 'hora' | 'dentro']> = [
    [new RegExp(String.raw`^${PEDIR_RECORDAR} (?:que )?(?:(?<d1>hoy|manana|pasado manana) )?(?:a las?|a la) ${HORA} (?:que |de |para )?(?<txt>.+)$`, 'd'), 'hora'],
    [new RegExp(String.raw`^${PEDIR_RECORDAR} (?:(?<d1>hoy|manana|pasado manana) )?(?:que |de |para )?(?<txt>.+?) (?:(?<d2>hoy|manana|pasado manana) )?(?:a las?|a la) ${HORA}$`, 'd'), 'hora'],
    [new RegExp(String.raw`^${PEDIR_RECORDAR} (?:que )?${DENTRO} (?:que |de |para )?(?<txt>.+)$`, 'd'), 'dentro'],
    [new RegExp(String.raw`^${PEDIR_RECORDAR} (?:que |de |para )?(?<txt>.+?) ${DENTRO}$`, 'd'), 'dentro'],
    [new RegExp(String.raw`^remind me (?:(?<d1>tomorrow) )?at ${HORA_EN} (?:to )?(?<txt>.+)$`, 'd'), 'hora'],
    [new RegExp(String.raw`^remind me (?:to )?(?<txt>.+?) (?:(?<d2>tomorrow) )?at ${HORA_EN}$`, 'd'), 'hora'],
    [new RegExp(String.raw`^remind me in (?<n>\d+|a|an|one|two|three|five|ten|fifteen|twenty|thirty) (?<u>minutes?|hours?) (?:to )?(?<txt>.+)$`, 'd'), 'dentro'],
    [new RegExp(String.raw`^remind me (?:to )?(?<txt>.+?) in (?<n>\d+|a|an|one|two|three|five|ten|fifteen|twenty|thirty) (?<u>minutes?|hours?)$`, 'd'), 'dentro'],
  ];
  for (const [re, forma] of intentos) {
    const m = re.exec(q);
    const g = m?.groups;
    if (!m || !g?.txt) continue;
    const cuando =
      forma === 'dentro'
        ? dentroDe(g.n, g.u, ahora)
        : horaDeFrase({ h: g.h, m: g.m, tramo: [g.t, /in the (afternoon|evening)|at night/.test(g.t || '') ? 'pm' : ''].join(' '), dia: g.d1 || g.d2 }, ahora);
    if (!cuando || cuandoValido(cuando, ahora) === null) return null;
    const texto = linea(mayuscula(tramo(q, orig, m.indices?.groups?.txt).replace(/^(que|de|para|to) /i, '')), MAX_RECORDATORIO);
    if (!texto) return null;
    return { tipo: 'recordatorio', texto, cuando };
  }
  return null;
}

/* ------------------------------------------------------------------ la confirmación de una propuesta */

/**
 * ¿Este mensaje confirma la propuesta? Las mismas exigencias que el «sí» de un borrador: un «sí» que
 * ABRE la frase, o el verbo explícito («llámale», «ponlo»). Un «no», «espera», «pero», «mejor» u
 * «otra» en cualquier parte lo deja sin hacer: «sí, pero llama a Ana» no es permiso para llamar a Beto.
 * Las afirmaciones débiles («ok», «dale», «va») no confirman nada.
 */
export function confirmaPropuesta(tipo: Propuesta['tipo'], mensaje: string): boolean {
  const crudo = String(mensaje || '').trim().toLowerCase();
  const q = plegar(crudo).replace(/[^a-z0-9ñ\s]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!q) return false;
  if (/\b(no|nop|nel|todavia|aun|espera|esperate|cancela|cancelalo|pero|mejor|otra|otro|don ?t|not|wait|cancel|but|instead|hold on)\b/.test(q)) return false;
  if (/^[¡!\s]*(sí|sip|simón)(?=[\s,.!;:]|$)/.test(crudo) || /^[¡!\s]*si\s*([,.!;:]|$)/.test(crudo) || /^(sip|simon|yes|claro que si)\b/.test(q)) return true;
  if (/^si (por favor|claro|dale)\b/.test(q)) return true;
  if (tipo === 'llamar') return /^(si )?(dale )?(llamale|llamala|llamalo|marcale|marcala|marcalo|comunicame|call (him|her|them)|yes call)( ya| pues| porfa| por favor)?$/.test(q);
  return /^(si )?(dale )?(ponlo|ponmelo|ponselo|guardalo|agendalo|programalo|hazlo|set it|yes set it)( ya| pues| porfa| por favor)?$/.test(q);
}

/** «no», «mejor no», «cancela»: la propuesta se suelta. */
export function niegaPropuesta(mensaje: string): boolean {
  const q = plegar(mensaje).replace(/[^a-z0-9ñ\s]+/g, ' ').replace(/\s+/g, ' ').trim();
  // «no», «no, mejor no», «no no, déjalo», «nel, gracias»: el «no» del principio y un remate corto.
  const resto = q.replace(/^((no|nop|nel) )*(no|nop|nel)\b ?/, '');
  if (resto !== q && /^(|gracias|mejor no|mejor|todavia|ahorita no|dejalo|dejalo asi|asi|olvidalo|cancela|cancelalo|thanks|never mind)$/.test(resto)) return true;
  return /^(mejor no|cancela|cancelalo|olvidalo|dejalo|no llames|no le llames|no lo pongas|ya no|no thanks|cancel|never mind|don ?t)$/.test(q);
}

/* ------------------------------------------------------------------ lo que se dice */

export function preguntaDePropuesta(p: Propuesta, idioma: IdiomaApp = 'es', ahora = Date.now()): string {
  const en = idioma === 'en';
  if (p.tipo === 'llamar') {
    if (en) return p.video ? `Should I video call ${p.nombre}?` : `Should I call ${p.nombre}?`;
    return p.video ? `¿Le hago videollamada a ${p.nombre}?` : `¿Llamo a ${p.nombre}?`;
  }
  const cuando = horaLegible(p.cuando, ahora, idioma);
  return en ? `Should I remind you “${p.texto}” ${cuando}?` : `¿Te recuerdo «${p.texto}» ${cuando}?`;
}

/** Lo que se dice al hacer lo que la persona confirmó. */
export function dichoDePropuesta(p: Propuesta, idioma: IdiomaApp = 'es', ahora = Date.now()): string {
  const en = idioma === 'en';
  if (p.tipo === 'llamar') {
    if (en) return p.video ? `Video calling ${p.nombre}.` : `Calling ${p.nombre}.`;
    return p.video ? `Va, videollamada con ${p.nombre}.` : `Te comunico con ${p.nombre}.`;
  }
  const cuando = horaLegible(p.cuando, ahora, idioma);
  return en ? `Done, I'll remind you ${cuando}.` : `Listo, te aviso ${cuando}.`;
}

export function dichoNegado(p: Propuesta, idioma: IdiomaApp = 'es'): string {
  if (idioma === 'en') return p.tipo === 'llamar' ? "Okay, I won't call." : "Okay, I won't set it.";
  return p.tipo === 'llamar' ? 'Va, no llamo.' : 'Va, no lo pongo.';
}

function dichoPresentacion(v: Presentacion, idioma?: IdiomaApp): string {
  if (idioma === 'en') return v === 'completa' ? 'Done, full screen.' : "Okay, I'll move to the side.";
  return v === 'completa' ? 'Listo, en pantalla completa.' : 'Va, me hago a un lado.';
}

/** La frase de una mano cuando el modelo escribió SOLO la línea (sin una palabra). */
export function dichoDeMano(a: AccionMano, idioma: IdiomaApp = 'es'): string {
  const en = idioma === 'en';
  switch (a.tipo) {
    case 'leer':
      return en ? 'Let me see…' : 'A ver…';
    case 'buscar':
      return en ? 'Let me look.' : 'Déjame buscar.';
    case 'idioma':
      return a.valor === 'en' ? "Sure, I'll speak English from now on." : 'Listo, ahora te hablo en español.';
    case 'perfil':
      if (a.campo === 'apodo') return en ? `Done, I'll call you ${a.valor} from now on.` : `Listo, desde ahora te digo ${a.valor}.`;
      return en ? 'Got it, I wrote it down.' : 'Anotado.';
    case 'presentacion':
      return dichoPresentacion(a.valor, idioma);
    case 'llamar':
      return en ? 'Calling.' : 'Te comunico.';
    case 'recordatorio':
      return en ? "Done, I'll remind you." : 'Listo, te lo recuerdo.';
  }
}

/* ------------------------------------------------------------------ el prompt */

/**
 * Las líneas del prompt para las manos que ESTE teléfono sabe hacer (ninguna si es un APK viejo).
 * Cortas: cada una dice la forma, cuándo usarla con ejemplos como habla la gente aquí, y lo que no.
 */
export function instruccionManos(ctx: ContextoApp | null, o: { propuesta?: Propuesta | null; ultimoLeido?: string | null; ahora?: number } = {}): string[] {
  const l: string[] = [];
  const puede = (m: Mano) => puedeMano(ctx, m);
  if (!ctx?.manos?.length) return l;
  const ahora = o.ahora ?? Date.now();
  l.push('MANOS (también puedes, con la misma línea ACCION_APP):');
  if (puede('llamar'))
    l.push(
      '· Llamar: {"tipo":"llamar","con":"<nombre>","video":false} (video:true = videollamada). «llama a mi mamá», «márcale a Beto», «hazle videollamada a la Ana». NUNCA se marca sin su «sí»: escribe la línea y PREGUNTA «¿Llamo a tu mamá?»; se marca solo si en el turno siguiente dice «sí» o «llámale». Solo a alguien de CONTACTOS; si no está o hay dos parecidos, pregunta a quién. En la llamada tú te apagas: no prometas quedarte.'
    );
  if (puede('leer'))
    l.push(
      '· Leer: {"tipo":"leer","de":"<nombre>"} o {"tipo":"leer"} (lo no leído de todos). «¿qué me dijo Beto?», «léeme mis mensajes», «¿tengo mensajes?». Tú NO ves los mensajes (van cifrados en su teléfono): di solo «A ver…» y el teléfono los lee con tu voz. Nunca inventes lo que dicen.'
    );
  if (puede('leer') || ctx.chatAbierto)
    l.push(
      `· Responder: «respóndele que ya voy» es redactar a ${ctx.chatAbierto ? `${ctx.chatAbierto.nombre} (el chat abierto)` : o.ultimoLeido ? `${o.ultimoLeido} (a quien le leíste de último)` : 'quien te diga'}, igual que «escríbele».`
    );
  if (puede('buscar')) l.push('· Buscar: {"tipo":"buscar","q":"<palabras>"}. «busca en mis chats la dirección», «¿dónde me mandaron el número del doctor?» (q: "número del doctor"). Di «Déjame buscar»; el teléfono dice en qué chat está y lo abre.');
  if (puede('idioma')) l.push('· Idioma: {"tipo":"idioma","valor":"en|es"}. «háblame en inglés», «volvamos al español».');
  if (puede('perfil'))
    l.push(
      '· Perfil: {"tipo":"perfil","campo":"apodo|cumple|vive|trabajo|familia|gustos|comida|musica|otros","valor":"…"} cuando te pida que recuerdes o cambies algo de sí: «dime Chepe» → apodo "Chepe"; «vivo en San Pedro Sula» → vive; «trabajo de maestra» → trabajo; «mi cumple es el 14 de marzo» → cumple "03-14" (siempre MM-DD). Confirma con naturalidad («Listo, desde ahora te digo Chepe»). Solo lo que ella diga de sí misma. «Lo que sabes de mí» se ve con {"tipo":"abrir","pantalla":"perfil"}.'
    );
  if (puede('recordatorio'))
    l.push(
      `· Recordatorio: {"tipo":"recordatorio","texto":"Llamar a mi mamá","cuando":"AAAA-MM-DDTHH:MM"} (hora de Honduras). «recuérdame a las 5 llamar a mi mamá», «avísame en media hora que saque la ropa». Como llamar: escribe la línea y PREGUNTA con la hora exacta («¿Te recuerdo "Llamar a mi mamá" hoy a las 5:00 de la tarde?»); se pone solo con su «sí». AHORA en Honduras: ${ahoraEnHonduras(ahora)}.`
    );
  if (puede('presentacion')) l.push('· Presentación: {"tipo":"presentacion","valor":"completa|lado"}. «ponte en pantalla completa», «hazte a un lado», «hazte chiquita» → lado.');
  if (o.propuesta) {
    const p = o.propuesta;
    l.push(
      p.tipo === 'llamar'
        ? `ESPERA SU «SÍ»: ${p.video ? 'videollamada' : 'llamada'} a ${p.nombre}. Si dice «sí», repite la línea de llamar; si dice que no, no la escribas.`
        : `ESPERA SU «SÍ»: recordatorio «${p.texto}» ${horaLegible(p.cuando, ahora)}. Si dice «sí», repite la línea; si cambia la hora, escríbela con la hora nueva y vuelve a preguntar.`
    );
  }
  return l;
}

/* ------------------------------------------------------------------ lo que lee el teléfono */

/**
 * El texto que el teléfono dice con la voz de AURA (lectura de mensajes o resultado de una búsqueda)
 * viaja como un mensaje de la conversación con esta forma: `[[lectura:<boleto>]] <texto>`. El boleto
 * lo inventó el servidor al mandar la orden, vale una vez y unos minutos: ni un mensaje recibido que
 * imite la forma ni un texto viejo pueden hacerse pasar por una lectura, y la lectura nunca llega al
 * cerebro (se dice tal cual, sin modelo). Lo mismo escribe mobile/src/compa/acciones.ts.
 */
export const RE_LECTURA = /^\s*\[\[lectura:([A-Za-z0-9_-]{8,40})\]\]\s*([\s\S]*)$/;
export const MAX_LECTURA = 1200;
