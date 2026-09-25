import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import type { SessionUser } from '../config';

const KEYS = {
  session: 'ultron_fp_session_v2',
  creds: 'ultron_fp_creds_v2',
  memory: 'ultron_fp_person_memory_v2',
  conocerProgress: 'ultron_fp_conocer_progress_v2',
  settings: 'ultron_fp_settings_v2',
  chatLog: 'ultron_fp_chat_log_v2',
  fingerprint: 'ultron_fp_fingerprint_v2',
  mesaToken: 'ultron_fp_mesa_token_v2',
} as const;

export type SavedCreds = { correo: string; clave: string; name?: string };
export type PersonFact = { key: string; value: string; at: string };
export type LocalPerson = {
  nombre: string;
  correo?: string;
  rol?: string;
  hechos: PersonFact[];
};
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

export async function loadLocalMemory(): Promise<LocalPerson[]> {
  try {
    const raw = await AsyncStorage.getItem(KEYS.memory);
    return raw ? (JSON.parse(raw) as LocalPerson[]) : [];
  } catch {
    return [];
  }
}

export async function upsertPersonFact(opts: {
  nombre: string;
  correo?: string;
  rol?: string;
  key: string;
  value: string;
}) {
  const all = await loadLocalMemory();
  let person = all.find(
    (p) =>
      p.nombre.toLowerCase() === opts.nombre.toLowerCase() ||
      (opts.correo && p.correo === opts.correo)
  );
  if (!person) {
    person = { nombre: opts.nombre, correo: opts.correo, rol: opts.rol, hechos: [] };
    all.push(person);
  }
  person.hechos = person.hechos.filter((h) => h.key !== opts.key);
  person.hechos.push({ key: opts.key, value: opts.value, at: new Date().toISOString() });
  if (opts.correo) person.correo = opts.correo;
  if (opts.rol) person.rol = opts.rol;
  await AsyncStorage.setItem(KEYS.memory, JSON.stringify(all));
  return person;
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
  const all = raw ? (JSON.parse(raw) as ConocerProgress[]) : [];
  const idx = all.findIndex((p) => p.correo === progress.correo);
  if (idx >= 0) all[idx] = progress;
  else all.push(progress);
  await AsyncStorage.setItem(KEYS.conocerProgress, JSON.stringify(all));
}

export async function appendChatLog(entry: { role: 'user' | 'ultron'; text: string }) {
  try {
    const raw = await AsyncStorage.getItem(KEYS.chatLog);
    const list = raw ? (JSON.parse(raw) as Array<{ role: string; text: string; at: string }>) : [];
    list.push({ ...entry, at: new Date().toISOString() });
    await AsyncStorage.setItem(KEYS.chatLog, JSON.stringify(list.slice(-200)));
  } catch {
    /* ignore */
  }
}

const LONG_MEMORY_KEY = 'ultron_fp_long_memory_v1';
export type LongFact = { hecho: string; at: string };

/** Memoria de largo plazo local (además de la del servidor): sobrevive a redeploys de Render. */
export async function loadLongMemory(): Promise<LongFact[]> {
  try {
    const raw = await AsyncStorage.getItem(LONG_MEMORY_KEY);
    return raw ? (JSON.parse(raw) as LongFact[]) : [];
  } catch {
    return [];
  }
}

export async function addLongFact(hecho: string) {
  const list = await loadLongMemory();
  const clean = hecho.trim();
  if (!clean) return list;
  const next = [{ hecho: clean, at: new Date().toISOString() }, ...list.filter((f) => f.hecho !== clean)].slice(0, 60);
  await AsyncStorage.setItem(LONG_MEMORY_KEY, JSON.stringify(next));
  return next;
}

export async function clearLongMemory() {
  await AsyncStorage.removeItem(LONG_MEMORY_KEY);
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
