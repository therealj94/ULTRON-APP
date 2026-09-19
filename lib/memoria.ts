/**
 * Memoria durable por miembro de junta (José / Medardo) + hechos compartidos.
 * Disco local = caché. S3 = la copia que no se pierde al redesplegar Render.
 */

import fs from 'node:fs';
import path from 'node:path';
import { esHechoLargo, semillaLarga } from '../server/hechos';
import { MIEMBROS, nombreDe, quienEs, type MiembroId } from './junta';
import { bucketMemoria, s3GetJson, s3Listo, s3PutJson } from './s3';

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
const MAX_CORTA = 80;
const MAX_LARGA = 80;
const MAX_CAMBIOS = 120;

let cache: Almacen | null = null;
let loaded = false;
let lastVia: 's3' | 'disco' = 'disco';
let lastS3: string = 'aún no sincronizado';
let writing: Promise<void> = Promise.resolve();

function vacio(): Almacen {
  return {
    version: 1,
    perfiles: {
      jose: { corta: [], larga: [] },
      medardo: { corta: [], larga: [] },
    },
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

export async function cargarMemoria(): Promise<Almacen> {
  if (loaded && cache) return cache;
  const disco = leerDisco();
  if (s3Listo()) {
    const r = await s3GetJson(S3_KEY);
    if (r.ok && r.json) {
      cache = migrar(r.json);
      lastVia = 's3';
      lastS3 = 'leído de S3';
      escribirDisco(cache);
      loaded = true;
      return cache;
    }
    if (r.ok && r.missing) {
      cache = disco;
      lastVia = 's3';
      lastS3 = 'S3 vacío; usé disco y voy a crear el objeto';
      loaded = true;
      await persistirMemoria();
      return cache;
    }
    cache = disco;
    lastVia = 'disco';
    lastS3 = r.detalle;
    loaded = true;
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
  const r = await s3PutJson(S3_KEY, cache);
  lastVia = r.ok ? 's3' : 'disco';
  lastS3 = r.ok ? 'guardado en S3' : r.detalle;
  return { via: lastVia, detalle: lastS3 };
}

function enqueue(fn: () => Promise<void>) {
  writing = writing.then(fn, fn);
  return writing;
}

export function estadoMemoria(): { durable: boolean; via: 's3' | 'disco'; detalle: string; bucket: boolean } {
  return {
    durable: s3Listo() && lastVia === 's3',
    via: lastVia,
    detalle: lastS3,
    bucket: s3Listo(),
  };
}

export function perfilDe(quien: MiembroId, store?: Almacen): PerfilMem {
  const a = store || cache || leerDisco();
  return a.perfiles[quien];
}

export function promptMemoria(quien: MiembroId | null): string {
  const a = cache || leerDisco();
  const id = quien;
  const nombre = nombreDe(id);
  const privada = id ? a.perfiles[id] : { corta: [], larga: [] };
  const corta = privada.corta
    .slice(-40)
    .map((t) => `${t.rol === 'user' ? nombre : 'ULTRON'}: ${t.texto}`)
    .join('\n');
  const hechosYo = privada.larga.map((h) => `- ${h.hecho}`).join('\n');
  const hechosJunta = a.junta.larga.map((h) => `- ${h.hecho}`).join('\n');
  const cambios = a.cambios
    .slice(-16)
    .map((c) => `${nombreDe(c.quien === 'junta' ? null : c.quien)} · ${c.canal} · ${c.que}`)
    .join('\n');
  return [
    `HABLAS CON: ${nombre}. No mezcles la conversación privada del otro miembro.`,
    id ? `MEMORIA PRIVADA DE ${nombre.toUpperCase()}:\n${hechosYo || '(nada aún)'}` : 'No identifiqué si es José o Medardo. No recito memoria privada de nadie.',
    `HECHOS COMPARTIDOS DE LA JUNTA:\n${hechosJunta || '(nada)'}`,
    `CONVERSACIÓN LARGA CON ${nombre.toUpperCase()} (no la del otro):\n${corta || '(nada)'}`,
    `CAMBIOS RECIENTES (quién los pidió):\n${cambios || '(nada)'}`,
  ].join('\n');
}

export async function recordarTurno(opts: {
  quien: MiembroId | null;
  rol: 'user' | 'ultron';
  texto: string;
  canal: CanalMem;
}): Promise<void> {
  const a = await cargarMemoria();
  const texto = String(opts.texto || '').trim().slice(0, 4000);
  if (!texto) return;
  const t = Date.now();
  if (opts.quien) {
    const p = a.perfiles[opts.quien];
    p.corta = [...p.corta, { rol: opts.rol, texto, t, canal: opts.canal }].slice(-MAX_CORTA);
    if (opts.rol === 'user' && esHechoLargo(texto)) {
      const junta = /junta|orden global|prospera|aucorp|ordenex|mina|concesi[oó]n|genesis/i.test(texto);
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
  await enqueue(() => persistirMemoria().then(() => undefined));
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
  const item: HechoMem = {
    hecho,
    t: Date.now(),
    quien: opts.junta || !opts.quien ? 'junta' : opts.quien,
    canal: opts.canal || 'mesa',
  };
  if (item.quien === 'junta') {
    const juntaItem: HechoMem = { ...item, quien: 'junta' };
    a.junta.larga = [juntaItem, ...a.junta.larga.filter((x) => x.hecho !== hecho)].slice(0, MAX_LARGA);
  } else {
    const p = a.perfiles[item.quien];
    p.larga = [item, ...p.larga.filter((x) => x.hecho !== hecho)].slice(0, MAX_LARGA);
  }
  cache = a;
  await enqueue(() => persistirMemoria().then(() => undefined));
}

export async function olvidarQuien(quien: MiembroId, junta = false): Promise<void> {
  const a = await cargarMemoria();
  a.perfiles[quien] = { corta: [], larga: [] };
  if (junta) a.junta.larga = vacio().junta.larga;
  cache = a;
  await enqueue(() => persistirMemoria().then(() => undefined));
}

export function fotoMemoria(quien: MiembroId | null) {
  const a = cache || leerDisco();
  const st = estadoMemoria();
  const id = quien;
  return {
    honesto: true as const,
    quien: id,
    nombre: nombreDe(id),
    miembros: Object.values(MIEMBROS).map((m) => m.nombre),
    durable: st.durable,
    via: st.via,
    detalle: st.detalle,
    bucket: st.bucket ? bucketMemoria() : null,
    privada: id
      ? { corta: a.perfiles[id].corta.slice(-40), larga: a.perfiles[id].larga }
      : { corta: [], larga: [] },
    junta: a.junta.larga,
    cambios: a.cambios.slice(-24),
    nota: st.durable
      ? 'Memoria en S3, una carpeta por José y otra por Medardo. El otro no ve la conversación privada.'
      : 'S3 no está listo. Esto se pierde si Render redespliega. Falta ULTRON_MEMORIA_BUCKET o AWS_*.',
  };
}

export function resolverQuien(body: any, sesion?: { nombre?: string; correo?: string } | null): MiembroId | null {
  return quienEs({
    nombre: String(body?.usuario || body?.userName || body?.nombre || sesion?.nombre || ''),
    correo: String(body?.correo || sesion?.correo || ''),
    telegramUserId: body?.telegramUserId,
    telegramChatId: body?.telegramChatId,
  });
}

/** Tests: reset in-memory cache. */
export function resetMemoriaTest(store?: Almacen) {
  cache = store || vacio();
  loaded = true;
  lastVia = 'disco';
  lastS3 = 'test';
}
