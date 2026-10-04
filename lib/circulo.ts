/**
 * EL CÍRCULO CERCANO: la gente de José (su esposa, sus hijos, sus socios). José (2-oct): «conecta con mi
 * familia — mi esposa — que puede llamarle si le tiene que recordar algo o escribirle por PULSE2CHAT o
 * WhatsApp».
 *
 * Cada persona: nombre, relación, por dónde se le escribe (WhatsApp, PULSE2CHAT, teléfono, correo) y qué
 * permisos le dio José. La regla de la casa no cambia: a la familia NO se le escribe sin el «sí» de José.
 * `circulo recordar` y `circulo escribir` dejan un BORRADOR de WhatsApp (server/whatsapp.ts), el mismo
 * que manda el servidor cuando el turno siguiente es un «sí» claro. Solo si José lo pidió EXPLÍCITAMENTE
 * desde su app (POST /api/circulo con permisos.recordatorios = 'permitido'), un RECORDATORIO a esa persona
 * sale sin preguntar (con tope por día). El cerebro no puede dar ese permiso: la herramienta no lo toca.
 *
 * Lo que de verdad se puede desde el servidor (dicho tal cual, sin teatro):
 *   · WhatsApp: sí, si su WhatsApp está vinculado (server/whatsapp.ts), con borrador y «sí».
 *   · Llamar: no. WhatsApp no deja llamar desde un dispositivo vinculado, y la llamada de Twilio de
 *     lib/canales.ts solo llama al teléfono de José (JEFE_TELEFONO). Desde la app del teléfono sí (PULSE2CHAT).
 *   · PULSE2CHAT: lo hace la app del teléfono (lib/manos-app.ts), no el servidor.
 *
 * Por persona (lib/cerebro-comun.ts clavePersona): caché, disco y S3 (`ultron/circulo/<huella>.json`).
 */
import { clave as claveBoveda } from './boveda';
import { clavePersona, CajonNoDisponible, crearCajones, linea, nuevoId, plegar } from './cerebro-comun';
import { borradorWhatsappParaConEstado, cuentaWhatsappVinculada, enviarWA, whatsappDisponible, whatsappPermitido } from '../server/whatsapp';
import { exito, fallo, incierto, type ResultadoHerramienta } from './recibo-herramienta';

export const RELACIONES = ['esposa', 'esposo', 'pareja', 'hija', 'hijo', 'madre', 'padre', 'hermana', 'hermano', 'familia', 'amigo', 'amiga', 'socio', 'socia', 'asistente', 'otro'] as const;
export type Relacion = (typeof RELACIONES)[number];
export type PermisoRecordatorio = 'preguntar' | 'permitido';

export type CanalesCirculo = {
  /** «+50499990000» o un jid de WhatsApp («50499990000@s.whatsapp.net»). */
  whatsapp?: string;
  /** Su Genesis ID o su correo en PULSE2CHAT. */
  pulse2chat?: string;
  /** «+50499990000». */
  telefono?: string;
  correo?: string;
};

export type MiembroCirculo = {
  id: string;
  nombre: string;
  alias: string[];
  relacion: Relacion;
  canales: CanalesCirculo;
  permisos: { recordatorios: PermisoRecordatorio; mensajes: 'preguntar' };
  notas?: string;
  creado: number;
  actualizado: number;
};

type Envio = { persona: string; t: number };
type CajonCirculo = { version: 1; personas: MiembroCirculo[]; envios: Envio[] };

export const MAX_CIRCULO = 60;
/** Recordatorios con permiso permanente que salen sin preguntar, por persona y por día. */
export const MAX_RECORDATORIOS_DIA = 3;

const SINONIMOS: Record<string, Relacion> = {
  mujer: 'esposa',
  senora: 'esposa',
  esposa: 'esposa',
  marido: 'esposo',
  esposo: 'esposo',
  novia: 'pareja',
  novio: 'pareja',
  pareja: 'pareja',
  hija: 'hija',
  nena: 'hija',
  hijo: 'hijo',
  mama: 'madre',
  madre: 'madre',
  mami: 'madre',
  papa: 'padre',
  padre: 'padre',
  papi: 'padre',
  hermana: 'hermana',
  hermano: 'hermano',
  socio: 'socio',
  socia: 'socia',
  amigo: 'amigo',
  amiga: 'amiga',
  asistente: 'asistente',
  secretaria: 'asistente',
  secretario: 'asistente',
};

