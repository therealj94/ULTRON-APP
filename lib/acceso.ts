/**
 * EL PADRÓN — quién es quién, y en cuál de las dos plataformas.
 *
 * AU-RA FP y Dr Electrum FP comparten un cuerpo (cara, voz, oído, ojos, harness) y hasta el mismo
 * Qwen en el mismo nodo. No comparten NADA más: ni cerebro, ni memoria, ni herramientas, ni gente.
 * Entrar a una no es entrar a la otra. Este archivo es el único sitio donde eso se decide.
 *
 * Dos ideas sostienen el diseño:
 *
 *  1. **Se niega por omisión.** Nadie tiene acceso a una plataforma hasta que el padrón lo diga.
 *     Un nombre desconocido, un correo que no está, un Telegram que nadie registró: fuera. No hay
 *     «invitado», no hay «público», no hay hueco para desarrollo que se olvide encendido.
 *
 *  2. **Decir quién sos no es serlo.** La identificación trae PRUEBA: `sesion` (cookie firmada con
 *     HMAC del servidor), `telegram` (id que llegó por un webhook con secreto verificado) o
 *     `nombre` (lo que alguien escribió en un campo de texto). Las dos primeras valen; la tercera
 *     sirve para saludarte, jamás para darte permisos. Sin esta distinción cualquiera manda un
 *     `{"nombre":"José"}` y hereda el sistema.
 *
 * El padrón vive en código —para que arranque bien sin configurar nada— y se amplía desde el
 * entorno, para que José pueda dar y quitar accesos sin esperar un despliegue.
 */

export type Plataforma = 'ultron' | 'electrum';

/**
 * Tres niveles, y la diferencia entre ellos es qué puede CAMBIAR cada uno:
 *
 *  - `lee`     — pregunta, mira, calcula. Su propia memoria. No toca nada de nadie.
 *  - `escribe` — además alimenta el cerebro: sube capas, expedientes, hechos. Lo que sube, queda.
 *  - `mando`   — además cambia el sistema (redespliegue, mantenimiento, ejecutor) y el padrón.
 */
export type Nivel = 'lee' | 'escribe' | 'mando';

/** Cómo se comprobó la identidad. Solo `sesion` y `telegram` son prueba. */
export type Prueba = 'sesion' | 'telegram' | 'nombre';

export type Persona = {
  /** Corto y estable: es la llave de su memoria privada. */
  id: string;
  nombre: string;
  /** En minúsculas. El correo de la sesión firmada se compara contra esta lista. */
  correos: string[];
  /** Ids de usuario y de chat de Telegram, como texto. */
  telegram: string[];
  /** Cómo más se le llama. Una sola letra se compara por igualdad exacta, no por palabra. */
  apodos: string[];
  /** Plataformas a las que entra. Lo que no está aquí, no existe para esa persona. */
  acceso: Partial<Record<Plataforma, Nivel>>;
};

export type Identificacion = { persona: Persona; prueba: Prueba };

const ORDEN: Record<Nivel, number> = { lee: 1, escribe: 2, mando: 3 };

/**
 * El padrón de arranque. José y Medardo mandan en las dos; Carlos y Mayra consultan AU-RA y no
 * existen en Electrum. Electrum es una demostración: su puerta empieza cerrada para todo el mundo
 * menos para quien la está construyendo.
 */
const BASE: Persona[] = [
  {
    id: 'jose',
    nombre: 'José',
    correos: ['j.ordonez@ordenglobal.org', 'jose@ordenglobal.org'],
    telegram: [],
    apodos: ['j'],
    acceso: { ultron: 'mando', electrum: 'mando' },
  },
  {
    id: 'medardo',
    nombre: 'Medardo',
    correos: ['m.ordonez@ordenglobal.org', 'medardo@ordenglobal.org'],
    telegram: [],
    apodos: [],
    acceso: { ultron: 'mando', electrum: 'mando' },
  },
  {
    id: 'carlos',
    nombre: 'Carlos',
    correos: [],
    telegram: [],
    apodos: ['paguada', 'leonardo paguada'],
    acceso: { ultron: 'lee' },
  },
  {
    id: 'mayra',
    nombre: 'Mayra',
    correos: [],
    telegram: [],
    apodos: ['enamorado'],
    acceso: { ultron: 'lee' },
  },
];

/* ------------------------------------------------------------------ utilidades */

function fold(s: unknown): string {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim();
}

