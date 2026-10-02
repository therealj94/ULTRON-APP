/**
 * MEMORIA PERSONAL DE LOS MIEMBROS DE LA COMUNIDAD.
 *
 * lib/memoria.ts es la memoria de la JUNTA: un cajón por persona del padrón, más los hechos
 * compartidos de la junta y los cambios que pidió cada uno. Un miembro de la comunidad (entró por
 * Genesis abierto, server/nivel.ts) no entra ahí ni ve nada de eso. Tiene lo suyo, aquí:
 *
 *   · un cajón por CORREO (el de la sesión firmada o del pase de voz), nunca por nombre ni por cuerpo;
 *   · el hilo de sus últimos turnos y los hechos que pidió recordar («recuerda que…»);
 *   · nada de nadie más: ni de otros miembros, ni de la junta.
 *
 * Se guarda como el perfil (lib/perfil-persona.ts): caché en memoria (el turno no espera a S3), disco
 * (`data/memoria-miembros/`, o ULTRON_MEMORIA_MIEMBROS_DIR) y S3 (`ultron/memoria-miembros/<huella>`)
 * para que sobreviva a un redespliegue. El nombre es una huella del correo: un listado del cubo no
 * enseña correos. Un archivo por persona, para que la comunidad crezca sin reescribir un objeto enorme
 * en cada turno.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { capasHilo, type HiloMemoria } from './conversacion';
import { s3GetJson, s3Listo, s3PutJson } from './s3';

export type TurnoMiembro = { rol: 'user' | 'ultron'; texto: string; t: number; canal: 'mesa' | 'telegram' | 'sistema' };
export type HechoMiembro = { hecho: string; t: number };
export type CajonMiembro = { version: 1; corta: TurnoMiembro[]; larga: HechoMiembro[] };

export const MAX_CORTA_MIEMBRO = 60;
export const MAX_LARGA_MIEMBRO = 40;
/** Cajones en la caché del proceso. Al pasarlo se sueltan los que menos se usaron. */
const MAX_EN_CACHE = 2000;

const cache = new Map<string, CajonMiembro>();
const colas = new Map<string, Promise<void>>();

/**
 * ¿Es algo que la persona quiere que se recuerde? Solo lo explícito o lo suyo («recuerda que…»,
 * «me llamo…», «mi hija…»). El filtro de la junta (server/hechos.ts) guarda además todo lo que nombre
 * a Orden Global o una mina, que en un miembro sería guardar sus preguntas como si fueran hechos.
 */
export function esHechoDeMiembro(texto: string): boolean {
  const t = String(texto || '').toLowerCase();
  if (t.length < 8) return false;
  return /\b(recuerda|recu[eé]rdalo|acu[eé]rdate|guarda|anota|apunta|no (te )?olvides)\b|\bme llamo\b|\bmi (esposa|esposo|hijo|hija|mam[aá]|pap[aá]|hermano|hermana|cumplea[nñ]os|trabajo|perro|gato)\b|\bsoy (el|la|de)\b/.test(t);
}

const correoNormal = (correo: string) => String(correo || '').trim().toLowerCase();
const vacio = (): CajonMiembro => ({ version: 1, corta: [], larga: [] });

export function huellaMiembro(correo: string): string {
  return crypto.createHash('sha256').update(`memoria-miembro:${correoNormal(correo)}`).digest('hex').slice(0, 40);
}

function carpeta() {
  return process.env.ULTRON_MEMORIA_MIEMBROS_DIR || path.join(process.cwd(), 'data', 'memoria-miembros');
}
const claveS3 = (correo: string) => `ultron/memoria-miembros/${huellaMiembro(correo)}.json`;

/** Lo que venga del disco o de S3, validado: textos recortados, roles conocidos, topes. */
function sanear(x: any): CajonMiembro {
  const corta = (Array.isArray(x?.corta) ? x.corta : [])
    .map((t: any) => ({
      rol: t?.rol === 'ultron' ? ('ultron' as const) : ('user' as const),
      texto: String(t?.texto || '').slice(0, 4000),
      t: Number(t?.t) || 0,
      canal: t?.canal === 'telegram' || t?.canal === 'sistema' ? t.canal : ('mesa' as const),
    }))
    .filter((t: TurnoMiembro) => t.texto.trim())
    .slice(-MAX_CORTA_MIEMBRO);
  const larga = (Array.isArray(x?.larga) ? x.larga : [])
    .map((h: any) => ({ hecho: String(h?.hecho || '').slice(0, 400), t: Number(h?.t) || 0 }))
    .filter((h: HechoMiembro) => h.hecho.trim())
    .slice(0, MAX_LARGA_MIEMBRO);
  return { version: 1, corta, larga };
}