const ETIQUETA: Partial<Record<Relacion, string>> = { esposa: 'su esposa', esposo: 'su esposo', pareja: 'su pareja', hija: 'su hija', hijo: 'su hijo', madre: 'su mamá', padre: 'su papá', hermana: 'su hermana', hermano: 'su hermano', socio: 'su socio', socia: 'su socia', asistente: 'su asistente' };

export function relacionDe(v: unknown): Relacion {
  const q = plegar(String(v ?? ''));
  if ((RELACIONES as readonly string[]).includes(q)) return q as Relacion;
  return SINONIMOS[q] || 'otro';
}

/** «+504 9999-0000», «9999 0000» (Honduras por omisión), «50499990000@s.whatsapp.net» → «+50499990000». Null si no es un número. */
export function numeroNormal(v: unknown): string | null {
  const s = String(v ?? '').trim();
  if (!s) return null;
  const jid = s.match(/^(\d{8,15})@(s\.whatsapp\.net|c\.us)$/);
  if (jid) return `+${jid[1]}`;
  const d = s.replace(/[^\d+]/g, '');
  const digitos = d.replace(/\D/g, '');
  if (digitos.length === 8 && !d.startsWith('+')) return `+504${digitos}`;
  if (digitos.length < 8 || digitos.length > 15) return null;
  return `+${digitos}`;
}

export function jidDe(numero: string): string {
  return `${String(numero).replace(/\D/g, '')}@s.whatsapp.net`;
}

export class ErrorCirculo extends Error {}

/**
 * Lo que llega (la app o la herramienta), validado. `permisos`: solo si viene de José en su app
 * (`permitirPermisos`); la herramienta del cerebro nunca da un permiso permanente.
 */
export function validarPersona(cuerpo: unknown, o: { parcial?: boolean; permitirPermisos?: boolean } = {}): Partial<Omit<MiembroCirculo, 'id' | 'creado' | 'actualizado'>> {
  if (!cuerpo || typeof cuerpo !== 'object' || Array.isArray(cuerpo)) throw new ErrorCirculo('La persona tiene que ser un objeto.');
  const b = cuerpo as Record<string, any>;
  const out: Partial<Omit<MiembroCirculo, 'id' | 'creado' | 'actualizado'>> = {};
  if (b.nombre !== undefined || !o.parcial) {
    const nombre = linea(b.nombre, 60);
    if (!nombre) throw new ErrorCirculo('Falta el nombre.');
    out.nombre = nombre;
  }
  if (b.relacion !== undefined || !o.parcial) out.relacion = relacionDe(b.relacion);
  if (b.alias !== undefined) out.alias = (Array.isArray(b.alias) ? b.alias : String(b.alias).split(',')).map((a: unknown) => linea(a, 40)).filter(Boolean).slice(0, 6);
  if (b.notas !== undefined) out.notas = linea(b.notas, 200);
  const c = b.canales && typeof b.canales === 'object' ? b.canales : b;
  const canales: CanalesCirculo = {};
  let hayCanales = false;
  for (const k of ['whatsapp', 'telefono'] as const) {
    if (c[k] === undefined) continue;
    hayCanales = true;
    if (c[k] === null || c[k] === '') continue;
    const n = numeroNormal(c[k]);
    if (!n) throw new ErrorCirculo(`El ${k === 'whatsapp' ? 'WhatsApp' : 'teléfono'} «${linea(c[k], 30)}» no parece un número.`);
    canales[k] = n;
  }
  if (c.pulse2chat !== undefined) {
    hayCanales = true;
    const p = linea(c.pulse2chat, 120);
    if (p) canales.pulse2chat = p;
  }
  if (c.correo !== undefined) {
    hayCanales = true;
    const m = linea(c.correo, 120).toLowerCase();
    if (m && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(m)) throw new ErrorCirculo('Ese correo no parece válido.');
    if (m) canales.correo = m;
  }
  if (hayCanales) out.canales = canales;
  if (b.permisos !== undefined) {
    if (!o.permitirPermisos) throw new ErrorCirculo('Los permisos solo los cambia José desde su app.');
    const r = b.permisos?.recordatorios;
    if (r !== 'preguntar' && r !== 'permitido') throw new ErrorCirculo('permisos.recordatorios es preguntar o permitido.');
    out.permisos = { recordatorios: r, mensajes: 'preguntar' };
  }
  return out;
}

