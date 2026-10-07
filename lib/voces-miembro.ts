/**
 * LAS VOCES QUE CONOCE AURA, POR PERSONA (reconocer quién habla, con permiso: mobile/src/voces).
 *
 * Igual que las caras (lib/caras-miembro.ts), lo que se guarda son NÚMEROS: por cada persona, hasta
 * `MAX_MUESTRAS` huellas de 192 números que saca el motor (lib/voces-motor.ts) de unos segundos de su
 * voz. Nunca el audio: llega, se convierte en números y se descarta en la misma petición.
 *
 *   · un cajón por CORREO del dueño (el de la sesión firmada): las voces de alguien no entran a la
 *     memoria de la junta, ni a los hechos compartidos, ni al prompt de nadie;
 *   · `relacion: 'yo'` es la voz de la dueña (la pidió ella, «aprende mi voz»); `'conocido'` es alguien de
 *     su círculo que ella presentó y que dijo que sí en voz alta: se guarda la frase como constancia, y el
 *     parentesco si lo dijo («mi esposa Ana»);
 *   · se borra de verdad: una persona («olvida la voz de Ana»), la propia («olvida mi voz») o todas.
 *
 * Se guarda como las caras: caché del proceso, disco (`data/voces/`, o ULTRON_VOCES_DIR) y S3
 * (`ultron/voces/<huella>.json`). Si S3 no contesta al leer, NO se escribe encima: `VocesNoDisponibles`.
 * El cajón lleva el modelo con el que se sacaron las huellas: si el modelo cambia, las de antes no se
 * pueden comparar con las nuevas y se descartan (hay que volver a presentarse).
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { s3GetJson, s3GetJsonConEtag, s3ListarClaves, s3Listo, s3PutJson, s3PutJsonCondicional } from './s3';
import { MODELO_VOZ, similitud } from './voces-motor';
import { filaPorCuenta, Generaciones } from './fila-por-cuenta';
import { aplicarLapidas, BorradoDegradado, conLapidas, escribirLocal, fusionarCopias, horaDeAlta, sanearDurable, siguiente, type Durable } from './biometria-durable';
import { abrirBiometria, esSobre, hayLlaveBiometria, migrarAlSobre, resellarS3, sellarBiometria, SobreIlegible, type ResultadoMigracion } from './biometria-sobre';
import { consentimientoDeAlta, consentimientoValido, unirConsentimiento, type ConsentimientoBio } from './biometria-consentimiento';

export const LARGO_HUELLA = MODELO_VOZ.dim;
export const MAX_PERSONAS = 20;
export const MAX_MUESTRAS = 8;
export const MAX_NOMBRE = 60;
export const MAX_PARENTESCO = 30;
/**
 * Desde esta similitud (coseno) es la misma persona. Medido con el modelo elegido en 16 lectores de
 * LibriSpeech: misma persona 0,57–0,95; personas distintas ≤ 0,49. Ajustable sin desplegar código.
 */
export const UMBRAL_VOZ = Number(process.env.ULTRON_VOCES_UMBRAL) || 0.6;
/** La más parecida tiene que ganarle a la segunda (otra persona) por al menos esto: si no, «no sé». */
export const MARGEN_VOZ = Number(process.env.ULTRON_VOCES_MARGEN) || 0.1;

export type RelacionVoz = 'yo' | 'conocido';
/** A-7: quién dio el permiso, cuándo, quién la presentó y, si es posible menor, si la dueña lo confirmó en pantalla. */
export type ConsentimientoVoz = ConsentimientoBio;
export type PersonaVoz = {
  id: string;
  nombre: string;
  relacion: RelacionVoz;
  parentesco?: string;
  vectores: number[][];
  consentimiento: ConsentimientoVoz;
  creado: number;
  actualizado: number;
};
/** SEC-03: `rev`, `lapidas` y `borradoTodo` (lib/biometria-durable.ts): ids y horas, nada biométrico. */
export type CajonVoces = { version: 1; modelo: string; personas: PersonaVoz[] } & Durable;

export class VocesNoDisponibles extends Error {}
/** S3 no guardó el cambio: un redeploy lo perdería (y volvería una voz «borrada»). */
export class VocesNoGuardadas extends Error {}

/**
 * Revisión 7 (M3): en un despliegue sin cortes corren DOS instancias un rato, cada una con su caché. Antes la caché no
 * vencía nunca y cada cambio partía de ella: «olvida la voz de Ana» en una instancia y una muestra más de Bruno en la
 * otra (con Ana todavía en su caché) hacían volver a Ana a S3. Ahora:
 *   · cada cambio vuelve a leer S3 bajo el candado de la cuenta (no la caché) y guarda con la condición del ETag que
 *     leyó (If-Match / If-None-Match): si otra instancia escribió entre medio, S3 contesta 412 y se vuelve a leer;
 *   · la caché vence a los VIDA_CACHE_VOCES_MS (y con S3 configurado el disco local no se usa para leer: es la copia de
 *     ESTA instancia, no la verdad), así que una instancia vieja deja de reconocer una voz borrada en otra.
 * Las pruebas que inyectan solo `put`/`get` usan el camino sin condición (re-lectura bajo el candado igual).
 */
