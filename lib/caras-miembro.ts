/**
 * LAS CARAS QUE CONOCE AURA, POR PERSONA (el reconocimiento con permiso de la app: mobile/src/caras).
 *
 * Lo que se guarda son NÚMEROS: por cada persona conocida, hasta `MAX_MUESTRAS` vectores de 128
 * números que salen de la red de reconocimiento en el teléfono. Nunca una foto: el teléfono no la
 * manda y aquí no hay dónde ponerla (lo que no sea un vector válido se rechaza).
 *
 *   · un cajón por CORREO del dueño (el de la sesión firmada), igual para la junta y para los
 *     miembros de la comunidad (server/nivel.ts): las caras de alguien no entran a la memoria de la
 *     junta, ni a los hechos compartidos, ni al prompt de nadie; solo el teléfono de esa persona las
 *     pide para comparar;
 *   · `relacion: 'yo'` es la cara de la dueña (la pidió ella, «conóceme»); `'conocido'` es alguien que
 *     ella presentó y que dijo que sí en voz alta: se guarda la frase como constancia;
 *   · se borra de verdad: una persona («olvida a Ana»), la propia («olvida mi cara») o todas;
 *   · `parentesco` (opcional): lo que la dueña dijo al presentarla («mi esposa Ana» → «esposa»), de una
 *     lista cerrada; el teléfono lo usa para decirle al cerebro «Reconozco a Ana (tu esposa)»;
 *   · aprende con el uso (`sumarMuestras`, POST /api/caras/:id/muestras): cuando el teléfono reconoce a
 *     alguien con mucha seguridad, a veces suma esa toma (luz, lentes). Con tope: sale la muestra más
 *     redundante (`podarMuestras`), no la más vieja a ciegas;
 *   · los cambios de una cuenta van de a uno (`unoALaVez`): una muestra que llega mientras se olvida a
 *     esa persona no la hace volver.
 *
 * Se guarda como la memoria de los miembros (lib/memoria-miembro.ts): caché del proceso, disco
 * (`data/caras/`, o ULTRON_CARAS_DIR) y S3 (`ultron/caras/<huella>.json`) para sobrevivir a un
 * redespliegue; el nombre del archivo es una huella del correo. Si S3 no contesta al leer, NO se
 * escribe encima (se perderían las que ya estaban): se avisa con `CarasNoDisponibles`.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { s3GetJson, s3GetJsonConEtag, s3ListarClaves, s3Listo, s3PutJson, s3PutJsonCondicional } from './s3';
import { Generaciones } from './fila-por-cuenta';
import { aplicarLapidas, repararCopiaS3, BorradoDegradado, conLapidas, escribirLocal, fusionarCopias, horaDeAlta, sanearDurable, siguiente, type Durable } from './biometria-durable';
import { abrirBiometria, esSobre, hayLlaveBiometria, migrarAlSobre, resellarS3, sellarBiometria, SobreIlegible, type ResultadoMigracion } from './biometria-sobre';
import { consentimientoDeAlta, consentimientoValido, reconocible, unirConsentimiento, type ConsentimientoBio } from './biometria-consentimiento';

export const LARGO_VECTOR = 128;
export const MAX_PERSONAS = 30;
/** Antes 5: con 5 de la pose guiada al conocerla ya no quedaba lugar para aprender con el uso. */
export const MAX_MUESTRAS = 12;
/** Lo que se suma de una vez al aprender con el uso. */
export const MAX_MUESTRAS_SUMA = 2;
export const MAX_NOMBRE = 60;

export type RelacionCara = 'yo' | 'conocido';
/** A-7: quién dio el permiso, cuándo, quién la presentó y, si es posible menor, si la dueña lo confirmó en pantalla. */
export type ConsentimientoCara = ConsentimientoBio;
export type PersonaCara = {
  id: string;
  nombre: string;
  relacion: RelacionCara;
  parentesco?: string;
  vectores: number[][];
  consentimiento: ConsentimientoCara;
  creado: number;
  actualizado: number;
};
/** SEC-03: `rev`, `lapidas` y `borradoTodo` (lib/biometria-durable.ts): ids y horas, nada biométrico. */
export type CajonCaras = { version: 1; personas: PersonaCara[] } & Durable;