function sanearPersona(x: any): MiembroCirculo | null {
  try {
    const v = validarPersona({ ...x, permisos: x?.permisos?.recordatorios === 'permitido' ? { recordatorios: 'permitido' } : undefined }, { permitirPermisos: true });
    const creado = Number(x?.creado) || 0;
    return {
      id: String(x?.id || nuevoId('cp')).slice(0, 40),
      nombre: v.nombre!,
      alias: v.alias || [],
      relacion: v.relacion || 'otro',
      canales: v.canales || {},
      permisos: v.permisos || { recordatorios: 'preguntar', mensajes: 'preguntar' },
      ...(v.notas ? { notas: v.notas } : {}),
      creado,
      actualizado: Number(x?.actualizado) || creado,
    };
  } catch {
    return null;
  }
}

const cajones = crearCajones<CajonCirculo>({
  nombre: 'circulo',
  prefijoS3: 'circulo',
  dirEnv: 'ULTRON_CIRCULO_DIR',
  dirPorOmision: 'circulo',
  vacio: () => ({ version: 1, personas: [], envios: [] }),
  sanear: (raw: any) => ({
    version: 1,
    personas: (Array.isArray(raw?.personas) ? raw.personas : []).map(sanearPersona).filter(Boolean).slice(0, MAX_CIRCULO) as MiembroCirculo[],
    envios: (Array.isArray(raw?.envios) ? raw.envios : [])
      .map((e: any) => ({ persona: String(e?.persona || '').slice(0, 40), t: Number(e?.t) || 0 }))
      .filter((e: Envio) => e.persona && e.t)
      .slice(-200),
  }),
});

/* ------------------------------------------------------------------ guardar */

/** Su círculo. Lanza CajonNoDisponible si no se pudo leer. */
export async function circuloDe(dueno: string): Promise<MiembroCirculo[]> {
  const l = await cajones.leer(clavePersona(dueno));
  if (!l.ok) throw new CajonNoDisponible('tu círculo');
  return l.valor.personas;
}

export function circuloEnCache(dueno: string): MiembroCirculo[] {
  return cajones.enCache(clavePersona(dueno))?.personas || [];
}

export function precargarCirculo(dueno: string): Promise<void> {
  return cajones.leer(clavePersona(dueno)).then(
    () => undefined,
    () => undefined
  );
}

/**
 * Agrega a alguien (si ya estaba con el mismo nombre y relación, lo actualiza). Lanza ErrorCirculo si algo
 * no vale y CajonNoDisponible si no se pudo leer lo guardado.
 */
export async function agregarPersona(dueno: string, cuerpo: unknown, o: { permitirPermisos?: boolean } = {}): Promise<{ persona: MiembroCirculo; durable: boolean }> {
  const k = clavePersona(dueno);
  if (!k) throw new ErrorCirculo('Entra con tu sesión.');
  const v = validarPersona(cuerpo, { permitirPermisos: o.permitirPermisos });
  const { resultado, durable } = await cajones.modificar(k, (c) => {
    const ahora = Date.now();
    const ya = c.personas.find((p) => plegar(p.nombre) === plegar(v.nombre!) && (p.relacion === v.relacion || v.relacion === 'otro'));
    if (ya) {
      Object.assign(ya, { ...v, relacion: v.relacion === 'otro' ? ya.relacion : v.relacion, canales: { ...ya.canales, ...(v.canales || {}) }, alias: v.alias || ya.alias, actualizado: ahora });
      return { ...ya };
    }
    if (c.personas.length >= MAX_CIRCULO) throw new ErrorCirculo(`El círculo ya tiene ${MAX_CIRCULO} personas.`);
    const p: MiembroCirculo = {
      id: nuevoId('cp'),
      nombre: v.nombre!,
      alias: v.alias || [],
      relacion: v.relacion || 'otro',
      canales: v.canales || {},
      permisos: v.permisos || { recordatorios: 'preguntar', mensajes: 'preguntar' },
      ...(v.notas ? { notas: v.notas } : {}),
      creado: ahora,
      actualizado: ahora,
    };
    c.personas.push(p);
    return { ...p };
  });
  return { persona: resultado, durable };
}

