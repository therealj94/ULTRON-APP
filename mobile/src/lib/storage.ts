import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import type { SessionUser } from '../config';

const KEYS = {
  session: 'ultron_fp_session_v2',
  creds: 'ultron_fp_creds_v2',
  memory: 'ultron_fp_person_memory_v2',
  conocerDay: 'ultron_fp_conocer_day',
  settings: 'ultron_fp_settings_v2',
  chatLog: 'ultron_fp_chat_log_v2',
} as const;

export type SavedCreds = { correo: string; clave: string; name?: string };
export type PersonFact = { key: string; value: string; at: string };
export type LocalPerson = {
  nombre: string;
  correo?: string;
  rol?: string;
  hechos: PersonFact[];
};
export type AppSettings = {
  voiceId: string;
  micEnabled: boolean;
  visionEnabled: boolean;
  autoListen: boolean;
};

const DEFAULT_SETTINGS: AppSettings = {
  voiceId: 'jarvis',
  micEnabled: true,
  visionEnabled: true,
  autoListen: true,
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

export async function loadSettings(): Promise<AppSettings> {
  try {
    const raw = await AsyncStorage.getItem(KEYS.settings);
    return raw ? { ...DEFAULT_SETTINGS, ...JSON.parse(raw) } : DEFAULT_SETTINGS;
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

export async function loadChatLog() {
  try {
    const raw = await AsyncStorage.getItem(KEYS.chatLog);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export async function markConocerOfferedToday() {
  const day = new Date().toISOString().slice(0, 10);
  await AsyncStorage.setItem(KEYS.conocerDay, day);
}

export async function wasConocerOfferedToday() {
  const day = new Date().toISOString().slice(0, 10);
  const prev = await AsyncStorage.getItem(KEYS.conocerDay);
  return prev === day;
}
