/**
 * Catálogo de capacidades — copia cliente de los tipos de lib/capacidades.ts del servidor.
 * GET /api/capacidades devuelve la lista real con `vivo` según la salud de cada nodo. Se cachea en
 * AsyncStorage para poder enseñarla sin red.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { api } from './api';

export type GrupoCapacidad = 'herramientas' | 'voz' | 'personalidad' | 'gestos' | 'canales' | 'memoria';

export type Capacidad = {
  id: string;
  /** Grupo conocido, o uno nuevo que el servidor añada (se pinta igual). */
  grupo: GrupoCapacidad | (string & {});
  titulo: string;
  detalle: string;
  /** Frases de ejemplo que la disparan (voz o texto). */
  ejemplos: string[];
  /** true = responde ahora; false = falta clave o nodo caído; null = no se mide. */
  vivo: boolean | null;
  falta?: string;
  /** Solo web / solo APK / ambas. */
  donde: 'web' | 'apk' | 'ambas';
};

export type VozOficial = {
  id: string;
  nombre: string;
  motor: string;
  timbre: string;
  respaldo: string;
  expresividad: string[];
};

export type CapacidadesPayload = {
  honesto: boolean;
  voz: VozOficial;
  modos: Array<{ id: string; etiqueta: string; tono: string }>;
  canciones: Array<{ id: string; titulo: string; artista: string; pedir: string }>;
  gestos: Array<{ id: string; zona: string; hace: string }>;
  capacidades: Capacidad[];
};

export const GRUPOS: Record<GrupoCapacidad, string> = {
  herramientas: 'Herramientas',
  voz: 'Voz y oído',
  personalidad: 'Personalidad',
  gestos: 'Gestos y tacto',
  canales: 'Canales',
  memoria: 'Memoria',
};

export const GRUPO_ORDEN: GrupoCapacidad[] = ['herramientas', 'voz', 'personalidad', 'gestos', 'canales', 'memoria'];

const CACHE_KEY = 'ultron_fp_capacidades_v1';

export type CapacidadesCache = { payload: CapacidadesPayload; at: string };

export async function loadCapacidadesCache(): Promise<CapacidadesCache | null> {
  try {
    const raw = await AsyncStorage.getItem(CACHE_KEY);
    return raw ? (JSON.parse(raw) as CapacidadesCache) : null;
  } catch {
    return null;
  }
}

function esPayload(x: any): x is CapacidadesPayload {
  return !!x && Array.isArray(x.capacidades) && x.capacidades.every((c: any) => c && typeof c.id === 'string' && typeof c.grupo === 'string');
}

/** Baja el catálogo; si falla, devuelve el último cacheado (con `offline: true`). */
export async function fetchCapacidades(): Promise<{ payload: CapacidadesPayload; offline: boolean; at: string } | null> {
  try {
    const data = await api<CapacidadesPayload>('/api/capacidades', { method: 'GET' }, 12_000);
    if (!esPayload(data)) throw new Error('payload inválido');
    const at = new Date().toISOString();
    await AsyncStorage.setItem(CACHE_KEY, JSON.stringify({ payload: data, at } satisfies CapacidadesCache)).catch(() => {});
    return { payload: data, offline: false, at };
  } catch {
    const cached = await loadCapacidadesCache();
    return cached ? { payload: cached.payload, offline: true, at: cached.at } : null;
  }
}

/** Agrupa en el orden conocido; un grupo nuevo del servidor se añade al final con su id como título. */
export function agrupar(caps: Capacidad[]): Array<{ grupo: string; titulo: string; items: Capacidad[] }> {
  const orden: string[] = [...GRUPO_ORDEN];
  for (const c of caps) if (!orden.includes(c.grupo)) orden.push(c.grupo);
  return orden
    .map((grupo) => ({
      grupo,
      titulo: (GRUPOS as Record<string, string>)[grupo] || grupo.charAt(0).toUpperCase() + grupo.slice(1),
      items: caps.filter((c) => c.grupo === grupo && c.donde !== 'web'),
    }))
    .filter((g) => g.items.length);
}
