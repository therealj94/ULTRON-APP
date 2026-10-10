/**
 * LOS INTERRUPTORES: apagar o ajustar una pieza de la voz sin redesplegar.
 *
 * Antes, cualquier ajuste (el modelo chico, el prompt corto de la voz, cuánto se espera el reintento de
 * ElevenLabs o la frase de espera) era una variable de entorno y un despliegue de varios minutos. Aquí
 * viven en un JSON en el bucket de la memoria (S3); el servidor lo relee cada minuto y la junta con mando
 * lo cambia por /api/interruptores. Sin S3, quedan en memoria del proceso. Lo que no está en el JSON
 * toma el valor de siempre (POR_OMISION): sin tocar nada, nada cambia.
 *
 * TRAS UN REINICIO (revisión de seguridad, fase 05): antes se leían de forma perezosa (`leidoEn = 0`): el primer turno
 * corría con los valores POR OMISIÓN mientras la lectura iba de fondo, y si S3 fallaba seguían así. Un interruptor que la
 * junta apagó (el modelo chico, el motor nuevo de la voz) volvía a encenderse solo con cada despliegue. Ahora:
 *  · el servidor los PRECARGA al arrancar, antes de aceptar turnos (`precargarInterruptores`, con tope corto);
 *  · cada lectura o cambio bueno deja una copia en disco (`ULTRON_INTERRUPTORES_ARCHIVO`, o data/interruptores.json):
 *    si S3 no contesta al arrancar, valen los ÚLTIMOS CONOCIDOS de esa copia (y el proceso los toma ya al cargar);
 *  · si no hay ni S3 ni copia, falla a lo seguro: lo que es peligroso encendido por error arranca APAGADO
 *    (SEGURO_SI_NO_SE_SABE) hasta que S3 conteste. Un fallo de lectura de fondo nunca vuelve a los valores por omisión.
 */
import fs from 'node:fs';
import path from 'node:path';
import { s3GetJson, s3Listo, s3PutJson } from './s3';

export type Interruptores = {
  /** El modelo chico de la T4 contesta saludos y charla ligera (lib/cognitivo/modelos.ts). */
  modeloChico: boolean;
  /** Los turnos hablados usan el system corto (server/prompt-turno.ts, compacto). */
  vozCompacta: boolean;
  /** Cuánto se espera el reintento de ElevenLabs antes de cortar un turno sin oyente (ms). */
  graciaReintentoMs: number;
  /** Cuándo dice la llamada su frase de espera si el cerebro no habló (ms; 0 la apaga). */
  puenteVozMs: number;
  /**
   * Cuánto sigue abierta la respuesta de un turno hablado que le pidió algo al teléfono antes de hacerlo
   * (ms). Con el turno especulativo de ElevenLabs, si la persona seguía hablando la petición se cierra en
   * ese rato y la acción no se hace (server/voz-agente.ts, RetencionAcciones). 0: se hace al terminar.
   */
  confirmarAccionVozMs: number;
  /**
   * La voz de la llamada actúa las marcas del cerebro ([risa] → [laughs]) y el tono de la emoción del
   * turno ([warmly]…), como la mesa web con v4. Los agentes están en eleven_v4_turbo con modo expresivo.
   * false: se quitan, como antes.
   */
  etiquetasVoz: boolean;
  /**
   * Las cuentas (correos) que prueban el motor nuevo de la llamada, Speech Engine (server/voz-motor.ts,
   * docs/voz/SPEECH-ENGINE.md). Vacío: nadie, todo por el agente de siempre. Además hace falta el motor
   * encendido en el servidor (AURA_MOTOR_VOZ=speech-engine); sin eso esta lista no hace nada.
   */
  motorVozCuentas: string[];
};

export const POR_OMISION: Interruptores = {
  modeloChico: true,
  vozCompacta: true,
  graciaReintentoMs: 2_500,
  puenteVozMs: 3_000,
  confirmarAccionVozMs: 1_000,
  etiquetasVoz: true,
  motorVozCuentas: [],
};

/** Lo que se acepta de cada uno: los números con su rango (un valor fuera de rango no se guarda). */
const RANGOS: Partial<Record<keyof Interruptores, [number, number]>> = {
  graciaReintentoMs: [0, 10_000],
  puenteVozMs: [0, 3_500],
  confirmarAccionVozMs: [0, 5_000],
};

/**
 * Lo que arranca APAGADO si no se puede saber lo guardado (ni S3 ni la copia en disco): lo que hace daño encendido por
 * error. El modelo chico contesta en lugar del grande, las etiquetas se actúan en la voz y el motor nuevo de la llamada
 * se prueba con cuentas reales: apagados, todo sigue por el camino de siempre (más lento, nunca roto).
 */
export const SEGURO_SI_NO_SE_SABE: Partial<Interruptores> = { modeloChico: false, etiquetasVoz: false, motorVozCuentas: [] };

