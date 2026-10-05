/**
 * LAS FOTOS DE WHATSAPP EN EL TELÉFONO: la de perfil de cada chat y la foto, el sticker, la nota de voz
 * o el video de cada mensaje.
 *
 * Por qué así (José, 2-oct: «las fotos no cargan»): antes la foto entera se pedía con
 * `<Image source={{ uri, headers }}>` y el token de la sesión leído una vez. Cuando ese token vencía
 * el servidor contestaba 401 y la imagen quedaba en blanco, sin aviso ni reintento (api() renueva el
 * token ante un 401; <Image> no). Y si el mensaje no traía miniatura, no había nada que tocar: la
 * foto nunca se pedía.
 *
 * Ahora todo se baja con la sesión a un archivo del caché (expo-file-system): ante un 401 se renueva
 * la sesión como lo hace api() y se reintenta una vez; lo que el servidor no pudo traer vuelve con su
 * razón para decirla en la burbuja. Lo bajado se guarda en memoria y en disco, así la lista no vuelve
 * a pedir las fotos en cada vuelta, y salen pocas a la vez.
 *
 * Revisión del 5-oct: el caché es de UNA cuenta. En disco va en `whatsapp/<seudónimo de la cuenta>/` (logica.ts
 * dirCacheWA) y en memoria se suelta al cambiar de cuenta; al salir (o al entrar otra persona) se borra lo de las
 * demás (lib/cuenta.ts alCambiarCuenta). Antes iba sin cuenta: en un teléfono compartido, la foto de un chat de A
 * podía salirle a B con el mismo chat.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import * as FS from 'expo-file-system/legacy';
import { api, sessionHeaders } from '../lib/api';
import { API_BASE } from '../config';
import { idiomaActual } from '../i18n';
import { alCambiarCuenta, generacionCuenta, seudonimoActual, sigueVigente } from '../lib/cuenta';
import * as API from './api';
import { archivoCache, archivoFoto, colaLimitada, dirCacheWA, entradasAjenasWA, mensajeErrorMedia, type MensajeWA } from './logica';

export class ErrorMedia extends Error {
  constructor(
    msg: string,
    public status: number
  ) {
    super(msg);
  }
}

/** `<caché>whatsapp/`: adentro, una carpeta por cuenta. '' sin caché en disco (la web). */
const RAIZ = FS.cacheDirectory ? `${FS.cacheDirectory}whatsapp/` : '';
/** La carpeta de quien está dentro ('' en la web o sin nadie: entonces nada va a disco). */
const dirActual = () => dirCacheWA(FS.cacheDirectory, seudonimoActual());

const borrar = (uri: string) => FS.deleteAsync(uri, { idempotent: true }).catch(() => {});

/** Se borra lo de las demás cuentas (y lo de antes de esta revisión, que iba sin cuenta); nada se crea mientras tanto. */
let limpiando: Promise<void> = Promise.resolve();
let limpioAlArrancar = false;
function limpiarAjenas() {
  if (!RAIZ) return;
  const quien = seudonimoActual();
  limpiando = limpiando.then(async () => {
    const entradas = await FS.readDirectoryAsync(RAIZ).catch(() => [] as string[]);
    await Promise.all(entradasAjenasWA(entradas, quien).map((e) => borrar(RAIZ + e)));
  });
}

let dirListo: { dir: string; listo: Promise<void> } | null = null;
function asegurarDir(dir: string): Promise<void> {
  if (!dir) return Promise.resolve();
  if (!limpioAlArrancar) {
    limpioAlArrancar = true;
    limpiarAjenas();
  }
  if (dirListo?.dir !== dir) dirListo = { dir, listo: limpiando.then(() => FS.makeDirectoryAsync(dir, { intermediates: true })).catch(() => {}) };
  return dirListo.listo;
}

// Salir o entrar otra persona: lo que se tenía en memoria era de la anterior, y lo suyo en disco se borra.
alCambiarCuenta(() => {
  MEDIA.clear();
  MEDIA_EN_VUELO.clear();
  FOTOS.clear();
  FOTOS_EN_VUELO.clear();
  dirListo = null;
  limpioAlArrancar = true;
  limpiarAjenas();
});

/**
 * Renueva la sesión igual que api(): una pregunta con sesión que, si el token murió, contesta 401 y
 * api() lo renueva con la clave guardada y reintenta. Una sola renovación en vuelo.
 */
