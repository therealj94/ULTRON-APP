/**
 * LO COMÚN DEL CEREBRO CONTINUO (lib/episodios.ts, lib/abiertos.ts, lib/conocer-persona.ts,
 * lib/circulo.ts, lib/triaje.ts):
 *
 *   · de QUIÉN es lo guardado (`clavePersona`): José es el mismo en el teléfono, la web y Telegram;
 *   · un CAJÓN por persona que se guarda como el perfil (lib/perfil-persona.ts): caché del proceso,
 *     disco y S3, y que NUNCA sube nada a S3 si no lo pudo leer antes (si no, un redespliegue con S3
 *     caído pisaría la memoria buena con un cajón vacío: PerfilNoDisponible, lib/memoria-miembro.ts);
 *   · una pregunta corta al modelo, con tope de tiempo y null si no está (quien llama tiene sus reglas);
 *   · texto: plegar, palabras, recortar, tapar secretos.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { nivelDe, personaPorCorreoExacto, personaPorId } from './acceso';
import { redactar } from './cognitivo/base';
import { modeloChicoConfigurado, preguntarModeloChico } from './cognitivo/modelos';
import { ESPACIO_COMUN } from './espacio-nodo';
import { fetchNodo, NODO_MODELO, NODO_SECRETO, NODO_URL } from './nodo';
import { s3GetJson, s3Listo, s3PutJson } from './s3';

/* ------------------------------------------------------------------ de quién */

/**
 * La llave de una persona. Una persona del padrón de AU-RA (José) es `junta:<id>` venga por su correo
 * de la sesión o por su id (Telegram): así lo que AU-RA aprende en el teléfono lo sabe en Telegram.
 * Cualquier otra persona, por su correo en minúsculas. Vacío si no hay nadie.
 */
export function clavePersona(quien: string | null | undefined): string {
  const q = String(quien || '').trim().toLowerCase();
  if (!q) return '';
  try {
    if (q.includes('@')) {
      const p = personaPorCorreoExacto(q);
      return p && nivelDe(p, 'ultron') ? `junta:${p.id}` : q;
    }
    if (q.startsWith('junta:')) return q;
    const p = personaPorId(q);
    if (p && nivelDe(p, 'ultron')) return `junta:${p.id}`;
  } catch {
    /* el padrón no se pudo leer: se usa tal cual */
  }
  return q;
}

export function huellaDe(prefijo: string, clave: string): string {
  return crypto.createHash('sha256').update(`${prefijo}:${clave}`).digest('hex').slice(0, 40);
}

/* ------------------------------------------------------------------ el cajón por persona */

/** No se pudo leer lo guardado (S3 no contestó): no se escribe encima de lo que no se vio. */
export class CajonNoDisponible extends Error {
  constructor(que = 'lo guardado') {
    super(`No pude leer ${que} en este momento; no guardé nada para no pisarlo. Prueba otra vez en un rato.`);
    this.name = 'CajonNoDisponible';
  }
}

export type Lectura<T> = { ok: true; valor: T } | { ok: false };

export type Cajones<T> = {
  /** Caché → disco → S3. `{ ok: false }` si S3 no contestó y no hay nada local (no queda en caché). */
  leer(clave: string): Promise<Lectura<T>>;
  /** Lo que haya en la caché, sin esperar a nada (el turno no espera a S3). */
  enCache(clave: string): T | undefined;
  /**
   * Lee, cambia y guarda, en orden (una llave a la vez). Lanza CajonNoDisponible si no se pudo leer:
   * nada se sube. `durable`: llegó a S3 (o no hay S3 y el disco se declaró duradero).
   */
  modificar<R = void>(clave: string, fn: (v: T) => R): Promise<{ valor: T; resultado: R; durable: boolean }>;
  /** Solo pruebas: como tras un redespliegue (sin caché; el disco sigue). */
  _olvidarCache(): void;
  carpeta(): string;
};

