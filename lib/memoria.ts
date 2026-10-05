/**
 * Memoria durable por miembro de junta (José / Medardo / Carlos / Mayra) + hechos compartidos.
 * Disco local = caché. S3 = la copia que no se pierde al redesplegar Render.
 */

import fs from 'node:fs';
import path from 'node:path';
import { esHechoLargo, semillaLarga } from '../server/hechos';
import { miembrosUltron, nombreDe, puedeCambiarSistema, quienEs, type MiembroId } from './junta';
import { bucketMemoria, s3GetJson, s3Listo, s3PutJson } from './s3';
import { capasHilo, type HiloMemoria } from './conversacion';
import type { NivelAura } from './perfiles/tipos';
import type { VistaTexto } from './conocer-persona';

export type CanalMem = 'mesa' | 'telegram' | 'sistema';

export type TurnoMem = { rol: 'user' | 'ultron'; texto: string; t: number; canal: CanalMem };
export type HechoMem = { hecho: string; t: number; quien: MiembroId | 'junta'; canal: CanalMem };
export type CambioMem = { t: number; quien: MiembroId | 'junta'; canal: CanalMem; que: string };

export type PerfilMem = { corta: TurnoMem[]; larga: HechoMem[] };

export type Almacen = {
  version: 1;
  perfiles: Record<MiembroId, PerfilMem>;
  junta: { larga: HechoMem[] };
  cambios: CambioMem[];
};

const FILE = path.join(process.cwd(), 'data', 'memoria-junta.json');
const S3_KEY = 'ultron/memoria-junta.json';
const MAX_CORTA = 120;
const MAX_LARGA = 80;
const MAX_CAMBIOS = 120;

let cache: Almacen | null = null;
let loaded = false;
let lastVia: 's3' | 'disco' = 'disco';
let lastS3: string = 'aún no sincronizado';
let writing: Promise<void> = Promise.resolve();
/**
 * S3 no se pudo LEER (red, permisos, JSON roto; no un 404): lo que hay en memoria puede ser el disco vacío
 * de un despliegue nuevo, así que no se sube nada hasta leer S3 de verdad (si no, pisaría la copia buena).
 * Se vuelve a intentar leer como mucho cada REINTENTO_S3_MS.
 */
let s3SinLeer = false;
let reintentoS3 = 0;
const REINTENTO_S3_MS = 30_000;

function vacio(): Almacen {
  const perfiles: Record<MiembroId, PerfilMem> = {};
  for (const id of Object.keys(miembrosUltron())) perfiles[id] = { corta: [], larga: [] };
  return {
    version: 1,
    perfiles,
    junta: {
      larga: semillaLarga().map((x) => ({ hecho: x.hecho, t: x.t, quien: 'junta' as const, canal: 'sistema' as const })),
    },
    cambios: [],
  };
}

function migrar(raw: any): Almacen {
  const base = vacio();
  if (!raw || typeof raw !== 'object') return base;
  if (raw.version === 1 && raw.perfiles?.jose && raw.perfiles?.medardo) {
    const a = raw as Almacen;
    for (const id of Object.keys(miembrosUltron())) {
      if (!a.perfiles[id]) a.perfiles[id] = { corta: [], larga: [] };
    }
    if (!Array.isArray(a.junta?.larga) || !a.junta.larga.length) a.junta = base.junta;
    a.cambios = Array.isArray(a.cambios) ? a.cambios : [];
    return a;
  }
  // Formato viejo data/memoria.json: una sola pila mezclada.
  if (Array.isArray(raw.larga)) {
    base.junta.larga = raw.larga.map((x: any) => ({
      hecho: String(x.hecho || x),
      t: Number(x.t || 0),
      quien: 'junta' as const,
      canal: 'sistema' as const,
    }));
  }
  if (Array.isArray(raw.corta)) {
    base.perfiles.jose.corta = raw.corta.slice(0, MAX_CORTA).map((x: any) => ({
      rol: x.rol === 'ultron' ? 'ultron' : 'user',
      texto: String(x.texto || ''),
      t: Number(x.t || 0),
      canal: 'mesa' as const,
    }));
  }
  return base;
}

