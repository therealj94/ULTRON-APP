/**
 * LOS AVISOS DE LA INICIATIVA (AUR12): cuándo, por dónde y cuántas veces AURA contacta a la persona fuera
 * de la conversación. Lo que propone vive en lib/iniciativa.ts; aquí, la cortesía de avisarlo.
 *
 * Contrato (R5 del documento maestro, sección 14):
 *   · ZONA IANA y horas quietas de la persona (lib/zona-horaria.ts). El «día» del presupuesto es su día local.
 *   · CANAL ELEGIDO y PRESUPUESTO: por omisión, como mucho UN aviso no urgente al día y silencio si no hay
 *     novedad; lo urgente solo para las clases que ella eligió (y la llamada, solo si la activó para eso).
 *   · DEDUPLICAR entre canales: una propuesta se entrega UNA vez. El canal siguiente solo se prueba si el
 *     anterior NO alcanzó a nadie (la app no estaba escuchando); un aviso entregado e ignorado no autoriza
 *     perseguirla por otro canal, ni hoy ni mañana.
 *   · REVALIDAR justo antes de avisar: el despacho vuelve a leer las fuentes (`revalidar`) en el momento de
 *     entregar; lo resuelto, lo caducado o lo que no se pudo comprobar no sale. Si el número contado cambió (A2:
 *     «tres correos» y ahora hay uno), sale la versión regenerada con el de ahora, en lugar de la vieja, nunca además.
 *   · CONTROLES: «menos avisos» (uno cada N días), «no sobre este tema», «no sobre esta clase», posponer con
 *     fecha, horario, canal y apagado. Apagar alcanza lo PENDIENTE: cancela lo encolado de esa clase y lo
 *     retira de la cola de la iniciativa (podarIniciativa), así no sale más tarde.
 *   · Todo aviso va a la persona dueña y a nadie más: la iniciativa prepara, no comunica en nombre de nadie.
 *
 * LA OUTBOX. Cada propuesta que el reloj quiere avisar entra como una fila (clave = id de la propuesta) en el
 * cajón de la persona (`ultron/avisos/<huella>.json`, como las misiones: caché, disco y S3, sin escribir tras
 * una lectura fallida). Estados: pendiente → reservado → entregado | sin_alcance; o omitido (revalidación,
 * presupuesto, duplicado), cancelado (apagado), incierto (una reserva que nadie cerró: el proceso cayó con el
 * aviso quizá ya enviado; no se reenvía: mejor un aviso de menos que dos).
 *
 * EL PUNTO DE ENGANCHE CON LO DURABLE. La garantía «una sola entrega aunque el reloj corra dos veces o haya
 * dos réplicas» descansa en `SelloEntrega.reclamar(clave)`, que solo devuelve true al primero. Hoy es local
 * (`selloLocal`: memoria + un archivo creado con O_EXCL por clave, que dos procesos sobre el mismo disco no
 * pueden crear a la vez). Para varias máquinas, se enchufa otra implementación de esa misma interfaz (una
 * clave única / idempotency key en el almacén durable) y se pasa como `sello` a `procesarOutbox` y a
 * `arrancarIniciativa`; nada más cambia. La fila de la outbox es el registro legible; el sello es el candado.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { cajonPorCorreo, parecido, textoLinea } from './misiones';
import { evidenciaDe, LUEGO_MS, podarIniciativa, TIPOS_PROPUESTA, type MotivoNoVigente, type Propuesta, type Revalidacion, type TipoPropuesta } from './iniciativa';
import { enQuietas, fechaLocal, finDeQuietas, instanteDeLocal, minutosDe, partesLocales, QUIETAS_POR_OMISION, sumarDias, ZONA_POR_OMISION, zonaValida, type Quietas } from './zona-horaria';

/* ------------------------------------------------------------------ tipos */

/** La clase de un aviso: el tipo de la propuesta, o «bloqueo» (una fuente que dejó de responder). */
export type ClaseAviso = TipoPropuesta | 'bloqueo';
export const CLASES_AVISO: readonly ClaseAviso[] = [...TIPOS_PROPUESTA, 'bloqueo'];
export type CanalAviso = 'app' | 'push' | 'correo' | 'llamada';
export const CANALES_AVISO: readonly CanalAviso[] = ['app', 'push', 'correo', 'llamada'];
/** Los canales que se eligen para lo normal. La llamada no: solo para urgentes, si la activó (`llamadaUrgente`). */
export const CANALES_RESUMEN: readonly CanalAviso[] = ['app', 'push', 'correo'];
/** Qué significa «Luego» sin fecha: en 2 horas, esta tarde (15:00) o mañana al terminar sus horas quietas. */
export type LuegoPref = '2h' | 'tarde' | 'manana';
export const LUEGOS: readonly LuegoPref[] = ['2h', 'tarde', 'manana'];
export type TemaAviso = { clave: string; texto: string };