export class CarasNoDisponibles extends Error {}
/** S3 no guardó el cambio: en disco quedó, pero un redeploy lo perdería (y volvería una cara «borrada»). */
export class CarasNoGuardadas extends Error {}

/** S3 inyectable para las pruebas (simular que S3 falla al guardar). */
/**
 * Revisión 7 (M3), como las voces (lib/voces-miembro.ts): con dos instancias a la vez (despliegue sin cortes), cada
 * cambio vuelve a leer S3 bajo el candado y guarda con la condición del ETag leído (412 → se vuelve a leer), y la caché
 * vence a los VIDA_CACHE_CARAS_MS (con S3, el disco local no se usa para leer). Una instancia vieja no puede hacer
 * volver una cara olvidada en la otra.
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
/** Lo que vive la caché de una cuenta con S3 configurado (ULTRON_CARAS_CACHE_MS lo cambia). */
export const VIDA_CACHE_CARAS_MS = 30_000;
const vidaCache = () => Number(process.env.ULTRON_CARAS_CACHE_MS) || VIDA_CACHE_CARAS_MS;
const leidoEn = new Map<string, number>();

const cache = new Map<string, CajonCaras>();
const colas = new Map<string, Promise<void>>();
/** Revisión del 6-oct: una lectura lenta de S3 que empezó antes de un cambio no pisa la caché (lib/fila-por-cuenta.ts). */
const generaciones = new Generaciones();
/** Un cambio a la vez por cuenta (leer → cambiar → guardar), ver `unoALaVez`. */
const candados = new Map<string, Promise<unknown>>();

/**
 * Los cambios de una cuenta van en fila: cada uno lee el cajón DESPUÉS de que el anterior lo guardó. Sin
 * esto, «olvida a Ana» y una muestra que el teléfono suma a Ana en el mismo momento leían el mismo cajón;
 * si la muestra guardaba última, Ana volvía (la revisión del 5-oct). Uno que falla no traba a los demás.
 */
function unoALaVez<T>(c: string, fn: () => Promise<T>): Promise<T> {
  const previo = candados.get(c) || Promise.resolve();
  const paso = previo.then(fn);
  const cola = paso.catch(() => undefined);
  candados.set(c, cola);
  void cola.then(() => {
    if (candados.get(c) === cola) candados.delete(c);
  });
  return paso;
}

const correoNormal = (c: string) => String(c || '').trim().toLowerCase();
const vacio = (): CajonCaras => ({ version: 1, personas: [] });

export function huellaCaras(correo: string): string {
  return crypto.createHash('sha256').update(`caras:${correoNormal(correo)}`).digest('hex').slice(0, 40);
}
const carpeta = () => process.env.ULTRON_CARAS_DIR || path.join(process.cwd(), 'data', 'caras');
const PREFIJO_S3 = 'ultron/caras/';
const claveS3 = (correo: string) => `${PREFIJO_S3}${huellaCaras(correo)}.json`;