let renovando: Promise<boolean> | null = null;
function renovarSesion(): Promise<boolean> {
  if (renovando) return renovando;
  const p = api('/api/whatsapp/estado', { method: 'GET' }, 15_000).then(
    () => true,
    () => false
  );
  renovando = p;
  void p.finally(() => {
    if (renovando === p) renovando = null;
  });
  return p;
}

/** Lo que el servidor dijo al fallar (un JSON corto con `error`). */
async function leerError(uri: string): Promise<string> {
  try {
    const info = await FS.getInfoAsync(uri);
    if (!info.exists || (info.size || 0) > 32_000) return '';
    const t = await FS.readAsStringAsync(uri);
    return String(JSON.parse(t)?.error || '');
  } catch {
    return '';
  }
}

function conTope<T>(p: Promise<T>, ms: number, alVencer: () => void): Promise<T> {
  return new Promise<T>((listo, falla) => {
    const t = setTimeout(() => {
      alVencer();
      falla(new ErrorMedia('tiempo', 0));
    }, ms);
    p.then(
      (v) => {
        clearTimeout(t);
        listo(v);
      },
      (e) => {
        clearTimeout(t);
        falla(e);
      }
    );
  });
}

/** Baja `ruta` (del servidor) a `destino` (en la carpeta `dir` de la cuenta) con la sesión; ante un 401 renueva y reintenta una vez. */
async function bajarArchivo(ruta: string, dir: string, destino: string, topeMs: number, soloImagen = false): Promise<string> {
  await asegurarDir(dir);
  for (let intento = 0; ; intento++) {
    const headers: Record<string, string> = { Accept: '*/*', ...(await sessionHeaders()) };
    const parte = `${destino}.${Date.now()}-${intento}.parte`;
    const tarea = FS.createDownloadResumable(`${API_BASE}${ruta}`, parte, { headers });
    let r: FS.FileSystemDownloadResult | undefined;
    try {
      r = await conTope(tarea.downloadAsync(), topeMs, () => void tarea.cancelAsync().catch(() => {}));
    } catch (e: any) {
      await borrar(parte);
      throw e instanceof ErrorMedia ? e : new ErrorMedia(String(e?.message || 'red'), 0);
    }
    if (!r) {
      await borrar(parte);
      throw new ErrorMedia('cancelada', 0);
    }
    const tipo = String(Object.entries(r.headers || {}).find(([k]) => k.toLowerCase() === 'content-type')?.[1] || '');
    if (r.status >= 200 && r.status < 300 && soloImagen && tipo && !/^image\//i.test(tipo)) {
      // Un 200 que no es una imagen (una página, un JSON): no se guarda como foto.
      await borrar(parte);
      throw new ErrorMedia(`no es una imagen (${tipo.slice(0, 40)})`, 415);
    }
    if (r.status >= 200 && r.status < 300) {
      await borrar(destino);
      await FS.moveAsync({ from: parte, to: destino });
      return destino;
    }
    const msg = await leerError(parte);
    await borrar(parte);
    if (r.status === 401 && intento === 0 && (await renovarSesion())) continue;
    throw new ErrorMedia(msg || `HTTP ${r.status}`, r.status);
  }
}

/** Sin caché en disco (la web): con fetch y la sesión, como una dirección «data:». */
async function bajarDataUri(ruta: string, topeMs: number): Promise<string> {
  for (let intento = 0; ; intento++) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), topeMs);
    try {
      let res: Response;
      try {
        res = await fetch(`${API_BASE}${ruta}`, { headers: await sessionHeaders(), signal: ctrl.signal });
      } catch (e: any) {
        throw new ErrorMedia(String(e?.message || 'red'), 0);
      }
      if (!res.ok) {
        const j: any = await res.json().catch(() => ({}));
        if (res.status === 401 && intento === 0 && (await renovarSesion())) continue;
        throw new ErrorMedia(String(j?.error || `HTTP ${res.status}`), res.status);
      }
      const blob = await res.blob();
      return await new Promise<string>((listo, falla) => {
        const fr = new FileReader();
        fr.onload = () => listo(String(fr.result || ''));
        fr.onerror = () => falla(new ErrorMedia('lectura', 0));
        fr.readAsDataURL(blob);
      });
    } finally {
      clearTimeout(t);
    }
  }
}

/* ── la foto, el audio o el video de un mensaje ───────────────────────────────────────────── */

/** Una foto vieja puede tardar: el puente le pide al teléfono que la vuelva a subir (hasta ~80 s). */
const MEDIA_TOPE_MS = 90_000;
const MEDIA = new Map<string, string>();
const MEDIA_EN_VUELO = new Map<string, Promise<string>>();
const colaMedia = colaLimitada(3);
const claveMedia = (m: Pick<MensajeWA, 'chat' | 'id'>) => `${m.chat}|${m.id}`;