export type PreferenciasAvisos = {
  version: 1;
  zona: string;
  quietas: Quietas;
  /** Canales para lo normal, en orden: el siguiente solo si el anterior no alcanzó. */
  canales: CanalAviso[];
  /** Avisos NO urgentes por día local (por omisión 1). */
  maxDia: number;
  /** «Menos avisos»: como mucho uno no urgente cada N días (1 = normal). */
  cadaDias: number;
  /** Clases que ella eligió como urgentes (pasan el presupuesto, no las horas quietas). Por omisión, ninguna. */
  urgentes: ClaseAviso[];
  /** Las urgentes elegidas pueden sonar como llamada de AURA (solo si ella la activó). */
  llamadaUrgente: boolean;
  clasesApagadas: ClaseAviso[];
  temasSilenciados: TemaAviso[];
  /** Posponer todo hasta este instante. */
  pospuestoHasta?: number;
  luego: LuegoPref;
  /** Sin avisos fuera de la app. */
  apagado: boolean;
  actualizado: number;
};

export type EstadoEntrega = 'pendiente' | 'reservado' | 'entregado' | 'sin_alcance' | 'omitido' | 'cancelado' | 'incierto';

export type EntradaOutbox = {
  clave: string;
  propuestaId: string;
  clase: ClaseAviso;
  tema?: TemaAviso;
  /** Antes de reservar: candidata a urgente. Desde la reserva: si se trató como urgente. */
  urgente: boolean;
  estado: EstadoEntrega;
  /** Último cambio (para el presupuesto: cuándo se reservó o entregó). */
  t: number;
  creado?: number;
  /** No antes de este instante (horas quietas, pospuesto). */
  cuando?: number;
  canal?: CanalAviso;
  motivo?: string;
  /** La vio porque abrió la app (no fue un contacto: no gasta presupuesto). */
  pull?: boolean;
  reservadoEn?: number;
  /** Copia de la propuesta mientras está por entregar (para revalidar y decirla). */
  propuesta?: Propuesta;
};

export type EstadoAvisos = { version: 1; prefs: PreferenciasAvisos; outbox: EntradaOutbox[] };

const H = 3_600_000;
const DIA = 86_400_000;
/** Una reserva sin cerrar después de esto es «incierta» (el proceso cayó): no se reenvía. */
export const LEASE_RESERVA_MS = 5 * 60_000;
const MAX_OUTBOX = 150;
const GUARDA_CERRADAS_MS = 15 * DIA;
const MAX_TEMAS = 50;

export function prefsPorOmision(ahora = 0): PreferenciasAvisos {
  return {
    version: 1,
    zona: ZONA_POR_OMISION,
    quietas: { ...QUIETAS_POR_OMISION },
    canales: ['app', 'push'],
    maxDia: 1,
    cadaDias: 1,
    urgentes: [],
    llamadaUrgente: false,
    clasesApagadas: [],
    temasSilenciados: [],
    luego: '2h',
    apagado: false,
    actualizado: ahora,
  };
}

/* ------------------------------------------------------------------ sanear y validar */

const unicos = <T>(xs: T[]) => [...new Set(xs)];

function sanearTema(x: any): TemaAviso | null {
  const clave = textoLinea(x?.clave, 80);
  return /^[a-z]+:[^\s]{1,72}$|^(correo|whatsapp)$/.test(clave) ? { clave, texto: textoLinea(x?.texto, 160) } : null;
}

function sanearPrefs(x: any): PreferenciasAvisos {
  const d = prefsPorOmision();
  const q = x?.quietas;
  const quietas = q && minutosDe(q.desde) !== null && minutosDe(q.hasta) !== null ? { desde: String(q.desde), hasta: String(q.hasta) } : d.quietas;
  const canales = Array.isArray(x?.canales) ? unicos(x.canales.filter((c: any) => CANALES_RESUMEN.includes(c))) : d.canales;
  const n = (v: any, min: number, max: number, def: number) => (Number.isInteger(Number(v)) && Number(v) >= min && Number(v) <= max ? Number(v) : def);
  return {
    version: 1,
    zona: zonaValida(x?.zona) || d.zona,
    quietas,
    canales: canales as CanalAviso[],
    maxDia: n(x?.maxDia, 0, 6, d.maxDia),
    cadaDias: n(x?.cadaDias, 1, 7, d.cadaDias),
    urgentes: Array.isArray(x?.urgentes) ? unicos(x.urgentes.filter((c: any) => CLASES_AVISO.includes(c))) : [],
    llamadaUrgente: x?.llamadaUrgente === true,
    clasesApagadas: Array.isArray(x?.clasesApagadas) ? unicos(x.clasesApagadas.filter((c: any) => CLASES_AVISO.includes(c))) : [],
    temasSilenciados: (Array.isArray(x?.temasSilenciados) ? x.temasSilenciados : []).map(sanearTema).filter(Boolean).slice(-MAX_TEMAS) as TemaAviso[],
    ...(Number(x?.pospuestoHasta) > 0 ? { pospuestoHasta: Number(x.pospuestoHasta) } : {}),
    luego: LUEGOS.includes(x?.luego) ? x.luego : d.luego,
    apagado: x?.apagado === true,
    actualizado: Number(x?.actualizado) || 0,
  };
}