/* A-7 (lib/biometria-sobre.ts): en S3 y en disco el cajón va en sobre (AES-256-GCM); en la caché, abierto. */
const ctxSobre = (c: string) => ({ tipo: 'caras' as const, huella: huellaCaras(c) });
const aGuardar = (c: string, cajon: CajonCaras): unknown => sellarBiometria(cajon, ctxSobre(c));
/** Lo leído de S3, abierto y saneado. Un sobre que no abre es «no disponible» (nunca «vacío»: no se escribe encima). */
function deS3(c: string, x: unknown): CajonCaras {
  try {
    return sanear(abrirBiometria(x, ctxSobre(c)).dato);
  } catch (e) {
    if (e instanceof SobreIlegible) throw new CarasNoDisponibles(e.message);
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
  void resellarS3(claveS3(c), 'caras', { getEtag, putCond }).catch(() => undefined);
}

export function vectorValido(v: unknown): v is number[] {
  return Array.isArray(v) && v.length === LARGO_VECTOR && v.every((x) => typeof x === 'number' && Number.isFinite(x) && Math.abs(x) <= 1);
}
const redondear = (v: number[]) => v.map((x) => Math.round(x * 1e4) / 1e4);
const distancia = (a: number[], b: number[]) => Math.sqrt(a.reduce((s, x, i) => s + (x - b[i]) ** 2, 0));

/** Parentescos que se guardan (sin tildes → como se escribe). Lo que no esté aquí no se guarda. */
const PARENTESCOS: Record<string, string> = {
  amigo: 'amigo', amiga: 'amiga', hermano: 'hermano', hermana: 'hermana', hijo: 'hijo', hija: 'hija',
  mama: 'mamá', papa: 'papá', madre: 'madre', padre: 'padre', esposa: 'esposa', esposo: 'esposo',
  pareja: 'pareja', novia: 'novia', novio: 'novio', primo: 'primo', prima: 'prima', tio: 'tío', tia: 'tía',
  abuelo: 'abuelo', abuela: 'abuela', nieto: 'nieto', nieta: 'nieta', sobrino: 'sobrino', sobrina: 'sobrina',
  suegro: 'suegro', suegra: 'suegra', cunado: 'cuñado', cunada: 'cuñada', socio: 'socio', socia: 'socia',
  jefe: 'jefe', jefa: 'jefa', companero: 'compañero', companera: 'compañera', vecino: 'vecino', vecina: 'vecina',
};
export function parentescoValido(v: unknown): string | undefined {
  const k = String(v || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
  return Object.prototype.hasOwnProperty.call(PARENTESCOS, k) ? PARENTESCOS[k] : undefined;
}

/**
 * Deja como mucho `max` muestras: mientras sobren, sale la más redundante (de la pareja más parecida, la
 * más vieja de las dos). Igual que el teléfono (mobile/src/caras/caras.ts sumarMuestras).
 */
export function podarMuestras(vs: number[][], max = MAX_MUESTRAS): number[][] {
  const out = [...vs];
  while (out.length > max) {
    let quitar = 0;
    let menor = Infinity;
    for (let i = 0; i < out.length; i++)
      for (let j = i + 1; j < out.length; j++) {
        const d = distancia(out[i], out[j]);
        if (d < menor) {
          menor = d;
          quitar = i;
        }
      }
    out.splice(quitar, 1);
  }
  return out;
}
const limpiarNombre = (n: unknown) =>
  String(n || '')
    .replace(/[\u0000-\u001f<>]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_NOMBRE);

function sanear(x: any): CajonCaras {
  const personas = (Array.isArray(x?.personas) ? x.personas : [])
    .map((p: any): PersonaCara | null => {
      const vectores = (Array.isArray(p?.vectores) ? p.vectores : []).filter(vectorValido).slice(-MAX_MUESTRAS).map(redondear);
      const nombre = limpiarNombre(p?.nombre);
      if (!vectores.length || !nombre || typeof p?.id !== 'string') return null;
      const relacion: RelacionCara = p?.relacion === 'yo' ? 'yo' : 'conocido';
      const parentesco = relacion === 'conocido' ? parentescoValido(p?.parentesco) : undefined;
      return {
        id: p.id.slice(0, 40),
        nombre,
        relacion,
        ...(parentesco ? { parentesco } : {}),
        vectores,
        consentimiento: consentimientoValido(p?.consentimiento),
        creado: Number(p?.creado) || 0,
        actualizado: Number(p?.actualizado) || 0,
      };
    })
    .filter(Boolean)
    .slice(0, MAX_PERSONAS) as PersonaCara[];
  // SEC-03: la versión y las lápidas viajan con el cajón; lo que tenga lápida no sale ni de una copia vieja.
  const d = sanearDurable(x);
  return { version: 1, personas: aplicarLapidas(personas, d), ...d };
}

/**
 * La copia local, abierta. Si su sobre no abre: sin S3 (`estricto`, el disco es el único almacén) es «no disponible» —no se
 * toma por vacío ni se escribe encima—; con S3 se ignora (vale S3) y se avisa sin contenido.
 */
function leerDeDisco(correo: string, estricto = false): CajonCaras | null {
  let x: unknown;
  try {
    x = JSON.parse(fs.readFileSync(path.join(carpeta(), `${huellaCaras(correo)}.json`), 'utf8'));
  } catch {
    return null;
  }
  try {
    return sanear(abrirBiometria(x, ctxSobre(correo)).dato);
  } catch (e) {
    if (!(e instanceof SobreIlegible)) return null;
    if (estricto) throw new CarasNoDisponibles(e.message);
    console.warn('[caras] la copia local no abre; vale S3:', e.message);
    return null;
  }
}

/** SEC-03: `ok`, `quitada` (no se pudo escribir pero ya no queda copia vieja) o `fallo` (la copia vieja sigue). */
function escribirEnDisco(correo: string, c: CajonCaras): 'ok' | 'quitada' | 'fallo' {
  return escribirLocal(carpeta(), path.join(carpeta(), `${huellaCaras(correo)}.json`), aGuardar(correo, c));
}

/** Las caras de un correo: caché, disco, S3. Si S3 falla al leer (no «no existe»), CarasNoDisponibles. */
export async function cargarCaras(correo: string): Promise<CajonCaras> {
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
    if (generaciones.cambioDesde(c, g)) return cache.get(c) || cargarCaras(c);
    if (!r.ok && !r.missing) throw new CarasNoDisponibles(String(r.detalle || 'S3 no contestó'));
    const f = fusionarCopias<PersonaCara, CajonCaras>(disco, r.ok && r.json ? deS3(c, r.json) : null);
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
    const cajon = fusionarCopias<PersonaCara, CajonCaras>(leerDeDisco(c), r.json ? deS3(c, r.json) : null).cajon || vacio();
    cache.set(c, cajon);
    leidoEn.set(c, Date.now());
    escribirEnDisco(c, cajon);
  })()
    .catch(() => undefined)
    .finally(() => refrescando.delete(c));
  refrescando.set(c, p);
}