type S3Escribe = { listo: () => boolean; put: typeof s3PutJson; putCond?: typeof s3PutJsonCondicional };
type S3Lee = { listo: () => boolean; get: typeof s3GetJson; getEtag?: typeof s3GetJsonConEtag; listar?: typeof s3ListarClaves };
const S3_ESCRIBE: S3Escribe = { listo: s3Listo, put: s3PutJson, putCond: s3PutJsonCondicional };
const S3_LEE: S3Lee = { listo: s3Listo, get: s3GetJson, getEtag: s3GetJsonConEtag, listar: s3ListarClaves };
let s3: S3Escribe = S3_ESCRIBE;
export function _s3DePrueba(o: Partial<S3Escribe> | null) {
  s3 = o ? { ...S3_ESCRIBE, putCond: undefined, ...o } : S3_ESCRIBE;
}
/** La lectura de S3, inyectable aparte (las pruebas de carreras simulan un S3 lento). */
let s3Lee: S3Lee = S3_LEE;
export function _s3LecturaDePrueba(o: Partial<S3Lee> | null) {
  s3Lee = o ? { ...S3_LEE, getEtag: undefined, listar: undefined, ...o } : S3_LEE;
}
/** Lo que vive la caché de una cuenta con S3 configurado (ULTRON_VOCES_CACHE_MS lo cambia). */
export const VIDA_CACHE_VOCES_MS = 30_000;
const vidaCache = () => Number(process.env.ULTRON_VOCES_CACHE_MS) || VIDA_CACHE_VOCES_MS;
const leidoEn = new Map<string, number>();

const cache = new Map<string, CajonVoces>();
const colas = new Map<string, Promise<void>>();
/**
 * Revisión del 6-oct: cada cambio (agregar, olvidar una, olvidar todas) lee el cajón DESPUÉS de que el
 * anterior lo guardó; y una lectura lenta de S3 que empezó antes de un cambio no pisa la caché. Sin esto,
 * un borrado y un alta a la vez podían hacer volver una voz borrada (lib/fila-por-cuenta.ts).
 */
const unoALaVez = filaPorCuenta();
const generaciones = new Generaciones();

const correoNormal = (c: string) => String(c || '').trim().toLowerCase();
const vacio = (): CajonVoces => ({ version: 1, modelo: MODELO_VOZ.id, personas: [] });

export function huellaVoces(correo: string): string {
  return crypto.createHash('sha256').update(`voces:${correoNormal(correo)}`).digest('hex').slice(0, 40);
}
const carpeta = () => process.env.ULTRON_VOCES_DIR || path.join(process.cwd(), 'data', 'voces');
const PREFIJO_S3 = 'ultron/voces/';
const claveS3 = (correo: string) => `${PREFIJO_S3}${huellaVoces(correo)}.json`;

/* A-7 (lib/biometria-sobre.ts): en S3 y en disco el cajón va en sobre (AES-256-GCM); en la caché, abierto. */
const ctxSobre = (c: string) => ({ tipo: 'voces' as const, huella: huellaVoces(c) });
const aGuardar = (c: string, cajon: CajonVoces): unknown => sellarBiometria(cajon, ctxSobre(c));
/** Lo leído de S3, abierto y saneado. Un sobre que no abre es «no disponible» (nunca «vacío»: no se escribe encima). */
function deS3(c: string, x: unknown): CajonVoces {
  try {
    return sanear(abrirBiometria(x, ctxSobre(c)).dato);
  } catch (e) {
    if (e instanceof SobreIlegible) throw new VocesNoDisponibles(e.message);
    throw e;
  }
}
/** Lo viejo en claro que se leyó de S3: se re-sella por detrás, con la condición del ETag (una vez por cuenta y arranque). */
const reselladas = new Set<string>();
/** Revisión tanda E: re-sellar al leer espera lo mismo que la migración de arranque (en producción, 2 min), para que una
 * instancia vieja que aún sirve durante el despliegue no vea un sobre que no entiende. */
