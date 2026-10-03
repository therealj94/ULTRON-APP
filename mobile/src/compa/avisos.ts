/**
 * LOS AVISOS DE AURA EN EL TELÉFONO (la lógica, sin React Native): cuándo y por dónde te avisa lo que
 * propone por su cuenta (server/iniciativa.ts → lib/avisos.ts, AUR12).
 *
 *   GET  /api/avisos/preferencias         → { preferencias }
 *   POST /api/avisos/preferencias {…}     → { preferencias, cancelados }
 *   POST /api/avisos/posponer {fecha, hora} | {quitar: true} → { pospuestoHasta }
 *
 * Lo que la persona controla: su zona horaria (la del teléfono, con un toque), sus horas quietas, el canal
 * (solo en la app, o también avisos con la app cerrada), «menos avisos», qué significa «Luego», posponer
 * hasta una fecha, las clases que no quiere y el apagado. Por omisión: como mucho UN aviso no urgente al día
 * y silencio si no hay nada nuevo.
 */

export type ClaseAviso = 'mision' | 'conocer' | 'ayuda' | 'seguimiento' | 'dia' | 'bloqueo';
export const CLASES_AVISO: readonly ClaseAviso[] = ['seguimiento', 'dia', 'ayuda', 'conocer', 'mision', 'bloqueo'];
export type CanalAviso = 'app' | 'push' | 'correo';
export type LuegoPref = '2h' | 'tarde' | 'manana';

export type PreferenciasAvisos = {
  zona: string;
  quietas: { desde: string; hasta: string };
  canales: CanalAviso[];
  maxDia: number;
  cadaDias: number;
  urgentes: ClaseAviso[];
  llamadaUrgente: boolean;
  clasesApagadas: ClaseAviso[];
  temasSilenciados: { clave: string; texto: string }[];
  pospuestoHasta?: number;
  luego: LuegoPref;
  apagado: boolean;
};

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

/** El cuerpo de GET /api/avisos/preferencias → las preferencias (o null si vino mal). */
export function prefsDeServidor(r: unknown): PreferenciasAvisos | null {
  const x = (r as { preferencias?: any } | null)?.preferencias;
  if (!x || typeof x !== 'object' || typeof x.zona !== 'string' || !HHMM.test(String(x.quietas?.desde)) || !HHMM.test(String(x.quietas?.hasta))) return null;
  const lista = <T extends string>(v: unknown, validos: readonly string[]): T[] => (Array.isArray(v) ? (v.filter((c) => validos.includes(c)) as T[]) : []);
  return {
    zona: x.zona,
    quietas: { desde: x.quietas.desde, hasta: x.quietas.hasta },
    canales: lista<CanalAviso>(x.canales, ['app', 'push', 'correo']),
    maxDia: Number.isInteger(x.maxDia) ? x.maxDia : 1,
    cadaDias: Number.isInteger(x.cadaDias) ? x.cadaDias : 1,
    urgentes: lista<ClaseAviso>(x.urgentes, CLASES_AVISO),
    llamadaUrgente: x.llamadaUrgente === true,
    clasesApagadas: lista<ClaseAviso>(x.clasesApagadas, CLASES_AVISO),
    temasSilenciados: Array.isArray(x.temasSilenciados) ? x.temasSilenciados.filter((t: any) => t && typeof t.clave === 'string').map((t: any) => ({ clave: t.clave, texto: String(t.texto || '') })) : [],
    ...(Number(x.pospuestoHasta) > 0 ? { pospuestoHasta: Number(x.pospuestoHasta) } : {}),
    luego: ['2h', 'tarde', 'manana'].includes(x.luego) ? x.luego : '2h',
    apagado: x.apagado === true,
  };
}

/** La zona IANA del teléfono («America/Tegucigalpa»), o null si el sistema no la da. */
export function zonaDelTelefono(): string | null {
  try {
    const z = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return typeof z === 'string' && /^[A-Za-z]+\/[A-Za-z0-9_+/-]+$|^UTC$/.test(z) ? z : null;
  } catch {
    return null;
  }
}

/** Horarios de silencio para elegir con un toque. */
export const QUIETAS_RAPIDAS: readonly { id: string; desde: string; hasta: string }[] = [
  { id: '21-07', desde: '21:00', hasta: '07:00' },
  { id: '22-06', desde: '22:00', hasta: '06:00' },
  { id: '23-08', desde: '23:00', hasta: '08:00' },
];

export function idQuietas(q: { desde: string; hasta: string }): string {
  return QUIETAS_RAPIDAS.find((x) => x.desde === q.desde && x.hasta === q.hasta)?.id || 'otro';
}

/** «Solo en la app» o «también con la app cerrada» (push). El correo se elige aparte. */
export function canalesPara(conAvisos: boolean): CanalAviso[] {
  return conAvisos ? ['app', 'push'] : ['app'];
}

/** Pone o quita una clase de la lista (sin repetir). */
export function alternar<T extends string>(lista: readonly T[], c: T): T[] {
  return lista.includes(c) ? lista.filter((x) => x !== c) : [...lista, c];
}

/** La fecha «AAAA-MM-DD» de dentro de `dias` días en el reloj del teléfono (para posponer). */
export function fechaEnDias(dias: number, ahora = new Date()): string {
  const d = new Date(ahora.getFullYear(), ahora.getMonth(), ahora.getDate() + dias);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** El cuerpo para posponer los avisos hasta dentro de `dias` días, al terminar sus horas quietas (en SU zona: lo convierte el servidor). */
export function cuerpoPosponer(dias: number, prefs: Pick<PreferenciasAvisos, 'quietas'>, ahora = new Date()): { fecha: string; hora: string } {
  return { fecha: fechaEnDias(dias, ahora), hora: prefs.quietas.hasta };
}

export function etiquetaClaseAviso(c: ClaseAviso, idioma: 'es' | 'en' = 'es'): string {
  const en = idioma === 'en';
  switch (c) {
    case 'seguimiento':
      return en ? 'Follow-ups and deadlines' : 'Seguimientos y vencimientos';
    case 'dia':
      return en ? 'Plan for the day' : 'Plan del día';
    case 'ayuda':
      return en ? 'Ideas and help' : 'Ideas y ayuda';
    case 'conocer':
      return en ? 'Questions to know you' : 'Preguntas para conocerte';
    case 'mision':
      return en ? 'New missions' : 'Misiones nuevas';
    default:
      return en ? 'A source stopped working' : 'Una fuente dejó de funcionar';
  }
}

export function etiquetaLuego(l: LuegoPref, idioma: 'es' | 'en' = 'es'): string {
  const en = idioma === 'en';
  if (l === 'tarde') return en ? 'This afternoon' : 'Esta tarde';
  if (l === 'manana') return en ? 'Tomorrow' : 'Mañana';
  return en ? 'In 2 hours' : 'En 2 horas';
}