function leerDisco(): Almacen {
  try {
    return migrar(JSON.parse(fs.readFileSync(FILE, 'utf8')));
  } catch {
    try {
      return migrar(JSON.parse(fs.readFileSync(path.join(process.cwd(), 'data', 'memoria.json'), 'utf8')));
    } catch {
      return vacio();
    }
  }
}

function escribirDisco(a: Almacen) {
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  const tmp = FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(a));
  fs.renameSync(tmp, FILE);
}

/** Lo de `extra` que `base` no tiene: turnos más nuevos que el último de base y hechos que no estaban. */
export function juntarAlmacen(base: Almacen, extra: Almacen): Almacen {
  const ultimo = (xs: { t: number }[]) => xs.reduce((m, x) => Math.max(m, x.t), 0);
  const hechos = (a: HechoMem[], b: HechoMem[]) => [...b.filter((h) => !a.some((x) => x.hecho === h.hecho)), ...a].slice(0, MAX_LARGA);
  const out: Almacen = { ...base, perfiles: { ...base.perfiles }, junta: { larga: hechos(base.junta.larga, extra.junta.larga) } };
  for (const [id, p] of Object.entries(extra.perfiles)) {
    const b = out.perfiles[id] || { corta: [], larga: [] };
    const desde = ultimo(b.corta);
    out.perfiles[id] = { corta: [...b.corta, ...p.corta.filter((x) => x.t > desde)].slice(-MAX_CORTA), larga: hechos(b.larga, p.larga) };
  }
  const desdeCambio = ultimo(base.cambios);
  out.cambios = [...base.cambios, ...extra.cambios.filter((c) => c.t > desdeCambio)].slice(-MAX_CAMBIOS);
  return out;
}

export async function cargarMemoria(): Promise<Almacen> {
  if (loaded && cache) return cache;
  if (s3SinLeer && cache && Date.now() < reintentoS3) return cache;
  const disco = leerDisco();
  if (s3Listo()) {
    const r = await s3GetJson(S3_KEY).catch((e) => ({ ok: false, json: null, detalle: String(e?.message || e), missing: false }));
    if (r.ok && r.json) {
      const leida = migrar(r.json);
      // Lo que se anotó mientras S3 no se dejaba leer (turnos, hechos) no se pierde al volver: se junta con
      // lo leído y se sube. Olvidar en ese rato no se pudo (503), así que juntar nunca revive algo borrado.
      const pendiente = s3SinLeer && cache ? cache : null;
      cache = pendiente ? juntarAlmacen(leida, pendiente) : leida;
      lastVia = 's3';
      lastS3 = pendiente ? 'leído de S3 (y junté lo anotado mientras no se podía leer)' : 'leído de S3';
      s3SinLeer = false;
      escribirDisco(cache);
      loaded = true;
      if (pendiente) await persistirMemoria();
      return cache;
    }
    if (r.ok && r.missing) {
      cache = disco;
      lastVia = 's3';
      lastS3 = 'S3 vacío; usé disco y voy a crear el objeto';
      s3SinLeer = false;
      loaded = true;
      await persistirMemoria();
      return cache;
    }
    // No se pudo leer: se sigue con el disco, pero sin subir nada y volviendo a intentar pronto.
    cache = cache || disco;
    lastVia = 'disco';
    lastS3 = `${r.detalle} (no subo nada a S3 hasta poder leerlo)`;
    s3SinLeer = true;
    reintentoS3 = Date.now() + REINTENTO_S3_MS;
    loaded = false;
    return cache;
  }
  cache = disco;
  lastVia = 'disco';
  lastS3 = 'Sin ULTRON_MEMORIA_BUCKET o AWS_*. El disco de Render se borra al redesplegar.';
  loaded = true;
  return cache;
}