function lista(raw: unknown): string[] {
  return String(raw || '')
    .split(/[,\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function nivelValido(v: unknown): Nivel | null {
  const n = fold(v);
  if (n === 'mando' || n === 'escribe' || n === 'lee') return n;
  // Sinónimos que a alguien le van a salir solos al escribir la variable de entorno.
  if (n === 'consulta' || n === 'solo lectura' || n === 'lectura') return 'lee';
  if (n === 'trabajo' || n === 'carga' || n === 'agrega') return 'escribe';
  if (n === 'admin' || n === 'total') return 'mando';
  return null;
}

/* ------------------------------------------------------------------ el entorno */

/**
 * ULTRON_PADRON. Dos formatos, porque el que escribe esto lo hace en la caja de texto de Render:
 *
 *   JSON — si empieza por `[`, un array de personas tal cual el tipo.
 *
 *   Líneas — una persona por línea, cinco columnas separadas por `|`:
 *
 *     id | nombre | correos | telegram | accesos
 *     perez | Ing. Pérez | perez@mina.hn | 445566 | electrum=escribe
 *     jose  |           |               | 111222  | electrum=mando
 *
 *   Las columnas vacías no borran: se FUNDE con lo que ya había para ese id. Así se le agrega un
 *   Telegram a José sin tener que repetir sus correos y arriesgarse a borrarlos con un dedazo.
 */
function delEntorno(): Persona[] {
  const raw = String(process.env.ULTRON_PADRON || '').trim();
  if (!raw) return [];
  if (raw.startsWith('[')) {
    try {
      const arr = JSON.parse(raw);
      if (!Array.isArray(arr)) return [];
      return arr.map(normalizar).filter((p): p is Persona => !!p);
    } catch {
      console.warn('[AU-RA] ULTRON_PADRON parece JSON pero no se pudo leer. Lo ignoro entero.');
      return [];
    }
  }
  const out: Persona[] = [];
  for (const linea of raw.split(/[\n;]+/)) {
    const l = linea.trim();
    if (!l || l.startsWith('#')) continue;
    const c = l.split('|').map((s) => s.trim());
    const acceso: Persona['acceso'] = {};
    for (const par of lista(c[4])) {
      const [plat, niv] = par.split('=');
      const p = fold(plat);
      const n = nivelValido(niv);
      if ((p === 'ultron' || p === 'electrum') && n) acceso[p] = n;
    }
    const p = normalizar({
      id: c[0],
      nombre: c[1],
      correos: c[2] ? c[2].split(',') : [],
      telegram: c[3] ? c[3].split(',') : [],
      acceso,
    });
    if (p) out.push(p);
  }
  return out;
}

function normalizar(x: any): Persona | null {
  const id = fold(x?.id).replace(/[^a-z0-9._-]/g, '');
  if (!id) return null;
  const acceso: Persona['acceso'] = {};
  for (const [k, v] of Object.entries(x?.acceso || {})) {
    const n = nivelValido(v);
    if ((k === 'ultron' || k === 'electrum') && n) acceso[k] = n;
  }
  return {
    id,
    nombre: String(x?.nombre || '').trim(),
    correos: (Array.isArray(x?.correos) ? x.correos : lista(x?.correos)).map(fold).filter(Boolean),
    telegram: (Array.isArray(x?.telegram) ? x.telegram : lista(x?.telegram)).map((s: unknown) => String(s).trim()).filter(Boolean),
    apodos: (Array.isArray(x?.apodos) ? x.apodos : lista(x?.apodos)).map(fold).filter(Boolean),
    acceso,
  };
}

/**
 * Compatibilidad: los TELEGRAM_<NOMBRE>_USER_IDS que ya están puestos en Render siguen valiendo.
 * Quitarlos de golpe dejaría a la junta sin bot hasta que alguien reescribiera las variables, y
 * eso es exactamente la clase de rotura que no vamos a causar.
 */
function telegramHeredado(id: string): string[] {
  const u = id.toUpperCase();
  return [
    ...lista(process.env[`TELEGRAM_${u}_USER_IDS`]),
    ...lista(process.env[`TELEGRAM_${u}_CHAT_ID`]),
    ...lista(process.env[`TELEGRAM_${u}_USER_ID`]),
  ];
}

/* ------------------------------------------------------------------ el padrón */

let cache: { llave: string; gente: Persona[] } | null = null;

/** La llave cambia cuando cambia el entorno, así que el padrón se rehace solo. Las pruebas dependen de esto. */
function llaveEntorno(): string {
  const partes = [String(process.env.ULTRON_PADRON || '')];
  for (const p of BASE) partes.push(`${p.id}:${telegramHeredado(p.id).join(',')}`);
  return partes.join('|');
}

function fundir(a: Persona, b: Persona): Persona {
  return {
    id: a.id,
    nombre: b.nombre || a.nombre,
    correos: [...new Set([...a.correos, ...b.correos])],
    telegram: [...new Set([...a.telegram, ...b.telegram])],
    apodos: [...new Set([...a.apodos, ...b.apodos])],
    acceso: { ...a.acceso, ...b.acceso },
  };
}

export function padron(): Persona[] {
  const llave = llaveEntorno();
  if (cache && cache.llave === llave) return cache.gente;
  const porId = new Map<string, Persona>();
  for (const p of BASE) {
    porId.set(p.id, { ...p, telegram: [...new Set([...p.telegram, ...telegramHeredado(p.id)])] });
  }
  for (const p of delEntorno()) {
    const previo = porId.get(p.id);
    porId.set(p.id, previo ? fundir(previo, p) : p);
  }
  const gente = [...porId.values()];
  cache = { llave, gente };
  return gente;
}

/** Solo para pruebas: olvida el padrón calculado. */
export function reiniciarPadron() {
  cache = null;
}

/* ------------------------------------------------------------------ identificar */

function porCorreo(correo: string): Persona | null {
  const c = fold(correo).replace(/^mailto:/, '');
  if (!c) return null;
  for (const p of padron()) if (p.correos.includes(c)) return p;
  // Los correos de Orden Global son nombre.apellido@: si el buzón coincide en la parte local con
  // uno conocido, es la misma persona con otro dominio de la casa.
  const local = c.split('@')[0];
  if (!local) return null;
  for (const p of padron()) if (p.correos.some((x) => x.split('@')[0] === local)) return p;
  return null;
}

function porTelegram(userId?: string | number, chatId?: string | number): Persona | null {
  const uid = String(userId ?? '').trim();
  const cid = String(chatId ?? '').trim();
  if (!uid && !cid) return null;
  for (const p of padron()) {
    if (uid && p.telegram.includes(uid)) return p;
    if (cid && p.telegram.includes(cid)) return p;
  }
  return null;
}

function porNombre(nombre: string): Persona | null {
  const n = fold(nombre);
  if (!n) return null;
  for (const p of padron()) {
    const claves = [fold(p.nombre), ...p.apodos].filter(Boolean);
    for (const k of claves) {
      // Un apodo de una letra («j») solo vale si es TODO lo que escribieron. Si no, «Juan» sería José.
      if (k.length <= 2) {
        if (n === k) return p;
        continue;
      }
      if (new RegExp(`(^|[^a-z0-9])${k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z0-9]|$)`).test(n)) return p;
    }
  }
  return null;
}

/**
 * Quién está hablando, y con qué prueba. El orden importa: primero lo que se puede comprobar.
 */
export function identificar(pistas: {
  correo?: string;
  telegramUserId?: string | number;
  telegramChatId?: string | number;
  nombre?: string;
}): Identificacion | null {
  const c = porCorreo(pistas.correo || '');
  if (c) return { persona: c, prueba: 'sesion' };
  const t = porTelegram(pistas.telegramUserId, pistas.telegramChatId);
  if (t) return { persona: t, prueba: 'telegram' };
  const n = porNombre(pistas.nombre || '');
  if (n) return { persona: n, prueba: 'nombre' };
  return null;
}

export function personaPorId(id: string | null | undefined): Persona | null {
  if (!id) return null;
  return padron().find((p) => p.id === id) || null;
}

/* ------------------------------------------------------------------ permisos */

export function nivelDe(quien: Identificacion | Persona | null | undefined, plataforma: Plataforma): Nivel | null {
  if (!quien) return null;
  const persona = 'persona' in quien ? quien.persona : quien;
  return persona.acceso[plataforma] || null;
}

/** Entrar es solo mirar: basta con estar en el padrón de esa plataforma, con la prueba que sea. */
export function puedeEntrar(quien: Identificacion | Persona | null | undefined, plataforma: Plataforma): boolean {
  return nivelDe(quien, plataforma) !== null;
}

/**
 * Cambiar algo exige nivel Y prueba. Un nombre escrito a mano no cambia nada, nunca, en ninguna
 * plataforma: ahí es donde se cierra la escalada de privilegios más barata que existe.
 */
function alcanza(quien: Identificacion | null | undefined, plataforma: Plataforma, minimo: Nivel): boolean {
  if (!quien || quien.prueba === 'nombre') return false;
  const n = nivelDe(quien, plataforma);
  return !!n && ORDEN[n] >= ORDEN[minimo];
}

/** Puede alimentar el cerebro de esa plataforma: subir capas, expedientes, hechos. */
export function puedeEscribir(quien: Identificacion | null | undefined, plataforma: Plataforma): boolean {
  return alcanza(quien, plataforma, 'escribe');
}

/** Puede cambiar el sistema de esa plataforma: redespliegue, mantenimiento, ejecutor. */
export function puedeMandar(quien: Identificacion | null | undefined, plataforma: Plataforma): boolean {
  return alcanza(quien, plataforma, 'mando');
}

/** La frase que se le mete al modelo para que sepa qué NO puede ofrecerle a quien tiene enfrente. */
export function fraseDeAcceso(nivel: Nivel | null, plataforma: Plataforma): string {
  const donde = plataforma === 'electrum' ? 'Dr Electrum' : 'AU-RA';
  if (!nivel) return `ACCESO: ninguno. Quien pregunta no está en el padrón de ${donde}. No le des nada.`;
  if (nivel === 'mando') return 'ACCESO: mando. Puede pedir redespliegue, mantenimiento, ejecutor y cargar información al cerebro.';
  if (nivel === 'escribe')
    return 'ACCESO: trabajo. Puede cargar información al cerebro (capas, expedientes) pero no cambia el sistema: sin redespliegue, sin mantenimiento, sin ejecutor.';
  return 'ACCESO: consulta. No cambia el sistema ni carga nada al cerebro. Preguntar, mirar y calcular, todo lo que quiera.';
}