/** Cambia a alguien. Null si no existe. */
export async function actualizarPersona(dueno: string, id: string, cuerpo: unknown, o: { permitirPermisos?: boolean } = {}): Promise<{ persona: MiembroCirculo | null; durable: boolean }> {
  const k = clavePersona(dueno);
  if (!k) throw new ErrorCirculo('Entra con tu sesión.');
  const v = validarPersona(cuerpo, { parcial: true, permitirPermisos: o.permitirPermisos });
  const { resultado, durable } = await cajones.modificar(k, (c) => {
    const p = c.personas.find((x) => x.id === String(id));
    if (!p) return null;
    Object.assign(p, { ...v, canales: v.canales ? { ...p.canales, ...v.canales } : p.canales, actualizado: Date.now() });
    return { ...p };
  });
  return { persona: resultado, durable };
}

export async function quitarPersona(dueno: string, id: string): Promise<{ quitada: boolean; durable: boolean }> {
  const k = clavePersona(dueno);
  if (!k) return { quitada: false, durable: false };
  const { resultado, durable } = await cajones.modificar(k, (c) => {
    const antes = c.personas.length;
    c.personas = c.personas.filter((p) => p.id !== String(id));
    return c.personas.length < antes;
  });
  return { quitada: resultado, durable };
}

/* ------------------------------------------------------------------ a quién se refiere */

export type Resolucion = { persona: MiembroCirculo } | { ambiguas: MiembroCirculo[] } | null;