export async function persistirMemoria(): Promise<{ via: 's3' | 'disco'; detalle: string }> {
  if (!cache) cache = leerDisco();
  escribirDisco(cache);
  if (!s3Listo()) {
    lastVia = 'disco';
    lastS3 = 'Sin S3. Memoria solo en disco (se pierde al redesplegar).';
    return { via: 'disco', detalle: lastS3 };
  }
  if (s3SinLeer) {
    lastVia = 'disco';
    return { via: 'disco', detalle: lastS3 };
  }
  const r = await s3PutJson(S3_KEY, cache);
  lastVia = r.ok ? 's3' : 'disco';
  lastS3 = r.ok ? 'guardado en S3' : r.detalle;
  return { via: lastVia, detalle: lastS3 };
}

function enqueue(fn: () => Promise<void>) {
  writing = writing.then(fn, fn);
  return writing;
}

/** S3 no se pudo leer todavía: lo que se cambie ahora no llega a S3 (olvidar no borraría la copia guardada). */
export function memoriaSinLeer(): boolean {
  return s3SinLeer;
}

export function estadoMemoria(): { durable: boolean; via: 's3' | 'disco'; detalle: string; bucket: boolean } {
  return {
    durable: s3Listo() && lastVia === 's3',
    via: lastVia,
    detalle: lastS3,
    bucket: s3Listo(),
  };
}

/**
 * El perfil de alguien. Se crea al vuelo si no existía: el padrón se amplía desde el entorno, así
 * que puede llegar un turno de una persona que todavía no tiene cajón. Antes eso devolvía
 * `undefined` y el turno moría en el primer `.corta`.
 */
export function perfilDe(quien: MiembroId, store?: Almacen): PerfilMem {
  const a = store || cache || leerDisco();
  if (!a.perfiles[quien]) a.perfiles[quien] = { corta: [], larga: [] };
  return a.perfiles[quien];
}

export function hiloDe(quien: MiembroId | null): TurnoMem[] {
  if (!quien) return [];
  const a = cache || leerDisco();
  return a.perfiles[quien]?.corta || [];
}

/** Lo que la persona pidió guardar a propósito (y no por nombrar «la mina» o «la junta»). */
const PEDIDO_DE_RECORDAR = /\b(recuerda|record[aá]|acu[eé]rdate|guarda|anota|apunta|no olvides)\b/i;

/**
 * `hilo`: qué parte de la conversación reciente va en este bloque (lib/conversacion.ts HiloMemoria).
 * `vista`: lo que la persona marcó «No usarlo» (server/contexto-turno.ts vistaAutorizada). Pasa por ella lo
 * SUYO —su memoria privada y su hilo—; sin saber qué está limitado, no entra nada de eso. Los hechos
 * compartidos de la junta y los cambios del sistema son de la organización, no datos personales: no se tocan.
 * El turno siempre la da.
 */