export function mediaEnMemoria(m: Pick<MensajeWA, 'chat' | 'id'>): string | null {
  return MEDIA.get(claveMedia(m)) || null;
}

/** La dirección local del archivo del mensaje (lo baja si no está en el caché). */
export function bajarMedia(m: Pick<MensajeWA, 'chat' | 'id' | 'tipo' | 'archivo'>): Promise<string> {
  const clave = claveMedia(m);
  const ya = MEDIA.get(clave);
  if (ya) return Promise.resolve(ya);
  let p = MEDIA_EN_VUELO.get(clave);
  if (p) return p;
  const gen = generacionCuenta();
  const dir = dirActual();
  p = colaMedia(async () => {
    if (!dir) return bajarDataUri(API.rutaMedia(m.chat, m.id), MEDIA_TOPE_MS);
    const destino = dir + archivoCache(m.chat, m.id, m.tipo, m.archivo);
    await asegurarDir(dir);
    const info = await FS.getInfoAsync(destino).catch(() => null);
    if (info?.exists && (info.size || 0) > 0) return destino;
    return bajarArchivo(API.rutaMedia(m.chat, m.id), dir, destino, MEDIA_TOPE_MS);
  }).then((uri) => {
    // Si mientras bajaba salió (o entró otra persona), no queda ni en la memoria ni en el disco de la cuenta nueva.
    if (sigueVigente(gen)) MEDIA.set(clave, uri);
    else if (RAIZ && uri.startsWith(RAIZ)) void borrar(uri);
    return uri;
  });
  MEDIA_EN_VUELO.set(clave, p);
  void p.then(
    () => MEDIA_EN_VUELO.delete(clave),
    () => MEDIA_EN_VUELO.delete(clave)
  );
  return p;
}

export type EstadoMedia = { uri: string | null; cargando: boolean; error: string; status: number };

/** El archivo de un mensaje para dibujarlo: se baja solo (`auto`) o al tocar (`cargar`). `lento`: lleva rato (se la está pidiendo al teléfono). */
export function useMediaWA(m: MensajeWA, auto: boolean): EstadoMedia & { cargar: () => Promise<string | null>; lento: boolean } {
  const [st, setSt] = useState<EstadoMedia>(() => ({ uri: mediaEnMemoria(m), cargando: false, error: '', status: 0 }));
  const [lento, setLento] = useState(false);
  useEffect(() => {
    if (!st.cargando) return setLento(false);
    const t = setTimeout(() => setLento(true), 6_000);
    return () => clearTimeout(t);
  }, [st.cargando]);
  const vivo = useRef(true);
  useEffect(() => {
    vivo.current = true;
    return () => {
      vivo.current = false;
    };
  }, []);
  const clave = claveMedia(m);
  const cargar = useCallback(async (): Promise<string | null> => {
    if (!m.conMedia) return null;
    setSt((s) => ({ ...s, cargando: true, error: '', status: 0 }));
    try {
      const uri = await bajarMedia(m);
      if (vivo.current) setSt({ uri, cargando: false, error: '', status: 0 });
      return uri;
    } catch (e: any) {
      const status = Number(e?.status) || 0;
      if (vivo.current) setSt({ uri: null, cargando: false, error: mensajeErrorMedia(status, e?.message, idiomaActual() === 'en' ? 'en' : 'es', m.tipo), status });
      return null;
    }
  }, [clave, m.conMedia]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (auto && m.conMedia && !st.uri && !st.cargando && !st.error) void cargar();
  }, [clave, auto]); // eslint-disable-line react-hooks/exhaustive-deps
  return { ...st, cargar, lento };
}

/* ── las fotos de perfil ──────────────────────────────────────────────────────────────────── */

type Foto = { uri: string | null; cuando: number };
const FOTOS = new Map<string, Foto>();
const FOTOS_EN_VUELO = new Map<string, Promise<string | null>>();
const colaFotos = colaLimitada(4);
/** Una foto vale un día en disco y seis horas en memoria; «no tiene» se vuelve a preguntar a la media hora. */
const DISCO_VIVE_S = 24 * 3600;
const MEMORIA_VIVE_MS = 6 * 3600_000;
const SIN_FOTO_VIVE_MS = 30 * 60_000;
const FALLO_VIVE_MS = 2 * 60_000;