function sanearEntrada(x: any): EntradaOutbox | null {
  const clave = textoLinea(x?.clave, 60);
  const propuestaId = textoLinea(x?.propuestaId, 40);
  const estados: EstadoEntrega[] = ['pendiente', 'reservado', 'entregado', 'sin_alcance', 'omitido', 'cancelado', 'incierto'];
  if (!clave || !propuestaId || !estados.includes(x?.estado)) return null;
  const e: EntradaOutbox = { clave, propuestaId, clase: CLASES_AVISO.includes(x?.clase) ? x.clase : 'ayuda', urgente: x?.urgente === true, estado: x.estado, t: Number(x?.t) || 0 };
  const tema = sanearTema(x?.tema);
  if (tema) e.tema = tema;
  if (Number(x?.creado) > 0) e.creado = Number(x.creado);
  if (Number(x?.cuando) > 0) e.cuando = Number(x.cuando);
  if (CANALES_AVISO.includes(x?.canal)) e.canal = x.canal;
  if (x?.motivo) e.motivo = textoLinea(x.motivo, 40);
  if (x?.pull === true) e.pull = true;
  if (Number(x?.reservadoEn) > 0) e.reservadoEn = Number(x.reservadoEn);
  if (x?.propuesta && typeof x.propuesta === 'object' && (e.estado === 'pendiente' || e.estado === 'reservado')) e.propuesta = x.propuesta as Propuesta;
  return e;
}

function sanearEstado(x: any): EstadoAvisos {
  return {
    version: 1,
    prefs: sanearPrefs(x?.prefs),
    outbox: (Array.isArray(x?.outbox) ? x.outbox : []).map(sanearEntrada).filter(Boolean).slice(-MAX_OUTBOX) as EntradaOutbox[],
  };
}

const almacen = cajonPorCorreo<EstadoAvisos>({
  nombre: 'avisos',
  s3: 'ultron/avisos',
  dirEnv: 'ULTRON_AVISOS_DIR',
  dirDef: 'avisos',
  sanear: sanearEstado,
  vacio: () => ({ version: 1, prefs: prefsPorOmision(), outbox: [] }),
  que: 'tus preferencias de avisos',
});

export type CambiosAvisos = Partial<Omit<PreferenciasAvisos, 'version' | 'actualizado' | 'pospuestoHasta'>> & {
  pospuestoHasta?: number | null;
  /** «Menos avisos»: true = uno cada 3 días; false = lo normal. */
  menosAvisos?: boolean;
  /** «No sobre este tema»: se añade a los silenciados. */
  silenciarTema?: TemaAviso;
};

/** Valida lo que llega de la app. Un error se dice, no se adivina. */
export function validarCambiosAvisos(b: unknown): { ok: true; cambios: CambiosAvisos } | { ok: false; error: string } {
  if (!b || typeof b !== 'object' || Array.isArray(b)) return { ok: false, error: 'Los cambios tienen que ser un objeto.' };
  const x = b as Record<string, any>;
  const c: CambiosAvisos = {};
  if (x.zona !== undefined) {
    const z = zonaValida(x.zona);
    if (!z) return { ok: false, error: 'La zona horaria tiene que ser una zona IANA, como America/Tegucigalpa.' };
    c.zona = z;
  }
  if (x.quietas !== undefined) {
    if (minutosDe(x.quietas?.desde) === null || minutosDe(x.quietas?.hasta) === null) return { ok: false, error: 'Las horas quietas van como HH:MM (desde y hasta).' };
    c.quietas = { desde: String(x.quietas.desde), hasta: String(x.quietas.hasta) };
  }
  if (x.canales !== undefined) {
    if (!Array.isArray(x.canales) || x.canales.some((k: any) => !CANALES_RESUMEN.includes(k))) return { ok: false, error: 'Los canales son app, push o correo (la llamada solo para urgentes, con llamadaUrgente).' };
    c.canales = unicos(x.canales) as CanalAviso[];
  }
  if (x.maxDia !== undefined) {
    if (!Number.isInteger(x.maxDia) || x.maxDia < 0 || x.maxDia > 6) return { ok: false, error: 'maxDia va de 0 a 6.' };
    c.maxDia = x.maxDia;
  }
  if (x.cadaDias !== undefined) {
    if (!Number.isInteger(x.cadaDias) || x.cadaDias < 1 || x.cadaDias > 7) return { ok: false, error: 'cadaDias va de 1 a 7.' };
    c.cadaDias = x.cadaDias;
  }
  if (x.menosAvisos !== undefined) {
    if (typeof x.menosAvisos !== 'boolean') return { ok: false, error: 'menosAvisos es sí o no.' };
    c.menosAvisos = x.menosAvisos;
  }
  for (const k of ['urgentes', 'clasesApagadas'] as const) {
    if (x[k] === undefined) continue;
    if (!Array.isArray(x[k]) || x[k].some((v: any) => !CLASES_AVISO.includes(v))) return { ok: false, error: `${k}: clases conocidas (${CLASES_AVISO.join(', ')}).` };
    c[k] = unicos(x[k]) as ClaseAviso[];
  }
  for (const k of ['llamadaUrgente', 'apagado'] as const) {
    if (x[k] === undefined) continue;
    if (typeof x[k] !== 'boolean') return { ok: false, error: `${k} es sí o no.` };
    c[k] = x[k];
  }
  if (x.temasSilenciados !== undefined) {
    if (!Array.isArray(x.temasSilenciados)) return { ok: false, error: 'temasSilenciados es una lista.' };
    const ts = x.temasSilenciados.map(sanearTema);
    if (ts.some((t: TemaAviso | null) => !t)) return { ok: false, error: 'Un tema silenciado no se entiende.' };
    c.temasSilenciados = ts as TemaAviso[];
  }
  if (x.silenciarTema !== undefined) {
    const t = sanearTema(x.silenciarTema);
    if (!t) return { ok: false, error: 'El tema a silenciar no se entiende.' };
    c.silenciarTema = t;
  }
  if (x.pospuestoHasta !== undefined) {
    if (x.pospuestoHasta !== null && (typeof x.pospuestoHasta !== 'number' || !Number.isFinite(x.pospuestoHasta) || x.pospuestoHasta <= 0)) return { ok: false, error: 'pospuestoHasta es un instante (ms) o null.' };
    c.pospuestoHasta = x.pospuestoHasta;
  }
  if (x.luego !== undefined) {
    if (!LUEGOS.includes(x.luego)) return { ok: false, error: '«Luego» es 2h, tarde o manana.' };
    c.luego = x.luego;
  }
  return { ok: true, cambios: c };
}