export function promptMemoria(quien: MiembroId | null, opts: { nivel?: NivelAura; nombre?: string; hilo?: HiloMemoria; vista?: VistaTexto } = {}): string {
  /*
   * Un miembro de la comunidad (entró por Genesis abierto, no está en el padrón) no tiene cajón aquí
   * y no ve NADA de la junta: ni sus hechos compartidos, ni los cambios que pidió, ni la memoria de
   * nadie. Su memoria personal vive en lib/memoria-miembro.ts; esto es solo para cuando habla sin
   * sesión (sin cuenta no hay de quién guardar).
   */
  if (opts.nivel === 'miembro') {
    const n = String(opts.nombre || '').trim() || 'un miembro de la comunidad';
    return [
      `HABLAS CON: ${n}, miembro de la comunidad de Orden Global (no es de la junta).`,
      'MEMORIA: habla sin su cuenta, así que no hay memoria guardada que usar. Usa el hilo de esta conversación; no prometas recordar ni recites nada de otras personas.',
    ].join('\n');
  }
  const a = cache || leerDisco();
  const id = quien;
  const nombre = nombreDe(id);
  const cruda = (id && a.perfiles[id]) || { corta: [], larga: [] };
  const vista = opts.vista;
  const aut = (s: string) => (vista ? vista.texto(s) : s);
  const privada = {
    larga: cruda.larga.map((h) => ({ ...h, hecho: aut(h.hecho) })).filter((h) => h.hecho.trim()),
    corta: cruda.corta.map((t) => ({ ...t, texto: aut(t.texto) })).filter((t) => t.texto.trim()),
  };
  // Sin saber qué limitó, no se dice «nada aún» (no es que no haya): no está disponible en este turno.
  const sinVista = vista && !vista.sabe ? '(no disponible en este turno: no pude confirmar lo que marcó «No usarlo»)' : '';
  const capas = capasHilo(privada.corta);
  const hilo = opts.hilo || 'todo';
  const hechosYo = privada.larga.map((h) => `- ${h.hecho}`).join('\n');
  const hechosJunta = a.junta.larga.map((h) => `- ${h.hecho}`).join('\n');
  const cambios = a.cambios
    .slice(-16)
    .map((c) => `${nombreDe(c.quien === 'junta' ? null : c.quien)} · ${c.canal} · ${c.que}`)
    .join('\n');
  const acceso = `ACCESO: ${puedeCambiarSistema(id) ? 'mando. Puede pedir redespliegue, mantenimiento y ejecutor.' : 'consulta. No cambia el sistema: sin redespliegue, sin mantenimiento, sin ejecutor. El resto del taller sí.'}`;
  if (hilo === 'firma') {
    // Lo que pidió recordar a propósito («recuerda…», «anota…») y lo de la junta (solo se guarda si se
    // pide para la junta) sí rehacen el system; lo que se guardó solo por nombrar «la mina», no.
    const pedidos = privada.larga.filter((h) => PEDIDO_DE_RECORDAR.test(h.hecho)).map((h) => `- ${h.hecho}`);
    return [`HABLAS CON: ${nombre}.`, acceso, ...pedidos, hechosJunta].join('\n');
  }
  return [
    `HABLAS CON: ${nombre}. No mezcles la conversación privada del otro miembro.`,
    id
      ? `MEMORIA LARGA / PRIVADA DE ${nombre.toUpperCase()}:\n${hechosYo || sinVista || '(nada aún)'}`
      : 'No identifiqué si es José, Medardo, Carlos o Mayra. No recito memoria privada de nadie.',
    acceso,
    `HECHOS COMPARTIDOS DE LA JUNTA:\n${hechosJunta || '(nada)'}`,
    hilo === 'todo' ? `HILO CORTO CON ${nombre.toUpperCase()} (lo último; «esto» es esto, no lo sueltes):\n${capas.corto || sinVista || '(nada)'}` : '',
    `CONVERSACIÓN MEDIANA CON ${nombre.toUpperCase()} (sigue el hilo, no la del otro):\n${capas.mediano || sinVista || '(nada)'}`,
    `CAMBIOS RECIENTES (quién los pidió):\n${cambios || '(nada)'}`,
  ]
    .filter(Boolean)
    .join('\n');
}