const ARRANQUE_RESELLO = Date.now();
const ESPERA_RESELLO_MS = Number(process.env.BIOMETRIA_RESELLAR_ESPERA_MS ?? (process.env.NODE_ENV === 'production' ? 120_000 : 0));
function resellarSiEnClaro(c: string, x: unknown) {
  if (Date.now() - ARRANQUE_RESELLO < ESPERA_RESELLO_MS) return;
  if (!x || esSobre(x) || !hayLlaveBiometria() || !s3Lee.getEtag || !s3.putCond || reselladas.has(c)) return;
  reselladas.add(c);
  const getEtag = s3Lee.getEtag;
  const putCond = s3.putCond;
  void resellarS3(claveS3(c), 'voces', { getEtag, putCond }).catch(() => undefined);
}

export function huellaValida(v: unknown): v is number[] {
  return Array.isArray(v) && v.length === LARGO_HUELLA && v.every((x) => typeof x === 'number' && Number.isFinite(x) && Math.abs(x) <= 1);
}
const limpiar = (n: unknown, max: number) =>
  String(n || '')
    .replace(/[\u0000-\u001f<>{}\[\]]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);

function sanear(x: any): CajonVoces {
  // Huellas de otro modelo no se pueden comparar con las de este: se descartan.
  if (x?.modelo && x.modelo !== MODELO_VOZ.id) return vacio();
  const personas = (Array.isArray(x?.personas) ? x.personas : [])
    .map((p: any): PersonaVoz | null => {
      const vectores = (Array.isArray(p?.vectores) ? p.vectores : []).filter(huellaValida).slice(-MAX_MUESTRAS);
      const nombre = limpiar(p?.nombre, MAX_NOMBRE);
      if (!vectores.length || !nombre || typeof p?.id !== 'string') return null;
      const parentesco = limpiar(p?.parentesco, MAX_PARENTESCO);
      return {
        id: p.id.slice(0, 40),
        nombre,
        relacion: p?.relacion === 'yo' ? 'yo' : 'conocido',
        ...(parentesco ? { parentesco } : {}),
        vectores,
        consentimiento: consentimientoValido(p?.consentimiento),
        creado: Number(p?.creado) || 0,
        actualizado: Number(p?.actualizado) || 0,
      };
    })
    .filter(Boolean)
    .slice(0, MAX_PERSONAS) as PersonaVoz[];
  // SEC-03: la versión y las lápidas viajan con el cajón; lo que tenga lápida no sale ni de una copia vieja.
  const d = sanearDurable(x);
  return { version: 1, modelo: MODELO_VOZ.id, personas: aplicarLapidas(personas, d), ...d };
}

/**
 * La copia local, abierta. Si su sobre no abre: sin S3 (`estricto`, el disco es el único almacén) es «no disponible» —no se
 * toma por vacío ni se escribe encima—; con S3 se ignora (vale S3) y se avisa sin contenido.
 */
function leerDeDisco(correo: string, estricto = false): CajonVoces | null {
  let x: unknown;
  try {
    x = JSON.parse(fs.readFileSync(path.join(carpeta(), `${huellaVoces(correo)}.json`), 'utf8'));
  } catch {
    return null;
  }
  try {
    return sanear(abrirBiometria(x, ctxSobre(correo)).dato);
  } catch (e) {
    if (!(e instanceof SobreIlegible)) return null;
    if (estricto) throw new VocesNoDisponibles(e.message);
    console.warn('[voces] la copia local no abre; vale S3:', e.message);
    return null;
  }
}

/** SEC-03: `ok`, `quitada` (no se pudo escribir pero ya no queda copia vieja) o `fallo` (la copia vieja sigue). */
function escribirEnDisco(correo: string, c: CajonVoces): 'ok' | 'quitada' | 'fallo' {
  return escribirLocal(carpeta(), path.join(carpeta(), `${huellaVoces(correo)}.json`), aGuardar(correo, c));
}

/** Las voces de un correo: caché, disco, S3. Si S3 falla al leer (no «no existe»), VocesNoDisponibles. */
export async function cargarVoces(correo: string): Promise<CajonVoces> {
  const c = correoNormal(correo);
  if (!c) return vacio();
  const hit = cache.get(c);
  const conS3 = s3Lee.listo();
  const edad = Date.now() - (leidoEn.get(c) ?? 0);
  if (hit && (!conS3 || edad < vidaCache())) return hit;
  // Vencida hace poco: se contesta con lo que hay y se refresca por detrás (el «¿quién habla?» no espera a S3). Más
  // vieja que eso, se espera a S3.
  if (hit && edad < vidaCache() * 5) {
    refrescar(c);
    return hit;
  }
  // Con S3, lo que vale es S3 (el disco es la copia de esta instancia, que otra pudo dejar atrás). SEC-03: del disco solo
  // cuentan su versión y sus lápidas (fusionarCopias: gana la versión más alta y las lápidas de las dos se aplican): una
  // copia local vieja nunca devuelve a nadie y un S3 restaurado a una versión vieja no resucita lo que aquí se borró. Si S3
  // no contesta, no se expone el disco solo: «no disponible» (falla cerrado).
  const disco = leerDeDisco(c, !conS3);
  let cajon = conS3 ? null : disco;
  if (conS3) {
    const g = generaciones.de(c);
    const r = await s3Lee.get(claveS3(c)).catch((e) => ({ ok: false, json: null, detalle: String(e?.message || e), missing: false }));
    // Mientras S3 contestaba se guardó un cambio: lo leído es de antes; manda lo guardado.
    if (generaciones.cambioDesde(c, g)) return cache.get(c) || cargarVoces(c);
    if (!r.ok && !r.missing) throw new VocesNoDisponibles(String(r.detalle || 'S3 no contestó'));
    const f = fusionarCopias<PersonaVoz, CajonVoces>(disco, r.ok && r.json ? deS3(c, r.json) : null);
    if (r.ok) resellarSiEnClaro(c, r.json);
    cajon = f.cajon;
    if (cajon && f.atrasada.includes('disco')) escribirEnDisco(c, cajon);
    if (cajon && f.atrasada.includes('s3')) repararS3(c, cajon, g);
  }
  const final = cajon || vacio();
  cache.set(c, final);
  leidoEn.set(c, Date.now());
  return final;
}

