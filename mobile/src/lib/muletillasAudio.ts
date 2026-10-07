/**
 * LOS CLIPS DE LAS MULETILLAS con la MISMA voz del avatar de la mesa (lib/asentir.ts). No hay nada grabado en la APK:
 * la primera vez que hacen falta para un avatar y un idioma se piden por GET /api/tts (la ruta de voz de siempre, con
 * la voz del avatar; no se crea ni se toca ninguna voz) y se guardan en el disco del teléfono
 * (documentDirectory/asentir-v1/, no en la caché que lib/tts.ts limpia al arrancar). Después se cargan de ahí.
 *
 * Solo se guarda un clip si:
 *  · lo hizo ElevenLabs (cabecera X-Ultron-TTS): la voz de respaldo (Voicebox, un miembro sin minutos) suena distinta
 *    a la de la mesa y un «mjm» con otra voz delata la máquina;
 *  · dura menos de MAX_CLIP_MS: un «mjm» que la voz leyó como «eme jota eme» o con algo agregado no es un murmullo.
 * Lo que falla se vuelve a intentar en la próxima sesión (una vez por sesión, para no gastar voz en bucle).
 */
import * as FileSystem from 'expo-file-system/legacy';
import { renovarTokenVoz, sessionHeaders, ttsUrl } from './api';
import { MAX_CLIP_MS, VOLUMEN_ASENTIR, frasesAsentir, textoParaVoz } from './asentir';
import { callarClipEfecto, cargarClipEfecto, soltarClipEfecto, sonarClipEfecto, type ClipEfecto } from './sfx';

const CARPETA = 'asentir-v1/';

/** Los clips cargados del avatar e idioma de ahora (palabra → clip). */
let clips = new Map<string, ClipEfecto>();
let clave = '';
let sonando: ClipEfecto | null = null;
/** Lo que ya se intentó bajar en esta sesión (avatar|idioma|palabra) y no quedó. */
const intentadas = new Set<string>();
let preparando: Promise<number> | null = null;

function cabecera(h: unknown, nombre: string): string {
  if (!h || typeof h !== 'object') return '';
  const n = nombre.toLowerCase();
  for (const [k, v] of Object.entries(h as Record<string, unknown>)) if (k.toLowerCase() === n) return String(v ?? '');
  return '';
}

const nombreDe = (frase: string) =>
  frase
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]/gi, '')
    .toLowerCase();

async function existente(base: string): Promise<string | null> {
  for (const ext of ['mp3', 'wav']) {
    const ruta = `${base}.${ext}`;
    const info = await FileSystem.getInfoAsync(ruta).catch(() => null);
    if (info?.exists && (info.size || 0) > 64) return ruta;
  }
  return null;
}

/** Baja la palabra con la voz del avatar; la ruta guardada, o null si no sirve (ver la cabecera). */
async function bajar(base: string, frase: string, avatar: string, idioma: 'es' | 'en'): Promise<string | null> {
  const tmp = `${base}.tmp`;
  try {
    const url = ttsUrl(textoParaVoz(frase), 'speak', 'neutral', avatar, idioma);
    let r = await FileSystem.downloadAsync(url, tmp, { headers: { Accept: 'audio/*', ...(await sessionHeaders()) } });
    // Sin una sesión viva el servidor solo da lo ya guardado: con el token vencido, se renueva una vez y se repite.
    if (r.status === 401 && (await renovarTokenVoz())) r = await FileSystem.downloadAsync(url, tmp, { headers: { Accept: 'audio/*', ...(await sessionHeaders()) } });
    const ct = cabecera(r.headers, 'Content-Type');
    const motor = cabecera(r.headers, 'X-Ultron-TTS');
    if (r.status !== 200 || !/audio|octet/i.test(ct) || !/^elevenlabs/i.test(motor)) throw new Error('no sirve');
    const ruta = `${base}.${/wav/i.test(ct) ? 'wav' : 'mp3'}`;
    await FileSystem.moveAsync({ from: tmp, to: ruta });
    return ruta;
  } catch {
    await FileSystem.deleteAsync(tmp, { idempotent: true }).catch(() => {});
    return null;
  }
}

/**
 * Deja listos los clips del avatar e idioma (los baja si faltan, una vez). Devuelve cuántas palabras tienen clip.
 * Cambiar de avatar o de idioma suelta los anteriores.
 */
export function prepararMuletillas(avatar: string, idioma: 'es' | 'en'): Promise<number> {
  const k = `${avatar}|${idioma}`;
  if (k === clave && preparando) return preparando;
  clave = k;
  const viejos = clips;
  clips = new Map();
  for (const c of viejos.values()) soltarClipEfecto(c);
  const esta = (async () => {
    const dir = FileSystem.documentDirectory;
    if (!dir) return 0;
    await FileSystem.makeDirectoryAsync(`${dir}${CARPETA}`, { intermediates: true }).catch(() => {});
    const listas = new Map<string, ClipEfecto>();
    for (const frase of frasesAsentir(idioma)) {
      const base = `${dir}${CARPETA}${avatar}-${idioma}-${nombreDe(frase)}`;
      const id = `${k}|${frase}`;
      let ruta = await existente(base);
      if (!ruta && !intentadas.has(id)) {
        intentadas.add(id);
        ruta = await bajar(base, frase, avatar, idioma);
      }
      if (!ruta || clave !== k) continue;
      const clip = await cargarClipEfecto(ruta, VOLUMEN_ASENTIR);
      if (!clip) continue;
      if (clip.ms > MAX_CLIP_MS) {
        // No es un murmullo: se borra para pedirlo otra vez en otra sesión (la voz puede leerlo bien la próxima).
        soltarClipEfecto(clip);
        await FileSystem.deleteAsync(ruta, { idempotent: true }).catch(() => {});
        continue;
      }
      listas.set(frase, clip);
    }
    if (clave !== k) {
      for (const c of listas.values()) soltarClipEfecto(c);
      return 0;
    }
    clips = listas;
    return listas.size;
  })();
  preparando = esta;
  return esta;
}

/** Cuánto dura el clip de la palabra (ms) con la voz de ahora; null si no hay. */
export function duracionMuletilla(frase: string): number | null {
  return clips.get(frase)?.ms ?? null;
}

/** La hace sonar por el canal de efectos (lib/sfx.ts). false si no hay clip o no puede sonar ahora. */
export function sonarMuletilla(frase: string): boolean {
  const c = clips.get(frase);
  if (!c || !sonarClipEfecto(c)) return false;
  sonando = c;
  return true;
}

export function callarMuletilla() {
  if (sonando) callarClipEfecto(sonando);
  sonando = null;
}
