/**
 * UNA FRASE, UN TURNO. La mesa del teléfono reintenta un turno que falla (el stream se corta → JSON →
 * otro JSON): hasta tres turnos en el servidor por una sola frase, con el hilo repetido y las
 * herramientas o acciones hechas otra vez. Ahora el cliente manda un `idTurno` por frase y lo repite en
 * sus reintentos; aquí se recuerda, por quién habla + ese id, el turno en curso o terminado hace poco:
 *   · si sigue en curso, el reintento lo ESPERA (no corre otro en paralelo);
 *   · si terminó con respuesta, el reintento recibe esa misma respuesta (`repetido: true`);
 *   · si terminó sin respuesta (error, cortado) SIN haber despachado nada, el reintento corre un turno nuevo:
 *     para eso reintenta. Si ya había despachado algo, recibe `desconocido` (no se repite a ciegas).
 *   · si se cansa de esperar y el turno SIGUE en curso, recibe «en curso» (`enCurso`): cansarse de esperar
 *     no le da la propiedad del turno (auditoría 3-oct, EXEC01: a los 75 s entraba un segundo ejecutor
 *     mientras el primero seguía y podía repetir un envío o una tarea de la computadora).
 *
 * DURABLE (AUR06). Antes el cerrojo y los resultados vivían solo en un Map del proceso: tras un reinicio o
 * con dos réplicas el mismo turno podía correr dos veces. Ahora, además del Map (que sigue siendo el camino
 * rápido en vivo), cada turno con id deja un registro en lib/durable.ts (S3 con escrituras condicionales; sin
 * S3, el disco local) bajo `turnos/<huella de quién>/<idTurno>`:
 *   · RECLAMAR es «crear una vez» (If-None-Match): de dos réplicas o de un proceso nuevo tras un reinicio,
 *     solo una corre el turno; las demás esperan sondeando el registro y repiten su respuesta, o contestan
 *     «en curso» como siempre.
 *   · El dueño tiene un LEASE (vence en LEASE_MS, se renueva cada RENOVAR_MS mientras corre) con un token
 *     que solo sube. Toda escritura del dueño es compare-and-set: si otro lo tomó, el viejo queda sin
 *     dueño y no inicia efectos (fencing).
 *   · Antes de un efecto (una herramienta que deja o hace algo, el «sí» a un borrador) se PERSISTE que se
 *     despachó (`efectoDelTurno`), y solo si eso quedó guardado con el token vigente se hace.
 *   · Si el dueño muere y su lease vence: si no había despachado nada, el siguiente corre el turno de nuevo
 *     (es seguro); si ya había despachado algo, NO se re-ejecuta a ciegas: el turno queda `desconocido` y el
 *     reintento recibe eso (la ruta lo dice con honestidad y propone revisar antes de pedirlo otra vez).
 *   · El resultado se guarda al terminar; un reintento tras un reinicio recibe la misma respuesta.
 * Si el almacén no contesta al reclamar, el turno corre con el Map para CONTESTAR (no se deja a la persona sin
 * respuesta por una caída de S3), pero SIN EFECTOS: un turno que no quedó reclamado de forma durable no despacha
 * nada (ni herramientas que dejan o hacen algo, ni el «sí» a un borrador, ni acciones del teléfono): tras un
 * reinicio o en otra réplica nadie sabría que ya se hizo (revisión externa, 4-oct). La ruta lo dice con honestidad.
 *   · Un turno que despachó algo y terminó SIN respuesta (error, cortado) no queda `libre`: queda `desconocido`.
 *     Antes el reintento de la app (para eso reintenta) corría el turno otra vez y repetía el envío o la tarea.
 *   · Un turno hecho que despachó algo repite su respuesta aunque pase su vida: con efectos, nunca vuelve a correr.
 * El registro guarda la respuesta ya dada (la misma que va a su memoria) para repetirla; conviene una regla de
 * ciclo de vida sobre `ultron/durable/turnos/`. Los de Dr Electrum (`electrum:<quién>`) van bajo su propio prefijo,
 * `electrum/durable/turnos/` (lib/durable.ts almacenDurableElectrum), leyendo el viejo como respaldo.
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import { almacenDurable, almacenDurableElectrum, claveDe, crearUnaVez, PROCESO_DURABLE, type AlmacenDurable } from '../lib/durable';

/** Lo que se repite de un turno: lo mismo que lleva el `done` del stream y el JSON de /api/turno. */
export type TurnoGuardado = {
  reply: string;
  voz: string;
  emocion: string;
  via: string;
  mode?: string;
  ms?: number;
  herramientas: string[];
  acciones?: unknown;
  trazaId?: string;
  /** El cerebro se cortó a media respuesta: un reintento lo repite marcado igual (Codex en #138). */
  parcial?: boolean;
  /** Cómo terminó y por qué no quedó completo (auditoría 3-oct, STREAM01): el reintento lo repite igual. */
  estado?: 'completo' | 'truncado' | 'error';
  motivo?: string;
  /** Quién contestó de verdad (EXEC04): el reintento no lo vuelve a adivinar por la `via`. */
  modelo?: string;
  proveedor?: string;
  /** Las tareas durables que el turno creó o cambió (server/trabajos.ts, AUR08): el reintento las enlaza igual. */
  tareas?: { id: string; title: string; state: string; version: number; updatedAt: string }[];
  /** Lo que el taller dejó esperando aprobación (revisión 10, MEDIO-C): el reintento lo devuelve igual. */
  propuestaTaller?: unknown;
  /**
   * El turno de Dr Electrum entero (server/electrum/turno-idempotente.ts), con su forma propia: texto, voces, panel,
   * traza, órdenes del mapa. Sus claves van en otro espacio (`electrum:<quién>`): nunca chocan con las de AU-RA.
   */
  electrum?: Record<string, unknown>;
};

