/**
 * EL CALENDARIO EN EL TELÉFONO, SIN RED NI REACT (se prueba en Node: src/agenda/pruebas/agenda.prueba.mjs).
 *
 * Lo que dice cada fila de Ajustes → Calendario y la vista «Hoy» de «Más», siempre con la verdad que da el servidor
 * (server/calendario.ts, GET /api/calendario/estado): «Conectado» solo si el servidor tiene el permiso y sirve;
 * «Hay que volver a conectarlo» si el proveedor ya no deja renovarlo; «Falta configurar en el servidor» si el dueño de
 * AU-RA todavía no registró la app de ese proveedor; y «No pude leerlo» no es «sin conectar». Las horas ya llegan dichas
 * en hora de Honduras desde el servidor: aquí no se convierte ninguna zona.
 */
export type ProveedorCal = 'microsoft' | 'google';

export type EstadoProveedor = {
  id: ProveedorCal;
  nombre: string;
  configurado: boolean;
  falta: string[];
  conectado: boolean;
  reconectar: boolean;
  cuenta?: string;
  desde?: number;
};

export type EstadoCalendario = { leidas: boolean; proveedores: EstadoProveedor[] };

export type EventoApp = { id: string; proveedor: ProveedorCal; titulo: string; inicio: number; fin: number; todoElDia: boolean; hora: string; lugar?: string; enlace?: string };
export type DiaApp = { fecha: string; titulo: string; eventos: EventoApp[] };
export type AgendaApp = { conectados: number; etiqueta?: string; dias: DiaApp[]; fallos: Array<{ proveedor: ProveedorCal; nombre: string; siguiente: string }> };

type Idioma = 'es' | 'en';
const t = (idioma: Idioma, es: string, en: string) => (idioma === 'en' ? en : es);

/** Qué se puede hacer con un proveedor desde Ajustes. */
export type AccionCal = 'conectar' | 'reconectar' | 'desconectar' | null;

export function accionDe(p: EstadoProveedor): AccionCal {
  if (p.conectado) return 'desconectar';
  if (!p.configurado) return null;
  return p.reconectar ? 'reconectar' : 'conectar';
}

/** La línea de estado de un proveedor (lo honesto, sin adornos). */
export function textoEstado(p: EstadoProveedor, idioma: Idioma = 'es'): string {
  if (p.conectado) return p.cuenta ? t(idioma, `Conectado · ${p.cuenta}`, `Connected · ${p.cuenta}`) : t(idioma, 'Conectado', 'Connected');
  if (p.reconectar) return t(idioma, 'El permiso venció o se quitó: hay que volver a conectarlo', 'Access expired or was removed: connect it again');
  if (!p.configurado) return t(idioma, 'Falta configurar en el servidor (todavía no disponible)', 'Not set up on the server yet (not available)');
  return t(idioma, 'Sin conectar', 'Not connected');
}

/** Lo que se lee a la derecha de la fila «Calendario» en Ajustes. `null` = todavía no se sabe. */
export function resumenFila(e: EstadoCalendario | null, sinLeer: boolean, idioma: Idioma = 'es'): string {
  if (sinLeer && !e) return '';
  if (!e) return '';
  if (!e.leidas) return t(idioma, 'No pude leerlo', 'Couldn’t read it');
  const conectados = e.proveedores.filter((p) => p.conectado);
  if (conectados.length === 1) return conectados[0].id === 'microsoft' ? 'Outlook' : 'Google';
  if (conectados.length > 1) return String(conectados.length);
  if (e.proveedores.some((p) => p.reconectar)) return t(idioma, 'Reconectar', 'Reconnect');
  if (!e.proveedores.some((p) => p.configurado)) return t(idioma, 'No disponible', 'Not available');
  return t(idioma, 'Sin conectar', 'Not connected');
}

/** El aviso de arriba de la vista «Hoy» (o null si todo bien). */
export function avisoAgenda(a: AgendaApp | null, idioma: Idioma = 'es'): string | null {
  if (!a) return null;
  if (!a.conectados) return t(idioma, 'No tienes ningún calendario conectado. Conéctalo en Ajustes → Calendario (Outlook o Google).', 'You have no calendar connected. Connect one in Settings → Calendar (Outlook or Google).');
  if (a.fallos.length) {
    const cuales = a.fallos.map((f) => `${f.nombre}${f.siguiente === 'reconectar' ? t(idioma, ' (reconéctalo en Ajustes)', ' (reconnect it in Settings)') : ''}`).join(', ');
    return t(idioma, `No pude leer ${cuales}: lo de ese calendario no aparece aquí.`, `I couldn’t read ${cuales}: that calendar isn’t shown here.`);
  }
  return null;
}

/** «Nada en tu calendario hoy» y compañía. */
export function textoVacio(cuando: 'hoy' | 'manana' | 'semana', idioma: Idioma = 'es'): string {
  if (cuando === 'manana') return t(idioma, 'Mañana no tienes nada en el calendario.', 'Nothing on your calendar tomorrow.');
  if (cuando === 'semana') return t(idioma, 'No tienes nada en el calendario esta semana.', 'Nothing on your calendar this week.');
  return t(idioma, 'Hoy no tienes nada en el calendario.', 'Nothing on your calendar today.');
}

/** Los días que se muestran: un día, siempre (aunque esté vacío); la semana, solo los que tienen algo. */
export function diasVisibles(a: AgendaApp | null, cuando: 'hoy' | 'manana' | 'semana'): DiaApp[] {
  if (!a) return [];
  return cuando === 'semana' ? a.dias.filter((d) => d.eventos.length) : a.dias.slice(0, 1);
}

/** El nombre corto de dónde viene un evento (cuando tiene los dos calendarios). */
export const marcaProveedor = (p: ProveedorCal) => (p === 'microsoft' ? 'Outlook' : 'Google');

/** Cada cuánto se vuelve a preguntar si ya entró con el código de Microsoft (al menos lo que pide Microsoft). */
export const sondeoMs = (intervalo: number) => Math.max(3, Number(intervalo) || 5) * 1000;