function leerDeDisco(correo: string): CajonMiembro | null {
  try {
    return sanear(JSON.parse(fs.readFileSync(path.join(carpeta(), `${huellaMiembro(correo)}.json`), 'utf8')));
  } catch {
    return null;
  }
}

function escribirEnDisco(correo: string, c: CajonMiembro) {
  try {
    fs.mkdirSync(carpeta(), { recursive: true });
    const f = path.join(carpeta(), `${huellaMiembro(correo)}.json`);
    fs.writeFileSync(`${f}.tmp`, JSON.stringify(c));
    fs.renameSync(`${f}.tmp`, f);
  } catch (e: any) {
    console.warn('[memoria miembro] no pude escribir el disco', String(e?.message || e).slice(0, 120));
  }
}

function enCache(c: string, cajon: CajonMiembro) {
  cache.delete(c);
  cache.set(c, cajon);
  if (cache.size > MAX_EN_CACHE) for (const k of [...cache.keys()].slice(0, cache.size - MAX_EN_CACHE)) cache.delete(k);
}

/**
 * Cajones que se devolvieron vacíos porque S3 no se pudo leer: no se guardan nunca (si se guardaran, el
 * turno nuevo pisaría en S3 toda la memoria buena de esa persona).
 */
const sinLeer = new WeakSet<CajonMiembro>();

/**
 * El cajón de un correo: caché, disco, S3. Si S3 no contesta, se sigue con lo que haya (vacío) sin
 * guardarlo en la caché, para que el próximo turno vuelva a preguntar. Nunca lanza.
 */
export async function cargarMiembro(correo: string): Promise<CajonMiembro> {
  const c = correoNormal(correo);
  if (!c) return vacio();
  const hit = cache.get(c);
  if (hit) {
    enCache(c, hit);
    return hit;
  }
  let cajon = leerDeDisco(c);
  if (!cajon && s3Listo()) {
    const r = await s3GetJson(claveS3(c)).catch(() => ({ ok: false, json: null }) as { ok: boolean; json: unknown });
    if (r.ok && r.json) {
      cajon = sanear(r.json);
      escribirEnDisco(c, cajon);
    } else if (!r.ok) {
      const v = vacio();
      sinLeer.add(v);
      return v;
    }
  }
  const final = cajon || vacio();
  enCache(c, final);
  return final;
}

/** Guarda en orden, un correo a la vez: disco y S3. Resuelve false si S3 está configurado y no guardó. */
function guardar(c: string, cajon: CajonMiembro): Promise<boolean> {
  const previa = colas.get(c) || Promise.resolve();
  const paso = previa.then(async () => {
    escribirEnDisco(c, cajon);
    if (!s3Listo()) return true;
    const r = await s3PutJson(claveS3(c), cajon).catch((e) => ({ ok: false, detalle: String(e?.message || e) }));
    if (!r.ok) console.warn('[memoria miembro] S3 no guardó', String((r as any).detalle || '').slice(0, 120));
    return r.ok;
  });
  const cola = paso.catch(() => undefined);
  colas.set(c, cola);
  void cola.then(() => {
    if (colas.get(c) === cola) colas.delete(c);
  });
  return paso;
}

/** El hilo del miembro que ya está en la caché (el turno lo lee sin esperar a nada). */
export function hiloMiembro(correo: string): TurnoMiembro[] {
  return cache.get(correoNormal(correo))?.corta || [];
}

/**
 * Anota un turno en el hilo del miembro. Si la persona pide recordar algo («recuerda que…»), va a sus
 * hechos. `esperar: false` vuelve en cuanto está en la caché y deja el guardado en la cola.
 */
export async function recordarTurnoMiembro(o: { correo: string; rol: 'user' | 'ultron'; texto: string; canal?: TurnoMiembro['canal']; esperar?: boolean }): Promise<void> {
  const c = correoNormal(o.correo);
  const texto = String(o.texto || '').trim().slice(0, 4000);
  if (!c || !texto) return;
  const cajon = await cargarMiembro(c);
  // S3 no se pudo leer: este turno no se anota (mejor perder un turno que borrar toda su memoria).
  if (sinLeer.has(cajon)) {
    console.warn('[memoria miembro] S3 no se pudo leer; no anoto el turno para no pisar su memoria');
    return;
  }
  const t = Date.now();
  cajon.corta = [...cajon.corta, { rol: o.rol, texto, t, canal: o.canal || 'mesa' }].slice(-MAX_CORTA_MIEMBRO);
  if (o.rol === 'user' && esHechoDeMiembro(texto)) {
    cajon.larga = [{ hecho: texto.slice(0, 400), t }, ...cajon.larga.filter((h) => h.hecho !== texto)].slice(0, MAX_LARGA_MIEMBRO);
  }
  enCache(c, cajon);
  const guardado = guardar(c, cajon);
  if (o.esperar === false) {
    guardado.catch((e) => console.warn('[memoria miembro] no se guardó el turno', String(e?.message || e).slice(0, 120)));
    return;
  }
  await guardado;
}