/** El registro durable de un turno (lib/durable.ts). */
export type RegistroTurno = {
  v: 1;
  estado: 'en-curso' | 'hecho' | 'libre' | 'desconocido';
  /** Qué proceso lo corre y con qué token (fencing). */
  titular: string;
  token: number;
  /** Hasta cuándo vale el lease del titular (ms). */
  vence: number;
  /** Lo que despachó con efecto (nombres de herramienta o «envio»), en orden. */
  efectos: string[];
  resultado?: TurnoGuardado;
  t: number;
  actualizado: number;
};

type Entrada = {
  promesa: Promise<TurnoGuardado | null>;
  resolver: (r: TurnoGuardado | null) => void;
  hecho: boolean;
  ts: number;
  /** Lo que este turno despachó con efecto, en este proceso. */
  efectos: string[];
  /** Terminó SIN respuesta después de despachar algo: el reintento recibe «desconocido», no corre otro. */
  desconocido?: string[];
};

export const VIDA_MS = 2 * 60_000;
export const MAX_TURNOS = 500;
/**
 * Lo más que un reintento espera al turno en curso (un turno largo anda por 70 s, el tope del cliente).
 * Es cuánto ESPERA el reintento, no cuánto dura la propiedad: pasado esto contesta «en curso».
 */
export const ESPERA_MAX_MS = 75_000;
/** El lease del dueño: si su proceso muere, a lo más esto tarda otro en poder decidir. */
export const LEASE_MS = 45_000;
export const RENOVAR_MS = 15_000;
/** Cada cuánto mira el registro un reintento que espera a un turno de otro proceso. */
export const SONDEO_MS = 500;
/** Cuánto vale la respuesta guardada para repetirla (después, el mismo id corre otra vez). */
export const VIDA_DURABLE_MS = 30 * 60_000;

/** El id que manda el cliente: un texto corto y sin rarezas. Cualquier otra cosa, sin id (como antes). */
export function idTurnoValido(v: unknown): string | null {
  return typeof v === 'string' && /^[A-Za-z0-9_-]{8,64}$/.test(v) ? v : null;
}