const refrescando = new Map<string, Promise<void>>();
/** Relee S3 por detrás (una vez a la vez por cuenta); un cambio mientras tanto gana. Un fallo deja lo que había. */
function refrescar(c: string) {
  if (refrescando.has(c)) return;
  const p = (async () => {
    const g = generaciones.de(c);
    const r = await s3Lee.get(claveS3(c)).catch((e) => ({ ok: false, json: null, detalle: String(e?.message || e), missing: false }));
    if (!r.ok || generaciones.cambioDesde(c, g)) return;
    // SEC-03: con la versión y las lápidas del disco (una copia vieja de S3 no resucita lo borrado aquí).
    const cajon = fusionarCopias<PersonaVoz, CajonVoces>(leerDeDisco(c), r.json ? deS3(c, r.json) : null).cajon || vacio();
    cache.set(c, cajon);
    leidoEn.set(c, Date.now());
    escribirEnDisco(c, cajon);
  })()
    .catch(() => undefined)
    .finally(() => refrescando.delete(c));
  refrescando.set(c, p);
}

/**
 * Lo que hay en S3 AHORA, para cambiarlo (bajo el candado de la cuenta, nunca la caché): con su ETag si este S3 sabe
 * guardar con condición (`etag`: null = no existe todavía; undefined = sin condición). Sin S3, la caché/disco de siempre.
 */
async function leerParaCambiar(c: string): Promise<{ cajon: CajonVoces; etag?: string | null }> {
  if (!s3Lee.listo()) return { cajon: await cargarVoces(c) };
  if (s3Lee.getEtag && s3.putCond) {
    const r = await s3Lee.getEtag(claveS3(c)).catch((e) => ({ ok: false, json: null, etag: null, detalle: String(e?.message || e), missing: false }));
    if (!r.ok) throw new VocesNoDisponibles(String(r.detalle || 'S3 no contestó'));
    // SEC-03: S3 (con su ETag, para la condición) fusionado con la versión y las lápidas del disco de esta instancia.
    const cajon = fusionarCopias<PersonaVoz, CajonVoces>(leerDeDisco(c), r.json ? deS3(c, r.json) : null).cajon || vacio();
    cache.set(c, cajon);
    leidoEn.set(c, Date.now());
    return { cajon, etag: r.missing ? null : r.etag || undefined };
  }
  cache.delete(c);
  return { cajon: await cargarVoces(c) };
}

/**
 * Un cambio de la cuenta: leer S3 → cambiar → guardar con la condición de lo leído; si otra instancia escribió entre
 * medio (412), se vuelve a leer y a aplicar. `fn` devuelve el cajón nuevo (o null si no hay nada que guardar).
 */
function cambiarCajon<T>(c: string, fn: (cajon: CajonVoces) => { cajon: CajonVoces | null; r: T }): Promise<{ r: T; estado: 'ok' | 'copia_local' }> {
  return unoALaVez(c, async () => {
    for (let intento = 0; intento < 4; intento++) {
      const leido = await leerParaCambiar(c);
      const { cajon, r } = fn(leido.cajon);
      if (!cajon) return { r, estado: 'ok' as const };
      // SEC-03: la versión sube (y las lápidas de lo leído se conservan).
      const estado = await guardar(c, siguiente<CajonVoces>(leido.cajon, cajon), leido.etag);
      if (estado !== 'conflicto') return { r, estado };
    }
    throw new VocesNoGuardadas('otra instancia cambió estas voces a la vez; intenta de nuevo');
  });
}