/** Un hecho que el miembro pidió guardar (desde la app o el chat). */
export async function guardarHechoMiembro(correo: string, hecho: string): Promise<void> {
  const c = correoNormal(correo);
  const h = String(hecho || '').trim().slice(0, 400);
  if (!c || !h) return;
  const cajon = await cargarMiembro(c);
  if (sinLeer.has(cajon)) throw new Error('No pude leer tu memoria guardada en este momento; no guardé nada. Prueba otra vez en un rato.');
  // Ya guardado: no se reescribe (lib/memoria.ts guardarHechoQuien, el mismo motivo).
  if (cajon.larga.some((x) => x.hecho === h)) return;
  cajon.larga = [{ hecho: h, t: Date.now() }, ...cajon.larga.filter((x) => x.hecho !== h)].slice(0, MAX_LARGA_MIEMBRO);
  enCache(c, cajon);
  await guardar(c, cajon);
}

/** Borra todo lo del miembro (su hilo y sus hechos). Solo lo suyo. `durable`: false si S3 no lo borró. */
export async function olvidarMiembro(correo: string): Promise<{ durable: boolean }> {
  const c = correoNormal(correo);
  if (!c) return { durable: true };
  const cajon = vacio();
  enCache(c, cajon);
  return { durable: await guardar(c, cajon) };
}

/** Lo que va al prompt: con quién habla, lo que pidió recordar y su hilo. Nada de nadie más. */
/** `hilo`: como en lib/memoria.ts promptMemoria ('todo', 'mediano' o 'firma'; lib/conversacion.ts). */
export function promptMemoriaMiembro(correo: string, nombre?: string, hilo: HiloMemoria = 'todo'): string {
  const cajon = cache.get(correoNormal(correo)) || vacio();
  const n = String(nombre || '').trim() || 'un miembro de la comunidad';
  const capas = capasHilo(cajon.corta);
  // El hilo se etiqueta como lo que es: la persona, no «Junta».
  const miembro = (s: string) => s.replace(/^Junta: /gm, 'Miembro: ');
  const hablas = `HABLAS CON: ${n}, miembro de la comunidad de Orden Global (no es de la junta). Esta memoria es solo suya.`;
  // Lo de un miembro solo se guarda cuando lo pide («recuerda que…»): entra entero en la firma.
  const pidio = `LO QUE ${n.toUpperCase()} TE PIDIÓ RECORDAR:\n${cajon.larga.map((h) => `- ${h.hecho}`).join('\n') || '(nada aún)'}`;
  if (hilo === 'firma') return [hablas, pidio].join('\n');
  return [
    hablas,
    pidio,
    hilo === 'todo' ? `HILO CORTO CON ${n.toUpperCase()} (lo último; «esto» es esto):\n${miembro(capas.corto) || '(nada)'}` : '',
    `CONVERSACIÓN MEDIANA CON ${n.toUpperCase()}:\n${miembro(capas.mediano) || '(nada)'}`,
  ]
    .filter(Boolean)
    .join('\n');
}

/** Lo que ve el miembro en /api/memoria: lo suyo, y de la junta nada. */
export function fotoMemoriaMiembro(correo: string) {
  const cajon = cache.get(correoNormal(correo)) || vacio();
  return {
    honesto: true as const,
    quien: null,
    nombre: null,
    miembros: [] as string[],
    durable: s3Listo(),
    privada: { corta: cajon.corta.slice(-40), larga: cajon.larga },
    junta: [] as unknown[],
    cambios: [] as unknown[],
    nota: s3Listo()
      ? 'Tu memoria personal con AU-RA: solo tuya. Nadie más la ve.'
      : 'Tu memoria personal con AU-RA: solo tuya. Sin S3 se pierde al redesplegar.',
  };
}

/** Solo pruebas: olvida la caché (como tras un redespliegue). */
export function _olvidarCacheMiembros() {
  cache.clear();
}