export async function recordarTurno(opts: {
  quien: MiembroId | null;
  rol: 'user' | 'ultron';
  texto: string;
  canal: CanalMem;
  /**
   * false: vuelve en cuanto el turno está en la memoria de este proceso y deja la copia a disco y S3
   * en la cola, sin esperarla. Es lo que usa el turno ANTES de pensar: esperar el PUT a S3 (cientos
   * de ms) retrasaba la primera palabra de cada respuesta, y la cola ya guarda en orden.
   */
  esperar?: boolean;
}): Promise<void> {
  const a = await cargarMemoria();
  const texto = String(opts.texto || '').trim().slice(0, 4000);
  if (!texto) return;
  const t = Date.now();
  if (opts.quien) {
    const p = a.perfiles[opts.quien] || (a.perfiles[opts.quien] = { corta: [], larga: [] });
    p.corta = [...p.corta, { rol: opts.rol, texto, t, canal: opts.canal }].slice(-MAX_CORTA);
    if (opts.rol === 'user' && esHechoLargo(texto)) {
      // Al pool compartido de la junta solo va lo que se pide guardar PARA la junta de forma explícita.
      // Mencionar «la mina» en una charla privada no lo convierte en hecho que vean los demás.
      const junta = /\b(recuerda|record[aá]|guarda|anota|apunta)\b[^.]{0,80}\b(para|de) la junta\b|\bpara (toda )?la junta\b/i.test(texto);
      if (junta) {
        if (!a.junta.larga.some((x) => x.hecho === texto)) {
          const item: HechoMem = { hecho: texto, t, quien: 'junta', canal: opts.canal };
          a.junta.larga = [item, ...a.junta.larga].slice(0, MAX_LARGA);
        }
      } else {
        const item: HechoMem = { hecho: texto, t, quien: opts.quien, canal: opts.canal };
        p.larga = [item, ...p.larga.filter((x) => x.hecho !== texto)].slice(0, MAX_LARGA);
      }
    }
  }
  cache = a;
  const guardado = enqueue(() => persistirMemoria().then(() => undefined));
  if (opts.esperar === false) {
    guardado.catch((e) => console.warn('[memoria] no se guardó el turno', String(e?.message || e).slice(0, 120)));
    return;
  }
  await guardado;
}

export async function registrarCambio(opts: { quien: MiembroId | null; canal: CanalMem; que: string }): Promise<void> {
  const a = await cargarMemoria();
  const cambio: CambioMem = {
    t: Date.now(),
    quien: opts.quien || 'junta',
    canal: opts.canal,
    que: String(opts.que || '').slice(0, 200),
  };
  a.cambios = [...a.cambios, cambio].slice(-MAX_CAMBIOS);
  cache = a;
  await enqueue(() => persistirMemoria().then(() => undefined));
}

export async function guardarHechoQuien(opts: {
  quien: MiembroId | null;
  hecho: string;
  canal?: CanalMem;
  junta?: boolean;
}): Promise<void> {
  const hecho = String(opts.hecho || '').trim().slice(0, 400);
  if (!hecho) return;
  const a = await cargarMemoria();
  // Al pool de la junta solo va lo que se manda ahí a propósito (`junta: true`, que el servidor pone
  // solo con mando). Un hecho sin dueño verificado —un miembro de la comunidad, una sesión fuera del
  // padrón— antes caía en los HECHOS COMPARTIDOS DE LA JUNTA; ahora no se guarda.
  if (!opts.junta && !opts.quien) return;
  const item: HechoMem = {
    hecho,
    t: Date.now(),
    quien: opts.junta || !opts.quien ? 'junta' : opts.quien,
    canal: opts.canal || 'mesa',
  };
  // Ya guardado: no se reescribe (el teléfono manda su memoria entera en cada turno; antes eso era
  // una escritura a S3 por hecho y por turno, antes de pensar).
  const lista = item.quien === 'junta' ? a.junta.larga : a.perfiles[item.quien]?.larga || [];
  if (lista.some((x) => x.hecho === hecho)) return;
  if (item.quien === 'junta') {
    const juntaItem: HechoMem = { ...item, quien: 'junta' };
    a.junta.larga = [juntaItem, ...a.junta.larga.filter((x) => x.hecho !== hecho)].slice(0, MAX_LARGA);
  } else {
    const p = a.perfiles[item.quien] || (a.perfiles[item.quien] = { corta: [], larga: [] });
    p.larga = [item, ...p.larga.filter((x) => x.hecho !== hecho)].slice(0, MAX_LARGA);
  }
  cache = a;
  await enqueue(() => persistirMemoria().then(() => undefined));
}

