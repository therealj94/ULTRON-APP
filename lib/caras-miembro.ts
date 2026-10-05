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
import { s3GetJson, s3Listo, s3PutJson } from './s3';

export const LARGO_VECTOR = 128;
export const MAX_PERSONAS = 30;
/** Antes 5: con 5 de la pose guiada al conocerla ya no quedaba lugar para aprender con el uso. */
export const MAX_MUESTRAS = 12;
/** Lo que se suma de una vez al aprender con el uso. */
export const MAX_MUESTRAS_SUMA = 2;
export const MAX_NOMBRE = 60;

export type RelacionCara = 'yo' | 'conocido';
export type ConsentimientoCara = { como: 'dueño' | 'voz'; frase?: string; t: number };
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
export type CajonCaras = { version: 1; personas: PersonaCara[] };

export class CarasNoDisponibles extends Error {}
/** S3 no guardó el cambio: en disco quedó, pero un redeploy lo perdería (y volvería una cara «borrada»). */
export class CarasNoGuardadas extends Error {}

/** S3 inyectable para las pruebas (simular que S3 falla al guardar). */
let s3 = { listo: s3Listo, put: s3PutJson };
export function _s3DePrueba(o: Partial<typeof s3> | null) {
  s3 = o ? { ...s3, ...o } : { listo: s3Listo, put: s3PutJson };
}

const cache = new Map<string, CajonCaras>();
const colas = new Map<string, Promise<void>>();
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
const claveS3 = (correo: string) => `ultron/caras/${huellaCaras(correo)}.json`;

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
        consentimiento: { como: p?.consentimiento?.como === 'voz' ? 'voz' : 'dueño', frase: String(p?.consentimiento?.frase || '').slice(0, 160) || undefined, t: Number(p?.consentimiento?.t) || 0 },
        creado: Number(p?.creado) || 0,
        actualizado: Number(p?.actualizado) || 0,
      };
    })
    .filter(Boolean)
    .slice(0, MAX_PERSONAS) as PersonaCara[];
  return { version: 1, personas };
}

function leerDeDisco(correo: string): CajonCaras | null {
  try {
    return sanear(JSON.parse(fs.readFileSync(path.join(carpeta(), `${huellaCaras(correo)}.json`), 'utf8')));
  } catch {
    return null;
  }
}

function escribirEnDisco(correo: string, c: CajonCaras) {
  try {
    fs.mkdirSync(carpeta(), { recursive: true });
    const f = path.join(carpeta(), `${huellaCaras(correo)}.json`);
    fs.writeFileSync(`${f}.tmp`, JSON.stringify(c), { mode: 0o600 });
    fs.renameSync(`${f}.tmp`, f);
  } catch (e: any) {
    console.warn('[caras] no pude escribir el disco', String(e?.message || e).slice(0, 120));
  }
}

/** Las caras de un correo: caché, disco, S3. Si S3 falla al leer (no «no existe»), CarasNoDisponibles. */
export async function cargarCaras(correo: string): Promise<CajonCaras> {
  const c = correoNormal(correo);
  if (!c) return vacio();
  const hit = cache.get(c);
  if (hit) return hit;
  let cajon = leerDeDisco(c);
  if (!cajon && s3Listo()) {
    const r = await s3GetJson(claveS3(c)).catch((e) => ({ ok: false, json: null, detalle: String(e?.message || e), missing: false }));
    if (r.ok && r.json) {
      cajon = sanear(r.json);
      escribirEnDisco(c, cajon);
    } else if (!r.ok && !r.missing) {
      throw new CarasNoDisponibles(String(r.detalle || 'S3 no contestó'));
    }
  }
  const final = cajon || vacio();
  cache.set(c, final);
  return final;
}