export function crearCajones<T>(o: {
  /** Para los avisos del log y la huella: «episodios», «abiertos»… */
  nombre: string;
  /** `ultron/<prefijo>/<huella>.json` */
  prefijoS3: string;
  /** Variable de entorno con la carpeta del disco (las pruebas la apuntan a un temporal). */
  dirEnv: string;
  dirPorOmision: string;
  /** Si `dirEnv` no está: otra carpeta (vacío = la de `data/<dirPorOmision>`). */
  carpetaPorOmision?: () => string;
  vacio: () => T;
  sanear: (raw: unknown) => T;
  maxEnCache?: number;
}): Cajones<T> {
  const cache = new Map<string, T>();
  const colas = new Map<string, Promise<unknown>>();
  /** Cuántos cambios lleva cada clave: una lectura lenta que empezó antes de uno no pisa la caché. */
  const generaciones = new Map<string, number>();
  const maxCache = o.maxEnCache ?? 1000;
  const carpeta = () => process.env[o.dirEnv] || o.carpetaPorOmision?.() || path.join(process.cwd(), 'data', o.dirPorOmision);
  const archivo = (clave: string) => path.join(carpeta(), `${huellaDe(o.nombre, clave)}.json`);
  const claveS3 = (clave: string) => `ultron/${o.prefijoS3}/${huellaDe(o.nombre, clave)}.json`;

  const ponerEnCache = (clave: string, v: T) => {
    cache.delete(clave);
    cache.set(clave, v);
    if (cache.size > maxCache) for (const k of [...cache.keys()].slice(0, cache.size - maxCache)) cache.delete(k);
  };

  const leerDisco = (clave: string): T | null => {
    try {
      return o.sanear(JSON.parse(fs.readFileSync(archivo(clave), 'utf8')));
    } catch {
      return null;
    }
  };

  const escribirDisco = (clave: string, v: T): boolean => {
    try {
      fs.mkdirSync(carpeta(), { recursive: true });
      const f = archivo(clave);
      fs.writeFileSync(`${f}.tmp`, JSON.stringify(v));
      fs.renameSync(`${f}.tmp`, f);
      return true;
    } catch (e: any) {
      console.warn(`[${o.nombre}] no pude escribir el disco`, String(e?.message || e).slice(0, 120));
      return false;
    }
  };

  async function leer(clave: string): Promise<Lectura<T>> {
    if (!clave) return { ok: true, valor: o.vacio() };
    const hit = cache.get(clave);
    if (hit) {
      ponerEnCache(clave, hit);
      return { ok: true, valor: hit };
    }
    let v = leerDisco(clave);
    if (!v && s3Listo()) {
      const g = generaciones.get(clave) || 0;
      const r = await s3GetJson(claveS3(clave)).catch(() => ({ ok: false, json: null }) as { ok: boolean; json: unknown });
      // Revisión del 6-oct: mientras S3 contestaba se guardó un cambio (modificar): lo leído es de antes y
      // no va a la caché ni al disco, o el siguiente cambio partiría de lo viejo (lo borrado volvería).
      if ((generaciones.get(clave) || 0) !== g) return leer(clave);
      if (r.ok && r.json) {
        v = o.sanear(r.json);
        escribirDisco(clave, v);
      } else if (!r.ok) {
        // S3 no contestó: no se guarda «vacío» en la caché, o no volvería a preguntar.
        return { ok: false };
      }
    }
    const final = v || o.vacio();
    ponerEnCache(clave, final);
    return { ok: true, valor: final };
  }

  function modificar<R>(clave: string, fn: (v: T) => R): Promise<{ valor: T; resultado: R; durable: boolean }> {
    const previa = colas.get(clave) || Promise.resolve();
    const paso = previa.then(async () => {
      const l = await leer(clave);
      if (!l.ok) throw new CajonNoDisponible();
      // Sobre una copia: si `fn` lanza a medias, la caché queda como estaba y no se guarda nada.
      const copia = o.sanear(JSON.parse(JSON.stringify(l.valor)));
      const resultado = fn(copia);
      ponerEnCache(clave, copia);
      generaciones.set(clave, (generaciones.get(clave) || 0) + 1);
      const enDisco = escribirDisco(clave, copia);
      if (!s3Listo()) return { valor: copia, resultado, durable: enDisco && discoDurable() };
      const r = await s3PutJson(claveS3(clave), copia).catch((e) => ({ ok: false, detalle: String(e?.message || e) }));
      if (!r.ok) console.warn(`[${o.nombre}] S3 no guardó`, String((r as any).detalle || '').slice(0, 120));
      return { valor: copia, resultado, durable: r.ok };
    });
    const cola = paso.catch(() => undefined);
    colas.set(clave, cola);
    void cola.then(() => {
      if (colas.get(clave) === cola) colas.delete(clave);
    });
    return paso;
  }

  return {
    leer,
    enCache: (clave) => cache.get(clave),
    modificar,
    _olvidarCache: () => cache.clear(),
    carpeta,
  };
}

