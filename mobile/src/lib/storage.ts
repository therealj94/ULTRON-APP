import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import type { SessionUser } from '../config';
import {
  CLAVE_MEMORIA_COMPARTIDA,
  agregarHecho,
  claveMemoria,
  hechosValidos,
  migrarCompartida,
  type DuenoMemoria,
  type LongFact,
} from './memoriaUsuario';

export type { LongFact };

const KEYS = {
  session: 'ultron_fp_session_v2',
  creds: 'ultron_fp_creds_v2',
  conocerProgress: 'ultron_fp_conocer_progress_v2',
  settings: 'ultron_fp_settings_v2',
  fingerprint: 'ultron_fp_fingerprint_v2',
  mesaToken: 'ultron_fp_mesa_token_v2',
} as const;

/**
 * Lo que se escribía y nadie leía: el historial del chat (todos los usuarios juntos) y una ficha por
 * persona. Ya no se escriben; estas claves solo se nombran para borrar lo que quedó en el teléfono.
 */
const RASTROS_VIEJOS = ['ultron_fp_chat_log_v2', 'ultron_fp_person_memory_v2'];

export type SavedCreds = { correo: string; clave: string; name?: string };
export type SttEngine = 'native' | 'cloud';
export type AppSettings = {
  voiceId: string;
  micMuted: boolean;
  visionEnabled: boolean;
  gazeEnabled: boolean;
  /** Oído: reconocimiento del sistema en el teléfono o grabación + Scribe en el servidor. */
  sttEngine: SttEngine;
  /** Comentarios espontáneos de lo que ve la cámara. */
  proactive: boolean;
  /** Efectos de sonido al tocar. */
  sfx: boolean;
  /** Cómo contesta AU-RA en la sala: de pie en el centro o sentada en su sillón. */
  postura: 'pie' | 'sentada';
  /** Su cara: los anillos (Skia, la de siempre desde el 25-sep) o la habitación 3D. */
  cara: 'anillos' | 'sala';
};
export type ConocerProgress = {
  correo: string;
  answeredIds: string[];
  completedCore: boolean; // primeras 10
};

const DEFAULT_SETTINGS: AppSettings = {
  voiceId: 'ultron',
  micMuted: false,
  visionEnabled: true,
  gazeEnabled: true,
  sttEngine: 'native',
  proactive: true,
  sfx: true,
  postura: 'pie',
  cara: 'anillos',
};

export async function saveSession(user: SessionUser | null) {
  if (!user) {
    await AsyncStorage.removeItem(KEYS.session);
    return;
  }
  await AsyncStorage.setItem(KEYS.session, JSON.stringify(user));
}

export async function loadSession(): Promise<SessionUser | null> {
  try {
    const raw = await AsyncStorage.getItem(KEYS.session);
    return raw ? (JSON.parse(raw) as SessionUser) : null;
  } catch {
    return null;
  }
}

export async function saveCreds(creds: SavedCreds | null) {
  if (!creds) {
    await SecureStore.deleteItemAsync(KEYS.creds).catch(() => {});
    return;
  }
  await SecureStore.setItemAsync(KEYS.creds, JSON.stringify(creds));
}

export async function loadCreds(): Promise<SavedCreds | null> {
  try {
    const raw = await SecureStore.getItemAsync(KEYS.creds);
    return raw ? (JSON.parse(raw) as SavedCreds) : null;
  } catch {
    return null;
  }
}

export async function setFingerprintUnlock(enabled: boolean, correo?: string) {
  if (!enabled) {
    await AsyncStorage.removeItem(KEYS.fingerprint);
    return;
  }
  await AsyncStorage.setItem(KEYS.fingerprint, JSON.stringify({ enabled: true, correo: correo || '' }));
}