/** Olvida. `durable`: false si S3 está configurado y no se pudo borrar ahí (la copia guardada volvería). */
export async function olvidarQuien(quien: MiembroId, junta = false): Promise<{ durable: boolean }> {
  const a = await cargarMemoria();
  a.perfiles[quien] = { corta: [], larga: [] };
  if (junta) a.junta.larga = vacio().junta.larga;
  cache = a;
  let via = 'disco' as 's3' | 'disco';
  await enqueue(() => persistirMemoria().then((r) => void (via = r.via)));
  return { durable: !s3Listo() || via === 's3' };
}

export function fotoMemoria(quien: MiembroId | null) {
  const a = cache || leerDisco();
  const st = estadoMemoria();
  const id = quien;
  return {
    honesto: true as const,
    quien: id,
    nombre: nombreDe(id),
    miembros: Object.values(miembrosUltron()).map((m) => m.nombre),
    durable: st.durable,
    via: st.via,
    detalle: st.detalle,
    bucket: st.bucket ? bucketMemoria() : null,
    privada: id
      ? { corta: (a.perfiles[id]?.corta || []).slice(-40), larga: a.perfiles[id]?.larga || [] }
      : { corta: [], larga: [] },
    junta: a.junta.larga,
    cambios: a.cambios.slice(-24),
    nota: st.durable
      ? 'Memoria en S3, una carpeta por José, Medardo, Carlos y Mayra. El otro no ve la conversación privada.'
      : 'S3 no está listo. Esto se pierde si Render redespliega. Falta ULTRON_MEMORIA_BUCKET o AWS_*.',
  };
}

/**
 * Quién habla. La identidad sale de la sesión firmada o del id de Telegram verificado.
 * El cuerpo (usuario/correo) solo sirve para nombrar a alguien sin sesión —nunca para
 * escalar: con sesión válida, el body no puede convertir a Carlos en José.
 */
export function resolverQuien(body: any, sesion?: { nombre?: string; correo?: string } | null): MiembroId | null {
  if (sesion && (sesion.correo || sesion.nombre)) {
    const deSesion = quienDeSesion(sesion);
    if (deSesion) return deSesion;
  }
  const porTelegram = quienEs({ telegramUserId: body?.telegramUserId, telegramChatId: body?.telegramChatId });
  if (porTelegram) return porTelegram;
  if (sesion) return null;
  return quienEs({
    nombre: String(body?.usuario || body?.userName || body?.nombre || ''),
    correo: String(body?.correo || ''),
  });
}

/**
 * Quién es la persona de una sesión firmada: SOLO por su correo. El nombre de la sesión lo elige quien
 * entra (Genesis lo toma de su identidad; el cerebro remoto, de su cuenta): con él, un miembro de la
 * comunidad llamado «José» pasaba por José, con su memoria y con mando. Sin correo del padrón, nadie.
 */
function quienDeSesion(sesion: { nombre?: string; correo?: string }): MiembroId | null {
  const correo = String(sesion.correo || '').trim();
  return correo ? quienEs({ correo }) : null;
}

/** Identidad verificada: sesión firmada (por su correo) o Telegram. Lo que diga el body no cuenta. */
export function quienVerificado(body: any, sesion?: { nombre?: string; correo?: string } | null): MiembroId | null {
  if (sesion && (sesion.correo || sesion.nombre)) {
    return quienDeSesion(sesion);
  }
  return quienEs({ telegramUserId: body?.telegramUserId, telegramChatId: body?.telegramChatId });
}

/** Tests: como recién arrancado (nada leído todavía). */
export function _olvidarCargaTest() {
  cache = null;
  loaded = false;
  s3SinLeer = false;
  reintentoS3 = 0;
}

/** Tests: reset in-memory cache. */
export function resetMemoriaTest(store?: Almacen) {
  cache = store || vacio();
  loaded = true;
  s3SinLeer = false;
  reintentoS3 = 0;
  lastVia = 'disco';
  lastS3 = 'test';
}