/** Lo que hay en S3 AHORA, para cambiarlo (bajo el candado), con su ETag si se puede guardar con condición. */
async function leerParaCambiar(c: string): Promise<{ cajon: CajonCaras; etag?: string | null }> {
  if (!s3Lee.listo()) return { cajon: await cargarCaras(c) };
  if (s3Lee.getEtag && s3.putCond) {
    const r = await s3Lee.getEtag(claveS3(c)).catch((e) => ({ ok: false, json: null, etag: null, detalle: String(e?.message || e), missing: false }));
    if (!r.ok) throw new CarasNoDisponibles(String(r.detalle || 'S3 no contestó'));
    // SEC-03: S3 (con su ETag, para la condición) fusionado con la versión y las lápidas del disco de esta instancia.
    const cajon = fusionarCopias<PersonaCara, CajonCaras>(leerDeDisco(c), r.json ? deS3(c, r.json) : null).cajon || vacio();
    cache.set(c, cajon);
    leidoEn.set(c, Date.now());
    return { cajon, etag: r.missing ? null : r.etag || undefined };
  }
  cache.delete(c);
  return { cajon: await cargarCaras(c) };
}

/** Un cambio: leer S3 → cambiar → guardar con la condición de lo leído (412 → otra vez). `fn` da el cajón nuevo o null. */
function cambiarCajon<T>(c: string, fn: (cajon: CajonCaras) => { cajon: CajonCaras | null; r: T }): Promise<{ r: T; estado: 'ok' | 'copia_local' }> {
  return unoALaVez(c, async () => {
    for (let intento = 0; intento < 4; intento++) {
      const leido = await leerParaCambiar(c);
      const { cajon, r } = fn(leido.cajon);
      if (!cajon) return { r, estado: 'ok' as const };
      // SEC-03: la versión sube (y las lápidas de lo leído se conservan).
      const estado = await guardar(c, siguiente<CajonCaras>(leido.cajon, cajon), leido.etag);
      if (estado !== 'conflicto') return { r, estado };
    }
    throw new CarasNoGuardadas('otra instancia cambió estas caras a la vez; intenta de nuevo');
  });
}