export async function getFingerprintUnlock(): Promise<{ enabled: boolean; correo: string } | null> {
  try {
    const raw = await AsyncStorage.getItem(KEYS.fingerprint);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export async function loadSettings(): Promise<AppSettings> {
  try {
    const raw = await AsyncStorage.getItem(KEYS.settings);
    const s: AppSettings = raw ? { ...DEFAULT_SETTINGS, ...JSON.parse(raw) } : DEFAULT_SETTINGS;
    s.voiceId = 'ultron';
    return s;
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export async function saveSettings(s: Partial<AppSettings>) {
  const cur = await loadSettings();
  await AsyncStorage.setItem(KEYS.settings, JSON.stringify({ ...cur, ...s }));
}

export async function loadConocerProgress(correo: string): Promise<ConocerProgress> {
  try {
    const raw = await AsyncStorage.getItem(KEYS.conocerProgress);
    const all = raw ? (JSON.parse(raw) as ConocerProgress[]) : [];
    return (
      all.find((p) => p.correo === correo) || {
        correo,
        answeredIds: [],
        completedCore: false,
      }
    );
  } catch {
    return { correo, answeredIds: [], completedCore: false };
  }
}

export async function saveConocerProgress(progress: ConocerProgress) {
  const raw = await AsyncStorage.getItem(KEYS.conocerProgress);
  let all: ConocerProgress[] = [];
  try {
    const leido = raw ? JSON.parse(raw) : [];
    if (Array.isArray(leido)) all = leido as ConocerProgress[];
  } catch {
    /* guardado roto: se empieza de nuevo en vez de lanzar en medio de la entrevista */
  }
  const idx = all.findIndex((p) => p.correo === progress.correo);
  if (idx >= 0) all[idx] = progress;
  else all.push(progress);
  await AsyncStorage.setItem(KEYS.conocerProgress, JSON.stringify(all));
}

/** Borra del teléfono las conversaciones viejas que se guardaban sin usarse (al entrar y al cerrar sesión). */
export async function borrarRastrosViejos() {
  try {
    await AsyncStorage.multiRemove(RASTROS_VIEJOS);
  } catch {
    /* se reintenta la próxima vez */
  }
}

function leerJson(raw: string | null): unknown {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/**
 * La lista compartida de antes (una para todos) se reparte una sola vez: quien entra se queda con los
 * hechos firmados con su nombre y el resto se descarta (ver memoriaUsuario.ts). Luego la clave se borra.
 */
async function migrarMemoriaCompartida(u: DuenoMemoria) {
  const vieja = await AsyncStorage.getItem(CLAVE_MEMORIA_COMPARTIDA);
  if (vieja === null) return;
  const clave = claveMemoria(u);
  const propia = leerJson(await AsyncStorage.getItem(clave));
  await AsyncStorage.setItem(clave, JSON.stringify(migrarCompartida(leerJson(vieja), propia, u.name)));
  await AsyncStorage.removeItem(CLAVE_MEMORIA_COMPARTIDA);
}

/**
 * Memoria de largo plazo local (además de la del servidor): sobrevive a redeploys de Render.
 * Es de UNA persona: el teléfono lo comparte la junta y a cada quien le llega solo lo suyo.
 */
export async function loadLongMemory(u: DuenoMemoria): Promise<LongFact[]> {
  try {
    await migrarMemoriaCompartida(u);
    return hechosValidos(leerJson(await AsyncStorage.getItem(claveMemoria(u))));
  } catch {
    return [];
  }
}

export async function addLongFact(u: DuenoMemoria, hecho: string) {
  const list = await loadLongMemory(u);
  const next = agregarHecho(list, hecho, new Date().toISOString());
  if (next === list) return list;
  await AsyncStorage.setItem(claveMemoria(u), JSON.stringify(next));
  return next;
}

/** «Olvidar»: borra solo la memoria de esta persona; la de los demás miembros no se toca. */
export async function clearLongMemory(u: DuenoMemoria) {
  await AsyncStorage.removeItem(claveMemoria(u));
}

export async function saveMesaToken(token: string | null) {
  if (!token) {
    await SecureStore.deleteItemAsync(KEYS.mesaToken).catch(() => {});
    return;
  }
  await SecureStore.setItemAsync(KEYS.mesaToken, token);
}

export async function loadMesaToken(): Promise<string> {
  try {
    return (await SecureStore.getItemAsync(KEYS.mesaToken)) || '';
  } catch {
    return '';
  }
}