/* ------------------------------------------------------------------ de qué trata un aviso */

/** La clase de aviso de una propuesta. */
export function claseDe(p: Propuesta): ClaseAviso {
  return evidenciaDe(p).fuente.tipo === 'bloqueo' ? 'bloqueo' : p.tipo;
}

const plegar = (s: string) =>
  String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .trim();

/** El tema de una propuesta (para «no sobre este tema»): su misión, su campo, su fuente o, si no, la idea. */
export function temaDe(p: Propuesta): TemaAviso {
  const e = evidenciaDe(p);
  const texto = textoLinea(p.texto, 160);
  const id = e.fuente.id || (e.fuente.tipo === 'mision' ? p.misionId : e.fuente.tipo === 'perfil' ? p.campo : undefined);
  if (e.fuente.tipo === 'mision' && id) return { clave: `mision:${id}`, texto };
  if (e.fuente.tipo === 'perfil' && id) return { clave: `conocer:${id}`, texto };
  if (e.fuente.tipo === 'correo' || e.fuente.tipo === 'whatsapp') return { clave: e.fuente.tipo, texto };
  if (e.fuente.tipo === 'bloqueo' && id) return { clave: `bloqueo:${id}`, texto };
  const huella = crypto.createHash('sha256').update(plegar(p.texto).split(/\s+/).slice(0, 8).join(' ')).digest('hex').slice(0, 12);
  return { clave: `idea:${huella}`, texto };
}

/** ¿Ese tema está silenciado? La misma clave, o una idea parecida (≥ 0,5) a una silenciada. */
export function temaSilenciado(t: TemaAviso | undefined, lista: TemaAviso[]): boolean {
  if (!t) return false;
  return lista.some((s) => s.clave === t.clave || (s.clave.startsWith('idea:') && t.clave.startsWith('idea:') && !!s.texto && parecido(s.texto, t.texto) >= 0.5));
}

/** ¿La persona apagó esta propuesta (todo, su clase o su tema)? */
export function apagadaPara(prefs: PreferenciasAvisos, p: Propuesta): boolean {
  return prefs.clasesApagadas.includes(claseDe(p)) || temaSilenciado(temaDe(p), prefs.temasSilenciados);
}

/* ------------------------------------------------------------------ la decisión de contactar (pura) */

export type AvisoCandidato = { propuestaId: string; clase: ClaseAviso; tema?: TemaAviso; urgente: boolean; para: string; dueno: string };

export type MotivoSinContacto = 'no_autorizado' | 'apagado' | 'clase_apagada' | 'tema_silenciado' | 'ya_entregada' | 'pospuesto' | 'horas_quietas' | 'presupuesto' | 'menos_avisos' | 'sin_canal';

export type DecisionContacto = { ok: true; canales: CanalAviso[]; urgente: boolean } | { ok: false; motivo: MotivoSinContacto; reintentarEn?: number };

const CUENTA_COMO_CONTACTO: EstadoEntrega[] = ['reservado', 'entregado', 'incierto'];

/**
 * ¿Se puede avisar ahora, y por qué canales? Pura: con sus preferencias, lo ya entregado y la hora.
 * Lo que la persona abrió ella misma (`pull`) no gasta presupuesto. Una urgente solo lo es si su clase está
 * entre las elegidas; aun así respeta horas quietas y lo pospuesto (reintentarEn dice cuándo).
 */
