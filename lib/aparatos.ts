/**
 * EL REGISTRO DE APARATOS DE CADA CUENTA (auditoría del 10-oct): qué teléfonos (y la burbuja, Windows) tiene la persona,
 * si están en línea, qué saben hacer, qué permisos tienen y con qué versión de la app.
 *
 * Antes lo único que se sabía de un teléfono era la lista fija de manos de su contexto (POST /api/app/contexto), en un
 * mapa de 30 minutos en memoria que borraba cada despliegue: tras un redespliegue, el cerebro no sabía que el teléfono
 * podía poner un recordatorio hasta que volvía a mandar su contexto. Ahora cada aparato manda un LATIDO (POST
 * /api/app/aparato, cada minuto con la app delante y al abrirla: mobile/src/telefono/latido.ts) y el registro queda en el
 * almacén durable (lib/durable.ts), por cuenta:
 *  · id del aparato, tipo (android, ios, windows, web), superficie (mesa o burbuja), versión de la app;
 *  · habilidades (las manos que declara y lo que completa: lib/superficie.ts) y permisos (notificaciones, alarmas exactas,
 *    micrófono…), tal como el aparato los ve;
 *  · el último latido (en línea = latido de hace menos de EN_LINEA_MS).
 * El turno lleva UNA línea corta con los aparatos en línea y lo que saben (`lineaAparatos`). Mandar una acción a OTRO
 * aparato todavía no se hace (queda listo el registro para eso).
 *
 * Escribe poco: un latido igual al último no toca el almacén salvo cada GUARDAR_CADA_MS (para el «visto por última vez»).
 */
import { almacenDurable, claveDe, leerDurable, modificarDurable, type AlmacenDurable } from './durable';

export const EN_LINEA_MS = 3 * 60_000;
export const GUARDAR_CADA_MS = 10 * 60_000;
export const MAX_APARATOS = 8;
const TIPOS = ['android', 'ios', 'windows', 'web'] as const;
export type TipoAparato = (typeof TIPOS)[number];

export type Aparato = {
  id: string;
  tipo: TipoAparato;
  superficie?: 'mesa' | 'burbuja';
  version?: string;
  habilidades: string[];
  permisos: Record<string, 'si' | 'no' | 'preguntar'>;
  ultimoLatido: number;
};
type Registro = { aparatos: Aparato[]; v: 1 };

const corto = (v: unknown, max: number, re = /^[A-Za-z0-9_.+:-]+$/) => {
  const s = String(v ?? '').trim().slice(0, max);
  return s && re.test(s) ? s : undefined;
};

/** Un latido validado (forma y largo), o null. El id lo pone quien llama (la cabecera `x-aura-aparato`). */
export function latidoValido(id: string | null, x: unknown, ahora = Date.now()): Aparato | null {
  if (!id || !x || typeof x !== 'object' || Array.isArray(x)) return null;
  const o = x as Record<string, unknown>;
  const tipo = (TIPOS as readonly string[]).includes(String(o.tipo)) ? (o.tipo as TipoAparato) : null;
  if (!tipo) return null;
  const habilidades = Array.isArray(o.habilidades) ? [...new Set(o.habilidades.filter((h): h is string => typeof h === 'string' && /^[a-z_]{2,40}$/.test(h)))].slice(0, 40) : [];
  const permisos: Aparato['permisos'] = {};
  if (o.permisos && typeof o.permisos === 'object' && !Array.isArray(o.permisos)) {
    for (const [k, v] of Object.entries(o.permisos as Record<string, unknown>).slice(0, 12)) {
      if (/^[a-z_]{2,30}$/i.test(k) && (v === 'si' || v === 'no' || v === 'preguntar')) permisos[k] = v;
    }
  }
  const superficie = o.superficie === 'burbuja' ? 'burbuja' : o.superficie === 'mesa' ? 'mesa' : undefined;
  const version = corto(o.version, 24);
  return { id, tipo, ...(superficie ? { superficie } : {}), ...(version ? { version } : {}), habilidades, permisos, ultimoLatido: ahora };
}

const CACHE = new Map<string, { aparatos: Aparato[]; guardado: Map<string, { firma: string; t: number }> }>();
const llave = (correo: string) => String(correo || '').trim().toLowerCase();
const clave = (correo: string) => claveDe('aparatos', llave(correo), 'registro');
const firma = (a: Aparato) => JSON.stringify([a.tipo, a.superficie ?? null, a.version ?? null, a.habilidades, a.permisos]);