function guardar(c: string, cajon: CajonCaras): Promise<void> {
  cache.set(c, cajon);
  const previa = colas.get(c) || Promise.resolve();
  const paso = previa.then(async () => {
    // Primero lo durable (S3) y después el disco: si S3 falla no queda nada «adelantado» en disco ni
    // en caché, así que reintentar vuelve a encontrar la cara y la borra de verdad.
    if (s3.listo()) {
      const r = await s3.put(claveS3(c), cajon).catch((e) => ({ ok: false, detalle: String(e?.message || e) }));
      if (!r.ok) {
        console.warn('[caras] S3 no guardó', String((r as any).detalle || '').slice(0, 120));
        if (cache.get(c) === cajon) cache.delete(c);
        throw new CarasNoGuardadas(String((r as any).detalle || 'S3 no guardó'));
      }
    }
    escribirEnDisco(c, cajon);
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
  return { ok: true, nombre, relacion, ...(parentesco ? { parentesco } : {}), vectores: vs.map(redondear), consentimiento: { como: relacion === 'yo' ? 'dueño' : 'voz', ...(frase ? { frase } : {}), t: Date.now() } };
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
  return unoALaVez(c, async () => {
    const cajon = await cargarCaras(c);
    const clave = (n: string) => n.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
    const ahora = Date.now();
    const i = cajon.personas.findIndex((p) => (alta.relacion === 'yo' ? p.relacion === 'yo' : p.relacion === 'conocido' && clave(p.nombre) === clave(alta.nombre)));
    let persona: PersonaCara;
    const personas = [...cajon.personas];
    if (i >= 0) {
      const p = personas[i];
      const parentesco = alta.parentesco || p.parentesco;
      persona = { ...p, nombre: alta.nombre, ...(parentesco ? { parentesco } : {}), vectores: podarMuestras([...p.vectores, ...alta.vectores]), consentimiento: alta.consentimiento, actualizado: ahora };
      personas[i] = persona;
    } else {
      if (personas.length >= MAX_PERSONAS) throw new RangeError(`Ya conozco ${MAX_PERSONAS} caras; olvida alguna para agregar otra.`);
      persona = { id: crypto.randomBytes(9).toString('base64url'), nombre: alta.nombre, relacion: alta.relacion, ...(alta.parentesco ? { parentesco: alta.parentesco } : {}), vectores: podarMuestras(alta.vectores), consentimiento: alta.consentimiento, creado: ahora, actualizado: ahora };
      personas.push(persona);
    }
    await guardar(c, { version: 1, personas });
    return persona;
  });
}

/**
 * Aprender con el uso: suma muestras a alguien YA guardado (por id, del cajón de este correo). El permiso
 * ya lo dio al guardarla; esto no crea a nadie. null si no estaba (o se olvidó mientras tanto).
 */
export async function sumarMuestras(correo: string, id: string, vectores: number[][]): Promise<PersonaCara | null> {
  const c = correoNormal(correo);
  return unoALaVez(c, async () => {
    const cajon = await cargarCaras(c);
    const i = cajon.personas.findIndex((x) => x.id === id);
    if (i < 0) return null;
    const personas = [...cajon.personas];
    const persona = { ...personas[i], vectores: podarMuestras([...personas[i].vectores, ...vectores]), actualizado: Date.now() };
    personas[i] = persona;
    await guardar(c, { version: 1, personas });
    return persona;
  });
}

/** Olvida una persona por id. null si no estaba. */
export async function olvidarCara(correo: string, id: string): Promise<PersonaCara | null> {
  const c = correoNormal(correo);
  return unoALaVez(c, async () => {
    const cajon = await cargarCaras(c);
    const p = cajon.personas.find((x) => x.id === id) || null;
    if (!p) return null;
    await guardar(c, { version: 1, personas: cajon.personas.filter((x) => x.id !== id) });
    return p;
  });
}

/** Olvida todas las caras de este correo. Devuelve cuántas había. */
export async function olvidarTodasLasCaras(correo: string): Promise<number> {
  const c = correoNormal(correo);
  return unoALaVez(c, async () => {
    let n = 0;
    try {
      n = (await cargarCaras(c)).personas.length;
    } catch {
      /* sin leer, se borra igual: borrar nunca debe fallar por no poder contar */
    }
    await guardar(c, vacio());
    return n;
  });
}

/** Para pruebas. */
export function _olvidarCacheCaras() {
  cache.clear();
}