/**
 * La clave: QUIÉN lo dice según el servidor (el correo de la sesión, o el aparato/IP sin sesión), nunca
 * un correo del cuerpo, más el id del cliente. Así nadie recibe la respuesta de otro adivinando un id.
 */
export function claveTurno(quien: string, idTurno: unknown): string | null {
  const id = idTurnoValido(idTurno);
  return id && quien ? `${quien.toLowerCase()}|${id}` : null;
}

/**
 * Con qué se cierra el turno que se corre: su respuesta, o null si no la hubo. Se puede llamar de más.
 * Devuelve cuándo quedó guardado (no hace falta esperarlo). `efecto(que)`: antes de despachar algo con efecto
 * (persiste que se despachó; false = este proceso ya no es el dueño o no se pudo guardar: NO se hace).
 */
export type Terminar = ((r: TurnoGuardado | null) => Promise<void>) & {
  efecto: (que: string) => Promise<boolean>;
  /** ¿Quedó reclamado en el almacén durable? (false: sin id, o el almacén no contestó y corre solo con el Map). */
  durable: boolean;
};

export type Reclamo = { previo: TurnoGuardado } | { terminar: Terminar } | { enCurso: true } | { desconocido: { efectos: string[] } };

/**
 * «Solo repetir» (revisión 9, R1): lo que se sabe de un turno SIN reclamarlo. Nunca da `terminar` (nunca corre el
 * cerebro): la respuesta guardada (`previo`), que sigue en curso (`enCurso`, tras esperar como un reintento), que quedó
 * incierto (`desconocido`), o `noExiste` (ese turno no llegó, terminó sin respuesta y sin efectos, o no se pudo mirar).
 */
export type Consulta = { previo: TurnoGuardado } | { enCurso: true } | { desconocido: { efectos: string[] } } | { noExiste: true; motivo: 'no_existe' | 'sin_id' | 'sin_almacen' };

/** El dueño durable de un turno en este proceso. */
type Propio = {
  k: string;
  a: AlmacenDurable;
  titular: string;
  token: number;
  etag: string;
  reg: RegistroTurno;
  perdido: boolean;
  cerrado: boolean;
  cola: Promise<unknown>;
  reloj?: ReturnType<typeof setInterval>;
};

type Config = {
  almacen: () => AlmacenDurable;
  /** El de los turnos de Dr Electrum (claves `electrum:<quién>`): su propio prefijo. Si solo se da `almacen`, ese. */
  almacenElectrum: () => AlmacenDurable;
  leaseMs: number;
  renovarMs: number;
  sondeoMs: number;
  ahora: () => number;
};

const pausa = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Un juego de turnos únicos (un «proceso»). El servidor usa uno (`reclamarTurno` y compañía); las pruebas
 * crean varios para simular réplicas sobre el mismo almacén.
 */