/** SEC-03: S3 quedó atrás (un respaldo restaurado, una lápida que solo tenía el disco): se le pone lo fusionado, en fila. */
function repararS3(c: string, cajon: CajonCaras, g: number) {
  if (!s3.listo()) return;
  const previa = colas.get(c) || Promise.resolve();
  const paso = previa.then(async () => {
    if (generaciones.cambioDesde(c, g)) return;
    // Con la condición del ETag de una relectura (lib/biometria-durable.ts repararCopiaS3): si otra instancia guardó entre
    // medio (una lápida nueva), se fusiona con lo suyo y se reintenta; nunca se pisa una copia más nueva.
    const clave = claveS3(c);
    const getEtag = s3Lee.getEtag;
    const putCond = s3.putCond;
    const condicional = !!(getEtag && putCond);
    const r = await repararCopiaS3<PersonaCara, CajonCaras>({
      cajon,
      leer: condicional ? () => getEtag!(clave) : () => s3Lee.get(clave),
      abrir: (x) => deS3(c, x),
      escribirSi: condicional ? (k, cond) => putCond!(clave, aGuardar(c, k), cond) : undefined,
      escribir: (k) => s3.put(clave, aGuardar(c, k)),
    });
    // Lo fusionado puede traer una lápida que la otra instancia acababa de guardar: la caché no se queda con la persona.
    if (r.estado !== 'fallo' && !generaciones.cambioDesde(c, g)) {
      cache.set(c, r.cajon);
      leidoEn.set(c, Date.now());
    }
  });
  colas.set(c, paso.catch(() => undefined));
}

/** Las cuentas cuya copia local quedó vieja tras un borrado (S3 al día): estado degradado explícito. */
const localDegradado = new Map<string, string>();
/** ¿La copia local de esta cuenta quedó atrás (un borrado que S3 ya tiene y el disco no)? */
export function copiaLocalDegradada(correo: string): string | null {
  return localDegradado.get(correoNormal(correo)) ?? null;
}