export function decidirContacto(a: AvisoCandidato, est: Pick<EstadoAvisos, 'prefs' | 'outbox'>, ahora: number): DecisionContacto {
  const p = est.prefs;
  const para = String(a.para || '').trim().toLowerCase();
  if (!para || para !== String(a.dueno || '').trim().toLowerCase()) return { ok: false, motivo: 'no_autorizado' };
  if (p.apagado) return { ok: false, motivo: 'apagado' };
  if (p.clasesApagadas.includes(a.clase)) return { ok: false, motivo: 'clase_apagada' };
  if (temaSilenciado(a.tema, p.temasSilenciados)) return { ok: false, motivo: 'tema_silenciado' };
  if (est.outbox.some((x) => x.propuestaId === a.propuestaId && CUENTA_COMO_CONTACTO.includes(x.estado))) return { ok: false, motivo: 'ya_entregada' };
  if (p.pospuestoHasta && ahora < p.pospuestoHasta) return { ok: false, motivo: 'pospuesto', reintentarEn: p.pospuestoHasta };
  if (enQuietas(ahora, p.zona, p.quietas)) return { ok: false, motivo: 'horas_quietas', reintentarEn: finDeQuietas(ahora, p.zona, p.quietas) };
  const urgente = a.urgente && p.urgentes.includes(a.clase);
  if (!urgente) {
    const hoy = fechaLocal(ahora, p.zona);
    const normales = est.outbox.filter((x) => x.propuestaId !== a.propuestaId && CUENTA_COMO_CONTACTO.includes(x.estado) && !x.urgente && !x.pull);
    if (normales.filter((x) => fechaLocal(x.t, p.zona) === hoy).length >= p.maxDia) return { ok: false, motivo: 'presupuesto' };
    if (p.cadaDias > 1) {
      const ultima = Math.max(0, ...normales.map((x) => x.t));
      if (ultima && ahora - ultima < p.cadaDias * DIA) return { ok: false, motivo: 'menos_avisos', reintentarEn: ultima + p.cadaDias * DIA };
    }
  }
  const canales = urgente && p.llamadaUrgente ? (['llamada', ...p.canales] as CanalAviso[]) : [...p.canales];
  if (!canales.length) return { ok: false, motivo: 'sin_canal' };
  return { ok: true, canales, urgente };
}

/** «Luego» sin fecha, según su preferencia: en 2 h, esta tarde (15:00 de su zona) o mañana al terminar sus quietas. */
export function hastaDeLuego(pref: LuegoPref, ahora: number, zona: string = ZONA_POR_OMISION, quietas: Quietas = QUIETAS_POR_OMISION): number {
  const z = zonaValida(zona) || ZONA_POR_OMISION;
  const hoy = partesLocales(ahora, z).fecha;
  let t = ahora + LUEGO_MS;
  if (pref === 'tarde') {
    const tarde = instanteDeLocal(hoy, '15:00', z);
    if (tarde > ahora) t = tarde;
  } else if (pref === 'manana') {
    t = instanteDeLocal(sumarDias(hoy, 1), minutosDe(quietas.hasta) !== null ? quietas.hasta : '07:00', z);
  }
  return finDeQuietas(t, z, quietas);
}

/* ------------------------------------------------------------------ el sello: una entrega por clave */

/**
 * EL PUNTO DE ENGANCHE con el almacén durable (ver la cabecera). `reclamar` devuelve true SOLO al primero
 * que reclama esa clave, aunque lo intenten dos vueltas del reloj o dos réplicas; `reclamada` dice si ya se
 * reclamó. Una implementación durable cumple lo mismo con una clave única.
 */
export interface SelloEntrega {
  reclamar(clave: string, ahora: number): Promise<boolean>;
  reclamada(clave: string): Promise<boolean>;
}

function carpetaAvisos(): string {
  return process.env.ULTRON_AVISOS_DIR || path.join(process.cwd(), 'data', 'avisos');
}

/**
 * Sello local: memoria y, con `dir` (por omisión `<avisos>/sellos`), un archivo por clave creado con 'wx'
 * (O_EXCL): si dos procesos sobre el mismo disco lo intentan a la vez, solo uno lo crea. `dir: null` = solo
 * memoria (pruebas). Los sellos más viejos que `retencionMs` (14 días) se barren de vez en cuando.
 */
export function selloLocal(o: { dir?: string | null; retencionMs?: number } = {}): SelloEntrega {
  const mem = new Map<string, number>();
  const dir = o.dir === null ? null : o.dir || path.join(carpetaAvisos(), 'sellos');
  const retencion = o.retencionMs ?? 14 * DIA;
  let usos = 0;
  const archivo = (k: string) => path.join(dir!, `${crypto.createHash('sha256').update(k).digest('hex').slice(0, 40)}.sello`);
  function barrer(ahora: number) {
    if (!dir) return;
    try {
      for (const f of fs.readdirSync(dir)) {
        const ruta = path.join(dir, f);
        if (f.endsWith('.sello') && ahora - fs.statSync(ruta).mtimeMs > retencion) fs.rmSync(ruta, { force: true });
      }
    } catch {
      /* sin carpeta todavía */
    }
    for (const [k, t] of mem) if (ahora - t > retencion) mem.delete(k);
  }
  return {
    async reclamar(clave: string, ahora: number): Promise<boolean> {
      if (mem.has(clave)) return false;
      if (++usos % 200 === 0) barrer(ahora);
      if (dir) {
        try {
          fs.mkdirSync(dir, { recursive: true });
          fs.writeFileSync(archivo(clave), String(ahora), { flag: 'wx' });
        } catch (e: any) {
          if (e?.code === 'EEXIST') {
            mem.set(clave, ahora);
            return false;
          }
          // Disco no disponible: queda la garantía de este proceso (memoria) y se dice.
          console.warn('[avisos] sello sin disco', String(e?.message || e).slice(0, 100));
        }
      }
      mem.set(clave, ahora);
      return true;
    },
    async reclamada(clave: string): Promise<boolean> {
      if (mem.has(clave)) return true;
      return !!dir && fs.existsSync(archivo(clave));
    },
  };
}

