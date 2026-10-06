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
import { s3GetJson, s3Listo, s3PutJson } from './s3';
import { MODELO_VOZ, similitud } from './voces-motor';
import { filaPorCuenta, Generaciones } from './fila-por-cuenta';

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
export type ConsentimientoVoz = { como: 'dueño' | 'voz'; frase?: string; t: number };
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
export type CajonVoces = { version: 1; modelo: string; personas: PersonaVoz[] };

export class VocesNoDisponibles extends Error {}
/** S3 no guardó el cambio: un redeploy lo perdería (y volvería una voz «borrada»). */
export class VocesNoGuardadas extends Error {}

let s3 = { listo: s3Listo, put: s3PutJson };
export function _s3DePrueba(o: Partial<typeof s3> | null) {
  s3 = o ? { ...s3, ...o } : { listo: s3Listo, put: s3PutJson };
}
/** La lectura de S3, inyectable aparte (las pruebas de carreras simulan un S3 lento). */
let s3Lee = { listo: s3Listo, get: s3GetJson };
export function _s3LecturaDePrueba(o: Partial<typeof s3Lee> | null) {
  s3Lee = o ? { ...s3Lee, ...o } : { listo: s3Listo, get: s3GetJson };
}

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
const claveS3 = (correo: string) => `ultron/voces/${huellaVoces(correo)}.json`;

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
        consentimiento: { como: p?.consentimiento?.como === 'voz' ? 'voz' : 'dueño', frase: String(p?.consentimiento?.frase || '').slice(0, 160) || undefined, t: Number(p?.consentimiento?.t) || 0 },
        creado: Number(p?.creado) || 0,
        actualizado: Number(p?.actualizado) || 0,
      };
    })
    .filter(Boolean)
    .slice(0, MAX_PERSONAS) as PersonaVoz[];
  return { version: 1, modelo: MODELO_VOZ.id, personas };
}

function leerDeDisco(correo: string): CajonVoces | null {
  try {
    return sanear(JSON.parse(fs.readFileSync(path.join(carpeta(), `${huellaVoces(correo)}.json`), 'utf8')));
  } catch {
    return null;
  }
}

function escribirEnDisco(correo: string, c: CajonVoces) {
  try {
    fs.mkdirSync(carpeta(), { recursive: true });
    const f = path.join(carpeta(), `${huellaVoces(correo)}.json`);
    fs.writeFileSync(`${f}.tmp`, JSON.stringify(c), { mode: 0o600 });
    fs.renameSync(`${f}.tmp`, f);
  } catch (e: any) {
    console.warn('[voces] no pude escribir el disco', String(e?.message || e).slice(0, 120));
  }
}

/** Las voces de un correo: caché, disco, S3. Si S3 falla al leer (no «no existe»), VocesNoDisponibles. */
export async function cargarVoces(correo: string): Promise<CajonVoces> {
  const c = correoNormal(correo);
  if (!c) return vacio();
  const hit = cache.get(c);
  if (hit) return hit;
  let cajon = leerDeDisco(c);
  if (!cajon && s3Lee.listo()) {
    const g = generaciones.de(c);
    const r = await s3Lee.get(claveS3(c)).catch((e) => ({ ok: false, json: null, detalle: String(e?.message || e), missing: false }));
    // Mientras S3 contestaba se guardó un cambio: lo leído es de antes; manda lo guardado.
    if (generaciones.cambioDesde(c, g)) return cache.get(c) || cargarVoces(c);
    if (r.ok && r.json) {
      cajon = sanear(r.json);
      escribirEnDisco(c, cajon);
    } else if (!r.ok && !r.missing) {
      throw new VocesNoDisponibles(String(r.detalle || 'S3 no contestó'));
    }
  }
  const final = cajon || vacio();
  cache.set(c, final);
  return final;
}

function guardar(c: string, cajon: CajonVoces): Promise<void> {
  cache.set(c, cajon);
  generaciones.cambio(c);
  const previa = colas.get(c) || Promise.resolve();
  const paso = previa.then(async () => {
    // Primero lo durable (S3) y después el disco: si S3 falla no queda nada «adelantado».
    if (s3.listo()) {
      const r = await s3.put(claveS3(c), cajon).catch((e) => ({ ok: false, detalle: String(e?.message || e) }));
      if (!r.ok) {
        console.warn('[voces] S3 no guardó', String((r as any).detalle || '').slice(0, 120));
        if (cache.get(c) === cajon) cache.delete(c);
        throw new VocesNoGuardadas(String((r as any).detalle || 'S3 no guardó'));
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
  return { ok: true, nombre, relacion, ...(parentesco ? { parentesco } : {}), consentimiento: { como: relacion === 'yo' ? 'dueño' : 'voz', ...(frase ? { frase } : {}), t: Date.now() } };
}

const clave = (n: string) => n.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

/**
 * Agrega o suma huellas: la dueña es una sola ('yo'); un conocido con el mismo nombre (sin importar
 * mayúsculas ni tildes) suma las suyas (las últimas `MAX_MUESTRAS`).
 */
export async function agregarVoz(correo: string, alta: AltaValida, vectores: number[][]): Promise<PersonaVoz> {
  if (!vectores.length || !vectores.every(huellaValida)) throw new TypeError('huellas inválidas');
  const c = correoNormal(correo);
  return unoALaVez(c, async () => {
  const cajon = await cargarVoces(c);
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
      consentimiento: alta.consentimiento,
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
      creado: ahora,
      actualizado: ahora,
    };
    personas.push(persona);
  }
  await guardar(c, { version: 1, modelo: MODELO_VOZ.id, personas });
  return persona;
  });
}

export async function olvidarVoz(correo: string, id: string): Promise<PersonaVoz | null> {
  const c = correoNormal(correo);
  return unoALaVez(c, async () => {
    const cajon = await cargarVoces(c);
    const p = cajon.personas.find((x) => x.id === id) || null;
    if (!p) return null;
    await guardar(c, { version: 1, modelo: MODELO_VOZ.id, personas: cajon.personas.filter((x) => x.id !== id) });
    return p;
  });
}

export async function olvidarTodasLasVoces(correo: string): Promise<number> {
  const c = correoNormal(correo);
  return unoALaVez(c, async () => {
    let n = 0;
    try {
      n = (await cargarVoces(c)).personas.length;
    } catch {
      /* sin leer, se borra igual: borrar nunca debe fallar por no poder contar */
    }
    await guardar(c, vacio());
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
  const q = o.quienHabla as { id?: unknown; reciente?: unknown } | null | undefined;
  const id = typeof q?.id === 'string' ? q.id.slice(0, 40) : '';
  const correo = String(o.sesion?.correo || '').trim();
  if (!id || o.origen !== 'app' || !correo) return null;
  try {
    // Casi siempre en caché (la cargó /api/voces/quien de esta frase); si S3 tarda, no frena el turno.
    let reloj: ReturnType<typeof setTimeout> | undefined;
    const cajon = await Promise.race([cargarVoces(correo), new Promise<null>((r) => ((reloj = setTimeout(() => r(null), 800)), reloj.unref?.()))]).finally(() => clearTimeout(reloj));
    const p = cajon?.personas.find((x) => x.id === id);
    if (!p || p.relacion !== 'conocido') return null;
    return { quien: p.nombre, duena: limpiar(o.sesion?.nombre, MAX_NOMBRE) || 'la persona dueña de la cuenta', reciente: q?.reciente === true };
  } catch {
    return null;
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

/** Para pruebas. */
export function _olvidarCacheVoces() {
  cache.clear();
}
