import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import type { SessionUser } from '../config';
import { normalizarAvatarId, type AvatarId } from '../avatares/catalogo';
import { normalizarIdioma, type Idioma } from '../i18n';
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
  vozHoy: 'ultron_fp_voz_hoy_v1',
} as const;

/** Los minutos de llamada de hoy (en este teléfono): lo que se ve junto al estado de la llamada. */
export type VozHoy = { dia: string; ms: number };

export async function loadVozHoy(dia: string): Promise<number> {
  try {
    const raw = await AsyncStorage.getItem(KEYS.vozHoy);
    const v = raw ? (JSON.parse(raw) as VozHoy) : null;
    return v && v.dia === dia && Number.isFinite(v.ms) ? Math.max(0, v.ms) : 0;
  } catch {
    return 0;
  }
}

export async function saveVozHoy(v: VozHoy) {
  try {
    await AsyncStorage.setItem(KEYS.vozHoy, JSON.stringify(v));
  } catch {
    /* sin almacenamiento: se cuenta en memoria */
  }
}

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
  /** Oído: reconocimiento del sistema en el teléfono o grabación + Whisper en el servidor propio. */
  sttEngine: SttEngine;
  /** Comentarios espontáneos de lo que ve la cámara. */
  proactive: boolean;
  /** Efectos de sonido al tocar. */
  sfx: boolean;
  /** Su cara: el orbe de partículas (desde el 2-oct) o los anillos (Skia). «sala» quedó de antes: es el orbe. */
  cara: 'orbe' | 'anillos' | 'sala';
  /** La persona eligió su cara en Ajustes (los «anillos» guardados por omisión antes del orbe no cuentan). */
  caraElegida?: boolean;
  /** Con quién se habla en la mesa: el Guardián (ojos celestes), AU-RA (la dorada) o Claudio. Se elige al entrar. */
  avatar: AvatarId;
  /** Ya eligió avatar alguna vez. */
  avatarElegido: boolean;
  /** Idioma de la interfaz, de la voz y de las respuestas. Se elige en la entrada. */
  idioma: Idioma;
  /**
   * Quién eligió la cámara «siempre» (por correo). Nadie más la tiene encendida al entrar: desde la OTA de la mesa
   * arranca APAGADA (lib/camaraModo.ts). `visionEnabled` ya no la enciende.
   */
  camaraSiempre: Record<string, boolean>;
  /** Quién activó el reconocimiento de caras (por correo → cuándo). Sin esto no se analiza ninguna cara. */
  carasActivas: Record<string, number>;
  /** Quién ya vio (o saltó para siempre) el recorrido de primera vez (por correo). */
  tutorialVisto: Record<string, boolean>;
  /** Qué versión del recorrido vio cada quien (por correo; tutorial/pasos.ts VERSION_RECORRIDO). */
  recorridoVisto: Record<string, number>;
  /** Cuántas veces dijo «Después» a la ventana del recorrido (por correo): pasado el tope ya no se ofrece sola. */
  recorridoPospuesto: Record<string, number>;
  /** La mesa para charlar (avatar grande) o para trabajar (avatar compacto + la conversación escrita). */
  modoMesa: 'charlar' | 'trabajar';
  /**
   * El interruptor del modo llamada anterior (espera con el nombre del avatar). Ya no se usa: la llamada
   * del avatar se pide con «llámame» (compa/llamadaCiclo.ts). Queda para no romper lo guardado.
   */
  vozLlamada: boolean;
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
  cara: 'orbe',
  avatar: 'aura',
  avatarElegido: false,
  idioma: 'es',
  camaraSiempre: {},
  carasActivas: {},
  tutorialVisto: {},
  recorridoVisto: {},
  recorridoPospuesto: {},
  modoMesa: 'charlar',
  vozLlamada: true,
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
    s.avatar = normalizarAvatarId(s.avatar);
    s.idioma = normalizarIdioma(s.idioma);
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