let selloComun: SelloEntrega | null = null;
/** El sello del proceso (local, sobre el disco de avisos). */
export function selloPorOmision(): SelloEntrega {
  return (selloComun ||= selloLocal());
}

/* ------------------------------------------------------------------ preferencias */

/** Su estado de avisos; `{ ok: false }` si no se pudo leer. Nunca lanza. */
export async function leerAvisos(correo: string): Promise<{ ok: true; estado: EstadoAvisos } | { ok: false }> {
  const r = await almacen.leer(correo);
  return r.ok ? { ok: true, estado: r.valor } : { ok: false };
}

/** Sus preferencias (las de por omisión si no se pudieron leer: así nada se vuelve más ruidoso que lo normal). */
export async function preferenciasDe(correo: string): Promise<PreferenciasAvisos> {
  const r = await leerAvisos(correo);
  return r.ok ? r.estado.prefs : prefsPorOmision();
}

/**
 * Cambia sus preferencias y PROPAGA: lo encolado que quede apagado (todo, su clase o su tema) se cancela, y
 * se retira de la pendiente y la cola de la iniciativa. Cambiar la zona no toca ningún instante guardado.
 * Lanza si los cambios no valen o si su estado no se pudo leer (AlmacenNoDisponible).
 */
export async function cambiarPreferencias(correo: string, cambios: CambiosAvisos, ahora = Date.now()): Promise<{ prefs: PreferenciasAvisos; cancelados: number; retiradas: number }> {
  const v = validarCambiosAvisos(cambios);
  if (!v.ok) throw new Error((v as { error: string }).error);
  const c = v.cambios;
  const { resultado } = await almacen.modificar(correo, (e) => {
    const p = e.prefs;
    const { menosAvisos, silenciarTema, pospuestoHasta, ...resto } = c;
    Object.assign(p, resto);
    if (menosAvisos !== undefined) p.cadaDias = menosAvisos ? 3 : 1;
    if (silenciarTema && !p.temasSilenciados.some((t) => t.clave === silenciarTema.clave)) p.temasSilenciados = [...p.temasSilenciados, silenciarTema].slice(-MAX_TEMAS);
    if (pospuestoHasta === null) delete p.pospuestoHasta;
    else if (pospuestoHasta !== undefined) p.pospuestoHasta = pospuestoHasta;
    p.actualizado = ahora;
    let cancelados = 0;
    for (const x of e.outbox) {
      if (x.estado !== 'pendiente') continue;
      const motivo = p.apagado ? 'apagado' : p.clasesApagadas.includes(x.clase) ? 'clase_apagada' : temaSilenciado(x.tema, p.temasSilenciados) ? 'tema_silenciado' : '';
      if (!motivo) continue;
      x.estado = 'cancelado';
      x.motivo = motivo;
      x.t = ahora;
      delete x.propuesta;
      cancelados++;
    }
    return { prefs: { ...p }, cancelados };
  });
  // El apagado de AVISOS (fuera de la app) cancela lo encolado arriba, pero no borra lo que ella vería al
  // abrir la app (eso es su ajuste de iniciativa). Una clase o un tema apagados se retiran de todo.
  const retiradas = c.clasesApagadas || c.temasSilenciados || c.silenciarTema ? await podarIniciativa(correo, (q) => apagadaPara(resultado.prefs, q), ahora).catch(() => 0) : 0;
  return { ...resultado, retiradas };
}

/* ------------------------------------------------------------------ la outbox */

function podar(e: EstadoAvisos, ahora: number) {
  e.outbox = e.outbox.filter((x) => x.estado === 'pendiente' || x.estado === 'reservado' || ahora - x.t < GUARDA_CERRADAS_MS).slice(-MAX_OUTBOX);
}

/**
 * Encola el aviso de una propuesta. Idempotente por propuesta: si ya hay fila (pendiente, entregada,
 * omitida…), no se crea otra; así una propuesta ignorada no vuelve a encolarse. Si su clase o su tema están
 * apagados, la fila nace cancelada.
 */