export function crearTurnosUnicos(opciones: Partial<Config> & { proceso?: string } = {}) {
  const cfg: Config = {
    almacen: almacenDurable,
    almacenElectrum: opciones.almacen && !opciones.almacenElectrum ? opciones.almacen : almacenDurableElectrum,
    leaseMs: LEASE_MS,
    renovarMs: RENOVAR_MS,
    sondeoMs: SONDEO_MS,
    ahora: Date.now,
    ...opciones,
  };
  /** Dr Electrum en su prefijo; AU-RA en el de siempre. */
  const almacenDe = (quien: string) => (quien.startsWith('electrum:') ? cfg.almacenElectrum() : cfg.almacen());
  let proceso = opciones.proceso || PROCESO_DURABLE;
  let reinicios = 0;
  const turnos = new Map<string, Entrada>();
  const activos = new Set<Propio>();

  function podar(ahora = cfg.ahora()) {
    for (const [k, e] of turnos) if (e.hecho && ahora - e.ts > VIDA_MS) turnos.delete(k);
    // Tope de tamaño: primero se van los más viejos (el Map guarda el orden de llegada). Solo los terminados:
    // podar uno en curso sería darle el turno a otro dueño mientras el primero sigue (EXEC01). Los que están
    // en curso a la vez los acota el cupo por persona de las rutas.
    for (const [k, e] of turnos) {
      if (turnos.size <= MAX_TURNOS) break;
      if (e.hecho) turnos.delete(k);
    }
  }

  function crearEntrada(clave: string): Entrada {
    let resolver!: (r: TurnoGuardado | null) => void;
    const e: Entrada = { promesa: new Promise((r) => (resolver = r)), resolver: (r) => resolver(r), hecho: false, ts: cfg.ahora(), efectos: [] };
    turnos.set(clave, e);
    podar();
    return e;
  }

  /** La entrada de este proceso se cierra sin correr aquí: con la respuesta ya hecha, o se libera. */
  function cerrarEntrada(clave: string, e: Entrada, r: TurnoGuardado | null) {
    e.hecho = true;
    e.ts = cfg.ahora();
    e.resolver(r);
    if (!r && turnos.get(clave) === e) turnos.delete(clave);
  }

  /* ---------------------------------------------------------------- escrituras del dueño (en fila) */

  function enCola<T>(p: Propio, f: () => Promise<T>): Promise<T> {
    const paso = p.cola.then(f, f);
    p.cola = paso.catch(() => undefined);
    return paso;
  }

  /** CAS sobre el registro propio. `perdido`: otro lo tomó (o ya no está en curso): no se escribe más. */
  async function escribir(p: Propio, cambio: (r: RegistroTurno) => RegistroTurno): Promise<'ok' | 'perdido' | 'error'> {
    for (let i = 0; i < 2; i++) {
      const nuevo = cambio(p.reg);
      const w = await p.a.cas(p.k, nuevo, p.etag).catch((e) => ({ ok: false as const, conflicto: false as const, detalle: String(e?.message || e) }));
      if (w.ok === true) {
        p.reg = nuevo;
        p.etag = w.etag;
        return 'ok';
      }
      if (w.conflicto === false) return 'error';
      const l = await p.a.leer<RegistroTurno>(p.k).catch(() => ({ ok: false as const, detalle: '' }));
      if (l.ok === false) return 'error';
      if (!l.valor || l.valor.titular !== p.titular || l.valor.token !== p.token || l.valor.estado !== 'en-curso') {
        p.perdido = true;
        return 'perdido';
      }
      p.reg = l.valor;
      p.etag = l.etag!;
    }
    return 'error';
  }

  function soltarReloj(p: Propio) {
    if (p.reloj) clearInterval(p.reloj);
    p.reloj = undefined;
  }

  function vigilar(p: Propio) {
    activos.add(p);
    p.reloj = setInterval(() => {
      void enCola(p, async () => {
        if (p.cerrado || p.perdido) return soltarReloj(p);
        const t = cfg.ahora();
        const r = await escribir(p, (reg) => ({ ...reg, vence: t + cfg.leaseMs, actualizado: t }));
        if (r === 'perdido') {
          soltarReloj(p);
          console.warn('[turno-unico] perdí el lease de un turno: otro proceso lo tomó; no inicio más efectos.');
        }
      });
    }, cfg.renovarMs);
    p.reloj.unref?.();
  }

  async function efectoDurable(p: Propio, que: string): Promise<boolean> {
    return enCola(p, async () => {
      if (p.cerrado || p.perdido) return false;
      const t = cfg.ahora();
      const r = await escribir(p, (reg) => ({ ...reg, efectos: [...reg.efectos, String(que).slice(0, 40)].slice(-20), vence: t + cfg.leaseMs, actualizado: t }));
      if (r !== 'ok') console.warn(`[turno-unico] no despacho «${que}»: ${r === 'perdido' ? 'el turno ya no es de este proceso' : 'no pude guardar que se despachaba'}.`);
      return r === 'ok';
    });
  }

  function cerrarDurable(p: Propio, r: TurnoGuardado | null): Promise<void> {
    soltarReloj(p);
    p.cerrado = true;
    return enCola(p, async () => {
      if (p.perdido) return;
      const t = cfg.ahora();
      // Sin respuesta: `libre` (el reintento lo corre) solo si no despachó nada; si ya despachó algo, `desconocido`
      // (correrlo otra vez repetiría el envío o la tarea).
      const w = await escribir(p, (reg) =>
        r ? { ...reg, estado: 'hecho', resultado: r, vence: 0, actualizado: t } : { ...reg, estado: reg.efectos.length ? 'desconocido' : 'libre', vence: 0, actualizado: t }
      );
      if (w === 'error') console.warn('[turno-unico] no pude guardar el final del turno; un reintento tras un reinicio lo verá incierto.');
    })
      .catch(() => undefined)
      .finally(() => activos.delete(p));
  }

  /* ---------------------------------------------------------------- reclamar en el almacén */

  type Durable = { propio: Propio } | { previo: TurnoGuardado } | { enCurso: true } | { desconocido: { efectos: string[] } } | { sinAlmacen: true };

  function partir(clave: string): { quien: string; id: string } {
    const i = clave.lastIndexOf('|');
    return { quien: clave.slice(0, i), id: clave.slice(i + 1) };
  }

  async function reclamarDurable(clave: string, tope: number): Promise<Durable> {
    const { quien, id } = partir(clave);
    let a: AlmacenDurable;
    let k: string;
    try {
      a = almacenDe(quien);
      k = claveDe('turnos', quien, id);
    } catch (e: any) {
      console.warn('[turno-unico] sin almacén durable:', String(e?.message || e).slice(0, 120));
      return { sinAlmacen: true };
    }
    const titular = proceso;
    const propio = (reg: RegistroTurno, etag: string): Durable => {
      const p: Propio = { k, a, titular, token: reg.token, etag, reg, perdido: false, cerrado: false, cola: Promise.resolve() };
      vigilar(p);
      return { propio: p };
    };
    const t0 = cfg.ahora();
    const mio: RegistroTurno = { v: 1, estado: 'en-curso', titular, token: 1, vence: t0 + cfg.leaseMs, efectos: [], t: t0, actualizado: t0 };
    const c = await crearUnaVez(k, mio, a).catch((e) => ({ ok: false as const, detalle: String(e?.message || e) }));
    if (c.ok === false) {
      console.warn('[turno-unico] el almacén durable no contestó; el turno corre solo con el cerrojo del proceso:', String(c.detalle).slice(0, 120));
      return { sinAlmacen: true };
    }
    if (c.creado) return propio(mio, c.etag);
    let reg = c.valor;
    let etag = c.etag;
    let choques = 0;
    for (;;) {
      const t = cfg.ahora();
      const conEfectos = (reg.efectos || []).length > 0;
      // Un turno que despachó algo no vuelve a correr nunca: aunque haya pasado la vida de su respuesta, se repite.
      if (reg.estado === 'hecho' && reg.resultado && (conEfectos || t - reg.actualizado <= VIDA_DURABLE_MS)) return { previo: reg.resultado };
      if (reg.estado === 'desconocido') return { desconocido: { efectos: reg.efectos } };
      const vencido = reg.estado === 'en-curso' && reg.vence <= t;
      let nuevo: RegistroTurno | null = null;
      // Su dueño murió después de despachar algo (o terminó sin respuesta después de despacharlo, en un registro
      // de antes de este cambio): no se corre otra vez a ciegas.
      if ((vencido || reg.estado === 'libre' || reg.estado === 'hecho') && conEfectos) nuevo = { ...reg, estado: 'desconocido', vence: 0, actualizado: t };
      // Libre (terminó sin respuesta), viejo, o su dueño murió sin haber hecho nada: se puede correr.
      else if (reg.estado === 'libre' || reg.estado === 'hecho' || vencido) nuevo = { ...mio, token: reg.token + 1, t, vence: t + cfg.leaseMs, actualizado: t };
      if (nuevo) {
        const w = await a.cas(k, nuevo, etag).catch((e) => ({ ok: false as const, conflicto: false as const, detalle: String(e?.message || e) }));
        if (w.ok === true) return nuevo.estado === 'desconocido' ? { desconocido: { efectos: nuevo.efectos } } : propio(nuevo, w.etag);
        // Sin poder escribir no se sabe quién tiene el turno: no se corre otro. Tampoco si otros le ganan una y otra vez.
        if (w.conflicto === false || ++choques > 8) return { enCurso: true };
      } else {
        // En curso en otro proceso, con su lease vigente: se espera sondeando, hasta el tope del reintento.
        const queda = tope - cfg.ahora();
        if (queda <= 0) return { enCurso: true };
        await pausa(Math.min(cfg.sondeoMs, queda));
      }
      const l = await a.leer<RegistroTurno>(k).catch(() => ({ ok: false as const, detalle: '' }));
      // No se pudo mirar, o desapareció: no se corre otro turno por las dudas.
      if (l.ok === false || !l.valor) return { enCurso: true };
      reg = l.valor;
      etag = l.etag!;
    }
  }

  /* ---------------------------------------------------------------- lo de siempre, con lo durable debajo */

  /**
   * El cierre del turno que corre aquí. `p` null: el almacén no contestó al reclamar; el turno contesta, pero no
   * despacha nada con efecto (tras un reinicio o en otra réplica nadie sabría que ya se hizo).
   */
  function terminarDe(clave: string, entrada: Entrada, p: Propio | null): Terminar {
    let guardado: Promise<void> = Promise.resolve();
    const terminar = ((r: TurnoGuardado | null) => {
      if (entrada.hecho) return guardado;
      entrada.hecho = true;
      entrada.ts = cfg.ahora();
      // Sin respuesta y sin nada despachado: el próximo reintento corre uno nuevo (para eso reintenta). Si ya
      // despachó algo, el lugar se queda como `desconocido`: el reintento no lo corre otra vez.
      if (!r && entrada.efectos.length) entrada.desconocido = [...entrada.efectos];
      entrada.resolver(r);
      if (!r && !entrada.desconocido && turnos.get(clave) === entrada) turnos.delete(clave);
      guardado = p ? cerrarDurable(p, r) : Promise.resolve();
      return guardado;
    }) as Terminar;
    const sinRegistro = (que: string) => {
      console.warn(`[turno-unico] no despacho «${String(que).slice(0, 40)}»: el turno no quedó registrado en el almacén durable.`);
      return false;
    };
    terminar.efecto = async (que: string) => {
      if (!p) return sinRegistro(que);
      if (entrada.hecho) return false;
      const ok = await efectoDurable(p, que);
      if (ok) entrada.efectos.push(String(que).slice(0, 40));
      return ok;
    };
    terminar.durable = !!p;
    return terminar;
  }

  /** Reclama aquí: el lugar en el Map primero (los reintentos del mismo proceso lo esperan), luego el almacén. */
  async function reclamarAqui(clave: string, tope: number): Promise<Reclamo> {
    const entrada = crearEntrada(clave);
    const d = await reclamarDurable(clave, tope);
    if ('propio' in d) return { terminar: terminarDe(clave, entrada, d.propio) };
    if ('sinAlmacen' in d) return { terminar: terminarDe(clave, entrada, null) };
    if ('previo' in d) {
      cerrarEntrada(clave, entrada, d.previo);
      return { previo: d.previo };
    }
    // Es de otro proceso (o quedó incierto): este lugar se libera; los que esperaban aquí vuelven a mirar.
    cerrarEntrada(clave, entrada, null);
    return 'desconocido' in d ? { desconocido: d.desconocido } : { enCurso: true };
  }

  /**
   * Qué hacer con esta petición: `previo` (la respuesta de este mismo turno, ya hecha), `terminar` (correr
   * el turno y cerrarlo con eso), `enCurso` (el mismo turno sigue corriendo en otra petición, aquí o en otra
   * réplica, y no terminó mientras esta esperaba: NO se corre otro) o `desconocido` (lo corría un proceso que
   * murió después de despachar algo: no se repite a ciegas). Sin clave (cliente viejo, sin `idTurno`): se corre.
   */
  async function reclamarTurno(clave: string | null, esperaMs = ESPERA_MAX_MS): Promise<Reclamo> {
    if (!clave) {
      const suelto = (() => Promise.resolve()) as unknown as Terminar;
      suelto.efecto = () => Promise.resolve(true);
      suelto.durable = false;
      return { terminar: suelto };
    }
    const tope = cfg.ahora() + esperaMs;
    // Pocas vueltas: si el turno anterior terminó sin respuesta se borra y la siguiente vuelta lo corre.
    for (let vuelta = 0; vuelta < 3; vuelta++) {
      podar();
      const e = turnos.get(clave);
      if (!e) return reclamarAqui(clave, tope);
      if (e.desconocido) return { desconocido: { efectos: e.desconocido } };
      let reloj: ReturnType<typeof setTimeout> | undefined;
      const limite = new Promise<null>((r) => (reloj = setTimeout(() => r(null), Math.max(0, tope - cfg.ahora()))));
      const previo = await Promise.race([e.promesa.catch(() => null), limite]).finally(() => clearTimeout(reloj));
      if (previo) return { previo };
      // Terminó sin respuesta después de despachar algo: no se corre otra vez.
      if (e.desconocido) return { desconocido: { efectos: e.desconocido } };
      // Se pasó la espera y sigue en curso: el dueño sigue siendo el primero (puede estar mandando algo).
      // Este reintento no corre otro; se le dice que sigue, sin soltar la propiedad.
      if (turnos.get(clave) === e && !e.hecho) return { enCurso: true };
    }
    return turnos.has(clave) ? { enCurso: true } : reclamarAqui(clave, tope);
  }

  /**
   * «Solo repetir» (revisión 9, R1): la app reabre con un pedido que mandó y no vio contestado, y pregunta por ESE
   * idTurno. Si el pedido nunca llegó, NO se corre un turno nuevo sin que la persona toque nada: se contesta `noExiste`
   * y la app le devuelve el texto a la caja. No escribe nada en el almacén (no reclama ni toma el lease).
   */
  async function consultarTurno(clave: string | null, esperaMs = ESPERA_MAX_MS): Promise<Consulta> {
    if (!clave) return { noExiste: true, motivo: 'sin_id' };
    const tope = cfg.ahora() + esperaMs;
    // En este proceso: el Map (en curso aquí, o recién hecho).
    podar();
    const e = turnos.get(clave);
    if (e) {
      if (e.desconocido) return { desconocido: { efectos: e.desconocido } };
      let reloj: ReturnType<typeof setTimeout> | undefined;
      const limite = new Promise<null>((r) => (reloj = setTimeout(() => r(null), Math.max(0, tope - cfg.ahora()))));
      const previo = await Promise.race([e.promesa.catch(() => null), limite]).finally(() => clearTimeout(reloj));
      if (previo) return { previo };
      if (e.desconocido) return { desconocido: { efectos: e.desconocido } };
      if (turnos.get(clave) === e && !e.hecho) return { enCurso: true };
    }
    // En el almacén durable (otra réplica, o antes de un reinicio): solo se LEE.
    const { quien, id } = partir(clave);
    let a: AlmacenDurable;
    let k: string;
    try {
      a = almacenDe(quien);
      k = claveDe('turnos', quien, id);
    } catch {
      return { noExiste: true, motivo: 'sin_almacen' };
    }
    for (;;) {
      const l = await a.leer<RegistroTurno>(k).catch(() => ({ ok: false as const, detalle: '' }));
      if (l.ok === false) return { noExiste: true, motivo: 'sin_almacen' };
      const reg = l.valor;
      if (!reg) return { noExiste: true, motivo: 'no_existe' };
      const conEfectos = (reg.efectos || []).length > 0;
      if (reg.estado === 'hecho' && reg.resultado) return { previo: reg.resultado };
      if (reg.estado === 'desconocido') return { desconocido: { efectos: reg.efectos } };
      const t = cfg.ahora();
      const vencido = reg.estado === 'en-curso' && reg.vence <= t;
      // Su dueño murió (o terminó sin respuesta) después de despachar algo: incierto, como lo diría un reintento.
      if ((vencido || reg.estado === 'libre' || reg.estado === 'hecho') && conEfectos) return { desconocido: { efectos: reg.efectos } };
      // Terminó sin respuesta y sin efectos, o su dueño murió sin hacer nada: no hay nada guardado que repetir.
      if (reg.estado === 'libre' || reg.estado === 'hecho' || vencido) return { noExiste: true, motivo: 'no_existe' };
      // En curso en otro proceso con su lease vigente: se espera, como un reintento, hasta el tope.
      const queda = tope - cfg.ahora();
      if (queda <= 0) return { enCurso: true };
      await pausa(Math.min(cfg.sondeoMs, queda));
    }
  }

  return {
    reclamarTurno,
    consultarTurno,
    /** Pruebas: como un reinicio (o la muerte) del proceso: sin Map, sin renovar leases y con otra identidad. */
    olvidar() {
      turnos.clear();
      for (const p of activos) {
        soltarReloj(p);
        p.perdido = true;
      }
      activos.clear();
      proceso = `${opciones.proceso || PROCESO_DURABLE}_r${++reinicios}`;
    },
    cuantos: () => turnos.size,
    /** Pruebas: espera a que se guarde lo pendiente. */
    async alDia() {
      await Promise.all([...activos].map((p) => p.cola));
    },
    configurar(c: Partial<Config>) {
      Object.assign(cfg, c.almacen && !c.almacenElectrum ? { ...c, almacenElectrum: c.almacen } : c);
    },
  };
}