/** Igual que lib/perfil-persona.ts: el disco solo es duradero si quien despliega lo declara. */
export function discoDurable(): boolean {
  return process.env.PERFIL_DISCO_DURABLE === '1' || process.env.PERFIL_DISCO_DURABLE === 'true';
}

/* ------------------------------------------------------------------ el modelo, corto y con tope */

export type ModeloTexto = (system: string, user: string, o?: { timeoutMs?: number; temperatura?: number }) => Promise<string | null>;

let modeloDePrueba: ModeloTexto | null | undefined;

/** Solo pruebas: un modelo falso (o `null` para «el modelo no está»). `undefined` vuelve al de verdad. */
export function _usarModeloPrueba(m: ModeloTexto | null | undefined) {
  modeloDePrueba = m;
}

/**
 * Una pregunta corta al nodo (sin historial ni harness) en el espacio común (lib/espacio-nodo.ts), para no
 * borrarle lo leído a quien esté hablando. Si el nodo no está, el modelo chico si está activo. Devuelve el
 * texto o null. Nunca lanza.
 */
export const preguntarModelo: ModeloTexto = async (system, user, o = {}) => {
  if (modeloDePrueba !== undefined) {
    if (!modeloDePrueba) return null;
    try {
      return await modeloDePrueba(system, user, o);
    } catch {
      return null;
    }
  }
  const ms = o.timeoutMs ?? 20_000;
  if (NODO_URL && NODO_SECRETO) {
    try {
      const r = await fetchNodo(`${NODO_URL}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-ultron-secreto': NODO_SECRETO },
        body: JSON.stringify({
          model: NODO_MODELO,
          stream: false,
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: user },
          ],
          options: { temperature: o.temperatura ?? 0.2, id_slot: ESPACIO_COMUN },
        }),
        signal: AbortSignal.timeout(ms),
      });
      if (r.ok) {
        let texto = '';
        for (const linea of (await r.text()).split('\n')) {
          try {
            const j = JSON.parse(linea);
            texto += j?.message?.content || j?.response || '';
          } catch {
            /* línea parcial */
          }
        }
        texto = sinPensamiento(texto);
        if (texto) return texto;
      }
    } catch {
      /* cae al chico o a null */
    }
  }
  if (modeloChicoConfigurado()) {
    const r = await preguntarModeloChico([
      { role: 'system', content: system },
      { role: 'user', content: user },
    ]).catch(() => null);
    if (r?.texto) return sinPensamiento(r.texto);
  }
  return null;
};

export function sinPensamiento(s: string): string {
  return String(s || '')
    .replace(/<think>[\s\S]*?<\/think>/g, '')
    .replace(/^[\s\S]*?<\/think>/, '')
    .trim();
}

/** El primer objeto (o arreglo) JSON de una respuesta del modelo, aunque venga con ```json o con prosa. */
export function extraerJson(raw: unknown): any | null {
  const s = sinPensamiento(String(raw ?? '')).replace(/```(?:json)?/gi, '');
  for (const [abre, cierra] of [
    ['{', '}'],
    ['[', ']'],
  ] as const) {
    const i = s.indexOf(abre);
    const j = s.lastIndexOf(cierra);
    if (i >= 0 && j > i) {
      try {
        return JSON.parse(s.slice(i, j + 1));
      } catch {
        /* sigue */
      }
    }
  }
  return null;
}

/* ------------------------------------------------------------------ texto */

export function plegar(s: string): string {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Una línea limpia: sin control ni saltos (va al prompt), recortada en una palabra. */
export function linea(v: unknown, max = 300): string {
  const s = String(v ?? '')
    .replace(/[\u0000-\u001f\u007f\u2028\u2029]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (s.length <= max) return s;
  return `${s.slice(0, max - 1).replace(/\s+\S*$/, '')}…`;
}

/**
 * Lo que escribió otra gente (un WhatsApp, un correo) y va al prompt como DATO: una línea, sin marcas que
 * el harness pudiera leer como pedido de herramienta, entre comillas.
 */
export function comoDato(v: unknown, max = 160): string {
  return linea(String(v ?? '').replace(/PEDIR_HERRAMIENTA\s*:?/gi, '[pedido]').replace(/[«»]/g, '"'), max);
}

const VACIAS = new Set(
  (
    'que con para por los las una uno unos unas del este esta esto ese esa eso como pero mas muy hay fue ser son era sus mis tus ' +
    'nos les ella ellos yo tu el la lo le se de en y o a al si no ya me te mi su asi bien tambien cuando donde porque solo sobre ' +
    'entre hasta desde todo toda todos todas otra otro algo nada aqui alli hoy ayer manana tiene tengo tienes hace hacer dice dijo ' +
    'quiero quieres puedes puedo vamos voy esta estan estoy estas eres soy aura jose usted ustedes vos dale okay gracias hola buenas'
  ).split(' ')
);

/** Palabras con contenido (plegadas, sin vacías, raíz simple sin plural). */
export function palabras(s: string): string[] {
  return plegar(s)
    .split(/[^a-z0-9ñ]+/)
    .filter((w) => w.length >= 3 && !VACIAS.has(w))
    .map((w) => (w.length > 4 && w.endsWith('es') ? w.slice(0, -2) : w.length > 3 && w.endsWith('s') ? w.slice(0, -1) : w));
}

/** Parecido de dos textos por sus palabras (Jaccard). */
export function parecido(a: string, b: string): number {
  const A = new Set(palabras(a));
  const B = new Set(palabras(b));
  if (!A.size || !B.size) return plegar(a) === plegar(b) ? 1 : 0;
  let comun = 0;
  for (const w of A) if (B.has(w)) comun++;
  return comun / (A.size + B.size - comun);
}

/**
 * ¿Es un secreto? Contraseñas, claves, PIN, números de tarjeta, frases de recuperación: nada de eso se
 * guarda en la memoria aunque la persona lo diga (lo que se guarda va al prompt y a S3).
 */
export function esSecreto(texto: string): boolean {
  const t = plegar(texto);
  if (redactar(String(texto || '')) !== String(texto || '')) return true;
  return (
    /\b(contrasena|password|passwd|clave|pin|token|cvv|cvc|codigo de (seguridad|verificacion|acceso)|frase (semilla|de recuperacion)|seed phrase|semilla|llave privada|private key|usuario y clave)\b/.test(t) ||
    /\b(?:\d[ -]?){13,19}\b/.test(t)
  );
}

/** Hora de Honduras (UTC−6, sin horario de verano). */
export const ZONA_HN = 'America/Tegucigalpa';

export function diaHN(t: number): string {
  return new Date(t - 6 * 3600_000).toISOString().slice(0, 10);
}

/** «hoy», «ayer», «hace 3 días», «el 12-sep». */
export function haceCuanto(t: number, ahora = Date.now()): string {
  const d0 = Date.parse(`${diaHN(t)}T00:00:00Z`);
  const d1 = Date.parse(`${diaHN(ahora)}T00:00:00Z`);
  const dias = Math.round((d1 - d0) / 86_400_000);
  if (dias <= 0) return 'hoy';
  if (dias === 1) return 'ayer';
  if (dias < 7) return `hace ${dias} días`;
  const meses = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
  const [, m, d] = diaHN(t).split('-').map(Number);
  return `el ${d}-${meses[m - 1]}`;
}

/** Junta líneas bajo un encabezado sin pasarse de `max` caracteres (las que no caben no van). */
export function bloqueConTope(encabezado: string, lineas: string[], max: number): string {
  if (!lineas.length) return '';
  let out = encabezado;
  for (const l of lineas) {
    const sig = `${out}\n${l}`;
    if (sig.length > max) {
      if (out === encabezado) {
        // Ni una cabe entera: va recortada.
        const resto = max - out.length - 2;
        if (resto > 40) out = `${out}\n${linea(l, resto)}`;
      }
      break;
    }
    out = sig;
  }
  return out === encabezado ? '' : out;
}

export function nuevoId(prefijo: string): string {
  return `${prefijo}_${Date.now().toString(36)}${crypto.randomBytes(3).toString('hex')}`;
}