/** «mi esposa», «la esposa», «mi mujer», «Ana», «Ana María», «mi hijo Beto», un número: a quién del círculo. */
export function resolverPersona(personas: MiembroCirculo[], texto: string): Resolucion {
  let q = plegar(texto).replace(/[¿?¡!.,;:«»"]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!q || !personas.length) return null;
  for (let antes = ''; antes !== q; ) {
    antes = q;
    q = q.replace(/^(a|al|para|con|de|mi|mis|la|el|los|las|nuestra|nuestro|su)\s+/, '');
  }
  const digitos = q.replace(/\D/g, '');
  if (digitos.length >= 7) {
    const porNum = personas.filter((p) => [p.canales.whatsapp, p.canales.telefono].some((n) => n && n.replace(/\D/g, '').endsWith(digitos.slice(-8))));
    if (porNum.length === 1) return { persona: porNum[0] };
  }
  const [primera, ...resto] = q.split(' ');
  const rel = SINONIMOS[primera] || ((RELACIONES as readonly string[]).includes(primera) ? (primera as Relacion) : null);
  if (rel) {
    let deRel = personas.filter((p) => p.relacion === rel);
    // «mi hijo Beto»: la relación y el nombre.
    if (resto.length && deRel.length > 1) {
      const n = resto.join(' ');
      const conNombre = deRel.filter((p) => plegar(p.nombre).includes(n) || p.alias.some((a) => plegar(a) === n));
      if (conNombre.length) deRel = conNombre;
    }
    if (deRel.length === 1) return { persona: deRel[0] };
    if (deRel.length > 1) return { ambiguas: deRel };
    if (!resto.length) return null;
    q = resto.join(' ');
  }
  const exactos = personas.filter((p) => plegar(p.nombre) === q || p.alias.some((a) => plegar(a) === q));
  if (exactos.length === 1) return { persona: exactos[0] };
  if (exactos.length > 1) return { ambiguas: exactos };
  const porPalabra = personas.filter((p) => plegar(p.nombre).split(' ').includes(q.split(' ')[0]) || p.alias.some((a) => plegar(a).split(' ').includes(q.split(' ')[0])));
  if (porPalabra.length === 1) return { persona: porPalabra[0] };
  if (porPalabra.length > 1) return { ambiguas: porPalabra };
  return null;
}

/** ¿Este chat o correo es de alguien del círculo? (lib/triaje.ts: la familia pesa más). */
export function delCirculo(personas: MiembroCirculo[], o: { nombre?: string; numero?: string; correo?: string; jid?: string }): MiembroCirculo | null {
  const num = String(o.numero || (o.jid && /@s\.whatsapp\.net$/.test(o.jid) ? o.jid.split('@')[0] : '') || '').replace(/\D/g, '');
  if (num.length >= 8) {
    const p = personas.find((x) => [x.canales.whatsapp, x.canales.telefono].some((n) => n && n.replace(/\D/g, '').slice(-8) === num.slice(-8)));
    if (p) return p;
  }
  const correo = String(o.correo || '').toLowerCase();
  if (correo) {
    const p = personas.find((x) => x.canales.correo === correo || x.canales.pulse2chat?.toLowerCase() === correo);
    if (p) return p;
  }
  const n = plegar(o.nombre || '');
  if (n.length >= 3) return personas.find((x) => plegar(x.nombre) === n || x.alias.some((a) => plegar(a) === n)) || null;
  return null;
}

export function etiquetaDe(p: MiembroCirculo): string {
  return ETIQUETA[p.relacion] ? `${p.nombre} (${ETIQUETA[p.relacion]})` : p.nombre;
}

/* ------------------------------------------------------------------ lo que se puede desde el servidor */

/** Qué está configurado de verdad para llegar a alguien del círculo desde el servidor. */
export function capacidadesCirculo(dueno: string): { whatsapp: boolean; llamada: 'solo_dueno' | 'sin_configurar'; pulse2chat: 'app' } {
  const twilio = !!(claveBoveda('twilio_sid') && claveBoveda('twilio_tok') && claveBoveda('twilio_voz') && claveBoveda('jefe_tel'));
  let wa = false;
  try {
    wa = whatsappDisponible() && whatsappPermitido(dueno);
  } catch {
    wa = false;
  }
  return { whatsapp: wa, llamada: twilio ? 'solo_dueno' : 'sin_configurar', pulse2chat: 'app' };
}

function textoLlamada(p: MiembroCirculo, dueno: string): string {
  const cap = capacidadesCirculo(dueno);
  const tw =
    cap.llamada === 'solo_dueno'
      ? 'la llamada de Twilio de este servidor solo está hecha para llamar al teléfono de José (JEFE_TELEFONO), no a otras personas'
      : 'la llamada de Twilio no está configurada en este servidor';
  const num = p.canales.telefono || p.canales.whatsapp;
  return `CÍRCULO: no puedo llamar a ${etiquetaDe(p)} desde el servidor: WhatsApp no deja llamar desde un dispositivo vinculado y ${tw}. Desde la app del teléfono sí: «llama a ${p.nombre}» por PULSE2CHAT${num ? ` o abre WhatsApp con su número ${num}` : ''}. ${cap.whatsapp && num ? 'Ofrécele mandarle un WhatsApp (queda borrador hasta su «sí»).' : ''}`.trim();
}

/* ------------------------------------------------------------------ la herramienta del cerebro */

/** Lo que el cerebro sabe pedir (lib/harness.ts). */
export { INSTRUCCION_CIRCULO } from './harness';

type DepsCirculo = {
  whatsappListo?: (dueno: string) => boolean;
  borrador?: (dueno: string, ambito: string, b: { chat: string; nombre: string; texto: string }) => string;
  enviar?: (chat: string, texto: string) => Promise<unknown>;
  ahora?: number;
};

function canalWhatsapp(p: MiembroCirculo): string | null {
  const n = p.canales.whatsapp || p.canales.telefono;
  return n ? jidDe(n) : null;
}

function lineaPersona(p: MiembroCirculo, i: number): string {
  const canales = [p.canales.whatsapp ? `WhatsApp ${p.canales.whatsapp}` : '', p.canales.telefono && p.canales.telefono !== p.canales.whatsapp ? `tel. ${p.canales.telefono}` : '', p.canales.pulse2chat ? 'PULSE2CHAT' : '', p.canales.correo ? 'correo' : '']
    .filter(Boolean)
    .join(', ');
  return `${i + 1}. ${p.nombre} — ${p.relacion}${canales ? ` (${canales})` : ' (sin canal guardado)'}${p.permisos.recordatorios === 'permitido' ? ' · recordatorios sin preguntar' : ''}`;
}

/**
 * El runner del harness: «listar», «recordar <persona> | <qué> | <cuándo>», «escribir <persona> | <texto>»,
 * «agregar <nombre> | <relación> | <número>», «llamar <persona>». `dueno`: quien habla (su correo o su id
 * del padrón, el mismo que usa server/whatsapp.ts para el «sí»); `ambito`: la conversación.
 */
export async function correrCirculo(dueno: string, arg: string, ambito = '', d: DepsCirculo = {}): Promise<string> {
  return (await correrCirculoConEstado(dueno, arg, ambito, d)).texto;
}

/**
 * El runner con su estado y su recibo (AUR07). Un recordatorio que salió es `confirmado`; uno que el puente
 * rechazó (4xx) es `failed`; uno que se despachó y no se supo (caída, tiempo) es `unknown`: no se repite a ciegas.
 */
export async function correrCirculoConEstado(dueno: string, arg: string, ambito = '', d: DepsCirculo = {}): Promise<ResultadoHerramienta> {
  if (!dueno) return fallo('CÍRCULO: solo con sesión. Pídele que entre con su cuenta.', 'sin-sesion');
  const [cabeza, ...partes] = String(arg || '').split('|').map((x) => x.trim());
  const m = cabeza.match(/^(\S+)\s*(.*)$/s);
  const verbo = plegar(m?.[1] || 'listar');
  const resto = (m?.[2] || '').trim();
  let personas: MiembroCirculo[];
  try {
    personas = await circuloDe(dueno);
  } catch {
    return fallo('CÍRCULO: no pude leer su círculo guardado en este momento. No hice nada; dilo con naturalidad.', 'almacen');
  }
  try {
    if (/^(listar|lista|quienes|ver)$/.test(verbo)) {
      if (!personas.length) return exito('CÍRCULO: todavía no tiene a nadie guardado. Pregúntale por su gente (nombre, relación y su WhatsApp) y agrégalos con «circulo agregar».', { efecto: 'ninguno', proveedor: 'circulo' });
      return exito(`CÍRCULO (${personas.length}):\n${personas.map(lineaPersona).join('\n')}`, { efecto: 'ninguno', proveedor: 'circulo' });
    }
    if (/^(agregar|agrega|anadir|guardar|nuevo)$/.test(verbo)) {
      const [relacion = '', numero = '', p2c = ''] = partes;
      const cuerpo: Record<string, unknown> = { nombre: resto, relacion };
      if (numero) cuerpo.whatsapp = numero;
      if (p2c) cuerpo.pulse2chat = p2c;
      const { persona } = await agregarPersona(dueno, cuerpo);
      return exito(`CÍRCULO: guardé a ${etiquetaDe(persona)}${persona.canales.whatsapp ? ` con WhatsApp ${persona.canales.whatsapp}` : ' (sin número todavía)'}. Para escribirle siempre te voy a pedir su «sí».`, { efecto: 'guardado', proveedor: 'circulo', referencia: persona.id });
    }
    const quien = resto;
    if (!quien) return fallo(`CÍRCULO: ¿a quién? Dime el nombre o la relación («mi esposa»).`, 'falta-dato');
    const r = resolverPersona(personas, quien);
    if (!r) return fallo(`CÍRCULO: no tengo a «${linea(quien, 40)}» en su círculo. Pídele el nombre, la relación y su WhatsApp para guardarla (circulo agregar …). No inventes números.`, 'no-encontrado');
    if ('ambiguas' in r) return fallo(`CÍRCULO: «${linea(quien, 40)}» puede ser ${r.ambiguas.map((p) => p.nombre).join(' o ')}. Pregúntale cuál.`, 'ambiguo');
    const p = r.persona;
    // Llamar no se puede desde el servidor: el texto explica cómo (lo hace la app). No hubo efecto.
    if (/^(llamar|llama|llamale|telefonear)$/.test(verbo)) return fallo(textoLlamada(p, dueno), 'no-disponible');
    if (!/^(recordar|recuerdale|recuerda|recordatorio|escribir|escribele|mensaje|avisar|avisale|decir|dile)$/.test(verbo)) {
      return fallo(`CÍRCULO: no entiendo «${verbo}». Usa listar, recordar, escribir, agregar o llamar.`, 'no-entiendo');
    }
    const esRecordatorio = /^(recordar|recuerdale|recuerda|recordatorio|avisar|avisale)$/.test(verbo);
    let texto = linea(partes[0] || '', 900);
    const cuando = linea(partes[1] || '', 60);
    if (!texto) return fallo(`CÍRCULO: ¿qué le digo a ${p.nombre}? Falta el mensaje.`, 'falta-dato');
    if (cuando && !texto.toLowerCase().includes(cuando.toLowerCase())) texto = `${texto} (${cuando})`;
    const chat = canalWhatsapp(p);
    const listo = d.whatsappListo ? d.whatsappListo(dueno) : capacidadesCirculo(dueno).whatsapp;
    if (!chat || !listo) {
      const porQue = !chat ? `no tengo su WhatsApp ni su teléfono guardado` : 'su WhatsApp no está conectado en este servidor';
      return fallo(`CÍRCULO: no puedo escribirle a ${etiquetaDe(p)} desde aquí: ${porQue}. ${p.canales.pulse2chat ? `Por PULSE2CHAT lo hace la app del teléfono («escríbele a ${p.nombre}»).` : 'Desde la app del teléfono puede escribirle por PULSE2CHAT.'} No digas que se mandó.`, 'no-disponible');
    }
    const aviso = cuando ? ` OJO: no puedo programar el envío para más tarde desde el servidor; si dice que sí, sale ahora. Si prefiere que salga a esa hora, ofrécele ponerse un recordatorio en su teléfono para mandarlo.` : '';
    // Permiso permanente para recordatorios (solo lo da José desde su app): sale sin preguntar, con tope.
    // Uno para más tarde («a las 4») no: el servidor no programa envíos y saldría ya; va al borrador con el
    // aviso (Codex en #128).
    if (esRecordatorio && !cuando && p.permisos.recordatorios === 'permitido') {
      const ahora = d.ahora ?? Date.now();
      const k = clavePersona(dueno);
      const hoy = (cajones.enCache(k)?.envios || []).filter((e) => e.persona === p.id && ahora - e.t < 86_400_000).length;
      if (hoy < MAX_RECORDATORIOS_DIA) {
        const corto = linea(texto, 300);
        try {
          await (d.enviar || enviarWA)(chat, corto);
        } catch (e: any) {
          const porque = String(e?.message || e).slice(0, 120);
          const status = Number(e?.status) || 0;
          // El puente lo rechazó (4xx): no salió. Una caída o un tiempo agotado pudo haberlo mandado igual.
          if (status >= 400 && status < 500) return fallo(`CÍRCULO: NO se pudo mandar el recordatorio a ${etiquetaDe(p)} (${porque}). Díselo con honestidad.`, 'proveedor');
          return incierto(`CÍRCULO: mandé el recordatorio a ${etiquetaDe(p)} pero el WhatsApp no confirmó (${porque}). No sé si le llegó: no lo vuelvas a mandar sin preguntarle; dile que lo revise en su WhatsApp.`, { proveedor: 'whatsapp', referencia: chat });
        }
        await cajones
          .modificar(k, (c) => {
            c.envios.push({ persona: p.id, t: ahora });
          })
          .catch(() => undefined);
        return exito(`RECORDATORIO ENVIADO por WhatsApp a ${etiquetaDe(p)} (José le dio permiso permanente para recordatorios): «${corto}». Díselo en una frase.`, { efecto: 'confirmado', proveedor: 'whatsapp', referencia: chat });
      }
      // Pasado el tope del día, vuelve a preguntar.
    }
    // El borrador va al jid del número GUARDADO (nunca a un chat buscado por nombre) y desde la cuenta vinculada ahora:
    // el «sí» autoriza ESE número desde ESA cuenta (revisión 4-oct).
    const b = d.borrador
      ? exito(d.borrador(dueno, ambito, { chat, nombre: etiquetaDe(p), texto }), { efecto: 'borrador', proveedor: 'whatsapp' })
      : borradorWhatsappParaConEstado(dueno, ambito, { chat, nombre: etiquetaDe(p), texto, cuenta: await cuentaWhatsappVinculada() });
    return aviso ? { ...b, texto: `${b.texto}${aviso}` } : b;
  } catch (e: any) {
    if (e instanceof ErrorCirculo) return fallo(`CÍRCULO: ${e.message}`, 'rechazado');
    if (e instanceof CajonNoDisponible) return fallo('CÍRCULO: no pude leer su círculo guardado en este momento. No hice nada.', 'almacen');
    return fallo(`CÍRCULO: falló (${String(e?.message || e).slice(0, 140)}).`, 'excepcion');
  }
}

/** Solo pruebas. */
export function _olvidarCacheCirculo() {
  cajones._olvidarCache();
}