const CLAVE_S3 = 'aura/interruptores.json';
/** Dónde se guardan (S3; las pruebas ponen uno en memoria). */
let almacen = { listo: s3Listo, leer: s3GetJson, guardar: s3PutJson };
const RELEER_MS = 60_000;
/** Lo más que el arranque espera a S3 antes de seguir con la copia en disco (o lo seguro). */
export const TOPE_PRECARGA_MS = 2_000;

/** La copia en disco de los últimos conocidos. Bajo el corredor de pruebas, solo si se pide (no ensucia data/). */
function archivoCopia(): string | null {
  if (process.env.ULTRON_INTERRUPTORES_ARCHIVO) return process.env.ULTRON_INTERRUPTORES_ARCHIVO;
  return process.env.NODE_TEST_CONTEXT ? null : path.join(process.cwd(), 'data', 'interruptores.json');
}
/** Lo guardado en la copia (solo lo válido), o null si no hay copia legible. */
function leerCopia(): Partial<Interruptores> | null {
  const f = archivoCopia();
  if (!f) return null;
  try {
    return validar(JSON.parse(fs.readFileSync(f, 'utf8')));
  } catch {
    return null;
  }
}
function escribirCopia(i: Interruptores) {
  const f = archivoCopia();
  if (!f) return;
  try {
    fs.mkdirSync(path.dirname(f), { recursive: true });
    const tmp = `${f}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(i));
    fs.renameSync(tmp, f);
  } catch (e: any) {
    console.warn('[interruptores] no pude guardar la copia local:', String(e?.message || e).slice(0, 120));
  }
}

/** Al cargar el módulo ya valen los últimos conocidos de la copia en disco (si la hay; ver abajo de `validar`). */
let actuales: Interruptores = { ...POR_OMISION };
let leidoEn = 0;
let leyendo: Promise<void> | null = null;
/** Sube con cada cambio guardado: una lectura que empezó antes no pisa lo recién guardado. */
let generacion = 0;

/** Una lista de correos: en minúsculas, sin repetir, como mucho MAX_CUENTAS; una lista con algo que no es correo no se guarda. */
const MAX_CUENTAS = 50;
function listaDeCorreos(v: unknown): string[] | null {
  if (!Array.isArray(v) || v.length > MAX_CUENTAS) return null;
  const out: string[] = [];
  for (const x of v) {
    const c = typeof x === 'string' ? x.trim().toLowerCase() : '';
    if (!/^[^\s@]{1,64}@[^\s@]{1,190}\.[a-z]{2,24}$/.test(c)) return null;
    if (!out.includes(c)) out.push(c);
  }
  return out;
}

/** Solo las claves conocidas y con el tipo y el rango correctos. Lo demás se descarta. */
export function validar(cambios: unknown): Partial<Interruptores> {
  const out: Partial<Interruptores> = {};
  if (!cambios || typeof cambios !== 'object') return out;
  for (const [k, v] of Object.entries(cambios as Record<string, unknown>)) {
    if (!(k in POR_OMISION)) continue;
    const clave = k as keyof Interruptores;
    const base = POR_OMISION[clave];
    if (Array.isArray(base)) {
      const l = listaDeCorreos(v);
      if (l) (out as any)[clave] = l;
    } else if (typeof base === 'boolean' && typeof v === 'boolean') (out as any)[clave] = v;
    else if (typeof base === 'number' && typeof v === 'number' && Number.isFinite(v)) {
      const [min, max] = RANGOS[clave] ?? [-Infinity, Infinity];
      if (v >= min && v <= max) (out as any)[clave] = Math.round(v);
    }
  }
  return out;
}

// Los últimos conocidos (la copia en disco), ya al cargar: un turno antes de la precarga tampoco usa los por omisión.
actuales = { ...POR_OMISION, ...(leerCopia() ?? {}) };

function releer() {
  if (leyendo || !almacen.listo()) return;
  const gen = generacion;
  leyendo = almacen.leer(CLAVE_S3)
    .then((r) => {
      if (gen !== generacion) return;
      // Un fallo deja lo que había (los últimos conocidos), nunca vuelve a los por omisión.
      if (r.ok || r.missing) {
        actuales = { ...POR_OMISION, ...(r.ok ? validar(r.json) : {}) };
        escribirCopia(actuales);
      }
    })
    .catch(() => undefined)
    .finally(() => {
      leidoEn = Date.now();
      leyendo = null;
    });
}

/** El valor de un interruptor ahora. Nunca espera: si toca releer, se relee de fondo. */
export function interruptor<K extends keyof Interruptores>(k: K): Interruptores[K] {
  if (Date.now() - leidoEn > RELEER_MS) releer();
  return actuales[k];
}

export function todosLosInterruptores(): Interruptores {
  return { ...actuales };
}

export type OrigenPrecarga = 's3' | 'copia' | 'seguro' | 'sin_s3';

/**
 * Al arrancar, ANTES de aceptar turnos: lee lo guardado en S3 con tope (`topeMs`). Bien → esos (y la copia en disco al
 * día). S3 falla o tarda → los últimos conocidos de la copia en disco; sin copia → lo seguro (SEGURO_SI_NO_SE_SABE). Sin
 * S3 configurado → la copia en disco (lo último que se fijó en esta máquina) o los por omisión. Nunca lanza.
 */
export async function precargarInterruptores(topeMs = TOPE_PRECARGA_MS): Promise<OrigenPrecarga> {
  const gen = generacion;
  if (!almacen.listo()) {
    actuales = { ...POR_OMISION, ...(leerCopia() ?? {}) };
    leidoEn = Date.now();
    return 'sin_s3';
  }
  let reloj: ReturnType<typeof setTimeout> | undefined;
  const r = await Promise.race([
    almacen.leer(CLAVE_S3).catch((e) => ({ ok: false, json: null, detalle: String(e?.message || e), missing: false })),
    new Promise<null>((ok) => {
      reloj = setTimeout(() => ok(null), topeMs);
    }),
  ]).finally(() => clearTimeout(reloj));
  // Un cambio guardado mientras tanto manda.
  if (gen !== generacion) return 's3';
  leidoEn = Date.now();
  if (r && (r.ok || r.missing)) {
    actuales = { ...POR_OMISION, ...(r.ok ? validar(r.json) : {}) };
    escribirCopia(actuales);
    return 's3';
  }
  const copia = leerCopia();
  if (copia) {
    actuales = { ...POR_OMISION, ...copia };
    console.warn('[interruptores] S3 no contestó al arrancar: valen los últimos conocidos (copia local).');
    return 'copia';
  }
  actuales = { ...POR_OMISION, ...SEGURO_SI_NO_SE_SABE };
  // Se vuelve a intentar pronto (no en un minuto): lo seguro es provisional.
  leidoEn = Date.now() - RELEER_MS + 5_000;
  console.warn('[interruptores] S3 no contestó al arrancar y no hay copia local: lo peligroso arranca apagado hasta saberlo.');
  return 'seguro';
}

/** Cambia los interruptores (solo las claves válidas) y los guarda. Devuelve cómo quedaron. */
export async function fijarInterruptores(cambios: unknown): Promise<{ ok: boolean; interruptores: Interruptores; detalle: string; descartados: string[] }> {
  const validos = validar(cambios);
  const descartados = cambios && typeof cambios === 'object' ? Object.keys(cambios).filter((k) => !(k in validos)) : [];
  if (!almacen.listo()) {
    const nuevos = { ...actuales, ...validos };
    actuales = nuevos;
    leidoEn = Date.now();
    escribirCopia(actuales);
    return { ok: true, interruptores: { ...actuales }, detalle: 'Sin S3: quedan en este proceso hasta el próximo despliegue.', descartados };
  }
  // Se mezcla con lo GUARDADO, no con lo que este proceso tenga en memoria: recién arrancado (o con la
  // primera lectura en vuelo) solo tiene los valores por omisión, y guardar un interruptor borraba los demás.
  generacion++;
  if (leyendo) await leyendo;
  const leido = await almacen.leer(CLAVE_S3);
  if (!leido.ok && !leido.missing) {
    return { ok: false, interruptores: { ...actuales }, detalle: 'No pude leer los interruptores guardados; no se cambió nada.', descartados };
  }
  const guardados = leido.ok ? validar(leido.json) : {};
  const nuevos = { ...POR_OMISION, ...guardados, ...validos };
  // Solo lo que difiere de lo de siempre: si mañana cambia un valor por omisión, el JSON no lo tapa.
  const guardar = Object.fromEntries(Object.entries(nuevos).filter(([k, v]) => JSON.stringify(POR_OMISION[k as keyof Interruptores]) !== JSON.stringify(v)));
  const r = await almacen.guardar(CLAVE_S3, guardar);
  if (r.ok) {
    generacion++;
    actuales = nuevos;
    leidoEn = Date.now();
    escribirCopia(actuales);
  }
  return { ok: r.ok, interruptores: { ...actuales }, detalle: r.ok ? 'Guardado.' : r.detalle, descartados };
}

/** Solo pruebas. `arranque`: como un proceso recién arrancado (los de la copia en disco, sin haber leído S3). */
export function _reiniciarInterruptores(otro?: Partial<typeof almacen>, o: { arranque?: boolean } = {}) {
  almacen = { listo: s3Listo, leer: s3GetJson, guardar: s3PutJson, ...otro };
  actuales = o.arranque ? { ...POR_OMISION, ...(leerCopia() ?? {}) } : { ...POR_OMISION };
  leidoEn = o.arranque ? 0 : Date.now();
  leyendo = null;
}