/** SEC-03: S3 quedó atrás (un respaldo restaurado, una lápida que solo tenía el disco): se le pone lo fusionado, en fila. */
function repararS3(c: string, cajon: CajonVoces, g: number) {
  if (!s3.listo()) return;
  const previa = colas.get(c) || Promise.resolve();
  const paso = previa.then(async () => {
    if (generaciones.cambioDesde(c, g)) return;
    await s3.put(claveS3(c), aGuardar(c, cajon)).catch(() => null);
  });
  colas.set(c, paso.catch(() => undefined));
}

/** Las cuentas cuya copia local quedó vieja tras un borrado (S3 al día): estado degradado explícito. */
const localDegradado = new Map<string, string>();
/** ¿La copia local de esta cuenta quedó atrás (un borrado que S3 ya tiene y el disco no)? */
export function copiaLocalDegradada(correo: string): string | null {
  return localDegradado.get(correoNormal(correo)) ?? null;
}

function guardar(c: string, cajon: CajonVoces, etag?: string | null): Promise<'ok' | 'copia_local' | 'conflicto'> {
  cache.set(c, cajon);
  generaciones.cambio(c);
  const previa = colas.get(c) || Promise.resolve();
  const paso = previa.then(async (): Promise<'ok' | 'copia_local' | 'conflicto'> => {
    // Primero lo durable (S3) y después el disco: si S3 falla no queda nada «adelantado».
    if (s3.listo()) {
      const conCondicion = etag !== undefined && !!s3.putCond;
      const sellado = aGuardar(c, cajon);
      const r = conCondicion
        ? await s3.putCond!(claveS3(c), sellado, etag ? { siCoincide: etag } : { siNoExiste: true }).catch((e) => ({ ok: false, conflicto: false, detalle: String(e?.message || e) }))
        : await s3.put(claveS3(c), sellado).catch((e) => ({ ok: false, detalle: String(e?.message || e) }));
      if (!r.ok) {
        if (cache.get(c) === cajon) cache.delete(c);
        if ((r as { conflicto?: boolean }).conflicto) return 'conflicto';
        console.warn('[voces] S3 no guardó', String((r as any).detalle || '').slice(0, 120));
        throw new VocesNoGuardadas(String((r as any).detalle || 'S3 no guardó'));
      }
    }
    leidoEn.set(c, Date.now());
    // SEC-03: el disco ya no se traga su error. Sin S3 es el único almacén: si falla, el cambio NO quedó (se dice).
    // Con S3: si no se pudo ni quitar la copia vieja, el estado queda degradado y quien borra lo dice.
    const local = escribirEnDisco(c, cajon);
    if (local !== 'ok' && !s3.listo()) {
      if (cache.get(c) === cajon) cache.delete(c);
      throw new VocesNoGuardadas('el disco no guardó el cambio');
    }
    if (local === 'fallo') {
      localDegradado.set(c, 'la copia local no se pudo reescribir ni quitar');
      return 'copia_local';
    }
    localDegradado.delete(c);
    return 'ok';
  });
  const cola = paso.catch(() => undefined);
  colas.set(c, cola);
  void cola.then(() => {
    if (colas.get(c) === cola) colas.delete(c);
  });
  return paso;
}

export type AltaVoz = { nombre: unknown; relacion: unknown; parentesco?: unknown; consentimiento: unknown };
export type AltaValida = { ok: true; nombre: string; relacion: RelacionVoz; parentesco?: string; consentimiento: ConsentimientoVoz };

/** Valida quién es y el permiso (el audio se valida aparte). El consentimiento es obligatorio y según quién es. */
export function validarAltaVoz(b: AltaVoz, nombreSesion: string): AltaValida | { ok: false; error: string } {
  const relacion = b?.relacion === 'yo' ? 'yo' : b?.relacion === 'conocido' ? 'conocido' : null;
  if (!relacion) return { ok: false, error: 'Falta de quién es la voz (tú o alguien que presentas).' };
  const c = (b?.consentimiento || {}) as { como?: unknown; frase?: unknown };
  const frase = String(c.frase || '').trim().slice(0, 160);
  if (relacion === 'yo' && c.como !== 'dueño') return { ok: false, error: 'Tu voz solo se guarda si tú lo pides.' };
  if (relacion === 'conocido' && (c.como !== 'voz' || !frase)) return { ok: false, error: 'Para recordar la voz de alguien, esa persona tiene que decir que sí.' };
  const nombre = relacion === 'yo' ? limpiar(nombreSesion, MAX_NOMBRE) || 'yo' : limpiar(b?.nombre, MAX_NOMBRE);
  if (!nombre) return { ok: false, error: 'Falta el nombre de la persona.' };
  const parentesco = relacion === 'conocido' ? limpiar(b?.parentesco, MAX_PARENTESCO) : '';
  // A-7: quién dio el permiso, cuándo, quién la presentó y si es posible menor (biometria-consentimiento.ts).
  const consentimiento = consentimientoDeAlta({ relacion, crudo: { ...c, frase }, nombre, nombreSesion, parentesco });
  return { ok: true, nombre, relacion, ...(parentesco ? { parentesco } : {}), consentimiento };
}