/** Anota un latido (en memoria siempre; en el almacén si cambió algo o pasó GUARDAR_CADA_MS). Nunca lanza. */
export async function anotarLatido(correo: string, a: Aparato, o: { almacen?: AlmacenDurable } = {}): Promise<{ guardado: boolean }> {
  const k = llave(correo);
  if (!k) return { guardado: false };
  const c = CACHE.get(k) || { aparatos: [], guardado: new Map() };
  c.aparatos = [...c.aparatos.filter((x) => x.id !== a.id), a].sort((x, y) => y.ultimoLatido - x.ultimoLatido).slice(0, MAX_APARATOS);
  CACHE.set(k, c);
  if (CACHE.size > 5_000) CACHE.delete(CACHE.keys().next().value as string);
  const previo = c.guardado.get(a.id);
  if (previo && previo.firma === firma(a) && a.ultimoLatido - previo.t < GUARDAR_CADA_MS) return { guardado: false };
  try {
    const r = await modificarDurable<Registro>(
      clave(k),
      (actual) => ({ v: 1, aparatos: [...(actual?.aparatos || []).filter((x) => x.id !== a.id), a].sort((x, y) => y.ultimoLatido - x.ultimoLatido).slice(0, MAX_APARATOS) }),
      o.almacen || almacenDurable()
    );
    if (r.ok) {
      c.guardado.set(a.id, { firma: firma(a), t: a.ultimoLatido });
      return { guardado: true };
    }
  } catch {
    /* el almacén no contestó: queda en memoria y el próximo latido lo intenta */
  }
  return { guardado: false };
}

/** Los aparatos de la cuenta: lo de memoria y, si no hay (un redespliegue), lo del almacén (a lo más `esperaMs`). */
export async function aparatosDe(correo: string, o: { almacen?: AlmacenDurable; esperaMs?: number } = {}): Promise<Aparato[]> {
  const k = llave(correo);
  if (!k) return [];
  const c = CACHE.get(k);
  if (c?.aparatos.length) return c.aparatos;
  let reloj: ReturnType<typeof setTimeout> | undefined;
  const tarde = new Promise<Aparato[]>((r) => (reloj = setTimeout(() => r([]), o.esperaMs ?? 250)));
  // La lectura sigue aunque el turno no la espere: el siguiente ya la encuentra en memoria.
  const leido = leerDurable<Registro>(clave(k), o.almacen || almacenDurable())
    .then((l) => {
      const aparatos = l.ok && l.valor ? l.valor.aparatos || [] : [];
      if (aparatos.length && !CACHE.get(k)?.aparatos.length) CACHE.set(k, { aparatos, guardado: new Map(aparatos.map((a) => [a.id, { firma: firma(a), t: a.ultimoLatido }])) });
      return aparatos;
    })
    .catch(() => [] as Aparato[]);
  try {
    return await Promise.race([leido, tarde]);
  } finally {
    clearTimeout(reloj);
  }
}

const NOMBRE_HABILIDAD: Record<string, string> = {
  abrir_apps: 'abrir apps',
  intents_telefono: 'alarmas, SMS y calendario del teléfono',
  recordatorio: 'recordatorios',
  llamame: 'llamarle',
  llamar: 'llamadas de AU-RA',
  marcar: 'marcador',
  leer: 'leer chats',
};

/**
 * La línea del turno: los aparatos EN LÍNEA y lo que saben (corta: va en cada turno). '' si no hay ninguno. `actual` es el
 * aparato del turno («este teléfono»).
 */
export function lineaAparatos(aparatos: readonly Aparato[], actual: string | null, ahora = Date.now()): string {
  const vivos = aparatos.filter((a) => ahora - a.ultimoLatido <= EN_LINEA_MS);
  if (!vivos.length) return '';
  const partes = vivos.slice(0, 3).map((a) => {
    const quien = a.id === actual ? 'este teléfono' : a.tipo === 'windows' ? 'su PC' : `otro ${a.tipo === 'android' || a.tipo === 'ios' ? 'teléfono' : a.tipo}`;
    const sabe = a.habilidades.map((h) => NOMBRE_HABILIDAD[h]).filter(Boolean).slice(0, 5);
    const sin = Object.entries(a.permisos)
      .filter(([, v]) => v === 'no')
      .map(([k]) => k)
      .slice(0, 3);
    return `${quien}${a.version ? ` (app ${a.version})` : ''}${sabe.length ? `: ${sabe.join(', ')}` : ''}${sin.length ? `; sin permiso de ${sin.join(', ')}` : ''}`;
  });
  return `APARATOS EN LÍNEA: ${partes.join(' | ')}.`.slice(0, 300);
}

/** Pruebas. */
export function _olvidarAparatos() {
  CACHE.clear();
}