export async function encolarAviso(correo: string, p: Propuesta, ahora = Date.now()): Promise<{ entrada: EntradaOutbox; nuevo: boolean }> {
  const { resultado } = await almacen.modificar(correo, (e) => {
    const ya = e.outbox.find((x) => x.clave === p.id);
    if (ya) return { entrada: { ...ya }, nuevo: false };
    podar(e, ahora);
    const ev = evidenciaDe(p);
    const x: EntradaOutbox = { clave: p.id, propuestaId: p.id, clase: claseDe(p), tema: temaDe(p), urgente: ev.urgente === true, estado: 'pendiente', t: ahora, creado: ahora, cuando: ahora, propuesta: p };
    const motivo = e.prefs.apagado ? 'apagado' : apagadaPara(e.prefs, p) ? (e.prefs.clasesApagadas.includes(x.clase) ? 'clase_apagada' : 'tema_silenciado') : '';
    if (motivo) {
      x.estado = 'cancelado';
      x.motivo = motivo;
      delete x.propuesta;
    }
    e.outbox.push(x);
    return { entrada: { ...x }, nuevo: true };
  });
  return resultado;
}

/**
 * La persona VIO la propuesta al abrir la app (GET /api/iniciativa): cuenta como entregada por el chat, para
 * que el reloj no la empuje luego por push. No gasta presupuesto (fue ella quien miró).
 */
export async function registrarVista(correo: string, p: Pick<Propuesta, 'id' | 'tipo'> & Partial<Propuesta>, ahora = Date.now()): Promise<void> {
  await almacen.modificar(correo, (e) => {
    const x = e.outbox.find((y) => y.clave === p.id);
    if (x) {
      if (x.estado === 'pendiente') {
        x.estado = 'entregado';
        x.canal = 'app';
        x.pull = true;
        x.t = ahora;
        x.motivo = 'vista_en_app';
        delete x.propuesta;
      }
      return;
    }
    podar(e, ahora);
    e.outbox.push({ clave: p.id, propuestaId: p.id, clase: p.evidencia?.fuente.tipo === 'bloqueo' ? 'bloqueo' : p.tipo, urgente: false, estado: 'entregado', canal: 'app', pull: true, t: ahora, creado: ahora, motivo: 'vista_en_app' });
  });
}

/** Cancela lo pendiente que cumpla `quitar` (p. ej. la propuesta que ya contestó). Devuelve cuántas. */
export async function cancelarAvisos(correo: string, quitar: (x: EntradaOutbox) => boolean, motivo: string, ahora = Date.now()): Promise<number> {
  const { resultado } = await almacen.modificar(correo, (e) => {
    let n = 0;
    for (const x of e.outbox) {
      if (x.estado !== 'pendiente' || !quitar(x)) continue;
      x.estado = 'cancelado';
      x.motivo = textoLinea(motivo, 40);
      x.t = ahora;
      delete x.propuesta;
      n++;
    }
    return n;
  });
  return resultado;
}

/** Lo que recibe un entregador. `para` es SIEMPRE la persona dueña. */
export type AvisoSaliente = { para: string; propuesta: Propuesta; canal: CanalAviso; urgente: boolean; clase: ClaseAviso };
/** Entrega por un canal y dice a cuántos aparatos llegó (0 = no alcanzó: no estaba escuchando, sin teléfonos). */
export type Entregador = (para: string, aviso: AvisoSaliente) => number | Promise<number>;

export type DepsDespacho = {
  /** Lee las fuentes AHORA y dice si la propuesta sigue valiendo (server/iniciativa.ts la arma). */
  revalidar: (p: Propuesta) => Revalidacion | Promise<Revalidacion>;
  entregadores: Partial<Record<CanalAviso, Entregador>>;
  sello?: SelloEntrega;
  ahora?: number;
};

export type ResultadoDespacho = { propuestaId: string; entregado: boolean; canal?: CanalAviso; alcanzados?: number; motivo: MotivoSinContacto | MotivoNoVigente | 'duplicado' | 'incierto' | 'sin_alcance' | 'entregado' };

function huellaCorreo(correo: string): string {
  return crypto.createHash('sha256').update(`avisos:${String(correo || '').trim().toLowerCase()}`).digest('hex').slice(0, 24);
}

/**
 * Despacha lo que toca de la outbox de la persona, una fila a la vez:
 *   1. reservas sin cerrar más viejas que LEASE_RESERVA_MS → «incierto» (no se reenvían);
 *   2. REVALIDAR con las fuentes de ahora (fuera del candado): lo que ya no vale se omite;
 *   3. decidir y reservar en UN paso del cajón (presupuesto y duplicados sin carreras en este proceso);
 *      horas quietas o pospuesto: espera (cuando = fin) mientras no caduque;
 *   4. reclamar el SELLO (entre réplicas); quien no lo gana, no entrega;
 *   5. entregar por los canales en orden; el siguiente solo si el anterior no alcanzó.
 * Lanza AlmacenNoDisponible si su estado no se pudo leer.
 */