function guardar(c: string, cajon: CajonCaras, etag?: string | null): Promise<'ok' | 'copia_local' | 'conflicto'> {
  cache.set(c, cajon);
  generaciones.cambio(c);
  const previa = colas.get(c) || Promise.resolve();
  const paso = previa.then(async (): Promise<'ok' | 'copia_local' | 'conflicto'> => {
    // Primero lo durable (S3) y después el disco: si S3 falla no queda nada «adelantado» en disco ni
    // en caché, así que reintentar vuelve a encontrar la cara y la borra de verdad.
    if (s3.listo()) {
      const conCondicion = etag !== undefined && !!s3.putCond;
      const sellado = aGuardar(c, cajon);
      const r = conCondicion
        ? await s3.putCond!(claveS3(c), sellado, etag ? { siCoincide: etag } : { siNoExiste: true }).catch((e) => ({ ok: false, conflicto: false, detalle: String(e?.message || e) }))
        : await s3.put(claveS3(c), sellado).catch((e) => ({ ok: false, detalle: String(e?.message || e) }));
      if (!r.ok) {
        if (cache.get(c) === cajon) cache.delete(c);
        if ((r as { conflicto?: boolean }).conflicto) return 'conflicto';
        console.warn('[caras] S3 no guardó', String((r as any).detalle || '').slice(0, 120));
        throw new CarasNoGuardadas(String((r as any).detalle || 'S3 no guardó'));
      }
    }
    leidoEn.set(c, Date.now());
    // SEC-03: el disco ya no se traga su error. Sin S3 es el único almacén: si falla, el cambio NO quedó (se dice).
    // Con S3: si no se pudo ni quitar la copia vieja, el estado queda degradado y quien borra lo dice.
    const local = escribirEnDisco(c, cajon);
    if (local !== 'ok' && !s3.listo()) {
      if (cache.get(c) === cajon) cache.delete(c);
      throw new CarasNoGuardadas('el disco no guardó el cambio');
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

export type AltaCara = { nombre: unknown; relacion: unknown; vectores: unknown; consentimiento: unknown; parentesco?: unknown };

/** Valida lo que manda el teléfono. El consentimiento es obligatorio y según quién es. */
export function validarAlta(b: AltaCara, nombreSesion: string): { ok: true; nombre: string; relacion: RelacionCara; parentesco?: string; vectores: number[][]; consentimiento: ConsentimientoCara } | { ok: false; error: string } {
  const relacion = b?.relacion === 'yo' ? 'yo' : b?.relacion === 'conocido' ? 'conocido' : null;
  if (!relacion) return { ok: false, error: 'Falta a quién es la cara (tú o alguien que presentas).' };
  const vs = Array.isArray(b?.vectores) ? b.vectores : [];
  if (!vs.length || vs.length > MAX_MUESTRAS || !vs.every(vectorValido)) return { ok: false, error: 'Eso no es una cara que pueda guardar (solo se guardan números, nunca fotos).' };
  const c = (b?.consentimiento || {}) as { como?: unknown; frase?: unknown };
  const frase = String(c.frase || '').trim().slice(0, 160);
  if (relacion === 'yo' && c.como !== 'dueño') return { ok: false, error: 'Tu cara solo se guarda si tú lo pides.' };
  if (relacion === 'conocido' && (c.como !== 'voz' || !frase)) return { ok: false, error: 'Para recordar a alguien, esa persona tiene que decir que sí.' };
  const nombre = relacion === 'yo' ? limpiarNombre(nombreSesion) || 'yo' : limpiarNombre(b?.nombre);
  if (!nombre) return { ok: false, error: 'Falta el nombre de la persona.' };
  // El parentesco solo para alguien presentado y solo de la lista: lo demás se ignora (no es un error).
  const parentesco = relacion === 'conocido' ? parentescoValido(b?.parentesco) : undefined;
  // A-7: quién dio el permiso, cuándo, quién la presentó y si es posible menor (biometria-consentimiento.ts).
  const consentimiento = consentimientoDeAlta({ relacion, crudo: { ...c, frase }, nombre, nombreSesion, parentesco });
  return { ok: true, nombre, relacion, ...(parentesco ? { parentesco } : {}), vectores: vs.map(redondear), consentimiento };
}

/** Las muestras que el teléfono suma a alguien ya guardado (aprender con el uso): 1 o 2 vectores válidos. */
export function validarMuestras(b: { vectores?: unknown } | undefined): { ok: true; vectores: number[][] } | { ok: false; error: string } {
  const vs = Array.isArray(b?.vectores) ? b!.vectores : [];
  if (!vs.length || vs.length > MAX_MUESTRAS_SUMA || !vs.every(vectorValido)) return { ok: false, error: 'Eso no es una cara que pueda guardar (solo se guardan números, nunca fotos).' };
  return { ok: true, vectores: (vs as number[][]).map(redondear) };
}

/**
 * Agrega o suma muestras: la dueña es una sola ('yo'); un conocido con el mismo nombre (sin importar
 * mayúsculas ni tildes) suma sus muestras (las últimas `MAX_MUESTRAS`).
 */
export async function agregarCara(correo: string, alta: Exclude<ReturnType<typeof validarAlta>, { ok: false }>): Promise<PersonaCara> {
  const c = correoNormal(correo);
  return cambiarCajon(c, (cajon) => {
    const clave = (n: string) => n.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
    const ahora = Date.now();
    const i = cajon.personas.findIndex((p) => (alta.relacion === 'yo' ? p.relacion === 'yo' : p.relacion === 'conocido' && clave(p.nombre) === clave(alta.nombre)));
    let persona: PersonaCara;
    const personas = [...cajon.personas];
    if (i >= 0) {
      const p = personas[i];
      const parentesco = alta.parentesco || p.parentesco;
      persona = { ...p, nombre: alta.nombre, ...(parentesco ? { parentesco } : {}), vectores: podarMuestras([...p.vectores, ...alta.vectores]), consentimiento: unirConsentimiento(p.consentimiento, alta.consentimiento), actualizado: ahora };
      personas[i] = persona;
    } else {
      if (personas.length >= MAX_PERSONAS) throw new RangeError(`Ya conozco ${MAX_PERSONAS} caras; olvida alguna para agregar otra.`);
      persona = { id: crypto.randomBytes(9).toString('base64url'), nombre: alta.nombre, relacion: alta.relacion, ...(alta.parentesco ? { parentesco: alta.parentesco } : {}), vectores: podarMuestras(alta.vectores), consentimiento: alta.consentimiento, creado: horaDeAlta(cajon, ahora), actualizado: ahora };
      personas.push(persona);
    }
    return { cajon: { version: 1 as const, personas }, r: persona };
  }).then((x) => x.r);
}

/**
 * Aprender con el uso: suma muestras a alguien YA guardado (por id, del cajón de este correo). El permiso
 * ya lo dio al guardarla; esto no crea a nadie. null si no estaba (o se olvidó mientras tanto).
 */
export async function sumarMuestras(correo: string, id: string, vectores: number[][]): Promise<PersonaCara | null> {
  const c = correoNormal(correo);
  return cambiarCajon<PersonaCara | null>(c, (cajon) => {
    const i = cajon.personas.findIndex((x) => x.id === id);
    if (i < 0) return { cajon: null, r: null };
    const personas = [...cajon.personas];
    const persona = { ...personas[i], vectores: podarMuestras([...personas[i].vectores, ...vectores]), actualizado: Date.now() };
    personas[i] = persona;
    return { cajon: { version: 1 as const, personas }, r: persona };
  }).then((x) => x.r);
}

/**
 * Olvida una persona por id. null si no estaba. SEC-03: deja su lápida (ninguna copia vieja la devuelve); si S3 la
 * borró pero la copia local vieja no se pudo reescribir ni quitar, lanza BorradoDegradado (con la persona): no se
 * afirma un borrado completo.
 */
export async function olvidarCara(correo: string, id: string): Promise<PersonaCara | null> {
  const c = correoNormal(correo);
  const { r, estado } = await cambiarCajon<PersonaCara | null>(c, (cajon) => {
    const p = cajon.personas.find((x) => x.id === id) || null;
    if (!p) return { cajon: null, r: null };
    return { cajon: { version: 1 as const, personas: cajon.personas.filter((x) => x.id !== id), lapidas: conLapidas(cajon, [id]) }, r: p };
  });
  if (r && estado === 'copia_local') throw new BorradoDegradado(r);
  return r;
}

/**
 * A-7: la dueña confirmó en SU pantalla el permiso de alguien (un posible menor): queda la hora en la constancia. null si no
 * estaba. No crea a nadie ni toca sus vectores.
 */
export async function confirmarConsentimientoCara(correo: string, id: string): Promise<PersonaCara | null> {
  const c = correoNormal(correo);
  return cambiarCajon<PersonaCara | null>(c, (cajon) => {
    const i = cajon.personas.findIndex((x) => x.id === id);
    if (i < 0) return { cajon: null, r: null };
    const personas = [...cajon.personas];
    const persona = { ...personas[i], consentimiento: { ...personas[i].consentimiento, confirmadoEnPantalla: Date.now() }, actualizado: Date.now() };
    personas[i] = persona;
    return { cajon: { version: 1 as const, personas }, r: persona };
  }).then((x) => x.r);
}

/** Olvida todas las caras de este correo. Devuelve cuántas había. */
export async function olvidarTodasLasCaras(correo: string): Promise<number> {
  const c = correoNormal(correo);
  return unoALaVez(c, async () => {
    let n = 0;
    let previo: CajonCaras | null = null;
    try {
      cache.delete(c);
      previo = await cargarCaras(c);
      n = previo.personas.length;
    } catch {
      /* sin leer, se borra igual: borrar nunca debe fallar por no poder contar */
    }
    // Vacío sin condición: borrar todo gana siempre. SEC-03: deja su hora (`borradoTodo`): toda persona creada antes muere
    // también en cualquier copia vieja (otra instancia, el disco, un respaldo restaurado).
    const ahora = Date.now();
    const estado = await guardar(c, siguiente<CajonCaras>(previo, { ...vacio(), lapidas: conLapidas(previo, (previo?.personas || []).map((p) => p.id), ahora), borradoTodo: ahora }));
    if (estado === 'copia_local') throw new BorradoDegradado(n);
    return n;
  });
}

/**
 * Tanda F1: los vectores con que el teléfono reconoce a esta persona (GET /api/caras). Un posible menor que la dueña todavía
 * no confirmó en su pantalla va SIN vectores: el teléfono la lista (con «Por confirmar») pero no puede reconocerla.
 */
export function vectoresParaReconocer(p: Pick<PersonaCara, 'vectores' | 'consentimiento'>): number[][] {
  return reconocible(p.consentimiento) ? p.vectores : [];
}

/**
 * Tanda F1: los nombres de las caras que todavía no se pueden usar para reconocer (un posible menor por confirmar), para
 * quitarlos de la escena del turno (server/modo-invitado.ts). Con tope: si el cajón tarda o falla, [] (el turno no espera).
 */
export async function nombresCarasPorConfirmar(correo: string, topeMs = 300): Promise<string[]> {
  if (!correoNormal(correo)) return [];
  let reloj: ReturnType<typeof setTimeout> | undefined;
  try {
    const cajon = await Promise.race([cargarCaras(correo), new Promise<null>((r) => ((reloj = setTimeout(() => r(null), topeMs)), reloj.unref?.()))]);
    if (!cajon) return [];
    // Por nombre (la escena no trae ids): un nombre que también es de alguien que SÍ se reconoce (la dueña, un adulto) no se
    // quita, porque la escena puede estar nombrando a esa persona.
    const plano = (n: string) => String(n || '').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    const reconocibles = new Set(cajon.personas.filter((p) => reconocible(p.consentimiento)).map((p) => plano(p.nombre)));
    return cajon.personas.filter((p) => !reconocible(p.consentimiento) && !reconocibles.has(plano(p.nombre))).map((p) => p.nombre);
  } catch {
    return [];
  } finally {
    clearTimeout(reloj);
  }
}

/**
 * A-7: la migración del arranque (lib/biometria-sobre.ts migrarAlSobre): re-sella en disco y en S3 lo que siga en claro.
 * Idempotente y con la condición del ETag (segura con dos arranques a la vez).
 */
export function migrarCarasAlSobre(): Promise<ResultadoMigracion> {
  return migrarAlSobre({ tipo: 'caras', carpeta: carpeta(), prefijo: PREFIJO_S3, s3Listo: s3Lee.listo() && s3.listo(), listar: s3Lee.listar, getEtag: s3Lee.getEtag, putCond: s3.putCond });
}

/** Para pruebas. */
export function _olvidarCacheCaras() {
  reselladas.clear();
  cache.clear();
  leidoEn.clear();
}