const clave = (n: string) => n.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

/**
 * Agrega o suma huellas: la dueña es una sola ('yo'); un conocido con el mismo nombre (sin importar
 * mayúsculas ni tildes) suma las suyas (las últimas `MAX_MUESTRAS`).
 */
export async function agregarVoz(correo: string, alta: AltaValida, vectores: number[][]): Promise<PersonaVoz> {
  if (!vectores.length || !vectores.every(huellaValida)) throw new TypeError('huellas inválidas');
  const c = correoNormal(correo);
  return cambiarCajon(c, (cajon) => {
  const ahora = Date.now();
  const i = cajon.personas.findIndex((p) => (alta.relacion === 'yo' ? p.relacion === 'yo' : p.relacion === 'conocido' && clave(p.nombre) === clave(alta.nombre)));
  const personas = [...cajon.personas];
  let persona: PersonaVoz;
  if (i >= 0) {
    const p = personas[i];
    persona = {
      ...p,
      nombre: alta.nombre,
      ...(alta.parentesco ? { parentesco: alta.parentesco } : {}),
      vectores: [...p.vectores, ...vectores].slice(-MAX_MUESTRAS),
      consentimiento: unirConsentimiento(p.consentimiento, alta.consentimiento),
      actualizado: ahora,
    };
    personas[i] = persona;
  } else {
    if (personas.length >= MAX_PERSONAS) throw new RangeError(`Ya conozco ${MAX_PERSONAS} voces; olvida alguna para agregar otra.`);
    persona = {
      id: crypto.randomBytes(9).toString('base64url'),
      nombre: alta.nombre,
      relacion: alta.relacion,
      ...(alta.parentesco ? { parentesco: alta.parentesco } : {}),
      vectores: vectores.slice(-MAX_MUESTRAS),
      consentimiento: alta.consentimiento,
      creado: horaDeAlta(cajon, ahora),
      actualizado: ahora,
    };
    personas.push(persona);
  }
  return { cajon: { version: 1 as const, modelo: MODELO_VOZ.id, personas }, r: persona };
  }).then((x) => x.r);
}

/**
 * SEC-03: deja su lápida (ninguna copia vieja la devuelve); si S3 la borró pero la copia local vieja no se pudo reescribir
 * ni quitar, lanza BorradoDegradado (con la persona): no se afirma un borrado completo.
 */
export async function olvidarVoz(correo: string, id: string): Promise<PersonaVoz | null> {
  const c = correoNormal(correo);
  const { r, estado } = await cambiarCajon<PersonaVoz | null>(c, (cajon) => {
    const p = cajon.personas.find((x) => x.id === id) || null;
    if (!p) return { cajon: null, r: null };
    return { cajon: { version: 1 as const, modelo: MODELO_VOZ.id, personas: cajon.personas.filter((x) => x.id !== id), lapidas: conLapidas(cajon, [id]) }, r: p };
  });
  if (r && estado === 'copia_local') throw new BorradoDegradado(r);
  return r;
}

/**
 * A-7: la dueña confirmó en SU pantalla el permiso de alguien (un posible menor): queda la hora en la constancia. null si no
 * estaba. No crea a nadie ni toca sus huellas.
 */
export async function confirmarConsentimientoVoz(correo: string, id: string): Promise<PersonaVoz | null> {
  const c = correoNormal(correo);
  return cambiarCajon<PersonaVoz | null>(c, (cajon) => {
    const i = cajon.personas.findIndex((x) => x.id === id);
    if (i < 0) return { cajon: null, r: null };
    const personas = [...cajon.personas];
    const persona = { ...personas[i], consentimiento: { ...personas[i].consentimiento, confirmadoEnPantalla: Date.now() }, actualizado: Date.now() };
    personas[i] = persona;
    return { cajon: { version: 1 as const, modelo: MODELO_VOZ.id, personas }, r: persona };
  }).then((x) => x.r);
}

export async function olvidarTodasLasVoces(correo: string): Promise<number> {
  const c = correoNormal(correo);
  return unoALaVez(c, async () => {
    let n = 0;
    let previo: CajonVoces | null = null;
    try {
      cache.delete(c);
      previo = await cargarVoces(c);
      n = previo.personas.length;
    } catch {
      /* sin leer, se borra igual: borrar nunca debe fallar por no poder contar */
    }
    // Vacío sin condición: borrar todo gana siempre (un cambio de otra instancia con lo de antes choca con su ETag). SEC-03:
    // deja su hora (`borradoTodo`): toda voz guardada antes muere también en cualquier copia vieja.
    const ahora = Date.now();
    const estado = await guardar(c, siguiente<CajonVoces>(previo, { ...vacio(), lapidas: conLapidas(previo, (previo?.personas || []).map((p) => p.id), ahora), borradoTodo: ahora }));
    if (estado === 'copia_local') throw new BorradoDegradado(n);
    return n;
  });
}