const principal = crearTurnosUnicos();

export function reclamarTurno(clave: string | null, esperaMs = ESPERA_MAX_MS): Promise<Reclamo> {
  return principal.reclamarTurno(clave, esperaMs);
}

/** «Solo repetir» (revisión 9, R1): la respuesta guardada de ese turno, sin correr nunca uno nuevo. */
export function consultarTurno(clave: string | null, esperaMs = ESPERA_MAX_MS): Promise<Consulta> {
  return principal.consultarTurno(clave, esperaMs);
}

/* ------------------------------------------------------------------ efectos del turno en curso */

const turnoActual = new AsyncLocalStorage<Terminar>();

/** Corre `f` como el turno de `terminar`: lo que pase dentro puede preguntar `efectoDelTurno`. */
export function enTurnoUnico<T>(terminar: Terminar, f: () => T): T {
  return turnoActual.run(terminar, f);
}

/**
 * Antes de despachar algo con efecto dentro de un turno (una herramienta que deja o hace algo, el «sí» a
 * un borrador): persiste que se despacha. true = adelante; false = este proceso ya no es el dueño del
 * turno (otro lo tomó) o no se pudo guardar: NO se hace. Fuera de un turno con id, siempre true.
 */
export function efectoDelTurno(que: string): Promise<boolean> {
  const t = turnoActual.getStore();
  return t ? t.efecto(que) : Promise.resolve(true);
}

/**
 * Un turno que contesta pero NO despacha nada con efecto. Para cuando no se puede saber si lo que llega es la
 * primera vez: un webhook reentregado con el almacén caído, o la voz que se reconecta y repite sola la última
 * frase (el turno de antes pudo haber despachado ya). Si la persona lo quiere, lo pide otra vez: eso sí es suyo.
 */
export function turnoSinEfectos(motivo: string): Terminar {
  const no = (que: string) => {
    console.warn(`[turno-unico] no despacho «${String(que).slice(0, 40)}»: ${motivo}.`);
    return false;
  };
  const t = (() => Promise.resolve()) as unknown as Terminar;
  t.efecto = (que: string) => Promise.resolve(no(que));
  t.durable = false;
  return t;
}

/** Solo pruebas. */
export function _olvidarTurnos() {
  principal.olvidar();
}
export function _cuantosTurnos() {
  return principal.cuantos();
}
export function _turnosAlDia() {
  return principal.alDia();
}
export function _configurarTurnos(c: Partial<Config>) {
  principal.configurar(c);
}