function fotoVigente(jid: string): Foto | null {
  const f = FOTOS.get(jid);
  if (!f) return null;
  const vive = f.uri ? MEMORIA_VIVE_MS : f.cuando < 0 ? FALLO_VIVE_MS : SIN_FOTO_VIVE_MS;
  return Date.now() - Math.abs(f.cuando) < vive ? f : null;
}

/** La foto de perfil ya conocida: la dirección, null si no tiene, undefined si no se sabe todavía. */
export function fotoEnMemoria(jid: string): string | null | undefined {
  const f = fotoVigente(jid);
  return f ? f.uri : undefined;
}

export function pedirFoto(jid: string): Promise<string | null> {
  const f = fotoVigente(jid);
  if (f) return Promise.resolve(f.uri);
  let p = FOTOS_EN_VUELO.get(jid);
  if (p) return p;
  const gen = generacionCuenta();
  const dir = dirActual();
  // Solo en la memoria de la cuenta que la pidió (si salió mientras tanto, se descarta).
  const anotar = (f: Foto) => {
    if (sigueVigente(gen)) FOTOS.set(jid, f);
    else if (f.uri && RAIZ && f.uri.startsWith(RAIZ)) void borrar(f.uri);
  };
  p = colaFotos(async (): Promise<string | null> => {
    if (!dir) {
      try {
        const uri = await bajarDataUri(API.rutaFoto(jid), 20_000);
        anotar({ uri, cuando: Date.now() });
        return uri;
      } catch (e: any) {
        const no = [400, 403, 404, 413, 415].includes(Number(e?.status));
        anotar({ uri: null, cuando: no ? Date.now() : -Date.now() });
        return null;
      }
    }
    const destino = dir + archivoFoto(jid);
    await asegurarDir(dir);
    const info = await FS.getInfoAsync(destino).catch(() => null);
    const hay = !!info?.exists && ((info as any).size || 0) > 0;
    if (hay && Date.now() / 1000 - Number((info as any).modificationTime || 0) < DISCO_VIVE_S) {
      anotar({ uri: destino, cuando: Date.now() });
      return destino;
    }
    try {
      await bajarArchivo(API.rutaFoto(jid), dir, destino, 20_000, true);
      anotar({ uri: destino, cuando: Date.now() });
      return destino;
    } catch (e: any) {
      if (e?.status === 404 || e?.status === 400 || e?.status === 403 || e?.status === 413 || e?.status === 415) {
        // Ya no tiene foto (o la quitó): se borra la vieja.
        if (hay) await borrar(destino);
        anotar({ uri: null, cuando: Date.now() });
        return null;
      }
      // Sin red o el servidor no pudo: la vieja sirve; si no hay, se vuelve a probar en un rato.
      anotar(hay ? { uri: destino, cuando: Date.now() } : { uri: null, cuando: -Date.now() });
      return hay ? destino : null;
    }
  });
  FOTOS_EN_VUELO.set(jid, p);
  void p.then(
    () => FOTOS_EN_VUELO.delete(jid),
    () => FOTOS_EN_VUELO.delete(jid)
  );
  return p;
}

/**
 * La foto de perfil de un chat (null mientras carga o si no tiene: van las iniciales). `tiene`: lo que
 * dice el servidor (false: no tiene, no se pide; true o null: se pide).
 */
export function useFotoPerfil(jid: string, tiene: boolean | null = null): string | null {
  const [uri, setUri] = useState<string | null>(() => (tiene === false ? null : (fotoEnMemoria(jid) ?? null)));
  useEffect(() => {
    let vivo = true;
    if (tiene === false || !jid) {
      setUri(null);
      return;
    }
    const ya = fotoEnMemoria(jid);
    if (ya !== undefined) {
      setUri(ya);
      return;
    }
    setUri(null);
    pedirFoto(jid)
      .then((u) => vivo && setUri(u))
      .catch(() => {});
    return () => {
      vivo = false;
    };
  }, [jid, tiene]);
  return uri;
}

/** Si una foto guardada no abre (archivo roto), se olvida para volver a bajarla. */
export function olvidarFoto(jid: string) {
  const f = FOTOS.get(jid);
  FOTOS.set(jid, { uri: null, cuando: -Date.now() });
  if (f?.uri && RAIZ && f.uri.startsWith(RAIZ)) void borrar(f.uri);
}

export function olvidarMedia(m: Pick<MensajeWA, 'chat' | 'id'>) {
  const k = claveMedia(m);
  const u = MEDIA.get(k);
  MEDIA.delete(k);
  if (u && RAIZ && u.startsWith(RAIZ)) void borrar(u);
}