export async function procesarOutbox(correo: string, d: DepsDespacho): Promise<ResultadoDespacho[]> {
  const ahora = d.ahora ?? Date.now();
  const sello = d.sello || selloPorOmision();
  const dueno = String(correo || '').trim().toLowerCase();
  const out: ResultadoDespacho[] = [];
  // Cierra una fila solo desde los estados esperados (otra vuelta pudo haberla movido mientras tanto). Una
  // reserva que otro marcó «incierta» y aquí sí terminó: lo que pasó de verdad gana.
  const cerrar = (clave: string, estado: EstadoEntrega, motivo: string, desde: EstadoEntrega[], extra: Partial<EntradaOutbox> = {}) =>
    almacen.modificar(correo, (e) => {
      const x = e.outbox.find((y) => y.clave === clave);
      if (!x || !desde.includes(x.estado)) return;
      Object.assign(x, extra, { estado, motivo, t: ahora });
      delete x.propuesta;
    });

  const { resultado: porHacer } = await almacen.modificar(correo, (e) => {
    for (const x of e.outbox) {
      if (x.estado === 'reservado' && ahora - (x.reservadoEn || x.t) > LEASE_RESERVA_MS) {
        x.estado = 'incierto';
        x.motivo = 'reserva_sin_cierre';
        x.t = ahora;
        delete x.propuesta;
        out.push({ propuestaId: x.propuestaId, entregado: false, motivo: 'incierto' });
      }
    }
    return e.outbox.filter((x) => x.estado === 'pendiente' && (x.cuando || 0) <= ahora && x.propuesta).map((x) => ({ ...x }));
  });

  for (const x of porHacer) {
    let rev: Revalidacion;
    try {
      rev = await d.revalidar(x.propuesta!);
    } catch {
      rev = { vigente: false, motivo: 'fuente_desconectada' };
    }
    // La revalidación puede devolver la versión que vale AHORA (A2: el número cambió y se regeneró): se entrega ESA,
    // nunca la copia vieja. Tiene que ser la misma propuesta (mismo id): otra no se cuela por esta fila.
    if (rev.vigente && rev.propuesta && rev.propuesta.id !== x.propuestaId) rev = { vigente: false, motivo: 'resuelta' };
    if (!rev.vigente) {
      const motivo = (rev as { motivo: MotivoNoVigente }).motivo;
      await cerrar(x.clave, 'omitido', motivo, ['pendiente']);
      out.push({ propuestaId: x.propuestaId, entregado: false, motivo });
      continue;
    }
    const p = rev.propuesta || x.propuesta!;
    const caduca = evidenciaDe(p).caduca;
    const { resultado: r } = await almacen.modificar(correo, (e): { canales: CanalAviso[]; urgente: boolean } | { motivo: ResultadoDespacho['motivo'] } => {
      const y = e.outbox.find((z) => z.clave === x.clave);
      if (!y || y.estado !== 'pendiente') return { motivo: 'duplicado' };
      const dec = decidirContacto({ propuestaId: y.propuestaId, clase: y.clase, tema: y.tema, urgente: y.urgente, para: dueno, dueno }, e, ahora);
      if (!dec.ok) {
        const m = (dec as { motivo: MotivoSinContacto; reintentarEn?: number }).motivo;
        const reintentar = (dec as { reintentarEn?: number }).reintentarEn;
        if ((m === 'horas_quietas' || m === 'pospuesto' || m === 'menos_avisos') && reintentar && reintentar < caduca) {
          y.cuando = reintentar;
          y.motivo = m;
          return { motivo: m };
        }
        y.estado = m === 'apagado' || m === 'clase_apagada' || m === 'tema_silenciado' ? 'cancelado' : 'omitido';
        y.motivo = m;
        y.t = ahora;
        delete y.propuesta;
        return { motivo: m };
      }
      y.estado = 'reservado';
      y.reservadoEn = ahora;
      y.t = ahora;
      y.urgente = dec.urgente;
      // Lo reservado es la versión revalidada (la que sale), no la que se encoló.
      y.propuesta = p;
      return { canales: dec.canales, urgente: dec.urgente };
    });
    if ('motivo' in r) {
      out.push({ propuestaId: x.propuestaId, entregado: false, motivo: r.motivo });
      continue;
    }
    if (!(await sello.reclamar(`aviso:${huellaCorreo(correo)}:${x.propuestaId}`, ahora))) {
      await cerrar(x.clave, 'omitido', 'duplicado', ['reservado']);
      out.push({ propuestaId: x.propuestaId, entregado: false, motivo: 'duplicado' });
      continue;
    }
    let canal: CanalAviso | undefined;
    let alcanzados = 0;
    for (const c of r.canales) {
      const f = d.entregadores[c];
      if (!f) continue;
      let k = 0;
      try {
        k = Number(await f(dueno, { para: dueno, propuesta: p, canal: c, urgente: r.urgente, clase: x.clase })) || 0;
      } catch (e: any) {
        console.warn(`[avisos] el canal ${c} falló`, String(e?.message || e).slice(0, 100));
      }
      if (k > 0) {
        canal = c;
        alcanzados = k;
        break;
      }
    }
    if (canal) {
      await cerrar(x.clave, 'entregado', 'entregado', ['reservado', 'incierto'], { canal });
      out.push({ propuestaId: x.propuestaId, entregado: true, canal, alcanzados, motivo: 'entregado' });
    } else {
      await cerrar(x.clave, 'sin_alcance', 'sin_alcance', ['reservado', 'incierto']);
      out.push({ propuestaId: x.propuestaId, entregado: false, motivo: 'sin_alcance' });
    }
  }
  return out;
}

/** Solo pruebas: olvida la caché (como otra réplica o un redespliegue). */
export function _olvidarCacheAvisos() {
  almacen._olvidar();
}
