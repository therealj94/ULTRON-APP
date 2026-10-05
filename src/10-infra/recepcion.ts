/**
 * QUÉ BUILD WEB CORRE ESTA PESTAÑA, PARA EL SERVIDOR (evidencia de operación, 5-oct): la cabecera `x-aura-cliente`
 * (formato en lib/recepcion-clientes.ts). Va SOLO en la comprobación de sesión: la que la web ya hace al abrir (App.tsx)
 * y la que sale una vez al guardar una sesión nueva (sesionCliente.guardarTokenMesa: entrar con clave, Genesis, enlace de
 * correo o cambio de clave), así quien entra con la pestaña abierta queda anotado sin recargar. Ninguna otra petición.
 *
 * El SHA es el de la página que se cargó: el build lo escribe en `<meta name="aura-build">` de index.html
 * (scripts/pwa/vite-build-info.ts). La navegación va primero a la red (el service worker), así que la página y su JS
 * son del mismo build; una pestaña abierta desde hace días sigue diciendo el SHA viejo, que es lo cierto. En
 * desarrollo no hay meta y no se manda `w`.
 *
 * Nada más: ni el navegador, ni el sistema, ni la cuenta. El id de la instalación es al azar, vive en este navegador
 * y se renueva cada vez que cambia la sesión (entrar, salir o cambiar de cuenta: sesionCliente.guardarTokenMesa).
 * Sin sesión no se manda nada (el servidor no tendría a quién anotarlo).
 */
export const CABECERA_CLIENTE = 'x-aura-cliente';
export const CLAVE_INSTALACION = 'aura_recepcion_instalacion';
const FORMA_ID = /^[A-Za-z0-9-]{8,64}$/;
const FORMA_SHA = /^[0-9a-f]{7,40}$/i;

type Almacen = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

/** El SHA del build de esta página (la meta que pone el build), o null. */
export function shaDeLaPagina(doc: { querySelector?: (s: string) => { getAttribute?: (n: string) => string | null } | null } | null = typeof document !== 'undefined' ? document : null): string | null {
  try {
    const v = String(doc?.querySelector?.('meta[name="aura-build"]')?.getAttribute?.('content') || '').trim();
    return FORMA_SHA.test(v) ? v.toLowerCase() : null;
  } catch {
    return null;
  }
}

/** La cabecera armada (pura). Lo que no tiene su forma no va. */
export function descriptorWeb(o: { instalacion: string; sha: string | null }): string {
  const pares = ['v1', 'p=web'];
  if (o.sha && FORMA_SHA.test(o.sha)) pares.push(`w=${o.sha.toLowerCase()}`);
  pares.push(`i=${o.instalacion}`);
  return pares.join(';');
}

function almacen(): Almacen | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function nuevoId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `w-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
  }
}

/** El id de esta instalación: se crea la primera vez y se guarda. Sin almacenamiento, null (no se manda nada). */
export function idInstalacionWeb(s: Almacen | null = almacen()): string | null {
  if (!s) return null;
  try {
    const g = s.getItem(CLAVE_INSTALACION);
    if (g && FORMA_ID.test(g)) return g;
    const n = nuevoId();
    s.setItem(CLAVE_INSTALACION, n);
    return n;
  } catch {
    return null;
  }
}

/** Entrar, salir o cambiar de cuenta: el id viejo se olvida y la próxima sesión estrena uno. */
export function renovarInstalacionWeb(s: Almacen | null = almacen()) {
  try {
    s?.removeItem(CLAVE_INSTALACION);
  } catch {
    /* modo privado */
  }
}

/** La cabecera para la comprobación de sesión, o nada si no hay sesión o no se puede guardar el id. */
export function cabeceraCliente(token: string, o: { almacen?: Almacen | null; doc?: Parameters<typeof shaDeLaPagina>[0] } = {}): Record<string, string> {
  if (!token) return {};
  const id = idInstalacionWeb(o.almacen === undefined ? almacen() : o.almacen);
  if (!id) return {};
  return { [CABECERA_CLIENTE]: descriptorWeb({ instalacion: id, sha: shaDeLaPagina(o.doc) }) };
}