/* ── ¿de quién es esta voz? ──────────────────────────────────────────────────────────────────── */

export type MotivoVoz = 'reconocida' | 'sin_voces' | 'nadie_cerca' | 'dudosa';
export type ResultadoVoz = { persona: PersonaVoz | null; similitud: number; segunda: number; motivo: MotivoVoz };

/** Lo que se parece una huella a una persona: lo más que se parece a cualquiera de sus muestras. */
export function parecidoA(v: number[], p: PersonaVoz): number {
  return p.vectores.reduce((m, x) => Math.max(m, similitud(v, x)), -1);
}

/**
 * ¿De quién es esta huella? null si nadie llega al umbral o si dos personas quedan demasiado parejas:
 * mejor «no sé» que llamar a alguien por otro nombre.
 */
export function identificarVoz(v: number[], personas: PersonaVoz[], umbral = UMBRAL_VOZ, margen = MARGEN_VOZ): ResultadoVoz {
  const r3 = (x: number) => Math.round(x * 1000) / 1000;
  if (!personas.length) return { persona: null, similitud: 0, segunda: 0, motivo: 'sin_voces' };
  const filas = personas.map((p) => ({ p, s: parecidoA(v, p) })).sort((a, b) => b.s - a.s);
  const [primera, segunda] = filas;
  const s2 = segunda ? Math.max(0, segunda.s) : 0;
  if (primera.s < umbral) return { persona: null, similitud: r3(primera.s), segunda: r3(s2), motivo: 'nadie_cerca' };
  if (primera.s - s2 < margen) return { persona: null, similitud: r3(primera.s), segunda: r3(s2), motivo: 'dudosa' };
  return { persona: primera.p, similitud: r3(primera.s), segunda: r3(s2), motivo: 'reconocida' };
}

/**
 * Para el cerebro: la escena del turno puede traer «Por la voz, habla Ana (tu esposa), no José» (el
 * teléfono lo pone cuando reconoce con seguridad a alguien que NO es la dueña). Entonces quien pide no
 * es la dueña de la cuenta, y lo privado de ella no se le lee a otra persona. null si no hace falta.
 */
export function reglaQuienHabla(escena: string): string | null {
  const m = /\bPor la voz, habla ([^,.;()]{1,60})(?: \([^)]{0,40}\))?, no ([^,.;()]{1,60})/i.exec(escena) || /\bBy voice, ([^,.;()]{1,60}) is speaking(?: \([^)]{0,40}\))?, not ([^,.;()]{1,60})/i.exec(escena);
  if (!m) return null;
  return reglaPara(m[1].trim(), m[2].trim());
}

/** El largo con que server.ts toma la escena del turno (lo que pase de ahí no llega al cerebro). */
export const LARGO_ESCENA_TURNO = 400;

/** Quién habla según el campo aparte `quienHabla` (validado): su nombre guardado, el de la dueña y si es solo precaución. */
export type OtraVozTurno = { quien: string; duena: string; reciente: boolean };

/**
 * El campo aparte `quienHabla: { id, reciente? }` que manda el teléfono (src/voces, revisión del 5-oct), VALIDADO: solo
 * desde la APP con sesión (`origen: 'app'`, que pone el servidor por la cabecera) y solo con el id de una voz GUARDADA en
 * el cajón del correo de esa sesión que no sea la dueña. El nombre sale de lo guardado y el de la dueña de la sesión,
 * nunca del cuerpo. `reciente` (revisión 7.5, M1′): de ESA frase no se supo quién la dijo (un «sí» corto, la consulta
 * tardó) y es la última voz reconocida que no es la dueña: solo precaución. Solo AGREGA cuidado; nunca da permiso de nada.
 * Nunca lanza (sin poder leer las voces, null).
 */
export async function otraVozDelTurno(o: { quienHabla?: unknown; origen?: unknown; sesion?: { correo?: string; nombre?: string } | null }): Promise<OtraVozTurno | null> {
  const v = await vozDelTurno(o);
  return v.tipo === 'otra' ? v.voz : null;
}

/**
 * Revisión 7 (G2): lo que dice el campo `quienHabla: { id }` con sus tres salidas. `otra`: una voz guardada de esa cuenta
 * que no es la dueña (con su nombre). `duena`: el id es el de la propia dueña. `sin_verificar`: vino un id de la app con
 * sesión pero no se pudo comprobar (el cajón tardó más de 800 ms, S3 falló, o el id ya no está): el teléfono dijo que
 * NO era la dueña y no se puede confirmar lo contrario → para el modo invitado cuenta como invitado (server/modo-invitado.ts).
 * `ninguna`: no vino id, o no viene de la app con sesión. Nunca lanza.
 */
export type VozDelTurno = { tipo: 'ninguna' } | { tipo: 'duena' } | { tipo: 'otra'; voz: OtraVozTurno } | { tipo: 'sin_verificar'; reciente: boolean };
export async function vozDelTurno(o: { quienHabla?: unknown; origen?: unknown; sesion?: { correo?: string; nombre?: string } | null }): Promise<VozDelTurno> {
  const q = o.quienHabla as { id?: unknown; reciente?: unknown } | null | undefined;
  const id = typeof q?.id === 'string' ? q.id.slice(0, 40) : '';
  const correo = String(o.sesion?.correo || '').trim();
  if (!id || o.origen !== 'app' || !correo) return { tipo: 'ninguna' };
  const reciente = q?.reciente === true;
  try {
    // Casi siempre en caché (la cargó /api/voces/quien de esta frase); si S3 tarda, no frena el turno.
    let reloj: ReturnType<typeof setTimeout> | undefined;
    const cajon = await Promise.race([cargarVoces(correo), new Promise<null>((r) => ((reloj = setTimeout(() => r(null), 800)), reloj.unref?.()))]).finally(() => clearTimeout(reloj));
    if (!cajon) return { tipo: 'sin_verificar', reciente };
    const p = cajon.personas.find((x) => x.id === id);
    if (p?.relacion === 'yo') return { tipo: 'duena' };
    if (!p) return { tipo: 'sin_verificar', reciente };
    return { tipo: 'otra', voz: { quien: p.nombre, duena: limpiar(o.sesion?.nombre, MAX_NOMBRE) || 'la persona dueña de la cuenta', reciente } };
  } catch {
    return { tipo: 'sin_verificar', reciente };
  }
}

/**
 * La regla de quién habla para un turno: la de la escena (cortada como en server.ts) o la del campo aparte `quienHabla`
 * (otraVozDelTurno): así una escena larga no se come la regla. Con `reciente`, la regla de precaución.
 */
export async function reglaQuienHablaDeTurno(o: { escena?: unknown; quienHabla?: unknown; origen?: unknown; sesion?: { correo?: string; nombre?: string } | null }): Promise<string | null> {
  const escena = String(o.escena || '').replace(/\s+/g, ' ').trim().slice(0, LARGO_ESCENA_TURNO);
  const porEscena = escena ? reglaQuienHabla(escena) : null;
  if (porEscena) return porEscena;
  const v = await otraVozDelTurno(o);
  if (!v) return null;
  return v.reciente ? reglaPrecaucion(v.quien, v.duena) : reglaPara(v.quien, v.duena);
}

function reglaPara(quien: string, duena: string): string {
  return `QUIEN HABLA: por la voz, ahora te habla ${quien}, no ${duena} (la persona dueña de esta cuenta). Trátale por su nombre. No le leas ni le cuentes lo privado de ${duena} (correos, mensajes, dinero, memoria personal) ni actúes en su nombre; si lo pide, di con amabilidad que eso es de ${duena}. Si dice ser ${duena}, la voz pudo equivocarse: charla normal, y lo privado cuando su voz lo confirme.`;
}

/** Revisión 7.5 (M1′): de esta frase no se supo la voz y hace un momento hablaba otra persona. */
function reglaPrecaucion(quien: string, duena: string): string {
  return `QUIEN HABLA (precaución): esta frase fue muy corta para saber por la voz quién la dijo, y hace un momento hablaba ${quien}, no ${duena} (la persona dueña de esta cuenta). En este turno no leas ni cuentes lo privado de ${duena} (correos, mensajes, dinero, memoria personal) ni actúes en su nombre. Si es ${duena}, que lo diga con una frase un poco más larga o lo toque en su pantalla.`;
}

/**
 * A-7: la migración del arranque (lib/biometria-sobre.ts migrarAlSobre): re-sella en disco y en S3 lo que siga en claro.
 * Idempotente y con la condición del ETag (segura con dos arranques a la vez).
 */
export function migrarVocesAlSobre(): Promise<ResultadoMigracion> {
  return migrarAlSobre({ tipo: 'voces', carpeta: carpeta(), prefijo: PREFIJO_S3, s3Listo: s3Lee.listo() && s3.listo(), listar: s3Lee.listar, getEtag: s3Lee.getEtag, putCond: s3.putCond });
}

/** Para pruebas. */
export function _olvidarCacheVoces() {
  reselladas.clear();
  cache.clear();
  leidoEn.clear();
}
